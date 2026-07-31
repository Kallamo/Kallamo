function discardEnrichPending(currentData) {
  const pending = currentData?._enrichPending;
  if (!pending || typeof pending !== 'object') return null;
  const data = { ...currentData };
  delete data._enrichPending;
  return {
    data,
    fields: Object.keys(pending.data || {}).length,
    lore: pending.lore != null ? 1 : 0,
    links: Array.isArray(pending.links) ? pending.links.length : 0,
    chapters: Array.isArray(pending.chapters) ? pending.chapters.length : 0
  };
}

function normalizeDirectionalRelationship(proposal, sourceName) {
  const source = String(proposal?.source || '').trim().toLocaleLowerCase();
  if (!source || source !== String(sourceName || '').trim().toLocaleLowerCase()) return null;
  const value = Number(proposal.value);
  const description = String(proposal.sourcePerspective || '').trim();
  if (!Number.isFinite(value) || !description) return null;
  return { value: Math.max(-100, Math.min(100, Math.round(value))), description };
}

function normalizeRelationshipLabel(value) {
  const role = String(value || '').split(/[;,.\n:]/, 1)[0].trim();
  if (/(?:\b(?:and|or|of|to|who|e|ou|de|do|da|que))$/iu.test(role)) return null;
  const normalized = role.split('/').map(part => {
    const words = part.trim().split(/\s+/).filter(Boolean);
    const limit = words.length > 4 && /^(?:and|or|of|to|who|e|ou|de|do|da|que)$/iu.test(words[3]) ? 5 : 4;
    return words.slice(0, limit).join(' ');
  }).filter(Boolean).join(' / ');
  if (!normalized) return null;
  return normalized;
}

function validateNarrativeChange(change, currentEntityId, entityIds) {
  if (!change || typeof change !== 'object') return { valid: false, reason: 'invalid-change' };
  if (change.kind === 'observation') return { valid: false, reason: 'document-observation' };
  const requiresOwner = ['fact', 'awareness', 'knowledge', 'belief', 'memory', 'relationship'].includes(change.kind);
  const ownerId = String(change.subjectId || (requiresOwner ? '' : currentEntityId) || '').trim();
  if (!ownerId || !entityIds.has(ownerId)) return { valid: false, reason: 'invalid-owner' };
  if (['fact', 'awareness', 'knowledge', 'belief'].includes(change.kind)) {
    const targetId = String(change.targetId || '').trim();
    if (!targetId || !entityIds.has(targetId)) return { valid: false, reason: 'invalid-target' };
  }
  if (change.kind === 'knowledge') {
    const method = String(change.method || '').trim();
    if (!['participant', 'witness', 'reported'].includes(method)) {
      return { valid: false, reason: 'knowledge-acquisition-not-demonstrated' };
    }
  }
  if (change.kind === 'relationship') {
    const perspectiveOwnerId = String(change.perspectiveOwnerId || ownerId).trim();
    if (perspectiveOwnerId !== ownerId) return { valid: false, reason: 'perspective-owner-mismatch' };
    const targetId = String(change.targetId || '').trim();
    if (!targetId || !entityIds.has(targetId) || targetId === ownerId) return { valid: false, reason: 'invalid-target' };
    if (!String(change.sourcePerspective || '').trim()) return { valid: false, reason: 'missing-perspective' };
  }
  return { valid: true, ownerId };
}

module.exports = {
  discardEnrichPending,
  normalizeDirectionalRelationship,
  normalizeRelationshipLabel,
  validateNarrativeChange,
};
