import type { KnowledgeCategory, MemoryCategory, RelationshipCause } from './narrative-taxonomy';

export const KANORA_CONTRACT_VERSION = '1.0' as const;

export type KanoraContractVersion = typeof KANORA_CONTRACT_VERSION;
export type NarrativeId = string;
export type Confidence = number;
export type KnowledgeAccessibility = 'available' | 'suppressed' | 'inaccessible';

export type EntityKind = 'agent' | 'group' | 'object' | 'location' | 'species' | 'event' | 'concept';
export type EntityCapability =
  | 'appearance'
  | 'personality'
  | 'inventory'
  | 'relationships'
  | 'knowledge'
  | 'beliefs'
  | 'memory'
  | 'perspective';

export interface EntityReference {
  id: NarrativeId;
  projectId: NarrativeId;
  kind: EntityKind;
  typeId: string;
  name: string;
  aliases: string[];
  capabilities: EntityCapability[];
}

export type EntityFieldType =
  | 'short-text'
  | 'long-text'
  | 'number'
  | 'range'
  | 'boolean'
  | 'single-choice'
  | 'multiple-choice'
  | 'entity-reference'
  | 'entity-reference-list';

export interface EntityFieldOption {
  id: string;
  label: string;
}

export interface EntityFieldConstraints {
  min?: number;
  max?: number;
  step?: number;
}

export interface EntityFieldDefinition {
  id: NarrativeId;
  projectId: NarrativeId;
  typeId: string;
  key: string;
  label: string;
  valueType: EntityFieldType;
  options?: EntityFieldOption[];
  constraints?: EntityFieldConstraints;
  defaultValue?: unknown;
  required: boolean;
  position: number;
  aiAccess: 'read-write' | 'read-only' | 'hidden';
  aiGuidance?: string;
}

export interface NarrativePosition {
  sequence: number;
  timestamp?: string;
}

export interface Proposition {
  subjectId: NarrativeId;
  predicate: string;
  object: unknown;
}

export interface EvidenceReference {
  id: NarrativeId;
  originType: 'chat-message' | 'writing-document' | 'world-action' | 'worldbuild-update' | 'import';
  originId: NarrativeId;
  excerpt?: string;
}

export interface Provenance {
  interpreter: 'user' | 'deterministic' | 'model';
  interpreterId?: string;
  promptVersion?: string;
  schemaVersion: KanoraContractVersion;
  createdAt: string;
}

export interface NarrativeFact {
  id: NarrativeId;
  referenceId?: NarrativeId;
  proposition: Proposition;
  relatedEntityIds?: NarrativeId[];
  /** What kind of durable statement this is. Absent on records written before the taxonomy. */
  category?: KnowledgeCategory;
  status: 'active' | 'superseded' | 'retracted';
  evidenceIds: NarrativeId[];
}

export interface NarrativeState {
  entityId: NarrativeId;
  property: string;
  value: unknown;
  effectiveFrom: NarrativePosition;
  /** Set only when the entity it describes was deleted. */
  status?: 'retired';
}

export interface Observation {
  subjectId: NarrativeId;
  eventId: NarrativeId;
  method: 'participant' | 'witness' | 'reported' | 'inferred';
  confidence: Confidence;
  factIds?: NarrativeId[];
}

export interface Awareness {
  id: NarrativeId;
  subjectId: NarrativeId;
  targetId: NarrativeId;
  status: 'active' | 'forgotten' | 'revoked' | 'superseded';
  sourceEventId: NarrativeId;
}

export interface Knowledge {
  id: NarrativeId;
  entryId?: NarrativeId;
  subjectId: NarrativeId;
  proposition: Proposition;
  sourceEventId: NarrativeId;
  acquisition: Observation['method'];
  confidence: Confidence;
  accessibility: KnowledgeAccessibility;
  status: 'active' | 'forgotten' | 'revoked' | 'superseded';
  /**
   * What kind of knowledge this is. Model-authored records must carry a durable category to
   * be stored at all; the field stays optional so records written before the taxonomy, and
   * hand-authored entries, remain valid.
   */
  category?: KnowledgeCategory;
  factIds?: NarrativeId[];
  /**
   * Who passed this on, when the subject did not find it out for themselves. Only
   * meaningful for reported acquisition: a first-hand observation has no teller. Knowing
   * the teller is what makes a chain of hearsay traceable and a lie attributable.
   */
  informantIds?: NarrativeId[];
}

