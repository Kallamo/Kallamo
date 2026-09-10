'use strict';

// Prompt caching is a prefix match: a provider reuses the leading tokens of a
// request only while those bytes are identical to an earlier one. Kallamo's
// payload is therefore split into a stable head (profile instructions, narration
// policy, constant knowledge) and a volatile tail (clock, retrieval,
// attachments), and this module decides where a breakpoint may be placed.
//
// The economics behind every rule here: a cache write costs about 1.25x the
// normal input price and a read about 0.1x, so a marked prefix pays for itself
// as soon as two requests reuse it inside the provider's TTL. A breakpoint on
// content that changes every turn is a pure 25% surcharge, which is why the
// volatile tail is never marked, why one-shot utility calls never opt in, and
// why a scope that keeps missing is put on cooldown.

const PROMPT_CACHE_CONTRACT = Object.freeze({
    // Anthropic silently declines to cache a prefix under its per-model minimum
    // (1024 tokens on the smallest tier). An ignored breakpoint is free, so this
    // floor only exists to avoid spending a breakpoint slot on nothing.
    minimumPrefixTokens: 1024,
    // Ephemeral entries live 5 minutes. Used to judge whether a scope has gone
    // cold rather than to gate a single request.
    ttlMs: 5 * 60 * 1000,
    // Consecutive marked requests that returned no read before the scope is put
    // on cooldown. Two reuses already beat the write surcharge, so the bar for
    // giving up is deliberately high.
    missesBeforeCooldown: 3,
    // Requests skipped before probing the cache again after a cooldown.
    cooldownRequests: 6,
    // Share of the history budget released when the anchored window stops
    // fitting. Trimming once by this much keeps the next several turns
    // byte-identical instead of dropping one message per turn and missing every
    // time.
    reanchorHeadroomRatio: 0.2
});

// Cheap gate-only estimate. The real tokenizer already runs once per request in
// payload-budget; re-encoding a full history here would double that cost for a
// threshold check whose only failure mode is an ignored breakpoint.
function roughTokens(text) {
    if (!text) return 0;
    return Math.ceil(String(text).length / 4);
}

function normalizeProvider(provider) {
    return String(provider || '').trim().toLowerCase();
}

// Which wire shape carries a breakpoint for this provider and model.
// - 'anthropic': native `system` block array plus content blocks on messages.
// - 'openai-parts': OpenAI-compatible content parts, which OpenRouter forwards
//   to Anthropic-backed models. Every other model it serves caches
//   automatically and ignores the field, so the model id is checked first.
// Bedrock is deliberately absent: its Anthropic passthrough validates the body
// schema and support varies by model and region, so an unknown field there is a
// hard request failure rather than a silent no-op.
function cacheStyleFor(provider, model) {
    const normalized = normalizeProvider(provider);
    if (normalized === 'anthropic') return 'anthropic';
    if (normalized === 'openrouter') {
        const id = String(model || '').toLowerCase();
        return id.includes('claude') || id.includes('anthropic') ? 'openai-parts' : null;
    }
    return null;
}

// Providers that cache automatically still reward a stable prefix, so callers
// use this to decide whether the ordering work is worth doing at all.
function benefitsFromStablePrefix(provider, model) {
    if (cacheStyleFor(provider, model)) return true;
    return ['openai', 'openrouter', 'google ai', 'vertex ai'].includes(normalizeProvider(provider));
}

// Per-conversation cache state. In-memory by design: entries expire on the
// provider side within minutes, so nothing here is worth persisting across an
// app restart.
const scopes = new Map();

function readScope(scopeId) {
    const key = String(scopeId || '');
    if (!key) return null;
    let scope = scopes.get(key);
    if (!scope) {
        scope = { anchorId: null, misses: 0, skipsLeft: 0, reads: 0, writes: 0, lastRequestAt: 0 };
        scopes.set(key, scope);
    }
    return scope;
}

function resetScope(scopeId) {
    scopes.delete(String(scopeId || ''));
}

function resetAllScopes() {
    scopes.clear();
}

