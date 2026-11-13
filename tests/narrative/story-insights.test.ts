import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { NarrativeStateSystem, type ExtractedNarrativeEvent } from '../../src/main/features/narrative/narrative-state';
import { loadCurrentNarrativeRecords } from '../../src/main/features/narrative/narrative-record-projection';
import { writeStoryEvent } from '../../src/main/features/narrative/umwelt/story-journal';
import { admitForCharacter } from '../../src/main/features/narrative/umwelt/story-admission';
import { traceStoryRecord } from '../../src/main/features/narrative/umwelt/story-insights';
import { LOCAL_EMBEDDING_SPACE, pendingStoryPage, pendingStoryTexts, searchStory, searchTerms, storeStoryVectors } from '../../src/main/features/narrative/umwelt/story-search';
import { createNarrativeChatContext } from '../../src/main/features/narrative/chat-context';
import { setWorkspaceExperienceMode } from '../../src/main/features/narrative/mode-orchestration';
import { NarrativeSceneRepository } from '../../src/narrative/scenes';
import { openFullSchemaDatabase, type FullSchemaDatabase } from '../database/full-schema-harness';

const require = createRequire(import.meta.url);
const { createWorldbuildDataService } = require('../../src/main/features/worldbuild/worldbuild-data.js');

const WS = 'ws';
let harness: FullSchemaDatabase;
let db: any;
let state: NarrativeStateSystem;

function entity(id: string, type = 'Characters') {
  db.prepare(`INSERT INTO entities (id, workspaceId, type, canonicalName, aliases, lore, data, status, createdAt) VALUES (?, ?, ?, ?, '[]', '', '{}', 'confirmed', 1)`)
    .run(id, WS, type, id[0].toUpperCase() + id.slice(1));
}

function turn(originId: string, operations: ExtractedNarrativeEvent['operations'], participantIds = ['tess', 'elias']) {
  return state.createEvent({
    workspaceId: WS, originId, interpreterId: 'model', allowedEntityIds: new Set(['tess', 'elias', 'guild', 'mara']), storyMinute: null,
    event: { type: 'revelation', description: `Turn ${originId}.`, excerpt: `Turn ${originId}.`, participantIds, confidence: 0.98, operations }
  });
}

/** Writes as an author would, so review rules do not hold it back. */
function authored(eventId: string, operations: any[]) {
  return writeStoryEvent(db, WS, { eventId, description: eventId, participants: [], provenance: { interpreter: 'user', originType: 'world-action', originId: eventId }, operations });
}

const knowledge = (id: string, subjectId: string, object: string, extra: Record<string, unknown> = {}): any => ({
  id: `op-${id}`, type: 'grant-knowledge', evidenceIds: [],
  knowledge: { id, entryId: id, subjectId, proposition: { subjectId: 'guild', predicate: 'statement', object }, sourceEventId: id, acquisition: 'witness', confidence: 1, accessibility: 'available', status: 'active', ...extra }
});

beforeEach(() => {
  harness = openFullSchemaDatabase();
  db = harness.db;
  db.prepare(`INSERT INTO chats (id, title, description, memoryBlocks, knowledgeFiles, activeProfiles, activeWorkflows) VALUES (?, 'Story', '', '[]', '[]', '[]', '[]')`).run(WS);
  for (const id of ['tess', 'elias', 'mara']) entity(id);
  entity('guild', 'Factions');
  state = new NarrativeStateSystem(db);
});
afterEach(() => harness.close());

describe('beliefs against canon', () => {
  test('a belief in another value of a canon slot contradicts it, the same value matches it', () => {
    authored('canon', [{ id: 'op-fact', type: 'assert-fact', evidenceIds: [], fact: { id: 'fact', proposition: { subjectId: 'guild', predicate: 'founded-in', object: 'the old harbor' }, status: 'active', evidenceIds: [] } }]);
    authored('beliefs', [
      { id: 'op-b1', type: 'set-belief', evidenceIds: [], belief: { id: 'b1', subjectId: 'elias', proposition: { subjectId: 'guild', predicate: 'founded-in', object: 'the capital' }, sourceEventId: 'beliefs', confidence: 0.7, relationToCanon: 'unknown', status: 'active' } },
      { id: 'op-b2', type: 'set-belief', evidenceIds: [], belief: { id: 'b2', subjectId: 'tess', proposition: { subjectId: 'guild', predicate: 'founded-in', object: 'the old harbor' }, sourceEventId: 'beliefs', confidence: 0.7, relationToCanon: 'unknown', status: 'active' } }
    ]);
    const beliefs = loadCurrentNarrativeRecords(db, { workspaceId: WS, recordTypes: ['belief'] });
    expect(Object.fromEntries(beliefs.map(({ row, payload }) => [row.subject_id, payload.relationToCanon]))).toEqual({ elias: 'contradicted', tess: 'aligned' });
  });
});

