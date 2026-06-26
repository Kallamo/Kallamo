import { Extension, generateJSON, textInputRule } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle, Color, FontFamily, FontSize } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import { TableKit } from '@tiptap/extension-table';
import Typography from '@tiptap/extension-typography';

// Line height and paragraph spacing as block-level attributes on paragraphs/headings.
// (The text-style LineHeight applies to inline spans, which doesn't space whole lines.)
const BLOCK_TYPES = ['paragraph', 'heading'];
export const BlockStyle = Extension.create({
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

// Per-cell background color. Lives as an attribute on tableCell/tableHeader
// (cells are NOT rendered by the table node view, so attribute renderHTML applies
// cleanly) and travels in the content + export. Font color stays on the toolbar.
export const CellBackground = Extension.create({
  name: 'cellBackground',
  addGlobalAttributes() {
    return [{
      types: ['tableCell', 'tableHeader'],
      attributes: {
        backgroundColor: {
          default: null,
          parseHTML: el => el.style.backgroundColor || null,
          renderHTML: attrs => (attrs.backgroundColor ? { style: `background-color: ${attrs.backgroundColor}` } : {}),
        },
      },
    }];
  },
  addCommands() {
    return {
      setCellBackground: (color) => ({ commands }) => commands.setCellAttribute('backgroundColor', color),
    };
  },
});

// Single source of truth for the editor schema. Shared between the live editor
// (useEditor) and offline conversions like generateJSON() for rich imports, so
// imported content is parsed against exactly the marks/nodes the editor renders.
export const writingExtensions = [
  StarterKit, // includes Underline + Link in TipTap v3
  TextStyle, Color, FontFamily, FontSize, BlockStyle,
  TextAlign.configure({ types: ['heading', 'paragraph'] }),
  TableKit.configure({ table: { resizable: true } }),
  CellBackground,
];

// Dashes convert only once a trailing space is typed, so `--`/`---` don't fire
// mid-word and the writer can still reach the long em dash: `-- ` → en (–),
// `--- ` → em (—). The lookbehind keeps the en rule from matching inside `---`.
const SmartDashes = Extension.create({
  name: 'smartDashes',
  addInputRules() {
    return [
      textInputRule({ find: /---\s$/, replace: '— ' }),
      textInputRule({ find: /(?<!-)--\s$/, replace: '– ' }),
    ];
  },
});

// The live editor adds Smart Typography (curly quotes, ellipsis, ©™…) plus our
// space-triggered dashes, when enabled in Settings → Interface → Writing Desk.
// Input-rule-only, so omitted from the import schema (generateJSON never types).
// Document-only — never touches chat. Typography's own immediate `--`→— rule is
// disabled in favor of SmartDashes.
export function getEditorExtensions({ smartTypography = true } = {}) {
  return smartTypography
    ? [...writingExtensions, Typography.configure({ emDash: false }), SmartDashes]
    : writingExtensions;
}

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Best-effort plain text → HTML: blank-line separated blocks become paragraphs;
// a short, heading-like lone line (no terminal punctuation) is promoted to <h2>.
// PDF/txt/md imports go through here since they carry no reliable structure.
function textToHtml(text) {
  const blocks = String(text || '').split(/\n\s*\n/).map(b => b.trim()).filter(Boolean);
  if (!blocks.length) return '<p></p>';
  return blocks.map(b => {
    const oneLine = !b.includes('\n');
    const looksHeading = oneLine && b.length <= 64 && !/[.!?;:,]$/.test(b);
    if (looksHeading) return `<h2>${escapeHtml(b)}</h2>`;
    return `<p>${escapeHtml(b).replace(/\n/g, '<br>')}</p>`;
  }).join('');
}

// Convert an import-document result into ProseMirror JSON against the editor
// schema. DOCX arrives as rich HTML (formatting preserved); text is structured
// heuristically. generateJSON parses with the same marks/nodes the editor renders.
export function importedContentToJson(res) {
  const html = res?.kind === 'html' ? (res.html || '') : textToHtml(res?.text || '');
  return generateJSON(html, writingExtensions);
}
