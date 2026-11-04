const { foldText } = require('../world-index/text-fold');

const PASSAGE_MAX_CHARS = 1500;
const MIN_PASSAGES_TO_FILL = 2;
const CARD_KEYWORDS = ['ccv3', 'chara'];

function readPngTextChunks(buffer) {
  const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (!Buffer.isBuffer(buffer) || buffer.length < 8 || signature.some((byte, index) => buffer[index] !== byte)) return null;
  const chunks = new Map();
  let offset = 8;
  while (offset + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString('latin1', offset + 4, offset + 8);
    const start = offset + 8;
    const end = start + length;
    if (end > buffer.length) break;
    const data = buffer.subarray(start, end);
    if (type === 'tEXt') {
      const split = data.indexOf(0);
      if (split > 0) chunks.set(data.toString('latin1', 0, split), data.toString('latin1', split + 1));
    } else if (type === 'iTXt') {
      const split = data.indexOf(0);
      // Compressed iTXt is not used by card writers, so only plain text is read.
      if (split > 0 && data[split + 1] === 0) {
        const language = data.indexOf(0, split + 3);
        const translated = language >= 0 ? data.indexOf(0, language + 1) : -1;
        if (translated >= 0) chunks.set(data.toString('latin1', 0, split), data.toString('utf8', translated + 1));
      }
    }
    if (type === 'IEND') break;
    offset = end + 4;
  }
  return chunks;
}

function readCardFromPng(buffer) {
  const chunks = readPngTextChunks(buffer);
  if (!chunks) throw new Error('This file is not a PNG image.');
  for (const keyword of CARD_KEYWORDS) {
    const value = chunks.get(keyword);
    if (!value) continue;
    try { return JSON.parse(Buffer.from(value, 'base64').toString('utf8')); }
    catch { /* a broken newer chunk falls back to the older one */ }
  }
  throw new Error('This image has no character card inside.');
}

// V2 and V3 cards keep their fields under `data`; V1 and TavernAI exports keep them at the top.
function cardFields(json) {
  if (!json || typeof json !== 'object' || Array.isArray(json)) return null;
  const inner = json.data && typeof json.data === 'object' && !Array.isArray(json.data) ? json.data : null;
  if (inner && (inner.name || inner.description)) return inner;
  if (json.char_name || json.char_persona) {
    return { name: json.char_name, description: json.char_persona, scenario: json.world_scenario, first_mes: json.char_greeting };
  }
  // A lorebook export also carries a name and a description at the top, beside its entries.
  if (lorebookEntries(json)) return null;
  if (json.name && (json.description != null || json.first_mes != null || json.personality != null)) return json;
  return null;
}

function lorebookEntries(json) {
  const entries = json && typeof json === 'object' ? json.entries : null;
  if (!entries || typeof entries !== 'object') return null;
  return Array.isArray(entries) ? entries : Object.values(entries);
}

const cleanList = values => (Array.isArray(values) ? values : typeof values === 'string' ? values.split(',') : [])
  .map(value => String(value || '').trim())
  // A regex key is a matching rule, not a name.
  .filter(value => value && !/^\/.+\/[a-z]*$/i.test(value));

function placeholders(text, name) {
  return String(text || '')
    .replace(/\{\{\s*char\s*\}\}|<BOT>/gi, name || 'the character')
    .replace(/\{\{\s*user\s*\}\}|<USER>/gi, 'the user')
    .replace(/<START>/gi, '')
    .trim();
}

function splitPassages(text, maxChars = PASSAGE_MAX_CHARS) {
  const paragraphs = String(text || '').replace(/\r\n?/g, '\n').split(/\n\s*\n/).map(part => part.trim()).filter(Boolean);
  const pieces = [];
  for (const paragraph of paragraphs) {
    if (paragraph.length <= maxChars) { pieces.push(paragraph); continue; }
    let rest = paragraph;
    while (rest.length > maxChars) {
      const window = rest.slice(0, maxChars);
      const cut = Math.max(window.lastIndexOf('. '), window.lastIndexOf('\n'), window.lastIndexOf(' '));
      const at = cut > maxChars / 2 ? cut + 1 : maxChars;
      pieces.push(rest.slice(0, at).trim());
      rest = rest.slice(at).trim();
    }
    if (rest) pieces.push(rest);
  }
  const passages = [];
  let current = '';
  for (const piece of pieces) {
    if (current && current.length + piece.length + 2 > maxChars) { passages.push(current); current = ''; }
    current = current ? `${current}\n\n${piece}` : piece;
  }
  if (current) passages.push(current);
  return passages;
}

