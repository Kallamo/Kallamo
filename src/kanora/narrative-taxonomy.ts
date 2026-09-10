/**
 * The vocabulary a durable record has to name itself with.
 *
 * A blocklist of predicate names cannot hold: the interpreter renames the predicate and the
 * same transcript of a scene walks straight through. A closed list of categories inverts
 * that. Every record has to declare what kind of thing it is, the list is enforced by the
 * response schema, and the transient categories exist on purpose so momentary detail has a
 * legal place to be classified into and can then be dropped by name instead of by guesswork.
 */

export const DURABLE_KNOWLEDGE_CATEGORIES = [
  'world-lore',
  'identity',
  'history',
  'secret',
  'capability',
  'intent',
  'bond'
] as const;

export const TRANSIENT_KNOWLEDGE_CATEGORIES = ['scene-state', 'small-talk'] as const;

export const DURABLE_MEMORY_CATEGORIES = [
  'formative',
  'bond',
  'loss',
  'trauma',
  'triumph',
  'oath',
  'revelation'
] as const;

export const TRANSIENT_MEMORY_CATEGORIES = ['routine'] as const;

export const DURABLE_RELATIONSHIP_CAUSES = [
  'betrayal',
  'sacrifice',
  'rescue',
  'revelation',
  'oath',
  'cruelty',
  'humiliation',
  'forgiveness',
  'shared-loss',
  'sustained-trust',
  'material-debt',
  'first-impression',
  // Closeness is a cause of its own. Without these a campaign whose plot is a relationship
  // has no honest way to name what moved, and the gate freezes the very bar the story is about.
  'confidence-shared',
  'affection',
  'rejection',
  'reliance'
] as const;

export const TRANSIENT_RELATIONSHIP_CAUSES = [
  'courtesy',
  'banter',
  'routine-cooperation',
  'mood',
  'compliance',
  'instruction',
  'presence'
] as const;

export type DurableKnowledgeCategory = typeof DURABLE_KNOWLEDGE_CATEGORIES[number];
export type TransientKnowledgeCategory = typeof TRANSIENT_KNOWLEDGE_CATEGORIES[number];
export type KnowledgeCategory = DurableKnowledgeCategory | TransientKnowledgeCategory;

export type DurableMemoryCategory = typeof DURABLE_MEMORY_CATEGORIES[number];
export type TransientMemoryCategory = typeof TRANSIENT_MEMORY_CATEGORIES[number];
export type MemoryCategory = DurableMemoryCategory | TransientMemoryCategory;

export type DurableRelationshipCause = typeof DURABLE_RELATIONSHIP_CAUSES[number];
export type TransientRelationshipCause = typeof TRANSIENT_RELATIONSHIP_CAUSES[number];
export type RelationshipCause = DurableRelationshipCause | TransientRelationshipCause;

export const KNOWLEDGE_CATEGORIES: readonly KnowledgeCategory[] = [
  ...DURABLE_KNOWLEDGE_CATEGORIES,
  ...TRANSIENT_KNOWLEDGE_CATEGORIES
];
export const MEMORY_CATEGORIES: readonly MemoryCategory[] = [
  ...DURABLE_MEMORY_CATEGORIES,
  ...TRANSIENT_MEMORY_CATEGORIES
];
export const RELATIONSHIP_CAUSES: readonly RelationshipCause[] = [
  ...DURABLE_RELATIONSHIP_CAUSES,
  ...TRANSIENT_RELATIONSHIP_CAUSES
];

const KNOWLEDGE_SET = new Set<string>(KNOWLEDGE_CATEGORIES);
const DURABLE_KNOWLEDGE_SET = new Set<string>(DURABLE_KNOWLEDGE_CATEGORIES);
const MEMORY_SET = new Set<string>(MEMORY_CATEGORIES);
const DURABLE_MEMORY_SET = new Set<string>(DURABLE_MEMORY_CATEGORIES);
const CAUSE_SET = new Set<string>(RELATIONSHIP_CAUSES);
const DURABLE_CAUSE_SET = new Set<string>(DURABLE_RELATIONSHIP_CAUSES);

/**
 * Only these describe a subject to itself in a way worth storing. A character keeping their
 * own secret, their own true identity, or their own plan is real perspective. "What Alistair
 * knows about Alistair", written in the third person, is a world fact wearing a knowledge
 * record and belongs in the canon layer instead.
 */
const SELF_REFERENTIAL_CATEGORIES = new Set<string>(['secret', 'identity', 'intent']);

function slug(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, '-');
}

export function normalizeKnowledgeCategory(value: unknown): KnowledgeCategory | undefined {
  const candidate = slug(value);
  return KNOWLEDGE_SET.has(candidate) ? candidate as KnowledgeCategory : undefined;
}

export function normalizeMemoryCategory(value: unknown): MemoryCategory | undefined {
  const candidate = slug(value);
  return MEMORY_SET.has(candidate) ? candidate as MemoryCategory : undefined;
}

export function normalizeRelationshipCause(value: unknown): RelationshipCause | undefined {
  const candidate = slug(value);
  return CAUSE_SET.has(candidate) ? candidate as RelationshipCause : undefined;
}

export function isDurableKnowledgeCategory(value: unknown): boolean {
  return DURABLE_KNOWLEDGE_SET.has(slug(value));
}

