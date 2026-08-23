// The scalar `data` vocabulary of a Worldbuild entity, in one place.
//
// A field only works if three separate lists agree on it: what the AI may propose
// (ENRICH_FIELDS), what the sheet renders, and what retrieval hands back to the model
// (DOSSIER_DATA_FIELDS). They were three hand-kept lists in two files and drifted three
// times, each time the same way: a field was proposed, accepted, stored, and then never
// seen again by either the user or the model. Nothing threw, so nothing surfaced.
//
// Two of those lists live here so a test can hold them against each other. The sheet is
// JSX and cannot be enumerated yet, so that edge is still checked by hand.

// Closed vocabularies for the fields that are enums. A value outside its list is dropped
// rather than stored.
const ENRICH_ENUMS = {
    status: ['alive', 'deceased', 'missing', 'unknown'],
    disposition: ['hostile', 'neutral', 'friendly', 'unknown'],
    abundance: ['Unique', 'Rare', 'Uncommon', 'Common', 'Abundant'],
    threat: ['Harmless', 'Minor', 'Dangerous', 'Deadly', 'Legendary'],
    itemType: ['Weapon', 'Armor', 'Artifact', 'Resource'],
};

// Each list mirrors the scalar `data` fields the WorldbuildView actually renders for
// that type, nothing else. The AI may only fill what the user can see; it must never
// invent fields (e.g. a Character has no "role"/"abilities", a Creature has no
// "description"). Relational fields (owner, race, faction, habitat…) and chapter links
// are edges, not data, and are handled separately.
const ENRICH_FIELDS = {
    Characters: ['status', 'age', 'appearance', 'personality'],
    Creatures: ['status', 'disposition', 'nature', 'abundance', 'threat', 'abilities', 'appearance', 'personality'],
    Locations: ['locationType', 'description'],
    Items: ['itemType', 'abundance', 'description'],
    Factions: ['description'],
    Races: ['description'],
    Events: ['kind', 'description'],
    System: ['content'],
};

const ENRICH_TYPE_GUIDANCE = {
    Characters: 'A specific person or personified agent. Record their current canonical state, not temporary scene circumstances or thematic interpretations.',
    Creatures: 'An individual creature or a creature group/species. Respect its scope: individuals have status; groups have abundance. Do not convert metaphorical descriptions into biology or powers.',
    Locations: 'A persistent physical place. Do not treat a temporary scene setting, organization, plane of thought, or mere association as physical containment.',
    Items: 'A persistent object, artifact, equipment, or resource. Distinguish possession, use, creation, and discovery; they are not interchangeable.',
    Factions: 'An organized group with shared identity. Describe established goals, structure, or reputation without inferring collective intent from one member.',
    Races: 'A canonical species, lineage, ancestry, or people. Describe established traits and culture without generalizing from one individual.',
    Events: 'A named or canonically significant happening. Record what occurred and why it factually matters, not speculative consequences.',
    System: 'A reusable canonical concept, law, doctrine, magic system, technology, currency, cosmological mechanism, or world rule. Content must explain its operation, scope, limits, terminology, and consequences without turning examples into universal rules.',
};

// One line per field, written into the extraction prompt. A field with no guidance would
// reach the AI as the literal string "undefined", so every enrichable field needs one.
const ENRICH_FIELD_GUIDANCE = {
    status: 'Current state only. alive requires explicit survival or a current direct action that cannot be posthumous. deceased requires explicit confirmation of death or a canonically defined irreversible equivalent. Surrender, defeat, disappearance, transformation, assimilation, imprisonment, incapacitation, or leaving a role are not death. missing means whereabouts are explicitly unknown; unknown means the evidence cannot establish a state.',
    age: 'A literal current age explicitly stated for this character. Never calculate it from dates, elapsed time, appearance, or life stage.',
    appearance: 'Stable physical appearance explicitly described for this individual. Do not include temporary clothing, injuries, posture, or scene lighting unless canonically persistent.',
    personality: 'Stable personality traits directly demonstrated across evidence or explicitly stated. Do not convert one emotional reaction into a permanent trait.',
    disposition: 'A stable default attitude toward relevant people, not a momentary emotional reaction in one scene.',
    nature: 'The explicitly established creature category or nature, such as Beast, Spirit, or Deity. Do not infer it from appearance or abilities.',
    abundance: 'World-level prevalence of a resource or creature group, not the quantity present in one scene.',
    threat: 'An explicitly established general danger level, not how frightening or powerful one scene makes the entity appear.',
    abilities: 'Concrete repeatable capabilities or traits explicitly demonstrated or stated. Exclude metaphors, one-time circumstances, equipment, and speculation.',
    locationType: 'The explicit kind of place, such as continent, city, fortress, or tavern. Do not use its name, owner, atmosphere, or current purpose as its type.',
    itemType: 'Weapon, Armor, Artifact, or Resource according to the item’s canonical function. Use Resource only for material that can naturally occur, be gathered, or be consumed as a supply.',
    description: 'A concise factual description built only from established properties, function, appearance, culture, goals, structure, or importance appropriate to this entity type.',
    kind: 'The explicit category of event, such as Battle, Festival, Holiday, Disaster, or Coronation. Do not use its outcome or emotional tone as its kind.',
    content: 'A precise canonical explanation of the concept or system: definition, mechanism, scope, constraints, terminology, exceptions, and consequences when supported. Preserve distinctions between related concepts and never universalize a single example.',
};

// Serialized into a short human-readable clause for the retrieval dossier. Nothing
// curated into the registry may be lost from retrieval, so every scalar attribute the
// user set surfaces to the model. Order here is the order the model reads.
const DOSSIER_DATA_FIELDS = [
    ['status', 'status'], ['itemType', 'type'], ['locationType', 'type'],
    ['nature', 'nature'], ['scope', 'kind'], ['disposition', 'disposition'],
    ['rarity', 'abundance'], ['abundance', 'abundance'], ['threat', 'threat'],
    ['age', 'age'], ['role', 'role'], ['abilities', 'abilities'], ['ownership', 'ownership'],
    ['appearance', 'appearance'], ['personality', 'personality'], ['kind', 'kind'],
];

// The only enrichable fields allowed to be absent from the clause above, because every
// caller already emits them beside it. A field belongs here only when it has another
// carrier into the prompt; "it is long" is not a reason, or a Character would arrive
// with no description of any kind.
const DOSSIER_EXEMPT_FIELDS = ['description', 'content'];

function entityDataFacts(data) {
    if (!data || typeof data !== 'object') return '';
    const parts = [];
    for (const [key, label] of DOSSIER_DATA_FIELDS) {
        const v = data[key];
        if (v == null) continue;
        const s = String(v).trim();
        if (s) parts.push(`${label}: ${s}`);
    }
    return parts.join('; ');
}

module.exports = {
    ENRICH_ENUMS,
    ENRICH_FIELDS,
    ENRICH_TYPE_GUIDANCE,
    ENRICH_FIELD_GUIDANCE,
    DOSSIER_DATA_FIELDS,
    DOSSIER_EXEMPT_FIELDS,
    entityDataFacts
};
