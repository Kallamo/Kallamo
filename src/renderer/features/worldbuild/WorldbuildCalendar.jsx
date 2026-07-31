import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, List, Plus, RotateCcw, Save, Settings2, Trash2 } from 'lucide-react';
import WorldDateInput, { formatWorldDate } from './WorldDateInput';

const INPUT = 'w-full rounded-lg border border-white/10 bg-[#06151c] px-3 py-2 text-sm text-gray-200 outline-none transition-colors focus:border-accent/60';

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

  const loadCalendar = useCallback(async () => {
    const result = await api.getWorldCalendar(workspaceId);
    if (!result?.success) throw new Error(result?.error || 'Could not load the calendar.');
    setCalendar(result.calendar);
    setDraft(clone(result.calendar));
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

  if (!calendar || !draft || !cursor) return <div className="p-8 text-sm text-gray-500">Loading calendar…</div>;
  const monthName = calendar.months[cursor.month - 1]?.name;

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-accent"><CalendarDays className="h-5 w-5" /><span className="text-[0.7rem] font-bold uppercase tracking-[0.15em]">World Calendar</span></div>
          <h2 className="mt-1 text-2xl font-semibold text-white">{calendar.name}</h2>
          <p className="mt-1 text-sm text-gray-500">Canonical dates are stored by day. Hours and minutes belong to each RP history.</p>
        </div>
        <div className="flex rounded-lg border border-white/10 bg-black/20 p-1">
          {[['month', CalendarDays, 'Calendar'], ['timeline', List, 'Timeline'], ['settings', Settings2, 'Customize']].map(([key, Icon, label]) => (
            <button key={key} type="button" onClick={() => setView(key)} className={`inline-flex items-center gap-1.5 rounded-md px-3 py-2 text-xs font-semibold ${view === key ? 'bg-accent text-[#011419]' : 'text-gray-400 hover:text-white'}`}>
              <Icon className="h-3.5 w-3.5" />{label}
            </button>
          ))}
        </div>
      </header>

      {view !== 'settings' && (
        <section className="overflow-hidden rounded-2xl border border-white/10 bg-[#07151b]/90">
          <div className="flex items-center justify-between border-b border-white/10 px-4 py-3">
            <button type="button" onClick={() => moveMonth(-1)} className="rounded-lg p-2 text-gray-400 hover:bg-white/5 hover:text-white"><ChevronLeft className="h-4 w-4" /></button>
            <div className="flex items-center gap-2">
              <select className={INPUT} value={cursor.eraId} onChange={event => setCursor({ ...cursor, eraId: event.target.value })}>{calendar.eras.map(era => <option key={era.id} value={era.id}>{era.shortName}</option>)}</select>
              <input className={`${INPUT} w-24`} type="number" min="1" value={cursor.year} onChange={event => setCursor({ ...cursor, year: Math.max(1, Number(event.target.value) || 1) })} />
              <span className="min-w-32 text-center text-sm font-semibold text-gray-100">{monthName}</span>
            </div>
            <button type="button" onClick={() => moveMonth(1)} className="rounded-lg p-2 text-gray-400 hover:bg-white/5 hover:text-white"><ChevronRight className="h-4 w-4" /></button>
          </div>

          {view === 'month' ? (
            <>
              <div className="grid border-b border-white/[0.07]" style={{ gridTemplateColumns: `repeat(${calendar.weekdays.length}, minmax(0, 1fr))` }}>
                {calendar.weekdays.map(day => <div key={day} className="px-2 py-2 text-center text-[0.65rem] font-bold uppercase tracking-wider text-gray-500">{day}</div>)}
              </div>
              <div className="grid" style={{ gridTemplateColumns: `repeat(${calendar.weekdays.length}, minmax(0, 1fr))` }}>
                {Array.from({ length: monthData?.firstWeekday || 0 }, (_, index) => <div key={`empty-${index}`} className="min-h-28 border-b border-r border-white/[0.05] bg-black/10" />)}
                {Array.from({ length: monthData?.daysInMonth || 0 }, (_, index) => {
                  const day = index + 1;
                  return <div key={day} className="min-h-28 border-b border-r border-white/[0.05] p-2">
                    <span className="text-xs font-semibold text-gray-400">{day}</span>
                    <div className="mt-2 space-y-1">
                      {(entriesByDay.get(day) || []).slice(0, 4).map(entry => (
                        <button key={entry.id} type="button" onClick={() => onOpenEntity(entry.entityId)} className="block w-full truncate rounded-md border border-accent/15 bg-accent/[0.06] px-1.5 py-1 text-left text-[0.65rem] text-accent hover:bg-accent/10" title={entry.title}>{entry.title}</button>
                      ))}
                    </div>
                  </div>;
                })}
              </div>
            </>
          ) : (
            <div className="divide-y divide-white/[0.06]">
              {(monthData?.entries || []).map(entry => (
                <button key={entry.id} type="button" onClick={() => onOpenEntity(entry.entityId)} className="flex w-full items-center gap-4 px-5 py-3 text-left hover:bg-white/[0.03]">
                  <span className="w-10 font-mono text-sm text-accent">{entry.date.day}</span>
                  <span className="flex-1 text-sm text-gray-200">{entry.title}</span>
                  <span className="text-[0.65rem] font-semibold uppercase tracking-wider text-gray-600">{entry.kind.replaceAll('-', ' ')}</span>
                </button>
              ))}
              {!monthData?.entries?.length && <p className="px-5 py-10 text-center text-sm text-gray-600">No entries in this month.</p>}
            </div>
          )}
        </section>
      )}

      {view === 'settings' && (
        <div className="space-y-4">
          <SettingsPanel title="Calendar rules">
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="sm:col-span-2"><Label>Name</Label><input className={INPUT} value={draft.name} onChange={event => setDraft({ ...draft, name: event.target.value })} /></label>
              <label><Label>Hours per day</Label><input className={INPUT} type="number" min="1" max="100" value={draft.hoursPerDay} onChange={event => setDraft({ ...draft, hoursPerDay: Number(event.target.value) || 1 })} /></label>
              <label><Label>Year 1 starts on</Label><select className={INPUT} value={draft.epochWeekday} onChange={event => setDraft({ ...draft, epochWeekday: Number(event.target.value) })}>{draft.weekdays.map((name, index) => <option key={index} value={index}>{name}</option>)}</select></label>
              <label><Label>Leap years</Label><select className={INPUT} value={draft.leapRule.type} onChange={event => setDraft({ ...draft, leapRule: event.target.value === 'gregorian' ? { type: 'gregorian', month: 2, extraDays: 1 } : { type: 'none' } })}><option value="none">None</option><option value="gregorian">Gregorian rule</option></select></label>
            </div>
          </SettingsPanel>

          <SettingsPanel title="Months" action={<AddButton onClick={() => setDraft({ ...draft, months: [...draft.months, { id: crypto.randomUUID(), name: `Month ${draft.months.length + 1}`, days: 30 }] })} />}>
            <div className="space-y-2">{draft.months.map((month, index) => <div key={month.id} className="grid grid-cols-[1fr_7rem_2rem] gap-2"><input className={INPUT} value={month.name} onChange={event => updateList('months', index, { name: event.target.value })} /><input className={INPUT} type="number" min="1" value={month.days} onChange={event => updateList('months', index, { days: Number(event.target.value) || 1 })} /><DeleteButton disabled={draft.months.length === 1} onClick={() => setDraft({ ...draft, months: draft.months.filter((_, itemIndex) => itemIndex !== index) })} /></div>)}</div>
          </SettingsPanel>

          <SettingsPanel title="Weekdays" action={<AddButton onClick={() => setDraft({ ...draft, weekdays: [...draft.weekdays, `Day ${draft.weekdays.length + 1}`] })} />}>
            <div className="grid gap-2 sm:grid-cols-2">{draft.weekdays.map((name, index) => <div key={index} className="grid grid-cols-[1fr_2rem] gap-2"><input className={INPUT} value={name} onChange={event => updateList('weekdays', index, event.target.value)} /><DeleteButton disabled={draft.weekdays.length === 1} onClick={() => setDraft({ ...draft, weekdays: draft.weekdays.filter((_, itemIndex) => itemIndex !== index) })} /></div>)}</div>
          </SettingsPanel>

          <SettingsPanel title="Eras" action={<AddButton onClick={() => setDraft({ ...draft, eras: [...draft.eras, { id: crypto.randomUUID(), name: `Era ${draft.eras.length + 1}`, shortName: `E${draft.eras.length + 1}`, direction: 'forward', offset: 1 }] })} />}>
            <p className="mb-3 text-xs text-gray-600">The timeline origin connects eras without assuming that Year 1 was the beginning of the world.</p>
            <div className="mb-1 hidden gap-2 px-1 sm:grid sm:grid-cols-[1fr_6rem_8rem_7rem_2rem]"><Label>Name</Label><Label>Short name</Label><Label>Direction</Label><Label>Timeline origin</Label><span /></div>
            <div className="space-y-2">{draft.eras.map((era, index) => <div key={era.id} className="grid gap-2 sm:grid-cols-[1fr_6rem_8rem_7rem_2rem]"><input className={INPUT} value={era.name} onChange={event => updateList('eras', index, { name: event.target.value })} /><input className={INPUT} value={era.shortName} onChange={event => updateList('eras', index, { shortName: event.target.value })} /><select className={INPUT} value={era.direction} onChange={event => updateList('eras', index, { direction: event.target.value })}><option value="forward">Counts forward</option><option value="backward">Counts backward</option></select><input className={INPUT} type="number" value={era.offset} onChange={event => updateList('eras', index, { offset: Number(event.target.value) || 0 })} title="Absolute year offset" /><DeleteButton disabled={draft.eras.length === 1} onClick={() => setDraft({ ...draft, eras: draft.eras.filter((_, itemIndex) => itemIndex !== index) })} /></div>)}</div>
          </SettingsPanel>

          <SettingsPanel title="Seasons (optional)" action={<AddButton onClick={() => setDraft({ ...draft, seasons: [...draft.seasons, { id: crypto.randomUUID(), name: `Season ${draft.seasons.length + 1}`, color: '#6ee7b7', description: '', start: { month: 1, day: 1 }, end: { month: draft.months.length, day: draft.months.at(-1).days } }] })} />}>
            <div className="space-y-3">{draft.seasons.map((season, index) => <div key={season.id} className="rounded-xl border border-white/10 p-3">
              <div className="grid gap-2 sm:grid-cols-[1fr_3rem_2rem]"><input className={INPUT} value={season.name} onChange={event => updateList('seasons', index, { name: event.target.value })} /><input className={`${INPUT} h-10 p-1`} type="color" value={season.color} onChange={event => updateList('seasons', index, { color: event.target.value })} /><DeleteButton onClick={() => setDraft({ ...draft, seasons: draft.seasons.filter((_, itemIndex) => itemIndex !== index) })} /></div>
              <input className={`${INPUT} mt-2`} value={season.description || ''} onChange={event => updateList('seasons', index, { description: event.target.value })} placeholder="Optional narrative description" />
              <div className="mt-2 grid gap-3 sm:grid-cols-2"><SeasonBoundary label="Starts" calendar={draft} value={season.start} onChange={start => updateList('seasons', index, { start })} /><SeasonBoundary label="Ends" calendar={draft} value={season.end} onChange={end => updateList('seasons', index, { end })} /></div>
            </div>)}</div>
          </SettingsPanel>

          {invalid.length > 0 && <section className="rounded-xl border border-amber-400/25 bg-amber-400/[0.04] p-4">
            <h3 className="text-sm font-semibold text-amber-100">Some saved dates no longer fit</h3>
            <p className="mt-1 text-xs text-amber-100/60">Nothing changes until you choose how to handle them.</p>
            <div className="mt-3 flex flex-wrap gap-2"><button type="button" onClick={() => resolveAll('adjust')} className="rounded-lg bg-amber-300 px-3 py-2 text-xs font-bold text-[#211900]">Adjust automatically</button><button type="button" onClick={() => resolveAll('discard')} className="rounded-lg border border-red-400/30 px-3 py-2 text-xs font-semibold text-red-200">Discard affected dates</button></div>
            <div className="mt-4 space-y-3">{invalid.map(item => <div key={item.key} className="rounded-lg border border-white/10 bg-black/15 p-3">
              <div className="mb-2 flex items-center justify-between gap-3"><div><p className="text-xs font-semibold text-gray-200">{item.entityName || item.label}</p><p className="text-[0.7rem] text-gray-500">{item.label}: {formatWorldDate(draft, item.date)}</p></div></div>
              <WorldDateInput calendar={draft} value={resolutionDraft[item.key]} onChange={date => setResolutionDraft(current => ({ ...current, [item.key]: date }))} />
            </div>)}</div>
            <div className="mt-4 flex justify-end"><button type="button" onClick={applyManualResolutions} className="rounded-lg border border-amber-300/30 px-3 py-2 text-xs font-semibold text-amber-100">Apply selected dates</button></div>
          </section>}

          <div className="flex justify-end gap-2">
            <button type="button" disabled={saving} onClick={() => save([], {})} className="inline-flex items-center gap-2 rounded-lg border border-white/10 px-4 py-2.5 text-xs font-semibold text-gray-300 hover:bg-white/5 disabled:opacity-50"><RotateCcw className="h-4 w-4" />Use standard calendar</button>
            <button type="button" disabled={saving} onClick={() => save()} className="inline-flex items-center gap-2 rounded-lg bg-accent px-4 py-2.5 text-xs font-bold text-[#011419] disabled:opacity-50"><Save className="h-4 w-4" />Save calendar</button>
          </div>
        </div>
      )}
    </div>
  );
}

