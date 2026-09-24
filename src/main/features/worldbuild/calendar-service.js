const STANDARD_MONTHS = [
  ['January', 31], ['February', 28], ['March', 31], ['April', 30],
  ['May', 31], ['June', 30], ['July', 31], ['August', 31],
  ['September', 30], ['October', 31], ['November', 30], ['December', 31]
];

const DEFAULT_CALENDAR = Object.freeze({
  version: 1,
  name: 'Standard Calendar',
  hoursPerDay: 24,
  minutesPerHour: 60,
  months: STANDARD_MONTHS.map(([name, days], index) => ({ id: `month-${index + 1}`, name, days })),
  weekdays: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  epochWeekday: 1,
  leapRule: { type: 'gregorian', month: 2, extraDays: 1 },
  eras: [
    { id: 'bce', name: 'Before Common Era', shortName: 'BCE', direction: 'backward', offset: 0 },
    { id: 'ce', name: 'Common Era', shortName: 'CE', direction: 'forward', offset: 1 }
  ],
  defaultEraId: 'ce',
  seasons: []
});

function buildDefaultTimeMatrix(hoursPerDay = DEFAULT_CALENDAR.hoursPerDay) {
  const minutesPerDay = positiveInteger(hoursPerDay, DEFAULT_CALENDAR.hoursPerDay) * 60;
  return {
    version: 1,
    categories: [
      {
        id: 'micro',
        name: 'Micro',
        minimumMinutes: 1,
        maximumMinutes: 5,
        guidance: 'Dialogue lines, combat rounds, lockpicking, and quick visual scans.'
      },
      {
        id: 'local',
        name: 'Local',
        minimumMinutes: 10,
        maximumMinutes: 15,
        guidance: 'Walking within the same district, patching wounds, and careful room inspections.'
      },
      {
        id: 'transit',
        name: 'Transit',
        minimumMinutes: 30,
        maximumMinutes: 60,
        guidance: 'Cross-district travel, heavy crowds, minor gear repairs, and setting camp.'
      },
      {
        id: 'macro',
        name: 'Macro',
        minimumMinutes: 60,
        maximumMinutes: 480,
        guidance: 'Blacksmithing, deep study, resting, and inter-city travel. Use explicit narrative duration whenever available.'
      },
      {
        id: 'timeskip',
        name: 'Timeskip',
        minimumMinutes: minutesPerDay,
        maximumMinutes: minutesPerDay * 365,
        guidance: 'Downtime, long recovery, waiting, long-distance travel, and other transitions spanning days, months, or years. A skip longer than a week has to be stated in the narrative or by the player.'
      }
    ]
  };
}

const DEFAULT_TIME_MATRIX = Object.freeze(buildDefaultTimeMatrix());

const DATE_FIELDS = [
  ['startDate', 'Start date'],
  ['endDate', 'End date'],
  ['birthDate', 'Birth date'],
  ['deathDate', 'Death date'],
  ['missingDate', 'Disappearance date']
];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function parseObject(value, fallback = {}) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(String(value || ''));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function positiveInteger(value, fallback = 1) {
  const number = Math.floor(Number(value));
  return Number.isFinite(number) && number > 0 ? number : fallback;
}

function integer(value, fallback = 0) {
  const number = Math.trunc(Number(value));
  return Number.isFinite(number) ? number : fallback;
}

function modulo(value, divisor) {
  return ((value % divisor) + divisor) % divisor;
}

function normalizeCalendar(input) {
  const source = parseObject(input, {});
  const months = Array.isArray(source.months) && source.months.length
    ? source.months.map((month, index) => ({
      id: String(month?.id || `month-${index + 1}`),
      name: String(month?.name || `Month ${index + 1}`).trim() || `Month ${index + 1}`,
      days: positiveInteger(month?.days, 30)
    }))
    : clone(DEFAULT_CALENDAR.months);
  const weekdays = Array.isArray(source.weekdays) && source.weekdays.length
    ? source.weekdays.map((name, index) => String(name || `Day ${index + 1}`).trim() || `Day ${index + 1}`)
    : clone(DEFAULT_CALENDAR.weekdays);
  const eras = Array.isArray(source.eras) && source.eras.length
    ? source.eras.map((era, index) => ({
      id: String(era?.id || `era-${index + 1}`),
      name: String(era?.name || `Era ${index + 1}`).trim() || `Era ${index + 1}`,
      shortName: String(era?.shortName || era?.name || `E${index + 1}`).trim() || `E${index + 1}`,
      direction: era?.direction === 'backward' ? 'backward' : 'forward',
      offset: integer(era?.offset, index === 0 ? 1 : 0)
    }))
    : clone(DEFAULT_CALENDAR.eras);
  const eraIds = new Set(eras.map(era => era.id));
  const seasons = Array.isArray(source.seasons)
    ? source.seasons.map((season, index) => {
      const startMonth = Math.max(1, Math.min(months.length, positiveInteger(season?.start?.month, 1)));
      const endMonth = Math.max(1, Math.min(months.length, positiveInteger(season?.end?.month, months.length)));
      return {
        id: String(season?.id || `season-${index + 1}`),
        name: String(season?.name || `Season ${index + 1}`).trim() || `Season ${index + 1}`,
        color: /^#[0-9a-f]{6}$/i.test(String(season?.color || '')) ? season.color : '#6ee7b7',
        description: String(season?.description || '').trim(),
        start: {
          month: startMonth,
          day: Math.min(months[startMonth - 1]?.days || 1, positiveInteger(season?.start?.day, 1))
        },
        end: {
          month: endMonth,
          day: Math.min(months[endMonth - 1]?.days || 1, positiveInteger(season?.end?.day, months[endMonth - 1]?.days || 1))
        }
      };
    })
    : [];
  const leapRule = source.leapRule?.type === 'gregorian'
    ? {
      type: 'gregorian',
      month: Math.max(1, Math.min(months.length, positiveInteger(source.leapRule.month, 2))),
      extraDays: positiveInteger(source.leapRule.extraDays, 1)
    }
    : { type: 'none' };
  return {
    version: 1,
    name: String(source.name || DEFAULT_CALENDAR.name).trim() || DEFAULT_CALENDAR.name,
    hoursPerDay: Math.max(1, Math.min(100, positiveInteger(source.hoursPerDay, 24))),
    minutesPerHour: 60,
    months,
    weekdays,
    epochWeekday: modulo(integer(source.epochWeekday, 1), weekdays.length),
    leapRule,
    eras,
    defaultEraId: eraIds.has(source.defaultEraId) ? source.defaultEraId : eras[eras.length - 1].id,
    seasons
  };
}

