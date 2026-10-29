import React, { createContext, forwardRef, useCallback, useContext, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { EditorContent, useEditor } from '@tiptap/react';
import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import StarterKit from '@tiptap/starter-kit';
import { MenuItem } from '../../components/ui/Menu';
import { SPOILER_PATTERN, hiddenFields, parseSpoilers } from '../../../shared/spoilers';

// Spoilers hide Worldbuild facts from the reader only; the AI always reads them. Nothing
// hidden is shown until the reader clicks it, in the sheet and while editing alike.

const SpoilerContext = createContext(null);

// Wrap one sheet in it, keyed by the entity, so what was revealed never carries over.
// onToggle(field, hidden) must update from the latest data, so two quick toggles both land.
export function SpoilerScope({ data, onToggle, children }) {
  const [revealed, setRevealed] = useState(() => new Set());
  const hidden = useMemo(() => new Set(hiddenFields(data)), [data]);
  const reveal = useCallback((field) => setRevealed(current => new Set(current).add(field)), []);
  const value = useMemo(() => ({
    isHidden: (field) => hidden.has(field),
    isCovered: (field) => hidden.has(field) && !revealed.has(field),
    reveal,
    // Hiding closes the field at once, even mid-edit; a click opens it again for this visit.
    setHidden: (field, on) => {
      if (on) setRevealed(current => { const next = new Set(current); next.delete(field); return next; });
      onToggle?.(field, on);
    },
  }), [hidden, revealed, reveal, onToggle]);
  return <SpoilerContext.Provider value={value}>{children}</SpoilerContext.Provider>;
}

export function useSpoiler(field) {
  const scope = useContext(SpoilerContext);
  if (!scope || !field) return { covered: false, hidden: false, reveal: () => {}, setHidden: () => {} };
  return {
    covered: scope.isCovered(field),
    hidden: scope.isHidden(field),
    reveal: () => scope.reveal(field),
    setHidden: (on) => scope.setHidden(field, on),
  };
}

// Stands in for a hidden field until it is clicked. `compact` fits a line of small text.
export function SpoilerCover({ field, compact = false, className = '', children }) {
  const spoiler = useSpoiler(field);
  if (!spoiler.covered) return children;
  if (compact) return (
    <button type="button" onClick={spoiler.reveal} aria-label="Hidden. Reveal"
      className="inline-flex h-5 items-center gap-1 rounded-sm border border-dashed border-border-default px-1.5 text-xs text-text-muted transition-colors hover:border-border-strong hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
      <EyeOff className="h-3 w-3" aria-hidden="true" />Hidden
    </button>
  );
  return (
    <button type="button" onClick={spoiler.reveal} aria-label="Hidden. Reveal"
      className={`${className} inline-flex min-h-8 items-center gap-1.5 rounded-control border border-dashed border-border-default bg-surface-hover/30 px-2.5 py-1 text-xs font-medium text-text-muted transition-colors hover:border-border-strong hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40`}>
      <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />
      Hidden
      <span className="text-text-subtle">Click to reveal</span>
    </button>
  );
}

// The eye beside a field while editing: hides the field from readers, never from the AI.
export function FieldEye({ field, size = 'md', className = '' }) {
  const spoiler = useSpoiler(field);
  if (!field) return null;
  const Icon = spoiler.hidden ? EyeOff : Eye;
  const label = spoiler.hidden ? 'Hidden from readers. Show it' : 'Hide from readers';
  const box = size === 'sm' ? 'h-5 w-5' : 'h-6 w-6';
  return (
    <button type="button" onClick={(event) => { event.stopPropagation(); spoiler.setHidden(!spoiler.hidden); }} aria-pressed={spoiler.hidden} aria-label={label} data-tooltip={label}
      className={`inline-flex ${box} shrink-0 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${spoiler.hidden ? 'text-accent hover:bg-accent/10' : 'text-text-subtle hover:bg-surface-hover/60 hover:text-text-primary'} ${className}`}>
      <Icon className={size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5'} aria-hidden="true" />
    </button>
  );
}

// One entry of a list (a relationship, an item carried, a membership): covered when hidden,
// with its eye at the end while the list is being edited.
export function SpoilerRow({ field, editing = false, children }) {
  return (
    <div className="flex items-start gap-1">
      <div className="min-w-0 flex-1"><SpoilerCover field={field}>{children}</SpoilerCover></div>
      {editing && <FieldEye field={field} className="mt-2" />}
    </div>
  );
}

// The same choice inside a row's actions menu, for lists that edit in place.
export function SpoilerMenuItem({ field, onDone }) {
  const spoiler = useSpoiler(field);
  if (!field) return null;
  return (
    <MenuItem icon={spoiler.hidden ? Eye : EyeOff} label={spoiler.hidden ? 'Show to readers' : 'Hide from readers'}
      onSelect={() => { spoiler.setHidden(!spoiler.hidden); onDone?.(); }} />
  );
}


// Covered like a Discord spoiler: a solid bar over the real words, so it keeps their size and
// wraps with the line. It stays open until the sheet is opened again.
function InlineSpoiler({ value }) {
  const [open, setOpen] = useState(false);
  const shape = 'rounded-sm px-0.5 [box-decoration-break:clone] [-webkit-box-decoration-break:clone]';
  if (open) return <span className={`${shape} bg-surface-hover/60`}>{value}</span>;
  const reveal = (event) => { event.stopPropagation(); setOpen(true); };
  return (
    <span role="button" tabIndex={0} aria-label="Hidden text. Reveal" onClick={reveal}
      onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); reveal(event); } }}
      className={`${shape} cursor-pointer select-none bg-text-subtle text-transparent transition-colors hover:bg-text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40`}>
      <span aria-hidden="true">{value}</span>
    </span>
  );
}

