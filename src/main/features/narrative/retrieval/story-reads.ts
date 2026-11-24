import type Database from 'better-sqlite3';
import type {
  BeliefsAboutResult,
  ContextAdmitResult,
  ContradictionsResult,
  Event as StoryEvent,
  EventPageResult,
  HoldingItem,
  Record as StoryRecord
} from '@kallamo/umwelt' with { 'resolution-mode': 'import' };
import { NarrativeWorld, STORY_AXIS } from '../umwelt/narrative-world';
import { OCCURRENCE_ORIGIN_PREFIX, SCENE_NATURES } from '../umwelt/story-journal';
import { metadataOf, StoryReader, kindOf } from '../umwelt/story-reader';
import { searchStory, type StoryHit, type StorySearchInput } from '../umwelt/story-search';

export type { StoryEvent, StoryRecord, HoldingItem };

export interface StoryAdmission { id: string; recordId?: string; eventId?: string; priority: number; cost: number; classification?: string }

/**
 * A statement the interpreter once wrote of someone learning about themselves (their own plan, what
 * they are): what they live is their memory, and the gate no longer lets these through. A secret they
 * keep, and what the author wrote in a Knowledge card, stay.
 */
function discoversSelf(record: StoryRecord): boolean {
  if (record.kind !== 'holding' || record.claim.subject !== record.holder || kindOf(record) === 'memory') return false;
  const origin = (record.provenance as { origin?: { kind?: string } } | undefined)?.origin?.kind;
  return origin === 'model' && metadataOf(record).category !== 'secret';
}

/**
 * The story reads retrieval makes, each one a filtered engine query on the timeline the turn reads.
 * Results are kept for the life of one context, since the story does not change while it is built.
 */
export class StoryReads {
  readonly world: NarrativeWorld;
  readonly exists: boolean;
  private readonly reader: StoryReader;
  private timeline: string | null = null;
  private readonly cache = new Map<string, unknown>();

  constructor(private readonly db: Database.Database, readonly workspaceId: string) {
    this.world = NarrativeWorld.of(db, workspaceId);
    this.exists = this.world.exists();
    this.reader = new StoryReader(this.world);
  }

  timelineId(): string {
    this.timeline ??= this.reader.timelineId();
    return this.timeline;
  }

  private once<T>(key: string, read: () => T): T {
    if (!this.cache.has(key)) this.cache.set(key, read());
    return this.cache.get(key) as T;
  }

  /** Which of these ids the story knows as entities; reads about any other would fail. */
  known(ids: string[]): Set<string> {
    if (!this.exists || !ids.length) return new Set();
    return new Set(this.world.ensureEntities(ids).keys());
  }

  /** The story events written by these replies, by the journal's evidence. */
  eventsFromOrigins(originIds: string[]): Set<string> {
    if (!originIds.length) return new Set();
    const exists = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'narrative_event_evidence'").get();
    if (!exists) return new Set();
    return new Set((this.db.prepare(`
      SELECT DISTINCT event_id AS id FROM narrative_event_evidence
      WHERE workspace_id = ? AND origin_id IN (${originIds.map(() => '?').join(', ')})
    `).all(this.workspaceId, ...originIds) as Array<{ id: string }>).map(row => row.id));
  }

  /** Who took part in an event, as the journal recorded it. */
  participantsOf(eventId: string): Set<string> {
    return this.once(`participants\u0000${eventId}`, () => new Set((this.db.prepare(`
      SELECT entity_id AS id FROM narrative_event_participants WHERE workspace_id = ? AND event_id = ?
    `).all(this.workspaceId, eventId) as Array<{ id: string }>).map(row => row.id)));
  }

  /** What a holder holds about an entity (as subject or object), at the current position or a past one. */
  holdingsAbout(holder: string, about: string, at?: { axis?: string; tick?: number }): HoldingItem[] {
    if (!this.exists || !this.known([holder, about]).has(holder)) return [];
    return this.once(`holdings\u0000${holder}\u0000${about}\u0000${JSON.stringify(at ?? null)}`, () =>
      this.reader.holdings(holder, { timelineId: this.timelineId(), about, includeWithheld: false, ...(at ? { at } : {}) }).filter(item => !discoversSelf(item.record)));
  }

