import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openEntityStore, type EntityStoreHarness } from './entity-store-harness';

let harness: EntityStoreHarness;
beforeEach(() => { harness = openEntityStore(); });
afterEach(() => harness.close());

const spoilersOf = (id: string) => JSON.parse((harness.db.prepare('SELECT data FROM entities WHERE id = ?').get(id) as { data: string }).data).spoilers;

describe('hidden fields in a Worldbuild package', () => {
  test('travel with their entity, and a hidden row follows its link to the new world', () => {
    const { store } = harness;
    const wren = store.createEntity({ workspaceId: 'source', type: 'Characters', canonicalName: 'Wren' });
    const edwin = store.createEntity({ workspaceId: 'source', type: 'Characters', canonicalName: 'Edwin' });
    const link = store.setLink({ workspaceId: 'source', fromId: wren.id, relType: 'related_to', toId: edwin.id, label: 'Father' });
    store.updateEntity(wren.id, { data: { spoilers: ['birthDate', 'alias:Sev', 'skill:animal-kinship', `link:${link.id}`, 'knowledge:statement-1'] } });

    const pkg = store.exportWorldbuild('source');
    const packaged = pkg.entities.find((entity: any) => entity.canonicalName === 'Wren').data.spoilers;
    // A statement mark stays as it is here; the Knowledge import maps or drops it.
    expect(packaged).toEqual(['birthDate', 'alias:Sev', 'skill:animal-kinship', `link:related_to|${wren.id}|${edwin.id}`, 'knowledge:statement-1']);

    const { idMap } = store.importWorldbuild('target', pkg);
    const newWren = idMap.get(wren.id);
    const newLink = (harness.db.prepare("SELECT id FROM entity_links WHERE workspaceId = 'target' AND relType = 'related_to'").get() as { id: string }).id;
    expect(newLink).not.toBe(link.id);
    expect(spoilersOf(newWren)).toEqual(['birthDate', 'alias:Sev', 'skill:animal-kinship', `link:${newLink}`, 'knowledge:statement-1']);
  });

  test('drop a hidden row whose link does not travel', () => {
    const { store } = harness;
    const wren = store.createEntity({ workspaceId: 'source', type: 'Characters', canonicalName: 'Wren' });
    store.updateEntity(wren.id, { data: { spoilers: ['age', 'link:not-a-real-link'] } });
    const pkg = store.exportWorldbuild('source');
    expect(pkg.entities[0].data.spoilers).toEqual(['age']);
  });
});
