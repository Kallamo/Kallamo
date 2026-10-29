const crypto = require('crypto');

// Only authored Knowledge travels: awareness from links is rebuilt on import, and play records
// belong to their play. Links are named by their ends (relType|fromRef|toRef), as ids change.

const STRUCTURAL_SOURCES = new Set(['relationship', 'faction-membership', 'inventory', 'locality']);
const KNOWLEDGE_KEY = /^knowledge:(.+)$/;

function linkEndsById(db, workspaceId, entityIds) {
  const rows = db.prepare('SELECT id, relType, fromId, toId FROM entity_links WHERE workspaceId = ?').all(workspaceId);
  return new Map(rows
    .filter(row => entityIds.has(row.fromId) && entityIds.has(row.toId))
    .map(row => [row.id, `${row.relType}|${row.fromId}|${row.toId}`]));
}

function exportAuthoredKnowledge({ db, worldbuildData, workspaceId, entityIds }) {
  const ids = new Set(entityIds);
  const ends = linkEndsById(db, workspaceId, ids);
  const entries = [];
  for (const subjectId of ids) {
    const projection = worldbuildData.getSubjectKnowledge(workspaceId, subjectId);
    for (const [kind, list] of [['knowledge', projection.known], ['belief', projection.beliefs], ['memory', projection.memories]]) {
      for (const entry of list || []) {
        if (entry.origin?.kind !== 'authored') continue;
        const ref = entry.entryId || entry.id;
        if (kind === 'memory') {
          entries.push({ ref, kind, subjectRef: subjectId, summary: entry.summary, category: entry.category || null, accessibility: entry.accessibility, occurredOn: entry.occurredOn || null });
          continue;
        }
        if (!ids.has(entry.aboutId)) continue;
        entries.push({
          ref, kind, subjectRef: subjectId, aboutRef: entry.aboutId, statement: entry.statement,
          category: entry.category || null, confidence: entry.confidence,
          ...(kind === 'knowledge' ? {
            acquisition: entry.acquisition, accessibility: entry.accessibility,
            informantRefs: (entry.informantIds || []).filter(id => ids.has(id)),
          } : {}),
        });
      }
    }
  }

  const cards = db.prepare(`
    SELECT card_id, owner_id, target_id, known_as, audience_type FROM worldbuild_knowledge_cards
    WHERE workspace_id = ? AND status = 'active'
  `).all(workspaceId).flatMap(card => {
    if (!ids.has(card.owner_id) || !ids.has(card.target_id)) return [];
    const manual = Boolean(db.prepare(`
      SELECT 1 FROM worldbuild_knowledge_sources WHERE workspace_id = ? AND card_id = ? AND source_type = 'manual'
    `).get(workspaceId, card.card_id));
    const knownFields = db.prepare(`
      SELECT field_key FROM worldbuild_known_fields WHERE workspace_id = ? AND card_id = ? AND source_type = 'manual'
    `).all(workspaceId, card.card_id).map(row => row.field_key);
    const knownLinks = db.prepare(`
      SELECT relationship_id FROM worldbuild_known_relationships WHERE workspace_id = ? AND card_id = ? AND source_type = 'manual'
    `).all(workspaceId, card.card_id).map(row => ends.get(row.relationship_id)).filter(Boolean);
    const audienceRefs = card.audience_type === 'selected-members'
      ? db.prepare(`
        SELECT member_id FROM worldbuild_knowledge_audience_members
        WHERE workspace_id = ? AND card_id = ? AND entry_type = 'card'
      `).all(workspaceId, card.card_id).map(row => row.member_id).filter(id => ids.has(id))
      : [];
    const authored = manual || card.known_as || knownFields.length || knownLinks.length || card.audience_type === 'selected-members';
    return authored ? [{
      ownerRef: card.owner_id, targetRef: card.target_id, manual, knownAs: card.known_as || null,
      knownFields, knownLinks, audienceType: card.audience_type, audienceRefs,
    }] : [];
  });

  // A card the author removed would come back from its link; the removal is what travels.
  const exclusions = db.prepare(`
    SELECT owner_id, target_id, source_type, source_id FROM worldbuild_knowledge_exclusions WHERE workspace_id = ?
  `).all(workspaceId).flatMap(row => (
    ids.has(row.owner_id) && ids.has(row.target_id) && STRUCTURAL_SOURCES.has(row.source_type) && ends.has(row.source_id)
      ? [{ ownerRef: row.owner_id, targetRef: row.target_id, sourceType: row.source_type, link: ends.get(row.source_id) }]
      : []
  ));

  return { version: 1, entries, cards, exclusions };
}

