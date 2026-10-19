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
  const lore = value.lore.value.trim();
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
  const addition = value.lore.value.trim();
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

function buildLorePrompt({ entityName, entityType, currentLore, findings, evidence, skillsInUse = false }) {
  return `CURRENT LORE:\n${String(currentLore || '').trim() || '(none)'}\n\n` +
    `VALIDATED NEW FINDINGS:\n${JSON.stringify(findings)}\n\n` +
    `SUPPORTING EVIDENCE:\n${evidence}\n\n` +
    `Write a cumulative world-bible lore entry for ${entityName} (${entityType}). ${loreScope(entityType, skillsInUse)}` +
    `Preserve established information and integrate only the supported new findings. ` +
    `Do not reduce the entity to one event or cultural detail. Do not add headings merely to fill space. Do not invent motives, causation, or conclusions. ` +
    `Return only {"lore":{"value":"...","support":"...","evidence":["E_ID"]}}.`;
}

function buildLoreAppendPrompt({ entityName, entityType, currentLore, findings, evidence, skillsInUse = false }) {
  return `CURRENT LORE (already stored, do not repeat it):\n${String(currentLore || '').trim()}\n\n` +
    `VALIDATED NEW FINDINGS:\n${JSON.stringify(findings)}\n\n` +
    `SUPPORTING EVIDENCE:\n${evidence}\n\n` +
    `The lore entry for ${entityName} (${entityType}) is long, so it is extended instead of rewritten. ${loreScope(entityType, skillsInUse)}` +
    `Write only the new paragraphs to add at its end, with what the current lore does not already contain. ` +
    `Do not restate, summarize, or rephrase the current lore. Do not invent motives, causation, or conclusions. When the evidence adds nothing new, return an empty value. ` +
    `Return only {"lore":{"value":"...","support":"...","evidence":["E_ID"]}}.`;
}

module.exports = {
  buildLorePrompt,
  buildLoreAppendPrompt,
  isEntityLoreShape,
  validateEntityLore,
  validateEntityLoreAppend
};
