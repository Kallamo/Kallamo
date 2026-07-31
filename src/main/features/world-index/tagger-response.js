function extractJsonValue(text) {
  const raw = String(text || '').trim();
  if (!raw) return null;

  const candidates = [raw];
  const fenceStart = raw.indexOf('```');
  if (fenceStart !== -1) {
    const firstLineEnd = raw.indexOf('\n', fenceStart);
    const fenceEnd = raw.lastIndexOf('```');
    if (firstLineEnd !== -1 && fenceEnd > firstLineEnd) {
      candidates.push(raw.slice(firstLineEnd + 1, fenceEnd).trim());
    }
  }

  const objectStart = raw.indexOf('{');
  const objectEnd = raw.lastIndexOf('}');
  if (objectStart !== -1 && objectEnd > objectStart) candidates.push(raw.slice(objectStart, objectEnd + 1));

  const arrayStart = raw.indexOf('[');
  const arrayEnd = raw.lastIndexOf(']');
  if (arrayStart !== -1 && arrayEnd > arrayStart) candidates.push(raw.slice(arrayStart, arrayEnd + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      // Continue with the next tolerant extraction.
    }
  }
  return null;
}

function parseTaggerResponse(response) {
  const parsed = extractJsonValue(response);
  if (Array.isArray(parsed)) return { valid: true, items: parsed };
  if (parsed && typeof parsed === 'object' && Array.isArray(parsed.items)) {
    return { valid: true, items: parsed.items };
  }
  return { valid: false, items: [] };
}

function createTaggerBatches(records, { maxChunks = 3, maxChars = 7000 } = {}) {
  const batches = [];
  let batch = [];
  let chars = 0;

  for (const record of (Array.isArray(records) ? records : [])) {
    const recordChars = String(record?.text || '').length;
    if (batch.length && (batch.length >= maxChunks || chars + recordChars > maxChars)) {
      batches.push(batch);
      batch = [];
      chars = 0;
    }
    batch.push(record);
    chars += recordChars;
  }

  if (batch.length) batches.push(batch);
  return batches;
}

function proposalDataForMention(type, proposalKind) {
  if (proposalKind === 'named') {
    return type === 'Items' ? { itemNature: 'unique' } : {};
  }
  if (proposalKind === 'world_specific_type' && type === 'Items') {
    return { itemNature: 'type' };
  }
  return null;
}

const TAGGER_RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          chunk: { type: 'number' },
          mentions: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string' },
                canonicalName: { type: 'string' },
                type: { type: 'string' },
                proposalKind: { type: 'string', enum: ['known', 'named', 'world_specific_type'] },
                evidence: { type: 'string' }
              },
              required: ['text', 'canonicalName', 'type', 'proposalKind', 'evidence'],
              additionalProperties: false
            }
          }
        },
        required: ['chunk', 'mentions'],
        additionalProperties: false
      }
    }
  },
  required: ['items'],
  additionalProperties: false
};

module.exports = {
  TAGGER_RESPONSE_SCHEMA,
  extractJsonValue,
  parseTaggerResponse,
  createTaggerBatches,
  proposalDataForMention
};
