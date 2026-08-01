import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';

const { TAGGER_RESPONSE_SCHEMA, createTaggerBatches, parseTaggerResponse, proposalDataForMention } = require('../../src/main/features/world-index/tagger-response');

describe('Tagger structured response parser', () => {
  it('accepts complete mentions and rejects incomplete provider output', () => {
    const validate = new Ajv({ strict: false }).compile(TAGGER_RESPONSE_SCHEMA);
    const mention = {
      text: 'Arden',
      canonicalName: 'Arden Vale',
      type: 'Characters',
      proposalKind: 'named',
      evidence: 'Arden entered the hall.'
    };

    expect(validate({ items: [{ chunk: 0, mentions: [mention] }] })).toBe(true);
    expect(validate({ items: [{ chunk: 0, mentions: [{ ...mention, proposalKind: undefined }] }] })).toBe(false);
  });

  it('accepts the current object contract', () => {
    const result = parseTaggerResponse(JSON.stringify({
      items: [{
        chunk: 0,
        mentions: [{
          text: 'Arden',
          canonicalName: 'Arden Vale',
          type: 'Characters',
          proposalKind: 'named',
          evidence: 'Arden Vale'
        }]
      }]
    }));
    expect(result.valid).toBe(true);
    expect(result.items).toHaveLength(1);
  });

  it('accepts a legacy top-level array and fenced JSON', () => {
    expect(parseTaggerResponse('[{"chunk":0,"mentions":[]}]').valid).toBe(true);
    expect(parseTaggerResponse('```json\n{"items":[]}\n```')).toEqual({ valid: true, items: [] });
  });

  it('distinguishes invalid output from a valid empty result', () => {
    expect(parseTaggerResponse('No entities found.')).toEqual({ valid: false, items: [] });
    expect(parseTaggerResponse('{"items":[]}')).toEqual({ valid: true, items: [] });
  });
});

describe('Tagger batch sizing', () => {
  it('keeps batches within the character budget', () => {
    const records = Array.from({ length: 12 }, (_, index) => ({ id: String(index), text: 'x'.repeat(2300) }));
    const batches = createTaggerBatches(records);
    expect(batches).toHaveLength(4);
    expect(batches.every((batch: Array<{ text: string }>) => batch.length <= 3)).toBe(true);
    expect(batches.every((batch: Array<{ text: string }>) => batch.reduce((sum, item) => sum + item.text.length, 0) <= 7000)).toBe(true);
  });

  it('keeps one oversized chunk intact', () => {
    const batches = createTaggerBatches([{ id: 'large', text: 'x'.repeat(8000) }]);
    expect(batches[0][0].id).toBe('large');
  });
});

describe('Tagger proposal eligibility', () => {
  it('allows named entities and distinctive item types', () => {
    expect(proposalDataForMention('Characters', 'named')).toEqual({});
    expect(proposalDataForMention('Items', 'named')).toEqual({ itemNature: 'unique' });
    expect(proposalDataForMention('Items', 'world_specific_type')).toEqual({ itemNature: 'type' });
  });

  it('blocks unsupported proposal kinds', () => {
    expect(proposalDataForMention('Items', 'generic')).toBeNull();
    expect(proposalDataForMention('Characters', 'known')).toBeNull();
    expect(proposalDataForMention('Characters', 'world_specific_type')).toBeNull();
  });
});
