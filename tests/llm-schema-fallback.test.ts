import { createRequire } from 'node:module';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, beforeEach, describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { sendApiRequest } = require('../src/main/features/llm/llm.service');

let server: http.Server;
let origin = '';
let bodies: any[] = [];

// Refuses any request that carries a response schema, whatever the wording, and answers the rest.
beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      const body = raw ? JSON.parse(raw) : {};
      bodies.push(body);
      const schema = body.output_config || body.generationConfig?.responseSchema || body.response_format;
      const longCache = raw.includes('"ttl":"1h"');
      const refused = (req.url?.startsWith('/refuse') && schema) || (req.url?.startsWith('/no-long-cache') && longCache);
      const grammarFailed = req.url?.startsWith('/grammar-fails') && schema;
      res.writeHead(refused ? 400 : grammarFailed ? 500 : 200, { 'Content-Type': 'application/json' });
      const openAi = req.url?.includes('/chat/completions');
      res.end(JSON.stringify(refused || grammarFailed
        ? { error: { message: 'This schema shape is not accepted here.' } }
        : openAi
          ? { choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 3 } }
          : { content: [{ type: 'text', text: '{"ok":true}' }], stop_reason: 'end_turn', usage: { input_tokens: 10, output_tokens: 3 } }));
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections?.();
  server.close();
});

beforeEach(() => { bodies = []; });

function database(path: string, provider = 'Anthropic') {
  const profile = { id: 'conn', provider, apiKey: 'key', baseUrl: `${origin}${path}`, customConfig: null, contextWindow: null };
  return {
    prepare(query: string) {
      if (query.includes('FROM variables')) return { all: () => [] };
      if (query.includes('FROM api_profiles')) return { get: () => profile };
      throw new Error(`Unexpected query: ${query}`);
    },
    decryptApiKey: (value: string) => value
  };
}

const schema = { type: 'object', additionalProperties: false, properties: { ok: { type: 'boolean' } } };

describe('a refused response schema', () => {
  test('is retried without the schema, then not offered again', async () => {
    const db = database('/refuse/v1/messages');
    const events: unknown[] = [];
    const request = { apiProfileId: 'conn', model: 'claude-refusal-test', newPrompt: 'Check.', maxTokens: 100, jsonMode: true, jsonSchema: schema, onStructuredFallback: (event: unknown) => events.push(event) };

    expect(await sendApiRequest(request, { database: db })).toBe('{"ok":true}');
    expect(bodies.map(body => Boolean(body.output_config))).toEqual([true, false]);

    expect(await sendApiRequest(request, { database: db })).toBe('{"ok":true}');
    expect(bodies.map(body => Boolean(body.output_config))).toEqual([true, false, false]);
    expect(events).toEqual([
      { remembered: false, reason: expect.stringContaining('not accepted') },
      { remembered: true }
    ]);
  });

  test('keeps the schema where the provider accepts it', async () => {
    const db = database('/accept/v1/messages');
    await sendApiRequest({ apiProfileId: 'conn', model: 'claude-accept-test', newPrompt: 'Check.', maxTokens: 100, jsonMode: true, jsonSchema: schema }, { database: db });
    expect(bodies).toHaveLength(1);
    expect(bodies[0].output_config.format.type).toBe('json_schema');
  });
});

describe('a local server', () => {
  test('receives the schema as a response format', async () => {
    const db = database('/accept/v1', 'Local');
    await sendApiRequest({ apiProfileId: 'conn', model: 'local-accept', newPrompt: 'Check.', maxTokens: 100, jsonMode: true, jsonSchema: schema }, { database: db });
    expect(bodies[0].response_format).toEqual({ type: 'json_schema', json_schema: { name: 'kallamo_structured_response', strict: false, schema } });
  });

  test('that refuses it is asked again with no format at all', async () => {
    const db = database('/refuse/v1', 'Local');
    const events: unknown[] = [];
    const request = { apiProfileId: 'conn', model: 'local-refusal', newPrompt: 'Check.', maxTokens: 100, jsonMode: true, jsonSchema: schema, onStructuredFallback: (event: unknown) => events.push(event) };
    expect(await sendApiRequest(request, { database: db })).toBe('{"ok":true}');
    expect(bodies.map(body => Boolean(body.response_format))).toEqual([true, false]);
    expect(events).toEqual([{ remembered: false, reason: expect.stringContaining('not accepted') }]);
  });

  test('whose grammar fails with a server error is asked again without the schema', async () => {
    const db = database('/grammar-fails/v1', 'Local');
    const request = { apiProfileId: 'conn', model: 'local-grammar', newPrompt: 'Check.', maxTokens: 100, jsonMode: true, jsonSchema: schema };
    expect(await sendApiRequest(request, { database: db })).toBe('{"ok":true}');
    expect(bodies.map(body => Boolean(body.response_format))).toEqual([true, false]);
  });
});

describe('a refused hour-long cache', () => {
  test('is retried with five minutes, then not offered again', async () => {
    const db = database('/no-long-cache/v1/messages');
    const stable = `Stable narration. ${'reference '.repeat(600)}`;
    const volatile = ' Volatile.';
    const request = {
      apiProfileId: 'conn', model: 'claude-no-long-cache', systemPrompt: `${stable}${volatile}`, newPrompt: 'Continue.', maxTokens: 100,
      promptCache: { policy: 'conversation', placement: 'system', scopeId: 'lifetime', stable, volatile, ttl: '1h' }
    };
    const lifetimes = () => bodies.map(body => JSON.stringify(body).includes('"ttl":"1h"') ? '1h' : '5m');

    expect(await sendApiRequest(request, { database: db })).toBe('{"ok":true}');
    expect(lifetimes()).toEqual(['1h', '5m']);
    await sendApiRequest(request, { database: db });
    expect(lifetimes()).toEqual(['1h', '5m', '5m']);
  });
});
