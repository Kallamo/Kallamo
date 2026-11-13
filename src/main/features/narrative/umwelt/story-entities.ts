import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Acquisition, Claim, CommitOutcome, Record as StoryRecord, RecordInput, TransitionInput } from '@kallamo/umwelt' with { 'resolution-mode': 'import' };
import { NarrativeWorld, STORY_AXIS } from './narrative-world';
import { storyMinuteFor } from './story-clock';
import { metadataOf, StoryReader } from './story-reader';
import { StoryTimelines } from './story-timelines';

function swap<T>(value: T, from: string, to: string): T {
  if (value === from) return to as T;
  if (Array.isArray(value)) return [...new Set(value.map(item => swap(item, from, to)))] as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, swap(item, from, to)])) as T;
  }
  return value;
}

function mentions(record: StoryRecord, id: string): boolean {
  return JSON.stringify(record).includes(JSON.stringify(id));
}

function current(world: NarrativeWorld, timelineId: string): StoryRecord[] {
  const snapshot = new StoryReader(world).snapshot({ timelineId });
  return [...snapshot.facts, ...snapshot.holdings.map(item => item.record), ...snapshot.dispositions, ...snapshot.awareness];
}

function commit(db: Database.Database, world: NarrativeWorld, timelineId: string, input: { attemptId: string; type: string; title: string; participants: string[]; records: RecordInput[]; transitions: TransitionInput[] }): CommitOutcome | null {
  if (!input.records.length && !input.transitions.length) return null;
  const main = new StoryReader(world).timeline('main');
  const minute = storyMinuteFor(db, world.workspaceId);
  const outcome = world.call<CommitOutcome>('commit', {
    attemptId: input.attemptId,
    timelineId,
    event: {
      type: input.type,
      title: input.title,
      position: { tick: main.maxTick + 1 },
      ...(minute !== null ? { on: { [STORY_AXIS]: minute } } : {}),
      participants: input.participants,
      provenance: { origin: { kind: 'system', name: 'kallamo' } }
    },
    records: input.records,
    transitions: input.transitions
  });
  StoryReader.invalidate(world);
  return outcome;
}

/** The record as written again under the surviving entity, or null when it would point at itself. */
function carried(record: StoryRecord, from: string, to: string, id: string): RecordInput | null {
  const provenance = swap(record.provenance, from, to);
  switch (record.kind) {
    case 'fact':
      return { kind: 'fact', id, claim: swap(record.claim, from, to) as Claim, provenance };
    case 'holding': {
      const acquisition = swap(record.acquisition, from, to) as Acquisition;
      const holder = record.holder === from ? to : record.holder;
      const told = acquisition.kind === 'told-by' && acquisition.sourceHolderId === holder
        ? { kind: 'authored' as const }
        : acquisition;
      return {
        kind: 'holding', id, holder, attitude: record.attitude, claim: swap(record.claim, from, to) as Claim,
        acquisition: told, confidence: record.confidence, accessibility: record.accessibility,
        ...(record.text ? { text: record.text } : {}),
        ...(record.secrecy ? { secrecy: swap(record.secrecy, from, to) } : {}),
        provenance
      };
    }
    case 'disposition': {
      const holder = record.holder === from ? to : record.holder;
      const target = record.target === from ? to : record.target;
      if (holder === target) return null;
      return { kind: 'disposition', id, holder, target, dimension: record.dimension, value: record.value, provenance };
    }
    case 'awareness': {
      const holder = record.holder === from ? to : record.holder;
      const target = record.target === from ? to : record.target;
      if (holder === target) return null;
      return { kind: 'awareness', id, holder, target, provenance };
    }
  }
}

/**
 * Records cannot be edited, so each one naming the merged entity is written again under the
 * survivor and supersedes the original; a bond or awareness turned onto the survivor itself ends.
 */
export function mergeStoryEntity(db: Database.Database, workspaceId: string, sourceId: string, targetId: string): number {
  if (!sourceId || !targetId || sourceId === targetId) return 0;
  const world = NarrativeWorld.of(db, workspaceId);
  if (!world.exists() || !world.ensureEntities([targetId]).has(targetId)) return 0;
  const timelineId = new StoryTimelines(world).forMain();
  const records = current(world, timelineId);
  const awareAlready = new Set(records.filter(record => record.kind === 'awareness').map(record => record.kind === 'awareness' ? `${record.holder}>${record.target}` : ''));
  const writes: RecordInput[] = [];
  const transitions: TransitionInput[] = [];
  for (const record of records.filter(item => mentions(item, sourceId))) {
    const id = `${record.id}~${createHash('sha256').update(`${record.id}:${targetId}`).digest('hex').slice(0, 12)}`;
    const next = carried(record, sourceId, targetId, id);
    const duplicate = next?.kind === 'awareness' && awareAlready.has(`${next.holder}>${next.target}`);
    if (!next || duplicate) {
      transitions.push({ targetRecordId: record.id, status: 'revoked' });
      continue;
    }
    if (next.kind === 'awareness') awareAlready.add(`${next.holder}>${next.target}`);
    writes.push(next);
    transitions.push({ targetRecordId: record.id, status: 'superseded', supersededBy: id });
  }
  commit(db, world, timelineId, {
    attemptId: `merge:${sourceId}:${targetId}:${records.length}`,
    type: 'entity-merge',
    title: 'Two entities were merged.',
    participants: [targetId],
    records: writes,
    transitions
  });
  return transitions.length;
}

/** Ends everything the story holds about or by a deleted entity; history keeps it. */
export function retireStoryEntity(db: Database.Database, workspaceId: string, entityId: string): number {
  if (!entityId) return 0;
  const world = NarrativeWorld.of(db, workspaceId);
  if (!world.exists()) return 0;
  const timelineId = new StoryTimelines(world).forMain();
  const targets = current(world, timelineId).filter(record => mentions(record, entityId)
    || (metadataOf(record).relatedEntityIds as string[] | undefined)?.includes(entityId));
  commit(db, world, timelineId, {
    attemptId: `retire-entity:${entityId}:${targets.length}`,
    type: 'entity-removed',
    title: 'An entity was removed from the world.',
    participants: [],
    records: [],
    transitions: [...new Set(targets.map(record => record.id))].map(id => ({ targetRecordId: id, status: 'revoked' as const }))
  });
  return targets.length;
}
