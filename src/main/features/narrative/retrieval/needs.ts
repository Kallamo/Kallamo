import type { EntityRow } from './entity-tiers';

const { buildNameIndex, findLiteralMentions } = require('../../world-index/literal-mentions');

export type ContextMode = 'roleplay' | 'standard';

export type NeedKind =
  | 'entity'
  | 'rule'
  | 'recall'
  | 'knowledge'
  | 'who-knows'
  | 'relationship'
  | 'open'
  | 'place'
  | 'document'
  | 'chronology'
  | 'research';

export const ROLEPLAY_NEEDS: NeedKind[] = ['entity', 'rule', 'recall', 'knowledge', 'who-knows', 'relationship', 'place', 'open'];
export const STANDARD_NEEDS: NeedKind[] = ['entity', 'rule', 'recall', 'knowledge', 'who-knows', 'relationship', 'document', 'chronology', 'research', 'open'];

/** One thing the request needs the context to hold, and why. */
export interface Need {
  id: string;
  kind: NeedKind;
  label: string;
  entityIds: string[];
  holderId?: string;
  /** Acted on, used or examined: a full sheet. Only mentioned: a card. */
  use: 'acts' | 'mentions';
  when?: { text: string; fromText?: string; toText?: string; from?: number; to?: number };
  /** A short query for search; never the whole request. */
  query?: string;
  documentName?: string;
  /** Skills the turn uses: a rule like a System, kept apart from the Worldbuild. */
  skillIds?: string[];
  /** Where the need stood in the planner's answer, for what was researched for it. */
  briefIndex?: number;
  /** names: written in the turn; brief: the planner asked; message: searched by the turn's own words. */
  source: 'names' | 'brief' | 'message';
}

/** A skill of the workspace, as a rule the turn may ask for. */
export interface SkillRef { id: string; name: string; description: string; parentId: string | null }

export interface NameMatch { entityId: string; type: string }

// Events and rules are spoken of as common nouns ("the festival", "insight").
const CASE_FREE_TYPES = new Set(['Events', 'System']);
const MAX_NEEDS = 8;
// A part of a name shorter than this is too likely an ordinary word to stand for the name.
const MIN_NAME_WORD = 5;
// In free text, a lower-case part must be at least this long to count.
const LONG_NAME_WORD = 10;

/** Finds registered names written in a text, as the gate does. */
export class NameIndex {
  private readonly index: unknown;
  private readonly byName = new Map<string, EntityRow[]>();
  /** A word of a name that no other name uses ("Ironbloom" in "Ironbloom Ore"). */
  private readonly byWord = new Map<string, EntityRow>();

  constructor(private readonly entities: Array<EntityRow & { aliases?: string[] }>) {
    this.index = buildNameIndex(entities, { caseFreeTypes: CASE_FREE_TYPES });
    const owners = new Map<string, Set<string>>();
    for (const entity of entities) {
      for (const name of [entity.canonicalName, ...(entity.aliases ?? [])]) {
        const key = fold(name);
        if (key) this.byName.set(key, [...(this.byName.get(key) ?? []), entity]);
        for (const word of key.split(' ')) {
          if (word.length < MIN_NAME_WORD) continue;
          owners.set(word, new Set([...(owners.get(word) ?? []), entity.id]));
        }
      }
    }
    for (const [word, ids] of owners) {
      if (ids.size !== 1) continue;
      const entity = entities.find(item => item.id === [...ids][0]);
      // A whole one-word name is already a full match; a part only counts inside a longer name.
      if (entity && fold(entity.canonicalName) !== word) this.byWord.set(word, entity);
    }
  }

  mentions(text: string): NameMatch[] {
    if (!String(text || '').trim()) return [];
    const found = findLiteralMentions(text, this.index) as Array<{ entityId: string; type?: string }>;
    const seen = new Set<string>();
    return found.flatMap(mention => {
      if (seen.has(mention.entityId)) return [];
      seen.add(mention.entityId);
      const entity = this.entities.find(item => item.id === mention.entityId);
      return entity ? [{ entityId: entity.id, type: entity.type }] : [];
    });
  }

  /**
   * Entities named only by a distinctive part of their name. In free text a part counts only when it
   * is written as a proper noun or is long enough not to be an ordinary word.
   */
  partialMentions(text: string): NameMatch[] {
    const seen = new Set<string>();
    const matches: NameMatch[] = [];
    for (const raw of String(text || '').split(/[^\p{L}\p{N}]+/u)) {
      const word = fold(raw);
      const entity = this.byWord.get(word);
      if (!entity || seen.has(entity.id)) continue;
      const properNoun = raw.charAt(0) !== raw.charAt(0).toLocaleLowerCase();
      if (!properNoun && word.length < LONG_NAME_WORD) continue;
      seen.add(entity.id);
      matches.push({ entityId: entity.id, type: entity.type });
    }
    return matches;
  }

