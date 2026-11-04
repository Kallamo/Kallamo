import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import { openTestDatabase } from '../sqlite-test-database';

const calendarService = require('../../src/main/features/worldbuild/calendar-service.js');

const WORKSPACE = 'workspace-one';

describe('Event schedule: weekdays, length and hours', () => {
  let directory: string;
  let db: Database.Database;
  let eraId: string;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'kallamo-event-schedule-'));
    db = openTestDatabase(join(directory, 'state.db'));
    runDatabaseMigrations(db);
    db.exec(`CREATE TABLE entities (
      id TEXT PRIMARY KEY, workspaceId TEXT, type TEXT NOT NULL,
      canonicalName TEXT NOT NULL, data TEXT, status TEXT NOT NULL DEFAULT 'confirmed', last_modified INTEGER DEFAULT 0
    )`);
    eraId = calendarService.getCalendar(db, WORKSPACE).defaultEraId;
  });

  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const date = (year: number, month: number, day: number) => ({ eraId, year, month, day });
  const addEvent = (id: string, name: string, data: Record<string, unknown>) => {
    db.prepare("INSERT INTO entities (id, workspaceId, type, canonicalName, data) VALUES (?, ?, 'Events', ?, ?)")
      .run(id, WORKSPACE, name, JSON.stringify(data));
  };
  const month = (year: number, monthNumber: number) => calendarService.getCalendarEntries(db, WORKSPACE, year, monthNumber, eraId);
  const daysOf = (result: any, id: string) => result.entries.filter((entry: any) => entry.entityId === id);
  const weekdayOf = (result: any, day: number) => (result.firstWeekday + day - 1) % 7;
  const narratorAt = (day: Record<string, number | string>, hour: number, minute: number) => {
    calendarService.saveRoleplayClock(db, WORKSPACE, { ...day, hour, minute });
    return calendarService.buildRoleplayTemporalContext(db, WORKSPACE) as string;
  };

  test('a weekly event without picked days keeps the anchor weekday', () => {
    addEvent('market', 'Village market', { eventNature: 'recurring', recurrence: { anchorDate: date(1983, 3, 5), interval: 1, unit: 'week' } });
    const days = daysOf(month(1983, 3), 'market').map((entry: any) => entry.date.day);
    expect(days).toEqual([5, 12, 19, 26]);
  });

  test('a weekly event falls on every picked day of the week', () => {
    const result = month(1983, 3);
    const anchorWeekday = weekdayOf(result, 5);
    const other = (anchorWeekday + 3) % 7;
    addEvent('market', 'Village market', { eventNature: 'recurring', recurrence: { anchorDate: date(1983, 3, 5), interval: 1, unit: 'week', weekdays: [anchorWeekday, other] } });
    const days = daysOf(month(1983, 3), 'market').map((entry: any) => entry.date.day);
    expect(days.every((day: number) => day >= 5 && [anchorWeekday, other].includes(weekdayOf(result, day)))).toBe(true);
    expect(days.length).toBeGreaterThanOrEqual(7);
    expect(days).toContain(5);
  });

  test('every second week skips the weeks in between, counted from the anchor week', () => {
    const result = month(1983, 3);
    const anchorWeekday = weekdayOf(result, 5);
    addEvent('market', 'Village market', { eventNature: 'recurring', recurrence: { anchorDate: date(1983, 3, 5), interval: 2, unit: 'week', weekdays: [anchorWeekday] } });
    const days = daysOf(month(1983, 3), 'market').map((entry: any) => entry.date.day);
    expect(days).toEqual([5, 19]);
  });

  test('a picked day the calendar no longer has is ignored', () => {
    addEvent('market', 'Village market', { eventNature: 'recurring', recurrence: { anchorDate: date(1983, 3, 5), interval: 1, unit: 'week', weekdays: [42] } });
    const days = daysOf(month(1983, 3), 'market').map((entry: any) => entry.date.day);
    expect(days).toEqual([5, 12, 19, 26]);
  });

  test('a recurring event that lasts several days reaches into the next month', () => {
    addEvent('fair', 'Harvest fair', { eventNature: 'recurring', recurrence: { anchorDate: date(1983, 1, 31), interval: 1, unit: 'year', durationDays: 3 } });
    const january = daysOf(month(1984, 1), 'fair');
    const february = daysOf(month(1984, 2), 'fair');
    expect(january.map((entry: any) => [entry.date.day, entry.span])).toEqual([[31, { day: 1, of: 3 }]]);
    expect(february.map((entry: any) => [entry.date.day, entry.span])).toEqual([[1, { day: 2, of: 3 }], [2, { day: 3, of: 3 }]]);
  });

  test('a weekly event ignores a stored length', () => {
    addEvent('market', 'Village market', { eventNature: 'recurring', recurrence: { anchorDate: date(1983, 3, 5), interval: 1, unit: 'week', durationDays: 3 } });
    const entries = daysOf(month(1983, 3), 'market');
    expect(entries.map((entry: any) => entry.date.day)).toEqual([5, 12, 19, 26]);
    expect(entries.every((entry: any) => !entry.span)).toBe(true);
  });

  test('an event without hours or length reads exactly as before', () => {
    addEvent('fair', 'Harvest fair', { eventNature: 'recurring', recurrence: { anchorDate: date(1983, 3, 5), interval: 1, unit: 'year' } });
    const text = narratorAt(date(1984, 3, 5), 12, 0);
    expect(text).toContain('- Harvest fair (recurring-event)\n');
  });

  test('the narrator knows whether an event with hours is under way', () => {
    addEvent('market', 'Village market', {
      eventNature: 'recurring',
      recurrence: { anchorDate: date(1983, 3, 5), interval: 1, unit: 'week' },
      hours: { from: { hour: 8, minute: 0 }, until: { hour: 14, minute: 0 } }
    });
    expect(narratorAt(date(1983, 3, 12), 7, 30)).toContain('- Village market (recurring-event, 08:00 to 14:00, starts in 30 min)');
    expect(narratorAt(date(1983, 3, 12), 12, 30)).toContain('- Village market (recurring-event, 08:00 to 14:00, under way, ends in 1 h 30 min)');
    expect(narratorAt(date(1983, 3, 12), 15, 0)).toContain('- Village market (recurring-event, 08:00 to 14:00, over for today)');
  });

  test('an event with only a start time is a single moment', () => {
    addEvent('vanish', 'The keeper vanishes', { eventNature: 'one-time', startDate: date(1983, 11, 14), hours: { from: { hour: 21, minute: 0 }, until: null } });
    expect(narratorAt(date(1983, 11, 14), 12, 30)).toContain('- The keeper vanishes (event, at 21:00, in 8 h 30 min)');
    expect(narratorAt(date(1983, 11, 14), 22, 0)).toContain('- The keeper vanishes (event, at 21:00, already past)');
  });

  test('a one-time event over several days opens on its first day and closes on its last', () => {
    addEvent('siege', 'The siege', {
      eventNature: 'one-time', startDate: date(1983, 5, 10), endDate: date(1983, 5, 12),
      hours: { from: { hour: 6, minute: 0 }, until: { hour: 18, minute: 0 } }
    });
    const entries = daysOf(month(1983, 5), 'siege');
    expect(entries.map((entry: any) => [entry.span, entry.window])).toEqual([
      [{ day: 1, of: 3 }, { start: 360, end: null }],
      [{ day: 2, of: 3 }, null],
      [{ day: 3, of: 3 }, { start: null, end: 1080 }]
    ]);
    expect(narratorAt(date(1983, 5, 11), 12, 0)).toContain('- The siege (event, day 2 of 3, all day)');
  });

  test('hours outside the world day are ignored', () => {
    addEvent('market', 'Village market', {
      eventNature: 'recurring',
      recurrence: { anchorDate: date(1983, 3, 5), interval: 1, unit: 'week' },
      hours: { from: { hour: 30, minute: 0 }, until: null }
    });
    expect(daysOf(month(1983, 3), 'market')[0].hours).toBeUndefined();
  });
});
