export function buildLocationTree(entities, insideLinks) {
  const locations = entities.filter((entity) => entity.type === 'Locations');
  const locationIds = new Set(locations.map((entity) => entity.id));
  const parentByChild = new Map();

  for (const link of insideLinks) {
    if (locationIds.has(link.fromId) && locationIds.has(link.toId) && !parentByChild.has(link.fromId)) {
      parentByChild.set(link.fromId, link.toId);
    }
  }

  const childrenByParent = new Map();
  for (const location of locations) {
    const parentId = parentByChild.get(location.id);
    if (!parentId) continue;
    const children = childrenByParent.get(parentId) || [];
    children.push(location);
    childrenByParent.set(parentId, children);
  }

  const sort = (list) => list.sort((a, b) => a.canonicalName.localeCompare(b.canonicalName));
  for (const children of childrenByParent.values()) sort(children);

  const included = new Set();
  const makeNode = (location, ancestors = new Set()) => {
    included.add(location.id);
    if (ancestors.has(location.id)) return { entity: location, children: [] };
    const nextAncestors = new Set(ancestors);
    nextAncestors.add(location.id);
    return { entity: location, children: (childrenByParent.get(location.id) || []).map((child) => makeNode(child, nextAncestors)) };
  };

  const roots = sort(locations.filter((location) => !parentByChild.has(location.id))).map((location) => makeNode(location));
  for (const location of sort(locations)) {
    if (!included.has(location.id)) roots.push(makeNode(location));
  }
  return roots;
}
