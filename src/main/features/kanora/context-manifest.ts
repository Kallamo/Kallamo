import type Database from 'better-sqlite3';
import type { EpistemicAssessment } from '../../../kanora/context-bundle';

export interface NarrativeContextManifest {
  requestId: string;
  workspaceId: string;
  originId?: string;
  sequence: number;
  sceneId?: string;
  playerSubjectId?: string;
  subjectIds: string[];
  targetIds: string[];
  assessments: EpistemicAssessment[];
  deepenedPairs: Array<{ subjectId: string; targetId: string }>;
  status?: 'active' | 'invalidated';
}

export class NarrativeContextManifestRepository {
  constructor(private readonly db: Database.Database) {}

  save(manifest: NarrativeContextManifest): NarrativeContextManifest {
    const normalized = normalizeManifest(manifest);
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO kanora_narrative_context_manifests (
        workspace_id, request_id, origin_id, narrative_sequence, scene_id,
        player_subject_id, manifest_json, status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?)
      ON CONFLICT(workspace_id, request_id) DO UPDATE SET
        narrative_sequence = excluded.narrative_sequence,
        scene_id = excluded.scene_id,
        player_subject_id = excluded.player_subject_id,
        manifest_json = excluded.manifest_json,
        status = 'active',
        updated_at = excluded.updated_at
    `).run(
      normalized.workspaceId,
      normalized.requestId,
      normalized.originId ?? null,
      normalized.sequence,
      normalized.sceneId ?? null,
      normalized.playerSubjectId ?? null,
      JSON.stringify(toStoredManifest(normalized)),
      now,
      now
    );
    return normalized;
  }

  attachOrigin(workspaceId: string, requestId: string, originId: string): void {
    const result = this.db.prepare(`
      UPDATE kanora_narrative_context_manifests
      SET origin_id = ?, updated_at = ?
      WHERE workspace_id = ? AND request_id = ? AND status = 'active'
    `).run(originId, Date.now(), workspaceId, requestId);
    if (result.changes !== 1) throw new Error('Narrative context manifest was not found.');
  }

  getByRequest(workspaceId: string, requestId: string): NarrativeContextManifest | null {
    return this.get('request_id', workspaceId, requestId);
  }

  getByOrigin(workspaceId: string, originId: string): NarrativeContextManifest | null {
    return this.get('origin_id', workspaceId, originId);
  }

  invalidateOrigin(workspaceId: string, originId: string): void {
    this.db.prepare(`
      UPDATE kanora_narrative_context_manifests
      SET status = 'invalidated', updated_at = ?
      WHERE workspace_id = ? AND origin_id = ?
    `).run(Date.now(), workspaceId, originId);
  }

  private get(column: 'request_id' | 'origin_id', workspaceId: string, id: string): NarrativeContextManifest | null {
    const row = this.db.prepare(`
      SELECT request_id, origin_id, narrative_sequence, scene_id,
        player_subject_id, manifest_json, status
      FROM kanora_narrative_context_manifests
      WHERE workspace_id = ? AND ${column} = ?
    `).get(workspaceId, id) as Record<string, unknown> | undefined;
    if (!row) return null;
    const stored = parseObject(row.manifest_json);
    return normalizeManifest({
      requestId: String(row.request_id),
      workspaceId,
      ...(row.origin_id ? { originId: String(row.origin_id) } : {}),
      sequence: Number(row.narrative_sequence),
      ...(row.scene_id ? { sceneId: String(row.scene_id) } : {}),
      ...(row.player_subject_id ? { playerSubjectId: String(row.player_subject_id) } : {}),
      subjectIds: stringArray(stored.subjectIds),
      targetIds: stringArray(stored.targetIds),
      assessments: Array.isArray(stored.assessments)
        ? stored.assessments as EpistemicAssessment[]
        : [],
      deepenedPairs: Array.isArray(stored.deepenedPairs)
        ? stored.deepenedPairs as Array<{ subjectId: string; targetId: string }>
        : [],
      status: row.status === 'invalidated' ? 'invalidated' : 'active'
    });
  }
}

function normalizeManifest(manifest: NarrativeContextManifest): NarrativeContextManifest {
  return {
    ...manifest,
    subjectIds: unique(manifest.subjectIds),
    targetIds: unique(manifest.targetIds),
    assessments: manifest.assessments.map(assessment => ({
      ...assessment,
      sourceIds: unique(assessment.sourceIds),
      ...(assessment.evidence ? { evidence: assessment.evidence.slice(0, 240) } : {})
    })),
    deepenedPairs: uniquePairs(manifest.deepenedPairs)
  };
}

function toStoredManifest(manifest: NarrativeContextManifest): Record<string, unknown> {
  return {
    subjectIds: manifest.subjectIds,
    targetIds: manifest.targetIds,
    assessments: manifest.assessments,
    deepenedPairs: manifest.deepenedPairs
  };
}

function parseObject(value: unknown): Record<string, unknown> {
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? unique(value.map(String)) : [];
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function uniquePairs(values: Array<{ subjectId: string; targetId: string }>) {
  const byKey = new Map(values.map(value => [`${value.subjectId}\u0000${value.targetId}`, value]));
  return [...byKey.values()];
}