function Label({ children }) { return <span className="mb-1.5 block text-[0.65rem] font-bold uppercase tracking-wider text-gray-500">{children}</span>; }
function SettingsPanel({ title, action, children }) { return <section className="rounded-xl border border-white/10 bg-[#07151b]/80 p-4"><div className="mb-4 flex items-center justify-between"><h3 className="text-xs font-bold uppercase tracking-wider text-gray-300">{title}</h3>{action}</div>{children}</section>; }
function AddButton({ onClick }) { return <button type="button" onClick={onClick} className="inline-flex items-center gap-1 text-xs font-semibold text-accent"><Plus className="h-3.5 w-3.5" />Add</button>; }
function DeleteButton({ onClick, disabled }) { return <button type="button" disabled={disabled} onClick={onClick} className="flex items-center justify-center text-gray-600 hover:text-red-300 disabled:opacity-20"><Trash2 className="h-4 w-4" /></button>; }
function SeasonBoundary({ label, calendar, value, onChange }) {
  return <label><Label>{label}</Label><div className="grid grid-cols-[1fr_5rem] gap-2"><select className={INPUT} value={value.month} onChange={event => onChange({ ...value, month: Number(event.target.value) })}>{calendar.months.map((month, index) => <option key={month.id} value={index + 1}>{month.name}</option>)}</select><input className={INPUT} type="number" min="1" max={calendar.months[value.month - 1]?.days || 1} value={value.day} onChange={event => onChange({ ...value, day: Number(event.target.value) || 1 })} /></div></label>;
}
