// Renderer mirror of src/main/features/chat/archive-coverage.js.
//
// The context bar, the archive window and the memory view all need to know
// which messages are still live history. Keeping the logic pure on both sides
// means the number the user sees is the number the payload will use. Both
// copies are checked against each other in tests/archive-coverage.test.ts.

// How many of the newest messages the archive window holds back by default.
// Roleplay replies run long, so a wider reserve can pin tens of thousands of
// tokens in the payload for no gain. It is a default, not a rule: the window
// can offer them, and archiving them takes them out of live history at once.
export const RECENT_MESSAGE_RESERVE = 5;

export function parseMemoryBlocks(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function summaryBlocks(memoryBlocks) {
  return parseMemoryBlocks(memoryBlocks).filter(block => block && block.type === 'summarized');
}

export function coveredMessageIds(memoryBlocks) {
  const covered = new Set();
  for (const block of summaryBlocks(memoryBlocks)) {
    const messages = Array.isArray(block.messages) ? block.messages : [];
    for (const message of messages) {
      const id = typeof message === 'string' ? message : message && message.id;
      if (id) covered.add(id);
    }
  }
  return covered;
}

export function isExcluded(message) {
  return !!(message && (message.excluded === 1 || message.excluded === true));
}

export function selectActiveMessages(messages, memoryBlocks) {
  const covered = coveredMessageIds(memoryBlocks);
  return (messages || []).filter(message => message && !covered.has(message.id) && !isExcluded(message));
}

export function selectArchivableMessages(messages, memoryBlocks, reserveRecent = RECENT_MESSAGE_RESERVE) {
  const list = messages || [];
  const reserveFrom = Math.max(0, list.length - Math.max(0, reserveRecent));
  const reserved = new Set(list.slice(reserveFrom).map(message => message && message.id).filter(Boolean));
  return selectActiveMessages(list, memoryBlocks).filter(message => !reserved.has(message.id));
}

export function deriveSummarizedIndex(messages, memoryBlocks) {
  const covered = coveredMessageIds(memoryBlocks);
  const list = messages || [];
  let index = 0;
  while (index < list.length) {
    const message = list[index];
    if (!message) break;
    if (!covered.has(message.id) && !isExcluded(message)) break;
    index += 1;
  }
  return index;
}

export function coverageStats(messages, memoryBlocks) {
  const covered = coveredMessageIds(memoryBlocks);
  const list = messages || [];
  let archived = 0;
  let excluded = 0;
  let active = 0;
  for (const message of list) {
    if (!message) continue;
    if (covered.has(message.id)) archived += 1;
    else if (isExcluded(message)) excluded += 1;
    else active += 1;
  }
  return { total: list.length, archived, excluded, active };
}
