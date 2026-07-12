const { fetch: undiciFetch } = require('undici');
const { buildRequest, parseStreamChunk, sendApiRequest, generationDispatcher } = require('./llm.service');

// Providers with no text-SSE stream fall back to the non-streaming path.
const STREAM_UNSUPPORTED = new Set(['aws bedrock']);

// Stream a generation token by token. onDelta({ contentDelta, reasoningDelta })
// fires for each incremental piece so the caller can render live; the full text
// is accumulated here and returned in the same canonical shape sendApiRequest
// produces, so the saved artifact is identical whether or not streaming was used.
// On abort mid-stream the partial text collected so far is returned, not lost.
async function sendApiRequestStream(params, onDelta, onStreamStart) {
    const { endpoint, requestHeaders, requestBodyPayload, provider } = await buildRequest({ ...params, stream: true });

    if (STREAM_UNSUPPORTED.has(provider)) {
        return sendApiRequest(params);
    }

    let content = '';
    let reasoning = '';
    const finalize = () => (reasoning ? `<think>${reasoning}</think>${content}` : content);

    try {
        const response = await undiciFetch(endpoint, {
            method: "POST",
            headers: requestHeaders,
            body: requestBodyPayload,
            signal: params.abortSignal,
            dispatcher: generationDispatcher
        });

        if (!response.ok) {
            let errorMsg = response.statusText;
            try {
                const errorData = await response.json();
                errorMsg = errorData.error?.message || JSON.stringify(errorData);
            } catch (e) { }
            throw new Error(errorMsg);
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

                const { contentDelta, reasoningDelta } = parseStreamChunk(obj, provider);
                if (contentDelta) content += contentDelta;
                if (reasoningDelta) reasoning += reasoningDelta;
                if ((contentDelta || reasoningDelta) && onDelta) {
                    onStreamStart?.();
                    onDelta({ contentDelta, reasoningDelta });
                }
            }
        }

        return finalize();

    } catch (error) {
        if (error.name === 'AbortError') {
            return finalize();
        }
        console.error("Streaming API Request Failed:", error);
        throw error;
    }
}

module.exports = { sendApiRequestStream };
