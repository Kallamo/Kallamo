// Archive chunks share a generic source name, so only their text can match a citation.
const GENERIC_SOURCES = new Set(['summarized history', 'chat archive']);
const MIN_CITATION_CHARS = 3;
const HANDLE_PATTERN = /^r\d+$/i;

// Splits a finish block's sources attribute into names and result handles (R3).
function parseCitations(sourcesAttr) {
  const names = [];
  const handles = new Set();
  for (const raw of String(sourcesAttr || '').split(',')) {
    const value = raw.trim().replace(/^\[|\]$/g, '').split('·')[0].trim().toLowerCase();
    if (!value) continue;
    if (HANDLE_PATTERN.test(value)) handles.add(value.toUpperCase());
    else names.push(value);
  }
  return { names, handles };
}

function isCitedChunk(chunk, { names = [], ids = new Set() } = {}) {
  if (chunk?.id && ids.has(chunk.id)) return true;
  const source = String(chunk?.source || '').toLowerCase();
  const text = String(chunk?.text || '').toLowerCase();
  const generic = !source || GENERIC_SOURCES.has(source);
  const docName = (text.match(/^document:\s*([^\n]+)/) || [])[1]?.trim() || '';
  const memTitle = (text.match(/^memory context\s*\[([^\]]+)\]/) || [])[1]?.trim() || '';
  const firstLine = text.split('\n')[0] || '';

  return names.some(name => {
    if (!generic && (source.includes(name) || name.includes(source))) return true;
    for (const title of [docName, docName.replace(/_/g, ' '), memTitle]) {
      if (title && !GENERIC_SOURCES.has(title) && (title.includes(name) || name.includes(title))) return true;
    }
    if (firstLine.includes(name)) return true;
    return generic && name.length >= MIN_CITATION_CHARS && text.includes(name);
  });
}

module.exports = { parseCitations, isCitedChunk };
