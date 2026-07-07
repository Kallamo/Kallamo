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
  db.prepare('DELETE FROM entities WHERE id = ?').run(id); // links + chunk_tags GC via triggers
  return { id };
}

// Internal/transient data keys that must never survive a merge or ride along an export.
function stripInternal(data) {
  const d = { ...(data || {}) };
  delete d._enrichPending;
  delete d._imported;
  delete d.loreDocumentIds;
  return d;
}

// Fold one entity into an existing one: the source's name + aliases are absorbed as
// aliases of the target, its chunk tags and relation edges are repointed to the target,
// its data + lore are combined with the target's, then the source is deleted. `prefer`
// decides who wins on conflicting fields — 'target' (the existing entity, default) or
// 'source' (the folded-in one, e.g. a freshly imported entity). Used both for "this AI
// proposal is really an alias of X" and for merging an imported duplicate into a real one.
function mergeEntity(sourceId, targetId, { prefer = 'target' } = {}) {
  if (!sourceId || !targetId || sourceId === targetId) throw new Error('distinct source and target are required');
  const source = db.prepare('SELECT * FROM entities WHERE id = ?').get(sourceId);
  const target = db.prepare('SELECT * FROM entities WHERE id = ?').get(targetId);
  if (!source || !target) throw new Error('source or target entity not found');

  const seen = new Set([normalizeName(target.canonicalName)]);
  const mergedAliases = [];
  for (const a of [...parseJsonArray(target.aliases), source.canonicalName, ...parseJsonArray(source.aliases)]) {
    const clean = String(a || '').trim();
    if (!clean) continue;
    const key = normalizeName(clean);
    if (seen.has(key)) continue;
    seen.add(key);
    mergedAliases.push(clean);
  }

  // Combine data + lore, letting the preferred side win on conflicts; the survivor keeps
  // its own AI policy regardless. Internal keys never travel.
  const sData = stripInternal(parseJsonObject(source.data));
  const tData = stripInternal(parseJsonObject(target.data));
  const mergedData = prefer === 'source' ? { ...tData, ...sData } : { ...sData, ...tData };
  const targetPolicy = parseJsonObject(target.data).aiPolicy;
  if (targetPolicy) mergedData.aiPolicy = targetPolicy; else delete mergedData.aiPolicy;
  const sLore = (source.lore || '').trim();
  const tLore = (target.lore || '').trim();
  const mergedLore = prefer === 'source' ? (sLore || target.lore || '') : (tLore || source.lore || '');

  db.transaction(() => {
    // Repoint everything the source owned onto the target. OR IGNORE drops chunk-tag rows
    // that would collide with an existing (chunkId, tag, target) row.
    db.prepare('UPDATE OR IGNORE chunk_tags SET entity = ? WHERE entity = ?').run(targetId, sourceId);
    db.prepare('UPDATE entity_links SET fromId = ? WHERE fromId = ?').run(targetId, sourceId);
    db.prepare('UPDATE entity_links SET toId = ? WHERE toId = ?').run(targetId, sourceId);
    // A merge can create self-loops (source was linked to target) and duplicate edges.
    db.prepare('DELETE FROM entity_links WHERE fromId = toId').run();
    db.prepare(`DELETE FROM entity_links WHERE id NOT IN (
        SELECT MIN(id) FROM entity_links GROUP BY fromId, relType, toId, IFNULL(label, ''))`).run();
    db.prepare('UPDATE entities SET aliases = ?, lore = ?, data = ?, last_modified = ? WHERE id = ?')
      .run(JSON.stringify(mergedAliases), mergedLore, JSON.stringify(mergedData), Date.now(), targetId);
    db.prepare('DELETE FROM entities WHERE id = ?').run(sourceId);
  })();
  return getEntity(targetId);
}

// Stable identity for a staged link, so the UI can accept/reject one edge at a time.
function enrichLinkKey(l) { return `${l.relKey}:${l.targetId}:${l.label || ''}`; }

