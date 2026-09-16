// Finds registered entity names written literally in a chunk. The name in the text
// is its own evidence, so these tags need no model and stay confirmed-only.

const { foldWithMap, foldText, isUpper } = require('./text-fold');

// Scripts written without spaces between words: a name there has no word boundary to check.
const UNSPACED = /[\p{scx=Han}\p{scx=Hiragana}\p{scx=Katakana}\p{scx=Thai}\p{scx=Lao}\p{scx=Khmer}\p{scx=Myanmar}\p{scx=Tibetan}]/u;
const HANGUL = /\p{scx=Hangul}/u;
const WORD = /[\p{L}\p{N}\p{M}]/u;
const MARK = /\p{M}/u;
// Only a real hyphen joins a compound; dashes separate dialogue.
const HYPHEN = /[-‐‑]/;
// Korean attaches particles to the name ("바나비가", "바나비에게서").
const MAX_HANGUL_SUFFIX = 3;
const SENTENCE_END = /[.!?…:;。！？؟।]/u;
const OPENERS = /["'“”‘’«»„([{¡¿\-–—―*_\s]/u;

function nameShape(folded, original) {
  const tokens = folded.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const dense = UNSPACED.test(folded) || HANGUL.test(folded);
  const letters = [...folded].filter(ch => /[\p{L}\p{N}]/u.test(ch)).length;
  const compound = /[\p{L}\p{N}]-[\p{L}\p{N}]/u.test(folded);
  const contentTokens = tokens.filter(token => [...token].length >= 4).length;
  const cased = [...original].some(isUpper);
  return {
    usable: /\p{L}/u.test(folded) && letters >= (dense ? 2 : 3),
    // A single cased word is where names and common nouns collide ("Ordem" / "ordem"),
    // so only there does the casing written in the registry have to match.
    caseSensitive: cased && !compound && contentTokens < 2,
  };
}

// Groups names by their folded form. A form shared by two entities is ambiguous and
// never tagged here; the model decides it from context.
function buildNameIndex(entities) {
  const byForm = new Map();
  for (const entity of Array.isArray(entities) ? entities : []) {
    if (!entity || !entity.id) continue;
    const names = [entity.canonicalName, ...(Array.isArray(entity.aliases) ? entity.aliases : [])];
    for (const raw of names) {
      const original = String(raw || '').trim();
      const mapped = foldWithMap(original);
      if (!mapped.text) continue;
      let entry = byForm.get(mapped.text);
      if (!entry) {
        entry = { form: mapped.text, entities: new Map(), variants: [] };
        byForm.set(mapped.text, entry);
      }
      entry.entities.set(entity.id, { entityId: entity.id, type: entity.type });
      entry.variants.push({ original, upper: mapped.upper, ...nameShape(mapped.text, original) });
    }
  }
  const names = [];
  for (const entry of byForm.values()) {
    const variants = entry.variants.filter(variant => variant.usable);
    if (!variants.length) continue;
    // The least demanding spelling wins: a lowercase alias allows lowercase text.
    const strict = variants.every(variant => variant.caseSensitive);
    const upper = strict
      ? variants.map(variant => variant.upper).reduce((a, b) => a.map((flag, i) => flag && b[i]))
      : null;
    names.push({
      form: entry.form,
      length: entry.form.length,
      entities: [...entry.entities.values()],
      ambiguous: entry.entities.size > 1,
      caseSensitive: strict,
      upper,
    });
  }
  names.sort((a, b) => b.length - a.length);
  return { names };
}

function originalChar(ctx, position) {
  return ctx.source[ctx.starts[position]];
}

function boundaryBefore(ctx, start, form) {
  if (start === 0) return true;
  const prev = ctx.text[start - 1];
  if (MARK.test(form[0])) return false;
  if (UNSPACED.test(prev) || UNSPACED.test(form[0])) return true;
  if (WORD.test(prev)) return false;
  return !(HYPHEN.test(originalChar(ctx, start - 1)) && start >= 2 && WORD.test(ctx.text[start - 2]));
}

function boundaryAfter(ctx, end, form) {
  const text = ctx.text;
  if (end >= text.length) return true;
  const next = text[end];
  if (MARK.test(next)) return false;
  const last = form[form.length - 1];
  if (UNSPACED.test(next) || UNSPACED.test(last)) return true;
  if (HANGUL.test(last) && HANGUL.test(next)) {
    let stop = end;
    while (stop < text.length && HANGUL.test(text[stop])) stop++;
    return stop - end <= MAX_HANGUL_SUFFIX && !WORD.test(text[stop] || '');
  }
  if (WORD.test(next)) return false;
  return !(HYPHEN.test(originalChar(ctx, end)) && WORD.test(text[end + 1] || ''));
}

function atSentenceStart(source, index) {
  let i = index - 1;
  while (i >= 0 && OPENERS.test(source[i])) {
    if (source[i] === '\n') return true;
    i--;
  }
  return i < 0 || SENTENCE_END.test(source[i]);
}

// Lowercase words seen in the texts, folded. A capitalized word that is also used in
// lowercase is only trusted as a name away from the start of a sentence.
function collectLowercaseWords(texts) {
  const words = new Set();
  for (const text of Array.isArray(texts) ? texts : [texts]) {
    for (const match of String(text || '').matchAll(/[\p{L}\p{M}]+/gu)) {
      const token = match[0];
      if (token !== token.toUpperCase() && ![...token].some(isUpper)) words.add(foldText(token));
    }
  }
  return words;
}

function casingAllows(name, ctx, start, lowercaseWords) {
  if (!name.caseSensitive) return true;
  for (let i = 0; i < name.upper.length; i++) {
    if (name.upper[i] && !ctx.upper[start + i]) return false;
  }
  const onlyInitial = name.upper.every((flag, i) => !flag || i === 0);
  return !(onlyInitial && lowercaseWords && lowercaseWords.has(name.form) && atSentenceStart(ctx.source, ctx.starts[start]));
}

// Longest names first. A shorter name inside a longer one is a fragment ("Harbor" in
// "Harbor Gate") unless it names another kind of thing ("Ivo" in "Forge of Ivo").
function findLiteralMentions(text, index, { lowercaseWords = null } = {}) {
  const source = String(text == null ? '' : text);
  const ctx = { source, ...foldWithMap(source) };
  if (!ctx.text || !index || !index.names) return [];
  const accepted = [];
  const mentions = [];
  for (const name of index.names) {
    for (let start = ctx.text.indexOf(name.form); start !== -1; start = ctx.text.indexOf(name.form, start + 1)) {
      const end = start + name.length;
      if (!boundaryBefore(ctx, start, name.form) || !boundaryAfter(ctx, end, name.form)) continue;
      if (!casingAllows(name, ctx, start, lowercaseWords)) continue;
      const containers = accepted.filter(span => span.start <= start && span.end >= end);
      if (accepted.some(span => span.start < end && start < span.end && !containers.includes(span))) continue;
      const { entityId, type } = name.entities[0];
      if (containers.some(span => span.ambiguous || name.ambiguous || span.types.has(type) || span.ids.has(entityId))) continue;
      accepted.push({ start, end, ambiguous: name.ambiguous, types: new Set(name.entities.map(e => e.type)), ids: new Set(name.entities.map(e => e.entityId)) });
      if (name.ambiguous) continue;
      const from = ctx.starts[start];
      const to = ctx.ends[end - 1];
      mentions.push({ entityId, type, surface: source.slice(from, to), index: from, end: to });
    }
  }
  return mentions.sort((a, b) => a.index - b.index);
}

// One entry per entity, keeping its first occurrence.
function literalEntityMentions(text, index, options) {
  const seen = new Map();
  for (const mention of findLiteralMentions(text, index, options)) {
    if (!seen.has(mention.entityId)) seen.set(mention.entityId, mention);
  }
  return [...seen.values()];
}

const TOKEN = /[\p{L}\p{N}\p{M}]+/gu;
// Letters a declension, a plural or an attached particle may add to a single-word name.
const MAX_SUFFIX = 3;
const MAX_PREFIX = 2;

function affixIndex(index) {
  if (index.affix) return index.affix;
  const byStart = new Map();
  const byEnd = new Map();
  for (const name of index.names) {
    const letters = [...name.form];
    if (letters.length < 4 || /[\s-]/.test(name.form) || UNSPACED.test(name.form)) continue;
    const start = letters.slice(0, 3).join('');
    const end = letters.slice(-3).join('');
    if (!byStart.has(start)) byStart.set(start, []);
    if (!byEnd.has(end)) byEnd.set(end, []);
    byStart.get(start).push(name);
    byEnd.get(end).push(name);
  }
  index.affix = { byStart, byEnd };
  return index.affix;
}

// Hints only: other forms of a name, shared names, or untagged sentence starts.
// Nothing here becomes a tag without the model confirming it.
function findCandidateMentions(text, index, { lowercaseWords = null, exclude = null } = {}) {
  const source = String(text == null ? '' : text);
  if (!source || !index || !index.names) return [];
  const tagged = new Set(findLiteralMentions(source, index, { lowercaseWords }).map(mention => mention.entityId));
  const open = entities => entities.filter(entity => !tagged.has(entity.entityId) && !(exclude && exclude.has(entity.entityId)));
  const found = new Map();
  const add = (surface, entities) => {
    const list = open(entities);
    if (!list.length) return;
    const entry = found.get(surface) || { surface, entities: [] };
    for (const entity of list) if (!entry.entities.some(e => e.entityId === entity.entityId)) entry.entities.push(entity);
    found.set(surface, entry);
  };

  const ctx = { source, ...foldWithMap(source) };
  for (const name of index.names) {
    if (!name.ambiguous) continue;
    for (let start = ctx.text.indexOf(name.form); start !== -1; start = ctx.text.indexOf(name.form, start + 1)) {
      if (boundaryBefore(ctx, start, name.form) && boundaryAfter(ctx, start + name.length, name.form)) {
        add(source.slice(ctx.starts[start], ctx.ends[start + name.length - 1]), name.entities);
        break;
      }
    }
  }

  // A name of several words with one of them in another form ("Ордена Зари" for "Орден Зари").
  const words = [...source.matchAll(TOKEN)].map(match => ({ surface: match[0], form: foldText(match[0]), index: match.index }));
  for (const name of index.names) {
    if (name.ambiguous || !name.form.includes(' ') || UNSPACED.test(name.form)) continue;
    const parts = name.form.split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean);
    if (parts.length < 2) continue;
    for (let at = 0; at + parts.length <= words.length; at++) {
      const window = words.slice(at, at + parts.length);
      let changed = 0;
      const fits = parts.every((part, i) => {
        const word = window[i].form;
        if (word === part) return true;
        const letters = [...part];
        const extra = [...word].length - letters.length;
        const ok = letters.length >= 4 && extra >= -1 && extra <= MAX_SUFFIX && word.startsWith(letters.slice(0, -1).join(''));
        if (ok) changed++;
        return ok;
      });
      if (fits && changed) add(source.slice(window[0].index, window[window.length - 1].index + window[window.length - 1].surface.length), name.entities);
    }
  }

  const { byStart, byEnd } = affixIndex(index);
  for (const match of source.matchAll(TOKEN)) {
    const surface = match[0];
    const form = foldText(surface);
    const letters = [...form];
    if (letters.length < 3) continue;
    const capitalized = isUpper([...surface][0]);
    const names = new Set([...(byStart.get(letters.slice(0, 3).join('')) || []), ...(byEnd.get(letters.slice(-3).join('')) || [])]);
    for (const name of names) {
      if (name.ambiguous) continue;
      if (name.caseSensitive && !capitalized) continue;
      const nameLetters = [...name.form];
      const extra = letters.length - nameLetters.length;
      if (form === name.form) {
        if (lowercaseWords && lowercaseWords.has(form) && atSentenceStart(source, match.index)) add(surface, name.entities);
        continue;
      }
      const inflected = extra >= -1 && extra <= MAX_SUFFIX && form.startsWith(nameLetters.slice(0, -1).join(''));
      const prefixed = extra > 0 && extra <= MAX_PREFIX && form.endsWith(name.form);
      if (inflected || prefixed) add(surface, name.entities);
    }
  }
  return [...found.values()];
}

// The sentence around a mention, at most `limit` characters, stored as the tag's evidence.
function mentionExcerpt(text, mention, limit = 160) {
  const source = String(text || '');
  const stop = ch => SENTENCE_END.test(ch) || ch === '\n';
  let start = mention.index;
  while (start > 0 && !stop(source[start - 1]) && mention.index - start < limit / 2) start--;
  let end = mention.end;
  while (end < source.length && !stop(source[end]) && end - start < limit) end++;
  if (end < source.length && SENTENCE_END.test(source[end])) end++;
  return source.slice(start, end).replace(/\s+/g, ' ').trim();
}

module.exports = { buildNameIndex, findLiteralMentions, literalEntityMentions, findCandidateMentions, collectLowercaseWords, mentionExcerpt };
