export function resolveActiveGenerationTarget({
  selectedTargetId,
  activeProfileIds,
  activeWorkflowIds,
  profiles,
  workflows
}) {
  const activeProfiles = profiles.filter(profile => activeProfileIds.includes(profile.id));
  const activeWorkflows = workflows.filter(workflow => activeWorkflowIds.includes(workflow.id));
  const selectedProfile = activeProfiles.find(profile => profile.id === selectedTargetId);
  const selectedWorkflow = activeWorkflows.find(workflow => workflow.id === selectedTargetId);
  return selectedProfile || selectedWorkflow || activeProfiles[0] || activeWorkflows[0] || null;
}

export function prepareGenerationSubmission({ inputValue, pendingFiles = [], targetId }) {
  const text = String(inputValue || '').trim();
  if ((!text && pendingFiles.length === 0) || !targetId) return null;

  return {
    content: text || `Attached files: ${pendingFiles.map(file => file.name).join(', ')}`,
    targetId,
    attachedFiles: pendingFiles
  };
}

export function createHistoryEdit(messageId, content) {
  return { messageId, content };
}

export function isRetryableGenerationError(error) {
  return error?.retryable === true;
}

export function isGenerationEventForWorkspace(event, workspaceId) {
  return Boolean(workspaceId && event?.chatId === workspaceId);
}
