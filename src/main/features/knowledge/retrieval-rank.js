// The ranking core of hybrid search, kept free of database and Electron so the
// evaluation harness can score the exact code the app runs.

const { buildNameIndex, findLiteralMentions } = require('../world-index/literal-mentions');

// Dense is the trusted signal; sparse breaks ties and rescues exact keywords.
const ALPHA_DENSE = 0.7;

// e5 cosines rarely drop below ~0.70, so the strictness dial maps onto this band.
const SIMILARITY_FLOOR_MIN = 0.70;
const SIMILARITY_FLOOR_MAX = 0.88;

// How much of the normal floor a tag-boosted chunk has to clear. Kept as a ratio so
// it follows the user's strictness setting instead of fighting it.
const TAGGED_FLOOR_RATIO = 0.7;

// Small against the ~0.70-0.90 cosine band: reorders without swamping similarity.
// Scaled by how much of the query's rare-name evidence a passage actually carries.
const TAG_BOOST = 0.05;

// A small bonus for recent chunks, so ties in similarity favour the latest scenes.
const LOOKUP_RECENCY_WEIGHT = 0.02;

// Vectors are stored normalized, so the dot product is the cosine.
function calculateSimilarity(vecA, vecB) {
  let dotProduct = 0;
  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
  }
  return dotProduct;
}

// bm25() is negative (lower = better); flip and min-max normalize to match cosine.
function normalizeSparseRanks(rows) {
  const map = new Map();
  const list = Array.isArray(rows) ? rows : [];
  if (!list.length) return map;
  const relevances = list.map(row => -Number(row.rank));
  const minRel = Math.min(...relevances);
  const maxRel = Math.max(...relevances);
  const span = maxRel - minRel;
  list.forEach((row, index) => {
    map.set(row.chunkId, span > 0 ? (relevances[index] - minRel) / span : 1);
  });
  return map;
}

// Unicode-aware whole-word match, so "Ana" doesn't match inside "banana".
function containsWord(queryLower, term) {
  if (!term || term.length < 2) return false;
  const isWord = (ch) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
  let from = 0;
  while (true) {
    const i = queryLower.indexOf(term, from);
    if (i === -1) return false;
    const before = i > 0 ? queryLower[i - 1] : undefined;
    const after = i + term.length < queryLower.length ? queryLower[i + term.length] : undefined;
    if (!isWord(before) && !isWord(after)) return true;
    from = i + 1;
  }
}

// Matches the whole value or any token of 4+ letters, skipping particles like "de".
function queryMentions(queryLower, needleLower) {
  if (!needleLower || needleLower.length < 2) return false;
  if (containsWord(queryLower, needleLower)) return true;
  const tokens = needleLower.split(/[^\p{L}\p{N}]+/u).filter(t => t.length >= 4);
  for (const t of tokens) {
    if (containsWord(queryLower, t)) return true;
  }
  return false;
}

function cosineFloorFor(threshold) {
  return SIMILARITY_FLOOR_MIN + threshold * (SIMILARITY_FLOOR_MAX - SIMILARITY_FLOOR_MIN);
}

// How far a passage's floor drops, given the share of the query's name evidence it
// carries. Full evidence earns the old tagged floor; a name written across half the
// archive earns almost nothing, because it cannot tell two passages apart.
function floorFor(cosineFloor, evidence) {
  return cosineFloor - cosineFloor * (1 - TAGGED_FLOOR_RATIO) * Math.min(1, Math.max(0, evidence));
}

// The single fusion path for single-owner, multi-owner and in-memory searches.
// `evidenceMap` holds, per chunk, a 0..1 share of the entity evidence the query names.
function fuseAndRank(queryVector, candidates, sparseNormMap, threshold = 0.3, k = 5, evidenceMap = null) {
  const cosineFloor = cosineFloorFor(threshold);

  const fusedResults = [];
  for (const cand of candidates) {
    const vector = cand.vector || [];
    const cosine = vector.length === queryVector.length
      ? calculateSimilarity(queryVector, vector)
      : 0;
    const sparseNorm = (sparseNormMap && sparseNormMap.get(cand.id)) || 0;
    const evidence = (evidenceMap && evidenceMap.get(cand.id)) || 0;
    const fusionScore = ALPHA_DENSE * cosine + (1 - ALPHA_DENSE) * sparseNorm + TAG_BOOST * evidence;
    fusedResults.push({
      id: cand.id,
      source: cand.source,
      text: cand.text,
      createdAt: cand.createdAt,
      memoryBlockId: cand.memoryBlockId,
      denseScore: cosine,
      sparseScore: sparseNorm,
      score: cosine,
      fusionScore,
      evidence,
      tagBoosted: evidence > 0,
      floor: floorFor(cosineFloor, evidence)
    });
  }

  return fusedResults
    .filter(r => r.denseScore >= r.floor)
    .sort((a, b) => b.fusionScore - a.fusionScore)
    .slice(0, k);
}

