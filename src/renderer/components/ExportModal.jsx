import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Modal from './ui/Modal';
import { Download } from 'lucide-react';
import { ExportFooter, FormatChoice, OptionGroup, PageNav, PageNumberOptions } from './WritingExportParts';
import { proseCss, buildExportHtml } from './writingExport';

// Whole blocks never split; `.wd-chapter-start` forces a page, like the PDF's page-break-before.
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
  const paginate = true;
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
    <Modal onClose={onClose} size="2xl" title="Export" subtitle={title || null} icon={Download} className="!max-w-5xl">
      <div className="flex min-h-0" style={{ height: '78vh' }}>
        <div ref={previewColRef} className="custom-scrollbar flex min-w-0 flex-1 flex-col items-center overflow-y-auto bg-shade/30 px-4 py-6">
          <style>{previewCss}</style>
          <div style={{ width: pw * scale, height: boxHeight * scale }} className="shrink-0">
            <div
              className="relative origin-top-left bg-white shadow-overlay"
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
          {showPaged && <PageNav index={pageIndex} total={total} onChange={setPageIndex} />}
        </div>

        <div className="flex w-[21rem] shrink-0 flex-col border-l border-border-subtle">
          <div className="custom-scrollbar flex flex-1 flex-col gap-5 overflow-y-auto p-5">
            <OptionGroup title="Format">
              <FormatChoice value={format} onChange={setFormat} />
            </OptionGroup>
            <OptionGroup>
              <PageNumberOptions
                enabled={pageNumbers} onEnabled={setPageNumbers}
                position={numberPos} onPosition={setNumberPos}
                format={format} start={pageNumberStart} onStart={setPageNumberStart}
              />
            </OptionGroup>
            <p className="text-xs leading-relaxed text-text-subtle">Paper size, margins and fonts come from this chapter's page setup.</p>
          </div>
          <ExportFooter format={format} exporting={exporting} onCancel={onClose} onExport={handleExport} />
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
