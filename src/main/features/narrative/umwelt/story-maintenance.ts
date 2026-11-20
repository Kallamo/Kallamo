import type Database from 'better-sqlite3';
import type { EventPageResult, Record as StoryRecord, RecordInput } from '@kallamo/umwelt' with { 'resolution-mode': 'import' };
import { fadeAfterDays } from '../memory-relevance';
import { NarrativeWorld, STORY_AXIS } from './narrative-world';
import { lastRecordUse } from './record-use';
import { kindOf, metadataOf, StoryReader } from './story-reader';
import { StoryTimelines } from './story-timelines';

const MINUTES_PER_DAY = 24 * 60;

export interface FadedRecord { holderId: string; recordId: string; text: string; idleDays: number }

function hasTable(db: Database.Database, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

/** The story-axis minute of every event the timeline reads, by event id. */
function eventMinutes(world: NarrativeWorld, timelineId: string): Map<string, number> {
  const minutes = new Map<string, number>();
  let cursor: string | undefined;
  do {
    const page = world.call<EventPageResult>('timeline', { timelineId, page: { limit: 500, ...(cursor ? { cursor } : {}) } });
    for (const event of page.items) {
      const minute = event.on?.[STORY_AXIS];
      if (Number.isFinite(minute)) minutes.set(event.id, minute as number);
    }
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  return minutes;
}

/**
 * Takes out of reach what the story pass wrote and its holders left unused past its relevance; what a
 * person wrote stays. The copy is written on the turn's timeline, so taking the turn back undoes it.
 */
export function fadeIdleRecords(
  db: Database.Database,
  workspaceId: string,
  input: { originId: string; holderIds: string[]; nowMinute: number | null }
): FadedRecord[] {
  if (input.nowMinute === null || !Number.isFinite(input.nowMinute) || !input.holderIds.length) return [];
  const world = NarrativeWorld.of(db, workspaceId);
  if (!world.exists()) return [];
  const timelines = new StoryTimelines(world);
  const timelineId = timelines.turnDraft(input.originId) ?? timelines.forTurn(input.originId);
  const reader = new StoryReader(world);
  const known = world.ensureEntities(input.holderIds);
  const candidates: Array<{ holderId: string; record: StoryRecord; days: number }> = [];
  for (const holderId of input.holderIds) {
    if (!known.has(holderId)) continue;
    for (const item of reader.holdings(holderId, { timelineId, includeWithheld: false })) {
      const record = item.record;
      if (record.kind !== 'holding' || record.accessibility !== 'available') continue;
      const kind = kindOf(record);
      if (kind !== 'memory' && kind !== 'knowledge') continue;
      if ((record.provenance?.origin as { kind?: string } | undefined)?.kind !== 'model') continue;
      const meta = metadataOf(record);
      const days = fadeAfterDays(meta.salience, meta.category);
      if (days !== null) candidates.push({ holderId, record, days });
    }
  }
  if (!candidates.length) return [];
  const minutes = eventMinutes(world, timelineId);
  const uses = lastRecordUse(db, workspaceId, candidates.map(candidate => candidate.record.id));
  const now = input.nowMinute;
  const idle = candidates.flatMap(candidate => {
    const since = Math.max(minutes.get(candidate.record.eventId) ?? -Infinity, uses.get(candidate.record.id) ?? -Infinity);
    if (!Number.isFinite(since)) return [];
    const idleDays = (now - since) / MINUTES_PER_DAY;
    return idleDays > candidate.days ? [{ ...candidate, idleDays }] : [];
  });
  if (!idle.length) return [];

  const suffix = input.originId.replace(/[^A-Za-z0-9_-]/g, '').slice(-24) || 'turn';
  const copies: RecordInput[] = idle.map(({ record }) => {
    const holding = record as Extract<StoryRecord, { kind: 'holding' }>;
    return {
      kind: 'holding',
      id: `${record.id}~reach-${suffix}`,
      holder: holding.holder,
      attitude: holding.attitude,
      claim: holding.claim,
      acquisition: holding.acquisition,
      confidence: holding.confidence,
      accessibility: 'suppressed',
      ...(holding.text ? { text: holding.text } : {}),
      ...(holding.secrecy ? { secrecy: holding.secrecy } : {}),
      provenance: { ...holding.provenance, metadata: { ...metadataOf(record), fadedFrom: record.id } }
    };
  });
  const main = reader.timeline('main');
  const own = timelineId === 'main' ? main : reader.timeline(timelineId);
  const outcome = world.call<{ eventId: string; recordIds: string[] }>('commit', {
    attemptId: `fade:${input.originId}`,
    timelineId,
    event: {
      type: 'maintenance',
      title: 'Unused memories slip out of reach',
      position: { tick: Math.max(main.maxTick, own.maxTick) + 1 },
      on: { [STORY_AXIS]: Math.round(now) },
      provenance: { origin: { kind: 'system', name: 'kallamo' }, reason: 'Memories and knowledge left unused for longer than their relevance allows.' }
    },
    records: copies,
    transitions: idle.map(({ record }, index) => ({ targetRecordId: record.id, status: 'superseded', supersededBy: copies[index].id }))
  });
  StoryReader.invalidate(world);
  if (hasTable(db, 'narrative_story_records')) {
    const insert = db.prepare(`
      INSERT OR IGNORE INTO narrative_story_records (workspace_id, record_id, origin_id, event_id, created_at)
      VALUES (?, ?, ?, ?, ?)
    `);
    for (const id of outcome.recordIds) insert.run(workspaceId, id, input.originId, outcome.eventId, Date.now());
  }
  return idle.map(({ holderId, record, idleDays }) => ({ holderId, recordId: record.id, text: String((record as { text?: string | null }).text ?? ''), idleDays: Math.round(idleDays) }));
}
