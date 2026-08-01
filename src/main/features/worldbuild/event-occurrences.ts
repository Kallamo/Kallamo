import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { NarrativeEventLedgerRecord } from '../../../kanora/ledger';
import { NarrativeStateSystem, type ExtractedNarrativeEvent } from '../kanora/narrative-state';
import { RoleplaySystem, type RoleplayInventoryPatch } from '../kanora/roleplay-system';

type MemoryAccessibility = 'available' | 'suppressed' | 'inaccessible';

export interface EventOccurrenceParticipant {
  entityId: string;
  role: string;
  remember: boolean;
  memoryAccessibility: MemoryAccessibility;
  audienceType: 'all-members' | 'selected-members';
  selectedMemberIds: string[];
}

export interface ManualEventOccurrenceInput {
  workspaceId: string;
  eventEntityId: string;
  title: string;
  summary: string;
  startDate?: Record<string, unknown> | null;
  endDate?: Record<string, unknown> | null;
  participants: EventOccurrenceParticipant[];
  locationIds: string[];
  relatedEntityIds: string[];
  resourceChanges?: Array<{ definitionId: string; entityId: string; value: number }>;
  inventoryChanges?: RoleplayInventoryPatch[];
  relationshipChanges?: Array<{
    sourceEntityId: string;
    targetEntityId: string;
    dimension: string;
    title?: string;
    value: number;
    description?: string;
  }>;
}

export interface WorldbuildEventOccurrence {
  id: string;
  workspaceId: string;
  eventEntityId: string;
  narrativeEventId: string;
  title: string;
  summary: string;
  startDate: Record<string, unknown> | null;
  endDate: Record<string, unknown> | null;
  participants: EventOccurrenceParticipant[];
  locationIds: string[];
  relatedEntityIds: string[];
  consequences: Record<string, unknown>;
  source: 'user' | 'narrative-state';
  originId: string | null;
  status: 'proposed' | 'approved' | 'rejected';
  createdAt: number;
  updatedAt: number;
}

interface OccurrenceRow {
  workspace_id: string;
  occurrence_id: string;
  event_entity_id: string;
  narrative_event_id: string;
  title: string;
  summary: string;
  start_date_json: string | null;
  end_date_json: string | null;
  participants_json: string;
  location_ids_json: string;
  related_entity_ids_json: string;
  consequences_json: string;
  source: 'user' | 'narrative-state';
  origin_id: string | null;
  status: 'proposed' | 'approved' | 'rejected';
  created_at: number;
  updated_at: number;
}

export class EventOccurrenceService {
  private readonly narrativeState: NarrativeStateSystem;
  private readonly roleplay: RoleplaySystem;

  constructor(private readonly db: Database.Database) {
    this.narrativeState = new NarrativeStateSystem(db);
    this.roleplay = new RoleplaySystem(db);
  }

  list(workspaceId: string, eventEntityId: string): WorldbuildEventOccurrence[] {
    this.requireEventEntity(workspaceId, eventEntityId);
    const rows = this.db.prepare(`
      SELECT occurrences.*, events.status
      FROM worldbuild_event_occurrences occurrences
      JOIN kanora_narrative_events events
        ON events.workspace_id = occurrences.workspace_id
        AND events.event_id = occurrences.narrative_event_id
      WHERE occurrences.workspace_id = ? AND occurrences.event_entity_id = ?
        AND occurrences.archived = 0
      ORDER BY COALESCE(occurrences.start_date_json, ''), occurrences.created_at, occurrences.occurrence_id
    `).all(workspaceId, eventEntityId) as OccurrenceRow[];
    return rows.map(hydrateOccurrence).sort(compareOccurrences);
  }