  /** Full names first, then distinctive parts of names. */
  mentionsLoose(text: string): NameMatch[] {
    const full = this.mentions(text);
    const known = new Set(full.map(match => match.entityId));
    return [...full, ...this.partialMentions(text).filter(match => !known.has(match.entityId))];
  }

  /**
   * A name the planner wrote, resolved to the entities it may mean: the name or an alias, else the
   * one name it is a part of ("Twin Daggers"), else the one name its distinctive words point to.
   */
  resolve(name: string): EntityRow[] {
    const key = fold(name);
    const exact = this.byName.get(key);
    if (exact?.length) return exact;
    if (!key) return [];
    const containing = this.entities.filter(entity => [entity.canonicalName, ...(entity.aliases ?? [])].some(other => ` ${fold(other)} `.includes(` ${key} `)));
    if (containing.length === 1) return containing;
    const pointed = new Set(key.split(' ').map(word => this.byWord.get(word)?.id).filter((id): id is string => Boolean(id)));
    if (pointed.size === 1) return this.entities.filter(entity => pointed.has(entity.id));
    return [];
  }

  /**
   * Rules named in the planner's own words: a rule is a common noun, written in the singular or
   * the plural ("rarity" for "Rarities", "raridade" for "Raridades").
   */
  rulesIn(text: string): string[] {
    const words = loose(text);
    if (!words) return [];
    return this.entities
      .filter(entity => entity.type === 'System' && [entity.canonicalName, ...(entity.aliases ?? [])].some(name => namedIn(words, name)))
      .map(entity => entity.id);
  }
}

function fold(value: string): string {
  return String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

// Folded, each word cut to a stem both its singular and plural share ("raridade(s)", "habilidad(es)",
// "Fähigkeit(en)", "rarity/rarities"): enough for the names of rules and skills.
function loose(value: string): string {
  return fold(value).split(' ').map(word => {
    if (word.length <= 3) return word;
    if (word.endsWith('ies')) return `${word.slice(0, -3)}y`;
    if (word.endsWith('en')) return word.slice(0, -2);
    return word.replace(/s$/, '').replace(/e$/, '');
  }).join(' ');
}

function namedIn(looseText: string, name: string): boolean {
  const wanted = loose(name);
  return wanted.length >= 3 && ` ${looseText} `.includes(` ${wanted} `);
}

export interface NeedContext {
  mode: ContextMode;
  request: string;
  names: NameIndex;
  /** Who is in the scene (Roleplay): their sheets come with the scene itself. */
  presentIds: Set<string>;
  /** Items the player carries or the scene holds: naming one is using it. */
  inHandIds: Set<string>;
  /** Without a planner, a rule the Roleplay turn names is taken as used. */
  rulesAct?: boolean;
  /** Every skill of the workspace, for the planner's names. */
  skills?: SkillRef[];
  /** Skills someone in the scene has: naming one in the turn asks for it. */
  heldSkillIds?: Set<string>;
}

/** Skills whose names stand as whole words in a text, in the singular or the plural. */
function skillMentions(text: string, skills: SkillRef[]): SkillRef[] {
  const words = loose(text);
  return skills.filter(skill => namedIn(words, skill.name));
}

/** What the request names, without any model: the floor every context keeps. */
export function namedNeeds(context: NeedContext): Need[] {
  const needs: Need[] = [];
  for (const match of context.names.mentionsLoose(context.request)) {
    if (context.presentIds.has(match.entityId)) continue;
    const kind: NeedKind = match.type === 'System' ? 'rule' : 'entity';
    // A rule named in passing is a card; the brief says when the turn uses it.
    const acts = (match.type === 'System' && context.rulesAct === true) || context.inHandIds.has(match.entityId);
    needs.push({ id: `n${needs.length + 1}`, kind, label: '', entityIds: [match.entityId], use: acts ? 'acts' : 'mentions', source: 'names' });
  }
  const held = (context.skills ?? []).filter(skill => context.heldSkillIds?.has(skill.id));
  for (const skill of skillMentions(context.request, held)) {
    needs.push({ id: `n${needs.length + 1}`, kind: 'rule', label: skill.name, entityIds: [], skillIds: [skill.id], use: 'mentions', source: 'names' });
  }
  return needs;
}

/** The JSON the planner answers with. */
export function briefSchema(kinds: NeedKind[]): Record<string, unknown> {
  return {
    type: 'object',
    additionalProperties: false,
    required: ['needs'],
    properties: {
      needs: {
        type: 'array',
        maxItems: MAX_NEEDS,
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'label'],
          properties: {
            kind: { type: 'string', enum: kinds },
            label: { type: 'string' },
            entities: { type: 'array', items: { type: 'string' } },
            holder: { type: 'string' },
            use: { type: 'string', enum: ['acts', 'mentions'] },
            query: { type: 'string' },
            when: { type: 'string' },
            from: { type: 'string' },
            to: { type: 'string' },
            document: { type: 'string' }
          }
        }
      }
    }
  };
}

