import type Database from 'better-sqlite3';
import type { NarrativePosition, Perspective } from '../../../kanora/contracts';
import {
  ContextPlanner,
  type ContextCandidate,
  type ContextEpistemicMetadata,
  type ContextPlanResult,
  type ContextSourceType
} from '../../../kanora/context-planner';
import { NarrativeSceneRepository } from '../../../kanora/scenes';

export type RetrievedContextKind = 'workspace-text' | 'workspace-memory' | 'worldbuild-canon';

export interface RetrievedContextItem {
  id: string;
  kind: RetrievedContextKind;
  source: string;
  content: string;
  relevance?: number;
  entityIds?: string[];
  provenanceIds?: string[];
}

export interface PlanChatContextInput {
  requestId: string;
  workspaceId: string;
  query: string;
  tokenBudget: number;
  items: RetrievedContextItem[];
}

export interface PlannedChatContext {
  plan: ContextPlanResult;
  context: string;
}

interface EntityRow {
  id: string;
  type: string;
  canonicalName: string;
  lore: string | null;
  data: string | null;
  status: string;
}

interface FieldRow {
  type_id: string;
  field_key: string;
  label: string;
  ai_access: string;
}

interface RecordRow {
  record_type: 'knowledge' | 'belief' | 'memory';
  record_id: string;
  subject_id: string;
  source_event_id: string;
  payload_json: string;
  narrative_sequence: number;
}

export class KallamoKanoraChatContext {
  private readonly planner = new ContextPlanner();
  private readonly scenes: NarrativeSceneRepository;

  constructor(
    private readonly db: Database.Database,
    private readonly estimateTokens: (text: string) => number
  ) {
    this.scenes = new NarrativeSceneRepository(db);
  }

  plan(input: PlanChatContextInput): PlannedChatContext {
    const perspectiveState = this.resolvePerspective(input.workspaceId);
    const linkedChunkIds = this.resolveLinkedChunkIds(input.workspaceId, input.items);
    const retrieved = input.items.flatMap(item => {
      if (item.kind === 'worldbuild-canon' && item.entityIds?.length) return [];
      return [this.toRetrievedCandidate(input.workspaceId, item, linkedChunkIds, perspectiveState.hasActiveScene)];
    });
    const entityIds = this.resolveRelevantEntityIds(input.workspaceId, input.items, perspectiveState.perspective);
    const structured = [
      ...this.loadEntityCandidates(input.workspaceId, entityIds),
      ...this.loadRelationCandidates(input.workspaceId, entityIds),
      ...this.loadEpistemicCandidates(input.workspaceId, entityIds)
    ];
    const candidates = deduplicateCandidates([...retrieved, ...structured]);
    const plan = this.planner.plan({
      id: input.requestId,
      workspaceId: input.workspaceId,
      query: input.query,
      perspective: perspectiveState.perspective,
      through: perspectiveState.through,
      tokenBudget: Math.max(0, Math.floor(input.tokenBudget)),
      policy: { allowInaccessible: false }
    }, candidates);
    return { plan, context: composeContext(plan) };
  }

  private resolvePerspective(workspaceId: string): {
    perspective: Perspective;
    through: NarrativePosition;
    hasActiveScene: boolean;
  } {
    const scene = this.scenes.getActive(workspaceId);
    if (scene) return { perspective: scene.perspective, through: scene.position, hasActiveScene: true };
    const row = this.db.prepare(`
      SELECT COALESCE(MAX(narrative_sequence), 0) AS sequence
      FROM kanora_narrative_events WHERE workspace_id = ?
    `).get(workspaceId) as { sequence: number };
    return {
      perspective: { access: 'explicit', allowedSubjectIds: [] },
      through: { sequence: row.sequence },
      hasActiveScene: false
    };
  }

