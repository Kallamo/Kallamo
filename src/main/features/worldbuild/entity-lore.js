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
  const minimumLength = current ? Math.max(400, Math.floor(current.length * 0.8)) : 400;
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

function buildLorePrompt({ entityName, entityType, currentLore, findings, evidence }) {
  return `CURRENT LORE:\n${String(currentLore || '').trim() || '(none)'}\n\n` +
    `VALIDATED NEW FINDINGS:\n${JSON.stringify(findings)}\n\n` +
    `SUPPORTING EVIDENCE:\n${evidence}\n\n` +
    `Write a cumulative world-bible lore entry for ${entityName} (${entityType}). ` +
    `Preserve established information and integrate only supported new findings. Cover identity and role, relevant history, defining traits, important relationships, transformative events, and current state when evidence exists. ` +
    `Do not reduce the entity to one event or cultural detail. Do not add headings merely to fill space. Do not invent motives, causation, or conclusions. ` +
    `Return only {"lore":{"value":"...","support":"...","evidence":["E_ID"]}}.`;
}

function buildLoreAppendPrompt({ entityName, entityType, currentLore, findings, evidence }) {
  return `CURRENT LORE (already stored, do not repeat it):\n${String(currentLore || '').trim()}\n\n` +
    `VALIDATED NEW FINDINGS:\n${JSON.stringify(findings)}\n\n` +
    `SUPPORTING EVIDENCE:\n${evidence}\n\n` +
    `The lore entry for ${entityName} (${entityType}) is long, so it is extended instead of rewritten. ` +
    `Write only the new paragraphs to add at its end: supported history, traits, relationships, transformative events, or changes of current state that the current lore does not already contain. ` +
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
