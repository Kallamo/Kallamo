const { fetch: undiciFetch } = require('undici');
const { buildRequest, parseStreamChunk, parseStreamUsage, sendApiRequest, generationDispatcher, readHttpErrorMessage } = require('./llm.service');
const { getResponseMetadata } = require('./response-metadata');
const { recordCacheOutcome } = require('./prompt-cache');

// Providers with no text-SSE stream fall back to the non-streaming path.
const STREAM_UNSUPPORTED = new Set(['aws bedrock']);

// Stream a generation token by token. onDelta({ contentDelta, reasoningDelta })
// fires for each incremental piece so the caller can render live; the full text
// is accumulated here and returned in the same canonical shape sendApiRequest
// produces, so the saved artifact is identical whether or not streaming was used.
// On abort mid-stream the partial text collected so far is returned, not lost.
async function sendApiRequestStream(params, onDelta, onStreamStart) {
    const { endpoint, requestHeaders, requestBodyPayload, provider, cachePlan } = await buildRequest({ ...params, stream: true });

    if (STREAM_UNSUPPORTED.has(provider)) {
        return sendApiRequest(params);
    }

    let content = '';
    let reasoning = '';
    // Providers spread usage over several frames (Anthropic sends input and cache
    // counters on message_start, output on message_delta), so they are merged
    // rather than replaced.
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
        params.onUsage?.(metadata);
    };
    // Parity with parseResponse: a jsonMode caller parses the reply as an object,
    // so reasoning is dropped instead of being prepended.
    const finalize = () => (reasoning && !params.jsonMode ? `<think>${reasoning}</think>${content}` : content);

    try {
        const response = await undiciFetch(endpoint, {
            method: "POST",
            headers: requestHeaders,
            body: requestBodyPayload,
            signal: params.abortSignal,
            dispatcher: generationDispatcher
        });

        if (!response.ok) {
            throw new Error(await readHttpErrorMessage(response));
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

                const frameUsage = parseStreamUsage(obj, provider);
                if (frameUsage) usage = { ...(usage || {}), ...frameUsage };

                const { contentDelta, reasoningDelta } = parseStreamChunk(obj, provider);
                if (contentDelta) content += contentDelta;
                if (reasoningDelta) reasoning += reasoningDelta;
                if ((contentDelta || reasoningDelta) && onDelta) {
                    onStreamStart?.();
                    onDelta({ contentDelta, reasoningDelta });
                }
            }
        }

        reportUsage();
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
