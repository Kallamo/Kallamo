import {
  allowsSelfReference,
  isDurableKnowledgeCategory,
  isDurableMemoryCategory,
  isGenericPredicate,
  isSceneStatePredicate,
  looksLikeIdentifier,
  movesRelationship,
  normalizeKnowledgeCategory,
  normalizeMemoryCategory,
  normalizeRelationshipCause,
  type KnowledgeCategory,
  type MemoryCategory,
  type RelationshipCause
} from '../../../narrative/narrative-taxonomy';
import type { Proposition, WorldDay } from '../../../narrative/contracts';
import { MIN_MEMORY_SALIENCE } from './memory-relevance';

export interface ExtractedNarrativeEvent {
  type: 'movement' | 'possession-transfer' | 'revelation' | 'deception' | 'discovery' | 'relationship-change' | 'custom' | 'maintenance';
  description: string;
  excerpt: string;
  participantIds: string[];
  participants?: Array<{
    entityId: string;
    role: string;
    audienceType?: 'all-members' | 'selected-members';
    selectedMemberIds?: string[];
  }>;
  worldbuildEventId?: string;
  occurrenceTitle?: string;
  worldDate?: Record<string, unknown>;
  confidence: number;
  operations: ExtractedNarrativeOperation[];
}

export type ExtractedNarrativeOperation =
  | { type: 'fact'; proposition: Proposition; category?: string; confidence: number }
  | { type: 'awareness'; subjectId: string; targetId: string; confidence: number }
  | {
    type: 'knowledge';
    subjectId: string;
    proposition: Proposition;
    category?: string;
    acquisition: 'participant' | 'witness' | 'reported' | 'inferred';
    confidence: number;
    accessibility?: 'available' | 'suppressed' | 'inaccessible';
    informantIds?: string[];
    entryId?: string;
    supersedesId?: string;
    /** Set when the record this corrects or ends was written by a person. */
    authored?: boolean;
    negated?: boolean;
    intent?: 'honest' | 'deceptive';
    sourceRecordId?: string;
    premiseIds?: string[];
    sharedWith?: string[];
    salience?: number;
  }
  | {
    type: 'belief';
    subjectId: string;
    proposition: Proposition;
    category?: string;
    confidence: number;
    entryId?: string;
    supersedesId?: string;
    authored?: boolean;
    attitude?: 'believes' | 'suspects';
    negated?: boolean;
    informantIds?: string[];
    intent?: 'honest' | 'deceptive';
    sourceRecordId?: string;
    premiseIds?: string[];
    /** Second order: the subject thinks this holder holds the proposition. */
    heldById?: string;
    salience?: number;
  }
  | {
    type: 'memory';
    subjectId: string;
    summary: string;
    category?: string;
    salience: number;
    accessibility?: 'available' | 'suppressed' | 'inaccessible';
    relatedEntityIds?: string[];
    /** Set by a caller that already knows the day, such as a dated Event occurrence. */
    occurredOn?: WorldDay;
    supersedesMemoryId?: string;
    /** Other memories this one gathers; they end when it is written. */
    mergesMemoryIds?: string[];
    authored?: boolean;
  }
  | {
    /** A stored record that stops holding, by a ref the story slice resolved. */
    type: 'end';
    kind: 'knowledge' | 'belief' | 'memory';
    subjectId: string;
    recordId: string;
    entryId?: string;
    proposition?: Proposition;
    summary?: string;
    acquisition?: 'participant' | 'witness' | 'reported' | 'inferred';
    status: 'forgotten' | 'revoked' | 'abandoned';
    reason?: string;
    authored?: boolean;
  }
  | {
    type: 'relationship';
    sourceEntityId: string;
    targetEntityId: string;
    dimension: string;
    value: number;
    cause?: string;
    impact?: 'meaningful' | 'significant' | 'drastic';
    title?: string;
    description?: string;
  };

/**
 * Why an extracted operation was not written. These reach the turn diagnostics verbatim, so
 * a campaign that stops recording anything says which rule is doing it instead of going quiet.
 */
