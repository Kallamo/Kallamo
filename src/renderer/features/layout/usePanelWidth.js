import { useCallback, useEffect, useReducer, useRef, useState } from 'react';
import { PANELS, clampPanelWidth, panelWidth } from './layout-model';
import { resetPanelWidth, setPanelWidth, useLayout } from './layout-store';

const KEY_STEP = 16;

// Width of a side panel from the saved layout, limited on every render by the room the window
// leaves for the center column. `side` is where the panel sits; `reserved` is what its
// neighbours already take. The drag stays local and is saved once, on release.
export function usePanelWidth(id, { side, centerMin, reserved = 0 }) {
  const layout = useLayout();
  const [dragWidth, setDragWidth] = useState(null);
  const [, refresh] = useReducer(count => count + 1, 0);
  const dragRef = useRef(null);

  useEffect(() => {
    window.addEventListener('resize', refresh);
    return () => window.removeEventListener('resize', refresh);
  }, []);

  const available = () => window.innerWidth - centerMin - reserved;
  const clamp = value => clampPanelWidth(id, value, available());
  const width = clamp(dragWidth ?? panelWidth(layout, id));
  const grows = side === 'left' ? 1 : -1;

  const onPointerDown = useCallback((event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    dragRef.current = { startX: event.clientX, startWidth: width, width };
    setDragWidth(width);
    const move = (moveEvent) => {
      const next = clamp(dragRef.current.startWidth + (moveEvent.clientX - dragRef.current.startX) * grows);
      dragRef.current.width = next;
      setDragWidth(next);
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', stop);
      window.removeEventListener('pointercancel', stop);
      if (dragRef.current.width !== dragRef.current.startWidth) setPanelWidth(id, dragRef.current.width);
      dragRef.current = null;
      setDragWidth(null);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', stop);
    window.addEventListener('pointercancel', stop);
  }, [width, grows, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const onKeyDown = useCallback((event) => {
    const spec = PANELS[id];
    const next = {
      ArrowLeft: width - KEY_STEP * grows,
      ArrowRight: width + KEY_STEP * grows,
      Home: spec.min,
      End: spec.max,
    }[event.key];
    if (next === undefined) return;
    event.preventDefault();
    setPanelWidth(id, clamp(next));
  }, [width, grows, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const onDoubleClick = useCallback(() => resetPanelWidth(id), [id]);

  return {
    width,
    handle: {
      edge: side === 'left' ? 'right' : 'left',
      value: width,
      min: PANELS[id].min,
      max: Math.max(PANELS[id].min, Math.min(PANELS[id].max, available())),
      dragging: dragWidth !== null,
      onPointerDown,
      onKeyDown,
      onDoubleClick,
    },
  };
}
