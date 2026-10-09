/**
 * Keys name a world's attributes, skills and resources inside exported packages. They follow the
 * name, so a renamed rule still matches what it is in another world; the AI and the stored values
 * never depend on them.
 */
export function slugKey(name: string): string {
  return String(name || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * The key for a saved rule. A new rule keeps a valid key it was given (an import names one); a
 * rename takes the new name's key; anything else keeps its key. A name with no Latin letters or
 * digits keeps the key it had, and a clash gets a numbered suffix.
 */
export function ruleKey(input: {
  name: string;
  givenKey?: string;
  previous?: { key: string; name: string };
  taken: Iterable<string>;
  prefix: string;
}): string {
  const taken = new Set(input.taken);
  if (input.previous) taken.delete(input.previous.key);
  const valid = (key: string) => /^[a-z][a-z0-9_-]*$/.test(key);
  let base: string;
  if (!input.previous) {
    const given = slugKey(input.givenKey || '');
    base = given && valid(given) ? given : slugKey(input.name);
  } else if (slugKey(input.previous.name) === slugKey(input.name)) {
    return input.previous.key;
  } else {
    base = slugKey(input.name) || input.previous.key;
  }
  if (!base) base = `${input.prefix}-${Date.now()}`;
  if (!valid(base)) base = `${input.prefix}-${base}`;
  let key = base;
  for (let suffix = 2; taken.has(key); suffix += 1) key = `${base}-${suffix}`;
  return key;
}

/** Names are how the AI and the user tell rules apart, so two may not differ only in case or spacing. */
export function requireUniqueName(name: string, others: Array<{ id: string; name: string }>, selfId: string | undefined, kind: string): void {
  const wanted = name.trim().toLowerCase().replace(/\s+/g, ' ');
  const clash = others.find(other => other.id !== selfId && other.name.trim().toLowerCase().replace(/\s+/g, ' ') === wanted);
  if (clash) throw new Error(`There is already ${kind} called ${clash.name}.`);
}

/** Finds a rule the AI named: by name first, then by key, ignoring case. */
export function findByReference<T extends { key: string; name: string }>(items: T[], reference: unknown): T | undefined {
  const wanted = String(reference ?? '').trim().toLowerCase();
  if (!wanted) return undefined;
  return items.find(item => item.name.trim().toLowerCase() === wanted)
    ?? items.find(item => item.key.toLowerCase() === wanted)
    ?? items.find(item => item.key.toLowerCase() === slugKey(wanted));
}
