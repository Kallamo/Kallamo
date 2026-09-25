import React from 'react';
import SelectMenu from '../../components/ui/SelectMenu';

const COMPOUND_SEGMENT = 'min-w-0 bg-surface-input px-2 py-1.5 transition-colors focus-within:bg-surface-hover/45';
const COMPOUND_LABEL = 'block text-xs font-medium text-text-muted';
const COMPOUND_NUMBER = 'min-h-9 w-full bg-transparent px-1.5 text-sm font-medium tabular-nums text-text-primary outline-none';

function daysInMonth(calendar, date) {
  const era = calendar.eras?.find(item => item.id === date.eraId);
  const absoluteYear = era?.direction === 'backward'
    ? Number(era.offset || 0) - (Number(date.year) - 1)
    : Number(era?.offset || 0) + (Number(date.year) - 1);
  const leapDay = calendar.leapRule?.type === 'gregorian'
    && calendar.leapRule.month === Number(date.month)
    && absoluteYear % 4 === 0
    && (absoluteYear % 100 !== 0 || absoluteYear % 400 === 0)
      ? Number(calendar.leapRule.extraDays || 1)
      : 0;
  return (calendar.months?.[Number(date.month) - 1]?.days || 1) + leapDay;
}

export function formatWorldDate(calendar, value, includeTime = false) {
  if (!calendar || !value) return '';
  const month = calendar.months?.[Number(value.month) - 1]?.name || `Month ${value.month}`;
  const era = calendar.eras?.find(item => item.id === value.eraId)?.shortName;
  const date = `${value.day} ${month} ${value.year}${era ? ` ${era}` : ''}`;
  if (!includeTime) return date;
  return `${date} | ${String(value.hour ?? 0).padStart(2, '0')}:${String(value.minute ?? 0).padStart(2, '0')}`;
}

