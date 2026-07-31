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

function buildLorePrompt({ entityName, entityType, currentLore, findings, evidence }) {
  return `CURRENT LORE:\n${String(currentLore || '').trim() || '(none)'}\n\n` +
    `VALIDATED NEW FINDINGS:\n${JSON.stringify(findings)}\n\n` +
    `SUPPORTING EVIDENCE:\n${evidence}\n\n` +
    `Write a cumulative world-bible lore entry for ${entityName} (${entityType}). ` +
    `Preserve established information and integrate only supported new findings. Cover identity and role, relevant history, defining traits, important relationships, transformative events, and current state when evidence exists. ` +
    `Do not reduce the entity to one event or cultural detail. Do not add headings merely to fill space. Do not invent motives, causation, or conclusions. ` +
    `Return only {"lore":{"value":"...","support":"...","evidence":["E_ID"]}}.`;
}

module.exports = { buildLorePrompt, isEntityLoreShape, validateEntityLore };
