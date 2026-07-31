import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { shouldStopEntityUpdates } = require('../../src/main/features/worldbuild/entity-update-resilience');

describe('entity update circuit breaker', () => {
  test('allows isolated structured failures', () => {
    expect(shouldStopEntityUpdates(2)).toBe(false);
  });

  test('stops before spending tokens after the third consecutive failure', () => {
    expect(shouldStopEntityUpdates(3)).toBe(true);
  });
});
