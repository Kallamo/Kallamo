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
    for (const [id, name] of [['street', 'Artisan Street'], ['lookout', 'Dawn Lookout']]) {
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

  /* Confidence is not a signal here. The interpreter reports 0 for perfectly ordinary
     advances, so treating it as a gate simply stopped the campaign clock. */
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
      expect(span('Passaram-se três meses desde a queda do Poço 04.')).toMatchObject({ strength: 'strong' });
      expect(span('Dois anos depois, Kepler voltou a Ocarina.')).toMatchObject({ strength: 'strong' });
      expect(span('Three years later the forge reopened.')).toMatchObject({ strength: 'strong' });
      expect(span('No dia seguinte, Alistair chamou Nex.')).toMatchObject({ strength: 'strong' });
      // Framing, not a skip: it reads the same inside a flashback.
      expect(span('Após seis semanas de viagem, chegaram a Zeth.')).toMatchObject({ strength: 'weak' });
      // History about the world, not time passing in this turn.
      expect(span('A praga permaneceu ativa durante quatorze meses.')).toBeNull();
      expect(span('Ele caminhou até a oficina de Hakan.')).toBeNull();
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
      const stated = span('Passaram-se três meses desde a queda do Poço 04.');
      const advance = calendarService.normalizeTimeAdvance(
        { actionType: 'skip', basis: 'matrix', duration: { years: 0, months: 0, days: 90, hours: 0, minutes: 0 }, confidence: 0.9, statedSpan: stated },
        calendar(),
        calendarService.getRoleplayClock(db, WORKSPACE)
      );

      expect(advance).toMatchObject({ duration: { days: 90 } });
      expect(advance).not.toHaveProperty('clamped');
    });

    test('holds a skip to the span that was stated, not the one that was asked for', () => {
      const stated = span('Passaram-se três meses desde a queda do Poço 04.');
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
      const stated = span('Passaram-se dois anos e Kepler voltou a Ocarina.');
      const before = calendarService.getRoleplayClock(db, WORKSPACE);

      const result = frame('turn-skip', { statedSpan: stated });

      expect(result.advance).toMatchObject({ actionType: 'stated_time_skip', raisedToMinimum: true });
      expect(calendarService.getRoleplayClock(db, WORKSPACE).year).toBe(before.year + 2);
    });

    test('never lets a merely framed span move the clock on its own', () => {
      const stated = span('Após seis semanas de viagem, chegaram a Zeth.');

      const result = frame('turn-weak-span', { statedSpan: stated });

      expect(result.advance).toBeNull();
    });

    test('prefers the stated skip over the travel floor when it is longer', () => {
      const stated = span('Um mês depois, a oficina reabriu.');

      const result = frame('turn-skip-over-travel', { statedSpan: stated }, 30);

      expect(result.advance).toMatchObject({ actionType: 'stated_time_skip' });
      expect(calendarService.durationTotalMinutes(calendar(), result.advance.duration)).toBe(stated.minutes);
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
