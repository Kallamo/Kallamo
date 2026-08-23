// Resolve the category name a tagger answered with to one this workspace has.
//
// The prompt lists the exact category names and asks the model to use only those,
// and models still answer "Character" where the workspace has "Characters". That
// is not a wrong answer about the world, it is a wrong answer about a label, and
// it used to void every mention in the batch: the whole archive then reported
// that nothing passed validation.
//
// Matching stays closed: a name is accepted only when it resolves to a category
// that already exists. Nothing here invents a category or maps a type onto a
// different one, so tagging remains confirmed-only.

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

// A lookup from anything the model might plausibly write to the canonical name.
// Exact names are registered last so they always win a collision: if one category
// is "Race" and another "Races", each still resolves to itself.
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
