import { useEffect, useState } from 'react';
import { DEFAULT_SIDEBAR_WIDTH } from './useSidebarWidth';

const NAVIGATION_SCOPE = 'worldbuild-navigation';

export function useWorldbuildNavigationState({ workspaceId, electronAPI, selectedEntityId, sidebarWidth, updateSidebarWidth }) {
  const [expandedLocations, setExpandedLocations] = useState({});
  const [restoredEntityId, setRestoredEntityId] = useState(null);
  const [isNavigationStateReady, setNavigationStateReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setNavigationStateReady(false);
    setRestoredEntityId(null);
    setExpandedLocations({});

    if (!workspaceId) return undefined;

    electronAPI.getWorkspaceUiState(workspaceId, NAVIGATION_SCOPE)
      .then((response) => {
        if (cancelled) return;
        const state = response?.value || {};
        setExpandedLocations(state.expandedLocations || {});
        setRestoredEntityId(state.selectedEntityId || null);
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
      selectedEntityId,
      sidebarWidth,
    }).catch(() => {});
  }, [isNavigationStateReady, workspaceId, expandedLocations, selectedEntityId, sidebarWidth, electronAPI]);

  return { expandedLocations, setExpandedLocations, restoredEntityId, isNavigationStateReady };
}
