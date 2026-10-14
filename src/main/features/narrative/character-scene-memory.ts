import type Database from 'better-sqlite3';
import { randomUUID } from 'node:crypto';

export type MemoryLineKind = 'perceived' | 'heard';

export interface SceneMemoryUpdate {
  entityId: string;
  perceived: string[];
  heard: Array<{ fromId: string | null; text: string }>;
  stance: string;
}

export interface MemoryLine {
  kind: MemoryLineKind;
  text: string;
  sourceId: string | null;
}

export interface CharacterMemoryView {
  entityId: string;
  current: { lines: MemoryLine[]; stance: string | null };
  earlier: { lines: MemoryLine[]; stance: string | null; locationId: string | null; timeLabel: string | null } | null;
}

export interface TurnPresence {
  originId: string;
  locationId: string | null;
  presentIds: string[];
  timeLabel: string | null;
  createdAt: number;
}

export interface PresenceNoteMessage {
  id: string;
  role: string;
}

const LINES_PER_TURN = 4;
const LINE_CHARACTERS = 240;
const STANCE_CHARACTERS = 200;
const CURRENT_LINES = 10;
const EARLIER_LINES = 5;
const KEPT_ROWS_PER_CHARACTER = 60;
const PRESENCE_HISTORY = 400;

const ACTIVE_ORIGIN = `
  LEFT JOIN narrative_origin_lifecycle AS lifecycle
    ON lifecycle.workspace_id = presence.workspace_id AND lifecycle.origin_id = presence.origin_id
  WHERE COALESCE(lifecycle.status, 'active') = 'active'
`;

/**
 * What each character has perceived or been told, from their own point of view. It is working
 * memory, not story state: nothing here passes the Narrative State durability gate.
 */
export class CharacterSceneMemory {
  constructor(private readonly db: Database.Database) {}

