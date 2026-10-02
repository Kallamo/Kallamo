import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { RoleplaySystem, type RoleplayUpdatePolicy } from './roleplay-system';

export type ProgressionMode = 'off' | 'levels';
export type GoalGrowth = 'same' | 'add' | 'multiply';
export type ProgressKind = 'xp' | 'level' | 'attribute';
export type ProgressSource = 'manual' | 'ai' | 'level';
export type MemberTarget = 'everyone' | 'entity' | 'race' | 'species' | 'type';

/** One line of who progresses: a character, everyone, or everyone of a race, species or kind. */
export interface ProgressionMember { targetType: MemberTarget; targetId: string }

export interface LevelReward { definitionId: string; maximumIncrease: number; refill: boolean }

export interface ProgressionConfig {
  policy: RoleplayUpdatePolicy;
  xp: { firstGoal: number; growth: GoalGrowth; growthAmount: number; maxLevel: number | null; guidance: string; aiOnlyAdds: boolean };
  attributes: { aiRaises: boolean; aiLowers: boolean; guidance: string };
  rewards: LevelReward[];
}

export interface ProgressionSettings {
  workspaceId: string;
  mode: ProgressionMode;
  config: ProgressionConfig;
  members: ProgressionMember[];
  playerEntityId: string | null;
}

export interface TraitDefinition {
  id: string;
  workspaceId: string;
  key: string;
  name: string;
  description: string;
  initialValue: number;
  minimum: number;
  maximum: number;
  position: number;
}

export interface EntityAttribute {
  traitId: string; key: string; name: string; description: string;
  base: number; bonus: number; value: number; minimum: number; maximum: number;
  bonusFromId: string | null; bonusFromName: string | null;
}

export interface EntityProgress {
  entityId: string;
  mode: ProgressionMode;
  progresses: boolean;
  /** Why they progress: the player, a line added for them, or a group line. */
  progressesThrough: ProgressionMember | { targetType: 'player'; targetId: string } | null;
  player: boolean;
  level: number;
  xp: number;
  goal: number | null;
  attributes: EntityAttribute[];
}

export interface ProgressChange {
  id: string; workspaceId: string; entityId: string; kind: ProgressKind; traitId: string | null;
  delta: number; previousValue: number; nextValue: number; reason: string;
  status: 'pending' | 'applied' | 'rejected'; source: ProgressSource;
  provenanceId: string | null; createdAt: number; resolvedAt: number | null;
}

export interface ProgressChangeInput {
  id: string;
  workspaceId: string;
  entityId: string;
  kind: 'xp' | 'attribute';
  traitId?: string | null;
  delta: number;
  reason?: string;
  source: 'ai' | 'manual';
  provenanceId?: string;
}

export interface HistoryEntry {
  id: string;
  area: 'resource' | 'progress';
  kind: string;
  label: string;
  /** The resource or trait the entry is about, for its colour. */
  refId: string | null;
  delta: number | null;
  previousValue: number;
  nextValue: number;
  maximumDelta: number;
  reason: string;
  status: 'pending' | 'applied' | 'rejected';
  source: string;
  turnNumber: number | null;
  createdAt: number;
}

type ValueTarget = 'entity' | 'race' | 'species';

const LEVEL = '__level';
const XP = '__xp';

const DEFAULT_CONFIG: ProgressionConfig = {
  policy: 'review',
  xp: { firstGoal: 1000, growth: 'add', growthAmount: 500, maxLevel: null, guidance: '', aiOnlyAdds: true },
  attributes: { aiRaises: true, aiLowers: false, guidance: '' },
  rewards: []
};

const DEFAULT_ATTRIBUTES = [
  { key: 'strength', name: 'Strength', description: 'Lifting, forcing doors, melee damage.' },
  { key: 'dexterity', name: 'Dexterity', description: 'Aim, balance, stealth, picking locks.' },
  { key: 'intellect', name: 'Intellect', description: 'Magic, study, noticing what does not add up.' },
  { key: 'presence', name: 'Presence', description: 'Persuading, leading, being remembered.' }
];

export class RoleplayProgression {
  private readonly roleplay: RoleplaySystem;

  constructor(private readonly db: Database.Database) {
    this.roleplay = new RoleplaySystem(db);
  }