  private resolveRelevantEntityIds(
    workspaceId: string,
    items: RetrievedContextItem[],
    perspective: Perspective
  ): string[] {
    const ids = new Set(items.flatMap(item => item.entityIds ?? []));
    const chunkIds = items.map(item => item.id).filter(Boolean);
    if (chunkIds.length) {
      const placeholders = chunkIds.map(() => '?').join(', ');
      const rows = this.db.prepare(`
        SELECT DISTINCT ct.entity AS id
        FROM chunk_tags AS ct
        JOIN entities AS e ON e.id = ct.entity AND e.workspaceId = ?
        WHERE ct.chunkId IN (${placeholders})
      `).all(workspaceId, ...chunkIds) as Array<{ id: string }>;
      rows.forEach(row => ids.add(row.id));
    }
    if (perspective.focalSubjectId) ids.add(perspective.focalSubjectId);
    perspective.allowedSubjectIds?.forEach(id => ids.add(id));
    return [...ids];
  }

  private resolveLinkedChunkIds(workspaceId: string, items: RetrievedContextItem[]): Set<string> {
    const chunkIds = items.map(item => item.id).filter(Boolean);
    if (!chunkIds.length) return new Set();
    const placeholders = chunkIds.map(() => '?').join(', ');
    const rows = this.db.prepare(`
      SELECT DISTINCT ct.chunkId AS id
      FROM chunk_tags AS ct
      JOIN entities AS e ON e.id = ct.entity AND e.workspaceId = ?
      WHERE ct.chunkId IN (${placeholders})
    `).all(workspaceId, ...chunkIds) as Array<{ id: string }>;
    return new Set(rows.map(row => row.id));
  }

  private toRetrievedCandidate(
    workspaceId: string,
    item: RetrievedContextItem,
    linkedChunkIds: Set<string>,
    hasActiveScene: boolean
  ): ContextCandidate {
    const epistemic: ContextEpistemicMetadata = item.kind === 'worldbuild-canon'
      ? { kind: 'canon', access: 'public' }
      : {
        kind: 'unclassified',
        sensitivity: !hasActiveScene || linkedChunkIds.has(item.id) ? 'unknown' : 'neutral'
      };
    return this.candidate({
      id: `retrieved:${item.kind}:${item.id}`,
      workspaceId,
      sourceType: item.kind === 'worldbuild-canon' ? 'canon' : 'text',
      sourceId: item.id,
      content: item.content,
      relevance: normalizeRelevance(item.relevance),
      epistemic,
      provenanceIds: item.provenanceIds
    });
  }

  private loadEntityCandidates(workspaceId: string, entityIds: string[]): ContextCandidate[] {
    if (!entityIds.length) return [];
    const placeholders = entityIds.map(() => '?').join(', ');
    const entities = this.db.prepare(`
      SELECT id, type, canonicalName, lore, data, status
      FROM entities
      WHERE workspaceId = ? AND id IN (${placeholders}) AND status != 'proposed'
    `).all(workspaceId, ...entityIds) as EntityRow[];
    const fields = this.db.prepare(`
      SELECT type_id, field_key, label, ai_access
      FROM worldbuild_field_definitions WHERE workspace_id = ?
    `).all(workspaceId) as FieldRow[];
    return entities.flatMap(entity => {
      const content = composeEntity(entity, fields);
      if (!content) return [];
      return [this.candidate({
        id: `entity:${entity.id}`,
        workspaceId,
        sourceType: 'canon',
        sourceId: entity.id,
        content,
        relevance: 1,
        epistemic: { kind: 'canon', access: 'public' },
        provenanceIds: [entity.id]
      })];
    });
  }

