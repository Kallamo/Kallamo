// The database needs UUIDs; a model only needs a handle that is unique within one request. A UUID
// costs twenty or more tokens to read and again to copy back, and one wrong character leaves it
// pointing nowhere, so requests carry short English labels (character3, location12) and replies
// are translated back before anything reads them.
const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

const PREFIXES = {
    Characters: 'character',
    Creatures: 'creature',
    Locations: 'location',
    Items: 'item',
    Factions: 'faction',
    Events: 'event',
    Races: 'race',
    System: 'system'
};

// A type of the user's own reads as its singular, lower case, letters only.
function labelPrefix(type) {
    if (PREFIXES[type]) return PREFIXES[type];
    const word = String(type || '').toLowerCase().replace(/[^a-z]/g, '').replace(/s$/, '');
    return word || 'entity';
}

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Safe inside a JSON string and in plain text alike.
const inlineText = value => JSON.stringify(String(value)).slice(1, -1);

/**
 * Labels for one request, numbered per type in the order given, so a stable order keeps the
 * labels stable from turn to turn.
 */
function createEntityLabels(entities = []) {
    const labelById = new Map();
    const entityByLabel = new Map();
    const counts = new Map();
    for (const entity of entities) {
        if (!entity?.id || labelById.has(String(entity.id).toLowerCase())) continue;
        const prefix = labelPrefix(entity.type);
        const number = (counts.get(prefix) || 0) + 1;
        counts.set(prefix, number);
        const label = `${prefix}${number}`;
        labelById.set(String(entity.id).toLowerCase(), label);
        entityByLabel.set(label, { id: String(entity.id), name: String(entity.canonicalName || entity.name || label) });
    }
    const prefixes = [...counts.keys()].sort((left, right) => right.length - left.length).map(escapeRegExp);
    const quotedLabel = prefixes.length ? new RegExp(`"(${prefixes.join('|')})(\\d+)"`, 'gi') : null;
    const bareLabel = prefixes.length ? new RegExp(`\\b(${prefixes.join('|')})(\\d+)\\b`, 'gi') : null;
    const lookup = (prefix, number) => entityByLabel.get(`${prefix.toLowerCase()}${number}`);

    const encode = text => String(text ?? '').replace(UUID, id => labelById.get(id.toLowerCase()) || id);

    // A label standing alone as a JSON string is an ID and becomes the UUID again. One written
    // into prose ("character3 hands over the key") becomes the name, so stored text never holds a label.
    const decode = text => {
        const value = String(text ?? '');
        if (!quotedLabel) return value;
        return value
            .replace(quotedLabel, (match, prefix, number) => {
                const entity = lookup(prefix, number);
                return entity ? `"${entity.id}"` : match;
            })
            .replace(bareLabel, (match, prefix, number) => {
                const entity = lookup(prefix, number);
                return entity ? inlineText(entity.name) : match;
            });
    };

    return {
        encode,
        decode,
        encodeValue: value => (value === undefined ? value : JSON.parse(encode(JSON.stringify(value)))),
        labelFor: id => labelById.get(String(id || '').toLowerCase()) || null,
        /** The labels a text uses, with the names they stand for, for reading a request back. */
        legendFor: text => {
            if (!bareLabel) return [];
            const seen = new Map();
            for (const [, prefix, number] of String(text ?? '').matchAll(bareLabel)) {
                const label = `${prefix.toLowerCase()}${number}`;
                const entity = entityByLabel.get(label);
                if (entity && !seen.has(label)) seen.set(label, entity.name);
            }
            return [...seen].map(([label, name]) => ({ label, name }));
        }
    };
}

module.exports = { createEntityLabels, labelPrefix };
