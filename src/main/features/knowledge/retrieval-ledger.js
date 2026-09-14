// What retrieval already tried in a workspace, across the chat turns of one session.
// In process and short lived on purpose: a remembered "nothing found" must never outlive
// the corpus it was measured on, so indexing clears it and time expires it.

const TTL_MS = 20 * 60 * 1000;
const MAX_QUERIES = 120;
const MAX_ENTITIES = 60;

const workspaces = new Map();

function now() {
  return Date.now();
}

function getWorkspace(workspaceId) {
  if (!workspaceId) return null;
  let entry = workspaces.get(workspaceId);
  if (!entry) {
    entry = { queries: new Map(), entities: new Map() };
    workspaces.set(workspaceId, entry);
  }
  return entry;
}

function prune(entry, at) {
  for (const [key, value] of entry.queries) {
    if (at - value.at > TTL_MS) entry.queries.delete(key);
  }
  for (const [name, time] of entry.entities) {
    if (at - time > TTL_MS) entry.entities.delete(name);
  }
  while (entry.queries.size > MAX_QUERIES) entry.queries.delete(entry.queries.keys().next().value);
  while (entry.entities.size > MAX_ENTITIES) entry.entities.delete(entry.entities.keys().next().value);
}

// Re-recording moves a query to the end of the insertion order, so the cap drops what is stale.
function recordQuery(workspaceId, { key, tool, query, hits = 0 } = {}) {
  const entry = getWorkspace(workspaceId);
  if (!entry || !key) return;
  const at = now();
  entry.queries.delete(key);
  entry.queries.set(key, { tool, query, hits, at });
  prune(entry, at);
}

function recordEntity(workspaceId, canonicalName) {
  const entry = getWorkspace(workspaceId);
  if (!entry || !canonicalName) return;
  const at = now();
  entry.entities.delete(canonicalName);
  entry.entities.set(canonicalName, at);
  prune(entry, at);
}

function recall(workspaceId) {
  const entry = workspaces.get(workspaceId);
  if (!entry) return { queries: [], entities: [] };
  prune(entry, now());
  return {
    queries: [...entry.queries.entries()].map(([key, value]) => ({ key, ...value })),
    entities: [...entry.entities.keys()]
  };
}

// Only a query that found nothing may be answered from the ledger. One that found passages
// has to run again: its results are what fills this turn's context, and they are not stored here.
function emptyQueryKeys(workspaceId) {
  return new Set(recall(workspaceId).queries.filter(query => !query.hits).map(query => query.key));
}

function clear(workspaceId) {
  if (workspaceId) workspaces.delete(workspaceId);
  else workspaces.clear();
}

module.exports = { TTL_MS, MAX_QUERIES, recordQuery, recordEntity, recall, emptyQueryKeys, clear };
