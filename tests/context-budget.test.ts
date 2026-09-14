import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const {
  packContextItems,
  renderContextSections,
  selectRecentWithinBudget,
  splitRetrievalBudget,
  retrievalTopK,
  RETRIEVAL_ITEM_TOKENS,
  RETRIEVAL_TOP_K_MAX,
  truncateToTokens
} = require('../src/main/features/llm/context-budget');

const estimate = (text: string) => Math.ceil(String(text || '').length / 4);

describe('retrieval context budget', () => {
  test('keeps everything in its original order when the budget allows', () => {
    const items = [
      { section: 'A', text: 'first '.repeat(10), score: 0.1 },
      { section: 'B', text: 'second '.repeat(10), score: 0.9 }
    ];
    const packed = packContextItems(items, 1000, { estimate });
    expect(packed.kept.map((item: any) => item.text)).toEqual(items.map(item => item.text));
    expect(packed.dropped).toBe(0);
  });

  test('drops the lowest scores first and never exceeds the budget', () => {
    const items = Array.from({ length: 10 }, (_, i) => ({ section: 'S', text: 'x'.repeat(400), score: i / 10 }));
    const packed = packContextItems(items, 350, { estimate });
    expect(packed.usedTokens).toBeLessThanOrEqual(350);
    expect(packed.kept.map((item: any) => item.score)).toEqual([0.7, 0.8, 0.9]);
    expect(packed.dropped).toBe(7);
  });

  test('ranks by tier before score', () => {
    const items = [
      { section: 'S', text: 'y'.repeat(400), tier: 2, score: 0.99 },
      { section: 'F', text: 'z'.repeat(400), tier: 0, score: 0 }
    ];
    const packed = packContextItems(items, 110, { estimate });
    expect(packed.kept).toHaveLength(1);
    expect(packed.kept[0].section).toBe('F');
  });

  test('cuts a long file to its share and keeps room for chunks', () => {
    const file = { section: 'FILE', text: 'word '.repeat(4000), tier: 0, truncatable: true };
    const chunk = { section: 'CHUNK', text: 'c'.repeat(400), tier: 1, score: 0.8 };
    const packed = packContextItems([file, chunk], 1000, { estimate, maxItemShare: 0.6 });
    const keptFile = packed.kept.find((item: any) => item.section === 'FILE');
    expect(keptFile.truncated).toBe(true);
    expect(estimate(keptFile.text)).toBeLessThanOrEqual(600);
    expect(packed.kept.some((item: any) => item.section === 'CHUNK')).toBe(true);
    expect(packed.usedTokens).toBeLessThanOrEqual(1000);
  });

  test('renders sections in the given order under their headers', () => {
    const kept = [
      { section: '--- B ---', text: 'b1' },
      { section: '--- A ---', text: 'a1' },
      { section: '--- A ---', text: 'a2' }
    ];
    expect(renderContextSections(kept, ['--- A ---', '--- B ---'])).toBe('--- A ---\na1\n\na2\n\n--- B ---\nb1');
  });

  test('guarantees retrieval a share without letting it starve history', () => {
    expect(splitRetrievalBudget({ availableTokens: 10000, historyTokens: 2000 })).toBe(8000);
    expect(splitRetrievalBudget({ availableTokens: 10000, historyTokens: 50000 })).toBe(4000);
    expect(splitRetrievalBudget({ availableTokens: 0, historyTokens: 100 })).toBe(0);
  });

  test('selects the newest contiguous messages that fit', () => {
    const messages = [
      { role: 'user', content: 'a'.repeat(400) },
      { role: 'ai', content: 'b'.repeat(40) },
      { role: 'user', content: 'c'.repeat(40) }
    ];
    const result = selectRecentWithinBudget(messages, 40, { estimate, overhead: 4 });
    expect(result.selected.map((entry: any) => entry.text)).toEqual(['b'.repeat(40), 'c'.repeat(40)]);
    expect(result.dropped).toBe(1);
  });

  test('truncates to a token limit with a visible marker', () => {
    const cut = truncateToTokens('alpha beta gamma delta '.repeat(200), 50, estimate);
    expect(estimate(cut)).toBeLessThanOrEqual(50);
    expect(cut).toMatch(/cut to fit the context budget/);
  });

  test('keeps the configured Top-K when the budget has no room for more', () => {
    expect(retrievalTopK(5, 0)).toBe(5);
    expect(retrievalTopK(5, RETRIEVAL_ITEM_TOKENS * 2)).toBe(5);
  });

  test('asks for more passages when the budget can hold them', () => {
    expect(retrievalTopK(5, RETRIEVAL_ITEM_TOKENS * 12)).toBe(12);
    expect(retrievalTopK(5, RETRIEVAL_ITEM_TOKENS * 36, { tiers: 3 })).toBe(12);
  });

  test('never goes past the ceiling, and never below what the user asked for', () => {
    expect(retrievalTopK(5, RETRIEVAL_ITEM_TOKENS * 500)).toBe(RETRIEVAL_TOP_K_MAX);
    expect(retrievalTopK(RETRIEVAL_TOP_K_MAX + 10, 0)).toBe(RETRIEVAL_TOP_K_MAX + 10);
  });
});