// Plain text with its ||spoilers|| closed.
export function SpoilerText({ text }) {
  return parseSpoilers(text).map((segment, index) => (
    segment.type === 'spoiler' ? <InlineSpoiler key={index} value={segment.value} /> : <React.Fragment key={index}>{segment.value}</React.Fragment>
  ));
}

// In the editor a spoiler is plain ||text||, so removing a marker makes it normal text at once.
// A click or a deletion opens it, and it stays open for the rest of the edit.
const spoilerEditKey = new PluginKey('spoilerEdit');

function spoilerRanges(doc) {
  const ranges = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    for (const match of node.textContent.matchAll(SPOILER_PATTERN)) {
      const from = pos + 1 + (match.index ?? 0);
      ranges.push({ from, to: from + match[0].length, text: match[0] });
    }
    return false;
  });
  return ranges;
}

const touches = (range, selection) => selection.from >= range.from && selection.to <= range.to;

const SpoilerEdit = Extension.create({
  name: 'spoilerEdit',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: spoilerEditKey,
      state: {
        init: () => new Set(),
        // Opens on a click, or when an edit lands in it, never because the caret starts there.
        apply: (tr, opened, _old, state) => {
          const clicked = tr.getMeta(spoilerEditKey);
          const inside = spoilerRanges(state.doc).filter(range => (clicked ? clicked >= range.from && clicked <= range.to : tr.docChanged && touches(range, state.selection)));
          if (!inside.some(range => !opened.has(range.text))) return opened;
          const next = new Set(opened);
          inside.forEach(range => next.add(range.text));
          return next;
        },
      },
      props: {
        handleClick: (view, pos) => {
          if (spoilerRanges(view.state.doc).some(range => pos >= range.from && pos <= range.to)) view.dispatch(view.state.tr.setMeta(spoilerEditKey, pos));
          return false;
        },
        decorations: (state) => {
          const opened = spoilerEditKey.getState(state);
          return DecorationSet.create(state.doc, spoilerRanges(state.doc).map(range => Decoration.inline(range.from, range.to,
            opened.has(range.text)
              ? { class: 'rounded-sm bg-text-subtle/25 [box-decoration-break:clone] [-webkit-box-decoration-break:clone]' }
              : { class: 'cursor-pointer rounded-sm bg-text-subtle text-transparent [box-decoration-break:clone] [-webkit-box-decoration-break:clone]', title: 'Hidden text. Click to reveal' })));
        },
      },
    })];
  },
});

// A spoiler span holds one line without markers, so it always writes back as ||text||.
const cleanSpanText = (text) => String(text || '').replace(/\|/g, '').replace(/\s+/g, ' ').trim();