// Tag rows carry either a registry entity (match its name and aliases) or a literal
// tag from before the registry existed.
function tagNeedles(row) {
  if (row.canonicalName) {
    const needles = [row.canonicalName];
    try {
      const parsed = JSON.parse(row.aliases);
      if (Array.isArray(parsed)) needles.push(...parsed);
    } catch (e) { }
    return needles;
  }
  return [row.entity || row.tag || ''];
}

function parseAliases(raw) {
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(Boolean).map(String) : [];
  } catch (e) {
    return [];
  }
}

// Collapses tag rows into the entities they point at, with the passages each one covers.
function entitiesFromTagRows(tagRows) {
  const entities = new Map();
  for (const row of tagRows || []) {
    const id = row.entity || row.tag;
    if (!id || !row.chunkId) continue;
    let entity = entities.get(id);
    if (!entity) {
      entity = {
        id,
        type: row.type || row.tag || 'entity',
        canonicalName: row.canonicalName || row.entity || row.tag || '',
        aliases: row.canonicalName ? parseAliases(row.aliases) : [],
        chunks: new Set()
      };
      entities.set(id, entity);
    }
    entity.chunks.add(row.chunkId);
  }
  return entities;
}

// The Tagger's matcher decides which names the query writes, so boundaries hold in every
// script, including the ones written without spaces. The query is the user's own words,
// so each name is also registered in lower case and casing never blocks a match.
function buildQueryNameIndex(entities) {
  return buildNameIndex([...entities].map(entity => {
    const written = [entity.canonicalName, ...entity.aliases].filter(Boolean);
    return {
      id: entity.id,
      type: entity.type,
      canonicalName: entity.canonicalName,
      aliases: [...entity.aliases, ...written.map(name => String(name).toLowerCase())]
    };
  }));
}

// Per chunk, the share of the query's name evidence it carries, between 0 and 1.
// A name written across a third of the archive says almost nothing about which passage
// answers the question, so it weighs almost nothing; a name written in five passages
// weighs a lot. With names tagged everywhere, this is what still discriminates.
function buildEntityEvidenceMap(queryText, tagRows, { totalChunks = 0 } = {}) {
  const evidence = new Map();
  if (!String(queryText || '').trim()) return evidence;
  const entities = entitiesFromTagRows(tagRows);
  if (!entities.size) return evidence;

  const named = new Set(findLiteralMentions(queryText, buildQueryNameIndex(entities.values())).map(m => m.entityId));
  if (!named.size) return evidence;

  const taggedChunks = new Set((tagRows || []).map(row => row.chunkId)).size;
  const total = Math.max(totalChunks, taggedChunks, 1);
  const weights = new Map();
  let totalWeight = 0;
  for (const id of named) {
    const entity = entities.get(id);
    if (!entity) continue;
    const weight = Math.log(1 + total / Math.max(1, entity.chunks.size));
    weights.set(id, weight);
    totalWeight += weight;
  }
  if (!totalWeight) return evidence;

  for (const [id, weight] of weights) {
    for (const chunkId of entities.get(id).chunks) {
      evidence.set(chunkId, (evidence.get(chunkId) || 0) + weight / totalWeight);
    }
  }
  return evidence;
}

// Ranks the passages an entity lookup found: similarity to the request, plus a recency
// nudge, or newest first when the request could not be embedded. Adding the request's
// keywords here was measured and rejected: it lifts the rank of answers that carry the
// entity by name, but packs the capped list into fewer scenes, and scene expansion is
// what reaches the passages where the entity acts without being named.
function rankLookupChunks(rows, queryVector, vectorOf) {
  const list = Array.isArray(rows) ? rows : [];
  if (!Array.isArray(queryVector) || !queryVector.length) {
    return [...list]
      .map(row => ({ ...row, score: 0 }))
      .sort((a, b) => (Number(b.createdAt) || 0) - (Number(a.createdAt) || 0));
  }
  const times = list.map(row => Number(row.createdAt) || 0);
  const newest = times.reduce((max, t) => Math.max(max, t), 0);
  const oldest = times.reduce((min, t) => Math.min(min, t), newest);
  return list.map(row => {
    const vector = vectorOf(row.id);
    const cosine = vector && vector.length === queryVector.length ? calculateSimilarity(queryVector, vector) : 0;
    const recency = newest > oldest ? ((Number(row.createdAt) || 0) - oldest) / (newest - oldest) : 0;
    return { ...row, score: cosine + LOOKUP_RECENCY_WEIGHT * recency };
  }).sort((a, b) => b.score - a.score);
}

module.exports = {
  ALPHA_DENSE,
  SIMILARITY_FLOOR_MIN,
  SIMILARITY_FLOOR_MAX,
  TAGGED_FLOOR_RATIO,
  TAG_BOOST,
  LOOKUP_RECENCY_WEIGHT,
  calculateSimilarity,
  normalizeSparseRanks,
  containsWord,
  queryMentions,
  cosineFloorFor,
  floorFor,
  fuseAndRank,
  tagNeedles,
  buildQueryNameIndex,
  buildEntityEvidenceMap,
  rankLookupChunks
};
