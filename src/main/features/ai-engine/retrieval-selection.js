function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function contentFingerprint(value) {
  return normalizeText(value).replace(/\bsource \S+\b/g, '').trim();
}

function deduplicateEntries(entries) {
  const seen = new Map();
  const selected = [];
  const excluded = [];
  for (const entry of entries) {
    const fingerprint = contentFingerprint(entry.content);
    const prior = fingerprint ? seen.get(fingerprint) : undefined;
    if (prior) {
      excluded.push({ entry, reason: 'semantic-duplicate', duplicateOf: prior.key });
      continue;
    }
    if (fingerprint) seen.set(fingerprint, entry);
    selected.push(entry);
  }
  return { selected, excluded };
}

function summarizeSelection(intent, discovered, selected, excluded) {
  const byReason = excluded.reduce((summary, item) => {
    summary[item.reason] = (summary[item.reason] || 0) + 1;
    return summary;
  }, {});
  return {
    intent,
    discovered: discovered.length,
    selected: selected.length,
    excluded: excluded.length,
    discoveredByKind: countBy(discovered, entry => entry.kind),
    selectedByKind: countBy(selected, entry => entry.kind),
    excludedByReason: byReason,
    selectedSources: selected.map(entry => ({ source: entry.source, kind: entry.kind })),
    excludedSources: excluded.map(item => ({
      source: item.entry.source,
      kind: item.entry.kind,
      reason: item.reason
    }))
  };
}

function countBy(values, getKey) {
  return values.reduce((summary, value) => {
    const key = getKey(value);
    summary[key] = (summary[key] || 0) + 1;
    return summary;
  }, {});
}

function selectRetrievedEntries(_query, entries) {
  const deduplicated = deduplicateEntries(entries);
  return {
    intent: 'general',
    selected: deduplicated.selected,
    excluded: deduplicated.excluded,
    funnel: summarizeSelection('general', entries, deduplicated.selected, deduplicated.excluded)
  };
}

module.exports = {
  selectRetrievedEntries
};
