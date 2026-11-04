const crypto = require('crypto');
const { nextStoryTitle } = require('./story-title');
const { replaceEntityId } = require('../worldbuild/entity-references');
const { markPending, clearPending } = require('./pending-workspaces');

// A new story in the same world: a new workspace with this one's Worldbuild, documents, memories
// and settings, as the world stood before the story changed it. Edits made by hand stay.

const SNAPSHOT_LINK_TYPES = new Set(['owned_by', 'carried_by', 'located_in', 'related_to']);

const newId = prefix => `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

function hasTable(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function parseJson(text, fallback) {
  if (text == null || text === '') return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
}

// Statements are kept per connection, so copying thousands of rows prepares each shape once.
const statements = new WeakMap();

function cached(db) {
  if (!statements.has(db)) statements.set(db, { columns: new Map(), inserts: new Map() });
  return statements.get(db);
}

function columnsOf(db, table) {
  const cache = cached(db).columns;
  if (!cache.has(table)) cache.set(table, db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name));
  return cache.get(table);
}

// Inserts a copy of a row with some columns replaced, whatever columns the table has today.
function copyRow(db, table, row, overrides) {
  const next = { ...row, ...overrides };
  const columns = columnsOf(db, table).filter(column => Object.hasOwn(next, column));
  const key = `${table}:${columns.join(',')}`;
  const inserts = cached(db).inserts;
  if (!inserts.has(key)) {
    inserts.set(key, db.prepare(`INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`));
  }
  inserts.get(key).run(...columns.map(column => next[column]));
}

/** The world before the first reply: the oldest turn snapshot, or null when the story never moved it. */
function storyStart(db, workspaceId) {
  if (!hasTable(db, 'roleplay_turn_snapshots')) return null;
  const row = db.prepare('SELECT snapshot_json FROM roleplay_turn_snapshots WHERE workspace_id = ? ORDER BY created_at ASC LIMIT 1').get(workspaceId);
  return row ? parseJson(row.snapshot_json, null) : null;
}

const activeOrigin = `NOT EXISTS (
  SELECT 1 FROM narrative_origin_lifecycle lifecycle
  WHERE lifecycle.workspace_id = changes.workspace_id AND lifecycle.origin_id = changes.provenance_id AND lifecycle.status != 'active'
)`;

/** Entities a reply brought into the world. */
function storyCreatedEntities(db, workspaceId) {
  if (!hasTable(db, 'roleplay_entity_changes')) return new Set();
  const lifecycle = hasTable(db, 'narrative_origin_lifecycle') ? `AND ${activeOrigin}` : '';
  return new Set(db.prepare(`
    SELECT entity_id FROM roleplay_entity_changes changes
    WHERE workspace_id = ? AND created_entity = 1 AND status = 'applied' AND entity_id IS NOT NULL ${lifecycle}
  `).all(workspaceId).map(row => row.entity_id));
}

function readField(data, key) {
  if (key.startsWith('customFields.')) {
    const custom = data.customFields && typeof data.customFields === 'object' ? data.customFields : {};
    const name = key.slice('customFields.'.length);
    return { present: Object.hasOwn(custom, name), value: custom[name] };
  }
  return { present: Object.hasOwn(data, key), value: data[key] };
}

function writeField(data, key, stored) {
  const wrapped = parseJson(stored, null);
  if (key.startsWith('customFields.')) {
    const custom = { ...(data.customFields || {}) };
    const name = key.slice('customFields.'.length);
    if (wrapped) custom[name] = wrapped.value; else delete custom[name];
    data.customFields = custom;
  } else if (wrapped) data[key] = wrapped.value;
  else delete data[key];
}

const sameLink = (link, row) => link.fromRef === row.fromId && link.toRef === row.toId && link.relType === row.relType
  && (link.label || null) === (row.label || null);

// A change read from the chat is the story's; one read only from documents is building the world.
function storyMadeUpdate(chunkOwner, evidence) {
  const owners = evidence.map(chunkOwner);
  return !owners.length || owners.some(owner => owner !== 'document' && owner !== 'chat_kb' && owner !== 'import_source');
}

/** Takes back, inside the package, what the story changed. Values edited by hand afterwards stay. */
function resetPackage(db, workspaceId, payload, start) {
  const entities = new Map(payload.entities.map(entity => [entity.ref, entity]));
  payload.links = Array.isArray(payload.links) ? payload.links : [];

  if (hasTable(db, 'entity_update_origins')) {
    const ownerOf = db.prepare('SELECT ownerType FROM knowledge_chunks WHERE id = ?');
    const chunkOwner = id => ownerOf.get(id)?.ownerType || 'missing';
    const rows = db.prepare('SELECT * FROM entity_update_origins WHERE workspace_id = ? ORDER BY created_at DESC, rowid DESC').all(workspaceId);
    for (const row of rows) {
      if (!storyMadeUpdate(chunkOwner, parseJson(row.evidence_json, []))) continue;
      const entity = entities.get(row.entity_id);
      if (row.kind === 'field' && entity) {
        entity.data = entity.data || {};
        const { present, value } = readField(entity.data, row.target);
        if ((present ? JSON.stringify({ value }) : null) === row.next_json) writeField(entity.data, row.target, row.previous_json);
      } else if (row.kind === 'lore' && entity) {
        if (JSON.stringify({ value: entity.lore || '' }) === row.next_json) entity.lore = parseJson(row.previous_json, { value: '' }).value || '';
      } else if (row.kind === 'link') {
        const next = parseJson(row.next_json, null);
        const previous = parseJson(row.previous_json, null);
        if (next) payload.links = payload.links.filter(link => !sameLink(link, next));
        if (previous && entities.has(previous.fromId) && entities.has(previous.toId) && !payload.links.some(link => sameLink(link, previous))) {
          payload.links.push({ fromRef: previous.fromId, toRef: previous.toId, relType: previous.relType, label: previous.label || null, metadata: previous.metadata || {} });
        }
      }
    }
  }

  if (hasTable(db, 'roleplay_entity_changes')) {
    const lifecycle = hasTable(db, 'narrative_origin_lifecycle') ? `AND ${activeOrigin}` : '';
    const renames = db.prepare(`
      SELECT entity_id, payload_json FROM roleplay_entity_changes changes
      WHERE workspace_id = ? AND status = 'applied' AND entity_id IS NOT NULL ${lifecycle}
      ORDER BY created_at DESC
    `).all(workspaceId);
    for (const row of renames) {
      const update = parseJson(row.payload_json, {})?.identityUpdate;
      const entity = entities.get(row.entity_id);
      if (!update || !entity) continue;
      const renamed = update.canonicalName && entity.canonicalName === update.canonicalName;
      if (renamed) entity.canonicalName = update.previousCanonicalName;
      const added = new Set(update.aliases || []);
      entity.aliases = (entity.aliases || []).filter(alias => !added.has(alias));
      if (renamed && Array.isArray(update.previousAliases)) entity.aliases = [...new Set([...update.previousAliases, ...entity.aliases])];
    }
  }

  if (start) {
    // Who holds what, where things lie and how people stand with each other, as the story found them.
    if (Array.isArray(start.links)) {
      payload.links = payload.links.filter(link => !SNAPSHOT_LINK_TYPES.has(link.relType));
      for (const link of start.links) {
        if (!entities.has(link.fromId) || !entities.has(link.toId)) continue;
        payload.links.push({ fromRef: link.fromId, toRef: link.toId, relType: link.relType, label: link.label || null, metadata: parseJson(link.metadata_json, {}) });
      }
    }
    if (payload.placement) {
      if (Array.isArray(start.equipment)) {
        payload.placement.equipment = start.equipment
          .filter(row => entities.has(row.entity_id) && entities.has(row.item_id))
          .map(row => ({ holderRef: row.entity_id, itemRef: row.item_id }));
      }
      if (Array.isArray(start.locationInventory)) {
        payload.placement.placed = start.locationInventory
          .filter(row => entities.has(row.location_id) && entities.has(row.item_id))
          .map(row => ({ locationRef: row.location_id, itemRef: row.item_id, quantity: row.quantity }));
      }
    }
    const skills = payload.roleplayRules?.skills;
    if (skills && Array.isArray(start.skills) && hasTable(db, 'roleplay_skills')) {
      const keyById = new Map(db.prepare('SELECT skill_id, skill_key FROM roleplay_skills WHERE workspace_id = ?').all(workspaceId).map(row => [row.skill_id, row.skill_key]));
      skills.values = start.skills.flatMap(row => {
        const skillKey = keyById.get(row.skill_id);
        return skillKey && entities.has(row.entity_id) ? [{ targetRef: row.entity_id, skillKey, rank: Number(row.rank) }] : [];
      });
    }
  }

  if (payload.roleplayRules?.skills && hasTable(db, 'roleplay_skill_changes')) {
    const created = new Set(db.prepare(`
      SELECT skill_id FROM roleplay_skill_changes
      WHERE workspace_id = ? AND kind = 'create' AND status = 'applied' AND source = 'ai' AND skill_id IS NOT NULL
    `).all(workspaceId).map(row => row.skill_id));
    if (created.size) {
      const keys = new Set(db.prepare('SELECT skill_id, skill_key FROM roleplay_skills WHERE workspace_id = ?').all(workspaceId)
        .filter(row => created.has(row.skill_id)).map(row => row.skill_key));
      const skills = payload.roleplayRules.skills;
      skills.catalog = (skills.catalog || []).filter(skill => !keys.has(skill.key));
      skills.values = (skills.values || []).filter(value => !keys.has(value.skillKey));
    }
  }
  return payload;
}

/**
 * deps: buildPackage(workspaceId, { exclude }) → { data, writeZip(filePath) }, importPayload(workspaceId, filePath,
 * payload, options) with options.withIdMap, roleplay(), setExperienceMode, copyBackground, purgeWorkspace, evenwell, tempPath.
 */
function createNewStoryService(deps) {
  const { db } = deps;

  function copyWritingAndMemory(sourceId, targetId, idMap) {
    const now = Date.now();
    const folderMap = new Map();
    const folders = db.prepare('SELECT * FROM folders WHERE workspaceId = ?').all(sourceId);
    for (const folder of folders) folderMap.set(folder.id, newId('fld'));
    for (const folder of folders) {
      copyRow(db, 'folders', folder, { id: folderMap.get(folder.id), workspaceId: targetId, parentId: folder.parentId ? folderMap.get(folder.parentId) || null : null });
    }
    const documentMap = new Map();
    for (const document of db.prepare('SELECT * FROM documents WHERE workspaceId = ?').all(sourceId)) {
      const id = newId('doc');
      documentMap.set(document.id, id);
      copyRow(db, 'documents', document, { id, workspaceId: targetId, folderId: document.folderId ? folderMap.get(document.folderId) || null : null, last_modified: now });
    }

    // Passages are copied with their vectors, so the new story searches them without indexing again.
    const chunkMap = new Map();
    const copyChunk = (chunk, ownerId) => {
      const prefix = /^(manual_|mem_)/.exec(chunk.id)?.[1] || 'kc_';
      const id = `${prefix}${crypto.randomUUID()}`;
      chunkMap.set(chunk.id, id);
      copyRow(db, 'knowledge_chunks', chunk, { id, ownerId });
    };
    for (const [from, to] of documentMap) {
      for (const chunk of db.prepare("SELECT * FROM knowledge_chunks WHERE ownerType = 'document' AND ownerId = ?").all(from)) copyChunk(chunk, to);
    }
    for (const chunk of db.prepare("SELECT * FROM knowledge_chunks WHERE ownerType = 'chat_kb' AND ownerId = ?").all(sourceId)) copyChunk(chunk, targetId);

    // Memories written by hand come along; the chat's own summaries start over with the chat.
    const blocks = parseJson(db.prepare('SELECT memoryBlocks FROM chats WHERE id = ?').get(sourceId)?.memoryBlocks, []);
    const kept = (Array.isArray(blocks) ? blocks : []).filter(block => block && block.type !== 'summarized');
    const keptIds = new Set(kept.map(block => block.id));
    for (const chunk of db.prepare("SELECT * FROM knowledge_chunks WHERE ownerType = 'chat_memory' AND ownerId = ? AND source != 'Chat Archive'").all(sourceId)) {
      if (chunk.memoryBlockId && !keptIds.has(chunk.memoryBlockId)) continue;
      copyChunk(chunk, targetId);
    }
    db.prepare('UPDATE chats SET memoryBlocks = ? WHERE id = ?').run(JSON.stringify(kept), targetId);

    const mapEntity = id => (id ? idMap.get(id) : null);
    if (hasTable(db, 'chunk_tags')) {
      for (const [from, to] of chunkMap) {
        for (const row of db.prepare('SELECT * FROM chunk_tags WHERE chunkId = ?').all(from)) {
          if (row.entity && !mapEntity(row.entity)) continue;
          copyRow(db, 'chunk_tags', row, { chunkId: to, entity: row.entity ? mapEntity(row.entity) : row.entity });
        }
      }
    }
    if (hasTable(db, 'world_index_chunk_status')) {
      for (const [from, to] of chunkMap) {
        const status = db.prepare('SELECT * FROM world_index_chunk_status WHERE chunkId = ?').get(from);
        if (status) copyRow(db, 'world_index_chunk_status', status, { chunkId: to, lastRunId: null });
      }
    }

    // Texts written inside items, and the chapters an entity keeps as background, point at the copies.
    if (hasTable(db, 'in_world_texts')) {
      for (const text of db.prepare('SELECT * FROM in_world_texts WHERE workspace_id = ?').all(sourceId)) {
        const documentId = documentMap.get(text.document_id);
        if (!documentId) continue;
        copyRow(db, 'in_world_texts', text, { document_id: documentId, workspace_id: targetId, item_id: mapEntity(text.item_id) || null, author_id: mapEntity(text.author_id) || null, created_at: now });
      }
    }
    const update = db.prepare('UPDATE entities SET data = ?, loreDocumentId = ? WHERE id = ?');
    for (const row of db.prepare('SELECT id, data FROM entities WHERE workspaceId = ?').all(sourceId)) {
      const target = idMap.get(row.id);
      const chapters = (parseJson(row.data, {}).loreDocumentIds || []).map(id => documentMap.get(id)).filter(Boolean);
      if (!target || !chapters.length) continue;
      const data = parseJson(db.prepare('SELECT data FROM entities WHERE id = ?').get(target)?.data, {});
      data.loreDocumentIds = chapters;
      update.run(JSON.stringify(data), chapters[0], target);
    }
  }

  function copyStoryStart(sourceId, targetId, idMap, start) {
    const roleplay = deps.roleplay();
    const settings = roleplay.getSettings(sourceId);
    const startSettings = Array.isArray(start?.settings) ? start.settings[0] : null;
    const startLocation = startSettings ? startSettings.location_entity_id : settings.locationEntityId;
    roleplay.saveSettings(targetId, {
      scenarioName: settings.scenarioName,
      scenarioSummary: settings.scenarioSummary,
      defaultUpdatePolicy: settings.defaultUpdatePolicy,
      locationEntityId: startLocation ? idMap.get(startLocation) || null : null,
    });
    if (!hasTable(db, 'roleplay_time_state')) return;
    const time = start
      ? (Array.isArray(start.timeState) ? start.timeState[0] : null)
      : db.prepare('SELECT * FROM roleplay_time_state WHERE workspace_id = ?').get(sourceId);
    if (!time) return;
    let position = parseJson(time.position_json, null);
    if (!position) return;
    for (const [from, to] of idMap) position = replaceEntityId(position, from, to);
    db.prepare(`
      INSERT INTO roleplay_time_state (workspace_id, position_json, version, updated_at) VALUES (?, ?, 1, ?)
      ON CONFLICT(workspace_id) DO UPDATE SET position_json = excluded.position_json, updated_at = excluded.updated_at
    `).run(targetId, JSON.stringify(position), Date.now());
  }

  /** Describes what a new story from this workspace would be, for the dialog. */
  function preview(sourceId) {
    const source = db.prepare('SELECT id, title FROM chats WHERE id = ?').get(sourceId);
    if (!source) throw new Error('Workspace not found.');
    const titles = db.prepare('SELECT title FROM chats').all().map(row => row.title);
    return {
      guided: Boolean(deps.evenwell?.isStory(sourceId)),
      title: nextStoryTitle(source.title, titles),
    };
  }

  // Each step runs whole, then the app gets a turn to draw the progress before the next one.
  const pause = () => new Promise(resolve => setImmediate(resolve));

  /** onProgress(step): 'world' | 'import' | 'writing' | 'done'. */
  async function start(sourceId, { title, onProgress = () => {} } = {}) {
    const source = db.prepare('SELECT * FROM chats WHERE id = ?').get(sourceId);
    if (!source) throw new Error('Workspace not found.');
    onProgress('world');
    await pause();
    if (deps.evenwell?.isStory(sourceId)) {
      const id = deps.evenwell.seed();
      onProgress('done');
      return { id, guided: true };
    }

    const storyStartState = storyStart(db, sourceId);
    const { data, writeZip } = deps.buildPackage(sourceId, { exclude: storyCreatedEntities(db, sourceId) });
    resetPackage(db, sourceId, data, storyStartState);

    const titles = db.prepare('SELECT title FROM chats').all().map(row => row.title);
    const name = String(title || '').trim() || nextStoryTitle(source.title, titles);
    const targetId = newId('chat');
    const now = Date.now();
    // Listed before anything else lands, so a closed app removes the copy on its next start.
    db.transaction(() => {
      copyRow(db, 'chats', source, {
        id: targetId, title: name, updatedAt: now, isPinned: 0, summarizedIndex: 0, memoryBlocks: '[]',
        backgroundImage: '', lastTargetId: null, last_modified: now, syncToCloud: 0,
      });
      markPending(db, targetId, sourceId);
    })();
    try {
      onProgress('import');
      await pause();
      const mode = hasTable(db, 'workspace_experience_modes')
        ? db.prepare('SELECT mode FROM workspace_experience_modes WHERE workspace_id = ?').get(sourceId)?.mode
        : null;
      if (mode) deps.setExperienceMode(targetId, mode);
      const packagePath = deps.tempPath(`${targetId}.klwb`);
      writeZip(packagePath);
      let imported;
      try {
        imported = deps.importPayload(targetId, packagePath, data, { rulesMode: 'replace', confirmed: true, withIdMap: true });
      } finally {
        deps.removeFile(packagePath);
      }
      if (!imported?.success) throw new Error(imported?.error || 'The world could not be copied.');
      const idMap = imported.idMap;
      onProgress('writing');
      await pause();
      db.transaction(() => {
        copyWritingAndMemory(sourceId, targetId, idMap);
        copyStoryStart(sourceId, targetId, idMap, storyStartState);
      })();
      if (source.backgroundImage) deps.copyBackground(source.backgroundImage, targetId);
      clearPending(db, targetId);
      onProgress('done');
      return { id: targetId, guided: false };
    } catch (error) {
      try {
        deps.purgeWorkspace(targetId);
        clearPending(db, targetId);
      } catch (cleanup) { console.warn('[New story] Cleanup failed:', cleanup.message); }
      throw error;
    }
  }

  return { preview, start };
}

module.exports = { createNewStoryService, resetPackage, storyCreatedEntities, storyStart };