  createManual(input: ManualEventOccurrenceInput): WorldbuildEventOccurrence {
    const workspaceId = requireText(input.workspaceId, 'workspaceId');
    const eventEntity = this.requireEventEntity(workspaceId, input.eventEntityId);
    const title = requireText(input.title, 'title');
    const summary = requireText(input.summary, 'summary');
    const occurrenceId = randomUUID();
    const originId = `worldbuild-occurrence:${occurrenceId}`;
    const participants = this.normalizeParticipants(workspaceId, input.participants ?? []);
    const locationIds = this.normalizeEntityIds(workspaceId, input.locationIds ?? [], ['Locations']);
    const relatedEntityIds = this.normalizeEntityIds(workspaceId, input.relatedEntityIds ?? []);
    const participantIds = unique([eventEntity.id, ...participants.map(participant => participant.entityId)]);
    const memoryRelatedIds = unique([eventEntity.id, ...participantIds, ...locationIds, ...relatedEntityIds]);
    const event: ExtractedNarrativeEvent = {
      type: 'custom',
      description: `${title}: ${summary}`,
      excerpt: summary,
      participantIds,
      participants: [
        { entityId: eventEntity.id, role: 'recurring event' },
        ...participants.map(participant => ({ entityId: participant.entityId, role: participant.role }))
      ],
      worldbuildEventId: eventEntity.id,
      occurrenceTitle: title,
      worldDate: input.startDate ?? undefined,
      confidence: 1,
      operations: [
        {
          type: 'fact',
          proposition: {
            subjectId: eventEntity.id,
            predicate: 'recorded-occurrence',
            object: { occurrenceId, title, summary, startDate: input.startDate ?? null, endDate: input.endDate ?? null }
          },
          confidence: 1
        },
        ...participants.filter(participant => participant.remember).map(participant => ({
          type: 'memory' as const,
          subjectId: participant.entityId,
          summary: `${title}: ${summary}`,
          salience: 1,
          accessibility: participant.memoryAccessibility,
          relatedEntityIds: memoryRelatedIds
        })),
        ...(input.relationshipChanges ?? []).map(change => ({
          type: 'relationship' as const,
          sourceEntityId: change.sourceEntityId,
          targetEntityId: change.targetEntityId,
          dimension: change.dimension,
          title: change.title,
          value: Number(change.value),
          description: change.description
        }))
      ]
    };
    const allowedEntityIds = new Set(this.listConfirmedEntityIds(workspaceId));
    const consequences = {
      resources: input.resourceChanges ?? [],
      inventory: input.inventoryChanges ?? [],
      relationships: input.relationshipChanges ?? []
    };

    return this.db.transaction(() => {
      const result = this.narrativeState.createEvent({
        workspaceId,
        originId,
        locationId: locationIds[0],
        interpreterId: 'worldbuild-event-occurrence',
        event,
        allowedEntityIds,
        originType: 'world-action',
        promptVersion: 'worldbuild-event-occurrence-v1',
        updatePolicy: 'automatic',
        provenanceInterpreter: 'user'
      });
      if (!result.record) throw new Error(`Could not record the occurrence: ${result.skipped || 'unknown reason'}.`);
      this.applyManualConsequences(workspaceId, occurrenceId, input);
      this.persistMapping({
        workspaceId,
        occurrenceId,
        eventEntityId: eventEntity.id,
        record: result.record,
        title,
        summary,
        startDate: input.startDate ?? null,
        endDate: input.endDate ?? null,
        participants,
        locationIds,
        relatedEntityIds,
        consequences,
        source: 'user',
        originId
      });
      return this.requireOccurrence(workspaceId, occurrenceId);
    })();
  }

  linkNarrative(input: {
    workspaceId: string;
    originId: string;
    record: NarrativeEventLedgerRecord;
    event: ExtractedNarrativeEvent;
    startDate?: Record<string, unknown> | null;
  }): WorldbuildEventOccurrence | null {
    const eventEntityId = String(input.event.worldbuildEventId ?? '').trim();
    if (!eventEntityId) return null;
    const eventEntity = this.requireEventEntity(input.workspaceId, eventEntityId);
    const narrativeEvent = input.record.proposal.changeSet.event;
    const occurrenceId = randomUUID();
    const participants = this.normalizeParticipants(input.workspaceId, narrativeEvent.participants.map(participant => {
      const detail = input.event.participants?.find(item => item.entityId === participant.entityId);
      const memory = input.event.operations.find(operation => operation.type === 'memory' && operation.subjectId === participant.entityId);
      return {
        entityId: participant.entityId,
        role: detail?.role || participant.role,
        remember: Boolean(memory),
        memoryAccessibility: memory?.type === 'memory' ? memory.accessibility ?? 'available' : 'available',
        audienceType: detail?.audienceType ?? 'all-members',
        selectedMemberIds: detail?.selectedMemberIds ?? []
      };
    }));
    const relatedEntityIds = unique([
      ...narrativeEvent.participants.map(participant => participant.entityId),
      ...input.event.operations.flatMap(operation => relatedIdsForOperation(operation))
    ]).filter(id => id !== eventEntity.id);
    this.persistMapping({
      workspaceId: input.workspaceId,
      occurrenceId,
      eventEntityId: eventEntity.id,
      record: input.record,
      title: input.event.occurrenceTitle?.trim() || input.event.description.trim(),
      summary: input.event.description.trim(),
      startDate: input.event.worldDate ?? input.startDate ?? null,
      endDate: null,
      participants,
      locationIds: narrativeEvent.locationId ? [narrativeEvent.locationId] : [],
      relatedEntityIds,
      consequences: summarizeNarrativeConsequences(input.record, input.originId, this.roleplay),
      source: 'narrative-state',
      originId: input.originId
    });
    return this.requireOccurrenceByNarrativeEvent(input.workspaceId, narrativeEvent.id);
  }

