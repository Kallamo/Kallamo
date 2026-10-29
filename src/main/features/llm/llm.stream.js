const { fetch: undiciFetch } = require('undici');
const { buildRequest, parseStreamChunk, sendApiRequest, generationDispatcher, readHttpErrorMessage, learnFromReportedTokens } = require('./llm.service');
const { getResponseMetadata } = require('./response-metadata');
const { recordCacheOutcome, markLongTtlRefused, cacheModeFor } = require('./prompt-cache');

// Providers with no text-SSE stream fall back to the non-streaming path.
const STREAM_UNSUPPORTED = new Set(['aws bedrock']);

const TRUNCATION_REASONS = new Set(['length', 'max_tokens', 'max_output_tokens']);

// Reasons that mean the provider withheld the reply rather than cut it short.
const BLOCKING_REASONS = new Set([
    'content_filter', 'refusal', 'safety', 'recitation', 'blocklist',
    'prohibited_content', 'spii', 'image_safety', 'language', 'other'
]);

function streamError(message, code) {
    const error = new Error(message);
    error.code = code;
    return error;
}

// Returns the same shape as sendApiRequest, so the saved reply is identical with or without streaming.
// A provider error event fails the stream instead of saving partial text; an abort returns what arrived.
async function sendApiRequestStream(params, onDelta, onStreamStart, dependencies = {}) {
    const { endpoint, requestHeaders, requestBodyPayload, provider, tokenSample, cachePlan } = await buildRequest({ ...params, stream: true }, dependencies);

    if (STREAM_UNSUPPORTED.has(provider)) {
        return sendApiRequest(params, dependencies);
    }

    let content = '';
    let reasoning = '';
    let finishReason = null;
    let reportedInputTokens = null;
    let learnedTokenRatio = null;
    // Providers spread usage over several frames (Anthropic sends input and cache counters on
    // message_start, output on message_delta), so they are merged rather than replaced.
    let usage = null;

    const reportUsage = () => {
        if (!usage) return;
        const body = provider === 'google ai' || provider === 'vertex ai'
            ? { usageMetadata: usage }
            : { usage };
        const metadata = getResponseMetadata(body, provider);
        if (params.promptCache?.scopeId) {
            recordCacheOutcome(params.promptCache.scopeId, {
                cacheReadTokens: metadata.cacheReadTokens,
                cacheWriteTokens: metadata.cacheWriteTokens,
                marked: Boolean(cachePlan?.systemBreakpoint || cachePlan?.historyBreakpoint)
            });
        }
        params.onUsage?.({ ...metadata, cacheMode: cacheModeFor(provider, params.model) });
    };
    // Parity with parseResponse: a jsonMode caller parses the reply as an object,
    // so reasoning is dropped instead of being prepended.
    const finalize = () => {
        const text = reasoning && !params.jsonMode ? `<think>${reasoning}</think>${content}` : content;
        if (!params.includeResponseMetadata) return text;
        return {
            content: text,
            finishReason,
            truncated: TRUNCATION_REASONS.has(String(finishReason || '').toLowerCase()),
            learnedTokenRatio
        };
    };

    try {
        const response = await undiciFetch(endpoint, {
            method: "POST",
            headers: requestHeaders,
            body: requestBodyPayload,
            signal: params.abortSignal,
            dispatcher: generationDispatcher
        });

        if (!response.ok) {
            const message = await readHttpErrorMessage(response);
            if (response.status === 400 && cachePlan?.ttl === '1h') {
                console.warn('[LLM] The provider refused the hour-long cache; retrying with five minutes:', message);
                markLongTtlRefused(params.apiProfileId, params.model);
                return sendApiRequestStream(params, onDelta, onStreamStart, dependencies);
            }
            throw new Error(message);
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buffer += decoder.decode(value, { stream: true });

            let idx;
            while ((idx = buffer.indexOf('\n')) >= 0) {
                const line = buffer.slice(0, idx).trim();
                buffer = buffer.slice(idx + 1);
                if (!line.startsWith('data:')) continue;

                const data = line.slice(5).trim();
                if (data === '[DONE]') continue;

                let obj;
                try { obj = JSON.parse(data); } catch (e) { continue; }

                const chunk = parseStreamChunk(obj, provider);
                if (chunk.usage) usage = { ...(usage || {}), ...chunk.usage };
                if (chunk.error) {
                    throw streamError(`The provider stopped the reply with an error: ${chunk.error}`, 'PROVIDER_ERROR');
                }
                if (chunk.inputTokens != null) reportedInputTokens = chunk.inputTokens;
                if (chunk.finishReason) finishReason = chunk.finishReason;
                if (chunk.contentDelta) content += chunk.contentDelta;
                if (chunk.reasoningDelta) reasoning += chunk.reasoningDelta;
                if ((chunk.contentDelta || chunk.reasoningDelta) && onDelta) {
                    onStreamStart?.();
                    onDelta({ contentDelta: chunk.contentDelta, reasoningDelta: chunk.reasoningDelta });
                }
            }
        }

        reportUsage();
        if (!content && BLOCKING_REASONS.has(String(finishReason || '').toLowerCase())) {
            throw streamError(`The provider stopped this reply (${finishReason}).`, 'PROVIDER_BLOCKED');
        }
        learnedTokenRatio = learnFromReportedTokens(tokenSample, reportedInputTokens);
        return finalize();

    } catch (error) {
        if (error.name === 'AbortError') {
            // An aborted turn was still billed for everything sent, so the cache
            // outcome is recorded before the partial text is returned.
            reportUsage();
            return finalize();
        }
        console.error("Streaming API Request Failed:", error);
        throw error;
    }
}

module.exports = { sendApiRequestStream };
