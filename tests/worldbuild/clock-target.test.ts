import { describe, expect, test } from 'vitest';

const { DEFAULT_CALENDAR, extractClockTarget } = require('../../src/main/features/worldbuild/calendar-service.js');

const clock = (hour: number, minute = 0) => ({ eraId: 'ce', year: 997, month: 5, day: 15, hour, minute });
const time = (text: string, futureOnly = false, start = clock(0)) => {
  const target = extractClockTarget(text, start, DEFAULT_CALENDAR, futureOnly);
  return target ? `${target.hour}:${String(target.minute).padStart(2, '0')}` : null;
};

describe('explicit clock in the text', () => {
  test('ignores a count that only looks like a time', () => {
    expect(time('The veteran plants the staff and rests both hands at two points on top.')).toBeNull();
    expect(time('He broke the 3 training staffs.')).toBeNull();
    expect(time('He looked at 2 doors.')).toBeNull();
  });

  test('reads a time of day once something marks it as one', () => {
    expect(time('They arrived at three o’clock.')).toBe('3:00');
    expect(time('They left at 16:00.')).toBe('16:00');
    expect(time('At 14:30 the bell rang.')).toBe('14:30');
    expect(time('At half past two he came back.')).toBe('2:30');
    expect(time('At quarter to six the gates closed.')).toBe('5:45');
    expect(time('The clock struck five.')).toBe('5:00');
    expect(time('They met at 9 pm.')).toBe('21:00');
  });

  test('places the afternoon and the night after noon', () => {
    expect(time('They set out at two in the afternoon.')).toBe('14:00');
    expect(time('They came back at 9 at night.')).toBe('21:00');
    expect(time('She woke at four in the morning.')).toBe('4:00');
  });

  test('reads noon', () => {
    expect(time('At noon the square filled up.')).toBe('12:00');
  });

  test('treats a time already behind the clock as a recollection', () => {
    const text = 'He was wandering the hill at half past six in the morning. They came back at 15:00.';
    expect(time(text, false, clock(14, 5))).toBe('15:00');
    expect(time('He was wandering the hill at half past six in the morning.', false, clock(14, 5))).toBeNull();
  });

  test('takes only a deadline from the player', () => {
    expect(time('I will wait until 18:00.', true)).toBe('18:00');
    expect(time('I will arrive at 18:00.', true)).toBeNull();
  });
});