  private applyManualConsequences(workspaceId: string, occurrenceId: string, input: ManualEventOccurrenceInput): void {
    for (const [index, change] of (input.resourceChanges ?? []).entries()) {
      this.roleplay.proposeChange({
        id: `${occurrenceId}:resource:${index}`,
        workspaceId,
        definitionId: change.definitionId,
        entityId: change.entityId,
        value: Number(change.value),
        source: 'manual',
        provenanceId: occurrenceId
      });
    }
    for (const [index, patch] of (input.inventoryChanges ?? []).entries()) {
      this.roleplay.proposeInventoryChange({
        id: `${occurrenceId}:inventory:${index}`,
        workspaceId,
        patch,
        source: 'manual',
        provenanceId: occurrenceId
      });
    }
  }

  private persistMapping(input: {
    workspaceId: string;
    occurrenceId: string;
    eventEntityId: string;
    record: NarrativeEventLedgerRecord;
    title: string;
    summary: string;
    startDate: Record<string, unknown> | null;
    endDate: Record<string, unknown> | null;
    participants: EventOccurrenceParticipant[];
    locationIds: string[];
    relatedEntityIds: string[];
    consequences: Record<string, unknown>;
    source: 'user' | 'narrative-state';
    originId: string;
  }): void {
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO worldbuild_event_occurrences (
        workspace_id, occurrence_id, event_entity_id, narrative_event_id,
        title, summary, start_date_json, end_date_json, participants_json,
        location_ids_json, related_entity_ids_json, consequences_json,
        source, origin_id, archived, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)
      ON CONFLICT(workspace_id, narrative_event_id) DO UPDATE SET
        title = excluded.title,
        summary = excluded.summary,
        start_date_json = excluded.start_date_json,
        end_date_json = excluded.end_date_json,
        participants_json = excluded.participants_json,
        location_ids_json = excluded.location_ids_json,
        related_entity_ids_json = excluded.related_entity_ids_json,
        consequences_json = excluded.consequences_json,
        updated_at = excluded.updated_at
    `).run(
      input.workspaceId, input.occurrenceId, input.eventEntityId,
      input.record.proposal.changeSet.event.id, input.title, input.summary,
      jsonOrNull(input.startDate), jsonOrNull(input.endDate), JSON.stringify(input.participants),
      JSON.stringify(input.locationIds), JSON.stringify(input.relatedEntityIds),
      JSON.stringify(input.consequences), input.source, input.originId, now, now
    );
  }

  private requireOccurrence(workspaceId: string, occurrenceId: string): WorldbuildEventOccurrence {
    const row = this.db.prepare(`
      SELECT occurrences.*, events.status
      FROM worldbuild_event_occurrences occurrences
      JOIN kanora_narrative_events events
        ON events.workspace_id = occurrences.workspace_id
        AND events.event_id = occurrences.narrative_event_id
      WHERE occurrences.workspace_id = ? AND occurrences.occurrence_id = ?
    `).get(workspaceId, occurrenceId) as OccurrenceRow | undefined;
    if (!row) throw new Error('The event occurrence was not found.');
    return hydrateOccurrence(row);
  }

  private requireOccurrenceByNarrativeEvent(workspaceId: string, narrativeEventId: string): WorldbuildEventOccurrence {
    const row = this.db.prepare(`
      SELECT occurrences.*, events.status
      FROM worldbuild_event_occurrences occurrences
      JOIN kanora_narrative_events events
        ON events.workspace_id = occurrences.workspace_id
        AND events.event_id = occurrences.narrative_event_id
      WHERE occurrences.workspace_id = ? AND occurrences.narrative_event_id = ?
    `).get(workspaceId, narrativeEventId) as OccurrenceRow | undefined;
    if (!row) throw new Error('The event occurrence was not found.');
    return hydrateOccurrence(row);
  }

  private requireEventEntity(workspaceId: string, eventEntityId: string): { id: string; name: string } {
    const row = this.db.prepare(`
      SELECT id, canonicalName AS name FROM entities
      WHERE workspaceId = ? AND id = ? AND type = 'Events' AND status != 'proposed'
    `).get(workspaceId, eventEntityId) as { id: string; name: string } | undefined;
    if (!row) throw new Error('A confirmed Worldbuild Event is required.');
    return row;
  }

  private normalizeParticipants(workspaceId: string, participants: EventOccurrenceParticipant[]): EventOccurrenceParticipant[] {
    const seen = new Set<string>();
    return participants.flatMap(participant => {
      if (!participant?.entityId || seen.has(participant.entityId)) return [];
      const entity = this.requireEntity(workspaceId, participant.entityId);
      seen.add(participant.entityId);
      const canRemember = entity.type === 'Characters'
        || entity.type === 'Factions'
        || (entity.type === 'Creatures' && entity.scope !== 'group');
      return [{
        entityId: participant.entityId,
        role: participant.role?.trim() || 'involved',
        remember: canRemember && participant.remember !== false,
        memoryAccessibility: normalizeAccessibility(participant.memoryAccessibility),
        audienceType: participant.audienceType === 'selected-members' ? 'selected-members' : 'all-members',
        selectedMemberIds: participant.audienceType === 'selected-members'
          ? this.normalizeFactionMembers(workspaceId, participant.entityId, participant.selectedMemberIds ?? [])
          : []
      }];
    });
  }

  private normalizeFactionMembers(workspaceId: string, factionId: string, values: string[]): string[] {
    const entity = this.requireEntity(workspaceId, factionId);
    if (entity.type !== 'Factions') return [];
    return this.normalizeEntityIds(workspaceId, values, ['Characters']).filter(memberId => {
      const membership = this.db.prepare(`
        SELECT 1 FROM entity_links
        WHERE workspaceId = ? AND fromId = ? AND relType = 'member_of' AND toId = ?
      `).get(workspaceId, memberId, factionId);
      if (!membership) throw new Error('A selected faction memory recipient is not a member of that faction.');
      return true;
    });
  }

  private normalizeEntityIds(workspaceId: string, values: string[], types?: string[]): string[] {
    return unique(values).filter(id => {
      const entity = this.requireEntity(workspaceId, id);
      if (types && !types.includes(entity.type)) throw new Error('An occurrence reference has an invalid entity type.');
      return true;
    });
  }

  private requireEntity(workspaceId: string, entityId: string): { type: string; scope: string } {
    const row = this.db.prepare(`
      SELECT type, data FROM entities
      WHERE workspaceId = ? AND id = ? AND status != 'proposed'
    `).get(workspaceId, entityId) as { type: string; data: string } | undefined;
    if (!row) throw new Error('A referenced occurrence entity was not found.');
    const data = parseObject(row.data);
    return { type: row.type, scope: String(data.scope ?? 'individual') };
  }

  private listConfirmedEntityIds(workspaceId: string): string[] {
    return (this.db.prepare(`
      SELECT id FROM entities WHERE workspaceId = ? AND status != 'proposed'
    `).all(workspaceId) as Array<{ id: string }>).map(row => row.id);
  }
}

export function isFactionOccurrenceMemoryShared(
  db: Database.Database,
  workspaceId: string,
  narrativeEventId: string,
  factionId: string,
  memberId: string
): boolean {
  const membership = db.prepare(`
    SELECT 1 FROM entity_links
    WHERE workspaceId = ? AND fromId = ? AND relType = 'member_of' AND toId = ?
  `).get(workspaceId, memberId, factionId);
  if (!membership) return false;
  const row = db.prepare(`
    SELECT participants_json FROM worldbuild_event_occurrences
    WHERE workspace_id = ? AND narrative_event_id = ? AND archived = 0
  `).get(workspaceId, narrativeEventId) as { participants_json: string } | undefined;
  if (!row) return false;
  const participant = parseArray<EventOccurrenceParticipant>(row.participants_json)
    .find(item => item.entityId === factionId && item.remember);
  if (!participant) return false;
  return participant.audienceType === 'all-members' || participant.selectedMemberIds.includes(memberId);
}

export function canSubjectAccessOccurrence(
  db: Database.Database,
  workspaceId: string,
  narrativeEventId: string,
  subjectId: string
): boolean {
  const rows = db.prepare(`
    SELECT subject_id, payload_json FROM kanora_narrative_records
    WHERE workspace_id = ? AND source_event_id = ? AND record_type = 'memory'
  `).all(workspaceId, narrativeEventId) as Array<{ subject_id: string; payload_json: string }>;
  return rows.some(row => {
    const memory = parseObject(row.payload_json);
    if ((memory.status ?? 'active') !== 'active' || memory.accessibility !== 'available') return false;
    if (row.subject_id === subjectId) return true;
    return isFactionOccurrenceMemoryShared(db, workspaceId, narrativeEventId, row.subject_id, subjectId);
  });
}

function hydrateOccurrence(row: OccurrenceRow): WorldbuildEventOccurrence {
  return {
    id: row.occurrence_id,
    workspaceId: row.workspace_id,
    eventEntityId: row.event_entity_id,
    narrativeEventId: row.narrative_event_id,
    title: row.title,
    summary: row.summary,
    startDate: parseNullableObject(row.start_date_json),
    endDate: parseNullableObject(row.end_date_json),
    participants: parseArray<EventOccurrenceParticipant>(row.participants_json),
    locationIds: parseArray<string>(row.location_ids_json),
    relatedEntityIds: parseArray<string>(row.related_entity_ids_json),
    consequences: parseObject(row.consequences_json),
    source: row.source,
    originId: row.origin_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function compareOccurrences(left: WorldbuildEventOccurrence, right: WorldbuildEventOccurrence): number {
  if (!left.startDate && !right.startDate) return left.createdAt - right.createdAt;
  if (!left.startDate) return -1;
  if (!right.startDate) return 1;
  const leftParts = dateParts(left.startDate);
  const rightParts = dateParts(right.startDate);
  for (let index = 0; index < leftParts.length; index += 1) {
    const comparison = leftParts[index].localeCompare(rightParts[index], undefined, { numeric: true });
    if (comparison !== 0) return comparison;
  }
  return left.createdAt - right.createdAt;
}

function dateParts(value: Record<string, unknown>): string[] {
  return [
    String(value.eraId ?? ''),
    String(value.year ?? 0),
    String(value.month ?? 0),
    String(value.day ?? 0),
    String(value.hour ?? 0),
    String(value.minute ?? 0)
  ];
}

function summarizeNarrativeConsequences(record: NarrativeEventLedgerRecord, originId: string, roleplay: RoleplaySystem): Record<string, unknown> {
  const operations = record.proposal.changeSet.operations;
  return {
    memories: operations.filter(operation => operation.type === 'record-memory').length,
    relationships: operations.filter(operation => operation.type === 'set-relationship').length,
    facts: operations.filter(operation => operation.type === 'assert-fact').length,
    resources: roleplay.listChanges(record.proposal.projectId).filter(change => change.provenanceId === originId).length,
    inventory: roleplay.listInventoryChanges(record.proposal.projectId).filter(change => change.provenanceId === originId).length
  };
}

function relatedIdsForOperation(operation: ExtractedNarrativeEvent['operations'][number]): string[] {
  if (operation.type === 'fact') return [operation.proposition.subjectId];
  if (operation.type === 'awareness') return [operation.subjectId, operation.targetId];
  if (operation.type === 'knowledge' || operation.type === 'belief') return [operation.subjectId, operation.proposition.subjectId];
  if (operation.type === 'memory') return [operation.subjectId, ...(operation.relatedEntityIds ?? [])];
  return [operation.sourceEntityId, operation.targetEntityId];
}

function normalizeAccessibility(value: unknown): MemoryAccessibility {
  return value === 'suppressed' || value === 'inaccessible' ? value : 'available';
}

function requireText(value: unknown, name: string): string {
  const text = String(value ?? '').trim();
  if (!text) throw new Error(`${name} is required.`);
  return text;
}

function unique(values: string[]): string[] {
  return [...new Set(values.map(value => String(value ?? '').trim()).filter(Boolean))];
}

function jsonOrNull(value: Record<string, unknown> | null): string | null {
  return value ? JSON.stringify(value) : null;
}

function parseObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value ?? '{}'));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseNullableObject(value: string | null): Record<string, unknown> | null {
  return value ? parseObject(value) : null;
}

function parseArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  try {
    const parsed = JSON.parse(String(value ?? '[]'));
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}
