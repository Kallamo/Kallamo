// Compares two copies of kallamo.db, usually a pre-update backup and the migrated database,
// and flags every count that went down.
//
//   node tools/migration-report.cjs <before.db> <after.db>
const Database = require('better-sqlite3');
const { resolveNativeBinding } = require('./sqlite-binding.cjs');

const [beforePath, afterPath] = process.argv.slice(2);
if (!beforePath || !afterPath) {
  console.error('Usage: node tools/migration-report.cjs <before.db> <after.db>');
  process.exit(2);
}

const nativeBinding = resolveNativeBinding();
const openReadonly = (file) => new Database(file, { readonly: true, fileMustExist: true, ...(nativeBinding ? { nativeBinding } : {}) });

const quote = (name) => `"${String(name).replace(/"/g, '""')}"`;
const hasTable = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));

function tableCounts(db) {
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
  const counts = new Map();
  for (const { name } of tables) {
    try { counts.set(name, db.prepare(`SELECT COUNT(*) AS n FROM ${quote(name)}`).get().n); } catch { counts.set(name, null); }
  }
  return counts;
}

function groupedCounts(db, table, column) {
  if (!hasTable(db, table)) return new Map();
  const rows = db.prepare(`SELECT ${quote(column)} AS key, COUNT(*) AS n FROM ${quote(table)} GROUP BY 1 ORDER BY 1`).all();
  return new Map(rows.map(row => [String(row.key), row.n]));
}

function appliedMigrations(db) {
  if (!hasTable(db, 'schema_migrations')) return new Set();
  return new Set(db.prepare('SELECT id FROM schema_migrations').all().map(row => row.id));
}

function section(title, before, after) {
  const keys = [...new Set([...before.keys(), ...after.keys()])].sort();
  const width = Math.max(title.length, ...keys.map(key => key.length));
  const lines = [`\n${title.padEnd(width)}  ${'before'.padStart(10)}  ${'after'.padStart(10)}  change`];
  let drops = 0;
  for (const key of keys) {
    const b = before.has(key) ? before.get(key) : null;
    const a = after.has(key) ? after.get(key) : null;
    const delta = (a ?? 0) - (b ?? 0);
    const fell = b !== null && (a === null || a < b);
    if (fell) drops++;
    const change = b === a ? '' : `${delta > 0 ? '+' : ''}${delta}${a === null ? ' (gone)' : b === null ? ' (new)' : ''}`;
    lines.push(`${key.padEnd(width)}  ${String(b ?? '-').padStart(10)}  ${String(a ?? '-').padStart(10)}  ${change}${fell ? '   <-- DROPPED' : ''}`);
  }
  console.log(lines.join('\n'));
  return drops;
}

const before = openReadonly(beforePath);
const after = openReadonly(afterPath);

let drops = 0;
drops += section('Table rows', tableCounts(before), tableCounts(after));
drops += section('entities by type', groupedCounts(before, 'entities', 'type'), groupedCounts(after, 'entities', 'type'));
drops += section('entity_links by relType', groupedCounts(before, 'entity_links', 'relType'), groupedCounts(after, 'entity_links', 'relType'));

const migrationsBefore = appliedMigrations(before);
const migrationsAfter = appliedMigrations(after);
const added = [...migrationsAfter].filter(id => !migrationsBefore.has(id));
const missing = [...migrationsBefore].filter(id => !migrationsAfter.has(id));
console.log(`\nschema_migrations: ${migrationsBefore.size} before, ${migrationsAfter.size} after`);
for (const id of added) console.log(`  + ${id}`);
for (const id of missing) console.log(`  - ${id}   <-- MISSING AFTER`);

before.close();
after.close();

console.log(drops ? `\n${drops} count(s) went down. Review each one before the release.` : '\nNo count went down.');
