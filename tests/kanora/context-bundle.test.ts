import { describe, expect, test } from 'vitest';
import {
  ContextBundlePlanner,
  type ContextBundleRequest,
  type ScopedContextCandidate
} from '../../src/kanora/context-bundle';

const request: ContextBundleRequest = {
  id: 'bundle-one',
  workspaceId: 'workspace-one',
  query: 'What happens at the gate?',
  through: { sequence: 10 },
  tokenBudget: 12,
  policy: { allowInaccessible: false },
  scopes: [
    { id: 'authority', label: 'Authority', priority: 100, perspective: { access: 'omniscient' } },
    { id: 'subject-a', label: 'Subject A', priority: 80, perspective: { access: 'subjective', focalSubjectId: 'a' } },
    { id: 'subject-b', label: 'Subject B', priority: 60, perspective: { access: 'subjective', focalSubjectId: 'b' } }
  ]
};

function candidate(
  id: string,
  scopeIds: string[],
  tokenCost: number,
  epistemic: ScopedContextCandidate['candidate']['epistemic']
): ScopedContextCandidate {
  return {
    scopeIds,
    candidate: {
      id,
      workspaceId: 'workspace-one',
      source: { type: epistemic.kind === 'canon' ? 'canon' : 'knowledge', id },
      content: id,
      relevance: 1,
      tokenCost,
      epistemic
    }
  };
}

describe('ContextBundlePlanner', () => {
  test('plans separate subject scopes without leaking one subject knowledge into another', () => {
    const result = new ContextBundlePlanner().plan(request, [
      candidate('world', ['authority'], 4, { kind: 'canon', access: 'public' }),
      candidate('a-secret', ['subject-a'], 4, { kind: 'knowledge', subjectId: 'a', accessibility: 'available' }),
      candidate('b-secret', ['subject-b'], 4, { kind: 'knowledge', subjectId: 'b', accessibility: 'available' })
    ]);

    expect(result.scopes.find(scope => scope.scopeId === 'subject-a')?.package.items.map(item => item.candidateId))
      .toEqual(['a-secret']);
    expect(result.scopes.find(scope => scope.scopeId === 'subject-b')?.package.items.map(item => item.candidateId))
      .toEqual(['b-secret']);
  });

  test('spends one global budget in scope priority order', () => {
    const result = new ContextBundlePlanner().plan({ ...request, tokenBudget: 8 }, [
      candidate('world', ['authority'], 4, { kind: 'canon', access: 'public' }),
      candidate('a-secret', ['subject-a'], 4, { kind: 'knowledge', subjectId: 'a', accessibility: 'available' }),
      candidate('b-secret', ['subject-b'], 4, { kind: 'knowledge', subjectId: 'b', accessibility: 'available' })
    ]);

    expect(result.usedTokens).toBe(8);
    expect(result.scopes.find(scope => scope.scopeId === 'subject-b')?.package.items).toEqual([]);
    expect(result.decisions).toContainEqual(expect.objectContaining({
      scopeId: 'subject-b',
      candidateId: 'b-secret',
      outcome: 'warn',
      reason: 'token-budget-exceeded'
    }));
  });

  test('does not spend the budget twice for one candidate shared by scopes', () => {
    const shared = candidate('shared', ['authority', 'subject-a'], 6, { kind: 'canon', access: 'public' });
    const result = new ContextBundlePlanner().plan({ ...request, tokenBudget: 6 }, [shared]);

    expect(result.usedTokens).toBe(6);
    expect(result.scopes.find(scope => scope.scopeId === 'authority')?.package.items).toHaveLength(1);
    expect(result.scopes.find(scope => scope.scopeId === 'subject-a')?.package.items).toHaveLength(1);
  });

  test('honors a scope cap so authority context cannot starve subject context', () => {
    const capped = {
      ...request,
      tokenBudget: 12,
      scopes: request.scopes.map(scope => scope.id === 'authority'
        ? { ...scope, tokenLimit: 4 }
        : scope)
    };
    const result = new ContextBundlePlanner().plan(capped, [
      candidate('world-one', ['authority'], 4, { kind: 'canon', access: 'public' }),
      candidate('world-two', ['authority'], 4, { kind: 'canon', access: 'public' }),
      candidate('a-secret', ['subject-a'], 4, { kind: 'knowledge', subjectId: 'a', accessibility: 'available' })
    ]);

    expect(result.scopes.find(scope => scope.scopeId === 'authority')?.package.items.map(item => item.candidateId))
      .toEqual(['world-one']);
    expect(result.scopes.find(scope => scope.scopeId === 'subject-a')?.package.items.map(item => item.candidateId))
      .toEqual(['a-secret']);
  });
});