function normalizeTimeMatrix(input, hoursPerDay = DEFAULT_CALENDAR.hoursPerDay) {
  const source = parseObject(input, {});
  const defaults = new Map(buildDefaultTimeMatrix(hoursPerDay).categories.map(category => [category.id, category]));
  const categories = ['micro', 'local', 'transit', 'macro', 'timeskip'].map(id => {
    const category = Array.isArray(source.categories)
      ? source.categories.find(candidate => candidate?.id === id)
      : null;
    const fallback = defaults.get(id);
    const minimumMinutes = positiveInteger(category?.minimumMinutes, fallback.minimumMinutes);
    return {
      id,
      name: String(category?.name || fallback.name).trim() || fallback.name,
      minimumMinutes,
      maximumMinutes: Math.max(minimumMinutes, positiveInteger(category?.maximumMinutes, fallback.maximumMinutes)),
      guidance: String(category?.guidance || fallback.guidance).trim()
    };
  });
  return { version: 1, categories };
}

function getCalendar(db, workspaceId) {
  const row = db.prepare('SELECT definition_json FROM worldbuild_calendars WHERE workspace_id = ?')
    .get(workspaceId);
  if (row) return normalizeCalendar(row.definition_json);
  const calendar = normalizeCalendar(DEFAULT_CALENDAR);
  db.prepare(`
    INSERT OR IGNORE INTO worldbuild_calendars (workspace_id, definition_json, updated_at)
    VALUES (?, ?, ?)
  `).run(workspaceId, JSON.stringify(calendar), Date.now());
  return calendar;
}

function getTimeMatrix(db, workspaceId) {
  const calendar = getCalendar(db, workspaceId);
  const row = db.prepare('SELECT matrix_json FROM roleplay_time_matrices WHERE workspace_id = ?')
    .get(workspaceId);
  if (row) return normalizeTimeMatrix(row.matrix_json, calendar.hoursPerDay);
  const matrix = normalizeTimeMatrix(null, calendar.hoursPerDay);
  db.prepare(`
    INSERT OR IGNORE INTO roleplay_time_matrices (workspace_id, matrix_json, updated_at)
    VALUES (?, ?, ?)
  `).run(workspaceId, JSON.stringify(matrix), Date.now());
  return matrix;
}

function saveTimeMatrix(db, workspaceId, input) {
  const calendar = getCalendar(db, workspaceId);
  const matrix = normalizeTimeMatrix(input, calendar.hoursPerDay);
  db.prepare(`
    INSERT INTO roleplay_time_matrices (workspace_id, matrix_json, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET
      matrix_json = excluded.matrix_json,
      updated_at = excluded.updated_at
  `).run(workspaceId, JSON.stringify(matrix), Date.now());
  return matrix;
}

function isLeapYear(calendar, absoluteYear) {
  if (calendar.leapRule?.type !== 'gregorian') return false;
  return modulo(absoluteYear, 4) === 0
    && (modulo(absoluteYear, 100) !== 0 || modulo(absoluteYear, 400) === 0);
}

function daysInMonth(calendar, absoluteYear, month) {
  const base = calendar.months[month - 1]?.days || 1;
  return base + (
    isLeapYear(calendar, absoluteYear) && calendar.leapRule?.month === month
      ? calendar.leapRule.extraDays
      : 0
  );
}

function absoluteYearFor(calendar, date) {
  const era = calendar.eras.find(candidate => candidate.id === date.eraId)
    || calendar.eras.find(candidate => candidate.id === calendar.defaultEraId)
    || calendar.eras[0];
  const year = positiveInteger(date.year, 1);
  return era.direction === 'backward'
    ? era.offset - (year - 1)
    : era.offset + (year - 1);
}

function displayYearFor(calendar, absoluteYear, preferredEraId) {
  const preferred = calendar.eras.find(era => era.id === preferredEraId);
  const ordered = preferred
    ? [preferred, ...calendar.eras.filter(era => era.id !== preferred.id)]
    : calendar.eras;
  for (const era of ordered) {
    const year = era.direction === 'backward'
      ? era.offset - absoluteYear + 1
      : absoluteYear - era.offset + 1;
    if (year >= 1) return { eraId: era.id, year };
  }
  return { eraId: calendar.defaultEraId, year: Math.max(1, Math.abs(absoluteYear)) };
}

function validateDate(calendar, input) {
  const date = parseObject(input, {});
  const era = calendar.eras.find(candidate => candidate.id === date.eraId);
  const month = integer(date.month);
  const day = integer(date.day);
  const year = integer(date.year);
  if (!era || year < 1 || month < 1 || month > calendar.months.length) return false;
  return day >= 1 && day <= daysInMonth(calendar, absoluteYearFor(calendar, date), month);
}

function clampDate(calendar, input) {
  const date = parseObject(input, {});
  const eraId = calendar.eras.some(era => era.id === date.eraId) ? date.eraId : calendar.defaultEraId;
  const year = positiveInteger(date.year, 1);
  const month = Math.max(1, Math.min(calendar.months.length, positiveInteger(date.month, 1)));
  const absoluteYear = absoluteYearFor(calendar, { eraId, year });
  const day = Math.max(1, Math.min(daysInMonth(calendar, absoluteYear, month), positiveInteger(date.day, 1)));
  return { eraId, year, month, day };
}

function daysBeforeYear(calendar, absoluteYear) {
  const baseDays = calendar.months.reduce((sum, month) => sum + month.days, 0);
  if (calendar.leapRule?.type !== 'gregorian') return (absoluteYear - 1) * baseDays;
  const year = absoluteYear - 1;
  return year * baseDays
    + Math.floor(year / 4)
    - Math.floor(year / 100)
    + Math.floor(year / 400);
}

function toOrdinal(calendar, input) {
  const date = clampDate(calendar, input);
  const absoluteYear = absoluteYearFor(calendar, date);
  let ordinal = daysBeforeYear(calendar, absoluteYear);
  for (let month = 1; month < date.month; month += 1) {
    ordinal += daysInMonth(calendar, absoluteYear, month);
  }
  return ordinal + date.day - 1;
}

function yearForOrdinal(calendar, ordinal) {
  let low = -1000000;
  let high = 1000001;
  while (low + 1 < high) {
    const middle = Math.floor((low + high) / 2);
    if (daysBeforeYear(calendar, middle) <= ordinal) low = middle;
    else high = middle;
  }
  return low;
}

