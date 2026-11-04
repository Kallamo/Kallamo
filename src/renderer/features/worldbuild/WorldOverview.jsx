import React, { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ChevronRight, Globe, History, Plus, ScanEye } from 'lucide-react';
import Button from '../../components/ui/Button';
import { AiGlyph } from '../../components/ui/glyphs';
import { TYPE_ORDER, entityMeta, meta } from './worldbuildConfig';
import { formatWorldDate } from './WorldDateInput';
import { kindOf } from '../roleplay/changeKinds';
import { describeWorldChanges } from './worldChanges';

const RECENT_LIMIT = 8;
const NEUTRAL_CHIP = 'bg-tint/[0.06] text-text-secondary ring-1 ring-inset ring-border-subtle';
const SOURCE_TONE = { turn: 'text-entity-event', you: 'text-accent', ai: 'text-status-info' };

const ago = (ms) => {
  if (!ms) return '';
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(ms));
};

// What a world holds at a glance, with the next thing to review a click away.
export default function WorldOverview({ workspaceId, api, workspaceName, entities, typeMeta, calendar, storyDate, counts, onFilter, onReview, onOpen, onCreate }) {
  const confirmed = useMemo(() => entities.filter(entity => entity.status !== 'proposed'), [entities]);
  const recent = useMemo(() => [...confirmed].sort((a, b) => (b.lastModified || b.last_modified || 0) - (a.lastModified || a.last_modified || 0)).slice(0, 5), [confirmed]);
  const waiting = counts.proposed + counts.updates + counts.names;
  const [rawChanges, setRawChanges] = useState([]);
  // Read each time the overview shows, and again when the registry changes under it.
  useEffect(() => {
    if (!workspaceId || !api?.listWorldChanges) return undefined;
    let cancelled = false;
    api.listWorldChanges(workspaceId, RECENT_LIMIT)
      .then(result => { if (!cancelled && result?.success) setRawChanges(result.changes || []); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [workspaceId, api, entities]);
  const changes = useMemo(() => describeWorldChanges(rawChanges, entities), [rawChanges, entities]);

  if (!entities.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-4 px-8 text-center">
        <div className="flex h-16 w-16 items-center justify-center rounded-surface border border-border-subtle bg-surface-hover/35"><Globe className="h-8 w-8 text-text-muted" /></div>
        <div>
          <h2 className="text-lg font-bold text-text-primary">Build your world</h2>
          <p className="caption mt-1 max-w-sm">Create characters, places, factions, items and the rules that bind them. The AI tags your story against this registry so it remembers who's who.</p>
        </div>
        <Button icon={Plus} onClick={onCreate}>Create</Button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl space-y-5 p-6">
      <header>
        {workspaceName && <p className="text-sm text-text-muted">{workspaceName}</p>}
        <h1 className="mt-0.5 text-2xl font-bold text-text-primary">Your world</h1>
        <p className="caption mt-1 text-sm">Everything the AI can look up while it writes.{storyDate && calendar ? ` Story day is ${formatWorldDate(calendar, storyDate)}.` : ''}</p>
      </header>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        {TYPE_ORDER.map(type => {
          const t = typeMeta(type);
          const Icon = t.icon;
          const total = confirmed.filter(entity => entity.type === type).length;
          return (
            <button key={type} type="button" onClick={() => onFilter(type)}
              className="ws-card flex items-center gap-3 rounded-card border border-border-subtle bg-surface-panel-muted/60 p-3.5 text-left backdrop-blur-md transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-control border ${t.medallion}`}><Icon className="h-4 w-4" aria-hidden="true" /></span>
              <span className="min-w-0">
                <span className="block text-xl font-bold tabular-nums text-text-primary">{total}</span>
                <span className="block truncate text-xs text-text-muted">{t.plural || t.label}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.75fr)]">
        <section data-tour="wb-review" className="ws-card rounded-card border border-border-default bg-surface-panel-muted/60 backdrop-blur-md">
          <header className="flex min-h-11 items-center gap-2.5 border-b border-border-subtle px-4"><AiGlyph className="h-4 w-4 text-text-muted" /><h2 className="text-sm font-semibold text-text-primary">Waiting for review</h2></header>
          <div className="space-y-2 p-4 text-sm">
            {waiting === 0 && <p className="text-text-disabled">Nothing waiting. Suggestions from the AI land here.</p>}
            {counts.proposed > 0 && <Row icon={AiGlyph} tone="text-status-warning" label="New entities proposed" value={counts.proposed} onClick={() => onReview('proposed')} />}
            {counts.updates > 0 && <Row icon={ScanEye} tone="text-status-info" label="Sheets with suggested updates" value={counts.updates} onClick={() => onReview('updates')} />}
            {counts.names > 0 && <Row icon={AlertTriangle} tone="text-status-warning" label="Names to check" value={counts.names} onClick={() => onReview('names')} />}
          </div>
        </section>
        <section className="ws-card rounded-card border border-border-default bg-surface-panel-muted/60 backdrop-blur-md">
          <header className="flex min-h-11 items-center gap-2.5 border-b border-border-subtle px-4"><History className="h-4 w-4 text-text-muted" /><h2 className="text-sm font-semibold text-text-primary">Recently changed</h2></header>
          {changes.length > 0 ? (
            <ul className="px-2 py-1.5">
              {changes.map(change => <ChangeRow key={change.key} change={change} onOpen={() => onOpen(change.entity)} />)}
            </ul>
          ) : (
          // A world with no recorded changes yet, such as one from before they were kept, lists its latest sheets.
          <div className="divide-y divide-border-subtle px-4 py-1">
            {recent.map(entity => {
              const m = entityMeta(entity);
              const Icon = m.icon;
              return (
                <button key={entity.id} type="button" onClick={() => onOpen(entity)} className="flex w-full items-center gap-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                  <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${m.medallion}`}><Icon className="h-3.5 w-3.5" aria-hidden="true" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-text-primary">{entity.canonicalName}</span>
                    <span className="block text-xs text-text-muted">{meta(entity.type).label}</span>
                  </span>
                  <span className="shrink-0 text-xs text-text-subtle">{ago(entity.lastModified || entity.last_modified)}</span>
                </button>
              );
            })}
          </div>
          )}
        </section>
      </div>
    </div>
  );
}

function ChangeRow({ change, onOpen }) {
  const m = entityMeta(change.entity);
  const Icon = m.icon;
  const chip = change.kind === 'edit' || change.kind === 'update' ? NEUTRAL_CHIP : kindOf(change.kind).chip;
  return (
    <li>
      <button type="button" onClick={onOpen} className="flex w-full items-start gap-3 rounded-lg px-2 py-2.5 text-left transition-colors hover:bg-tint/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
        <span className={`mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${m.medallion}`}><Icon className="h-3.5 w-3.5" aria-hidden="true" /></span>
        <span className="min-w-0 flex-1">
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate text-sm font-semibold text-text-primary">{change.entity.canonicalName}</span>
            <span className={`inline-flex h-5 shrink-0 items-center whitespace-nowrap rounded-md px-2 text-[0.6875rem] font-semibold ${chip}`}>{change.label}</span>
          </span>
          <span className="mt-0.5 block text-[0.8125rem] leading-relaxed text-text-muted">{change.text}</span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1 pt-px">
          <span className={`whitespace-nowrap text-xs font-semibold ${SOURCE_TONE[change.source] || 'text-text-muted'}`}>{change.sourceLabel}</span>
          {change.pending
            ? <span className="whitespace-nowrap rounded-full bg-status-warning/12 px-2 py-0.5 text-[0.6875rem] font-semibold text-status-warning">To review</span>
            : <span className="whitespace-nowrap text-xs text-text-subtle">{ago(change.createdAt)}</span>}
        </span>
      </button>
    </li>
  );
}

function Row({ icon: Icon, tone, label, value, onClick }) {
  return (
    <button type="button" onClick={onClick} className="flex w-full items-center gap-2.5 rounded-control px-1 py-1 text-left text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
      <Icon className={`h-4 w-4 shrink-0 ${tone}`} aria-hidden="true" />
      <span className="flex-1">{label}</span>
      <span className="tabular-nums text-text-muted">{value}</span>
      <ChevronRight className="h-3.5 w-3.5 text-text-subtle" aria-hidden="true" />
    </button>
  );
}
