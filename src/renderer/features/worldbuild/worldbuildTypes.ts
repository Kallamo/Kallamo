import type { EntityFieldDefinition } from '../../../narrative/contracts';

export interface WorldbuildEntity {
  id: string;
  workspaceId?: string | null;
  type: string;
  status?: string;
  canonicalName: string;
  aliases?: string[];
  data: Record<string, unknown> & { customFields?: Record<string, unknown> };
}

export type KnowledgeEntryKind = 'knowledge' | 'belief' | 'memory';
export type WorldbuildKnowledgeEntryKind = KnowledgeEntryKind;

/** Where an entry came from, in the same terms the Facts registry uses. */
export interface WorldbuildEntryOrigin {
  kind: 'authored' | 'narrative' | 'occurrence';
  occurrenceId?: string;
  eventEntityId?: string;
  title?: string;
}

export interface WorldbuildKnowledgeEntry {
  id: string;
  kind: WorldbuildKnowledgeEntryKind;
  subjectId: string;
  accessibility: 'available' | 'suppressed' | 'inaccessible';
  origin?: WorldbuildEntryOrigin;
  /** True while another feature owns the record. Occurrence entries are edited in the event. */
  managed?: boolean;
  sourceEventId: string;
  position: { sequence: number; timestamp?: string };
  appliedAt: string;
  aboutId?: string;
  statement?: string;
  summary?: string;
  confidence?: number;
  acquisition?: 'participant' | 'witness' | 'reported' | 'inferred';
  /**
   * What kind of durable record this is, from the shared taxonomy. Null on records written
   * before categories existed, which stay readable and are shown as unclassified.
   */
  category?: string | null;
  /** The story day a memory happened, in the world calendar. Null when nobody set one. */
  occurredOn?: { eraId: string; year: number; month: number; day: number } | null;
  /** Who passed it on. Only carried by reported Knowledge; first-hand records have none. */
  informantIds?: string[];
  relationToCanon?: 'aligned' | 'contradicted' | 'unknown';
  method?: 'participant' | 'witness' | 'reported' | 'inferred';
  eventId?: string;
  factIds?: string[];
}

export interface WorldbuildKnowledgeProjection {
  projectId: string;
  subjectId: string;
  known: WorldbuildKnowledgeEntry[];
  beliefs: WorldbuildKnowledgeEntry[];
  memories: WorldbuildKnowledgeEntry[];
  cards: WorldbuildKnowledgeCard[];
  proposals?: Array<{
    eventId: string;
    description: string;
    excerpt: string;
    createdAt: string;
    operations: Array<{ kind: WorldbuildKnowledgeEntryKind | 'relationship'; summary: string }>;
  }>;
}

export interface WorldbuildKnowledgeCard {
  workspaceId: string;
  cardId: string;
  ownerId: string;
  targetId: string;
  targetName: string;
  targetType: string;
  knownAs?: string;
  status: 'active' | 'forgotten' | 'revoked' | 'superseded';
  audienceType: 'all-members' | 'selected-members';
  selectedMemberIds: string[];
  knownFieldKeys: string[];
  knownRelationships: WorldbuildKnownRelationship[];
  availableRelationships: WorldbuildKnownRelationship[];
  sources: Array<{ sourceType: string; sourceId: string; createdAt: number }>;
  createdAt: number;
  updatedAt: number;
}

export interface WorldbuildKnownRelationship {
  relationshipId: string;
  fromId: string;
  fromName: string;
  relationType: string;
  relationLabel?: string;
  toId: string;
  toName: string;
  metadata: Record<string, unknown>;
  createdAt: number;
}

export interface WorldbuildFact {
  id: string;
  title: string;
  statement: string;
  /** Raw proposition predicate. Equals the title for author-written Facts. */
  predicate?: string;
  /** True when the Fact projects a structured record owned by another feature. */
  managed?: boolean;
  relatedEntityIds: string[];
  sourceEventId: string;
  source: 'manual' | 'narrative';
  position: { sequence: number; timestamp?: string };
  appliedAt: string;
}

export interface WorldbuildEventOccurrenceParticipant {
  entityId: string;
  role: string;
  remember: boolean;
  memoryAccessibility: 'available' | 'suppressed' | 'inaccessible';
  audienceType: 'all-members' | 'selected-members';
  selectedMemberIds: string[];
}

export interface WorldbuildEventOccurrence {
  id: string;
  workspaceId: string;
  eventEntityId: string;
  narrativeEventId: string;
  title: string;
  summary: string;
  startDate: Record<string, unknown> | null;
  endDate: Record<string, unknown> | null;
  participants: WorldbuildEventOccurrenceParticipant[];
  locationIds: string[];
  relatedEntityIds: string[];
  consequences: Record<string, unknown>;
  source: 'user' | 'narrative-state';
  originId: string | null;
  status: 'proposed' | 'approved' | 'rejected';
  createdAt: number;
  updatedAt: number;
}

