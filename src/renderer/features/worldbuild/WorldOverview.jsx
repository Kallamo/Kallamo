import React, { useMemo } from 'react';
import { AlertTriangle, ChevronRight, Globe, History, Plus, ScanEye } from 'lucide-react';
import Button from '../../components/ui/Button';
import { AiGlyph } from '../../components/ui/glyphs';
import { TYPE_ORDER, entityMeta, meta } from './worldbuildConfig';
import { formatWorldDate } from './WorldDateInput';

const ago = (ms) => {
  if (!ms) return '';
  const days = Math.floor((Date.now() - ms) / 86400000);
  if (days <= 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days < 30) return `${days} days ago`;
  return new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(ms));
};

// What a world holds at a glance, with the next thing to review a click away.
export default function WorldOverview({ workspaceName, entities, typeMeta, calendar, storyDate, counts, onFilter, onReview, onOpen, onCreate }) {
  const confirmed = useMemo(() => entities.filter(entity => entity.status !== 'proposed'), [entities]);
  const recent = useMemo(() => [...confirmed].sort((a, b) => (b.lastModified || b.last_modified || 0) - (a.lastModified || a.last_modified || 0)).slice(0, 5), [confirmed]);
  const waiting = counts.proposed + counts.updates + counts.names;

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
              className="flex items-center gap-3 rounded-card border border-border-subtle bg-surface-panel-muted/60 p-3.5 text-left backdrop-blur-md transition-colors hover:border-border-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
              <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-control border ${t.medallion}`}><Icon className="h-4 w-4" aria-hidden="true" /></span>
              <span className="min-w-0">
                <span className="block text-xl font-bold tabular-nums text-text-primary">{total}</span>
                <span className="block truncate text-xs text-text-muted">{t.plural || t.label}</span>
              </span>
            </button>
          );
        })}
      </div>
      <div className="grid items-start gap-4 md:grid-cols-2">
        <section className="rounded-card border border-border-default bg-surface-panel-muted/60 backdrop-blur-md">
          <header className="flex min-h-11 items-center gap-2.5 border-b border-border-subtle px-4"><AiGlyph className="h-4 w-4 text-text-muted" /><h2 className="text-sm font-semibold text-text-primary">Waiting for review</h2></header>
          <div className="space-y-2 p-4 text-sm">
            {waiting === 0 && <p className="text-text-disabled">Nothing waiting. Suggestions from the AI land here.</p>}
            {counts.proposed > 0 && <Row icon={AiGlyph} tone="text-status-warning" label="New entities proposed" value={counts.proposed} onClick={() => onReview('proposed')} />}
            {counts.updates > 0 && <Row icon={ScanEye} tone="text-status-info" label="Sheets with suggested updates" value={counts.updates} onClick={() => onReview('updates')} />}
            {counts.names > 0 && <Row icon={AlertTriangle} tone="text-status-warning" label="Names to check" value={counts.names} onClick={() => onReview('names')} />}
          </div>
        </section>
        <section className="rounded-card border border-border-default bg-surface-panel-muted/60 backdrop-blur-md">
          <header className="flex min-h-11 items-center gap-2.5 border-b border-border-subtle px-4"><History className="h-4 w-4 text-text-muted" /><h2 className="text-sm font-semibold text-text-primary">Recently changed</h2></header>
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
        </section>
      </div>
    </div>
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
