import { Profiler, createElement } from 'react';

// Opt-in timing for navigation and rendering. Enable from the DevTools console with
// localStorage.setItem('kallamo.perf', '1') and reload; read results with
// window.kallamoPerf.summary().
const STORAGE_KEY = 'kallamo.perf';
const SLOW_COMMIT_MS = 8;
const MAX_SAMPLES = 200;

let enabled = false;
try {
  enabled = window.localStorage?.getItem(STORAGE_KEY) === '1';
} catch {
  enabled = false;
}

const starts = new Map();
const samples = new Map();

function record(name, duration) {
  const list = samples.get(name) || [];
  list.push(duration);
  if (list.length > MAX_SAMPLES) list.shift();
  samples.set(name, list);
}

function percentile(sorted, fraction) {
  if (!sorted.length) return 0;
  const index = Math.min(sorted.length - 1, Math.ceil(fraction * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

export const perfEnabled = () => enabled;

export function perfStart(name) {
  if (!enabled) return;
  starts.set(name, performance.now());
}

export function perfEnd(name) {
  if (!enabled || !starts.has(name)) return;
  const duration = performance.now() - starts.get(name);
  starts.delete(name);
  record(name, duration);
  console.info(`[perf] ${name}: ${duration.toFixed(1)}ms`);
}

// Ends the measure once the frame that shows the change has been painted.
export function perfEndAfterPaint(name) {
  if (!enabled || !starts.has(name)) return;
  requestAnimationFrame(() => setTimeout(() => perfEnd(name), 0));
}

function onRender(id, phase, actualDuration) {
  const name = `render:${id}:${phase}`;
  record(name, actualDuration);
  if (actualDuration >= SLOW_COMMIT_MS) console.info(`[perf] ${name}: ${actualDuration.toFixed(1)}ms`);
}

export function PerfProfiler({ id, children }) {
  if (!enabled) return children;
  return createElement(Profiler, { id, onRender }, children);
}

if (enabled && typeof window !== 'undefined') {
  window.kallamoPerf = {
    summary() {
      const rows = {};
      for (const [name, list] of samples) {
        const sorted = [...list].sort((a, b) => a - b);
        rows[name] = {
          count: sorted.length,
          p50: Number(percentile(sorted, 0.5).toFixed(1)),
          p95: Number(percentile(sorted, 0.95).toFixed(1)),
          max: Number(sorted[sorted.length - 1].toFixed(1))
        };
      }
      console.table(rows);
      return rows;
    },
    reset() {
      samples.clear();
      starts.clear();
    }
  };
}