function fromOrdinal(calendar, ordinal, preferredEraId) {
  const absoluteYear = yearForOrdinal(calendar, ordinal);
  let dayOfYear = ordinal - daysBeforeYear(calendar, absoluteYear);
  let month = 1;
  while (month < calendar.months.length) {
    const length = daysInMonth(calendar, absoluteYear, month);
    if (dayOfYear < length) break;
    dayOfYear -= length;
    month += 1;
  }
  return { ...displayYearFor(calendar, absoluteYear, preferredEraId), month, day: dayOfYear + 1 };
}

function normalizePosition(calendar, input) {
  const date = clampDate(calendar, input);
  return {
    ...date,
    hour: Math.max(0, Math.min(calendar.hoursPerDay - 1, integer(input?.hour))),
    minute: Math.max(0, Math.min(59, integer(input?.minute)))
  };
}

function addDuration(calendar, input, durationInput) {
  const duration = parseObject(durationInput, {});
  let position = normalizePosition(calendar, input);
  let absoluteYear = absoluteYearFor(calendar, position) + integer(duration.years);
  let absoluteMonth = absoluteYear * calendar.months.length + (position.month - 1) + integer(duration.months);
  absoluteYear = Math.floor(absoluteMonth / calendar.months.length);
  const month = modulo(absoluteMonth, calendar.months.length) + 1;
  const displayYear = displayYearFor(calendar, absoluteYear, position.eraId);
  position = {
    ...displayYear,
    month,
    day: Math.min(position.day, daysInMonth(calendar, absoluteYear, month)),
    hour: position.hour,
    minute: position.minute
  };
  let ordinal = toOrdinal(calendar, position) + integer(duration.days);
  let minutes = position.hour * 60 + position.minute
    + integer(duration.hours) * 60
    + integer(duration.minutes);
  const minutesPerDay = calendar.hoursPerDay * 60;
  ordinal += Math.floor(minutes / minutesPerDay);
  minutes = modulo(minutes, minutesPerDay);
  return {
    ...fromOrdinal(calendar, ordinal, position.eraId),
    hour: Math.floor(minutes / 60),
    minute: minutes % 60
  };
}

function defaultClockPosition(calendar) {
  const now = new Date();
  if (calendar.name === DEFAULT_CALENDAR.name && calendar.defaultEraId === 'ce') {
    return clampDate(calendar, {
      eraId: 'ce',
      year: now.getFullYear(),
      month: now.getMonth() + 1,
      day: now.getDate()
    });
  }
  return { eraId: calendar.defaultEraId, year: 1, month: 1, day: 1 };
}

function getRoleplayClock(db, workspaceId) {
  const calendar = getCalendar(db, workspaceId);
  const row = db.prepare('SELECT position_json, version FROM roleplay_time_state WHERE workspace_id = ?')
    .get(workspaceId);
  if (row) {
    const position = normalizePosition(calendar, parseObject(row.position_json, {}));
    return decoratePosition(calendar, position, row.version);
  }
  const date = defaultClockPosition(calendar);
  const now = new Date();
  const position = normalizePosition(calendar, {
    ...date,
    hour: calendar.name === DEFAULT_CALENDAR.name ? now.getHours() : 8,
    minute: calendar.name === DEFAULT_CALENDAR.name ? now.getMinutes() : 0
  });
  db.prepare(`
    INSERT OR IGNORE INTO roleplay_time_state (workspace_id, position_json, version, updated_at)
    VALUES (?, ?, 1, ?)
  `).run(workspaceId, JSON.stringify(position), Date.now());
  return decoratePosition(calendar, position, 1);
}

function seasonFor(calendar, position) {
  const ordinal = monthDayOrdinal(calendar, position.month, position.day);
  return calendar.seasons.find(season => {
    const start = monthDayOrdinal(calendar, season.start.month, season.start.day);
    const end = monthDayOrdinal(calendar, season.end.month, season.end.day);
    return start <= end
      ? ordinal >= start && ordinal <= end
      : ordinal >= start || ordinal <= end;
  }) || null;
}

function monthDayOrdinal(_calendar, month, day) {
  return month * 1000 + day;
}

function decoratePosition(calendar, position, version) {
  const normalized = normalizePosition(calendar, position);
  const era = calendar.eras.find(candidate => candidate.id === normalized.eraId);
  const weekdayIndex = modulo(toOrdinal(calendar, normalized) + calendar.epochWeekday, calendar.weekdays.length);
  return {
    ...normalized,
    version,
    monthName: calendar.months[normalized.month - 1]?.name || `Month ${normalized.month}`,
    eraName: era?.name || '',
    eraShortName: era?.shortName || '',
    weekdayName: calendar.weekdays[weekdayIndex] || '',
    season: seasonFor(calendar, normalized)
  };
}

function saveRoleplayClock(db, workspaceId, input) {
  const calendar = getCalendar(db, workspaceId);
  if (!validateDate(calendar, input)) throw new Error('Choose a valid calendar date.');
  const position = normalizePosition(calendar, input);
  const current = getRoleplayClock(db, workspaceId);
  const version = current.version + 1;
  db.prepare(`
    INSERT INTO roleplay_time_state (workspace_id, position_json, version, updated_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(workspace_id) DO UPDATE SET
      position_json = excluded.position_json,
      version = excluded.version,
      updated_at = excluded.updated_at
  `).run(workspaceId, JSON.stringify(position), version, Date.now());
  return decoratePosition(calendar, position, version);
}

function entityName(db, workspaceId, id) {
  if (!id) return null;
  return db.prepare('SELECT canonicalName FROM entities WHERE workspaceId = ? AND id = ?')
    .get(workspaceId, id)?.canonicalName || null;
}

function framePoint(db, workspaceId, clock, locationId) {
  return {
    position: {
      eraId: clock.eraId,
      year: clock.year,
      month: clock.month,
      day: clock.day,
      hour: clock.hour,
      minute: clock.minute
    },
    display: {
      monthName: clock.monthName,
      eraShortName: clock.eraShortName,
      weekdayName: clock.weekdayName,
      season: clock.season
    },
    locationId: locationId || null,
    locationName: entityName(db, workspaceId, locationId)
  };
}

function durationToPosition(calendar, startInput, targetInput) {
  if (!targetInput || !validateDate(calendar, targetInput)) return null;
  const start = normalizePosition(calendar, startInput);
  const target = normalizePosition(calendar, targetInput);
  const minutesPerDay = calendar.hoursPerDay * 60;
  const totalMinutes = (toOrdinal(calendar, target) - toOrdinal(calendar, start)) * minutesPerDay
    + (target.hour - start.hour) * 60
    + target.minute - start.minute;
  if (totalMinutes <= 0) return null;
  return {
    duration: {
      years: 0,
      months: 0,
      days: Math.floor(totalMinutes / minutesPerDay),
      hours: Math.floor((totalMinutes % minutesPerDay) / 60),
      minutes: totalMinutes % 60
    },
    targetPosition: target
  };
}

