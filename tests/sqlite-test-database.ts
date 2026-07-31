import Database from 'better-sqlite3';

export function openTestDatabase(filename: string): Database.Database {
  const nativeBinding = process.env.KALLAMO_TEST_NATIVE_BINDING;
  return new Database(filename, nativeBinding ? { nativeBinding } : undefined);
}
