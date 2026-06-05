const fs = require('fs');
const path = require('path');
const { escapeHTML, parseMarkdown } = require('../utils/markdown.js');

// --- FORM ERROR HANDLING ---
function triggerFieldError(inputId) {
    const input = document.getElementById(inputId);
    if (!input) return;
    const label = input.previousElementSibling;
    input.classList.remove('border-gray-800', 'focus:border-[#DDBA6E]');
    input.classList.add('border-red-500', 'focus:border-red-500');
    if (label) label.classList.add('text-red-500');
    
    let count = 0;
    const blink = setInterval(() => {
        input.classList.toggle('border-red-500');
        if (label) label.classList.toggle('text-red-500');
        count++;
        if (count >= 5) {
            clearInterval(blink);
            input.classList.add('border-red-500');
            if (label) label.classList.add('text-red-500');
            setTimeout(() => clearFieldError(input, label), 3500);
        }
    }, 150);

    input.addEventListener('input', () => clearFieldError(input, label), { once: true });
    input.addEventListener('change', () => clearFieldError(input, label), { once: true });
}

function clearFieldError(input, label) {
    input.classList.remove('border-red-500', 'focus:border-red-500');
    input.classList.add('border-gray-800', 'focus:border-[#DDBA6E]');
    if (label) label.classList.remove('text-red-500');
}

// --- MESSAGE BUBBLE GENERATOR ---
function renderChatMessage(container, role, text, aiName, aiColor, attachedFiles, chatId, chatsDir, msgIndex = -1, isLastUserMsg = false, isLastAiMsg = false, debugNotice = null) {
    if(!container) return;
    const messageDiv = document.createElement('div');
    messageDiv.className = `flex w-full mb-6 ${role === 'user' ? 'justify-end' : 'justify-start'} group`;

    // 1. Action Buttons Setup
    let actionButtonsHTML = '';
    const copyBtn = `
        <button class="chat-action-btn flex items-center space-x-1 text-[11px] text-gray-500 hover:text-[var(--app-accent)] transition-colors p-1" data-action="copy" data-index="${msgIndex}">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
            <span>Copy</span>
        </button>
    `;

    if (role === 'user') {
        if (isLastUserMsg) {
            actionButtonsHTML += `
                <button class="chat-action-btn flex items-center space-x-1 text-[11px] text-gray-500 hover:text-[var(--app-accent)] transition-colors p-1" data-action="edit-user" data-index="${msgIndex}">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    <span>Edit</span>
                </button>
            `;
        }
        actionButtonsHTML += copyBtn;
    } else {
        actionButtonsHTML += copyBtn;
        actionButtonsHTML += `
            <button class="chat-action-btn flex items-center space-x-1 text-[11px] text-gray-500 hover:text-[var(--app-accent)] transition-colors p-1" data-action="edit-ai" data-index="${msgIndex}">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                <span>Edit</span>
            </button>
        `;
        if (isLastAiMsg) {
            actionButtonsHTML += `
                <button class="chat-action-btn flex items-center space-x-1 text-[11px] text-gray-500 hover:text-green-400 transition-colors p-1" data-action="regenerate" data-index="${msgIndex}">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>
                    <span>Regenerate</span>
                </button>
            `;
        }
    }

    const actionsBar = `
        <div class="msg-actions opacity-0 group-hover:opacity-100 transition-opacity flex space-x-3 mt-1.5 ${role === 'user' ? 'justify-end pr-2' : 'justify-start pl-2'} w-full">
            ${actionButtonsHTML}
        </div>
    `;

    // 2. Main HTML structure
    if (role === 'user') {
        let filesHTML = '';
        if (attachedFiles && attachedFiles.length > 0) {
            filesHTML = `<div class="flex flex-wrap gap-2 mb-3 w-full justify-end">`;
            attachedFiles.forEach(fName => {
                filesHTML += `
                <div class="flex items-center bg-[#1a2d32] border border-gray-700 hover:border-gray-500 cursor-pointer transition-colors rounded-md px-2 py-1.5 space-x-2 max-w-[200px] shadow-sm chat-inline-file" data-filename="${escapeHTML(fName)}">
                    <svg class="text-[var(--app-accent)] shrink-0" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>
                    <span class="text-xs text-gray-200 font-medium truncate w-full" title="${escapeHTML(fName)}">${escapeHTML(fName)}</span>
                </div>`;
            });
            filesHTML += `</div>`;
        }

        messageDiv.innerHTML = `
            <div class="flex flex-col items-end w-fit max-w-[80%] relative ml-auto msg-wrapper">
                <div class="msg-bubble border border-gray-800/80 rounded-2xl rounded-tr-sm p-4 w-fit shadow-md flex flex-col items-end backdrop-blur-sm transition-colors" style="background-color: rgba(5, 17, 22, var(--user-bg-opacity, 1));">
                    <button class="expand-msg-btn hidden absolute -top-3 -right-3 bg-[#1a2d32] border border-gray-700 text-gray-400 hover:text-white p-1.5 rounded-full shadow-lg transition-colors z-10" title="Expand message">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>
                    </button>
                    ${filesHTML}
                    <div class="msg-content text-sm text-gray-200 whitespace-normal break-words leading-relaxed w-fit">${parseMarkdown(text)}</div>
                </div>
                ${actionsBar}
            </div>`;
    } else {
        // Build the Debug Eyebrow if it exists
        let debugNoticeHTML = '';
        if (debugNotice) {
            debugNoticeHTML = `
                <div class="flex items-center space-x-1.5 text-[9px] font-mono tracking-wide bg-black/40 border border-gray-800/80 text-gray-400 px-2 py-1 rounded w-fit mb-3">
                    <svg class="text-[var(--app-accent)]" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>
                    <span>${escapeHTML(debugNotice)}</span>
                </div>
            `;
        }

        messageDiv.innerHTML = `
            <div class="max-w-[85%] px-2 flex flex-col items-start w-fit relative msg-wrapper">
                <div class="msg-bubble border border-gray-800/50 rounded-2xl rounded-tl-sm p-4 w-fit shadow-md flex flex-col items-start backdrop-blur-sm transition-colors relative z-10" style="background-color: rgba(10, 22, 29, var(--ai-bg-opacity, 0));">
                    ${debugNoticeHTML}
                    <div class="text-[11px] font-bold uppercase tracking-widest mb-3 flex items-center space-x-2" style="color: ${aiColor}">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2a2 2 0 0 1 2 2c-.11 1.56 1.27 2.22 2.83 2.12a2 2 0 0 1 2.24 2.24c-.1 1.56.56 2.94 2.12 2.83a2 2 0 0 1 2 2c-.11 1.56 1.27 2.22 2.83 2.12a2 2 0 0 1 2.24 2.24c-.1 1.56.56 2.94 2.12 2.83a2 2 0 0 1 2 2"></path></svg>
                        <span>${escapeHTML(aiName)}</span>
                    </div>
                    <div class="msg-content w-fit text-sm text-gray-100 whitespace-normal break-words leading-relaxed">${parseMarkdown(text)}</div>
                </div>
                ${actionsBar}
            </div>`;
    }
    
    container.appendChild(messageDiv);
    container.scrollTop = container.scrollHeight;

    // 3. Attach Events
    if (role === 'user') {
        messageDiv.querySelectorAll('.chat-inline-file').forEach(btn => {
            btn.addEventListener('click', () => {
                openFileViewerModal(chatId, btn.getAttribute('data-filename'), chatsDir);
            });
        });

        const content = messageDiv.querySelector('.msg-content');
        const btnExpand = messageDiv.querySelector('.expand-msg-btn');
        setTimeout(() => {
            if (content && btnExpand && content.scrollHeight > content.clientHeight) {
                btnExpand.classList.remove('hidden'); 
                btnExpand.addEventListener('click', () => {
                    content.classList.toggle('line-clamp-5');
                    if (content.classList.contains('line-clamp-5')) {
                        btnExpand.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"></polyline><polyline points="9 21 3 21 3 15"></polyline><line x1="21" y1="3" x2="14" y2="10"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;
                    } else {
                        btnExpand.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 14 10 14 10 20"></polyline><polyline points="20 10 14 10 14 4"></polyline><line x1="14" y1="10" x2="21" y2="3"></line><line x1="3" y1="21" x2="10" y2="14"></line></svg>`;
                    }
                });
            }
        }, 10);
    }
}

