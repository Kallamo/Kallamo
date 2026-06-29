import React, { useEffect, useState, useCallback } from 'react';
import { Pin, Plus, Trash2, Check, X, PanelRightClose } from 'lucide-react';
import Toggle from './ui/Toggle';

// Per-workspace pinned directives: always-on instructions injected verbatim into
// every AI invocation in this Writing Desk (writing-desk-invocation.js → loadDirectives),
// immune to summarization. Workspace-scoped, so it lives here (above the per-chapter
// editor) and stays available no matter which chapter is open.
export default function WritingDirectivesPanel({ workspaceId, electronAPI, onClose }) {
  const [directives, setDirectives] = useState([]);
  const [draft, setDraft] = useState('');
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');

  const load = useCallback(async () => {
    const res = await electronAPI.getDirectives(workspaceId);
    setDirectives(res?.directives || []);
  }, [electronAPI, workspaceId]);

  useEffect(() => { load(); }, [load]);

  const add = async () => {
    const text = draft.trim();
    if (!text) return;
    await electronAPI.addDirective(workspaceId, 'typed', text);
    setDraft('');
    load();
  };

  const commitEdit = async (id) => {
    const text = editValue.trim();
    setEditingId(null);
    if (!text) return;
    await electronAPI.updateDirective(id, text);
    load();
  };

  const remove = async (id) => {
    await electronAPI.deleteDirective(id);
    load();
  };

  // Optimistic toggle: disabled directives stay listed but are skipped when the
  // prompt is assembled (loadDirectives filters enabled != 0).
  const toggleEnabled = async (d, next) => {
    setDirectives(prev => prev.map(x => x.id === d.id ? { ...x, enabled: next ? 1 : 0 } : x));
    await electronAPI.updateDirectiveEnabled(d.id, next);
  };

  return (
    <div className="w-72 shrink-0 border-l border-gray-800/40 flex flex-col bg-[#011419]/25">
      <div className="flex items-center gap-2 px-3 py-3 border-b border-gray-800/80 bg-[#011419]/35">
        <Pin className="w-3.5 h-3.5 text-accent shrink-0" />
        <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mr-auto">Directives</span>
        <button title="Hide directives" onClick={onClose} className="p-1.5 text-gray-400 hover:text-white hover:bg-white/5 rounded-md">
          <PanelRightClose className="w-4 h-4" />
        </button>
      </div>

      <p className="text-[11px] text-gray-600 px-3 pt-3 leading-relaxed">
        Always-on instructions sent with every AI invocation in this project, immune to summarization.
      </p>

      <div className="flex-1 overflow-y-auto custom-scrollbar px-3 py-3 flex flex-col gap-2">
        {directives.length === 0 && (
          <p className="text-xs text-gray-600 leading-relaxed">No directives yet. Add one below — e.g. “Keep a formal, third-person tone” or “British spelling”.</p>
        )}
        {directives.map(d => (
          <div key={d.id} className="group rounded-lg border border-gray-800 bg-[#0a161d]/60 p-2 text-xs text-gray-300">
            {editingId === d.id ? (
              <div className="flex flex-col gap-1.5">
                <textarea
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Escape') setEditingId(null); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commitEdit(d.id); }}
                  rows={3}
                  className="bg-[#00080B] border border-gray-800 text-gray-200 rounded-md px-2 py-1.5 focus:outline-none focus:border-accent resize-none"
                />
                <div className="flex justify-end gap-1">
                  <button onClick={() => setEditingId(null)} className="p-1 text-gray-500 hover:text-white"><X className="w-3.5 h-3.5" /></button>
                  <button onClick={() => commitEdit(d.id)} className="p-1 text-accent hover:brightness-125"><Check className="w-3.5 h-3.5" /></button>
                </div>
              </div>
            ) : (
              <div className="flex items-start gap-1.5">
                <span
                  className={`flex-1 whitespace-pre-wrap break-words cursor-text ${d.enabled === 0 ? 'opacity-40 line-through' : ''}`}
                  onClick={() => { setEditingId(d.id); setEditValue(d.text); }}
                >{d.text}</span>
                <div className="flex items-center gap-1.5 shrink-0">
                  <Toggle checked={d.enabled !== 0} onChange={(next) => toggleEnabled(d, next)} />
                  <button title="Delete" onClick={() => remove(d.id)} className="p-0.5 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100">
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="border-t border-gray-800/80 p-3 flex flex-col gap-2">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); add(); } }}
          rows={2}
          placeholder="New directive…"
          className="bg-[#00080B] border border-gray-800 text-gray-200 text-xs rounded-md px-2 py-1.5 focus:outline-none focus:border-accent resize-none"
        />
        <button
          onClick={add}
          disabled={!draft.trim()}
          className="flex items-center justify-center gap-1.5 text-xs font-medium bg-accent text-[#011419] rounded-md py-1.5 hover:brightness-110 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Plus className="w-3.5 h-3.5" /> Add directive
        </button>
      </div>
    </div>
  );
}