export type QualityRejection =
  | 'transient-category'
  | 'missing-category'
  | 'transient-cause'
  | 'missing-cause'
  | 'scene-state-predicate'
  | 'identifier-content'
  | 'empty-statement'
  | 'trivial-statement'
  | 'self-referential'
  | 'self-awareness'
  | 'low-confidence'
  | 'low-salience'
  | 'over-budget';

export interface QualityVerdict {
  accepted: boolean;
  reason?: QualityRejection;
  /** The operation with its taxonomy fields normalized to the closed vocabulary. */
  operation?: ExtractedNarrativeOperation;
}

export interface QualityContext {
  /** Only the interpreter is held to the taxonomy; an author's or an import's records are kept as given. */
  modelAuthored: boolean;
  eventConfidence: number;
}

/** How many durable records one extracted event may write, per kind. */
export const OPERATION_BUDGET: Record<ExtractedNarrativeOperation['type'], number> = {
  fact: 6,
  knowledge: 6,
  belief: 3,
  memory: 3,
  relationship: 4,
  awareness: 12,
  end: 4
};

/** How many events one turn may produce, before anything is written. */
export const EVENT_BUDGET_PER_TURN = 12;

const MIN_KNOWLEDGE_CONFIDENCE = 0.8;
const MIN_RELATIONSHIP_CONFIDENCE = 0.85;
const MIN_STATEMENT_WORDS = 3;
const MIN_STATEMENT_CHARACTERS = 12;

function statementText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return '';
}

function isTrivialStatement(text: string): boolean {
  return text.length < MIN_STATEMENT_CHARACTERS
    || text.split(/\s+/).filter(Boolean).length < MIN_STATEMENT_WORDS;
}

function reject(reason: QualityRejection): QualityVerdict {
  return { accepted: false, reason };
}

function accept(operation: ExtractedNarrativeOperation): QualityVerdict {
  return { accepted: true, operation };
}

/** A raw key, an empty value or a few empty words is debris; only occurrences may store a structured object. */
function assessProposition(proposition: Proposition, modelAuthored: boolean): QualityRejection | undefined {
  if (!proposition || typeof proposition !== 'object') return 'empty-statement';
  if (modelAuthored && isSceneStatePredicate(proposition.predicate)) return 'scene-state-predicate';
  if (proposition.object !== null && typeof proposition.object === 'object') return undefined;
  if (looksLikeIdentifier(proposition.object)) return 'identifier-content';
  const text = statementText(proposition.object);
  if (!text) return 'empty-statement';
  if (text.length < 2) return 'empty-statement';
  // Length is only decisive under a predicate that says nothing on its own. "gate-code:
  // Dawnfall" is a complete claim; "statement: Something" is an empty record wearing one.
  if (modelAuthored && isGenericPredicate(proposition.predicate) && isTrivialStatement(text)) {
    return 'trivial-statement';
  }
  return undefined;
}

