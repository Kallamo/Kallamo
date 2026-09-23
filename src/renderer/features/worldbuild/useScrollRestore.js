import { useEffect, useRef } from 'react';

const GIVE_UP_MS = 2000;
const USER_SCROLL = ['wheel', 'touchstart', 'pointerdown', 'keydown'];

// Returns a container to a saved offset once `ready`. Content often arrives after the
// container mounts, so it retries as the children grow, and stops when the reader scrolls.
// A new `scope` (another workspace) starts over with its own offset.
export function useScrollRestore(ref, { scope, offset, ready }) {
  const pending = useRef(offset);
  const startedAt = useRef(0);
  const currentScope = useRef(scope);
  if (currentScope.current !== scope) {
    currentScope.current = scope;
    pending.current = offset;
    startedAt.current = 0;
  }

  useEffect(() => {
    const element = ref.current;
    if (!ready || !element || !pending.current) return undefined;
    if (!startedAt.current) startedAt.current = Date.now();
    const remaining = GIVE_UP_MS - (Date.now() - startedAt.current);
    if (remaining <= 0) { pending.current = 0; return undefined; }
    const target = pending.current;
    const observer = new ResizeObserver(() => apply());
    const detach = () => {
      observer.disconnect();
      USER_SCROLL.forEach(type => element.removeEventListener(type, finish));
    };
    function finish() {
      pending.current = 0;
      detach();
    }
    function apply() {
      element.scrollTop = target;
      if (Math.abs(element.scrollTop - target) < 2) finish();
    }
    for (const child of element.children) observer.observe(child);
    USER_SCROLL.forEach(type => element.addEventListener(type, finish, { passive: true }));
    const timer = setTimeout(finish, remaining);
    apply();
    return () => { clearTimeout(timer); detach(); };
  }, [ref, ready, scope]);
}
