function sameValue(left, right) {
  if (Object.is(left, right)) return true;
  if (left && right && typeof left === 'object' && typeof right === 'object') {
    return JSON.stringify(left) === JSON.stringify(right);
  }
  return false;
}

function sameMessage(previous, next) {
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
  for (const key of keys) {
    if (!sameValue(previous[key], next[key])) return false;
  }
  return true;
}

// Reloaded pages come back as new objects; keeping the old object for an unchanged
// message lets memoized rows skip rendering. Returns `previous` when nothing changed.
export function reconcileMessages(previous, next) {
  if (!Array.isArray(previous) || !previous.length) return next;
  const previousById = new Map(previous.map(message => [message.id, message]));
  let changed = previous.length !== next.length;
  const result = next.map((message, index) => {
    const existing = previousById.get(message.id);
    if (existing && sameMessage(existing, message)) {
      if (previous[index] !== existing) changed = true;
      return existing;
    }
    changed = true;
    return message;
  });
  return changed ? result : previous;
}
