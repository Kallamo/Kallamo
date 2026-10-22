import React, { useEffect, useRef, useState, useReducer } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { getHTMLFromFragment } from '@tiptap/core';
import {
  Bold, Italic, Underline, Strikethrough, List, ListOrdered, Quote, ChevronDown, ChevronRight, Search, Check,
  Table as TableIcon, Rows3, Trash2, Combine, ArrowUpToLine, ArrowDownToLine, ArrowLeftToLine, ArrowRightToLine,
  AlignLeft, AlignCenter, AlignRight, AlignJustify, AlignVerticalSpaceAround, Plus, FileCog, Asterisk, Download,
  ExternalLink, Unlink, PanelLeftClose, PanelLeftOpen, Pin, Target, X, AlertTriangle, CircleAlert, ScrollText
} from 'lucide-react';
import {
  AiGlyph, SuggestionPendingGlyph, IndexingGlyph, IndexedGlyph, IndexOutdatedGlyph, IndexErrorGlyph, IndexNeverGlyph,
  WorldbuildGlyph, TextColorGlyph, NoteGlyph
} from './ui/glyphs';
import ColorPicker from './ui/ColorPicker';
import Button from './ui/Button';
import IconButton from './ui/IconButton';
import Tooltip from './ui/Tooltip';
import Popover from './ui/Popover';
import { Menu, MenuItem, MenuNote, MenuSeparator } from './ui/Menu';
import WritingPageModal from './WritingPageModal';
import ExportModal from './ExportModal';
import { InvokeModal, CHANNEL_LABELS } from './WritingInvocation';
import WritingFindReplace from './WritingFindReplace';
import WritingDiagnostics from './WritingDiagnostics';
import { useApp } from '../context/AppContext';
import { DecorationSet } from '@tiptap/pm/view';
import { meta as entityTypeMeta, TYPE_ORDER } from '../features/worldbuild/worldbuildConfig';
import { locationSizeLabel, locationSizeOf } from '../../shared/location-sizes';
import {
  getEditorExtensions, estimatePagesFromWords,
  suggestionKey, buildSuggestionDecorations, suggestionWordDelta,
  selectionHasTable, sliceToMarkdown, proposalToHtml,
} from './writingExtensions';

export const PAPER_THEMES = [
  { label: 'Light', color: '#ffffff' },
  { label: 'Sepia', color: '#f4ecd8' },
  { label: 'Gray', color: '#e8e8e8' },
  { label: 'Dark', color: '#222428' },
];

const TEXT_SWATCHES = [
  { label: 'Black', color: '#111111' }, { label: 'Slate', color: '#374151' }, { label: 'Grey', color: '#6b7280' },
  { label: 'Light grey', color: '#e5e7eb' }, { label: 'Red', color: '#ef4444' }, { label: 'Orange', color: '#f59e0b' },
  { label: 'Yellow', color: '#eab308' }, { label: 'Green', color: '#10b981' }, { label: 'Blue', color: '#3b82f6' },
  { label: 'Indigo', color: '#6366f1' }, { label: 'Violet', color: '#8b5cf6' }, { label: 'Pink', color: '#ec4899' },
];

const DEFAULT_FONT = 'Arial';

// The font picker is driven entirely by the user's installed system fonts
// (queryLocalFonts). Arial is the fallback when system fonts are unavailable.
const FONT_FALLBACK = [{ label: 'Arial', value: 'Arial' }];

const LINE_HEIGHTS = ['1', '1.15', '1.5', '1.6', '2', '2.5'];
// Presets shown to the writer in points; storage stays in px (the editor's CSS unit).
const FONT_SIZES = ['8', '9', '10', '11', '12', '14', '18', '24', '30', '36', '48', '60'];
const PARAGRAPH_SPACINGS = ['0', '3', '6', '9', '12', '18', '24'];
// Standardized heading sizes (px); kept in sync with the .writing-prose h1/h2/h3 CSS.
const HEADING_SIZES = { 1: 28, 2: 20, 3: 16 };

// px <-> pt at 96dpi (pt = px * 0.75); display in pt, keep storing px.
const PT_PER_PX = 0.75;
export const pxToPt = (v) => Math.round((parseFloat(v) || 0) * PT_PER_PX);
export const ptToPx = (v) => Math.round((parseFloat(v) || 0) / PT_PER_PX);

const RECENT_COLORS_KEY = 'wd-recent-colors';
function readRecentColors() {
  try { return JSON.parse(localStorage.getItem(RECENT_COLORS_KEY)) || []; } catch { return []; }
}
function useRecentColors() {
  const [colors, setColors] = useState(readRecentColors);
  const add = (hex) => setColors(prev => {
    const next = [hex, ...prev.filter(c => c.toLowerCase() !== hex.toLowerCase())].slice(0, 5);
    try { localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(next)); } catch { /* storage unavailable */ }
    return next;
  });
  return [colors, add];
}

// Cached so the multiple font pickers share a single queryLocalFonts call.
let systemFontsPromise = null;
function loadSystemFonts() {
  if (systemFontsPromise) return systemFontsPromise;
  systemFontsPromise = (async () => {
    try {
      if (typeof window.queryLocalFonts !== 'function') return [];
      const available = await window.queryLocalFonts();
      const families = [...new Set(available.map(f => f.family))].sort((a, b) => a.localeCompare(b));
      return families.map(f => ({ label: f, value: `"${f}"` }));
    } catch (e) {
      return []; // permission denied or unsupported
    }
  })();
  return systemFontsPromise;
}

function useFontOptions() {
  const [system, setSystem] = useState([]);
  useEffect(() => {
    let active = true;
    loadSystemFonts().then(f => { if (active) setSystem(f); });
    return () => { active = false; };
  }, []);
  return system.length ? system : FONT_FALLBACK;
}

// Page dimensions in CSS px at 96dpi.
export const PAGE_PRESETS = {
  A4: { pageWidth: 794, pageHeight: 1123 },
  Letter: { pageWidth: 816, pageHeight: 1056 },
};

export const DEFAULT_WRITING_DESK = {
  pageSize: 'A4',
  orientation: 'portrait',
  pageWidth: 794,
  pageHeight: 1123,
  marginTop: 96,
  marginRight: 96,
  marginBottom: 96,
  marginLeft: 96,
  defaultFont: DEFAULT_FONT,
  defaultFontSize: 14,
  lineHeight: 1.6,
  paragraphSpacing: 12,
  firstLineIndent: 0,
  sheetColor: '#ffffff',
};

// Each chapter owns its page setup. Build a complete config from the document row,
// falling back to the standard defaults for any column that's null/missing.
const PAGE_KEYS = [
  'pageSize', 'orientation', 'pageWidth', 'pageHeight',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'defaultFont', 'defaultFontSize', 'lineHeight', 'paragraphSpacing', 'firstLineIndent', 'sheetColor',
];
function pageConfigFromDoc(doc) {
  const cfg = { ...DEFAULT_WRITING_DESK };
  for (const k of PAGE_KEYS) {
    if (doc[k] !== undefined && doc[k] !== null) cfg[k] = doc[k];
  }
  return cfg;
}

export function isLightColor(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return true;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150;
}

// Re-render the toolbar on every selection change / transaction so its controls
// always reflect the formatting at the cursor.
function useToolbarTick(editor) {
  const [, force] = useReducer(x => x + 1, 0);
  useEffect(() => {
    if (!editor) return;
    // One update per frame: a synchronous force() can loop into "Maximum update depth".
    let raf = 0;
    const onChange = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => { raf = 0; force(); });
    };
    editor.on('selectionUpdate', onChange);
    editor.on('transaction', onChange);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      editor.off('selectionUpdate', onChange);
      editor.off('transaction', onChange);
    };
  }, [editor]);
}

// Formatting controls act on mousedown so the editor never blurs and the selection stays put.
function ToolbarButton({ active, onClick, label, danger = false, children }) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={active === undefined ? undefined : active}
        onMouseDown={(e) => { e.preventDefault(); onClick(); }}
        className={`inline-flex h-[1.875rem] w-[1.875rem] shrink-0 items-center justify-center rounded-md transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${active
          ? 'bg-tint/[0.13] text-text-primary'
          : danger ? 'text-status-danger hover:bg-status-danger/10' : 'text-text-muted hover:bg-tint/5 hover:text-text-primary'}`}
      >
        {children}
      </button>
    </Tooltip>
  );
}

function Divider() {
  return <span aria-hidden="true" className="mx-1 h-5 w-px shrink-0 bg-border-subtle" />;
}

