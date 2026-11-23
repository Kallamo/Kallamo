import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openFullSchemaDatabase, type FullSchemaDatabase } from './full-schema-harness';

const require = createRequire(import.meta.url);
const { MIGRATIONS, runDatabaseMigrations } = require('../../src/main/database/migrations.js');
const { splitConversationThreads } = require('../../src/main/database/thread-migration.js');

let harness: FullSchemaDatabase;
let db: any;

beforeEach(() => { harness = openFullSchemaDatabase({ stopBefore: 'conversation_threads_v1' }); db = harness.db; });
afterEach(() => harness.close());

const migrate = () => runDatabaseMigrations(db, MIGRATIONS);

function workspace(id: string, mode: 'standard' | 'roleplay', blocks: unknown[] = []) {
  db.prepare(`INSERT INTO chats (id, title, description, memoryBlocks, knowledgeFiles, activeProfiles, activeWorkflows, autoSummarize, archiveThreshold, lastTargetId)
    VALUES (?, ?, '', ?, '[]', '[]', '[]', 1, 50000, 'narrator')`).run(id, id, JSON.stringify(blocks));
  db.prepare('INSERT INTO workspace_experience_modes (workspace_id, mode, updated_at) VALUES (?, ?, 1)').run(id, mode);
}

function message(id: string, chatId: string, role: string, at: number) {
  db.prepare('INSERT INTO messages (id, chatId, role, content, createdAt) VALUES (?, ?, ?, ?, ?)').run(id, chatId, role, id, at);
}

function mark(table: string, workspaceId: string, originId: string) {
  if (table === 'roleplay_message_frames') {
    db.prepare(`INSERT INTO roleplay_message_frames (workspace_id, origin_id, start_json, end_json, created_at, updated_at) VALUES (?, ?, '{}', '{}', 1, 1)`).run(workspaceId, originId);
  } else if (table === 'roleplay_turn_snapshots') {
    db.prepare(`INSERT INTO roleplay_turn_snapshots (workspace_id, origin_id, snapshot_json, created_at) VALUES (?, ?, '{}', 1)`).run(workspaceId, originId);
  } else {
    db.prepare(`INSERT INTO narrative_origin_lifecycle (workspace_id, origin_id, status, updated_at) VALUES (?, ?, 'active', 1)`).run(workspaceId, originId);
  }
}

const threadOf = (id: string) => db.prepare('SELECT thread FROM messages WHERE id = ?').get(id).thread;
const blocksOf = (id: string) => JSON.parse(db.prepare('SELECT memoryBlocks FROM chats WHERE id = ?').get(id).memoryBlocks);
const summary = (id: string, ids: string[]) => ({ id, type: 'summarized', title: id, messages: ids.map(messageId => ({ id: messageId })) });

