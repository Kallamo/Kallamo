const hljs = require('highlight.js');

function escapeHTML(str) { 
    return str.replace(/[&<>'"]/g, tag => ({ 
        '&': '&amp;', 
        '<': '&lt;', 
        '>': '&gt;', 
        "'": '&#39;', 
        '"': '&quot;' 
    }[tag] || tag)); 
}

function parseInlineMarkdown(text) {
    let safeText = escapeHTML(text);
    safeText = safeText.replace(/\*\*(.*?)\*\*/g, '<strong class="text-[#DDBA6E] font-bold">$1</strong>');
    safeText = safeText.replace(/\*(.*?)\*/g, '<em class="italic text-gray-300">$1</em>');
    safeText = safeText.replace(/`(.*?)`/g, '<code class="bg-[#1a2d32] text-[#DDBA6E] px-1.5 py-0.5 rounded text-xs font-mono border border-gray-700/60" style="display: inline !important; width: auto !important; white-space: normal !important; vertical-align: baseline;">$1</code>');   
     
    return safeText;
}

function parseMarkdown(text) {
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
                <button class="text-xs text-gray-400 hover:text-[var(--app-accent)] transition-colors flex items-center space-x-1 bg-transparent border-none cursor-pointer" onclick="copyCodeToClipboard('${id}', this)">
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                    <span class="copy-text ml-1">Copy</span>
                </button>
            </div>
            <div class="flex bg-[#051116] w-full min-w-0 max-w-full">
                <div class="code-line-numbers hidden whitespace-pre p-4 pr-3 text-right text-sm font-mono text-gray-600 border-r border-gray-800 select-none opacity-50 leading-relaxed shrink-0">${lineNumbers}</div>
                <div class="p-4 overflow-x-auto select-text w-full min-w-0 max-w-full">
                    <pre class="m-0 p-0 leading-relaxed min-w-0 max-w-full"><code id="${id}" class="text-sm font-mono whitespace-pre hljs bg-transparent min-w-0 max-w-full">${coloredCode}</code></pre>
                </div>
            </div>
        </div>`;
        
        codeBlocks.push(codeWidgetHtml);
        return `\n\n__CODE_BLOCK_PLACEHOLDER_${codeBlocks.length - 1}__\n\n`;
    });

    parsedText = parsedText.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, url) => {
        const imgHtml = `
            <div class="my-3 rounded-lg overflow-hidden border border-gray-800/80 shadow-md inline-block">
                <img src="${url}" alt="${alt}" class="max-w-full h-auto object-cover max-h-[400px] cursor-zoom-in hover:opacity-90 transition-opacity" onclick="window.open('${url}', '_blank')">
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

        if (trimmedBlock.startsWith('### ')) {
            closeListIfNeeded();
            htmlResult.push(`<h3 class="text-sm font-bold text-[var(--app-accent)] uppercase tracking-wider mt-5 mb-2">${parseInlineMarkdown(trimmedBlock.substring(4))}</h3>`);
            return;
        }
        if (trimmedBlock.startsWith('## ')) {
            closeListIfNeeded();
            htmlResult.push(`<h2 class="text-base font-bold text-white border-b border-gray-800 pb-1 mt-6 mb-2">${parseInlineMarkdown(trimmedBlock.substring(3))}</h2>`);
            return;
        }
        if (trimmedBlock.startsWith('# ')) {
            closeListIfNeeded();
            htmlResult.push(`<h1 class="text-lg font-bold text-white border-b border-gray-800 pb-2 mt-6 mb-3">${parseInlineMarkdown(trimmedBlock.substring(2))}</h1>`);
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

window.copyCodeToClipboard = function(elementId, btnElement) {
    const codeElement = document.getElementById(elementId);
    if (codeElement) {
        navigator.clipboard.writeText(codeElement.innerText).then(() => {
            const textSpan = btnElement.querySelector('.copy-text');
            textSpan.innerText = 'Copied!';
            btnElement.classList.add('text-green-400');
            btnElement.classList.remove('text-gray-400', 'hover:text-[#DDBA6E]');
            
            setTimeout(() => {
                textSpan.innerText = 'Copy';
                btnElement.classList.remove('text-green-400');
                btnElement.classList.add('text-gray-400', 'hover:text-[#DDBA6E]');
            }, 2000);
        });
    }
}

module.exports = {
    escapeHTML,
    parseMarkdown
};