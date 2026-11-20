import type Database from 'better-sqlite3';
import { firstSentence, renderEntity, type EntityTier, type WorldbuildView } from './entity-tiers';
import { renderFact, renderHolding, storyDateLabel, type DraftItem } from './items';
import type { ContextMode, Need } from './needs';
import { isRetired, ROLE_PRIORITY, salience } from './salience';
import type { HoldingItem, StoryReads, StoryRecord } from './story-reads';
import { STORY_AXIS } from '../umwelt/narrative-world';
import { storyRecordText } from '../umwelt/story-text';
import { sharedKnowledgeCards } from '../../worldbuild/knowledge-groups';

/** A skill as the rule it is, with who in the scene has it and at what rank. */
export interface SkillRule { name: string; description: string; parentName?: string; holders: Array<{ name: string; rank: string }> }

/** A passage of a document or of the chat archive, as a search returned it. */
export interface Passage { id: string; source: string; text: string; score?: number }

export interface ResolverContext {
  db: Database.Database;
  mode: ContextMode;
  view: WorldbuildView;
  reads: StoryReads;
  presentIds: string[];
  playerId: string | null;
  /** The story-axis minute of now, for recency. */
  nowMinute: number | null;
  vectorOf(need: Need): number[] | null;
  searchDocuments(need: Need): Promise<Passage[]>;
  searchArchive(need: Need): Promise<Passage[]>;
  /** What the research loop found for a need, by its place in the planner's answer. */
  research: Map<number, Passage[]>;
  skill(id: string): SkillRule | null;
  /** An event from a reply still in the chat history: the narrator already reads it there. */
  isRecent?(eventId: string): boolean;
}

// Within one holder's own records the candidates are already theirs, and a first-person memory scores
// lower against a short query than canon does: the relative floor may reach further down.
const HOLDER_FLOOR = 0.84;
const LIMITS = { facts: 3, knowledgePerHolder: 3, knowledge: 6, recall: 4, recallScenes: 2, unaware: 6, place: 3, chronology: 20, documents: 4, open: 3 };
const HOLDER_TYPES = new Set(['Characters', 'Creatures', 'Factions']);

function entityDraft(ctx: ResolverContext, need: Need, id: string, tier: EntityTier): DraftItem | null {
  const entity = ctx.view.entity(id);
  if (!entity) return null;
  const lower: Record<EntityTier, EntityTier | null> = { sheet: 'card', card: 'mention', mention: null };
  const build = (current: EntityTier): DraftItem => ({
    key: `entity:${id}`,
    section: 'turn',
    needIds: [need.id],
    tier: current,
    holders: [],
    group: need.label || entity.canonicalName,
    priority: ROLE_PRIORITY.direct + (need.use === 'acts' ? 5 : 0),
    text: renderEntity(ctx.view, entity, current),
    ...(lower[current] ? { degrade: () => build(lower[current]!) } : {})
  });
  return build(tier);
}

function folded(value: string): string[] {
  return String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);
}

/**
 * At least half of the query's words (two, or the only one), in any form ("peça", "peças"): the
 * archive's own floor lets nearly every passage through, so the last resort must match by words.
 */
function carriesQuery(text: string, query: string): boolean {
  const terms = [...new Set(folded(query).filter(term => term.length >= 4))];
  if (!terms.length) return false;
  const words = folded(text);
  const found = terms.filter(term => {
    const stem = term.slice(0, Math.max(4, term.length - 2));
    return words.some(word => word.startsWith(stem));
  }).length;
  return found >= Math.min(terms.length, Math.max(2, Math.ceil(terms.length / 2)));
}

function nameOf(ctx: ResolverContext): (id: string) => string | undefined {
  return id => ctx.view.nameOf(id);
}

function factLine(ctx: ResolverContext, record: StoryRecord): string {
  return renderFact(record, fallback => storyRecordText(ctx.db, ctx.view.workspaceId, fallback, id => ctx.view.nameOf(id) ?? id));
}

