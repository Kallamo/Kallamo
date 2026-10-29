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
  updateChatKnowledgeFiles: (chatId, changes) => ipcRenderer.invoke('update-chat-knowledge-files', { chatId, changes }),
  restoreExampleWorkspace: () => ipcRenderer.invoke('restore-example-workspace'),
  restoreEvenwellWorkspace: () => ipcRenderer.invoke('restore-evenwell-workspace'),
  getOnboardingStory: (workspaceId) => ipcRenderer.invoke('get-onboarding-story', { workspaceId }),
  setOnboardingStage: (workspaceId, stage) => ipcRenderer.invoke('set-onboarding-stage', { workspaceId, stage }),
  beginOnboardingStory: (workspaceId, entityId) => ipcRenderer.invoke('begin-onboarding-story', { workspaceId, entityId }),
  deleteChat: (id) => ipcRenderer.invoke('delete-chat', id),
  getWorkspaceExperienceMode: (workspaceId) => ipcRenderer.invoke('get-workspace-experience-mode', { workspaceId }),
  setWorkspaceExperienceMode: (workspaceId, mode) => ipcRenderer.invoke('set-workspace-experience-mode', { workspaceId, mode }),
  getRoleplayConfiguration: (workspaceId) => ipcRenderer.invoke('get-roleplay-configuration', { workspaceId }),
  getWorldCalendar: (workspaceId) => ipcRenderer.invoke('get-world-calendar', { workspaceId }),
  saveWorldCalendar: (workspaceId, calendar, resolutions = []) => ipcRenderer.invoke('save-world-calendar', { workspaceId, calendar, resolutions }),
  getWorldCalendarEntries: (workspaceId, year, month, eraId) => ipcRenderer.invoke('get-world-calendar-entries', { workspaceId, year, month, eraId }),
  saveRoleplayClock: (workspaceId, position) => ipcRenderer.invoke('save-roleplay-clock', { workspaceId, position }),
  saveRoleplayTimeMatrix: (workspaceId, matrix) => ipcRenderer.invoke('save-roleplay-time-matrix', { workspaceId, matrix }),
  getRoleplayMessageFrames: (workspaceId, originIds) => ipcRenderer.invoke('get-roleplay-message-frames', { workspaceId, originIds }),
  saveRoleplaySettings: (workspaceId, settings) => ipcRenderer.invoke('save-roleplay-settings', { workspaceId, settings }),
  saveRoleplayResourceDefinition: (workspaceId, definition) => ipcRenderer.invoke('save-roleplay-resource-definition', { workspaceId, definition }),
  deleteRoleplayResourceDefinition: (workspaceId, definitionId) => ipcRenderer.invoke('delete-roleplay-resource-definition', { workspaceId, definitionId }),
  setRoleplayResourceValue: (payload) => ipcRenderer.invoke('set-roleplay-resource-value', payload),
  setRoleplayResourceValues: (payload) => ipcRenderer.invoke('set-roleplay-resource-values', payload),
  removeRoleplayResourceValue: (payload) => ipcRenderer.invoke('remove-roleplay-resource-value', payload),
  listRoleplayResourceHolders: (workspaceId, definitionId) => ipcRenderer.invoke('list-roleplay-resource-holders', { workspaceId, definitionId }),
  saveRoleplayScene: (workspaceId, patch) => ipcRenderer.invoke('save-roleplay-scene', { workspaceId, patch }),
  applyRoleplaySceneChange: (workspaceId, patch) => ipcRenderer.invoke('apply-roleplay-scene-change', { workspaceId, patch }),
  getRoleplayInventory: (workspaceId, entityId) => ipcRenderer.invoke('get-roleplay-inventory', { workspaceId, entityId }),
  setRoleplayEquipped: (workspaceId, entityId, itemId, equipped) => ipcRenderer.invoke('set-roleplay-equipped', { workspaceId, entityId, itemId, equipped }),
  applyRoleplayInventoryChange: (workspaceId, patch) => ipcRenderer.invoke('apply-roleplay-inventory-change', { workspaceId, patch }),
  getRoleplayLocationBackground: (workspaceId, locationId) => ipcRenderer.invoke('get-roleplay-location-background', { workspaceId, locationId }),
  setRoleplayLocationBackground: (workspaceId, locationId, imagePath) => ipcRenderer.invoke('set-roleplay-location-background', { workspaceId, locationId, imagePath }),
  uploadRoleplayLocationBackground: (workspaceId, locationId, filePath, fileName) => ipcRenderer.invoke('upload-roleplay-location-background', { workspaceId, locationId, filePath, fileName }),
  setLocationBackgroundFocus: (workspaceId, locationId, focus) => ipcRenderer.invoke('set-location-background-focus', { workspaceId, locationId, focus }),
  listEntityPortraits: (workspaceId) => ipcRenderer.invoke('list-entity-portraits', { workspaceId }),
  setEntityPortrait: (workspaceId, entityId, filePath, focus) => ipcRenderer.invoke('set-entity-portrait', { workspaceId, entityId, filePath, focus }),
  removeEntityPortrait: (workspaceId, entityId) => ipcRenderer.invoke('remove-entity-portrait', { workspaceId, entityId }),
  getRoleplayEntityResources: (workspaceId, entityId) => ipcRenderer.invoke('get-roleplay-entity-resources', { workspaceId, entityId }),
  changeRoleplayResource: (payload) => ipcRenderer.invoke('change-roleplay-resource', payload),
  resolveRoleplayResourceChange: (workspaceId, changeId, decision) => ipcRenderer.invoke('resolve-roleplay-resource-change', { workspaceId, changeId, decision }),
  resolveRoleplaySceneChange: (workspaceId, changeId, decision) => ipcRenderer.invoke('resolve-roleplay-scene-change', { workspaceId, changeId, decision }),
  saveRoleplayProgression: (workspaceId, patch) => ipcRenderer.invoke('save-roleplay-progression', { workspaceId, ...patch }),
  setRoleplayProgressionMembers: (workspaceId, members) => ipcRenderer.invoke('set-roleplay-progression-members', { workspaceId, members }),
  saveRoleplayTrait: (workspaceId, trait) => ipcRenderer.invoke('save-roleplay-trait', { workspaceId, trait }),
  deleteRoleplayTrait: (workspaceId, traitId) => ipcRenderer.invoke('delete-roleplay-trait', { workspaceId, traitId }),
  getRoleplayEntityProgress: (workspaceId, entityId) => ipcRenderer.invoke('get-roleplay-entity-progress', { workspaceId, entityId }),
  setRoleplayEntityProgress: (workspaceId, entityId, change) => ipcRenderer.invoke('set-roleplay-entity-progress', { workspaceId, entityId, ...change }),
  getRoleplayRaceProgress: (workspaceId, raceId) => ipcRenderer.invoke('get-roleplay-race-progress', { workspaceId, raceId }),
  setRoleplayRaceProgress: (workspaceId, raceId, traitId, value) => ipcRenderer.invoke('set-roleplay-race-progress', { workspaceId, raceId, traitId, value }),
  resolveRoleplayProgressChange: (workspaceId, changeId, decision) => ipcRenderer.invoke('resolve-roleplay-progress-change', { workspaceId, changeId, decision }),
  saveRoleplaySkillSettings: (workspaceId, patch) => ipcRenderer.invoke('save-roleplay-skill-settings', { workspaceId, ...patch }),
  setRoleplaySkillMembers: (workspaceId, members) => ipcRenderer.invoke('set-roleplay-skill-members', { workspaceId, members }),
  saveRoleplaySkill: (workspaceId, skill) => ipcRenderer.invoke('save-roleplay-skill', { workspaceId, skill }),
  deleteRoleplaySkill: (workspaceId, skillId) => ipcRenderer.invoke('delete-roleplay-skill', { workspaceId, skillId }),
  getRoleplayEntitySkills: (workspaceId, entityId) => ipcRenderer.invoke('get-roleplay-entity-skills', { workspaceId, entityId }),
  setRoleplayEntitySkill: (workspaceId, entityId, skillId, rank) => ipcRenderer.invoke('set-roleplay-entity-skill', { workspaceId, entityId, skillId, rank }),
  resolveRoleplaySkillChange: (workspaceId, changeId, decision) => ipcRenderer.invoke('resolve-roleplay-skill-change', { workspaceId, changeId, decision }),
  getRoleplayEntityHistory: (workspaceId, entityId, limit) => ipcRenderer.invoke('get-roleplay-entity-history', { workspaceId, entityId, limit }),
  resolveRoleplayInventoryChange: (workspaceId, changeId, decision) => ipcRenderer.invoke('resolve-roleplay-inventory-change', { workspaceId, changeId, decision }),
  resolveRoleplayEntityChange: (workspaceId, changeId, decision) => ipcRenderer.invoke('resolve-roleplay-entity-change', { workspaceId, changeId, decision }),
  resolveNarrativeStateEvent: (workspaceId, eventId, decision) => ipcRenderer.invoke('resolve-narrative-state-event', { workspaceId, eventId, decision }),
  resolveNarrativeStateOperations: (workspaceId, eventId, approvedOperationIds, rejectedOperationIds) =>
    ipcRenderer.invoke('resolve-narrative-state-operations', { workspaceId, eventId, approvedOperationIds, rejectedOperationIds }),
  deferNarrativeStateTurn: (workspaceId, originId) => ipcRenderer.invoke('defer-narrative-state-turn', { workspaceId, originId }),
  reprocessNarrativeStateTurn: (workspaceId, originId) => ipcRenderer.invoke('reprocess-narrative-state-turn', { workspaceId, originId }),
  compactNarrativeState: (workspaceId, apply) => ipcRenderer.invoke('compact-narrative-state', { workspaceId, apply }),
  onRoleplayResourceChanges: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('roleplay-resource-changes', listener);
    return () => ipcRenderer.off('roleplay-resource-changes', listener);
  },
  onMessageDebugNotice: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('message-debug-notice', listener);
    return () => ipcRenderer.off('message-debug-notice', listener);
  },
  onNarrativeStateStatus: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('narrative-state-status', listener);
    return () => ipcRenderer.off('narrative-state-status', listener);
  },

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
  getWdLastChannel: (workspaceId) => ipcRenderer.invoke('get-wd-last-channel', { workspaceId }),
  setWdLastChannel: (workspaceId, channel) => ipcRenderer.invoke('set-wd-last-channel', { workspaceId, channel }),
  setChatLastTarget: (chatId, targetId) => ipcRenderer.invoke('set-chat-last-target', { chatId, targetId }),
  rebuildChatSummary: (chatId, blockId) => ipcRenderer.invoke('rebuild-chat-summary', { chatId, blockId }),
  finalizeSummaryBlock: (chatId, blockId) => ipcRenderer.invoke('finalize-summary-block', { chatId, blockId }),
  onSummarizationProgress: (callback) => {
    const handler = (_event, payload) => callback(payload);
    ipcRenderer.on('summarization-progress', handler);
    return () => ipcRenderer.removeListener('summarization-progress', handler);
  },
  getDirectives: (workspaceId) => ipcRenderer.invoke('get-directives', { workspaceId }),
  addDirective: (workspaceId, type, text, sourceMessageId) => ipcRenderer.invoke('add-directive', { workspaceId, type, text, sourceMessageId }),
  updateDirective: (id, text) => ipcRenderer.invoke('update-directive', { id, text }),
  updateDirectiveEnabled: (id, enabled) => ipcRenderer.invoke('update-directive-enabled', { id, enabled }),
  deleteDirective: (id) => ipcRenderer.invoke('delete-directive', { id }),
  getDocumentNotes: (documentId) => ipcRenderer.invoke('get-document-notes', { documentId }),
  createDocumentNote: (note) => ipcRenderer.invoke('create-document-note', note),
  updateDocumentNote: (id, patch) => ipcRenderer.invoke('update-document-note', { id, ...patch }),
  deleteDocumentNote: (id) => ipcRenderer.invoke('delete-document-note', { id }),
  getDocumentAnalyses: (documentId) => ipcRenderer.invoke('get-document-analyses', { documentId }),
  createDocumentAnalysis: (analysis) => ipcRenderer.invoke('create-document-analysis', analysis),
  markDocumentAnalysisNoted: (id) => ipcRenderer.invoke('mark-document-analysis-noted', { id }),
  deleteDocumentAnalysis: (id) => ipcRenderer.invoke('delete-document-analysis', { id }),
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard', text),
  backfillWorldIndex: (chatId, opts = {}) => ipcRenderer.invoke('backfill-world-index', { chatId, ...opts }),
  getWorldIndexStatus: (chatId, tier) => ipcRenderer.invoke('get-world-index-status', { chatId, tier }),
  getWorldIndexErrors: (chatId) => ipcRenderer.invoke('get-world-index-errors', { chatId }),
  dismissWorldIndexError: (runId) => ipcRenderer.invoke('dismiss-world-index-error', { runId }),
  getWorldIndexTaggableChunks: (chatId, tier) => ipcRenderer.invoke('get-world-index-taggable-chunks', { chatId, tier }),
  startWorldIndexTagging: (chatId, opts = {}) => ipcRenderer.invoke('start-world-index-tagging', { chatId, ...opts }),
  getChatMemoryTags: (chatId) => ipcRenderer.invoke('get-chat-memory-tags', { chatId }),
  getChatKbTags: (chatId) => ipcRenderer.invoke('get-chat-kb-tags', { chatId }),
  setChunkTags: (chunkId, keywords, entities) => ipcRenderer.invoke('set-chunk-tags', { chunkId, keywords, entities }),
  getSearchableFileTagSummary: (chatId, source) => ipcRenderer.invoke('get-searchable-file-tag-summary', { chatId, source }),
  applySearchableFileTag: (chatId, source, action, kind, value) => ipcRenderer.invoke('apply-searchable-file-tag', { chatId, source, action, kind, value }),
  vectorizeDocument: (documentId) => ipcRenderer.invoke('vectorize-document', { documentId }),
  retagDocument: (documentId) => ipcRenderer.invoke('retag-document', { documentId }),
  getDocumentVectorStatus: (documentId) => ipcRenderer.invoke('get-document-vector-status', { documentId }),
  onVectorizeDocumentProgress: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('vectorize-document-progress', listener);
    return () => ipcRenderer.off('vectorize-document-progress', listener);
  },
  onWorldIndexTaggingProgress: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('world-index-tagging-progress', listener);
    return () => ipcRenderer.off('world-index-tagging-progress', listener);
  },
  listEntities: (workspaceId, type) => ipcRenderer.invoke('list-entities', { workspaceId, type }),
  listWorldbuildFieldDefinitions: (workspaceId, typeId) => ipcRenderer.invoke('list-worldbuild-field-definitions', { workspaceId, typeId }),
  saveWorldbuildFieldDefinition: (definition) => ipcRenderer.invoke('save-worldbuild-field-definition', definition),
  deleteWorldbuildFieldDefinition: (workspaceId, fieldId) => ipcRenderer.invoke('delete-worldbuild-field-definition', { workspaceId, fieldId }),
  listWorldbuildEntityTemplates: (workspaceId) => ipcRenderer.invoke('list-worldbuild-entity-templates', { workspaceId }),
  saveWorldbuildEntityTemplate: (template) => ipcRenderer.invoke('save-worldbuild-entity-template', template),
  getWorldbuildSubjectKnowledge: (workspaceId, subjectId) => ipcRenderer.invoke('get-worldbuild-subject-knowledge', { workspaceId, subjectId }),
  listWorldbuildFacts: (workspaceId) => ipcRenderer.invoke('list-worldbuild-facts', { workspaceId }),
  saveWorldbuildFact: (payload) => ipcRenderer.invoke('save-worldbuild-fact', payload),
  deleteWorldbuildFact: (payload) => ipcRenderer.invoke('delete-worldbuild-fact', payload),
  listWorldbuildEventOccurrences: (workspaceId, eventEntityId) => ipcRenderer.invoke('list-worldbuild-event-occurrences', { workspaceId, eventEntityId }),
  createWorldbuildEventOccurrence: (payload) => ipcRenderer.invoke('create-worldbuild-event-occurrence', payload),
  updateWorldbuildEventOccurrence: (payload) => ipcRenderer.invoke('update-worldbuild-event-occurrence', payload),
  deleteWorldbuildEventOccurrence: (workspaceId, eventEntityId, occurrenceId) => ipcRenderer.invoke('delete-worldbuild-event-occurrence', { workspaceId, eventEntityId, occurrenceId }),
  getWorldbuildSubjectReview: (workspaceId, subjectId) => ipcRenderer.invoke('get-worldbuild-subject-review', { workspaceId, subjectId }),
  listWorldbuildReviewCounts: (workspaceId) => ipcRenderer.invoke('list-worldbuild-review-counts', { workspaceId }),
  saveWorldbuildSubjectEntry: (payload) => ipcRenderer.invoke('save-worldbuild-subject-entry', payload),
  deleteWorldbuildSubjectEntry: (payload) => ipcRenderer.invoke('delete-worldbuild-subject-entry', payload),
  ensureWorldbuildAwareness: (payload) => ipcRenderer.invoke('ensure-worldbuild-awareness', payload),
  setWorldbuildKnownFields: (payload) => ipcRenderer.invoke('set-worldbuild-known-fields', payload),
  markWorldbuildCurrentFieldsKnown: (payload) => ipcRenderer.invoke('mark-worldbuild-current-fields-known', payload),
  setWorldbuildKnownRelationships: (payload) => ipcRenderer.invoke('set-worldbuild-known-relationships', payload),
  removeWorldbuildKnowledgeCard: (payload) => ipcRenderer.invoke('remove-worldbuild-knowledge-card', payload),
  setWorldbuildKnowledgeAudience: (payload) => ipcRenderer.invoke('set-worldbuild-knowledge-audience', payload),
  listEntityLinks: (workspaceId, relType) => ipcRenderer.invoke('list-entity-links', { workspaceId, relType }),
  getWorkspaceUiState: (workspaceId, scope) => ipcRenderer.invoke('get-workspace-ui-state', { workspaceId, scope }),
  setWorkspaceUiState: (workspaceId, scope, value) => ipcRenderer.invoke('set-workspace-ui-state', { workspaceId, scope, value }),
  getWritingDeskState: (workspaceId) => ipcRenderer.invoke('get-writing-desk-state', { workspaceId }),
  getInWorldText: (documentId) => ipcRenderer.invoke('get-in-world-text', { documentId }),
  setInWorldText: (documentId, itemId, authorId) => ipcRenderer.invoke('set-in-world-text', { documentId, itemId, authorId }),
  clearInWorldText: (documentId) => ipcRenderer.invoke('clear-in-world-text', { documentId }),
  listItemTexts: (workspaceId, itemId) => ipcRenderer.invoke('list-item-texts', { workspaceId, itemId }),
  moveItemText: (documentId, direction) => ipcRenderer.invoke('move-item-text', { documentId, direction }),
  createItemText: (workspaceId, itemId, title, defaults) => ipcRenderer.invoke('create-item-text', { workspaceId, itemId, title, defaults }),
  onInWorldTextsChanged: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on('in-world-texts-changed', listener);
    return () => ipcRenderer.removeListener('in-world-texts-changed', listener);
  },
  setWritingDeskState: (workspaceId, state) => ipcRenderer.invoke('set-writing-desk-state', { workspaceId, state }),
  getEntity: (id) => ipcRenderer.invoke('get-entity', { id }),
  createEntity: (payload) => ipcRenderer.invoke('create-entity', payload),
  resolveEntityByName: (workspaceId, name) => ipcRenderer.invoke('resolve-entity-by-name', { workspaceId, name }),
  findEntityCandidates: (workspaceId, mention) => ipcRenderer.invoke('find-entity-candidates', { workspaceId, mention }),
  addEntityAlias: (id, alias) => ipcRenderer.invoke('add-entity-alias', { id, alias }),
  updateEntity: (id, fields) => ipcRenderer.invoke('update-entity', { id, fields }),
  deleteEntity: (id) => ipcRenderer.invoke('delete-entity', { id }),
  mergeEntity: (sourceId, targetId, prefer) => ipcRenderer.invoke('merge-entity', { sourceId, targetId, prefer }),
  resolveEnrichReview: (id, accept, reject) => ipcRenderer.invoke('resolve-enrich-review', { id, accept, reject }),
  getEntityReview: (workspaceId) => ipcRenderer.invoke('get-entity-review', { workspaceId }),
  summarizeBulkEntities: (workspaceId, ids) => ipcRenderer.invoke('summarize-bulk-entities', { workspaceId, ids }),
  bulkManageEntities: (workspaceId, ids, action, policy) => ipcRenderer.invoke('bulk-manage-entities', { workspaceId, ids, action, policy }),
  exportWorldbuild: (workspaceId, options = {}) => ipcRenderer.invoke('export-worldbuild', { workspaceId, ...options }),
  worldbuildExportSummary: (workspaceId) => ipcRenderer.invoke('worldbuild-export-summary', { workspaceId }),
  inspectWorldbuildPackage: (workspaceId) => ipcRenderer.invoke('inspect-worldbuild-package', { workspaceId }),
  importWorldbuild: (workspaceId, filePath, rulesMode = 'merge', calendarMode = null, clearDates = []) => ipcRenderer.invoke('import-worldbuild', { workspaceId, filePath, rulesMode, calendarMode, clearDates }),
  enrichEntities: (workspaceId, { entityIds } = {}) => ipcRenderer.invoke('enrich-entities', { workspaceId, entityIds }),
  cancelEnrichEntities: (workspaceId) => ipcRenderer.invoke('cancel-enrich-entities', { workspaceId }),
  getEnrichStatus: () => ipcRenderer.invoke('get-enrich-status'),
  getEntityEnrichmentErrors: (workspaceId) => ipcRenderer.invoke('get-entity-enrichment-errors', { workspaceId }),
  dismissEntityEnrichmentError: (id) => ipcRenderer.invoke('dismiss-entity-enrichment-error', { id }),
  onEnrichEntitiesProgress: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('enrich-entities-progress', listener);
    return () => ipcRenderer.off('enrich-entities-progress', listener);
  },
  onEnrichEntitiesComplete: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('enrich-entities-complete', listener);
    return () => ipcRenderer.off('enrich-entities-complete', listener);
  },
  getEntityLinks: (id, direction, relType) => ipcRenderer.invoke('get-entity-links', { id, direction, relType }),
  setEntityLink: (payload) => ipcRenderer.invoke('set-entity-link', payload),
  setInventoryItem: (payload) => ipcRenderer.invoke('set-inventory-item', payload),
  removeEntityLink: (linkId) => ipcRenderer.invoke('remove-entity-link', { linkId }),
  updateEntityLinkLabel: (linkId, label) => ipcRenderer.invoke('update-entity-link-label', { linkId, label }),
  updateEntityLink: (linkId, fields) => ipcRenderer.invoke('update-entity-link', { linkId, fields }),
  getChatMessages: (chatId) => ipcRenderer.invoke('get-chat-messages', chatId),
  getChatMessagePage: (params) => ipcRenderer.invoke('get-chat-message-page', params),
  saveMessage: (message) => ipcRenderer.invoke('save-message', message),
  deleteMessage: (messageId, shouldDeleteFiles) => ipcRenderer.invoke('delete-message', messageId, shouldDeleteFiles),
  revertChatToMessage: (chatId, messageId) => ipcRenderer.invoke('revert-chat-to-message', { chatId, messageId }),
  executeSummarization: (args) => ipcRenderer.invoke('execute-summarization', args),
  getArchiveOverview: (chatId) => ipcRenderer.invoke('get-archive-overview', { chatId }),
  getArchiveTokenTotals: (chatId) => ipcRenderer.invoke('get-archive-token-totals', { chatId }),
  getArchivedMessageDetails: (chatId, messageIds) => ipcRenderer.invoke('get-archived-message-details', { chatId, messageIds }),
  resetChatSummaries: (chatId) => ipcRenderer.invoke('reset-chat-summaries', { chatId }),
  setMessagesExcluded: (chatId, messageIds, excluded) => ipcRenderer.invoke('set-messages-excluded', { chatId, messageIds, excluded }),
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
  setChatKbBlockProfiles: (chatId, blockId, profiles) => ipcRenderer.invoke('set-chat-kb-block-profiles', { chatId, blockId, profiles }),
  renameChatKbBlock: (chatId, blockId, title) => ipcRenderer.invoke('rename-chat-kb-block', { chatId, blockId, title }),
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

  // --- UI FLAGS (one-time hints) ---
  getUiFlags: () => ipcRenderer.invoke('get-ui-flags'),
  setUiFlag: (key) => ipcRenderer.invoke('set-ui-flag', key),

  // --- WHAT'S NEW (post-update highlights) ---
  getWhatsNewState: () => ipcRenderer.invoke('get-whats-new-state'),
  markWhatsNewSeen: (type) => ipcRenderer.invoke('mark-whats-new-seen', { type }),

  // --- LIVE GENERATION & WORKFLOWS ---
  sendMessage: (args) => ipcRenderer.invoke('send-message', args),
  cancelGeneration: () => ipcRenderer.send('cancel-generation'),

  // --- REALTIME EVENTS ---
  onWorkflowProgress: (callback) => {
    const listener = (event, progress) => callback(progress);
    ipcRenderer.on('workflow-progress', listener);
    return () => ipcRenderer.off('workflow-progress', listener);
  },
  onStreamToken: (callback) => {
    const listener = (event, payload) => callback(payload);
    ipcRenderer.on('stream:token', listener);
    return () => ipcRenderer.off('stream:token', listener);
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
  respondToError: (decision, runId) => ipcRenderer.send('respond-to-error', { decision, runId }),
  respondToOverflow: (decision, editedText, runId) => ipcRenderer.send('respond-to-overflow', { decision, editedText, runId }),

  // --- UTILITIES ---
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  openWorkspaceFolder: () => ipcRenderer.send('open-workspace-folder'),
  backupWorkspace: () => ipcRenderer.invoke('backup-workspace'),
  restoreWorkspace: () => ipcRenderer.invoke('restore-workspace'),
  listMigrationBackups: () => ipcRenderer.invoke('list-migration-backups'),
  openMigrationBackupsFolder: () => ipcRenderer.send('open-migration-backups-folder'),
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

  // --- LOCAL AI ENGINE ---
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

  onWorldIndexTaggingFailed: (callback) => {
    const listener = (event, data) => callback(data);
    ipcRenderer.on('world-index-tagging-failed', listener);
    return () => ipcRenderer.off('world-index-tagging-failed', listener);
  },

  // --- AUTO-UPDATER ---
  installUpdate: () => ipcRenderer.send('install-update'),
  // The window stays hidden behind the splash until this says its data is on screen.
  appReady: () => ipcRenderer.send('app-ready'),
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
