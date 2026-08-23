// Which compiled better-sqlite3 binary belongs to the runtime that is asking.
//
// The addon is built against a V8 ABI, and Electron and Node do not share one:
// a binary that runs the app cannot be loaded by the test runner, and the other
// way round. Rebuilding on every switch made the suite unrunnable half the time,
// so both binaries are kept side by side under prebuilds/ and each runtime is
// pointed at its own.
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const PREBUILDS_DIR = path.join(ROOT, 'prebuilds');
const PACKAGE_DIR = path.join(ROOT, 'node_modules', 'better-sqlite3');
const INSTALLED_BINDING = path.join(PACKAGE_DIR, 'build', 'Release', 'better_sqlite3.node');
// Records which runtime the binary in build/Release was installed for, so the
// setup can tell an Electron build from a Node one without loading it.
const INSTALLED_MARKER = path.join(PACKAGE_DIR, 'build', 'Release', '.kallamo-binding');

const platformSuffix = `${process.platform}-${process.arch}`;

// Node identifies its ABI by module version; Electron pins one per release, so
// its own version is the clearer name.
const nodeTag = (abi = process.versions.modules) => `node-v${abi}-${platformSuffix}`;
const electronTag = (version) => `electron-v${version}-${platformSuffix}`;

const bindingPath = (tag) => path.join(PREBUILDS_DIR, `better_sqlite3-${tag}.node`);

function electronVersion() {
  if (process.versions.electron) return process.versions.electron;
  return require(path.join(ROOT, 'node_modules', 'electron', 'package.json')).version;
}

// The binary for whoever is running right now, or null when it has not been
// prepared yet and the caller should fall back to normal resolution.
function resolveNativeBinding() {
  const tag = process.versions.electron ? electronTag(process.versions.electron) : nodeTag();
  const file = bindingPath(tag);
  return fs.existsSync(file) ? file : null;
}

module.exports = {
  ROOT,
  PREBUILDS_DIR,
  PACKAGE_DIR,
  INSTALLED_BINDING,
  INSTALLED_MARKER,
  bindingPath,
  electronTag,
  electronVersion,
  nodeTag,
  resolveNativeBinding
};