// Decide the breakpoints for one request. `placement` says where the volatile
// context ends up: 'system' keeps today's composition, 'turn' moves it behind
// the history so the history itself becomes a reusable prefix.
function planPromptCache({
    provider,
    model,
    policy = 'none',
    placement = 'system',
    scopeId = '',
    stableText = '',
    historyChars = 0,
    historyLength = 0
} = {}) {
    const style = cacheStyleFor(provider, model);
    const inert = { style: null, systemBreakpoint: false, historyBreakpoint: false, reason: '' };

    // Only conversational traffic opts in. A one-shot utility call (triage,
    // summarization, tagging) never sees its prefix again, so marking it would
    // buy a 1.25x write against a read that cannot happen.
    if (policy !== 'conversation') return { ...inert, reason: 'policy-off' };
    if (!style) return { ...inert, reason: 'provider-automatic' };

    const scope = readScope(scopeId);
    if (scope && scope.skipsLeft > 0) {
        scope.skipsLeft -= 1;
        return { ...inert, reason: 'cooldown' };
    }

    const stableTokens = roughTokens(stableText);
    const systemBreakpoint = stableTokens >= PROMPT_CACHE_CONTRACT.minimumPrefixTokens;

    // A history breakpoint only pays off when nothing volatile precedes the
    // history. While the context still lives in the system prompt, every turn
    // rewrites the prefix, so the write would be billed and never read.
    const historyBreakpoint = placement === 'turn'
        && historyLength > 0
        && stableTokens + Math.ceil(Math.max(0, historyChars) / 4) >= PROMPT_CACHE_CONTRACT.minimumPrefixTokens;

    if (!systemBreakpoint && !historyBreakpoint) {
        return { ...inert, reason: 'prefix-too-short' };
    }

    return {
        style,
        systemBreakpoint,
        historyBreakpoint,
        reason: 'marked'
    };
}

// Feed the measured result of a marked request back into the scope. A run of
// writes with no reads means the prefix is not surviving to the next turn
// (long pauses, a prompt that keeps changing), so marking is paused instead of
// taxing every request by 25% forever.
function recordCacheOutcome(scopeId, { cacheReadTokens = 0, cacheWriteTokens = 0, marked = true } = {}) {
    const scope = readScope(scopeId);
    if (!scope) return null;
    scope.lastRequestAt = Date.now();
    if (!marked) return scope;

    scope.reads += Math.max(0, Number(cacheReadTokens) || 0);
    scope.writes += Math.max(0, Number(cacheWriteTokens) || 0);

    if (cacheReadTokens > 0) {
        scope.misses = 0;
        return scope;
    }
    if (cacheWriteTokens > 0) {
        scope.misses += 1;
        if (scope.misses >= PROMPT_CACHE_CONTRACT.missesBeforeCooldown) {
            scope.misses = 0;
            scope.skipsLeft = PROMPT_CACHE_CONTRACT.cooldownRequests;
        }
    }
    return scope;
}

function getScopeStats(scopeId) {
    const scope = scopes.get(String(scopeId || ''));
    if (!scope) return { reads: 0, writes: 0, cooling: false };
    return { reads: scope.reads, writes: scope.writes, cooling: scope.skipsLeft > 0 };
}

// --- HISTORY WINDOW ANCHORING ---
//
// A window that always takes the longest fitting suffix moves its first message
// whenever the budget shifts, and the budget shifts every turn because the
// retrieved context varies. That rewrites the message prefix constantly. The
// anchor pins the first message instead, and lets go only when the pinned window
// genuinely stops fitting.

function readHistoryAnchor(scopeId) {
    const scope = scopes.get(String(scopeId || ''));
    return scope ? scope.anchorId : null;
}

function writeHistoryAnchor(scopeId, anchorId) {
    const scope = readScope(scopeId);
    if (!scope) return;
    scope.anchorId = anchorId || null;
}

module.exports = {
    PROMPT_CACHE_CONTRACT,
    benefitsFromStablePrefix,
    cacheStyleFor,
    getScopeStats,
    planPromptCache,
    readHistoryAnchor,
    recordCacheOutcome,
    resetAllScopes,
    resetScope,
    roughTokens,
    writeHistoryAnchor
};
