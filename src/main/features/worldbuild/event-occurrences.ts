import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import type { NarrativeOperation } from '../../../kanora/contracts';
import type { NarrativeEventLedgerRecord } from '../../../kanora/ledger';
import { isValidNarrativeOperation, NarrativeStateSystem, type ExtractedNarrativeEvent } from '../kanora/narrative-state';
import { RoleplaySystem, type RoleplayInventoryPatch } from '../kanora/roleplay-system';

interface EventOccurrenceCalendarService {
  getCalendar(db: Database.Database, workspaceId: string): Record<string, any>;
  validateDate(calendar: Record<string, any>, date: Record<string, unknown>): boolean;
  compareDates(calendar: Record<string, any>, left: Record<string, unknown>, right: Record<string, unknown>): number;
}

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

export interface UpdateManualEventOccurrenceInput {
  workspaceId: string;
  occurrenceId: string;
  eventEntityId: string;
  title: string;
  summary: string;
  startDate?: Record<string, unknown> | null;
  endDate?: Record<string, unknown> | null;
  participants: EventOccurrenceParticipant[];
  locationIds: string[];
  relatedEntityIds: string[];
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

  constructor(
    private readonly db: Database.Database,
    private readonly calendarService: EventOccurrenceCalendarService
  ) {
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
    const calendar = this.calendarService.getCalendar(this.db, workspaceId);
    return rows.map(hydrateOccurrence).sort((left, right) => compareOccurrences(this.calendarService, calendar, left, right));
  }

