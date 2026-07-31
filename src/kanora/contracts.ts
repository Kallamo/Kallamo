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
  status: 'active' | 'superseded' | 'retracted';
  evidenceIds: NarrativeId[];
}

export interface NarrativeState {
  entityId: NarrativeId;
  property: string;
  value: unknown;
  effectiveFrom: NarrativePosition;
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
  factIds?: NarrativeId[];
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
  factIds?: NarrativeId[];
}

export interface NarrativeMemory {
  id: NarrativeId;
  subjectId: NarrativeId;
  eventId: NarrativeId;
  summary: string;
  accessibility: KnowledgeAccessibility;
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
  description?: string;
  sourceEventId: NarrativeId;
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
