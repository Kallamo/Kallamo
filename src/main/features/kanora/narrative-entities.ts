import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';

export type NarrativeEntityType = 'Characters' | 'Creatures' | 'Locations' | 'Items';
export type NarrativeEntityDecision = 'new' | 'ambiguous' | 'conflicting';

export interface NarrativeEntityProposal {
  referenceId: string;
  name: string;
  type: NarrativeEntityType;
  aliases?: string[];
  description: string;
  excerpt: string;
  confidence: number;
  decision: NarrativeEntityDecision;
  identityEstablished: boolean;
  reason?: string;
  itemNature?: 'unique' | 'type';
  scenePresence?: 'participant' | 'observer' | 'nearby' | 'absent';
}

export interface NarrativeEntityIdentityUpdate {
  referenceId: string;
  entityId: string;
  canonicalName?: string;
  aliases?: string[];
  excerpt: string;
  confidence: number;
  identityEstablished: boolean;
  reason?: string;
}

interface StoredNarrativeEntityIdentityUpdate extends NarrativeEntityIdentityUpdate {
  previousCanonicalName: string;
  previousAliases: string[];
}

export interface NarrativeEntityChange {
  id: string;
  entityId: string | null;
  createdEntity: boolean;
  proposal: NarrativeEntityProposal;
  identityUpdate?: StoredNarrativeEntityIdentityUpdate;
  status: 'pending' | 'applied' | 'rejected' | 'conflicting';
  provenanceId: string;
  createdAt: number;
  resolvedAt: number | null;
}

interface EntityRow {
  id: string;
  type: string;
  canonicalName: string;
  aliases: string;
  data?: string;
}

const AUTO_TYPES = new Set<NarrativeEntityType>(['Characters', 'Creatures']);
const AUTO_CONFIDENCE = 0.9;

export class NarrativeEntitySystem {
  constructor(private readonly db: Database.Database) {}

  resolveOrPropose(workspaceId: string, provenanceId: string, input: NarrativeEntityProposal): NarrativeEntityChange {
    const proposal = normalizeProposal(input);
    const changeId = `${provenanceId}:entity:${proposal.referenceId}`;
    const previous = this.getChange(workspaceId, changeId);
    if (previous) return previous;

    const match = proposal.identityEstablished
      ? this.findExactMatch(workspaceId, proposal)
      : undefined;
    if (match) return this.saveChange(workspaceId, changeId, match.id, false, proposal, 'applied', provenanceId);

    const canApply = proposal.decision === 'new'
      && AUTO_TYPES.has(proposal.type)
      && proposal.identityEstablished
      && proposal.confidence >= AUTO_CONFIDENCE;
    if (!canApply) {
      const status = proposal.decision === 'conflicting' ? 'conflicting' : 'pending';
      return this.saveChange(workspaceId, changeId, null, false, proposal, status, provenanceId);
    }

    const entityId = randomUUID();
    this.insertEntity(workspaceId, entityId, proposal, provenanceId);
    return this.saveChange(workspaceId, changeId, entityId, true, proposal, 'applied', provenanceId);
  }

