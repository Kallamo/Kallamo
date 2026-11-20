import type Database from 'better-sqlite3';
import type { NarrativeOperation } from '../../../../narrative/contracts';
import { storyMinute, type OrdinalCalendar } from '../../../../shared/calendar-ordinal';
import { writeStoryEvent } from './story-journal';
import { indexOriginRecords } from './story-lifecycle';
import type { StoryProvenanceInput } from './story-writer';

/** Tables the narrative ledger kept its applied records in before the story file existed. */
export const LEGACY_STORY_TABLES = ['narrative_records', 'narrative_awareness_records', 'narrative_change_set_attempts', 'narrative_state_fingerprints'] as const;

export interface LegacyImportReport {
  workspaces: number;
  events: number;
  skippedEvents: number;
}

interface EventRow {
  event_id: string;
  event_type: string;
  description: string;
  location_id: string | null;
  provenance_interpreter: string;
  provenance_interpreter_id: string | null;
  provenance_prompt_version: string | null;
  origin_type: string | null;
  origin_id: string | null;
  excerpt: string | null;
  lifecycle: string | null;
}

interface RecordRow { record_type: string; record_id: string; operation_id: string; payload_json: string }

const OPERATION_TYPES: Record<string, { type: NarrativeOperation['type']; key: string }> = {
  fact: { type: 'assert-fact', key: 'fact' },
  state: { type: 'set-state', key: 'state' },
  knowledge: { type: 'grant-knowledge', key: 'knowledge' },
  belief: { type: 'set-belief', key: 'belief' },
  memory: { type: 'record-memory', key: 'memory' },
  relationship: { type: 'set-relationship', key: 'relationship' },
  observation: { type: 'record-observation', key: 'observation' }
};

