import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { RoleplaySystem, type RoleplayUpdatePolicy } from './roleplay-system';
import { findByReference, requireUniqueName, ruleKey } from './rule-keys';
import { RoleplayProgression, listActors, normalizeMembers, resolveMemberLines, type EntityProgress, type ProgressionMember } from './roleplay-progression';

export type SkillStatus = 'confirmed' | 'proposed';
export type SkillChangeKind = 'assign' | 'rank' | 'remove' | 'create';

export interface SkillConfig {
  policy: RoleplayUpdatePolicy;
  /** The world's ladder, lowest first. A held skill stores its index here. */
  ranks: string[];
  aiAssigns: boolean;
  aiRaises: boolean;
  aiLowers: boolean;
  aiCreates: boolean;
  guidance: string;
}

export interface SkillSettings {
  workspaceId: string;
  enabled: boolean;
  config: SkillConfig;
  members: ProgressionMember[];
  playerEntityId: string | null;
}

export interface SkillDefinition {
  id: string;
  workspaceId: string;
  key: string;
  name: string;
  description: string;
  parentId: string | null;
  status: SkillStatus;
  position: number;
}

export interface EntitySkill {
  skillId: string;
  key: string;
  name: string;
  description: string;
  parentId: string | null;
  rank: number;
  rankName: string;
}

export interface EntitySkills {
  entityId: string;
  enabled: boolean;
  learns: boolean;
  learnsThrough: EntityProgress['progressesThrough'];
  skills: EntitySkill[];
}

export interface SkillChange {
  id: string;
  workspaceId: string;
  entityId: string;
  skillId: string;
  kind: SkillChangeKind;
  previousRank: number | null;
  nextRank: number | null;
  reason: string;
  status: 'pending' | 'applied' | 'rejected';
  source: 'manual' | 'ai';
  provenanceId: string | null;
  createdAt: number;
  resolvedAt: number | null;
}

/** What the narrative analysis may ask for. Skills are named by key, never by id. */
export interface SkillChangeInput {
  id: string;
  workspaceId: string;
  entityId: string;
  kind: 'assign' | 'rank' | 'create';
  skillKey?: string;
  /** Assign and create: the starting rank, by index or by name. Rank: +1 or -1. */
  rank?: number | string;
  direction?: number;
  name?: string;
  description?: string;
  parentKey?: string;
  reason?: string;
  source: 'ai' | 'manual';
  provenanceId?: string;
}

export const DEFAULT_SKILL_RANKS = ['Novice', 'Apprentice', 'Competent', 'Master'];

const DEFAULT_CONFIG: SkillConfig = {
  policy: 'review',
  ranks: DEFAULT_SKILL_RANKS,
  aiAssigns: true,
  aiRaises: true,
  aiLowers: false,
  aiCreates: false,
  guidance: ''
};

const MAX_RANKS = 12;

export class RoleplaySkills {
  private readonly roleplay: RoleplaySystem;
  private readonly progression: RoleplayProgression;

  constructor(private readonly db: Database.Database) {
    this.roleplay = new RoleplaySystem(db);
    this.progression = new RoleplayProgression(db);
  }

  getSettings(workspaceId: string): SkillSettings {
    const row = this.db.prepare('SELECT enabled, config_json FROM roleplay_skill_settings WHERE workspace_id = ?')
      .get(workspaceId) as { enabled: number; config_json: string } | undefined;
    const members = (this.db.prepare(`
      SELECT target_type, target_id FROM roleplay_skill_members WHERE workspace_id = ? ORDER BY added_at, target_id
    `).all(workspaceId) as Array<{ target_type: ProgressionMember['targetType']; target_id: string }>)
      .map(item => ({ targetType: item.target_type, targetId: item.target_id }));
    return {
      workspaceId,
      enabled: Boolean(row?.enabled),
      config: normalizeSkillConfig(parseObject(row?.config_json)),
      members,
      playerEntityId: this.roleplay.getSettings(workspaceId).playerEntityId
    };
  }

