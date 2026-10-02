import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { Scene } from '../../../narrative/contracts';
import { NarrativeSceneRepository } from '../../../narrative/scenes';

export type RoleplayUpdatePolicy = 'manual' | 'review' | 'automatic';
export type RoleplayTargetType = 'entity' | 'race' | 'species';
export type RoleplayResourceScope = 'everyone' | 'chosen';
export type RoleplayChangeSource = 'manual' | 'ai' | 'time' | 'level';

export interface RoleplaySettings {
  workspaceId: string;
  playerEntityId: string | null;
  locationEntityId: string | null;
  activeSceneId: string | null;
  scenarioName: string;
  scenarioSummary: string;
  defaultUpdatePolicy: RoleplayUpdatePolicy;
}

export interface RoleplayResourceDefinition {
  id: string;
  workspaceId: string;
  key: string;
  name: string;
  description: string;
  color: string;
  minimum: number;
  maximum: number;
  initialValue: number;
  unit: string;
  appliesTo: string[];
  updatePolicy: RoleplayUpdatePolicy;
  position: number;
  enabled: boolean;
  scope: RoleplayResourceScope;
  lowestEffect: string;
  timeRate: number;
  timeDirection: 'recovers' | 'drains';
  timePeriod: 'hour' | 'day';
}

export interface EntityResourceState extends RoleplayResourceDefinition {
  definitionId: string;
  current: number;
  maximum: number;
  inheritedFrom: string | null;
  inheritedFromType: RoleplayTargetType | 'default';
}

export interface RoleplaySceneState {
  id: string;
  locationId: string | null;
  participantIds: string[];
  possibleObserverIds: string[];
  nearbyIds: string[];
  objectIds: string[];
  perspective: Scene['perspective'];
  position: Scene['position'];
}

export interface RoleplayScenePatch {
  locationId?: string | null;
  participantIds?: string[];
  possibleObserverIds?: string[];
  nearbyIds?: string[];
  objectIds?: string[];
}

export interface RoleplaySceneChange {
  id: string;
  workspaceId: string;
  patch: RoleplayScenePatch;
  status: 'pending' | 'applied' | 'rejected';
  source: 'manual' | 'ai';
  provenanceId: string | null;
  createdAt: number;
  resolvedAt: number | null;
}

export interface RoleplayInventoryPatch {
  itemId: string;
  holderId?: string | null;
  fromHolderId?: string | null;
  toHolderId?: string | null;
  fromLocationId?: string | null;
  locationId?: string | null;
  quantity?: number;
  equipped?: boolean;
}

export interface RoleplayInventoryItem {
  itemId: string;
  name: string;
  nature: 'unique' | 'type';
  quantity: number;
  equipped: boolean;
  data: Record<string, unknown>;
}

export interface RoleplayLocationBackground {
  locationId: string;
  imagePath: string | null;
  sourceLocationId: string | null;
  inherited: boolean;
}

export interface RoleplayInventoryChange {
  id: string;
  workspaceId: string;
  patch: RoleplayInventoryPatch;
  status: 'pending' | 'applied' | 'rejected';
  source: 'manual' | 'ai';
  provenanceId: string | null;
  createdAt: number;
  resolvedAt: number | null;
}

export interface RoleplayResourceAssignment {
  definitionId: string;
  targetType: RoleplayTargetType;
  targetId: string;
  current: number;
  maximum: number;
}

/** A change names either the value to set or the amount to move it by. */
export interface ResourceChangeInput {
  id: string;
  workspaceId: string;
  definitionId: string;
  entityId: string;
  value?: number;
  delta?: number;
  maximumDelta?: number;
  reason?: string;
  source: RoleplayChangeSource;
  provenanceId?: string;
}

export interface RoleplayResourceChange {
  id: string; workspaceId: string; definitionId: string; entityId: string;
  previousValue: number; nextValue: number; delta: number | null; maximumDelta: number;
  reason: string; status: 'pending' | 'applied' | 'rejected';
  source: RoleplayChangeSource; provenanceId: string | null; createdAt: number; resolvedAt: number | null;
}

interface DefinitionRow {
  workspace_id: string; definition_id: string; resource_key: string; name: string;
  description: string; color: string; minimum: number; maximum: number;
  initial_value: number; unit: string; applies_to_json: string; update_policy: RoleplayUpdatePolicy;
  position: number; enabled: number; scope?: string; lowest_effect?: string; time_rate?: number;
  time_direction?: string; time_period?: string;
}

interface ValueRow { target_id: string; current_value: number; maximum_value: number }

export class RoleplaySystem {
  constructor(private readonly db: Database.Database) {}

  getSettings(workspaceId: string): RoleplaySettings {
    const row = this.db.prepare('SELECT * FROM roleplay_workspace_settings WHERE workspace_id = ?')
      .get(workspaceId) as Record<string, unknown> | undefined;
    return {
      workspaceId,
      playerEntityId: String(row?.player_entity_id ?? '') || null,
      locationEntityId: String(row?.location_entity_id ?? '') || null,
      activeSceneId: String(row?.active_scene_id ?? '') || null,
      scenarioName: String(row?.scenario_name ?? ''),
      scenarioSummary: String(row?.scenario_summary ?? ''),
      defaultUpdatePolicy: normalizePolicy(row?.default_update_policy)
    };
  }

  saveSettings(workspaceId: string, input: Partial<Omit<RoleplaySettings, 'workspaceId'>>): RoleplaySettings {
    const current = this.getSettings(workspaceId);
    const next = { ...current, ...input, workspaceId };
    this.validateReference(workspaceId, next.playerEntityId, ['Characters', 'Creatures']);
    this.validateReference(workspaceId, next.locationEntityId, ['Locations']);
    this.db.prepare(`
      INSERT INTO roleplay_workspace_settings (
        workspace_id, player_entity_id, location_entity_id, active_scene_id,
        scenario_name, scenario_summary, default_update_policy, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET
        player_entity_id = excluded.player_entity_id,
        location_entity_id = excluded.location_entity_id,
        active_scene_id = excluded.active_scene_id,
        scenario_name = excluded.scenario_name,
        scenario_summary = excluded.scenario_summary,
        default_update_policy = excluded.default_update_policy,
        updated_at = excluded.updated_at
    `).run(workspaceId, next.playerEntityId, next.locationEntityId, next.activeSceneId,
      next.scenarioName, next.scenarioSummary, normalizePolicy(next.defaultUpdatePolicy), Date.now());
    if (Object.hasOwn(input, 'playerEntityId')) {
      const repository = new NarrativeSceneRepository(this.db);
      const scene = repository.getActive(workspaceId);
      if (scene) this.saveScene(workspaceId, {
        participantIds: next.playerEntityId
          ? unique([next.playerEntityId, ...scene.participantIds])
          : scene.participantIds,
        possibleObserverIds: next.playerEntityId
          ? scene.possibleObserverIds.filter(id => id !== next.playerEntityId)
          : scene.possibleObserverIds
      });
    }
    return this.getSettings(workspaceId);
  }

