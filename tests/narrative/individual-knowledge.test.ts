import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import { NarrativeChangeSetRepository } from '../../src/narrative/change-sets';
import type { NarrativeProposal } from '../../src/narrative/contracts';
import {
  IndividualKnowledgeReadError,
  IndividualKnowledgeRepository
} from '../../src/narrative/individual-knowledge';
import { NarrativeEventLedgerRepository } from '../../src/narrative/ledger';
import { possessionTransferScenario, secretRevelationScenario } from '../../src/narrative/scenarios';
import { openTestDatabase } from '../sqlite-test-database';

const APPLIED_AT = '2026-07-18T20:00:00.000Z';

describe('individual knowledge persistence', () => {
  let directory: string;
  let db: Database.Database;
  let ledger: NarrativeEventLedgerRepository;
  let changeSets: NarrativeChangeSetRepository;
  let knowledge: IndividualKnowledgeRepository;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'narrative-knowledge-'));
    db = openTestDatabase(join(directory, 'knowledge.db'));
    db.pragma('foreign_keys = ON');
    runDatabaseMigrations(db);
    ledger = new NarrativeEventLedgerRepository(db);
    changeSets = new NarrativeChangeSetRepository(db);
    knowledge = new IndividualKnowledgeRepository(db);
  });

  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test('returns explicitly granted knowledge with its acquisition context', () => {
    apply(secretRevelationScenario, 'attempt-revelation');

    expect(knowledge.listForSubject(secretRevelationScenario.projectId, 'elias')).toEqual([
      expect.objectContaining({
        knowledge: expect.objectContaining({
          subjectId: 'elias',
          acquisition: 'participant',
          confidence: 1,
          accessibility: 'available'
        }),
        sourceEventId: secretRevelationScenario.changeSet.event.id,
        acquiredAt: secretRevelationScenario.changeSet.event.position,
        appliedAt: APPLIED_AT
      })
    ]);
    expect(db.prepare("SELECT subject_id FROM narrative_records WHERE record_type = 'knowledge'").get())
      .toEqual({ subject_id: 'elias' });
  });

  test('does not infer knowledge from participation or possible observation', () => {
    apply(possessionTransferScenario, 'attempt-transfer');

    expect(knowledge.listForSubject(possessionTransferScenario.projectId, 'mara')).toEqual([]);
    expect(knowledge.listForSubject(possessionTransferScenario.projectId, 'elias')).toEqual([]);
  });

  test('keeps knowledge isolated between subjects exposed to different events', () => {
    apply(secretRevelationScenario, 'attempt-elias');
    const maraDiscovery = structuredClone(secretRevelationScenario);
    maraDiscovery.id = 'proposal-mara-discovery';
    maraDiscovery.changeSet.id = 'changes-mara-discovery';
    maraDiscovery.changeSet.event.id = 'event-mara-discovery';
    maraDiscovery.changeSet.event.sceneId = 'scene-mara-only';
    maraDiscovery.changeSet.event.position.sequence = 30;
    const maraKnowledge = maraDiscovery.changeSet.operations.find(operation => operation.type === 'grant-knowledge');
    if (!maraKnowledge || maraKnowledge.type !== 'grant-knowledge') throw new Error('Knowledge fixture is missing.');
    maraKnowledge.id = 'operation-mara-knowledge';
    maraKnowledge.knowledge.id = 'knowledge-mara-secret';
    maraKnowledge.knowledge.subjectId = 'mara';
    maraKnowledge.knowledge.sourceEventId = maraDiscovery.changeSet.event.id;
    maraDiscovery.changeSet.operations = [maraKnowledge];
    apply(maraDiscovery, 'attempt-mara');

    expect(knowledge.listForSubject(secretRevelationScenario.projectId, 'elias')).toHaveLength(1);
    expect(knowledge.listForSubject(secretRevelationScenario.projectId, 'mara')).toEqual([
      expect.objectContaining({ sourceEventId: 'event-mara-discovery', acquiredAt: { sequence: 30 } })
    ]);
  });

  test('filters suppressed knowledge independently from its active status', () => {
    const suppressed = structuredClone(secretRevelationScenario);
    const suppressedKnowledge = suppressed.changeSet.operations.find(operation => operation.type === 'grant-knowledge');
    if (!suppressedKnowledge || suppressedKnowledge.type !== 'grant-knowledge') throw new Error('Knowledge fixture is missing.');
    suppressedKnowledge.knowledge.accessibility = 'suppressed';
    apply(suppressed, 'attempt-suppressed');

    expect(knowledge.listForSubject(suppressed.projectId, 'elias', { accessibleOnly: true })).toEqual([]);
    expect(knowledge.listForSubject(suppressed.projectId, 'elias')).toEqual([
      expect.objectContaining({ knowledge: expect.objectContaining({ status: 'active', accessibility: 'suppressed' }) })
    ]);
  });

  test('rejects malformed knowledge JSON read from the database', () => {
    apply(secretRevelationScenario, 'attempt-malformed');
    db.prepare("UPDATE narrative_records SET payload_json = '{' WHERE record_type = 'knowledge'").run();

    expect(() => knowledge.listForSubject(secretRevelationScenario.projectId, 'elias'))
      .toThrowError(expect.objectContaining({
        code: 'MALFORMED_KNOWLEDGE_JSON',
        recordId: 'knowledge-elias-northern-gate'
      }));
  });

  test('rejects knowledge that no longer conforms to the runtime contract', () => {
    apply(secretRevelationScenario, 'attempt-invalid');
    const invalidKnowledge = {
      id: 'knowledge-elias-northern-gate',
      subjectId: 'elias',
      proposition: { subjectId: 'northern-gate', predicate: 'guarded', object: false },
      sourceEventId: 'proposal-secret-event',
      acquisition: 'participant',
      confidence: 900,
      accessibility: 'available',
      status: 'active'
    };
    db.prepare("UPDATE narrative_records SET payload_json = ? WHERE record_type = 'knowledge'")
      .run(JSON.stringify(invalidKnowledge));

    expect(() => knowledge.listForSubject(secretRevelationScenario.projectId, 'elias'))
      .toThrow(IndividualKnowledgeReadError);
  });

  test('rejects a payload whose source event differs from its persisted provenance', () => {
    apply(secretRevelationScenario, 'attempt-source-mismatch');
    const mismatched = structuredClone(secretRevelationScenario);
    const mismatchedKnowledge = mismatched.changeSet.operations.find(operation => operation.type === 'grant-knowledge');
    if (!mismatchedKnowledge || mismatchedKnowledge.type !== 'grant-knowledge') throw new Error('Knowledge fixture is missing.');
    mismatchedKnowledge.knowledge.sourceEventId = 'event-other';
    db.prepare("UPDATE narrative_records SET payload_json = ? WHERE record_type = 'knowledge'")
      .run(JSON.stringify(mismatchedKnowledge.knowledge));

    expect(() => knowledge.listForSubject(secretRevelationScenario.projectId, 'elias'))
      .toThrowError(expect.objectContaining({ code: 'KNOWLEDGE_SOURCE_MISMATCH' }));
  });

  function apply(proposal: NarrativeProposal, attemptId: string): void {
    ledger.save(proposal);
    changeSets.apply(proposal.projectId, proposal.changeSet.event.id, {
      expectedVersion: 1,
      attemptedAt: APPLIED_AT,
      attemptId
    });
  }
});
