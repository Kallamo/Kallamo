// Evidence must appear in the chunk, which keeps tagging confirmed-only.
// Normalization only drops differences with no meaning here: dashes, quotes, accents, spacing.

const ZERO_WIDTH = /[​-‍﻿]/g;

// Typographic characters a model commonly substitutes when it retypes a quote.
const PUNCTUATION_MAP = new Map([
  ['‐', '-'], ['‑', '-'], ['‒', '-'], ['–', '-'],
  ['—', '-'], ['―', '-'], ['−', '-'],
  // All quote marks fold to one character, on both sides.
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

// Several excerpts are matched separately: they come from different places in the chunk.
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
