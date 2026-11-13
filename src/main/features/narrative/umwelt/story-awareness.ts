import type Database from 'better-sqlite3';
import { NarrativeWorld } from './narrative-world';
import type { Record as StoryRecord } from '@kallamo/umwelt' with { 'resolution-mode': 'import' };
import { batchOf } from './story-journal';
import { StoryReader } from './story-reader';

const pair = (holderId: string, targetId: string) => `${holderId}\u0000${targetId}`;

interface AwarenessCache { key: string; pairs: Set<string> }
const CACHE = Symbol.for('kallamo.umwelt.awareness');

/**
 * Who currently knows of whom, as holder/target pairs, reused while the story stays the same; null
 * when the workspace has no story yet.
 */
export function awarePairs(db: Database.Database, workspaceId: string): Set<string> | null {
  const world = NarrativeWorld.of(db, workspaceId);
  if (!world.exists()) return null;
  const reader = new StoryReader(world);
  const timelineId = reader.timelineId();
  const key = `${timelineId}\u0000${reader.timeline(timelineId).headVersion}`;
  const holder = world as unknown as Record<symbol, AwarenessCache | undefined>;
  if (holder[CACHE]?.key === key) return holder[CACHE]!.pairs;
  const pairs = new Set<string>();
  for (const holderId of reader.holders()) {
    for (const record of reader.awareness(holderId, { timelineId })) {
      if (record.kind === 'awareness') pairs.add(pair(record.holder, record.target));
    }
  }
  holder[CACHE] = { key, pairs };
  return pairs;
}

/** Whether one holder knows of a target now: one read of that holder, not the whole story. */
export function isAware(db: Database.Database, workspaceId: string, holderId: string, targetId: string): boolean {
  const world = NarrativeWorld.of(db, workspaceId);
  if (!world.exists() || !world.ensureEntities([holderId]).has(holderId)) return false;
  const batch = batchOf(world);
  if (!batch) return new StoryReader(world).awareness(holderId).some(record => record.kind === 'awareness' && record.target === targetId);
  // Inside a bulk write the story is read once per holder, plus what the batch has granted so far.
  if (batch.claimed.has(`aware\u0000${holderId}\u0000${targetId}`)) return true;
  const key = `awareness\u0000${holderId}`;
  let records = batch.reads.get(key) as StoryRecord[] | undefined;
  if (!records) {
    records = new StoryReader(world).awareness(holderId, { timelineId: batch.timelineId });
    batch.reads.set(key, records);
  }
  return records.some(record => record.kind === 'awareness' && record.target === targetId);
}