describe('splitting each workspace into the Chat and the Roleplay', () => {
  test('a beta campaign moves whole: marked replies, the messages before them and an unmarked failed reply', () => {
    workspace('axiom', 'roleplay', [summary('early', ['u1', 'a1', 'u2', 'a2'])]);
    message('u1', 'axiom', 'user', 1);
    message('a1', 'axiom', 'ai', 2);
    message('u2', 'axiom', 'user', 3);
    message('a2', 'axiom', 'ai', 4);
    message('u3', 'axiom', 'user', 5);
    message('failed', 'axiom', 'ai', 6);
    mark('roleplay_message_frames', 'axiom', 'a1');
    mark('roleplay_turn_snapshots', 'axiom', 'a2');
    mark('narrative_origin_lifecycle', 'axiom', 'a2');
    migrate();
    expect(['u1', 'a1', 'u2', 'a2', 'u3', 'failed'].map(threadOf)).toEqual(Array(6).fill('roleplay'));
    expect(blocksOf('axiom')[0].thread).toBe('roleplay');
    const roleplay = db.prepare("SELECT * FROM workspace_threads WHERE workspace_id = 'axiom' AND thread = 'roleplay'").get();
    expect(roleplay).toMatchObject({ summarized_index: 4, auto_summarize: 1, archive_threshold: 50000, last_target_id: 'narrator' });
    expect(db.prepare("SELECT summarizedIndex FROM chats WHERE id = 'axiom'").get().summarizedIndex).toBe(0);
  });

  test('an opening reply with no user message before it starts the campaign', () => {
    workspace('evenwell', 'roleplay');
    message('opening', 'evenwell', 'ai', 1);
    message('u1', 'evenwell', 'user', 2);
    message('a1', 'evenwell', 'ai', 3);
    mark('roleplay_message_frames', 'evenwell', 'opening');
    migrate();
    expect(['opening', 'u1', 'a1'].map(threadOf)).toEqual(['roleplay', 'roleplay', 'roleplay']);
  });

  test('talk before the first marked reply stays in the Chat, and a mixed summary follows the majority', () => {
    workspace('mixed', 'roleplay', [summary('talk', ['c1', 'c2', 'c3']), summary('bridge', ['c3', 'u1', 'a1'])]);
    message('c1', 'mixed', 'user', 1);
    message('c2', 'mixed', 'ai', 2);
    message('c3', 'mixed', 'user', 3);
    message('u1', 'mixed', 'user', 4);
    message('a1', 'mixed', 'ai', 5);
    mark('roleplay_message_frames', 'mixed', 'a1');
    const logged: string[] = [];
    const reports = splitConversationThreads(db, { log: (line: string) => logged.push(line) });
    expect(['c1', 'c2', 'c3', 'u1', 'a1'].map(threadOf)).toEqual(['chat', 'chat', 'chat', 'roleplay', 'roleplay']);
    const blocks = blocksOf('mixed');
    expect(blocks.find((block: any) => block.id === 'talk').thread).toBeUndefined();
    expect(blocks.find((block: any) => block.id === 'bridge').thread).toBe('roleplay');
    expect(reports.find((report: any) => report.workspaceId === 'mixed').mixedSummaries).toHaveLength(1);
    expect(logged.some(line => line.includes('"bridge"'))).toBe(true);
  });

  test('a split workspace hands the target to the Roleplay and points the Desk at the story it read', () => {
    for (const [id, mode, uses] of [['reads', 'roleplay', 1], ['quiet', 'roleplay', 0], ['plain', 'standard', 1]] as const) {
      workspace(id, mode);
      db.prepare('UPDATE chats SET wdUseChatHistory = ? WHERE id = ?').run(uses, id);
      message(`${id}-a`, id, 'ai', 1);
      mark('roleplay_message_frames', id, `${id}-a`);
    }
    migrate();
    const row = (id: string) => db.prepare('SELECT lastTargetId, wdHistorySource FROM chats WHERE id = ?').get(id);
    expect(row('reads')).toEqual({ lastTargetId: null, wdHistorySource: 'roleplay' });
    expect(row('quiet')).toEqual({ lastTargetId: null, wdHistorySource: null });
    expect(row('plain')).toEqual({ lastTargetId: 'narrator', wdHistorySource: null });
    expect(db.prepare("SELECT last_target_id FROM workspace_threads WHERE workspace_id = 'reads'").get().last_target_id).toBe('narrator');
  });

  test('a standard workspace and a roleplay workspace with no marks keep everything in the Chat', () => {
    workspace('plain', 'standard');
    workspace('unplayed', 'roleplay');
    message('p1', 'plain', 'ai', 1);
    message('r1', 'unplayed', 'ai', 1);
    mark('roleplay_message_frames', 'plain', 'p1');
    migrate();
    expect([threadOf('p1'), threadOf('r1')]).toEqual(['chat', 'chat']);
    expect(db.prepare('SELECT COUNT(*) AS count FROM workspace_threads').get().count).toBe(0);
  });

  test('running it again changes nothing, and no message is lost or renamed', () => {
    workspace('axiom', 'roleplay');
    message('u1', 'axiom', 'user', 1);
    message('a1', 'axiom', 'ai', 2);
    mark('roleplay_message_frames', 'axiom', 'a1');
    migrate();
    const before = db.prepare('SELECT id, thread, content FROM messages ORDER BY id').all();
    splitConversationThreads(db, { log: () => {} });
    expect(db.prepare('SELECT id, thread, content FROM messages ORDER BY id').all()).toEqual(before);
    expect(before.map((row: any) => row.id)).toEqual(['a1', 'u1']);
  });
});
