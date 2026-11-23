import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import { createWorldbuildDataService } from '../../src/main/features/worldbuild/worldbuild-data.js';
import { defaultRaceFor, normalizeDefaultValue, withFieldDefaults } from '../../src/main/features/worldbuild/field-defaults.js';
import { openTestDatabase } from '../sqlite-test-database';
import type { EntityFieldDefinition } from '../../src/narrative/contracts';

describe('template field defaults', () => {
  let directory: string;
  let db: Database.Database;
  let service: ReturnType<typeof createWorldbuildDataService>;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'field-defaults-'));
    db = openTestDatabase(join(directory, 'worldbuild.db'));
    runDatabaseMigrations(db);
    db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY, workspaceId TEXT, type TEXT NOT NULL, canonicalName TEXT NOT NULL DEFAULT '',
        data TEXT, status TEXT NOT NULL DEFAULT 'confirmed', last_modified INTEGER DEFAULT 0
      );
    `);
    service = createWorldbuildDataService(db);
  });

  // The JS service infers a narrower shape than the contract it returns.
  const save = (input: Record<string, unknown>) => service.saveFieldDefinition(input) as unknown as EntityFieldDefinition;

  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const choiceField = (extra: Record<string, unknown> = {}) => save({
    projectId: 'ws', typeId: 'Characters', label: 'Noble title', valueType: 'single-choice',
    options: [{ label: 'None' }, { label: 'Baron' }], position: 0, aiAccess: 'read-write', ...extra,
  });

  test('a choice default given by label is stored as its option id', () => {
    const field = choiceField({ defaultValue: 'None' });
    const none = field.options!.find(option => option.label === 'None')!;
    expect(field.defaultValue).toBe(none.id);
  });

  test('saving a field again keeps its default, and an empty one removes it', () => {
    const field = choiceField({ defaultValue: 'None' });
    expect(save({ ...field, label: 'Title', defaultValue: field.defaultValue }).defaultValue).toBe(field.defaultValue);
    expect(save({ ...field, defaultValue: null })).not.toHaveProperty('defaultValue');
  });

  test('a default that does not fit the field is dropped', () => {
    expect(normalizeDefaultValue({ valueType: 'number', constraints: { max: 10 } }, 40)).toBeUndefined();
    expect(normalizeDefaultValue({ valueType: 'single-choice', options: [{ id: 'a', label: 'A' }] }, 'B')).toBeUndefined();
    expect(normalizeDefaultValue({ valueType: 'entity-reference' }, 'gone', () => false)).toBeUndefined();
    expect(normalizeDefaultValue({ valueType: 'short-text' }, '  Human ')).toBe('Human');
  });

  test('a new entity takes only the defaults its creation did not bring', () => {
    const field = choiceField({ defaultValue: 'None' });
    save({ projectId: 'ws', typeId: 'Characters', label: 'Race', valueType: 'short-text', position: 1, aiAccess: 'read-write', defaultValue: 'Human' });

    expect(withFieldDefaults(db, 'ws', 'Characters', {})).toEqual({ customFields: { 'noble-title': field.defaultValue, race: 'Human' } });
    // A key the creator left empty on purpose stays empty.
    expect(withFieldDefaults(db, 'ws', 'Characters', { customFields: { race: '', 'noble-title': 'opt-x' } }))
      .toEqual({ customFields: { race: '', 'noble-title': 'opt-x' } });
    expect(withFieldDefaults(db, 'ws', 'Items', { kept: true })).toEqual({ kept: true });
  });

  test('filling empty entries writes the default only where the field is empty', () => {
    const field = save({ projectId: 'ws', typeId: 'Characters', label: 'Race', valueType: 'short-text', position: 0, aiAccess: 'read-write', defaultValue: 'Human' });
    const insert = db.prepare('INSERT INTO entities (id, workspaceId, type, data) VALUES (?, ?, ?, ?)');
    insert.run('a', 'ws', 'Characters', JSON.stringify({}));
    insert.run('b', 'ws', 'Characters', JSON.stringify({ customFields: { race: 'Elf' } }));

    expect(service.applyFieldDefaultToEmpty('ws', field.id)).toBe(1);
    const dataOf = (id: string) => JSON.parse((db.prepare('SELECT data FROM entities WHERE id = ?').get(id) as { data: string }).data);
    expect(dataOf('a')).toEqual({ customFields: { race: 'Human' } });
    expect(dataOf('b')).toEqual({ customFields: { race: 'Elf' } });
  });

  test('the default race must still be a confirmed race of the world', () => {
    const insert = db.prepare('INSERT INTO entities (id, workspaceId, type, status) VALUES (?, ?, ?, ?)');
    insert.run('human', 'ws', 'Races', 'confirmed');
    insert.run('elf', 'ws', 'Races', 'proposed');
    const setRace = (race: string) => service.saveEntityTemplate({ workspaceId: 'ws', typeId: 'Characters', layout: { sections: [], nativeDefaults: { race } } });

    setRace('human');
    expect(defaultRaceFor(db, 'ws', 'Characters')).toBe('human');
    expect(defaultRaceFor(db, 'ws', 'Creatures')).toBeNull();
    setRace('elf');
    expect(defaultRaceFor(db, 'ws', 'Characters')).toBeNull();
    setRace('deleted');
    expect(defaultRaceFor(db, 'ws', 'Characters')).toBeNull();
  });

  test('a type change carries the default through the same conversion as the stored values', () => {
    const field = save({ projectId: 'ws', typeId: 'Items', label: 'Forged from', valueType: 'short-text', position: 0, aiAccess: 'read-write', defaultValue: 'Iron' });
    const asChoice = { ...field, valueType: 'single-choice', options: [{ label: 'Iron' }, { label: 'Steel' }, { label: 'Bronze' }], defaultValue: null, carryDefault: true };

    expect(service.previewFieldTypeChange(asChoice)).toEqual(expect.objectContaining({ defaultLost: false }));
    const changed = save({ ...asChoice, confirmTypeChange: true });
    expect(changed.defaultValue).toBe(changed.options!.find(option => option.label === 'Iron')!.id);

    const asNumber = { ...changed, valueType: 'number', options: undefined, defaultValue: null, carryDefault: true };
    expect(service.previewFieldTypeChange(asNumber)).toEqual(expect.objectContaining({ defaultLost: true }));
    expect(save({ ...asNumber, confirmTypeChange: true })).not.toHaveProperty('defaultValue');
  });
});
