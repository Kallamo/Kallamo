import React, { useEffect, useRef, useState, useReducer, useCallback } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import {
  Bold, Italic, Underline, Strikethrough, Heading1, Heading2, Heading3, List, ListOrdered,
  Quote, Palette, FileOutput, ChevronDown, Search, Check, Table as TableIcon,
  Rows, Columns, Trash2, Combine,
  ArrowUpToLine, ArrowDownToLine, ArrowLeftToLine, ArrowRightToLine,
  AlignLeft, AlignCenter, AlignRight, AlignJustify, ALargeSmall, AlignVerticalSpaceAround, Pilcrow, Plus, FileCog
} from 'lucide-react';
import ColorPicker from './ui/ColorPicker';
import Button from './ui/Button';
import WritingPageModal from './WritingPageModal';
import ExportModal from './ExportModal';
import { getEditorExtensions } from './writingExtensions';
import { computePageLayout } from './writingPagination';

export const PAPER_THEMES = [
  { label: 'Light', color: '#ffffff' },
  { label: 'Sepia', color: '#f4ecd8' },
  { label: 'Gray', color: '#e8e8e8' },
  { label: 'Dark', color: '#222428' },
];

const TEXT_SWATCHES = [
  '#111111', '#374151', '#6b7280', '#e5e7eb',
  '#ef4444', '#f59e0b', '#eab308', '#10b981',
  '#3b82f6', '#6366f1', '#8b5cf6', '#ec4899',
];

const DEFAULT_FONT = 'Arial';

// The font picker is driven entirely by the user's installed system fonts
// (queryLocalFonts). Arial is the fallback when system fonts are unavailable.
const FONT_OPTIONS = [];
const FONT_FALLBACK = [{ label: 'Arial', value: 'Arial' }];

const LINE_HEIGHTS = ['1', '1.15', '1.5', '1.6', '2', '2.5'];
const FONT_SIZES = ['10', '11', '12', '14', '16', '18', '20', '24', '28', '32', '36', '48', '72'];
const PARAGRAPH_SPACINGS = ['0', '4', '8', '12', '16', '24', '32'];
// Standardized heading sizes (px); kept in sync with the .writing-prose h1/h2/h3 CSS.
const HEADING_SIZES = { 1: 28, 2: 20, 3: 16 };

const RECENT_COLORS_KEY = 'wd-recent-colors';
function readRecentColors() {
  try { return JSON.parse(localStorage.getItem(RECENT_COLORS_KEY)) || []; } catch { return []; }
}
function useRecentColors() {
  const [colors, setColors] = useState(readRecentColors);
  const add = (hex) => setColors(prev => {
    const next = [hex, ...prev.filter(c => c.toLowerCase() !== hex.toLowerCase())].slice(0, 5);
    localStorage.setItem(RECENT_COLORS_KEY, JSON.stringify(next));
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
  return system.length ? [...FONT_OPTIONS, ...system] : FONT_FALLBACK;
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

// Geometry the pagination plugin needs: usable content height per page + margins.
function pageGeometry(cfg) {
  const mTop = cfg.marginTop ?? 96;
  const mBottom = cfg.marginBottom ?? 96;
  return {
    pageContentHeight: (cfg.pageHeight || 1123) - mTop - mBottom,
    marginTop: mTop,
    marginBottom: mBottom,
    marginLeft: cfg.marginLeft ?? 96,
    marginRight: cfg.marginRight ?? 96,
  };
}

// Relative luminance check so prose text contrasts the paper color.
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
    const onChange = () => force();
    editor.on('selectionUpdate', onChange);
    editor.on('transaction', onChange);
    return () => {
      editor.off('selectionUpdate', onChange);
      editor.off('transaction', onChange);
    };
  }, [editor]);
}

