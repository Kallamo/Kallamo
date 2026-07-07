const { app, BrowserWindow, ipcMain, protocol, session } = require('electron');
app.setName('Kallamo');
const path = require('path');
const fs = require('fs');
const http = require('http');
const { autoUpdater } = require('electron-updater');
const log = require('electron-log');

autoUpdater.logger = log;
autoUpdater.logger.transports.file.level = 'info';
log.info('Kallamo starting...');

// MIME type lookup for local file serving
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

// Extensions the app-file protocol is allowed to serve. This is the set of file types the app
// actually renders/previews (images, media, PDFs, and text/code shown in FilePreviewModal).
// Anything outside this list (e.g. .db, .sqlite, .env, .pem, key files, executables, or
// extension-less files) is refused, so a compromised renderer cannot read sensitive files
// off disk via this protocol.
const SERVABLE_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.bmp', '.ico',
  '.pdf', '.mp4', '.webm', '.mov', '.ogg', '.mp3', '.wav',
  '.txt', '.md', '.json', '.js', '.jsx', '.ts', '.tsx', '.css', '.html',
  '.py', '.rs', '.go', '.sh', '.bat', '.yml', '.yaml', '.sql', '.xml',
]);

protocol.registerSchemesAsPrivileged([
  { scheme: 'app-file', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }
]);

require('./main/database');
require('./main/ipc-handlers');

function isViteDevRunning() {
  return new Promise((resolve) => {
    const req = http.get('http://localhost:5173', () => {
      resolve(true);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(800, () => { req.destroy(); resolve(false); });
  });
}

function createWindow () {
  const mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
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

  mainWindow.maximize();

  // Intercept and open external web links in the default browser
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

  // Smart dev/prod loading: try Vite dev server first, fallback to built dist
  isViteDevRunning().then((devRunning) => {
    if (devRunning) {
      console.log('[Main] Loading from Vite dev server...');
      mainWindow.loadURL('http://localhost:5173');
      mainWindow.webContents.openDevTools();
    } else {
      const distIndex = path.join(__dirname, '../dist/index.html');
      if (fs.existsSync(distIndex)) {
        console.log('[Main] Loading from built dist/index.html...');
        mainWindow.loadFile(distIndex);
      } else {
        console.error('[Main] ERROR: No Vite dev server and no dist/index.html found!');
      }
    }

    setupAutoUpdater(mainWindow);
  });

  return mainWindow;
}

app.whenReady().then(() => {
  // Handle custom file protocol - reads files directly from filesystem
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

  // Content-Security-Policy. Applied only in packaged builds, in development the Vite dev
  // server needs inline scripts, eval and a websocket connection for HMR, which a strict CSP
  // would block. All runtime assets (fonts, highlight.js themes, JS bundle) are self-hosted,
  // so production can lock down to the app's own origin. connect-src is intentionally tight:
  // all external AI API calls happen in the main (Node) process, not the renderer, so even a
  // compromised renderer cannot exfiltrate data to an arbitrary server.
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

// --- WINDOW CONTROL IPC HANDLERS ---
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

// --- AUTO-UPDATER LIFECYCLE ---

// Lightweight semver comparison (returns 1 if a > b, -1 if a < b, 0 if equal)
function compareSemver(a, b) {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const na = pa[i] || 0;
    const nb = pb[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  return 0;
}

function setupAutoUpdater(mainWindow) {
  if (!app.isPackaged) {
    log.info('Auto-updater: Skipping update checks in development environment.');
    return;
  }

  // Determine if electron-updater can handle this platform/target
  const platform = process.platform;
  const isAppImage = !!process.env.APPIMAGE;
  const canAutoUpdate = platform === 'win32' || isAppImage;

  if (canAutoUpdate) {
    log.info('Auto-updater: Checking for updates via electron-updater...');
    autoUpdater.checkForUpdatesAndNotify();

    autoUpdater.on('update-available', (info) => {
      log.info(`Auto-updater: Update available. Version: ${info.version}`);
      mainWindow.webContents.send('update-available', info.version);
    });

    autoUpdater.on('update-downloaded', (info) => {
      log.info(`Auto-updater: Update downloaded. Version: ${info.version}`);
      mainWindow.webContents.send('update-downloaded', info.version);
    });

    autoUpdater.on('error', (err) => {
      log.error('Auto-updater: Error detected during lifecycle checks:', err);
    });
  } else {
    // macOS / Linux .deb, query the GitHub Releases API for the latest version
    log.info('Auto-updater: Platform does not support auto-update. Checking GitHub releases...');

    const https = require('https');
    const latestUrl = 'https://api.github.com/repos/Kallamo/Kallamo/releases/latest';
    const options = {
      headers: {
        'User-Agent': 'Kallamo-Updater',
        'Accept': 'application/vnd.github+json'
      }
    };

    https.get(latestUrl, options, (res) => {
      if (res.statusCode !== 200) {
        log.error(`Auto-updater: GitHub releases API returned HTTP ${res.statusCode}.`);
        res.resume();
        return;
      }

      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const release = JSON.parse(data);
          const latestVersion = release.tag_name;
          const currentVersion = app.getVersion();
          if (latestVersion && compareSemver(latestVersion, currentVersion) > 0) {
            log.info(`Auto-updater: Newer version available: ${latestVersion} (current: ${currentVersion})`);
            mainWindow.webContents.send('update-outdated', {
              version: latestVersion.replace(/^v/, ''),
              url: release.html_url || 'https://github.com/Kallamo/Kallamo/releases/latest'
            });
          } else {
            log.info('Auto-updater: App is up to date.');
          }
        } catch (e) {
          log.error('Auto-updater: Failed to parse GitHub releases response:', e);
        }
      });
    }).on('error', (err) => {
      log.error('Auto-updater: Failed to fetch GitHub releases:', err);
    });
  }
}

ipcMain.on('install-update', () => {
  log.info('Auto-updater IPC: quitAndInstall request received.');
  autoUpdater.quitAndInstall();
});
