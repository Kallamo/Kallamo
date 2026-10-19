// Prepare both better-sqlite3 binaries once, so running the app and running the
// tests never fight over the same file. Safe to run repeatedly: it only fetches
// what is missing, and prebuild-install serves everything from the npm cache
// after the first time.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const {
  PREBUILDS_DIR,
  PACKAGE_DIR,
  INSTALLED_BINDING,
  INSTALLED_MARKER,
  bindingPath,
  electronTag,
  electronVersion,
  nodeTag
} = require('./sqlite-binding.cjs');

// Called through its entry file rather than the .bin shim: on Windows the shim
// is a .cmd, which execFile refuses to spawn.
const PREBUILD_INSTALL = path.join(__dirname, '..', 'node_modules', 'prebuild-install', 'bin.js');

// prebuild-install always writes to build/Release. Every fetch therefore lands
// in the same place and is moved to its own name straight afterwards.
function fetchInto(target, runtime, version) {
  execFileSync(process.execPath, [PREBUILD_INSTALL, '-r', runtime, '-t', version], {
    cwd: PACKAGE_DIR,
    stdio: 'pipe'
  });
  fs.mkdirSync(PREBUILDS_DIR, { recursive: true });
  fs.copyFileSync(INSTALLED_BINDING, target);
}

function ensure(target, runtime, version) {
  if (fs.existsSync(target)) return false;
  console.log(`[sqlite] fetching the ${runtime} ${version} binding`);
  fetchInto(target, runtime, version);
  return true;
}

function main() {
  if (!fs.existsSync(PACKAGE_DIR)) return;

  const electron = electronVersion();
  const nodeBinding = bindingPath(nodeTag());
  const electronBinding = bindingPath(electronTag(electron));

  ensure(nodeBinding, 'node', process.versions.node);
  ensure(electronBinding, 'electron', electron);

  // The app loads the copy inside the package, so it has to be the Electron build;
  // npm install puts a Node build there every time.
  const expected = electronTag(electron);
  const current = fs.existsSync(INSTALLED_MARKER)
    ? fs.readFileSync(INSTALLED_MARKER, 'utf8').trim()
    : '';
  if (current !== expected || !fs.existsSync(INSTALLED_BINDING)) {
    fs.copyFileSync(electronBinding, INSTALLED_BINDING);
    fs.writeFileSync(INSTALLED_MARKER, `${expected}\n`);
    console.log(`[sqlite] installed the ${expected} binding for Electron`);
  }
}

try {
  main();
} catch (error) {
  // A failure here must not abort npm install. The test helper and the app both
  // say what to run when a binding turns out to be missing.
  console.warn('[sqlite] could not prepare the native bindings:', error.message);
  console.warn('[sqlite] run "npm run setup:sqlite" once a network connection is available.');
}
