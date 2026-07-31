import { describe, expect, it } from 'vitest';

const {
  assertPayloadWithinLimit,
  estimatePayloadTokens,
  getAvailableHistoryTokens,
  normalizeMaxApiPayload
} = require('../src/main/features/llm/payload-budget');

describe('workspace API payload budget', () => {
  it('normalizes invalid and unsafe workspace limits', () => {
    expect(normalizeMaxApiPayload('invalid')).toBe(128000);
    expect(normalizeMaxApiPayload(-10)).toBe(4096);
    expect(normalizeMaxApiPayload(3000000)).toBe(2000000);
  });

  it('reserves response, message overhead, safety margin, and images', () => {
    const withoutImage = estimatePayloadTokens({ systemPrompt: 'System', newPrompt: 'Prompt', outputTokens: 1000 });
    const withImage = estimatePayloadTokens({ systemPrompt: 'System', newPrompt: 'Prompt', attachedImageCount: 1, outputTokens: 1000 });
    expect(withImage.totalTokens - withoutImage.totalTokens).toBe(4096);
    expect(withoutImage.reservedOutputTokens).toBe(1000);
    expect(withoutImage.safetyMarginTokens).toBe(256);
  });

  it('gives history only the space left after fixed input and output', () => {
    const withoutOutput = getAvailableHistoryTokens({ maxPayloadTokens: 8192, systemPrompt: 'System', newPrompt: 'Prompt', outputTokens: 0 });
    const withOutput = getAvailableHistoryTokens({ maxPayloadTokens: 8192, systemPrompt: 'System', newPrompt: 'Prompt', outputTokens: 2048 });
    expect(withoutOutput - withOutput).toBe(2048);
  });

  it('blocks oversized requests before a provider call', () => {
    expect(() => assertPayloadWithinLimit({
      maxPayloadTokens: 4096,
      systemPrompt: 'lore '.repeat(5000),
      newPrompt: 'Continue',
      outputTokens: 1000
    })).toThrow(/stopped before contacting the API/);
  });
});
