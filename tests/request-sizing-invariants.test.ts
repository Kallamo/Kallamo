import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { buildRequest, resolvePayloadLimit } = require('../src/main/features/llm/llm.service');
const { estimatePayloadTokens } = require('../src/main/features/llm/payload-budget');
const { splitRetrievalBudget } = require('../src/main/features/llm/context-budget');
const { clearTokenCalibration, recordTokenCount } = require('../src/main/features/llm/token-calibration');
const { planActiveHistory, selectActiveHistory } = require('../src/main/features/chat/history-window');
const { resetAllScopes } = require('../src/main/features/llm/prompt-cache');

function database(provider = 'Anthropic') {
  const profile = { id: 'conn', provider, apiKey: 'key', baseUrl: '', customConfig: null, contextWindow: null };
  return {
    prepare(query: string) {
      if (query.includes('FROM variables')) return { all: () => [] };
      if (query.includes('FROM api_profiles')) return { get: () => profile };
      if (query.includes('token_calibration')) return { all: () => [], run: () => {} };
      throw new Error(`Unexpected query: ${query}`);
    },
    loadTokenCalibrations: () => [],
    saveTokenCalibration: () => {},
    decryptApiKey: (value: string) => value
  };
}

function conversation(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    id: `msg_${index}`,
    role: index % 2 === 0 ? 'user' : 'ai',
    content: `Turn ${index}. ${'The caravan waited for the tide to turn. '.repeat(20)}`
  }));
}

const STABLE = `Narrator voice and rules. ${'constant world reference '.repeat(500)}`;

beforeEach(() => {
  resetAllScopes();
  clearTokenCalibration();
});

afterEach(() => clearTokenCalibration());

describe('a request is sized once', () => {
  test('a measured ratio lowers the limit exactly once, even when the caller pins it', async () => {
    const db = database();
    recordTokenCount({ apiProfileId: 'conn', model: 'm', protocol: 'text' }, 10000, 15000);
    const pinned = resolvePayloadLimit({ apiProfileId: 'conn', model: 'm', maxPayloadTokens: 128000 }, { database: db });
    expect(pinned).toMatchObject({ configured: 128000, ratio: 1.5, limit: Math.floor(128000 / 1.5) });

    // Between the once-corrected limit and a twice-corrected one: it must pass.
    const prompt = 'The harbour ledger keeps every debt. '.repeat(Math.floor(128000 / 1.5 / 9) - 900);
    const estimate = estimatePayloadTokens({ systemPrompt: prompt, newPrompt: 'Continue.', outputTokens: 1000 }).totalTokens;
    expect(estimate).toBeGreaterThan(Math.floor(128000 / 2.25));
    expect(estimate).toBeLessThan(pinned.limit - 4000);

    const request = { apiProfileId: 'conn', model: 'm', systemPrompt: prompt, newPrompt: 'Continue.', maxTokens: 1000, maxPayloadTokens: 128000 };
    await expect(buildRequest({ ...request, payloadLimit: pinned }, { database: db })).resolves.toBeTruthy();
    await expect(buildRequest(request, { database: db })).resolves.toBeTruthy();
  });

  test('retrieval and history share one budget: history is measured first and retrieval keeps at least 40%', () => {
    expect(splitRetrievalBudget({ availableTokens: 100000, historyTokens: 30000 })).toBe(70000);
    expect(splitRetrievalBudget({ availableTokens: 100000, historyTokens: 80000 })).toBe(40000);
  });

  test('the history measured for the budget is the window that is then sent', () => {
    const messages = conversation(60);
    const measured = planActiveHistory(messages, 4000, 'chat-a');
    const sent = selectActiveHistory(messages, 4000, 'chat-a');
    expect(sent.tokens).toBe(measured.tokens);
    expect(sent.history).toEqual(measured.history);
  });

  test('reasoning never reaches the history that is measured or sent', () => {
    const [first] = selectActiveHistory([{ id: 'a', role: 'ai', content: '<think>private plan</think>The gate opens.' }], 4000).history;
    expect(first.content).toBe('The gate opens.');
  });
});

describe('every request is bounded', () => {
  test('a request that names no limit is still checked against the default workspace limit', async () => {
    const db = database('Local');
    const huge = 'The archive remembers every tide. '.repeat(30000);
    await expect(buildRequest({ apiProfileId: 'conn', model: 'm', systemPrompt: huge, newPrompt: 'Continue.', maxTokens: 500 }, { database: db }))
      .rejects.toMatchObject({ code: 'MAX_API_PAYLOAD_EXCEEDED', retryable: false });
  });

  test('the Tagger splits a batch that exceeds the payload limit instead of failing it', async () => {
    const { runModelTagger } = require('../src/main/features/world-index/tagger');
    const records = Array.from({ length: 4 }, (_, index) => ({ id: `c${index}`, text: `Passage ${index}. ${'The ferry crossed at dawn. '.repeat(40)}` }));
    const sent: number[] = [];
    const send = async ({ newPrompt }: { newPrompt: string }) => {
      const chunks = (newPrompt.match(/\[CHUNK \d+\]/g) || []).length;
      sent.push(chunks);
      if (chunks > 1) throw Object.assign(new Error('over the payload limit'), { code: 'MAX_API_PAYLOAD_EXCEEDED' });
      return { content: JSON.stringify({ items: [{ chunk: 0, mentions: [] }] }), truncated: false };
    };
    const { outcomes } = await runModelTagger({ records, categories: [{ name: 'Characters', description: '' }], send, concurrency: 1 });
    expect([...outcomes.values()].every(outcome => outcome.status === 'completed')).toBe(true);
    expect(sent.filter(count => count === 1)).toHaveLength(4);
  });
});

describe('the cached prefix survives turns that change retrieval', () => {
  test('the stable head and the history start are byte-identical while the retrieved context and budget move', async () => {
    const db = database('Anthropic');
    const messages = conversation(40);
    const bodies = [];
    // The retrieval budget moves every turn, which is what used to move the window.
    for (const [turn, retrieved] of [[0, 'Retrieved: the ledger.'], [1, 'Retrieved: the tide tables and two letters. '.repeat(30)]] as const) {
      const room = turn === 0 ? 9000 : 8600;
      const history = selectActiveHistory(messages.slice(0, 36 + turn * 2), room, 'chat-b').history;
      const { requestBodyPayload } = await buildRequest({
        apiProfileId: 'conn',
        model: 'claude-sonnet-4-6',
        systemPrompt: STABLE + retrieved,
        chatHistory: history,
        newPrompt: 'Continue.',
        maxTokens: 800,
        maxPayloadTokens: 128000,
        promptCache: { policy: 'conversation', placement: 'system', scopeId: 'chat-b::profile', stable: STABLE, volatile: retrieved }
      }, { database: db });
      bodies.push(JSON.parse(requestBodyPayload));
    }
    expect(bodies[0].system[0]).toEqual(bodies[1].system[0]);
    expect(bodies[0].system[0].cache_control).toEqual({ type: 'ephemeral' });
    expect(bodies[0].system[1].text).not.toBe(bodies[1].system[1].text);
    expect(bodies[0].messages[0]).toEqual(bodies[1].messages[0]);
  });
});