export interface WorldbuildApi {
  listWorldbuildFieldDefinitions(workspaceId: string, typeId: string): Promise<{
    success: boolean;
    fields?: EntityFieldDefinition[];
    error?: string;
  }>;
  saveWorldbuildFieldDefinition(definition: Omit<Partial<EntityFieldDefinition>, 'options'> & { options?: Array<{ id?: string; label: string }>; clearValuesOnTypeChange?: boolean }): Promise<{
    success: boolean;
    field?: EntityFieldDefinition;
    error?: string;
  }>;
  deleteWorldbuildFieldDefinition(workspaceId: string, fieldId: string): Promise<{
    success: boolean;
    deleted?: boolean;
    error?: string;
  }>;
  updateEntity(id: string, fields: Record<string, unknown>): Promise<{
    success: boolean;
    entity?: WorldbuildEntity;
    error?: string;
  }>;
  getWorldbuildSubjectKnowledge(workspaceId: string, subjectId: string): Promise<{
    success: boolean;
    projection?: WorldbuildKnowledgeProjection;
    error?: string;
  }>;
  saveWorldbuildSubjectEntry(payload: Record<string, unknown>): Promise<{
    success: boolean;
    projection?: WorldbuildKnowledgeProjection;
    error?: string;
  }>;
  deleteWorldbuildSubjectEntry(payload: Record<string, unknown>): Promise<{
    success: boolean;
    projection?: WorldbuildKnowledgeProjection;
    error?: string;
  }>;
  ensureWorldbuildAwareness(payload: Record<string, unknown>): Promise<{ success: boolean; card?: WorldbuildKnowledgeCard; error?: string }>;
  setWorldbuildKnownFields(payload: Record<string, unknown>): Promise<{ success: boolean; card?: WorldbuildKnowledgeCard; error?: string }>;
  markWorldbuildCurrentFieldsKnown(payload: Record<string, unknown>): Promise<{ success: boolean; card?: WorldbuildKnowledgeCard; error?: string }>;
  setWorldbuildKnownRelationships(payload: Record<string, unknown>): Promise<{ success: boolean; card?: WorldbuildKnowledgeCard; error?: string }>;
  removeWorldbuildKnowledgeCard(payload: Record<string, unknown>): Promise<{ success: boolean; error?: string }>;
  setWorldbuildKnowledgeAudience(payload: Record<string, unknown>): Promise<{ success: boolean; card?: WorldbuildKnowledgeCard; error?: string }>;
  listWorldbuildFacts(workspaceId: string): Promise<{ success: boolean; facts?: WorldbuildFact[]; error?: string }>;
  saveWorldbuildFact(payload: Record<string, unknown>): Promise<{ success: boolean; facts?: WorldbuildFact[]; error?: string }>;
  deleteWorldbuildFact(payload: Record<string, unknown>): Promise<{ success: boolean; facts?: WorldbuildFact[]; error?: string }>;
  listWorldbuildEventOccurrences(workspaceId: string, eventEntityId: string): Promise<{
    success: boolean;
    occurrences?: WorldbuildEventOccurrence[];
    error?: string;
  }>;
  createWorldbuildEventOccurrence(payload: Record<string, unknown>): Promise<{
    success: boolean;
    occurrence?: WorldbuildEventOccurrence;
    error?: string;
  }>;
  updateWorldbuildEventOccurrence(payload: Record<string, unknown>): Promise<{
    success: boolean;
    occurrence?: WorldbuildEventOccurrence;
    error?: string;
  }>;
  deleteWorldbuildEventOccurrence(workspaceId: string, eventEntityId: string, occurrenceId: string): Promise<{
    success: boolean;
    deleted?: boolean;
    error?: string;
  }>;
  listEntityLinks(workspaceId: string, relType?: string): Promise<{
    success: boolean;
    links?: Array<{ id: string; fromId: string; toId: string; relType: string }>;
    error?: string;
  }>;
  getWorldbuildSubjectReview(workspaceId: string, subjectId: string): Promise<{
    success: boolean;
    review?: { subjectId: string; proposals: Array<Record<string, unknown>> };
    error?: string;
  }>;
  listWorldbuildReviewCounts(workspaceId: string): Promise<{
    success: boolean;
    counts?: Record<string, { entityUpdates: number; narrative: number }>;
    error?: string;
  }>;
  resolveNarrativeStateEvent(workspaceId: string, eventId: string, decision: 'approved' | 'rejected'): Promise<{
    success: boolean;
    error?: string;
  }>;
  resolveNarrativeStateOperations(workspaceId: string, eventId: string, approvedOperationIds: string[], rejectedOperationIds: string[]): Promise<{
    success: boolean;
    error?: string;
  }>;
  setEntityLink(payload: Record<string, unknown>): Promise<{ success: boolean; error?: string }>;
  updateEntityLink(linkId: string, fields: Record<string, unknown>): Promise<{ success: boolean; error?: string }>;
  removeEntityLink(linkId: string): Promise<{ success: boolean; error?: string }>;
  listWorldbuildEntityTemplates(workspaceId: string): Promise<{ success: boolean; templates?: WorldbuildEntityTemplate[]; error?: string }>;
  saveWorldbuildEntityTemplate(template: WorldbuildEntityTemplate & { workspaceId: string }): Promise<{ success: boolean; template?: WorldbuildEntityTemplate; error?: string }>;
}

export interface WorldbuildTemplateSection {
  id: string;
  label: string;
  kind: 'native' | 'custom';
  hidden?: boolean;
}

export interface WorldbuildEntityTemplate {
  typeId: string;
  displayName: string;
  layout: {
    sections?: WorldbuildTemplateSection[];
    fieldSections?: Record<string, string>;
  };
}

export type Toast = (message: string, tone?: 'success' | 'error' | 'info') => void;
