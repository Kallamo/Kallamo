const { ipcRenderer, shell } = require('electron');
const fs = require('fs');
const path = require('path');
const { env } = require('@huggingface/transformers');

// --- Initialization Modals ---
try {
    const modalsContainer = document.getElementById('modals-container');
    if (modalsContainer) {
        const components = ['settings-modal.html', 'profile-modal.html', 'delete-modal.html', 'rename-modal.html', 'workflow-modal.html', 'summarize-modal.html', 'chat-modal.html', 'kb-manager-modal.html'];
        modalsContainer.innerHTML = components.map(file => fs.readFileSync(path.join(__dirname, 'components', file), 'utf8')).join('');
    }
} catch (e) {
    console.error("Modal injection failed:", e);
}

// --- Services & Utilities ---
const { sendApiRequest } = require(path.join(__dirname, 'js', 'services', 'ai', 'api-engine.js'));
const { extractTextFromFile, vectorizeChunks, searchKnowledgeBase, searchChatKnowledgeBase, searchChatMemories, saveChatMemory, trimContextWindow } = require(path.join(__dirname, 'js', 'services', 'ai', 'rag-engine.js'));
const { chunkText } = require(path.join(__dirname, 'js', 'utils', 'ragMath.js'))
const { triggerFieldError, clearFieldError, renderChatMessage, openFileViewerModal } = require(path.join(__dirname, 'js', 'ui', 'chat-components.js'));
const { openDeleteModal, openRenameModal, switchRightSidebarTab, initLayout } = require(path.join(__dirname, 'js', 'ui', 'layout.js'));
const { applyChatAppearance, setupAppearanceListeners } = require(path.join(__dirname, 'js', 'ui', 'appearance.js'));
const { escapeHTML } = require(path.join(__dirname, 'js', 'utils', 'markdown.js'));
const {
    dataDir, apiDir, profilesDir, chatsDir, workflowsDir,
    loadFilesFromDir, saveSingleFile, deleteSingleFile,
    loadChatsData, saveChatData, deleteChatFolder,
    loadProfilesData, saveProfileData, deleteProfileFolder,
    persistKnowledgeFiles, loadSettings, saveSettings
} = require(path.join(__dirname, 'js', 'services', 'storage.js'));

// Start Layout Engine
initLayout();

// --- Global Settings Engine ---
let appSettings = loadSettings();
const interfaceSettings = appSettings.interface;
const advancedSettings = appSettings.advanced;

function saveGlobalSettings() {
    saveSettings({ interface: interfaceSettings, advanced: advancedSettings });
}

const dynamicStyles = document.createElement('style');
document.head.appendChild(dynamicStyles);

function applyInterfaceSettings() {
    let css = '';

    let rootSize = '18px'; 
    if (interfaceSettings.fontSize === 'small') rootSize = '16px'; 
    if (interfaceSettings.fontSize === 'large') rootSize = '20px'; 
    css += `html { font-size: ${rootSize} !important; }`;

    if (interfaceSettings.fontFamily === 'serif') {
        css += `body, input, textarea, select, button { font-family: 'Merriweather', serif !important; }`;
    } else {
        css += `body, input, textarea, select, button { font-family: 'Inter', sans-serif !important; }`;
    }

    const accent = interfaceSettings.accentColor || '#DDBA6E';
    
        css += `
            :root { --app-accent: ${accent}; }
            .text-\\[\\#DDBA6E\\] { color: var(--app-accent) !important; }
            .bg-\\[\\#DDBA6E\\] { background-color: var(--app-accent) !important; }
            .border-\\[\\#DDBA6E\\] { border-color: var(--app-accent) !important; }
            .focus\\:border-\\[\\#DDBA6E\\]:focus { border-color: var(--app-accent) !important; }
            .focus\\:ring-\\[\\#DDBA6E\\]:focus { --tw-ring-color: var(--app-accent) !important; }
            .theme-accent-bg { background-color: var(--app-accent) !important; }
            .theme-peer-checked:checked ~ div { background-color: var(--app-accent) !important; }
            .peer:checked ~ .peer-checked\\:bg-\\[\\#DDBA6E\\] { background-color: var(--app-accent) !important; }
        `;

    css += `
        #chat-messages-container .flex,
        #chat-messages-container .flex-col,
        #chat-messages-container .msg-wrapper,
        #chat-messages-container .msg-bubble {
            min-width: 0 !important; 
            max-width: 100% !important;
        }
        
        #chat-messages-container .msg-content {
            min-width: 0 !important;
            max-width: 100% !important;
            overflow: hidden !important;
        }
        
        #chat-messages-container pre { 
            max-width: 100% !important; 
            overflow-x: auto !important; 
            padding: 1rem; 
            border-radius: 0.5rem; 
            white-space: pre !important; 
        }
        
        #chat-messages-container code { 
            display: block !important; 
            white-space: pre !important; 
            word-wrap: normal !important; 
        }
    `;

    if (interfaceSettings.layout === 'document') {
        css += `
            #chat-messages-container > div { margin-top: 0.5rem !important; }
            #chat-messages-container .msg-wrapper { 
                max-width: 56rem !important; 
                margin: 0 auto !important; 
                width: 100%;
            }
            
            #chat-messages-container .msg-bubble { background: transparent !important; border: none !important; padding: 0 !important; box-shadow: none !important; }
            #chat-messages-container .flex-row-reverse { flex-direction: row !important; }
            #chat-messages-container .text-right { text-align: left !important; }
            #chat-messages-container .justify-end { justify-content: flex-start !important; }
            #chat-messages-container .items-end { align-items: flex-start !important; }
            #chat-messages-container .ml-auto { margin-left: 0 !important; }
            #chat-messages-container .msg-content { border-left: 2px solid ${accent}; padding-left: 1rem; margin-top: 0.5rem; }
        `;
    }

    if (!interfaceSettings.blur) {
        css += `.backdrop-blur-sm, .backdrop-blur-md { backdrop-filter: none !important; background-color: #051116 !important; }`;
    }

    const hljsLink = document.getElementById('hljs-theme');
    if (hljsLink) {
        hljsLink.href = `https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.9.0/styles/${interfaceSettings.codeTheme}.min.css`;
    }
    
    if (interfaceSettings.lineNumbers) {
        css += `
            #chat-messages-container .code-line-numbers { display: block !important; border-color: ${accent} !important; }
            #chat-messages-container pre { padding-left: 0 !important; }
        `;
    }

    dynamicStyles.innerHTML = css;
}

// --- Settings Listeners ---
document.addEventListener('DOMContentLoaded', () => {
    applyInterfaceSettings();

document.getElementById('setting-chunk-size').value = advancedSettings.chunkSize || 500;
    document.getElementById('val-chunk-size').textContent = advancedSettings.chunkSize || 500;
    document.getElementById('setting-similarity').value = advancedSettings.similarity || 0.3;
    document.getElementById('val-similarity').textContent = advancedSettings.similarity || 0.3;
    document.getElementById('setting-top-k-kb').value = advancedSettings.topKKB || 5;
    document.getElementById('val-top-k-kb').textContent = advancedSettings.topKKB || 5;
    document.getElementById('setting-top-k-memory').value = advancedSettings.topKMemory || 5;
    document.getElementById('val-top-k-memory').textContent = advancedSettings.topKMemory || 5;
    document.getElementById('setting-execution-device').value = advancedSettings.executionDevice || 'cpu';
    document.getElementById('setting-rag-debug').checked = advancedSettings.ragDebug || false;
    document.getElementById('setting-blur').checked = interfaceSettings.blur;
    document.getElementById('setting-line-numbers').checked = interfaceSettings.lineNumbers;
    document.getElementById('setting-font-family').value = interfaceSettings.fontFamily;
    document.getElementById('setting-code-theme').value = interfaceSettings.codeTheme;

    // --- Advanced Tab Action Buttons ---
    
    // 1. Open Workspace Folder
    document.getElementById('btn-open-workspace')?.addEventListener('click', () => {
        shell.openPath(dataDir).catch(err => console.error("Failed to open directory:", err));
    });

    // 2. Clear Local HuggingFace Model Cache
    document.getElementById('btn-clear-model-cache')?.addEventListener('click', (e) => {
        const btn = e.currentTarget;
        const originalText = btn.innerText;
        btn.innerText = "Clearing...";
        btn.disabled = true;
        
        try {
            const modelsDir = path.join(dataDir, 'Models');
            if (fs.existsSync(modelsDir)) {
                fs.rmSync(modelsDir, { recursive: true, force: true });
                fs.mkdirSync(modelsDir, { recursive: true });
            }
            btn.innerText = "Cleared!";
            btn.classList.replace('bg-[#1a2d32]', 'bg-green-600');
            setTimeout(() => { 
                btn.innerText = originalText; 
                btn.classList.replace('bg-green-600', 'bg-[#1a2d32]'); 
                btn.disabled = false; 
            }, 2000);
        } catch(err) {
            console.error("Failed to clear model cache:", err);
            btn.innerText = "Error!";
            setTimeout(() => { btn.innerText = originalText; btn.disabled = false; }, 2000);
        }
    });

    // 3. Purge Vector Databases
    document.getElementById('btn-purge-vectors')?.addEventListener('click', (e) => {
        openDeleteModal("Purge Knowledge Bases", "Are you sure? This will delete all generated vector_db.json files. You will need to click 'Save' on your profiles again to re-index them.", () => {
            const btn = e.currentTarget;
            const originalText = btn.innerText;
            btn.innerText = "Purging...";
            
            try {
                // Purge Profile KBs
                const profiles = fs.readdirSync(profilesDir);
                profiles.forEach(pDir => {
                    const dbPath = path.join(profilesDir, pDir, 'KnowledgeBase', 'vector_db.json');
                    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
                });
                
                // Purge Chat Memories
                const chats = fs.readdirSync(chatsDir);
                chats.forEach(cDir => {
                    const memoryPath = path.join(chatsDir, cDir, 'Memory', 'vector_db.json');
                    if (fs.existsSync(memoryPath)) fs.unlinkSync(memoryPath);
                });
                
                btn.innerText = "Purged!";
                setTimeout(() => btn.innerText = originalText, 2000);
            } catch(err) {
                console.error("Failed to purge vector databases:", err);
                btn.innerText = "Error!";
                setTimeout(() => btn.innerText = originalText, 2000);
            }
        });
    });

    // --- Advanced Settings Sliders Listeners ---
    const attachAdvancedSlider = (inputId, displayId, settingKey, isFloat = false) => {
        const input = document.getElementById(inputId);
        const display = document.getElementById(displayId);
        if(input && display) {
            input.addEventListener('input', (e) => {
                const val = isFloat ? parseFloat(e.target.value) : parseInt(e.target.value, 10);
                display.textContent = e.target.value;
                advancedSettings[settingKey] = val;
                saveGlobalSettings();
            });
        }
    };
    
    attachAdvancedSlider('setting-chunk-size', 'val-chunk-size', 'chunkSize');
    attachAdvancedSlider('setting-similarity', 'val-similarity', 'similarity', true);
    attachAdvancedSlider('setting-top-k-kb', 'val-top-k-kb', 'topKKB');
    attachAdvancedSlider('setting-top-k-memory', 'val-top-k-memory', 'topKMemory');

    document.getElementById('setting-execution-device')?.addEventListener('change', (e) => {
        advancedSettings.executionDevice = e.target.value;
        saveGlobalSettings();
    });

    document.getElementById('setting-rag-debug')?.addEventListener('change', (e) => {
        advancedSettings.ragDebug = e.target.checked;
        saveGlobalSettings();
    });

    document.querySelectorAll('.btn-theme-color').forEach(btn => {
        if (btn.getAttribute('data-color') === interfaceSettings.accentColor) {
            btn.classList.replace('ring-transparent', 'ring-white');
        }
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.btn-theme-color').forEach(b => { b.classList.replace('ring-white', 'ring-transparent'); });
            const clicked = e.currentTarget;
            clicked.classList.replace('ring-transparent', 'ring-white');
            interfaceSettings.accentColor = clicked.getAttribute('data-color');
            applyInterfaceSettings();
            saveGlobalSettings();
        });
    });

    document.querySelectorAll('.btn-font-size').forEach(btn => {
        if (btn.getAttribute('data-size') === interfaceSettings.fontSize) {
            btn.classList.remove('text-gray-500', 'font-medium');
            btn.classList.add('bg-[#1a2d32]', 'text-white', 'shadow-sm', 'border', 'border-[#DDBA6E]/30', 'font-bold');
        }
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.btn-font-size').forEach(b => {
                b.classList.remove('bg-[#1a2d32]', 'text-white', 'shadow-sm', 'border', 'border-[#DDBA6E]/30', 'font-bold');
                b.classList.add('text-gray-500', 'font-medium');
            });
            const clicked = e.currentTarget;
            clicked.classList.remove('text-gray-500', 'font-medium');
            clicked.classList.add('bg-[#1a2d32]', 'text-white', 'shadow-sm', 'border', 'border-[#DDBA6E]/30', 'font-bold');
            interfaceSettings.fontSize = clicked.getAttribute('data-size');
            applyInterfaceSettings();
            saveGlobalSettings();
        });
    });

    document.querySelectorAll('.btn-chat-layout').forEach(btn => {
        if (btn.getAttribute('data-layout') === interfaceSettings.layout) {
            btn.classList.remove('border-gray-800', 'bg-[#0a161d]', 'opacity-60');
            btn.classList.add('border-[#DDBA6E]', 'bg-[#1a2d32]', 'opacity-100');
            btn.querySelector('span').classList.replace('text-gray-300', 'text-white');
        }
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.btn-chat-layout').forEach(b => {
                b.classList.remove('border-[#DDBA6E]', 'bg-[#1a2d32]', 'opacity-100');
                b.classList.add('border-gray-800', 'bg-[#0a161d]', 'opacity-60');
                b.querySelector('span').classList.replace('text-white', 'text-gray-300');
            });
            const clicked = e.currentTarget;
            clicked.classList.remove('border-gray-800', 'bg-[#0a161d]', 'opacity-60');
            clicked.classList.add('border-[#DDBA6E]', 'bg-[#1a2d32]', 'opacity-100');
            clicked.querySelector('span').classList.replace('text-gray-300', 'text-white');
            interfaceSettings.layout = clicked.getAttribute('data-layout');
            applyInterfaceSettings();
            saveGlobalSettings();
        });
    });

    document.getElementById('setting-font-family')?.addEventListener('change', (e) => { interfaceSettings.fontFamily = e.target.value; applyInterfaceSettings(); saveGlobalSettings(); });
    document.getElementById('setting-code-theme')?.addEventListener('change', (e) => { interfaceSettings.codeTheme = e.target.value; applyInterfaceSettings(); saveGlobalSettings(); });
    document.getElementById('setting-line-numbers')?.addEventListener('change', (e) => { interfaceSettings.lineNumbers = e.target.checked; applyInterfaceSettings(); saveGlobalSettings(); });
    document.getElementById('setting-blur')?.addEventListener('change', (e) => { interfaceSettings.blur = e.target.checked; applyInterfaceSettings(); saveGlobalSettings(); });
});

// --- Global State ---
env.localModelPath = path.join(dataDir, 'Models');
env.allowLocalModels = true;

let savedApiProfiles = loadFilesFromDir(apiDir);
let savedWritingProfiles = loadProfilesData();
let savedChats = loadChatsData();
let savedWorkflows = loadFilesFromDir(workflowsDir);
let currentChatId = null;
let currentSelectedProfileId = "";
let currentModels = [];
let pendingProfileFiles = [];
let pendingFiles = [];
let currentChatKnowledgeFiles = [];
let selectedChatBgFile = null;

// --- Pre-declare UI updaters ---
function updateChatProfileSelector() {
    const customProfileList = document.getElementById('custom-profile-list');
    const customProfileLabel = document.getElementById('custom-profile-label');
    const customProfileDropdown = document.getElementById('custom-profile-dropdown');

    if (!customProfileList) return;
    customProfileList.innerHTML = '';

    let activeIds = [];
    if (currentChatId) {
        const currentChat = savedChats.find(c => c.id === currentChatId);
        if (currentChat && currentChat.activeProfiles) activeIds = currentChat.activeProfiles;
    }

    if (activeIds.length === 0) {
        customProfileList.innerHTML = '<div class="px-3 py-2 text-xs text-gray-600 italic">No active profiles</div>';
        if (customProfileLabel) customProfileLabel.textContent = "Select a profile";
        currentSelectedProfileId = "";
        return;
    }

    savedWritingProfiles.forEach(profile => {
        if (activeIds.includes(profile.id)) {
            const item = document.createElement('button');
            item.className = "w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-[#1a2d32] hover:text-white transition-colors flex items-center space-x-2";
            item.innerHTML = `<span class="w-2 h-2 rounded-full shrink-0" style="background-color: ${profile.color}"></span><span class="truncate">${profile.name}</span>`;

            item.addEventListener('click', () => {
                currentSelectedProfileId = profile.id;
                if (customProfileLabel) customProfileLabel.textContent = profile.name;
                if (customProfileDropdown) customProfileDropdown.classList.add('hidden');
            });
            customProfileList.appendChild(item);
        }
    });

    if (!activeIds.includes(currentSelectedProfileId)) {
        currentSelectedProfileId = activeIds[0];
    }
    const selProfile = savedWritingProfiles.find(p => p.id === currentSelectedProfileId);
    if (selProfile && customProfileLabel) customProfileLabel.textContent = selProfile.name;
}

function renderRightSidebarProfiles() {
    const rightSidebarProfilesList = document.getElementById('right-sidebar-profiles-list');
    if (!rightSidebarProfilesList) return;
    rightSidebarProfilesList.innerHTML = '';

    let activeIds = [];
    if (currentChatId) {
        const currentChat = savedChats.find(c => c.id === currentChatId);
        if (currentChat) activeIds = currentChat.activeProfiles || [];
    }

    if (savedWritingProfiles.length === 0) {
        rightSidebarProfilesList.innerHTML = '<p class="text-xs text-gray-600 px-2 italic">No AI profiles created yet.</p>';
        return;
    }

    savedWritingProfiles.forEach(profile => {
        const isActive = activeIds.includes(profile.id);
        const card = document.createElement('div');
        card.className = `rs-profile-card p-2 rounded-lg border ${isActive ? 'bg-[#1a2d32] border-[#DDBA6E]/30' : 'bg-[#0a161d] border-gray-800/80'} flex items-center justify-between transition-colors`;
        card.setAttribute('data-name', profile.name);

        card.innerHTML = `
            <div class="flex items-center space-x-2 overflow-hidden w-[65%]">
                <div class="w-2 h-2 rounded-full shrink-0 ${isActive ? 'bg-green-500 shadow-[0_0_5px_rgba(34,197,94,0.5)]' : 'bg-gray-600'}"></div>
                <div class="flex items-center space-x-2 truncate">
                    <span class="w-2.5 h-2.5 rounded-full shrink-0" style="background-color: ${profile.color}"></span>
                    <span class="text-xs font-semibold ${isActive ? 'text-white' : 'text-gray-400'} truncate" title="${profile.name}">${profile.name}</span>
                </div>
            </div>
            <button class="toggle-profile-btn shrink-0 text-[10px] uppercase font-bold px-2 py-1 rounded transition-colors ${isActive ? 'bg-transparent text-gray-500 hover:text-red-400 border border-gray-700/50' : 'bg-[#DDBA6E]/10 text-[#DDBA6E] hover:bg-[#DDBA6E]/20 border border-[#DDBA6E]/30'}">
                ${isActive ? 'Deactivate' : 'Activate'}
            </button>
        `;

        card.querySelector('.toggle-profile-btn').addEventListener('click', () => {
            if (!currentChatId) {
                currentChatId = Date.now().toString();
                const chatContextWindow = document.getElementById('chat-context-window');
                const newChat = {
                    id: currentChatId,
                    title: 'New Chat',
                    updatedAt: Date.now(),
                    isPinned: false,
                    contextWindow: chatContextWindow ? parseInt(chatContextWindow.value) || 4096 : 4096,
                    activeProfiles: [profile.id],
                    messages: []
                };
                savedChats.push(newChat);
                saveChatData(newChat);
            } else {
                const currentChat = savedChats.find(c => c.id === currentChatId);
                if (isActive) {
                    currentChat.activeProfiles = currentChat.activeProfiles.filter(id => id !== profile.id);
                    if (currentSelectedProfileId === profile.id) currentSelectedProfileId = "";
                } else {
                    currentChat.activeProfiles.push(profile.id);
                }
                saveChatData(currentChat);
            }
            renderRightSidebarProfiles();
            updateChatProfileSelector();
        });

        rightSidebarProfilesList.appendChild(card);
    });
}

