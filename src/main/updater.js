const { app, ipcMain } = require('electron');
const { autoUpdater } = require('electron-updater');
const https = require('https');
const log = require('electron-log');

// The launch check gives up quickly: being offline or a slow GitHub must never hold the app.
const LAUNCH_CHECK_TIMEOUT_MS = 3000;
const RECHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const RELEASES_URL = 'https://github.com/Kallamo/Kallamo/releases/latest';

autoUpdater.logger = log;
autoUpdater.autoDownload = false;
// Anything downloaded in the background installs silently when the app quits.
autoUpdater.autoInstallOnAppQuit = true;

let mainWindow = null;
let splash = null;
let downloading = false;
let downloadedVersion = null;
let pendingVersion = null;
// True only while the splash waits on the download; after "Open now" it shows other stages.
let progressOnSplash = false;

const canAutoUpdate = () => app.isPackaged && (process.platform === 'win32' || Boolean(process.env.APPIMAGE));
const sendToApp = (channel, payload) => {
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
};

autoUpdater.on('download-progress', (progress) => {
  if (progressOnSplash && splash?.isOpen()) {
    splash.setStatus({ stage: 'updating', version: pendingVersion, percent: progress.percent, transferred: progress.transferred, total: progress.total });
  }
});

autoUpdater.on('update-downloaded', (info) => {
  downloading = false;
  downloadedVersion = info.version;
  log.info(`Auto-updater: Update downloaded. Version: ${info.version}`);
  sendToApp('update-downloaded', info.version);
});

autoUpdater.on('error', (err) => {
  downloading = false;
  log.error('Auto-updater: Error detected during lifecycle checks:', err);
});

function downloadInBackground(version) {
  if (downloading || downloadedVersion) return;
  downloading = true;
  pendingVersion = version;
  sendToApp('update-available', version);
  autoUpdater.downloadUpdate().catch(err => log.error('Auto-updater: Background download failed:', err));
}

async function checkInBackground() {
  if (downloading || downloadedVersion) return;
  try {
    const result = await autoUpdater.checkForUpdates();
    if (result?.isUpdateAvailable) downloadInBackground(result.updateInfo.version);
  } catch (err) {
    log.warn('Auto-updater: Background check failed:', err);
  }
}

// Runs on the splash before the database opens, so an old version never migrates data it is
// about to be replaced on. Resolves 'install' when the app is restarting into the new version.
async function runAtLaunch(splashWindow) {
  splash = splashWindow;
  if (!canAutoUpdate()) return 'open';

  splash.setStatus({ stage: 'checking' });
  const check = autoUpdater.checkForUpdates();
  let result = null;
  try {
    result = await Promise.race([check, new Promise(resolve => setTimeout(() => resolve('timeout'), LAUNCH_CHECK_TIMEOUT_MS))]);
  } catch (err) {
    log.warn('Auto-updater: Launch check failed, opening anyway:', err);
    return 'open';
  }
  if (result === 'timeout') {
    log.info('Auto-updater: Launch check is slow; it carries on in the background.');
    check.then(late => { if (late?.isUpdateAvailable) downloadInBackground(late.updateInfo.version); }).catch(() => {});
    return 'open';
  }
  if (!result?.isUpdateAvailable) return 'open';

  pendingVersion = result.updateInfo.version;
  downloading = true;
  log.info(`Auto-updater: Update available at launch. Version: ${pendingVersion}`);
  splash.setStatus({ stage: 'updating', version: pendingVersion, percent: 0 });

  const download = autoUpdater.downloadUpdate().then(() => 'downloaded', (err) => {
    log.error('Auto-updater: Download at launch failed, opening anyway:', err);
    return 'failed';
  });
  let stopSkip = null;
  const skipped = new Promise(resolve => { stopSkip = splash.onSkipUpdate(() => resolve('skipped')); });
  progressOnSplash = true;
  const outcome = await Promise.race([download, skipped]);
  progressOnSplash = false;
  stopSkip?.();

  if (outcome === 'downloaded') {
    splash.setStatus({ stage: 'restarting' });
    await new Promise(resolve => setTimeout(resolve, 700));
    // Silent: no installer window; the new version starts on its own when it is done.
    setImmediate(() => autoUpdater.quitAndInstall(true, true));
    return 'install';
  }
  if (outcome === 'skipped') log.info('Auto-updater: Opening now; the update keeps downloading in the background.');
  return 'open';
}

// The platforms electron-updater cannot update only learn that a newer release exists.
function checkGitHubRelease() {
  const options = { headers: { 'User-Agent': 'Kallamo-Updater', 'Accept': 'application/vnd.github+json' } };
  https.get('https://api.github.com/repos/Kallamo/Kallamo/releases/latest', options, (res) => {
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
        if (latestVersion && compareSemver(latestVersion, app.getVersion()) > 0) {
          log.info(`Auto-updater: Newer version available: ${latestVersion} (current: ${app.getVersion()})`);
          sendToApp('update-outdated', { version: latestVersion.replace(/^v/, ''), url: release.html_url || RELEASES_URL });
        } else {
          log.info('Auto-updater: App is up to date.');
        }
      } catch (e) {
        log.error('Auto-updater: Failed to parse GitHub releases response:', e);
      }
    });
  }).on('error', (err) => log.error('Auto-updater: Failed to fetch GitHub releases:', err));
}

// Called once the app window exists: reports anything already found, then keeps checking.
function attachWindow(win) {
  mainWindow = win;
  if (!app.isPackaged) {
    log.info('Auto-updater: Skipping update checks in development environment.');
    return;
  }
  if (!canAutoUpdate()) {
    checkGitHubRelease();
    return;
  }
  if (downloadedVersion) sendToApp('update-downloaded', downloadedVersion);
  else if (downloading && pendingVersion) sendToApp('update-available', pendingVersion);
  setInterval(checkInBackground, RECHECK_INTERVAL_MS).unref?.();
}

// Lightweight semver comparison (returns 1 if a > b, -1 if a < b, 0 if equal).
// A release outranks its own pre-releases, so 2.0.0 is newer than 2.0.0-beta.1.
function compareSemver(a, b) {
  const parse = version => {
    const [core, pre = null] = String(version).replace(/^v/, '').split('-', 2);
    return { core: core.split('.').map(part => Number(part) || 0), pre };
  };
  const pa = parse(a);
  const pb = parse(b);
  for (let i = 0; i < 3; i++) {
    const na = pa.core[i] || 0;
    const nb = pb.core[i] || 0;
    if (na > nb) return 1;
    if (na < nb) return -1;
  }
  if (pa.pre === pb.pre) return 0;
  if (pa.pre === null) return 1;
  if (pb.pre === null) return -1;
  return pa.pre.localeCompare(pb.pre, 'en', { numeric: true }) > 0 ? 1 : -1;
}

ipcMain.on('install-update', () => {
  log.info('Auto-updater IPC: quitAndInstall request received.');
  autoUpdater.quitAndInstall(true, true);
});

module.exports = { runAtLaunch, attachWindow };
