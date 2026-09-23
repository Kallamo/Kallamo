import { describe, expect, test } from 'vitest';
import {
  ContextPlanner,
  type ContextCandidate,
  type ContextRequest
} from '../../src/narrative/context-planner';

const planner = new ContextPlanner();
const secret: ContextCandidate = {
  id: 'secret-northern-gate',
  workspaceId: 'project-example',
  source: { type: 'knowledge', id: 'knowledge-elias-northern-gate' },
  content: 'The northern gate is unguarded.',
  relevance: 1,
  tokenCost: 8,
  position: { sequence: 20 },
  epistemic: {
    kind: 'knowledge',
    subjectId: 'elias',
    accessibility: 'available'
  }
};

describe('Context Planner epistemic filtering', () => {
  test('includes a secret for the subject who knows it', () => {
    const result = planner.plan(request({ focalSubjectId: 'elias' }), [secret]);

    expect(result.package.items).toEqual([expect.objectContaining({ candidateId: secret.id })]);
    expect(result.decisions[0]).toMatchObject({ outcome: 'include', reason: 'subject-knowledge' });
  });

  test('excludes a semantically relevant secret from another subject', () => {
    const result = planner.plan(request({ focalSubjectId: 'mara' }), [secret]);

    expect(result.package.items).toEqual([]);
    expect(result.decisions[0]).toMatchObject({ outcome: 'exclude', reason: 'subject-not-authorized' });
  });

  test('allows an omniscient narrator to receive relevant available knowledge', () => {
    const result = planner.plan(request({ access: 'omniscient' }), [secret]);

    expect(result.package.items).toHaveLength(1);
    expect(result.decisions[0]).toMatchObject({ outcome: 'include', reason: 'omniscient-authority' });
  });

  test('requires explicit policy even for an omniscient narrator to receive inaccessible knowledge', () => {
    const inaccessible = structuredClone(secret);
    inaccessible.epistemic = { kind: 'knowledge', subjectId: 'elias', accessibility: 'inaccessible' };

    const denied = planner.plan(request({ access: 'omniscient' }), [inaccessible]);
    const allowed = planner.plan(request({ access: 'omniscient', allowInaccessible: true }), [inaccessible]);
    const wrongSubject = planner.plan(request({ focalSubjectId: 'mara', allowInaccessible: true }), [inaccessible]);

    expect(denied.decisions[0]).toMatchObject({ outcome: 'exclude', reason: 'inaccessible' });
    expect(allowed.decisions[0]).toMatchObject({ outcome: 'include', reason: 'explicit-inaccessible-access' });
    expect(wrongSubject.decisions[0]).toMatchObject({ outcome: 'exclude', reason: 'subject-not-authorized' });
  });

  test('limits explicit perspective to its declared subjects', () => {
    const allowed = planner.plan(request({ access: 'explicit', allowedSubjectIds: ['elias'] }), [secret]);
    const denied = planner.plan(request({ access: 'explicit', allowedSubjectIds: ['mara'] }), [secret]);

    expect(allowed.decisions[0]).toMatchObject({ outcome: 'include', reason: 'explicit-subject-access' });
    expect(denied.decisions[0]).toMatchObject({ outcome: 'exclude', reason: 'subject-not-authorized' });
  });

  test('keeps a focal subject belief without exposing contradictory canon', () => {
    const belief: ContextCandidate = {
      ...secret,
      id: 'belief-empty-vault',
      source: { type: 'belief', id: 'belief-empty-vault' },
      content: 'Elias believes the vault is empty.',
      epistemic: { kind: 'belief', subjectId: 'elias', relationToCanon: 'contradicted' }
    };
    const hiddenCanon: ContextCandidate = {
      ...secret,
      id: 'canon-vault-not-empty',
      source: { type: 'canon', id: 'fact-vault-not-empty' },
      content: 'The vault is not empty.',
      epistemic: { kind: 'canon', access: 'restricted', authorizedSubjectIds: [] }
    };

    const result = planner.plan(request({ focalSubjectId: 'elias' }), [belief, hiddenCanon]);

    expect(result.package.items.map(item => item.candidateId)).toEqual(['belief-empty-vault']);
    expect(result.decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ candidateId: belief.id, outcome: 'include', reason: 'subject-belief' }),
      expect.objectContaining({ candidateId: hiddenCanon.id, outcome: 'exclude', reason: 'subject-not-authorized' })
    ]));
  });

  test('excludes candidates from the future narrative position', () => {
    const future = { ...secret, position: { sequence: 60 } };

    const result = planner.plan(request({ focalSubjectId: 'elias', throughSequence: 40 }), [future]);

    expect(result.decisions[0]).toMatchObject({ outcome: 'exclude', reason: 'future-context' });
  });

  test('fails safely for unclassified subjective context unless it is explicitly neutral', () => {
    const unknown: ContextCandidate = {
      ...secret,
      id: 'unclassified-draft',
      source: { type: 'text', id: 'chunk-draft' },
      epistemic: { kind: 'unclassified', sensitivity: 'unknown' }
    };
    const neutral: ContextCandidate = {
      ...unknown,
      id: 'neutral-style-guide',
      source: { type: 'text', id: 'chunk-style-guide' },
      epistemic: { kind: 'unclassified', sensitivity: 'neutral' }
    };

    const result = planner.plan(request({ focalSubjectId: 'elias' }), [unknown, neutral]);

    expect(result.package.items.map(item => item.candidateId)).toEqual(['neutral-style-guide']);
    expect(result.decisions[0]).toMatchObject({ outcome: 'exclude', reason: 'unclassified-sensitive-context' });
  });

  test('applies workspace isolation before relevance and token-budget selection', () => {
    const otherWorkspace = { ...secret, id: 'other-workspace', workspaceId: 'project-other', relevance: 2 };
    const secondary = { ...secret, id: 'secondary', relevance: 0.5, tokenCost: 6 };

    const result = planner.plan(request({ focalSubjectId: 'elias', tokenBudget: 10 }), [otherWorkspace, secondary, secret]);

    expect(result.package.items.map(item => item.candidateId)).toEqual(['secret-northern-gate']);
    expect(result.decisions).toEqual(expect.arrayContaining([
      expect.objectContaining({ candidateId: 'other-workspace', reason: 'workspace-mismatch' }),
      expect.objectContaining({ candidateId: 'secondary', outcome: 'warn', reason: 'token-budget-exceeded' })
    ]));
  });
});

function request(overrides: {
  access?: 'subjective' | 'omniscient' | 'explicit';
  focalSubjectId?: string;
  allowInaccessible?: boolean;
  allowedSubjectIds?: string[];
  throughSequence?: number;
  tokenBudget?: number;
}): ContextRequest {
  return {
    id: 'request-example',
    workspaceId: 'project-example',
    query: 'Continue the scene.',
    perspective: {
      access: overrides.access ?? 'subjective',
      ...(overrides.focalSubjectId ? { focalSubjectId: overrides.focalSubjectId } : {}),
      ...(overrides.allowedSubjectIds ? { allowedSubjectIds: overrides.allowedSubjectIds } : {})
    },
    through: { sequence: overrides.throughSequence ?? 40 },
    tokenBudget: overrides.tokenBudget ?? 100,
    policy: { allowInaccessible: overrides.allowInaccessible ?? false }
  };
}