// --- Navigation Engine ---
function openDashboardView() {
    document.getElementById('view-active-chat')?.classList.replace('flex', 'hidden');
    document.getElementById('view-profile-library')?.classList.replace('flex', 'hidden');
    
    const dashboard = document.getElementById('view-dashboard');
    if (dashboard) {
        dashboard.classList.remove('hidden');
        dashboard.classList.add('flex');
    }
    if (typeof renderDashboardChatsGrid === 'function') renderDashboardChatsGrid();
}

function openLibraryView() {
    document.getElementById('view-active-chat')?.classList.replace('flex', 'hidden');
    document.getElementById('view-dashboard')?.classList.replace('flex', 'hidden');
    
    const library = document.getElementById('view-profile-library');
    if (library) {
        library.classList.remove('hidden');
        library.classList.add('flex');
    }
}

document.getElementById('btn-view-library-expanded')?.addEventListener('click', openLibraryView);
document.getElementById('btn-lib-back-to-dashboard')?.addEventListener('click', openDashboardView);
document.getElementById('btn-back-to-dashboard')?.addEventListener('click', openDashboardView);

// --- New Chat Engine ---
// --- Modal State for Dynamic Lists ---
let pendingChatModalProfiles = [];
let pendingChatModalWorkflows = [];

// --- Modal Image Preview Logic ---
document.getElementById('c-modal-bg-preview')?.addEventListener('click', (e) => {
    if (e.target.id === 'btn-c-modal-clear-bg') return;
    document.getElementById('c-modal-bg-image')?.click();
});

document.getElementById('c-modal-bg-image')?.addEventListener('change', (e) => {
    const file = e.target.files[0];
    if (file) {
        selectedChatBgFile = file;
        const preview = document.getElementById('c-modal-bg-preview');
        const placeholder = document.getElementById('c-modal-bg-placeholder');
        const btnClear = document.getElementById('btn-c-modal-clear-bg');
        
        const objectUrl = URL.createObjectURL(file);
        preview.style.backgroundImage = `url('${objectUrl}')`;
        
        if (placeholder) {
            placeholder.classList.add('opacity-0');
            setTimeout(() => placeholder.classList.add('hidden'), 200);
        }
        if (btnClear) btnClear.classList.remove('hidden');
    }
});

document.getElementById('btn-c-modal-clear-bg')?.addEventListener('click', (e) => {
    e.stopPropagation();
    selectedChatBgFile = null;
    const input = document.getElementById('c-modal-bg-image');
    if (input) input.value = '';
    
    const preview = document.getElementById('c-modal-bg-preview');
    const placeholder = document.getElementById('c-modal-bg-placeholder');
    const btnClear = document.getElementById('btn-c-modal-clear-bg');
    
    if (preview) preview.style.backgroundImage = '';
    
    if (placeholder) {
        placeholder.classList.remove('hidden');
        setTimeout(() => placeholder.classList.remove('opacity-0'), 10);
    }
    
    if (btnClear) btnClear.classList.add('hidden');
});


// --- Dynamic List Rendering ---
function renderChatModalProfilesList(filter = '') {
    const pList = document.getElementById('c-modal-profiles-list');
    if (!pList) return;
    pList.innerHTML = '';

    const filtered = savedWritingProfiles.filter(p => (p.name || '').toLowerCase().includes(filter.toLowerCase()));

    if (savedWritingProfiles.length === 0) {
        pList.innerHTML = '<div class="text-[10px] text-gray-600 italic px-2 py-1">No profiles created</div>';
        return;
    }
    if (filtered.length === 0) {
        pList.innerHTML = '<div class="text-[10px] text-gray-600 italic px-2 py-1">No matches found</div>';
        return;
    }

    filtered.forEach(p => {
        const isActive = pendingChatModalProfiles.includes(p.id);
        const item = document.createElement('div');
        item.className = 'flex items-center justify-between p-1.5 hover:bg-[#051116] rounded group transition-colors cursor-pointer';
        item.innerHTML = `
            <div class="flex items-center space-x-2 overflow-hidden pointer-events-none">
                <span class="w-1.5 h-1.5 rounded-full shrink-0" style="background-color: ${p.color}"></span>
                <span class="text-xs ${isActive ? 'text-white font-medium' : 'text-gray-400'} truncate">${escapeHTML(p.name)}</span>
            </div>
            <button class="shrink-0 text-[9px] uppercase font-bold px-1.5 py-0.5 rounded transition-colors ${isActive ? 'text-[#011419] bg-[var(--app-accent)]' : 'text-gray-500 bg-[#051116] border border-gray-800 group-hover:text-[var(--app-accent)]'}">
                ${isActive ? 'Active' : 'Add'}
            </button>
        `;
        
        item.addEventListener('click', () => {
            if (isActive) {
                pendingChatModalProfiles = pendingChatModalProfiles.filter(id => id !== p.id);
            } else {
                pendingChatModalProfiles.push(p.id);
            }
            renderChatModalProfilesList(document.getElementById('c-modal-search-profiles')?.value || '');
        });
        
        pList.appendChild(item);
    });
}

function renderChatModalWorkflowsList(filter = '') {
    const wList = document.getElementById('c-modal-workflows-list');
    if (!wList) return;
    wList.innerHTML = '';

    const filtered = savedWorkflows.filter(w => (w.name || '').toLowerCase().includes(filter.toLowerCase()));

    if (savedWorkflows.length === 0) {
        wList.innerHTML = '<div class="text-[10px] text-gray-600 italic px-2 py-1">No workflows created</div>';
        return;
    }
    if (filtered.length === 0) {
        wList.innerHTML = '<div class="text-[10px] text-gray-600 italic px-2 py-1">No matches found</div>';
        return;
    }

    filtered.forEach(w => {
        const isActive = pendingChatModalWorkflows.includes(w.id);
        const item = document.createElement('div');
        item.className = 'flex items-center justify-between p-1.5 hover:bg-[#051116] rounded group transition-colors cursor-pointer';
        item.innerHTML = `
            <div class="flex items-center space-x-2 overflow-hidden pointer-events-none">
                <svg class="w-3 h-3 shrink-0 ${isActive ? 'text-[var(--app-accent)]' : 'text-gray-500'}" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>
                <span class="text-xs ${isActive ? 'text-white font-medium' : 'text-gray-400'} truncate">${escapeHTML(w.name)}</span>
            </div>
            <button class="shrink-0 text-[9px] uppercase font-bold px-1.5 py-0.5 rounded transition-colors ${isActive ? 'text-[#011419] bg-[var(--app-accent)]' : 'text-gray-500 bg-[#051116] border border-gray-800 group-hover:text-[var(--app-accent)]'}">
                ${isActive ? 'Active' : 'Add'}
            </button>
        `;
        
        item.addEventListener('click', () => {
            if (isActive) {
                pendingChatModalWorkflows = pendingChatModalWorkflows.filter(id => id !== w.id);
            } else {
                pendingChatModalWorkflows.push(w.id);
            }
            renderChatModalWorkflowsList(document.getElementById('c-modal-search-workflows')?.value || '');
        });
        
        wList.appendChild(item);
    });
}

// --- Search Listeners ---
document.getElementById('c-modal-search-profiles')?.addEventListener('input', (e) => {
    renderChatModalProfilesList(e.target.value);
});

document.getElementById('c-modal-search-workflows')?.addEventListener('input', (e) => {
    renderChatModalWorkflowsList(e.target.value);
});

// --- Modal Controls ---
function openChatModal() {
    currentChatKnowledgeFiles = [];
    selectedChatBgFile = null;
    pendingChatModalProfiles = [];
    pendingChatModalWorkflows = [];

    // Reset UI
    document.getElementById('c-modal-name').value = '';
    document.getElementById('c-modal-desc').value = '';
    document.getElementById('c-modal-search-profiles').value = '';
    document.getElementById('c-modal-search-workflows').value = '';
    document.getElementById('c-modal-file-list').innerHTML = '';
    
    document.getElementById('btn-c-modal-clear-bg')?.click(); // Reset image visually

    renderChatModalProfilesList();
    renderChatModalWorkflowsList();

    const modal = document.getElementById('chat-modal');
    if (modal) {
        modal.classList.remove('hidden');
        setTimeout(() => modal.classList.add('opacity-100'), 10);
    }
}

function closeChatModal() {
    const modal = document.getElementById('chat-modal');
    if (modal) {
        modal.classList.remove('opacity-100');
        setTimeout(() => modal.classList.add('hidden'), 200);
    }
}

document.getElementById('btn-new-chat')?.addEventListener('click', openChatModal);
document.getElementById('btn-cancel-chat-modal')?.addEventListener('click', closeChatModal);

// --- Library Tabs Engine ---
document.getElementById('lib-tab-profiles')?.addEventListener('click', () => {
    document.getElementById('lib-tab-profiles').classList.replace('text-gray-500', 'text-white');
    document.getElementById('lib-tab-profiles').classList.add('bg-[#1a2d32]', 'shadow-sm');
    document.getElementById('lib-tab-workflows').classList.remove('bg-[#1a2d32]', 'text-white', 'shadow-sm');
    document.getElementById('lib-tab-workflows').classList.add('text-gray-500');

    document.getElementById('lib-view-profiles').classList.remove('hidden');
    document.getElementById('lib-view-profiles').classList.add('flex');
    document.getElementById('lib-view-workflows').classList.replace('flex', 'hidden');
});

document.getElementById('lib-tab-workflows')?.addEventListener('click', () => {
    document.getElementById('lib-tab-workflows').classList.replace('text-gray-500', 'text-white');
    document.getElementById('lib-tab-workflows').classList.add('bg-[#1a2d32]', 'shadow-sm');
    document.getElementById('lib-tab-profiles').classList.remove('bg-[#1a2d32]', 'text-white', 'shadow-sm');
    document.getElementById('lib-tab-profiles').classList.add('text-gray-500');

    document.getElementById('lib-view-workflows').classList.remove('hidden');
    document.getElementById('lib-view-workflows').classList.add('flex');
    document.getElementById('lib-view-profiles').classList.replace('flex', 'hidden');
});

// --- API Profiles ---
const apiProfilesList = document.getElementById('api-profiles-list');
const newProfileForm = document.getElementById('new-profile-form');
const btnAddProfile = document.getElementById('btn-add-profile');

function renderApiProfilesList() {
    if (!apiProfilesList) return;
    apiProfilesList.innerHTML = savedApiProfiles.length === 0 
        ? '<p class="text-sm text-gray-500 italic mt-4">No API profiles configured yet.</p>' 
        : '';

    savedApiProfiles.forEach((profile, index) => {
        let editingModels = [...profile.models];

        const card = document.createElement('div');
        card.className = "api-profile-card bg-[#0a161d] border border-gray-800/80 rounded-lg overflow-hidden transition-all duration-300 mb-3 shadow-sm";
        
        card.innerHTML = `
            <div class="card-header flex items-center justify-between p-3 cursor-pointer hover:bg-[#1a2d32] transition-colors group">
                <div class="flex items-center space-x-4 pointer-events-none">
                    <button class="bg-[#051116] group-hover:bg-[#011419] border border-gray-800/80 p-1.5 rounded transition-colors text-gray-400">
                        <svg class="chevron-icon transform transition-transform duration-200 rotate-[-90deg]" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                    </button>
                    <div>
                        <h4 class="text-white font-bold text-base mb-1">${escapeHTML(profile.name)}</h4>
                        <div class="flex space-x-2">
                            <span class="bg-[#1a2d32] text-gray-200 text-xs font-semibold px-2.5 py-0.5 rounded-full border border-gray-700/50">${escapeHTML(profile.provider)}</span>
                            <span class="bg-transparent text-[#DDBA6E] text-xs font-medium px-2.5 py-0.5 rounded-full border border-[#DDBA6E]/30"><span class="display-model-count">${profile.models.length}</span> models</span>
                        </div>
                    </div>
                </div>
                <div class="flex items-center space-x-3 pr-2 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button class="text-gray-400 hover:text-red-500 transition-colors delete-card-btn" title="Delete">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </div>
            </div>
            
            <div class="card-body hidden border-t border-gray-800/80 p-5 bg-[#051116]">
                <div class="space-y-4">
                    <div>
                        <label class="block text-xs font-bold text-gray-200 mb-1.5">Profile Name</label>
                        <input type="text" class="edit-api-name w-full bg-[#011419] border border-gray-800 text-gray-200 text-sm rounded-md px-3 py-2 focus:outline-none focus:border-[#DDBA6E]" value="${escapeHTML(profile.name)}">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-200 mb-1.5">Provider</label>
                        <select class="edit-api-provider w-full bg-[#011419] border border-gray-800 text-gray-200 text-sm rounded-md px-3 py-2 focus:outline-none focus:border-[#DDBA6E] appearance-none">
                            <option value="OpenRouter" ${profile.provider === 'OpenRouter' ? 'selected' : ''}>OpenRouter</option>
                            <option value="Anthropic" ${profile.provider === 'Anthropic' ? 'selected' : ''}>Anthropic</option>
                            <option value="Google AI" ${profile.provider === 'Google AI' ? 'selected' : ''}>Google AI</option>
                            <option value="OpenAI" ${profile.provider === 'OpenAI' ? 'selected' : ''}>OpenAI</option>
                            <option value="Local" ${profile.provider === 'Local' ? 'selected' : ''}>Local (LM Studio / Ollama)</option>
                        </select>
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-200 mb-1.5">Custom Base URL (optional)</label>
                        <input type="text" class="edit-api-base-url w-full bg-[#011419] border border-gray-800 text-gray-200 text-sm rounded-md px-3 py-2 focus:outline-none focus:border-[#DDBA6E]" value="${escapeHTML(profile.baseUrl || '')}" placeholder="https://api.example.com/v1">
                    </div>
                    <div>
                        <label class="block text-xs font-bold text-gray-200 mb-1.5">API Key</label>
                        <div class="relative">
                            <input type="password" class="edit-api-key w-full bg-[#011419] border border-gray-800 text-gray-200 text-sm rounded-md px-3 py-2 focus:outline-none focus:border-[#DDBA6E] pr-10" value="${escapeHTML(profile.apiKey || '')}" placeholder="sk-...">
                            <button type="button" class="btn-toggle-edit-key absolute inset-y-0 right-0 flex items-center pr-3 text-gray-500 hover:text-gray-300 transition-colors">
                                <svg class="icon-eye-off" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>
                                <svg class="icon-eye-open hidden" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                            </button>
                        </div>
                    </div>
                    
                    <div class="mt-4 border-t border-gray-800/80 pt-4">
                        <div class="flex items-center justify-between mb-3">
                            <span class="text-white font-bold text-xs">Models (<span class="edit-model-count">${editingModels.length}</span>)</span>
                            <button type="button" class="btn-edit-add-model bg-transparent border border-gray-700 hover:bg-gray-800 text-white text-[10px] px-2 py-1 rounded transition-colors">+ Add</button>
                        </div>
                        <div class="edit-add-model-container hidden mb-3 flex items-center space-x-2">
                            <input type="text" placeholder="Model name..." class="edit-new-model-input flex-1 bg-[#011419] border border-gray-800 text-gray-200 text-xs rounded px-2 py-1.5 focus:outline-none focus:border-[#DDBA6E]">
                            <button type="button" class="btn-edit-cancel-model text-gray-400 hover:text-white text-[10px] px-2 py-1 border border-gray-800 rounded">Cancel</button>
                            <button type="button" class="btn-edit-confirm-model bg-[#DDBA6E] hover:bg-[#ebd093] text-[#011419] font-bold text-[10px] px-2 py-1 rounded">Add</button>
                        </div>
                        <div class="edit-models-container flex flex-wrap gap-2 min-h-8"></div>
                    </div>
                    
                    <div class="flex justify-end space-x-3 pt-3">
                        <button type="button" class="btn-edit-cancel px-3 py-1.5 text-xs text-gray-400 hover:text-white transition-colors">Cancel</button>
                        <button type="button" class="btn-edit-save px-3 py-1.5 text-xs bg-[#DDBA6E] text-[#011419] font-bold rounded hover:bg-[#ebd093] transition-colors shadow-sm">Save Changes</button>
                    </div>
                </div>
            </div>
        `;

        const modelsContainer = card.querySelector('.edit-models-container');
        const modelCountDisplay = card.querySelector('.edit-model-count');
        
        function renderEditingModels() {
            modelsContainer.innerHTML = '';
            modelCountDisplay.textContent = editingModels.length;
            editingModels.forEach((mName, mIndex) => {
                const badge = document.createElement('span');
                badge.className = "flex items-center space-x-1 bg-[#1a2d32] border border-gray-700/50 text-gray-300 text-[10px] px-2 py-1 rounded-full";
                badge.innerHTML = `
                    <span>${escapeHTML(mName)}</span>
                    <button type="button" class="hover:text-red-400 ml-1 font-bold">×</button>
                `;
                badge.querySelector('button').addEventListener('click', () => {
                    editingModels.splice(mIndex, 1);
                    renderEditingModels();
                });
                modelsContainer.appendChild(badge);
            });
        }
        renderEditingModels();

        const cardHeader = card.querySelector('.card-header');
        const cardBody = card.querySelector('.card-body');
        const chevron = card.querySelector('.chevron-icon');
        const btnDelete = card.querySelector('.delete-card-btn');
        
        cardHeader.addEventListener('click', (e) => {
            if(e.target.closest('.delete-card-btn')) return;
            cardBody.classList.toggle('hidden');
            chevron.classList.toggle('rotate-[-90deg]');
            chevron.classList.toggle('rotate-0');
        });

        btnDelete.addEventListener('click', (e) => {
            e.stopPropagation();
            openDeleteModal("Delete API", `Are you sure you want to delete "${profile.name}"?`, () => {
                savedApiProfiles.splice(index, 1);
                deleteSingleFile(apiDir, profile.id);
                renderApiProfilesList();
            });
        });

        const btnToggleKey = card.querySelector('.btn-toggle-edit-key');
        const keyInput = card.querySelector('.edit-api-key');
        const iconOff = card.querySelector('.icon-eye-off');
        const iconOn = card.querySelector('.icon-eye-open');
        
        btnToggleKey.addEventListener('click', () => {
            if(keyInput.type === 'password') {
                keyInput.type = 'text';
                iconOff.classList.add('hidden');
                iconOn.classList.remove('hidden');
            } else {
                keyInput.type = 'password';
                iconOn.classList.add('hidden');
                iconOff.classList.remove('hidden');
            }
        });

        const btnShowAdd = card.querySelector('.btn-edit-add-model');
        const addContainer = card.querySelector('.edit-add-model-container');
        const newModelInput = card.querySelector('.edit-new-model-input');
        const btnCancelAdd = card.querySelector('.btn-edit-cancel-model');
        const btnConfirmAdd = card.querySelector('.btn-edit-confirm-model');

        btnShowAdd.addEventListener('click', () => {
            addContainer.classList.remove('hidden');
            btnShowAdd.classList.add('hidden');
            newModelInput.focus();
        });

        const hideModelInput = () => {
            addContainer.classList.add('hidden');
            btnShowAdd.classList.remove('hidden');
            newModelInput.value = '';
        };

        btnCancelAdd.addEventListener('click', hideModelInput);

        const submitLocalModel = () => {
            const newName = newModelInput.value.trim();
            if (newName !== '' && !editingModels.includes(newName)) {
                editingModels.push(newName);
                renderEditingModels();
                hideModelInput();
            }
        };

        btnConfirmAdd.addEventListener('click', submitLocalModel);
        newModelInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); submitLocalModel(); }
        });

        card.querySelector('.btn-edit-cancel').addEventListener('click', () => {
            cardBody.classList.add('hidden');
            chevron.classList.add('rotate-[-90deg]');
            chevron.classList.remove('rotate-0');
            
            editingModels = [...profile.models];
            renderEditingModels();
            card.querySelector('.edit-api-name').value = profile.name;
            card.querySelector('.edit-api-provider').value = profile.provider;
            card.querySelector('.edit-api-base-url').value = profile.baseUrl || '';
            card.querySelector('.edit-api-key').value = profile.apiKey || '';
        });

        card.querySelector('.btn-edit-save').addEventListener('click', () => {
            const newName = card.querySelector('.edit-api-name').value.trim();
            if (!newName) {
                card.querySelector('.edit-api-name').classList.add('border-red-500', 'animate-pulse');
                setTimeout(() => card.querySelector('.edit-api-name').classList.remove('border-red-500', 'animate-pulse'), 2000);
                return;
            }

            profile.name = newName;
            profile.provider = card.querySelector('.edit-api-provider').value;
            profile.baseUrl = card.querySelector('.edit-api-base-url').value.trim();
            profile.apiKey = card.querySelector('.edit-api-key').value.trim();
            profile.models = [...editingModels];

            saveSingleFile(apiDir, profile);
            renderApiProfilesList(); 
        });

        apiProfilesList.appendChild(card);
    });
}

