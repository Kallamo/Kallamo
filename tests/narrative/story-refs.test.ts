import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import { NarrativeStateSystem, type ExtractedNarrativeEvent } from '../../src/main/features/narrative/narrative-state';
import { loadCurrentNarrativeRecords } from '../../src/main/features/narrative/narrative-record-projection';
import { selectPerspectiveRecords } from '../../src/main/features/narrative/narrative-state-routing.js';
import { resolveRecordReferences } from '../../src/main/features/narrative/story-refs.js';
import { openTestDatabase } from '../sqlite-test-database';

const WORKSPACE = 'workspace-one';

describe('Story refs', () => {
  let directory: string;
  let db: Database.Database;
  let system: NarrativeStateSystem;
  const allowed = new Set(['elias', 'tess', 'guild']);

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'kallamo-story-refs-'));
    db = openTestDatabase(join(directory, 'state.db'));
    db.pragma('foreign_keys = ON');
    runDatabaseMigrations(db);
    db.exec(`CREATE TABLE entity_links (
      id TEXT PRIMARY KEY, workspaceId TEXT, fromId TEXT, relType TEXT,
      toId TEXT, label TEXT, metadata_json TEXT, createdAt INTEGER
    )`);
    system = new NarrativeStateSystem(db);
  });

  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function record(originId: string, event: ExtractedNarrativeEvent, interpreter: 'model' | 'user' = 'model') {
    return system.createEvent({
      workspaceId: WORKSPACE, originId, interpreterId: 'system-model', event, allowedEntityIds: allowed,
      storyMinute: null, provenanceInterpreter: interpreter
    });
  }

  function play(interpreter: 'model' | 'user' = 'model') {
    record('turn-1', {
      type: 'revelation', description: 'Tess tells Elias the gate code of the guild hall.', excerpt: 'The gate code is Dawnfall.',
      participantIds: ['tess', 'elias'], confidence: 0.98,
      operations: [
        { type: 'awareness', subjectId: 'elias', targetId: 'guild', confidence: 0.98 },
        { type: 'knowledge', subjectId: 'tess', proposition: { subjectId: 'guild', predicate: 'gate-code', object: 'The gate code of the guild hall is Dawnfall.' }, category: 'capability', acquisition: 'witness', confidence: 0.98 },
        { type: 'knowledge', subjectId: 'elias', proposition: { subjectId: 'guild', predicate: 'gate-code', object: 'The gate code of the guild hall is Dawnfall.' }, category: 'capability', acquisition: 'reported', informantIds: ['tess'], confidence: 0.98 },
        { type: 'memory', subjectId: 'elias', summary: 'Tess trusted Elias with the gate code of the guild hall.', category: 'bond', salience: 0.92 }
      ]
    }, interpreter);
  }

  function slice() {
    const rows = loadCurrentNarrativeRecords(db, { workspaceId: WORKSPACE, recordTypes: ['knowledge', 'belief', 'memory', 'fact'] })
      .reverse()
      .map(({ row, payload, interpreter }) => ({ type: row.record_type, subjectId: row.subject_id || null, value: payload, interpreter }));
    return selectPerspectiveRecords(rows, { holderIds: ['elias', 'tess'], targetIds: ['guild'], focusIds: ['elias', 'tess'], withRefs: true });
  }

  function refOf(selection: ReturnType<typeof slice>, holder: string, type: string) {
    const found = selection.records.find((item: { subjectId?: string; type: string }) => item.subjectId === holder && item.type === type);
    return (found as { ref?: string } | undefined)?.ref as string;
  }

  function current(holder: string, type: 'knowledge' | 'memory') {
    return loadCurrentNarrativeRecords(db, { workspaceId: WORKSPACE, recordTypes: [type], subjectIds: [holder] }).map(item => item.payload);
  }

  test('the slice names each holding with a ref and keeps ids out of what the model reads', () => {
    play();
    const selection = slice();
    const refs = selection.records.map((item: { ref?: string }) => item.ref).filter(Boolean);
    expect(refs).toEqual(['#1', '#2', '#3']);
    expect(JSON.stringify(selection.records)).not.toMatch(/knowledge_|memory_|entry_/);
    expect(selection.refs!.get('#1').value.id).toBeTruthy();
  });

  test('a ref that names nothing is reported, and what a record replaces never comes from the model', () => {
    const { events, unresolved } = resolveRecordReferences([{
      type: 'custom', description: 'x', excerpt: 'x', participantIds: ['elias'], confidence: 0.95,
      operations: [
        { type: 'end', ref: '#9', how: 'forgot' },
        { type: 'knowledge', subjectId: 'elias', supersedesId: 'knowledge_other', entryId: 'entry_other', proposition: { subjectId: 'guild', predicate: 'statement', object: 'A long enough statement.' } }
      ]
    }], new Map());
    expect(unresolved).toEqual([{ ref: '#9', type: 'end', reason: 'unknown-ref' }]);
    expect(events[0].operations).toHaveLength(1);
    expect(events[0].operations[0]).not.toHaveProperty('supersedesId');
    expect(events[0].operations[0]).not.toHaveProperty('entryId');
  });

  test('ending a knowledge by its ref ends only that holder\'s record', () => {
    play();
    const selection = slice();
    const { events } = resolveRecordReferences([{
      type: 'discovery', description: 'Elias finds the gate code no longer opens the guild hall.', excerpt: 'The lock does not turn.',
      participantIds: ['elias'], confidence: 0.96,
      operations: [{ type: 'end', ref: refOf(selection, 'elias', 'knowledge'), how: 'disproved', reason: 'the code failed' }]
    }], selection.refs);
    const result = record('turn-2', events[0]);
    expect(result.decision).toBe('automatic');
    expect(current('elias', 'knowledge')).toEqual([]);
    expect(current('tess', 'knowledge')).toHaveLength(1);
  });

  test('a settled intent ends for each holder named by ref, and a memory cannot be settled', () => {
    play();
    const selection = slice();
    const { events, unresolved } = resolveRecordReferences([{
      type: 'custom', description: 'The guild changes the gate code and the old one stops mattering.', excerpt: 'New code tonight.',
      participantIds: ['elias', 'tess'], confidence: 0.96,
      operations: [
        { type: 'end', ref: refOf(selection, 'elias', 'knowledge'), how: 'settled', reason: 'overtaken' },
        { type: 'end', ref: refOf(selection, 'tess', 'knowledge'), how: 'settled', reason: 'overtaken' },
        { type: 'end', ref: refOf(selection, 'elias', 'memory'), how: 'settled' }
      ]
    }], selection.refs);
    expect(unresolved).toEqual([{ ref: refOf(selection, 'elias', 'memory'), type: 'end', reason: 'cannot-end' }]);
    record('turn-2', events[0]);
    expect(current('elias', 'knowledge')).toEqual([]);
    expect(current('tess', 'knowledge')).toEqual([]);
  });

  test('a revision replaces the record under the same entry', () => {
    play();
    const selection = slice();
    const before = current('tess', 'knowledge')[0];
    const { events } = resolveRecordReferences([{
      type: 'revelation', description: 'Tess learns the guild changed its gate code to Duskfall.', excerpt: 'It is Duskfall now.',
      participantIds: ['tess'], confidence: 0.96,
      operations: [{ type: 'revise', ref: refOf(selection, 'tess', 'knowledge'), proposition: { subjectId: 'guild', predicate: 'gate-code', object: 'The gate code of the guild hall is now Duskfall.' }, confidence: 0.95 }]
    }], selection.refs);
    record('turn-2', events[0]);
    const after = current('tess', 'knowledge');
    expect(after).toHaveLength(1);
    expect((after[0].proposition as { object: string }).object).toContain('Duskfall');
    expect(after[0].entryId).toBe(before.entryId);
  });

  test('a memory can be revised or forgotten by its ref', () => {
    play();
    let selection = slice();
    const revised = resolveRecordReferences([{
      type: 'custom', description: 'Elias realises Tess only told him the code to test him.', excerpt: 'It was a test.',
      participantIds: ['elias'], confidence: 0.96,
      operations: [{ type: 'revise', ref: refOf(selection, 'elias', 'memory'), summary: 'Tess gave Elias the gate code only to test whether he would keep it.' }]
    }], selection.refs);
    record('turn-2', revised.events[0]);
    expect(current('elias', 'memory').map(item => item.summary)).toEqual(['Tess gave Elias the gate code only to test whether he would keep it.']);
    selection = slice();
    const forgotten = resolveRecordReferences([{
      type: 'custom', description: 'The blow to the head takes the evening at the guild from Elias.', excerpt: 'He remembers nothing.',
      participantIds: ['elias'], confidence: 0.96,
      operations: [{ type: 'end', ref: refOf(selection, 'elias', 'memory'), how: 'forgot' }]
    }], selection.refs);
    record('turn-3', forgotten.events[0]);
    expect(current('elias', 'memory')).toEqual([]);
  });

  test('ending what a person wrote waits for review', () => {
    play('user');
    const selection = slice();
    const { events } = resolveRecordReferences([{
      type: 'custom', description: 'Elias forgets the gate code of the guild hall.', excerpt: 'Gone.',
      participantIds: ['elias'], confidence: 0.96,
      operations: [{ type: 'end', ref: refOf(selection, 'elias', 'knowledge'), how: 'forgot' }]
    }], selection.refs);
    const result = record('turn-2', events[0]);
    expect(result.decision).toBe('review');
    expect(current('elias', 'knowledge')).toHaveLength(1);
  });
});
