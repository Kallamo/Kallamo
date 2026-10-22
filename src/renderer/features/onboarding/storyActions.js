// Starts the onboarding story as the chosen character and brings the chat into view with its opening.
export async function beginStory(app, workspaceId, entityId) {
  const result = await app.electronAPI.beginOnboardingStory(workspaceId, entityId);
  if (!result?.success) {
    app.showToast(result?.error || 'The story could not start.', 'error');
    return null;
  }
  await app.refreshChats(workspaceId);
  window.dispatchEvent(new CustomEvent('roleplay-state-change', { detail: { workspaceId } }));
  window.dispatchEvent(new CustomEvent('onboarding-story-change', { detail: { workspaceId, story: result.story } }));
  app.setActiveWorkspaceView('chat');
  return result;
}

export async function setStoryStage(app, workspaceId, stage) {
  const result = await app.electronAPI.setOnboardingStage(workspaceId, stage);
  if (result?.success) window.dispatchEvent(new CustomEvent('onboarding-story-change', { detail: { workspaceId, story: result.story } }));
  return result?.story || null;
}
