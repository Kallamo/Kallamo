import type Database from 'better-sqlite3';
import { storyMinute, type OrdinalCalendar } from '../../../../shared/calendar-ordinal';

function parse(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'string' || !value) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function hasTable(db: Database.Database, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

/**
 * The story-axis minute of a write: the turn's start when it has a time frame, else the roleplay
 * clock. Null without a clock, so the event stays off the axis.
 */
export function storyMinuteFor(db: Database.Database, workspaceId: string, originId?: string | null): number | null {
  if (!hasTable(db, 'worldbuild_calendars') || !hasTable(db, 'roleplay_time_state')) return null;
  const calendar = parse((db.prepare('SELECT definition_json FROM worldbuild_calendars WHERE workspace_id = ?')
    .get(workspaceId) as { definition_json: string } | undefined)?.definition_json) as OrdinalCalendar | null;
  if (!calendar) return null;
  const frame = originId && hasTable(db, 'roleplay_message_frames')
    ? parse((db.prepare('SELECT start_json FROM roleplay_message_frames WHERE workspace_id = ? AND origin_id = ?')
      .get(workspaceId, originId) as { start_json: string } | undefined)?.start_json)
    : null;
  const position = (frame?.position as Record<string, unknown> | undefined)
    ?? parse((db.prepare('SELECT position_json FROM roleplay_time_state WHERE workspace_id = ?')
      .get(workspaceId) as { position_json: string } | undefined)?.position_json);
  return position ? storyMinute(calendar, position) : null;
}
