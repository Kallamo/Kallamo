const { estimateTokens } = require('./payload-budget');

// Each message or context item is framed by a few tokens of markup.
const ITEM_OVERHEAD_TOKENS = 4;

// A cut item has to keep enough text to be worth sending.
const MIN_TRUNCATED_ITEM_TOKENS = 200;

const TRUNCATION_MARKER = '\n[...cut to fit the context budget]';

// Retrieval never gets less than this share, so neither side can starve the other.
const RETRIEVAL_GUARANTEED_SHARE = 0.4;

// What one retrieved passage costs once framed and widened to its neighbours. Used only
// to decide how many to ask for; packContextItems is what enforces the budget.
const RETRIEVAL_ITEM_TOKENS = 350;

// Past this, more passages stopped bringing new answers into the context and only cost
// tokens: measured on the annotated set, every question that could be answered already was.
const RETRIEVAL_TOP_K_MAX = 20;

function truncateToTokens(text, maxTokens, estimate = estimateTokens) {
  const source = String(text || '');
  const limit = Math.floor(Number(maxTokens) || 0);
  if (limit <= 0 || !source) return '';
  const total = estimate(source);
  if (total <= limit) return source;

  let length = Math.floor(source.length * (limit / total));
  for (let attempt = 0; attempt < 8 && length > 0; attempt++) {
    let candidate = source.slice(0, length);
    const lastBreak = Math.max(candidate.lastIndexOf('\n'), candidate.lastIndexOf(' '));
    if (lastBreak > length * 0.6) candidate = candidate.slice(0, lastBreak);
    candidate = candidate.trimEnd() + TRUNCATION_MARKER;
    if (estimate(candidate) <= limit) return candidate;
    length = Math.floor(length * 0.85);
  }
  return '';
}

// Ranks by tier, then score, then position; kept items return in original order.
// A truncatable item is cut rather than dropped, capped at maxItemShare.
function packContextItems(items, budgetTokens, { estimate = estimateTokens, maxItemShare = 1 } = {}) {
  const budget = Math.max(0, Math.floor(Number(budgetTokens) || 0));
  const itemCap = Math.floor(budget * Math.min(1, Math.max(0, Number(maxItemShare) || 0)));
  const candidates = (Array.isArray(items) ? items : [])
    .map((item, position) => ({ ...item, position, text: String(item?.text || '') }))
    .filter(item => item.text.trim());
  const ranked = [...candidates].sort((a, b) =>
    (a.tier ?? 1) - (b.tier ?? 1)
    || (Number(b.score) || 0) - (Number(a.score) || 0)
    || a.position - b.position);

  const kept = [];
  let usedTokens = 0;
  let dropped = 0;
  let truncated = 0;
  for (const item of ranked) {
    let text = item.text;
    let cut = false;
    if (item.truncatable) {
      const room = Math.min(budget - usedTokens, itemCap) - ITEM_OVERHEAD_TOKENS;
      if (estimate(text) > room) {
        text = room >= MIN_TRUNCATED_ITEM_TOKENS ? truncateToTokens(text, room, estimate) : '';
        if (!text) {
          dropped++;
          continue;
        }
        cut = true;
      }
    }
    const cost = estimate(text) + ITEM_OVERHEAD_TOKENS;
    if (usedTokens + cost > budget) {
      dropped++;
      continue;
    }
    kept.push(cut ? { ...item, text, tokens: cost, truncated: true } : { ...item, tokens: cost });
    usedTokens += cost;
    if (cut) truncated++;
  }
  kept.sort((a, b) => a.position - b.position);
  return { kept, usedTokens, dropped, truncated, total: candidates.length };
}

// Renders kept items under their section headers, sections in `sectionOrder`.
function renderContextSections(kept, sectionOrder = [], separator = '\n\n') {
  const bySection = new Map();
  for (const item of kept || []) {
    if (!bySection.has(item.section)) bySection.set(item.section, []);
    bySection.get(item.section).push(item.text);
  }
  const order = [...sectionOrder, ...[...bySection.keys()].filter(key => !sectionOrder.includes(key))];
  return order
    .filter(section => bySection.has(section))
    .map(section => `${section}\n${bySection.get(section).join(separator)}`)
    .join(separator);
}

// The configured Top-K is a floor and is never lowered. Retrieval asks for more passages
// only when the budget can hold them, so a small context window keeps the cost it has today.
function retrievalTopK(configuredK, budgetTokens, {
  tiers = 1,
  itemTokens = RETRIEVAL_ITEM_TOKENS,
  max = RETRIEVAL_TOP_K_MAX
} = {}) {
  const configured = Math.max(1, Math.floor(Number(configuredK) || 1));
  const budget = Math.max(0, Math.floor(Number(budgetTokens) || 0));
  const room = Math.floor(budget / Math.max(1, tiers) / Math.max(1, itemTokens));
  return Math.max(configured, Math.min(Math.max(configured, max), room));
}

function splitRetrievalBudget({ availableTokens, historyTokens, share = RETRIEVAL_GUARANTEED_SHARE }) {
  const available = Math.max(0, Math.floor(Number(availableTokens) || 0));
  const history = Math.max(0, Math.floor(Number(historyTokens) || 0));
  return Math.min(available, Math.max(Math.floor(available * share), available - history));
}

// Stops at the first message that doesn't fit, so the window is always contiguous.
function selectRecentWithinBudget(messages, budgetTokens, {
  estimate = estimateTokens,
  overhead = ITEM_OVERHEAD_TOKENS,
  toText = message => message?.content
} = {}) {
  const list = Array.isArray(messages) ? messages : [];
  const budget = Math.max(0, Math.floor(Number(budgetTokens) || 0));
  const selected = [];
  let tokens = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const text = String(toText(list[i]) ?? '');
    const cost = estimate(text) + overhead;
    if (tokens + cost > budget) break;
    selected.unshift({ message: list[i], text });
    tokens += cost;
  }
  return { selected, tokens, dropped: list.length - selected.length };
}

module.exports = {
  ITEM_OVERHEAD_TOKENS,
  RETRIEVAL_GUARANTEED_SHARE,
  RETRIEVAL_ITEM_TOKENS,
  RETRIEVAL_TOP_K_MAX,
  retrievalTopK,
  TRUNCATION_MARKER,
  truncateToTokens,
  packContextItems,
  renderContextSections,
  splitRetrievalBudget,
  selectRecentWithinBudget
};