function showApiForm() {
    if (apiProfilesList) apiProfilesList.classList.add('hidden');
    if (btnAddProfile) btnAddProfile.classList.add('hidden');
    if (newProfileForm) newProfileForm.classList.remove('hidden');
}

function showApiList() {
    if (newProfileForm) newProfileForm.classList.add('hidden');
    if (apiProfilesList) apiProfilesList.classList.remove('hidden');
    if (btnAddProfile) btnAddProfile.classList.remove('hidden');

    document.getElementById('api-profile-name').value = '';
    document.getElementById('api-base-url').value = '';
    const apiKeyInput = document.getElementById('api-key');
    if (apiKeyInput) {
        apiKeyInput.value = '';
        apiKeyInput.type = 'password';
    }

    currentModels = [];
    updateModelsUI();
    hideModelInput();
}

if (btnAddProfile) btnAddProfile.addEventListener('click', showApiForm);
if (document.getElementById('btn-cancel-profile')) document.getElementById('btn-cancel-profile').addEventListener('click', showApiList);

if (document.getElementById('btn-save-profile')) {
    document.getElementById('btn-save-profile').addEventListener('click', () => {
        const nameInput = document.getElementById('api-profile-name');
        if (!nameInput) return;

        const profileName = nameInput.value.trim();
        if (!profileName) { triggerFieldError('api-profile-name'); return; }

        const newApi = {
            id: Date.now().toString(),
            name: profileName,
            provider: document.getElementById('api-provider').value,
            baseUrl: document.getElementById('api-base-url').value.trim(),
            apiKey: document.getElementById('api-key').value.trim(),
            models: [...currentModels]
        };

        savedApiProfiles.push(newApi);
        saveSingleFile(apiDir, newApi);
        renderApiProfilesList();
        showApiList();
    });
}

function updateModelsUI() {
    const modelCountDisplay = document.getElementById('model-count-display');
    const modelsContainer = document.getElementById('models-container');
    if (modelCountDisplay) modelCountDisplay.textContent = currentModels.length;
    if (!modelsContainer) return;

    modelsContainer.innerHTML = '';
    currentModels.forEach((modelName, index) => {
        modelsContainer.insertAdjacentHTML('beforeend', `
            <span class="flex items-center space-x-1 bg-[#1a2d32] border border-gray-700/50 text-gray-300 text-xs px-2.5 py-1 rounded-full">
                <span>${modelName}</span>
                <button type="button" class="hover:text-red-400 ml-1 font-bold" onclick="removeModel(${index})">×</button>
            </span>
        `);
    });
}

window.removeModel = function (index) { currentModels.splice(index, 1); updateModelsUI(); };

const btnShowAddModel = document.getElementById('btn-show-add-model');
const addModelContainer = document.getElementById('add-model-container');
const newModelInput = document.getElementById('new-model-input');

if (btnShowAddModel) {
    btnShowAddModel.addEventListener('click', () => {
        if (addModelContainer) addModelContainer.classList.remove('hidden');
        btnShowAddModel.classList.add('hidden');
        if (newModelInput) newModelInput.focus();
    });
}

function hideModelInput() {
    if (addModelContainer) addModelContainer.classList.add('hidden');
    if (btnShowAddModel) btnShowAddModel.classList.remove('hidden');
    if (newModelInput) newModelInput.value = '';
}

if (document.getElementById('btn-cancel-model')) document.getElementById('btn-cancel-model').addEventListener('click', hideModelInput);

function submitNewModel() {
    if (!newModelInput) return;
    const newModelName = newModelInput.value.trim();
    if (newModelName !== '' && !currentModels.includes(newModelName)) {
        currentModels.push(newModelName);
        updateModelsUI();
        hideModelInput();
    }
}

if (document.getElementById('btn-confirm-model')) document.getElementById('btn-confirm-model').addEventListener('click', submitNewModel);
if (newModelInput) newModelInput.addEventListener('keypress', (e) => { if (e.key === 'Enter') { e.preventDefault(); submitNewModel(); } });

// --- Writing Profiles ---
const writingProfilesList = document.getElementById('writing-profiles-list');
const sidebarRecentProfiles = document.getElementById('sidebar-recent-profiles');
const writingProfileModal = document.getElementById('writing-profile-modal');
let selectedThemeColor = '#DDBA6E';
let editingProfileId = null;
let hasKbChanged = false;

document.querySelectorAll('#wp-color-picker button').forEach(btn => {
    btn.addEventListener('click', () => {
        document.querySelectorAll('#wp-color-picker button').forEach(b => { b.classList.replace('border-white', 'border-transparent'); });
        btn.classList.replace('border-transparent', 'border-white');
        const bgClass = Array.from(btn.classList).find(c => c.startsWith('bg-['));
        if (bgClass) selectedThemeColor = bgClass.substring(4, bgClass.length - 1);
    });
});

function renderWritingProfilesList() {
    if (writingProfilesList) writingProfilesList.innerHTML = '';
    if (sidebarRecentProfiles) sidebarRecentProfiles.innerHTML = '';

    if (savedWritingProfiles.length === 0) {
        if (writingProfilesList) {
            writingProfilesList.innerHTML = `
                <div class="col-span-1 md:col-span-2 lg:col-span-3 flex flex-col items-center justify-center text-gray-500 py-16 border border-dashed border-gray-800/80 rounded-xl bg-[#0a161d]/30">
                    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="mb-3 opacity-50"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg>
                    <p class="text-sm font-medium">No AI profiles created yet.</p>
                    <p class="text-xs mt-1 opacity-70">Click "New AI Profile" on the sidebar to get started.</p>
                </div>
            `;
        }
        return;
    }

    savedWritingProfiles.forEach((profile, index) => {
        const linkedApi = savedApiProfiles.find(p => p.id === profile.apiProfileId);
        const apiName = linkedApi ? linkedApi.name : 'Unknown API';

        const card = `
            <div class="bg-[#111f2e] border border-gray-800/80 rounded-xl p-5 hover:border-gray-600 transition-all group flex flex-col h-[180px] relative overflow-hidden shadow-lg hover:-translate-y-1">
                <div class="absolute top-0 left-0 right-0 h-1.5" style="background-color: ${profile.color}"></div>
                <div class="flex justify-between items-start mb-2 mt-1">
                    <h3 class="text-white font-bold text-lg truncate pr-2">${profile.name}</h3>
                    <div class="flex space-x-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button class="text-gray-400 hover:text-[#3b82f6] hover:bg-[#3b82f6]/10 p-1.5 bg-[#0a141d] rounded-md transition-colors manage-kb-btn" data-id="${profile.id}" title="Manage Knowledge Base">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><ellipse cx="12" cy="5" rx="9" ry="3"></ellipse><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"></path><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"></path></svg>
                        </button>
                        <button class="text-gray-400 hover:text-white p-1.5 bg-[#0a141d] rounded-md transition-colors edit-wp-btn" data-index="${index}" title="Edit Profile">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                        </button>
                        <button class="text-gray-500 hover:text-red-500 p-1.5 bg-[#0a141d] rounded-md transition-colors delete-wp-btn" data-index="${index}" title="Delete Profile">
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        </button>
                    </div>
                </div>
                <p class="text-sm text-gray-400 line-clamp-2 mb-auto leading-relaxed">${profile.description || 'No description provided.'}</p>
                <div class="mt-4 flex items-center justify-between text-xs font-semibold">
                    <span class="bg-[#1a2d3d] text-gray-300 px-2.5 py-1.5 rounded-md border border-gray-700/50 truncate max-w-[120px]">${apiName}</span>
                    <span class="text-gray-500 truncate max-w-[120px]">${profile.model || 'No model'}</span>
                </div>
            </div>
        `;
        if (writingProfilesList) writingProfilesList.insertAdjacentHTML('beforeend', card);

        if (sidebarRecentProfiles && index >= savedWritingProfiles.length - 2) {
            sidebarRecentProfiles.insertAdjacentHTML('afterbegin', `
                <button class="w-full flex items-center space-x-3 px-2 py-1.5 rounded hover:bg-white/5 transition-colors text-sm text-gray-300 group">
                    <span class="w-2.5 h-2.5 rounded-full shadow-sm" style="background-color: ${profile.color}"></span>
                    <span class="truncate group-hover:text-white transition-colors">${profile.name}</span>
                </button>
            `);
        }
    });

    // Edit logic
    document.querySelectorAll('.edit-wp-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = e.currentTarget.getAttribute('data-index');
            const profile = savedWritingProfiles[idx];

            editingProfileId = profile.id;
            hasKbChanged = false;

            openWritingProfileModal();

            document.getElementById('wp-name').value = profile.name;
            document.getElementById('wp-desc').value = profile.description || '';
            document.getElementById('wp-api-profile').value = profile.apiProfileId;
            document.getElementById('wp-api-profile').dispatchEvent(new Event('change'));
            document.getElementById('wp-model').value = profile.model;
            document.getElementById('wp-temp').value = profile.temperature;
            document.getElementById('wp-tokens').value = profile.maxTokens;
            document.getElementById('wp-system-prompt').value = profile.systemPrompt;

            const manualToggle = document.getElementById('wp-manual-mode-toggle');
            const manualJson = document.getElementById('wp-manual-json');
            const basicBox = document.getElementById('wp-basic-params');
            const manualBox = document.getElementById('wp-manual-params');

            if (manualToggle) manualToggle.checked = profile.manualMode || false;
            if (manualJson) manualJson.value = profile.manualJson || '';

            if (profile.manualMode) {
                if (basicBox) basicBox.classList.add('hidden');
                if (manualBox) manualBox.classList.remove('hidden');
            } else {
                if (manualBox) manualBox.classList.add('hidden');
                if (basicBox) basicBox.classList.remove('hidden');
            }

            const agenticToggle = document.getElementById('wp-agentic-toggle');
            const agenticPromptContainer = document.getElementById('wp-agentic-prompt-container');
            const agenticPrompt = document.getElementById('wp-agentic-prompt');

            if (agenticToggle) agenticToggle.checked = profile.isAgentic || false;
            if (agenticPrompt) agenticPrompt.value = profile.agenticPrompt || '';
            
            if (profile.isAgentic) {
                if (agenticPromptContainer) agenticPromptContainer.classList.remove('hidden');
            } else {
                if (agenticPromptContainer) agenticPromptContainer.classList.add('hidden');
            }

            selectedThemeColor = profile.color;
            document.querySelectorAll('#wp-color-picker button').forEach(b => b.classList.replace('border-white', 'border-transparent'));
            const colorBtn = Array.from(document.querySelectorAll('#wp-color-picker button')).find(b => b.classList.contains(`bg-[${profile.color}]`));
            if (colorBtn) colorBtn.classList.replace('border-transparent', 'border-white');

            pendingProfileFiles = profile.knowledgeFiles ? [...profile.knowledgeFiles].map(f => ({...f, strategy: f.strategy || 'rag_search'})) : [];
            renderPendingProfileFiles();
        });
    });

    // Delete logic
    document.querySelectorAll('.delete-wp-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const idx = e.currentTarget.getAttribute('data-index');
            const profileToDelete = savedWritingProfiles[idx];

            openDeleteModal("Delete Profile", `Are you sure you want to delete "${profileToDelete.name}"?`, () => {
                savedWritingProfiles.splice(idx, 1);
                deleteProfileFolder(profileToDelete.id);
                renderWritingProfilesList();
                updateChatProfileSelector();
                renderRightSidebarProfiles();
            });
        });
    });

    document.querySelectorAll('.manage-kb-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const pId = e.currentTarget.getAttribute('data-id');
            openKbManagerModal(pId);
        });
    });
}

function openWritingProfileModal() {
    showWpStep1();
    const selectApiProfile = document.getElementById('wp-api-profile');
    if (selectApiProfile) {
        selectApiProfile.innerHTML = '<option value="" disabled selected>Select an API...</option>';
        savedApiProfiles.forEach(profile => {
            const option = document.createElement('option');
            option.value = profile.id; option.textContent = profile.name;
            selectApiProfile.appendChild(option);
        });
    }
    const writingProfileModal = document.getElementById('writing-profile-modal');
    if (writingProfileModal) writingProfileModal.classList.remove('hidden');
}

function closeWritingProfileModal() {
    const writingProfileModal = document.getElementById('writing-profile-modal');
    if (writingProfileModal) writingProfileModal.classList.add('hidden');
    
    editingProfileId = null;
    hasKbChanged = false;
    pendingProfileFiles = [];
    if (typeof renderPendingProfileFiles === 'function') renderPendingProfileFiles();
    
    document.getElementById('wp-name').value = '';
    document.getElementById('wp-desc').value = '';
    document.getElementById('wp-system-prompt').value = '';

    const manualToggle = document.getElementById('wp-manual-mode-toggle');
    if (manualToggle) manualToggle.checked = false;

    const agenticToggle = document.getElementById('wp-agentic-toggle');
    if (agenticToggle) agenticToggle.checked = false;

    const agenticContainer = document.getElementById('wp-agentic-prompt-container');
    if (agenticContainer) {
        agenticContainer.classList.add('hidden');
        agenticContainer.classList.remove('flex');
    }

    const agenticPrompt = document.getElementById('wp-agentic-prompt');
    if (agenticPrompt) agenticPrompt.value = '';
    
    const manualJson = document.getElementById('wp-manual-json');
    if (manualJson) manualJson.value = '';

    const basicBox = document.getElementById('wp-basic-params');
    const manualBox = document.getElementById('wp-manual-params');
    if (basicBox) basicBox.classList.remove('hidden');
    if (manualBox) manualBox.classList.add('hidden');
    
    showWpStep1();
}

// --- RESTAURANDO OS EVENT LISTENERS PERDIDOS ---
document.getElementById('btn-sidebar-new-profile')?.addEventListener('click', () => { editingProfileId = null; hasKbChanged = false; openWritingProfileModal(); });
document.getElementById('btn-lib-new-profile')?.addEventListener('click', () => { editingProfileId = null; hasKbChanged = false; openWritingProfileModal(); });
document.getElementById('btn-close-writing-profile')?.addEventListener('click', closeWritingProfileModal);
document.getElementById('btn-cancel-writing-profile')?.addEventListener('click', closeWritingProfileModal);

// Lógica de exibir lado do Agentic RAG
document.getElementById('wp-agentic-toggle')?.addEventListener('change', (e) => {
    const agenticContainer = document.getElementById('wp-agentic-prompt-container');
    if(e.target.checked) {
        if (agenticContainer) { agenticContainer.classList.remove('hidden'); agenticContainer.classList.add('flex'); }
    } else {
        if (agenticContainer) { agenticContainer.classList.add('hidden'); agenticContainer.classList.remove('flex'); }
    }
});

// Atualizador de Modelos
document.getElementById('wp-api-profile')?.addEventListener('change', (e) => {
    const selectedProfile = savedApiProfiles.find(p => p.id === e.target.value);
    const selectModel = document.getElementById('wp-model');
    if (!selectModel) return;

    selectModel.innerHTML = '';
    if (selectedProfile && selectedProfile.models.length > 0) {
        selectedProfile.models.forEach(modelName => {
            const option = document.createElement('option');
            option.value = modelName; option.textContent = modelName;
            selectModel.appendChild(option);
        });
    } else {
        selectModel.innerHTML = '<option value="" disabled selected>No models registered</option>';
    }
});

// --- LÓGICA DE SALVAMENTO DE PERFIL ---
const btnSaveWritingProfile = document.getElementById('btn-save-writing-profile');
if (btnSaveWritingProfile) {
    btnSaveWritingProfile.addEventListener('click', async () => {
        const name = document.getElementById('wp-name').value.trim();
        const desc = document.getElementById('wp-desc').value.trim();
        const apiProfileId = document.getElementById('wp-api-profile').value;
        const model = document.getElementById('wp-model').value;
        const temp = document.getElementById('wp-temp').value;
        const tokens = document.getElementById('wp-tokens').value;
        const prompt = document.getElementById('wp-system-prompt').value.trim();

        let hasError = false;
        if (!name) { triggerFieldError('wp-name'); hasError = true; }
        if (!apiProfileId) { triggerFieldError('wp-api-profile'); hasError = true; }
        if (!model) { triggerFieldError('wp-model'); hasError = true; }
        if (hasError) { showWpStep1(); return; }

        const targetProfileId = editingProfileId || Date.now().toString();
        // storage.js returns the array of copied files
        const persistedFiles = await persistKnowledgeFiles(targetProfileId, pendingProfileFiles); 
        
        // Restore strategy flag mapped from pendingProfileFiles
        const mappedPersistedFiles = persistedFiles.map(pf => {
            const original = pendingProfileFiles.find(o => o.name === pf.name);
            return { ...pf, strategy: original ? original.strategy : 'rag_search' };
        });

        const isManualMode = document.getElementById('wp-manual-mode-toggle').checked;
        const manualJsonText = document.getElementById('wp-manual-json').value.trim();
        const isAgentic = document.getElementById('wp-agentic-toggle')?.checked || false;
        const agenticPrompt = document.getElementById('wp-agentic-prompt')?.value.trim() || '';

        const newWp = {
            id: targetProfileId, name, description: desc, color: selectedThemeColor,
            apiProfileId, model, temperature: parseFloat(temp),
            maxTokens: parseInt(tokens), systemPrompt: prompt, knowledgeFiles: mappedPersistedFiles,
            manualMode: isManualMode, manualJson: manualJsonText,
            isAgentic: isAgentic, 
            agenticPrompt: agenticPrompt
        };

        if (editingProfileId) {
            const idx = savedWritingProfiles.findIndex(p => p.id === editingProfileId);
            savedWritingProfiles[idx] = newWp;
        } else {
            savedWritingProfiles.push(newWp);
            hasKbChanged = true;
        }
        saveProfileData(newWp);

        if (hasKbChanged && mappedPersistedFiles.length > 0) {
            console.log("Processing strategies for Knowledge Base...");
            const originalBtnText = btnSaveWritingProfile.innerHTML;
            btnSaveWritingProfile.disabled = true;

            const dbPath = path.join(profilesDir, targetProfileId, 'KnowledgeBase', 'vector_db.json');
            const fullContextPath = path.join(profilesDir, targetProfileId, 'KnowledgeBase', 'full_context.json');
            
            if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
            if (fs.existsSync(fullContextPath)) fs.unlinkSync(fullContextPath);

            let allProfileVectors = [];
            let allConstantMemories = [];

            for (let fIndex = 0; fIndex < mappedPersistedFiles.length; fIndex++) {
                const file = mappedPersistedFiles[fIndex];
                try {
                    btnSaveWritingProfile.innerHTML = `<span class="text-xs">Reading ${file.name}...</span>`;
                    const fullText = await extractTextFromFile(file.internalPath);
                    
                    if (fullText && fullText.trim().length > 0) {
                        // Strategy 1: Constant Memory
                        if (file.strategy === 'full_context') {
                            allConstantMemories.push({ name: file.name, content: fullText.trim() });
                        } 
                        // Strategy 2: Searchable Memory
                        else {
                            const chunks = chunkText(fullText);
                            const fileVectors = await vectorizeChunks(chunks, file.name, (current, total) => {
                                btnSaveWritingProfile.innerHTML = `
                                    <div class="flex flex-col leading-tight">
                                        <span class="text-xs">File ${fIndex + 1} of ${mappedPersistedFiles.length}</span>
                                        <span class="text-[10px] text-gray-800">Chunking: ${current} / ${total}</span>
                                    </div>
                                `;
                            });
                            allProfileVectors = allProfileVectors.concat(fileVectors);
                        }
                    }
                } catch (err) { console.error(`Failed to read ${file.name}:`, err); }
            }

            try {
                if (allProfileVectors.length > 0) fs.writeFileSync(dbPath, JSON.stringify(allProfileVectors, null, 2));
                if (allConstantMemories.length > 0) fs.writeFileSync(fullContextPath, JSON.stringify(allConstantMemories, null, 2));
            } catch (saveErr) { console.error("Error saving knowledge base JSONs:", saveErr); }

            btnSaveWritingProfile.innerHTML = originalBtnText;
            btnSaveWritingProfile.disabled = false;
        } else if (hasKbChanged && mappedPersistedFiles.length === 0) {
            const dbPath = path.join(profilesDir, targetProfileId, 'KnowledgeBase', 'vector_db.json');
            const fullContextPath = path.join(profilesDir, targetProfileId, 'KnowledgeBase', 'full_context.json');
            if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
            if (fs.existsSync(fullContextPath)) fs.unlinkSync(fullContextPath);
        }

        renderWritingProfilesList();
        updateChatProfileSelector();
        renderRightSidebarProfiles();
        closeWritingProfileModal();
    });
}

