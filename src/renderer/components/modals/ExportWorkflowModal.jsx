import React, { useState } from 'react';
import { Download, Workflow } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import ImportProgressModal, { PROGRESS_STAGES } from './ImportProgressModal';
import { FileName, OptionRow, PackageColumns, StepChain, ToneTile } from './ModalParts';

const listOf = value => {
  if (Array.isArray(value)) return value;
  try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; }
};

export const workflowFileName = name => `${String(name || '').replace(/[^a-z0-9]/gi, '_').toLowerCase()}_workflow.klw`;

export default function ExportWorkflowModal({ workflow, onClose, onExport }) {
  const { writingProfiles } = useApp();
  const [exportKb, setExportKb] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [progress, setProgress] = useState(0);
  const [statusText, setStatusText] = useState('');

  const stepList = listOf(workflow?.steps);
  const steps = stepList.map(step => {
    const profile = writingProfiles.find(p => p.id === step.profileId);
    return { name: profile?.name || 'Missing profile', color: profile?.color };
  });
  const profiles = [...new Set(stepList.map(step => step.profileId))].map(id => writingProfiles.find(p => p.id === id)).filter(Boolean);
  const files = profiles.reduce((total, profile) => total + listOf(profile.knowledgeFiles).length, 0);

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

  if (exporting) {
    return (
      <ImportProgressModal
        title="Exporting a workflow"
        subtitle={workflowFileName(workflow?.name)}
        progress={progress}
        statusText={statusText}
        stages={PROGRESS_STAGES.export}
        subject={{ leading: <ToneTile icon={Workflow} color="var(--app-accent)" />, name: workflow?.name, detail: `${steps.length} ${steps.length === 1 ? 'step' : 'steps'}` }}
      />
    );
  }

  const knowledge = { key: 'kb', label: files ? `Their knowledge bases, ${files} ${files === 1 ? 'file' : 'files'}` : 'Their knowledge bases' };
  const inside = [
    { key: 'steps', label: `The ${steps.length} ${steps.length === 1 ? 'step' : 'steps'} and their order` },
    { key: 'profiles', label: `The ${profiles.length} AI ${profiles.length === 1 ? 'profile' : 'profiles'} they use` },
    ...(exportKb ? [knowledge] : []),
  ];
  const stays = [
    { key: 'connections', label: 'Connections and models' },
    { key: 'where', label: 'Where it is turned on' },
    ...(exportKb ? [] : [knowledge]),
  ];

  return (
    <Modal
      onClose={onClose}
      size="lg"
      title={workflow?.name}
      subtitle={`Export workflow · ${steps.length} ${steps.length === 1 ? 'step' : 'steps'}`}
      leading={<ToneTile icon={Workflow} color="var(--app-accent)" />}
      className="!max-w-[40rem]"
    >
      <div className="space-y-3 p-5">
        {steps.length > 0 && <StepChain steps={steps} />}
        <PackageColumns inside={inside} stays={stays} />
        <OptionRow
          checked={exportKb}
          onChange={setExportKb}
          disabled={!files}
          title="Include their knowledge bases"
          description={files ? `${files} ${files === 1 ? 'file' : 'files'} across ${profiles.length} ${profiles.length === 1 ? 'profile' : 'profiles'}.` : 'None of its profiles has knowledge files yet.'}
        />
      </div>
      <div className="flex items-center gap-2 border-t border-border-subtle px-5 py-3.5">
        <FileName name={workflowFileName(workflow?.name)} />
        <Button variant="subtle" onClick={onClose}>Cancel</Button>
        <Button icon={Download} onClick={handleConfirmExport}>Export</Button>
      </div>
    </Modal>
  );
}
