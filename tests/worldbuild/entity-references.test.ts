import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { SNAPSHOT_ENTITY_COLUMNS } from '../../src/main/features/narrative/narrative-entities';
import { projectCurrentNarrativeRecords } from '../../src/main/features/narrative/narrative-record-projection';
import { insertEntity, openEntityStore, type EntityStoreHarness } from './entity-store-harness';

const require = createRequire(import.meta.url);
const {
  ENTITY_REFERENCE_COLUMNS,
  IGNORED_ENTITY_REFERENCE_COLUMNS,
  releaseOrphanedEntityReferences
} = require('../../src/main/features/worldbuild/entity-references.js');
const { runDatabaseMigrations } = require('../../src/main/database/migrations.js');

// entities, entity_links and chunk_tags are the registry itself and are handled in the store.
const HANDLED_BY_THE_STORE = ['entities.id', 'entity_links.fromId', 'entity_links.toId', 'chunk_tags.entity'];
const LOOKS_LIKE_AN_ENTITY_COLUMN = /(^|_)(entity|subject|target|owner|member|location|item|species|holder|player|focal|from|to)(_entity)?_?ids?(_json)?$|^entityId$|^entity$/i;

let harness: EntityStoreHarness;
beforeEach(() => { harness = openEntityStore(); });
afterEach(() => harness.close());

const key = (entry: { table: string; column: string }) => `${entry.table}.${entry.column}`;
const rows = (sql: string, ...params: unknown[]) => harness.db.prepare(sql).all(...params) as any[];
const row = (sql: string, ...params: unknown[]) => harness.db.prepare(sql).get(...params) as any;
const run = (sql: string, ...params: unknown[]) => harness.db.prepare(sql).run(...params);

describe('the registry of stored entity references', () => {
  test('covers every column in the schema that can hold an entity id', () => {
    const declared = new Set([...ENTITY_REFERENCE_COLUMNS, ...IGNORED_ENTITY_REFERENCE_COLUMNS].map(key));
    const tables = rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").map(table => table.name);
    const missing: string[] = [];
    for (const table of tables) {
      for (const column of rows(`PRAGMA table_info("${table}")`)) {
        const name = `${table}.${column.name}`;
        if (!LOOKS_LIKE_AN_ENTITY_COLUMN.test(column.name)) continue;
        if (HANDLED_BY_THE_STORE.includes(name) || declared.has(name)) continue;
        missing.push(name);
      }
    }
    expect(missing).toEqual([]);
  });

  test('names only columns the schema really has', () => {
    const unknown = [...ENTITY_REFERENCE_COLUMNS, ...IGNORED_ENTITY_REFERENCE_COLUMNS].filter(entry => {
      const columns = rows(`PRAGMA table_info("${entry.table}")`).map(column => column.name);
      return columns.length > 0 && !columns.includes(entry.column);
    });
    expect(unknown).toEqual([]);
  });

  test('the turn snapshot redirects the same columns the registry declares', () => {
    const declared = new Set(ENTITY_REFERENCE_COLUMNS.map(key));
    const snapshotColumns = Object.values(SNAPSHOT_ENTITY_COLUMNS).flatMap(spec =>
      [...(spec.required ?? []), ...(spec.nullable ?? []), ...(spec.lists ?? [])].map(column => `${spec.table}.${column}`));
    const missing = snapshotColumns.filter(name => !declared.has(name) && !HANDLED_BY_THE_STORE.includes(name));
    expect(missing).toEqual([]);
  });
});

