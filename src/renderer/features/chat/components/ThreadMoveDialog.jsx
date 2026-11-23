import { useEffect, useState } from 'react';
import { AlignLeft, Drama, History } from 'lucide-react';
import { progressLabel } from '../../../components/modals/SummarizeModal';
import ConfirmDialog from '../../../components/ui/ConfirmDialog';
import { WorkspaceGlyph } from '../../../components/ui/glyphs';

const NAMES = { chat: 'Chat', roleplay: 'Roleplay' };
const KEEP_LINE = (count, name) => `Keeping it leaves ${count === 1 ? 'the moved message' : `the ${count} moved messages`} unsummarized in the ${name}: ${count === 1 ? 'it is' : 'they are'} read whole there until you summarize again.`;
const REBUILD_LINE = 'Rebuilding writes a new summary for each side, and the old one goes once both are ready.';
const plural = (count, word) => `${count} ${word}${count === 1 ? '' : 's'}`;
const day = time => new Date(time).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });

// Where the moved messages land, by when they were written.
function positionLine(plan) {
  const name = NAMES[plan.target];
  if (plan.position === 'empty') return `The ${name} is empty, so they become its start.`;
  if (plan.position === 'start') return `They go before the first ${name} message.`;
  if (plan.position === 'end') return `They go after the last ${name} message.`;
  return `They go between ${name} messages from ${day(plan.before.createdAt)} and ${day(plan.after.createdAt)}.`;
}

function Line({ icon: Icon, iconClassName = 'text-text-muted', children }) {
  return (
    <span className="flex gap-2.5 text-xs leading-relaxed text-text-secondary">
      <Icon aria-hidden="true" className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${iconClassName}`} />
      <span>{children}</span>
    </span>
  );
}

/** Confirms a move between the Chat and the Roleplay with what it will do to summaries and the story. */
export default function ThreadMoveDialog({ chatId, plan, busy, onConfirm, onClose }) {
  const count = plan.moving.length;
  const toChat = plan.target === 'chat';
  const mixed = plan.mixedSummaries.length > 0;
  // A rebuild runs Summarize once per side, so it reports the same stages.
  const [rebuilding, setRebuilding] = useState(false);
  const [progress, setProgress] = useState(null);
  useEffect(() => {
    if (!busy) { setRebuilding(false); setProgress(null); return undefined; }
    return window.electronAPI?.onSummarizationProgress?.(payload => {
      if (payload?.chatId === chatId) setProgress(payload);
    });
  }, [busy, chatId]);
  const movingCovered = plan.mixedSummaries.reduce((total, summary) => total + (summary.moving || 0), 0);

  if (toChat && plan.takesBack > 0) {
    return (
      <ConfirmDialog
        tone="warning"
        icon={WorkspaceGlyph}
        title={plan.takesBack === 1 && plan.addedForStory <= 1 ? 'Move this turn to the Chat?' : `Move ${plural(plan.takesBack, 'turn')} to the Chat?`}
        message={(
          <div className="space-y-3">
            <p>This turn already shaped the story. Moving it takes back what it changed, the same as deleting the reply:</p>
            <ul className="list-disc space-y-1 pl-5 text-text-secondary">
              <li>Place and time it set</li>
              <li>What characters learned or remembered from it</li>
            </ul>
            <p>The messages themselves are kept.{plan.addedForStory > 0 ? ' Turns after this one move with it.' : ''}</p>
          </div>
        )}
        actions={[
          { label: 'Cancel', variant: 'ghost', onClick: onClose },
          { label: 'Move and take back', variant: 'danger', loading: busy, onClick: () => onConfirm({ rebuildMixed: false }), autoFocus: true }
        ]}
        onClose={onClose}
      />
    );
  }

  const name = NAMES[plan.target];
  const details = (
    <div className="space-y-3">
      <p>They leave the {NAMES[toChat ? 'roleplay' : 'chat']} and join the {name} in the order they were written. Nothing is deleted, and you can move them back.</p>
      <div className="flex flex-col gap-2">
        <Line icon={AlignLeft}>{positionLine(plan)}</Line>
        {plan.movedSummaries.map(summary => (
          <Line key={summary.id} icon={History} iconClassName="text-mode-history">The summary “{summary.title}” covers only these messages and moves with them.</Line>
        ))}
      </div>
      {mixed && (
        <p className="rounded-card border border-status-warning/30 bg-status-warning/[0.08] px-3 py-2.5 text-xs leading-relaxed text-status-warning">
          {plan.mixedSummaries.length === 1
            ? `The summary “${plan.mixedSummaries[0].title}” covers messages on both sides.`
            : `${plural(plan.mixedSummaries.length, 'summary')} cover messages on both sides.`}
          {' '}{KEEP_LINE(movingCovered, name)} {REBUILD_LINE}
        </p>
      )}
    </div>
  );

  return (
    <ConfirmDialog
      tone="question"
      icon={toChat ? WorkspaceGlyph : Drama}
      title={`Move ${plural(count, 'message')} to the ${name}?`}
      message={details}
      actions={mixed
        ? [
          { label: 'Cancel', variant: 'ghost', onClick: onClose },
          { label: 'Move, keep summary', variant: 'ghost', loading: busy && !rebuilding, onClick: () => onConfirm({ rebuildMixed: false }) },
          { label: busy && rebuilding ? progressLabel(progress) : 'Move and rebuild', variant: 'primary', loading: busy && rebuilding, onClick: () => { setRebuilding(true); onConfirm({ rebuildMixed: true }); }, autoFocus: true }
        ]
        : [
          { label: 'Cancel', variant: 'ghost', onClick: onClose },
          { label: `Move to ${name}`, variant: 'primary', loading: busy, onClick: () => onConfirm({ rebuildMixed: false }), autoFocus: true }
        ]}
      onClose={onClose}
    />
  );
}
