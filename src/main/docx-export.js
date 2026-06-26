// ProseMirror JSON -> .docx, using the `docx` library so the output is always
// schema-valid OOXML (html-to-docx produced well-formed-but-invalid files that
// Word refused to open, especially with tables). We control the editor schema,
// so we map its nodes/marks directly.
const {
  Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType,
  Table, TableRow, TableCell, WidthType, BorderStyle, PageNumber,
  Header, Footer, ShadingType,
} = require('docx');

const PX_TO_TWIP = 15;        // 1px @96dpi = 15 twips
const px = (v, d = 0) => (v == null ? d : (typeof v === 'string' ? parseFloat(v) || d : v));
// docx font size is in half-points; pt = px * 0.75 -> halfPoints = px * 1.5
const pxToHalfPt = (p) => Math.round(p * 1.5);

const ALIGN = {
  left: AlignmentType.LEFT, center: AlignmentType.CENTER,
  right: AlignmentType.RIGHT, justify: AlignmentType.JUSTIFIED,
};
const HEADING = { 1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3 };

function markLookup(marks) {
  const out = {};
  for (const m of marks || []) {
    if (m.type === 'bold') out.bold = true;
    else if (m.type === 'italic') out.italics = true;
    else if (m.type === 'underline') out.underline = {};
    else if (m.type === 'strike') out.strike = true;
    else if (m.type === 'textStyle' && m.attrs) {
      if (m.attrs.color) out.color = String(m.attrs.color).replace('#', '');
      if (m.attrs.fontFamily) out.font = String(m.attrs.fontFamily).replace(/["']/g, '');
      if (m.attrs.fontSize) out.size = pxToHalfPt(px(m.attrs.fontSize));
    }
  }
  return out;
}

// Inline content (text + hardBreak) -> array of TextRun.
function runsFromInline(content, base) {
  const runs = [];
  for (const node of content || []) {
    if (node.type === 'text') {
      runs.push(new TextRun({ text: node.text || '', ...base, ...markLookup(node.marks) }));
    } else if (node.type === 'hardBreak') {
      runs.push(new TextRun({ break: 1, ...base }));
    }
  }
  if (!runs.length) runs.push(new TextRun({ text: '', ...base }));
  return runs;
}

function blockBase(attrs, page) {
  const o = {};
  if (attrs?.textAlign && ALIGN[attrs.textAlign]) o.alignment = ALIGN[attrs.textAlign];
  const spacing = {};
  if (attrs?.paragraphSpacing != null) spacing.after = Math.round(px(attrs.paragraphSpacing) * PX_TO_TWIP);
  else spacing.after = Math.round(px(page.paragraphSpacing, 12) * PX_TO_TWIP);
  const lh = attrs?.lineHeight != null ? parseFloat(attrs.lineHeight) : page.lineHeight;
  if (lh) { spacing.line = Math.round(lh * 240); spacing.lineRule = 'auto'; }
  o.spacing = spacing;
  return o;
}

// One context per document so list numbering references accumulate.
function createConverter(page) {
  const numbering = [];
  const baseRun = {
    font: String(page.defaultFont || 'Arial').replace(/["']/g, ''),
    size: pxToHalfPt(px(page.defaultFontSize, 14)),
  };

  function paragraph(node, extra = {}, runOverride = null) {
    const attrs = node.attrs || {};
    const base = runOverride ? { ...baseRun, ...runOverride } : baseRun;
    const opts = { ...blockBase(attrs, page), children: runsFromInline(node.content, base), ...extra };
    if (node.type === 'heading') opts.heading = HEADING[attrs.level] || HeadingLevel.HEADING_3;
    return new Paragraph(opts);
  }

  function listItems(listNode, ordered, level, ref) {
    const out = [];
    for (const item of listNode.content || []) {
      for (const child of item.content || []) {
        if (child.type === 'paragraph') {
          const num = ordered
            ? { numbering: { reference: ref, level } }
            : { bullet: { level } };
          out.push(paragraph(child, num));
        } else if (child.type === 'bulletList' || child.type === 'orderedList') {
          out.push(...list(child, level + 1));
        }
      }
    }
    return out;
  }

  function list(node, level = 0) {
    const ordered = node.type === 'orderedList';
    let ref;
    if (ordered) {
      ref = `ord-${numbering.length}`;
      numbering.push({
        reference: ref,
        levels: Array.from({ length: 9 }, (_, l) => ({
          level: l, format: 'decimal', text: `%${l + 1}.`, alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720 * (l + 1), hanging: 360 } } },
        })),
      });
    }
    return listItems(node, ordered, level, ref);
  }

  function tableNode(node) {
    const line = { style: BorderStyle.SINGLE, size: 4, color: 'BFBFBF' };
    const borders = { top: line, bottom: line, left: line, right: line, insideHorizontal: line, insideVertical: line };
    const hex = (c) => (c ? String(c).replace('#', '').trim() : null);

    const rows = (node.content || []).map(rowNode => {
      const cells = (rowNode.content || []).map(cellNode => {
        const isHeader = cellNode.type === 'tableHeader';
        const children = (cellNode.content || []).flatMap(n =>
          (n.type === 'paragraph' || n.type === 'heading') ? [paragraph(n)] : blocks([n]));
        if (!children.length) children.push(new Paragraph({ children: [new TextRun({ text: '', ...baseRun })] }));
        // Explicit cell color wins; header cells otherwise get a light fill.
        const cellColor = hex(cellNode.attrs?.backgroundColor) || (isHeader ? 'F2F2F2' : null);
        return new TableCell({
          children,
          columnSpan: cellNode.attrs?.colspan || 1,
          rowSpan: cellNode.attrs?.rowspan || 1,
          shading: cellColor ? { type: ShadingType.CLEAR, fill: cellColor } : undefined,
        });
      });
      return new TableRow({ children: cells });
    });
    return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE }, borders });
  }

  function blocks(content) {
    const out = [];
    for (const node of content || []) {
      switch (node.type) {
        case 'paragraph':
        case 'heading':
          out.push(paragraph(node));
          break;
        case 'bulletList':
        case 'orderedList':
          out.push(...list(node, 0));
          break;
        case 'blockquote':
          for (const child of node.content || []) {
            if (child.type === 'paragraph') {
              out.push(paragraph(child, { indent: { left: 480 }, border: { left: { style: BorderStyle.SINGLE, size: 18, color: 'CCCCCC', space: 12 } } }));
            } else {
              out.push(...blocks([child]));
            }
          }
          break;
        case 'horizontalRule':
          out.push(new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '999999' } }, spacing: { after: 200 } }));
          break;
        case 'table':
          out.push(tableNode(node));
          // a table cannot be the last element without a trailing paragraph in some viewers
          out.push(new Paragraph({ children: [], spacing: { after: 0 } }));
          break;
        default:
          if (node.content) out.push(...blocks(node.content));
      }
    }
    return out;
  }

  return { blocks, numbering, baseRun };
}

