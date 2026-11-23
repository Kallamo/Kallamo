import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, test } from 'vitest';

// Every statement on `messages` says which conversation it reads or writes, or targets messages by
// id. The exceptions below are workspace-wide on purpose; a new one needs a reason here.
const ALLOWED: Array<{ file: string; fragment: string; reason: string }> = [
  { file: 'src/main/database/base-schema.js', fragment: 'UPDATE messages SET last_modified', reason: 'sync trigger, per row' },
  { file: 'src/main/database.js', fragment: 'length(debugNotice) > 50000', reason: 'compacts oversized diagnostics in every conversation' },
  { file: 'src/main/ipc-handlers.js', fragment: 'COUNT(*) FROM messages m WHERE m.chatId = c.id', reason: 'home screen total of both conversations' },
  { file: 'src/main/ipc-handlers.js', fragment: "UPDATE messages SET last_modified = ? WHERE chatId = ?", reason: 'cloud sync touches the whole workspace' },
  { file: 'src/main/features/narrative/scene-growth.ts', fragment: 'JOIN messages ON messages.id = growth.origin_id', reason: 'joins settled turns by their reply id' },
  { file: 'src/main/database.js', fragment: "messages WHERE chatId = ? ORDER BY createdAt ASC, id ASC'", reason: 'boot repair before the split column exists; filters by thread once it does' },
  { file: 'src/main/database/thread-migration.js', fragment: 'SELECT id, role, excluded FROM messages WHERE chatId = ?', reason: 'the split itself reads the whole workspace once' }
];

const ROOTS = ['src/main', 'src/shared'];
const STATEMENT = /\b(FROM|INTO|UPDATE|JOIN)\s+messages\b/g;

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.(js|ts)$/.test(name) && !name.endsWith('.d.ts') ? [path] : [];
  });
}

// The SQL literal around a match: from its opening quote to the matching close.
function literalAround(text: string, index: number) {
  let open = index;
  while (open > 0 && !['`', "'", '"'].includes(text[open])) open -= 1;
  const quote = text[open];
  const close = text.indexOf(quote, index);
  return text.slice(open, close + 1);
}

function statements() {
  const found: Array<{ file: string; sql: string }> = [];
  for (const root of ROOTS) {
    for (const path of sourceFiles(root)) {
      const text = readFileSync(path, 'utf8');
      for (const match of text.matchAll(STATEMENT)) {
        found.push({ file: relative('.', path).replace(/\\/g, '/'), sql: literalAround(text, match.index!) });
      }
    }
  }
  return found;
}

const declaresThread = (sql: string) => /\bthread\b/.test(sql);
const targetsById = (sql: string) => /(^|[\s(.])id\s*(=\s*\?|IN\s*\()/i.test(sql.replace(/chatId/g, ''));
const allowed = (file: string, sql: string) => ALLOWED.some(entry => entry.file === file && sql.includes(entry.fragment));

describe('every query on messages names its conversation', () => {
  test('reads and writes declare the thread or target messages by id', () => {
    const all = statements();
    expect(all.length).toBeGreaterThan(50);
    const undeclared = all
      .filter(({ file, sql }) => !declaresThread(sql) && !targetsById(sql) && !allowed(file, sql))
      .map(({ file, sql }) => `${file}: ${sql.replace(/\s+/g, ' ').slice(0, 140)}`);
    expect(undeclared).toEqual([]);
  });

  test('every insert writes the thread', () => {
    const inserts = statements().filter(({ sql }) => /INSERT (OR REPLACE )?INTO messages/.test(sql));
    expect(inserts.length).toBeGreaterThan(0);
    expect(inserts.filter(({ sql }) => !declaresThread(sql)).map(({ file }) => file)).toEqual([]);
  });

  test('each exception still matches a statement', () => {
    const all = statements();
    const stale = ALLOWED.filter(entry => !all.some(({ file, sql }) => file === entry.file && sql.includes(entry.fragment)));
    expect(stale).toEqual([]);
  });
});