  saveSettings(workspaceId: string, input: { enabled?: boolean; config?: Partial<SkillConfig> }): SkillSettings {
    const current = this.getSettings(workspaceId);
    const enabled = input.enabled === undefined ? current.enabled : Boolean(input.enabled);
    const config = normalizeSkillConfig({ ...current.config, ...(input.config || {}) });
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO roleplay_skill_settings (workspace_id, enabled, config_json, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(workspace_id) DO UPDATE SET
          enabled = excluded.enabled, config_json = excluded.config_json, updated_at = excluded.updated_at
      `).run(workspaceId, enabled ? 1 : 0, JSON.stringify(config), Date.now());
      // A shorter ladder keeps everyone at its top rather than at a rank that no longer exists.
      this.db.prepare('UPDATE roleplay_skill_values SET rank = ?, updated_at = ? WHERE workspace_id = ? AND rank > ?')
        .run(config.ranks.length - 1, Date.now(), workspaceId, config.ranks.length - 1);
    })();
    return this.getSettings(workspaceId);
  }

  setMembers(workspaceId: string, input: ProgressionMember[]): SkillSettings {
    const members = normalizeMembers(input);
    members.forEach(member => this.progression.requireMemberTarget(workspaceId, member));
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM roleplay_skill_members WHERE workspace_id = ?').run(workspaceId);
      const insert = this.db.prepare('INSERT INTO roleplay_skill_members (workspace_id, target_type, target_id, added_at) VALUES (?, ?, ?, ?)');
      members.forEach((member, index) => insert.run(workspaceId, member.targetType, member.targetId, Date.now() + index));
    })();
    return this.getSettings(workspaceId);
  }

  /** Who the AI may give skills to or move along the ladder. Anyone can still hold skills set by hand. */
  learningIds(workspaceId: string): string[] {
    const settings = this.getSettings(workspaceId);
    if (!settings.enabled) return [];
    return [...resolveMemberLines(this.db, workspaceId, settings.members, settings.playerEntityId).keys()];
  }

  /**
   * The catalog: confirmed skills, plus proposed ones still waiting on their review. A proposal
   * that was dismissed, or whose turn was undone, stays stored but out of sight.
   */
  listSkills(workspaceId: string): SkillDefinition[] {
    const rows = this.db.prepare(`
      SELECT * FROM roleplay_skills AS skills
      WHERE workspace_id = ? AND (status = 'confirmed' OR EXISTS (
        SELECT 1 FROM roleplay_skill_changes AS changes
        WHERE changes.workspace_id = skills.workspace_id AND changes.skill_id = skills.skill_id
          AND changes.kind = 'create' AND changes.status = 'pending'
      ))
      ORDER BY position, name COLLATE NOCASE
    `).all(workspaceId) as Array<Record<string, unknown>>;
    return orderByParent(rows.map(hydrateSkill));
  }

  saveSkill(workspaceId: string, input: Partial<SkillDefinition> & { name: string }): SkillDefinition {
    const name = String(input.name || '').trim();
    if (!name) throw new Error('Give it a name.');
    const existing = input.id ? this.findSkill(workspaceId, input.id) : undefined;
    const others = this.allSkills(workspaceId);
    requireUniqueName(name, others, input.id, 'a skill');
    const key = ruleKey({ name, givenKey: input.key, previous: existing, taken: others.map(skill => skill.key), prefix: 'skill' });
    const parentId = input.parentId ? String(input.parentId) : null;
    if (parentId) {
      const parent = this.findSkill(workspaceId, parentId);
      if (!parent || parent.status !== 'confirmed') throw new Error('That parent skill no longer exists.');
      if (parent.id === input.id) throw new Error('A skill cannot be its own parent.');
      if (parent.parentId) throw new Error('Sub-skills cannot have sub-skills of their own.');
      if (input.id && this.childrenOf(workspaceId, input.id).length) throw new Error('This skill has sub-skills, so it cannot become one.');
    }
    const id = input.id || randomUUID();
    const position = Number.isFinite(input.position) ? Number(input.position) : existing?.position ?? this.countSkills(workspaceId);
    this.db.prepare(`
      INSERT INTO roleplay_skills (workspace_id, skill_id, skill_key, name, description, parent_id, status, position, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, skill_id) DO UPDATE SET
        skill_key = excluded.skill_key, name = excluded.name, description = excluded.description,
        parent_id = excluded.parent_id, position = excluded.position, updated_at = excluded.updated_at
    `).run(workspaceId, id, key, name, String(input.description || '').trim(), parentId,
      input.status === 'proposed' ? 'proposed' : existing?.status ?? 'confirmed', position, Date.now());
    return this.findSkill(workspaceId, id)!;
  }

  /** Sub-skills of a deleted skill move up to the top level instead of going with it. */
  deleteSkill(workspaceId: string, skillId: string): void {
    this.db.transaction(() => {
      this.db.prepare('UPDATE roleplay_skills SET parent_id = NULL, updated_at = ? WHERE workspace_id = ? AND parent_id = ?')
        .run(Date.now(), workspaceId, skillId);
      this.db.prepare('DELETE FROM roleplay_skill_values WHERE workspace_id = ? AND skill_id = ?').run(workspaceId, skillId);
      this.db.prepare(`
        UPDATE roleplay_skill_changes SET status = 'rejected', resolved_at = ?
        WHERE workspace_id = ? AND skill_id = ? AND status = 'pending'
      `).run(Date.now(), workspaceId, skillId);
      this.db.prepare('DELETE FROM roleplay_skills WHERE workspace_id = ? AND skill_id = ?').run(workspaceId, skillId);
    })();
  }

  getEntitySkills(workspaceId: string, entityId: string): EntitySkills {
    const settings = this.getSettings(workspaceId);
    const through = settings.enabled
      ? resolveMemberLines(this.db, workspaceId, settings.members, settings.playerEntityId).get(entityId) ?? null
      : null;
    const rows = this.db.prepare(`
      SELECT skills.*, skill_values.rank FROM roleplay_skill_values AS skill_values
      JOIN roleplay_skills AS skills ON skills.workspace_id = skill_values.workspace_id AND skills.skill_id = skill_values.skill_id
      WHERE skill_values.workspace_id = ? AND skill_values.entity_id = ? AND skills.status = 'confirmed'
      ORDER BY skills.position, skills.name COLLATE NOCASE
    `).all(workspaceId, entityId) as Array<Record<string, unknown>>;
    const ranks = settings.config.ranks;
    const skills = orderByParent(rows.map(row => ({ ...hydrateSkill(row), rank: Number(row.rank) }))).map(skill => {
      const rank = clampRank(skill.rank, ranks);
      return { skillId: skill.id, key: skill.key, name: skill.name, description: skill.description, parentId: skill.parentId, rank, rankName: ranks[rank] };
    });
    return { entityId, enabled: settings.enabled, learns: Boolean(through), learnsThrough: through, skills };
  }

  /** A hand edit: give a skill at a rank, move it, or take it away with null. */
  setEntitySkill(workspaceId: string, entityId: string, skillId: string, rank: number | null): EntitySkills {
    if (!listActors(this.db, workspaceId).has(entityId)) throw new Error('Confirmed workspace entity was not found.');
    const skill = this.findSkill(workspaceId, skillId);
    if (!skill || skill.status !== 'confirmed') throw new Error('That skill no longer exists.');
    const ranks = this.getSettings(workspaceId).config.ranks;
    const before = this.heldRank(workspaceId, entityId, skillId);
    this.db.transaction(() => {
      if (rank === null) {
        if (before === null) return;
        this.db.prepare('DELETE FROM roleplay_skill_values WHERE workspace_id = ? AND entity_id = ? AND skill_id = ?').run(workspaceId, entityId, skillId);
        this.recordChange({ workspaceId, entityId, skillId, kind: 'remove', previousRank: before, nextRank: null, reason: '', status: 'applied', source: 'manual' });
        return;
      }
      const next = clampRank(Math.round(Number(rank)), ranks);
      if (before === next) return;
      this.writeRank(workspaceId, entityId, skillId, next);
      this.recordChange({ workspaceId, entityId, skillId, kind: before === null ? 'assign' : 'rank', previousRank: before, nextRank: next, reason: '', status: 'applied', source: 'manual' });
    })();
    return this.getEntitySkills(workspaceId, entityId);
  }

  /** A skill a newly introduced character already has, from what the story says about them. */
  setStartingSkill(workspaceId: string, entityId: string, key: string, rank: number, provenanceId: string): void {
    const skill = this.findSkillByReference(workspaceId, key);
    if (!skill || skill.status !== 'confirmed' || this.heldRank(workspaceId, entityId, skill.id) !== null) return;
    const next = clampRank(rank, this.getSettings(workspaceId).config.ranks);
    this.db.transaction(() => {
      this.writeRank(workspaceId, entityId, skill.id, next);
      this.recordChange({ workspaceId, entityId, skillId: skill.id, kind: 'assign', previousRank: null, nextRank: next, reason: 'Where they start', status: 'applied', source: 'ai', provenanceId });
    })();
  }

  /**
   * An AI change. It only reaches who learns, follows each switch in the rules, and moves a
   * rank one step at most per turn. Unknown keys are ignored: only `create` adds to the catalog.
   */
  proposeChange(input: SkillChangeInput): SkillChange | null {
    const existing = this.getChange(input.workspaceId, input.id);
    if (existing) return existing;
    const settings = this.getSettings(input.workspaceId);
    const { config } = settings;
    if (!settings.enabled) return null;
    if (input.source === 'ai' && config.policy === 'manual') return null;
    if (!this.learningIds(input.workspaceId).includes(input.entityId)) return null;
    const status = input.source === 'ai' && config.policy === 'review' ? 'pending' : 'applied';
    const reason = String(input.reason || '');
    let skill = input.skillKey ? this.findSkillByReference(input.workspaceId, input.skillKey) : undefined;
    let kind: SkillChangeKind = input.kind;
    if (kind === 'create') {
      if (!config.aiCreates && input.source === 'ai') return null;
      const name = String(input.name || '').trim();
      if (!name) return null;
      skill = this.findSkillByReference(input.workspaceId, input.skillKey || name);
      // A skill the catalog already has is given, not created again.
      if (skill) kind = 'assign';
    }
    if (kind !== 'create' && (!skill || skill.status !== 'confirmed')) return null;
    if (skill && this.touchedThisTurn(input.workspaceId, input.entityId, skill.id, input.provenanceId)) return null;
    const held = skill ? this.heldRank(input.workspaceId, input.entityId, skill.id) : null;
    let previousRank: number | null = held;
    let nextRank: number;
    if (kind === 'rank') {
      if (held === null) return null;
      const step = Math.sign(Number(input.direction ?? input.rank));
      if (step > 0 && !config.aiRaises) return null;
      if (step < 0 && !config.aiLowers) return null;
      if (!step) return null;
      nextRank = clampRank(held + step, config.ranks);
      if (nextRank === held) return null;
    } else {
      if (kind === 'assign' && !config.aiAssigns && input.source === 'ai') return null;
      if (held !== null) return null;
      previousRank = null;
      nextRank = rankIndex(input.rank, config.ranks);
    }
    this.db.transaction(() => {
      if (kind === 'create') {
        const parent = input.parentKey ? this.findSkillByReference(input.workspaceId, input.parentKey) : undefined;
        skill = this.saveSkill(input.workspaceId, {
          name: String(input.name).trim(),
          key: input.skillKey || undefined,
          description: String(input.description || ''),
          parentId: parent && parent.status === 'confirmed' && !parent.parentId ? parent.id : null,
          status: 'proposed'
        });
      }
      this.recordChange({
        id: input.id, workspaceId: input.workspaceId, entityId: input.entityId, skillId: skill!.id, kind,
        previousRank, nextRank, reason, status, source: input.source, provenanceId: input.provenanceId ?? null
      });
      if (status === 'applied') this.applyChange(input.workspaceId, input.id);
    })();
    return this.getChange(input.workspaceId, input.id) ?? null;
  }

  resolveChange(workspaceId: string, changeId: string, decision: 'approved' | 'rejected'): SkillChange {
    const change = this.getChange(workspaceId, changeId);
    if (!change) throw new Error('This change no longer exists.');
    if (change.status !== 'pending') return change;
    this.db.transaction(() => {
      if (decision === 'approved') this.applyChange(workspaceId, changeId);
      else this.db.prepare(`
        UPDATE roleplay_skill_changes SET status = 'rejected', resolved_at = ? WHERE workspace_id = ? AND change_id = ?
      `).run(Date.now(), workspaceId, changeId);
    })();
    return this.getChange(workspaceId, changeId)!;
  }

  listChanges(workspaceId: string, entityId?: string): SkillChange[] {
    return (this.db.prepare(`
      SELECT * FROM roleplay_skill_changes WHERE workspace_id = ?${entityId ? ' AND entity_id = ?' : ''}
      ORDER BY created_at, change_id
    `).all(...(entityId ? [workspaceId, entityId] : [workspaceId])) as Array<Record<string, unknown>>).map(hydrateChange);
  }

  private applyChange(workspaceId: string, changeId: string): void {
    const change = this.getChange(workspaceId, changeId)!;
    const ranks = this.getSettings(workspaceId).config.ranks;
    const before = this.heldRank(workspaceId, change.entityId, change.skillId);
    let next = change.nextRank;
    if (change.kind === 'create') {
      this.db.prepare("UPDATE roleplay_skills SET status = 'confirmed', updated_at = ? WHERE workspace_id = ? AND skill_id = ?")
        .run(Date.now(), workspaceId, change.skillId);
    }
    if (change.kind === 'remove') {
      this.db.prepare('DELETE FROM roleplay_skill_values WHERE workspace_id = ? AND entity_id = ? AND skill_id = ?').run(workspaceId, change.entityId, change.skillId);
      next = null;
    } else if (change.kind === 'rank') {
      // The step is kept, not the target: a hand edit made while it waited still counts.
      if (before === null) throw new Error('They no longer have this skill.');
      next = clampRank(before + Math.sign(Number(change.nextRank) - Number(change.previousRank)), ranks);
      this.writeRank(workspaceId, change.entityId, change.skillId, next);
    } else {
      next = clampRank(Number(change.nextRank ?? 0), ranks);
      this.writeRank(workspaceId, change.entityId, change.skillId, next);
    }
    this.db.prepare(`
      UPDATE roleplay_skill_changes SET status = 'applied', previous_rank = ?, next_rank = ?, resolved_at = ?
      WHERE workspace_id = ? AND change_id = ?
    `).run(before, next, Date.now(), workspaceId, changeId);
  }

  private touchedThisTurn(workspaceId: string, entityId: string, skillId: string, provenanceId?: string): boolean {
    if (!provenanceId) return false;
    return Boolean(this.db.prepare(`
      SELECT 1 FROM roleplay_skill_changes
      WHERE workspace_id = ? AND entity_id = ? AND skill_id = ? AND provenance_id = ? AND status != 'rejected'
    `).get(workspaceId, entityId, skillId, provenanceId));
  }

  private heldRank(workspaceId: string, entityId: string, skillId: string): number | null {
    const row = this.db.prepare('SELECT rank FROM roleplay_skill_values WHERE workspace_id = ? AND entity_id = ? AND skill_id = ?')
      .get(workspaceId, entityId, skillId) as { rank: number } | undefined;
    return row ? Number(row.rank) : null;
  }

  private writeRank(workspaceId: string, entityId: string, skillId: string, rank: number): void {
    this.db.prepare(`
      INSERT INTO roleplay_skill_values (workspace_id, entity_id, skill_id, rank, updated_at) VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, entity_id, skill_id) DO UPDATE SET rank = excluded.rank, updated_at = excluded.updated_at
    `).run(workspaceId, entityId, skillId, rank, Date.now());
  }

  private recordChange(change: Omit<SkillChange, 'id' | 'createdAt' | 'resolvedAt' | 'provenanceId'> & { id?: string; provenanceId?: string | null }): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO roleplay_skill_changes (
        workspace_id, change_id, entity_id, skill_id, kind, previous_rank, next_rank,
        reason, status, source, provenance_id, created_at, resolved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(change.workspaceId, change.id || randomUUID(), change.entityId, change.skillId, change.kind, change.previousRank,
      change.nextRank, String(change.reason || '').trim().slice(0, 240), change.status, change.source,
      change.provenanceId ?? null, now, change.status === 'applied' ? now : null);
  }

  private getChange(workspaceId: string, changeId: string): SkillChange | undefined {
    const row = this.db.prepare('SELECT * FROM roleplay_skill_changes WHERE workspace_id = ? AND change_id = ?')
      .get(workspaceId, changeId) as Record<string, unknown> | undefined;
    return row ? hydrateChange(row) : undefined;
  }

  private findSkill(workspaceId: string, skillId: string): SkillDefinition | undefined {
    const row = this.db.prepare('SELECT * FROM roleplay_skills WHERE workspace_id = ? AND skill_id = ?')
      .get(workspaceId, skillId) as Record<string, unknown> | undefined;
    return row ? hydrateSkill(row) : undefined;
  }

  private childrenOf(workspaceId: string, skillId: string): string[] {
    return (this.db.prepare('SELECT skill_id FROM roleplay_skills WHERE workspace_id = ? AND parent_id = ?')
      .all(workspaceId, skillId) as Array<{ skill_id: string }>).map(row => row.skill_id);
  }

  /** Every stored skill, hidden proposals included, so names and keys stay unique among all of them. */
  private allSkills(workspaceId: string): SkillDefinition[] {
    return (this.db.prepare('SELECT * FROM roleplay_skills WHERE workspace_id = ?').all(workspaceId) as Array<Record<string, unknown>>).map(hydrateSkill);
  }

  /** A skill the AI named, by name or by key. */
  findSkillByReference(workspaceId: string, reference: unknown): SkillDefinition | undefined {
    return findByReference(this.allSkills(workspaceId), reference);
  }

  private countSkills(workspaceId: string): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS count FROM roleplay_skills WHERE workspace_id = ?').get(workspaceId) as { count: number }).count);
  }
}

export function normalizeSkillConfig(input: Record<string, any>): SkillConfig {
  const ranks = (Array.isArray(input.ranks) ? input.ranks : [])
    .map((rank: unknown) => String(rank ?? '').trim().slice(0, 40))
    .filter(Boolean)
    .slice(0, MAX_RANKS);
  return {
    policy: input.policy === 'manual' || input.policy === 'automatic' ? input.policy : 'review',
    ranks: ranks.length >= 2 ? ranks : [...DEFAULT_CONFIG.ranks],
    aiAssigns: input.aiAssigns !== false,
    aiRaises: input.aiRaises !== false,
    aiLowers: input.aiLowers === true,
    aiCreates: input.aiCreates === true,
    guidance: String(input.guidance || '')
  };
}

/** Parents first, each followed by its sub-skills, keeping catalog order inside each group. */
function orderByParent<T extends { id: string; parentId: string | null }>(items: T[]): T[] {
  const ids = new Set(items.map(item => item.id));
  const roots = items.filter(item => !item.parentId || !ids.has(item.parentId));
  return roots.flatMap(root => [root, ...items.filter(item => item.parentId === root.id)]);
}

function rankIndex(value: unknown, ranks: string[]): number {
  if (typeof value === 'string' && !/^\d+$/.test(value.trim())) {
    const found = ranks.findIndex(rank => rank.toLowerCase() === value.trim().toLowerCase());
    return found >= 0 ? found : 0;
  }
  return clampRank(Math.round(Number(value) || 0), ranks);
}

function clampRank(rank: number, ranks: string[]): number {
  return Math.max(0, Math.min(ranks.length - 1, Number.isFinite(rank) ? rank : 0));
}

function hydrateSkill(row: Record<string, unknown>): SkillDefinition {
  return {
    id: String(row.skill_id), workspaceId: String(row.workspace_id), key: String(row.skill_key),
    name: String(row.name), description: String(row.description ?? ''),
    parentId: row.parent_id ? String(row.parent_id) : null,
    status: row.status === 'proposed' ? 'proposed' : 'confirmed',
    position: Number(row.position)
  };
}

function hydrateChange(row: Record<string, unknown>): SkillChange {
  return {
    id: String(row.change_id), workspaceId: String(row.workspace_id), entityId: String(row.entity_id),
    skillId: String(row.skill_id), kind: String(row.kind) as SkillChangeKind,
    previousRank: row.previous_rank === null ? null : Number(row.previous_rank),
    nextRank: row.next_rank === null ? null : Number(row.next_rank),
    reason: String(row.reason ?? ''), status: String(row.status) as SkillChange['status'],
    source: row.source === 'ai' ? 'ai' : 'manual', provenanceId: row.provenance_id ? String(row.provenance_id) : null,
    createdAt: Number(row.created_at), resolvedAt: row.resolved_at === null ? null : Number(row.resolved_at)
  };
}

function parseObject(value: unknown): Record<string, any> {
  try {
    const parsed = JSON.parse(String(value || '{}')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, any> : {};
  } catch {
    return {};
  }
}
