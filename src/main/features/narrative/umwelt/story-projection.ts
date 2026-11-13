import type { Acquisition, At, Record as StoryRecord } from '@kallamo/umwelt' with { 'resolution-mode': 'import' };
import type { NarrativeWorld } from './narrative-world';
import { isGenericPredicate, normalizePredicate, propositionIdentity, statementKey } from '../../../../narrative/narrative-taxonomy';
import { kindOf, metadataOf, objectOf, StoryReader, type StoryKind } from './story-reader';

export type ProjectedRecordType = 'fact' | 'state' | 'knowledge' | 'belief' | 'memory' | 'relationship' | 'observation';

export interface ProjectedRow {
  record_type: ProjectedRecordType;
  record_id: string;
  subject_id: string;
  source_event_id: string;
  payload_json: string;
  narrative_sequence: number;
}

export interface ProjectedStoryRecord {
  row: ProjectedRow;
  payload: Record<string, unknown>;
  /** The engine record behind it, for reads that go beyond the projection. */
  record: StoryRecord;
}

function compact(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null));
}

function methodOf(acquisition: Acquisition | undefined): string {
  if (!acquisition) return 'reported';
  if (acquisition.kind === 'witnessed') return 'witness';
  if (acquisition.kind === 'inferred') return 'inferred';
  return 'reported';
}

/** A stored record in the shape Kallamo's narrative payloads have always had. */
export function projectStoryRecord(record: StoryRecord): ProjectedStoryRecord | null {
  const kind = kindOf(record);
  if (kind === 'awareness') return null;
  const meta = metadataOf(record);
  const common = { id: record.id };
  let payload: Record<string, unknown>;
  let subjectId = '';
  if (record.kind === 'disposition') {
    subjectId = record.holder;
    payload = compact({
      ...common,
      sourceEntityId: record.holder,
      targetEntityId: record.target,
      dimension: record.dimension,
      value: Number(record.value),
      title: meta.title,
      description: meta.description,
      cause: meta.cause,
      previousValue: meta.previousValue,
      requestedValue: meta.requestedValue,
      occurredOn: meta.occurredOn,
      sourceEventId: record.eventId
    });
  } else if (record.kind === 'fact') {
    if (kind === 'state') {
      payload = {
        entityId: record.claim.subject,
        property: record.claim.predicate.replace(/^state:/, ''),
        value: objectOf(record.claim),
        effectiveFrom: { sequence: record.position.tick }
      };
    } else {
      payload = compact({
        ...common,
        referenceId: meta.referenceId,
        proposition: { subjectId: record.claim.subject, predicate: record.claim.predicate, object: objectOf(record.claim) },
        relatedEntityIds: meta.relatedEntityIds,
        category: meta.category,
        status: 'active',
        evidenceIds: meta.evidenceIds ?? []
      });
    }
  } else if (record.kind === 'holding') {
    subjectId = record.holder;
    if (kind === 'memory') {
      payload = compact({
        ...common,
        entryId: meta.entryId !== record.id ? meta.entryId : undefined,
        subjectId: record.holder,
        eventId: record.eventId,
        summary: record.text ?? '',
        accessibility: record.accessibility,
        category: meta.category,
        status: 'active',
        relatedEntityIds: meta.relatedEntityIds,
        occurredOn: meta.occurredOn
      });
    } else if (kind === 'observation') {
      payload = compact({
        ...common,
        subjectId: record.holder,
        eventId: record.eventId,
        summary: record.text ?? '',
        method: meta.method,
        confidence: record.confidence,
        accessibility: record.accessibility,
        factIds: meta.factIds,
        status: 'active'
      });
    } else {
      const proposition = { subjectId: record.claim.subject, predicate: record.claim.predicate, object: objectOf(record.claim) };
      payload = compact({
        ...common,
        entryId: meta.entryId,
        subjectId: record.holder,
        proposition,
        sourceEventId: record.eventId,
        confidence: record.confidence,
        accessibility: record.accessibility,
        status: 'active',
        category: meta.category,
        factIds: meta.factIds,
        ...(kind === 'knowledge'
          ? { acquisition: meta.method ?? methodOf(record.acquisition), informantIds: meta.informantIds }
          : { relationToCanon: meta.relationToCanon ?? 'unknown' })
      });
    }
  } else {
    return null;
  }
  return {
    row: {
      record_type: kind as ProjectedRecordType,
      record_id: record.kind === 'fact' && kind === 'state' ? String(meta.op ?? record.id) : record.id,
      subject_id: subjectId,
      source_event_id: record.eventId,
      payload_json: JSON.stringify(payload),
      narrative_sequence: record.position.tick
    },
    payload,
    record
  };
}

