// Every place outside entities, entity_links and chunk_tags that stores a Worldbuild entity id,
// and what a merge or a delete does to it. Nothing references entities through a foreign key,
// so a column missing here keeps pointing at an entity that no longer exists.

/**
 * The coverage test compares this list with the live schema. `merge` and `delete` describe the
 * handling below; `ignored` columns are deliberate, with the reason beside them.
 */
const ENTITY_REFERENCE_COLUMNS = [
  { table: 'chunk_tag_suppressions', column: 'entity', merge: 'repoint', delete: 'remove' },
  { table: 'entity_enrichment_chunks', column: 'entityId', merge: 'repoint', delete: 'remove' },
  { table: 'entity_enrichment_errors', column: 'entityId', merge: 'remove', delete: 'remove' },
  { table: 'entity_update_evidence', column: 'entity_id', merge: 'repoint', delete: 'remove' },
  { table: 'entity_update_jobs', column: 'entity_id', merge: 'repoint', delete: 'keep history' },
  { table: 'narrative_records', column: 'subject_id', merge: 'repoint', delete: 'retire' },
  { table: 'narrative_records', column: 'payload_json', merge: 'repoint', delete: 'retire or unlist' },
  { table: 'narrative_awareness_records', column: 'subject_id', merge: 'repoint', delete: 'revoke' },
  { table: 'narrative_awareness_records', column: 'target_id', merge: 'repoint', delete: 'revoke' },
  { table: 'narrative_awareness_records', column: 'payload_json', merge: 'repoint', delete: 'revoke' },
  { table: 'narrative_events', column: 'location_id', merge: 'repoint', delete: 'keep history' },
  { table: 'narrative_events', column: 'operations_json', merge: 'repoint proposed', delete: 'reject proposed' },
  { table: 'narrative_event_participants', column: 'entity_id', merge: 'repoint', delete: 'keep history' },
  { table: 'narrative_scenes', column: 'location_id', merge: 'repoint', delete: 'clear' },
  { table: 'narrative_scenes', column: 'focal_subject_id', merge: 'repoint', delete: 'clear' },
  { table: 'narrative_scenes', column: 'allowed_subject_ids_json', merge: 'repoint', delete: 'unlist' },
  { table: 'narrative_scene_participants', column: 'entity_id', merge: 'repoint', delete: 'remove' },
  { table: 'narrative_scene_possible_observers', column: 'entity_id', merge: 'repoint', delete: 'remove' },
  { table: 'roleplay_scene_objects', column: 'entity_id', merge: 'repoint', delete: 'remove' },
  { table: 'roleplay_scene_nearby', column: 'entity_id', merge: 'repoint', delete: 'remove' },
  { table: 'roleplay_workspace_settings', column: 'player_entity_id', merge: 'repoint', delete: 'clear' },
  { table: 'roleplay_workspace_settings', column: 'location_entity_id', merge: 'repoint', delete: 'clear' },
  { table: 'roleplay_resource_values', column: 'target_id', merge: 'repoint, preferred side wins', delete: 'remove' },
  { table: 'roleplay_species_memberships', column: 'entity_id', merge: 'repoint, preferred side wins', delete: 'remove' },
  { table: 'roleplay_species_memberships', column: 'species_id', merge: 'repoint', delete: 'remove' },
  { table: 'roleplay_resource_changes', column: 'entity_id', merge: 'repoint', delete: 'reject pending' },
  { table: 'roleplay_equipment', column: 'entity_id', merge: 'repoint', delete: 'remove' },
  { table: 'roleplay_equipment', column: 'item_id', merge: 'repoint', delete: 'remove' },
  { table: 'roleplay_location_inventory', column: 'location_id', merge: 'repoint, quantities add', delete: 'remove' },
  { table: 'roleplay_location_inventory', column: 'item_id', merge: 'repoint, quantities add', delete: 'remove' },
  { table: 'roleplay_location_backgrounds', column: 'location_id', merge: 'repoint, preferred side wins', delete: 'remove' },
  { table: 'roleplay_entity_changes', column: 'entity_id', merge: 'repoint', delete: 'reject pending' },
  { table: 'roleplay_entity_changes', column: 'payload_json', merge: 'repoint', delete: 'reject pending' },
  { table: 'roleplay_scene_changes', column: 'payload_json', merge: 'repoint', delete: 'reject pending' },
  { table: 'roleplay_inventory_changes', column: 'payload_json', merge: 'repoint', delete: 'reject pending' },
  { table: 'roleplay_time_state', column: 'position_json', merge: 'repoint', delete: 'unlist' },
  { table: 'roleplay_message_frames', column: 'start_json', merge: 'repoint', delete: 'keep history' },
  { table: 'roleplay_message_frames', column: 'end_json', merge: 'repoint', delete: 'keep history' },
  { table: 'roleplay_time_advances', column: 'start_json', merge: 'repoint', delete: 'keep history' },
  { table: 'roleplay_time_advances', column: 'end_json', merge: 'repoint', delete: 'keep history' },
  { table: 'worldbuild_knowledge_cards', column: 'owner_id', merge: 'repoint, cards combine', delete: 'remove' },
  { table: 'worldbuild_knowledge_cards', column: 'target_id', merge: 'repoint, cards combine', delete: 'remove' },
  { table: 'worldbuild_knowledge_audience_members', column: 'member_id', merge: 'repoint', delete: 'remove' },
  { table: 'worldbuild_knowledge_exclusions', column: 'owner_id', merge: 'repoint', delete: 'remove' },
  { table: 'worldbuild_knowledge_exclusions', column: 'target_id', merge: 'repoint', delete: 'remove' },
  { table: 'worldbuild_known_relationships', column: 'from_id', merge: 'repoint', delete: 'remove' },
  { table: 'worldbuild_known_relationships', column: 'to_id', merge: 'repoint', delete: 'remove' },
  { table: 'worldbuild_event_occurrences', column: 'event_entity_id', merge: 'repoint', delete: 'archive' },
  { table: 'worldbuild_event_occurrences', column: 'participants_json', merge: 'repoint', delete: 'unlist' },
  { table: 'worldbuild_event_occurrences', column: 'location_ids_json', merge: 'repoint', delete: 'unlist' },
  { table: 'worldbuild_event_occurrences', column: 'related_entity_ids_json', merge: 'repoint', delete: 'unlist' },
  { table: 'worldbuild_event_occurrences', column: 'consequences_json', merge: 'repoint', delete: 'keep history' },
  { table: 'worldbuild_field_definitions', column: 'default_value_json', merge: 'repoint', delete: 'unlist' },
  { table: 'entities', column: 'data', merge: 'repoint', delete: 'unlist' },
  { table: 'entity_redirects', column: 'to_id', merge: 'repoint', delete: 'remove' }
];

