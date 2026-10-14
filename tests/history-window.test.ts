import { createRequire } from 'node:module';
import { beforeEach, describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { formatActiveHistory } = require('../src/main/features/chat/history-window');
const { resetAllScopes } = require('../src/main/features/llm/prompt-cache');

// Roughly 25 tokens each, so a budget expressed in hundreds of tokens maps to a
// predictable number of messages.
function conversation(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `msg_${index}`,
    role: index % 2 === 0 ? 'user' : 'ai',
    content: `Turn ${index}. ${'narrative sentence '.repeat(12)}`
  }));
}

function firstId(history: Array<{ content: string }>) {
  return history[0]?.content.split('.')[0];
}

beforeEach(() => {
  resetAllScopes();
});

describe('history window', () => {
  test('a presence note leads the message it belongs to and counts toward its size', () => {
    const plain = { id: 'u1', role: 'user', content: 'I open the gate.' };
    const noted = { ...plain, presenceNote: '[In the scene at North Gate: Ilse, Warden Bram]' };

    expect(formatActiveHistory([noted], 100000)).toEqual([
      { role: 'user', content: '[In the scene at North Gate: Ilse, Warden Bram]\nI open the gate.' }
    ]);
    expect(formatActiveHistory([noted], 12)).toEqual([]);
    expect(formatActiveHistory([plain], 12)).toHaveLength(1);
  });

  test('without a cache scope it still takes the longest fitting suffix', () => {
    const messages = conversation(40);
    const wide = formatActiveHistory(messages, 100000);
    const narrow = formatActiveHistory(messages, 400);

    expect(wide).toHaveLength(40);
    expect(narrow.length).toBeGreaterThan(0);
    expect(narrow.length).toBeLessThan(40);
    // The unanchored path is unchanged: a second call with the same budget
    // reproduces the same window.
    expect(formatActiveHistory(messages, 400)).toEqual(narrow);
  });

  test('an anchored window holds its first message while the budget wobbles', () => {
    const scope = 'chat-1';
    const messages = conversation(40);

    const first = formatActiveHistory(messages, 1200, scope);
    const anchored = firstId(first);

    // A turn with a fat retrieval block leaves less room, and a turn with none
    // leaves more. Neither should move the start of the window, because the
    // anchored window still fits.
    const tighter = formatActiveHistory(messages, 1100, scope);
    const looser = formatActiveHistory(messages, 4000, scope);

    expect(firstId(tighter)).toBe(anchored);
    expect(firstId(looser)).toBe(anchored);
  });

  test('the window grows onto the same anchor as the conversation continues', () => {
    const scope = 'chat-2';
    const before = formatActiveHistory(conversation(20), 100000, scope);
    const after = formatActiveHistory(conversation(24), 100000, scope);

    expect(firstId(after)).toBe(firstId(before));
    expect(after.length).toBe(before.length + 4);
  });

  test('re-anchoring frees headroom instead of dropping one message per turn', () => {
    const scope = 'chat-3';
    const messages = conversation(60);

    // Establish an anchor against a generous budget, then squeeze it hard.
    formatActiveHistory(messages, 100000, scope);
    const reanchored = formatActiveHistory(messages, 1200, scope);
    const unanchored = formatActiveHistory(messages, 1200);

    // The trimmed window is deliberately shorter than the maximum that fits, so
    // the next several turns can grow onto it without moving the anchor again.
    expect(reanchored.length).toBeLessThan(unanchored.length);
    expect(reanchored.length).toBeGreaterThan(0);

    const anchored = firstId(reanchored);
    expect(firstId(formatActiveHistory(messages, 1200, scope))).toBe(anchored);
  });

  test('headroom never empties a window the full budget could carry', () => {
    const scope = 'chat-4';
    const messages = conversation(3);
    // Budget fits exactly one message at full size and none once headroom is
    // taken out; the fallback must still send that one message.
    const oneMessage = formatActiveHistory(messages, 100000, scope)[0];
    const tokens = Math.ceil(oneMessage.content.length / 3);
    const history = formatActiveHistory(messages, tokens, 'chat-5');

    expect(history.length).toBeGreaterThan(0);
  });
});