  /** Everything a holder holds, withheld records included. */
  holdings(holder: string): HoldingItem[] {
    if (!this.exists || !this.known([holder]).has(holder)) return [];
    return this.once(`all-holdings\u0000${holder}`, () => this.reader.holdings(holder, { timelineId: this.timelineId(), includeWithheld: true }).filter(item => !discoversSelf(item.record)));
  }

  /**
   * A holder's memories in which someone else takes part. A memory is held about the holder
   * themselves, so a read about the other never finds it: the other is in it as someone related or
   * someone who was there.
   */
  memoriesInvolving(holder: string, about: string): HoldingItem[] {
    if (holder === about) return [];
    return this.holdings(holder).filter(item => {
      const record = item.record;
      if (record.kind !== 'holding' || kindOf(record) !== 'memory' || record.claim.subject === about) return false;
      const related = metadataOf(record).relatedEntityIds;
      return (Array.isArray(related) && related.includes(about)) || this.participantsOf(record.eventId).has(about);
    });
  }

  /** What a holder holds about someone: statements about them and memories they are part of. */
  heldAbout(holder: string, about: string): HoldingItem[] {
    const byId = new Map<string, HoldingItem>();
    for (const item of [...this.holdingsAbout(holder, about), ...this.memoriesInvolving(holder, about)]) byId.set(item.record.id, item);
    return [...byId.values()];
  }

  factsAbout(subject: string): StoryRecord[] {
    if (!this.exists) return [];
    return this.once(`facts\u0000${subject}`, () => this.reader.facts({ timelineId: this.timelineId(), subject }));
  }

  dispositions(holder: string, target?: string): StoryRecord[] {
    if (!this.exists || !this.known([holder]).has(holder)) return [];
    return this.once(`dispositions\u0000${holder}\u0000${target ?? ''}`, () =>
      this.reader.dispositions(holder, { timelineId: this.timelineId(), ...(target ? { target } : {}) }));
  }

  isAware(holder: string, target: string): boolean {
    if (!this.exists || !this.known([holder]).has(holder)) return false;
    return this.once(`awareness\u0000${holder}`, () => this.reader.awareness(holder, { timelineId: this.timelineId() }))
      .some(record => record.kind === 'awareness' && record.target === target);
  }

  contradictions(holder: string): ContradictionsResult {
    if (!this.exists || !this.known([holder]).has(holder)) return [];
    return this.once(`contradictions\u0000${holder}`, () => this.world.call<ContradictionsResult>('contradictions', { holder, timelineId: this.timelineId() }));
  }

  beliefsAbout(holder: string, about: string): BeliefsAboutResult {
    const known = this.known([holder, about]);
    if (!known.has(holder) || !known.has(about)) return [];
    return this.once(`beliefs\u0000${holder}\u0000${about}`, () => this.world.call<BeliefsAboutResult>('beliefsAbout', { holder, about, timelineId: this.timelineId() }));
  }

  whoHolds(claimKey: string): Array<{ holder: string; attitude: string; polarity: boolean; recordId: string }> {
    if (!this.exists) return [];
    return this.once(`who\u0000${claimKey}`, () => this.world.call('whoHolds', { claimKey, timelineId: this.timelineId() }));
  }

  record(recordId: string): StoryRecord | null {
    if (!this.exists) return null;
    return this.once(`record\u0000${recordId}`, () => {
      try {
        return this.world.call<StoryRecord>('record', { recordId, timelineId: this.timelineId() });
      } catch {
        return null;
      }
    });
  }

  search(input: Omit<StorySearchInput, 'timelineId'>): StoryHit[] {
    if (!this.exists) return [];
    return searchStory(this.db, this.workspaceId, { ...input, timelineId: this.timelineId() });
  }

  /** The events someone took part in, in story order; a span narrows it on the story axis. */
  eventsOf(participant: string, options: { eventTypes?: readonly string[]; from?: number; to?: number; limit?: number } = {}): StoryEvent[] {
    if (!this.exists || !this.known([participant]).has(participant)) return [];
    return this.once(`events\u0000${participant}\u0000${JSON.stringify(options)}`, () => this.readEvents(participant, options));
  }