function holdingDraft(ctx: ResolverContext, need: Need, item: HoldingItem, group: string, role: 'direct' | 'support', match?: number): DraftItem | null {
  const record = item.record;
  if (record.kind !== 'holding' || isRetired(record) || record.accessibility !== 'available') return null;
  const text = renderHolding(item, ctx.view, nameOf(ctx));
  if (!text) return null;
  return {
    key: `record:${record.id}`,
    section: ctx.mode === 'roleplay' ? 'knows' : 'turn',
    needIds: [need.id],
    tier: 'line',
    recordId: record.id,
    holders: [record.holder],
    group: ctx.mode === 'roleplay' ? group : `${ctx.view.nameOf(record.holder) ?? 'Someone'}: ${group}`,
    priority: salience({ role, record, heldByPresent: ctx.presentIds.includes(record.holder), ...(match !== undefined ? { match } : {}) }),
    text
  };
}

function rankHoldings(ctx: ResolverContext, items: HoldingItem[]): HoldingItem[] {
  return items
    .filter(item => item.record.kind === 'holding' && !isRetired(item.record))
    .sort((left, right) => salience({ role: 'support', record: right.record }) - salience({ role: 'support', record: left.record })
      || right.record.position.tick - left.record.position.tick);
}

/** Facts about an entity that the turn's wording points at, or the latest ones without a vector. */
function factsAbout(ctx: ResolverContext, need: Need, entityId: string): DraftItem[] {
  const vector = ctx.vectorOf(need);
  const query = need.query || need.label || ctx.view.nameOf(entityId) || '';
  const records = vector
    ? ctx.reads.search({ text: query, vector, subject: entityId, limit: LIMITS.facts, relative: true }).map(hit => hit.record).filter((record): record is StoryRecord => Boolean(record))
    : ctx.reads.factsAbout(entityId).slice(-LIMITS.facts);
  return records.filter(record => record.kind === 'fact' && !isRetired(record)).flatMap(record => {
    const text = factLine(ctx, record);
    return text ? [{
      key: `record:${record.id}`, section: 'turn' as const, needIds: [need.id], tier: 'line' as const, recordId: record.id,
      holders: [], group: need.label || ctx.view.nameOf(entityId) || 'Facts', priority: salience({ role: 'support', record }), text
    }] : [];
  });
}

/** What each person in the scene knows about an entity, and who does not know it exists. */
function knownByPresent(ctx: ResolverContext, need: Need, entityId: string): DraftItem[] {
  if (ctx.mode !== 'roleplay') return [];
  const items: DraftItem[] = [];
  const entity = ctx.view.entity(entityId);
  const label = need.label || entity?.canonicalName || 'this';
  const unaware: string[] = [];
  for (const holder of ctx.presentIds) {
    if (holder === entityId) continue;
    // A member reads what their faction or area holds about a target its card lets them share.
    const groups = sharedKnowledgeCards(ctx.db, ctx.view.workspaceId, [holder], [entityId]).map(card => card.groupId);
    const own = rankHoldings(ctx, ctx.reads.holdingsAbout(holder, entityId)).slice(0, LIMITS.knowledgePerHolder);
    const shared = [...new Set(groups)].flatMap(group => rankHoldings(ctx, ctx.reads.holdingsAbout(group, entityId)).slice(0, LIMITS.knowledgePerHolder)
      .map(item => ({ item, via: ctx.view.nameOf(group) })));
    const held = [...own.map(item => ({ item, via: undefined as string | undefined })), ...shared];
    for (const { item, via } of held) {
      const draft = holdingDraft(ctx, need, item, `About ${entity?.canonicalName ?? label}`, 'support');
      if (draft) items.push({ ...draft, key: `${draft.key}:${holder}`, holders: [holder], ...(via ? { text: `${draft.text} (as one of ${via})` } : {}) });
    }
    if (!held.length && entity && HOLDER_TYPES.has(entity.type) && !ctx.reads.isAware(holder, entityId)) unaware.push(ctx.view.nameOf(holder) ?? 'Someone');
  }
  if (unaware.length && entity) {
    items.push({
      key: `unaware:${entityId}`, section: 'narrator', needIds: [need.id], tier: 'line', holders: [], group: 'Who does not know',
      priority: ROLE_PRIORITY.support, text: `${unaware.slice(0, LIMITS.unaware).join(', ')} ${unaware.length === 1 ? 'does' : 'do'} not know ${entity.canonicalName} exists.`
    });
  }
  return items;
}

