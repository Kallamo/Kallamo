const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('splash', {
  onStatus: (callback) => ipcRenderer.on('splash-status', (_event, state) => callback(state)),
  skipUpdate: () => ipcRenderer.send('splash-skip-update'),
});
