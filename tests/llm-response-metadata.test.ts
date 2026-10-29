import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { getResponseMetadata } = require('../src/main/features/llm/response-metadata');

describe('LLM response metadata', () => {
  test('recognizes Bedrock output-limit responses', () => {
    expect(getResponseMetadata({ stop_reason: 'max_tokens', usage: { output_tokens: 1800 } }, 'AWS Bedrock'))
      .toEqual({
        finishReason: 'max_tokens',
        truncated: true,
        usage: { output_tokens: 1800 },
        inputTokens: 0,
        outputTokens: 1800,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cacheLongWriteTokens: 0,
        totalInputTokens: null,
        uncachedInputTokens: 0
      });
  });

  test('recognizes successful OpenAI-compatible responses', () => {
    expect(getResponseMetadata({ choices: [{ finish_reason: 'stop' }] }, 'OpenRouter'))
      .toEqual({
        finishReason: 'stop',
        truncated: false,
        usage: null,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        cacheLongWriteTokens: 0,
        totalInputTokens: null,
        uncachedInputTokens: 0
      });
  });

  test('normalizes Google token usage', () => {
    expect(getResponseMetadata({ candidates: [{ finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 30 } }, 'Google AI'))
      .toEqual(expect.objectContaining({ inputTokens: 120, outputTokens: 30 }));
  });

  test('reads Anthropic cache counters, which sit beside input_tokens rather than inside it', () => {
    expect(getResponseMetadata({
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 400,
        output_tokens: 210,
        cache_read_input_tokens: 12000,
        cache_creation_input_tokens: 0
      }
    }, 'Anthropic')).toEqual(expect.objectContaining({
      inputTokens: 400,
      cacheReadTokens: 12000,
      cacheWriteTokens: 0,
      uncachedInputTokens: 400,
      totalInputTokens: 12400
    }));
  });

  test('reads OpenAI cached tokens, which are already counted inside prompt_tokens', () => {
    expect(getResponseMetadata({
      choices: [{ finish_reason: 'stop' }],
      usage: {
        prompt_tokens: 9000,
        completion_tokens: 150,
        prompt_tokens_details: { cached_tokens: 8192 }
      }
    }, 'OpenAI')).toEqual(expect.objectContaining({
      inputTokens: 9000,
      cacheReadTokens: 8192,
      uncachedInputTokens: 808
    }));
  });

  test('reads the writes OpenRouter and newer OpenAI models bill, and keeps them out of the plain input', () => {
    expect(getResponseMetadata({
      choices: [{ finish_reason: 'stop' }],
      usage: { prompt_tokens: 6000, completion_tokens: 90, prompt_tokens_details: { cached_tokens: 3000, cache_write_tokens: 2000 } }
    }, 'OpenRouter')).toEqual(expect.objectContaining({ cacheReadTokens: 3000, cacheWriteTokens: 2000, uncachedInputTokens: 1000 }));
  });

  test('separates the hour-long Anthropic writes, which cost twice the input', () => {
    expect(getResponseMetadata({
      stop_reason: 'end_turn',
      usage: { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 5000, cache_creation: { ephemeral_1h_input_tokens: 5000, ephemeral_5m_input_tokens: 0 } }
    }, 'AWS Bedrock')).toEqual(expect.objectContaining({ cacheWriteTokens: 5000, cacheLongWriteTokens: 5000 }));
  });

  test('reads Google cached content tokens', () => {
    expect(getResponseMetadata({
      candidates: [{ finishReason: 'STOP' }],
      usageMetadata: { promptTokenCount: 5000, candidatesTokenCount: 40, cachedContentTokenCount: 4000 }
    }, 'Google AI')).toEqual(expect.objectContaining({
      cacheReadTokens: 4000,
      uncachedInputTokens: 1000
    }));
  });
});
