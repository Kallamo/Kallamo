const { BrowserWindow, ipcMain } = require('electron');
const path = require('path');

const MIN_VISIBLE_MS = 1500;

let win = null;
let shownAt = 0;
let lastState = { stage: 'opening' };
const skipListeners = new Set();

ipcMain.on('splash-skip-update', () => {
  for (const listener of skipListeners) listener();
  skipListeners.clear();
});

function open() {
  win = new BrowserWindow({
    width: 320,
    height: 360,
    // Opaque rather than transparent: a layered window may stop repainting while the
    // database work holds the main thread. Windows 11 rounds the corners itself.
    frame: false,
    backgroundColor: '#011419',
    roundedCorners: true,
    resizable: false,
    maximizable: false,
    fullscreenable: false,
    center: true,
    show: false,
    title: 'Kallamo',
    icon: path.join(__dirname, '../assets/icon.png'),
    webPreferences: {
      preload: path.join(__dirname, '../splash/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false,
    },
  });
  win.on('closed', () => { win = null; });
  win.webContents.on('did-finish-load', () => win?.webContents.send('splash-status', lastState));
  win.loadFile(path.join(__dirname, '../splash/splash.html'));
  return new Promise(resolve => {
    win.once('ready-to-show', () => {
      win.show();
      shownAt = Date.now();
      resolve();
    });
  });
}

function setStatus(state) {
  lastState = state;
  if (win && !win.isDestroyed()) win.webContents.send('splash-status', state);
}

function onSkipUpdate(listener) {
  skipListeners.add(listener);
  return () => skipListeners.delete(listener);
}

function isOpen() {
  return Boolean(win && !win.isDestroyed());
}

async function close() {
  const wait = MIN_VISIBLE_MS - (Date.now() - shownAt);
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait));
  if (win && !win.isDestroyed()) win.destroy();
  win = null;
}

module.exports = { open, setStatus, onSkipUpdate, isOpen, close };
