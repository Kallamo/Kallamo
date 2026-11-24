import { renderEntity, parseObject, firstSentence, type WorldbuildView } from './entity-tiers';
import { renderHolding, storyDateLabel, type DraftItem } from './items';
import { isRetired, ROLE_PRIORITY, salience } from './salience';
import { metadataOf, type HoldingItem, type StoryEvent, type StoryReads, type StoryRecord } from './story-reads';
import { STORY_AXIS } from '../umwelt/narrative-world';
import { relevanceOf } from '../memory-relevance';

const PEOPLE = new Set(['Characters', 'Creatures']);
// Recent events are looked for in widening spans, so a long story never has to be read from its start.
const LOOKBACK_DAYS = [1, 7, 30, 120];
const DAY = 24 * 60;
const COME_IN_SHOWN = 4;
const TIES_SHOWN = 2;
const NAMED_SHOWN = 3;
const REUNION_PAIRS = 6;
// A place that people run, work at or live in keeps them close; any other link does not.
const PLACE_TIES = new Set(['led_by', 'connected_to', 'located_in', 'operates_in', 'owned_by']);

export interface OffstageInput {
  view: WorldbuildView;
  reads: StoryReads;
  locationId: string | null;
  present: string[];
  playerId: string | null;
  /** Who the turn speaks to or about. */
  involved: Set<string>;
  nowMinute: number | null;
  /** An event the chat history still shows: the narrator already reads it there. */
  isRecent: (eventId: string) => boolean;
}

/** "15 min ago", "3 h ago", "2 days ago", in story time. */
export function storyAge(nowMinute: number | null, minute: number | undefined): string {
  if (nowMinute === null || minute === undefined || !Number.isFinite(minute)) return '';
  const minutes = Math.max(0, Math.round(nowMinute - minute));
  if (minutes < 60) return `${Math.max(1, minutes)} min ago`;
  if (minutes < DAY) return `${Math.round(minutes / 60)} h ago`;
  const days = Math.round(minutes / DAY);
  if (days < 60) return `${days} ${days === 1 ? 'day' : 'days'} ago`;
  return `${Math.round(days / 30)} months ago`;
}

function minuteOf(event: StoryEvent): number | undefined {
  const minute = event.on?.[STORY_AXIS];
  return typeof minute === 'number' ? minute : undefined;
}

function latest(events: StoryEvent[]): StoryEvent | null {
  return events.reduce<StoryEvent | null>((best, event) => {
    if (!best) return event;
    const a = minuteOf(event) ?? -Infinity;
    const b = minuteOf(best) ?? -Infinity;
    return a > b || (a === b && event.position.tick > best.position.tick) ? event : best;
  }, null);
}

const PAGE = 500;
const PAGES = 10;

/**
 * Every scene someone took part in between two story minutes, oldest first; the engine pages from the
 * start. A thread played ahead of the clock is not yet the past.
 */
function scenesSince(reads: StoryReads, id: string, from: number, to: number): StoryEvent[] {
  const byId = new Map<string, StoryEvent>();
  let cursor = from;
  for (let page = 0; page < PAGES; page++) {
    const events = reads.eventsOf(id, { from: cursor, to, limit: PAGE });
    for (const event of events) byId.set(event.id, event);
    if (events.length < PAGE) break;
    const last = minuteOf(events[events.length - 1]);
    if (last === undefined || last <= cursor) break;
    cursor = last;
  }
  return [...byId.values()].filter(event => reads.isScene(event));
}

/** The latest scene someone took part in, looked for back from now in widening spans. */
function latestScene(reads: StoryReads, id: string, nowMinute: number | null): StoryEvent | null {
  if (nowMinute === null) return null;
  for (const days of LOOKBACK_DAYS) {
    const found = latest(scenesSince(reads, id, nowMinute - days * DAY, nowMinute));
    if (found) return found;
  }
  return null;
}

export interface Sighting { event: StoryEvent; minute?: number; locationId: string | null }

/** Where and when someone last took part in a scene. */
export function lastSeen(reads: StoryReads, id: string, nowMinute: number | null): Sighting | null {
  const event = latestScene(reads, id, nowMinute);
  return event ? { event, minute: minuteOf(event), locationId: event.location ?? null } : null;
}

