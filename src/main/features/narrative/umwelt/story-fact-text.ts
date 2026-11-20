import type Database from 'better-sqlite3';
import type { Record as StoryRecord, RecordInput, TraceResult } from '@kallamo/umwelt' with { 'resolution-mode': 'import' };
import { NarrativeWorld } from './narrative-world';
import { StoryReader } from './story-reader';
import { StoryTimelines } from './story-timelines';
import { factTextOf } from './story-writer';

const done = new Set<string>();

function hasTable(db: Database.Database, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

/**
 * Gives every current Fact without search text a copy that has it, superseding the old one at the
 * same story position, so search and vectors read names instead of ids. A turn still in its draft
 * is waited for; once nothing is left, later calls in this process return at once.
 */
export function addFactTexts(db: Database.Database, workspaceId: string): number {
  const key = `${db.name}\u0000${workspaceId}`;
  if (done.has(key)) return 0;
  const world = NarrativeWorld.of(db, workspaceId);
  if (!world.exists()) return 0;
  if (new StoryTimelines(world).readTimeline() !== 'main') return 0;
  const reader = new StoryReader(world);
  const pending = reader.facts({ timelineId: 'main' })
    .filter((record): record is Extract<StoryRecord, { kind: 'fact' }> => record.kind === 'fact' && !(record as { text?: string | null }).text);
  if (!pending.length) {
    done.add(key);
    return 0;
  }
  const names = world.names([...new Set(pending.flatMap(record => [record.claim.subject, ...(record.claim.object.kind === 'entity' ? [record.claim.object.id] : [])]))]);
  const byEvent = new Map<string, typeof pending>();
  for (const record of pending) byEvent.set(record.eventId, [...(byEvent.get(record.eventId) ?? []), record]);
  const remap = hasTable(db, 'narrative_story_records')
    ? db.prepare(`
        INSERT OR IGNORE INTO narrative_story_records (workspace_id, record_id, origin_id, event_id, created_at)
        SELECT workspace_id, ?, origin_id, ?, ? FROM narrative_story_records WHERE workspace_id = ? AND record_id = ?
      `)
    : null;
  let written = 0;
  for (const [eventId, records] of byEvent) {
    // The copy keeps the story-axis position of the event that wrote the original.
    const on = world.call<TraceResult>('trace', { recordId: records[0].id, timelineId: 'main' }).event.on;
    const copies: RecordInput[] = records.map(record => ({
      kind: 'fact',
      id: `${record.id}.text`,
      claim: record.claim,
      provenance: record.provenance,
      text: factTextOf(record.claim, id => names.get(id), workspaceId)
    }));
    const outcome = world.call<{ eventId: string; recordIds: string[] }>('commit', {
      attemptId: `fact-text:${eventId}`,
      timelineId: 'main',
      event: {
        type: 'maintenance',
        title: 'Search text for earlier facts',
        position: { tick: reader.timeline('main').maxTick + 1 },
        ...(on && Object.keys(on).length ? { on } : {}),
        provenance: { origin: { kind: 'system', name: 'kallamo' }, reason: 'Earlier facts get the text that search reads.' }
      },
      records: copies,
      transitions: records.map(record => ({ targetRecordId: record.id, status: 'superseded', supersededBy: `${record.id}.text` }))
    });
    StoryReader.invalidate(world);
    // A turn taken back later must also take back the copy of what it wrote.
    if (remap) for (const record of records) remap.run(`${record.id}.text`, outcome.eventId, Date.now(), workspaceId, record.id);
    written += copies.length;
  }
  done.add(key);
  return written;
}