// --- FILE VIEWER MODAL ---
function openFileViewerModal(chatId, fileName, chatsDir) {
    const filePath = path.join(chatsDir, chatId, 'Files', fileName);
    if (!fs.existsSync(filePath)) return;

    let modal = document.getElementById('file-viewer-modal');
    if (!modal) {
        modal = document.createElement('div');
        modal.id = 'file-viewer-modal';
        modal.className = 'fixed inset-0 bg-black/90 z-[999] hidden flex items-center justify-center p-8 backdrop-blur-sm';
        modal.innerHTML = `
            <button id="close-file-viewer" class="absolute top-6 right-6 text-gray-400 hover:text-white bg-[#0a141d] hover:bg-gray-800 p-2 rounded-full transition-colors z-10 shadow-lg">
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
            </button>
            <div id="file-viewer-content" class="w-full h-full flex items-center justify-center relative"></div>
        `;
        document.body.appendChild(modal);
        document.getElementById('close-file-viewer').addEventListener('click', () => {
            modal.classList.add('hidden');
            document.getElementById('file-viewer-content').innerHTML = '';
        });
    }

    const ext = fileName.split('.').pop().toLowerCase();
    const contentContainer = document.getElementById('file-viewer-content');
    contentContainer.innerHTML = '';

    try {
        const fileData = fs.readFileSync(filePath);
        const base64 = fileData.toString('base64');
        let src = "";

        if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) {
            src = `data:image/${ext};base64,${base64}`;
            contentContainer.innerHTML = `<img src="${src}" class="max-w-full max-h-full object-contain rounded shadow-2xl">`;
        } 
        else if (['mp4', 'webm', 'ogg'].includes(ext)) {
            src = `data:video/${ext};base64,${base64}`;
            contentContainer.innerHTML = `<video src="${src}" controls autoplay class="max-w-full max-h-full rounded shadow-2xl"></video>`;
        } 
        else if (['pdf', 'txt', 'md', 'json', 'css', 'html'].includes(ext)) {
            const mime = ext === 'pdf' ? 'application/pdf' : 'text/plain';
            src = `data:${mime};base64,${base64}`;
            contentContainer.innerHTML = `<iframe src="${src}" class="w-full h-full bg-white rounded shadow-2xl"></iframe>`;
        } 
        else {
            contentContainer.innerHTML = `
                <div class="text-center">
                    <svg class="text-gray-500 mx-auto mb-4" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path></svg>
                    <p class="text-gray-300">Preview not available for this file type.</p>
                    <p class="text-xs text-[#DDBA6E] mt-2 font-mono">${fileName}</p>
                </div>
            `;
        }
        
        modal.classList.remove('hidden');
    } catch (err) {
        console.error("Error loading file preview:", err);
    }
}

module.exports = {
    triggerFieldError,
    clearFieldError,
    renderChatMessage,
    openFileViewerModal
};