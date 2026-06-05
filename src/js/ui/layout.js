const { ipcRenderer } = require('electron');

let currentDeleteCallback = null;
let currentRenameCallback = null;

function openDeleteModal(title, desc, callback) {
    const modal = document.getElementById('delete-confirm-modal');
    if (!modal) return;
    document.getElementById('delete-modal-title').textContent = title;
    document.getElementById('delete-modal-desc').textContent = desc;
    currentDeleteCallback = callback;
    modal.classList.remove('hidden');
}

function closeDeleteModal() {
    const modal = document.getElementById('delete-confirm-modal');
    if (modal) modal.classList.add('hidden');
    currentDeleteCallback = null;
}

function openRenameModal(currentName, callback) {
    const modal = document.getElementById('rename-modal');
    const input = document.getElementById('rename-input');
    if (!modal || !input) return;
    input.value = currentName;
    currentRenameCallback = callback;
    modal.classList.remove('hidden');
    input.focus();
}

function closeRenameModal() {
    const modal = document.getElementById('rename-modal');
    if (modal) modal.classList.add('hidden');
    currentRenameCallback = null;
}

function switchRightSidebarTab(activeTabId, activeViewId, inactiveTabId, inactiveViewId) {
    const activeTab = document.getElementById(activeTabId);
    const activeView = document.getElementById(activeViewId);
    const inactiveTab = document.getElementById(inactiveTabId);
    const inactiveView = document.getElementById(inactiveViewId);

    if (!activeTab || !activeView || !inactiveTab || !inactiveView) return;
    
    activeTab.classList.remove('border-transparent', 'text-gray-400', 'text-gray-500', 'text-gray-600');
    activeTab.classList.add('border-[#DDBA6E]', 'text-white');
    
    inactiveTab.classList.remove('border-[#DDBA6E]', 'text-white');
    inactiveTab.classList.add('border-transparent', 'text-gray-500');

    activeView.classList.remove('hidden');
    activeView.classList.add('flex');
    
    inactiveView.classList.remove('flex');
    inactiveView.classList.add('hidden');
}

function initLayout() {
    document.getElementById('rename-input')?.addEventListener('keypress', (e) => { 
        if (e.key === 'Enter') document.getElementById('btn-confirm-rename')?.click(); 
    });

    // --- Global Event Delegation Engine ---
    document.addEventListener('click', (e) => {
        // Window Controls
        if (e.target.closest('#btn-minimize')) ipcRenderer.send('window-minimize');
        if (e.target.closest('#btn-maximize')) ipcRenderer.send('window-maximize');
        if (e.target.closest('#btn-close')) ipcRenderer.send('window-close');

        // Modals (Delete & Rename)
        if (e.target.closest('#btn-cancel-delete')) closeDeleteModal();
        if (e.target.closest('#btn-confirm-delete')) {
            if (currentDeleteCallback) currentDeleteCallback();
            closeDeleteModal();
        }
        if (e.target.closest('#btn-cancel-rename')) closeRenameModal();
        if (e.target.closest('#btn-confirm-rename')) {
            const input = document.getElementById('rename-input');
            if (input && input.value.trim() && currentRenameCallback) {
                currentRenameCallback(input.value.trim());
            }
            closeRenameModal();
        }

        // Settings Modal
        if (e.target.closest('#btn-open-settings')) document.getElementById('settings-modal')?.classList.remove('hidden');
        if (e.target.closest('#btn-close-settings')) document.getElementById('settings-modal')?.classList.add('hidden');
        
        const settingsTab = e.target.closest('.settings-tab');
        if (settingsTab) {
            document.querySelectorAll('.settings-tab').forEach(t => { t.classList.remove('bg-[#1a2d32]', 'text-white'); t.classList.add('text-gray-400'); });
            document.querySelectorAll('.tab-content').forEach(c => { c.classList.add('hidden'); c.classList.remove('block'); });
            settingsTab.classList.add('bg-[#1a2d32]', 'text-white');
            settingsTab.classList.remove('text-gray-400');
            const targetId = settingsTab.getAttribute('data-target');
            document.getElementById(targetId)?.classList.remove('hidden', 'block');
            document.getElementById(targetId)?.classList.add('block');
        }

        // Right Sidebar Toggle
        if (e.target.closest('#btn-toggle-right-sidebar')) {
            const chatRightSidebar = document.getElementById('chat-right-sidebar');
            chatRightSidebar?.classList.toggle('hidden');
            chatRightSidebar?.classList.toggle('flex');
        }

        // Right Sidebar Tabs
        if (e.target.closest('#rs-tab-config')) {
            switchRightSidebarTab('rs-tab-config', 'rs-view-config', 'rs-tab-files', 'rs-view-files');
        }
        if (e.target.closest('#rs-tab-files')) {
            switchRightSidebarTab('rs-tab-files', 'rs-view-files', 'rs-tab-config', 'rs-view-config');
        }

        // Accordions (Config Sections)
        const accordionToggle = e.target.closest('.rs-accordion-toggle');
        if (accordionToggle) {
            const content = accordionToggle.nextElementSibling;
            const icon = accordionToggle.querySelector('svg');
            content?.classList.toggle('hidden');
            icon?.classList.toggle('-rotate-90');
        }

        // Accordions (Left Sidebar)
        if (e.target.closest('#sidebar-ai-profiles-header')) {
            document.getElementById('sidebar-ai-profiles-content')?.classList.toggle('hidden');
            document.getElementById('sidebar-ai-profiles-chevron')?.classList.toggle('-rotate-90');
        }
        if (e.target.closest('#sidebar-chats-header')) {
            document.getElementById('sidebar-chats-content')?.classList.toggle('hidden');
            document.getElementById('sidebar-chats-chevron')?.classList.toggle('-rotate-90');
        }

        // Accordions (Files Tab - Dynamic)
        if (e.target.closest('#toggle-user-files-dynamic')) {
            document.getElementById('user-files-list-dynamic')?.classList.toggle('hidden');
            document.getElementById('chevron-user-dynamic')?.classList.toggle('-rotate-90');
        }
        if (e.target.closest('#toggle-ai-files-dynamic')) {
            document.getElementById('ai-files-list-dynamic')?.classList.toggle('hidden');
            document.getElementById('chevron-ai-dynamic')?.classList.toggle('-rotate-90');
        }

        // Click Outside Dropdowns
        if (!e.target.closest('.chat-dropdown') && !e.target.closest('.chat-menu-btn')) {
            document.querySelectorAll('.chat-dropdown').forEach(d => d.classList.add('hidden'));
        }
        if (!e.target.closest('.file-dropdown') && !e.target.closest('.file-menu-btn')) {
            document.querySelectorAll('.file-dropdown').forEach(d => d.classList.add('hidden'));
        }
        const profileContainer = document.getElementById('custom-profile-selector-container');
        if (profileContainer && !profileContainer.contains(e.target)) {
            document.getElementById('custom-profile-dropdown')?.classList.add('hidden');
        }
    });
}

module.exports = { openDeleteModal, openRenameModal, switchRightSidebarTab, initLayout };