const IGNORED_ENTITY_REFERENCE_COLUMNS = [
  { table: 'narrative_context_manifests', column: 'player_subject_id', reason: 'A record of a context already sent to the model.' },
  { table: 'narrative_context_manifests', column: 'manifest_json', reason: 'A record of a context already sent to the model.' },
  { table: 'roleplay_turn_snapshots', column: 'snapshot_json', reason: 'Redirected or dropped when a snapshot is restored.' },
  { table: 'narrative_turn_replacements', column: 'restore_json', reason: 'Restored through the same snapshot path.' },
  { table: 'roleplay_message_frames', column: 'advance_json', reason: 'A time cost, not a place or an actor.' },
  { table: 'roleplay_time_advances', column: 'advance_json', reason: 'A time cost, not a place or an actor.' },
  { table: 'entity_redirects', column: 'from_id', reason: 'Names an entity that no longer exists by design.' },
  { table: 'workspace_ui_state', column: 'valueJson', reason: 'A view selection; the view drops an id it cannot find.' },
  { table: 'knowledge_chunks', column: 'ownerId', reason: 'A workspace, a profile or a document owns a chunk, never an entity.' }
];

// What each narrative record type uses to stop being current.
const RETIRED_RECORD_STATUS = {
  fact: 'retracted',
  knowledge: 'superseded',
  belief: 'superseded',
  memory: 'forgotten',
  relationship: 'retired',
  state: 'retired',
  observation: 'retired'
};

function hasTable(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function parseJson(text, fallback) {
  if (text == null || text === '') return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
}

// Replaces every string equal to `from`; lists drop the duplicates the rename can create.
function replaceEntityId(value, from, to) {
  if (value === from) return to;
  if (Array.isArray(value)) {
    const next = value.map(item => replaceEntityId(item, from, to));
    return next.filter((item, index) => typeof item !== 'string' || next.indexOf(item) === index);
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, replaceEntityId(item, from, to)]));
  }
  return value;
}

// Removes an id from every list, and every property whose whole value is that id.
function removeEntityId(value, id) {
  if (Array.isArray(value)) return value.filter(item => item !== id).map(item => removeEntityId(item, id));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value)
      .filter(([, item]) => item !== id)
      .map(([key, item]) => [key, removeEntityId(item, id)]));
  }
  return value;
}

function rewriteJsonColumn(db, { table, key, column, where, params, transform }) {
  const rows = db.prepare(`SELECT rowid AS rid, ${column} AS value FROM ${table} WHERE ${where}`).all(...params);
  const update = db.prepare(`UPDATE ${table} SET ${column} = ? WHERE rowid = ?`);
  for (const row of rows) {
    const parsed = parseJson(row.value, undefined);
    if (parsed === undefined) continue;
    const next = JSON.stringify(transform(parsed));
    if (next !== row.value) update.run(next, row.rid);
  }
}

const likeId = id => `%${String(id).replace(/[\\%_]/g, match => `\\${match}`)}%`;