// One way to write a date anywhere in the app: a single framed control with a labelled
// segment per part, and, while empty, a button rather than fields already filled with a
// default nobody chose. The loose four-input row this used to fall back to squeezed the
// month down to an initial as soon as it sat in a narrow column.
export default function WorldDateInput({
  calendar,
  value,
  onChange,
  includeTime = false,
  allowClear = true,
  label = 'World date',
  emptyLabel = 'Set date',
  seedValue = null,
  disabled = false,
  className = '',
  ...rest
}) {
  if (!calendar) return null;
  const defaultDate = {
    eraId: calendar.defaultEraId,
    year: 1,
    month: 1,
    day: 1,
    ...(includeTime ? { hour: 8, minute: 0 } : {}),
    ...(seedValue || {})
  };
  const date = value || defaultDate;
  const set = patch => onChange({ ...date, ...patch });
  const setCalendarPart = patch => {
    const next = { ...date, ...patch };
    onChange({ ...next, day: clampInteger(next.day, 1, daysInMonth(calendar, next)) });
  };
  const maxDay = daysInMonth(calendar, date);

  if (!value) {
    return (
      <fieldset className={`min-w-0 ${className}`} aria-describedby={rest['aria-describedby']}>
        <legend className="sr-only">{label}</legend>
        <button
          type="button"
          onClick={() => onChange(defaultDate)}
          disabled={disabled}
          className="flex min-h-11 w-full items-center justify-center rounded-card border border-dashed border-border-default bg-surface-input/45 px-3 text-sm font-semibold text-text-muted transition-[color,background-color,border-color] hover:border-accent/35 hover:bg-accent/[0.04] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-55 disabled:hover:border-border-default disabled:hover:bg-surface-input/45 disabled:hover:text-text-muted"
        >
          {emptyLabel}
        </button>
      </fieldset>
    );
  }

  return (
      <fieldset className={`@container min-w-0 ${className}`} aria-describedby={rest['aria-describedby']}>
        <legend className="sr-only">{label}</legend>
        <div className={`grid min-w-0 gap-2 ${includeTime ? '@min-[34rem]:grid-cols-[minmax(0,1fr)_11rem]' : ''}`}>
          <div className="min-w-0" role="group" aria-label={`${label} date`}>
            {includeTime ? <span className={`${COMPOUND_LABEL} mb-1.5 px-1`}>Date</span> : null}
            <div className="overflow-hidden rounded-card border border-border-default bg-border-subtle transition-[border-color,box-shadow] focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-accent/15">
              <div className="grid grid-cols-[minmax(4.5rem,0.7fr)_minmax(8rem,1.3fr)] gap-px bg-border-subtle @min-[26rem]:grid-cols-[minmax(3.75rem,0.55fr)_minmax(8rem,1.45fr)_minmax(4.5rem,0.7fr)_minmax(5rem,0.9fr)]">
                <CompoundNumberField
                  label="Day"
                  ariaLabel={`${label} day`}
                  min="1"
                  max={maxDay}
                  value={date.day}
                  onChange={event => set({ day: clampInteger(event.target.value, 1, maxDay) })}
                />
                <div className={COMPOUND_SEGMENT}>
                  <span className={COMPOUND_LABEL}>Month</span>
                  <SelectMenu unboxed ariaLabel={`${label} month`} value={date.month} onChange={month => setCalendarPart({ month: Number(month) })} options={calendar.months.map((month, index) => ({ value: index + 1, label: month.name }))} />
                </div>
                <CompoundNumberField
                  label="Year"
                  ariaLabel={`${label} year`}
                  min="1"
                  value={date.year}
                  onChange={event => setCalendarPart({ year: clampInteger(event.target.value, 1) })}
                />
                <div className={COMPOUND_SEGMENT}>
                  <span className={COMPOUND_LABEL}>Era</span>
                  <SelectMenu unboxed ariaLabel={`${label} era`} value={date.eraId} onChange={eraId => setCalendarPart({ eraId })} options={calendar.eras.map(era => ({ value: era.id, label: era.shortName || era.name }))} />
                </div>
              </div>
            </div>
          </div>

          {includeTime && (
            <div className="min-w-0" role="group" aria-label={`${label} time`}>
              <span className={`${COMPOUND_LABEL} mb-1.5 px-1`}>Time</span>
              <div className="grid grid-cols-[1fr_auto_1fr] overflow-hidden rounded-card border border-border-default bg-border-subtle transition-[border-color,box-shadow] focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-accent/15">
                <CompoundNumberField
                  label="Hour"
                  ariaLabel={`${label} hour`}
                  min="0"
                  max={calendar.hoursPerDay - 1}
                  value={date.hour ?? 0}
                  onChange={event => set({ hour: clampInteger(event.target.value, 0, calendar.hoursPerDay - 1) })}
                />
                <span aria-hidden="true" className="flex items-end bg-surface-input pb-2.5 text-sm font-semibold text-text-subtle">:</span>
                <CompoundNumberField
                  label="Minute"
                  ariaLabel={`${label} minute`}
                  min="0"
                  max="59"
                  value={date.minute ?? 0}
                  onChange={event => set({ minute: clampInteger(event.target.value, 0, 59) })}
                />
              </div>
            </div>
          )}
        </div>

        {allowClear && value && (
          <div className="mt-1.5 flex justify-end">
            <button
              type="button"
              onClick={() => onChange(null)}
              className="inline-flex min-h-9 items-center rounded-control px-2.5 text-xs font-semibold text-text-muted transition-colors hover:bg-status-danger/10 hover:text-status-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              Clear date
            </button>
          </div>
        )}
      </fieldset>
  );
}

function CompoundNumberField({ label, ariaLabel, min, max, value, onChange }) {
  return (
    <label className={COMPOUND_SEGMENT}>
      <span className={COMPOUND_LABEL}>{label}</span>
      <input className={COMPOUND_NUMBER} aria-label={ariaLabel} type="number" min={min} max={max} value={value} onChange={onChange} />
    </label>
  );
}

function clampInteger(value, minimum, maximum = Number.POSITIVE_INFINITY) {
  const parsed = Math.trunc(Number(value));
  const safe = Number.isFinite(parsed) ? parsed : minimum;
  return Math.max(minimum, Math.min(maximum, safe));
}