const KIND_GUIDE: Record<NeedKind, string> = {
  entity: 'someone or something named that is not in the scene; "use": "acts" when it is used, examined or acted on',
  rule: 'a system, power, skill or rule the turn invokes or asks about; its name in "entities" (always "acts")',
  recall: 'a past moment the text calls back ("that day", "like in the tournament"); give "holder" (who remembers) and a short "query"',
  knowledge: 'what one character knows about someone or something; "holder" and "entities"',
  'who-knows': 'who knows a fact or secret; "query" says which',
  relationship: 'how two characters stand toward each other; both in "entities"',
  place: 'what happened before at, or exists in, a place; the place in "entities"',
  document: 'a passage of a knowledge base document; its name in "document" when given, and a short "query"',
  chronology: 'what happened to someone, or between two dates, in order; "entities", and "from"/"to" as written dates ("12 Harvestmoon 1024") when the text gives them',
  research: 'a question that needs several steps or a comparison across sources',
  open: 'anything else the answer depends on that the story or the documents may hold; a short "query"'
};

export interface BriefInput {
  mode: ContextMode;
  request: string;
  lastReply: string;
  coreNames: string[];
  mentioned: string[];
  documents: string[];
  /** Skills of those in the scene, so the planner can name the one the turn uses. */
  skills?: string[];
  /** What the Worldbuild links to the names above, so a thing the turn describes can be named. */
  linked?: string[];
  /** The profile's own instructions for what to look up. */
  guidance?: string;
}

/** The planner's whole request: stable instructions first, the turn after them. */
export function briefPrompt(input: BriefInput): { systemPrompt: string; prompt: string } {
  const kinds = input.mode === 'roleplay' ? ROLEPLAY_NEEDS : STANDARD_NEEDS;
  const systemPrompt = [
    'You read one turn of a story and list what the writer needs to look up to continue it well. You never write the story.',
    input.mode === 'roleplay'
      ? 'The scene (place, time, everyone present with their sheets, what they perceived) is already in the writer\'s context. List only what lies outside it, or a rule or item the turn uses.'
      : 'The writer works as the author, with what the user pinned. List what the request depends on.',
    'Kinds of need:',
    ...kinds.map(kind => `- ${kind}: ${KIND_GUIDE[kind]}`),
    'Rules:',
    '- Write names exactly as the text or the lists below spell them. Never invent a name.',
    '- A thing the turn describes without its name ("his daggers", "the old forge") may be one of the linked names; name it.',
    '- A "query" is a few words about the thing itself, in the story\'s language; never copy the whole turn.',
    `- At most ${MAX_NEEDS} needs. When the scene is enough, answer {"needs": []}.`,
    '- Answer with the JSON object only.',
    ...(input.guidance?.trim() ? [`What this story's profile asks the search to keep in mind:\n${input.guidance.trim().slice(0, 1500)}`] : [])
  ].join('\n');
  const prompt = [
    input.coreNames.length ? `${input.mode === 'roleplay' ? 'In the scene' : 'Pinned'}: ${input.coreNames.join(', ')}` : '',
    input.mentioned.length ? `Names found in the turn: ${input.mentioned.join(', ')}` : '',
    input.documents.length ? `Documents: ${input.documents.slice(0, 40).join(', ')}` : '',
    input.skills?.length ? `Skills in the scene: ${input.skills.slice(0, 80).join(', ')}` : '',
    input.linked?.length ? `Linked to the names above: ${input.linked.join('; ')}` : '',
    input.lastReply.trim() ? `Previous reply (end):\n${input.lastReply.trim().slice(-4000)}` : '',
    `Turn:\n${input.request.trim()}`
  ].filter(Boolean).join('\n\n');
  return { systemPrompt, prompt };
}

interface BriefNeed { kind?: unknown; label?: unknown; entities?: unknown; holder?: unknown; use?: unknown; query?: unknown; when?: unknown; from?: unknown; to?: unknown; document?: unknown }

/**
 * The planner's needs, with every name resolved by the index. A name that resolves to nothing is
 * kept as an open question; one that resolves to several picks the one the turn named, if any.
 */
