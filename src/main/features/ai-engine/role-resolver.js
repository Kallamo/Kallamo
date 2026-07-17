const db = require('../../database');

const ROLE_IDS = Object.freeze({
    SYSTEM: 'system',
    TAGGER: 'tagger',
    SUMMARIZER: 'summarizer',
    RETRIEVAL_PLANNER: 'retrievalPlanner'
});

const ROLE_DEFAULTS = Object.freeze({
    tagger: 'inherit-system',
    summarizer: 'inherit-system',
    retrievalPlanner: 'profile'
});

function readAdvancedSettings() {
    const row = db.prepare("SELECT value FROM settings WHERE key = 'advanced'").get();
    if (!row) return {};
    try {
        return JSON.parse(row.value) || {};
    } catch (error) {
        return {};
    }
}

function validateExecutor(apiProfileId, model, label) {
    if (!apiProfileId) return { executor: null, error: `${label} needs an API Connection.` };
    if (!model) return { executor: null, error: `${label} needs a model for the selected API Connection.` };

    const apiProfile = db.prepare('SELECT id, models FROM api_profiles WHERE id = ?').get(apiProfileId);
    if (!apiProfile) return { executor: null, error: `The selected ${label} connection is no longer available.` };

    let models = [];
    try {
        models = typeof apiProfile.models === 'string' ? JSON.parse(apiProfile.models) : (apiProfile.models || []);
    } catch (error) {
        models = [];
    }
    if (Array.isArray(models) && models.length && !models.includes(model)) {
        return { executor: null, error: `The selected ${label} model is no longer available on this API Connection.` };
    }
    return { executor: { apiProfileId, model }, error: null };
}

function resolveSystemAi(settings) {
    const result = validateExecutor(
        String(settings.systemApiProfileId || '').trim(),
        String(settings.systemModelName || '').trim(),
        'System AI'
    );
    return { roleId: ROLE_IDS.SYSTEM, mode: 'dedicated', source: 'system', ...result };
}

function resolveAiEngineRole(roleId, { profile = null } = {}) {
    const settings = readAdvancedSettings();
    if (roleId === ROLE_IDS.SYSTEM) return resolveSystemAi(settings);

    const mode = String(settings[`${roleId}Mode`] || ROLE_DEFAULTS[roleId] || 'disabled');
    if (mode === 'disabled' || mode === 'off') {
        return { roleId, mode, source: 'disabled', executor: null, error: null };
    }
    if (mode === 'profile') {
        const result = validateExecutor(profile?.apiProfileId, profile?.model, 'AI Profile');
        return { roleId, mode, source: 'profile', ...result };
    }
    if (mode === 'inherit-system') {
        const system = resolveSystemAi(settings);
        return {
            roleId,
            mode,
            source: 'system',
            executor: system.executor,
            error: system.error ? `${roleId === ROLE_IDS.TAGGER ? 'Tagger' : 'Summarizer'} cannot inherit System AI. ${system.error}` : null
        };
    }

    const label = roleId === ROLE_IDS.TAGGER ? 'Tagger' : roleId === ROLE_IDS.SUMMARIZER ? 'Summarizer' : 'Retrieval Planner';
    const result = validateExecutor(
        String(settings[`${roleId}ApiProfileId`] || '').trim(),
        String(settings[`${roleId}ModelName`] || '').trim(),
        label
    );
    return { roleId, mode: 'dedicated', source: 'dedicated', ...result };
}

module.exports = { ROLE_IDS, readAdvancedSettings, resolveAiEngineRole };
