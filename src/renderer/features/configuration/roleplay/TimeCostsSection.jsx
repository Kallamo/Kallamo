import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, Hourglass } from 'lucide-react';
import Button from '../../../components/ui/Button';
import IconButton from '../../../components/ui/IconButton';
import NumberInput from '../../../components/ui/NumberInput';
import { ConfigSection } from '../ConfigParts';
import ResizableTextarea from '../../../components/ui/ResizableTextarea';

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function describeMinutes(minutes, minutesPerDay) {
  if (minutes >= minutesPerDay && minutes % minutesPerDay === 0) {
    const days = minutes / minutesPerDay;
    return `${days} ${days === 1 ? 'day' : 'days'}`;
  }
  if (minutes >= 60 && minutes % 60 === 0) {
    const hours = minutes / 60;
    return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
  }
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

/**
 * How far the clock moves when the story does not say. One logarithmic ruler shows every range
 * from minutes to a year; numbers are edited in the row and saved together.
 */
export default function TimeCostsSection({ sectionRef, matrix, calendar, onSave, embedded = false, onOpenCalendar }) {
  const [draft, setDraft] = useState(matrix);
  const [openId, setOpenId] = useState(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => setDraft(matrix), [matrix]);

  const minutesPerDay = Math.max(1, Number(calendar?.hoursPerDay) || 24) * 60;
  const yearMinutes = minutesPerDay * 365;
  const scale = minutes => Math.max(0, Math.min(1, Math.log(Math.max(1, minutes)) / Math.log(yearMinutes))) * 100;
  const ticks = useMemo(() => [
    { label: '1 min', minutes: 1 },
    { label: '1 hour', minutes: 60 },
    { label: '1 day', minutes: minutesPerDay },
    { label: '1 week', minutes: minutesPerDay * 7 },
    { label: '1 month', minutes: minutesPerDay * 30 },
    { label: '1 year', minutes: yearMinutes }
  ], [minutesPerDay, yearMinutes]);

  const categories = draft.categories || [];
  const changed = categories.filter(category => !same(category, (matrix.categories || []).find(item => item.id === category.id)));
  const update = (id, patch) => setDraft(current => ({ ...current, categories: current.categories.map(category => category.id === id ? { ...category, ...patch } : category) }));
  const save = async () => {
    setSaving(true);
    try { await onSave(draft); } finally { setSaving(false); }
  };

  return (
    <ConfigSection
      id="time-costs"
      sectionRef={sectionRef}
      embedded={embedded}
      icon={Hourglass}
      title="Time costs"
      description="How much the clock moves when the story doesn't say. Time written in the story always wins."
    >
      {onOpenCalendar && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-card border border-border-subtle bg-surface-inset px-3.5 py-2.5 text-[0.8125rem] text-text-secondary">
          <span className="min-w-0 flex-1">A day here has <b className="font-semibold text-text-primary">{Math.round(minutesPerDay / 60)} hours</b>, set by {calendar?.name || 'the calendar'}. Days in a timeskip follow it.</span>
          <Button variant="ghost" size="sm" onClick={onOpenCalendar}>Open Calendar</Button>
        </div>
      )}
      {categories.length ? (
        <div className="flex flex-col gap-5">
          <div className="rounded-card border border-border-subtle bg-surface-inset px-5 pb-3.5 pt-4" aria-hidden="true">
            <div className="flex flex-col gap-1.5">
              {categories.map(category => {
                const left = scale(category.minimumMinutes);
                const right = scale(category.maximumMinutes);
                const active = openId === category.id;
                return (
                  <div key={category.id} className="grid h-5 grid-cols-[5.25rem_minmax(0,1fr)] items-center gap-3">
                    <span className={`text-xs font-semibold ${active ? 'text-text-primary' : 'text-text-muted'}`}>{category.name}</span>
                    <span className="relative h-2">
                      {ticks.slice(1, -1).map(tick => <span key={tick.label} className="absolute inset-y-0 w-px bg-tint/[0.07]" style={{ left: `${scale(tick.minutes)}%` }} />)}
                      <b className={`absolute inset-y-0 rounded-full bg-accent ${active ? 'opacity-100 ring-[3px] ring-accent/20' : 'opacity-75'}`} style={{ left: `${left}%`, width: `${Math.max(0.8, right - left)}%`, minWidth: '0.5rem' }} />
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="mt-2 grid grid-cols-[5.25rem_minmax(0,1fr)] gap-3">
              <span />
              <span className="relative block h-4.5">
                {ticks.map((tick, index) => (
                  <span key={tick.label} className="absolute whitespace-nowrap text-xs text-text-subtle" style={{ left: `${scale(tick.minutes)}%`, transform: index === 0 ? 'none' : index === ticks.length - 1 ? 'translateX(-100%)' : 'translateX(-50%)' }}>{tick.label}</span>
                ))}
              </span>
            </div>
          </div>

          <div className="overflow-hidden rounded-card border border-border-subtle bg-surface-inset">
            {categories.map((category, index) => {
              const open = openId === category.id;
              const days = category.id === 'timeskip';
              const original = (matrix.categories || []).find(item => item.id === category.id) || category;
              const toUnit = minutes => days ? Math.max(1, Math.round(minutes / minutesPerDay)) : minutes;
              const fromUnit = value => days ? value * minutesPerDay : value;
              const dirtyMin = original.minimumMinutes !== category.minimumMinutes;
              const dirtyMax = original.maximumMinutes !== category.maximumMinutes;
              const field = dirty => `field-input h-8 px-2.5 text-right text-[0.8125rem] tabular-nums ${dirty ? '!border-accent/60 shadow-[0_0_0_3px_color-mix(in_srgb,var(--app-accent)_12%,transparent)]' : ''}`;
              return (
                <div key={category.id} className={`${index ? 'border-t border-border-subtle' : ''} ${open ? 'bg-tint/[0.025]' : ''}`}>
                  <div className="grid grid-cols-[6rem_minmax(0,1fr)_5.5rem_1rem_5.5rem_3rem_2rem] items-center gap-2.5 py-2.5 pl-4 pr-2.5">
                    <span className="text-[0.8125rem] font-semibold text-text-primary">{category.name}</span>
                    <span className="truncate text-xs text-text-muted">{open ? `${describeMinutes(category.maximumMinutes, minutesPerDay)} at most` : category.guidance || 'No guidance yet'}</span>
                    <NumberInput aria-label={`${category.name} shortest`} className={field(dirtyMin)} min={1} value={toUnit(category.minimumMinutes)} onChange={value => update(category.id, { minimumMinutes: fromUnit(value), maximumMinutes: Math.max(category.maximumMinutes, fromUnit(value)) })} />
                    <span className="text-center text-xs text-text-subtle">to</span>
                    <NumberInput aria-label={`${category.name} longest`} className={field(dirtyMax)} min={toUnit(category.minimumMinutes)} value={toUnit(category.maximumMinutes)} onChange={value => update(category.id, { maximumMinutes: Math.max(category.minimumMinutes, fromUnit(value)) })} />
                    <span className="text-xs text-text-subtle">{days ? 'days' : 'min'}</span>
                    <IconButton icon={ChevronDown} size="sm" label={open ? `Close ${category.name} guidance` : `Edit ${category.name} guidance`} aria-expanded={open} className={open ? '[&_svg]:rotate-180' : ''} onClick={() => setOpenId(current => current === category.id ? null : category.id)} />
                  </div>
                  {open && (
                    <div className="pb-3.5 pl-4 pr-4 md:pl-[7.625rem]">
                      <label className="block">
                        <span className="mb-1.5 block text-xs text-text-muted">Which actions take this long</span>
                        <ResizableTextarea storageKey="rules-time-guidance" value={category.guidance || ''} onChange={event => update(category.id, { guidance: event.target.value })} />
                      </label>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {changed.length > 0 && (
            <div className="flex flex-wrap items-center gap-2.5 rounded-card border border-border-default bg-surface-panel/95 py-3 pl-4 pr-3">
              <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-accent" />
              <span className="min-w-0 flex-1 text-[0.8125rem] text-text-secondary">You changed {changed.length} {changed.length === 1 ? 'range' : 'ranges'}. It applies from the next turn after you save.</span>
              <Button variant="ghost" size="sm" disabled={saving} onClick={() => setDraft(matrix)}>Discard</Button>
              <Button variant="primary" size="sm" loading={saving} onClick={save}>Save changes</Button>
            </div>
          )}
        </div>
      ) : (
        <p className="rounded-card border border-dashed border-border-subtle px-4 py-6 text-center text-[0.8125rem] text-text-muted">No time ranges are set.</p>
      )}
    </ConfigSection>
  );
}