  resolveIdentityUpdate(
    workspaceId: string,
    provenanceId: string,
    input: NarrativeEntityIdentityUpdate,
    updatePolicy: 'manual' | 'review' | 'automatic'
  ): NarrativeEntityChange | undefined {
    if (updatePolicy === 'manual') return undefined;
    const update = normalizeIdentityUpdate(input);
    const changeId = `${provenanceId}:entity-identity:${update.referenceId}`;
    const previous = this.getChange(workspaceId, changeId);
    if (previous) return previous;

    const entity = this.getIdentityTarget(workspaceId, update.entityId);
    if (!entity || !AUTO_TYPES.has(entity.type as NarrativeEntityType)) return undefined;
    if (entity.type === 'Creatures' && parseObject(entity.data).scope === 'group') return undefined;
    if (!update.identityEstablished) return undefined;

    const desiredCanonicalName = String(update.canonicalName ?? '').trim();
    const canonicalChanged = Boolean(desiredCanonicalName)
      && normalizeIdentity(desiredCanonicalName) !== normalizeIdentity(entity.canonicalName);
    const existingAliases = parseAliases(entity.aliases);
    const aliases = uniqueIdentityValues(update.aliases ?? [])
      .filter(alias => normalizeIdentity(alias) !== normalizeIdentity(desiredCanonicalName || entity.canonicalName))
      .filter(alias => ![entity.canonicalName, ...existingAliases].some(existing => normalizeIdentity(existing) === normalizeIdentity(alias)));
    if (!canonicalChanged && !aliases.length) return undefined;

    const requestedNames = [canonicalChanged ? desiredCanonicalName : '', ...aliases].filter(Boolean);
    const conflict = this.findIdentityCollision(workspaceId, entity.id, requestedNames);
    if (updatePolicy === 'automatic' && conflict) return undefined;
    const storedUpdate: StoredNarrativeEntityIdentityUpdate = {
      ...update,
      ...(canonicalChanged ? { canonicalName: desiredCanonicalName } : {}),
      aliases,
      previousCanonicalName: entity.canonicalName,
      previousAliases: existingAliases,
      ...(conflict ? { reason: update.reason || `Identity overlaps with ${conflict.canonicalName}.` } : {})
    };
    const proposal = identityUpdateProposal(entity, storedUpdate, Boolean(conflict));
    const canApply = updatePolicy === 'automatic'
      && update.confidence >= AUTO_CONFIDENCE
      && !conflict;
    if (canApply) this.applyIdentityUpdate(workspaceId, storedUpdate);
    return this.saveChange(
      workspaceId,
      changeId,
      entity.id,
      false,
      proposal,
      canApply ? 'applied' : conflict ? 'conflicting' : 'pending',
      provenanceId,
      storedUpdate
    );
  }

  listChanges(workspaceId: string): NarrativeEntityChange[] {
    return (this.db.prepare(`
      SELECT changes.* FROM roleplay_entity_changes changes
      LEFT JOIN kanora_narrative_origin_lifecycle lifecycle
        ON lifecycle.workspace_id = changes.workspace_id AND lifecycle.origin_id = changes.provenance_id
      WHERE changes.workspace_id = ? AND COALESCE(lifecycle.status, 'active') = 'active'
      ORDER BY changes.created_at, changes.change_id
    `).all(workspaceId) as Array<Record<string, unknown>>).map(hydrateChange);
  }

  resolveChange(workspaceId: string, changeId: string, decision: 'approved' | 'rejected'): NarrativeEntityChange {
    const change = this.getChange(workspaceId, changeId);
    if (!change) throw new Error('Narrative entity change was not found.');
    if (change.status === 'applied' || change.status === 'rejected') return change;

    if (decision === 'rejected') {
      this.updateStatus(workspaceId, changeId, 'rejected', null);
      return this.getChange(workspaceId, changeId)!;
    }

    if (change.identityUpdate) {
      this.applyIdentityUpdate(workspaceId, change.identityUpdate);
      this.updateStatus(workspaceId, changeId, 'applied', change.identityUpdate.entityId);
      return this.getChange(workspaceId, changeId)!;
    }

    const match = this.findExactMatch(workspaceId, change.proposal);
    const entityId = match?.id ?? randomUUID();
    if (!match) this.insertEntity(workspaceId, entityId, change.proposal, change.provenanceId);
    this.updateStatus(workspaceId, changeId, 'applied', entityId, !match);
    return this.getChange(workspaceId, changeId)!;
  }

  markOrigin(workspaceId: string, originId: string, status: 'active' | 'superseded' | 'deleted', replacementOriginId?: string): void {
    this.db.prepare(`
      INSERT INTO kanora_narrative_origin_lifecycle
        (workspace_id, origin_id, status, replacement_origin_id, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, origin_id) DO UPDATE SET
        status = excluded.status,
        replacement_origin_id = excluded.replacement_origin_id,
        updated_at = excluded.updated_at
    `).run(workspaceId, originId, status, replacementOriginId ?? null, Date.now());
    const entityStatus = status === 'active' ? 'confirmed' : 'proposed';
    this.db.prepare(`
      UPDATE entities SET status = ?, last_modified = ?
      WHERE workspaceId = ? AND id IN (
        SELECT entity_id FROM roleplay_entity_changes
        WHERE workspace_id = ? AND provenance_id = ? AND entity_id IS NOT NULL AND created_entity = 1
      )
    `).run(entityStatus, Date.now(), workspaceId, workspaceId, originId);
    if (status !== 'active') {
      for (const table of ['roleplay_resource_changes', 'roleplay_scene_changes', 'roleplay_inventory_changes']) {
        this.db.prepare(`UPDATE ${table} SET status = 'rejected', resolved_at = ? WHERE workspace_id = ? AND provenance_id = ? AND status = 'pending'`)
          .run(Date.now(), workspaceId, originId);
      }
      this.db.prepare(`
        UPDATE roleplay_entity_changes SET status = 'rejected', resolved_at = ?
        WHERE workspace_id = ? AND provenance_id = ? AND status IN ('pending', 'conflicting')
      `).run(Date.now(), workspaceId, originId);
    }
  }

