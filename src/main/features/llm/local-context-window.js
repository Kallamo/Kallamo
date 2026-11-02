// A local server runs with the context size it was started with, and cuts anything longer from the
// front, system prompt first, without saying so. Each server reports that size on an endpoint of its
// own; the size found counts as the connection's limit until the user sets one.
const PROBE_TIMEOUT_MS = 1500;
// A turn asks before it measures anything, so the answer is reused for a while instead of on every turn.
const RECHECK_AFTER_MS = 60_000;

// `${profileId}\0${model}`, or `${profileId}\0*` when the server holds one model whatever is named.
const detected = new Map();
const checkedAt = new Map();

// The OpenAI-compatible routes live under /v1; the servers' own endpoints sit at the root.
function serverRoot(baseUrl) {
    try {
        const url = new URL(String(baseUrl || '').trim());
        url.pathname = url.pathname.replace(/\/v1(\/.*)?$/, '').replace(/\/+$/, '');
        url.search = '';
        url.hash = '';
        return url.toString().replace(/\/+$/, '');
    } catch {
        return null;
    }
}

const positive = value => {
    const parsed = Math.floor(Number(value));
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const sameModel = (left, right) => {
    const normalize = value => String(value || '').toLowerCase().replace(/:latest$/, '');
    return Boolean(left && right) && normalize(left) === normalize(right);
};

// Each probe answers for one server family. `perModel` marks the ones whose size depends on the model.
const PROBES = [
    // KoboldCpp
    { path: '/api/extra/true_max_context_length', read: body => positive(body?.value) },
    // llama.cpp server, per slot
    { path: '/props', read: body => positive(body?.default_generation_settings?.n_ctx ?? body?.n_ctx) },
    // LM Studio
    {
        path: '/api/v0/models',
        perModel: true,
        read: (body, model) => {
            const loaded = (body?.data || []).filter(entry => entry?.state === 'loaded');
            const match = loaded.find(entry => sameModel(entry.id, model)) || (loaded.length === 1 ? loaded[0] : null);
            return positive(match?.loaded_context_length);
        }
    },
    // Ollama, for a model already loaded
    {
        path: '/api/ps',
        perModel: true,
        read: (body, model) => {
            const match = (body?.models || []).find(entry => sameModel(entry.name, model) || sameModel(entry.model, model));
            return positive(match?.context_length);
        }
    }
];

async function readJson(url, fetchImpl) {
    const response = await fetchImpl(url, { method: 'GET', signal: AbortSignal.timeout(PROBE_TIMEOUT_MS) });
    if (!response.ok) return null;
    return response.json();
}

/** The context size the server at `baseUrl` runs `model` with, or null when it does not say. */
async function probeContextWindow({ baseUrl, model }, fetchImpl = fetch) {
    const root = serverRoot(baseUrl);
    if (!root) return null;
    for (const probe of PROBES) {
        try {
            const window = probe.read(await readJson(`${root}${probe.path}`, fetchImpl), model);
            if (window) return { window, perModel: Boolean(probe.perModel) };
        } catch {
            // Another server family, or nothing listening.
        }
    }
    return null;
}

function modelsOf(profile) {
    try {
        const models = typeof profile.models === 'string' ? JSON.parse(profile.models || '[]') : profile.models;
        return Array.isArray(models) ? models.map(String).filter(Boolean) : [];
    } catch {
        return [];
    }
}

function forget(profileId) {
    for (const key of detected.keys()) if (key.startsWith(`${profileId}\u0000`)) detected.delete(key);
}

/** Asks one local connection again, for each of its models; a server that stopped answering is forgotten. */
async function refreshContextWindow(profile, fetchImpl = fetch, { force = false } = {}) {
    if (!profile?.id || String(profile.provider || '').toLowerCase() !== 'local') return;
    const key = `${profile.baseUrl}\u0000${profile.models}`;
    const last = checkedAt.get(profile.id);
    if (!force && last?.key === key && Date.now() - last.at < RECHECK_AFTER_MS) return;
    checkedAt.set(profile.id, { key, at: Date.now() });
    const models = modelsOf(profile);
    const found = new Map();
    for (const model of models.length ? models : ['']) {
        const result = await probeContextWindow({ baseUrl: profile.baseUrl, model }, fetchImpl);
        if (!result) continue;
        found.set(result.perModel ? model : '*', result.window);
        if (!result.perModel) break;
    }
    forget(profile.id);
    for (const [model, window] of found) detected.set(`${profile.id}\u0000${model}`, window);
}

async function refreshLocalContextWindows(database, fetchImpl = fetch, options = {}) {
    let profiles = [];
    try {
        profiles = database.prepare('SELECT id, provider, baseUrl, models FROM api_profiles').all();
    } catch {
        return;
    }
    await Promise.all(profiles.map(profile => refreshContextWindow(profile, fetchImpl, options).catch(() => {})));
}

function detectedContextWindow(profileId, model = null) {
    if (!profileId) return null;
    return detected.get(`${profileId}\u0000${model || ''}`) ?? detected.get(`${profileId}\u0000*`) ?? null;
}

/** The largest size found per connection, for showing next to it. */
function detectedContextWindows() {
    const result = {};
    for (const [key, window] of detected) {
        const profileId = key.split('\u0000')[0];
        result[profileId] = Math.max(result[profileId] || 0, window);
    }
    return result;
}

module.exports = {
    detectedContextWindow,
    detectedContextWindows,
    probeContextWindow,
    refreshContextWindow,
    refreshLocalContextWindows,
    serverRoot
};
