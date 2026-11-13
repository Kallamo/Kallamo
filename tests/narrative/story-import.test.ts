import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { loadCurrentNarrativeRecords, type NarrativeRecordType } from '../../src/main/features/narrative/narrative-record-projection';
import { importLegacyStory, LEGACY_STORY_TABLES } from '../../src/main/features/narrative/umwelt/story-import';
import { isAware } from '../../src/main/features/narrative/umwelt/story-awareness';
import { retireOrigins } from '../../src/main/features/narrative/umwelt/story-lifecycle';
import { openFullSchemaDatabase, type FullSchemaDatabase } from '../database/full-schema-harness';

const require = createRequire(import.meta.url);
const { runDatabaseMigrations } = require('../../src/main/database/migrations.js');

const WS = 'ws';
let harness: FullSchemaDatabase;
let db: any;

function entity(id: string, type = 'Characters') {
  db.prepare(`INSERT INTO entities (id, workspaceId, type, canonicalName, aliases, lore, data, status, createdAt) VALUES (?, ?, ?, ?, '[]', '', '{}', 'confirmed', 1)`)
    .run(id, WS, type, id[0].toUpperCase() + id.slice(1));
}

/** An event as an earlier version applied it: the journal row and the records it wrote. */
function legacyEvent(input: {
  eventId: string; sequence: number; originType: string; originId: string;
  records?: Array<{ type: string; id: string; subjectId: string; payload: Record<string, unknown> }>;
  awareness?: Array<{ id: string; subjectId: string; targetId: string }>;
}) {
  const at = '2026-09-01T00:00:00.000Z';
  db.prepare(`
    INSERT INTO narrative_events (workspace_id, event_id, proposal_id, change_set_id, contract_version, event_type, description,
      narrative_sequence, status, version, operations_json, provenance_interpreter, provenance_schema_version, provenance_created_at)
    VALUES (?, ?, ?, ?, '1.0', 'revelation', ?, ?, 'approved', 2, '[]', 'model', '1.0', ?)
  `).run(WS, input.eventId, `proposal-${input.eventId}`, `change-${input.eventId}`, `Event ${input.eventId}.`, input.sequence, at);
  db.prepare(`INSERT INTO narrative_event_participants (workspace_id, event_id, ordinal, entity_id, role) VALUES (?, ?, 0, 'elias', 'participant')`)
    .run(WS, input.eventId);
  db.prepare(`INSERT INTO narrative_event_evidence (workspace_id, event_id, evidence_id, ordinal, origin_type, origin_id, excerpt) VALUES (?, ?, ?, 0, ?, ?, 'Excerpt.')`)
    .run(WS, input.eventId, `evidence-${input.eventId}`, input.originType, input.originId);
  for (const record of input.records ?? []) {
    db.prepare(`INSERT INTO narrative_records (workspace_id, record_type, record_id, subject_id, source_event_id, operation_id, payload_json, applied_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .run(WS, record.type, record.id, record.subjectId, input.eventId, `op-${record.id}`, JSON.stringify({ id: record.id, ...record.payload }), at);
  }
  for (const awareness of input.awareness ?? []) {
    db.prepare(`INSERT INTO narrative_awareness_records (workspace_id, awareness_id, subject_id, target_id, status, source_event_id, operation_id, payload_json, applied_at) VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?)`)
      .run(WS, awareness.id, awareness.subjectId, awareness.targetId, input.eventId, `op-${awareness.id}`,
        JSON.stringify({ id: awareness.id, subjectId: awareness.subjectId, targetId: awareness.targetId, status: 'active', sourceEventId: input.eventId }), at);
  }
}

const knowledge = (id: string, subjectId: string, object: string, eventId: string) => ({
  type: 'knowledge', id, subjectId,
  payload: { entryId: id, subjectId, proposition: { subjectId: 'guild', predicate: 'hidden-door', object }, sourceEventId: eventId, acquisition: 'witness', confidence: 1, accessibility: 'available', status: 'active' }
});

const held = (type: NarrativeRecordType) => loadCurrentNarrativeRecords(db, { workspaceId: WS, recordTypes: [type] })
  .map(({ row }) => [row.subject_id, row.record_id]);

beforeEach(() => {
  harness = openFullSchemaDatabase({ stopBefore: 'narrative_story_import_v1' });
  db = harness.db;
  db.prepare(`INSERT INTO chats (id, title, description, memoryBlocks, knowledgeFiles, activeProfiles, activeWorkflows) VALUES (?, 'Story', '', '[]', '[]', '[]', '[]')`).run(WS);
  entity('tess');
  entity('elias');
  entity('guild', 'Factions');
  legacyEvent({
    eventId: 'e1', sequence: 1, originType: 'chat-message', originId: 'm1',
    records: [knowledge('k1', 'elias', 'under the chapel', 'e1')],
    awareness: [{ id: 'a1', subjectId: 'elias', targetId: 'guild' }]
  });
  legacyEvent({ eventId: 'e2', sequence: 2, originType: 'chat-message', originId: 'm2', records: [knowledge('k2', 'tess', 'in the cellar', 'e2')] });
  db.prepare(`INSERT INTO narrative_origin_lifecycle (workspace_id, origin_id, status, replacement_origin_id, updated_at) VALUES (?, 'm2', 'superseded', 'm3', 1)`).run(WS);
  legacyEvent({
    eventId: 'e3', sequence: 3, originType: 'world-action', originId: 'w1',
    records: [{ type: 'memory', id: 'mem1', subjectId: 'elias', payload: { subjectId: 'elias', eventId: 'e3', summary: 'The bell rang twice at dusk.', accessibility: 'available', status: 'active' } }]
  });
});
afterEach(() => harness.close());

describe('moving an earlier version story into the story file', () => {
  test('the upgrade replays what was applied, leaves dead turns out and drops the old tables', () => {
    runDatabaseMigrations(db);

    expect(held('knowledge')).toEqual([['elias', 'k1']]);
    expect(held('memory')).toEqual([['elias', 'mem1']]);
    expect(isAware(db, WS, 'elias', 'guild')).toBe(true);
    for (const table of LEGACY_STORY_TABLES) {
      expect(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table)).toBeUndefined();
    }
  });

  test('a turn moved over can still be removed later', () => {
    runDatabaseMigrations(db);
    const origins = db.prepare('SELECT DISTINCT origin_id FROM narrative_story_records WHERE workspace_id = ?').all(WS).map((row: any) => row.origin_id);
    expect(origins).toEqual(['m1']);

    retireOrigins(db, WS, ['m1']);
    expect(held('knowledge')).toEqual([]);
    expect(held('memory')).toEqual([['elias', 'mem1']]);
  });

  test('an upgrade that stopped halfway and runs again writes nothing twice', () => {
    expect(importLegacyStory(db)).toEqual({ workspaces: 1, events: 2, skippedEvents: 0 });
    runDatabaseMigrations(db);

    expect(held('knowledge')).toEqual([['elias', 'k1']]);
    expect(held('memory')).toEqual([['elias', 'mem1']]);
  });
});