export function sightingLine(view: WorldbuildView, sighting: Sighting, nowMinute: number | null, hereId: string | null): string {
  const where = sighting.locationId === hereId && hereId ? 'here' : sighting.locationId ? `at ${view.nameOf(sighting.locationId) ?? 'another place'}` : '';
  const when = [storyAge(nowMinute, sighting.minute), storyDateLabel(sighting.minute, view) ? `(${storyDateLabel(sighting.minute, view)})` : ''].filter(Boolean).join(' ');
  const what = firstSentence(sighting.event.description || sighting.event.title, 180);
  return `Last seen ${[when, where].filter(Boolean).join(' ')}: ${what}`;
}

function regard(reads: StoryReads, from: string, to: string): StoryRecord | null {
  return reads.dispositions(from, to).find(record => record.kind === 'disposition') ?? null;
}

/** "Mara → Pell (overall 92): Pai substituto", with the description only when asked for. */
export function regardLine(view: WorldbuildView, record: StoryRecord, describe: boolean): string {
  if (record.kind !== 'disposition') return '';
  const meta = metadataOf(record);
  const title = String(meta.title ?? '').trim();
  const description = describe ? String(meta.description ?? '').trim() : '';
  return `${view.nameOf(record.holder) ?? 'Someone'} → ${view.nameOf(record.target) ?? 'someone'} (${record.dimension} ${Number(record.value)})${title ? `: ${title}` : ''}${description ? `. ${description}` : ''}`;
}

/** Both directions between one person and each of the others, strongest first. */
function ties(input: OffstageInput, id: string, others: string[], limit: number): string[] {
  const pairs = others.filter(other => other !== id).map(other => {
    const lines = [regard(input.reads, other, id), regard(input.reads, id, other)].filter((record): record is StoryRecord => Boolean(record));
    const weight = Math.max(0, ...lines.map(record => record.kind === 'disposition' ? Math.abs(Number(record.value)) : 0));
    return { lines, weight };
  }).filter(pair => pair.lines.length).sort((left, right) => right.weight - left.weight);
  return pairs.slice(0, limit).flatMap(pair => pair.lines.map(record => regardLine(input.view, record, false)));
}

function isPerson(view: WorldbuildView, id: string): boolean {
  const entity = view.entity(id);
  if (!entity || !PEOPLE.has(entity.type)) return false;
  const status = String(parseObject(entity.data).status ?? '').toLowerCase();
  return status !== 'deceased' && status !== 'dead';
}

/**
 * How each person present stands toward someone the turn names who is not here, title and value in
 * both directions: enough to voice how they talk about them.
 */
export function towardNamed(input: OffstageInput & { exclude: Set<string> }): DraftItem[] {
  const named = [...input.involved].filter(id => !input.present.includes(id) && !input.exclude.has(id) && id !== input.playerId && isPerson(input.view, id));
  const items: DraftItem[] = [];
  for (const id of named) {
    if (items.length >= NAMED_SHOWN) break;
    const lines = input.present.filter(holder => holder !== id).flatMap(holder => [regard(input.reads, holder, id), regard(input.reads, id, holder)])
      .filter((record): record is StoryRecord => Boolean(record))
      .map(record => regardLine(input.view, record, false));
    if (!lines.length) continue;
    items.push({
      key: `toward:${id}`, section: 'core', needIds: [], tier: 'line', holders: [], group: 'Toward who is named',
      priority: ROLE_PRIORITY.core, text: `${input.view.nameOf(id) ?? 'Someone'}, not here:\n${lines.join('\n')}`,
      degrade: () => null
    });
  }
  return items;
}

/**
 * Who could plausibly come into the scene: those nearby, those the place keeps (who run it, work or
 * live there) and those last seen here. Each comes with enough to voice them, what they were last
 * doing, and how they stand with the people here. The narrator decides whether anyone comes.
 */
