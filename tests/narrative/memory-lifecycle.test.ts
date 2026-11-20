import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import { NarrativeStateSystem, type ExtractedNarrativeEvent } from '../../src/main/features/narrative/narrative-state';
import { loadCurrentNarrativeRecords } from '../../src/main/features/narrative/narrative-record-projection';
import { defaultRelevance, fadeAfterDays } from '../../src/main/features/narrative/memory-relevance';
import { fadeIdleRecords } from '../../src/main/features/narrative/umwelt/story-maintenance';
import { lastRecordUse, noteRecordUse } from '../../src/main/features/narrative/umwelt/record-use';
import { outOfReach } from '../../src/main/features/narrative/retrieval/scene-core';
import { StoryReads } from '../../src/main/features/narrative/retrieval/story-reads';
import { selectPerspectiveRecords } from '../../src/main/features/narrative/narrative-state-routing.js';
import { openTestDatabase } from '../sqlite-test-database';

const WORKSPACE = 'workspace-memory';
const DAY = 24 * 60;

describe('How memory lives', () => {
  let directory: string;
  let db: Database.Database;
  let system: NarrativeStateSystem;
  const allowed = new Set(['elias', 'tess', 'guild']);

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'kallamo-memory-'));
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

  function record(originId: string, event: ExtractedNarrativeEvent, storyMinute: number, interpreter: 'model' | 'user' = 'model') {
    return system.createEvent({
      workspaceId: WORKSPACE, originId, interpreterId: 'system-model', event, allowedEntityIds: allowed,
      storyMinute, provenanceInterpreter: interpreter
    });
  }

  function memories(holder: string) {
    return loadCurrentNarrativeRecords(db, { workspaceId: WORKSPACE, recordTypes: ['memory'], subjectIds: [holder] }).map(item => item.payload);
  }

  function evening(interpreter: 'model' | 'user' = 'model') {
    record('turn-1', {
      type: 'custom', description: 'An evening at the guild hall.', excerpt: 'They talk.', participantIds: ['elias', 'tess'], confidence: 0.98,
      operations: [
        { type: 'memory', subjectId: 'elias', summary: 'Tess trusted Elias with the gate code of the guild hall.', category: 'bond', salience: 0.92, relatedEntityIds: ['tess'] },
        { type: 'memory', subjectId: 'elias', summary: 'The guild hall served fish stew that evening, two coppers a bowl.', category: 'bond', salience: 0.5, relatedEntityIds: ['guild'] },
        { type: 'memory', subjectId: 'elias', summary: 'Tess said the guild meets again before the frost.', category: 'bond', salience: 0.75, relatedEntityIds: ['tess'] }
      ]
    }, 0, interpreter);
  }

  test('relevance comes from the record, or from its category', () => {
    expect(defaultRelevance('trauma')).toBe(0.9);
    expect(defaultRelevance('intent')).toBe(0.7);
    expect(defaultRelevance('history')).toBe(0.6);
    expect(fadeAfterDays(0.5, 'bond')).toBe(7);
    expect(fadeAfterDays(0.75, 'bond')).toBe(30);
    expect(fadeAfterDays(0.92, 'bond')).toBeNull();
    expect(fadeAfterDays(undefined, 'secret')).toBeNull();
    expect(fadeAfterDays(0.5, 'intent')).toBeNull();
  });

  test('what goes unused fades by its relevance in story time, and keeps its kind and relevance', () => {
    evening();
    expect(fadeIdleRecords(db, WORKSPACE, { originId: 'turn-2', holderIds: ['elias'], nowMinute: 5 * DAY })).toEqual([]);
    const faded = fadeIdleRecords(db, WORKSPACE, { originId: 'turn-2', holderIds: ['elias'], nowMinute: 10 * DAY });
    expect(faded.map(item => item.text)).toEqual(['The guild hall served fish stew that evening, two coppers a bowl.']);
    const now = memories('elias');
    expect(now.find(item => String(item.summary ?? '').includes('fish stew'))).toMatchObject({ accessibility: 'suppressed', salience: 0.5, category: 'bond' });
    expect(now.filter(item => item.accessibility === 'available')).toHaveLength(2);
    const later = fadeIdleRecords(db, WORKSPACE, { originId: 'turn-3', holderIds: ['elias'], nowMinute: 40 * DAY });
    expect(later.map(item => item.text)).toEqual(['Tess said the guild meets again before the frost.']);
    expect(memories('elias').filter(item => item.accessibility === 'available').map(item => item.summary)).toEqual(['Tess trusted Elias with the gate code of the guild hall.']);
  });

  test('a record the story drew on stays within reach for longer', () => {
    evening();
    const stew = memories('elias').find(item => String(item.summary ?? '').includes('fish stew'))!;
    noteRecordUse(db, WORKSPACE, 'turn-2', [String(stew.id)], 8 * DAY);
    expect(lastRecordUse(db, WORKSPACE, [String(stew.id)]).get(String(stew.id))).toBe(8 * DAY);
    expect(fadeIdleRecords(db, WORKSPACE, { originId: 'turn-3', holderIds: ['elias'], nowMinute: 10 * DAY })).toEqual([]);
  });

  test('what a person wrote never fades on its own', () => {
    evening('user');
    expect(fadeIdleRecords(db, WORKSPACE, { originId: 'turn-2', holderIds: ['elias'], nowMinute: 400 * DAY })).toEqual([]);
  });

  test('an old open intent and what is out of reach reach the interpreter past the limit', () => {
    const knowledge = (index: number) => ({ type: 'knowledge', subjectId: 'elias', value: { id: `k${index}`, proposition: { subjectId: 'tess', predicate: `fact-${index}`, object: `Fact ${index}` }, confidence: 1, accessibility: 'available', status: 'active' } });
    const rows = [
      ...Array.from({ length: 130 }, (_, index) => knowledge(index)),
      { type: 'knowledge', subjectId: 'elias', value: { id: 'intent', proposition: { subjectId: 'tess', predicate: 'plan', object: 'Elias will ask Tess for the code again.' }, category: 'intent', confidence: 1, accessibility: 'available', status: 'active' } },
      { type: 'memory', subjectId: 'elias', value: { id: 'faded', summary: 'Tess laughed at the gate.', relatedEntityIds: ['tess'], accessibility: 'suppressed', status: 'active' } }
    ];
    const selection = selectPerspectiveRecords(rows, { holderIds: ['elias'], targetIds: ['tess'], focusIds: ['tess'], withRefs: true });
    expect(selection.records).toHaveLength(120);
    expect(selection.records.slice(0, 2)).toEqual([
      expect.objectContaining({ category: 'intent' }),
      expect.objectContaining({ accessibility: 'suppressed' })
    ]);
    expect(selection.reserved).toEqual({ intents: 1, outOfReach: 1 });
  });

  test('the narrator is told what someone present cannot reach about the turn', () => {
    evening();
    fadeIdleRecords(db, WORKSPACE, { originId: 'turn-2', holderIds: ['elias'], nowMinute: 40 * DAY });
    const view = { nameOf: (id: string) => ({ elias: 'Elias', tess: 'Tess' } as Record<string, string>)[id] } as never;
    const notes = outOfReach({ view, reads: new StoryReads(db, WORKSPACE), present: ['elias'], focusIds: new Set(['elias', 'tess']) });
    expect(notes.map(note => note.text)).toEqual(['Elias (out of reach for now): Tess said the guild meets again before the frost.']);
    expect(notes[0].section).toBe('narrator');
  });
});
