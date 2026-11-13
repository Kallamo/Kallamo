import type Database from 'better-sqlite3';
import { NarrativeWorld } from './narrative-world';
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
  return new StoryReader(world).awareness(holderId).some(record => record.kind === 'awareness' && record.target === targetId);
}
