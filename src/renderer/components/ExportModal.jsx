import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import { Download, ChevronLeft, ChevronRight, FileDown, FileText, Hash } from 'lucide-react';
import { proseCss, buildExportHtml } from './writingExport';

function Segmented({ value, options, onChange }) {
  return (
    <div className="flex bg-[#011419] border border-gray-700 rounded-lg p-1 gap-1">
      {options.map(opt => (
        <button
          key={opt.value}
          type="button"
          onClick={() => onChange(opt.value)}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-semibold cursor-pointer transition-all ${value === opt.value
            ? 'bg-[#1a2d32] text-white border border-accent/30 shadow'
            : 'text-gray-500 hover:text-white'}`}
        >
          {opt.icon && <opt.icon className="w-3.5 h-3.5" />}
          {opt.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({ checked, onChange, label, disabled }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`flex items-center justify-between w-full gap-3 ${disabled ? 'opacity-40 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      <span className="text-sm font-semibold text-gray-200">{label}</span>
      <span className={`relative w-9 h-5 rounded-full transition-colors ${checked ? 'bg-accent' : 'bg-gray-700'}`}>
        <span className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform ${checked ? 'translate-x-4' : ''}`} />
      </span>
    </button>
  );
}

// Greedy block-level pagination: walk the rendered top-level blocks and break to
// a new page when a whole block would overflow the page content box, keeping
// blocks intact. A `.wd-chapter-start` block always forces a new page, mirroring
// the `page-break-before:always` that the PDF export honors natively.
function paginateBlocks(container, pageContentHeight) {
  const children = Array.from(container.children);
  if (!children.length) return [''];
  const pages = [];
  let current = [];
  let pageStartY = children[0].offsetTop;
  for (const child of children) {
    const forceBreak = child.classList.contains('wd-chapter-start') && current.length;
    const bottom = child.offsetTop + child.offsetHeight;
    if ((forceBreak || (bottom - pageStartY > pageContentHeight)) && current.length) {
      pages.push(current.join(''));
      current = [];
      pageStartY = child.offsetTop;
    }
    current.push(child.outerHTML);
  }
  pages.push(current.join(''));
  return pages;
}

export default function ExportModal({ editor, pageConfig, title, electronAPI, onClose }) {
  const [format, setFormat] = useState('pdf');
  const paginate = true; // Kallamo always exports paginated (faithful to the paged editor).
  const [pageNumbers, setPageNumbers] = useState(false);
  const [numberPos, setNumberPos] = useState('center');
  const [pageNumberStart, setPageNumberStart] = useState(1);
  const [pageIndex, setPageIndex] = useState(0);
  const [pages, setPages] = useState([]);
  const [contentHeight, setContentHeight] = useState(0);
  const [scale, setScale] = useState(1);
  const [exporting, setExporting] = useState(false);

  const bodyHtml = useMemo(() => (editor ? editor.getHTML() : ''), [editor]);

  const pw = pageConfig.pageWidth || 794;
  const ph = pageConfig.pageHeight || 1123;
  const mTop = pageConfig.marginTop ?? 96;
  const mBottom = pageConfig.marginBottom ?? 96;
  const mLeft = pageConfig.marginLeft ?? 96;
  const mRight = pageConfig.marginRight ?? 96;
  const contentWidth = pw - mLeft - mRight;
  const pageContentHeight = ph - mTop - mBottom;

  const measureRef = useRef(null);
  const previewColRef = useRef(null);
  const previewCss = useMemo(() => proseCss('.wd-measure', pageConfig), [pageConfig]);

  // Measure + paginate whenever the source or geometry changes.
  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el) return;
    el.innerHTML = bodyHtml;
    setContentHeight(el.scrollHeight);
    if (paginate) {
      const pgs = paginateBlocks(el, pageContentHeight);
      setPages(pgs);
      setPageIndex(i => Math.min(i, pgs.length - 1));
    } else {
      setPages([bodyHtml]);
      setPageIndex(0);
    }
  }, [bodyHtml, previewCss, paginate, pageContentHeight, contentWidth]);

  // Fit the page box to the available preview column width.
  useLayoutEffect(() => {
    const col = previewColRef.current;
    if (!col) return;
    const fit = () => {
      const avail = col.clientWidth - 48; // breathing room
      setScale(Math.min(1, avail / pw));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(col);
    return () => ro.disconnect();
  }, [pw]);

  const total = pages.length || 1;
  const showPaged = paginate;
  const boxHeight = showPaged ? ph : Math.max(ph, contentHeight + mTop + mBottom);

  const handleExport = async () => {
    if (!editor || exporting) return;
    setExporting(true);
    try {
      const margins = { top: mTop, right: mRight, bottom: mBottom, left: mLeft };
      const nums = pageNumbers ? { enabled: true, position: numberPos } : { enabled: false };
      let res;
      if (format === 'pdf') {
        const html = buildExportHtml(bodyHtml, pageConfig, {
          paginate, margins, contentHeight: contentHeight + mTop + mBottom,
        });
        res = await electronAPI.exportDocumentPdf({
          html, title,
          pageSize: pageConfig.pageSize, pageWidth: pw, pageHeight: ph,
          margins, paginate,
          contentHeight: contentHeight + mTop + mBottom,
          pageNumbers: nums,
        });
      } else {
        res = await electronAPI.exportDocumentDocx({
          docJson: editor.getJSON(), title,
          page: pageConfig, margins, pageNumbers: nums,
          pageNumberStart,
        });
      }
      if (res && !res.canceled) onClose();
    } finally {
      setExporting(false);
    }
  };

  const posClass = numberPos === 'left' ? 'text-left' : numberPos === 'right' ? 'text-right' : 'text-center';

  return (
    <Modal onClose={onClose} size="xl" title="Export" icon={Download} className="!max-w-5xl">
      <div className="flex min-h-0" style={{ height: '78vh' }}>
        {/* Preview */}
        <div ref={previewColRef} className="flex-1 min-w-0 bg-[#00080B] overflow-y-auto custom-scrollbar flex flex-col items-center py-6 px-4">
          <style>{previewCss}</style>
          <div style={{ width: pw * scale, height: boxHeight * scale }} className="shrink-0">
            <div
              className="bg-white shadow-2xl relative origin-top-left"
              style={{
                width: pw, height: boxHeight,
                paddingTop: mTop, paddingBottom: mBottom, paddingLeft: mLeft, paddingRight: mRight,
                transform: `scale(${scale})`,
                color: '#111',
              }}
            >
              <div className="wd-measure" dangerouslySetInnerHTML={{ __html: showPaged ? (pages[pageIndex] || '') : (pages[0] || bodyHtml) }} />
              {pageNumbers && showPaged && (
                <div
                  className={`absolute left-0 right-0 ${posClass} text-[#111]`}
                  style={{ bottom: Math.max(mBottom / 2 - 8, 8), paddingLeft: mLeft, paddingRight: mRight, fontSize: 12 }}
                >
                  {pageIndex + 1}
                </div>
              )}
            </div>
          </div>
          {showPaged && total > 1 && (
            <div className="flex items-center gap-4 mt-4 text-gray-300">
              <button type="button" disabled={pageIndex === 0} onClick={() => setPageIndex(i => i - 1)}
                className="p-1.5 rounded-md hover:bg-white/5 disabled:opacity-30 cursor-pointer disabled:cursor-default">
                <ChevronLeft className="w-5 h-5" />
              </button>
              <span className="text-xs font-semibold tabular-nums">Page {pageIndex + 1} of {total}</span>
              <button type="button" disabled={pageIndex === total - 1} onClick={() => setPageIndex(i => i + 1)}
                className="p-1.5 rounded-md hover:bg-white/5 disabled:opacity-30 cursor-pointer disabled:cursor-default">
                <ChevronRight className="w-5 h-5" />
              </button>
            </div>
          )}
        </div>

        {/* Options */}
        <div className="w-72 shrink-0 border-l border-gray-800/60 bg-[#011419] p-5 flex flex-col gap-5 overflow-y-auto custom-scrollbar">
          <div className="space-y-2">
            <span className="caption">Format</span>
            <Segmented value={format} onChange={setFormat} options={[
              { value: 'pdf', label: 'PDF', icon: FileDown },
              { value: 'docx', label: 'Word', icon: FileText },
            ]} />
          </div>

          <div className="space-y-3 border-t border-gray-800/50 pt-4">
            <Toggle checked={pageNumbers} onChange={setPageNumbers} label="Page numbers" />
            {pageNumbers && (
              <div className="space-y-2">
                <span className="caption flex items-center gap-1"><Hash className="w-3 h-3" /> Position</span>
                <Segmented value={numberPos} onChange={setNumberPos} options={[
                  { value: 'left', label: 'Left' },
                  { value: 'center', label: 'Center' },
                  { value: 'right', label: 'Right' },
                ]} />
                {format === 'docx' && (
                  <div className="space-y-1 pt-1">
                    <span className="caption">Start at page</span>
                    <input
                      type="number" min="1"
                      value={pageNumberStart}
                      onChange={(e) => setPageNumberStart(Math.max(1, parseInt(e.target.value, 10) || 1))}
                      className="w-20 bg-[#00080B] border border-gray-800 text-gray-200 text-sm rounded-md px-2.5 py-1.5 focus:outline-none focus:border-accent"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mt-auto pt-4 border-t border-gray-800/50 flex gap-2">
            <Button variant="ghost" onClick={onClose} className="flex-1">Cancel</Button>
            <Button variant="primary" onClick={handleExport} disabled={exporting} className="flex-1">
              {exporting ? 'Exporting…' : 'Export'}
            </Button>
          </div>
        </div>
      </div>

      {/* Hidden measuring surface at true content width (off-screen, not scaled). */}
      <div
        aria-hidden
        ref={measureRef}
        className="wd-measure"
        style={{ position: 'fixed', left: -99999, top: 0, width: contentWidth, visibility: 'hidden', pointerEvents: 'none' }}
      />
    </Modal>
  );
}
