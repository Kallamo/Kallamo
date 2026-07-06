import { Extension, Mark, mergeAttributes, generateJSON, generateHTML, textInputRule } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle, Color, FontFamily, FontSize } from '@tiptap/extension-text-style';
import TextAlign from '@tiptap/extension-text-align';
import { TableKit } from '@tiptap/extension-table';
import Typography from '@tiptap/extension-typography';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { Fragment } from '@tiptap/pm/model';
import { Markdown } from 'tiptap-markdown';
import { diffWords } from 'diff';

// Keep the selection visible when focus leaves the editor for a toolbar input.
// The native highlight moves away, so the range is painted with a decoration
// while blurred and dropped on refocus.
const persistSelectionKey = new PluginKey('persistSelection');
export const PersistSelection = Extension.create({
  name: 'persistSelection',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: persistSelectionKey,
      state: {
        init: () => ({ focused: true }),
        apply(tr, value) {
          const meta = tr.getMeta(persistSelectionKey);
          return meta && typeof meta.focused === 'boolean' ? { focused: meta.focused } : value;
        },
      },
      props: {
        decorations(state) {
          if (persistSelectionKey.getState(state)?.focused) return null;
          const { from, to } = state.selection;
          if (from === to) return null;
          return DecorationSet.create(state.doc, [Decoration.inline(from, to, { class: 'wd-blur-selection' })]);
        },
      },
      view(view) {
        const set = (focused) => view.dispatch(view.state.tr.setMeta(persistSelectionKey, { focused }));
        const onBlur = () => set(false);
        const onFocus = () => set(true);
        view.dom.addEventListener('blur', onBlur);
        view.dom.addEventListener('focus', onFocus);
        return { destroy() { view.dom.removeEventListener('blur', onBlur); view.dom.removeEventListener('focus', onFocus); } };
      },
    })];
  },
});

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

// --- AI SELECT->INVOKE: inline suggestion overlay ---
// Non-destructive track-changes painted with ProseMirror decorations: the original
// text stays in the doc, removed parts get a red strikethrough inline decoration,
// and added parts are green widget spans. Accept/Reject mutate the doc afterwards.
export const suggestionKey = new PluginKey('wdSuggestion');
export const SuggestionDecorations = Extension.create({
  name: 'wdSuggestion',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: suggestionKey,
      state: {
        init: () => DecorationSet.empty,
        apply(tr, old) {
          const meta = tr.getMeta(suggestionKey);
          if (meta !== undefined) return meta || DecorationSet.empty;
          return old.map(tr.mapping, tr.doc);
        },
      },
      props: { decorations(state) { return suggestionKey.getState(state); } },
    })];
  },
});

// --- FIND & REPLACE: match highlighting ---
// Collect every occurrence of `query` in the doc, accumulating inline text per
// textblock so a match can span mark boundaries (e.g. a partially-bold word).
// Returns ProseMirror {from,to} ranges in document coordinates.
export function collectSearchMatches(doc, query, caseSensitive) {
  const matches = [];
  if (!query) return matches;
  const needle = caseSensitive ? query : query.toLowerCase();
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return;
    let text = '';
    const offsets = []; // doc position of each character accumulated in `text`
    node.forEach((child, off) => {
      if (child.isText) {
        for (let i = 0; i < child.text.length; i++) offsets.push(pos + 1 + off + i);
        text += child.text;
      } else {
        offsets.push(pos + 1 + off); // a non-text inline (e.g. hard break) counts as one char
        text += '\n';
      }
    });
    const hay = caseSensitive ? text : text.toLowerCase();
    let idx = 0;
    while ((idx = hay.indexOf(needle, idx)) !== -1) {
      const from = offsets[idx];
      const to = offsets[idx + needle.length - 1] + 1;
      if (from != null && to != null) matches.push({ from, to });
      idx += needle.length;
    }
  });
  return matches;
}

// Paints search matches as inline decorations. The plugin is dumb: the React panel
// computes matches and pushes {matches, current} via meta; between pushes the set is
// mapped through edits so highlights survive a replace.
export const searchKey = new PluginKey('wdSearch');
export const SearchHighlight = Extension.create({
  name: 'wdSearch',
  addProseMirrorPlugins() {
    return [new Plugin({
      key: searchKey,
      state: {
        init: () => DecorationSet.empty,
        apply(tr, old) {
          const meta = tr.getMeta(searchKey);
          if (meta !== undefined) {
            if (!meta || !meta.matches || !meta.matches.length) return DecorationSet.empty;
            const decos = meta.matches.map((m, i) =>
              Decoration.inline(m.from, m.to, { class: i === meta.current ? 'wd-search-current' : 'wd-search-match' })
            );
            return DecorationSet.create(tr.doc, decos);
          }
          return old.map(tr.mapping, tr.doc);
        },
      },
      props: { decorations(state) { return searchKey.getState(state); } },
    })];
  },
});