  private readEvents(participant: string, options: { eventTypes?: readonly string[]; from?: number; to?: number; limit?: number }): StoryEvent[] {
    const range = options.from !== undefined || options.to !== undefined ? { range: { ...(options.from !== undefined ? { from: options.from } : {}), ...(options.to !== undefined ? { to: options.to } : {}) } } : {};
    const page = this.world.call<EventPageResult>('timeline', {
      timelineId: this.timelineId(),
      participant,
      ...(options.eventTypes ? { eventTypes: [...options.eventTypes] } : {}),
      // Only a span needs the story axis; on it, an event the clock never placed is invisible.
      ...(Object.keys(range).length ? { ...range, at: { axis: STORY_AXIS } } : {}),
      page: { limit: Math.min(500, options.limit ?? 200) }
    });
    return page.items;
  }

  /**
   * Whether an event is a scene: by its type once written by nature, and for older events by the
   * origin the journal kept for it (the ids are the same).
   */
  isScene(event: Pick<StoryEvent, 'id' | 'type'>): boolean {
    if ((SCENE_NATURES as readonly string[]).includes(event.type)) return true;
    if (['sheet-edit', 'awareness-grant', 'entity-update', 'import', 'maintenance'].includes(event.type)) return false;
    const origin = this.once(`origin\u0000${event.id}`, () => this.db.prepare(`
      SELECT origin_type AS type, origin_id AS id FROM narrative_event_evidence WHERE workspace_id = ? AND event_id = ? AND ordinal = 0
    `).get(this.workspaceId, event.id) as { type: string; id: string } | undefined);
    return origin?.type === 'chat-message' || origin?.type === 'writing-document' || Boolean(origin?.id?.startsWith(OCCURRENCE_ORIGIN_PREFIX));
  }

  /** Scene ids the journal places at a location; the engine does not filter events by place. */
  sceneIdsAt(locationId: string, limit = 40): string[] {
    return (this.db.prepare(`
      SELECT events.event_id AS id FROM narrative_events events
      JOIN narrative_event_evidence evidence ON evidence.workspace_id = events.workspace_id AND evidence.event_id = events.event_id AND evidence.ordinal = 0
      WHERE events.workspace_id = ? AND events.location_id = ? AND events.status = 'approved'
        AND (evidence.origin_type IN ('chat-message', 'writing-document') OR evidence.origin_id LIKE '${OCCURRENCE_ORIGIN_PREFIX}%')
      ORDER BY events.narrative_sequence DESC LIMIT ?
    `).all(this.workspaceId, locationId, limit) as Array<{ id: string }>).map(row => row.id);
  }

  /** The engine's admission for one holder (or the narrator), within a budget, highest priority first. */
  admit(holder: string | null, candidates: StoryAdmission[], budget: number): ContextAdmitResult {
    if (!this.exists || !candidates.length) return { admitted: [], rejected: [], usedBudget: 0 };
    const checked = candidates.filter(candidate => candidate.recordId || candidate.eventId);
    return this.world.call<ContextAdmitResult>('context.admit', {
      ...(holder ? { holder } : { authorizedNarrator: true }),
      timelineId: this.timelineId(),
      budget: Math.max(0, Math.floor(budget)),
      excludeClassifications: ['spoiler'],
      candidates: checked.map(candidate => ({
        id: candidate.id,
        ...(candidate.recordId ? { recordId: candidate.recordId } : { eventId: candidate.eventId }),
        cost: Math.max(1, Math.round(candidate.cost)),
        priority: Math.round(candidate.priority * 100),
        ...(candidate.classification ? { classification: candidate.classification } : {})
      }))
    });
  }

  /** Everyone the story keeps records for. */
  holderIds(): string[] {
    if (!this.exists) return [];
    return this.once('holders', () => this.reader.holders());
  }

  names(ids: string[]): Map<string, string> {
    return this.world.names(ids);
  }
}

export { kindOf, metadataOf };
