import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import { createNarrativeChatContext } from '../../src/main/features/narrative/chat-context';
import { setWorkspaceExperienceMode } from '../../src/main/features/narrative/mode-orchestration';
import { assembleContext } from '../../src/main/features/narrative/retrieval/assembler';
import type { SceneInput } from '../../src/main/features/narrative/retrieval/scene-core';
import { createWorldbuildDataService } from '../../src/main/features/worldbuild/worldbuild-data.js';
import { openTestDatabase } from '../sqlite-test-database';

const WORKSPACE = 'workspace-one';
const estimate = (text: string) => Math.max(1, Math.ceil(text.length / 4));

describe('What reaches each character', () => {
  let directory: string;
  let db: Database.Database;
  let worldbuild: ReturnType<typeof createWorldbuildDataService>;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'kallamo-retrieval-perspective-'));
    db = openTestDatabase(join(directory, 'context.db'));
    db.pragma('foreign_keys = ON');
    runDatabaseMigrations(db);
    db.exec(`
      CREATE TABLE entities (
        id TEXT PRIMARY KEY, workspaceId TEXT, type TEXT NOT NULL, canonicalName TEXT NOT NULL, aliases TEXT,
        lore TEXT, data TEXT, status TEXT NOT NULL, createdAt INTEGER, last_modified INTEGER
      );
      CREATE TABLE chunk_tags (chunkId TEXT NOT NULL, tag TEXT, entity TEXT);
      CREATE TABLE entity_links (
        id TEXT PRIMARY KEY, workspaceId TEXT, fromId TEXT, relType TEXT, toId TEXT, label TEXT, metadata_json TEXT, createdAt INTEGER
      );
    `);
    worldbuild = createWorldbuildDataService(db);
    const saveSubjectEntry = worldbuild.saveSubjectEntry;
    worldbuild.saveSubjectEntry = (payload: any) => {
      declareEntity(payload.subjectId, 'Characters');
      return saveSubjectEntry(payload);
    };
    worldbuild.saveFieldDefinition({ projectId: WORKSPACE, typeId: 'Locations', label: 'Material', valueType: 'short-text', position: 0, aiAccess: 'read-only' });
    worldbuild.saveFieldDefinition({ projectId: WORKSPACE, typeId: 'Locations', label: 'Internal code', valueType: 'short-text', position: 1, aiAccess: 'hidden' });
    db.prepare(`
      INSERT INTO entities (id, workspaceId, type, canonicalName, aliases, lore, data, status, createdAt, last_modified)
      VALUES ('northern-gate', ?, 'Locations', 'Northern Gate', '[]', 'The gate protects the northern road.', ?, 'confirmed', 1, 1)
    `).run(WORKSPACE, JSON.stringify({ description: 'A weathered iron gate between two watchtowers.', customFields: { material: 'Iron', 'internal-code': 'SEVEN' } }));
    declareEntity('elias', 'Characters', 'Elias');
    declareEntity('tess', 'Characters', 'Tess');
    setWorkspaceExperienceMode(db, WORKSPACE, 'roleplay');
  });

  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function declareEntity(id: string, type: string, name = id) {
    db.prepare(`
      INSERT OR IGNORE INTO entities (id, workspaceId, type, canonicalName, aliases, lore, data, status, createdAt, last_modified)
      VALUES (?, ?, ?, ?, '[]', '', '{}', 'confirmed', 1, 1)
    `).run(id, WORKSPACE, type, name);
  }

  function saveKnowledge(subjectId: string, statement: string, accessibility = 'available') {
    return worldbuild.saveSubjectEntry({
      workspaceId: WORKSPACE, subjectId, kind: 'knowledge',
      entry: { aboutId: 'northern-gate', statement, confidence: 1, acquisition: 'reported', accessibility }
    });
  }

  function assemble(scene: Partial<SceneInput> = {}) {
    return assembleContext({
      db, workspaceId: WORKSPACE, mode: 'roleplay', request: 'What is happening at the Northern Gate?', lastReply: '',
      scene: { locationId: null, participantIds: ['elias', 'tess'], possibleObserverIds: [], nearbyIds: [], objectIds: [], playerId: 'elias', ...scene },
      ceiling: 20000, estimateTokens: estimate, source: createNarrativeChatContext(db, estimate)
    });
  }

  test('each character\'s knowledge stays under their own name', async () => {
    saveKnowledge('elias', 'The northern gate is unguarded.');
    saveKnowledge('tess', 'The northern gate is trapped.');
    const context = (await assemble()).context;
    const elias = context.split('Known to Elias:')[1]?.split('Known to')[0] ?? '';
    const tess = context.split('Known to Tess:')[1]?.split('Known to')[0] ?? '';
    expect(elias).toContain('The northern gate is unguarded.');
    expect(elias).not.toContain('The northern gate is trapped.');
    expect(tess).toContain('The northern gate is trapped.');
  });

  test('inaccessible knowledge never reaches the context', async () => {
    saveKnowledge('elias', 'The gate opens with a forbidden name.', 'inaccessible');
    expect((await assemble()).context).not.toContain('forbidden name');
  });

  test('a deleted entry does not come back from history', async () => {
    const added = saveKnowledge('elias', 'The old gate code is seven.');
    worldbuild.deleteSubjectEntry({ workspaceId: WORKSPACE, subjectId: 'elias', kind: 'knowledge', entryId: added.known[0].id });
    expect((await assemble()).context).not.toContain('The old gate code is seven.');
  });

  test('a hidden field stays out and a read-only one is shown', async () => {
    const context = (await assemble()).context;
    expect(context).toContain('Material: Iron');
    expect(context).not.toContain('SEVEN');
  });

  test('a faction member reads what the faction knows, until the card leaves them out', async () => {
    declareEntity('bulwark', 'Factions', 'Bulwark');
    db.prepare('INSERT INTO entity_links VALUES (?, ?, ?, ?, ?, NULL, ?, ?)').run('membership-one', WORKSPACE, 'elias', 'member_of', 'bulwark', '{}', 1);
    worldbuild.saveSubjectEntry({
      workspaceId: WORKSPACE, subjectId: 'bulwark', kind: 'knowledge',
      entry: { aboutId: 'northern-gate', statement: 'The Bulwark watches the northern gate.', confidence: 1, acquisition: 'reported', accessibility: 'available' }
    });
    const shared = (await assemble()).context;
    expect(shared).toMatch(/The Bulwark watches the northern gate\..*\(as one of Bulwark\)/);
    expect(shared.split('Known to Elias:')[1]).toContain('The Bulwark watches');

    worldbuild.setKnowledgeAudience({ workspaceId: WORKSPACE, ownerId: 'bulwark', targetId: 'northern-gate', audienceType: 'selected-members', memberIds: ['tess'] });
    expect((await assemble()).context).not.toContain('The Bulwark watches the northern gate.');
  });

  test('a local knows what the Area knows; a visitor does not', async () => {
    const insert = db.prepare(`INSERT INTO entities (id, workspaceId, type, canonicalName, aliases, lore, data, status, createdAt, last_modified) VALUES (?, ?, ?, ?, '[]', '', ?, 'confirmed', 1, 1)`);
    insert.run('march', WORKSPACE, 'Locations', 'The March', JSON.stringify({ size: 'area' }));
    const link = db.prepare('INSERT INTO entity_links VALUES (?, ?, ?, ?, ?, NULL, ?, ?)');
    link.run('gate-inside', WORKSPACE, 'northern-gate', 'inside', 'march', '{}', 1);
    link.run('elias-local', WORKSPACE, 'elias', 'local_to', 'march', '{}', 1);
    worldbuild.saveSubjectEntry({
      workspaceId: WORKSPACE, subjectId: 'march', kind: 'knowledge',
      entry: { aboutId: 'northern-gate', statement: 'Everyone in the March knows the gate sticks in the rain.', confidence: 1, acquisition: 'witness', accessibility: 'available' }
    });
    const context = (await assemble()).context;
    expect(context.split('Known to Elias:')[1]).toContain('the gate sticks in the rain');
    expect(context.split('Known to Tess:')[1] ?? '').not.toContain('the gate sticks in the rain');
  });

  test('archived text with no need behind it is never sent', async () => {
    db.prepare('INSERT INTO chunk_tags (chunkId, tag, entity) VALUES (?, ?, ?)').run('chunk-gate', 'gate', 'northern-gate');
    expect((await assemble()).context).not.toContain('A tagged archive says everyone knows the gate secret.');
  });
});