// Card writers mark sections with tags (<Personality>), Markdown headings, [Brackets] or a
// title line ending in a colon. Text before the first mark is a section without a title.
const OPEN_TAG = /^<([A-Za-z][\w '&/-]{0,40})>$/;
const CLOSE_TAG = /^<\/[A-Za-z][\w '&/-]{0,40}>$/;
const HEADING = /^#{1,6}\s+(.{1,60}?)\s*#*$/;
const BRACKET_TITLE = /^\[([A-Za-z][\w '&/-]{1,40})\]$/;
const COLON_TITLE = /^([A-Z][\w '&/-]{1,40}):$/;

function splitSections(text) {
  const sections = [];
  let current = { title: null, lines: [] };
  const close = () => {
    const body = current.lines.join('\n').trim();
    if (body) sections.push({ title: current.title, body });
    current = { title: null, lines: [] };
  };
  for (const line of String(text || '').replace(/\r\n?/g, '\n').split('\n')) {
    const trimmed = line.trim();
    if (CLOSE_TAG.test(trimmed)) { close(); continue; }
    const title = (trimmed.match(OPEN_TAG) || trimmed.match(HEADING) || trimmed.match(BRACKET_TITLE) || trimmed.match(COLON_TITLE) || [])[1];
    if (title) {
      close();
      current.title = title.replace(/[*_]/g, '').trim();
      continue;
    }
    current.lines.push(line);
  }
  close();
  return sections;
}

// Only names are taken from a card's own lines; every other field is left to the fill, which cites them.
const NAME_KEYS = /^[-*•\s]*(?:full name|aliases?|also known as|aka|nicknames?|other names)\s*:\s*(.+)$/gim;

function namesFromText(text, name) {
  const found = [];
  for (const match of String(text || '').matchAll(NAME_KEYS)) {
    for (const part of match[1].replace(/\([^)]*\)/g, '').split(/[,;/]|\bor\b/)) {
      const value = part.replace(/["“”]/g, '').trim();
      if (value && value.length <= 60 && foldText(value) !== foldText(name)) found.push(value);
    }
  }
  return found;
}

function sectionUnits({ text, title, fallbackLabel, fileName, subject }) {
  const units = [];
  for (const section of splitSections(text)) {
    const label = section.title || fallbackLabel;
    splitPassages(section.body).forEach((body, index, all) => units.push({
      fileName, title, label: all.length > 1 ? `${label}, part ${index + 1}` : label, text: body, subject,
    }));
  }
  return units;
}

const wordsOf = value => foldText(value).split(/[^\p{L}\p{N}']+/u).filter(Boolean);
// Where an entry names itself: "X, also known as A or B", "whose true name is C".
const NAMING_PHRASE = /\b(?:also known as|known as|also called|called|aka|a\.k\.a\.|codename|code name|true name is|real name is|formerly|nicknamed|alias(?:es)?)\b([^.\n]{0,160})/giu;

// An entry without a title is named by the key its text opens with, as "Mira is the innkeeper…".
function entryName(entry, keys, content) {
  const title = String(entry.comment || entry.name || '').trim();
  if (title) return title;
  const opening = foldText(content.slice(0, 200));
  const opens = keys.filter(key => opening.startsWith(foldText(key))).sort((a, b) => b.length - a.length)[0];
  return opens || keys[0] || '';
}

// Keys are what triggers the entry, so most name its places, groups and roles. Only a key the entry
// is called by becomes an alias: one inside its name, or one its own text gives as a name.
function entryAliases(keys, name, content) {
  const nameWords = new Set(wordsOf(name));
  // The naming ends where the sentence goes on to say what the entry is.
  const phrases = [...content.slice(0, 600).matchAll(NAMING_PHRASE)]
    .map(match => foldText(match[1]).split(/\b(?:is|was|are|were|has|had|who|which|serves|served)\b/u)[0]);
  const isAlias = key => {
    const words = wordsOf(key);
    if (words.length && words.every(word => nameWords.has(word))) return true;
    const folded = foldText(key);
    return phrases.some(phrase => new RegExp(`(^|[^\\p{L}\\p{N}])${folded.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}($|[^\\p{L}\\p{N}])`, 'u').test(phrase));
  };
  return [...new Set([...keys.filter(isAlias), ...namesFromText(content, name)].filter(key => foldText(key) !== foldText(name)))];
}

function entryUnits(entries, fileName) {
  const units = [];
  for (const entry of entries || []) {
    if (!entry || typeof entry !== 'object') continue;
    if (entry.disable === true || entry.enabled === false) continue;
    const keys = cleanList(entry.keys ?? entry.key);
    const content = String(entry.content || '').trim();
    const name = entryName(entry, keys, content);
    if (!name || !content) continue;
    const aliases = entryAliases(keys, name, content);
    units.push(...sectionUnits({ text: content, title: name, fallbackLabel: 'entry', fileName, subject: { name, aliases, type: null } }));
  }
  return units;
}

/**
 * Turns one file into passages to read. A card is one character, a lorebook entry one subject
 * with its keys as aliases; plain text has no subject until the Tagger reads it.
 */
function parseSource({ fileName, buffer = null, text = null, filePath = null }) {
  const extension = String(fileName || '').toLowerCase().split('.').pop();
  if (extension === 'png') {
    return parseCard(readCardFromPng(buffer), fileName, filePath);
  }
  if (extension === 'json') {
    let json;
    try { json = JSON.parse(buffer ? buffer.toString('utf8') : text); }
    catch { throw new Error('This JSON file could not be read.'); }
    if (cardFields(json)) return parseCard(json, fileName, null);
    const entries = lorebookEntries(json);
    if (entries) {
      const units = entryUnits(entries, fileName);
      return { kind: 'lorebook', fileName, entries: new Set(units.map(unit => unit.subject.name)).size, units };
    }
    throw new Error('This JSON is neither a character card nor a lorebook.');
  }
  const body = String(text ?? (buffer ? buffer.toString('utf8') : '')).trim();
  if (!body) throw new Error('This file has no text to read.');
  const title = String(fileName || 'Text').replace(/\.[^.]+$/, '');
  return { kind: 'text', fileName, units: splitPassages(body).map((passage, index, all) => ({ fileName, title, label: all.length > 1 ? `part ${index + 1}` : '', text: passage, subject: null })) };
}

// The scenario and the opening message set up one roleplay; read as evidence they turn a
// starting scene into lasting canon, so only the description and personality are read.
function parseCard(json, fileName, portraitPath) {
  const card = cardFields(json);
  if (!card) throw new Error('This card has no character in it.');
  const name = String(card.name || '').trim();
  if (!name) throw new Error('This card has no character name.');
  const description = placeholders(card.description, name);
  const personality = placeholders(card.personality, name);
  const subject = { name, aliases: namesFromText(description, name), type: 'Characters', portraitPath: portraitPath || null };
  const units = [
    ...sectionUnits({ text: description, title: name, fallbackLabel: 'Description', fileName, subject }),
    ...(personality ? sectionUnits({ text: personality, title: name, fallbackLabel: 'Personality', fileName, subject }) : []),
  ];
  if (!units.length) units.push({ fileName, title: name, label: 'card', text: name, subject });
  const book = lorebookEntries(card.character_book);
  const bookUnits = book ? entryUnits(book, fileName) : [];
  return { kind: 'card', fileName, name, entries: new Set(bookUnits.map(unit => unit.subject.name)).size, units: [...units, ...bookUnits] };
}

const typesFit = (a, b) => !a || !b || a === b;
// "The Traveler" and "Traveler" are one name; the English articles are the only ones stripped.
const nameKey = value => foldText(value).replace(/^(?:the|a|an)\s+/, '');
const keysOf = (name, aliases) => [name, ...(aliases || [])].map(nameKey).filter(Boolean);

/**
 * Joins subjects and Tagger mentions that name the same thing, then points each at the entity
 * it matches in the world. `mentions` maps a passage id to [{ name, type, proposalKind }].
 */
function buildCandidates({ passages, mentions = new Map(), existing = [] }) {
  const candidates = [];
  const find = (keys, type) => candidates.find(candidate => typesFit(candidate.type, type) && keys.some(key => candidate.keys.has(key)));
  const add = ({ name, aliases = [], type = null, passageId, fileName, fromSubject, proposalKind = 'named', portraitPath = null }) => {
    const keys = keysOf(name, aliases);
    if (!keys.length) return;
    let candidate = find(keys, type);
    if (!candidate) {
      candidate = { id: `c${candidates.length + 1}`, name, type, aliases: [], keys: new Set(), passageIds: new Set(), sources: new Set(), mergedFrom: fromSubject ? [{ name, fileName }] : [], fromSubject: false, kinds: new Set(), portraitPath: null };
      candidates.push(candidate);
    } else if (foldText(name) !== foldText(candidate.name)) {
      // A subject's own name wins over a name the Tagger read in passing.
      if (fromSubject && !candidate.fromSubject) {
        candidate.aliases.push(candidate.name);
        candidate.name = name;
      } else if (!candidate.aliases.some(alias => foldText(alias) === foldText(name))) {
        candidate.aliases.push(name);
      }
      if (fromSubject) candidate.mergedFrom.push({ name, fileName });
    } else if (fromSubject && candidate.fromSubject && !candidate.mergedFrom.some(item => item.fileName === fileName)) {
      candidate.mergedFrom.push({ name, fileName });
    }
    for (const alias of aliases) {
      if (foldText(alias) !== foldText(candidate.name) && !candidate.aliases.some(item => foldText(item) === foldText(alias))) candidate.aliases.push(alias);
    }
    keys.forEach(key => candidate.keys.add(key));
    if (!candidate.type && type) candidate.type = type;
    if (passageId) candidate.passageIds.add(passageId);
    if (fileName) candidate.sources.add(fileName);
    candidate.fromSubject = candidate.fromSubject || fromSubject;
    candidate.kinds.add(fromSubject ? 'subject' : proposalKind);
    if (portraitPath && !candidate.portraitPath) candidate.portraitPath = portraitPath;
  };

  for (const passage of passages) {
    if (passage.subject) add({ ...passage.subject, passageId: passage.id, fileName: passage.fileName, fromSubject: true });
  }
  for (const passage of passages) {
    for (const mention of mentions.get(passage.id) || []) {
      add({ name: mention.name, type: mention.type, passageId: passage.id, fileName: passage.fileName, fromSubject: false, proposalKind: mention.proposalKind });
    }
  }

  const live = existing.filter(entity => entity && entity.status !== 'proposed');
  return candidates.map(candidate => {
    const keys = [...candidate.keys];
    const match = live.find(entity => typesFit(candidate.type, entity.type) && keysOf(entity.canonicalName, entity.aliases).some(key => keys.includes(key))) || null;
    const type = candidate.type || match?.type || null;
    // The Tagger marks a reusable kind of item as world_specific_type; anything it also names is one object.
    const itemNature = type === 'Items' && candidate.kinds.has('world_specific_type') && !candidate.kinds.has('named') && !candidate.fromSubject ? 'type' : 'unique';
    return {
      id: candidate.id,
      name: candidate.name,
      type,
      aliases: candidate.aliases,
      passageIds: [...candidate.passageIds],
      sources: [...candidate.sources],
      mergedFrom: candidate.mergedFrom.length > 1 ? candidate.mergedFrom : [],
      match: match ? { id: match.id, name: match.canonicalName, type: match.type } : null,
      portraitPath: candidate.portraitPath,
      itemNature: type === 'Items' ? itemNature : null,
      keep: true,
      // A name met once in someone else's passage gives the fill too little to go on.
      fill: candidate.fromSubject || candidate.passageIds.size >= MIN_PASSAGES_TO_FILL,
    };
  });
}

// How a passage is named to the fill: whose text it is first, so a sheet never reads another subject's profile as its own.
const passageSource = passage => [passage.title || passage.fileName, passage.label].filter(Boolean).join(' · ');

module.exports = { parseSource, splitPassages, splitSections, buildCandidates, readCardFromPng, passageSource };
