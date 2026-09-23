// Whether a name looks like a proper name, from signals that hold in any language:
// its shape in the text, letter case where the script has it, and the other names around it.

const { buildNameIndex, findLiteralMentions, collectLowercaseWords } = require('./literal-mentions');
const { foldText, foldWithMap, isUpper } = require('./text-fold');

const CANDIDATE = '\u0000candidate';
const WORD = /[\p{L}\p{N}\p{M}]/u;

const tokensOf = value => String(value || '').split(/[^\p{L}\p{N}\p{M}]+/u).filter(Boolean);
const hasCase = value => [...String(value || '')].some(ch => ch.toLowerCase() !== ch.toUpperCase());

// Scripts without letter case give no signal here, so they pass.
function looksLikeName(surface, type, proposalKind) {
  const text = String(surface || '').trim();
  if (!/\p{L}/u.test(text)) return false;
  if (!hasCase(text)) return true;
  // Hyphenated compounds count as one word. The head is the first long word, past
  // particles and articles like "van", "o" or "Os".
  const words = text.split(/[^\p{L}\p{N}\p{M}'’-]+/u).filter(word => /\p{L}/u.test(word));
  const head = words.find(word => [...word.replace(/[-'’]/g, '')].length >= 4) || words[0];
  if (head && isUpper([...head][0])) return true;
  return type === 'Items' && proposalKind === 'world_specific_type' && tokensOf(text).length >= 2;
}

// A new entity is proposed only when its name stands on its own in the chunk: not a number,
// not a piece of a longer known or sibling name, and not a common word by its case.
function checkProposal({ value, surface = '', type, proposalKind = 'named', chunkText, entities = [], siblings = [], lowercaseWords = null }) {
  const names = [...new Set([value, surface].map(name => String(name || '').trim()).filter(Boolean))];
  if (!names.some(name => /\p{L}/u.test(name))) return { ok: false, reason: 'no-letters' };
  // A single word the workspace also writes in lowercase is a common word there, whatever its case here.
  if (lowercaseWords && names.some(name => !/[\s-]/u.test(name) && lowercaseWords.has(foldText(name)))) return { ok: false, reason: 'common-word' };
  const own = new Set(names.map(foldText));
  const others = siblings
    .filter(sibling => sibling && sibling.value && !own.has(foldText(sibling.value)))
    .map((sibling, index) => ({ id: `\u0000sibling${index}`, type: sibling.type, canonicalName: sibling.value }));
  const index = buildNameIndex([...entities, ...others, { id: CANDIDATE, type, canonicalName: names[0], aliases: names.slice(1) }]);
  const found = findLiteralMentions(chunkText, index, { lowercaseWords }).filter(mention => mention.entityId === CANDIDATE);
  if (!found.length) return { ok: false, reason: 'not-standalone' };
  // No lowercase exception for new proposals: it let ordinary objects through as "materials".
  if (!found.some(mention => looksLikeName(mention.surface, type, 'named'))) return { ok: false, reason: 'common-word' };
  return { ok: true, reason: null };
}

function countLoose(foldedTexts, form) {
  if (!form) return 0;
  let count = 0;
  for (const text of foldedTexts) {
    for (let at = text.indexOf(form); at !== -1; at = text.indexOf(form, at + 1)) {
      if (!WORD.test(text[at - 1] || '') && !WORD.test(text[at + form.length] || '')) count++;
    }
  }
  return count;
}

function containsWord(haystack, needle) {
  return haystack !== needle && countLoose([haystack], needle) > 0;
}

// Occurrences of `form` that sit inside an occurrence of the longer name `container`.
function countInside(foldedTexts, form, container) {
  let inside = 0;
  for (const text of foldedTexts) {
    const spans = [];
    for (let at = text.indexOf(container); at !== -1; at = text.indexOf(container, at + 1)) spans.push([at, at + container.length]);
    if (!spans.length) continue;
    for (let at = text.indexOf(form); at !== -1; at = text.indexOf(form, at + 1)) {
      if (spans.some(([start, end]) => start <= at && at + form.length <= end)) inside++;
    }
  }
  return inside;
}

// A name written on its own at most this share of the time is taken for a piece of the longer one.
const FRAGMENT_SHARE = 0.2;

function readData(entity) {
  if (entity.data && typeof entity.data === 'object') return entity.data;
  try { return JSON.parse(entity.data || '{}') || {}; } catch { return {}; }
}

const contentKey = name => {
  const tokens = tokensOf(foldText(name));
  const content = tokens.filter(token => [...token].length >= 4);
  return (content.length ? content : tokens).sort().join(' ');
};

// Entities worth a second look, with why. Nothing here changes data: the user decides.
function assessEntityNames(entities, texts) {
  const list = (Array.isArray(entities) ? entities : []).filter(entity => entity && entity.id && entity.canonicalName);
  const corpus = Array.isArray(texts) ? texts : [];
  const index = buildNameIndex(list);
  const lowercaseWords = collectLowercaseWords(corpus);
  const standalone = new Map();
  const foldedTexts = [];
  for (const text of corpus) {
    const folded = foldWithMap(String(text == null ? '' : text));
    foldedTexts.push(folded.text);
    for (const mention of findLiteralMentions(text, index, { lowercaseWords, folded })) {
      standalone.set(mention.entityId, (standalone.get(mention.entityId) || 0) + 1);
    }
  }
  const namesOf = entity => [entity.canonicalName, ...(Array.isArray(entity.aliases) ? entity.aliases : [])].filter(Boolean);

  const results = [];
  for (const entity of list) {
    const data = readData(entity);
    if (data.nameReviewDismissed) continue;
    const reasons = [];
    const name = entity.canonicalName;
    const form = foldText(name);
    if (!/\p{L}/u.test(name)) {
      reasons.push({ code: 'number' });
    } else if (!looksLikeName(name, entity.type, data.itemNature === 'type' ? 'world_specific_type' : 'named')) {
      reasons.push({ code: 'common-word' });
    }

    const key = contentKey(name);
    const duplicate = list.find(other => other.id !== entity.id && other.type === entity.type && key && contentKey(other.canonicalName) === key);

    let container = null;
    let inside = 0;
    for (const other of list) {
      if (other.id === entity.id || other === duplicate) continue;
      for (const otherName of namesOf(other)) {
        const otherForm = foldText(otherName);
        if (!containsWord(otherForm, form)) continue;
        const count = countInside(foldedTexts, form, otherForm);
        if (count > inside) { inside = count; container = other; }
      }
    }
    if (container && (standalone.get(entity.id) || 0) <= inside * FRAGMENT_SHARE) {
      reasons.push({ code: 'fragment', relatedId: container.id, relatedName: container.canonicalName });
    }
    if (duplicate) reasons.push({ code: 'duplicate', relatedId: duplicate.id, relatedName: duplicate.canonicalName });

    if (reasons.length) results.push({ id: entity.id, type: entity.type, canonicalName: name, status: entity.status, reasons });
  }
  return results;
}

module.exports = { looksLikeName, checkProposal, assessEntityNames };
