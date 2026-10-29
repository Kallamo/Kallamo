'use strict';

// Where a cache breakpoint may go, and when one pays. The reasoning is in docs/prompt-cache.md.

const PROMPT_CACHE_CONTRACT = Object.freeze({
    // The usual floor; cacheMinimumTokens knows the models that ask for more or less. A prefix
    // under the floor is sent uncached without an error, so a wrong guess only wastes a marker.
    minimumPrefixTokens: 1024,
    // Under five minutes: an entry's lifetime runs from the start of the request that wrote it.
    shortTtlPaceMs: 4 * 60 * 1000,
    // Past this pace even the hour-long entry has usually expired by the next turn.
    longTtlPaceMs: 55 * 60 * 1000,
    // A gap this long is a new session, not the pace of play.
    sessionBreakMs: 2 * 60 * 60 * 1000,
    // Recent in-session gaps that set the pace; their median ignores one long pause.
    paceSampleTurns: 5,
    // Two reuses already beat the write surcharge, so giving up takes several misses.
    missesBeforeCooldown: 3,
    // Requests skipped before probing the cache again after a cooldown.
    cooldownRequests: 6,
    // Released at once when the anchored window stops fitting, so the next turns stay byte-identical.
    reanchorHeadroomRatio: 0.2
});

// A rough count is enough: a wrong guess only costs an ignored breakpoint.
function roughTokens(text) {
    if (!text) return 0;
    return Math.ceil(String(text).length / 4);
}

function normalizeProvider(provider) {
    return String(provider || '').trim().toLowerCase();
}

const isClaude = model => /claude|anthropic/.test(String(model || '').toLowerCase());
const isGemini = model => /gemini|google\//.test(String(model || '').toLowerCase());

// Where Kallamo places the markers itself; every other route caches on its own or not at all.
// Gemini on OpenRouter reads only the last marker. Routes are in docs/prompt-cache.md.
function cacheStyleFor(provider, model) {
    const normalized = normalizeProvider(provider);
    if (normalized === 'anthropic') return 'anthropic';
    if (normalized === 'aws bedrock') return isClaude(model) ? 'bedrock' : null;
    if (normalized === 'openrouter') return isClaude(model) || isGemini(model) ? 'openai-parts' : null;
    return null;
}

// 'explicit': Kallamo places markers. 'automatic': the provider reuses a stable prefix by itself.
// Either way the response reports what was read, which is what counts.
function cacheModeFor(provider, model) {
    if (cacheStyleFor(provider, model)) return 'explicit';
    const normalized = normalizeProvider(provider);
    if (['openai', 'openrouter', 'google ai', 'vertex ai', 'aws bedrock', 'local'].includes(normalized)) return 'automatic';
    return 'none';
}

// Shortest prefix each model caches, from the providers' own tables (2026-10). Unknown models get
// the usual floor.
function cacheMinimumTokens(provider, model) {
    const id = String(model || '').toLowerCase();
    if (isClaude(id)) {
        if (/(opus|sonnet|haiku|fable|mythos)-5|claude-5/.test(id) && !/sonnet-5(?![-.]5)/.test(id)) return 512;
        if (/opus-4-[56]|haiku-4-5/.test(id)) return 4096;
        if (/opus-4-7|haiku-3-5|mythos-preview/.test(id)) return 2048;
        return 1024;
    }
    if (isGemini(id)) return /gemini-2\.5/.test(id) ? 2048 : 4096;
    return PROMPT_CACHE_CONTRACT.minimumPrefixTokens;
}

