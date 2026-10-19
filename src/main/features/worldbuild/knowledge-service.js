const crypto = require('crypto');

const SOURCE_TYPES = new Set([
  'manual', 'relationship', 'faction-membership', 'inventory',
  'memory', 'narrative', 'fact', 'statement', 'import',
]);
const NATIVE_FIELDS = {
  Characters: ['status', 'age', 'appearance', 'personality'],
  Creatures: ['status', 'disposition', 'nature', 'abundance', 'threat', 'abilities', 'appearance', 'personality'],
  Locations: ['locationType', 'description'],
  Items: ['itemType', 'abundance', 'description'],
  Factions: ['description'],
  Races: ['description'],
  Events: ['kind', 'description'],
  System: ['content'],
};
const KNOWABLE_RELATION_TYPES = new Set([
  'inside',
  'led_by',
  'member_of',
  'former_member_of',
  'operates_in',
  'owned_by',
  'located_in',
  'created_by',
  'found_in',
  'sold_in',
  'is_race',
  'connected_to',
  'adjacent_to',
  'related_to',
]);
// carried_by is left out: it changes with every pick-up, so knowing it would be stale by the next
// scene. owned_by is the durable half.

// A related_to edge is one side's own view with its own title, so it is only knowable from the
// entity it starts from.
const PERSPECTIVE_RELATION_TYPES = new Set(['related_to']);

function isKnowableForTarget(relation, targetId) {
  if (!KNOWABLE_RELATION_TYPES.has(relation.relationType)) return false;
  return !PERSPECTIVE_RELATION_TYPES.has(relation.relationType) || relation.fromId === targetId;
}

