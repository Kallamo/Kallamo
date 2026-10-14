import { describe, expect, test } from 'vitest';
import { MIGRATIONS } from '../../src/main/database/migrations.js';
import { edgeDetail } from '../../src/main/features/worldbuild/relation-dossier.js';
import { filterUpdateFields } from '../../src/main/features/worldbuild/entity-update-contract.js';
import { openTestDatabase } from '../sqlite-test-database';

describe('a specific being takes its nature from its species', () => {
  test('the species edge carries the nature into the dossier', () => {
    const species = { relType: 'is_race', entity: { type: 'Creatures', data: { nature: 'Construct' } } };
    expect(edgeDetail(species, null)).toBe(' (Construct)');
    expect(edgeDetail({ relType: 'is_race', entity: { type: 'Races', data: { nature: 'Construct' } } }, null)).toBe('');
    expect(edgeDetail({ relType: 'member_of', metadata: { founder: true } }, null)).toBe(' (founder)');
  });

  test('the AI fills nature on a species and never on a specific being', () => {
    const fields = ['status', 'nature', 'abundance', 'threat'];
    expect(filterUpdateFields({ type: 'Creatures', data: { scope: 'individual' } }, fields)).toEqual(['status', 'threat']);
    expect(filterUpdateFields({ type: 'Creatures', data: { scope: 'group' } }, fields)).toEqual(['nature', 'abundance', 'threat']);
  });

  test('the migration drops a nature the species already says and keeps any other in the abilities', () => {
    const db = openTestDatabase(':memory:');
    db.exec(`
      CREATE TABLE entities (id TEXT PRIMARY KEY, workspaceId TEXT, type TEXT NOT NULL, canonicalName TEXT NOT NULL, data TEXT, status TEXT NOT NULL);
      CREATE TABLE entity_links (id TEXT PRIMARY KEY, workspaceId TEXT, fromId TEXT, relType TEXT, toId TEXT, label TEXT, metadata_json TEXT, createdAt INTEGER);
    `);
    const insert = db.prepare("INSERT INTO entities (id, workspaceId, type, canonicalName, data, status) VALUES (?, 'ws', 'Creatures', ?, ?, 'confirmed')");
    insert.run('wolves', 'Ash Wolves', JSON.stringify({ scope: 'group', nature: 'Beast' }));
    insert.run('wolf', 'Ash Wolf', JSON.stringify({ nature: 'beast', abilities: 'Keen nose.' }));
    insert.run('golem', 'Siege Golem', JSON.stringify({ nature: 'Construct (siege class)', abilities: 'Unbreakable.' }));
    insert.run('wisp', 'Wisp', JSON.stringify({ scope: 'individual', nature: 'Spirit' }));
    db.prepare("INSERT INTO entity_links (id, workspaceId, fromId, relType, toId) VALUES ('l1', 'ws', 'wolf', 'is_race', 'wolves')").run();

    MIGRATIONS.find((item: { id: string }) => item.id === 'kallamo_creature_nature_on_species_v1')!.up(db);
    const data = Object.fromEntries((db.prepare('SELECT id, data FROM entities').all() as Array<{ id: string; data: string }>).map(row => [row.id, JSON.parse(row.data)]));

    expect(data.wolves).toEqual({ scope: 'group', nature: 'Beast' });
    expect(data.wolf).toEqual({ abilities: 'Keen nose.' });
    expect(data.golem).toEqual({ abilities: 'Construct (siege class). Unbreakable.' });
    expect(data.wisp).toEqual({ scope: 'individual', abilities: 'Spirit' });
    db.close();
  });
});
