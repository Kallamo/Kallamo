import { createRequire } from 'node:module';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { sendApiRequest, describeConnectionFailure, isConnectionFailure } = require('../src/main/features/llm/llm.service');

let server: http.Server;
let origin = '';

// Drops the connection without answering, or answers with an HTTP error.
beforeAll(async () => {
  server = http.createServer((req, res) => {
    if (req.url?.startsWith('/drop')) {
      req.socket.destroy();
      return;
    }
    res.writeHead(500, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: { message: 'The provider is overloaded.' } }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => {
  server.closeAllConnections?.();
  server.close();
});

function database(path: string) {
  const profile = { id: 'conn', provider: 'Anthropic', apiKey: 'key', baseUrl: `${origin}${path}`, customConfig: null, contextWindow: null };
  return {
    prepare(query: string) {
      if (query.includes('FROM variables')) return { all: () => [] };
      if (query.includes('FROM api_profiles')) return { get: () => profile };
      throw new Error(`Unexpected query: ${query}`);
    },
    decryptApiKey: (value: string) => value
  };
}

const request = { apiProfileId: 'conn', model: 'claude-connection-test', newPrompt: 'Check.', maxTokens: 100 };

describe('a dropped connection', () => {
  test('names its cause and is marked as a network failure', async () => {
    const failure = await sendApiRequest(request, { database: database('/drop/v1/messages') }).catch((error: Error) => error);
    expect(isConnectionFailure(failure)).toBe(true);
    expect(failure.message).toMatch(/^fetch failed \(.+\)$/);
  });

  test('is told apart from an answer the provider refused', async () => {
    const failure = await sendApiRequest(request, { database: database('/overloaded/v1/messages') }).catch((error: Error) => error);
    expect(isConnectionFailure(failure)).toBe(false);
    expect(failure.message).toContain('overloaded');
  });

  test('keeps other errors as they were', () => {
    const error = new Error('Payload too large.');
    expect(describeConnectionFailure(error)).toBe(error);
    const bare = describeConnectionFailure(new TypeError('fetch failed'));
    expect(bare.message).toBe('fetch failed');
    expect(isConnectionFailure(bare)).toBe(true);
  });
});