// Resolve part or all of a staged enrichment proposal (data._enrichPending, produced by
// the 'review' enrichment path). Resolution is incremental: only the items named in
// `accept`/`reject` leave the pending blob, so accepting one field doesn't discard the
// rest still under review. Accepted scalars/lore are written to the live record, accepted
// links become edges, accepted chapters are appended to loreDocumentIds; rejected items
// are dropped. Once nothing remains staged the blob is removed. `accept`/`reject` each =
// { fields: [...dataKeys], lore: bool, links: [...linkKeys], chapters: [...docIds] }.
function resolveEnrichReview(id, { accept = {}, reject = {} } = {}) {
  const cur = getEntity(id);
  if (!cur) throw new Error('entity not found');
  const pending = cur.data && cur.data._enrichPending;
  if (!pending || typeof pending !== 'object') return cur;

  const acceptFields = new Set(Array.isArray(accept.fields) ? accept.fields : []);
  const rejectFields = new Set(Array.isArray(reject.fields) ? reject.fields : []);
  const acceptLinks = new Set(Array.isArray(accept.links) ? accept.links : []);
  const rejectLinks = new Set(Array.isArray(reject.links) ? reject.links : []);
  const acceptChapters = new Set(Array.isArray(accept.chapters) ? accept.chapters : []);
  const rejectChapters = new Set(Array.isArray(reject.chapters) ? reject.chapters : []);

  const nextData = { ...cur.data };
  const fields = { data: nextData };
  const nextPending = {};

  // Scalar data fields.
  const pendingData = (pending.data && typeof pending.data === 'object') ? { ...pending.data } : {};
  for (const f of acceptFields) { if (f in pendingData) { nextData[f] = pendingData[f]; delete pendingData[f]; } }
  for (const f of rejectFields) delete pendingData[f];
  if (Object.keys(pendingData).length) nextPending.data = pendingData;

  // Lore is a single unit: accept applies it, reject drops it, otherwise it stays staged.
  if (pending.lore != null) {
    if (accept.lore) fields.lore = String(pending.lore);
    else if (!reject.lore) nextPending.lore = pending.lore;
  }

  // Links → real edges. Accept creates the edge (swapping endpoints for 'target'-anchored
  // relations, clearing prior single-valued ones); reject drops; the rest stays staged.
  if (Array.isArray(pending.links) && pending.links.length) {
    const keptLinks = [];
    for (const l of pending.links) {
      const key = enrichLinkKey(l);
      if (acceptLinks.has(key)) {
        const fromId = l.from === 'target' ? l.targetId : id;
        const toId = l.from === 'target' ? id : l.targetId;
        setLink({ workspaceId: cur.workspaceId, fromId, relType: l.relType, toId, single: !!l.single, label: l.label || null });
      } else if (!rejectLinks.has(key)) {
        keptLinks.push(l);
      }
    }
    if (keptLinks.length) nextPending.links = keptLinks;
  }

  // Chapters → appended to loreDocumentIds (de-duped), with the legacy single column kept
  // in sync. Accept adds, reject drops, the rest stays staged.
  if (Array.isArray(pending.chapters) && pending.chapters.length) {
    const keptChapters = [];
    const toAdd = [];
    for (const c of pending.chapters) {
      if (acceptChapters.has(c.id)) toAdd.push(c.id);
      else if (!rejectChapters.has(c.id)) keptChapters.push(c);
    }
    if (toAdd.length) {
      const merged = [...new Set([...linkedLoreDocIds(cur), ...toAdd])];
      nextData.loreDocumentIds = merged;
      fields.loreDocumentId = merged[0] || null;
    }
    if (keptChapters.length) nextPending.chapters = keptChapters;
  }

  if (Object.keys(nextPending).length) { nextPending.at = pending.at || Date.now(); nextData._enrichPending = nextPending; }
  else delete nextData._enrichPending;

  return updateEntity(id, fields);
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

// List every entity that could plausibly match a free-text mention, for a human
// picker (unlike resolveMention, which commits to one winner). A candidate matches
// when the needle equals or is contained in the canonical name or any alias — so
// two "Mara"s both surface and the user disambiguates. Exact matches rank first.
function findCandidates(mention, workspaceId = null, limit = 8) {
  const needle = normalizeName(mention);
  if (!needle || needle.length < 2) return [];
  const rows = db.prepare('SELECT id, canonicalName, type, aliases FROM entities WHERE workspaceId IS ?').all(workspaceId || null);
  const out = [];
  for (const r of rows) {
    const aliases = parseJsonArray(r.aliases);
    // Score canonical name and each alias; keep the best hit and remember whether it
    // came through an alias (so the UI can show "Alias: X" for the surprising matches).
    let best = null; // { rank, matchedAlias }
    const consider = (label, isAlias) => {
      const n = normalizeName(label);
      if (!n) return;
      let rank = null;
      if (n === needle) rank = 0;
      else if (n.startsWith(needle) || needle.startsWith(n)) rank = 1;
      else if (n.includes(needle) || needle.includes(n)) rank = 2;
      if (rank === null) return;
      if (!best || rank < best.rank) best = { rank, matchedAlias: isAlias ? label : null };
    };
    consider(r.canonicalName, false);
    for (const a of aliases) consider(a, true);
    if (best) out.push({ id: r.id, canonicalName: r.canonicalName, type: r.type, rank: best.rank, matchedAlias: best.matchedAlias });
  }
  return out.sort((a, b) => a.rank - b.rank || a.canonicalName.localeCompare(b.canonicalName)).slice(0, limit);
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

// Serialize a workspace's Worldbuild into a self-contained, portable package: entities
// (minus transient/workspace-bound bits) and the edges between them. Chapter links
// (loreDocumentIds) and staged AI proposals (_enrichPending) are intentionally dropped —
// they point at this workspace's Writing Desk and mean nothing elsewhere.
function exportWorldbuild(workspaceId) {
  const rows = db.prepare('SELECT * FROM entities WHERE workspaceId IS ? AND status != ?').all(workspaceId || null, 'proposed');
  const ids = new Set(rows.map(r => r.id));
  const entities = rows.map(r => ({
    ref: r.id,
    type: r.type,
    canonicalName: r.canonicalName,
    aliases: parseJsonArray(r.aliases),
    lore: r.lore || '',
    data: stripInternal(parseJsonObject(r.data)),
    status: r.status || 'confirmed',
  }));
  const linkRows = db.prepare('SELECT fromId, toId, relType, label FROM entity_links WHERE workspaceId IS ?').all(workspaceId || null);
  const links = linkRows
    .filter(l => ids.has(l.fromId) && ids.has(l.toId))
    .map(l => ({ fromRef: l.fromId, toRef: l.toId, relType: l.relType, label: l.label || null }));
  return { kallamoWorldbuild: 1, exportedAt: Date.now(), entities, links };
}

// Bring an exported package into a workspace WITHOUT de-duping by name — a same-named
// entity is not assumed to be the same entity. Every imported entity lands as a `proposed`
// row flagged _imported, and its edges are recreated among the imported set. The user then
// reviews each in the sheet: accept as new, dismiss, or merge into an existing entity
// (choosing which side's data wins). Returns how many entities/links were staged.
function importWorldbuild(workspaceId, payload) {
  if (!payload || payload.kallamoWorldbuild !== 1 || !Array.isArray(payload.entities)) {
    throw new Error('Not a valid Kallamo Worldbuild file.');
  }
  const idMap = new Map();
  let entitiesAdded = 0, linksAdded = 0;
  db.transaction(() => {
    for (const e of payload.entities) {
      if (!e || !e.type || !e.canonicalName) continue;
      const data = stripInternal((e.data && typeof e.data === 'object' && !Array.isArray(e.data)) ? e.data : {});
      data._imported = true;
      const created = createEntity({
        workspaceId, type: e.type, canonicalName: e.canonicalName,
        aliases: Array.isArray(e.aliases) ? e.aliases : [],
        lore: e.lore || '', data, status: 'proposed',
      });
      idMap.set(e.ref, created.id);
      entitiesAdded++;
    }
    for (const l of (Array.isArray(payload.links) ? payload.links : [])) {
      if (!l || !l.relType) continue;
      const fromId = idMap.get(l.fromRef);
      const toId = idMap.get(l.toRef);
      if (!fromId || !toId || fromId === toId) continue;
      setLink({ workspaceId, fromId, relType: l.relType, toId, single: false, label: l.label || null });
      linksAdded++;
    }
  })();
  return { entitiesAdded, linksAdded };
}

module.exports = {
  listEntities,
  getEntity,
  exportWorldbuild,
  importWorldbuild,
  createEntity,
  updateEntity,
  deleteEntity,
  mergeEntity,
  resolveEnrichReview,
  resolveMention,
  findCandidates,
  normalizeName,
  linkedLoreDocIds,
  getLinksFrom,
  getLinksTo,
  setLink,
  removeLink,
  updateLinkLabel,
};
