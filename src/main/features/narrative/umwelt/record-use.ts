import type Database from 'better-sqlite3';
import type { NarrativeOperation } from '../../../../narrative/contracts';

function hasTable(db: Database.Database, name: string): boolean {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

/**
 * The stored records an operation draws on: what it corrects, gathers, was told from or reasons
 * from. Being drawn on is what keeps a record within reach; appearing in a context is not.
 */
export function recordsDrawnOn(operations: NarrativeOperation[]): string[] {
  const ids: string[] = [];
  for (const operation of operations) {
    const payload = (operation as unknown as { knowledge?: unknown; belief?: unknown; memory?: unknown });
    const value = (payload.knowledge ?? payload.belief ?? payload.memory) as Record<string, unknown> | undefined;
    if (!value) continue;
    for (const key of ['supersedesId', 'supersedesMemoryId', 'sourceRecordId']) {
      if (typeof value[key] === 'string' && value[key]) ids.push(value[key] as string);
    }
    for (const key of ['premiseIds', 'mergesMemoryIds']) {
      if (Array.isArray(value[key])) ids.push(...(value[key] as unknown[]).filter((id): id is string => typeof id === 'string' && Boolean(id)));
    }
  }
  return [...new Set(ids)];
}

export function noteRecordUse(db: Database.Database, workspaceId: string, originId: string, recordIds: string[], storyMinute: number | null): void {
  if (!recordIds.length || storyMinute === null || !Number.isFinite(storyMinute) || !hasTable(db, 'narrative_record_use')) return;
  const insert = db.prepare(`
    INSERT INTO narrative_record_use (workspace_id, record_id, origin_id, story_minute) VALUES (?, ?, ?, ?)
    ON CONFLICT (workspace_id, record_id, origin_id) DO UPDATE SET story_minute = MAX(story_minute, excluded.story_minute)
  `);
  for (const id of recordIds) insert.run(workspaceId, id, originId, Math.round(storyMinute));
}

/** The latest story minute each record was drawn on. */
export function lastRecordUse(db: Database.Database, workspaceId: string, recordIds: string[]): Map<string, number> {
  const uses = new Map<string, number>();
  if (!recordIds.length || !hasTable(db, 'narrative_record_use')) return uses;
  for (let index = 0; index < recordIds.length; index += 500) {
    const slice = recordIds.slice(index, index + 500);
    const rows = db.prepare(`
      SELECT record_id AS id, MAX(story_minute) AS minute FROM narrative_record_use
      WHERE workspace_id = ? AND record_id IN (${slice.map(() => '?').join(', ')})
      GROUP BY record_id
    `).all(workspaceId, ...slice) as Array<{ id: string; minute: number }>;
    for (const row of rows) uses.set(row.id, row.minute);
  }
  return uses;
}