// One workspace with the same entity recorded twice, so a merge has something to carry.
function seedWorkspace() {
  const { db } = harness;
  for (const [id, type] of [['nora', 'Characters'], ['nora-copy', 'Characters'], ['orin', 'Characters'],
    ['dock', 'Locations'], ['lantern', 'Items'], ['ferry-crew', 'Factions']] as const) {
    insertEntity(db, id, { type, canonicalName: id });
  }
  insertEntity(db, 'ledger-keeper', { type: 'Characters', data: { customFields: { mentor: 'nora-copy', allies: ['nora-copy', 'orin'] } } });
  run(`INSERT INTO narrative_events VALUES ('ws', 'event-1', 'proposal-1', 'set-1', 'narrative.v1', 'state-change', 'The ferry left.', 'scene-1', 'dock', 1, NULL, 'approved', 1, '[]', 'model', NULL, NULL, 'v1', '2026-09-01T00:00:00.000Z', NULL)`);
  run(`INSERT INTO narrative_event_participants VALUES ('ws', 'event-1', 0, 'nora-copy', 'actor'), ('ws', 'event-1', 1, 'nora', 'actor')`);
  run(`INSERT INTO narrative_event_evidence VALUES ('ws', 'event-1', 'evidence-1', 0, 'chat-message', 'reply-1', 'The ferry left.')`);
  const record = (type: string, id: string, subject: string, payload: unknown) => run(
    `INSERT INTO narrative_records VALUES ('ws', ?, ?, ?, 'event-1', ?, ?, '2026-09-01T00:00:00.000Z')`,
    type, id, subject, `op-${id}`, JSON.stringify(payload));
  record('fact', 'fact-1', 'nora-copy', { id: 'fact-1', proposition: { subjectId: 'nora-copy', predicate: 'owns', object: 'lantern' }, status: 'active', evidenceIds: ['evidence-1'] });
  record('knowledge', 'knowledge-1', 'orin', { id: 'knowledge-1', subjectId: 'orin', proposition: { subjectId: 'nora-copy', predicate: 'works-at', object: 'dock' }, sourceEventId: 'event-1', acquisition: 'witness', confidence: 0.9, accessibility: 'available', status: 'active', informantIds: ['nora-copy'] });
  record('relationship', 'relationship-1', 'nora-copy', { id: 'relationship-1', sourceEntityId: 'nora-copy', targetEntityId: 'nora', dimension: 'trust', value: 40, sourceEventId: 'event-1' });
  record('memory', 'memory-1', 'orin', { id: 'memory-1', subjectId: 'orin', eventId: 'event-1', summary: 'The crossing.', accessibility: 'available', status: 'active', relatedEntityIds: ['nora-copy', 'dock'] });
  run(`INSERT INTO narrative_awareness_records VALUES ('ws', 'awareness-1', 'orin', 'nora-copy', 'active', 'event-1', 'op-awareness-1', '{"id":"awareness-1","subjectId":"orin","targetId":"nora-copy","status":"active","sourceEventId":"event-1"}', '2026-09-01T00:00:00.000Z')`);
  run(`INSERT INTO narrative_scenes VALUES ('ws', 'scene-1', 'active', 'dock', 'subjective', 'nora-copy', '["nora-copy","orin"]', 1, NULL, NULL, NULL)`);
  run(`INSERT INTO narrative_scene_participants VALUES ('ws', 'scene-1', 0, 'nora-copy'), ('ws', 'scene-1', 1, 'nora')`);
  run(`INSERT INTO roleplay_workspace_settings (workspace_id, player_entity_id, location_entity_id, updated_at) VALUES ('ws', 'nora-copy', 'dock', 1)`);
  run(`INSERT INTO roleplay_resource_definitions (workspace_id, definition_id, resource_key, name, description, color, minimum, maximum, starts_full, unit, applies_to_json, update_policy, position, enabled, updated_at) VALUES ('ws', 'health', 'health', 'Health', '', '#fff', 0, 100, 1, '', '["Characters"]', 'automatic', 0, 1, 1)`);
  run(`INSERT INTO roleplay_resource_values VALUES ('ws', 'health', 'entity', 'nora-copy', 55, 0, NULL, NULL, 1, 1), ('ws', 'health', 'entity', 'nora', 90, 0, NULL, NULL, 1, 1)`);
  run(`INSERT INTO roleplay_equipment VALUES ('ws', 'nora-copy', 'lantern', 1)`);
  run(`INSERT INTO roleplay_location_inventory VALUES ('ws', 'dock', 'lantern', 2, 1)`);
  run(`INSERT INTO worldbuild_knowledge_cards VALUES ('ws', 'card-1', 'orin', 'nora-copy', NULL, 'active', 'all-members', 1, 1)`);
  run(`INSERT INTO worldbuild_knowledge_cards VALUES ('ws', 'card-2', 'orin', 'nora', NULL, 'active', 'all-members', 1, 1)`);
  run(`INSERT INTO worldbuild_knowledge_sources VALUES ('ws', 'card-1', 'manual', 'source-1', 1)`);
  run(`INSERT INTO worldbuild_known_relationships VALUES ('ws', 'card-2', 'link-1', 'nora-copy', 'nora-copy', 'related_to', NULL, 'orin', 'Orin', NULL, 'manual', 'link-1', 'inherit', 1)`);
  run(`INSERT INTO worldbuild_event_occurrences VALUES ('ws', 'occurrence-1', 'nora-copy', 'event-1', 'The crossing', '', NULL, NULL, '["nora-copy","orin"]', '["dock"]', '["nora-copy"]', '{}', 'narrative-state', 'reply-1', 0, 1, 1)`);
  run(`INSERT INTO roleplay_scene_changes VALUES ('ws', 'scene-change-1', '{"participantIds":["nora-copy"]}', 'pending', 'ai', 'reply-1', 1, NULL)`);
  run(`INSERT INTO roleplay_turn_presence VALUES ('ws', 'reply-1', 'dock', '["nora-copy","orin"]', NULL, 1)`);
  run(`INSERT INTO roleplay_character_memory VALUES ('ws', 'memory-entry-1', 'nora-copy', 'reply-1', 'heard', 'the ferry is late', 'orin', 0, 1)`);
  run(`INSERT INTO roleplay_character_memory VALUES ('ws', 'memory-entry-2', 'orin', 'reply-1', 'heard', 'the lantern is lost', 'nora-copy', 0, 1)`);
}

