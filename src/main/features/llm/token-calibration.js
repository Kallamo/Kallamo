// How far the local token estimate falls short of what a model really counts, learned per
// connection, model and protocol from provider-reported usage. The estimate uses one fixed
// tokenizer, and models split the same text very differently, most of all outside English.

// Until a model has reported its usage, nothing is corrected.
const UNMEASURED_RATIO = 1;
// Never below the local count, so a model that counts fewer tokens cannot erode the margin.
const MIN_RATIO = 1;
const MAX_RATIO = 3;
// Small requests are dominated by framing overhead and would skew the ratio.
const MIN_SAMPLE_TOKENS = 500;
// A falling ratio blends slowly; a rising one is adopted at once, because a request sized on
// a stale lower ratio overflows while one sized on a stale higher ratio only wastes room.
const SMOOTHING = 0.5;

const ratios = new Map();
let store = null;
let storeLoaded = false;

// Model ids may contain ':' (Ollama tags), so the parts are never joined into a plain string.
function keyOf({ apiProfileId, model, protocol = 'text' } = {}) {
  if (!apiProfileId || !model) return null;
  return JSON.stringify([String(apiProfileId), String(model), String(protocol)]);
}

function clampRatio(value) {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, value));
}

function ensureLoaded() {
  if (!store || storeLoaded) return;
  storeLoaded = true;
  try {
    for (const row of store.loadTokenCalibrations() || []) {
      const key = keyOf(row);
      const ratio = Number(row.ratio);
      if (key && Number.isFinite(ratio) && !ratios.has(key)) ratios.set(key, clampRatio(ratio));
    }
  } catch (error) {
    console.error('Failed to load token calibration:', error);
  }
}

// The store is the database: it must offer loadTokenCalibrations() and saveTokenCalibration(parts, ratio).
function useTokenCalibrationStore(nextStore) {
  const usable = nextStore
    && typeof nextStore.loadTokenCalibrations === 'function'
    && typeof nextStore.saveTokenCalibration === 'function';
  if (!usable || nextStore === store) return;
  store = nextStore;
  storeLoaded = false;
}

function measuredRatio(parts) {
  ensureLoaded();
  const key = keyOf(parts);
  return key ? ratios.get(key) ?? null : null;
}

function tokenRatio(parts) {
  return measuredRatio(parts) ?? UNMEASURED_RATIO;
}

function recordTokenCount(parts, estimatedTokens, reportedTokens) {
  const key = keyOf(parts);
  const estimated = Number(estimatedTokens);
  const reported = Number(reportedTokens);
  if (!key || !Number.isFinite(estimated) || !Number.isFinite(reported) || estimated < MIN_SAMPLE_TOKENS || reported <= 0) {
    return null;
  }
  const measured = clampRatio(reported / estimated);
  const previous = measuredRatio(parts);
  const next = previous == null || measured > previous
    ? measured
    : clampRatio(previous * (1 - SMOOTHING) + measured * SMOOTHING);
  ratios.set(key, next);
  if (store) {
    try {
      store.saveTokenCalibration({ apiProfileId: parts.apiProfileId, model: parts.model, protocol: parts.protocol || 'text' }, next);
    } catch (error) {
      console.error('Failed to save token calibration:', error);
    }
  }
  return next;
}

// The configured limit expressed in local-estimate tokens: what the model will count as the limit.
function correctedLimit(limit, ratio) {
  if (limit == null) return null;
  return Math.max(1, Math.floor(Number(limit) / clampRatio(Number(ratio) || UNMEASURED_RATIO)));
}

function forgetTokenCalibration(apiProfileId) {
  const prefix = JSON.stringify([String(apiProfileId)]).slice(0, -1) + ',';
  for (const key of [...ratios.keys()]) {
    if (key.startsWith(prefix)) ratios.delete(key);
  }
}

function clearTokenCalibration() {
  ratios.clear();
  store = null;
  storeLoaded = false;
}

module.exports = {
  UNMEASURED_RATIO,
  MIN_SAMPLE_TOKENS,
  tokenRatio,
  measuredRatio,
  recordTokenCount,
  correctedLimit,
  useTokenCalibrationStore,
  forgetTokenCalibration,
  clearTokenCalibration
};
