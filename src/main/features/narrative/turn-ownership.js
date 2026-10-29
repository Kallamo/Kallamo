// Every table that holds what one story turn left behind. A turn is dead once its lifecycle is no longer
// active and no open replacement can bring it back. The coverage test compares these lists with the schema.

/** Rows carry the turn's message id in this column and go with it. */
const TURN_OWNED_COLUMNS = [
  { table: 'narrative_context_manifests', column: 'origin_id' },
  { table: 'narrative_state_jobs', column: 'origin_id' },
  { table: 'narrative_state_metrics', column: 'origin_id' },
  { table: 'narrative_state_fingerprints', column: 'origin_id' },
  { table: 'roleplay_turn_snapshots', column: 'origin_id' },
  { table: 'roleplay_time_advances', column: 'origin_id' },
  { table: 'roleplay_message_frames', column: 'origin_id' },
  { table: 'roleplay_turn_presence', column: 'origin_id' },
  { table: 'roleplay_character_memory', column: 'origin_id' },
  { table: 'worldbuild_event_occurrences', column: 'origin_id' },
  { table: 'roleplay_scene_changes', column: 'provenance_id' },
  { table: 'roleplay_inventory_changes', column: 'provenance_id' },
  { table: 'roleplay_resource_changes', column: 'provenance_id' },
  { table: 'roleplay_progress_changes', column: 'provenance_id' },
  // A skill the turn created waits as proposed in the Rules, so the row that created it stays.
  { table: 'roleplay_skill_changes', column: 'provenance_id', keep: "kind = 'create'" },
  // An entity the turn created waits as proposed to be taken back by the same arrival later.
  { table: 'roleplay_entity_changes', column: 'provenance_id', keep: 'created_entity = 1' }
];

/** Rows that belong to one of the turn's narrative events. */
const TURN_OWNED_THROUGH_EVENTS = [
  { table: 'narrative_events', column: 'event_id' },
  { table: 'narrative_awareness_records', column: 'source_event_id', note: 'no cascade, removed before the events' },
  { table: 'narrative_event_participants', column: 'event_id', note: 'ON DELETE CASCADE' },
  { table: 'narrative_event_evidence', column: 'event_id', note: 'ON DELETE CASCADE; its origin_id names the turn' },
  { table: 'narrative_records', column: 'source_event_id', note: 'ON DELETE CASCADE' },
  { table: 'narrative_change_set_attempts', column: 'event_id', note: 'ON DELETE CASCADE' },
  { table: 'narrative_operation_reviews', column: 'event_id', note: 'ON DELETE CASCADE' }
];

/** Tables with a turn-like column that a dead turn does not own. */
const NOT_TURN_TABLES = [
  { table: 'narrative_origin_lifecycle', reason: 'The tombstone: a late analysis of a dead turn must find it dead.' },
  { table: 'narrative_scenes', reason: 'The live scene, restored from the turn snapshot, not owned by a turn.' },
  { table: 'narrative_turn_replacements', reason: 'Open restore points; settled when the replacement completes or is cancelled.' }
];

const hasTable = (db, name) => Boolean(
  db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
);

/** Dead turns of a workspace, or of every workspace. A turn an open replacement can restore is not dead yet. */
function deadOrigins(db, workspaceId = null) {
  if (!hasTable(db, 'narrative_origin_lifecycle')) return [];
  const rows = db.prepare(`
    SELECT workspace_id AS workspaceId, origin_id AS originId FROM narrative_origin_lifecycle
    WHERE status != 'active' ${workspaceId ? 'AND workspace_id = ?' : ''}
  `).all(...(workspaceId ? [workspaceId] : []));
  if (!rows.length || !hasTable(db, 'narrative_turn_replacements')) return rows;
  const restorable = new Set();
  for (const row of db.prepare('SELECT workspace_id, origin_ids_json FROM narrative_turn_replacements').all()) {
    let ids = [];
    try { ids = JSON.parse(row.origin_ids_json || '[]'); } catch { ids = []; }
    for (const id of ids) restorable.add(`${row.workspace_id}\u0000${id}`);
  }
  return rows.filter(row => !restorable.has(`${row.workspaceId}\u0000${row.originId}`));
}

