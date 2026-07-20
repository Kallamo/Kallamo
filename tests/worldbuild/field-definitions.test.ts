import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { EntityFieldDefinition } from '../../src/kanora/contracts';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import {
  WorldbuildFieldDefinitionRepository,
  WorldbuildFieldDefinitionValidationError
} from '../../src/main/features/worldbuild/field-definitions';

const materialField: EntityFieldDefinition = {
  id: 'field-material',
  projectId: 'workspace-one',
  typeId: 'Items',
  key: 'material',
  label: 'Material',
  valueType: 'single-choice',
  options: [
    { id: 'iron', label: 'Iron' },
    { id: 'silver', label: 'Silver' }
  ],
  required: false,
  position: 2,
  aiAccess: 'read-write'
};

describe('Worldbuild field definition repository', () => {
  let directory: string;
  let db: Database.Database;
  let repository: WorldbuildFieldDefinitionRepository;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'worldbuild-fields-'));
    db = new Database(join(directory, 'worldbuild.db'));
    runDatabaseMigrations(db);
    repository = new WorldbuildFieldDefinitionRepository(db);
  });

  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test('persists and reconstructs predefined choices', () => {
    expect(repository.save(materialField)).toEqual(materialField);
    expect(repository.get(materialField.projectId, materialField.id)).toEqual(materialField);
  });

  test('isolates definitions by workspace and entity type', () => {
    repository.save(materialField);
    repository.save({ ...materialField, id: 'field-other', projectId: 'workspace-two' });
    repository.save({ ...materialField, id: 'field-origin', key: 'origin', label: 'Origin', typeId: 'Characters', position: 0 });

    expect(repository.list('workspace-one', 'Items')).toEqual([materialField]);
    expect(repository.list('workspace-two')).toHaveLength(1);
  });

  test('updates a definition while preserving its identity', () => {
    repository.save(materialField);
    const updated = { ...materialField, label: 'Primary material', position: 1 };

    expect(repository.save(updated)).toEqual(updated);
    expect(repository.list(materialField.projectId)).toEqual([updated]);
  });

  test('orders definitions by their configured position', () => {
    repository.save(materialField);
    const earlier = { ...materialField, id: 'field-rarity', key: 'rarity', label: 'Rarity', position: 0 };
    repository.save(earlier);

    expect(repository.list(materialField.projectId, 'Items').map(field => field.id)).toEqual([
      earlier.id,
      materialField.id
    ]);
  });

  test('rejects invalid definitions before writing', () => {
    const invalid = { ...materialField, options: [] };

    expect(() => repository.save(invalid)).toThrow(WorldbuildFieldDefinitionValidationError);
    expect(repository.list(materialField.projectId)).toEqual([]);
  });

  test('deletes only the requested workspace definition', () => {
    repository.save(materialField);
    repository.save({ ...materialField, projectId: 'workspace-two' });

    expect(repository.delete(materialField.projectId, materialField.id)).toBe(true);
    expect(repository.get(materialField.projectId, materialField.id)).toBeUndefined();
    expect(repository.get('workspace-two', materialField.id)).toBeDefined();
  });
});
