import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { getResponseMetadata } = require('../src/main/features/llm/response-metadata');

describe('LLM response metadata', () => {
  test('recognizes Bedrock output-limit responses', () => {
    expect(getResponseMetadata({ stop_reason: 'max_tokens', usage: { output_tokens: 1800 } }, 'AWS Bedrock'))
      .toEqual({ finishReason: 'max_tokens', truncated: true, usage: { output_tokens: 1800 }, inputTokens: 0, outputTokens: 1800 });
  });

  test('recognizes successful OpenAI-compatible responses', () => {
    expect(getResponseMetadata({ choices: [{ finish_reason: 'stop' }] }, 'OpenRouter'))
      .toEqual({ finishReason: 'stop', truncated: false, usage: null, inputTokens: 0, outputTokens: 0 });
  });

  test('normalizes Google token usage', () => {
    expect(getResponseMetadata({ candidates: [{ finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30 } }, 'Google AI'))
      .toEqual(expect.objectContaining({ inputTokens: 120, outputTokens: 30 }));
  });
});
