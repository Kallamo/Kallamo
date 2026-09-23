import { closeSync, existsSync, mkdtempSync, openSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, writeSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { openTestDatabase } from '../sqlite-test-database';

const require = createRequire(import.meta.url);
const {
  needsPreMigrationBackup,
  createPreMigrationBackup,
  pruneMigrationBackups,
  listMigrationBackups,
  restoreDatabaseFromBackup,
  readSchemaAppVersion,
  writeSchemaAppVersion,
  unknownMigrationIds,
  backupFileName,
  bootFailureMessage
} = require('../../src/main/database/migration-backup.js');
const { runDatabaseMigrations } = require('../../src/main/database/migrations.js');

const directories: string[] = [];
const open: any[] = [];
afterEach(() => {
  for (const db of open.splice(0)) { try { db.close(); } catch {} }
  for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
});

function workspace() {
  const directory = mkdtempSync(join(tmpdir(), 'kallamo-migration-backup-'));
  directories.push(directory);
  return directory;
}

function database(directory = workspace()) {
  const db = openTestDatabase(join(directory, 'kallamo.db'));
  open.push(db);
  db.pragma('journal_mode = WAL');
  return db;
}

const IDS = ['first_v1', 'second_v1'];

function appliedDatabase(ids = IDS) {
  const db = database();
  db.exec('CREATE TABLE schema_migrations (id TEXT PRIMARY KEY, applied_at TEXT NOT NULL)');
  for (const id of ids) db.prepare('INSERT INTO schema_migrations VALUES (?, ?)').run(id, 'now');
  return db;
}

const plentyOfSpace = () => ({ bavail: 1e12, bsize: 1 });
const DAY = 24 * 60 * 60 * 1000;

describe('needsPreMigrationBackup', () => {
  test('a fresh install has nothing to protect', () => {
    const db = appliedDatabase([]);
    expect(needsPreMigrationBackup(db, { migrationIds: IDS, appVersion: '1.2.0', isFreshInstall: true })).toBe(false);
  });

  test('an existing but empty file has nothing to protect', () => {
    const db = database();
    expect(needsPreMigrationBackup(db, { migrationIds: IDS, appVersion: '1.2.0', isFreshInstall: false })).toBe(false);
  });

  test('every migration applied at the same version needs no copy', () => {
    const db = appliedDatabase();
    writeSchemaAppVersion(db, '1.2.0');
    expect(needsPreMigrationBackup(db, { migrationIds: IDS, appVersion: '1.2.0', isFreshInstall: false })).toBe(false);
  });

  test('a pending migration needs a copy', () => {
    const db = appliedDatabase(['first_v1']);
    writeSchemaAppVersion(db, '1.2.0');
    expect(needsPreMigrationBackup(db, { migrationIds: IDS, appVersion: '1.2.0', isFreshInstall: false })).toBe(true);
  });

  test('a different app version needs a copy', () => {
    const db = appliedDatabase();
    writeSchemaAppVersion(db, '1.1.7');
    expect(needsPreMigrationBackup(db, { migrationIds: IDS, appVersion: '1.2.0', isFreshInstall: false })).toBe(true);
  });

  test('a 1.1.x database without schema_migrations or app_meta needs a copy', () => {
    const db = database();
    db.exec('CREATE TABLE chats (id TEXT PRIMARY KEY)');
    expect(readSchemaAppVersion(db)).toBeNull();
    expect(needsPreMigrationBackup(db, { migrationIds: IDS, appVersion: '1.2.0', isFreshInstall: false })).toBe(true);
    expect(needsPreMigrationBackup(db, { migrationIds: [], appVersion: '1.2.0', isFreshInstall: false })).toBe(true);
  });

  test('migrations this build does not know are reported, not blocking', () => {
    const db = appliedDatabase(['first_v1', 'second_v1', 'future_v1']);
    expect(unknownMigrationIds(db, IDS)).toEqual(['future_v1']);
  });
});

describe('createPreMigrationBackup', () => {
  test('writes a verified copy that holds rows still in the WAL', () => {
    const directory = workspace();
    const db = database(directory);
    db.pragma('wal_autocheckpoint = 0');
    db.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)');
    const insert = db.prepare('INSERT INTO notes (body) VALUES (?)');
    for (let i = 0; i < 500; i++) insert.run(`note ${i}`);
    expect(statSync(join(directory, 'kallamo.db-wal')).size).toBeGreaterThan(0);

    const backupDir = join(directory, 'backups');
    const backup = createPreMigrationBackup(db, { backupDir, fromVersion: '1.1.7', toVersion: '1.2.0', statfs: plentyOfSpace });

    expect(backup.method).toBe('file');
    expect(backup.sourceDamaged).toBe(false);
    expect(backup.path).toMatch(/pre-update-1\.1\.7-to-1\.2\.0-\d{8}T\d{9}Z\.db$/);
    expect(backup.bytes).toBeGreaterThan(0);
    expect(readdirSync(backupDir)).toEqual([basename(backup.path)]);
    expect(db.prepare('PRAGMA database_list').all().map((row: any) => row.name)).toEqual(['main']);

    const header = readFileSync(backup.path).subarray(18, 20);
    expect([...header]).toEqual([1, 1]);
    const copy = openTestDatabase(backup.path);
    open.push(copy);
    expect(copy.pragma('journal_mode', { simple: true })).toBe('delete');
    expect(copy.pragma('quick_check', { simple: true })).toBe('ok');
    expect(copy.prepare('SELECT COUNT(*) AS n FROM notes').get()).toEqual({ n: 500 });
    expect(copy.prepare('SELECT body FROM notes WHERE id = 500').get()).toEqual({ body: 'note 499' });
    copy.close();
    expect(readdirSync(backupDir)).toEqual([basename(backup.path)]);
  });

  test('falls back to VACUUM INTO while a reader holds the WAL, still with every row', () => {
    const directory = workspace();
    const db = database(directory);
    db.pragma('wal_autocheckpoint = 0');
    db.exec('CREATE TABLE notes (body TEXT)');
    db.prepare('INSERT INTO notes VALUES (?)').run('first');
    const reader = openTestDatabase(join(directory, 'kallamo.db'));
    open.push(reader);
    reader.exec('BEGIN');
    reader.prepare('SELECT COUNT(*) FROM notes').get();
    db.prepare('INSERT INTO notes VALUES (?)').run('second');

    const backup = createPreMigrationBackup(db, { backupDir: join(directory, 'backups'), fromVersion: '1.1.7', toVersion: '1.2.0', statfs: plentyOfSpace });
    reader.exec('ROLLBACK');

    expect(backup.method).toBe('vacuum');
    const copy = openTestDatabase(backup.path);
    open.push(copy);
    expect(copy.prepare('SELECT body FROM notes ORDER BY rowid').all()).toEqual([{ body: 'first' }, { body: 'second' }]);
  });

  test('a database that was already damaged still gets its faithful copy', () => {
    const directory = workspace();
    const file = join(directory, 'kallamo.db');
    const seed = openTestDatabase(file);
    seed.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT); CREATE INDEX idx_body ON notes(body);');
    const insert = seed.prepare('INSERT INTO notes (body) VALUES (?)');
    seed.transaction(() => { for (let i = 0; i < 3000; i++) insert.run(`n${i}`); })();
    const { rootpage } = seed.prepare("SELECT rootpage FROM sqlite_master WHERE name = 'idx_body'").get() as { rootpage: number };
    const pageSize = seed.pragma('page_size', { simple: true }) as number;
    seed.close();
    const fd = openSync(file, 'r+');
    writeSync(fd, Buffer.alloc(8, 0xff), 0, 8, (rootpage - 1) * pageSize + 8);
    closeSync(fd);

    const db = openTestDatabase(file);
    open.push(db);
    expect(db.pragma('quick_check', { simple: true })).not.toBe('ok');
    const backup = createPreMigrationBackup(db, { backupDir: join(directory, 'backups'), fromVersion: '1.1.7', toVersion: '1.2.0', statfs: plentyOfSpace });

    expect(backup.sourceDamaged).toBe(true);
    expect(readFileSync(backup.path).subarray(100).equals(readFileSync(file).subarray(100))).toBe(true);
  });

  test('refuses without enough free space and leaves no partial file', () => {
    const directory = workspace();
    const db = database(directory);
    db.exec('CREATE TABLE notes (body TEXT)');
    const backupDir = join(directory, 'backups');

    let thrown: any;
    try {
      createPreMigrationBackup(db, { backupDir, fromVersion: '1.1.7', toVersion: '1.2.0', statfs: () => ({ bavail: 1024, bsize: 1 }) });
    } catch (error) {
      thrown = error;
    }

    expect(thrown?.code).toBe('insufficient-space');
    expect(thrown.details.needed).toBeGreaterThan(thrown.details.available);
    expect(readdirSync(backupDir)).toEqual([]);
  });

  test('a failed copy leaves no partial file', () => {
    const directory = workspace();
    const db = openTestDatabase(':memory:');
    open.push(db);
    db.exec('CREATE TABLE notes (body TEXT)');
    const backupDir = join(directory, 'backups');

    let thrown: any;
    try {
      createPreMigrationBackup(db, { backupDir, fromVersion: '1.1.7', toVersion: '1.2.0', statfs: plentyOfSpace });
    } catch (error) {
      thrown = error;
    }

    expect(thrown?.code).toBe('copy-failed');
    expect(readdirSync(backupDir)).toEqual([]);
  });
});

