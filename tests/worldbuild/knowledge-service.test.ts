import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import { createWorldbuildKnowledgeService } from '../../src/main/features/worldbuild/knowledge-service.js';
import { openTestDatabase } from '../sqlite-test-database';

describe('Worldbuild awareness Knowledge service', () => {
  let directory: string;
  let db: Database.Database;
  let service: ReturnType<typeof createWorldbuildKnowledgeService>;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'kallamo-knowledge-cards-'));
    db = openTestDatabase(join(directory, 'cards.db'));
    db.pragma('foreign_keys = ON');
    runDatabaseMigrations(db);
    db.exec(`
      CREATE TABLE entities (
        id TEXT PRIMARY KEY, workspaceId TEXT, type TEXT, canonicalName TEXT,
        data TEXT, status TEXT
      );
      CREATE TABLE entity_links (
        id TEXT PRIMARY KEY, workspaceId TEXT, fromId TEXT, relType TEXT,
        toId TEXT, label TEXT, metadata_json TEXT, createdAt INTEGER
      );
    `);
    db.prepare('INSERT INTO entities VALUES (?, ?, ?, ?, ?, ?)').run(
      'ostmark', 'workspace-one', 'Factions', 'Empire of Ostmark',
      JSON.stringify({ customFields: { symbol: 'Black sun', secret: 'Hidden vault' } }), 'active',
    );
    db.prepare('INSERT INTO entities VALUES (?, ?, ?, ?, ?, ?)').run(
      'corwin', 'workspace-one', 'Characters', 'Corwin', JSON.stringify({}), 'active',
    );
    db.prepare(`
      INSERT INTO worldbuild_field_definitions (
        workspace_id, field_id, type_id, field_key, label, value_type,
        options_json, constraints_json, default_value_json, has_default,
        required, position, ai_access, ai_guidance
      ) VALUES (?, ?, ?, ?, ?, 'short-text', NULL, NULL, NULL, 0, 0, ?, ?, NULL)
    `).run('workspace-one', 'symbol-field', 'Factions', 'symbol', 'Symbol', 0, 'read-write');
    db.prepare(`
      INSERT INTO worldbuild_field_definitions (
        workspace_id, field_id, type_id, field_key, label, value_type,
        options_json, constraints_json, default_value_json, has_default,
        required, position, ai_access, ai_guidance
      ) VALUES (?, ?, ?, ?, ?, 'short-text', NULL, NULL, NULL, 0, 0, ?, ?, NULL)
    `).run('workspace-one', 'secret-field', 'Factions', 'secret', 'Secret', 1, 'hidden');
    service = createWorldbuildKnowledgeService(db);
  });

  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test('creates one empty card while preserving multiple idempotent sources', () => {
    service.ensureAwareness({
      workspaceId: 'workspace-one', ownerId: 'corwin', targetId: 'ostmark',
      sourceType: 'manual', sourceId: 'manual-one',
    });
    service.ensureAwareness({
      workspaceId: 'workspace-one', ownerId: 'corwin', targetId: 'ostmark',
      sourceType: 'relationship', sourceId: 'relationship-one',
    });
    service.ensureAwareness({
      workspaceId: 'workspace-one', ownerId: 'corwin', targetId: 'ostmark',
      sourceType: 'relationship', sourceId: 'relationship-one',
    });

    const [card] = service.listCards('workspace-one', 'corwin');
    expect(card.knownFieldKeys).toEqual([]);
    expect(card.sources).toHaveLength(2);
    expect(db.prepare('SELECT subject_id, target_id, status FROM narrative_awareness_records').all())
      .toEqual([{ subject_id: 'corwin', target_id: 'ostmark', status: 'active' }]);
  });

  test('reading cards writes only the awareness a link is missing', () => {
    db.prepare('INSERT INTO entity_links VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
      'membership-one', 'workspace-one', 'corwin', 'member_of', 'ostmark', null, null, 1,
    );
    service.listCards('workspace-one', 'corwin');
    const stamps = () => db.prepare('SELECT owner_id, updated_at FROM worldbuild_knowledge_cards ORDER BY owner_id').all();
    const before = stamps();
    const events = db.prepare('SELECT COUNT(*) AS count FROM narrative_events').get();

    service.listCards('workspace-one', 'corwin');
    expect(stamps()).toEqual(before);
    expect(db.prepare('SELECT COUNT(*) AS count FROM narrative_events').get()).toEqual(events);

    db.prepare("DELETE FROM worldbuild_knowledge_sources WHERE source_id = 'membership-one'").run();
    const [card] = service.listCards('workspace-one', 'corwin');
    expect(card.sources.map((source: { sourceId: string }) => source.sourceId)).toEqual(['membership-one']);

    service.removeCard({ workspaceId: 'workspace-one', ownerId: 'corwin', targetId: 'ostmark' });
    expect(service.listCards('workspace-one', 'corwin')).toEqual([]);
  });

  test('marks only currently filled non-hidden fields as known', () => {
    service.ensureAwareness({
      workspaceId: 'workspace-one', ownerId: 'corwin', targetId: 'ostmark',
      sourceType: 'manual', sourceId: 'manual-one',
    });

    const card = service.markCurrentFieldsKnown({
      workspaceId: 'workspace-one', ownerId: 'corwin', targetId: 'ostmark',
    });

    expect(card.knownFieldKeys).toEqual(['customFields.symbol']);
  });

  test('includes a filled Location description among current known fields', () => {
    db.prepare('INSERT INTO entities VALUES (?, ?, ?, ?, ?, ?)').run(
      'thornhall', 'workspace-one', 'Locations', 'Thornhall',
      JSON.stringify({ locationType: 'City', description: 'A walled city built around an ancient well.' }), 'active',
    );
    service.ensureAwareness({
      workspaceId: 'workspace-one', ownerId: 'corwin', targetId: 'thornhall',
      sourceType: 'manual', sourceId: 'manual-location',
    });

    const card = service.markCurrentFieldsKnown({
      workspaceId: 'workspace-one', ownerId: 'corwin', targetId: 'thornhall',
    });

    expect(card.knownFieldKeys).toEqual(['description', 'locationType']);
  });

  test('stores individual known relationships as snapshots and grants counterpart Awareness', () => {
    db.prepare('INSERT INTO entities VALUES (?, ?, ?, ?, ?, ?)').run(
      'anselm', 'workspace-one', 'Characters', 'Anselm', JSON.stringify({}), 'active',
    );
    db.prepare('INSERT INTO entity_links VALUES (?, ?, ?, ?, ?, NULL, ?, ?)').run(
      'leader-one', 'workspace-one', 'ostmark', 'led_by', 'corwin', '{}', Date.now(),
    );
    service.ensureAwareness({
      workspaceId: 'workspace-one', ownerId: 'anselm', targetId: 'ostmark',
      sourceType: 'manual', sourceId: 'manual-faction',
    });

    const card = service.setKnownRelationships({
      workspaceId: 'workspace-one', ownerId: 'anselm', targetId: 'ostmark',
      relationshipIds: ['leader-one'],
    });

    expect(card.knownRelationships).toMatchObject([{
      relationshipId: 'leader-one',
      fromId: 'ostmark',
      fromName: 'Empire of Ostmark',
      relationType: 'led_by',
      toId: 'corwin',
      toName: 'Corwin',
    }]);
    expect(service.listCards('workspace-one', 'anselm').map(item => item.targetId))
      .toEqual(['corwin', 'ostmark']);

    db.prepare('UPDATE entities SET canonicalName = ? WHERE id = ?').run('The Hidden King', 'corwin');
    db.prepare('DELETE FROM entity_links WHERE id = ?').run('leader-one');
    const persisted = service.getCard('workspace-one', 'anselm', 'ostmark');
    expect(persisted.knownRelationships[0].toName).toBe('Corwin');
    expect(persisted.availableRelationships).toEqual([]);
  });

  test('rejects relationships that do not involve the Knowledge card target', () => {
    db.prepare('INSERT INTO entities VALUES (?, ?, ?, ?, ?, ?)').run(
      'anselm', 'workspace-one', 'Characters', 'Anselm', JSON.stringify({}), 'active',
    );
    db.prepare('INSERT INTO entity_links VALUES (?, ?, ?, ?, ?, NULL, ?, ?)').run(
      'unrelated-one', 'workspace-one', 'anselm', 'related_to', 'corwin', '{}', Date.now(),
    );
    service.ensureAwareness({
      workspaceId: 'workspace-one', ownerId: 'anselm', targetId: 'ostmark',
      sourceType: 'manual', sourceId: 'manual-faction',
    });

    expect(() => service.setKnownRelationships({
      workspaceId: 'workspace-one', ownerId: 'anselm', targetId: 'ostmark',
      relationshipIds: ['unrelated-one'],
    })).toThrow('unavailable');
  });

  test('uses exclusions so structural reconciliation does not recreate a removed card', () => {
    db.prepare('INSERT INTO entity_links VALUES (?, ?, ?, ?, ?, NULL, ?, ?)').run(
      'relationship-one', 'workspace-one', 'corwin', 'related_to', 'ostmark', '{}', Date.now(),
    );
    expect(service.listCards('workspace-one', 'corwin')).toHaveLength(1);
    service.removeCard({ workspaceId: 'workspace-one', ownerId: 'corwin', targetId: 'ostmark' });
    expect(service.listCards('workspace-one', 'corwin')).toEqual([]);
    expect(db.prepare('SELECT status FROM narrative_awareness_records ORDER BY rowid').all())
      .toEqual([{ status: 'active' }, { status: 'revoked' }]);
  });

  test('offers only the subject own side of a related_to pair', () => {
    db.prepare('INSERT INTO entities VALUES (?, ?, ?, ?, ?, ?)').run(
      'anselm', 'workspace-one', 'Characters', 'Anselm', JSON.stringify({}), 'active',
    );
    db.prepare('INSERT INTO entity_links VALUES (?, ?, ?, ?, ?, NULL, ?, ?)').run(
      'corwin-view', 'workspace-one', 'corwin', 'related_to', 'anselm', '{}', 1,
    );
    db.prepare('INSERT INTO entity_links VALUES (?, ?, ?, ?, ?, NULL, ?, ?)').run(
      'anselm-view', 'workspace-one', 'anselm', 'related_to', 'corwin', '{}', 2,
    );
    service.ensureAwareness({
      workspaceId: 'workspace-one', ownerId: 'ostmark', targetId: 'corwin',
      sourceType: 'manual', sourceId: 'manual-one',
    });

    const card = service.getCard('workspace-one', 'ostmark', 'corwin');

    expect(card.availableRelationships.map((item: { relationshipId: string }) => item.relationshipId))
      .toEqual(['corwin-view']);
    expect(() => service.setKnownRelationships({
      workspaceId: 'workspace-one', ownerId: 'ostmark', targetId: 'corwin',
      relationshipIds: ['anselm-view'],
    })).toThrow('unavailable');
  });

  test('prunes a reciprocal related_to marked before cards held one perspective', () => {
    db.prepare('INSERT INTO entities VALUES (?, ?, ?, ?, ?, ?)').run(
      'anselm', 'workspace-one', 'Characters', 'Anselm', JSON.stringify({}), 'active',
    );
    service.ensureAwareness({
      workspaceId: 'workspace-one', ownerId: 'ostmark', targetId: 'corwin',
      sourceType: 'manual', sourceId: 'manual-one',
    });
    const card = service.getCard('workspace-one', 'ostmark', 'corwin');
    db.prepare(`
      INSERT INTO worldbuild_known_relationships (
        workspace_id, card_id, relationship_id, from_id, from_name,
        relation_type, relation_label, to_id, to_name, metadata_json,
        source_type, source_id, audience_type, created_at
      ) VALUES (?, ?, ?, 'anselm', 'Anselm', 'related_to', NULL, 'corwin', 'Corwin', NULL, 'manual', 'legacy', 'inherit', 1)
    `).run('workspace-one', card.cardId, 'legacy-mirror');

    service.reconcileWorkspace('workspace-one');

    expect(db.prepare('SELECT COUNT(*) AS count FROM worldbuild_known_relationships').get())
      .toEqual({ count: 0 });
  });

  test('keeps a faction audience to people the roster still holds', () => {
    db.prepare('INSERT INTO entities VALUES (?, ?, ?, ?, ?, ?)').run(
      'anselm', 'workspace-one', 'Characters', 'Anselm', JSON.stringify({}), 'active',
    );
    db.prepare('INSERT INTO entity_links VALUES (?, ?, ?, ?, ?, NULL, ?, ?)').run(
      'membership-one', 'workspace-one', 'corwin', 'member_of', 'ostmark', '{}', Date.now(),
    );
    service.ensureAwareness({
      workspaceId: 'workspace-one', ownerId: 'ostmark', targetId: 'anselm',
      sourceType: 'manual', sourceId: 'manual-one',
    });

    const chosen = service.setAudience({
      workspaceId: 'workspace-one', ownerId: 'ostmark', targetId: 'anselm',
      audienceType: 'selected-members', memberIds: ['corwin', 'anselm'],
    });
    expect(chosen.selectedMemberIds).toEqual(['corwin']);

    const shared = service.setAudience({
      workspaceId: 'workspace-one', ownerId: 'ostmark', targetId: 'anselm',
      audienceType: 'all-members',
    });
    expect(shared.audienceType).toBe('all-members');
    expect(shared.selectedMemberIds).toEqual(['corwin']);
  });

  test('creates reciprocal awareness between a faction and each member', () => {
    db.prepare('INSERT INTO entity_links VALUES (?, ?, ?, ?, ?, NULL, ?, ?)').run(
      'membership-one', 'workspace-one', 'corwin', 'member_of', 'ostmark', '{}', Date.now(),
    );

    expect(service.listCards('workspace-one', 'corwin').map(card => card.targetId)).toEqual(['ostmark']);
    const factionCards = service.listCards('workspace-one', 'ostmark');
    expect(factionCards.map(card => card.targetId)).toEqual(['corwin']);
    expect(factionCards[0]?.audienceType).toBe('all-members');
  });
});
