import { useEffect, useRef, useState } from 'react';

const compareMessages = (left, right) => (left.createdAt - right.createdAt)
  || (left.id < right.id ? -1 : left.id > right.id ? 1 : 0);

// The shown page is the source of truth for everything it covers; older messages come
// from the last full read, which nothing on screen can have changed.
export function mergeHistory(history, page) {
  if (!page.length) return page;
  const oldest = page[0];
  return [...history.filter(message => compareMessages(message, oldest) < 0), ...page];
}

const scheduleIdle = callback => (typeof window.requestIdleCallback === 'function'
  ? { idle: window.requestIdleCallback(callback, { timeout: 500 }) }
  : { timer: setTimeout(callback, 50) });

const cancelIdle = handle => {
  if (handle.idle !== undefined) window.cancelIdleCallback(handle.idle);
  if (handle.timer !== undefined) clearTimeout(handle.timer);
};

// The complete persisted history, for context estimates and archiving prompts. It is read
// from disk when the workspace opens or archiving changes older messages; each new reply
// is merged from the page instead of re-reading the whole chat.
export function useArchiveHistory({ api, chatId, activeMessages, revision, memoryBlocks }) {
  const [history, setHistory] = useState([]);
  const baseRef = useRef(null);
  const activeMessagesRef = useRef(activeMessages);
  activeMessagesRef.current = activeMessages;

  useEffect(() => {
    baseRef.current = null;
    if (!chatId) {
      setHistory([]);
      return undefined;
    }
    let cancelled = false;
    const handle = scheduleIdle(async () => {
      const messages = await api.getChatMessages(chatId);
      if (cancelled) return;
      baseRef.current = messages || [];
      setHistory(mergeHistory(baseRef.current, activeMessagesRef.current));
    });
    return () => {
      cancelled = true;
      cancelIdle(handle);
    };
  }, [api, chatId, revision, memoryBlocks]);

  useEffect(() => {
    if (baseRef.current) setHistory(mergeHistory(baseRef.current, activeMessages));
  }, [activeMessages]);

  return history;
}
