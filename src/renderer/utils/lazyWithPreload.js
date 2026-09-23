import { lazy } from 'react';

// A lazy component whose chunk can be fetched ahead of time (on idle or on hover), so the
// first switch to it does not wait for the module to load and compile.
export function lazyWithPreload(factory) {
  let promise = null;
  const load = () => {
    if (!promise) promise = factory();
    return promise;
  };
  const Component = lazy(load);
  Component.preload = load;
  return Component;
}

const whenIdle = callback => (typeof window.requestIdleCallback === 'function'
  ? window.requestIdleCallback(callback, { timeout: 3000 })
  : setTimeout(callback, 500));

// One chunk per idle period, so compiling them never lands on a frame the user needs.
export function preloadWhenIdle(components) {
  const queue = [...components];
  const next = () => {
    const component = queue.shift();
    if (!component) return;
    whenIdle(() => component.preload().catch(() => undefined).finally(next));
  };
  next();
}