const DROP = 'inline-flex h-[1.875rem] shrink-0 items-center gap-1.5 rounded-md border px-2 text-xs font-medium text-text-secondary transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';
const dropClass = (open) => `${DROP} ${open ? 'border-border-strong bg-tint/[0.08] text-text-primary' : 'border-border-subtle bg-tint/[0.03] hover:border-border-default hover:text-text-primary'}`;
const Caret = ({ open }) => <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 text-text-subtle transition-transform ${open ? 'rotate-180' : ''}`} />;

// A menu row that keeps the editor's selection: it acts on mousedown, never takes focus.
function ChoiceRow({ selected, onChoose, children, className = '', style }) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={selected}
      onMouseDown={(e) => { e.preventDefault(); onChoose(); }}
      style={style}
      className={`flex min-h-8 w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm text-text-primary transition-colors hover:bg-surface-hover ${selected ? 'bg-tint/[0.06]' : ''} ${className}`}
    >
      <span className="min-w-0 flex-1 truncate">{children}</span>
      {selected && <Check className="h-4 w-4 shrink-0" aria-hidden="true" />}
    </button>
  );
}

const TEXT_STYLES = [
  { key: 'paragraph', label: 'Normal text', style: { fontSize: '0.9375rem' } },
  { key: 1, label: 'Heading 1', style: { fontSize: '1.3rem', fontWeight: 700 } },
  { key: 2, label: 'Heading 2', style: { fontSize: '1.1rem', fontWeight: 700 } },
  { key: 3, label: 'Heading 3', style: { fontSize: '0.95rem', fontWeight: 700 } },
];

function TextStyleControl({ editor, baseFont }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const level = [1, 2, 3].find(l => editor.isActive('heading', { level: l }));
  const current = TEXT_STYLES.find(s => s.key === (level || 'paragraph'));
  const choose = (key) => {
    // Standardized heading (CSS-driven size + weight): clear any inline font size so the preset shows.
    if (key === 'paragraph') editor.chain().focus().setParagraph().run();
    else editor.chain().focus().unsetFontSize().setHeading({ level: key }).run();
    setOpen(false);
  };
  return (
    <div ref={ref} className="relative">
      <button type="button" aria-label="Text style" aria-haspopup="menu" aria-expanded={open} onMouseDown={(e) => { e.preventDefault(); setOpen(o => !o); }} className={`${dropClass(open)} w-[7.25rem]`}>
        <span className="min-w-0 flex-1 truncate text-left">{current.label}</span><Caret open={open} />
      </button>
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} matchAnchorWidth={false} scroll={false} className="w-56 !p-1.5">
        <div role="menu" aria-label="Text style" className="flex flex-col">
          {TEXT_STYLES.map(s => (
            <ChoiceRow key={s.key} selected={current.key === s.key} onChoose={() => choose(s.key)} style={{ ...s.style, fontFamily: baseFont || undefined }} className={s.key === 1 ? 'min-h-10' : ''}>
              {s.label}
            </ChoiceRow>
          ))}
        </div>
      </Popover>
    </div>
  );
}

function FontPicker({ editor, baseFont }) {
  const fontOptions = useFontOptions();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);
  const close = () => { setOpen(false); setQuery(''); };

  // No inline font on the selection falls back to the document's baseline font.
  const inline = editor.getAttributes('textStyle').fontFamily || '';
  const current = inline || baseFont || DEFAULT_FONT;
  const currentLabel = fontOptions.find(o => o.value === current)?.label
    || current.replace(/"/g, '').split(',')[0];

  const filtered = query
    ? fontOptions.filter(o => o.label.toLowerCase().includes(query.toLowerCase()))
    : fontOptions;

  const choose = (value) => {
    if (value) editor.chain().focus().setFontFamily(value).run();
    else editor.chain().focus().unsetFontFamily().run();
    close();
  };

  return (
    <div className="relative" ref={ref}>
      <button type="button" aria-label="Font" aria-haspopup="menu" aria-expanded={open} onMouseDown={(e) => { e.preventDefault(); setOpen(o => !o); }} className={`${dropClass(open)} w-[6.5rem]`}>
        <span className="min-w-0 flex-1 truncate text-left" style={{ fontFamily: current || undefined }}>{currentLabel}</span><Caret open={open} />
      </button>
      <Popover anchorRef={ref} open={open} onClose={close} matchAnchorWidth={false} scroll={false} className="w-60 !p-0 overflow-hidden">
        <label className="flex items-center gap-2 border-b border-border-subtle px-3 py-2.5 text-text-subtle">
          <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="sr-only">Search fonts</span>
          <input
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search fonts"
            className="w-full bg-transparent text-sm text-text-primary placeholder:text-text-subtle focus:outline-none"
          />
        </label>
        <div role="menu" aria-label="Fonts" className="custom-scrollbar flex max-h-72 flex-col overflow-y-auto p-1.5">
          {filtered.length === 0 && <p className="px-2.5 py-2 text-sm text-text-subtle">No matching fonts</p>}
          {filtered.map((f, i) => (
            <ChoiceRow key={`${f.label}-${i}`} selected={f.value === current} onChoose={() => choose(f.value)} style={{ fontFamily: f.value || undefined }}>
              {f.label}
            </ChoiceRow>
          ))}
        </div>
      </Popover>
    </div>
  );
}

function FontSizeControl({ editor, baseSize }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const close = () => { setOpen(false); setText(''); };
  const inline = editor.getAttributes('textStyle').fontSize;
  const headingLevel = editor.getAttributes('heading')?.level;
  const valuePx = inline ? parseInt(inline, 10) : (HEADING_SIZES[headingLevel] || baseSize || 14);
  const value = pxToPt(valuePx);
  // Setting an explicit size demotes a heading to a paragraph first; pt in, px stored.
  const apply = (pt) => {
    const sizePt = Math.max(6, Math.min(150, pt || 0));
    if (!sizePt) return;
    const chain = editor.chain().focus();
    if (editor.isActive('heading')) chain.setParagraph();
    chain.setFontSize(`${ptToPx(sizePt)}px`).run();
    close();
  };
  return (
    <div className="relative" ref={ref}>
      <button type="button" aria-label="Font size" aria-haspopup="menu" aria-expanded={open} onMouseDown={(e) => { e.preventDefault(); setOpen(o => { const n = !o; setText(n ? String(value) : ''); return n; }); }} className={dropClass(open)}>
        <span className="tabular-nums">{value}</span><span className="text-xs text-text-subtle">pt</span><Caret open={open} />
      </button>
      <Popover anchorRef={ref} open={open} onClose={close} matchAnchorWidth={false} scroll={false} className="w-24 !p-1.5">
        <label>
          <span className="sr-only">Font size in points</span>
          {/* Pre-filled + selected on focus, so typing replaces the current value cleanly. */}
          <input
            value={text}
            autoFocus
            onFocus={(e) => e.target.select()}
            inputMode="numeric"
            onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); apply(parseInt(text, 10)); } }}
            className="mb-1 h-8 w-full rounded-md border border-border-default bg-surface-input px-2 text-center text-sm text-text-primary focus:border-accent/70 focus:outline-none"
          />
        </label>
        <div role="menu" aria-label="Font sizes" className="custom-scrollbar flex max-h-56 flex-col overflow-y-auto">
          {FONT_SIZES.map(s => (
            <ChoiceRow key={s} selected={value === parseInt(s, 10)} onChoose={() => apply(parseInt(s, 10))} className="justify-center tabular-nums">{s}</ChoiceRow>
          ))}
        </div>
      </Popover>
    </div>
  );
}

function blockAttr(editor, key) {
  return editor.getAttributes('paragraph')[key] || editor.getAttributes('heading')[key] || null;
}

function Chip({ selected, onChoose, children }) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onMouseDown={(e) => { e.preventDefault(); onChoose(); }}
      className={`inline-flex h-7 min-w-[2.375rem] items-center justify-center rounded-md border px-2 text-xs tabular-nums transition-colors ${selected
        ? 'border-border-strong bg-tint/[0.13] font-semibold text-text-primary'
        : 'border-border-subtle text-text-secondary hover:border-border-default hover:text-text-primary'}`}
    >
      {children}
    </button>
  );
}

// Line height and the space after paragraphs, both block-level, in one control.
function SpacingControl({ editor, baseLineHeight, baseSpacing }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const lineHeight = parseFloat(blockAttr(editor, 'lineHeight') || baseLineHeight || 1.6);
  const spacingAttr = blockAttr(editor, 'paragraphSpacing');
  const spacing = pxToPt(spacingAttr ? parseInt(spacingAttr, 10) : (baseSpacing ?? 12));
  return (
    <div className="relative" ref={ref}>
      <button type="button" aria-label="Spacing" aria-haspopup="dialog" aria-expanded={open} onMouseDown={(e) => { e.preventDefault(); setOpen(o => !o); }} className={dropClass(open)}>
        <AlignVerticalSpaceAround className="h-4 w-4 text-text-subtle" aria-hidden="true" /><span className="tabular-nums">{lineHeight}</span><Caret open={open} />
      </button>
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} matchAnchorWidth={false} scroll={false} className="w-64 !p-3" role="dialog">
        <p className="mb-2 text-xs font-semibold text-text-secondary">Line spacing</p>
        <div role="radiogroup" aria-label="Line spacing" className="flex flex-wrap gap-1.5">
          {LINE_HEIGHTS.map(v => <Chip key={v} selected={lineHeight === parseFloat(v)} onChoose={() => editor.chain().focus().setLineHeight(v).run()}>{v}</Chip>)}
        </div>
        <div className="my-3 h-px bg-border-subtle" />
        <p className="mb-2 text-xs font-semibold text-text-secondary">Space after paragraphs</p>
        <div role="radiogroup" aria-label="Space after paragraphs" className="flex flex-wrap gap-1.5">
          {PARAGRAPH_SPACINGS.map(v => <Chip key={v} selected={spacing === parseInt(v, 10)} onChoose={() => editor.chain().focus().setParagraphSpacing(`${ptToPx(parseInt(v, 10))}px`).run()}>{v}</Chip>)}
        </div>
        <p className="mt-2.5 text-xs text-text-subtle">Points. Applies to the paragraph at the cursor.</p>
      </Popover>
    </div>
  );
}

const ALIGNMENTS = [
  { value: 'left', icon: AlignLeft, label: 'Left' },
  { value: 'center', icon: AlignCenter, label: 'Center' },
  { value: 'right', icon: AlignRight, label: 'Right' },
  { value: 'justify', icon: AlignJustify, label: 'Justify' },
];

function AlignControl({ editor }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const active = ALIGNMENTS.find(a => editor.isActive({ textAlign: a.value })) || ALIGNMENTS[0];
  return (
    <div className="relative" ref={ref}>
      <Tooltip content="Alignment">
        <button type="button" aria-label={`Alignment: ${active.label}`} aria-haspopup="menu" aria-expanded={open} onMouseDown={(e) => { e.preventDefault(); setOpen(o => !o); }} className={`${dropClass(open)} px-1.5`}>
          <active.icon className="h-4 w-4" aria-hidden="true" /><Caret open={open} />
        </button>
      </Tooltip>
      <Popover anchorRef={ref} open={open} onClose={() => setOpen(false)} matchAnchorWidth={false} scroll={false} className="w-44 !p-1.5">
        <div role="menu" aria-label="Alignment" className="flex flex-col">
          {ALIGNMENTS.map(a => (
            <ChoiceRow key={a.value} selected={active.value === a.value} onChoose={() => { editor.chain().focus().setTextAlign(a.value).run(); setOpen(false); }}>
              <span className="flex items-center gap-2.5"><a.icon className="h-4 w-4 text-text-muted" aria-hidden="true" />{a.label}</span>
            </ChoiceRow>
          ))}
        </div>
      </Popover>
    </div>
  );
}

function Swatch({ color, label, selected, onPick, size = 'h-6 w-6' }) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        aria-pressed={selected}
        onMouseDown={(e) => { e.preventDefault(); onPick(); }}
        className={`${size} rounded-full border border-tint/15 transition-transform hover:scale-110 ${selected ? 'ring-2 ring-text-primary ring-offset-2 ring-offset-surface-panel' : ''}`}
        style={{ backgroundColor: color }}
      />
    </Tooltip>
  );
}

function ColorPopover({ editor }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [draft, setDraft] = useState('#cccccc');
  const [recent, addRecent] = useRecentColors();
  const close = () => { setOpen(false); setShowPicker(false); };
  const current = (editor.getAttributes('textStyle').color || '').toLowerCase();
  const apply = (c) => editor.chain().focus().setColor(c).run();

  const openPicker = () => { setDraft(current || '#cccccc'); setShowPicker(true); };
  // Only on apply does the picked color land in the recent row.
  const applyPicker = () => { addRecent(draft); apply(draft); setShowPicker(false); };

  return (
    <div className="relative" ref={ref}>
      <ToolbarButton label="Text colour" active={open} onClick={() => setOpen(o => !o)}>
        <TextColorGlyph className="h-4 w-4" color={current || undefined} />
      </ToolbarButton>
      <Popover anchorRef={ref} open={open} onClose={close} matchAnchorWidth={false} scroll={false} className="w-60 !p-3" role="dialog">
        <div className="grid grid-cols-6 justify-items-center gap-2">
          {TEXT_SWATCHES.map(s => <Swatch key={s.color} color={s.color} label={s.label} selected={current === s.color} onPick={() => apply(s.color)} />)}
        </div>
        {recent.length > 0 && (
          <div className="mt-3 flex items-center gap-2">
            <span className="text-xs font-semibold text-text-secondary">Recent</span>
            <span className="flex-1" />
            {recent.map(c => <Swatch key={c} color={c} label={c.toUpperCase()} selected={current === c.toLowerCase()} onPick={() => apply(c)} size="h-5 w-5" />)}
          </div>
        )}
        <div className="mt-3 flex items-center border-t border-border-subtle pt-2.5">
          <span className="text-xs font-semibold text-text-secondary">Custom</span>
          <span className="flex-1" />
          {!showPicker && (
            <button type="button" onMouseDown={(e) => { e.preventDefault(); openPicker(); }} className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-semibold text-text-secondary hover:bg-surface-hover hover:text-text-primary">
              <Plus className="h-3.5 w-3.5" aria-hidden="true" /> Pick a colour
            </button>
          )}
        </div>
        {showPicker && (
          <div className="mt-2.5">
            <ColorPicker value={draft} onChange={setDraft} />
            <div className="mt-3 flex justify-end gap-2">
              <Button variant="subtle" size="sm" onMouseDown={(e) => { e.preventDefault(); setShowPicker(false); }}>Cancel</Button>
              <Button variant="primary" size="sm" onMouseDown={(e) => { e.preventDefault(); applyPicker(); }}>Apply</Button>
            </div>
          </div>
        )}
      </Popover>
    </div>
  );
}

// Conventional in-manuscript scene break: a centered "* * *" paragraph.
function insertSceneBreak(editor) {
  editor.chain().focus().insertContent({
    type: 'paragraph',
    attrs: { textAlign: 'center' },
    content: [{ type: 'text', text: '* * *' }],
  }).run();
}

function Toolbar({ editor, pageConfig }) {
  useToolbarTick(editor);
  if (!editor) return null;
  return (
    <div role="toolbar" aria-label="Formatting" className="wd-toolbar flex min-w-0 flex-nowrap items-center gap-0.5 overflow-x-auto">
      <TextStyleControl editor={editor} baseFont={pageConfig?.defaultFont} />
      <Divider />
      <FontPicker editor={editor} baseFont={pageConfig?.defaultFont} />
      <span className="w-1" />
      <FontSizeControl editor={editor} baseSize={pageConfig?.defaultFontSize} />
      <span className="w-1" />
      <SpacingControl editor={editor} baseLineHeight={pageConfig?.lineHeight} baseSpacing={pageConfig?.paragraphSpacing} />
      <Divider />
      <ToolbarButton active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} label="Bold"><Bold className="h-4 w-4" /></ToolbarButton>
      <ToolbarButton active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} label="Italic"><Italic className="h-4 w-4" /></ToolbarButton>
      <ToolbarButton active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} label="Underline"><Underline className="h-4 w-4" /></ToolbarButton>
      <ToolbarButton active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} label="Strikethrough"><Strikethrough className="h-4 w-4" /></ToolbarButton>
      <ColorPopover editor={editor} />
      <Divider />
      <AlignControl editor={editor} />
      <Divider />
      <ToolbarButton active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} label="Bullet list"><List className="h-4 w-4" /></ToolbarButton>
      <ToolbarButton active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} label="Numbered list"><ListOrdered className="h-4 w-4" /></ToolbarButton>
      <ToolbarButton active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} label="Quote"><Quote className="h-4 w-4" /></ToolbarButton>
      <Divider />
      <ToolbarButton onClick={() => insertSceneBreak(editor)} label="Scene break"><Asterisk className="h-4 w-4" /></ToolbarButton>
      <ToolbarButton active={editor.isActive('table')} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} label="Insert table"><TableIcon className="h-4 w-4" /></ToolbarButton>
    </div>
  );
}

const CELL_SWATCHES = [
  { label: 'Yellow', color: '#fde68a' }, { label: 'Red', color: '#fca5a5' }, { label: 'Green', color: '#86efac' }, { label: 'Blue', color: '#93c5fd' },
  { label: 'Violet', color: '#d8b4fe' }, { label: 'Pink', color: '#f9a8d4' }, { label: 'Light grey', color: '#e5e7eb' }, { label: 'Grey', color: '#9ca3af' },
];

// Cell background color: swatches + custom picker + clear. Font color stays on
// the main toolbar; this only fills the selected cell(s).
function CellColorControl({ editor }) {
  const [showPicker, setShowPicker] = useState(false);
  const [draft, setDraft] = useState('#fde68a');
  const ref = useRef(null);
  const apply = (color) => editor.chain().focus().setCellBackground(color).run();
  return (
    <div className="relative flex items-center gap-1.5" ref={ref}>
      {CELL_SWATCHES.map(s => (
        <Tooltip key={s.color} content={`Fill ${s.label.toLowerCase()}`}>
          <button type="button" aria-label={`Fill ${s.label.toLowerCase()}`}
            onMouseDown={(e) => { e.preventDefault(); apply(s.color); }}
            className="h-[1.125rem] w-[1.125rem] cursor-pointer rounded border border-shade/20 transition-transform hover:scale-110"
            style={{ backgroundColor: s.color }} />
        </Tooltip>
      ))}
      <Tooltip content="Custom fill">
        <button type="button" aria-label="Custom fill"
          onMouseDown={(e) => { e.preventDefault(); setShowPicker(s => !s); }}
          className={`h-[1.125rem] w-[1.125rem] cursor-pointer rounded border ${showPicker ? 'border-text-primary' : 'border-border-strong'}`}
          style={{ background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' }} />
      </Tooltip>
      <button type="button" onMouseDown={(e) => { e.preventDefault(); apply(null); }} className="rounded-md px-1.5 py-0.5 text-xs font-semibold text-text-muted hover:bg-surface-hover hover:text-text-primary">No fill</button>
      <Popover anchorRef={ref} open={showPicker} onClose={() => setShowPicker(false)} matchAnchorWidth={false} scroll={false} className="w-56 !p-3">
        <ColorPicker value={draft} onChange={setDraft} />
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="subtle" size="sm" onMouseDown={(e) => { e.preventDefault(); setShowPicker(false); }}>Cancel</Button>
          <Button variant="primary" size="sm" onMouseDown={(e) => { e.preventDefault(); apply(draft); setShowPicker(false); }}>Apply</Button>
        </div>
      </Popover>
    </div>
  );
}

const GroupLabel = ({ children }) => <span className="px-1 text-xs font-semibold text-text-subtle">{children}</span>;

function TableBubble({ editor }) {
  useToolbarTick(editor);
  if (!editor) return null;
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="tableBubble"
      shouldShow={({ editor }) => editor.isActive('table')}
      updateDelay={0}
      className="flex flex-wrap items-center gap-0.5 rounded-card border border-border-default bg-surface-panel px-2 py-1.5 shadow-overlay"
    >
      <div role="toolbar" aria-label="Table" className="flex flex-wrap items-center gap-0.5">
        <GroupLabel>Rows</GroupLabel>
        <ToolbarButton onClick={() => editor.chain().focus().addRowBefore().run()} label="Row above"><ArrowUpToLine className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().addRowAfter().run()} label="Row below"><ArrowDownToLine className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton danger onClick={() => editor.chain().focus().deleteRow().run()} label="Delete row"><Trash2 className="h-4 w-4" /></ToolbarButton>
        <Divider />
        <GroupLabel>Columns</GroupLabel>
        <ToolbarButton onClick={() => editor.chain().focus().addColumnBefore().run()} label="Column left"><ArrowLeftToLine className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().addColumnAfter().run()} label="Column right"><ArrowRightToLine className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton danger onClick={() => editor.chain().focus().deleteColumn().run()} label="Delete column"><Trash2 className="h-4 w-4" /></ToolbarButton>
        <Divider />
        <GroupLabel>Cells</GroupLabel>
        <ToolbarButton onClick={() => editor.chain().focus().toggleHeaderRow().run()} label="Header row"><Rows3 className="h-4 w-4" /></ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().mergeOrSplit().run()} label="Merge or split cells"><Combine className="h-4 w-4" /></ToolbarButton>
        <span className="w-1.5" />
        <CellColorControl editor={editor} />
        <Divider />
        <button type="button" onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().deleteTable().run(); }} className="rounded-md px-2 py-1 text-xs font-semibold text-status-danger hover:bg-status-danger/10">Delete table</button>
      </div>
    </BubbleMenu>
  );
}

function countWords(text) {
  const t = (text || '').trim();
  return t ? t.split(/\s+/).length : 0;
}

// Colour carries the state; the accent stays for interaction only.
const MEMORY_PILL = {
  busy: { Icon: IndexingGlyph, label: 'Updating memory', cls: 'border-status-info/35 bg-status-info/10 text-status-info' },
  done: { Icon: IndexedGlyph, label: 'In AI memory', cls: 'border-status-success/30 bg-status-success/[0.08] text-status-success' },
  outdated: { Icon: IndexOutdatedGlyph, label: 'Memory out of date', cls: 'border-status-warning/35 bg-status-warning/[0.09] text-status-warning' },
  error: { Icon: IndexErrorGlyph, label: 'Memory update failed', cls: 'border-status-danger/40 bg-status-danger/10 text-status-danger' },
  never: { Icon: IndexNeverGlyph, label: 'Not in AI memory', cls: 'border-border-default bg-tint/[0.04] text-text-secondary' },
};

const MEMORY_NOTES = {
  outdated: 'You changed this chapter after the AI last read it, so it still remembers the old version.',
  never: "This chapter isn't in the AI's memory yet.",
  done: 'The AI remembers this chapter as it is now.',
};

// The label folds away when the header runs short, leaving the icon, count and tooltip.
function PanelToggle({ icon: Icon, label, count, active, onClick }) {
  return (
    <Tooltip content={label} side="bottom">
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        onClick={onClick}
        className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 @[54rem]:px-2.5 ${active ? 'bg-tint/[0.12] text-text-primary' : 'text-text-muted hover:bg-tint/5 hover:text-text-primary'}`}
      >
        <Icon className="h-4 w-4" aria-hidden="true" />
        <span className="hidden @[54rem]:inline">{label}</span>
        {count > 0 && <span className="inline-flex h-[1.125rem] min-w-[1.125rem] items-center justify-center rounded-full bg-tint/10 px-1 text-xs tabular-nums text-text-secondary">{count}</span>}
      </button>
    </Tooltip>
  );
}

