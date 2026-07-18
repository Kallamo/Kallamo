function getResponseMetadata(data, provider) {
    const normalizedProvider = String(provider || '').toLowerCase();
    let finishReason = null;

    if (['openai', 'openrouter', 'local'].includes(normalizedProvider)) {
        finishReason = data.choices?.[0]?.finish_reason ?? null;
    } else if (normalizedProvider === 'anthropic') {
        finishReason = data.stop_reason ?? null;
    } else if (['google ai', 'vertex ai'].includes(normalizedProvider)) {
        finishReason = data.candidates?.[0]?.finishReason ?? null;
    } else if (normalizedProvider === 'aws bedrock') {
        finishReason = data.stop_reason ?? data.stopReason ?? null;
    }

    const normalizedReason = String(finishReason || '').toLowerCase();
    return {
        finishReason,
        truncated: ['length', 'max_tokens', 'max_output_tokens'].includes(normalizedReason)
    };
}

module.exports = { getResponseMetadata };
