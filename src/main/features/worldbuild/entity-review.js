const { comparableText, isWeakTextReplacement } = require('./entity-update-contract');

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

const MAX_ROLE_WORDS = 6;

// A role is kept whole or not at all: cutting it at a word count leaves a broken phrase in
// whatever language the AI writes.
function normalizeRelationshipLabel(value) {
  const role = String(value || '').split(/[;,.\n:]/, 1)[0].trim();
  const parts = role.split('/').map(part => part.trim().split(/\s+/).filter(Boolean));
  if (parts.some(words => words.length > MAX_ROLE_WORDS)) return null;
  const normalized = parts.map(words => words.join(' ')).filter(Boolean).join(' / ');
  return normalized || null;
}

const RELATIONSHIP_STEP = 25;
const REVERSAL_STEP = 50;
const REVERSAL_FLOOR = 20;

// An existing relationship is edited from what it already says. Documents are read out of order,
// so one run moves the score a bounded step, and only a reversal (ally to enemy) may rename it.
function resolveRelationshipUpdate(current, proposed) {
  const requested = Math.max(-100, Math.min(100, Math.round(Number(proposed.value) || 0)));
  const title = String(proposed.title || '').trim();
  const description = String(proposed.description || '').trim();
  if (!current) return { title, value: requested, description };
  const currentValue = Math.round(Number(current.value) || 0);
  const reversal = (currentValue >= REVERSAL_FLOOR && requested <= -REVERSAL_FLOOR)
    || (currentValue <= -REVERSAL_FLOOR && requested >= REVERSAL_FLOOR);
  const step = reversal ? REVERSAL_STEP : RELATIONSHIP_STEP;
  const delta = requested - currentValue;
  const value = currentValue + Math.sign(delta) * Math.min(Math.abs(delta), step);
  const currentTitle = String(current.title || '').trim();
  const nextTitle = currentTitle && !reversal ? currentTitle : title || currentTitle;
  const currentDescription = String(current.description || '').trim();
  const nextDescription = !description || (currentDescription && isWeakTextReplacement(currentDescription, description, { floor: 40 }))
    ? currentDescription
    : description;
  const unchanged = comparableText(nextTitle) === comparableText(currentTitle)
    && comparableText(nextDescription) === comparableText(currentDescription)
    && Math.abs(value - currentValue) < 5;
  return unchanged ? null : { title: nextTitle, value, description: nextDescription };
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
  resolveRelationshipUpdate,
  validateNarrativeChange,
};