describe('how someone knows', () => {
  test('the trace names each link back to whoever saw it first', () => {
    turn('t1', [
      { type: 'knowledge', subjectId: 'tess', proposition: { subjectId: 'guild', predicate: 'gate-code', object: 'Dawnfall' }, category: 'capability', acquisition: 'witness', confidence: 0.98 },
      { type: 'knowledge', subjectId: 'elias', proposition: { subjectId: 'guild', predicate: 'gate-code', object: 'Dawnfall' }, category: 'capability', acquisition: 'reported', informantIds: ['tess'], confidence: 0.98 }
    ]);
    const told = loadCurrentNarrativeRecords(db, { workspaceId: WS, recordTypes: ['knowledge'], subjectIds: ['elias'] })[0];
    const trace = traceStoryRecord(db, WS, told.row.record_id)!;
    expect(trace.steps.map(step => [step.holderName, step.how, step.fromName])).toEqual([['Elias', 'told-by', 'Tess'], ['Tess', 'witnessed', null]]);
    expect(trace.steps[0].eventDescription).toBe('Turn t1.');
  });
});

describe('story checks on a turn', () => {
  test('a secret passed on is reported, and so is a telling the story has no record behind', () => {
    authored('secret', [knowledge('s1', 'tess', 'The guild hides its ledgers under the chapel.', { category: 'secret' })]);
    const result = turn('t2', [
      { type: 'knowledge', subjectId: 'elias', proposition: { subjectId: 'guild', predicate: 'statement', object: 'The guild hides its ledgers under the chapel.' }, category: 'history', acquisition: 'reported', informantIds: ['tess'], confidence: 0.98 },
      { type: 'knowledge', subjectId: 'mara', proposition: { subjectId: 'guild', predicate: 'statement', object: 'The guild pays its spies in silver.' }, category: 'history', acquisition: 'reported', informantIds: ['tess'], confidence: 0.98 }
    ], ['tess', 'elias', 'mara']);
    expect(result.storyChecks?.breaches).toEqual([expect.objectContaining({ tellerId: 'tess', hearerId: 'elias' })]);
    expect(result.storyChecks?.unsupported).toEqual([expect.objectContaining({ tellerId: 'tess', hearerId: 'mara' })]);
  });
});

describe('looking back in the world calendar', () => {
  test('the Knowledge tab can read what someone remembered by the end of a past day', () => {
    const data = createWorldbuildDataService(db);
    const calendar = require('../../src/main/features/worldbuild/calendar-service.js');
    calendar.getCalendar(db, WS);
    calendar.saveRoleplayClock(db, WS, { eraId: 'ce', year: 1001, month: 3, day: 1, hour: 9, minute: 0 });
    data.saveSubjectEntry({ workspaceId: WS, subjectId: 'elias', kind: 'memory', entry: { summary: 'The first snow fell on the harbor.' } });
    calendar.saveRoleplayClock(db, WS, { eraId: 'ce', year: 1001, month: 3, day: 5, hour: 9, minute: 0 });
    data.saveSubjectEntry({ workspaceId: WS, subjectId: 'elias', kind: 'memory', entry: { summary: 'The bridge froze over.' } });

    const day = (value: number) => data.getSubjectKnowledge(WS, 'elias', { asOf: { eraId: 'ce', year: 1001, month: 3, day: value } }).memories.map((memory: any) => memory.summary);
    expect(day(2)).toEqual(['The first snow fell on the harbor.']);
    expect(day(5).sort()).toEqual(['The bridge froze over.', 'The first snow fell on the harbor.']);
    expect(data.getSubjectKnowledge(WS, 'elias').memories).toHaveLength(2);
  });
});

