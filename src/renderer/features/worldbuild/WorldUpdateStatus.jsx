import React, { useState } from 'react';
import { AlertTriangle, Loader2, RefreshCw, X } from 'lucide-react';
import Button from '../../components/ui/Button';
import IconButton from '../../components/ui/IconButton';

const SHOWN_ERRORS = 3;

// The foot of the Worldbuild sidebar while Update entities runs or after it failed.
// The run never blocks the view: sheets stay open and editable, except the one being read.
export default function WorldUpdateStatus({
  running, progress, stopping, errors = [], summary = '', runTotal = 0, typeLabel = (type) => type,
  onStop, onRetry, onDismiss, onDismissAll, onOpenSettings, onOpenEntity,
}) {
  const [showAll, setShowAll] = useState(false);

  if (running) {
    const total = progress?.total || 0;
    const done = Math.min(progress?.done || 0, total);
    return (
      <div className="m-2.5 shrink-0 rounded-card border border-border-default bg-surface-panel/95 p-3 shadow-overlay backdrop-blur-xl" aria-live="polite">
        <div className="flex items-center gap-2.5">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin text-status-info" aria-hidden="true" />
          <p className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">{stopping ? 'Stopping after this one…' : 'Updating from the story'}</p>
          {total > 0 && <span className="shrink-0 text-xs tabular-nums text-text-subtle">{done} / {total}</span>}
        </div>
        <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-surface-hover/70" role="progressbar" aria-valuemin={0} aria-valuemax={total || 1} aria-valuenow={done} aria-label="Entities read">
          <div className="h-full rounded-full bg-status-info transition-[width] duration-300" style={{ width: total ? `${Math.round((done / total) * 100)}%` : '8%' }} />
        </div>
        <div className="mt-2 flex items-center gap-2">
          <p className="min-w-0 flex-1 truncate text-xs text-text-subtle">
            {progress?.name ? <>Reading passages for <span className="text-text-secondary">{progress.name}</span></> : 'Finding passages to read…'}
          </p>
          {!stopping && <Button size="sm" variant="subtle" onClick={onStop}>Stop</Button>}
        </div>
      </div>
    );
  }

  if (!errors.length) return null;
  const visible = showAll ? errors : errors.slice(0, SHOWN_ERRORS);
  const retryLabel = errors.length === 1 ? 'Retry' : errors.length === 2 ? 'Retry both' : `Retry all ${errors.length}`;
  const failedLabel = runTotal >= errors.length && runTotal > 0
    ? `${errors.length} of ${runTotal} could not be updated`
    : errors.length === 1 ? '1 could not be updated' : `${errors.length} could not be updated`;
  const readCount = runTotal > errors.length ? runTotal - errors.length : 0;
  // Every failure is shown whole, with what the AI said went wrong, so each can be fixed or retried on its own.
  return (
    <div className="m-2.5 shrink-0 rounded-card border border-status-danger/45 bg-surface-panel/95 shadow-overlay backdrop-blur-xl" aria-live="polite">
      <div className="rounded-card bg-status-danger/[0.07] p-3">
        <div className="flex items-center gap-2.5">
          <AlertTriangle className="h-4 w-4 shrink-0 text-status-danger" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-sm font-semibold text-text-primary">{failedLabel}</p>
          <IconButton icon={X} size="sm" label="Dismiss all update errors" onClick={onDismissAll} />
        </div>
        <p className="mt-0.5 text-xs leading-relaxed text-text-subtle">
          {readCount > 0 ? `The other ${readCount} were read. ` : ''}{errors.length === 1 ? 'This sheet was left as it was.' : 'These sheets were left as they were.'}
        </p>
        {summary && <p className="mt-1 text-xs text-text-subtle">{summary}</p>}
        <div className="mt-2.5 max-h-72 space-y-2 overflow-y-auto overscroll-contain custom-scrollbar">
          {visible.map(error => (
            <div key={error.id} className="rounded-control border border-status-danger/20 bg-status-danger/[0.06] px-2.5 py-2">
              <div className="flex items-center gap-1.5 text-xs">
                <button type="button" onClick={() => onOpenEntity(error.entityId)} className="min-w-0 truncate rounded font-semibold text-text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">{error.entityName}</button>
                <span className="shrink-0 text-text-subtle">· {typeLabel(error.entityType)}</span>
                <span className="flex-1" />
                <button type="button" onClick={() => onRetry([error.entityId])} className="shrink-0 rounded px-1 font-semibold text-status-danger hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">Retry</button>
                <button type="button" onClick={() => onDismiss(error.id)} className="shrink-0 rounded px-1 font-semibold text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">Dismiss</button>
              </div>
              <p className="mt-1 whitespace-pre-line break-words text-xs leading-relaxed text-text-secondary">{error.error}</p>
            </div>
          ))}
          {errors.length > SHOWN_ERRORS && (
            <button type="button" onClick={() => setShowAll(v => !v)} className="rounded text-xs font-semibold text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
              {showAll ? 'Show fewer' : `Show ${errors.length - SHOWN_ERRORS} more`}
            </button>
          )}
        </div>
        <div className="mt-3 flex items-center justify-end gap-1 whitespace-nowrap">
          <Button size="sm" variant="subtle" onClick={onOpenSettings}>System AI settings</Button>
          <Button size="sm" variant="ghost" icon={RefreshCw} className="!border-status-danger/45 !bg-status-danger/15 !text-text-primary hover:!bg-status-danger/25" onClick={() => onRetry(errors.map(error => error.entityId))}>{retryLabel}</Button>
        </div>
      </div>
    </div>
  );
}
