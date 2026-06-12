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
  getProfileKbBlocks: (profileId) => ipcRenderer.invoke('get-profile-kb-blocks', { profileId }),
  saveProfileKbBlocks: (profileId, blocks) => ipcRenderer.invoke('save-profile-kb-blocks', { profileId, blocks }),
  vectorizeKbChunk: (text, source) => ipcRenderer.invoke('vectorize-kb-chunk', { text, source }),
  addProfileConstantFile: (profileId, file) => ipcRenderer.invoke('add-profile-constant-file', { profileId, name: file.name, path: file.path, size: file.size }),
  addProfileSearchableFile: (profileId, file) => ipcRenderer.invoke('add-profile-searchable-file', { profileId, name: file.name, path: file.path, size: file.size }),

  // --- CHATS ---
  getChats: () => ipcRenderer.invoke('get-chats'),
  saveChat: (chat) => ipcRenderer.invoke('save-chat', chat),
  deleteChat: (id) => ipcRenderer.invoke('delete-chat', id),
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
  openWorkspaceFolder: () => ipcRenderer.send('open-workspace-folder'),
  backupWorkspace: () => ipcRenderer.invoke('backup-workspace'),
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
  }
});
