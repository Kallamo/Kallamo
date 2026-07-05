import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Modal from './ui/Modal';
import Button from './ui/Button';
import Checkbox from './ui/Checkbox';
import { ChevronLeft, ChevronRight, FileDown, FileText, Hash, BookOpen } from 'lucide-react';
import { proseCss, buildExportHtml } from './writingExport';
import { chapterJsonToHtml } from './writingExtensions';

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

  // Chapter blocks must be flat siblings (not wrapped per chapter), or paginateBlocks
  // treats a whole chapter as one atomic block. A TOC takes the first page(s), so the
  // first chapter must also break after it; without a TOC it stays on page 1.
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
      <Modal onClose={onClose} size="xl" title="Export Folder" icon={BookOpen} className="!max-w-5xl">
        <div className="h-64 flex items-center justify-center text-gray-500 text-sm">Loading chapters…</div>
      </Modal>
    );
  }

  return (
    <Modal onClose={onClose} size="xl" title={`Export Folder: ${folderTitle}`} icon={BookOpen} className="!max-w-5xl">
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
          {total > 1 && (
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
          <p className="text-[11px] text-gray-500 leading-snug">
            {activeChapters.length} of {chapters.length} chapter{chapters.length === 1 ? '' : 's'} · using page setup from "{firstTitle}"
          </p>

          <div className="space-y-2">
            <span className="caption">Format</span>
            <Segmented value={format} onChange={setFormat} options={[
              { value: 'pdf', label: 'PDF', icon: FileDown },
              { value: 'docx', label: 'Word', icon: FileText },
            ]} />
          </div>

          <div className="space-y-3 border-t border-gray-800/50 pt-4">
            <Toggle checked={includeToc} onChange={setIncludeToc} label="Table of contents" disabled={activeChapters.length < 2} />
            {includeToc && (
              <div className="space-y-2">
                <div className="space-y-1">
                  <span className="caption">Heading</span>
                  <input
                    value={tocTitle}
                    onChange={(e) => setTocTitle(e.target.value)}
                    placeholder="Table of Contents"
                    className="w-full bg-[#00080B] border border-gray-800 text-gray-200 text-sm rounded-md px-2.5 py-1.5 focus:outline-none focus:border-accent"
                  />
                </div>
                <div className="space-y-1">
                  <span className="caption">Heading position</span>
                  <Segmented value={tocPos} onChange={setTocPos} options={[
                    { value: 'left', label: 'Left' },
                    { value: 'center', label: 'Center' },
                    { value: 'right', label: 'Right' },
                  ]} />
                </div>
              </div>
            )}
            <Toggle checked={chapterTitles} onChange={setChapterTitles} label="Chapter titles" />
            <Toggle checked={numberChapters} onChange={setNumberChapters} label="Number chapters" disabled={!chapterTitles && !includeToc} />
            <div className="space-y-1.5">
              <span className="caption">Chapters to include</span>
              <div className="space-y-1.5 max-h-44 overflow-y-auto custom-scrollbar pr-1">
                {chapters.map((ch, idx) => {
                  const activeIndex = activeChapters.findIndex(a => a.id === ch.id);
                  const num = numberChapters && activeIndex >= 0 ? `${activeIndex + 1}. ` : '';
                  return (
                    <Checkbox
                      key={ch.id}
                      size="sm"
                      checked={isIn(ch.id)}
                      onChange={(v) => setIncluded(prev => ({ ...prev, [ch.id]: v }))}
                      label={`${num}${ch.title || `Chapter ${idx + 1}`}`}
                    />
                  );
                })}
              </div>
            </div>
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
                      className="no-spinner w-20 bg-[#00080B] border border-gray-800 text-gray-200 text-sm rounded-md px-2.5 py-1.5 focus:outline-none focus:border-accent"
                    />
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="mt-auto pt-4 border-t border-gray-800/50 flex gap-2">
            <Button variant="ghost" onClick={onClose} className="flex-1">Cancel</Button>
            <Button variant="primary" onClick={handleExport} disabled={exporting || !activeChapters.length} className="flex-1">
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
