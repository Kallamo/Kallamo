import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import { RoleplaySystem } from '../../src/main/features/narrative/roleplay-system';
import { RoleplayProgression, xpGoal } from '../../src/main/features/narrative/roleplay-progression';
import { openTestDatabase } from '../sqlite-test-database';

const WS = 'workspace-one';

describe('Roleplay progression', () => {
  let directory: string;
  let db: Database.Database;
  let roleplay: RoleplaySystem;
  let progression: RoleplayProgression;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'kallamo-progression-'));
    db = openTestDatabase(join(directory, 'progression.db'));
    db.pragma('foreign_keys = ON');
    runDatabaseMigrations(db);
    db.exec(`
      CREATE TABLE entities (
        id TEXT PRIMARY KEY, workspaceId TEXT, type TEXT NOT NULL,
        canonicalName TEXT NOT NULL, data TEXT, status TEXT NOT NULL
      );
      CREATE TABLE entity_links (
        id TEXT PRIMARY KEY, workspaceId TEXT, fromId TEXT, relType TEXT,
        toId TEXT, label TEXT, metadata_json TEXT, createdAt INTEGER
      );
    `);
    const insert = db.prepare('INSERT INTO entities (id, workspaceId, type, canonicalName, data, status) VALUES (?, ?, ?, ?, ?, ?)');
    insert.run('hero', WS, 'Characters', 'Hero', '{}', 'confirmed');
    insert.run('guard', WS, 'Characters', 'Guard', '{}', 'confirmed');
    insert.run('elf', WS, 'Races', 'Elf', '{}', 'confirmed');
    db.prepare('INSERT INTO entity_links (id, workspaceId, fromId, relType, toId) VALUES (?, ?, ?, ?, ?)')
      .run('hero-race', WS, 'hero', 'is_race', 'elf');
    roleplay = new RoleplaySystem(db);
    roleplay.saveSettings(WS, { playerEntityId: 'hero' });
    progression = new RoleplayProgression(db);
  });

  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test('goals grow the way the rule says', () => {
    const rule = { firstGoal: 1000, growth: 'add' as const, growthAmount: 500, maxLevel: null, guidance: '', aiOnlyAdds: true };
    expect([1, 2, 3].map(level => xpGoal(level, rule))).toEqual([1000, 1500, 2000]);
  });

  test('only the player and chosen characters progress, and only while progression is on', () => {
    expect(progression.progressingIds(WS)).toEqual([]);
    progression.saveSettings(WS, { mode: 'levels' });
    expect(progression.progressingIds(WS)).toEqual(['hero']);
    progression.setMembers(WS, [{ targetType: 'entity', targetId: 'guard' }]);
    expect(progression.progressingIds(WS)).toEqual(['hero', 'guard']);
    expect(progression.listTraits(WS).map(trait => trait.name)).toEqual(['Strength', 'Dexterity', 'Intellect', 'Presence']);
  });

  test('group lines include everyone of a race, species or kind, and Everyone covers them all', () => {
    const insert = db.prepare('INSERT INTO entities (id, workspaceId, type, canonicalName, data, status) VALUES (?, ?, ?, ?, ?, ?)');
    insert.run('scout', WS, 'Characters', 'Scout', '{}', 'confirmed');
    insert.run('wolf', WS, 'Creatures', 'Grey wolf', '{"scope":"individual"}', 'confirmed');
    insert.run('wolves', WS, 'Creatures', 'Wolves', '{"scope":"group"}', 'confirmed');
    insert.run('ghost', WS, 'Characters', 'Ghost', '{}', 'proposed');
    const link = db.prepare('INSERT INTO entity_links (id, workspaceId, fromId, relType, toId) VALUES (?, ?, ?, ?, ?)');
    link.run('scout-race', WS, 'scout', 'is_race', 'elf');
    link.run('ghost-race', WS, 'ghost', 'is_race', 'elf');
    link.run('wolf-species', WS, 'wolf', 'is_race', 'wolves');
    progression.saveSettings(WS, { mode: 'levels' });

    progression.setMembers(WS, [{ targetType: 'race', targetId: 'elf' }, { targetType: 'species', targetId: 'wolves' }]);
    expect(progression.progressingIds(WS).sort()).toEqual(['hero', 'scout', 'wolf']);
    expect(progression.getEntityProgress(WS, 'hero').progressesThrough).toEqual({ targetType: 'player', targetId: 'hero' });
    expect(progression.getEntityProgress(WS, 'wolf').progressesThrough).toEqual({ targetType: 'species', targetId: 'wolves' });

    progression.setMembers(WS, [{ targetType: 'type', targetId: 'Creatures' }]);
    expect(progression.progressingIds(WS).sort()).toEqual(['hero', 'wolf']);

    const settings = progression.setMembers(WS, [{ targetType: 'entity', targetId: 'guard' }, { targetType: 'everyone', targetId: '' }]);
    expect(settings.members).toEqual([{ targetType: 'entity', targetId: 'guard' }, { targetType: 'everyone', targetId: '' }]);
    expect(progression.progressingIds(WS).sort()).toEqual(['guard', 'hero', 'scout', 'wolf']);
    expect(() => progression.setMembers(WS, [{ targetType: 'species', targetId: 'elf' }])).toThrow();
  });

  test('a species gives its members attribute bonuses, like a race', () => {
    db.prepare('INSERT INTO entities (id, workspaceId, type, canonicalName, data, status) VALUES (?, ?, ?, ?, ?, ?)')
      .run('wolves', WS, 'Creatures', 'Wolves', '{"scope":"group"}', 'confirmed');
    db.prepare('INSERT INTO entities (id, workspaceId, type, canonicalName, data, status) VALUES (?, ?, ?, ?, ?, ?)')
      .run('wolf', WS, 'Creatures', 'Grey wolf', '{"scope":"individual"}', 'confirmed');
    db.prepare('INSERT INTO entity_links (id, workspaceId, fromId, relType, toId) VALUES (?, ?, ?, ?, ?)').run('wolf-species', WS, 'wolf', 'is_race', 'wolves');
    progression.saveSettings(WS, { mode: 'levels' });
    const dexterity = progression.listTraits(WS).find(trait => trait.key === 'dexterity')!;
    progression.setRaceValue(WS, 'wolves', dexterity.id, 3);
    expect(progression.listRaceValues(WS, 'wolves')).toEqual({ [dexterity.id]: 3 });
    expect(progression.getEntityProgress(WS, 'wolf').attributes.find(item => item.key === 'dexterity')).toMatchObject({ base: 10, bonus: 3, value: 13, bonusFromName: 'Wolves' });
    expect(() => progression.setRaceValue(WS, 'wolf', dexterity.id, 1)).toThrow();
  });

  test('XP past the goal raises the level, carries the rest and refills a resource that grows', () => {
    const health = roleplay.saveDefinition(WS, {
      name: 'Health', key: 'health', color: '#dc2626', minimum: 0, maximum: 100, growthPerLevel: 10, refillOnLevelUp: true,
      appliesTo: ['Characters'], updatePolicy: 'automatic'
    });
    roleplay.setTargetValue(WS, health.id, 'entity', 'hero', { current: 40 });
    progression.saveSettings(WS, { mode: 'levels', config: { policy: 'automatic' } });

    progression.proposeChange({ id: 'win', workspaceId: WS, entityId: 'hero', kind: 'xp', delta: 1200, reason: 'Beat the captain', source: 'ai', provenanceId: 'turn-42' });

    expect(progression.getEntityProgress(WS, 'hero')).toMatchObject({ level: 2, xp: 200, goal: 1500 });
    expect(roleplay.listEntityResources(WS, 'hero')[0]).toMatchObject({ current: 110, maximum: 110 });
    expect(progression.listHistory(WS, 'hero').find(entry => entry.kind === 'level')?.reason).toBe('Health 100 → 110, refilled');
  });

  test('a race with its own base and growth gives a high-level character the full maximum at once', () => {
    const health = roleplay.saveDefinition(WS, {
      name: 'Health', key: 'health', color: '#dc2626', minimum: 0, maximum: 100, growthPerLevel: 10,
      appliesTo: ['Characters'], updatePolicy: 'review'
    });
    progression.saveSettings(WS, { mode: 'levels' });
    progression.setEntityValue(WS, 'hero', { kind: 'level', value: 7 });
    expect(roleplay.listEntityResources(WS, 'hero')[0]).toMatchObject({ current: 160, maximum: 160 });

    roleplay.setTargetValue(WS, health.id, 'race', 'elf', { base: 80, growth: 20 });
    expect(roleplay.listEntityResources(WS, 'hero')[0]).toMatchObject({
      current: 200, maximum: 200, parts: expect.objectContaining({ base: 80, growth: 20, level: 7, levelBonus: 120 })
    });
  });

  test('going down levels and back gives the same maximum, never refills, and keeps the adjustment', () => {
    const health = roleplay.saveDefinition(WS, {
      name: 'Health', key: 'health', color: '#dc2626', minimum: 0, maximum: 100, growthPerLevel: 20, refillOnLevelUp: true,
      appliesTo: ['Characters'], updatePolicy: 'automatic'
    });
    progression.saveSettings(WS, { mode: 'levels' });
    progression.setEntityValue(WS, 'hero', { kind: 'level', value: 7 });
    roleplay.setTargetValue(WS, health.id, 'entity', 'hero', { current: 150, adjustment: 20 });
    expect(roleplay.listEntityResources(WS, 'hero')[0]).toMatchObject({ current: 150, maximum: 240 });

    progression.setEntityValue(WS, 'hero', { kind: 'level', value: 3 });
    expect(roleplay.listEntityResources(WS, 'hero')[0]).toMatchObject({ current: 150, maximum: 160 });
    expect(progression.listHistory(WS, 'hero').find(entry => entry.kind === 'level')?.reason).toBe('Health 240 → 160');

    progression.setEntityValue(WS, 'hero', { kind: 'level', value: 2 });
    expect(roleplay.listEntityResources(WS, 'hero')[0]).toMatchObject({ current: 140, maximum: 140 });

    progression.setEntityValue(WS, 'hero', { kind: 'level', value: 7 });
    expect(roleplay.listEntityResources(WS, 'hero')[0]).toMatchObject({ current: 240, maximum: 240, parts: expect.objectContaining({ adjustment: 20 }) });
  });

  test('a resource that does not refill keeps what was spent, and one that starts empty starts at its lowest', () => {
    const stamina = roleplay.saveDefinition(WS, {
      name: 'Stamina', key: 'stamina', color: '#ff8c1a', minimum: 0, maximum: 50, growthPerLevel: 5,
      appliesTo: ['Characters'], updatePolicy: 'automatic'
    });
    const rage = roleplay.saveDefinition(WS, {
      name: 'Rage', key: 'rage', color: '#991b1b', minimum: 0, maximum: 10, startsFull: false,
      appliesTo: ['Characters'], updatePolicy: 'automatic'
    });
    progression.saveSettings(WS, { mode: 'levels' });
    roleplay.setTargetValue(WS, stamina.id, 'entity', 'hero', { current: 20 });
    progression.setEntityValue(WS, 'hero', { kind: 'level', value: 3 });

    const states = roleplay.listEntityResources(WS, 'hero');
    const staminaState = states.find(state => state.definitionId === stamina.id);
    const rageState = states.find(state => state.definitionId === rage.id);
    expect(staminaState).toMatchObject({ definitionId: stamina.id, current: 20, maximum: 60 });
    expect(rageState).toMatchObject({ definitionId: rage.id, current: 0, maximum: 10 });
  });

  test('with Progression off growth is ignored, and an untouched character stays full as the maximum moves', () => {
    const health = roleplay.saveDefinition(WS, {
      name: 'Health', key: 'health', color: '#dc2626', minimum: 0, maximum: 100, growthPerLevel: 20,
      appliesTo: ['Characters'], updatePolicy: 'automatic'
    });
    progression.saveSettings(WS, { mode: 'levels' });
    progression.setEntityValue(WS, 'hero', { kind: 'level', value: 5 });
    expect(roleplay.listEntityResources(WS, 'hero')[0]).toMatchObject({ current: 180, maximum: 180 });

    progression.saveSettings(WS, { mode: 'off' });
    roleplay.setTargetValue(WS, health.id, 'entity', 'hero', { adjustment: 15 });
    expect(roleplay.listEntityResources(WS, 'hero')[0]).toMatchObject({ current: 115, maximum: 115 });
  });

  test('the AI never takes XP away and raises an attribute one point at a time, in review', () => {
    progression.saveSettings(WS, { mode: 'levels', config: { policy: 'review' } });
    const dexterity = progression.listTraits(WS).find(trait => trait.key === 'dexterity')!;

    expect(progression.proposeChange({ id: 'loss', workspaceId: WS, entityId: 'hero', kind: 'xp', delta: -50, source: 'ai' })).toBeNull();
    expect(progression.proposeChange({ id: 'guard-xp', workspaceId: WS, entityId: 'guard', kind: 'xp', delta: 50, source: 'ai' })).toBeNull();
    expect(progression.proposeChange({ id: 'curse', workspaceId: WS, entityId: 'hero', kind: 'attribute', traitId: dexterity.id, delta: -1, source: 'ai' })).toBeNull();

    const raise = progression.proposeChange({ id: 'lockwork', workspaceId: WS, entityId: 'hero', kind: 'attribute', traitId: dexterity.id, delta: 3, reason: 'Weeks of lock work', source: 'ai' })!;
    expect(raise).toMatchObject({ status: 'pending', delta: 1, previousValue: 10, nextValue: 11 });
    expect(progression.getEntityProgress(WS, 'hero').attributes.find(item => item.key === 'dexterity')!.value).toBe(10);
    progression.resolveChange(WS, raise.id, 'approved');
    expect(progression.getEntityProgress(WS, 'hero').attributes.find(item => item.key === 'dexterity')!.value).toBe(11);
  });

  test('a value typed on the sheet is the value kept, race bonus included', () => {
    progression.saveSettings(WS, { mode: 'levels' });
    const strength = progression.listTraits(WS).find(trait => trait.key === 'strength')!;
    progression.setRaceValue(WS, 'elf', strength.id, -1);
    expect(progression.getEntityProgress(WS, 'hero').attributes[0]).toMatchObject({ base: 10, bonus: -1, value: 9, bonusFromName: 'Elf' });

    progression.setEntityValue(WS, 'hero', { kind: 'attribute', traitId: strength.id, value: 11 });
    expect(progression.getEntityProgress(WS, 'hero').attributes[0]).toMatchObject({ base: 12, value: 11 });

    progression.setEntityValue(WS, 'hero', { kind: 'xp', value: 5000 });
    expect(progression.getEntityProgress(WS, 'hero')).toMatchObject({ level: 1, xp: 5000 });
  });

  test('an old skills mode reads as off and an AI skill change is refused', () => {
    db.prepare("INSERT INTO roleplay_progression_settings (workspace_id, mode, config_json, updated_at) VALUES (?, 'off', '{}', 1)").run(WS);
    expect(progression.saveSettings(WS, { mode: 'skills' as never }).mode).toBe('off');
    progression.saveSettings(WS, { mode: 'levels', config: { policy: 'automatic' } });
    expect(progression.proposeChange({ id: 'use', workspaceId: WS, entityId: 'hero', kind: 'skill' as never, delta: 2, source: 'ai' })).toBeNull();
  });

  test('the rule for when attributes go up is kept with the attribute settings', () => {
    const saved = progression.saveSettings(WS, { mode: 'levels', config: { attributes: { aiRaises: true, aiLowers: false, guidance: 'Only after weeks of training.' } } });
    expect(saved.config.attributes).toEqual({ aiRaises: true, aiLowers: false, guidance: 'Only after weeks of training.' });
    expect(progression.saveSettings(WS, { config: { policy: 'automatic' } }).config.attributes.guidance).toBe('Only after weeks of training.');
  });

  test('progression with a Manual rule offers nothing to the AI', () => {
    progression.saveSettings(WS, { mode: 'levels', config: { policy: 'manual' } });
    expect(progression.proposeChange({ id: 'xp', workspaceId: WS, entityId: 'hero', kind: 'xp', delta: 100, source: 'ai' })).toBeNull();
  });
});
