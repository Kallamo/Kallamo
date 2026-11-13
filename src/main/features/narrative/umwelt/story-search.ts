import type { PendingEmbeddingsResult, SearchPageResult } from '@kallamo/umwelt' with { 'resolution-mode': 'import' };
import type Database from 'better-sqlite3';
import { NarrativeWorld } from './narrative-world';
import { StoryReader } from './story-reader';

/** The local embedding model the app ships; vectors of another model never share its space. */
export const LOCAL_EMBEDDING_SPACE = { id: 'local-multilingual-e5-small', dimensions: 384, model: 'Xenova/multilingual-e5-small' } as const;

// Cosine similarity below this says the record is near the request only by accident.
const MIN_SIMILARITY = 0.8;

export interface PendingStoryText { docType: string; docId: string; textHash: string; text: string }

function prepare(world: NarrativeWorld): void {
  world.call('embedding.defineSpace', { space: LOCAL_EMBEDDING_SPACE });
}

/** Story texts that have no vector yet in the local space, a page at a time. */
export function pendingStoryTexts(db: Database.Database, workspaceId: string, limit = 32): PendingStoryText[] {
  const world = NarrativeWorld.of(db, workspaceId);
  if (!world.exists()) return [];
  prepare(world);
  const page = world.call<PendingEmbeddingsResult>('embedding.pending', {
    spaceId: LOCAL_EMBEDDING_SPACE.id,
    timelineId: new StoryReader(world).timelineId(),
    docTypes: ['record'],
    page: { limit }
  });
  return page.items.map(item => ({ docType: item.docType, docId: item.docId, textHash: item.textHash, text: item.text }));
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

/**
 * Records one holder holds that mean something close to the request, by the local model's
 * vectors. The search stays inside the holder's own records, so it never reaches what they do not know.
 */
export function searchHolderRecords(db: Database.Database, workspaceId: string, holderId: string, vector: number[], limit = 5): Map<string, number> {
  const world = NarrativeWorld.of(db, workspaceId);
  const hits = new Map<string, number>();
  if (!world.exists() || vector.length !== LOCAL_EMBEDDING_SPACE.dimensions) return hits;
  if (!world.ensureEntities([holderId]).has(holderId)) return hits;
  try {
    const page = world.call<SearchPageResult>('search', {
      semantic: { spaceId: LOCAL_EMBEDDING_SPACE.id, vector },
      filter: { holder: holderId, docType: 'record' },
      timelineId: new StoryReader(world).timelineId(),
      page: { limit }
    });
    for (const item of page.items) {
      if ((item.score ?? 0) >= MIN_SIMILARITY) hits.set(item.docId, item.score ?? 0);
    }
  } catch (error) {
    // A space with no vectors yet answers nothing useful; the request goes on without it.
    if ((error as { code?: string })?.code !== 'NOT_FOUND') throw error;
  }
  return hits;
}
