import React, { useEffect, useRef, useState, useCallback } from 'react';
import { X, ChevronUp, ChevronDown, CaseSensitive, Replace, ReplaceAll } from 'lucide-react';
import { searchKey, collectSearchMatches } from './writingExtensions';

// Find & Replace overlay for one chapter. The ProseMirror SearchHighlight plugin
// only paints; this panel owns the match list, the current index, and the edits.
// Replace is disabled while the chapter is locked (a suggestion in flight/under
// review), so it can't desync the positions a pending suggestion is anchored to.
export default function WritingFindReplace({ editor, locked, onClose }) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [matches, setMatches] = useState([]);
  const [current, setCurrent] = useState(0);
  const findRef = useRef(null);

  useEffect(() => { findRef.current?.focus(); findRef.current?.select(); }, []);

  const paint = useCallback((list, idx) => {
    if (!editor) return;
    editor.view.dispatch(editor.state.tr.setMeta(searchKey, { matches: list, current: idx }));
  }, [editor]);

  // Move the editor's selection/viewport to a match without stealing DOM focus
  // from the find input (no .focus() in the chain).
  const scrollTo = useCallback((match) => {
    if (!editor || !match) return;
    editor.chain().setTextSelection({ from: match.from, to: match.to }).scrollIntoView().run();
  }, [editor]);

  // Recompute against the live doc; keep the current index near where it was so a
  // replace doesn't snap the writer back to the top.
  const refresh = useCallback((keepIndex = 0) => {
    if (!editor) return [];
    const list = collectSearchMatches(editor.state.doc, query, caseSensitive);
    const idx = list.length ? Math.min(keepIndex, list.length - 1) : 0;
    setMatches(list);
    setCurrent(idx);
    paint(list, idx);
    if (list.length) scrollTo(list[idx]);
    return list;
  }, [editor, query, caseSensitive, paint, scrollTo]);

  useEffect(() => { refresh(0); }, [query, caseSensitive, refresh]);

  // Clear highlights when the panel unmounts.
  useEffect(() => () => { editor?.view?.dispatch(editor.state.tr.setMeta(searchKey, null)); }, [editor]);

  const step = (dir) => {
    if (!matches.length) return;
    const idx = (current + dir + matches.length) % matches.length;
    setCurrent(idx);
    paint(matches, idx);
    scrollTo(matches[idx]);
  };

  const replaceCurrent = () => {
    if (locked || !editor || !matches.length) return;
    const m = matches[current];
    // insertText is literal (unlike insertContentAt, which the markdown layer parses).
    editor.view.dispatch(editor.state.tr.insertText(replacement, m.from, m.to));
    refresh(current); // the next match slides into this index
  };

  const replaceAll = () => {
    if (locked || !editor || !matches.length) return;
    let tr = editor.state.tr;
    // Last → first so earlier offsets stay valid as lengths change.
    for (let i = matches.length - 1; i >= 0; i--) {
      tr = tr.insertText(replacement, matches[i].from, matches[i].to);
    }
    editor.view.dispatch(tr);
    refresh(0);
  };

  const onFindKey = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
    if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  };

  return (
    <div className="absolute top-2 right-4 z-30 w-80 bg-[#0a161d]/97 border border-gray-800 rounded-lg shadow-2xl p-2.5 flex flex-col gap-2">
      <div className="flex items-center gap-1.5">
        <input
          ref={findRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onFindKey}
          placeholder="Find"
          className="flex-1 min-w-0 bg-[#00080B] border border-gray-800 text-gray-200 text-xs rounded-md px-2 py-1.5 focus:outline-none focus:border-accent"
        />
        <span className="text-[11px] tabular-nums text-gray-500 w-12 text-center shrink-0">
          {matches.length ? `${current + 1}/${matches.length}` : '0/0'}
        </span>
        <button title="Match case" onClick={() => setCaseSensitive(v => !v)}
          className={`p-1.5 rounded-md shrink-0 ${caseSensitive ? 'bg-accent text-[#011419]' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}>
          <CaseSensitive className="w-4 h-4" />
        </button>
        <button title="Previous (Shift+Enter)" onClick={() => step(-1)} disabled={!matches.length}
          className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-30 shrink-0"><ChevronUp className="w-4 h-4" /></button>
        <button title="Next (Enter)" onClick={() => step(1)} disabled={!matches.length}
          className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-30 shrink-0"><ChevronDown className="w-4 h-4" /></button>
        <button title="Close (Esc)" onClick={onClose}
          className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-white/5 shrink-0"><X className="w-4 h-4" /></button>
      </div>

      <div className="flex items-center gap-1.5">
        <input
          value={replacement}
          onChange={(e) => setReplacement(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); replaceCurrent(); } if (e.key === 'Escape') onClose(); }}
          placeholder={locked ? 'Replace (locked while AI is reviewing)' : 'Replace with'}
          disabled={locked}
          className="flex-1 min-w-0 bg-[#00080B] border border-gray-800 text-gray-200 text-xs rounded-md px-2 py-1.5 focus:outline-none focus:border-accent disabled:opacity-50"
        />
        <button title="Replace" onClick={replaceCurrent} disabled={locked || !matches.length}
          className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-30 shrink-0"><Replace className="w-4 h-4" /></button>
        <button title="Replace all" onClick={replaceAll} disabled={locked || !matches.length}
          className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-white/5 disabled:opacity-30 shrink-0"><ReplaceAll className="w-4 h-4" /></button>
      </div>
    </div>
  );
}
