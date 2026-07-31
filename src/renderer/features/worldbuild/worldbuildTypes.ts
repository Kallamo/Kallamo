import type { EntityFieldDefinition } from '../../../kanora/contracts';

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

export interface WorldbuildKnowledgeEntry {
  id: string;
  kind: WorldbuildKnowledgeEntryKind;
  subjectId: string;
  accessibility: 'available' | 'suppressed' | 'inaccessible';
  sourceEventId: string;
  position: { sequence: number; timestamp?: string };
  appliedAt: string;
  aboutId?: string;
  statement?: string;
  summary?: string;
  confidence?: number;
  acquisition?: 'participant' | 'witness' | 'reported' | 'inferred';
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
  relatedEntityIds: string[];
  sourceEventId: string;
  source: 'manual' | 'narrative';
  position: { sequence: number; timestamp?: string };
  appliedAt: string;
}

export interface WorldbuildApi {
  listWorldbuildFieldDefinitions(workspaceId: string, typeId: string): Promise<{
    success: boolean;
    fields?: EntityFieldDefinition[];
    error?: string;
  }>;
  saveWorldbuildFieldDefinition(definition: Partial<EntityFieldDefinition> & { clearValuesOnTypeChange?: boolean }): Promise<{
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
  getWorldbuildSubjectReview(workspaceId: string, subjectId: string): Promise<{
    success: boolean;
    review?: { subjectId: string; proposals: Array<Record<string, unknown>> };
    error?: string;
  }>;
  listWorldbuildReviewCounts(workspaceId: string): Promise<{
    success: boolean;
    counts?: Record<string, { entityUpdates: number; kanora: number }>;
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
