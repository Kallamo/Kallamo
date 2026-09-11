// Resolves the label a tagger wrote ("Character" for "Characters") to a workspace category.
// Closed matching: never invents a category, so tagging stays confirmed-only.

function normalizeName(value) {
  return String(value == null ? '' : value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Both directions of the plural the model is likely to pick: "characters" from
// "character", and "character" from "characters".
function nameVariants(name) {
  const base = normalizeName(name);
  if (!base) return [];

  const variants = new Set([base]);
  if (base.endsWith('ies')) variants.add(`${base.slice(0, -3)}y`);
  if (base.endsWith('es')) variants.add(base.slice(0, -2));
  if (base.endsWith('s')) variants.add(base.slice(0, -1));
  if (base.endsWith('y')) variants.add(`${base.slice(0, -1)}ies`);
  variants.add(`${base}s`);
  variants.add(`${base}es`);
  return [...variants];
}

// Exact names register last so they win collisions ("Race" vs "Races").
function buildCategoryResolver(categories) {
  const lookup = new Map();
  const list = Array.isArray(categories) ? categories : [];

  for (const category of list) {
    const canonical = category && category.name;
    if (!canonical) continue;
    for (const variant of nameVariants(canonical)) {
      if (!lookup.has(variant)) lookup.set(variant, canonical);
    }
  }
  for (const category of list) {
    const canonical = category && category.name;
    if (!canonical) continue;
    lookup.set(normalizeName(canonical), canonical);
  }

  return (value) => {
    const normalized = normalizeName(value);
    if (!normalized) return null;
    return lookup.get(normalized) || null;
  };
}

module.exports = { buildCategoryResolver, normalizeName, nameVariants };
