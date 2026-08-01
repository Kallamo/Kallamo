import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { buildRequest } = require('../src/main/features/llm/llm.service');

function createDatabase({ provider, variables = [], customConfig = null }: {
  provider: string;
  variables?: Array<{ key: string; value: string }>;
  customConfig?: Record<string, string> | null;
}) {
  const profile = {
    id: 'api-profile',
    provider,
    apiKey: 'encrypted-api-key',
    baseUrl: provider === 'OpenAI' ? 'https://example.test/v1' : '',
    customConfig: customConfig ? JSON.stringify(customConfig) : null
  };

  return {
    prepare(query: string) {
      if (query.includes('FROM variables')) return { all: () => variables };
      if (query.includes('FROM api_profiles')) {
        return { get: (id: string) => id === profile.id ? profile : undefined };
      }
      throw new Error(`Unexpected query: ${query}`);
    },
    decryptApiKey(value: string) {
      return value === profile.apiKey ? 'api-key' : value;
    }
  };
}

const schema = {
  type: 'object',
  properties: { result: { type: 'string' } },
  required: ['result'],
  additionalProperties: false
};

describe('LLM request composition', () => {
  test('builds the final OpenAI structured request after resolving workspace variables', async () => {
    const database = createDatabase({
      provider: 'OpenAI',
      variables: [{ key: 'voice', value: 'precise' }]
    });

    const request = await buildRequest({
      apiProfileId: 'api-profile',
      model: 'gpt-5-mini',
      systemPrompt: 'Be {{voice}}.',
      chatHistory: [{ role: 'ai', content: 'Earlier answer' }],
      newPrompt: 'Return the result.',
      maxTokens: 400,
      maxPayloadTokens: 8192,
      jsonMode: true,
      jsonSchema: schema
    }, { database });
    const body = JSON.parse(request.requestBodyPayload);
    const plainJsonRequest = await buildRequest({
      apiProfileId: 'api-profile',
      model: 'gpt-4.1-mini',
      newPrompt: 'Return JSON.',
      jsonMode: true
    }, { database });
    const plainJsonBody = JSON.parse(plainJsonRequest.requestBodyPayload);

    expect(request.endpoint).toBe('https://example.test/v1/chat/completions');
    expect(body).toMatchObject({
      messages: [
        { role: 'system', content: 'Be precise.' },
        { role: 'assistant', content: 'Earlier answer' },
        { role: 'user', content: 'Return the result.' }
      ],
      max_completion_tokens: 400,
      response_format: {
        type: 'json_schema',
        json_schema: { name: 'kallamo_structured_response', strict: false, schema }
      }
    });
    expect(body).not.toHaveProperty('max_tokens');
    expect(plainJsonBody.response_format).toEqual({ type: 'json_object' });
  });

  test('places the schema in the final Bedrock Claude payload', async () => {
    const database = createDatabase({
      provider: 'AWS Bedrock',
      customConfig: {
        awsAccessKeyId: 'access-key',
        awsSecretAccessKey: 'secret-key',
        awsRegion: 'us-east-1'
      }
    });

    const request = await buildRequest({
      apiProfileId: 'api-profile',
      model: 'anthropic.claude-3-5-sonnet',
      systemPrompt: 'Return structured data.',
      newPrompt: 'Describe the entity.',
      maxTokens: 600,
      jsonMode: true,
      jsonSchema: schema
    }, { database });
    const body = JSON.parse(request.requestBodyPayload);

    expect(request.requestHeaders.Authorization).toMatch(/^AWS4-HMAC-SHA256 /);
    expect(body.output_config).toEqual({ format: { type: 'json_schema', schema } });
  });

  test('enforces the payload limit after workspace variables are expanded', async () => {
    const database = createDatabase({
      provider: 'OpenAI',
      variables: [{ key: 'lore', value: 'lore '.repeat(5000) }]
    });

    await expect(buildRequest({
      apiProfileId: 'api-profile',
      model: 'gpt-4.1-mini',
      systemPrompt: '{{lore}}',
      newPrompt: 'Continue.',
      maxTokens: 1000,
      maxPayloadTokens: 4096
    }, { database })).rejects.toMatchObject({
      code: 'MAX_API_PAYLOAD_EXCEEDED'
    });
  });
});
