import React from 'react';

const INPUT = 'w-full rounded-lg border border-white/10 bg-[#06151c] px-2.5 py-2 text-xs text-gray-200 outline-none transition-colors focus:border-accent/60';

export function formatWorldDate(calendar, value, includeTime = false) {
  if (!calendar || !value) return '';
  const month = calendar.months?.[Number(value.month) - 1]?.name || `Month ${value.month}`;
  const era = calendar.eras?.find(item => item.id === value.eraId)?.shortName;
  const date = `${value.day} ${month} ${value.year}${era ? ` ${era}` : ''}`;
  if (!includeTime) return date;
  return `${date} | ${String(value.hour ?? 0).padStart(2, '0')}:${String(value.minute ?? 0).padStart(2, '0')}`;
}

export default function WorldDateInput({
  calendar,
  value,
  onChange,
  includeTime = false,
  allowClear = true,
  compact = false
}) {
  if (!calendar) return null;
  const date = value || {
    eraId: calendar.defaultEraId,
    year: 1,
    month: 1,
    day: 1,
    ...(includeTime ? { hour: 8, minute: 0 } : {})
  };
  const set = patch => onChange({ ...date, ...patch });
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
  const maxDay = (calendar.months?.[Number(date.month) - 1]?.days || 1) + leapDay;

  return (
    <div className={`grid gap-2 ${compact ? 'grid-cols-[minmax(3.5rem,0.55fr)_minmax(7rem,1.4fr)_minmax(4rem,0.7fr)_minmax(4.5rem,0.75fr)]' : 'grid-cols-2 sm:grid-cols-4'}`}>
      <input className={INPUT} aria-label="Day" type="number" min="1" max={maxDay} value={date.day} onChange={event => set({ day: Math.max(1, Math.min(maxDay, Number(event.target.value) || 1)) })} />
      <select className={INPUT} aria-label="Month" value={date.month} onChange={event => set({ month: Number(event.target.value), day: Math.min(date.day, calendar.months[Number(event.target.value) - 1]?.days || 1) })}>
        {calendar.months.map((month, index) => <option key={month.id} value={index + 1}>{month.name}</option>)}
      </select>
      <input className={INPUT} aria-label="Year" type="number" min="1" value={date.year} onChange={event => set({ year: Math.max(1, Number(event.target.value) || 1) })} />
      <select className={INPUT} aria-label="Era" value={date.eraId} onChange={event => set({ eraId: event.target.value })}>
        {calendar.eras.map(era => <option key={era.id} value={era.id}>{era.shortName || era.name}</option>)}
      </select>
      {includeTime && <>
        <input className={INPUT} aria-label="Hour" type="number" min="0" max={calendar.hoursPerDay - 1} value={date.hour ?? 0} onChange={event => set({ hour: Math.max(0, Math.min(calendar.hoursPerDay - 1, Number(event.target.value) || 0)) })} />
        <input className={INPUT} aria-label="Minute" type="number" min="0" max="59" value={date.minute ?? 0} onChange={event => set({ minute: Math.max(0, Math.min(59, Number(event.target.value) || 0)) })} />
      </>}
      {allowClear && value && (
        <button type="button" onClick={() => onChange(null)} className="justify-self-start text-[0.7rem] font-semibold text-gray-500 hover:text-red-300">
          Clear date
        </button>
      )}
    </div>
  );
}
