import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import { NarrativeEntitySystem } from '../../src/main/features/narrative/narrative-entities';
import { NarrativeStateSystem } from '../../src/main/features/narrative/narrative-state';
import { openTestDatabase } from '../sqlite-test-database';

const require = createRequire(import.meta.url);
const { findPendingNarrativeTurn, replacedReplyIds } = require('../../src/main/features/chat/narrative-turns.js');

const WS = 'ws';

describe('replacing a narrative turn', () => {
  let directory: string;
  let db: Database.Database;
  let entities: NarrativeEntitySystem;
  let state: NarrativeStateSystem;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'kallamo-turn-replacement-'));
    db = openTestDatabase(join(directory, 'turns.db'));
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE entities (
        id TEXT PRIMARY KEY, workspaceId TEXT, type TEXT, canonicalName TEXT, aliases TEXT, lore TEXT,
        loreDocumentId TEXT, data TEXT, status TEXT, createdAt INTEGER, last_modified INTEGER
      );
      CREATE TABLE entity_links (
        id TEXT PRIMARY KEY, workspaceId TEXT, fromId TEXT, relType TEXT, toId TEXT, label TEXT,
        metadata_json TEXT, createdAt INTEGER
      );
      CREATE TABLE messages (id TEXT PRIMARY KEY, chatId TEXT, role TEXT, content TEXT, createdAt INTEGER);
    `);
    runDatabaseMigrations(db);
    for (const [id, type] of [['nora', 'Characters'], ['lantern', 'Items'], ['dock', 'Locations'], ['pier', 'Locations']]) {
      db.prepare("INSERT INTO entities VALUES (?, ?, ?, ?, '[]', '', NULL, '{}', 'confirmed', 1, 1)").run(id, WS, type, id);
    }
    db.prepare(`INSERT INTO roleplay_workspace_settings (workspace_id, player_entity_id, location_entity_id, updated_at) VALUES (?, 'nora', 'dock', 1)`).run(WS);
    entities = new NarrativeEntitySystem(db);
    state = new NarrativeStateSystem(db);
  });

  afterEach(() => {
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  });

  // Plays one analyzed turn: snapshot first, then the effects the analysis applied.
  function playTurn(originId: string, effects: () => void) {
    expect(state.beginJob(WS, originId)).toBe('started');
    entities.captureTurnSnapshot(WS, originId);
    effects();
    state.finishJob(WS, originId, 'completed');
  }

  function turnAEffects() {
    db.prepare("UPDATE roleplay_workspace_settings SET location_entity_id = 'pier' WHERE workspace_id = ?").run(WS);
    db.prepare("INSERT INTO roleplay_equipment VALUES (?, 'nora', 'lantern', 5)").run(WS);
    db.prepare("INSERT INTO roleplay_location_inventory VALUES (?, 'pier', 'lantern', 2, 5)").run(WS);
    db.prepare("INSERT INTO roleplay_scene_nearby VALUES (?, 'scene-1', 'lantern', 0)").run(WS);
    db.prepare(`
      INSERT INTO roleplay_scene_changes (workspace_id, change_id, payload_json, status, source, provenance_id, created_at)
      VALUES (?, 'change-a', '{}', 'pending', 'ai', 'reply-a', 5)
    `).run(WS);
  }

  const location = () => (db.prepare('SELECT location_entity_id AS id FROM roleplay_workspace_settings WHERE workspace_id = ?').get(WS) as { id: string }).id;
  const count = (table: string) => (db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE workspace_id = ?`).get(WS) as { n: number }).n;
  const changeStatus = () => (db.prepare("SELECT status FROM roleplay_scene_changes WHERE change_id = 'change-a'").get() as { status: string }).status;
  const lifecycle = (originId: string) => db.prepare('SELECT status FROM narrative_origin_lifecycle WHERE workspace_id = ? AND origin_id = ?').get(WS, originId) as { status: string } | undefined;

  test('the replaced reply is reverted before its replacement is generated', () => {
    playTurn('reply-a', turnAEffects);
    const replacementId = entities.beginTurnReplacement(WS, ['reply-a']);

    expect(replacementId).toEqual(expect.any(String));
    expect(location()).toBe('dock');
    expect([count('roleplay_equipment'), count('roleplay_location_inventory'), count('roleplay_scene_nearby')]).toEqual([0, 0, 0]);
    expect(lifecycle('reply-a')).toEqual({ status: 'superseded' });
    expect(changeStatus()).toBe('rejected');
  });

  test('a replacement that is never saved gives the reply back its state', () => {
    playTurn('reply-a', turnAEffects);
    const replacementId = entities.beginTurnReplacement(WS, ['reply-a'])!;

    expect(entities.cancelTurnReplacement(WS, replacementId)).toBe(true);
    expect(location()).toBe('pier');
    expect([count('roleplay_equipment'), count('roleplay_location_inventory'), count('roleplay_scene_nearby')]).toEqual([1, 1, 1]);
    expect(lifecycle('reply-a')?.status ?? 'active').toBe('active');
    expect(changeStatus()).toBe('pending');
    expect(count('narrative_turn_replacements')).toBe(0);
    expect(entities.cancelTurnReplacement(WS, replacementId)).toBe(false);
  });

  test('deleting the replaced reply after its replacement was analyzed no longer fails', () => {
    playTurn('reply-a', turnAEffects);
    const replacementId = entities.beginTurnReplacement(WS, ['reply-a'])!;
    entities.completeTurnReplacement(WS, replacementId);
    playTurn('reply-b', () => {
      db.prepare("UPDATE roleplay_workspace_settings SET location_entity_id = 'dock' WHERE workspace_id = ?").run(WS);
    });

    expect(() => entities.invalidateOrigin(WS, 'reply-a', 'deleted')).not.toThrow();
    expect(lifecycle('reply-a')).toEqual({ status: 'deleted' });
    expect(lifecycle('reply-b')).toEqual({ status: 'active' });
    expect(count('roleplay_equipment')).toBe(0);
  });

  test('an edit replaces every later reply, newest first', () => {
    playTurn('reply-a', turnAEffects);
    playTurn('reply-c', () => {
      db.prepare("DELETE FROM roleplay_equipment WHERE workspace_id = ?").run(WS);
    });
    const messages = [
      { id: 'user-1', role: 'user' }, { id: 'reply-a', role: 'ai' },
      { id: 'user-2', role: 'user' }, { id: 'reply-c', role: 'ai' }
    ];
    const replaced = replacedReplyIds(messages, { historyEdit: { messageId: 'user-1', content: 'Changed.' } });
    expect(replaced).toEqual(['reply-c', 'reply-a']);

    entities.beginTurnReplacement(WS, replaced);
    expect(location()).toBe('dock');
    expect(count('roleplay_equipment')).toBe(0);
  });

  test('a new run settles a replacement a cancelled run left open', () => {
    playTurn('reply-a', turnAEffects);
    entities.beginTurnReplacement(WS, ['reply-a']);

    expect(entities.cancelOpenTurnReplacements(WS)).toBe(1);
    expect(location()).toBe('pier');
    expect(entities.cancelOpenTurnReplacements()).toBe(0);
  });

  test('a snapshot taken before equipment was captured leaves equipment alone', () => {
    playTurn('reply-a', turnAEffects);
    const row = db.prepare('SELECT snapshot_json FROM roleplay_turn_snapshots WHERE origin_id = ?').get('reply-a') as { snapshot_json: string };
    const legacy = JSON.parse(row.snapshot_json);
    delete legacy.equipment;
    delete legacy.nearby;
    delete legacy.locationInventory;
    db.prepare('UPDATE roleplay_turn_snapshots SET snapshot_json = ? WHERE origin_id = ?').run(JSON.stringify(legacy), 'reply-a');

    entities.invalidateOrigin(WS, 'reply-a', 'deleted');
    expect(location()).toBe('dock');
    expect(count('roleplay_equipment')).toBe(1);
  });
});

