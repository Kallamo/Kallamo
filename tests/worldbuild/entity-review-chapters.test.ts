import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { insertEntity, openEntityStore, type EntityStoreHarness } from './entity-store-harness';

let harness: EntityStoreHarness;

// A blob staged before chapter proposals stopped being generated.
function stageLegacyChapters(id: string) {
  insertEntity(harness.db, id, {
    loreDocumentId: 'doc-a',
    data: {
      loreDocumentIds: ['doc-a'],
      _enrichPending: {
        at: 1,
        data: { occupation: { value: 'Ferrywoman', evidence: [] } },
        chapters: [{ id: 'doc-b', title: 'Low tide' }, { id: 'doc-c', title: 'The toll' }]
      }
    }
  });
}

beforeEach(() => { harness = openEntityStore(); });
afterEach(() => harness.close());

describe('staged chapter proposals', () => {
  test('accepting one chapter links it and keeps the undecided one staged', () => {
    stageLegacyChapters('nora');
    const entity = harness.store.resolveEnrichReview('nora', { accept: { chapters: ['doc-b'] } });
    expect(entity.data.loreDocumentIds).toEqual(['doc-a', 'doc-b']);
    expect(entity.loreDocumentId).toBe('doc-a');
    expect(entity.data._enrichPending.chapters).toEqual([{ id: 'doc-c', title: 'The toll' }]);
    expect(entity.data._enrichPending.data).toHaveProperty('occupation');
  });

  test('rejecting a chapter drops it without linking it', () => {
    stageLegacyChapters('nora');
    const entity = harness.store.resolveEnrichReview('nora', { reject: { chapters: ['doc-b', 'doc-c'] } });
    expect(entity.data.loreDocumentIds).toEqual(['doc-a']);
    expect(entity.data._enrichPending.chapters).toBeUndefined();
  });

  test('accepting every update in bulk completes when an entity carries legacy chapters', () => {
    stageLegacyChapters('nora');
    insertEntity(harness.db, 'orin', { data: { _enrichPending: { at: 1, data: { rank: { value: 'Captain', evidence: [] } } } } });
    const result = harness.store.bulkAcceptEnrichUpdates('ws', ['nora', 'orin']);
    expect(result).toMatchObject({ accepted: 2, chapters: 2, fields: 2 });
    const nora = harness.store.getEntity('nora');
    expect(nora.data.loreDocumentIds).toEqual(['doc-a', 'doc-b', 'doc-c']);
    expect(nora.data._enrichPending).toBeUndefined();
    expect(harness.store.getEntity('orin').data.rank).toBe('Captain');
  });
});
