import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Acquisition, Claim, CommitOutcome, Record as StoryRecord, RecordInput, TransitionInput } from '@kallamo/umwelt' with { 'resolution-mode': 'import' };
import type { Proposition } from '../../../../narrative/contracts';
import { NarrativeWorld, STORY_AXIS } from './narrative-world';
import { storyMinuteFor } from './story-clock';
import { metadataOf, StoryReader } from './story-reader';
import { StoryTimelines } from './story-timelines';
import { claimOfProposition, HOLDS_PREDICATE } from './story-writer';

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
    // A second-order record names the other holder's claim by its key, which changes with its ids.
    const held = next.kind === 'holding' && next.claim.predicate === HOLDS_PREDICATE
      ? (next.provenance?.metadata as { held?: Proposition } | undefined)?.held
      : undefined;
    if (next.kind === 'holding' && held) {
      const claim = claimOfProposition(held, entityId => world.typeOf(entityId) !== undefined);
      next.claim = { ...next.claim, object: { kind: 'value', value: { claimKey: world.raw<{ claimKey: string }>('claim.key', { claim }).claimKey } } };
    }
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

/** Whether a record is about an entity, as opposed to only naming it in passing. */
function isAbout(record: StoryRecord, id: string): boolean {
  if (record.kind === 'awareness' || record.kind === 'disposition') return record.holder === id || record.target === id;
  const object = record.claim.object as { kind: string; id?: string };
  // What someone thinks another holds is about whatever that other's claim is about too.
  const held = record.kind === 'holding' && record.claim.predicate === HOLDS_PREDICATE
    && JSON.stringify(metadataOf(record).held ?? null).includes(JSON.stringify(id));
  return record.claim.subject === id || (object.kind === 'entity' && object.id === id) || (record.kind === 'holding' && record.holder === id) || held;
}

/**
 * Ends what the story holds about or by a deleted entity, and drops it from records that only name
 * it in passing (a memory's related entities, a teller); history keeps both.
 */
/** The story file names an entity as it was first declared, so a Worldbuild rename is carried over. */
export function renameStoryEntity(db: Database.Database, workspaceId: string, entityId: string, name: string): boolean {
  if (!entityId || !name) return false;
  const world = NarrativeWorld.of(db, workspaceId);
  if (!world.exists()) return false;
  try {
    world.call('entity.get', { entityId });
  } catch {
    return false;
  }
  world.call('entity.update', { entityId, name });
  return true;
}

export function retireStoryEntity(db: Database.Database, workspaceId: string, entityId: string): number {
  if (!entityId) return 0;
  const world = NarrativeWorld.of(db, workspaceId);
  if (!world.exists()) return 0;
  const timelineId = new StoryTimelines(world).forMain();
  const records: RecordInput[] = [];
  const transitions: TransitionInput[] = [];
  for (const record of current(world, timelineId).filter(item => mentions(item, entityId))) {
    if (isAbout(record, entityId)) {
      transitions.push({ targetRecordId: record.id, status: 'revoked' });
      continue;
    }
    const metadata = metadataOf(record);
    const named = ['relatedEntityIds', 'informantIds'].filter(key => Array.isArray(metadata[key]) && (metadata[key] as string[]).includes(entityId));
    if (!named.length) continue;
    const id = `${record.id}~${createHash('sha256').update(`${record.id}:-${entityId}`).digest('hex').slice(0, 12)}`;
    const next = carried(record, '', '', id);
    if (!next) continue;
    next.provenance = {
      ...record.provenance,
      metadata: Object.fromEntries(Object.entries(metadata).map(([key, value]) => [key, named.includes(key) ? (value as string[]).filter(item => item !== entityId) : value]))
    };
    records.push(next);
    transitions.push({ targetRecordId: record.id, status: 'superseded', supersededBy: id });
  }
  commit(db, world, timelineId, {
    attemptId: `retire-entity:${entityId}:${transitions.length}`,
    type: 'entity-removed',
    title: 'An entity was removed from the world.',
    participants: [],
    records,
    transitions
  });
  try { world.call('entity.archive', { entityId }); } catch { /* an entity the story never registered has nothing to archive */ }
  return transitions.length;
}

/** How many current story records are about these entities, for the warning before they are deleted. */
export function countStoryReferences(db: Database.Database, workspaceId: string, entityIds: string[]): number {
  const world = NarrativeWorld.of(db, workspaceId);
  if (!world.exists() || !entityIds.length) return 0;
  const reader = new StoryReader(world);
  return current(world, reader.timelineId()).filter(record => entityIds.some(id => isAbout(record, id))).length;
}

/** Entities a story still names that the world no longer has. */
export function orphanedStoryEntities(db: Database.Database): Array<{ workspaceId: string; entityId: string }> {
  const hasTable = (name: string) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
  if (!hasTable('entities') || !hasTable('chats')) return [];
  const orphans: Array<{ workspaceId: string; entityId: string }> = [];
  for (const { id: workspaceId } of db.prepare('SELECT id FROM chats').all() as Array<{ id: string }>) {
    const world = NarrativeWorld.of(db, workspaceId);
    if (!world.exists()) continue;
    const existing = new Set((db.prepare('SELECT id FROM entities WHERE workspaceId = ?').all(workspaceId) as Array<{ id: string }>).map(row => row.id));
    let cursor: string | undefined;
    do {
      const page = world.call<{ items: Array<{ id: string; archived: boolean }>; nextCursor?: string | null }>('entity.list', { page: { limit: 1000, ...(cursor ? { cursor } : {}) } });
      for (const entity of page.items) {
        if (!entity.archived && entity.id !== workspaceId && !existing.has(entity.id)) orphans.push({ workspaceId, entityId: entity.id });
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
  }
  return orphans;
}
