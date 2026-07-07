import React from 'react';
import { AlertTriangle, Trash2, Info, HelpCircle } from 'lucide-react';
import Modal from './Modal';
import Button from './Button';

/**
 * Shared confirmation / decision dialog for Kallamo.
 *
 * Use for any choice the user must make (confirm, destructive, multi-option).
 * For transient feedback use showToast() instead, not this.
 *
 * Props:
 *  - tone:    'danger' | 'warning' | 'info' | 'question'  (icon + accent)
 *  - icon:    optional lucide icon override
 *  - title:   heading text
 *  - message: string or node, one plain-language sentence about what happens
 *  - actions: array of { label, onClick, variant, loading, autoFocus }
 *             ordered least → most destructive. Always include a Cancel.
 *  - onClose: called on Esc / overlay / close
 *
 * Layout: 2 actions render inline (right-aligned); 3+ stack full-width.
 */
const TONES = {
  danger: { Icon: Trash2, chip: 'bg-red-500/10 text-red-500' },
  warning: { Icon: AlertTriangle, chip: 'bg-amber-500/10 text-amber-400' },
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
  const stacked = actions.length >= 3;

  return (
    <Modal onClose={onClose} size="sm" showClose={false}>
      <div className="p-6 flex flex-col space-y-4">
        <div className="flex items-center gap-3">
          <div className={`p-2 rounded-lg shrink-0 ${toneConf.chip}`}>
            <Icon className="w-5 h-5" />
          </div>
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">{title}</h3>
        </div>

        <div className="text-xs text-gray-400 leading-relaxed whitespace-pre-wrap select-text">
          {message}
        </div>

        <div
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
