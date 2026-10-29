import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openFullSchemaDatabase, type FullSchemaDatabase } from './full-schema-harness';

const require = createRequire(import.meta.url);
const {
  TURN_OWNED_COLUMNS,
  TURN_OWNED_THROUGH_EVENTS,
  NOT_TURN_TABLES,
  deadOrigins,
  purgeDeadTurns
} = require('../../src/main/features/narrative/turn-ownership.js');

const LOOKS_LIKE_A_TURN_COLUMN = /^(origin_id|provenance_id|source_event_id|event_id|narrative_event_id)$/;

let harness: FullSchemaDatabase;
beforeEach(() => { harness = openFullSchemaDatabase(); });
afterEach(() => harness.close());

const rows = (sql: string, ...params: unknown[]) => harness.db.prepare(sql).all(...params) as any[];
const count = (sql: string, ...params: unknown[]) => (harness.db.prepare(sql).get(...params) as any).count as number;
const columnsOf = (table: string) => rows(`PRAGMA table_info("${table}")`);
const schemaTables = () => rows("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'")
  .map(table => table.name as string)
  .filter(name => !name.startsWith('knowledge_chunks_fts'));

// One row with the given values; every other column gets a value named after it, so ids differ per row.
function insert(table: string, values: Record<string, unknown>, tag: string) {
  const columns = columnsOf(table);
  const filled = columns.map(info => {
    if (info.name in values) return values[info.name];
    if (/(_json|Json)$|^(data|aliases)$/.test(info.name)) return '{}';
    return /INT|REAL/i.test(info.type) ? 1 : `${info.name}-${tag}`;
  });
  harness.db.prepare(`INSERT INTO ${table} (${columns.map(info => `"${info.name}"`).join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`)
    .run(...filled);
}

describe('the registry of turn-owned tables', () => {
  test('declares every table with a turn or event column', () => {
    const declared = new Set([
      ...TURN_OWNED_COLUMNS.map((entry: any) => entry.table),
      ...TURN_OWNED_THROUGH_EVENTS.map((entry: any) => entry.table),
      ...NOT_TURN_TABLES.map((entry: any) => entry.table)
    ]);
    const missing = schemaTables().filter(table => !declared.has(table)
      && columnsOf(table).some(column => LOOKS_LIKE_A_TURN_COLUMN.test(column.name)));
    expect(missing).toEqual([]);
  });

  test('names only columns the schema really has', () => {
    const unknown = [...TURN_OWNED_COLUMNS, ...TURN_OWNED_THROUGH_EVENTS].filter((entry: any) =>
      !columnsOf(entry.table).some(column => column.name === entry.column));
    expect(unknown).toEqual([]);
  });
});

