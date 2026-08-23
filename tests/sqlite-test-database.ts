import Database from 'better-sqlite3';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveNativeBinding } = require('../tools/sqlite-binding.cjs');

// The copy of better-sqlite3 inside node_modules is built for Electron, so the
// suite loads the Node build kept beside it. `npm test` prepares both; see
// tools/setup-sqlite-bindings.cjs.
export function openTestDatabase(filename: string): Database.Database {
  const nativeBinding = process.env.KALLAMO_TEST_NATIVE_BINDING || resolveNativeBinding();
  try {
    return new Database(filename, nativeBinding ? { nativeBinding } : undefined);
  } catch (error: any) {
    if (/NODE_MODULE_VERSION/.test(String(error?.message))) {
      throw new Error(
        'better-sqlite3 is built for a different runtime. Run "npm run setup:sqlite" and try again.'
      );
    }
    throw error;
  }
}
