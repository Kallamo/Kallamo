import type Database from 'better-sqlite3';
import { RoleplaySystem, type RoleplayResourceDefinition } from './roleplay-system';
import { RoleplayProgression, type MemberTarget, type ProgressionConfig, type ProgressionMember, type ProgressionMode, type TraitDefinition } from './roleplay-progression';
import { RoleplaySkills, normalizeSkillConfig, type SkillConfig } from './roleplay-skills';

/**
 * A world's roleplay rules as they travel in a Worldbuild package. Resources and traits are
 * named by key and entities by their package ref, so nothing depends on this database's ids.
 */
export interface RoleplayRulesPackage {
  version: 1;
  resources: Array<Omit<RoleplayResourceDefinition, 'id' | 'workspaceId'>>;
  resourceValues: Array<{ resourceKey: string; targetType: 'entity' | 'race' | 'species'; targetRef: string; current: number | null; adjustment: number; base: number | null; growth: number | null }>;
  progression: { mode: ProgressionMode; config: ProgressionConfig; members: Array<{ targetType: MemberTarget; targetRef: string }> };
  traits: Array<Omit<TraitDefinition, 'id' | 'workspaceId'>>;
  progressValues: Array<{ targetType: 'entity' | 'race' | 'species'; targetRef: string; traitKey: string; value: number }>;
  /** Absent in packages made before skills existed. */
  skills?: {
    enabled: boolean;
    config: SkillConfig;
    members: Array<{ targetType: MemberTarget; targetRef: string }>;
    catalog: Array<{ key: string; name: string; description: string; parentKey: string | null; position: number }>;
    values: Array<{ targetRef: string; skillKey: string; rank: number }>;
  };
  timeMatrix?: unknown;
  currentValues: boolean;
}

export type RulesImportMode = 'merge' | 'replace' | 'skip';

export interface RulesDifference {
  localRules: boolean;
  differs: boolean;
  resources: { same: string[]; changed: string[]; added: string[] };
  progression: 'same' | 'different' | 'added' | 'none';
  skills: 'same' | 'different' | 'added' | 'none';
  localSkills: number;
  packageSkills: number;
  timeCosts: 'same' | 'different' | 'none';
  packageProgressionMode: ProgressionMode;
  localProgressionMode: ProgressionMode;
  localResources: string[];
  packageResources: string[];
  localAttributes: number;
  packageAttributes: number;
}

const LEVEL = '__level';
const XP = '__xp';
const RESOURCE_FIELDS = [
  'name', 'description', 'color', 'minimum', 'maximum', 'startsFull', 'growthPerLevel', 'refillOnLevelUp', 'aiChangesMaximum',
  'maximumRule', 'unit', 'appliesTo', 'updatePolicy', 'scope', 'lowestEffect', 'timeRate', 'timeDirection', 'timePeriod'
] as const;

const MEMBER_TARGETS: MemberTarget[] = ['everyone', 'entity', 'race', 'species', 'type'];

export class RoleplayRulesPackager {
  private readonly roleplay: RoleplaySystem;
  private readonly progression: RoleplayProgression;
  private readonly skills: RoleplaySkills;

  constructor(private readonly db: Database.Database) {
    this.roleplay = new RoleplaySystem(db);
    this.progression = new RoleplayProgression(db);
    this.skills = new RoleplaySkills(db);
  }

  hasRules(workspaceId: string): boolean {
    return this.roleplay.listDefinitions(workspaceId).length > 0
      || this.progression.getSettings(workspaceId).mode !== 'off'
      || this.progression.listTraits(workspaceId).length > 0
      || this.hasSkills(workspaceId);
  }

  summary(workspaceId: string) {
    const settings = this.progression.getSettings(workspaceId);
    return {
      resources: this.roleplay.listDefinitions(workspaceId).length,
      progressionMode: settings.mode,
      attributes: this.progression.listTraits(workspaceId).length,
      skills: this.skills.getSettings(workspaceId).enabled ? this.confirmedSkills(workspaceId).length : 0
    };
  }

