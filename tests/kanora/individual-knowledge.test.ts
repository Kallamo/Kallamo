import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import { NarrativeChangeSetRepository } from '../../src/kanora/change-sets';
import type { NarrativeProposal } from '../../src/kanora/contracts';
import { IndividualKnowledgeRepository } from '../../src/kanora/individual-knowledge';
import { NarrativeEventLedgerRepository } from '../../src/kanora/ledger';
import { possessionTransferScenario, secretRevelationScenario } from '../../src/kanora/scenarios';

const APPLIED_AT = '2026-07-18T20:00:00.000Z';

describe('individual knowledge persistence', () => {
  let directory: string;
  let db: Database.Database;
  let ledger: NarrativeEventLedgerRepository;
  let changeSets: NarrativeChangeSetRepository;
  let knowledge: IndividualKnowledgeRepository;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'kanora-knowledge-'));
    db = new Database(join(directory, 'knowledge.db'));
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
        knowledge: expect.objectContaining({ subjectId: 'elias', acquisition: 'participant', confidence: 1 }),
        sourceEventId: secretRevelationScenario.changeSet.event.id,
        acquiredAt: secretRevelationScenario.changeSet.event.position,
        accessibility: 'available',
        appliedAt: APPLIED_AT
      })
    ]);
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

  test('filters inaccessible knowledge deterministically from its status', () => {
    const forgotten = structuredClone(secretRevelationScenario);
    const forgottenKnowledge = forgotten.changeSet.operations.find(operation => operation.type === 'grant-knowledge');
    if (!forgottenKnowledge || forgottenKnowledge.type !== 'grant-knowledge') throw new Error('Knowledge fixture is missing.');
    forgottenKnowledge.knowledge.status = 'forgotten';
    apply(forgotten, 'attempt-forgotten');

    expect(knowledge.listForSubject(forgotten.projectId, 'elias', { accessibleOnly: true })).toEqual([]);
    expect(knowledge.listForSubject(forgotten.projectId, 'elias')).toEqual([
      expect.objectContaining({ accessibility: 'inaccessible' })
    ]);
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
