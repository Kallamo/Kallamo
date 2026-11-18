import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openEntityStore, type EntityStoreHarness } from './entity-store-harness';
import { knowledgeGroupsOf } from '../../src/main/features/worldbuild/knowledge-groups';
import { relationTitle } from '../../src/shared/relation-phrases';

let harness: EntityStoreHarness;
beforeEach(() => { harness = openEntityStore(); });
afterEach(() => harness.close());

function seed(workspaceId = 'source') {
  const { store } = harness;
  const harbor = store.createEntity({ workspaceId, type: 'Locations', canonicalName: 'Old Harbor', data: { size: 'area' } }).id;
  const lighthouse = store.createEntity({ workspaceId, type: 'Locations', canonicalName: 'Lighthouse', data: { size: 'place' } }).id;
  const guild = store.createEntity({ workspaceId, type: 'Factions', canonicalName: 'Harbor Guild' }).id;
  const birthplace = store.createEntity({ workspaceId, type: 'Locations', canonicalName: 'Saltmarsh', data: { size: 'place' } }).id;
  const aldous = store.createEntity({ workspaceId, type: 'Characters', canonicalName: 'Aldous', data: { gender: 'Male' } }).id;
  store.setLink({ workspaceId, fromId: aldous, relType: 'lives_in', toId: harbor, single: true });
  store.setLink({ workspaceId, fromId: aldous, relType: 'works_at', toId: lighthouse, label: 'Keeper' });
  store.setLink({ workspaceId, fromId: aldous, relType: 'works_at', toId: guild });
  store.setLink({ workspaceId, fromId: aldous, relType: 'connected_to', toId: birthplace });
  return { harbor, lighthouse, guild, birthplace, aldous };
}

describe('a character\'s home, work and other places', () => {
  test('travel in the package with the gender, and older ties stay as they were', () => {
    seed();
    const { store } = harness;
    const pkg = JSON.parse(JSON.stringify(store.exportWorldbuild('source')));
    store.importWorldbuild('target', pkg, { confirmed: true });
    const aldous = store.listEntities({ workspaceId: 'target' }).find((entity: any) => entity.canonicalName === 'Aldous');
    expect(aldous.data.gender).toBe('Male');
    const links = store.getLinksFrom(aldous.id).map((link: any) => [link.relType, link.entity.canonicalName, link.label]).sort();
    expect(links).toEqual([
      ['connected_to', 'Saltmarsh', null],
      ['lives_in', 'Old Harbor', null],
      ['works_at', 'Harbor Guild', null],
      ['works_at', 'Lighthouse', 'Keeper'],
    ]);
  });

  test('living in an Area does not make someone a local of it', () => {
    const { aldous } = seed();
    expect(knowledgeGroupsOf(harness.db, 'source', aldous)).toEqual([]);
  });
});

describe('relation titles the AI reads', () => {
  test('say what the link means and keep its label', () => {
    expect(relationTitle('works_at', 'Keeper')).toBe('works at (Keeper)');
    expect(relationTitle('lives_in', null)).toBe('lives in');
    expect(relationTitle('connected_to', null)).toBe('tied to');
    expect(relationTitle('related_to', 'Oldest friend')).toBe('Oldest friend');
  });
});
