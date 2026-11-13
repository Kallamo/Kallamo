import type { TraceResult } from '@kallamo/umwelt' with { 'resolution-mode': 'import' };
import type Database from 'better-sqlite3';
import { NarrativeWorld } from './narrative-world';
import { StoryReader } from './story-reader';

export interface TraceStep {
  recordId: string;
  holderId: string | null;
  holderName: string | null;
  /** How this holder came to hold it: witnessed, told-by, evidence, inferred or authored. */
  how: string;
  fromId: string | null;
  fromName: string | null;
  /** Whether the teller meant it; known to the narrator only, never to the hearer. */
  intent: string | null;
  eventId: string;
  eventDescription: string | null;
  tick: number;
}

export interface StoryTrace {
  status: string | null;
  steps: TraceStep[];
  /** The chain is longer than the engine follows in one read. */
  truncated: boolean;
}

function journalEventId(storyEventId: string): string {
  const at = storyEventId.lastIndexOf('@');
  return at > 0 ? storyEventId.slice(0, at) : storyEventId;
}

/**
 * How a holder came to know something, link by link back to whoever first saw it: who told whom,
 * from which record, in which event. A narrator read, so a deceptive telling shows as one.
 */
export function traceStoryRecord(db: Database.Database, workspaceId: string, recordId: string): StoryTrace | null {
  const world = NarrativeWorld.of(db, workspaceId);
  if (!world.exists() || !recordId) return null;
  let trace: TraceResult;
  try {
    trace = world.call<TraceResult>('trace', { recordId, timelineId: new StoryReader(world).timelineId() });
  } catch (error) {
    if ((error as { code?: string })?.code === 'NOT_FOUND') return null;
    throw error;
  }
  const links = trace.chain.length ? trace.chain : [{ record: trace.record, acquisition: trace.record.kind === 'holding' ? trace.record.acquisition : null }];
  const holderIds = links.flatMap(link => {
    const record = link.record as { holder?: string };
    const acquisition = link.acquisition as { sourceHolderId?: string } | null | undefined;
    return [record.holder, acquisition?.sourceHolderId].filter((id): id is string => Boolean(id));
  });
  const names = world.names([...new Set(holderIds)]);
  const eventIds = [...new Set(links.map(link => journalEventId(link.record.eventId)))];
  const hasJournal = Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'narrative_events'").get());
  const descriptions = new Map(hasJournal && eventIds.length
    ? (db.prepare(`SELECT event_id, description FROM narrative_events WHERE workspace_id = ? AND event_id IN (${eventIds.map(() => '?').join(', ')})`)
      .all(workspaceId, ...eventIds) as Array<{ event_id: string; description: string }>).map(row => [row.event_id, row.description])
    : []);
  return {
    status: trace.status ?? null,
    truncated: trace.truncated,
    steps: links.map(link => {
      const record = link.record as { id: string; holder?: string; eventId: string; position: { tick: number } };
      const acquisition = (link.acquisition ?? null) as { kind?: string; sourceHolderId?: string; intent?: string } | null;
      return {
        recordId: record.id,
        holderId: record.holder ?? null,
        holderName: record.holder ? names.get(record.holder) ?? null : null,
        how: acquisition?.kind ?? 'canon',
        fromId: acquisition?.sourceHolderId ?? null,
        fromName: acquisition?.sourceHolderId ? names.get(acquisition.sourceHolderId) ?? null : null,
        intent: acquisition?.kind === 'told-by' ? acquisition.intent ?? null : null,
        eventId: record.eventId,
        eventDescription: descriptions.get(journalEventId(record.eventId)) ?? null,
        tick: record.position.tick
      };
    })
  };
}
