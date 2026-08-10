import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import { NarrativeStateSystem, type ExtractedNarrativeEvent } from '../../src/main/features/kanora/narrative-state';

describe('Narrative State runtime', () => {
  let directory: string;
  let db: Database.Database;
  let system: NarrativeStateSystem;
  const allowed = new Set(['elias', 'mara', 'guild']);

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'kallamo-narrative-state-'));
    db = new Database(join(directory, 'state.db'));
    db.pragma('foreign_keys = ON');
    runDatabaseMigrations(db);
    db.exec(`CREATE TABLE entity_links (
      id TEXT PRIMARY KEY, workspaceId TEXT, fromId TEXT, relType TEXT,
      toId TEXT, label TEXT, metadata_json TEXT, createdAt INTEGER
    )`);
    system = new NarrativeStateSystem(db);
  });

  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test('automatically applies high-confidence direct knowledge and a salient memory', () => {
    const result = system.createEvent(input('message-one', {
      type: 'revelation', description: 'Mara reveals the gate code to Elias.', excerpt: 'The gate code is Dawnfall.',
      participantIds: ['mara', 'elias'], confidence: 0.98,
      operations: [
        { type: 'awareness', subjectId: 'elias', targetId: 'guild', confidence: 0.98 },
        { type: 'knowledge', subjectId: 'elias', proposition: { subjectId: 'guild', predicate: 'gate-code', object: 'Dawnfall' }, acquisition: 'participant', confidence: 0.98 },
        { type: 'memory', subjectId: 'elias', summary: 'Mara trusted Elias with the gate code.', salience: 0.92 }
      ]
    }));

    expect(result.decision).toBe('automatic');
    expect(result.record?.status).toBe('approved');
    expect(db.prepare("SELECT record_type AS type, COUNT(*) AS count FROM kanora_narrative_records GROUP BY record_type ORDER BY type").all())
      .toEqual([{ type: 'knowledge', count: 1 }, { type: 'memory', count: 1 }]);
    expect(db.prepare('SELECT subject_id, target_id FROM kanora_awareness_records').all())
      .toEqual([{ subject_id: 'elias', target_id: 'guild' }]);
  });

  test('persists explicit introduction facts without filling a Worldbuild record', () => {
    const result = system.createEvent(input('message-fact', {
      type: 'custom', description: 'Selka enters carrying a broken spear.', excerpt: 'Selka enters carrying a broken spear.',
      participantIds: ['mara'], confidence: 0.98,
      operations: [{
        type: 'fact',
        proposition: { subjectId: 'mara', predicate: 'introduced-as', object: 'A mercenary carrying a broken spear.' },
        confidence: 0.98
      }]
    }));

    expect(result.record?.status).toBe('approved');
    expect(db.prepare("SELECT record_type AS type, json_extract(payload_json, '$.proposition.object') AS value FROM kanora_narrative_records").get())
      .toEqual({ type: 'fact', value: 'A mercenary carrying a broken spear.' });
  });

  test('keeps beliefs and relationship changes reviewable and applies them atomically', () => {
    const result = system.createEvent(input('message-two', {
      type: 'deception', description: 'Mara accuses the guild of betrayal.', excerpt: 'The guild sold us out.',
      participantIds: ['mara', 'elias'], confidence: 0.95,
      operations: [
        { type: 'belief', subjectId: 'elias', proposition: { subjectId: 'guild', predicate: 'betrayed-party', object: 'elias' }, confidence: 0.72 },
        { type: 'relationship', sourceEntityId: 'elias', targetEntityId: 'guild', dimension: 'trust', value: -35, description: 'Elias believes the accusation.' }
      ]
    }));

    expect(result.decision).toBe('review');
    expect(result.record?.status).toBe('proposed');
    expect(db.prepare('SELECT COUNT(*) AS count FROM kanora_narrative_records').get()).toEqual({ count: 0 });
    const eventId = result.record!.proposal.changeSet.event.id;
    expect(system.resolveEvent('workspace-one', eventId, 'approved')?.status).toBe('approved');
    expect(db.prepare('SELECT COUNT(*) AS count FROM kanora_narrative_records').get()).toEqual({ count: 2 });
    const link = db.prepare('SELECT fromId, toId, label, metadata_json FROM entity_links').get() as { fromId: string; toId: string; label: string; metadata_json: string };
    expect(link).toMatchObject({ fromId: 'elias', toId: 'guild', label: 'trust' });
    expect(JSON.parse(link.metadata_json)).toMatchObject({ value: -35, description: 'Elias believes the accusation.', updatedBy: 'ai' });
  });

  test('creates Awareness when a participating listener gains valid Knowledge', () => {
    const result = system.createEvent(input('reported-knowledge', {
      type: 'revelation', description: 'Mara reports the gate weakness to Elias.', excerpt: 'The eastern hinge breaks under cold.',
      participantIds: ['mara', 'elias'], confidence: 0.98,
      operations: [{
        type: 'knowledge',
        subjectId: 'elias',
        proposition: { subjectId: 'guild', predicate: 'eastern-hinge-weakness', object: 'cold' },
        acquisition: 'reported',
        confidence: 0.98
      }]
    }));

    expect(result.record?.proposal.changeSet.operations.map(operation => operation.type))
      .toEqual(['grant-awareness', 'grant-knowledge']);
    expect(db.prepare('SELECT subject_id, target_id FROM kanora_awareness_records').all())
      .toEqual([{ subject_id: 'elias', target_id: 'guild' }]);
  });

  test('keeps valid relationships when another extracted operation is malformed', () => {
    const result = system.createEvent(input('mixed-validity', {
      type: 'revelation', description: 'Mara shares an incomplete account with Elias.', excerpt: 'There is more to this story.',
      participantIds: ['mara', 'elias'], confidence: 0.95,
      operations: [
        { type: 'knowledge', subjectId: 'elias', proposition: { subjectId: 'guild', predicate: 'incomplete-account' } as never, acquisition: 'reported', confidence: 0.95 },
        { type: 'relationship', sourceEntityId: 'mara', targetEntityId: 'elias', dimension: 'overall', value: 20, impact: 'meaningful' }
      ]
    }));

    expect(result.record?.proposal.changeSet.operations.map(operation => operation.type))
      .toEqual(['grant-awareness', 'set-relationship']);
  });

  test('blocks the protagonist relationship perspective without blocking awareness', () => {
    const result = system.createEvent({
      ...input('protagonist-boundary', {
        type: 'relationship-change', description: 'Elias and Mara recognize each other.', excerpt: 'We have met before.',
        participantIds: ['elias', 'mara'], confidence: 0.95,
        operations: [
          { type: 'awareness', subjectId: 'elias', targetId: 'mara', confidence: 0.95 },
          { type: 'relationship', sourceEntityId: 'elias', targetEntityId: 'mara', dimension: 'overall', value: 20, impact: 'meaningful' },
          { type: 'relationship', sourceEntityId: 'mara', targetEntityId: 'elias', dimension: 'overall', value: 20, impact: 'meaningful' }
        ]
      }),
      excludedRelationshipSourceIds: new Set(['elias'])
    });

    const operations = result.record?.proposal.changeSet.operations ?? [];
    expect(operations.some(operation => operation.type === 'grant-awareness' && operation.awareness.subjectId === 'elias')).toBe(true);
    expect(operations.some(operation => operation.type === 'set-relationship' && operation.relationship.sourceEntityId === 'elias')).toBe(false);
    expect(operations.some(operation => operation.type === 'set-relationship' && operation.relationship.sourceEntityId === 'mara')).toBe(true);
  });

  test('applies selected review items and records rejected items without losing audit history', () => {
    const result = system.createEvent(input('partial-review', {
      type: 'deception', description: 'Mara makes two claims.', excerpt: 'The guild lied, but Elias is uncertain.',
      participantIds: ['mara', 'elias'], confidence: 0.95,
      operations: [
        { type: 'belief', subjectId: 'elias', proposition: { subjectId: 'guild', predicate: 'lied', object: true }, confidence: 0.72 },
        { type: 'relationship', sourceEntityId: 'elias', targetEntityId: 'guild', dimension: 'trust', value: -35, description: 'Elias distrusts the guild.' }
      ]
    }));
    const eventId = result.record!.proposal.changeSet.event.id;
    const belief = result.record!.proposal.changeSet.operations.find(operation => operation.type === 'set-belief')!;
    const awareness = result.record!.proposal.changeSet.operations.find(operation => operation.type === 'grant-awareness')!;
    const relationship = result.record!.proposal.changeSet.operations.find(operation => operation.type === 'set-relationship')!;

    const resolved = system.resolveEventOperations('workspace-one', eventId, {
      approvedOperationIds: [belief.id],
      rejectedOperationIds: [awareness.id, relationship.id],
    });

    expect(resolved?.status).toBe('approved');
    expect(db.prepare('SELECT record_type AS type FROM kanora_narrative_records').all()).toEqual([{ type: 'belief' }]);
    expect(db.prepare('SELECT operation_id, decision FROM kanora_narrative_operation_reviews ORDER BY operation_id').all())
      .toEqual([
        { operation_id: belief.id, decision: 'approved' },
        { operation_id: relationship.id, decision: 'rejected' },
        { operation_id: awareness.id, decision: 'rejected' },
      ]);
  });

  test('deduplicates regenerated turns and rejects invalid entity references', () => {
    const event: ExtractedNarrativeEvent = {
      type: 'discovery', description: 'Elias finds a hidden route.', excerpt: 'A passage opens behind the stone.',
      participantIds: ['elias'], confidence: 0.97,
      operations: [
        { type: 'awareness', subjectId: 'elias', targetId: 'guild', confidence: 0.97 },
        { type: 'knowledge', subjectId: 'elias', proposition: { subjectId: 'guild', predicate: 'has-hidden-route', object: true }, acquisition: 'participant', confidence: 0.97 }
      ]
    };
    expect(system.createEvent(input('same-message', event)).record).toBeDefined();
    expect(system.createEvent(input('same-message', event))).toEqual({ skipped: 'duplicate' });

    const invalid = { ...event, operations: [{ ...event.operations[0], subjectId: 'unknown' }] } as ExtractedNarrativeEvent;
    expect(system.createEvent(input('invalid-message', invalid))).toEqual({ skipped: 'no-valid-operations' });
  });

  test('stores bounded local metrics for long-campaign evaluation', () => {
    system.recordMetric({ workspaceId: 'workspace-one', originId: 'turn-1', triageInputTokens: 100, triageOutputTokens: 20, deepInputTokens: 400, deepOutputTokens: 120, deepAnalysis: true, proposalCount: 1, elapsedMs: 250, recordedAt: 1 });
    expect(system.listMetrics('workspace-one')).toEqual([expect.objectContaining({ originId: 'turn-1', deepAnalysis: true, proposalCount: 1 })]);
  });

  test('never grants knowledge without an explicit observation in the same event', () => {
    const result = system.createEvent(input('unobserved-secret', {
      type: 'revelation', description: 'A secret is discussed outside Elias hearing.', excerpt: 'Keep Elias away from this.',
      participantIds: ['mara'], confidence: 0.99,
      operations: [{ type: 'knowledge', subjectId: 'elias', proposition: { subjectId: 'guild', predicate: 'secret-plan', object: true }, acquisition: 'witness', confidence: 0.99 }]
    }));
    expect(result).toEqual({ skipped: 'no-valid-operations' });
  });

  test('does not create the same active memory again in a later turn', () => {
    const event: ExtractedNarrativeEvent = {
      type: 'custom', description: 'Elias remembers Mara warning him.', excerpt: 'Remember my warning.',
      participantIds: ['elias'], confidence: 0.99,
      operations: [{ type: 'memory', subjectId: 'elias', summary: 'Mara warned Elias about the gate.', salience: 0.95 }]
    };
    expect(system.createEvent(input('memory-one', event)).record?.status).toBe('approved');
    expect(system.createEvent(input('memory-two', event))).toEqual({ skipped: 'no-valid-operations' });
    expect(db.prepare("SELECT COUNT(*) AS count FROM kanora_narrative_records WHERE record_type = 'memory'").get()).toEqual({ count: 1 });
  });

  test('keeps idempotency and projections stable across a 500-turn campaign simulation', () => {
    for (let turn = 1; turn <= 500; turn += 1) {
      const subjectId = turn % 2 ? 'elias' : 'mara';
      const event: ExtractedNarrativeEvent = {
        type: 'discovery', description: `${subjectId} discovers campaign clue ${turn}.`, excerpt: `Clue ${turn} is confirmed.`,
        participantIds: [subjectId], confidence: 0.99,
        operations: [
          { type: 'awareness', subjectId, targetId: 'guild', confidence: 0.99 },
          { type: 'knowledge', subjectId, proposition: { subjectId: 'guild', predicate: `campaign-clue-${turn}`, object: true }, acquisition: 'participant', confidence: 0.99 }
        ]
      };
      expect(system.createEvent(input(`turn-${turn}`, event)).record?.status).toBe('approved');
    }
    expect(system.listEvents('workspace-one')).toHaveLength(500);
    expect(db.prepare("SELECT COUNT(*) AS count FROM kanora_narrative_records WHERE record_type = 'knowledge'").get()).toEqual({ count: 500 });
  }, 35_000);

  function input(originId: string, event: ExtractedNarrativeEvent) {
    return { workspaceId: 'workspace-one', originId, interpreterId: 'system-model', event, allowedEntityIds: allowed };
  }
});
