import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { RoleplaySystem, type RoleplayUpdatePolicy } from './roleplay-system';
import { findByReference, requireUniqueName, ruleKey } from './rule-keys';

export type ConditionStatus = 'confirmed' | 'proposed';
export type ConditionChangeKind = 'start' | 'extend' | 'end';
export type ConditionSource = 'ai' | 'manual' | 'threshold';
export type ConditionChangeSource = ConditionSource | 'time';

export interface ConditionSettings {
  workspaceId: string;
  enabled: boolean;
  updatePolicy: RoleplayUpdatePolicy;
  /** The AI may propose a condition the catalog lacks; it waits as proposed until reviewed. */
  aiCreates: boolean;
}

export interface ConditionDefinition {
  id: string;
  workspaceId: string;
  key: string;
  name: string;
  /** What it does to the one who has it: the narrator plays it as written. */
  description: string;
  color: string;
  status: ConditionStatus;
  /** Wears off after this much story time. */
  durationMinutes: number | null;
  /** Passes after this much sleep. */
  sleepMinutes: number | null;
  /** Passes after this much rest; sleep counts as rest. */
  restMinutes: number | null;
  /** Anything else that ends it, in words: a treatment, an event. The AI reads it. */
  endsWhen: string;
  /** Starts and ends on its own while this resource is below the percentage. */
  triggerDefinitionId: string | null;
  triggerBelowPercent: number | null;
  position: number;
}

export interface ActiveCondition {
  conditionId: string;
  entityId: string;
  key: string;
  name: string;
  description: string;
  color: string;
  endsWhen: string;
  startedLabel: string;
  timeLeftMinutes: number | null;
  sleepLeftMinutes: number | null;
  restLeftMinutes: number | null;
  cause: string;
  source: ConditionSource;
  startedBy: string | null;
}

export interface ConditionChange {
  id: string;
  workspaceId: string;
  conditionId: string;
  entityId: string;
  kind: ConditionChangeKind;
  durationMinutes: number | null;
  detail: Record<string, unknown>;
  reason: string;
  status: 'pending' | 'applied' | 'rejected';
  source: ConditionChangeSource;
  provenanceId: string | null;
  createdAt: number;
  resolvedAt: number | null;
}

export interface ConditionChangeInput {
  id: string;
  workspaceId: string;
  entityId: string;
  /** The condition's name or key, as the AI or the user gave it. */
  condition: string;
  kind: ConditionChangeKind;
  durationMinutes?: number | null;
  reason?: string;
  source: ConditionChangeSource;
  provenanceId?: string | null;
  startedLabel?: string;
  /** With source ai and kind start: what a condition the catalog lacks does, so it can be proposed. */
  create?: { description?: string };
}

const DEFAULT_SETTINGS = { enabled: true, updatePolicy: 'review' as RoleplayUpdatePolicy, aiCreates: true };

export class RoleplayConditions {
  private readonly roleplay: RoleplaySystem;

  constructor(private readonly db: Database.Database) {
    this.roleplay = new RoleplaySystem(db);
  }

  getSettings(workspaceId: string): ConditionSettings {
    const row = this.db.prepare('SELECT * FROM roleplay_condition_settings WHERE workspace_id = ?').get(workspaceId) as Record<string, unknown> | undefined;
    return {
      workspaceId,
      enabled: row ? Number(row.enabled) === 1 : DEFAULT_SETTINGS.enabled,
      updatePolicy: normalizePolicy(row?.update_policy ?? DEFAULT_SETTINGS.updatePolicy),
      aiCreates: row ? Number(row.ai_creates) === 1 : DEFAULT_SETTINGS.aiCreates
    };
  }

  saveSettings(workspaceId: string, input: Partial<Omit<ConditionSettings, 'workspaceId'>>): ConditionSettings {
    const current = this.getSettings(workspaceId);
    const next = { ...current, ...input };
    this.db.prepare(`
      INSERT INTO roleplay_condition_settings (workspace_id, enabled, update_policy, ai_creates, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET
        enabled = excluded.enabled, update_policy = excluded.update_policy,
        ai_creates = excluded.ai_creates, updated_at = excluded.updated_at
    `).run(workspaceId, next.enabled ? 1 : 0, normalizePolicy(next.updatePolicy), next.aiCreates ? 1 : 0, Date.now());
    return this.getSettings(workspaceId);
  }

