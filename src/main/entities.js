// Per-workspace Worldbuild registry access layer. Backs the entity + relation CRUD
// exposed over IPC, the derived-list queries (inventory, members…), and the
// surface-mention -> canonical-id resolver the tagger uses. Reused by ipc-handlers
// and workflow-runner; keep it free of Electron/IPC concerns.
const db = require('./database');
const crypto = require('crypto');

function parseJsonArray(raw) {
  if (!raw) return [];
  try { const a = JSON.parse(raw); return Array.isArray(a) ? a : []; } catch { return []; }
}

function parseJsonObject(raw) {
  if (!raw) return {};
  try { const o = JSON.parse(raw); return (o && typeof o === 'object' && !Array.isArray(o)) ? o : {}; } catch { return {}; }
}

function hydrate(row) {
  if (!row) return row;
  return {
    ...row,
    aliases: parseJsonArray(row.aliases),
    data: parseJsonObject(row.data),
  };
}

// ---- Entities ----

function listEntities({ workspaceId, type = null } = {}) {
  let rows;
  if (type) {
    rows = db.prepare('SELECT * FROM entities WHERE workspaceId = ? AND type = ? ORDER BY canonicalName')
      .all(workspaceId, type);
  } else {
    rows = db.prepare('SELECT * FROM entities WHERE workspaceId = ? ORDER BY type, canonicalName')
      .all(workspaceId);
  }
  return rows.map(hydrate);
}

function getEntity(id) {
  return hydrate(db.prepare('SELECT * FROM entities WHERE id = ?').get(id));
}

function createEntity({ workspaceId, type, canonicalName, aliases = [], lore = '', loreDocumentId = null, data = {}, status = 'confirmed' } = {}) {
  if (!type || !canonicalName || !String(canonicalName).trim()) {
    throw new Error('type and canonicalName are required');
  }
  const id = crypto.randomUUID();
  const now = Date.now();
  db.prepare(`
    INSERT INTO entities (id, workspaceId, type, canonicalName, aliases, lore, loreDocumentId, data, status, createdAt, last_modified)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, workspaceId || null, type, String(canonicalName).trim(),
    JSON.stringify(Array.isArray(aliases) ? aliases.map(a => String(a).trim()).filter(Boolean) : []),
    lore || '', loreDocumentId || null, JSON.stringify(data || {}), status || 'confirmed', now, now
  );
  return getEntity(id);
}

function updateEntity(id, fields = {}) {
  const cur = db.prepare('SELECT * FROM entities WHERE id = ?').get(id);
  if (!cur) return null;
  const next = {
    type: fields.type != null ? fields.type : cur.type,
    canonicalName: fields.canonicalName != null ? String(fields.canonicalName).trim() : cur.canonicalName,
    aliases: fields.aliases != null
      ? JSON.stringify(fields.aliases.map(a => String(a).trim()).filter(Boolean))
      : cur.aliases,
    lore: fields.lore != null ? fields.lore : cur.lore,
    loreDocumentId: fields.loreDocumentId !== undefined ? fields.loreDocumentId : cur.loreDocumentId,
    data: fields.data != null ? JSON.stringify(fields.data) : cur.data,
    status: fields.status != null ? fields.status : cur.status,
  };
  db.prepare(`
    UPDATE entities
    SET type = ?, canonicalName = ?, aliases = ?, lore = ?, loreDocumentId = ?, data = ?, status = ?, last_modified = ?
    WHERE id = ?
  `).run(next.type, next.canonicalName, next.aliases, next.lore, next.loreDocumentId, next.data, next.status, Date.now(), id);
  return getEntity(id);
}

function deleteEntity(id) {
  db.prepare('DELETE FROM entities WHERE id = ?').run(id); // links GC via trigger
  return { id };
}

// Map a surface mention to a canonical entity id within a workspace via case-insensitive
// exact match against canonicalName or any alias. Optional type narrows the search.
function resolveMention(mention, type = null, workspaceId = null) {
  if (!mention) return null;
  const needle = String(mention).trim().toLowerCase();
  if (!needle) return null;
  let rows;
  if (type) {
    rows = db.prepare('SELECT id, canonicalName, aliases FROM entities WHERE workspaceId IS ? AND type = ?').all(workspaceId || null, type);
  } else {
    rows = db.prepare('SELECT id, canonicalName, aliases FROM entities WHERE workspaceId IS ?').all(workspaceId || null);
  }
  for (const r of rows) {
    if (r.canonicalName && r.canonicalName.toLowerCase() === needle) return r.id;
    if (parseJsonArray(r.aliases).some(a => a.toLowerCase() === needle)) return r.id;
  }
  return null;
}

// ---- Relations (entity_links) ----

function summary(row) {
  return row ? { id: row.id, canonicalName: row.canonicalName, type: row.type } : null;
}

// Outgoing edges from an entity: returns the linked target entities. relType optional.
function getLinksFrom(fromId, relType = null) {
  const sql = `
    SELECT l.id AS linkId, l.relType AS relType, e.id AS id, e.canonicalName AS canonicalName, e.type AS type
    FROM entity_links l JOIN entities e ON l.toId = e.id
    WHERE l.fromId = ?${relType ? ' AND l.relType = ?' : ''}
    ORDER BY e.canonicalName`;
  const rows = relType ? db.prepare(sql).all(fromId, relType) : db.prepare(sql).all(fromId);
  return rows.map(r => ({ linkId: r.linkId, relType: r.relType, entity: summary(r) }));
}

// Incoming edges to an entity: returns the source entities. relType optional.
function getLinksTo(toId, relType = null) {
  const sql = `
    SELECT l.id AS linkId, l.relType AS relType, e.id AS id, e.canonicalName AS canonicalName, e.type AS type
    FROM entity_links l JOIN entities e ON l.fromId = e.id
    WHERE l.toId = ?${relType ? ' AND l.relType = ?' : ''}
    ORDER BY e.canonicalName`;
  const rows = relType ? db.prepare(sql).all(toId, relType) : db.prepare(sql).all(toId);
  return rows.map(r => ({ linkId: r.linkId, relType: r.relType, entity: summary(r) }));
}

// Add a directed edge. `single` first clears any existing edge of (fromId, relType),
// enforcing one-to-one relations (owner, race, parent location…). A null toId just
// clears (used to unset a single-value relation).
function setLink({ workspaceId, fromId, relType, toId, single = false }) {
  if (!fromId || !relType) throw new Error('fromId and relType are required');
  if (single) db.prepare('DELETE FROM entity_links WHERE fromId = ? AND relType = ?').run(fromId, relType);
  if (!toId) return { cleared: true };
  if (!single) {
    const exists = db.prepare('SELECT id FROM entity_links WHERE fromId = ? AND relType = ? AND toId = ?').get(fromId, relType, toId);
    if (exists) return { id: exists.id };
  }
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO entity_links (id, workspaceId, fromId, relType, toId, createdAt) VALUES (?, ?, ?, ?, ?, ?)')
    .run(id, workspaceId || null, fromId, relType, toId, Date.now());
  return { id };
}

function removeLink(linkId) {
  db.prepare('DELETE FROM entity_links WHERE id = ?').run(linkId);
  return { id: linkId };
}

module.exports = {
  listEntities,
  getEntity,
  createEntity,
  updateEntity,
  deleteEntity,
  resolveMention,
  getLinksFrom,
  getLinksTo,
  setLink,
  removeLink,
};