// Dismiss a popover when clicking outside its container or pressing Escape.
function useDismiss(ref, onDismiss, active) {
  useEffect(() => {
    if (!active) return;
    const onDown = (e) => { if (ref.current && !ref.current.contains(e.target)) onDismiss(); };
    const onKey = (e) => { if (e.key === 'Escape') onDismiss(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [ref, onDismiss, active]);
}

function ToolbarButton({ active, onClick, title, children }) {
  return (
    <button
      type="button"
      onMouseDown={(e) => { e.preventDefault(); onClick(); }}
      title={title}
      className={`p-1.5 rounded-md transition-colors cursor-pointer ${active
        ? 'bg-accent text-[#011419]'
        : 'text-gray-400 hover:text-white hover:bg-white/5'}`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <span className="w-px h-5 bg-gray-800 mx-1" />;
}

// Searchable font picker: type to filter, or scroll the full list.
function FontPicker({ editor, baseFont }) {
  const fontOptions = useFontOptions();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);
  useDismiss(ref, () => { setOpen(false); setQuery(''); }, open);

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
    setOpen(false);
    setQuery('');
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); setOpen(o => !o); }}
        title="Font"
        className="flex items-center gap-1 text-gray-300 text-xs rounded-md px-2 py-1.5 border border-gray-800 hover:border-gray-700 cursor-pointer min-w-[110px] max-w-[150px]"
      >
        <span className="truncate" style={{ fontFamily: current || undefined }}>{currentLabel}</span>
        <ChevronDown className="w-3.5 h-3.5 ml-auto shrink-0 text-gray-500" />
      </button>
      {open && (
        <div className="absolute z-40 mt-1 w-56 bg-[#0a161d] border border-gray-800 rounded-lg shadow-2xl overflow-hidden">
          <div className="flex items-center gap-1.5 px-2.5 py-2 border-b border-gray-800/80">
            <Search className="w-3.5 h-3.5 text-gray-500 shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search fonts"
              className="bg-transparent text-xs text-gray-200 w-full focus:outline-none placeholder-gray-600"
            />
          </div>
          <div className="max-h-64 overflow-y-auto custom-scrollbar py-1">
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-xs text-gray-600">No matching fonts</p>
            )}
            {filtered.map((f, i) => (
              <button
                key={`${f.label}-${i}`}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); choose(f.value); }}
                className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-white/5 ${f.value === current ? 'text-accent' : 'text-gray-300'}`}
                style={{ fontFamily: f.value || undefined }}
              >
                <span className="truncate flex-1">{f.label}</span>
                {f.value === current && <Check className="w-3.5 h-3.5 shrink-0" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Font size: a preset dropdown plus a type-to-set field. Presets apply via onMouseDown so the
// editor never blurs and the text selection stays visible while picking.
function FontSizeControl({ editor, baseSize }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  useDismiss(ref, () => { setOpen(false); setText(''); }, open);
  const inline = editor.getAttributes('textStyle').fontSize;
  const headingLevel = editor.getAttributes('heading')?.level;
  const value = inline ? parseInt(inline, 10) : (HEADING_SIZES[headingLevel] || baseSize || 14);
  // Setting an explicit size leaves a heading preset, so demote it to a paragraph first.
  const apply = (n) => {
    const size = Math.max(8, Math.min(200, n || 0));
    if (!size) return;
    const chain = editor.chain().focus();
    if (editor.isActive('heading')) chain.setParagraph();
    chain.setFontSize(`${size}px`).run();
    setOpen(false); setText('');
  };
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); setOpen(o => !o); }}
        title="Font size"
        className="flex items-center gap-1 text-gray-300 text-xs rounded-md pl-1.5 pr-1 py-1.5 border border-gray-800 hover:border-gray-700 cursor-pointer"
      >
        <ALargeSmall className="w-4 h-4 text-gray-500 shrink-0" />
        {value}<span className="text-[10px] text-gray-500">px</span>
        <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
      </button>
      {open && (
        <div className="absolute z-40 mt-1 w-20 bg-[#0a161d] border border-gray-800 rounded-lg shadow-2xl py-1">
          <input
            value={text}
            inputMode="numeric"
            placeholder={String(value)}
            onChange={(e) => setText(e.target.value.replace(/[^0-9]/g, ''))}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); apply(parseInt(text, 10)); } }}
            className="w-full bg-[#00080B] border border-gray-800 text-gray-200 text-xs rounded-md px-2 py-1 mb-1 focus:outline-none focus:border-accent text-center"
          />
          <div className="max-h-52 overflow-y-auto custom-scrollbar">
            {FONT_SIZES.map(s => (
              <button
                key={s}
                type="button"
                onMouseDown={(e) => { e.preventDefault(); apply(parseInt(s, 10)); }}
                className={`w-full text-center px-3 py-1.5 text-xs hover:bg-white/5 ${value === parseInt(s, 10) ? 'text-accent' : 'text-gray-300'}`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// Reads a block-level (paragraph/heading) attribute from whichever block holds the cursor.
function blockAttr(editor, key) {
  return editor.getAttributes('paragraph')[key] || editor.getAttributes('heading')[key] || null;
}

function LineHeightControl({ editor, baseLineHeight }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  useDismiss(ref, () => setOpen(false), open);
  const current = blockAttr(editor, 'lineHeight') || String(baseLineHeight || 1.6);
  const choose = (v) => { editor.chain().focus().setLineHeight(v).run(); setOpen(false); };
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); setOpen(o => !o); }}
        title="Line spacing"
        className="flex items-center gap-1 text-gray-300 text-xs rounded-md pl-1.5 pr-1 py-1.5 border border-gray-800 hover:border-gray-700 cursor-pointer"
      >
        <AlignVerticalSpaceAround className="w-4 h-4 text-gray-500" />
        {parseFloat(current)}
        <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
      </button>
      {open && (
        <div className="absolute z-40 mt-1 w-24 bg-[#0a161d] border border-gray-800 rounded-lg shadow-2xl py-1">
          {LINE_HEIGHTS.map(v => (
            <button
              key={v}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); choose(v); }}
              className={`w-full text-left px-3 py-1.5 text-xs hover:bg-white/5 ${parseFloat(current) === parseFloat(v) ? 'text-accent' : 'text-gray-300'}`}
            >
              {v}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ParagraphSpacingControl({ editor, baseSpacing }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  useDismiss(ref, () => setOpen(false), open);
  const current = blockAttr(editor, 'paragraphSpacing');
  const value = current ? parseInt(current, 10) : (baseSpacing ?? 12);
  const choose = (v) => { editor.chain().focus().setParagraphSpacing(`${v}px`).run(); setOpen(false); };
  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); setOpen(o => !o); }}
        title="Paragraph spacing"
        className="flex items-center gap-1 text-gray-300 text-xs rounded-md pl-1.5 pr-1 py-1.5 border border-gray-800 hover:border-gray-700 cursor-pointer"
      >
        <Pilcrow className="w-4 h-4 text-gray-500" />
        {value}<span className="text-[10px] text-gray-500">px</span>
        <ChevronDown className="w-3.5 h-3.5 text-gray-500" />
      </button>
      {open && (
        <div className="absolute z-40 mt-1 w-20 bg-[#0a161d] border border-gray-800 rounded-lg shadow-2xl py-1">
          {PARAGRAPH_SPACINGS.map(v => (
            <button
              key={v}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); choose(parseInt(v, 10)); }}
              className={`w-full text-center px-3 py-1.5 text-xs hover:bg-white/5 ${value === parseInt(v, 10) ? 'text-accent' : 'text-gray-300'}`}
            >
              {v}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function ColorPopover({ editor }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [draft, setDraft] = useState('#cccccc');
  const [recent, addRecent] = useRecentColors();
  useDismiss(ref, () => { setOpen(false); setShowPicker(false); }, open);
  const current = editor.getAttributes('textStyle').color || '';
  const apply = (c) => editor.chain().focus().setColor(c).run();

  const openPicker = () => { setDraft(current || '#cccccc'); setShowPicker(true); };
  // Only on confirm does the picked color land in the customs row and the window close.
  const confirmPicker = () => { addRecent(draft); apply(draft); setShowPicker(false); };

  const Swatch = ({ c }) => (
    <button
      type="button"
      title={c}
      onMouseDown={(e) => { e.preventDefault(); apply(c); }}
      className={`w-5 h-5 rounded-full border ${current.toLowerCase() === c.toLowerCase() ? 'border-accent ring-1 ring-accent' : 'border-gray-700'}`}
      style={{ backgroundColor: c }}
    />
  );

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onMouseDown={(e) => { e.preventDefault(); setOpen(o => !o); }}
        title="Text color"
        className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer flex flex-col items-center"
      >
        <Palette className="w-4 h-4" />
        <span className="block w-4 h-1 rounded-sm mt-0.5" style={{ backgroundColor: current || '#9ca3af' }} />
      </button>
      {open && (
        <div className="absolute z-40 mt-1 w-52 p-3 bg-[#0a161d] border border-gray-800 rounded-lg shadow-2xl">
          <div className="grid grid-cols-6 gap-1.5">
            {TEXT_SWATCHES.map(c => <Swatch key={c} c={c} />)}
          </div>

          <div className="flex items-center justify-between gap-2 mt-3 pt-2.5 border-t border-gray-800">
            <span className="text-[11px] font-bold text-gray-300">Custom</span>
            <button
              type="button"
              onMouseDown={(e) => { e.preventDefault(); openPicker(); }}
              className="text-[11px] font-semibold text-accent hover:brightness-110 flex items-center gap-0.5"
            >
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          </div>

          {recent.length > 0 && (
            <div className="flex items-center gap-1.5 mt-2.5">
              {recent.map(c => <Swatch key={c} c={c} />)}
            </div>
          )}

          {showPicker && (
            <div className="absolute left-full top-0 ml-2 w-52 p-3 bg-[#0a161d] border border-gray-800 rounded-lg shadow-2xl">
              <ColorPicker value={draft} onChange={setDraft} />
              <div className="flex justify-end gap-2 mt-3">
                <Button variant="ghost" size="sm" onMouseDown={(e) => { e.preventDefault(); setShowPicker(false); }}>Cancel</Button>
                <Button variant="primary" size="sm" onMouseDown={(e) => { e.preventDefault(); confirmPicker(); }}>Confirm</Button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

const ALIGNMENTS = [
  { value: 'left', icon: AlignLeft, title: 'Align left' },
  { value: 'center', icon: AlignCenter, title: 'Align center' },
  { value: 'right', icon: AlignRight, title: 'Align right' },
  { value: 'justify', icon: AlignJustify, title: 'Justify' },
];

function Toolbar({ editor, pageConfig }) {
  useToolbarTick(editor);
  if (!editor) return null;
  const activeAlign = ALIGNMENTS.find(a => editor.isActive({ textAlign: a.value }))?.value || 'left';
  return (
    <div className="flex items-center gap-0.5 flex-wrap">
      <ToolbarButton active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold"><Bold className="w-4 h-4" /></ToolbarButton>
      <ToolbarButton active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic"><Italic className="w-4 h-4" /></ToolbarButton>
      <ToolbarButton active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()} title="Underline"><Underline className="w-4 h-4" /></ToolbarButton>
      <ToolbarButton active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough"><Strikethrough className="w-4 h-4" /></ToolbarButton>
      <ColorPopover editor={editor} />
      <Divider />
      <FontPicker editor={editor} baseFont={pageConfig?.defaultFont} />
      <FontSizeControl editor={editor} baseSize={pageConfig?.defaultFontSize} />
      <LineHeightControl editor={editor} baseLineHeight={pageConfig?.lineHeight} />
      <ParagraphSpacingControl editor={editor} baseSpacing={pageConfig?.paragraphSpacing} />
      <Divider />
      {[1, 2, 3].map(level => {
        const Icon = { 1: Heading1, 2: Heading2, 3: Heading3 }[level];
        return (
          <ToolbarButton
            key={level}
            active={editor.isActive('heading', { level })}
            // Standardized heading (CSS-driven size + weight): clear any inline font size so the preset shows.
            onClick={() => editor.chain().focus().unsetFontSize().toggleHeading({ level }).run()}
            title={`Heading ${level}`}
          >
            <Icon className="w-4 h-4" />
          </ToolbarButton>
        );
      })}
      <Divider />
      {ALIGNMENTS.map(a => (
        <ToolbarButton key={a.value} active={activeAlign === a.value} onClick={() => editor.chain().focus().setTextAlign(a.value).run()} title={a.title}>
          <a.icon className="w-4 h-4" />
        </ToolbarButton>
      ))}
      <Divider />
      <ToolbarButton active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list"><List className="w-4 h-4" /></ToolbarButton>
      <ToolbarButton active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list"><ListOrdered className="w-4 h-4" /></ToolbarButton>
      <ToolbarButton active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Quote"><Quote className="w-4 h-4" /></ToolbarButton>
      <Divider />
      <ToolbarButton active={editor.isActive('table')} onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} title="Insert table"><TableIcon className="w-4 h-4" /></ToolbarButton>
    </div>
  );
}

const CELL_SWATCHES = ['#fde68a', '#fca5a5', '#86efac', '#93c5fd', '#d8b4fe', '#f9a8d4', '#e5e7eb', '#9ca3af'];

// Cell background color: swatches + custom picker + clear. Font color stays on
// the main toolbar; this only fills the selected cell(s).
function CellColorControl({ editor }) {
  const [showPicker, setShowPicker] = useState(false);
  const [draft, setDraft] = useState('#fde68a');
  const apply = (color) => editor.chain().focus().setCellBackground(color).run();
  return (
    <div className="flex items-center gap-1 px-0.5 relative">
      <span className="text-[10px] text-gray-500 uppercase tracking-wider mr-1">Cell</span>
      {CELL_SWATCHES.map(c => (
        <button key={c} type="button" title={c}
          onMouseDown={(e) => { e.preventDefault(); apply(c); }}
          className="w-4 h-4 rounded-sm border border-black/20 cursor-pointer hover:scale-110 transition-transform"
          style={{ backgroundColor: c }} />
      ))}
      <button type="button" title="Custom color"
        onMouseDown={(e) => { e.preventDefault(); setShowPicker(s => !s); }}
        className={`w-4 h-4 rounded-sm border cursor-pointer ${showPicker ? 'border-accent' : 'border-gray-600'}`}
        style={{ background: 'conic-gradient(red, yellow, lime, aqua, blue, magenta, red)' }} />
      <button type="button" title="Clear fill"
        onMouseDown={(e) => { e.preventDefault(); apply(null); }}
        className="text-[10px] text-gray-500 hover:text-white ml-0.5">Clear</button>
      {showPicker && (
        <div className="absolute top-full left-0 mt-2 z-50 w-52 p-3 bg-[#0a161d] border border-gray-800 rounded-lg shadow-2xl">
          <ColorPicker value={draft} onChange={setDraft} />
          <div className="flex justify-end gap-2 mt-3">
            <Button variant="ghost" size="sm" onMouseDown={(e) => { e.preventDefault(); setShowPicker(false); }}>Cancel</Button>
            <Button variant="primary" size="sm" onMouseDown={(e) => { e.preventDefault(); apply(draft); setShowPicker(false); }}>Apply</Button>
          </div>
        </div>
      )}
    </div>
  );
}

// Floating panel shown when the cursor is inside a table — structure ops + cell fill.
function TableBubble({ editor }) {
  useToolbarTick(editor);
  if (!editor) return null;
  return (
    <BubbleMenu
      editor={editor}
      pluginKey="tableBubble"
      shouldShow={({ editor }) => editor.isActive('table')}
      updateDelay={0}
      className="flex flex-col gap-2 bg-[#0a161d] border border-gray-800 rounded-lg p-2 shadow-2xl"
    >
      <div className="flex items-center gap-0.5">
        <ToolbarButton onClick={() => editor.chain().focus().addRowBefore().run()} title="Row above"><ArrowUpToLine className="w-4 h-4" /></ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().addRowAfter().run()} title="Row below"><ArrowDownToLine className="w-4 h-4" /></ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().addColumnBefore().run()} title="Column left"><ArrowLeftToLine className="w-4 h-4" /></ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().addColumnAfter().run()} title="Column right"><ArrowRightToLine className="w-4 h-4" /></ToolbarButton>
        <Divider />
        <ToolbarButton onClick={() => editor.chain().focus().toggleHeaderRow().run()} title="Toggle header row"><Rows className="w-4 h-4" /></ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().mergeOrSplit().run()} title="Merge / split cells"><Combine className="w-4 h-4" /></ToolbarButton>
        <Divider />
        <ToolbarButton onClick={() => editor.chain().focus().deleteRow().run()} title="Delete row"><Rows className="w-4 h-4 text-red-400" /></ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().deleteColumn().run()} title="Delete column"><Columns className="w-4 h-4 text-red-400" /></ToolbarButton>
        <ToolbarButton onClick={() => editor.chain().focus().deleteTable().run()} title="Delete table"><Trash2 className="w-4 h-4 text-red-400" /></ToolbarButton>
      </div>
      <CellColorControl editor={editor} />
    </BubbleMenu>
  );
}

function countWords(text) {
  const t = (text || '').trim();
  return t ? t.split(/\s+/).length : 0;
}

export default function WritingEditor({ doc, electronAPI, toolbarMode = 'fixed', smartTypography = true, onDocPatch, onRename }) {
  const saveTimer = useRef(null);
  const [counts, setCounts] = useState({ words: 0, chars: 0 });
  const [showExport, setShowExport] = useState(false);
  const [showPageSetup, setShowPageSetup] = useState(false);
  const [title, setTitle] = useState(doc.title);
  const [pageLayout, setPageLayout] = useState({ pages: 1, lines: [] });
  const pageConfig = pageConfigFromDoc(doc);

  // Latest geometry for pagination measurement (ref avoids stale closures).
  const geomRef = useRef(pageGeometry(pageConfig));
  geomRef.current = pageGeometry(pageConfig);
  const measureRafRef = useRef(null);

  useEffect(() => { setTitle(doc.title); }, [doc.id]);

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
      scheduleMeasure();
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        electronAPI.saveDocumentContent(doc.id, JSON.stringify(editor.getJSON()));
      }, 800);
    },
  }, [doc.id, smartTypography]);

  // rAF-debounced pagination measurement. Pure measurement → React state; never
  // touches the document or decorations (that approach crashed PM + tables).
  const scheduleMeasure = useCallback(() => {
    if (measureRafRef.current != null) return;
    measureRafRef.current = requestAnimationFrame(() => {
      measureRafRef.current = null;
      if (!editor || editor.isDestroyed) return;
      const h = editor.view.dom.scrollHeight;
      setPageLayout(computePageLayout(h, geomRef.current));
    });
  }, [editor]);

  useEffect(() => {
    if (!editor) return;
    const text = editor.getText();
    setCounts({ words: countWords(text), chars: text.length });
  }, [editor, doc.id]);

  // Measure when ready and whenever the page geometry changes; also re-measure on
  // content resize, web-font load, and window resize (layout settling).
  useEffect(() => {
    if (!editor) return;
    scheduleMeasure();
    const dom = editor.view.dom;
    const ro = new ResizeObserver(() => scheduleMeasure());
    ro.observe(dom);
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(scheduleMeasure);
    window.addEventListener('resize', scheduleMeasure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', scheduleMeasure);
      if (measureRafRef.current != null) cancelAnimationFrame(measureRafRef.current);
    };
  }, [editor, scheduleMeasure, pageConfig.pageHeight, pageConfig.marginTop, pageConfig.marginBottom, pageConfig.pageWidth]);

  // Flush a pending save when switching documents or unmounting.
  useEffect(() => {
    return () => {
      if (saveTimer.current) {
        clearTimeout(saveTimer.current);
        if (editor) {
          electronAPI.saveDocumentContent(doc.id, JSON.stringify(editor.getJSON()));
        }
      }
    };
  }, [doc.id, editor]);

  // Text color adapts to the paper so it stays readable on any sheet color.
  const effectiveBg = pageConfig.sheetColor || '#ffffff';
  const pageW = pageConfig.pageWidth || 794;
  const pageH = pageConfig.pageHeight || 1123;
  const mT = pageConfig.marginTop ?? 96;
  const mB = pageConfig.marginBottom ?? 96;
  const mL = pageConfig.marginLeft ?? 96;
  const mR = pageConfig.marginRight ?? 96;

  // The content sits transparently on top of a stack of white "page" rectangles
  // One continuous white sheet; page boundaries are drawn as overlay markers.
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

  const goalPct = doc.wordGoal > 0 ? Math.min(100, Math.round((counts.words / doc.wordGoal) * 100)) : 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Title bar — always visible (incl. bubble mode) so Export/Page Setup never disappear. */}
      <div className="flex items-center justify-between gap-3 px-5 py-3 border-b border-gray-800/80 bg-[#011419]/35 shrink-0">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onBlur={() => onRename?.(title)}
          className="bg-transparent text-white font-semibold text-sm focus:outline-none flex-1 min-w-0"
          placeholder="Untitled"
        />
        <div className="flex items-center gap-0.5 shrink-0">
          <button type="button" onClick={() => setShowExport(true)} title="Export…" className="p-1.5 rounded-md text-gray-500 hover:text-white hover:bg-white/5 transition-colors cursor-pointer">
            <FileOutput className="w-4 h-4" />
          </button>
          <button type="button" onClick={() => setShowPageSetup(true)} title="Page setup" className={`p-1.5 rounded-md transition-colors cursor-pointer ${showPageSetup ? 'text-accent bg-white/5' : 'text-gray-500 hover:text-white hover:bg-white/5'}`}>
            <FileCog className="w-4 h-4" />
          </button>
        </div>
      </div>
      {toolbarMode === 'fixed' && (
        <div className="flex items-center gap-3 px-5 py-2.5 border-b border-gray-800/80 bg-[#011419]/35 shrink-0">
          <Toolbar editor={editor} pageConfig={pageConfig} />
        </div>
      )}

      {showPageSetup && (
        <WritingPageModal config={pageConfig} onChange={onDocPatch} onClose={() => setShowPageSetup(false)} />
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
        <BubbleMenu editor={editor} shouldShow={({ editor, state }) => !state.selection.empty && !editor.isActive('table')} className="flex items-center gap-0.5 bg-[#0a161d] border border-gray-800 rounded-lg px-1.5 py-1 shadow-xl">
          <Toolbar editor={editor} pageConfig={pageConfig} />
        </BubbleMenu>
      )}

      {editor && <TableBubble editor={editor} />}

      <div className="flex-1 overflow-y-auto custom-scrollbar py-8 px-4">
        <div className="mx-auto relative rounded-xl shadow-xl ring-1 ring-black/10" style={sheetStyle}>
          <EditorContent editor={editor} />
          {/* Page-boundary markers overlaid on the continuous sheet (visual only). */}
          <div className="absolute inset-0 pointer-events-none" aria-hidden>
            {pageLayout.lines.map((y, k) => (
              <div key={k} className="absolute left-0 right-0 flex items-center" style={{ top: `${y}px` }}>
                <div className="flex-1 border-t border-dashed border-black/15" />
                <span className="px-2 text-[10px] text-black/30 select-none">{k + 2}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Status bar: live word/char count + per-chapter word goal */}
      <div className="flex items-center gap-4 px-5 py-1.5 border-t border-gray-800/80 bg-[#011419]/35 text-[11px] text-gray-500 shrink-0">
        <span>{counts.words.toLocaleString()} words</span>
        <span>{counts.chars.toLocaleString()} chars</span>
        <span>{pageLayout.pages} {pageLayout.pages === 1 ? 'page' : 'pages'}</span>
        <label className="flex items-center gap-1.5 ml-auto" title="Word goal for this chapter (0 = none)">
          Goal
          <input
            type="number"
            min="0"
            value={doc.wordGoal || 0}
            onChange={(e) => onDocPatch?.({ wordGoal: parseInt(e.target.value, 10) || 0 })}
            className="w-16 bg-[#011419] text-gray-300 rounded-md px-1.5 py-0.5 border border-gray-800 focus:outline-none focus:border-accent text-right no-spinner"
          />
        </label>
        {doc.wordGoal > 0 && (
          <div className="w-28 h-1.5 rounded-full bg-gray-800 overflow-hidden">
            <div className="h-full bg-accent transition-all" style={{ width: `${goalPct}%` }} />
          </div>
        )}
        {doc.wordGoal > 0 && <span className="text-gray-400">{goalPct}%</span>}
      </div>
    </div>
  );
}
