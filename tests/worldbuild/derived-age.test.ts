import { describe, expect, test } from 'vitest';
import { birthDateForAge, derivedAge as sheetAge } from '../../src/shared/world-age';

const { DEFAULT_CALENDAR, ageAt, derivedAge, normalizeCalendar } = require('../../src/main/features/worldbuild/calendar-service.js');

const calendar = normalizeCalendar(DEFAULT_CALENDAR);
const era = calendar.defaultEraId;
const date = (year: number, month: number, day: number) => ({ eraId: era, year, month, day });

describe('age from a birth date', () => {
  test('counts whole years and waits for the birthday', () => {
    expect(ageAt(calendar, date(970, 6, 10), date(1004, 6, 9))).toBe(33);
    expect(ageAt(calendar, date(970, 6, 10), date(1004, 6, 10))).toBe(34);
    expect(ageAt(calendar, date(1005, 1, 1), date(1004, 6, 10))).toBeNull();
  });

  test('follows the story clock and stops at death', () => {
    const data = { birthDate: date(970, 6, 10), age: '12' };
    expect(derivedAge(calendar, date(1004, 7, 1), data)).toBe('34');
    expect(derivedAge(calendar, date(1004, 7, 1), { ...data, status: 'deceased', deathDate: date(1000, 1, 1) })).toBe('29');
    expect(derivedAge(calendar, date(1004, 7, 1), { ...data, status: 'deceased' })).toBeNull();
    expect(derivedAge(calendar, date(1004, 7, 1), { age: '12' })).toBe('12');
  });

  test('the sheet and the AI read the same age', () => {
    const data = { birthDate: date(970, 6, 10) };
    const clock = date(1004, 3, 2);
    expect(sheetAge(calendar, clock, data)).toBe(derivedAge(calendar, clock, data));
  });

  test('turning an age into a birthday keeps the number', () => {
    const clock = date(1004, 3, 2);
    const birthDate = birthDateForAge(calendar, clock, '34');
    expect(sheetAge(calendar, clock, { birthDate })).toBe('34');
    expect(birthDateForAge(calendar, clock, 'old')).toBeNull();
  });
});
