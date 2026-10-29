const OPENAI_COMPATIBLE = new Set(['openai', 'openrouter', 'local']);
const GOOGLE = new Set(['google ai', 'vertex ai']);

const OUTPUT_LIMIT_REASONS = new Set(['length', 'max_tokens', 'max_output_tokens', 'model_length', 'finish_reason_length']);

// Bedrock replies in its model's own format; chat-completions models answer with `choices`.
function openAiShaped(provider, data) {
  return String(provider || '').toLowerCase() === 'aws bedrock' && Array.isArray(data?.choices);
}

// Fields are kept as each provider reports them. `totalInputTokens` is the comparable figure:
// Anthropic counts cache reads and writes apart from the rest of the input.
function readUsage(provider, data) {
  const p = openAiShaped(provider, data) ? 'openai' : String(provider || '').toLowerCase();
  const count = value => (value == null || !Number.isFinite(Number(value)) ? null : Number(value));
  if (OPENAI_COMPATIBLE.has(p)) {
    const usage = data?.usage || {};
    const inputTokens = count(usage.prompt_tokens);
    return {
      inputTokens,
      outputTokens: count(usage.completion_tokens),
      cacheReadTokens: count(usage.prompt_tokens_details?.cached_tokens),
      // Only routes that bill writes report them: OpenRouter's explicit markers, GPT-5.6 and later.
      cacheWriteTokens: count(usage.prompt_tokens_details?.cache_write_tokens),
      totalInputTokens: inputTokens
    };
  }
  if (p === 'anthropic' || p === 'aws bedrock') {
    const usage = data?.usage || {};
    const inputTokens = count(usage.input_tokens);
    const cacheReadTokens = count(usage.cache_read_input_tokens);
    const cacheWriteTokens = count(usage.cache_creation_input_tokens);
    return {
      inputTokens,
      outputTokens: count(usage.output_tokens),
      cacheReadTokens,
      cacheWriteTokens,
      totalInputTokens: inputTokens == null ? null : inputTokens + (cacheReadTokens || 0) + (cacheWriteTokens || 0)
    };
  }
  if (GOOGLE.has(p)) {
    const usage = data?.usageMetadata || {};
    const inputTokens = count(usage.promptTokenCount);
    return {
      inputTokens,
      outputTokens: count(usage.candidatesTokenCount),
      cacheReadTokens: count(usage.cachedContentTokenCount),
      cacheWriteTokens: null,
      totalInputTokens: inputTokens
    };
  }
  return { inputTokens: null, outputTokens: null, cacheReadTokens: null, cacheWriteTokens: null, totalInputTokens: null };
}

function getResponseMetadata(data, provider) {
  const normalizedProvider = openAiShaped(provider, data) ? 'openai' : String(provider || '').toLowerCase();
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
  // inputTokens keeps each provider's meaning; uncachedInputTokens is the one comparable everywhere.
  const cacheReadTokens = Number(
    usage?.cache_read_input_tokens
    ?? usage?.cacheReadInputTokens
    ?? usage?.prompt_tokens_details?.cached_tokens
    ?? usage?.promptTokensDetails?.cachedTokens
    ?? usage?.cachedContentTokenCount
    ?? 0
  );
  const cacheWriteTokens = Number(
    usage?.cache_creation_input_tokens
    ?? usage?.cacheCreationInputTokens
    ?? usage?.cacheWriteInputTokens
    ?? usage?.prompt_tokens_details?.cache_write_tokens
    ?? usage?.input_tokens_details?.cache_write_tokens
    ?? 0
  );
  // Anthropic splits writes by lifetime; the hour-long one costs twice the input instead of 1.25 times.
  const longWriteTokens = Number(usage?.cache_creation?.ephemeral_1h_input_tokens ?? 0);
  const safeRead = Number.isFinite(cacheReadTokens) ? Math.max(0, cacheReadTokens) : 0;
  const safeWrite = Number.isFinite(cacheWriteTokens) ? Math.max(0, cacheWriteTokens) : 0;
  const safeInput = Number.isFinite(inputTokens) ? inputTokens : 0;
  // Anthropic reports cached tokens apart from the input; OpenAI-style providers include them.
  const foldsCacheIntoInput = !['anthropic', 'aws bedrock'].includes(normalizedProvider);

  return {
    finishReason,
    truncated: OUTPUT_LIMIT_REASONS.has(normalizedReason),
    usage,
    inputTokens: safeInput,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : 0,
    cacheReadTokens: safeRead,
    cacheWriteTokens: safeWrite,
    cacheLongWriteTokens: Number.isFinite(longWriteTokens) ? Math.min(safeWrite, Math.max(0, longWriteTokens)) : 0,
    // Comparable across providers: what the payload limit calibration learns from.
    totalInputTokens: readUsage(normalizedProvider, data).totalInputTokens,
    uncachedInputTokens: foldsCacheIntoInput
      ? Math.max(0, safeInput - safeRead - safeWrite)
      : safeInput
  };
}

module.exports = { getResponseMetadata, readUsage };
