// Images that belong to Worldbuild entities: character portraits and location scene
// backgrounds. Files live under the data folder and the database keeps paths relative to
// it, so moving the data folder or restoring a backup keeps every image working.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const MAX_SOURCE_BYTES = 8 * 1024 * 1024;
// Longest side kept for each use: a portrait is shown small, a background fills the chat.
const MAX_SIDE = { portrait: 512, background: 2560 };

const workspaceKey = (id) => crypto.createHash('sha256').update(String(id)).digest('hex').slice(0, 24);

function createEntityImages({ db, dataDir, nativeImage = null }) {
  const root = path.join(dataDir, 'WorldbuildImages');
  const legacyRoot = path.join(dataDir, 'ChatHistory');

  const toStored = (absolute) => {
    const relative = path.relative(dataDir, absolute);
    return relative && !relative.startsWith('..') && !path.isAbsolute(relative) ? relative.split(path.sep).join('/') : absolute;
  };
  // Older rows hold absolute paths; newer ones are relative to the data folder.
  const resolve = (stored) => {
    if (!stored) return null;
    return path.isAbsolute(stored) ? stored : path.join(dataDir, ...String(stored).split('/'));
  };
  const insideData = (absolute) => {
    const relative = path.relative(dataDir, absolute);
    return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);
  };

  const hasTable = (name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
  const parseFocus = (text) => { try { return text ? JSON.parse(text) : null; } catch { return null; } };
  const cleanFocus = (focus) => focus && typeof focus === 'object'
    ? { x: clamp(focus.x, 0, 100, 50), y: clamp(focus.y, 0, 100, 50), zoom: clamp(focus.zoom, 1, 4, 1) }
    : null;

  // Copies the chosen file into the data folder, shrunk to the size its use needs.
  const importImage = ({ workspaceId, entityId, kind, sourcePath }) => {
    if (!sourcePath || !fs.existsSync(sourcePath)) throw new Error('Choose an image file.');
    const extension = path.extname(sourcePath).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(extension)) throw new Error('Choose a PNG, JPG, WEBP or GIF image.');
    const size = fs.statSync(sourcePath).size;
    const folder = path.join(root, workspaceKey(workspaceId), kind === 'portrait' ? 'portraits' : 'locations', workspaceKey(entityId));
    fs.mkdirSync(folder, { recursive: true });
    const version = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
    let destination = null;
    const image = nativeImage && extension !== '.gif' ? nativeImage.createFromPath(sourcePath) : null;
    if (image && !image.isEmpty()) {
      const { width, height } = image.getSize();
      const limit = MAX_SIDE[kind] || MAX_SIDE.background;
      const scale = Math.min(1, limit / Math.max(width, height));
      const resized = scale < 1 ? image.resize({ width: Math.round(width * scale), height: Math.round(height * scale), quality: 'best' }) : image;
      // PNG keeps transparency; everything else becomes a compact JPG.
      const keepPng = extension === '.png';
      destination = path.join(folder, `${kind}-${version}.${keepPng ? 'png' : 'jpg'}`);
      fs.writeFileSync(destination, keepPng ? resized.toPNG() : resized.toJPEG(88));
    } else {
      if (size > MAX_SOURCE_BYTES) throw new Error('This image is larger than 8 MB.');
      destination = path.join(folder, `${kind}-${version}${extension}`);
      fs.copyFileSync(sourcePath, destination);
    }
    for (const entry of fs.readdirSync(folder)) {
      const stale = path.join(folder, entry);
      if (stale !== destination) fs.rmSync(stale, { force: true });
    }
    return toStored(destination);
  };

  const getPortrait = (workspaceId, entityId) => {
    if (!hasTable('worldbuild_entity_images')) return null;
    const row = db.prepare(`
      SELECT image_path, focus FROM worldbuild_entity_images WHERE workspace_id = ? AND entity_id = ? AND kind = 'portrait'
    `).get(workspaceId, entityId);
    return row ? { entityId, imagePath: resolve(row.image_path), focus: parseFocus(row.focus) } : null;
  };

  const listPortraits = (workspaceId) => {
    if (!hasTable('worldbuild_entity_images')) return {};
    const rows = db.prepare(`
      SELECT entity_id, image_path, focus FROM worldbuild_entity_images WHERE workspace_id = ? AND kind = 'portrait'
    `).all(workspaceId);
    return Object.fromEntries(rows.map(row => [row.entity_id, { imagePath: resolve(row.image_path), focus: parseFocus(row.focus) }]));
  };

  const setPortrait = ({ workspaceId, entityId, sourcePath = null, focus }) => {
    const current = db.prepare(`
      SELECT image_path, focus FROM worldbuild_entity_images WHERE workspace_id = ? AND entity_id = ? AND kind = 'portrait'
    `).get(workspaceId, entityId);
    const stored = sourcePath ? importImage({ workspaceId, entityId, kind: 'portrait', sourcePath }) : current?.image_path;
    if (!stored) throw new Error('Choose an image first.');
    const nextFocus = focus !== undefined ? cleanFocus(focus) : sourcePath ? null : parseFocus(current?.focus);
    db.prepare(`
      INSERT INTO worldbuild_entity_images (workspace_id, entity_id, kind, image_path, focus, updated_at)
      VALUES (?, ?, 'portrait', ?, ?, ?)
      ON CONFLICT(workspace_id, entity_id, kind) DO UPDATE SET image_path = excluded.image_path, focus = excluded.focus, updated_at = excluded.updated_at
    `).run(workspaceId, entityId, stored, nextFocus ? JSON.stringify(nextFocus) : null, Date.now());
    sweep();
    return getPortrait(workspaceId, entityId);
  };

  const removePortrait = (workspaceId, entityId) => {
    db.prepare("DELETE FROM worldbuild_entity_images WHERE workspace_id = ? AND entity_id = ? AND kind = 'portrait'").run(workspaceId, entityId);
    sweep();
    return null;
  };

  const setBackgroundFocus = (workspaceId, locationId, focus) => {
    db.prepare('UPDATE roleplay_location_backgrounds SET focus = ?, updated_at = ? WHERE workspace_id = ? AND location_id = ?')
      .run(focus ? JSON.stringify(cleanFocus(focus)) : null, Date.now(), workspaceId, locationId);
  };

  const backgroundFocus = (workspaceId, locationId) => {
    if (!locationId) return null;
    const row = db.prepare('SELECT focus FROM roleplay_location_backgrounds WHERE workspace_id = ? AND location_id = ?').get(workspaceId, locationId);
    return parseFocus(row?.focus);
  };

  // Deletes image files no row points at any more: after a delete, a merge, a replaced
  // image or a removed workspace. Only files inside the image folders are ever touched.
  const sweep = () => {
    const referenced = new Set();
    const keep = (stored) => { const absolute = resolve(stored); if (absolute) referenced.add(path.normalize(absolute).toLowerCase()); };
    if (hasTable('worldbuild_entity_images')) for (const row of db.prepare('SELECT image_path FROM worldbuild_entity_images').all()) keep(row.image_path);
    if (hasTable('roleplay_location_backgrounds')) for (const row of db.prepare('SELECT image_path FROM roleplay_location_backgrounds').all()) keep(row.image_path);
    let removed = 0;
    const visit = (folder, depth) => {
      if (!fs.existsSync(folder)) return;
      for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
        const full = path.join(folder, entry.name);
        if (entry.isDirectory()) { visit(full, depth + 1); continue; }
        if (!IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase()) || !insideData(full)) continue;
        if (referenced.has(path.normalize(full).toLowerCase())) continue;
        try { fs.rmSync(full, { force: true }); removed += 1; } catch { /* a locked file is retried next sweep */ }
      }
      if (depth > 0) { try { if (!fs.readdirSync(folder).length) fs.rmdirSync(folder); } catch { /* not empty or busy */ } }
    };
    visit(root, 0);
    // Backgrounds uploaded before this folder existed live under ChatHistory/<key>/LocationBackgrounds.
    if (fs.existsSync(legacyRoot)) {
      for (const entry of fs.readdirSync(legacyRoot, { withFileTypes: true })) {
        if (entry.isDirectory()) visit(path.join(legacyRoot, entry.name, 'LocationBackgrounds'), 1);
      }
    }
    return removed;
  };

  // Every image a package can carry: portraits and each location's own background (never an
  // inherited one, which travels with the place it belongs to).
  const listForExport = (workspaceId, entityIds) => {
    const wanted = new Set(entityIds);
    const out = [];
    const add = (entityId, kind, stored, focus) => {
      const absolute = resolve(stored);
      if (!wanted.has(entityId) || !absolute || !fs.existsSync(absolute)) return;
      out.push({ entityId, kind, absolute, focus: parseFocus(focus), bytes: fs.statSync(absolute).size });
    };
    if (hasTable('worldbuild_entity_images')) {
      for (const row of db.prepare("SELECT entity_id, image_path, focus FROM worldbuild_entity_images WHERE workspace_id = ? AND kind = 'portrait'").all(workspaceId)) add(row.entity_id, 'portrait', row.image_path, row.focus);
    }
    if (hasTable('roleplay_location_backgrounds')) {
      for (const row of db.prepare('SELECT location_id, image_path, focus FROM roleplay_location_backgrounds WHERE workspace_id = ?').all(workspaceId)) add(row.location_id, 'background', row.image_path, row.focus);
    }
    return out;
  };

  // Writes an image from a package: a temporary copy goes through the same import as an upload.
  const importPackaged = ({ workspaceId, entityId, kind, buffer, extension, focus }) => {
    if (!IMAGE_EXTENSIONS.has(extension) || buffer.length > MAX_SOURCE_BYTES * 2) return false;
    const temp = path.join(require('os').tmpdir(), `kallamo-import-${crypto.randomBytes(6).toString('hex')}${extension}`);
    fs.writeFileSync(temp, buffer);
    try {
      const stored = importImage({ workspaceId, entityId, kind, sourcePath: temp });
      const focusText = focus ? JSON.stringify(cleanFocus(focus)) : null;
      if (kind === 'portrait') {
        db.prepare(`
          INSERT INTO worldbuild_entity_images (workspace_id, entity_id, kind, image_path, focus, updated_at) VALUES (?, ?, 'portrait', ?, ?, ?)
          ON CONFLICT(workspace_id, entity_id, kind) DO UPDATE SET image_path = excluded.image_path, focus = excluded.focus, updated_at = excluded.updated_at
        `).run(workspaceId, entityId, stored, focusText, Date.now());
      } else {
        db.prepare(`
          INSERT INTO roleplay_location_backgrounds (workspace_id, location_id, image_path, focus, updated_at) VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(workspace_id, location_id) DO UPDATE SET image_path = excluded.image_path, focus = excluded.focus, updated_at = excluded.updated_at
        `).run(workspaceId, entityId, stored, focusText, Date.now());
      }
      return true;
    } finally { fs.rmSync(temp, { force: true }); }
  };

  return { importImage, toStored, resolve, getPortrait, listPortraits, setPortrait, removePortrait, setBackgroundFocus, backgroundFocus, listForExport, importPackaged, sweep, workspaceKey };
}

function clamp(value, min, max, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

module.exports = { createEntityImages, IMAGE_EXTENSIONS };
