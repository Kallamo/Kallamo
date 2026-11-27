import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { listProviderModels, modelsUrl } = require('../src/main/features/llm/provider-models.js');

const reply = (status: number, body: unknown) => async () => ({ ok: status < 400, status, json: async () => body });

describe('provider model lists', () => {
  test('reads the list next to the saved endpoint or the provider default', () => {
    expect(modelsUrl('local', 'http://127.0.0.1:1234/v1/')).toBe('http://127.0.0.1:1234/v1/models');
    expect(modelsUrl('local', 'http://127.0.0.1:1234/v1/chat/completions')).toBe('http://127.0.0.1:1234/v1/models');
    expect(modelsUrl('openrouter', '')).toBe('https://openrouter.ai/api/v1/models');
    expect(() => modelsUrl('local', '')).toThrow(/base URL/);
  });

  test('returns sorted ids without duplicates and sends the key', async () => {
    let sent: any;
    const fetchImpl = async (url: string, init: any) => { sent = { url, init }; return reply(200, { data: [{ id: 'b' }, { id: 'a' }, { id: 'b' }] })(); };
    await expect(listProviderModels({ provider: 'OpenAI', apiKey: 'k' }, fetchImpl)).resolves.toEqual(['a', 'b']);
    expect(sent.init.headers.Authorization).toBe('Bearer k');
  });

  test('reads Anthropic and Google lists across pages', async () => {
    const anthropicPages = [{ data: [{ id: 'claude-b' }], has_more: true, last_id: 'claude-b' }, { data: [{ id: 'claude-a' }], has_more: false }];
    const anthropicUrls: string[] = [];
    const anthropic = async (url: string, init: any) => { anthropicUrls.push(url); expect(init.headers['x-api-key']).toBe('k'); return reply(200, anthropicPages.shift())(); };
    await expect(listProviderModels({ provider: 'Anthropic', apiKey: 'k' }, anthropic)).resolves.toEqual(['claude-a', 'claude-b']);
    expect(anthropicUrls[1]).toContain('after_id=claude-b');

    const google = reply(200, { models: [
      { name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/aqa', supportedGenerationMethods: ['generateAnswer'] }
    ] });
    await expect(listProviderModels({ provider: 'Google AI', apiKey: 'k', baseUrl: 'https://x/v1beta/models/m:generateContent' }, google)).resolves.toEqual(['gemini-2.5-flash']);
    await expect(listProviderModels({ provider: 'Google AI' }, google)).rejects.toThrow(/API key first/);
  });

  test('explains a refused key, an unreachable server and other providers', async () => {
    await expect(listProviderModels({ provider: 'OpenRouter', apiKey: 'x' }, reply(401, {}))).rejects.toThrow(/key was refused/);
    await expect(listProviderModels({ provider: 'Local', baseUrl: 'http://127.0.0.1:9/v1' }, async () => { throw new TypeError('fetch failed'); })).rejects.toThrow(/Could not reach/);
    await expect(listProviderModels({ provider: 'AWS Bedrock' })).rejects.toThrow(/does not list/);
  });
});
