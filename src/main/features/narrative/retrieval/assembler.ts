import type Database from 'better-sqlite3';
import { composeContext, composeContextParts } from './composer';
import { createWorldbuildView, renderEntity, type EntityRow, type WorldbuildView } from './entity-tiers';
import type { ContextItem, DraftItem, ItemTier } from './items';
import { mergeNeeds, NameIndex, namedNeeds, parseBrief, type ContextMode, type Need, type NeedContext } from './needs';
import { resolveNeeds, type Passage } from './resolvers';
import { beliefsAtOdds, buildSceneCore, involvedIds, outOfReach, presentIds as scenePresentIds, secretsAtRisk, type SceneInput, type SceneStateSource } from './scene-core';
import { aboutEachOther, actorsAboutPresent, couldComeIn, reunions, towardNamed } from './offstage';
import { StoryReads } from './story-reads';
import { buildWorkspaceCore } from './workspace-core';
import { loadSkillBook } from './skills';
import { storyMinute, type OrdinalCalendar } from '../../../../shared/calendar-ordinal';
import { ROLE_PRIORITY } from './salience';

export interface AssembleInput {
  db: Database.Database;
  workspaceId: string;
  mode: ContextMode;
  request: string;
  lastReply: string;
  /** The scene the turn is played in (Roleplay). */
  scene?: SceneInput | null;
  /** The most the context may take; never a size to reach. */
  ceiling: number;
  estimateTokens: (text: string) => number;
  source: SceneStateSource;
  /** The planner's answer, as parsed JSON; without it only the names in the request are needs. */
  brief?: unknown;
  /** The local embedding model, for each need's own short query; null leaves search to words. */
  embed?: (text: string) => Promise<number[] | null>;
  searchDocuments?: (need: Need) => Promise<Passage[]>;
  searchArchive?: (need: Need) => Promise<Passage[]>;
  research?: Map<number, Passage[]>;
  /** Replies still in the chat history the narrator reads: what their scenes say is already there. */
  recentOriginIds?: string[];
}

export interface AssemblyReport {
  mode: ContextMode;
  ceiling: number;
  used: number;
  needs: Array<{ id: string; kind: string; label: string; source: string; items: number; tokens: number; met: boolean }>;
  core: { items: number; tokens: number };
  degraded: Array<{ key: string; from: ItemTier; to: ItemTier | 'dropped' }>;
  admitRejected: Array<{ key: string; reason: string }>;
}

export interface AssembledContext {
  context: string;
  /** What holds while the scene lasts, for the cacheable part of the prompt. */
  stable: string;
  /** What this turn adds. */
  volatile: string;
  usedTokens: number;
  needs: Need[];
  report: AssemblyReport;
}

const TIER_RANK: Record<ItemTier, number> = { sheet: 3, card: 2, mention: 1, line: 0 };
// The turn's own words as a search, when no planner wrote one.
const MESSAGE_QUERY_CHARS = 400;
const FOLLOWED_SHOWN = 3;

/** Entities named in the records and passages a need brought, not yet in the context, as cards. */
function followNamed(found: DraftItem[], names: NameIndex, view: WorldbuildView, inContext: Set<string>): DraftItem[] {
  const followed: DraftItem[] = [];
  const taken = new Set(inContext);
  const sources = found
    .filter(item => !item.key.startsWith('entity:') && !item.key.startsWith('skill:') && (item.section === 'turn' || item.section === 'knows'))
    .sort((left, right) => right.priority - left.priority);
  for (const source of sources) {
    for (const match of names.mentionsLoose(source.text)) {
      if (followed.length >= FOLLOWED_SHOWN) return followed;
      if (taken.has(match.entityId)) continue;
      const entity = view.entity(match.entityId);
      if (!entity) continue;
      taken.add(match.entityId);
      const build = (tier: 'card' | 'mention'): DraftItem => ({
        key: `entity:${entity.id}`, section: 'turn', needIds: [...source.needIds], tier, holders: [],
        group: 'Named in what came up', priority: ROLE_PRIORITY.support,
        text: renderEntity(view, entity, tier),
        ...(tier === 'card' ? { degrade: () => build('mention') } : {})
      });
      followed.push(build('card'));
    }
  }
  return followed;
}