describe('the reply waiting for Narrative State', () => {
  let directory: string;
  let db: Database.Database;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'kallamo-pending-turn-'));
    db = openTestDatabase(join(directory, 'pending.db'));
    db.exec('CREATE TABLE messages (id TEXT PRIMARY KEY, chatId TEXT, role TEXT, content TEXT, createdAt INTEGER);');
    runDatabaseMigrations(db);
    const insert = db.prepare('INSERT INTO messages VALUES (?, ?, ?, ?, ?)');
    insert.run('user-1', WS, 'user', 'Go.', 1);
    insert.run('reply-1', WS, 'ai', 'Went.', 2);
    insert.run('user-2', WS, 'user', 'Again.', 3);
    insert.run('reply-2', WS, 'ai', 'Again.', 4);
  });

  afterEach(() => {
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const job = (originId: string, status: string) => db.prepare(`
    INSERT INTO narrative_state_jobs (workspace_id, origin_id, status, created_at, updated_at) VALUES (?, ?, ?, 1, 1)
  `).run(WS, originId, status);

  test('is the latest reply that never started an analysis', () => {
    job('reply-1', 'completed');
    expect(findPendingNarrativeTurn(db, WS)).toEqual({ originId: 'reply-2' });
    expect(findPendingNarrativeTurn(db, WS, ['reply-2'])).toBeNull();
  });

  test('is never a reply whose analysis failed, so nothing retries and bills on its own', () => {
    job('reply-2', 'failed');
    expect(findPendingNarrativeTurn(db, WS)).toBeNull();
  });

  test('is never a reply the story already let go of', () => {
    db.prepare(`
      INSERT INTO narrative_origin_lifecycle (workspace_id, origin_id, status, updated_at) VALUES (?, 'reply-2', 'deleted', 1)
    `).run(WS);
    expect(findPendingNarrativeTurn(db, WS)).toBeNull();
  });

  test('regenerating replaces only the reply named', () => {
    const messages = [{ id: 'user-1', role: 'user' }, { id: 'reply-1', role: 'ai' }];
    expect(replacedReplyIds(messages, { regenerateMessageId: 'reply-1' })).toEqual(['reply-1']);
    expect(replacedReplyIds(messages, {})).toEqual([]);
  });
});
