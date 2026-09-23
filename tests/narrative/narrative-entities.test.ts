import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import { NarrativeEntitySystem } from '../../src/main/features/narrative/narrative-entities';
import { NarrativeContextManifestRepository } from '../../src/main/features/narrative/context-manifest';
import { openTestDatabase } from '../sqlite-test-database';

describe('Narrative entity identity', () => {
  let directory: string;
  let db: Database.Database;
  let system: NarrativeEntitySystem;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'kallamo-narrative-entities-'));
    db = openTestDatabase(join(directory, 'identity.db'));
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE entities (
        id TEXT PRIMARY KEY, workspaceId TEXT, type TEXT, canonicalName TEXT,
        aliases TEXT, lore TEXT, loreDocumentId TEXT, data TEXT, status TEXT,
        createdAt INTEGER, last_modified INTEGER
      );
      CREATE TABLE entity_links (
        id TEXT PRIMARY KEY, workspaceId TEXT, fromId TEXT, relType TEXT,
        toId TEXT, label TEXT, metadata_json TEXT, createdAt INTEGER
      );
    `);
    runDatabaseMigrations(db);
    system = new NarrativeEntitySystem(db);
  });

  afterEach(() => {
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test('creates an unequivocal character once with sparse enrichment metadata', () => {
    const proposal = entityProposal({ referenceId: 'new:selka', name: 'Selka' });
    const first = system.resolveOrPropose('workspace-one', 'message-one', proposal);
    const repeated = system.resolveOrPropose('workspace-one', 'message-one', proposal);

    expect(first.status).toBe('applied');
    expect(repeated.entityId).toBe(first.entityId);
    const entity = db.prepare('SELECT * FROM entities WHERE id = ?').get(first.entityId) as Record<string, unknown>;
    expect(entity).toMatchObject({ canonicalName: 'Selka', type: 'Characters', status: 'confirmed', lore: '' });
    expect(JSON.parse(String(entity.data))).toMatchObject({ needsEnrichment: true, narrativeOrigin: { originId: 'message-one' } });
  });

  test('reuses an existing alias instead of creating a duplicate identity', () => {
    db.prepare(`
      INSERT INTO entities VALUES ('selka', 'workspace-one', 'Characters', 'Selka Venn', '["Selka"]', '', NULL, '{}', 'confirmed', 1, 1)
    `).run();
    const change = system.resolveOrPropose('workspace-one', 'message-one', entityProposal({ referenceId: 'new:selka', name: 'Sélka' }));

    expect(change).toMatchObject({ entityId: 'selka', status: 'applied' });
    expect(db.prepare('SELECT COUNT(*) AS count FROM entities').get()).toEqual({ count: 1 });
    system.markOrigin('workspace-one', 'message-one', 'deleted');
    expect(db.prepare("SELECT status FROM entities WHERE id = 'selka'").get()).toEqual({ status: 'confirmed' });
  });

  test('keeps locations and conflicts reviewable', () => {
    const location = system.resolveOrPropose('workspace-one', 'message-one', entityProposal({
      referenceId: 'new:varos', name: 'Varos', type: 'Locations'
    }));
    const conflict = system.resolveOrPropose('workspace-one', 'message-one', entityProposal({
      referenceId: 'new:false-king', name: 'The Returned King', decision: 'conflicting'
    }));

    expect(location.status).toBe('pending');
    expect(conflict.status).toBe('conflicting');
    expect(system.resolveChange('workspace-one', location.id, 'approved')).toMatchObject({ status: 'applied', entityId: expect.any(String) });
  });

  test('keeps a visually described anonymous character sparse until explicitly registered', () => {
    const change = system.resolveOrPropose('workspace-one', 'message-one', entityProposal({
      referenceId: 'new:scarred-sentinel',
      name: 'Scarred Sentinel',
      description: 'An unnamed sentinel with a facial scar stands nearest the door.',
      identityEstablished: false
    }));

    expect(change).toMatchObject({ status: 'pending', entityId: null, createdEntity: false });
    expect(db.prepare('SELECT COUNT(*) AS count FROM entities').get()).toEqual({ count: 0 });

    const registered = system.resolveChange('workspace-one', change.id, 'approved');
    expect(registered).toMatchObject({ status: 'applied', entityId: expect.any(String), createdEntity: true });
    expect(db.prepare('SELECT canonicalName FROM entities WHERE id = ?').get(registered.entityId))
      .toEqual({ canonicalName: 'Scarred Sentinel' });
  });

  test('hides an automatically created identity when its source response is deleted', () => {
    const change = system.resolveOrPropose('workspace-one', 'message-one', entityProposal({ referenceId: 'new:selka', name: 'Selka' }));
    system.markOrigin('workspace-one', 'message-one', 'deleted');

    expect(db.prepare('SELECT status FROM entities WHERE id = ?').get(change.entityId)).toEqual({ status: 'proposed' });
    expect(db.prepare('SELECT status FROM narrative_origin_lifecycle WHERE origin_id = ?').get('message-one')).toEqual({ status: 'deleted' });
  });

  test('restores the latest turn snapshot before invalidating a regenerated response', () => {
    db.prepare(`
      INSERT INTO entities VALUES ('selka', 'workspace-one', 'Characters', 'Selka', '[]', '', NULL, '{}', 'confirmed', 1, 1)
    `).run();
    db.prepare(`
      INSERT INTO roleplay_resource_definitions
        (workspace_id, definition_id, resource_key, name, description, color, minimum, maximum,
         initial_value, unit, applies_to_json, update_policy, position, enabled, updated_at)
      VALUES ('workspace-one', 'health', 'health', 'Health', '', '#ffffff', 0, 100, 100, '', '["Characters"]', 'automatic', 0, 1, 1)
    `).run();
    db.prepare(`INSERT INTO roleplay_resource_values VALUES ('workspace-one', 'health', 'entity', 'selka', 100, 100, 1, 1)`).run();
    db.prepare(`
      INSERT INTO narrative_state_jobs
        (workspace_id, origin_id, status, deep_analysis, input_tokens, output_tokens, created_at, updated_at)
      VALUES ('workspace-one', 'message-one', 'processing', 0, 0, 0, 1, 1)
    `).run();
    system.markOrigin('workspace-one', 'message-one', 'active');
    const manifests = new NarrativeContextManifestRepository(db);
    manifests.save({
      requestId: 'request-one', workspaceId: 'workspace-one', sequence: 1,
      subjectIds: ['selka'], targetIds: [], assessments: [], deepenedPairs: []
    });
    manifests.attachOrigin('workspace-one', 'request-one', 'message-one');
    system.captureTurnSnapshot('workspace-one', 'message-one');
    db.prepare("UPDATE roleplay_resource_values SET current_value = 35 WHERE workspace_id = 'workspace-one'").run();
    db.prepare("UPDATE narrative_state_jobs SET status = 'completed', updated_at = 2 WHERE origin_id = 'message-one'").run();

    expect(system.invalidateOrigin('workspace-one', 'message-one', 'deleted')).toEqual({ restored: true });
    expect(db.prepare('SELECT current_value AS value FROM roleplay_resource_values').get()).toEqual({ value: 100 });
    expect(manifests.getByOrigin('workspace-one', 'message-one')?.status).toBe('invalidated');
  });

  test('refuses to invalidate a middle turn before its later narrative turns', () => {
    for (const [originId, timestamp] of [['message-one', 1], ['message-two', 2]] as const) {
      db.prepare(`
        INSERT INTO narrative_state_jobs
          (workspace_id, origin_id, status, deep_analysis, input_tokens, output_tokens, created_at, updated_at)
        VALUES ('workspace-one', ?, 'completed', 0, 0, 0, ?, ?)
      `).run(originId, timestamp, timestamp);
      system.markOrigin('workspace-one', originId, 'active');
      system.captureTurnSnapshot('workspace-one', originId);
    }

    expect(() => system.invalidateOrigin('workspace-one', 'message-one', 'deleted'))
      .toThrow('later turns have been reverted');
    expect(db.prepare('SELECT status FROM narrative_origin_lifecycle WHERE origin_id = ?').get('message-one'))
      .toEqual({ status: 'active' });
  });

  describe('a place the story introduces', () => {
    beforeEach(() => {
      const insert = db.prepare(`INSERT INTO entities VALUES (?, 'workspace-one', 'Locations', ?, '[]', '', NULL, ?, 'confirmed', 1, 1)`);
      insert.run('norvania', 'Norvania', JSON.stringify({ size: 'region' }));
      insert.run('porto', 'Porto Velho', JSON.stringify({ size: 'area' }));
      insert.run('tavern', 'Crow Tavern', JSON.stringify({ size: 'place' }));
      const link = db.prepare(`INSERT INTO entity_links VALUES (?, 'workspace-one', ?, 'inside', ?, NULL, '{}', 1)`);
      link.run('l1', 'porto', 'norvania');
      link.run('l2', 'tavern', 'porto');
    });

    const place = (overrides: Record<string, unknown>) => entityProposal({
      referenceId: 'new:place', name: 'Back Room', type: 'Locations', ...overrides
    } as never);
    const insideOf = (entityId: string | null) => (db.prepare(`
      SELECT toId FROM entity_links WHERE fromId = ? AND relType = 'inside'
    `).get(entityId) as { toId: string } | undefined)?.toId;

    test('stays reviewable and is filed inside the scene when it is a spot', () => {
      const change = system.resolveOrPropose('workspace-one', 'message-one', place({ size: 'Spot' }), { sceneLocationId: 'tavern' });

      expect(change.status).toBe('pending');
      expect(change.proposal).toMatchObject({ size: 'spot', insideId: 'tavern' });
      const applied = system.resolveChange('workspace-one', change.id, 'approved');
      const data = JSON.parse(String((db.prepare('SELECT data FROM entities WHERE id = ?').get(applied.entityId) as { data: string }).data));
      expect(data.size).toBe('spot');
      expect(insideOf(applied.entityId)).toBe('tavern');
    });

    test('lands in the first container larger than itself, not inside the tavern', () => {
      const city = system.resolveOrPropose('workspace-one', 'message-one', place({ referenceId: 'new:city', name: 'Aurel', size: 'area' }), { sceneLocationId: 'tavern' });
      const inn = system.resolveOrPropose('workspace-one', 'message-one', place({ referenceId: 'new:inn', name: 'Gull Inn', size: 'place' }), { sceneLocationId: 'tavern' });

      expect(city.proposal.insideId).toBe('norvania');
      expect(inn.proposal.insideId).toBe('porto');
    });

    test('falls back to the scene location when the size is unknown, and ignores a container from the model', () => {
      const change = system.resolveOrPropose('workspace-one', 'message-one', place({ size: 'huge', insideId: 'norvania' }), { sceneLocationId: 'tavern' });

      expect(change.proposal.size).toBeUndefined();
      expect(change.proposal.insideId).toBe('tavern');
    });

    test('is created without a container when the suggested one is gone by approval', () => {
      const change = system.resolveOrPropose('workspace-one', 'message-one', place({ size: 'spot' }), { sceneLocationId: 'tavern' });
      db.prepare("DELETE FROM entities WHERE id = 'tavern'").run();

      const applied = system.resolveChange('workspace-one', change.id, 'approved');
      expect(applied.status).toBe('applied');
      expect(insideOf(applied.entityId)).toBeUndefined();
    });
  });

  function entityProposal(overrides: Partial<Parameters<NarrativeEntitySystem['resolveOrPropose']>[2]> = {}) {
    return {
      referenceId: 'new:actor',
      name: 'New Actor',
      type: 'Characters' as const,
      aliases: [],
      description: 'A new actor enters the scene.',
      excerpt: 'A new actor enters.',
      confidence: 0.98,
      decision: 'new' as const,
      identityEstablished: true,
      ...overrides
    };
  }
});
