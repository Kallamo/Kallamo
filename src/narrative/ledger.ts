import type Database from 'better-sqlite3';
import type { NarrativeEvent, NarrativeProposal } from './contracts';
import { validateNarrativeProposal, type ValidationIssue } from './validation';

export type NarrativeEventLedgerStatus = 'proposed' | 'approved' | 'rejected';

export interface NarrativeEventLedgerRecord {
  proposal: NarrativeProposal;
  status: NarrativeEventLedgerStatus;
  version: number;
  decidedAt?: string;
}

export interface SaveNarrativeEventOptions {
  status?: NarrativeEventLedgerStatus;
  version?: number;
  decidedAt?: string;
}

interface EventRow {
  workspace_id: string;
  event_id: string;
  proposal_id: string;
  change_set_id: string;
  contract_version: NarrativeProposal['contractVersion'];
  event_type: NarrativeEvent['type'];
  description: string;
  scene_id: string | null;
  location_id: string | null;
  narrative_sequence: number;
  narrative_timestamp: string | null;
  status: NarrativeEventLedgerStatus;
  version: number;
  operations_json: string;
  provenance_interpreter: NarrativeProposal['provenance']['interpreter'];
  provenance_interpreter_id: string | null;
  provenance_prompt_version: string | null;
  provenance_schema_version: NarrativeProposal['provenance']['schemaVersion'];
  provenance_created_at: string;
  decided_at: string | null;
}

interface ParticipantRow {
  entity_id: string;
  role: string;
}

interface EvidenceRow {
  evidence_id: string;
  origin_type: NarrativeProposal['evidence'][number]['originType'];
  origin_id: string;
  excerpt: string | null;
}

export class NarrativeEventLedgerValidationError extends Error {
  readonly issues: ValidationIssue[];

  constructor(issues: ValidationIssue[]) {
    super('Narrative proposal is not a valid Narrative Contract v1 payload.');
    this.name = 'NarrativeEventLedgerValidationError';
    this.issues = issues;
  }
}

export class NarrativeEventLedgerRepository {
  private readonly insertEvent;
  private readonly insertParticipant;
  private readonly insertEvidence;
  private readonly selectEvent;
  private readonly selectParticipants;
  private readonly selectEvidence;
  private readonly listEvents;
  private readonly updateEventStatus;

