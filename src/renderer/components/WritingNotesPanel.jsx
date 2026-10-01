import React, { useCallback, useEffect, useState } from 'react';
import { Trash2, X, RotateCcw, CornerDownLeft, ChevronDown, ChevronRight, CircleCheck } from 'lucide-react';
import { AiGlyph, NoteGlyph } from './ui/glyphs';
import { parseMarkdown } from '../utils/markdown';
import { useApp } from '../context/AppContext';
import ConfirmDialog from './ui/ConfirmDialog';
import Button from './ui/Button';
import IconButton from './ui/IconButton';
import WritingDiagnostics from './WritingDiagnostics';

const Kbd = ({ children }) => <kbd className="rounded border border-border-default px-1.5 py-px font-sans text-xs text-text-subtle">{children}</kbd>;

// One-line, markdown-stripped preview for the minimized state.
const preview = (body) => {
  const line = (body || '').replace(/^#+\s*/gm, '').replace(/[*`_>#-]/g, '').split('\n').map(l => l.trim()).find(Boolean) || 'Empty note';
  return line.length > 90 ? `${line.slice(0, 90)}…` : line;
};

// Per-chapter review notes, with their excerpt and, for AI notes, provenance.
export default function WritingNotesPanel({ documentId, documentTitle, workspaceId, electronAPI, onClose, onJump, onChange, refreshKey, expandId }) {
  const { settings } = useApp();
  const tokenDebug = Boolean(settings?.advanced?.tokenDebug);
  const ragDebug = Boolean(settings?.advanced?.ragDebug);
  const [notes, setNotes] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [expanded, setExpanded] = useState({});
  const [showResolved, setShowResolved] = useState(false);
  const [confirmId, setConfirmId] = useState(null);

  useEffect(() => {
    electronAPI.getWritingProfiles?.().then(res => {
      const map = {};
      (res?.profiles || res || []).forEach(p => { if (p && p.id) map[p.id] = { name: p.name, color: p.color }; });
      setProfiles(map);
    });
  }, [electronAPI]);

  const load = useCallback(async () => {
    if (!documentId) { setNotes([]); return; }
    const res = await electronAPI.getDocumentNotes(documentId);
    setNotes(res?.notes || []);
  }, [electronAPI, documentId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  // Auto-expand the just-added AI note (and only it) when the panel opens for it.
  useEffect(() => {
    if (expandId) setExpanded({ [expandId]: true });
    else setExpanded({});
  }, [expandId, documentId]);

  const changed = async () => { await load(); onChange?.(); };
  const toggle = (id) => setExpanded(e => ({ ...e, [id]: !e[id] }));

  const add = async () => {
    const body = draft.trim();
    if (!body || !documentId) return;
    await electronAPI.createDocumentNote({ documentId, workspaceId, body, source: 'manual' });
    setDraft('');
    changed();
  };

  const commitEdit = async (id) => {
    const body = editValue.trim();
    setEditingId(null);
    if (!body) return;
    await electronAPI.updateDocumentNote(id, { body });
    load();
  };

  const setStatus = async (id, status) => {
    setNotes(prev => prev.map(n => n.id === id ? { ...n, status } : n));
    await electronAPI.updateDocumentNote(id, { status });
    changed();
  };

  const remove = async (id) => {
    setConfirmId(null);
    await electronAPI.deleteDocumentNote(id);
    changed();
  };

  const open = notes.filter(n => n.status !== 'resolved');
  const resolved = notes.filter(n => n.status === 'resolved');

  // Who wrote it on one line, what it was asked and what it cost on the next, so neither crowds the buttons.
  const source = (n) => {
    if (n.source !== 'ai') {
      return <span className="flex min-w-0 flex-1 items-center gap-1.5 text-xs font-semibold text-text-secondary"><NoteGlyph className="h-3.5 w-3.5 shrink-0 text-text-subtle" />Your note</span>;
    }
    const profile = profiles[n.profileId];
    return (
      <span className="flex min-w-0 flex-1 items-center gap-1.5">
        <AiGlyph className="h-3.5 w-3.5 shrink-0" style={{ color: profile?.color || undefined }} />
        <span className="min-w-0 truncate text-xs font-semibold text-text-primary">{profile?.name || 'AI'}</span>
      </span>
    );
  };

  const OpenNote = (n) => {
    const isOpen = !!expanded[n.id];
    const editing = editingId === n.id;
    if (!isOpen) {
      return (
        <div key={n.id} className="group flex min-h-10 items-center gap-1 rounded-card border border-border-subtle bg-surface-panel/70 py-1 pl-3 pr-1">
          <button type="button" onClick={() => toggle(n.id)} aria-expanded={false} className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm text-text-secondary hover:text-text-primary focus-visible:outline-none">
            {n.source === 'ai' && <AiGlyph className="h-3.5 w-3.5 shrink-0" style={{ color: profiles[n.profileId]?.color || undefined }} />}
            <span className="min-w-0 flex-1 truncate">{preview(n.body)}</span>
          </button>
          <IconButton icon={CircleCheck} label="Mark resolved" size="sm" tone="default" className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100" onClick={() => setStatus(n.id, 'resolved')} />
          <IconButton icon={ChevronDown} label="Expand" size="sm" onClick={() => toggle(n.id)} />
        </div>
      );
    }
    return (
      <div key={n.id} className={`group flex flex-col gap-2.5 rounded-card border bg-surface-panel/80 p-2.5 pl-3 ${editing ? 'border-accent/35' : 'border-border-subtle'}`}>
        <div className="flex min-h-7 items-center gap-1">
          {source(n)}
          <IconButton icon={Trash2} label="Delete note" size="sm" tone="danger" className="opacity-0 group-hover:opacity-100 group-focus-within:opacity-100" onClick={() => setConfirmId(n.id)} />
          <IconButton icon={CircleCheck} label="Mark resolved" size="sm" onClick={() => setStatus(n.id, 'resolved')} />
          <IconButton icon={ChevronDown} label="Minimize" size="sm" className="[&_svg]:rotate-180" onClick={() => toggle(n.id)} />
        </div>
        {n.source === 'ai' && (n.instruction || n.debug) && (
          <div className="-mt-1.5 flex min-w-0 items-center gap-2">
            <span className="block w-0 min-w-0 flex-1 truncate text-xs text-text-subtle">{n.instruction || ''}</span>
            <WritingDiagnostics debug={n.debug} tokenDebug={tokenDebug} ragDebug={ragDebug} compact />
          </div>
        )}

        {n.excerpt && (
          <button
            type="button"
            onClick={() => onJump?.(n.excerpt)}
            className="flex items-start gap-2 rounded-md bg-white/[0.04] px-2.5 py-2 text-left text-xs leading-relaxed text-text-muted transition-colors hover:bg-white/[0.07] hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <span className="line-clamp-2 flex-1 break-words italic">“{n.excerpt}”</span>
            <CornerDownLeft className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-label="Go to the passage" />
          </button>
        )}

        {editing ? (
          <div className="flex flex-col gap-2">
            <label>
              <span className="sr-only">Edit note</span>
              <textarea
                autoFocus
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Escape') setEditingId(null); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commitEdit(n.id); }}
                rows={5}
                className="w-full resize-none rounded-control border border-border-default bg-surface-input px-2.5 py-2 text-sm leading-relaxed text-text-primary focus:border-accent/70 focus:outline-none"
              />
            </label>
            <div className="flex items-center gap-1.5">
              <Kbd>Ctrl Enter</Kbd>
              <span className="flex-1" />
              <Button variant="subtle" size="sm" onClick={() => setEditingId(null)}>Cancel</Button>
              <Button size="sm" onClick={() => commitEdit(n.id)}>Save</Button>
            </div>
          </div>
        ) : (
          <div
            role="button"
            tabIndex={0}
            data-tooltip="Click to edit"
            className="wd-note-body cursor-text select-text break-words text-sm leading-relaxed text-text-secondary"
            onClick={() => { setEditingId(n.id); setEditValue(n.body); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { setEditingId(n.id); setEditValue(n.body); } }}
            dangerouslySetInnerHTML={{ __html: parseMarkdown(n.body) }}
          />
        )}
      </div>
    );
  };

  const ResolvedNote = (n) => (
    <div key={n.id} className="group flex min-h-10 items-center gap-1.5 rounded-card border border-border-subtle bg-surface-panel/40 py-1 pl-3 pr-1">
      <CircleCheck className="h-4 w-4 shrink-0 text-status-success" aria-hidden="true" />
      <span className="min-w-0 flex-1 truncate text-sm text-text-subtle">{preview(n.body)}</span>
      <IconButton icon={RotateCcw} label="Reopen note" size="sm" onClick={() => setStatus(n.id, 'open')} />
      <IconButton icon={Trash2} label="Delete note" size="sm" tone="danger" onClick={() => setConfirmId(n.id)} />
    </div>
  );

  return (
    <aside aria-label="Notes" className="glass-rail flex w-[21rem] shrink-0 flex-col border-l border-border-subtle">
      <div className="flex h-[3.25rem] shrink-0 items-center gap-2 border-b border-border-subtle pl-4 pr-2">
        <h2 className="text-sm font-bold text-text-primary">Notes</h2>
        {documentTitle && <span className="min-w-0 truncate text-xs text-text-subtle">on {documentTitle}</span>}
        <span className="flex-1" />
        <IconButton icon={X} label="Close notes" size="sm" tooltipSide="left" onClick={onClose} />
      </div>

      <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3 py-3.5 [&>*]:shrink-0">
        {notes.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2.5 px-3 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-card bg-white/5 text-text-subtle"><NoteGlyph className="h-5 w-5" /></span>
            <p className="text-sm font-semibold text-text-secondary">No notes on this chapter</p>
            <p className="text-xs leading-relaxed text-text-subtle">Write a reminder below. When you ask the AI to analyze a passage, its reading lands here too.</p>
          </div>
        ) : (
          <>
            <p className="px-0.5 text-xs leading-relaxed text-text-subtle">Your reminders for this chapter, and the AI analyses you keep.</p>
            {open.length > 0 && <h3 className="px-0.5 pt-0.5 text-xs font-semibold uppercase tracking-[0.08em] text-text-subtle">Open · {open.length}</h3>}
            {open.map(OpenNote)}
            {resolved.length > 0 && (
              <button type="button" aria-expanded={showResolved} onClick={() => setShowResolved(v => !v)} className="flex items-center gap-1.5 px-0.5 pt-1.5 text-text-subtle hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                <ChevronRight className={`h-3.5 w-3.5 transition-transform ${showResolved ? 'rotate-90' : ''}`} aria-hidden="true" />
                <span className="text-xs font-semibold uppercase tracking-[0.08em]">Resolved · {resolved.length}</span>
              </button>
            )}
            {showResolved && resolved.map(ResolvedNote)}
          </>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-border-subtle p-3">
        <label>
          <span className="sr-only">New note</span>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); add(); } }}
            rows={2}
            placeholder="Add a note for this chapter"
            className="w-full resize-none rounded-control border border-border-default bg-surface-input px-2.5 py-2 text-sm text-text-primary placeholder:text-text-subtle focus:border-accent/70 focus:outline-none"
          />
        </label>
        <div className="flex items-center gap-2">
          <Kbd>Ctrl Enter</Kbd>
          <span className="flex-1" />
          <Button size="sm" variant={draft.trim() ? 'primary' : 'ghost'} disabled={!draft.trim()} onClick={add}>Add note</Button>
        </div>
      </div>

      {confirmId && (
        <ConfirmDialog
          tone="danger"
          title="Delete note"
          message="This note will be permanently deleted. This cannot be undone."
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
