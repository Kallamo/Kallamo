import { describe, expect, it } from 'vitest';

const {
  assertPayloadWithinLimit,
  estimatePayloadTokens,
  getAvailableHistoryTokens,
  normalizeMaxApiPayload,
  safetyMarginFor
} = require('../src/main/features/llm/payload-budget');

describe('workspace API payload budget', () => {
  it('normalizes invalid and unsafe workspace limits', () => {
    expect(normalizeMaxApiPayload('invalid')).toBe(128000);
    expect(normalizeMaxApiPayload(null)).toBe(128000);
    expect(normalizeMaxApiPayload('')).toBe(128000);
    expect(normalizeMaxApiPayload(0)).toBe(128000);
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
    try {
      assertPayloadWithinLimit({
        maxPayloadTokens: 4096,
        systemPrompt: 'lore '.repeat(5000),
        newPrompt: 'Continue',
        outputTokens: 1000
      });
      throw new Error('Expected the payload guard to reject the request.');
    } catch (error: any) {
      expect(error.code).toBe('MAX_API_PAYLOAD_EXCEEDED');
      expect(error.payloadEstimate.totalTokens).toBeGreaterThan(error.payloadEstimate.maxPayloadTokens);
      expect(error.message).toMatch(/stopped before contacting the API/);
    }
  });

  it('scales the safety margin with the limit', () => {
    expect(safetyMarginFor(4096)).toBe(256);
    expect(safetyMarginFor(128000)).toBe(3840);
  });

  it('explains an overflow by source and does not offer a retry', () => {
    try {
      assertPayloadWithinLimit({
        maxPayloadTokens: 4096,
        limitSource: 'connection',
        systemPrompt: 'lore '.repeat(5000),
        newPrompt: 'Continue',
        outputTokens: 1000,
        breakdown: { fixed: 5000, retrieved: 0, history: 0 }
      });
      throw new Error('Expected the payload guard to reject the request.');
    } catch (error: any) {
      expect(error.retryable).toBe(false);
      expect(error.message).toMatch(/context window set on this API connection/);
      expect(error.message).toMatch(/of retrieved context/);
    }
  });

  it('keeps a corrected limit that sits below the configurable minimum', () => {
    const fixed = { systemPrompt: 'System', newPrompt: 'Prompt', outputTokens: 1000 };
    expect(getAvailableHistoryTokens({ ...fixed, maxPayloadTokens: 4096 }) - getAvailableHistoryTokens({ ...fixed, maxPayloadTokens: 3150 })).toBe(4096 - 3150);
    expect(assertPayloadWithinLimit({ ...fixed, maxPayloadTokens: 3150 })?.maxPayloadTokens).toBe(3150);
  });

  it('names the configured limit and the measured ratio when a corrected limit is exceeded', () => {
    try {
      assertPayloadWithinLimit({
        maxPayloadTokens: 6301,
        configuredPayloadTokens: 8192,
        tokenRatio: 1.3,
        limitSource: 'connection',
        systemPrompt: 'lore '.repeat(7000),
        newPrompt: 'Continue',
        outputTokens: 1000
      });
      throw new Error('Expected the payload guard to reject the request.');
    } catch (error: any) {
      expect(error.message).toMatch(/fit within the context window set on this API connection of 8[,.\s ]?192 tokens/);
      expect(error.message).toMatch(/counts about 1\.30 times the tokens Kallamo estimates/);
      expect(error.payloadEstimate).toMatchObject({ maxPayloadTokens: 6301, configuredPayloadTokens: 8192, tokenRatio: 1.3 });
    }
  });

  it('keeps the plain wording when nothing was corrected', () => {
    expect(() => assertPayloadWithinLimit({
      maxPayloadTokens: 4096,
      configuredPayloadTokens: 4096,
      tokenRatio: 1,
      systemPrompt: 'lore '.repeat(5000),
      outputTokens: 1000
    })).toThrow(/exceeds this workspace's MAX API Payload of 4[,.\s ]?096 tokens\./);
  });
});
