import { isDeepStrictEqual } from 'node:util';
import type Database from 'better-sqlite3';
import type {
  Belief,
  NarrativeFact,
  NarrativePosition,
  RelationshipState
} from './contracts';
import {
  validateBelief,
  validateRelationshipState,
  type ValidationIssue
} from './validation';

export type CanonRelation = 'aligned' | 'contradicted' | 'unknown';

export interface PerspectiveStateRecord<T> {
  value: T;
  sourceEventId: string;
  position: NarrativePosition;
  appliedAt: string;
}

export interface BeliefProjectionRecord extends Omit<PerspectiveStateRecord<Belief>, 'value'> {
  belief: Belief;
  relationToCanon: CanonRelation;
}

export interface RelationshipProjectionRecord extends Omit<PerspectiveStateRecord<RelationshipState>, 'value'> {
  relationship: RelationshipState;
}

export interface ProjectionOptions {
  throughSequence?: number;
}

interface NarrativeRecordRow {
  record_id: string;
  payload_json: string;
  source_event_id: string;
  narrative_sequence: number;
  narrative_timestamp: string | null;
  applied_at: string;
}

interface FactRow {
  payload_json: string;
  narrative_sequence: number;
  applied_at: string;
  record_id: string;
}

export type PerspectiveStateReadErrorCode =
  | 'MALFORMED_PERSPECTIVE_STATE_JSON'
  | 'INVALID_PERSPECTIVE_STATE'
  | 'PERSPECTIVE_STATE_SOURCE_MISMATCH';

export class PerspectiveStateReadError extends Error {
  constructor(
    readonly code: PerspectiveStateReadErrorCode,
    message: string,
    readonly recordId: string,
    readonly issues: ValidationIssue[] = []
  ) {
    super(message);
    this.name = 'PerspectiveStateReadError';
  }
}

export class BeliefRepository {
  private readonly records: NarrativeStateRecords<Belief>;
  private readonly selectFacts;

  constructor(db: Database.Database) {
    this.records = new NarrativeStateRecords(db, 'belief', validateBelief);
    this.selectFacts = db.prepare(`
      SELECT records.payload_json, events.narrative_sequence, records.applied_at, records.record_id
      FROM kanora_narrative_records AS records
      JOIN kanora_narrative_events AS events
        ON events.workspace_id = records.workspace_id
        AND events.event_id = records.source_event_id
      WHERE records.workspace_id = ?
        AND records.record_type = 'fact'
        AND events.narrative_sequence <= ?
      ORDER BY events.narrative_sequence, records.applied_at, records.record_id
    `);
  }

  listHistoryForSubject(projectId: string, subjectId: string): BeliefProjectionRecord[] {
    return this.records.list(projectId, subjectId).map(record => this.project(projectId, record));
  }

  listCurrentForSubject(
    projectId: string,
    subjectId: string,
    options: ProjectionOptions = {}
  ): BeliefProjectionRecord[] {
    const history = this.records.list(projectId, subjectId, options.throughSequence);
    const current = latestBy(history, record => propositionKey(record.value));
    const comparisonSequence = options.throughSequence ?? Number.MAX_SAFE_INTEGER;
    return current
      .filter(record => record.value.status === 'active')
      .map(record => this.project(projectId, record, comparisonSequence));
  }

  private project(
    projectId: string,
    record: PerspectiveStateRecord<Belief>,
    comparisonSequence = record.position.sequence
  ): BeliefProjectionRecord {
    return {
      belief: record.value,
      sourceEventId: record.sourceEventId,
      position: record.position,
      appliedAt: record.appliedAt,
      relationToCanon: this.compareWithCanon(projectId, record.value, comparisonSequence)
    };
  }

  private compareWithCanon(projectId: string, belief: Belief, throughSequence: number): CanonRelation {
    const facts = (this.selectFacts.all(projectId, throughSequence) as FactRow[])
      .map(row => parseJson<NarrativeFact>(row.payload_json, row.record_id));
    const currentFacts = latestBy(facts, fact => (
      `${fact.proposition.subjectId}\u0000${fact.proposition.predicate}`
    )).filter(fact => fact.status === 'active');
    const matching = currentFacts.find(fact => (
      fact.proposition.subjectId === belief.proposition.subjectId
      && fact.proposition.predicate === belief.proposition.predicate
    ));
    if (!matching) return 'unknown';
    return isDeepStrictEqual(matching.proposition.object, belief.proposition.object)
      ? 'aligned'
      : 'contradicted';
  }
}

