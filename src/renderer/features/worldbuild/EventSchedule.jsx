import React from 'react';
import { CalendarRange, Clock, X } from 'lucide-react';
import NumberInput from '../../components/ui/NumberInput';
import { formatWorldDate } from './WorldDateInput';

// An event's schedule beyond its dates: the weekdays a weekly event falls on, how many days each
// occurrence lasts and the hours it keeps. The calendar service reads the same shape.

const SEGMENT = 'min-w-0 bg-surface-input px-2 py-1.5 transition-colors focus-within:bg-surface-hover/45';
const SEGMENT_LABEL = 'block text-xs font-medium text-text-muted';
const SEGMENT_NUMBER = 'min-h-9 w-full bg-transparent px-1.5 text-sm font-medium tabular-nums text-text-primary outline-none placeholder:text-text-disabled';
const BOX = 'overflow-hidden rounded-card border border-border-default bg-border-subtle transition-[border-color,box-shadow] focus-within:border-accent/50 focus-within:ring-2 focus-within:ring-accent/15';

const pad = value => String(value).padStart(2, '0');

export function formatTime(time) {
  if (!time || !Number.isInteger(Number(time.hour))) return '';
  return `${pad(Number(time.hour))}:${pad(Number(time.minute) || 0)}`;
}

// "08:00 to 14:00", or "at 21:00" for a single moment.
export function formatHours(hours) {
  const from = formatTime(hours?.from);
  if (!from) return '';
  const until = formatTime(hours?.until);
  return until ? `${from} to ${until}` : `at ${from}`;
}

export function pickedWeekdays(calendar, recurrence) {
  const length = calendar?.weekdays?.length || 0;
  const picked = Array.isArray(recurrence?.weekdays) ? recurrence.weekdays : [];
  return [...new Set(picked.map(Number).filter(index => Number.isInteger(index) && index >= 0 && index < length))].sort((a, b) => a - b);
}

const listJoin = items => items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;

// How a recurring event is spoken of: "Every week on Tuesday and Saturday, 08:00 to 14:00".
export function recurrenceSummary(data, calendar) {
  const recurrence = data?.recurrence;
  if (!recurrence?.anchorDate) return null;
  const interval = Math.max(1, Number(recurrence.interval) || 1);
  const unit = recurrence.unit || 'year';
  const parts = [interval === 1 ? `Every ${unit}` : `Every ${interval} ${unit}s`];
  const weekdays = unit === 'week' ? pickedWeekdays(calendar, recurrence) : [];
  if (weekdays.length) parts[0] += ` on ${listJoin(weekdays.map(index => calendar.weekdays[index]))}`;
  const days = Number(recurrence.durationDays) || 1;
  if (unit !== 'week' && days > 1) parts[0] += ` for ${days} days`;
  const hours = formatHours(data.hours);
  if (hours) parts.push(hours);
  return { text: parts.join(', '), since: formatWorldDate(calendar, recurrence.anchorDate) };
}

// A one-time event's dates, with its hours on the day each one belongs to.
export function onceSummary(data, calendar) {
  if (!data?.startDate) return null;
  const from = formatTime(data.hours?.from);
  const until = formatTime(data.hours?.until);
  const start = formatWorldDate(calendar, data.startDate);
  if (!data.endDate) return from ? `${start}, ${until ? `${from} to ${until}` : `at ${from}`}` : start;
  return `${start}${from ? ` at ${from}` : ''} to ${formatWorldDate(calendar, data.endDate)}${until ? ` at ${until}` : ''}`;
}

// An optional part of the schedule that stays a single button until it is wanted.
export function ScheduleAddButton({ icon: Icon, children, onClick }) {
  return (
    <button type="button" onClick={onClick}
      className="inline-flex min-h-9 items-center gap-2 whitespace-nowrap rounded-control border border-dashed border-border-strong bg-tint/[0.02] px-3 text-xs font-semibold text-text-secondary transition-colors hover:border-accent/50 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
      <Icon className="h-4 w-4 text-accent" aria-hidden="true" />{children}
    </button>
  );
}

