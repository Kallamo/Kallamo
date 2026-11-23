const crypto = require('crypto');
const { PACKAGE_HEADER, IDENTIFIED } = require('./package-coverage');

// A package's identity, the uids its parts carry, and the origin a world keeps of the package it
// came from. Nothing here changes what an import does; it only records what a later version needs.

const HEADER = new Set(PACKAGE_HEADER);
const hasTable = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
const recordsOf = (payload, part) => {
  const list = part.records(payload || {});
  return Array.isArray(list) ? list.filter(record => record && record.ref != null) : [];
};

/** Gives every identified record its uid: the one this world keeps for it, or its own id when the world wrote it. */
function stampUids(db, workspaceId, payload) {
  const stored = hasTable(db, 'worldbuild_package_uids')
    ? db.prepare('SELECT package_uid FROM worldbuild_package_uids WHERE workspace_id = ? AND part = ? AND local_id = ?')
    : null;
  for (const part of IDENTIFIED) {
    for (const record of recordsOf(payload, part)) {
      record.uid = stored?.get(workspaceId, part.part, String(record.ref))?.package_uid || String(record.ref);
    }
  }
  return payload;
}

/** The package's content without its header, so the same world exported twice hashes the same. */
function contentHash(payload) {
  const content = Object.fromEntries(Object.entries(payload || {}).filter(([key]) => key === 'kallamoWorldbuild' || !HEADER.has(key)));
  return crypto.createHash('sha256').update(JSON.stringify(content)).digest('hex');
}

/**
 * Writes packageId, packageVersion and packageHash into a package the person is saving. The version
 * moves only when the content does. Returns the call that keeps the identity once the file is written.
 */
function stampIdentity(db, workspaceId, payload, now = Date.now()) {
  const hash = contentHash(payload);
  const current = db.prepare('SELECT package_id, version, content_hash FROM worldbuild_package_identity WHERE workspace_id = ?').get(workspaceId);
  const packageId = current?.package_id || crypto.randomUUID();
  const version = !current ? 1 : current.content_hash === hash ? current.version : current.version + 1;
  Object.assign(payload, { packageId, packageVersion: version, packageHash: hash });
  return () => db.prepare(`
    INSERT INTO worldbuild_package_identity (workspace_id, package_id, version, content_hash, exported_at) VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET version = excluded.version, content_hash = excluded.content_hash, exported_at = excluded.exported_at
  `).run(workspaceId, packageId, version, hash, now);
}

function hasIdentity(payload) {
  return typeof payload?.packageId === 'string' && payload.packageId.length > 0
    && Number.isInteger(payload.packageVersion) && typeof payload.packageHash === 'string';
}

/**
 * `landed` maps each identified part to its ref → local id map. A package without an identity
 * records nothing: its refs are not known to be stable, so none is guessed.
 */
function recordImport(db, workspaceId, payload, landed, now = Date.now()) {
  const keep = db.prepare(`
    INSERT INTO worldbuild_package_uids (workspace_id, part, local_id, package_uid) VALUES (?, ?, ?, ?)
    ON CONFLICT(workspace_id, part, local_id) DO UPDATE SET package_uid = excluded.package_uid
  `);
  let importId = null;
  let uids = 0;
  db.transaction(() => {
    if (hasIdentity(payload)) {
      importId = crypto.randomUUID();
      db.prepare(`
        INSERT INTO worldbuild_package_origins (import_id, workspace_id, package_id, version, content_hash, imported_at, base_json)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(importId, workspaceId, payload.packageId, payload.packageVersion, payload.packageHash, now, JSON.stringify(payload));
    }
    for (const part of IDENTIFIED) {
      const map = landed?.[part.part];
      if (!map) continue;
      for (const record of recordsOf(payload, part)) {
        const localId = map.get(record.ref);
        if (!localId || typeof record.uid !== 'string' || !record.uid) continue;
        keep.run(workspaceId, part.part, String(localId), record.uid);
        uids++;
      }
    }
  })();
  return { importId, uids };
}

/** A new story in the same world comes from the same packages. */
function copyOrigins(db, sourceId, targetId) {
  const insert = db.prepare(`
    INSERT INTO worldbuild_package_origins (import_id, workspace_id, package_id, version, content_hash, imported_at, base_json)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const rows = db.prepare('SELECT * FROM worldbuild_package_origins WHERE workspace_id = ? ORDER BY imported_at').all(sourceId);
  for (const row of rows) insert.run(crypto.randomUUID(), targetId, row.package_id, row.version, row.content_hash, row.imported_at, row.base_json);
  return rows.length;
}

/** Uids of one part, for records a caller copied itself; `idMap` maps the source's local ids to the copies. */
function copyUids(db, { sourceId, targetId, part, idMap }) {
  const insert = db.prepare(`
    INSERT OR REPLACE INTO worldbuild_package_uids (workspace_id, part, local_id, package_uid) VALUES (?, ?, ?, ?)
  `);
  let copied = 0;
  for (const row of db.prepare('SELECT local_id, package_uid FROM worldbuild_package_uids WHERE workspace_id = ? AND part = ?').all(sourceId, part)) {
    const localId = idMap.get(row.local_id);
    if (!localId) continue;
    insert.run(targetId, part, localId, row.package_uid);
    copied++;
  }
  return copied;
}

function listOrigins(db, workspaceId) {
  return db.prepare('SELECT import_id, package_id, version, content_hash, imported_at FROM worldbuild_package_origins WHERE workspace_id = ? ORDER BY imported_at')
    .all(workspaceId).map(row => ({
      importId: row.import_id, packageId: row.package_id, version: row.version, hash: row.content_hash, importedAt: row.imported_at,
    }));
}

module.exports = { stampUids, contentHash, stampIdentity, recordImport, copyOrigins, copyUids, listOrigins };
