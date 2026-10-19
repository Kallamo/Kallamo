const { locationSizeOf } = require('../../../../dist-main/shared/location-sizes');

const OPTION_LIMIT = 30;

const TYPE_ALIASES = new Map([
  ['system', 'System'],
  ['systems', 'System'],
  ['concept', 'System'],
  ['concepts', 'System'],
  ['location', 'Locations'],
  ['locations', 'Locations'],
  ['item', 'Items'],
  ['items', 'Items'],
  ['item type', 'Items'],
  ['item types', 'Items'],
  ['race', 'Races'],
  ['races', 'Races'],
  ['ancestry', 'Races'],
  ['ancestries', 'Races'],
  ['species', 'Races'],
  ['faction', 'Factions'],
  ['factions', 'Factions'],
  ['character', 'Characters'],
  ['characters', 'Characters'],
  ['npc', 'Characters'],
  ['npcs', 'Characters'],
  ['creature', 'Creatures'],
  ['creatures', 'Creatures'],
  ['event', 'Events'],
  ['events', 'Events']
]);

function normalize(value) {
  return String(value || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function resolveNarrativeOptionType(query) {
  const requested = normalize(String(query || '').split('|', 1)[0]);
  if (!requested) return null;
  if (TYPE_ALIASES.has(requested)) return TYPE_ALIASES.get(requested);

  for (const [alias, type] of TYPE_ALIASES) {
    if (requested.startsWith(`${alias} `) || requested.endsWith(` ${alias}`)) return type;
  }
  return null;
}

function compactDescription(entity) {
  const data = entity && typeof entity.data === 'object' && entity.data ? entity.data : {};
  const candidates = [
    data.description,
    data.content,
    data.nature,
    data.kind,
    data.locationType,
    data.itemType,
    entity.lore
  ];
  const value = candidates.find(candidate => String(candidate || '').trim());
  if (!value) return '';
  const compact = String(value).replace(/\s+/g, ' ').trim();
  return compact.length > 240 ? `${compact.slice(0, 237)}...` : compact;
}

function buildNarrativeOptionPalette({ workspaceId, query, listEntities }) {
  const type = resolveNarrativeOptionType(query);
  if (!type) {
    return {
      error: 'Unknown Worldbuild category. Use System, Locations, Items, Races, Factions, Characters, Creatures, or Events.'
    };
  }

  const registered = listEntities({ workspaceId, type })
    .filter(entity => entity.status !== 'proposed');
  const entities = registered.slice(0, OPTION_LIMIT);
  if (!entities.length) {
    return { type, count: 0, source: `Worldbuild options - ${type}`, content: '' };
  }

  const lines = entities.map(entity => {
    const description = compactDescription(entity);
    const size = type === 'Locations' ? locationSizeOf(entity) : null;
    return `- ${entity.canonicalName}${size ? ` (${size})` : ''}${description ? `: ${description}` : ''}`;
  });
  const total = registered.length;
  const truncation = total > entities.length
    ? `\nOnly the first ${entities.length} of ${total} registered options are included.`
    : '';

  return {
    type,
    count: entities.length,
    source: `Worldbuild options - ${type}`,
    content: `CONTROLLED NARRATIVE OPTIONS - ${type}
These entries are canonically available options, not facts already selected for the current scene. Use only an option consistent with retrieved scene, location, faction, and character context. Do not identify an anonymous figure as a registered Character without supporting scene evidence. Do not force variety or infer world prevalence from this registry. Once narration establishes a choice, Narrative State may persist it.
${lines.join('\n')}${truncation}`
  };
}

module.exports = {
  buildNarrativeOptionPalette,
  resolveNarrativeOptionType
};