describe('pruneMigrationBackups', () => {
  const touch = (dir: string, file: string) => writeFileSync(join(dir, file), 'x');
  const name = (from: string, to: string, day: number) => backupFileName(from, to, Date.UTC(2026, 8, 1) + day * DAY);

  test('keeps the newest three and leaves restore snapshots alone', () => {
    const dir = workspace();
    const names = [1, 2, 3, 4, 5].map(day => name('1.2.0', '1.2.1', day));
    for (const file of names) touch(dir, file);
    touch(dir, 'pre-restore-backup-1700000000000.db');
    touch(dir, `${name('1.2.0', '1.2.1', 6)}.tmp`);
    touch(dir, `${name('1.2.0', '1.2.1', 6)}.tmp-wal`);

    pruneMigrationBackups(dir);

    expect(readdirSync(dir).sort()).toEqual([...names.slice(2), 'pre-restore-backup-1700000000000.db'].sort());
  });

  test('keeps the newest copy taken across a release line', () => {
    const dir = workspace();
    const stable = name('unknown', '1.2.0-beta.1', 1);
    const betas = [2, 3, 4, 5].map(day => name(`1.2.0-beta.${day - 1}`, `1.2.0-beta.${day}`, day));
    for (const file of [stable, ...betas]) touch(dir, file);

    const removed = pruneMigrationBackups(dir);

    expect(removed).toEqual([betas[0]]);
    expect(readdirSync(dir).sort()).toEqual([stable, ...betas.slice(1)].sort());
  });

  test('a downgrade does not take the pin from the last upgrade into a new line', () => {
    const dir = workspace();
    const upgrade = name('1.1.7', '1.2.0', 1);
    const later = [2, 3, 4].map(day => name('1.2.0', `1.2.${day}`, day));
    const downgrade = name('1.2.4', '1.1.7', 5);
    for (const file of [upgrade, ...later, downgrade]) touch(dir, file);

    pruneMigrationBackups(dir);

    expect(readdirSync(dir).sort()).toEqual([upgrade, later[1], later[2], downgrade].sort());
  });

  test('lists copies newest first with their versions', () => {
    const dir = workspace();
    touch(dir, name('unknown', '1.2.0-beta.1', 1));
    touch(dir, name('1.2.0-beta.1', '1.2.0-beta.2', 2));
    touch(dir, 'notes.txt');

    const backups = listMigrationBackups(dir);

    expect(backups.map((b: any) => [b.fromVersion, b.toVersion])).toEqual([['1.2.0-beta.1', '1.2.0-beta.2'], ['unknown', '1.2.0-beta.1']]);
    expect(backups[0].createdAt).toBe(Date.UTC(2026, 8, 1) + 2 * DAY);
    expect(backups[0].bytes).toBe(1);
    expect(listMigrationBackups(join(dir, 'missing'))).toEqual([]);
  });
});

