import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const {
  filterWorkspaceKnowledgeResults,
  filterWorkspaceMemoryResults
} = require('../src/main/features/chat/workspace-context-scope');

describe('workspace retrieval scope', () => {
  test('keeps workspace files shared or scoped to the executing profile', () => {
    const files = [
      { name: 'shared.txt', strategy: 'rag_search' },
      { name: 'profile-1.txt', strategy: 'rag_search', profiles: ['profile-1'] },
      { name: 'profile-2.txt', strategy: 'rag_search', profiles: ['profile-2'] },
      { name: 'constant.txt', strategy: 'constant' }
    ];
    const results = files.map(file => ({ source: file.name, text: file.name }));

    expect(filterWorkspaceKnowledgeResults(results, files, 'profile-1').map((result: { source: string }) => result.source))
      .toEqual(['shared.txt', 'profile-1.txt']);
  });

  test('keeps workspace memories shared or scoped to the executing profile', () => {
    const blocks = [
      { id: 'shared', title: 'Shared', strategy: 'rag_search' },
      { id: 'one', title: 'One', strategy: 'rag_search', profiles: ['profile-1'] },
      { id: 'two', title: 'Two', strategy: 'rag_search', profiles: ['profile-2'] },
      { id: 'constant', title: 'Constant', strategy: 'constant' }
    ];
    const results = blocks.map(block => ({
      memoryBlockId: block.id,
      source: block.title,
      text: block.title
    })).concat([{
      memoryBlockId: '',
      source: 'Unlinked legacy memory',
      text: 'This result must fail closed.'
    }]);

    expect(filterWorkspaceMemoryResults(results, blocks, 'profile-1').map((result: { memoryBlockId: string }) => result.memoryBlockId))
      .toEqual(['shared', 'one']);
  });
});