// Strip anything executable from model-produced HTML before rendering it.
function sanitizeHtml(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = String(html || '');
  tmp.querySelectorAll('script, style').forEach(n => n.remove());
  tmp.querySelectorAll('*').forEach(el => {
    [...el.attributes].forEach(a => { if (/^on/i.test(a.name) || a.name === 'srcdoc') el.removeAttribute(a.name); });
  });
  return tmp.innerHTML;
}

// Green block holding the full proposal as HTML (so bold/italic/headings/lists in
// the AI output are previewed faithfully), rendered right after the original span.
// Block-level, not interleaved per word, so paragraph breaks can't desync it.
function addedBlock(pos, html, channel) {
  return Decoration.widget(pos, () => {
    const wrap = document.createElement('div');
    wrap.className = 'wd-diff-block-added';
    wrap.setAttribute('contenteditable', 'false');
    if (channel !== 'insertion') {
      const tag = document.createElement('div');
      tag.className = 'wd-diff-block-tag';
      tag.textContent = 'Suggested replacement';
      wrap.appendChild(tag);
    }
    const body = document.createElement('div');
    body.innerHTML = sanitizeHtml(html);
    wrap.appendChild(body);
    return wrap;
  }, { side: 1, key: `addblk-${pos}-${String(html).length}` });
}

// Build the decoration set for a pending suggestion (replacement/insertion):
// the whole original span struck through in red, the full proposal in a green
// block below it. No per-word mapping, so paragraph breaks can't desync it.
export function buildSuggestionDecorations(doc, suggestion) {
  if (!suggestion || suggestion.channel === 'analysis') return DecorationSet.empty;
  const { fromPos, toPos } = suggestion;
  const decos = [];
  if (suggestion.channel !== 'insertion' && toPos > fromPos) {
    decos.push(Decoration.inline(fromPos, toPos, { class: 'wd-diff-removed' }));
  }
  // proposedHtml is pre-rendered by the editor (proposalToHtml); fall back to raw text.
  decos.push(addedBlock(toPos, suggestion.proposedHtml || suggestion.proposedText || '', suggestion.channel));
  return DecorationSet.create(doc, decos);
}

// Plain text of HTML, for char counting (the proposal is HTML, the original plain).
function htmlToPlain(html) {
  const tmp = document.createElement('div');
  tmp.innerHTML = String(html || '');
  return tmp.textContent || '';
}

// Character +added / -removed counts for the floating counter (metric in chars).
export function suggestionCharDelta(suggestion) {
  if (!suggestion) return { added: 0, removed: 0 };
  const proposedPlain = htmlToPlain(suggestion.proposedText || '');
  if (suggestion.channel === 'insertion') return { added: proposedPlain.length, removed: 0 };
  const parts = diffWords(suggestion.originalText || '', proposedPlain);
  let added = 0, removed = 0;
  for (const p of parts) {
    if (p.added) added += p.value.length;
    else if (p.removed) removed += p.value.length;
  }
  return { added, removed };
}

