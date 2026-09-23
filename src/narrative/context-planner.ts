import type { KnowledgeAccessibility, NarrativePosition, Perspective } from './contracts';

export type ContextSourceType = 'canon' | 'state' | 'knowledge' | 'belief' | 'relationship' | 'memory' | 'text';

export interface ContextSourceReference {
  type: ContextSourceType;
  id: string;
}

export type ContextEpistemicMetadata =
  | { kind: 'canon'; access: 'public' | 'restricted'; authorizedSubjectIds?: string[] }
  | { kind: 'knowledge'; subjectId: string; accessibility: KnowledgeAccessibility }
  | { kind: 'belief'; subjectId: string; relationToCanon: 'aligned' | 'contradicted' | 'unknown' }
  | { kind: 'relationship'; subjectIds: string[] }
  | { kind: 'memory'; subjectId: string; accessibility: KnowledgeAccessibility }
  | { kind: 'unclassified'; sensitivity: 'neutral' | 'unknown' };

export interface ContextCandidate {
  id: string;
  workspaceId: string;
  source: ContextSourceReference;
  content: string;
  relevance: number;
  tokenCost: number;
  position?: NarrativePosition;
  epistemic: ContextEpistemicMetadata;
  provenanceIds?: string[];
}

export interface ContextPolicy {
  allowInaccessible: boolean;
}

export interface ContextRequest {
  id: string;
  workspaceId: string;
  query: string;
  perspective: Perspective;
  through: NarrativePosition;
  tokenBudget: number;
  policy: ContextPolicy;
}

export type ContextDecisionOutcome = 'include' | 'exclude' | 'warn';
export type ContextDecisionReason =
  | 'workspace-mismatch'
  | 'future-context'
  | 'missing-focal-subject'
  | 'subject-not-authorized'
  | 'suppressed'
  | 'inaccessible'
  | 'unclassified-sensitive-context'
  | 'subject-knowledge'
  | 'subject-belief'
  | 'subject-relationship'
  | 'neutral-context'
  | 'public-canon'
  | 'omniscient-authority'
  | 'explicit-subject-access'
  | 'explicit-inaccessible-access'
  | 'token-budget-exceeded';

export interface ContextDecision {
  candidateId: string;
  outcome: ContextDecisionOutcome;
  reason: ContextDecisionReason;
}

export interface ContextPackageItem {
  candidateId: string;
  source: ContextSourceReference;
  content: string;
  epistemic: ContextEpistemicMetadata;
  provenanceIds: string[];
}

export interface ContextPackage {
  requestId: string;
  workspaceId: string;
  perspective: Perspective;
  through: NarrativePosition;
  tokenBudget: number;
  usedTokens: number;
  items: ContextPackageItem[];
}

export interface ContextPlanResult {
  decisions: ContextDecision[];
  package: ContextPackage;
}

interface AdmissibleCandidate {
  candidate: ContextCandidate;
  reason: ContextDecisionReason;
}

export class ContextPlanner {
  plan(request: ContextRequest, candidates: ContextCandidate[]): ContextPlanResult {
    const decisions = new Map<string, ContextDecision>();
    const admissible = candidates.flatMap(candidate => {
      const decision = this.evaluate(request, candidate);
      if (decision.outcome === 'exclude') {
        decisions.set(candidate.id, decision);
        return [];
      }
      return [{ candidate, reason: decision.reason }];
    });
    const selected = this.selectWithinBudget(request.tokenBudget, admissible, decisions);

    return {
      decisions: candidates.map(candidate => decisions.get(candidate.id)!),
      package: {
        requestId: request.id,
        workspaceId: request.workspaceId,
        perspective: request.perspective,
        through: request.through,
        tokenBudget: request.tokenBudget,
        usedTokens: selected.reduce((total, item) => total + item.tokenCost, 0),
        items: selected.map(toPackageItem)
      }
    };
  }

  private evaluate(request: ContextRequest, candidate: ContextCandidate): ContextDecision {
    if (candidate.workspaceId !== request.workspaceId) return decision(candidate, 'exclude', 'workspace-mismatch');
    if (isFuture(candidate, request.through)) return decision(candidate, 'exclude', 'future-context');
    if (isInaccessible(candidate) && !request.policy.allowInaccessible) {
      return decision(candidate, 'exclude', 'inaccessible');
    }
    const accessDecision = request.perspective.access === 'omniscient'
      ? decision(candidate, 'include', 'omniscient-authority')
      : request.perspective.access === 'explicit'
        ? evaluateExplicit(request.perspective, candidate)
        : evaluateSubjective(request.perspective, candidate);
    return isInaccessible(candidate) && accessDecision.outcome === 'include'
      ? decision(candidate, 'include', 'explicit-inaccessible-access')
      : accessDecision;
  }