export class DynamicRelationshipRepository {
  private readonly records: NarrativeStateRecords<RelationshipState>;

  constructor(db: Database.Database) {
    this.records = new NarrativeStateRecords(db, 'relationship', validateRelationshipState);
  }

  listHistoryFrom(projectId: string, sourceEntityId: string): RelationshipProjectionRecord[] {
    return this.records.list(projectId, sourceEntityId).map(toRelationshipRecord);
  }

  listCurrentFrom(
    projectId: string,
    sourceEntityId: string,
    options: ProjectionOptions = {}
  ): RelationshipProjectionRecord[] {
    return latestBy(
      this.records.list(projectId, sourceEntityId, options.throughSequence),
      record => `${record.value.sourceEntityId}\u0000${record.value.targetEntityId}\u0000${record.value.dimension}`
    ).filter(record => record.value.status !== 'retired').map(toRelationshipRecord);
  }
}

class NarrativeStateRecords<T extends { sourceEventId: string }> {
  private readonly selectRecords;

  constructor(
    db: Database.Database,
    recordType: 'belief' | 'relationship',
    private readonly validate: (value: unknown) => { success: true; value: T } | { success: false; issues: ValidationIssue[] }
  ) {
    this.selectRecords = db.prepare(`
      SELECT records.record_id, records.payload_json, records.source_event_id,
        events.narrative_sequence, events.narrative_timestamp, records.applied_at
      FROM kanora_narrative_records AS records
      JOIN kanora_narrative_events AS events
        ON events.workspace_id = records.workspace_id
        AND events.event_id = records.source_event_id
      WHERE records.workspace_id = ?
        AND records.record_type = '${recordType}'
        AND records.subject_id = ?
        AND events.narrative_sequence <= ?
      ORDER BY events.narrative_sequence, records.applied_at, records.record_id
    `);
  }

  list(projectId: string, subjectId: string, throughSequence = Number.MAX_SAFE_INTEGER): PerspectiveStateRecord<T>[] {
    return (this.selectRecords.all(projectId, subjectId, throughSequence) as NarrativeRecordRow[])
      .map(row => this.hydrate(row));
  }

  private hydrate(row: NarrativeRecordRow): PerspectiveStateRecord<T> {
    const value = parseJson<unknown>(row.payload_json, row.record_id);
    const validation = this.validate(value);
    if (!validation.success) {
      throw new PerspectiveStateReadError(
        'INVALID_PERSPECTIVE_STATE',
        'Perspective state payload does not conform to Kanora Contract v1.',
        row.record_id,
        validation.issues
      );
    }
    if (validation.value.sourceEventId !== row.source_event_id) {
      throw new PerspectiveStateReadError(
        'PERSPECTIVE_STATE_SOURCE_MISMATCH',
        'Perspective state source event does not match its persisted event.',
        row.record_id
      );
    }
    return {
      value: validation.value,
      sourceEventId: row.source_event_id,
      position: {
        sequence: row.narrative_sequence,
        ...(row.narrative_timestamp ? { timestamp: row.narrative_timestamp } : {})
      },
      appliedAt: row.applied_at
    };
  }
}

function parseJson<T>(value: string, recordId: string): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    throw new PerspectiveStateReadError(
      'MALFORMED_PERSPECTIVE_STATE_JSON',
      'Perspective state payload is not valid JSON.',
      recordId
    );
  }
}

function latestBy<T>(values: T[], key: (value: T) => string): T[] {
  const latest = new Map<string, T>();
  values.forEach(value => latest.set(key(value), value));
  return [...latest.values()];
}

function propositionKey(belief: Belief): string {
  return `${belief.subjectId}\u0000${belief.proposition.subjectId}\u0000${belief.proposition.predicate}`;
}

function toRelationshipRecord(
  record: PerspectiveStateRecord<RelationshipState>
): RelationshipProjectionRecord {
  return {
    relationship: record.value,
    sourceEventId: record.sourceEventId,
    position: record.position,
    appliedAt: record.appliedAt
  };
}