  captureTurnSnapshot(workspaceId: string, originId: string): void {
    const existing = this.db.prepare('SELECT 1 FROM roleplay_turn_snapshots WHERE workspace_id = ? AND origin_id = ?').get(workspaceId, originId);
    if (existing) return;
    const snapshot = {
      settings: this.rows('roleplay_workspace_settings', workspaceId),
      scenes: this.rows('kanora_scenes', workspaceId),
      participants: this.rows('kanora_scene_participants', workspaceId),
      observers: this.rows('kanora_scene_possible_observers', workspaceId),
      objects: this.rows('roleplay_scene_objects', workspaceId),
      resources: this.rows('roleplay_resource_values', workspaceId),
      timeState: this.hasTable('roleplay_time_state') ? this.rows('roleplay_time_state', workspaceId) : [],
      timeAdvances: this.hasTable('roleplay_time_advances') ? this.rows('roleplay_time_advances', workspaceId) : [],
      links: (this.db.prepare(`
        SELECT * FROM entity_links WHERE workspaceId = ? AND relType IN ('owned_by', 'carried_by', 'located_in', 'related_to')
      `).all(workspaceId) as Array<Record<string, unknown>>),
      entityIdentities: (this.db.prepare(`
        SELECT id, canonicalName, aliases, last_modified FROM entities WHERE workspaceId = ?
      `).all(workspaceId) as Array<Record<string, unknown>>)
    };
    this.db.prepare(`
      INSERT INTO roleplay_turn_snapshots (workspace_id, origin_id, snapshot_json, created_at)
      VALUES (?, ?, ?, ?)
    `).run(workspaceId, originId, JSON.stringify(snapshot), Date.now());
  }

  invalidateOrigin(workspaceId: string, originId: string, status: 'superseded' | 'deleted'): { restored: boolean } {
    const hasSnapshot = Boolean(this.db.prepare(`
      SELECT 1 FROM roleplay_turn_snapshots WHERE workspace_id = ? AND origin_id = ?
    `).get(workspaceId, originId));
    const latest = this.db.prepare(`
      SELECT origin_id FROM kanora_narrative_state_jobs
      WHERE workspace_id = ? AND status IN ('completed', 'skipped')
        AND NOT EXISTS (
          SELECT 1 FROM kanora_narrative_origin_lifecycle lifecycle
          WHERE lifecycle.workspace_id = kanora_narrative_state_jobs.workspace_id
            AND lifecycle.origin_id = kanora_narrative_state_jobs.origin_id
            AND lifecycle.status != 'active'
        )
      ORDER BY updated_at DESC LIMIT 1
    `).get(workspaceId) as { origin_id: string } | undefined;
    if (hasSnapshot && latest && latest.origin_id !== originId) {
      throw new Error('A narrative turn can only be removed after its later turns have been reverted.');
    }
    const restored = latest?.origin_id === originId && this.restoreTurnSnapshot(workspaceId, originId);
    this.markOrigin(workspaceId, originId, status);
    if (this.hasTable('kanora_narrative_context_manifests')) {
      this.db.prepare(`
        UPDATE kanora_narrative_context_manifests
        SET status = 'invalidated', updated_at = ?
        WHERE workspace_id = ? AND origin_id = ?
      `).run(Date.now(), workspaceId, originId);
    }
    return { restored };
  }

