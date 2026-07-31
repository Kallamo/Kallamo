function discardEnrichPending(currentData) {
  const pending = currentData?._enrichPending;
  if (!pending || typeof pending !== 'object') return null;
  const data = { ...currentData };
  delete data._enrichPending;
  return {
    data,
    fields: Object.keys(pending.data || {}).length,
    lore: pending.lore != null ? 1 : 0,
    links: Array.isArray(pending.links) ? pending.links.length : 0,
    chapters: Array.isArray(pending.chapters) ? pending.chapters.length : 0
  };
}

module.exports = { discardEnrichPending };