// The knowledge-card sources a turn's awareness wrote. A grant that cites a Worldbuild entry shares
// that entry's source, so it stays.
function turnKnowledgeSources(events) {
  const sources = [];
  for (const event of events) {
    sources.push({ type: 'narrative', id: event.event_id });
    let operations = [];
    try { operations = JSON.parse(event.operations_json || '[]'); } catch { operations = []; }
    for (const operation of operations) {
      const knowledge = operation?.type === 'grant-knowledge' ? operation.knowledge : null;
      if (!knowledge || knowledge.entryId || !knowledge.id) continue;
      sources.push({ type: 'statement', id: knowledge.id });
      sources.push({ type: 'statement', prefix: `informant:${knowledge.id}:` });
    }
  }
  return sources;
}

function releaseKnowledgeSources(db, workspaceId, sources) {
  if (!sources.length || !hasTable(db, 'worldbuild_knowledge_sources')) return 0;
  const touched = new Set();
  let removed = 0;
  for (const source of sources) {
    const match = source.prefix
      ? { sql: 'source_id LIKE ? ESCAPE \'\\\'', value: `${source.prefix.replace(/[\\%_]/g, '\\$&')}%` }
      : { sql: 'source_id = ?', value: source.id };
    const type = source.prefix ? 'statement' : source.type;
    for (const row of db.prepare(`SELECT card_id FROM worldbuild_knowledge_sources WHERE workspace_id = ? AND source_type = ? AND ${match.sql}`).all(workspaceId, type, match.value)) {
      touched.add(row.card_id);
    }
    removed += db.prepare(`DELETE FROM worldbuild_knowledge_sources WHERE workspace_id = ? AND source_type = ? AND ${match.sql}`)
      .run(workspaceId, type, match.value).changes;
  }
  // A card nothing grants any more is revoked, the same soft delete as a locality that no longer applies.
  const now = Date.now();
  for (const cardId of touched) {
    const remaining = db.prepare('SELECT 1 FROM worldbuild_knowledge_sources WHERE workspace_id = ? AND card_id = ? LIMIT 1').get(workspaceId, cardId);
    if (remaining) continue;
    db.prepare("UPDATE worldbuild_knowledge_cards SET status = 'revoked', updated_at = ? WHERE workspace_id = ? AND card_id = ? AND status = 'active'")
      .run(now, workspaceId, cardId);
  }
  return removed;
}

/** Removes what one dead turn left behind. Its lifecycle row stays as the tombstone. */
function purgeTurn(db, workspaceId, originId) {
  let removed = 0;
  db.transaction(() => {
    db.pragma('defer_foreign_keys = ON');
    const events = hasTable(db, 'narrative_event_evidence') ? db.prepare(`
      SELECT DISTINCT events.event_id, events.operations_json FROM narrative_events events
      JOIN narrative_event_evidence evidence
        ON evidence.workspace_id = events.workspace_id AND evidence.event_id = events.event_id
      WHERE events.workspace_id = ? AND evidence.origin_id = ?
    `).all(workspaceId, originId) : [];
    removed += releaseKnowledgeSources(db, workspaceId, turnKnowledgeSources(events));
    const deleteEvent = db.prepare('DELETE FROM narrative_events WHERE workspace_id = ? AND event_id = ?');
    const deleteAwareness = hasTable(db, 'narrative_awareness_records')
      ? db.prepare('DELETE FROM narrative_awareness_records WHERE workspace_id = ? AND source_event_id = ?')
      : null;
    for (const event of events) {
      if (deleteAwareness) removed += deleteAwareness.run(workspaceId, event.event_id).changes;
      removed += deleteEvent.run(workspaceId, event.event_id).changes;
    }
    for (const { table, column, keep } of TURN_OWNED_COLUMNS) {
      if (!hasTable(db, table)) continue;
      removed += db.prepare(`DELETE FROM ${table} WHERE workspace_id = ? AND ${column} = ?${keep ? ` AND NOT (${keep})` : ''}`)
        .run(workspaceId, originId).changes;
    }
  })();
  return removed;
}

/** Purges every dead turn of a workspace, or of every workspace. Safe to run any number of times. */
function purgeDeadTurns(db, workspaceId = null) {
  let turns = 0;
  let removed = 0;
  for (const origin of deadOrigins(db, workspaceId)) {
    const count = purgeTurn(db, origin.workspaceId, origin.originId);
    if (count) turns += 1;
    removed += count;
  }
  return { turns, removed };
}

module.exports = {
  TURN_OWNED_COLUMNS,
  TURN_OWNED_THROUGH_EVENTS,
  NOT_TURN_TABLES,
  deadOrigins,
  purgeTurn,
  purgeDeadTurns
};
