import { describe, expect, test, vi } from 'vitest';
import { reconcileMessages } from '../src/renderer/features/chat/message-reconcile';
import { mergeHistory } from '../src/renderer/features/chat/useArchiveHistory';
import { createStore } from '../src/renderer/utils/store';

const message = (id: string, createdAt: number, extra: Record<string, unknown> = {}) => ({
  id,
  chatId: 'chat',
  role: 'ai',
  content: `content ${id}`,
  attachedFiles: [],
  createdAt,
  ...extra
});

describe('reconcileMessages', () => {
  test('keeps the previous array when a reload returns the same messages', () => {
    const previous = [message('a', 1), message('b', 2)];
    const reloaded = previous.map(item => ({ ...item, attachedFiles: [] }));
    expect(reconcileMessages(previous, reloaded)).toBe(previous);
  });

  test('reuses unchanged rows and takes the new object for a changed or added row', () => {
    const previous = [message('a', 1), message('b', 2)];
    const reloaded = [message('a', 1), message('b', 2, { content: 'edited' }), message('c', 3)];
    const result = reconcileMessages(previous, reloaded);
    expect(result).not.toBe(previous);
    expect(result[0]).toBe(previous[0]);
    expect(result[1]).toBe(reloaded[1]);
    expect(result[2]).toBe(reloaded[2]);
  });

  test('notices a field that only exists on one side', () => {
    const previous = [message('a', 1)];
    const reloaded = [message('a', 1, { debugNotice: '{"truncated":true}' })];
    expect(reconcileMessages(previous, reloaded)[0]).toBe(reloaded[0]);
  });

  test('reports a removed row as a change', () => {
    const previous = [message('a', 1), message('b', 2)];
    const reloaded = [message('a', 1)];
    const result = reconcileMessages(previous, reloaded);
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(previous[0]);
  });
});

describe('mergeHistory', () => {
  test('takes messages older than the page from disk and everything else from the page', () => {
    const disk = [message('a', 1), message('b', 2), message('c', 3, { content: 'stale' })];
    const page = [message('c', 3), message('d', 4)];
    expect(mergeHistory(disk, page).map((item: { id: string }) => item.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(mergeHistory(disk, page)[2].content).toBe('content c');
  });

  test('drops a message deleted from the page even if the disk read still has it', () => {
    const disk = [message('a', 1), message('b', 2), message('c', 3)];
    const page = [message('b', 2)];
    expect(mergeHistory(disk, page).map((item: { id: string }) => item.id)).toEqual(['a', 'b']);
  });

  test('orders same-timestamp messages by id, as the page query does', () => {
    const disk = [message('a', 5), message('b', 5), message('c', 5)];
    const page = [message('b', 5), message('c', 5)];
    expect(mergeHistory(disk, page).map((item: { id: string }) => item.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('createStore', () => {
  test('notifies subscribers only when the value changes', () => {
    const store = createStore({ content: '' });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);
    store.set((previous: { content: string }) => ({ content: `${previous.content}a` }));
    expect(store.get()).toEqual({ content: 'a' });
    store.set(store.get());
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    store.set({ content: 'b' });
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
