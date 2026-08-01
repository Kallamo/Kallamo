function extractObjectText(response) {
  const raw = String(response || '');
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  return start >= 0 && end >= start ? raw.slice(start, end + 1) : '';
}

function parseObject(text) {
  try {
    const value = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
}

function repairJsonSyntax(text) {
  return text
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/,\s*([}\]])/g, '$1')
    .replace(/(["}\]])\s+(?=["{\[])/g, '$1,')
    .replace(/(["}\]])(?=["{\[])/g, '$1,');
}

function parseEntityUpdateObject(response) {
  const objectText = extractObjectText(response);
  if (!objectText) return { value: null, repaired: false };
  const value = parseObject(objectText);
  if (value) return { value, repaired: false };
  return { value: parseObject(repairJsonSyntax(objectText)), repaired: true };
}

module.exports = { parseEntityUpdateObject, repairJsonSyntax };