  constructor(private readonly db: Database.Database) {
    this.insertEvent = db.prepare(`
      INSERT INTO narrative_events (
        workspace_id, event_id, proposal_id, change_set_id, contract_version,
        event_type, description, scene_id, location_id, narrative_sequence,
        narrative_timestamp, status, version, operations_json,
        provenance_interpreter, provenance_interpreter_id, provenance_prompt_version,
        provenance_schema_version, provenance_created_at, decided_at
      ) VALUES (
        @workspaceId, @eventId, @proposalId, @changeSetId, @contractVersion,
        @eventType, @description, @sceneId, @locationId, @narrativeSequence,
        @narrativeTimestamp, @status, @version, @operationsJson,
        @provenanceInterpreter, @provenanceInterpreterId, @provenancePromptVersion,
        @provenanceSchemaVersion, @provenanceCreatedAt, @decidedAt
      )
    `);
    this.insertParticipant = db.prepare(`
      INSERT INTO narrative_event_participants
        (workspace_id, event_id, ordinal, entity_id, role)
      VALUES (?, ?, ?, ?, ?)
    `);
    this.insertEvidence = db.prepare(`
      INSERT INTO narrative_event_evidence
        (workspace_id, event_id, evidence_id, ordinal, origin_type, origin_id, excerpt)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    this.selectEvent = db.prepare(`
      SELECT * FROM narrative_events WHERE workspace_id = ? AND event_id = ?
    `);
    this.selectParticipants = db.prepare(`
      SELECT entity_id, role FROM narrative_event_participants
      WHERE workspace_id = ? AND event_id = ? ORDER BY ordinal
    `);
    this.selectEvidence = db.prepare(`
      SELECT evidence_id, origin_type, origin_id, excerpt
      FROM narrative_event_evidence
      WHERE workspace_id = ? AND event_id = ? ORDER BY ordinal
    `);
    this.listEvents = db.prepare(`
      SELECT * FROM narrative_events
      WHERE workspace_id = ?
      ORDER BY narrative_sequence, event_id
    `);
    this.updateEventStatus = db.prepare(`
      UPDATE narrative_events
      SET status = ?, version = version + 1, decided_at = ?
      WHERE workspace_id = ? AND event_id = ?
    `);
  }

  save(proposal: NarrativeProposal, options: SaveNarrativeEventOptions = {}): NarrativeEventLedgerRecord {
    const validation = validateNarrativeProposal(proposal);
    if (!validation.success) throw new NarrativeEventLedgerValidationError(validation.issues);

    const status = options.status ?? 'proposed';
    const version = options.version ?? 1;
    if (!Number.isInteger(version) || version < 1) throw new RangeError('Ledger version must be a positive integer.');
    if (status === 'proposed' && options.decidedAt !== undefined) throw new Error('A proposed event cannot have a decision timestamp.');
    if (status !== 'proposed' && options.decidedAt === undefined) throw new Error('Approved and rejected events require a decision timestamp.');

    const event = proposal.changeSet.event;
    const write = this.db.transaction(() => {
      this.insertEvent.run({
        workspaceId: proposal.projectId,
        eventId: event.id,
        proposalId: proposal.id,
        changeSetId: proposal.changeSet.id,
        contractVersion: proposal.contractVersion,
        eventType: event.type,
        description: event.description,
        sceneId: event.sceneId ?? null,
        locationId: event.locationId ?? null,
        narrativeSequence: event.position.sequence,
        narrativeTimestamp: event.position.timestamp ?? null,
        status,
        version,
        operationsJson: JSON.stringify(proposal.changeSet.operations),
        provenanceInterpreter: proposal.provenance.interpreter,
        provenanceInterpreterId: proposal.provenance.interpreterId ?? null,
        provenancePromptVersion: proposal.provenance.promptVersion ?? null,
        provenanceSchemaVersion: proposal.provenance.schemaVersion,
        provenanceCreatedAt: proposal.provenance.createdAt,
        decidedAt: options.decidedAt ?? null
      });

      event.participants.forEach((participant, index) => {
        this.insertParticipant.run(proposal.projectId, event.id, index, participant.entityId, participant.role);
      });
      proposal.evidence.forEach((evidence, index) => {
        this.insertEvidence.run(
          proposal.projectId,
          event.id,
          evidence.id,
          index,
          evidence.originType,
          evidence.originId,
          evidence.excerpt ?? null
        );
      });
    });

    write();
    return this.get(proposal.projectId, event.id)!;
  }

  get(workspaceId: string, eventId: string): NarrativeEventLedgerRecord | undefined {
    const row = this.selectEvent.get(workspaceId, eventId) as EventRow | undefined;
    return row ? this.hydrate(row) : undefined;
  }

  list(workspaceId: string): NarrativeEventLedgerRecord[] {
    return (this.listEvents.all(workspaceId) as EventRow[]).map(row => this.hydrate(row));
  }

  setStatus(
    workspaceId: string,
    eventId: string,
    status: Exclude<NarrativeEventLedgerStatus, 'proposed'>,
    decidedAt: string
  ): NarrativeEventLedgerRecord | undefined {
    const result = this.updateEventStatus.run(status, decidedAt, workspaceId, eventId);
    return result.changes === 0 ? undefined : this.get(workspaceId, eventId);
  }

  private hydrate(row: EventRow): NarrativeEventLedgerRecord {
    const participants = this.selectParticipants.all(row.workspace_id, row.event_id) as ParticipantRow[];
    const evidence = this.selectEvidence.all(row.workspace_id, row.event_id) as EvidenceRow[];
    const event: NarrativeEvent = {
      id: row.event_id,
      type: row.event_type,
      description: row.description,
      participants: participants.map(participant => ({ entityId: participant.entity_id, role: participant.role })),
      position: {
        sequence: row.narrative_sequence,
        ...(row.narrative_timestamp ? { timestamp: row.narrative_timestamp } : {})
      },
      evidenceIds: evidence.map(item => item.evidence_id),
      ...(row.scene_id ? { sceneId: row.scene_id } : {}),
      ...(row.location_id ? { locationId: row.location_id } : {})
    };

    return {
      proposal: {
        contractVersion: row.contract_version,
        id: row.proposal_id,
        projectId: row.workspace_id,
        status: 'proposed',
        changeSet: {
          id: row.change_set_id,
          event,
          operations: JSON.parse(row.operations_json) as NarrativeProposal['changeSet']['operations']
        },
        evidence: evidence.map(item => ({
          id: item.evidence_id,
          originType: item.origin_type,
          originId: item.origin_id,
          ...(item.excerpt !== null ? { excerpt: item.excerpt } : {})
        })),
        provenance: {
          interpreter: row.provenance_interpreter,
          schemaVersion: row.provenance_schema_version,
          createdAt: row.provenance_created_at,
          ...(row.provenance_interpreter_id ? { interpreterId: row.provenance_interpreter_id } : {}),
          ...(row.provenance_prompt_version ? { promptVersion: row.provenance_prompt_version } : {})
        }
      },
      status: row.status,
      version: row.version,
      ...(row.decided_at ? { decidedAt: row.decided_at } : {})
    };
  }
}
