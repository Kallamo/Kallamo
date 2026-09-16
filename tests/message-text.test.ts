import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { stripReasoning } = require('../src/main/features/chat/message-text');

describe('reasoning stored in messages', () => {
  test('removes closed and unclosed reasoning blocks', () => {
    expect(stripReasoning('<think>plan</think>Answer')).toBe('Answer');
    expect(stripReasoning('Before<thinking>long</thinking> after')).toBe('Before after');
    expect(stripReasoning('<think>never closed')).toBe('');
  });

  test('leaves a message without reasoning untouched', () => {
    const text = '  spaced text \n';
    expect(stripReasoning(text)).toBe(text);
  });
});