export function couldComeIn(input: OffstageInput & { nearby: string[] }): DraftItem[] {
  const { view, reads, locationId } = input;
  const taken = new Set([...input.present, ...(input.playerId ? [input.playerId] : [])]);
  const reasons = new Map<string, string>();
  const offer = (id: string, reason: string) => {
    if (taken.has(id) || input.involved.has(id) || reasons.has(id) || !isPerson(view, id)) return;
    reasons.set(id, reason);
  };
  for (const id of input.nearby) offer(id, 'nearby');
  if (locationId) {
    for (const link of view.links(locationId)) {
      if (!PLACE_TIES.has(link.relType)) continue;
      offer(link.otherId, link.relType === 'led_by' && link.direction === 'from' ? 'runs this place' : 'tied to this place');
    }
  }
  const sightings = new Map<string, Sighting | null>();
  const seen = (id: string) => {
    if (!sightings.has(id)) sightings.set(id, lastSeen(reads, id, input.nowMinute));
    return sightings.get(id)!;
  };
  // Who took part in the latest scenes here and has not been anywhere since, while the room has space.
  if (locationId) {
    for (const eventId of reads.sceneIdsAt(locationId, 12)) {
      if (reasons.size >= COME_IN_SHOWN) break;
      for (const id of reads.participantsOf(eventId)) {
        if (reasons.size >= COME_IN_SHOWN) break;
        if (taken.has(id) || reasons.has(id) || input.involved.has(id) || !isPerson(view, id)) continue;
        if (seen(id)?.locationId === locationId) offer(id, 'last seen here');
      }
    }
  }
  // Everyone nearby is listed; the others fill what is left of the room.
  const chosen = [...reasons].filter(([, reason], index) => reason === 'nearby' || index < COME_IN_SHOWN);

  const items: DraftItem[] = [];
  for (const [index, [id, reason]] of chosen.entries()) {
    const entity = view.entity(id);
    if (!entity) continue;
    // Past the first few, someone nearby is a name and why; the room is only so large.
    const full = index < COME_IN_SHOWN;
    const sighting = full ? seen(id) : null;
    const details = [
      `Why: ${reason}`,
      ...(sighting ? [sightingLine(view, sighting, input.nowMinute, locationId)] : []),
      ...(full ? ties(input, id, input.present, TIES_SHOWN) : [])
    ].join('\n');
    const build = (tier: 'card' | 'mention'): DraftItem => ({
      key: `come-in:${id}`, section: 'core', needIds: [], tier, holders: [], group: 'Could come in', priority: ROLE_PRIORITY.core,
      text: `${renderEntity(view, entity, tier)}\n${details}`,
      degrade: tier === 'card' ? () => build('mention') : () => null
    });
    items.push(build(full ? 'card' : 'mention'));
  }
  return items;
}

/** The latest memory someone holds about another, as a line of what they know. */
function lastMemory(input: OffstageInput, holder: string, about: string): DraftItem | null {
  const memories = input.reads.memoriesInvolving(holder, about)
    .filter(item => item.record.kind === 'holding' && item.record.accessibility === 'available'
      && !isRetired(item.record) && !item.record.secrecy && !input.isRecent(item.record.eventId))
    .sort((left, right) => right.record.position.tick - left.record.position.tick);
  const item = memories[0];
  if (!item) return null;
  const text = renderHolding(item, input.view, id => input.view.nameOf(id));
  if (!text) return null;
  return {
    key: `record:${item.record.id}`, section: 'knows', needIds: [], tier: 'line', recordId: item.record.id, holders: [holder],
    group: 'Last together', priority: ROLE_PRIORITY.support, text
  };
}


/**
 * When people meet again: the last scene they shared before this one and the latest memory each holds
 * of the other. A pair is meeting again when the history shows them together in at most a couple of
 * scenes; a pair the history keeps together is already living it.
 */
