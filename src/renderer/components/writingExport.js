// Shared HTML/CSS builders for Writing Desk export and its faithful preview.
// The export document and the on-screen preview consume the SAME prose CSS so
// line-breaking / pagination measured in the modal closely matches the output.

const HEADING_SIZES = { h1: 28, h2: 20, h3: 16 };

// Prose styling scoped under a root selector ('body' for export, a class for
// the preview). Margins are intentionally NOT included here, the exporter
// (printToPDF / html-to-docx) applies page margins, and the preview applies
// them as page-box padding, so both avoid double margins.
export function proseCss(rootSel, page) {
  const fontFamily = page.defaultFont || 'Arial';
  const fontSize = page.defaultFontSize || 18;
  const lineHeight = page.lineHeight || 1.6;
  const para = page.paragraphSpacing ?? 12;
  const indent = page.firstLineIndent ?? 0;
  return `
    ${rootSel} { font-family: ${fontFamily}; font-size: ${fontSize}px; line-height: ${lineHeight}; color: #111; }
    ${rootSel} p { margin: 0 0 ${para}px; text-indent: ${indent}px; }
    ${rootSel} h1 { font-size: ${HEADING_SIZES.h1}px; font-weight: 700; margin: 0.6em 0 0.4em; }
    ${rootSel} h2 { font-size: ${HEADING_SIZES.h2}px; font-weight: 700; margin: 0.6em 0 0.4em; }
    ${rootSel} h3 { font-size: ${HEADING_SIZES.h3}px; font-weight: 700; margin: 0.6em 0 0.3em; }
    ${rootSel} ul { padding-left: 1.5em; margin: 0 0 ${para}px; }
    ${rootSel} ol { padding-left: 1.5em; margin: 0 0 ${para}px; }
    ${rootSel} blockquote { border-left: 3px solid rgba(0,0,0,0.25); padding-left: 1em; margin: 0 0 ${para}px; font-style: italic; }
    ${rootSel} hr { border: none; border-top: 1px solid rgba(0,0,0,0.25); margin: 1.2em 0; }
    ${rootSel} img { max-width: 100%; height: auto; }
    ${rootSel} code { font-family: monospace; font-size: 0.9em; }
    ${rootSel} table { border-collapse: collapse; width: 100%; margin: 0 0 ${para}px; table-layout: fixed; }
    ${rootSel} th, ${rootSel} td { border: 1px solid #bfbfbf; padding: 6px 8px; vertical-align: top; text-align: left; }
    ${rootSel} th { background: #f2f2f2; font-weight: 700; }
    ${rootSel} table p { margin: 0; text-indent: 0; }
  `;
}

function pageSizeCss(page) {
  let sizeCss = 'A4';
  if (page.pageSize === 'Letter') sizeCss = 'Letter';
  else if (page.pageSize === 'Custom' && page.pageWidth && page.pageHeight) sizeCss = `${page.pageWidth}px ${page.pageHeight}px`;
  if (page.orientation === 'landscape' && (page.pageSize === 'A4' || page.pageSize === 'Letter')) sizeCss += ' landscape';
  return sizeCss;
}

// Self-contained HTML document fed to the PDF exporter. Margins are baked into
// the CSS `@page` rule (Chromium honors these deterministically, per page) rather
// than via printToPDF's margins option, which silently fell back to defaults.
// `opts.paginate === false` produces a single continuous page; `opts.contentHeight`
// (px, including margins) sizes it. `opts.margins` = {top,right,bottom,left} px.
export function buildExportHtml(bodyHtml, page, opts = {}) {
  const m = opts.margins || {};
  const mCss = `${m.top ?? 96}px ${m.right ?? 96}px ${m.bottom ?? 96}px ${m.left ?? 96}px`;
  // PDF max page dimension is 200in; clamp the single continuous page so Acrobat
  // doesn't warn / truncate. Long single-page exports beyond this are capped.
  const MAX_PX = 200 * 96;
  let sizeRule;
  if (opts.paginate === false) {
    const w = page.pageWidth || 794;
    const h = opts.contentHeight ? Math.min(Math.ceil(opts.contentHeight), MAX_PX) : null;
    sizeRule = `size: ${w}px ${h ? `${h}px` : 'auto'};`;
  } else {
    sizeRule = `size: ${pageSizeCss(page)};`;
  }
  const css = `
    @page { ${sizeRule} margin: ${mCss}; }
    body { margin: 0; }
    ${proseCss('body', page)}
  `;
  return `<!doctype html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${bodyHtml}</body></html>`;
}
