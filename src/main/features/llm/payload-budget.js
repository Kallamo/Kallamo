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
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return normalizeMaxApiPayload(fallback, contract.defaultMaxPayloadTokens);
  return Math.min(
    contract.maximumMaxPayloadTokens,
    Math.max(contract.minimumMaxPayloadTokens, Math.floor(parsed))
  );
}

function estimatePayloadTokens({
  systemPrompt = '',
  chatHistory = [],
  newPrompt = '',
  attachedImageCount = 0,
  outputTokens = 0
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
  return {
    inputTokens,
    reservedOutputTokens,
    safetyMarginTokens: contract.safetyMarginTokens,
    totalTokens: inputTokens + reservedOutputTokens + contract.safetyMarginTokens
  };
}

function getAvailableHistoryTokens({
  maxPayloadTokens,
  systemPrompt = '',
  newPrompt = '',
  attachedImageCount = 0,
  outputTokens = 0
}) {
  const maximum = normalizeMaxApiPayload(maxPayloadTokens);
  const fixed = estimatePayloadTokens({
    systemPrompt,
    newPrompt,
    attachedImageCount,
    outputTokens
  });
  return Math.max(0, maximum - fixed.totalTokens);
}

function assertPayloadWithinLimit(input) {
  if (input.maxPayloadTokens == null) return null;
  const maximum = normalizeMaxApiPayload(input.maxPayloadTokens);
  const estimate = estimatePayloadTokens(input);
  if (estimate.totalTokens <= maximum) return { ...estimate, maxPayloadTokens: maximum };

  const error = new Error(
    `This request was stopped before contacting the API because its estimated payload ` +
    `(${estimate.totalTokens.toLocaleString()} tokens, including ${estimate.reservedOutputTokens.toLocaleString()} ` +
    `reserved for the response) exceeds this workspace's MAX API Payload of ` +
    `${maximum.toLocaleString()} tokens. Reduce constant knowledge, attachments, or the requested response size, ` +
    `or raise MAX API Payload in Workspace Configuration.`
  );
  error.code = 'MAX_API_PAYLOAD_EXCEEDED';
  error.payloadEstimate = { ...estimate, maxPayloadTokens: maximum };
  throw error;
}

module.exports = {
  PAYLOAD_BUDGET_CONTRACT: contract,
  assertPayloadWithinLimit,
  estimatePayloadTokens,
  estimateTokens,
  getAvailableHistoryTokens,
  normalizeMaxApiPayload
};
