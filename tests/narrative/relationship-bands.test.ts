import { describe, expect, test } from 'vitest';
import { isDailyLimited, limitRelationshipChange } from '../../src/narrative/relationship-bands';

const change = (current: number | null, requested: number, impact: 'meaningful' | 'significant' | 'drastic' = 'meaningful', cause: string | null = 'revelation') =>
  limitRelationshipChange({ current, requested, impact, cause });

describe('deepening slows toward either extreme', () => {
  test('an ordinary shift takes the band step, the same on both sides', () => {
    expect(change(20, 40).value).toBe(25);
    expect(change(-20, -40).value).toBe(-25);
    expect(change(60, 80).value).toBe(63);
    expect(change(80, 95).value).toBe(83);
    expect(change(95, 100).value).toBe(96);
  });

  test('an extreme event reaches the band ceiling and no further than asked', () => {
    expect(change(0, 100, 'drastic').value).toBe(50 + 0);
    expect(change(0, 30, 'drastic').value).toBe(30);
    expect(change(92, 100, 'drastic').value).toBe(93);
  });

  test('a jump across bands is spent band by band', () => {
    // 10 points reach 50, a fifth of the extreme step; the four fifths left are worth 20 above 50.
    expect(change(40, 100, 'drastic').value).toBe(70);
  });
});

describe('a wound costs more the more someone is loved', () => {
  test('an ordinary wound', () => {
    expect(change(30, 0).value).toBe(25);
    expect(change(80, 0).value).toBe(70);
    expect(change(95, 0).value).toBe(80);
  });

  test('only an extreme wound turns affection into resentment', () => {
    expect(change(3, -20).value).toBe(0);
    expect(change(95, -100, 'drastic')).toMatchObject({ value: -35, table: 'wound' });
    expect(change(30, -100, 'drastic').value).toBe(-20);
  });
});

describe('winning someone back is slower the deeper the dislike', () => {
  test('an ordinary kindness', () => {
    expect(change(-30, 0).value).toBe(-25);
    expect(change(-60, 0).value).toBe(-56);
    expect(change(-80, 0).value).toBe(-77);
    expect(change(-95, 0).value).toBe(-94);
  });

  test('saving a sworn enemy lifts them out of the deepest band without making them an ally', () => {
    const result = change(-95, 50, 'drastic', 'rescue');
    expect(result.table).toBe('reconcile');
    expect(result.value as number).toBeGreaterThan(-90);
    expect(result.value as number).toBeLessThan(0);
  });
});

describe('causes with ceilings of their own', () => {
  test('courtesy, banter and routine cooperation move a little, and stop at 75', () => {
    expect(change(10, 30, 'meaningful', 'banter').value).toBe(12);
    expect(change(60, 80, 'meaningful', 'courtesy').value).toBe(61);
    expect(change(80, 90, 'drastic', 'routine-cooperation')).toMatchObject({ value: null, refused: 'cause-stops-here' });
  });

  test('sustained trust and debts move by the least above 50 and stop at 75', () => {
    expect(change(20, 40, 'meaningful', 'sustained-trust').value).toBe(25);
    expect(change(60, 80, 'significant', 'material-debt').value).toBe(61);
    expect(change(88, 95, 'meaningful', 'sustained-trust')).toMatchObject({ value: null, refused: 'cause-stops-here' });
  });

  test('affection, confidences and reliance keep a bond growing past 75 by the least', () => {
    expect(change(88, 95, 'significant', 'affection').value).toBe(89);
    expect(change(60, 80, 'meaningful', 'reliance').value).toBe(63);
  });

  test('a first impression only exists before any relationship', () => {
    expect(change(null, 20, 'meaningful', 'first-impression')).toMatchObject({ value: 20, table: 'initial' });
    expect(change(0, 20, 'meaningful', 'first-impression')).toMatchObject({ value: null, refused: 'first-impression-on-existing' });
  });

  test('a new relationship keeps the opening limits', () => {
    expect(change(null, 80, 'meaningful').value).toBe(25);
    expect(change(null, -80, 'drastic').value).toBe(-80);
    expect(change(null, 30, 'meaningful', 'courtesy').value).toBe(2);
  });

  test('an unchanged value is no change', () => {
    expect(change(95, 95)).toMatchObject({ value: null, refused: 'no-change' });
  });
});

describe('daily limits', () => {
  test('ordinary closeness always, intimacy only past 75', () => {
    expect(isDailyLimited('banter', 10)).toBe(true);
    expect(isDailyLimited('affection', 60)).toBe(false);
    expect(isDailyLimited('affection', 80)).toBe(true);
    expect(isDailyLimited('affection', -80)).toBe(true);
    expect(isDailyLimited('rescue', 95)).toBe(false);
  });
});
