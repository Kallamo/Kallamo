import { describe, expect, test } from 'vitest';
import { describeSpanCheck } from '../src/renderer/features/chat/frame-format';

describe('cited time skip notes', () => {
  test('says what a verified span did to the clock', () => {
    expect(describeSpanCheck({ excerpt: 'Three months later', amount: 3, unit: 'months', asserts: 'now', verified: true }))
      .toEqual({ warning: false, text: 'Skip of 3 months · cited "Three months later" · verified' });
    expect(describeSpanCheck({ excerpt: 'After six weeks', amount: 6, unit: 'weeks', asserts: 'framing', verified: true })?.text)
      .toBe('Framing only · cited "After six weeks" · clock not forced');
    expect(describeSpanCheck({ excerpt: 'A day later', amount: 1, unit: 'days', asserts: 'now', verified: true })?.text)
      .toBe('Skip of 1 day · cited "A day later" · verified');
  });

  test('warns when a span was not trusted, and why', () => {
    expect(describeSpanCheck({ excerpt: 'Three months later', amount: 3, unit: 'months', verified: false, reason: 'excerpt-not-found' }))
      .toEqual({ warning: true, text: 'Time skip not verified: the cited excerpt is not in this turn. Held to a week.' });
    expect(describeSpanCheck({ excerpt: '3 months later', amount: 3, unit: 'years', verified: false, reason: 'amount-mismatch' })?.text)
      .toBe('Time skip not verified: 3 years does not match "3 months later". Held to a week.');
  });

  test('says nothing when the turn cited no span', () => {
    expect(describeSpanCheck(undefined)).toBeNull();
  });
});
