const { app, BrowserWindow, ipcMain, protocol, session } = require('electron');
app.setName('Kallamo');
const path = require('path');
const fs = require('fs');
const http = require('http');
const log = require('electron-log');

log.transports.file.level = 'info';
log.info('Kallamo starting...');

const MIME_TYPES = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.bmp': 'image/bmp',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.json': 'application/json',
  '.txt': 'text/plain',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'application/javascript',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
};

// Only types the app renders are served. Anything else (.db, .env, keys) is refused,
// so a compromised renderer cannot read sensitive files.
const SERVABLE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico',
  '.pdf', '.mp4', '.webm', '.mov', '.ogg', '.mp3', '.wav',
  '.txt', '.md', '.json', '.js', '.jsx', '.ts', '.tsx', '.css', '.html',
  '.py', '.rs', '.go', '.sh', '.bat', '.yml', '.yaml', '.sql', '.xml',
]);

protocol.registerSchemesAsPrivileged([
  { scheme: 'app-file', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

// Taken before the database loads: a second process would back up and migrate the same file.
if (!app.requestSingleInstanceLock()) {
  log.info('Kallamo is already running; handing over to that window.');
  process.exit(0);
}

app.on('second-instance', () => {
  const win = BrowserWindow.getAllWindows().find(w => !w.isDestroyed() && (w.isVisible() || w.isMinimized()));
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
});

require('./main/perf-monitor').install();
const splash = require('./main/splash');
const updater = require('./main/updater');

// A file, not the DB: it is read before the window exists and must never block startup.
const WINDOW_STATE_FILE = () => path.join(app.getPath('userData'), 'window-state.json');

function readWindowState() {
  try {
    const raw = fs.readFileSync(WINDOW_STATE_FILE(), 'utf-8');
    const state = JSON.parse(raw);
    if (!state || typeof state !== 'object') return null;
    const width = Number(state.width);
    const height = Number(state.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 600 || height < 400) return null;
    const x = Number.isFinite(Number(state.x)) ? Number(state.x) : undefined;
    const y = Number.isFinite(Number(state.y)) ? Number(state.y) : undefined;
    return { width, height, x, y, isMaximized: Boolean(state.isMaximized) };
  } catch (e) {
    return null;
  }
}

function saveWindowState(win) {
  try {
    if (!win || win.isDestroyed()) return;
    // getNormalBounds reports the restored size even while maximized, so a maximized
    // window still remembers something sensible to un-maximize back into.
    const bounds = win.getNormalBounds();
    fs.writeFileSync(
      WINDOW_STATE_FILE(),
      JSON.stringify({ ...bounds, isMaximized: win.isMaximized() }),
      'utf-8'
    );
  } catch (e) {
    log.warn('Could not save window state:', e);
  }
}

function isViteDevRunning() {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:5173', () => {
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(800, () => { req.destroy(); resolve(false); });
  });
}

// The version that last opened the data; a different one means migrations are about to run.
const LAST_VERSION_FILE = () => path.join(app.getPath('userData'), 'last-version.json');

function openedByNewVersion() {
  try {
    return JSON.parse(fs.readFileSync(LAST_VERSION_FILE(), 'utf-8')).version !== app.getVersion();
  } catch (e) {
    return false;
  }
}

function rememberVersion() {
  try {
    fs.writeFileSync(LAST_VERSION_FILE(), JSON.stringify({ version: app.getVersion() }), 'utf-8');
  } catch (e) {
    log.warn('Could not record the app version:', e);
  }
}

// Built hidden and shown once its data is on screen, so it appears ready, in one go.
const REVEAL_FALLBACK_MS = 20000;

function createWindow () {
  const savedState = readWindowState();
  const mainWindow = new BrowserWindow({
    show: false,
    width: savedState?.width ?? 1200,
    height: savedState?.height ?? 800,
    x: savedState?.x,
    y: savedState?.y,
    frame: false,
    backgroundColor: '#011419',
    icon: path.join(__dirname, 'assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      devTools: !app.isPackaged,
      spellcheck: false
    }
  });

  let revealed = false;
  const reveal = async () => {
    if (revealed || mainWindow.isDestroyed()) return;
    revealed = true;
    await splash.close();
    if (mainWindow.isDestroyed()) return;
    // First launch has no saved state, so it opens maximized.
    if (!savedState || savedState.isMaximized) mainWindow.maximize();
    else mainWindow.show();
    mainWindow.focus();
  };
  const onAppReady = (event) => { if (event.sender === mainWindow.webContents) reveal(); };
  ipcMain.on('app-ready', onAppReady);
  mainWindow.on('closed', () => ipcMain.off('app-ready', onAppReady));
  mainWindow.webContents.once('did-finish-load', () => setTimeout(reveal, REVEAL_FALLBACK_MS));

  let saveStateTimer = null;
  const scheduleSaveWindowState = () => {
    clearTimeout(saveStateTimer);
    saveStateTimer = setTimeout(() => saveWindowState(mainWindow), 400);
  };
  mainWindow.on('resize', scheduleSaveWindowState);
  mainWindow.on('move', scheduleSaveWindowState);
  mainWindow.on('maximize', scheduleSaveWindowState);
  mainWindow.on('unmaximize', scheduleSaveWindowState);
  mainWindow.on('close', () => {
    clearTimeout(saveStateTimer);
    saveWindowState(mainWindow);
  });

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      require('electron').shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (url.startsWith('http:') || url.startsWith('https:')) {
      event.preventDefault();
      require('electron').shell.openExternal(url);
    }
  });

  const loadBuiltRenderer = () => {
    const distIndex = path.join(__dirname, '../dist/index.html');
    if (fs.existsSync(distIndex)) {
      console.log('[Main] Loading from built dist/index.html...');
      mainWindow.loadFile(distIndex);
    } else {
      console.error('[Main] ERROR: No Vite dev server and no dist/index.html found!');
    }
  };

  if (app.isPackaged) {
    loadBuiltRenderer();
  } else {
    isViteDevRunning().then((devRunning) => {
      if (devRunning) {
        console.log('[Main] Loading from Vite dev server...');
        mainWindow.loadURL('http://localhost:5173');
        mainWindow.webContents.openDevTools();
      } else {
        loadBuiltRenderer();
      }
    });
  }

  updater.attachWindow(mainWindow);

  return mainWindow;
}

