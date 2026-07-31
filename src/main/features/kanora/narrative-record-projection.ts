import type Database from 'better-sqlite3';

export type NarrativeRecordType =
  | 'fact'
  | 'state'
  | 'knowledge'
  | 'belief'
  | 'memory'
  | 'relationship';

export interface NarrativeRecordRow {
  record_type: NarrativeRecordType;
  record_id: string;
  subject_id: string;
  source_event_id: string;
  payload_json: string;
  narrative_sequence: number;
}

export interface ProjectedNarrativeRecord {
  row: NarrativeRecordRow;
  payload: Record<string, unknown>;
}

export interface LoadCurrentNarrativeRecordsInput {
  workspaceId: string;
  recordTypes: NarrativeRecordType[];
  subjectIds?: string[];
  throughSequence?: number;
}

export function loadCurrentNarrativeRecords(
  db: Database.Database,
  input: LoadCurrentNarrativeRecordsInput
): ProjectedNarrativeRecord[] {
  if (!input.recordTypes.length || input.subjectIds?.length === 0) return [];
  const typePlaceholders = input.recordTypes.map(() => '?').join(', ');
  const subjectClause = input.subjectIds
    ? `AND records.subject_id IN (${input.subjectIds.map(() => '?').join(', ')})`
    : '';
  const rows = db.prepare(`
    SELECT records.record_type, records.record_id, records.subject_id,
      records.source_event_id, records.payload_json, events.narrative_sequence
    FROM kanora_narrative_records AS records
    JOIN kanora_narrative_events AS events
      ON events.workspace_id = records.workspace_id
      AND events.event_id = records.source_event_id
    LEFT JOIN kanora_narrative_event_evidence AS evidence
      ON evidence.workspace_id = events.workspace_id
      AND evidence.event_id = events.event_id
      AND evidence.ordinal = 0
    LEFT JOIN kanora_narrative_origin_lifecycle AS lifecycle
      ON lifecycle.workspace_id = events.workspace_id
      AND lifecycle.origin_id = evidence.origin_id
    WHERE records.workspace_id = ?
      AND records.record_type IN (${typePlaceholders})
      ${subjectClause}
      AND events.narrative_sequence <= ?
      AND COALESCE(lifecycle.status, 'active') = 'active'
    ORDER BY events.narrative_sequence, records.rowid
  `).all(
    input.workspaceId,
    ...input.recordTypes,
    ...(input.subjectIds ?? []),
    input.throughSequence ?? Number.MAX_SAFE_INTEGER
  ) as NarrativeRecordRow[];
  return projectCurrentNarrativeRecords(rows);
}

export function projectCurrentNarrativeRecords(
  rows: NarrativeRecordRow[]
): ProjectedNarrativeRecord[] {
  const facts = new Map<string, ProjectedNarrativeRecord>();
  const states = new Map<string, ProjectedNarrativeRecord>();
  const knowledge = new Map<string, ProjectedNarrativeRecord>();
  const beliefs = new Map<string, ProjectedNarrativeRecord>();
  const memories = new Map<string, ProjectedNarrativeRecord>();
  const relationships = new Map<string, ProjectedNarrativeRecord>();
  rows.forEach(row => {
    const payload = parseObject(row.payload_json);
    const projected = { row, payload };
    if (row.record_type === 'fact') {
      const proposition = objectValue(payload.proposition);
      const key = `${String(proposition.subjectId ?? '')}\u0000${String(proposition.predicate ?? '')}`;
      if (payload.status === 'retracted') facts.delete(key);
      else facts.set(key, projected);
      return;
    }
    if (row.record_type === 'state') {
      states.set(`${String(payload.entityId ?? '')}\u0000${String(payload.property ?? '')}`, projected);
      return;
    }
    if (row.record_type === 'memory') {
      const supersedes = String(payload.supersedesMemoryId ?? '');
      if (supersedes) memories.delete(supersedes);
      if ((payload.status ?? 'active') !== 'forgotten') memories.set(row.record_id, projected);
      return;
    }
    if (row.record_type === 'relationship') {
      const key = `${row.subject_id}\u0000${String(payload.targetEntityId ?? '')}\u0000${String(payload.dimension ?? '')}`;
      relationships.set(key, projected);
      return;
    }
    const entryId = String(payload.entryId ?? '');
    const proposition = JSON.stringify(payload.proposition ?? null);
    const key = entryId || `${row.subject_id}\u0000${proposition}`;
    const target = row.record_type === 'knowledge' ? knowledge : beliefs;
    if (payload.status === 'active') target.set(key, projected);
    else target.delete(key);
  });
  return [
    ...facts.values(),
    ...states.values(),
    ...knowledge.values(),
    ...beliefs.values(),
    ...memories.values(),
    ...relationships.values()
  ];
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function parseObject(value: string): Record<string, unknown> {
  try {
    return objectValue(JSON.parse(value));
  } catch {
    return {};
  }
}
