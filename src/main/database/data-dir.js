const os = require('os');
const path = require('path');

const appDataPath = () => process.env.APPDATA
  || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), '.local', 'share'));

const dataDirectory = () => path.join(appDataPath(), 'Kallamo');

module.exports = { appDataPath, dataDirectory };