describe('searching what a character holds by meaning', () => {
  test('finds the closest record among the character own, never another holder', () => {
    authored('lore', [
      knowledge('k1', 'elias', 'The ferry crosses at dawn.'),
      knowledge('k2', 'elias', 'Lanterns are banned after curfew.'),
      knowledge('k3', 'tess', 'The ferry crosses at dawn.')
    ]);
    const basis = (index: number) => Array.from({ length: LOCAL_EMBEDDING_SPACE.dimensions }, (_, slot) => (slot === index ? 1 : 0.01));
    const pending = pendingStoryTexts(db, WS, 50);
    expect(pending.map(item => item.docId).sort()).toEqual(['k1', 'k2', 'k3']);
    storeStoryVectors(db, WS, pending.map(item => ({ ...item, vector: basis(item.docId === 'k2' ? 2 : 1) })));
    expect(pendingStoryTexts(db, WS)).toEqual([]);

    const hits = searchStory(db, WS, { holderId: 'elias', text: '', vector: basis(1) });
    expect(hits.map(hit => [hit.docId, hit.match])).toEqual([['k1', 'semantic']]);
  });

  test('a record found by its words and by meaning ranks above one found by either alone', () => {
    authored('lore', [
      knowledge('k1', 'elias', 'The ferry crosses the river at dawn.'),
      knowledge('k2', 'elias', 'The river floods the lower ferry dock in spring.'),
      knowledge('k3', 'elias', 'Lanterns are banned after curfew.')
    ]);
    const basis = (index: number) => Array.from({ length: LOCAL_EMBEDDING_SPACE.dimensions }, (_, slot) => (slot === index ? 1 : 0.01));
    const pending = pendingStoryTexts(db, WS, 50);
    storeStoryVectors(db, WS, pending.map(item => ({ ...item, vector: basis({ k2: 2, k3: 3 }[item.docId] ?? 1) })));

    const hits = searchStory(db, WS, { holderId: 'elias', text: 'When does the ferry cross the river?', vector: basis(1) });
    expect(hits.map(hit => [hit.docId, hit.match])).toEqual([['k1', 'both'], ['k2', 'text']]);
  });

  test('events wait for vectors too, and a resume cursor lists only what was written since', () => {
    const basis = (index: number) => Array.from({ length: LOCAL_EMBEDDING_SPACE.dimensions }, (_, slot) => (slot === index ? 1 : 0.01));
    authored('lore', [knowledge('k1', 'elias', 'The ferry crosses at dawn.')]);
    const first = pendingStoryPage(db, WS, { limit: 50 });
    expect(new Set(first.items.map(item => item.docType))).toEqual(new Set(['record', 'event']));
    storeStoryVectors(db, WS, first.items.map(item => ({ ...item, vector: basis(1) })));
    const settled = pendingStoryPage(db, WS, { limit: 50 });
    expect(settled.items).toEqual([]);

    authored('more', [knowledge('k2', 'elias', 'Lanterns are banned after curfew.')]);
    const since = pendingStoryPage(db, WS, { limit: 50, cursor: settled.resumeCursor });
    expect(since.items.map(item => item.docId)).toContain('k2');
    expect(since.items.map(item => item.docId)).not.toContain('k1');
  });

  test('paging through pending texts while storing their vectors reaches every one', () => {
    const basis = (index: number) => Array.from({ length: LOCAL_EMBEDDING_SPACE.dimensions }, (_, slot) => (slot === index ? 1 : 0.01));
    authored('lore', [knowledge('k1', 'elias', 'One.'), knowledge('k2', 'elias', 'Two.'), knowledge('k3', 'tess', 'Three.')]);
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = pendingStoryPage(db, WS, { limit: 1, cursor });
      storeStoryVectors(db, WS, page.items.map(item => ({ ...item, vector: basis(1) })));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor && pages < 20);
    expect(pages).toBeLessThan(20);
    expect(pendingStoryPage(db, WS, { limit: 50 }).items).toEqual([]);
  });

  test('search words are the long ones, longest first', () => {
    expect(searchTerms('Who waits on the pier before dawn?')).toEqual(['before', 'waits', 'dawn', 'pier']);
  });
});

