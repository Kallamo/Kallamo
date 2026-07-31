import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { NarrativeOperation } from './contracts';
import {
  NarrativeEventLedgerRepository,
  type NarrativeEventLedgerRecord
} from './ledger';

export type ChangeSetAttemptResult = 'applied' | 'failed';

export interface ChangeSetAttempt {
  id: string;
  workspaceId: string;
  eventId: string;
  expectedVersion: number;
  result: ChangeSetAttemptResult;
  attemptedAt: string;
  resultingVersion?: number;
  failedOperationId?: string;
  errorCode?: string;
  errorMessage?: string;
}

export interface ApplyChangeSetOptions {
  expectedVersion: number;
  attemptedAt: string;
  attemptId?: string;
  operationIds?: string[];
}

export interface AppliedNarrativeRecord {
  type: NarrativeRecordType;
  id: string;
  sourceEventId: string;
  operationId: string;
  payload: unknown;
  appliedAt: string;
}

type NarrativeRecordType =
  | 'fact'
  | 'state'
  | 'observation'
  | 'knowledge'
  | 'belief'
  | 'memory'
  | 'relationship';

interface AttemptRow {
  workspace_id: string;
  attempt_id: string;
  event_id: string;
  expected_version: number;
  result: ChangeSetAttemptResult;
  resulting_version: number | null;
  failed_operation_id: string | null;
  error_code: string | null;
  error_message: string | null;
  attempted_at: string;
}

interface RecordRow {
  record_type: NarrativeRecordType;
  record_id: string;
  source_event_id: string;
  operation_id: string;
  payload_json: string;
  applied_at: string;
}

export class ChangeSetApplicationError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly attempt: ChangeSetAttempt,
    readonly failedOperationId?: string
  ) {
    super(message);
    this.name = 'ChangeSetApplicationError';
  }
}

export class NarrativeChangeSetRepository {
  private readonly ledger: NarrativeEventLedgerRepository;
  private readonly insertRecord;
  private readonly insertAttempt;
  private readonly selectAttempt;
  private readonly selectAttempts;
  private readonly selectRecords;
  private readonly approveEvent;
  private readonly insertAwareness;

