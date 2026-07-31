import { describe, expect, test } from 'vitest';
import { displayProposalValue } from '../../src/renderer/features/worldbuild/reviewDisplay';

describe('AI review display values', () => {
  test('shows the custom option label instead of its internal slug', () => {
    const definitions = [{ key: 'raridade', valueType: 'single-choice', options: [{ id: 'nico', label: '🔴 Único' }] }];
    expect(displayProposalValue('customFields.raridade', { value: 'nico' }, definitions, []))
      .toBe('🔴 Único');
  });

  test('shows entity names instead of stored reference ids', () => {
    const definitions = [{ key: 'owner', valueType: 'entity-reference' }];
    const entities = [{ id: 'entity-1', canonicalName: 'Nico' }];
    expect(displayProposalValue('customFields.owner', { value: 'entity-1' }, definitions, entities))
      .toBe('Nico');
  });
});
