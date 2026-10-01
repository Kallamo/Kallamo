import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Modal from './ui/Modal';
import Checkbox from './ui/Checkbox';
import SegmentedControl from './ui/SegmentedControl';
import { Book } from 'lucide-react';
import { ExportFooter, FormatChoice, OptionGroup, PageNav, PageNumberOptions, ToggleRow } from './WritingExportParts';
import { proseCss, buildExportHtml } from './writingExport';
import { chapterJsonToHtml } from './writingExtensions';

// Greedy block-level pagination; a `.wd-chapter-start` block always forces a new page.
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

function escapeHtml(s) {
  return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function buildTocHtml(heading, align, entries) {
  const rows = entries.map(({ title, page }) => `
    <div class="wd-toc-row" style="display:flex; align-items:baseline; gap:8px; margin-bottom:10px;">
      <span style="flex-shrink:0;">${escapeHtml(title)}</span>
      <span style="flex:1; border-bottom:1px dotted #999; transform:translateY(-4px);"></span>
      <span style="flex-shrink:0;">${page}</span>
    </div>
  `).join('');
  return `<h1 class="wd-chapter-start" style="text-align:${align || 'left'};">${escapeHtml(heading || 'Table of Contents')}</h1>${rows}`;
}

export default function ExportBookModal({ folderTitle, documents, electronAPI, onClose }) {
  const [format, setFormat] = useState('pdf');
  const [pageNumbers, setPageNumbers] = useState(false);
  const [numberPos, setNumberPos] = useState('center');
  const [pageNumberStart, setPageNumberStart] = useState(1);
  const [includeToc, setIncludeToc] = useState(true);
  const [tocTitle, setTocTitle] = useState('Table of Contents');
  const [tocPos, setTocPos] = useState('left');
  const [numberChapters, setNumberChapters] = useState(false);
  const [chapterTitles, setChapterTitles] = useState(true);
  const [included, setIncluded] = useState({}); // chapter id -> boolean
  const [pageIndex, setPageIndex] = useState(0);
  const [pages, setPages] = useState([]);
  const [contentHeight, setContentHeight] = useState(0);
  const [scale, setScale] = useState(1);
  const [exporting, setExporting] = useState(false);
  const [chapters, setChapters] = useState(null); // [{ id, title, content, ...geometry }]
  const [loading, setLoading] = useState(true);

  // Stable key so the gather effect doesn't re-run (and reset the include map) on
  // every parent re-render, since `documents` is a freshly filtered array each time.
  const docIdsKey = documents.map(d => d.id).join(',');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const docs = [];
      for (const d of documents) {
        const full = await electronAPI.getDocument(d.id);
        if (full) docs.push(full);
      }
      if (!cancelled) {
        setChapters(docs);
        setIncluded(prev => Object.fromEntries(docs.map(d => [d.id, prev[d.id] !== false])));
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docIdsKey, electronAPI]);

  const isIn = (id) => included[id] !== false;

  // Included chapters in order; numbering follows the active order so excluding one renumbers the rest.
  const activeChapters = useMemo(() => {
    if (!chapters) return [];
    return chapters
      .filter(ch => included[ch.id] !== false)
      .map((ch, i) => ({ ...ch, displayTitle: numberChapters ? `${i + 1}. ${ch.title || ''}` : (ch.title || '') }));
  }, [chapters, included, numberChapters]);

  const pageConfig = activeChapters[0] || (chapters && chapters[0]) || null;
  const firstTitle = pageConfig ? pageConfig.title : '';

  const pw = pageConfig?.pageWidth || 794;
  const ph = pageConfig?.pageHeight || 1123;
  const mTop = pageConfig?.marginTop ?? 96;
  const mBottom = pageConfig?.marginBottom ?? 96;
  const mLeft = pageConfig?.marginLeft ?? 96;
  const mRight = pageConfig?.marginRight ?? 96;
  const contentWidth = pw - mLeft - mRight;
  const pageContentHeight = ph - mTop - mBottom;

  // Chapter blocks must be flat siblings, or paginateBlocks treats a chapter as one atomic block.
  const tocPrecedes = includeToc && activeChapters.length >= 2;
  const bodyHtml = useMemo(() => {
    if (!activeChapters.length) return '';
    return activeChapters.map((ch, i) => {
      let json = ch.content;
      if (typeof json === 'string') {
        try { json = JSON.parse(json); } catch { json = null; }
      }
      const html = chapterJsonToHtml(json);
      const brk = (i === 0 && !tocPrecedes) ? '' : ' style="page-break-before:always;"';
      // The chapter-start marker carries the break: the heading, or an empty div when titles are off.
      if (chapterTitles) {
        return `<h1 class="wd-chapter-start"${brk}>${escapeHtml(ch.displayTitle)}</h1>${html}`;
      }
      return `<div class="wd-chapter-start"${brk}></div>${html}`;
    }).join('');
  }, [activeChapters, chapterTitles, tocPrecedes]);

  const measureRef = useRef(null);
  const previewColRef = useRef(null);
  const previewCss = useMemo(() => (pageConfig ? proseCss('.wd-measure', pageConfig) : ''), [pageConfig]);

  useLayoutEffect(() => {
    const el = measureRef.current;
    if (!el || !pageConfig) return;
    el.innerHTML = bodyHtml;
    setContentHeight(el.scrollHeight);
    const pgs = paginateBlocks(el, pageContentHeight);

    if (!includeToc || activeChapters.length < 2) {
      setPages(pgs);
      setPageIndex(i => Math.min(i, pgs.length - 1));
      return;
    }

    // Re-walk the same greedy logic to find which page each chapter starts on.
    const children = Array.from(el.children);
    const chapterPages = [];
    let pageNum = 0;
    let pageStartY = children[0]?.offsetTop || 0;
    let started = false;
    for (const child of children) {
      const forceBreak = child.classList.contains('wd-chapter-start') && started;
      const bottom = child.offsetTop + child.offsetHeight;
      if ((forceBreak || (bottom - pageStartY > pageContentHeight)) && started) {
        pageNum += 1;
        pageStartY = child.offsetTop;
      }
      if (child.classList.contains('wd-chapter-start')) {
        chapterPages.push(pageNum);
      }
      started = true;
    }

    const entries = activeChapters.map((ch, i) => ({ title: ch.displayTitle || `Chapter ${i + 1}`, page: chapterPages[i] != null ? chapterPages[i] + 1 : 1 }));
    el.innerHTML = buildTocHtml(tocTitle, tocPos, entries);
    const tocPages = paginateBlocks(el, pageContentHeight);
    const offset = tocPages.length;
    const shiftedEntries = entries.map(e => ({ ...e, page: e.page + offset }));
    el.innerHTML = buildTocHtml(tocTitle, tocPos, shiftedEntries);
    const finalTocPages = paginateBlocks(el, pageContentHeight);

    setPages([...finalTocPages, ...pgs]);
    setPageIndex(i => Math.min(i, finalTocPages.length + pgs.length - 1));
  }, [bodyHtml, previewCss, pageContentHeight, contentWidth, includeToc, tocTitle, tocPos, activeChapters, pageConfig]);

  useLayoutEffect(() => {
    const col = previewColRef.current;
    if (!col) return;
    const fit = () => {
      const avail = col.clientWidth - 48;
      setScale(Math.min(1, avail / pw));
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(col);
    return () => ro.disconnect();
  }, [pw]);

  const total = pages.length || 1;
  const boxHeight = ph;

  const handleExport = async () => {
    if (!activeChapters.length || exporting) return;
    setExporting(true);
    try {
      const margins = { top: mTop, right: mRight, bottom: mBottom, left: mLeft };
      const nums = pageNumbers ? { enabled: true, position: numberPos } : { enabled: false };
      let res;
      if (format === 'pdf') {
        // `pages` already holds the TOC-prefixed HTML; join it back for the export.
        const fullHtml = pages.join('');
        const html = buildExportHtml(fullHtml, pageConfig, {
          paginate: true, margins, contentHeight: contentHeight + mTop + mBottom,
        });
        res = await electronAPI.exportDocumentPdf({
          html, title: folderTitle,
          pageSize: pageConfig.pageSize, pageWidth: pw, pageHeight: ph,
          margins, paginate: true,
          pageNumbers: nums,
        });
      } else {
        const chapterPayload = activeChapters.map(ch => {
          let json = ch.content;
          if (typeof json === 'string') {
            try { json = JSON.parse(json); } catch { json = null; }
          }
          return { title: ch.displayTitle, docJson: json };
        });
        res = await electronAPI.exportBookDocx({
          chapters: chapterPayload, title: folderTitle,
          page: pageConfig, margins, pageNumbers: nums,
          pageNumberStart, toc: includeToc, tocTitle, tocAlign: tocPos, chapterTitles,
        });
      }
      if (res && !res.canceled) onClose();
    } finally {
      setExporting(false);
    }
  };

  const posClass = numberPos === 'left' ? 'text-left' : numberPos === 'right' ? 'text-right' : 'text-center';

  if (loading || !pageConfig) {
    return (
      <Modal onClose={onClose} size="2xl" title="Export folder" subtitle={folderTitle} icon={Book} className="!max-w-5xl">
        <div className="flex h-64 items-center justify-center text-sm text-text-subtle">Loading chapters…</div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} size="2xl" title="Export folder" subtitle={folderTitle} icon={Book} className="!max-w-5xl">
      <div className="flex min-h-0" style={{ height: '78vh' }}>
        <div ref={previewColRef} className="custom-scrollbar flex min-w-0 flex-1 flex-col items-center overflow-y-auto bg-black/30 px-4 py-6">
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
              <div className="wd-measure" dangerouslySetInnerHTML={{ __html: pages[pageIndex] || '' }} />
              {pageNumbers && (pageIndex + 1) >= pageNumberStart && (
                <div
                  className={`absolute left-0 right-0 ${posClass} text-[#111]`}
                  style={{ bottom: Math.max(mBottom / 2 - 8, 8), paddingLeft: mLeft, paddingRight: mRight, fontSize: 12 }}
                >
                  {pageIndex + 1}
                </div>
              )}
            </div>
          </div>
          <PageNav index={pageIndex} total={total} onChange={setPageIndex} />
        </div>

        <div className="flex w-[22rem] shrink-0 flex-col border-l border-border-subtle">
          <div className="custom-scrollbar flex flex-1 flex-col gap-5 overflow-y-auto p-5">
            <OptionGroup title="Chapters" trailing={<span className="text-xs tabular-nums text-text-subtle">{activeChapters.length} of {chapters.length}</span>}>
              <div className="custom-scrollbar -mx-1 flex max-h-56 flex-col gap-0.5 overflow-y-auto px-1">
                {chapters.map((ch, idx) => {
                  const activeIndex = activeChapters.findIndex(a => a.id === ch.id);
                  return (
                    <div key={ch.id} className="flex min-h-8 items-center gap-2.5">
                      <Checkbox
                        size="sm"
                        checked={isIn(ch.id)}
                        onChange={(v) => setIncluded(prev => ({ ...prev, [ch.id]: v }))}
                        ariaLabel={`Include ${ch.title || `Chapter ${idx + 1}`}`}
                      />
                      <span className="w-4 shrink-0 text-right text-xs tabular-nums text-text-subtle">{activeIndex >= 0 ? activeIndex + 1 : ''}</span>
                      <span className={`min-w-0 flex-1 text-sm leading-snug ${isIn(ch.id) ? 'text-text-secondary' : 'text-text-subtle'}`}>{ch.title || `Chapter ${idx + 1}`}</span>
                    </div>
                  );
                })}
              </div>
              <p className="text-xs leading-relaxed text-text-subtle">Paper and margins come from the first chapter, {firstTitle || 'Untitled'}.</p>
            </OptionGroup>

            <OptionGroup>
              <ToggleRow label="Table of contents" checked={includeToc} onChange={setIncludeToc} disabled={activeChapters.length < 2} bold />
              {includeToc && activeChapters.length >= 2 && (
                <>
                  <label className="block">
                    <span className="mb-1.5 block text-xs font-medium text-text-subtle">Heading</span>
                    <input
                      value={tocTitle}
                      onChange={(e) => setTocTitle(e.target.value)}
                      placeholder="Table of Contents"
                      className="h-9 w-full rounded-control border border-border-default bg-surface-input px-2.5 text-sm text-text-primary focus:border-accent/70 focus:outline-none"
                    />
                  </label>
                  <div>
                    <span className="mb-1.5 block text-xs font-medium text-text-subtle">Heading position</span>
                    <SegmentedControl label="Heading position" value={tocPos} onChange={setTocPos} className="w-full [&>button]:flex-1 [&>button]:justify-center"
                      options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }]} />
                  </div>
                </>
              )}
              {activeChapters.length < 2 && <p className="text-xs text-text-subtle">Needs at least two chapters.</p>}
            </OptionGroup>

            <OptionGroup>
              <ToggleRow label="Chapter titles" checked={chapterTitles} onChange={setChapterTitles} />
              <ToggleRow label="Number chapters" checked={numberChapters} onChange={setNumberChapters} disabled={!chapterTitles && !includeToc} />
            </OptionGroup>

            <OptionGroup>
              <PageNumberOptions
                enabled={pageNumbers} onEnabled={setPageNumbers}
                position={numberPos} onPosition={setNumberPos}
                format={format} start={pageNumberStart} onStart={setPageNumberStart}
              />
            </OptionGroup>

            <OptionGroup title="Format" last>
              <FormatChoice value={format} onChange={setFormat} />
            </OptionGroup>
          </div>
          <ExportFooter format={format} exporting={exporting} disabled={!activeChapters.length} onCancel={onClose} onExport={handleExport} />
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
