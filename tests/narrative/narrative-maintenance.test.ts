import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import { NarrativeMaintenance } from '../../src/main/features/narrative/narrative-maintenance';
import { loadCurrentNarrativeRecords } from '../../src/main/features/narrative/narrative-record-projection';
import { NarrativeWorld } from '../../src/main/features/narrative/umwelt/narrative-world';
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

  // Written straight to the story file, so a world from before the write-time checks (with
  // duplicates and scene detail) can be built for the cleanup to find.
  function writeRecord(input: {
    recordType: 'fact' | 'knowledge' | 'belief' | 'memory';
    recordId: string;
    subjectId: string;
    payload: Record<string, any>;
    interpreter?: 'model' | 'user';
  }): void {
    sequence += 1;
    const world = NarrativeWorld.of(db, WORKSPACE);
    const about = input.payload.proposition?.subjectId;
    world.ensureEntities([input.subjectId, ...(about ? [about] : [])]);
    const provenance = {
      origin: input.interpreter === 'user' ? { kind: 'human' } : { kind: 'model', model: 'interpreter' },
      metadata: { k: input.recordType, originType: 'chat-message' }
    };
    const claim = (subject: string, predicate: string, value: unknown) => ({ subject, predicate, object: { kind: 'value', value }, polarity: true });
    const record = input.recordType === 'fact'
      ? { kind: 'fact', id: input.recordId, claim: claim(about, input.payload.proposition.predicate, input.payload.proposition.object), provenance }
      : input.recordType === 'memory'
        ? { kind: 'holding', id: input.recordId, holder: input.subjectId, attitude: 'remembers', claim: claim(input.subjectId, 'memory', input.payload.summary), acquisition: { kind: 'authored' }, text: input.payload.summary, provenance }
        : { kind: 'holding', id: input.recordId, holder: input.subjectId, attitude: input.recordType === 'belief' ? 'believes' : 'knows', claim: claim(about, input.payload.proposition.predicate, input.payload.proposition.object), acquisition: { kind: 'authored' }, provenance };
    world.call('commit', {
      attemptId: input.recordId,
      event: { id: `event-${input.recordId}`, type: 'custom', title: 'Turn', position: { tick: sequence }, provenance },
      records: [record]
    });
  }

  function knowledgePayload(id: string, predicate: string, object: unknown, extra: Record<string, unknown> = {}) {
    return {
      id, entryId: `entry-${id}`, subjectId: 'brann',
      proposition: { subjectId: 'null-lead', predicate, object },
      sourceEventId: `event-${id}`, acquisition: 'witness', confidence: 0.95,
      accessibility: 'available', status: 'active', ...extra
    };
  }

  test('retires the same statement stored under a renamed predicate and a second acquisition', () => {
    const statement = 'It is heavier than iron by volume.';
    writeRecord({ recordType: 'knowledge', recordId: 'k1', subjectId: 'brann', payload: knowledgePayload('k1', 'material-density', statement) });
    writeRecord({ recordType: 'knowledge', recordId: 'k2', subjectId: 'brann', payload: knowledgePayload('k2', 'worldbuild-statement', statement, { acquisition: 'reported', confidence: 0.75 }) });
    writeRecord({ recordType: 'knowledge', recordId: 'k3', subjectId: 'brann', payload: knowledgePayload('k3', 'observed-weight', statement) });

    const report = new NarrativeMaintenance(db).compact(WORKSPACE);

    expect(report).toMatchObject({ scanned: 3, duplicates: 2, retired: 2 });
    const current = loadCurrentNarrativeRecords(db, { workspaceId: WORKSPACE, recordTypes: ['knowledge'] });
    expect(current.map(record => record.row.record_id)).toEqual(['k1']);
  });

  test('keeps the same statement held by two different subjects', () => {
    const statement = 'The shoring runes were forged with the Imperial seal.';
    writeRecord({ recordType: 'knowledge', recordId: 'k1', subjectId: 'brann', payload: { ...knowledgePayload('k1', 'evidence', statement), subjectId: 'brann' } });
    writeRecord({ recordType: 'knowledge', recordId: 'k2', subjectId: 'corwin', payload: { ...knowledgePayload('k2', 'evidence', statement), subjectId: 'corwin' } });

    expect(new NarrativeMaintenance(db).compact(WORKSPACE)).toMatchObject({ duplicates: 0, retired: 0 });
  });

  test('retires model-written scene detail and content that is only an identifier', () => {
    writeRecord({
      recordType: 'fact', recordId: 'f1', subjectId: 'corwin',
      payload: { id: 'f1', proposition: { subjectId: 'corwin', predicate: 'current-location', object: 'bd4d6b65-3500-42f3-ac94-d73d9e76ab02' }, status: 'active', evidenceIds: [] }
    });
    writeRecord({
      recordType: 'knowledge', recordId: 'k1', subjectId: 'corwin',
      payload: knowledgePayload('k1', 'seen-at', '7409ca21-6297-4fea-82eb-9109cbd85bb6')
    });

    const report = new NarrativeMaintenance(db).compact(WORKSPACE);

    expect(report).toMatchObject({ sceneState: 1, identifierContent: 1, retired: 2 });
    expect(loadCurrentNarrativeRecords(db, { workspaceId: WORKSPACE, recordTypes: ['fact', 'knowledge'] })).toEqual([]);
  });

  test('never judges a hand-authored record for durability', () => {
    writeRecord({
      recordType: 'knowledge', recordId: 'k1', subjectId: 'corwin', interpreter: 'user',
      payload: knowledgePayload('k1', 'current-activity', 'Waiting by the forge.')
    });

    expect(new NarrativeMaintenance(db).compact(WORKSPACE)).toMatchObject({ retired: 0 });
  });

  test('previews without changing anything', () => {
    const statement = 'Rosalind carries a glass heart in his chest.';
    writeRecord({ recordType: 'memory', recordId: 'm1', subjectId: 'brann', payload: { id: 'm1', subjectId: 'brann', eventId: 'event-m1', summary: statement, accessibility: 'available', status: 'active' } });
    writeRecord({ recordType: 'memory', recordId: 'm2', subjectId: 'brann', payload: { id: 'm2', subjectId: 'brann', eventId: 'event-m2', summary: `${statement}  `, accessibility: 'available', status: 'active' } });

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

    const world = NarrativeWorld.of(db, WORKSPACE);
    expect(loadCurrentNarrativeRecords(db, { workspaceId: WORKSPACE, recordTypes: ['fact'] }).map(record => record.row.record_id)).toEqual(['f1']);
    const trace = world.call<{ status?: string; record: { id: string } }>('trace', { recordId: 'f2' });
    expect(trace).toMatchObject({ status: 'retracted', record: { id: 'f2' } });
    expect(world.call<{ items: unknown[] }>('canon', { at: { tick: 2 } }).items).toHaveLength(2);
  });
});
