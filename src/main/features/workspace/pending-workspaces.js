// Workspaces still being built. One left here at startup was interrupted and is removed whole.
// Only ids created for the new workspace are ever listed, never the workspace it was made from.

const KEY = 'pending_workspaces';

function readPending(db) {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(KEY);
  try {
    const list = row ? JSON.parse(row.value) : [];
    return Array.isArray(list) ? list.filter(entry => entry && typeof entry.id === 'string') : [];
  } catch {
    return [];
  }
}

function writePending(db, list) {
  if (list.length) db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run(KEY, JSON.stringify(list));
  else db.prepare('DELETE FROM settings WHERE key = ?').run(KEY);
}

/** Call in the same transaction that inserts the new workspace's chats row. */
function markPending(db, workspaceId, sourceId = null) {
  if (!workspaceId || workspaceId === sourceId) throw new Error('A new workspace needs its own id.');
  writePending(db, [...readPending(db).filter(entry => entry.id !== workspaceId), { id: workspaceId, sourceId, startedAt: Date.now() }]);
}

function clearPending(db, workspaceId) {
  writePending(db, readPending(db).filter(entry => entry.id !== workspaceId));
}

function pendingIds(db) {
  return new Set(readPending(db).map(entry => entry.id));
}

/** Removes every interrupted workspace. A listed id that some entry names as its source is kept. */
function purgeUnfinished(db, { purgeWorkspace, removeFolder = () => {} }) {
  const list = readPending(db);
  const sources = new Set(list.map(entry => entry.sourceId).filter(Boolean));
  const removed = [];
  for (const entry of list) {
    if (sources.has(entry.id)) continue;
    purgeWorkspace(entry.id);
    removeFolder(entry.id);
    removed.push(entry.id);
  }
  writePending(db, []);
  return removed;
}

module.exports = { markPending, clearPending, pendingIds, purgeUnfinished };