describe('merging an entity', () => {
  beforeEach(seedWorkspace);

  test('carries narrative records, awareness and scene state onto the survivor', () => {
    harness.store.mergeEntity('nora-copy', 'nora');

    expect(row("SELECT subject_id, payload_json FROM narrative_records WHERE record_id = 'fact-1'"))
      .toMatchObject({ subject_id: 'nora' });
    expect(JSON.parse(row("SELECT payload_json AS p FROM narrative_records WHERE record_id = 'fact-1'").p).proposition.subjectId).toBe('nora');
    expect(JSON.parse(row("SELECT payload_json AS p FROM narrative_records WHERE record_id = 'knowledge-1'").p))
      .toMatchObject({ proposition: { subjectId: 'nora' }, informantIds: ['nora'] });
    expect(JSON.parse(row("SELECT payload_json AS p FROM narrative_records WHERE record_id = 'memory-1'").p).relatedEntityIds)
      .toEqual(['nora', 'dock']);
    expect(row("SELECT subject_id, target_id, status FROM narrative_awareness_records WHERE awareness_id = 'awareness-1'"))
      .toEqual({ subject_id: 'orin', target_id: 'nora', status: 'active' });
    expect(row("SELECT focal_subject_id AS focal, allowed_subject_ids_json AS allowed FROM narrative_scenes"))
      .toEqual({ focal: 'nora', allowed: '["nora","orin"]' });
    expect(rows('SELECT entity_id FROM narrative_scene_participants').map(entry => entry.entity_id)).toEqual(['nora']);
    expect(row('SELECT player_entity_id AS player FROM roleplay_workspace_settings').player).toBe('nora');
    expect(JSON.parse(row("SELECT payload_json AS p FROM roleplay_scene_changes").p)).toEqual({ participantIds: ['nora'] });
    expect(JSON.parse(row('SELECT data AS d FROM entities WHERE id = ?', 'ledger-keeper').d).customFields)
      .toEqual({ mentor: 'nora', allies: ['nora', 'orin'] });
  });

  test('retires a relationship the merge turned into a relationship with itself', () => {
    harness.store.mergeEntity('nora-copy', 'nora');
    expect(JSON.parse(row("SELECT payload_json AS p FROM narrative_records WHERE record_id = 'relationship-1'").p))
      .toMatchObject({ sourceEntityId: 'nora', targetEntityId: 'nora', status: 'retired' });
  });

  test('keeps one row where both sides held one, and the preferred side decides', () => {
    harness.store.mergeEntity('nora-copy', 'nora');
    expect(rows('SELECT target_id, current_value FROM roleplay_resource_values')).toEqual([{ target_id: 'nora', current_value: 90 }]);
    expect(rows('SELECT entity_id FROM narrative_scene_participants')).toEqual([{ entity_id: 'nora' }]);
    expect(rows("SELECT entity_id FROM narrative_event_participants WHERE event_id = 'event-1'")).toEqual([{ entity_id: 'nora' }]);
  });

  test('the preferred source keeps its own value where both sides had one', () => {
    harness.store.mergeEntity('nora-copy', 'nora', { prefer: 'source' });
    expect(rows('SELECT target_id, current_value FROM roleplay_resource_values')).toEqual([{ target_id: 'nora', current_value: 55 }]);
  });

  test('combines two Knowledge cards about the same pair and drops one about itself', () => {
    harness.store.mergeEntity('nora-copy', 'nora');
    expect(rows('SELECT card_id, owner_id, target_id FROM worldbuild_knowledge_cards'))
      .toEqual([{ card_id: 'card-2', owner_id: 'orin', target_id: 'nora' }]);
    expect(rows('SELECT card_id, source_id FROM worldbuild_knowledge_sources')).toEqual([{ card_id: 'card-2', source_id: 'source-1' }]);
    expect(row('SELECT from_id, from_name FROM worldbuild_known_relationships')).toEqual({ from_id: 'nora', from_name: 'nora' });
  });

  test('adds up the quantities a location held under both ids', () => {
    run(`INSERT INTO roleplay_location_inventory VALUES ('ws', 'dock', 'nora-copy', 3, 1)`);
    run(`INSERT INTO roleplay_location_inventory VALUES ('ws', 'dock', 'nora', 1, 1)`);
    harness.store.mergeEntity('nora-copy', 'nora');
    expect(row("SELECT quantity FROM roleplay_location_inventory WHERE item_id = 'nora'")).toEqual({ quantity: 4 });
  });

  test('records the old id so a write already under way still lands on the survivor', () => {
    harness.store.mergeEntity('nora-copy', 'nora');
    expect(rows('SELECT from_id, to_id FROM entity_redirects')).toEqual([{ from_id: 'nora-copy', to_id: 'nora' }]);
    harness.store.mergeEntity('nora', 'orin');
    expect(rows('SELECT from_id, to_id FROM entity_redirects ORDER BY from_id'))
      .toEqual([{ from_id: 'nora', to_id: 'orin' }, { from_id: 'nora-copy', to_id: 'orin' }]);
  });

  test('carries scene memory and turn presence onto the survivor', () => {
    harness.store.mergeEntity('nora-copy', 'nora');
    expect(rows('SELECT entry_id, entity_id, source_id FROM roleplay_character_memory ORDER BY entry_id')).toEqual([
      { entry_id: 'memory-entry-1', entity_id: 'nora', source_id: 'orin' },
      { entry_id: 'memory-entry-2', entity_id: 'orin', source_id: 'nora' }
    ]);
    expect(row('SELECT present_ids_json AS ids FROM roleplay_turn_presence').ids).toBe('["nora","orin"]');
  });

  test('leaves no reference to the entity that was absorbed', () => {
    harness.store.mergeEntity('nora-copy', 'nora');
    expect(findReferences('nora-copy').filter(place => place !== 'entity_redirects.from_id')).toEqual([]);
  });
});

