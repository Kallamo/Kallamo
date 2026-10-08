import React from 'react';
import { Check, Loader2, Package } from 'lucide-react';
import Modal from '../ui/Modal';

// Each operation names its stages by the progress at which they end; the main process
// reports a percentage and a status line, and the status details the stage underway.
export const PROGRESS_STAGES = {
  profileImport: [{ label: 'Read the package', until: 20 }, { label: 'Knowledge base', until: 70 }, { label: 'Make it searchable', until: 95 }, { label: 'Save the profile', until: 100 }],
  workflowImport: [{ label: 'Read the package', until: 20 }, { label: 'AI profiles and their knowledge', until: 90 }, { label: 'Save the workflow', until: 100 }],
  kbImport: [{ label: 'Read the package', until: 20 }, { label: 'Files', until: 70 }, { label: 'Make it searchable', until: 95 }, { label: 'Finish', until: 100 }],
  export: [{ label: 'Gather everything', until: 85 }, { label: 'Write the file', until: 100 }],
};

const detailOf = status => String(status || '').replace(/\.{3}$|…$/, '').trim();

export default function ImportProgressModal({ progress = 0, statusText, title = 'Importing', subtitle = null, subject = null, stages = null, footnote = 'Keep Kallamo open until it finishes.' }) {
  const value = Math.max(0, Math.min(100, Math.round(progress || 0)));
  const currentIndex = stages ? stages.findIndex(stage => value < stage.until) : -1;
  return (
    <Modal onClose={() => {}} closeOnOverlay={false} closeOnEsc={false} showClose={false} size="md" title={title} subtitle={subtitle} icon={Package} iconClassName="text-accent">
      <div className="px-5 pb-5 pt-5" style={{ background: 'radial-gradient(30rem 10rem at 0% 0%, color-mix(in srgb, var(--app-accent) 7%, transparent), transparent 70%)' }}>
        <div className="flex items-center gap-3.5">
          {subject?.leading}
          <div className="min-w-0 flex-1">
            {subject ? (
              <>
                <p className="truncate text-[0.9375rem] font-semibold text-text-primary">{subject.name}</p>
                {subject.detail && <p className="truncate text-xs text-text-subtle">{subject.detail}</p>}
              </>
            ) : (
              <p className="truncate text-sm text-text-secondary">{detailOf(statusText) || 'Working'}</p>
            )}
          </div>
          <span className="text-2xl font-bold tabular-nums text-text-primary">{value}<span className="text-base text-text-muted">%</span></span>
        </div>
        <div role="progressbar" aria-valuenow={value} aria-valuemin={0} aria-valuemax={100} className="mt-4 h-2 overflow-hidden rounded-full" style={{ background: 'var(--theme-surface-well)' }}>
          <div className="h-full rounded-full bg-accent transition-[width] duration-300 ease-out" style={{ width: `${value}%`, boxShadow: '0 0 0.75rem color-mix(in srgb, var(--app-accent) 45%, transparent)' }} />
        </div>
        {stages && (
          <ul className="mt-4 space-y-2">
            {stages.map((stage, index) => {
              const state = currentIndex === -1 || index < currentIndex ? 'done' : index === currentIndex ? 'now' : 'next';
              return (
                <li key={stage.label} className={`flex items-center gap-2.5 text-[0.8125rem] ${state === 'done' ? 'text-text-secondary' : state === 'now' ? 'font-medium text-text-primary' : 'text-text-subtle'}`}>
                  {state === 'done' && <Check className="h-4 w-4 shrink-0 text-status-success" strokeWidth={2.5} aria-hidden="true" />}
                  {state === 'now' && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-accent" aria-hidden="true" />}
                  {state === 'next' && <span aria-hidden="true" className="inline-flex h-4 w-4 shrink-0 items-center justify-center"><span className="h-1.5 w-1.5 rounded-full bg-border-strong" /></span>}
                  <span className="min-w-0 flex-1 truncate">{stage.label}</span>
                  {state === 'now' && subject && detailOf(statusText) && <span className="max-w-[55%] truncate text-xs font-normal text-text-subtle">{detailOf(statusText)}</span>}
                </li>
              );
            })}
          </ul>
        )}
      </div>
      {footnote && <p className="caption border-t border-border-subtle px-5 py-3">{footnote}</p>}
    </Modal>
  );
}
