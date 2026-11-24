import { renderEntity, type EntityTier, type WorldbuildView } from './entity-tiers';
import type { DraftItem } from './items';
import { isRetired, ROLE_PRIORITY } from './salience';
import type { NameIndex } from './needs';
import type { StoryReads } from './story-reads';
import { propositionIdentity } from '../../../../narrative/narrative-taxonomy';
import { objectOf } from '../umwelt/story-reader';
import { metadataOf } from './story-reads';
import { regardLine } from './offstage';

const PEOPLE = new Set(['Characters', 'Creatures']);

export interface SceneInput {
  locationId: string | null;
  participantIds: string[];
  possibleObserverIds: string[];
  nearbyIds: string[];
  objectIds: string[];
  playerId: string | null;
  timeLabel?: string | null;
}

/** What the app already keeps about the scene, read through the chat context. */
export interface SceneStateSource {
  /** Settles derived Worldbuild data (Knowledge cards) before the context reads it. */
  prepare?(workspaceId: string): void;
  /** Resources, level, skills and inventory of these entities, one line each. */
  stateLines(workspaceId: string, entityIds: string[]): string[];
  /** What each character perceived and heard in the scene so far. */
  sceneMemory(workspaceId: string, entityIds: string[]): string;
  /** Systems the user marked to go with every message. */
  alwaysInContextIds(workspaceId: string): string[];
  /** One character's Worldbuild Knowledge about these entities, one line each. */
  knownLines?(workspaceId: string, holderId: string, entityIds: string[]): Array<{ targetId: string; text: string }>;
}

// Up to this many people in the scene, everyone gets a full sheet; beyond it only who the turn involves.
const SMALL_SCENE = 4;

/** Who and what the turn speaks to or about: named in the request or at the end of the last reply. */
export function involvedIds(names: NameIndex, request: string, lastReply: string): Set<string> {
  return new Set([
    ...names.mentions(request).map(match => match.entityId),
    ...names.mentions(lastReply.slice(-4000)).map(match => match.entityId)
  ]);
}

export function presentIds(scene: SceneInput): string[] {
  return [...new Set([scene.playerId, ...scene.participantIds].filter((id): id is string => Boolean(id)))];
}

function entityItem(view: WorldbuildView, id: string, tier: EntityTier, group: string): DraftItem | null {
  const entity = view.entity(id);
  if (!entity) return null;
  const lower: Record<EntityTier, EntityTier | null> = { sheet: 'card', card: 'mention', mention: null };
  const build = (current: EntityTier): DraftItem => ({
    key: `entity:${id}`,
    section: 'core',
    needIds: [],
    tier: current,
    holders: [],
    group,
    priority: ROLE_PRIORITY.core,
    text: renderEntity(view, entity, current),
    ...(lower[current] ? { degrade: () => build(lower[current]!) } : {})
  });
  return build(tier);
}

/**
 * The scene as the narrator needs it on every turn: where and when, everyone present at the depth
 * the turn needs them, how they stand toward each other, and what each one perceived.
 */
