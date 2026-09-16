import { createRequire } from 'node:module';
import { afterEach, describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const {
  UNMEASURED_RATIO,
  MIN_SAMPLE_TOKENS,
  tokenRatio,
  measuredRatio,
  recordTokenCount,
  correctedLimit,
  useTokenCalibrationStore,
  forgetTokenCalibration,
  clearTokenCalibration
} = require('../src/main/features/llm/token-calibration');

afterEach(() => clearTokenCalibration());

const key = { apiProfileId: 'bedrock', model: 'claude', protocol: 'text' };

describe('token calibration', () => {
  test('an unmeasured model changes nothing', () => {
    expect(UNMEASURED_RATIO).toBe(1);
    expect(tokenRatio(key)).toBe(1);
    expect(measuredRatio(key)).toBeNull();
    expect(correctedLimit(128000, tokenRatio(key))).toBe(128000);
  });

  test('the first report sets what the model counted', () => {
    expect(recordTokenCount(key, 7125, 9211)).toBeCloseTo(9211 / 7125, 5);
    expect(tokenRatio(key)).toBeCloseTo(9211 / 7125, 5);
  });

  test('a rising count is adopted at once, so the next request is not sized on a stale ratio', () => {
    recordTokenCount(key, 1000, 1200);
    expect(recordTokenCount(key, 1000, 1500)).toBeCloseTo(1.5, 5);
  });

  test('a falling count is blended, so one odd request cannot free too much room', () => {
    recordTokenCount(key, 1000, 1400);
    expect(recordTokenCount(key, 1000, 1200)).toBeCloseTo(1.3, 5);
  });

  test('a model that counts fewer tokens never raises the limit above the configured one', () => {
    expect(recordTokenCount(key, 1000, 700)).toBe(1);
    expect(correctedLimit(16000, 0.5)).toBe(16000);
  });

  test('an absurd report is capped', () => {
    expect(recordTokenCount(key, 1000, 50000)).toBe(3);
  });

  test('small or unreported requests teach nothing', () => {
    expect(recordTokenCount(key, MIN_SAMPLE_TOKENS - 1, 900)).toBeNull();
    expect(recordTokenCount(key, 5000, null)).toBeNull();
    expect(measuredRatio(key)).toBeNull();
  });

  test('the corrected limit divides the configured one by the ratio', () => {
    expect(correctedLimit(16000, 1.5)).toBe(10666);
    expect(correctedLimit(null, 1.5)).toBeNull();
  });

  test('connection, model and protocol each learn on their own, even when ids contain colons', () => {
    recordTokenCount({ ...key, protocol: 'native' }, 1000, 1380);
    recordTokenCount(key, 1000, 1290);
    recordTokenCount({ apiProfileId: 'a', model: 'qwen3:8b' }, 1000, 1500);
    expect(tokenRatio({ ...key, protocol: 'native' })).toBeCloseTo(1.38, 5);
    expect(tokenRatio(key)).toBeCloseTo(1.29, 5);
    expect(tokenRatio({ apiProfileId: 'a:qwen3', model: '8b' })).toBe(1);
    expect(tokenRatio({ apiProfileId: 'a', model: 'qwen3:8b', protocol: 'text' })).toBeCloseTo(1.5, 5);
  });

  test('a stored ratio is loaded before the first request and every new one is saved', () => {
    const saved: any[] = [];
    useTokenCalibrationStore({
      loadTokenCalibrations: () => [{ apiProfileId: 'conn', model: 'qwen3:8b', protocol: 'text', ratio: 1.4 }],
      saveTokenCalibration: (parts: any, ratio: number) => saved.push([parts, ratio])
    });
    expect(tokenRatio({ apiProfileId: 'conn', model: 'qwen3:8b' })).toBe(1.4);
    expect(recordTokenCount({ apiProfileId: 'conn', model: 'qwen3:8b' }, 1000, 1600)).toBeCloseTo(1.6, 5);
    expect(saved).toEqual([[{ apiProfileId: 'conn', model: 'qwen3:8b', protocol: 'text' }, 1.6]]);
  });

  test('forgetting a connection drops only its own ratios', () => {
    recordTokenCount({ apiProfileId: 'conn', model: 'm' }, 1000, 1500);
    recordTokenCount({ apiProfileId: 'conn-2', model: 'm' }, 1000, 1200);
    forgetTokenCalibration('conn');
    expect(measuredRatio({ apiProfileId: 'conn', model: 'm' })).toBeNull();
    expect(tokenRatio({ apiProfileId: 'conn-2', model: 'm' })).toBeCloseTo(1.2, 5);
  });

  test('a store that cannot be read leaves models unmeasured', () => {
    useTokenCalibrationStore({
      loadTokenCalibrations: () => { throw new Error('locked'); },
      saveTokenCalibration: () => {}
    });
    expect(tokenRatio(key)).toBe(1);
  });
});
