import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import { createEntityUpdateState } from '../../src/main/features/worldbuild/entity-update-state.js';
import { openTestDatabase } from '../sqlite-test-database';

describe('entity update evidence lifecycle', () => {
  let directory: string;
  let db: Database.Database;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'entity-update-state-'));
    db = openTestDatabase(join(directory, 'state.db'));
    db.pragma('foreign_keys = ON');
    runDatabaseMigrations(db);
  });

  afterEach(() => {
    db?.close();
    rmSync(directory, { recursive: true, force: true });
  });

  test('keeps deferred evidence eligible and reopens changed evidence', () => {
    const state = createEntityUpdateState(db);
    const first = { chunk: { id: 'chunk-one', isTagged: false }, signature: 'v1:text:a' };
    state.discover('workspace', 'entity', [first]);
    state.transition('workspace', 'entity', [first], 'deferred', 'run-one', 'token-budget');
    expect(state.discover('workspace', 'entity', [first]).get('chunk-one')?.state).toBe('deferred');

    const changed = { ...first, signature: 'v1:text:b' };
    expect(state.discover('workspace', 'entity', [changed]).get('chunk-one')?.state).toBe('discovered');
  });
});
