// How far the local token estimate falls short of what a model really counts, learned per
// connection, model and protocol from provider-reported usage. The estimate uses one fixed
// tokenizer, and models split the same text very differently, most of all outside English.

// Used until a model has reported its usage: the fixed tokenizer undercounted a Claude model
// by 29% to 38% on Portuguese text.
const DEFAULT_RATIO = 1.3;
// Never below the local count, so a model that counts fewer tokens cannot erode the margin.
const MIN_RATIO = 1;
const MAX_RATIO = 3;
// Small requests are dominated by framing overhead and would skew the ratio.
const MIN_SAMPLE_TOKENS = 500;
// The newest measurement weighs as much as everything before it.
const SMOOTHING = 0.5;

const ratios = new Map();

function clampRatio(value) {
  return Math.min(MAX_RATIO, Math.max(MIN_RATIO, value));
}

function tokenRatio(key) {
  return ratios.get(key) ?? DEFAULT_RATIO;
}

function recordTokenCount(key, estimatedTokens, reportedTokens) {
  const estimated = Number(estimatedTokens);
  const reported = Number(reportedTokens);
  if (!key || !Number.isFinite(estimated) || !Number.isFinite(reported) || estimated < MIN_SAMPLE_TOKENS || reported <= 0) {
    return tokenRatio(key);
  }
  const measured = clampRatio(reported / estimated);
  const previous = ratios.get(key);
  const next = previous == null ? measured : clampRatio(previous * (1 - SMOOTHING) + measured * SMOOTHING);
  ratios.set(key, next);
  return next;
}

function calibrateTokens(key, tokens) {
  return Math.ceil(Math.max(0, Number(tokens) || 0) * tokenRatio(key));
}

function clearTokenCalibration() {
  ratios.clear();
}

module.exports = {
  DEFAULT_RATIO,
  MIN_SAMPLE_TOKENS,
  tokenRatio,
  recordTokenCount,
  calibrateTokens,
  clearTokenCalibration
};
