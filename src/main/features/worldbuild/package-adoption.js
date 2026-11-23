const { exportAuthoredKnowledge, exportAuthoredFacts } = require('./knowledge-package');
const { exportItemTexts } = require('./in-world-texts');
const { recordImport } = require('./package-identity');
const { storyCreatedEntities } = require('../workspace/new-story');

// Only origin and uid rows are added; the world is untouched. A part with no single sure match gets
// no uid, so a later version treats it as this world's own.

const HEADER = new Set(['kallamoWorldbuild', 'exportedAt', 'packageId', 'packageVersion', 'packageHash']);
const fold = value => String(value ?? '').normalize('NFKC').trim().toLowerCase();
const hasTable = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
const parseJson = (text, fallback) => { try { return JSON.parse(text); } catch { return fallback; } };

/** Every name an entity has gone by here: its name, its aliases, and what a story rename replaced. */
function localEntities(db, workspaceId) {
  const madeInPlay = storyCreatedEntities(db, workspaceId);
  const entities = new Map(db.prepare("SELECT id, type, canonicalName, aliases FROM entities WHERE workspaceId = ? AND status != 'proposed'")
    .all(workspaceId)
    .filter(row => !madeInPlay.has(row.id))
    .map(row => [row.id, { id: row.id, type: row.type, names: new Set([row.canonicalName, ...parseJson(row.aliases, [])].map(fold).filter(Boolean)) }]));
  if (hasTable(db, 'roleplay_entity_changes')) {
    for (const row of db.prepare("SELECT entity_id, payload_json FROM roleplay_entity_changes WHERE workspace_id = ? AND status = 'applied' AND entity_id IS NOT NULL").all(workspaceId)) {
      const update = parseJson(row.payload_json, {})?.identityUpdate;
      const entity = entities.get(row.entity_id);
      if (!update || !entity) continue;
      for (const name of [update.previousCanonicalName, ...(update.previousAliases || [])]) if (fold(name)) entity.names.add(fold(name));
    }
  }
  return [...entities.values()];
}

// A match holds only when each side has exactly one candidate on the other.
function uniquePairs(packaged, local) {
  const claims = new Map();
  for (const ids of packaged.values()) for (const id of ids) claims.set(id, (claims.get(id) || 0) + 1);
  const pairs = new Map();
  for (const [ref, ids] of packaged) if (ids.length === 1 && claims.get(ids[0]) === 1 && local.has(ids[0])) pairs.set(ref, ids[0]);
  return pairs;
}

function matchEntities(db, workspaceId, payload) {
  const locals = localEntities(db, workspaceId);
  const candidates = new Map((payload.entities || []).filter(entity => entity?.ref).map(entity => [
    entity.ref,
    locals.filter(local => local.type === entity.type && local.names.has(fold(entity.canonicalName))).map(local => local.id),
  ]));
  return uniquePairs(candidates, new Set(locals.map(local => local.id)));
}

/** Pairs packaged records with local ones whose signature is the same and unique on both sides. */
function matchBySignature(packaged, local, signature) {
  const index = (list) => {
    const bySignature = new Map();
    for (const record of list) {
      const key = signature(record);
      if (key == null) continue;
      bySignature.set(key, bySignature.has(key) ? null : record.ref);
    }
    return bySignature;
  };
  const mine = index(local);
  const pairs = new Map();
  for (const [key, ref] of index(packaged)) {
    const localRef = mine.get(key);
    if (ref && localRef) pairs.set(ref, localRef);
  }
  return pairs;
}

/** The package as this world received it: parts added after it was imported, and missing here, are left out. */
function receivedBase(payload, entityPairs, addedLater) {
  const later = new Set(addedLater.map(entry => `${entry.type}|${entry.name}`));
  const dropped = (payload.entities || [])
    .filter(entity => later.has(`${entity.type}|${entity.canonicalName}`) && !entityPairs.has(entity.ref))
    .map(entity => entity.ref);
  if (!dropped.length) return payload;
  const mentions = record => { const text = JSON.stringify(record); return dropped.some(ref => text.includes(ref)); };
  const keep = list => list.filter(record => !mentions(record));
  return Object.fromEntries(Object.entries(payload).map(([key, value]) => {
    if (HEADER.has(key)) return [key, value];
    if (Array.isArray(value)) return [key, keep(value)];
    if (value && typeof value === 'object') {
      return [key, Object.fromEntries(Object.entries(value).map(([part, inner]) => [part, Array.isArray(inner) ? keep(inner) : inner]))];
    }
    return [key, value];
  }));
}

/**
 * payload: the package with its identity. addedLater: [{ type, name }] for entities the package gained
 * after earlier copies of it were imported. Returns null when there is nothing to adopt.
 */
function adoptPackageOrigin({ db, worldbuildData, workspaceId, payload, addedLater = [], now = Date.now() }) {
  if (typeof payload?.packageId !== 'string' || !payload.packageId) return null;
  const adopted = db.prepare('SELECT 1 FROM worldbuild_package_origins WHERE workspace_id = ? AND package_id = ?').get(workspaceId, payload.packageId);
  if (adopted) return null;

  const entities = matchEntities(db, workspaceId, payload);
  const localIds = db.prepare("SELECT id FROM entities WHERE workspaceId = ? AND status != 'proposed'").all(workspaceId).map(row => row.id);
  const mapped = ref => entities.get(ref) || null;

  const knowledge = matchBySignature(
    (payload.knowledge?.entries || []).map(entry => ({ ...entry, subjectRef: mapped(entry.subjectRef), aboutRef: entry.aboutRef ? mapped(entry.aboutRef) : null, missing: !mapped(entry.subjectRef) || (entry.aboutRef && !mapped(entry.aboutRef)) })),
    exportAuthoredKnowledge({ db, worldbuildData, workspaceId, entityIds: localIds }).entries,
    entry => (entry.missing ? null : JSON.stringify([entry.kind, entry.subjectRef, entry.aboutRef || null, entry.statement ?? entry.summary ?? ''])),
  );
  const facts = matchBySignature(
    payload.facts?.entries || [],
    exportAuthoredFacts({ worldbuildData, workspaceId, entityIds: localIds }).entries,
    fact => JSON.stringify([fact.title, fact.statement]),
  );
  const texts = matchBySignature(
    (payload.texts || []).map(text => ({ ...text, itemRef: mapped(text.itemRef) })),
    exportItemTexts(db, workspaceId, localIds),
    text => (text.itemRef ? JSON.stringify([text.itemRef, text.ordinal ?? 0, text.title]) : null),
  );

  const base = receivedBase(payload, entities, addedLater);
  const { importId } = recordImport(db, workspaceId, base, { entities, knowledge, facts, texts }, now);
  return {
    importId,
    entities: entities.size, knowledge: knowledge.size, facts: facts.size, texts: texts.size,
    packaged: {
      entities: (base.entities || []).length, knowledge: (base.knowledge?.entries || []).length,
      facts: (base.facts?.entries || []).length, texts: (base.texts || []).length,
    },
  };
}

module.exports = { adoptPackageOrigin };
