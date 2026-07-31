import { describe, expect, it } from 'vitest';

const { createTaggerBatches, parseTaggerResponse, proposalDataForMention } = require('../../src/main/features/world-index/tagger-response');

describe('Tagger structured response parser', () => {
  it('accepts the current object contract', () => {
    const result = parseTaggerResponse(JSON.stringify({
      items: [{ chunk: 0, mentions: [{ canonicalName: 'Arden Vale', type: 'Characters', evidence: 'Arden Vale' }] }],
    }));

    expect(result.valid).toBe(true);
    expect(result.items).toHaveLength(1);
  });

  it('accepts a legacy top-level array during migration', () => {
    const result = parseTaggerResponse('[{"chunk":0,"mentions":[]}]');

    expect(result.valid).toBe(true);
    expect(result.items).toHaveLength(1);
  });

  it('extracts JSON from a markdown fence', () => {
    const result = parseTaggerResponse('```json\n{"items":[]}\n```');

    expect(result).toEqual({ valid: true, items: [] });
  });

  it('distinguishes invalid output from a valid empty result', () => {
    expect(parseTaggerResponse('No entities found.')).toEqual({ valid: false, items: [] });
    expect(parseTaggerResponse('{"items":[]}')).toEqual({ valid: true, items: [] });
  });
});

describe('Tagger batch sizing', () => {
  it('keeps imported Writing Desk batches within the character budget', () => {
    const records = Array.from({ length: 12 }, (_, index) => ({ id: String(index), text: 'x'.repeat(2300) }));
    const batches = createTaggerBatches(records);

    expect(batches).toHaveLength(4);
    expect(batches.every((batch: Array<{ text: string }>) => batch.length <= 3)).toBe(true);
    expect(batches.every((batch: Array<{ text: string }>) => batch.reduce((sum, item) => sum + item.text.length, 0) <= 7000)).toBe(true);
  });

  it('keeps one oversized chunk intact instead of dropping it', () => {
    const batches = createTaggerBatches([{ id: 'large', text: 'x'.repeat(8000) }]);

    expect(batches).toHaveLength(1);
    expect(batches[0][0].id).toBe('large');
  });
});

describe('Tagger proposal eligibility', () => {
  it('allows named entities and marks named items as unique', () => {
    expect(proposalDataForMention('Characters', 'named')).toEqual({});
    expect(proposalDataForMention('Items', 'named')).toEqual({ itemNature: 'unique' });
  });

  it('allows distinctive reusable item types', () => {
    expect(proposalDataForMention('Items', 'world_specific_type')).toEqual({ itemNature: 'type' });
  });

  it('blocks generic, known, missing, and non-item type proposals', () => {
    expect(proposalDataForMention('Items', 'generic')).toBeNull();
    expect(proposalDataForMention('Characters', 'known')).toBeNull();
    expect(proposalDataForMention('Factions', '')).toBeNull();
    expect(proposalDataForMention('Characters', 'world_specific_type')).toBeNull();
  });
});