/** Carries every reference from `sourceId` to `targetId`. Runs inside the merge transaction. */
function repointEntityReferences(db, { workspaceId, sourceId, targetId, prefer = 'target', targetName = null }) {
  const has = table => hasTable(db, table);
  const like = likeId(sourceId);
  const replace = value => replaceEntityId(value, sourceId, targetId);

  // A pair of statements per unique key: move what fits, then drop what collided.
  const moveUnique = (table, column, scope = '') => {
    if (!has(table)) return;
    db.prepare(`UPDATE OR IGNORE ${table} SET ${column} = ? WHERE ${column} = ?${scope}`).run(targetId, sourceId);
    db.prepare(`DELETE FROM ${table} WHERE ${column} = ?${scope}`).run(sourceId);
  };

  if (has('entity_redirects')) {
    db.prepare('UPDATE entity_redirects SET to_id = ? WHERE workspace_id = ? AND to_id = ?').run(targetId, workspaceId, sourceId);
    db.prepare(`
      INSERT INTO entity_redirects (workspace_id, from_id, to_id, created_at) VALUES (?, ?, ?, ?)
      ON CONFLICT(workspace_id, from_id) DO UPDATE SET to_id = excluded.to_id, created_at = excluded.created_at
    `).run(workspaceId, sourceId, targetId, Date.now());
  }

  moveUnique('chunk_tag_suppressions', 'entity');
  moveUnique('entity_enrichment_chunks', 'entityId');
  if (has('entity_enrichment_errors')) db.prepare('DELETE FROM entity_enrichment_errors WHERE entityId = ?').run(sourceId);
  moveUnique('entity_update_evidence', 'entity_id');
  moveUnique('entity_update_jobs', 'entity_id');

  if (has('narrative_records')) {
    const rows = db.prepare(`
      SELECT rowid AS rid, record_type, subject_id, payload_json FROM narrative_records
      WHERE workspace_id = ? AND (subject_id = ? OR payload_json LIKE ? ESCAPE '\\')
    `).all(workspaceId, sourceId, like);
    const update = db.prepare('UPDATE narrative_records SET subject_id = ?, payload_json = ? WHERE rowid = ?');
    for (const row of rows) {
      const payload = replace(parseJson(row.payload_json, {}));
      const subjectId = row.subject_id === sourceId ? targetId : row.subject_id;
      // A relationship between the two merged entities is now a relationship with itself.
      if (row.record_type === 'relationship' && payload.sourceEntityId && payload.sourceEntityId === payload.targetEntityId) {
        payload.status = RETIRED_RECORD_STATUS.relationship;
      }
      update.run(subjectId, JSON.stringify(payload), row.rid);
    }
  }

  if (has('narrative_awareness_records')) {
    const rows = db.prepare(`
      SELECT rowid AS rid, subject_id, target_id, status, payload_json FROM narrative_awareness_records
      WHERE workspace_id = ? AND (subject_id = ? OR target_id = ?)
    `).all(workspaceId, sourceId, sourceId);
    const update = db.prepare('UPDATE narrative_awareness_records SET subject_id = ?, target_id = ?, status = ?, payload_json = ? WHERE rowid = ?');
    for (const row of rows) {
      const subjectId = row.subject_id === sourceId ? targetId : row.subject_id;
      const awareTargetId = row.target_id === sourceId ? targetId : row.target_id;
      const payload = replace(parseJson(row.payload_json, {}));
      const status = subjectId === awareTargetId ? 'revoked' : row.status;
      if (status !== row.status) payload.status = status;
      update.run(subjectId, awareTargetId, status, JSON.stringify(payload), row.rid);
    }
  }

  if (has('narrative_events')) {
    db.prepare('UPDATE narrative_events SET location_id = ? WHERE workspace_id = ? AND location_id = ?').run(targetId, workspaceId, sourceId);
    rewriteJsonColumn(db, {
      table: 'narrative_events', column: 'operations_json',
      where: "workspace_id = ? AND status = 'proposed' AND operations_json LIKE ? ESCAPE '\\'", params: [workspaceId, like], transform: replace
    });
  }
  if (has('narrative_event_participants')) {
    db.prepare('UPDATE narrative_event_participants SET entity_id = ? WHERE workspace_id = ? AND entity_id = ?').run(targetId, workspaceId, sourceId);
    db.prepare(`
      DELETE FROM narrative_event_participants
      WHERE workspace_id = ? AND entity_id = ? AND ordinal NOT IN (
        SELECT MIN(ordinal) FROM narrative_event_participants AS kept
        WHERE kept.workspace_id = narrative_event_participants.workspace_id
          AND kept.event_id = narrative_event_participants.event_id AND kept.entity_id = ?
      )
    `).run(workspaceId, targetId, targetId);
  }

  if (has('narrative_scenes')) {
    db.prepare('UPDATE narrative_scenes SET location_id = ? WHERE workspace_id = ? AND location_id = ?').run(targetId, workspaceId, sourceId);
    db.prepare('UPDATE narrative_scenes SET focal_subject_id = ? WHERE workspace_id = ? AND focal_subject_id = ?').run(targetId, workspaceId, sourceId);
    rewriteJsonColumn(db, {
      table: 'narrative_scenes', column: 'allowed_subject_ids_json',
      where: "workspace_id = ? AND allowed_subject_ids_json LIKE ? ESCAPE '\\'", params: [workspaceId, like], transform: replace
    });
  }
  for (const table of ['narrative_scene_participants', 'narrative_scene_possible_observers', 'roleplay_scene_objects', 'roleplay_scene_nearby']) {
    if (!has(table)) continue;
    db.prepare(`UPDATE OR IGNORE ${table} SET entity_id = ? WHERE workspace_id = ? AND entity_id = ?`).run(targetId, workspaceId, sourceId);
    db.prepare(`DELETE FROM ${table} WHERE workspace_id = ? AND entity_id = ?`).run(workspaceId, sourceId);
  }

  if (has('roleplay_workspace_settings')) {
    db.prepare('UPDATE roleplay_workspace_settings SET player_entity_id = ? WHERE workspace_id = ? AND player_entity_id = ?').run(targetId, workspaceId, sourceId);
    db.prepare('UPDATE roleplay_workspace_settings SET location_entity_id = ? WHERE workspace_id = ? AND location_entity_id = ?').run(targetId, workspaceId, sourceId);
  }

  // Where both entities hold a value for the same thing, the side the user preferred keeps it.
  const preferSource = prefer === 'source';
  if (has('roleplay_resource_values')) {
    if (preferSource) {
      db.prepare(`
        DELETE FROM roleplay_resource_values WHERE workspace_id = ? AND target_id = ? AND EXISTS (
          SELECT 1 FROM roleplay_resource_values AS other WHERE other.workspace_id = roleplay_resource_values.workspace_id
            AND other.definition_id = roleplay_resource_values.definition_id
            AND other.target_type = roleplay_resource_values.target_type AND other.target_id = ?
        )
      `).run(workspaceId, targetId, sourceId);
    }
    db.prepare('UPDATE OR IGNORE roleplay_resource_values SET target_id = ? WHERE workspace_id = ? AND target_id = ?').run(targetId, workspaceId, sourceId);
    db.prepare('DELETE FROM roleplay_resource_values WHERE workspace_id = ? AND target_id = ?').run(workspaceId, sourceId);
  }
  if (has('roleplay_species_memberships')) {
    if (preferSource) {
      db.prepare(`
        DELETE FROM roleplay_species_memberships WHERE workspace_id = ? AND entity_id = ?
          AND EXISTS (SELECT 1 FROM roleplay_species_memberships AS other WHERE other.workspace_id = ? AND other.entity_id = ?)
      `).run(workspaceId, targetId, workspaceId, sourceId);
    }
    db.prepare('UPDATE OR IGNORE roleplay_species_memberships SET entity_id = ? WHERE workspace_id = ? AND entity_id = ?').run(targetId, workspaceId, sourceId);
    db.prepare('DELETE FROM roleplay_species_memberships WHERE workspace_id = ? AND entity_id = ?').run(workspaceId, sourceId);
    db.prepare('UPDATE roleplay_species_memberships SET species_id = ? WHERE workspace_id = ? AND species_id = ?').run(targetId, workspaceId, sourceId);
    db.prepare('DELETE FROM roleplay_species_memberships WHERE workspace_id = ? AND entity_id = species_id').run(workspaceId);
  }
  if (has('roleplay_resource_changes')) {
    db.prepare('UPDATE roleplay_resource_changes SET entity_id = ? WHERE workspace_id = ? AND entity_id = ?').run(targetId, workspaceId, sourceId);
  }
  if (has('roleplay_equipment')) {
    for (const column of ['entity_id', 'item_id']) {
      db.prepare(`UPDATE OR IGNORE roleplay_equipment SET ${column} = ? WHERE workspace_id = ? AND ${column} = ?`).run(targetId, workspaceId, sourceId);
      db.prepare(`DELETE FROM roleplay_equipment WHERE workspace_id = ? AND ${column} = ?`).run(workspaceId, sourceId);
    }
  }
  if (has('roleplay_location_inventory')) {
    const rows = db.prepare(`
      SELECT location_id, item_id, quantity FROM roleplay_location_inventory
      WHERE workspace_id = ? AND (location_id = ? OR item_id = ?)
    `).all(workspaceId, sourceId, sourceId);
    const remove = db.prepare('DELETE FROM roleplay_location_inventory WHERE workspace_id = ? AND location_id = ? AND item_id = ?');
    const add = db.prepare(`
      INSERT INTO roleplay_location_inventory (workspace_id, location_id, item_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, location_id, item_id) DO UPDATE SET quantity = quantity + excluded.quantity, updated_at = excluded.updated_at
    `);
    for (const row of rows) {
      remove.run(workspaceId, row.location_id, row.item_id);
      add.run(workspaceId, row.location_id === sourceId ? targetId : row.location_id, row.item_id === sourceId ? targetId : row.item_id, row.quantity, Date.now());
    }
  }
  if (has('roleplay_location_backgrounds')) {
    if (preferSource) db.prepare('DELETE FROM roleplay_location_backgrounds WHERE workspace_id = ? AND location_id = ? AND EXISTS (SELECT 1 FROM roleplay_location_backgrounds AS other WHERE other.workspace_id = ? AND other.location_id = ?)').run(workspaceId, targetId, workspaceId, sourceId);
    db.prepare('UPDATE OR IGNORE roleplay_location_backgrounds SET location_id = ? WHERE workspace_id = ? AND location_id = ?').run(targetId, workspaceId, sourceId);
    db.prepare('DELETE FROM roleplay_location_backgrounds WHERE workspace_id = ? AND location_id = ?').run(workspaceId, sourceId);
  }
  if (has('roleplay_entity_changes')) {
    db.prepare('UPDATE roleplay_entity_changes SET entity_id = ? WHERE workspace_id = ? AND entity_id = ?').run(targetId, workspaceId, sourceId);
  }
  for (const [table, column] of [
    ['roleplay_entity_changes', 'payload_json'],
    ['roleplay_scene_changes', 'payload_json'],
    ['roleplay_inventory_changes', 'payload_json'],
    ['roleplay_time_state', 'position_json'],
    ['roleplay_message_frames', 'start_json'],
    ['roleplay_message_frames', 'end_json'],
    ['roleplay_time_advances', 'start_json'],
    ['roleplay_time_advances', 'end_json'],
    ['worldbuild_event_occurrences', 'participants_json'],
    ['worldbuild_event_occurrences', 'location_ids_json'],
    ['worldbuild_event_occurrences', 'related_entity_ids_json'],
    ['worldbuild_event_occurrences', 'consequences_json'],
    ['worldbuild_field_definitions', 'default_value_json']
  ]) {
    if (!has(table)) continue;
    rewriteJsonColumn(db, { table, column, where: `workspace_id = ? AND ${column} LIKE ? ESCAPE '\\'`, params: [workspaceId, like], transform: replace });
  }
  if (has('worldbuild_event_occurrences')) {
    db.prepare('UPDATE worldbuild_event_occurrences SET event_entity_id = ? WHERE workspace_id = ? AND event_entity_id = ?').run(targetId, workspaceId, sourceId);
  }

  if (has('worldbuild_knowledge_cards')) combineKnowledgeCards(db, { workspaceId, sourceId, targetId });
  if (has('worldbuild_knowledge_audience_members')) {
    db.prepare('UPDATE OR IGNORE worldbuild_knowledge_audience_members SET member_id = ? WHERE workspace_id = ? AND member_id = ?').run(targetId, workspaceId, sourceId);
    db.prepare('DELETE FROM worldbuild_knowledge_audience_members WHERE workspace_id = ? AND member_id = ?').run(workspaceId, sourceId);
  }
  if (has('worldbuild_knowledge_exclusions')) {
    for (const column of ['owner_id', 'target_id']) {
      db.prepare(`UPDATE OR IGNORE worldbuild_knowledge_exclusions SET ${column} = ? WHERE workspace_id = ? AND ${column} = ?`).run(targetId, workspaceId, sourceId);
      db.prepare(`DELETE FROM worldbuild_knowledge_exclusions WHERE workspace_id = ? AND ${column} = ?`).run(workspaceId, sourceId);
    }
    db.prepare('DELETE FROM worldbuild_knowledge_exclusions WHERE workspace_id = ? AND owner_id = target_id').run(workspaceId);
  }
  if (has('worldbuild_known_relationships')) {
    const name = targetName ?? db.prepare('SELECT canonicalName FROM entities WHERE id = ?').get(targetId)?.canonicalName ?? '';
    db.prepare('UPDATE worldbuild_known_relationships SET from_id = ?, from_name = ? WHERE workspace_id = ? AND from_id = ?').run(targetId, name, workspaceId, sourceId);
    db.prepare('UPDATE worldbuild_known_relationships SET to_id = ?, to_name = ? WHERE workspace_id = ? AND to_id = ?').run(targetId, name, workspaceId, sourceId);
  }

  rewriteJsonColumn(db, {
    table: 'entities', column: 'data',
    where: "workspaceId IS ? AND id != ? AND data LIKE ? ESCAPE '\\'", params: [workspaceId, sourceId, like], transform: replace
  });
}

