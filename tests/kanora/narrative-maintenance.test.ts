import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import { NarrativeMaintenance } from '../../src/main/features/kanora/narrative-maintenance';
import { loadCurrentNarrativeRecords } from '../../src/main/features/kanora/narrative-record-projection';
import { openTestDatabase } from '../sqlite-test-database';

const WORKSPACE = 'workspace-one';

describe('Narrative State record hygiene', () => {
  let directory: string;
  let db: Database.Database;
  let sequence = 0;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'kallamo-narrative-maintenance-'));
    db = openTestDatabase(join(directory, 'state.db'));
    runDatabaseMigrations(db);
    sequence = 0;
  });

  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function writeRecord(input: {
    recordType: 'fact' | 'knowledge' | 'belief' | 'memory';
    recordId: string;
    subjectId: string;
    payload: Record<string, unknown>;
    interpreter?: 'model' | 'user';
  }): void {
    sequence += 1;
    const eventId = `event-${input.recordId}`;
    db.prepare(`
      INSERT INTO kanora_narrative_events (
        workspace_id, event_id, proposal_id, change_set_id, contract_version, event_type,
        description, narrative_sequence, status, version, operations_json,
        provenance_interpreter, provenance_schema_version, provenance_created_at
      ) VALUES (?, ?, ?, ?, '1.0', 'custom', 'Turn', ?, 'approved', 1, '[]', ?, '1.0', ?)
    `).run(WORKSPACE, eventId, `proposal-${input.recordId}`, `changes-${input.recordId}`,
      sequence, input.interpreter ?? 'model', new Date(sequence * 1000).toISOString());
    db.prepare(`
      INSERT INTO kanora_narrative_event_evidence
        (workspace_id, event_id, evidence_id, ordinal, origin_type, origin_id, excerpt)
      VALUES (?, ?, ?, 0, 'chat-message', ?, '')
    `).run(WORKSPACE, eventId, `evidence-${input.recordId}`, `origin-${input.recordId}`);
    db.prepare(`
      INSERT INTO kanora_narrative_records
        (workspace_id, record_type, record_id, subject_id, source_event_id, operation_id, payload_json, applied_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(WORKSPACE, input.recordType, input.recordId, input.subjectId, eventId,
      `operation-${input.recordId}`, JSON.stringify(input.payload), new Date(sequence * 1000).toISOString());
  }

  function knowledgePayload(id: string, predicate: string, object: unknown, extra: Record<string, unknown> = {}) {
    return {
      id, entryId: `entry-${id}`, subjectId: 'elian',
      proposition: { subjectId: 'null-lead', predicate, object },
      sourceEventId: `event-${id}`, acquisition: 'witness', confidence: 0.95,
      accessibility: 'available', status: 'active', ...extra
    };
  }

  test('retires the same statement stored under a renamed predicate and a second acquisition', () => {
    const statement = 'It is heavier than iron by volume.';
    writeRecord({ recordType: 'knowledge', recordId: 'k1', subjectId: 'elian', payload: knowledgePayload('k1', 'material-density', statement) });
    writeRecord({ recordType: 'knowledge', recordId: 'k2', subjectId: 'elian', payload: knowledgePayload('k2', 'worldbuild-statement', statement, { acquisition: 'reported', confidence: 0.75 }) });
    writeRecord({ recordType: 'knowledge', recordId: 'k3', subjectId: 'elian', payload: knowledgePayload('k3', 'observed-weight', statement) });

    const report = new NarrativeMaintenance(db).compact(WORKSPACE);

    expect(report).toMatchObject({ scanned: 3, duplicates: 2, retired: 2 });
    const current = loadCurrentNarrativeRecords(db, { workspaceId: WORKSPACE, recordTypes: ['knowledge'] });
    expect(current.map(record => record.row.record_id)).toEqual(['k1']);
  });

  test('keeps the same statement held by two different subjects', () => {
    const statement = 'The shoring runes were forged with the Imperial seal.';
    writeRecord({ recordType: 'knowledge', recordId: 'k1', subjectId: 'elian', payload: { ...knowledgePayload('k1', 'evidence', statement), subjectId: 'elian' } });
    writeRecord({ recordType: 'knowledge', recordId: 'k2', subjectId: 'kepler', payload: { ...knowledgePayload('k2', 'evidence', statement), subjectId: 'kepler' } });

    expect(new NarrativeMaintenance(db).compact(WORKSPACE)).toMatchObject({ duplicates: 0, retired: 0 });
  });

  test('retires model-written scene detail and content that is only an identifier', () => {
    writeRecord({
      recordType: 'fact', recordId: 'f1', subjectId: 'kepler',
      payload: { id: 'f1', proposition: { subjectId: 'kepler', predicate: 'current-location', object: 'bd4d6b65-3500-42f3-ac94-d73d9e76ab02' }, status: 'active', evidenceIds: [] }
    });
    writeRecord({
      recordType: 'knowledge', recordId: 'k1', subjectId: 'kepler',
      payload: knowledgePayload('k1', 'seen-at', '7409ca21-6297-4fea-82eb-9109cbd85bb6')
    });

    const report = new NarrativeMaintenance(db).compact(WORKSPACE);

    expect(report).toMatchObject({ sceneState: 1, identifierContent: 1, retired: 2 });
    expect(loadCurrentNarrativeRecords(db, { workspaceId: WORKSPACE, recordTypes: ['fact', 'knowledge'] })).toEqual([]);
  });

  test('never judges a hand-authored record for durability', () => {
    writeRecord({
      recordType: 'knowledge', recordId: 'k1', subjectId: 'kepler', interpreter: 'user',
      payload: knowledgePayload('k1', 'current-activity', 'Waiting by the forge.')
    });

    expect(new NarrativeMaintenance(db).compact(WORKSPACE)).toMatchObject({ retired: 0 });
  });

  test('previews without changing anything', () => {
    const statement = 'Alistair carries a glass heart in his chest.';
    writeRecord({ recordType: 'memory', recordId: 'm1', subjectId: 'elian', payload: { id: 'm1', subjectId: 'elian', eventId: 'event-m1', summary: statement, accessibility: 'available', status: 'active' } });
    writeRecord({ recordType: 'memory', recordId: 'm2', subjectId: 'elian', payload: { id: 'm2', subjectId: 'elian', eventId: 'event-m2', summary: `${statement}  `, accessibility: 'available', status: 'active' } });

    const maintenance = new NarrativeMaintenance(db);
    expect(maintenance.preview(WORKSPACE)).toMatchObject({ duplicates: 1, retired: 1 });
    expect(loadCurrentNarrativeRecords(db, { workspaceId: WORKSPACE, recordTypes: ['memory'] })).toHaveLength(2);

    maintenance.compact(WORKSPACE);
    expect(loadCurrentNarrativeRecords(db, { workspaceId: WORKSPACE, recordTypes: ['memory'] })).toHaveLength(1);
  });

  test('leaves the ledger intact so a retired record stays auditable', () => {
    const statement = 'The council buried the shaft report.';
    writeRecord({ recordType: 'fact', recordId: 'f1', subjectId: 'council', payload: { id: 'f1', proposition: { subjectId: 'council', predicate: 'cover-up', object: statement }, status: 'active', evidenceIds: [] } });
    writeRecord({ recordType: 'fact', recordId: 'f2', subjectId: 'council', payload: { id: 'f2', proposition: { subjectId: 'council', predicate: 'concealment', object: statement }, status: 'active', evidenceIds: [] } });

    new NarrativeMaintenance(db).compact(WORKSPACE);

    expect(db.prepare('SELECT COUNT(*) AS count FROM kanora_narrative_records').get()).toEqual({ count: 2 });
    expect(db.prepare('SELECT COUNT(*) AS count FROM kanora_narrative_events').get()).toEqual({ count: 2 });
    expect(db.prepare("SELECT json_extract(payload_json, '$.status') AS status FROM kanora_narrative_records WHERE record_id = 'f2'").get())
      .toEqual({ status: 'retracted' });
  });
});