export function isDurableMemoryCategory(value: unknown): boolean {
  return DURABLE_MEMORY_SET.has(slug(value));
}

export function isDurableRelationshipCause(value: unknown): boolean {
  return DURABLE_CAUSE_SET.has(slug(value));
}

export function allowsSelfReference(category: unknown): boolean {
  return SELF_REFERENTIAL_CATEGORIES.has(slug(category));
}

/**
 * A second belt behind the category gate. A category can be misdeclared; these predicate
 * names describe a moment the scene already carries and never a durable statement, so a
 * record wearing one is dropped whatever it calls itself.
 */
const SCENE_STATE_PREDICATES = new Set([
  'current-location', 'current-position', 'current-place', 'current-activity',
  'current-action', 'current-scene', 'current-state', 'current-mood', 'current-emotion',
  'location', 'position', 'activity', 'whereabouts', 'present-at', 'presence',
  'located-at', 'is-at', 'emotional-state', 'emotional-state-reported', 'mood',
  'posture', 'stance', 'holding', 'wearing', 'doing'
]);

export function normalizePredicate(predicate: unknown): string {
  return slug(predicate);
}

export function isSceneStatePredicate(predicate: unknown): boolean {
  return SCENE_STATE_PREDICATES.has(slug(predicate));
}

const IDENTIFIER_PATTERNS = [
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i,
  /^[0-9a-f]{24,}$/i,
  /^[a-z][a-z0-9]*_[a-z0-9]{6,}$/i
];

/**
 * A record whose content is an opaque key teaches the model nothing and reads as a run of
 * characters in the prompt. The pipeline resolves entity references by name where it can, so
 * anything still shaped like a raw key at this point is extraction debris.
 */
export function looksLikeIdentifier(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const candidate = value.trim();
  if (!candidate || candidate.includes(' ')) return false;
  return IDENTIFIER_PATTERNS.some(pattern => pattern.test(candidate));
}

/**
 * What two stored statements have to share to count as the same statement. Predicates drift
 * between turns while the sentence stays identical, so the sentence is the key and the
 * predicate is not part of it.
 */
export function statementKey(value: unknown): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return text
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/**
 * Predicates that carry no meaning of their own. With one of these the object has to be the
 * whole statement, so a lone word under it is an empty record; under a specific predicate the
 * same word is a value, which is why "gate-code: Dawnfall" is a complete claim.
 */
const GENERIC_PREDICATES = new Set([
  'worldbuild-statement', 'statement', 'note', 'fact', 'info', 'information',
  'detail', 'description', 'summary', 'text', 'content', 'value'
]);

export function isGenericPredicate(predicate: unknown): boolean {
  return GENERIC_PREDICATES.has(slug(predicate));
}

/** Below this a string is a value, not a sentence. */
const PROSE_WORD_THRESHOLD = 3;

export function isProseStatement(value: unknown): boolean {
  return typeof value === 'string'
    && value.trim().split(/\s+/).filter(Boolean).length >= PROSE_WORD_THRESHOLD;
}

/**
 * What makes two propositions the same claim.
 *
 * A statement written as prose is identified by its sentence alone: the interpreter renames
 * the predicate between turns while the sentence stays word for word, and keying on the
 * predicate let the same observation be stored once per wording. A structured value is the
 * opposite case, because there the predicate carries the claim and the object is only its
 * value, so "has-hidden-route: true" and "is-hostile: true" must stay apart.
 */
export function propositionIdentity(subjectId: unknown, predicate: unknown, object: unknown): string {
  const about = String(subjectId ?? '');
  const content = statementKey(object);
  return isProseStatement(object)
    ? `${about}\u0000${content}`
    : `${about}\u0000${normalizePredicate(predicate)}\u0000${content}`;
}

export const KNOWLEDGE_CATEGORY_LABELS: Record<KnowledgeCategory, string> = {
  'world-lore': 'World lore',
  identity: 'Identity',
  history: 'History',
  secret: 'Secret',
  capability: 'Capability',
  intent: 'Intent',
  bond: 'Bond',
  'scene-state': 'Scene state',
  'small-talk': 'Small talk'
};

export const MEMORY_CATEGORY_LABELS: Record<MemoryCategory, string> = {
  formative: 'Formative',
  bond: 'Bond',
  loss: 'Loss',
  trauma: 'Trauma',
  triumph: 'Triumph',
  oath: 'Oath',
  revelation: 'Revelation',
  routine: 'Routine'
};

export const RELATIONSHIP_CAUSE_LABELS: Record<RelationshipCause, string> = {
  betrayal: 'Betrayal',
  sacrifice: 'Sacrifice',
  rescue: 'Rescue',
  revelation: 'Revelation',
  oath: 'Oath',
  cruelty: 'Cruelty',
  humiliation: 'Humiliation',
  forgiveness: 'Forgiveness',
  'shared-loss': 'Shared loss',
  'sustained-trust': 'Sustained trust',
  'material-debt': 'Material debt',
  'first-impression': 'First impression',
  'confidence-shared': 'Confidence shared',
  affection: 'Affection',
  rejection: 'Rejection',
  reliance: 'Reliance',
  courtesy: 'Courtesy',
  banter: 'Banter',
  'routine-cooperation': 'Routine cooperation',
  mood: 'Mood',
  compliance: 'Compliance',
  instruction: 'Instruction',
  presence: 'Presence'
};