  private hasSkills(workspaceId: string): boolean {
    return this.skills.getSettings(workspaceId).enabled || this.confirmedSkills(workspaceId).length > 0;
  }

  private confirmedSkills(workspaceId: string) {
    return this.skills.listSkills(workspaceId).filter(skill => skill.status === 'confirmed');
  }

  /**
   * Race and species values always go: they are part of the world, and so is a character's
   * adjustment. The current value is play state, so it travels only with `currentValues`.
   */
  export(workspaceId: string, entityIds: Set<string>, currentValues: boolean, timeMatrix?: unknown): RoleplayRulesPackage {
    const definitions = this.roleplay.listDefinitions(workspaceId);
    const settings = this.progression.getSettings(workspaceId);
    const traits = this.progression.listTraits(workspaceId);
    const traitKeyById = new Map(traits.map(trait => [trait.id, trait.key]));
    const resourceValues = this.roleplay.listAssignments(workspaceId).flatMap(assignment => {
      const definition = definitions.find(item => item.id === assignment.definitionId);
      if (!definition || !entityIds.has(assignment.targetId)) return [];
      const current = assignment.targetType === 'entity' && currentValues ? assignment.current : null;
      // Under "everyone" a row holding only a value left behind says nothing about the character.
      if (assignment.targetType === 'entity' && definition.scope !== 'chosen' && current === null && !assignment.adjustment) return [];
      return [{
        resourceKey: definition.key, targetType: assignment.targetType, targetRef: assignment.targetId,
        current, adjustment: assignment.adjustment, base: assignment.base, growth: assignment.growth
      }];
    });
    const progressRows = this.db.prepare(`
      SELECT target_type, target_id, trait_id, value FROM roleplay_progress_values WHERE workspace_id = ?
    `).all(workspaceId) as Array<{ target_type: 'entity' | 'race' | 'species'; target_id: string; trait_id: string; value: number }>;
    const progressValues = progressRows.flatMap(row => {
      if (!entityIds.has(row.target_id)) return [];
      if (row.target_type === 'entity' && !currentValues) return [];
      const traitKey = row.trait_id === LEVEL || row.trait_id === XP ? row.trait_id : traitKeyById.get(row.trait_id);
      return traitKey ? [{ targetType: row.target_type, targetRef: row.target_id, traitKey, value: Number(row.value) }] : [];
    });
    return {
      version: 1,
      resources: definitions.map(({ id: _id, workspaceId: _workspace, ...definition }) => definition),
      resourceValues,
      progression: {
        mode: settings.mode,
        config: settings.config,
        // Lines about a character, race or species go only with that entity.
        members: settings.members
          .filter(member => member.targetType === 'everyone' || member.targetType === 'type' || entityIds.has(member.targetId))
          .map(member => ({ targetType: member.targetType, targetRef: member.targetId }))
      },
      traits: traits.map(({ id: _id, workspaceId: _workspace, ...trait }) => trait),
      progressValues,
      skills: this.exportSkills(workspaceId, entityIds),
      timeMatrix,
      currentValues
    };
  }

  // A character's skills are part of who they are, so they travel with the character, like race values.
  private exportSkills(workspaceId: string, entityIds: Set<string>): NonNullable<RoleplayRulesPackage['skills']> {
    const settings = this.skills.getSettings(workspaceId);
    const catalog = this.confirmedSkills(workspaceId);
    const keyById = new Map(catalog.map(skill => [skill.id, skill.key]));
    const rows = this.db.prepare('SELECT entity_id, skill_id, rank FROM roleplay_skill_values WHERE workspace_id = ?')
      .all(workspaceId) as Array<{ entity_id: string; skill_id: string; rank: number }>;
    return {
      enabled: settings.enabled,
      config: settings.config,
      members: settings.members
        .filter(member => member.targetType === 'everyone' || member.targetType === 'type' || entityIds.has(member.targetId))
        .map(member => ({ targetType: member.targetType, targetRef: member.targetId })),
      catalog: catalog.map(skill => ({
        key: skill.key, name: skill.name, description: skill.description,
        parentKey: skill.parentId ? keyById.get(skill.parentId) ?? null : null, position: skill.position
      })),
      values: rows.flatMap(row => {
        const skillKey = keyById.get(row.skill_id);
        return skillKey && entityIds.has(row.entity_id) ? [{ targetRef: row.entity_id, skillKey, rank: Number(row.rank) }] : [];
      })
    };
  }

