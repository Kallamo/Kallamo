// A Writing Desk document that exists inside the story, held by an Item. It reaches the AI only
// when the item is read, as what its author wrote rather than what is true.

const hasTable = (db, name) => Boolean(
  db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
);

function parseJson(text, fallback) {
  if (text == null || text === '') return fallback;
  try { return JSON.parse(text); } catch { return fallback; }
}

const BLOCKS = new Set(['paragraph', 'heading', 'blockquote', 'listItem', 'codeBlock', 'horizontalRule']);

// Writing Desk content is ProseMirror JSON; blocks become paragraphs, a hard break a new line.
// Struck text stays marked, since a crossed-out line is part of what the author wrote.
function documentText(content) {
  const root = typeof content === 'string' ? parseJson(content, null) : content;
  if (!root) return typeof content === 'string' ? content : '';
  const blocks = [];
  const walk = (node, into) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'text') {
      const struck = (node.marks || []).some(mark => mark?.type === 'strike');
      into.push(struck ? `~~${node.text || ''}~~` : (node.text || ''));
      return;
    }
    if (node.type === 'hardBreak') { into.push('\n'); return; }
    if (BLOCKS.has(node.type)) {
      const parts = [];
      for (const child of node.content || []) walk(child, parts);
      const text = parts.join('').trim();
      if (text) blocks.push(text);
      return;
    }
    for (const child of node.content || []) walk(child, into);
  };
  walk(root, []);
  return blocks.join('\n\n');
}

function inWorldDocumentIds(db, workspaceId = null) {
  if (!hasTable(db, 'in_world_texts')) return new Set();
  const rows = workspaceId
    ? db.prepare('SELECT document_id FROM in_world_texts WHERE workspace_id = ?').all(workspaceId)
    : db.prepare('SELECT document_id FROM in_world_texts').all();
  return new Set(rows.map(row => row.document_id));
}

function getInWorldText(db, documentId) {
  if (!documentId || !hasTable(db, 'in_world_texts')) return null;
  const row = db.prepare('SELECT document_id, workspace_id, item_id, author_id, ordinal FROM in_world_texts WHERE document_id = ?').get(documentId);
  return row ? { documentId: row.document_id, workspaceId: row.workspace_id, itemId: row.item_id, authorId: row.author_id, ordinal: row.ordinal } : null;
}

function entityOf(db, workspaceId, id, types) {
  if (!id) return null;
  const row = db.prepare("SELECT id, type, canonicalName FROM entities WHERE id = ? AND workspaceId = ? AND status != 'proposed'").get(id, workspaceId);
  if (!row || !types.includes(row.type)) throw new Error(types.includes('Items') ? 'Choose an item from this world.' : 'Choose an author from this world.');
  return row;
}

const AUTHOR_TYPES = ['Characters', 'Creatures', 'Factions'];

/** Marks a document as an in-world text of an item; a new item puts it after that item's last page. */
function setInWorldText(db, { documentId, itemId = null, authorId = null }) {
  const doc = db.prepare('SELECT id, workspaceId FROM documents WHERE id = ?').get(documentId);
  if (!doc) throw new Error('That chapter no longer exists.');
  entityOf(db, doc.workspaceId, itemId, ['Items']);
  entityOf(db, doc.workspaceId, authorId, AUTHOR_TYPES);
  const current = getInWorldText(db, documentId);
  const ordinal = current && current.itemId === itemId
    ? current.ordinal
    : (db.prepare('SELECT MAX(ordinal) AS m FROM in_world_texts WHERE workspace_id = ? AND item_id IS ?').get(doc.workspaceId, itemId || null)?.m ?? -1) + 1;
  db.prepare(`
    INSERT INTO in_world_texts (document_id, workspace_id, item_id, author_id, ordinal, created_at)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(document_id) DO UPDATE SET item_id = excluded.item_id, author_id = excluded.author_id, ordinal = excluded.ordinal
  `).run(documentId, doc.workspaceId, itemId || null, authorId || null, ordinal, Date.now());
  return getInWorldText(db, documentId);
}

function clearInWorldText(db, documentId) {
  if (hasTable(db, 'in_world_texts')) db.prepare('DELETE FROM in_world_texts WHERE document_id = ?').run(documentId);
}

function listItemTexts(db, workspaceId, itemId) {
  if (!hasTable(db, 'in_world_texts') || !itemId) return [];
  return db.prepare(`
    SELECT t.document_id AS documentId, t.author_id AS authorId, t.ordinal, d.title, d.folderId
    FROM in_world_texts t JOIN documents d ON d.id = t.document_id
    WHERE t.workspace_id = ? AND t.item_id = ?
    ORDER BY t.ordinal, d.title COLLATE NOCASE
  `).all(workspaceId, itemId);
}