// A card per owner and target: the source's cards join the target's, and a card about oneself goes.
function combineKnowledgeCards(db, { workspaceId, sourceId, targetId }) {
  const cards = db.prepare(`
    SELECT card_id, owner_id, target_id FROM worldbuild_knowledge_cards
    WHERE workspace_id = ? AND (owner_id = ? OR target_id = ?)
  `).all(workspaceId, sourceId, sourceId);
  const findCard = db.prepare('SELECT card_id FROM worldbuild_knowledge_cards WHERE workspace_id = ? AND owner_id = ? AND target_id = ?');
  const removeCard = db.prepare('DELETE FROM worldbuild_knowledge_cards WHERE workspace_id = ? AND card_id = ?');
  for (const card of cards) {
    const ownerId = card.owner_id === sourceId ? targetId : card.owner_id;
    const cardTargetId = card.target_id === sourceId ? targetId : card.target_id;
    if (ownerId === cardTargetId) {
      removeCard.run(workspaceId, card.card_id);
      continue;
    }
    const existing = findCard.get(workspaceId, ownerId, cardTargetId);
    if (!existing) {
      db.prepare('UPDATE worldbuild_knowledge_cards SET owner_id = ?, target_id = ?, updated_at = ? WHERE workspace_id = ? AND card_id = ?')
        .run(ownerId, cardTargetId, Date.now(), workspaceId, card.card_id);
      continue;
    }
    for (const table of ['worldbuild_knowledge_sources', 'worldbuild_known_fields', 'worldbuild_knowledge_audience_members', 'worldbuild_known_relationships']) {
      if (!hasTable(db, table)) continue;
      db.prepare(`UPDATE OR IGNORE ${table} SET card_id = ? WHERE workspace_id = ? AND card_id = ?`).run(existing.card_id, workspaceId, card.card_id);
    }
    removeCard.run(workspaceId, card.card_id);
  }
}

