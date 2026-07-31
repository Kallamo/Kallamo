const OUTPUT_LIMIT_REASONS = new Set(['length', 'max_tokens', 'max_output_tokens', 'model_length', 'finish_reason_length']);

function getResponseMetadata(data, provider) {
  const normalizedProvider = String(provider || '').toLowerCase();
  let finishReason = null;
  let usage = null;

  if (['openai', 'openrouter', 'local'].includes(normalizedProvider)) {
    finishReason = data?.choices?.[0]?.finish_reason ?? null;
    usage = data?.usage ?? null;
  } else if (normalizedProvider === 'anthropic' || normalizedProvider === 'aws bedrock') {
    finishReason = data?.stop_reason ?? data?.stopReason ?? null;
    usage = data?.usage ?? null;
  } else if (normalizedProvider === 'google ai' || normalizedProvider === 'vertex ai') {
    finishReason = data?.candidates?.[0]?.finishReason ?? null;
    usage = data?.usageMetadata ?? null;
  }

  const normalizedReason = String(finishReason || '').trim().toLowerCase();
  const inputTokens = Number(
    usage?.prompt_tokens
    ?? usage?.input_tokens
    ?? usage?.inputTokens
    ?? usage?.promptTokenCount
    ?? 0
  );
  const outputTokens = Number(
    usage?.completion_tokens
    ?? usage?.output_tokens
    ?? usage?.outputTokens
    ?? usage?.candidatesTokenCount
    ?? 0
  );
  return {
    finishReason,
    truncated: OUTPUT_LIMIT_REASONS.has(normalizedReason),
    usage,
    inputTokens: Number.isFinite(inputTokens) ? inputTokens : 0,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : 0
  };
}

module.exports = { getResponseMetadata };
