import React, { useCallback, useEffect, useState } from 'react';
import { StickyNote, Plus, Trash2, Check, X, PanelRightClose, RotateCcw, CornerDownLeft, Sparkles, ChevronDown, ChevronRight } from 'lucide-react';
import { parseMarkdown } from '../utils/markdown';
import ConfirmDialog from './ui/ConfirmDialog';

// Per-chapter review notes. A note is an editorial pending ("adjust the temporal weight
// here", "check coherence with Aldous") that outlives the moment. It carries the excerpt
// it was about (click to scroll back to it) and, when it came from an AI Analysis, the
// profile + instruction that produced it. Notes render minimized; a freshly added AI note
// (expandId) opens expanded once. Scoped to the open chapter → lives in the right rail.
export default function WritingNotesPanel({ documentId, workspaceId, electronAPI, onClose, onJump, refreshKey, expandId }) {
  const [notes, setNotes] = useState([]);
  const [profiles, setProfiles] = useState({});
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [expanded, setExpanded] = useState({});
  const [confirmId, setConfirmId] = useState(null);

  useEffect(() => {
    electronAPI.getWritingProfiles?.().then(res => {
      const map = {};
      (res?.profiles || res || []).forEach(p => { if (p && p.id) map[p.id] = p.name; });
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

  const toggle = (id) => setExpanded(e => ({ ...e, [id]: !e[id] }));

  const add = async () => {
    const body = draft.trim();
    if (!body || !documentId) return;
    await electronAPI.createDocumentNote({ documentId, workspaceId, body, source: 'manual' });
    setDraft('');
    load();
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
    load();
  };

  const remove = async (id) => {
    setConfirmId(null);
    await electronAPI.deleteDocumentNote(id);
    load();
  };

  // One-line, markdown-stripped preview for the minimized state.
  const preview = (body) => {
    const line = (body || '').replace(/^#+\s*/gm, '').replace(/[*`_>#-]/g, '').split('\n').map(l => l.trim()).find(Boolean) || 'Empty note';
    return line.length > 80 ? line.slice(0, 80) + '…' : line;
  };

  const open = notes.filter(n => n.status !== 'resolved');
  const resolved = notes.filter(n => n.status === 'resolved');

  const NoteCard = (n) => {
    const isOpen = !!expanded[n.id];
    return (
      <div key={n.id} className={`group rounded-lg border border-gray-800 bg-[#0a161d]/60 p-2 text-xs ${n.status === 'resolved' ? 'opacity-55' : ''}`}>
        <div className="flex items-start gap-1.5">
          <button onClick={() => toggle(n.id)} title={isOpen ? 'Minimize' : 'Expand'} className="mt-0.5 shrink-0 text-gray-600 hover:text-white">
            {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>

          <div className="flex-1 min-w-0">
            {!isOpen && (
              <button
                onClick={() => toggle(n.id)}
                className={`w-full text-left truncate text-gray-400 hover:text-gray-200 ${n.status === 'resolved' ? 'line-through' : ''}`}
              >
                {n.source === 'ai' && <Sparkles className="inline w-3 h-3 text-accent/70 mr-1 -mt-0.5" />}
                {preview(n.body)}
              </button>
            )}

            {isOpen && (
              <>
                {n.excerpt && (
                  <button
                    onClick={() => onJump?.(n.excerpt)}
                    title="Scroll back to this passage"
                    className="w-full text-left flex items-start gap-1 mb-1.5 pl-2 border-l-2 border-gray-700 text-gray-500 hover:text-accent hover:border-accent transition-colors"
                  >
                    <span className="flex-1 line-clamp-2 italic break-words">“{n.excerpt}”</span>
                    <CornerDownLeft className="w-3 h-3 shrink-0 mt-0.5 opacity-0 group-hover:opacity-100" />
                  </button>
                )}

                {editingId === n.id ? (
                  <div className="flex flex-col gap-1.5">
                    <textarea
                      autoFocus
                      value={editValue}
                      onChange={(e) => setEditValue(e.target.value)}
                      onKeyDown={(e) => { if (e.key === 'Escape') setEditingId(null); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commitEdit(n.id); }}
                      rows={3}
                      className="bg-[#00080B] border border-gray-800 text-gray-200 rounded-md px-2 py-1.5 focus:outline-none focus:border-accent resize-none"
                    />
                    <div className="flex justify-end gap-1">
                      <button onClick={() => setEditingId(null)} className="p-1 text-gray-500 hover:text-white"><X className="w-3.5 h-3.5" /></button>
                      <button onClick={() => commitEdit(n.id)} className="p-1 text-accent hover:brightness-125"><Check className="w-3.5 h-3.5" /></button>
                    </div>
                  </div>
                ) : (
                  <div
                    className="wd-note-body break-words cursor-text text-gray-300"
                    title="Click to edit"
                    onClick={() => { setEditingId(n.id); setEditValue(n.body); }}
                    dangerouslySetInnerHTML={{ __html: parseMarkdown(n.body) }}
                  />
                )}

                {n.source === 'ai' && (
                  <div className="flex items-center gap-1 text-[0.625rem] text-gray-600 mt-1.5 min-w-0">
                    <Sparkles className="w-3 h-3 text-accent/70 shrink-0" />
                    <span className="truncate">{profiles[n.profileId] || 'AI'}{n.instruction ? ` · ${n.instruction}` : ''}</span>
                  </div>
                )}
              </>
            )}
          </div>

          <div className="flex items-center gap-1 shrink-0">
            {n.status === 'resolved' ? (
              <button title="Reopen" onClick={() => setStatus(n.id, 'open')} className="p-0.5 text-gray-600 hover:text-white"><RotateCcw className="w-3.5 h-3.5" /></button>
            ) : (
              <button title="Mark resolved" onClick={() => setStatus(n.id, 'resolved')} className="p-0.5 text-gray-600 hover:text-green-400"><Check className="w-3.5 h-3.5" /></button>
            )}
            <button title="Delete" onClick={() => setConfirmId(n.id)} className="p-0.5 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100"><Trash2 className="w-3.5 h-3.5" /></button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="w-72 shrink-0 border-l border-gray-800/40 flex flex-col bg-[#011419]/25">
      <div className="flex items-center gap-2 px-3 py-3 border-b border-gray-800/80 bg-[#011419]/35">
        <StickyNote className="w-3.5 h-3.5 text-accent shrink-0" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mr-auto">Notes</span>
        <button title="Hide notes" onClick={onClose} className="p-1.5 text-gray-400 hover:text-white hover:bg-white/5 rounded-md">
          <PanelRightClose className="w-4 h-4" />
        </button>
      </div>

      <p className="text-[11px] text-gray-600 px-3 pt-3 leading-relaxed">
        Editorial notes for this chapter. Add your own, or an AI analysis lands here to keep as a pending.
      </p>

      <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-3 flex flex-col gap-2">
        {notes.length === 0 && (
          <p className="text-xs text-gray-600 leading-relaxed">No notes yet. Jot a reminder below, or run an AI analysis on a passage.</p>
        )}
        {open.map(NoteCard)}
        {resolved.length > 0 && (
          <div className="text-[0.625rem] font-bold uppercase tracking-wider text-gray-700 mt-1 mb-0.5">Resolved</div>
        )}
        {resolved.map(NoteCard)}
      </div>

      <div className="border-t border-gray-800/80 p-3 flex flex-col gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); add(); } }}
          rows={2}
          placeholder="New note for this chapter…"
          className="bg-[#00080B] border border-gray-800 text-gray-200 text-xs rounded-md px-2 py-1.5 focus:outline-none focus:border-accent resize-none"
        />
        <button
          onClick={add}
          disabled={!draft.trim()}
          className="flex items-center justify-center gap-1.5 text-xs font-medium bg-accent text-[#011419] rounded-md py-1.5 hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus className="w-3.5 h-3.5" /> Add note
        </button>
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
    </div>
  );
}
