import { useEffect, useState } from 'react';
import { getCachedUiState, saveUiState } from '../chat/workspace-presentation';

const NAVIGATION_SCOPE = 'worldbuild-navigation';

// Which places are expanded, kept per workspace across restarts. It is preloaded when the
// workspace opens, so the tree mounts already expanded. Which sheet was open belongs to the
// visit instead (see worldbuildViewCache); the sidebar width lives in the app layout.
export function useWorldbuildNavigationState({ workspaceId, electronAPI }) {
  const [expandedLocations, setExpandedLocations] = useState(() => getCachedUiState(workspaceId, NAVIGATION_SCOPE)?.expandedLocations || {});
  const [isNavigationStateReady, setNavigationStateReady] = useState(() => getCachedUiState(workspaceId, NAVIGATION_SCOPE) !== undefined);

  // Only when the preload missed: read late rather than overwrite what was saved.
  useEffect(() => {
    if (isNavigationStateReady || !workspaceId) return undefined;
    let cancelled = false;
    electronAPI.getWorkspaceUiState(workspaceId, NAVIGATION_SCOPE)
      .then((response) => { if (!cancelled) setExpandedLocations(response?.value?.expandedLocations || {}); })
      .catch(() => {})
      .finally(() => { if (!cancelled) setNavigationStateReady(true); });
    return () => { cancelled = true; };
  }, [workspaceId, electronAPI, isNavigationStateReady]);

  useEffect(() => {
    if (!isNavigationStateReady || !workspaceId) return;
    const saved = getCachedUiState(workspaceId, NAVIGATION_SCOPE);
    if (saved?.expandedLocations === expandedLocations) return;
    saveUiState(electronAPI, workspaceId, NAVIGATION_SCOPE, { ...saved, expandedLocations });
  }, [isNavigationStateReady, workspaceId, expandedLocations, electronAPI]);

  return { expandedLocations, setExpandedLocations, isNavigationStateReady };
}