  private restoreTurnSnapshot(workspaceId: string, originId: string): boolean {
    const row = this.db.prepare('SELECT snapshot_json FROM roleplay_turn_snapshots WHERE workspace_id = ? AND origin_id = ?')
      .get(workspaceId, originId) as { snapshot_json: string } | undefined;
    if (!row) return false;
    const snapshot = JSON.parse(row.snapshot_json) as Record<string, Array<Record<string, unknown>>>;
    this.db.transaction(() => {
      this.replaceRows('roleplay_workspace_settings', workspaceId, snapshot.settings ?? []);
      this.db.prepare('DELETE FROM kanora_scene_participants WHERE workspace_id = ?').run(workspaceId);
      this.db.prepare('DELETE FROM kanora_scene_possible_observers WHERE workspace_id = ?').run(workspaceId);
      this.db.prepare('DELETE FROM roleplay_scene_objects WHERE workspace_id = ?').run(workspaceId);
      this.db.prepare('DELETE FROM kanora_scenes WHERE workspace_id = ?').run(workspaceId);
      this.insertRows('kanora_scenes', snapshot.scenes ?? []);
      this.insertRows('kanora_scene_participants', snapshot.participants ?? []);
      this.insertRows('kanora_scene_possible_observers', snapshot.observers ?? []);
      this.insertRows('roleplay_scene_objects', snapshot.objects ?? []);
      this.replaceRows('roleplay_resource_values', workspaceId, snapshot.resources ?? []);
      if (this.hasTable('roleplay_time_state')) {
        this.replaceRows('roleplay_time_state', workspaceId, snapshot.timeState ?? []);
      }
      if (this.hasTable('roleplay_time_advances')) {
        this.replaceRows('roleplay_time_advances', workspaceId, snapshot.timeAdvances ?? []);
      }
      this.db.prepare("DELETE FROM entity_links WHERE workspaceId = ? AND relType IN ('owned_by', 'carried_by', 'located_in', 'related_to')").run(workspaceId);
      this.insertRows('entity_links', snapshot.links ?? []);
      for (const identity of snapshot.entityIdentities ?? []) {
        this.db.prepare(`
          UPDATE entities SET canonicalName = ?, aliases = ?, last_modified = ?
          WHERE workspaceId = ? AND id = ?
        `).run(identity.canonicalName, identity.aliases, identity.last_modified, workspaceId, identity.id);
      }
    })();
    return true;
  }

  private rows(table: string, workspaceId: string): Array<Record<string, unknown>> {
    return this.db.prepare(`SELECT * FROM ${table} WHERE workspace_id = ?`).all(workspaceId) as Array<Record<string, unknown>>;
  }

  private hasTable(table: string): boolean {
    return Boolean(this.db.prepare(
      "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?"
    ).get(table));
  }

  private replaceRows(table: string, workspaceId: string, rows: Array<Record<string, unknown>>): void {
    this.db.prepare(`DELETE FROM ${table} WHERE workspace_id = ?`).run(workspaceId);
    this.insertRows(table, rows);
  }