export const AddLengthButton = ({ onClick }) => <ScheduleAddButton icon={CalendarRange} onClick={onClick}>Lasts several days</ScheduleAddButton>;
export const AddHoursButton = ({ onClick }) => <ScheduleAddButton icon={Clock} onClick={onClick}>Add hours</ScheduleAddButton>;

function RemoveButton({ label, onClick }) {
  return (
    <button type="button" onClick={onClick} aria-label={label} data-tooltip={label}
      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-control text-text-muted transition-colors hover:bg-status-danger/10 hover:text-status-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
      <X className="h-4 w-4" aria-hidden="true" />
    </button>
  );
}

// Weeks can hold any number of days, so the picker wraps into even rows instead of one long strip.
export function WeekdayPicker({ calendar, value, onChange }) {
  const picked = new Set(pickedWeekdays(calendar, { weekdays: value }));
  const toggle = index => {
    const next = new Set(picked);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    onChange([...next].sort((a, b) => a - b));
  };
  return (
    <div role="group" aria-label="On these days" className="grid grid-cols-[repeat(auto-fill,minmax(6.5rem,1fr))] gap-1 rounded-control border border-border-default bg-surface-input p-1">
      {calendar.weekdays.map((name, index) => {
        const on = picked.has(index);
        return (
          <button key={index} type="button" aria-pressed={on} onClick={() => toggle(index)} data-tooltip={name.length > 12 ? name : undefined}
            className={`min-h-8 truncate rounded-md px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${on ? 'bg-accent/[0.13] text-accent shadow-sm ring-1 ring-inset ring-accent/45' : 'text-text-muted hover:bg-surface-hover/55 hover:text-text-primary'}`}>
            {name}
          </button>
        );
      })}
    </div>
  );
}

export function LengthInput({ value, onChange, onRemove }) {
  return (
    <div className="flex items-center gap-1.5">
      <div className={`${BOX} min-w-0 flex-1`}>
        <label className={`${SEGMENT} block`}>
          <span className={SEGMENT_LABEL}>Days</span>
          <NumberInput className={SEGMENT_NUMBER} aria-label="Days each time" min={2} max={366} value={value} onChange={onChange} />
        </label>
      </div>
      <RemoveButton label="Remove length" onClick={onRemove} />
    </div>
  );
}

function TimeSegment({ label, time, nullable, onChange }) {
  const hour = time?.hour ?? null;
  return (
    <div className={SEGMENT} role="group" aria-label={label}>
      <span className={SEGMENT_LABEL}>{label}</span>
      <div className="flex items-center">
        <NumberInput className={`${SEGMENT_NUMBER} text-right`} aria-label={`${label} hour`} placeholder="--" min={0} max={time?.max} nullable={nullable}
          value={hour} onChange={next => onChange(next == null ? null : { hour: next, minute: time?.minute ?? 0 })} />
        <span aria-hidden="true" className="text-sm font-semibold text-text-subtle">:</span>
        <NumberInput className={SEGMENT_NUMBER} aria-label={`${label} minute`} placeholder="--" min={0} max={59} disabled={hour == null}
          value={hour == null ? null : time?.minute ?? 0} onChange={minute => onChange({ hour, minute })} />
      </div>
    </div>
  );
}

// From and Until on the world's own clock. An empty Until makes the event a single moment.
export function HoursInput({ calendar, value, onChange, onRemove }) {
  const max = Math.max(0, (calendar?.hoursPerDay || 24) - 1);
  return (
    <div className="flex items-center gap-1.5">
      <div className={`${BOX} grid min-w-0 flex-1 grid-cols-2 gap-px`}>
        <TimeSegment label="From" time={{ ...value?.from, max }} onChange={from => from && onChange({ ...value, from })} />
        <TimeSegment label="Until" time={value?.until ? { ...value.until, max } : { max }} nullable onChange={until => onChange({ ...value, until })} />
      </div>
      <RemoveButton label="Remove hours" onClick={onRemove} />
    </div>
  );
}

export function defaultHours(calendar) {
  return { from: { hour: Math.min(9, Math.max(0, (calendar?.hoursPerDay || 24) - 1)), minute: 0 }, until: null };
}