function selectedSpanText(state) {
  const { from, to, $from, $to } = state.selection;
  if (from === to || !$from.sameParent($to)) return '';
  return cleanSpanText(state.doc.textBetween(from, to));
}

function hideSelection(editor) {
  const text = selectedSpanText(editor.state);
  if (!text) return false;
  const { from, to } = editor.state.selection;
  return editor.chain().focus().insertContentAt({ from, to }, `||${text}||`).run();
}

const SpoilerKeys = Extension.create({
  name: 'spoilerKeys',
  addKeyboardShortcuts() {
    return { 'Mod-Shift-h': () => hideSelection(this.editor) };
  },
});

const toDoc = (value) => ({
  type: 'doc',
  content: String(value || '').split('\n').map(line => (line ? { type: 'paragraph', content: [{ type: 'text', text: line }] } : { type: 'paragraph' })),
});

const fromDoc = (doc) => (doc.content || []).map(paragraph => (paragraph.content || []).map(node => (node.type === 'text' ? node.text : '')).join('')).join('\n');

// Edits plain text the way a textarea does, but a ||spoiler|| stays covered until the caret
// goes into it. onChange receives a textarea-shaped event.
export const SpoilerTextArea = forwardRef(function SpoilerTextArea({ value, onChange, rows = 5, placeholder = '', id, 'aria-label': ariaLabel }, ref) {
  const lastValue = useRef(String(value || ''));
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;
  const [canHide, setCanHide] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        blockquote: false, bold: false, bulletList: false, code: false, codeBlock: false, dropcursor: false, gapcursor: false,
        hardBreak: false, heading: false, horizontalRule: false, italic: false, listItem: false, listKeymap: false, link: false,
        orderedList: false, strike: false, underline: false, trailingNode: false,
      }),
      SpoilerEdit,
      SpoilerKeys,
    ],
    content: toDoc(value),
    editorProps: {
      attributes: {
        class: 'outline-none whitespace-pre-wrap break-words [&_p]:m-0 [&_p]:min-h-[1.625em]',
        role: 'textbox',
        'aria-multiline': 'true',
        ...(ariaLabel ? { 'aria-label': ariaLabel } : {}),
        ...(id ? { id } : {}),
      },
    },
    onUpdate: ({ editor: current }) => {
      const next = fromDoc(current.getJSON());
      if (next === lastValue.current) return;
      lastValue.current = next;
      onChangeRef.current?.({ target: { value: next } });
    },
    onSelectionUpdate: ({ editor: current }) => setCanHide(Boolean(selectedSpanText(current.state))),
  });

  useImperativeHandle(ref, () => ({ focus: () => editor?.commands.focus('end') }), [editor]);

  useEffect(() => {
    if (!editor) return;
    const next = String(value || '');
    if (next === lastValue.current) return;
    lastValue.current = next;
    editor.commands.setContent(toDoc(next), { emitUpdate: false });
  }, [editor, value]);

  const empty = !String(value || '').trim();
  return (
    <div>
      <div className="wb-input relative w-full rounded-control border border-border-default bg-surface-input/90 px-3 py-2 text-sm leading-relaxed text-text-primary backdrop-blur-md transition-colors focus-within:border-accent/70 focus-within:ring-2 focus-within:ring-accent/20"
        style={{ minHeight: `${rows * 1.625 + 1}rem` }} onClick={() => editor?.commands.focus()}>
        {empty && placeholder && <div className="pointer-events-none absolute left-3 top-2 text-sm text-text-subtle">{placeholder}</div>}
        <EditorContent editor={editor} />
      </div>
      <div className="mt-1.5 flex items-center gap-2">
        <button type="button" disabled={!canHide} onMouseDown={(event) => event.preventDefault()} onClick={() => editor && hideSelection(editor)}
          className="inline-flex items-center gap-1.5 rounded text-xs font-semibold text-text-muted transition-colors hover:text-text-primary disabled:cursor-default disabled:text-text-disabled focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          <EyeOff className="h-3.5 w-3.5" aria-hidden="true" />Hide selected text
        </button>
        <span className="caption">Or write ||like this||. Hidden text stays covered until clicked.</span>
      </div>
    </div>
  );
});
