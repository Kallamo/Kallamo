import React, { useEffect, useRef, useState } from 'react';
import Button from '../../components/ui/Button';

/**
 * Holds a form's leave guard: `guard(fn)` runs fn only while nothing is unsaved,
 * otherwise it asks the bar to flash.
 */
export function useLeaveGuard(dirty) {
  const [flashKey, setFlashKey] = useState(0);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  const guard = fn => (...args) => {
    if (dirtyRef.current) {
      setFlashKey(key => key + 1);
      return false;
    }
    fn?.(...args);
    return true;
  };
  return { guard, flashKey, dirtyRef };
}

/** Floating bar for a form that waits for Save. Sits over the page it belongs to. */
export default function UnsavedChangesBar({ open, flashKey, error, saving, ready, onReset, onSave, saveTour }) {
  const [flashing, setFlashing] = useState(false);

  useEffect(() => {
    if (!flashKey) return undefined;
    setFlashing(true);
    const timer = setTimeout(() => setFlashing(false), 1300);
    return () => clearTimeout(timer);
  }, [flashKey]);

  if (!open) return null;
  return (
    <div
      key={flashKey}
      role="region"
      aria-label="Unsaved changes"
      data-ready={ready ? 'true' : 'false'}
      className={`absolute bottom-6 left-1/2 z-30 flex w-[min(36rem,calc(100%-3rem))] -translate-x-1/2 items-center gap-3 rounded-card border border-border-default bg-surface-panel/95 py-2 pl-4 pr-2 shadow-overlay backdrop-blur-md animate-in slide-in-from-bottom duration-200 ${flashing ? 'unsaved-flash' : ''}`}
    >
      <span role={error ? 'alert' : 'status'} className={`min-w-0 flex-1 truncate text-sm font-semibold ${error ? 'text-status-danger' : 'text-text-primary'}`}>
        {error || 'You have unsaved changes'}
      </span>
      <Button variant="subtle" size="sm" onClick={onReset} disabled={saving}>Reset</Button>
      <Button size="sm" data-tour={saveTour} loading={saving} onClick={onSave}>Save</Button>
    </div>
  );
}