export function parseBrief(value: unknown, context: NeedContext, offset = 0): Need[] {
  const raw = (value && typeof value === 'object' ? (value as { needs?: unknown }).needs : null);
  if (!Array.isArray(raw)) return [];
  const kinds = new Set(context.mode === 'roleplay' ? ROLEPLAY_NEEDS : STANDARD_NEEDS);
  const named = new Set(context.names.mentions(context.request).map(match => match.entityId));
  const resolveOne = (name: unknown): string | null => {
    const matches = context.names.resolve(String(name ?? ''));
    if (!matches.length) return null;
    return (matches.find(entity => named.has(entity.id)) ?? matches[0]).id;
  };
  const skills = context.skills ?? [];
  const skillNamed = (name: string): SkillRef | undefined => skills.find(skill => fold(skill.name) === fold(name));
  const needs: Need[] = [];
  const asked = new Set<string>();
  for (const [index, item] of (raw.slice(0, MAX_NEEDS) as BriefNeed[]).entries()) {
    let kind = String(item.kind ?? '') as NeedKind;
    if (!kinds.has(kind)) continue;
    const names = Array.isArray(item.entities) ? item.entities.map(String) : [];
    let entityIds = names.map(resolveOne).filter((id): id is string => Boolean(id));
    let skillIds = names.filter(name => !context.names.resolve(name).length).map(name => skillNamed(name)?.id).filter((id): id is string => Boolean(id));
    const holderId = item.holder ? resolveOne(item.holder) ?? undefined : undefined;
    const query = String(item.query ?? '').trim().slice(0, 200);
    const label = String(item.label ?? '').trim().slice(0, 120);
    if ((kind === 'entity' || kind === 'rule') && !entityIds.length && !skillIds.length) {
      // The planner often names the rule only in its own words: the label and query may still carry the name.
      const words = [label, query].filter(Boolean).join('. ');
      entityIds = kind === 'rule' ? context.names.rulesIn(words) : context.names.mentions(words).map(match => match.entityId);
      if (kind === 'rule') skillIds = skillMentions(words, skills).map(skill => skill.id);
    }
    if (skillIds.length && !entityIds.length) kind = 'rule';
    if ((kind === 'entity' || kind === 'rule') && !entityIds.length && !skillIds.length) {
      if (!query && !names.length && !label) continue;
      kind = 'open';
    }
    // Two needs for the same rule or entity are one.
    const targets = [...entityIds.map(id => `e:${id}`), ...skillIds.map(id => `s:${id}`)];
    if ((kind === 'entity' || kind === 'rule') && targets.every(target => asked.has(target))) continue;
    if (kind === 'entity' || kind === 'rule') targets.forEach(target => asked.add(target));
    needs.push({
      id: `n${offset + needs.length + 1}`,
      kind,
      label,
      entityIds: [...new Set(entityIds)],
      ...(skillIds.length ? { skillIds: [...new Set(skillIds)] } : {}),
      briefIndex: index,
      ...(holderId ? { holderId } : {}),
      use: item.use === 'acts' || kind === 'rule' ? 'acts' : 'mentions',
      ...(item.when || item.from || item.to ? { when: { text: String(item.when ?? [item.from, item.to].filter(Boolean).join(' - ')).slice(0, 120), ...(item.from ? { fromText: String(item.from).slice(0, 60) } : {}), ...(item.to ? { toText: String(item.to).slice(0, 60) } : {}) } } : {}),
      ...(query || (kind === 'open' && (names.length || label)) ? { query: query || names.join(' ') || label } : {}),
      ...(item.document ? { documentName: String(item.document).slice(0, 200) } : {}),
      source: 'brief'
    });
  }
  return needs;
}

/** Joins the names floor and the planner's needs; the planner's wording wins for the same entity. */
export function mergeNeeds(floor: Need[], brief: Need[]): Need[] {
  const covered = new Map<string, Need>();
  for (const need of brief) {
    if (need.kind !== 'entity' && need.kind !== 'rule') continue;
    for (const id of need.entityIds) covered.set(id, need);
    for (const id of need.skillIds ?? []) covered.set(`skill:${id}`, need);
  }
  const kept = floor.filter(need => {
    const target = need.entityIds[0] ?? (need.skillIds?.[0] ? `skill:${need.skillIds[0]}` : undefined);
    const other = target ? covered.get(target) : undefined;
    if (!other) return true;
    if (need.use === 'acts') other.use = 'acts';
    return false;
  });
  return [...kept, ...brief].map((need, index) => ({ ...need, id: `n${index + 1}` }));
}
