import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { MIGRATIONS, runDatabaseMigrations } from '../../src/main/database/migrations.js';
import { RoleplayProgression } from '../../src/main/features/narrative/roleplay-progression';
import { RoleplaySkills } from '../../src/main/features/narrative/roleplay-skills';
import { RoleplaySystem } from '../../src/main/features/narrative/roleplay-system';
import { findByReference, ruleKey, slugKey } from '../../src/main/features/narrative/rule-keys';
import { openTestDatabase } from '../sqlite-test-database';

const WS = 'workspace-one';

describe('rule keys', () => {
  test('a key is the name without accents, case or punctuation', () => {
    expect(['Stamina (STA)', 'Força Bruta', 'Insight:'].map(slugKey)).toEqual(['stamina-sta', 'forca-bruta', 'insight']);
  });

  test('a rename takes the new name, and only a real rename does', () => {
    const previous = { key: 'dexterity', name: 'Dexterity' };
    expect(ruleKey({ name: 'Stamina (STA)', previous, taken: ['dexterity'], prefix: 'trait' })).toBe('stamina-sta');
    expect(ruleKey({ name: 'dexterity!', previous, taken: ['dexterity'], prefix: 'trait' })).toBe('dexterity');
    expect(ruleKey({ name: 'Сила', previous, taken: ['dexterity'], prefix: 'trait' })).toBe('dexterity');
    expect(ruleKey({ name: 'Stamina', taken: ['stamina'], prefix: 'trait' })).toBe('stamina-2');
    expect(ruleKey({ name: 'Health', givenKey: 'hp', taken: [], prefix: 'resource' })).toBe('hp');
    expect(ruleKey({ name: '10 Lives', taken: [], prefix: 'resource' })).toBe('resource-10-lives');
  });

  test('the AI may name a rule by its name or its key', () => {
    const items = [{ key: 'dexterity', name: 'Stamina (STA)' }, { key: 'strength', name: 'Strength (STR)' }];
    expect(findByReference(items, 'stamina (sta)')?.key).toBe('dexterity');
    expect(findByReference(items, 'strength')?.name).toBe('Strength (STR)');
    expect(findByReference(items, 'Wisdom')).toBeUndefined();
  });
});

describe('saving rules', () => {
  let directory: string;
  let db: Database.Database;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'kallamo-rule-keys-'));
    db = openTestDatabase(join(directory, 'keys.db'));
    runDatabaseMigrations(db);
    db.exec(`
      CREATE TABLE IF NOT EXISTS entities (id TEXT PRIMARY KEY, workspaceId TEXT, type TEXT, canonicalName TEXT, data TEXT, status TEXT);
      CREATE TABLE IF NOT EXISTS entity_links (id TEXT PRIMARY KEY, workspaceId TEXT, fromId TEXT, relType TEXT, toId TEXT);
    `);
  });

  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test('renaming an attribute, a skill or a resource moves its key, and names stay unique', () => {
    const progression = new RoleplayProgression(db);
    const trait = progression.saveTrait(WS, { name: 'Dexterity' });
    expect(progression.saveTrait(WS, { ...trait, name: 'Stamina (STA)' }).key).toBe('stamina-sta');
    expect(() => progression.saveTrait(WS, { name: 'stamina (sta)' })).toThrow('already an attribute');

    const skills = new RoleplaySkills(db);
    const skill = skills.saveSkill(WS, { name: 'Smithing' });
    expect(skills.saveSkill(WS, { ...skill, name: 'Blacksmithing' }).key).toBe('blacksmithing');

    const roleplay = new RoleplaySystem(db);
    const base = { key: 'hp', color: '#ff0000', minimum: 0, maximum: 10, initialValue: 10, appliesTo: ['Characters'], updatePolicy: 'review' as const };
    const resource = roleplay.saveDefinition(WS, { ...base, name: 'HP' });
    expect(resource.key).toBe('hp');
    expect(roleplay.saveDefinition(WS, { ...resource, name: 'Vigour' }).key).toBe('vigour');
    expect(() => roleplay.saveDefinition(WS, { ...base, key: 'v2', name: 'VIGOUR' })).toThrow('already a resource');
  });

  test('the migration rebuilds keys that drifted from their names, even when two trade keys', () => {
    const insert = db.prepare(`
      INSERT INTO roleplay_trait_definitions (workspace_id, trait_id, trait_key, name, description, initial_value, minimum, maximum, position, updated_at)
      VALUES (?, ?, ?, ?, '', 1, 0, 10, 0, 0)
    `);
    insert.run(WS, 'a', 'dexterity', 'Stamina (STA)');
    insert.run(WS, 'b', 'stamina-sta', 'Dexterity');
    insert.run(WS, 'c', 'strength', 'Strength');
    const migration = MIGRATIONS.find((item: { id: string }) => item.id === 'kallamo_roleplay_rule_keys_v1');
    migration!.up(db);
    const keys = Object.fromEntries((db.prepare('SELECT trait_id, trait_key FROM roleplay_trait_definitions').all() as Array<{ trait_id: string; trait_key: string }>).map(row => [row.trait_id, row.trait_key]));
    expect(keys).toEqual({ a: 'stamina-sta', b: 'dexterity', c: 'strength' });
  });
});
