import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { NarrativeStateSystem, type ExtractedNarrativeEvent } from '../../src/main/features/narrative/narrative-state';
import { NarrativeEntitySystem } from '../../src/main/features/narrative/narrative-entities';
import { NarrativeWorld } from '../../src/main/features/narrative/umwelt/narrative-world';
import { loadStoryRecords } from '../../src/main/features/narrative/umwelt/story-projection';
import { StoryTimelines } from '../../src/main/features/narrative/umwelt/story-timelines';
import { mergeStoryEntity, retireStoryEntity } from '../../src/main/features/narrative/umwelt/story-entities';
import { openFullSchemaDatabase, type FullSchemaDatabase } from '../database/full-schema-harness';
import { storyMinute } from '../../src/shared/calendar-ordinal';

const require = createRequire(import.meta.url);
const { purgeDeadTurns } = require('../../src/main/features/narrative/turn-ownership.js');
const { createWorldbuildDataService } = require('../../src/main/features/worldbuild/worldbuild-data.js');

const WS = 'ws';

let harness: FullSchemaDatabase;
let db: any;
let state: NarrativeStateSystem;
let entities: NarrativeEntitySystem;

function entity(id: string, type = 'Characters') {
  db.prepare(`INSERT INTO entities (id, workspaceId, type, canonicalName, aliases, lore, data, status, createdAt) VALUES (?, ?, ?, ?, '[]', '', '{}', 'confirmed', 1)`)
    .run(id, WS, type, id[0].toUpperCase() + id.slice(1));
}

function turn(originId: string, operations: ExtractedNarrativeEvent['operations'], participants = ['tess', 'elias']) {
  state.beginJob(WS, originId);
  return state.createEvent({
    workspaceId: WS, originId, interpreterId: 'model', allowedEntityIds: new Set(['tess', 'elias', 'guild', ...participants]), storyMinute: null,
    event: { type: 'revelation', description: `Turn ${originId}.`, excerpt: `Turn ${originId}.`, participantIds: participants, confidence: 0.98, operations }
  });
}

function knows(subjectId: string, object: string): ExtractedNarrativeEvent['operations'][number] {
  return { type: 'knowledge', subjectId, proposition: { subjectId: 'guild', predicate: 'hidden-door', object }, category: 'history', acquisition: 'witness', confidence: 0.98 };
}

function story() {
  return loadStoryRecords(NarrativeWorld.of(db, WS), { recordTypes: ['knowledge', 'fact', 'memory', 'relationship', 'belief'] });
}

beforeEach(() => {
  harness = openFullSchemaDatabase();
  db = harness.db;
  db.prepare(`INSERT INTO chats (id, title, description, memoryBlocks, knowledgeFiles, activeProfiles, activeWorkflows) VALUES (?, 'Story', '', '[]', '[]', '[]', '[]')`).run(WS);
  entity('tess');
  entity('elias');
  entity('guild', 'Factions');
  state = new NarrativeStateSystem(db);
  entities = new NarrativeEntitySystem(db);
});
afterEach(() => harness.close());

describe('Turn lifecycle in the story file', () => {
  test('a dead turn still in its draft leaves nothing behind', () => {
    turn('t1', [{ type: 'knowledge', subjectId: 'elias', proposition: { subjectId: 'guild', predicate: 'gate-code', object: 'Dawnfall' }, category: 'capability', acquisition: 'witness', confidence: 0.98 }]);
    const world = NarrativeWorld.of(db, WS);
    expect(new StoryTimelines(world).turnDraft('t1')).toBe('turn-t1');
    expect(story()).toHaveLength(1);
    entities.markOrigin(WS, 't1', 'deleted');
    purgeDeadTurns(db, WS);
    expect(new StoryTimelines(world).turnDraft('t1')).toBeNull();
    expect(story()).toEqual([]);
    expect(world.call<unknown[]>('timeline.list', { status: 'active' }).filter((item: any) => item.kind === 'draft')).toEqual([]);
  });

  test('a dead turn that was already confirmed is retracted and stays in history', () => {
    turn('t1', [knows('elias', 'Behind the well, under the old stones.')]);
    turn('t2', [knows('tess', 'The guild hall has two cellars below it.')]);
    expect(new StoryTimelines(NarrativeWorld.of(db, WS)).turnDraft('t1')).toBeNull();
    entities.markOrigin(WS, 't2', 'deleted');
    entities.markOrigin(WS, 't1', 'deleted');
    purgeDeadTurns(db, WS);
    expect(story()).toEqual([]);
    const history = NarrativeWorld.of(db, WS).call<{ items: Array<{ record: { id: string } }> }>('holdings', { holder: 'elias', at: { tick: 1 } });
    expect(history.items).toHaveLength(1);
  });

  test('a regeneration hides confirmed turns until it is saved, and cancelling restores them', () => {
    turn('t1', [knows('elias', 'Behind the well, under the old stones.')]);
    turn('t2', [knows('tess', 'The guild hall has two cellars below it.')]);
    const replacementId = entities.beginTurnReplacement(WS, ['t2', 't1'])!;
    expect(story()).toEqual([]);
    expect(entities.cancelTurnReplacement(WS, replacementId)).toBe(true);
    expect(story().map(item => item.row.subject_id).sort()).toEqual(['elias', 'tess']);

    const again = entities.beginTurnReplacement(WS, ['t2', 't1'])!;
    entities.completeTurnReplacement(WS, again);
    purgeDeadTurns(db, WS);
    expect(story()).toEqual([]);
  });
});