// Inline reference to a Worldbuild entity. Presentational + navigational ONLY: it
// tags a span with the entity id (and a display name for dangling-ref fallback) and
// renders as a dotted-underline span. Retrieval still runs off chunk_tags — this mark
// is never a source of truth for what the AI sees. Rides in the doc JSON, so it tracks
// the text through edits and persists with saveDocumentContent.
export const EntityRef = Mark.create({
  name: 'entityRef',
  inclusive: false,
  addAttributes() {
    return {
      entityId: {
        default: null,
        parseHTML: el => el.getAttribute('data-entity-id'),
        renderHTML: attrs => (attrs.entityId ? { 'data-entity-id': attrs.entityId } : {}),
      },
      name: {
        default: null,
        parseHTML: el => el.getAttribute('data-entity-name'),
        renderHTML: attrs => (attrs.name ? { 'data-entity-name': attrs.name } : {}),
      },
      type: {
        default: null,
        parseHTML: el => el.getAttribute('data-entity-type'),
        renderHTML: attrs => (attrs.type ? { 'data-entity-type': attrs.type } : {}),
      },
    };
  },
  parseHTML() { return [{ tag: 'span[data-entity-id]' }]; },
  renderHTML({ HTMLAttributes }) {
    return ['span', mergeAttributes(HTMLAttributes, { class: 'wd-entity-ref' }), 0];
  },
  // Serialize to Markdown as bare text (no delimiters), so invoking the AI on a linked
  // span sends plain prose and the mark never swallows or mangles the text.
  addStorage() {
    return { markdown: { serialize: { open: '', close: '' }, parse: {} } };
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
  CellBackground, EntityRef,
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

// The live editor adds Smart Typography (curly quotes, ellipsis, ©™…) plus the
// space-triggered dashes, when enabled in Settings → Interface → Writing Desk.
// Input-rule-only, so omitted from the import schema (generateJSON never types).
// Document-only — never touches chat. Typography's own immediate `--`→— rule is
// disabled in favor of SmartDashes.
export function getEditorExtensions({ smartTypography = true } = {}) {
  const base = [
    ...writingExtensions, PersistSelection, SuggestionDecorations, SearchHighlight,
    // Markdown is the interchange format for AI invocations: the model reads + writes
    // Markdown (which it does far more reliably than HTML). html:true lets the table
    // fallback pass raw HTML through. Copy/paste behavior is left untouched.
    Markdown.configure({ html: true, tightLists: true, transformPastedText: false, transformCopiedText: false }),
  ];
  return smartTypography
    ? [...base, Typography.configure({ emDash: false }), SmartDashes]
    : base;
}

// True if the selection [from,to] contains a table — markdown serialization mangles
// rich tables, so those invocations fall back to the HTML round-trip.
export function selectionHasTable(editor, from, to) {
  let found = false;
  editor.state.doc.nodesBetween(from, to, (node) => {
    if (node.type.name === 'table') found = true;
  });
  return found;
}

// Serialize the selection to Markdown. Inline-only slices are wrapped in a paragraph
// so they form a valid doc for the serializer.
export function sliceToMarkdown(editor, from, to) {
  let fragment = editor.state.doc.slice(from, to).content;
  const first = fragment.firstChild;
  if (first && !first.isBlock) {
    fragment = Fragment.from(editor.schema.nodes.paragraph.create(null, fragment));
  }
  const docNode = editor.schema.topNodeType.create(null, fragment);
  return editor.storage.markdown.serializer.serialize(docNode).trim();
}

// Render an AI proposal (Markdown, or HTML for the table fallback) to HTML for the
// green preview block. The markdown parser passes HTML through when html:true.
export function proposalToHtml(editor, text) {
  try {
    return editor.storage.markdown.parser.parse(text || '');
  } catch (e) {
    return '';
  }
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

// Stored ProseMirror JSON -> HTML without a live editor, for combining chapters on export.
export function chapterJsonToHtml(json) {
  if (!json) return '';
  return generateHTML(json, writingExtensions);
}

// Rough "~N pages" estimate from word count + page geometry (no real layout pass).
export function estimatePagesFromWords(words, pageConfig = {}) {
  if (!words) return 0;
  const pageWidth = pageConfig.pageWidth || 794;
  const pageHeight = pageConfig.pageHeight || 1123;
  const marginTop = pageConfig.marginTop ?? 96;
  const marginBottom = pageConfig.marginBottom ?? 96;
  const marginLeft = pageConfig.marginLeft ?? 96;
  const marginRight = pageConfig.marginRight ?? 96;
  const fontSize = pageConfig.defaultFontSize || 18;
  const lineHeight = pageConfig.lineHeight || 1.6;
  const contentHeight = Math.max(pageHeight - marginTop - marginBottom, 1);
  const contentWidth = Math.max(pageWidth - marginLeft - marginRight, 1);
  const lineHeightPx = fontSize * lineHeight;
  const linesPerPage = Math.max(Math.floor(contentHeight / lineHeightPx), 1);
  const avgCharWidth = fontSize * 0.5;            // rough average glyph advance
  const charsPerLine = Math.max(contentWidth / avgCharWidth, 1);
  const wordsPerLine = Math.max(charsPerLine / 6, 1); // ~5 chars/word + a space
  const wordsPerPage = linesPerPage * wordsPerLine;
  return Math.max(1, Math.round(words / wordsPerPage));
}
