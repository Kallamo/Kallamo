import { NARRATIVE_CONTRACT_VERSION, type NarrativeOperation, type NarrativeProposal } from './contracts';
import { validateNarrativeProposal } from './validation';

const provenance = {
  interpreter: 'model',
  interpreterId: 'narrative-state',
  promptVersion: '1.0',
  schemaVersion: NARRATIVE_CONTRACT_VERSION,
  createdAt: '2026-07-18T12:00:00.000Z'
} as const;

function proposal(id: string, type: NarrativeProposal['changeSet']['event']['type'], description: string, evidenceId: string, operations: NarrativeOperation[]): NarrativeProposal {
  return {
    contractVersion: NARRATIVE_CONTRACT_VERSION,
    id,
    projectId: 'project-example',
    status: 'proposed',
    changeSet: {
      id: `${id}-changes`,
      event: {
        id: `${id}-event`,
        type,
        description,
        sceneId: 'scene-example',
        participants: [{ entityId: 'mara', role: 'actor' }, { entityId: 'elias', role: 'recipient' }],
        position: { sequence: 12 },
        evidenceIds: [evidenceId]
      },
      operations
    },
    evidence: [{ id: evidenceId, originType: 'writing-document', originId: 'chapter-example', excerpt: description }],
    provenance
  };
}

export const possessionTransferScenario = proposal(
  'proposal-transfer',
  'possession-transfer',
  'Mara gives the brass key to Elias.',
  'evidence-transfer',
  [
    {
      id: 'operation-key-owner',
      type: 'set-state',
      evidenceIds: ['evidence-transfer'],
      state: { entityId: 'brass-key', property: 'ownerId', value: 'elias', effectiveFrom: { sequence: 12 } }
    }
  ]
);

export const secretRevelationScenario = proposal(
  'proposal-secret',
  'revelation',
  'Mara tells Elias that the northern gate is unguarded.',
  'evidence-secret',
  [
    {
      id: 'operation-elias-observation',
      type: 'record-observation',
      evidenceIds: ['evidence-secret'],
      observation: { subjectId: 'elias', eventId: 'proposal-secret-event', method: 'participant', confidence: 1 }
    },
    {
      id: 'operation-elias-knowledge',
      type: 'grant-knowledge',
      evidenceIds: ['evidence-secret'],
      knowledge: {
        id: 'knowledge-elias-northern-gate',
        subjectId: 'elias',
        proposition: { subjectId: 'northern-gate', predicate: 'guarded', object: false },
        sourceEventId: 'proposal-secret-event',
        acquisition: 'participant',
        confidence: 1,
        accessibility: 'available',
        status: 'active'
      }
    }
  ]
);

export const deceptiveBeliefScenario = proposal(
  'proposal-deception',
  'deception',
  'Mara lies to Elias that the vault is empty.',
  'evidence-deception',
  [
    {
      id: 'operation-elias-vault-belief',
      type: 'set-belief',
      evidenceIds: ['evidence-deception'],
      belief: {
        id: 'belief-elias-vault-empty',
        subjectId: 'elias',
        proposition: { subjectId: 'vault', predicate: 'empty', object: true },
        sourceEventId: 'proposal-deception-event',
        confidence: 0.9,
        relationToCanon: 'contradicted',
        status: 'active'
      }
    }
  ]
);

export const narrativeScenarios = [possessionTransferScenario, secretRevelationScenario, deceptiveBeliefScenario] as const;

export function verifyNarrativeScenarios(): void {
  for (const scenario of narrativeScenarios) {
    const result = validateNarrativeProposal(scenario);
    if (!result.success) throw new Error(`${scenario.id}: ${result.issues.map(issue => `${issue.path} ${issue.message}`).join('; ')}`);
  }

  const deceptionOperations = deceptiveBeliefScenario.changeSet.operations;
  if (deceptionOperations.some(operation => operation.type === 'assert-fact')) {
    throw new Error('A deceptive statement must not become canonical fact.');
  }
}
