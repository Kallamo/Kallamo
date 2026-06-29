import React, { useState } from 'react';
import { Sparkles, ChevronDown, X } from 'lucide-react';
import Button from './ui/Button';

// The invocation modal: highlighted span + Profile dropdown (swap on the spot) +
// intermediate prompt (the per-invocation instruction). The result review happens
// inline in the document (green/red track-changes), not here.
export function InvokeModal({ selection, profiles, onSubmit, onClose }) {
  const [profileId, setProfileId] = useState(profiles[0]?.id || '');
  const [prompt, setPrompt] = useState('');
  const [open, setOpen] = useState(false);
  const selected = profiles.find(p => p.id === profileId);

  const canSubmit = profileId && profiles.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onMouseDown={onClose}>
      <div className="w-[34rem] max-w-[92vw] bg-[#0a161d] border border-gray-800 rounded-xl shadow-2xl p-5" onMouseDown={e => e.stopPropagation()}>
        <div className="flex items-center gap-2 mb-3">
          <Sparkles className="w-4 h-4 text-accent" />
          <h2 className="text-sm font-semibold text-white">Invoke AI on selection</h2>
          <button onClick={onClose} className="ml-auto p-1 text-gray-500 hover:text-white"><X className="w-4 h-4" /></button>
        </div>

        <div className="mb-4 max-h-28 overflow-y-auto custom-scrollbar text-sm text-gray-300 bg-[#011419] border border-gray-800 rounded-lg p-3 whitespace-pre-wrap">
          {selection}
        </div>

        {profiles.length === 0 ? (
          <p className="text-sm text-amber-400/90 mb-4">No writing profiles found. Create one first to invoke the AI.</p>
        ) : (
          <div className="relative mb-3">
            <label className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">Profile</label>
            <button onClick={() => setOpen(o => !o)} className="w-full flex items-center justify-between gap-2 bg-[#011419] border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-200 hover:border-gray-700">
              <span className="flex items-center gap-2 min-w-0">
                {selected?.color && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: selected.color }} />}
                <span className="truncate">{selected?.name || 'Select profile'}</span>
                {selected && <span className="text-[10px] text-gray-500 shrink-0">({selected.resultChannel || 'replacement'})</span>}
              </span>
              <ChevronDown className="w-4 h-4 text-gray-500 shrink-0" />
            </button>
            {open && (
              <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto custom-scrollbar bg-[#0a161d] border border-gray-800 rounded-lg shadow-xl py-1">
                {profiles.map(p => (
                  <button key={p.id} onClick={() => { setProfileId(p.id); setOpen(false); }} className="w-full flex items-center gap-2 px-3 py-1.5 text-sm text-gray-300 hover:bg-white/5 text-left">
                    {p.color && <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: p.color }} />}
                    <span className="truncate">{p.name}</span>
                    <span className="ml-auto text-[10px] text-gray-500">{p.resultChannel || 'replacement'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        <div className="mb-4">
          <label className="block text-[11px] uppercase tracking-wide text-gray-500 mb-1">Instruction (optional)</label>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            rows={3}
            placeholder="e.g. tighten this, add tension, foreshadow the betrayal…"
            className="w-full bg-[#011419] border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-200 focus:outline-none focus:border-accent resize-none"
          />
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!canSubmit} onClick={() => onSubmit(profileId, prompt)}>Invoke</Button>
        </div>
      </div>
    </div>
  );
}
