import { createHash, randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { KANORA_CONTRACT_VERSION, type NarrativeOperation, type NarrativeProposal, type Proposition } from '../../../kanora/contracts';
import { validateNarrativeOperation } from '../../../kanora/validation';
import { NarrativeChangeSetRepository } from '../../../kanora/change-sets';
import { NarrativeEventLedgerRepository, type NarrativeEventLedgerRecord } from '../../../kanora/ledger';
import { createWorldbuildKnowledgeService, type WorldbuildKnowledgeService } from '../worldbuild/knowledge-service';
import type { RoleplayUpdatePolicy } from './roleplay-system';

export interface ExtractedNarrativeEvent {
  type: 'movement' | 'possession-transfer' | 'revelation' | 'deception' | 'discovery' | 'relationship-change' | 'custom';
  description: string;
  excerpt: string;
  participantIds: string[];
  participants?: Array<{
    entityId: string;
    role: string;
    audienceType?: 'all-members' | 'selected-members';
    selectedMemberIds?: string[];
  }>;
  worldbuildEventId?: string;
  occurrenceTitle?: string;
  worldDate?: Record<string, unknown>;
  confidence: number;
  operations: ExtractedNarrativeOperation[];
}

export type ExtractedNarrativeOperation =
  | { type: 'fact'; proposition: Proposition; confidence: number }
  | { type: 'awareness'; subjectId: string; targetId: string; confidence: number }
  | { type: 'knowledge'; subjectId: string; proposition: Proposition; acquisition: 'participant' | 'witness' | 'reported' | 'inferred'; confidence: number; accessibility?: 'available' | 'suppressed' | 'inaccessible'; informantIds?: string[] }
  | { type: 'belief'; subjectId: string; proposition: Proposition; confidence: number }
  | { type: 'memory'; subjectId: string; summary: string; salience: number; accessibility?: 'available' | 'suppressed' | 'inaccessible'; relatedEntityIds?: string[] }
  | { type: 'relationship'; sourceEntityId: string; targetEntityId: string; dimension: string; value: number; impact?: 'meaningful' | 'significant' | 'drastic'; title?: string; description?: string };

export interface CreateEventInput {
  workspaceId: string;
  originId: string;
  sceneId?: string;
  locationId?: string;
  interpreterId: string;
  event: ExtractedNarrativeEvent;
  allowedEntityIds: Set<string>;
  originType?: 'chat-message' | 'writing-document' | 'world-action' | 'worldbuild-update' | 'import';
  promptVersion?: string;
  forceReview?: boolean;
  updatePolicy?: RoleplayUpdatePolicy;
  provenanceInterpreter?: 'model' | 'user';
  excludedRelationshipSourceIds?: Set<string>;
}

export interface NarrativeStateMetric {
  workspaceId: string;
  originId: string;
  triageInputTokens: number;
  triageOutputTokens: number;
  deepInputTokens: number;
  deepOutputTokens: number;
  deepAnalysis: boolean;
  proposalCount: number;
  elapsedMs: number;
  recordedAt: number;
}

export interface NarrativeStateJob {
  workspaceId: string;
  originId: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'skipped';
  error: string | null;
  updatedAt: number;
}

const AUTO_CONFIDENCE = 0.9;
const AUTO_MEMORY_SALIENCE = 0.85;
const MIN_KNOWLEDGE_CONFIDENCE = 0.8;
const MIN_RELATIONSHIP_VALUE = 5;
/**
 * Where someone is and what they are doing right now belong to the scene, which already
 * carries them and is rewritten every turn. Asserting them as canon or as knowledge creates a
 * second source of truth that nothing supersedes, so a character accumulates contradictory
 * positions, and it buries the durable records under a transcript of prose the model already
 * has in the window. Only model-authored operations are filtered: an authored predicate is a
 * title the writer chose and is never rewritten here.
 */
const SCENE_STATE_PREDICATES = new Set([
  'current-location', 'current-position', 'current-place', 'current-activity',
  'current-action', 'current-scene', 'current-state', 'location', 'position',
  'activity', 'whereabouts', 'present-at', 'presence', 'located-at', 'is-at'
]);
const RELATIONSHIP_IMPACT_LIMITS = { meaningful: 5, significant: 15, drastic: 50 } as const;
const INITIAL_RELATIONSHIP_LIMITS = { meaningful: 25, significant: 50, drastic: 100 } as const;
interface RelationshipBaseline { exists: boolean; value: number }

export class NarrativeStateSystem {
  private readonly ledger: NarrativeEventLedgerRepository;
  private readonly changes: NarrativeChangeSetRepository;
  private readonly knowledgeCards: WorldbuildKnowledgeService;

  constructor(private readonly db: Database.Database) {
    this.ledger = new NarrativeEventLedgerRepository(db);
    this.changes = new NarrativeChangeSetRepository(db);
    this.knowledgeCards = createWorldbuildKnowledgeService(db);
  }

  beginJob(workspaceId: string, originId: string): 'started' | 'complete' {
    const existing = this.db.prepare('SELECT status FROM kanora_narrative_state_jobs WHERE workspace_id = ? AND origin_id = ?').get(workspaceId, originId) as { status: string } | undefined;
    if (existing?.status === 'completed' || existing?.status === 'skipped') return 'complete';
    const now = Date.now();
    this.db.prepare(`
      INSERT INTO kanora_narrative_state_jobs (workspace_id, origin_id, status, created_at, updated_at)
      VALUES (?, ?, 'processing', ?, ?)
      ON CONFLICT(workspace_id, origin_id) DO UPDATE SET status = 'processing', error_message = NULL, updated_at = excluded.updated_at
    `).run(workspaceId, originId, now, now);
    this.db.prepare(`
      INSERT INTO kanora_narrative_origin_lifecycle (workspace_id, origin_id, status, replacement_origin_id, updated_at)
      VALUES (?, ?, 'active', NULL, ?)
      ON CONFLICT(workspace_id, origin_id) DO UPDATE SET status = 'active', replacement_origin_id = NULL, updated_at = excluded.updated_at
    `).run(workspaceId, originId, now);
    return 'started';
  }

  finishJob(workspaceId: string, originId: string, status: 'completed' | 'failed' | 'skipped', details: { deepAnalysis?: boolean; fingerprint?: string; inputTokens?: number; outputTokens?: number; error?: string } = {}): void {
    this.db.prepare(`
      UPDATE kanora_narrative_state_jobs SET status = ?, deep_analysis = ?, event_fingerprint = ?,
        input_tokens = ?, output_tokens = ?, error_message = ?, updated_at = ?
      WHERE workspace_id = ? AND origin_id = ?
    `).run(status, details.deepAnalysis ? 1 : 0, details.fingerprint ?? null, details.inputTokens ?? 0, details.outputTokens ?? 0, details.error ?? null, Date.now(), workspaceId, originId);
  }

  createEvent(input: CreateEventInput): { record?: NarrativeEventLedgerRecord; decision?: 'automatic' | 'review'; skipped?: string } {
    if ((input.provenanceInterpreter ?? 'model') === 'model' && input.updatePolicy === 'manual') {
      return { skipped: 'manual-policy' };
    }
    const fingerprint = fingerprintEvent(input.workspaceId, input.originId, input.event);
    if (this.hasFingerprint(input.workspaceId, fingerprint)) return { skipped: 'duplicate' };
    const operations = deduplicateAwarenessOperations(buildOperations(
      input,
      fingerprint,
      (sourceId, targetId, dimension) => this.currentRelationshipBaseline(input.workspaceId, sourceId, targetId, dimension),
      (subjectId, targetId) => this.hasAwareness(input.workspaceId, subjectId, targetId)
    )
      .filter(isValidNarrativeOperation)
      .filter(operation => !this.isDuplicateOperation(input.workspaceId, operation)));
    if (!operations.length) return { skipped: 'no-valid-operations' };
    const eventId = `evt_${fingerprint}`;
    const evidenceId = `evidence_${fingerprint}`;
    const participants = unique(input.event.participantIds).filter(id => input.allowedEntityIds.has(id));
    if (!participants.length) return { skipped: 'no-valid-participants' };

    const decision = input.forceReview || input.updatePolicy === 'review' || (input.updatePolicy !== 'automatic' && requiresReview(input.event))
      ? 'review'
      : 'automatic';
    const existing = this.ledger.get(input.workspaceId, eventId);
    if (existing) {
      if (existing.status !== 'proposed' || decision === 'review') return { record: existing, decision };
      const applied = this.changes.apply(input.workspaceId, eventId, { expectedVersion: existing.version, attemptedAt: new Date().toISOString(), attemptId: `apply_${fingerprint}_${existing.version}` });
      this.syncCanonicalRelationships(input.workspaceId, applied);
      this.syncAwarenessCards(input.workspaceId, applied);
      this.recordFingerprint(input.workspaceId, fingerprint, input.originId, eventId);
      return { record: applied, decision };
    }
    const proposal: NarrativeProposal = {
      contractVersion: KANORA_CONTRACT_VERSION,
      id: `proposal_${fingerprint}`,
      projectId: input.workspaceId,
      status: 'proposed',
      changeSet: {
        id: `changes_${fingerprint}`,
        event: {
          id: eventId,
          type: input.event.type,
          description: input.event.description.trim(),
          participants: participants.map(entityId => ({
            entityId,
            role: input.event.participants?.find(participant => participant.entityId === entityId)?.role?.trim() || 'involved'
          })),
          position: { sequence: this.nextSequence(input.workspaceId), timestamp: new Date().toISOString() },
          evidenceIds: [evidenceId],
          ...(input.sceneId ? { sceneId: input.sceneId } : {}),
          ...(input.locationId ? { locationId: input.locationId } : {})
        },
        operations
      },
      evidence: [{ id: evidenceId, originType: input.originType ?? 'chat-message', originId: input.originId, excerpt: input.event.excerpt.trim().slice(0, 500) }],
      provenance: { interpreter: input.provenanceInterpreter ?? 'model', interpreterId: input.interpreterId, promptVersion: input.promptVersion ?? 'narrative-state-v1', schemaVersion: KANORA_CONTRACT_VERSION, createdAt: new Date().toISOString() }
    };
    const record = this.ledger.save(proposal);
    if (decision === 'automatic') {
      const applied = this.changes.apply(input.workspaceId, eventId, { expectedVersion: record.version, attemptedAt: new Date().toISOString(), attemptId: `apply_${fingerprint}` });
      this.syncCanonicalRelationships(input.workspaceId, applied);
      this.syncAwarenessCards(input.workspaceId, applied);
      this.recordFingerprint(input.workspaceId, fingerprint, input.originId, eventId);
      return { record: applied, decision };
    }
    this.recordFingerprint(input.workspaceId, fingerprint, input.originId, eventId);
    return { record, decision };
  }

  listEvents(workspaceId: string): NarrativeEventLedgerRecord[] {
    return this.ledger.list(workspaceId).filter(record => {
      const row = this.db.prepare(`
        SELECT lifecycle.status
        FROM kanora_narrative_event_evidence evidence
        LEFT JOIN kanora_narrative_origin_lifecycle lifecycle
          ON lifecycle.workspace_id = evidence.workspace_id AND lifecycle.origin_id = evidence.origin_id
        WHERE evidence.workspace_id = ? AND evidence.event_id = ? AND evidence.ordinal = 0
      `).get(workspaceId, record.proposal.changeSet.event.id) as { status: string | null } | undefined;
      return !row?.status || row.status === 'active';
    });
  }

  resolveEvent(workspaceId: string, eventId: string, decision: 'approved' | 'rejected'): NarrativeEventLedgerRecord | undefined {
    const record = this.ledger.get(workspaceId, eventId);
    if (!record || record.status !== 'proposed') return record;
    if (decision === 'rejected') return this.ledger.setStatus(workspaceId, eventId, 'rejected', new Date().toISOString());
    const applied = this.changes.apply(workspaceId, eventId, { expectedVersion: record.version, attemptedAt: new Date().toISOString(), attemptId: randomUUID() });
    this.syncCanonicalRelationships(workspaceId, applied);
    this.syncAwarenessCards(workspaceId, applied);
    return applied;
  }

  resolveEventOperations(
    workspaceId: string,
    eventId: string,
    input: { approvedOperationIds: string[]; rejectedOperationIds: string[] }
  ): NarrativeEventLedgerRecord | undefined {
    const record = this.ledger.get(workspaceId, eventId);
    if (!record || record.status !== 'proposed') return record;
    const operationIds = new Set(record.proposal.changeSet.operations.map(operation => operation.id));
    const approved = unique(input.approvedOperationIds).filter(id => operationIds.has(id));
    const hiddenLegacy = record.proposal.changeSet.operations
      .filter(operation => operation.type === 'record-observation')
      .map(operation => operation.id);
    const rejected = unique([...input.rejectedOperationIds, ...hiddenLegacy]).filter(id => operationIds.has(id));
    if (approved.length + rejected.length !== operationIds.size) throw new Error('Every review item must be approved or rejected.');
    if (approved.some(id => rejected.includes(id))) throw new Error('A review item cannot be both approved and rejected.');
    const decidedAt = new Date().toISOString();
    return this.db.transaction(() => {
      const saveDecision = this.db.prepare(`
        INSERT INTO kanora_narrative_operation_reviews
          (workspace_id, event_id, operation_id, decision, decided_at)
        VALUES (?, ?, ?, ?, ?)
      `);
      for (const id of approved) saveDecision.run(workspaceId, eventId, id, 'approved', decidedAt);
      for (const id of rejected) saveDecision.run(workspaceId, eventId, id, 'rejected', decidedAt);
      if (!approved.length) return this.ledger.setStatus(workspaceId, eventId, 'rejected', decidedAt);
      const applied = this.changes.apply(workspaceId, eventId, {
        expectedVersion: record.version,
        attemptedAt: decidedAt,
        attemptId: `partial_${eventId}_${record.version}`,
        operationIds: approved,
      });
      this.syncCanonicalRelationships(workspaceId, applied);
      this.syncAwarenessCards(workspaceId, applied);
      return applied;
    })();
  }

  recordMetric(metric: NarrativeStateMetric): void {
    this.db.prepare(`
      INSERT INTO kanora_narrative_state_metrics (workspace_id, origin_id, triage_input_tokens, triage_output_tokens, deep_input_tokens, deep_output_tokens, deep_analysis, proposal_count, elapsed_ms, recorded_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, origin_id) DO UPDATE SET triage_input_tokens = excluded.triage_input_tokens,
        triage_output_tokens = excluded.triage_output_tokens, deep_input_tokens = excluded.deep_input_tokens,
        deep_output_tokens = excluded.deep_output_tokens, deep_analysis = excluded.deep_analysis,
        proposal_count = excluded.proposal_count, elapsed_ms = excluded.elapsed_ms, recorded_at = excluded.recorded_at
    `).run(metric.workspaceId, metric.originId, metric.triageInputTokens, metric.triageOutputTokens, metric.deepInputTokens, metric.deepOutputTokens, metric.deepAnalysis ? 1 : 0, metric.proposalCount, metric.elapsedMs, metric.recordedAt);
  }

  listMetrics(workspaceId: string, limit = 100): NarrativeStateMetric[] {
    const rows = this.db.prepare('SELECT * FROM kanora_narrative_state_metrics WHERE workspace_id = ? ORDER BY recorded_at DESC LIMIT ?').all(workspaceId, limit) as Record<string, number | string>[];
    return rows.map(row => ({ workspaceId: String(row.workspace_id), originId: String(row.origin_id), triageInputTokens: Number(row.triage_input_tokens), triageOutputTokens: Number(row.triage_output_tokens), deepInputTokens: Number(row.deep_input_tokens), deepOutputTokens: Number(row.deep_output_tokens), deepAnalysis: Boolean(row.deep_analysis), proposalCount: Number(row.proposal_count), elapsedMs: Number(row.elapsed_ms), recordedAt: Number(row.recorded_at) }));
  }

  listJobs(workspaceId: string, limit = 50): NarrativeStateJob[] {
    const rows = this.db.prepare(`
      SELECT workspace_id, origin_id, status, error_message, updated_at
      FROM kanora_narrative_state_jobs
      WHERE workspace_id = ? ORDER BY updated_at DESC LIMIT ?
    `).all(workspaceId, limit) as Array<Record<string, unknown>>;
    return rows.map(row => ({
      workspaceId: String(row.workspace_id),
      originId: String(row.origin_id),
      status: String(row.status) as NarrativeStateJob['status'],
      error: row.error_message ? String(row.error_message) : null,
      updatedAt: Number(row.updated_at)
    }));
  }

  private nextSequence(workspaceId: string): number {
    const row = this.db.prepare('SELECT MAX(narrative_sequence) AS value FROM kanora_narrative_events WHERE workspace_id = ?').get(workspaceId) as { value: number | null };
    return (row.value ?? 0) + 1;
  }

  private hasFingerprint(workspaceId: string, fingerprint: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM kanora_narrative_state_fingerprints WHERE workspace_id = ? AND fingerprint = ?').get(workspaceId, fingerprint));
  }

  private recordFingerprint(workspaceId: string, fingerprint: string, originId: string, eventId: string): void {
    this.db.prepare(`
      INSERT OR IGNORE INTO kanora_narrative_state_fingerprints
        (workspace_id, fingerprint, origin_id, event_id, created_at)
      VALUES (?, ?, ?, ?, ?)
    `).run(workspaceId, fingerprint, originId, eventId, Date.now());
  }

  private currentRelationshipBaseline(workspaceId: string, sourceId: string, targetId: string, dimension: string): RelationshipBaseline {
    const row = this.db.prepare(`
      SELECT records.payload_json FROM kanora_narrative_records records
      JOIN kanora_narrative_events events
        ON events.workspace_id = records.workspace_id AND events.event_id = records.source_event_id
      LEFT JOIN kanora_narrative_event_evidence evidence
        ON evidence.workspace_id = events.workspace_id AND evidence.event_id = events.event_id AND evidence.ordinal = 0
      LEFT JOIN kanora_narrative_origin_lifecycle lifecycle
        ON lifecycle.workspace_id = events.workspace_id AND lifecycle.origin_id = evidence.origin_id
      WHERE records.workspace_id = ? AND records.record_type = 'relationship' AND records.subject_id = ?
        AND json_extract(records.payload_json, '$.targetEntityId') = ?
        AND lower(json_extract(records.payload_json, '$.dimension')) = lower(?)
        AND COALESCE(lifecycle.status, 'active') = 'active'
      ORDER BY records.rowid DESC LIMIT 1
    `).get(workspaceId, sourceId, targetId, dimension) as { payload_json: string } | undefined;
    if (row) {
      const value = Number((JSON.parse(row.payload_json) as { value?: number }).value ?? 0);
      return { exists: true, value: Number.isFinite(value) ? Math.max(-100, Math.min(100, value)) : 0 };
    }
    const link = this.db.prepare(`
      SELECT metadata_json FROM entity_links
      WHERE workspaceId = ? AND fromId = ? AND relType = 'related_to' AND toId = ?
      ORDER BY createdAt LIMIT 1
    `).get(workspaceId, sourceId, targetId) as { metadata_json: string | null } | undefined;
    if (!link) return { exists: false, value: 0 };
    if (!link.metadata_json) return { exists: true, value: 0 };
    try {
      const value = Number((JSON.parse(link.metadata_json) as { value?: number }).value);
      return { exists: true, value: Number.isFinite(value) ? Math.max(-100, Math.min(100, value)) : 0 };
    } catch {
      return { exists: true, value: 0 };
    }
  }

  private hasAwareness(workspaceId: string, subjectId: string, targetId: string): boolean {
    return this.knowledgeCards.getCard(workspaceId, subjectId, targetId)?.status === 'active';
  }

  private isDuplicateOperation(workspaceId: string, operation: NarrativeOperation): boolean {
    if (operation.type === 'assert-fact') return this.isDuplicateFact(workspaceId, operation.fact.proposition);
    if (operation.type !== 'record-memory' && operation.type !== 'grant-knowledge' && operation.type !== 'set-belief') return false;
    const recordType = operation.type === 'record-memory' ? 'memory' : operation.type === 'grant-knowledge' ? 'knowledge' : 'belief';
    const subjectId = operation.type === 'record-memory'
      ? operation.memory.subjectId
      : operation.type === 'grant-knowledge'
        ? operation.knowledge.subjectId
        : operation.belief.subjectId;
    const rows = this.db.prepare(`
      SELECT records.payload_json
      FROM kanora_narrative_records records
      JOIN kanora_narrative_events events
        ON events.workspace_id = records.workspace_id AND events.event_id = records.source_event_id
      LEFT JOIN kanora_narrative_event_evidence evidence
        ON evidence.workspace_id = events.workspace_id AND evidence.event_id = events.event_id AND evidence.ordinal = 0
      LEFT JOIN kanora_narrative_origin_lifecycle lifecycle
        ON lifecycle.workspace_id = events.workspace_id AND lifecycle.origin_id = evidence.origin_id
      WHERE records.workspace_id = ? AND records.record_type = ? AND records.subject_id = ?
        AND COALESCE(lifecycle.status, 'active') = 'active'
    `).all(workspaceId, recordType, subjectId) as Array<{ payload_json: string }>;
    if (operation.type === 'record-memory') {
      const summary = normalizeText(operation.memory.summary);
      return rows.some(row => {
        const memory = JSON.parse(row.payload_json) as { summary?: string; status?: string };
        return (memory.status ?? 'active') === 'active' && normalizeText(memory.summary ?? '') === summary;
      });
    }
    const proposition = JSON.stringify(operation.type === 'grant-knowledge' ? operation.knowledge.proposition : operation.belief.proposition);
    return rows.some(row => {
      const record = JSON.parse(row.payload_json) as { proposition?: Proposition; status?: string };
      return record.status === 'active' && JSON.stringify(record.proposition) === proposition;
    });
  }

  /**
   * Facts carry no subject column and are never superseded, so an identical assertion made
   * again in a later turn simply piles up and every copy stays eligible for retrieval.
   * Occurrences are excluded: they are keyed by their own record and the occurrence service
   * owns their lifecycle.
   */
  private isDuplicateFact(workspaceId: string, proposition: Proposition): boolean {
    if (normalizeText(proposition.predicate) === 'recorded-occurrence') return false;
    const rows = this.db.prepare(`
      SELECT records.payload_json
      FROM kanora_narrative_records records
      JOIN kanora_narrative_events events
        ON events.workspace_id = records.workspace_id AND events.event_id = records.source_event_id
      LEFT JOIN kanora_narrative_event_evidence evidence
        ON evidence.workspace_id = events.workspace_id AND evidence.event_id = events.event_id AND evidence.ordinal = 0
      LEFT JOIN kanora_narrative_origin_lifecycle lifecycle
        ON lifecycle.workspace_id = events.workspace_id AND lifecycle.origin_id = evidence.origin_id
      WHERE records.workspace_id = ? AND records.record_type = 'fact'
        AND COALESCE(lifecycle.status, 'active') = 'active'
    `).all(workspaceId) as Array<{ payload_json: string }>;
    const target = JSON.stringify(proposition);
    return rows.some(row => {
      const record = JSON.parse(row.payload_json) as { proposition?: Proposition; status?: string };
      return (record.status ?? 'active') === 'active' && JSON.stringify(record.proposition) === target;
    });
  }

  private syncCanonicalRelationships(workspaceId: string, record: NarrativeEventLedgerRecord): void {
    const hasLinks = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'entity_links'").get();
    if (!hasLinks) return;
    const appliedOperationIds = this.appliedOperationIds(workspaceId, record.proposal.changeSet.event.id);
    const relationshipValueOnly = record.proposal.provenance.interpreter === 'model'
      && record.proposal.evidence[0]?.originType !== 'worldbuild-update';
    for (const operation of record.proposal.changeSet.operations) {
      if (operation.type !== 'set-relationship' || !appliedOperationIds.has(operation.id)) continue;
      const relationship = operation.relationship;
      const current = this.db.prepare(`
        SELECT id, label, metadata_json AS metadataJson FROM entity_links
        WHERE workspaceId = ? AND fromId = ? AND relType = 'related_to' AND toId = ?
        ORDER BY createdAt LIMIT 1
      `).get(workspaceId, relationship.sourceEntityId, relationship.targetEntityId) as { id: string; label: string | null; metadataJson: string | null } | undefined;
      const metadata = current?.metadataJson ? JSON.parse(current.metadataJson) as Record<string, unknown> : {};
      const nextMetadata = JSON.stringify(relationshipValueOnly
        ? { ...metadata, value: relationship.value, sourceEventId: relationship.sourceEventId, updatedBy: 'ai' }
        : { ...metadata, value: relationship.value, description: relationship.description ?? '', sourceEventId: relationship.sourceEventId, updatedBy: 'ai' });
      if (current) {
        this.db.prepare('UPDATE entity_links SET label = ?, metadata_json = ? WHERE id = ?')
          .run(relationshipValueOnly ? current.label : relationship.title?.trim() || current.label, nextMetadata, current.id);
      } else {
        this.db.prepare(`
          INSERT INTO entity_links (id, workspaceId, fromId, relType, toId, label, metadata_json, createdAt)
          VALUES (?, ?, ?, 'related_to', ?, ?, ?, ?)
        `).run(randomUUID(), workspaceId, relationship.sourceEntityId, relationship.targetEntityId, relationshipValueOnly ? null : relationship.title?.trim() || relationship.dimension, nextMetadata, Date.now());
      }
    }
  }

  private syncAwarenessCards(workspaceId: string, record: NarrativeEventLedgerRecord): void {
    const eventId = record.proposal.changeSet.event.id;
    const appliedOperationIds = this.appliedOperationIds(workspaceId, eventId);
    this.db.transaction(() => {
      for (const operation of record.proposal.changeSet.operations) {
        if (!appliedOperationIds.has(operation.id)) continue;
        if (operation.type === 'grant-awareness') {
          this.knowledgeCards.ensureAwareness({
            workspaceId,
            ownerId: operation.awareness.subjectId,
            targetId: operation.awareness.targetId,
            sourceType: 'narrative',
            sourceId: eventId,
          });
        } else if (operation.type === 'grant-knowledge') {
          const sourceId = operation.knowledge.entryId || operation.knowledge.id;
          this.knowledgeCards.ensureAwareness({
            workspaceId,
            ownerId: operation.knowledge.subjectId,
            targetId: operation.knowledge.proposition.subjectId,
            sourceType: 'statement',
            sourceId,
          });
          // Being told something means knowing who told you. Doing this here rather than as
          // its own operation keeps the review list about what the scene showed, while the
          // card layer still ends up consistent with the record it just wrote.
          for (const informantId of operation.knowledge.informantIds ?? []) {
            if (informantId === operation.knowledge.subjectId) continue;
            this.knowledgeCards.ensureAwareness({
              workspaceId,
              ownerId: operation.knowledge.subjectId,
              targetId: informantId,
              sourceType: 'statement',
              sourceId: `informant:${sourceId}:${informantId}`,
            });
          }
        } else if (operation.type === 'set-belief') {
          this.knowledgeCards.ensureAwareness({
            workspaceId,
            ownerId: operation.belief.subjectId,
            targetId: operation.belief.proposition.subjectId,
            sourceType: 'statement',
            sourceId: operation.belief.entryId || operation.belief.id,
          });
        } else if (operation.type === 'set-relationship') {
          this.knowledgeCards.ensureAwareness({
            workspaceId,
            ownerId: operation.relationship.sourceEntityId,
            targetId: operation.relationship.targetEntityId,
            sourceType: 'relationship',
            sourceId: operation.relationship.id,
          });
        }
      }
    })();
  }

  private appliedOperationIds(workspaceId: string, eventId: string): Set<string> {
    const narrative = this.db.prepare(`
      SELECT operation_id AS id FROM kanora_narrative_records
      WHERE workspace_id = ? AND source_event_id = ?
    `).all(workspaceId, eventId) as Array<{ id: string }>;
    const awareness = this.db.prepare(`
      SELECT operation_id AS id FROM kanora_awareness_records
      WHERE workspace_id = ? AND source_event_id = ?
    `).all(workspaceId, eventId) as Array<{ id: string }>;
    return new Set([...narrative, ...awareness].map(row => row.id));
  }
}

export function isValidNarrativeOperation(operation: NarrativeOperation): boolean {
  return validateNarrativeOperation(operation).success;
}

function buildOperations(
  input: CreateEventInput,
  fingerprint: string,
  currentRelationshipBaseline: (sourceId: string, targetId: string, dimension: string) => RelationshipBaseline,
  hasAwareness: (subjectId: string, targetId: string) => boolean
): NarrativeOperation[] {
  const eventId = `evt_${fingerprint}`;
  const evidenceIds = [`evidence_${fingerprint}`];
  const modelAuthored = (input.provenanceInterpreter ?? 'model') === 'model'
    && input.originType !== 'worldbuild-update';
  return input.event.operations.flatMap((operation, index): NarrativeOperation[] => {
    if (!isAllowed(operation, input.allowedEntityIds, input.excludedRelationshipSourceIds)) return [];
    if (modelAuthored && isSceneStateOperation(operation)) return [];
    const suffix = `${fingerprint}_${index}`;
    if (operation.type === 'fact') return [{
      id: `op_${suffix}`,
      type: 'assert-fact',
      evidenceIds,
      fact: {
        id: `fact_${suffix}`,
        proposition: operation.proposition,
        status: 'active',
        evidenceIds
      }
    }];
    if (operation.type === 'awareness') {
      // Awareness is binary and permanent, so re-granting a pair that already holds one records
      // nothing. Without this the store gains a row every scene the two share, and the knowledge
      // card behind it counts the same relationship several times.
      if (hasAwareness(operation.subjectId, operation.targetId)) return [];
      return [{
        id: `op_${suffix}`,
        type: 'grant-awareness',
        evidenceIds,
        awareness: {
          id: `awareness_${suffix}`,
          subjectId: operation.subjectId,
          targetId: operation.targetId,
          status: 'active',
          sourceEventId: eventId
        }
      }];
    }
    if (operation.type === 'knowledge') {
      const aware = input.event.operations.some(candidate => (
        candidate.type === 'awareness'
        && candidate.subjectId === operation.subjectId
        && candidate.targetId === operation.proposition.subjectId
      ));
      const supportedByDocument = input.originType === 'worldbuild-update';
      if (confidence(operation.confidence) < MIN_KNOWLEDGE_CONFIDENCE) return [];
      const needsAwareness = !aware
        && !hasAwareness(operation.subjectId, operation.proposition.subjectId)
        && !supportedByDocument;
      if (needsAwareness && !input.event.participantIds.includes(operation.subjectId)) return [];
      const operations: NarrativeOperation[] = [
        ...(needsAwareness ? [{
          id: `op_${suffix}_awareness`,
          type: 'grant-awareness',
          evidenceIds,
          awareness: {
            id: `awareness_${suffix}`,
            subjectId: operation.subjectId,
            targetId: operation.proposition.subjectId,
            status: 'active',
            sourceEventId: eventId
          }
        } as const] : []),
        { id: `op_${suffix}`, type: 'grant-knowledge', evidenceIds, knowledge: { id: `knowledge_${suffix}`, entryId: `entry_${suffix}`, subjectId: operation.subjectId, proposition: operation.proposition, sourceEventId: eventId, acquisition: operation.acquisition, confidence: confidence(operation.confidence), accessibility: operation.accessibility ?? 'available', status: 'active', ...informants(operation, input.allowedEntityIds) } }
      ];
      return operations.every(isValidNarrativeOperation) ? operations : [];
    }
    if (operation.type === 'belief') {
      const aware = input.event.operations.some(candidate => (
        candidate.type === 'awareness'
        && candidate.subjectId === operation.subjectId
        && candidate.targetId === operation.proposition.subjectId
      ));
      const needsAwareness = !aware && !hasAwareness(operation.subjectId, operation.proposition.subjectId);
      if (needsAwareness && !input.event.participantIds.includes(operation.subjectId)) return [];
      const operations: NarrativeOperation[] = [
        ...(needsAwareness ? [{
          id: `op_${suffix}_awareness`,
          type: 'grant-awareness',
          evidenceIds,
          awareness: {
            id: `awareness_${suffix}`,
            subjectId: operation.subjectId,
            targetId: operation.proposition.subjectId,
            status: 'active',
            sourceEventId: eventId
          }
        } as const] : []),
        { id: `op_${suffix}`, type: 'set-belief', evidenceIds, belief: { id: `belief_${suffix}`, entryId: `entry_${suffix}`, subjectId: operation.subjectId, proposition: operation.proposition, sourceEventId: eventId, confidence: confidence(operation.confidence), relationToCanon: 'unknown', status: 'active' } }
      ];
      return operations.every(isValidNarrativeOperation) ? operations : [];
    }
    if (operation.type === 'memory') return [{ id: `op_${suffix}`, type: 'record-memory', evidenceIds, memory: { id: `memory_${suffix}`, subjectId: operation.subjectId, eventId, summary: operation.summary.trim(), accessibility: operation.accessibility ?? 'available', status: 'active', relatedEntityIds: unique(operation.relatedEntityIds ?? []).filter(id => input.allowedEntityIds.has(id)) } }];
    const valueOnly = (input.provenanceInterpreter ?? 'model') === 'model'
      && input.originType !== 'worldbuild-update';
    const dimension = valueOnly ? 'overall' : operation.dimension.trim().toLowerCase();
    const baseline = currentRelationshipBaseline(operation.sourceEntityId, operation.targetEntityId, dimension);
    const previousValue = baseline.value;
    const requestedValue = Math.max(-100, Math.min(100, Number(operation.value)));
    if (!Number.isFinite(requestedValue)) return [];
    if (valueOnly && baseline.exists && Math.abs(requestedValue - previousValue) < MIN_RELATIONSHIP_VALUE) return [];
    const requestedImpact = operation.impact === 'drastic' || operation.impact === 'significant' ? operation.impact : 'meaningful';
    let impact: keyof typeof RELATIONSHIP_IMPACT_LIMITS = requestedImpact;
    if (impact === 'drastic' && input.event.confidence < 0.95) impact = 'significant';
    if (impact === 'significant' && input.event.confidence < 0.9) impact = 'meaningful';
    const maximumDelta = RELATIONSHIP_IMPACT_LIMITS[impact];
    const maximumInitialValue = INITIAL_RELATIONSHIP_LIMITS[impact];
    const delta = Math.sign(requestedValue - previousValue) * Math.min(Math.abs(requestedValue - previousValue), maximumDelta);
    const value = valueOnly
      ? baseline.exists
        ? Math.max(-100, Math.min(100, previousValue + delta))
        : Math.max(-maximumInitialValue, Math.min(maximumInitialValue, requestedValue))
      : requestedValue;
    const alreadyAwareThisEvent = input.event.operations.some(candidate => (
      candidate.type === 'awareness'
      && candidate.subjectId === operation.sourceEntityId
      && candidate.targetId === operation.targetEntityId
    ));
    return [
      ...(!alreadyAwareThisEvent ? [{
        id: `op_${suffix}_awareness`,
        type: 'grant-awareness',
        evidenceIds,
        awareness: {
          id: `awareness_${suffix}`,
          subjectId: operation.sourceEntityId,
          targetId: operation.targetEntityId,
          status: 'active',
          sourceEventId: eventId
        }
      } as const] : []),
      {
        id: `op_${suffix}`,
        type: 'set-relationship',
        evidenceIds,
        relationship: {
          id: `relationship_${suffix}`,
          sourceEntityId: operation.sourceEntityId,
          targetEntityId: operation.targetEntityId,
          dimension,
          value,
          previousValue,
          sourceEventId: eventId,
          ...(!valueOnly && operation.title?.trim() ? { title: operation.title.trim() } : {}),
          ...(!valueOnly && operation.description?.trim() ? { description: operation.description.trim() } : {})
        }
      }
    ];
  });
}

/**
 * Who told the subject, kept only for hearsay. A first-hand acquisition has no teller, and
 * a subject cannot be their own source, so both are dropped rather than trusted from the
 * model. Returns nothing when there is no one to name, so the field stays absent.
 */
function informants(
  operation: Extract<ExtractedNarrativeOperation, { type: 'knowledge' }>,
  allowed: Set<string>
): { informantIds?: string[] } {
  if (operation.acquisition !== 'reported') return {};
  const ids = unique(operation.informantIds ?? [])
    .filter(id => id !== operation.subjectId && allowed.has(id));
  return ids.length ? { informantIds: ids } : {};
}

function deduplicateAwarenessOperations(operations: NarrativeOperation[]): NarrativeOperation[] {
  const awarenessPairs = new Set<string>();
  return operations.filter(operation => {
    if (operation.type !== 'grant-awareness') return true;
    const pair = `${operation.awareness.subjectId}\u0000${operation.awareness.targetId}`;
    if (awarenessPairs.has(pair)) return false;
    awarenessPairs.add(pair);
    return true;
  });
}

function isSceneStateOperation(operation: ExtractedNarrativeOperation): boolean {
  if (operation.type !== 'fact' && operation.type !== 'knowledge' && operation.type !== 'belief') return false;
  return SCENE_STATE_PREDICATES.has(normalizePredicate(operation.proposition.predicate));
}

function normalizePredicate(predicate: string): string {
  return normalizeText(predicate).replace(/[\s_]+/g, '-');
}

function isAllowed(operation: ExtractedNarrativeOperation, allowed: Set<string>, excludedRelationshipSourceIds = new Set<string>()): boolean {
  if (operation.type === 'relationship') {
    return typeof operation.sourceEntityId === 'string'
      && typeof operation.targetEntityId === 'string'
      && !excludedRelationshipSourceIds.has(operation.sourceEntityId)
      && allowed.has(operation.sourceEntityId)
      && allowed.has(operation.targetEntityId)
      && typeof operation.dimension === 'string'
      && Boolean(operation.dimension.trim());
  }
  if (operation.type === 'fact') return allowed.has(operation.proposition.subjectId) && Boolean(operation.proposition.predicate.trim());
  if (!allowed.has(operation.subjectId)) return false;
  if (operation.type === 'awareness') return allowed.has(operation.targetId);
  if (operation.type === 'knowledge' || operation.type === 'belief') return allowed.has(operation.proposition.subjectId) && Boolean(operation.proposition.predicate.trim());
  if (operation.type === 'memory') return operation.salience >= 0.65 && Boolean(operation.summary.trim());
  return true;
}

function requiresReview(event: ExtractedNarrativeEvent): boolean {
  if (event.confidence < AUTO_CONFIDENCE) return true;
  return event.operations.some(operation => {
    if (operation.type === 'belief' || operation.type === 'relationship') return true;
    if (operation.type === 'memory') return operation.salience < AUTO_MEMORY_SALIENCE;
    return operation.confidence < AUTO_CONFIDENCE;
  });
}

function fingerprintEvent(workspaceId: string, originId: string, event: ExtractedNarrativeEvent): string {
  return createHash('sha256').update(JSON.stringify({ workspaceId, originId, type: event.type, description: event.description.trim().toLowerCase(), operations: event.operations })).digest('hex').slice(0, 24);
}

function unique(values: string[]): string[] { return [...new Set(values.filter(Boolean))]; }
function confidence(value: number): number { return Math.max(0, Math.min(1, Number(value))); }
function normalizeText(value: string): string { return value.trim().toLocaleLowerCase().replace(/\s+/g, ' '); }
