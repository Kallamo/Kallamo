import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openEntityStore, type EntityStoreHarness } from './entity-store-harness';

const require = createRequire(import.meta.url);
const { createWorldbuildDataService } = require('../../src/main/features/worldbuild/worldbuild-data.js');
const { exportAuthoredKnowledge, importAuthoredKnowledge, exportAuthoredFacts, importAuthoredFacts } = require('../../src/main/features/worldbuild/knowledge-package.js');

let harness: EntityStoreHarness;
let worldbuild: any;
beforeEach(() => {
  harness = openEntityStore();
  worldbuild = createWorldbuildDataService(harness.db);
});
afterEach(() => harness.close());

// Exports a world and imports it into another, the way the package handlers do.
function roundTrip(source: string, target: string) {
  const { store, db } = harness;
  const pkg = store.exportWorldbuild(source);
  pkg.knowledge = exportAuthoredKnowledge({ db, worldbuildData: worldbuild, workspaceId: source, entityIds: pkg.entities.map((entity: any) => entity.ref) });
  const portable = JSON.parse(JSON.stringify(pkg));
  const { idMap, linkIdByEnds } = store.importWorldbuild(target, portable);
  const result = importAuthoredKnowledge({ db, worldbuildData: worldbuild, workspaceId: target, knowledge: portable.knowledge, idMap, linkIdByEnds });
  return { pkg: portable, idMap, result };
}

describe('authored Knowledge in a Worldbuild package', () => {
  test('travels with its spoilers, access and removals, and nothing structural is copied', () => {
    const { store, db } = harness;
    const make = (name: string, type = 'Characters') => store.createEntity({ workspaceId: 'source', type, canonicalName: name }).id;
    const edwin = make('Edwin');
    const harrow = make('Harrow');
    const wren = make('Wren');
    const watch = make('The Hearthwatch', 'Factions');
    const tie = store.setLink({ workspaceId: 'source', fromId: edwin, relType: 'related_to', toId: harrow, label: 'Brother' });
    const membership = store.setLink({ workspaceId: 'source', fromId: wren, relType: 'member_of', toId: watch });
    worldbuild.ensureAwareness({ workspaceId: 'source', ownerId: wren, targetId: watch, sourceType: 'faction-membership', sourceId: membership.id });
    worldbuild.removeKnowledgeCard({ workspaceId: 'source', ownerId: wren, targetId: watch });

    const known = worldbuild.saveSubjectEntry({
      workspaceId: 'source', subjectId: edwin, kind: 'knowledge',
      entry: { aboutId: harrow, statement: 'Harrow ||faked the clues||.', acquisition: 'witness', category: 'secret' },
    }).known[0];
    worldbuild.saveSubjectEntry({ workspaceId: 'source', subjectId: edwin, kind: 'belief', entry: { aboutId: harrow, statement: 'Harrow is dead.' } });
    worldbuild.saveSubjectEntry({ workspaceId: 'source', subjectId: wren, kind: 'memory', entry: { summary: 'Harrow found me beneath the oak.' } });
    store.updateEntity(edwin, { data: { spoilers: [`knowledge:${known.entryId}`, 'knowledge:gone'] } });

    worldbuild.ensureAwareness({ workspaceId: 'source', ownerId: wren, targetId: harrow, sourceType: 'manual', sourceId: 'by-hand', knownAs: 'the hunter' });
    worldbuild.setKnownFields({ workspaceId: 'source', ownerId: wren, targetId: harrow, fieldKeys: ['status'] });
    worldbuild.ensureAwareness({ workspaceId: 'source', ownerId: wren, targetId: edwin, sourceType: 'manual', sourceId: 'by-hand-2' });
    worldbuild.setKnownRelationships({ workspaceId: 'source', ownerId: wren, targetId: edwin, relationshipIds: [tie.id] });

    const { pkg, idMap, result } = roundTrip('source', 'target');
    expect(pkg.knowledge.entries.map((entry: any) => entry.kind).sort()).toEqual(['belief', 'knowledge', 'memory']);
    expect(result.knowledgeSkipped).toBe(0);

    const newEdwin = idMap.get(edwin);
    const newHarrow = idMap.get(harrow);
    const newWren = idMap.get(wren);
    const edwinKnows = worldbuild.getSubjectKnowledge('target', newEdwin);
    expect(edwinKnows.known).toHaveLength(1);
    expect(edwinKnows.known[0]).toMatchObject({ aboutId: newHarrow, statement: 'Harrow ||faked the clues||.', acquisition: 'witness', origin: { kind: 'authored' } });
    expect(edwinKnows.beliefs[0].statement).toBe('Harrow is dead.');
    expect(worldbuild.getSubjectKnowledge('target', newWren).memories[0].summary).toBe('Harrow found me beneath the oak.');

    const spoilers = JSON.parse((db.prepare('SELECT data FROM entities WHERE id = ?').get(newEdwin) as { data: string }).data).spoilers;
    expect(spoilers).toEqual([`knowledge:${edwinKnows.known[0].entryId}`]);
    expect(edwinKnows.known[0].entryId).not.toBe(known.entryId);

    const hunterCard = worldbuild.getKnowledgeCard('target', newWren, newHarrow);
    expect(hunterCard).toMatchObject({ knownAs: 'the hunter' });
    expect(hunterCard.knownFields.map((field: any) => field.field_key)).toEqual(['status']);
    const newTie = (db.prepare("SELECT id FROM entity_links WHERE workspaceId = 'target' AND relType = 'related_to'").get() as { id: string }).id;
    const edwinCard = worldbuild.getKnowledgeCard('target', newWren, newEdwin);
    expect(JSON.stringify(edwinCard)).toContain(newTie);

    const newMembership = (db.prepare("SELECT id FROM entity_links WHERE workspaceId = 'target' AND relType = 'member_of'").get() as { id: string }).id;
    expect(db.prepare('SELECT 1 FROM worldbuild_knowledge_exclusions WHERE workspace_id = ? AND source_id = ?').get('target', newMembership)).toBeTruthy();
  });

  test('a package without Knowledge drops statement marks it cannot place', () => {
    const { store, db } = harness;
    const edwin = store.createEntity({ workspaceId: 'source', type: 'Characters', canonicalName: 'Edwin' }).id;
    store.updateEntity(edwin, { data: { spoilers: ['age', 'knowledge:somewhere'] } });
    const pkg = store.exportWorldbuild('source');
    const { idMap, linkIdByEnds } = store.importWorldbuild('target', pkg);
    importAuthoredKnowledge({ db, worldbuildData: worldbuild, workspaceId: 'target', knowledge: undefined, idMap, linkIdByEnds });
    const data = JSON.parse((db.prepare('SELECT data FROM entities WHERE id = ?').get(idMap.get(edwin)) as { data: string }).data);
    expect(data.spoilers).toEqual(['age']);
  });
});

