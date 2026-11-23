import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openFullSchemaDatabase, type FullSchemaDatabase } from './full-schema-harness';

const require = createRequire(import.meta.url);
const { PACKAGED, STAYS, PACKAGE_HEADER, IDENTIFIED, KEYED } = require('../../src/main/features/worldbuild/package-coverage.js');

let harness: FullSchemaDatabase;
beforeEach(() => { harness = openFullSchemaDatabase(); });
afterEach(() => harness.close());

// FTS5 keeps its index in shadow tables named after the virtual table.
const schemaTables = () => (harness.db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>)
  .map(table => table.name)
  .filter(name => !name.startsWith('knowledge_chunks_fts_'));

describe('what a Worldbuild package does with each table', () => {
  test('is declared for every table in the schema, exactly once', () => {
    const declared = [...PACKAGED, ...STAYS].map((entry: any) => entry.table);
    expect(declared.filter((table, index) => declared.indexOf(table) !== index)).toEqual([]);
    expect(schemaTables().filter(table => !declared.includes(table))).toEqual([]);
  });

  test('names only tables the schema really has', () => {
    const tables = schemaTables();
    expect([...PACKAGED, ...STAYS].map((entry: any) => entry.table).filter(table => !tables.includes(table))).toEqual([]);
  });
});

describe('how a later version of a package finds each part', () => {
  // The parts a package carries: what the entity store writes, and what the export handler adds to it.
  const packagedKeys = () => {
    const entities = readFileSync(require.resolve('../../src/main/entities.js'), 'utf8');
    const handlers = readFileSync(require.resolve('../../src/main/ipc-handlers.js'), 'utf8');
    const builder = handlers.slice(handlers.indexOf('function buildWorldbuildPackage('), handlers.indexOf("ipcMain.handle('export-worldbuild'"));
    const stored = entities.match(/return \{ (kallamoWorldbuild: 1[^}]*)\};/)?.[1] || '';
    return new Set([
      ...stored.split(',').map(entry => entry.split(':')[0].trim()).filter(Boolean),
      ...[...builder.matchAll(/data\.(\w+) =/g)].map(match => match[1]),
    ]);
  };

  test('is declared for every part a package carries', () => {
    const declared = new Set([...PACKAGE_HEADER, ...[...IDENTIFIED, ...KEYED].map((entry: any) => entry.part)]);
    const keys = packagedKeys();
    expect(keys.has('entities') && keys.has('knowledge')).toBe(true);
    expect([...keys].filter(key => !declared.has(key))).toEqual([]);
  });
});
