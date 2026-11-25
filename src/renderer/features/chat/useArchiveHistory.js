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

const NO_HISTORY = [];

// The complete persisted history, for context estimates and archiving prompts. It is read
// from disk when the workspace opens or archiving changes older messages; each new reply
// is merged from the page instead of re-reading the whole chat. Until the conversation on
// screen has been read, nothing is returned, never the history of the one just left.
export function useArchiveHistory({ api, chatId, thread = 'chat', activeMessages, revision, memoryBlocks }) {
  const key = chatId ? `${chatId}:${thread}` : null;
  const [history, setHistory] = useState({ key: null, messages: NO_HISTORY });
  const baseRef = useRef(null);
  const activeMessagesRef = useRef(activeMessages);
  activeMessagesRef.current = activeMessages;

  useEffect(() => {
    baseRef.current = null;
    if (!key) {
      setHistory({ key: null, messages: NO_HISTORY });
      return undefined;
    }
    let cancelled = false;
    const handle = scheduleIdle(async () => {
      const messages = await api.getChatMessages(chatId, thread);
      if (cancelled) return;
      baseRef.current = { key, messages: messages || [] };
      setHistory({ key, messages: mergeHistory(baseRef.current.messages, activeMessagesRef.current) });
    });
    return () => {
      cancelled = true;
      cancelIdle(handle);
    };
  }, [api, chatId, thread, key, revision, memoryBlocks]);

  useEffect(() => {
    const base = baseRef.current;
    if (base && base.key === key) setHistory({ key, messages: mergeHistory(base.messages, activeMessages) });
  }, [activeMessages, key]);

  return history.key === key ? history.messages : NO_HISTORY;
}
