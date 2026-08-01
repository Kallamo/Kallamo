import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { shouldStopEntityUpdates } = require('../../src/main/features/worldbuild/entity-update-resilience');

describe('entity update circuit breaker', () => {
  test('stops at the third consecutive structured failure and remains stopped', () => {
    expect([0, 2, 3, 4].map(shouldStopEntityUpdates)).toEqual([false, false, true, true]);
  });
});