// --- WRITING PROFILE MODAL NAVIGATION ---
const wpStep1 = document.getElementById('wp-step-1');
const wpStep2 = document.getElementById('wp-step-2');
const btnNextWp = document.getElementById('btn-next-writing-profile');
const btnBackWp = document.getElementById('btn-back-writing-profile');
const btnCancelWp = document.getElementById('btn-cancel-writing-profile');
const btnSaveWp = document.getElementById('btn-save-writing-profile');

function showWpStep1() {
    if(!wpStep1) return;
    wpStep2.classList.add('hidden');
    wpStep2.classList.remove('flex');
    wpStep1.classList.remove('hidden');
    
    btnBackWp.classList.add('hidden');
    btnSaveWp.classList.add('hidden');
    btnCancelWp.classList.remove('hidden');
    btnNextWp.classList.remove('hidden');
}

function showWpStep2() {
    const wpStep1 = document.getElementById('wp-step-1');
    const wpStep2 = document.getElementById('wp-step-2');
    const btnNextWp = document.getElementById('btn-next-writing-profile');
    const btnBackWp = document.getElementById('btn-back-writing-profile');
    const btnCancelWp = document.getElementById('btn-cancel-writing-profile');
    const btnSaveWp = document.getElementById('btn-save-writing-profile');

    if(wpStep1) wpStep1.classList.add('hidden');
    if(wpStep2) { wpStep2.classList.remove('hidden'); wpStep2.classList.add('grid'); } 
    
    if(btnCancelWp) btnCancelWp.classList.add('hidden');
    if(btnNextWp) btnNextWp.classList.add('hidden');
    if(btnBackWp) btnBackWp.classList.remove('hidden');
    if(btnSaveWp) btnSaveWp.classList.remove('hidden');
}

if(btnNextWp) btnNextWp.addEventListener('click', showWpStep2);
if(btnBackWp) btnBackWp.addEventListener('click', showWpStep1);

// --- AGENTIC RAG UI TOGGLE ---
const wpAgenticToggle = document.getElementById('wp-agentic-toggle');
const wpAgenticPromptContainer = document.getElementById('wp-agentic-prompt-container');

if(wpAgenticToggle) {
    wpAgenticToggle.addEventListener('change', (e) => {
        if (e.target.checked) wpAgenticPromptContainer.classList.remove('hidden');
        else wpAgenticPromptContainer.classList.add('hidden');
    });
}

// --- KNOWLEDGE BASE UPLOAD HANDLING ---
const wpDropzone = document.getElementById('wp-dropzone');
const wpFileInput = document.getElementById('wp-file-input');

if (wpDropzone && wpFileInput) {
    wpDropzone.addEventListener('click', () => wpFileInput.click());
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(name => {
        wpDropzone.addEventListener(name, (e) => { e.preventDefault(); e.stopPropagation(); }, false);
    });
    ['dragenter', 'dragover'].forEach(name => {
        wpDropzone.addEventListener(name, () => wpDropzone.classList.add('border-[#DDBA6E]', 'bg-white/5'), false);
    });
    ['dragleave', 'drop'].forEach(name => {
        wpDropzone.addEventListener(name, () => wpDropzone.classList.remove('border-[#DDBA6E]', 'bg-white/5'), false);
    });
    wpDropzone.addEventListener('drop', (e) => handleKnowledgeFiles(e.dataTransfer.files), false);
    wpFileInput.addEventListener('change', (e) => handleKnowledgeFiles(e.target.files));
}

function handleKnowledgeFiles(files) {
    if (!files || files.length === 0) return;
    const strategy = document.querySelector('input[name="wp-ingestion-strategy"]:checked')?.value || 'rag_search';

    Array.from(files).forEach(file => {
        if (pendingProfileFiles.length >= 10) return;
        const isDuplicate = pendingProfileFiles.some(f => f.name === file.name && f.size === file.size);
        if (!isDuplicate) {
            pendingProfileFiles.push({ 
                name: file.name, 
                path: file.path || '', 
                size: file.size, 
                fileObj: file,
                strategy: strategy 
            });
            hasKbChanged = true;
        }
    });
    renderPendingProfileFiles();
    if (wpFileInput) wpFileInput.value = '';
}

function renderPendingProfileFiles() {
    const wpFileList = document.getElementById('wp-file-list');
    if (!wpFileList) return;
    wpFileList.innerHTML = '';
    
    pendingProfileFiles.forEach((file, index) => {
        const badgeColor = file.strategy === 'full_context' ? 'bg-[#DDBA6E]/20 text-[#DDBA6E] border-[#DDBA6E]/30' : 'bg-[#3b82f6]/20 text-[#3b82f6] border-[#3b82f6]/30';
        const badgeText = file.strategy === 'full_context' ? 'Constant' : 'Searchable';

        const item = document.createElement('div');
        item.className = 'flex items-center justify-between bg-[#051116] border border-gray-800 p-2 rounded-md group';
        item.innerHTML = `
            <div class="flex items-center space-x-3 overflow-hidden">
                <svg class="w-4 h-4 text-gray-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
                <span class="text-xs text-gray-300 truncate max-w-[200px]">${file.name}</span>
                <span class="text-[9px] font-bold px-1.5 py-0.5 rounded border ${badgeColor} uppercase tracking-wider">${badgeText}</span>
            </div>
            <button type="button" class="text-gray-500 hover:text-[#ff5f56] transition-colors shrink-0 ml-2 cursor-pointer" onclick="removePendingProfileFile(${index})">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
        `;
        wpFileList.appendChild(item);
    });
}

window.removePendingProfileFile = function (index) {
    pendingProfileFiles.splice(index, 1);
    hasKbChanged = true;
    renderPendingProfileFiles();
};

// --- Chat Appearance Setup ---
setupAppearanceListeners(() => savedChats.find(c => c.id === currentChatId), saveChatData, chatsDir);

// --- Chat Core & Action Handling ---
const chatInput = document.getElementById('chat-input');
const chatMessagesContainer = document.getElementById('chat-messages-container');
const currentChatTitle = document.getElementById('current-chat-title');
const chatContextWindow = document.getElementById('chat-context-window');
const customProfileDropdown = document.getElementById('custom-profile-dropdown');
const customProfileLabel = document.getElementById('custom-profile-label');
const customProfileList = document.getElementById('custom-profile-list');
const dashboardChatsGrid = document.getElementById('dashboard-chats-grid');
const searchChatsInput = document.getElementById('search-chats-input');
const chatMaxContext = document.getElementById('chat-max-context');
const chatArchiveThreshold = document.getElementById('chat-archive-threshold');

function appendMessage(role, text, aiName = "AI Assistant", aiColor = "#DDBA6E", attachedFiles = [], msgIndex = -1, isLastUserMsg = false, isLastAiMsg = false, debugNotice = null) {
    renderChatMessage(chatMessagesContainer, role, text, aiName, aiColor, attachedFiles, currentChatId, chatsDir, msgIndex, isLastUserMsg, isLastAiMsg, debugNotice);
}

function openFileViewer(chatId, fileName) {
    openFileViewerModal(chatId, fileName, chatsDir);
}

if (chatInput) {
    chatInput.addEventListener('input', function () {
        this.style.height = 'auto';
        this.style.height = (this.scrollHeight) + 'px';
    });
    chatInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(); }
    });
}

[chatMaxContext, chatArchiveThreshold].forEach(input => {
    if (input) {
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                if (currentChatId) {
                    const currentChat = savedChats.find(c => c.id === currentChatId);
                    if (currentChat) {
                        currentChat.maxContext = parseInt(chatMaxContext?.value, 10) || 128000;
                        currentChat.archiveThreshold = parseInt(chatArchiveThreshold?.value, 10) || 60000;
                        saveChatData(currentChat);
                        if (typeof updateTokenProgressBar === 'function') updateTokenProgressBar();
                    }
                }
                input.blur();
            }
        });
    }
});

document.getElementById('btn-custom-profile')?.addEventListener('click', () => {
    if (customProfileDropdown) customProfileDropdown.classList.toggle('hidden');
});

document.getElementById('btn-send-message')?.addEventListener('click', sendMessage);

document.getElementById('btn-dropdown-add-profile')?.addEventListener('click', () => {
    if (customProfileDropdown) customProfileDropdown.classList.add('hidden');
    const chatRightSidebar = document.getElementById('chat-right-sidebar');
    if (chatRightSidebar) {
        chatRightSidebar.classList.remove('hidden');
        chatRightSidebar.classList.add('flex');
    }
    switchRightSidebarTab(document.getElementById('rs-tab-config'), document.getElementById('rs-view-config'), document.getElementById('rs-tab-files'), document.getElementById('rs-view-files'));

    const searchActiveProfiles = document.getElementById('search-active-profiles');
    if (!searchActiveProfiles) return;

    let blinks = 0;
    const interval = setInterval(() => {
        searchActiveProfiles.classList.toggle('border-[#DDBA6E]');
        searchActiveProfiles.classList.toggle('shadow-[0_0_8px_rgba(221,186,110,0.5)]');
        blinks++;
        if (blinks >= 4) {
            clearInterval(interval);
            searchActiveProfiles.classList.remove('border-[#DDBA6E]', 'shadow-[0_0_8px_rgba(221,186,110,0.5)]');
            searchActiveProfiles.classList.add('border-gray-800/80');
        }
    }, 250);
    searchActiveProfiles.focus();
});


// --- Memory & Token Engine ---
let messagesPendingSummarization = [];
let tempSummarizeEndIndex = 0;

function updateTokenProgressBar() {
    const currentChat = savedChats.find(c => c.id === currentChatId);
    if (!currentChat) return;

    const maxTokens = currentChat.archiveThreshold || 60000;
    const startIndex = currentChat.summarizedIndex || 0;
    const activeMessages = currentChat.messages.slice(startIndex);

    let tokensUsed = 0;
    const estimateTokens = (str) => Math.ceil((str || '').length / 4);
    activeMessages.forEach(m => { tokensUsed += estimateTokens(m.content); });

    const percentage = Math.min((tokensUsed / maxTokens) * 100, 100);
    const progressBar = document.getElementById('token-progress-bar');
    const tokenDisplay = document.getElementById('token-count-display');

    if (progressBar) {
        progressBar.style.width = `${percentage}%`;
        progressBar.className = `h-full transition-all duration-500 ease-out ${percentage >= 95 ? 'bg-red-500' : percentage >= 75 ? 'bg-orange-500' : 'bg-[var(--app-accent)]'}`;
    }

    if (tokenDisplay) {
        tokenDisplay.textContent = `~${tokensUsed} / ${maxTokens}`;
    }

    const autoSummarize = document.getElementById('auto-summarize-toggle')?.checked;
    if (autoSummarize && percentage >= 95 && activeMessages.length > 2) {
        openSummarizeModal();
    }
}

function openSummarizeModal() {
    const currentChat = savedChats.find(c => c.id === currentChatId);
    if (!currentChat || !currentChat.messages || currentChat.messages.length === 0) return;

    const startIndex = currentChat.summarizedIndex || 0;
    const endIndex = currentChat.messages.length;

    if (startIndex >= endIndex) {
        alert("All messages are already archived!");
        return;
    }

    tempSummarizeEndIndex = endIndex;
    messagesPendingSummarization = currentChat.messages.slice(startIndex, endIndex).map((msg, i) => ({
        originalIndex: startIndex + i,
        role: msg.role,
        content: msg.content,
        selected: true
    }));

    renderSummarizeModalList();

    const modal = document.getElementById('summarize-modal');
    if (modal) {
        modal.classList.remove('hidden');
        setTimeout(() => modal.classList.add('opacity-100'), 10);
    }
}

function renderSummarizeModalList() {
    const list = document.getElementById('summarize-msg-list');
    if (!list) return;
    list.innerHTML = '';

    messagesPendingSummarization.forEach((msgObj) => {
        const isUser = msgObj.role === 'user';
        const shortText = msgObj.content.length > 200 ? msgObj.content.substring(0, 200) + '...' : msgObj.content;

        const card = document.createElement('div');
        card.className = `flex items-start p-3 rounded-lg border transition-colors cursor-pointer ${msgObj.selected ? 'bg-[#1a2d32] border-[#DDBA6E]/50' : 'bg-[#0a161d] border-gray-800/80 opacity-60'}`;

        card.innerHTML = `
            <div class="flex-1 pr-4 pointer-events-none">
                <span class="text-[10px] font-bold uppercase mb-1 block ${isUser ? 'text-blue-400' : 'text-[#DDBA6E]'}">${isUser ? 'User' : 'AI'}</span>
                <p class="text-xs text-gray-300 break-words leading-relaxed">${escapeHTML(shortText)}</p>
            </div>
            <div class="shrink-0 flex items-center justify-center pt-2">
                <div class="w-5 h-5 rounded border flex items-center justify-center transition-colors ${msgObj.selected ? 'bg-[#DDBA6E] border-[#DDBA6E]' : 'border-gray-600'}">
                    ${msgObj.selected ? '<svg class="text-[#011419] w-3 h-3" fill="none" stroke="currentColor" stroke-width="3" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"></polyline></svg>' : ''}
                </div>
            </div>
        `;

        card.addEventListener('click', () => {
            msgObj.selected = !msgObj.selected;
            renderSummarizeModalList();
        });

        list.appendChild(card);
    });
}

function closeSummarizeModal() {
    const modal = document.getElementById('summarize-modal');
    if (modal) {
        modal.classList.remove('opacity-100');
        setTimeout(() => modal.classList.add('hidden'), 200);
    }
}

async function executeSummarization() {
    closeSummarizeModal();
    const currentChat = savedChats.find(c => c.id === currentChatId);
    if (!currentChat) return;

    const selectedMessages = messagesPendingSummarization.filter(m => m.selected);

    if (selectedMessages.length === 0) {
        // Se desativou tudo, apenas pula essas mensagens e não salva nada
        currentChat.summarizedIndex = tempSummarizeEndIndex;
        saveChatData(currentChat);
        updateTokenProgressBar();
        return;
    }

    const btn = document.getElementById('btn-manual-summarize');
    if (btn) { btn.innerText = "Archiving..."; btn.disabled = true; }

    const rawTextToArchive = selectedMessages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
    const blockId = `block_${Date.now()}`;

    // 1. FATIAMENTO E VETORIZAÇÃO
    const chunks = chunkText(rawTextToArchive);
    let vectors = [];
    try {
        vectors = await vectorizeChunks(chunks, `Chat Archive`, (current, total) => {
            if (btn) btn.innerText = `Vectorizing ${current}/${total}...`;
        });
        vectors.forEach(v => v.blockId = blockId);
    } catch (err) {
        console.error("Vectorization failed:", err);
        if (btn) { btn.innerText = "Summarize Now"; btn.disabled = false; }
        return;
    }

    // 2. GERAR O CARTÃO PARA A UI
    if (btn) btn.innerText = "Generating Card...";
    const systemPrompt = "You are an assistant. Briefly summarize the following conversation segment in 2 sentences max, just so the user knows what this block is about. First line MUST be 'TITLE: [3-word title]'.";

    const selectedProfile = savedWritingProfiles.find(p => p.id === currentSelectedProfileId) || savedWritingProfiles[0];
    const baseApiProfile = savedApiProfiles.find(api => api.id === selectedProfile.apiProfileId);

    let title = "Archived Memory";
    let summary = "Archived conversation context.";

    if (baseApiProfile) {
        const requestConfig = {
        provider: baseApiProfile.provider,
        apiKey: baseApiProfile.apiKey,
        baseUrl: baseApiProfile.baseUrl,
        model: selectedProfile.model,
        temperature: selectedProfile.temperature || 0.7,
        maxTokens: selectedProfile.maxTokens || 2048,
        manualMode: selectedProfile.manualMode || false,
        manualJson: selectedProfile.manualJson || ""
        };
        try {
            const response = await sendApiRequest(requestConfig, systemPrompt, [], rawTextToArchive);
            const lines = response.split('\n');
            if (lines[0].toUpperCase().startsWith('TITLE:')) {
                title = lines[0].substring(6).trim();
                summary = lines.slice(1).join('\n').trim();
            } else {
                summary = response.trim();
            }
        } catch (e) { console.error("Summary card generation failed:", e); }
    }

    // 3. SALVAR NO VECTOR DB
    const memoryDir = path.join(chatsDir, currentChat.id, 'Memory');
    if (!fs.existsSync(memoryDir)) fs.mkdirSync(memoryDir, { recursive: true });
    const dbPath = path.join(memoryDir, 'vector_db.json');

    let vectorDB = [];
    if (fs.existsSync(dbPath)) vectorDB = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    vectorDB = vectorDB.concat(vectors);
    fs.writeFileSync(dbPath, JSON.stringify(vectorDB, null, 2));

    // 4. SALVAR CARTÃO NO CHAT E AVANÇAR O INDEX
    if (!currentChat.memoryBlocks) currentChat.memoryBlocks = [];
    currentChat.memoryBlocks.push({ id: blockId, title, summary });

    // Avança o index mesmo por cima das mensagens que não foram selecionadas (elas são deletadas do contexto)
    currentChat.summarizedIndex = tempSummarizeEndIndex;
    saveChatData(currentChat);

    renderChatMemories(currentChat.id);
    updateTokenProgressBar();

    if (btn) { btn.innerText = "Summarize Now"; btn.disabled = false; }
}

