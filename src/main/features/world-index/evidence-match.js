// Does an excerpt the tagger returned really come from the chunk it points at?
//
// This check is what keeps tagging confirmed-only: a mention is accepted only
// when its evidence is present in the source text, so the model cannot invent an
// entity and cite nothing. The rule is right; the comparison used to be too
// literal about it. It lowercased and collapsed whitespace and nothing else, so
// a model that retyped a passage instead of copying it byte for byte lost every
// mention in the batch. In practice that meant prose with typographic dashes,
// curly quotes or accents failed wholesale, and the archive was stored untagged.
//
// The normalization below only removes differences that carry no meaning for
// this question. Two texts that differ solely by how a dash or an accent is
// encoded are the same sentence.

const ZERO_WIDTH = /[​-‍﻿]/g;

// Typographic characters a model commonly substitutes when it retypes a quote.
const PUNCTUATION_MAP = new Map([
  ['‐', '-'], ['‑', '-'], ['‒', '-'], ['–', '-'],
  ['—', '-'], ['―', '-'], ['−', '-'],
  // Every quote mark folds to one character. A model that answers with single
  // quotes where the text had double ones is still quoting the text, and an
  // apostrophe inside a word folds the same way on both sides.
  ['“', '"'], ['”', '"'], ['„', '"'], ['‟', '"'],
  ['«', '"'], ['»', '"'],
  ['‘', '"'], ['’', '"'], ['‚', '"'], ['‛', '"'],
  ["'", '"'], ['`', '"'], ['´', '"'],
  ['…', '...']
]);

// Punctuation a quote often picks up at its edges: an ellipsis marking a trim, a
// dash opening a line of dialogue, the quote marks around it.
const EDGE_NOISE = /^[\s"'`.,;:!?()[\]{}<>\-–—…]+|[\s"'`.,;:!?()[\]{}<>\-–—…]+$/g;

function normalizeEvidence(value) {
  const text = String(value == null ? '' : value)
    .normalize('NFC')
    .replace(ZERO_WIDTH, '');

  let mapped = '';
  for (const char of text) mapped += PUNCTUATION_MAP.get(char) ?? char;

  return mapped
    // Decomposing lets the combining accents be dropped, so "é" and "e" compare
    // equal. A model that retypes without accents is still quoting the chunk.
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

// The tagger may answer with one excerpt or with several. Several used to be
// joined into a single string and looked up as one run of text, which could
// never match: the pieces come from different places in the chunk.
function evidenceCandidates(value) {
  const list = Array.isArray(value) ? value : [value];
  return list
    .map(entry => String(entry == null ? '' : entry).trim())
    .filter(Boolean);
}

// The excerpt as the tagger sent it, kept for display and for entity proposals.
function evidenceText(value) {
  const candidates = evidenceCandidates(value);
  return candidates.length ? candidates.join(' ') : '';
}

function matchesChunk(haystack, candidate) {
  const needle = normalizeEvidence(candidate).replace(EDGE_NOISE, '');
  return needle.length >= 2 && haystack.includes(needle);
}

// True when any one of the excerpts is present in the chunk. Requiring all of
// them would punish a model for being more specific than asked.
function chunkContainsEvidence(chunkText, evidence) {
  const haystack = normalizeEvidence(chunkText);
  if (!haystack) return false;
  return evidenceCandidates(evidence).some(candidate => matchesChunk(haystack, candidate));
}

// The excerpt that actually matched, so what gets stored is the part supported by
// the chunk rather than everything the model offered.
function matchedEvidence(chunkText, evidence) {
  const haystack = normalizeEvidence(chunkText);
  if (!haystack) return '';
  return evidenceCandidates(evidence).find(candidate => matchesChunk(haystack, candidate)) || '';
}

module.exports = { normalizeEvidence, evidenceText, evidenceCandidates, chunkContainsEvidence, matchedEvidence };
