import { copyFileSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { getUmweltBridge } from '../../src/main/features/narrative/umwelt/bridge';

let directory: string;

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'kallamo-story-migration-'));
});

afterEach(() => {
  getUmweltBridge().closeAll();
  rmSync(directory, { recursive: true, force: true });
});

test('a story file written by Umwelt 0.1.0 opens, is migrated and keeps its copy', () => {
  const file = join(directory, 'story.umw');
  copyFileSync(join(__dirname, '..', 'fixtures', 'umwelt', 'storage-v5.umw'), file);
  const projects = getUmweltBridge().call<Array<{ id: string }>>(file, 'project.list', {});
  expect(projects.map(project => project.id)).toEqual(['saga']);
  expect(existsSync(`${file}.v5.bak`)).toBe(true);
});
