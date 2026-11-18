import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { NarrativeStateSystem, STORY_PASS_MAX_ATTEMPTS } from '../../src/main/features/narrative/narrative-state';
import { openFullSchemaDatabase, type FullSchemaDatabase } from '../database/full-schema-harness';

const WS = 'ws';
let harness: FullSchemaDatabase;
let state: NarrativeStateSystem;

beforeEach(() => {
  harness = openFullSchemaDatabase();
  state = new NarrativeStateSystem(harness.db);
});
afterEach(() => harness.close());

describe('the story pass queue', () => {
  test('runs the oldest turn first and never queues a recorded turn again', () => {
    state.queueStory(WS, 't1', { domains: ['knowledge'] });
    state.queueStory(WS, 't2', { domains: ['memory'] });
    expect(state.nextQueuedStory(WS)?.originId).toBe('t1');
    expect(state.nextQueuedStory(WS)?.handoff).toEqual({ domains: ['knowledge'] });

    state.beginStory(WS, 't1');
    state.finishStory(WS, 't1', 'completed', { inputTokens: 10, outputTokens: 5 });
    expect(state.nextQueuedStory(WS)?.originId).toBe('t2');

    state.queueStory(WS, 't1', { domains: ['fact'] });
    expect(state.getStory(WS, 't1')).toEqual(expect.objectContaining({ status: 'completed', handoff: { domains: ['knowledge'] } }));
  });

  test('a pass left processing by a closed app runs again, and a skipped turn is passed over', () => {
    state.queueStory(WS, 't1', {});
    state.beginStory(WS, 't1');
    expect(state.nextQueuedStory(WS)?.originId).toBe('t1');
    expect(state.nextQueuedStory(WS, ['t1'])).toBeNull();
  });

  test('a failed pass runs again until it has used its attempts, then waits for a reprocess', () => {
    state.queueStory(WS, 't1', {});
    state.queueStory(WS, 't2', {});
    for (let attempt = 1; attempt <= STORY_PASS_MAX_ATTEMPTS; attempt += 1) {
      expect(state.nextQueuedStory(WS)?.originId).toBe('t1');
      state.beginStory(WS, 't1');
      state.finishStory(WS, 't1', 'failed', { error: 'fetch failed (ECONNRESET: read ECONNRESET)' });
    }
    expect(state.getStory(WS, 't1')).toEqual(expect.objectContaining({ status: 'failed', attempts: STORY_PASS_MAX_ATTEMPTS }));
    expect(state.nextQueuedStory(WS)?.originId).toBe('t2');
    expect(state.listStalledStories(WS).map(job => job.originId)).toEqual(['t1']);

    state.queueStory(WS, 't1', {});
    expect(state.getStory(WS, 't1')).toEqual(expect.objectContaining({ status: 'queued', attempts: 0 }));
    expect(state.listStalledStories(WS)).toEqual([]);
  });

  test('a pass that keeps stopping mid-run is not picked up forever', () => {
    state.queueStory(WS, 't1', {});
    for (let attempt = 0; attempt < STORY_PASS_MAX_ATTEMPTS; attempt += 1) state.beginStory(WS, 't1');
    expect(state.nextQueuedStory(WS)).toBeNull();
    expect(state.listStalledStories(WS).map(job => job.originId)).toEqual(['t1']);
  });

  test('a reply that no longer stands is not active', () => {
    harness.db.prepare(`INSERT INTO narrative_origin_lifecycle (workspace_id, origin_id, status, replacement_origin_id, updated_at) VALUES (?, 'gone', 'deleted', NULL, 1)`).run(WS);
    expect(state.isOriginActive(WS, 'gone')).toBe(false);
    expect(state.isOriginActive(WS, 'never-analysed')).toBe(true);
  });
});