  constructor(private readonly db: Database.Database) {
    this.ledger = new NarrativeEventLedgerRepository(db);
    this.insertRecord = db.prepare(`
      INSERT INTO kanora_narrative_records (
        workspace_id, record_type, record_id, subject_id, source_event_id,
        operation_id, payload_json, applied_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.insertAttempt = db.prepare(`
      INSERT INTO kanora_change_set_attempts (
        workspace_id, attempt_id, event_id, expected_version, result,
        resulting_version, failed_operation_id, error_code, error_message, attempted_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    this.selectAttempt = db.prepare(`
      SELECT * FROM kanora_change_set_attempts WHERE workspace_id = ? AND attempt_id = ?
    `);
    this.selectAttempts = db.prepare(`
      SELECT * FROM kanora_change_set_attempts
      WHERE workspace_id = ? AND event_id = ?
      ORDER BY attempted_at, attempt_id
    `);
    this.selectRecords = db.prepare(`
      SELECT record_type, record_id, source_event_id, operation_id, payload_json, applied_at
      FROM kanora_narrative_records WHERE workspace_id = ?
      ORDER BY rowid
    `);
    this.approveEvent = db.prepare(`
      UPDATE kanora_narrative_events
      SET status = 'approved', version = version + 1, decided_at = ?
      WHERE workspace_id = ? AND event_id = ? AND status = 'proposed' AND version = ?
    `);
    this.insertAwareness = db.prepare(`
      INSERT INTO kanora_awareness_records (
        workspace_id, awareness_id, subject_id, target_id, status,
        source_event_id, operation_id, payload_json, applied_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
  }

  apply(workspaceId: string, eventId: string, options: ApplyChangeSetOptions): NarrativeEventLedgerRecord {
    this.validateOptions(options);
    const attemptId = options.attemptId ?? randomUUID();
    const existingAttempt = this.getAttempt(workspaceId, attemptId);
    if (existingAttempt) return this.resolveExistingAttempt(existingAttempt, workspaceId, eventId, options);

    let failedOperationId: string | undefined;
    try {
      return this.db.transaction(() => {
        const record = this.requireApplicableEvent(workspaceId, eventId, options.expectedVersion, attemptId, options.attemptedAt);
        const selectedIds = options.operationIds ? new Set(options.operationIds) : null;
        const operations = selectedIds
          ? record.proposal.changeSet.operations.filter(operation => selectedIds.has(operation.id))
          : record.proposal.changeSet.operations;
        if (selectedIds && operations.length !== selectedIds.size) throw new Error('One or more selected operations do not belong to this event.');
        for (const operation of operations) {
          failedOperationId = operation.id;
          this.writeOperation(workspaceId, eventId, operation, options.attemptedAt);
        }

        const updated = this.approveEvent.run(options.attemptedAt, workspaceId, eventId, options.expectedVersion);
        if (updated.changes !== 1) throw new Error('The event changed while its change set was being applied.');
        this.writeAttempt({
          id: attemptId,
          workspaceId,
          eventId,
          expectedVersion: options.expectedVersion,
          result: 'applied',
          resultingVersion: options.expectedVersion + 1,
          attemptedAt: options.attemptedAt
        });
        return this.ledger.get(workspaceId, eventId)!;
      })();
    } catch (cause) {
      const error = this.normalizeError(cause, failedOperationId);
      const attempt: ChangeSetAttempt = {
        id: attemptId,
        workspaceId,
        eventId,
        expectedVersion: options.expectedVersion,
        result: 'failed',
        attemptedAt: options.attemptedAt,
        ...(failedOperationId ? { failedOperationId } : {}),
        errorCode: error.code,
        errorMessage: error.message
      };
      this.writeAttempt(attempt);
      throw new ChangeSetApplicationError(error.code, error.message, attempt, failedOperationId);
    }
  }

  getAttempt(workspaceId: string, attemptId: string): ChangeSetAttempt | undefined {
    const row = this.selectAttempt.get(workspaceId, attemptId) as AttemptRow | undefined;
    return row ? this.hydrateAttempt(row) : undefined;
  }

  listAttempts(workspaceId: string, eventId: string): ChangeSetAttempt[] {
    return (this.selectAttempts.all(workspaceId, eventId) as AttemptRow[]).map(row => this.hydrateAttempt(row));
  }

  listRecords(workspaceId: string): AppliedNarrativeRecord[] {
    return (this.selectRecords.all(workspaceId) as RecordRow[]).map(row => ({
      type: row.record_type,
      id: row.record_id,
      sourceEventId: row.source_event_id,
      operationId: row.operation_id,
      payload: JSON.parse(row.payload_json) as unknown,
      appliedAt: row.applied_at
    }));
  }

  private requireApplicableEvent(
    workspaceId: string,
    eventId: string,
    expectedVersion: number,
    attemptId: string,
    attemptedAt: string
  ): NarrativeEventLedgerRecord {
    const record = this.ledger.get(workspaceId, eventId);
    if (!record) throw new ChangeSetApplicationError('EVENT_NOT_FOUND', 'Narrative event was not found.', {
      id: attemptId, workspaceId, eventId, expectedVersion, result: 'failed', attemptedAt
    });
    if (record.status !== 'proposed') throw new Error('Only proposed events can be applied.');
    if (record.version !== expectedVersion) throw new Error(`Expected event version ${expectedVersion}, received ${record.version}.`);
    return record;
  }

  private writeOperation(workspaceId: string, eventId: string, operation: NarrativeOperation, appliedAt: string): void {
    if (operation.type === 'grant-awareness') {
      const awareness = operation.awareness;
      this.insertAwareness.run(
        workspaceId,
        awareness.id,
        awareness.subjectId,
        awareness.targetId,
        awareness.status,
        eventId,
        operation.id,
        JSON.stringify(awareness),
        appliedAt
      );
      return;
    }
    const record = getOperationRecord(operation);
    this.insertRecord.run(
      workspaceId,
      record.type,
      record.id,
      record.subjectId,
      eventId,
      operation.id,
      JSON.stringify(record.payload),
      appliedAt
    );
  }

  private writeAttempt(attempt: ChangeSetAttempt): void {
    this.insertAttempt.run(
      attempt.workspaceId,
      attempt.id,
      attempt.eventId,
      attempt.expectedVersion,
      attempt.result,
      attempt.resultingVersion ?? null,
      attempt.failedOperationId ?? null,
      attempt.errorCode ?? null,
      attempt.errorMessage ?? null,
      attempt.attemptedAt
    );
  }

  private resolveExistingAttempt(
    attempt: ChangeSetAttempt,
    workspaceId: string,
    eventId: string,
    options: ApplyChangeSetOptions
  ): NarrativeEventLedgerRecord {
    if (attempt.eventId !== eventId || attempt.expectedVersion !== options.expectedVersion) {
      throw new Error('Attempt ID is already associated with a different change-set application.');
    }
    if (attempt.result === 'failed') {
      throw new ChangeSetApplicationError(attempt.errorCode!, attempt.errorMessage!, attempt, attempt.failedOperationId);
    }
    return this.ledger.get(workspaceId, eventId)!;
  }

  private validateOptions(options: ApplyChangeSetOptions): void {
    if (!Number.isInteger(options.expectedVersion) || options.expectedVersion < 1) {
      throw new RangeError('Expected version must be a positive integer.');
    }
    if (!options.attemptedAt) throw new Error('Application timestamp is required.');
  }

  private normalizeError(cause: unknown, failedOperationId?: string): { code: string; message: string } {
    if (cause instanceof ChangeSetApplicationError) return { code: cause.code, message: cause.message };
    const message = cause instanceof Error ? cause.message : 'Unknown change-set application failure.';
    if (message.startsWith('Only proposed')) return { code: 'EVENT_NOT_PROPOSED', message };
    if (message.startsWith('Expected event version')) return { code: 'VERSION_CONFLICT', message };
    if (message.includes('UNIQUE constraint failed')) return { code: 'RECORD_CONFLICT', message };
    return { code: failedOperationId ? 'OPERATION_FAILED' : 'APPLICATION_FAILED', message };
  }

  private hydrateAttempt(row: AttemptRow): ChangeSetAttempt {
    return {
      id: row.attempt_id,
      workspaceId: row.workspace_id,
      eventId: row.event_id,
      expectedVersion: row.expected_version,
      result: row.result,
      attemptedAt: row.attempted_at,
      ...(row.resulting_version !== null ? { resultingVersion: row.resulting_version } : {}),
      ...(row.failed_operation_id !== null ? { failedOperationId: row.failed_operation_id } : {}),
      ...(row.error_code !== null ? { errorCode: row.error_code } : {}),
      ...(row.error_message !== null ? { errorMessage: row.error_message } : {})
    };
  }
}

function getOperationRecord(operation: NarrativeOperation): {
  type: NarrativeRecordType;
  id: string;
  subjectId: string | null;
  payload: unknown;
} {
  switch (operation.type) {
    case 'assert-fact': return { type: 'fact', id: operation.fact.id, subjectId: null, payload: operation.fact };
    case 'set-state': return { type: 'state', id: operation.id, subjectId: null, payload: operation.state };
    case 'record-observation': return { type: 'observation', id: operation.id, subjectId: operation.observation.subjectId, payload: operation.observation };
    case 'grant-awareness': throw new Error('Awareness records use their dedicated temporal store.');
    case 'grant-knowledge': return { type: 'knowledge', id: operation.knowledge.id, subjectId: operation.knowledge.subjectId, payload: operation.knowledge };
    case 'set-belief': return { type: 'belief', id: operation.belief.id, subjectId: operation.belief.subjectId, payload: operation.belief };
    case 'record-memory': return { type: 'memory', id: operation.memory.id, subjectId: operation.memory.subjectId, payload: operation.memory };
    case 'set-relationship': return { type: 'relationship', id: operation.relationship.id, subjectId: operation.relationship.sourceEntityId, payload: operation.relationship };
  }
}
