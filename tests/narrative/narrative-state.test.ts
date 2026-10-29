import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import { NarrativeStateSystem, type ExtractedNarrativeEvent } from '../../src/main/features/narrative/narrative-state';
import { openTestDatabase } from '../sqlite-test-database';

describe('Narrative State runtime', () => {
  let directory: string;
  let db: Database.Database;
  let system: NarrativeStateSystem;
  const allowed = new Set(['elias', 'tess', 'guild']);

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'kallamo-narrative-state-'));
    db = openTestDatabase(join(directory, 'state.db'));
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
      type: 'revelation', description: 'Tess reveals the gate code to Elias.', excerpt: 'The gate code is Dawnfall.',
      participantIds: ['tess', 'elias'], confidence: 0.98,
      operations: [
        { type: 'awareness', subjectId: 'elias', targetId: 'guild', confidence: 0.98 },
        { type: 'knowledge', subjectId: 'elias', proposition: { subjectId: 'guild', predicate: 'gate-code', object: 'Dawnfall' }, category: 'capability', acquisition: 'participant', confidence: 0.98 },
        { type: 'memory', subjectId: 'elias', summary: 'Tess trusted Elias with the gate code.', category: 'bond', salience: 0.92 }
      ]
    }));

    expect(result.decision).toBe('automatic');
    expect(result.record?.status).toBe('approved');
    expect(db.prepare("SELECT record_type AS type, COUNT(*) AS count FROM narrative_records GROUP BY record_type ORDER BY type").all())
      .toEqual([{ type: 'knowledge', count: 1 }, { type: 'memory', count: 1 }]);
    expect(db.prepare('SELECT subject_id, target_id FROM narrative_awareness_records').all())
      .toEqual([{ subject_id: 'elias', target_id: 'guild' }]);
  });

  test('persists explicit introduction facts without filling a Worldbuild record', () => {
    const result = system.createEvent(input('message-fact', {
      type: 'custom', description: 'Selka enters carrying a broken spear.', excerpt: 'Selka enters carrying a broken spear.',
      participantIds: ['tess'], confidence: 0.98,
      operations: [{
        type: 'fact',
        proposition: { subjectId: 'tess', predicate: 'introduced-as', object: 'A mercenary carrying a broken spear.' },
        category: 'identity',
        confidence: 0.98
      }]
    }));

    expect(result.record?.status).toBe('approved');
    expect(db.prepare("SELECT record_type AS type, json_extract(payload_json, '$.proposition.object') AS value FROM narrative_records").get())
      .toEqual({ type: 'fact', value: 'A mercenary carrying a broken spear.' });
  });

  test('keeps beliefs and relationship changes reviewable and applies them atomically', () => {
    const result = system.createEvent(input('message-two', {
      type: 'deception', description: 'Tess accuses the guild of betrayal.', excerpt: 'The guild sold us out.',
      participantIds: ['tess', 'elias'], confidence: 0.95,
      operations: [
        { type: 'belief', subjectId: 'elias', proposition: { subjectId: 'guild', predicate: 'betrayed-party', object: 'elias' }, category: 'secret', confidence: 0.72 },
        { type: 'relationship', sourceEntityId: 'elias', targetEntityId: 'guild', dimension: 'trust', value: -35, cause: 'betrayal', description: 'Elias believes the accusation.' }
      ]
    }));

    expect(result.decision).toBe('review');
    expect(result.record?.status).toBe('proposed');
    expect(db.prepare('SELECT COUNT(*) AS count FROM narrative_records').get()).toEqual({ count: 0 });
    const eventId = result.record!.proposal.changeSet.event.id;
    expect(system.resolveEvent('workspace-one', eventId, 'approved')?.status).toBe('approved');
    expect(db.prepare('SELECT COUNT(*) AS count FROM narrative_records').get()).toEqual({ count: 2 });
    const link = db.prepare('SELECT fromId, toId, label, metadata_json FROM entity_links').get() as { fromId: string; toId: string; label: string | null; metadata_json: string };
    expect(link).toMatchObject({ fromId: 'elias', toId: 'guild', label: null });
    const metadata = JSON.parse(link.metadata_json);
    expect(metadata).toMatchObject({ value: -25, updatedBy: 'ai' });
    expect(metadata).not.toHaveProperty('description');
  });

  test('creates Awareness when a participating listener gains valid Knowledge', () => {
    const result = system.createEvent(input('reported-knowledge', {
      type: 'revelation', description: 'Tess reports the gate weakness to Elias.', excerpt: 'The eastern hinge breaks under cold.',
      participantIds: ['tess', 'elias'], confidence: 0.98,
      operations: [{
        type: 'knowledge',
        subjectId: 'elias',
        proposition: { subjectId: 'guild', predicate: 'eastern-hinge-weakness', object: 'cold' },
        category: 'capability',
        acquisition: 'reported',
        confidence: 0.98
      }]
    }));

    expect(result.record?.proposal.changeSet.operations.map(operation => operation.type))
      .toEqual(['grant-awareness', 'grant-knowledge']);
    expect(db.prepare('SELECT subject_id, target_id FROM narrative_awareness_records').all())
      .toEqual([{ subject_id: 'elias', target_id: 'guild' }]);
  });

  test('never makes a character aware of themselves', () => {
    const result = system.createEvent(input('self-belief', {
      type: 'custom', description: 'Elias doubts himself.', excerpt: 'I was never brave.',
      participantIds: ['elias'], confidence: 0.95,
      operations: [
        { type: 'awareness', subjectId: 'elias', targetId: 'elias', confidence: 0.95 },
        { type: 'belief', subjectId: 'elias', proposition: { subjectId: 'elias', predicate: 'self-view', object: 'He was never brave.' }, category: 'identity', confidence: 0.85 }
      ]
    }));

    expect(result.record?.proposal.changeSet.operations.map(operation => operation.type)).toEqual(['set-belief']);
  });

  test('keeps valid relationships when another extracted operation is malformed', () => {
    const result = system.createEvent(input('mixed-validity', {
      type: 'revelation', description: 'Tess shares an incomplete account with Elias.', excerpt: 'There is more to this story.',
      participantIds: ['tess', 'elias'], confidence: 0.95,
      operations: [
        { type: 'knowledge', subjectId: 'elias', proposition: { subjectId: 'guild', predicate: 'incomplete-account' } as never, category: 'history', acquisition: 'reported', confidence: 0.95 },
        { type: 'relationship', sourceEntityId: 'tess', targetEntityId: 'elias', dimension: 'overall', value: 20, cause: 'first-impression', impact: 'meaningful' }
      ]
    }));

    expect(result.record?.proposal.changeSet.operations.map(operation => operation.type))
      .toEqual(['grant-awareness', 'set-relationship']);
  });

  test('blocks the protagonist relationship perspective without blocking awareness', () => {
    const result = system.createEvent({
      ...input('protagonist-boundary', {
        type: 'relationship-change', description: 'Elias and Tess recognize each other.', excerpt: 'We have met before.',
        participantIds: ['elias', 'tess'], confidence: 0.95,
        operations: [
          { type: 'awareness', subjectId: 'elias', targetId: 'tess', confidence: 0.95 },
          { type: 'relationship', sourceEntityId: 'elias', targetEntityId: 'tess', dimension: 'overall', value: 20, cause: 'first-impression', impact: 'meaningful' },
          { type: 'relationship', sourceEntityId: 'tess', targetEntityId: 'elias', dimension: 'overall', value: 20, cause: 'first-impression', impact: 'meaningful' }
        ]
      }),
      excludedRelationshipSourceIds: new Set(['elias'])
    });

    const operations = result.record?.proposal.changeSet.operations ?? [];
    expect(operations.some(operation => operation.type === 'grant-awareness' && operation.awareness.subjectId === 'elias')).toBe(true);
    expect(operations.some(operation => operation.type === 'set-relationship' && operation.relationship.sourceEntityId === 'elias')).toBe(false);
    expect(operations.some(operation => operation.type === 'set-relationship' && operation.relationship.sourceEntityId === 'tess')).toBe(true);
  });

  test('applies selected review items and records rejected items without losing audit history', () => {
    const result = system.createEvent(input('partial-review', {
      type: 'deception', description: 'Tess makes two claims.', excerpt: 'The guild lied, but Elias is uncertain.',
      participantIds: ['tess', 'elias'], confidence: 0.95,
      operations: [
        { type: 'belief', subjectId: 'elias', proposition: { subjectId: 'guild', predicate: 'lied', object: true }, category: 'secret', confidence: 0.72 },
        { type: 'relationship', sourceEntityId: 'elias', targetEntityId: 'guild', dimension: 'trust', value: -35, cause: 'betrayal', description: 'Elias distrusts the guild.' }
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
    expect(db.prepare('SELECT record_type AS type FROM narrative_records').all()).toEqual([{ type: 'belief' }]);
    expect(db.prepare('SELECT operation_id, decision FROM narrative_operation_reviews ORDER BY operation_id').all())
      .toEqual([
        { operation_id: belief.id, decision: 'approved' },
        { operation_id: awareness.id, decision: 'rejected' },
        { operation_id: relationship.id, decision: 'rejected' },
      ]);
  });

  test('deduplicates regenerated turns and rejects invalid entity references', () => {
    const event: ExtractedNarrativeEvent = {
      type: 'discovery', description: 'Elias finds a hidden route.', excerpt: 'A passage opens behind the stone.',
      participantIds: ['elias'], confidence: 0.97,
      operations: [
        { type: 'awareness', subjectId: 'elias', targetId: 'guild', confidence: 0.97 },
        { type: 'knowledge', subjectId: 'elias', proposition: { subjectId: 'guild', predicate: 'has-hidden-route', object: true }, category: 'world-lore', acquisition: 'participant', confidence: 0.97 }
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
      participantIds: ['tess'], confidence: 0.99,
      operations: [{ type: 'knowledge', subjectId: 'elias', proposition: { subjectId: 'guild', predicate: 'secret-plan', object: true }, category: 'secret', acquisition: 'witness', confidence: 0.99 }]
    }));
    expect(result).toEqual({ skipped: 'no-valid-operations' });
  });

  test('does not create the same active memory again in a later turn', () => {
    const event: ExtractedNarrativeEvent = {
      type: 'custom', description: 'Elias remembers Tess warning him.', excerpt: 'Remember my warning.',
      participantIds: ['elias'], confidence: 0.99,
      operations: [{ type: 'memory', subjectId: 'elias', summary: 'Tess warned Elias about the gate.', category: 'revelation', salience: 0.95 }]
    };
    expect(system.createEvent(input('memory-one', event)).record?.status).toBe('approved');
    expect(system.createEvent(input('memory-two', event))).toEqual({ skipped: 'no-valid-operations' });
    expect(db.prepare("SELECT COUNT(*) AS count FROM narrative_records WHERE record_type = 'memory'").get()).toEqual({ count: 1 });
  });

  test('dates a turn memory with the story day the turn started on', () => {
    db.prepare(`INSERT INTO roleplay_time_state (workspace_id, position_json, version, updated_at) VALUES ('workspace-one', ?, 1, 1)`)
      .run(JSON.stringify({ eraId: 'ce', year: 1001, month: 5, day: 20, hour: 9, minute: 0 }));
    db.prepare(`INSERT INTO roleplay_message_frames (workspace_id, origin_id, start_json, end_json, created_at, updated_at) VALUES ('workspace-one', 'framed-turn', ?, '{}', 1, 1)`)
      .run(JSON.stringify({ position: { eraId: 'ce', year: 1001, month: 5, day: 19, hour: 23, minute: 0 } }));
    const memory = (summary: string): ExtractedNarrativeEvent => ({
      type: 'custom', description: summary, excerpt: summary, participantIds: ['elias'], confidence: 0.99,
      operations: [{ type: 'memory', subjectId: 'elias', summary, category: 'revelation', salience: 0.95 }]
    });
    system.createEvent(input('framed-turn', memory('Tess warned Elias at midnight.')));
    system.createEvent(input('unframed-turn', memory('Tess left the city.')));
    system.createEvent({ ...input('lore-update', memory('Elias grew up by the docks.')), originType: 'worldbuild-update' });

    const dates = (db.prepare("SELECT payload_json FROM narrative_records WHERE record_type = 'memory' ORDER BY rowid").all() as Array<{ payload_json: string }>)
      .map(row => JSON.parse(row.payload_json).occurredOn ?? null);
    expect(dates).toEqual([
      { eraId: 'ce', year: 1001, month: 5, day: 19 },
      { eraId: 'ce', year: 1001, month: 5, day: 20 },
      null
    ]);
  });

  test('keeps idempotency and projections stable across a 500-turn campaign simulation', () => {
    for (let turn = 1; turn <= 500; turn += 1) {
      const subjectId = turn % 2 ? 'elias' : 'tess';
      const event: ExtractedNarrativeEvent = {
        type: 'discovery', description: `${subjectId} discovers campaign clue ${turn}.`, excerpt: `Clue ${turn} is confirmed.`,
        participantIds: [subjectId], confidence: 0.99,
        operations: [
          { type: 'awareness', subjectId, targetId: 'guild', confidence: 0.99 },
          { type: 'knowledge', subjectId, proposition: { subjectId: 'guild', predicate: `campaign-clue-${turn}`, object: true }, category: 'world-lore', acquisition: 'participant', confidence: 0.99 }
        ]
      };
      expect(system.createEvent(input(`turn-${turn}`, event)).record?.status).toBe('approved');
    }
    expect(system.listEvents('workspace-one')).toHaveLength(500);
    expect(db.prepare("SELECT COUNT(*) AS count FROM narrative_records WHERE record_type = 'knowledge'").get()).toEqual({ count: 500 });
  }, 35_000);

  test('refuses a turn whose only content was the scene, and says why', () => {
    const result = system.createEvent(input('scene-only', {
      type: 'custom', description: 'Tess trains in the yard.', excerpt: 'Tess lifts the stave again.',
      participantIds: ['tess', 'elias'], confidence: 0.98,
      operations: [
        { type: 'knowledge', subjectId: 'elias', proposition: { subjectId: 'tess', predicate: 'training-decision', object: 'Tess is drilling with a stave in the yard right now.' }, category: 'scene-state', acquisition: 'witness', confidence: 0.97 },
        { type: 'relationship', sourceEntityId: 'tess', targetEntityId: 'elias', dimension: 'overall', value: 60, cause: 'courtesy', impact: 'meaningful' }
      ]
    }));

    expect(result).toEqual({
      skipped: 'no-durable-operations',
      rejections: [
        { type: 'knowledge', reason: 'transient-category' },
        { type: 'relationship', reason: 'transient-cause' }
      ]
    });
    expect(db.prepare('SELECT COUNT(*) AS count FROM narrative_events').get()).toEqual({ count: 0 });
  });

  test('stores one record when the same statement returns under a renamed predicate', () => {
    const statement = 'The eastern hinge gives way under deep cold.';
    const first = system.createEvent(input('statement-first', {
      type: 'revelation', description: 'Tess explains the hinge.', excerpt: statement,
      participantIds: ['tess', 'elias'], confidence: 0.98,
      operations: [{ type: 'knowledge', subjectId: 'elias', proposition: { subjectId: 'guild', predicate: 'hinge-weakness', object: statement }, category: 'capability', acquisition: 'reported', confidence: 0.98 }]
    }));
    expect(first.record?.status).toBe('approved');

    const second = system.createEvent(input('statement-again', {
      type: 'revelation', description: 'Elias repeats what he learned.', excerpt: statement,
      participantIds: ['tess', 'elias'], confidence: 0.98,
      operations: [{ type: 'knowledge', subjectId: 'elias', proposition: { subjectId: 'guild', predicate: 'worldbuild-statement', object: statement }, category: 'capability', acquisition: 'witness', confidence: 0.98 }]
    }));

    expect(second).toEqual({ skipped: 'no-valid-operations' });
    expect(db.prepare("SELECT COUNT(*) AS count FROM narrative_records WHERE record_type = 'knowledge'").get())
      .toEqual({ count: 1 });
  });

  test('writes the category and the cause onto the stored records', () => {
    system.createEvent(input('categorized', {
      type: 'revelation', description: 'Tess admits she sold the guild out.', excerpt: 'It was me.',
      participantIds: ['tess', 'elias'], confidence: 0.98,
      operations: [
        { type: 'knowledge', subjectId: 'elias', proposition: { subjectId: 'tess', predicate: 'guild-informant', object: 'Tess sold the guild plans to a rival house.' }, category: 'secret', acquisition: 'participant', confidence: 0.98 },
        { type: 'relationship', sourceEntityId: 'tess', targetEntityId: 'elias', dimension: 'overall', value: 30, cause: 'revelation', impact: 'significant' }
      ]
    }));
    const eventId = system.listEvents('workspace-one')[0].proposal.changeSet.event.id;
    system.resolveEvent('workspace-one', eventId, 'approved');

    expect(db.prepare("SELECT json_extract(payload_json, '$.category') AS category FROM narrative_records WHERE record_type = 'knowledge'").get())
      .toEqual({ category: 'secret' });
    expect(db.prepare("SELECT json_extract(payload_json, '$.cause') AS cause FROM narrative_records WHERE record_type = 'relationship'").get())
      .toEqual({ cause: 'revelation' });
  });

  test('applies ordinary world lore without a queue and holds a secret for review', () => {
    const lore = system.createEvent(input('public-lore', {
      type: 'discovery', description: 'The guild charter is read aloud.', excerpt: 'The charter binds every member.',
      participantIds: ['elias'], confidence: 0.98,
      operations: [{ type: 'knowledge', subjectId: 'elias', proposition: { subjectId: 'guild', predicate: 'charter-terms', object: 'The guild charter binds every member to arbitration.' }, category: 'world-lore', acquisition: 'participant', confidence: 0.98 }]
    }));
    const secret = system.createEvent(input('hidden-truth', {
      type: 'revelation', description: 'Elias learns the guild ledger is forged.', excerpt: 'The ledger is a forgery.',
      participantIds: ['elias'], confidence: 0.98,
      operations: [{ type: 'knowledge', subjectId: 'elias', proposition: { subjectId: 'guild', predicate: 'forged-ledger', object: 'The guild ledger has been forged for years.' }, category: 'secret', acquisition: 'participant', confidence: 0.98 }]
    }));

    expect(lore.decision).toBe('automatic');
    expect(secret.decision).toBe('review');
  });

  test('the automatic policy still holds a secret for review', () => {
    const secret = system.createEvent({ ...input('automatic-secret', {
      type: 'revelation', description: 'Elias learns the guild ledger is forged.', excerpt: 'The ledger is a forgery.',
      participantIds: ['elias'], confidence: 0.98,
      operations: [{ type: 'knowledge', subjectId: 'elias', proposition: { subjectId: 'guild', predicate: 'forged-ledger', object: 'The guild ledger has been forged for years.' }, category: 'secret', acquisition: 'participant', confidence: 0.98 }]
    }), updatePolicy: 'automatic' });

    expect(secret.decision).toBe('review');
  });

  function input(originId: string, event: ExtractedNarrativeEvent) {
    return { workspaceId: 'workspace-one', originId, interpreterId: 'system-model', event, allowedEntityIds: allowed };
  }
});
