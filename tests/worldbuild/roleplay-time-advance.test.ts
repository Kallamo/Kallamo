import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import { openTestDatabase } from '../sqlite-test-database';

const calendarService = require('../../src/main/features/worldbuild/calendar-service.js');

const WORKSPACE = 'workspace-one';

describe('Roleplay time advance', () => {
  let directory: string;
  let db: Database.Database;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'kallamo-roleplay-time-'));
    db = openTestDatabase(join(directory, 'state.db'));
    runDatabaseMigrations(db);
    db.exec(`CREATE TABLE entities (
      id TEXT PRIMARY KEY, workspaceId TEXT, type TEXT NOT NULL,
      canonicalName TEXT NOT NULL, data TEXT, last_modified INTEGER DEFAULT 0
    )`);
    for (const [id, name] of [['street', 'Tanner Street'], ['lookout', 'Dawn Lookout']]) {
      db.prepare("INSERT INTO entities (id, workspaceId, type, canonicalName, data) VALUES (?, ?, 'Locations', ?, '{}')")
        .run(id, WORKSPACE, name);
    }
  });

  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const matrix = () => calendarService.getTimeMatrix(db, WORKSPACE);
  const calendar = () => calendarService.getCalendar(db, WORKSPACE);

  function frame(originId: string, timeAdvance: unknown, minimumMinutes = 0) {
    return calendarService.applyRoleplayTurnFrame(db, {
      workspaceId: WORKSPACE,
      originId,
      startClock: calendarService.getRoleplayClock(db, WORKSPACE),
      startLocationId: 'street',
      endLocationId: 'lookout',
      timeAdvance,
      minimumMinutes
    });
  }

  /* The interpreter reports 0 confidence for ordinary advances, so confidence is not a gate. */
  test('keeps an advance the interpreter reported no confidence in', () => {
    const advance = calendarService.normalizeTimeAdvance(
      { actionType: 'brief_inspection', basis: 'matrix', duration: { years: 0, months: 0, days: 0, hours: 0, minutes: 10 }, confidence: 0 },
      calendar(),
      calendarService.getRoleplayClock(db, WORKSPACE)
    );

    expect(advance).toMatchObject({ confidence: 0, duration: { hours: 0, minutes: 10 } });
  });

  test('still bounds an inferred advance that would skip a season', () => {
    const advance = calendarService.normalizeTimeAdvance(
      { actionType: 'travel', basis: 'matrix', duration: { years: 3, months: 0, days: 0, hours: 0, minutes: 0 }, confidence: 0.9 },
      calendar(),
      calendarService.getRoleplayClock(db, WORKSPACE)
    );

    expect(advance).toMatchObject({
      duration: { years: 0, months: 0, days: 7 },
      clamped: true,
      requestedDuration: { years: 3, months: 0, days: 0, hours: 0, minutes: 0 }
    });
  });

  test('raises a journey the interpreter priced at nothing to the matrix minimum', () => {
    const transit = calendarService.matrixMinimumMinutes(matrix(), 'transit');

    const result = frame('turn-walk', null, transit);

    expect(result.advance).toMatchObject({
      actionType: 'travel_between_locations',
      basis: 'matrix',
      duration: { days: 0, hours: 0, minutes: transit },
      raisedToMinimum: true
    });
    expect(calendarService.durationTotalMinutes(calendar(), result.advance.duration)).toBe(transit);
  });

  test('raises a journey priced below the floor and keeps what was asked for', () => {
    const transit = calendarService.matrixMinimumMinutes(matrix(), 'transit');

    const result = frame('turn-short-walk', {
      actionType: 'walking_conversation', basis: 'matrix',
      duration: { years: 0, months: 0, days: 0, hours: 0, minutes: 2 }, confidence: 0.65
    }, transit);

    expect(result.advance).toMatchObject({
      actionType: 'walking_conversation',
      duration: { minutes: transit },
      raisedToMinimum: true,
      requestedDuration: { hours: 0, minutes: 2 }
    });
  });

  test('leaves an advance that already meets the floor alone', () => {
    const result = frame('turn-long-walk', {
      actionType: 'cross_district_travel', basis: 'matrix',
      duration: { years: 0, months: 0, days: 0, hours: 1, minutes: 0 }, confidence: 0.8
    }, calendarService.matrixMinimumMinutes(matrix(), 'transit'));

    expect(result.advance).toMatchObject({ duration: { hours: 1, minutes: 0 } });
    expect(result.advance).not.toHaveProperty('raisedToMinimum');
  });

  /* A time the narrative actually states outranks the matrix: there the author said it. */
  test('never overrides a clock the narrative stated', () => {
    const clock = calendarService.getRoleplayClock(db, WORKSPACE);
    const result = frame('turn-explicit', {
      actionType: 'explicit_clock_progression', basis: 'explicit',
      duration: { years: 0, months: 0, days: 0, hours: 0, minutes: 5 },
      targetPosition: { ...clock, hour: clock.hour, minute: clock.minute + 5 },
      confidence: 1
    }, 240);

    expect(result.advance).toMatchObject({ basis: 'explicit', duration: { minutes: 5 } });
    expect(result.advance).not.toHaveProperty('raisedToMinimum');
  });

  describe('stated time skips', () => {
    const span = (text: string) => calendarService.extractElapsedSpan(calendar(), text);

    test('reads a span the turn asserts and ignores one it merely recounts', () => {
      expect(span('Three months had passed since Mine 07 fell.')).toMatchObject({ strength: 'strong' });
      expect(span('Two years later, Corwin returned to Lowmere.')).toMatchObject({ strength: 'strong' });
      expect(span('Three years later the forge reopened.')).toMatchObject({ strength: 'strong' });
      expect(span('The next day, Rosalind called for Pip.')).toMatchObject({ strength: 'strong' });
      // Framing, not a skip: it reads the same inside a flashback.
      expect(span('After six weeks on the road, they reached Kesh.')).toMatchObject({ strength: 'weak' });
      // History about the world, not time passing in this turn.
      expect(span('The plague stayed active for fourteen months.')).toBeNull();
      expect(span('He walked over to Oswin’s workshop.')).toBeNull();
    });

    test('refuses months and years the turn never mentioned', () => {
      const advance = calendarService.normalizeTimeAdvance(
        { actionType: 'skip', basis: 'matrix', duration: { years: 3, months: 0, days: 0, hours: 0, minutes: 0 }, confidence: 0.9 },
        calendar(),
        calendarService.getRoleplayClock(db, WORKSPACE)
      );

      expect(advance).toMatchObject({ duration: { years: 0, months: 0, days: 7 }, clamped: true });
    });

    test('allows a skip the narrative actually states', () => {
      const stated = span('Three months had passed since Mine 07 fell.');
      const advance = calendarService.normalizeTimeAdvance(
        { actionType: 'skip', basis: 'matrix', duration: { years: 0, months: 0, days: 90, hours: 0, minutes: 0 }, confidence: 0.9, statedSpan: stated },
        calendar(),
        calendarService.getRoleplayClock(db, WORKSPACE)
      );

      expect(advance).toMatchObject({ duration: { days: 90 } });
      expect(advance).not.toHaveProperty('clamped');
    });

    test('holds a skip to the span that was stated, not the one that was asked for', () => {
      const stated = span('Three months had passed since Mine 07 fell.');
      const advance = calendarService.normalizeTimeAdvance(
        { actionType: 'skip', basis: 'matrix', duration: { years: 6, months: 0, days: 0, hours: 0, minutes: 0 }, confidence: 0.9, statedSpan: stated },
        calendar(),
        calendarService.getRoleplayClock(db, WORKSPACE)
      );

      expect(advance).toMatchObject({
        duration: { days: 90 },
        clamped: true,
        requestedDuration: { years: 6 }
      });
    });

    test('skips the years the player declared even when the interpreter reported nothing', () => {
      const stated = span('Two years passed, and Corwin returned to Lowmere.');
      const before = calendarService.getRoleplayClock(db, WORKSPACE);

      const result = frame('turn-skip', { statedSpan: stated });

      expect(result.advance).toMatchObject({ actionType: 'stated_time_skip', raisedToMinimum: true });
      expect(calendarService.getRoleplayClock(db, WORKSPACE).year).toBe(before.year + 2);
    });

    test('never lets a merely framed span move the clock on its own', () => {
      const stated = span('After six weeks on the road, they reached Kesh.');

      const result = frame('turn-weak-span', { statedSpan: stated });

      expect(result.advance).toBeNull();
    });

    test('prefers the stated skip over the travel floor when it is longer', () => {
      const stated = span('A month later, the workshop reopened.');

      const result = frame('turn-skip-over-travel', { statedSpan: stated }, 30);

      expect(result.advance).toMatchObject({ actionType: 'stated_time_skip' });
      expect(calendarService.durationTotalMinutes(calendar(), result.advance.duration)).toBe(stated.minutes);
    });
  });

  describe('time skips the interpreter cites', () => {
    const cite = (sourceText: string, claimedSpan: unknown) =>
      calendarService.resolveStatedSpan(calendar(), { claimedSpan, sourceText });
    const skip = (months: number) => ({ years: 0, months, days: 0, hours: 0, minutes: 0 });
    const turn = (resolved: any, duration: object) => ({
      actionType: 'skip', basis: 'matrix', duration, confidence: 0.9,
      ...(resolved.statedSpan ? { statedSpan: resolved.statedSpan } : {}),
      ...(resolved.check ? { spanCheck: resolved.check } : {})
    });

    test('moves the clock by a verified span and keeps what was cited', () => {
      const resolved = cite('Three months later, the forge was cold.', { excerpt: 'Three months later', amount: 3, unit: 'months', asserts: 'now' });

      expect(resolved.statedSpan).toMatchObject({ strength: 'strong', source: 'interpreter' });
      const result = frame('turn-cited', turn(resolved, skip(3)));
      expect(result.advance).not.toHaveProperty('clamped');
      expect(calendarService.durationTotalMinutes(calendar(), result.advance.duration)).toBe(resolved.statedSpan.minutes);
      expect(result.advance.spanCheck).toMatchObject({ excerpt: 'Three months later', verified: true });
    });

    test('verifies a span in any script without a vocabulary for it', () => {
      expect(cite('3か月後、鍛冶場は冷えていた。', { excerpt: '3か月後', amount: 3, unit: 'months', asserts: 'now' }).check)
        .toMatchObject({ verified: true });
      expect(cite('بعد ٣ أشهر عاد إلى المدينة.', { excerpt: 'بعد ٣ أشهر', amount: 3, unit: 'months', asserts: 'now' }).check)
        .toMatchObject({ verified: true });
    });

    test('holds an invented excerpt to a week', () => {
      const resolved = cite('They rested by the fire.', { excerpt: 'Three months later', amount: 3, unit: 'months', asserts: 'now' });

      expect(resolved.statedSpan).toBeNull();
      expect(resolved.check).toMatchObject({ verified: false, reason: 'excerpt-not-found' });
      const result = frame('turn-invented', turn(resolved, skip(3)));
      expect(result.advance).toMatchObject({ clamped: true, duration: { days: 7 }, spanCheck: { verified: false } });
    });

    test('refuses an amount the digits in the excerpt contradict', () => {
      expect(cite('3か月後、鍛冶場は冷えていた。', { excerpt: '3か月後', amount: 5, unit: 'months', asserts: 'now' }).check)
        .toMatchObject({ verified: false, reason: 'amount-mismatch' });
      expect(cite('Three months later, the forge was cold.', { excerpt: 'Three months later', amount: 3, unit: 'years', asserts: 'now' }).check)
        .toMatchObject({ verified: false, reason: 'amount-mismatch' });
    });

    test('lets a framing span lift the ceiling without moving the clock', () => {
      const resolved = cite('After six weeks on the road, they reached Kesh.', { excerpt: 'After six weeks', amount: 6, unit: 'weeks', asserts: 'framing' });

      expect(resolved.statedSpan).toMatchObject({ strength: 'weak' });
      expect(frame('turn-framing', { statedSpan: resolved.statedSpan, spanCheck: resolved.check }).advance).toBeNull();
    });

    test('moves nothing for recounted history, even where the text reads like a skip', () => {
      const resolved = cite('Two years later the plague ended, the old songs say.', { excerpt: 'Two years later the plague ended', amount: 2, unit: 'years', asserts: 'history' });

      expect(resolved.check).toMatchObject({ verified: true, asserts: 'history' });
      expect(resolved.statedSpan).toBeNull();
    });

    test('falls back to the span read from the text when nothing is cited', () => {
      expect(cite('Two years later, Corwin returned to Lowmere.', null).statedSpan)
        .toMatchObject({ strength: 'strong', source: 'text' });
    });
  });

  test('leaves a turn that stayed in one place untouched', () => {
    const result = frame('turn-still', null, 0);

    expect(result.advance).toBeNull();
  });

  test('moves the campaign clock by the floor it applied', () => {
    const before = calendarService.getRoleplayClock(db, WORKSPACE);
    frame('turn-clock', null, calendarService.matrixMinimumMinutes(matrix(), 'transit'));
    const after = calendarService.getRoleplayClock(db, WORKSPACE);

    expect(after.hour * 60 + after.minute).toBe(before.hour * 60 + before.minute + 30);
  });
});
