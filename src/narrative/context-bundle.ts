import type { NarrativePosition, Perspective } from './contracts';
import type {
  ContextCandidate,
  ContextDecisionOutcome,
  ContextDecisionReason,
  ContextPackage,
  ContextPolicy
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
