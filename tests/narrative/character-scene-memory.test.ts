import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import {
  CharacterSceneMemory,
  formatCharacterMemorySection,
  normalizeSceneMemoryUpdates,
  type SceneMemoryUpdate
} from '../../src/main/features/narrative/character-scene-memory';
import { openTestDatabase } from '../sqlite-test-database';

const WS = 'ws';

describe('character scene memory', () => {
  let directory: string;
  let db: Database.Database;
  let memory: CharacterSceneMemory;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'kallamo-scene-memory-'));
    db = openTestDatabase(join(directory, 'memory.db'));
    db.exec(`
      CREATE TABLE entities (
        id TEXT PRIMARY KEY, workspaceId TEXT, type TEXT, canonicalName TEXT, aliases TEXT, lore TEXT,
        loreDocumentId TEXT, data TEXT, status TEXT, createdAt INTEGER, last_modified INTEGER
      );
    `);
    runDatabaseMigrations(db);
    for (const [id, name] of [['player', 'Ilse'], ['guard', 'Warden Bram'], ['clerk', 'Odo'], ['gate', 'North Gate'], ['market', 'Market']]) {
      db.prepare("INSERT INTO entities VALUES (?, ?, 'Characters', ?, '[]', '', NULL, '{}', 'confirmed', 1, 1)").run(id, WS, name);
    }
    memory = new CharacterSceneMemory(db);
  });

  afterEach(() => {
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const update = (entityId: string, fields: Partial<SceneMemoryUpdate>): SceneMemoryUpdate => ({
    entityId, perceived: [], heard: [], stance: '', ...fields
  });

  function turn(originId: string, createdAt: number, presentIds: string[], updates: SceneMemoryUpdate[] = [], locationId = 'gate') {
    memory.recordTurn({ workspaceId: WS, originId, presentIds, locationId, createdAt, updates });
  }

  test('a character keeps the figure they were told, not the one the narration gives', () => {
    turn('reply-1', 10, ['player'], [], 'market');
    turn('reply-2', 20, ['player', 'guard'], [update('guard', {
      heard: [{ fromId: 'player', text: 'she says she captured eight of the smugglers' }],
      stance: 'wants the prisoners counted before dark'
    })]);

    const [guard] = memory.load(WS, ['guard']);
    expect(guard.current.lines).toEqual([{ kind: 'heard', text: 'she says she captured eight of the smugglers', sourceId: 'player' }]);
    expect(guard.current.stance).toBe('wants the prisoners counted before dark');
    expect(guard.earlier).toBeNull();
  });

  test('leaving the scene turns what a character had into where they left off', () => {
    turn('reply-1', 10, ['player', 'guard'], [update('guard', { perceived: ['Ilse handed over a sealed letter'], stance: 'suspicious of Ilse' })]);
    memory.settleTurn(WS, 'reply-1', { locationId: 'gate', timeLabel: '3 Thaw 1203, 14:00' });
    turn('reply-2', 20, ['player'], [], 'market');
    turn('reply-3', 30, ['player', 'guard'], [update('guard', { perceived: ['Ilse came back alone'] })]);

    const [guard] = memory.load(WS, ['guard']);
    expect(guard.current.lines.map(line => line.text)).toEqual(['Ilse came back alone']);
    expect(guard.current.stance).toBeNull();
    expect(guard.earlier).toMatchObject({
      lines: [{ kind: 'perceived', text: 'Ilse handed over a sealed letter', sourceId: null }],
      stance: 'suspicious of Ilse',
      locationId: 'gate',
      timeLabel: '3 Thaw 1203, 14:00'
    });

    const section = formatCharacterMemorySection([guard], memory.names(WS, ['guard', 'gate']));
    expect(section).toContain('Warden Bram');
    expect(section).toContain('Where they left off last time (North Gate, 3 Thaw 1203, 14:00)');
    expect(section).toContain('- stance then: suspicious of Ilse');
  });

  test('a replaced or deleted reply drops out of memory and presence', () => {
    turn('reply-1', 10, ['player', 'guard'], [update('guard', { perceived: ['the gate was shut'] })]);
    turn('reply-2', 20, ['player', 'guard'], [update('guard', { perceived: ['a fire broke out'] })]);
    db.prepare("INSERT INTO narrative_origin_lifecycle VALUES (?, 'reply-2', 'superseded', NULL, 30)").run(WS);

    expect(memory.load(WS, ['guard'])[0].current.lines.map(line => line.text)).toEqual(['the gate was shut']);
    expect(memory.latestStances(WS, ['guard'])).toEqual([]);
  });

  test('recording the same reply twice replaces its lines instead of doubling them', () => {
    turn('reply-1', 10, ['player', 'guard'], [update('guard', { perceived: ['first reading'] })]);
    turn('reply-1', 10, ['player', 'guard'], [update('guard', { perceived: ['second reading'] })]);

    expect(memory.load(WS, ['guard'])[0].current.lines.map(line => line.text)).toEqual(['second reading']);
  });

  test('the presence note appears where the cast changes and stays on the same message', () => {
    turn('reply-1', 10, ['player'], [], 'market');
    turn('reply-2', 20, ['player'], [], 'market');
    turn('reply-3', 30, ['player', 'guard']);
    const messages = [
      { id: 'user-1', role: 'user' }, { id: 'reply-1', role: 'ai' },
      { id: 'user-2', role: 'user' }, { id: 'reply-2', role: 'ai' },
      { id: 'user-3', role: 'user' }, { id: 'reply-3', role: 'ai' },
      { id: 'user-4', role: 'user' }
    ];

    const notes = memory.presenceNotes(WS, messages);
    expect([...notes.entries()]).toEqual([
      ['user-2', '[In the scene at Market: Ilse]'],
      ['user-4', '[In the scene at North Gate: Ilse, Warden Bram]']
    ]);
    turn('reply-4', 40, ['player', 'guard']);
    const later = memory.presenceNotes(WS, [...messages, { id: 'reply-4', role: 'ai' }, { id: 'user-5', role: 'user' }]);
    expect(later.get('user-2')).toBe(notes.get('user-2'));
    expect(later.get('user-4')).toBe(notes.get('user-4'));
    expect(later.has('user-5')).toBe(false);
  });
});

describe('normalizing the triage scene memory', () => {
  test('keeps present non-player characters and known speakers only', () => {
    const updates = normalizeSceneMemoryUpdates([
      { entityId: 'guard', perceived: ['  a   cart overturned ', 'A cart overturned'], heard: [{ fromId: 'player', text: 'eight crates' }, { fromId: 'ghost', text: 'a rumour' }], stance: 'wary' },
      { entityId: 'player', perceived: ['the player is never remembered here'], heard: [], stance: '' },
      { entityId: 'absent', perceived: ['someone elsewhere'], heard: [], stance: '' },
      { entityId: 'clerk', perceived: [], heard: [], stance: '' }
    ], { eligibleIds: ['guard', 'clerk'], speakerIds: ['player', 'guard', 'clerk'] });

    expect(updates).toEqual([{
      entityId: 'guard',
      perceived: ['a cart overturned'],
      heard: [{ fromId: 'player', text: 'eight crates' }, { fromId: null, text: 'a rumour' }],
      stance: 'wary'
    }]);
  });

  test('ignores a malformed answer', () => {
    expect(normalizeSceneMemoryUpdates(null, { eligibleIds: ['guard'], speakerIds: [] })).toEqual([]);
    expect(normalizeSceneMemoryUpdates([{ entityId: 'guard', perceived: 'not a list' }], { eligibleIds: ['guard'], speakerIds: [] })).toEqual([]);
  });
});