// Recreates each piece through the same calls the sheet uses, so the imported world holds it
// exactly as if the author had written it there. One piece that no longer fits is skipped.
function importAuthoredKnowledge({ db, worldbuildData, workspaceId, knowledge, idMap, linkIdByEnds }) {
  const entryIdMap = new Map();
  let entriesAdded = 0, skipped = 0;
  const mapLink = (link) => {
    const [relType, fromRef, toRef] = String(link || '').split('|');
    return linkIdByEnds.get(`${relType}|${idMap.get(fromRef)}|${idMap.get(toRef)}`) || null;
  };
  const attempt = (work) => {
    try { work(); return true; } catch (error) {
      console.warn('[import-worldbuild] skipped a Knowledge piece:', error.message);
      skipped++;
      return false;
    }
  };

  if (knowledge && knowledge.version === 1) {
    const exclude = db.prepare(`
      INSERT OR IGNORE INTO worldbuild_knowledge_exclusions (workspace_id, owner_id, target_id, source_type, source_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    for (const row of Array.isArray(knowledge.exclusions) ? knowledge.exclusions : []) {
      const ownerId = idMap.get(row?.ownerRef);
      const targetId = idMap.get(row?.targetRef);
      const linkId = mapLink(row?.link);
      if (ownerId && targetId && linkId && STRUCTURAL_SOURCES.has(row.sourceType)) exclude.run(workspaceId, ownerId, targetId, row.sourceType, linkId, Date.now());
    }

    // One transaction for the whole list: committing each entry on its own costs seconds on a big world.
    const writeEntries = db.transaction(() => {
      for (const entry of Array.isArray(knowledge.entries) ? knowledge.entries : []) {
        const subjectId = idMap.get(entry?.subjectRef);
        const kind = entry?.kind;
        if (!subjectId || !['knowledge', 'belief', 'memory'].includes(kind)) { skipped++; continue; }
        const entryId = crypto.randomUUID();
        const fields = kind === 'memory'
          ? { summary: entry.summary, category: entry.category, accessibility: entry.accessibility, occurredOn: entry.occurredOn }
          : {
            aboutId: idMap.get(entry.aboutRef), statement: entry.statement, category: entry.category, confidence: entry.confidence,
            acquisition: entry.acquisition, accessibility: entry.accessibility,
            informantIds: (entry.informantRefs || []).map(ref => idMap.get(ref)).filter(Boolean),
          };
        if (kind !== 'memory' && !fields.aboutId) { skipped++; continue; }
        if (attempt(() => worldbuildData.writeSubjectEntry({ workspaceId, subjectId, kind, entry: { ...fields, entryId } }))) {
          entryIdMap.set(entry.ref, entryId);
          entriesAdded++;
        }
      }
    });
    writeEntries();

    // Cards that follow from links are built first, so their access can be set on them.
    worldbuildData.reconcileKnowledge(workspaceId);
    for (const card of Array.isArray(knowledge.cards) ? knowledge.cards : []) {
      const ownerId = idMap.get(card?.ownerRef);
      const targetId = idMap.get(card?.targetRef);
      if (!ownerId || !targetId) { skipped++; continue; }
      const scope = { workspaceId, ownerId, targetId };
      const exists = worldbuildData.getKnowledgeCard(workspaceId, ownerId, targetId);
      if (card.manual || card.knownAs || !exists) {
        if (!attempt(() => worldbuildData.ensureAwareness({
          ...scope, sourceType: card.manual ? 'manual' : 'import', sourceId: crypto.randomUUID(), knownAs: card.knownAs || undefined,
        }))) continue;
      }
      if (Array.isArray(card.knownFields) && card.knownFields.length) attempt(() => worldbuildData.setKnownFields({ ...scope, fieldKeys: card.knownFields }));
      const relationshipIds = (card.knownLinks || []).map(mapLink).filter(Boolean);
      if (relationshipIds.length) attempt(() => worldbuildData.setKnownRelationships({ ...scope, relationshipIds }));
      if (card.audienceType === 'selected-members') {
        attempt(() => worldbuildData.setKnowledgeAudience({ ...scope, audienceType: 'selected-members', memberIds: (card.audienceRefs || []).map(ref => idMap.get(ref)).filter(Boolean) }));
      }
    }
  }

  // Hidden statements follow their new entries; a mark whose entry did not come along is dropped.
  const update = db.prepare('UPDATE entities SET data = ? WHERE id = ?');
  for (const entityId of idMap.values()) {
    const row = db.prepare('SELECT data FROM entities WHERE id = ?').get(entityId);
    let data;
    try { data = JSON.parse(row?.data || '{}'); } catch { continue; }
    if (!Array.isArray(data.spoilers) || !data.spoilers.some(key => KNOWLEDGE_KEY.test(String(key)))) continue;
    data.spoilers = data.spoilers.flatMap(key => {
      const match = String(key).match(KNOWLEDGE_KEY);
      if (!match) return [key];
      const next = entryIdMap.get(match[1]);
      return next ? [`knowledge:${next}`] : [];
    });
    update.run(JSON.stringify(data), entityId);
  }
  return { knowledgeAdded: entriesAdded, knowledgeSkipped: skipped };
}

// Facts the author wrote travel; facts kept by another record or written in play are rebuilt there.
function exportAuthoredFacts({ worldbuildData, workspaceId, entityIds }) {
  const ids = new Set(entityIds);
  const entries = worldbuildData.listWorldFacts(workspaceId)
    .filter(fact => fact.source === 'manual' && !fact.managed)
    .map(fact => ({
      ref: fact.id,
      title: fact.title,
      statement: fact.statement,
      relatedRefs: (fact.relatedEntityIds || []).filter(id => ids.has(id)),
    }));
  return { version: 1, entries };
}

function importAuthoredFacts({ worldbuildData, workspaceId, facts, idMap }) {
  let factsAdded = 0, factsSkipped = 0;
  if (!facts || facts.version !== 1) return { factsAdded, factsSkipped };
  for (const fact of Array.isArray(facts.entries) ? facts.entries : []) {
    const title = String(fact?.title || '').trim();
    const statement = String(fact?.statement || '').trim();
    if (!title || !statement) { factsSkipped++; continue; }
    try {
      worldbuildData.saveWorldFact({
        workspaceId,
        entry: { title, statement, relatedEntityIds: (fact.relatedRefs || []).map(ref => idMap.get(ref)).filter(Boolean) },
      });
      factsAdded++;
    } catch (error) {
      console.warn('[import-worldbuild] skipped a Fact:', error.message);
      factsSkipped++;
    }
  }
  return { factsAdded, factsSkipped };
}

module.exports = { exportAuthoredKnowledge, importAuthoredKnowledge, exportAuthoredFacts, importAuthoredFacts };