export interface LoadStoryRecordsInput {
  recordTypes: ProjectedRecordType[];
  subjectIds?: string[];
  at?: At;
  timelineId?: string;
}

/** Current records of the story, in story order, filtered the way the old projection was. */
export function loadStoryRecords(world: NarrativeWorld, input: LoadStoryRecordsInput): ProjectedStoryRecord[] {
  if (!input.recordTypes.length || input.subjectIds?.length === 0) return [];
  const types = new Set<StoryKind | ProjectedRecordType>(input.recordTypes);
  const subjects = input.subjectIds ? new Set(input.subjectIds) : null;
  const snapshot = new StoryReader(world).snapshot({ ...(input.timelineId ? { timelineId: input.timelineId } : {}), ...(input.at ? { at: input.at } : {}) });
  const records = [
    ...(types.has('fact') || types.has('state') ? snapshot.facts : []),
    ...snapshot.holdings.map(item => item.record),
    ...(types.has('relationship') ? snapshot.dispositions : [])
  ];
  const canon = types.has('belief') ? canonSlots(snapshot.facts) : null;
  return records
    .map(projectStoryRecord)
    .filter((item): item is ProjectedStoryRecord => Boolean(item))
    .filter(item => types.has(item.row.record_type))
    .filter(item => !subjects || subjects.has(item.row.subject_id))
    .map(item => canon && item.row.record_type === 'belief' ? withCanonRelation(item, canon) : item)
    .sort((a, b) => a.row.narrative_sequence - b.row.narrative_sequence || a.record.recordedAt - b.record.recordedAt);
}

interface CanonSlots { statements: Set<string>; slots: Map<string, Set<string>> }

/** The canon a belief is held against: every Fact by its statement, and by slot under a specific predicate. */
function canonSlots(facts: StoryRecord[]): CanonSlots {
  const statements = new Set<string>();
  const slots = new Map<string, Set<string>>();
  for (const fact of facts) {
    if (fact.kind !== 'fact') continue;
    const object = objectOf(fact.claim);
    statements.add(propositionIdentity(fact.claim.subject, fact.claim.predicate, object));
    if (isGenericPredicate(fact.claim.predicate)) continue;
    const slot = `${fact.claim.subject}\u0000${normalizePredicate(fact.claim.predicate)}`;
    slots.set(slot, (slots.get(slot) ?? new Set()).add(statementKey(object)));
  }
  return { statements, slots };
}

/**
 * Canon matches a belief when it states the same, and contradicts it with another value in the same
 * slot (one subject, one specific predicate). An author's own classification is kept.
 */
function withCanonRelation(item: ProjectedStoryRecord, canon: CanonSlots): ProjectedStoryRecord {
  if (item.record.kind !== 'holding' || metadataOf(item.record).relationToCanon) return item;
  const { claim } = item.record;
  const object = objectOf(claim);
  let relation: 'aligned' | 'contradicted' | 'unknown' = 'unknown';
  if (canon.statements.has(propositionIdentity(claim.subject, claim.predicate, object))) relation = 'aligned';
  else if (!isGenericPredicate(claim.predicate)) {
    const values = canon.slots.get(`${claim.subject}\u0000${normalizePredicate(claim.predicate)}`);
    if (values?.size) relation = values.has(statementKey(object)) ? 'aligned' : 'contradicted';
  }
  if (relation === 'unknown') return item;
  const payload = { ...item.payload, relationToCanon: relation };
  return { ...item, payload, row: { ...item.row, payload_json: JSON.stringify(payload) } };
}

/** Who knows whom, as current awareness records. */
export function loadStoryAwareness(world: NarrativeWorld, options: { at?: At; timelineId?: string } = {}): Array<{ subjectId: string; targetId: string; id: string; eventId: string; tick: number }> {
  return new StoryReader(world).snapshot(options).awareness
    .filter(record => record.kind === 'awareness')
    .map(record => record.kind === 'awareness'
      ? { subjectId: record.holder, targetId: record.target, id: record.id, eventId: record.eventId, tick: record.position.tick }
      : null!)
    .filter(Boolean);
}