  private loadEpistemicCandidates(
    workspaceId: string,
    entityIds: string[]
  ): ContextCandidate[] {
    const relevantIds = new Set(entityIds);
    if (!relevantIds.size) return [];
    const rows = this.db.prepare(`
      SELECT records.record_type, records.record_id, records.subject_id,
        records.source_event_id, records.payload_json, events.narrative_sequence
      FROM kanora_narrative_records AS records
      JOIN kanora_narrative_events AS events
        ON events.workspace_id = records.workspace_id
        AND events.event_id = records.source_event_id
      WHERE records.workspace_id = ?
        AND records.record_type IN ('knowledge', 'belief', 'memory')
        AND records.subject_id IS NOT NULL
      ORDER BY events.narrative_sequence, records.rowid
    `).all(workspaceId) as RecordRow[];
    return projectCurrentRecords(rows).flatMap(({ row, payload }) => {
      const aboutId = String((payload.proposition as Record<string, unknown> | undefined)?.subjectId ?? '');
      if (!relevantIds.has(row.subject_id) && !relevantIds.has(aboutId)) return [];
      const normalized = normalizeRecord(row, payload);
      if (!normalized) return [];
      return [this.candidate({
        id: `${row.record_type}:${row.record_id}`,
        workspaceId,
        sourceType: row.record_type,
        sourceId: row.record_id,
        content: normalized.content,
        relevance: relevantIds.has(aboutId) ? 1 : 0.9,
        position: { sequence: row.narrative_sequence },
        epistemic: normalized.epistemic,
        provenanceIds: [row.source_event_id, row.record_id]
      })];
    });
  }

  private loadRelationCandidates(workspaceId: string, entityIds: string[]): ContextCandidate[] {
    if (!entityIds.length) return [];
    const placeholders = entityIds.map(() => '?').join(', ');
    const rows = this.db.prepare(`
      SELECT links.id, links.fromId, links.toId, links.relType, links.label,
        source.canonicalName AS sourceName, target.canonicalName AS targetName
      FROM entity_links AS links
      JOIN entities AS source ON source.id = links.fromId AND source.workspaceId = links.workspaceId
      JOIN entities AS target ON target.id = links.toId AND target.workspaceId = links.workspaceId
      WHERE links.workspaceId = ?
        AND (links.fromId IN (${placeholders}) OR links.toId IN (${placeholders}))
        AND source.status != 'proposed' AND target.status != 'proposed'
    `).all(workspaceId, ...entityIds, ...entityIds) as Array<{
      id: string; fromId: string; toId: string; relType: string; label: string | null;
      sourceName: string; targetName: string;
    }>;
    return rows.map(row => this.candidate({
      id: `relation:${row.id}`,
      workspaceId,
      sourceType: 'canon',
      sourceId: row.id,
      content: `${row.sourceName} ${row.label || row.relType} ${row.targetName}`,
      relevance: 0.95,
      epistemic: { kind: 'canon', access: 'public' },
      provenanceIds: [row.id, row.fromId, row.toId]
    }));
  }

  private candidate(input: {
    id: string;
    workspaceId: string;
    sourceType: ContextSourceType;
    sourceId: string;
    content: string;
    relevance: number;
    position?: NarrativePosition;
    epistemic: ContextEpistemicMetadata;
    provenanceIds?: string[];
  }): ContextCandidate {
    return {
      id: input.id,
      workspaceId: input.workspaceId,
      source: { type: input.sourceType, id: input.sourceId },
      content: input.content,
      relevance: input.relevance,
      tokenCost: Math.max(1, this.estimateTokens(input.content)),
      ...(input.position ? { position: input.position } : {}),
      epistemic: input.epistemic,
      provenanceIds: input.provenanceIds ?? []
    };
  }
}

function normalizeRecord(
  row: RecordRow,
  payload: Record<string, unknown>
): { content: string; epistemic: ContextEpistemicMetadata } | undefined {
  const subjectId = row.subject_id;
  if (row.record_type === 'memory') {
    if ((payload.status ?? 'active') === 'forgotten') return undefined;
    const content = String(payload.summary ?? '').trim();
    if (!content) return undefined;
    return {
      content,
      epistemic: { kind: 'memory', subjectId, accessibility: accessibility(payload.accessibility) }
    };
  }
  if (payload.status !== 'active') return undefined;
  const proposition = payload.proposition as Record<string, unknown> | undefined;
  const content = String(proposition?.object ?? '').trim();
  if (!content) return undefined;
  if (row.record_type === 'belief') {
    const relation = payload.relationToCanon;
    return {
      content,
      epistemic: {
        kind: 'belief',
        subjectId,
        relationToCanon: relation === 'aligned' || relation === 'contradicted' ? relation : 'unknown'
      }
    };
  }
  return {
    content,
    epistemic: { kind: 'knowledge', subjectId, accessibility: accessibility(payload.accessibility) }
  };
}

