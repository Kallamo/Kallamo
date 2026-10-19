import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { selectRetrievedEntries } = require('../src/main/features/ai-engine/retrieval-selection');

describe('retrieval selection', () => {
  test('keeps distinct semantic evidence without imposing chronology heuristics', () => {
    const result = selectRetrievedEntries('Where did the story stop?', [
      entry('day-8', 'workspace-text', 'Log - Day 8.pdf', 'Day 8 ended in the arena.', 0.95),
      entry('day-14', 'workspace-text', 'Log - Day 14.pdf', 'Day 14 ended at the workshop.', 0.7),
      entry('corwin', 'worldbuild-canon', 'Corwin', 'Full profile of Corwin.', 1),
      entry('memory', 'workspace-memory', 'Chat Memory', 'An old memory.', 0.9)
    ]);

    expect(result.selected.map((value: { key: string }) => value.key)).toEqual(['day-8', 'day-14', 'corwin', 'memory']);
    expect(result.funnel).toMatchObject({
      intent: 'general',
      discovered: 4,
      selected: 4,
      excluded: 0,
      excludedByReason: {}
    });
  });

  test('deduplicates repeated evidence without reducing ordinary distinct results', () => {
    const repeated = 'Corwin, Tess and Pip went into Mine 07 to look for evidence.';
    const result = selectRetrievedEntries('What happened in Mine 07?', [
      entry('memory-a', 'workspace-memory', 'Corwin', repeated, 0.9),
      entry('memory-b', 'workspace-memory', 'Tess', repeated, 0.8),
      entry('fact', 'worldbuild-canon', 'Mine 07', 'The site was sealed by the Crown.', 0.7)
    ]);

    expect(result.selected.map((value: { key: string }) => value.key)).toEqual(['memory-a', 'fact']);
    expect(result.funnel.excludedByReason).toEqual({ 'semantic-duplicate': 1 });
  });
});

function entry(key: string, kind: string, source: string, content: string, relevance: number) {
  return { key, kind, source, content, relevance };
}
