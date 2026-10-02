import { formatSigned } from '../ConfigParts';

const SOURCE_LABELS = { ai: 'AI', manual: 'You', time: 'Time', level: 'Level reward' };
const PROGRESS_COLOR = 'var(--color-entity-event)';

function when(entry) {
  if (entry.turnNumber) return `Turn ${entry.turnNumber}`;
  const date = new Date(entry.createdAt);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? 'Today'
    : date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function sourceLabel(entry) {
  const base = SOURCE_LABELS[entry.source] || entry.source;
  if (entry.source !== 'ai') return base;
  if (entry.status === 'rejected') return 'AI · rejected';
  if (entry.status === 'pending') return 'AI · waiting';
  return base;
}

/** What changed one character's numbers, newest first: turn, amount, reason and source. */
export default function HistoryList({ entries, colors, emptyText = 'Nothing has changed yet.' }) {
  if (!entries.length) return <p className="rounded-card border border-dashed border-border-subtle px-4 py-4 text-center text-xs text-text-subtle">{emptyText}</p>;
  return (
    <div className="divide-y divide-border-subtle overflow-hidden rounded-card border border-border-subtle bg-surface-canvas/45">
      {entries.map(entry => {
        const color = entry.area === 'resource' ? colors.get(entry.refId) || 'var(--color-text-subtle)' : PROGRESS_COLOR;
        const manualSet = entry.source === 'manual' && entry.kind !== 'level';
        const what = entry.kind === 'level'
          ? `Level ${entry.nextValue}`
          : manualSet ? `${entry.label} set to ${entry.nextValue}` : null;
        const delta = entry.delta ?? entry.nextValue - entry.previousValue;
        const reason = entry.status === 'rejected' && entry.reason ? `Rejected: ${entry.reason}` : entry.reason || (manualSet ? 'Changed by hand' : '');
        const maximum = entry.maximumDelta ? `highest ${formatSigned(entry.maximumDelta)}` : '';
        return (
          <div key={`${entry.area}:${entry.id}`} className={`grid grid-cols-[4.5rem_minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 px-3.5 py-2.5 text-[0.8125rem] ${entry.status === 'rejected' ? 'opacity-70' : ''}`}>
            <span className="text-xs tabular-nums text-text-subtle">{when(entry)}</span>
            <span className="flex min-w-0 items-center gap-2 text-text-secondary">
              <span aria-hidden="true" className="h-2.5 w-2.5 shrink-0 rounded-[0.1875rem]" style={{ backgroundColor: color }} />
              {what
                ? <span className="truncate">{what}</span>
                : <span className="truncate">{entry.label} <b className={`font-semibold tabular-nums ${delta < 0 ? 'text-status-danger' : 'text-status-success'}`}>{delta ? formatSigned(delta) : ''}</b></span>}
            </span>
            <span className="truncate text-text-muted" data-tooltip={reason.length > 60 ? reason : undefined}>{[reason, maximum].filter(Boolean).join(', ')}</span>
            <span className="text-right text-xs text-text-subtle">{sourceLabel(entry)}</span>
          </div>
        );
      })}
    </div>
  );
}
