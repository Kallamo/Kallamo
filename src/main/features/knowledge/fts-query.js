// FTS5 reads bare words as AND and rejects punctuation, so each word is quoted, joined with OR,
// and restricted to the text column. unicode61 folds accents on both sides.
const MAX_TERMS = 32;
const MIN_TERM_LENGTH = 3;

function buildFtsMatchQuery(text) {
  const seen = new Set();
  const terms = [];
  for (const match of String(text || '').toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
    const term = match[0];
    if (term.length < MIN_TERM_LENGTH || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
    if (terms.length >= MAX_TERMS) break;
  }
  if (!terms.length) return '';
  return `text : (${terms.map(term => `"${term}"`).join(' OR ')})`;
}

module.exports = { buildFtsMatchQuery, MAX_TERMS, MIN_TERM_LENGTH };