export function buildSceneCore(input: {
  view: WorldbuildView;
  reads: StoryReads;
  source: SceneStateSource;
  scene: SceneInput;
  names: NameIndex;
  request: string;
  lastReply: string;
}): DraftItem[] {
  const { view, reads, source, scene } = input;
  const workspaceId = view.workspaceId;
  const present = presentIds(scene);
  const involved = involvedIds(input.names, input.request, input.lastReply);
  const small = present.length <= SMALL_SCENE;
  const items: DraftItem[] = [];
  const push = (item: DraftItem | null) => { if (item) items.push(item); };

  const place = scene.locationId ? view.locationChain(scene.locationId) || view.nameOf(scene.locationId) || '' : '';
  const nearby = [...new Set([...scene.possibleObserverIds, ...scene.nearbyIds])].filter(id => !present.includes(id));
  items.push({
    key: 'scene:frame',
    section: 'core',
    needIds: [],
    tier: 'line',
    holders: [],
    group: 'Scene',
    priority: ROLE_PRIORITY.core,
    text: [
      `Location: ${place || 'Unspecified'}`,
      ...(scene.timeLabel ? [`Time: ${scene.timeLabel}`] : []),
      `Present: ${present.map(id => view.nameOf(id) ?? 'Unnamed').join(', ') || 'None'}`,
      `Nearby: ${nearby.map(id => view.nameOf(id) ?? 'Unnamed').join(', ') || 'None'}. Presence alone does not mean they noticed or learned what happened.`,
      `Objects here: ${scene.objectIds.map(id => view.nameOf(id) ?? 'Unnamed').join(', ') || 'None'}`
    ].join('\n')
  });

  for (const id of present) {
    const tier: EntityTier = id === scene.playerId || small || involved.has(id) ? 'sheet' : 'card';
    push(entityItem(view, id, tier, id === scene.playerId ? 'Player' : 'Present'));
  }
  // Someone nearby the turn speaks to or about is in the conversation, whatever the cast list says.
  // People nearby otherwise stand under Could come in, with what they were doing and their ties.
  for (const id of nearby) {
    if (involved.has(id)) push(entityItem(view, id, 'sheet', 'Present'));
    else if (!PEOPLE.has(view.entity(id)?.type ?? '')) push(entityItem(view, id, 'mention', 'Nearby'));
  }
  const talking = [...present, ...nearby.filter(id => involved.has(id))];
  for (const id of scene.objectIds) push(entityItem(view, id, involved.has(id) ? 'sheet' : 'card', 'Objects here'));
  if (scene.locationId) push(entityItem(view, scene.locationId, 'card', 'Location'));
  for (const id of source.alwaysInContextIds(workspaceId)) {
    const item = entityItem(view, id, 'sheet', 'Rules');
    if (item) items.push({ ...item, section: 'rules', degrade: undefined });
  }

  const state = source.stateLines(workspaceId, present);
  if (state.length) items.push({ key: 'scene:state', section: 'core', needIds: [], tier: 'line', holders: [], group: 'State', priority: ROLE_PRIORITY.core, text: state.join('\n') });

  // How the people in the conversation stand toward each other, one line per directed pair.
  const relations: string[] = [];
  for (const holder of talking) {
    for (const record of reads.dispositions(holder)) {
      if (record.kind !== 'disposition' || !talking.includes(record.target) || record.target === holder) continue;
      relations.push(regardLine(view, record, true));
    }
  }
  if (relations.length) items.push({ key: 'scene:relations', section: 'core', needIds: [], tier: 'line', holders: [], group: 'Between them', priority: ROLE_PRIORITY.core, text: relations.join('\n') });

  const memory = source.sceneMemory(workspaceId, [...present, ...scene.possibleObserverIds].filter(id => id !== scene.playerId));
  if (memory) items.push({ key: 'scene:memory', section: 'core', needIds: [], tier: 'line', holders: [], group: 'Character scene memory', priority: ROLE_PRIORITY.core, text: memory });
  return items;
}

const SECRETS_SHOWN = 8;

/**
 * Secrets someone present keeps from someone else present, about who is here or what the turn is
 * about. A secret the other already holds is no longer at risk from them.
 */
export function secretsAtRisk(input: { view: WorldbuildView; reads: StoryReads; present: string[]; focusIds: Set<string> }): DraftItem[] {
  const { view, reads, present } = input;
  const statement = (claim: { subject: string; predicate: string; object: unknown }) => propositionIdentity(claim.subject, claim.predicate, objectOf(claim as never));
  const held = new Map(present.map(holder => [holder, new Set(reads.holdings(holder).map(item => item.record).filter(record => record.kind === 'holding').map(record => statement(record.claim)))]));
  // One statement kept by several people from the same others is one line.
  const bySecret = new Map<string, { item: DraftItem; keepers: string[]; exposedTo: string[]; text: string }>();
  for (const holder of present) {
    for (const item of reads.holdings(holder)) {
      const record = item.record;
      if (record.kind !== 'holding' || !record.secrecy || !record.text || !input.focusIds.has(record.claim.subject)) continue;
      const key = statement(record.claim);
      const allowed = new Set([holder, ...(record.secrecy.sharedWith ?? [])]);
      // Whoever took part in the moment it came from was there to hear it, recorded or not.
      const witnesses = reads.participantsOf(record.eventId);
      // What is said about someone is not kept from them by default; a belief they hold otherwise is
      // already a holding of the same statement, and the Held against the truth notes carry it.
      const exposedTo = present.filter(id => !allowed.has(id) && !witnesses.has(id) && id !== record.claim.subject && !held.get(id)?.has(key));
      if (!exposedTo.length) continue;
      const groupKey = `${key}\u0000${[...exposedTo].sort().join(',')}`;
      const existing = bySecret.get(groupKey);
      if (existing) {
        if (!existing.keepers.includes(holder)) existing.keepers.push(holder);
        continue;
      }
      bySecret.set(groupKey, {
        keepers: [holder], exposedTo, text: record.text,
        item: {
          key: `secret:${record.id}`, section: 'narrator', needIds: [], tier: 'line', recordId: record.id, holders: [holder],
          group: 'Secrets at risk in this scene', priority: ROLE_PRIORITY.support + (present.includes(record.claim.subject) ? 5 : 0), text: ''
        }
      });
    }
  }
  const nameList = (ids: string[]) => ids.map(id => view.nameOf(id) ?? 'someone').join(', ');
  return [...bySecret.values()]
    .map(({ item, keepers, exposedTo, text }) => ({ ...item, holders: keepers, text: `${nameList(keepers)} ${keepers.length > 1 ? 'keep' : 'keeps'} from ${nameList(exposedTo)}: ${text}` }))
    .sort((left, right) => right.priority - left.priority).slice(0, SECRETS_SHOWN);
}

