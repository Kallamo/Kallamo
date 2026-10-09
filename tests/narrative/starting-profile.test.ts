import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import { NarrativeEntitySystem } from '../../src/main/features/narrative/narrative-entities';
import { RoleplayProgression } from '../../src/main/features/narrative/roleplay-progression';
import { RoleplaySkills } from '../../src/main/features/narrative/roleplay-skills';
import { openTestDatabase } from '../sqlite-test-database';

const WS = 'workspace-one';

describe('A new character starting profile', () => {
  let directory: string;
  let db: Database.Database;
  let entities: NarrativeEntitySystem;
  let progression: RoleplayProgression;
  let skills: RoleplaySkills;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'kallamo-starting-profile-'));
    db = openTestDatabase(join(directory, 'profile.db'));
    db.pragma('foreign_keys = ON');
    db.exec(`
      CREATE TABLE entities (
        id TEXT PRIMARY KEY, workspaceId TEXT, type TEXT, canonicalName TEXT,
        aliases TEXT, lore TEXT, loreDocumentId TEXT, data TEXT, status TEXT,
        createdAt INTEGER, last_modified INTEGER
      );
      CREATE TABLE entity_links (
        id TEXT PRIMARY KEY, workspaceId TEXT, fromId TEXT, relType TEXT,
        toId TEXT, label TEXT, metadata_json TEXT, createdAt INTEGER
      );
    `);
    runDatabaseMigrations(db);
    entities = new NarrativeEntitySystem(db);
    progression = new RoleplayProgression(db);
    skills = new RoleplaySkills(db);
    progression.saveSettings(WS, { mode: 'levels', config: { xp: { firstGoal: 1000, growth: 'add', growthAmount: 500, maxLevel: 20, guidance: '', aiOnlyAdds: true } } });
    skills.saveSettings(WS, { enabled: true });
    skills.saveSkill(WS, { name: 'Swordplay' });
  });

  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const proposal = (overrides: Record<string, unknown> = {}) => ({
    referenceId: 'new:captain', name: 'Captain Orrin', type: 'Characters' as const, aliases: [],
    description: 'A veteran captain of the guard.', excerpt: 'Captain Orrin, thirty years on the wall.',
    confidence: 0.98, decision: 'new' as const, identityEstablished: true, ...overrides
  });

  test('a character created at once starts where the story puts them', () => {
    const change = entities.resolveOrPropose(WS, 'turn-1', proposal({
      startingProfile: { level: 50, attributes: { strength: 25, dexterity: 13, wisdom: 18 }, skills: { swordplay: 'Master', alchemy: 'Novice' } }
    }));
    expect(change.status).toBe('applied');
    expect(change.proposal.startingProfile).toEqual({
      level: 20,
      attributes: [{ key: 'strength', name: 'Strength', value: 20 }, { key: 'dexterity', name: 'Dexterity', value: 13 }],
      skills: [{ key: 'swordplay', name: 'Swordplay', rank: 3, rankName: 'Master' }]
    });
    const progress = progression.getEntityProgress(WS, change.entityId!);
    expect(progress.level).toBe(20);
    expect(progress.xp).toBe(0);
    expect(progress.attributes.find(item => item.key === 'strength')?.value).toBe(20);
    expect(skills.getEntitySkills(WS, change.entityId!).skills).toEqual([expect.objectContaining({ key: 'swordplay', rankName: 'Master' })]);
    expect(progression.listHistory(WS, change.entityId!).map(entry => entry.reason)).toContain('Where they start');
  });

  test('a character waiting for review gets the profile only once approved', () => {
    const change = entities.resolveOrPropose(WS, 'turn-1', proposal({ confidence: 0.5, startingProfile: { level: 6 } }));
    expect(change.status).toBe('pending');
    expect(change.proposal.startingProfile).toEqual({ level: 6 });
    const approved = entities.resolveChange(WS, change.id, 'approved');
    expect(progression.getEntityProgress(WS, approved.entityId!).level).toBe(6);
  });

  test('parts the world has off, or keeps manual, are dropped', () => {
    progression.saveSettings(WS, { mode: 'off' });
    skills.saveSettings(WS, { config: { policy: 'manual' } });
    const change = entities.resolveOrPropose(WS, 'turn-1', proposal({ startingProfile: { level: 9, skills: { swordplay: 'Master' } } }));
    expect(change.proposal.startingProfile).toBeUndefined();
    expect(skills.getEntitySkills(WS, change.entityId!).skills).toEqual([]);
  });

  test('a match with someone who already exists keeps their own numbers', () => {
    const first = entities.resolveOrPropose(WS, 'turn-1', proposal());
    const again = entities.resolveOrPropose(WS, 'turn-2', proposal({ startingProfile: { level: 9 } }));
    expect(again.entityId).toBe(first.entityId);
    expect(progression.getEntityProgress(WS, first.entityId!).level).toBe(1);
  });
});