export function assessExtractedOperation(
  operation: ExtractedNarrativeOperation,
  context: QualityContext
): QualityVerdict {
  if (operation.type === 'awareness') {
    if (operation.subjectId === operation.targetId) return reject('self-awareness');
    return accept(operation);
  }

  if (operation.type === 'end') {
    const target = operation.kind === 'memory' ? statementText(operation.summary) : operation.proposition;
    return operation.recordId && target ? accept(operation) : reject('empty-statement');
  }

  if (operation.type === 'fact') {
    const propositionIssue = assessProposition(operation.proposition, context.modelAuthored);
    if (propositionIssue) return reject(propositionIssue);
    const category = normalizeKnowledgeCategory(operation.category);
    if (!context.modelAuthored) return accept({ ...operation, ...(category ? { category } : {}) });
    // An occurrence carries its own structured payload and its own lifecycle; it is not a
    // sentence and has nothing to categorize.
    if (operation.proposition.predicate === 'recorded-occurrence') return accept(operation);
    if (!category) return reject('missing-category');
    if (!isDurableKnowledgeCategory(category)) return reject('transient-category');
    return accept({ ...operation, category });
  }

  if (operation.type === 'knowledge' || operation.type === 'belief') {
    const propositionIssue = assessProposition(operation.proposition, context.modelAuthored);
    if (propositionIssue) return reject(propositionIssue);
    const category = normalizeKnowledgeCategory(operation.category);
    if (!context.modelAuthored) return accept({ ...operation, ...(category ? { category } : {}) });
    if (!category) return reject('missing-category');
    if (!isDurableKnowledgeCategory(category)) return reject('transient-category');
    if (operation.subjectId === operation.proposition.subjectId && !allowsSelfReference(category)) {
      return reject('self-referential');
    }
    if (operation.type === 'belief' && operation.heldById === operation.subjectId) return reject('self-referential');
    if (operation.type === 'knowledge' && Number(operation.confidence) < MIN_KNOWLEDGE_CONFIDENCE) {
      return reject('low-confidence');
    }
    return accept({ ...operation, category });
  }

  if (operation.type === 'memory') {
    const summary = String(operation.summary ?? '').trim();
    if (!summary) return reject('empty-statement');
    if (Number(operation.salience) < MIN_MEMORY_SALIENCE) return reject('low-salience');
    const category = normalizeMemoryCategory(operation.category);
    if (!context.modelAuthored) return accept({ ...operation, ...(category ? { category } : {}) });
    // Changing a stored memory (out of reach, back, merged) keeps what it was, category or not.
    if (operation.supersedesMemoryId && !category) return accept(operation);
    if (isTrivialStatement(summary)) return reject('trivial-statement');
    if (!category) return reject('missing-category');
    if (!isDurableMemoryCategory(category)) return reject('transient-category');
    return accept({ ...operation, category });
  }

  const cause = normalizeRelationshipCause(operation.cause);
  if (!context.modelAuthored) return accept({ ...operation, ...(cause ? { cause } : {}) });
  if (!cause) return reject('missing-cause');
  if (!movesRelationship(cause)) return reject('transient-cause');
  if (context.eventConfidence < MIN_RELATIONSHIP_CONFIDENCE) return reject('low-confidence');
  return accept({ ...operation, cause });
}

export interface QualityReview {
  operations: ExtractedNarrativeOperation[];
  rejections: Array<{ type: ExtractedNarrativeOperation['type']; reason: QualityRejection }>;
}

/**
 * The budget applies after the gate, so it only cuts a runaway model response, never legitimate
 * records. What a person authors, such as an occurrence everyone present remembers, is not capped.
 */
export function reviewExtractedOperations(
  operations: ExtractedNarrativeOperation[],
  context: QualityContext
): QualityReview {
  const accepted: ExtractedNarrativeOperation[] = [];
  const rejections: QualityReview['rejections'] = [];
  const used: Partial<Record<ExtractedNarrativeOperation['type'], number>> = {};
  for (const operation of operations) {
    if (!operation || typeof operation !== 'object') continue;
    const verdict = assessExtractedOperation(operation, context);
    if (!verdict.accepted || !verdict.operation) {
      rejections.push({ type: operation.type, reason: verdict.reason ?? 'empty-statement' });
      continue;
    }
    const spent = used[operation.type] ?? 0;
    if (context.modelAuthored && spent >= OPERATION_BUDGET[operation.type]) {
      rejections.push({ type: operation.type, reason: 'over-budget' });
      continue;
    }
    used[operation.type] = spent + 1;
    accepted.push(verdict.operation);
  }
  return { operations: accepted, rejections };
}

export function knowledgeCategoryOf(operation: ExtractedNarrativeOperation): KnowledgeCategory | undefined {
  if (operation.type !== 'fact' && operation.type !== 'knowledge' && operation.type !== 'belief') return undefined;
  return normalizeKnowledgeCategory(operation.category);
}

export function memoryCategoryOf(operation: ExtractedNarrativeOperation): MemoryCategory | undefined {
  return operation.type === 'memory' ? normalizeMemoryCategory(operation.category) : undefined;
}

export function relationshipCauseOf(operation: ExtractedNarrativeOperation): RelationshipCause | undefined {
  return operation.type === 'relationship' ? normalizeRelationshipCause(operation.cause) : undefined;
}