describe('the narrator search outside roleplay', () => {
  test('a Fact the request means in other words reaches a standard workspace', () => {
    authored('canon', [{ id: 'op-fact', type: 'assert-fact', evidenceIds: [], fact: { id: 'fact', proposition: { subjectId: 'guild', predicate: 'statement', object: 'The guild pays its spies in silver.' }, status: 'active', evidenceIds: [] } }]);
    const basis = (index: number) => Array.from({ length: LOCAL_EMBEDDING_SPACE.dimensions }, (_, slot) => (slot === index ? 1 : 0.01));
    storeStoryVectors(db, WS, pendingStoryTexts(db, WS, 50).map(item => ({ ...item, vector: basis(item.docId === 'fact' ? 1 : 2) })));
    const context = createNarrativeChatContext(db, text => Math.ceil(text.length / 4));
    const ask = (vector: number[]) => context.plan({ requestId: 'request', workspaceId: WS, query: 'Who funds the informants?', items: [], tokenBudget: 4000, queryVector: vector });

    expect(ask(basis(1)).context).toContain('The guild pays its spies in silver.');
    expect(ask(basis(5)).context).not.toContain('pays its spies');
  });
});

describe('recalling earlier scenes', () => {
  test('a scene comes back only to the character who witnessed it', () => {
    writeStoryEvent(db, WS, {
      eventId: 'bell', description: 'The bell tower collapsed during the storm and buried the market stalls.', participants: ['elias'],
      provenance: { interpreter: 'user', originType: 'world-action', originId: 'bell' },
      operations: [knowledge('witnessed', 'elias', 'The mason was paid in copper.', { acquisition: 'witness', sourceEventId: 'bell' })]
    });
    for (let index = 0; index < 14; index += 1) authored(`later-${index}`, [knowledge(`entry-${index}`, 'mara', `Entry ${index}.`)]);
    setWorkspaceExperienceMode(db, WS, 'roleplay');
    new NarrativeSceneRepository(db).save({
      id: 'scene', projectId: WS, status: 'active', participantIds: ['elias', 'tess'], possibleObserverIds: [],
      perspective: { access: 'subjective', focalSubjectId: 'elias' }, position: { sequence: 50 }
    });
    const planned = createNarrativeChatContext(db, text => Math.ceil(text.length / 4))
      .plan({ requestId: 'request', workspaceId: WS, query: 'Does anyone remember the storm and the bell tower?', items: [], tokenBudget: 6000 });

    const scene = 'A scene Elias witnessed earlier in the story: The bell tower collapsed';
    expect(planned.context).toContain(scene);
    expect(planned.context).not.toContain('A scene Tess witnessed');
  });

  test('the latest events are left to the chat history', () => {
    writeStoryEvent(db, WS, {
      eventId: 'bell', description: 'The bell tower collapsed during the storm.', participants: ['elias'],
      provenance: { interpreter: 'user', originType: 'world-action', originId: 'bell' },
      operations: [knowledge('witnessed', 'elias', 'The mason was paid in copper.', { acquisition: 'witness', sourceEventId: 'bell' })]
    });
    expect(searchStory(db, WS, { docType: 'event', text: 'storm bell tower', skipLatestEvents: 12 })).toEqual([]);
    expect(searchStory(db, WS, { docType: 'event', text: 'storm bell tower' }).map(hit => hit.docId)).toEqual(['bell']);
  });
});

describe('what reaches a character context', () => {
  test('the story admits a character own records and their faction, and refuses anyone else', () => {
    db.prepare(`INSERT INTO entity_links (id, workspaceId, fromId, relType, toId, label, createdAt) VALUES ('m', ?, 'elias', 'member_of', 'guild', NULL, 1)`).run(WS);
    authored('lore', [
      knowledge('own', 'elias', 'The ferry crosses at dawn.'),
      knowledge('group', 'guild', 'The guild pays its spies in silver.'),
      knowledge('other', 'tess', 'Tess hid the key in the chapel.')
    ]);
    const { admitted, refused } = admitForCharacter(db, WS, 'elias', [
      { id: 'knowledge:own', recordId: 'own' },
      { id: 'knowledge:group', recordId: 'group' },
      { id: 'knowledge:other', recordId: 'other' },
      { id: 'entity:guild' }
    ]);
    expect(admitted.map(item => item.id)).toEqual(['knowledge:own', 'knowledge:group', 'entity:guild']);
    expect(refused).toEqual([expect.objectContaining({ recordId: 'other', holderId: 'tess', reason: 'not-held' })]);
  });
});
