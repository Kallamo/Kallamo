import React, { useCallback, useEffect, useState } from 'react';
import { Check, ChevronDown, CornerDownLeft, NotebookPen, Trash2, X, AlertTriangle } from 'lucide-react';
import { AiGlyph } from './ui/glyphs';
import { ReedPen } from '../logo';
import { parseMarkdown } from '../utils/markdown';
import { useApp } from '../context/AppContext';
import Button from './ui/Button';
import IconButton from './ui/IconButton';
import ConfirmDialog from './ui/ConfirmDialog';
import WritingDiagnostics from './WritingDiagnostics';

const preview = (body) => (body || '')
  .replace(/^#+\s*/gm, '').replace(/[*`_>#-]/g, '')
  .split('\n').map(l => l.trim()).filter(Boolean).join(' ');

function when(timestamp) {
  if (!timestamp) return '';
  const date = new Date(timestamp);
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);
  if (date.toDateString() === today.toDateString()) return `Today, ${time}`;
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday, ${time}`;
  return `${date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${time}`;
}

// Every Analyze result for the chapter, newest first. Notes stay the writer's own list;
// an analysis only joins them when the writer adds it.
export default function WritingAnalysesPanel({ documentId, documentTitle, workspaceId, electronAPI, refreshKey, expandId, onJump, onChange, onNotesChange, onClose }) {
  const { settings } = useApp();
  const tokenDebug = Boolean(settings?.advanced?.tokenDebug);
  const ragDebug = Boolean(settings?.advanced?.ragDebug);
  const [analyses, setAnalyses] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [expanded, setExpanded] = useState({});
  const [confirmId, setConfirmId] = useState(null);

  useEffect(() => {
    electronAPI.getWritingProfiles?.().then(res => {
      const map = {};
      (res?.profiles || res || []).forEach(p => { if (p && p.id) map[p.id] = { name: p.name, color: p.color }; });
      setProfiles(map);
    });
  }, [electronAPI]);

  const load = useCallback(async () => {
    if (!documentId) { setAnalyses([]); return []; }
    const res = await electronAPI.getDocumentAnalyses(documentId);
    const list = res?.analyses || [];
    setAnalyses(list);
    return list;
  }, [electronAPI, documentId]);

  // The newest reading opens by itself; older ones stay folded until asked for.
  useEffect(() => {
    let active = true;
    load().then(list => {
      if (!active) return;
      const open = expandId || list[0]?.id;
      setExpanded(open ? { [open]: true } : {});
    });
    return () => { active = false; };
  }, [load, refreshKey, expandId]);

  const toggle = (id) => setExpanded(e => ({ ...e, [id]: !e[id] }));

  const addAsNote = async (a) => {
    await electronAPI.createDocumentNote({
      documentId: a.documentId,
      workspaceId,
      body: a.body,
      excerpt: a.excerpt,
      source: 'ai',
      profileId: a.profileId,
      instruction: a.instruction,
      debug: a.debug || null,
    });
    await electronAPI.markDocumentAnalysisNoted(a.id);
    setAnalyses(prev => prev.map(x => (x.id === a.id ? { ...x, notedAt: Date.now() } : x)));
    onNotesChange?.();
  };

  const remove = async (id) => {
    setConfirmId(null);
    await electronAPI.deleteDocumentAnalysis(id);
    await load();
    onChange?.();
  };

  return (
    <aside aria-label="Analyses" className="glass-rail flex w-[26rem] shrink-0 flex-col border-l border-border-subtle">
      <div className="flex h-[3.25rem] shrink-0 items-center gap-2 border-b border-border-subtle pl-4 pr-2">
        <h2 className="text-sm font-bold text-text-primary">Analyses</h2>
        {documentTitle && <span className="min-w-0 truncate text-xs text-text-subtle">on {documentTitle}</span>}
        <span className="flex-1" />
        <IconButton icon={X} label="Close analyses" size="sm" tooltipSide="left" onClick={onClose} />
      </div>

      <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-3.5 py-4 [&>*]:shrink-0">
        {analyses.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2.5 px-4 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-card bg-tint/5 text-text-subtle"><AiGlyph className="h-5 w-5" /></span>
            <p className="text-sm font-semibold text-text-secondary">No analyses on this chapter</p>
            <p className="text-xs leading-relaxed text-text-subtle">Select a passage, choose Invoke AI, then Analyze. Each reading is kept here, and you can add the useful ones to your notes.</p>
          </div>
        ) : analyses.map(a => {
          const profile = profiles[a.profileId];
          const isOpen = !!expanded[a.id];
          return (
            <article key={a.id} className="group min-w-0 overflow-hidden rounded-card border border-border-subtle bg-surface-panel/80">
              <div className="flex items-start gap-2 py-2.5 pl-3.5 pr-1.5">
                <button type="button" aria-expanded={isOpen} onClick={() => toggle(a.id)} className="flex w-0 min-w-0 flex-1 flex-col gap-1 overflow-hidden text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                  <span className="flex min-w-0 items-center gap-2">
                    <ReedPen size={16} color={profile?.color || 'currentColor'} />
                    <span className="min-w-0 truncate text-sm font-semibold text-text-primary">{profile?.name || 'AI'}</span>
                  </span>
                  <span className="block w-full truncate text-xs text-text-subtle">
                    {when(a.createdAt)}{!isOpen && a.instruction ? ` · ${a.instruction}` : ''}
                  </span>
                </button>
                {a.notedAt
                  ? <IconButton icon={Check} label="Added to notes" size="sm" className="!text-status-success" disabled />
                  : <IconButton icon={NotebookPen} label="Add as note" size="sm" onClick={() => addAsNote(a)} />}
                <IconButton icon={Trash2} label="Delete analysis" size="sm" tone="danger" onClick={() => setConfirmId(a.id)} />
                <IconButton icon={ChevronDown} label={isOpen ? 'Fold' : 'Unfold'} size="sm" className={isOpen ? '[&_svg]:rotate-180' : ''} onClick={() => toggle(a.id)} />
              </div>

              {!isOpen ? (
                <button type="button" onClick={() => toggle(a.id)} className="block w-full px-3.5 pb-3 text-left focus-visible:outline-none">
                  <span className="line-clamp-2 text-sm leading-relaxed text-text-muted">{preview(a.body)}</span>
                </button>
              ) : (
                <div className="flex flex-col gap-3 px-3.5 pb-3.5">
                  {a.instruction && (
                    <p className="break-words text-xs leading-relaxed text-text-muted"><span className="font-semibold text-text-secondary">Asked: </span>{a.instruction}</p>
                  )}
                  {a.excerpt && (
                    <button
                      type="button"
                      onClick={() => onJump?.(a.excerpt)}
                      className="flex items-start gap-2 rounded-md bg-tint/[0.04] px-3 py-2 text-left text-xs leading-relaxed text-text-muted transition-colors hover:bg-tint/[0.07] hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                    >
                      <span className="line-clamp-3 flex-1 break-words italic">“{a.excerpt}”</span>
                      <CornerDownLeft className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-label="Go to the passage" />
                    </button>
                  )}
                  {a.status === 'flagged' && (
                    <p className="flex items-start gap-2 text-xs leading-relaxed text-status-warning">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                      This reading reached the output limit and may be incomplete.
                    </p>
                  )}
                  <div className="wd-note-body select-text break-words text-sm leading-relaxed text-text-secondary" dangerouslySetInnerHTML={{ __html: parseMarkdown(a.body) }} />
                  <div className="flex items-center gap-2 border-t border-border-subtle pt-3">
                    {a.notedAt ? (
                      <span className="inline-flex h-8 items-center gap-1.5 text-xs font-semibold text-status-success"><Check className="h-3.5 w-3.5" aria-hidden="true" />Added to notes</span>
                    ) : (
                      <Button variant="ghost" size="sm" icon={NotebookPen} onClick={() => addAsNote(a)}>Add as note</Button>
                    )}
                    <span className="flex-1" />
                    <WritingDiagnostics debug={a.debug} tokenDebug={tokenDebug} ragDebug={ragDebug} />
                    <IconButton icon={Trash2} label="Delete analysis" size="sm" tone="danger" onClick={() => setConfirmId(a.id)} />
                  </div>
                </div>
              )}
            </article>
          );
        })}
      </div>

      {confirmId && (
        <ConfirmDialog
          tone="danger"
          title="Delete analysis"
          message="This analysis will be permanently deleted. A copy you added to your notes stays there."
          actions={[
            { label: 'Cancel', variant: 'ghost', onClick: () => setConfirmId(null) },
            { label: 'Delete', variant: 'danger', autoFocus: true, onClick: () => remove(confirmId) },
          ]}
          onClose={() => setConfirmId(null)}
        />
      )}
    </aside>
  );
}
