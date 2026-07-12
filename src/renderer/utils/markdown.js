import hljs from 'highlight.js';

export function escapeHTML(str) {
    return str.replace(/[&<>'"]/g, tag => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        "'": '&#39;',
        '"': '&quot;'
    }[tag] || tag));
}

// Reject dangerous URL schemes (javascript:, vbscript:, non-image data:) so AI-generated or
// imported markdown cannot inject script via image/link URLs. Returns '' for unsafe URLs.
export function sanitizeUrl(url) {
    const trimmed = String(url || '').trim();
    // Strip whitespace/control chars before the scheme check so obfuscation like
    // "java\tscript:" or "java\nscript:" cannot slip past.
    const scheme = trimmed.replace(new RegExp('[\u0000-\u0020]+', 'g'), '').toLowerCase();
    if (/^(?:javascript|vbscript|file|about):/.test(scheme)) return '';
    if (/^data:/.test(scheme) && !/^data:image\//.test(scheme)) return '';
    return trimmed;
}

export function parseInlineMarkdown(text) {
    let safeText = escapeHTML(text);
    safeText = safeText.replace(/\*\*(.*?)\*\*/g, '<strong class="text-accent font-bold">$1</strong>');
    safeText = safeText.replace(/\*(.*?)\*/g, '<em class="italic text-gray-300">$1</em>');
    safeText = safeText.replace(/`(.*?)`/g, '<code class="bg-[#1a2d32] text-accent px-1.5 py-0.5 rounded text-xs font-mono border border-gray-700/60" style="display: inline !important; width: auto !important; white-space: normal !important; vertical-align: baseline;">$1</code>');

    return safeText;
}

export function parseMarkdown(text, lineNumbersEnabled = false) {
    if (!text) return '';

    let codeBlocks = [];
    let imageBlocks = [];

    let parsedText = text.replace(/^(#{1,6})\s+(.*)$/gm, '\n\n$1 $2\n\n');

    const codeBlockRegex = /```([a-zA-Z0-9]*)[ \t]*\n?([\s\S]*?)```/g;
    parsedText = parsedText.replace(codeBlockRegex, (match, lang, code) => {
        const id = 'code-' + Date.now() + '-' + Math.floor(Math.random() * 1000);
        const langLabel = lang ? lang.toUpperCase() : 'CODE';

        let coloredCode = '';
        const rawCode = code.trim();
        const lineCount = rawCode.split('\n').length;
        const lineNumbers = Array.from({length: lineCount}, (_, i) => i + 1).join('\n');

        try {
            if (lang && hljs.getLanguage(lang)) {
                coloredCode = hljs.highlight(rawCode, { language: lang }).value;
            } else {
                coloredCode = hljs.highlightAuto(rawCode).value;
            }
        } catch (e) {
            coloredCode = escapeHTML(rawCode);
        }

        const codeWidgetHtml = `
        <div class="my-4 rounded-lg overflow-hidden bg-[#011419] border border-gray-800 shadow-lg font-sans select-none w-full min-w-0 max-w-full">
            <div class="flex items-center justify-between px-4 py-2 bg-[#0a161d] border-b border-gray-800 shrink-0">
                <span class="text-xs font-semibold text-gray-400 uppercase tracking-wider font-mono">${langLabel}</span>
                <button class="text-xs text-gray-400 hover:text-accent transition-colors flex items-center space-x-1 bg-transparent border-none cursor-pointer btn-copy-code" data-code-id="${id}">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="display:inline"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    <span class="copy-text ml-1" style="margin-left:4px">Copy</span>
                </button>
            </div>
            <div class="flex hljs w-full min-w-0 max-w-full">
                ${lineNumbersEnabled ? `<div class="code-line-numbers whitespace-pre p-4 pr-3 text-right text-sm font-mono border-r border-gray-800/40 select-none opacity-50 leading-relaxed shrink-0">${lineNumbers}</div>` : ''}
                <div class="p-4 overflow-x-auto select-text w-full min-w-0 max-w-full">
                    <pre class="m-0 p-0 leading-relaxed min-w-0 max-w-full"><code id="${id}" class="text-sm font-mono whitespace-pre bg-transparent min-w-0 max-w-full">${coloredCode}</code></pre>
                </div>
            </div>
        </div>`;

        codeBlocks.push(codeWidgetHtml);
        return `\n\n__CODE_BLOCK_PLACEHOLDER_${codeBlocks.length - 1}__\n\n`;
    });

    parsedText = parsedText.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
        const cleanUrl = sanitizeUrl(url);
        if (!cleanUrl) return ''; // drop images whose URL uses an unsafe scheme

        const srcAttr = escapeHTML(cleanUrl);
        const altAttr = escapeHTML(alt);

        // Build a value that is safe inside BOTH the double-quoted onclick attribute and the
        // single-quoted JS string it wraps. Do NOT HTML-entity-escape the apostrophe here: the
        // browser decodes entities before the JS parser runs, which would re-open the string.
        // Backslash-escape it for JS, and HTML-escape only the attribute-breaking characters.
        const jsUrl = cleanUrl
            .replace(/\\/g, '\\\\')
            .replace(/'/g, "\\'")
            .replace(/"/g, '&quot;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/[\r\n]/g, '');

        const imgHtml = `
            <div class="my-3 rounded-lg overflow-hidden border border-gray-800/80 shadow-md inline-block">
                <img src="${srcAttr}" alt="${altAttr}" class="max-w-full h-auto object-cover max-h-[400px] cursor-zoom-in hover:opacity-90 transition-opacity" onclick="window.open('${jsUrl}', '_blank')">
            </div>`;
        imageBlocks.push(imgHtml);
        return `\n\n__IMAGE_BLOCK_PLACEHOLDER_${imageBlocks.length - 1}__\n\n`;
    });

    const blocks = parsedText.split(/\n\s*\n/);
    let htmlResult = [];
    let inList = false;
    let listType = '';

    blocks.forEach(block => {
        let trimmedBlock = block.trim();
        if (!trimmedBlock) return;

        const closeListIfNeeded = () => {
            if (inList) { htmlResult.push(`</${listType}>`); inList = false; listType = ''; }
        };

        if (trimmedBlock.startsWith('__CODE_BLOCK_PLACEHOLDER_') && trimmedBlock.endsWith('__')) {
            closeListIfNeeded();
            const index = parseInt(trimmedBlock.replace('__CODE_BLOCK_PLACEHOLDER_', '').replace('__', ''));
            htmlResult.push(codeBlocks[index]);
            return;
        }

        if (trimmedBlock.startsWith('__IMAGE_BLOCK_PLACEHOLDER_') && trimmedBlock.endsWith('__')) {
            closeListIfNeeded();
            const index = parseInt(trimmedBlock.replace('__IMAGE_BLOCK_PLACEHOLDER_', '').replace('__', ''));
            htmlResult.push(imageBlocks[index]);
            return;
        }

        // --- HORIZONTAL RULES ---
        if (/^(?:---|===|\*\*\*|___)\s*$/.test(trimmedBlock)) {
            closeListIfNeeded();
            htmlResult.push('<hr class="border-gray-800 my-4" />');
            return;
        }

        // --- TABLES ---
        if (trimmedBlock.startsWith('|') && trimmedBlock.includes('\n')) {
            const lines = trimmedBlock.split('\n').map(l => l.trim()).filter(Boolean);
            if (lines.length >= 2) {
                const isDelimiter = /^\|(?:\s*[:-]*\s*\|)+$/.test(lines[1]);
                if (isDelimiter) {
                    closeListIfNeeded();
                    const headers = lines[0].split('|').map(s => s.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
                    const rows = [];
                    for (let i = 2; i < lines.length; i++) {
                        const cols = lines[i].split('|').map(s => s.trim()).filter((_, idx, arr) => idx > 0 && idx < arr.length - 1);
                        rows.push(cols);
                    }
                    let tableHtml = `
                    <div class="my-4 overflow-x-auto border border-gray-800 rounded-lg select-text">
                        <table class="min-w-full divide-y divide-gray-800 text-xs text-left text-gray-200">
                            <thead class="bg-[#0a161d] text-gray-400 font-bold uppercase tracking-wider text-[10px]">
                                <tr>
                                    ${headers.map(h => `<th class="px-4 py-2 border-r border-gray-800 last:border-r-0">${parseInlineMarkdown(h)}</th>`).join('')}
                                </tr>
                            </thead>
                            <tbody class="divide-y divide-gray-800/60 bg-[#051116]/50">
                                ${rows.map(row => `
                                    <tr class="hover:bg-white/5 transition-colors">
                                        ${row.map(cell => `<td class="px-4 py-2 border-r border-gray-800 last:border-r-0">${parseInlineMarkdown(cell)}</td>`).join('')}
                                    </tr>
                                `).join('')}
                            </tbody>
                        </table>
                    </div>`;
                    htmlResult.push(tableHtml);
                    return;
                }
            }
        }

        const headingMatch = /^(#{1,6})\s+(.+)$/.exec(trimmedBlock);
        if (headingMatch) {
            closeListIfNeeded();
            const level = headingMatch[1].length;
            const headingClasses = {
                1: 'text-lg font-bold text-white border-b border-gray-800 pb-2 mt-6 mb-3',
                2: 'text-base font-bold text-white border-b border-gray-800 pb-1 mt-6 mb-2',
                3: 'text-sm font-bold text-accent uppercase tracking-wider mt-5 mb-2',
                4: 'text-sm font-bold text-accent mt-4 mb-2',
                5: 'text-sm font-semibold text-gray-200 mt-4 mb-2',
                6: 'text-xs font-semibold text-gray-300 uppercase tracking-wider mt-3 mb-1'
            };
            htmlResult.push(`<h${level} class="${headingClasses[level]}">${parseInlineMarkdown(headingMatch[2])}</h${level}>`);
            return;
        }

        const lines = block.split('\n');

        let isOrderedList = lines.every(line => /^\s*\d+\.\s+/.test(line)) || /^\s*\d+\.\s+/.test(lines[0]);
        let isUnorderedList = lines.every(line => /^\s*[\*\-]\s+/.test(line)) || /^\s*[\*\-]\s+/.test(lines[0]);

        if (isOrderedList || isUnorderedList) {
            let currentType = isOrderedList ? 'ol' : 'ul';
            let listClass = isOrderedList ? 'list-decimal' : 'list-disc';

            if (inList && listType !== currentType) {
                closeListIfNeeded();
            }

            if (!inList) {
                htmlResult.push(`<${currentType} class="my-2 space-y-1 ml-4 ${listClass}">`);
                inList = true;
                listType = currentType;
            }

            lines.forEach(line => {
                let cleanLine = line.replace(/^\s*([\*\-]|\d+\.)\s+/, '');
                htmlResult.push(`<li class="pl-1 text-sm text-gray-200 leading-relaxed">${parseInlineMarkdown(cleanLine)}</li>`);
            });
            return;
        }

        closeListIfNeeded();
        let parsedParagraph = lines.map(line => parseInlineMarkdown(line)).join('<br>');
        htmlResult.push(`<p class="mb-3 last:mb-0 leading-relaxed text-sm text-gray-200">${parsedParagraph}</p>`);
    });

    if (inList) { htmlResult.push(`</${listType}>`); }

    return htmlResult.join('\n');
}