describe('restoreDatabaseFromBackup', () => {
  test('replaces the database and drops a stale WAL', () => {
    const directory = workspace();
    const dbPath = join(directory, 'kallamo.db');
    const db = database(directory);
    db.exec('CREATE TABLE notes (body TEXT)');
    db.prepare('INSERT INTO notes VALUES (?)').run('before');
    const backup = createPreMigrationBackup(db, { backupDir: join(directory, 'backups'), fromVersion: '1.1.7', toVersion: '1.2.0', statfs: plentyOfSpace });
    db.prepare('INSERT INTO notes VALUES (?)').run('after');
    db.close();
    writeFileSync(`${dbPath}-wal`, 'stale');

    restoreDatabaseFromBackup(dbPath, backup.path);

    expect(existsSync(`${dbPath}-wal`)).toBe(false);
    expect(existsSync(`${dbPath}.rollback`)).toBe(false);
    const restored = openTestDatabase(dbPath);
    open.push(restored);
    expect(restored.prepare('SELECT body FROM notes').all()).toEqual([{ body: 'before' }]);
  });
});

describe('runDatabaseMigrations', () => {
  test('a failing migration names itself and stops the ones after it', () => {
    const db = database();
    const ran: string[] = [];
    const migrations = [
      { id: 'ok_v1', up: () => ran.push('ok_v1') },
      { id: 'broken_v1', up: (d: any) => { d.exec('CREATE TABLE half (x)'); throw new Error('boom'); } },
      { id: 'later_v1', up: () => ran.push('later_v1') }
    ];

    let thrown: any;
    try { runDatabaseMigrations(db, migrations); } catch (error) { thrown = error; }

    expect(thrown.migrationId).toBe('broken_v1');
    expect(thrown.message).toContain('broken_v1');
    expect(thrown.message).toContain('boom');
    expect(ran).toEqual(['ok_v1']);
    expect(db.prepare('SELECT id FROM schema_migrations').all()).toEqual([{ id: 'ok_v1' }]);
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE name = 'half'").get()).toBeUndefined();
  });
});