/** Lets go of every reference to a deleted entity. Runs inside the delete transaction. */
function releaseEntityReferences(db, { workspaceId, entityId }) {
  const has = table => hasTable(db, table);
  const like = likeId(entityId);
  const unlist = value => removeEntityId(value, entityId);
  const now = Date.now();

  if (has('entity_redirects')) db.prepare('DELETE FROM entity_redirects WHERE workspace_id = ? AND to_id = ?').run(workspaceId, entityId);
  if (has('chunk_tag_suppressions')) db.prepare('DELETE FROM chunk_tag_suppressions WHERE entity = ?').run(entityId);
  if (has('entity_enrichment_chunks')) db.prepare('DELETE FROM entity_enrichment_chunks WHERE entityId = ?').run(entityId);
  if (has('entity_enrichment_errors')) db.prepare('DELETE FROM entity_enrichment_errors WHERE entityId = ?').run(entityId);
  if (has('entity_update_evidence')) db.prepare('DELETE FROM entity_update_evidence WHERE entity_id = ?').run(entityId);

  if (has('narrative_records')) {
    const rows = db.prepare(`
      SELECT rowid AS rid, record_type, subject_id, payload_json FROM narrative_records
      WHERE workspace_id = ? AND (subject_id = ? OR payload_json LIKE ? ESCAPE '\\')
    `).all(workspaceId, entityId, like);
    const update = db.prepare('UPDATE narrative_records SET payload_json = ? WHERE rowid = ?');
    for (const row of rows) {
      const payload = parseJson(row.payload_json, {});
      const proposition = payload.proposition && typeof payload.proposition === 'object' ? payload.proposition : {};
      const anchored = [row.subject_id, payload.subjectId, payload.entityId, payload.sourceEntityId, payload.targetEntityId, proposition.subjectId, proposition.object]
        .includes(entityId);
      // A record about the deleted entity stops being current; one that only mentions it keeps its content.
      const next = anchored
        ? { ...payload, status: RETIRED_RECORD_STATUS[row.record_type] ?? 'retired' }
        : {
            ...payload,
            ...(Array.isArray(payload.relatedEntityIds) ? { relatedEntityIds: payload.relatedEntityIds.filter(id => id !== entityId) } : {}),
            ...(Array.isArray(payload.informantIds) ? { informantIds: payload.informantIds.filter(id => id !== entityId) } : {})
          };
      const serialized = JSON.stringify(next);
      if (serialized !== row.payload_json) update.run(serialized, row.rid);
    }
  }

  if (has('narrative_awareness_records')) {
    rewriteJsonColumn(db, {
      table: 'narrative_awareness_records', column: 'payload_json',
      where: "workspace_id = ? AND (subject_id = ? OR target_id = ?) AND status != 'revoked'", params: [workspaceId, entityId, entityId],
      transform: payload => ({ ...payload, status: 'revoked' })
    });
    db.prepare("UPDATE narrative_awareness_records SET status = 'revoked' WHERE workspace_id = ? AND (subject_id = ? OR target_id = ?)").run(workspaceId, entityId, entityId);
  }

  if (has('narrative_events')) {
    const proposed = db.prepare(`
      SELECT event_id FROM narrative_events
      WHERE workspace_id = ? AND status = 'proposed' AND (location_id = ? OR operations_json LIKE ? ESCAPE '\\'
        OR event_id IN (SELECT event_id FROM narrative_event_participants WHERE workspace_id = ? AND entity_id = ?))
    `).all(workspaceId, entityId, like, workspaceId, entityId);
    const reject = db.prepare(`
      UPDATE narrative_events SET status = 'rejected', version = version + 1, decided_at = ?
      WHERE workspace_id = ? AND event_id = ?
    `);
    for (const event of proposed) reject.run(new Date(now).toISOString(), workspaceId, event.event_id);
  }

  if (has('narrative_scenes')) {
    db.prepare('UPDATE narrative_scenes SET location_id = NULL WHERE workspace_id = ? AND location_id = ?').run(workspaceId, entityId);
    db.prepare(`
      UPDATE narrative_scenes SET focal_subject_id = NULL,
        perspective_access = CASE perspective_access WHEN 'subjective' THEN 'omniscient' ELSE perspective_access END
      WHERE workspace_id = ? AND focal_subject_id = ?
    `).run(workspaceId, entityId);
    rewriteJsonColumn(db, {
      table: 'narrative_scenes', column: 'allowed_subject_ids_json',
      where: "workspace_id = ? AND allowed_subject_ids_json LIKE ? ESCAPE '\\'", params: [workspaceId, like], transform: unlist
    });
  }
  for (const table of ['narrative_scene_participants', 'narrative_scene_possible_observers', 'roleplay_scene_objects', 'roleplay_scene_nearby', 'roleplay_species_memberships']) {
    if (has(table)) db.prepare(`DELETE FROM ${table} WHERE workspace_id = ? AND entity_id = ?`).run(workspaceId, entityId);
  }
  if (has('roleplay_species_memberships')) db.prepare('DELETE FROM roleplay_species_memberships WHERE workspace_id = ? AND species_id = ?').run(workspaceId, entityId);
  if (has('roleplay_workspace_settings')) {
    db.prepare('UPDATE roleplay_workspace_settings SET player_entity_id = NULL WHERE workspace_id = ? AND player_entity_id = ?').run(workspaceId, entityId);
    db.prepare('UPDATE roleplay_workspace_settings SET location_entity_id = NULL WHERE workspace_id = ? AND location_entity_id = ?').run(workspaceId, entityId);
  }
  if (has('roleplay_resource_values')) db.prepare('DELETE FROM roleplay_resource_values WHERE workspace_id = ? AND target_id = ?').run(workspaceId, entityId);
  if (has('roleplay_equipment')) db.prepare('DELETE FROM roleplay_equipment WHERE workspace_id = ? AND (entity_id = ? OR item_id = ?)').run(workspaceId, entityId, entityId);
  if (has('roleplay_location_inventory')) db.prepare('DELETE FROM roleplay_location_inventory WHERE workspace_id = ? AND (location_id = ? OR item_id = ?)').run(workspaceId, entityId, entityId);
  if (has('roleplay_location_backgrounds')) db.prepare('DELETE FROM roleplay_location_backgrounds WHERE workspace_id = ? AND location_id = ?').run(workspaceId, entityId);

  if (has('roleplay_resource_changes')) {
    db.prepare("UPDATE roleplay_resource_changes SET status = 'rejected', resolved_at = ? WHERE workspace_id = ? AND entity_id = ? AND status = 'pending'").run(now, workspaceId, entityId);
  }
  if (has('roleplay_entity_changes')) {
    db.prepare(`
      UPDATE roleplay_entity_changes SET status = 'rejected', resolved_at = ?
      WHERE workspace_id = ? AND status IN ('pending', 'conflicting') AND (entity_id = ? OR payload_json LIKE ? ESCAPE '\\')
    `).run(now, workspaceId, entityId, like);
  }
  for (const table of ['roleplay_scene_changes', 'roleplay_inventory_changes']) {
    if (!has(table)) continue;
    db.prepare(`
      UPDATE ${table} SET status = 'rejected', resolved_at = ?
      WHERE workspace_id = ? AND status = 'pending' AND payload_json LIKE ? ESCAPE '\\'
    `).run(now, workspaceId, like);
  }
  if (has('roleplay_time_state')) {
    rewriteJsonColumn(db, { table: 'roleplay_time_state', column: 'position_json', where: "workspace_id = ? AND position_json LIKE ? ESCAPE '\\'", params: [workspaceId, like], transform: unlist });
  }

  if (has('worldbuild_knowledge_cards')) {
    db.prepare('DELETE FROM worldbuild_knowledge_cards WHERE workspace_id = ? AND (owner_id = ? OR target_id = ?)').run(workspaceId, entityId, entityId);
  }
  if (has('worldbuild_knowledge_audience_members')) db.prepare('DELETE FROM worldbuild_knowledge_audience_members WHERE workspace_id = ? AND member_id = ?').run(workspaceId, entityId);
  if (has('worldbuild_knowledge_exclusions')) db.prepare('DELETE FROM worldbuild_knowledge_exclusions WHERE workspace_id = ? AND (owner_id = ? OR target_id = ?)').run(workspaceId, entityId, entityId);
  if (has('worldbuild_known_relationships')) db.prepare('DELETE FROM worldbuild_known_relationships WHERE workspace_id = ? AND (from_id = ? OR to_id = ?)').run(workspaceId, entityId, entityId);

  if (has('worldbuild_event_occurrences')) {
    db.prepare('UPDATE worldbuild_event_occurrences SET archived = 1, updated_at = ? WHERE workspace_id = ? AND event_entity_id = ?').run(now, workspaceId, entityId);
    for (const column of ['participants_json', 'location_ids_json', 'related_entity_ids_json']) {
      rewriteJsonColumn(db, { table: 'worldbuild_event_occurrences', column, where: `workspace_id = ? AND ${column} LIKE ? ESCAPE '\\'`, params: [workspaceId, like], transform: unlist });
    }
  }
  if (has('worldbuild_field_definitions')) {
    rewriteJsonColumn(db, { table: 'worldbuild_field_definitions', column: 'default_value_json', where: "workspace_id = ? AND default_value_json LIKE ? ESCAPE '\\'", params: [workspaceId, like], transform: unlist });
  }

  rewriteJsonColumn(db, {
    table: 'entities', column: 'data',
    where: "workspaceId IS ? AND id != ? AND data LIKE ? ESCAPE '\\'", params: [workspaceId, entityId, like],
    transform: data => {
      const pending = data && data._enrichPending;
      // A staged link to the deleted entity goes whole, not as a link without a target.
      const links = pending && Array.isArray(pending.links) ? pending.links.filter(link => link && link.targetId !== entityId) : null;
      const fields = pending && pending.data && typeof pending.data === 'object'
        ? Object.fromEntries(Object.entries(pending.data).filter(([, proposal]) => proposal !== entityId && proposal?.value !== entityId))
        : null;
      const next = unlist(data);
      if (links && next._enrichPending) next._enrichPending.links = unlist(links);
      if (fields && next._enrichPending) next._enrichPending.data = unlist(fields);
      return next;
    }
  });
}