  private insertRows(table: string, rows: Array<Record<string, unknown>>): void {
    for (const row of rows) {
      const columns = Object.keys(row);
      if (!columns.length) continue;
      const placeholders = columns.map(() => '?').join(', ');
      this.db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders})`).run(...columns.map(column => row[column]));
    }
  }

  private findExactMatch(workspaceId: string, proposal: NarrativeEntityProposal): EntityRow | undefined {
    const wanted = new Set([proposal.name, ...(proposal.aliases ?? [])].map(normalizeIdentity).filter(Boolean));
    const rows = this.db.prepare(`
      SELECT id, type, canonicalName, aliases FROM entities
      WHERE workspaceId = ? AND status != 'proposed'
    `).all(workspaceId) as EntityRow[];
    return rows.find(row => {
      const names = [row.canonicalName, ...parseAliases(row.aliases)].map(normalizeIdentity);
      return names.some(name => wanted.has(name));
    });
  }

  private getIdentityTarget(workspaceId: string, entityId: string): EntityRow | undefined {
    return this.db.prepare(`
      SELECT id, type, canonicalName, aliases, data FROM entities
      WHERE workspaceId = ? AND id = ? AND status != 'proposed'
    `).get(workspaceId, entityId) as EntityRow | undefined;
  }

  private findIdentityCollision(workspaceId: string, entityId: string, names: string[]): EntityRow | undefined {
    const wanted = new Set(names.map(normalizeIdentity).filter(Boolean));
    if (!wanted.size) return undefined;
    const rows = this.db.prepare(`
      SELECT id, type, canonicalName, aliases FROM entities
      WHERE workspaceId = ? AND id != ? AND status != 'proposed'
    `).all(workspaceId, entityId) as EntityRow[];
    return rows.find(row => [row.canonicalName, ...parseAliases(row.aliases)]
      .some(name => wanted.has(normalizeIdentity(name))));
  }

  private applyIdentityUpdate(workspaceId: string, update: StoredNarrativeEntityIdentityUpdate): void {
    const current = this.getIdentityTarget(workspaceId, update.entityId);
    if (!current) throw new Error('Narrative entity identity target was not found.');
    const canonicalName = String(update.canonicalName ?? '').trim() || current.canonicalName;
    const renamed = normalizeIdentity(canonicalName) !== normalizeIdentity(current.canonicalName);
    const aliases = uniqueIdentityValues([
      ...parseAliases(current.aliases),
      ...(update.aliases ?? []),
      ...(renamed ? [current.canonicalName] : [])
    ]).filter(alias => normalizeIdentity(alias) !== normalizeIdentity(canonicalName));
    this.db.prepare(`
      UPDATE entities SET canonicalName = ?, aliases = ?, last_modified = ?
      WHERE workspaceId = ? AND id = ?
    `).run(canonicalName, JSON.stringify(aliases), Date.now(), workspaceId, current.id);
  }

  private insertEntity(workspaceId: string, entityId: string, proposal: NarrativeEntityProposal, provenanceId: string): void {
    const now = Date.now();
    const data = {
      ...(proposal.type === 'Creatures' ? { scope: 'individual' } : {}),
      ...(proposal.type === 'Items' ? { itemNature: proposal.itemNature ?? 'unique' } : {}),
      narrativeOrigin: { originId: provenanceId, excerpt: proposal.excerpt },
      needsEnrichment: true
    };
    this.db.prepare(`
      INSERT INTO entities
        (id, workspaceId, type, canonicalName, aliases, lore, loreDocumentId, data, status, createdAt, last_modified)
      VALUES (?, ?, ?, ?, ?, '', NULL, ?, 'confirmed', ?, ?)
    `).run(entityId, workspaceId, proposal.type, proposal.name, JSON.stringify(proposal.aliases ?? []), JSON.stringify(data), now, now);
  }

  private saveChange(
    workspaceId: string,
    changeId: string,
    entityId: string | null,
    createdEntity: boolean,
    proposal: NarrativeEntityProposal,
    status: NarrativeEntityChange['status'],
    provenanceId: string,
    identityUpdate?: StoredNarrativeEntityIdentityUpdate
  ): NarrativeEntityChange {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO roleplay_entity_changes
        (workspace_id, change_id, entity_id, created_entity, payload_json, status, provenance_id, created_at, resolved_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(workspaceId, changeId, entityId, createdEntity ? 1 : 0, JSON.stringify(identityUpdate ? { ...proposal, changeKind: 'identity-update', identityUpdate } : proposal), status, provenanceId, now, status === 'pending' || status === 'conflicting' ? null : now);
    return this.getChange(workspaceId, changeId)!;
  }

  private updateStatus(workspaceId: string, changeId: string, status: NarrativeEntityChange['status'], entityId: string | null, createdEntity = false): void {
    this.db.prepare(`
      UPDATE roleplay_entity_changes
      SET status = ?, entity_id = COALESCE(?, entity_id), created_entity = ?, resolved_at = ?
      WHERE workspace_id = ? AND change_id = ?
    `).run(status, entityId, createdEntity ? 1 : 0, Date.now(), workspaceId, changeId);
  }

  private getChange(workspaceId: string, changeId: string): NarrativeEntityChange | undefined {
    const row = this.db.prepare(`
      SELECT * FROM roleplay_entity_changes WHERE workspace_id = ? AND change_id = ?
    `).get(workspaceId, changeId) as Record<string, unknown> | undefined;
    return row ? hydrateChange(row) : undefined;
  }
}

function normalizeProposal(input: NarrativeEntityProposal): NarrativeEntityProposal {
  const referenceId = String(input.referenceId ?? '').trim();
  const name = String(input.name ?? '').trim();
  if (!referenceId || !name) throw new Error('Narrative entity reference and name are required.');
  if (!['Characters', 'Creatures', 'Locations', 'Items'].includes(input.type)) throw new Error('Narrative entity type is not supported.');
  return {
    referenceId,
    name,
    type: input.type,
    aliases: [...new Set((input.aliases ?? []).map(value => String(value).trim()).filter(Boolean))],
    description: String(input.description ?? '').trim(),
    excerpt: String(input.excerpt ?? '').trim().slice(0, 500),
    confidence: Math.max(0, Math.min(1, Number(input.confidence) || 0)),
    decision: ['new', 'ambiguous', 'conflicting'].includes(input.decision) ? input.decision : 'ambiguous',
    identityEstablished: input.identityEstablished === true,
    reason: String(input.reason ?? '').trim(),
    ...(
      input.type === 'Characters' || input.type === 'Creatures'
        ? { scenePresence: ['participant', 'observer', 'nearby', 'absent'].includes(String(input.scenePresence))
            ? input.scenePresence
            : 'absent' }
        : {}
    ),
    ...(input.type === 'Items' ? { itemNature: input.itemNature === 'type' ? 'type' : 'unique' } : {})
  };
}

function normalizeIdentityUpdate(input: NarrativeEntityIdentityUpdate): NarrativeEntityIdentityUpdate {
  const referenceId = String(input.referenceId ?? '').trim();
  const entityId = String(input.entityId ?? '').trim();
  if (!referenceId || !entityId) throw new Error('Narrative identity update reference and entity are required.');
  return {
    referenceId,
    entityId,
    canonicalName: String(input.canonicalName ?? '').trim() || undefined,
    aliases: uniqueIdentityValues(input.aliases ?? []),
    excerpt: String(input.excerpt ?? '').trim().slice(0, 500),
    confidence: Math.max(0, Math.min(1, Number(input.confidence) || 0)),
    identityEstablished: input.identityEstablished === true,
    reason: String(input.reason ?? '').trim()
  };
}

function identityUpdateProposal(entity: EntityRow, update: StoredNarrativeEntityIdentityUpdate, conflicting: boolean): NarrativeEntityProposal {
  const canonicalName = update.canonicalName || entity.canonicalName;
  return {
    referenceId: update.referenceId,
    name: canonicalName,
    type: entity.type as NarrativeEntityType,
    aliases: update.aliases ?? [],
    description: update.reason || (update.canonicalName
      ? `${entity.canonicalName} is identified as ${canonicalName}.`
      : `${entity.canonicalName} gains a new alias.`),
    excerpt: update.excerpt,
    confidence: update.confidence,
    decision: conflicting ? 'conflicting' : 'new',
    identityEstablished: update.identityEstablished,
    reason: update.reason
  };
}

function hydrateChange(row: Record<string, unknown>): NarrativeEntityChange {
  const payload = JSON.parse(String(row.payload_json)) as NarrativeEntityProposal & {
    changeKind?: string;
    identityUpdate?: StoredNarrativeEntityIdentityUpdate;
  };
  return {
    id: String(row.change_id),
    entityId: row.entity_id ? String(row.entity_id) : null,
    createdEntity: Boolean(row.created_entity),
    proposal: payload,
    ...(payload.changeKind === 'identity-update' && payload.identityUpdate ? { identityUpdate: payload.identityUpdate } : {}),
    status: String(row.status) as NarrativeEntityChange['status'],
    provenanceId: String(row.provenance_id),
    createdAt: Number(row.created_at),
    resolvedAt: row.resolved_at === null ? null : Number(row.resolved_at)
  };
}

function parseAliases(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseObject(value?: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function uniqueIdentityValues(values: unknown[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const text = String(value ?? '').trim();
    const normalized = normalizeIdentity(text);
    if (!text || !normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    result.push(text);
  }
  return result;
}

function normalizeIdentity(value: string): string {
  return String(value ?? '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
