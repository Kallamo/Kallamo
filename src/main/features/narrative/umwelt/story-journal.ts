import type Database from 'better-sqlite3';
import type { NarrativeOperation } from '../../../../narrative/contracts';
import type { NarrativeEventLedgerRecord } from '../../../../narrative/ledger';
import { NarrativeWorld } from './narrative-world';
import { storyMinuteFor } from './story-clock';
import { indexOriginRecords } from './story-lifecycle';
import { StoryTimelines } from './story-timelines';
import { StoryReader } from './story-reader';
import { StoryWriter, type StoryCommitSink, type StoryProvenanceInput, type StoryWriteResult } from './story-writer';

interface StoryBatch extends StoryCommitSink { timelineId: string; commits: Array<Record<string, unknown>> }
const BATCH = Symbol.for('kallamo.umwelt.batch');

/** The bulk write under way in this world, if any; its reads stand for the story until it is sent. */
export function batchOf(world: NarrativeWorld): StoryBatch | undefined {
  return (world as unknown as Record<symbol, StoryBatch | undefined>)[BATCH];
}

/**
 * Sends every story commit of a bulk write in one engine transaction. Inside an SQLite transaction,
 * a failure on either side leaves both unchanged.
 */
export function batchStoryWrites<T>(db: Database.Database, workspaceId: string, work: () => T): T {
  const world = NarrativeWorld.of(db, workspaceId);
  const holder = world as unknown as Record<symbol, StoryBatch | undefined>;
  if (holder[BATCH]) return work();
  const commits: Array<Record<string, unknown>> = [];
  holder[BATCH] = { timelineId: new StoryTimelines(world).forMain(), commits, claimed: new Set(), reads: new Map(), push: commit => commits.push({ ...commit, timelineId: holder[BATCH]!.timelineId }) };
  try {
    const result = work();
    if (commits.length) {
      world.raw('commitBatch', { commits });
      StoryReader.invalidate(world);
    }
    return result;
  } finally {
    holder[BATCH] = undefined;
  }
}

export interface StoryEventWrite {
  eventId: string;
  type?: string;
  description: string;
  participants: string[];
  locationId?: string | null;
  provenance: StoryProvenanceInput;
  operations: NarrativeOperation[];
  /**
   * `turn` writes to the turn's own draft, `current` where the story is read, and `main` (default)
   * to the confirmed story, after earlier turns are confirmed.
   */
  placement?: 'turn' | 'current' | 'main';
  storyMinute?: number | null;
}

/** Confirms every live turn, before a deliberate edit that must not be lost with one of them. */
export function confirmStory(db: Database.Database, workspaceId: string): void {
  new StoryTimelines(NarrativeWorld.of(db, workspaceId)).forMain();
}

/** Writes one journal event's operations into the workspace's story, on the timeline it belongs to. */
export function writeStoryEvent(db: Database.Database, workspaceId: string, input: StoryEventWrite): StoryWriteResult {
  const world = NarrativeWorld.of(db, workspaceId);
  const timelines = new StoryTimelines(world);
  const originId = input.provenance.originType === 'chat-message' ? input.provenance.originId : undefined;
  const placement = input.placement ?? 'main';
  const batch = batchOf(world);
  const timelineId = batch ? batch.timelineId : placement === 'current'
    ? timelines.readTimeline()
    : originId
      ? timelines.turnDraft(originId) ?? (placement === 'turn' ? timelines.forTurn(originId) : timelines.forMain())
      : timelines.forMain();
  return new StoryWriter(world, timelineId, batch).write({
    eventId: input.eventId,
    type: input.type ?? 'custom',
    description: input.description,
    participants: input.participants,
    locationId: input.locationId ?? null,
    provenance: input.provenance,
    operations: input.operations,
    storyMinute: input.storyMinute !== undefined ? input.storyMinute : storyMinuteFor(db, workspaceId, originId),
    attemptId: `journal:${input.eventId}`
  });
}

/**
 * Writes only the operations a review approved, indexed under their origin, since a reply or an
 * occurrence can be removed later.
 */
export function writeLedgerRecord(
  db: Database.Database,
  record: NarrativeEventLedgerRecord,
  options: { operationIds?: Iterable<string>; turn?: boolean; storyMinute?: number | null } = {}
): StoryWriteResult {
  const selected = options.operationIds ? new Set(options.operationIds) : null;
  const event = record.proposal.changeSet.event;
  const evidence = record.proposal.evidence[0];
  const result = writeStoryEvent(db, record.proposal.projectId, {
    eventId: event.id,
    type: event.type,
    description: event.description,
    participants: event.participants.map(participant => participant.entityId),
    locationId: event.locationId ?? null,
    provenance: {
      interpreter: record.proposal.provenance.interpreter,
      ...(record.proposal.provenance.interpreterId ? { interpreterId: record.proposal.provenance.interpreterId } : {}),
      ...(record.proposal.provenance.promptVersion ? { promptVersion: record.proposal.provenance.promptVersion } : {}),
      ...(evidence ? { originType: evidence.originType, originId: evidence.originId, ...(evidence.excerpt ? { excerpt: evidence.excerpt } : {}) } : {})
    },
    operations: record.proposal.changeSet.operations.filter(operation => !selected || selected.has(operation.id)),
    ...(options.turn ? { placement: 'turn' as const } : {}),
    ...(options.storyMinute !== undefined ? { storyMinute: options.storyMinute } : {})
  });
  if (evidence?.originId) indexOriginRecords(db, record.proposal.projectId, evidence.originId, result.outcome);
  return result;
}
