// Renderer mirror of src/main/features/chat/archive-coverage.js, kept equal by tests/archive-coverage.test.ts.

// A default, not a rule: long roleplay replies make a wide reserve expensive.
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
