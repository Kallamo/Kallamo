// What a sheet the Narrative State creates is filled with at once, from the scene that brought it in.
// The part of the sheet that says what something is comes now; looks, character, lore, description
// and links to places wait for Update entities, which reads every passage that mentions it.

// Sections of the sheet filled at birth, by type. A user's field placed there goes with them, and so
// does one placed in no section (it shows under More details).
const FIRST_FILL_SECTIONS = {
  Characters: ['identity'],
  // Older templates stored a creature's details section as overview.
  Creatures: ['details', 'overview'],
  Items: ['details'],
  Locations: ['overview'],
  Factions: ['desc'],
  Races: ['desc'],
};

// The sheet's own fields in those sections. Description sits in them for some types and waits.
const FIRST_FILL_NATIVE = {
  Characters: ['status', 'gender', 'age'],
  Creatures: ['status', 'disposition', 'nature', 'abundance', 'threat', 'abilities'],
  Items: ['itemType', 'abundance'],
  Locations: ['locationType', 'size'],
  Factions: [],
  Races: [],
};

// At birth the scene is all there is, so what it plainly shows counts, not only what it states.
// Every other field keeps the guidance Update entities uses.
const FIRST_FILL_GUIDANCE = {
  status: 'alive when they act, speak or are seen alive in the scene; deceased or missing only when the scene says so.',
  gender: 'The gender the scene states, or the one its pronouns and gendered words for them show. Never from the name alone.',
  age: 'The age the scene states, or an approximate one it plainly gives or shows ("about forty", "an old woman", "a boy of ten"), as a number or a short phrase. Never computed from dates.',
};

const isEmpty = value => value === undefined || value === null || (typeof value === 'string' && !value.trim()) || (Array.isArray(value) && !value.length);
// A state the sheet starts in when nothing is known yet.
const UNSET = { status: 'unknown', disposition: 'unknown' };

function sameValue(left, right) {
  try { return JSON.stringify(left) === JSON.stringify(right); } catch { return false; }
}

/**
 * The empty fields a new sheet asks for: its own fields of the type's sections that the sheet can
 * hold, and the user's read-write fields placed there or nowhere. A field still at its default counts
 * as empty.
 */
function firstFillFields(entity, { allowedNative = [], customDefinitions = [], layout = {} } = {}) {
  const sections = FIRST_FILL_SECTIONS[entity?.type];
  if (!sections) return { native: [], custom: [] };
  const data = entity.data || {};
  const custom = data.customFields && typeof data.customFields === 'object' ? data.customFields : {};
  const placed = layout?.fieldSections || {};
  return {
    native: (FIRST_FILL_NATIVE[entity.type] || []).filter(key => allowedNative.includes(key) && (isEmpty(data[key]) || data[key] === UNSET[key])),
    custom: customDefinitions.filter(field => {
      if (field.aiAccess && field.aiAccess !== 'read-write') return false;
      const section = placed[field.id];
      // A default is where a new sheet starts, not something the scene showed: the scene may replace it.
      const unshown = isEmpty(custom[field.key]) || (field.hasDefault && sameValue(custom[field.key], field.defaultValue));
      return (!section || sections.includes(section)) && unshown;
    }),
  };
}

module.exports = { FIRST_FILL_SECTIONS, FIRST_FILL_NATIVE, FIRST_FILL_GUIDANCE, firstFillFields };