  getScene(workspaceId: string): RoleplaySceneState | null {
    const scene = new NarrativeSceneRepository(this.db).getActive(workspaceId);
    if (!scene) return null;
    const objectIds = (this.db.prepare(`
      SELECT entity_id FROM roleplay_scene_objects
      WHERE workspace_id = ? AND scene_id = ? ORDER BY ordinal
    `).all(workspaceId, scene.id) as Array<{ entity_id: string }>).map(row => row.entity_id);
    const nearbyIds = (this.db.prepare(`
      SELECT entity_id FROM roleplay_scene_nearby
      WHERE workspace_id = ? AND scene_id = ? ORDER BY ordinal
    `).all(workspaceId, scene.id) as Array<{ entity_id: string }>).map(row => row.entity_id);
    return {
      id: scene.id,
      locationId: scene.locationId ?? null,
      participantIds: scene.participantIds,
      possibleObserverIds: scene.possibleObserverIds,
      nearbyIds,
      objectIds,
      perspective: scene.perspective,
      position: scene.position
    };
  }

  // A story move leaves the cast behind. A user picking the location corrects where the
  // scene already is, so `keepCast` carries the people over; objects stay with the room.
  saveScene(workspaceId: string, patch: RoleplayScenePatch, options: { keepCast?: boolean } = {}): RoleplaySceneState {
    const settings = this.getSettings(workspaceId);
    const current = this.getScene(workspaceId);
    const locationId = patch.locationId === undefined ? current?.locationId ?? settings.locationEntityId : patch.locationId;
    const locationChanged = patch.locationId !== undefined && patch.locationId !== current?.locationId;
    const castReset = locationChanged && !options.keepCast;
    const participantIds = unique([
      ...compact([settings.playerEntityId]),
      ...(patch.participantIds ?? (castReset ? [] : current?.participantIds ?? []))
    ]);
    const possibleObserverIds = unique(patch.possibleObserverIds ?? (castReset ? [] : current?.possibleObserverIds ?? []))
      .filter(id => id !== settings.playerEntityId && !participantIds.includes(id));
    const nearbyIds = unique(patch.nearbyIds ?? (castReset ? [] : current?.nearbyIds ?? []))
      .filter(id => id !== settings.playerEntityId && !participantIds.includes(id) && !possibleObserverIds.includes(id));
    const objectIds = unique(patch.objectIds ?? (locationChanged ? [] : current?.objectIds ?? []));
    this.validateReference(workspaceId, locationId, ['Locations']);
    participantIds.forEach(id => this.validateReference(workspaceId, id, ['Characters', 'Creatures']));
    possibleObserverIds.forEach(id => this.validateReference(workspaceId, id, ['Characters', 'Creatures']));
    nearbyIds.forEach(id => this.validateReference(workspaceId, id, ['Characters', 'Creatures']));
    objectIds.forEach(id => this.validateReference(workspaceId, id, ['Items']));
    const repository = new NarrativeSceneRepository(this.db);
    const position = current?.position ?? { sequence: this.nextSceneSequence(workspaceId) };
    const scene: Scene = {
      id: current?.id ?? randomUUID(),
      projectId: workspaceId,
      status: 'active',
      ...(locationId ? { locationId } : {}),
      participantIds,
      possibleObserverIds,
      perspective: settings.playerEntityId
        ? { access: 'subjective', focalSubjectId: settings.playerEntityId }
        : { access: 'omniscient' },
      position
    };
    const saved = current ? repository.updateActive(scene) : repository.save(scene);
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM roleplay_scene_objects WHERE workspace_id = ? AND scene_id = ?')
        .run(workspaceId, saved.id);
      const insert = this.db.prepare(`
        INSERT INTO roleplay_scene_objects (workspace_id, scene_id, entity_id, ordinal)
        VALUES (?, ?, ?, ?)
      `);
      objectIds.forEach((entityId, ordinal) => insert.run(workspaceId, saved.id, entityId, ordinal));
      this.db.prepare('DELETE FROM roleplay_scene_nearby WHERE workspace_id = ? AND scene_id = ?')
        .run(workspaceId, saved.id);
      const insertNearby = this.db.prepare(`
        INSERT INTO roleplay_scene_nearby (workspace_id, scene_id, entity_id, ordinal)
        VALUES (?, ?, ?, ?)
      `);
      nearbyIds.forEach((entityId, ordinal) => insertNearby.run(workspaceId, saved.id, entityId, ordinal));
      this.saveSettings(workspaceId, { activeSceneId: saved.id, locationEntityId: locationId });
    })();
    return this.getScene(workspaceId)!;
  }

  listDefinitions(workspaceId: string): RoleplayResourceDefinition[] {
    const rows = this.db.prepare(`
      SELECT * FROM roleplay_resource_definitions
      WHERE workspace_id = ? ORDER BY position, name COLLATE NOCASE
    `).all(workspaceId) as DefinitionRow[];
    return rows.map(hydrateDefinition);
  }

  listAssignments(workspaceId: string): RoleplayResourceAssignment[] {
    return (this.db.prepare(`
      SELECT definition_id, target_type, target_id, current_value, maximum_value
      FROM roleplay_resource_values WHERE workspace_id = ?
      ORDER BY target_type, target_id, definition_id
    `).all(workspaceId) as Array<Record<string, unknown>>).map(row => ({
      definitionId: String(row.definition_id),
      targetType: String(row.target_type) as RoleplayTargetType,
      targetId: String(row.target_id),
      current: Number(row.current_value),
      maximum: Number(row.maximum_value)
    }));
  }

  saveDefinition(
    workspaceId: string,
    input: Partial<RoleplayResourceDefinition> & Pick<RoleplayResourceDefinition, 'name' | 'key' | 'color' | 'minimum' | 'maximum' | 'initialValue' | 'appliesTo' | 'updatePolicy'>
  ): RoleplayResourceDefinition {
    const scope: RoleplayResourceScope = input.scope === 'chosen' ? 'chosen' : 'everyone';
    // Only who I choose needs no kinds: the list of holders is the whole rule.
    const appliesTo = scope === 'chosen' && !input.appliesTo?.length ? ['Characters', 'Creatures'] : input.appliesTo;
    validateDefinition({ ...input, appliesTo });
    const id = input.id || randomUUID();
    this.db.prepare(`
      INSERT INTO roleplay_resource_definitions (
        workspace_id, definition_id, resource_key, name, description, color,
        minimum, maximum, initial_value, unit, applies_to_json, update_policy,
        position, enabled, scope, lowest_effect, time_rate, time_direction, time_period, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, definition_id) DO UPDATE SET
        resource_key = excluded.resource_key, name = excluded.name,
        description = excluded.description, color = excluded.color,
        minimum = excluded.minimum, maximum = excluded.maximum,
        initial_value = excluded.initial_value, unit = excluded.unit,
        applies_to_json = excluded.applies_to_json, update_policy = excluded.update_policy,
        position = excluded.position, enabled = excluded.enabled, scope = excluded.scope,
        lowest_effect = excluded.lowest_effect, time_rate = excluded.time_rate,
        time_direction = excluded.time_direction, time_period = excluded.time_period,
        updated_at = excluded.updated_at
    `).run(workspaceId, id, input.key.trim(), input.name.trim(), input.description?.trim() || '', input.color,
      input.minimum, input.maximum, input.initialValue, input.unit?.trim() || '', JSON.stringify(appliesTo),
      input.updatePolicy, input.position ?? 0, input.enabled === false ? 0 : 1, scope,
      input.lowestEffect?.trim() || '', Math.max(0, Number(input.timeRate) || 0),
      input.timeDirection === 'drains' ? 'drains' : 'recovers', input.timePeriod === 'day' ? 'day' : 'hour', Date.now());
    return this.requireDefinition(workspaceId, id);
  }

  deleteDefinition(workspaceId: string, definitionId: string): void {
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM roleplay_resource_changes WHERE workspace_id = ? AND definition_id = ?')
        .run(workspaceId, definitionId);
      this.db.prepare('DELETE FROM roleplay_resource_definitions WHERE workspace_id = ? AND definition_id = ?')
        .run(workspaceId, definitionId);
    })();
  }

  setTargetValue(
    workspaceId: string,
    definitionId: string,
    targetType: RoleplayTargetType,
    targetId: string,
    value: { current: number; maximum: number }
  ): void {
    const definition = this.requireDefinition(workspaceId, definitionId);
    this.validateTarget(workspaceId, targetType, targetId);
    const maximum = Math.max(definition.minimum, value.maximum);
    const current = clamp(value.current, definition.minimum, maximum);
    this.db.prepare(`
      INSERT INTO roleplay_resource_values (
        workspace_id, definition_id, target_type, target_id,
        current_value, maximum_value, version, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, 1, ?)
      ON CONFLICT(workspace_id, definition_id, target_type, target_id) DO UPDATE SET
        current_value = excluded.current_value, maximum_value = excluded.maximum_value,
        version = roleplay_resource_values.version + 1, updated_at = excluded.updated_at
    `).run(workspaceId, definitionId, targetType, targetId, current, maximum, Date.now());
  }

  setTargetValues(
    workspaceId: string,
    definitionId: string,
    targetType: RoleplayTargetType,
    targetIds: string[],
    value: { current: number; maximum: number }
  ): void {
    if (!targetIds.length) throw new Error('Select at least one roleplay target.');
    this.db.transaction(() => {
      unique(targetIds).forEach(targetId => this.setTargetValue(workspaceId, definitionId, targetType, targetId, value));
    })();
  }

  removeTargetValue(workspaceId: string, definitionId: string, targetType: RoleplayTargetType, targetId: string): void {
    this.db.prepare(`
      DELETE FROM roleplay_resource_values
      WHERE workspace_id = ? AND definition_id = ? AND target_type = ? AND target_id = ?
    `).run(workspaceId, definitionId, targetType, targetId);
  }

  listEntityResources(workspaceId: string, entityId: string): EntityResourceState[] {
    const entity = this.requireEntity(workspaceId, entityId);
    return this.listDefinitions(workspaceId).flatMap(definition => {
      if (!definition.enabled || !definition.appliesTo.includes(entity.type)) return [];
      const direct = this.getValue(workspaceId, definition.id, 'entity', entityId);
      const inherited = direct ? null : this.getInheritedValue(workspaceId, definition.id, entityId);
      // A chosen resource exists only where someone gave it: the character, their race or species.
      if (definition.scope === 'chosen' && !direct && !inherited) return [];
      const value = direct ?? inherited?.value;
      return [{
        ...definition,
        definitionId: definition.id,
        current: value?.current_value ?? definition.initialValue,
        maximum: value?.maximum_value ?? definition.maximum,
        inheritedFrom: direct ? null : inherited?.targetId ?? null,
        inheritedFromType: direct ? 'entity' : inherited?.targetType ?? 'default'
      }];
    });
  }

  proposeChange(input: ResourceChangeInput): RoleplayResourceChange {
    const existing = this.getChange(input.workspaceId, input.id);
    if (existing) return existing;
    const definition = this.requireDefinition(input.workspaceId, input.definitionId);
    if (input.source === 'ai' && definition.updatePolicy === 'manual') throw new Error('Resource is manual-only.');
    const state = this.listEntityResources(input.workspaceId, input.entityId)
      .find(item => item.definitionId === input.definitionId);
    if (!state) throw new Error('Resource does not apply to this entity.');
    const hasDelta = Number.isFinite(input.delta);
    if (!hasDelta && !Number.isFinite(input.value)) throw new Error('Resource value must be finite.');
    const maximumDelta = Number.isFinite(input.maximumDelta) ? Number(input.maximumDelta) : 0;
    const maximum = Math.max(definition.minimum, state.maximum + maximumDelta);
    const nextValue = clamp(hasDelta ? state.current + Number(input.delta) : Number(input.value), definition.minimum, maximum);
    const status = input.source === 'ai' && definition.updatePolicy !== 'automatic' ? 'pending' : 'applied';
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO roleplay_resource_changes (
          workspace_id, change_id, definition_id, entity_id, previous_value, next_value,
          delta, maximum_delta, reason, status, source, provenance_id, created_at, resolved_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(input.workspaceId, input.id, input.definitionId, input.entityId, state.current,
        nextValue, hasDelta ? Number(input.delta) : nextValue - state.current, maximumDelta,
        String(input.reason || '').trim().slice(0, 240), status, input.source,
        input.provenanceId ?? null, Date.now(), status === 'applied' ? Date.now() : null);
      if (status === 'applied') this.setTargetValue(input.workspaceId, input.definitionId, 'entity', input.entityId, {
        current: nextValue, maximum
      });
    })();
    return this.getChange(input.workspaceId, input.id)!;
  }

  // A pending change is an amount, applied to the value as it is when approved: the value may
  // have moved since, and writing the stored result back would undo whatever moved it.
  resolveChange(workspaceId: string, changeId: string, decision: 'approved' | 'rejected') {
    const change = this.getChange(workspaceId, changeId);
    if (!change) throw new Error('Roleplay change was not found.');
    if (change.status !== 'pending') return change;
    this.db.transaction(() => {
      if (decision === 'approved') {
        const definition = this.requireDefinition(workspaceId, change.definitionId);
        const state = this.listEntityResources(workspaceId, change.entityId)
          .find(item => item.definitionId === change.definitionId);
        if (!state) throw new Error('Resource no longer applies to this entity.');
        const maximum = Math.max(definition.minimum, state.maximum + change.maximumDelta);
        const delta = change.delta ?? change.nextValue - change.previousValue;
        const nextValue = clamp(state.current + delta, definition.minimum, maximum);
        this.setTargetValue(workspaceId, change.definitionId, 'entity', change.entityId, { current: nextValue, maximum });
        this.db.prepare(`
          UPDATE roleplay_resource_changes SET previous_value = ?, next_value = ?
          WHERE workspace_id = ? AND change_id = ?
        `).run(state.current, nextValue, workspaceId, changeId);
      }
      this.db.prepare(`
        UPDATE roleplay_resource_changes SET status = ?, resolved_at = ?
        WHERE workspace_id = ? AND change_id = ?
      `).run(decision === 'approved' ? 'applied' : 'rejected', Date.now(), workspaceId, changeId);
    })();
    return this.getChange(workspaceId, changeId)!;
  }

  /**
   * Story time moves resources that recover or drain. It reaches the given people and anyone
   * already holding a value of their own, so a world of untouched NPCs stays untouched.
   */
  applyElapsedTime(workspaceId: string, provenanceId: string, minutes: number, entityIds: string[]): RoleplayResourceChange[] {
    if (!(minutes > 0)) return [];
    const definitions = this.listDefinitions(workspaceId).filter(item => item.enabled && item.timeRate > 0);
    if (!definitions.length) return [];
    const hoursPerDay = this.hoursPerDay(workspaceId);
    const changes: RoleplayResourceChange[] = [];
    for (const definition of definitions) {
      const perMinute = definition.timeRate / (definition.timePeriod === 'day' ? hoursPerDay * 60 : 60);
      const amount = Math.round(perMinute * minutes * 100) / 100;
      if (!amount) continue;
      const holders = new Set([
        ...entityIds,
        ...(this.db.prepare(`
          SELECT target_id FROM roleplay_resource_values
          WHERE workspace_id = ? AND definition_id = ? AND target_type = 'entity'
        `).all(workspaceId, definition.id) as Array<{ target_id: string }>).map(row => row.target_id)
      ].filter(Boolean));
      for (const entityId of holders) {
        let state: EntityResourceState | undefined;
        try {
          state = this.listEntityResources(workspaceId, entityId).find(item => item.definitionId === definition.id);
        } catch {
          continue;
        }
        if (!state) continue;
        const delta = definition.timeDirection === 'drains' ? -amount : amount;
        if (clamp(state.current + delta, definition.minimum, state.maximum) === state.current) continue;
        changes.push(this.proposeChange({
          id: `${provenanceId}:time:${definition.id}:${entityId}`,
          workspaceId, definitionId: definition.id, entityId, delta,
          reason: describeElapsedMinutes(minutes, hoursPerDay),
          source: 'time', provenanceId
        }));
      }
    }
    return changes;
  }

  listChanges(workspaceId: string, entityId?: string) {
    const sql = `SELECT * FROM roleplay_resource_changes WHERE workspace_id = ?${entityId ? ' AND entity_id = ?' : ''} ORDER BY created_at, change_id`;
    return (this.db.prepare(sql).all(...(entityId ? [workspaceId, entityId] : [workspaceId])) as Record<string, unknown>[])
      .map(hydrateChange);
  }

  listSceneChanges(workspaceId: string): RoleplaySceneChange[] {
    return (this.db.prepare(`
      SELECT * FROM roleplay_scene_changes WHERE workspace_id = ? ORDER BY created_at, change_id
    `).all(workspaceId) as Array<Record<string, unknown>>).map(hydrateSceneChange);
  }

  listInventoryChanges(workspaceId: string): RoleplayInventoryChange[] {
    return (this.db.prepare(`
      SELECT * FROM roleplay_inventory_changes WHERE workspace_id = ? ORDER BY created_at, change_id
    `).all(workspaceId) as Array<Record<string, unknown>>).map(hydrateInventoryChange);
  }

  listInventory(workspaceId: string, entityId: string): RoleplayInventoryItem[] {
    this.validateReference(workspaceId, entityId, ['Characters', 'Creatures']);
    const rows = this.db.prepare(`
      SELECT items.id AS itemId, items.canonicalName AS name, items.data,
        links.metadata_json AS metadataJson,
        CASE WHEN equipment.item_id IS NULL THEN 0 ELSE 1 END AS equipped
      FROM entity_links AS links
      JOIN entities AS items
        ON items.id = links.fromId AND items.workspaceId = links.workspaceId
      LEFT JOIN roleplay_equipment AS equipment
        ON equipment.workspace_id = links.workspaceId
        AND equipment.entity_id = links.toId AND equipment.item_id = links.fromId
      WHERE links.workspaceId = ? AND links.toId = ?
        AND links.relType IN ('owned_by', 'carried_by')
        AND items.type = 'Items' AND items.status != 'proposed'
      ORDER BY equipped DESC, items.canonicalName COLLATE NOCASE
    `).all(workspaceId, entityId) as Array<Record<string, unknown>>;
    const inventory = new Map<string, RoleplayInventoryItem>();
    rows.forEach(row => {
      const data = parseObject(row.data);
      const nature = data.itemNature === 'unique' ? 'unique' : 'type';
      const metadata = parseObject(row.metadataJson);
      const item: RoleplayInventoryItem = {
        itemId: String(row.itemId),
        name: String(row.name),
        nature,
        quantity: nature === 'unique' ? 1 : Math.max(1, Math.round(Number(metadata.quantity) || 1)),
        equipped: Number(row.equipped) === 1,
        data
      };
      const existing = inventory.get(item.itemId);
      if (!existing) {
        inventory.set(item.itemId, item);
      } else if (item.nature === 'type') {
        existing.quantity += item.quantity;
        existing.equipped ||= item.equipped;
      }
    });
    return [...inventory.values()];
  }

  setEquipped(workspaceId: string, entityId: string, itemId: string, equipped: boolean): RoleplayInventoryItem[] {
    if (!this.listInventory(workspaceId, entityId).some(item => item.itemId === itemId)) {
      throw new Error('Only carried items can be equipped.');
    }
    if (equipped) {
      this.db.prepare(`
        INSERT INTO roleplay_equipment (workspace_id, entity_id, item_id, equipped_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(workspace_id, entity_id, item_id)
        DO UPDATE SET equipped_at = excluded.equipped_at
      `).run(workspaceId, entityId, itemId, Date.now());
    } else {
      this.db.prepare(`
        DELETE FROM roleplay_equipment
        WHERE workspace_id = ? AND entity_id = ? AND item_id = ?
      `).run(workspaceId, entityId, itemId);
    }
    return this.listInventory(workspaceId, entityId);
  }

  setLocationBackground(workspaceId: string, locationId: string, imagePath: string | null): RoleplayLocationBackground {
    this.validateReference(workspaceId, locationId, ['Locations']);
    if (imagePath) {
      this.db.prepare(`
        INSERT INTO roleplay_location_backgrounds (workspace_id, location_id, image_path, updated_at)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(workspace_id, location_id)
        DO UPDATE SET image_path = excluded.image_path, updated_at = excluded.updated_at
      `).run(workspaceId, locationId, imagePath, Date.now());
    } else {
      this.db.prepare('DELETE FROM roleplay_location_backgrounds WHERE workspace_id = ? AND location_id = ?')
        .run(workspaceId, locationId);
    }
    return this.getLocationBackground(workspaceId, locationId);
  }

  getLocationBackground(workspaceId: string, locationId: string): RoleplayLocationBackground {
    this.validateReference(workspaceId, locationId, ['Locations']);
    const visited = new Set<string>();
    let current: string | null = locationId;
    while (current && !visited.has(current)) {
      visited.add(current);
      const background = this.db.prepare(`
        SELECT image_path FROM roleplay_location_backgrounds
        WHERE workspace_id = ? AND location_id = ?
      `).get(workspaceId, current) as { image_path: string } | undefined;
      if (background?.image_path) {
        return {
          locationId,
          imagePath: background.image_path,
          sourceLocationId: current,
          inherited: current !== locationId
        };
      }
      const parent = this.db.prepare(`
        SELECT links.toId AS id
        FROM entity_links AS links
        JOIN entities AS target ON target.id = links.toId AND target.workspaceId = links.workspaceId
        WHERE links.workspaceId = ? AND links.fromId = ? AND links.relType = 'inside'
          AND target.type = 'Locations' AND target.status != 'proposed'
        ORDER BY links.createdAt DESC LIMIT 1
      `).get(workspaceId, current) as { id: string } | undefined;
      current = parent?.id ?? null;
    }
    return { locationId, imagePath: null, sourceLocationId: null, inherited: false };
  }

  proposeInventoryChange(input: {
    id: string; workspaceId: string; patch: RoleplayInventoryPatch;
    source: 'manual' | 'ai'; provenanceId?: string;
  }): RoleplayInventoryChange {
    const existing = this.getInventoryChange(input.workspaceId, input.id);
    if (existing) return existing;
    const patch = this.normalizeInventoryPatch(input.workspaceId, input.patch);
    this.validateInventoryPatch(input.workspaceId, patch);
    const policy = this.getSettings(input.workspaceId).defaultUpdatePolicy;
    if (input.source === 'ai' && policy === 'manual') throw new Error('Inventory updates are manual-only.');
    const status = input.source === 'manual' || policy === 'automatic' ? 'applied' : 'pending';
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO roleplay_inventory_changes (
          workspace_id, change_id, payload_json, status, source, provenance_id, created_at, resolved_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(input.workspaceId, input.id, JSON.stringify(patch), status, input.source,
        input.provenanceId ?? null, Date.now(), status === 'applied' ? Date.now() : null);
      if (status === 'applied') this.applyInventoryPatch(input.workspaceId, patch);
    })();
    return this.getInventoryChange(input.workspaceId, input.id)!;
  }

  resolveInventoryChange(workspaceId: string, changeId: string, decision: 'approved' | 'rejected'): RoleplayInventoryChange {
    const change = this.getInventoryChange(workspaceId, changeId);
    if (!change) throw new Error('Roleplay inventory change was not found.');
    if (change.status !== 'pending') return change;
    this.db.transaction(() => {
      if (decision === 'approved') this.applyInventoryPatch(workspaceId, change.patch);
      this.db.prepare(`
        UPDATE roleplay_inventory_changes SET status = ?, resolved_at = ?
        WHERE workspace_id = ? AND change_id = ?
      `).run(decision === 'approved' ? 'applied' : 'rejected', Date.now(), workspaceId, changeId);
    })();
    return this.getInventoryChange(workspaceId, changeId)!;
  }

  proposeSceneChange(input: {
    id: string; workspaceId: string; patch: RoleplayScenePatch;
    source: 'manual' | 'ai'; provenanceId?: string;
  }): RoleplaySceneChange {
    const existing = this.getSceneChange(input.workspaceId, input.id);
    if (existing) return existing;
    const policy = this.getSettings(input.workspaceId).defaultUpdatePolicy;
    if (input.source === 'ai' && policy === 'manual') throw new Error('Scene updates are manual-only.');
    const status = input.source === 'manual' || policy === 'automatic' ? 'applied' : 'pending';
    this.db.transaction(() => {
      this.db.prepare(`
        INSERT INTO roleplay_scene_changes (
          workspace_id, change_id, payload_json, status, source, provenance_id, created_at, resolved_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(input.workspaceId, input.id, JSON.stringify(input.patch), status, input.source,
        input.provenanceId ?? null, Date.now(), status === 'applied' ? Date.now() : null);
      if (status === 'applied') this.saveScene(input.workspaceId, input.patch, { keepCast: input.source === 'manual' });
    })();
    return this.getSceneChange(input.workspaceId, input.id)!;
  }

  resolveSceneChange(workspaceId: string, changeId: string, decision: 'approved' | 'rejected'): RoleplaySceneChange {
    const change = this.getSceneChange(workspaceId, changeId);
    if (!change) throw new Error('Roleplay scene change was not found.');
    if (change.status !== 'pending') return change;
    this.db.transaction(() => {
      if (decision === 'approved') this.saveScene(workspaceId, change.patch);
      this.db.prepare(`
        UPDATE roleplay_scene_changes SET status = ?, resolved_at = ?
        WHERE workspace_id = ? AND change_id = ?
      `).run(decision === 'approved' ? 'applied' : 'rejected', Date.now(), workspaceId, changeId);
    })();
    return this.getSceneChange(workspaceId, changeId)!;
  }

  processAiResponse(workspaceId: string, provenanceId: string, content: string) {
    const pattern = /<!--\s*KALLAMO_ROLEPLAY_CHANGES\s+([\s\S]*?)\s*-->/g;
    const proposals: Array<{ entityId: string; resourceKey: string; value: number }> = [];
    const scenePatches: RoleplayScenePatch[] = [];
    const cleanContent = content.replace(pattern, (_match, json: string) => {
      try {
        const parsed = JSON.parse(json) as unknown;
        if (Array.isArray(parsed)) proposals.push(...parsed.filter(isAiProposal));
      } catch { /* Invalid model metadata is ignored without affecting the narrative response. */ }
      return '';
    }).trim();
    const scenePattern = /<!--\s*KALLAMO_ROLEPLAY_SCENE\s+([\s\S]*?)\s*-->/g;
    const narrativeContent = cleanContent.replace(scenePattern, (_match, json: string) => {
      try {
        const parsed = JSON.parse(json) as unknown;
        if (isScenePatch(parsed)) scenePatches.push(parsed);
      } catch { /* Invalid model metadata is ignored without affecting the narrative response. */ }
      return '';
    }).trim();
    const definitions = new Map(this.listDefinitions(workspaceId).map(item => [item.key, item]));
    const changes = proposals.flatMap((proposal, index) => {
      const definition = definitions.get(proposal.resourceKey);
      if (!definition || definition.updatePolicy === 'manual') return [];
      try {
        return [this.proposeChange({
          id: `${provenanceId}:${index}:${definition.id}:${proposal.entityId}`,
          workspaceId, definitionId: definition.id, entityId: proposal.entityId,
          value: proposal.value, source: 'ai', provenanceId
        })];
      } catch { return []; }
    });
    const sceneChanges = scenePatches.flatMap((patch, index) => {
      try {
        return [this.proposeSceneChange({
          id: `${provenanceId}:scene:${index}`,
          workspaceId,
          patch,
          source: 'ai',
          provenanceId
        })];
      } catch { return []; }
    });
    return { content: narrativeContent, changes, sceneChanges };
  }

  private getSceneChange(workspaceId: string, changeId: string): RoleplaySceneChange | undefined {
    const row = this.db.prepare(`
      SELECT * FROM roleplay_scene_changes WHERE workspace_id = ? AND change_id = ?
    `).get(workspaceId, changeId) as Record<string, unknown> | undefined;
    return row ? hydrateSceneChange(row) : undefined;
  }

  private getInventoryChange(workspaceId: string, changeId: string): RoleplayInventoryChange | undefined {
    const row = this.db.prepare(`
      SELECT * FROM roleplay_inventory_changes WHERE workspace_id = ? AND change_id = ?
    `).get(workspaceId, changeId) as Record<string, unknown> | undefined;
    return row ? hydrateInventoryChange(row) : undefined;
  }

  private normalizeInventoryPatch(workspaceId: string, patch: RoleplayInventoryPatch): RoleplayInventoryPatch {
    const normalized: RoleplayInventoryPatch = { ...patch };
    const equippedValue: unknown = normalized.equipped;
    if (typeof equippedValue === 'string') {
      const value = equippedValue.trim().toLowerCase();
      if (value === 'true' || value === 'false') normalized.equipped = value === 'true';
      else delete normalized.equipped;
    } else if (equippedValue !== undefined) {
      normalized.equipped = Boolean(equippedValue);
    }
    if (normalized.quantity !== undefined) normalized.quantity = Math.round(Number(normalized.quantity));
    if (normalized.fromHolderId && normalized.equipped === undefined) {
      const equipment = this.db.prepare(`
        SELECT 1 FROM roleplay_equipment
        WHERE workspace_id = ? AND entity_id = ? AND item_id = ?
        LIMIT 1
      `).get(workspaceId, normalized.fromHolderId, normalized.itemId);
      if (equipment) normalized.equipped = false;
    }
    return normalized;
  }

  private validateInventoryPatch(workspaceId: string, patch: RoleplayInventoryPatch): void {
    const item = this.requireEntityData(workspaceId, patch.itemId);
    if (item.type !== 'Items') throw new Error('Inventory changes require an item.');
    if (patch.fromHolderId) this.validateReference(workspaceId, patch.fromHolderId, ['Characters', 'Creatures']);
    if (patch.toHolderId) this.validateReference(workspaceId, patch.toHolderId, ['Characters', 'Creatures']);
    if (patch.holderId) this.validateReference(workspaceId, patch.holderId, ['Characters', 'Creatures']);
    if (patch.fromLocationId) this.validateReference(workspaceId, patch.fromLocationId, ['Locations']);
    if (patch.locationId) this.validateReference(workspaceId, patch.locationId, ['Locations']);
    const isUnique = item.data.itemNature === 'unique';
    if (isUnique && patch.toHolderId && patch.locationId) throw new Error('A unique item cannot be in an inventory and a location at once.');
    const equipmentOnly = Boolean(patch.holderId) && patch.equipped !== undefined
      && !patch.fromHolderId && !patch.fromLocationId && !patch.toHolderId && !patch.locationId;
    if (!isUnique && !equipmentOnly && (!Number.isInteger(patch.quantity) || Number(patch.quantity) < 1)) {
      throw new Error('Item type inventory changes require a positive quantity.');
    }
    if (patch.equipped !== undefined && !patch.holderId && !patch.toHolderId && !patch.fromHolderId) {
      throw new Error('Equipment changes require an inventory holder.');
    }
  }

  private applyInventoryPatch(workspaceId: string, patch: RoleplayInventoryPatch): void {
    const item = this.requireEntityData(workspaceId, patch.itemId);
    const isUnique = item.data.itemNature === 'unique';
    if (patch.holderId && patch.equipped !== undefined
      && !patch.fromHolderId && !patch.fromLocationId && !patch.toHolderId && !patch.locationId) {
      this.setEquipped(workspaceId, patch.holderId, patch.itemId, patch.equipped);
      return;
    }
    if (isUnique) {
      this.db.prepare("DELETE FROM entity_links WHERE workspaceId = ? AND fromId = ? AND relType IN ('owned_by', 'carried_by', 'located_in')")
        .run(workspaceId, patch.itemId);
      const targetId = patch.toHolderId || patch.locationId;
      if (!targetId) {
        this.db.prepare('DELETE FROM roleplay_equipment WHERE workspace_id = ? AND item_id = ?')
          .run(workspaceId, patch.itemId);
        return;
      }
      this.db.prepare(`
        INSERT INTO entity_links (id, workspaceId, fromId, relType, toId, label, metadata_json, createdAt)
        VALUES (?, ?, ?, ?, ?, NULL, ?, ?)
      `).run(randomUUID(), workspaceId, patch.itemId, patch.toHolderId ? 'owned_by' : 'located_in', targetId, JSON.stringify({ quantity: 1 }), Date.now());
      this.db.prepare('DELETE FROM roleplay_equipment WHERE workspace_id = ? AND item_id = ?')
        .run(workspaceId, patch.itemId);
      if (patch.toHolderId && patch.equipped) this.setEquipped(workspaceId, patch.toHolderId, patch.itemId, true);
      return;
    }
    const quantity = Number(patch.quantity);
    if (patch.fromHolderId) this.adjustCarriedQuantity(workspaceId, patch.itemId, patch.fromHolderId, -quantity);
    if (patch.fromLocationId) this.adjustLocationQuantity(workspaceId, patch.itemId, patch.fromLocationId, -quantity);
    if (patch.toHolderId) this.adjustCarriedQuantity(workspaceId, patch.itemId, patch.toHolderId, quantity);
    if (patch.locationId) this.adjustLocationQuantity(workspaceId, patch.itemId, patch.locationId, quantity);
    if (patch.fromHolderId) {
      this.db.prepare(`
        DELETE FROM roleplay_equipment
        WHERE workspace_id = ? AND entity_id = ? AND item_id = ?
      `).run(workspaceId, patch.fromHolderId, patch.itemId);
    }
    if (patch.toHolderId && patch.equipped === true) this.setEquipped(workspaceId, patch.toHolderId, patch.itemId, true);
  }

  private adjustLocationQuantity(workspaceId: string, itemId: string, locationId: string, delta: number): void {
    const row = this.db.prepare(`
      SELECT quantity FROM roleplay_location_inventory
      WHERE workspace_id = ? AND location_id = ? AND item_id = ?
    `).get(workspaceId, locationId, itemId) as { quantity: number } | undefined;
    const next = Number(row?.quantity ?? 0) + delta;
    if (next < 0) throw new Error('Location inventory quantity cannot become negative.');
    if (next === 0) {
      this.db.prepare(`
        DELETE FROM roleplay_location_inventory
        WHERE workspace_id = ? AND location_id = ? AND item_id = ?
      `).run(workspaceId, locationId, itemId);
    } else {
      this.db.prepare(`
        INSERT INTO roleplay_location_inventory (workspace_id, location_id, item_id, quantity, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id, location_id, item_id)
        DO UPDATE SET quantity = excluded.quantity, updated_at = excluded.updated_at
      `).run(workspaceId, locationId, itemId, next, Date.now());
    }
  }

  private adjustCarriedQuantity(workspaceId: string, itemId: string, holderId: string, delta: number): void {
    const row = this.db.prepare(`
      SELECT id, metadata_json AS metadataJson FROM entity_links
      WHERE workspaceId = ? AND fromId = ? AND relType IN ('carried_by', 'owned_by') AND toId = ?
      ORDER BY CASE relType WHEN 'carried_by' THEN 0 ELSE 1 END
      LIMIT 1
    `).get(workspaceId, itemId, holderId) as { id: string; metadataJson: string | null } | undefined;
    const current = row ? Number((JSON.parse(row.metadataJson || '{}') as { quantity?: number }).quantity ?? 1) : 0;
    const next = current + delta;
    if (next < 0) throw new Error('Inventory quantity cannot become negative.');
    if (row && next === 0) {
      this.db.prepare('DELETE FROM entity_links WHERE id = ?').run(row.id);
      this.db.prepare(`
        DELETE FROM roleplay_equipment
        WHERE workspace_id = ? AND entity_id = ? AND item_id = ?
      `).run(workspaceId, holderId, itemId);
    }
    else if (row) this.db.prepare('UPDATE entity_links SET metadata_json = ? WHERE id = ?').run(JSON.stringify({ quantity: next }), row.id);
    else if (next > 0) this.db.prepare(`
      INSERT INTO entity_links (id, workspaceId, fromId, relType, toId, label, metadata_json, createdAt)
      VALUES (?, ?, ?, 'carried_by', ?, NULL, ?, ?)
    `).run(randomUUID(), workspaceId, itemId, holderId, JSON.stringify({ quantity: next }), Date.now());
  }

  private hoursPerDay(workspaceId: string): number {
    const hasCalendars = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'worldbuild_calendars'").get();
    const row = hasCalendars
      ? this.db.prepare('SELECT definition_json FROM worldbuild_calendars WHERE workspace_id = ?').get(workspaceId) as { definition_json: string } | undefined
      : undefined;
    const hours = Number(parseObject(row?.definition_json).hoursPerDay);
    return Number.isFinite(hours) && hours > 0 ? hours : 24;
  }

  private nextSceneSequence(workspaceId: string): number {
    const row = this.db.prepare(`
      SELECT COALESCE(MAX(narrative_sequence), -1) + 1 AS sequence
      FROM narrative_scenes WHERE workspace_id = ?
    `).get(workspaceId) as { sequence: number };
    return row.sequence;
  }

  private getChange(workspaceId: string, changeId: string) {
    const row = this.db.prepare('SELECT * FROM roleplay_resource_changes WHERE workspace_id = ? AND change_id = ?')
      .get(workspaceId, changeId) as Record<string, unknown> | undefined;
    return row ? hydrateChange(row) : undefined;
  }

  private requireDefinition(workspaceId: string, definitionId: string): RoleplayResourceDefinition {
    const row = this.db.prepare(`
      SELECT * FROM roleplay_resource_definitions WHERE workspace_id = ? AND definition_id = ?
    `).get(workspaceId, definitionId) as DefinitionRow | undefined;
    if (!row) throw new Error('Roleplay resource was not found.');
    return hydrateDefinition(row);
  }

  private getValue(workspaceId: string, definitionId: string, targetType: RoleplayTargetType, targetId: string) {
    return this.db.prepare(`
      SELECT target_id, current_value, maximum_value FROM roleplay_resource_values
      WHERE workspace_id = ? AND definition_id = ? AND target_type = ? AND target_id = ?
    `).get(workspaceId, definitionId, targetType, targetId) as ValueRow | undefined;
  }

  private getInheritedValue(workspaceId: string, definitionId: string, entityId: string) {
    // A character's race and a specific being's species are the same link; the target's type tells them apart.
    const group = this.db.prepare(`
      SELECT groups.id, groups.type FROM entity_links AS links
      JOIN entities AS groups ON groups.id = links.toId AND groups.workspaceId = links.workspaceId
      WHERE links.workspaceId = ? AND links.fromId = ? AND links.relType = 'is_race' AND groups.status != 'proposed'
      LIMIT 1
    `).get(workspaceId, entityId) as { id: string; type: string } | undefined;
    if (!group) return undefined;
    const targetType = group.type === 'Races' ? 'race' as const : 'species' as const;
    const value = this.getValue(workspaceId, definitionId, targetType, group.id);
    return value ? { value, targetId: group.id, targetType } : undefined;
  }

  private validateTarget(workspaceId: string, targetType: RoleplayTargetType, targetId: string): void {
    const types = targetType === 'race' ? ['Races'] : targetType === 'species' ? ['Creatures'] : undefined;
    this.validateReference(workspaceId, targetId, types);
  }

  private validateReference(workspaceId: string, id: string | null, types?: string[]): void {
    if (!id) return;
    const entity = this.requireEntity(workspaceId, id);
    if (types && !types.includes(entity.type)) throw new Error('Entity type is not valid for this roleplay reference.');
  }

  private requireEntity(workspaceId: string, id: string): { type: string } {
    const row = this.db.prepare(`
      SELECT type FROM entities WHERE workspaceId = ? AND id = ? AND status != 'proposed'
    `).get(workspaceId, id) as { type: string } | undefined;
    if (!row) throw new Error('Confirmed workspace entity was not found.');
    return row;
  }

  private requireEntityData(workspaceId: string, id: string): { type: string; data: Record<string, unknown> } {
    const row = this.db.prepare(`
      SELECT type, data FROM entities WHERE workspaceId = ? AND id = ? AND status != 'proposed'
    `).get(workspaceId, id) as { type: string; data: string } | undefined;
    if (!row) throw new Error('Confirmed workspace entity was not found.');
    return { type: row.type, data: JSON.parse(row.data || '{}') as Record<string, unknown> };
  }
}

function hydrateDefinition(row: DefinitionRow): RoleplayResourceDefinition {
  return {
    id: row.definition_id, workspaceId: row.workspace_id, key: row.resource_key,
    name: row.name, description: row.description, color: row.color,
    minimum: row.minimum, maximum: row.maximum, initialValue: row.initial_value,
    unit: row.unit, appliesTo: JSON.parse(row.applies_to_json) as string[],
    updatePolicy: row.update_policy, position: row.position, enabled: row.enabled === 1,
    scope: row.scope === 'chosen' ? 'chosen' : 'everyone',
    lowestEffect: String(row.lowest_effect ?? ''),
    timeRate: Number(row.time_rate ?? 0),
    timeDirection: row.time_direction === 'drains' ? 'drains' : 'recovers',
    timePeriod: row.time_period === 'day' ? 'day' : 'hour'
  };
}

function hydrateChange(row: Record<string, unknown>): RoleplayResourceChange {
  return {
    id: String(row.change_id), workspaceId: String(row.workspace_id),
    definitionId: String(row.definition_id), entityId: String(row.entity_id),
    previousValue: Number(row.previous_value), nextValue: Number(row.next_value),
    delta: row.delta === null || row.delta === undefined ? null : Number(row.delta),
    maximumDelta: Number(row.maximum_delta ?? 0),
    reason: String(row.reason ?? ''),
    status: String(row.status) as 'pending' | 'applied' | 'rejected',
    source: String(row.source) as RoleplayChangeSource,
    provenanceId: row.provenance_id ? String(row.provenance_id) : null,
    createdAt: Number(row.created_at),
    resolvedAt: row.resolved_at === null ? null : Number(row.resolved_at)
  };
}

function hydrateSceneChange(row: Record<string, unknown>): RoleplaySceneChange {
  return {
    id: String(row.change_id),
    workspaceId: String(row.workspace_id),
    patch: JSON.parse(String(row.payload_json)) as RoleplayScenePatch,
    status: String(row.status) as RoleplaySceneChange['status'],
    source: String(row.source) as RoleplaySceneChange['source'],
    provenanceId: row.provenance_id ? String(row.provenance_id) : null,
    createdAt: Number(row.created_at),
    resolvedAt: row.resolved_at === null ? null : Number(row.resolved_at)
  };
}

function hydrateInventoryChange(row: Record<string, unknown>): RoleplayInventoryChange {
  return {
    id: String(row.change_id),
    workspaceId: String(row.workspace_id),
    patch: JSON.parse(String(row.payload_json)) as RoleplayInventoryPatch,
    status: String(row.status) as RoleplayInventoryChange['status'],
    source: String(row.source) as RoleplayInventoryChange['source'],
    provenanceId: row.provenance_id ? String(row.provenance_id) : null,
    createdAt: Number(row.created_at),
    resolvedAt: row.resolved_at === null ? null : Number(row.resolved_at)
  };
}

function validateDefinition(input: Pick<RoleplayResourceDefinition, 'name' | 'key' | 'color' | 'minimum' | 'maximum' | 'initialValue' | 'appliesTo'>): void {
  if (!input.name.trim() || !/^[a-z][a-z0-9_-]*$/.test(input.key)) throw new Error('Resource name and key are required.');
  if (!/^#[0-9a-f]{6}$/i.test(input.color)) throw new Error('Resource color must be a hex color.');
  if (!Number.isFinite(input.minimum) || !Number.isFinite(input.maximum) || input.maximum <= input.minimum) {
    throw new Error('Resource maximum must be greater than its minimum.');
  }
  if (input.initialValue < input.minimum || input.initialValue > input.maximum) throw new Error('Initial value is outside the resource range.');
  if (!input.appliesTo.length) throw new Error('Resource must apply to at least one entity type.');
}

function normalizePolicy(value: unknown): RoleplayUpdatePolicy {
  return value === 'manual' || value === 'automatic' ? value : 'review';
}

function clamp(value: number, minimum: number, maximum: number): number {
  if (!Number.isFinite(value)) throw new Error('Resource value must be finite.');
  return Math.max(minimum, Math.min(maximum, value));
}

function isAiProposal(value: unknown): value is { entityId: string; resourceKey: string; value: number } {
  if (!value || typeof value !== 'object') return false;
  const proposal = value as Record<string, unknown>;
  return typeof proposal.entityId === 'string'
    && typeof proposal.resourceKey === 'string'
    && typeof proposal.value === 'number'
    && Number.isFinite(proposal.value);
}

function isScenePatch(value: unknown): value is RoleplayScenePatch {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const patch = value as Record<string, unknown>;
  return ['locationId', 'participantIds', 'possibleObserverIds', 'nearbyIds', 'objectIds'].some(key => Object.hasOwn(patch, key))
    && ['participantIds', 'possibleObserverIds', 'nearbyIds', 'objectIds'].every(key => !Object.hasOwn(patch, key)
      || (Array.isArray(patch[key]) && (patch[key] as unknown[]).every(item => typeof item === 'string')))
    && (!Object.hasOwn(patch, 'locationId') || patch.locationId === null || typeof patch.locationId === 'string');
}

function parseObject(value: unknown): Record<string, any> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, any>;
  try {
    const parsed = JSON.parse(String(value || '{}')) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, any> : {};
  } catch {
    return {};
  }
}

function describeElapsedMinutes(minutes: number, hoursPerDay: number): string {
  const day = hoursPerDay * 60;
  const days = Math.floor(minutes / day);
  const hours = Math.floor((minutes % day) / 60);
  const rest = Math.round(minutes % 60);
  const parts = [
    days ? `${days} ${days === 1 ? 'day' : 'days'}` : '',
    hours ? `${hours} ${hours === 1 ? 'hour' : 'hours'}` : '',
    !days && rest ? `${rest} ${rest === 1 ? 'minute' : 'minutes'}` : ''
  ].filter(Boolean);
  return `${parts.join(' ') || 'Time'} passed`;
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}

function compact(values: Array<string | null | undefined>): string[] {
  return values.filter((value): value is string => Boolean(value));
}
