import React from 'react';
import { Trash2 } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Checkbox from '../ui/Checkbox';
import { ToneTile } from './ModalParts';

// `subject` shows what is being deleted (its avatar or icon, name and where it is used) before the choice.
export default function DeleteModal({
  title,
  message,
  onConfirm,
  onClose,
  confirmText,
  subject = null,
  showCheckbox,
  checkboxLabel,
  checkboxValue,
  onCheckboxChange
}) {
  return (
    <Modal onClose={onClose} size="md">
      <div className="flex gap-4 px-5 pt-5">
        <ToneTile icon={Trash2} color="var(--theme-status-danger)" />
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-text-primary">{title || 'Delete this?'}</h2>
          <p className="mt-1 text-sm leading-relaxed text-text-muted">{message || 'This cannot be undone.'}</p>
        </div>
      </div>
      <div className="space-y-3.5 px-5 pb-5 pt-4">
        {subject && (
          <div className="flex items-center gap-3 rounded-control border px-3.5 py-3" style={{ background: 'var(--theme-surface-well)', borderColor: 'var(--theme-border-well)' }}>
            {subject.leading}
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-text-primary">{subject.name}</p>
              {subject.detail && <p className="truncate text-xs text-text-subtle">{subject.detail}</p>}
            </div>
          </div>
        )}
        {showCheckbox && <Checkbox checked={Boolean(checkboxValue)} onChange={value => onCheckboxChange?.(value)} label={checkboxLabel} />}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-3.5">
        <Button variant="subtle" onClick={onClose}>Cancel</Button>
        <Button variant="danger" icon={Trash2} onClick={() => onConfirm(checkboxValue)}>{confirmText || 'Delete'}</Button>
      </div>
    </Modal>
  );
}
