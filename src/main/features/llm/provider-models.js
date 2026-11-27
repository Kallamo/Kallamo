const { parseExtraHeaders } = require('./connection-options');

const LIST_TIMEOUT_MS = 15000;
const MAX_PAGES = 10;

const DEFAULT_BASES = {
    openai: 'https://api.openai.com/v1',
    openrouter: 'https://openrouter.ai/api/v1',
    anthropic: 'https://api.anthropic.com/v1',
    'google ai': 'https://generativelanguage.googleapis.com/v1beta',
};

const LISTING_PROVIDERS = ['openai', 'openrouter', 'local', 'anthropic', 'google ai'];

// A base URL may be saved as a full endpoint; the list sits next to it. Google's saved URL names
// one model's endpoint, so its list always comes from the default base.
function modelsUrl(provider, baseUrl) {
    const key = String(provider || '').toLowerCase();
    const saved = key === 'google ai' ? '' : String(baseUrl || '').trim().replace(/\/+$/, '')
        .replace(/\/(?:chat\/completions|embeddings|messages)$/, '');
    const base = saved || DEFAULT_BASES[key];
    if (!base) throw new Error('Enter the base URL first, ending in /v1.');
    return `${base}/models`;
}

function requestFor(key, apiKey) {
    const token = String(apiKey || '').trim();
    if (key === 'anthropic') {
        if (!token) throw new Error('Enter the API key first.');
        return { headers: { 'x-api-key': token, 'anthropic-version': '2023-06-01' }, query: { limit: '1000' } };
    }
    if (key === 'google ai') {
        if (!token) throw new Error('Enter the API key first.');
        return { headers: { 'x-goog-api-key': token }, query: { pageSize: '1000' } };
    }
    return { headers: token ? { Authorization: `Bearer ${token}` } : {}, query: {} };
}

// Anthropic pages with after_id, Google with pageToken; OpenAI-style lists come whole.
function nextPage(key, body) {
    if (key === 'anthropic' && body?.has_more && body?.last_id) return { after_id: body.last_id };
    if (key === 'google ai' && body?.nextPageToken) return { pageToken: body.nextPageToken };
    return null;
}

function readIds(key, body) {
    const entries = Array.isArray(body?.data) ? body.data : Array.isArray(body?.models) ? body.models : null;
    if (!entries) return null;
    return entries
        .filter(entry => key !== 'google ai' || !Array.isArray(entry?.supportedGenerationMethods)
            || entry.supportedGenerationMethods.some(method => ['generateContent', 'embedContent'].includes(method)))
        .map(entry => String(entry?.id || entry?.name || '').trim().replace(/^models\//, ''))
        .filter(Boolean);
}

async function fetchPage(url, headers, fetchImpl) {
    let response;
    try {
        response = await fetchImpl(url, { method: 'GET', headers, signal: AbortSignal.timeout(LIST_TIMEOUT_MS) });
    } catch (error) {
        throw new Error(error?.name === 'TimeoutError' ? 'Could not list models: the server did not answer in time.' : `Could not reach ${url.split('?')[0]}.`);
    }
    if (!response.ok) {
        const reason = [400, 401, 403].includes(response.status) ? 'the API key was refused' : `HTTP ${response.status}`;
        throw new Error(`Could not list models: ${reason}.`);
    }
    return response.json().catch(() => null);
}

async function listProviderModels({ provider, baseUrl, apiKey, extraHeaders = '' }, fetchImpl = fetch) {
    const key = String(provider || '').toLowerCase();
    if (!LISTING_PROVIDERS.includes(key)) throw new Error('This provider does not list its models here.');
    const { headers: base, query } = requestFor(key, apiKey);
    const headers = ['openai', 'openrouter', 'local'].includes(key) ? { ...parseExtraHeaders(extraHeaders), ...base } : base;
    const root = modelsUrl(key, baseUrl);
    const ids = [];
    let page = {};
    for (let count = 0; page && count < MAX_PAGES; count++) {
        const params = new URLSearchParams({ ...query, ...page }).toString();
        const body = await fetchPage(params ? `${root}?${params}` : root, headers, fetchImpl);
        const found = readIds(key, body);
        if (!found) throw new Error('The server answered, but not with a list of models.');
        ids.push(...found);
        page = nextPage(key, body);
    }
    return [...new Set(ids)].sort((left, right) => left.localeCompare(right));
}

module.exports = { listProviderModels, modelsUrl };
