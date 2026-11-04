/**
 * How far a relationship can move in one turn. Near neutral it moves easily; toward either extreme
 * it moves less and less. Moving back is its own matter: the more someone is loved, the more a
 * wound costs, and the deeper someone is disliked, the harder they are to win back.
 *
 * Every band is read on the size of the value, so 60 and -60 sit in the same band.
 */

export type RelationshipImpact = 'meaningful' | 'significant' | 'drastic';

interface Band {
  /** Lower edge of the band, on the size of the value. */
  from: number;
  /** The usual step, for an ordinary shift. */
  common: number;
  /** The ceiling, reached only by an extreme event. */
  extreme: number;
}

/** Deepening: away from neutral, on either side. */
const DEEPEN: Band[] = [
  { from: 0, common: 5, extreme: 50 },
  { from: 50, common: 3, extreme: 25 },
  { from: 75, common: 3, extreme: 5 },
  { from: 90, common: 1, extreme: 1 }
];

/** A wound: a positive value falling. The more affection, the further it can fall. */
const WOUND: Band[] = [
  { from: 0, common: 5, extreme: 50 },
  { from: 50, common: 8, extreme: 75 },
  { from: 75, common: 10, extreme: 100 },
  { from: 90, common: 15, extreme: 130 }
];

/** Winning someone back: a negative value rising. The deeper the dislike, the slower. */
const RECONCILE: Band[] = [
  { from: 0, common: 5, extreme: 50 },
  { from: 50, common: 4, extreme: 35 },
  { from: 75, common: 3, extreme: 20 },
  { from: 90, common: 1, extreme: 10 }
];

/**
 * Causes with a ceiling of their own, by band: the most they move there, 0 where they no longer
 * move at all. Causes of weight (rescue, betrayal and the like) follow the tables alone.
 */
const CAUSE_STEPS: Record<string, [number, number, number, number]> = {
  courtesy: [2, 1, 0, 0],
  banter: [2, 1, 0, 0],
  'routine-cooperation': [2, 1, 0, 0],
  'sustained-trust': [Infinity, 1, 0, 0],
  'material-debt': [Infinity, 1, 0, 0],
  affection: [Infinity, Infinity, 1, 1],
  'confidence-shared': [Infinity, Infinity, 1, 1],
  reliance: [Infinity, Infinity, 1, 1]
};

/** Ordinary closeness can be repeated every day of the story, but only once per day for each pair. */
const DAILY_CAUSES = new Set(['courtesy', 'banter', 'routine-cooperation']);
/** Intimacy keeps a bond growing past 75, once per day of the story. */
const DAILY_ABOVE_75_CAUSES = new Set(['affection', 'confidence-shared', 'reliance']);

/** A first impression only exists before the two have any relationship at all. */
export const FIRST_IMPRESSION = 'first-impression';

const INITIAL_LIMITS: Record<RelationshipImpact, number> = { meaningful: 25, significant: 50, drastic: 100 };

export type RelationshipTable = 'deepen' | 'wound' | 'reconcile' | 'initial';

export interface RelationshipLimitInput {
  /** The value now, or null when the two have no relationship yet. */
  current: number | null;
  requested: number;
  impact: RelationshipImpact;
  cause?: string | null;
}

export interface RelationshipLimitResult {
  /** The value to store, or null when the change does not apply. */
  value: number | null;
  table: RelationshipTable;
  /** Why the change was refused, when it was. */
  refused?: 'no-change' | 'first-impression-on-existing' | 'cause-stops-here';
}

const clamp = (value: number) => Math.max(-100, Math.min(100, value));

function bandIndex(size: number): number {
  if (size >= 90) return 3;
  if (size >= 75) return 2;
  if (size >= 50) return 1;
  return 0;
}

function tableFor(position: number, direction: number): { name: Exclude<RelationshipTable, 'initial'>; bands: Band[] } {
  if (position > 0 && direction < 0) return { name: 'wound', bands: WOUND };
  if (position < 0 && direction > 0) return { name: 'reconcile', bands: RECONCILE };
  return { name: 'deepen', bands: DEEPEN };
}

function stepFor(band: Band, impact: RelationshipImpact): number {
  if (impact === 'drastic') return band.extreme;
  if (impact === 'significant') return Math.round((band.common + band.extreme) / 2);
  return band.common;
}

/**
 * Where a change lands. A jump that crosses bands is spent band by band, like a staircase: each band
 * takes its share at its own rate, so a large event near an edge is worth what it is worth elsewhere.
 */
