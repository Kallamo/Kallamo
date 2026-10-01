import React, { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronUp, ChevronDown, CaseSensitive, Search, Lock } from 'lucide-react';
import Tooltip from './ui/Tooltip';
import Button from './ui/Button';
import { searchKey, collectSearchMatches } from './writingExtensions';

// Replace is disabled while the chapter is locked, so it can't desync a pending suggestion's anchors.
export default function WritingFindReplace({ editor, locked, onClose }) {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [matches, setMatches] = useState([]);
  const [current, setCurrent] = useState(0);
  const findRef = useRef(null);
  const [panelStyle, setPanelStyle] = useState(null);

  useLayoutEffect(() => {
    const position = () => {
      const scroller = editor?.view?.dom?.closest('[data-writing-scroll-container]');
      const rect = scroller?.getBoundingClientRect();
      setPanelStyle({
        position: 'fixed',
        top: Math.max(48, (rect?.top || 40) + 8),
        right: Math.max(16, window.innerWidth - (rect?.right || window.innerWidth) + 16),
        zIndex: 80,
      });
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => {
      window.removeEventListener('resize', position);
      window.removeEventListener('scroll', position, true);
    };
  }, [editor]);

  useEffect(() => { findRef.current?.focus(); findRef.current?.select(); }, []);

  const paint = useCallback((list, idx) => {
    if (!editor) return;
    editor.view.dispatch(editor.state.tr.setMeta(searchKey, { matches: list, current: idx }));
  }, [editor]);

  // ProseMirror's scroll flag alone doesn't move the outer scroller while focus stays here.
  const scrollTo = useCallback((match) => {
    if (!editor || !match) return;
    editor.commands.setTextSelection({ from: match.from, to: match.to });

    requestAnimationFrame(() => {
      const scroller = editor.view.dom.closest('[data-writing-scroll-container]');
      if (!scroller) return;

      const start = editor.view.coordsAtPos(match.from);
      const end = editor.view.coordsAtPos(match.to);
      const scrollerRect = scroller.getBoundingClientRect();
      const matchCenter = (start.top + end.bottom) / 2;
      const viewportCenter = scrollerRect.top + scrollerRect.height / 2;

      scroller.scrollBy({ top: matchCenter - viewportCenter, behavior: 'smooth' });
    });
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

  if (!panelStyle) return null;

  const iconBtn = (active) => `inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md transition-colors disabled:opacity-30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${active ? 'bg-white/[0.13] text-text-primary' : 'text-text-muted hover:bg-white/5 hover:text-text-primary'}`;
  const field = 'flex h-8 min-w-0 flex-1 items-center gap-2 rounded-md border border-border-default bg-surface-input px-2.5 focus-within:border-accent/70';

  return createPortal(
    <div role="dialog" aria-label="Find and replace" style={panelStyle} className="flex w-[22.5rem] max-w-[calc(100vw-2rem)] flex-col gap-2 rounded-card border border-border-default bg-surface-panel/97 p-2.5 shadow-overlay">
      <div className="flex items-center gap-1">
        <label className={field}>
          <span className="sr-only">Find</span>
          <Search className="h-4 w-4 shrink-0 text-text-subtle" aria-hidden="true" />
          <input
            ref={findRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onFindKey}
            placeholder="Find"
            className="min-w-0 flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-subtle focus:outline-none"
          />
          {query && <span className="shrink-0 text-xs tabular-nums text-text-subtle">{matches.length ? `${current + 1} of ${matches.length}` : 'No matches'}</span>}
        </label>
        <Tooltip content="Match case"><button type="button" aria-label="Match case" aria-pressed={caseSensitive} onClick={() => setCaseSensitive(v => !v)} className={iconBtn(caseSensitive)}><CaseSensitive className="h-4 w-4" /></button></Tooltip>
        <Tooltip content="Previous (Shift Enter)"><button type="button" aria-label="Previous match" onClick={() => step(-1)} disabled={!matches.length} className={iconBtn(false)}><ChevronUp className="h-4 w-4" /></button></Tooltip>
        <Tooltip content="Next (Enter)"><button type="button" aria-label="Next match" onClick={() => step(1)} disabled={!matches.length} className={iconBtn(false)}><ChevronDown className="h-4 w-4" /></button></Tooltip>
        <Tooltip content="Close (Esc)"><button type="button" aria-label="Close" onClick={onClose} className={iconBtn(false)}><X className="h-4 w-4" /></button></Tooltip>
      </div>

      {locked ? (
        <p className="flex items-start gap-2 px-1 py-0.5 text-xs leading-relaxed text-text-muted">
          <Lock className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-subtle" aria-hidden="true" />
          Replacing is paused until you accept or reject the AI suggestion in this chapter.
        </p>
      ) : (
        <div className="flex items-center gap-1.5">
          <label className={field}>
            <span className="sr-only">Replace with</span>
            <input
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); replaceCurrent(); } if (e.key === 'Escape') onClose(); }}
              placeholder="Replace with"
              className="min-w-0 flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-subtle focus:outline-none"
            />
          </label>
          <Button variant="ghost" size="sm" onClick={replaceCurrent} disabled={!matches.length}>Replace</Button>
          <Button variant="ghost" size="sm" onClick={replaceAll} disabled={!matches.length}>Replace all</Button>
        </div>
      )}
    </div>,
    document.body,
  );
}
