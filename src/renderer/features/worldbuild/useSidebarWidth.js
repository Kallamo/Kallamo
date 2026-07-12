import { useCallback, useEffect, useState } from 'react';

export const DEFAULT_SIDEBAR_WIDTH = 320;
const MAX_SIDEBAR_WIDTH = 448;
const MIN_DETAIL_WIDTH = 672;

export function useSidebarWidth() {
  const clampWidth = useCallback((width) => Math.max(DEFAULT_SIDEBAR_WIDTH, Math.min(MAX_SIDEBAR_WIDTH, window.innerWidth - MIN_DETAIL_WIDTH, width)), []);
  const [sidebarWidth, setSidebarWidth] = useState(DEFAULT_SIDEBAR_WIDTH);
  const updateSidebarWidth = useCallback((width) => setSidebarWidth(clampWidth(width)), [clampWidth]);

  useEffect(() => {
    const clampOnResize = () => setSidebarWidth((width) => clampWidth(width));
    window.addEventListener('resize', clampOnResize);
    return () => window.removeEventListener('resize', clampOnResize);
  }, [clampWidth]);

  const startSidebarResize = useCallback((event) => {
    event.preventDefault();
    const move = (moveEvent) => updateSidebarWidth(moveEvent.clientX);
    const stop = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', stop); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop, { once: true });
  }, [updateSidebarWidth]);

  const handleSidebarResizeKey = useCallback((event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    updateSidebarWidth(sidebarWidth + (event.key === 'ArrowRight' ? 16 : -16));
  }, [sidebarWidth, updateSidebarWidth]);

  return { sidebarWidth, updateSidebarWidth, startSidebarResize, handleSidebarResizeKey };
}
