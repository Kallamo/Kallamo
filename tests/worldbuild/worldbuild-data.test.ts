import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import { createWorldbuildDataService } from '../../src/main/features/worldbuild/worldbuild-data.js';
import { NarrativeStateSystem } from '../../src/main/features/narrative/narrative-state';
import { RoleplaySkills } from '../../src/main/features/narrative/roleplay-skills';
import { openTestDatabase } from '../sqlite-test-database';
import { loadCurrentNarrativeRecords } from '../../src/main/features/narrative/narrative-record-projection';

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

  test('a proposed relationship is reviewed against what it says now, and AI skill changes count', () => {
    db.exec(`
      CREATE TABLE entities (
        id TEXT PRIMARY KEY, workspaceId TEXT, type TEXT NOT NULL, canonicalName TEXT NOT NULL,
        data TEXT, status TEXT NOT NULL DEFAULT 'confirmed', last_modified INTEGER DEFAULT 0
      );
      CREATE TABLE entity_links (
        id TEXT PRIMARY KEY, workspaceId TEXT, fromId TEXT, relType TEXT,
        toId TEXT, label TEXT, metadata_json TEXT, createdAt INTEGER
      );
    `);
    const insert = db.prepare('INSERT INTO entities (id, workspaceId, type, canonicalName, data) VALUES (?, ?, ?, ?, ?)');
    insert.run('brann', 'workspace-one', 'Characters', 'Brann', '{}');
    insert.run('tess', 'workspace-one', 'Characters', 'Tess', '{}');
    db.prepare(`INSERT INTO entity_links VALUES ('link', 'workspace-one', 'brann', 'related_to', 'tess', 'Mentor', '{"value":60}', 1)`).run();
    new NarrativeStateSystem(db).createEvent({
      workspaceId: 'workspace-one', originId: 'entity-update:brann', interpreterId: 'system-model',
      originType: 'worldbuild-update', forceReview: true, allowedEntityIds: new Set(['brann', 'tess']),
      event: {
        type: 'custom', description: 'Worldbuild update suggestions for Brann.', excerpt: 'Brann defends Tess.',
        participantIds: ['brann', 'tess'], confidence: 0.85,
        operations: [{ type: 'relationship', sourceEntityId: 'brann', targetEntityId: 'tess', dimension: 'overall', title: 'Mentor', value: 80, description: 'He defends her.' }],
      },
    });
    const relationship = service.getSubjectReview('workspace-one', 'brann').proposals[0].operations
      .find((operation: { kind: string }) => operation.kind === 'relationship');
    expect(relationship).toMatchObject({ title: 'Mentor', value: 80, current: { title: 'Mentor', value: 60 } });

    const skills = new RoleplaySkills(db);
    skills.saveSettings('workspace-one', { enabled: true, config: { policy: 'review' } });
    skills.setMembers('workspace-one', [{ targetType: 'entity', targetId: 'brann' }]);
    skills.saveSkill('workspace-one', { name: 'Smithing' });
    expect(skills.proposeChange({ id: 'skill-change', workspaceId: 'workspace-one', entityId: 'brann', kind: 'assign', skillKey: 'smithing', source: 'ai' })?.status).toBe('pending');
    expect(service.listReviewCounts('workspace-one').brann.entityUpdates).toBe(1);
    const pending = service.listPendingReviewIds('workspace-one', ['brann']);
    expect(pending.skillChangeIds).toEqual(['skill-change']);
    expect(pending.narrativeEventIds).toHaveLength(1);
    expect(service.listPendingReviewIds('workspace-one', ['tess'])).toEqual({ narrativeEventIds: [], skillChangeIds: [] });
    new NarrativeStateSystem(db).resolveEvent('workspace-one', pending.narrativeEventIds[0], 'rejected');
    expect(service.listPendingReviewIds('workspace-one', ['brann']).narrativeEventIds).toEqual([]);
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

  test('a choice option keeps its id through a rename, and any label gets one', () => {
    const field = service.saveFieldDefinition({
      projectId: 'workspace-one', typeId: 'Items', label: '희귀도',
      valueType: 'single-choice', options: ['전설', 'Legendary', 'Legendary'], position: 0, aiAccess: 'read-write'
    });
    type Option = { id: string; label: string };
    const optionsOf = (definition: unknown) => (definition as { options: Option[] }).options;
    const options = optionsOf(field);
    expect(field.key).toMatch(/^field-/);
    expect(options.map(option => option.label)).toEqual(['전설', 'Legendary', 'Legendary']);
    expect(new Set(options.map(option => option.id)).size).toBe(3);
    expect(options.every(option => option.id.startsWith('opt-'))).toBe(true);

    const renamed = service.saveFieldDefinition({ ...field, options: [{ ...options[1], label: 'Mythic' }, options[0]] });
    expect(renamed.key).toBe(field.key);
    expect(optionsOf(renamed)).toEqual([{ id: options[1].id, label: 'Mythic' }, options[0]]);
  });

  test('keeps the option ids an older build derived from the label', () => {
    const field = service.saveFieldDefinition({
      projectId: 'workspace-one', typeId: 'Items', label: 'Material',
      valueType: 'single-choice', options: [{ id: 'lend-rio', label: 'Legendary' }], position: 0, aiAccess: 'read-write'
    });
    expect((field as unknown as { options: unknown }).options).toEqual([{ id: 'lend-rio', label: 'Legendary' }]);
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
      workspaceId: 'workspace-one', subjectId: 'tess', kind: 'knowledge',
      entry: { aboutId: 'northern-gate', statement: 'The gate is sealed.', confidence: 0.8, acquisition: 'witness', accessibility: 'available' }
    });
    expect(added.known).toHaveLength(1);

    const revised = service.saveSubjectEntry({
      workspaceId: 'workspace-one', subjectId: 'tess', kind: 'knowledge',
      existingId: added.known[0].id,
      entry: { aboutId: 'northern-gate', statement: 'The gate has reopened.', confidence: 1, acquisition: 'witness', accessibility: 'available' }
    });
    expect(revised.known).toEqual([expect.objectContaining({ statement: 'The gate has reopened.' })]);

    const removed = service.deleteSubjectEntry({
      workspaceId: 'workspace-one', subjectId: 'tess', kind: 'knowledge', entryId: revised.known[0].id
    });
    expect(removed.known).toEqual([]);
    expect(db.prepare("SELECT COUNT(*) AS count FROM narrative_records WHERE record_type = 'knowledge'").get())
      .toEqual({ count: 3 });
  });

  test('revising a Known entry without an entry id replaces it', () => {
    const added = service.saveSubjectEntry({
      workspaceId: 'workspace-one', subjectId: 'tess', kind: 'knowledge',
      entry: { aboutId: 'northern-gate', statement: 'The gate is sealed.', acquisition: 'witness', accessibility: 'available' }
    });
    // Older narrative records carry no entryId; their record id is their only handle.
    const row = db.prepare("SELECT record_id, payload_json FROM narrative_records WHERE record_type = 'knowledge'").get() as { record_id: string; payload_json: string };
    const legacy = JSON.parse(row.payload_json);
    delete legacy.entryId;
    db.prepare('UPDATE narrative_records SET record_id = ?, payload_json = ? WHERE record_id = ?')
      .run(legacy.id, JSON.stringify(legacy), row.record_id);
    expect(service.getSubjectKnowledge('workspace-one', 'tess').known).toHaveLength(added.known.length);

    const revised = service.saveSubjectEntry({
      workspaceId: 'workspace-one', subjectId: 'tess', kind: 'knowledge',
      existingId: legacy.id,
      entry: { aboutId: 'northern-gate', statement: 'The gate has reopened.', acquisition: 'witness', accessibility: 'available' }
    });
    expect(revised.known).toEqual([expect.objectContaining({ statement: 'The gate has reopened.' })]);

    const removed = service.deleteSubjectEntry({
      workspaceId: 'workspace-one', subjectId: 'tess', kind: 'knowledge', entryId: revised.known[0].id
    });
    expect(removed.known).toEqual([]);
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
    expect(db.prepare("SELECT COUNT(*) AS count FROM narrative_records WHERE record_type = 'memory'").get())
      .toEqual({ count: 3 });
  });

  test('keeps an optional story day on a memory and drops a half-set one', () => {
    const dated = service.saveSubjectEntry({
      workspaceId: 'workspace-one', subjectId: 'vharos', kind: 'memory',
      entry: { summary: 'Vharos saw the gate close.', accessibility: 'available', occurredOn: { eraId: 'ce', year: 1001, month: 3, day: 16 } }
    });
    expect(dated.memories[0].occurredOn).toEqual({ eraId: 'ce', year: 1001, month: 3, day: 16 });

    const cleared = service.saveSubjectEntry({
      workspaceId: 'workspace-one', subjectId: 'vharos', kind: 'memory', existingId: dated.memories[0].id,
      entry: { summary: 'Vharos saw the gate close.', accessibility: 'available', occurredOn: { eraId: 'ce', year: 1001, month: 0, day: 16 } }
    });
    expect(cleared.memories[0].occurredOn).toBeNull();
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
      "SELECT source_event_id AS id FROM narrative_records WHERE record_type = 'memory'"
    ).get() as { id: string }).id;
    db.prepare(`
      INSERT INTO worldbuild_event_occurrences (
        workspace_id, occurrence_id, event_entity_id, narrative_event_id,
        title, summary, source, archived, created_at, updated_at
      ) VALUES (?, 'occurrence-one', 'silver-tournament', ?, 'The Harvest Fair', '', 'user', 0, 1, 1)
    `).run('workspace-one', narrativeEventId);

    const projection = service.getSubjectKnowledge('workspace-one', 'vharos');
    expect(projection.memories).toEqual([
      expect.objectContaining({
        managed: true,
        origin: {
          kind: 'occurrence',
          occurrenceId: 'occurrence-one',
          eventEntityId: 'silver-tournament',
          title: 'The Harvest Fair',
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
      workspaceId: 'workspace-one', subjectId: 'tess', kind: 'observation',
      entry: { summary: 'Tess witnessed the northern gate collapse.', confidence: 0.9, method: 'witness', accessibility: 'available' }
    })).toThrow('Unsupported Knowledge entry type.');
  });

  test('keeps Faction knowledge separate from member knowledge', () => {
    service.saveSubjectEntry({
      workspaceId: 'workspace-one', subjectId: 'tess', kind: 'belief',
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
        acquisition: 'reported', informantIds: ['tess', 'elias'],
      }
    });

    expect(reported.known).toEqual([
      expect.objectContaining({ acquisition: 'reported', informantIds: ['tess'] })
    ]);
    const awareOf = service.getSubjectKnowledge('workspace-one', 'elias')
      .cards.map((card: { targetId: string }) => card.targetId);
    expect([...awareOf].sort()).toEqual(['tess', 'vault']);
  });

  test('drops informants when Knowledge was acquired first-hand', () => {
    const observed = service.saveSubjectEntry({
      workspaceId: 'workspace-one', subjectId: 'elias', kind: 'knowledge',
      entry: {
        aboutId: 'vault', statement: 'The vault opens at dusk.', confidence: 0.95,
        acquisition: 'witness', informantIds: ['tess'],
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
        relatedEntityIds: ['northern-gate', 'tess'],
      },
    });
    expect(added).toEqual([
      expect.objectContaining({
        title: 'Northern gate status',
        statement: 'The northern gate collapsed during the siege.',
        relatedEntityIds: ['northern-gate', 'tess'],
      }),
    ]);

    const revised = service.saveWorldFact({
      workspaceId: 'workspace-one',
      existingId: added[0].id,
      entry: {
        title: 'Northern gate status',
        statement: 'The northern gate partially collapsed during the siege.',
        relatedEntityIds: ['northern-gate', 'tess'],
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
    expect(db.prepare("SELECT DISTINCT subject_id FROM narrative_records WHERE record_type = 'fact'").all())
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
      workspaceId: 'workspace-one', subjectId: 'tess', kind: 'knowledge',
      entry: { aboutId: 'northern-gate', statement: 'The gate collapsed.', factIds: [fact.id], confidence: 1, acquisition: 'witness', accessibility: 'available' },
    });
    const belief = service.saveSubjectEntry({
      workspaceId: 'workspace-one', subjectId: 'tess', kind: 'belief',
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
        relatedEntityIds: ['northern-gate', 'tess'],
      },
    });
    expect(revisedFact.id).toBe(fact.id);
  });

  test('a sheet edit to a relationship becomes the one current ledger entry for the pair', () => {
    db.exec(`
      CREATE TABLE entities (
        id TEXT PRIMARY KEY, workspaceId TEXT, type TEXT NOT NULL, canonicalName TEXT NOT NULL,
        data TEXT, status TEXT NOT NULL DEFAULT 'confirmed', last_modified INTEGER DEFAULT 0
      );
      CREATE TABLE entity_links (
        id TEXT PRIMARY KEY, workspaceId TEXT, fromId TEXT, relType TEXT,
        toId TEXT, label TEXT, metadata_json TEXT, createdAt INTEGER
      );
    `);
    const insert = db.prepare('INSERT INTO entities (id, workspaceId, type, canonicalName, data) VALUES (?, ?, ?, ?, ?)');
    insert.run('brann', 'workspace-one', 'Characters', 'Brann', '{}');
    insert.run('tess', 'workspace-one', 'Characters', 'Tess', '{}');
    db.prepare(`INSERT INTO entity_links VALUES ('link', 'workspace-one', 'brann', 'related_to', 'tess', 'Stranger', '{"value":10,"description":"They just met."}', 1)`).run();
    service.recordRelationship({ workspaceId: 'workspace-one', fromId: 'brann', toId: 'tess' });
    const current = () => loadCurrentNarrativeRecords(db, { workspaceId: 'workspace-one', recordTypes: ['relationship'] })
      .map(({ payload }) => ({ title: payload.title, value: payload.value, description: payload.description }));
    expect(current()).toEqual([{ title: 'Stranger', value: 10, description: 'They just met.' }]);

    db.prepare(`DELETE FROM entity_links`).run();
    db.prepare(`INSERT INTO entity_links VALUES ('link', 'workspace-one', 'brann', 'related_to', 'tess', 'Mentor', '{"value":60,"description":"He trains her."}', 1)`).run();
    service.recordRelationship({ workspaceId: 'workspace-one', fromId: 'brann', toId: 'tess' });
    expect(current()).toEqual([{ title: 'Mentor', value: 60, description: 'He trains her.' }]);

    const events = () => (db.prepare('SELECT COUNT(*) AS n FROM narrative_events').get() as { n: number }).n;
    const before = events();
    service.recordRelationship({ workspaceId: 'workspace-one', fromId: 'brann', toId: 'tess' });
    expect(events()).toBe(before);

    db.prepare(`DELETE FROM entity_links`).run();
    service.recordRelationship({ workspaceId: 'workspace-one', fromId: 'brann', toId: 'tess' });
    expect(current()).toEqual([]);
  });
});
