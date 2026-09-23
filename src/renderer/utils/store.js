import { useSyncExternalStore } from 'react';

// State that changes often lives here instead of in a context, so an update
// re-renders only the components that read it.
export function createStore(initialValue) {
  let value = initialValue;
  const listeners = new Set();
  return {
    get: () => value,
    set(next) {
      const resolved = typeof next === 'function' ? next(value) : next;
      if (Object.is(resolved, value)) return;
      value = resolved;
      listeners.forEach(listener => listener());
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    }
  };
}

export function useStore(store) {
  return useSyncExternalStore(store.subscribe, store.get, store.get);
}
