function parseItems(value) {
  if (Array.isArray(value)) return value;
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isAvailableToProfile(item, profileId) {
  if (!item || item.enabled === false) return false;
  const profileIds = parseItems(item.profiles);
  return profileIds.length === 0 || profileIds.includes(profileId);
}

function isSearchable(item) {
  return item?.strategy !== 'constant' && item?.strategy !== 'full_context';
}

function filterWorkspaceKnowledgeResults(results, knowledgeFiles, profileId) {
  const allowedSources = new Set(
    parseItems(knowledgeFiles)
      .filter(item => isAvailableToProfile(item, profileId) && isSearchable(item))
      .map(item => String(item.name || '').toLowerCase())
      .filter(Boolean)
  );
  return (results || []).filter(result => allowedSources.has(String(result.source || '').toLowerCase()));
}

function filterWorkspaceMemoryResults(results, memoryBlocks, profileId) {
  const blocks = parseItems(memoryBlocks);
  const allowedBlocks = blocks.filter(
    block => isAvailableToProfile(block, profileId) && isSearchable(block)
  );
  const allowedIds = new Set(allowedBlocks.map(block => block.id).filter(Boolean));
  const allowedTitles = new Set(
    allowedBlocks.map(block => String(block.title || '').toLowerCase()).filter(Boolean)
  );

  return (results || []).filter(result => {
    const blockId = result.memoryBlockId || result.blockId;
    if (blockId) return allowedIds.has(blockId);
    const source = String(result.source || '').toLowerCase();
    return allowedTitles.has(source);
  });
}

module.exports = {
  filterWorkspaceKnowledgeResults,
  filterWorkspaceMemoryResults,
  isAvailableToProfile,
  isSearchable,
  parseItems
};