  private selectWithinBudget(
    tokenBudget: number,
    candidates: AdmissibleCandidate[],
    decisions: Map<string, ContextDecision>
  ): ContextCandidate[] {
    let usedTokens = 0;
    const selected: ContextCandidate[] = [];
    [...candidates]
      .sort((left, right) => right.candidate.relevance - left.candidate.relevance)
      .forEach(({ candidate, reason }) => {
        if (usedTokens + candidate.tokenCost > tokenBudget) {
          decisions.set(candidate.id, decision(candidate, 'warn', 'token-budget-exceeded'));
          return;
        }
        usedTokens += candidate.tokenCost;
        selected.push(candidate);
        decisions.set(candidate.id, decision(candidate, 'include', reason));
      });
    return selected;
  }
}

function evaluateSubjective(perspective: Perspective, candidate: ContextCandidate): ContextDecision {
  const subjectId = perspective.focalSubjectId;
  if (!subjectId) return decision(candidate, 'exclude', 'missing-focal-subject');
  const epistemic = candidate.epistemic;
  if (epistemic.kind === 'unclassified') {
    return epistemic.sensitivity === 'neutral'
      ? decision(candidate, 'include', 'neutral-context')
      : decision(candidate, 'exclude', 'unclassified-sensitive-context');
  }
  if (epistemic.kind === 'canon') {
    const isAuthorized = epistemic.access === 'public' || epistemic.authorizedSubjectIds?.includes(subjectId);
    return isAuthorized
      ? decision(candidate, 'include', 'public-canon')
      : decision(candidate, 'exclude', 'subject-not-authorized');
  }
  if (epistemic.kind === 'relationship') {
    return epistemic.subjectIds.includes(subjectId)
      ? decision(candidate, 'include', 'subject-relationship')
      : decision(candidate, 'exclude', 'subject-not-authorized');
  }
  if (epistemic.subjectId !== subjectId) return decision(candidate, 'exclude', 'subject-not-authorized');
  if ('accessibility' in epistemic && epistemic.accessibility === 'suppressed') {
    return decision(candidate, 'exclude', 'suppressed');
  }
  return decision(candidate, 'include', epistemic.kind === 'belief' ? 'subject-belief' : 'subject-knowledge');
}

function evaluateExplicit(perspective: Perspective, candidate: ContextCandidate): ContextDecision {
  const allowed = new Set(perspective.allowedSubjectIds ?? []);
  const epistemic = candidate.epistemic;
  if (epistemic.kind === 'unclassified') {
    return epistemic.sensitivity === 'neutral'
      ? decision(candidate, 'include', 'neutral-context')
      : decision(candidate, 'exclude', 'unclassified-sensitive-context');
  }
  if (epistemic.kind === 'canon') {
    const authorized = epistemic.access === 'public'
      || epistemic.authorizedSubjectIds?.some(subjectId => allowed.has(subjectId));
    return authorized
      ? decision(candidate, 'include', 'explicit-subject-access')
      : decision(candidate, 'exclude', 'subject-not-authorized');
  }
  const subjectIds = epistemic.kind === 'relationship' ? epistemic.subjectIds : [epistemic.subjectId];
  return subjectIds.some(subjectId => allowed.has(subjectId))
    ? decision(candidate, 'include', 'explicit-subject-access')
    : decision(candidate, 'exclude', 'subject-not-authorized');
}

function isFuture(candidate: ContextCandidate, through: NarrativePosition): boolean {
  return candidate.position !== undefined && candidate.position.sequence > through.sequence;
}

function isInaccessible(candidate: ContextCandidate): boolean {
  const epistemic = candidate.epistemic;
  return 'accessibility' in epistemic && epistemic.accessibility === 'inaccessible';
}

function decision(
  candidate: ContextCandidate,
  outcome: ContextDecisionOutcome,
  reason: ContextDecisionReason
): ContextDecision {
  return { candidateId: candidate.id, outcome, reason };
}

function toPackageItem(candidate: ContextCandidate): ContextPackageItem {
  return {
    candidateId: candidate.id,
    source: candidate.source,
    content: candidate.content,
    epistemic: candidate.epistemic,
    provenanceIds: candidate.provenanceIds ?? []
  };
}
