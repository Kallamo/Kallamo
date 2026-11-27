const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const {
  BackupError,
  needsPreMigrationBackup,
  createPreMigrationBackup,
  readSchemaAppVersion,
  UNKNOWN_VERSION
} = require('./migration-backup');
const { dataDirectory } = require('./data-dir');

const WORKER_SOURCE = `
const { workerData, parentPort } = require('node:worker_threads');
require(workerData.self).runBackupJob(workerData.job, message => parentPort.postMessage(message));
`;

let prepared = null;

/** Runs inside the worker: the copy and its integrity check never touch the main thread. */
function runBackupJob(job, post) {
  const Database = require(job.sqlitePath);
  const db = new Database(job.dbPath, job.nativeBinding ? { nativeBinding: job.nativeBinding } : undefined);
  try {
    if (!needsPreMigrationBackup(db, { migrationIds: job.migrationIds, appVersion: job.appVersion, isFreshInstall: false })) {
      post({ needed: false });
      return;
    }
    post({ copying: true });
    try {
      const backup = createPreMigrationBackup(db, {
        backupDir: job.backupDir,
        fromVersion: readSchemaAppVersion(db) || UNKNOWN_VERSION,
        toVersion: job.appVersion
      });
      post({ backup });
    } catch (error) {
      post({ error: { code: error.code || null, message: error.message, details: error.details || {} } });
    }
  } finally {
    db.close();
  }
}

function copyNeeded(job) {
  const Database = require(job.sqlitePath);
  const db = new Database(job.dbPath, { readonly: true, ...(job.nativeBinding ? { nativeBinding: job.nativeBinding } : {}) });
  try {
    return needsPreMigrationBackup(db, { migrationIds: job.migrationIds, appVersion: job.appVersion, isFreshInstall: false });
  } finally {
    db.close();
  }
}

function runInWorker(job, onCopying) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_SOURCE, { eval: true, workerData: { self: __filename, job } });
    let outcome = null;
    worker.on('message', message => {
      if (message.copying) onCopying();
      else outcome = message;
    });
    worker.once('error', reject);
    worker.once('exit', code => {
      if (outcome) resolve(outcome);
      else reject(new Error(`The backup worker stopped (exit code ${code}) without a result.`));
    });
  });
}

/**
 * Saves the pre-update copy off the main thread, before database.js loads, so the splash keeps
 * responding. Anything that keeps the worker from answering leaves database.js its own copy.
 */
async function backupBeforeUpdate({
  appVersion,
  migrationIds,
  onCopying = () => {},
  dataDir = dataDirectory(),
  sqlitePath = require.resolve('better-sqlite3'),
  nativeBinding = null,
  run = runInWorker
}) {
  prepared = null;
  const dbPath = path.join(dataDir, 'kallamo.db');
  // A pending restore swaps the file first, and the copy must be of the database being migrated.
  if (!fs.existsSync(dbPath) || fs.existsSync(path.join(dataDir, 'RESTORE_PENDING.json'))) return null;
  const job = { dbPath, backupDir: path.join(dataDir, 'backups'), migrationIds, appVersion, sqlitePath, nativeBinding };
  // Starting a worker costs more than this check, and most launches need no copy.
  if (!copyNeeded(job)) return { needed: false };
  const outcome = await run(job, onCopying);
  if (outcome.backup) prepared = { dbPath, backup: outcome.backup };
  else if (outcome.error) {
    const { code, message, details } = outcome.error;
    prepared = { dbPath, error: code ? new BackupError(code, message, details) : new Error(message) };
  }
  return outcome;
}

/** The copy saved for this database at launch, handed over once. */
function takePreparedBackup(dbPath) {
  const result = prepared && prepared.dbPath === dbPath ? prepared : null;
  prepared = null;
  return result;
}

module.exports = { backupBeforeUpdate, takePreparedBackup, runBackupJob, runInWorker };