describe('Worldbuild writes in the story file', () => {
  test('an authored entry, its revision and its removal follow the Knowledge tab', () => {
    const data = createWorldbuildDataService(db);
    data.saveSubjectEntry({ workspaceId: WS, subjectId: 'elias', kind: 'knowledge', entry: { aboutId: 'guild', statement: 'The guild keeps a ledger of debts.', acquisition: 'witness' } });
    const first = story();
    expect(first.map(item => (item.payload.proposition as any).object)).toEqual(['The guild keeps a ledger of debts.']);
    data.saveSubjectEntry({ workspaceId: WS, subjectId: 'elias', kind: 'knowledge', existingId: first[0].payload.id, entry: { aboutId: 'guild', statement: 'The guild keeps two ledgers of debts.', acquisition: 'witness' } });
    expect(story().map(item => (item.payload.proposition as any).object)).toEqual(['The guild keeps two ledgers of debts.']);
    const current = story()[0];
    data.deleteSubjectEntry({ workspaceId: WS, subjectId: 'elias', kind: 'knowledge', entryId: current.payload.id });
    expect(story()).toEqual([]);
  });

  test('a world Fact is revised under its reference and removed with it', () => {
    const data = createWorldbuildDataService(db);
    data.saveWorldFact({ workspaceId: WS, entry: { title: 'Currency', statement: 'Silver crowns are minted in the capital.' } });
    const [fact] = data.listWorldFacts(WS);
    data.saveWorldFact({ workspaceId: WS, existingId: fact.id, entry: { title: 'Currency', statement: 'Silver crowns and copper bits are minted in the capital.' } });
    const facts = story().filter(item => item.row.record_type === 'fact');
    expect(facts.map(item => (item.payload.proposition as any).object)).toEqual(['Silver crowns and copper bits are minted in the capital.']);
    data.deleteWorldFact({ workspaceId: WS, factId: fact.id });
    expect(story().filter(item => item.row.record_type === 'fact')).toEqual([]);
  });
});

describe('Entities in the story file', () => {
  test('a merge carries the story onto the survivor and ends what would point at itself', () => {
    entity('stranger');
    turn('t1', [
      { type: 'knowledge', subjectId: 'stranger', proposition: { subjectId: 'guild', predicate: 'founded-in', object: 'harbor' }, category: 'history', acquisition: 'witness', confidence: 0.98 },
      { type: 'relationship', sourceEntityId: 'elias', targetEntityId: 'stranger', dimension: 'overall', value: 10, cause: 'first-impression', impact: 'meaningful' }
    ], ['tess', 'elias', 'stranger']);
    const allowed = new Set(['tess', 'elias', 'guild', 'stranger']);
    state.createEvent({
      workspaceId: WS, originId: 't2', interpreterId: 'model', allowedEntityIds: allowed, storyMinute: null,
      event: { type: 'custom', description: 'Turn t2.', excerpt: 'Turn t2.', participantIds: ['elias', 'stranger'], confidence: 0.98,
        operations: [{ type: 'relationship', sourceEntityId: 'stranger', targetEntityId: 'elias', dimension: 'overall', value: 10, cause: 'first-impression', impact: 'meaningful' }] }
    });
    mergeStoryEntity(db, WS, 'stranger', 'elias');
    const records = story();
    expect(records.find(item => item.row.record_type === 'knowledge')?.row.subject_id).toBe('elias');
    expect(records.filter(item => item.row.record_type === 'relationship')).toEqual([]);
  });

  test('deleting an entity ends what the story holds about it', () => {
    turn('t1', [knows('elias', 'Behind the well, under the old stones.')]);
    retireStoryEntity(db, WS, 'guild');
    expect(story()).toEqual([]);
  });
});

describe('Event occurrences in the story file', () => {
  const calendar = require('../../src/main/features/worldbuild/calendar-service.js');

  test('an occurrence sits at its own date on the story axis, edits supersede it, removal retires it', async () => {
    const { EventOccurrenceService } = await import('../../src/main/features/worldbuild/event-occurrences');
    entity('festival', 'Events');
    const service = new EventOccurrenceService(db, calendar);
    const created = service.createManual({
      workspaceId: WS, eventEntityId: 'festival', title: 'Lantern night', summary: 'The harbor fills with lanterns.',
      startDate: { eraId: 'ce', year: 300, month: 4, day: 2 }, endDate: null,
      participants: [{ entityId: 'elias', role: 'guest', remember: true, memoryAccessibility: 'available', audienceType: 'all-members', selectedMemberIds: [] }],
      locationIds: [], relatedEntityIds: []
    });
    const world = NarrativeWorld.of(db, WS);
    const minuteOf = (date: object) => storyMinute(calendar.getCalendar(db, WS), date);
    const atDay = (day: number) => ({ axis: 'story', tick: minuteOf({ eraId: 'ce', year: 300, month: 4, day }) });
    expect(loadStoryRecords(world, { recordTypes: ['memory'], at: atDay(1) })).toEqual([]);
    expect(loadStoryRecords(world, { recordTypes: ['memory'], at: atDay(2) }).map(item => item.payload.summary)).toEqual(['Lantern night: The harbor fills with lanterns.']);

    service.updateManual({
      workspaceId: WS, occurrenceId: created.id, eventEntityId: 'festival', title: 'Lantern night', summary: 'The harbor burns with lanterns.',
      startDate: { eraId: 'ce', year: 300, month: 4, day: 2 }, endDate: null,
      participants: [{ entityId: 'elias', role: 'guest', remember: true, memoryAccessibility: 'available', audienceType: 'all-members', selectedMemberIds: [] }],
      locationIds: [], relatedEntityIds: []
    });
    expect(story().filter(item => item.row.record_type === 'memory').map(item => item.payload.summary)).toEqual(['Lantern night: The harbor burns with lanterns.']);
    expect(story().filter(item => item.row.record_type === 'fact')).toHaveLength(1);

    service.deleteManual(WS, created.id, 'festival');
    expect(story()).toEqual([]);
  });
});