export interface Belief {
  id: NarrativeId;
  entryId?: NarrativeId;
  subjectId: NarrativeId;
  proposition: Proposition;
  sourceEventId: NarrativeId;
  confidence: Confidence;
  relationToCanon: 'aligned' | 'contradicted' | 'uncertain' | 'unknown';
  status: 'active' | 'superseded' | 'abandoned';
  category?: KnowledgeCategory;
  factIds?: NarrativeId[];
}

export interface NarrativeMemory {
  id: NarrativeId;
  subjectId: NarrativeId;
  eventId: NarrativeId;
  summary: string;
  accessibility: KnowledgeAccessibility;
  /** Why this is worth remembering. A routine memory is not stored. */
  category?: MemoryCategory;
  status?: 'active' | 'superseded' | 'forgotten';
  supersedesMemoryId?: NarrativeId;
  relatedEntityIds?: NarrativeId[];
}

export interface RelationshipState {
  id: NarrativeId;
  sourceEntityId: NarrativeId;
  targetEntityId: NarrativeId;
  dimension: string;
  title?: string;
  value: number;
  previousValue?: number;
  description?: string;
  /** What in the scene actually moved the bar. Courtesy and banter are not causes. */
  cause?: RelationshipCause;
  sourceEventId: NarrativeId;
  /** Set only when an entity on either side was deleted, or a merge made both sides one entity. */
  status?: 'retired';
}

export interface Perspective {
  focalSubjectId?: NarrativeId;
  access: 'subjective' | 'omniscient' | 'explicit';
  allowedSubjectIds?: NarrativeId[];
}

export interface Scene {
  id: NarrativeId;
  projectId: NarrativeId;
  status: 'active' | 'completed';
  locationId?: NarrativeId;
  participantIds: NarrativeId[];
  possibleObserverIds: NarrativeId[];
  perspective: Perspective;
  position: NarrativePosition;
  origin?: Omit<EvidenceReference, 'id' | 'excerpt'>;
}

export type EventType =
  | 'movement'
  | 'possession-transfer'
  | 'revelation'
  | 'deception'
  | 'discovery'
  | 'relationship-change'
  | 'custom';

export interface EventParticipant {
  entityId: NarrativeId;
  role: string;
}

export interface NarrativeEvent {
  id: NarrativeId;
  type: EventType;
  description: string;
  sceneId?: NarrativeId;
  locationId?: NarrativeId;
  participants: EventParticipant[];
  position: NarrativePosition;
  evidenceIds: NarrativeId[];
}

interface OperationBase {
  id: NarrativeId;
  evidenceIds: NarrativeId[];
}

export type NarrativeOperation =
  | (OperationBase & { type: 'assert-fact'; fact: NarrativeFact })
  | (OperationBase & { type: 'set-state'; state: NarrativeState })
  | (OperationBase & { type: 'record-observation'; observation: Observation })
  | (OperationBase & { type: 'grant-awareness'; awareness: Awareness })
  | (OperationBase & { type: 'grant-knowledge'; knowledge: Knowledge })
  | (OperationBase & { type: 'set-belief'; belief: Belief })
  | (OperationBase & { type: 'record-memory'; memory: NarrativeMemory })
  | (OperationBase & { type: 'set-relationship'; relationship: RelationshipState });

export interface NarrativeChangeSet {
  id: NarrativeId;
  event: NarrativeEvent;
  operations: NarrativeOperation[];
}

export interface NarrativeProposal {
  contractVersion: KanoraContractVersion;
  id: NarrativeId;
  projectId: NarrativeId;
  status: 'proposed';
  changeSet: NarrativeChangeSet;
  evidence: EvidenceReference[];
  provenance: Provenance;
}

export interface NarrativeProjection {
  projectId: NarrativeId;
  through: NarrativePosition;
  facts: NarrativeFact[];
  states: NarrativeState[];
  awareness: Awareness[];
  knowledge: Knowledge[];
  beliefs: Belief[];
  relationships: RelationshipState[];
}
