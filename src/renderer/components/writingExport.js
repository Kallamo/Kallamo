// Export and preview share the same prose CSS so pagination matches.

const HEADING_SIZES = { h1: 28, h2: 20, h3: 16 };

// Margins excluded: the exporter and the preview each apply them, avoiding doubles.
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

// Margins live in the CSS @page rule: printToPDF's margins option silently falls back to defaults.
// paginate === false gives one continuous page sized by contentHeight.
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
