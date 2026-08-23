// Which messages a workspace still sends as live history, and which ones its
// summaries already cover.
//
// The archive used to be described by a single number (chats.summarizedIndex,
// "everything before N is archived"). A number cannot describe a gap, so any
// operation that produced one (deleting a summary, archiving a non-contiguous
// selection, deleting a message) left the marker disagreeing with the summary
// blocks. Coverage is now derived from the message ids the blocks already
// store; summarizedIndex is kept only as a derived value for older readers and
// for exported packages.
//
// Mirrored in src/renderer/features/chat/archive-coverage.js. Both copies are
// pure and are checked against each other in tests/archive-coverage.test.ts.

// How many of the newest messages the archive window holds back by default.
// Roleplay replies run long, so a wider reserve can pin tens of thousands of
// tokens in the payload for no gain. It is a default, not a rule: the window
// can offer them, and archiving them takes them out of live history at once.
const RECENT_MESSAGE_RESERVE = 5;

function parseMemoryBlocks(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function summaryBlocks(memoryBlocks) {
  return parseMemoryBlocks(memoryBlocks).filter(block => block && block.type === 'summarized');
}

// Every message id claimed by a summary block, regardless of ordering or gaps.
function coveredMessageIds(memoryBlocks) {
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

function isExcluded(message) {
  return !!(message && (message.excluded === 1 || message.excluded === true));
}

// Live history: not claimed by a summary and not muted by the user.
function selectActiveMessages(messages, memoryBlocks) {
  const covered = coveredMessageIds(memoryBlocks);
  return (messages || []).filter(message => message && !covered.has(message.id) && !isExcluded(message));
}

// Candidates the archive window may offer: live history minus the most recent
// messages, which stay whole so the next reply keeps its immediate continuity.
function selectArchivableMessages(messages, memoryBlocks, reserveRecent = RECENT_MESSAGE_RESERVE) {
  const list = messages || [];
  const reserveFrom = Math.max(0, list.length - Math.max(0, reserveRecent));
  const reserved = new Set(list.slice(reserveFrom).map(message => message && message.id).filter(Boolean));
  return selectActiveMessages(list, memoryBlocks).filter(message => !reserved.has(message.id));
}

// Legacy marker: how many messages from the start are already out of live
// history. Only meaningful while that run is contiguous, which is exactly the
// case the old model could represent.
function deriveSummarizedIndex(messages, memoryBlocks) {
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

function coverageStats(messages, memoryBlocks) {
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

module.exports = {
  RECENT_MESSAGE_RESERVE,
  parseMemoryBlocks,
  summaryBlocks,
  coveredMessageIds,
  isExcluded,
  selectActiveMessages,
  selectArchivableMessages,
  deriveSummarizedIndex,
  coverageStats
};