function renderChatMemories(chatId) {
    const list = document.getElementById('chat-memories-list');
    if (!list) return;
    list.innerHTML = '';

    const currentChat = savedChats.find(c => c.id === chatId);
    if (!currentChat || !currentChat.memoryBlocks) return;

    currentChat.memoryBlocks.forEach(block => {
        const card = document.createElement('div');
        card.className = "bg-[#011419] border border-gray-800/80 rounded p-2 relative group";
        card.innerHTML = `
            <div class="text-[10px] font-bold text-[#DDBA6E] uppercase mb-1 pr-6 truncate">${escapeHTML(block.title)}</div>
            <p class="text-xs text-gray-400 line-clamp-2 leading-relaxed">${escapeHTML(block.summary)}</p>
            <button class="absolute top-1 right-1 p-1 text-gray-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity" title="Delete Memory">
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
            </button>
        `;

        card.querySelector('button').addEventListener('click', () => {
            const dbPath = path.join(chatsDir, chatId, 'Memory', 'vector_db.json');
            if (fs.existsSync(dbPath)) {
                let vectorDB = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
                vectorDB = vectorDB.filter(v => v.blockId !== block.id);
                fs.writeFileSync(dbPath, JSON.stringify(vectorDB, null, 2));
            }

            currentChat.memoryBlocks = currentChat.memoryBlocks.filter(b => b.id !== block.id);
            saveChatData(currentChat);
            renderChatMemories(chatId);
        });

        list.appendChild(card);
    });
}

// --- Global App Event Delegation (Restoring Chat Actions & Modal Controls) ---
document.addEventListener('click', async (e) => {

    // Modal Controls
    if (e.target.closest('#btn-manual-summarize')) openSummarizeModal();
    if (e.target.closest('#btn-cancel-summarize')) closeSummarizeModal();
    if (e.target.closest('#btn-confirm-summarize')) executeSummarization();

    if (e.target.closest('#btn-summarize-select-all')) {
        const btn = e.target.closest('#btn-summarize-select-all');
        const allSelected = messagesPendingSummarization.every(m => m.selected);
        messagesPendingSummarization.forEach(m => m.selected = !allSelected);
        btn.innerText = allSelected ? "Select All" : "Deselect All";
        renderSummarizeModalList();
    }

    // Chat Message Actions (Edit, Copy, Regenerate)
    const actionBtn = e.target.closest('.chat-action-btn');
    if (actionBtn && currentChatId) {
        const action = actionBtn.getAttribute('data-action');
        const index = parseInt(actionBtn.getAttribute('data-index'), 10);
        const currentChat = savedChats.find(c => c.id === currentChatId);

        if (!currentChat || !currentChat.messages[index]) return;
        const msg = currentChat.messages[index];

        if (action === 'copy') {
            navigator.clipboard.writeText(msg.content);
            const span = actionBtn.querySelector('span');
            if (span) {
                const oldText = span.innerText;
                span.innerText = "Copied!";
                actionBtn.classList.add('text-green-400');
                setTimeout(() => { span.innerText = oldText; actionBtn.classList.remove('text-green-400'); }, 2000);
            }
        }

        else if (action === 'edit-user') {
            const bubbleContent = actionBtn.closest('.flex-col').querySelector('.msg-content');
            if (!bubbleContent) return;

            const safeRawText = msg.content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            bubbleContent.innerHTML = `
                <textarea class="w-full bg-[#011419] border border-[#DDBA6E] text-white text-sm rounded p-3 focus:outline-none focus:ring-1 focus:ring-[#DDBA6E] resize-y min-h-[100px] font-mono mt-2">${safeRawText}</textarea>
                <div class="flex justify-end space-x-2 mt-2">
                    <button class="px-3 py-1.5 text-xs text-gray-400 hover:text-white transition-colors btn-cancel-edit">Cancel</button>
                    <button class="px-3 py-1.5 text-xs bg-[#DDBA6E]/10 text-[#DDBA6E] border border-[#DDBA6E]/30 rounded hover:bg-[#DDBA6E]/20 transition-colors btn-save-edit">Save & Resend</button>
                </div>
            `;
            actionBtn.closest('.msg-actions').classList.add('hidden');

            const textarea = bubbleContent.querySelector('textarea');
            textarea.focus();
            textarea.style.height = 'auto';
            textarea.style.height = (textarea.scrollHeight) + 'px';
            textarea.addEventListener('input', function () { this.style.height = 'auto'; this.style.height = (this.scrollHeight) + 'px'; });

            bubbleContent.querySelector('.btn-cancel-edit').addEventListener('click', () => loadChatIntoView(currentChatId));
            bubbleContent.querySelector('.btn-save-edit').addEventListener('click', async () => {
                const newText = textarea.value.trim();
                if (!newText) return;
                currentChat.messages = currentChat.messages.slice(0, index);
                currentChat.messages.push({ role: 'user', content: newText, attachedFiles: msg.attachedFiles || [] });
                currentChat.updatedAt = Date.now();
                saveChatData(currentChat);
                loadChatIntoView(currentChatId);
                await triggerAiGeneration(newText, msg.attachedFiles || []);
            });
        }

        else if (action === 'regenerate') {
            currentChat.messages = currentChat.messages.slice(0, index);
            saveChatData(currentChat);
            loadChatIntoView(currentChatId);
            const lastMsg = currentChat.messages[currentChat.messages.length - 1];
            if (lastMsg && lastMsg.role === 'user') {
                await triggerAiGeneration(lastMsg.content, lastMsg.attachedFiles || []);
            }
        }

        else if (action === 'edit-ai') {
            const bubbleContent = actionBtn.closest('.flex-col').querySelector('.msg-content');
            if (!bubbleContent) return;

            const safeRawText = msg.content.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
            bubbleContent.innerHTML = `
                <textarea class="w-full bg-[#011419] border border-[#DDBA6E] text-white text-sm rounded p-3 focus:outline-none focus:ring-1 focus:ring-[#DDBA6E] resize-y min-h-[150px] font-mono mt-2">${safeRawText}</textarea>
                <div class="flex justify-end space-x-2 mt-2">
                    <button class="px-3 py-1.5 text-xs text-gray-400 hover:text-white transition-colors btn-cancel-edit">Cancel</button>
                    <button class="px-3 py-1.5 text-xs bg-[#DDBA6E]/10 text-[#DDBA6E] border border-[#DDBA6E]/30 rounded hover:bg-[#DDBA6E]/20 transition-colors btn-save-edit">Save</button>
                </div>
            `;
            actionBtn.closest('.msg-actions').classList.add('hidden');

            const textarea = bubbleContent.querySelector('textarea');
            textarea.focus();
            textarea.style.height = 'auto';
            textarea.style.height = (textarea.scrollHeight) + 'px';
            textarea.addEventListener('input', function () { this.style.height = 'auto'; this.style.height = (this.scrollHeight) + 'px'; });

            bubbleContent.querySelector('.btn-cancel-edit').addEventListener('click', () => loadChatIntoView(currentChatId));
            bubbleContent.querySelector('.btn-save-edit').addEventListener('click', () => {
                msg.content = textarea.value;
                saveChatData(currentChat);
                loadChatIntoView(currentChatId);
            });
        }
    }
});

// --- AI GENERATION LOGIC ---
async function triggerAiGeneration(text, attachedFileNames) {
    const selectedProfile = savedWritingProfiles.find(p => p.id === currentSelectedProfileId);
    const aiName = selectedProfile ? selectedProfile.name : "AI Assistant";
    const aiColor = selectedProfile ? selectedProfile.color : "#DDBA6E";

    const currentChat = savedChats.find(c => c.id === currentChatId);
    if (!currentChat) return;

    const baseApiProfile = savedApiProfiles.find(api => api.id === selectedProfile.apiProfileId);
    if (!baseApiProfile) {
        currentChat.messages.push({ role: 'ai', content: "[Error]: No valid API Profile linked to this AI.", aiName, aiColor });
        saveChatData(currentChat);
        loadChatIntoView(currentChatId);
        return;
    }

    const requestConfig = {
        provider: baseApiProfile.provider,
        apiKey: baseApiProfile.apiKey,
        baseUrl: baseApiProfile.baseUrl,
        model: selectedProfile.model,
        temperature: selectedProfile.temperature || 0.7,
        maxTokens: selectedProfile.maxTokens || 2048
    };

    appendMessage('ai', "...", aiName, aiColor, [], -1, false, false);
    
    const updateLoadingUI = (statusText) => {
        const chatContainer = document.getElementById('chat-messages-container');
        if (chatContainer && chatContainer.lastElementChild) {
            const contentBox = chatContainer.lastElementChild.querySelector('.msg-content');
            if (contentBox) contentBox.innerHTML = `<span class="animate-pulse text-[var(--app-accent)] font-semibold text-sm">${statusText}</span>`;
        }
    };

    let aiResponseText = "";
    let debugNotice = null;
    let inputTokens = 0;

    // --- READ CONSTANT MEMORY (FULL CONTEXT) ---
    let baseSystemPrompt = selectedProfile.systemPrompt || "";
    const fullContextPath = path.join(profilesDir, selectedProfile.id, 'KnowledgeBase', 'full_context.json');
    if (fs.existsSync(fullContextPath)) {
        try {
            const constantMemories = JSON.parse(fs.readFileSync(fullContextPath, 'utf8'));
            if (constantMemories.length > 0) {
                baseSystemPrompt += "\n\n--- CONSTANT MEMORY (CORE DOCUMENTS) ---\n";
                constantMemories.forEach(doc => {
                    baseSystemPrompt += `[DOCUMENT: ${doc.name}]\n${doc.content}\n\n`;
                });
            }
        } catch (err) { console.error("Error reading full_context.json", err); }
    }

    // --- AGENTIC RAG FLOW ---
    if (selectedProfile.isAgentic && selectedProfile.agenticPrompt) {
        updateLoadingUI("🤔 Analyzing context and generating search queries...");

        const recentHistory = currentChat.messages.slice(-6).map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n');
        
        const phase1Prompt = `You are an autonomous search agent. Read the recent chat history and the user's latest query to understand the context.\n\nUSER INSTRUCTIONS:\n${selectedProfile.agenticPrompt}\n\n[RECENT HISTORY]\n${recentHistory}\n\n[USER LATEST QUERY]\n${text}\n\nRETURN ONLY A VALID JSON ARRAY OF STRINGS.`;

        // 🐛 DEBUG: Log da Fase 1 (Geração da Query)
        console.groupCollapsed("🤖 [AGENTIC RAG] Phase 1: Search Query Generation");
        console.log("📝 System Prompt Sent to Agent:\n", phase1Prompt);
        console.groupEnd();

        try {
            const jsonResponseText = await sendApiRequest(requestConfig, phase1Prompt, [], "Generate search queries based on the system instructions.");
            
            // 🐛 DEBUG: Resposta crua da Fase 1
            console.groupCollapsed("🤖 [AGENTIC RAG] Phase 1: Raw AI Response");
            console.log("📥 Raw JSON String from AI:\n", jsonResponseText);
            console.groupEnd();

            let cleanedJson = jsonResponseText.replace(/```json/g, '').replace(/```/g, '').trim();
            let queries = JSON.parse(cleanedJson);
            if (!Array.isArray(queries)) queries = [text]; 

            updateLoadingUI(`🔍 Searching database for: "${queries.join(', ')}" ...`);

            let allRagResults = [];
            let allWorkspaceResults = [];
            let allMemoryResults = [];

            for (const q of queries) {
                const rRes = await searchKnowledgeBase(q, selectedProfile.id, profilesDir, 3);
                const wRes = await searchChatKnowledgeBase(q, currentChat.id, chatsDir, 3);
                const mRes = await searchChatMemories(q, currentChat.id, chatsDir, 3);
                
                allRagResults = allRagResults.concat(rRes);
                allWorkspaceResults = allWorkspaceResults.concat(wRes);
                allMemoryResults = allMemoryResults.concat(mRes);
            }

            const deduplicate = (arr) => {
                const seen = new Set();
                return arr.filter(item => {
                    if (seen.has(item.text)) return false;
                    seen.add(item.text); return true;
                });
            };

            const uniqueRag = deduplicate(allRagResults);
            const uniqueWorkspace = deduplicate(allWorkspaceResults);
            const uniqueMemories = deduplicate(allMemoryResults);

            const totalMemories = uniqueRag.length + uniqueWorkspace.length + uniqueMemories.length;

            updateLoadingUI(`📚 Reading ${totalMemories} documents found. Writing response...`);

            let enrichedSystemPrompt = baseSystemPrompt;
            if (totalMemories > 0) {
                enrichedSystemPrompt += "\n\n--- CONTEXT INFORMATION ---\nUse the information below to support your answer:\n\n";
                uniqueRag.forEach(res => { enrichedSystemPrompt += `[Profile Lore: ${res.source}]\n${res.text}\n\n`; });
                uniqueWorkspace.forEach(res => { enrichedSystemPrompt += `[Workspace Documents: ${res.source}]\n${res.text}\n\n`; });
                uniqueMemories.forEach(res => { enrichedSystemPrompt += `[Archived Memory: ${res.source}]\n${res.text}\n\n`; });
            }

            const maxTokensAllowed = currentChat.maxContext || 128000;
            const trimmedHistory = trimContextWindow(enrichedSystemPrompt, text, currentChat, maxTokensAllowed);

            const estimateTokens = (str) => Math.ceil((str || '').length / 4);
            inputTokens = estimateTokens(enrichedSystemPrompt) + estimateTokens(text);
            trimmedHistory.forEach(msg => { inputTokens += estimateTokens(msg.content); });
            
            if (advancedSettings.ragDebug) {
                debugNotice = `[AGENTIC RAG] Queries: ${queries.join(', ')} | Injected ${totalMemories} context blocks. | Est. Input Tokens: ${inputTokens}`;
            }

            // 🐛 DEBUG: Log da Fase 2 (Resposta Final)
            console.groupCollapsed("🧠 [AGENTIC RAG] Phase 2: Final Response Construction");
            console.log("🧩 Enriched System Prompt (Rules + Injected RAG Context):\n", enrichedSystemPrompt);
            console.log("📜 Chat History Array Trimmed for Token Limit:\n", trimmedHistory);
            console.log("🗣️ User Latest Query:\n", text);
            console.groupEnd();

            aiResponseText = await sendApiRequest(requestConfig, enrichedSystemPrompt, trimmedHistory, text);

        } catch (error) {
            console.error("Agentic RAG Failed, falling back to standard generation:", error);
            aiResponseText = "[System Error]: Agentic RAG failed to parse JSON or connect to API. Please check console.";
        }

    } 
    // --- STANDARD RAG FLOW ---
    else {
        const ragResults = await searchKnowledgeBase(text, selectedProfile.id, profilesDir, 3);
        const workspaceKbResults = await searchChatKnowledgeBase(text, currentChat.id, chatsDir, 3);
        const memoryResults = await searchChatMemories(text, currentChat.id, chatsDir, 3);

        let enrichedSystemPrompt = baseSystemPrompt;
        const totalMemories = ragResults.length + workspaceKbResults.length + memoryResults.length;

        if (totalMemories > 0) {
            enrichedSystemPrompt += "\n\n--- CONTEXT INFORMATION ---\nUse the information below to support your answer:\n\n";
            ragResults.forEach(res => { enrichedSystemPrompt += `[Profile Lore: ${res.source}]\n${res.text}\n\n`; });
            workspaceKbResults.forEach(res => { enrichedSystemPrompt += `[Workspace Documents: ${res.source}]\n${res.text}\n\n`; });
            memoryResults.forEach(res => { enrichedSystemPrompt += `[Archived Memory: ${res.source}]\n${res.text}\n\n`; });
        }

        const maxTokensAllowed = currentChat.maxContext || 128000;
        const trimmedHistory = trimContextWindow(enrichedSystemPrompt, text, currentChat, maxTokensAllowed);

        const estimateTokens = (str) => Math.ceil((str || '').length / 4);
        inputTokens = estimateTokens(enrichedSystemPrompt) + estimateTokens(text);
        trimmedHistory.forEach(msg => { inputTokens += estimateTokens(msg.content); });

        if (advancedSettings.ragDebug) {
            debugNotice = `Injected ${totalMemories} context blocks. Threshold: ${advancedSettings.similarity} | Est. Input Tokens: ${inputTokens}`;
        }

        // 🐛 DEBUG (Opcional): Se quiser ver o RAG Normal também
        console.groupCollapsed("⚙️ [STANDARD RAG] Execution Logs");
        console.log("🧩 Enriched System Prompt:\n", enrichedSystemPrompt);
        console.groupEnd();

        aiResponseText = await sendApiRequest(requestConfig, enrichedSystemPrompt, trimmedHistory, text);
    }

    // --- SAVE AND RENDER ---
    currentChat.messages.push({ 
        role: 'ai', 
        content: aiResponseText, 
        aiName, 
        aiColor, 
        debugNotice 
    });
    
    currentChat.updatedAt = Date.now();
    saveChatData(currentChat);
    loadChatIntoView(currentChatId);
}

async function sendMessage() {
    if (!chatInput) return;
    let text = chatInput.value.trim();
    if (!text && pendingFiles.length === 0) return;

    if (!currentSelectedProfileId) {
        const container = document.getElementById('custom-profile-selector-container');
        if (container) {
            container.classList.add('border-red-500');
            setTimeout(() => container.classList.remove('border-red-500'), 3500);
        }
        return;
    }

    const attachedFileNames = pendingFiles.map(f => f.name);
    if (!text && pendingFiles.length > 0) text = `Attached: ${attachedFileNames.join(', ')}`;

    chatInput.value = '';
    chatInput.style.height = 'auto';

    if (!currentChatId) {
        currentChatId = Date.now().toString();
        const newChat = {
            id: currentChatId,
            title: text.substring(0, 30) + (text.length > 30 ? '...' : ''),
            updatedAt: Date.now(),
            isPinned: false,
            maxContext: chatMaxContext ? (parseInt(chatMaxContext.value) || 128000) : 128000,
            archiveThreshold: chatArchiveThreshold ? (parseInt(chatArchiveThreshold.value) || 60000) : 60000,
            summarizedIndex: 0,
            activeProfiles: [currentSelectedProfileId],
            messages: []
        };
        savedChats.push(newChat);
        if (currentChatTitle) currentChatTitle.textContent = newChat.title;
        saveChatData(newChat);
        renderRightSidebarProfiles();
    }

    await processAndSaveAttachments(currentChatId);

    const currentChat = savedChats.find(c => c.id === currentChatId);
    if (currentChat) {
        currentChat.messages.push({ role: 'user', content: text, attachedFiles: attachedFileNames });
        currentChat.updatedAt = Date.now();
        saveChatData(currentChat);
        loadChatIntoView(currentChatId);
        await triggerAiGeneration(text, attachedFileNames);
    }
}

function loadChatIntoView(chatId) {
    currentChatId = chatId;
    
    document.getElementById('view-dashboard')?.classList.replace('flex', 'hidden');
    document.getElementById('view-profile-library')?.classList.replace('flex', 'hidden');
    
    const activeChat = document.getElementById('view-active-chat');
    if (activeChat) {
        activeChat.classList.remove('hidden');
        activeChat.classList.add('flex');
    }

    if (chatMessagesContainer) chatMessagesContainer.innerHTML = '';

    const chat = savedChats.find(c => c.id === chatId);
    if (chat) {
        if (currentChatTitle) currentChatTitle.textContent = chat.title;
        if (chatMaxContext) chatMaxContext.value = chat.maxContext || 128000;
        if (chatArchiveThreshold) chatArchiveThreshold.value = chat.archiveThreshold || 60000;

        applyChatAppearance(chat);

        if (chat.messages) {
            let lastUserIdx = -1;
            let lastAiIdx = -1;
            for (let i = 0; i < chat.messages.length; i++) {
                if (chat.messages[i].role === 'user') lastUserIdx = i;
                if (chat.messages[i].role === 'ai' || chat.messages[i].role === 'model') lastAiIdx = i;
            }

            chat.messages.forEach((msg, index) => {
                appendMessage(
                    msg.role, msg.content, msg.aiName || "AI Assistant", msg.aiColor || "#DDBA6E",
                    msg.attachedFiles || [], index, index === lastUserIdx, index === lastAiIdx,
                    msg.debugNotice
                );
            });
        }
    }

    updateChatProfileSelector();
    renderRightSidebarProfiles();
    renderRightSidebarFiles(chatId);
    renderWorkflowsSidebar();
    renderChatMemories(chatId);
    updateTokenProgressBar();
}

