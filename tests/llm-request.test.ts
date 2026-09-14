import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildRequest,
  parseResponse,
  parseStreamChunk,
  providerOutputLimit,
  readHttpErrorMessage,
  resolveOpenAiCompatibleEndpoint
} = require('../src/main/features/llm/llm.service');

function createDatabase({ provider, variables = [], customConfig = null, baseUrl, apiKey = 'api-key', contextWindow = null }: {
  provider: string;
  variables?: Array<{ key: string; value: string }>;
  customConfig?: Record<string, string> | null;
  baseUrl?: string;
  apiKey?: string;
  contextWindow?: number | null;
}) {
  const profile = {
    id: 'api-profile',
    provider,
    apiKey: 'encrypted-api-key',
    baseUrl: baseUrl ?? (provider === 'OpenAI' ? 'https://example.test/v1' : ''),
    customConfig: customConfig ? JSON.stringify(customConfig) : null,
    contextWindow
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
      return value === profile.apiKey ? apiKey : value;
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
      max_completion_tokens: 400 + 8192,
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

  test('resolves local base URLs and full endpoints without cloud fallback', async () => {
    const database = createDatabase({
      provider: 'Local',
      baseUrl: 'http://127.0.0.1:5001/v1',
      apiKey: ''
    });
    const request = await buildRequest({
      apiProfileId: 'api-profile',
      model: 'local-model',
      newPrompt: 'Hello'
    }, { database });

    expect(request.endpoint).toBe('http://127.0.0.1:5001/v1/chat/completions');
    expect(request.requestHeaders).not.toHaveProperty('Authorization');
    expect(resolveOpenAiCompatibleEndpoint(
      'http://127.0.0.1:5001/v1/chat/completions',
      'local',
      'chat'
    )).toBe('http://127.0.0.1:5001/v1/chat/completions');
    expect(() => resolveOpenAiCompatibleEndpoint('', 'local', 'chat')).toThrow(/require a Base URL/);
  });

  test('preserves structured and plain-text HTTP error details', async () => {
    await expect(readHttpErrorMessage({
      status: 400,
      statusText: 'Bad Request',
      text: async () => JSON.stringify({ error: { message: 'Model is unavailable' } })
    })).resolves.toBe('Model is unavailable');
    await expect(readHttpErrorMessage({
      status: 502,
      statusText: 'Bad Gateway',
      text: async () => 'koboldcpp is not ready'
    })).resolves.toBe('koboldcpp is not ready');
  });
});

describe('reasoning models, provider limits and replies', () => {
  test('omits temperature for OpenAI reasoning models only', async () => {
    const database = createDatabase({ provider: 'OpenAI' });
    const reasoning = JSON.parse((await buildRequest({
      apiProfileId: 'api-profile', model: 'gpt-5-mini', newPrompt: 'Hi', temperature: 0.2, maxTokens: 500
    }, { database })).requestBodyPayload);
    const regular = JSON.parse((await buildRequest({
      apiProfileId: 'api-profile', model: 'gpt-4.1-mini', newPrompt: 'Hi', temperature: 0.2, maxTokens: 500
    }, { database })).requestBodyPayload);
    expect(reasoning).not.toHaveProperty('temperature');
    expect(reasoning.max_completion_tokens).toBe(500 + 8192);
    expect(regular.temperature).toBe(0.2);
    expect(regular.max_tokens).toBe(500);
  });

  test('gives thinking models output headroom within the provider ceiling', () => {
    expect(providerOutputLimit('Google AI', 'gemini-2.5-flash', 2048)).toBe(2048 + 8192);
    expect(providerOutputLimit('Google AI', 'gemini-2.5-pro', 65000)).toBe(65536);
    expect(providerOutputLimit('Google AI', 'gemini-2.0-flash', 2048)).toBe(2048);
    expect(providerOutputLimit('Anthropic', 'claude-sonnet-4-5', 2048)).toBe(2048);
  });

  test('applies the connection context window when it is the smaller limit', async () => {
    const database = createDatabase({ provider: 'OpenAI', contextWindow: 4096 });
    await expect(buildRequest({
      apiProfileId: 'api-profile',
      model: 'gpt-4.1-mini',
      systemPrompt: 'lore '.repeat(4000),
      newPrompt: 'Continue.',
      maxTokens: 500,
      maxPayloadTokens: 128000
    }, { database })).rejects.toMatchObject({ code: 'MAX_API_PAYLOAD_EXCEEDED' });
  });

  test('reads replies without turning failures into reply text', () => {
    expect(parseResponse({ content: [{ type: 'thinking', thinking: 'plan' }, { type: 'text', text: 'Hi' }] }, 'anthropic')).toBe('<think>plan</think>Hi');
    expect(parseResponse({ candidates: [{ content: { parts: [{ text: 'A' }, { text: 'B' }] }, finishReason: 'STOP' }] }, 'google ai')).toBe('AB');
    expect(parseResponse({ candidates: [{ finishReason: 'MAX_TOKENS', content: {} }] }, 'google ai')).toBe('');
    expect(() => parseResponse({ candidates: [{ finishReason: 'SAFETY' }] }, 'google ai')).toThrow(/stopped this reply \(SAFETY\)/);
    expect(() => parseResponse({ promptFeedback: { blockReason: 'PROHIBITED_CONTENT' } }, 'google ai')).toThrow(/blocked this prompt/);
    expect(() => parseResponse({ error: { message: 'overloaded' } }, 'openai')).toThrow(/overloaded/);
    expect(() => parseResponse({ choices: [{ message: { content: null, refusal: 'No.' } }] }, 'openai')).toThrow(/declined/);
    expect(parseResponse({ choices: [{ message: { content: '', reasoning_content: 'hmm' }, finish_reason: 'length' }] }, 'local')).toBe('<think>hmm</think>');
  });

  test('reports stream errors and finish reasons', () => {
    expect(parseStreamChunk({ choices: [{ delta: {}, finish_reason: 'length' }] }, 'openai').finishReason).toBe('length');
    expect(parseStreamChunk({ type: 'message_delta', delta: { stop_reason: 'max_tokens' } }, 'anthropic').finishReason).toBe('max_tokens');
    expect(parseStreamChunk({ type: 'error', error: { message: 'Overloaded' } }, 'anthropic').error).toBe('Overloaded');
    expect(parseStreamChunk({ error: { message: 'bad gateway' } }, 'openrouter').error).toBe('bad gateway');
  });
});

