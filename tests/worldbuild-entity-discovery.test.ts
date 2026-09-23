import { describe, expect, it, vi } from 'vitest';

const { discoverEntityIds } = require('../src/main/features/narrative/worldbuild-entity-discovery');

describe('Worldbuild entity discovery', () => {
  const graph = [
    { fromId: 'a', toId: 'b' },
    { fromId: 'b', toId: 'c' },
    { fromId: 'c', toId: 'd' }
  ];

  const loader = (frontier: string[]) => graph.filter(edge =>
    frontier.includes(edge.fromId) || frontier.includes(edge.toId)
  );

  it('keeps breadth independent from the final entity limit', () => {
    expect(discoverEntityIds(['a'], 'focused', 10, loader)).toEqual(['a']);
    expect(discoverEntityIds(['a'], 'balanced', 10, loader)).toEqual(['a', 'b']);
    expect(discoverEntityIds(['a'], 'broad', 10, loader)).toEqual(['a', 'b', 'c']);
    expect(discoverEntityIds(['a'], 'broad', 2, loader)).toEqual(['a', 'b']);
  });

  it('stops large connected graphs at the configured cap', () => {
    const largeLoader = vi.fn((frontier: string[], edgeLimit: number) =>
      Array.from({ length: edgeLimit }, (_, index) => ({
        fromId: frontier[index % frontier.length],
        toId: `entity-${index + 1}`
      }))
    );

    const result = discoverEntityIds(['root'], 'broad', 50, largeLoader);

    expect(result).toHaveLength(50);
    expect(largeLoader).toHaveBeenCalledTimes(1);
  });
});
