import type { PendingEmbeddingsResult, SearchPageResult } from '@kallamo/umwelt' with { 'resolution-mode': 'import' };
import type Database from 'better-sqlite3';
import { NarrativeWorld } from './narrative-world';
import { StoryReader } from './story-reader';

/** The local embedding model the app ships; vectors of another model never share its space. */
export const LOCAL_EMBEDDING_SPACE = { id: 'local-multilingual-e5-small', dimensions: 384, model: 'Xenova/multilingual-e5-small' } as const;

// Measured on a long campaign: this model scores even unrelated story texts near 0.85, while texts
// about the request's subject start around 0.875.
const SEMANTIC_FLOOR = 0.875;

// The engine joins the words of one text query with AND, so each word is searched on its own.
const MAX_TERMS = 6;
const MIN_TERM_LENGTH = 4;
const TERM_PAGE = 20;
const SEMANTIC_PAGE = 10;

export interface PendingStoryText { docType: string; docId: string; textHash: string; text: string }

export type StorySearchMatch = 'text' | 'semantic' | 'both';

export interface StoryHit {
  docId: string;
  docType: 'record' | 'event';
  /** Whose records were searched; null for the narrator's view (Facts and events). */
  holderId: string | null;
  match: StorySearchMatch;
  /** Reciprocal-rank fusion of the two rankings; only comparable within one search. */
  score: number;
  similarity?: number;
  terms?: number;
  event?: { title: string; description: string | null; tick: number; type?: string; participants?: string[]; location?: string | null; on?: Record<string, number> };
  record?: SearchPageResult['items'][number]['record'];
}

export interface StorySearchInput {
  holderId?: string | null;
  text: string;
  vector?: number[] | null;
  docType?: 'record' | 'event';
  limit?: number;
  /** Leaves out the latest events of the story, whose scenes the chat history still holds. */
  skipLatestEvents?: number;
  /** Fewer words for a search repeated across many holders. */
  maxTerms?: number;
  /** Resolving the timeline costs engine calls, so a run of searches resolves it once. */
  timelineId?: string;
  /** Events of these types, and records written by them. */
  eventTypes?: readonly string[];
  /** Records whose subject is the entity, and events it takes part in. */
  subject?: string;
  /** Documents positioned in this span, on the axis of `at`. */
  range?: { from?: number; to?: number };
  at?: { axis?: string; tick?: number };
  /** Overrides the similarity a semantic hit needs. */
  floor?: number;
  /**
   * Keeps semantic hits close to the best one instead of above a fixed line: a short query scores
   * the whole page lower, and the fixed line would drop all of it.
   */
  relative?: boolean;
}

// With a relative floor, hits within this distance of the best are kept, never below the bottom line.
const RELATIVE_MARGIN = 0.02;
const RELATIVE_BOTTOM = 0.86;

function prepare(world: NarrativeWorld): void {
  world.call('embedding.defineSpace', { space: LOCAL_EMBEDDING_SPACE });
}

export interface PendingStoryPage { items: PendingStoryText[]; nextCursor: string | null; resumeCursor: string | null }

/**
 * Story texts (records and events) that have no vector yet in the local space, a page at a time.
 * A `resumeCursor` from an earlier listing skips everything already checked.
 */
export function pendingStoryPage(db: Database.Database, workspaceId: string, options: { limit?: number; cursor?: string | null; docTypes?: Array<'record' | 'event'> } = {}): PendingStoryPage {
  const world = NarrativeWorld.of(db, workspaceId);
  if (!world.exists()) return { items: [], nextCursor: null, resumeCursor: null };
  prepare(world);
  const page = world.call<PendingEmbeddingsResult>('embedding.pending', {
    spaceId: LOCAL_EMBEDDING_SPACE.id,
    timelineId: new StoryReader(world).timelineId(),
    docTypes: options.docTypes ?? ['record', 'event'],
    page: { limit: options.limit ?? 16, ...(options.cursor ? { cursor: options.cursor } : {}) }
  });
  return {
    items: page.items.map(item => ({ docType: item.docType, docId: item.docId, textHash: item.textHash, text: item.text })),
    nextCursor: page.nextCursor ?? null,
    resumeCursor: page.resumeCursor ?? null
  };
}

/** Records with no vector yet in the local space. */
export function pendingStoryTexts(db: Database.Database, workspaceId: string, limit = 32): PendingStoryText[] {
  return pendingStoryPage(db, workspaceId, { limit, docTypes: ['record'] }).items;
}

export function storeStoryVectors(db: Database.Database, workspaceId: string, items: Array<PendingStoryText & { vector: number[] }>): number {
  if (!items.length) return 0;
  const world = NarrativeWorld.of(db, workspaceId);
  const result = world.call<{ stored: number }>('embedding.put', {
    spaceId: LOCAL_EMBEDDING_SPACE.id,
    items: items.map(({ docType, docId, textHash, vector }) => ({ docType, docId, textHash, vector }))
  });
  return result.stored;
}

/** The words of a request worth searching on their own, longest first: length decides, never a word list. */
export function searchTerms(text: string, max = MAX_TERMS): string[] {
  const terms = new Set(String(text || '').toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(term => term.length >= MIN_TERM_LENGTH));
  return [...terms].sort((left, right) => right.length - left.length || left.localeCompare(right)).slice(0, max);
}

