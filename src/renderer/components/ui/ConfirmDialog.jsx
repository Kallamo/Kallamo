import React, { useLayoutEffect, useRef, useState } from 'react';
import { AlertTriangle, Trash2, Info, HelpCircle } from 'lucide-react';
import Modal from './Modal';
import Button from './Button';

/**
 * For any choice the user must make; transient feedback uses showToast(). Order `actions` from
 * least to most destructive and always include a Cancel.
 */
const TONES = {
  danger: { Icon: Trash2, chip: 'bg-status-danger/10 text-status-danger' },
  warning: { Icon: AlertTriangle, chip: 'bg-status-warning/10 text-status-warning' },
  info: { Icon: Info, chip: 'bg-blue-500/10 text-blue-400' },
  question: { Icon: HelpCircle, chip: 'bg-accent/10 text-accent' },
};

export default function ConfirmDialog({
  tone = 'danger',
  icon = null,
  title = 'Confirm',
  message,
  actions = [],
  onClose,
}) {
  const toneConf = TONES[tone] || TONES.danger;
  const Icon = icon || toneConf.Icon;
  // Labels never wrap: a row that cannot hold them on one line stacks instead.
  const rowRef = useRef(null);
  const labels = actions.map(action => action.label).join('|');
  const [stackedFor, setStackedFor] = useState(null);
  const overflows = stackedFor === labels;
  useLayoutEffect(() => {
    if (actions.length >= 3 || overflows) return;
    const row = rowRef.current;
    if (row && row.scrollWidth > row.clientWidth) setStackedFor(labels);
  }, [labels, overflows, actions.length]);
  const stacked = actions.length >= 3 || overflows;

  return (
    <Modal onClose={onClose} size="sm" showClose={false}>
      <div className="p-6 flex flex-col space-y-4">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-control shrink-0 ${toneConf.chip}`}>
            <Icon className="w-5 h-5" />
          </div>
          <h3 className="text-base font-semibold text-text-primary">{title}</h3>
        </div>

        <div className="text-sm text-text-muted leading-relaxed whitespace-pre-wrap select-text">
          {message}
        </div>

        <div
          ref={rowRef}
          className={
            stacked
              ? 'flex flex-col gap-2 pt-1'
              : 'flex items-center justify-end gap-3 pt-1'
          }
        >
          {actions.map((action, i) => (
            <Button
              key={i}
              variant={action.variant || 'ghost'}
              loading={action.loading}
              icon={action.icon}
              autoFocus={action.autoFocus}
              fullWidth={stacked}
              onClick={() => action.onClick?.()}
            >
              {action.label}
            </Button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
