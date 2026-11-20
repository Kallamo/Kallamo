// Day arithmetic of a world calendar. Calendar parsing and display stay in calendar-service.js;
// this is the part the story timeline needs too.

export interface CalendarMonth { days: number }
export interface CalendarEra { id: string; direction?: string; offset: number }
export interface OrdinalCalendar {
  months: CalendarMonth[];
  eras: CalendarEra[];
  defaultEraId?: string;
  leapRule?: { type?: string; month?: number; extraDays?: number } | null;
  hoursPerDay?: number;
  minutesPerHour?: number;
}
export interface CalendarDate { eraId?: string; year?: unknown; month?: unknown; day?: unknown }

// Keeps story positions positive: Umwelt reads axis positions from 0, and eras run backwards.
export const STORY_MINUTE_ORIGIN = 2 ** 40;

export function modulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor;
}

export function positiveInteger(value: unknown, fallback = 1): number {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

export function integer(value: unknown, fallback = 0): number {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) ? number : fallback;
}

export function isLeapYear(calendar: OrdinalCalendar, absoluteYear: number): boolean {
  if (calendar.leapRule?.type !== 'gregorian') return false;
  return modulo(absoluteYear, 4) === 0
    && (modulo(absoluteYear, 100) !== 0 || modulo(absoluteYear, 400) === 0);
}

export function daysInMonth(calendar: OrdinalCalendar, absoluteYear: number, month: number): number {
  const base = calendar.months[month - 1]?.days || 1;
  return base + (
    isLeapYear(calendar, absoluteYear) && calendar.leapRule?.month === month
      ? Number(calendar.leapRule.extraDays) || 0
      : 0
  );
}

export function absoluteYearFor(calendar: OrdinalCalendar, date: CalendarDate): number {
  const era = calendar.eras.find(candidate => candidate.id === date.eraId)
    || calendar.eras.find(candidate => candidate.id === calendar.defaultEraId)
    || calendar.eras[0];
  const year = positiveInteger(date.year, 1);
  if (!era) return year;
  return era.direction === 'backward'
    ? era.offset - (year - 1)
    : era.offset + (year - 1);
}

export function clampDate(calendar: OrdinalCalendar, input: CalendarDate): { eraId: string | undefined; year: number; month: number; day: number } {
  const date = input && typeof input === 'object' ? input : {};
  const eraId = calendar.eras.some(era => era.id === date.eraId) ? date.eraId : calendar.defaultEraId;
  const year = positiveInteger(date.year, 1);
  const month = Math.max(1, Math.min(calendar.months.length, positiveInteger(date.month, 1)));
  const absoluteYear = absoluteYearFor(calendar, { eraId, year });
  const day = Math.max(1, Math.min(daysInMonth(calendar, absoluteYear, month), positiveInteger(date.day, 1)));
  return { eraId, year, month, day };
}

export function daysBeforeYear(calendar: OrdinalCalendar, absoluteYear: number): number {
  const baseDays = calendar.months.reduce((sum, month) => sum + month.days, 0);
  if (calendar.leapRule?.type !== 'gregorian') return (absoluteYear - 1) * baseDays;
  const year = absoluteYear - 1;
  return year * baseDays
    + Math.floor(year / 4)
    - Math.floor(year / 100)
    + Math.floor(year / 400);
}

export function toOrdinal(calendar: OrdinalCalendar, input: CalendarDate): number {
  const date = clampDate(calendar, input);
  const absoluteYear = absoluteYearFor(calendar, date);
  let ordinal = daysBeforeYear(calendar, absoluteYear);
  for (let month = 1; month < date.month; month += 1) {
    ordinal += daysInMonth(calendar, absoluteYear, month);
  }
  return ordinal + date.day - 1;
}

/** A clock position as a minute count on the story axis; null when the calendar cannot place it. */
export function storyMinute(calendar: OrdinalCalendar | null | undefined, position: CalendarDate & { hour?: unknown; minute?: unknown } | null | undefined): number | null {
  if (!calendar || !Array.isArray(calendar.months) || !calendar.months.length || !Array.isArray(calendar.eras) || !calendar.eras.length) return null;
  if (!position || typeof position !== 'object' || typeof position.eraId !== 'string') return null;
  const hoursPerDay = positiveInteger(calendar.hoursPerDay, 24);
  const minutesPerHour = positiveInteger(calendar.minutesPerHour, 60);
  const hour = Math.max(0, Math.min(hoursPerDay - 1, integer(position.hour)));
  const minute = Math.max(0, Math.min(minutesPerHour - 1, integer(position.minute)));
  const value = STORY_MINUTE_ORIGIN + toOrdinal(calendar, position) * hoursPerDay * minutesPerHour + hour * minutesPerHour + minute;
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

export function yearForOrdinal(calendar: OrdinalCalendar, ordinal: number): number {
  let low = -1000000;
  let high = 1000001;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (daysBeforeYear(calendar, middle) <= ordinal) low = middle;
    else high = middle;
  }
  return low;
}

export function displayYearFor(calendar: OrdinalCalendar, absoluteYear: number, preferredEraId?: string): { eraId: string | undefined; year: number } {
  const preferred = calendar.eras.find(era => era.id === preferredEraId);
  const ordered = preferred ? [preferred, ...calendar.eras.filter(era => era.id !== preferred.id)] : calendar.eras;
  for (const era of ordered) {
    const year = era.direction === 'backward' ? era.offset - absoluteYear + 1 : absoluteYear - era.offset + 1;
    if (year >= 1) return { eraId: era.id, year };
  }
  return { eraId: calendar.defaultEraId, year: Math.max(1, Math.abs(absoluteYear)) };
}

/** The calendar date of a minute on the story axis; the inverse of `storyMinute`. */
export function dateOfStoryMinute(calendar: OrdinalCalendar | null | undefined, value: number | null | undefined, preferredEraId?: string): { eraId: string | undefined; year: number; month: number; day: number; hour: number; minute: number } | null {
  if (!calendar || !Array.isArray(calendar.months) || !calendar.months.length || !Array.isArray(calendar.eras) || !calendar.eras.length) return null;
  if (!Number.isSafeInteger(value)) return null;
  const hoursPerDay = positiveInteger(calendar.hoursPerDay, 24);
  const minutesPerHour = positiveInteger(calendar.minutesPerHour, 60);
  const minutesPerDay = hoursPerDay * minutesPerHour;
  const elapsed = Number(value) - STORY_MINUTE_ORIGIN;
  const ordinal = Math.floor(elapsed / minutesPerDay);
  const inDay = elapsed - ordinal * minutesPerDay;
  const absoluteYear = yearForOrdinal(calendar, ordinal);
  let dayOfYear = ordinal - daysBeforeYear(calendar, absoluteYear);
  let month = 1;
  while (month < calendar.months.length) {
    const length = daysInMonth(calendar, absoluteYear, month);
    if (dayOfYear < length) break;
    dayOfYear -= length;
    month += 1;
  }
  return { ...displayYearFor(calendar, absoluteYear, preferredEraId), month, day: dayOfYear + 1, hour: Math.floor(inDay / minutesPerHour), minute: inDay % minutesPerHour };
}
