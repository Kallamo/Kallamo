import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { NarrativeStateSystem, type ExtractedNarrativeEvent } from '../../src/main/features/narrative/narrative-state';
import { loadCurrentNarrativeRecords } from '../../src/main/features/narrative/narrative-record-projection';
import { writeStoryEvent } from '../../src/main/features/narrative/umwelt/story-journal';
import { admitForCharacter } from '../../src/main/features/narrative/umwelt/story-admission';
import { traceStoryRecord } from '../../src/main/features/narrative/umwelt/story-insights';
import { LOCAL_EMBEDDING_SPACE, pendingStoryTexts, searchHolderRecords, storeStoryVectors } from '../../src/main/features/narrative/umwelt/story-search';
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

const knowledge = (id: string, subjectId: string, object: string, extra: Record<string, unknown> = {}) => ({
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

    const hits = searchHolderRecords(db, WS, 'elias', basis(1));
    expect([...hits.keys()]).toEqual(['k1']);
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
