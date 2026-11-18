// What the Narrative State may add to Worldbuild on its own, per kind of thing. Review adds it at
// once as a provisional entity the story can refer to, and waits for approval before confirming it.

export type CreationMode = 'off' | 'review' | 'auto';

export type CreationKind =
  | 'characters' | 'races'
  | 'creatures' | 'species'
  | 'named' | 'ordinary'
  | 'spots' | 'places' | 'areas' | 'regions';

export type EntityCreationPolicy = Record<CreationKind, CreationMode>;

export const DEFAULT_ENTITY_CREATION_POLICY: Readonly<EntityCreationPolicy> = Object.freeze({
  characters: 'auto',
  races: 'off',
  creatures: 'auto',
  species: 'review',
  named: 'auto',
  ordinary: 'off',
  spots: 'auto',
  places: 'auto',
  areas: 'review',
  regions: 'review'
});

export const CREATION_KINDS = Object.keys(DEFAULT_ENTITY_CREATION_POLICY) as CreationKind[];

const MODES = new Set<string>(['off', 'review', 'auto']);

export function normalizeEntityCreationPolicy(value: unknown): EntityCreationPolicy {
  let source: Record<string, unknown> = {};
  if (typeof value === 'string') {
    try { source = JSON.parse(value) ?? {}; } catch { source = {}; }
  } else if (value && typeof value === 'object') {
    source = value as Record<string, unknown>;
  }
  return Object.fromEntries(CREATION_KINDS.map(kind => [
    kind,
    MODES.has(String(source[kind])) ? source[kind] : DEFAULT_ENTITY_CREATION_POLICY[kind]
  ])) as EntityCreationPolicy;
}

export interface CreationSubject {
  type: string;
  scope?: 'individual' | 'group';
  itemNature?: 'unique' | 'type';
  size?: string | null;
}

/** The policy row a proposed entity falls under; a Location without a size is treated as a place. */
export function creationKindOf(subject: CreationSubject): CreationKind | null {
  switch (subject.type) {
    case 'Characters': return 'characters';
    case 'Races': return 'races';
    case 'Creatures': return subject.scope === 'group' ? 'species' : 'creatures';
    case 'Items': return subject.itemNature === 'type' ? 'ordinary' : 'named';
    case 'Locations':
      if (subject.size === 'spot') return 'spots';
      if (subject.size === 'area') return 'areas';
      if (subject.size === 'region') return 'regions';
      return 'places';
    default: return null;
  }
}
