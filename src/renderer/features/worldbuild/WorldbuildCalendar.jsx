import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Popover from '../../components/ui/Popover';
import { CalendarDays, ChevronDown, ChevronLeft, ChevronRight, List, Plus, RotateCcw, Save, Settings2, Trash2, Bookmark } from 'lucide-react';
import ColorField from '../../components/ui/ColorField';
import SelectMenu from '../../components/ui/SelectMenu';
import WorldDateInput, { formatWorldDate } from './WorldDateInput';

const INPUT = 'field-input px-3 py-2 text-sm outline-none';

const ENTRY_COLORS = {
  birthday: 'var(--theme-calendar-birthday)',
  birth: 'var(--theme-calendar-history)',
  death: 'var(--theme-status-danger)',
  missing: 'var(--theme-status-warning)',
  festival: 'var(--theme-calendar-festival)',
  event: 'var(--theme-calendar-event)',
};

function dateOrdinal(calendar, date) {
  return calendar.months.slice(0, Math.max(0, Number(date.month) - 1))
    .reduce((total, month) => total + Number(month.days || 0), 0) + Number(date.day || 1);
}

function seasonForDate(calendar, date) {
  const target = dateOrdinal(calendar, date);
  return (calendar.seasons || []).find(season => {
    const start = dateOrdinal(calendar, season.start);
    const end = dateOrdinal(calendar, season.end);
    return start <= end ? target >= start && target <= end : target >= start || target <= end;
  }) || null;
}

function seasonsForMonth(calendar, month) {
  const days = Number(calendar.months[month - 1]?.days || 0);
  return (calendar.seasons || []).filter(season => Array.from({ length: days }, (_, index) => index + 1)
    .some(day => {
      const target = dateOrdinal(calendar, { month, day });
      const start = dateOrdinal(calendar, season.start);
      const end = dateOrdinal(calendar, season.end);
      return start <= end ? target >= start && target <= end : target >= start || target <= end;
    }));
}

function sameDate(left, right) {
  return Boolean(left && right
    && left.eraId === right.eraId
    && Number(left.year) === Number(right.year)
    && Number(left.month) === Number(right.month)
    && Number(left.day) === Number(right.day));
}

