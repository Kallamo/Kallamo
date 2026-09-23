const { ipcMain } = require('electron');
const { monitorEventLoopDelay, performance } = require('perf_hooks');
const log = require('electron-log');

// Opt-in with KALLAMO_PERF=1. Everything the renderer asks for is served on this one
// thread, so a slow handler or a blocked event loop shows up as UI lag; this logs both.
const SLOW_HANDLER_MS = 50;
const LOOP_REPORT_INTERVAL_MS = 10000;
const LOOP_STALL_MS = 100;

function install() {
  if (process.env.KALLAMO_PERF !== '1') return;

  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, handler) => handle(channel, async (...args) => {
    const started = performance.now();
    try {
      return await handler(...args);
    } finally {
      const elapsed = performance.now() - started;
      if (elapsed >= SLOW_HANDLER_MS) log.info(`[perf] ipc ${channel}: ${elapsed.toFixed(1)}ms`);
    }
  });

  const loopDelay = monitorEventLoopDelay({ resolution: 20 });
  loopDelay.enable();
  const timer = setInterval(() => {
    const p99 = loopDelay.percentile(99) / 1e6;
    const max = loopDelay.max / 1e6;
    if (max >= LOOP_STALL_MS) {
      log.info(`[perf] main event loop: p99 ${p99.toFixed(1)}ms, max ${max.toFixed(1)}ms over the last ${LOOP_REPORT_INTERVAL_MS / 1000}s`);
    }
    loopDelay.reset();
  }, LOOP_REPORT_INTERVAL_MS);
  timer.unref();
  log.info('[perf] main-process timing enabled');
}

module.exports = { install };
