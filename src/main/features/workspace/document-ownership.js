// Every place that stores a Writing Desk document id, and what deleting the document does to it.
// Nothing references documents through a foreign key; the coverage test compares this list with
// the live schema.

const DOCUMENT_REFERENCE_COLUMNS = [
  { table: 'knowledge_chunks', column: 'ownerId', delete: "remove the chapter's passages (ownerType = 'document')" },
  { table: 'document_notes', column: 'documentId', delete: 'remove' },
  { table: 'document_analyses', column: 'documentId', delete: 'remove' },
  { table: 'pending_suggestions', column: 'documentId', delete: 'remove' },
  { table: 'entities', column: 'loreDocumentId', delete: 'next linked chapter, or none' },
  { table: 'entities', column: 'data', delete: 'unlist from loreDocumentIds and staged chapters' }
];

const hasTable = (db, name) => Boolean(
  db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
);

function parseJson(text, fallback) {
  if (text == null || text === '') return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
}

const likeId = id => `%${String(id).replace(/[\\%_]/g, match => `\\${match}`)}%`;

// The keyword index and the chunk-keyed tables follow through the knowledge_chunks delete trigger.
function removeDocumentChunks(db, documentId) {
  db.prepare("DELETE FROM knowledge_chunks WHERE ownerType = 'document' AND ownerId = ?").run(documentId);
}

// The entity's chapter links without one document; the legacy column moves to the next link.
function withoutDocument({ loreDocumentId, data }, documentId) {
  const next = { ...data };
  if (Array.isArray(next.loreDocumentIds)) next.loreDocumentIds = next.loreDocumentIds.filter(id => id !== documentId);
  if (next._enrichPending && Array.isArray(next._enrichPending.chapters)) {
    const chapters = next._enrichPending.chapters.filter(chapter => chapter && chapter.id !== documentId);
    next._enrichPending = { ...next._enrichPending, chapters };
    if (!chapters.length) delete next._enrichPending.chapters;
  }
  const remaining = Array.isArray(next.loreDocumentIds) ? next.loreDocumentIds : [];
  return { loreDocumentId: loreDocumentId === documentId ? (remaining[0] || null) : loreDocumentId, data: next };
}

function unlinkFromEntities(db, documentId) {
  const rows = db.prepare(`
    SELECT id, loreDocumentId, data FROM entities
    WHERE loreDocumentId = ? OR data LIKE ? ESCAPE '\\'
  `).all(documentId, likeId(documentId));
  const update = db.prepare('UPDATE entities SET loreDocumentId = ?, data = ?, last_modified = ? WHERE id = ?');
  for (const row of rows) {
    const next = withoutDocument({ loreDocumentId: row.loreDocumentId, data: parseJson(row.data, {}) }, documentId);
    update.run(next.loreDocumentId, JSON.stringify(next.data), Date.now(), row.id);
  }
}

/** Removes documents and everything that hangs off them. Runs inside the caller's transaction when there is one. */
function purgeDocuments(db, documentIds) {
  const ids = [...new Set((documentIds || []).filter(Boolean))];
  db.transaction(() => {
    for (const id of ids) {
      removeDocumentChunks(db, id);
      for (const table of ['document_notes', 'document_analyses', 'pending_suggestions']) {
        if (hasTable(db, table)) db.prepare(`DELETE FROM ${table} WHERE documentId = ?`).run(id);
      }
      unlinkFromEntities(db, id);
      db.prepare('DELETE FROM documents WHERE id = ?').run(id);
    }
  })();
  return { documents: ids.length };
}

/** Removes a folder, its subfolders and every document inside them. */
function purgeFolder(db, folderId) {
  const folder = db.prepare('SELECT workspaceId FROM folders WHERE id = ?').get(folderId);
  if (!folder) return { folders: 0, documents: 0 };
  const all = db.prepare('SELECT id, parentId FROM folders WHERE workspaceId = ?').all(folder.workspaceId);
  const folderIds = new Set([folderId]);
  for (let grew = true; grew;) {
    grew = false;
    for (const row of all) {
      if (row.parentId && folderIds.has(row.parentId) && !folderIds.has(row.id)) {
        folderIds.add(row.id);
        grew = true;
      }
    }
  }
  const placeholders = [...folderIds].map(() => '?').join(', ');
  let documents = 0;
  db.transaction(() => {
    const ids = db.prepare(`SELECT id FROM documents WHERE folderId IN (${placeholders})`).all(...folderIds).map(row => row.id);
    documents = purgeDocuments(db, ids).documents;
    db.prepare(`DELETE FROM folders WHERE id IN (${placeholders})`).run(...folderIds);
  })();
  return { folders: folderIds.size, documents };
}

// Releases rows that still point at a document that no longer exists.
function releaseMissingDocuments(db) {
  const existing = new Set(db.prepare('SELECT id FROM documents').all().map(row => row.id));
  const missing = "SELECT ownerId FROM knowledge_chunks WHERE ownerType = 'document' AND ownerId NOT IN (SELECT id FROM documents)";
  for (const id of [...new Set(db.prepare(missing).all().map(row => row.ownerId))]) removeDocumentChunks(db, id);
  for (const table of ['document_notes', 'document_analyses', 'pending_suggestions']) {
    if (hasTable(db, table)) db.prepare(`DELETE FROM ${table} WHERE documentId NOT IN (SELECT id FROM documents)`).run();
  }
  const rows = db.prepare(`
    SELECT id, loreDocumentId, data FROM entities
    WHERE loreDocumentId IS NOT NULL OR data LIKE '%loreDocumentIds%' OR data LIKE '%"chapters"%'
  `).all();
  const update = db.prepare('UPDATE entities SET loreDocumentId = ?, data = ? WHERE id = ?');
  for (const row of rows) {
    const data = parseJson(row.data, {});
    let gone = [];
    if (Array.isArray(data.loreDocumentIds)) gone = data.loreDocumentIds.filter(id => !existing.has(id));
    if (row.loreDocumentId && !existing.has(row.loreDocumentId)) gone.push(row.loreDocumentId);
    for (const chapter of data._enrichPending?.chapters || []) if (chapter && !existing.has(chapter.id)) gone.push(chapter.id);
    if (!gone.length) continue;
    const before = JSON.stringify(data);
    let next = { loreDocumentId: row.loreDocumentId, data };
    for (const id of new Set(gone)) next = withoutDocument(next, id);
    if (next.loreDocumentId !== row.loreDocumentId || JSON.stringify(next.data) !== before) {
      update.run(next.loreDocumentId, JSON.stringify(next.data), row.id);
    }
  }
}

module.exports = { DOCUMENT_REFERENCE_COLUMNS, purgeDocuments, purgeFolder, releaseMissingDocuments };