function hasTable(db: Database.Database, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function parse(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function interpreterOf(value: string): StoryProvenanceInput['interpreter'] {
  if (value === 'model' || value === 'user' || value === 'import') return value;
  return 'deterministic';
}

/** An occurrence sits at its own date; everything else at its turn, or the clock when it has none. */
function occurrenceMinute(db: Database.Database, workspaceId: string, originId: string): number | null | undefined {
  if (!originId.startsWith('worldbuild-occurrence:') || !hasTable(db, 'worldbuild_event_occurrences') || !hasTable(db, 'worldbuild_calendars')) return undefined;
  const row = db.prepare('SELECT start_date_json FROM worldbuild_event_occurrences WHERE workspace_id = ? AND origin_id = ?')
    .get(workspaceId, originId) as { start_date_json: string | null } | undefined;
  const date = parse(row?.start_date_json ?? null);
  const calendar = parse((db.prepare('SELECT definition_json FROM worldbuild_calendars WHERE workspace_id = ?')
    .get(workspaceId) as { definition_json: string } | undefined)?.definition_json ?? null);
  return date && calendar ? storyMinute(calendar as unknown as OrdinalCalendar, date) ?? undefined : undefined;
}

/**
 * Replays what earlier versions applied into each story file, event by event, leaving out removed
 * turns. Each event is written under its own attempt, so a second replay changes nothing.
 */
export function importLegacyStory(db: Database.Database, log: (message: string) => void = () => {}): LegacyImportReport {
  const report: LegacyImportReport = { workspaces: 0, events: 0, skippedEvents: 0 };
  if (!hasTable(db, 'narrative_records') || !hasTable(db, 'narrative_events')) return report;
  const hasAwareness = hasTable(db, 'narrative_awareness_records');
  const hasChats = hasTable(db, 'chats');
  const workspaces = (db.prepare(`
    SELECT DISTINCT workspace_id AS id FROM narrative_records
    ${hasAwareness ? 'UNION SELECT DISTINCT workspace_id AS id FROM narrative_awareness_records' : ''}
  `).all() as Array<{ id: string }>).map(row => row.id)
    .filter(id => !hasChats || db.prepare('SELECT 1 FROM chats WHERE id = ?').get(id));
  const records = db.prepare(`
    SELECT record_type, record_id, operation_id, payload_json FROM narrative_records
    WHERE workspace_id = ? AND source_event_id = ? ORDER BY rowid
  `);
  const awareness = hasAwareness ? db.prepare(`
    SELECT awareness_id, operation_id, payload_json FROM narrative_awareness_records
    WHERE workspace_id = ? AND source_event_id = ? ORDER BY rowid
  `) : null;
  const participants = db.prepare('SELECT entity_id FROM narrative_event_participants WHERE workspace_id = ? AND event_id = ? ORDER BY ordinal');
  for (const workspaceId of workspaces) {
    report.workspaces += 1;
    const events = db.prepare(`
      SELECT events.event_id, events.event_type, events.description, events.location_id,
        events.provenance_interpreter, events.provenance_interpreter_id, events.provenance_prompt_version,
        evidence.origin_type, evidence.origin_id, evidence.excerpt, lifecycle.status AS lifecycle
      FROM narrative_events events
      LEFT JOIN narrative_event_evidence evidence
        ON evidence.workspace_id = events.workspace_id AND evidence.event_id = events.event_id AND evidence.ordinal = 0
      LEFT JOIN narrative_origin_lifecycle lifecycle
        ON lifecycle.workspace_id = events.workspace_id AND lifecycle.origin_id = evidence.origin_id
      WHERE events.workspace_id = ?
      ORDER BY events.narrative_sequence, events.event_id
    `).all(workspaceId) as EventRow[];
    for (const event of events) {
      if (event.lifecycle && event.lifecycle !== 'active') continue;
      const operations: NarrativeOperation[] = [];
      for (const row of records.all(workspaceId, event.event_id) as RecordRow[]) {
        const shape = OPERATION_TYPES[row.record_type];
        const payload = parse(row.payload_json);
        if (!shape || !payload) continue;
        const id = String(payload.id ?? row.record_id);
        operations.push({ id: row.operation_id, type: shape.type, evidenceIds: [], [shape.key]: { ...payload, id } } as unknown as NarrativeOperation);
      }
      for (const row of (awareness?.all(workspaceId, event.event_id) ?? []) as Array<{ awareness_id: string; operation_id: string; payload_json: string }>) {
        const payload = parse(row.payload_json);
        if (!payload) continue;
        operations.push({ id: row.operation_id, type: 'grant-awareness', evidenceIds: [], awareness: { ...payload, id: row.awareness_id } } as unknown as NarrativeOperation);
      }
      if (!operations.length) continue;
      const originId = event.origin_id ?? undefined;
      try {
        const minute = originId ? occurrenceMinute(db, workspaceId, originId) : undefined;
        const result = writeStoryEvent(db, workspaceId, {
          eventId: event.event_id,
          description: event.description,
          participants: (participants.all(workspaceId, event.event_id) as Array<{ entity_id: string }>).map(row => row.entity_id),
          locationId: event.location_id,
          provenance: {
            interpreter: interpreterOf(event.provenance_interpreter),
            ...(event.provenance_interpreter_id ? { interpreterId: event.provenance_interpreter_id } : {}),
            ...(event.provenance_prompt_version ? { promptVersion: event.provenance_prompt_version } : {}),
            ...(event.origin_type ? { originType: event.origin_type } : {}),
            ...(originId ? { originId } : {}),
            ...(event.excerpt ? { excerpt: event.excerpt } : {})
          },
          operations,
          placement: 'main',
          ...(minute !== undefined ? { storyMinute: minute } : {})
        });
        // Turns and occurrences can still be removed later, so what they wrote is indexed under them.
        if (originId && (event.origin_type === 'chat-message' || originId.startsWith('worldbuild-occurrence:'))) {
          indexOriginRecords(db, workspaceId, originId, result.outcome);
        }
        report.events += 1;
      } catch (error) {
        report.skippedEvents += 1;
        log(`Skipped narrative event ${event.event_id} of ${workspaceId}: ${(error as Error).message}`);
      }
    }
  }
  return report;
}
