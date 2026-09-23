import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import {
  describeLocationChain,
  findReachableLocations,
  loadLocationChain,
  locationSizesOf,
  proposeLocationParent,
  travelCategory,
  type LocationLink,
  type LocationSizes
} from '../../src/main/features/worldbuild/location-graph';
import {
  isInvertedNesting,
  locationSizeOf,
  normalizeLocationSize,
  presenceOrder
} from '../../src/shared/location-sizes';
import { openTestDatabase } from '../sqlite-test-database';

// world > continent > kingdom > city > district > tavern > cellar, plus a second city and a
// second kingdom so each band of the scale has a neighbour to travel to.
const inside = (fromId: string, toId: string): LocationLink => ({ fromId, toId, relType: 'inside' });
const LINKS: LocationLink[] = [
  inside('continent', 'world'),
  inside('kingdom', 'continent'),
  inside('rival-kingdom', 'continent'),
  inside('rival-city', 'rival-kingdom'),
  inside('city', 'kingdom'),
  inside('other-city', 'kingdom'),
  inside('district', 'city'),
  inside('docks', 'city'),
  inside('tavern', 'district'),
  inside('forge', 'district'),
  inside('pier', 'docks'),
  inside('cellar', 'tavern'),
  inside('cellar-shelf', 'cellar')
];
const SIZES: LocationSizes = new Map([
  ['world', 'region'], ['continent', 'region'], ['kingdom', 'region'], ['rival-kingdom', 'region'],
  ['city', 'area'], ['other-city', 'area'], ['rival-city', 'area'], ['district', 'area'], ['docks', 'area'],
  ['tavern', 'place'], ['forge', 'place'], ['pier', 'place'],
  ['cellar', 'place'], ['cellar-shelf', 'spot']
] as const);

describe('location sizes', () => {
  test('accept any casing and reject anything outside the scale', () => {
    expect(normalizeLocationSize(' Area ')).toBe('area');
    expect(normalizeLocationSize('settlement')).toBeNull();
    expect(normalizeLocationSize(3)).toBeNull();
  });

  test('read from an entity, its data blob, or stored JSON text', () => {
    expect(locationSizeOf({ data: { size: 'spot' } })).toBe('spot');
    expect(locationSizeOf({ data: '{"size":"region"}' })).toBe('region');
    expect(locationSizeOf({ data: 'not json' })).toBeNull();
    expect(locationSizeOf(null)).toBeNull();
  });

  test('flag a larger place inside a smaller one, never an unknown size', () => {
    expect(isInvertedNesting('region', 'place')).toBe(true);
    expect(isInvertedNesting('area', 'area')).toBe(false);
    expect(isInvertedNesting('region', null)).toBe(false);
  });

  test('order presence pickers with places first and containers last', () => {
    const order = ['region', null, 'spot', 'area', 'place'].sort((a, b) => presenceOrder(a) - presenceOrder(b));
    expect(order).toEqual(['place', 'spot', null, 'area', 'region']);
  });
});

describe('reachability', () => {
  test('a sized world reaches the whole region around the scene, however deep the scene sits', () => {
    const fromShelf = findReachableLocations('cellar-shelf', LINKS, { sizes: SIZES });
    const fromCity = findReachableLocations('city', LINKS, { sizes: SIZES });

    for (const reachable of [fromShelf, fromCity]) {
      expect(reachable.has('other-city')).toBe(true);
      expect(reachable.has('pier')).toBe(true);
      expect(reachable.has('rival-city')).toBe(false);
    }
  });

  test('an unsized world keeps the four-level climb', () => {
    const reachable = findReachableLocations('cellar-shelf', LINKS);

    expect(reachable.has('pier')).toBe(true);
    expect(reachable.has('other-city')).toBe(false);
  });

  test('never offers the world root as a destination', () => {
    expect(findReachableLocations('kingdom', LINKS, { sizes: SIZES }).has('world')).toBe(false);
  });
});

