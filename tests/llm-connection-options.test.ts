import { createRequire } from 'node:module';
import { afterEach, describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { buildRequest, providerOutputLimit } = require('../src/main/features/llm/llm.service');
const {
  cutAtTurnMarker,
  learnReasoningModel,
  parseExtraHeaders,
  resetLearnedReasoning,
  spentOnReasoning
} = require('../src/main/features/llm/connection-options');

function createDatabase(provider: string, customConfig: Record<string, string> = {}) {
  const profile = { id: 'api-profile', provider, apiKey: 'key', baseUrl: 'http://127.0.0.1:1234/v1', customConfig: JSON.stringify(customConfig), contextWindow: 32000 };
  return {
    prepare(query: string) {
      if (query.includes('FROM variables')) return { all: () => [] };
      if (query.includes('FROM api_profiles')) return { get: () => profile };
      throw new Error(`Unexpected query: ${query}`);
    },
    decryptApiKey: (value: string) => value
  };
}

const request = (provider: string, customConfig: Record<string, string> = {}, extra: Record<string, unknown> = {}) => buildRequest({
  apiProfileId: 'api-profile', model: 'my-model', systemPrompt: 'System.', newPrompt: 'Hello', maxTokens: 1000, ...extra
}, { database: createDatabase(provider, customConfig) });

afterEach(() => resetLearnedReasoning());

describe('extra headers', () => {
  test('reads Name: value lines and skips comments, bad lines and reserved names', () => {
    expect(parseExtraHeaders('X-One: a\n# note\n\nbroken line\nAuthorization: Bearer x\nContent-Type: text/plain\nX-Two:  b c ')).toEqual({ 'X-One': 'a', 'X-Two': 'b c' });
  });

  test('{session} becomes a stable hash of the conversation, and is left out without one', () => {
    const first = parseExtraHeaders('x-opencode-session: {session}', { sessionKey: 'chat::profile' });
    expect(first['x-opencode-session']).toMatch(/^[0-9a-f]{32}$/);
    expect(parseExtraHeaders('x-opencode-session: {session}', { sessionKey: 'chat::profile' })).toEqual(first);
    expect(first['x-opencode-session']).not.toContain('chat');
    expect(parseExtraHeaders('x-opencode-session: {session}')).toEqual({});
  });

  test('requests carry them after the defaults, with Kallamo as the user agent', async () => {
    const built = await request('OpenRouter', { extraHeaders: 'User-Agent: my-client/1\nX-Route: fast' });
    expect(built.requestHeaders).toMatchObject({ 'User-Agent': 'my-client/1', 'X-Route': 'fast', Authorization: 'Bearer key' });
    const plain = await request('OpenAI');
    expect(plain.requestHeaders['User-Agent']).toMatch(/^Kallamo\//);
  });
});

describe('local turn markers', () => {
  test('local chat requests send stop sequences, JSON requests do not', async () => {
    expect(JSON.parse((await request('Local')).requestBodyPayload).stop).toEqual(['\nHuman:', '\nUser:', '\n[User]']);
    expect(JSON.parse((await request('Local', {}, { jsonMode: true })).requestBodyPayload).stop).toBeUndefined();
    expect(JSON.parse((await request('OpenRouter')).requestBodyPayload).stop).toBeUndefined();
  });

  test('a reply is cut where the model starts the next turn', () => {
    expect(cutAtTurnMarker('She nods.\nHuman: what now?\nAI: ...')).toBe('She nods.');
    expect(cutAtTurnMarker('The user: a word mid-line stays.')).toBe('The user: a word mid-line stays.');
  });
});

describe('thinking models', () => {
  test('the connection setting overrides the name', () => {
    expect(providerOutputLimit('Local', 'my-model', 2048, { reasoning: 'always' })).toBe(2048 + 8192);
    expect(providerOutputLimit('Local', 'qwen3:8b', 2048, { reasoning: 'never' })).toBe(2048);
    expect(providerOutputLimit('Local', 'my-model', 2048, { learned: true })).toBe(2048 + 8192);
    expect(providerOutputLimit('Local', 'my-model', 2048)).toBe(2048);
  });

  test('a reply that ran out while reasoning is recognized, inline or in its own field', () => {
    expect(spentOnReasoning({ choices: [{ message: { content: '', reasoning_content: 'thinking...' } }] })).toBe(true);
    expect(spentOnReasoning({ choices: [{ message: { content: '<think>still going' } }] })).toBe(true);
    expect(spentOnReasoning({ choices: [{ message: { content: '<think>done</think>{"a":1}' } }] })).toBe(false);
  });

  test('a learned model gets the headroom and is no longer retried', async () => {
    const before = await request('Local');
    expect(before.reasoningRetry).toBe(true);
    learnReasoningModel('api-profile', 'my-model');
    const after = await request('Local');
    expect(JSON.parse(after.requestBodyPayload).max_tokens).toBe(1000 + 8192);
    expect(after.reasoningRetry).toBe(false);
    expect((await request('Local', { reasoning: 'never' })).reasoningRetry).toBe(false);
  });
});
