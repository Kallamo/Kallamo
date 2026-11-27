const crypto = require('crypto');

// Kallamo sets these itself; a header line may not replace them.
const RESERVED_HEADERS = new Set(['authorization', 'content-type', 'content-length', 'host']);
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;

/**
 * One `Name: value` per line; blank lines and lines starting with # are skipped. `{session}` becomes
 * a hash of the conversation, so a service can group a chat's requests without learning its id.
 */
function parseExtraHeaders(text, { sessionKey = null } = {}) {
    const session = sessionKey ? crypto.createHash('sha256').update(String(sessionKey)).digest('hex').slice(0, 32) : null;
    const headers = {};
    for (const raw of String(text || '').split(/\r?\n/)) {
        const line = raw.trim();
        if (!line || line.startsWith('#')) continue;
        const colon = line.indexOf(':');
        if (colon <= 0) continue;
        const name = line.slice(0, colon).trim();
        let value = line.slice(colon + 1).trim();
        if (!HEADER_NAME.test(name) || RESERVED_HEADERS.has(name.toLowerCase())) continue;
        if (value.includes('{session}')) {
            if (!session) continue;
            value = value.split('{session}').join(session);
        }
        if (/[\r\n]/.test(value)) continue;
        headers[name] = value;
    }
    return headers;
}

// Chat templates that leak write the next speaker's label on a line of its own.
const LOCAL_STOP_SEQUENCES = ['\nHuman:', '\nUser:', '\n[User]'];
const TURN_MARKER = /\n(?:Human:|User:|\[User\])/;

/** A reply cut where the model starts writing the user's turn, for servers that ignore `stop`. */
function cutAtTurnMarker(text) {
    if (typeof text !== 'string') return text;
    const match = TURN_MARKER.exec(text);
    return match ? text.slice(0, match.index).trimEnd() : text;
}

// Connections and models seen spending a whole reply on reasoning get the headroom from then on.
const learnedReasoning = new Set();
const reasoningKey = (apiProfileId, model) => `${apiProfileId}::${model}`;

function isLearnedReasoningModel(apiProfileId, model) {
    return learnedReasoning.has(reasoningKey(apiProfileId, model));
}

function learnReasoningModel(apiProfileId, model) {
    learnedReasoning.add(reasoningKey(apiProfileId, model));
}

// Reasoning arrives in its own field or inline as <think> that never closed.
function spentOnReasoning(data) {
    const message = data?.choices?.[0]?.message;
    if (!message) return false;
    const content = typeof message.content === 'string' ? message.content : '';
    const reasoning = message.reasoning_content || message.reasoning;
    if (reasoning && !content.trim()) return true;
    return /^\s*<think>/i.test(content) && !/<\/think>/i.test(content);
}

function resetLearnedReasoning() {
    learnedReasoning.clear();
}

module.exports = {
    LOCAL_STOP_SEQUENCES,
    cutAtTurnMarker,
    isLearnedReasoningModel,
    learnReasoningModel,
    parseExtraHeaders,
    resetLearnedReasoning,
    spentOnReasoning
};
