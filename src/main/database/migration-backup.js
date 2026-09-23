const fs = require('fs');
const path = require('path');

const BACKUP_PREFIX = 'pre-update-';
const BACKUP_NAME = /^pre-update-(.+?)-to-(.+)-(\d{8}T\d{9}Z)\.db$/;
const SCHEMA_VERSION_KEY = 'schemaAppVersion';
const UNKNOWN_VERSION = 'unknown';
const SPACE_HEADROOM = 1.2;
const SPACE_RESERVE_BYTES = 50 * 1024 * 1024;
const CHECK_SCHEMA = 'migration_backup_check';

class BackupError extends Error {
  constructor(code, message, details = {}) {
    super(message, details.cause ? { cause: details.cause } : undefined);
    this.name = 'BackupError';
    this.code = code;
    this.details = details;
  }
}

const hasTable = (db, name) => Boolean(
  db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
);

function readSchemaAppVersion(db) {
  if (!hasTable(db, 'app_meta')) return null;
  const row = db.prepare('SELECT value FROM app_meta WHERE key = ?').get(SCHEMA_VERSION_KEY);
  return row ? row.value : null;
}

function writeSchemaAppVersion(db, version) {
  db.exec('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT)');
  db.prepare(`
    INSERT INTO app_meta (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(SCHEMA_VERSION_KEY, version);
}

function appliedMigrationIds(db) {
  if (!hasTable(db, 'schema_migrations')) return [];
  return db.prepare('SELECT id FROM schema_migrations').all().map(row => row.id);
}

function unknownMigrationIds(db, migrationIds) {
  const known = new Set(migrationIds);
  return appliedMigrationIds(db).filter(id => !known.has(id));
}

// The version lives in the database itself, so restoring an old copy brings the old
// version back and the next boot backs it up again before migrating.
function needsPreMigrationBackup(db, { migrationIds, appVersion, isFreshInstall }) {
  if (isFreshInstall) return false;
  if (!db.prepare('SELECT 1 FROM sqlite_master LIMIT 1').get()) return false;
  const applied = new Set(appliedMigrationIds(db));
  if (migrationIds.some(id => !applied.has(id))) return true;
  return readSchemaAppVersion(db) !== appVersion;
}

const fileNameVersion = (version) => String(version || UNKNOWN_VERSION).replace(/[^0-9A-Za-z.+_-]/g, '_');
const fileStamp = (ms) => new Date(ms).toISOString().replace(/[-:.]/g, '');
const stampTime = (stamp) => Date.parse(
  `${stamp.slice(0, 4)}-${stamp.slice(4, 6)}-${stamp.slice(6, 8)}T${stamp.slice(9, 11)}:${stamp.slice(11, 13)}:${stamp.slice(13, 15)}.${stamp.slice(15, 18)}Z`
);

function backupFileName(fromVersion, toVersion, now) {
  return `${BACKUP_PREFIX}${fileNameVersion(fromVersion)}-to-${fileNameVersion(toVersion)}-${fileStamp(now)}.db`;
}

function parseBackupName(file) {
  const match = BACKUP_NAME.exec(file);
  if (!match) return null;
  return { file, fromVersion: match[1], toVersion: match[2], stamp: match[3], createdAt: stampTime(match[3]) };
}

const fileSize = (file) => {
  try { return fs.statSync(file).size; } catch { return 0; }
};

function assertFreeSpace(sourcePath, backupDir, statfs) {
  const needed = Math.ceil((fileSize(sourcePath) + fileSize(`${sourcePath}-wal`)) * SPACE_HEADROOM) + SPACE_RESERVE_BYTES;
  let available;
  try {
    const stats = statfs(backupDir);
    available = Number(stats.bavail) * Number(stats.bsize);
  } catch {
    // An unreadable drive is not proof of a full one; the copy itself still fails loudly.
    return;
  }
  if (available < needed) {
    throw new BackupError('insufficient-space', `Not enough free disk space for a safety copy (needs ${needed} bytes, has ${available}).`, { needed, available });
  }
}

const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

// Antivirus and indexers briefly hold new files open on Windows.
function renameWithRetry(from, to, attempts = 5) {
  for (let attempt = 1; ; attempt++) {
    try {
      fs.renameSync(from, to);
      return;
    } catch (error) {
      if (attempt >= attempts || !['EPERM', 'EBUSY', 'EACCES'].includes(error.code)) throw error;
      sleepSync(100 * attempt);
    }
  }
}

// Reports name the schema they ran in, which differs between the source and the attached copy.
const quickCheck = (db, schema) => db.pragma(`${schema}.quick_check`)
  .map(row => String(row.quick_check).replace(/^\*\*\* in database \S+ \*\*\*\n/, ''))
  .join('\n');

// The copy is judged against its source: a database that was already damaged still gets its
// most faithful copy, rather than an update that can never start.
function verifyBackup(db, file) {
  let sourceDamaged = false;
  db.prepare(`ATTACH DATABASE ? AS ${CHECK_SCHEMA}`).run(file);
  try {
    const check = quickCheck(db, CHECK_SCHEMA);
    if (check !== 'ok') {
      if (quickCheck(db, 'main') !== check) throw new Error(`integrity check reported: ${check}`);
      sourceDamaged = true;
    }
    const count = (schema) => db.prepare(`SELECT COUNT(*) AS n FROM ${schema}.sqlite_master`).get().n;
    const source = count('main');
    const copy = count(CHECK_SCHEMA);
    if (source !== copy) throw new Error(`copy has ${copy} schema objects, the database has ${source}`);
  } finally {
    db.exec(`DETACH DATABASE ${CHECK_SCHEMA}`);
  }
  return { sourceDamaged };
}

const removeCopy = (file) => {
  for (const suffix of ['', '-wal', '-shm', '-journal']) fs.rmSync(`${file}${suffix}`, { force: true });
};

// Once every WAL frame is backfilled, the main file alone is the whole database, and no other
// connection can write to it while this module loads. A byte copy then beats VACUUM INTO, which
// rebuilds every index. PASSIVE never waits: a stricter mode would sit out the busy timeout.
function copyDatabaseFile(db, target) {
  const [checkpoint] = db.pragma('wal_checkpoint(PASSIVE)');
  if (checkpoint && checkpoint.busy === 0 && checkpoint.checkpointed === checkpoint.log) {
    fs.copyFileSync(db.name, target);
    return 'file';
  }
  db.prepare('VACUUM INTO ?').run(target);
  return 'vacuum';
}

// Header bytes 18-19 = 1 mark a rollback-journal file, as SQLite writes when leaving WAL mode.
// A WAL-marked copy would leave -wal and -shm files beside it every time it is opened read-only.
function sealCopy(file) {
  const fd = fs.openSync(file, 'r+');
  try {
    fs.writeSync(fd, Buffer.from([1, 1]), 0, 2, 18);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

// Synchronous on purpose: it runs while database.js loads, before anything else may touch the file.
// Only a verified, flushed copy is renamed to its final name, so a .db here is always whole.
function createPreMigrationBackup(db, { backupDir, fromVersion, toVersion, now = Date.now(), statfs = fs.statfsSync }) {
  const startedAt = Date.now();
  fs.mkdirSync(backupDir, { recursive: true });
  assertFreeSpace(db.name, backupDir, statfs);

  const finalPath = path.join(backupDir, backupFileName(fromVersion, toVersion, now));
  const tmpPath = `${finalPath}.tmp`;
  removeCopy(tmpPath);

  let method;
  try {
    method = copyDatabaseFile(db, tmpPath);
    sealCopy(tmpPath);
  } catch (error) {
    removeCopy(tmpPath);
    throw new BackupError('copy-failed', `The safety copy could not be written: ${error.message}`, { cause: error });
  }

  let verified;
  try {
    verified = verifyBackup(db, tmpPath);
    renameWithRetry(tmpPath, finalPath);
  } catch (error) {
    removeCopy(tmpPath);
    throw new BackupError('verify-failed', `The safety copy could not be verified: ${error.message}`, { cause: error });
  }

  return { path: finalPath, bytes: fileSize(finalPath), ms: Date.now() - startedAt, method, sourceDamaged: verified.sourceDamaged };
}

const releaseLine = (version) => {
  const match = /^(\d+)\.(\d+)/.exec(version);
  return match ? Number(match[1]) * 100000 + Number(match[2]) : null;
};

// A copy from before version tracking existed predates every tracked line.
const upgradesReleaseLine = (backup) => {
  const from = releaseLine(backup.fromVersion);
  const to = releaseLine(backup.toVersion);
  return from === null || (to !== null && to > from);
};

// Beyond the newest few, the newest copy taken on the way into a new release line is kept, so a
// run of beta updates or a downgrade cannot push out the only copy of the last stable data.
function pruneMigrationBackups(backupDir, { keep = 3 } = {}) {
  let files;
  try { files = fs.readdirSync(backupDir); } catch { return []; }

  const removed = [];
  const remove = (file) => {
    try {
      fs.rmSync(path.join(backupDir, file), { force: true });
      removed.push(file);
    } catch {}
  };

  for (const file of files) {
    if (file.startsWith(BACKUP_PREFIX) && file.includes('.db.tmp')) remove(file);
  }

  const backups = files.map(parseBackupName).filter(Boolean).sort((a, b) => b.stamp.localeCompare(a.stamp));
  const kept = new Set(backups.slice(0, keep).map(backup => backup.file));
  const lastRelease = backups.find(upgradesReleaseLine);
  if (lastRelease) kept.add(lastRelease.file);

  for (const backup of backups) {
    if (!kept.has(backup.file)) remove(backup.file);
  }
  return removed;
}

function listMigrationBackups(backupDir) {
  let files;
  try { files = fs.readdirSync(backupDir); } catch { return []; }
  return files
    .map(parseBackupName)
    .filter(Boolean)
    .sort((a, b) => b.stamp.localeCompare(a.stamp))
    .map(({ file, fromVersion, toVersion, createdAt }) => ({
      file, fromVersion, toVersion, createdAt, bytes: fileSize(path.join(backupDir, file))
    }));
}

// The caller closes the database first. Leftover -wal/-shm files go before the copy lands:
// SQLite would replay a stale WAL onto whatever file sits at dbPath.
function restoreDatabaseFromBackup(dbPath, backupPath) {
  const stagedPath = `${dbPath}.rollback`;
  fs.copyFileSync(backupPath, stagedPath);
  try {
    fs.rmSync(`${dbPath}-wal`, { force: true });
    fs.rmSync(`${dbPath}-shm`, { force: true });
    renameWithRetry(stagedPath, dbPath);
  } catch (error) {
    fs.rmSync(stagedPath, { force: true });
    throw error;
  }
}

const megabytes = (bytes) => Math.max(1, Math.ceil(bytes / (1024 * 1024)));

function bootFailureMessage({ stage, error, dataDir, backupPath = null, restored = false }) {
  const details = `Details: ${error && error.message ? error.message : String(error)}`;

  if (stage === 'backup') {
    if (error && error.code === 'insufficient-space') {
      const { needed, available } = error.details;
      return {
        title: 'Not enough disk space',
        message: `Before this update changes your data, Kallamo saves a copy of it, and there is not enough free space on the drive for that copy.\n\nFree at least ${megabytes(needed - available)} MB on the drive that holds:\n${dataDir}\n\nthen open Kallamo again. Your data has not been changed.`
      };
    }
    return {
      title: 'Kallamo could not start',
      message: `Before this update changes your data, Kallamo saves a copy of it, and that copy could not be saved. Your data has not been changed.\n\nData folder:\n${dataDir}\n\n${details}`
    };
  }

  if (restored) {
    return {
      title: 'This update could not open your data',
      message: `This update could not bring your data up to date, so Kallamo put it back exactly as it was before the update.\n\nTo keep working, install the version of Kallamo you used before. The copy saved before the update stays in:\n${path.dirname(backupPath)}\n\n${details}`
    };
  }

  const recovery = backupPath
    ? `Your data from before the update is saved in:\n${backupPath}\n\nTo go back to it, close Kallamo, delete kallamo.db-wal and kallamo.db-shm from the data folder if they exist, and copy that file over kallamo.db.\n\n`
    : '';
  return {
    title: 'This update could not open your data',
    message: `This update could not bring your data up to date, and Kallamo stopped before using it.\n\n${recovery}Data folder:\n${dataDir}\n\n${details}`
  };
}

module.exports = {
  BackupError,
  readSchemaAppVersion,
  writeSchemaAppVersion,
  unknownMigrationIds,
  needsPreMigrationBackup,
  backupFileName,
  createPreMigrationBackup,
  pruneMigrationBackups,
  listMigrationBackups,
  restoreDatabaseFromBackup,
  bootFailureMessage,
  UNKNOWN_VERSION
};
