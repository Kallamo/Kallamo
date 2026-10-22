import type Database from 'better-sqlite3';
import type { NarrativePosition } from '../../../narrative/contracts';
import type { EpistemicAssessment, EpistemicAssessmentState } from '../../../narrative/context-bundle';
import { createWorldbuildKnowledgeService } from '../worldbuild/knowledge-service';
import { sharedKnowledgeCards } from '../worldbuild/knowledge-groups';

export interface EpistemicResolutionRequest {
  workspaceId: string;
  subjectIds: string[];
  targetIds: string[];
  through: NarrativePosition;
}

export interface EpistemicResolution {
  workspaceId: string;
  through: NarrativePosition;
  assessments: EpistemicAssessment[];
}

interface EntityEvidence {
  id: string;
  name: string;
  aliases: string[];
  text: string;
}

interface AwarenessEvidence {
  subjectId: string;
  targetId: string;
  state: EpistemicAssessmentState;
  sourceIds: string[];
}

const STRONG_CONTEXT_TERMS = ['veteran', 'former member', 'served in', 'served with', 'member of'];

export class EpistemicResolver {
  constructor(private readonly db: Database.Database) {}

  resolve(request: EpistemicResolutionRequest): EpistemicResolution {
    const subjectIds = unique(request.subjectIds);
    const targetIds = unique(request.targetIds);
    if (!subjectIds.length || !targetIds.length) {
      return { workspaceId: request.workspaceId, through: request.through, assessments: [] };
    }
    createWorldbuildKnowledgeService(this.db).reconcileWorkspace(request.workspaceId);
    const direct = this.loadAwareness(request.workspaceId, subjectIds, targetIds, request.through.sequence);
    const subjects = this.loadEntityEvidence(request.workspaceId, subjectIds);
    const targets = this.loadEntityEvidence(request.workspaceId, targetIds);
    const assessments = subjectIds.flatMap(subjectId => targetIds.flatMap(targetId => {
      if (subjectId === targetId) return [];
      const known = direct.get(pairKey(subjectId, targetId));
      if (known) return [{ subjectId, targetId, ...known }];
      return [this.assessEntityEvidence(subjectId, targetId, subjects.get(subjectId), targets.get(targetId))];
    }));
    return { workspaceId: request.workspaceId, through: request.through, assessments };
  }

  private loadAwareness(
    workspaceId: string,
    subjectIds: string[],
    targetIds: string[],
    throughSequence: number
  ): Map<string, Omit<AwarenessEvidence, 'subjectId' | 'targetId'>> {
    const subjectPlaceholders = subjectIds.map(() => '?').join(', ');
    const targetPlaceholders = targetIds.map(() => '?').join(', ');
    const temporalRows = this.db.prepare(`
      SELECT awareness.subject_id AS subjectId, awareness.target_id AS targetId,
        awareness.status, awareness.awareness_id AS sourceId,
        events.narrative_sequence AS sortValue
      FROM narrative_awareness_records awareness
      JOIN narrative_events events
        ON events.workspace_id = awareness.workspace_id
        AND events.event_id = awareness.source_event_id
      WHERE awareness.workspace_id = ?
        AND awareness.subject_id IN (${subjectPlaceholders})
        AND awareness.target_id IN (${targetPlaceholders})
        AND events.narrative_sequence <= ?
      ORDER BY events.narrative_sequence, awareness.rowid
    `).all(
      workspaceId, ...subjectIds, ...targetIds, throughSequence
    ) as Array<{ subjectId: string; targetId: string; status: string; sourceId: string }>;
    const result = new Map<string, Omit<AwarenessEvidence, 'subjectId' | 'targetId'>>();
    for (const row of temporalRows) {
      result.set(pairKey(row.subjectId, row.targetId), {
        state: row.status === 'active' ? 'confirmed' : 'explicitly-unaware',
        sourceIds: [row.sourceId]
      });
    }
    const ownRows = this.db.prepare(`
      SELECT cards.owner_id AS subjectId, cards.target_id AS targetId,
        cards.card_id AS sourceId
      FROM worldbuild_knowledge_cards cards
      WHERE cards.workspace_id = ? AND cards.status = 'active'
        AND cards.owner_id IN (${subjectPlaceholders})
        AND cards.target_id IN (${targetPlaceholders})
    `).all(workspaceId, ...subjectIds, ...targetIds) as Array<{ subjectId: string; targetId: string; sourceId: string }>;
    const cardRows = [
      ...ownRows,
      ...sharedKnowledgeCards(this.db, workspaceId, subjectIds, targetIds)
        .map(card => ({ subjectId: card.memberId, targetId: card.targetId, sourceId: card.cardId }))
    ];
    for (const row of cardRows) {
      result.set(pairKey(row.subjectId, row.targetId), {
        state: 'confirmed',
        sourceIds: [row.sourceId]
      });
    }
    return result;
  }

  private loadEntityEvidence(workspaceId: string, ids: string[]): Map<string, EntityEvidence> {
    if (!ids.length) return new Map();
    const rows = this.db.prepare(`
      SELECT id, canonicalName, aliases, lore, data
      FROM entities
      WHERE workspaceId = ? AND id IN (${ids.map(() => '?').join(', ')})
        AND status != 'proposed'
    `).all(workspaceId, ...ids) as Array<Record<string, unknown>>;
    return new Map(rows.map(row => {
      const aliases = parseStringArray(row.aliases);
      return [String(row.id), {
        id: String(row.id),
        name: String(row.canonicalName),
        aliases,
        text: `${String(row.lore ?? '')}\n${String(row.data ?? '')}`.trim()
      }];
    }));
  }

  private assessEntityEvidence(
    subjectId: string,
    targetId: string,
    subject: EntityEvidence | undefined,
    target: EntityEvidence | undefined
  ): EpistemicAssessment {
    if (!subject || !target) return { subjectId, targetId, state: 'undetermined', sourceIds: [] };
    const evidence = findTargetEvidence(subject.text, [target.name, ...target.aliases]);
    if (!evidence) return { subjectId, targetId, state: 'undetermined', sourceIds: [] };
    const normalized = evidence.toLocaleLowerCase();
    const state = STRONG_CONTEXT_TERMS.some(term => normalized.includes(term))
      ? 'derived'
      : 'evidence-candidate';
    return {
      subjectId,
      targetId,
      state,
      sourceIds: [`entity:${subject.id}`],
      evidence
    };
  }
}

function findTargetEvidence(text: string, names: string[]): string | null {
  const compact = text.replace(/\s+/g, ' ').trim();
  if (!compact) return null;
  const normalized = compact.toLocaleLowerCase();
  const name = names.find(candidate => {
    const value = candidate.trim().toLocaleLowerCase();
    return value.length >= 2 && normalized.includes(value);
  });
  if (!name) return null;
  const index = normalized.indexOf(name.toLocaleLowerCase());
  const start = Math.max(0, index - 100);
  return compact.slice(start, Math.min(compact.length, index + name.length + 100));
}

function parseStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return value.split(',').map(item => item.trim()).filter(Boolean);
  }
}

function pairKey(subjectId: string, targetId: string): string {
  return `${subjectId}\u0000${targetId}`;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
