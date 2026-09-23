import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import { NarrativeChangeSetRepository } from '../../src/narrative/change-sets';
import type { KnowledgeAccessibility, NarrativeOperation, NarrativeProposal } from '../../src/narrative/contracts';
import { NarrativeEventLedgerRepository } from '../../src/narrative/ledger';
import { SubjectKnowledgeProjectionRepository } from '../../src/narrative/subject-knowledge';
import { openTestDatabase } from '../sqlite-test-database';

const PROJECT_ID = 'project-example';

describe('subject-scoped Knowledge projection', () => {
  let directory: string;
  let db: Database.Database;
  let ledger: NarrativeEventLedgerRepository;
  let changeSets: NarrativeChangeSetRepository;
  let projection: SubjectKnowledgeProjectionRepository;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'narrative-subject-knowledge-'));
    db = openTestDatabase(join(directory, 'subject-knowledge.db'));
    db.pragma('foreign_keys = ON');
    runDatabaseMigrations(db);
    ledger = new NarrativeEventLedgerRepository(db);
    changeSets = new NarrativeChangeSetRepository(db);
    projection = new SubjectKnowledgeProjectionRepository(db);
  });

  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test('combines known facts, beliefs, and memories for one sheet subject', () => {
    apply(subjectProposal('mara-state', 10, 'mara', 'available'));

    const state = projection.get(PROJECT_ID, 'mara');

    expect(state.known).toHaveLength(1);
    expect(state.beliefs).toHaveLength(1);
    expect(state.memories).toHaveLength(1);
    expect(state).toMatchObject({ projectId: PROJECT_ID, subjectId: 'mara' });
  });

  test('does not turn member knowledge into collective Faction knowledge', () => {
    apply(subjectProposal('member-state', 10, 'mara', 'available'));
    apply(subjectProposal('faction-state', 20, 'ashen-circle', 'available'));

    const faction = projection.get(PROJECT_ID, 'ashen-circle');

    expect(faction.known).toHaveLength(1);
    expect(faction.known[0].knowledge.subjectId).toBe('ashen-circle');
    expect(faction.memories[0].memory.subjectId).toBe('ashen-circle');
  });

  test('filters unavailable records for a subject perspective', () => {
    apply(subjectProposal('suppressed-state', 10, 'vharos', 'suppressed'));

    const complete = projection.get(PROJECT_ID, 'vharos');
    const accessible = projection.get(PROJECT_ID, 'vharos', { accessibleOnly: true });

    expect(complete.known).toHaveLength(1);
    expect(complete.memories).toHaveLength(1);
    expect(accessible.known).toEqual([]);
    expect(accessible.memories).toEqual([]);
    expect(accessible.beliefs).toHaveLength(1);
  });

  test('excludes records beyond the requested narrative position', () => {
    apply(subjectProposal('early-state', 10, 'mara', 'available'));
    apply(subjectProposal('future-state', 20, 'mara', 'available', 'future'));

    const state = projection.get(PROJECT_ID, 'mara', { throughSequence: 10 });

    expect(state.known).toHaveLength(1);
    expect(state.memories).toHaveLength(1);
    expect(state.beliefs).toHaveLength(1);
  });

  function apply(value: NarrativeProposal): void {
    ledger.save(value);
    changeSets.apply(value.projectId, value.changeSet.event.id, {
      expectedVersion: 1,
      attemptedAt: `2026-07-19T12:00:${String(value.changeSet.event.position.sequence).padStart(2, '0')}.000Z`,
      attemptId: `attempt-${value.id}`
    });
  }
});

function subjectProposal(
  id: string,
  sequence: number,
  subjectId: string,
  accessibility: KnowledgeAccessibility,
  predicate = 'gate-state'
): NarrativeProposal {
  const eventId = `event-${id}`;
  const evidenceId = `evidence-${id}`;
  const proposition = { subjectId: 'northern-gate', predicate, object: 'sealed' };
  const operations: NarrativeOperation[] = [
    {
      id: `knowledge-operation-${id}`,
      type: 'grant-knowledge',
      evidenceIds: [evidenceId],
      knowledge: {
        id: `knowledge-${id}`,
        subjectId,
        proposition,
        sourceEventId: eventId,
        acquisition: 'reported',
        confidence: 0.9,
        accessibility,
        status: 'active'
      }
    },
    {
      id: `belief-operation-${id}`,
      type: 'set-belief',
      evidenceIds: [evidenceId],
      belief: {
        id: `belief-${id}`,
        subjectId,
        proposition,
        sourceEventId: eventId,
        confidence: 0.8,
        relationToCanon: 'unknown',
        status: 'active'
      }
    },
    {
      id: `memory-operation-${id}`,
      type: 'record-memory',
      evidenceIds: [evidenceId],
      memory: {
        id: `memory-${id}`,
        subjectId,
        eventId,
        summary: `${subjectId} learned that the northern gate is sealed.`,
        accessibility
      }
    }
  ];
  return {
    contractVersion: '1.0',
    id: `proposal-${id}`,
    projectId: PROJECT_ID,
    status: 'proposed',
    changeSet: {
      id: `change-set-${id}`,
      event: {
        id: eventId,
        type: 'revelation',
        description: id,
        participants: [{ entityId: subjectId, role: 'recipient' }],
        position: { sequence },
        evidenceIds: [evidenceId]
      },
      operations
    },
    evidence: [{ id: evidenceId, originType: 'world-action', originId: `origin-${id}` }],
    provenance: { interpreter: 'user', schemaVersion: '1.0', createdAt: '2026-07-19T12:00:00.000Z' }
  };
}
