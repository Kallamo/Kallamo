import type Database from 'better-sqlite3';
import {
  isSceneStatePredicate,
  looksLikeIdentifier,
  propositionIdentity,
  statementKey
} from '../../../narrative/narrative-taxonomy';
import { NarrativeWorld } from './umwelt/narrative-world';
import { retireRecords } from './umwelt/story-lifecycle';
import { loadStoryRecords } from './umwelt/story-projection';
import { metadataOf } from './umwelt/story-reader';

/**
 * Retires stored records the quality gate would refuse today. Nothing is deleted: only the status
 * changes to the value each projection already treats as not current.
 */

export type RetirementReason = 'duplicate' | 'scene-state' | 'identifier-content';

export interface NarrativeCompactionReport {
  scanned: number;
  duplicates: number;
  sceneState: number;
  identifierContent: number;
  retired: number;
  /** A short, readable sample of what would be or was retired, for the confirmation step. */
  samples: Array<{ recordType: string; reason: RetirementReason; summary: string }>;
  /** The same, one row per statement with how many copies of it would go. */
  groups: Array<{ recordType: string; reason: RetirementReason; summary: string; count: number }>;
}

interface MaintenanceRow {
  record_type: 'fact' | 'knowledge' | 'belief' | 'memory';
  record_id: string;
  subject_id: string | null;
  interpreter: string;
  origin_type: string | null;
}

const SAMPLE_LIMIT = 12;
const GROUP_LIMIT = 60;

export class NarrativeMaintenance {
  constructor(private readonly db: Database.Database) {}

  preview(workspaceId: string): NarrativeCompactionReport {
    return this.run(workspaceId, false);
  }

  compact(workspaceId: string): NarrativeCompactionReport {
    return this.db.transaction(() => this.run(workspaceId, true))();
  }

  private run(workspaceId: string, apply: boolean): NarrativeCompactionReport {
    const world = NarrativeWorld.of(this.db, workspaceId);
    const records = world.exists() ? loadStoryRecords(world, { recordTypes: ['fact', 'knowledge', 'belief', 'memory'] }) : [];
    const rows = records.map(({ row, payload, record }) => ({
      row: {
        record_type: row.record_type as MaintenanceRow['record_type'],
        record_id: row.record_id,
        subject_id: row.subject_id || null,
        interpreter: (record.provenance.origin as { kind: string }).kind === 'model' ? 'model' : 'user',
        origin_type: (metadataOf(record).originType as string | undefined) ?? null
      },
      payload
    }));

    const report: NarrativeCompactionReport = {
      scanned: rows.length,
      duplicates: 0,
      sceneState: 0,
      identifierContent: 0,
      retired: 0,
      samples: [],
      groups: []
    };
    const groups = new Map<string, NarrativeCompactionReport['groups'][number]>();
    const seen = new Set<string>();
    const retiredIds = { retracted: [] as string[], forgotten: [] as string[] };
    for (const { row, payload } of rows) {
      const proposition = objectValue(payload.proposition);
      // Occurrences are owned by the Event occurrence service, which decides when one stops
      // being current. Touching their status here would desynchronize the two.
      if (row.record_type === 'fact' && String(proposition.predicate ?? '') === 'recorded-occurrence') continue;

      const modelAuthored = row.interpreter === 'model' && row.origin_type !== 'worldbuild-update';
      const reason = this.classify(row, payload, proposition, modelAuthored, seen);
      if (!reason) continue;

      if (reason === 'duplicate') report.duplicates += 1;
      if (reason === 'scene-state') report.sceneState += 1;
      if (reason === 'identifier-content') report.identifierContent += 1;
      report.retired += 1;
      const summary = describe(row.record_type, payload, proposition);
      if (report.samples.length < SAMPLE_LIMIT) {
        report.samples.push({ recordType: row.record_type, reason, summary });
      }
      const groupKey = `${row.record_type}\u0000${reason}\u0000${summary}`;
      const group = groups.get(groupKey);
      if (group) group.count += 1;
      else if (groups.size < GROUP_LIMIT) groups.set(groupKey, { recordType: row.record_type, reason, summary, count: 1 });
      if (apply) (row.record_type === 'memory' ? retiredIds.forgotten : retiredIds.retracted).push(row.record_id);
    }
    if (apply) {
      retireRecords(this.db, workspaceId, retiredIds.retracted, 'Cleanup: a duplicate, scene state or raw identifier.');
      retireRecords(this.db, workspaceId, retiredIds.forgotten, 'Cleanup: a repeated memory.', 'forgotten');
    }
    report.groups = [...groups.values()];
    return report;
  }

  /** The first copy wins, so the record that established something keeps its place in the sequence. */
  private classify(
    row: MaintenanceRow,
    payload: Record<string, unknown>,
    proposition: Record<string, unknown>,
    modelAuthored: boolean,
    seen: Set<string>
  ): RetirementReason | undefined {
    if (row.record_type === 'memory') {
      const key = `memory\u0000${row.subject_id ?? ''}\u0000${statementKey(payload.summary)}`;
      if (seen.has(key)) return 'duplicate';
      seen.add(key);
      return undefined;
    }
    if (modelAuthored && isSceneStatePredicate(proposition.predicate)) return 'scene-state';
    if (modelAuthored && looksLikeIdentifier(proposition.object)) return 'identifier-content';
    const identity = propositionIdentity(proposition.subjectId, proposition.predicate, proposition.object);
    const key = `${row.record_type}\u0000${row.subject_id ?? ''}\u0000${identity}`;
    if (seen.has(key)) return 'duplicate';
    seen.add(key);
    return undefined;
  }
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function describe(recordType: string, payload: Record<string, unknown>, proposition: Record<string, unknown>): string {
  const text = recordType === 'memory'
    ? String(payload.summary ?? '')
    : typeof proposition.object === 'string'
      ? proposition.object
      : `${String(proposition.predicate ?? '')}: ${JSON.stringify(proposition.object ?? null)}`;
  return text.replace(/\s+/g, ' ').trim().slice(0, 160);
}
