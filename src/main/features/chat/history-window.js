const { estimateTokens, PAYLOAD_BUDGET_CONTRACT } = require('../llm/payload-budget');
const { stripLeadingStoryEvidenceMarkers } = require('../narrative/roleplay-history');
const { stripReasoning } = require('./message-text');
const { PROMPT_CACHE_CONTRACT, readHistoryAnchor, writeHistoryAnchor } = require('../llm/prompt-cache');

// Reasoning is kept for display but never sent back to a model.
function prepareHistoryEntry(msg) {
    let content = stripReasoning(stripLeadingStoryEvidenceMarkers(msg.content || ''));

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
    if (msg.presenceNote) content = `${msg.presenceNote}\n${content}`;

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

// Plans without moving the anchor, so the room the budget reserves is what the final window takes.
function planActiveHistory(messages, maxTokensAllowed, cacheScopeId = null) {
    const entries = (Array.isArray(messages) ? messages : []).map(prepareHistoryEntry);
    const limit = Math.max(0, Math.floor(Number(maxTokensAllowed) || 0));
    const anchorId = cacheScopeId ? readHistoryAnchor(cacheScopeId) : null;

    let start = -1;
    if (anchorId) {
        const anchorIndex = entries.findIndex(entry => entry.id === anchorId);
        if (anchorIndex >= 0) {
            const anchoredCost = entries
                .slice(anchorIndex)
                .reduce((total, entry) => total + entry.tokens, 0);
            if (anchoredCost <= limit) start = anchorIndex;
        }
    }

    if (start < 0) {
        // Re-anchoring releases a slice of the budget in one step. Dropping one message per
        // turn would move the first byte every turn, which a prefix cache can never reuse.
        const headroom = cacheScopeId
            ? Math.floor(limit * (1 - PROMPT_CACHE_CONTRACT.reanchorHeadroomRatio))
            : limit;
        start = findWindowStart(entries, headroom);
        // Never let the headroom empty a window the full budget could carry.
        if (start >= entries.length && entries.length > 0) {
            start = findWindowStart(entries, limit);
        }
    }

    const kept = entries.slice(start);
    return {
        anchorId: entries[start]?.id || null,
        history: kept.map(entry => ({ role: entry.role, content: entry.content })),
        tokens: kept.reduce((total, entry) => total + entry.tokens, 0),
        dropped: entries.length - kept.length
    };
}

function selectActiveHistory(messages, maxTokensAllowed, cacheScopeId = null) {
    const plan = planActiveHistory(messages, maxTokensAllowed, cacheScopeId);
    if (cacheScopeId) writeHistoryAnchor(cacheScopeId, plan.anchorId);
    // Unarchived, so no memory chunk can retrieve what is cut here.
    if (plan.dropped > 0) {
        console.warn(`[Context] ${plan.dropped} unarchived message(s) did not fit the payload budget and were not sent. Archiving them would keep them searchable.`);
    }
    return { history: plan.history, tokens: plan.tokens, dropped: plan.dropped };
}

function formatActiveHistory(messages, maxTokensAllowed, cacheScopeId = null) {
    return selectActiveHistory(messages, maxTokensAllowed, cacheScopeId).history;
}

module.exports = { findWindowStart, formatActiveHistory, planActiveHistory, prepareHistoryEntry, selectActiveHistory };