describe('deleting an entity', () => {
  beforeEach(seedWorkspace);

  test('retires the records about it and keeps the ones that only mention it', () => {
    harness.store.deleteEntity('nora-copy');
    expect(JSON.parse(row("SELECT payload_json AS p FROM narrative_records WHERE record_id = 'fact-1'").p).status).toBe('retracted');
    expect(JSON.parse(row("SELECT payload_json AS p FROM narrative_records WHERE record_id = 'knowledge-1'").p).status).toBe('superseded');
    expect(JSON.parse(row("SELECT payload_json AS p FROM narrative_records WHERE record_id = 'relationship-1'").p).status).toBe('retired');
    const memory = JSON.parse(row("SELECT payload_json AS p FROM narrative_records WHERE record_id = 'memory-1'").p);
    expect(memory).toMatchObject({ status: 'active', relatedEntityIds: ['dock'] });
  });

  test('lets go of scene state, Knowledge cards and awareness', () => {
    harness.store.deleteEntity('nora-copy');
    expect(rows('SELECT * FROM narrative_scene_participants').length).toBe(1);
    expect(row('SELECT status FROM narrative_awareness_records')).toEqual({ status: 'revoked' });
    expect(rows('SELECT card_id FROM worldbuild_knowledge_cards')).toEqual([{ card_id: 'card-2' }]);
    expect(rows('SELECT * FROM worldbuild_known_relationships')).toEqual([]);
    expect(rows('SELECT * FROM roleplay_equipment')).toEqual([]);
    expect(row('SELECT player_entity_id AS player FROM roleplay_workspace_settings').player).toBeNull();
    expect(row('SELECT focal_subject_id AS focal, perspective_access AS access FROM narrative_scenes'))
      .toEqual({ focal: null, access: 'omniscient' });
  });

  test('forgets its scene memory and drops it from what others heard and who was present', () => {
    harness.store.deleteEntity('nora-copy');
    expect(rows('SELECT entry_id, entity_id, source_id FROM roleplay_character_memory')).toEqual([
      { entry_id: 'memory-entry-2', entity_id: 'orin', source_id: null }
    ]);
    expect(row('SELECT present_ids_json AS ids FROM roleplay_turn_presence').ids).toBe('["orin"]');
  });

  test('withdraws pending changes and archives the occurrence it was the event of', () => {
    harness.store.deleteEntity('nora-copy');
    expect(row("SELECT status FROM roleplay_scene_changes WHERE change_id = 'scene-change-1'")).toEqual({ status: 'rejected' });
    expect(row('SELECT archived, participants_json AS participants FROM worldbuild_event_occurrences'))
      .toEqual({ archived: 1, participants: '["orin"]' });
  });

  test('clears it from the custom fields of other entities', () => {
    harness.store.deleteEntity('nora-copy');
    expect(JSON.parse(row('SELECT data AS d FROM entities WHERE id = ?', 'ledger-keeper').d).customFields)
      .toEqual({ allies: ['orin'] });
  });

  test('keeps the approved event as it happened', () => {
    harness.store.deleteEntity('nora-copy');
    expect(rows("SELECT entity_id FROM narrative_event_participants WHERE event_id = 'event-1'").length).toBe(2);
  });

  test('counts what the confirmation warns about', () => {
    expect(harness.store.summarizeBulkEntities('ws', ['nora-copy']))
      .toMatchObject({ narrativeRecords: 4, knowledgeCards: 1, sceneState: 2 });
  });
});

