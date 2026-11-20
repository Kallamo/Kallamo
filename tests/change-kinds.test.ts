import { describe, expect, test } from 'vitest';
import { describeTimeResourceChanges } from '../src/renderer/features/roleplay/changeKinds';

describe('resource changes from story time', () => {
  const names = new Map([['mara', 'Mara'], ['tomas', 'Tomas']]);
  const definitions = [{ id: 'battery', name: 'Battery' }, { id: 'stamina', name: 'Stamina' }];

  test('read as one line for the whole turn', () => {
    const line = describeTimeResourceChanges([
      { definitionId: 'battery', entityId: 'mara', previousValue: 31, nextValue: 30, delta: -1 },
      { definitionId: 'stamina', entityId: 'tomas', previousValue: 40, nextValue: 43, delta: 3 }
    ], names, definitions);

    expect(line).toBe('Battery −1 (Mara), Stamina +3 (Tomas)');
  });

  test('leave out what did not visibly move, and hide float noise from older records', () => {
    expect(describeTimeResourceChanges([
      { definitionId: 'battery', entityId: 'mara', previousValue: 31, nextValue: 31, delta: 0 },
      { definitionId: 'battery', entityId: 'tomas', previousValue: 31.28, nextValue: 31.13, delta: -0.15000000000000002 }
    ], names, definitions)).toBe('Battery −0.15 (Tomas)');
    expect(describeTimeResourceChanges([], names, definitions)).toBe('');
  });
});
