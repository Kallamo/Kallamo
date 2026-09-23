import type Database from 'better-sqlite3';
import {
  locationSizeOf,
  locationSizeRank,
  normalizeLocationSize,
  type LocationSize
} from '../../../shared/location-sizes';

export interface LocationLink {
  fromId: string;
  toId: string;
  relType: string;
}

export interface LocationChainNode {
  id: string;
  name: string;
  size: LocationSize | null;
}

export type LocationSizes = Map<string, LocationSize | null>;
export type TravelCategory = 'micro' | 'local' | 'transit' | 'macro';

// A containment chain longer than this is a cycle or a data error, never a real world.
const CHAIN_LIMIT = 16;

interface Graph {
  parents: Map<string, string[]>;
  children: Map<string, string[]>;
  lateral: Map<string, string[]>;
}

function buildGraph(links: LocationLink[]): Graph {
  const parents = new Map<string, string[]>();
  const children = new Map<string, string[]>();
  const lateral = new Map<string, string[]>();
  const append = (map: Map<string, string[]>, key: string, value: string) => {
    const list = map.get(key);
    if (list) list.push(value); else map.set(key, [value]);
  };
  for (const link of links) {
    if (link.relType === 'inside') {
      append(parents, link.fromId, link.toId);
      append(children, link.toId, link.fromId);
    } else {
      append(lateral, link.fromId, link.toId);
      append(lateral, link.toId, link.fromId);
    }
  }
  return { parents, children, lateral };
}

/** The origin followed by each container it sits in, nearest first. */
function containerChain(originId: string, parents: Map<string, string[]>): string[] {
  const chain = [originId];
  const seen = new Set(chain);
  let current = originId;
  while (chain.length < CHAIN_LIMIT) {
    const parent = parents.get(current)?.[0];
    if (!parent || seen.has(parent)) break;
    chain.push(parent);
    seen.add(parent);
    current = parent;
  }
  return chain;
}

// Containment is directional, so treating it as an undirected graph and counting hops measures
// the wrong thing: a walk across town reads as far because it climbs to the shared district and
// back down, while a jump to another continent under the same root reads as near. Reachability
// is therefore anchored on the containers the origin sits in. Everything under those containers
// is walkable, everything outside them is a different branch of the world.
export function findReachableLocations(
  originId: string | null | undefined,
  links: LocationLink[],
  { maxDepth = 4, sizes }: { maxDepth?: number; sizes?: LocationSizes } = {}
): Set<string> {
  if (!originId) return new Set();
  const { parents, children, lateral } = buildGraph(links);
  const depth = sizes ? regionClimbDepth(originId, parents, sizes) ?? maxDepth : maxDepth;
  const anchors = new Set([originId]);
  let climbing = [originId];
  for (let level = 0; level < depth && climbing.length; level += 1) {
    const next: string[] = [];
    for (const id of climbing) {
      for (const parent of parents.get(id) ?? []) {
        if (anchors.has(parent)) continue;
        anchors.add(parent);
        next.push(parent);
      }
    }
    climbing = next;
  }
  const reachable = new Set(anchors);
  const descend = (startIds: string[]) => {
    let frontier = startIds.filter(id => {
      if (reachable.has(id)) return false;
      reachable.add(id);
      return true;
    });
    while (frontier.length) {
      const next: string[] = [];
      for (const id of frontier) {
        for (const child of children.get(id) ?? []) {
          if (reachable.has(child)) continue;
          reachable.add(child);
          next.push(child);
        }
      }
      frontier = next;
    }
  };
  // The outermost container is the world, not a region. Expanding it would make every place
  // reachable from every other and the guard would stop meaning anything.
  for (const anchor of [...anchors]) {
    if (!(parents.get(anchor) ?? []).length) continue;
    descend(children.get(anchor) ?? []);
  }
  // An explicit connection is an authored shortcut and outranks containment: a road, a portal
  // or a tunnel is exactly the case the hierarchy cannot express.
  for (const id of [...reachable]) descend(lateral.get(id) ?? []);
  // Climbing may have passed through the world itself. It is a container, never somewhere a
  // scene can be set, so it stays out unless the scene already sits there.
  for (const id of [...reachable]) {
    if (id !== originId && !(parents.get(id) ?? []).length && (children.get(id) ?? []).length) reachable.delete(id);
  }
  return reachable;
}

// With sizes known, "local" means the region around the scene whatever the nesting depth:
// a room six levels down and a city one level down reach the same enclosing region.
function regionClimbDepth(originId: string, parents: Map<string, string[]>, sizes: LocationSizes): number | null {
  const chain = containerChain(originId, parents);
  const index = chain.findIndex((id, position) => position > 0 && sizes.get(id) === 'region');
  return index > 0 ? index : null;
}

