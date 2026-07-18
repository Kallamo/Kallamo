import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import {
  ChangeSetApplicationError,
  NarrativeChangeSetRepository
} from '../../src/kanora/change-sets';
import { NarrativeEventLedgerRepository } from '../../src/kanora/ledger';
import { possessionTransferScenario, secretRevelationScenario } from '../../src/kanora/scenarios';

const APPLIED_AT = '2026-07-18T18:00:00.000Z';

describe('transactional narrative change sets', () => {
  let directory: string;
  let db: Database.Database;
  let ledger: NarrativeEventLedgerRepository;
  let changeSets: NarrativeChangeSetRepository;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'kanora-change-sets-'));
    db = new Database(join(directory, 'change-sets.db'));
    db.pragma('foreign_keys = ON');
    runDatabaseMigrations(db);
    ledger = new NarrativeEventLedgerRepository(db);
    changeSets = new NarrativeChangeSetRepository(db);
  });

  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test('atomically applies every operation and approves the ledger event', () => {
    ledger.save(possessionTransferScenario);

    const approved = changeSets.apply(
      possessionTransferScenario.projectId,
      possessionTransferScenario.changeSet.event.id,
      { expectedVersion: 1, attemptedAt: APPLIED_AT, attemptId: 'attempt-success' }
    );

    expect(approved).toMatchObject({ status: 'approved', version: 2, decidedAt: APPLIED_AT });
    expect(changeSets.listRecords(possessionTransferScenario.projectId)).toEqual([
      expect.objectContaining({
        type: 'state',
        operationId: possessionTransferScenario.changeSet.operations[0].id,
        payload: possessionTransferScenario.changeSet.operations[0].type === 'set-state'
          ? possessionTransferScenario.changeSet.operations[0].state
          : undefined
      })
    ]);
    expect(changeSets.listAttempts(possessionTransferScenario.projectId, possessionTransferScenario.changeSet.event.id))
      .toEqual([expect.objectContaining({ result: 'applied', resultingVersion: 2 })]);
  });

  test('rolls back canonical records but preserves the proposal and failed attempt', () => {
    ledger.save(secretRevelationScenario);
    db.exec(`
      CREATE TRIGGER fail_knowledge_application
      BEFORE INSERT ON kanora_narrative_records
      WHEN NEW.record_type = 'knowledge'
      BEGIN
        SELECT RAISE(ABORT, 'simulated canonical write failure');
      END;
    `);

    expect(() => changeSets.apply(
      secretRevelationScenario.projectId,
      secretRevelationScenario.changeSet.event.id,
      { expectedVersion: 1, attemptedAt: APPLIED_AT, attemptId: 'attempt-failed' }
    )).toThrow(ChangeSetApplicationError);

    expect(changeSets.listRecords(secretRevelationScenario.projectId)).toEqual([]);
    expect(ledger.get(secretRevelationScenario.projectId, secretRevelationScenario.changeSet.event.id))
      .toEqual({ proposal: secretRevelationScenario, status: 'proposed', version: 1 });
    expect(changeSets.getAttempt(secretRevelationScenario.projectId, 'attempt-failed')).toMatchObject({
      result: 'failed',
      errorCode: 'OPERATION_FAILED',
      failedOperationId: secretRevelationScenario.changeSet.operations.find(operation => operation.type === 'grant-knowledge')?.id
    });
  });

  test('allows a new attempt after a technical failure', () => {
    ledger.save(secretRevelationScenario);
    db.exec(`
      CREATE TRIGGER fail_once BEFORE INSERT ON kanora_narrative_records
      BEGIN SELECT RAISE(ABORT, 'temporary failure'); END;
    `);
    expect(() => changeSets.apply(
      secretRevelationScenario.projectId,
      secretRevelationScenario.changeSet.event.id,
      { expectedVersion: 1, attemptedAt: APPLIED_AT, attemptId: 'attempt-first' }
    )).toThrow();
    db.exec('DROP TRIGGER fail_once');

    const approved = changeSets.apply(
      secretRevelationScenario.projectId,
      secretRevelationScenario.changeSet.event.id,
      { expectedVersion: 1, attemptedAt: '2026-07-18T18:01:00.000Z', attemptId: 'attempt-retry' }
    );

    expect(approved.status).toBe('approved');
    expect(changeSets.listAttempts(secretRevelationScenario.projectId, secretRevelationScenario.changeSet.event.id))
      .toHaveLength(2);
  });

  test('rejects a stale expected version without changing the proposal', () => {
    ledger.save(possessionTransferScenario, { version: 3 });

    expect(() => changeSets.apply(
      possessionTransferScenario.projectId,
      possessionTransferScenario.changeSet.event.id,
      { expectedVersion: 2, attemptedAt: APPLIED_AT, attemptId: 'attempt-stale' }
    )).toThrowError(expect.objectContaining({ code: 'VERSION_CONFLICT' }));

    expect(changeSets.listRecords(possessionTransferScenario.projectId)).toEqual([]);
    expect(ledger.get(possessionTransferScenario.projectId, possessionTransferScenario.changeSet.event.id))
      .toMatchObject({ status: 'proposed', version: 3 });
  });

  test('does not apply an explicitly rejected proposal', () => {
    ledger.save(possessionTransferScenario);
    ledger.setStatus(
      possessionTransferScenario.projectId,
      possessionTransferScenario.changeSet.event.id,
      'rejected',
      APPLIED_AT
    );

    expect(() => changeSets.apply(
      possessionTransferScenario.projectId,
      possessionTransferScenario.changeSet.event.id,
      { expectedVersion: 2, attemptedAt: APPLIED_AT, attemptId: 'attempt-rejected' }
    )).toThrowError(expect.objectContaining({ code: 'EVENT_NOT_PROPOSED' }));
    expect(changeSets.listRecords(possessionTransferScenario.projectId)).toEqual([]);
  });

  test('treats a successful attempt ID as idempotent', () => {
    ledger.save(possessionTransferScenario);
    const options = { expectedVersion: 1, attemptedAt: APPLIED_AT, attemptId: 'attempt-idempotent' };

    const first = changeSets.apply(
      possessionTransferScenario.projectId,
      possessionTransferScenario.changeSet.event.id,
      options
    );
    const second = changeSets.apply(
      possessionTransferScenario.projectId,
      possessionTransferScenario.changeSet.event.id,
      options
    );

    expect(second).toEqual(first);
    expect(changeSets.listRecords(possessionTransferScenario.projectId)).toHaveLength(1);
    expect(changeSets.listAttempts(possessionTransferScenario.projectId, possessionTransferScenario.changeSet.event.id))
      .toHaveLength(1);
  });

  test('isolates canonical records and attempts by workspace', () => {
    const otherWorkspace = structuredClone(possessionTransferScenario);
    otherWorkspace.projectId = 'project-other';
    ledger.save(possessionTransferScenario);
    ledger.save(otherWorkspace);

    changeSets.apply(
      possessionTransferScenario.projectId,
      possessionTransferScenario.changeSet.event.id,
      { expectedVersion: 1, attemptedAt: APPLIED_AT, attemptId: 'shared-attempt' }
    );

    expect(changeSets.listRecords(possessionTransferScenario.projectId)).toHaveLength(1);
    expect(changeSets.listRecords(otherWorkspace.projectId)).toEqual([]);
    expect(changeSets.getAttempt(otherWorkspace.projectId, 'shared-attempt')).toBeUndefined();
  });
});
