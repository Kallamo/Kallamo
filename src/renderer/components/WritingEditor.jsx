import React, { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import { BubbleMenu } from '@tiptap/react/menus';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle, Color, FontFamily } from '@tiptap/extension-text-style';
import {
  Bold, Italic, Strikethrough, Heading1, Heading2, List, ListOrdered,
  Quote, Palette, Settings2, Crosshair, FileDown, FileText
} from 'lucide-react';

const PAPER_THEMES = [
  { label: 'Light', color: '#ffffff' },
  { label: 'Sepia', color: '#f4ecd8' },
  { label: 'Gray', color: '#e8e8e8' },
  { label: 'Dark', color: '#222428' },
];

const FONT_OPTIONS = [
  { label: 'Default', value: '' },
  { label: 'Serif', value: 'Georgia, serif' },
  { label: 'Sans', value: 'Inter, system-ui, sans-serif' },
  { label: 'Mono', value: 'monospace' },
];

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
  return system.length ? [...FONT_OPTIONS, { label: '──────────', value: '', disabled: true }, ...system] : FONT_OPTIONS;
}

function FontOptionList({ options }) {
  return options.map((f, i) => (
    <option key={`${f.label}-${i}`} value={f.value} disabled={f.disabled} className="bg-[#0a161d]">{f.label}</option>
  ));
}

// Page dimensions in CSS px at 96dpi.
export const PAGE_PRESETS = {
  A4: { pageWidth: 794, pageHeight: 1123 },
  Letter: { pageWidth: 816, pageHeight: 1056 },
};

export const DEFAULT_WRITING_DESK = {
  pageSize: 'A4',
  pageWidth: 794,
  pageHeight: 1123,
  marginTop: 96,
  marginRight: 96,
  marginBottom: 96,
  marginLeft: 96,
  defaultFont: '',
  defaultFontSize: 18,
  lineHeight: 1.6,
  paragraphSpacing: 12,
  textAlign: 'left',
  firstLineIndent: 0,
  sheetColor: '#ffffff',
};

// Relative luminance check so prose text contrasts the paper color.
function isLightColor(hex) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex || '');
  if (!m) return true;
  const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) > 150;
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

function Toolbar({ editor }) {
  const fontOptions = useFontOptions();
  if (!editor) return null;
  return (
    <div className="flex items-center gap-0.5 flex-wrap">
      <ToolbarButton active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()} title="Bold"><Bold className="w-4 h-4" /></ToolbarButton>
      <ToolbarButton active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()} title="Italic"><Italic className="w-4 h-4" /></ToolbarButton>
      <ToolbarButton active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()} title="Strikethrough"><Strikethrough className="w-4 h-4" /></ToolbarButton>
      <span className="w-px h-5 bg-gray-800 mx-1" />
      <ToolbarButton active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} title="Heading 1"><Heading1 className="w-4 h-4" /></ToolbarButton>
      <ToolbarButton active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} title="Heading 2"><Heading2 className="w-4 h-4" /></ToolbarButton>
      <span className="w-px h-5 bg-gray-800 mx-1" />
      <ToolbarButton active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()} title="Bullet list"><List className="w-4 h-4" /></ToolbarButton>
      <ToolbarButton active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()} title="Numbered list"><ListOrdered className="w-4 h-4" /></ToolbarButton>
      <ToolbarButton active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()} title="Quote"><Quote className="w-4 h-4" /></ToolbarButton>
      <span className="w-px h-5 bg-gray-800 mx-1" />
      <label className="p-1.5 rounded-md text-gray-400 hover:text-white hover:bg-white/5 transition-colors cursor-pointer flex items-center" title="Text color">
        <Palette className="w-4 h-4" />
        <input
          type="color"
          className="w-0 h-0 opacity-0 absolute"
          onChange={(e) => editor.chain().focus().setColor(e.target.value).run()}
        />
      </label>
      <select
        className="bg-transparent text-gray-300 text-xs rounded-md px-1.5 py-1 border border-gray-800 hover:border-gray-700 cursor-pointer focus:outline-none"
        onChange={(e) => {
          const v = e.target.value;
          if (v) editor.chain().focus().setFontFamily(v).run();
          else editor.chain().focus().unsetFontFamily().run();
        }}
        defaultValue=""
        title="Font family"
      >
        <FontOptionList options={fontOptions} />
      </select>
    </div>
  );
}

