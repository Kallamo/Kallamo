function isEntityLoreShape(value) {
  const lore = value?.lore;
  return Boolean(lore)
    && typeof lore === 'object'
    && !Array.isArray(lore)
    && typeof lore.value === 'string'
    && typeof lore.support === 'string'
    && Array.isArray(lore.evidence);
}

function validateEntityLore(value, currentLore, validEvidenceIds) {
  if (!isEntityLoreShape(value)) return null;
  const lore = tidySpoilerMarkers(value.lore.value);
  const support = value.lore.support.trim();
  const evidence = value.lore.evidence.map(String).filter(id => validEvidenceIds.has(id));
  if (!lore || !support || !evidence.length) return null;
  const current = String(currentLore || '').trim();
  // A first lore may be short; a high floor makes the model pad it with the sheet's other sections.
  const minimumLength = current ? Math.max(400, Math.floor(current.length * 0.8)) : 200;
  if (lore.length < minimumLength || lore === current) return null;
  return { value: lore, support, evidence };
}

// Long entries are extended, not rewritten: a full rewrite stops fitting the output limit.
function validateEntityLoreAppend(value, currentLore, validEvidenceIds) {
  if (!isEntityLoreShape(value)) return null;
  const addition = tidySpoilerMarkers(value.lore.value);
  const support = value.lore.support.trim();
  const evidence = value.lore.evidence.map(String).filter(id => validEvidenceIds.has(id));
  if (!addition || !support || !evidence.length) return null;
  const current = String(currentLore || '').trim();
  if (current.includes(addition)) return null;
  return { value: current ? `${current}\n\n${addition}` : addition, support, evidence };
}

// The sheet keeps look, temperament and abilities in their own sections; lore that repeats
// them goes stale the first time one of those sections is edited.
const OTHER_SECTIONS = {
  Characters: 'physical appearance, clothing, temperament',
  Creatures: 'physical appearance, temperament, abilities',
};

function loreScope(entityType, skillsInUse) {
  const elsewhere = [OTHER_SECTIONS[entityType], entityType === 'Characters' && skillsInUse ? 'skills, techniques, magic and fighting style' : '']
    .filter(Boolean).join(', ');
  return `Lore tells who ${entityType === 'Characters' ? 'they are and what they have lived' : 'it is and what happened to it'}: identity, origin, role and titles, trajectory, important relationships, the events that changed it, and its current situation. ` +
    (elsewhere ? `Its sheet keeps ${elsewhere} in their own sections: never write a description of them; mention one only where it is part of an event. ` : '') +
    'Write only what is true of this one entity: never describe it through the general traits of its race, species, people or culture, and never explain a setting concept or custom. ' +
    'Write as the world bible, in the third person and in the story\'s own terms. Never mention documents, records, sheets, evidence, sources, or what is unknown or not yet established. Do not guess with words such as "suggests" or "seems". ';
}

// Spoilers hide text from the person reading the sheet, not from the story.
const SPOILER_RULE = 'Text written between || and || is a spoiler: it is true and part of the lore, but hidden from the person reading the sheet until they choose to reveal it. ' +
  'Keep every such span exactly as it is, with its || markers and the same words. Never quote, summarize, or paraphrase a spoiler outside its markers. ' +
  'When a new finding reveals more of something hidden, or would spoil a surprise for someone who has not reached it in the story, write it inside new || markers on a single line. ' +
  'Only a twist, a secret or a reveal is a spoiler; background, history and everyday detail never are. Never use || to separate paragraphs: separate them with a blank line. ';

// A lone or empty pair of markers hides nothing on purpose; it is a separator the model reached for.
function tidySpoilerMarkers(text) {
  let value = String(text || '').replace(/\|\|\s*\|\|/g, '');
  if ((value.match(/\|\|/g) || []).length % 2) {
    const last = value.lastIndexOf('||');
    value = value.slice(0, last) + value.slice(last + 2);
  }
  return value.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

function buildSpoilerRetryNote(lostSpoilers) {
  return `Your previous answer removed or changed these spoilers. Answer again and keep each one exactly as written here:\n${lostSpoilers.join('\n')}`;
}

function buildLorePrompt({ entityName, entityType, currentLore, findings, evidence, skillsInUse = false }) {
  return `CURRENT LORE:\n${String(currentLore || '').trim() || '(none)'}\n\n` +
    `VALIDATED NEW FINDINGS:\n${JSON.stringify(findings)}\n\n` +
    `SUPPORTING EVIDENCE:\n${evidence}\n\n` +
    `Write a cumulative world-bible lore entry for ${entityName} (${entityType}). ${loreScope(entityType, skillsInUse)}` +
    `Preserve established information and integrate only the supported new findings. ${SPOILER_RULE}` +
    `Do not reduce the entity to one event or cultural detail. Do not add headings merely to fill space. Do not invent motives, causation, or conclusions. ` +
    `Return only {"lore":{"value":"...","support":"...","evidence":["E_ID"]}}.`;
}

function buildLoreAppendPrompt({ entityName, entityType, currentLore, findings, evidence, skillsInUse = false }) {
  return `CURRENT LORE (already stored, do not repeat it):\n${String(currentLore || '').trim()}\n\n` +
    `VALIDATED NEW FINDINGS:\n${JSON.stringify(findings)}\n\n` +
    `SUPPORTING EVIDENCE:\n${evidence}\n\n` +
    `The lore entry for ${entityName} (${entityType}) is long, so it is extended instead of rewritten. ${loreScope(entityType, skillsInUse)}` +
    `Write only the new paragraphs to add at its end, with what the current lore does not already contain. ${SPOILER_RULE}` +
    `Do not restate, summarize, or rephrase the current lore. Do not invent motives, causation, or conclusions. When the evidence adds nothing new, return an empty value. ` +
    `Return only {"lore":{"value":"...","support":"...","evidence":["E_ID"]}}.`;
}

module.exports = {
  buildLorePrompt,
  buildLoreAppendPrompt,
  buildSpoilerRetryNote,
  isEntityLoreShape,
  SPOILER_RULE,
  tidySpoilerMarkers,
  validateEntityLore,
  validateEntityLoreAppend
};