export function limitRelationshipChange({ current, requested, impact, cause }: RelationshipLimitInput): RelationshipLimitResult {
  const target = clamp(requested);
  const causeSteps = cause ? CAUSE_STEPS[cause] : undefined;
  if (current === null) {
    const ceiling = Math.min(INITIAL_LIMITS[impact], causeSteps ? causeSteps[0] : Infinity);
    return { value: Math.max(-ceiling, Math.min(ceiling, target)), table: 'initial' };
  }
  const start = clamp(current);
  if (cause === FIRST_IMPRESSION) return { value: null, table: 'deepen', refused: 'first-impression-on-existing' };
  const direction = Math.sign(target - start);
  if (!direction) return { value: null, table: 'deepen', refused: 'no-change' };

  const firstTable = tableFor(start, direction).name;
  if (firstTable === 'wound') {
    // How much a wound hurts is set by how much the person was loved when it happened, so it is
    // measured once, from the band it starts in, not slowed as the value falls.
    const index = bandIndex(start);
    const step = Math.min(stepFor(WOUND[index], impact), causeSteps ? causeSteps[index] : Infinity);
    if (step <= 0) return { value: null, table: firstTable, refused: 'cause-stops-here' };
    let value = Math.max(target, start - step);
    if (value < 0 && impact !== 'drastic') value = 0;
    value = Math.round(clamp(value));
    return value === start ? { value: null, table: firstTable, refused: 'no-change' } : { value, table: firstTable };
  }
  let position = start;
  // The share of the change still to spend; each band converts it at its own rate.
  let remaining = 1;
  let stoppedByCause = false;
  for (let guard = 0; guard < 16 && remaining > 1e-9 && position !== target; guard += 1) {
    const { bands } = tableFor(position, direction);
    const size = Math.abs(position);
    const inward = position !== 0 && Math.sign(position) === -direction;
    let index = bandIndex(size);
    // Leaving a band through its lower edge, the band being entered is the one that counts.
    if (inward && index > 0 && size === bands[index].from) index -= 1;
    const step = Math.min(stepFor(bands[index], impact), causeSteps ? causeSteps[index] : Infinity);
    if (step <= 0) {
      stoppedByCause = true;
      break;
    }
    const edge = inward
      ? Math.sign(position) * bands[index].from
      : direction * (index === bands.length - 1 ? 100 : bands[index + 1].from);
    const distance = Math.min(Math.abs(edge - position), Math.abs(target - position));
    const reach = step * remaining;
    if (reach <= distance) {
      position += direction * reach;
      break;
    }
    position += direction * distance;
    remaining -= distance / step;
    // Neutral is an edge only an extreme event crosses: a lesser wound or kindness stops there.
    if (position === 0 && impact !== 'drastic') break;
  }
  const value = Math.round(clamp(position));
  if (value === start) return { value: null, table: firstTable, refused: stoppedByCause ? 'cause-stops-here' : 'no-change' };
  return { value, table: firstTable };
}

/**
 * What each band means, for every prompt that asks for a value, so the same bond gets the same
 * number from a turn of play and from a document. The edges are the ones the tables move by.
 */
export const RELATIONSHIP_SCALE_GUIDE = [
  'RELATIONSHIP SCALE. A value says how close SOURCE feels to TARGET; the same bond always sits in the same band.',
  '0: neutral, they only know of each other.',
  '1 to 49: an ordinary relationship or a good start. -1 to -49: friction, dislike or distrust.',
  '50 to 74: friendship. -50 to -74: open enmity.',
  '75 to 89: closeness, such as chosen family or deep trust. -75 to -89: hostility, wanting the other harmed.',
  '90 to 100: a rare, nearly unconditional bond. -90 to -100: a rare, mortal hatred.',
  'Use 90 or more, or -90 or less, only when the evidence states a bond or hatred of that depth outright.'
].join('\n');

/** Bands in order along the scale, from mortal hatred to the rarest bond. */
const SCALE_BANDS: Array<[number, number]> = [
  [-100, -90], [-89, -75], [-74, -50], [-49, -1], [0, 49], [50, 74], [75, 89], [90, 100]
];

function scaleBand(value: number): number {
  return SCALE_BANDS.findIndex(([low, high]) => value >= low && value <= high);
}

/**
 * Documents are read out of order and carry no story time, so one reading moves an existing value
 * at most into the next band toward what it asks for, never across two.
 */
export function limitToNextBand(current: number, requested: number): number {
  const start = Math.round(clamp(current));
  const target = Math.round(clamp(requested));
  const direction = Math.sign(target - start);
  if (!direction) return start;
  const reach = SCALE_BANDS[Math.max(0, Math.min(SCALE_BANDS.length - 1, scaleBand(start) + direction))];
  return direction > 0 ? Math.min(target, reach[1]) : Math.max(target, reach[0]);
}

/**
 * Whether this cause may still move this pair today: some causes only once per day of the story.
 * `usedToday` says whether the same cause already moved the same pair on the same story day.
 */
export function isDailyLimited(cause: string | null | undefined, current: number | null): boolean {
  if (!cause) return false;
  if (DAILY_CAUSES.has(cause)) return true;
  return DAILY_ABOVE_75_CAUSES.has(cause) && current !== null && Math.abs(current) >= 75;
}
