import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import { NarrativeStateSystem, type ExtractedNarrativeEvent } from '../../src/main/features/narrative/narrative-state';
import { NarrativeWorld } from '../../src/main/features/narrative/umwelt/narrative-world';
import { loadStoryAwareness, loadStoryRecords } from '../../src/main/features/narrative/umwelt/story-projection';
import { StoryReader } from '../../src/main/features/narrative/umwelt/story-reader';
import { StoryTimelines } from '../../src/main/features/narrative/umwelt/story-timelines';
import { openTestDatabase } from '../sqlite-test-database';

const WORKSPACE = 'workspace-one';
const TYPES = ['fact', 'knowledge', 'belief', 'memory', 'relationship'] as const;

// The fields every reader of a narrative payload uses.
function normalize(rows: Array<{ row: { record_type: string; record_id: string }; payload: Record<string, unknown> }>) {
  return rows.map(({ row, payload }) => ({
    type: row.record_type,
    id: row.record_id,
    subjectId: payload.subjectId ?? payload.sourceEntityId ?? null,
    proposition: payload.proposition ?? null,
    summary: payload.summary ?? null,
    targetEntityId: payload.targetEntityId ?? null,
    dimension: payload.dimension ?? null,
    value: payload.value ?? null,
    category: payload.category ?? null,
    acquisition: payload.acquisition ?? null,
    informantIds: payload.informantIds ?? null,
    accessibility: payload.accessibility ?? 'available',
    confidence: payload.confidence ?? null,
    entryId: payload.entryId ?? null
  })).sort((a, b) => a.id.localeCompare(b.id));
}