/**
 * A single turn may not silently skip a season.
 *
 * An inferred advance is the interpreter's estimate of how long an action took. When that
 * estimate is wrong it is written straight into the campaign clock, and a hallucinated
 * "three years" is both catastrophic and almost invisible: no record says the clock moved for
 * a bad reason. So an inferred advance is bounded, and what was asked for is kept beside what
 * was applied instead of being thrown away. A date the narrative actually states arrives as an
 * explicit target and is never bounded, because there the author said it.
 */
const IMPLICIT_ADVANCE_LIMIT_DAYS = 7;
const MAX_TIMESKIP_YEARS = 100;

/**
 * How far a single turn is allowed to move the clock without the narrative saying so.
 *
 * A week is all an estimate earns. Beyond that the turn has to have stated the span in words,
 * and then the ceiling is the span itself: "passaram-se tres meses" authorizes three months
 * and nothing more. The cap on top is there so a parsed absurdity is still an absurdity that
 * ends somewhere.
 */
function advanceCeilingMinutes(calendar, statedSpan) {
  const implicit = IMPLICIT_ADVANCE_LIMIT_DAYS * calendar.hoursPerDay * 60;
  const stated = Math.max(0, integer(statedSpan?.minutes));
  return Math.min(Math.max(implicit, stated), spanToMinutes(calendar, 'years', MAX_TIMESKIP_YEARS));
}

function boundImplicitDuration(calendar, duration, ceilingMinutes) {
  const total = durationTotalMinutes(calendar, duration);
  if (total <= ceilingMinutes) return { duration, clamped: false };
  return { duration: minutesToDuration(calendar, ceilingMinutes), clamped: true };
}

function normalizeTimeAdvance(input, calendar = null, currentClock = null) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const durationInput = parseObject(input.duration, {});
  let duration = {
    years: Math.max(0, integer(durationInput.years)),
    months: Math.max(0, integer(durationInput.months)),
    days: Math.max(0, integer(durationInput.days)),
    hours: Math.max(0, integer(durationInput.hours)),
    minutes: Math.max(0, integer(durationInput.minutes))
  };
  const explicitTarget = calendar && currentClock
    ? durationToPosition(calendar, currentClock, input.targetPosition)
    : null;
  if (explicitTarget) duration = explicitTarget.duration;
  const basis = input.basis === 'explicit' ? 'explicit' : 'matrix';
  const confidence = Math.max(0, Math.min(1, Number(input.confidence) || 0));
  let clamped = false;
  let requested = null;
  if (!explicitTarget && basis !== 'explicit') {
    // Confidence is deliberately not a gate here. In practice the interpreter reports 0 for
    // perfectly ordinary advances, so refusing those simply stopped the clock; the bound on
    // magnitude is what actually protects the campaign.
    const scale = calendar || normalizeCalendar(DEFAULT_CALENDAR);
    const bounded = boundImplicitDuration(scale, duration, advanceCeilingMinutes(scale, input.statedSpan));
    if (bounded.clamped) {
      requested = duration;
      clamped = true;
      duration = bounded.duration;
    }
  }
  if (!Object.values(duration).some(Boolean)) return null;
  return {
    actionType: String(input.actionType || 'elapsed_time').slice(0, 80),
    basis,
    duration,
    targetPosition: explicitTarget?.targetPosition ?? null,
    confidence,
    evidence: String(input.evidence || '').slice(0, 500),
    ...(clamped ? { clamped: true, requestedDuration: requested } : {})
  };
}

/**
 * Reading a stated passage of time out of the turn's own words.
 *
 * A long jump must not rest on the interpreter's estimate. Estimates are how a hallucinated
 * "three years" reaches the campaign clock, and nothing afterwards says the clock moved for a
 * bad reason. So the text is the authority: a span the narrative or the player actually wrote
 * is what authorizes months and years, and everything else stays bounded to a week.
 *
 * Markers are split by how much they promise. A strong marker asserts that the time has gone
 * by ("passaram-se tres meses", "two years later"), so it can both raise the ceiling and set a
 * floor. A weak marker only frames a span ("apos tres meses"), which reads the same in a
 * flashback, so it lifts the ceiling without ever moving the clock on its own.
 */
const SPAN_NUMBER_WORDS = new Map([
  ['um', 1], ['uma', 1], ['dois', 2], ['duas', 2], ['tres', 3], ['quatro', 4], ['cinco', 5],
  ['seis', 6], ['sete', 7], ['oito', 8], ['nove', 9], ['dez', 10], ['onze', 11], ['doze', 12],
  ['quinze', 15], ['vinte', 20], ['trinta', 30], ['quarenta', 40], ['cinquenta', 50], ['cem', 100],
  ['a', 1], ['an', 1], ['one', 1], ['two', 2], ['three', 3], ['four', 4], ['five', 5],
  ['six', 6], ['seven', 7], ['eight', 8], ['nine', 9], ['ten', 10], ['eleven', 11],
  ['twelve', 12], ['fifteen', 15], ['twenty', 20], ['thirty', 30], ['fifty', 50], ['hundred', 100]
]);

const SPAN_UNITS = new Map([
  ['minuto', 'minutes'], ['minutos', 'minutes'], ['minute', 'minutes'], ['minutes', 'minutes'],
  ['hora', 'hours'], ['horas', 'hours'], ['hour', 'hours'], ['hours', 'hours'],
  ['dia', 'days'], ['dias', 'days'], ['day', 'days'], ['days', 'days'],
  ['semana', 'weeks'], ['semanas', 'weeks'], ['week', 'weeks'], ['weeks', 'weeks'],
  ['mes', 'months'], ['meses', 'months'], ['month', 'months'], ['months', 'months'],
  ['ano', 'years'], ['anos', 'years'], ['year', 'years'], ['years', 'years'],
  ['decada', 'decades'], ['decadas', 'decades'], ['decade', 'decades'], ['decades', 'decades']
]);

const SPAN_UNIT_PATTERN = [...SPAN_UNITS.keys()].join('|');
const SPAN_QUANTITY_PATTERN = '\\d{1,4}|' + [...SPAN_NUMBER_WORDS.keys()].join('|');
const STRONG_TRAILING = 'depois|mais tarde|adiante|se passaram|se passou|passaram|passou|later|afterwards|afterward|passed|went by';
const WEAK_LEADING = 'apos|depois de|depois da|depois do|over the next|for the next|across the next';
const STRONG_LEADING = 'passaram-se|passou-se|se passaram|se passou|transcorreram|decorridos|decorreram';

