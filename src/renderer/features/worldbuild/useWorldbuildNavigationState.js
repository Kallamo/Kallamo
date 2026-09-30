import { useEffect, useState } from 'react';
import { DEFAULT_SIDEBAR_WIDTH } from './useSidebarWidth';

const NAVIGATION_SCOPE = 'worldbuild-navigation';

// Layout the person chose, kept across restarts: the sidebar width and which places are expanded.
// Which sheet was open belongs to the visit instead (see worldbuildViewCache).
export function useWorldbuildNavigationState({ workspaceId, electronAPI, sidebarWidth, updateSidebarWidth }) {
  const [expandedLocations, setExpandedLocations] = useState({});
  const [isNavigationStateReady, setNavigationStateReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setNavigationStateReady(false);
    setExpandedLocations({});

    if (!workspaceId) return undefined;

    electronAPI.getWorkspaceUiState(workspaceId, NAVIGATION_SCOPE)
      .then((response) => {
        if (cancelled) return;
        const state = response?.value || {};
        setExpandedLocations(state.expandedLocations || {});
        updateSidebarWidth(Number(state.sidebarWidth) || DEFAULT_SIDEBAR_WIDTH);
      })
      .catch(() => {})
      .finally(() => { if (!cancelled) setNavigationStateReady(true); });

    return () => { cancelled = true; };
  }, [workspaceId, electronAPI, updateSidebarWidth]);

  useEffect(() => {
    if (!isNavigationStateReady || !workspaceId) return;
    electronAPI.setWorkspaceUiState(workspaceId, NAVIGATION_SCOPE, {
      expandedLocations,
      sidebarWidth,
    }).catch(() => {});
  }, [isNavigationStateReady, workspaceId, expandedLocations, sidebarWidth, electronAPI]);

  return { expandedLocations, setExpandedLocations, isNavigationStateReady };
}
