const OPENAI_COMPATIBLE = new Set(['openai', 'openrouter', 'local']);
const GOOGLE = new Set(['google ai', 'vertex ai']);

const OUTPUT_LIMIT_REASONS = new Set(['length', 'max_tokens', 'max_output_tokens', 'model_length', 'finish_reason_length']);

// Fields are kept as each provider reports them. `totalInputTokens` is the comparable figure:
// Anthropic counts cache reads and writes apart from the rest of the input.
function readUsage(provider, data) {
  const p = String(provider || '').toLowerCase();
  const count = value => (value == null || !Number.isFinite(Number(value)) ? null : Number(value));
  if (OPENAI_COMPATIBLE.has(p)) {
    const usage = data?.usage || {};
    const inputTokens = count(usage.prompt_tokens);
    return {
      inputTokens,
      outputTokens: count(usage.completion_tokens),
      cacheReadTokens: count(usage.prompt_tokens_details?.cached_tokens),
      cacheWriteTokens: null,
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
  // Cache counters, normalized across wire formats. Anthropic reports them
  // beside input_tokens and excludes them from it; OpenAI reports cached tokens
  // nested in prompt_tokens_details and already inside prompt_tokens; Google
  // reports cachedContentTokenCount. inputTokens keeps each provider's own
  // meaning so existing budget and truncation callers are untouched, and
  // uncachedInputTokens gives the one number that means the same everywhere.
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
    ?? 0
  );
  const safeRead = Number.isFinite(cacheReadTokens) ? Math.max(0, cacheReadTokens) : 0;
  const safeWrite = Number.isFinite(cacheWriteTokens) ? Math.max(0, cacheWriteTokens) : 0;
  const safeInput = Number.isFinite(inputTokens) ? inputTokens : 0;
  // OpenAI-style providers fold cached tokens into the prompt total; Anthropic
  // keeps them separate. Subtracting only when they are folded in keeps the
  // billed-at-full-price figure honest on both.
  const foldsCacheIntoInput = !['anthropic', 'aws bedrock'].includes(normalizedProvider);

  return {
    finishReason,
    truncated: OUTPUT_LIMIT_REASONS.has(normalizedReason),
    usage,
    inputTokens: safeInput,
    outputTokens: Number.isFinite(outputTokens) ? outputTokens : 0,
    cacheReadTokens: safeRead,
    cacheWriteTokens: safeWrite,
    // Comparable across providers: what the payload limit calibration learns from.
    totalInputTokens: readUsage(normalizedProvider, data).totalInputTokens,
    uncachedInputTokens: foldsCacheIntoInput
      ? Math.max(0, safeInput - safeRead)
      : safeInput
  };
}

module.exports = { getResponseMetadata, readUsage };
