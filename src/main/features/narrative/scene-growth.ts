import type Database from 'better-sqlite3';

export interface SceneTurn {
  originId: string;
  userMessage: string;
  reply: string;
  createdAt: number;
}

/** A scene with no settled scene before it still starts somewhere: at most this many turns back. */
export const SCENE_TURN_LIMIT = 40;

/** A scene that never ends on its own is weighed anyway after this many turns. */
export const LONG_SCENE_TURNS = 30;

/**
 * Where scenes start and end for growth: every scene whose growth was weighed is kept by the reply
 * that closed it, so the next scene is the replies after that one.
 */
export class SceneGrowthLedger {
  constructor(private readonly db: Database.Database) {}

  /** The scene's turns, oldest first, ending with the reply that closes it. */
  sceneTurns(workspaceId: string, originId: string, limit = SCENE_TURN_LIMIT): SceneTurn[] {
    const end = this.replyTime(workspaceId, originId);
    if (end === null) return [];
    const start = this.lastSettledBefore(workspaceId, end);
    const rows = this.db.prepare(`
      SELECT id, role, content, createdAt FROM messages
      WHERE chatId = ? AND createdAt > ? AND createdAt <= ? AND COALESCE(excluded, 0) = 0
        AND role IN ('user', 'ai')
      ORDER BY createdAt, id
    `).all(workspaceId, start ?? -1, end) as Array<{ id: string; role: string; content: string; createdAt: number }>;
    const turns: SceneTurn[] = [];
    let userMessage = '';
    for (const row of rows) {
      if (row.role === 'user') {
        userMessage = String(row.content || '');
        continue;
      }
      turns.push({ originId: row.id, userMessage, reply: String(row.content || ''), createdAt: Number(row.createdAt) });
      userMessage = '';
    }
    return turns.slice(-limit);
  }

  /** Replies since the last weighed scene, this one included. */
  turnsSinceSettled(workspaceId: string, originId: string): number {
    const end = this.replyTime(workspaceId, originId);
    if (end === null) return 0;
    const start = this.lastSettledBefore(workspaceId, end);
    return Number((this.db.prepare(`
      SELECT COUNT(*) AS count FROM messages
      WHERE chatId = ? AND role = 'ai' AND createdAt > ? AND createdAt <= ? AND COALESCE(excluded, 0) = 0
    `).get(workspaceId, start ?? -1, end) as { count: number }).count);
  }

  isSettled(workspaceId: string, originId: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM roleplay_scene_growth WHERE workspace_id = ? AND origin_id = ?').get(workspaceId, originId));
  }

  record(workspaceId: string, originId: string, input: { reason: string; turnCount: number; proposalCount: number }): void {
    this.db.prepare(`
      INSERT INTO roleplay_scene_growth (workspace_id, origin_id, reason, turn_count, proposal_count, settled_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(workspace_id, origin_id) DO UPDATE SET
        reason = excluded.reason, turn_count = excluded.turn_count,
        proposal_count = excluded.proposal_count, settled_at = excluded.settled_at
    `).run(workspaceId, originId, input.reason, input.turnCount, input.proposalCount, Date.now());
  }

  /** The latest reply of the workspace, which a scene closed by hand ends with. */
  latestReplyId(workspaceId: string): string | null {
    const row = this.db.prepare(`
      SELECT id FROM messages WHERE chatId = ? AND role = 'ai' AND COALESCE(excluded, 0) = 0
      ORDER BY createdAt DESC, id DESC LIMIT 1
    `).get(workspaceId) as { id: string } | undefined;
    return row?.id ?? null;
  }

  private replyTime(workspaceId: string, originId: string): number | null {
    const row = this.db.prepare("SELECT createdAt FROM messages WHERE chatId = ? AND id = ? AND role = 'ai'").get(workspaceId, originId) as { createdAt: number } | undefined;
    return row ? Number(row.createdAt) : null;
  }

  private lastSettledBefore(workspaceId: string, end: number): number | null {
    const row = this.db.prepare(`
      SELECT messages.createdAt AS createdAt FROM roleplay_scene_growth AS growth
      JOIN messages ON messages.id = growth.origin_id AND messages.chatId = growth.workspace_id
      WHERE growth.workspace_id = ? AND messages.createdAt < ?
      ORDER BY messages.createdAt DESC LIMIT 1
    `).get(workspaceId, end) as { createdAt: number } | undefined;
    return row ? Number(row.createdAt) : null;
  }
}
