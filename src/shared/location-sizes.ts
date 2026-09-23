// Sizes are defined by their role toward a scene, not by genre. Same-size nesting is normal
// (galaxy, planet and continent are all regions); the `inside` link carries that order.

export type LocationSize = 'region' | 'area' | 'place' | 'spot';

export interface LocationSizeDefinition {
  id: LocationSize;
  label: string;
  hint: string;
  examples: string;
  rank: number;
}

// Largest first: the order the sheet control and every guidance line read in.
export const LOCATION_SIZES: readonly LocationSizeDefinition[] = Object.freeze([
  { id: 'region', label: 'Region', hint: 'Wider than a scene. You travel across it.', examples: 'a kingdom, a planet, an ocean', rank: 4 },
  { id: 'area', label: 'Area', hint: 'Holds many places. You move around inside it.', examples: 'a city, a space station, a campus', rank: 3 },
  { id: 'place', label: 'Place', hint: 'Where a scene happens.', examples: "a tavern, a ship's bridge, a classroom", rank: 2 },
  { id: 'spot', label: 'Spot', hint: 'A room or enclosed space inside a place.', examples: "a back room, a ship's cabin, a cellar", rank: 1 }
]);

export const LOCATION_SIZE_IDS: readonly LocationSize[] = Object.freeze(LOCATION_SIZES.map(size => size.id));

const BY_ID = new Map<string, LocationSizeDefinition>(LOCATION_SIZES.map(size => [size.id, size]));

/** A stored or proposed value as a known size, or null. Imports and old files can hold anything. */
export function normalizeLocationSize(value: unknown): LocationSize | null {
  if (typeof value !== 'string') return null;
  const size = BY_ID.get(value.trim().toLowerCase());
  return size ? size.id : null;
}

/** Reads the size from an entity or its data blob; every consumer goes through here. */
export function locationSizeOf(entity: unknown): LocationSize | null {
  if (!entity || typeof entity !== 'object') return null;
  const record = entity as { data?: unknown; size?: unknown };
  let data: unknown = 'data' in record ? record.data : record;
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { return null; }
  }
  return data && typeof data === 'object' ? normalizeLocationSize((data as { size?: unknown }).size) : null;
}

/** 4 for a region down to 1 for a spot; 0 when the size is not known. */
export function locationSizeRank(size: unknown): number {
  const known = normalizeLocationSize(size);
  return known ? BY_ID.get(known)!.rank : 0;
}

export function locationSizeLabel(size: unknown): string {
  const known = normalizeLocationSize(size);
  return known ? BY_ID.get(known)!.label : '';
}

export function locationSizeHint(size: unknown): string {
  const known = normalizeLocationSize(size);
  return known ? BY_ID.get(known)!.hint : '';
}

/** The hint followed by a few examples from different genres, for the places a size is chosen. */
export function locationSizeGuide(size: unknown): string {
  const known = normalizeLocationSize(size);
  if (!known) return '';
  const definition = BY_ID.get(known)!;
  return `${definition.hint} Examples: ${definition.examples}.`;
}

/** True when a larger place sits inside a smaller one. Unknown sizes never count as a mismatch. */
export function isInvertedNesting(childSize: unknown, parentSize: unknown): boolean {
  const child = locationSizeRank(childSize);
  const parent = locationSizeRank(parentSize);
  return Boolean(child && parent && child > parent);
}

// Where something can be set down or where a scene can happen: places and spots first, then
// locations nobody sized yet, then the containers. A world with no sizes keeps its order.
const PRESENCE_ORDER: Record<string, number> = { place: 0, spot: 1, unknown: 2, area: 3, region: 4 };

export function presenceOrder(size: unknown): number {
  return PRESENCE_ORDER[normalizeLocationSize(size) ?? 'unknown'];
}
