// What the chat column looks like (roleplay layout, message frames) is read before the
// workspace is shown, so the first paint already has its final width and heights and the
// scroll position does not shift when these answers arrive.
const PRELOAD_TIMEOUT_MS = 400;

const presentationCache = new Map();
const backgroundCache = new Map();
const preloadedFrames = new Map();

const withTimeout = promise => Promise.race([
  promise,
  new Promise(resolve => setTimeout(() => resolve(undefined), PRELOAD_TIMEOUT_MS))
]);

export const getCachedPresentation = workspaceId => presentationCache.get(workspaceId);
export const setCachedPresentation = (workspaceId, presentation) => presentationCache.set(workspaceId, presentation);

export const getCachedBackground = workspaceId => backgroundCache.get(workspaceId);
export function setCachedBackground(workspaceId, background) {
  if (background) backgroundCache.set(workspaceId, background);
  else backgroundCache.delete(workspaceId);
}

export async function fetchPresentation(api, workspaceId) {
  const [modeResult, uiState] = await Promise.all([
    api.getWorkspaceExperienceMode?.(workspaceId),
    api.getWorkspaceUiState?.(workspaceId, 'roleplay-quick-panel')
  ]);
  const presentation = {
    mode: modeResult?.mode === 'roleplay',
    collapsed: typeof uiState?.value?.collapsed === 'boolean' ? uiState.value.collapsed : false
  };
  presentationCache.set(workspaceId, presentation);
  return presentation;
}

export async function preloadPresentation(api, workspaceId) {
  if (presentationCache.has(workspaceId)) return;
  await withTimeout(fetchPresentation(api, workspaceId).catch(() => undefined));
}

// Frames for the first page seed the workspace's initial state. Every opening goes through
// this preload, which drops the previous result first, so a read never sees another visit.
export async function preloadMessageFrames(api, workspaceId, messages) {
  preloadedFrames.delete(workspaceId);
  const originIds = (messages || []).filter(message => message.role !== 'user').map(message => message.id);
  if (!originIds.length || !api.getRoleplayMessageFrames) return;
  const result = await withTimeout(api.getRoleplayMessageFrames(workspaceId, originIds).catch(() => undefined));
  if (!result?.success) return;
  preloadedFrames.set(workspaceId, {
    originIds,
    frames: Object.fromEntries((result.frames || []).map(frame => [frame.originId, frame]))
  });
}

export const getPreloadedFrames = workspaceId => preloadedFrames.get(workspaceId) || null;

// Saved per-workspace layout (expanded places, collapsed sections) read before the workspace
// shows, so the views mount with it. undefined = not read yet, null = nothing saved.
const UI_STATE_SCOPES = ['worldbuild-navigation', 'memory-sections', 'writing-desk'];
const uiStateCache = new Map();
const uiStateKey = (workspaceId, scope) => `${workspaceId}\u0000${scope}`;

export const getCachedUiState = (workspaceId, scope) => uiStateCache.get(uiStateKey(workspaceId, scope));

export function saveUiState(api, workspaceId, scope, value) {
  uiStateCache.set(uiStateKey(workspaceId, scope), value);
  return api.setWorkspaceUiState?.(workspaceId, scope, value)?.catch?.(() => undefined);
}

// A read that misses the timeout still lands in the cache for the next visit.
export async function preloadUiState(api, workspaceId, onRead) {
  const reads = UI_STATE_SCOPES
    .filter(scope => getCachedUiState(workspaceId, scope) === undefined)
    .map(scope => Promise.resolve(api.getWorkspaceUiState?.(workspaceId, scope))
      .then(result => {
        if (!result?.success) return;
        uiStateCache.set(uiStateKey(workspaceId, scope), result.value ?? null);
        onRead?.(scope, result.value ?? null);
      })
      .catch(() => undefined));
  await withTimeout(Promise.all(reads));
}
