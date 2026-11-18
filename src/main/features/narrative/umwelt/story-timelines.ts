import type { Timeline } from '@kallamo/umwelt' with { 'resolution-mode': 'import' };
import type { NarrativeWorld } from './narrative-world';

export const MAIN_TIMELINE = 'main';
const TURN_PREFIX = 'turn-';
const REPLACEMENT_PREFIX = 'replace-';

interface TimelineState { drafts: Timeline[] | null }
const STATE = Symbol.for('kallamo.umwelt.timelines');

function state(world: NarrativeWorld): TimelineState {
  const holder = world as unknown as Record<symbol, TimelineState>;
  holder[STATE] ??= { drafts: null };
  return holder[STATE];
}

function hasTable(world: NarrativeWorld, name: string): boolean {
  return Boolean(world.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

export function isConflict(error: unknown, code = 'VERSION_CONFLICT'): boolean {
  return Boolean(error && typeof error === 'object' && (error as { code?: unknown }).code === code);
}

/**
 * The latest analysed turn stays in its own draft until the next write confirms it, so deleting or
 * regenerating that reply leaves nothing; taking back confirmed turns uses a replacement draft.
 */
export class StoryTimelines {
  constructor(private readonly world: NarrativeWorld) {}

  /** The timeline every read of the current story uses. */
  readTimeline(): string {
    const drafts = this.drafts();
    const replacement = drafts.find(draft => draft.id.startsWith(REPLACEMENT_PREFIX));
    if (replacement) return replacement.id;
    const live = drafts.filter(draft => draft.id.startsWith(TURN_PREFIX) && this.originAlive(draft.label ?? ''));
    if (!live.length) return MAIN_TIMELINE;
    return live.sort((a, b) => b.headVersion - a.headVersion)[0].id;
  }

  /**
   * The timeline a turn's analysis writes to: its own draft, after every other turn is settled. A
   * turn that a later one already follows was confirmed, so it writes to main and leaves the later
   * turn's draft open for its own regeneration.
   */
  forTurn(originId: string): string {
    const id = turnTimelineId(originId);
    if (this.turnDrafts().some(draft => draft.id !== id && this.originAlive(draft.label ?? '') && this.isLater(draft.label ?? '', originId))) {
      return MAIN_TIMELINE;
    }
    for (const draft of this.turnDrafts()) {
      if (draft.id !== id) this.settle(draft);
    }
    if (this.drafts().some(draft => draft.id === id)) return id;
    this.world.call('timeline.openDraft', { id, label: originId, baseTimelineId: MAIN_TIMELINE });
    this.invalidate();
    return id;
  }

  /** The timeline of everything that is not one turn's analysis; earlier turns are confirmed first. */
  forMain(): string {
    for (const draft of this.turnDrafts()) this.settle(draft);
    return MAIN_TIMELINE;
  }

  /** The draft a turn still sits in, if it was never confirmed. */
  turnDraft(originId: string): string | null {
    const id = turnTimelineId(originId);
    return this.drafts().some(draft => draft.id === id) ? id : null;
  }

  replacementDraft(): string | null {
    return this.drafts().find(draft => draft.id.startsWith(REPLACEMENT_PREFIX))?.id ?? null;
  }

  openReplacement(replacementId: string): string {
    const id = `${REPLACEMENT_PREFIX}${replacementId}`;
    if (!this.drafts().some(draft => draft.id === id)) {
      this.world.call('timeline.openDraft', { id, label: replacementId, baseTimelineId: MAIN_TIMELINE });
      this.invalidate();
    }
    return id;
  }

  /** Confirms a replacement. Returns false when it no longer fits main and the caller must redo its work there. */
  promoteReplacement(replacementId: string): boolean {
    const id = `${REPLACEMENT_PREFIX}${replacementId}`;
    if (!this.drafts().some(draft => draft.id === id)) return true;
    const promoted = this.promote(id);
    if (!promoted) this.discard(id);
    return promoted;
  }

  discardReplacement(replacementId: string): void {
    const id = `${REPLACEMENT_PREFIX}${replacementId}`;
    if (this.drafts().some(draft => draft.id === id)) this.discard(id);
  }

  /** Removes a turn's draft and everything in it. */
  discardTurn(originId: string): boolean {
    const id = this.turnDraft(originId);
    if (!id) return false;
    this.discard(id);
    return true;
  }

  invalidate(): void {
    state(this.world).drafts = null;
  }

  /** A live turn is confirmed, a dead one is removed, one an open replacement may restore is left. */
  private settle(draft: Timeline): void {
    const originId = draft.label ?? '';
    if (this.originAlive(originId)) {
      if (this.promote(draft.id)) return;
      // Its writes no longer fit the story as edited since; the turn is analysed again on request.
      this.discard(draft.id);
      this.markTurnFailed(originId, 'Narrative State of this reply no longer fit later edits and was set aside. Update it to analyse it again.');
      return;
    }
    if (!this.originRestorable(originId)) this.discard(draft.id);
  }

  private promote(id: string): boolean {
    try {
      this.world.call('timeline.promote', { timelineId: id });
    } catch (error) {
      if (!isConflict(error)) throw error;
      try {
        this.world.call('timeline.rebase', { timelineId: id });
        this.world.call('timeline.promote', { timelineId: id });
      } catch (retry) {
        this.invalidate();
        if (isConflict(retry) || isConflict(retry, 'VALIDATION_FAILED') || isConflict(retry, 'NOT_FOUND')) return false;
        throw retry;
      }
    }
    this.invalidate();
    return true;
  }

  private discard(id: string): void {
    this.world.call('timeline.discard', { timelineId: id, purge: true });
    this.invalidate();
  }

  private drafts(): Timeline[] {
    const current = state(this.world);
    current.drafts ??= this.world.call<Timeline[]>('timeline.list', { status: 'active' }).filter(timeline => timeline.kind === 'draft');
    return current.drafts;
  }

  private turnDrafts(): Timeline[] {
    return this.drafts().filter(draft => draft.id.startsWith(TURN_PREFIX));
  }

  private originAlive(originId: string): boolean {
    if (!originId || !hasTable(this.world, 'narrative_origin_lifecycle')) return true;
    const row = this.world.db.prepare(`
      SELECT status FROM narrative_origin_lifecycle WHERE workspace_id = ? AND origin_id = ?
    `).get(this.world.workspaceId, originId) as { status: string } | undefined;
    return !row || row.status === 'active';
  }

  private isLater(originId: string, thanOriginId: string): boolean {
    if (!originId || !thanOriginId || !hasTable(this.world, 'messages')) return false;
    const createdAt = (id: string) => (this.world.db.prepare('SELECT createdAt FROM messages WHERE id = ? AND chatId = ?')
      .get(id, this.world.workspaceId) as { createdAt: number } | undefined)?.createdAt;
    const later = createdAt(originId);
    const earlier = createdAt(thanOriginId);
    return later !== undefined && earlier !== undefined && Number(later) > Number(earlier);
  }

  private originRestorable(originId: string): boolean {
    if (!hasTable(this.world, 'narrative_turn_replacements')) return false;
    const rows = this.world.db.prepare('SELECT origin_ids_json FROM narrative_turn_replacements WHERE workspace_id = ?')
      .all(this.world.workspaceId) as Array<{ origin_ids_json: string }>;
    return rows.some(row => {
      try { return (JSON.parse(row.origin_ids_json) as string[]).includes(originId); } catch { return false; }
    });
  }

  private markTurnFailed(originId: string, message: string): void {
    if (!originId || !hasTable(this.world, 'narrative_state_jobs')) return;
    this.world.db.prepare(`
      UPDATE narrative_state_jobs SET status = 'failed', error_message = ?, updated_at = ?
      WHERE workspace_id = ? AND origin_id = ?
    `).run(message, Date.now(), this.world.workspaceId, originId);
  }
}

export function turnTimelineId(originId: string): string {
  return `${TURN_PREFIX}${originId}`;
}