  /** Replaces whatever an earlier run of the same reply wrote, so a reprocessed turn never doubles. */
  recordTurn(input: {
    workspaceId: string;
    originId: string;
    presentIds: string[];
    locationId: string | null;
    createdAt: number;
    updates: SceneMemoryUpdate[];
  }): void {
    const insert = this.db.prepare(`
      INSERT INTO roleplay_character_memory (
        workspace_id, entry_id, entity_id, origin_id, kind, text, source_id, ordinal, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const prune = this.db.prepare(`
      DELETE FROM roleplay_character_memory
      WHERE workspace_id = ? AND entity_id = ? AND entry_id IN (
        SELECT entry_id FROM roleplay_character_memory
        WHERE workspace_id = ? AND entity_id = ?
        ORDER BY created_at DESC, ordinal DESC
        LIMIT -1 OFFSET ?
      )
    `);
    this.db.transaction(() => {
      this.db.prepare('DELETE FROM roleplay_character_memory WHERE workspace_id = ? AND origin_id = ?')
        .run(input.workspaceId, input.originId);
      this.db.prepare(`
        INSERT INTO roleplay_turn_presence (workspace_id, origin_id, location_id, present_ids_json, time_label, created_at)
        VALUES (?, ?, ?, ?, NULL, ?)
        ON CONFLICT(workspace_id, origin_id) DO UPDATE SET
          location_id = excluded.location_id,
          present_ids_json = excluded.present_ids_json,
          created_at = excluded.created_at
      `).run(input.workspaceId, input.originId, input.locationId, JSON.stringify(unique(input.presentIds)), input.createdAt);
      for (const update of input.updates) {
        let ordinal = 0;
        const add = (kind: string, text: string, sourceId: string | null) => insert.run(
          input.workspaceId, randomUUID(), update.entityId, input.originId, kind, text, sourceId, ordinal++, input.createdAt
        );
        update.perceived.forEach(text => add('perceived', text, null));
        update.heard.forEach(line => add('heard', line.text, line.fromId));
        if (update.stance) add('stance', update.stance, null);
        prune.run(input.workspaceId, update.entityId, input.workspaceId, update.entityId, KEPT_ROWS_PER_CHARACTER);
      }
    })();
  }

  /** Where and when the turn ended, known only once the scene and the clock have moved. */
  settleTurn(workspaceId: string, originId: string, end: { locationId: string | null; timeLabel: string | null }): void {
    this.db.prepare(`
      UPDATE roleplay_turn_presence SET location_id = COALESCE(?, location_id), time_label = ?
      WHERE workspace_id = ? AND origin_id = ?
    `).run(end.locationId, end.timeLabel, workspaceId, originId);
  }

  latestStances(workspaceId: string, entityIds: string[]): Array<{ entityId: string; stance: string }> {
    const ids = unique(entityIds);
    if (!ids.length) return [];
    const rows = this.db.prepare(`
      SELECT memory.entity_id AS entityId, memory.text AS stance
      FROM roleplay_character_memory AS memory
      JOIN roleplay_turn_presence AS presence
        ON presence.workspace_id = memory.workspace_id AND presence.origin_id = memory.origin_id
      ${ACTIVE_ORIGIN}
        AND memory.workspace_id = ? AND memory.kind = 'stance'
        AND memory.entity_id IN (${ids.map(() => '?').join(', ')})
      ORDER BY memory.created_at DESC, memory.ordinal DESC
    `).all(workspaceId, ...ids) as Array<{ entityId: string; stance: string }>;
    const seen = new Set<string>();
    return rows.filter(row => !seen.has(row.entityId) && seen.add(row.entityId));
  }

  /**
   * Splits each character's memory at their last absence: what came after it is this stay in the
   * scene, what came before is where they left off last time.
   */
  load(workspaceId: string, entityIds: string[]): CharacterMemoryView[] {
    const ids = unique(entityIds);
    if (!ids.length) return [];
    const presence = this.recentPresence(workspaceId);
    const rows = this.db.prepare(`
      SELECT memory.entity_id AS entityId, memory.kind, memory.text, memory.source_id AS sourceId,
        memory.created_at AS createdAt, presence.location_id AS locationId, presence.time_label AS timeLabel
      FROM roleplay_character_memory AS memory
      JOIN roleplay_turn_presence AS presence
        ON presence.workspace_id = memory.workspace_id AND presence.origin_id = memory.origin_id
      ${ACTIVE_ORIGIN}
        AND memory.workspace_id = ? AND memory.entity_id IN (${ids.map(() => '?').join(', ')})
      ORDER BY memory.created_at ASC, memory.ordinal ASC
    `).all(workspaceId, ...ids) as Array<{
      entityId: string; kind: 'perceived' | 'heard' | 'stance'; text: string; sourceId: string | null;
      createdAt: number; locationId: string | null; timeLabel: string | null;
    }>;
    return ids.flatMap(entityId => {
      const own = rows.filter(row => row.entityId === entityId);
      if (!own.length) return [];
      const absentAt = lastAbsence(presence, entityId);
      const current = own.filter(row => row.createdAt > absentAt);
      const earlier = own.filter(row => row.createdAt <= absentAt);
      const lastEarlier = earlier[earlier.length - 1];
      return [{
        entityId,
        current: { lines: toLines(current).slice(-CURRENT_LINES), stance: lastStance(current) },
        earlier: lastEarlier ? {
          lines: toLines(earlier).slice(-EARLIER_LINES),
          stance: lastStance(earlier),
          locationId: lastEarlier.locationId,
          timeLabel: lastEarlier.timeLabel
        } : null
      }];
    });
  }

  /**
   * For each user message where the cast differs from the last note, who was in the scene when the
   * player acted. Keyed to stored replies only, so a message keeps the same note on every request.
   */
  presenceNotes(workspaceId: string, messages: PresenceNoteMessage[]): Map<string, string> {
    const replyIds = messages.filter(message => message.role !== 'user').map(message => message.id);
    const byOrigin = new Map(this.presenceFor(workspaceId, replyIds).map(entry => [entry.originId, entry]));
    if (!byOrigin.size) return new Map();
    const names = this.names(workspaceId, [...byOrigin.values()].flatMap(entry => [entry.locationId ?? '', ...entry.presentIds]));
    const notes = new Map<string, string>();
    let inEffect: TurnPresence | null = null;
    let lastKey: string | null = null;
    for (const message of messages) {
      if (message.role !== 'user') {
        inEffect = byOrigin.get(message.id) ?? inEffect;
        continue;
      }
      if (!inEffect) continue;
      const key = presenceKey(inEffect);
      if (key === lastKey) continue;
      lastKey = key;
      notes.set(message.id, formatPresenceNote(inEffect, names));
    }
    return notes;
  }

  names(workspaceId: string, entityIds: string[]): Map<string, string> {
    const ids = unique(entityIds);
    if (!ids.length) return new Map();
    const rows = this.db.prepare(`
      SELECT id, canonicalName FROM entities
      WHERE workspaceId = ? AND id IN (${ids.map(() => '?').join(', ')})
    `).all(workspaceId, ...ids) as Array<{ id: string; canonicalName: string }>;
    return new Map(rows.map(row => [row.id, row.canonicalName]));
  }

  private presenceFor(workspaceId: string, originIds: string[]): TurnPresence[] {
    const ids = unique(originIds);
    if (!ids.length) return [];
    const found: TurnPresence[] = [];
    // SQLite caps bound parameters, and a long chat holds more replies than that.
    for (let start = 0; start < ids.length; start += 500) {
      const chunk = ids.slice(start, start + 500);
      const rows = this.db.prepare(`
        SELECT presence.origin_id, presence.location_id, presence.present_ids_json, presence.time_label, presence.created_at
        FROM roleplay_turn_presence AS presence
        ${ACTIVE_ORIGIN}
          AND presence.workspace_id = ? AND presence.origin_id IN (${chunk.map(() => '?').join(', ')})
      `).all(workspaceId, ...chunk) as PresenceRow[];
      found.push(...rows.map(toPresence));
    }
    return found;
  }

  private recentPresence(workspaceId: string): TurnPresence[] {
    const rows = this.db.prepare(`
      SELECT presence.origin_id, presence.location_id, presence.present_ids_json, presence.time_label, presence.created_at
      FROM roleplay_turn_presence AS presence
      ${ACTIVE_ORIGIN}
        AND presence.workspace_id = ?
      ORDER BY presence.created_at DESC
      LIMIT ?
    `).all(workspaceId, PRESENCE_HISTORY) as PresenceRow[];
    return rows.map(toPresence);
  }
}

/** Keeps only what the triage may write: present non-player characters, short lines, known speakers. */
export function normalizeSceneMemoryUpdates(
  value: unknown,
  options: { eligibleIds: Iterable<string>; speakerIds: Iterable<string> }
): SceneMemoryUpdate[] {
  if (!Array.isArray(value)) return [];
  const eligible = new Set(options.eligibleIds);
  const speakers = new Set(options.speakerIds);
  const byEntity = new Map<string, SceneMemoryUpdate>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const raw = item as Record<string, unknown>;
    const entityId = typeof raw.entityId === 'string' ? raw.entityId : '';
    if (!eligible.has(entityId)) continue;
    const update = byEntity.get(entityId) ?? { entityId, perceived: [], heard: [], stance: '' };
    const perceived = Array.isArray(raw.perceived) ? raw.perceived.map(line => clean(line, LINE_CHARACTERS)).filter(Boolean) : [];
    const heard = Array.isArray(raw.heard)
      ? raw.heard.flatMap(line => {
        if (!line || typeof line !== 'object') return [];
        const entry = line as Record<string, unknown>;
        const text = clean(entry.text, LINE_CHARACTERS);
        const fromId = typeof entry.fromId === 'string' && speakers.has(entry.fromId) && entry.fromId !== entityId ? entry.fromId : null;
        return text ? [{ fromId, text }] : [];
      })
      : [];
    update.perceived = uniqueText([...update.perceived, ...perceived]).slice(0, LINES_PER_TURN);
    update.heard = uniqueHeard([...update.heard, ...heard]).slice(0, LINES_PER_TURN);
    update.stance = clean(raw.stance, STANCE_CHARACTERS) || update.stance;
    byEntity.set(entityId, update);
  }
  return [...byEntity.values()].filter(update => update.perceived.length || update.heard.length || update.stance);
}

export function formatCharacterMemorySection(views: CharacterMemoryView[], names: Map<string, string>): string {
  const blocks = views.flatMap(view => {
    const name = names.get(view.entityId);
    if (!name) return [];
    const lines: string[] = [];
    if (view.current.lines.length || view.current.stance) {
      lines.push('  In this scene so far:', ...view.current.lines.map(line => `  - ${formatLine(line, names)}`));
      if (view.current.stance) lines.push(`  - stance: ${view.current.stance}`);
    }
    if (view.earlier && (view.earlier.lines.length || view.earlier.stance)) {
      const where = [view.earlier.locationId ? names.get(view.earlier.locationId) : null, view.earlier.timeLabel].filter(Boolean).join(', ');
      lines.push(
        `  Where they left off last time${where ? ` (${where})` : ''}. The world has moved on since; treat it as their past, not their present:`,
        ...view.earlier.lines.map(line => `  - ${formatLine(line, names)}`)
      );
      if (view.earlier.stance) lines.push(`  - stance then: ${view.earlier.stance}`);
    }
    return lines.length ? [[name, ...lines].join('\n')] : [];
  });
  if (!blocks.length) return '';
  return [
    '--- CHARACTER SCENE MEMORY ---',
    'Each character present, from their own point of view: what they perceived and what they were told. A claim they heard is what was said, not the truth. Their words and choices may rest on this, on their own perspective section and on what happens in front of them now, never on narration they were absent from.',
    ...blocks
  ].join('\n\n');
}

export function formatPresenceNote(presence: Pick<TurnPresence, 'locationId' | 'presentIds'>, names: Map<string, string>): string {
  const cast = presence.presentIds.map(id => names.get(id)).filter(Boolean);
  const place = presence.locationId ? names.get(presence.locationId) : undefined;
  return `[In the scene${place ? ` at ${place}` : ''}: ${cast.length ? cast.join(', ') : 'no named character'}]`;
}

interface PresenceRow {
  origin_id: string;
  location_id: string | null;
  present_ids_json: string;
  time_label: string | null;
  created_at: number;
}

function toPresence(row: PresenceRow): TurnPresence {
  return {
    originId: row.origin_id,
    locationId: row.location_id,
    presentIds: parseIds(row.present_ids_json),
    timeLabel: row.time_label,
    createdAt: Number(row.created_at)
  };
}

function lastAbsence(presence: TurnPresence[], entityId: string): number {
  const absent = presence.find(entry => !entry.presentIds.includes(entityId));
  return absent ? absent.createdAt : Number.NEGATIVE_INFINITY;
}

function toLines(rows: Array<{ kind: string; text: string; sourceId: string | null }>): MemoryLine[] {
  return rows
    .filter(row => row.kind === 'perceived' || row.kind === 'heard')
    .map(row => ({ kind: row.kind as MemoryLineKind, text: row.text, sourceId: row.sourceId }));
}

function lastStance(rows: Array<{ kind: string; text: string }>): string | null {
  for (let index = rows.length - 1; index >= 0; index--) {
    if (rows[index].kind === 'stance') return rows[index].text;
  }
  return null;
}

function formatLine(line: MemoryLine, names: Map<string, string>): string {
  if (line.kind === 'perceived') return `perceived: ${line.text}`;
  const speaker = line.sourceId ? names.get(line.sourceId) : undefined;
  return `heard${speaker ? ` from ${speaker}` : ''}: ${line.text}`;
}

function presenceKey(presence: TurnPresence): string {
  return `${presence.locationId ?? ''}\u0000${[...presence.presentIds].sort().join('\u0000')}`;
}

function parseIds(value: string): string[] {
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? unique(parsed.filter((id): id is string => typeof id === 'string')) : [];
  } catch {
    return [];
  }
}

function clean(value: unknown, limit: number): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, limit) : '';
}

function uniqueText(values: string[]): string[] {
  const seen = new Set<string>();
  return values.filter(value => {
    const key = value.toLowerCase();
    return !seen.has(key) && Boolean(seen.add(key));
  });
}

function uniqueHeard(values: Array<{ fromId: string | null; text: string }>) {
  const seen = new Set<string>();
  return values.filter(value => {
    const key = `${value.fromId ?? ''}\u0000${value.text.toLowerCase()}`;
    return !seen.has(key) && Boolean(seen.add(key));
  });
}

function unique(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))];
}
