import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import { NarrativeStateSystem } from '../../src/main/features/narrative/narrative-state';
import { NarrativeWorld, STORY_PROJECT } from '../../src/main/features/narrative/umwelt/narrative-world';
import { addFactTexts } from '../../src/main/features/narrative/umwelt/story-fact-text';
import { natureOf, writeStoryEvent } from '../../src/main/features/narrative/umwelt/story-journal';
import { retireOrigins } from '../../src/main/features/narrative/umwelt/story-lifecycle';
import { StoryReader } from '../../src/main/features/narrative/umwelt/story-reader';
import { StoryTimelines } from '../../src/main/features/narrative/umwelt/story-timelines';
import { factTextOf } from '../../src/main/features/narrative/umwelt/story-writer';
import { removeWorldFile, worldFile } from '../../src/main/features/narrative/umwelt/world-files';
import { openTestDatabase } from '../sqlite-test-database';

const WORKSPACE = 'workspace-natures';

interface StoryEvent { id: string; type: string; participants?: string[] }

describe('What each story event is, and the text of its Facts', () => {
  let directory: string;
  let db: Database.Database;
  let system: NarrativeStateSystem;
  const allowed = new Set(['elias', 'tess', 'guild']);

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'kallamo-story-natures-'));
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

  function events(world: NarrativeWorld): StoryEvent[] {
    return world.call<{ items: StoryEvent[] }>('timeline', { timelineId: new StoryTimelines(world).readTimeline(), page: { limit: 100 } }).items;
  }

  function playTurn(originId: string, object: string) {
    return system.createEvent({
      workspaceId: WORKSPACE, originId, interpreterId: 'system-model', allowedEntityIds: allowed, storyMinute: null,
      event: {
        type: 'revelation', description: 'Tess tells Elias where the guild began.', excerpt: 'It began at the harbor.',
        participantIds: ['tess', 'elias'], confidence: 0.98,
        operations: [{ type: 'fact', proposition: { subjectId: 'guild', predicate: 'founded-in', object }, category: 'history', confidence: 0.98 }]
      }
    });
  }

  test('natures follow the origin and the operations', () => {
    expect(natureOf({ originType: 'chat-message' })).toBe('scene');
    expect(natureOf({ originType: 'writing-document' })).toBe('scene');
    expect(natureOf({ originType: 'worldbuild-update' })).toBe('entity-update');
    expect(natureOf({ originType: 'world-action', originId: 'worldbuild-occurrence:o1' })).toBe('occurrence');
    expect(natureOf({ originType: 'world-action' }, [{ type: 'grant-awareness' }])).toBe('awareness-grant');
    expect(natureOf({ originType: 'world-action' }, [{ type: 'add-knowledge' }])).toBe('sheet-edit');
  });

  test('a played turn is a scene with its participants, and its Fact carries text', () => {
    playTurn('turn-1', 'the old harbor');
    const world = NarrativeWorld.of(db, WORKSPACE);
    const scene = events(world).find(event => event.type === 'scene');
    expect(scene?.participants?.sort()).toEqual(['elias', 'tess']);
    const fact = new StoryReader(world).facts({ timelineId: new StoryTimelines(world).readTimeline() })[0] as { text?: string };
    expect(fact.text).toContain('founded in the old harbor');
    expect(fact.text).not.toMatch(/[{}]/);
  });

  test('a sheet edit names no participants', () => {
    writeStoryEvent(db, WORKSPACE, {
      eventId: 'evt-sheet',
      description: 'Worldbuild Knowledge entry added.',
      participants: ['elias'],
      provenance: { interpreter: 'user', originType: 'world-action', originId: 'elias' },
      operations: [{ id: 'op-1', type: 'grant-awareness', evidenceIds: [], awareness: { id: 'aw-1', subjectId: 'elias', targetId: 'guild', status: 'active' } } as never]
    });
    const event = events(NarrativeWorld.of(db, WORKSPACE)).find(item => item.id === 'evt-sheet');
    expect(event?.type).toBe('awareness-grant');
    expect(event?.participants ?? []).toEqual([]);
  });

  test('an occurrence object reads as its title and summary', () => {
    const text = factTextOf(
      { subject: WORKSPACE, predicate: 'recorded-occurrence', polarity: true, object: { kind: 'value', value: { title: 'The Iron Tournament', summary: 'Elias won the final.' } } },
      () => undefined,
      WORKSPACE
    );
    expect(text).toBe('The Iron Tournament: Elias won the final.');
  });

  test('earlier Facts get text through a copy that supersedes them, and a removed turn still takes it back', () => {
    const world = NarrativeWorld.of(db, WORKSPACE);
    world.ensureEntities([WORKSPACE], []);
    // A Fact as 0.1.0 wrote it: no text.
    world.call('commit', {
      attemptId: 'old-fact', timelineId: 'main',
      event: { id: 'evt-old', type: 'custom', title: 'Old turn', position: { tick: 1 }, provenance: { origin: { kind: 'system', name: 'test' } } },
      records: [{ kind: 'fact', id: 'fact-old', claim: { subject: WORKSPACE, predicate: 'statement', polarity: true, object: { kind: 'value', value: 'The bridge fell in the flood.' } } }]
    });
    db.prepare('INSERT INTO narrative_story_records (workspace_id, record_id, origin_id, event_id, created_at) VALUES (?, ?, ?, ?, ?)')
      .run(WORKSPACE, 'fact-old', 'turn-old', 'evt-old', Date.now());
    StoryReader.invalidate(world);

    expect(addFactTexts(db, WORKSPACE)).toBe(1);
    const facts = new StoryReader(world).facts({ timelineId: 'main' }) as Array<{ id: string; text?: string; claim: { object: unknown } }>;
    expect(facts).toHaveLength(1);
    expect(facts[0]).toMatchObject({ id: 'fact-old.text', text: 'The bridge fell in the flood.' });
    expect(addFactTexts(db, WORKSPACE)).toBe(0);

    retireOrigins(db, WORKSPACE, ['turn-old']);
    expect(new StoryReader(world).facts({ timelineId: 'main' })).toHaveLength(0);
  });

  test('deleting a workspace also deletes the copy kept before a migration', () => {
    playTurn('turn-1', 'the old harbor');
    const file = worldFile(db, WORKSPACE);
    const backup = `${file}.v5.bak`;
    writeFileSync(backup, 'older story');
    expect(STORY_PROJECT).toBe('story');
    removeWorldFile(db, WORKSPACE);
    expect(existsSync(file)).toBe(false);
    expect(existsSync(backup)).toBe(false);
  });
});
