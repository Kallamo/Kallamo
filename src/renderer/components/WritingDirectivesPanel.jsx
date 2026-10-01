import React, { useEffect, useState, useCallback } from 'react';
import { Pin, Trash2, X } from 'lucide-react';
import Toggle from './ui/Toggle';
import Button from './ui/Button';
import IconButton from './ui/IconButton';

const Kbd = ({ children }) => <kbd className="rounded border border-border-default px-1.5 py-px font-sans text-xs text-text-subtle">{children}</kbd>;

// Workspace-scoped directives, injected verbatim into every invocation and immune to summarization.
export default function WritingDirectivesPanel({ workspaceId, workspaceTitle, electronAPI, onClose, onChange }) {
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
    await load();
    onChange?.();
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
    await load();
    onChange?.();
  };

  // Optimistic toggle: disabled directives stay listed but are skipped when the
  // prompt is assembled (loadDirectives filters enabled != 0).
  const toggleEnabled = async (d, next) => {
    setDirectives(prev => prev.map(x => x.id === d.id ? { ...x, enabled: next ? 1 : 0 } : x));
    await electronAPI.updateDirectiveEnabled(d.id, next);
    onChange?.();
  };

  const onCount = directives.filter(d => d.enabled !== 0).length;

  return (
    <aside aria-label="Directives" className="glass-rail flex w-[21rem] shrink-0 flex-col border-l border-border-subtle">
      <div className="flex h-[3.25rem] shrink-0 items-center gap-2 border-b border-border-subtle pl-4 pr-2">
        <h2 className="text-sm font-bold text-text-primary">Directives</h2>
        {workspaceTitle && <span className="min-w-0 truncate text-xs text-text-subtle">in {workspaceTitle}</span>}
        <span className="flex-1" />
        <IconButton icon={X} label="Close directives" size="sm" tooltipSide="left" onClick={onClose} />
      </div>

      <div className="custom-scrollbar flex min-h-0 flex-1 flex-col gap-2.5 overflow-y-auto px-3 py-3.5 [&>*]:shrink-0">
        {directives.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-2.5 px-3 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-card bg-white/5 text-text-subtle"><Pin className="h-5 w-5" /></span>
            <p className="text-sm font-semibold text-text-secondary">No directives yet</p>
            <p className="text-xs leading-relaxed text-text-subtle">Rules the AI always follows here, like “Keep a formal, third-person tone” or “British spelling”.</p>
          </div>
        ) : (
          <>
            <p className="px-0.5 text-xs leading-relaxed text-text-subtle">Sent with every AI request in this workspace. Summaries never shorten them.</p>
            <h3 className="px-0.5 pt-0.5 text-xs font-semibold uppercase tracking-[0.08em] text-text-subtle">On · {onCount} of {directives.length}</h3>
            {directives.map(d => (editingId === d.id ? (
              <div key={d.id} className="flex flex-col gap-2 rounded-card border border-accent/35 bg-surface-panel/80 p-2.5">
                <label>
                  <span className="sr-only">Edit directive</span>
                  <textarea
                    autoFocus
                    value={editValue}
                    onChange={(e) => setEditValue(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Escape') setEditingId(null); if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) commitEdit(d.id); }}
                    rows={3}
                    className="w-full resize-none rounded-control border border-border-default bg-surface-input px-2.5 py-2 text-sm leading-relaxed text-text-primary focus:border-accent/70 focus:outline-none"
                  />
                </label>
                <div className="flex items-center gap-1.5">
                  <Kbd>Ctrl Enter</Kbd>
                  <span className="flex-1" />
                  <Button variant="subtle" size="sm" onClick={() => setEditingId(null)}>Cancel</Button>
                  <Button size="sm" onClick={() => commitEdit(d.id)}>Save</Button>
                </div>
              </div>
            ) : (
              <div key={d.id} className={`group flex items-start gap-2 rounded-card border border-border-subtle py-2.5 pl-3 pr-2 ${d.enabled === 0 ? 'bg-surface-panel/35' : 'bg-surface-panel/75'}`}>
                <button
                  type="button"
                  onClick={() => { setEditingId(d.id); setEditValue(d.text); }}
                  className={`min-w-0 flex-1 whitespace-pre-wrap break-words text-left text-sm leading-relaxed focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${d.enabled === 0 ? 'text-text-subtle' : 'text-text-secondary hover:text-text-primary'}`}
                >
                  {d.text}
                </button>
                <IconButton icon={Trash2} label="Delete directive" size="sm" tone="danger" className="-my-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100" onClick={() => remove(d.id)} />
                <span className="pt-0.5"><Toggle checked={d.enabled !== 0} onChange={(next) => toggleEnabled(d, next)} /></span>
              </div>
            )))}
            <p className="px-0.5 text-xs leading-relaxed text-text-subtle">Click a directive to edit it. Turned off, it stays here but is not sent.</p>
          </>
        )}
      </div>

      <div className="flex flex-col gap-2 border-t border-border-subtle p-3">
        <label>
          <span className="sr-only">New directive</span>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); add(); } }}
            rows={2}
            placeholder="Add a directive"
            className="w-full resize-none rounded-control border border-border-default bg-surface-input px-2.5 py-2 text-sm text-text-primary placeholder:text-text-subtle focus:border-accent/70 focus:outline-none"
          />
        </label>
        <div className="flex items-center gap-2">
          <Kbd>Ctrl Enter</Kbd>
          <span className="flex-1" />
          <Button size="sm" variant={draft.trim() ? 'primary' : 'ghost'} disabled={!draft.trim()} onClick={add}>Add directive</Button>
        </div>
      </div>
    </aside>
  );
}
