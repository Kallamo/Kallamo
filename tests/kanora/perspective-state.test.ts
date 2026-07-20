import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import { NarrativeChangeSetRepository } from '../../src/kanora/change-sets';
import type { NarrativeOperation, NarrativeProposal } from '../../src/kanora/contracts';
import { NarrativeEventLedgerRepository } from '../../src/kanora/ledger';
import {
  BeliefRepository,
  DynamicRelationshipRepository,
  PerspectiveStateReadError
} from '../../src/kanora/perspective-state';
import { deceptiveBeliefScenario } from '../../src/kanora/scenarios';

const PROJECT_ID = deceptiveBeliefScenario.projectId;

describe('belief and dynamic relationship persistence', () => {
  let directory: string;
  let db: Database.Database;
  let ledger: NarrativeEventLedgerRepository;
  let changeSets: NarrativeChangeSetRepository;
  let beliefs: BeliefRepository;
  let relationships: DynamicRelationshipRepository;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'kanora-perspective-state-'));
    db = new Database(join(directory, 'perspective-state.db'));
    db.pragma('foreign_keys = ON');
    runDatabaseMigrations(db);
    ledger = new NarrativeEventLedgerRepository(db);
    changeSets = new NarrativeChangeSetRepository(db);
    beliefs = new BeliefRepository(db);
    relationships = new DynamicRelationshipRepository(db);
  });

  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test('keeps a contradicted belief separate from canonical fact', () => {
    apply(proposal('canon-vault', 10, {
      id: 'assert-vault-content',
      type: 'assert-fact',
      evidenceIds: ['evidence-canon-vault'],
      fact: {
        id: 'fact-vault-content',
        proposition: { subjectId: 'vault', predicate: 'empty', object: false },
        status: 'active',
        evidenceIds: ['evidence-canon-vault']
      }
    }));
    apply(deceptiveBeliefScenario);

    expect(beliefs.listCurrentForSubject(PROJECT_ID, 'elias')).toEqual([
      expect.objectContaining({
        belief: expect.objectContaining({ proposition: { subjectId: 'vault', predicate: 'empty', object: true } }),
        relationToCanon: 'contradicted'
      })
    ]);
  });

  test('preserves belief history while projecting the latest active belief', () => {
    apply(beliefProposal('belief-initial', 10, 'belief-vault-empty', 'empty', 'active', 0.9));
    apply(beliefProposal('belief-doubt', 20, 'belief-vault-crown', 'crown', 'active', 0.55));

    expect(beliefs.listHistoryForSubject(PROJECT_ID, 'elias')).toHaveLength(2);
    expect(beliefs.listCurrentForSubject(PROJECT_ID, 'elias')).toEqual([
      expect.objectContaining({ belief: expect.objectContaining({ id: 'belief-vault-crown', confidence: 0.55 }) })
    ]);
    expect(beliefs.listCurrentForSubject(PROJECT_ID, 'elias', { throughSequence: 10 })).toEqual([
      expect.objectContaining({ belief: expect.objectContaining({ id: 'belief-vault-empty' }) })
    ]);
  });

  test('recalculates the current canon relation after a later discovery', () => {
    apply(beliefProposal('belief-before-discovery', 10, 'belief-before-discovery', true, 'active', 1, 'contentKnown'));
    apply(proposal('canon-discovered', 20, {
      id: 'assert-vault-not-empty',
      type: 'assert-fact',
      evidenceIds: ['evidence-canon-discovered'],
      fact: {
        id: 'fact-vault-not-empty',
        proposition: { subjectId: 'vault', predicate: 'contentKnown', object: false },
        status: 'active',
        evidenceIds: ['evidence-canon-discovered']
      }
    }));

    const beforeDiscovery = beliefs.listCurrentForSubject(PROJECT_ID, 'elias', { throughSequence: 10 });
    const afterDiscovery = beliefs.listCurrentForSubject(PROJECT_ID, 'elias');

    expect(beforeDiscovery[0].relationToCanon).toBe('unknown');
    expect(afterDiscovery[0].relationToCanon).toBe('contradicted');
  });

  test('removes an abandoned belief from the current projection without deleting history', () => {
    apply(beliefProposal('belief-active', 10, 'belief-active', 'empty', 'active', 1));
    apply(beliefProposal('belief-abandoned', 20, 'belief-abandoned', 'empty', 'abandoned', 0));

    expect(beliefs.listHistoryForSubject(PROJECT_ID, 'elias')).toHaveLength(2);
    expect(beliefs.listCurrentForSubject(PROJECT_ID, 'elias')).toEqual([]);
  });

  test('projects asymmetric and multidimensional relationship state', () => {
    apply(relationshipProposal('mara-trusts-elias', 10, 'mara', 'elias', 'trust', 80));
    apply(relationshipProposal('elias-trusts-mara', 20, 'elias', 'mara', 'trust', 20));
    apply(relationshipProposal('mara-fears-elias', 30, 'mara', 'elias', 'fear', -60));

    expect(relationships.listCurrentFrom(PROJECT_ID, 'mara')).toEqual([
      expect.objectContaining({ relationship: expect.objectContaining({ dimension: 'trust', value: 80 }) }),
      expect.objectContaining({ relationship: expect.objectContaining({ dimension: 'fear', value: -60 }) })
    ]);
    expect(relationships.listCurrentFrom(PROJECT_ID, 'elias')).toEqual([
      expect.objectContaining({ relationship: expect.objectContaining({ dimension: 'trust', value: 20 }) })
    ]);
  });

  test('preserves relationship history and projects the latest value per direction and dimension', () => {
    apply(relationshipProposal('trust-earned', 10, 'mara', 'elias', 'trust', 80));
    apply(relationshipProposal('trust-broken', 20, 'mara', 'elias', 'trust', -25));

    expect(relationships.listHistoryFrom(PROJECT_ID, 'mara')).toHaveLength(2);
    expect(relationships.listCurrentFrom(PROJECT_ID, 'mara')).toEqual([
      expect.objectContaining({ relationship: expect.objectContaining({ value: -25 }) })
    ]);
    expect(relationships.listCurrentFrom(PROJECT_ID, 'mara', { throughSequence: 10 })).toEqual([
      expect.objectContaining({ relationship: expect.objectContaining({ value: 80 }) })
    ]);
  });

  test('rejects relationship values outside the signed range', () => {
    expect(() => ledger.save(relationshipProposal('invalid-trust', 10, 'mara', 'elias', 'trust', 101)))
      .toThrow();
  });

  test('rejects malformed persisted perspective state', () => {
    apply(beliefProposal('belief-malformed', 10, 'belief-malformed', 'empty', 'active', 1));
    db.prepare("UPDATE kanora_narrative_records SET payload_json = '{' WHERE record_type = 'belief'").run();

    expect(() => beliefs.listHistoryForSubject(PROJECT_ID, 'elias'))
      .toThrow(PerspectiveStateReadError);
  });

  test('keeps projected perspective state isolated by workspace', () => {
    const otherProject = relationshipProposal('other-project-trust', 10, 'mara', 'elias', 'trust', 10);
    otherProject.projectId = 'project-other';
    apply(relationshipProposal('main-project-trust', 10, 'mara', 'elias', 'trust', 90));
    apply(otherProject);

    expect(relationships.listCurrentFrom(PROJECT_ID, 'mara')[0].relationship.value).toBe(90);
    expect(relationships.listCurrentFrom('project-other', 'mara')[0].relationship.value).toBe(10);
  });

  function apply(value: NarrativeProposal): void {
    ledger.save(value);
    changeSets.apply(value.projectId, value.changeSet.event.id, {
      expectedVersion: 1,
      attemptedAt: `2026-07-19T00:00:${String(value.changeSet.event.position.sequence).padStart(2, '0')}.000Z`,
      attemptId: `attempt-${value.id}`
    });
  }
});