const OUT_OF_REACH_SHOWN = 3;

/**
 * What someone present holds but cannot reach for now, about who is here or what the turn is about:
 * the narrator may let the scene bring it back, and never lets them use it before that.
 */
export function outOfReach(input: { view: WorldbuildView; reads: StoryReads; present: string[]; focusIds: Set<string> }): DraftItem[] {
  const items: DraftItem[] = [];
  for (const holder of input.present) {
    for (const item of input.reads.holdings(holder)) {
      const record = item.record;
      if (record.kind !== 'holding' || record.accessibility !== 'suppressed' || !record.text || isRetired(record)) continue;
      const meta = metadataOf(record);
      const about = [record.claim.subject, ...(Array.isArray(meta.relatedEntityIds) ? meta.relatedEntityIds as string[] : [])];
      if (!about.some(id => id !== holder && input.focusIds.has(id))) continue;
      const wound = meta.category === 'trauma' ? ', pushed away' : '';
      items.push({
        key: `reach:${record.id}`, section: 'narrator', needIds: [], tier: 'line', recordId: record.id, holders: [holder],
        group: 'Out of reach', priority: ROLE_PRIORITY.support,
        text: `${input.view.nameOf(holder) ?? 'Someone'} (out of reach for now${wound}): ${record.text}`
      });
    }
  }
  return items.slice(0, OUT_OF_REACH_SHOWN);
}

const AT_ODDS_SHOWN = 3;

/**
 * Where what someone present holds runs against canon or against themselves, about who is here or
 * what the turn is about: dramatic irony the narrator plays but never states.
 */
export function beliefsAtOdds(input: { view: WorldbuildView; reads: StoryReads; present: string[]; focusIds: Set<string> }): DraftItem[] {
  const { view, reads } = input;
  if (input.present.length < 2) return [];
  const items: DraftItem[] = [];
  for (const holder of input.present) {
    for (const contradiction of reads.contradictions(holder)) {
      const held = reads.record(contradiction.holdingId);
      const other = reads.record(contradiction.otherRecordId);
      if (!held || held.kind !== 'holding' || !held.text || !input.focusIds.has(held.claim.subject)) continue;
      const truth = other?.kind === 'fact' ? String((other as { text?: string | null }).text ?? '').trim() : other?.kind === 'holding' ? String(other.text ?? '').trim() : '';
      items.push({
        key: `odds:${held.id}`, section: 'narrator', needIds: [], tier: 'line', recordId: held.id, holders: [holder],
        group: 'Held against the truth', priority: ROLE_PRIORITY.support,
        text: `${view.nameOf(holder) ?? 'Someone'} ${held.attitude === 'suspects' ? 'suspects' : 'believes'}: ${held.text}${truth ? ` (${contradiction.kind === 'vs-canon' ? 'in truth' : 'yet also holds'}: ${truth})` : ''}`
      });
      if (items.length >= AT_ODDS_SHOWN) return items;
    }
  }
  return items;
}