/** Swaps a page with its neighbour in the item's reading order. */
function moveItemText(db, documentId, direction) {
  const text = getInWorldText(db, documentId);
  if (!text?.itemId) return [];
  const pages = listItemTexts(db, text.workspaceId, text.itemId);
  const index = pages.findIndex(page => page.documentId === documentId);
  const other = pages[index + (direction < 0 ? -1 : 1)];
  if (index < 0 || !other) return pages;
  const update = db.prepare('UPDATE in_world_texts SET ordinal = ? WHERE document_id = ?');
  db.transaction(() => {
    pages.forEach((page, position) => update.run(position, page.documentId));
    update.run(index + (direction < 0 ? -1 : 1), documentId);
    update.run(index, other.documentId);
  })();
  return listItemTexts(db, text.workspaceId, text.itemId);
}

// Items whose text a story turn could reach, with every name the text might be called by.
function itemsWithText(db, workspaceId) {
  if (!hasTable(db, 'in_world_texts')) return [];
  return db.prepare(`
    SELECT DISTINCT e.id, e.canonicalName, e.aliases FROM in_world_texts t
    JOIN entities e ON e.id = t.item_id AND e.workspaceId = t.workspace_id
    WHERE t.workspace_id = ? AND e.status != 'proposed'
  `).all(workspaceId).map(row => ({ id: row.id, name: row.canonicalName, names: [row.canonicalName, ...parseJson(row.aliases, [])].filter(Boolean) }));
}

const escapeRegExp = text => String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function mentions(text, names) {
  const haystack = String(text || '');
  return names.some(name => name.trim().length >= 3
    && new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(name.trim())}($|[^\\p{L}\\p{N}])`, 'iu').test(haystack));
}

/**
 * Ids of the items within reach of the scene: lying in it, carried by whoever is in it, or kept
 * at its location. Anyone present can read what is within reach; the narrator decides who does.
 */
function itemsInScene(db, roleplay, workspaceId) {
  const scene = roleplay.getScene(workspaceId);
  if (!scene) return new Set();
  const ids = new Set(scene.objectIds || []);
  const settings = roleplay.getSettings(workspaceId);
  const present = [...new Set([settings.playerEntityId, ...(scene.participantIds || []), ...(scene.possibleObserverIds || [])].filter(Boolean))];
  for (const holderId of present) {
    try { for (const item of roleplay.listInventory(workspaceId, holderId)) ids.add(item.itemId); } catch { /* not a holder type */ }
  }
  if (scene.locationId && hasTable(db, 'roleplay_location_inventory')) {
    for (const row of db.prepare('SELECT item_id FROM roleplay_location_inventory WHERE workspace_id = ? AND location_id = ? AND quantity > 0').all(workspaceId, scene.locationId)) ids.add(row.item_id);
  }
  return ids;
}

const NOT_TRUTH = 'This is what the pages say, written by their author, not established truth. A character learns it only by reading it in the story, and what it claims is the author\'s claim.';

/**
 * The pages of one item in reading order, cut to `maxTokens`. Pages that do not fit are named,
 * so the narrator knows the text goes on.
 */
function readItemText(db, workspaceId, itemId, { maxTokens = 1800, estimate = text => Math.ceil(String(text).length / 4) } = {}) {
  const item = db.prepare('SELECT id, canonicalName FROM entities WHERE id = ? AND workspaceId = ?').get(itemId, workspaceId);
  if (!item) return null;
  const pages = db.prepare(`
    SELECT t.document_id AS documentId, t.author_id AS authorId, d.title, d.content
    FROM in_world_texts t JOIN documents d ON d.id = t.document_id
    WHERE t.workspace_id = ? AND t.item_id = ?
    ORDER BY t.ordinal, d.title COLLATE NOCASE
  `).all(workspaceId, itemId);
  if (!pages.length) return null;
  const authorNames = [...new Set(pages.map(page => page.authorId).filter(Boolean))]
    .map(id => db.prepare('SELECT canonicalName FROM entities WHERE id = ?').get(id)?.canonicalName)
    .filter(Boolean);
  const header = `[Text in the world: ${item.canonicalName}${authorNames.length ? `, written by ${authorNames.join(' and ')}` : ''}. ${NOT_TRUTH}]`;
  const shown = [];
  const left = [];
  let used = estimate(header);
  for (const page of pages) {
    const body = `## ${page.title || 'Untitled'}\n${documentText(page.content)}`;
    const cost = estimate(body);
    if (!left.length && used + cost <= maxTokens) { shown.push(body); used += cost; }
    else left.push(page.title || 'Untitled');
  }
  if (!shown.length) return null;
  const tail = left.length ? `\n\n[Further pages not shown here: ${left.join('; ')}.]` : '';
  const text = `${header}\n\n${shown.join('\n\n')}${tail}`;
  return { itemId, itemName: item.canonicalName, documentIds: pages.map(page => page.documentId), text, tokens: used };
}

