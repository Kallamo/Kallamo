import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, Download, Info } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Checkbox from '../ui/Checkbox';

const megabytes = (bytes) => bytes >= 1024 * 1024 ? `${(bytes / (1024 * 1024)).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`;

// Informs only; onConfirm opens the save dialog with the chosen options.
export default function ExportWorldbuildModal({ workspaceId, api, entityCount = 0, onClose, onConfirm }) {
  const [summary, setSummary] = useState(null);
  const [includeImages, setIncludeImages] = useState(true);
  useEffect(() => {
    let active = true;
    api?.worldbuildExportSummary?.(workspaceId).then(result => { if (active && result?.success) setSummary(result); }).catch(() => {});
    return () => { active = false; };
  }, [api, workspaceId]);
  const count = summary?.entities ?? entityCount;
  const images = summary?.images || 0;

  const Line = ({ icon: Icon, tone, children }) => (
    <li className="flex gap-2.5 text-sm leading-relaxed text-text-secondary"><Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`} aria-hidden="true" /><span>{children}</span></li>
  );

  return (
    <Modal onClose={onClose} size="lg" title="Export Worldbuild" icon={Download} iconClassName="text-text-muted">
      <div className="space-y-4 p-5">
        <p className="text-sm text-text-secondary">Saves {count} {count === 1 ? 'entity' : 'entities'} to a .klwb file that another workspace can import.</p>
        <ul className="space-y-2.5">
          <Line icon={Check} tone="text-status-success">Sheets, links, templates, the calendar and facts go in the file.</Line>
          {images > 0 && (
            <li className="flex items-center gap-3 rounded-control border border-border-subtle px-3 py-2.5">
              <span className="shrink-0 whitespace-nowrap"><Checkbox checked={includeImages} onChange={setIncludeImages} label="Include images" /></span>
              <span className="ml-auto text-right text-xs text-text-subtle">Portraits and scene backgrounds · {images} {images === 1 ? 'image' : 'images'}, {megabytes(summary.imageBytes)}</span>
            </li>
          )}
          <Line icon={Info} tone="text-text-muted">Links to Writing Desk chapters and suggestions still waiting for review stay behind.</Line>
          <Line icon={AlertTriangle} tone="text-status-warning">Anyone with the file can read everything in it. Share it only as you would share the story.</Line>
        </ul>
      </div>
      <div className="flex justify-end gap-2 border-t border-border-subtle px-5 py-3.5">
        <Button variant="subtle" onClick={onClose}>Cancel</Button>
        <Button icon={Download} onClick={() => onConfirm({ includeImages: images > 0 && includeImages })}>Export</Button>
      </div>
    </Modal>
  );
}