if (searchChatsInput) {
    searchChatsInput.addEventListener('input', (e) => {
        renderDashboardChatsGrid(e.target.value);
    });
}

function renderDashboardChatsGrid(filter = '') {
    if (!dashboardChatsGrid) return;
    dashboardChatsGrid.innerHTML = '';

    const filteredChats = savedChats.filter(c => (c.title || '').toLowerCase().includes(filter.toLowerCase()));

    filteredChats.sort((a, b) => {
        if (a.isPinned && !b.isPinned) return -1;
        if (!a.isPinned && b.isPinned) return 1;
        return b.updatedAt - a.updatedAt;
    });

    if (filteredChats.length === 0) {
        dashboardChatsGrid.innerHTML = '<div class="col-span-full flex flex-col items-center justify-center text-gray-500 py-16"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="mb-3 opacity-50"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg><p class="text-sm font-medium">No workspaces found.</p></div>';
        return;
    }

    filteredChats.forEach(chat => {
        let bgStyle = 'background-color: #0a161d;';
        const chatDir = path.join(chatsDir, chat.id);
        
        if (fs.existsSync(chatDir)) {
            try {
                const files = fs.readdirSync(chatDir);
                const bgFile = files.find(f => f.toLowerCase().startsWith('bg_image'));
                
                if (bgFile) {
                    let bgPath = path.join(chatDir, bgFile).replace(/\\/g, '/');
                    bgPath = encodeURI(bgPath).replace(/#/g, '%23');
                    bgStyle = `background-image: linear-gradient(to bottom, rgba(10, 22, 29, 0.8), rgba(10, 22, 29, 0.8)), url("file:///${bgPath}"); background-size: cover; background-position: center;`;
                }
            } catch (e) {
                console.error("Error loading background image for dashboard card:", e);
            }
        }

        const card = document.createElement('div');
        card.className = "group relative rounded-xl border border-gray-800/80 hover:border-[var(--app-accent)]/50 overflow-hidden cursor-pointer transition-all duration-300 shadow-lg hover:-translate-y-1 h-40 flex flex-col justify-end p-5";
        card.style.cssText = bgStyle;

        const pinIcon = chat.isPinned 
            ? `<svg class="absolute top-4 left-4 text-[var(--app-accent)]" width="16" height="16" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path></svg>` 
            : '';

        card.innerHTML = `
            ${pinIcon}
            <div class="absolute top-4 right-4">
                <button class="chat-menu-btn opacity-0 group-hover:opacity-100 text-gray-400 hover:text-white transition-opacity p-1.5 rounded-md hover:bg-black/50 backdrop-blur-sm shadow-sm" title="Options">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>
                </button>
                <div class="chat-dropdown hidden absolute right-0 top-8 w-36 bg-[#011419] border border-gray-800 rounded-md shadow-xl z-50 overflow-hidden">
                    <button class="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-[#1a2d32] hover:text-white transition-colors flex items-center space-x-2 pin-chat-btn">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="17" x2="12" y2="22"></line><path d="M5 17h14v-1.5c0-1.5-2-3.5-2-5.5v-3c0-2-1.5-4-4-4H9c-2.5 0-4 2-4 4v3c0-2-2 4-2 5.5V17z"></path></svg>
                        <span>${chat.isPinned ? 'Unpin' : 'Pin'}</span>
                    </button>
                    <button class="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-[#1a2d32] hover:text-white transition-colors flex items-center space-x-2 rename-chat-btn">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
                        <span>Rename</span>
                    </button>
                    <div class="h-px bg-gray-800 w-full my-0.5"></div>
                    <button class="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors flex items-center space-x-2 delete-chat-btn">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                        <span>Delete</span>
                    </button>
                </div>
            </div>
            <div class="relative z-10 w-full pr-4">
                <h3 class="text-white font-bold text-lg truncate drop-shadow-md">${escapeHTML(chat.title)}</h3>
                <p class="text-xs text-[var(--app-accent)] mt-1.5 drop-shadow-md font-medium">${chat.messages ? chat.messages.length : 0} messages</p>
            </div>
        `;

        card.addEventListener('click', (e) => {
            if (e.target.closest('.chat-menu-btn') || e.target.closest('.chat-dropdown')) return;
            loadChatIntoView(chat.id);
        });

        const menuBtn = card.querySelector('.chat-menu-btn');
        const dropdown = card.querySelector('.chat-dropdown');

        menuBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            document.querySelectorAll('.chat-dropdown').forEach(d => { if (d !== dropdown) d.classList.add('hidden'); });
            dropdown.classList.toggle('hidden');
        });

        card.querySelector('.pin-chat-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            chat.isPinned = !chat.isPinned;
            saveChatData(chat);
            renderDashboardChatsGrid(document.getElementById('search-chats-input')?.value || '');
        });

        card.querySelector('.rename-chat-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.add('hidden');
            openRenameModal(chat.title, (newName) => {
                chat.title = newName;
                saveChatData(chat);
                renderDashboardChatsGrid(document.getElementById('search-chats-input')?.value || '');
            });
        });

        card.querySelector('.delete-chat-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            dropdown.classList.add('hidden');
            openDeleteModal("Delete Workspace", `Are you sure you want to permanently delete "${chat.title}"?`, () => {
                savedChats = savedChats.filter(c => c.id !== chat.id);
                deleteChatFolder(chat.id);
                renderDashboardChatsGrid(document.getElementById('search-chats-input')?.value || '');
            });
        });

        dashboardChatsGrid.appendChild(card);
    });
}

// --- Chat File Attachments ---
const fileAttachmentInput = document.getElementById('file-attachment-input');
const pendingFilesContainer = document.getElementById('pending-files-container');

document.getElementById('btn-attach-file')?.addEventListener('click', () => fileAttachmentInput?.click());
fileAttachmentInput?.addEventListener('change', (e) => handleFilesAdded(Array.from(e.target.files)));

if (chatInput) {
    chatInput.addEventListener('dragover', (e) => { e.preventDefault(); chatInput.classList.add('bg-white/5'); });
    chatInput.addEventListener('dragleave', () => chatInput.classList.remove('bg-white/5'));
    chatInput.addEventListener('drop', (e) => {
        e.preventDefault();
        chatInput.classList.remove('bg-white/5');
        if (e.dataTransfer.files.length > 0) handleFilesAdded(Array.from(e.dataTransfer.files));
    });
    chatInput.addEventListener('paste', (e) => {
        const items = (e.clipboardData || e.originalEvent.clipboardData).items;
        const pastedFiles = [];
        for (let index in items) {
            const item = items[index];
            if (item.kind === 'file') pastedFiles.push(item.getAsFile());
        }
        if (pastedFiles.length > 0) handleFilesAdded(pastedFiles);
    });
}

function handleFilesAdded(files) {
    files.forEach(file => {
        const fileId = Date.now().toString() + Math.random().toString(36).substring(7);
        pendingFiles.push({ id: fileId, fileObj: file, name: file.name, type: file.type });
    });
    renderPendingFiles();
}

function renderPendingFiles() {
    if (!pendingFilesContainer) return;
    if (pendingFiles.length === 0) {
        pendingFilesContainer.classList.add('hidden');
        pendingFilesContainer.innerHTML = '';
        return;
    }

    pendingFilesContainer.classList.remove('hidden');
    pendingFilesContainer.classList.add('flex');
    pendingFilesContainer.innerHTML = '';

    pendingFiles.forEach(pf => {
        const item = document.createElement('div');
        item.className = 'flex items-center bg-[#1a2d32] border border-gray-700 rounded-md px-2 py-1 space-x-2 max-w-[150px]';
        item.innerHTML = `
            <svg class="text-gray-400 shrink-0" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline></svg>
            <span class="text-xs text-gray-300 truncate w-full">${pf.name}</span>
            <button class="text-gray-500 hover:text-red-400 remove-pending-btn">×</button>
        `;
        item.querySelector('.remove-pending-btn').addEventListener('click', () => {
            pendingFiles = pendingFiles.filter(f => f.id !== pf.id);
            renderPendingFiles();
        });
        pendingFilesContainer.appendChild(item);
    });
}

async function processAndSaveAttachments(targetChatId) {
    if (pendingFiles.length === 0) return;

    const targetFilesFolder = path.join(chatsDir, targetChatId, 'Files');
    if (!fs.existsSync(targetFilesFolder)) fs.mkdirSync(targetFilesFolder, { recursive: true });

    for (const pf of pendingFiles) {
        try {
            const destPath = path.join(targetFilesFolder, pf.name);
            if (pf.fileObj.path) {
                fs.copyFileSync(pf.fileObj.path, destPath);
            } else {
                const arrayBuffer = await pf.fileObj.arrayBuffer();
                fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
            }
        } catch (err) {
            console.error("Error saving file attachment:", err);
        }
    }

    pendingFiles = [];
    renderPendingFiles();
    renderRightSidebarFiles(targetChatId);
}

