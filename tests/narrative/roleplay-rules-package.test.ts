import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import { RoleplaySystem } from '../../src/main/features/narrative/roleplay-system';
import { RoleplayProgression } from '../../src/main/features/narrative/roleplay-progression';
import { RoleplayRulesPackager } from '../../src/main/features/narrative/roleplay-rules-package';
import { openTestDatabase } from '../sqlite-test-database';

const FROM = 'source-world';
const TO = 'target-world';

describe('Roleplay rules in a Worldbuild package', () => {
  let directory: string;
  let db: Database.Database;
  let roleplay: RoleplaySystem;
  let progression: RoleplayProgression;
  let packager: RoleplayRulesPackager;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'kallamo-rules-'));
    db = openTestDatabase(join(directory, 'rules.db'));
    db.pragma('foreign_keys = ON');
    runDatabaseMigrations(db);
    db.exec(`
      CREATE TABLE entities (id TEXT PRIMARY KEY, workspaceId TEXT, type TEXT NOT NULL, canonicalName TEXT NOT NULL, data TEXT, status TEXT NOT NULL);
      CREATE TABLE entity_links (id TEXT PRIMARY KEY, workspaceId TEXT, fromId TEXT, relType TEXT, toId TEXT, label TEXT, metadata_json TEXT, createdAt INTEGER);
    `);
    const insert = db.prepare('INSERT INTO entities (id, workspaceId, type, canonicalName, data, status) VALUES (?, ?, ?, ?, ?, ?)');
    insert.run('hero', FROM, 'Characters', 'Hero', '{}', 'confirmed');
    insert.run('elf', FROM, 'Races', 'Elf', '{}', 'confirmed');
    insert.run('hero-copy', TO, 'Characters', 'Hero', '{}', 'proposed');
    insert.run('elf-copy', TO, 'Races', 'Elf', '{}', 'proposed');
    roleplay = new RoleplaySystem(db);
    progression = new RoleplayProgression(db);
    packager = new RoleplayRulesPackager(db);

    const mana = roleplay.saveDefinition(FROM, {
      name: 'Mana', key: 'mana', color: '#3b82f6', minimum: 0, maximum: 50, growthPerLevel: 5, refillOnLevelUp: true,
      aiChangesMaximum: true, maximumRule: 'Only lasting training', appliesTo: [], scope: 'chosen', updatePolicy: 'review'
    });
    roleplay.setTargetValue(FROM, mana.id, 'entity', 'hero', { current: 12, adjustment: 10 });
    roleplay.setTargetValue(FROM, mana.id, 'race', 'elf', { base: 40, growth: 8 });
    progression.saveSettings(FROM, { mode: 'levels' });
    const strength = progression.listTraits(FROM)[0];
    progression.setRaceValue(FROM, 'elf', strength.id, -1);
  });

  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const idMap = new Map([['hero', 'hero-copy'], ['elf', 'elf-copy']]);

  test('a fresh world carries rules, race values and adjustments, and who holds a chosen resource, full', () => {
    const rules = packager.export(FROM, new Set(['hero', 'elf']), false);
    packager.import(TO, rules, 'merge', idMap);

    const mana = roleplay.listDefinitions(TO).find(item => item.key === 'mana')!;
    expect(roleplay.listAssignments(TO)).toEqual(expect.arrayContaining([
      expect.objectContaining({ definitionId: mana.id, targetType: 'entity', targetId: 'hero-copy', current: null, adjustment: 10 }),
      expect.objectContaining({ definitionId: mana.id, targetType: 'race', targetId: 'elf-copy', base: 40, growth: 8 })
    ]));
    expect(mana).toMatchObject({ growthPerLevel: 5, refillOnLevelUp: true, aiChangesMaximum: true, maximumRule: 'Only lasting training', startsFull: true });
    expect(progression.getSettings(TO).mode).toBe('levels');
    expect(progression.listRaceValues(TO, 'elf-copy')).toEqual({ [progression.listTraits(TO)[0].id]: -1 });
  });

  test('who progresses travels with the entities it names', () => {
    progression.setMembers(FROM, [{ targetType: 'race', targetId: 'elf' }, { targetType: 'type', targetId: 'Creatures' }]);
    const rules = packager.export(FROM, new Set(['hero']), false);
    expect(rules.progression.members).toEqual([{ targetType: 'type', targetRef: 'Creatures' }]);

    packager.import(TO, packager.export(FROM, new Set(['hero', 'elf']), false), 'merge', idMap);
    expect(progression.getSettings(TO).members).toEqual([{ targetType: 'race', targetId: 'elf-copy' }, { targetType: 'type', targetId: 'Creatures' }]);
  });

  test('current values travel only when asked', () => {
    // Level 4 refills Mana to its new maximum: 50 + 5 for each of 3 levels + 10 adjustment.
    progression.setEntityValue(FROM, 'hero', { kind: 'level', value: 4 });
    expect(packager.export(FROM, new Set(['hero', 'elf']), false).progressValues.some(value => value.targetType === 'entity')).toBe(false);
    const rules = packager.export(FROM, new Set(['hero', 'elf']), true);
    expect(rules.resourceValues).toEqual(expect.arrayContaining([expect.objectContaining({ targetRef: 'hero', current: 75, adjustment: 10 })]));
    expect(rules.progressValues).toEqual(expect.arrayContaining([expect.objectContaining({ targetRef: 'hero', traitKey: '__level', value: 4 })]));
  });

  test('merge keeps this world rules and adds the new ones; replace takes the package', () => {
    roleplay.saveDefinition(TO, { name: 'Mana', key: 'mana', color: '#111111', minimum: 0, maximum: 10, appliesTo: ['Characters'], updatePolicy: 'manual' });
    roleplay.saveDefinition(TO, { name: 'Sanity', key: 'sanity', color: '#222222', minimum: 0, maximum: 10, appliesTo: ['Characters'], updatePolicy: 'manual' });
    const rules = packager.export(FROM, new Set(['hero', 'elf']), false);

    const difference = packager.difference(TO, rules);
    expect(difference).toMatchObject({ localRules: true, differs: true, resources: { changed: ['Mana'] }, progression: 'added' });

    packager.import(TO, rules, 'merge', idMap);
    expect(roleplay.listDefinitions(TO).map(item => [item.key, item.maximum])).toEqual(expect.arrayContaining([['mana', 10], ['sanity', 10]]));

    packager.import(TO, rules, 'replace', idMap);
    expect(roleplay.listDefinitions(TO).map(item => [item.key, item.maximum])).toEqual([['mana', 50]]);
  });
});
