// FTS5 reads bare words as AND and rejects punctuation, so each word is quoted, joined with OR,
// and restricted to the text column. unicode61 folds accents on both sides.
const MAX_TERMS = 32;
const MIN_TERM_LENGTH = 3;

// A question rarely spells a word the way the passage does ("abriria" against "abrir"),
// and unicode61 has no stemmer for any language, so every long enough word also matches
// as a prefix of itself. Shape decides, never a word list: too short a prefix matches
// everything, and an unspaced script hands the tokenizer one very long run.
const PREFIX_MIN_LENGTH = 5;
const PREFIX_MAX_LENGTH = 24;
const PREFIX_TRIM = 2;

function buildFtsMatchQuery(text) {
  const seen = new Set();
  const terms = [];
  const prefixes = [];
  for (const match of String(text || '').toLowerCase().matchAll(/[\p{L}\p{N}]+/gu)) {
    const term = match[0];
    if (term.length < MIN_TERM_LENGTH || seen.has(term)) continue;
    seen.add(term);
    terms.push(term);
    if (term.length >= PREFIX_MIN_LENGTH && term.length <= PREFIX_MAX_LENGTH) {
      prefixes.push(term.slice(0, term.length - PREFIX_TRIM));
    }
    if (terms.length >= MAX_TERMS) break;
  }
  if (!terms.length) return '';
  // A prefix already written out as its own word adds nothing.
  const clauses = terms.map(term => `"${term}"`);
  for (const prefix of new Set(prefixes)) {
    if (!seen.has(prefix)) clauses.push(`"${prefix}"*`);
  }
  return `text : (${clauses.join(' OR ')})`;
}

module.exports = { buildFtsMatchQuery, MAX_TERMS, MIN_TERM_LENGTH, PREFIX_MIN_LENGTH, PREFIX_MAX_LENGTH, PREFIX_TRIM };
