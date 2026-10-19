import { createRequire } from 'node:module';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import { RoleplaySystem } from '../../src/main/features/narrative/roleplay-system';
import { RoleplayProgression } from '../../src/main/features/narrative/roleplay-progression';
import { RoleplaySkills } from '../../src/main/features/narrative/roleplay-skills';
import { RoleplayRulesPackager } from '../../src/main/features/narrative/roleplay-rules-package';
import { NarrativeEntitySystem } from '../../src/main/features/narrative/narrative-entities';
import { openTestDatabase } from '../sqlite-test-database';

const require = createRequire(import.meta.url);
const { releaseEntityReferences, repointEntityReferences } = require('../../src/main/features/worldbuild/entity-references.js');

const WS = 'workspace-one';
const OTHER = 'workspace-two';

describe('Roleplay skills', () => {
  let directory: string;
  let db: Database.Database;
  let skills: RoleplaySkills;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'kallamo-skills-'));
    db = openTestDatabase(join(directory, 'skills.db'));
    db.pragma('foreign_keys = ON');
    runDatabaseMigrations(db);
    db.exec(`
      CREATE TABLE entities (
        id TEXT PRIMARY KEY, workspaceId TEXT, type TEXT NOT NULL,
        canonicalName TEXT NOT NULL, data TEXT, status TEXT NOT NULL, last_modified INTEGER
      );
      CREATE TABLE entity_links (
        id TEXT PRIMARY KEY, workspaceId TEXT, fromId TEXT, relType TEXT,
        toId TEXT, label TEXT, metadata_json TEXT, createdAt INTEGER
      );
    `);
    const insert = db.prepare('INSERT INTO entities (id, workspaceId, type, canonicalName, data, status) VALUES (?, ?, ?, ?, ?, ?)');
    insert.run('hero', WS, 'Characters', 'Hero', '{}', 'confirmed');
    insert.run('smith', WS, 'Characters', 'Smith', '{}', 'confirmed');
    new RoleplaySystem(db).saveSettings(WS, { playerEntityId: 'hero' });
    skills = new RoleplaySkills(db);
  });

  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const enable = (config = {}) => skills.saveSettings(WS, { enabled: true, config: { policy: 'automatic', ...config } });
  const ai = (id: string, input: Record<string, unknown>) => skills.proposeChange({
    id, workspaceId: WS, entityId: 'hero', source: 'ai', provenanceId: `turn-${id}`, kind: 'rank', ...input
  } as Parameters<RoleplaySkills['proposeChange']>[0]);

  test('skills have their own switch, apart from progression', () => {
    expect(skills.learningIds(WS)).toEqual([]);
    enable();
    expect(new RoleplayProgression(db).getSettings(WS).mode).toBe('off');
    expect(skills.learningIds(WS)).toEqual(['hero']);
    skills.saveSettings(WS, { enabled: false });
    expect(skills.learningIds(WS)).toEqual([]);
  });

  test('the AI only reaches who learns, while anyone can hold a skill set by hand', () => {
    enable();
    const smithing = skills.saveSkill(WS, { name: 'Smithing' });
    expect(skills.proposeChange({ id: 'a', workspaceId: WS, entityId: 'smith', kind: 'assign', skillKey: 'smithing', source: 'ai' })).toBeNull();
    skills.setEntitySkill(WS, 'smith', smithing.id, 3);
    expect(skills.getEntitySkills(WS, 'smith').skills.map(skill => skill.rankName)).toEqual(['Master']);
    skills.setMembers(WS, [{ targetType: 'entity', targetId: 'smith' }]);
    expect(skills.learningIds(WS).sort()).toEqual(['hero', 'smith']);
  });

  test('a rank moves one step per turn, and only on a skill held', () => {
    enable();
    skills.saveSkill(WS, { name: 'Smithing' });
    expect(ai('r0', { skillKey: 'smithing', direction: 1 })).toBeNull();
    expect(ai('a1', { kind: 'assign', skillKey: 'smithing' })?.status).toBe('applied');
    const raised = skills.proposeChange({ id: 'r1', workspaceId: WS, entityId: 'hero', kind: 'rank', skillKey: 'smithing', direction: 5, source: 'ai', provenanceId: 'turn-2' });
    expect(raised?.nextRank).toBe(1);
    expect(skills.proposeChange({ id: 'r2', workspaceId: WS, entityId: 'hero', kind: 'rank', skillKey: 'smithing', direction: 1, source: 'ai', provenanceId: 'turn-2' })).toBeNull();
    expect(ai('r3', { skillKey: 'smithing', direction: -1 })).toBeNull();
    expect(skills.getEntitySkills(WS, 'hero').skills[0].rankName).toBe('Apprentice');
  });

  test('review keeps an AI change waiting until it is approved', () => {
    enable({ policy: 'review' });
    skills.saveSkill(WS, { name: 'Smithing' });
    const change = ai('a1', { kind: 'assign', skillKey: 'smithing', rank: 'Competent' })!;
    expect(change.status).toBe('pending');
    expect(skills.getEntitySkills(WS, 'hero').skills).toEqual([]);
    skills.resolveChange(WS, change.id, 'approved');
    expect(skills.getEntitySkills(WS, 'hero').skills[0].rankName).toBe('Competent');
  });

  test('a change the caller asks to review waits even when the world applies them automatically', () => {
    enable();
    skills.saveSkill(WS, { name: 'Smithing' });
    const change = ai('a1', { kind: 'assign', skillKey: 'smithing', rank: 'Novice', forceReview: true })!;
    expect(change.status).toBe('pending');
    expect(skills.getEntitySkills(WS, 'hero').skills).toEqual([]);
  });

  test('a skill the AI creates waits as proposed and is unusable until confirmed', () => {
    enable({ policy: 'review' });
    expect(ai('c0', { kind: 'create', name: 'Tempering' })).toBeNull();
    enable({ policy: 'review', aiCreates: true });
    const smithing = skills.saveSkill(WS, { name: 'Smithing' });
    const change = ai('c1', { kind: 'create', name: 'Tempering', parentKey: 'smithing', reason: 'Quenched a blade right' })!;
    expect(change.kind).toBe('create');
    const proposed = skills.listSkills(WS).find(skill => skill.key === 'tempering')!;
    expect(proposed).toMatchObject({ status: 'proposed', parentId: smithing.id });
    expect(ai('a2', { kind: 'assign', skillKey: 'tempering', provenanceId: 'other' })).toBeNull();
    skills.resolveChange(WS, change.id, 'approved');
    expect(skills.listSkills(WS).find(skill => skill.key === 'tempering')?.status).toBe('confirmed');
    expect(skills.getEntitySkills(WS, 'hero').skills.map(skill => skill.name)).toEqual(['Tempering']);
  });

  test('a dismissed proposal leaves the catalog', () => {
    enable({ policy: 'review', aiCreates: true });
    const change = ai('c1', { kind: 'create', name: 'Lockpicking' })!;
    skills.resolveChange(WS, change.id, 'rejected');
    expect(skills.listSkills(WS)).toEqual([]);
  });

  test('deleting a parent keeps its sub-skills as skills of their own', () => {
    enable();
    const smithing = skills.saveSkill(WS, { name: 'Smithing' });
    const tempering = skills.saveSkill(WS, { name: 'Tempering', parentId: smithing.id });
    skills.setEntitySkill(WS, 'hero', smithing.id, 1);
    skills.setEntitySkill(WS, 'hero', tempering.id, 0);
    expect(() => skills.saveSkill(WS, { name: 'Edge work', parentId: tempering.id })).toThrow();
    skills.deleteSkill(WS, smithing.id);
    expect(skills.listSkills(WS)).toEqual([expect.objectContaining({ id: tempering.id, parentId: null })]);
    expect(skills.getEntitySkills(WS, 'hero').skills.map(skill => skill.name)).toEqual(['Tempering']);
  });

  test('a shorter ladder moves holders to its new top', () => {
    enable();
    const smithing = skills.saveSkill(WS, { name: 'Smithing' });
    skills.setEntitySkill(WS, 'hero', smithing.id, 3);
    skills.saveSettings(WS, { config: { ranks: ['Learner', 'Expert'] } });
    expect(skills.getEntitySkills(WS, 'hero').skills[0]).toMatchObject({ rank: 1, rankName: 'Expert' });
  });

  test('skill history reads by rank name', () => {
    enable();
    const smithing = skills.saveSkill(WS, { name: 'Smithing' });
    skills.setEntitySkill(WS, 'hero', smithing.id, 0);
    skills.setEntitySkill(WS, 'hero', smithing.id, 2);
    const history = new RoleplayProgression(db).listHistory(WS, 'hero');
    expect(history.map(entry => entry.summary).sort()).toEqual(['Smithing learned (Novice)', 'Smithing: Novice → Competent']);
  });

  test('undoing a turn hides the skill it created and withdraws what still waited', () => {
    enable({ aiCreates: true });
    const created = ai('c1', { kind: 'create', name: 'Tempering' })!;
    expect(created.status).toBe('applied');
    enable({ policy: 'review', aiCreates: true });
    skills.saveSkill(WS, { name: 'Smithing' });
    const waiting = ai('a1', { kind: 'assign', skillKey: 'smithing', provenanceId: 'turn-c1' })!;
    const entities = new NarrativeEntitySystem(db);
    entities.markOrigin(WS, 'turn-c1', 'superseded');
    expect(skills.listSkills(WS).map(skill => skill.key)).toEqual(['smithing']);
    expect(skills.listChanges(WS).find(change => change.id === waiting.id)?.status).toBe('rejected');
    entities.markOrigin(WS, 'turn-c1', 'active');
    expect(skills.listSkills(WS).map(skill => skill.key).sort()).toEqual(['smithing', 'tempering']);
  });

  test('a merge keeps the preferred side and a delete lets the skills go', () => {
    enable();
    const smithing = skills.saveSkill(WS, { name: 'Smithing' });
    skills.setEntitySkill(WS, 'hero', smithing.id, 1);
    skills.setEntitySkill(WS, 'smith', smithing.id, 3);
    skills.setMembers(WS, [{ targetType: 'entity', targetId: 'smith' }]);
    repointEntityReferences(db, { workspaceId: WS, sourceId: 'smith', targetId: 'hero', prefer: 'source' });
    expect(skills.getEntitySkills(WS, 'hero').skills[0].rankName).toBe('Master');
    expect(skills.getSettings(WS).members).toEqual([{ targetType: 'entity', targetId: 'hero' }]);
    releaseEntityReferences(db, { workspaceId: WS, entityId: 'hero' });
    expect(skills.getEntitySkills(WS, 'hero').skills).toEqual([]);
    expect(skills.getSettings(WS).members).toEqual([]);
  });

  test('rules travel by key, with sub-skills and who holds them', () => {
    enable({ aiCreates: true, ranks: ['Low', 'Mid', 'High'] });
    const smithing = skills.saveSkill(WS, { name: 'Smithing', description: 'Metal work' });
    const tempering = skills.saveSkill(WS, { name: 'Tempering', parentId: smithing.id });
    skills.setEntitySkill(WS, 'smith', tempering.id, 2);
    const packager = new RoleplayRulesPackager(db);
    const rules = packager.export(WS, new Set(['smith']), false);
    expect(rules.skills?.catalog.map(skill => [skill.key, skill.parentKey])).toEqual([['smithing', null], ['tempering', 'smithing']]);

    db.prepare('INSERT INTO entities (id, workspaceId, type, canonicalName, data, status) VALUES (?, ?, ?, ?, ?, ?)')
      .run('smith-copy', OTHER, 'Characters', 'Smith', '{}', 'confirmed');
    expect(packager.difference(OTHER, rules).skills).toBe('added');
    packager.import(OTHER, rules, 'merge', new Map([['smith', 'smith-copy']]));
    const imported = new RoleplaySkills(db);
    expect(imported.getSettings(OTHER)).toMatchObject({ enabled: true, config: expect.objectContaining({ ranks: ['Low', 'Mid', 'High'], aiCreates: true }) });
    expect(imported.listSkills(OTHER).map(skill => [skill.key, Boolean(skill.parentId)])).toEqual([['smithing', false], ['tempering', true]]);
    expect(imported.getEntitySkills(OTHER, 'smith-copy').skills).toEqual([expect.objectContaining({ key: 'tempering', rankName: 'High' })]);
  });
});