// The hour costs more to write, so it only pays when turns outlast five minutes but not the hour.
// null means no lifetime pays.
function cacheTtlForPace(gapsMs) {
    const gaps = (gapsMs || [])
        .filter(gap => Number.isFinite(gap) && gap >= 0 && gap < PROMPT_CACHE_CONTRACT.sessionBreakMs)
        .slice(-PROMPT_CACHE_CONTRACT.paceSampleTurns);
    if (gaps.length < 2) return '5m';
    const sorted = [...gaps].sort((a, b) => a - b);
    const median = sorted[Math.floor((sorted.length - 1) / 2)];
    if (median <= PROMPT_CACHE_CONTRACT.shortTtlPaceMs) return '5m';
    if (median <= PROMPT_CACHE_CONTRACT.longTtlPaceMs) return '1h';
    return null;
}

// Profiles and models that refused the hour-long lifetime this session, so they
// are offered five minutes instead.
const longTtlRefusals = new Set();

function longTtlKey(apiProfileId, model) {
    return `${apiProfileId}\u0000${model}`;
}

function markLongTtlRefused(apiProfileId, model) {
    longTtlRefusals.add(longTtlKey(apiProfileId, model));
}

function isLongTtlRefused(apiProfileId, model) {
    return longTtlRefusals.has(longTtlKey(apiProfileId, model));
}

// In memory on purpose: provider entries expire long before a restart matters.
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

// `placement` 'turn' puts the volatile context behind the history, so only then can the history be cached.
// Policy 'transcript' marks a research transcript that only grows.
function planPromptCache({
    provider,
    model,
    baseUrl = '',
    policy = 'none',
    placement = 'system',
    scopeId = '',
    stableText = '',
    historyChars = 0,
    historyLength = 0,
    ttl = '5m'
} = {}) {
    const style = cacheStyleFor(provider, model);
    const inert = { style: null, systemBreakpoint: false, historyBreakpoint: false, transcriptBreakpoint: false, ttl: '5m', reason: '' };

    if (policy === 'transcript') {
        // The automatic field is Anthropic's own endpoint only; a custom base URL may know neither form.
        const marks = style === 'bedrock' || style === 'openai-parts' || (style === 'anthropic' && !baseUrl);
        return marks ? { ...inert, style, transcriptBreakpoint: true, reason: 'marked' } : { ...inert, reason: 'provider-automatic' };
    }

    // A one-shot call never sees its prefix again, so a mark would be a write with no read.
    if (policy !== 'conversation') return { ...inert, reason: 'policy-off' };
    if (!style) return { ...inert, reason: 'provider-automatic' };
    if (ttl === null) return { ...inert, reason: 'pace-too-slow' };

    const scope = readScope(scopeId);
    if (scope && scope.skipsLeft > 0) {
        scope.skipsLeft -= 1;
        return { ...inert, reason: 'cooldown' };
    }

    const stableTokens = roughTokens(stableText);
    const minimum = cacheMinimumTokens(provider, model);
    const systemBreakpoint = stableTokens >= minimum;

    // With the context in the system prompt, every turn rewrites the prefix ahead of the history.
    const historyBreakpoint = placement === 'turn'
        && historyLength > 0
        && stableTokens + Math.ceil(Math.max(0, historyChars) / 4) >= minimum;

    if (!systemBreakpoint && !historyBreakpoint) {
        return { ...inert, reason: 'prefix-too-short' };
    }

    return {
        style,
        systemBreakpoint,
        historyBreakpoint,
        transcriptBreakpoint: false,
        // OpenRouter is not known to forward the hour-long lifetime, so it keeps the default.
        ttl: ttl === '1h' && style !== 'openai-parts' ? '1h' : '5m',
        reason: 'marked'
    };
}

// Writes with no reads mean the prefix does not survive to the next turn, so marking pauses.
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

// The history window pins its first message, since retrieval moves the budget every turn.

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
    cacheMinimumTokens,
    cacheModeFor,
    cacheStyleFor,
    cacheTtlForPace,
    getScopeStats,
    isLongTtlRefused,
    markLongTtlRefused,
    planPromptCache,
    readHistoryAnchor,
    recordCacheOutcome,
    resetAllScopes,
    resetScope,
    roughTokens,
    writeHistoryAnchor
};