export default function WritingEditor({
  doc, folderName, electronAPI, workspaceId, inFlight = false, inFlightProfileId = null, pending = null, onDispatch, onResolved,
  toolbarMode = 'fixed', smartTypography = true, onDocPatch, onRename, jumpRef, onOpenEntity,
  chaptersHidden = false, onToggleChapters, rightPanel = '', onTogglePanel, notesCount = 0, directivesCount = 0, analysesCount = 0,
  indexingElsewhere = false, indexingProgress = null, onIndexingChange, inWorld = false, onInWorld,
}) {
  const { showToast, settings } = useApp();
  const tokenDebug = Boolean(settings?.advanced?.tokenDebug);
  const ragDebug = Boolean(settings?.advanced?.ragDebug);
  const saveTimer = useRef(null);
  // Tracks genuine unsaved edits, so leaving the chapter never re-saves unchanged
  // content (which would reset the document's vectorized flag every page switch).
  const dirty = useRef(false);
  const [counts, setCounts] = useState({ words: 0, chars: 0 });
  const [showExport, setShowExport] = useState(false);
  const [showPageSetup, setShowPageSetup] = useState(false);
  const [showFind, setShowFind] = useState(false);
  const [title, setTitle] = useState(doc.title);
  // inFlight and pending live in the parent view, since this editor remounts on chapter switch.
  const [profiles, setProfiles] = useState([]);
  const [lastChannel, setLastChannel] = useState('replacement'); // sticky default for the Invoke modal
  const [invokeData, setInvokeData] = useState(null); // captured selection for the modal
  const [stale, setStale] = useState(false);
  const [wbOpen, setWbOpen] = useState(false);
  const [wbData, setWbData] = useState(null); // { from, to, text, entity, marked }
  const [wbEntities, setWbEntities] = useState([]);
  const [wbQuery, setWbQuery] = useState('');
  const wbBtnRef = useRef(null);
  const wbAnchorRef = useRef(null); // where the menu anchors: the Link button OR a clicked entity span
  const [entityHover, setEntityHover] = useState(null); // { name, type, x, y } custom card
  // 'done' | 'outdated' | 'never' | 'error'.
  const [vecStatus, setVecStatus] = useState(doc.vectorized ? 'done' : 'never');
  const [vecBusy, setVecBusy] = useState(false);
  const [vecProgress, setVecProgress] = useState(null);
  const [vecError, setVecError] = useState('');
  const [vecMenuOpen, setVecMenuOpen] = useState(false);
  const vecBtnRef = useRef(null);
  const goalRef = useRef(null);
  const [goalOpen, setGoalOpen] = useState(false);
  const [goalDraft, setGoalDraft] = useState('');
  const locked = inFlight || !!pending;
  const pageConfig = pageConfigFromDoc(doc);

  // An update keeps running when the writer leaves the chapter; the view tracks it so coming back shows it.
  const busy = vecBusy || indexingElsewhere;
  const progress = vecProgress || indexingProgress;
  const pill = MEMORY_PILL[busy ? 'busy' : vecStatus] || MEMORY_PILL.never;
  // When the chapter is behind its text, updating is the answer, so it becomes the primary action.
  const needsSync = vecStatus === 'never' || vecStatus === 'outdated' || vecStatus === 'error';

  useEffect(() => { setTitle(doc.title); }, [doc.id]);
  // Resolve the indexed indicator from the actual content-vs-index comparison (not the
  // mutable vectorized flag), so it survives page switches with no edits.
  useEffect(() => {
    let active = true;
    setVecProgress(null);
    electronAPI.getDocumentVectorStatus?.(doc.id).then(res => {
      if (active && res?.success) setVecStatus(res.status || 'never');
    });
    return () => { active = false; };
  }, [doc.id, electronAPI]);

  useEffect(() => {
    if (!electronAPI.onVectorizeDocumentProgress) return;
    const off = electronAPI.onVectorizeDocumentProgress((d) => {
      if (d.documentId === doc.id) setVecProgress(d);
    });
    return off;
  }, [electronAPI, doc.id]);

  // Retag keeps embeddings, so an edited chapter legitimately stays 'outdated'.
  const refreshVecStatus = async () => {
    const res = await electronAPI.getDocumentVectorStatus?.(doc.id);
    if (res?.success) setVecStatus(res.status || 'never');
  };

  // An update started before this chapter was reopened has just finished.
  const wasIndexing = useRef(indexingElsewhere);
  useEffect(() => {
    if (wasIndexing.current && !indexingElsewhere && !vecBusy) refreshVecStatus();
    wasIndexing.current = indexingElsewhere;
  }, [indexingElsewhere]);

  // Update memory: embed + tag only new/changed blocks (incremental by content hash).
  const runVectorize = async () => {
    if (busy) return;
    setVecMenuOpen(false);
    setVecBusy(true);
    setVecProgress(null);
    onIndexingChange?.(doc.id, true);
    try {
      const res = await electronAPI.vectorizeDocument?.(doc.id);
      if (res?.success) { setVecError(''); await refreshVecStatus(); }
      else {
        setVecStatus('error');
        setVecError(res?.error || 'Unknown error');
        showToast?.(`Memory update failed: ${res?.error || 'Unknown error'}`, 'error');
        console.error('[vectorize-document] backend error:', res?.error, res?.stack);
      }
    } catch (e) {
      console.error('[vectorize-document] failed:', e);
      setVecStatus('error');
      setVecError(e.message);
      showToast?.(`Memory update failed: ${e.message}`, 'error');
    } finally {
      setVecBusy(false);
      setVecProgress(null);
      onIndexingChange?.(doc.id, false);
    }
  };

  // Refresh tags: re-tag every already-embedded chunk from scratch (no re-embedding),
  // to reflect the current tagger and entity registry.
  const runRetag = async () => {
    if (busy) return;
    setVecMenuOpen(false);
    setVecBusy(true);
    setVecProgress(null);
    onIndexingChange?.(doc.id, true);
    try {
      const res = await electronAPI.retagDocument?.(doc.id);
      if (res && !res.success) { setVecStatus('error'); setVecError(res.error || ''); }
      else await refreshVecStatus();
    } catch (e) {
      console.error('[retag-document] failed:', e);
      setVecStatus('error');
      setVecError(e.message);
    } finally {
      setVecBusy(false);
      setVecProgress(null);
      onIndexingChange?.(doc.id, false);
    }
  };

  // Ctrl/Cmd+F opens Find & Replace and pre-empts the browser's own find bar.
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        setShowFind(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  // Only the workspace's active profiles, same as the chat.
  useEffect(() => {
    let active = true;
    Promise.all([
      electronAPI.getWritingProfiles?.() ?? [],
      electronAPI.getChats?.() ?? []
    ]).then(([list, chats]) => {
      if (!active) return;
      const chat = (chats || []).find(c => c.id === workspaceId);
      let activeIds = [];
      try {
        const raw = chat?.activeProfiles;
        activeIds = Array.isArray(raw) ? raw : JSON.parse(raw || '[]');
      } catch (e) { activeIds = []; }
      const activeSet = new Set(activeIds);
      setProfiles((list || []).filter(p => activeSet.has(p.id)));
      if (chat?.wdLastChannel) setLastChannel(chat.wdLastChannel);
    });
    return () => { active = false; };
  }, [electronAPI, workspaceId]);

  let initialContent;
  try {
    initialContent = doc.content ? JSON.parse(doc.content) : undefined;
  } catch (e) {
    initialContent = undefined;
  }

  const editor = useEditor({
    extensions: getEditorExtensions({ smartTypography }),
    content: initialContent,
    editorProps: {
      attributes: {
        class: 'writing-prose focus:outline-none',
      },
    },
    onUpdate: ({ editor }) => {
      const text = editor.getText();
      setCounts({ words: countWords(text), chars: text.length });
      // Edits desync the persistent index; save-document-content also resets the DB flag.
      dirty.current = true;
      setVecStatus(s => (s === 'done' ? 'outdated' : s));
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        electronAPI.saveDocumentContent(doc.id, JSON.stringify(editor.getJSON()));
        saveTimer.current = null;
        dirty.current = false;
      }, 800);
    },
  }, [doc.id, smartTypography]);

  useEffect(() => {
    if (!editor) return;
    const text = editor.getText();
    setCounts({ words: countWords(text), chars: text.length });
  }, [editor, doc.id]);

  // No stored anchor, so it can't orphan.
  useEffect(() => {
    if (!jumpRef) return;
    jumpRef.current = (excerpt) => {
      if (!editor || !excerpt) return;
      const needle = excerpt.trim();
      const candidates = [needle, needle.slice(0, 60), needle.split(/\s+/).slice(0, 6).join(' ')];
      let from = null;
      for (const c of candidates) {
        if (!c) continue;
        editor.state.doc.descendants((node, pos) => {
          if (from != null) return false;
          if (node.isText && node.text) {
            const i = node.text.indexOf(c);
            if (i !== -1) { from = pos + i; return false; }
          }
          return true;
        });
        if (from != null) break;
      }
      if (from == null) return;
      try {
        const dom = editor.view.domAtPos(from)?.node;
        const el = dom && dom.nodeType === 3 ? dom.parentElement : dom;
        const block = el && el.closest ? el.closest('p, h1, h2, h3, li, blockquote') : el;
        if (block && block.scrollIntoView) block.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } catch { /* dom lookup best-effort */ }
    };
    return () => { if (jumpRef) jumpRef.current = null; };
  }, [editor, jumpRef]);

  const loadWbEntities = async () => {
    try {
      const res = await electronAPI.listEntities?.(workspaceId);
      setWbEntities(res?.entities || []);
    } catch { setWbEntities([]); }
  };

  // Hover card for linked-entity spans: the type's dot and the full entity name, above the span.
  useEffect(() => {
    if (!editor) return;
    const dom = editor.view.dom;
    const onOver = (e) => {
      const el = e.target?.closest?.('.wd-entity-ref');
      if (!el) return;
      const id = el.getAttribute('data-entity-id') || '';
      const rect = el.getBoundingClientRect();
      const base = {
        id,
        name: el.getAttribute('data-entity-name') || el.textContent || '',
        type: el.getAttribute('data-entity-type') || '',
        x: rect.left + rect.width / 2,
        y: rect.top,
      };
      setEntityHover(base);
      // Older marks (or renamed entities) may lack the stored type, resolve it by id.
      if (id && !base.type && electronAPI.getEntity) {
        electronAPI.getEntity(id).then(res => {
          const ent = res?.entity || res;
          if (ent) setEntityHover(cur => (cur && cur.id === id ? { ...cur, type: ent.type || cur.type, name: ent.canonicalName || cur.name } : cur));
        }).catch(() => {});
      }
    };
    const onOut = (e) => {
      if (e.target?.closest?.('.wd-entity-ref')) setEntityHover(null);
    };
    // Clicking a linked word opens the entity menu right there.
    const onClick = (e) => {
      const el = e.target?.closest?.('.wd-entity-ref');
      if (!el) return;
      const from = editor.view.posAtDOM(el, 0);
      const to = from + (el.textContent?.length || 0);
      const entityId = el.getAttribute('data-entity-id') || '';
      const name = el.getAttribute('data-entity-name') || el.textContent || '';
      const type = el.getAttribute('data-entity-type') || '';
      setEntityHover(null);
      setWbData({ from, to, text: el.textContent || name, marked: true, entity: entityId ? { id: entityId, canonicalName: name, type } : null });
      wbAnchorRef.current = el;
      setWbOpen(true);
      if (entityId && electronAPI.getEntity) {
        electronAPI.getEntity(entityId).then(res => {
          const ent = res?.entity || res;
          setWbData(d => (d && d.entity && d.entity.id === entityId ? { ...d, entity: ent || { id: entityId, canonicalName: name, type, missing: true } } : d));
        }).catch(() => {});
      }
    };
    dom.addEventListener('mouseover', onOver);
    dom.addEventListener('mouseout', onOut);
    dom.addEventListener('click', onClick);
    return () => {
      dom.removeEventListener('mouseover', onOver);
      dom.removeEventListener('mouseout', onOut);
      dom.removeEventListener('click', onClick);
    };
  }, [editor]);

  // Flush a pending save when switching documents or unmounting, only when there are
  // genuine unsaved edits, so an unchanged chapter keeps its vectorized flag intact.
  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (dirty.current && editor) {
        electronAPI.saveDocumentContent(doc.id, JSON.stringify(editor.getJSON()));
      }
      saveTimer.current = null;
      dirty.current = false;
    };
  }, [doc.id, editor]);

  // Lock the chapter while a request is in flight or a suggestion awaits a decision,
  // so the user can't edit text the suggestion is anchored to.
  useEffect(() => {
    if (editor) editor.setEditable(!locked);
  }, [editor, locked]);

  // Paint (or clear) the inline red/green track-changes for the pending suggestion.
  // Also validate the suggestion still anchors to unchanged text before allowing Accept.
  useEffect(() => {
    if (!editor) return;
    let decos = DecorationSet.empty;
    let isStale = false;
    if (pending && pending.channel !== 'analysis') {
      const current = editor.state.doc.textBetween(pending.fromPos, pending.toPos, '\n');
      isStale = current !== (pending.originalText || '');
      if (!isStale) {
        const proposedHtml = proposalToHtml(editor, pending.proposedText || '');
        decos = buildSuggestionDecorations(editor.state.doc, { ...pending, proposedHtml });
      }
    }
    setStale(isStale);
    editor.view.dispatch(editor.state.tr.setMeta(suggestionKey, decos));
  }, [editor, pending]);

  const openInvoke = () => {
    if (!editor || locked) return;
    const { from, to } = editor.state.selection;
    if (from === to) return;
    const selection = editor.state.doc.textBetween(from, to, '\n');
    // Markdown is the interchange so the AI reliably preserves bold/italic/headings/
    // lists. Tables mangle in Markdown, so a table selection falls back to HTML.
    const useHtml = selectionHasTable(editor, from, to);
    const format = useHtml ? 'html' : 'markdown';
    const spanContent = useHtml
      ? getHTMLFromFragment(editor.state.doc.slice(from, to).content, editor.schema)
      : sliceToMarkdown(editor, from, to);
    const before = editor.state.doc.textBetween(0, from, '\n');
    const after = editor.state.doc.textBetween(to, editor.state.doc.content.size, '\n');
    setInvokeData({ from, to, selection, spanContent, format, before, after });
  };

  // Never guess identity from the name: the menu reads only the real mark on the selection.
  const openWorldbuildMenu = async () => {
    if (!editor || locked) return;
    const { from, to } = editor.state.selection;
    if (from === to) return;
    const text = editor.state.doc.textBetween(from, to, ' ').trim();
    if (!text) return;
    const marked = editor.isActive('entityRef');
    const attrs = marked ? editor.getAttributes('entityRef') : {};
    setWbQuery(marked ? '' : text);
    setWbData({ from, to, text, entity: null, marked });
    wbAnchorRef.current = wbBtnRef.current;
    setWbOpen(true);
    if (marked && attrs.entityId) {
      try {
        const res = await electronAPI.getEntity?.(attrs.entityId);
        const ent = res?.entity || res || null;
        // Fall back to the stored mark attrs if the entity was deleted (dangling ref).
        setWbData(d => (d ? { ...d, entity: ent || { id: attrs.entityId, canonicalName: attrs.name, type: attrs.type, missing: true } } : d));
      } catch { /* getEntity best-effort */ }
    } else {
      loadWbEntities();
    }
  };

  // Presentational mark only, retrieval still runs off chunk_tags. Stores type so the
  // hover card can render the right colour without a fetch.
  const applyEntityMark = async (from, to, entity) => {
    if (!editor || !entity) return;
    editor.chain().focus().setTextSelection({ from, to }).setMark('entityRef', { entityId: entity.id, name: entity.canonicalName, type: entity.type }).run();
    await electronAPI.saveDocumentContent(doc.id, JSON.stringify(editor.getJSON()));
    // The mark is presentational and never changes a chunk's hashed text, so re-assert
    // the real index status instead of the optimistic 'outdated' the edit triggered.
    refreshVecStatus();
  };

  const linkToEntity = async (entity) => {
    if (!wbData || !entity) return;
    await electronAPI.addEntityAlias?.(entity.id, wbData.text); // teaches the auto-tagger
    applyEntityMark(wbData.from, wbData.to, entity);
    setWbOpen(false);
  };

  const createEntityOfType = async (type) => {
    if (!wbData) return;
    const res = await electronAPI.createEntity?.({ workspaceId, type, canonicalName: wbData.text, status: 'confirmed' });
    if (res?.entity) applyEntityMark(wbData.from, wbData.to, res.entity);
    setWbOpen(false);
  };

  const unlinkEntity = async () => {
    if (!editor || !wbData) return;
    editor.chain().focus().setTextSelection({ from: wbData.from, to: wbData.to }).unsetMark('entityRef').run();
    await electronAPI.saveDocumentContent(doc.id, JSON.stringify(editor.getJSON()));
    setWbOpen(false);
    refreshVecStatus(); // mark-only change, doesn't affect chunk hashes
  };

  const submitInvoke = async (profileId, intermediatePrompt, resultChannel) => {
    if (!invokeData) return;
    const channel = resultChannel || 'replacement';
    const payload = {
      documentId: doc.id,
      workspaceId,
      before: invokeData.before,
      selection: invokeData.selection,
      spanContent: invokeData.spanContent,
      format: invokeData.format,
      after: invokeData.after,
      fromPos: invokeData.from,
      toPos: invokeData.to,
      profileId,
      intermediatePrompt,
      resultChannel: channel,
    };
    setInvokeData(null);
    // Remember the choice as the workspace's new default for the next invocation.
    setLastChannel(channel);
    electronAPI.setWdLastChannel?.(workspaceId, channel);
    onDispatch?.(doc.id, profileId);
    const res = await electronAPI.invokeWritingDesk(payload);
    if (res && res.error) {
      onResolved?.(doc.id); // clear the in-flight marker the dispatch set
      showToast(res.error, 'error');
    }
  };

  const acceptSuggestion = async () => {
    if (!editor || !pending || stale) return;
    // setEditable is not a chain command: inside .chain() it silently aborts the whole chain.
    editor.setEditable(true);
    editor.view.dispatch(editor.state.tr.setMeta(suggestionKey, DecorationSet.empty));
    // proposedText is Markdown (or HTML for the table fallback); insertContentAt parses
    // it, so the proposal lands with its formatting (bold/italic/headings/lists) intact.
    const content = pending.proposedText || '';
    if (pending.channel === 'insertion') {
      editor.chain().focus().insertContentAt(pending.toPos, content).run();
    } else {
      editor.chain().focus().insertContentAt({ from: pending.fromPos, to: pending.toPos }, content).run();
    }
    electronAPI.saveDocumentContent(doc.id, JSON.stringify(editor.getJSON()));
    await electronAPI.resolvePendingSuggestion(pending.id);
    onResolved?.(doc.id);
  };

  const rejectSuggestion = async () => {
    if (!pending) return;
    if (editor) editor.view.dispatch(editor.state.tr.setMeta(suggestionKey, DecorationSet.empty));
    await electronAPI.resolvePendingSuggestion(pending.id);
    onResolved?.(doc.id);
  };

  const delta = pending ? suggestionWordDelta(pending) : { added: 0, removed: 0 };
  const profileName = (id) => profiles.find(p => p.id === id)?.name || 'The AI';
  const profileColor = (id) => profiles.find(p => p.id === id)?.color || null;

  // Text color adapts to the paper so it stays readable on any sheet color.
  const effectiveBg = pageConfig.sheetColor || '#ffffff';
  const pageW = pageConfig.pageWidth || 794;
  const pageH = pageConfig.pageHeight || 1123;
  const mT = pageConfig.marginTop ?? 96;
  const mB = pageConfig.marginBottom ?? 96;
  const mL = pageConfig.marginLeft ?? 96;
  const mR = pageConfig.marginRight ?? 96;

  // One continuous sheet; page boundaries only exist in export.
  const sheetStyle = {
    backgroundColor: effectiveBg,
    color: isLightColor(effectiveBg) ? '#1f2328' : '#e5e7eb',
    fontFamily: pageConfig.defaultFont || undefined,
    fontSize: `${pageConfig.defaultFontSize || 18}px`,
    lineHeight: pageConfig.lineHeight || 1.6,
    width: `${pageW}px`,
    minHeight: `${pageH}px`,
    paddingTop: `${mT}px`,
    paddingRight: `${mR}px`,
    paddingBottom: `${mB}px`,
    paddingLeft: `${mL}px`,
    '--wd-para-spacing': `${pageConfig.paragraphSpacing ?? 12}px`,
    '--wd-indent': `${pageConfig.firstLineIndent ?? 0}px`,
  };

  const goal = doc.wordGoal || 0;
  const goalPct = goal > 0 ? Math.min(100, Math.round((counts.words / goal) * 100)) : 0;
  const saveGoal = (value) => {
    onDocPatch?.({ wordGoal: Math.max(0, parseInt(value, 10) || 0) });
    setGoalOpen(false);
  };

  const wbQueryText = wbQuery.trim().toLowerCase();
  const wbMatches = wbEntities
    .filter(e => !wbQueryText || (e.canonicalName || '').toLowerCase().includes(wbQueryText) || (e.aliases || []).some(a => String(a).toLowerCase().includes(wbQueryText)))
    // A name that starts with the query outranks one that only carries it as an alias.
    .sort((a, b) => Number(!(a.canonicalName || '').toLowerCase().startsWith(wbQueryText)) - Number(!(b.canonicalName || '').toLowerCase().startsWith(wbQueryText)))
    .slice(0, 8);

  return (
    <div className="relative flex flex-1 flex-col overflow-hidden">
      {showFind && editor && (
        <WritingFindReplace editor={editor} locked={locked} onClose={() => setShowFind(false)} />
      )}

      {/* Chapter header, always visible (incl. bubble mode) so Export and Page setup never disappear. */}
      <div className="@container ws-clear glass-panel flex h-[3.25rem] shrink-0 items-center gap-1 border-b border-border-subtle pl-3 pr-3">
        <IconButton icon={chaptersHidden ? PanelLeftOpen : PanelLeftClose} label={chaptersHidden ? 'Show chapters' : 'Hide chapters'} size="sm" tooltipSide="bottom" onClick={onToggleChapters} />
        {folderName && (
          <>
            <span className="ml-1 max-w-[10rem] shrink truncate text-sm text-text-subtle">{folderName}</span>
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-text-disabled" aria-hidden="true" />
          </>
        )}
        <label className="ml-1 min-w-0 flex-1">
          <span className="sr-only">Chapter title</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={() => onRename?.(title)}
            onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur(); }}
            className="w-full min-w-0 truncate rounded-md bg-transparent px-1 py-1 text-base font-bold text-text-primary focus:bg-tint/[0.04] focus:outline-none"
            placeholder="Untitled"
          />
        </label>

        {inWorld ? (
          // Written inside the story: read only when its item is read, never through story memory.
          <button type="button" onClick={onInWorld}
            className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border border-border-default bg-tint/[0.04] px-2.5 text-xs font-semibold text-text-secondary transition-colors hover:bg-tint/[0.08] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
            <ScrollText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />In-world text
          </button>
        ) : (<>
        <button
          type="button"
          ref={vecBtnRef}
          aria-haspopup="menu"
          aria-expanded={vecMenuOpen}
          onClick={() => !busy && setVecMenuOpen(v => !v)}
          disabled={busy}
          className={`inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full border pl-2 pr-2 text-xs font-semibold transition-colors disabled:cursor-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${pill.cls}`}
        >
          <pill.Icon animated={busy} className="h-3.5 w-3.5 shrink-0" />
          {pill.label}
          {busy && progress && <span className="tabular-nums opacity-80">{progress.done} of {progress.total}</span>}
          {!busy && <ChevronDown className="h-3.5 w-3.5 opacity-70" aria-hidden="true" />}
        </button>
        <Menu anchorRef={vecBtnRef} open={vecMenuOpen} onClose={() => setVecMenuOpen(false)} label="AI memory" className="w-72">
          {vecStatus === 'error'
            ? <p className="px-2.5 pb-2 pt-1 text-xs leading-snug text-status-danger">The last update failed{vecError ? `: ${vecError}` : '.'}</p>
            : <MenuNote>{MEMORY_NOTES[vecStatus]}</MenuNote>}
          {needsSync ? (
            <div className="px-1 pb-2 pt-1">
              <Button fullWidth role="menuitem" onClick={runVectorize} icon={vecStatus === 'error' ? null : IndexOutdatedGlyph}>
                {vecStatus === 'error' ? 'Try again' : "Update the AI's memory"}
              </Button>
              {vecStatus !== 'error' && <p className="mt-1.5 px-1.5 text-xs leading-snug text-text-muted">Reads the paragraphs you added or changed. Do this after writing.</p>}
            </div>
          ) : (
            <MenuItem label="Update the AI's memory" description="Reads the paragraphs you added or changed. Do this after writing." onSelect={runVectorize} />
          )}
          <MenuSeparator />
          <MenuItem label="Refresh entity tags" description="Re-tags what the AI already has, without reading it again. Use after changing your Worldbuild entities." onSelect={runRetag} />
        </Menu>
        </>)}

        <Divider />
        <IconButton icon={Search} label="Find and replace (Ctrl F)" size="sm" tooltipSide="bottom" aria-pressed={showFind} className={showFind ? '!bg-tint/[0.12] !text-text-primary' : ''} onClick={() => setShowFind(v => !v)} />
        <IconButton icon={FileCog} label="Page setup" size="sm" tooltipSide="bottom" onClick={() => setShowPageSetup(true)} />
        <IconButton icon={Download} label="Export" size="sm" tooltipSide="bottom" onClick={() => setShowExport(true)} />
        <Divider />
        <PanelToggle icon={NoteGlyph} label="Notes" count={notesCount} active={rightPanel === 'notes'} onClick={() => onTogglePanel?.('notes')} />
        <PanelToggle icon={AiGlyph} label="Analyses" count={analysesCount} active={rightPanel === 'analyses'} onClick={() => onTogglePanel?.('analyses')} />
        <PanelToggle icon={Pin} label="Directives" count={directivesCount} active={rightPanel === 'directives'} onClick={() => onTogglePanel?.('directives')} />
      </div>

      {toolbarMode === 'fixed' && (
        <div className="ws-clear glass-panel flex min-h-[2.875rem] shrink-0 items-center border-b border-border-subtle px-3.5 py-1.5">
          <Toolbar editor={editor} pageConfig={pageConfig} />
        </div>
      )}

      {showPageSetup && (
        <WritingPageModal config={pageConfig} chapterTitle={doc.title} onChange={onDocPatch} onClose={() => setShowPageSetup(false)} />
      )}

      {showExport && editor && (
        <ExportModal
          editor={editor}
          pageConfig={pageConfig}
          title={doc.title}
          electronAPI={electronAPI}
          onClose={() => setShowExport(false)}
        />
      )}

      {toolbarMode === 'bubble' && editor && (
        <BubbleMenu editor={editor} shouldShow={({ editor, state }) => !inFlight && !state.selection.empty && !editor.isActive('table')} className="flex items-center gap-0.5 rounded-card border border-border-default bg-surface-panel px-2 py-1.5 shadow-overlay">
          <Toolbar editor={editor} pageConfig={pageConfig} />
        </BubbleMenu>
      )}

      {editor && !inFlight && <TableBubble editor={editor} />}

      {editor && (
        <BubbleMenu
          editor={editor}
          pluginKey="invokeBubble"
          shouldShow={({ state }) => !state.selection.empty && !locked}
          options={{ placement: 'bottom' }}
          className="flex gap-1 rounded-card border border-border-default bg-surface-panel p-1 shadow-overlay"
        >
          <button
            type="button"
            onClick={openInvoke}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-accent px-3 text-xs font-semibold text-on-accent transition-[filter] hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <AiGlyph className="h-4 w-4" /> Invoke AI
          </button>
          <button
            type="button"
            ref={wbBtnRef}
            aria-haspopup="menu"
            aria-expanded={wbOpen}
            onClick={() => (wbOpen ? setWbOpen(false) : openWorldbuildMenu())}
            className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${wbOpen ? 'bg-tint/[0.12] text-text-primary' : 'bg-tint/[0.06] text-text-secondary hover:bg-tint/10 hover:text-text-primary'}`}
          >
            <WorldbuildGlyph className="h-4 w-4" /> Link to world
            <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 text-text-subtle transition-transform ${wbOpen ? 'rotate-180' : ''}`} />
          </button>
        </BubbleMenu>
      )}

      <Popover anchorRef={wbAnchorRef} open={wbOpen} onClose={() => setWbOpen(false)} matchAnchorWidth={false} align="right" scroll={false} maxHeight={wbData?.marked ? 200 : 470} className="w-80 !p-1.5">
        {wbData && (wbData.marked ? (
          <div role="menu" aria-label={wbData.entity?.canonicalName || wbData.text} className="flex flex-col">
            {wbData.entity && (() => {
              const m = entityTypeMeta(wbData.entity.type);
              const size = wbData.entity.type === 'Locations' ? locationSizeLabel(locationSizeOf(wbData.entity)) : null;
              return (
                <div className="flex items-center gap-2.5 px-1.5 pb-2 pt-1.5">
                  <span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border ${wbData.entity.missing ? 'border-border-default text-text-subtle' : m.medallion}`}>
                    {wbData.entity.missing ? <IndexNeverGlyph className="h-4 w-4" /> : <m.icon className="h-4 w-4" />}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-sm font-semibold text-text-primary">{wbData.entity.canonicalName || wbData.text}</span>
                    <span className={`text-xs ${wbData.entity.missing ? 'text-status-warning' : 'text-text-subtle'}`}>
                      {wbData.entity.missing ? 'No longer in Worldbuild' : [m.label, size].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                </div>
              );
            })()}
            <MenuSeparator />
            {wbData.entity && !wbData.entity.missing && (
              <MenuItem icon={ExternalLink} label="Open in Worldbuild" onSelect={() => { setWbOpen(false); onOpenEntity?.(wbData.entity.id); }} />
            )}
            <MenuItem icon={Unlink} label="Unlink" onSelect={unlinkEntity} />
          </div>
        ) : (
          <div className="flex flex-col">
            <div className="flex min-w-0 items-baseline gap-2 px-2 pb-2 pt-1.5">
              <span className="truncate text-sm font-semibold text-text-primary">“{wbData.text}”</span>
              <span className="shrink-0 text-xs text-text-subtle">is not linked yet</span>
            </div>
            <label className="mx-1 mb-1.5 flex h-9 items-center gap-2 rounded-md border border-border-default bg-surface-input px-2.5 text-text-subtle focus-within:border-accent/70">
              <Search className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span className="sr-only">Find an entity</span>
              <input autoFocus value={wbQuery} onChange={(e) => setWbQuery(e.target.value)} placeholder="Find an entity" className="min-w-0 flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-subtle focus:outline-none" />
            </label>
            <p className="px-2.5 pb-1 pt-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-text-subtle">Link to</p>
            <div role="menu" aria-label="Link to" className="custom-scrollbar flex max-h-44 flex-col overflow-y-auto">
              {wbMatches.map(e => {
                const m = entityTypeMeta(e.type);
                return (
                  <button key={e.id} type="button" role="menuitem" onClick={() => linkToEntity(e)} className="flex min-h-8 items-center gap-2.5 rounded-lg px-2.5 text-left text-sm text-text-primary hover:bg-surface-hover focus-visible:bg-surface-hover focus-visible:outline-none">
                    <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${m.dot}`} />
                    <span className="min-w-0 flex-1 truncate">{e.canonicalName}</span>
                    <span className="shrink-0 text-xs text-text-subtle">{m.label}</span>
                  </button>
                );
              })}
              {!wbMatches.length && <p className="px-2.5 py-1.5 text-xs text-text-subtle">{wbEntities.length ? 'No entity matches.' : 'No entities yet.'}</p>}
            </div>
            <MenuSeparator />
            <p className="px-2.5 pb-1.5 pt-0.5 text-xs font-semibold uppercase tracking-[0.08em] text-text-subtle">Or create as</p>
            <div className="grid grid-cols-2 gap-1 px-1 pb-1">
              {TYPE_ORDER.map(t => {
                const m = entityTypeMeta(t);
                return (
                  <button key={t} type="button" onClick={() => createEntityOfType(t)} className="flex h-8 min-w-0 items-center gap-2 rounded-md border border-border-subtle bg-tint/[0.03] px-2.5 text-left text-xs text-text-secondary transition-colors hover:bg-tint/[0.08] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                    <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${m.dot}`} />
                    <span className="truncate">{m.label}</span>
                  </button>
                );
              })}
            </div>
            <p className="px-2 pb-1 pt-1.5 text-xs text-text-subtle">Linking also teaches the tagger this spelling.</p>
          </div>
        ))}
      </Popover>

      {entityHover && (
        <div style={{ position: 'fixed', left: entityHover.x, top: entityHover.y - 8, transform: 'translate(-50%, -100%)', zIndex: 60 }} className="pointer-events-none">
          <div role="tooltip" className="flex items-center gap-2 whitespace-nowrap rounded-lg border border-border-default bg-surface-panel px-2.5 py-1.5 shadow-overlay">
            <span aria-hidden="true" className={`h-2 w-2 rounded-full ${entityTypeMeta(entityHover.type).dot}`} />
            <span className="text-sm font-semibold text-text-primary">{entityHover.name}</span>
            <span className="text-xs text-text-subtle">{entityTypeMeta(entityHover.type).label}</span>
          </div>
        </div>
      )}

      {invokeData && (
        <InvokeModal
          selection={invokeData.selection}
          profiles={profiles}
          initialChannel={lastChannel}
          directivesCount={directivesCount}
          onSubmit={submitInvoke}
          onClose={() => setInvokeData(null)}
        />
      )}

      <div data-writing-scroll-container className={`custom-scrollbar relative flex-1 px-4 py-7 ${inFlight ? 'overflow-hidden' : 'overflow-y-auto'}`}>
        <div
          className={`relative mx-auto rounded-xl shadow-[0_2rem_4rem_-1.5rem_color-mix(in_srgb,var(--theme-shade)_75%,transparent)] ring-1 ring-shade/30 ${locked ? 'wd-sheet-locked' : ''}`}
          style={sheetStyle}
        >
          <EditorContent editor={editor} />

        </div>

        {/* Floating review controls, pinned over the page. */}
        {pending && pending.channel !== 'analysis' && (
          <div className="pointer-events-none sticky bottom-4 z-20 mt-4 flex flex-col items-center gap-2">
            {pending.status === 'flagged' && !stale && (
              <div role="alert" className="pointer-events-auto flex max-w-md items-center gap-2 rounded-card border border-status-warning/30 bg-surface-panel/95 px-3.5 py-2.5 text-xs leading-relaxed text-status-warning shadow-overlay">
                <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
                The reply was cut off or malformed. Read it closely before accepting.
              </div>
            )}
            <div role="group" aria-label="Review suggestion" className="pointer-events-auto flex items-center gap-1.5 whitespace-nowrap rounded-full border border-border-default bg-surface-panel/95 py-1 pl-3 pr-1 shadow-overlay">
              {stale ? (
                <>
                  <CircleAlert className="h-4 w-4 text-status-danger" aria-hidden="true" />
                  <span className="text-xs text-text-secondary">This passage changed, so the suggestion no longer fits.</span>
                </>
              ) : (
                <>
                  <SuggestionPendingGlyph className="h-4 w-4" style={{ color: profileColor(pending.profileId) || undefined }} />
                  <span className="text-xs font-semibold text-text-primary">{profileName(pending.profileId)}</span>
                  <span className="text-xs text-text-subtle">· {CHANNEL_LABELS[pending.channel] || pending.channel}</span>
                  <span aria-hidden="true" className="mx-1 h-4 w-px bg-border-default" />
                  <span className="text-xs tabular-nums">
                    <span className="text-status-success">+{delta.added}</span>
                    {pending.channel !== 'insertion' && <span className="ml-1.5 text-status-danger">−{delta.removed}</span>}
                    <span className="ml-1 text-text-subtle">words</span>
                  </span>
                </>
              )}
              <span aria-hidden="true" className="mx-1 h-4 w-px bg-border-default" />
              {!stale && <WritingDiagnostics debug={pending.debug} tokenDebug={tokenDebug} ragDebug={ragDebug} align="left" />}
              <button type="button" onClick={rejectSuggestion} className="inline-flex h-8 items-center gap-1 rounded-full px-3 text-xs font-semibold text-text-secondary transition-colors hover:bg-tint/[0.08] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                <X className="h-3.5 w-3.5" aria-hidden="true" /> Reject
              </button>
              <button type="button" onClick={acceptSuggestion} disabled={stale} className="inline-flex h-8 items-center gap-1 rounded-full bg-accent px-3 text-xs font-semibold text-on-accent transition-[filter] hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                <Check className="h-3.5 w-3.5" aria-hidden="true" /> Accept
              </button>
            </div>
          </div>
        )}
      </div>

      {/* While the AI works, everything under the chapter header is grayed and inert until it returns. */}
      {inFlight && (
        <div data-keep-backdrop className="absolute inset-x-0 bottom-0 top-[3.25rem] z-30 flex cursor-not-allowed items-center justify-center bg-surface-canvas/35 p-6" style={{ backdropFilter: 'grayscale(0.9) blur(1px)' }}>
          <div role="status" className="flex w-[24rem] max-w-full items-start gap-3 rounded-card border border-border-default bg-surface-panel px-4 py-4 shadow-overlay">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent/[0.12] text-accent"><AiGlyph animated className="h-5 w-5" /></span>
            <span className="flex min-w-0 flex-col gap-1">
              <span className="text-sm font-semibold leading-snug text-text-primary">{profileName(inFlightProfileId)} is working on your selection</span>
              <span className="text-xs leading-relaxed text-text-muted">This chapter is locked until the result comes back. You can keep writing in other chapters.</span>
            </span>
          </div>
        </div>
      )}

      {/* Status bar: counts, then the chapter's word goal. */}
      <div className="ws-status glass-panel flex h-[2.125rem] shrink-0 items-center gap-4 border-t border-border-subtle px-4 text-xs text-text-subtle">
        <span className="tabular-nums"><b className="font-semibold text-text-secondary">{counts.words.toLocaleString()}</b> words</span>
        <span className="tabular-nums">{counts.chars.toLocaleString()} characters</span>
        {counts.words > 0 && <span className="tabular-nums">About {estimatePagesFromWords(counts.words, pageConfig)} {estimatePagesFromWords(counts.words, pageConfig) === 1 ? 'page' : 'pages'}</span>}
        <span className="flex-1" />
        <button
          type="button"
          ref={goalRef}
          aria-haspopup="dialog"
          aria-expanded={goalOpen}
          onClick={() => { setGoalDraft(goal ? String(goal) : ''); setGoalOpen(v => !v); }}
          className="inline-flex h-6 items-center gap-2 rounded-md px-2 text-xs text-text-muted transition-colors hover:bg-tint/5 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <Target className="h-3.5 w-3.5" aria-hidden="true" />
          {goal > 0 ? (
            <>
              <span className="tabular-nums">{counts.words.toLocaleString()} of {goal.toLocaleString()}</span>
              <span aria-hidden="true" className="block h-1 w-24 overflow-hidden rounded-full bg-tint/10">
                <span className={`block h-full rounded-full ${goalPct >= 100 ? 'bg-status-success' : 'bg-text-secondary'}`} style={{ width: `${goalPct}%` }} />
              </span>
              <span className="tabular-nums text-text-secondary">{goalPct}%</span>
            </>
          ) : 'Set a word goal'}
        </button>
        <Popover anchorRef={goalRef} open={goalOpen} onClose={() => setGoalOpen(false)} matchAnchorWidth={false} align="right" scroll={false} className="w-60 !p-3" role="dialog">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-text-secondary">Word goal for this chapter</span>
            <input
              autoFocus
              type="number"
              min="0"
              value={goalDraft}
              onChange={(e) => setGoalDraft(e.target.value.replace(/[^0-9]/g, ''))}
              onKeyDown={(e) => { if (e.key === 'Enter') saveGoal(goalDraft); }}
              placeholder="1200"
              className="h-9 w-full rounded-md border border-border-default bg-surface-input px-2.5 text-sm tabular-nums text-text-primary focus:border-accent/70 focus:outline-none"
            />
          </label>
          <div className="mt-3 flex justify-end gap-2">
            {goal > 0 && <Button variant="subtle" size="sm" onClick={() => saveGoal(0)}>Remove goal</Button>}
            <Button size="sm" onClick={() => saveGoal(goalDraft)}>Save</Button>
          </div>
        </Popover>
      </div>
    </div>
  );
}
