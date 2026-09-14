// Pure helpers for the retrieval planner: what counts as the same query, which entities the
// agent is shown, what it is told it already covered, and whether it should run at all.

const { buildNameIndex, findLiteralMentions } = require('../world-index/literal-mentions');

// Short tokens are the particles every language repeats ("de", "the"), and they are already
// below the FTS term floor, so dropping them makes "o fogo do dragao" and "dragao fogo" one query.
const QUERY_TERM_MIN_LENGTH = 3;

// Entities listed for the agent. Past this the prompt costs more than it steers.
const WORLD_MAP_LIMIT = 60;

// A message shorter than this in words and characters, with no name and no question mark,
// has nothing for a planner to research. Scripts written without spaces say as much in far
// fewer characters and have no word count worth reading, so they get their own floor.
const PLANNER_MIN_WORDS = 12;
const PLANNER_MIN_CHARS = 60;
const PLANNER_MIN_DENSE_CHARS = 24;
const UNSPACED = /[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Thai}\p{scx=Lao}\p{scx=Khmer}\p{scx=Myanmar}\p{scx=Tibetan}]/u;

// Written by code point: the Greek question mark looks exactly like a semicolon.
const QUESTION_MARK = /[?\u00BF\uFF1F\u061F\u037E\u055E\u1367]/u;

// How one planner request divides its model's context window. The shares leave room for the
// fixed instructions and one turn of results even on the smallest window a workspace allows.
const PLANNER_OUTPUT_SHARE = 0.2;
const PLANNER_HISTORY_SHARE = 0.2;
const PLANNER_SEED_PREVIEW_SHARE = 0.1;
const PLANNER_MIN_OUTPUT_TOKENS = 512;
const PLANNER_MAX_OUTPUT_TOKENS = 4000;
const PLANNER_MAX_HISTORY_TOKENS = 6000;
const WINDOW_TOKENS_PER_LISTED_ENTITY = 200;
const MIN_WORLD_MAP_ENTRIES = 10;

function plannerWindowShape(limit) {
  const window = Math.max(0, Math.floor(Number(limit) || 0));
  return {
    outputTokens: Math.min(PLANNER_MAX_OUTPUT_TOKENS, Math.max(PLANNER_MIN_OUTPUT_TOKENS, Math.floor(window * PLANNER_OUTPUT_SHARE))),
    historyTokens: Math.min(PLANNER_MAX_HISTORY_TOKENS, Math.floor(window * PLANNER_HISTORY_SHARE)),
    seedPreviewTokens: Math.floor(window * PLANNER_SEED_PREVIEW_SHARE),
    worldMapLimit: Math.min(WORLD_MAP_LIMIT, Math.max(MIN_WORLD_MAP_ENTRIES, Math.floor(window / WINDOW_TOKENS_PER_LISTED_ENTITY)))
  };
}

// Oldest turns collapse first and the newest last. Rewriting a turn invalidates every
// provider's prefix reuse from that point on, so it happens only when the window demands it.
function downgradeUntilFits(steps, fits) {
  if (fits()) return true;
  for (const step of steps || []) {
    if (step.downgraded) continue;
    step.downgraded = true;
    if (fits()) return true;
  }
  return false;
}

function queryTerms(text) {
  return String(text || '')
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(term => term.length >= QUERY_TERM_MIN_LENGTH);
}

// Order-insensitive so a reworded repeat collapses onto the query already executed.
function normalizeQuery(text) {
  const terms = queryTerms(text);
  if (!terms.length) return String(text || '').toLowerCase().replace(/\s+/g, ' ').trim();
  return [...new Set(terms)].sort().join(' ');
}

function queryKey(tool, arg) {
  return `${String(tool || '').toLowerCase()}:${normalizeQuery(arg)}`;
}

function countWords(text) {
  return (String(text || '').match(/[\p{L}\p{N}]+/gu) || []).length;
}

