import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const {
  detectedContextWindow,
  detectedContextWindows,
  probeContextWindow,
  refreshContextWindow,
  serverRoot
} = require('../src/main/features/llm/local-context-window');
const { payloadLimitFor } = require('../src/main/features/llm/llm.service');

// Answers only the endpoints given, as one server family would, and refuses everything else.
function server(routes: Record<string, unknown>) {
  const asked: string[] = [];
  const fetchImpl = async (url: string) => {
    const path = new URL(url).pathname;
    asked.push(path);
    if (!(path in routes)) return { ok: false, json: async () => ({}) };
    return { ok: true, json: async () => routes[path] };
  };
  return { fetchImpl, asked };
}

describe('the server root', () => {
  test('drops the OpenAI-compatible path, whatever part of it was given', () => {
    expect(serverRoot('http://127.0.0.1:5001/v1')).toBe('http://127.0.0.1:5001');
    expect(serverRoot('http://localhost:1234/v1/chat/completions')).toBe('http://localhost:1234');
    expect(serverRoot('http://localhost:8080')).toBe('http://localhost:8080');
    expect(serverRoot('not a url')).toBeNull();
  });
});

describe('each local server reports its context size', () => {
  test('KoboldCpp', async () => {
    const { fetchImpl } = server({ '/api/extra/true_max_context_length': { value: 32768 } });
    expect(await probeContextWindow({ baseUrl: 'http://127.0.0.1:5001/v1', model: 'koboldcpp/Wicked-Tutu' }, fetchImpl))
      .toEqual({ window: 32768, perModel: false });
  });

  test('llama.cpp, per slot', async () => {
    const { fetchImpl } = server({ '/props': { default_generation_settings: { n_ctx: 16384 } } });
    expect(await probeContextWindow({ baseUrl: 'http://localhost:8080/v1', model: 'any' }, fetchImpl))
      .toEqual({ window: 16384, perModel: false });
  });

  test('LM Studio, for the loaded model that was named', async () => {
    const { fetchImpl } = server({
      '/api/v0/models': { data: [
        { id: 'qwen3-8b', state: 'loaded', loaded_context_length: 8192 },
        { id: 'gemma-3-12b', state: 'loaded', loaded_context_length: 24576 },
        { id: 'llama-3.1-8b', state: 'not-loaded', max_context_length: 131072 }
      ] }
    });
    expect(await probeContextWindow({ baseUrl: 'http://localhost:1234/v1', model: 'gemma-3-12b' }, fetchImpl))
      .toEqual({ window: 24576, perModel: true });
  });

  test('Ollama, for a model already loaded, with or without its tag', async () => {
    const { fetchImpl } = server({ '/api/ps': { models: [{ name: 'qwen3:latest', model: 'qwen3:latest', context_length: 4096 }] } });
    expect(await probeContextWindow({ baseUrl: 'http://localhost:11434/v1', model: 'qwen3' }, fetchImpl))
      .toEqual({ window: 4096, perModel: true });
  });

  test('a server that says nothing, or nothing listening, gives no size', async () => {
    expect(await probeContextWindow({ baseUrl: 'http://localhost:9999/v1', model: 'x' }, server({}).fetchImpl)).toBeNull();
    const refused = async () => { throw new Error('ECONNREFUSED'); };
    expect(await probeContextWindow({ baseUrl: 'http://localhost:9999/v1', model: 'x' }, refused)).toBeNull();
  });
});

describe('a detected size', () => {
  const profile = { id: 'kobold', provider: 'Local', baseUrl: 'http://127.0.0.1:5001/v1', models: '["wicked-tutu"]', contextWindow: null };

  test('limits requests the way a connection window does, below the workspace limit', async () => {
    await refreshContextWindow(profile, server({ '/api/extra/true_max_context_length': { value: 32768 } }).fetchImpl, { force: true });
    expect(detectedContextWindow('kobold', 'wicked-tutu')).toBe(32768);
    expect(detectedContextWindows()).toMatchObject({ kobold: 32768 });

    const limit = payloadLimitFor(profile, 128000, { model: 'wicked-tutu' });
    expect(limit).toMatchObject({ configured: 32768, source: 'connection' });
  });

  test('gives way to a window the user set on the connection', () => {
    expect(payloadLimitFor({ ...profile, contextWindow: 16000 }, 128000, { model: 'wicked-tutu' })).toMatchObject({ configured: 16000 });
  });

  test('is forgotten once the server stops reporting it', async () => {
    await refreshContextWindow(profile, server({}).fetchImpl, { force: true });
    expect(detectedContextWindow('kobold', 'wicked-tutu')).toBeNull();
  });

  test('is never looked for on a hosted connection', async () => {
    const { fetchImpl, asked } = server({ '/props': { n_ctx: 8192 } });
    await refreshContextWindow({ id: 'openai', provider: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: '["gpt-5"]' }, fetchImpl, { force: true });
    expect(asked).toEqual([]);
    expect(detectedContextWindow('openai', 'gpt-5')).toBeNull();
  });
});
