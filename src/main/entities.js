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

// Fold typographic punctuation to ASCII before matching, so a curly apostrophe in a
// canonical name (e.g. seed data: "The Keeper's Logbook") still matches the straight
// apostrophe a user or the model types. Also trims + lowercases + collapses whitespace.
function normalizeName(s) {
  return String(s || '')
    .replace(/[‘’‛ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
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
  const needle = normalizeName(mention);
  if (!needle) return null;
  let rows;
  if (type) {
    rows = db.prepare('SELECT id, canonicalName, aliases FROM entities WHERE workspaceId IS ? AND type = ?').all(workspaceId || null, type);
  } else {
    rows = db.prepare('SELECT id, canonicalName, aliases FROM entities WHERE workspaceId IS ?').all(workspaceId || null);
  }
  for (const r of rows) {
    if (r.canonicalName && normalizeName(r.canonicalName) === needle) return r.id;
    if (parseJsonArray(r.aliases).some(a => normalizeName(a) === needle)) return r.id;
  }
  return null;
}

// The chapters (Writing Desk documents) linked to an entity's lore. Reads the
// multi-value data.loreDocumentIds when present, else falls back to the legacy
// single loreDocumentId column. Always returns a de-duped array of ids.
function linkedLoreDocIds(ent) {
  if (!ent) return [];
  const ids = [];
  const arr = ent.data && Array.isArray(ent.data.loreDocumentIds) ? ent.data.loreDocumentIds : null;
  if (arr) for (const id of arr) { if (id) ids.push(id); }
  else if (ent.loreDocumentId) ids.push(ent.loreDocumentId);
  return [...new Set(ids)];
}

// ---- Relations (entity_links) ----

function summary(row) {
  return row ? { id: row.id, canonicalName: row.canonicalName, type: row.type } : null;
}

// Outgoing edges from an entity: returns the linked target entities. relType optional.
function getLinksFrom(fromId, relType = null) {
  const sql = `
    SELECT l.id AS linkId, l.relType AS relType, l.label AS label, e.id AS id, e.canonicalName AS canonicalName, e.type AS type
    FROM entity_links l JOIN entities e ON l.toId = e.id
    WHERE l.fromId = ?${relType ? ' AND l.relType = ?' : ''}
    ORDER BY e.canonicalName`;
  const rows = relType ? db.prepare(sql).all(fromId, relType) : db.prepare(sql).all(fromId);
  return rows.map(r => ({ linkId: r.linkId, relType: r.relType, label: r.label || null, entity: summary(r) }));
}

// Incoming edges to an entity: returns the source entities. relType optional.
function getLinksTo(toId, relType = null) {
  const sql = `
    SELECT l.id AS linkId, l.relType AS relType, l.label AS label, e.id AS id, e.canonicalName AS canonicalName, e.type AS type
    FROM entity_links l JOIN entities e ON l.fromId = e.id
    WHERE l.toId = ?${relType ? ' AND l.relType = ?' : ''}
    ORDER BY e.canonicalName`;
  const rows = relType ? db.prepare(sql).all(toId, relType) : db.prepare(sql).all(toId);
  return rows.map(r => ({ linkId: r.linkId, relType: r.relType, label: r.label || null, entity: summary(r) }));
}

// Add a directed edge. `single` first clears any existing edge of (fromId, relType),
// enforcing one-to-one relations (owner, race, parent location…). A null toId just
// clears (used to unset a single-value relation).
function setLink({ workspaceId, fromId, relType, toId, single = false, label = null }) {
  if (!fromId || !relType) throw new Error('fromId and relType are required');
  const cleanLabel = label != null && String(label).trim() ? String(label).trim() : null;
  if (single) db.prepare('DELETE FROM entity_links WHERE fromId = ? AND relType = ?').run(fromId, relType);
  if (!toId) return { cleared: true };
  if (!single) {
    // For labeled relations, the same pair can hold distinct labels — dedup on (pair, label).
    const exists = db.prepare("SELECT id FROM entity_links WHERE fromId = ? AND relType = ? AND toId = ? AND IFNULL(label, '') = ?")
      .get(fromId, relType, toId, cleanLabel || '');
    if (exists) return { id: exists.id };
  }
  const id = crypto.randomUUID();
  db.prepare('INSERT INTO entity_links (id, workspaceId, fromId, relType, toId, label, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, workspaceId || null, fromId, relType, toId, cleanLabel, Date.now());
  return { id };
}

function removeLink(linkId) {
  db.prepare('DELETE FROM entity_links WHERE id = ?').run(linkId);
  return { id: linkId };
}

// Set (or clear) the free-text label on an existing edge, e.g. a member's role.
function updateLinkLabel(linkId, label) {
  const clean = label != null && String(label).trim() ? String(label).trim() : null;
  db.prepare('UPDATE entity_links SET label = ? WHERE id = ?').run(clean, linkId);
  return { id: linkId, label: clean };
}

module.exports = {
  listEntities,
  getEntity,
  createEntity,
  updateEntity,
  deleteEntity,
  resolveMention,
  normalizeName,
  linkedLoreDocIds,
  getLinksFrom,
  getLinksTo,
  setLink,
  removeLink,
  updateLinkLabel,
};
