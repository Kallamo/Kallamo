import { createHash } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { CommitOutcome } from '@kallamo/umwelt' with { 'resolution-mode': 'import' };
import { NarrativeWorld, STORY_AXIS } from './narrative-world';
import { storyMinuteFor } from './story-clock';
import { StoryReader } from './story-reader';
import { StoryTimelines } from './story-timelines';

function hasTable(db: Database.Database, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

/** Records the story file holds for these origins, as the index wrote them. */
export function originRecordIds(db: Database.Database, workspaceId: string, originIds: string[]): string[] {
  if (!originIds.length || !hasTable(db, 'narrative_story_records')) return [];
  return (db.prepare(`
    SELECT record_id FROM narrative_story_records
    WHERE workspace_id = ? AND origin_id IN (${originIds.map(() => '?').join(', ')})
  `).all(workspaceId, ...originIds) as Array<{ record_id: string }>).map(row => row.record_id);
}

/** Notes which origin wrote each record, so the origin can later be taken back exactly. */
export function indexOriginRecords(db: Database.Database, workspaceId: string, originId: string, outcome: CommitOutcome | null): void {
  if (!outcome?.recordIds.length || !hasTable(db, 'narrative_story_records')) return;
  const insert = db.prepare(`
    INSERT OR IGNORE INTO narrative_story_records (workspace_id, record_id, origin_id, event_id, created_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  const now = Date.now();
  for (const recordId of outcome.recordIds) insert.run(workspaceId, recordId, originId, outcome.eventId, now);
}

function currentIds(world: NarrativeWorld, timelineId: string): Set<string> {
  const snapshot = new StoryReader(world).snapshot({ timelineId });
  return new Set([
    ...snapshot.facts.map(record => record.id),
    ...snapshot.holdings.map(item => item.record.id),
    ...snapshot.dispositions.map(record => record.id),
    ...snapshot.awareness.map(record => record.id)
  ]);
}

function retract(db: Database.Database, world: NarrativeWorld, timelineId: string, recordIds: string[], attemptId: string, reason: string, status: 'retracted' | 'forgotten' = 'retracted'): number {
  const active = currentIds(world, timelineId);
  const targets = [...new Set(recordIds)].filter(id => active.has(id));
  if (!targets.length) return 0;
  const reader = new StoryReader(world);
  const main = reader.timeline('main');
  const own = timelineId === 'main' ? main : reader.timeline(timelineId);
  const minute = storyMinuteFor(db, world.workspaceId);
  world.call('transition.batch', {
    attemptId,
    timelineId,
    position: { tick: Math.max(main.maxTick, own.maxTick) + 1 },
    ...(minute !== null ? { on: { [STORY_AXIS]: minute } } : {}),
    status,
    recordIds: targets,
    provenance: { origin: { kind: 'system', name: 'kallamo' }, reason }
  });
  StoryReader.invalidate(world);
  return targets.length;
}

/**
 * Takes back everything these origins wrote: a turn still in its draft is removed outright, and
 * what was already confirmed is retracted, so history keeps it but no current read sees it.
 */
export function retireOrigins(db: Database.Database, workspaceId: string, originIds: string[]): number {
  const origins = [...new Set(originIds.filter(Boolean))];
  if (!origins.length) return 0;
  const world = NarrativeWorld.of(db, workspaceId);
  if (!world.exists()) return 0;
  const timelines = new StoryTimelines(world);
  const confirmed = origins.filter(originId => !timelines.discardTurn(originId));
  const recordIds = originRecordIds(db, workspaceId, confirmed);
  if (!recordIds.length) return 0;
  return retract(db, world, timelines.forMain(), recordIds, `retire:${confirmed.sort().join(',')}:${recordIds.length}`, 'The reply or action that wrote these was removed.');
}

/**
 * A regeneration that takes back confirmed turns hides them in a replacement draft, so cancelling
 * it restores them untouched. The latest turn, still in its own draft, is hidden by its status.
 */
export function beginReplacement(db: Database.Database, workspaceId: string, replacementId: string, originIds: string[]): void {
  const world = NarrativeWorld.of(db, workspaceId);
  if (!world.exists()) return;
  const timelines = new StoryTimelines(world);
  const confirmed = originIds.filter(originId => !timelines.turnDraft(originId));
  const recordIds = originRecordIds(db, workspaceId, confirmed);
  if (!recordIds.length) return;
  const draft = timelines.openReplacement(replacementId);
  retract(db, world, draft, recordIds, `replace:${replacementId}`, 'Replaced by a regenerated reply.');
}

export function completeReplacement(db: Database.Database, workspaceId: string, replacementId: string, originIds: string[]): void {
  const world = NarrativeWorld.of(db, workspaceId);
  if (!world.exists()) return;
  const timelines = new StoryTimelines(world);
  if (!timelines.replacementDraft()) return;
  if (timelines.promoteReplacement(replacementId)) return;
  // The story moved under the draft in a way it no longer fits; the retraction is made in main.
  const confirmed = originIds.filter(originId => !timelines.turnDraft(originId));
  retract(db, world, timelines.forMain(), originRecordIds(db, workspaceId, confirmed), `replace-main:${replacementId}`, 'Replaced by a regenerated reply.');
}

export function cancelReplacement(db: Database.Database, workspaceId: string, replacementId: string): void {
  const world = NarrativeWorld.of(db, workspaceId);
  if (!world.exists()) return;
  new StoryTimelines(world).discardReplacement(replacementId);
  StoryReader.invalidate(world);
}

/** Ends records a cleanup found redundant; they stay in history under the reason given. */
export function retireRecords(db: Database.Database, workspaceId: string, recordIds: string[], reason: string, status: 'retracted' | 'forgotten' = 'retracted'): number {
  const world = NarrativeWorld.of(db, workspaceId);
  if (!recordIds.length || !world.exists()) return 0;
  const ids = [...new Set(recordIds)].sort();
  const attempt = createHash('sha256').update(ids.join('\u0000')).digest('hex').slice(0, 24);
  return retract(db, world, new StoryTimelines(world).forMain(), ids, `cleanup:${status}:${attempt}`, reason, status);
}
