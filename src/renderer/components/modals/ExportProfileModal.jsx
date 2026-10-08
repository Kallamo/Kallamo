import React, { useState } from 'react';
import { Download } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import ImportProgressModal, { PROGRESS_STAGES } from './ImportProgressModal';
import { ProfileAvatar } from './ProfileModal';
import { FileName, OptionRow, PackageColumns } from './ModalParts';

const listOf = value => {
  if (Array.isArray(value)) return value;
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
};

// The name the save dialog suggests, so the footer shows the file that will be written.
export const profileFileName = name => `${String(name || '').replace(/[^a-z0-9]/gi, '_').toLowerCase()}_profile.klp`;

export default function ExportProfileModal({ profile, onClose, onExport }) {
  const { apiProfiles } = useApp();
  const [exportKb, setExportKb] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');

  const handleConfirmExport = async () => {
    setExporting(true);
    setProgress(0);
    setStatusText('Starting export...');
    const unsub = window.electronAPI?.onExportProgress?.((data) => {
      setProgress(data.progress);
      setStatusText(data.status);
    });
    try {
      await onExport(exportKb);
      // A short pause so 100% is seen before the window closes.
      await new Promise(resolve => setTimeout(resolve, 600));
      onClose();
    } catch (e) {
      console.error('Export failed:', e);
    } finally {
      unsub?.();
      setExporting(false);
    }
  };

  const files = listOf(profile?.knowledgeFiles).length;
  const connection = apiProfiles?.find(ap => ap.id === profile?.apiProfileId)?.name;
  const avatar = <ProfileAvatar color={profile?.color} size={48} />;

  if (exporting) {
    return (
      <ImportProgressModal
        title="Exporting an AI profile"
        subtitle={profileFileName(profile?.name)}
        progress={progress}
        statusText={statusText}
        stages={PROGRESS_STAGES.export}
        subject={{ leading: avatar, name: profile?.name, detail: exportKb && files ? `With ${files} knowledge ${files === 1 ? 'file' : 'files'}` : 'Rules and settings' }}
      />
    );
  }

  const knowledge = { key: 'kb', label: files ? `Knowledge base, ${files} ${files === 1 ? 'file' : 'files'}` : 'Knowledge base' };
  const inside = [
    { key: 'rules', label: 'Rules, description and colour' },
    { key: 'params', label: 'Temperature and reply length' },
    { key: 'vars', label: 'Variables, written out with their current text' },
    ...(exportKb ? [knowledge] : []),
  ];
  const stays = [
    { key: 'connection', label: connection ? `The connection, ${connection}` : 'The connection' },
    { key: 'model', label: profile?.model ? <>The model, <span className="font-mono text-xs">{profile.model}</span></> : 'The model' },
    { key: 'where', label: 'Where it is turned on' },
    ...(exportKb ? [] : [knowledge]),
  ];

  return (
    <Modal onClose={onClose} size="lg" title="Export AI profile" icon={Download} iconClassName="text-text-muted" className="!max-w-[38rem]">
      <div className="flex items-center gap-3.5 px-5 pt-5">
        {avatar}
        <div className="min-w-0 flex-1">
          <p className="truncate text-[0.9375rem] font-semibold text-text-primary">{profile?.name}</p>
          {profile?.description && <p className="truncate text-xs text-text-subtle">{profile.description}</p>}
        </div>
      </div>
      <div className="space-y-3.5 p-5 pt-4">
        <PackageColumns inside={inside} stays={stays} />
        <OptionRow
          checked={exportKb}
          onChange={setExportKb}
          disabled={!files}
          title="Include the knowledge base"
          description={files ? 'Whoever imports it can search these files right away.' : 'This profile has no knowledge files yet.'}
        />
      </div>
      <div className="flex items-center gap-2 border-t border-border-subtle px-5 py-3.5">
        <FileName name={profileFileName(profile?.name)} />
        <Button variant="subtle" onClick={onClose}>Cancel</Button>
        <Button icon={Download} onClick={handleConfirmExport}>Export</Button>
      </div>
    </Modal>
  );
}
