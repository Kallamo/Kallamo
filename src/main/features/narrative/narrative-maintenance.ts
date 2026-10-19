import type Database from 'better-sqlite3';
import {
  isSceneStatePredicate,
  looksLikeIdentifier,
  propositionIdentity,
  statementKey
} from '../../../narrative/narrative-taxonomy';

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
  record_type: 'fact' | 'state' | 'observation' | 'knowledge' | 'belief' | 'memory' | 'relationship';
  record_id: string;
  subject_id: string | null;
  payload_json: string;
  applied_at: string;
  rowid: number;
  interpreter: string;
  origin_type: string | null;
}

const RETIRED_STATUS: Record<string, string> = {
  fact: 'retracted',
  knowledge: 'superseded',
  belief: 'superseded',
  memory: 'forgotten'
};

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
    const rows = this.db.prepare(`
      SELECT records.record_type, records.record_id, records.subject_id, records.payload_json,
        records.applied_at, records.rowid AS rowid,
        events.provenance_interpreter AS interpreter,
        evidence.origin_type AS origin_type
      FROM narrative_records AS records
      JOIN narrative_events AS events
        ON events.workspace_id = records.workspace_id AND events.event_id = records.source_event_id
      LEFT JOIN narrative_event_evidence AS evidence
        ON evidence.workspace_id = events.workspace_id
        AND evidence.event_id = events.event_id AND evidence.ordinal = 0
      WHERE records.workspace_id = ?
        AND records.record_type IN ('fact', 'knowledge', 'belief', 'memory')
      ORDER BY events.narrative_sequence, records.rowid
    `).all(workspaceId) as MaintenanceRow[];

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
    const retire = this.db.prepare(`
      UPDATE narrative_records
      SET payload_json = json_set(payload_json, '$.status', ?)
      WHERE workspace_id = ? AND record_type = ? AND record_id = ?
    `);

    for (const row of rows) {
      const payload = parsePayload(row.payload_json);
      if (!payload) continue;
      if ((payload.status ?? 'active') !== 'active') continue;
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
      if (apply) retire.run(RETIRED_STATUS[row.record_type] ?? 'superseded', workspaceId, row.record_type, row.record_id);
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

function parsePayload(value: string): Record<string, unknown> | undefined {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : undefined;
  } catch {
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
