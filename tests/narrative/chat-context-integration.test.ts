import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { NarrativeSceneRepository } from '../../src/narrative/scenes';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import { createNarrativeChatContext } from '../../src/main/features/narrative/chat-context';
import {
  getWorkspaceExperienceMode,
  setWorkspaceExperienceMode
} from '../../src/main/features/narrative/mode-orchestration';
import { RoleplaySystem } from '../../src/main/features/narrative/roleplay-system';
import { NarrativeStateSystem } from '../../src/main/features/narrative/narrative-state';
import { CharacterSceneMemory } from '../../src/main/features/narrative/character-scene-memory';
import { createWorldbuildDataService } from '../../src/main/features/worldbuild/worldbuild-data.js';
import { openTestDatabase } from '../sqlite-test-database';

describe('Narrative chat context integration', () => {
  let directory: string;
  let db: Database.Database;
  let context: ReturnType<typeof createNarrativeChatContext>;
  let worldbuild: ReturnType<typeof createWorldbuildDataService>;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'narrative-chat-context-'));
    db = openTestDatabase(join(directory, 'context.db'));
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
        toId TEXT, label TEXT, metadata_json TEXT, createdAt INTEGER
      );
    `);
    context = createNarrativeChatContext(db, text => Math.max(1, Math.ceil(text.length / 4)));
    worldbuild = createWorldbuildDataService(db);
    seedWorldbuild();
  });

  afterEach(() => {
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test('keeps player and scene actor knowledge in separate narrator scopes', () => {
    setWorkspaceExperienceMode(db, 'workspace-one', 'roleplay');
    saveKnowledge('elias', 'The northern gate is unguarded.', 'available');
    saveKnowledge('mara', 'The northern gate is trapped.', 'available');
    new NarrativeSceneRepository(db).save({
      id: 'scene-one', projectId: 'workspace-one', status: 'active',
      participantIds: ['elias', 'mara'], possibleObserverIds: [],
      perspective: { access: 'subjective', focalSubjectId: 'elias' },
      position: { sequence: 50 }
    });

    const result = plan();

    expect(result.context).toContain('ROLEPLAY NARRATIVE CONTEXT');
    expect(result.context).toContain('PLAYER PERSPECTIVE: ELIAS');
    expect(result.context).toContain('SCENE ACTOR PERSPECTIVE: MARA');
    expect(result.context).toContain('The northern gate is unguarded.');
    expect(result.context).toContain('The northern gate is trapped.');
    const playerSection = result.context
      .split('--- PLAYER PERSPECTIVE: ELIAS ---')[1]
      .split('--- SCENE ACTOR PERSPECTIVE: MARA ---')[0];
    expect(playerSection).toContain('The northern gate is unguarded.');
    expect(playerSection).not.toContain('The northern gate is trapped.');
    expect(result.context).toContain('A tagged archive says everyone knows the gate secret.');
    expect(result.context).toContain('This material is story evidence for the narrator.');
    expect(result.bundle?.scopes).toEqual(expect.arrayContaining([
      expect.objectContaining({ scopeId: 'subject:elias' }),
      expect.objectContaining({ scopeId: 'subject:mara' })
    ]));
    expect(result.manifest?.subjectIds).toEqual(expect.arrayContaining(['elias', 'mara']));
  });

  test('sends what each scene actor perceived and heard, never the player', () => {
    setWorkspaceExperienceMode(db, 'workspace-one', 'roleplay');
    for (const [id, name] of [['elias', 'Elias'], ['mara', 'Mara']]) {
      db.prepare(`
        INSERT INTO entities (id, workspaceId, type, canonicalName, aliases, lore, data, status, createdAt, last_modified)
        VALUES (?, 'workspace-one', 'Characters', ?, '[]', '', '{}', 'confirmed', 1, 1)
      `).run(id, name);
    }
    new NarrativeSceneRepository(db).save({
      id: 'scene-one', projectId: 'workspace-one', status: 'active',
      participantIds: ['elias', 'mara'], possibleObserverIds: [],
      perspective: { access: 'subjective', focalSubjectId: 'elias' },
      position: { sequence: 50 }
    });
    new CharacterSceneMemory(db).recordTurn({
      workspaceId: 'workspace-one', originId: 'reply-1', presentIds: ['elias', 'mara'], locationId: null, createdAt: 10,
      updates: [
        { entityId: 'mara', perceived: [], heard: [{ fromId: 'elias', text: 'he says the gate held eight guards' }], stance: 'doubts Elias' },
        { entityId: 'elias', perceived: ['the player is never remembered'], heard: [], stance: '' }
      ]
    });

    const result = plan();
    const memory = result.context.split('--- CHARACTER SCENE MEMORY ---')[1];

    expect(memory).toContain('Mara');
    expect(memory).toContain('heard from Elias: he says the gate held eight guards');
    expect(memory).toContain('stance: doubts Elias');
    expect(memory).not.toContain('the player is never remembered');
  });

  test('gives the turn focus a full sheet and an entity only a passage names a one-line mention', () => {
    setWorkspaceExperienceMode(db, 'workspace-one', 'roleplay');
    new NarrativeSceneRepository(db).save({
      id: 'scene-one', projectId: 'workspace-one', status: 'active',
      participantIds: ['elias'], possibleObserverIds: [],
      perspective: { access: 'subjective', focalSubjectId: 'elias' },
      position: { sequence: 50 }
    });
    const request = (query: string) => context.plan({
      requestId: `request-${query.length}`, workspaceId: 'workspace-one', query, tokenBudget: 2000,
      items: [{ id: 'chunk-gate', kind: 'workspace-memory', source: 'Archive', content: 'Elias once walked the northern road.', relevance: 0.8 }]
    });

    const passing = request('What does Elias do next?');
    expect(passing.context).toContain('Northern Gate (Locations): A weathered iron gate between two watchtowers.');
    expect(passing.context).not.toContain('The gate protects the northern road.');

    const named = request('What is happening at the northern gate?');
    expect(named.context).toContain('The gate protects the northern road.');
  });

  test('does not expand tagged entities when retrieval marks evidence as sufficient', () => {
    const result = context.plan({
      requestId: 'latest-state',
      workspaceId: 'workspace-one',
      query: 'Where did the story leave off?',
      tokenBudget: 1000,
      items: [{
        id: 'chunk-gate',
        kind: 'workspace-text',
        source: 'Day 14',
        content: 'Day 14 ended beside the northern gate.',
        relevance: 0.9,
        entityExpansion: 'none'
      }]
    });

    expect(result.context).toContain('Day 14 ended beside the northern gate.');
    expect(result.context).not.toContain('A weathered iron gate between two watchtowers.');
  });

  test('uses summaries for general retrieval and full dossiers for entity questions', () => {
    const base = {
      workspaceId: 'workspace-one',
      query: 'Tell me about the northern road.',
      tokenBudget: 1000,
      items: [{
        id: 'chunk-gate',
        kind: 'workspace-text' as const,
        source: 'Archive',
        content: 'The northern road passes through the gate.',
        relevance: 0.9
      }]
    };
    const summary = context.plan({
      ...base,
      requestId: 'summary-expansion',
      items: [{ ...base.items[0], entityExpansion: 'summary' }]
    });
    const dossier = context.plan({
      ...base,
      requestId: 'dossier-expansion',
      items: [{ ...base.items[0], entityExpansion: 'dossier' }]
    });

    expect(summary.context).toContain('A weathered iron gate between two watchtowers.');
    expect(summary.context).not.toContain('Material: Iron');
    expect(dossier.context).toContain('Material: Iron');
  });

  test('collapses repeated standard-mode memories while preserving their provenance', () => {
    const summary = 'The same patrol crossed the northern gate before dawn.';
    for (const [id, name] of [['elias', 'Elias'], ['mara', 'Mara']]) {
      db.prepare(`
        INSERT INTO entities (
          id, workspaceId, type, canonicalName, aliases, lore, data, status, createdAt, last_modified
        ) VALUES (?, 'workspace-one', 'Characters', ?, '[]', '', '{}', 'confirmed', 1, 1)
      `).run(id, name);
    }
    const narrativeState = new NarrativeStateSystem(db);
    for (const subjectId of ['elias', 'mara']) {
      narrativeState.createEvent({
        workspaceId: 'workspace-one',
        originId: `memory-${subjectId}`,
        interpreterId: 'system-model',
        allowedEntityIds: new Set(['elias', 'mara', 'northern-gate']),
        event: {
          type: 'custom',
          description: `${subjectId} remembers the patrol.`,
          excerpt: summary,
          participantIds: [subjectId],
          confidence: 0.99,
          operations: [{ type: 'memory', subjectId, summary, category: 'formative', salience: 0.9 }]
        }
      });
    }

    const result = context.plan({
      requestId: 'deduplicated-memories',
      workspaceId: 'workspace-one',
      query: 'What do Elias and Mara remember about the northern gate?',
      tokenBudget: 2000,
      items: [{
        id: 'chunk-gate',
        kind: 'workspace-text',
        source: 'Archive',
        content: 'The archive mentions the northern gate.',
        entityExpansion: 'dossier'
      }]
    });

    expect(result.context.split(summary)).toHaveLength(2);
    const memoryItem = result.plan.package.items.find(item => item.content.includes(summary));
    expect(memoryItem?.provenanceIds.length).toBeGreaterThanOrEqual(4);
  });

  test('keeps proportional expansion inside the user configured Worldbuild limits', () => {
    db.prepare(`
      INSERT INTO entities (
        id, workspaceId, type, canonicalName, aliases, lore, data, status, createdAt, last_modified
      ) VALUES (?, ?, ?, ?, '[]', '', ?, 'active', 1, 1)
    `).run(
      'watchtower',
      'workspace-one',
      'Locations',
      'Northern Watchtower',
      JSON.stringify({ description: 'A tower linked to the gate.' })
    );
    db.prepare(`
      INSERT INTO entity_links (id, workspaceId, fromId, relType, toId, label, metadata_json, createdAt)
      VALUES ('gate-tower', 'workspace-one', 'northern-gate', 'connected_to', 'watchtower', 'connected to', '{}', 1)
    `).run();
    db.exec('CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT)');
    db.prepare("INSERT INTO settings (key, value) VALUES ('advanced', ?)")
      .run(JSON.stringify({ worldbuildBreadth: 'broad', worldbuildEntityLimit: 1 }));

    const result = context.plan({
      requestId: 'settings-boundary',
      workspaceId: 'workspace-one',
      query: 'Explain the northern road.',
      tokenBudget: 5000,
      items: [{
        id: 'chunk-gate',
        kind: 'workspace-text',
        source: 'Archive',
        content: 'The road reaches the northern gate.',
        entityExpansion: 'summary'
      }]
    });

    expect(result.context).toContain('A weathered iron gate between two watchtowers.');
    expect(result.context).not.toContain('A tower linked to the gate.');
  });

  test('marks a concept as new for the player while allowing a knowledgeable NPC to react', () => {
    db.prepare(`
      INSERT INTO entities (
        id, workspaceId, type, canonicalName, aliases, lore, data,
        status, createdAt, last_modified
      ) VALUES (?, ?, 'System', ?, '[]', ?, '{}', 'confirmed', 1, 1)
    `).run('aether-weave', 'workspace-one', 'Aether Weave', 'A rare method of shaping light.');
    worldbuild.saveSubjectEntry({
      workspaceId: 'workspace-one', subjectId: 'mara', kind: 'knowledge',
      entry: {
        aboutId: 'aether-weave',
        statement: 'The Aether Weave destabilizes near iron.',
        confidence: 1,
        acquisition: 'reported',
        accessibility: 'available'
      }
    });
    new NarrativeSceneRepository(db).save({
      id: 'scene-concept', projectId: 'workspace-one', status: 'active',
      participantIds: ['elias', 'mara'], possibleObserverIds: [],
      perspective: { access: 'subjective', focalSubjectId: 'elias' },
      position: { sequence: 50 }
    });
    setWorkspaceExperienceMode(db, 'workspace-one', 'roleplay');

    const result = context.plan({
      requestId: 'concept-request',
      workspaceId: 'workspace-one',
      query: 'Mara mentions the Aether Weave.',
      tokenBudget: 2000,
      items: []
    });

    const playerSection = result.context
      .split('--- PLAYER PERSPECTIVE: ELIAS ---')[1]
      .split('--- SCENE ACTOR PERSPECTIVE: MARA ---')[0];
    expect(playerSection).toContain('Aether Weave: undetermined');
    expect(playerSection).not.toContain('destabilizes near iron');
    expect(result.context).toContain('Aether Weave: confirmed');
    expect(result.context).toContain('The Aether Weave destabilizes near iron.');
  });

  test('falls back to public canon without exposing subject-owned records', () => {
    setWorkspaceExperienceMode(db, 'workspace-one', 'roleplay');
    saveKnowledge('elias', 'The northern gate is unguarded.', 'available');

    const result = plan();

    expect(result.context).toContain('Northern Gate (Locations)');
    expect(result.context).toContain('A weathered iron gate between two watchtowers.');
    expect(result.context).toContain('Material: Iron');
    expect(result.context).not.toContain('The northern gate is unguarded.');
    expect(result.context).not.toContain('A tagged archive says everyone knows the gate secret.');
    expect(result.context).not.toContain('Internal code');
  });

  test('never includes inaccessible knowledge for an active omniscient scene', () => {
    setWorkspaceExperienceMode(db, 'workspace-one', 'roleplay');
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
    setWorkspaceExperienceMode(db, 'workspace-one', 'roleplay');
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

  test('normalizes faction Knowledge to members allowed by the card audience', () => {
    setWorkspaceExperienceMode(db, 'workspace-one', 'roleplay');
    db.prepare(`
      INSERT INTO entities (
        id, workspaceId, type, canonicalName, aliases, lore, data,
        status, createdAt, last_modified
      ) VALUES (?, ?, 'Factions', ?, '[]', '', '{}', 'confirmed', 1, 1)
    `).run('vanguard', 'workspace-one', 'Vanguard');
    db.prepare(`
      INSERT INTO entities (
        id, workspaceId, type, canonicalName, aliases, lore, data,
        status, createdAt, last_modified
      ) VALUES (?, ?, 'Characters', ?, '[]', '', '{}', 'confirmed', 1, 1)
    `).run('mara', 'workspace-one', 'Mara');
    db.prepare('INSERT INTO entity_links VALUES (?, ?, ?, ?, ?, NULL, ?, ?)')
      .run('membership-one', 'workspace-one', 'elias', 'member_of', 'vanguard', '{}', 1);
    worldbuild.saveSubjectEntry({
      workspaceId: 'workspace-one', subjectId: 'vanguard', kind: 'knowledge',
      entry: {
        aboutId: 'northern-gate',
        statement: 'The Vanguard watches the northern gate.',
        confidence: 1,
        acquisition: 'reported',
        accessibility: 'available'
      }
    });
    new NarrativeSceneRepository(db).save({
      id: 'scene-faction', projectId: 'workspace-one', status: 'active',
      participantIds: ['elias'], possibleObserverIds: [],
      perspective: { access: 'subjective', focalSubjectId: 'elias' },
      position: { sequence: 50 }
    });

    expect(plan().context).toContain('The Vanguard watches the northern gate.');

    worldbuild.setKnowledgeAudience({
      workspaceId: 'workspace-one',
      ownerId: 'vanguard',
      targetId: 'northern-gate',
      audienceType: 'selected-members',
      memberIds: ['mara']
    });
    expect(plan().context).not.toContain('The Vanguard watches the northern gate.');
  });

  test('retrieves only individually marked relationship snapshots for a subjective perspective', () => {
    setWorkspaceExperienceMode(db, 'workspace-one', 'roleplay');
    db.prepare(`
      INSERT INTO entities (
        id, workspaceId, type, canonicalName, aliases, lore, data,
        status, createdAt, last_modified
      ) VALUES (?, ?, 'Factions', ?, '[]', '', '{}', 'confirmed', 1, 1)
    `).run('vanguard', 'workspace-one', 'Vanguard');
    db.prepare('INSERT INTO entity_links VALUES (?, ?, ?, ?, ?, NULL, ?, ?)')
      .run('leader-one', 'workspace-one', 'vanguard', 'led_by', 'mara', '{}', 1);
    worldbuild.ensureAwareness({
      workspaceId: 'workspace-one', ownerId: 'elias', targetId: 'vanguard',
      sourceType: 'manual', sourceId: 'manual-vanguard',
    });
    new NarrativeSceneRepository(db).save({
      id: 'scene-known-relationship', projectId: 'workspace-one', status: 'active',
      participantIds: ['elias'], possibleObserverIds: [],
      perspective: { access: 'subjective', focalSubjectId: 'elias' },
      position: { sequence: 50 }
    });

    const before = context.plan({
      requestId: 'relationship-before',
      workspaceId: 'workspace-one',
      query: 'Who leads the Vanguard?',
      tokenBudget: 2000,
      items: []
    });
    expect(before.context).not.toContain('Known relationship: Vanguard / led by / Mara');
    db.prepare(`
      INSERT INTO entities (
        id, workspaceId, type, canonicalName, aliases, lore, data,
        status, createdAt, last_modified
      ) VALUES (?, ?, 'Characters', ?, '[]', '', '{}', 'confirmed', 1, 1)
    `).run('mara', 'workspace-one', 'Mara');

    worldbuild.setKnownRelationships({
      workspaceId: 'workspace-one', ownerId: 'elias', targetId: 'vanguard',
      relationshipIds: ['leader-one'],
    });
    db.prepare('DELETE FROM entity_links WHERE id = ?').run('leader-one');

    const after = context.plan({
      requestId: 'relationship-after',
      workspaceId: 'workspace-one',
      query: 'Who leads the Vanguard?',
      tokenBudget: 2000,
      items: []
    });
    expect(after.context).toContain('Known relationship: Vanguard / led by / Mara');
    expect(after.context).not.toContain('Relationship type:');
  });

  test('renders a bond known by several people in the scene once, under a shared header', () => {
    setWorkspaceExperienceMode(db, 'workspace-one', 'roleplay');
    const entity = db.prepare(`
      INSERT INTO entities (id, workspaceId, type, canonicalName, aliases, lore, data, status, createdAt, last_modified)
      VALUES (?, 'workspace-one', ?, ?, '[]', '', '{}', 'confirmed', 1, 1)
    `);
    entity.run('elias', 'Characters', 'Elias');
    entity.run('mara', 'Characters', 'Mara');
    entity.run('vanguard', 'Factions', 'Vanguard');
    db.prepare('INSERT INTO entity_links VALUES (?, ?, ?, ?, ?, NULL, ?, ?)').run('led', 'workspace-one', 'vanguard', 'led_by', 'mara', '{}', 1);
    for (const ownerId of ['elias', 'mara']) {
      worldbuild.ensureAwareness({ workspaceId: 'workspace-one', ownerId, targetId: 'vanguard', sourceType: 'manual', sourceId: `manual-${ownerId}` });
      worldbuild.setKnownRelationships({ workspaceId: 'workspace-one', ownerId, targetId: 'vanguard', relationshipIds: ['led'] });
    }
    new NarrativeSceneRepository(db).save({
      id: 'scene-shared', projectId: 'workspace-one', status: 'active',
      participantIds: ['elias', 'mara'], possibleObserverIds: [],
      perspective: { access: 'subjective', focalSubjectId: 'elias' },
      position: { sequence: 50 }
    });

    const result = context.plan({ requestId: 'shared-bond', workspaceId: 'workspace-one', query: 'Who leads the Vanguard?', tokenBudget: 4000, items: [] });
    expect(result.context.match(/Known relationship: Vanguard \/ led by \/ Mara/g)).toHaveLength(1);
    const shared = result.context.split('--- SHARED SUBJECT CONTEXT: ELIAS, MARA ---')[1] ?? '';
    expect(shared.split('\n--- ')[0]).toContain('Known relationship: Vanguard / led by / Mara');
  });

  test('keeps known relationships that touch the turn focus and leaves out ties between others', () => {
    setWorkspaceExperienceMode(db, 'workspace-one', 'roleplay');
    const entity = db.prepare(`
      INSERT INTO entities (id, workspaceId, type, canonicalName, aliases, lore, data, status, createdAt, last_modified)
      VALUES (?, 'workspace-one', ?, ?, '[]', '', '{}', 'confirmed', 1, 1)
    `);
    entity.run('vanguard', 'Factions', 'Vanguard');
    entity.run('mara', 'Characters', 'Mara');
    entity.run('order', 'Factions', 'Order');
    entity.run('ser', 'Characters', 'Ser');
    const link = db.prepare('INSERT INTO entity_links VALUES (?, ?, ?, ?, ?, NULL, ?, ?)');
    link.run('led', 'workspace-one', 'vanguard', 'led_by', 'mara', '{}', 1);
    link.run('member', 'workspace-one', 'ser', 'member_of', 'order', '{}', 1);
    for (const [targetId, relationshipIds] of [['vanguard', ['led']], ['mara', ['led']], ['order', ['member']]] as const) {
      worldbuild.ensureAwareness({ workspaceId: 'workspace-one', ownerId: 'elias', targetId, sourceType: 'manual', sourceId: `manual-${targetId}` });
      worldbuild.setKnownRelationships({ workspaceId: 'workspace-one', ownerId: 'elias', targetId, relationshipIds: [...relationshipIds] });
    }
    new NarrativeSceneRepository(db).save({
      id: 'scene-focus', projectId: 'workspace-one', status: 'active',
      participantIds: ['elias'], possibleObserverIds: [],
      perspective: { access: 'subjective', focalSubjectId: 'elias' },
      position: { sequence: 50 }
    });
    db.prepare('INSERT INTO chunk_tags (chunkId, tag, entity) VALUES (?, ?, ?)').run('chunk-order', 'Order', 'order');

    const result = context.plan({
      requestId: 'relationship-focus', workspaceId: 'workspace-one', query: 'What does Mara want from the Vanguard?', tokenBudget: 4000,
      items: [{ id: 'chunk-order', kind: 'workspace-memory', source: 'Archive', content: 'The Order marched past.', relevance: 0.8 }]
    });
    expect(result.context.match(/Known relationship: Vanguard \/ led by \/ Mara/g)).toHaveLength(1);
    expect(result.context).not.toContain('Known relationship: Ser / member of / Order');
  });

  test('standard provides identified canon and knowledge from different subjects without a scene', () => {
    saveKnowledge('elias', 'The northern gate is unguarded.', 'available');
    saveKnowledge('mara', 'The northern gate is trapped.', 'available');

    const result = plan();

    expect(result.plan.package.perspective).toEqual({ access: 'omniscient' });
    expect(result.context).toContain('Northern Gate (Locations)');
    expect(result.context).toContain('Owner: elias');
    expect(result.context).toContain('Narrative sequence:');
    expect(result.context).toContain('The northern gate is unguarded.');
    expect(result.context).toContain('Owner: mara');
    expect(result.context).toContain('The northern gate is trapped.');
  });

  test('standard keeps suppressed and inaccessible subject records blocked', () => {
    saveKnowledge('elias', 'A suppressed gate detail.', 'suppressed');
    saveKnowledge('mara', 'An inaccessible gate detail.', 'inaccessible');

    const result = plan();

    expect(result.context).not.toContain('A suppressed gate detail.');
    expect(result.context).not.toContain('An inaccessible gate detail.');
  });

  test('switching modes changes the Kallamo request without changing narrative data', () => {
    saveKnowledge('elias', 'The northern gate is unguarded.', 'available');
    saveKnowledge('mara', 'The northern gate is trapped.', 'available');
    new NarrativeSceneRepository(db).save({
      id: 'scene-switch', projectId: 'workspace-one', status: 'active',
      participantIds: ['elias', 'mara'], possibleObserverIds: [],
      perspective: { access: 'subjective', focalSubjectId: 'elias' },
      position: { sequence: 50 }
    });
    const before = snapshotNarrativeData();

    const standard = plan();
    setWorkspaceExperienceMode(db, 'workspace-one', 'roleplay');
    const roleplay = plan();

    expect(standard.plan.package.perspective).toEqual({ access: 'omniscient' });
    expect(roleplay.plan.package.perspective).toEqual({ access: 'subjective', focalSubjectId: 'elias' });
    expect(standard.context).toContain('The northern gate is trapped.');
    expect(roleplay.context).toContain('PLAYER PERSPECTIVE: ELIAS');
    expect(roleplay.context).toContain('SCENE ACTOR PERSPECTIVE: MARA');
    expect(roleplay.context).toContain('The northern gate is trapped.');
    expect(snapshotNarrativeData()).toEqual(before);
  });

  test('existing workspaces default to standard without persisting a row', () => {
    expect(getWorkspaceExperienceMode(db, 'existing-workspace')).toBe('standard');
    expect(db.prepare('SELECT COUNT(*) AS count FROM workspace_experience_modes').get()).toEqual({ count: 0 });
  });

  test('Kallamo mode contracts do not enter the narrative core', () => {
    const coreFiles = ['contracts.ts', 'context-planner.ts', 'index.ts'];
    coreFiles.forEach(file => {
      const source = readFileSync(join(process.cwd(), 'src', 'narrative', file), 'utf8');
      expect(source).not.toMatch(/WorkspaceExperienceMode|standard|roleplay|campaign/i);
    });
  });

  test('roleplay sends tracked state through the same planner with focal-subject filtering', () => {
    db.prepare(`INSERT INTO entities (id, workspaceId, type, canonicalName, aliases, lore, data, status, createdAt, last_modified)
      VALUES (?, ?, 'Characters', ?, '[]', '', '{}', 'confirmed', 1, 1)`)
      .run('elias', 'workspace-one', 'Elias');
    db.prepare(`INSERT INTO entities (id, workspaceId, type, canonicalName, aliases, lore, data, status, createdAt, last_modified)
      VALUES (?, ?, 'Characters', ?, '[]', '', '{}', 'confirmed', 1, 1)`)
      .run('mara', 'workspace-one', 'Mara');
    const roleplay = new RoleplaySystem(db);
    const health = roleplay.saveDefinition('workspace-one', {
      name: 'Health', key: 'health', color: '#dc2626', minimum: 0, maximum: 100,
      appliesTo: ['Characters'], updatePolicy: 'review'
    });
    roleplay.setTargetValue('workspace-one', health.id, 'entity', 'elias', { current: 80 });
    roleplay.setTargetValue('workspace-one', health.id, 'entity', 'mara', { current: 35 });
    roleplay.saveSettings('workspace-one', { playerEntityId: 'elias' });
    setWorkspaceExperienceMode(db, 'workspace-one', 'roleplay');

    const result = context.plan({
      requestId: 'state-request', workspaceId: 'workspace-one', query: 'How am I doing?', tokenBudget: 1000,
      items: [{ id: 'state-query', kind: 'worldbuild-canon', source: 'Worldbuild', content: 'Elias and Mara', entityIds: ['elias', 'mara'] }]
    });

    expect(result.plan.package.perspective).toEqual({ access: 'subjective', focalSubjectId: 'elias' });
    expect(result.context).toContain('Health: 80 / 100');
    expect(result.context).not.toContain('Health: 35 / 100');
    expect(result.context).not.toContain('ROLEPLAY STATE UPDATE PROTOCOL');
    expect(result.context).not.toContain('KALLAMO_ROLEPLAY_CHANGES');
    expect(result.plan.package.items).toContainEqual(expect.objectContaining({ source: { type: 'state', id: 'elias:health' } }));
  });

  test('plans scene and canonical relationship context when retrieval returns no items', () => {
    db.prepare(`INSERT INTO entities (id, workspaceId, type, canonicalName, aliases, lore, data, status, createdAt, last_modified)
      VALUES (?, 'workspace-one', 'Characters', ?, '[]', '', '{}', 'confirmed', 1, 1)`).run('elias', 'Elias');
    db.prepare(`INSERT INTO entities (id, workspaceId, type, canonicalName, aliases, lore, data, status, createdAt, last_modified)
      VALUES (?, 'workspace-one', 'Characters', ?, '[]', '', '{}', 'confirmed', 1, 1)`).run('mara', 'Mara');
    db.prepare(`INSERT INTO entity_links (id, workspaceId, fromId, relType, toId, label, metadata_json, createdAt)
      VALUES ('bond', 'workspace-one', 'elias', 'related_to', 'mara', 'Oldest friend', ?, 1)`)
      .run(JSON.stringify({ value: 72, description: 'Elias trusts Mara with his life.' }));
    new NarrativeSceneRepository(db).save({
      id: 'scene-empty-rag', projectId: 'workspace-one', status: 'active', participantIds: ['elias', 'mara'], possibleObserverIds: [],
      perspective: { access: 'subjective', focalSubjectId: 'elias' }, position: { sequence: 1 }
    });
    setWorkspaceExperienceMode(db, 'workspace-one', 'roleplay');

    const result = context.plan({ requestId: 'empty-rag', workspaceId: 'workspace-one', query: 'What happens?', tokenBudget: 2000, items: [] });

    expect(result.context).toContain('Scene: scene-empty-rag');
    expect(result.context).toContain('Title: Oldest friend');
    expect(result.context).toContain('Value: 72');
    expect(result.context).toContain('Description: Elias trusts Mara with his life.');
  });

  test('retrieves introduction facts for a sparse narrative entity on the next turn', () => {
    db.prepare(`INSERT INTO entities (id, workspaceId, type, canonicalName, aliases, lore, data, status, createdAt, last_modified)
      VALUES ('selka', 'workspace-one', 'Characters', 'Selka', '[]', '', '{"needsEnrichment":true}', 'confirmed', 1, 1)`).run();
    const state = new NarrativeStateSystem(db);
    state.beginJob('workspace-one', 'message-selka');
    state.createEvent({
      workspaceId: 'workspace-one', originId: 'message-selka', interpreterId: 'system-model', allowedEntityIds: new Set(['selka']),
      event: {
        type: 'custom', description: 'Selka enters the tavern.', excerpt: 'Selka enters carrying a broken spear.',
        participantIds: ['selka'], confidence: 0.99,
        operations: [{ type: 'fact', proposition: { subjectId: 'selka', predicate: 'narrative-introduction', object: 'A mercenary carrying a broken spear.' }, category: 'identity', confidence: 0.99 }]
      }
    });
    const roleplay = new RoleplaySystem(db);
    roleplay.saveSettings('workspace-one', { playerEntityId: 'selka' });
    roleplay.saveScene('workspace-one', { participantIds: ['selka'] });
    setWorkspaceExperienceMode(db, 'workspace-one', 'roleplay');

    const result = context.plan({ requestId: 'selka-next-turn', workspaceId: 'workspace-one', query: 'Who is Selka?', tokenBudget: 2000, items: [] });

    expect(result.context).toContain('Selka (Characters)');
    expect(result.context).toContain('narrative-introduction: A mercenary carrying a broken spear.');
  });

  test('projects unique items and item-type quantities from the focal inventory', () => {
    db.prepare(`INSERT INTO entities (id, workspaceId, type, canonicalName, aliases, lore, data, status, createdAt, last_modified)
      VALUES ('elias', 'workspace-one', 'Characters', 'Elias', '[]', '', '{}', 'confirmed', 1, 1)`).run();
    db.prepare(`INSERT INTO entities (id, workspaceId, type, canonicalName, aliases, lore, data, status, createdAt, last_modified)
      VALUES ('moonblade', 'workspace-one', 'Items', 'Moonblade', '[]', '', ?, 'confirmed', 1, 1)`)
      .run(JSON.stringify({ itemNature: 'unique', itemType: 'Weapon' }));
    db.prepare(`INSERT INTO entities (id, workspaceId, type, canonicalName, aliases, lore, data, status, createdAt, last_modified)
      VALUES ('potion', 'workspace-one', 'Items', 'Healing Potion', '[]', '', ?, 'confirmed', 1, 1)`)
      .run(JSON.stringify({ itemNature: 'type', itemType: 'Consumable' }));
    db.prepare(`INSERT INTO entity_links (id, workspaceId, fromId, relType, toId, metadata_json, createdAt)
      VALUES ('owned-moonblade', 'workspace-one', 'moonblade', 'owned_by', 'elias', '{"quantity":1}', 1)`).run();
    db.prepare(`INSERT INTO entity_links (id, workspaceId, fromId, relType, toId, metadata_json, createdAt)
      VALUES ('carried-potions', 'workspace-one', 'potion', 'carried_by', 'elias', '{"quantity":3}', 1)`).run();
    const roleplay = new RoleplaySystem(db);
    roleplay.saveSettings('workspace-one', { playerEntityId: 'elias' });
    roleplay.saveScene('workspace-one', { participantIds: [] });
    roleplay.setEquipped('workspace-one', 'elias', 'moonblade', true);
    setWorkspaceExperienceMode(db, 'workspace-one', 'roleplay');

    const result = context.plan({ requestId: 'inventory', workspaceId: 'workspace-one', query: 'What am I carrying?', tokenBudget: 2000, items: [] });
    expect(result.context).toContain('Elias inventory: Moonblade (unique) [equipped]');
    expect(result.context).toContain('Elias inventory: Healing Potion x3');
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
      JSON.stringify({
        description: 'A weathered iron gate between two watchtowers.',
        customFields: { material: 'Iron', 'internal-code': 'SEVEN' }
      })
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

  function snapshotNarrativeData() {
    return {
      events: db.prepare('SELECT * FROM narrative_events ORDER BY event_id').all(),
      records: db.prepare('SELECT * FROM narrative_records ORDER BY record_type, record_id').all(),
      scenes: db.prepare('SELECT * FROM narrative_scenes ORDER BY scene_id').all()
    };
  }
});