describe('agent conversations', () => {
  const conversation = [
    { role: 'user', text: 'Research {{topic}}.' },
    { role: 'assistant', text: 'THOUGHT: search.', toolCalls: [{ id: 'c1', name: 'search_kb', args: { query: 'When does the inn open?' } }] },
    { role: 'tool', results: [{ id: 'c1', name: 'search_kb', content: '[R1 · Archive] The inn opens at dawn.' }] },
    { role: 'user', text: 'TURN 2/3. What is your next step?' }
  ];
  const tools = [{
    name: 'search_kb',
    description: 'Searches the knowledge base.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] }
  }];

  test('an OpenAI-compatible request carries the transcript, the tools and resolved variables', async () => {
    const database = createDatabase({ provider: 'Local', baseUrl: 'http://localhost:1234/v1', variables: [{ key: 'topic', value: 'the inn' }] });
    const request = await buildRequest({ apiProfileId: 'api-profile', model: 'qwen3-8b', systemPrompt: 'Be precise.', conversation, tools, maxTokens: 500 }, { database });
    const body = JSON.parse(request.requestBodyPayload);

    expect(body.messages[0]).toEqual({ role: 'system', content: 'Be precise.' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'Research the inn.' });
    expect(body.messages[2].tool_calls[0].function.name).toBe('search_kb');
    expect(body.messages[3]).toEqual({ role: 'tool', tool_call_id: 'c1', content: '[R1 · Archive] The inn opens at dawn.' });
    expect(body.tools[0].function.name).toBe('search_kb');
  });

  test('Anthropic prefix caching is requested only on its own endpoint', async () => {
    const official = await buildRequest(
      { apiProfileId: 'api-profile', model: 'claude-sonnet-4-6', conversation, tools, maxTokens: 500, cachePrefix: true },
      { database: createDatabase({ provider: 'Anthropic' }) }
    );
    expect(JSON.parse(official.requestBodyPayload).cache_control).toEqual({ type: 'ephemeral' });

    const proxied = await buildRequest(
      { apiProfileId: 'api-profile', model: 'claude-sonnet-4-6', conversation, tools, maxTokens: 500, cachePrefix: true },
      { database: createDatabase({ provider: 'Anthropic', baseUrl: 'https://proxy.test/v1/messages' }) }
    );
    expect(JSON.parse(proxied.requestBodyPayload)).not.toHaveProperty('cache_control');
  });

  test('Claude on Bedrock is cached with an explicit breakpoint, never the automatic field', async () => {
    const database = createDatabase({
      provider: 'AWS Bedrock',
      customConfig: { awsRegion: 'us-east-1', awsAccessKeyId: 'AKIDEXAMPLE', awsSecretAccessKey: 'secret' }
    });
    const request = await buildRequest(
      { apiProfileId: 'api-profile', model: 'us.anthropic.claude-sonnet-4-6', systemPrompt: 'Be precise.', conversation, tools, maxTokens: 500, cachePrefix: true },
      { database }
    );
    const body = JSON.parse(request.requestBodyPayload);
    const last = body.messages[body.messages.length - 1].content;
    expect(body).not.toHaveProperty('cache_control');
    expect(last[last.length - 1].cache_control).toEqual({ type: 'ephemeral' });
    expect(body.anthropic_version).toBe('bedrock-2023-05-31');
  });

  test('no request carries a cache marker unless it asks for one', async () => {
    const request = await buildRequest(
      { apiProfileId: 'api-profile', model: 'claude-sonnet-4-6', newPrompt: 'Hello', maxTokens: 500 },
      { database: createDatabase({ provider: 'Anthropic' }) }
    );
    expect(JSON.parse(request.requestBodyPayload)).not.toHaveProperty('cache_control');
  });

  test('Google renders function calls and declarations', async () => {
    const request = await buildRequest(
      { apiProfileId: 'api-profile', model: 'gemini-2.5-flash', systemPrompt: 'Be precise.', conversation, tools, maxTokens: 500 },
      { database: createDatabase({ provider: 'Google AI' }) }
    );
    const body = JSON.parse(request.requestBodyPayload);
    expect(body.contents.map((content: any) => content.role)).toEqual(['user', 'model', 'user']);
    expect(body.tools[0].functionDeclarations[0].name).toBe('search_kb');
    expect(body.system_instruction.parts[0].text).toBe('Be precise.');
  });

  test('the payload limit measures the whole transcript, not only the last message', async () => {
    const database = createDatabase({ provider: 'OpenAI', contextWindow: 4096 });
    const long = [{ role: 'user', text: 'word '.repeat(6000) }];
    await expect(buildRequest(
      { apiProfileId: 'api-profile', model: 'gpt-4.1-mini', conversation: long, tools, maxTokens: 500, maxPayloadTokens: 128000 },
      { database }
    )).rejects.toMatchObject({ code: 'MAX_API_PAYLOAD_EXCEEDED' });
  });
});