function searchPage(world: NarrativeWorld, payload: Record<string, unknown>): SearchPageResult | null {
  try {
    return world.call<SearchPageResult>('search', payload);
  } catch (error) {
    // A space with no vectors yet answers nothing useful; the request goes on without it.
    if ((error as { code?: string })?.code === 'NOT_FOUND') return null;
    throw error;
  }
}

/**
 * Story texts close to a request by its words and, with a local vector, by meaning; never outside the
 * holder's own records. A text match needs two distinct words, so one common word never decides.
 */
export function searchStory(db: Database.Database, workspaceId: string, input: StorySearchInput): StoryHit[] {
  const world = NarrativeWorld.of(db, workspaceId);
  if (!world.exists()) return [];
  const holderId = input.holderId ?? null;
  if (holderId && !world.ensureEntities([holderId]).has(holderId)) return [];
  const docType = input.docType ?? 'record';
  const timelineId = input.timelineId ?? new StoryReader(world).timelineId();
  const filter = {
    docType,
    ...(holderId ? { holder: holderId } : {}),
    ...(input.subject ? { subject: input.subject } : {}),
    ...(input.eventTypes ? { eventTypes: [...input.eventTypes] } : {})
  };
  const scope = { filter, timelineId, ...(input.range ? { range: input.range } : {}), ...(input.at ? { at: input.at } : {}) };

  const latestTick = input.skipLatestEvents ? new StoryReader(world).timeline(timelineId).maxTick : null;
  const events = new Map<string, NonNullable<StoryHit['event']>>();
  const records = new Map<string, NonNullable<StoryHit['record']>>();
  const keep = (item: SearchPageResult['items'][number]): boolean => {
    if (item.record) records.set(item.docId, item.record);
    if (!item.event) return true;
    if (latestTick !== null && item.event.position.tick > latestTick - (input.skipLatestEvents ?? 0)) return false;
    events.set(item.docId, {
      title: item.event.title,
      description: item.event.description ?? null,
      tick: item.event.position.tick,
      type: item.event.type,
      participants: item.event.participants ?? [],
      location: item.event.location ?? null,
      ...(item.event.on ? { on: item.event.on } : {})
    });
    return true;
  };

  const semantic: Array<{ docId: string; similarity: number }> = [];
  if (input.vector && input.vector.length === LOCAL_EMBEDDING_SPACE.dimensions) {
    const page = searchPage(world, { semantic: { spaceId: LOCAL_EMBEDDING_SPACE.id, vector: input.vector }, ...scope, page: { limit: SEMANTIC_PAGE } });
    const best = page?.items[0]?.score ?? 0;
    const floor = input.relative
      ? Math.max(input.floor ?? RELATIVE_BOTTOM, best - RELATIVE_MARGIN)
      : input.floor ?? SEMANTIC_FLOOR;
    for (const item of page?.items ?? []) {
      if ((item.score ?? 0) >= floor && keep(item)) semantic.push({ docId: item.docId, similarity: item.score ?? 0 });
    }
  }

  const termHits = new Map<string, { terms: number; rarity: number }>();
  const terms = searchTerms(input.text, input.maxTerms);
  // Without meaning behind it, a match on two common words of a long query is chance: a relative
  // search asks a words-only hit to carry half the query.
  const meant = new Set(semantic.map(item => item.docId));
  const wordsOnlyFloor = input.relative ? Math.max(2, Math.ceil(terms.length / 2)) : 2;
  for (const term of terms) {
    const page = searchPage(world, { text: term, ...scope, page: { limit: TERM_PAGE } });
    const items = (page?.items ?? []).filter(keep);
    for (const item of items) {
      const entry = termHits.get(item.docId) ?? { terms: 0, rarity: 0 };
      entry.terms += 1;
      entry.rarity += 1 / items.length;
      termHits.set(item.docId, entry);
    }
  }
  const text = [...termHits.entries()]
    .filter(([docId, entry]) => entry.terms >= 2 && (meant.has(docId) || entry.terms >= wordsOnlyFloor))
    .sort((left, right) => right[1].terms - left[1].terms || right[1].rarity - left[1].rarity || left[0].localeCompare(right[0]));

  const fused = new Map<string, StoryHit>();
  const add = (docId: string, rank: number, match: 'text' | 'semantic', detail: Partial<StoryHit>) => {
    const hit = fused.get(docId) ?? { docId, docType, holderId, match, score: 0 };
    hit.score += 1 / (60 + rank);
    if (hit.match !== match) hit.match = 'both';
    fused.set(docId, { ...hit, ...detail });
  };
  semantic.forEach((item, index) => add(item.docId, index + 1, 'semantic', { similarity: item.similarity }));
  text.forEach(([docId, entry], index) => add(docId, index + 1, 'text', { terms: entry.terms }));
  return [...fused.values()]
    .sort((left, right) => right.score - left.score || left.docId.localeCompare(right.docId))
    .slice(0, input.limit ?? 5)
    .map(hit => ({
      ...hit,
      ...(events.has(hit.docId) ? { event: events.get(hit.docId) } : {}),
      ...(records.has(hit.docId) ? { record: records.get(hit.docId) } : {})
    }));
}
