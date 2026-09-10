const { estimateTokens, PAYLOAD_BUDGET_CONTRACT } = require('../llm/payload-budget');
const { stripLeadingStoryEvidenceMarkers } = require('../kanora/roleplay-history');
const { PROMPT_CACHE_CONTRACT, readHistoryAnchor, writeHistoryAnchor } = require('../llm/prompt-cache');

function prepareHistoryEntry(msg) {
    let content = stripLeadingStoryEvidenceMarkers(msg.content);

    if (msg.attachedFiles) {
        let files = [];
        try {
            files = typeof msg.attachedFiles === 'string'
                ? JSON.parse(msg.attachedFiles)
                : msg.attachedFiles;
        } catch (e) { }

        if (Array.isArray(files) && files.length > 0) {
            const fileMarkers = files.map(f => `File - ${f.name}`).join('\n');
            content = `${fileMarkers}\n${content}`;
        }
    }

    return {
        id: msg.id,
        role: msg.role,
        content,
        tokens: estimateTokens(content) + PAYLOAD_BUDGET_CONTRACT.messageOverheadTokens
    };
}

// Index of the earliest message whose suffix still fits `limit`, walking back
// from the newest. Returns entries.length when nothing fits.
function findWindowStart(entries, limit) {
    let used = 0;
    let start = entries.length;
    for (let i = entries.length - 1; i >= 0; i--) {
        if (used + entries[i].tokens > limit) break;
        used += entries[i].tokens;
        start = i;
    }
    return start;
}

// Format history messages into a standard list, respecting max context tokens.
//
// With a cache scope the window is anchored: the first message stays put across
// turns so the message prefix a provider already cached is still a prefix of the
// next request. Without an anchor the window takes the longest fitting suffix
// every time, and since the budget moves with the size of the retrieved context,
// the first message moves with it and rewrites the prefix even on turns where
// nothing actually had to be dropped.
function formatActiveHistory(messages, maxTokensAllowed, cacheScopeId = null) {
    const entries = messages.map(prepareHistoryEntry);
    const anchorId = cacheScopeId ? readHistoryAnchor(cacheScopeId) : null;

    let start = -1;
    if (anchorId) {
        const anchorIndex = entries.findIndex(entry => entry.id === anchorId);
        if (anchorIndex >= 0) {
            const anchoredCost = entries
                .slice(anchorIndex)
                .reduce((total, entry) => total + entry.tokens, 0);
            if (anchoredCost <= maxTokensAllowed) start = anchorIndex;
        }
    }

    if (start < 0) {
        // Re-anchoring releases a slice of the budget in one step. Dropping a
        // single message per turn instead would keep the window fitting while
        // moving its first byte every turn, which is the one shape a prefix
        // cache can never reuse.
        const headroom = cacheScopeId
            ? Math.floor(maxTokensAllowed * (1 - PROMPT_CACHE_CONTRACT.reanchorHeadroomRatio))
            : maxTokensAllowed;
        start = findWindowStart(entries, headroom);
        // Never let the headroom empty a window the full budget could carry.
        if (start >= entries.length && entries.length > 0) {
            start = findWindowStart(entries, maxTokensAllowed);
        }
    }

    const history = entries.slice(start).map(entry => ({ role: entry.role, content: entry.content }));
    if (cacheScopeId) {
        writeHistoryAnchor(cacheScopeId, entries[start]?.id || null);
    }

    // Anything cut here is live history that was never archived, so there is no
    // memory chunk to retrieve it from. Worth saying, even if only in the log.
    const dropped = messages.length - history.length;
    if (dropped > 0) {
        console.warn(`[Context] ${dropped} unarchived message(s) did not fit the payload budget and were not sent. Archiving them would keep them searchable.`);
    }
    return history;
}

module.exports = { findWindowStart, formatActiveHistory, prepareHistoryEntry };
