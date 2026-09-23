import type { NarrativePosition, Perspective } from './contracts';
import {
  ContextPlanner,
  type ContextCandidate,
  type ContextDecisionOutcome,
  type ContextDecisionReason,
  type ContextPackage,
  type ContextPolicy
} from './context-planner';

export type EpistemicAssessmentState =
  | 'confirmed'
  | 'derived'
  | 'evidence-candidate'
  | 'explicitly-unaware'
  | 'undetermined';

export interface EpistemicAssessment {
  subjectId: string;
  targetId: string;
  state: EpistemicAssessmentState;
  sourceIds: string[];
  evidence?: string;
}

export interface ContextScope {
  id: string;
  label: string;
  priority: number;
  perspective: Perspective;
  tokenLimit?: number;
}

export interface ScopedContextCandidate {
  scopeIds: string[];
  candidate: ContextCandidate;
}

export interface ContextBundleRequest {
  id: string;
  workspaceId: string;
  query: string;
  through: NarrativePosition;
  tokenBudget: number;
  policy: ContextPolicy;
  scopes: ContextScope[];
}

export interface ContextBundleDecision {
  scopeId: string;
  candidateId: string;
  outcome: ContextDecisionOutcome;
  reason: ContextDecisionReason;
}

export interface ContextBundleScopeResult {
  scopeId: string;
  label: string;
  priority: number;
  package: ContextPackage;
}

export interface ContextBundleCompositionMetrics {
  uniqueRecords: number;
  sharedRecords: number;
  scopeMemberships: number;
  avoidedDuplicateRenderings: number;
  avoidedContentTokens: number;
  renderedTokens: number;
}

export interface ContextBundleResult {
  requestId: string;
  workspaceId: string;
  through: NarrativePosition;
  tokenBudget: number;
  usedTokens: number;
  decisions: ContextBundleDecision[];
  scopes: ContextBundleScopeResult[];
  composition?: ContextBundleCompositionMetrics;
}

export class ContextBundlePlanner {
  private readonly planner = new ContextPlanner();

  plan(request: ContextBundleRequest, candidates: ScopedContextCandidate[]): ContextBundleResult {
    const paidCandidateIds = new Set<string>();
    let usedTokens = 0;
    const decisions: ContextBundleDecision[] = [];
    const scopes = [...request.scopes]
      .sort((left, right) => right.priority - left.priority)
      .map(scope => {
        const scoped = candidates
          .filter(entry => entry.scopeIds.includes(scope.id))
          .map(entry => paidCandidateIds.has(entry.candidate.id)
            ? { ...entry.candidate, tokenCost: 0 }
            : entry.candidate);
        const remainingBudget = Math.max(0, request.tokenBudget - usedTokens);
        const scopeBudget = scope.tokenLimit === undefined
          ? remainingBudget
          : Math.min(remainingBudget, Math.max(0, Math.floor(scope.tokenLimit)));
        const result = this.planner.plan({
          id: `${request.id}:${scope.id}`,
          workspaceId: request.workspaceId,
          query: request.query,
          perspective: scope.perspective,
          through: request.through,
          tokenBudget: scopeBudget,
          policy: request.policy
        }, scoped);
        result.decisions.forEach(decision => decisions.push({ scopeId: scope.id, ...decision }));
        result.package.items.forEach(item => paidCandidateIds.add(item.candidateId));
        usedTokens += result.package.usedTokens;
        return {
          scopeId: scope.id,
          label: scope.label,
          priority: scope.priority,
          package: {
            ...result.package,
            tokenBudget: request.tokenBudget,
            usedTokens: result.package.items.reduce((total, item) => {
              const original = candidates.find(entry => entry.candidate.id === item.candidateId)?.candidate;
              return total + (original?.tokenCost ?? 0);
            }, 0)
          }
        };
      });

    return {
      requestId: request.id,
      workspaceId: request.workspaceId,
      through: request.through,
      tokenBudget: request.tokenBudget,
      usedTokens,
      decisions,
      scopes
    };
  }
}
