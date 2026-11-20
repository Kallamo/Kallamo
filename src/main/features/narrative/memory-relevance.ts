// How much a held record matters to its holder (0 to 1), and how long it stays within reach unused.
// See docs/narrative-state.md, "How memory lives".

/** Below this a memory is a passing detail and is not kept. */
export const MIN_MEMORY_SALIENCE = 0.4;

// What shapes a person, or must never slip: a secret, who someone is, an oath, a wound.
const LASTING = new Set(['secret', 'identity', 'oath', 'trauma', 'loss', 'formative', 'revelation']);

/** A record's relevance when the writer gave none: by what kind of thing it is. */
export function defaultRelevance(category: unknown): number {
  const value = String(category ?? '');
  if (LASTING.has(value)) return 0.9;
  if (value === 'intent') return 0.7;
  return 0.6;
}

/** The record's own relevance, or its category's. */
export function relevanceOf(salience: unknown, category: unknown): number {
  const value = Number(salience);
  return Number.isFinite(value) && value >= 0 && value <= 1 ? value : defaultRelevance(category);
}

export const FADE_DAYS = { light: 7, moderate: 30 } as const;

/**
 * Story days a record may go unused before it slips out of reach; null when it never does. An
 * intent is settled when the story carries it out, never faded.
 */
export function fadeAfterDays(salience: unknown, category: unknown): number | null {
  const value = String(category ?? '');
  if (LASTING.has(value) || value === 'intent') return null;
  const relevance = relevanceOf(salience, category);
  if (relevance >= 0.9) return null;
  return relevance < 0.65 ? FADE_DAYS.light : FADE_DAYS.moderate;
}
