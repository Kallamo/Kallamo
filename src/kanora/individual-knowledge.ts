import type Database from 'better-sqlite3';
import type { Knowledge, NarrativePosition } from './contracts';

export interface IndividualKnowledgeRecord {
  knowledge: Knowledge;
  sourceEventId: string;
  acquiredAt: NarrativePosition;
  accessibility: 'available' | 'inaccessible';
  appliedAt: string;
}

export interface ListIndividualKnowledgeOptions {
  accessibleOnly?: boolean;
}

interface KnowledgeRow {
  payload_json: string;
  source_event_id: string;
  narrative_sequence: number;
  narrative_timestamp: string | null;
  applied_at: string;
}

export class IndividualKnowledgeRepository {
  private readonly selectForSubject;

  constructor(db: Database.Database) {
    this.selectForSubject = db.prepare(`
      SELECT records.payload_json, records.source_event_id,
        events.narrative_sequence, events.narrative_timestamp, records.applied_at
      FROM kanora_narrative_records AS records
      JOIN kanora_narrative_events AS events
        ON events.workspace_id = records.workspace_id
        AND events.event_id = records.source_event_id
      WHERE records.workspace_id = ?
        AND records.record_type = 'knowledge'
        AND json_extract(records.payload_json, '$.subjectId') = ?
      ORDER BY events.narrative_sequence, records.applied_at, records.record_id
    `);
  }

  listForSubject(
    projectId: string,
    subjectId: string,
    options: ListIndividualKnowledgeOptions = {}
  ): IndividualKnowledgeRecord[] {
    const records = (this.selectForSubject.all(projectId, subjectId) as KnowledgeRow[]).map(row => this.hydrate(row));
    return options.accessibleOnly
      ? records.filter(record => record.accessibility === 'available')
      : records;
  }

  private hydrate(row: KnowledgeRow): IndividualKnowledgeRecord {
    const knowledge = JSON.parse(row.payload_json) as Knowledge;
    return {
      knowledge,
      sourceEventId: row.source_event_id,
      acquiredAt: {
        sequence: row.narrative_sequence,
        ...(row.narrative_timestamp ? { timestamp: row.narrative_timestamp } : {})
      },
      accessibility: knowledge.status === 'active' ? 'available' : 'inaccessible',
      appliedAt: row.applied_at
    };
  }
}