/** How many narrative and roleplay records would be let go of, for the delete confirmation. */
function countEntityReferences(db, workspaceId, entityIds) {
  const ids = [...new Set(entityIds)].filter(Boolean);
  const empty = { narrativeRecords: 0, knowledgeCards: 0, sceneState: 0 };
  if (!ids.length) return empty;
  const list = ids.map(() => '?').join(', ');
  const count = (table, sql, ...params) => (hasTable(db, table) ? db.prepare(sql).get(...params).count : 0);
  return {
    narrativeRecords: count('narrative_records', `
      SELECT COUNT(*) AS count FROM narrative_records WHERE workspace_id = ? AND (
        subject_id IN (${list})
        OR json_extract(payload_json, '$.proposition.subjectId') IN (${list})
        OR json_extract(payload_json, '$.entityId') IN (${list})
        OR json_extract(payload_json, '$.targetEntityId') IN (${list})
      )
    `, workspaceId, ...ids, ...ids, ...ids, ...ids)
      + count('narrative_awareness_records', `
      SELECT COUNT(*) AS count FROM narrative_awareness_records WHERE workspace_id = ? AND status != 'revoked'
        AND (subject_id IN (${list}) OR target_id IN (${list}))
    `, workspaceId, ...ids, ...ids),
    knowledgeCards: count('worldbuild_knowledge_cards', `
      SELECT COUNT(*) AS count FROM worldbuild_knowledge_cards WHERE workspace_id = ? AND (owner_id IN (${list}) OR target_id IN (${list}))
    `, workspaceId, ...ids, ...ids),
    sceneState: ['narrative_scene_participants', 'narrative_scene_possible_observers', 'roleplay_scene_objects', 'roleplay_scene_nearby', 'roleplay_equipment']
      .reduce((total, table) => total + count(table, `SELECT COUNT(*) AS count FROM ${table} WHERE workspace_id = ? AND entity_id IN (${list})`, workspaceId, ...ids), 0)
  };
}