// Deterministic gate in front of the planner. Skipping costs at most the multi-hop reach,
// never the context itself: the caller still runs the deterministic retrieval.
function shouldRunPlanner(input, { entityMentions = 0, force = false } = {}) {
  const text = String(input || '').trim();
  if (force) return { plan: true, reason: 'planner forced in settings' };
  if (!text) return { plan: false, reason: 'empty message' };
  if (entityMentions > 0) return { plan: true, reason: `names ${entityMentions} known entity(ies)` };
  if (QUESTION_MARK.test(text)) return { plan: true, reason: 'asks a question' };
  const words = countWords(text);
  const floor = UNSPACED.test(text) ? PLANNER_MIN_DENSE_CHARS : PLANNER_MIN_CHARS;
  if (words >= PLANNER_MIN_WORDS || text.length >= floor) {
    return { plan: true, reason: `substantial message (${words} words, ${text.length} chars)` };
  }
  return { plan: false, reason: `continuation (${words} words, no name, no question)` };
}

function entityMentionIds(text, entities) {
  const list = Array.isArray(entities) ? entities.filter(entity => entity && entity.id) : [];
  if (!list.length || !String(text || '').trim()) return new Set();
  try {
    return new Set(findLiteralMentions(text, buildNameIndex(list)).map(mention => mention.entityId));
  } catch (e) {
    return new Set();
  }
}

// Names written in the request come first, then the ones in play in recent turns. Sorting by
// type and name instead truncates a large world alphabetically, hiding whole types.
function orderKnownEntities(entities, { mentionedIds = new Set(), recentIds = new Set(), limit = WORLD_MAP_LIMIT } = {}) {
  const list = Array.isArray(entities) ? entities.filter(Boolean) : [];
  const rank = entity => (mentionedIds.has(entity.id) ? 0 : recentIds.has(entity.id) ? 1 : 2);
  const ordered = list
    .map((entity, position) => ({ entity, position, rank: rank(entity) }))
    .sort((a, b) => a.rank - b.rank || a.position - b.position)
    .map(item => item.entity);
  return { shown: ordered.slice(0, limit), omitted: Math.max(0, ordered.length - limit) };
}

function worldMapBlock(entities, options = {}) {
  const { shown, omitted } = orderKnownEntities(entities, options);
  if (!shown.length) return '';
  const lines = shown.map(entity => {
    const aka = (entity.aliases && entity.aliases.length) ? ` (aka ${entity.aliases.join(', ')})` : '';
    return `- ${entity.canonicalName} [${entity.type}]${aka}`;
  }).join('\n');
  const tail = omitted > 0
    ? `\n(${omitted} more entities exist; lookup_entity also resolves a name that is not listed here.)`
    : '';
  return `\nKNOWN ENTITIES IN THIS WORLD (use these EXACT names in your queries; prefer lookup_entity to gather everything known about one of them):\n${lines}${tail}\n`;
}

// The agent repeats a query it cannot see it already ran, so the executed ones are listed
// with what they yielded, not only the sources they produced.
function formatCoverage({ entities = [], sources = [], queries = [], items = 0, sourceLimit = 12 } = {}) {
  const list = values => (values.length ? values.join(', ') : '—');
  const covered = `COVERED SO FAR - entities: ${list([...entities])} | sources: ${list([...sources].slice(0, sourceLimit))} | ${items} items`;
  const run = queries.length
    ? `QUERIES ALREADY RUN (do not repeat; ask something different): ${queries.map(q => `${q.tool}("${q.query}") -> ${q.hits} result(s)`).join(' | ')}`
    : 'QUERIES ALREADY RUN: none';
  return `${covered}\n${run}`;
}

module.exports = {
  QUERY_TERM_MIN_LENGTH,
  WORLD_MAP_LIMIT,
  PLANNER_MIN_WORDS,
  PLANNER_MIN_CHARS,
  PLANNER_MIN_DENSE_CHARS,
  plannerWindowShape,
  downgradeUntilFits,
  normalizeQuery,
  queryKey,
  countWords,
  shouldRunPlanner,
  entityMentionIds,
  orderKnownEntities,
  worldMapBlock,
  formatCoverage
};
