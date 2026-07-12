import { useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X } from 'lucide-react';
import Button from '../../components/ui/Button';

export default function EntityPickerButton({ label = 'Add', title, options, onPick, icon = Plus }) {
  const [isOpen, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const filteredOptions = options.filter((option) => option.canonicalName.toLowerCase().includes(query.toLowerCase()));

  return (
    <>
      <Button size="sm" variant="ghost" icon={icon} onClick={() => { setQuery(''); setOpen(true); }}>{label}</Button>
      {isOpen && createPortal(
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onMouseDown={() => setOpen(false)}>
          <div className="w-full max-w-sm rounded-xl border border-white/15 bg-[#08161d] shadow-2xl overflow-hidden" onMouseDown={(event) => event.stopPropagation()}>
            <div className="px-4 py-3 border-b border-white/10 flex items-center justify-between">
              <span className="text-sm font-bold text-white">{title || 'Choose'}</span>
              <button type="button" onClick={() => setOpen(false)} className="text-gray-400 hover:text-white cursor-pointer"><X className="w-4 h-4" /></button>
            </div>
            <div className="p-3">
              <input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search…"
                className="wb-input w-full bg-[#06121a]/75 border border-white/15 text-gray-100 text-sm rounded-lg px-3 py-2 mb-2 placeholder-gray-500 focus:outline-none focus:border-accent/70" />
              <div className="max-h-64 overflow-y-auto custom-scrollbar space-y-0.5">
                {filteredOptions.length === 0 && <p className="caption text-center py-4">Nothing to add. Create one first.</p>}
                {filteredOptions.map((option) => (
                  <button key={option.id} type="button" onClick={() => { onPick(option.id); setOpen(false); }}
                    className="w-full text-left px-3 py-2 rounded-lg text-sm text-gray-200 hover:bg-accent/15 hover:text-white cursor-pointer transition-colors">{option.canonicalName}</button>
                ))}
              </div>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </>
  );
}
