import type Database from 'better-sqlite3';
import type { NarrativeMemory, NarrativePosition } from './contracts';
import { validateNarrativeMemory, type ValidationIssue } from './validation';

export interface NarrativeMemoryRecord {
  memory: NarrativeMemory;
  sourceEventId: string;
  rememberedAt: NarrativePosition;
  appliedAt: string;
}

export interface ListNarrativeMemoryOptions {
  accessibleOnly?: boolean;
  throughSequence?: number;
}

interface NarrativeMemoryRow {
  record_id: string;
  payload_json: string;
  source_event_id: string;
  narrative_sequence: number;
  narrative_timestamp: string | null;
  applied_at: string;
}

export type NarrativeMemoryReadErrorCode =
  | 'MALFORMED_MEMORY_JSON'
  | 'INVALID_MEMORY'
  | 'MEMORY_SOURCE_MISMATCH';

export class NarrativeMemoryReadError extends Error {
  constructor(
    readonly code: NarrativeMemoryReadErrorCode,
    message: string,
    readonly recordId: string,
    readonly issues: ValidationIssue[] = []
  ) {
    super(message);
    this.name = 'NarrativeMemoryReadError';
  }
}

export class NarrativeMemoryRepository {
  private readonly selectForSubject;

  constructor(db: Database.Database) {
    this.selectForSubject = db.prepare(`
      SELECT records.record_id, records.payload_json, records.source_event_id,
        events.narrative_sequence, events.narrative_timestamp, records.applied_at
      FROM kanora_narrative_records AS records
      JOIN kanora_narrative_events AS events
        ON events.workspace_id = records.workspace_id
        AND events.event_id = records.source_event_id
      WHERE records.workspace_id = ?
        AND records.record_type = 'memory'
        AND records.subject_id = ?
        AND events.narrative_sequence <= ?
      ORDER BY events.narrative_sequence, records.applied_at, records.record_id
    `);
  }

  listForSubject(
    projectId: string,
    subjectId: string,
    options: ListNarrativeMemoryOptions = {}
  ): NarrativeMemoryRecord[] {
    const throughSequence = options.throughSequence ?? Number.MAX_SAFE_INTEGER;
    const records = (this.selectForSubject.all(projectId, subjectId, throughSequence) as NarrativeMemoryRow[])
      .map(row => this.hydrate(row));
    return options.accessibleOnly
      ? records.filter(record => record.memory.accessibility === 'available')
      : records;
  }

  listCurrentForSubject(
    projectId: string,
    subjectId: string,
    options: ListNarrativeMemoryOptions = {}
  ): NarrativeMemoryRecord[] {
    const current = new Map<string, NarrativeMemoryRecord>();
    this.listForSubject(projectId, subjectId, options).forEach(record => {
      const supersededId = record.memory.supersedesMemoryId;
      if (supersededId) current.delete(supersededId);
      if ((record.memory.status ?? 'active') !== 'forgotten') current.set(record.memory.id, record);
    });
    return [...current.values()];
  }

  private hydrate(row: NarrativeMemoryRow): NarrativeMemoryRecord {
    const memory = this.parseMemory(row);
    if (memory.eventId !== row.source_event_id) {
      throw new NarrativeMemoryReadError(
        'MEMORY_SOURCE_MISMATCH',
        'Narrative memory event does not match its persisted event.',
        row.record_id
      );
    }
    return {
      memory,
      sourceEventId: row.source_event_id,
      rememberedAt: {
        sequence: row.narrative_sequence,
        ...(row.narrative_timestamp ? { timestamp: row.narrative_timestamp } : {})
      },
      appliedAt: row.applied_at
    };
  }

  private parseMemory(row: NarrativeMemoryRow): NarrativeMemory {
    let value: unknown;
    try {
      value = JSON.parse(row.payload_json) as unknown;
    } catch {
      throw new NarrativeMemoryReadError('MALFORMED_MEMORY_JSON', 'Narrative memory payload is not valid JSON.', row.record_id);
    }
    const validation = validateNarrativeMemory(value);
    if (!validation.success) {
      throw new NarrativeMemoryReadError(
        'INVALID_MEMORY',
        'Narrative memory payload does not conform to Kanora Contract v1.',
        row.record_id,
        validation.issues
      );
    }
    return validation.value;
  }
}
