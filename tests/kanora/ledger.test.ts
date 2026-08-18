import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import type { NarrativeProposal } from '../../src/kanora/contracts';
import {
  NarrativeEventLedgerRepository,
  NarrativeEventLedgerValidationError
} from '../../src/kanora/ledger';
import { possessionTransferScenario, secretRevelationScenario } from '../../src/kanora/scenarios';

describe('Narrative Event Ledger SQLite repository', () => {
  let directory: string;
  let db: Database.Database | undefined;
  let repository: NarrativeEventLedgerRepository;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'kanora-ledger-'));
    db = new Database(join(directory, 'ledger.db'));
    db.pragma('foreign_keys = ON');
    runDatabaseMigrations(db);
    repository = new NarrativeEventLedgerRepository(db);
  });

  afterEach(() => {
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test('writes and reads a complete Contract v1 proposal', () => {
    const stored = repository.save(possessionTransferScenario);

    expect(stored).toEqual({
      proposal: possessionTransferScenario,
      status: 'proposed',
      version: 1
    });
    expect(repository.get(possessionTransferScenario.projectId, possessionTransferScenario.changeSet.event.id)).toEqual(stored);
  });

  test('reconstructs event evidence with its origin and excerpt', () => {
    repository.save(secretRevelationScenario);

    const stored = repository.get(secretRevelationScenario.projectId, secretRevelationScenario.changeSet.event.id);

    expect(stored?.proposal.changeSet.event.evidenceIds).toEqual(secretRevelationScenario.changeSet.event.evidenceIds);
    expect(stored?.proposal.evidence).toEqual(secretRevelationScenario.evidence);
  });

  test('isolates identical event identifiers between workspaces', () => {
    const otherWorkspace = structuredClone(possessionTransferScenario);
    otherWorkspace.projectId = 'project-other';

    repository.save(possessionTransferScenario);
    repository.save(otherWorkspace);

    expect(repository.list(possessionTransferScenario.projectId)).toHaveLength(1);
    expect(repository.list(otherWorkspace.projectId)).toHaveLength(1);
    expect(repository.get('project-missing', possessionTransferScenario.changeSet.event.id)).toBeUndefined();
  });

  test('lists events by narrative order', () => {
    const later = structuredClone(possessionTransferScenario);
    later.changeSet.event.position.sequence = 20;
    const earlier = structuredClone(secretRevelationScenario);
    earlier.projectId = later.projectId;
    earlier.changeSet.event.position.sequence = 10;

    repository.save(later);
    repository.save(earlier);

    expect(repository.list(later.projectId).map(record => record.proposal.changeSet.event.id)).toEqual([
      earlier.changeSet.event.id,
      later.changeSet.event.id
    ]);
  });

  test('persists provenance, explicit versions, and approval decisions', () => {
    const stored = repository.save(possessionTransferScenario, { version: 4 });
    const approved = repository.setStatus(
      possessionTransferScenario.projectId,
      possessionTransferScenario.changeSet.event.id,
      'approved',
      '2026-07-18T15:00:00.000Z'
    );

    expect(stored.proposal.provenance).toEqual(possessionTransferScenario.provenance);
    expect(approved).toMatchObject({
      status: 'approved',
      version: 5,
      decidedAt: '2026-07-18T15:00:00.000Z'
    });
    expect(approved?.proposal.provenance).toEqual(possessionTransferScenario.provenance);
  });

  test('persists rejected decisions without applying narrative operations', () => {
    const stored = repository.save(secretRevelationScenario, {
      status: 'rejected',
      version: 2,
      decidedAt: '2026-07-18T16:00:00.000Z'
    });

    expect(stored.status).toBe('rejected');
    expect(stored.proposal.changeSet.operations).toEqual(secretRevelationScenario.changeSet.operations);
    expect(db!.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'kanora_narrative_event%'").all())
      .toHaveLength(3);
  });

  test('rejects invalid Contract v1 proposals before writing', () => {
    const invalid = structuredClone(possessionTransferScenario) as NarrativeProposal;
    invalid.changeSet.event.description = '';

    expect(() => repository.save(invalid)).toThrow(NarrativeEventLedgerValidationError);
    expect(db!.prepare('SELECT COUNT(*) AS count FROM kanora_narrative_events').get()).toEqual({ count: 0 });
  });

  test('rolls back the complete write when a child row fails', () => {
    const duplicateEvidence = structuredClone(possessionTransferScenario);
    duplicateEvidence.evidence.push(structuredClone(duplicateEvidence.evidence[0]));

    expect(() => repository.save(duplicateEvidence)).toThrow();
    expect(db!.prepare('SELECT COUNT(*) AS count FROM kanora_narrative_events').get()).toEqual({ count: 0 });
    expect(db!.prepare('SELECT COUNT(*) AS count FROM kanora_narrative_event_participants').get()).toEqual({ count: 0 });
    expect(db!.prepare('SELECT COUNT(*) AS count FROM kanora_narrative_event_evidence').get()).toEqual({ count: 0 });
  });

  test('migrates an existing database without changing its data', () => {
    db!.close();
    const existingPath = join(directory, 'existing.db');
    db = new Database(existingPath);
    db.exec('CREATE TABLE existing_records (id TEXT PRIMARY KEY, value TEXT NOT NULL)');
    db.exec('CREATE TABLE entity_links (id TEXT PRIMARY KEY, label TEXT)');
    db.prepare('INSERT INTO existing_records (id, value) VALUES (?, ?)').run('legacy', 'preserved');

    runDatabaseMigrations(db);
    runDatabaseMigrations(db);

    expect(db.prepare('SELECT * FROM existing_records').get()).toEqual({ id: 'legacy', value: 'preserved' });
    expect(db.prepare('SELECT id FROM schema_migrations ORDER BY rowid').all()).toEqual([
      { id: 'kanora_narrative_event_ledger_v1' },
      { id: 'kanora_transactional_change_sets_v1' },
      { id: 'kanora_scenes_and_individual_knowledge_v1' },
      { id: 'kanora_explicit_knowledge_accessibility_draft_v1' },
      { id: 'kanora_beliefs_and_dynamic_relationships_v1' },
      { id: 'worldbuild_custom_field_definitions_v1' },
      { id: 'worldbuild_rich_entity_links_v1' },
      { id: 'worldbuild_entity_templates_v1' },
      { id: 'worldbuild_field_ai_guidance_v1' },
      { id: 'kanora_awareness_temporal_records_v1' },
      { id: 'kallamo_workspace_experience_mode_v1' },
      { id: 'kallamo_roleplay_system_v1' },
      { id: 'kallamo_roleplay_scene_objects_v1' },
      { id: 'kanora_narrative_state_runtime_v1' },
      { id: 'kallamo_item_presence_v1' },
      { id: 'kallamo_narrative_entity_identity_v1' },
      { id: 'remove_legacy_dynamic_relationships_v1' },
      { id: 'entity_update_evidence_lifecycle_v1' },
      { id: 'worldbuild_awareness_knowledge_cards_v1' },
      { id: 'worldbuild_known_relationships_v1' },
      { id: 'kanora_operation_review_v1' },
      { id: 'kallamo_roleplay_quick_panel_v1' },
      { id: 'kanora_narrative_context_manifest_v1' },
      { id: 'kallamo_world_calendar_and_roleplay_time_v1' },
      { id: 'kallamo_worldbuild_event_occurrences_v1' }
    ]);
    expect(db.prepare('PRAGMA table_info(entity_links)').all()).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'metadata_json', type: 'TEXT' })
    ]));
    repository = new NarrativeEventLedgerRepository(db);
    expect(repository.save(possessionTransferScenario).proposal).toEqual(possessionTransferScenario);
  });

  test('upgrades draft knowledge records with normalized subjects and explicit accessibility', () => {
    db!.close();
    const draftPath = join(directory, 'draft-knowledge.db');
    db = new Database(draftPath);
    db.exec(`
      CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL);
      INSERT INTO schema_migrations (id, applied_at) VALUES
        ('kanora_narrative_event_ledger_v1', '2026-07-18T00:00:00.000Z'),
        ('kanora_transactional_change_sets_v1', '2026-07-18T00:00:00.000Z'),
        ('kanora_scenes_and_individual_knowledge_v1', '2026-07-18T00:00:00.000Z');
      CREATE TABLE kanora_narrative_records (
        workspace_id TEXT NOT NULL,
        record_type TEXT NOT NULL,
        record_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        applied_at TEXT NOT NULL
      );
    `);
    const draftKnowledge = {
      id: 'knowledge-draft',
      subjectId: 'elias',
      proposition: { subjectId: 'gate', predicate: 'open', object: true },
      sourceEventId: 'event-draft',
      acquisition: 'witness',
      confidence: 0.8,
      status: 'active'
    };
    db.prepare(`
      INSERT INTO kanora_narrative_records
        (workspace_id, record_type, record_id, payload_json, applied_at)
      VALUES (?, 'knowledge', ?, ?, ?)
    `).run('project-example', draftKnowledge.id, JSON.stringify(draftKnowledge), '2026-07-18T00:00:00.000Z');

    runDatabaseMigrations(db);

    const migrated = db.prepare(`
      SELECT subject_id, json_extract(payload_json, '$.accessibility') AS accessibility
      FROM kanora_narrative_records WHERE record_id = ?
    `).get(draftKnowledge.id);
    expect(migrated).toEqual({ subject_id: 'elias', accessibility: 'available' });
  });
});
