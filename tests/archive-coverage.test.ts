import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';
import * as renderer from '../src/renderer/features/chat/archive-coverage';

const require = createRequire(import.meta.url);
const main = require('../src/main/features/chat/archive-coverage');

function messages(count: number, overrides: Record<number, any> = {}) {
  return Array.from({ length: count }, (_, index) => ({
    id: `m${index + 1}`,
    role: index % 2 === 0 ? 'user' : 'ai',
    content: `message ${index + 1}`,
    ...(overrides[index + 1] || {})
  }));
}

function block(id: string, ids: string[]) {
  return { id, type: 'summarized', title: id, messages: ids.map(messageId => ({ id: messageId })) };
}

describe('archive coverage', () => {
  test('active history excludes covered and excluded messages', () => {
    const list = messages(6, { 4: { excluded: 1 } });
    const blocks = [block('block_a', ['m1', 'm2'])];

    expect(main.selectActiveMessages(list, blocks).map((m: any) => m.id)).toEqual(['m3', 'm5', 'm6']);
  });

  test('a gap in the middle keeps later summaries covered', () => {
    const list = messages(9);
    const blocks = [block('block_a', ['m1', 'm2', 'm3']), block('block_c', ['m7', 'm8', 'm9'])];

    // block_b (m4-m6) was deleted: only its own messages come back.
    expect(main.selectActiveMessages(list, blocks).map((m: any) => m.id)).toEqual(['m4', 'm5', 'm6']);
  });

  test('derived index stops at the first live message', () => {
    const list = messages(9);
    const blocks = [block('block_a', ['m1', 'm2', 'm3']), block('block_c', ['m7', 'm8', 'm9'])];

    expect(main.deriveSummarizedIndex(list, blocks)).toBe(3);
    expect(main.deriveSummarizedIndex(list, [block('block_a', ['m1', 'm2', 'm3'])])).toBe(3);
    expect(main.deriveSummarizedIndex(list, [])).toBe(0);
  });

  test('derived index walks past excluded messages', () => {
    const list = messages(5, { 3: { excluded: 1 } });
    const blocks = [block('block_a', ['m1', 'm2', 'm4'])];

    expect(main.deriveSummarizedIndex(list, blocks)).toBe(4);
  });

  test('archivable candidates reserve the most recent messages', () => {
    const list = messages(9);

    // Default reserve: long roleplay replies make a wide window expensive.
    expect(main.RECENT_MESSAGE_RESERVE).toBe(5);
    expect(main.selectArchivableMessages(list, []).map((m: any) => m.id)).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(main.selectArchivableMessages(list, [], 10)).toEqual([]);
  });

  test('archivable candidates skip what is already covered', () => {
    const list = messages(9);
    const blocks = [block('block_a', ['m1', 'm2'])];

    expect(main.selectArchivableMessages(list, blocks).map((m: any) => m.id)).toEqual(['m3', 'm4']);
  });

  test('a reserved message that gets archived leaves live history at once', () => {
    const list = messages(9);
    const blocks = [block('block_a', ['m8'])];

    expect(main.selectActiveMessages(list, blocks).map((m: any) => m.id)).not.toContain('m8');
  });

  test('coverage stats split the history three ways', () => {
    const list = messages(6, { 5: { excluded: 1 } });
    const blocks = [block('block_a', ['m1', 'm2'])];

    expect(main.coverageStats(list, blocks)).toEqual({ total: 6, archived: 2, excluded: 1, active: 3 });
  });

  test('blocks stored as a JSON string behave the same', () => {
    const list = messages(4);
    const blocks = [block('block_a', ['m1'])];

    expect(main.selectActiveMessages(list, JSON.stringify(blocks)).map((m: any) => m.id))
      .toEqual(main.selectActiveMessages(list, blocks).map((m: any) => m.id));
  });

  test('manual snippets never cover history', () => {
    const list = messages(3);
    const blocks = [{ id: 'manual_1', type: 'manual', title: 'note', messages: [{ id: 'm1' }] }];

    expect(main.selectActiveMessages(list, blocks)).toHaveLength(3);
  });
});

describe('main and renderer copies agree', () => {
  const cases: Array<[any[], any[]]> = [
    [messages(0), []],
    [messages(5), []],
    [messages(9), [block('block_a', ['m1', 'm2', 'm3']), block('block_c', ['m7', 'm8', 'm9'])]],
    [messages(14, { 2: { excluded: 1 }, 12: { excluded: true } }), [block('block_a', ['m1', 'm3'])]],
    [messages(20), [block('block_a', ['m1', 'm2']), block('block_b', ['m5', 'm9'])]]
  ];

  test.each(cases)('case %#', (list, blocks) => {
    expect(renderer.selectActiveMessages(list, blocks)).toEqual(main.selectActiveMessages(list, blocks));
    expect(renderer.selectArchivableMessages(list, blocks)).toEqual(main.selectArchivableMessages(list, blocks));
    expect(renderer.deriveSummarizedIndex(list, blocks)).toEqual(main.deriveSummarizedIndex(list, blocks));
    expect(renderer.coverageStats(list, blocks)).toEqual(main.coverageStats(list, blocks));
    expect([...renderer.coveredMessageIds(blocks)]).toEqual([...main.coveredMessageIds(blocks)]);
  });
});