function projectCurrentRecords(rows: RecordRow[]): Array<{ row: RecordRow; payload: Record<string, unknown> }> {
  const knowledge = new Map<string, { row: RecordRow; payload: Record<string, unknown> }>();
  const beliefs = new Map<string, { row: RecordRow; payload: Record<string, unknown> }>();
  const memories = new Map<string, { row: RecordRow; payload: Record<string, unknown> }>();
  rows.forEach(row => {
    const payload = parseObject(row.payload_json);
    if (row.record_type === 'memory') {
      const supersedes = String(payload.supersedesMemoryId ?? '');
      if (supersedes) memories.delete(supersedes);
      if ((payload.status ?? 'active') !== 'forgotten') memories.set(row.record_id, { row, payload });
      return;
    }
    const proposition = JSON.stringify(payload.proposition ?? null);
    const key = `${row.subject_id}:${proposition}`;
    const target = row.record_type === 'knowledge' ? knowledge : beliefs;
    if (payload.status === 'active') target.set(key, { row, payload });
    else target.delete(key);
  });
  return [...knowledge.values(), ...beliefs.values(), ...memories.values()];
}

function composeEntity(entity: EntityRow, fields: FieldRow[]): string {
  const data = parseObject(entity.data);
  const parts = [`${entity.canonicalName} (${entity.type})`];
  const description = String(data.description ?? data.content ?? '').trim();
  if (description) parts.push(description);
  if (entity.lore?.trim()) parts.push(entity.lore.trim());
  Object.entries(data)
    .filter(([key, value]) => !key.startsWith('_')
      && !['description', 'content', 'customFields', 'loreDocumentId', 'loreDocumentIds', 'aiPolicy'].includes(key)
      && value !== undefined && value !== null && value !== '')
    .forEach(([key, value]) => parts.push(`${humanizeKey(key)}: ${formatValue(value)}`));
  const customFields = parseObject(data.customFields);
  fields
    .filter(field => field.type_id === entity.type && field.ai_access !== 'hidden')
    .forEach(field => {
      const value = customFields[field.field_key];
      if (value !== undefined && value !== null && value !== '') parts.push(`${field.label}: ${formatValue(value)}`);
    });
  return parts.join('\n');
}

function composeContext(plan: ContextPlanResult): string {
  const sections = new Map<ContextSourceType, string[]>();
  plan.package.items.forEach(item => {
    const values = sections.get(item.source.type) ?? [];
    values.push(item.content);
    sections.set(item.source.type, values);
  });
  const labels: Array<[ContextSourceType, string]> = [
    ['canon', 'CANONICAL CONTEXT'],
    ['knowledge', 'SUBJECT KNOWLEDGE'],
    ['belief', 'BELIEFS AND UNCERTAINTY'],
    ['relationship', 'RELATIONSHIP CONTEXT'],
    ['memory', 'SUBJECT MEMORIES'],
    ['text', 'RETRIEVED EVIDENCE']
  ];
  return labels.flatMap(([type, label]) => {
    const values = sections.get(type);
    return values?.length ? [`--- ${label} ---\n${values.join('\n\n')}`] : [];
  }).join('\n\n');
}

function deduplicateCandidates(candidates: ContextCandidate[]): ContextCandidate[] {
  const unique = new Map<string, ContextCandidate>();
  candidates.forEach(candidate => unique.set(candidate.id, candidate));
  return [...unique.values()];
}

function parseObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function accessibility(value: unknown): 'available' | 'suppressed' | 'inaccessible' {
  return value === 'suppressed' || value === 'inaccessible' ? value : 'available';
}

function normalizeRelevance(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value!)) : 0.5;
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function humanizeKey(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').replace(/^./, letter => letter.toUpperCase());
}

export function createKallamoKanoraChatContext(
  db: Database.Database,
  estimateTokens: (text: string) => number
): KallamoKanoraChatContext {
  return new KallamoKanoraChatContext(db, estimateTokens);
}