describe('bootFailureMessage', () => {
  test('a low-disk refusal says how much to free and where', () => {
    const error = Object.assign(new Error('no space'), { code: 'insufficient-space', details: { needed: 300 * 1024 * 1024, available: 100 * 1024 * 1024 } });
    const { message } = bootFailureMessage({ stage: 'backup', error, dataDir: 'C:\\Data\\Kallamo' });
    expect(message).toContain('200 MB');
    expect(message).toContain('C:\\Data\\Kallamo');
    expect(message).toContain('has not been changed');
  });

  test('a failed migration says whether the data was put back', () => {
    const error = new Error('Migration broken_v1 failed: boom');
    const backupPath = join('C:', 'Data', 'Kallamo', 'backups', 'pre-update-1.1.7-to-1.2.0-20260922T142503123Z.db');
    const restored = bootFailureMessage({ stage: 'migration', error, dataDir: 'C:\\Data\\Kallamo', backupPath, restored: true });
    const manual = bootFailureMessage({ stage: 'migration', error, dataDir: 'C:\\Data\\Kallamo', backupPath, restored: false });

    expect(restored.message).toContain('exactly as it was before the update');
    expect(manual.message).toContain(backupPath);
    expect(manual.message).toContain('kallamo.db-wal');
    for (const { message } of [restored, manual]) {
      expect(message).toContain('broken_v1');
      expect(message).not.toMatch(/\u2014/);
    }
  });
});
