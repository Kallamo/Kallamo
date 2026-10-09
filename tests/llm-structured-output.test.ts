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

describe('Claude structured output schema', () => {
  const { claudeCompatibleSchema } = require('../src/main/features/llm/structured-output');

  test('drops the bounds Claude cannot enforce and keeps everything else', () => {
    const input = {
      type: 'object',
      additionalProperties: false,
      required: ['confidence', 'maximum'],
      properties: {
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        maximum: { type: 'integer', minimum: 1 },
        name: { type: 'string', minLength: 1, maxLength: 40, enum: ['a', 'b'] },
        ids: { type: 'array', minItems: 2, maxItems: 5, items: { type: 'string' } },
        tags: { type: 'array', minItems: 1, items: { type: 'string' } }
      }
    };
    expect(claudeCompatibleSchema(input)).toEqual({
      type: 'object',
      additionalProperties: false,
      required: ['confidence', 'maximum'],
      properties: {
        confidence: { type: 'number' },
        maximum: { type: 'integer' },
        name: { type: 'string', enum: ['a', 'b'] },
        ids: { type: 'array', items: { type: 'string' } },
        tags: { type: 'array', minItems: 1, items: { type: 'string' } }
      }
    });
  });

  test('sends the compatible schema to Bedrock', () => {
    const bounded = { type: 'object', additionalProperties: false, properties: { value: { type: 'number', minimum: 0 } } };
    expect(applyBedrockStructuredOutput({}, bounded).output_config.format.schema.properties.value).toEqual({ type: 'number' });
  });
});

describe('Gemini response schema', () => {
  const { geminiResponseSchema } = require('../src/main/features/llm/structured-output');

  test('converts a closed schema, keeping property order and turning a null branch into nullable', () => {
    const converted = geminiResponseSchema({
      type: 'object',
      additionalProperties: false,
      required: ['name', 'when'],
      properties: {
        name: { type: 'string', enum: ['a', 'b'] },
        score: { type: 'number', minimum: 0, maximum: 1 },
        when: { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false, properties: { hour: { type: 'integer' } } }] }
      }
    });
    expect(converted).toEqual({
      type: 'OBJECT',
      required: ['name', 'when'],
      propertyOrdering: ['name', 'score', 'when'],
      properties: {
        name: { type: 'STRING', enum: ['a', 'b'] },
        score: { type: 'NUMBER' },
        when: { type: 'OBJECT', nullable: true, propertyOrdering: ['hour'], properties: { hour: { type: 'INTEGER' } } }
      }
    });
  });

  test('gives up on what it cannot express, so the request keeps plain JSON mode', () => {
    expect(geminiResponseSchema({ type: 'object', additionalProperties: true, properties: { a: { type: 'string' } } })).toBeNull();
    expect(geminiResponseSchema({ type: 'object', properties: { free: { type: 'object' } } })).toBeNull();
    expect(geminiResponseSchema({ anyOf: [{ type: 'string' }, { type: 'number' }] })).toBeNull();
  });
});
