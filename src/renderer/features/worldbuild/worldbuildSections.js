// What a sheet is made of. The sheet renderer and the template editor both read it, so a section
// cannot exist in one and be missing from the other. Add sections here only.

export const TAB_LABELS = {
  data: 'Data',
  inventory: 'Inventory',
  connections: 'Connections',
  knowledge: 'Knowledge',
  occurrences: 'Occurrences',
};
export const TAB_ORDER = ['data', 'inventory', 'connections', 'knowledge', 'occurrences'];

// `variant` narrows a section to one shape of a type: a specific being carries a life, an
// inventory and relationships, a species or swarm none of them.
export const VARIANT_LABELS = { individual: 'Specific being', group: 'Group or species' };
// Declared per type rather than derived from the sections: a shape is real even when it
// adds nothing of its own, which is exactly the case for a species or swarm.
export const TYPE_VARIANTS = { Creatures: ['individual', 'group'] };

const section = (id, label, tab = 'data', extra = {}) => ({ id, label, tab, ...extra });

export const TYPE_SECTIONS = {
  System: [section('concept', 'Concept')],
  Locations: [
    section('overview', 'Overview'),
    section('lore', 'Lore'),
    // A Region or Area holds what everyone local to it knows; a place or a spot does not.
    section('knowledge', 'Knowledge', 'knowledge', { variant: 'shared' }),
  ],
  Items: [section('details', 'Details'), section('lore', 'Lore')],
  Races: [
    section('desc', 'Description'),
    section('lore', 'Lore'),
    section('members', 'Known members', 'data', { derived: true }),
  ],
  Factions: [
    section('desc', 'Description'),
    section('lore', 'Lore'),
    section('overview', 'Command & territory', 'connections'),
    section('members', 'Members', 'connections'),
    section('formerMembers', 'Former members', 'connections'),
    section('diplomacy', 'Relations', 'connections'),
    section('knowledge', 'Knowledge', 'knowledge'),
  ],
  Characters: [
    section('identity', 'Identity'),
    section('appearance', 'Appearance'),
    section('personality', 'Personality'),
    section('lore', 'Lore'),
    section('inv', 'Inventory', 'inventory'),
    section('fac', 'Factions', 'connections'),
    section('loc', 'Locations', 'connections'),
    section('rels', 'Relationships', 'connections'),
    section('knowledge', 'Knowledge', 'knowledge'),
  ],
  Creatures: [
    section('details', 'Details'),
    section('appearance', 'Appearance'),
    section('personality', 'Personality', 'data', { variant: 'individual' }),
    section('lore', 'Lore'),
    section('members', 'Known members', 'data', { variant: 'group', derived: true }),
    section('inv', 'Inventory', 'inventory', { variant: 'individual' }),
    // A specific being can belong to a group the same way a person can: a bonded mount,
    // a familiar, a dragon that rules a cult. Only the species-wide shape cannot.
    section('fac', 'Factions', 'connections', { variant: 'individual' }),
    section('loc', 'Places', 'connections', { variant: 'individual' }),
    section('rels', 'Relationships', 'connections', { variant: 'individual' }),
    section('knowledge', 'Knowledge', 'knowledge', { variant: 'individual' }),
  ],
  Events: [
    section('overview', 'Overview'),
    section('desc', 'Description'),
    section('lore', 'Lore'),
    section('occurrences', 'Occurrences', 'occurrences'),
  ],
};

// Section ids stored by older templates, mapped so order and renames survive. A section still
// carrying the default `label` was never named by anyone, so it takes the sheet's own name.
const LEGACY_SECTIONS = {
  System: { content: { id: 'concept', label: 'Content' } },
  Creatures: { overview: { id: 'details', label: 'Overview' } },
};
export const canonicalSectionId = (typeId, sectionId) => LEGACY_SECTIONS[typeId]?.[sectionId]?.id || sectionId;

const migrateSection = (typeId, section) => {
  const legacy = LEGACY_SECTIONS[typeId]?.[section.id];
  if (!legacy) return section;
  const native = nativeSections(typeId).find(item => item.id === legacy.id);
  const renamedByHand = section.label && section.label !== legacy.label;
  return { ...section, id: legacy.id, label: renamedByHand ? section.label : native?.label ?? section.label };
};

export const nativeSections = (typeId) => TYPE_SECTIONS[typeId] || [];

/** The sections a given sheet actually renders, once its variant is known. */
export const sheetSections = (typeId, variant = null) =>
  nativeSections(typeId).filter(item => !item.variant || item.variant === variant);

/** Tabs a sheet shows. Which ones exist follows from the type, never from the template. */
export const sheetTabs = (typeId, variant = null) => {
  const sections = sheetSections(typeId, variant);
  return TAB_ORDER.filter(tab => tab === 'data' || sections.some(item => item.tab === tab));
};

/** A tab named after its only section reads better: a creature has Relationships, not Connections. */
export const tabLabel = (typeId, variant, tab) => {
  const owned = sheetSections(typeId, variant).filter(item => item.tab === tab);
  return owned.length === 1 ? owned[0].label : TAB_LABELS[tab] || tab;
};

// Only the first tab is authored content. Inventory, connections, knowledge and
// occurrences are systematic: they carry their own behavior and the records of other
// features, so renaming or hiding them would promise an edit the app cannot honour.
export const templateSections = (typeId) => nativeSections(typeId).filter(item => item.tab === 'data');

/** Legacy ids map onto their section and anything not templatable is dropped, the same for sheet and editor. */
export const normalizeTemplateSections = (typeId, sections = []) => {
  const allowed = new Set(templateSections(typeId).map(item => item.id));
  const seen = new Set();
  return sections
    .map(section => section.kind === 'custom' ? section : migrateSection(typeId, section))
    .filter(section => {
      if (section.kind !== 'custom' && !allowed.has(section.id)) return false;
      if (seen.has(section.id)) return false;
      seen.add(section.id);
      return true;
    });
};

export const variantsOf = (typeId) => TYPE_VARIANTS[typeId] || [];