  difference(workspaceId: string, rules: RoleplayRulesPackage, localTimeMatrix?: unknown): RulesDifference {
    const local = new Map(this.roleplay.listDefinitions(workspaceId).map(definition => [definition.key, definition]));
    const resources = { same: [] as string[], changed: [] as string[], added: [] as string[] };
    for (const incoming of rules.resources || []) {
      const mine = local.get(incoming.key);
      if (!mine) resources.added.push(incoming.name);
      else if (RESOURCE_FIELDS.every(field => JSON.stringify(mine[field]) === JSON.stringify(incoming[field]))) resources.same.push(incoming.name);
      else resources.changed.push(incoming.name);
    }
    const settings = this.progression.getSettings(workspaceId);
    const localTraits = this.progression.listTraits(workspaceId).map(trait => trait.key).sort().join('|');
    const incomingTraits = (rules.traits || []).map(trait => trait.key).sort().join('|');
    const incomingMode = rules.progression?.mode || 'off';
    const progression = incomingMode === 'off' && !incomingTraits
      ? 'none'
      : settings.mode === 'off' && !localTraits
        ? 'added'
        : settings.mode === incomingMode && localTraits === incomingTraits ? 'same' : 'different';
    const timeCosts = rules.timeMatrix === undefined
      ? 'none'
      : JSON.stringify(localTimeMatrix) === JSON.stringify(rules.timeMatrix) ? 'same' : 'different';
    const localSkillSettings = this.skills.getSettings(workspaceId);
    const localSkillKeys = this.confirmedSkills(workspaceId).map(skill => skill.key).sort().join('|');
    const incomingSkillKeys = (rules.skills?.catalog || []).map(skill => skill.key).sort().join('|');
    const incomingSkillsOn = Boolean(rules.skills?.enabled);
    const skills = !incomingSkillsOn && !incomingSkillKeys
      ? 'none'
      : !this.hasSkills(workspaceId)
        ? 'added'
        : localSkillSettings.enabled === incomingSkillsOn && localSkillKeys === incomingSkillKeys ? 'same' : 'different';
    const localRules = this.hasRules(workspaceId);
    return {
      localRules,
      differs: localRules && (resources.changed.length > 0 || resources.added.length > 0 || progression === 'different' || skills === 'different' || timeCosts === 'different'),
      resources,
      progression,
      skills,
      localSkills: localSkillSettings.enabled ? this.confirmedSkills(workspaceId).length : 0,
      packageSkills: incomingSkillsOn ? (rules.skills?.catalog || []).length : 0,
      timeCosts,
      packageProgressionMode: incomingMode,
      localProgressionMode: settings.mode,
      localResources: [...local.values()].map(definition => definition.name),
      packageResources: (rules.resources || []).map(resource => resource.name),
      localAttributes: this.progression.listTraits(workspaceId).length,
      packageAttributes: (rules.traits || []).length
    };
  }