/**
 * Which Time Cost Matrix band the shortest honest version of a move falls in. A direct link
 * decides first; otherwise the smallest container both ends share says how far apart they are.
 * Returns null when there is no move.
 */
export function travelCategory(
  startId: string | null | undefined,
  endId: string | null | undefined,
  links: LocationLink[],
  sizes: LocationSizes = new Map()
): TravelCategory | null {
  if (!startId || !endId || startId === endId) return null;
  const direct = links.find(link =>
    (link.fromId === startId && link.toId === endId) || (link.fromId === endId && link.toId === startId));
  if (direct) return direct.relType === 'inside' ? 'micro' : 'local';

  const { parents } = buildGraph(links);
  const startChain = containerChain(startId, parents);
  const endChain = containerChain(endId, parents);
  const endSet = new Set(endChain);
  const shared = startChain.find(id => endSet.has(id));
  if (!shared) return 'transit';

  const sharedSize = sizes.get(shared) ?? null;
  if (sharedSize === 'place' || sharedSize === 'spot') return 'micro';
  const nearestArea = (chain: string[]) => chain.slice(0, chain.indexOf(shared) + 1).find(id => sizes.get(id) === 'area');
  if (sharedSize === 'area') return nearestArea(startChain) === nearestArea(endChain) ? 'local' : 'transit';
  if (sharedSize === 'region') {
    const startArea = nearestArea(startChain);
    const endArea = nearestArea(endChain);
    return startArea && endArea && startArea !== endArea ? 'macro' : 'transit';
  }
  return 'transit';
}

/**
 * Where a place the story just introduced most likely sits, given the scene's location chain.
 * The first container strictly larger than the new place wins, so a back room lands in the
 * tavern while a new city lands in the region rather than inside the tavern.
 */
export function proposeLocationParent(size: unknown, chain: Array<Pick<LocationChainNode, 'id' | 'size'>>): string | null {
  if (!chain.length) return null;
  const known = normalizeLocationSize(size);
  if (!known) return chain[0].id;
  const rank = locationSizeRank(known);
  for (const node of chain) {
    if (locationSizeRank(node.size) > rank) return node.id;
    // An unsized scene location still holds a spot: a room inside the scene's place is inside it.
    if (!node.size && known === 'spot') return node.id;
  }
  return null;
}

/** The scene location and every confirmed container above it, nearest first. */
export function loadLocationChain(db: Database.Database, workspaceId: string, locationId: string | null | undefined): LocationChainNode[] {
  if (!locationId) return [];
  const rows = db.prepare(`
    WITH RECURSIVE chain(id, depth) AS (
      SELECT ?, 0
      UNION ALL
      SELECT (
        SELECT links.toId FROM entity_links AS links
        WHERE links.workspaceId = ? AND links.fromId = chain.id AND links.relType = 'inside'
        ORDER BY links.createdAt DESC LIMIT 1
      ), chain.depth + 1
      FROM chain WHERE chain.id IS NOT NULL AND chain.depth < ?
    )
    SELECT chain.id AS id, chain.depth AS depth, entities.canonicalName AS name, entities.data AS data
    FROM chain
    JOIN entities ON entities.id = chain.id AND entities.workspaceId = ?
    WHERE entities.type = 'Locations' AND entities.status != 'proposed'
    ORDER BY chain.depth
  `).all(locationId, workspaceId, CHAIN_LIMIT - 1, workspaceId) as Array<{ id: string; depth: number; name: string; data: string | null }>;
  const nodes: LocationChainNode[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    // A missing or proposed container ends the chain; a repeat means the links form a loop.
    if (row.depth !== nodes.length || seen.has(row.id)) break;
    seen.add(row.id);
    nodes.push({ id: row.id, name: row.name, size: locationSizeOf({ data: row.data }) });
  }
  return nodes;
}

/** Size of every location in a list of entity rows, for the graph functions above. */
export function locationSizesOf(entities: Array<{ id: string; type: string; data?: unknown }>): LocationSizes {
  const sizes: LocationSizes = new Map();
  for (const entity of entities) {
    if (entity.type === 'Locations') sizes.set(entity.id, locationSizeOf(entity));
  }
  return sizes;
}

/** "Taverna (place), within Porto Velho (area)": the scene's place said with its surroundings. */
export function describeLocationChain(chain: LocationChainNode[]): string {
  return chain
    .map((node, index) => `${index ? 'within ' : ''}${node.name}${node.size ? ` (${node.size})` : ''}`)
    .join(', ');
}