function spanPattern(source) {
  return new RegExp(source, 'g');
}

const SPAN_PATTERNS = [
  { strength: 'strong', pattern: spanPattern('\\b(?:' + STRONG_LEADING + ')\\s+(' + SPAN_QUANTITY_PATTERN + ')\\s+(' + SPAN_UNIT_PATTERN + ')\\b') },
  { strength: 'strong', pattern: spanPattern('\\b(' + SPAN_QUANTITY_PATTERN + ')\\s+(' + SPAN_UNIT_PATTERN + ')\\s+(?:' + STRONG_TRAILING + ')\\b') },
  { strength: 'weak', pattern: spanPattern('\\b(?:' + WEAK_LEADING + ')\\s+(' + SPAN_QUANTITY_PATTERN + ')\\s+(' + SPAN_UNIT_PATTERN + ')\\b') }
];

/** Fixed phrases that name a span without a quantity. */
const SPAN_PHRASES = [
  { strength: 'strong', unit: 'days', amount: 1, pattern: /\b(?:no dia seguinte|na manha seguinte|na noite seguinte|next day|next morning|the following day|the following morning)\b/ },
  { strength: 'strong', unit: 'weeks', amount: 1, pattern: /\b(?:na semana seguinte|next week|the following week)\b/ },
  { strength: 'strong', unit: 'months', amount: 1, pattern: /\b(?:no mes seguinte|next month|the following month)\b/ },
  { strength: 'strong', unit: 'years', amount: 1, pattern: /\b(?:no ano seguinte|next year|the following year)\b/ }
];

function normalizeSpanText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLowerCase();
}

function spanQuantity(token) {
  const numeric = Number(token);
  if (Number.isFinite(numeric)) return Math.max(0, Math.min(9999, Math.round(numeric)));
  return SPAN_NUMBER_WORDS.get(token) ?? 0;
}

function spanToMinutes(calendar, unit, amount) {
  const minutesPerDay = calendar.hoursPerDay * 60;
  const daysPerYear = calendar.months.reduce((total, month) => total + month.days, 0) || 365;
  const daysPerMonth = Math.max(1, Math.round(daysPerYear / Math.max(1, calendar.months.length)));
  const perUnit = {
    minutes: 1,
    hours: 60,
    days: minutesPerDay,
    weeks: minutesPerDay * Math.max(1, calendar.weekdays.length),
    months: minutesPerDay * daysPerMonth,
    years: minutesPerDay * daysPerYear,
    decades: minutesPerDay * daysPerYear * 10
  };
  return (perUnit[unit] || 0) * amount;
}

/**
 * The longest span the text actually asserts, in minutes, with how firmly it asserts it.
 * Returns null when the turn says nothing about elapsed time.
 */
function extractElapsedSpan(calendar, text) {
  const source = normalizeSpanText(text);
  if (!source) return null;
  let best = null;
  const consider = (strength, minutes, evidence) => {
    if (!(minutes > 0)) return;
    const rank = strength === 'strong' ? 1 : 0;
    if (best && (best.minutes > minutes || (best.minutes === minutes && best.rank >= rank))) return;
    best = { strength, rank, minutes, evidence };
  };
  for (const { strength, pattern } of SPAN_PATTERNS) {
    pattern.lastIndex = 0;
    for (const match of source.matchAll(pattern)) {
      const unit = SPAN_UNITS.get(match[2]);
      if (!unit) continue;
      consider(strength, spanToMinutes(calendar, unit, spanQuantity(match[1])), match[0].trim().slice(0, 120));
    }
  }
  for (const phrase of SPAN_PHRASES) {
    const match = phrase.pattern.exec(source);
    if (match) consider(phrase.strength, spanToMinutes(calendar, phrase.unit, phrase.amount), match[0]);
  }
  return best ? { strength: best.strength, minutes: best.minutes, evidence: best.evidence } : null;
}

function durationTotalMinutes(calendar, duration) {
  const minutesPerDay = calendar.hoursPerDay * 60;
  const days = integer(duration?.days) + integer(duration?.months) * 30 + integer(duration?.years) * 365;
  return days * minutesPerDay + integer(duration?.hours) * 60 + integer(duration?.minutes);
}

function minutesToDuration(calendar, totalMinutes) {
  const minutesPerDay = calendar.hoursPerDay * 60;
  const minutes = Math.max(0, Math.round(totalMinutes));
  return {
    years: 0,
    months: 0,
    days: Math.floor(minutes / minutesPerDay),
    hours: Math.floor((minutes % minutesPerDay) / 60),
    minutes: minutes % 60
  };
}

/** The floor a Time Cost Matrix category sets, or zero when the category is not configured. */
function matrixMinimumMinutes(matrix, categoryId) {
  const categories = Array.isArray(matrix?.categories) ? matrix.categories : [];
  const category = categories.find(candidate => candidate.id === categoryId);
  return Math.max(0, integer(category?.minimumMinutes));
}

/**
 * A journey costs at least what the world says it costs.
 *
 * The interpreter estimates elapsed time from the prose, and prose about walking somewhere is
 * often two lines long, so a crossing of the city was arriving as zero minutes or as two. The
 * turn already knows where it started and where it ended, and the campaign already carries a
 * Time Cost Matrix, so the floor comes from the author's own configuration rather than from a
 * guess. An explicit clock in the narrative outranks it: there the author said the time.
 */
function enforceMinimumAdvance(advance, minimumMinutes, calendar, actionType) {
  if (!(minimumMinutes > 0)) return advance;
  if (advance?.basis === 'explicit' || advance?.targetPosition) return advance;
  const current = advance ? durationTotalMinutes(calendar, advance.duration) : 0;
  if (current >= minimumMinutes) return advance;
  return {
    actionType: advance?.actionType || actionType,
    basis: 'matrix',
    duration: minutesToDuration(calendar, minimumMinutes),
    targetPosition: null,
    confidence: advance?.confidence ?? 0,
    evidence: advance?.evidence || '',
    raisedToMinimum: true,
    ...(advance ? { requestedDuration: advance.duration } : {})
  };
}

