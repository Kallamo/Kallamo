import React, { useEffect, useRef, useState, useReducer } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import { Extension } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle, Color, FontFamily, FontSize } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import {
  Bold, Italic, Strikethrough, Heading1, Heading2, Heading3, List, ListOrdered,
  Quote, Palette, FileDown, FileText, ChevronDown, Search, Check,
  AlignLeft, AlignCenter, AlignRight, AlignJustify, ALargeSmall, AlignVerticalSpaceAround, Pilcrow, Plus, FileCog
} from 'lucide-react';
import ColorPicker from './ui/ColorPicker';
import Button from './ui/Button';
import WritingPageModal from './WritingPageModal';

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

const DEFAULT_FONT = 'Georgia, serif';

const FONT_OPTIONS = [
  { label: 'Serif', value: 'Georgia, serif' },
  { label: 'Sans', value: 'Inter, system-ui, sans-serif' },
  { label: 'Mono', value: 'monospace' },
];

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

// Line height and paragraph spacing as block-level attributes on paragraphs/headings.
// (The text-style LineHeight applies to inline spans, which doesn't space whole lines.)
const BLOCK_TYPES = ['paragraph', 'heading'];
const BlockStyle = Extension.create({
  name: 'blockStyle',
  addGlobalAttributes() {
    return [{
      types: BLOCK_TYPES,
      attributes: {
        lineHeight: {
          default: null,
          parseHTML: el => el.style.lineHeight || null,
          renderHTML: attrs => (attrs.lineHeight ? { style: `line-height: ${attrs.lineHeight}` } : {}),
        },
        paragraphSpacing: {
          default: null,
          parseHTML: el => el.style.marginBottom || null,
          renderHTML: attrs => (attrs.paragraphSpacing ? { style: `margin-bottom: ${attrs.paragraphSpacing}` } : {}),
        },
      },
    }];
  },
  addCommands() {
    const setAttr = (key) => (value) => ({ chain }) => {
      let c = chain().focus();
      BLOCK_TYPES.forEach(t => { c = c.updateAttributes(t, { [key]: value }); });
      return c.run();
    };
    return { setLineHeight: setAttr('lineHeight'), setParagraphSpacing: setAttr('paragraphSpacing') };
  },
});

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
  return system.length ? [...FONT_OPTIONS, ...system] : FONT_OPTIONS;
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
            <div className="flex items-center gap-3">
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); openPicker(); }}
                className="text-[11px] font-semibold text-accent hover:brightness-110 flex items-center gap-0.5"
              >
                <Plus className="w-3.5 h-3.5" /> Add
              </button>
              <button
                type="button"
                onMouseDown={(e) => { e.preventDefault(); editor.chain().focus().unsetColor().run(); }}
                className="text-[11px] text-gray-500 hover:text-white"
              >
                Reset
              </button>
            </div>
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
    </div>
  );
}