describe('travel category', () => {
  test('a direct link decides before sizes', () => {
    expect(travelCategory('cellar', 'tavern', LINKS, SIZES)).toBe('micro');
    expect(travelCategory('tavern', 'pier', [...LINKS, { fromId: 'tavern', toId: 'pier', relType: 'adjacent_to' }], SIZES)).toBe('local');
  });

  test('the smallest shared container sets the band', () => {
    expect(travelCategory('cellar-shelf', 'tavern', LINKS, SIZES)).toBe('micro');
    expect(travelCategory('tavern', 'forge', LINKS, SIZES)).toBe('local');
    expect(travelCategory('tavern', 'pier', LINKS, SIZES)).toBe('transit');
    expect(travelCategory('tavern', 'other-city', LINKS, SIZES)).toBe('macro');
  });

  test('without sizes anything not directly linked stays transit', () => {
    expect(travelCategory('tavern', 'forge', LINKS)).toBe('transit');
    expect(travelCategory('tavern', 'tavern', LINKS, SIZES)).toBeNull();
    expect(travelCategory(null, 'tavern', LINKS, SIZES)).toBeNull();
  });
});

describe('container for a new place', () => {
  const chain = [
    { id: 'tavern', size: 'place' as const },
    { id: 'district', size: 'area' as const },
    { id: 'kingdom', size: 'region' as const }
  ];

  test('is the first container strictly larger than the new place', () => {
    expect(proposeLocationParent('spot', chain)).toBe('tavern');
    expect(proposeLocationParent('place', chain)).toBe('district');
    expect(proposeLocationParent('area', chain)).toBe('kingdom');
    expect(proposeLocationParent('region', chain)).toBeNull();
  });

  test('falls back to the scene for an unknown size, and holds a spot in an unsized scene', () => {
    expect(proposeLocationParent(undefined, chain)).toBe('tavern');
    expect(proposeLocationParent('spot', [{ id: 'room', size: null }])).toBe('room');
    expect(proposeLocationParent('place', [{ id: 'room', size: null }])).toBeNull();
    expect(proposeLocationParent('spot', [])).toBeNull();
  });
});

describe('location chain', () => {
  let directory: string;
  let db: Database.Database;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'kallamo-location-chain-'));
    db = openTestDatabase(join(directory, 'chain.db'));
    db.exec(`
      CREATE TABLE entities (id TEXT PRIMARY KEY, workspaceId TEXT, type TEXT, canonicalName TEXT, data TEXT, status TEXT);
      CREATE TABLE entity_links (id TEXT PRIMARY KEY, workspaceId TEXT, fromId TEXT, relType TEXT, toId TEXT, createdAt INTEGER);
    `);
    const entity = db.prepare(`INSERT INTO entities VALUES (?, 'ws', 'Locations', ?, ?, ?)`);
    entity.run('tavern', 'Crow Tavern', '{"size":"place"}', 'confirmed');
    entity.run('city', 'Porto Velho', '{"size":"area"}', 'confirmed');
    entity.run('realm', 'Norvania', '{}', 'confirmed');
    entity.run('draft', 'Draft Realm', '{"size":"region"}', 'proposed');
    const link = db.prepare(`INSERT INTO entity_links VALUES (?, 'ws', ?, 'inside', ?, 1)`);
    link.run('a', 'tavern', 'city');
    link.run('b', 'city', 'realm');
    link.run('c', 'realm', 'draft');
  });

  afterEach(() => {
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test('climbs confirmed containers and stops at a proposed one', () => {
    const chain = loadLocationChain(db, 'ws', 'tavern');

    expect(chain.map(node => node.id)).toEqual(['tavern', 'city', 'realm']);
    expect(describeLocationChain(chain)).toBe('Crow Tavern (place), within Porto Velho (area), within Norvania');
  });

  test('survives a containment loop', () => {
    db.prepare(`INSERT INTO entity_links VALUES ('loop', 'ws', 'realm', 'inside', 'tavern', 2)`).run();
    db.prepare(`DELETE FROM entity_links WHERE id = 'c'`).run();

    expect(loadLocationChain(db, 'ws', 'tavern').map(node => node.id)).toEqual(['tavern', 'city', 'realm']);
  });

  test('reads sizes off stored rows', () => {
    const rows = db.prepare('SELECT id, type, data FROM entities').all() as Array<{ id: string; type: string; data: string }>;
    expect(locationSizesOf(rows).get('city')).toBe('area');
  });
});