describe('references left by earlier versions', () => {
  test('are released once, by the migration', () => {
    seedWorkspace();
    harness.db.prepare('DELETE FROM entities WHERE id = ?').run('nora-copy');
    expect(releaseOrphanedEntityReferences(harness.db)).toBe(1);
    expect(rows('SELECT * FROM narrative_scene_participants').length).toBe(1);
    expect(JSON.parse(row("SELECT payload_json AS p FROM narrative_records WHERE record_id = 'fact-1'").p).status).toBe('retracted');
    expect(releaseOrphanedEntityReferences(harness.db)).toBe(0);
  });

  test('the migration runs on a database that still has them', () => {
    seedWorkspace();
    harness.db.prepare('DELETE FROM entities WHERE id = ?').run('nora-copy');
    harness.db.prepare("DELETE FROM schema_migrations WHERE id = 'entity_reference_orphans_v1'").run();
    runDatabaseMigrations(harness.db);
    expect(row('SELECT player_entity_id AS player FROM roleplay_workspace_settings').player).toBeNull();
  });
});

// Every declared column that still names the id, for the "nothing left behind" check.
function findReferences(entityId: string): string[] {
  const found: string[] = [];
  for (const entry of [...ENTITY_REFERENCE_COLUMNS, ...IGNORED_ENTITY_REFERENCE_COLUMNS]) {
    const columns = rows(`PRAGMA table_info("${entry.table}")`).map(column => column.name);
    if (!columns.includes(entry.column)) continue;
    const matches = harness.db.prepare(`SELECT COUNT(*) AS count FROM ${entry.table} WHERE ${entry.column} LIKE ?`).get(`%${entityId}%`) as { count: number };
    if (matches.count) found.push(`${entry.table}.${entry.column}`);
  }
  return found;
}

describe('deleting several entities at once', () => {
  beforeEach(seedWorkspace);

  test('releases the references of each one inside the same transaction', () => {
    const result = harness.store.bulkDeleteEntities('ws', ['nora-copy', 'orin']);
    expect(result).toMatchObject({ deleted: 2 });
    expect(rows('SELECT * FROM narrative_scene_participants').map(entry => entry.entity_id)).toEqual(['nora']);
    expect(rows('SELECT * FROM worldbuild_knowledge_cards')).toEqual([]);
    expect(JSON.parse(row("SELECT payload_json AS p FROM narrative_records WHERE record_id = 'memory-1'").p).status).toBe('forgotten');
  });
});

describe('what the story reads afterwards', () => {
  beforeEach(seedWorkspace);

  // The context prints the name it finds, or the raw id when it finds none.
  const current = () => {
    const records = rows(`
      SELECT records.record_type, records.record_id, records.subject_id, records.payload_json, events.narrative_sequence
      FROM narrative_records AS records
      JOIN narrative_events AS events ON events.workspace_id = records.workspace_id AND events.event_id = records.source_event_id
      ORDER BY events.narrative_sequence, records.rowid
    `);
    return projectCurrentNarrativeRecords(records).map(record => record.row.record_id);
  };

  test('a merged entity leaves no record still naming the old id', () => {
    harness.store.mergeEntity('nora-copy', 'nora');
    const remaining = rows('SELECT payload_json AS p FROM narrative_records').map(entry => entry.p).join(' ');
    expect(remaining).not.toContain('nora-copy');
    expect(current()).not.toContain('relationship-1');
  });

  test('a deleted entity drops out of what the story considers current', () => {
    harness.store.deleteEntity('nora-copy');
    expect(current().sort()).toEqual(['memory-1']);
  });
});
