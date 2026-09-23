import type Database from 'better-sqlite3';
import type { Knowledge, NarrativePosition } from './contracts';
import { validateKnowledge, type ValidationIssue } from './validation';

export interface SubjectKnowledgeRecord {
  knowledge: Knowledge;
  sourceEventId: string;
  acquiredAt: NarrativePosition;
  appliedAt: string;
}

export interface ListSubjectKnowledgeOptions {
  accessibleOnly?: boolean;
  throughSequence?: number;
}

export type IndividualKnowledgeRecord = SubjectKnowledgeRecord;
export type ListIndividualKnowledgeOptions = ListSubjectKnowledgeOptions;

interface KnowledgeRow {
  record_id: string;
  payload_json: string;
  source_event_id: string;
  narrative_sequence: number;
  narrative_timestamp: string | null;
  applied_at: string;
}

export type IndividualKnowledgeReadErrorCode =
  | 'MALFORMED_KNOWLEDGE_JSON'
  | 'INVALID_KNOWLEDGE'
  | 'KNOWLEDGE_SOURCE_MISMATCH';

export class IndividualKnowledgeReadError extends Error {
  constructor(
    readonly code: IndividualKnowledgeReadErrorCode,
    message: string,
    readonly recordId: string,
    readonly issues: ValidationIssue[] = []
  ) {
    super(message);
    this.name = 'IndividualKnowledgeReadError';
  }
}

export class SubjectKnowledgeRepository {
  private readonly selectForSubject;

  constructor(db: Database.Database) {
    this.selectForSubject = db.prepare(`
      SELECT records.record_id, records.payload_json, records.source_event_id,
        events.narrative_sequence, events.narrative_timestamp, records.applied_at
      FROM narrative_records AS records
      JOIN narrative_events AS events
        ON events.workspace_id = records.workspace_id
        AND events.event_id = records.source_event_id
      WHERE records.workspace_id = ?
        AND records.record_type = 'knowledge'
        AND records.subject_id = ?
        AND events.narrative_sequence <= ?
      ORDER BY events.narrative_sequence, records.applied_at, records.record_id
    `);
  }

  listForSubject(
    projectId: string,
    subjectId: string,
    options: ListSubjectKnowledgeOptions = {}
  ): SubjectKnowledgeRecord[] {
    const throughSequence = options.throughSequence ?? Number.MAX_SAFE_INTEGER;
    const records = (this.selectForSubject.all(projectId, subjectId, throughSequence) as KnowledgeRow[])
      .map(row => this.hydrate(row));
    return options.accessibleOnly
      ? records.filter(record => (
        record.knowledge.status === 'active'
        && record.knowledge.accessibility === 'available'
      ))
      : records;
  }

  listCurrentForSubject(
    projectId: string,
    subjectId: string,
    options: ListSubjectKnowledgeOptions = {}
  ): SubjectKnowledgeRecord[] {
    const latest = new Map<string, SubjectKnowledgeRecord>();
    this.listForSubject(projectId, subjectId, options).forEach(record => {
      const { proposition } = record.knowledge;
      latest.set(`${proposition.subjectId}\u0000${proposition.predicate}`, record);
    });
    return [...latest.values()].filter(record => record.knowledge.status === 'active');
  }

  private hydrate(row: KnowledgeRow): SubjectKnowledgeRecord {
    const knowledge = this.parseKnowledge(row);
    if (knowledge.sourceEventId !== row.source_event_id) {
      throw new IndividualKnowledgeReadError(
        'KNOWLEDGE_SOURCE_MISMATCH',
        'Knowledge source event does not match its persisted event.',
        row.record_id
      );
    }
    return {
      knowledge,
      sourceEventId: row.source_event_id,
      acquiredAt: {
        sequence: row.narrative_sequence,
        ...(row.narrative_timestamp ? { timestamp: row.narrative_timestamp } : {})
      },
      appliedAt: row.applied_at
    };
  }

  private parseKnowledge(row: KnowledgeRow): Knowledge {
    let value: unknown;
    try {
      value = JSON.parse(row.payload_json) as unknown;
    } catch {
      throw new IndividualKnowledgeReadError(
        'MALFORMED_KNOWLEDGE_JSON',
        'Knowledge payload is not valid JSON.',
        row.record_id
      );
    }
    const validation = validateKnowledge(value);
    if (!validation.success) {
      throw new IndividualKnowledgeReadError(
        'INVALID_KNOWLEDGE',
        'Knowledge payload does not conform to Narrative Contract v1.',
        row.record_id,
        validation.issues
      );
    }
    return validation.value;
  }
}

export class IndividualKnowledgeRepository extends SubjectKnowledgeRepository {}
