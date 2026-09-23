import { useCallback, useLayoutEffect, useRef } from 'react';

// A function whose identity never changes but always runs the latest closure,
// so memoized children are not re-rendered just because a handler was redefined.
export function useStableCallback(callback) {
  const callbackRef = useRef(callback);
  useLayoutEffect(() => {
    callbackRef.current = callback;
  });
  return useCallback((...args) => callbackRef.current?.(...args), []);
}