  /**
   * Values for imported entities are written at once; a dismissed entity takes them with it
   * through the entity reference registry.
   */
  import(workspaceId: string, rules: RoleplayRulesPackage, mode: RulesImportMode, idMap: Map<string, string>): { timeMatrix: boolean } {
    if (mode === 'skip' || !rules || rules.version !== 1) return { timeMatrix: false };
    const localRules = this.hasRules(workspaceId);
    const replace = mode === 'replace' || !localRules;
    this.db.transaction(() => {
      const incomingKeys = new Set((rules.resources || []).map(resource => resource.key));
      const local = new Map(this.roleplay.listDefinitions(workspaceId).map(definition => [definition.key, definition]));
      for (const resource of rules.resources || []) {
        const mine = local.get(resource.key);
        if (mine && !replace) continue;
        this.roleplay.saveDefinition(workspaceId, { ...resource, id: mine?.id });
      }
      if (replace) {
        for (const [key, definition] of local) if (!incomingKeys.has(key)) this.roleplay.deleteDefinition(workspaceId, definition.id);
      }
      const definitionByKey = new Map(this.roleplay.listDefinitions(workspaceId).map(definition => [definition.key, definition]));
      const insertResource = this.db.prepare(`
        INSERT OR IGNORE INTO roleplay_resource_values (
          workspace_id, definition_id, target_type, target_id, current_value, adjustment, base_value, growth_value, version, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `);
      const numberOrNull = (value: unknown) => value === null || value === undefined || !Number.isFinite(Number(value)) ? null : Number(value);
      for (const value of rules.resourceValues || []) {
        const definition = definitionByKey.get(value.resourceKey);
        const targetId = idMap.get(value.targetRef);
        if (!definition || !targetId || !['entity', 'race', 'species'].includes(value.targetType)) continue;
        const entity = value.targetType === 'entity';
        const base = entity ? null : numberOrNull(value.base);
        // Values are written straight away, so a stored current above the new maximum is corrected on read.
        insertResource.run(workspaceId, definition.id, value.targetType, targetId,
          entity ? numberOrNull(value.current) : null, entity ? Number(value.adjustment) || 0 : 0,
          base !== null && base > definition.minimum ? base : null, entity ? null : numberOrNull(value.growth), Date.now());
      }

      const settings = this.progression.getSettings(workspaceId);
      const adopt = replace || (settings.mode === 'off' && !this.progression.listTraits(workspaceId).length);
      if (adopt && rules.progression) {
        const incomingTraits = new Set((rules.traits || []).map(trait => trait.key));
        const localTraits = this.progression.listTraits(workspaceId);
        for (const trait of rules.traits || []) {
          const mine = localTraits.find(item => item.key === trait.key);
          this.progression.saveTrait(workspaceId, { ...trait, id: mine?.id });
        }
        for (const trait of localTraits) if (!incomingTraits.has(trait.key)) this.progression.deleteTrait(workspaceId, trait.id);
        this.db.prepare(`
          INSERT INTO roleplay_progression_settings (workspace_id, mode, config_json, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(workspace_id) DO UPDATE SET mode = excluded.mode, config_json = excluded.config_json, updated_at = excluded.updated_at
        `).run(workspaceId, rules.progression.mode === 'levels' ? 'levels' : 'off', JSON.stringify(rules.progression.config || {}), Date.now());
      }
      if (adopt || settings.mode === rules.progression?.mode) {
        const incoming = (rules.progression?.members || []).flatMap((member): ProgressionMember[] => {
          if (!MEMBER_TARGETS.includes(member?.targetType) || (member.targetType === 'type' && !['Characters', 'Creatures'].includes(member.targetRef))) return [];
          if (member.targetType === 'everyone' || member.targetType === 'type') return [{ targetType: member.targetType, targetId: member.targetType === 'everyone' ? '' : member.targetRef }];
          const targetId = idMap.get(member.targetRef);
          return targetId ? [{ targetType: member.targetType, targetId }] : [];
        });
        // Proposed entities cannot pass setMembers yet, so lines are written directly, like their values.
        const insertMember = this.db.prepare('INSERT OR IGNORE INTO roleplay_progression_members (workspace_id, target_type, target_id, added_at) VALUES (?, ?, ?, ?)');
        incoming.forEach((member, index) => insertMember.run(workspaceId, member.targetType, member.targetId, Date.now() + index));
      }
      const traitByKey = new Map(this.progression.listTraits(workspaceId).map(trait => [trait.key, trait.id]));
      const insertProgress = this.db.prepare(`
        INSERT OR IGNORE INTO roleplay_progress_values (workspace_id, target_type, target_id, trait_id, value, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      for (const value of rules.progressValues || []) {
        const targetId = idMap.get(value.targetRef);
        const traitId = value.traitKey === LEVEL || value.traitKey === XP ? value.traitKey : traitByKey.get(value.traitKey);
        if (!targetId || !traitId || !Number.isFinite(Number(value.value)) || !['entity', 'race', 'species'].includes(value.targetType)) continue;
        insertProgress.run(workspaceId, value.targetType, targetId, traitId, Number(value.value), Date.now());
      }
      if (rules.skills) this.importSkills(workspaceId, rules.skills, replace, idMap);
    })();
    return { timeMatrix: replace && rules.timeMatrix !== undefined };
  }

  // Skills follow progression: a world without skills of its own takes the package's even on merge.
  private importSkills(workspaceId: string, incoming: NonNullable<RoleplayRulesPackage['skills']>, replace: boolean, idMap: Map<string, string>): void {
    const adopt = replace || !this.hasSkills(workspaceId);
    if (adopt) {
      const local = this.skills.listSkills(workspaceId);
      const incomingKeys = new Set((incoming.catalog || []).map(skill => skill.key));
      // Parents first, so every sub-skill finds the parent it names.
      const ordered = [...(incoming.catalog || [])].sort((left, right) => Number(Boolean(left.parentKey)) - Number(Boolean(right.parentKey)));
      for (const skill of ordered) {
        if (!skill?.key || !skill.name) continue;
        const mine = local.find(item => item.key === skill.key);
        const parent = skill.parentKey ? this.skills.listSkills(workspaceId).find(item => item.key === skill.parentKey && !item.parentId) : undefined;
        this.skills.saveSkill(workspaceId, {
          id: mine?.id, key: skill.key, name: skill.name, description: skill.description || '',
          parentId: parent?.id ?? null, position: Number(skill.position) || 0
        });
      }
      if (replace) for (const skill of local) if (!incomingKeys.has(skill.key)) this.skills.deleteSkill(workspaceId, skill.id);
      this.db.prepare(`
        INSERT INTO roleplay_skill_settings (workspace_id, enabled, config_json, updated_at) VALUES (?, ?, ?, ?)
        ON CONFLICT(workspace_id) DO UPDATE SET enabled = excluded.enabled, config_json = excluded.config_json, updated_at = excluded.updated_at
      `).run(workspaceId, incoming.enabled ? 1 : 0, JSON.stringify(normalizeSkillConfig(incoming.config || {})), Date.now());
      const insertMember = this.db.prepare('INSERT OR IGNORE INTO roleplay_skill_members (workspace_id, target_type, target_id, added_at) VALUES (?, ?, ?, ?)');
      (incoming.members || []).forEach((member, index) => {
        if (!MEMBER_TARGETS.includes(member?.targetType)) return;
        if (member.targetType === 'type' && !['Characters', 'Creatures'].includes(member.targetRef)) return;
        const targetId = member.targetType === 'everyone' ? '' : member.targetType === 'type' ? member.targetRef : idMap.get(member.targetRef);
        if (targetId === undefined) return;
        insertMember.run(workspaceId, member.targetType, targetId, Date.now() + index);
      });
    }
    const skillByKey = new Map(this.confirmedSkills(workspaceId).map(skill => [skill.key, skill.id]));
    const ranks = this.skills.getSettings(workspaceId).config.ranks;
    const insertValue = this.db.prepare(`
      INSERT OR IGNORE INTO roleplay_skill_values (workspace_id, entity_id, skill_id, rank, updated_at) VALUES (?, ?, ?, ?, ?)
    `);
    for (const value of incoming.values || []) {
      const entityId = idMap.get(value.targetRef);
      const skillId = skillByKey.get(value.skillKey);
      if (!entityId || !skillId) continue;
      const rank = Math.max(0, Math.min(ranks.length - 1, Math.round(Number(value.rank) || 0)));
      insertValue.run(workspaceId, entityId, skillId, rank, Date.now());
    }
  }
}

