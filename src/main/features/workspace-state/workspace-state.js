const db = require('../../database');

const WRITING_DESK_SCOPE = 'writing-desk';

function getWorkspaceUiState(workspaceId, scope) {
  const row = db.prepare(
    'SELECT valueJson FROM workspace_ui_state WHERE workspaceId = ? AND scope = ?'
  ).get(workspaceId, scope);

  if (!row) return null;

  try {
    return JSON.parse(row.valueJson);
  } catch {
    return null;
  }
}

function setWorkspaceUiState(workspaceId, scope, value) {
  db.prepare(`
    INSERT INTO workspace_ui_state (workspaceId, scope, valueJson, updatedAt)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(workspaceId, scope) DO UPDATE SET
      valueJson = excluded.valueJson,
      updatedAt = excluded.updatedAt
  `).run(workspaceId, scope, JSON.stringify(value || {}), Date.now());
}

function normalizeWritingDeskState(value = {}) {
  const expandedFolderIds = Array.isArray(value.expandedFolderIds)
    ? [...new Set(value.expandedFolderIds.filter(id => typeof id === 'string' && id))]
    : [];

  return {
    expandedFolderIds,
    lastDocumentId: typeof value.lastDocumentId === 'string' && value.lastDocumentId
      ? value.lastDocumentId
      : null,
  };
}

function getWritingDeskState(workspaceId) {
  return normalizeWritingDeskState(getWorkspaceUiState(workspaceId, WRITING_DESK_SCOPE));
}

function setWritingDeskState(workspaceId, state) {
  setWorkspaceUiState(workspaceId, WRITING_DESK_SCOPE, normalizeWritingDeskState(state));
}

function registerWorkspaceStateIpc(ipcMain) {
  ipcMain.handle('get-workspace-ui-state', async (event, { workspaceId, scope } = {}) => {
    try {
      if (!workspaceId || !scope) return { success: false, error: 'workspaceId and scope are required' };
      return { success: true, value: getWorkspaceUiState(workspaceId, scope) };
    } catch (error) {
      console.error('[get-workspace-ui-state] failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('set-workspace-ui-state', async (event, { workspaceId, scope, value } = {}) => {
    try {
      if (!workspaceId || !scope) return { success: false, error: 'workspaceId and scope are required' };
      setWorkspaceUiState(workspaceId, scope, value);
      return { success: true };
    } catch (error) {
      console.error('[set-workspace-ui-state] failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('get-writing-desk-state', async (event, { workspaceId } = {}) => {
    try {
      if (!workspaceId) return { success: false, error: 'workspaceId is required' };
      return { success: true, state: getWritingDeskState(workspaceId) };
    } catch (error) {
      console.error('[get-writing-desk-state] failed:', error);
      return { success: false, error: error.message };
    }
  });

  ipcMain.handle('set-writing-desk-state', async (event, { workspaceId, state } = {}) => {
    try {
      if (!workspaceId) return { success: false, error: 'workspaceId is required' };
      setWritingDeskState(workspaceId, state);
      return { success: true };
    } catch (error) {
      console.error('[set-writing-desk-state] failed:', error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = { registerWorkspaceStateIpc };