function sceneLine(ctx: ResolverContext, event: { title: string; description?: string | null; on?: Record<string, number> }): string {
  const date = storyDateLabel(event.on?.[STORY_AXIS], ctx.view);
  const description = String(event.description ?? '').trim();
  const body = description && description !== event.title ? description : event.title;
  return `${date ? `${date}: ` : ''}${body}`;
}

async function resolveOne(ctx: ResolverContext, need: Need, recallMinutes: Map<string, number>): Promise<DraftItem[]> {
  const items: DraftItem[] = [];
  const push = (item: DraftItem | null) => { if (item) items.push(item); };
  const vector = ctx.vectorOf(need);
  const query = need.query || need.label;

  switch (need.kind) {
    case 'entity':
    case 'rule': {
      for (const id of need.entityIds) {
        const entity = ctx.view.entity(id);
        const tier: EntityTier = need.use === 'acts' ? 'sheet' : 'card';
        push(entityDraft(ctx, need, id, tier));
        if (entity?.type !== 'System') {
          items.push(...factsAbout(ctx, need, id), ...knownByPresent(ctx, need, id));
        }
      }
      for (const id of need.skillIds ?? []) {
        const skill = ctx.skill(id);
        if (!skill) continue;
        const heading = `${skill.name} (skill${skill.parentName ? `, under ${skill.parentName}` : ''})`;
        const holders = skill.holders.map(holder => `${holder.name}: ${holder.rank}`).join(', ');
        items.push({
          key: `skill:${id}`, section: 'turn', needIds: [need.id], tier: 'line', holders: [],
          group: need.label || skill.name, priority: ROLE_PRIORITY.direct + (need.use === 'acts' ? 5 : 0),
          text: [skill.description ? `${heading}: ${skill.description}` : heading, holders ? `In the scene: ${holders}.` : ''].filter(Boolean).join('\n')
        });
      }
      break;
    }
    case 'recall': {
      const holder = need.holderId ?? ctx.playerId;
      if (holder) {
        const hits = ctx.reads.search({ holderId: holder, text: query, vector, limit: LIMITS.recall, relative: true, floor: HOLDER_FLOOR });
        for (const hit of hits) {
          const record = hit.record;
          if (!record || record.kind !== 'holding') continue;
          push(holdingDraft(ctx, need, { record, acquisition: record.acquisition } as HoldingItem, need.label || 'Remembered', 'direct', hit.similarity));
        }
      }
      const scenes = ctx.reads.search({ docType: 'event', text: query, vector, limit: 10, relative: true })
        .filter(hit => hit.event && ctx.reads.isScene({ id: hit.docId, type: hit.event.type ?? '' }) && !ctx.isRecent?.(hit.docId))
        .slice(0, LIMITS.recallScenes);
      for (const hit of scenes) {
        const minute = hit.event?.on?.[STORY_AXIS];
        if (holder && Number.isFinite(minute) && !recallMinutes.has(holder)) recallMinutes.set(holder, minute!);
        items.push({
          key: `event:${hit.docId}`, section: 'turn', needIds: [need.id], tier: 'line', eventId: hit.docId, holders: [],
          group: need.label || 'Earlier scene', priority: salience({ role: 'direct', minute, now: ctx.nowMinute, match: hit.similarity }),
          text: sceneLine(ctx, hit.event!)
        });
      }
      break;
    }
    case 'knowledge': {
      const holder = need.holderId ?? ctx.playerId;
      if (!holder) break;
      const minute = recallMinutes.get(holder);
      const at = minute !== undefined ? { axis: STORY_AXIS, tick: minute } : undefined;
      const held = need.entityIds.length
        ? need.entityIds.flatMap(id => rankHoldings(ctx, ctx.reads.holdingsAbout(holder, id, at)))
        : ctx.reads.search({ holderId: holder, text: query, vector, limit: LIMITS.knowledge, relative: true, floor: HOLDER_FLOOR }).flatMap(hit => hit.record?.kind === 'holding' ? [{ record: hit.record, acquisition: hit.record.acquisition } as HoldingItem] : []);
      for (const item of held.slice(0, LIMITS.knowledge)) push(holdingDraft(ctx, need, item, need.label || 'Known', 'direct'));
      break;
    }
    case 'who-knows': {
      // What is asked about may be canon or only someone's holding: the closest statement anywhere anchors it.
      const candidates = [
        ...ctx.reads.search({ text: query, vector, limit: 1 }),
        ...(vector ? ctx.reads.holderIds().flatMap(holder => ctx.reads.search({ holderId: holder, text: '', vector, limit: 1 })) : [])
      ].filter(hit => hit.record);
      const best = candidates.sort((left, right) => (right.similarity ?? 0) - (left.similarity ?? 0) || right.score - left.score)[0];
      const anchor = best?.record;
      if (!anchor || (anchor.kind !== 'fact' && anchor.kind !== 'holding')) break;
      const statement = anchor.kind === 'fact' ? factLine(ctx, anchor) : String(anchor.text ?? '');
      const { claimKey } = ctx.reads.world.raw<{ claimKey: string }>('claim.key', { claim: anchor.claim });
      const holders = ctx.reads.whoHolds(claimKey);
      const lines = holders.map(item => `${ctx.view.nameOf(item.holder) ?? 'Someone'}: ${item.polarity === anchor.claim.polarity ? item.attitude : `${item.attitude} the opposite`}`);
      const missing = ctx.presentIds.filter(id => !holders.some(item => item.holder === id)).map(id => ctx.view.nameOf(id) ?? 'Someone');
      items.push({
        key: `who:${claimKey}`, section: ctx.mode === 'roleplay' ? 'narrator' : 'turn', needIds: [need.id], tier: 'line', holders: [],
        group: need.label || 'Who knows', priority: ROLE_PRIORITY.direct,
        text: [`"${statement}"`, lines.length ? `Held by: ${lines.join('; ')}` : 'Held by no one yet.', ...(missing.length ? [`Not known to: ${missing.join(', ')}`] : [])].join('\n')
      });
      break;
    }
    case 'relationship': {
      const [a, b] = need.entityIds;
      if (!a || !b) break;
      for (const [holder, target] of [[a, b], [b, a]]) {
        for (const record of ctx.reads.dispositions(holder, target)) {
          if (record.kind !== 'disposition') continue;
          items.push({
            key: `record:${record.id}`, section: 'turn', needIds: [need.id], tier: 'line', recordId: record.id, holders: [holder],
            group: need.label || 'Relationship', priority: ROLE_PRIORITY.direct,
            text: `${ctx.view.nameOf(holder) ?? 'Someone'} → ${ctx.view.nameOf(target) ?? 'someone'}: ${record.dimension} ${Number(record.value)}`
          });
        }
      }
      break;
    }
    case 'place': {
      const placeId = need.entityIds[0];
      if (!placeId) break;
      push(entityDraft(ctx, need, placeId, 'card'));
      const rows = ctx.reads.sceneIdsAt(placeId, LIMITS.place);
      const details = ctx.db.prepare('SELECT event_id AS id, description FROM narrative_events WHERE workspace_id = ? AND event_id = ?');
      for (const id of rows) {
        const row = details.get(ctx.view.workspaceId, id) as { id: string; description: string } | undefined;
        if (!row?.description) continue;
        items.push({ key: `event:${id}`, section: 'turn', needIds: [need.id], tier: 'line', eventId: id, holders: [], group: need.label || 'Here before', priority: ROLE_PRIORITY.support, text: row.description });
      }
      break;
    }
    case 'chronology': {
      const subject = need.entityIds[0];
      if (!subject) break;
      const events = ctx.reads.eventsOf(subject, { ...(need.when?.from !== undefined ? { from: need.when.from } : {}), ...(need.when?.to !== undefined ? { to: need.when.to } : {}) })
        .filter(event => ctx.reads.isScene(event));
      // A long span keeps its shape: events are taken evenly across it, not only its last days.
      const step = events.length > LIMITS.chronology ? (events.length - 1) / (LIMITS.chronology - 1) : 1;
      const spread = events.length > LIMITS.chronology ? Array.from({ length: LIMITS.chronology }, (_, index) => events[Math.round(index * step)]) : events;
      const lines = spread.map(event => `- ${sceneLine(ctx, event)}`);
      if (lines.length) items.push({ key: `chronology:${subject}:${need.id}`, section: 'turn', needIds: [need.id], tier: 'line', holders: [], group: need.label || `What happened to ${ctx.view.nameOf(subject) ?? 'them'}`, priority: ROLE_PRIORITY.direct, text: lines.join('\n') });
      break;
    }
    case 'document': {
      for (const passage of (await ctx.searchDocuments(need)).slice(0, LIMITS.documents)) {
        items.push({ key: `passage:${passage.id}`, section: 'turn', needIds: [need.id], tier: 'line', holders: [], group: `${need.label || 'From the documents'} (${passage.source})`, priority: ROLE_PRIORITY.direct, text: passage.text });
      }
      break;
    }
    case 'research': {
      for (const passage of (need.briefIndex !== undefined ? ctx.research.get(need.briefIndex) : undefined) ?? []) {
        items.push({ key: `passage:${passage.id}`, section: 'turn', needIds: [need.id], tier: 'line', holders: [], group: `${need.label || 'Research'} (${passage.source})`, priority: ROLE_PRIORITY.direct, text: passage.text });
      }
      break;
    }
    case 'open': {
      const found = ctx.reads.search({ text: query, vector, limit: LIMITS.open, relative: true });
      for (const hit of found) {
        if (hit.record?.kind === 'fact' && !ctx.isRecent?.(hit.record.eventId)) {
          const text = factLine(ctx, hit.record);
          if (text) items.push({ key: `record:${hit.docId}`, section: 'turn', needIds: [need.id], tier: 'line', recordId: hit.docId, holders: [], group: need.label || 'Related', priority: salience({ role: 'direct', record: hit.record, match: hit.similarity }), text });
        }
      }
      const scenes = ctx.reads.search({ docType: 'event', text: query, vector, limit: 6, relative: true })
        .filter(hit => hit.event && ctx.reads.isScene({ id: hit.docId, type: hit.event.type ?? '' }) && !ctx.isRecent?.(hit.docId)).slice(0, LIMITS.open);
      for (const hit of scenes) items.push({ key: `event:${hit.docId}`, section: 'turn', needIds: [need.id], tier: 'line', eventId: hit.docId, holders: [], group: need.label || 'Related', priority: salience({ role: 'direct', match: hit.similarity }), text: sceneLine(ctx, hit.event!) });
      if (!items.length && ctx.mode === 'standard') {
        for (const passage of (await ctx.searchDocuments(need)).slice(0, LIMITS.open)) items.push({ key: `passage:${passage.id}`, section: 'turn', needIds: [need.id], tier: 'line', holders: [], group: `${need.label || 'From the documents'} (${passage.source})`, priority: ROLE_PRIORITY.support, text: passage.text });
      }
      if (!items.length) {
        const archived = (await ctx.searchArchive(need)).filter(passage => carriesQuery(passage.text, query));
        for (const passage of archived.slice(0, LIMITS.open)) items.push({ key: `passage:${passage.id}`, section: 'turn', needIds: [need.id], tier: 'line', holders: [], group: `${need.label || 'Earlier in the chat'} (archive)`, priority: ROLE_PRIORITY.fallback, text: passage.text });
      }
      break;
    }
  }
  return items;
}

/** Every need's items, recalls first so a flashback can date the knowledge read after it. */
export async function resolveNeeds(ctx: ResolverContext, needs: Need[]): Promise<DraftItem[]> {
  const recallMinutes = new Map<string, number>();
  const ordered = [...needs].sort((left, right) => Number(right.kind === 'recall') - Number(left.kind === 'recall'));
  const items: DraftItem[] = [];
  for (const need of ordered) items.push(...await resolveOne(ctx, need, recallMinutes));
  return items;
}

export { firstSentence };