describe('purgeDeadTurns', () => {
  function seedTurn(originId: string, status: string) {
    const { db } = harness;
    db.pragma('ignore_check_constraints = ON');
    db.transaction(() => {
      db.pragma('defer_foreign_keys = ON');
      insert('narrative_origin_lifecycle', { workspace_id: 'ws', origin_id: originId, status }, originId);
      const eventId = `event-${originId}`;
      // Parents some owned rows point at.
      const parents: Record<string, Record<string, unknown>> = {
        worldbuild_event_occurrences: { narrative_event_id: eventId },
        roleplay_resource_changes: { definition_id: 'definition' }
      };
      if (!count("SELECT COUNT(*) AS count FROM roleplay_resource_definitions WHERE definition_id = 'definition'")) {
        insert('roleplay_resource_definitions', { workspace_id: 'ws', definition_id: 'definition' }, 'definition');
      }
      insert('narrative_events', {
        workspace_id: 'ws', event_id: eventId,
        operations_json: JSON.stringify([
          { type: 'grant-awareness', awareness: { subjectId: 'kepler', targetId: 'rue' } },
          { type: 'grant-knowledge', knowledge: { id: `knowledge-${originId}`, subjectId: 'kepler', proposition: { subjectId: 'rue' } } },
          { type: 'grant-knowledge', knowledge: { id: `seeded-${originId}`, entryId: `entry-${originId}`, subjectId: 'kepler', proposition: { subjectId: 'lantern' } } }
        ])
      }, originId);
      for (const { table, column } of TURN_OWNED_COLUMNS) insert(table, { workspace_id: 'ws', [column]: originId, ...parents[table] }, originId);
      insert('narrative_event_evidence', { workspace_id: 'ws', event_id: eventId, origin_id: originId, ordinal: 0 }, originId);
      insert('narrative_event_participants', { workspace_id: 'ws', event_id: eventId }, originId);
      insert('narrative_records', { workspace_id: 'ws', source_event_id: eventId }, originId);
      insert('narrative_awareness_records', { workspace_id: 'ws', source_event_id: eventId }, originId);
      insert('narrative_change_set_attempts', { workspace_id: 'ws', event_id: eventId }, originId);
      insert('narrative_operation_reviews', { workspace_id: 'ws', event_id: eventId }, originId);
      // A card granted only by this turn, and one the Worldbuild grants as well.
      insert('worldbuild_knowledge_cards', { workspace_id: 'ws', card_id: `card-${originId}`, status: 'active' }, originId);
      insert('worldbuild_knowledge_sources', { workspace_id: 'ws', card_id: `card-${originId}`, source_type: 'narrative', source_id: eventId }, `${originId}-a`);
      insert('worldbuild_knowledge_sources', { workspace_id: 'ws', card_id: `card-${originId}`, source_type: 'statement', source_id: `informant:knowledge-${originId}:edwin` }, `${originId}-b`);
      insert('worldbuild_knowledge_cards', { workspace_id: 'ws', card_id: `shared-${originId}`, status: 'active' }, `${originId}-shared`);
      insert('worldbuild_knowledge_sources', { workspace_id: 'ws', card_id: `shared-${originId}`, source_type: 'statement', source_id: `knowledge-${originId}` }, `${originId}-c`);
      insert('worldbuild_knowledge_sources', { workspace_id: 'ws', card_id: `shared-${originId}`, source_type: 'statement', source_id: `entry-${originId}` }, `${originId}-d`);
    })();
    db.pragma('ignore_check_constraints = OFF');
  }

  test('removes what a dead turn left, keeps its tombstone and leaves a live turn alone', () => {
    seedTurn('dead', 'deleted');
    seedTurn('live', 'active');
    harness.db.prepare("UPDATE roleplay_entity_changes SET created_entity = 1 WHERE provenance_id = 'dead'").run();

    const result = purgeDeadTurns(harness.db, 'ws');
    expect(result.turns).toBe(1);

    const left: string[] = [];
    const lost: string[] = [];
    for (const { table, column } of TURN_OWNED_COLUMNS) {
      if (table !== 'roleplay_entity_changes' && count(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = 'dead'`)) left.push(table);
      if (!count(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = 'live'`)) lost.push(table);
    }
    for (const { table, column } of TURN_OWNED_THROUGH_EVENTS) {
      if (count(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = 'event-dead'`)) left.push(table);
      if (!count(`SELECT COUNT(*) AS count FROM ${table} WHERE ${column} = 'event-live'`)) lost.push(table);
    }
    expect(left).toEqual([]);
    expect(lost).toEqual([]);
    // The row that created an entity stays, so the same arrival can take the entity back.
    expect(count("SELECT COUNT(*) AS count FROM roleplay_entity_changes WHERE provenance_id = 'dead'")).toBe(1);
    expect(count("SELECT COUNT(*) AS count FROM narrative_origin_lifecycle WHERE origin_id = 'dead'")).toBe(1);

    const cards = Object.fromEntries(rows("SELECT card_id, status FROM worldbuild_knowledge_cards").map(row => [row.card_id, row.status]));
    expect(cards).toEqual({ 'card-dead': 'revoked', 'shared-dead': 'active', 'card-live': 'active', 'shared-live': 'active' });
    expect(rows("SELECT source_id FROM worldbuild_knowledge_sources WHERE card_id = 'shared-dead'").map(row => row.source_id)).toEqual(['entry-dead']);
    expect(purgeDeadTurns(harness.db, 'ws').turns).toBe(0);
  });

  test('a turn an open replacement can still restore is not dead yet', () => {
    seedTurn('replaced', 'superseded');
    harness.db.prepare(`
      INSERT INTO narrative_turn_replacements (workspace_id, replacement_id, origin_ids_json, restore_json, created_at)
      VALUES ('ws', 'replacement', '["replaced"]', '{}', 1)
    `).run();
    expect(deadOrigins(harness.db, 'ws')).toEqual([]);
    harness.db.prepare("DELETE FROM narrative_turn_replacements").run();
    expect(deadOrigins(harness.db, 'ws').map((origin: any) => origin.originId)).toEqual(['replaced']);
  });
});
