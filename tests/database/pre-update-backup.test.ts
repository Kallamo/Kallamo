import { mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { openTestDatabase } from '../sqlite-test-database';

const require = createRequire(import.meta.url);
const { backupBeforeUpdate, takePreparedBackup, runBackupJob, runInWorker } = require('../../src/main/database/pre-update-backup.js');
const { writeSchemaAppVersion } = require('../../src/main/database/migration-backup.js');
const { resolveNativeBinding } = require('../../tools/sqlite-binding.cjs');

const IDS = ['first_v1', 'second_v1'];
const nativeBinding = process.env.KALLAMO_TEST_NATIVE_BINDING || resolveNativeBinding();
const directories: string[] = [];
afterEach(() => {
  takePreparedBackup(null);
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function dataDir({ version = '1.0.0', ids = IDS } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'kallamo-pre-update-'));
  directories.push(directory);
  const db = openTestDatabase(join(directory, 'kallamo.db'));
  db.pragma('journal_mode = WAL');
  db.exec('CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  for (const id of ids) db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(id, 'now');
  writeSchemaAppVersion(db, version);
  db.close();
  return directory;
}

const inline = (job: any, onCopying: () => void) => new Promise(resolve => {
  let outcome: any = null;
  runBackupJob(job, (message: any) => { if (message.copying) onCopying(); else outcome = message; });
  resolve(outcome);
});

describe('backupBeforeUpdate', () => {
  test('hands database.js the copy it saved for a new version', async () => {
    const directory = dataDir();
    let copying = 0;
    const outcome = await backupBeforeUpdate({ appVersion: '2.0.0', migrationIds: IDS, dataDir: directory, nativeBinding, run: inline, onCopying: () => { copying += 1; } });
    expect(copying).toBe(1);
    expect(outcome.backup.path).toContain('pre-update-1.0.0-to-2.0.0-');
    expect(readdirSync(join(directory, 'backups')).filter(file => file.endsWith('.db'))).toHaveLength(1);
    expect(takePreparedBackup(join(directory, 'other.db'))).toBeNull();
    expect(takePreparedBackup(join(directory, 'kallamo.db'))).toBeNull();
  });

  test('a prepared copy is handed over once, to its own database', async () => {
    const directory = dataDir();
    await backupBeforeUpdate({ appVersion: '2.0.0', migrationIds: IDS, dataDir: directory, nativeBinding, run: inline });
    const prepared = takePreparedBackup(join(directory, 'kallamo.db'));
    expect(prepared.backup.path).toContain('pre-update-1.0.0-to-2.0.0-');
    expect(takePreparedBackup(join(directory, 'kallamo.db'))).toBeNull();
  });

  test('the same version with every migration applied saves nothing', async () => {
    const directory = dataDir({ version: '2.0.0' });
    const outcome = await backupBeforeUpdate({ appVersion: '2.0.0', migrationIds: IDS, dataDir: directory, nativeBinding, run: inline });
    expect(outcome).toEqual({ needed: false });
    expect(takePreparedBackup(join(directory, 'kallamo.db'))).toBeNull();
  });

  test('a pending restore leaves the copy to database.js', async () => {
    const directory = dataDir();
    writeFileSync(join(directory, 'RESTORE_PENDING.json'), '{}');
    expect(await backupBeforeUpdate({ appVersion: '2.0.0', migrationIds: IDS, dataDir: directory, nativeBinding, run: inline })).toBeNull();
  });

  test('a failed copy reaches database.js as the error that stops the boot', async () => {
    const directory = dataDir();
    const run = async () => ({ error: { code: 'insufficient-space', message: 'full', details: { needed: 10, available: 1 } } });
    await backupBeforeUpdate({ appVersion: '2.0.0', migrationIds: IDS, dataDir: directory, nativeBinding, run });
    const prepared = takePreparedBackup(join(directory, 'kallamo.db'));
    expect(prepared.error.name).toBe('BackupError');
    expect(prepared.error.code).toBe('insufficient-space');
    expect(prepared.error.details).toEqual({ needed: 10, available: 1 });
  });

  test('runs the copy in a worker thread', async () => {
    const directory = dataDir();
    let copying = 0;
    const outcome = await backupBeforeUpdate({ appVersion: '2.0.0', migrationIds: IDS, dataDir: directory, nativeBinding, run: runInWorker, onCopying: () => { copying += 1; } });
    expect(copying).toBe(1);
    expect(outcome.backup.method).toBeTruthy();
    expect(takePreparedBackup(join(directory, 'kallamo.db')).backup.path).toBe(outcome.backup.path);
  });
});
