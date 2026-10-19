// Worldbuild registry access layer. Keep it free of Electron/IPC concerns.
const db = require('./database');
const crypto = require('crypto');
const { discardEnrichPending, normalizeRelationshipLabel } = require('./features/worldbuild/entity-review');
const { foldText } = require('./features/world-index/text-fold');
const { countEntityReferences, releaseEntityReferences, replaceEntityId, repointEntityReferences } = require('./features/worldbuild/entity-references');

function parseJsonArray(raw) {
  if (!raw) return [];
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch { return []; }
}

// Folds typographic punctuation so a curly apostrophe matches a typed straight one.
function normalizeName(s) {
  return String(s || '')
    .replace(/[‘’‛ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function parseJsonObject(raw) {
  if (!raw) return {};
  try { const o = JSON.parse(raw); return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {}; } catch { return {}; }
}

function linkMetadata(raw) {
  return parseJsonObject(raw);
}

function hydrate(row) {
  if (!row) return row;
  return {
    ...row,
    aliases: parseJsonArray(row.aliases),
    data: parseJsonObject(row.data),
  };
}

function listEntities({ workspaceId, type = null } = {}) {
  let rows;
  if (type) {
    rows = db.prepare('SELECT * FROM entities WHERE workspaceId = ? AND type = ? ORDER BY canonicalName')
      .all(workspaceId, type);
  } else {
    rows = db.prepare('SELECT * FROM entities WHERE workspaceId = ? ORDER BY type, canonicalName')
      .all(workspaceId);
  }
  return rows.map(hydrate);
}

function getEntity(id) {
  return hydrate(db.prepare('SELECT * FROM entities WHERE id = ?').get(id));
}

function createEntity({ workspaceId, type, canonicalName, aliases = [], lore = '', loreDocumentId = null, data = {}, status = 'confirmed' } = {}) {
  if (!type || !canonicalName || !String(canonicalName).trim()) {
    throw new Error('type and canonicalName are required');
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO entities (id, workspaceId, type, canonicalName, aliases, lore, loreDocumentId, data, status, createdAt, last_modified)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, workspaceId || null, type, String(canonicalName).trim(),
    JSON.stringify(Array.isArray(aliases) ? aliases.map(a => String(a).trim()).filter(Boolean) : []),
    lore || '', loreDocumentId || null, JSON.stringify(data || {}), status || 'confirmed', now, now
  );
  return getEntity(id);
}

function updateEntity(id, fields = {}) {
  const cur = db.prepare('SELECT * FROM entities WHERE id = ?').get(id);
  if (!cur) return null;
  const nextData = fields.data != null ? { ...fields.data } : parseJsonObject(cur.data);
  if (cur.status === 'proposed' && fields.status === 'confirmed') {
    delete nextData.proposalEvidence;
    delete nextData._imported;
  }
  const next = {
    type: fields.type != null ? fields.type : cur.type,
    canonicalName: fields.canonicalName != null ? String(fields.canonicalName).trim() : cur.canonicalName,
    aliases: fields.aliases != null
      ? JSON.stringify(fields.aliases.map(a => String(a).trim()).filter(Boolean))
      : cur.aliases,
    lore: fields.lore != null ? fields.lore : cur.lore,
    loreDocumentId: fields.loreDocumentId !== undefined ? fields.loreDocumentId : cur.loreDocumentId,
    data: JSON.stringify(nextData),
    status: fields.status != null ? fields.status : cur.status,
  };
  db.prepare(`
    UPDATE entities
    SET type = ?, canonicalName = ?, aliases = ?, lore = ?, loreDocumentId = ?, data = ?, status = ?, last_modified = ?
    WHERE id = ?
  `).run(next.type, next.canonicalName, next.aliases, next.lore, next.loreDocumentId, next.data, next.status, Date.now(), id);
  if (next.type === 'Items' && nextData.itemNature === 'unique') {
    const ownedLinks = db.prepare("SELECT id, metadata_json FROM entity_links WHERE fromId = ? AND relType = 'owned_by'").all(id);
    const updateMetadata = db.prepare('UPDATE entity_links SET metadata_json = ? WHERE id = ?');
    for (const link of ownedLinks) updateMetadata.run(JSON.stringify({ ...parseJsonObject(link.metadata_json), quantity: 1 }), link.id);
  }
  return getEntity(id);
}

// Written only by the main process: staged reviews, provenance and enrichment bookkeeping.
const MAIN_OWNED_DATA_KEYS = ['_enrichPending', '_imported', 'proposalEvidence', 'narrativeOrigin', 'needsEnrichment'];

/**
 * An edit from the sheet. Its copy of data may predate background writes, so it is laid over the
 * stored data: keys it leaves out keep their value, and main-owned keys are never taken from it.
 */
function updateEntityFromEditor(id, fields = {}) {
  if (fields.data == null) return updateEntity(id, fields);
  const cur = db.prepare('SELECT data FROM entities WHERE id = ?').get(id);
  if (!cur) return null;
  const incoming = { ...fields.data };
  for (const key of MAIN_OWNED_DATA_KEYS) delete incoming[key];
  return updateEntity(id, { ...fields, data: { ...parseJsonObject(cur.data), ...incoming } });
}

function deleteEntity(id) {
  const row = db.prepare('SELECT workspaceId FROM entities WHERE id = ?').get(id);
  db.transaction(() => {
    if (row) releaseEntityReferences(db, { workspaceId: row.workspaceId, entityId: id });
    db.prepare('DELETE FROM entities WHERE id = ?').run(id); // links + chunk_tags GC via triggers
  })();
  return { id };
}

// Internal/transient data keys that must never survive a merge or ride along an export.
function stripInternal(data) {
  const d = { ...(data || {}) };
  delete d._enrichPending;
  delete d._imported;
  delete d.proposalEvidence;
  delete d.loreDocumentIds;
  delete d.nameReviewDismissed;
  return d;
}

// `prefer` decides which side wins conflicting fields ('target' by default).
function mergeEntity(sourceId, targetId, { prefer = 'target' } = {}) {
  if (!sourceId || !targetId || sourceId === targetId) throw new Error('distinct source and target are required');
  const source = db.prepare('SELECT * FROM entities WHERE id = ?').get(sourceId);
  const target = db.prepare('SELECT * FROM entities WHERE id = ?').get(targetId);
  if (!source || !target) throw new Error('source or target entity not found');

  const seen = new Set([normalizeName(target.canonicalName)]);
  const mergedAliases = [];
  for (const a of [...parseJsonArray(target.aliases), source.canonicalName, ...parseJsonArray(source.aliases)]) {
    const clean = String(a || '').trim();
    if (!clean) continue;
    const key = normalizeName(clean);
    if (seen.has(key)) continue;
    seen.add(key);
    mergedAliases.push(clean);
  }

  // Combine data + lore, letting the preferred side win on conflicts; the survivor keeps
  // its own AI policy regardless. Internal keys never travel.
  const sData = stripInternal(parseJsonObject(source.data));
  const tData = stripInternal(parseJsonObject(target.data));
  const mergedData = replaceEntityId(prefer === 'source' ? { ...tData, ...sData } : { ...sData, ...tData }, sourceId, targetId);
  const targetPolicy = parseJsonObject(target.data).aiPolicy;
  if (targetPolicy) mergedData.aiPolicy = targetPolicy; else delete mergedData.aiPolicy;
  const sLore = (source.lore || '').trim();
  const tLore = (target.lore || '').trim();
  const mergedLore = prefer === 'source' ? (sLore || target.lore || '') : (tLore || source.lore || '');

  db.transaction(() => {
    // Repoint everything the source owned onto the target. OR IGNORE drops chunk-tag rows
    // that would collide with an existing (chunkId, tag, target) row.
    db.prepare('UPDATE OR IGNORE chunk_tags SET entity = ? WHERE entity = ?').run(targetId, sourceId);
    // An item holds one owner and one location, so the target's own edge wins where both have one.
    db.prepare('UPDATE OR IGNORE entity_links SET fromId = ? WHERE fromId = ?').run(targetId, sourceId);
    db.prepare('UPDATE OR IGNORE entity_links SET toId = ? WHERE toId = ?').run(targetId, sourceId);
    db.prepare('DELETE FROM entity_links WHERE fromId = ? OR toId = ?').run(sourceId, sourceId);
    // A merge can create self-loops (source was linked to target) and duplicate edges.
    db.prepare('DELETE FROM entity_links WHERE fromId = toId').run();
    db.prepare(`DELETE FROM entity_links WHERE id NOT IN (
        SELECT MIN(id) FROM entity_links GROUP BY fromId, relType, toId, IFNULL(label, ''))`).run();
    repointEntityReferences(db, { workspaceId: target.workspaceId, sourceId, targetId, prefer, targetName: target.canonicalName });
    db.prepare('UPDATE entities SET aliases = ?, lore = ?, data = ?, last_modified = ? WHERE id = ?')
      .run(JSON.stringify(mergedAliases), mergedLore, JSON.stringify(mergedData), Date.now(), targetId);
    db.prepare('DELETE FROM entities WHERE id = ?').run(sourceId);
  })();
  return getEntity(targetId);
}

// Stable identity for a staged link, so the UI can accept/reject one edge at a time.
function enrichLinkKey(l) { return `${l.relKey}:${l.targetId}:${l.label || ''}`; }

// Incremental: only items named in accept/reject leave the pending blob.
// accept/reject = { fields, lore, links, chapters }.
function resolveEnrichReview(id, { accept = {}, reject = {} } = {}) {
  const cur = getEntity(id);
  if (!cur) throw new Error('entity not found');
  const pending = cur.data && cur.data._enrichPending;
  if (!pending || typeof pending !== 'object') return cur;

  const acceptFields = new Set(Array.isArray(accept.fields) ? accept.fields : []);
  const rejectFields = new Set(Array.isArray(reject.fields) ? reject.fields : []);
  const acceptLinks = new Set(Array.isArray(accept.links) ? accept.links : []);
  const rejectLinks = new Set(Array.isArray(reject.links) ? reject.links : []);
  // Older staged blobs may still carry chapter proposals.
  const acceptChapters = new Set(Array.isArray(accept.chapters) ? accept.chapters : []);
  const rejectChapters = new Set(Array.isArray(reject.chapters) ? reject.chapters : []);

  const nextData = { ...cur.data };
  const fields = { data: nextData };
  const nextPending = {};

  const pendingData = (pending.data && typeof pending.data === 'object') ? { ...pending.data } : {};
  for (const f of acceptFields) {
    if (!(f in pendingData)) continue;
    const proposal = pendingData[f];
    const value = proposal && typeof proposal === 'object' && 'value' in proposal ? proposal.value : proposal;
    if (f.startsWith('customFields.')) {
      const key = f.slice('customFields.'.length);
      nextData.customFields = { ...(nextData.customFields || {}), [key]: value };
    } else nextData[f] = value;
    delete pendingData[f];
  }
  for (const f of rejectFields) delete pendingData[f];
  if (Object.keys(pendingData).length) nextPending.data = pendingData;

  // Lore is a single unit: accept applies it, reject drops it, otherwise it stays staged.
  if (pending.lore != null && cur.type !== 'System') {
    if (accept.lore) {
      const proposal = pending.lore;
      fields.lore = String(proposal && typeof proposal === 'object' && 'value' in proposal ? proposal.value : proposal);
    }
    else if (!reject.lore) nextPending.lore = pending.lore;
  }

  // Links → real edges. Accept creates the edge (swapping endpoints for 'target'-anchored
  // relations, clearing prior single-valued ones); reject drops; the rest stays staged.
  if (Array.isArray(pending.links) && pending.links.length) {
    const keptLinks = [];
    for (const l of pending.links) {
      const key = enrichLinkKey(l);
      if (acceptLinks.has(key)) {
        const label = l.relType === 'related_to' ? normalizeRelationshipLabel(l.label) : l.label;
        if (l.existingLinkId) updateLink(l.existingLinkId, { label: label || null, metadata: l.metadata });
        else {
          const fromId = l.from === 'target' ? l.targetId : id;
          const toId = l.from === 'target' ? id : l.targetId;
          setLink({ workspaceId: cur.workspaceId, fromId, relType: l.relType, toId, single: !!l.single, label: label || null, metadata: l.metadata });
        }
      } else if (!rejectLinks.has(key)) {
        keptLinks.push(l);
      }
    }
    if (keptLinks.length) nextPending.links = keptLinks;
  }

  // Chapters → appended to loreDocumentIds (de-duped), with the legacy single column kept
  // in sync. Accept adds, reject drops, the rest stays staged.
  if (Array.isArray(pending.chapters) && pending.chapters.length) {
    const keptChapters = [];
    const toAdd = [];
    for (const c of pending.chapters) {
      if (acceptChapters.has(c.id)) toAdd.push(c.id);
      else if (!rejectChapters.has(c.id)) keptChapters.push(c);
    }
    if (toAdd.length) {
      const merged = [...new Set([...linkedLoreDocIds(cur), ...toAdd])];
      nextData.loreDocumentIds = merged;
      fields.loreDocumentId = merged[0] || null;
    }
    if (keptChapters.length) nextPending.chapters = keptChapters;
  }

  const evidenceIds = new Set();
  const collectEvidence = proposal => {
    if (!proposal || typeof proposal !== 'object') return;
    for (const id of (Array.isArray(proposal.evidence) ? proposal.evidence : [])) evidenceIds.add(id);
  };
  Object.values(nextPending.data || {}).forEach(collectEvidence);
  collectEvidence(nextPending.lore);
  (nextPending.links || []).forEach(collectEvidence);
  if (evidenceIds.size && pending.evidence && typeof pending.evidence === 'object') {
    nextPending.evidence = Object.fromEntries([...evidenceIds].filter(id => pending.evidence[id]).map(id => [id, pending.evidence[id]]));
  }

  if (Object.keys(nextPending).length) { nextPending.at = pending.at || Date.now(); nextData._enrichPending = nextPending; }
  else delete nextData._enrichPending;

  return updateEntity(id, fields);
}

// Map a surface mention to a canonical entity id within a workspace via case-insensitive
// exact match against canonicalName or any alias. Optional type narrows the search.
function resolveMention(mention, type = null, workspaceId = null) {
  if (!mention) return null;
  const needle = normalizeName(mention);
  if (!needle) return null;
  let rows;
  if (type) {
    rows = db.prepare('SELECT id, canonicalName, aliases FROM entities WHERE workspaceId IS ? AND type = ?').all(workspaceId || null, type);
  } else {
    rows = db.prepare('SELECT id, canonicalName, aliases FROM entities WHERE workspaceId IS ?').all(workspaceId || null);
  }
  for (const r of rows) {
    if (r.canonicalName && normalizeName(r.canonicalName) === needle) return r.id;
    if (parseJsonArray(r.aliases).some(a => normalizeName(a) === needle)) return r.id;
  }
  // Accents and typographic variants resolve only when a single entity matches.
  const folded = foldText(mention);
  const matches = rows.filter(r => [r.canonicalName, ...parseJsonArray(r.aliases)].some(name => name && foldText(name) === folded));
  return matches.length === 1 ? matches[0].id : null;
}

// Unlike resolveMention, returns every plausible match so the user can disambiguate.
function findCandidates(mention, workspaceId = null, limit = 8) {
  const needle = normalizeName(mention);
  if (!needle || needle.length < 2) return [];
  const rows = db.prepare('SELECT id, canonicalName, type, aliases FROM entities WHERE workspaceId IS ?').all(workspaceId || null);
  const out = [];
  for (const r of rows) {
    const aliases = parseJsonArray(r.aliases);
    // Score canonical name and each alias; keep the best hit and remember whether it
    // came through an alias (so the UI can show "Alias: X" for the surprising matches).
    let best = null; // { rank, matchedAlias }
    const consider = (label, isAlias) => {
      const n = normalizeName(label);
      if (!n) return;
      let rank = null;
      if (n === needle) rank = 0;
      else if (n.startsWith(needle) || needle.startsWith(n)) rank = 1;
      else if (n.includes(needle) || needle.includes(n)) rank = 2;
      if (rank === null) return;
      if (!best || rank < best.rank) best = { rank, matchedAlias: isAlias ? label : null };
    };
    consider(r.canonicalName, false);
    for (const a of aliases) consider(a, true);
    if (best) out.push({ id: r.id, canonicalName: r.canonicalName, type: r.type, rank: best.rank, matchedAlias: best.matchedAlias });
  }
  return out.sort((a, b) => a.rank - b.rank || a.canonicalName.localeCompare(b.canonicalName)).slice(0, limit);
}

// Falls back to the legacy single loreDocumentId column. A chapter deleted before its links were
// cleaned is skipped, so it never hides the chapters that still exist.
function linkedLoreDocIds(ent) {
  if (!ent) return [];
  const ids = [];
  const arr = ent.data && Array.isArray(ent.data.loreDocumentIds) ? ent.data.loreDocumentIds : null;
  if (arr) for (const id of arr) { if (id) ids.push(id); }
  else if (ent.loreDocumentId) ids.push(ent.loreDocumentId);
  const unique = [...new Set(ids)];
  if (!unique.length || !db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'documents'").get()) return unique;
  const existing = new Set(db.prepare(`SELECT id FROM documents WHERE id IN (${unique.map(() => '?').join(', ')})`).all(...unique).map(row => row.id));
  return unique.filter(id => existing.has(id));
}

function summary(row) {
  return row ? { id: row.id, canonicalName: row.canonicalName, type: row.type, data: parseJsonObject(row.data) } : null;
}

function getLinksFrom(fromId, relType = null) {
  const sql = `
    SELECT l.id AS linkId, l.relType AS relType, l.label AS label, l.metadata_json AS metadataJson, e.id AS id, e.canonicalName AS canonicalName, e.type AS type, e.data AS data
    FROM entity_links l JOIN entities e ON l.toId = e.id
    WHERE l.fromId = ?${relType ? ' AND l.relType = ?' : ''}
    ORDER BY e.canonicalName`;
  const rows = relType ? db.prepare(sql).all(fromId, relType) : db.prepare(sql).all(fromId);
  return rows.map(r => ({ linkId: r.linkId, relType: r.relType, label: r.label || null, metadata: linkMetadata(r.metadataJson), entity: summary(r) }));
}

function getLinksTo(toId, relType = null) {
  const sql = `
    SELECT l.id AS linkId, l.relType AS relType, l.label AS label, l.metadata_json AS metadataJson, e.id AS id, e.canonicalName AS canonicalName, e.type AS type, e.data AS data
    FROM entity_links l JOIN entities e ON l.fromId = e.id
    WHERE l.toId = ?${relType ? ' AND l.relType = ?' : ''}
    ORDER BY e.canonicalName`;
  const rows = relType ? db.prepare(sql).all(toId, relType) : db.prepare(sql).all(toId);
  return rows.map(r => ({ linkId: r.linkId, relType: r.relType, label: r.label || null, metadata: linkMetadata(r.metadataJson), entity: summary(r) }));
}

function listLinks({ workspaceId, relType = null } = {}) {
  const sql = `
    SELECT id, fromId, relType, toId, label, metadata_json AS metadataJson
    FROM entity_links
    WHERE workspaceId IS ?${relType ? ' AND relType = ?' : ''}
  `;
  return (relType ? db.prepare(sql).all(workspaceId || null, relType) : db.prepare(sql).all(workspaceId || null))
    .map(row => ({ ...row, metadata: linkMetadata(row.metadataJson), metadataJson: undefined }));
}

function getLink(linkId) {
  const row = db.prepare(`
    SELECT id, workspaceId, fromId, relType, toId, label, metadata_json AS metadataJson
    FROM entity_links WHERE id = ?
  `).get(linkId);
  return row ? { ...row, metadata: linkMetadata(row.metadataJson), metadataJson: undefined } : null;
}

// `single` clears existing (fromId, relType) edges first; a null toId only clears.
function setLink({ workspaceId, fromId, relType, toId, single = false, label = null, metadata = {} }) {
  if (!fromId || !relType) throw new Error('fromId and relType are required');
  if (relType === 'carried_by') throw new Error('Item type inventory entries must be managed from an inventory.');
  validateItemLink(workspaceId, fromId, relType, toId);
  if (relType === 'owned_by' || relType === 'located_in') {
    single = true;
    if (toId) {
      const counterpart = relType === 'owned_by' ? 'located_in' : 'owned_by';
      db.prepare('DELETE FROM entity_links WHERE workspaceId = ? AND fromId = ? AND relType = ?')
        .run(workspaceId, fromId, counterpart);
    }
  }
  // Belonging and having belonged are exclusive. Enforced here so every path holds it:
  // the faction sheet, an AI-proposed membership, and an imported package alike.
  if ((relType === 'member_of' || relType === 'former_member_of') && toId) {
    const counterpart = relType === 'member_of' ? 'former_member_of' : 'member_of';
    db.prepare('DELETE FROM entity_links WHERE workspaceId = ? AND fromId = ? AND relType = ? AND toId = ?')
      .run(workspaceId, fromId, counterpart, toId);
  }
  const cleanLabel = label != null && String(label).trim() ? String(label).trim() : null;
  if (single) db.prepare('DELETE FROM entity_links WHERE fromId = ? AND relType = ?').run(fromId, relType);
  if (!toId) return { cleared: true };
  if (!single) {
    // For labeled relations, the same pair can hold distinct labels, dedup on (pair, label).
    const exists = db.prepare("SELECT id FROM entity_links WHERE fromId = ? AND relType = ? AND toId = ? AND IFNULL(label, '') = ?")
      .get(fromId, relType, toId, cleanLabel || '');
    if (exists) return { id: exists.id };
  }
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO entity_links (id, workspaceId, fromId, relType, toId, label, metadata_json, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(id, workspaceId || null, fromId, relType, toId, cleanLabel, JSON.stringify(metadata || {}), Date.now());
  relationshipChanged({ workspaceId, fromId, relType, toId });
  return { id };
}

function setInventoryLink({ workspaceId, itemId, holderId, metadata = {} }) {
  const item = getEntity(itemId);
  const holder = getEntity(holderId);
  if (!item || item.workspaceId !== workspaceId || item.type !== 'Items') throw new Error('Inventory item was not found.');
  if (!holder || holder.workspaceId !== workspaceId || !['Characters', 'Creatures'].includes(holder.type)) throw new Error('Inventory holder was not found.');
  if (holder.type === 'Creatures' && (holder.data?.scope || 'individual') === 'group') throw new Error('Creature groups cannot have an inventory.');
  const isUnique = item.data?.itemNature === 'unique';
  const relType = isUnique ? 'owned_by' : 'carried_by';
  const quantity = isUnique ? 1 : positiveQuantity(metadata.quantity);
  return db.transaction(() => {
    if (isUnique) {
      db.prepare("DELETE FROM entity_links WHERE workspaceId = ? AND fromId = ? AND relType IN ('owned_by', 'located_in')")
        .run(workspaceId, itemId);
    }
    const existing = db.prepare('SELECT id FROM entity_links WHERE workspaceId = ? AND fromId = ? AND relType = ? AND toId = ?')
      .get(workspaceId, itemId, relType, holderId);
    const nextMetadata = { ...metadata, quantity };
    if (existing) {
      db.prepare('UPDATE entity_links SET metadata_json = ? WHERE id = ?').run(JSON.stringify(nextMetadata), existing.id);
      return { id: existing.id };
    }
    const id = crypto.randomUUID();
    db.prepare('INSERT INTO entity_links (id, workspaceId, fromId, relType, toId, label, metadata_json, createdAt) VALUES (?, ?, ?, ?, ?, NULL, ?, ?)')
      .run(id, workspaceId, itemId, relType, holderId, JSON.stringify(nextMetadata), Date.now());
    return { id };
  })();
}

function validateItemLink(workspaceId, fromId, relType, toId) {
  if (!['owned_by', 'located_in', 'found_in', 'sold_in'].includes(relType)) return;
  const item = getEntity(fromId);
  if (!item || item.workspaceId !== workspaceId || item.type !== 'Items') return;
  const isUnique = item.data?.itemNature === 'unique';
  if (relType === 'owned_by' && !isUnique) throw new Error('Item types do not have a fixed owner. Add them from a character inventory.');
  if (relType === 'located_in' && !isUnique) throw new Error('Only unique items have one current world location.');
  if ((relType === 'found_in' || relType === 'sold_in') && isUnique) throw new Error('Unique items use one current location instead of availability lists.');
  if (toId && relType === 'owned_by') {
    const holder = getEntity(toId);
    if (!holder || !['Characters', 'Creatures'].includes(holder.type)) throw new Error('A unique item owner must be an individual character or creature.');
  }
}

function positiveQuantity(value) {
  const quantity = Number(value);
  return Number.isFinite(quantity) ? Math.max(1, Math.round(quantity)) : 1;
}

// A relationship lives in the narrative ledger; every sheet edit to one is reported so the ledger follows.
const relationshipListeners = new Set();
function onRelationshipChanged(listener) {
  relationshipListeners.add(listener);
  return () => relationshipListeners.delete(listener);
}

function relationshipChanged(link) {
  if (!link || link.relType !== 'related_to' || !link.workspaceId || !link.toId) return;
  for (const listener of relationshipListeners) listener({ workspaceId: link.workspaceId, fromId: link.fromId, toId: link.toId });
}

function linkRow(linkId) {
  return db.prepare('SELECT workspaceId, fromId, relType, toId FROM entity_links WHERE id = ?').get(linkId);
}

function removeLink(linkId) {
  const link = linkRow(linkId);
  db.prepare('DELETE FROM entity_links WHERE id = ?').run(linkId);
  relationshipChanged(link);
  return { id: linkId };
}

function updateLinkLabel(linkId, label) {
  const clean = label != null && String(label).trim() ? String(label).trim() : null;
  db.prepare('UPDATE entity_links SET label = ? WHERE id = ?').run(clean, linkId);
  relationshipChanged(linkRow(linkId));
  return { id: linkId, label: clean };
}

function updateLink(linkId, { toId, label, metadata } = {}) {
  const current = db.prepare('SELECT toId, label, metadata_json AS metadataJson FROM entity_links WHERE id = ?').get(linkId);
  if (!current) throw new Error('entity link not found');
  const cleanLabel = label === undefined
    ? current.label
    : label != null && String(label).trim() ? String(label).trim() : null;
  const nextMetadata = metadata === undefined ? linkMetadata(current.metadataJson) : metadata || {};
  const nextToId = toId === undefined ? current.toId : toId;
  if (!nextToId || !db.prepare('SELECT 1 FROM entities WHERE id = ?').get(nextToId)) throw new Error('target entity not found');
  const before = linkRow(linkId);
  db.prepare('UPDATE entity_links SET toId = ?, label = ?, metadata_json = ? WHERE id = ?')
    .run(nextToId, cleanLabel, JSON.stringify(nextMetadata), linkId);
  if (before.toId !== nextToId) relationshipChanged(before);
  relationshipChanged(linkRow(linkId));
  return { id: linkId, toId: nextToId, label: cleanLabel, metadata: nextMetadata };
}

// Chapter links and staged proposals are dropped: they only mean something in this workspace.
function exportWorldbuild(workspaceId) {
  const rows = db.prepare('SELECT * FROM entities WHERE workspaceId IS ? AND status != ?').all(workspaceId || null, 'proposed');
  const ids = new Set(rows.map(r => r.id));
  const entities = rows.map(r => ({
    ref: r.id,
    type: r.type,
    canonicalName: r.canonicalName,
    aliases: parseJsonArray(r.aliases),
    lore: r.lore || '',
    data: stripInternal(parseJsonObject(r.data)),
    status: r.status || 'confirmed',
  }));
  const linkRows = db.prepare('SELECT fromId, toId, relType, label, metadata_json AS metadataJson FROM entity_links WHERE workspaceId IS ?').all(workspaceId || null);
  const links = linkRows
    .filter(l => ids.has(l.fromId) && ids.has(l.toId))
    .map(l => ({ fromRef: l.fromId, toRef: l.toId, relType: l.relType, label: l.label || null, metadata: linkMetadata(l.metadataJson) }));
  return { kallamoWorldbuild: 1, exportedAt: Date.now(), entities, links };
}

// No de-dupe by name: a same-named entity is not assumed to be the same one.
// Everything lands as `proposed` for the user to review.
function importWorldbuild(workspaceId, payload) {
  if (!payload || payload.kallamoWorldbuild !== 1 || !Array.isArray(payload.entities)) {
    throw new Error('Not a valid Kallamo Worldbuild file.');
  }
  const idMap = new Map();
  let entitiesAdded = 0, linksAdded = 0;
  db.transaction(() => {
    for (const e of payload.entities) {
      if (!e || !e.type || !e.canonicalName) continue;
      const data = stripInternal((e.data && typeof e.data === 'object' && !Array.isArray(e.data)) ? e.data : {});
      data._imported = true;
      const created = createEntity({
        workspaceId, type: e.type, canonicalName: e.canonicalName,
        aliases: Array.isArray(e.aliases) ? e.aliases : [],
        lore: e.lore || '', data, status: 'proposed',
      });
      idMap.set(e.ref, created.id);
      entitiesAdded++;
    }
    for (const l of (Array.isArray(payload.links) ? payload.links : [])) {
      if (!l || !l.relType) continue;
      const fromId = idMap.get(l.fromRef);
      const toId = idMap.get(l.toRef);
      if (!fromId || !toId || fromId === toId) continue;
      if (l.relType === 'carried_by') setInventoryLink({ workspaceId, itemId: fromId, holderId: toId, metadata: l.metadata || {} });
      else setLink({ workspaceId, fromId, relType: l.relType, toId, single: false, label: l.label || null, metadata: l.metadata || {} });
      linksAdded++;
    }
  })();
  return { entitiesAdded, linksAdded, idMap };
}

function bulkEntityRows(workspaceId, ids) {
  const uniqueIds = [...new Set((Array.isArray(ids) ? ids : []).map(String).filter(Boolean))];
  if (!uniqueIds.length) return [];
  const placeholders = uniqueIds.map(() => '?').join(', ');
  return db.prepare(`SELECT * FROM entities WHERE workspaceId IS ? AND id IN (${placeholders})`)
    .all(workspaceId || null, ...uniqueIds)
    .map(hydrate);
}

function summarizeBulkEntities(workspaceId, ids) {
  const rows = bulkEntityRows(workspaceId, ids);
  if (!rows.length) return { entities: 0, proposed: 0, pendingUpdates: 0, pendingFields: 0, pendingLore: 0, pendingLinks: 0, relationships: 0, storyTags: 0, narrativeRecords: 0, knowledgeCards: 0, sceneState: 0 };
  const placeholders = rows.map(() => '?').join(', ');
  const rowIds = rows.map(row => row.id);
  const relationships = db.prepare(`SELECT COUNT(*) AS count FROM entity_links WHERE fromId IN (${placeholders}) OR toId IN (${placeholders})`)
    .get(...rowIds, ...rowIds).count;
  const storyTags = db.prepare(`SELECT COUNT(*) AS count FROM chunk_tags WHERE entity IN (${placeholders})`).get(...rowIds).count;
  const pending = rows.filter(row => row.status !== 'proposed' && row.data?._enrichPending).map(row => ({ type: row.type, proposal: row.data._enrichPending }));
  return {
    entities: rows.length,
    proposed: rows.filter(row => row.status === 'proposed').length,
    pendingUpdates: pending.length,
    pendingFields: pending.reduce((count, entry) => count + Object.keys(entry.proposal.data || {}).length, 0),
    pendingLore: pending.filter(entry => entry.type !== 'System' && entry.proposal.lore != null).length,
    pendingLinks: pending.reduce((count, entry) => count + (entry.proposal.links || []).length, 0),
    relationships,
    storyTags,
    ...countEntityReferences(db, workspaceId, rowIds),
  };
}

function bulkSetAiPolicy(workspaceId, ids, policy) {
  if (!['open', 'review', 'locked'].includes(policy)) throw new Error('invalid AI policy');
  const rows = bulkEntityRows(workspaceId, ids);
  let updated = 0, skipped = 0;
  db.transaction(() => {
    for (const row of rows) {
      if (row.status === 'proposed') { skipped++; continue; }
      updateEntity(row.id, { data: { ...(row.data || {}), aiPolicy: policy } });
      updated++;
    }
  })();
  return { updated, skipped };
}

function bulkAcceptProposed(workspaceId, ids) {
  const rows = bulkEntityRows(workspaceId, ids);
  let accepted = 0, skipped = 0;
  db.transaction(() => {
    for (const row of rows) {
      if (row.status !== 'proposed') { skipped++; continue; }
      updateEntity(row.id, { status: 'confirmed', data: { ...(row.data || {}), _imported: undefined } });
      accepted++;
    }
  })();
  return { accepted, skipped };
}

function bulkAcceptEnrichUpdates(workspaceId, ids) {
  const rows = bulkEntityRows(workspaceId, ids);
  let accepted = 0, fields = 0, lore = 0, links = 0, chapters = 0, skipped = 0;
  db.transaction(() => {
    for (const row of rows) {
      const pending = row.status !== 'proposed' ? row.data?._enrichPending : null;
      if (!pending) { skipped++; continue; }
      const fieldKeys = Object.keys(pending.data || {});
      const linkKeys = (pending.links || []).map(enrichLinkKey);
      const chapterIds = (pending.chapters || []).map(chapter => chapter.id);
      const hasLore = row.type !== 'System' && pending.lore != null;
      resolveEnrichReview(row.id, {
        accept: { fields: fieldKeys, lore: hasLore, links: linkKeys, chapters: chapterIds },
        reject: {},
      });
      fields += fieldKeys.length;
      lore += hasLore ? 1 : 0;
      links += linkKeys.length;
      chapters += chapterIds.length;
      accepted++;
    }
  })();
  return { accepted, fields, lore, links, chapters, skipped };
}

function bulkDeleteEntities(workspaceId, ids) {
  const rows = bulkEntityRows(workspaceId, ids);
  const summary = summarizeBulkEntities(workspaceId, rows.map(row => row.id));
  db.transaction(() => { for (const row of rows) deleteEntity(row.id); })();
  return { deleted: rows.length, ...summary };
}

function bulkRejectProposed(workspaceId, ids) {
  const rows = bulkEntityRows(workspaceId, ids);
  let rejected = 0, skipped = 0;
  db.transaction(() => {
    for (const row of rows) {
      if (row.status !== 'proposed') { skipped++; continue; }
      deleteEntity(row.id);
      rejected++;
    }
  })();
  return { rejected, skipped };
}

function bulkRejectEnrichUpdates(workspaceId, ids) {
  const rows = bulkEntityRows(workspaceId, ids);
  let rejected = 0, fields = 0, lore = 0, links = 0, chapters = 0, skipped = 0;
  db.transaction(() => {
    for (const row of rows) {
      if (row.status === 'proposed') { skipped++; continue; }
      const result = discardEnrichPending(row.data);
      if (!result) { skipped++; continue; }
      updateEntity(row.id, { data: result.data });
      fields += result.fields;
      lore += row.type === 'System' ? 0 : result.lore;
      links += result.links;
      chapters += result.chapters;
      rejected++;
    }
  })();
  return { rejected, fields, lore, links, chapters, skipped };
}

function resetEntityEnrichmentProgress(workspaceId, ids) {
  const rows = bulkEntityRows(workspaceId, ids).filter(row => row.status !== 'proposed');
  if (!rows.length) return { reset: 0 };
  const placeholders = rows.map(() => '?').join(', ');
  const rowIds = rows.map(row => row.id);
  db.transaction(() => {
    db.prepare(`DELETE FROM entity_enrichment_chunks WHERE entityId IN (${placeholders})`).run(...rowIds);
    db.prepare(`DELETE FROM entity_update_evidence WHERE workspace_id = ? AND entity_id IN (${placeholders})`).run(workspaceId, ...rowIds);
    db.prepare(`DELETE FROM entity_enrichment_errors WHERE workspaceId = ? AND entityId IN (${placeholders})`).run(workspaceId, ...rowIds);
  })();
  return { reset: rows.length };
}

module.exports = {
  listEntities,
  getEntity,
  exportWorldbuild,
  importWorldbuild,
  createEntity,
  updateEntity,
  deleteEntity,
  mergeEntity,
  resolveEnrichReview,
  resolveMention,
  findCandidates,
  normalizeName,
  linkedLoreDocIds,
  updateEntityFromEditor,
  getLinksFrom,
  getLinksTo,
  listLinks,
  getLink,
  setLink,
  setInventoryLink,
  removeLink,
  updateLinkLabel,
  updateLink,
  onRelationshipChanged,
  summarizeBulkEntities,
  bulkSetAiPolicy,
  bulkAcceptProposed,
  bulkAcceptEnrichUpdates,
  bulkDeleteEntities,
  bulkRejectProposed,
  bulkRejectEnrichUpdates,
  resetEntityEnrichmentProgress,
};