function loadEntities(db: Database.Database, workspaceId: string): Array<EntityRow & { aliases: string[] }> {
  return (db.prepare(`
    SELECT id, type, canonicalName, aliases, lore, data, status FROM entities WHERE workspaceId = ? AND status != 'proposed'
  `).all(workspaceId) as Array<EntityRow & { aliases: string | null }>).map(row => {
    let aliases: string[] = [];
    try { aliases = JSON.parse(row.aliases || '[]'); } catch { aliases = []; }
    return { ...row, aliases: Array.isArray(aliases) ? aliases.map(String) : [] };
  });
}

/** The same thing found twice keeps its deepest rendering, every reason it was asked for, and every holder. */
function merge(items: DraftItem[]): DraftItem[] {
  const byKey = new Map<string, DraftItem>();
  for (const item of items) {
    const existing = byKey.get(item.key);
    if (!existing) {
      byKey.set(item.key, { ...item, needIds: [...item.needIds], holders: [...item.holders] });
      continue;
    }
    const deeper = TIER_RANK[item.tier] > TIER_RANK[existing.tier] ? item : existing;
    byKey.set(item.key, {
      ...deeper,
      section: existing.section === 'core' || item.section === 'core' ? 'core' : deeper.section,
      group: existing.section === 'core' ? existing.group : deeper.group,
      needIds: [...new Set([...existing.needIds, ...item.needIds])],
      holders: [...new Set([...existing.holders, ...item.holders])],
      priority: Math.max(existing.priority, item.priority)
    });
  }
  // A statement each character holds as a record of their own is still one statement to the narrator.
  const byText = new Map<string, DraftItem>();
  const kept: DraftItem[] = [];
  for (const item of byKey.values()) {
    if (item.section !== 'knows') {
      kept.push(item);
      continue;
    }
    const same = byText.get(item.text);
    if (same) {
      same.holders = [...new Set([...same.holders, ...item.holders])];
      same.needIds = [...new Set([...same.needIds, ...item.needIds])];
      same.priority = Math.max(same.priority, item.priority);
      continue;
    }
    byText.set(item.text, item);
    kept.push(item);
  }
  return kept;
}

function fold(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase();
}

/** "12 Harvestmoon 1024" in the world's calendar, as a story-axis minute; null when it does not read as a date. */
function parseWorldDate(text: string | undefined, view: WorldbuildView, endOfDay: boolean): number | null {
  if (!text || !view.calendar || !view.names) return null;
  const match = /(\d{1,2})\s*(?:de\s+)?([\p{L}-]+)\s*(?:de\s+)?(\d{1,6})/u.exec(text);
  if (!match) return null;
  const month = view.names.months.findIndex(name => fold(name) === fold(match[2])) + 1;
  if (!month) return null;
  const eraId = String((view.clock as { eraId?: unknown } | null)?.eraId ?? '') || undefined;
  return storyMinute(view.calendar as unknown as OrdinalCalendar, {
    eraId, year: Number(match[3]), month, day: Number(match[1]),
    ...(endOfDay ? { hour: 23, minute: 59 } : {})
  } as never);
}

function measured(item: DraftItem, estimate: (text: string) => number): ContextItem {
  return { ...item, tokens: Math.max(1, estimate(item.text)) };
}

/**
 * Builds the context for one turn: the core, then each need's items, and nothing else. The ceiling
 * only shrinks it: items fall a tier, then out, lowest priority first; the core never leaves.
 */
