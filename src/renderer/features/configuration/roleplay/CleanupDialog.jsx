import { Sparkles } from 'lucide-react';
import Modal from '../../../components/ui/Modal';
import Button from '../../../components/ui/Button';

const TYPE_LABELS = { fact: 'Fact', knowledge: 'Knowledge', belief: 'Belief', memory: 'Memory' };
const REASON_LABELS = { duplicate: 'repeated', 'scene-state': 'passing scene detail', 'identifier-content': 'unreadable' };

/** What tidying would retire, one row per statement, before anything is applied. */
export default function CleanupDialog({ report, busy, onCancel, onApply }) {
  const reasons = [
    ['duplicate', report.duplicates],
    ['scene-state', report.sceneState],
    ['identifier-content', report.identifierContent]
  ].filter(([, count]) => count > 0);
  const groups = report.groups?.length
    ? report.groups
    : (report.samples || []).map(sample => ({ ...sample, count: 1 }));

  return (
    <Modal
      title="Tidy the record"
      icon={Sparkles}
      iconClassName="text-text-secondary"
      onClose={() => { if (!busy) onCancel(); }}
      size="lg"
    >
      <div className="flex flex-col gap-4 px-6 py-5">
        <p className="text-[0.8125rem] leading-relaxed text-text-secondary"><b className="font-semibold text-text-primary">{report.retired}</b> of {report.scanned} stored records repeat something already there or will not last.</p>
        <div className="flex flex-wrap gap-1.5">
          {reasons.map(([reason, count]) => (
            <span key={reason} className="inline-flex h-5.5 items-center rounded-md bg-tint/[0.06] px-2 text-xs font-medium text-text-secondary">{count} {REASON_LABELS[reason]}</span>
          ))}
        </div>
        <div className="max-h-60 divide-y divide-border-subtle overflow-y-auto rounded-card border border-border-subtle bg-surface-canvas/50 custom-scrollbar">
          {groups.map((group, index) => (
            <div key={index} className="flex items-center gap-3 px-3.5 py-2.5">
              <span className="w-[4.5rem] shrink-0 text-xs font-semibold text-text-muted">{TYPE_LABELS[group.recordType] || group.recordType}</span>
              <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-text-secondary">{group.summary}</span>
              {group.count > 1 && <span className="shrink-0 text-xs tabular-nums text-text-subtle">×{group.count}</span>}
            </div>
          ))}
        </div>
        <p className="text-xs leading-relaxed text-text-subtle">The first copy of each stays. Nothing is deleted: the repeats stop counting as current and remain in the history.</p>
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="ghost" disabled={busy} onClick={onCancel}>Cancel</Button>
          <Button variant="primary" loading={busy} onClick={onApply} autoFocus>Retire {report.retired} {report.retired === 1 ? 'record' : 'records'}</Button>
        </div>
      </div>
    </Modal>
  );
}
