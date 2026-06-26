// Page-guides: PURELY VISUAL pagination. We never touch the ProseMirror document
// or its decorations (the decoration-spacer approach corrupted PM's decoration
// system and fought the table plugins). Instead the editor stays one continuous
// white sheet and we overlay page-boundary markers computed from the measured
// content height. Robust and crash-proof; trade-off is the sheet is continuous
// (no physical gap between pages) rather than separate floating sheets.

// Given the laid-out content height (px, the editable area excluding the sheet's
// margin padding) and the page geometry, return how many pages it spans and the
// Y offsets (relative to the sheet top) where each page boundary line should sit.
export function computePageLayout(contentHeight, geom) {
  const pch = geom && geom.pageContentHeight;
  if (!pch || pch <= 0 || !contentHeight) return { pages: 1, lines: [] };
  const pages = Math.max(1, Math.ceil((contentHeight - 1) / pch));
  const lines = [];
  const mT = geom.marginTop || 0;
  for (let k = 1; k < pages; k++) lines.push(mT + k * pch);
  return { pages, lines };
}
