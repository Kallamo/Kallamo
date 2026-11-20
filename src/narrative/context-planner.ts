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