  /** The catalog: confirmed conditions, plus proposed ones still waiting on their review. */
  listDefinitions(workspaceId: string): ConditionDefinition[] {
    return (this.db.prepare(`
      SELECT * FROM roleplay_condition_definitions AS definitions
      WHERE workspace_id = ? AND (status = 'confirmed' OR EXISTS (
        SELECT 1 FROM roleplay_condition_changes AS changes
        WHERE changes.workspace_id = definitions.workspace_id AND changes.condition_id = definitions.condition_id
          AND changes.status = 'pending'
      ))
      ORDER BY position, name COLLATE NOCASE
    `).all(workspaceId) as Array<Record<string, unknown>>).map(hydrateDefinition);
  }

  saveDefinition(workspaceId: string, input: Partial<ConditionDefinition> & { name: string }): ConditionDefinition {
    const name = String(input.name || '').trim();
    if (!name) throw new Error('Give it a name.');
    const others = this.allDefinitions(workspaceId);
    requireUniqueName(name, others, input.id, 'a condition');
    const previous = input.id ? others.find(definition => definition.id === input.id) : undefined;
    const key = ruleKey({ name, givenKey: input.key, previous, taken: others.map(definition => definition.key), prefix: 'condition' });
    const triggerDefinitionId = input.triggerDefinitionId ? String(input.triggerDefinitionId) : null;
    const triggerBelowPercent = triggerDefinitionId ? clampPercent(input.triggerBelowPercent) : null;
    if (triggerDefinitionId && !this.roleplay.listDefinitions(workspaceId).some(definition => definition.id === triggerDefinitionId)) {
      throw new Error('That resource no longer exists.');
    }
    const id = input.id || randomUUID();
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO roleplay_condition_definitions (
        workspace_id, condition_id, condition_key, name, description, color, status,
        duration_minutes, sleep_minutes, rest_minutes, ends_when, trigger_definition_id, trigger_below_percent,
        position, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, condition_id) DO UPDATE SET
        condition_key = excluded.condition_key, name = excluded.name, description = excluded.description,
        color = excluded.color, duration_minutes = excluded.duration_minutes, sleep_minutes = excluded.sleep_minutes,
        rest_minutes = excluded.rest_minutes, ends_when = excluded.ends_when,
        trigger_definition_id = excluded.trigger_definition_id, trigger_below_percent = excluded.trigger_below_percent,
        position = excluded.position, updated_at = excluded.updated_at
    `).run(workspaceId, id, key, name, String(input.description || '').trim(), input.color || previous?.color || '#a855f7',
      input.status === 'proposed' ? 'proposed' : previous?.status ?? 'confirmed',
      positiveMinutes(input.durationMinutes), positiveMinutes(input.sleepMinutes), positiveMinutes(input.restMinutes),
      String(input.endsWhen || '').trim(), triggerDefinitionId, triggerBelowPercent,
      Number.isFinite(input.position) ? Number(input.position) : previous?.position ?? others.length, now, now);
    return this.findDefinition(workspaceId, id)!;
  }

  deleteDefinition(workspaceId: string, conditionId: string): void {
    this.db.transaction(() => {
      this.db.prepare(`
        UPDATE roleplay_condition_changes SET status = 'rejected', resolved_at = ?
        WHERE workspace_id = ? AND condition_id = ? AND status = 'pending'
      `).run(Date.now(), workspaceId, conditionId);
      this.db.prepare('DELETE FROM roleplay_conditions WHERE workspace_id = ? AND condition_id = ?').run(workspaceId, conditionId);
      this.db.prepare('DELETE FROM roleplay_condition_definitions WHERE workspace_id = ? AND condition_id = ?').run(workspaceId, conditionId);
    })();
  }

  /** Who has what now, for some people or for everyone. */
  listActive(workspaceId: string, entityIds?: string[]): ActiveCondition[] {
    const wanted = entityIds ? new Set(entityIds) : null;
    return (this.db.prepare(`
      SELECT conditions.*, definitions.condition_key, definitions.name, definitions.description,
        definitions.color, definitions.ends_when
      FROM roleplay_conditions AS conditions
      JOIN roleplay_condition_definitions AS definitions
        ON definitions.workspace_id = conditions.workspace_id AND definitions.condition_id = conditions.condition_id
      WHERE conditions.workspace_id = ?
      ORDER BY definitions.position, definitions.name COLLATE NOCASE
    `).all(workspaceId) as Array<Record<string, unknown>>)
      .map(hydrateActive)
      .filter(condition => !wanted || wanted.has(condition.entityId));
  }

  /**
   * One change to who has a condition. The AI's waits for review under the review policy, and
   * always when it proposes a condition the catalog lacks; a rule of the world or the clock applies at once.
   */
  proposeChange(input: ConditionChangeInput): ConditionChange | null {
    const existing = this.getChange(input.workspaceId, input.id);
    if (existing) return existing;
    const settings = this.getSettings(input.workspaceId);
    if (!settings.enabled) return null;
    if (input.source === 'ai' && settings.updatePolicy === 'manual') return null;
    let definition = findByReference(this.allDefinitions(input.workspaceId), input.condition);
    let created = false;
    if (!definition) {
      if (input.kind !== 'start' || input.source !== 'ai' || !settings.aiCreates || !input.create) return null;
      const name = String(input.condition || '').trim();
      if (!name) return null;
      created = true;
      definition = { name, description: String(input.create.description || '').trim() } as ConditionDefinition;
    } else if (definition.status !== 'confirmed') {
      return null;
    }
    const active = definition.id ? this.activeOf(input.workspaceId, definition.id, input.entityId) : undefined;
    let kind = input.kind;
    if (kind === 'start' && active) {
      // Worse again is the same condition lasting longer, never a second copy.
      if (!positiveMinutes(input.durationMinutes) && !definition.durationMinutes) return null;
      kind = 'extend';
    }
    if ((kind === 'extend' || kind === 'end') && !active) return null;
    const status = input.source === 'ai' && (created || settings.updatePolicy === 'review') ? 'pending' : 'applied';
    this.db.transaction(() => {
      if (created) definition = this.saveDefinition(input.workspaceId, { name: definition!.name, description: definition!.description, status: 'proposed' });
      this.db.prepare(`
        INSERT INTO roleplay_condition_changes (
          workspace_id, change_id, condition_id, entity_id, kind, duration_minutes, detail_json,
          reason, status, source, provenance_id, created_at, resolved_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(input.workspaceId, input.id, definition!.id, input.entityId, kind, positiveMinutes(input.durationMinutes),
        JSON.stringify(input.startedLabel ? { startedLabel: input.startedLabel } : {}),
        String(input.reason || '').trim().slice(0, 240), status, input.source, input.provenanceId ?? null,
        Date.now(), status === 'applied' ? Date.now() : null);
      if (status === 'applied') this.applyChange(input.workspaceId, input.id);
    })();
    return this.getChange(input.workspaceId, input.id) ?? null;
  }

  resolveChange(workspaceId: string, changeId: string, decision: 'approved' | 'rejected'): ConditionChange {
    const change = this.getChange(workspaceId, changeId);
    if (!change) throw new Error('This change no longer exists.');
    if (change.status !== 'pending') return change;
    this.db.transaction(() => {
      if (decision === 'approved') this.applyChange(workspaceId, changeId);
      else this.db.prepare(`
        UPDATE roleplay_condition_changes SET status = 'rejected', resolved_at = ? WHERE workspace_id = ? AND change_id = ?
      `).run(Date.now(), workspaceId, changeId);
    })();
    return this.getChange(workspaceId, changeId)!;
  }

  listChanges(workspaceId: string, entityId?: string): ConditionChange[] {
    return (this.db.prepare(`
      SELECT * FROM roleplay_condition_changes WHERE workspace_id = ?${entityId ? ' AND entity_id = ?' : ''}
      ORDER BY created_at, change_id
    `).all(...(entityId ? [workspaceId, entityId] : [workspaceId])) as Array<Record<string, unknown>>).map(hydrateChange);
  }

  /** A hand edit: starts or ends a condition at once, whatever the policy. */
  setActive(workspaceId: string, entityId: string, conditionId: string, active: boolean, startedLabel = ''): ActiveCondition[] {
    const definition = this.findDefinition(workspaceId, conditionId);
    if (!definition) throw new Error('This condition no longer exists.');
    this.proposeChange({
      id: randomUUID(), workspaceId, entityId, condition: definition.key,
      kind: active ? 'start' : 'end', source: 'manual', reason: '', startedLabel
    });
    return this.listActive(workspaceId, [entityId]);
  }

  /**
   * Story time wears conditions down for everyone who has one; sleep and rest only for who slept
   * or rested. Whatever reaches its end goes, with the reason on the turn. A turn analysed again adds nothing.
   */
  applyTime(workspaceId: string, provenanceId: string, input: { minutes: number; sleepMinutes?: number; restMinutes?: number; restingIds?: string[] }): ConditionChange[] {
    const minutes = Math.max(0, Math.round(Number(input.minutes) || 0));
    if (!minutes || !this.getSettings(workspaceId).enabled) return [];
    const sleep = Math.max(0, Math.round(Number(input.sleepMinutes) || 0));
    const rest = Math.max(0, Math.round(Number(input.restMinutes) || 0));
    const resting = new Set(input.restingIds || []);
    const ended: ConditionChange[] = [];
    for (const row of this.db.prepare('SELECT * FROM roleplay_conditions WHERE workspace_id = ?').all(workspaceId) as Array<Record<string, unknown>>) {
      if (row.time_origin_id === provenanceId) continue;
      const entityId = String(row.entity_id);
      const slept = resting.has(entityId) ? sleep : 0;
      const rested = resting.has(entityId) ? rest + sleep : 0;
      const timeLeft = minus(row.time_left_minutes, minutes);
      const sleepLeft = minus(row.sleep_left_minutes, slept);
      const restLeft = minus(row.rest_left_minutes, rested);
      const reason = timeLeft !== null && timeLeft <= 0
        ? 'Wore off with time'
        : sleepLeft !== null && sleepLeft <= 0
          ? 'Passed with sleep'
          : restLeft !== null && restLeft <= 0
            ? 'Passed with rest'
            : '';
      if (reason) {
        const change = this.proposeChange({
          id: `${provenanceId}:condition-time:${row.condition_id}:${entityId}`,
          workspaceId, entityId, condition: this.findDefinition(workspaceId, String(row.condition_id))?.key ?? '',
          kind: 'end', reason, source: 'time', provenanceId
        });
        if (change) ended.push(change);
        continue;
      }
      this.db.prepare(`
        UPDATE roleplay_conditions SET time_left_minutes = ?, sleep_left_minutes = ?, rest_left_minutes = ?,
          time_origin_id = ?, updated_at = ?
        WHERE workspace_id = ? AND condition_id = ? AND entity_id = ?
      `).run(timeLeft, sleepLeft, restLeft, provenanceId, Date.now(), workspaceId, row.condition_id, entityId);
    }
    return ended;
  }

  /** Conditions tied to a resource start below its line and end above it, without asking anyone. */
  applyThresholds(workspaceId: string, provenanceId: string, entityIds: string[], startedLabel = ''): ConditionChange[] {
    if (!this.getSettings(workspaceId).enabled) return [];
    const definitions = this.listDefinitions(workspaceId)
      .filter(definition => definition.status === 'confirmed' && definition.triggerDefinitionId && definition.triggerBelowPercent !== null);
    if (!definitions.length) return [];
    const changes: ConditionChange[] = [];
    for (const entityId of new Set(entityIds.filter(Boolean))) {
      let resources: ReturnType<RoleplaySystem['listEntityResources']> = [];
      try {
        resources = this.roleplay.listEntityResources(workspaceId, entityId);
      } catch {
        continue;
      }
      for (const definition of definitions) {
        const resource = resources.find(item => item.definitionId === definition.triggerDefinitionId);
        if (!resource || !(resource.maximum > resource.minimum)) continue;
        const percent = ((resource.current - resource.minimum) / (resource.maximum - resource.minimum)) * 100;
        const below = percent < Number(definition.triggerBelowPercent);
        const active = this.activeOf(workspaceId, definition.id, entityId);
        if (below && !active) {
          const change = this.proposeChange({
            id: `${provenanceId}:condition-threshold:${definition.id}:${entityId}`,
            workspaceId, entityId, condition: definition.key, kind: 'start', source: 'threshold', provenanceId,
            reason: `${resource.name} below ${formatPercent(Number(definition.triggerBelowPercent))}`, startedLabel
          });
          if (change) changes.push(change);
        } else if (!below && active?.source === 'threshold') {
          const change = this.proposeChange({
            id: `${provenanceId}:condition-threshold-end:${definition.id}:${entityId}`,
            workspaceId, entityId, condition: definition.key, kind: 'end', source: 'threshold', provenanceId,
            reason: `${resource.name} back above ${formatPercent(Number(definition.triggerBelowPercent))}`
          });
          if (change) changes.push(change);
        }
      }
    }
    return changes;
  }

  findDefinitionByReference(workspaceId: string, reference: unknown): ConditionDefinition | undefined {
    return findByReference(this.allDefinitions(workspaceId), reference);
  }

  private applyChange(workspaceId: string, changeId: string): void {
    const change = this.getChange(workspaceId, changeId)!;
    const definition = this.findDefinition(workspaceId, change.conditionId);
    if (!definition) throw new Error('This condition no longer exists.');
    const active = this.activeOf(workspaceId, change.conditionId, change.entityId);
    const now = Date.now();
    let detail = change.detail;
    if (change.kind === 'start' || change.kind === 'extend') {
      if (definition.status !== 'confirmed') {
        this.db.prepare("UPDATE roleplay_condition_definitions SET status = 'confirmed', updated_at = ? WHERE workspace_id = ? AND condition_id = ?")
          .run(now, workspaceId, definition.id);
      }
      const duration = change.durationMinutes ?? definition.durationMinutes;
      if (active) {
        // Longer, and the sleep or rest it needs starts over.
        const timeLeft = duration === null ? active.timeLeftMinutes : Math.max(0, active.timeLeftMinutes ?? 0) + duration;
        this.db.prepare(`
          UPDATE roleplay_conditions SET time_left_minutes = ?, sleep_left_minutes = ?, rest_left_minutes = ?, updated_at = ?
          WHERE workspace_id = ? AND condition_id = ? AND entity_id = ?
        `).run(timeLeft, definition.sleepMinutes, definition.restMinutes, now, workspaceId, definition.id, change.entityId);
      } else {
        this.db.prepare(`
          INSERT INTO roleplay_conditions (
            workspace_id, condition_id, entity_id, started_label, time_left_minutes, sleep_left_minutes,
            rest_left_minutes, cause, source, started_by, time_origin_id, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(workspaceId, definition.id, change.entityId, String(change.detail.startedLabel || ''), duration,
          definition.sleepMinutes, definition.restMinutes, change.reason,
          change.source === 'time' ? 'manual' : change.source, change.provenanceId, change.provenanceId, now);
      }
    } else if (active) {
      detail = { ...detail, ended: active };
      this.db.prepare('DELETE FROM roleplay_conditions WHERE workspace_id = ? AND condition_id = ? AND entity_id = ?')
        .run(workspaceId, definition.id, change.entityId);
    }
    this.db.prepare(`
      UPDATE roleplay_condition_changes SET status = 'applied', detail_json = ?, resolved_at = ?
      WHERE workspace_id = ? AND change_id = ?
    `).run(JSON.stringify(detail), now, workspaceId, changeId);
  }

  private activeOf(workspaceId: string, conditionId: string, entityId: string): ActiveCondition | undefined {
    return this.listActive(workspaceId, [entityId]).find(condition => condition.conditionId === conditionId);
  }

  private getChange(workspaceId: string, changeId: string): ConditionChange | undefined {
    const row = this.db.prepare('SELECT * FROM roleplay_condition_changes WHERE workspace_id = ? AND change_id = ?')
      .get(workspaceId, changeId) as Record<string, unknown> | undefined;
    return row ? hydrateChange(row) : undefined;
  }

  private findDefinition(workspaceId: string, conditionId: string): ConditionDefinition | undefined {
    const row = this.db.prepare('SELECT * FROM roleplay_condition_definitions WHERE workspace_id = ? AND condition_id = ?')
      .get(workspaceId, conditionId) as Record<string, unknown> | undefined;
    return row ? hydrateDefinition(row) : undefined;
  }

  /** Every stored condition, hidden proposals included, so names and keys stay unique among all of them. */
  private allDefinitions(workspaceId: string): ConditionDefinition[] {
    return (this.db.prepare('SELECT * FROM roleplay_condition_definitions WHERE workspace_id = ?').all(workspaceId) as Array<Record<string, unknown>>)
      .map(hydrateDefinition);
  }
}

/** How a condition ends, in a few words, for the narrator and the sheet. */
export function describeConditionEnd(condition: Pick<ConditionDefinition, 'durationMinutes' | 'sleepMinutes' | 'restMinutes' | 'endsWhen'> & { timeLeftMinutes?: number | null; sleepLeftMinutes?: number | null; restLeftMinutes?: number | null }): string {
  const time = condition.timeLeftMinutes ?? condition.durationMinutes;
  const sleep = condition.sleepLeftMinutes ?? condition.sleepMinutes;
  const rest = condition.restLeftMinutes ?? condition.restMinutes;
  return [
    time ? `wears off in ${formatMinutes(time)}` : '',
    sleep ? `passes after ${formatMinutes(sleep)} of sleep` : '',
    rest ? `passes after ${formatMinutes(rest)} of rest` : '',
    condition.endsWhen ? `ends ${condition.endsWhen.replace(/^ends\s+/i, '')}` : ''
  ].filter(Boolean).join('; ');
}

function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return [hours ? `${hours} h` : '', rest ? `${rest} min` : ''].filter(Boolean).join(' ') || '0 min';
}

function formatPercent(value: number): string {
  return `${Math.round(value * 10) / 10}%`;
}

function minus(value: unknown, amount: number): number | null {
  if (value === null || value === undefined) return null;
  return Math.round(Number(value)) - amount;
}

function positiveMinutes(value: unknown): number | null {
  const number = Math.round(Number(value));
  return Number.isFinite(number) && number > 0 ? number : null;
}

function clampPercent(value: unknown): number {
  const number = Number(value);
  if (!Number.isFinite(number)) return 25;
  return Math.min(100, Math.max(0, number));
}

function normalizePolicy(value: unknown): RoleplayUpdatePolicy {
  return value === 'manual' || value === 'automatic' ? value : 'review';
}

function nullableNumber(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function hydrateDefinition(row: Record<string, unknown>): ConditionDefinition {
  return {
    id: String(row.condition_id),
    workspaceId: String(row.workspace_id),
    key: String(row.condition_key),
    name: String(row.name),
    description: String(row.description ?? ''),
    color: String(row.color ?? '#a855f7'),
    status: row.status === 'proposed' ? 'proposed' : 'confirmed',
    durationMinutes: nullableNumber(row.duration_minutes),
    sleepMinutes: nullableNumber(row.sleep_minutes),
    restMinutes: nullableNumber(row.rest_minutes),
    endsWhen: String(row.ends_when ?? ''),
    triggerDefinitionId: row.trigger_definition_id ? String(row.trigger_definition_id) : null,
    triggerBelowPercent: nullableNumber(row.trigger_below_percent),
    position: Number(row.position ?? 0)
  };
}

function hydrateActive(row: Record<string, unknown>): ActiveCondition {
  return {
    conditionId: String(row.condition_id),
    entityId: String(row.entity_id),
    key: String(row.condition_key),
    name: String(row.name),
    description: String(row.description ?? ''),
    color: String(row.color ?? '#a855f7'),
    endsWhen: String(row.ends_when ?? ''),
    startedLabel: String(row.started_label ?? ''),
    timeLeftMinutes: nullableNumber(row.time_left_minutes),
    sleepLeftMinutes: nullableNumber(row.sleep_left_minutes),
    restLeftMinutes: nullableNumber(row.rest_left_minutes),
    cause: String(row.cause ?? ''),
    source: row.source === 'ai' || row.source === 'threshold' ? row.source : 'manual',
    startedBy: row.started_by ? String(row.started_by) : null
  };
}

function hydrateChange(row: Record<string, unknown>): ConditionChange {
  let detail: Record<string, unknown> = {};
  try {
    const parsed = JSON.parse(String(row.detail_json || '{}'));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) detail = parsed;
  } catch {
    detail = {};
  }
  return {
    id: String(row.change_id),
    workspaceId: String(row.workspace_id),
    conditionId: String(row.condition_id),
    entityId: String(row.entity_id),
    kind: row.kind === 'extend' || row.kind === 'end' ? row.kind : 'start',
    durationMinutes: nullableNumber(row.duration_minutes),
    detail,
    reason: String(row.reason ?? ''),
    status: row.status === 'pending' || row.status === 'rejected' ? row.status : 'applied',
    source: (['ai', 'manual', 'threshold', 'time'].includes(String(row.source)) ? row.source : 'manual') as ConditionChangeSource,
    provenanceId: row.provenance_id ? String(row.provenance_id) : null,
    createdAt: Number(row.created_at),
    resolvedAt: nullableNumber(row.resolved_at)
  };
}
