import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import { createWorldbuildDataService } from '../../src/main/features/worldbuild/worldbuild-data.js';
import { openTestDatabase } from '../sqlite-test-database';

describe('Worldbuild runtime data adapter', () => {
  let directory: string;
  let db: Database.Database;
  let service: ReturnType<typeof createWorldbuildDataService>;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'worldbuild-data-'));
    db = openTestDatabase(join(directory, 'worldbuild.db'));
    db.pragma('foreign_keys = ON');
    runDatabaseMigrations(db);
    service = createWorldbuildDataService(db);
  });

  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test('stores and updates reusable typed field definitions', () => {
    const field = service.saveFieldDefinition({
      projectId: 'workspace-one',
      typeId: 'Items',
      label: 'Material',
      valueType: 'single-choice',
      options: ['Iron', 'Silver'],
      required: false,
      position: 0,
      aiAccess: 'read-write'
    });

    expect(service.listFieldDefinitions('workspace-one', 'Items')).toEqual([field]);
    const updated = service.saveFieldDefinition({ ...field, label: 'Primary material' });
    expect(service.listFieldDefinitions('workspace-one', 'Items')).toEqual([updated]);
  });

  test('stores visual entity templates without changing canonical type ids', () => {
    const template = service.saveEntityTemplate({
      workspaceId: 'workspace-one', typeId: 'Characters', displayName: 'Cast',
      layout: { sections: [{ id: 'identity', label: 'Profile', kind: 'native', hidden: false }] }
    });

    expect(template.typeId).toBe('Characters');
    expect(service.listEntityTemplates('workspace-one')).toEqual([template]);
    expect(service.listEntityTemplates('workspace-two')).toEqual([]);
  });

  test('removes deleted field values from every entity in its category', () => {
    db.exec(`
      CREATE TABLE entities (
        id TEXT PRIMARY KEY, workspaceId TEXT, type TEXT NOT NULL,
        data TEXT, last_modified INTEGER DEFAULT 0
      );
    `);
    const field = service.saveFieldDefinition({
      projectId: 'workspace-one', typeId: 'Items', label: 'Material',
      valueType: 'short-text', position: 0, aiAccess: 'read-write'
    });
    db.prepare('INSERT INTO entities (id, workspaceId, type, data) VALUES (?, ?, ?, ?)')
      .run('item-one', 'workspace-one', 'Items', JSON.stringify({ customFields: { material: 'Silver' }, rarity: 'Rare' }));

    expect(service.deleteFieldDefinition('workspace-one', field.id)).toBe(true);
    const row = db.prepare('SELECT data FROM entities WHERE id = ?').get('item-one') as { data: string };
    expect(JSON.parse(row.data)).toEqual({ rarity: 'Rare' });
  });

  test('requires confirmation to change a field type and clears incompatible values atomically', () => {
    db.exec(`
      CREATE TABLE entities (
        id TEXT PRIMARY KEY, workspaceId TEXT, type TEXT NOT NULL,
        data TEXT, last_modified INTEGER DEFAULT 0
      );
    `);
    const field = service.saveFieldDefinition({
      projectId: 'workspace-one', typeId: 'Items', label: 'Rarity',
      valueType: 'short-text', position: 0, aiAccess: 'read-write',
      aiGuidance: 'Use only the established world-level rarity.'
    });
    db.prepare('INSERT INTO entities (id, workspaceId, type, data) VALUES (?, ?, ?, ?)')
      .run('item-one', 'workspace-one', 'Items', JSON.stringify({ customFields: { rarity: 'Rare' }, description: 'A blade.' }));

    expect(() => service.saveFieldDefinition({ ...field, valueType: 'number' }))
      .toThrow('requires clearing its existing values');
    const updated = service.saveFieldDefinition({ ...field, valueType: 'number', clearValuesOnTypeChange: true });

    expect(updated).toEqual(expect.objectContaining({ valueType: 'number', aiGuidance: 'Use only the established world-level rarity.' }));
    const row = db.prepare('SELECT data FROM entities WHERE id = ?').get('item-one') as { data: string };
    expect(JSON.parse(row.data)).toEqual({ description: 'A blade.' });
  });

  test('adds, revises, and removes a Known entry through narrative revisions', () => {
    const added = service.saveSubjectEntry({
      workspaceId: 'workspace-one', subjectId: 'mara', kind: 'knowledge',
      entry: { aboutId: 'northern-gate', statement: 'The gate is sealed.', confidence: 0.8, acquisition: 'witness', accessibility: 'available' }
    });
    expect(added.known).toHaveLength(1);

    const revised = service.saveSubjectEntry({
      workspaceId: 'workspace-one', subjectId: 'mara', kind: 'knowledge',
      existingId: added.known[0].id,
      entry: { aboutId: 'northern-gate', statement: 'The gate has reopened.', confidence: 1, acquisition: 'witness', accessibility: 'available' }
    });
    expect(revised.known).toEqual([expect.objectContaining({ statement: 'The gate has reopened.' })]);

    const removed = service.deleteSubjectEntry({
      workspaceId: 'workspace-one', subjectId: 'mara', kind: 'knowledge', entryId: revised.known[0].id
    });
    expect(removed.known).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM kanora_narrative_records WHERE record_type = 'knowledge'").get())
      .toEqual({ count: 3 });
  });

  test('replaces and forgets memories without erasing their history', () => {
    const added = service.saveSubjectEntry({
      workspaceId: 'workspace-one', subjectId: 'vharos', kind: 'memory',
      entry: { summary: 'Vharos saw the northern gate close.', accessibility: 'available' }
    });
    const revised = service.saveSubjectEntry({
      workspaceId: 'workspace-one', subjectId: 'vharos', kind: 'memory',
      existingId: added.memories[0].id,
      entry: { summary: 'Vharos remembers the sound of the gate closing.', accessibility: 'available' }
    });

    expect(revised.memories).toEqual([
      expect.objectContaining({ summary: 'Vharos remembers the sound of the gate closing.' })
    ]);
    const removed = service.deleteSubjectEntry({
      workspaceId: 'workspace-one', subjectId: 'vharos', kind: 'memory', entryId: revised.memories[0].id
    });
    expect(removed.memories).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM kanora_narrative_records WHERE record_type = 'memory'").get())
      .toEqual({ count: 3 });
  });

  test('marks entries owned by an Event occurrence and keeps them read-only here', () => {
    const added = service.saveSubjectEntry({
      workspaceId: 'workspace-one', subjectId: 'vharos', kind: 'memory',
      entry: { summary: 'Vharos rode in the tournament.', accessibility: 'available' }
    });
    expect(added.memories).toEqual([
      expect.objectContaining({ managed: false, origin: { kind: 'authored' } })
    ]);

    // Adopt the entry's own narrative event as an occurrence, which is the shape the
    // occurrence writer produces: one narrative event carrying the recorded memories.
    const narrativeEventId = (db.prepare(
      "SELECT source_event_id AS id FROM kanora_narrative_records WHERE record_type = 'memory'"
    ).get() as { id: string }).id;
    db.prepare(`
      INSERT INTO worldbuild_event_occurrences (
        workspace_id, occurrence_id, event_entity_id, narrative_event_id,
        title, summary, source, archived, created_at, updated_at
      ) VALUES (?, 'occurrence-one', 'silver-tournament', ?, 'The Silver Tournament', '', 'user', 0, 1, 1)
    `).run('workspace-one', narrativeEventId);

    const projection = service.getSubjectKnowledge('workspace-one', 'vharos');
    expect(projection.memories).toEqual([
      expect.objectContaining({
        managed: true,
        origin: {
          kind: 'occurrence',
          occurrenceId: 'occurrence-one',
          eventEntityId: 'silver-tournament',
          title: 'The Silver Tournament',
        },
      })
    ]);

    const entryId = projection.memories[0].id;
    expect(() => service.saveSubjectEntry({
      workspaceId: 'workspace-one', subjectId: 'vharos', kind: 'memory', existingId: entryId,
      entry: { summary: 'Rewritten by hand.', accessibility: 'available' }
    })).toThrow(/Event occurrence/);
    expect(() => service.deleteSubjectEntry({
      workspaceId: 'workspace-one', subjectId: 'vharos', kind: 'memory', entryId
    })).toThrow(/Event occurrence/);
    expect(service.getSubjectKnowledge('workspace-one', 'vharos').memories).toEqual([
      expect.objectContaining({ summary: 'Vharos rode in the tournament.' })
    ]);
  });

  test('rejects new manual observations without deleting legacy support', () => {
    expect(() => service.saveSubjectEntry({
      workspaceId: 'workspace-one', subjectId: 'mara', kind: 'observation',
      entry: { summary: 'Mara witnessed the northern gate collapse.', confidence: 0.9, method: 'witness', accessibility: 'available' }
    })).toThrow('Unsupported Knowledge entry type.');
  });

  test('keeps Faction knowledge separate from member knowledge', () => {
    service.saveSubjectEntry({
      workspaceId: 'workspace-one', subjectId: 'mara', kind: 'belief',
      entry: { aboutId: 'vault', statement: 'The vault is empty.', confidence: 0.7 }
    });
    service.saveSubjectEntry({
      workspaceId: 'workspace-one', subjectId: 'ashen-circle', kind: 'belief',
      entry: { aboutId: 'vault', statement: 'The vault contains the crown.', confidence: 0.9 }
    });

    const faction = service.getSubjectKnowledge('workspace-one', 'ashen-circle');
    expect(faction.beliefs).toEqual([
      expect.objectContaining({ subjectId: 'ashen-circle', statement: 'The vault contains the crown.' })
    ]);
  });

  test('keeps informants on reported Knowledge and grants awareness of the teller', () => {
    const reported = service.saveSubjectEntry({
      workspaceId: 'workspace-one', subjectId: 'elias', kind: 'knowledge',
      entry: {
        aboutId: 'vault', statement: 'The vault opens at dusk.', confidence: 0.75,
        acquisition: 'reported', informantIds: ['mara', 'elias'],
      }
    });

    expect(reported.known).toEqual([
      expect.objectContaining({ acquisition: 'reported', informantIds: ['mara'] })
    ]);
    const awareOf = service.getSubjectKnowledge('workspace-one', 'elias')
      .cards.map((card: { targetId: string }) => card.targetId);
    expect([...awareOf].sort()).toEqual(['mara', 'vault']);
  });

  test('drops informants when Knowledge was acquired first-hand', () => {
    const observed = service.saveSubjectEntry({
      workspaceId: 'workspace-one', subjectId: 'elias', kind: 'knowledge',
      entry: {
        aboutId: 'vault', statement: 'The vault opens at dusk.', confidence: 0.95,
        acquisition: 'witness', informantIds: ['mara'],
      }
    });

    expect(observed.known).toEqual([
      expect.objectContaining({ acquisition: 'witness', informantIds: [] })
    ]);
  });

  test('keeps the Knowledge projection limited to epistemic records', () => {
    const projection = service.getSubjectKnowledge('workspace-one', 'elias');
    expect(projection).toEqual(expect.objectContaining({
      observations: [],
      known: [],
      beliefs: [],
      memories: [],
    }));
    expect(projection).not.toHaveProperty('relationships');
  });

  test('adds, revises, and retracts workspace Facts without assigning epistemic ownership', () => {
    const added = service.saveWorldFact({
      workspaceId: 'workspace-one',
      entry: {
        title: 'Northern gate status',
        statement: 'The northern gate collapsed during the siege.',
        relatedEntityIds: ['northern-gate', 'mara'],
      },
    });
    expect(added).toEqual([
      expect.objectContaining({
        title: 'Northern gate status',
        statement: 'The northern gate collapsed during the siege.',
        relatedEntityIds: ['northern-gate', 'mara'],
      }),
    ]);

    const revised = service.saveWorldFact({
      workspaceId: 'workspace-one',
      existingId: added[0].id,
      entry: {
        title: 'Northern gate status',
        statement: 'The northern gate partially collapsed during the siege.',
        relatedEntityIds: ['northern-gate', 'mara'],
      },
    });
    expect(revised).toEqual([
      expect.objectContaining({ statement: 'The northern gate partially collapsed during the siege.' }),
    ]);

    const removed = service.deleteWorldFact({
      workspaceId: 'workspace-one',
      factId: revised[0].id,
    });
    expect(removed).toEqual([]);
    expect(db.prepare("SELECT DISTINCT subject_id FROM kanora_narrative_records WHERE record_type = 'fact'").all())
      .toEqual([{ subject_id: null }]);
  });

  test('keeps stable Fact references on knowledge and beliefs', () => {
    const [fact] = service.saveWorldFact({
      workspaceId: 'workspace-one',
      entry: {
        title: 'Northern gate status',
        statement: 'The northern gate collapsed during the siege.',
        relatedEntityIds: ['northern-gate'],
      },
    });

    const knowledge = service.saveSubjectEntry({
      workspaceId: 'workspace-one', subjectId: 'mara', kind: 'knowledge',
      entry: { aboutId: 'northern-gate', statement: 'The gate collapsed.', factIds: [fact.id], confidence: 1, acquisition: 'witness', accessibility: 'available' },
    });
    const belief = service.saveSubjectEntry({
      workspaceId: 'workspace-one', subjectId: 'mara', kind: 'belief',
      entry: { aboutId: 'northern-gate', statement: 'The collapse was deliberate.', factIds: [fact.id], confidence: 0.7 },
    });

    expect(knowledge.known[0].factIds).toEqual([fact.id]);
    expect(belief.beliefs[0].factIds).toEqual([fact.id]);

    const [revisedFact] = service.saveWorldFact({
      workspaceId: 'workspace-one',
      existingId: fact.id,
      entry: {
        title: 'Northern gate status',
        statement: 'The northern gate partially collapsed during the siege.',
        relatedEntityIds: ['northern-gate', 'mara'],
      },
    });
    expect(revisedFact.id).toBe(fact.id);
  });
});