function applyRoleplayTurnFrame(db, {
  workspaceId,
  originId,
  startClock,
  startLocationId,
  endLocationId,
  timeAdvance,
  minimumMinutes = 0,
  minimumActionType = 'travel_between_locations'
}) {
  const existing = db.prepare(`
    SELECT start_json, end_json, advance_json FROM roleplay_message_frames
    WHERE workspace_id = ? AND origin_id = ?
  `).get(workspaceId, originId);
  if (existing) return hydrateFrame(originId, existing);
  const calendar = getCalendar(db, workspaceId);
  const currentClock = startClock || getRoleplayClock(db, workspaceId);
  // A span the turn stated outright is a floor of its own: the interpreter routinely prices
  // "passaram-se tres meses" as a few minutes of dialogue, and only a strong marker is
  // allowed to move the clock this way, because a weak one reads the same in a flashback.
  const statedSpan = timeAdvance && typeof timeAdvance === 'object' ? timeAdvance.statedSpan : null;
  const statedFloor = statedSpan?.strength === 'strong' ? Math.max(0, integer(statedSpan.minutes)) : 0;
  const floorMinutes = Math.max(Math.max(0, integer(minimumMinutes)), statedFloor);
  const normalizedAdvance = enforceMinimumAdvance(
    normalizeTimeAdvance(timeAdvance, calendar, currentClock),
    floorMinutes,
    calendar,
    statedFloor >= Math.max(0, integer(minimumMinutes)) && statedFloor > 0 ? 'stated_time_skip' : minimumActionType
  );
  let endClock = currentClock;
  if (normalizedAdvance) {
    const nextPosition = addDuration(calendar, currentClock, normalizedAdvance.duration);
    endClock = saveRoleplayClock(db, workspaceId, nextPosition);
    db.prepare(`
      INSERT OR IGNORE INTO roleplay_time_advances
        (workspace_id, origin_id, start_json, end_json, advance_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(
      workspaceId,
      originId,
      JSON.stringify(currentClock),
      JSON.stringify(endClock),
      JSON.stringify(normalizedAdvance),
      Date.now()
    );
  }
  // The player can change between turns, so each frame keeps who was being played.
  const playerEntityId = db.prepare('SELECT player_entity_id FROM roleplay_workspace_settings WHERE workspace_id = ?')
    .get(workspaceId)?.player_entity_id || null;
  const player = { playerEntityId, playerName: entityName(db, workspaceId, playerEntityId) };
  const start = { ...framePoint(db, workspaceId, currentClock, startLocationId), ...player };
  const end = { ...framePoint(db, workspaceId, endClock, endLocationId), ...player };
  const now = Date.now();
  db.prepare(`
    INSERT INTO roleplay_message_frames
      (workspace_id, origin_id, start_json, end_json, advance_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    workspaceId,
    originId,
    JSON.stringify(start),
    JSON.stringify(end),
    normalizedAdvance ? JSON.stringify(normalizedAdvance) : null,
    now,
    now
  );
  return { originId, start, end, advance: normalizedAdvance };
}

function hydrateFrame(originId, row) {
  return {
    originId,
    start: parseObject(row.start_json, {}),
    end: parseObject(row.end_json, {}),
    advance: row.advance_json ? parseObject(row.advance_json, null) : null
  };
}

function decorateFrameWeekdays(calendar, frame) {
  const decoratePoint = point => {
    if (!point?.position) return point;
    const weekdayIndex = modulo(toOrdinal(calendar, point.position) + calendar.epochWeekday, calendar.weekdays.length);
    return { ...point, display: { ...(point.display || {}), weekdayName: calendar.weekdays[weekdayIndex] || '' } };
  };
  return { ...frame, start: decoratePoint(frame.start), end: decoratePoint(frame.end) };
}

function getMessageFrames(db, workspaceId, originIds) {
  const ids = [...new Set((originIds || []).map(String).filter(Boolean))];
  if (!ids.length) return [];
  const placeholders = ids.map(() => '?').join(',');
  const calendar = getCalendar(db, workspaceId);
  return db.prepare(`
    SELECT origin_id, start_json, end_json, advance_json
    FROM roleplay_message_frames
    WHERE workspace_id = ? AND origin_id IN (${placeholders})
  `).all(workspaceId, ...ids).map(row => decorateFrameWeekdays(calendar, hydrateFrame(row.origin_id, row)));
}

function listRecentMessageFrames(db, workspaceId, limit = 50) {
  const rows = db.prepare(`
    SELECT origin_id, start_json, end_json, advance_json, created_at
    FROM roleplay_message_frames
    WHERE workspace_id = ?
    ORDER BY created_at, origin_id
  `).all(workspaceId);
  const calendar = getCalendar(db, workspaceId);
  const start = Math.max(0, rows.length - Math.max(1, Number(limit) || 50));
  return rows.slice(start).map((row, index) => ({
    ...decorateFrameWeekdays(calendar, hydrateFrame(row.origin_id, row)),
    turnNumber: start + index + 1,
    createdAt: Number(row.created_at)
  }));
}

function formatClock(calendar, position) {
  const month = calendar.months[position.month - 1]?.name || `Month ${position.month}`;
  const era = calendar.eras.find(candidate => candidate.id === position.eraId);
  const weekdayIndex = modulo(toOrdinal(calendar, position) + calendar.epochWeekday, calendar.weekdays.length);
  return {
    date: `${position.day} ${month} ${position.year}${era?.shortName ? ` ${era.shortName}` : ''}`,
    time: `${String(position.hour).padStart(2, '0')}:${String(position.minute).padStart(2, '0')}`,
    weekday: calendar.weekdays[weekdayIndex] || ''
  };
}

function buildRoleplayTemporalContext(db, workspaceId) {
  const calendar = getCalendar(db, workspaceId);
  const clock = getRoleplayClock(db, workspaceId);
  const matrix = getTimeMatrix(db, workspaceId);
  const formatted = formatClock(calendar, clock);
  const todayEntries = getCalendarEntries(db, workspaceId, clock.year, clock.month, clock.eraId)
    .entries.filter(entry => entry.date.day === clock.day);
  return [
    '--- ROLEPLAY TIME ---',
    `Current narrative date: ${formatted.date}`,
    `Current narrative time: ${formatted.time}${formatted.weekday ? ` (${formatted.weekday})` : ''}`,
    ...(clock.season ? [`Current season: ${clock.season.name}${clock.season.description ? ` (${clock.season.description})` : ''}`] : []),
    ...(todayEntries.length
      ? ['Calendar entries today:', ...todayEntries.map(entry => `- ${entry.title} (${entry.kind})`)]
      : ['Calendar entries today: none']),
    `Calendar day length: ${calendar.hoursPerDay} hours`,
    'Time cost matrix:',
    ...matrix.categories.map(category => category.id === 'timeskip'
      ? `- ${category.name}: ${category.minimumMinutes / (calendar.hoursPerDay * 60)}-${category.maximumMinutes / (calendar.hoursPerDay * 60)} calendar days (${category.minimumMinutes}-${category.maximumMinutes} minutes). ${category.guidance}`
      : `- ${category.name}: ${category.minimumMinutes}-${category.maximumMinutes} minutes. ${category.guidance}`
    ),
    'Keep line-by-line dialogue and micro actions within the Micro range. Never warp time.',
    'When substantial time passes, reflect lighting, fatigue, schedules, and day changes in the narration.',
    'Explicit narrated duration takes precedence over matrix estimates.',
    'Kallamo renders date, time, location, and transitions outside the narrative text. Do not write a status header for them.',
    '--- END ROLEPLAY TIME ---'
  ].join('\n');
}

function collectInvalidDates(db, workspaceId, candidateCalendar) {
  const calendar = normalizeCalendar(candidateCalendar);
  const invalid = [];
  const rows = db.prepare(`
    SELECT id, type, canonicalName, data FROM entities
    WHERE workspaceId = ? AND status != 'proposed'
  `).all(workspaceId);
  for (const row of rows) {
    const data = parseObject(row.data, {});
    for (const [field, label] of DATE_FIELDS) {
      if ((field === 'startDate' || field === 'endDate') && (row.type !== 'Events' || data.eventNature === 'recurring')) continue;
      if ((field === 'birthDate' || field === 'deathDate' || field === 'missingDate')
        && row.type !== 'Characters' && row.type !== 'Creatures') continue;
      if ((field === 'birthDate' || field === 'deathDate' || field === 'missingDate')
        && row.type === 'Creatures' && data.scope === 'group') continue;
      if (field === 'deathDate' && data.status !== 'deceased') continue;
      if (field === 'missingDate' && data.status !== 'missing') continue;
      if (!data[field] || validateDate(calendar, data[field])) continue;
      invalid.push({
        key: `entity:${row.id}:${field}`,
        kind: 'entity',
        entityId: row.id,
        entityName: row.canonicalName,
        entityType: row.type,
        field,
        label,
        date: data[field],
        suggestedDate: clampDate(calendar, data[field])
      });
    }
    const anchor = row.type === 'Events' && data.eventNature === 'recurring'
      ? data.recurrence?.anchorDate
      : null;
    if (anchor && !validateDate(calendar, anchor)) {
      invalid.push({
        key: `entity:${row.id}:recurrence.anchorDate`,
        kind: 'entity',
        entityId: row.id,
        entityName: row.canonicalName,
        entityType: row.type,
        field: 'recurrence.anchorDate',
        label: 'Recurrence anchor',
        date: anchor,
        suggestedDate: clampDate(calendar, anchor)
      });
    }
  }
  const clockRow = db.prepare('SELECT position_json FROM roleplay_time_state WHERE workspace_id = ?').get(workspaceId);
  if (clockRow) {
    const clock = parseObject(clockRow.position_json, {});
    if (!validateDate(calendar, clock)) {
      invalid.push({
        key: 'roleplay:clock',
        kind: 'roleplay',
        label: 'Current RP date',
        date: clock,
        suggestedDate: { ...clampDate(calendar, clock), hour: clock.hour || 0, minute: clock.minute || 0 }
      });
    }
  }
  return invalid;
}

function setNestedDate(data, field, value) {
  if (field === 'recurrence.anchorDate') {
    const recurrence = { ...(data.recurrence || {}) };
    if (value) recurrence.anchorDate = value;
    else delete recurrence.anchorDate;
    data.recurrence = recurrence;
  } else if (value) {
    data[field] = value;
  } else {
    delete data[field];
  }
}

function saveCalendar(db, workspaceId, input, resolutions = []) {
  const calendar = normalizeCalendar(input);
  const invalid = collectInvalidDates(db, workspaceId, calendar);
  const resolutionMap = new Map((resolutions || []).map(resolution => [resolution.key, resolution.date ?? null]));
  const unresolved = invalid.filter(item => !resolutionMap.has(item.key));
  if (unresolved.length) return { saved: false, calendar, invalid: unresolved };
  db.transaction(() => {
    for (const item of invalid) {
      const replacement = resolutionMap.get(item.key);
      if (item.kind === 'roleplay') {
        if (replacement) {
          const currentRow = db.prepare('SELECT position_json FROM roleplay_time_state WHERE workspace_id = ?').get(workspaceId);
          const current = parseObject(currentRow?.position_json, {});
          const position = normalizePosition(calendar, { ...replacement, hour: current.hour, minute: current.minute });
          db.prepare(`
            UPDATE roleplay_time_state SET position_json = ?, version = version + 1, updated_at = ?
            WHERE workspace_id = ?
          `).run(JSON.stringify(position), Date.now(), workspaceId);
        } else {
          db.prepare('DELETE FROM roleplay_time_state WHERE workspace_id = ?').run(workspaceId);
        }
        continue;
      }
      const row = db.prepare('SELECT data FROM entities WHERE workspaceId = ? AND id = ?').get(workspaceId, item.entityId);
      if (!row) continue;
      const data = parseObject(row.data, {});
      setNestedDate(data, item.field, replacement ? clampDate(calendar, replacement) : null);
      db.prepare('UPDATE entities SET data = ?, last_modified = ? WHERE workspaceId = ? AND id = ?')
        .run(JSON.stringify(data), Date.now(), workspaceId, item.entityId);
    }
    db.prepare(`
      INSERT INTO worldbuild_calendars (workspace_id, definition_json, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET
        definition_json = excluded.definition_json,
        updated_at = excluded.updated_at
    `).run(workspaceId, JSON.stringify(calendar), Date.now());
  })();
  return { saved: true, calendar, invalid: [] };
}

function compareDates(calendar, left, right) {
  return toOrdinal(calendar, left) - toOrdinal(calendar, right);
}

function recurrenceMatches(calendar, anchor, recurrence, date) {
  if (compareDates(calendar, date, anchor) < 0) return false;
  const interval = positiveInteger(recurrence.interval, 1);
  const unit = ['day', 'week', 'month', 'year'].includes(recurrence.unit) ? recurrence.unit : 'year';
  if (unit === 'year') {
    const difference = absoluteYearFor(calendar, date) - absoluteYearFor(calendar, anchor);
    return difference >= 0 && difference % interval === 0
      && date.month === anchor.month && date.day === anchor.day;
  }
  if (unit === 'month') {
    const difference = (
      absoluteYearFor(calendar, date) * calendar.months.length + date.month
    ) - (
      absoluteYearFor(calendar, anchor) * calendar.months.length + anchor.month
    );
    return difference >= 0 && difference % interval === 0 && date.day === anchor.day;
  }
  const divisor = interval * (unit === 'week' ? calendar.weekdays.length : 1);
  return (toOrdinal(calendar, date) - toOrdinal(calendar, anchor)) % divisor === 0;
}

function getCalendarEntries(db, workspaceId, year, month, eraId) {
  const calendar = getCalendar(db, workspaceId);
  const dateBase = clampDate(calendar, { eraId: eraId || calendar.defaultEraId, year, month, day: 1 });
  const absoluteYear = absoluteYearFor(calendar, dateBase);
  const length = daysInMonth(calendar, absoluteYear, dateBase.month);
  const rows = db.prepare(`
    SELECT id, type, canonicalName, data FROM entities
    WHERE workspaceId = ? AND status != 'proposed'
      AND type IN ('Events', 'Characters', 'Creatures')
  `).all(workspaceId);
  const occurrenceRows = db.prepare(`
    SELECT occurrences.occurrence_id AS id, occurrences.event_entity_id AS eventEntityId,
      occurrences.title, occurrences.start_date_json AS startDateJson,
      occurrences.end_date_json AS endDateJson, event_entities.data AS eventData
    FROM worldbuild_event_occurrences occurrences
    JOIN narrative_events events
      ON events.workspace_id = occurrences.workspace_id
      AND events.event_id = occurrences.narrative_event_id
    LEFT JOIN entities event_entities
      ON event_entities.workspaceId = occurrences.workspace_id
      AND event_entities.id = occurrences.event_entity_id
    WHERE occurrences.workspace_id = ? AND occurrences.archived = 0 AND events.status = 'approved'
  `).all(workspaceId).flatMap(row => {
    const startDate = parseObject(row.startDateJson, null);
    if (!startDate || !validateDate(calendar, startDate)) return [];
    const endDate = parseObject(row.endDateJson, null);
    const eventData = parseObject(row.eventData, {});
    return [{ ...row, category: eventData.category || eventData.eventCategory || null, startDate, endDate: endDate && validateDate(calendar, endDate) ? endDate : startDate }];
  });
  const entries = [];
  for (let day = 1; day <= length; day += 1) {
    const date = { ...dateBase, day };
    for (const row of rows) {
      const data = parseObject(row.data, {});
      if (row.type === 'Events') {
        const hasRecordedOccurrence = occurrenceRows.some(occurrence => occurrence.eventEntityId === row.id
          && compareDates(calendar, date, occurrence.startDate) >= 0
          && compareDates(calendar, date, occurrence.endDate) <= 0);
        const nature = data.eventNature === 'recurring' ? 'recurring' : 'one-time';
        if (nature === 'recurring') {
          const anchor = data.recurrence?.anchorDate || data.startDate;
          if (!hasRecordedOccurrence && anchor && validateDate(calendar, anchor) && recurrenceMatches(calendar, anchor, data.recurrence || {}, date)) {
            entries.push({ id: `${row.id}:${toOrdinal(calendar, date)}`, entityId: row.id, date, title: row.canonicalName, kind: 'recurring-event', category: data.category || data.eventCategory || null, entityType: row.type });
          }
        } else if (!hasRecordedOccurrence && data.startDate && validateDate(calendar, data.startDate)) {
          const endDate = data.endDate && validateDate(calendar, data.endDate) ? data.endDate : data.startDate;
          if (compareDates(calendar, date, data.startDate) >= 0 && compareDates(calendar, date, endDate) <= 0) {
            entries.push({ id: `${row.id}:${toOrdinal(calendar, date)}`, entityId: row.id, date, title: row.canonicalName, kind: 'event', category: data.category || data.eventCategory || null, entityType: row.type });
          }
        }
        continue;
      }
      const isIndividual = row.type === 'Characters' || (data.scope || 'individual') !== 'group';
      if (!isIndividual) continue;
      const activeDeathDate = data.status === 'deceased' ? data.deathDate : null;
      if (data.birthDate && data.showBirthday && date.month === data.birthDate.month && date.day === data.birthDate.day) {
        const afterBirth = compareDates(calendar, date, data.birthDate) >= 0;
        const beforeDeath = !activeDeathDate || compareDates(calendar, date, activeDeathDate) <= 0;
        if (afterBirth && beforeDeath) {
          entries.push({ id: `${row.id}:birthday:${toOrdinal(calendar, date)}`, entityId: row.id, date, title: `${row.canonicalName}'s birthday`, kind: 'birthday', entityType: row.type });
        }
      }
      for (const [field, kind, suffix] of [
        ['birthDate', 'birth', 'was born'],
        [data.status === 'deceased' ? 'deathDate' : null, 'death', 'died'],
        [data.status === 'missing' ? 'missingDate' : null, 'missing', 'disappeared']
      ]) {
        const marker = field ? data[field] : null;
        if (marker && compareDates(calendar, date, marker) === 0) {
          entries.push({ id: `${row.id}:${kind}`, entityId: row.id, date, title: `${row.canonicalName} ${suffix}`, kind, entityType: row.type });
        }
      }
    }
    for (const occurrence of occurrenceRows) {
      if (compareDates(calendar, date, occurrence.startDate) < 0 || compareDates(calendar, date, occurrence.endDate) > 0) continue;
      entries.push({
        id: `${occurrence.id}:${toOrdinal(calendar, date)}`,
        entityId: occurrence.eventEntityId,
        date,
        title: occurrence.title,
        kind: 'event-occurrence',
        category: occurrence.category,
        entityType: 'Events'
      });
    }
  }
  const firstWeekday = modulo(toOrdinal(calendar, dateBase) + calendar.epochWeekday, calendar.weekdays.length);
  return {
    calendar,
    year: dateBase.year,
    month: dateBase.month,
    eraId: dateBase.eraId,
    daysInMonth: length,
    firstWeekday,
    season: seasonFor(calendar, dateBase),
    entries: entries.sort((left, right) => left.date.day - right.date.day || left.title.localeCompare(right.title))
  };
}

module.exports = {
  DEFAULT_CALENDAR,
  DEFAULT_TIME_MATRIX,
  addDuration,
  applyRoleplayTurnFrame,
  buildRoleplayTemporalContext,
  durationTotalMinutes,
  advanceCeilingMinutes,
  extractElapsedSpan,
  matrixMinimumMinutes,
  minutesToDuration,
  collectInvalidDates,
  compareDates,
  formatClock,
  getCalendar,
  getCalendarEntries,
  getMessageFrames,
  listRecentMessageFrames,
  getRoleplayClock,
  getTimeMatrix,
  normalizeCalendar,
  normalizeTimeAdvance,
  saveCalendar,
  saveRoleplayClock,
  saveTimeMatrix,
  validateDate
};
