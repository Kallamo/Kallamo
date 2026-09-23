import { describe, expect, test } from 'vitest';
import { readAlternativeSwitcher } from '../src/renderer/features/chat/message-alternatives';

const reply = (content: string) => ({ content, aiName: 'Narrator', aiColor: '#fff', createdAt: 1 });

describe('readAlternativeSwitcher', () => {
  test('reads the stored { activeIndex, list } shape', () => {
    const stored = JSON.stringify({ activeIndex: 1, list: [reply('a'), reply('b'), reply('c')] });
    expect(readAlternativeSwitcher(stored)).toEqual({ index: 1, count: 3 });
  });

  test('accepts an already parsed object', () => {
    expect(readAlternativeSwitcher({ activeIndex: 2, list: [reply('a'), reply('b'), reply('c')] }))
      .toEqual({ index: 2, count: 3 });
  });

  test('reads a legacy array as the list at index 0', () => {
    expect(readAlternativeSwitcher(JSON.stringify([reply('a'), reply('b')]))).toEqual({ index: 0, count: 2 });
  });

  test('falls back to index 0 when activeIndex is missing or out of range', () => {
    const list = [reply('a'), reply('b')];
    expect(readAlternativeSwitcher(JSON.stringify({ list }))).toEqual({ index: 0, count: 2 });
    expect(readAlternativeSwitcher(JSON.stringify({ activeIndex: 5, list }))).toEqual({ index: 0, count: 2 });
    expect(readAlternativeSwitcher(JSON.stringify({ activeIndex: -1, list }))).toEqual({ index: 0, count: 2 });
    expect(readAlternativeSwitcher(JSON.stringify({ activeIndex: '1', list }))).toEqual({ index: 0, count: 2 });
  });

  test('returns null for missing or invalid JSON', () => {
    expect(readAlternativeSwitcher(undefined)).toBeNull();
    expect(readAlternativeSwitcher(null)).toBeNull();
    expect(readAlternativeSwitcher('')).toBeNull();
    expect(readAlternativeSwitcher('{not json')).toBeNull();
    expect(readAlternativeSwitcher('null')).toBeNull();
    expect(readAlternativeSwitcher(JSON.stringify({ activeIndex: 0 }))).toBeNull();
    expect(readAlternativeSwitcher(JSON.stringify({ activeIndex: 0, list: 'nope' }))).toBeNull();
  });

  test('returns null for a single-entry list, so no switcher renders', () => {
    expect(readAlternativeSwitcher(JSON.stringify({ activeIndex: 0, list: [reply('a')] }))).toBeNull();
    expect(readAlternativeSwitcher(JSON.stringify([reply('a')]))).toBeNull();
    expect(readAlternativeSwitcher(JSON.stringify({ activeIndex: 0, list: [] }))).toBeNull();
  });
});