// Margins are applied by the exporter (printToPDF / html-to-docx), not baked into the
// CSS here, to avoid doubling them.
function buildExportHtml(editor, doc) {
  const body = editor.getHTML();
  const fontFamily = doc.defaultFont || 'Georgia, serif';
  const fontSize = doc.defaultFontSize || 18;
  const lineHeight = doc.lineHeight || 1.6;
  const align = doc.textAlign || 'left';
  const para = doc.paragraphSpacing ?? 12;
  const indent = doc.firstLineIndent ?? 0;
  let sizeCss = 'A4';
  if (doc.pageSize === 'Letter') sizeCss = 'Letter';
  else if (doc.pageSize === 'Custom' && doc.pageWidth && doc.pageHeight) sizeCss = `${doc.pageWidth}px ${doc.pageHeight}px`;
  const css = `
    @page { size: ${sizeCss}; margin: 0; }
    body { font-family: ${fontFamily}; font-size: ${fontSize}px; line-height: ${lineHeight}; text-align: ${align}; color: #111; margin: 0; }
    p { margin: 0 0 ${para}px; text-indent: ${indent}px; }
    h1 { font-size: 1.6em; font-weight: 700; margin: 0.6em 0 0.4em; }
    h2 { font-size: 1.3em; font-weight: 700; margin: 0.6em 0 0.4em; }
    h3 { font-size: 1.1em; font-weight: 600; margin: 0.6em 0 0.3em; }
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

export default function WritingEditor({ doc, electronAPI, toolbarMode = 'fixed', onSheetChange }) {
  const saveTimer = useRef(null);
  const [showSheet, setShowSheet] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [counts, setCounts] = useState({ words: 0, chars: 0 });
  const [exporting, setExporting] = useState(false);

  let initialContent;
  try {
    initialContent = doc.content ? JSON.parse(doc.content) : undefined;
  } catch (e) {
    initialContent = undefined;
  }

  const editor = useEditor({
    extensions: [StarterKit, TextStyle, Color, FontFamily],
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

  // Focus / typewriter mode: dim every top-level block except the one with the cursor.
  useEffect(() => {
    if (!editor) return;
    const root = editor.view.dom;
    const update = () => {
      root.querySelectorAll('.wd-active').forEach(el => el.classList.remove('wd-active'));
      root.classList.toggle('wd-focus', focusMode);
      if (!focusMode) return;
      let node = editor.view.domAtPos(editor.state.selection.from)?.node;
      if (node && node.nodeType === 3) node = node.parentNode;
      while (node && node.parentNode !== root) node = node.parentNode;
      if (node && node.classList) node.classList.add('wd-active');
    };
    update();
    editor.on('selectionUpdate', update);
    editor.on('update', update);
    return () => {
      editor.off('selectionUpdate', update);
      editor.off('update', update);
      root.classList.remove('wd-focus');
      root.querySelectorAll('.wd-active').forEach(el => el.classList.remove('wd-active'));
    };
  }, [editor, focusMode]);

  const exportAs = async (kind) => {
    if (!editor || exporting) return;
    setExporting(true);
    try {
      const html = buildExportHtml(editor, doc);
      const margins = { top: doc.marginTop ?? 96, right: doc.marginRight ?? 96, bottom: doc.marginBottom ?? 96, left: doc.marginLeft ?? 96 };
      const payload = { html, title: doc.title, pageSize: doc.pageSize, pageWidth: doc.pageWidth, pageHeight: doc.pageHeight, margins };
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
  const effectiveBg = doc.sheetColor || '#ffffff';
  const pageWidth = doc.pageWidth || doc.sheetWidth || 794;
  const pageHeight = doc.pageHeight || 1123;
  const sheetStyle = {
    backgroundColor: effectiveBg,
    color: isLightColor(effectiveBg) ? '#1f2328' : '#e5e7eb',
    fontFamily: doc.defaultFont || undefined,
    fontSize: `${doc.defaultFontSize || 18}px`,
    lineHeight: doc.lineHeight || 1.6,
    textAlign: doc.textAlign || undefined,
    width: `${pageWidth}px`,
    minHeight: `${pageHeight}px`,
    paddingTop: `${doc.marginTop ?? 96}px`,
    paddingRight: `${doc.marginRight ?? 96}px`,
    paddingBottom: `${doc.marginBottom ?? 96}px`,
    paddingLeft: `${doc.marginLeft ?? 96}px`,
    '--wd-para-spacing': `${doc.paragraphSpacing ?? 12}px`,
    '--wd-indent': `${doc.firstLineIndent ?? 0}px`,
  };

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {toolbarMode === 'fixed' && (
        <div className="flex items-center justify-between px-5 py-2.5 border-b border-gray-800/80 bg-[#011419]/35 shrink-0">
          <Toolbar editor={editor} />
          <div className="flex items-center gap-0.5">
            <button type="button" onClick={() => setFocusMode(f => !f)} title="Focus mode" className={`p-1.5 rounded-md transition-colors cursor-pointer ${focusMode ? 'text-accent bg-white/5' : 'text-gray-500 hover:text-white hover:bg-white/5'}`}>
              <Crosshair className="w-4 h-4" />
            </button>
            <button type="button" disabled={exporting} onClick={() => exportAs('pdf')} title="Export PDF" className="p-1.5 rounded-md text-gray-500 hover:text-white hover:bg-white/5 transition-colors cursor-pointer disabled:opacity-40">
              <FileDown className="w-4 h-4" />
            </button>
            <button type="button" disabled={exporting} onClick={() => exportAs('docx')} title="Export Word (.docx)" className="p-1.5 rounded-md text-gray-500 hover:text-white hover:bg-white/5 transition-colors cursor-pointer disabled:opacity-40">
              <FileText className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={() => setShowSheet(s => !s)}
              className={`p-1.5 rounded-md transition-colors cursor-pointer ${showSheet ? 'text-accent bg-white/5' : 'text-gray-500 hover:text-white hover:bg-white/5'}`}
              title="Page settings"
            >
              <Settings2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {showSheet && (
        <SheetControls doc={doc} onSheetChange={onSheetChange} />
      )}

      {toolbarMode === 'bubble' && editor && (
        <BubbleMenu editor={editor} className="flex items-center gap-0.5 bg-[#0a161d] border border-gray-800 rounded-lg px-1.5 py-1 shadow-xl">
          <Toolbar editor={editor} />
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
            onChange={(e) => onSheetChange({ wordGoal: parseInt(e.target.value, 10) || 0 })}
            className="w-16 bg-[#011419] text-gray-300 rounded-md px-1.5 py-0.5 border border-gray-800 focus:outline-none focus:border-accent text-right"
          />
        </label>
        {doc.wordGoal > 0 && (
          <div className="w-28 h-1.5 rounded-full bg-gray-800 overflow-hidden">
            <div className="h-full bg-accent transition-all" style={{ width: `${Math.min(100, Math.round((counts.words / doc.wordGoal) * 100))}%` }} />
          </div>
        )}
        {doc.wordGoal > 0 && (
          <span className="text-gray-400">{Math.min(100, Math.round((counts.words / doc.wordGoal) * 100))}%</span>
        )}
      </div>
    </div>
  );
}

// Page-settings bar. Also reused for the per-workspace defaults editor by passing the
// workspace config in place of `doc`.
export function SheetControls({ doc, onSheetChange }) {
  const fontOptions = useFontOptions();
  const num = (v, fallback) => (v === '' || v == null || Number.isNaN(v) ? fallback : v);
  const inputCls = "w-16 bg-[#011419] text-gray-200 rounded-md px-1.5 py-1 border border-gray-800 focus:outline-none focus:border-accent text-right";

  const setPageSize = (sz) => {
    if (sz === 'Custom') onSheetChange({ pageSize: 'Custom' });
    else onSheetChange({ pageSize: sz, ...PAGE_PRESETS[sz] });
  };

  return (
    <div className="flex items-center gap-4 px-5 py-2 border-b border-gray-800/80 bg-[#011419]/35 text-xs text-gray-400 shrink-0 flex-wrap">
      <label className="flex items-center gap-2">
        Size
        <select value={doc.pageSize || 'A4'} onChange={(e) => setPageSize(e.target.value)} className="bg-transparent text-gray-300 rounded-md px-1.5 py-1 border border-gray-800 cursor-pointer focus:outline-none">
          {['A4', 'Letter', 'Custom'].map(s => <option key={s} value={s} className="bg-[#0a161d]">{s}</option>)}
        </select>
      </label>

      {doc.pageSize === 'Custom' && (
        <label className="flex items-center gap-1">
          W×H
          <input type="number" min="200" value={doc.pageWidth || 794} onChange={(e) => onSheetChange({ pageWidth: parseInt(e.target.value, 10) || 0 })} className={inputCls} />
          <input type="number" min="200" value={doc.pageHeight || 1123} onChange={(e) => onSheetChange({ pageHeight: parseInt(e.target.value, 10) || 0 })} className={inputCls} />
        </label>
      )}

      <label className="flex items-center gap-1" title="Margins: top / right / bottom / left">
        Margins
        {[['marginTop', 96], ['marginRight', 96], ['marginBottom', 96], ['marginLeft', 96]].map(([k, d]) => (
          <input key={k} type="number" min="0" value={num(doc[k], d)} onChange={(e) => onSheetChange({ [k]: parseInt(e.target.value, 10) || 0 })} className="w-12 bg-[#011419] text-gray-200 rounded-md px-1 py-1 border border-gray-800 focus:outline-none focus:border-accent text-right" />
        ))}
      </label>

      <label className="flex items-center gap-1">
        Font
        <select value={doc.defaultFont || ''} onChange={(e) => onSheetChange({ defaultFont: e.target.value })} className="bg-transparent text-gray-300 rounded-md px-1.5 py-1 border border-gray-800 cursor-pointer focus:outline-none max-w-[140px]">
          <FontOptionList options={fontOptions} />
        </select>
      </label>

      <label className="flex items-center gap-1" title="Font size (px)">
        Size
        <input type="number" min="8" max="96" value={num(doc.defaultFontSize, 18)} onChange={(e) => onSheetChange({ defaultFontSize: parseInt(e.target.value, 10) || 0 })} className={inputCls} />
      </label>

      <label className="flex items-center gap-1" title="Line height">
        Line
        <input type="number" min="1" max="3" step="0.1" value={num(doc.lineHeight, 1.6)} onChange={(e) => onSheetChange({ lineHeight: parseFloat(e.target.value) || 0 })} className={inputCls} />
      </label>

      <label className="flex items-center gap-1" title="First-line indent (px)">
        Indent
        <input type="number" min="0" value={num(doc.firstLineIndent, 0)} onChange={(e) => onSheetChange({ firstLineIndent: parseInt(e.target.value, 10) || 0 })} className={inputCls} />
      </label>

      <label className="flex items-center gap-1">
        Align
        <select value={doc.textAlign || 'left'} onChange={(e) => onSheetChange({ textAlign: e.target.value })} className="bg-transparent text-gray-300 rounded-md px-1.5 py-1 border border-gray-800 cursor-pointer focus:outline-none">
          {['left', 'center', 'justify'].map(a => <option key={a} value={a} className="bg-[#0a161d]">{a}</option>)}
        </select>
      </label>

      <label className="flex items-center gap-2">
        Paper
        <span className="flex items-center gap-1">
          {PAPER_THEMES.map(t => (
            <button
              key={t.label}
              type="button"
              title={t.label}
              onClick={() => onSheetChange({ sheetColor: t.color })}
              className={`w-5 h-5 rounded-full border ${(doc.sheetColor || '#ffffff').toLowerCase() === t.color.toLowerCase() ? 'border-accent ring-1 ring-accent' : 'border-gray-700'}`}
              style={{ backgroundColor: t.color }}
            />
          ))}
          <input type="color" value={doc.sheetColor || '#ffffff'} onChange={(e) => onSheetChange({ sheetColor: e.target.value })} className="w-6 h-6 rounded cursor-pointer bg-transparent border border-gray-800" title="Custom color" />
        </span>
      </label>
    </div>
  );
}
