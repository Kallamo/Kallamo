import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { applyKnowledgeFileChanges, carryIndexState, ragIndexSignature } = require('../src/main/features/chat/knowledge-files');

const stored = [
  { name: 'Atlas.md', strategy: 'rag_search', internalPath: '/kb/Atlas.md', lastIndexedMtime: 10, profiles: [] },
  { name: 'Names.txt', strategy: 'full_context', internalPath: '/kb/Names.txt', profiles: [] }
];

describe('workspace knowledge file changes', () => {
  test('apply to the stored list, so a file added elsewhere survives a change made from an older copy', () => {
    const withNewFile = applyKnowledgeFileChanges(stored, { upsert: [{ name: 'Map.pdf', strategy: 'rag_search' }] });
    const next = applyKnowledgeFileChanges(withNewFile, { patch: [{ name: 'names.TXT', changes: { strategy: 'rag_search' } }] });

    expect(next.map((file: any) => [file.name, file.strategy])).toEqual([
      ['Atlas.md', 'rag_search'], ['Names.txt', 'rag_search'], ['Map.pdf', 'rag_search']
    ]);
  });

  test('a removed file stays removed and a patch never brings it back', () => {
    const next = applyKnowledgeFileChanges(stored, {
      remove: ['atlas.md'],
      patch: [{ name: 'Atlas.md', changes: { lastIndexedMtime: 20 } }]
    });
    expect(next.map((file: any) => file.name)).toEqual(['Names.txt']);
  });

  test('keeps the index state the renderer never sends', () => {
    const next = carryIndexState(stored, [{ name: 'Atlas.md', strategy: 'rag_search', internalPath: '/kb/Atlas.md' }]);
    expect(next[0].lastIndexedMtime).toBe(10);
    expect(ragIndexSignature(next)).toBe(ragIndexSignature(stored));
  });
});
