import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { insertEntity, openEntityStore, type EntityStoreHarness } from './entity-store-harness';

let harness: EntityStoreHarness;

beforeEach(() => { harness = openEntityStore(); });
afterEach(() => harness.close());

function origins() {
  return harness.db.prepare(`
    SELECT entity_id, kind, target, previous_json, next_json, applied_by, run_id, evidence_json
    FROM entity_update_origins ORDER BY kind, target
  `).all() as Array<Record<string, string | null>>;
}

const value = (json: string | null) => (json == null ? undefined : JSON.parse(json).value);

describe('Update entities origin', () => {
  test('an accepted review keeps what each field and the lore held before', () => {
    insertEntity(harness.db, 'nora', {
      lore: 'A ferrywoman.',
      data: {
        occupation: 'Ferrywoman',
        customFields: { boat: 'The Heron' },
        _enrichPending: {
          at: 1,
          data: {
            occupation: { value: 'Toll keeper', evidence: ['e1'] },
            'customFields.debt': { value: 'Owes the guild', evidence: ['e2'] }
          },
          lore: { value: 'A ferrywoman turned toll keeper.', evidence: ['e1'] },
          evidence: { e1: { chunkId: 'chunk-1', excerpt: '' }, e2: { chunkId: 'chunk-2', excerpt: '' } }
        }
      }
    });

    harness.store.resolveEnrichReview('nora', { accept: { fields: ['occupation', 'customFields.debt'], lore: true } });

    const rows = origins();
    expect(rows.map(row => [row.kind, row.target, value(row.previous_json), value(row.next_json)])).toEqual([
      ['field', 'customFields.debt', undefined, 'Owes the guild'],
      ['field', 'occupation', 'Ferrywoman', 'Toll keeper'],
      ['lore', 'lore', 'A ferrywoman.', 'A ferrywoman turned toll keeper.']
    ]);
    expect(rows.every(row => row.applied_by === 'review' && row.entity_id === 'nora')).toBe(true);
    expect(JSON.parse(rows[0].evidence_json!).sort()).toEqual(['chunk-1', 'chunk-2']);
  });

  test('rejecting a staged update records nothing', () => {
    insertEntity(harness.db, 'nora', {
      data: { _enrichPending: { at: 1, data: { occupation: { value: 'Toll keeper', evidence: [] } } } }
    });
    harness.store.resolveEnrichReview('nora', { reject: { fields: ['occupation'] } });
    expect(origins()).toEqual([]);
  });

  test('an accepted link is recorded as a link that did not exist before', () => {
    insertEntity(harness.db, 'guild', { type: 'Factions' });
    insertEntity(harness.db, 'nora', {
      data: { _enrichPending: { at: 1, links: [{ relKey: 'member_of', relType: 'member_of', targetId: 'guild', evidence: [] }] } }
    });
    harness.store.resolveEnrichReview('nora', { accept: { links: ['member_of:guild:'] } });
    const [row] = origins();
    expect(row).toMatchObject({ kind: 'link', previous_json: null });
    expect(JSON.parse(row.next_json!)).toMatchObject({ fromId: 'nora', relType: 'member_of', toId: 'guild' });
  });

  test('an automatic write keeps its run, and a later edit by hand is told apart by the stored value', () => {
    insertEntity(harness.db, 'nora', { data: { occupation: 'Ferrywoman' } });
    harness.store.withUpdateOrigin('nora', { appliedBy: 'automatic', runId: 'run-1', evidence: ['chunk-9'] }, () => {
      harness.store.updateEntity('nora', { data: { occupation: 'Toll keeper', _enrichPending: undefined } });
    });
    harness.store.updateEntityFromEditor('nora', { data: { occupation: 'Harbour master' } });

    const [row] = origins();
    expect(row).toMatchObject({ kind: 'field', target: 'occupation', applied_by: 'automatic', run_id: 'run-1' });
    expect(value(row.next_json)).toBe('Toll keeper');
    expect(harness.store.getEntity('nora').data.occupation).toBe('Harbour master');
  });

  test('a write that fails leaves neither the change nor its record', () => {
    insertEntity(harness.db, 'nora', { data: { occupation: 'Ferrywoman' } });
    expect(() => harness.store.withUpdateOrigin('nora', { appliedBy: 'automatic' }, () => {
      harness.store.updateEntity('nora', { data: { occupation: 'Toll keeper' } });
      throw new Error('link failed');
    })).toThrow('link failed');
    expect(harness.store.getEntity('nora').data.occupation).toBe('Ferrywoman');
    expect(origins()).toEqual([]);
  });

  test('deleting the entity removes its records', () => {
    insertEntity(harness.db, 'nora', {
      data: { _enrichPending: { at: 1, data: { occupation: { value: 'Toll keeper', evidence: [] } } } }
    });
    harness.store.resolveEnrichReview('nora', { accept: { fields: ['occupation'] } });
    harness.store.deleteEntity('nora');
    expect(origins()).toEqual([]);
  });
});
