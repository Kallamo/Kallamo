import type { EntityFieldDefinition } from '../../../kanora/contracts';

export interface WorldbuildEntity {
  id: string;
  workspaceId?: string | null;
  type: string;
  canonicalName: string;
  aliases?: string[];
  data: Record<string, unknown> & { customFields?: Record<string, unknown> };
}

export type KnowledgeEntryKind = 'knowledge' | 'belief' | 'memory';

export interface WorldbuildKnowledgeEntry {
  id: string;
  kind: KnowledgeEntryKind;
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
}

export interface WorldbuildKnowledgeProjection {
  projectId: string;
  subjectId: string;
  known: WorldbuildKnowledgeEntry[];
  beliefs: WorldbuildKnowledgeEntry[];
  memories: WorldbuildKnowledgeEntry[];
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
