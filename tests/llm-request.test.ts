import { createRequire } from 'node:module';
import { afterEach, describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildRequest,
  claudeRejectsSampling,
  learnFromReportedTokens,
  parseResponse,
  parseStreamChunk,
  providerOutputLimit,
  readHttpErrorMessage,
  resolveOpenAiCompatibleEndpoint,
  resolvePayloadLimit
} = require('../src/main/features/llm/llm.service');
const {
  PAYLOAD_BUDGET_CONTRACT,
  estimatePayloadTokens,
  estimateTokens,
  getAvailableHistoryTokens
} = require('../src/main/features/llm/payload-budget');
const { clearTokenCalibration, measuredRatio, recordTokenCount } = require('../src/main/features/llm/token-calibration');

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

  test('sends spoiler text without its markers unless the caller rewrites Worldbuild text', async () => {
    const database = createDatabase({ provider: 'OpenAI' });
    const params = {
      apiProfileId: 'api-profile',
      model: 'gpt-4.1-mini',
      systemPrompt: 'Lore: Harrow ||is the Hollowhart||.',
      newPrompt: 'Is a || b || c true?',
      conversation: [{ role: 'tool', results: [{ id: 'call-1', content: 'Found ||a secret||.' }] }],
      maxPayloadTokens: 8192
    };
    const plain = JSON.parse((await buildRequest(params, { database })).requestBodyPayload);
    const kept = JSON.parse((await buildRequest({ ...params, keepSpoilerMarkers: true }, { database })).requestBodyPayload);
    const question = JSON.parse((await buildRequest({ ...params, conversation: null }, { database })).requestBodyPayload);

    expect(plain.messages[0].content).toBe('Lore: Harrow is the Hollowhart.');
    expect(JSON.stringify(plain.messages)).toContain('Found a secret.');
    expect(question.messages.at(-1).content).toBe('Is a || b || c true?');
    expect(kept.messages[0].content).toBe('Lore: Harrow ||is the Hollowhart||.');
    expect(JSON.stringify(kept.messages)).toContain('Found ||a secret||.');
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

  test('omits sampling for Claude models that reject it, including unknown ids', () => {
    for (const model of [
      'claude-opus-5', 'claude-opus-4-8', 'claude-opus-4-7', 'claude-sonnet-5', 'claude-fable-5', 'claude-fable-5-1',
      'anthropic.claude-opus-4-7', 'anthropic.claude-sonnet-5', 'global.anthropic.claude-fable-5-1',
      'claude-haiku-5', 'claude-opus-6-2', 'claude-next', 'my-proxy-alias'
    ]) {
      expect(claudeRejectsSampling(model), model).toBe(true);
    }
    for (const model of [
      'claude-opus-4-6', 'claude-sonnet-4-6', 'claude-haiku-4-5', 'claude-haiku-4-5-20251001', 'claude-opus-4-20250514',
      'claude-sonnet-4-5-20250929', 'claude-3-7-sonnet-20250219', 'claude-3-haiku-20240307', 'claude-2.1',
      'anthropic.claude-opus-4-6-v1', 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
      'global.anthropic.claude-haiku-4-5-20251001-v1:0', 'anthropic.claude-v2', 'anthropic.claude-instant-v1',
      'arn:aws:bedrock:us-east-1:123456789012:inference-profile/us.anthropic.claude-opus-4-6-v1'
    ]) {
      expect(claudeRejectsSampling(model), model).toBe(false);
    }
  });

  test('sends temperature on the Anthropic path only to models that accept it', async () => {
    const database = createDatabase({ provider: 'Anthropic' });
    const build = async (model: string) => JSON.parse((await buildRequest({
      apiProfileId: 'api-profile', model, newPrompt: 'Hi', temperature: 0.2, maxTokens: 500
    }, { database })).requestBodyPayload);
    const current = await build('claude-opus-5');
    const earlier = await build('claude-sonnet-4-6');
    expect(current).not.toHaveProperty('temperature');
    expect(current).not.toHaveProperty('top_p');
    expect(current).not.toHaveProperty('top_k');
    expect(current.max_tokens).toBe(500);
    expect(earlier.temperature).toBe(0.2);
  });

  test('sends temperature on the Bedrock Claude path only to models that accept it', async () => {
    const database = createDatabase({
      provider: 'AWS Bedrock',
      customConfig: { awsAccessKeyId: 'access-key', awsSecretAccessKey: 'secret-key', awsRegion: 'us-east-1' }
    });
    const build = async (model: string) => JSON.parse((await buildRequest({
      apiProfileId: 'api-profile', model, newPrompt: 'Hi', temperature: 0.2, maxTokens: 500
    }, { database })).requestBodyPayload);
    const current = await build('us.anthropic.claude-opus-4-7');
    const earlier = await build('us.anthropic.claude-opus-4-6-v1');
    const llama = await build('meta.llama3-70b-instruct-v1:0');
    expect(current).not.toHaveProperty('temperature');
    expect(current.anthropic_version).toBe('bedrock-2023-05-31');
    expect(earlier.temperature).toBe(0.2);
    expect(llama.temperature).toBe(0.2);
  });

  test('sends chat messages to Bedrock models that read the OpenAI format', async () => {
    const database = createDatabase({
      provider: 'AWS Bedrock',
      customConfig: { awsAccessKeyId: 'access-key', awsSecretAccessKey: 'secret-key', awsRegion: 'us-east-1' }
    });
    const build = async (model: string) => JSON.parse((await buildRequest({
      apiProfileId: 'api-profile', model, systemPrompt: 'Narrate.', newPrompt: 'Hi', temperature: 0.2, maxTokens: 500
    }, { database })).requestBodyPayload);
    for (const model of ['global.moonshotai.kimi-k3', 'deepseek.v3-v1:0', 'qwen.qwen3-32b-v1:0', 'openai.gpt-oss-120b-1:0']) {
      const body = await build(model);
      expect(body.messages, model).toEqual([{ role: 'system', content: 'Narrate.' }, { role: 'user', content: 'Hi' }]);
      expect(body.max_tokens).toBe(500);
      expect(body.temperature).toBe(0.2);
      expect(body).not.toHaveProperty('prompt');
    }
    expect(await build('mistral.mixtral-8x7b-instruct-v0:1')).toHaveProperty('prompt');
  });

  test('reads Bedrock replies in the OpenAI format', () => {
    const reply = { choices: [{ message: { content: 'The tide turns.', reasoning_content: 'plan' }, finish_reason: 'stop' }], usage: { prompt_tokens: 40, completion_tokens: 5 } };
    expect(parseResponse(reply, 'aws bedrock')).toBe('<think>plan</think>The tide turns.');
    expect(parseResponse({ content: [{ type: 'text', text: 'Hi' }] }, 'aws bedrock')).toBe('Hi');
    expect(() => parseResponse({ choices: [{ message: { content: null, refusal: 'No.' } }] }, 'aws bedrock')).toThrow(/declined/);
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
      { apiProfileId: 'api-profile', model: 'claude-sonnet-4-6', conversation, tools, maxTokens: 500, promptCache: { policy: 'transcript' } },
      { database: createDatabase({ provider: 'Anthropic' }) }
    );
    expect(JSON.parse(official.requestBodyPayload).cache_control).toEqual({ type: 'ephemeral' });

    const proxied = await buildRequest(
      { apiProfileId: 'api-profile', model: 'claude-sonnet-4-6', conversation, tools, maxTokens: 500, promptCache: { policy: 'transcript' } },
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
      { apiProfileId: 'api-profile', model: 'us.anthropic.claude-sonnet-4-6', systemPrompt: 'Be precise.', conversation, tools, maxTokens: 500, promptCache: { policy: 'transcript' } },
      { database }
    );
    const body = JSON.parse(request.requestBodyPayload);
    const last = body.messages[body.messages.length - 1].content;
    expect(body).not.toHaveProperty('cache_control');
    expect(last[last.length - 1].cache_control).toEqual({ type: 'ephemeral' });
    expect(body.anthropic_version).toBe('bedrock-2023-05-31');
  });

  test('a final planner turn reads the earlier transcript back without writing its own', async () => {
    const bedrock = await buildRequest(
      { apiProfileId: 'api-profile', model: 'us.anthropic.claude-sonnet-4-6', systemPrompt: 'Be precise.', conversation, tools, maxTokens: 500, promptCache: { policy: 'transcript', final: true } },
      { database: createDatabase({ provider: 'AWS Bedrock', customConfig: { awsRegion: 'us-east-1', awsAccessKeyId: 'AKIDEXAMPLE', awsSecretAccessKey: 'secret' } }) }
    );
    const anthropic = await buildRequest(
      { apiProfileId: 'api-profile', model: 'claude-sonnet-4-6', conversation, tools, maxTokens: 500, promptCache: { policy: 'transcript', final: true } },
      { database: createDatabase({ provider: 'Anthropic' }) }
    );
    for (const request of [bedrock, anthropic]) {
      const body = JSON.parse(request.requestBodyPayload);
      const marked = body.messages.map((message: any) => (Array.isArray(message.content) ? message.content : [])
        .some((block: any) => block.cache_control));
      expect(body).not.toHaveProperty('cache_control');
      expect(marked.lastIndexOf(true)).toBe(body.messages.length - 3);
      expect(marked.filter(Boolean)).toHaveLength(1);
    }
  });

  test('every provider that can enforce a response schema receives it in its own form', async () => {
    const schema = {
      type: 'object', additionalProperties: false, required: ['score'],
      properties: { score: { type: 'number', minimum: 0, maximum: 1 } }
    };
    const anthropic = JSON.parse((await buildRequest(
      { apiProfileId: 'api-profile', model: 'claude-sonnet-4-6', newPrompt: 'Rate it.', maxTokens: 500, jsonMode: true, jsonSchema: schema },
      { database: createDatabase({ provider: 'Anthropic' }) }
    )).requestBodyPayload);
    expect(anthropic.output_config.format.schema.properties.score).toEqual({ type: 'number' });

    const google = JSON.parse((await buildRequest(
      { apiProfileId: 'api-profile', model: 'gemini-2.5-flash', newPrompt: 'Rate it.', maxTokens: 500, jsonMode: true, jsonSchema: schema },
      { database: createDatabase({ provider: 'Google AI' }) }
    )).requestBodyPayload);
    expect(google.generationConfig.responseMimeType).toBe('application/json');
    expect(google.generationConfig.responseSchema).toEqual({
      type: 'OBJECT', required: ['score'], propertyOrdering: ['score'], properties: { score: { type: 'NUMBER' } }
    });

    const open = JSON.parse((await buildRequest(
      { apiProfileId: 'api-profile', model: 'gemini-2.5-flash', newPrompt: 'Rate it.', maxTokens: 500, jsonMode: true, jsonSchema: { type: 'object', additionalProperties: true } },
      { database: createDatabase({ provider: 'Google AI' }) }
    )).requestBodyPayload);
    expect(open.generationConfig).not.toHaveProperty('responseSchema');
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

describe('payload limit corrected by what the model counts', () => {
  const parts = { apiProfileId: 'api-profile', model: 'gpt-4.1-mini', protocol: 'text' };
  const paragraph = 'The harbour bell rang twice before the ferry left, and nobody on the pier looked up. ';
  const tools = [{ name: 'search_kb', description: 'Searches.', parameters: { type: 'object', properties: {} } }];
  afterEach(() => clearTokenCalibration());

  test('without a measurement the limit is exactly the configured one', async () => {
    const database = createDatabase({ provider: 'OpenAI' });
    expect(resolvePayloadLimit({ ...parts, maxPayloadTokens: 16000 }, { database }))
      .toEqual({ limit: 16000, configured: 16000, ratio: 1, source: 'workspace' });
    const request = await buildRequest({ ...parts, newPrompt: 'Hi', maxTokens: 100, maxPayloadTokens: 16000 }, { database });
    expect(request.payloadLimit).toEqual({ limit: 16000, configured: 16000, ratio: 1, source: 'workspace' });
  });

  test('history sized on the corrected limit passes the final check, and one message more does not', async () => {
    const database = createDatabase({ provider: 'OpenAI' });
    recordTokenCount(parts, 1000, 1500);
    const limit = resolvePayloadLimit({ ...parts, maxPayloadTokens: 16000 }, { database });
    expect(limit.limit).toBe(Math.floor(16000 / 1.5));

    const fixed = { systemPrompt: 'Be precise.', newPrompt: 'Continue.', outputTokens: 1000 };
    const budget = getAvailableHistoryTokens({ ...fixed, maxPayloadTokens: limit.limit });
    const message = paragraph.repeat(20);
    const cost = estimateTokens(message) + PAYLOAD_BUDGET_CONTRACT.messageOverheadTokens;
    const history = Array.from({ length: Math.floor(budget / cost) }, (_, i) => ({ role: i % 2 ? 'ai' : 'user', content: message }));
    const request = { ...parts, systemPrompt: fixed.systemPrompt, newPrompt: fixed.newPrompt, maxTokens: 1000, maxPayloadTokens: 16000 };

    await expect(buildRequest({ ...request, chatHistory: history }, { database })).resolves.toBeTruthy();
    await expect(buildRequest({ ...request, chatHistory: history, payloadLimit: limit }, { database })).resolves.toBeTruthy();

    const overflow = [...history, { role: 'user', content: paragraph.repeat(40) }];
    // Uncorrected, this would still have been sent.
    expect(estimatePayloadTokens({ ...fixed, chatHistory: overflow, maxPayloadTokens: 16000 }).totalTokens).toBeLessThanOrEqual(16000);
    await expect(buildRequest({ ...request, chatHistory: overflow }, { database })).rejects.toThrow(/counts about 1\.50 times/);
  });

  test('a limit the caller already resolved is never corrected a second time', async () => {
    const database = createDatabase({ provider: 'OpenAI' });
    recordTokenCount(parts, 1000, 1500);
    const limit = resolvePayloadLimit({ ...parts, maxPayloadTokens: 16000 }, { database });
    const systemPrompt = paragraph.repeat(Math.floor(9000 / estimateTokens(paragraph)));
    const estimate = estimatePayloadTokens({ systemPrompt, newPrompt: 'Continue.', outputTokens: 500, maxPayloadTokens: limit.limit });
    // Fits the single correction, and would not fit a double one.
    expect(estimate.totalTokens).toBeLessThanOrEqual(limit.limit);
    expect(estimate.totalTokens).toBeGreaterThan(16000 / 1.5 / 1.5);

    const pinned = await buildRequest({ ...parts, systemPrompt, newPrompt: 'Continue.', maxTokens: 500, maxPayloadTokens: 16000, payloadLimit: limit }, { database });
    expect(pinned.payloadLimit).toBe(limit);
    const resolvedInside = await buildRequest({ ...parts, systemPrompt, newPrompt: 'Continue.', maxTokens: 500, maxPayloadTokens: 16000 }, { database });
    expect(resolvedInside.payloadLimit.limit).toBe(limit.limit);
  });

  test('a native tool conversation uses the ratio learned for its own protocol', async () => {
    const database = createDatabase({ provider: 'OpenAI' });
    recordTokenCount({ ...parts, protocol: 'native' }, 1000, 2000);
    const native = await buildRequest({ ...parts, conversation: [{ role: 'user', text: 'Hi' }], tools, maxTokens: 100, maxPayloadTokens: 16000 }, { database });
    const text = await buildRequest({ ...parts, newPrompt: 'Hi', maxTokens: 100, maxPayloadTokens: 16000 }, { database });
    expect(native.payloadLimit).toMatchObject({ limit: 8000, ratio: 2 });
    expect(text.payloadLimit).toMatchObject({ limit: 16000, ratio: 1 });
  });

  test('a local connection window is corrected the same way and the error names the window the user set', async () => {
    const database = createDatabase({ provider: 'Local', baseUrl: 'http://127.0.0.1:1234/v1', apiKey: '', contextWindow: 8192 });
    const local = { apiProfileId: 'api-profile', model: 'qwen3:8b' };
    const systemPrompt = paragraph.repeat(Math.floor(6600 / estimateTokens(paragraph)));
    await expect(buildRequest({ ...local, systemPrompt, newPrompt: 'Continue.', maxTokens: 500, maxPayloadTokens: 128000 }, { database })).resolves.toBeTruthy();

    recordTokenCount(local, 1000, 1300);
    await expect(buildRequest({ ...local, systemPrompt, newPrompt: 'Continue.', maxTokens: 500, maxPayloadTokens: 128000 }, { database }))
      .rejects.toThrow(/context window set on this API connection of 8[,.\s ]?192 tokens\. This model counts about 1\.30 times/);
  });
});

describe('which requests teach the token ratio', () => {
  const longPrompt = 'The tide keeps its own calendar, and the harbour keeps its own debts. '.repeat(60);
  const request = { apiProfileId: 'api-profile', model: 'local-model', systemPrompt: longPrompt, newPrompt: 'Continue.', maxTokens: 200, learnTokenCount: true };
  afterEach(() => clearTokenCalibration());

  test('only the official OpenAI endpoint is asked to stream usage', async () => {
    const body = async (provider: string, baseUrl?: string) => JSON.parse((await buildRequest(
      { ...request, stream: true },
      { database: createDatabase({ provider, baseUrl, apiKey: provider === 'Local' ? '' : 'key' }) }
    )).requestBodyPayload);
    expect((await body('OpenAI', '')).stream_options).toEqual({ include_usage: true });
    expect(await body('OpenAI', 'https://proxy.example.test/v1')).not.toHaveProperty('stream_options');
    expect(await body('OpenRouter', '')).not.toHaveProperty('stream_options');
    expect(await body('Local', 'http://127.0.0.1:1234/v1')).not.toHaveProperty('stream_options');
    expect((await buildRequest({ ...request }, { database: createDatabase({ provider: 'OpenAI', baseUrl: '' }) })).requestBodyPayload).not.toMatch(/stream_options/);
  });

  test('images, Manual JSON, schemas and callers that did not ask produce no sample', async () => {
    const database = createDatabase({ provider: 'Local', baseUrl: 'http://127.0.0.1:1234/v1', apiKey: '' });
    const sample = async (extra: Record<string, unknown>) => (await buildRequest({ ...request, ...extra }, { database })).tokenSample;
    expect(await sample({})).toMatchObject({ parts: { apiProfileId: 'api-profile', model: 'local-model', protocol: 'text' } });
    expect((await sample({})).inputTokens).toBe(estimatePayloadTokens({ systemPrompt: longPrompt, newPrompt: 'Continue.' }).inputTokens);
    expect(await sample({ attachedImages: [{ name: 'map.png', path: 'map.png' }] })).toBeNull();
    expect(await sample({ manualMode: true, manualJson: '{"top_p":0.9}' })).toBeNull();
    expect(await sample({ jsonMode: true })).toBeNull();
    expect(await sample({ learnTokenCount: false })).toBeNull();
    expect(await sample({ manualMode: true, manualJson: '   ' })).not.toBeNull();
  });

  test('a count that fills the declared window may be truncated, so it is not trusted', () => {
    const sample = { parts: { apiProfileId: 'c', model: 'm', protocol: 'text' }, inputTokens: 1000, contextWindow: 8192, outputTokens: 1000 };
    expect(learnFromReportedTokens(sample, 7000)).toBeNull();
    expect(measuredRatio(sample.parts)).toBeNull();
    expect(learnFromReportedTokens(sample, 1400)).toBeCloseTo(1.4, 5);
    expect(learnFromReportedTokens({ ...sample, contextWindow: null }, 9000)).toBe(3);
    expect(learnFromReportedTokens(null, 1400)).toBeNull();
  });

  test('stream chunks carry the input count in every provider format', () => {
    expect(parseStreamChunk({ choices: [], usage: { prompt_tokens: 812, completion_tokens: 9 } }, 'openai').inputTokens).toBe(812);
    const llamaCpp = parseStreamChunk({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 640 } }, 'local');
    expect(llamaCpp).toMatchObject({ inputTokens: 640, finishReason: 'stop' });
    expect(parseStreamChunk({ choices: [{ delta: { content: 'Hi' } }] }, 'openrouter').inputTokens).toBeNull();
    expect(parseStreamChunk({
      type: 'message_start',
      message: { usage: { input_tokens: 25, cache_read_input_tokens: 700, cache_creation_input_tokens: 100, output_tokens: 1 } }
    }, 'anthropic').inputTokens).toBe(825);
    expect(parseStreamChunk({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 15 } }, 'anthropic').inputTokens).toBeNull();
    expect(parseStreamChunk({
      type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 10682, cache_read_input_tokens: 0, output_tokens: 510 }
    }, 'anthropic').inputTokens).toBe(10682);
    expect(parseStreamChunk({ candidates: [{ content: { parts: [{ text: 'A' }] } }], usageMetadata: { promptTokenCount: 930 } }, 'vertex ai').inputTokens).toBe(930);
    expect(parseStreamChunk({ usageMetadata: { promptTokenCount: 930 } }, 'google ai').inputTokens).toBe(930);
  });
});
