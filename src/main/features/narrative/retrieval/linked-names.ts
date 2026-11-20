import type { WorldbuildView } from './entity-tiers';

const DEFAULT_LIMIT = 30;
// What a turn describes without naming is most often something someone holds or someone they know.
const TYPE_ORDER: Record<string, number> = { Items: 0, Characters: 1, Creatures: 1, Factions: 2, System: 3, Locations: 3, Events: 4 };
const PER_NAMED = 12;
const PER_PRESENT = 5;

function relationWords(relType: string): string {
  return relType.replace(/_/g, ' ');
}

/**
 * Entities one Worldbuild link from what the turn names and who is here, as planner labels such as
 * "Twin Daggers (Items, owned by Mara)". The turn's names come first; items and people before places.
 */
export function linkedNames(view: WorldbuildView, input: { mentionedIds: string[]; sceneIds: string[]; limit?: number }): string[] {
  const limit = input.limit ?? DEFAULT_LIMIT;
  const known = new Set([...input.mentionedIds, ...input.sceneIds]);
  const labels: string[] = [];
  const listed = new Set<string>();
  const sources = [
    ...[...new Set(input.mentionedIds)].map(id => ({ id, room: PER_NAMED })),
    ...[...new Set(input.sceneIds)].filter(id => !input.mentionedIds.includes(id)).map(id => ({ id, room: PER_PRESENT }))
  ];
  for (const source of sources) {
    const sourceName = view.nameOf(source.id);
    if (!sourceName) continue;
    const candidates = view.links(source.id)
      .map(link => ({ link, other: view.entity(link.otherId) }))
      .filter((item): item is { link: typeof item.link; other: NonNullable<typeof item.other> } => Boolean(item.other) && item.other!.type in TYPE_ORDER)
      .filter(item => !known.has(item.link.otherId) && !listed.has(item.link.otherId))
      .sort((left, right) => TYPE_ORDER[left.other.type] - TYPE_ORDER[right.other.type]);
    for (const { link, other } of candidates.slice(0, source.room)) {
      if (labels.length >= limit) return labels;
      if (listed.has(other.id)) continue;
      listed.add(other.id);
      // A link pointing at the source reads from the other's side: the daggers are owned by Mara.
      const relation = link.direction === 'to' ? `${relationWords(link.relType)} ${sourceName}` : `linked to ${sourceName}`;
      labels.push(`${other.canonicalName} (${other.type}, ${relation})`);
    }
  }
  return labels;
}
