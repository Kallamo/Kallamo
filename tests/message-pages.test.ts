import { afterEach, describe, expect, test } from 'vitest';
import { createRequire } from 'node:module';
import { openTestDatabase } from './sqlite-test-database';

const require = createRequire(import.meta.url);
const { getMessagePage, getMessageDebugNotice, debugNoticeToSave } = require('../src/main/features/chat/message-pages');

let db: ReturnType<typeof openTestDatabase>;

function setup() {
  db = openTestDatabase(':memory:');
  db.exec(`CREATE TABLE messages (
    id TEXT PRIMARY KEY, chatId TEXT, role TEXT, content TEXT, aiName TEXT, aiColor TEXT, debugNotice TEXT,
    attachedFiles TEXT, createdAt INTEGER, last_modified INTEGER, alternatives TEXT, excluded INTEGER DEFAULT 0
  )`);
  const insert = db.prepare('INSERT INTO messages (id, chatId, role, content, debugNotice, attachedFiles, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)');
  return (id: string, debugNotice: unknown, createdAt: number) => insert.run(id, 'chat', 'ai', `reply ${id}`, typeof debugNotice === 'string' ? debugNotice : JSON.stringify(debugNotice), '[]', createdAt);
}

afterEach(() => db?.close());

const heavyNotice = {
  usage: { total: { input: 10, output: 5, total: 15 } },
  narrativeState: { status: 'deferred' },
  retrieval: { mode: 'need', bundle: { scopes: [], excluded: 'x'.repeat(40000) } },
  generation: { profileName: 'Narrator', requests: [{ body: 'y'.repeat(20000) }], scenePlan: 'plan' },
  narrativeCalls: [{ prompt: 'z' }],
  agentic: { steps: 2 },
};

describe('message pages', () => {
  test('a large diagnostics record arrives light but keeps what the list shows', () => {
    const add = setup();
    add('m1', heavyNotice, 1);
    const [message] = getMessagePage(db, { chatId: 'chat' }).messages;
    const light = JSON.parse(message.debugNotice);
    expect(message.debugNotice.length).toBeLessThan(1000);
    expect(light.omitted).toBe(true);
    expect(light.usage).toEqual(heavyNotice.usage);
    expect(light.narrativeState.status).toBe('deferred');
    expect(light.retrieval).toBeTruthy();
    expect(light.generation.requests.length).toBeGreaterThan(0);
    expect(light.generation.scenePlan).toBeTruthy();
    expect(light.narrativeCalls.length).toBeGreaterThan(0);
    expect(light.agentic).toBeTruthy();
    expect(light).not.toHaveProperty('agenticRagResponse');
    expect(JSON.parse(getMessageDebugNotice(db, 'm1'))).toEqual(heavyNotice);
  });

  test('small and unreadable records pass through unchanged', () => {
    const add = setup();
    add('small', { usage: { total: { input: 1, output: 1, total: 2 } } }, 1);
    add('broken', `{"oops": ${'1'.repeat(20000)}`, 2);
    const { messages } = getMessagePage(db, { chatId: 'chat' });
    expect(JSON.parse(messages[0].debugNotice).omitted).toBeUndefined();
    expect(messages[1].debugNotice.startsWith('{"oops"')).toBe(true);
  });

  test('saving a message shown with light diagnostics keeps the stored record', () => {
    const add = setup();
    add('m1', heavyNotice, 1);
    const [message] = getMessagePage(db, { chatId: 'chat' }).messages;
    expect(JSON.parse(debugNoticeToSave(db, message))).toEqual(heavyNotice);
    expect(JSON.parse(debugNoticeToSave(db, { ...message, id: 'copy', debugNoticeFrom: 'm1' }))).toEqual(heavyNotice);
    expect(debugNoticeToSave(db, { id: 'new', debugNotice: '{"usage":1}' })).toBe('{"usage":1}');
  });
});
