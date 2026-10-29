import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openFullSchemaDatabase, type FullSchemaDatabase } from './full-schema-harness';

const require = createRequire(import.meta.url);
const { PACKAGED, STAYS } = require('../../src/main/features/worldbuild/package-coverage.js');

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