describe('Narrative records in the story file', () => {
  let directory: string;
  let db: Database.Database;
  let system: NarrativeStateSystem;
  const allowed = new Set(['elias', 'tess', 'guild']);

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'kallamo-story-equivalence-'));
    db = openTestDatabase(join(directory, 'state.db'));
    db.pragma('foreign_keys = ON');
    runDatabaseMigrations(db);
    db.exec(`CREATE TABLE entity_links (
      id TEXT PRIMARY KEY, workspaceId TEXT, fromId TEXT, relType TEXT,
      toId TEXT, label TEXT, metadata_json TEXT, createdAt INTEGER
    )`);
    system = new NarrativeStateSystem(db);
  });

  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  function input(originId: string, event: ExtractedNarrativeEvent) {
    return { workspaceId: WORKSPACE, originId, interpreterId: 'system-model', event, allowedEntityIds: allowed, storyMinute: null };
  }

  function play() {
    system.createEvent(input('turn-1', {
      type: 'revelation', description: 'Tess reveals the gate code to Elias.', excerpt: 'The gate code is Dawnfall.',
      participantIds: ['tess', 'elias'], confidence: 0.98,
      operations: [
        { type: 'awareness', subjectId: 'elias', targetId: 'guild', confidence: 0.98 },
        { type: 'knowledge', subjectId: 'tess', proposition: { subjectId: 'guild', predicate: 'gate-code', object: 'Dawnfall' }, category: 'capability', acquisition: 'witness', confidence: 0.98 },
        { type: 'knowledge', subjectId: 'elias', proposition: { subjectId: 'guild', predicate: 'gate-code', object: 'Dawnfall' }, category: 'capability', acquisition: 'reported', informantIds: ['tess'], confidence: 0.98 },
        { type: 'memory', subjectId: 'elias', summary: 'Tess trusted Elias with the gate code.', category: 'bond', salience: 0.92 },
        { type: 'fact', proposition: { subjectId: 'guild', predicate: 'founded-in', object: 'the old harbor' }, category: 'history', confidence: 0.98 }
      ]
    }));
    const review = system.createEvent(input('turn-2', {
      type: 'deception', description: 'Tess accuses the guild of betrayal.', excerpt: 'The guild sold us out.',
      participantIds: ['tess', 'elias'], confidence: 0.95,
      operations: [
        { type: 'belief', subjectId: 'elias', proposition: { subjectId: 'guild', predicate: 'betrayed-party', object: 'elias' }, category: 'secret', confidence: 0.72 },
        { type: 'relationship', sourceEntityId: 'elias', targetEntityId: 'guild', dimension: 'trust', value: -35, cause: 'betrayal', description: 'Elias believes the accusation.' }
      ]
    }));
    system.resolveEvent(WORKSPACE, review.record!.proposal.changeSet.event.id, 'approved');
    system.createEvent(input('turn-3', {
      type: 'custom', description: 'Tess and Elias share a meal.', excerpt: 'They eat in silence.',
      participantIds: ['tess', 'elias'], confidence: 0.98,
      operations: [
        { type: 'relationship', sourceEntityId: 'tess', targetEntityId: 'elias', dimension: 'overall', value: 20, cause: 'first-impression', impact: 'meaningful' },
        { type: 'fact', proposition: { subjectId: 'guild', predicate: 'founded-in', object: 'the new harbor' }, category: 'history', confidence: 0.98 }
      ]
    }));
  }

  test('holds the current records of a played campaign, each awareness pair once', () => {
    play();
    const world = NarrativeWorld.of(db, WORKSPACE);
    const story = normalize(loadStoryRecords(world, { recordTypes: [...TYPES] }));
    expect(story.map(item => [item.type, item.subjectId, (item.proposition as any)?.object ?? item.summary ?? item.value])).toEqual(expect.arrayContaining([
      ['knowledge', 'tess', 'Dawnfall'],
      ['knowledge', 'elias', 'Dawnfall'],
      ['memory', 'elias', 'Tess trusted Elias with the gate code.'],
      ['fact', null, 'the new harbor'],
      ['belief', 'elias', 'elias'],
      ['relationship', 'elias', -25],
      ['relationship', 'tess', 20]
    ]));
    expect(story).toHaveLength(7);
    expect(story.find(item => item.subjectId === 'elias' && item.type === 'knowledge')).toMatchObject({ acquisition: 'reported', informantIds: ['tess'], category: 'capability' });
    const pairs = loadStoryAwareness(world).map(item => `${item.subjectId}>${item.targetId}`);
    expect(pairs).toHaveLength(new Set(pairs).size);
    expect(pairs).toEqual(expect.arrayContaining(['elias>guild', 'elias>tess']));
  });

  test('hearsay keeps the record it was told from, so the chain can be traced', () => {
    play();
    const world = NarrativeWorld.of(db, WORKSPACE);
    const told = loadStoryRecords(world, { recordTypes: ['knowledge'], subjectIds: ['elias'] })[0];
    expect(told.record.kind === 'holding' && told.record.acquisition).toMatchObject({ kind: 'told-by', sourceHolderId: 'tess' });
    const trace = world.call<{ chain: Array<{ record: { holder?: string } }> }>('trace', { recordId: told.record.id, timelineId: new StoryTimelines(world).readTimeline() });
    expect(trace.chain.map(link => link.record.holder)).toEqual(['elias', 'tess']);
  });

  test('a revised value supersedes the old one and history stays readable', () => {
    play();
    const world = NarrativeWorld.of(db, WORKSPACE);
    const facts = loadStoryRecords(world, { recordTypes: ['fact'] });
    expect(facts.map(fact => (fact.payload.proposition as { object: unknown }).object)).toEqual(['the new harbor']);
    const first = facts[0].record.position.tick;
    const before = loadStoryRecords(world, { recordTypes: ['fact'], at: { tick: first - 1 } });
    expect(before.map(fact => (fact.payload.proposition as { object: unknown }).object)).toEqual(['the old harbor']);
  });

  test('the latest analysed turn waits in its own draft until the next turn confirms it', () => {
    play();
    const world = NarrativeWorld.of(db, WORKSPACE);
    const timelines = new StoryTimelines(world);
    expect(timelines.turnDraft('turn-3')).toBe('turn-turn-3');
    expect(timelines.turnDraft('turn-1')).toBeNull();
    expect(timelines.readTimeline()).toBe('turn-turn-3');
    // Main holds every confirmed turn and nothing of the open one.
    const confirmed = new StoryReader(world).dispositions('tess', { timelineId: 'main' });
    expect(confirmed).toEqual([]);
  });
});
