import type Database from 'better-sqlite3';
import type { Awareness, NarrativePosition } from './contracts';
import { validateAwareness, type ValidationIssue } from './validation';

export interface AwarenessRecord {
  awareness: Awareness;
  acquiredAt: NarrativePosition;
  appliedAt: string;
}

interface AwarenessRow {
  awareness_id: string;
  payload_json: string;
  source_event_id: string;
  narrative_sequence: number;
  narrative_timestamp: string | null;
  applied_at: string;
}

export class AwarenessReadError extends Error {
  constructor(
    readonly code: 'MALFORMED_AWARENESS_JSON' | 'INVALID_AWARENESS' | 'AWARENESS_SOURCE_MISMATCH',
    message: string,
    readonly recordId: string,
    readonly issues: ValidationIssue[] = []
  ) {
    super(message);
    this.name = 'AwarenessReadError';
  }
}

export class AwarenessRepository {
  private readonly selectForSubject;

  constructor(db: Database.Database) {
    this.selectForSubject = db.prepare(`
      SELECT awareness.awareness_id, awareness.payload_json, awareness.source_event_id,
        events.narrative_sequence, events.narrative_timestamp, awareness.applied_at
      FROM narrative_awareness_records AS awareness
      JOIN narrative_events AS events
        ON events.workspace_id = awareness.workspace_id
        AND events.event_id = awareness.source_event_id
      WHERE awareness.workspace_id = ?
        AND awareness.subject_id = ?
        AND events.narrative_sequence <= ?
      ORDER BY events.narrative_sequence, awareness.applied_at, awareness.awareness_id
    `);
  }

  listCurrentForSubject(projectId: string, subjectId: string, throughSequence = Number.MAX_SAFE_INTEGER): AwarenessRecord[] {
    const current = new Map<string, AwarenessRecord>();
    (this.selectForSubject.all(projectId, subjectId, throughSequence) as AwarenessRow[])
      .map(row => this.hydrate(row))
      .forEach(record => current.set(record.awareness.targetId, record));
    return [...current.values()].filter(record => record.awareness.status === 'active');
  }

  private hydrate(row: AwarenessRow): AwarenessRecord {
    let value: unknown;
    try {
      value = JSON.parse(row.payload_json) as unknown;
    } catch {
      throw new AwarenessReadError('MALFORMED_AWARENESS_JSON', 'Awareness payload is not valid JSON.', row.awareness_id);
    }
    const validation = validateAwareness(value);
    if (!validation.success) {
      throw new AwarenessReadError('INVALID_AWARENESS', 'Awareness payload does not conform to Narrative Contract v1.', row.awareness_id, validation.issues);
    }
    if (validation.value.sourceEventId !== row.source_event_id) {
      throw new AwarenessReadError('AWARENESS_SOURCE_MISMATCH', 'Awareness source event does not match its persisted event.', row.awareness_id);
    }
    return {
      awareness: validation.value,
      acquiredAt: {
        sequence: row.narrative_sequence,
        ...(row.narrative_timestamp ? { timestamp: row.narrative_timestamp } : {})
      },
      appliedAt: row.applied_at
    };
  }
}
