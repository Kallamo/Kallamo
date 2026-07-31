const contract = require('./retrieval-settings.json');

const RETRIEVAL_SETTING_DEFINITIONS = Object.freeze(contract.definitions);
const WORLDBUILD_BREADTH_VALUES = Object.freeze(contract.worldbuildBreadthValues);
const DEFAULT_WORLDBUILD_BREADTH = contract.defaultWorldbuildBreadth;

function clampNumber(value, definition) {
  const parsed = Number(value);
  const fallback = definition.defaultValue;
  if (!Number.isFinite(parsed)) return fallback;
  const clamped = Math.min(definition.max, Math.max(definition.min, parsed));
  const steps = Math.round((clamped - definition.min) / definition.step);
  return Number((definition.min + steps * definition.step).toFixed(4));
}

function normalizeRetrievalSettings(advanced = {}) {
  const normalized = {};
  for (const [key, definition] of Object.entries(RETRIEVAL_SETTING_DEFINITIONS)) {
    normalized[key] = clampNumber(
      advanced[key] ?? (definition.legacyKey ? advanced[definition.legacyKey] : undefined),
      definition
    );
  }
  normalized.worldbuildBreadth = WORLDBUILD_BREADTH_VALUES.includes(advanced.worldbuildBreadth)
    ? advanced.worldbuildBreadth
    : DEFAULT_WORLDBUILD_BREADTH;
  return normalized;
}

function withNormalizedRetrievalSettings(advanced = {}) {
  const { narrativeContextBudgetPercent: _removedNarrativeBudget, ...current } = advanced;
  return { ...current, ...normalizeRetrievalSettings(current) };
}

module.exports = {
  DEFAULT_WORLDBUILD_BREADTH,
  RETRIEVAL_SETTING_DEFINITIONS,
  WORLDBUILD_BREADTH_VALUES,
  normalizeRetrievalSettings,
  withNormalizedRetrievalSettings
};
