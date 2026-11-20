import type Database from 'better-sqlite3';
import { createNarrativeChatContext } from '../chat-context';
import { assembleContext, type AssembledContext } from './assembler';
import type { ContextMode } from './needs';
import type { SceneInput } from './scene-core';

/** Builds a turn's context the way the app would, without calling a model. */
export async function assembleForEval(db: Database.Database, input: {
  recentOriginIds?: string[];
  workspaceId: string;
  mode: ContextMode;
  request: string;
  lastReply: string;
  scene: SceneInput | null;
  needs?: unknown;
  ceiling?: number;
  embed?: (text: string) => Promise<number[] | null>;
}): Promise<AssembledContext> {
  const estimate = (text: string) => Math.ceil(String(text || '').length / 3.6);
  return assembleContext({
    db,
    workspaceId: input.workspaceId,
    mode: input.mode,
    request: input.request,
    lastReply: input.lastReply,
    scene: input.scene,
    ceiling: input.ceiling ?? 60000,
    estimateTokens: estimate,
    source: createNarrativeChatContext(db, estimate),
    ...(input.embed ? { embed: input.embed } : {}),
    // The app ranks document passages with its hybrid search; here, words alone, within the named document.
    searchDocuments: async need => {
      const terms = String(need.query || need.label || '').toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(term => term.length >= 4);
      if (!terms.length) return [];
      const rows = db.prepare(`
        SELECT id, source, text FROM knowledge_chunks WHERE ownerId = ? AND ownerType = 'chat_kb' AND enabled = 1
          AND (? = '' OR lower(source) LIKE '%' || lower(?) || '%')
      `).all(input.workspaceId, need.documentName ?? '', need.documentName ?? '') as Array<{ id: string; source: string; text: string }>;
      return rows
        .map(row => ({ ...row, score: terms.filter(term => row.text.toLocaleLowerCase().includes(term)).length }))
        .filter(row => row.score > 0)
        .sort((left, right) => right.score - left.score)
        .slice(0, 4);
    },
    ...(input.needs ? { brief: { needs: input.needs } } : {}),
    ...(input.recentOriginIds ? { recentOriginIds: input.recentOriginIds } : {})
  });
}
