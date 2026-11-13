import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import { EpistemicResolver } from '../../src/main/features/narrative/epistemic-resolver';
import { NarrativeContextManifestRepository } from '../../src/main/features/narrative/context-manifest';
import { AgenticEpistemicTools } from '../../src/main/features/narrative/agentic-epistemic-tools';
import { createWorldbuildKnowledgeService } from '../../src/main/features/worldbuild/knowledge-service.js';
import { writeStoryEvent } from '../../src/main/features/narrative/umwelt/story-journal';
import { indexOriginRecords, retireOrigins } from '../../src/main/features/narrative/umwelt/story-lifecycle';
import { createWorldbuildDataService } from '../../src/main/features/worldbuild/worldbuild-data.js';
import { openTestDatabase } from '../sqlite-test-database';

describe('roleplay epistemic resolution', () => {
  let directory: string;
  let db: Database.Database;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'epistemic-resolver-'));
    db = openTestDatabase(join(directory, 'context.db'));
    db.pragma('foreign_keys = ON');
    runDatabaseMigrations(db);
    db.exec(`
      CREATE TABLE entities (
        id TEXT PRIMARY KEY, workspaceId TEXT, type TEXT NOT NULL,
        canonicalName TEXT NOT NULL, aliases TEXT, lore TEXT, data TEXT,
        status TEXT NOT NULL, createdAt INTEGER, last_modified INTEGER
      );
      CREATE TABLE entity_links (
        id TEXT PRIMARY KEY, workspaceId TEXT, fromId TEXT, relType TEXT,
        toId TEXT, label TEXT, metadata_json TEXT, createdAt INTEGER
      );
    `);
    insertEntity('rosalind', 'Characters', 'Rosalind', 'A veteran of the Order of Thorns.');
    insertEntity('order', 'Factions', 'Order of Thorns', '');
    insertEntity('corwin', 'Characters', 'Corwin', '');
  });

  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test('treats a Knowledge card as confirmed Awareness and absence as undetermined', () => {
    const knowledge = createWorldbuildKnowledgeService(db);
    knowledge.ensureAwareness({
      workspaceId: 'workspace-one', ownerId: 'corwin', targetId: 'order',
      sourceType: 'manual', sourceId: 'manual-one'
    });

    const matrix = new EpistemicResolver(db).resolve({
      workspaceId: 'workspace-one',
      subjectIds: ['corwin', 'rosalind'],
      targetIds: ['order'],
      through: { sequence: 0 }
    });

    expect(matrix.assessments).toContainEqual(expect.objectContaining({
      subjectId: 'corwin', targetId: 'order', state: 'confirmed'
    }));
    expect(matrix.assessments).toContainEqual(expect.objectContaining({
      subjectId: 'rosalind', targetId: 'order', state: 'derived'
    }));
  });

  test('does not turn veteran evidence into current membership', () => {
    const matrix = new EpistemicResolver(db).resolve({
      workspaceId: 'workspace-one',
      subjectIds: ['rosalind'],
      targetIds: ['order'],
      through: { sequence: 0 }
    });

    expect(matrix.assessments[0]).toEqual(expect.objectContaining({
      state: 'derived',
      evidence: expect.stringContaining('veteran')
    }));
    expect(db.prepare("SELECT COUNT(*) AS count FROM entity_links WHERE relType = 'member_of'").get())
      .toEqual({ count: 0 });
  });

  test('keeps an unsupported pair undetermined', () => {
    const matrix = new EpistemicResolver(db).resolve({
      workspaceId: 'workspace-one',
      subjectIds: ['corwin'],
      targetIds: ['rosalind'],
      through: { sequence: 0 }
    });

    expect(matrix.assessments[0]).toEqual(expect.objectContaining({ state: 'undetermined' }));
  });

  test('requires a temporal record before treating a subject as explicitly unaware', () => {
    const knowledge = createWorldbuildKnowledgeService(db);
    knowledge.ensureAwareness({
      workspaceId: 'workspace-one', ownerId: 'corwin', targetId: 'order',
      sourceType: 'manual', sourceId: 'manual-one'
    });
    knowledge.removeCard({
      workspaceId: 'workspace-one', ownerId: 'corwin', targetId: 'order'
    });

    const matrix = new EpistemicResolver(db).resolve({
      workspaceId: 'workspace-one',
      subjectIds: ['corwin'],
      targetIds: ['order'],
      through: { sequence: 999 }
    });

    expect(matrix.assessments[0]).toEqual(expect.objectContaining({
      state: 'explicitly-unaware'
    }));
  });

  test('persists and attaches the compact pre-turn manifest without prompt content', () => {
    const repository = new NarrativeContextManifestRepository(db);
    repository.save({
      requestId: 'request-one',
      workspaceId: 'workspace-one',
      sequence: 4,
      playerSubjectId: 'corwin',
      sceneId: 'scene-one',
      subjectIds: ['corwin', 'rosalind'],
      targetIds: ['order'],
      assessments: [{
        subjectId: 'rosalind', targetId: 'order', state: 'derived',
        sourceIds: ['entity:rosalind'], evidence: 'veteran of the Order of Thorns'
      }],
      deepenedPairs: [{ subjectId: 'rosalind', targetId: 'order' }]
    });
    repository.attachOrigin('workspace-one', 'request-one', 'message-one');

    expect(repository.getByOrigin('workspace-one', 'message-one')).toEqual(expect.objectContaining({
      requestId: 'request-one',
      originId: 'message-one',
      subjectIds: ['corwin', 'rosalind']
    }));
    const stored = db.prepare(`
      SELECT manifest_json AS manifest FROM narrative_context_manifests
      WHERE workspace_id = ? AND request_id = ?
    `).get('workspace-one', 'request-one') as { manifest: string };
    expect(stored.manifest).not.toContain('systemPrompt');
    expect(stored.manifest).not.toContain('narrativeResponse');
  });

  test('lets Agentic retrieval deepen one subject-target pair without a world dossier dump', () => {
    const knowledge = createWorldbuildKnowledgeService(db);
    knowledge.ensureAwareness({
      workspaceId: 'workspace-one', ownerId: 'corwin', targetId: 'order',
      sourceType: 'manual', sourceId: 'manual-one'
    });
    const tools = new AgenticEpistemicTools(db);

    expect(tools.inspectSubjectKnowledge('workspace-one', 'Corwin | Order of Thorns'))
      .toContain('Corwin -> Order of Thorns: confirmed');
    expect(tools.inspectSubjectEvidence('workspace-one', 'Rosalind | Order of Thorns'))
      .toContain('Assessment: derived');
  });

  test('exposes marked relationship snapshots through Agentic Knowledge inspection', () => {
    const knowledge = createWorldbuildKnowledgeService(db);
    db.prepare('INSERT INTO entity_links VALUES (?, ?, ?, ?, ?, NULL, ?, ?)').run(
      'leader-one', 'workspace-one', 'order', 'led_by', 'rosalind', '{}', 1,
    );
    knowledge.ensureAwareness({
      workspaceId: 'workspace-one', ownerId: 'corwin', targetId: 'order',
      sourceType: 'manual', sourceId: 'manual-one'
    });
    knowledge.setKnownRelationships({
      workspaceId: 'workspace-one', ownerId: 'corwin', targetId: 'order',
      relationshipIds: ['leader-one']
    });
    db.prepare('DELETE FROM entity_links WHERE id = ?').run('leader-one');

    const result = new AgenticEpistemicTools(db)
      .inspectSubjectKnowledge('workspace-one', 'Corwin | Order of Thorns');

    expect(result).toContain('Known relationships: Order of Thorns / led_by / Rosalind');
  });

  test('keeps inaccessible and revoked Knowledge content out of Agentic inspection', () => {
    const worldbuild = createWorldbuildDataService(db);
    worldbuild.saveSubjectEntry({
      workspaceId: 'workspace-one',
      subjectId: 'corwin',
      kind: 'knowledge',
      entry: {
        aboutId: 'order',
        statement: 'The sealed archive opens beneath the eastern bell.',
        confidence: 1,
        acquisition: 'reported',
        accessibility: 'inaccessible'
      }
    });
    const active = worldbuild.saveSubjectEntry({
      workspaceId: 'workspace-one',
      subjectId: 'corwin',
      kind: 'knowledge',
      entry: {
        aboutId: 'order',
        statement: 'The retired passphrase is dawnfall.',
        confidence: 1,
        acquisition: 'reported',
        accessibility: 'available'
      }
    });
    worldbuild.deleteSubjectEntry({
      workspaceId: 'workspace-one',
      subjectId: 'corwin',
      kind: 'knowledge',
      entryId: active.known.find((entry: { statement: string }) => entry.statement.includes('dawnfall'))!.id
    });

    const result = new AgenticEpistemicTools(db)
      .inspectSubjectKnowledge('workspace-one', 'Corwin | Order of Thorns');

    expect(result).not.toContain('eastern bell');
    expect(result).not.toContain('dawnfall');
    expect(result).toContain('unavailable (inaccessible)');
  });

  test('projects current memories and hides inaccessible or forgotten content from Agentic inspection', () => {
    const worldbuild = createWorldbuildDataService(db);
    worldbuild.saveSubjectEntry({
      workspaceId: 'workspace-one',
      subjectId: 'corwin',
      kind: 'memory',
      entry: {
        summary: 'The hidden witness waited beneath the ash tree.',
        accessibility: 'inaccessible'
      }
    });
    const active = worldbuild.saveSubjectEntry({
      workspaceId: 'workspace-one',
      subjectId: 'corwin',
      kind: 'memory',
      entry: {
        summary: 'The forgotten route crossed the salt bridge.',
        accessibility: 'available'
      }
    });
    worldbuild.deleteSubjectEntry({
      workspaceId: 'workspace-one',
      subjectId: 'corwin',
      kind: 'memory',
      entryId: active.memories.find((entry: { summary: string }) => entry.summary.includes('salt bridge'))!.id
    });

    const result = new AgenticEpistemicTools(db)
      .inspectSubjectMemories('workspace-one', 'Corwin');

    expect(result).not.toContain('ash tree');
    expect(result).not.toContain('salt bridge');
    expect(result).toContain('unavailable (inaccessible)');
  });

  test('excludes records whose narrative origin is no longer active', () => {
    insertNarrativeKnowledge({
      eventId: 'event-invalidated',
      originId: 'message-invalidated',
      recordId: 'knowledge-invalidated',
      statement: 'The invalidated response revealed the glass vault.'
    });
    const inspect = () => new AgenticEpistemicTools(db)
      .inspectSubjectKnowledge('workspace-one', 'Corwin | Order of Thorns');
    expect(inspect()).toContain('glass vault');

    retireOrigins(db, 'workspace-one', ['message-invalidated']);

    expect(inspect()).not.toContain('glass vault');
  });

  test('returns only the latest revision of a stable Knowledge entry', () => {
    const worldbuild = createWorldbuildDataService(db);
    const first = worldbuild.saveSubjectEntry({
      workspaceId: 'workspace-one',
      subjectId: 'corwin',
      kind: 'knowledge',
      entry: {
        aboutId: 'order',
        statement: 'The meeting begins at sunset.',
        confidence: 1,
        acquisition: 'reported',
        accessibility: 'available'
      }
    });
    worldbuild.saveSubjectEntry({
      workspaceId: 'workspace-one',
      subjectId: 'corwin',
      kind: 'knowledge',
      existingId: first.known[0].id,
      entry: {
        aboutId: 'order',
        statement: 'The meeting begins at midnight.',
        confidence: 1,
        acquisition: 'reported',
        accessibility: 'available'
      }
    });

    const result = new AgenticEpistemicTools(db)
      .inspectSubjectKnowledge('workspace-one', 'Corwin | Order of Thorns');

    expect(result).not.toContain('sunset');
    expect(result).toContain('midnight');
  });

  test('enforces faction card audience before deepening faction Knowledge for a member', () => {
    insertEntity('bulwark', 'Factions', 'Bulwark', '');
    insertEntity('tess', 'Characters', 'Tess', '');
    db.prepare(`
      INSERT INTO entity_links (
        id, workspaceId, fromId, relType, toId, label, metadata_json, createdAt
      ) VALUES ('membership-corwin', 'workspace-one', 'corwin', 'member_of', 'bulwark', NULL, '{}', 1)
    `).run();
    const worldbuild = createWorldbuildDataService(db);
    worldbuild.saveSubjectEntry({
      workspaceId: 'workspace-one',
      subjectId: 'bulwark',
      kind: 'knowledge',
      entry: {
        aboutId: 'order',
        statement: 'The Order keeps a listening post at Greywatch.',
        confidence: 1,
        acquisition: 'reported',
        accessibility: 'available'
      }
    });
    worldbuild.setKnowledgeAudience({
      workspaceId: 'workspace-one',
      ownerId: 'bulwark',
      targetId: 'order',
      audienceType: 'selected-members',
      memberIds: ['tess']
    });

    const result = new AgenticEpistemicTools(db)
      .inspectSubjectKnowledge('workspace-one', 'Corwin | Order of Thorns');

    expect(result).not.toContain('Greywatch');
  });

  test('combines direct Awareness with authorized faction Knowledge for the same target', () => {
    insertEntity('bulwark', 'Factions', 'Bulwark', '');
    db.prepare(`
      INSERT INTO entity_links (
        id, workspaceId, fromId, relType, toId, label, metadata_json, createdAt
      ) VALUES ('membership-corwin', 'workspace-one', 'corwin', 'member_of', 'bulwark', NULL, '{}', 1)
    `).run();
    const worldbuild = createWorldbuildDataService(db);
    worldbuild.ensureAwareness({
      workspaceId: 'workspace-one',
      ownerId: 'corwin',
      targetId: 'order',
      sourceType: 'manual',
      sourceId: 'direct-awareness'
    });
    worldbuild.saveSubjectEntry({
      workspaceId: 'workspace-one',
      subjectId: 'bulwark',
      kind: 'knowledge',
      entry: {
        aboutId: 'order',
        statement: 'The Order keeps a listening post at Greywatch.',
        confidence: 1,
        acquisition: 'reported',
        accessibility: 'available'
      }
    });

    const result = new AgenticEpistemicTools(db)
      .inspectSubjectKnowledge('workspace-one', 'Corwin | Order of Thorns');

    expect(result).toContain('Greywatch');
  });

  test('reads Awareness as it stood at the position asked for', () => {
    const grant = (eventId: string, status: 'active' | 'revoked') => writeStoryEvent(db, 'workspace-one', {
      eventId, description: 'Awareness transition.', participants: ['corwin'],
      provenance: { interpreter: 'deterministic', originType: 'world-action', originId: eventId },
      operations: [{ id: `operation-${eventId}`, type: 'grant-awareness', evidenceIds: [], awareness: { id: `awareness-${eventId}`, subjectId: 'corwin', targetId: 'order', status, sourceEventId: eventId } }]
    });
    for (let turn = 1; turn <= 40; turn += 1) grant(`event-${turn}`, turn % 2 === 0 ? 'revoked' : 'active');
    const resolver = new EpistemicResolver(db);
    const state = (sequence: number) => resolver.resolve({ workspaceId: 'workspace-one', subjectIds: ['corwin'], targetIds: ['order'], through: { sequence } }).assessments[0].state;

    expect(state(39)).toBe('confirmed');
    expect(state(40)).not.toBe('confirmed');
    db.prepare(`INSERT INTO worldbuild_knowledge_cards (workspace_id, card_id, owner_id, target_id, status, created_at, updated_at)
      VALUES ('workspace-one', 'card-forgot', 'corwin', 'order', 'forgotten', 1, 1)`).run();
    expect(state(40)).toBe('explicitly-unaware');
  });

  function insertEntity(id: string, type: string, name: string, lore: string) {
    db.prepare(`
      INSERT INTO entities (
        id, workspaceId, type, canonicalName, aliases, lore, data,
        status, createdAt, last_modified
      ) VALUES (?, 'workspace-one', ?, ?, '[]', ?, '{}', 'confirmed', 1, 1)
    `).run(id, type, name, lore);
  }

  function insertNarrativeKnowledge(input: {
    eventId: string;
    originId: string;
    recordId: string;
    statement: string;
  }) {
    const written = writeStoryEvent(db, 'workspace-one', {
      eventId: input.eventId, description: 'Narrative Knowledge', participants: ['corwin'],
      provenance: { interpreter: 'deterministic', originType: 'chat-message', originId: input.originId, excerpt: input.statement },
      operations: [{
        id: `operation-${input.eventId}`, type: 'grant-knowledge', evidenceIds: [],
        knowledge: {
          id: input.recordId, entryId: input.recordId, subjectId: 'corwin',
          proposition: { subjectId: 'order', predicate: 'worldbuild-statement', object: input.statement },
          sourceEventId: input.eventId, acquisition: 'witness', confidence: 1, accessibility: 'available', status: 'active'
        }
      } as any]
    });
    indexOriginRecords(db, 'workspace-one', input.originId, written.outcome);
  }
});