function beliefProposal(
  id: string,
  sequence: number,
  beliefId: string,
  object: unknown,
  status: 'active' | 'superseded' | 'abandoned',
  confidence: number,
  predicate = 'content'
): NarrativeProposal {
  return proposal(id, sequence, {
    id: `operation-${id}`,
    type: 'set-belief',
    evidenceIds: [`evidence-${id}`],
    belief: {
      id: beliefId,
      subjectId: 'elias',
      proposition: { subjectId: 'vault', predicate, object },
      sourceEventId: `event-${id}`,
      confidence,
      relationToCanon: 'unknown',
      status
    }
  });
}

function relationshipProposal(
  id: string,
  sequence: number,
  sourceEntityId: string,
  targetEntityId: string,
  dimension: string,
  value: number
): NarrativeProposal {
  return proposal(id, sequence, {
    id: `operation-${id}`,
    type: 'set-relationship',
    evidenceIds: [`evidence-${id}`],
    relationship: {
      id: `relationship-${id}`,
      sourceEntityId,
      targetEntityId,
      dimension,
      value,
      sourceEventId: `event-${id}`
    }
  });
}

function proposal(id: string, sequence: number, operation: NarrativeOperation): NarrativeProposal {
  return {
    contractVersion: '1.0',
    id: `proposal-${id}`,
    projectId: PROJECT_ID,
    status: 'proposed',
    changeSet: {
      id: `change-set-${id}`,
      event: {
        id: `event-${id}`,
        type: 'custom',
        description: id,
        participants: [{ entityId: 'mara', role: 'participant' }],
        position: { sequence },
        evidenceIds: [`evidence-${id}`]
      },
      operations: [operation]
    },
    evidence: [{ id: `evidence-${id}`, originType: 'world-action', originId: `origin-${id}` }],
    provenance: { interpreter: 'user', schemaVersion: '1.0', createdAt: '2026-07-19T00:00:00.000Z' }
  };
}