/**
 * For databases that merged or deleted entities before this registry existed. Only ids the
 * references hold and no entity has are released; nothing that still resolves is touched.
 */
function releaseOrphanedEntityReferences(db) {
  if (!hasTable(db, 'entities')) return 0;
  const retired = "COALESCE(json_extract(payload_json, '$.status'), 'active') NOT IN ('retracted', 'superseded', 'forgotten', 'retired', 'revoked')";
  const candidates = [
    ['narrative_records', 'subject_id', retired],
    ['narrative_awareness_records', 'subject_id', "status != 'revoked'"],
    ['narrative_awareness_records', 'target_id', "status != 'revoked'"],
    ['narrative_scene_participants', 'entity_id'],
    ['narrative_scene_possible_observers', 'entity_id'],
    ['roleplay_scene_objects', 'entity_id'],
    ['roleplay_scene_nearby', 'entity_id'],
    ['roleplay_workspace_settings', 'player_entity_id'],
    ['roleplay_workspace_settings', 'location_entity_id'],
    ['roleplay_equipment', 'entity_id'],
    ['roleplay_equipment', 'item_id'],
    ['roleplay_location_inventory', 'location_id'],
    ['roleplay_location_inventory', 'item_id'],
    ['roleplay_species_memberships', 'entity_id'],
    ['worldbuild_knowledge_cards', 'owner_id'],
    ['worldbuild_knowledge_cards', 'target_id'],
    ['worldbuild_knowledge_audience_members', 'member_id']
  ];
  const orphans = new Map();
  for (const [table, column, condition] of candidates) {
    if (!hasTable(db, table)) continue;
    const rows = db.prepare(`
      SELECT DISTINCT workspace_id, ${column} AS id FROM ${table}
      WHERE ${column} IS NOT NULL AND ${column} NOT IN (SELECT id FROM entities)
        ${condition ? `AND ${condition}` : ''}
    `).all();
    for (const row of rows) orphans.set(JSON.stringify([row.workspace_id, row.id]), { workspaceId: row.workspace_id, entityId: row.id });
  }
  for (const orphan of orphans.values()) releaseEntityReferences(db, orphan);
  return orphans.size;
}

module.exports = {
  ENTITY_REFERENCE_COLUMNS,
  IGNORED_ENTITY_REFERENCE_COLUMNS,
  RETIRED_RECORD_STATUS,
  countEntityReferences,
  releaseEntityReferences,
  releaseOrphanedEntityReferences,
  removeEntityId,
  replaceEntityId,
  repointEntityReferences
};
