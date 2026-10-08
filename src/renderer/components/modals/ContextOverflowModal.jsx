import React, { useState, useEffect } from 'react';
import { Save, Send } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import { MarkedAvatar, megabytes } from './ModalParts';

// A step wrote more than the next one may accept: trim it here or pass it on as it is.
export default function ContextOverflowModal() {
  const { overflowData, handleRespondToOverflow, writingProfiles } = useApp();
  const [editedText, setEditedText] = useState('');

  useEffect(() => {
    if (overflowData?.text) setEditedText(overflowData.text);
  }, [overflowData]);

  if (!overflowData) return null;

  const name = overflowData.profileName || 'The AI profile';
  const profile = writingProfiles?.find(p => p.name === overflowData.profileName);
  const bytes = overflowData.sizeBytes || new Blob([overflowData.text || '']).size;
  const tokens = Math.ceil((overflowData.text || '').length / 4);
  const editedTokens = Math.ceil(editedText.length / 4);
  const trimmed = editedText !== overflowData.text;

  return (
    <Modal
      onClose={() => {}}
      closeOnOverlay={false}
      closeOnEsc={false}
      showClose={false}
      size="wide"
      title="This reply is very long"
      subtitle={`${name} wrote it`}
      leading={<MarkedAvatar color={profile?.color} size={40} mark="warning" />}
      className="!max-w-[48rem]"
    >
      <div className="flex flex-col gap-3.5 p-5">
        <div className="flex items-center gap-3">
          <div className="h-2 flex-1 overflow-hidden rounded-full" style={{ background: 'var(--theme-surface-well)' }}>
            <div className="h-full rounded-full" style={{ width: `${Math.max(8, Math.min(100, (editedTokens / Math.max(tokens, 1)) * 100))}%`, background: 'linear-gradient(90deg, var(--theme-status-success) 0%, var(--theme-status-warning) 55%, var(--theme-status-danger) 100%)', backgroundSize: '100% 100%' }} />
          </div>
          <span className="text-xs tabular-nums text-text-secondary">{megabytes(bytes)} · ~{tokens.toLocaleString()} tokens{trimmed ? `, now ~${editedTokens.toLocaleString()}` : ''}</span>
        </div>
        <p className="text-sm leading-relaxed text-text-muted">The next step may not accept a reply this long. Trim what it does not need, or send it as it is.</p>
        <textarea
          value={editedText}
          onChange={(e) => setEditedText(e.target.value)}
          aria-label="Reply to send on"
          className="field-input custom-scrollbar h-80 resize-none select-text p-4 font-mono text-xs leading-relaxed text-text-secondary"
        />
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-3.5">
        <Button variant="subtle" icon={Send} onClick={() => handleRespondToOverflow('send_anyway', overflowData.text)}>Send as it is</Button>
        <Button icon={Save} disabled={!trimmed} onClick={() => handleRespondToOverflow('send_edited', editedText)}>Send edited</Button>
      </div>
    </Modal>
  );
}
