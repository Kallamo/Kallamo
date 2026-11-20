import { describe, expect, test } from 'vitest';
import { chunkText } from '../src/main/features/knowledge/chunk-text';

function startsOnAWord(source: string, chunk: string): boolean {
  const first = chunk.split(/\s+/)[0];
  return source.startsWith(first) || new RegExp(`(^|\\s)${first.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`).test(source);
}

describe('chunkText', () => {
  test('a chunk never starts inside a word', () => {
    const source = Array.from({ length: 12 }, (_, index) => `Paragraph ${index + 1} tells how the smith tempered the blade. He waited for the colour to turn. Then he struck again, slower than before.`).join('\n\n');
    const chunks = chunkText(source, 300);
    expect(chunks.length).toBeGreaterThan(2);
    for (const chunk of chunks.slice(1)) expect(startsOnAWord(source, chunk)).toBe(true);
  });

  test('a long sentence tail becomes the overlap', () => {
    const source = Array.from({ length: 8 }, (_, index) => `Line ${index}: ${'the river ran cold under the bridge '.repeat(3)}and nobody crossed it that night.`).join(' ');
    const chunks = chunkText(source, 400);
    for (const chunk of chunks.slice(1)) expect(chunk).toMatch(/^(Line \d|[a-z]+)/);
  });
});