function renderRightSidebarFiles(chatId) {
    const rsViewFiles = document.getElementById('rs-view-files');
    if (!rsViewFiles) return;

    if (!chatId) {
        rsViewFiles.classList.add('items-center', 'justify-center');
        rsViewFiles.innerHTML = `<div class="flex flex-col items-center justify-center h-full"><svg class="text-gray-700 mb-3" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path></svg><p class="text-xs text-gray-500 text-center">No chat selected.</p></div>`;
        return;
    }

    const currentChat = savedChats.find(c => c.id === chatId);
    if (!currentChat) return;

    const filesFolder = path.join(chatsDir, chatId, 'Files');
    let userFilesHTML = '';
    let hasUserFiles = false;

    // --- USER UPLOADS SECTION ---
    if (fs.existsSync(filesFolder)) {
        const files = fs.readdirSync(filesFolder);
        if (files.length > 0) {
            hasUserFiles = true;
            files.forEach(fileName => {
                const ext = fileName.split('.').pop().toLowerCase();
                let iconSvg = `<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><polyline points="13 2 13 9 20 9"></polyline>`;
                if (['jpg', 'jpeg', 'png', 'gif', 'webp'].includes(ext)) iconSvg = `<rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><polyline points="21 15 16 10 5 21"></polyline>`;
                else if (['mp4', 'webm', 'mov'].includes(ext)) iconSvg = `<polygon points="23 7 16 12 23 17 23 7"></polygon><rect x="1" y="5" width="15" height="14" rx="2" ry="2"></rect>`;
                else if (ext === 'pdf') iconSvg = `<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline>`;

                userFilesHTML += `
                    <div class="flex items-center justify-between p-2 mb-2 bg-[#0a161d] border border-gray-800/80 rounded-lg group cursor-pointer hover:border-gray-600 transition-colors file-item-row" data-filename="${fileName}">
                        <div class="flex items-center space-x-3 overflow-hidden pointer-events-none">
                            <svg class="text-[#DDBA6E] shrink-0" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">${iconSvg}</svg>
                            <span class="text-sm text-gray-300 truncate" title="${fileName}">${fileName}</span>
                        </div>
                        <div class="relative">
                            <button class="file-menu-btn text-gray-500 hover:text-white shrink-0 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-white/5" data-filename="${fileName}">
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>
                            </button>
                            <div class="file-dropdown hidden absolute right-0 top-6 w-32 bg-[#011419] border border-gray-800 rounded-md shadow-xl z-50 overflow-hidden">
                                <button class="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-[#1a2d32] hover:text-white transition-colors flex items-center space-x-2 rename-file-btn" data-filename="${fileName}">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
                                    <span>Rename</span>
                                </button>
                                <div class="h-px bg-gray-800 w-full my-0.5"></div>
                                <button class="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors flex items-center space-x-2 delete-file-btn" data-filename="${fileName}">
                                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                                    <span>Delete</span>
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            });
        }
    }

    // --- AI MEDIA SECTION ---
    let aiFilesHTML = '';
    let hasAiFiles = false;
    const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;

    currentChat.messages.forEach(msg => {
        if (msg.role === 'model' || msg.role === 'ai') {
            let match;
            while ((match = imgRegex.exec(msg.content)) !== null) {
                hasAiFiles = true;
                const altText = match[1] || 'AI Generated Image';
                const imgUrl = match[2];

                aiFilesHTML += `
                    <div class="flex items-center space-x-3 p-2 mb-2 rounded-lg bg-[#0a161d] border border-gray-800/50 hover:border-[#DDBA6E]/50 hover:bg-[#1a2d32] transition-colors cursor-pointer group" onclick="window.open('${imgUrl}', '_blank')">
                        <div class="w-10 h-10 rounded bg-[#011419] flex items-center justify-center shrink-0 overflow-hidden border border-gray-800/80">
                            <img src="${imgUrl}" class="w-full h-full object-cover opacity-80 group-hover:opacity-100 group-hover:scale-110 transition-all duration-300">
                        </div>
                        <div class="flex-1 flex flex-col overflow-hidden">
                            <span class="truncate text-xs font-semibold text-gray-300 group-hover:text-white transition-colors">${escapeHTML(altText)}</span>
                            <span class="text-[10px] text-gray-500 uppercase tracking-wider mt-0.5">Image</span>
                        </div>
                    </div>
                `;
            }
        }
    });

    if (!hasUserFiles && !hasAiFiles) {
        rsViewFiles.classList.add('items-center', 'justify-center');
        rsViewFiles.innerHTML = `<div class="flex flex-col items-center justify-center h-full"><svg class="text-gray-700 mb-3" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path></svg><p class="text-xs text-gray-500 text-center">No files in this chat.</p></div>`;
        return;
    }

    rsViewFiles.classList.remove('items-center', 'justify-center');
    rsViewFiles.innerHTML = `
        <div class="w-full h-full flex flex-col space-y-4">
            ${hasUserFiles ? `
            <div class="sidebar-section">
                <div class="flex items-center justify-between cursor-pointer mb-2" id="toggle-user-files-dynamic">
                    <span class="text-xs font-bold text-gray-400 uppercase tracking-wider">User Uploads</span>
                    <svg id="chevron-user-dynamic" class="text-gray-500 transform transition-transform duration-200" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </div>
                <div id="user-files-list-dynamic" class="flex flex-col">
                    ${userFilesHTML}
                </div>
            </div>
            ` : ''}

            ${hasAiFiles ? `
            <div class="sidebar-section">
                <div class="flex items-center justify-between cursor-pointer mb-2" id="toggle-ai-files-dynamic">
                    <span class="text-xs font-bold text-gray-400 uppercase tracking-wider">AI Media</span>
                    <svg id="chevron-ai-dynamic" class="text-gray-500 transform transition-transform duration-200" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </div>
                <div id="ai-files-list-dynamic" class="flex flex-col">
                    ${aiFilesHTML}
                </div>
            </div>
            ` : ''}
        </div>
    `;

    // --- ACCORDION EVENTS ---
    const tUser = document.getElementById('toggle-user-files-dynamic');
    if (tUser) tUser.addEventListener('click', () => {
        document.getElementById('user-files-list-dynamic').classList.toggle('hidden');
        document.getElementById('chevron-user-dynamic').classList.toggle('-rotate-90');
    });

    const tAi = document.getElementById('toggle-ai-files-dynamic');
    if (tAi) tAi.addEventListener('click', () => {
        document.getElementById('ai-files-list-dynamic').classList.toggle('hidden');
        document.getElementById('chevron-ai-dynamic').classList.toggle('-rotate-90');
    });

    // --- CONTEXT MENU EVENTS ---
    rsViewFiles.querySelectorAll('.file-item-row').forEach(row => {
        row.addEventListener('click', (e) => {
            if (e.target.closest('.file-menu-btn') || e.target.closest('.file-dropdown')) return;
            openFileViewer(chatId, row.getAttribute('data-filename'));
        });
    });

    rsViewFiles.querySelectorAll('.file-menu-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const dropdown = e.currentTarget.nextElementSibling;
            document.querySelectorAll('.file-dropdown').forEach(d => { if (d !== dropdown) d.classList.add('hidden'); });
            dropdown.classList.toggle('hidden');
        });
    });

    rsViewFiles.querySelectorAll('.rename-file-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.currentTarget.closest('.file-dropdown').classList.add('hidden');

            const oldName = e.currentTarget.getAttribute('data-filename');
            const extIndex = oldName.lastIndexOf('.');
            const baseName = extIndex !== -1 ? oldName.substring(0, extIndex) : oldName;
            const ext = extIndex !== -1 ? oldName.substring(extIndex) : '';

            openRenameModal(baseName, (newName) => {
                const finalName = newName.trim() + ext;
                if (finalName === oldName || !newName.trim()) return;

                const oldPath = path.join(filesFolder, oldName);
                const newPath = path.join(filesFolder, finalName);
                try {
                    fs.renameSync(oldPath, newPath);
                    const chatObj = savedChats.find(c => c.id === chatId);
                    if (chatObj) {
                        chatObj.messages.forEach(msg => {
                            if (msg.attachedFiles) {
                                const fileIdx = msg.attachedFiles.indexOf(oldName);
                                if (fileIdx !== -1) msg.attachedFiles[fileIdx] = finalName;
                            }
                        });
                        saveChatData(chatObj);
                        if (currentChatId === chatId) loadChatIntoView(chatId);
                    } else {
                        renderRightSidebarFiles(chatId);
                    }
                } catch (err) { console.error("Error renaming file:", err); }
            });
        });
    });

    rsViewFiles.querySelectorAll('.delete-file-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            e.currentTarget.closest('.file-dropdown').classList.add('hidden');
            const fileName = e.currentTarget.getAttribute('data-filename');
            openDeleteModal("Delete File", `Are you sure you want to permanently delete "${fileName}"?`, () => {
                try {
                    fs.unlinkSync(path.join(filesFolder, fileName));
                    renderRightSidebarFiles(chatId);
                } catch (err) { console.error("Error deleting file:", err); }
            });
        });
    });
}

// --- Agent Workflows ---
const workflowModal = document.getElementById('workflow-modal');
const workflowStepsContainer = document.getElementById('workflow-steps-container');
let hasUnsavedWorkflowChanges = false;
let editingWorkflowId = null;

function openNewWorkflowModal() {
    editingWorkflowId = null;
    hasUnsavedWorkflowChanges = false;
    
    // Zera os inputs
    const nameInput = document.getElementById('workflow-name');
    if (nameInput) nameInput.value = '';
    
    const entryValue = document.querySelector('#workflow-modal .custom-dropdown-value');
    const entryInput = document.querySelector('#workflow-modal .custom-dropdown-input');
    if (entryValue) entryValue.value = '';
    if (entryInput) entryInput.value = '';

    const workflowStepsContainer = document.getElementById('workflow-steps-container');
    if (workflowStepsContainer) workflowStepsContainer.innerHTML = '';

    if (workflowModal) {
        workflowModal.classList.remove('hidden');
        setTimeout(() => workflowModal.classList.add('opacity-100'), 10);
    }
}

document.getElementById('btn-open-workflow-modal')?.addEventListener('click', openNewWorkflowModal);
document.getElementById('btn-lib-new-workflow')?.addEventListener('click', openNewWorkflowModal);

function initializeCustomDropdown(container) {
    const input = container.querySelector('.custom-dropdown-input');
    const list = container.querySelector('.custom-dropdown-list');
    const hiddenValue = container.querySelector('.custom-dropdown-value');

    function renderOptions(filter = '') {
        list.innerHTML = '';
        const filtered = savedWritingProfiles.filter(p => (p.name || '').toLowerCase().includes(filter.toLowerCase()));

        if (filtered.length === 0) {
            list.innerHTML = `<div class="px-3 py-2 text-sm text-gray-500 italic">No profiles found.</div>`;
            return;
        }

        filtered.forEach(p => {
            const option = document.createElement('div');
            option.className = 'px-3 py-2 text-sm text-gray-300 hover:bg-[#DDBA6E]/20 hover:text-white cursor-pointer transition-colors flex items-center';
            option.innerHTML = `<span class="w-2 h-2 rounded-full mr-2" style="background-color: ${p.color || '#DDBA6E'}"></span> ${p.name}`;

            option.addEventListener('mousedown', (e) => {
                e.preventDefault();
                input.value = p.name;
                hiddenValue.value = p.id;
                list.classList.add('hidden');
                hasUnsavedWorkflowChanges = true;
            });
            list.appendChild(option);
        });
    }

    input.addEventListener('focus', () => { renderOptions(input.value); list.classList.remove('hidden'); });
    input.addEventListener('input', (e) => { renderOptions(e.target.value); list.classList.remove('hidden'); hiddenValue.value = ''; hasUnsavedWorkflowChanges = true; });
    input.addEventListener('blur', () => { list.classList.add('hidden'); });
}

document.getElementById('workflow-form-body')?.addEventListener('input', () => hasUnsavedWorkflowChanges = true);

function attemptToCloseWorkflowModal() {
    if (hasUnsavedWorkflowChanges) {
        openDeleteModal("Unsaved Changes", "You have unsaved steps. Are you sure you want to discard this workflow?", () => closeWorkflowModal(true));
    } else {
        closeWorkflowModal(true);
    }
}

function closeWorkflowModal(force = false) {
    if (!workflowModal) return;
    workflowModal.classList.remove('opacity-100');
    setTimeout(() => {
        workflowModal.classList.add('hidden');
        if (force) {
            hasUnsavedWorkflowChanges = false;
            const nameInput = document.getElementById('workflow-name');
            if (nameInput) nameInput.value = '';
            if (workflowStepsContainer) workflowStepsContainer.innerHTML = '';
        }
    }, 200);
}

document.getElementById('btn-close-workflow-modal')?.addEventListener('click', attemptToCloseWorkflowModal);
document.getElementById('btn-cancel-workflow')?.addEventListener('click', attemptToCloseWorkflowModal);
workflowModal?.addEventListener('click', (e) => { if (e.target === workflowModal) attemptToCloseWorkflowModal(); });

const firstDropdown = document.querySelector('#workflow-modal .custom-dropdown-container');
if (firstDropdown) initializeCustomDropdown(firstDropdown);

window.updateWorkflowStepCounters = function () {
    document.querySelectorAll('#workflow-steps-container .workflow-step').forEach((step, index) => {
        const indicator = step.querySelector('.step-indicator');
        if (indicator) indicator.innerText = `STEP ${index + 2}`;
    });
};

document.getElementById('btn-add-workflow-step')?.addEventListener('click', () => {
    hasUnsavedWorkflowChanges = true;
    const stepContainer = document.createElement('div');
    stepContainer.innerHTML = `
        <div class="workflow-step bg-[#000D11] border border-gray-800 rounded-md p-4 relative mt-4 group transition-all">
            <div class="step-indicator absolute -left-3 top--1 bg-gray-700 text-white text-xs font-bold px-2 py-0.5 rounded shadow">STEP X</div>
            <button class="absolute right-3 top-3 text-gray-500 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity" onclick="this.parentElement.remove(); window.updateWorkflowStepCounters(); hasUnsavedWorkflowChanges = true;">
                <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>
            </button>
            <div class="ml-4 space-y-4">
                <div>
                    <label class="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Process with Profile</label>
                    <div class="relative custom-dropdown-container">
                        <input type="text" placeholder="Type to search profile..." class="custom-dropdown-input w-full bg-[#011419] border border-gray-700 text-white text-sm rounded px-3 py-2 focus:outline-none focus:border-[#DDBA6E] transition-colors" autocomplete="off">
                        <input type="hidden" class="custom-dropdown-value">
                        <div class="custom-dropdown-list hidden absolute z-50 w-full mt-1 bg-[#011419] border border-gray-700 rounded shadow-lg max-h-40 overflow-y-auto custom-scrollbar"></div>
                    </div>
                </div>
                <div>
                    <label class="block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1">Intermediate Prompt</label>
                    <textarea rows="2" placeholder="e.g., Rewrite the previous output focusing on sensory details..." class="w-full bg-[#011419] border border-gray-700 text-white text-sm rounded px-3 py-2 focus:outline-none focus:border-[#DDBA6E] resize-none transition-colors"></textarea>
                </div>
                <div class="flex items-center justify-between bg-[#011419] border border-gray-800 p-3 rounded">
                    <span class="text-sm text-gray-300">Include General Chat Context</span>
                    <label class="relative inline-flex items-center cursor-pointer">
                        <input type="checkbox" class="sr-only peer" checked>
                        <div class="w-9 h-5 bg-gray-600 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-[#DDBA6E]"></div>
                    </label>
                </div>
            </div>
        </div>
    `;

    workflowStepsContainer.appendChild(stepContainer.firstElementChild);
    window.updateWorkflowStepCounters();
    initializeCustomDropdown(workflowStepsContainer.lastElementChild.querySelector('.custom-dropdown-container'));
});

document.getElementById('btn-save-workflow')?.addEventListener('click', () => {
    const nameInput = document.getElementById('workflow-name');
    const entryDropdownValue = document.querySelector('#workflow-modal .custom-dropdown-value');
    const entryDropdownInput = document.querySelector('#workflow-modal .custom-dropdown-input');

    let hasError = false;
    if (!nameInput.value.trim()) {
        nameInput.classList.add('border-red-500', 'animate-pulse');
        setTimeout(() => nameInput.classList.remove('border-red-500', 'animate-pulse'), 2000);
        hasError = true;
    }
    if (!entryDropdownValue.value) {
        entryDropdownInput.classList.add('border-red-500', 'animate-pulse');
        setTimeout(() => entryDropdownInput.classList.remove('border-red-500', 'animate-pulse'), 2000);
        hasError = true;
    }

    const stepsData = [];
    document.querySelectorAll('#workflow-steps-container .workflow-step').forEach(step => {
        const stepDropdownInput = step.querySelector('.custom-dropdown-input');
        const profileId = step.querySelector('.custom-dropdown-value').value;
        const prompt = step.querySelector('textarea').value.trim();
        const includeContext = step.querySelector('input[type="checkbox"]').checked;

        if (!profileId) {
            stepDropdownInput.classList.add('border-red-500', 'animate-pulse');
            setTimeout(() => stepDropdownInput.classList.remove('border-red-500', 'animate-pulse'), 2000);
            hasError = true;
        }
        stepsData.push({ profileId, prompt, includeContext });
    });

    if (hasError) return;

    const workflowObj = {
        id: 'wf_' + Date.now(),
        name: nameInput.value.trim(),
        entryProfileId: entryDropdownValue.value,
        steps: stepsData
    };

    if (editingWorkflowId) {
        workflowObj.id = editingWorkflowId; 
    }

    saveSingleFile(workflowsDir, workflowObj);
    savedWorkflows = loadFilesFromDir(workflowsDir);
    closeWorkflowModal(true);
    renderWorkflowsSidebar();
    renderLibraryWorkflowsList();
});

document.getElementById('search-workflows')?.addEventListener('input', (e) => {
    renderWorkflowsSidebar(e.target.value);
});

function renderWorkflowsSidebar(filter = '') {
    const listContainer = document.getElementById('chat-workflows-list');
    if (!listContainer) return;

    if (savedWorkflows.length === 0) {
        listContainer.innerHTML = `<div class="text-center text-gray-500 text-xs py-4 italic">No workflows created yet.</div>`;
        return;
    }

    const chat = savedChats.find(c => c.id === currentChatId);
    const activeWFs = chat && chat.activeWorkflows ? chat.activeWorkflows : [];
    const filtered = savedWorkflows.filter(wf => (wf.name || '').toLowerCase().includes(filter.toLowerCase()));

    if (filtered.length === 0) {
        listContainer.innerHTML = `<div class="text-center text-gray-500 text-xs py-4 italic">No matches found.</div>`;
        return;
    }

    listContainer.innerHTML = '';
    filtered.forEach(wf => {
        const isActive = activeWFs.includes(wf.id);
        const item = document.createElement('div');
        item.className = 'flex items-center justify-between p-2 hover:bg-[#011419] rounded transition-colors group cursor-pointer border border-transparent hover:border-gray-800';
        item.innerHTML = `
            <div class="flex items-center space-x-2 overflow-hidden">
                ${isActive ? `<span class="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_5px_#22c55e]"></span>` : `<svg class="w-4 h-4 text-[#DDBA6E] shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 10V3L4 14h7v7l9-11h-7z"></path></svg>`}
                <span class="text-sm ${isActive ? 'text-white' : 'text-gray-300'} truncate">${wf.name}</span>
            </div>
            <button class="text-xs font-semibold ${isActive ? 'text-red-400 hover:text-red-300 opacity-100' : 'text-gray-500 hover:text-[#DDBA6E] opacity-0 group-hover:opacity-100'} transition-opacity btn-toggle-wf">
                ${isActive ? 'DEACTIVATE' : 'ACTIVATE'}
            </button>
        `;

        item.querySelector('.btn-toggle-wf').addEventListener('click', (e) => {
            e.stopPropagation();
            if (!currentChatId) {
                const btn = e.currentTarget;
                btn.innerText = 'OPEN A CHAT!';
                btn.classList.add('text-red-500');
                setTimeout(() => renderWorkflowsSidebar(filter), 1500);
                return;
            }

            const targetChat = savedChats.find(c => c.id === currentChatId);
            if (!targetChat.activeWorkflows) targetChat.activeWorkflows = [];
            if (isActive) {
                targetChat.activeWorkflows = targetChat.activeWorkflows.filter(id => id !== wf.id);
            } else {
                targetChat.activeWorkflows.push(wf.id);
            }

            saveChatData(targetChat);
            renderWorkflowsSidebar(document.getElementById('search-workflows')?.value || '');
        });

        listContainer.appendChild(item);
    });
}

function renderLibraryWorkflowsList() {
    const listContainer = document.getElementById('library-workflows-list');
    if (!listContainer) return;

    listContainer.innerHTML = '';

    if (savedWorkflows.length === 0) {
        listContainer.innerHTML = `<div class="col-span-3 text-center text-gray-500 text-sm py-10 italic">No workflows created yet.</div>`;
        return;
    }

    savedWorkflows.forEach((wf, index) => {
        const stepCount = wf.steps ? wf.steps.length : 0;
        const card = document.createElement('div');
        card.className = "bg-[#111f2e] border border-gray-800/80 rounded-xl p-5 hover:border-gray-600 transition-all group flex flex-col relative overflow-hidden shadow-lg";
        card.innerHTML = `
            <div class="absolute top-0 left-0 right-0 h-1.5 bg-[#DDBA6E]"></div>
            <div class="flex justify-between items-start mb-2 mt-1">
                <h3 class="text-white font-bold text-lg truncate pr-2">${wf.name}</h3>
                <div class="flex space-x-1 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button class="text-gray-400 hover:text-white p-1.5 bg-[#0a141d] rounded-md transition-colors edit-wf-btn" data-index="${index}" title="Edit Workflow">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    <button class="text-gray-500 hover:text-red-500 p-1.5 bg-[#0a141d] rounded-md transition-colors delete-wf-btn" data-index="${index}" title="Delete Workflow">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </div>
            </div>
            <p class="text-sm text-gray-400 mt-2"><span class="text-white font-bold">${stepCount + 1}</span> Sequential Logic Steps</p>
        `;

        card.querySelector('.delete-wf-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            openDeleteModal("Delete Workflow", `Are you sure you want to delete "${wf.name}"?`, () => {
                savedWorkflows.splice(index, 1);
                deleteSingleFile(workflowsDir, wf.id);
                renderLibraryWorkflowsList();
                renderWorkflowsSidebar();
            });
        });

        card.querySelector('.edit-wf-btn').addEventListener('click', (e) => {
            e.stopPropagation();
            editingWorkflowId = wf.id;

            document.getElementById('workflow-name').value = wf.name;
            const entryValue = document.querySelector('#workflow-modal .custom-dropdown-value');
            const entryInput = document.querySelector('#workflow-modal .custom-dropdown-input');
            const entryProfile = savedWritingProfiles.find(p => p.id === wf.entryProfileId);

            entryValue.value = wf.entryProfileId;
            entryInput.value = entryProfile ? entryProfile.name : '';

            const workflowStepsContainer = document.getElementById('workflow-steps-container');
            workflowStepsContainer.innerHTML = '';

            if (wf.steps) {
                wf.steps.forEach(step => {
                    document.getElementById('btn-add-workflow-step').click();
                    const lastStep = workflowStepsContainer.lastElementChild;

                    const stepValue = lastStep.querySelector('.custom-dropdown-value');
                    const stepInput = lastStep.querySelector('.custom-dropdown-input');
                    const stepProfile = savedWritingProfiles.find(p => p.id === step.profileId);

                    stepValue.value = step.profileId;
                    stepInput.value = stepProfile ? stepProfile.name : '';

                    lastStep.querySelector('textarea').value = step.prompt;
                    lastStep.querySelector('input[type="checkbox"]').checked = step.includeContext;
                });
            }

            if (workflowModal) {
                workflowModal.classList.remove('hidden');
                setTimeout(() => workflowModal.classList.add('opacity-100'), 10);
            }
        });

        listContainer.appendChild(card);
    });
}

document.addEventListener('change', (e) => {
    if(e.target.id === 'wp-manual-mode-toggle') {
        const basicBox = document.getElementById('wp-basic-params');
        const manualBox = document.getElementById('wp-manual-params');
        if(e.target.checked) {
            if (basicBox) basicBox.classList.add('hidden');
            if (manualBox) manualBox.classList.remove('hidden');
        } else {
            if (manualBox) manualBox.classList.add('hidden');
            if (basicBox) basicBox.classList.remove('hidden');
        }
    }

    if(e.target.id === 'wp-agentic-toggle') {
        const agenticContainer = document.getElementById('wp-agentic-prompt-container');
        if(e.target.checked) {
            if (agenticContainer) agenticContainer.classList.remove('hidden');
        } else {
            if (agenticContainer) agenticContainer.classList.add('hidden');
        }
    }
});

const cDropzone = document.getElementById('c-modal-dropzone');
const cFileInput = document.getElementById('c-modal-file-input');

if (cDropzone && cFileInput) {
    cDropzone.addEventListener('click', () => cFileInput.click());
    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(name => {
        cDropzone.addEventListener(name, (e) => { e.preventDefault(); e.stopPropagation(); }, false);
    });
    ['dragenter', 'dragover'].forEach(name => {
        cDropzone.addEventListener(name, () => cDropzone.classList.add('border-[var(--app-accent)]', 'bg-white/5'), false);
    });
    ['dragleave', 'drop'].forEach(name => {
        cDropzone.addEventListener(name, () => cDropzone.classList.remove('border-[var(--app-accent)]', 'bg-white/5'), false);
    });
    cDropzone.addEventListener('drop', (e) => handleChatModalFiles(e.dataTransfer.files), false);
    cFileInput.addEventListener('change', (e) => handleChatModalFiles(e.target.files));
}

function handleChatModalFiles(files) {
    if (!files || files.length === 0) return;
    Array.from(files).forEach(file => {
        if (currentChatKnowledgeFiles.length >= 10) return;
        const isDuplicate = currentChatKnowledgeFiles.some(f => f.name === file.name && f.size === file.size);
        if (!isDuplicate) {
            currentChatKnowledgeFiles.push({ name: file.name, path: file.path || '', size: file.size, fileObj: file });
        }
    });
    renderChatModalKnowledgeFiles();
    if (cFileInput) cFileInput.value = '';
}

function borderReset(id) {
    document.getElementById(id)?.classList.remove('border-red-500');
}

function renderChatModalKnowledgeFiles() {
    const list = document.getElementById('c-modal-file-list');
    if (!list) return;
    list.innerHTML = '';
    currentChatKnowledgeFiles.forEach((file, index) => {
        const badge = document.createElement('div');
        badge.className = 'flex items-center space-x-2 bg-[#011419] border border-gray-700 rounded-md px-2 py-1.5 group';
        badge.innerHTML = `
            <svg class="w-3.5 h-3.5 text-gray-400 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"></path></svg>
            <span class="text-xs text-gray-300 truncate max-w-[140px]">${file.name}</span>
            <button type="button" class="text-gray-500 hover:text-[#ff5f56] transition-colors shrink-0 ml-1 cursor-pointer" onclick="removeChatModalKnowledgeFile(${index})">
                <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M6 18L18 6M6 6l12 12"></path></svg>
            </button>
        `;
        list.appendChild(badge);
    });
}

window.removeChatModalKnowledgeFile = function (index) {
    currentChatKnowledgeFiles.splice(index, 1);
    renderChatModalKnowledgeFiles();
};

document.getElementById('btn-save-chat-modal')?.addEventListener('click', async () => {
    const name = document.getElementById('c-modal-name').value.trim();
    const desc = document.getElementById('c-modal-desc').value.trim();
    
    if (!name) {
        document.getElementById('c-modal-name').classList.add('border-red-500');
        document.getElementById('c-modal-name').addEventListener('input', () => borderReset('c-modal-name'), { once: true });
        return;
    }

    const btnSave = document.getElementById('btn-save-chat-modal');
    const originalText = btnSave.innerHTML;
    btnSave.disabled = true;

    const chatId = Date.now().toString();
    const chatDir = path.join(chatsDir, chatId);
    if (!fs.existsSync(chatDir)) fs.mkdirSync(chatDir, { recursive: true });

    let appearanceObj = { bgImage: "", opacity: 75, userOpacity: 100, aiOpacity: 0 };

    if (selectedChatBgFile) {
        const ext = selectedChatBgFile.name.includes('.') ? selectedChatBgFile.name.substring(selectedChatBgFile.name.lastIndexOf('.')) : '';
        const destBgName = `bg_image_${Date.now()}${ext}`;
        const destBgPath = path.join(chatDir, destBgName);
        
        if (selectedChatBgFile.path) {
            fs.copyFileSync(selectedChatBgFile.path, destBgPath);
        } else {
            const arrayBuffer = await selectedChatBgFile.arrayBuffer();
            fs.writeFileSync(destBgPath, Buffer.from(arrayBuffer));
        }
        appearanceObj.bgImage = destBgName;
    }

    const activeProfiles = [...pendingChatModalProfiles];
    const activeWorkflows = [...pendingChatModalWorkflows];

    const kbDir = path.join(chatDir, 'KnowledgeBase');
    if (!fs.existsSync(kbDir)) fs.mkdirSync(kbDir, { recursive: true });

    const filesDir = path.join(chatDir, 'Files');
    if (!fs.existsSync(filesDir)) fs.mkdirSync(filesDir, { recursive: true });

    let savedKbFiles = [];
    let allChatVectors = [];

    for (let i = 0; i < currentChatKnowledgeFiles.length; i++) {
        const f = currentChatKnowledgeFiles[i];
        
        const destPath = path.join(kbDir, f.name);
        const filesDestPath = path.join(filesDir, f.name);

        if (f.path && f.path !== '') {
            fs.copyFileSync(f.path, destPath);
            fs.copyFileSync(f.path, filesDestPath);
        } else {
            const arrayBuffer = await f.fileObj.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);
            fs.writeFileSync(destPath, buffer);
            fs.writeFileSync(filesDestPath, buffer);
        }

        savedKbFiles.push({ name: f.name, internalPath: destPath, size: f.size });

        try {
            btnSave.innerHTML = `<span class="text-xs">Reading ${f.name}...</span>`;
            const fullText = await extractTextFromFile(destPath);
            if (fullText && fullText.trim().length > 0) {
                const chunks = chunkText(fullText);
                const fileVectors = await vectorizeChunks(chunks, f.name, (curr, tot) => {
                    btnSave.innerHTML = `<span class="text-[10px]">Vectorizing ${i+1}/${currentChatKnowledgeFiles.length}: ${curr}/${tot}</span>`;
                });
                allChatVectors = allChatVectors.concat(fileVectors);
            }
        } catch (err) {
            console.error(err);
        }
    }

    if (allChatVectors.length > 0) {
        fs.writeFileSync(path.join(kbDir, 'vector_db.json'), JSON.stringify(allChatVectors, null, 2));
    }

    const newChat = {
        id: chatId,
        title: name,
        description: desc,
        updatedAt: Date.now(),
        isPinned: false,
        maxContext: 128000,
        archiveThreshold: 60000,
        summarizedIndex: 0,
        activeProfiles: activeProfiles,
        activeWorkflows: activeWorkflows,
        appearance: appearanceObj,
        knowledgeFiles: savedKbFiles,
        messages: []
    };

    savedChats.push(newChat);
    saveChatData(newChat);

    btnSave.innerHTML = originalText;
    btnSave.disabled = false;

    closeChatModal();
    renderDashboardChatsGrid();
    loadChatIntoView(chatId);
});

// ==========================================
// --- KNOWLEDGE BASE MANAGER ENGINE ---
// ==========================================

let currentKbProfileId = null;
let loadedKbData = [];
let currentKbmFilter = 'all';

function openKbManagerModal(profileId) {
    currentKbProfileId = profileId;
    const profile = savedWritingProfiles.find(p => p.id === profileId);
    if (!profile) return;

    document.getElementById('kbm-profile-name').textContent = profile.name;
    document.querySelector('.kbm-filter-btn[data-filter="all"]')?.click();
    loadKbDataFromDisk();

    const modal = document.getElementById('kb-manager-modal');
    if (modal) {
        modal.classList.remove('hidden');
        setTimeout(() => modal.classList.remove('opacity-0'), 10);
    }
}

function closeKbManagerModal() {
    const modal = document.getElementById('kb-manager-modal');
    if (modal) {
        modal.classList.add('opacity-0');
        setTimeout(() => {
            modal.classList.add('hidden');
            currentKbProfileId = null;
            loadedKbData = [];
            document.getElementById('kbm-chunks-list').innerHTML = '';
        }, 200);
    }
}

document.getElementById('btn-close-kb-manager')?.addEventListener('click', closeKbManagerModal);

function loadKbDataFromDisk() {
    loadedKbData = [];
    const kbDir = path.join(profilesDir, currentKbProfileId, 'KnowledgeBase');
    const dbPath = path.join(kbDir, 'vector_db.json');
    const fullContextPath = path.join(kbDir, 'full_context.json');

    if (fs.existsSync(dbPath)) {
        try {
            const vectors = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
            vectors.forEach((v, idx) => {
                let blockType = 'rag';
                if (v.id && String(v.id).startsWith('manual_')) {
                    blockType = 'manual';
                } else if (v.source === 'Custom Memory') {
                    blockType = 'manual';
                }

                // --- CORREÇÃO DO MULTIPLICADOR ---
                // Se o texto vier do Vector DB com o injetor do RAG Engine, nós limpamos para a interface!
                let cleanText = v.text || '';
                if (cleanText.startsWith('Document:') && cleanText.includes('\nContent: ')) {
                    cleanText = cleanText.substring(cleanText.indexOf('\nContent: ') + 10);
                }

                loadedKbData.push({
                    id: v.id || `vec_${idx}`,
                    type: blockType,
                    source: v.source,
                    text: cleanText, // Agora usamos o texto purificado para leitura e edição
                    rawItem: v 
                });
            });
        } catch(e) { console.error("Error reading vector_db:", e); }
    }

    if (fs.existsSync(fullContextPath)) {
        try {
            const constants = JSON.parse(fs.readFileSync(fullContextPath, 'utf8'));
            constants.forEach((c, idx) => {
                loadedKbData.push({
                    id: `const_${idx}`,
                    type: 'constant',
                    source: c.name,
                    text: c.content, 
                    rawItem: c
                });
            });
        } catch(e) { console.error("Error reading full_context:", e); }
    }

    renderKbChunksList(document.getElementById('kbm-search-chunks')?.value || '');
}

function saveKbDataToDisk() {
    if (!currentKbProfileId) return;
    const kbDir = path.join(profilesDir, currentKbProfileId, 'KnowledgeBase');
    if (!fs.existsSync(kbDir)) fs.mkdirSync(kbDir, { recursive: true });

    const vectorDbPath = path.join(kbDir, 'vector_db.json');
    const fullContextPath = path.join(kbDir, 'full_context.json');

    const vectorData = loadedKbData.filter(item => item.type === 'rag' || item.type === 'manual').map(item => item.rawItem);
    const constantData = loadedKbData.filter(item => item.type === 'constant').map(item => item.rawItem);

    try {
        if (vectorData.length > 0) fs.writeFileSync(vectorDbPath, JSON.stringify(vectorData, null, 2));
        else if (fs.existsSync(vectorDbPath)) fs.unlinkSync(vectorDbPath);

        if (constantData.length > 0) fs.writeFileSync(fullContextPath, JSON.stringify(constantData, null, 2));
        else if (fs.existsSync(fullContextPath)) fs.unlinkSync(fullContextPath);
    } catch (err) {
        console.error("Error saving KB data:", err);
    }
}

// --- FILTERS & RENDERING ---
document.querySelectorAll('.kbm-filter-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
        document.querySelectorAll('.kbm-filter-btn').forEach(b => {
            b.classList.remove('text-white', 'bg-[#1a2d32]', 'border', 'border-[#3b82f6]/30', 'font-medium');
            b.classList.add('text-gray-400');
        });
        e.currentTarget.classList.remove('text-gray-400');
        e.currentTarget.classList.add('text-white', 'bg-[#1a2d32]', 'border', 'border-[#3b82f6]/30', 'font-medium');
        
        currentKbmFilter = e.currentTarget.getAttribute('data-filter');
        renderKbChunksList(document.getElementById('kbm-search-chunks')?.value || '');
    });
});

function renderKbChunksList(filterQuery = '') {
    const listContainer = document.getElementById('kbm-chunks-list');
    const totalDisplay = document.getElementById('kbm-total-blocks');
    if (!listContainer) return;

    listContainer.innerHTML = '';
    
    let filteredData = loadedKbData.filter(item => 
        item.text.toLowerCase().includes(filterQuery.toLowerCase()) || 
        item.source.toLowerCase().includes(filterQuery.toLowerCase())
    );

    if (currentKbmFilter !== 'all') {
        filteredData = filteredData.filter(item => item.type === currentKbmFilter);
    }

    if (totalDisplay) totalDisplay.textContent = filteredData.length;

    if (filteredData.length === 0) {
        listContainer.innerHTML = `<div class="col-span-full flex flex-col items-center justify-center text-gray-500 py-10 opacity-70"><svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="mb-3"><rect x="3" y="3" width="18" height="18" rx="2" ry="2"></rect><line x1="9" y1="3" x2="9" y2="21"></line></svg><p class="text-xs font-medium">No knowledge blocks found.</p></div>`;
        return;
    }

    filteredData.forEach((item) => {
        let badgeColor = '';
        let badgeText = '';

        if (item.type === 'constant') { badgeColor = 'bg-[#DDBA6E]/20 text-[#DDBA6E] border-[#DDBA6E]/30'; badgeText = 'CONSTANT'; }
        else if (item.type === 'manual') { badgeColor = 'bg-purple-500/20 text-purple-400 border-purple-500/30'; badgeText = 'CUSTOM'; }
        else { badgeColor = 'bg-[#3b82f6]/20 text-[#3b82f6] border-[#3b82f6]/30'; badgeText = 'SEARCHABLE'; }

        const previewText = item.text.length > 150 ? item.text.substring(0, 150) + '...' : item.text;

        const card = document.createElement('div');
        card.className = "bg-[#0a161d] border border-gray-800/80 rounded-lg p-4 flex flex-col hover:border-gray-600 transition-colors group";
        card.innerHTML = `
            <div class="flex justify-between items-start mb-2">
                <div class="flex items-center space-x-2 overflow-hidden pr-2">
                    <span class="text-[9px] font-bold px-1.5 py-0.5 rounded border ${badgeColor} uppercase tracking-wider shrink-0">${badgeText}</span>
                    <span class="text-xs text-gray-400 truncate" title="${escapeHTML(item.source)}">${escapeHTML(item.source)}</span>
                </div>
                <div class="flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button class="p-1 text-gray-500 hover:text-white transition-colors edit-chunk-btn" data-id="${item.id}" title="Edit Block">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                    </button>
                    <button class="p-1 text-gray-500 hover:text-red-500 transition-colors delete-chunk-btn" data-id="${item.id}" title="Delete Block">
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                    </button>
                </div>
            </div>
            <p class="text-xs text-gray-300 leading-relaxed font-mono mt-2 flex-1 whitespace-pre-wrap break-words">${escapeHTML(previewText)}</p>
        `;

        listContainer.appendChild(card);
    });
}

document.getElementById('kbm-search-chunks')?.addEventListener('input', (e) => {
    renderKbChunksList(e.target.value);
});

// --- ADD CONSTANT FILE LOGIC ---
const kbmAddConstantInput = document.getElementById('kbm-add-constant-input');
document.getElementById('btn-kbm-add-constant')?.addEventListener('click', () => kbmAddConstantInput?.click());

kbmAddConstantInput?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const exists = loadedKbData.some(i => i.source === file.name && i.type === 'constant');
    if (exists) {
        alert("A constant file with this name already exists in this profile.");
        kbmAddConstantInput.value = '';
        return;
    }
    
    const btn = document.getElementById('btn-kbm-add-constant');
    const originalHtml = btn.innerHTML;
    btn.innerHTML = `<span class="animate-pulse">Reading...</span>`;
    btn.disabled = true;

    try {
        const text = await extractTextFromFile(file.path);
        
        if (text && text.trim().length > 0) {
            const kbDir = path.join(profilesDir, currentKbProfileId, 'KnowledgeBase');
            const destPath = path.join(kbDir, file.name);
            
            try { fs.copyFileSync(file.path, destPath); } 
            catch(err) { console.error("Could not copy original file, JSON will still work.", err); }

            const profile = savedWritingProfiles.find(p => p.id === currentKbProfileId);
            if (profile) {
                if (!profile.knowledgeFiles) profile.knowledgeFiles = [];
                profile.knowledgeFiles.push({
                    name: file.name,
                    internalPath: destPath,
                    size: file.size,
                    strategy: 'full_context'
                });
                saveProfileData(profile);
            }

            const newId = `const_${Date.now()}`;
            const newRawItem = { name: file.name, content: text.trim() };
            
            loadedKbData.unshift({
                id: newId,
                type: 'constant',
                source: file.name,
                text: text.trim(),
                rawItem: newRawItem
            });
            
            saveKbDataToDisk();
            document.querySelector('.kbm-filter-btn[data-filter="constant"]')?.click();
        }
    } catch (err) {
        console.error("Failed to add constant file:", err);
    } finally {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
        kbmAddConstantInput.value = '';
    }
});

// --- ADD SEARCHABLE FILE LOGIC ---
const kbmAddSearchableInput = document.getElementById('kbm-add-searchable-input');
document.getElementById('btn-kbm-add-searchable')?.addEventListener('click', () => kbmAddSearchableInput?.click());

kbmAddSearchableInput?.addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const exists = loadedKbData.some(i => i.source === file.name && i.type === 'rag');
    if (exists) {
        alert("A searchable file with this name already exists in this profile.");
        kbmAddSearchableInput.value = '';
        return;
    }

    const btn = document.getElementById('btn-kbm-add-searchable');
    const originalHtml = btn.innerHTML;
    btn.innerHTML = `<span class="animate-pulse">Reading...</span>`;
    btn.disabled = true;

    try {
        const kbDir = path.join(profilesDir, currentKbProfileId, 'KnowledgeBase');
        const destPath = path.join(kbDir, file.name);
        
        try { fs.copyFileSync(file.path, destPath); } 
        catch(err) { console.error("Could not copy original file", err); }

        const profile = savedWritingProfiles.find(p => p.id === currentKbProfileId);
        if (profile) {
            if (!profile.knowledgeFiles) profile.knowledgeFiles = [];
            profile.knowledgeFiles.push({
                name: file.name,
                internalPath: destPath,
                size: file.size,
                strategy: 'rag_search'
            });
            saveProfileData(profile);
        }

        const fullText = await extractTextFromFile(destPath);
        if (fullText && fullText.trim().length > 0) {
            const chunks = chunkText(fullText);
            const fileVectors = await vectorizeChunks(chunks, file.name, (curr, tot) => {
                btn.innerHTML = `<span class="text-[10px]">Chunking: ${curr}/${tot}</span>`;
            });
            
            fileVectors.forEach((v, idx) => {
                loadedKbData.push({
                    id: v.id || `vec_new_${Date.now()}_${idx}`,
                    type: 'rag',
                    source: v.source,
                    text: v.text,
                    rawItem: v
                });
            });

            saveKbDataToDisk();
            document.querySelector('.kbm-filter-btn[data-filter="rag"]')?.click();
        }
    } catch (err) {
        console.error("Failed to add searchable file:", err);
    } finally {
        btn.innerHTML = originalHtml;
        btn.disabled = false;
        kbmAddSearchableInput.value = '';
    }
});


// --- EDIT & DELETE DELEGATION ---
document.getElementById('kbm-chunks-list')?.addEventListener('click', (e) => {
    const editBtn = e.target.closest('.edit-chunk-btn');
    const delBtn = e.target.closest('.delete-chunk-btn');

    if (delBtn) {
        const id = delBtn.getAttribute('data-id');
        openDeleteModal("Delete Block", "Are you sure you want to permanently delete this memory block?", () => {
            const itemToDelete = loadedKbData.find(item => item.id === id);
            
            loadedKbData = loadedKbData.filter(item => item.id !== id);
            saveKbDataToDisk();
            
            if (itemToDelete && (itemToDelete.type === 'constant' || itemToDelete.type === 'rag')) {
                const isStillUsed = loadedKbData.some(i => i.source === itemToDelete.source && i.type === itemToDelete.type);
                if (!isStillUsed) {
                    const profile = savedWritingProfiles.find(p => p.id === currentKbProfileId);
                    if (profile && profile.knowledgeFiles) {
                        const fileRef = profile.knowledgeFiles.find(f => f.name === itemToDelete.source);
                        if (fileRef && fs.existsSync(fileRef.internalPath)) {
                            try { fs.unlinkSync(fileRef.internalPath); } catch(err) {}
                        }
                        profile.knowledgeFiles = profile.knowledgeFiles.filter(f => f.name !== itemToDelete.source);
                        saveProfileData(profile);
                    }
                }
            }
            
            renderKbChunksList(document.getElementById('kbm-search-chunks')?.value || '');
        });
    }

    if (editBtn) {
        const id = editBtn.getAttribute('data-id');
        openKbEditor(id);
    }
});

// --- EDITOR PANEL LOGIC ---
const kbmEditorPanel = document.getElementById('kbm-editor-panel');
const kbmEditorHeading = document.getElementById('kbm-editor-heading');
const kbmEditIdInput = document.getElementById('kbm-edit-chunk-id');
const kbmEditTitleInput = document.getElementById('kbm-edit-title');
const kbmEditTextarea = document.getElementById('kbm-edit-textarea');

function openKbEditor(id = null) {
    if (id) {
        const item = loadedKbData.find(i => i.id === id);
        if (!item) return;
        kbmEditorHeading.textContent = "Edit Memory Block";
        kbmEditIdInput.value = id;
        kbmEditTitleInput.value = item.source;
        kbmEditTextarea.value = item.text;

        if (item.type === 'manual') kbmEditTitleInput.readOnly = false;
        else kbmEditTitleInput.readOnly = true;

    } else {
        kbmEditorHeading.textContent = "Add Custom Memory";
        kbmEditIdInput.value = "";
        kbmEditTitleInput.value = "";
        kbmEditTitleInput.readOnly = false;
        kbmEditTextarea.value = "";
    }
    
    if (kbmEditorPanel) {
        kbmEditorPanel.classList.remove('hidden');
        kbmEditorPanel.classList.add('flex');
        setTimeout(() => kbmEditTextarea.focus(), 100);
    }
}

document.getElementById('btn-kbm-add-manual')?.addEventListener('click', () => openKbEditor(null));

document.getElementById('btn-kbm-cancel-edit')?.addEventListener('click', () => {
    if (kbmEditorPanel) {
        kbmEditorPanel.classList.add('hidden');
        kbmEditorPanel.classList.remove('flex');
    }
});

document.getElementById('btn-kbm-save-edit')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget;
    const originalText = btn.innerHTML;
    
    const newTitle = kbmEditTitleInput.value.trim() || 'Custom Memory';
    const newText = kbmEditTextarea.value.trim();
    const id = kbmEditIdInput.value;

    if (!newText) {
        kbmEditTextarea.classList.add('border-red-500', 'animate-pulse');
        setTimeout(() => kbmEditTextarea.classList.remove('border-red-500', 'animate-pulse'), 2000);
        return;
    }

    btn.disabled = true;
    btn.innerHTML = `<span class="animate-pulse">Processing...</span>`;

    try {
        if (id) {
            const item = loadedKbData.find(i => i.id === id);
            if (item) {
                if (item.type === 'manual') {
                    item.source = newTitle;
                    item.rawItem.source = newTitle;
                }
                item.text = newText;
                
                if (item.type === 'constant') {
                    item.rawItem.content = newText;
                } else {
                    btn.innerHTML = `<span class="animate-pulse">Re-vectorizing...</span>`;
                    const vectors = await vectorizeChunks([newText], item.source);
                    if (vectors && vectors.length > 0) {
                        item.rawItem = vectors[0];
                        item.rawItem.id = item.id; 
                    }
                }
            }
        } else {
            btn.innerHTML = `<span class="animate-pulse">Vectorizing snippet...</span>`;
            const newId = `manual_${Date.now()}`;
            const vectors = await vectorizeChunks([newText], newTitle);
            
            if (vectors && vectors.length > 0) {
                const newRawItem = vectors[0];
                newRawItem.id = newId;
                loadedKbData.unshift({ 
                    id: newId,
                    type: 'manual',
                    source: newTitle,
                    text: newText,
                    rawItem: newRawItem
                });
            }
        }

        saveKbDataToDisk();
        renderKbChunksList(document.getElementById('kbm-search-chunks')?.value || '');
        
        if (kbmEditorPanel) {
            kbmEditorPanel.classList.add('hidden');
            kbmEditorPanel.classList.remove('flex');
        }
    } catch (err) {
        console.error("Error saving KB edit:", err);
    } finally {
        btn.disabled = false;
        btn.innerHTML = originalText;
    }
});

// --- Global Tooltip Engine ---
const globalTooltip = document.createElement('div');
globalTooltip.className = 'fixed hidden bg-[#051116] border border-gray-800 text-gray-300 text-[10px] leading-relaxed rounded-md p-2.5 shadow-xl z-[9999] max-w-[220px] pointer-events-none transition-opacity duration-200 opacity-0';
document.body.appendChild(globalTooltip);

document.addEventListener('mouseover', (e) => {
    const target = e.target.closest('[data-tooltip]');
    if (!target) return;
    
    globalTooltip.textContent = target.getAttribute('data-tooltip');
    globalTooltip.classList.remove('hidden');
    
    const rect = target.getBoundingClientRect();
    const tooltipRect = globalTooltip.getBoundingClientRect();
    
    let top = rect.top - tooltipRect.height - 8;
    let left = rect.left + (rect.width / 2) - (tooltipRect.width / 2);
    
    if (top < 10) top = rect.bottom + 8;
    if (left < 10) left = 10;
    if (left + tooltipRect.width > window.innerWidth - 10) left = window.innerWidth - tooltipRect.width - 10;
    
    globalTooltip.style.top = `${top}px`;
    globalTooltip.style.left = `${left}px`;
    
    requestAnimationFrame(() => globalTooltip.classList.remove('opacity-0'));
});

document.addEventListener('mouseout', (e) => {
    const target = e.target.closest('[data-tooltip]');
    if (!target) return;
    
    globalTooltip.classList.add('opacity-0');
    setTimeout(() => {
        if (globalTooltip.classList.contains('opacity-0')) {
            globalTooltip.classList.add('hidden');
        }
    }, 200);
});

// --- Final Start Up ---
renderApiProfilesList();
renderWritingProfilesList();
renderDashboardChatsGrid();
renderWorkflowsSidebar();
renderLibraryWorkflowsList()
updateChatProfileSelector();
renderRightSidebarProfiles();
