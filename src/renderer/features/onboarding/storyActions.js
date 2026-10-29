// Starts the onboarding story as the chosen character and brings the chat into view with its opening.
export async function beginStory(app, workspaceId, entityId) {
  const result = await app.electronAPI.beginOnboardingStory(workspaceId, entityId);
  if (!result?.success) {
    app.showToast(result?.error || 'The story could not start.', 'error');
    return null;
  }
  window.dispatchEvent(new CustomEvent('roleplay-state-change', { detail: { workspaceId } }));
  window.dispatchEvent(new CustomEvent('onboarding-story-change', { detail: { workspaceId, story: result.story } }));
  app.setActiveWorkspaceView('chat');
  revealOpening(app, workspaceId, result.message);
  return result;
}

// The opening is already saved; it arrives through the same stream display as a live reply,
// and the saved message takes its place once the last of it is shown.
async function revealOpening(app, workspaceId, message) {
  const text = String(message?.content || '');
  const store = app.streamDisplayStore;
  if (!text || !store) {
    await app.refreshChats(workspaceId);
    return;
  }
  app.clearStreamDisplay();
  app.setIsGenerating(true);
  app.setGenerationProgress({ chatId: workspaceId, step: 1, totalSteps: 1, profileName: message.aiName, status: 'Writing' });
  app.enqueueStreamDisplay({ contentDelta: text });
  await new Promise(resolve => {
    // A stop or a workspace switch clears the display; that ends the reveal too.
    const done = () => { unsubscribe(); clearTimeout(cap); resolve(); };
    const unsubscribe = store.subscribe(() => {
      const shown = store.get().content.length;
      if (shown >= text.length || shown === 0) done();
    });
    const cap = setTimeout(done, 20000);
    if (store.get().content.length >= text.length) done();
  });
  await new Promise(resolve => setTimeout(resolve, 250));
  await app.refreshChats(workspaceId);
  app.setIsGenerating(false);
  app.setGenerationProgress(null);
}

export async function setStoryStage(app, workspaceId, stage) {
  const result = await app.electronAPI.setOnboardingStage(workspaceId, stage);
  if (result?.success) window.dispatchEvent(new CustomEvent('onboarding-story-change', { detail: { workspaceId, story: result.story } }));
  return result?.story || null;
}