  createManual(input: ManualEventOccurrenceInput): WorldbuildEventOccurrence {
    const workspaceId = requireText(input.workspaceId, 'workspaceId');
    const eventEntity = this.requireEventEntity(workspaceId, input.eventEntityId);
    const title = requireText(input.title, 'title');
    const summary = requireText(input.summary, 'summary');
    const { startDate, endDate } = this.normalizeDateRange(workspaceId, input.startDate, input.endDate);
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
      worldDate: startDate ?? undefined,
      confidence: 1,
      operations: [
        {
          type: 'fact',
          proposition: {
            subjectId: eventEntity.id,
            predicate: 'recorded-occurrence',
            object: { occurrenceId, title, summary, startDate, endDate }
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
        startDate,
        endDate,
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

  updateManual(input: UpdateManualEventOccurrenceInput): WorldbuildEventOccurrence {
    const workspaceId = requireText(input.workspaceId, 'workspaceId');
    const occurrenceId = requireText(input.occurrenceId, 'occurrenceId');
    const occurrence = this.requireEditableOccurrence(workspaceId, occurrenceId);
    if (occurrence.eventEntityId !== requireText(input.eventEntityId, 'eventEntityId')) {
      throw new Error('The occurrence no longer belongs to the active event.');
    }
    const eventEntity = this.requireEventEntity(workspaceId, occurrence.eventEntityId);
    const title = requireText(input.title, 'title');
    const summary = requireText(input.summary, 'summary');
    const { startDate, endDate } = this.normalizeDateRange(workspaceId, input.startDate, input.endDate);
    const participants = this.normalizeParticipants(workspaceId, input.participants ?? []);
    const locationIds = this.normalizeEntityIds(workspaceId, input.locationIds ?? [], ['Locations']);
    const relatedEntityIds = this.normalizeEntityIds(workspaceId, input.relatedEntityIds ?? []);
    const participantIds = unique([eventEntity.id, ...participants.map(participant => participant.entityId)]);
    const memoryRelatedIds = unique([eventEntity.id, ...participantIds, ...locationIds, ...relatedEntityIds]);
    const updatedAt = Date.now();
    const appliedAt = new Date(updatedAt).toISOString();

    return this.db.transaction(() => {
      const eventRow = this.db.prepare(`
        SELECT operations_json FROM kanora_narrative_events
        WHERE workspace_id = ? AND event_id = ?
      `).get(workspaceId, occurrence.narrativeEventId) as { operations_json: string } | undefined;
      if (!eventRow) throw new Error('The linked narrative event was not found.');

      const operations = parseArray<NarrativeOperation>(eventRow.operations_json);
      const factOperation = operations.find((operation): operation is Extract<NarrativeOperation, { type: 'assert-fact' }> => (
        operation.type === 'assert-fact'
        && operation.fact.proposition.predicate === 'recorded-occurrence'
      ));
      if (!factOperation) throw new Error('The occurrence fact could not be updated safely.');

      const updatedFactOperation: Extract<NarrativeOperation, { type: 'assert-fact' }> = {
        ...factOperation,
        fact: {
          ...factOperation.fact,
          proposition: {
            subjectId: eventEntity.id,
            predicate: 'recorded-occurrence',
            object: {
              occurrenceId,
              title,
              summary,
              startDate,
              endDate,
            },
          },
        },
      };
      const existingMemoryOperations = operations.filter((operation): operation is Extract<NarrativeOperation, { type: 'record-memory' }> => operation.type === 'record-memory');
      const memoryBySubject = new Map(existingMemoryOperations.map(operation => [operation.memory.subjectId, operation]));
      const memoryOperations = participants.filter(participant => participant.remember).map(participant => {
        const existing = memoryBySubject.get(participant.entityId);
        if (existing) {
          return {
            ...existing,
            memory: {
              ...existing.memory,
              summary: `${title}: ${summary}`,
              accessibility: participant.memoryAccessibility,
              status: 'active' as const,
              relatedEntityIds: memoryRelatedIds,
            },
          };
        }
        const suffix = stableOccurrenceSuffix(occurrenceId, participant.entityId);
        return {
          id: `op_occurrence_memory_${suffix}`,
          type: 'record-memory' as const,
          evidenceIds: factOperation.evidenceIds,
          memory: {
            id: `memory_occurrence_${suffix}`,
            subjectId: participant.entityId,
            eventId: occurrence.narrativeEventId,
            summary: `${title}: ${summary}`,
            accessibility: participant.memoryAccessibility,
            status: 'active' as const,
            relatedEntityIds: memoryRelatedIds,
          },
        };
      });
      const preservedOperations = operations.filter(operation => operation.type !== 'assert-fact' && operation.type !== 'record-memory');
      const nextOperations: NarrativeOperation[] = [updatedFactOperation, ...memoryOperations, ...preservedOperations];
      if (!nextOperations.every(isValidNarrativeOperation)) {
        throw new Error('The edited occurrence would produce an invalid narrative record.');
      }

      const updatedEvent = this.db.prepare(`
        UPDATE kanora_narrative_events
        SET description = ?, location_id = ?, operations_json = ?, version = version + 1
        WHERE workspace_id = ? AND event_id = ?
      `).run(`${title}: ${summary}`, locationIds[0] ?? null, JSON.stringify(nextOperations), workspaceId, occurrence.narrativeEventId);
      if (updatedEvent.changes !== 1) throw new Error('The linked narrative event was not found.');
      const updatedEvidence = this.db.prepare(`
        UPDATE kanora_narrative_event_evidence SET excerpt = ?
        WHERE workspace_id = ? AND event_id = ? AND ordinal = 0 AND origin_id = ?
      `).run(summary.slice(0, 500), workspaceId, occurrence.narrativeEventId, occurrence.originId);
      if (updatedEvidence.changes !== 1) throw new Error('The occurrence provenance could not be updated safely.');
      this.db.prepare(`
        DELETE FROM kanora_narrative_event_participants
        WHERE workspace_id = ? AND event_id = ?
      `).run(workspaceId, occurrence.narrativeEventId);
      const insertParticipant = this.db.prepare(`
        INSERT INTO kanora_narrative_event_participants
          (workspace_id, event_id, ordinal, entity_id, role)
        VALUES (?, ?, ?, ?, ?)
      `);
      participantIds.forEach((entityId, index) => {
        const role = entityId === eventEntity.id
          ? 'recurring event'
          : participants.find(participant => participant.entityId === entityId)?.role ?? 'involved';
        insertParticipant.run(workspaceId, occurrence.narrativeEventId, index, entityId, role);
      });

      this.updateAppliedRecord(workspaceId, occurrence.narrativeEventId, updatedFactOperation, appliedAt);
      const nextMemoryOperationIds = new Set(memoryOperations.map(operation => operation.id));
      for (const operation of existingMemoryOperations) {
        if (!nextMemoryOperationIds.has(operation.id)) {
          this.db.prepare(`
            DELETE FROM kanora_narrative_records
            WHERE workspace_id = ? AND source_event_id = ? AND operation_id = ? AND record_type = 'memory'
          `).run(workspaceId, occurrence.narrativeEventId, operation.id);
        }
      }
      for (const operation of memoryOperations) {
        this.updateAppliedRecord(workspaceId, occurrence.narrativeEventId, operation, appliedAt);
      }

      const updatedOccurrence = this.db.prepare(`
        UPDATE worldbuild_event_occurrences
        SET title = ?, summary = ?, start_date_json = ?, end_date_json = ?,
          participants_json = ?, location_ids_json = ?, related_entity_ids_json = ?, updated_at = ?
        WHERE workspace_id = ? AND occurrence_id = ? AND archived = 0
      `).run(
        title, summary, jsonOrNull(startDate), jsonOrNull(endDate),
        JSON.stringify(participants), JSON.stringify(locationIds), JSON.stringify(relatedEntityIds),
        updatedAt, workspaceId, occurrenceId
      );
      if (updatedOccurrence.changes !== 1) throw new Error('The event occurrence was not found.');
      return this.requireOccurrence(workspaceId, occurrenceId);
    })();
  }

  deleteManual(workspaceIdValue: string, occurrenceIdValue: string, eventEntityIdValue: string): boolean {
    const workspaceId = requireText(workspaceIdValue, 'workspaceId');
    const occurrenceId = requireText(occurrenceIdValue, 'occurrenceId');
    const occurrence = this.requireEditableOccurrence(workspaceId, occurrenceId);
    if (occurrence.eventEntityId !== requireText(eventEntityIdValue, 'eventEntityId')) {
      throw new Error('The occurrence no longer belongs to the active event.');
    }
    if (!occurrence.originId) throw new Error('The occurrence provenance could not be removed safely.');
    const updatedAt = Date.now();
    return this.db.transaction(() => {
      const archived = this.db.prepare(`
        UPDATE worldbuild_event_occurrences
        SET archived = 1, updated_at = ?
        WHERE workspace_id = ? AND occurrence_id = ? AND archived = 0
      `).run(updatedAt, workspaceId, occurrenceId);
      if (archived.changes !== 1) throw new Error('The event occurrence was not found.');
      this.db.prepare(`
        INSERT INTO kanora_narrative_origin_lifecycle
          (workspace_id, origin_id, status, replacement_origin_id, updated_at)
        VALUES (?, ?, 'deleted', NULL, ?)
        ON CONFLICT(workspace_id, origin_id) DO UPDATE SET
          status = 'deleted', replacement_origin_id = NULL, updated_at = excluded.updated_at
      `).run(workspaceId, occurrence.originId, updatedAt);
      return true;
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

  private updateAppliedRecord(
    workspaceId: string,
    narrativeEventId: string,
    operation: Extract<NarrativeOperation, { type: 'assert-fact' | 'record-memory' }>,
    appliedAt: string
  ): void {
    const record = operation.type === 'assert-fact'
      ? { type: 'fact', id: operation.fact.id, subjectId: null, payload: operation.fact }
      : { type: 'memory', id: operation.memory.id, subjectId: operation.memory.subjectId, payload: operation.memory };
    this.db.prepare(`
      INSERT INTO kanora_narrative_records (
        workspace_id, record_type, record_id, subject_id, source_event_id,
        operation_id, payload_json, applied_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, operation_id) DO UPDATE SET
        subject_id = excluded.subject_id,
        payload_json = excluded.payload_json
    `).run(
      workspaceId, record.type, record.id, record.subjectId, narrativeEventId,
      operation.id, JSON.stringify(record.payload), appliedAt
    );
  }

  private requireEditableOccurrence(workspaceId: string, occurrenceId: string): WorldbuildEventOccurrence {
    const occurrence = this.requireOccurrence(workspaceId, occurrenceId);
    if (occurrence.source !== 'user') throw new Error('Narrative State occurrences are protected history.');
    const provenance = this.db.prepare(`
      SELECT occurrences.archived, occurrences.origin_id,
        events.provenance_interpreter, events.provenance_interpreter_id,
        evidence.origin_id AS evidence_origin_id
      FROM worldbuild_event_occurrences occurrences
      JOIN kanora_narrative_events events
        ON events.workspace_id = occurrences.workspace_id
        AND events.event_id = occurrences.narrative_event_id
      LEFT JOIN kanora_narrative_event_evidence evidence
        ON evidence.workspace_id = events.workspace_id
        AND evidence.event_id = events.event_id
        AND evidence.ordinal = 0
      WHERE occurrences.workspace_id = ? AND occurrences.occurrence_id = ?
    `).get(workspaceId, occurrenceId) as {
      archived: number;
      origin_id: string | null;
      provenance_interpreter: string;
      provenance_interpreter_id: string | null;
      evidence_origin_id: string | null;
    } | undefined;
    if (!provenance || provenance.archived === 1) throw new Error('The event occurrence was not found.');
    const isManualOccurrence = provenance.provenance_interpreter === 'user'
      && provenance.provenance_interpreter_id === 'worldbuild-event-occurrence'
      && Boolean(provenance.origin_id)
      && provenance.origin_id === provenance.evidence_origin_id
      && provenance.origin_id === occurrence.originId;
    if (!isManualOccurrence) throw new Error('Only manually recorded occurrences can be changed.');
    return occurrence;
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

  private normalizeDateRange(
    workspaceId: string,
    startDateValue?: Record<string, unknown> | null,
    endDateValue?: Record<string, unknown> | null
  ): { startDate: Record<string, unknown> | null; endDate: Record<string, unknown> | null } {
    const calendar = this.calendarService.getCalendar(this.db, workspaceId);
    if (!startDateValue && endDateValue) throw new Error('Choose a start date before adding an end date.');
    if (!startDateValue) return { startDate: null, endDate: null };

    const normalizeDate = (value: Record<string, unknown>, label: string) => {
      const date = { ...value };
      for (const field of ['year', 'month', 'day'] as const) {
        const number = Number(date[field]);
        if (!Number.isInteger(number)) throw new Error(`Choose a valid ${label.toLowerCase()}.`);
        date[field] = number;
      }
      for (const field of ['hour', 'minute'] as const) {
        if (date[field] == null) continue;
        const number = Number(date[field]);
        if (!Number.isInteger(number)) throw new Error(`Choose a valid ${label.toLowerCase()}.`);
        date[field] = number;
      }
      const hour = date.hour == null ? null : Number(date.hour);
      const minute = date.minute == null ? null : Number(date.minute);
      if ((hour != null && (hour < 0 || hour >= calendar.hoursPerDay)) || (minute != null && (minute < 0 || minute > 59))) {
        throw new Error(`Choose a valid ${label.toLowerCase()}.`);
      }
      if (!this.calendarService.validateDate(calendar, date)) throw new Error(`Choose a valid ${label.toLowerCase()}.`);
      return date;
    };

    const startDate = normalizeDate(startDateValue, 'start date');
    const endDate = endDateValue ? normalizeDate(endDateValue, 'end date') : null;
    if (endDate && this.calendarService.compareDates(calendar, startDate, endDate) > 0) {
      throw new Error('End date cannot be earlier than start date.');
    }
    return { startDate, endDate };
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

function compareOccurrences(
  calendarService: EventOccurrenceCalendarService,
  calendar: Record<string, any>,
  left: WorldbuildEventOccurrence,
  right: WorldbuildEventOccurrence
): number {
  if (!left.startDate && !right.startDate) return left.createdAt - right.createdAt;
  if (!left.startDate) return -1;
  if (!right.startDate) return 1;
  const dateComparison = calendarService.compareDates(calendar, left.startDate, right.startDate);
  if (dateComparison !== 0) return dateComparison;
  const timeComparison = (Number(left.startDate.hour) || 0) - (Number(right.startDate.hour) || 0)
    || (Number(left.startDate.minute) || 0) - (Number(right.startDate.minute) || 0);
  return timeComparison || left.createdAt - right.createdAt;
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

function stableOccurrenceSuffix(occurrenceId: string, entityId: string): string {
  return createHash('sha256').update(`${occurrenceId}:${entityId}`).digest('hex').slice(0, 24);
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
