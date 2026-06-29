const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // --- TITLEBAR CONTROLS ---
  minimize: () => ipcRenderer.send('window-minimize'),
  maximize: () => ipcRenderer.send('window-maximize'),
  close: () => ipcRenderer.send('window-close'),

  // --- API CONNECTIONS ---
  getApiProfiles: () => ipcRenderer.invoke('get-api-profiles'),
  saveApiProfile: (profile) => ipcRenderer.invoke('save-api-profile', profile),
  deleteApiProfile: (id) => ipcRenderer.invoke('delete-api-profile', id),

  // --- AI/WRITING PROFILES ---
  getWritingProfiles: () => ipcRenderer.invoke('get-writing-profiles'),
  saveWritingProfile: (profile) => ipcRenderer.invoke('save-writing-profile', profile),
  deleteWritingProfile: (id) => ipcRenderer.invoke('delete-writing-profile', id),
  uploadKbFile: (profileId, file) => ipcRenderer.invoke('upload-kb-file', { profileId, name: file.name, path: file.path, size: file.size }),
  deleteKbFile: (profileId, fileName) => ipcRenderer.invoke('delete-kb-file', { profileId, fileName }),
  countTokens: (texts) => ipcRenderer.invoke('count-tokens', texts),
  getProfileKbBlocks: (profileId) => ipcRenderer.invoke('get-profile-kb-blocks', { profileId }),
  saveProfileKbBlocks: (profileId, blocks) => ipcRenderer.invoke('save-profile-kb-blocks', { profileId, blocks }),
  toggleKbBlockEnabled: (profileId, block, enabled) => ipcRenderer.invoke('toggle-kb-block-enabled', { profileId, block, enabled }),
  toggleChatKbBlockEnabled: (chatId, block, enabled) => ipcRenderer.invoke('toggle-chat-kb-block-enabled', { chatId, block, enabled }),
  vectorizeKbChunk: (text, source, keywords) => ipcRenderer.invoke('vectorize-kb-chunk', { text, source, keywords }),
  addProfileConstantFile: (profileId, file) => ipcRenderer.invoke('add-profile-constant-file', { profileId, name: file.name, path: file.path, size: file.size }),
  addProfileSearchableFile: (profileId, file) => ipcRenderer.invoke('add-profile-searchable-file', { profileId, name: file.name, path: file.path, size: file.size }),

  // --- CHATS ---
  getChats: () => ipcRenderer.invoke('get-chats'),
  saveChat: (chat) => ipcRenderer.invoke('save-chat', chat),
  deleteChat: (id) => ipcRenderer.invoke('delete-chat', id),

  // --- WRITING DESK (documents & folders) ---
  getWritingTree: (workspaceId) => ipcRenderer.invoke('get-writing-tree', { workspaceId }),
  getDocument: (id) => ipcRenderer.invoke('get-document', { id }),
  createFolder: (workspaceId, name, parentId) => ipcRenderer.invoke('create-folder', { workspaceId, name, parentId }),
  renameFolder: (id, name) => ipcRenderer.invoke('rename-folder', { id, name }),
  moveFolder: (id, parentId) => ipcRenderer.invoke('move-folder', { id, parentId }),
  deleteFolder: (id) => ipcRenderer.invoke('delete-folder', { id }),
  createDocument: (workspaceId, folderId, title, content, defaults) => ipcRenderer.invoke('create-document', { workspaceId, folderId, title, content, defaults }),
  renameDocument: (id, title) => ipcRenderer.invoke('rename-document', { id, title }),
  moveDocument: (id, folderId) => ipcRenderer.invoke('move-document', { id, folderId }),
  reorderWritingItems: (updates) => ipcRenderer.invoke('reorder-writing-items', { updates }),
  deleteDocument: (id) => ipcRenderer.invoke('delete-document', { id }),
  saveDocumentContent: (id, content) => ipcRenderer.invoke('save-document-content', { id, content }),
  saveDocumentSheet: (id, sheet) => ipcRenderer.invoke('save-document-sheet', { id, ...sheet }),
  saveDocumentPage: (id, page) => ipcRenderer.invoke('save-document-page', { id, page }),
  exportDocumentPdf: (payload) => ipcRenderer.invoke('export-document-pdf', payload),
  exportDocumentDocx: (payload) => ipcRenderer.invoke('export-document-docx', payload),
  exportBookDocx: (payload) => ipcRenderer.invoke('export-book-docx', payload),
  importDocument: () => ipcRenderer.invoke('import-document', {}),
  invokeWritingDesk: (payload) => ipcRenderer.invoke('invoke-writing-desk', payload),
  wdInvocationStatus: () => ipcRenderer.invoke('wd-invocation-status'),
  onWdInvocationComplete: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('wd-invocation-complete', listener);
    return () => ipcRenderer.off('wd-invocation-complete', listener);
  },
  getPendingSuggestion: (documentId) => ipcRenderer.invoke('get-pending-suggestion', { documentId }),
  getPendingSuggestionIds: (workspaceId) => ipcRenderer.invoke('get-pending-suggestion-ids', { workspaceId }),
  resolvePendingSuggestion: (id) => ipcRenderer.invoke('resolve-pending-suggestion', { id }),
  getDirectives: (workspaceId) => ipcRenderer.invoke('get-directives', { workspaceId }),
  addDirective: (workspaceId, type, text, sourceMessageId) => ipcRenderer.invoke('add-directive', { workspaceId, type, text, sourceMessageId }),
  updateDirective: (id, text) => ipcRenderer.invoke('update-directive', { id, text }),
  updateDirectiveEnabled: (id, enabled) => ipcRenderer.invoke('update-directive-enabled', { id, enabled }),
  deleteDirective: (id) => ipcRenderer.invoke('delete-directive', { id }),
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),
  debugRegenerateMemoryBlock: (chatId, blockId, profileId) => ipcRenderer.invoke('debug-regenerate-memory-block', { chatId, blockId, profileId }),
  getChatMessages: (chatId) => ipcRenderer.invoke('get-chat-messages', chatId),
  saveMessage: (message) => ipcRenderer.invoke('save-message', message),
  deleteMessage: (messageId, shouldDeleteFiles) => ipcRenderer.invoke('delete-message', messageId, shouldDeleteFiles),
  revertChatToMessage: (chatId, messageId) => ipcRenderer.invoke('revert-chat-to-message', { chatId, messageId }),
  triggerManualSummarize: (chatId, profileId) => ipcRenderer.invoke('trigger-manual-summarize', { chatId, profileId }),
  executeSummarization: (args) => ipcRenderer.invoke('execute-summarization', args),
  onTriggerAutoSummarize: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('trigger-auto-summarize', listener);
    return () => ipcRenderer.off('trigger-auto-summarize', listener);
  },
  uploadChatBgImage: (chatId, filePath, fileName) => ipcRenderer.invoke('upload-chat-bg-image', { chatId, filePath, fileName }),
  uploadChatKbFile: (chatId, file) => ipcRenderer.invoke('upload-chat-kb-file', { chatId, name: file.name, path: file.path, size: file.size }),
  deleteChatKbFile: (chatId, fileName) => ipcRenderer.invoke('delete-chat-kb-file', { chatId, fileName }),
  getChatFiles: (chatId) => ipcRenderer.invoke('get-chat-files', chatId),
  saveChatManualSnippet: (chatId, snippetId, title, content) => ipcRenderer.invoke('save-chat-manual-snippet', { chatId, snippetId, title, content }),
  deleteChatManualSnippet: (chatId, snippetId) => ipcRenderer.invoke('delete-chat-manual-snippet', { chatId, snippetId }),
  testChatRagSearch: (chatId, queryText, profileId) => ipcRenderer.invoke('test-chat-rag-search', { chatId, queryText, profileId }),
  getChatKbBlocks: (chatId) => ipcRenderer.invoke('get-chat-kb-blocks', { chatId }),
  saveChatKbBlock: (chatId, block) => ipcRenderer.invoke('save-chat-kb-block', { chatId, block }),
  deleteChatKbBlock: (chatId, block) => ipcRenderer.invoke('delete-chat-kb-block', { chatId, block }),

  onVectorizationProgress: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('vectorization-progress', listener);
    return () => ipcRenderer.off('vectorization-progress', listener);
  },

  // --- WORKFLOWS ---
  getWorkflows: () => ipcRenderer.invoke('get-workflows'),
  saveWorkflow: (workflow) => ipcRenderer.invoke('save-workflow', workflow),
  deleteWorkflow: (id) => ipcRenderer.invoke('delete-workflow', id),

  // --- VARIABLES ---
  getVariables: () => ipcRenderer.invoke('variables:get'),
  saveVariable: (variable) => ipcRenderer.invoke('variables:save', variable),
  deleteVariable: (id) => ipcRenderer.invoke('variables:delete', id),

  // --- SETTINGS ---
  getSettings: () => ipcRenderer.invoke('get-settings'),
  saveSettings: (settings) => ipcRenderer.invoke('save-settings', settings),

  // --- LIVE GENERATION & WORKFLOWS ---
  sendMessage: (args) => ipcRenderer.invoke('send-message', args),
  cancelGeneration: () => ipcRenderer.send('cancel-generation'),

  // --- REALTIME EVENTS ---
  onWorkflowProgress: (callback) => {
    const listener = (event, progress) => callback(progress);
    ipcRenderer.on('workflow-progress', listener);
    return () => ipcRenderer.off('workflow-progress', listener);
  },
  onWorkflowError: (callback) => {
    const listener = (event, errorData) => callback(errorData);
    ipcRenderer.on('workflow-error', listener);
    return () => ipcRenderer.off('workflow-error', listener);
  },
  onWorkflowContextOverflow: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('workflow-context-overflow', listener);
    return () => ipcRenderer.off('workflow-context-overflow', listener);
  },
  respondToError: (decision) => ipcRenderer.send('respond-to-error', decision),
  respondToOverflow: (decision, editedText) => ipcRenderer.send('respond-to-overflow', { decision, editedText }),

  // --- UTILITIES ---
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  openWorkspaceFolder: () => ipcRenderer.send('open-workspace-folder'),
  backupWorkspace: () => ipcRenderer.invoke('backup-workspace'),
  restoreWorkspace: () => ipcRenderer.invoke('restore-workspace'),
  purgeVectors: () => ipcRenderer.invoke('purge-vectors'),
  clearModelCache: () => ipcRenderer.invoke('clear-model-cache'),

  // --- IMPORT / EXPORT ---
  exportAiProfile: (profile, exportKb) => ipcRenderer.invoke('export-ai-profile', { profile, exportKb }),
  importAiProfile: () => ipcRenderer.invoke('import-ai-profile'),
  exportKnowledgeBase: (profileId, profileName) => ipcRenderer.invoke('export-knowledge-base', { profileId, profileName }),
  importKnowledgeBase: (profileId) => ipcRenderer.invoke('import-knowledge-base', { profileId }),
  exportChatKnowledgeBase: (chatId, chatTitle) => ipcRenderer.invoke('export-chat-knowledge-base', { chatId, chatTitle }),
  importChatKnowledgeBase: (chatId) => ipcRenderer.invoke('import-chat-knowledge-base', { chatId }),
  exportWorkflow: (workflow, exportKb) => ipcRenderer.invoke('export-workflow', { workflow, exportKb }),
  importWorkflow: () => ipcRenderer.invoke('import-workflow'),
  onExportProgress: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('export-progress', listener);
    return () => ipcRenderer.off('export-progress', listener);
  },
  onImportProgress: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('import-progress', listener);
    return () => ipcRenderer.off('import-progress', listener);
  },

  // --- LOCAL AI ENGINE (v1.0.5) ---
  getEngineStatus: () => ipcRenderer.invoke('get-engine-status'),
  downloadEngine: () => ipcRenderer.invoke('download-engine'),
  cancelEngineDownload: () => ipcRenderer.invoke('cancel-engine-download'),
  deleteEngine: () => ipcRenderer.invoke('delete-engine'),
  onDownloadEngineProgress: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('download-engine-progress', listener);
    return () => ipcRenderer.off('download-engine-progress', listener);
  },

  onSettingsChanged: (callback) => {
    const listener = () => callback();
    ipcRenderer.on('settings-changed', listener);
    return () => ipcRenderer.off('settings-changed', listener);
  },

  // --- AUTO-UPDATER ---
  installUpdate: () => ipcRenderer.send('install-update'),
  onUpdateAvailable: (callback) => {
    const listener = (event, version) => callback(version);
    ipcRenderer.on('update-available', listener);
    return () => ipcRenderer.off('update-available', listener);
  },
  onUpdateDownloaded: (callback) => {
    const listener = (event, version) => callback(version);
    ipcRenderer.on('update-downloaded', listener);
    return () => ipcRenderer.off('update-downloaded', listener);
  },

  // --- RAG RE-INDEX PROGRESS ---
  onReindexProgress: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('reindex-progress', listener);
    return () => ipcRenderer.off('reindex-progress', listener);
  },

  // --- PLATFORM UPDATE NOTIFICATION (macOS/Linux .deb) ---
  onUpdateOutdated: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('update-outdated', listener);
    return () => ipcRenderer.off('update-outdated', listener);
  }
});
