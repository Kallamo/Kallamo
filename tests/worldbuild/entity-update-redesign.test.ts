import { openTestDatabase } from '../sqlite-test-database';
import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { canonicalEvidenceSignature, createStoryCoverage } = require('../../src/main/features/worldbuild/entity-update-coverage');
const { createMemoryIndex } = require('../../src/main/features/worldbuild/entity-update-memories');
const { resolveRelationshipChange } = require('../../src/main/features/worldbuild/entity-review');
const { keepsEveryLoreSentence, validateEntityLore } = require('../../src/main/features/worldbuild/entity-lore');
const { comparableText } = require('../../src/main/features/worldbuild/entity-update-contract');

function chatDb(blocks: any[], replies: Array<{ id: string; notice?: any }>, jobs: Array<{ id: string; status: string; error?: string | null }> = []) {
  const db = openTestDatabase(':memory:');
  db.exec(`
    CREATE TABLE chats (id TEXT PRIMARY KEY, memoryBlocks TEXT);
    CREATE TABLE messages (id TEXT PRIMARY KEY, chatId TEXT, role TEXT, debugNotice TEXT, thread TEXT NOT NULL DEFAULT 'roleplay');
    CREATE TABLE narrative_story_jobs (workspace_id TEXT, origin_id TEXT, status TEXT, error_message TEXT);
  `);
  db.prepare('INSERT INTO chats VALUES (?, ?)').run('chat', JSON.stringify(blocks));
  for (const reply of replies) db.prepare("INSERT INTO messages (id, chatId, role, debugNotice) VALUES (?, 'chat', 'ai', ?)").run(reply.id, reply.notice ? JSON.stringify(reply.notice) : null);
  for (const job of jobs) db.prepare("INSERT INTO narrative_story_jobs VALUES ('chat', ?, ?, ?)").run(job.id, job.status, job.error ?? null);
  return db;
}

const block = {
  id: 'block_a',
  type: 'summarized',
  messages: [
    { id: 'u1', role: 'user', content: 'Mara opens the gate of the old lighthouse and calls for the keeper.' },
    { id: 'a1', role: 'ai', content: 'The keeper answers from the stairs, lamp in hand, and lets Mara in out of the storm.' },
    { id: 'u2', role: 'user', content: 'Mara asks the keeper about the ship that sank under the cliffs last winter.' },
    { id: 'a2', role: 'ai', content: 'The keeper goes quiet, then admits he saw the lights of that ship and did nothing at all.' },
  ],
};
const archiveChunk = (text: string) => ({ id: text.slice(0, 8), ownerType: 'chat_memory', source: 'Chat Archive', memoryBlockId: 'block_a', text: `Document: Chat Archive\nContent: ${text}` });

describe('story coverage of update evidence', () => {
  test('a passage of a reply the story pass read is covered; one it did not read stays open', () => {
    const db = chatDb([block], [{ id: 'a1', notice: { narrativeState: { status: 'completed' } } }, { id: 'a2' }]);
    const coverage = createStoryCoverage(db, 'chat');
    expect(coverage.classify(archiveChunk('AI: The keeper answers from the stairs, lamp in hand, and lets Mara in'))).toBe('covered');
    expect(coverage.classify(archiveChunk('AI: The keeper goes quiet, then admits he saw the lights of that ship'))).toBe('open');
  });

  test('a passage holding only the person\'s message follows the reply that answered it', () => {
    const db = chatDb([block], [{ id: 'a1' }, { id: 'a2' }], [{ id: 'a2', status: 'completed' }]);
    const coverage = createStoryCoverage(db, 'chat');
    expect(coverage.classify(archiveChunk('USER: Mara asks the keeper about the ship that sank under the cliffs'))).toBe('covered');
  });

  test('a skip without a triage never ran, and recaps feed the sheet only', () => {
    const db = chatDb([block, { id: 'recap', type: 'manual', summary: 'Day one' }], [{ id: 'a1', notice: { narrativeState: { status: 'skipped', reason: 'No model' } } }]);
    const coverage = createStoryCoverage(db, 'chat');
    expect(coverage.classify(archiveChunk('AI: The keeper answers from the stairs, lamp in hand, and lets Mara in'))).toBe('open');
    expect(coverage.classify({ id: 'r', ownerType: 'chat_memory', memoryBlockId: 'recap', text: 'Day one' })).toBe('recap');
    expect(coverage.classify({ id: 'v', isRecap: true, text: 'Constant memory' })).toBe('recap');
    expect(coverage.classify({ id: 'd', ownerType: 'document', text: 'A chapter' })).toBe('open');
  });

  test('an older signature with the field part reads as the same passage', () => {
    expect(canonicalEvidenceSignature('semantic-v8-field-coverage:b5a0743edc5a2fe3:tagged:abc')).toBe('semantic-v8-field-coverage:tagged:abc');
    expect(canonicalEvidenceSignature('semantic-v8-field-coverage:tagged:abc')).toBe('semantic-v8-field-coverage:tagged:abc');
  });
});

