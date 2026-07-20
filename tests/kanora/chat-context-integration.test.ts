import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { NarrativeSceneRepository } from '../../src/kanora/scenes';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import { createKallamoKanoraChatContext } from '../../src/main/features/kanora/chat-context';
import { createWorldbuildDataService } from '../../src/main/features/worldbuild/worldbuild-data.js';

describe('Kallamo Kanora Chat context integration', () => {
  let directory: string;
  let db: Database.Database;
  let context: ReturnType<typeof createKallamoKanoraChatContext>;
  let worldbuild: ReturnType<typeof createWorldbuildDataService>;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'kanora-chat-context-'));
    db = new Database(join(directory, 'context.db'));
    db.pragma('foreign_keys = ON');
    runDatabaseMigrations(db);
    db.exec(`
      CREATE TABLE entities (
        id TEXT PRIMARY KEY, workspaceId TEXT, type TEXT NOT NULL,
        canonicalName TEXT NOT NULL, aliases TEXT, lore TEXT, data TEXT,
        status TEXT NOT NULL, createdAt INTEGER, last_modified INTEGER
      );
      CREATE TABLE chunk_tags (chunkId TEXT NOT NULL, tag TEXT, entity TEXT);
      CREATE TABLE entity_links (
        id TEXT PRIMARY KEY, workspaceId TEXT, fromId TEXT, relType TEXT,
        toId TEXT, label TEXT
      );
    `);
    context = createKallamoKanoraChatContext(db, text => Math.max(1, Math.ceil(text.length / 4)));
    worldbuild = createWorldbuildDataService(db);
    seedWorldbuild();
  });

  afterEach(() => {
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test('uses the active scene to include only the focal subject knowledge', () => {
    saveKnowledge('elias', 'The northern gate is unguarded.', 'available');
    saveKnowledge('mara', 'The northern gate is trapped.', 'available');
    new NarrativeSceneRepository(db).save({
      id: 'scene-one', projectId: 'workspace-one', status: 'active',
      participantIds: ['elias', 'mara'], possibleObserverIds: [],
      perspective: { access: 'subjective', focalSubjectId: 'elias' },
      position: { sequence: 50 }
    });

    const result = plan();

    expect(result.context).toContain('The northern gate is unguarded.');
    expect(result.context).not.toContain('The northern gate is trapped.');
    expect(result.context).not.toContain('A tagged archive says everyone knows the gate secret.');
    expect(result.plan.decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ candidateId: expect.stringContaining('knowledge:'), outcome: 'include', reason: 'subject-knowledge' }),
      expect.objectContaining({ candidateId: 'retrieved:workspace-memory:chunk-gate', outcome: 'exclude', reason: 'unclassified-sensitive-context' })
    ]));
  });

  test('falls back to public canon without exposing subject-owned records', () => {
    saveKnowledge('elias', 'The northern gate is unguarded.', 'available');

    const result = plan();

    expect(result.context).toContain('Northern Gate (Locations)');
    expect(result.context).toContain('Material: Iron');
    expect(result.context).not.toContain('The northern gate is unguarded.');
    expect(result.context).not.toContain('A tagged archive says everyone knows the gate secret.');
    expect(result.context).not.toContain('Internal code');
  });

  test('never includes inaccessible knowledge for an active omniscient scene', () => {
    saveKnowledge('elias', 'The gate opens with a forbidden name.', 'inaccessible');
    new NarrativeSceneRepository(db).save({
      id: 'scene-omniscient', projectId: 'workspace-one', status: 'active',
      participantIds: [], possibleObserverIds: [],
      perspective: { access: 'omniscient' }, position: { sequence: 50 }
    });

    const result = plan();

    expect(result.context).not.toContain('forbidden name');
    expect(result.plan.decisions).toContainEqual(expect.objectContaining({ outcome: 'exclude', reason: 'inaccessible' }));
  });

  test('projects revisions instead of leaking superseded knowledge history', () => {
    const added = worldbuild.saveSubjectEntry({
      workspaceId: 'workspace-one', subjectId: 'elias', kind: 'knowledge',
      entry: {
        aboutId: 'northern-gate', statement: 'The old gate code is seven.',
        confidence: 1, acquisition: 'reported', accessibility: 'available'
      }
    });
    worldbuild.deleteSubjectEntry({
      workspaceId: 'workspace-one', subjectId: 'elias', kind: 'knowledge', entryId: added.known[0].id
    });
    new NarrativeSceneRepository(db).save({
      id: 'scene-revision', projectId: 'workspace-one', status: 'active',
      participantIds: ['elias'], possibleObserverIds: [],
      perspective: { access: 'subjective', focalSubjectId: 'elias' },
      position: { sequence: 50 }
    });

    expect(plan().context).not.toContain('The old gate code is seven.');
  });

  function seedWorldbuild() {
    worldbuild.saveFieldDefinition({
      projectId: 'workspace-one', typeId: 'Locations', label: 'Material',
      valueType: 'short-text', position: 0, aiAccess: 'read-only'
    });
    worldbuild.saveFieldDefinition({
      projectId: 'workspace-one', typeId: 'Locations', label: 'Internal code',
      valueType: 'short-text', position: 1, aiAccess: 'hidden'
    });
    db.prepare(`
      INSERT INTO entities (
        id, workspaceId, type, canonicalName, aliases, lore, data,
        status, createdAt, last_modified
      ) VALUES (?, ?, ?, ?, '[]', ?, ?, 'confirmed', 1, 1)
    `).run(
      'northern-gate', 'workspace-one', 'Locations', 'Northern Gate',
      'The gate protects the northern road.',
      JSON.stringify({ customFields: { material: 'Iron', 'internal-code': 'SEVEN' } })
    );
    db.prepare('INSERT INTO chunk_tags (chunkId, tag, entity) VALUES (?, ?, ?)')
      .run('chunk-gate', 'Northern Gate', 'northern-gate');
  }

  function saveKnowledge(subjectId: string, statement: string, accessibility: string) {
    worldbuild.saveSubjectEntry({
      workspaceId: 'workspace-one', subjectId, kind: 'knowledge',
      entry: {
        aboutId: 'northern-gate', statement, confidence: 1,
        acquisition: 'reported', accessibility
      }
    });
  }

  function plan() {
    return context.plan({
      requestId: 'request-one', workspaceId: 'workspace-one',
      query: 'What is happening at the northern gate?', tokenBudget: 1000,
      items: [{
        id: 'chunk-gate', kind: 'workspace-memory', source: 'Archive',
        content: 'A tagged archive says everyone knows the gate secret.', relevance: 0.8
      }]
    });
  }
});
