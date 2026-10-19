import type Database from 'better-sqlite3';
import { RoleplayProgression } from './roleplay-progression';
import { RoleplaySkills } from './roleplay-skills';
import { findByReference } from './rule-keys';

/** Stored on the proposal by name so the review can read it; written only once the entity exists. */
export interface StartingProfile {
  level?: number;
  attributes?: Array<{ key: string; name: string; value: number }>;
  skills?: Array<{ key: string; name: string; rank: number; rankName: string }>;
}

/**
 * Keeps what this world's rules allow: a level only with levels on, attributes it defines,
 * confirmed skills while skills are on. A Manual policy keeps the AI out of that part.
 */
export function resolveStartingProfile(db: Database.Database, workspaceId: string, input: unknown): StartingProfile | undefined {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return undefined;
  const raw = input as Record<string, any>;
  const profile: StartingProfile = {};
  const progression = new RoleplayProgression(db);
  const settings = progression.getSettings(workspaceId);
  if (settings.mode === 'levels' && settings.config.policy !== 'manual') {
    const level = Math.round(Number(raw.level));
    const top = settings.config.xp.maxLevel ?? Infinity;
    if (Number.isFinite(level) && level > 1) profile.level = Math.min(level, top);
    const traits = progression.listTraits(workspaceId);
    const attributes = Object.entries(raw.attributes && typeof raw.attributes === 'object' ? raw.attributes : {}).flatMap(([reference, value]) => {
      const trait = findByReference(traits, reference);
      const number = Math.round(Number(value));
      if (!trait || !Number.isFinite(number)) return [];
      return [{ key: trait.key, name: trait.name, value: Math.max(trait.minimum, Math.min(trait.maximum, number)) }];
    });
    if (attributes.length) profile.attributes = attributes;
  }
  const skillSystem = new RoleplaySkills(db);
  const skillSettings = skillSystem.getSettings(workspaceId);
  if (skillSettings.enabled && skillSettings.config.policy !== 'manual') {
    const ranks = skillSettings.config.ranks;
    const catalog = skillSystem.listSkills(workspaceId).filter(skill => skill.status === 'confirmed');
    const skills = Object.entries(raw.skills && typeof raw.skills === 'object' ? raw.skills : {}).flatMap(([reference, value]) => {
      const skill = findByReference(catalog, reference);
      if (!skill) return [];
      const byName = ranks.findIndex(rank => rank.toLowerCase() === String(value).trim().toLowerCase());
      const rank = byName >= 0 ? byName : Math.max(0, Math.min(ranks.length - 1, Math.round(Number(value)) || 0));
      return [{ key: skill.key, name: skill.name, rank, rankName: ranks[rank] }];
    });
    if (skills.length) profile.skills = skills;
  }
  return profile.level || profile.attributes || profile.skills ? profile : undefined;
}

/** Writes the profile onto a character that was just created. Rules are read again, as they may have changed while it waited. */
export function applyStartingProfile(db: Database.Database, workspaceId: string, entityId: string, profile: StartingProfile | undefined, provenanceId: string): void {
  if (!profile) return;
  const current = resolveStartingProfile(db, workspaceId, {
    level: profile.level,
    attributes: Object.fromEntries((profile.attributes || []).map(item => [item.key, item.value])),
    skills: Object.fromEntries((profile.skills || []).map(item => [item.key, item.rankName]))
  });
  if (!current) return;
  if (current.level || current.attributes) {
    new RoleplayProgression(db).setStartingValues(workspaceId, entityId, {
      level: current.level,
      attributes: Object.fromEntries((current.attributes || []).map(item => [item.key, item.value]))
    }, provenanceId);
  }
  if (current.skills) {
    const skills = new RoleplaySkills(db);
    current.skills.forEach(skill => skills.setStartingSkill(workspaceId, entityId, skill.key, skill.rank, provenanceId));
  }
}
