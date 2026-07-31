import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { openAiResponseFormat, applyBedrockStructuredOutput } = require('../src/main/features/llm/structured-output');
const schema = { type: 'object', properties: {}, additionalProperties: false };

describe('provider structured output payloads', () => {
  test('uses Bedrock InvokeModel output_config.format', () => {
    expect(applyBedrockStructuredOutput({ messages: [] }, schema)).toEqual({
      messages: [],
      output_config: { format: { type: 'json_schema', schema } }
    });
  });

  test('uses JSON Schema for OpenAI-compatible providers', () => {
    expect(openAiResponseFormat(schema)).toEqual({
      type: 'json_schema',
      json_schema: { name: 'kallamo_structured_response', strict: false, schema }
    });
  });

  test('keeps plain JSON mode when no schema is supplied', () => {
    expect(openAiResponseFormat()).toEqual({ type: 'json_object' });
  });
});