app.whenReady().then(async () => {
  await splash.open();
  if (await updater.runAtLaunch(splash) === 'install') return;

  splash.setStatus({ stage: openedByNewVersion() ? 'migrating' : 'opening' });
  // One beat so the status paints before the database work, which holds this thread.
  await new Promise(resolve => setTimeout(resolve, 60));
  require('./main/database');
  require('./main/ipc-handlers');
  rememberVersion();
  splash.setStatus({ stage: 'opening' });

  try {
    require('./main/workflow-runner').markInterruptedSummaries();
  } catch (e) {
    log.warn('Could not mark interrupted summaries:', e);
  }
  try {
    const result = require('./main/features/world-index/name-tags').migrateNameTags(require('./main/database'));
    if (result) log.info(`Tagged ${result.rows} passage(s) by entity name across ${result.workspaces} workspace(s).`);
  } catch (e) {
    log.warn('Could not tag existing passages by entity name:', e);
  }

  protocol.handle('app-file', (request) => {
    try {
      let rawPath = decodeURIComponent(request.url);

      rawPath = rawPath.replace(/^app-file:\/{2,3}/i, '');

      if (/^[a-zA-Z]\//.test(rawPath)) {
        rawPath = rawPath[0] + ':' + rawPath.substring(1);
      } else if (/^\/[a-zA-Z]\//.test(rawPath)) {
        rawPath = rawPath[1] + ':' + rawPath.substring(2);
      }

      const filePath = path.normalize(rawPath);

      const ext = path.extname(filePath).toLowerCase();
      if (!SERVABLE_EXTENSIONS.has(ext)) {
        console.warn(`[app-file] Refused to serve disallowed file type: ${filePath}`);
        return new Response('Forbidden file type', { status: 403 });
      }

      let stats;
      try {
        stats = fs.statSync(filePath);
      } catch {
        console.error(`[app-file] File not found: ${filePath}`);
        return new Response('File not found', { status: 404 });
      }
      if (!stats.isFile()) {
        return new Response('Not a file', { status: 403 });
      }

      const buffer = fs.readFileSync(filePath);
      const mimeType = MIME_TYPES[ext] || 'application/octet-stream';

      console.log(`[app-file] Serving: ${filePath} (${mimeType}, ${buffer.length} bytes)`);

      return new Response(buffer, {
        status: 200,
        headers: { 'Content-Type': mimeType }
      });
    } catch (e) {
      console.error("[app-file] Error:", e);
      return new Response('Error loading local resource', { status: 500 });
    }
  });

  // Packaged builds only: Vite dev needs inline scripts, eval and an HMR websocket.
  // connect-src stays tight because every AI call happens in the main process.
  if (app.isPackaged) {
    const csp = [
      "default-src 'self'",
      "script-src 'self'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob: app-file:",
      "media-src 'self' app-file:",
      "object-src 'self' app-file:",
      "font-src 'self' data:",
      "connect-src 'self' app-file:",
      "base-uri 'none'",
      "form-action 'none'",
    ].join('; ');

    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: {
          ...details.responseHeaders,
          'Content-Security-Policy': [csp],
        },
      });
    });
  }

  // Auto-grant the local-fonts permission so the Writing Desk can enumerate the user's
  // installed fonts via queryLocalFonts(). Everything else stays denied by default.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === 'local-fonts');
  });
  session.defaultSession.setPermissionCheckHandler((webContents, permission) => {
    return permission === 'local-fonts';
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

ipcMain.on('window-minimize', (event) => {
  BrowserWindow.fromWebContents(event.sender).minimize();
});

ipcMain.on('window-maximize', (event) => {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (win.isMaximized()) {
    win.unmaximize();
  } else {
    win.maximize();
  }
});

ipcMain.on('window-close', (event) => {
  BrowserWindow.fromWebContents(event.sender).close();
});

ipcMain.handle('get-app-version', () => app.getVersion());

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
