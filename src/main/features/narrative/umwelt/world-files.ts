import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import type Database from 'better-sqlite3';
import { getUmweltBridge } from './bridge';

/** The table a backup copy carries the story files in; it never exists in the live database. */
export const WORLD_FILES_TABLE = 'narrative_world_files';
const WORLD_EXTENSION = '.umw';

// Shared by every copy of this module in the process, like the bridge.
const STATE_KEY = Symbol.for('kallamo.umwelt.world-files');
interface WorldFilesState { directories: WeakMap<Database.Database, string>; scratchRoot: string | null }
const state: WorldFilesState = ((globalThis as Record<symbol, WorldFilesState>)[STATE_KEY] ??= { directories: new WeakMap(), scratchRoot: null });
const directories = state.directories;

/** Where the story files of this database live. The app's own database names its folder at startup. */
export function setWorldDirectory(db: Database.Database, directory: string): void {
  mkdirSync(directory, { recursive: true });
  directories.set(db, directory);
}

// Any other database (tests, tools) keeps its worlds in a folder of this process, removed on exit.
export function worldDirectory(db: Database.Database): string {
  let directory = directories.get(db);
  if (directory) return directory;
  if (!state.scratchRoot) {
    state.scratchRoot = mkdtempSync(join(tmpdir(), 'kallamo-worlds-'));
    const root = state.scratchRoot;
    process.once('exit', () => {
      try { getUmweltBridge().closeAll(); } catch { /* the engines end with the process */ }
      try { rmSync(root, { recursive: true, force: true }); } catch { /* left for the system to clean */ }
    });
  }
  directory = mkdtempSync(join(state.scratchRoot, 'db-'));
  directories.set(db, directory);
  return directory;
}

/** Workspace ids become file names; anything a file name cannot hold is replaced and disambiguated. */
export function worldFileName(workspaceId: string): string {
  const safe = workspaceId.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 80);
  if (safe === workspaceId) return `${safe}${WORLD_EXTENSION}`;
  return `${safe}-${createHash('sha256').update(workspaceId).digest('hex').slice(0, 8)}${WORLD_EXTENSION}`;
}

export function worldFile(db: Database.Database, workspaceId: string): string {
  if (!workspaceId) throw new Error('A workspace id is required.');
  return join(worldDirectory(db), worldFileName(workspaceId));
}

// The engine keeps the pre-migration copy as `<file>.v<storage>.bak`; it holds the same story.
const MIGRATION_BACKUP = /\.umw\.v\d+\.bak$/;

function sidecars(file: string): string[] {
  const directory = dirname(file);
  const prefix = `${basename(file)}.v`;
  const backups = existsSync(directory)
    ? readdirSync(directory).filter(name => name.startsWith(prefix) && MIGRATION_BACKUP.test(name)).map(name => join(directory, name))
    : [];
  return [file, `${file}-wal`, `${file}-shm`, `${file}.lock`, ...backups];
}

/** Deletes a workspace's story file. The engine is shut down first so the file is not locked. */
export function removeWorldFile(db: Database.Database, workspaceId: string): boolean {
  const file = worldFile(db, workspaceId);
  getUmweltBridge().close(file);
  let removed = false;
  for (const path of sidecars(file)) {
    if (!existsSync(path)) continue;
    rmSync(path, { force: true });
    removed = true;
  }
  return removed;
}

/** Removes the story files of workspaces that no longer exist. */
export function removeOrphanWorldFiles(db: Database.Database, workspaceIds: string[]): number {
  const expected = new Set(workspaceIds.map(worldFileName));
  const directory = worldDirectory(db);
  let removed = 0;
  for (const name of listWorldFiles(db)) {
    if (expected.has(name)) continue;
    const file = join(directory, name);
    getUmweltBridge().close(file);
    for (const path of sidecars(file)) rmSync(path, { force: true });
    removed += 1;
  }
  return removed;
}

/** Workspace story files present on disk, by file name. */
export function listWorldFiles(db: Database.Database): string[] {
  const directory = worldDirectory(db);
  if (!existsSync(directory)) return [];
  return readdirSync(directory).filter(name => name.endsWith(WORLD_EXTENSION));
}

/**
 * Copies every story file into a backup copy of the database, so a backup stays one file. Each
 * engine is shut down first, which folds its journal into the file.
 */
export function packWorldFiles(db: Database.Database, backupPath: string, open: (path: string) => Database.Database): number {
  const directory = worldDirectory(db);
  const names = listWorldFiles(db);
  const bridge = getUmweltBridge();
  for (const name of names) bridge.close(join(directory, name));
  const backup = open(backupPath);
  try {
    backup.exec(`CREATE TABLE IF NOT EXISTS ${WORLD_FILES_TABLE} (file_name TEXT PRIMARY KEY, content BLOB NOT NULL)`);
    const insert = backup.prepare(`INSERT OR REPLACE INTO ${WORLD_FILES_TABLE} (file_name, content) VALUES (?, ?)`);
    backup.transaction(() => {
      for (const name of names) insert.run(name, readFileSync(join(directory, name)));
    })();
  } finally {
    backup.close();
  }
  return names.length;
}

/**
 * Restores the story files a backup carried. A backup without them still empties the folder, so no
 * story of the replaced data survives the restore.
 */
export function unpackWorldFiles(db: Database.Database): number {
  const directory = worldDirectory(db);
  getUmweltBridge().closeAll();
  for (const name of readdirSync(directory)) {
    const isWorldFile = ['', '-wal', '-shm', '.lock'].some(suffix => name.endsWith(`${WORLD_EXTENSION}${suffix}`)) || MIGRATION_BACKUP.test(name);
    if (isWorldFile) rmSync(join(directory, name), { force: true });
  }
  const hasTable = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(WORLD_FILES_TABLE);
  if (!hasTable) return 0;
  const rows = db.prepare(`SELECT file_name, content FROM ${WORLD_FILES_TABLE}`).all() as Array<{ file_name: string; content: Buffer }>;
  for (const row of rows) {
    if (!row.file_name.endsWith(WORLD_EXTENSION) || row.file_name.includes('/') || row.file_name.includes('\\')) continue;
    writeFileSync(join(directory, row.file_name), row.content);
  }
  db.exec(`DROP TABLE ${WORLD_FILES_TABLE}`);
  return rows.length;
}