/**
 * Texts named this turn and within reach. In a roleplay the item has to be in the scene; outside
 * one, naming the item is enough.
 */
function textsInPlay(db, { workspaceId, roleplay = null, mentionText, maxTokens = 1800, estimate }) {
  const candidates = itemsWithText(db, workspaceId).filter(item => mentions(mentionText, item.names));
  if (!candidates.length) return [];
  const reach = roleplay ? itemsInScene(db, roleplay, workspaceId) : null;
  const readings = [];
  let budget = maxTokens;
  for (const item of candidates) {
    if (reach && !reach.has(item.id)) continue;
    const reading = readItemText(db, workspaceId, item.id, { maxTokens: budget, estimate });
    if (!reading) continue;
    readings.push(reading);
    budget -= reading.tokens;
    if (budget <= 0) break;
  }
  return readings;
}

// A package names texts by their document and entities by their ref, like links.
function exportItemTexts(db, workspaceId, entityRefs) {
  if (!hasTable(db, 'in_world_texts')) return [];
  const refs = new Set(entityRefs);
  return db.prepare(`
    SELECT t.document_id, t.item_id, t.author_id, t.ordinal, d.title, d.content
    FROM in_world_texts t JOIN documents d ON d.id = t.document_id
    WHERE t.workspace_id = ? AND t.item_id IS NOT NULL
    ORDER BY t.item_id, t.ordinal
  `).all(workspaceId)
    .filter(row => refs.has(row.item_id))
    .map(row => ({
      ref: row.document_id,
      itemRef: row.item_id,
      ...(row.author_id && refs.has(row.author_id) ? { authorRef: row.author_id } : {}),
      ordinal: row.ordinal,
      title: row.title,
      content: parseJson(row.content, row.content)
    }));
}

const TEXTS_FOLDER = 'In-world texts';

// The shared folder is the one earlier texts already sit in, so renaming it keeps new pages there.
function existingTextsRoot(db, workspaceId) {
  if (!hasTable(db, 'in_world_texts')) return null;
  return db.prepare(`
    SELECT root.id FROM in_world_texts AS texts
    JOIN documents AS doc ON doc.id = texts.document_id
    JOIN folders AS item ON item.id = doc.folderId
    JOIN folders AS root ON root.id = item.parentId AND root.parentId IS NULL
    WHERE texts.workspace_id = ? LIMIT 1
  `).get(workspaceId) || null;
}

// Each item's pages sit in their own folder under one shared folder, so two texts never interleave.
function itemTextFolder(db, workspaceId, itemId, createFolder) {
  const find = (name, parentId) => db.prepare('SELECT id FROM folders WHERE workspaceId = ? AND name = ? AND parentId IS ?').get(workspaceId, name, parentId);
  const root = existingTextsRoot(db, workspaceId) || find(TEXTS_FOLDER, null) || createFolder({ workspaceId, name: TEXTS_FOLDER });
  const itemName = db.prepare('SELECT canonicalName FROM entities WHERE id = ?').get(itemId)?.canonicalName || 'Untitled item';
  return find(itemName, root.id) || createFolder({ workspaceId, name: itemName, parentId: root.id });
}

/** Lands a package's texts as Writing Desk documents, in reading order, each tied to its item. */
function importItemTexts(db, workspaceId, texts, idMap, { createFolder, createDocument }) {
  const list = (Array.isArray(texts) ? texts : []).filter(text => text && idMap.get(text.itemRef));
  let textsAdded = 0;
  for (const itemRef of [...new Set(list.map(text => text.itemRef))]) {
    const itemId = idMap.get(itemRef);
    const folder = itemTextFolder(db, workspaceId, itemId, createFolder);
    for (const text of list.filter(entry => entry.itemRef === itemRef).sort((a, b) => (a.ordinal ?? 0) - (b.ordinal ?? 0))) {
      const content = typeof text.content === 'string' ? text.content : JSON.stringify(text.content || { type: 'doc', content: [{ type: 'paragraph' }] });
      const doc = createDocument({ workspaceId, folderId: folder.id, title: String(text.title || 'Untitled'), content });
      setInWorldText(db, { documentId: doc.id, itemId, authorId: idMap.get(text.authorRef) || null });
      textsAdded += 1;
    }
  }
  return { textsAdded };
}

module.exports = {
  TEXTS_FOLDER,
  itemTextFolder,
  exportItemTexts,
  importItemTexts,
  documentText,
  inWorldDocumentIds,
  getInWorldText,
  setInWorldText,
  clearInWorldText,
  listItemTexts,
  moveItemText,
  itemsWithText,
  itemsInScene,
  readItemText,
  textsInPlay
};
