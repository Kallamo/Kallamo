import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { discardEnrichPending } = require('../../src/main/features/worldbuild/entity-review');

describe('entity review rejection', () => {
  test('removes only staged review data and preserves canonical fields', () => {
    const current = {
      status: 'alive',
      appearance: 'Scarred',
      _enrichPending: {
        data: { status: { value: 'missing' } },
        lore: { value: 'Replacement lore' },
        links: [{ relKey: 'relationships', targetId: 'other' }]
      }
    };

    expect(discardEnrichPending(current)).toEqual({
      data: { status: 'alive', appearance: 'Scarred' },
      fields: 1,
      lore: 1,
      links: 1,
      chapters: 0
    });
    expect(current._enrichPending).toBeDefined();
  });
});