export function reunions(input: OffstageInput & { recentEventIds: Set<string> }): DraftItem[] {
  const { view, reads } = input;
  const now = input.nowMinute;
  if (now === null) return [];
  const people = input.present.filter(id => isPerson(view, id));
  const recent = [...input.recentEventIds].map(id => reads.participantsOf(id));

  const candidates: Array<{ a: string; b: string; score: number }> = [];
  for (const [index, a] of people.entries()) {
    for (const b of people.slice(index + 1)) {
      if (recent.filter(participants => participants.has(a) && participants.has(b)).length > 2) continue;
      const strength = Math.max(0, ...[regard(reads, a, b), regard(reads, b, a)].map(record => record?.kind === 'disposition' ? Math.abs(Number(record.value)) : 0));
      candidates.push({ a, b, score: (input.involved.has(a) ? 1 : 0) + (input.involved.has(b) ? 1 : 0) + strength / 100 });
    }
  }
  candidates.sort((left, right) => right.score - left.score);

  // The last scene they shared that the history no longer shows, looked for back in widening spans.
  const before = (a: string, b: string): StoryEvent | null => {
    for (const days of LOOKBACK_DAYS.slice(1)) {
      const found = latest(scenesSince(reads, a, now - days * DAY, now).filter(event => (event.participants ?? []).includes(b) && !input.isRecent(event.id)));
      if (found) return found;
    }
    return null;
  };

  const items: DraftItem[] = [];
  let shown = 0;
  for (const { a, b } of candidates) {
    if (shown >= REUNION_PAIRS) break;
    const memories = [a, b].filter(holder => holder !== input.playerId).map(holder => lastMemory(input, holder, holder === a ? b : a)).filter((item): item is DraftItem => Boolean(item));
    const shared = before(a, b);
    if (!shared && !memories.length) continue;
    shown += 1;
    if (shared) {
      const minute = minuteOf(shared);
      const when = [storyAge(now, minute), storyDateLabel(minute, view) ? `(${storyDateLabel(minute, view)})` : ''].filter(Boolean).join(' ');
      const where = shared.location ? ` at ${view.nameOf(shared.location) ?? 'another place'}` : '';
      items.push({
        key: `together:${[a, b].sort().join(':')}`, section: 'core', needIds: [], tier: 'line', holders: [], group: 'Last together',
        priority: ROLE_PRIORITY.core, degrade: () => null,
        text: `${view.nameOf(a) ?? 'Someone'} and ${view.nameOf(b) ?? 'someone'}, last together ${when}${where}: ${firstSentence(shared.description || shared.title, 280)}`
      });
    }
    items.push(...memories);
  }
  return items;
}

const ABOUT_EACH_OTHER_PER_PAIR = 2;
const ABOUT_EACH_OTHER_SHOWN = 12;

/**
 * What each person here holds about the others here: their statements about them and the memories
 * they share, the most telling first, a couple per pair. Nobody has to ask for it: two people in a
 * room bring what they think of each other. What the history still shows is already read there, and
 * the player's own holdings stay the user's.
 */
export function aboutEachOther(input: OffstageInput & { holders?: string[]; shown?: number }): DraftItem[] {
  const { view, reads } = input;
  const people = input.present.filter(id => isPerson(view, id));
  const holders = (input.holders ?? people).filter(id => isPerson(view, id));
  const shownAtMost = input.shown ?? ABOUT_EACH_OTHER_SHOWN;
  const pairs: Array<{ holder: string; about: string; items: Array<{ item: HoldingItem; score: number }>; weight: number }> = [];
  for (const holder of holders) {
    if (holder === input.playerId) continue;
    for (const about of people) {
      if (about === holder) continue;
      const items = reads.heldAbout(holder, about)
        .filter(({ record }) => record.kind === 'holding' && record.accessibility === 'available' && !isRetired(record) && !input.isRecent(record.eventId))
        .map(item => ({ item, weight: relevanceOf(metadataOf(item.record).salience, metadataOf(item.record).category), score: salience({ role: 'support', record: item.record, heldByPresent: true }) }))
        // Between two people in a room, what weighs on the holder matters more than how sure they are.
        .sort((left, right) => right.weight - left.weight || right.score - left.score || right.item.record.position.tick - left.item.record.position.tick)
        .slice(0, ABOUT_EACH_OTHER_PER_PAIR);
      if (!items.length) continue;
      // The pairs the turn is about come first, then the strongest statements.
      const weight = (input.involved.has(holder) ? 100 : 0) + (input.involved.has(about) ? 100 : 0) + items[0].score;
      pairs.push({ holder, about, items, weight });
    }
  }
  const drafts: DraftItem[] = [];
  for (const pair of pairs.sort((left, right) => right.weight - left.weight)) {
    for (const { item, score } of pair.items) {
      if (drafts.length >= shownAtMost) return drafts;
      const text = renderHolding(item, view, id => view.nameOf(id));
      if (!text) continue;
      drafts.push({
        key: `record:${item.record.id}`, section: 'knows', needIds: [], tier: 'line', recordId: item.record.id, holders: [pair.holder],
        group: 'About each other', priority: score, text
      });
    }
  }
  return drafts;
}

const ACTORS_SHOWN = 8;

/**
 * Someone the turn has acting who is not in the scene yet (the scene state follows the story a turn
 * late): what they hold about the people here comes with them, as if they were in the room.
 */
export function actorsAboutPresent(input: OffstageInput & { actors: string[] }): DraftItem[] {
  const actors = input.actors.filter(id => !input.present.includes(id) && id !== input.playerId);
  if (!actors.length) return [];
  return aboutEachOther({ ...input, holders: actors, shown: ACTORS_SHOWN });
}