  getSettings(workspaceId: string): ProgressionSettings {
    const row = this.db.prepare('SELECT mode, config_json FROM roleplay_progression_settings WHERE workspace_id = ?')
      .get(workspaceId) as { mode: string; config_json: string } | undefined;
    const members = (this.db.prepare(`
      SELECT target_type, target_id FROM roleplay_progression_members WHERE workspace_id = ? ORDER BY added_at, target_id
    `).all(workspaceId) as Array<{ target_type: MemberTarget; target_id: string }>)
      .map(item => ({ targetType: item.target_type, targetId: item.target_id }));
    return {
      workspaceId,
      mode: normalizeMode(row?.mode),
      config: normalizeConfig(parseObject(row?.config_json)),
      members,
      playerEntityId: this.roleplay.getSettings(workspaceId).playerEntityId
    };
  }

  saveSettings(workspaceId: string, input: { mode?: ProgressionMode; config?: Partial<ProgressionConfig> }): ProgressionSettings {
    const current = this.getSettings(workspaceId);
    const mode = input.mode === undefined ? current.mode : normalizeMode(input.mode);
    const config = normalizeConfig({ ...current.config, ...(input.config || {}) });
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO roleplay_progression_settings (workspace_id, mode, config_json, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(workspace_id) DO UPDATE SET
          mode = excluded.mode, config_json = excluded.config_json, updated_at = excluded.updated_at
      `).run(workspaceId, mode, JSON.stringify(config), Date.now());
      // Choosing levels the first time starts from four common attributes the user can rename.
      if (mode === 'levels' && !this.listTraits(workspaceId).length) {
        DEFAULT_ATTRIBUTES.forEach((attribute, position) => this.saveTrait(workspaceId, {
          ...attribute, initialValue: 10, minimum: 1, maximum: 20, position
        }));
      }
    })();
    return this.getSettings(workspaceId);
  }

  setMembers(workspaceId: string, input: ProgressionMember[]): ProgressionSettings {
    const members = normalizeMembers(input);
    members.forEach(member => this.requireMemberTarget(workspaceId, member));
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM roleplay_progression_members WHERE workspace_id = ?').run(workspaceId);
      const insert = this.db.prepare('INSERT INTO roleplay_progression_members (workspace_id, target_type, target_id, added_at) VALUES (?, ?, ?, ?)');
      members.forEach((member, index) => insert.run(workspaceId, member.targetType, member.targetId, Date.now() + index));
    })();
    return this.getSettings(workspaceId);
  }

  /** The player character always progresses; everyone else only through a line in who progresses. */
  progressingIds(workspaceId: string): string[] {
    const settings = this.getSettings(workspaceId);
    if (settings.mode === 'off') return [];
    return [...this.resolveMembers(workspaceId, settings).keys()];
  }

  /** Each progressing actor with the first line that includes them. */
  private resolveMembers(workspaceId: string, settings: ProgressionSettings): Map<string, EntityProgress['progressesThrough']> {
    const result = new Map<string, EntityProgress['progressesThrough']>();
    if (settings.playerEntityId) result.set(settings.playerEntityId, { targetType: 'player', targetId: settings.playerEntityId });
    if (!settings.members.length) return result;
    const actors = this.listActors(workspaceId);
    const groupMembers = (sql: string, groupId: string) => new Set((this.db.prepare(sql).all(workspaceId, groupId) as Array<{ id: string }>).map(row => row.id));
    for (const member of settings.members) {
      let ids: Iterable<string>;
      if (member.targetType === 'everyone') ids = actors.keys();
      else if (member.targetType === 'entity') ids = actors.has(member.targetId) ? [member.targetId] : [];
      else if (member.targetType === 'type') ids = [...actors].filter(([, type]) => type === member.targetId).map(([id]) => id);
      else {
        // Race and species membership are both the race link.
        ids = [...groupMembers("SELECT fromId AS id FROM entity_links WHERE workspaceId = ? AND toId = ? AND relType = 'is_race'", member.targetId)]
          .filter(id => actors.has(id));
      }
      for (const id of ids) if (!result.has(id)) result.set(id, member);
    }
    return result;
  }

  /** Confirmed characters and specific beings, with their type. A species is never an actor. */
  private listActors(workspaceId: string): Map<string, string> {
    const rows = this.db.prepare(`
      SELECT id, type, data FROM entities
      WHERE workspaceId = ? AND status != 'proposed' AND type IN ('Characters', 'Creatures')
    `).all(workspaceId) as Array<{ id: string; type: string; data: string | null }>;
    return new Map(rows.filter(row => row.type === 'Characters' || parseObject(row.data).scope !== 'group').map(row => [row.id, row.type]));
  }

  listTraits(workspaceId: string): TraitDefinition[] {
    const rows = this.db.prepare(`
      SELECT * FROM roleplay_trait_definitions WHERE workspace_id = ? ORDER BY position, name COLLATE NOCASE
    `).all(workspaceId) as Array<Record<string, unknown>>;
    return rows.map(hydrateTrait);
  }

  saveTrait(workspaceId: string, input: Partial<TraitDefinition> & { name: string }): TraitDefinition {
    const name = String(input.name || '').trim();
    if (!name) throw new Error('Give it a name.');
    const key = String(input.key || name).normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || `trait-${Date.now()}`;
    const minimum = Number(input.minimum ?? 1);
    const maximum = Number(input.maximum ?? 20);
    const initialValue = Number(input.initialValue ?? 10);
    if (![minimum, maximum, initialValue].every(Number.isFinite) || maximum <= minimum) {
      throw new Error('The highest value must be above the lowest.');
    }
    if (initialValue < minimum || initialValue > maximum) throw new Error('The starting value is outside the range.');
    const id = input.id || randomUUID();
    const position = Number.isFinite(input.position)
      ? Number(input.position)
      : this.listTraits(workspaceId).length;
    this.db.prepare(`
      INSERT INTO roleplay_trait_definitions (
        workspace_id, trait_id, trait_key, name, description, initial_value, minimum, maximum, position, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, trait_id) DO UPDATE SET
        trait_key = excluded.trait_key, name = excluded.name, description = excluded.description,
        initial_value = excluded.initial_value, minimum = excluded.minimum, maximum = excluded.maximum,
        position = excluded.position, updated_at = excluded.updated_at
    `).run(workspaceId, id, key, name, String(input.description || '').trim(), initialValue, minimum, maximum, position, Date.now());
    return this.requireTrait(workspaceId, id);
  }

  deleteTrait(workspaceId: string, traitId: string): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM roleplay_progress_values WHERE workspace_id = ? AND trait_id = ?').run(workspaceId, traitId);
      this.db.prepare(`
        UPDATE roleplay_progress_changes SET status = 'rejected', resolved_at = ?
        WHERE workspace_id = ? AND trait_id = ? AND status = 'pending'
      `).run(Date.now(), workspaceId, traitId);
      this.db.prepare('DELETE FROM roleplay_trait_definitions WHERE workspace_id = ? AND trait_id = ?').run(workspaceId, traitId);
    })();
  }

  getEntityProgress(workspaceId: string, entityId: string): EntityProgress {
    const settings = this.getSettings(workspaceId);
    const through = settings.mode === 'off' ? null : this.resolveMembers(workspaceId, settings).get(entityId) ?? null;
    const progresses = Boolean(through);
    const values = this.entityValues(workspaceId, 'entity', entityId);
    const race = this.groupOf(workspaceId, entityId);
    const raceValues = race ? this.entityValues(workspaceId, race.kind, race.id) : new Map<string, number>();
    const level = Math.max(1, Math.round(values.get(LEVEL) ?? 1));
    const xp = Math.max(0, values.get(XP) ?? 0);
    const attributes = this.listTraits(workspaceId).map(trait => {
      const bonus = raceValues.get(trait.id) ?? 0;
      const base = values.get(trait.id) ?? trait.initialValue;
      return {
        traitId: trait.id, key: trait.key, name: trait.name, description: trait.description,
        base, bonus, value: clampValue(base + bonus, trait.minimum, trait.maximum),
        minimum: trait.minimum, maximum: trait.maximum,
        bonusFromId: bonus && race ? race.id : null, bonusFromName: bonus && race ? race.name : null
      };
    });
    return {
      entityId,
      mode: settings.mode,
      progresses,
      progressesThrough: through,
      player: settings.playerEntityId === entityId,
      level,
      xp,
      goal: settings.config.xp.maxLevel && level >= settings.config.xp.maxLevel ? null : xpGoal(level, settings.config.xp),
      attributes
    };
  }

  /** Race bonuses for attributes. Null clears one. */
  setRaceValue(workspaceId: string, raceId: string, traitId: string, value: number | null): void {
    const kind = this.groupKind(workspaceId, raceId);
    this.requireTrait(workspaceId, traitId);
    if (value === null || !Number.isFinite(value) || value === 0) {
      this.db.prepare(`
        DELETE FROM roleplay_progress_values WHERE workspace_id = ? AND target_type = ? AND target_id = ? AND trait_id = ?
      `).run(workspaceId, kind, raceId, traitId);
      return;
    }
    this.writeValue(workspaceId, kind, raceId, traitId, value);
  }

  /** Attribute bonuses of a race or a species. */
  listRaceValues(workspaceId: string, raceId: string): Record<string, number> {
    return Object.fromEntries(this.entityValues(workspaceId, this.groupKind(workspaceId, raceId, true), raceId));
  }

  /**
   * An edit made by the user. The number typed is the number kept: an attribute stores the base
   * that gives it, and XP never levels up on its own.
   */
  setEntityValue(workspaceId: string, entityId: string, input: { kind: 'level' | 'xp' | 'attribute'; traitId?: string; value: number }): EntityProgress {
    this.requireActor(workspaceId, entityId);
    const value = Number(input.value);
    if (!Number.isFinite(value)) throw new Error('Enter a number.');
    const before = this.getEntityProgress(workspaceId, entityId);
    this.db.transaction(() => {
      if (input.kind === 'level') {
        const next = Math.max(1, Math.round(value));
        this.writeValue(workspaceId, 'entity', entityId, LEVEL, next);
        this.recordChange({ workspaceId, entityId, kind: 'level', traitId: null, delta: next - before.level, previousValue: before.level, nextValue: next, reason: '', status: 'applied', source: 'manual' });
      } else if (input.kind === 'xp') {
        const next = Math.max(0, Math.round(value));
        this.writeValue(workspaceId, 'entity', entityId, XP, next);
        this.recordChange({ workspaceId, entityId, kind: 'xp', traitId: null, delta: next - before.xp, previousValue: before.xp, nextValue: next, reason: '', status: 'applied', source: 'manual' });
      } else {
        const attribute = before.attributes.find(item => item.traitId === input.traitId);
        if (!attribute) throw new Error('That attribute no longer exists.');
        const next = clampValue(Math.round(value), attribute.minimum, attribute.maximum);
        this.writeValue(workspaceId, 'entity', entityId, attribute.traitId, next - attribute.bonus);
        this.recordChange({ workspaceId, entityId, kind: 'attribute', traitId: attribute.traitId, delta: next - attribute.value, previousValue: attribute.value, nextValue: next, reason: '', status: 'applied', source: 'manual' });
      }
    })();
    return this.getEntityProgress(workspaceId, entityId);
  }

  /** An AI change. It follows the progression rule and its limits, and is stored as an amount. */
  proposeChange(input: ProgressChangeInput): ProgressChange | null {
    const existing = this.getChange(input.workspaceId, input.id);
    if (existing) return existing;
    const settings = this.getSettings(input.workspaceId);
    if (settings.mode === 'off' || (input.kind !== 'xp' && input.kind !== 'attribute')) return null;
    if (!this.progressingIds(input.workspaceId).includes(input.entityId)) return null;
    if (input.source === 'ai' && settings.config.policy === 'manual') return null;
    let delta = Number(input.delta);
    if (!Number.isFinite(delta) || delta === 0) return null;
    let traitId: string | null = null;
    if (input.kind === 'xp') {
      if (delta < 0 && settings.config.xp.aiOnlyAdds) return null;
      delta = Math.round(delta);
    } else {
      if (delta > 0 && !settings.config.attributes.aiRaises) return null;
      if (delta < 0 && !settings.config.attributes.aiLowers) return null;
      delta = delta > 0 ? 1 : -1;
      traitId = this.requireTrait(input.workspaceId, String(input.traitId)).id;
    }
    const before = this.currentValue(input.workspaceId, input.entityId, input.kind, traitId);
    const status = input.source === 'ai' && settings.config.policy === 'review' ? 'pending' : 'applied';
    this.db.transaction(() => {
      this.recordChange({
        id: input.id, workspaceId: input.workspaceId, entityId: input.entityId, kind: input.kind, traitId,
        delta, previousValue: before, nextValue: before + delta, reason: input.reason || '',
        status, source: input.source, provenanceId: input.provenanceId ?? null
      });
      if (status === 'applied') this.applyChange(input.workspaceId, input.id);
    })();
    return this.getChange(input.workspaceId, input.id) ?? null;
  }

  resolveChange(workspaceId: string, changeId: string, decision: 'approved' | 'rejected'): ProgressChange {
    const change = this.getChange(workspaceId, changeId);
    if (!change) throw new Error('This change no longer exists.');
    if (change.status !== 'pending') return change;
    this.db.transaction(() => {
      if (decision === 'approved') this.applyChange(workspaceId, changeId);
      else this.db.prepare(`
        UPDATE roleplay_progress_changes SET status = 'rejected', resolved_at = ? WHERE workspace_id = ? AND change_id = ?
      `).run(Date.now(), workspaceId, changeId);
    })();
    return this.getChange(workspaceId, changeId)!;
  }

  listChanges(workspaceId: string, entityId?: string): ProgressChange[] {
    return (this.db.prepare(`
      SELECT * FROM roleplay_progress_changes WHERE workspace_id = ?${entityId ? ' AND entity_id = ?' : ''}
      ORDER BY created_at, change_id
    `).all(...(entityId ? [workspaceId, entityId] : [workspaceId])) as Array<Record<string, unknown>>).map(hydrateChange);
  }

  /** Everything that changed one character's numbers, newest first, with the turn it came from. */
  listHistory(workspaceId: string, entityId: string, limit = 60): HistoryEntry[] {
    const turns = this.turnNumbers(workspaceId);
    const definitions = new Map(this.roleplay.listDefinitions(workspaceId).map(item => [item.id, item.name]));
    const traits = new Map(this.listTraits(workspaceId).map(item => [item.id, item.name]));
    const resources: HistoryEntry[] = this.roleplay.listChanges(workspaceId, entityId).map(change => ({
      id: change.id,
      area: 'resource',
      kind: 'resource',
      label: definitions.get(change.definitionId) || 'Resource',
      refId: change.definitionId,
      delta: change.delta,
      previousValue: change.previousValue,
      nextValue: change.nextValue,
      maximumDelta: change.maximumDelta,
      reason: change.reason,
      status: change.status,
      source: change.source,
      turnNumber: change.provenanceId ? turns.get(change.provenanceId) ?? null : null,
      createdAt: change.createdAt
    }));
    const progress: HistoryEntry[] = this.listChanges(workspaceId, entityId).map(change => ({
      id: change.id,
      area: 'progress',
      kind: change.kind,
      label: change.kind === 'xp' ? 'XP' : change.kind === 'level' ? 'Level' : traits.get(change.traitId || '') || 'Attribute',
      refId: change.traitId,
      delta: change.delta,
      previousValue: change.previousValue,
      nextValue: change.nextValue,
      maximumDelta: 0,
      reason: change.reason,
      status: change.status,
      source: change.source,
      turnNumber: change.provenanceId ? turns.get(change.provenanceId) ?? null : null,
      createdAt: change.createdAt
    }));
    // A replaced or deleted reply was undone, so what it changed is no longer part of the story.
    const undone = new Set((this.db.prepare(`
      SELECT origin_id FROM narrative_origin_lifecycle WHERE workspace_id = ? AND status != 'active'
    `).all(workspaceId) as Array<{ origin_id: string }>).map(row => row.origin_id));
    const provenance = new Map([
      ...this.roleplay.listChanges(workspaceId, entityId).map(change => [change.id, change.provenanceId] as const),
      ...this.listChanges(workspaceId, entityId).map(change => [change.id, change.provenanceId] as const)
    ]);
    return [...resources, ...progress]
      .filter(entry => !undone.has(provenance.get(entry.id) || ''))
      .filter(entry => entry.delta !== 0 || entry.maximumDelta !== 0 || entry.kind === 'level')
      .sort((left, right) => right.createdAt - left.createdAt)
      .slice(0, limit);
  }

  private applyChange(workspaceId: string, changeId: string): void {
    const change = this.getChange(workspaceId, changeId)!;
    const settings = this.getSettings(workspaceId);
    const before = this.currentValue(workspaceId, change.entityId, change.kind, change.traitId);
    let next = before + change.delta;
    if (change.kind === 'xp') {
      this.writeValue(workspaceId, 'entity', change.entityId, XP, next);
      this.levelUp(workspaceId, change.entityId, change.provenanceId, settings.config);
      next = before + change.delta;
    } else if (change.kind === 'attribute') {
      const progress = this.getEntityProgress(workspaceId, change.entityId);
      const attribute = progress.attributes.find(item => item.traitId === change.traitId);
      if (!attribute) throw new Error('That attribute no longer exists.');
      next = clampValue(attribute.value + change.delta, attribute.minimum, attribute.maximum);
      this.writeValue(workspaceId, 'entity', change.entityId, attribute.traitId, next - attribute.bonus);
    }
    this.db.prepare(`
      UPDATE roleplay_progress_changes SET status = 'applied', previous_value = ?, next_value = ?, resolved_at = ?
      WHERE workspace_id = ? AND change_id = ?
    `).run(before, next, Date.now(), workspaceId, changeId);
  }

  // Extra XP carries into the next level, and each level hands out its resource rewards.
  private levelUp(workspaceId: string, entityId: string, provenanceId: string | null, config: ProgressionConfig): void {
    const values = this.entityValues(workspaceId, 'entity', entityId);
    let level = Math.max(1, Math.round(values.get(LEVEL) ?? 1));
    let xp = values.get(XP) ?? 0;
    let goal = xpGoal(level, config.xp);
    while (xp >= goal && (!config.xp.maxLevel || level < config.xp.maxLevel)) {
      xp -= goal;
      level += 1;
      goal = xpGoal(level, config.xp);
      this.writeValue(workspaceId, 'entity', entityId, LEVEL, level);
      this.writeValue(workspaceId, 'entity', entityId, XP, xp);
      const rewards = this.giveRewards(workspaceId, entityId, provenanceId, level, config.rewards);
      this.recordChange({
        workspaceId, entityId, kind: 'level', traitId: null, delta: 1, previousValue: level - 1, nextValue: level,
        reason: rewards, status: 'applied', source: 'level', provenanceId
      });
    }
  }

  private giveRewards(workspaceId: string, entityId: string, provenanceId: string | null, level: number, rewards: LevelReward[]): string {
    const resources = this.roleplay.listEntityResources(workspaceId, entityId);
    const given: string[] = [];
    rewards.forEach((reward, index) => {
      const state = resources.find(item => item.definitionId === reward.definitionId);
      if (!state) return;
      const increase = Math.max(0, Number(reward.maximumIncrease) || 0);
      if (!increase && !reward.refill) return;
      const maximum = state.maximum + increase;
      this.roleplay.proposeChange({
        id: `${provenanceId || randomUUID()}:level:${level}:${index}:${entityId}`,
        workspaceId, definitionId: state.definitionId, entityId,
        ...(reward.refill ? { value: maximum } : { delta: 0 }),
        maximumDelta: increase,
        reason: `Level ${level}`,
        source: 'level', provenanceId: provenanceId ?? undefined
      });
      given.push([
        increase ? `${state.name} highest +${increase}` : '',
        reward.refill ? `${state.name} refilled` : ''
      ].filter(Boolean).join(', '));
    });
    return given.join(', ');
  }

  private currentValue(workspaceId: string, entityId: string, kind: ProgressKind, traitId: string | null): number {
    const progress = this.getEntityProgress(workspaceId, entityId);
    if (kind === 'xp') return progress.xp;
    if (kind === 'level') return progress.level;
    return progress.attributes.find(item => item.traitId === traitId)?.value ?? 0;
  }

  private recordChange(change: Omit<ProgressChange, 'id' | 'createdAt' | 'resolvedAt' | 'provenanceId'> & { id?: string; provenanceId?: string | null }): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO roleplay_progress_changes (
        workspace_id, change_id, entity_id, kind, trait_id, delta, previous_value, next_value,
        reason, status, source, provenance_id, created_at, resolved_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(change.workspaceId, change.id || randomUUID(), change.entityId, change.kind, change.traitId, change.delta,
      change.previousValue, change.nextValue, String(change.reason || '').trim().slice(0, 240), change.status, change.source,
      change.provenanceId ?? null, now, change.status === 'applied' ? now : null);
  }

  private writeValue(workspaceId: string, targetType: ValueTarget, targetId: string, traitId: string, value: number): void {
    this.db.prepare(`
      INSERT INTO roleplay_progress_values (workspace_id, target_type, target_id, trait_id, value, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, target_type, target_id, trait_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
    `).run(workspaceId, targetType, targetId, traitId, value, Date.now());
  }

  private entityValues(workspaceId: string, targetType: ValueTarget, targetId: string): Map<string, number> {
    return new Map((this.db.prepare(`
      SELECT trait_id, value FROM roleplay_progress_values WHERE workspace_id = ? AND target_type = ? AND target_id = ?
    `).all(workspaceId, targetType, targetId) as Array<{ trait_id: string; value: number }>).map(row => [row.trait_id, Number(row.value)]));
  }

  // A character's race or a specific being's species: one link, told apart by the target's type.
  private groupOf(workspaceId: string, entityId: string): { id: string; name: string; kind: 'race' | 'species' } | null {
    const row = this.db.prepare(`
      SELECT groups.id, groups.canonicalName AS name, groups.type FROM entity_links AS links
      JOIN entities AS groups ON groups.id = links.toId AND groups.workspaceId = links.workspaceId
      WHERE links.workspaceId = ? AND links.fromId = ? AND links.relType = 'is_race' AND groups.status != 'proposed'
      LIMIT 1
    `).get(workspaceId, entityId) as { id: string; name: string; type: string } | undefined;
    return row ? { id: row.id, name: row.name, kind: row.type === 'Races' ? 'race' : 'species' } : null;
  }

  // Reading allows an imported race still waiting for review; writing needs a confirmed one.
  private groupKind(workspaceId: string, groupId: string, allowProposed = false): 'race' | 'species' {
    const row = this.db.prepare(`
      SELECT type, data, status FROM entities WHERE workspaceId = ? AND id = ?
    `).get(workspaceId, groupId) as { type: string; data: string | null; status: string } | undefined;
    if (row?.status === 'proposed' && !allowProposed) throw new Error('Choose a race or a species.');
    if (row?.type === 'Races') return 'race';
    if (row?.type === 'Creatures' && parseObject(row.data).scope === 'group') return 'species';
    throw new Error('Choose a race or a species.');
  }

  private turnNumbers(workspaceId: string): Map<string, number> {
    const exists = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'roleplay_message_frames'").get();
    if (!exists) return new Map();
    const rows = this.db.prepare(`
      SELECT origin_id FROM roleplay_message_frames WHERE workspace_id = ? ORDER BY created_at, origin_id
    `).all(workspaceId) as Array<{ origin_id: string }>;
    return new Map(rows.map((row, index) => [row.origin_id, index + 1]));
  }

  private getChange(workspaceId: string, changeId: string): ProgressChange | undefined {
    const row = this.db.prepare('SELECT * FROM roleplay_progress_changes WHERE workspace_id = ? AND change_id = ?')
      .get(workspaceId, changeId) as Record<string, unknown> | undefined;
    return row ? hydrateChange(row) : undefined;
  }

  private requireTrait(workspaceId: string, traitId: string): TraitDefinition {
    const row = this.db.prepare('SELECT * FROM roleplay_trait_definitions WHERE workspace_id = ? AND trait_id = ?')
      .get(workspaceId, traitId) as Record<string, unknown> | undefined;
    if (!row) throw new Error('That attribute no longer exists.');
    return hydrateTrait(row);
  }

  private requireMemberTarget(workspaceId: string, member: ProgressionMember): void {
    if (member.targetType === 'everyone' || member.targetType === 'type') return;
    if (member.targetType === 'entity') return this.requireActor(workspaceId, member.targetId);
    if (member.targetType === 'race') return this.requireEntityOfType(workspaceId, member.targetId, ['Races']);
    if (this.groupKind(workspaceId, member.targetId) !== 'species') throw new Error('Choose a species.');
  }

  private requireActor(workspaceId: string, entityId: string): void {
    this.requireEntityOfType(workspaceId, entityId, ['Characters', 'Creatures']);
  }

  private requireEntityOfType(workspaceId: string, entityId: string, types: string[]): void {
    const row = this.db.prepare(`
      SELECT type FROM entities WHERE workspaceId = ? AND id = ? AND status != 'proposed'
    `).get(workspaceId, entityId) as { type: string } | undefined;
    if (!row || !types.includes(row.type)) throw new Error('Confirmed workspace entity was not found.');
  }
}

/** XP needed to go from `level` to the next one. */
export function xpGoal(level: number, rule: ProgressionConfig['xp']): number {
  return growGoal(rule.firstGoal, rule.growth, rule.growthAmount, Math.max(0, level - 1));
}

function growGoal(first: number, growth: GoalGrowth, amount: number, steps: number): number {
  const base = Math.max(1, first);
  if (growth === 'add') return Math.max(1, Math.round(base + amount * steps));
  if (growth === 'multiply') return Math.max(1, Math.round(base * Math.pow(Math.max(1, amount), steps)));
  return base;
}

const MEMBER_TARGETS: MemberTarget[] = ['everyone', 'entity', 'race', 'species', 'type'];

// Everyone covers every other line, but they are kept so turning it off brings the list back.
function normalizeMembers(input: unknown): ProgressionMember[] {
  const seen = new Set<string>();
  return (Array.isArray(input) ? input : []).flatMap(item => {
    const targetType = MEMBER_TARGETS.includes(item?.targetType) ? item.targetType as MemberTarget : null;
    const targetId = targetType === 'everyone' ? '' : String(item?.targetId || '');
    if (!targetType || (targetType !== 'everyone' && !targetId)) return [];
    if (targetType === 'type' && targetId !== 'Characters' && targetId !== 'Creatures') return [];
    const key = `${targetType}:${targetId}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [{ targetType, targetId }];
  });
}

function normalizeMode(value: unknown): ProgressionMode {
  return value === 'levels' ? value : 'off';
}

function normalizeGrowth(value: unknown): GoalGrowth {
  return value === 'add' || value === 'multiply' ? value : 'same';
}

function normalizeConfig(input: Record<string, any>): ProgressionConfig {
  const xp = { ...DEFAULT_CONFIG.xp, ...(input.xp || {}) };
  const attributes = { ...DEFAULT_CONFIG.attributes, ...(input.attributes || {}) };
  const maxLevel = Number(xp.maxLevel);
  return {
    policy: input.policy === 'manual' || input.policy === 'automatic' ? input.policy : 'review',
    xp: {
      firstGoal: Math.max(1, Math.round(Number(xp.firstGoal) || DEFAULT_CONFIG.xp.firstGoal)),
      growth: normalizeGrowth(xp.growth),
      growthAmount: Math.max(0, Number(xp.growthAmount) || 0),
      maxLevel: Number.isFinite(maxLevel) && maxLevel > 1 ? Math.round(maxLevel) : null,
      guidance: String(xp.guidance || ''),
      aiOnlyAdds: xp.aiOnlyAdds !== false
    },
    attributes: { aiRaises: attributes.aiRaises !== false, aiLowers: attributes.aiLowers === true, guidance: String(attributes.guidance || '') },
    rewards: (Array.isArray(input.rewards) ? input.rewards : [])
      .filter((reward: any) => reward && typeof reward.definitionId === 'string')
      .map((reward: any) => ({
        definitionId: reward.definitionId,
        maximumIncrease: Math.max(0, Number(reward.maximumIncrease) || 0),
        refill: reward.refill === true
      }))
  };
}

function hydrateTrait(row: Record<string, unknown>): TraitDefinition {
  return {
    id: String(row.trait_id), workspaceId: String(row.workspace_id),
    key: String(row.trait_key),
    name: String(row.name), description: String(row.description ?? ''),
    initialValue: Number(row.initial_value), minimum: Number(row.minimum), maximum: Number(row.maximum),
    position: Number(row.position)
  };
}

function hydrateChange(row: Record<string, unknown>): ProgressChange {
  return {
    id: String(row.change_id), workspaceId: String(row.workspace_id), entityId: String(row.entity_id),
    kind: String(row.kind) as ProgressKind, traitId: row.trait_id ? String(row.trait_id) : null,
    delta: Number(row.delta), previousValue: Number(row.previous_value), nextValue: Number(row.next_value),
    reason: String(row.reason ?? ''), status: String(row.status) as ProgressChange['status'],
    source: String(row.source) as ProgressSource, provenanceId: row.provenance_id ? String(row.provenance_id) : null,
    createdAt: Number(row.created_at), resolvedAt: row.resolved_at === null ? null : Number(row.resolved_at)
  };
}

function clampValue(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function parseObject(value: unknown): Record<string, any> {
  try {
    const parsed = JSON.parse(String(value || '{}')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, any> : {};
  } catch {
    return {};
  }
}
