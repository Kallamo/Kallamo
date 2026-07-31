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

export function isGenerationEventForWorkspace(event, workspaceId) {
  return Boolean(workspaceId && event?.chatId === workspaceId);
}
