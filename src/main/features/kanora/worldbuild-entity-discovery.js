const BREADTH_DEPTH = Object.freeze({
  focused: 0,
  balanced: 1,
  broad: 2
});

function discoverEntityIds(seedIds, breadth, limit, loadNeighbors) {
  const maximum = Math.max(0, Math.floor(Number(limit) || 0));
  if (!maximum) return [];

  const selected = new Set(seedIds.filter(Boolean));
  const maxDepth = BREADTH_DEPTH[breadth] ?? BREADTH_DEPTH.balanced;
  let frontier = [...selected];

  for (let depth = 0; depth < maxDepth && frontier.length && selected.size < maximum; depth += 1) {
    const edges = loadNeighbors(frontier, Math.max(maximum * 4, 20));
    const next = [];
    for (const edge of edges) {
      for (const id of [edge.fromId, edge.toId]) {
        if (!id || selected.has(id)) continue;
        selected.add(id);
        next.push(id);
        if (selected.size >= maximum) break;
      }
      if (selected.size >= maximum) break;
    }
    frontier = next;
  }

  return [...selected].slice(0, maximum);
}

module.exports = {
  BREADTH_DEPTH,
  discoverEntityIds
};
