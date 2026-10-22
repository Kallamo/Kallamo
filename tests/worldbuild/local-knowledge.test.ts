import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openEntityStore, type EntityStoreHarness } from './entity-store-harness';
import { knowledgeGroupsOf, sharedKnowledgeCards } from '../../src/main/features/worldbuild/knowledge-groups';

const require = createRequire(import.meta.url);
const { createWorldbuildDataService } = require('../../src/main/features/worldbuild/worldbuild-data.js');
const { exportAuthoredKnowledge, importAuthoredKnowledge } = require('../../src/main/features/worldbuild/knowledge-package.js');

let harness: EntityStoreHarness;
let worldbuild: any;
beforeEach(() => {
  harness = openEntityStore();
  worldbuild = createWorldbuildDataService(harness.db);
});
afterEach(() => harness.close());

// A continent, a kingdom inside it, a village and a forest inside the kingdom, places inside those.
function seedWorld(workspaceId = 'ws') {
  const { store } = harness;
  const place = (name: string, size: string, parent?: string) => {
    const id = store.createEntity({ workspaceId, type: 'Locations', canonicalName: name, data: { size, description: `${name} as anyone sees it.` } }).id;
    if (parent) store.setLink({ workspaceId, fromId: id, relType: 'inside', toId: parent });
    return id;
  };
  const continent = place('Arneth', 'region');
  const kingdom = place('Ordane', 'area', continent);
  const village = place('Evenwell', 'area', kingdom);
  const forest = place('Elderwake', 'area', kingdom);
  const square = place('Well Square', 'place', village);
  const well = place('The Old Well', 'spot', square);
  const inn = place('The Last Lantern', 'place', village);
  const camp = place('Last Camp', 'place', forest);
  const person = (name: string) => store.createEntity({ workspaceId, type: 'Characters', canonicalName: name }).id;
  const wren = person('Wren');
  const rhona = person('Rhona');
  store.setLink({ workspaceId, fromId: wren, relType: 'local_to', toId: village });
  store.setLink({ workspaceId, fromId: rhona, relType: 'local_to', toId: kingdom });
  worldbuild.reconcileKnowledge(workspaceId);
  return { continent, kingdom, village, forest, square, well, inn, camp, wren, rhona };
}

const cardTargets = (ownerId: string) => worldbuild.listKnowledgeCards('ws', ownerId).map((card: any) => card.targetId).sort();

describe('knowledge shared by the places people are local to', () => {
  test('a local reads their Area and every Region and Area around it', () => {
    const world = seedWorld();
    expect(knowledgeGroupsOf(harness.db, 'ws', world.wren)).toEqual(expect.arrayContaining([
      { id: world.village, kind: 'locality' },
      { id: world.kingdom, kind: 'locality' },
      { id: world.continent, kind: 'locality' },
    ]));
    expect(knowledgeGroupsOf(harness.db, 'ws', world.rhona).map(group => group.id).sort())
      .toEqual([world.continent, world.kingdom].sort());
  });

  test('an Area knows its places down to the next Area, with what anyone can see of them', () => {
    const world = seedWorld();
    expect(cardTargets(world.village)).toEqual([world.square, world.well, world.inn].sort());
    expect(cardTargets(world.kingdom)).toEqual([world.village, world.forest].sort());
    expect(cardTargets(world.continent)).toEqual([world.kingdom]);
    const wellCard = worldbuild.getKnowledgeCard('ws', world.village, world.well);
    expect(wellCard.knownFieldKeys.sort()).toEqual(['description', 'locationType']);
    expect(wellCard.sources.map((source: any) => source.sourceType)).toEqual(['locality']);
  });

  test('locals inherit the cards, a visitor of the kingdom does not reach the village', () => {
    const world = seedWorld();
    const wrenReads = sharedKnowledgeCards(harness.db, 'ws', [world.wren]).map(card => card.targetId);
    expect(wrenReads).toEqual(expect.arrayContaining([world.well, world.inn, world.forest, world.kingdom]));
    const rhonaReads = sharedKnowledgeCards(harness.db, 'ws', [world.rhona]).map(card => card.targetId);
    expect(rhonaReads).toEqual(expect.arrayContaining([world.village, world.forest]));
    expect(rhonaReads).not.toContain(world.well);
  });

  test('a faction audience never narrows what a place shares', () => {
    const world = seedWorld();
    worldbuild.setKnowledgeAudience({ workspaceId: 'ws', ownerId: world.village, targetId: world.inn, audienceType: 'selected-members', memberIds: [] });
    expect(sharedKnowledgeCards(harness.db, 'ws', [world.wren], [world.inn])).toHaveLength(1);
  });

  test('a removed card stays removed, and a place that leaves the Area takes its card along', () => {
    const world = seedWorld();
    worldbuild.removeKnowledgeCard({ workspaceId: 'ws', ownerId: world.forest, targetId: world.camp });
    expect(cardTargets(world.forest)).toEqual([]);

    const { db } = harness;
    db.prepare("UPDATE entity_links SET toId = ? WHERE fromId = ? AND relType = 'inside'").run(world.forest, world.inn);
    expect(cardTargets(world.village)).toEqual([world.square, world.well].sort());
    expect(cardTargets(world.forest)).toEqual([world.inn]);
  });

  test('statements a place holds reach its locals in play', () => {
    const world = seedWorld();
    worldbuild.saveSubjectEntry({
      workspaceId: 'ws', subjectId: world.village, kind: 'knowledge',
      entry: { aboutId: world.well, statement: 'The well has never run dry.', acquisition: 'witness' },
    });
    const projection = worldbuild.getSubjectKnowledge('ws', world.village);
    expect(projection.known.map((entry: any) => entry.statement)).toEqual(['The well has never run dry.']);
    expect(sharedKnowledgeCards(harness.db, 'ws', [world.wren], [world.well]).map(card => card.groupId)).toEqual([world.village]);
  });

  test('a package rebuilds the cards and keeps a removal', () => {
    const world = seedWorld('source');
    const { store, db } = harness;
    worldbuild.reconcileKnowledge('source');
    worldbuild.removeKnowledgeCard({ workspaceId: 'source', ownerId: world.forest, targetId: world.camp });
    const pkg = store.exportWorldbuild('source');
    pkg.knowledge = exportAuthoredKnowledge({ db, worldbuildData: worldbuild, workspaceId: 'source', entityIds: pkg.entities.map((entity: any) => entity.ref) });
    const portable = JSON.parse(JSON.stringify(pkg));
    const { idMap, linkIdByEnds } = store.importWorldbuild('target', portable);
    db.prepare("UPDATE entities SET status = 'confirmed' WHERE workspaceId = 'target'").run();
    importAuthoredKnowledge({ db, worldbuildData: worldbuild, workspaceId: 'target', knowledge: portable.knowledge, idMap, linkIdByEnds });
    expect(portable.knowledge.cards).toEqual([]);
    const targets = (ownerId: string) => worldbuild.listKnowledgeCards('target', ownerId).map((card: any) => card.targetId);
    expect(targets(idMap.get(world.village)).sort()).toEqual([world.square, world.well, world.inn].map(id => idMap.get(id)).sort());
    expect(targets(idMap.get(world.forest))).toEqual([]);
  });
});
