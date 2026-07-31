import { describe, expect, it } from 'vitest';

const {
  normalizeRetrievalSettings,
  withNormalizedRetrievalSettings
} = require('../src/shared/retrieval-settings');

describe('retrieval settings', () => {
  it('maps legacy source limits to the explicit settings', () => {
    expect(normalizeRetrievalSettings({ topKKB: 9, topKMemory: 7 })).toMatchObject({
      profileKnowledgeTopK: 9,
      workspaceDocumentsTopK: 9,
      longTermMemoryTopK: 7
    });
  });

  it('prefers explicit settings and clamps imported values', () => {
    expect(normalizeRetrievalSettings({
      topKKB: 4,
      profileKnowledgeTopK: 80,
      workspaceDocumentsTopK: 12,
      longTermMemoryTopK: -2,
      worldbuildEntityLimit: 200,
      retrievalStrictness: 2,
      worldbuildBreadth: 'unknown'
    })).toEqual({
      profileKnowledgeTopK: 30,
      workspaceDocumentsTopK: 12,
      longTermMemoryTopK: 1,
      worldbuildEntityLimit: 50,
      retrievalStrictness: 1,
      worldbuildBreadth: 'balanced'
    });
  });

  it('preserves unrelated advanced settings while persisting explicit keys', () => {
    const normalized = withNormalizedRetrievalSettings({
      ragDebug: true,
      narrativeContextBudgetPercent: 35
    });
    expect(normalized).toMatchObject({
      ragDebug: true,
      profileKnowledgeTopK: 5,
      workspaceDocumentsTopK: 5,
      longTermMemoryTopK: 5
    });
    expect(normalized).not.toHaveProperty('narrativeContextBudgetPercent');
  });
});