export async function assembleContext(input: AssembleInput): Promise<AssembledContext> {
  const { db, workspaceId, mode } = input;
  input.source.prepare?.(workspaceId);
  const view = createWorldbuildView(db, workspaceId);
  const reads = new StoryReads(db, workspaceId);
  const names = new NameIndex(loadEntities(db, workspaceId));
  const scene = mode === 'roleplay' ? input.scene ?? null : null;
  const present = scene ? scenePresentIds(scene) : [];
  const inHand = new Set([
    ...(scene?.objectIds ?? []),
    ...present.flatMap(id => view.links(id).filter(link => link.direction === 'to' && (link.relType === 'owned_by' || link.relType === 'carried_by')).map(link => link.otherId))
  ]);

  const core = scene
    ? buildSceneCore({ view, reads, source: input.source, scene, names, request: input.request, lastReply: input.lastReply })
    : buildWorkspaceCore({ view, alwaysInContextIds: input.source.alwaysInContextIds(workspaceId) });

  const inScene = new Set([...present, ...(scene?.possibleObserverIds ?? []), ...(scene?.nearbyIds ?? []), ...(scene?.objectIds ?? [])]);
  const skills = loadSkillBook(db, workspaceId, [...present, ...(scene?.playerId ? [scene.playerId] : [])], id => view.nameOf(id));
  const needContext: NeedContext = { mode, request: input.request, names, presentIds: inScene, inHandIds: inHand, rulesAct: mode === 'roleplay' && !input.brief, skills: skills.refs, heldSkillIds: skills.held };
  const floor = namedNeeds(needContext);
  const needs = mergeNeeds(floor, parseBrief(input.brief, needContext));
  // Without a planner the turn is still searched, by its own words.
  if (!input.brief) {
    const query = input.request.replace(/\s+/g, ' ').trim().slice(0, MESSAGE_QUERY_CHARS);
    if (query) {
      needs.push({ id: `n${needs.length + 1}`, kind: 'open', label: 'Related to this turn', entityIds: [], use: 'mentions', query, source: 'message' });
      if (mode === 'standard') needs.push({ id: `n${needs.length + 1}`, kind: 'document', label: 'From the documents', entityIds: [], use: 'mentions', query, source: 'message' });
    }
  }

  // Written dates ("12 Harvestmoon 1024") become story-axis minutes: the start of the first day, the end of the last.
  for (const need of needs) {
    if (!need.when) continue;
    const from = parseWorldDate(need.when.fromText, view, false);
    const to = parseWorldDate(need.when.toText, view, true);
    if (from !== null) need.when.from = from;
    if (to !== null) need.when.to = to;
  }

  // A short query embeds sharper than a whole turn, which is why each need gets its own vector.
  const vectors = new Map<string, number[]>();
  if (input.embed && reads.exists) {
    for (const need of needs) {
      if (!need.entityIds.length && !need.query && need.skillIds?.length) continue;
      const text = need.query || need.label || need.entityIds.map(id => view.nameOf(id)).filter(Boolean).join(', ');
      if (!text) continue;
      try {
        const vector = await input.embed(text);
        if (vector) vectors.set(need.id, vector);
      } catch {
        // Without a vector the need is searched by its words.
      }
    }
  }

  const clock = view.clock as Record<string, unknown> | null;
  const nowMinute = storyMinute(view.calendar as unknown as OrdinalCalendar, clock as never);
  const recentEvents = reads.eventsFromOrigins(input.recentOriginIds ?? []);
  const resolved = await resolveNeeds({
    db, mode, view, reads, presentIds: present, playerId: scene?.playerId ?? null, nowMinute,
    isRecent: eventId => recentEvents.has(eventId.split('@')[0]),
    locationId: scene?.locationId ?? null,
    vectorOf: need => vectors.get(need.id) ?? null,
    searchDocuments: input.searchDocuments ?? (async () => []),
    searchArchive: input.searchArchive ?? (async () => []),
    research: input.research ?? new Map(),
    skill: id => skills.rule(id)
  }, needs);

  // What came up may name someone or something the context does not hold: the name brings a card.
  const inContext = new Set([...inScene, ...present, ...(scene?.locationId ? [scene.locationId] : []), ...(scene?.playerId ? [scene.playerId] : []), ...needs.flatMap(need => need.entityIds), ...core.flatMap(item => item.key.startsWith('entity:') ? [item.key.slice('entity:'.length)] : [])]);
  resolved.push(...followNamed(resolved, names, view, inContext));

  // Who is not in the conversation but bears on it: those named, those who could come in, and the
  // last time people meeting again were together. And what the people here hold about each other.
  const isRecent = (eventId: string) => recentEvents.has(eventId.split('@')[0]);
  const offstage: DraftItem[] = [];
  if (scene && reads.exists) {
    const involved = involvedIds(names, input.request, input.lastReply);
    const nearby = [...new Set([...scene.possibleObserverIds, ...scene.nearbyIds])].filter(id => !present.includes(id));
    const common = { view, reads, locationId: scene.locationId, present, playerId: scene.playerId, involved, nowMinute, isRecent };
    const comeIn = couldComeIn({ ...common, nearby });
    const listed = new Set(comeIn.map(item => item.key.slice('come-in:'.length)));
    offstage.push(...comeIn, ...towardNamed({ ...common, exclude: new Set([...nearby.filter(id => involved.has(id)), ...listed]) }), ...reunions({ ...common, recentEventIds: recentEvents }), ...aboutEachOther(common));
    // Who the turn has acting: the planner's "acts", or without one, who the request itself names.
    const actors = input.brief
      ? needs.filter(need => need.use === 'acts').flatMap(need => need.entityIds)
      : names.mentions(input.request).map(match => match.entityId);
    offstage.push(...actorsAboutPresent({ ...common, actors: [...new Set(actors)] }));
  }

  const focusIds = new Set([...present, ...needs.flatMap(need => need.entityIds)]);
  const narratorNotes = scene && reads.exists
    ? [...secretsAtRisk({ view, reads, present, focusIds }), ...beliefsAtOdds({ view, reads, present, focusIds }), ...outOfReach({ view, reads, present, focusIds })]
    : [];
  // Which fields of a sheet each person present knows, for who the turn is about. In a crowd only the
  // turn's own entities count, or every pair of people would add a line.
  const knownTargets = [...new Set([...needs.flatMap(need => need.entityIds), ...(present.length <= 6 ? [...present, ...(scene?.objectIds ?? []), ...(scene?.locationId ? [scene.locationId] : [])] : [])])];
  const knownItems: DraftItem[] = scene && input.source.knownLines && knownTargets.length
    ? present.flatMap(holder => input.source.knownLines!(workspaceId, holder, knownTargets).map(line => ({
      key: `known:${holder}:${line.targetId}:${line.text}`, section: 'knows' as const, needIds: [], tier: 'line' as const,
      holders: [holder], group: 'Worldbuild Knowledge', priority: ROLE_PRIORITY.support, text: line.text
    })))
    : [];
  let items = merge([...core, ...offstage, ...resolved, ...narratorNotes, ...knownItems]).map(item => measured(item, input.estimateTokens));

  // The engine confirms each character's records are theirs to hold at this point of the story.
  const admitRejected: AssemblyReport['admitRejected'] = [];
  if (reads.exists && mode === 'roleplay') {
    const byHolder = new Map<string, ContextItem[]>();
    for (const item of items) if (item.section === 'knows' && item.recordId) for (const holder of item.holders) byHolder.set(holder, [...(byHolder.get(holder) ?? []), item]);
    const rejected = new Set<string>();
    for (const [holder, group] of byHolder) {
      const records = group.filter(item => item.holders[0] === holder || item.holders.length === 1);
      const result = reads.admit(holder, records.map(item => ({ id: item.key, recordId: item.recordId!, priority: item.priority, cost: item.tokens })), input.ceiling);
      for (const rejection of result.rejected) {
        if (rejection.reason === 'not-held') continue;
        rejected.add(rejection.id);
        admitRejected.push({ key: rejection.id, reason: String(rejection.reason) });
      }
    }
    items = items.filter(item => !rejected.has(item.key));
  }

  const degraded: AssemblyReport['degraded'] = [];
  // Measured as composed, headings included, so what is sent is what was checked.
  const total = () => input.estimateTokens(composeContext({ mode, items, needs, view, presentIds: present }));
  const shrink = (pool: (item: ContextItem) => boolean, allowDrop: boolean) => {
    while (total() > input.ceiling) {
      const candidates = items.filter(pool).sort((left, right) => left.priority - right.priority || right.tokens - left.tokens);
      const target = candidates.find(item => item.degrade) ?? (allowDrop ? candidates[0] : undefined);
      if (!target) return;
      const lower = target.degrade?.() ?? null;
      degraded.push({ key: target.key, from: target.tier, to: lower ? lower.tier : 'dropped' });
      items = lower ? items.map(item => (item === target ? { ...measured(lower, input.estimateTokens), needIds: target.needIds, holders: target.holders, section: target.section } : item)) : items.filter(item => item !== target);
    }
  };
  shrink(item => item.section !== 'core' && item.section !== 'rules', true);
  shrink(item => item.section === 'core', false);

  const parts = composeContextParts({ mode, items, needs, view, presentIds: present });
  const context = [parts.stable, parts.volatile].filter(Boolean).join('\n\n');
  const usedTokens = input.estimateTokens(context);
  const report: AssemblyReport = {
    mode,
    ceiling: input.ceiling,
    used: usedTokens,
    core: { items: items.filter(item => item.section === 'core').length, tokens: items.filter(item => item.section === 'core').reduce((sum, item) => sum + item.tokens, 0) },
    needs: needs.map(need => {
      const own = items.filter(item => item.needIds.includes(need.id));
      return { id: need.id, kind: need.kind, label: need.label || [...need.entityIds.map(id => view.nameOf(id)), ...(need.skillIds ?? []).map(id => skills.rule(id)?.name)].filter(Boolean).join(', '), source: need.source, items: own.length, tokens: own.reduce((sum, item) => sum + item.tokens, 0), met: own.length > 0 };
    }),
    degraded,
    admitRejected
  };
  return { context, stable: parts.stable, volatile: parts.volatile, usedTokens, needs, report };
}