describe('authored Facts in a Worldbuild package', () => {
  test('travel with the entities they name, and an entity left out of the package is dropped', () => {
    const { store } = harness;
    const well = store.createEntity({ workspaceId: 'source', type: 'Locations', canonicalName: 'The Old Well' }).id;
    worldbuild.saveWorldFact({ workspaceId: 'source', entry: { title: 'The well never runs dry', statement: 'It has never run dry.', relatedEntityIds: [well, 'not-in-package'] } });
    worldbuild.saveWorldFact({ workspaceId: 'source', entry: { title: 'The calendar', statement: 'Twelve months of thirty days.' } });

    const facts = JSON.parse(JSON.stringify(exportAuthoredFacts({ worldbuildData: worldbuild, workspaceId: 'source', entityIds: [well] })));
    expect(facts.entries.map((fact: any) => fact.relatedRefs)).toEqual([[well], []]);

    const copy = store.createEntity({ workspaceId: 'target', type: 'Locations', canonicalName: 'The Old Well' }).id;
    expect(importAuthoredFacts({ worldbuildData: worldbuild, workspaceId: 'target', facts, idMap: new Map([[well, copy]]) })).toEqual({ factsAdded: 2, factsSkipped: 0 });
    const landed = worldbuild.listWorldFacts('target');
    expect(landed.map((fact: any) => [fact.title, fact.statement, fact.relatedEntityIds])).toEqual([
      ['The well never runs dry', 'It has never run dry.', [copy]],
      ['The calendar', 'Twelve months of thirty days.', []],
    ]);
  });
});