function createWorldbuildKnowledgeService(db) {
  // Card reads run per card on every sheet and per link on every reconcile, so the
  // statements on that path are compiled once.
  const statements = new Map();
  const cached = sql => {
    let statement = statements.get(sql);
    if (!statement) {
      statement = db.prepare(sql);
      statements.set(sql, statement);
    }
    return statement;
  };

  const insertCard = db.prepare(`
    INSERT INTO worldbuild_knowledge_cards (
      workspace_id, card_id, owner_id, target_id, known_as,
      status, audience_type, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 'active', ?, ?, ?)
    ON CONFLICT (workspace_id, owner_id, target_id) DO UPDATE SET
      status = 'active',
      known_as = COALESCE(excluded.known_as, worldbuild_knowledge_cards.known_as),
      updated_at = excluded.updated_at
    RETURNING card_id
  `);
  const insertSource = db.prepare(`
    INSERT OR IGNORE INTO worldbuild_knowledge_sources (
      workspace_id, card_id, source_type, source_id, created_at
    ) VALUES (?, ?, ?, ?, ?)
  `);

  function ensureAwareness(input = {}) {
    const { workspaceId, ownerId, targetId } = grantAwareness(input);
    return getCard(workspaceId, ownerId, targetId);
  }

  // The write half of ensureAwareness. Reconcile calls it per link and never reads the card.
  function grantAwareness(input) {
    const workspaceId = requireText(input.workspaceId, 'workspaceId');
    const ownerId = requireText(input.ownerId, 'ownerId');
    const targetId = requireText(input.targetId, 'targetId');
    const sourceType = SOURCE_TYPES.has(input.sourceType) ? input.sourceType : null;
    if (!sourceType) throw new Error('Unsupported Knowledge source type.');
    const sourceId = requireText(input.sourceId, 'sourceId');
    const excluded = cached(`
      SELECT 1 FROM worldbuild_knowledge_exclusions
      WHERE workspace_id = ? AND owner_id = ? AND target_id = ?
        AND source_type = ? AND source_id = ?
    `).get(workspaceId, ownerId, targetId, sourceType, sourceId);
    if (!excluded) {
      db.transaction(() => {
        const now = Date.now();
        const row = insertCard.get(
          workspaceId, crypto.randomUUID(), ownerId, targetId,
          cleanOptionalText(input.knownAs),
          input.audienceType === 'selected-members' ? 'selected-members' : 'all-members',
          now, now,
        );
        insertSource.run(workspaceId, row.card_id, sourceType, sourceId, now);
        persistTemporalAwareness({
          workspaceId, ownerId, targetId, sourceType, sourceId, status: 'active',
        });
      })();
    }
    return { workspaceId, ownerId, targetId };
  }

  function listCards(workspaceId, ownerId) {
    const projectId = requireText(workspaceId, 'workspaceId');
    const subjectId = requireText(ownerId, 'ownerId');
    reconcileWorkspace(projectId);
    const rows = hasTable(db, 'entities') ? cached(`
      SELECT cards.*, entities.canonicalName AS target_name, entities.type AS target_type,
        entities.data AS target_data
      FROM worldbuild_knowledge_cards cards
      LEFT JOIN entities ON entities.id = cards.target_id AND entities.workspaceId = cards.workspace_id
      WHERE cards.workspace_id = ? AND cards.owner_id = ? AND cards.status = 'active'
      ORDER BY COALESCE(entities.canonicalName, cards.known_as, cards.target_id) COLLATE NOCASE
    `).all(projectId, subjectId) : cached(`
      SELECT cards.*, NULL AS target_name, NULL AS target_type, NULL AS target_data
      FROM worldbuild_knowledge_cards cards
      WHERE cards.workspace_id = ? AND cards.owner_id = ? AND cards.status = 'active'
      ORDER BY COALESCE(cards.known_as, cards.target_id) COLLATE NOCASE
    `).all(projectId, subjectId);
    return rows.map(hydrateCard);
  }

  function getCard(workspaceId, ownerId, targetId) {
    const row = hasTable(db, 'entities') ? cached(`
      SELECT cards.*, entities.canonicalName AS target_name, entities.type AS target_type,
        entities.data AS target_data
      FROM worldbuild_knowledge_cards cards
      LEFT JOIN entities ON entities.id = cards.target_id AND entities.workspaceId = cards.workspace_id
      WHERE cards.workspace_id = ? AND cards.owner_id = ? AND cards.target_id = ?
    `).get(workspaceId, ownerId, targetId) : cached(`
      SELECT cards.*, NULL AS target_name, NULL AS target_type, NULL AS target_data
      FROM worldbuild_knowledge_cards cards
      WHERE cards.workspace_id = ? AND cards.owner_id = ? AND cards.target_id = ?
    `).get(workspaceId, ownerId, targetId);
    return row ? hydrateCard(row) : null;
  }

  function setKnownFields(input = {}) {
    const card = getRequiredCard(input.workspaceId, input.ownerId, input.targetId);
    const fieldKeys = normalizeIds(input.fieldKeys);
    const sourceType = SOURCE_TYPES.has(input.sourceType) ? input.sourceType : 'manual';
    const sourceId = String(input.sourceId || card.cardId);
    db.transaction(() => {
      db.prepare('DELETE FROM worldbuild_known_fields WHERE workspace_id = ? AND card_id = ?')
        .run(card.workspaceId, card.cardId);
      const insert = db.prepare(`
        INSERT INTO worldbuild_known_fields (
          workspace_id, card_id, field_key, source_type, source_id, audience_type, created_at
        ) VALUES (?, ?, ?, ?, ?, 'inherit', ?)
      `);
      const now = Date.now();
      for (const key of fieldKeys) insert.run(card.workspaceId, card.cardId, key, sourceType, sourceId, now);
      db.prepare('UPDATE worldbuild_knowledge_cards SET updated_at = ? WHERE workspace_id = ? AND card_id = ?')
        .run(now, card.workspaceId, card.cardId);
    })();
    return getCard(card.workspaceId, card.ownerId, card.targetId);
  }

  function markCurrentFieldsKnown(input = {}) {
    const card = getRequiredCard(input.workspaceId, input.ownerId, input.targetId);
    const data = parseObject(db.prepare(
      'SELECT data FROM entities WHERE workspaceId = ? AND id = ?'
    ).get(card.workspaceId, card.targetId)?.data);
    const definitions = db.prepare(`
      SELECT field_key FROM worldbuild_field_definitions
      WHERE workspace_id = ? AND type_id = ? AND ai_access != 'hidden'
    `).all(card.workspaceId, card.targetType);
    const native = (NATIVE_FIELDS[card.targetType] || [])
      .filter(key => hasFilledValue(data[key]));
    const eligible = [
      ...native,
      ...definitions
        .map(row => `customFields.${row.field_key}`)
        .filter(key => hasFilledValue(data.customFields?.[key.slice('customFields.'.length)])),
    ];
    return setKnownFields({ ...input, fieldKeys: eligible, sourceType: 'manual', sourceId: card.cardId });
  }

  function setKnownRelationships(input = {}) {
    const card = getRequiredCard(input.workspaceId, input.ownerId, input.targetId);
    const relationshipIds = normalizeIds(input.relationshipIds);
    const existing = db.prepare(`
      SELECT relationship_id
      FROM worldbuild_known_relationships
      WHERE workspace_id = ? AND card_id = ?
    `).all(card.workspaceId, card.cardId);
    const current = relationshipIds.length ? db.prepare(`
      SELECT links.id, links.fromId, links.relType, links.toId, links.label,
        links.metadata_json AS metadataJson,
        source.canonicalName AS fromName, target.canonicalName AS toName
      FROM entity_links links
      JOIN entities source ON source.workspaceId = links.workspaceId AND source.id = links.fromId
      JOIN entities target ON target.workspaceId = links.workspaceId AND target.id = links.toId
      WHERE links.workspaceId = ?
        AND links.id IN (${relationshipIds.map(() => '?').join(', ')})
        AND (links.fromId = ? OR links.toId = ?)
    `).all(card.workspaceId, ...relationshipIds, card.targetId, card.targetId) : [];
    const currentById = new Map(current.map(row => [row.id, row]));
    const knownIds = new Set(existing.map(row => row.relationship_id));
    for (const relationshipId of relationshipIds) {
      const row = currentById.get(relationshipId);
      const knowable = row && isKnowableForTarget({ relationType: row.relType, fromId: row.fromId }, card.targetId);
      if (!knownIds.has(relationshipId) && !knowable) {
        throw new Error('A selected relationship is unavailable for this Knowledge card.');
      }
    }

    db.transaction(() => {
      if (relationshipIds.length) {
        db.prepare(`
          DELETE FROM worldbuild_known_relationships
          WHERE workspace_id = ? AND card_id = ?
            AND relationship_id NOT IN (${relationshipIds.map(() => '?').join(', ')})
        `).run(card.workspaceId, card.cardId, ...relationshipIds);
      } else {
        db.prepare(`
          DELETE FROM worldbuild_known_relationships
          WHERE workspace_id = ? AND card_id = ?
        `).run(card.workspaceId, card.cardId);
      }
      const insert = db.prepare(`
        INSERT OR IGNORE INTO worldbuild_known_relationships (
          workspace_id, card_id, relationship_id,
          from_id, from_name, relation_type, relation_label,
          to_id, to_name, metadata_json,
          source_type, source_id, audience_type, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, 'inherit', ?)
      `);
      const now = Date.now();
      for (const relationshipId of relationshipIds) {
        const row = currentById.get(relationshipId);
        if (!row) continue;
        insert.run(
          card.workspaceId, card.cardId, row.id,
          row.fromId, row.fromName, row.relType, null,
          row.toId, row.toName, null,
          row.id, now,
        );
        const counterpartId = row.fromId === card.targetId ? row.toId : row.fromId;
        if (counterpartId !== card.ownerId) {
          ensureAwareness({
            workspaceId: card.workspaceId,
            ownerId: card.ownerId,
            targetId: counterpartId,
            sourceType: 'relationship',
            sourceId: `known:${card.cardId}:${row.id}`,
          });
        }
      }
      db.prepare(`
        UPDATE worldbuild_knowledge_cards SET updated_at = ?
        WHERE workspace_id = ? AND card_id = ?
      `).run(now, card.workspaceId, card.cardId);
    })();
    return getCard(card.workspaceId, card.ownerId, card.targetId);
  }

  function removeCard(input = {}) {
    const card = getRequiredCard(input.workspaceId, input.ownerId, input.targetId);
    const sources = db.prepare(`
      SELECT source_type, source_id FROM worldbuild_knowledge_sources
      WHERE workspace_id = ? AND card_id = ?
    `).all(card.workspaceId, card.cardId);
    db.transaction(() => {
      const exclude = db.prepare(`
        INSERT OR IGNORE INTO worldbuild_knowledge_exclusions (
          workspace_id, owner_id, target_id, source_type, source_id, created_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);
      const now = Date.now();
      for (const source of sources) {
        exclude.run(card.workspaceId, card.ownerId, card.targetId, source.source_type, source.source_id, now);
      }
      db.prepare(`
        UPDATE worldbuild_knowledge_cards SET status = 'revoked', updated_at = ?
        WHERE workspace_id = ? AND card_id = ?
      `).run(now, card.workspaceId, card.cardId);
      persistTemporalAwareness({
        workspaceId: card.workspaceId,
        ownerId: card.ownerId,
        targetId: card.targetId,
        sourceType: 'manual',
        sourceId: `remove:${card.cardId}:${now}`,
        status: 'revoked',
      });
    })();
    return null;
  }

  function setAudience(input = {}) {
    const card = getRequiredCard(input.workspaceId, input.ownerId, input.targetId);
    const audienceType = input.audienceType === 'selected-members' ? 'selected-members' : 'all-members';
    // An audience only means something for people the roster still holds: every reader of
    // a shared card reaches it through member_of. Someone who has left is dropped rather
    // than rejected, since a departure must not make an unrelated audience edit fail.
    const roster = currentMemberIds(card.workspaceId, card.ownerId);
    const memberIds = normalizeIds(input.memberIds).filter(memberId => !roster || roster.has(memberId));
    db.transaction(() => {
      db.prepare(`
        UPDATE worldbuild_knowledge_cards SET audience_type = ?, updated_at = ?
        WHERE workspace_id = ? AND card_id = ?
      `).run(audienceType, Date.now(), card.workspaceId, card.cardId);
      // Sharing with everyone leaves the named list alone rather than emptying it: every
      // reader already ignores it while the card is open to all members, and keeping it
      // means switching back restores the choice instead of asking for it again.
      if (audienceType !== 'selected-members') return;
      db.prepare(`
        DELETE FROM worldbuild_knowledge_audience_members
        WHERE workspace_id = ? AND card_id = ? AND entry_type = 'card' AND entry_id = ?
      `).run(card.workspaceId, card.cardId, card.cardId);
      const insert = db.prepare(`
        INSERT INTO worldbuild_knowledge_audience_members (
          workspace_id, card_id, entry_type, entry_id, member_id
        ) VALUES (?, ?, 'card', ?, ?)
      `);
      for (const memberId of memberIds) insert.run(card.workspaceId, card.cardId, card.cardId, memberId);
    })();
    return getCard(card.workspaceId, card.ownerId, card.targetId);
  }

  function reconcileWorkspace(workspaceId) {
    const projectId = requireText(workspaceId, 'workspaceId');
    pruneUnknowableRelationships(projectId);
    if (!hasTable(db, 'entity_links')) return;
    const links = cached(`
      SELECT id, fromId, relType, toId
      FROM entity_links
      WHERE workspaceId = ?
        AND relType IN ('related_to', 'member_of', 'former_member_of', 'owned_by', 'carried_by')
    `).all(projectId);
    const grants = [];
    for (const link of links) {
      if (link.relType === 'related_to') {
        grants.push({
          workspaceId: projectId, ownerId: link.fromId, targetId: link.toId,
          sourceType: 'relationship', sourceId: link.id,
        });
      } else if (link.relType === 'member_of' || link.relType === 'former_member_of') {
        grants.push({
          workspaceId: projectId, ownerId: link.fromId, targetId: link.toId,
          sourceType: 'faction-membership', sourceId: link.id,
        });
        grants.push({
          workspaceId: projectId, ownerId: link.toId, targetId: link.fromId,
          sourceType: 'faction-membership', sourceId: link.id,
          audienceType: 'all-members',
        });
      } else {
        grants.push({
          workspaceId: projectId, ownerId: link.toId, targetId: link.fromId,
          sourceType: 'inventory', sourceId: link.id,
        });
      }
    }
    // Reconcile runs on every read, and almost every grant already holds. Granting again
    // would only move updated_at, so only the grants that would change something are written.
    const settled = settledGrantKeys(projectId);
    const pending = grants.filter(grant => !settled.has(grantKey(grant)));
    if (!pending.length) return;
    db.transaction(() => {
      for (const grant of pending) grantAwareness(grant);
    })();
  }

  // Grants that write nothing when repeated: excluded ones, and ones whose card is active,
  // whose source is recorded and whose latest awareness is active.
  function settledGrantKeys(workspaceId) {
    const keys = new Set();
    for (const row of cached(`
      SELECT owner_id, target_id, source_type, source_id
      FROM worldbuild_knowledge_exclusions WHERE workspace_id = ?
    `).all(workspaceId)) keys.add(grantKey(rowGrant(row)));
    const tracksAwareness = hasTable(db, 'narrative_awareness_records') && hasTable(db, 'narrative_events');
    const aware = new Set();
    if (tracksAwareness) {
      for (const row of cached(`
        SELECT records.subject_id, records.target_id, records.payload_json
        FROM narrative_awareness_records records
        WHERE records.workspace_id = ? AND records.rowid = (
          SELECT MAX(latest.rowid) FROM narrative_awareness_records latest
          WHERE latest.workspace_id = records.workspace_id
            AND latest.subject_id = records.subject_id
            AND latest.target_id = records.target_id
        )
      `).all(workspaceId)) {
        if (parseObject(row.payload_json).status === 'active') aware.add(pairKey(row.subject_id, row.target_id));
      }
    }
    for (const row of cached(`
      SELECT cards.owner_id, cards.target_id, sources.source_type, sources.source_id
      FROM worldbuild_knowledge_cards cards
      JOIN worldbuild_knowledge_sources sources
        ON sources.workspace_id = cards.workspace_id AND sources.card_id = cards.card_id
      WHERE cards.workspace_id = ? AND cards.status = 'active'
    `).all(workspaceId)) {
      if (!tracksAwareness || aware.has(pairKey(row.owner_id, row.target_id))) keys.add(grantKey(rowGrant(row)));
    }
    return keys;
  }

  function hydrateCard(row) {
    const knownFields = cached(`
      SELECT field_key, source_type, source_id, audience_type
      FROM worldbuild_known_fields WHERE workspace_id = ? AND card_id = ?
      ORDER BY created_at, field_key
    `).all(row.workspace_id, row.card_id);
    const sources = cached(`
      SELECT source_type, source_id, created_at
      FROM worldbuild_knowledge_sources WHERE workspace_id = ? AND card_id = ?
      ORDER BY created_at, source_type, source_id
    `).all(row.workspace_id, row.card_id);
    const selectedMembers = cached(`
      SELECT member_id FROM worldbuild_knowledge_audience_members
      WHERE workspace_id = ? AND card_id = ? AND entry_type = 'card' AND entry_id = ?
      ORDER BY member_id
    `).all(row.workspace_id, row.card_id, row.card_id);
    const knownRelationships = cached(`
      SELECT relationship_id AS relationshipId,
        from_id AS fromId, from_name AS fromName,
        relation_type AS relationType, relation_label AS relationLabel,
        to_id AS toId, to_name AS toName, metadata_json AS metadataJson,
        created_at AS createdAt
      FROM worldbuild_known_relationships
      WHERE workspace_id = ? AND card_id = ?
      ORDER BY created_at, from_name, to_name
    `).all(row.workspace_id, row.card_id)
      .filter(relationship => isKnowableForTarget(relationship, row.target_id))
      .map(hydrateRelationship);
    const availableRelationships = hasTable(db, 'entity_links') && hasTable(db, 'entities')
      ? cached(`
        SELECT links.id AS relationshipId,
          links.fromId, source.canonicalName AS fromName,
          links.relType AS relationType, links.label AS relationLabel,
          links.toId, target.canonicalName AS toName,
          links.metadata_json AS metadataJson, links.createdAt
        FROM entity_links links
        JOIN entities source ON source.workspaceId = links.workspaceId AND source.id = links.fromId
        JOIN entities target ON target.workspaceId = links.workspaceId AND target.id = links.toId
        WHERE links.workspaceId = ? AND (links.fromId = ? OR links.toId = ?)
        ORDER BY links.createdAt, source.canonicalName, target.canonicalName
      `).all(row.workspace_id, row.target_id, row.target_id)
        .filter(relationship => isKnowableForTarget(relationship, row.target_id))
        .map(hydrateRelationship)
      : [];
    return {
      workspaceId: row.workspace_id,
      cardId: row.card_id,
      ownerId: row.owner_id,
      targetId: row.target_id,
      targetName: row.target_name || row.known_as || row.target_id,
      targetType: row.target_type || '',
      knownAs: row.known_as || undefined,
      status: row.status,
      audienceType: row.audience_type,
      selectedMemberIds: selectedMembers.map(member => member.member_id),
      knownFieldKeys: knownFields.map(field => field.field_key),
      knownFields,
      knownRelationships,
      availableRelationships,
      sources: sources.map(source => ({
        sourceType: source.source_type,
        sourceId: source.source_id,
        createdAt: source.created_at,
      })),
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Rows the rules do not consider knowable. Filtering at read time is not enough: chat-context
   * reads worldbuild_known_relationships directly.
   */
  function pruneUnknowableRelationships(workspaceId) {
    const knowable = [...KNOWABLE_RELATION_TYPES];
    const perspective = [...PERSPECTIVE_RELATION_TYPES];
    db.prepare(`
      DELETE FROM worldbuild_known_relationships
      WHERE workspace_id = ?
        AND (
          relation_type NOT IN (${knowable.map(() => '?').join(', ')})
          OR (
            relation_type IN (${perspective.map(() => '?').join(', ')})
            AND from_id IS NOT (
              SELECT target_id FROM worldbuild_knowledge_cards cards
              WHERE cards.workspace_id = worldbuild_known_relationships.workspace_id
                AND cards.card_id = worldbuild_known_relationships.card_id
            )
          )
        )
    `).run(workspaceId, ...knowable, ...perspective);
  }

  /** Who belongs to a group right now, or null when links are not part of this database. */
  function currentMemberIds(workspaceId, factionId) {
    if (!hasTable(db, 'entity_links')) return null;
    return new Set(db.prepare(`
      SELECT fromId FROM entity_links
      WHERE workspaceId = ? AND relType = 'member_of' AND toId = ?
    `).all(workspaceId, factionId).map(row => row.fromId));
  }

  function getRequiredCard(workspaceId, ownerId, targetId) {
    const card = getCard(
      requireText(workspaceId, 'workspaceId'),
      requireText(ownerId, 'ownerId'),
      requireText(targetId, 'targetId'),
    );
    if (!card) throw new Error('The Knowledge card no longer exists.');
    return card;
  }

  function persistTemporalAwareness({ workspaceId, ownerId, targetId, sourceType, sourceId, status }) {
    if (!hasTable(db, 'narrative_awareness_records') || !hasTable(db, 'narrative_events')) return;
    if (status === 'active') {
      const current = db.prepare(`
        SELECT payload_json
        FROM narrative_awareness_records
        WHERE workspace_id = ? AND subject_id = ? AND target_id = ?
        ORDER BY rowid DESC LIMIT 1
      `).get(workspaceId, ownerId, targetId);
      if (current && parseObject(current.payload_json).status === 'active') return;
    }
    const signature = crypto.createHash('sha256')
      .update(JSON.stringify({ workspaceId, ownerId, targetId, sourceType, sourceId, status }))
      .digest('hex').slice(0, 24);
    const eventId = `awareness_event_${signature}`;
    if (db.prepare(`
      SELECT 1 FROM narrative_events WHERE workspace_id = ? AND event_id = ?
    `).get(workspaceId, eventId)) return;
    const awarenessId = `awareness_${signature}`;
    const operationId = `awareness_operation_${signature}`;
    const evidenceId = `awareness_evidence_${signature}`;
    const createdAt = new Date().toISOString();
    const sequence = db.prepare(`
      SELECT COALESCE(MAX(narrative_sequence), 0) + 1 AS value
      FROM narrative_events WHERE workspace_id = ?
    `).get(workspaceId).value;
    const awareness = { id: awarenessId, subjectId: ownerId, targetId, status, sourceEventId: eventId };
    const operation = { id: operationId, type: 'grant-awareness', evidenceIds: [evidenceId], awareness };
    db.prepare(`
      INSERT INTO narrative_events (
        workspace_id, event_id, proposal_id, change_set_id, contract_version,
        event_type, description, narrative_sequence, status, version,
        operations_json, provenance_interpreter, provenance_schema_version,
        provenance_created_at, decided_at
      ) VALUES (?, ?, ?, ?, '1.0', 'custom', ?, ?, 'approved', 1, ?, 'deterministic', '1.0', ?, ?)
    `).run(
      workspaceId, eventId, `awareness_proposal_${signature}`, `awareness_change_${signature}`,
      status === 'active' ? 'Awareness granted.' : 'Awareness revoked.',
      sequence, JSON.stringify([operation]), createdAt, createdAt,
    );
    db.prepare(`
      INSERT INTO narrative_event_participants
        (workspace_id, event_id, ordinal, entity_id, role)
      VALUES (?, ?, 0, ?, 'subject')
    `).run(workspaceId, eventId, ownerId);
    db.prepare(`
      INSERT INTO narrative_event_evidence
        (workspace_id, event_id, evidence_id, ordinal, origin_type, origin_id, excerpt)
      VALUES (?, ?, ?, 0, ?, ?, ?)
    `).run(
      workspaceId, eventId, evidenceId,
      sourceType === 'import' ? 'import' : 'world-action',
      sourceId,
      `${sourceType} awareness for ${targetId}`,
    );
    db.prepare(`
      INSERT INTO narrative_awareness_records (
        workspace_id, awareness_id, subject_id, target_id, status,
        source_event_id, operation_id, payload_json, applied_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      workspaceId, awarenessId, ownerId, targetId, status,
      eventId, operationId, JSON.stringify(awareness), createdAt,
    );
  }

  return {
    ensureAwareness,
    listCards,
    getCard,
    setKnownFields,
    markCurrentFieldsKnown,
    setKnownRelationships,
    removeCard,
    setAudience,
    reconcileWorkspace,
  };
}

function hydrateRelationship(row) {
  return {
    relationshipId: row.relationshipId,
    fromId: row.fromId,
    fromName: row.fromName,
    relationType: row.relationType,
    relationLabel: row.relationLabel || undefined,
    toId: row.toId,
    toName: row.toName,
    metadata: parseObject(row.metadataJson),
    createdAt: row.createdAt,
  };
}

function normalizeIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))];
}

function cleanOptionalText(value) {
  const text = String(value || '').trim();
  return text || null;
}

function requireText(value, label) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function parseObject(raw) {
  try {
    const value = JSON.parse(raw || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function hasFilledValue(value) {
  if (value === null || value === undefined || value === '') return false;
  if (Array.isArray(value)) return value.length > 0;
  return true;
}

const pairKey = (ownerId, targetId) => `${ownerId}\u0000${targetId}`;
const grantKey = grant => `${pairKey(grant.ownerId, grant.targetId)}\u0000${grant.sourceType}\u0000${grant.sourceId}`;
const rowGrant = row => ({ ownerId: row.owner_id, targetId: row.target_id, sourceType: row.source_type, sourceId: row.source_id });

// A table that exists stays; only a missing one is asked about again.
const knownTables = new WeakMap();

function hasTable(db, name) {
  const known = knownTables.get(db);
  if (known?.has(name)) return true;
  const exists = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
  if (exists) {
    if (known) known.add(name);
    else knownTables.set(db, new Set([name]));
  }
  return exists;
}

module.exports = { createWorldbuildKnowledgeService };
