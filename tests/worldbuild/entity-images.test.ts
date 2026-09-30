import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openTestDatabase } from '../sqlite-test-database';

const require = createRequire(import.meta.url);
const { createEntityImages } = require('../../src/main/features/worldbuild/entity-images.js');

let dataDir: string;
let sourceDir: string;
let db: ReturnType<typeof openTestDatabase>;
let images: any;

// Without nativeImage the module copies files as they are, which is all these tests need.
const source = (name: string, bytes = 'image-bytes') => {
  const file = path.join(sourceDir, name);
  fs.writeFileSync(file, bytes);
  return file;
};
const filesUnder = (folder: string): string[] => fs.existsSync(folder)
  ? fs.readdirSync(folder, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? filesUnder(path.join(folder, entry.name)) : [path.join(folder, entry.name)])
  : [];

beforeEach(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kallamo-images-data-'));
  sourceDir = fs.mkdtempSync(path.join(os.tmpdir(), 'kallamo-images-source-'));
  db = openTestDatabase(':memory:');
  db.exec(`
    CREATE TABLE worldbuild_entity_images (
      workspace_id TEXT NOT NULL, entity_id TEXT NOT NULL, kind TEXT NOT NULL, image_path TEXT NOT NULL,
      focus TEXT, updated_at INTEGER NOT NULL, PRIMARY KEY (workspace_id, entity_id, kind)
    );
    CREATE TABLE roleplay_location_backgrounds (
      workspace_id TEXT NOT NULL, location_id TEXT NOT NULL, image_path TEXT NOT NULL,
      focus TEXT, updated_at INTEGER, PRIMARY KEY (workspace_id, location_id)
    );
  `);
  images = createEntityImages({ db, dataDir });
});

afterEach(() => {
  db.close();
  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(sourceDir, { recursive: true, force: true });
});

describe('entity images', () => {
  test('stores a copy inside the data folder under a relative path', () => {
    const stored = images.importImage({ workspaceId: 'ws', entityId: 'e1', kind: 'portrait', sourcePath: source('face.jpg') });
    expect(path.isAbsolute(stored)).toBe(false);
    expect(stored.startsWith('WorldbuildImages/')).toBe(true);
    expect(fs.existsSync(images.resolve(stored))).toBe(true);
    expect(images.resolve(stored).startsWith(dataDir)).toBe(true);
  });

  test('refuses files that are not images', () => {
    expect(() => images.importImage({ workspaceId: 'ws', entityId: 'e1', kind: 'portrait', sourcePath: source('notes.txt') })).toThrow();
  });

  test('replacing or removing a portrait leaves no file behind', () => {
    const first = images.setPortrait({ workspaceId: 'ws', entityId: 'e1', sourcePath: source('a.png') });
    const second = images.setPortrait({ workspaceId: 'ws', entityId: 'e1', sourcePath: source('b.png') });
    expect(second.imagePath).not.toBe(first.imagePath);
    expect(fs.existsSync(first.imagePath)).toBe(false);
    expect(filesUnder(path.join(dataDir, 'WorldbuildImages'))).toEqual([second.imagePath]);

    images.removePortrait('ws', 'e1');
    expect(images.getPortrait('ws', 'e1')).toBeNull();
    expect(filesUnder(path.join(dataDir, 'WorldbuildImages'))).toEqual([]);
  });

  test('a framing change keeps the image and clamps the focus', () => {
    const first = images.setPortrait({ workspaceId: 'ws', entityId: 'e1', sourcePath: source('a.png') });
    const framed = images.setPortrait({ workspaceId: 'ws', entityId: 'e1', focus: { x: 140, y: -3, zoom: 9 } });
    expect(framed.imagePath).toBe(first.imagePath);
    expect(framed.focus).toEqual({ x: 100, y: 0, zoom: 4 });
    expect(images.listPortraits('ws')).toEqual({ e1: { imagePath: first.imagePath, focus: { x: 100, y: 0, zoom: 4 } } });
    expect(images.listPortraits('other')).toEqual({});
  });

  test('the sweep keeps referenced backgrounds and leaves other files alone', () => {
    const kept = images.importImage({ workspaceId: 'ws', entityId: 'loc', kind: 'background', sourcePath: source('kept.jpg') });
    db.prepare('INSERT INTO roleplay_location_backgrounds (workspace_id, location_id, image_path) VALUES (?, ?, ?)').run('ws', 'loc', kept);
    const orphan = images.resolve(images.importImage({ workspaceId: 'ws', entityId: 'gone', kind: 'background', sourcePath: source('orphan.jpg') }));
    const legacyFolder = path.join(dataDir, 'ChatHistory', 'chat_1', 'LocationBackgrounds');
    fs.mkdirSync(legacyFolder, { recursive: true });
    const legacyKept = path.join(legacyFolder, 'old.jpg');
    const legacyOrphan = path.join(legacyFolder, 'older.jpg');
    fs.writeFileSync(legacyKept, 'x');
    fs.writeFileSync(legacyOrphan, 'x');
    db.prepare('INSERT INTO roleplay_location_backgrounds (workspace_id, location_id, image_path) VALUES (?, ?, ?)').run('ws', 'loc2', legacyKept);
    const chatBackground = path.join(dataDir, 'ChatHistory', 'chat_1', 'bg_image_1.jpg');
    fs.writeFileSync(chatBackground, 'x');

    expect(images.sweep()).toBe(2);
    expect(fs.existsSync(images.resolve(kept))).toBe(true);
    expect(fs.existsSync(legacyKept)).toBe(true);
    expect(fs.existsSync(orphan)).toBe(false);
    expect(fs.existsSync(legacyOrphan)).toBe(false);
    expect(fs.existsSync(chatBackground)).toBe(true);
  });

  test('a package carries own images only and imports them into another workspace', () => {
    images.setPortrait({ workspaceId: 'ws', entityId: 'e1', sourcePath: source('face.png', 'portrait'), focus: { x: 20, y: 30, zoom: 1.5 } });
    const background = images.importImage({ workspaceId: 'ws', entityId: 'loc', kind: 'background', sourcePath: source('scene.jpg', 'scene') });
    db.prepare('INSERT INTO roleplay_location_backgrounds (workspace_id, location_id, image_path) VALUES (?, ?, ?)').run('ws', 'loc', background);

    const packed = images.listForExport('ws', ['e1', 'loc']);
    expect(packed.map((image: any) => `${image.entityId}:${image.kind}`).sort()).toEqual(['e1:portrait', 'loc:background']);
    expect(images.listForExport('ws', ['e1']).map((image: any) => image.kind)).toEqual(['portrait']);

    for (const image of packed) {
      const imported = images.importPackaged({
        workspaceId: 'ws2', entityId: `new-${image.entityId}`, kind: image.kind,
        buffer: fs.readFileSync(image.absolute), extension: path.extname(image.absolute), focus: image.focus,
      });
      expect(imported).toBe(true);
    }
    const portrait = images.getPortrait('ws2', 'new-e1');
    expect(fs.readFileSync(portrait.imagePath, 'utf8')).toBe('portrait');
    expect(portrait.focus).toEqual({ x: 20, y: 30, zoom: 1.5 });
    const row = db.prepare('SELECT image_path FROM roleplay_location_backgrounds WHERE workspace_id = ? AND location_id = ?').get('ws2', 'new-loc') as any;
    expect(fs.readFileSync(images.resolve(row.image_path), 'utf8')).toBe('scene');
    expect(images.importPackaged({ workspaceId: 'ws2', entityId: 'x', kind: 'portrait', buffer: Buffer.from('x'), extension: '.exe' })).toBe(false);
  });
});
