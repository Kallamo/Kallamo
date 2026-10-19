// A workspace's knowledge file list changes through named operations applied to the stored list,
// so a renderer holding an older copy cannot bring back a removed file or drop a new one.

const sameName = (left, right) => String(left || '').toLowerCase() === String(right || '').toLowerCase();

function parseFiles(value) {
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/** remove: names; upsert: whole file entries; patch: [{ name, changes }]. Names match without case. */
function applyKnowledgeFileChanges(current, { remove = [], upsert = [], patch = [] } = {}) {
  let files = parseFiles(current).filter(file => !remove.some(name => sameName(name, file.name)));
  for (const entry of upsert) {
    if (!entry || !entry.name) continue;
    const index = files.findIndex(file => sameName(file.name, entry.name));
    if (index >= 0) files[index] = { ...files[index], ...entry };
    else files = [...files, entry];
  }
  for (const { name, changes } of patch) {
    files = files.map(file => (sameName(file.name, name) ? { ...file, ...changes } : file));
  }
  return files;
}

// The renderer never tracks lastIndexedMtime; losing it would force a full re-index of every file.
function carryIndexState(previous, next) {
  const oldByKey = new Map(parseFiles(previous).map(file => [file.internalPath || file.name, file]));
  return parseFiles(next).map(file => {
    const old = oldByKey.get(file.internalPath || file.name);
    return old && old.lastIndexedMtime != null && file.lastIndexedMtime == null
      ? { ...file, lastIndexedMtime: old.lastIndexedMtime }
      : file;
  });
}

function ragIndexSignature(files) {
  return JSON.stringify(parseFiles(files)
    .filter(file => file.strategy === 'rag_search')
    .map(file => ({ name: file.name, internalPath: file.internalPath, lastIndexedMtime: file.lastIndexedMtime ?? null }))
    .sort((left, right) => `${left.internalPath || ''}:${left.name}`.localeCompare(`${right.internalPath || ''}:${right.name}`)));
}

module.exports = { applyKnowledgeFileChanges, carryIndexState, parseFiles, ragIndexSignature };
