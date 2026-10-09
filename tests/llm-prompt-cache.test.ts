import { createRequire } from 'node:module';
import { beforeEach, describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { buildRequest } = require('../src/main/features/llm/llm.service');
const {
  PROMPT_CACHE_CONTRACT,
  cacheTtlForPace,
  markLongTtlRefused,
  planPromptCache,
  readHistoryAnchor,
  recordCacheOutcome,
  resetAllScopes,
  writeHistoryAnchor
} = require('../src/main/features/llm/prompt-cache');

function createDatabase(provider: string) {
  const profile = {
    id: 'api-profile',
    provider,
    apiKey: 'encrypted-api-key',
    baseUrl: '',
    customConfig: null
  };
  return {
    prepare(query: string) {
      if (query.includes('FROM variables')) return { all: () => [] };
      if (query.includes('FROM api_profiles')) {
        return { get: (id: string) => (id === profile.id ? profile : undefined) };
      }
      throw new Error(`Unexpected query: ${query}`);
    },
    decryptApiKey() {
      return 'api-key';
    }
  };
}

// Comfortably past the minimum cacheable prefix so a breakpoint is not skipped
// for being too short.
const STABLE = `Stable narration instructions. ${'reference material '.repeat(400)}`;
const VOLATILE = '\n\n--- ROLEPLAY TIME ---\nCurrent narrative date: day 4\n--- END ROLEPLAY TIME ---';

beforeEach(() => {
  resetAllScopes();
});

describe('prompt cache planning', () => {
  test('never marks a request that is not part of a conversation', () => {
    const plan = planPromptCache({
      provider: 'Anthropic',
      model: 'claude-opus-5',
      policy: 'none',
      stableText: STABLE
    });
    expect(plan).toMatchObject({ systemBreakpoint: false, historyBreakpoint: false, reason: 'policy-off' });
  });

  test('leaves providers that cache automatically untouched', () => {
    expect(planPromptCache({
      provider: 'OpenAI',
      model: 'gpt-5',
      policy: 'conversation',
      stableText: STABLE
    })).toMatchObject({ style: null, reason: 'provider-automatic' });

    expect(planPromptCache({
      provider: 'OpenRouter',
      model: 'openai/gpt-5',
      policy: 'conversation',
      stableText: STABLE
    })).toMatchObject({ style: null, reason: 'provider-automatic' });
  });

  test('marks the system prefix but refuses a history breakpoint while the context still leads', () => {
    const plan = planPromptCache({
      provider: 'Anthropic',
      model: 'claude-opus-5',
      policy: 'conversation',
      placement: 'system',
      stableText: STABLE,
      historyChars: 40000,
      historyLength: 20
    });
    // A history breakpoint under 'system' placement would be written every turn
    // and never read, because the volatile context precedes the history.
    expect(plan).toMatchObject({ systemBreakpoint: true, historyBreakpoint: false });
  });

  test('marks the history once the volatile context moves behind it', () => {
    const plan = planPromptCache({
      provider: 'Anthropic',
      model: 'claude-opus-5',
      policy: 'conversation',
      placement: 'turn',
      stableText: STABLE,
      historyChars: 40000,
      historyLength: 20
    });
    expect(plan).toMatchObject({ systemBreakpoint: true, historyBreakpoint: true });
  });

  test('skips a prefix too short for the provider to cache', () => {
    expect(planPromptCache({
      provider: 'Anthropic',
      model: 'claude-opus-5',
      policy: 'conversation',
      stableText: 'short'
    })).toMatchObject({ systemBreakpoint: false, reason: 'prefix-too-short' });
  });

  test('cools a scope down after repeated writes that were never read back', () => {
    const scopeId = 'chat::profile';
    const request = () => planPromptCache({
      provider: 'Anthropic',
      model: 'claude-opus-5',
      policy: 'conversation',
      scopeId,
      stableText: STABLE
    });

    for (let attempt = 0; attempt < PROMPT_CACHE_CONTRACT.missesBeforeCooldown; attempt++) {
      expect(request().systemBreakpoint).toBe(true);
      recordCacheOutcome(scopeId, { cacheReadTokens: 0, cacheWriteTokens: 3000 });
    }

    expect(request()).toMatchObject({ systemBreakpoint: false, reason: 'cooldown' });
  });

  test('a read clears the miss streak', () => {
    const scopeId = 'chat::profile';
    recordCacheOutcome(scopeId, { cacheReadTokens: 0, cacheWriteTokens: 3000 });
    recordCacheOutcome(scopeId, { cacheReadTokens: 0, cacheWriteTokens: 3000 });
    recordCacheOutcome(scopeId, { cacheReadTokens: 3000, cacheWriteTokens: 0 });
    recordCacheOutcome(scopeId, { cacheReadTokens: 0, cacheWriteTokens: 3000 });

    expect(planPromptCache({
      provider: 'Anthropic',
      model: 'claude-opus-5',
      policy: 'conversation',
      scopeId,
      stableText: STABLE
    }).systemBreakpoint).toBe(true);
  });

  test('history anchors are per scope and survive until replaced', () => {
    writeHistoryAnchor('chat-a', 'msg_10');
    expect(readHistoryAnchor('chat-a')).toBe('msg_10');
    expect(readHistoryAnchor('chat-b')).toBe(null);
  });
});

describe('prompt cache request composition', () => {
  test('Anthropic keeps a plain system prompt when nothing opts in', async () => {
    const request = await buildRequest({
      apiProfileId: 'api-profile',
      model: 'claude-opus-5',
      systemPrompt: `${STABLE}${VOLATILE}`,
      chatHistory: [{ role: 'user', content: 'Earlier turn' }],
      newPrompt: 'Continue.'
    }, { database: createDatabase('Anthropic') });

    const body = JSON.parse(request.requestBodyPayload);
    expect(body.system).toBe(`${STABLE}${VOLATILE}`);
    expect(body.messages[0].content).toBe('Earlier turn');
  });

  test('system placement splits the prompt into a cached head and an unmarked tail', async () => {
    const request = await buildRequest({
      apiProfileId: 'api-profile',
      model: 'claude-opus-5',
      systemPrompt: `${STABLE}${VOLATILE}`,
      chatHistory: [{ role: 'user', content: 'Earlier turn' }],
      newPrompt: 'Continue.',
      promptCache: {
        policy: 'conversation',
        placement: 'system',
        scopeId: 'chat::profile',
        stable: STABLE,
        volatile: VOLATILE
      }
    }, { database: createDatabase('Anthropic') });

    const body = JSON.parse(request.requestBodyPayload);
    expect(body.system).toEqual([
      { type: 'text', text: STABLE, cache_control: { type: 'ephemeral' } },
      { type: 'text', text: VOLATILE }
    ]);
    // The two blocks still concatenate to exactly the prompt the caller composed.
    expect(body.system.map((block: any) => block.text).join('')).toBe(`${STABLE}${VOLATILE}`);
    // History stays unmarked: the volatile tail in front of it makes any
    // breakpoint here a write that can never be read.
    expect(body.messages[0].content).toBe('Earlier turn');
    expect(body.messages[1].content).toBe('Continue.');
  });

  test('turn placement moves the volatile context behind the history and marks both prefixes', async () => {
    const request = await buildRequest({
      apiProfileId: 'api-profile',
      model: 'claude-opus-5',
      systemPrompt: `${STABLE}${VOLATILE}`,
      chatHistory: [
        { role: 'user', content: 'Earlier turn' },
        { role: 'ai', content: 'Earlier answer' }
      ],
      newPrompt: 'Continue.',
      promptCache: {
        policy: 'conversation',
        placement: 'turn',
        scopeId: 'chat::profile',
        stable: STABLE,
        volatile: VOLATILE
      }
    }, { database: createDatabase('Anthropic') });

    const body = JSON.parse(request.requestBodyPayload);
    expect(body.system).toEqual([
      { type: 'text', text: STABLE, cache_control: { type: 'ephemeral' } }
    ]);
    expect(body.messages[0].content).toBe('Earlier turn');
    expect(body.messages[1].content).toEqual([
      { type: 'text', text: 'Earlier answer', cache_control: { type: 'ephemeral' } }
    ]);
    // Nothing is lost: the context now reads immediately before the request.
    expect(body.messages[2].content).toBe(`${VOLATILE.trim()}\n\nContinue.`);
  });

  test('workspace variables still resolve across both segments', async () => {
    const database = {
      ...createDatabase('Anthropic'),
      prepare(query: string) {
        if (query.includes('FROM variables')) {
          return { all: () => [{ key: 'voice', value: 'precise' }] };
        }
        return createDatabase('Anthropic').prepare(query);
      }
    };

    const request = await buildRequest({
      apiProfileId: 'api-profile',
      model: 'claude-opus-5',
      newPrompt: 'Continue.',
      promptCache: {
        policy: 'conversation',
        placement: 'system',
        scopeId: 'chat::profile',
        stable: `Be {{voice}}. ${STABLE}`,
        volatile: 'Stay {{voice}}.'
      }
    }, { database });

    const body = JSON.parse(request.requestBodyPayload);
    expect(body.system[0].text.startsWith('Be precise.')).toBe(true);
    expect(body.system[1].text).toBe('Stay precise.');
  });

  test('OpenRouter carries breakpoints only for Anthropic-backed models', async () => {
    const database = createDatabase('OpenRouter');
    const cached = await buildRequest({
      apiProfileId: 'api-profile',
      model: 'anthropic/claude-sonnet-4.5',
      newPrompt: 'Continue.',
      promptCache: { policy: 'conversation', placement: 'system', scopeId: 's', stable: STABLE, volatile: VOLATILE }
    }, { database });
    const plain = await buildRequest({
      apiProfileId: 'api-profile',
      model: 'openai/gpt-5',
      newPrompt: 'Continue.',
      promptCache: { policy: 'conversation', placement: 'system', scopeId: 's2', stable: STABLE, volatile: VOLATILE }
    }, { database });

    expect(JSON.parse(cached.requestBodyPayload).messages[0].content[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(JSON.parse(plain.requestBodyPayload).messages[0].content).toBe(`${STABLE}${VOLATILE}`);
  });

  test('Claude on Bedrock marks the stable head as blocks, like Anthropic', async () => {
    const request = await buildRequest({
      apiProfileId: 'api-profile',
      model: 'anthropic.claude-3-5-sonnet-20240620-v1:0',
      newPrompt: 'Continue.',
      promptCache: { policy: 'conversation', placement: 'system', scopeId: 's', stable: STABLE, volatile: VOLATILE }
    }, {
      database: {
        ...createDatabase('AWS Bedrock'),
        prepare(query: string) {
          if (query.includes('FROM variables')) return { all: () => [] };
          return {
            get: () => ({
              id: 'api-profile',
              provider: 'AWS Bedrock',
              apiKey: 'encrypted-api-key',
              baseUrl: '',
              customConfig: JSON.stringify({ awsRegion: 'us-east-1', awsAccessKeyId: 'id', awsSecretAccessKey: 'secret' })
            })
          };
        }
      }
    });

    const system = JSON.parse(request.requestBodyPayload).system;
    expect(system[0]).toEqual({ type: 'text', text: STABLE, cache_control: { type: 'ephemeral' } });
    expect(system[1]).toEqual({ type: 'text', text: VOLATILE });
    expect(JSON.parse(request.requestBodyPayload)).not.toHaveProperty('cache_control');
  });
});

const minutes = (...values: number[]) => values.map(value => value * 60 * 1000);

describe('cache lifetime from the pace of play', () => {
  test('keeps five minutes when turns come quickly or the pace is still unknown', () => {
    expect(cacheTtlForPace(minutes(1, 2, 3, 2, 1))).toBe('5m');
    expect(cacheTtlForPace(minutes(30))).toBe('5m');
    expect(cacheTtlForPace([])).toBe('5m');
  });

  test('takes the hour when turns are minutes apart, ignoring breaks between sessions', () => {
    expect(cacheTtlForPace(minutes(12, 30, 8, 40, 15))).toBe('1h');
    expect(cacheTtlForPace(minutes(12, 15, 3000, 10, 52000, 20))).toBe('1h');
  });

  test('marks nothing when even the hour expires between turns', () => {
    expect(cacheTtlForPace(minutes(70, 90, 80))).toBeNull();
  });

  test('a slow pace leaves the request unmarked and OpenRouter keeps five minutes', () => {
    const base = { model: 'claude-opus-5', policy: 'conversation', scopeId: 'pace', stableText: STABLE };
    expect(planPromptCache({ ...base, provider: 'Anthropic', ttl: null })).toMatchObject({ systemBreakpoint: false, reason: 'pace-too-slow' });
    expect(planPromptCache({ ...base, provider: 'Anthropic', ttl: '1h' }).ttl).toBe('1h');
    expect(planPromptCache({ ...base, provider: 'OpenRouter', model: 'anthropic/claude-opus-5', ttl: '1h' }).ttl).toBe('5m');
  });

  test('every marker of a request carries the same lifetime, and a refusal falls back to five minutes', async () => {
    const request = (model: string) => buildRequest({
      apiProfileId: 'api-profile', model,
      systemPrompt: `${STABLE}${VOLATILE}`,
      chatHistory: [{ role: 'user', content: 'Earlier turn' }],
      newPrompt: 'Continue.',
      promptCache: { policy: 'conversation', placement: 'turn', scopeId: `ttl::${model}`, stable: STABLE, volatile: VOLATILE, ttl: '1h' }
    }, { database: createDatabase('Anthropic') });
    const markers = (body: any) => JSON.stringify(body).match(/"cache_control":\{[^}]*\}/g);

    const long = JSON.parse((await request('claude-ttl-accepted')).requestBodyPayload);
    expect(markers(long)).toEqual(['"cache_control":{"type":"ephemeral","ttl":"1h"}', '"cache_control":{"type":"ephemeral","ttl":"1h"}']);

    markLongTtlRefused('api-profile', 'claude-ttl-refused');
    const fallback = JSON.parse((await request('claude-ttl-refused')).requestBodyPayload);
    expect(markers(fallback)).toEqual(['"cache_control":{"type":"ephemeral"}', '"cache_control":{"type":"ephemeral"}']);
  });
});
