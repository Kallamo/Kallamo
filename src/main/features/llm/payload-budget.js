const { encode } = require('gpt-tokenizer/encoding/o200k_base');
const contract = require('../../../shared/payload-budget.json');

function estimateTokens(value) {
  if (!value) return 0;
  try {
    return encode(String(value)).length;
  } catch {
    return Math.ceil(String(value).length / 4);
  }
}

function normalizeMaxApiPayload(value, fallback = contract.defaultMaxPayloadTokens) {
  if (value == null || String(value).trim() === '' || Number(value) === 0) {
    const safeFallback = fallback == null || String(fallback).trim() === '' || Number(fallback) === 0
      ? contract.defaultMaxPayloadTokens
      : fallback;
    return normalizeMaxApiPayload(safeFallback, contract.defaultMaxPayloadTokens);
  }
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return normalizeMaxApiPayload(fallback, contract.defaultMaxPayloadTokens);
  return Math.min(
    contract.maximumMaxPayloadTokens,
    Math.max(contract.minimumMaxPayloadTokens, Math.floor(parsed))
  );
}

// A resolved limit, corrected for how a model counts, may sit below the configurable minimum.
function payloadCeiling(value) {
  const parsed = Number(value);
  if (value != null && String(value).trim() !== '' && Number.isFinite(parsed) && parsed > 0) {
    return Math.min(contract.maximumMaxPayloadTokens, Math.floor(parsed));
  }
  return normalizeMaxApiPayload(value);
}

// Provider counts can exceed ours, especially outside English, so the margin scales with the limit.
function safetyMarginFor(maxPayloadTokens) {
  const maximum = Number(maxPayloadTokens);
  if (!Number.isFinite(maximum) || maximum <= 0) return contract.safetyMarginTokens;
  const ratio = Number(contract.safetyMarginRatio) || 0;
  return Math.max(contract.safetyMarginTokens, Math.ceil(maximum * ratio));
}

function estimatePayloadTokens({
  systemPrompt = '',
  chatHistory = [],
  newPrompt = '',
  attachedImageCount = 0,
  outputTokens = 0,
  maxPayloadTokens = null
}) {
  const messages = [
    systemPrompt,
    ...chatHistory.map(message => message?.content || ''),
    newPrompt
  ];
  const inputTokens = messages.reduce(
    (total, content) => total + estimateTokens(content) + contract.messageOverheadTokens,
    contract.requestOverheadTokens
  ) + Math.max(0, attachedImageCount) * contract.imageReserveTokens;
  const reservedOutputTokens = Math.max(0, Math.floor(Number(outputTokens) || 0));
  const safetyMarginTokens = maxPayloadTokens == null
    ? contract.safetyMarginTokens
    : safetyMarginFor(payloadCeiling(maxPayloadTokens));
  return {
    inputTokens,
    reservedOutputTokens,
    safetyMarginTokens,
    totalTokens: inputTokens + reservedOutputTokens + safetyMarginTokens
  };
}

function getAvailableHistoryTokens({
  maxPayloadTokens,
  systemPrompt = '',
  newPrompt = '',
  attachedImageCount = 0,
  outputTokens = 0
}) {
  const maximum = payloadCeiling(maxPayloadTokens);
  const fixed = estimatePayloadTokens({
    systemPrompt,
    newPrompt,
    attachedImageCount,
    outputTokens,
    maxPayloadTokens: maximum
  });
  return Math.max(0, maximum - fixed.totalTokens);
}

function formatTokens(value) {
  return Math.max(0, Math.round(Number(value) || 0)).toLocaleString();
}

// Retrieval and history are trimmed first, so an overflow means the fixed part alone is too large.
function describePayloadOverflow({ estimate, maximum, breakdown = null, limitSource = 'workspace', configured = null, tokenRatio = 1 }) {
  const fromConnection = limitSource === 'connection';
  const limitLabel = fromConnection
    ? 'the context window set on this API connection'
    : "this workspace's MAX API Payload";
  const corrected = configured != null && Number(tokenRatio) > 1 && configured > maximum;
  const exceeds = corrected
    ? `exceeds the ${formatTokens(maximum)} tokens that fit within ${limitLabel} of ${formatTokens(configured)} tokens. ` +
      `This model counts about ${Number(tokenRatio).toFixed(2)} times the tokens Kallamo estimates, measured from its own usage reports, so the limit was reduced to match.`
    : `exceeds ${limitLabel} of ${formatTokens(maximum)} tokens.`;
  let message =
    `This request was stopped before contacting the API because its estimated payload ` +
    `(${formatTokens(estimate.totalTokens)} tokens, including ${formatTokens(estimate.reservedOutputTokens)} ` +
    `reserved for the response) ${exceeds}`;
  if (breakdown) {
    message +=
      ` It holds about ${formatTokens(breakdown.fixed)} tokens of instructions, constant knowledge and attachments, ` +
      `${formatTokens(breakdown.retrieved)} of retrieved context and ${formatTokens(breakdown.history)} of chat history.`;
  }
  message += fromConnection
    ? ` Reduce constant knowledge or attachments, lower the profile's Max Tokens, or raise the connection's context window in Settings if the model accepts more.`
    : ` Reduce constant knowledge or attachments, lower the profile's Max Tokens, or raise MAX API Payload in Workspace Configuration.`;
  return message;
}

function assertPayloadWithinLimit(input) {
  if (input.maxPayloadTokens == null) return null;
  const maximum = payloadCeiling(input.maxPayloadTokens);
  const estimate = estimatePayloadTokens({ ...input, maxPayloadTokens: maximum });
  if (estimate.totalTokens <= maximum) return { ...estimate, maxPayloadTokens: maximum };

  const configured = input.configuredPayloadTokens ?? null;
  const tokenRatio = Number(input.tokenRatio) || 1;
  const error = new Error(describePayloadOverflow({
    estimate,
    maximum,
    breakdown: input.breakdown || null,
    limitSource: input.limitSource,
    configured,
    tokenRatio
  }));
  error.code = 'MAX_API_PAYLOAD_EXCEEDED';
  // Sending the same request again produces the same estimate.
  error.retryable = false;
  error.payloadEstimate = {
    ...estimate,
    maxPayloadTokens: maximum,
    configuredPayloadTokens: configured,
    tokenRatio,
    breakdown: input.breakdown || null
  };
  throw error;
}

module.exports = {
  PAYLOAD_BUDGET_CONTRACT: contract,
  assertPayloadWithinLimit,
  estimatePayloadTokens,
  estimateTokens,
  getAvailableHistoryTokens,
  normalizeMaxApiPayload,
  payloadCeiling,
  safetyMarginFor
};