function entryVisual(entry) {
  const category = String(entry.category || '').toLowerCase();
  const title = String(entry.title || '').toLowerCase();
  const isFestival = ['festival', 'holiday', 'celebration', 'feast'].some(term => category.includes(term) || title.includes(term));
  const key = isFestival ? 'festival' : ENTRY_COLORS[entry.kind] ? entry.kind : 'event';
  const labels = {
    birthday: 'Birthday', birth: 'Birth', death: 'Death', missing: 'Missing',
    festival: 'Festival', event: entry.kind === 'recurring-event' ? 'Recurring' : 'Event'
  };
  return { color: ENTRY_COLORS[key], label: labels[key] };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function absoluteYearFor(calendar, date) {
  const era = calendar.eras.find(item => item.id === date.eraId) || calendar.eras[0];
  return era.direction === 'backward'
    ? era.offset - (Number(date.year) - 1)
    : era.offset + (Number(date.year) - 1);
}

function displayYearFor(calendar, absoluteYear, preferredEraId) {
  const preferred = calendar.eras.find(era => era.id === preferredEraId);
  const eras = preferred ? [preferred, ...calendar.eras.filter(era => era.id !== preferred.id)] : calendar.eras;
  for (const era of eras) {
    const year = era.direction === 'backward' ? era.offset - absoluteYear + 1 : absoluteYear - era.offset + 1;
    if (year >= 1) return { eraId: era.id, year };
  }
  return { eraId: calendar.defaultEraId, year: 1 };
}

export default function WorldbuildCalendar({ workspaceId, api, showToast, onOpenEntity, onCalendarChanged }) {
  const [calendar, setCalendar] = useState(null);
  const [draft, setDraft] = useState(null);
  const [view, setView] = useState('month');
  const [cursor, setCursor] = useState(null);
  const [monthData, setMonthData] = useState(null);
  const [invalid, setInvalid] = useState([]);
  const [resolutionDraft, setResolutionDraft] = useState({});
  const [saving, setSaving] = useState(false);
  const [storyClock, setStoryClock] = useState(null);
  const [openSettingsSection, setOpenSettingsSection] = useState('rules');
  const [openSeasonId, setOpenSeasonId] = useState(null);

  const loadCalendar = useCallback(async () => {
    const result = await api.getWorldCalendar(workspaceId);
    if (!result?.success) throw new Error(result?.error || 'Could not load the calendar.');
    setCalendar(result.calendar);
    setDraft(clone(result.calendar));
    setStoryClock(result.clock || null);
    setCursor(current => current || {
      eraId: result.clock?.eraId || result.calendar.defaultEraId,
      year: result.clock?.year || 1,
      month: result.clock?.month || 1
    });
  }, [api, workspaceId]);

  useEffect(() => {
    loadCalendar().catch(error => showToast(error.message, 'error'));
  }, [loadCalendar, showToast]);

  const loadMonth = useCallback(async () => {
    if (!cursor) return;
    const result = await api.getWorldCalendarEntries(workspaceId, cursor.year, cursor.month, cursor.eraId);
    if (!result?.success) throw new Error(result?.error || 'Could not load calendar entries.');
    setMonthData(result);
  }, [api, cursor, workspaceId]);

  useEffect(() => {
    loadMonth().catch(error => showToast(error.message, 'error'));
  }, [loadMonth, showToast]);

  const moveMonth = amount => {
    const count = calendar.months.length;
    const absoluteMonth = absoluteYearFor(calendar, cursor) * count + (cursor.month - 1) + amount;
    const absoluteYear = Math.floor(absoluteMonth / count);
    const month = ((absoluteMonth % count) + count) % count + 1;
    setCursor({ ...displayYearFor(calendar, absoluteYear, cursor.eraId), month });
  };

  const goToStoryDay = () => {
    if (!storyClock) return;
    setCursor({ eraId: storyClock.eraId, year: storyClock.year, month: storyClock.month });
  };

  const setStoryDay = async day => {
    const result = await api.saveRoleplayClock(workspaceId, {
      ...storyClock,
      eraId: cursor.eraId,
      year: cursor.year,
      month: cursor.month,
      day,
    });
    if (!result?.success) {
      showToast(result?.error || 'Could not set the current story day.', 'error');
      return;
    }
    setStoryClock(result.clock);
    showToast('Current story day updated.', 'success');
  };

  const updateList = (key, index, patch) => {
    const items = draft[key].map((item, itemIndex) => itemIndex === index
      ? (typeof item === 'string' ? patch : { ...item, ...patch })
      : item);
    setDraft({ ...draft, [key]: items });
  };

  const save = async (resolutions, candidate = draft) => {
    setSaving(true);
    try {
      const result = await api.saveWorldCalendar(workspaceId, candidate, resolutions || []);
      if (!result?.success) throw new Error(result?.error || 'Could not save the calendar.');
      if (!result.saved) {
        setDraft(clone(result.calendar));
        setInvalid(result.invalid || []);
        setResolutionDraft(Object.fromEntries((result.invalid || []).map(item => [item.key, item.suggestedDate])));
        return;
      }
      setCalendar(result.calendar);
      setDraft(clone(result.calendar));
      onCalendarChanged?.(result.calendar);
      setInvalid([]);
      setResolutionDraft({});
      setCursor(current => ({
        eraId: result.calendar.eras.some(era => era.id === current.eraId) ? current.eraId : result.calendar.defaultEraId,
        year: current.year,
        month: Math.min(current.month, result.calendar.months.length)
      }));
      showToast('Calendar saved.', 'success');
      window.dispatchEvent(new CustomEvent('roleplay-state-change', { detail: { workspaceId } }));
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const resolveAll = mode => save(invalid.map(item => ({
    key: item.key,
    date: mode === 'adjust' ? item.suggestedDate : null
  })));
  const applyManualResolutions = () => save(invalid.map(item => ({
    key: item.key,
    date: resolutionDraft[item.key] ?? null
  })));

  const entriesByDay = useMemo(() => {
    const map = new Map();
    for (const entry of monthData?.entries || []) {
      const values = map.get(entry.date.day) || [];
      values.push(entry);
      map.set(entry.date.day, values);
    }
    return map;
  }, [monthData]);

  if (!calendar || !draft || !cursor) return <div className="p-8 text-sm text-text-subtle">Loading calendar…</div>;
  const hasUnsavedChanges = JSON.stringify(draft) !== JSON.stringify(calendar);
  const baseYearDays = draft.months.reduce((total, month) => total + Number(month.days || 0), 0);
  const startingWeekday = draft.weekdays[draft.epochWeekday] || draft.weekdays[0] || 'Unknown';
  const defaultEra = draft.eras.find(era => era.id === draft.defaultEraId) || draft.eras.at(-1);
  const toggleSettingsSection = section => setOpenSettingsSection(current => current === section ? null : section);
  const addMonth = () => {
    setOpenSettingsSection('months');
    setDraft(current => ({
      ...current,
      months: [...current.months, { id: crypto.randomUUID(), name: `Month ${current.months.length + 1}`, days: 30 }]
    }));
  };
  const addWeekday = () => {
    setOpenSettingsSection('weekdays');
    setDraft(current => ({ ...current, weekdays: [...current.weekdays, `Day ${current.weekdays.length + 1}`] }));
  };
  const addEra = () => {
    setOpenSettingsSection('eras');
    setDraft(current => ({
      ...current,
      eras: [...current.eras, {
        id: crypto.randomUUID(),
        name: `Era ${current.eras.length + 1}`,
        shortName: `E${current.eras.length + 1}`,
        direction: 'forward',
        offset: 1
      }]
    }));
  };
  const addSeason = () => {
    const id = crypto.randomUUID();
    setOpenSettingsSection('seasons');
    setOpenSeasonId(id);
    setDraft(current => ({
      ...current,
      seasons: [...current.seasons, {
        id,
        name: `Season ${current.seasons.length + 1}`,
        color: '#6ee7b7',
        description: '',
        start: { month: 1, day: 1 },
        end: { month: current.months.length, day: current.months.at(-1)?.days || 1 }
      }]
    }));
  };
  const removeSeason = id => {
    setDraft(current => ({ ...current, seasons: current.seasons.filter(season => season.id !== id) }));
    setOpenSeasonId(current => current === id ? null : current);
  };
  const monthName = calendar.months[cursor.month - 1]?.name;
  const monthSeasons = seasonsForMonth(calendar, cursor.month);
  const seasonColor = monthSeasons[0]?.color || 'var(--app-accent)';

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-3 sm:p-5 lg:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="text-2xl font-bold text-text-primary">{calendar.name}</h1>
          <p className="caption mt-1">Dates are kept by day. Hours and minutes belong to each roleplay.</p>
        </div>
        <div className="flex items-center gap-2">
          <div role="tablist" aria-label="Calendar view" className="inline-flex gap-1 rounded-control border border-border-default bg-surface-input p-1">
            {[['month', CalendarDays, 'Month'], ['timeline', List, 'Timeline']].map(([key, Icon, label]) => (
              <button key={key} type="button" role="tab" aria-selected={view === key} onClick={() => setView(key)} className={`inline-flex min-h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${view === key ? 'bg-surface-hover text-text-primary ring-1 ring-inset ring-border-strong' : 'text-text-muted hover:text-text-primary'}`}>
                <Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}
              </button>
            ))}
          </div>
          <button type="button" aria-pressed={view === 'settings'} onClick={() => setView(view === 'settings' ? 'month' : 'settings')}
            className={`inline-flex min-h-10 items-center gap-1.5 rounded-control border px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${view === 'settings' ? 'border-border-strong bg-surface-hover text-text-primary' : 'border-border-default bg-surface-input/60 text-text-secondary hover:border-border-strong hover:text-text-primary'}`}>
            <Settings2 className="h-3.5 w-3.5" aria-hidden="true" />Customize
          </button>
        </div>
      </header>

      {view !== 'settings' && (
        <section className="calendar-season-surface overflow-hidden rounded-surface border border-border-default" style={{ '--calendar-season-color': seasonColor }}>
          <div className="flex items-center gap-1 border-b border-border-subtle px-3 py-2.5">
            <button type="button" aria-label="Previous month" onClick={() => moveMonth(-1)} className="rounded-control p-2 text-text-muted transition-colors hover:bg-surface-hover/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"><ChevronLeft className="h-4 w-4" /></button>
            <MonthPicker calendar={calendar} cursor={cursor} onChange={setCursor} />
            <button type="button" aria-label="Next month" onClick={() => moveMonth(1)} className="rounded-control p-2 text-text-muted transition-colors hover:bg-surface-hover/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"><ChevronRight className="h-4 w-4" /></button>
            <span className="flex-1" />
            <button type="button" onClick={goToStoryDay} disabled={!storyClock} className="inline-flex items-center gap-1.5 rounded-control px-2.5 py-1.5 text-xs font-semibold text-text-secondary transition-colors hover:bg-surface-hover/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40" data-tooltip={storyClock ? formatWorldDate(calendar, storyClock) : 'No story day yet'}><Bookmark className="h-3.5 w-3.5" />Go to story day</button>
          </div>

          {view === 'month' ? (
            <>
              {monthSeasons.length > 0 && <div className="space-y-1 border-b border-border-subtle px-4 py-2.5">{monthSeasons.map(season => <div key={season.id} className="flex min-w-0 items-center gap-2.5 text-sm"><span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-sm" style={{ backgroundColor: season.color }} /><strong className="shrink-0 font-semibold text-text-primary">{season.name}</strong>{season.description && <span className="min-w-0 flex-1 truncate text-text-muted" data-tooltip={season.description}>{season.description}</span>}<span className="ml-auto shrink-0 text-xs text-text-subtle">{formatSeasonRange(calendar, season)}</span></div>)}</div>}
              <div className="grid border-b border-border-subtle bg-surface-canvas/25" style={{ gridTemplateColumns: `repeat(${calendar.weekdays.length}, minmax(0, 1fr))` }}>
                {calendar.weekdays.map(day => <div key={day} className="truncate px-2 py-2 text-xs font-semibold text-text-subtle">{day}</div>)}
              </div>
              <div className="grid" style={{ gridTemplateColumns: `repeat(${calendar.weekdays.length}, minmax(0, 1fr))` }}>
                {Array.from({ length: monthData?.firstWeekday || 0 }, (_, index) => <div key={`empty-${index}`} className="min-h-28 border-b border-r border-border-subtle bg-surface-canvas/25" />)}
                {Array.from({ length: monthData?.daysInMonth || 0 }, (_, index) => {
                  const day = index + 1;
                  const dayEntries = entriesByDay.get(day) || [];
                  const daySeason = seasonForDate(calendar, { month: cursor.month, day });
                  const isStoryDay = sameDate(storyClock, { eraId: cursor.eraId, year: cursor.year, month: cursor.month, day });
                  return <div key={day} className={`calendar-day group relative min-h-28 border-b border-r border-border-subtle p-2 ${isStoryDay ? 'bg-accent/[0.06] ring-1 ring-inset ring-accent/60' : ''}`} style={{ '--calendar-day-season': daySeason?.color || seasonColor }}>
                    <div className="flex items-center justify-between gap-2">
                      <span className={`inline-flex items-center gap-1.5 text-sm tabular-nums ${isStoryDay ? 'font-bold text-accent' : 'font-medium text-text-secondary'}`}>{day}{isStoryDay && <span className="text-xs font-semibold">Story day</span>}</span>
                      <span className="flex items-center gap-1.5">
                        {!isStoryDay && <button type="button" onClick={() => setStoryDay(day)} className="opacity-0 transition-opacity group-hover:opacity-100 focus:opacity-100" aria-label={`Set day ${day} as current story day`} data-tooltip="Make this the story day"><Bookmark className="h-3 w-3 text-text-subtle hover:text-accent" /></button>}
                      </span>
                    </div>
                    <div className="mt-1.5 space-y-1">
                      {dayEntries.slice(0, 3).map(entry => {
                        const visual = entryVisual(entry);
                        return <button key={entry.id} type="button" onClick={() => onOpenEntity(entry.entityId)} className="flex w-full items-center gap-1.5 rounded-md border border-border-subtle bg-surface-hover/40 px-1.5 py-1 text-left text-xs font-medium leading-tight text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40" data-tooltip={`${visual.label}: ${entry.title}`}>
                          <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: visual.color }} /><span className="min-w-0 truncate">{entry.title}</span>
                        </button>;
                      })}
                      {dayEntries.length > 3 && <span className="block px-1 text-xs font-medium text-text-subtle">+{dayEntries.length - 3} more</span>}
                    </div>
                  </div>;
                })}
              </div>
            </>
          ) : (
            <div className="divide-y divide-border-subtle">
              {(monthData?.entries || []).map(entry => {
                const visual = entryVisual(entry);
                return <button key={entry.id} type="button" onClick={() => onOpenEntity(entry.entityId)} className="flex w-full items-center gap-4 px-5 py-3 text-left transition-colors duration-200 ease-standard hover:bg-surface-hover/40">
                  <span className="w-10 font-mono text-sm" style={{ color: visual.color }}>{entry.date.day}</span>
                  <span className="min-w-0 flex-1 text-sm text-text-secondary">{entry.title}</span>
                  <span className="calendar-entry rounded-full px-2 py-0.5 text-xs font-semibold" style={{ '--calendar-entry-color': visual.color }}>{visual.label}</span>
                </button>;
              })}
              {!monthData?.entries?.length && <p className="px-5 py-10 text-center text-sm text-text-disabled">No entries in this month.</p>}
            </div>
          )}
        </section>
      )}

      {view === 'settings' && (
        <div className="space-y-2 rounded-surface border border-border-subtle bg-surface-panel/92 p-3 shadow-panel backdrop-blur-md sm:p-4">
          <SettingsPanel
            id="calendar-rules"
            title="Rules"
            summary={`${draft.name || 'Calendar'} · ${draft.hoursPerDay}-hour days · ${draft.leapRule.type === 'gregorian' ? 'Gregorian leap years' : 'no leap years'}`}
            open={openSettingsSection === 'rules'}
            onToggle={() => toggleSettingsSection('rules')}
          >
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="sm:col-span-2"><Label>Name</Label><input className={INPUT} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
              <label><Label>Hours per day</Label><input className={INPUT} type="number" min="1" max="100" value={draft.hoursPerDay} onChange={event => setDraft({ ...draft, hoursPerDay: Number(event.target.value) || 1 })} /></label>
              <div><Label>Year 1 starts on</Label><SelectMenu ariaLabel="Year 1 starts on" value={draft.epochWeekday} onChange={epochWeekday => setDraft({ ...draft, epochWeekday: Number(epochWeekday) })} options={draft.weekdays.map((name, index) => ({ value: index, label: name }))} /></div>
              <div><Label>Leap years</Label><SelectMenu ariaLabel="Leap years" value={draft.leapRule.type} onChange={type => setDraft({ ...draft, leapRule: type === 'gregorian' ? { type: 'gregorian', month: 2, extraDays: 1 } : { type: 'none' } })} options={[{ value: 'none', label: 'None' }, { value: 'gregorian', label: 'Gregorian rule' }]} /></div>
            </div>
          </SettingsPanel>

          <SettingsPanel
            id="calendar-months"
            title="Months"
            summary={`${draft.months.length} ${draft.months.length === 1 ? 'month' : 'months'}, ${baseYearDays} base days`}
            open={openSettingsSection === 'months'}
            onToggle={() => toggleSettingsSection('months')}
            action={<AddButton ariaLabel="Add month" onClick={addMonth} />}
          >
            <div className="grid gap-2 md:grid-cols-2">
              {draft.months.map((month, index) => (
                <div key={month.id} className="grid grid-cols-[1.75rem_minmax(0,1fr)_4.75rem_2.25rem] items-center gap-2 rounded-control border border-border-subtle bg-surface-input/40 p-1.5">
                  <span className="text-center font-mono text-xs text-text-subtle" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                  <input aria-label={`Month ${index + 1} name`} className={INPUT} value={month.name} onChange={event => updateList('months', index, { name: event.target.value })} />
                  <input aria-label={`${month.name || `Month ${index + 1}`} days`} className={`${INPUT} text-center`} type="number" min="1" value={month.days} onChange={event => updateList('months', index, { days: Number(event.target.value) || 1 })} />
                  <DeleteButton ariaLabel={`Delete ${month.name || `month ${index + 1}`}`} disabled={draft.months.length === 1} onClick={() => setDraft({ ...draft, months: draft.months.filter((_, itemIndex) => itemIndex !== index) })} />
                </div>
              ))}
            </div>
          </SettingsPanel>

          <SettingsPanel
            id="calendar-weekdays"
            title="Weekdays"
            summary={`${draft.weekdays.length}-day week, Year 1 starts on ${startingWeekday}`}
            open={openSettingsSection === 'weekdays'}
            onToggle={() => toggleSettingsSection('weekdays')}
            action={<AddButton ariaLabel="Add weekday" onClick={addWeekday} />}
          >
            <div className="grid gap-2 sm:grid-cols-2">
              {draft.weekdays.map((name, index) => (
                <div key={index} className="grid grid-cols-[1.75rem_minmax(0,1fr)_2.25rem] items-center gap-2 rounded-control border border-border-subtle bg-surface-input/40 p-1.5">
                  <span className="text-center font-mono text-xs text-text-subtle" aria-hidden="true">{String(index + 1).padStart(2, '0')}</span>
                  <input aria-label={`Weekday ${index + 1} name`} className={INPUT} value={name} onChange={event => updateList('weekdays', index, event.target.value)} />
                  <DeleteButton ariaLabel={`Delete ${name || `weekday ${index + 1}`}`} disabled={draft.weekdays.length === 1} onClick={() => setDraft({ ...draft, weekdays: draft.weekdays.filter((_, itemIndex) => itemIndex !== index) })} />
                </div>
              ))}
            </div>
          </SettingsPanel>

          <SettingsPanel
            id="calendar-eras"
            title="Eras"
            summary={`${draft.eras.length} ${draft.eras.length === 1 ? 'era' : 'eras'}, ${defaultEra?.shortName || defaultEra?.name || 'none'} default`}
            open={openSettingsSection === 'eras'}
            onToggle={() => toggleSettingsSection('eras')}
            action={<AddButton ariaLabel="Add era" onClick={addEra} />}
          >
            <p className="caption mb-3">The timeline origin connects eras without assuming that Year 1 was the beginning of the world.</p>
            <div className="mb-1 hidden gap-2 px-2 lg:grid lg:grid-cols-[minmax(0,1fr)_6rem_9rem_7rem_2.5rem]"><Label>Name</Label><Label>Short name</Label><Label>Direction</Label><Label>Timeline origin</Label><span /></div>
            <div className="space-y-2">
              {draft.eras.map((era, index) => (
                <div key={era.id} className="grid gap-2 rounded-control border border-border-subtle bg-surface-input/40 p-2 lg:grid-cols-[minmax(0,1fr)_6rem_9rem_7rem_2.5rem] lg:items-end">
                  <label className="min-w-0"><span className="mb-1 block text-xs font-medium text-text-muted lg:hidden">Name</span><input aria-label={`Era ${index + 1} name`} className={INPUT} value={era.name} onChange={event => updateList('eras', index, { name: event.target.value })} /></label>
                  <label className="min-w-0"><span className="mb-1 block text-xs font-medium text-text-muted lg:hidden">Short name</span><input aria-label={`${era.name || `Era ${index + 1}`} short name`} className={INPUT} value={era.shortName} onChange={event => updateList('eras', index, { shortName: event.target.value })} /></label>
                  <div className="min-w-0"><span className="mb-1 block text-xs font-medium text-text-muted lg:hidden">Direction</span><SelectMenu ariaLabel={`${era.name || `Era ${index + 1}`} direction`} value={era.direction} onChange={direction => updateList('eras', index, { direction })} options={[{ value: 'forward', label: 'Counts forward' }, { value: 'backward', label: 'Counts backward' }]} /></div>
                  <label className="min-w-0"><span className="mb-1 block text-xs font-medium text-text-muted lg:hidden">Timeline origin</span><input aria-label={`${era.name || `Era ${index + 1}`} timeline origin`} className={INPUT} type="number" value={era.offset} onChange={event => updateList('eras', index, { offset: Number(event.target.value) || 0 })} data-tooltip="Absolute year offset" /></label>
                  <DeleteButton ariaLabel={`Delete ${era.name || `era ${index + 1}`}`} className="justify-self-end lg:justify-self-stretch" disabled={draft.eras.length === 1} onClick={() => setDraft({ ...draft, eras: draft.eras.filter((_, itemIndex) => itemIndex !== index) })} />
                </div>
              ))}
            </div>
          </SettingsPanel>

          <SettingsPanel
            id="calendar-seasons"
            title="Seasons"
            summary={draft.seasons.length ? `${draft.seasons.length} configured` : 'No seasons configured'}
            open={openSettingsSection === 'seasons'}
            onToggle={() => toggleSettingsSection('seasons')}
            action={<AddButton ariaLabel="Add season" onClick={addSeason} />}
          >
            {draft.seasons.length ? (
              <div className="space-y-2">
                {draft.seasons.map((season, index) => {
                  const seasonOpen = openSeasonId === season.id;
                  const triggerId = `season-trigger-${season.id}`;
                  const panelId = `season-editor-${season.id}`;
                  return (
                    <article key={season.id} className="calendar-season-card overflow-hidden rounded-card border" style={{ '--calendar-season-color': season.color }}>
                      <div className="flex items-stretch">
                        <button
                          id={triggerId}
                          type="button"
                          aria-expanded={seasonOpen}
                          aria-controls={panelId}
                          onClick={() => setOpenSeasonId(current => current === season.id ? null : season.id)}
                          className="flex min-w-0 flex-1 items-center gap-3 p-3 text-left outline-none transition-colors duration-200 ease-standard hover:bg-surface-hover/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
                        >
                          <span className="h-7 w-2 shrink-0 rounded-full border border-border-strong" style={{ backgroundColor: season.color }} />
                          <span className="min-w-0 flex-1">
                            <span className="flex min-w-0 flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-2">
                              <strong className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">{season.name || `Season ${index + 1}`}</strong>
                              <span className="shrink-0 text-xs font-medium text-text-muted">{formatSeasonRange(draft, season)}</span>
                            </span>
                            <span className="mt-0.5 block truncate text-xs text-text-subtle">{season.description || 'No narrative description'}</span>
                          </span>
                          <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-text-subtle transition-transform duration-200 motion-reduce:transition-none ${seasonOpen ? 'rotate-180' : ''}`} />
                        </button>
                        <div className="flex shrink-0 items-center border-l border-border-subtle px-2">
                          <DeleteButton ariaLabel={`Delete ${season.name || `season ${index + 1}`}`} onClick={() => removeSeason(season.id)} />
                        </div>
                      </div>
                      {seasonOpen && (
                        <div id={panelId} role="region" aria-labelledby={triggerId} className="animate-in fade-in slide-in-from-top-1 border-t border-border-subtle p-3 duration-200 motion-reduce:animate-none sm:p-4">
                          <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_9rem]">
                            <label><Label>Name</Label><input className={INPUT} value={season.name} onChange={event => updateList('seasons', index, { name: event.target.value })} /></label>
                            <div><Label>Color</Label><ColorField ariaLabel={`Choose color for ${season.name || `season ${index + 1}`}`} value={season.color} onChange={color => updateList('seasons', index, { color })} /></div>
                          </div>
                          <label className="mt-3 block"><Label>Description</Label><textarea rows={3} className={`${INPUT} resize-y leading-relaxed`} value={season.description || ''} onChange={event => updateList('seasons', index, { description: event.target.value })} placeholder="Optional narrative description" /></label>
                          <div className="mt-3 grid gap-3 sm:grid-cols-2"><SeasonBoundary label="Starts" calendar={draft} value={season.start} onChange={start => updateList('seasons', index, { start })} /><SeasonBoundary label="Ends" calendar={draft} value={season.end} onChange={end => updateList('seasons', index, { end })} /></div>
                        </div>
                      )}
                    </article>
                  );
                })}
              </div>
            ) : (
              <p className="rounded-control border border-dashed border-border-default px-4 py-6 text-center text-sm text-text-subtle">Add seasons when the world needs named cycles or changes in climate.</p>
            )}
          </SettingsPanel>

          {invalid.length > 0 && <section className="rounded-card border border-status-warning/25 bg-status-warning/[0.05] p-4">
            <h3 className="text-sm font-semibold text-status-warning">Some saved dates no longer fit</h3>
            <p className="caption mt-1">Nothing changes until you choose how to handle them.</p>
            <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => resolveAll('adjust')} className="rounded-control bg-status-warning px-3 py-2 text-xs font-bold text-on-accent">Adjust automatically</button><button type="button" onClick={() => resolveAll('discard')} className="rounded-control border border-status-danger/30 px-3 py-2 text-xs font-semibold text-status-danger">Discard affected dates</button></div>
            <div className="mt-4 space-y-3">{invalid.map(item => <div key={item.key} className="rounded-control border border-border-subtle bg-surface-canvas/35 p-3">
              <div className="mb-2 flex items-center justify-between gap-3"><div><p className="text-xs font-semibold text-text-primary">{item.entityName || item.label}</p><p className="text-xs text-text-subtle">{item.label}: {formatWorldDate(draft, item.date)}</p></div></div>
              <WorldDateInput label="Date" emptyLabel="Set a new date" seedValue={item.date} calendar={draft} value={resolutionDraft[item.key]} onChange={date => setResolutionDraft(current => ({ ...current, [item.key]: date }))} />
            </div>)}</div>
            <div className="mt-4 flex justify-end"><button type="button" onClick={applyManualResolutions} className="rounded-control border border-accent/30 px-3 py-2 text-xs font-semibold text-accent">Apply selected dates</button></div>
          </section>}

          <div className="sticky bottom-0 z-10 -mx-3 -mb-3 mt-3 flex flex-col gap-3 rounded-b-surface border-t border-border-subtle bg-surface-panel/95 p-3 backdrop-blur-md sm:-mx-4 sm:-mb-4 sm:flex-row sm:items-center sm:justify-between sm:p-4">
            <div className="flex min-w-0 items-center gap-2" aria-live="polite">
              <span aria-hidden="true" className={`h-1.5 w-1.5 shrink-0 rounded-full ${hasUnsavedChanges ? 'bg-status-warning' : 'bg-status-success'}`} />
              <div className="min-w-0">
                <p className={`text-xs font-semibold ${hasUnsavedChanges ? 'text-status-warning' : 'text-text-secondary'}`}>{saving ? 'Saving…' : hasUnsavedChanges ? 'Unsaved changes' : 'Up to date'}</p>
                <p className="caption mt-0.5">Saved rules apply to every date and to roleplay time.</p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:flex sm:shrink-0 sm:justify-end">
              <button type="button" disabled={saving} onClick={() => save([], {})} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-control border border-border-default px-3 text-xs font-semibold text-text-secondary transition-colors duration-200 ease-standard hover:bg-surface-hover/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-50"><RotateCcw aria-hidden="true" className="h-4 w-4" />Use standard calendar</button>
              <button type="button" disabled={saving} onClick={() => save()} className="inline-flex min-h-10 items-center justify-center gap-2 rounded-control bg-accent px-4 text-xs font-bold text-on-accent transition-[filter] duration-200 ease-standard hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60 focus-visible:ring-offset-2 focus-visible:ring-offset-surface-panel disabled:opacity-50"><Save aria-hidden="true" className="h-4 w-4" />Save calendar</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function Label({ children }) { return <span className="mb-1.5 block text-xs font-medium text-text-muted">{children}</span>; }
// Where the calendar is, as one control: the month, the year and the era it counts in.
function MonthPicker({ calendar, cursor, onChange }) {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const era = calendar.eras.find(item => item.id === cursor.eraId);
  return (
    <>
      <button ref={anchorRef} type="button" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(value => !value)}
        className="inline-flex min-h-9 items-center gap-2 rounded-control px-2.5 text-left transition-colors hover:bg-surface-hover/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
        <span className="text-[1.0625rem] font-bold text-text-primary">{calendar.months[cursor.month - 1]?.name}</span>
        <span className="text-[1.0625rem] font-medium tabular-nums text-text-muted">{cursor.year} {era?.shortName}</span>
        <ChevronDown className="h-4 w-4 text-text-subtle" aria-hidden="true" />
      </button>
      <Popover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} matchAnchorWidth={false} scroll={false} maxHeight={420} className="w-80 border-border-default bg-surface-panel p-3">
        <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-2">
          <label><span className="mb-1 block text-xs font-medium text-text-muted">Year</span>
            <input className={`${INPUT} w-full`} type="number" min="1" value={cursor.year} onChange={event => onChange({ ...cursor, year: Math.max(1, Number(event.target.value) || 1) })} /></label>
          <div role="radiogroup" aria-label="Era"><span className="mb-1 block text-xs font-medium text-text-muted">Era</span>
            <div className="flex flex-wrap gap-1">{calendar.eras.map(item => (
              <button key={item.id} type="button" role="radio" aria-checked={cursor.eraId === item.id} onClick={() => onChange({ ...cursor, eraId: item.id })} data-tooltip={item.name}
                className={`min-h-9 rounded-md px-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${cursor.eraId === item.id ? 'bg-surface-hover text-text-primary ring-1 ring-inset ring-border-strong' : 'text-text-muted hover:text-text-primary'}`}>{item.shortName}</button>
            ))}</div></div>
        </div>
        <div className="mt-3 grid grid-cols-3 gap-1">
          {calendar.months.map((month, index) => (
            <button key={month.id || index} type="button" onClick={() => { onChange({ ...cursor, month: index + 1 }); setOpen(false); }}
              className={`truncate rounded-md px-2 py-1.5 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${cursor.month === index + 1 ? 'bg-surface-hover text-text-primary ring-1 ring-inset ring-border-strong' : 'text-text-secondary hover:bg-surface-hover/60 hover:text-text-primary'}`}>
              {month.name}
            </button>
          ))}
        </div>
      </Popover>
    </>
  );
}

function SettingsPanel({ id, title, summary, action, open, onToggle, children }) {
  const triggerId = `${id}-trigger`;
  const panelId = `${id}-content`;
  return (
    <section className={`overflow-hidden rounded-card border transition-colors duration-200 ease-standard ${open ? 'border-border-default bg-surface-panel-muted/60' : 'border-border-subtle bg-surface-panel-muted/25'}`}>
      <div className="flex items-center gap-1 pr-2">
        <button
          id={triggerId}
          type="button"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-center gap-3 rounded-card px-3.5 py-3 text-left outline-none transition-colors duration-200 ease-standard hover:bg-surface-hover/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
        >
          <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-text-subtle transition-transform duration-200 ease-standard motion-reduce:transition-none ${open ? 'rotate-0' : '-rotate-90'}`} />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-semibold text-text-primary">{title}</span>
            <span className="mt-1 block truncate text-xs text-text-subtle">{summary}</span>
          </span>
        </button>
        {open && action}
      </div>
      {open && (
        <div id={panelId} role="region" aria-labelledby={triggerId} className="border-t border-border-subtle">
          <div className="animate-rise-in p-3 sm:p-4">{children}</div>
        </div>
      )}
    </section>
  );
}
function AddButton({ onClick, ariaLabel }) {
  return <button type="button" aria-label={ariaLabel} onClick={onClick} className="inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-control px-2.5 text-xs font-semibold text-text-muted transition-colors duration-200 ease-standard hover:bg-surface-hover/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"><Plus aria-hidden="true" className="h-3.5 w-3.5" />Add</button>;
}
function DeleteButton({ onClick, disabled, ariaLabel, className = '' }) {
  return <button type="button" aria-label={ariaLabel} disabled={disabled} onClick={onClick} className={`flex min-h-9 min-w-9 items-center justify-center rounded-control text-text-subtle transition-colors duration-200 ease-standard hover:bg-status-danger/[0.08] hover:text-status-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger/40 disabled:cursor-not-allowed disabled:opacity-20 ${className}`}><Trash2 aria-hidden="true" className="h-4 w-4" /></button>;
}
function formatSeasonRange(calendar, season) {
  const formatBoundary = boundary => {
    const month = calendar.months[Number(boundary?.month) - 1];
    return `${month?.name || `Month ${boundary?.month || 1}`} ${boundary?.day || 1}`;
  };
  return `${formatBoundary(season.start)} to ${formatBoundary(season.end)}`;
}
function SeasonBoundary({ label, calendar, value, onChange }) {
  return <div><Label>{label}</Label><div className="grid grid-cols-[minmax(0,1fr)_5rem] gap-2"><SelectMenu ariaLabel={`${label} month`} value={value.month} onChange={month => onChange({ ...value, month: Number(month) })} options={calendar.months.map((month, index) => ({ value: index + 1, label: month.name }))} /><input aria-label={`${label} day`} className={INPUT} type="number" min="1" max={calendar.months[value.month - 1]?.days || 1} value={value.day} onChange={event => onChange({ ...value, day: Number(event.target.value) || 1 })} /></div></div>;
}
