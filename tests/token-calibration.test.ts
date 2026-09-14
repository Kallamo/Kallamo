import { createRequire } from 'node:module';
import { afterEach, describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const {
  DEFAULT_RATIO,
  MIN_SAMPLE_TOKENS,
  tokenRatio,
  recordTokenCount,
  calibrateTokens,
  clearTokenCalibration
} = require('../src/main/features/llm/token-calibration');

afterEach(() => clearTokenCalibration());

describe('token calibration', () => {
  test('an unmeasured model gets the cautious default', () => {
    expect(tokenRatio('bedrock:claude:text')).toBe(DEFAULT_RATIO);
    expect(calibrateTokens('bedrock:claude:text', 1000)).toBe(Math.ceil(1000 * DEFAULT_RATIO));
  });

  test('the first report replaces the default with what the model counted', () => {
    expect(recordTokenCount('k', 7125, 9211)).toBeCloseTo(9211 / 7125, 5);
    expect(calibrateTokens('k', 7125)).toBe(Math.ceil(7125 * (9211 / 7125)));
  });

  test('later reports are blended, so one odd request cannot swing it', () => {
    recordTokenCount('k', 1000, 1400);
    expect(recordTokenCount('k', 1000, 1200)).toBeCloseTo(1.3, 5);
  });

  test('a model that counts fewer tokens never lowers the estimate below the local count', () => {
    expect(recordTokenCount('k', 1000, 700)).toBe(1);
  });

  test('an absurd report is capped', () => {
    expect(recordTokenCount('k', 1000, 50000)).toBe(3);
  });

  test('small or unreported requests teach nothing', () => {
    expect(recordTokenCount('k', MIN_SAMPLE_TOKENS - 1, 900)).toBe(DEFAULT_RATIO);
    expect(recordTokenCount('k', 5000, null)).toBe(DEFAULT_RATIO);
    expect(tokenRatio('k')).toBe(DEFAULT_RATIO);
  });

  test('each key learns on its own', () => {
    recordTokenCount('native', 1000, 1380);
    recordTokenCount('text', 1000, 1290);
    expect(tokenRatio('native')).toBeCloseTo(1.38, 5);
    expect(tokenRatio('text')).toBeCloseTo(1.29, 5);
  });
});