describe('memories compared by meaning', () => {
  const vectors: Record<string, number[]> = {
    'Held the lamp while the keeper confessed.': [1, 0, 0],
    'While the keeper confessed, I kept the lamp up.': [0.96, 0.28, 0],
    'Climbed the cliff path at dawn.': [0, 0, 1],
  };
  const index = () => createMemoryIndex({
    load: () => ['Held the lamp while the keeper confessed.'],
    embed: async (texts: string[]) => texts.map(text => vectors[text] || [0, 1, 0]),
    comparable: comparableText,
  });

  test('a retelling of a held scene is a duplicate, another scene is not', async () => {
    const memories = index();
    expect((await memories.isDuplicate('mara', 'While the keeper confessed, I kept the lamp up.')).duplicate).toBe(true);
    expect((await memories.isDuplicate('mara', 'Climbed the cliff path at dawn.')).duplicate).toBe(false);
  });

  test('a memory accepted in this run counts for the next one', async () => {
    const memories = index();
    memories.remember('mara', 'Climbed the cliff path at dawn.');
    expect((await memories.isDuplicate('mara', 'Climbed the cliff path at dawn.')).duplicate).toBe(true);
  });

  test('without meaning only the words are compared', async () => {
    const memories = createMemoryIndex({ load: () => ['Held the lamp while the keeper confessed.'], embed: null, comparable: comparableText });
    expect((await memories.isDuplicate('mara', 'held the lamp while the keeper confessed')).duplicate).toBe(true);
    expect((await memories.isDuplicate('mara', 'While the keeper confessed, I kept the lamp up.')).duplicate).toBe(false);
  });
});

describe('relationships moved by cause', () => {
  const current = { title: 'Captor', value: 15, description: 'Grummel cooperates on conditions.' };

  test('a bond without a lasting cause does not move', () => {
    expect(resolveRelationshipChange(current, { direction: 'further', cause: 'routine-cooperation', impact: 'meaningful', description: 'x' })).toBeNull();
    expect(resolveRelationshipChange(current, { direction: '', cause: 'rescue', impact: 'meaningful' })).toBeNull();
  });

  test('a wound short of drastic stops at neutral instead of turning a bond hostile', () => {
    const update = resolveRelationshipChange(current, { direction: 'further', cause: 'betrayal', impact: 'significant', description: 'Grummel no longer trusts him.' });
    expect(update.value).toBeGreaterThanOrEqual(0);
    expect(update.value).toBeLessThan(15);
    expect(update.title).toBe('Captor');
  });

  test('closer moves up by the story pass arithmetic and keeps the title', () => {
    const update = resolveRelationshipChange(current, { direction: 'closer', cause: 'sustained-trust', impact: 'meaningful', description: 'Grummel starts to rely on his word.' });
    expect(update.value).toBeGreaterThan(15);
    expect(update.value).toBeLessThanOrEqual(25);
    expect(update.title).toBe('Captor');
  });

  test('a new bond starts from the reading, inside the first-reading limit', () => {
    const update = resolveRelationshipChange(null, { title: 'Rescuer', score: 80, cause: 'rescue', impact: 'meaningful', description: 'Halden owes him his life.' });
    expect(update.value).toBe(25);
    expect(resolveRelationshipChange(null, { title: 'Rescuer', score: 80, cause: 'presence', impact: 'drastic', description: 'x' })).toBeNull();
  });
});

describe('lore kept as background', () => {
  const current = 'Cassian rose from a minor noble house to Field Lieutenant. He served on the southern border for six years.';

  test('a lore that drops or rewords a sentence is refused', () => {
    expect(keepsEveryLoreSentence(current, `${current} His mother ran the house archive.`)).toBe(true);
    expect(keepsEveryLoreSentence(current, 'Cassian climbed from a small noble house to Field Lieutenant. He served on the southern border for six years.')).toBe(false);
    const evidence = new Set(['E_1']);
    const rewrite = { lore: { value: `Cassian climbed from a small noble house to Field Lieutenant and was respected for it. He served on the southern border for six years, and his mother ran the house archive for decades before he was born.`, support: 'x', evidence: ['E_1'] } };
    expect(validateEntityLore(rewrite, current, evidence)).toBeNull();
  });
});
