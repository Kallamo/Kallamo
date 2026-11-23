import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openFullSchemaDatabase, type FullSchemaDatabase } from './full-schema-harness';

const require = createRequire(import.meta.url);
const threads = require('../../src/main/features/chat/threads.js');
const store = require('../../src/main/features/chat/archive-store.js');
const { expandStoryMove } = require('../../src/main/features/chat/thread-move.js');
const { replaceMixedSummary } = require('../../src/main/features/chat/mixed-summary.js');
const { loadThreadHistory, renderHistorySlice } = require('../../src/main/features/chat/history-slice.js');

let harness: FullSchemaDatabase;
let db: any;

beforeEach(() => {
  harness = openFullSchemaDatabase();
  db = harness.db;
  db.prepare(`INSERT INTO chats (id, title, description, memoryBlocks, knowledgeFiles, activeProfiles, activeWorkflows, autoSummarize, archiveThreshold, lastTargetId)
    VALUES ('ws', 'Lighthouse', '', '[]', '[]', '[]', '[]', 1, 40000, 'brainstorming')`).run();
});
afterEach(() => harness.close());

function message(id: string, thread: string, role: string, at: number, content = id) {
  db.prepare('INSERT INTO messages (id, chatId, role, content, aiName, createdAt, thread) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, 'ws', role, content, role === 'user' ? '' : 'Narrator', at, thread);
}
const summary = (id: string, ids: string[], extra: Record<string, unknown> = {}) => ({ id, type: 'summarized', title: id, summary: `recap ${id}`, messages: ids.map(messageId => ({ id: messageId })), ...extra });
const setBlocks = (blocks: unknown[]) => db.prepare("UPDATE chats SET memoryBlocks = ? WHERE id = 'ws'").run(JSON.stringify(blocks));
const blocks = () => JSON.parse(db.prepare("SELECT memoryBlocks FROM chats WHERE id = 'ws'").get().memoryBlocks);
const threadOf = (id: string) => db.prepare('SELECT thread FROM messages WHERE id = ?').get(id).thread;
const chunk = (id: string, blockId: string) => db.prepare(`INSERT INTO knowledge_chunks (id, ownerId, ownerType, source, text, vector, createdAt, memoryBlockId) VALUES (?, 'ws', 'chat_memory', 'Chat Archive', 'text', '[]', 1, ?)`).run(id, blockId);

describe('conversation state', () => {
  test('the Chat reads the chat row and the Roleplay starts from the workspace values', () => {
    expect(threads.readThreadState(db, 'ws', 'chat')).toMatchObject({ autoSummarize: 1, archiveThreshold: 40000, lastTargetId: 'brainstorming' });
    expect(threads.readThreadState(db, 'ws', 'roleplay')).toMatchObject({ autoSummarize: 1, archiveThreshold: 40000, lastTargetId: null });
    threads.writeThreadState(db, 'ws', 'roleplay', { lastTargetId: 'narrator', autoSummarize: 0 });
    expect(threads.readThreadState(db, 'ws', 'roleplay')).toMatchObject({ autoSummarize: 0, lastTargetId: 'narrator' });
    expect(threads.readThreadState(db, 'ws', 'chat').lastTargetId).toBe('brainstorming');
  });

  test('each conversation keeps its own archive index', () => {
    ['c1', 'c2', 'c3'].forEach((id, index) => message(id, 'chat', 'user', index + 1));
    ['r1', 'r2'].forEach((id, index) => message(id, 'roleplay', 'ai', index + 10));
    setBlocks([summary('chat-a', ['c1', 'c2']), summary('story-a', ['r1'], { thread: 'roleplay' })]);
    store.syncSummarizedIndex(db, 'ws');
    expect(threads.readThreadState(db, 'ws', 'chat').summarizedIndex).toBe(2);
    expect(threads.readThreadState(db, 'ws', 'roleplay').summarizedIndex).toBe(1);
  });

  test('resetting one conversation leaves the other one archived', () => {
    message('c1', 'chat', 'user', 1);
    message('r1', 'roleplay', 'ai', 2);
    setBlocks([summary('chat-a', ['c1']), summary('story-a', ['r1'], { thread: 'roleplay' })]);
    store.resetSummaries(db, 'ws', 'roleplay');
    expect(blocks().map((block: any) => block.id)).toEqual(['chat-a']);
  });
});

describe('moving messages between the conversations', () => {
  beforeEach(() => {
    message('c1', 'chat', 'user', 1);
    message('c2', 'chat', 'ai', 2);
    message('c3', 'chat', 'user', 3);
    message('c4', 'chat', 'ai', 4);
  });

  test('a summary of moved messages only moves with them; nothing else changes', () => {
    setBlocks([summary('opening', ['c1', 'c2']), summary('inside', ['c3', 'c4'])]);
    chunk('k1', 'inside');
    const result = store.moveMessagesToThread(db, 'ws', ['c3', 'c4'], 'roleplay');
    expect(result).toMatchObject({ moved: 2, movedSummaries: [{ id: 'inside' }], mixedSummaries: [] });
    expect([threadOf('c3'), threadOf('c4'), threadOf('c1')]).toEqual(['roleplay', 'roleplay', 'chat']);
    expect(blocks().find((block: any) => block.id === 'inside').thread).toBe('roleplay');
    expect(db.prepare("SELECT COUNT(*) AS n FROM knowledge_chunks WHERE memoryBlockId = 'inside'").get().n).toBe(1);
    store.moveMessagesToThread(db, 'ws', ['c3', 'c4'], 'chat');
    expect(blocks().find((block: any) => block.id === 'inside').thread).toBeUndefined();
  });

  test('a mixed summary is kept where it was, and the plan counts the moved messages it covered', () => {
    setBlocks([summary('opening', ['c1', 'c2', 'c3'])]);
    chunk('k1', 'opening');
    const plan = store.planThreadMove(db, 'ws', ['c3', 'c4'], 'roleplay');
    expect(plan).toMatchObject({ moving: ['c3', 'c4'], mixedSummaries: [{ id: 'opening', moving: 1 }], position: 'empty' });
    const kept = store.moveMessagesToThread(db, 'ws', ['c3', 'c4'], 'roleplay');
    expect(kept.mixedSummaries).toEqual([{ id: 'opening', title: 'opening', moving: 1 }]);
    expect(blocks().map((block: any) => [block.id, block.thread])).toEqual([['opening', undefined]]);
    expect(db.prepare("SELECT COUNT(*) AS n FROM knowledge_chunks WHERE memoryBlockId = 'opening'").get().n).toBe(1);
    expect(threads.readThreadState(db, 'ws', 'roleplay').summarizedIndex).toBe(0);
  });

  describe('rebuilding a mixed summary', () => {
    // Stands in for Summarize: one block per call, holding the messages the call was given.
    let made = 0;
    const summarize = async ({ thread, messageIds, ignoreBlockIds }: any) => {
      expect(ignoreBlockIds).toEqual(['opening']);
      made += 1;
      const id = `new-${thread}-${made}`;
      setBlocks([...blocks(), summary(id, messageIds, thread === 'roleplay' ? { thread } : {})]);
      chunk(`chunk-${id}`, id);
      return { blockId: id };
    };
    const ready = async () => ({ success: true, recapStatus: 'ready' });
    const run = (finalize: any) => replaceMixedSummary({ database: db, chatId: 'ws', blockId: 'opening', profileId: 'p', summarize, finalize, recapFailed: (status: string) => status === 'failed' });

    beforeEach(() => {
      made = 0;
      setBlocks([summary('opening', ['c1', 'c2', 'c3'])]);
      chunk('k1', 'opening');
      store.moveMessagesToThread(db, 'ws', ['c3'], 'roleplay');
    });

    test('each side gets its own summary, and the old one goes after both exist', async () => {
      const result = await run(ready);
      expect(result).toMatchObject({ success: true, created: ['new-roleplay-1', 'new-chat-2'] });
      expect(blocks().map((block: any) => [block.id, block.thread])).toEqual([['new-roleplay-1', 'roleplay'], ['new-chat-2', undefined]]);
      expect(db.prepare("SELECT COUNT(*) AS n FROM knowledge_chunks WHERE memoryBlockId = 'opening'").get().n).toBe(0);
      expect(threads.readThreadState(db, 'ws', 'roleplay').summarizedIndex).toBe(1);
      expect(threads.readThreadState(db, 'ws', 'chat').summarizedIndex).toBe(2);
    });

    test('a failed recap removes the new summaries and keeps the old one whole', async () => {
      const result = await run(async ({ blockId }: any) => (blockId.includes('chat') ? { success: true, recapStatus: 'failed', recapError: 'No model' } : { success: true, recapStatus: 'ready' }));
      expect(result).toMatchObject({ success: false, title: 'opening', error: 'No model' });
      expect(blocks().map((block: any) => block.id)).toEqual(['opening']);
      expect(db.prepare("SELECT COUNT(*) AS n FROM knowledge_chunks WHERE memoryBlockId = 'opening'").get().n).toBe(1);
      expect(db.prepare("SELECT COUNT(*) AS n FROM knowledge_chunks WHERE memoryBlockId LIKE 'new-%'").get().n).toBe(0);
    });

    test('a Summarize that throws, as with no model, leaves the old summary too', async () => {
      const result = await replaceMixedSummary({ database: db, chatId: 'ws', blockId: 'opening', summarize: async () => { throw new Error('No embedding model'); }, finalize: ready, recapFailed: () => false });
      expect(result).toMatchObject({ success: false, error: 'No embedding model' });
      expect(blocks().map((block: any) => block.id)).toEqual(['opening']);
    });
  });

  test('the plan says where the messages land, by when they were written', () => {
    message('r1', 'roleplay', 'ai', 10);
    expect(store.planThreadMove(db, 'ws', ['c1'], 'roleplay').position).toBe('start');
    message('r0', 'roleplay', 'ai', 0);
    expect(store.planThreadMove(db, 'ws', ['c3'], 'roleplay')).toMatchObject({ position: 'between', before: { id: 'r0' }, after: { id: 'r1' } });
    message('c9', 'chat', 'user', 20);
    expect(store.planThreadMove(db, 'ws', ['c9'], 'roleplay').position).toBe('end');
  });

  test('a story turn goes back to the Chat with every turn after it, newest taken back first', () => {
    store.moveMessagesToThread(db, 'ws', ['c1', 'c2', 'c3', 'c4'], 'roleplay');
    for (const id of ['c2', 'c4']) {
      db.prepare(`INSERT INTO roleplay_message_frames (workspace_id, origin_id, start_json, end_json, created_at, updated_at) VALUES ('ws', ?, '{}', '{}', 1, 1)`).run(id);
    }
    expect(expandStoryMove(db, 'ws', ['c2'], 'chat')).toEqual({ ids: ['c2', 'c1', 'c3', 'c4'], takeBack: ['c4', 'c2'], added: 3 });
    expect(expandStoryMove(db, 'ws', ['c3'], 'chat')).toMatchObject({ ids: ['c3', 'c4'], takeBack: ['c4'] });
    expect(expandStoryMove(db, 'ws', ['c1'], 'roleplay')).toEqual({ ids: ['c1'], takeBack: [], added: 0 });
  });
});

describe('a slice of one conversation for another reader', () => {
  const estimate = (text: string) => Math.ceil(text.length / 4);

  test('the newest messages fit first, oldest first in the text, and summaries take what is left', () => {
    for (let index = 1; index <= 30; index += 1) message(`r${index}`, 'roleplay', index % 2 ? 'user' : 'ai', index, `line ${index} `.repeat(20));
    setBlocks([summary('early', ['r1', 'r2'], { thread: 'roleplay' })]);
    const history = loadThreadHistory(db, 'ws', 'roleplay');
    expect(history.messages.map((m: any) => m.id)).not.toContain('r1');
    const slice = renderHistorySlice({ history, room: 1200, estimate, heading: 'THE ROLEPLAY SO FAR' });
    expect(slice.tokens).toBeLessThanOrEqual(1200);
    expect(slice.messages).toBeGreaterThan(3);
    expect(slice.text).toContain('recap early');
    expect(slice.text.indexOf('line 29')).toBeLessThan(slice.text.indexOf('line 30'));
    expect(slice.text).not.toContain('line 3 ');
  });

  test('no room or no history gives no text', () => {
    expect(renderHistorySlice({ history: loadThreadHistory(db, 'ws', 'roleplay'), room: 500, estimate, heading: 'X' }).text).toBe('');
    message('r1', 'roleplay', 'ai', 1, 'hello');
    expect(renderHistorySlice({ history: loadThreadHistory(db, 'ws', 'roleplay'), room: 0, estimate, heading: 'X' }).text).toBe('');
  });

  test('the Chat never reads summaries of the Roleplay as its own', () => {
    message('c1', 'chat', 'user', 1);
    setBlocks([summary('story', ['r9'], { thread: 'roleplay' }), { id: 'note', type: 'manual', strategy: 'constant' }]);
    expect(threads.threadSummaryBlocks(blocks(), 'chat')).toEqual([]);
    expect(threads.blocksForThread(blocks(), 'chat').map((block: any) => block.id)).toEqual(['note']);
  });
});
