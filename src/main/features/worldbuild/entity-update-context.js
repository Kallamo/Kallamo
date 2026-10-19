const { comparableText } = require('./entity-update-contract');

// A list-shaped document names whose section a passage belongs to only where the section starts,
// often in the chunk before; files saved without an ordinal are ordered by write time.
function precedingPassageText(statements, chunk, runChunkIds) {
    if (!['document', 'chat_kb'].includes(chunk.ownerType)) return '';
    const previous = Number.isInteger(chunk.ordinal)
        ? (chunk.ordinal > 0 ? statements.byOrdinal.get(chunk.ownerId, chunk.ownerType, chunk.source, chunk.ordinal - 1) : null)
        : statements.byTime.get(chunk.ownerId, chunk.ownerType, chunk.source, chunk.createdAt);
    if (!previous?.text || runChunkIds.has(previous.id)) return '';
    let body = passageBody(previous.text);
    // Chunks overlap, so the end of the one before often repeats the start of this one.
    const opening = passageBody(chunk.text).slice(0, 40);
    const overlap = opening.length >= 24 ? body.indexOf(opening) : -1;
    if (overlap >= 0) body = body.slice(0, overlap).trim();
    if (!body) return '';
    if (body.length <= 400) return `«${body}»`;
    return `«${body.slice(0, 140).trim()} … ${body.slice(-240).trim()}»`;
}

const passageBody = text => String(text || '').replace(/^Document:[^\n]*\n(?:Content:\s*)?/u, '').replace(/\s+/g, ' ').trim();

function memorySummaries(statement, workspaceId, entityId) {
    return statement.all(workspaceId, entityId).flatMap(row => {
        try {
            const memory = JSON.parse(row.payload_json);
            return memory?.status === 'active' && memory.summary ? [String(memory.summary)] : [];
        } catch { return []; }
    });
}

const MAX_RELATED_SKILLS = 15;

// A word's first letters stand in for the word, so a plural or an inflection still matches.
const stems = text => text.split(' ').filter(word => word.length >= 4).map(word => word.slice(0, 6));

// The whole catalog is noise for one sheet. A word many skill names share says little, so rarer
// words weigh more and at least one rare match is required.
function relatedCatalogSkills(catalog, heldIds, evidenceText) {
    const evidence = comparableText(evidenceText);
    const words = new Set(stems(evidence));
    const nameWords = new Map(catalog.map(skill => [skill.id, [...new Set(stems(comparableText(skill.name)))]]));
    const frequency = new Map();
    for (const list of nameWords.values()) for (const word of list) frequency.set(word, (frequency.get(word) || 0) + 1);
    const rare = Math.max(2, Math.ceil(catalog.length * 0.02));
    return catalog
        .filter(skill => !heldIds.has(skill.id))
        .map(skill => {
            const name = comparableText(skill.name);
            const hits = nameWords.get(skill.id).filter(word => words.has(word));
            const named = name.length >= 4 && ` ${evidence} `.includes(` ${name} `);
            const score = (named ? 100 : 0) + hits.reduce((total, word) => total + Math.log(1 + catalog.length / frequency.get(word)), 0);
            return { skill, score, eligible: named || hits.some(word => frequency.get(word) <= rare) };
        })
        .filter(entry => entry.eligible)
        .sort((a, b) => b.score - a.score || a.skill.position - b.skill.position)
        .slice(0, MAX_RELATED_SKILLS)
        .map(entry => entry.skill);
}

function entitySkillContext(skillSystem, workspaceId, entity, evidenceText) {
    if (!['Characters', 'Creatures'].includes(entity.type)) return null;
    if (entity.type === 'Creatures' && (entity.data?.scope || 'individual') === 'group') return null;
    const settings = skillSystem.getSettings(workspaceId);
    const { config } = settings;
    if (!settings.enabled || config.policy === 'manual') return null;
    if (!config.aiAssigns && !config.aiCreates && !config.aiRaises) return null;
    if (!skillSystem.learningIds(workspaceId).includes(entity.id)) return null;
    const held = skillSystem.getEntitySkills(workspaceId, entity.id).skills;
    const catalog = skillSystem.listSkills(workspaceId).filter(skill => skill.status === 'confirmed');
    const nameById = new Map(catalog.map(skill => [skill.id, skill.name]));
    const related = relatedCatalogSkills(catalog, new Set(held.map(skill => skill.skillId)), evidenceText);
    const describe = skill => `${skill.name}${skill.parentId && nameById.has(skill.parentId) ? ` (under ${nameById.get(skill.parentId)})` : ''}${skill.description ? `: ${String(skill.description).slice(0, 90)}` : ''}`;
    return { config, held, related, describe };
}

module.exports = { precedingPassageText, memorySummaries, entitySkillContext, relatedCatalogSkills };
