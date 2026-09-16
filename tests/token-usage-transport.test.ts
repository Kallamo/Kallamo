import { createRequire } from 'node:module';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, afterEach, beforeAll, describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { buildRequest, sendAgentRequest, sendApiRequest } = require('../src/main/features/llm/llm.service');
const { sendApiRequestStream } = require('../src/main/features/llm/llm.stream');
const { clearTokenCalibration, measuredRatio } = require('../src/main/features/llm/token-calibration');

let server: http.Server;
let origin = '';
let reported = 0;
let lastBody: any = null;

function sse(res: http.ServerResponse, events: unknown[], done = false) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  for (const event of events) res.write(`data: ${JSON.stringify(event)}\n\n`);
  if (done) res.write('data: [DONE]\n\n');
  res.end();
}

function json(res: http.ServerResponse, body: unknown, status = 200) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

// Replies shaped like each provider's documented usage contract.
function respond(url: string, body: any, res: http.ServerResponse) {
  if (url.startsWith('/fail')) return json(res, { error: { message: 'boom' } }, 500);
  if (url.startsWith('/openai-error')) {
    return sse(res, [{ choices: [{ delta: { content: 'Hi' } }] }, { error: { message: 'overloaded' } }]);
  }
  if (url.startsWith('/openai')) {
    const usage = { prompt_tokens: reported, completion_tokens: 1 };
    if (body.stream) {
      // llama.cpp style: usage rides on the last choice, without being asked for.
      return sse(res, [{ choices: [{ delta: { content: 'Hi' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }], usage }], true);
    }
    return json(res, { choices: [{ message: { content: 'Hi' }, finish_reason: 'stop' }], usage });
  }
  if (url.startsWith('/anthropic')) {
    const usage = { input_tokens: reported - 300, cache_read_input_tokens: 200, cache_creation_input_tokens: 100 };
    if (body.stream) {
      return sse(res, [
        { type: 'message_start', message: { usage: { ...usage, output_tokens: 1 } } },
        { type: 'content_block_delta', delta: { type: 'text_delta', text: 'Hi' } },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
        { type: 'message_stop' }
      ]);
    }
    return json(res, { content: [{ type: 'text', text: 'Hi' }], stop_reason: 'end_turn', usage: { ...usage, output_tokens: 2 } });
  }
  if (url.startsWith('/google-blocked')) {
    return json(res, { candidates: [{ finishReason: 'SAFETY' }], usageMetadata: { promptTokenCount: 5000 } });
  }
  if (url.startsWith('/google')) {
    if (url.includes(':streamGenerateContent')) {
      return sse(res, [
        { candidates: [{ content: { parts: [{ text: 'Hi' }] } }], usageMetadata: { promptTokenCount: reported } },
        { candidates: [{ content: { parts: [{ text: '' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: reported, candidatesTokenCount: 1 } }
      ]);
    }
    return json(res, { candidates: [{ content: { parts: [{ text: 'Hi' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: reported } });
  }
  return json(res, { error: { message: `unexpected ${url}` } }, 404);
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      lastBody = raw ? JSON.parse(raw) : {};
      respond(req.url || '', lastBody, res);
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections?.();
  server.close();
});

afterEach(() => clearTokenCalibration());

function database(provider: string, path: string, contextWindow: number | null = null) {
  const profile = { id: 'conn', provider, apiKey: 'key', baseUrl: `${origin}${path}`, customConfig: null, contextWindow };
  return {
    prepare(query: string) {
      if (query.includes('FROM variables')) return { all: () => [] };
      if (query.includes('FROM api_profiles')) return { get: () => profile };
      throw new Error(`Unexpected query: ${query}`);
    },
    decryptApiKey: (value: string) => value
  };
}

const text = { apiProfileId: 'conn', model: 'm', protocol: 'text' };
const params = {
  apiProfileId: 'conn',
  model: 'm',
  systemPrompt: 'The tide keeps its own calendar, and the harbour keeps its own debts. '.repeat(60),
  newPrompt: 'Continue.',
  maxTokens: 200,
  maxPayloadTokens: 128000,
  learnTokenCount: true,
  includeResponseMetadata: true
};

async function estimatedInput(db: unknown, request: Record<string, unknown> = params) {
  return (await buildRequest(request, { database: db })).tokenSample.inputTokens;
}

const providers: Array<[string, string]> = [
  ['Local', '/openai/v1'],
  ['Anthropic', '/anthropic/v1/messages'],
  ['Google AI', '/google/models/m:generateContent']
];

describe('the chat learns what each provider really counted', () => {
  for (const [provider, path] of providers) {
    for (const streaming of [false, true]) {
      test(`${provider}, ${streaming ? 'streaming' : 'non-streaming'}`, async () => {
        const db = database(provider, path);
        const estimate = await estimatedInput(db);
        reported = Math.round(estimate * 1.4);
        const result = streaming
          ? await sendApiRequestStream(params, () => {}, () => {}, { database: db })
          : await sendApiRequest(params, { database: db });
        expect(result.content).toBe('Hi');
        expect(result.learnedTokenRatio).toBeCloseTo(reported / estimate, 5);
        expect(measuredRatio(text)).toBeCloseTo(reported / estimate, 5);
        if (streaming) expect(lastBody).not.toHaveProperty('stream_options');
      });
    }
  }

  test('the retrieval planner learns under the native protocol when it sends tools', async () => {
    const db = database('Local', '/openai/v1');
    const request = {
      ...params,
      conversation: [{ role: 'user', text: params.systemPrompt }],
      tools: [{ name: 'search_kb', description: 'Searches.', parameters: { type: 'object', properties: {} } }]
    };
    const estimate = await estimatedInput(db, request);
    reported = Math.round(estimate * 1.25);
    const reply = await sendAgentRequest(request, { database: db });
    expect(reply.learnedTokenRatio).toBeCloseTo(1.25, 2);
    expect(measuredRatio({ ...text, protocol: 'native' })).toBeCloseTo(1.25, 2);
    expect(measuredRatio(text)).toBeNull();
  });
});

describe('replies that must not teach the ratio', () => {
  test('an HTTP error', async () => {
    await expect(sendApiRequest(params, { database: database('Local', '/fail/v1') })).rejects.toThrow(/boom/);
    expect(measuredRatio(text)).toBeNull();
  });

  test('a reply the provider withheld, even when it reports usage', async () => {
    await expect(sendApiRequest(params, { database: database('Google AI', '/google-blocked/m:generateContent') })).rejects.toThrow(/SAFETY/);
    expect(measuredRatio(text)).toBeNull();
  });

  test('a stream that ends in a provider error', async () => {
    await expect(sendApiRequestStream(params, () => {}, () => {}, { database: database('Local', '/openai-error/v1') })).rejects.toThrow(/overloaded/);
    expect(measuredRatio(text)).toBeNull();
  });

  test('a request with Manual JSON, or a caller that did not ask to learn', async () => {
    const db = database('Local', '/openai/v1');
    reported = 5000;
    expect((await sendApiRequest({ ...params, manualMode: true, manualJson: '{"top_p":0.9}' }, { database: db })).learnedTokenRatio).toBeNull();
    expect((await sendApiRequest({ ...params, learnTokenCount: false }, { database: db })).learnedTokenRatio).toBeNull();
    expect(measuredRatio(text)).toBeNull();
  });

  test('a count that fills the connection window', async () => {
    const db = database('Local', '/openai/v1', 4096);
    reported = 3800;
    expect((await sendApiRequest(params, { database: db })).learnedTokenRatio).toBeNull();
    expect(measuredRatio(text)).toBeNull();
  });
});