// Margins are applied by the exporter (printToPDF / html-to-docx), not baked into the
// CSS here, to avoid doubling them. Inline formatting (font, size, color, alignment)
// travels with the editor HTML; this only sets the document baseline.
function buildExportHtml(editor, page) {
  const body = editor.getHTML();
  const fontFamily = page.defaultFont || 'Georgia, serif';
  const fontSize = page.defaultFontSize || 18;
  const lineHeight = page.lineHeight || 1.6;
  const para = page.paragraphSpacing ?? 12;
  const indent = page.firstLineIndent ?? 0;
  let sizeCss = 'A4';
  if (page.pageSize === 'Letter') sizeCss = 'Letter';
  else if (page.pageSize === 'Custom' && page.pageWidth && page.pageHeight) sizeCss = `${page.pageWidth}px ${page.pageHeight}px`;
  if (page.orientation === 'landscape' && (page.pageSize === 'A4' || page.pageSize === 'Letter')) sizeCss += ' landscape';
  const css = `
    @page { size: ${sizeCss}; margin: 0; }
    body { font-family: ${fontFamily}; font-size: ${fontSize}px; line-height: ${lineHeight}; color: #111; margin: 0; }
    p { margin: 0 0 ${para}px; text-indent: ${indent}px; }
    h1 { font-size: 28px; font-weight: 700; margin: 0.6em 0 0.4em; }
    h2 { font-size: 20px; font-weight: 700; margin: 0.6em 0 0.4em; }
    h3 { font-size: 16px; font-weight: 700; margin: 0.6em 0 0.3em; }
    ul { padding-left: 1.5em; margin: 0 0 ${para}px; }
    ol { padding-left: 1.5em; margin: 0 0 ${para}px; }
    blockquote { border-left: 3px solid rgba(0,0,0,0.25); padding-left: 1em; margin: 0 0 ${para}px; font-style: italic; }
    hr { border: none; border-top: 1px solid rgba(0,0,0,0.25); margin: 1.2em 0; }
    code { font-family: monospace; font-size: 0.9em; }
  `;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${body}</body></html>`;
}

function countWords(text) {
  const t = (text || '').trim();
  return t ? t.split(/\s+/).length : 0;
}

export default function WritingEditor({ doc, electronAPI, toolbarMode = 'fixed', onDocPatch }) {
  const saveTimer = useRef(null);
  const [counts, setCounts] = useState({ words: 0, chars: 0 });
  const [exporting, setExporting] = useState(false);
  const [showPageSetup, setShowPageSetup] = useState(false);
  const pageConfig = pageConfigFromDoc(doc);

  let initialContent;
  try {
    initialContent = doc.content ? JSON.parse(doc.content) : undefined;
  } catch (e) {
    initialContent = undefined;
  }

  const editor = useEditor({
    extensions: [
      StarterKit,
      TextStyle, Color, FontFamily, FontSize, BlockStyle,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
    ],
    content: initialContent,
    editorProps: {
      attributes: {
        class: 'writing-prose focus:outline-none min-h-[60vh]',
      },
    },
    onUpdate: ({ editor }) => {
      const text = editor.getText();
      setCounts({ words: countWords(text), chars: text.length });
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        electronAPI.saveDocumentContent(doc.id, JSON.stringify(editor.getJSON()));
      }, 800);
    },
  }, [doc.id]);

  useEffect(() => {
    if (!editor) return;
    const text = editor.getText();
    setCounts({ words: countWords(text), chars: text.length });
  }, [editor, doc.id]);

  const exportAs = async (kind) => {
    if (!editor || exporting) return;
    setExporting(true);
    try {
      const html = buildExportHtml(editor, pageConfig);
      const margins = {
        top: pageConfig.marginTop ?? 96, right: pageConfig.marginRight ?? 96,
        bottom: pageConfig.marginBottom ?? 96, left: pageConfig.marginLeft ?? 96,
      };
      const payload = { html, title: doc.title, pageSize: pageConfig.pageSize, pageWidth: pageConfig.pageWidth, pageHeight: pageConfig.pageHeight, margins };
      if (kind === 'pdf') await electronAPI.exportDocumentPdf(payload);
      else await electronAPI.exportDocumentDocx(payload);
    } finally {
      setExporting(false);
    }
  };

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

  // Text color adapts to the paper so it stays readable on any sheet color. Paragraph
  // spacing and indent ride on CSS variables consumed by .writing-prose.
  const effectiveBg = pageConfig.sheetColor || '#ffffff';
  const sheetStyle = {
    backgroundColor: effectiveBg,
    color: isLightColor(effectiveBg) ? '#1f2328' : '#e5e7eb',
    fontFamily: pageConfig.defaultFont || undefined,
    fontSize: `${pageConfig.defaultFontSize || 18}px`,
    lineHeight: pageConfig.lineHeight || 1.6,
    width: `${pageConfig.pageWidth || 794}px`,
    minHeight: `${pageConfig.pageHeight || 1123}px`,
    paddingTop: `${pageConfig.marginTop ?? 96}px`,
    paddingRight: `${pageConfig.marginRight ?? 96}px`,
    paddingBottom: `${pageConfig.marginBottom ?? 96}px`,
    paddingLeft: `${pageConfig.marginLeft ?? 96}px`,
    '--wd-para-spacing': `${pageConfig.paragraphSpacing ?? 12}px`,
    '--wd-indent': `${pageConfig.firstLineIndent ?? 0}px`,
  };

  const goalPct = doc.wordGoal > 0 ? Math.min(100, Math.round((counts.words / doc.wordGoal) * 100)) : 0;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {toolbarMode === 'fixed' && (
        <div className="flex items-center justify-between gap-3 px-5 py-2.5 border-b border-gray-800/80 bg-[#011419]/35 shrink-0">
          <Toolbar editor={editor} pageConfig={pageConfig} />
          <div className="flex items-center gap-0.5 shrink-0">
            <button type="button" disabled={exporting} onClick={() => exportAs('pdf')} title="Export PDF" className="p-1.5 rounded-md text-gray-500 hover:text-white hover:bg-white/5 transition-colors cursor-pointer disabled:opacity-40">
              <FileDown className="w-4 h-4" />
            </button>
            <button type="button" disabled={exporting} onClick={() => exportAs('docx')} title="Export Word (.docx)" className="p-1.5 rounded-md text-gray-500 hover:text-white hover:bg-white/5 transition-colors cursor-pointer disabled:opacity-40">
              <FileText className="w-4 h-4" />
            </button>
            <button type="button" onClick={() => setShowPageSetup(true)} title="Page setup" className={`p-1.5 rounded-md transition-colors cursor-pointer ${showPageSetup ? 'text-accent bg-white/5' : 'text-gray-500 hover:text-white hover:bg-white/5'}`}>
              <FileCog className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {showPageSetup && (
        <WritingPageModal config={pageConfig} onChange={onDocPatch} onClose={() => setShowPageSetup(false)} />
      )}

      {toolbarMode === 'bubble' && editor && (
        <BubbleMenu editor={editor} className="flex items-center gap-0.5 bg-[#0a161d] border border-gray-800 rounded-lg px-1.5 py-1 shadow-xl">
          <Toolbar editor={editor} pageConfig={pageConfig} />
        </BubbleMenu>
      )}

      <div className="flex-1 overflow-y-auto custom-scrollbar py-8 px-4">
        <div className="mx-auto rounded-xl shadow-xl ring-1 ring-black/10" style={sheetStyle}>
          <EditorContent editor={editor} />
        </div>
      </div>

      {/* Status bar: live word/char count + per-chapter word goal */}
      <div className="flex items-center gap-4 px-5 py-1.5 border-t border-gray-800/80 bg-[#011419]/35 text-[11px] text-gray-500 shrink-0">
        <span>{counts.words.toLocaleString()} words</span>
        <span>{counts.chars.toLocaleString()} chars</span>
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