async function buildDocxBuffer(docJson, page, opts = {}) {
  const conv = createConverter(page);
  const children = conv.blocks(docJson?.content || []);

  const margins = opts.margins || {};
  const sectionProps = {
    page: {
      size: {
        width: Math.round(px(page.pageWidth, 794) * PX_TO_TWIP),
        height: Math.round(px(page.pageHeight, 1123) * PX_TO_TWIP),
        orientation: page.orientation === 'landscape' ? 'landscape' : 'portrait',
      },
      margin: {
        top: Math.round(px(margins.top, 96) * PX_TO_TWIP),
        right: Math.round(px(margins.right, 96) * PX_TO_TWIP),
        bottom: Math.round(px(margins.bottom, 96) * PX_TO_TWIP),
        left: Math.round(px(margins.left, 96) * PX_TO_TWIP),
      },
    },
  };

  const wantNumbers = !!(opts.pageNumbers && opts.pageNumbers.enabled);
  let footers;
  if (wantNumbers) {
    const align = ALIGN[opts.pageNumbers.position] || AlignmentType.CENTER;
    footers = {
      default: new Footer({
        children: [new Paragraph({ alignment: align, children: [new TextRun({ children: [PageNumber.CURRENT], ...conv.baseRun })] })],
      }),
    };
  }

  const doc = new Document({
    numbering: { config: conv.numbering },
    sections: [{ properties: sectionProps, footers, children }],
  });
  return Packer.toBuffer(doc);
}

module.exports = { buildDocxBuffer };
