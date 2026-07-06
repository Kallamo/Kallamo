const Database = require('better-sqlite3');
const { app, safeStorage } = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');

// --- DATABASE INITIALIZATION & MIGRATIONS ---

// Resolve the APPDATA data path
const appDataPath = process.env.APPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), '.local', 'share'));

const oldDataDir1 = path.join(appDataPath, 'AI Writer Companion');
const oldDataDir2 = path.join(appDataPath, 'Kalamo');
const dataDir = path.join(appDataPath, 'Kallamo');

if (fs.existsSync(oldDataDir2) && !fs.existsSync(dataDir)) {
  try {
    fs.renameSync(oldDataDir2, dataDir);
    console.log(`[Branding Migration] Successfully renamed data directory from "${oldDataDir2}" to "${dataDir}"`);
  } catch (e) {
    console.error(`[Branding Migration] Directory rename failed, attempting to copy instead:`, e);
  }
} else if (fs.existsSync(oldDataDir1) && !fs.existsSync(dataDir)) {
  try {
    fs.renameSync(oldDataDir1, dataDir);
    console.log(`[Branding Migration] Successfully renamed data directory from "${oldDataDir1}" to "${dataDir}"`);
  } catch (e) {
    console.error(`[Branding Migration] Directory rename failed, attempting to copy instead:`, e);
  }
}

const dbPath = path.join(dataDir, 'kallamo.db');
const oldDbPath = path.join(dataDir, 'companion.db');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

if (fs.existsSync(oldDbPath) && !fs.existsSync(dbPath)) {
  try {
    fs.renameSync(oldDbPath, dbPath);
    console.log(`[Branding Migration] Successfully renamed database file from "${oldDbPath}" to "${dbPath}"`);

    const oldWalPath = `${oldDbPath}-wal`;
    const newWalPath = `${dbPath}-wal`;
    if (fs.existsSync(oldWalPath)) {
      try {
        fs.renameSync(oldWalPath, newWalPath);
      } catch (e) {
        console.error(`[Branding Migration] WAL file rename failed:`, e);
      }
    }
    const oldShmPath = `${oldDbPath}-shm`;
    const newShmPath = `${dbPath}-shm`;
    if (fs.existsSync(oldShmPath)) {
      try {
        fs.renameSync(oldShmPath, newShmPath);
      } catch (e) {
        console.error(`[Branding Migration] SHM file rename failed:`, e);
      }
    }
  } catch (e) {
    console.error(`[Branding Migration] Database file rename failed:`, e);
  }
}

// --- WORKSPACE RESTORE BOOT SWAP FLOW ---
const markerPath = path.join(dataDir, 'RESTORE_PENDING.json');
if (fs.existsSync(markerPath)) {
  try {
    const marker = JSON.parse(fs.readFileSync(markerPath, 'utf8'));
    const stagedPath = path.join(dataDir, marker.staged || 'restore-staged.db');
    if (fs.existsSync(stagedPath)) {
      const walPath = `${dbPath}-wal`;
      const shmPath = `${dbPath}-shm`;
      if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
      if (fs.existsSync(walPath)) fs.unlinkSync(walPath);
      if (fs.existsSync(shmPath)) fs.unlinkSync(shmPath);

      try {
        fs.renameSync(stagedPath, dbPath);
      } catch (err) {
        fs.copyFileSync(stagedPath, dbPath);
        fs.unlinkSync(stagedPath);
      }
    }

    if (!fs.existsSync(dbPath)) {
      throw new Error("Staged database failed to deploy to active path.");
    }

    fs.unlinkSync(markerPath);
    console.log("[Workspace Restore] Restored database successfully from staged backup.");
  } catch (err) {
    console.error("Failed to restore workspace at boot:", err);
    if (!fs.existsSync(dbPath)) {
      try {
        const files = fs.readdirSync(dataDir);
        const backups = files
          .filter(f => f.startsWith('pre-restore-backup-') && f.endsWith('.db'))
          .map(f => {
            const part = f.substring('pre-restore-backup-'.length, f.length - '.db'.length);
            const ts = parseInt(part, 10);
            return { file: f, ts };
          })
          .filter(b => !isNaN(b.ts))
          .sort((a, b) => b.ts - a.ts);

        if (backups.length > 0) {
          const recoverySrc = path.join(dataDir, backups[0].file);
          console.warn(`[Workspace Restore] Restoration failed; attempting recovery using safety snapshot: ${recoverySrc}`);
          fs.copyFileSync(recoverySrc, dbPath);
        }
      } catch (recoveryErr) {
        console.error("Fatal: Recovery from pre-restore backup failed:", recoveryErr);
      }
    }
    if (fs.existsSync(markerPath)) {
      try { fs.unlinkSync(markerPath); } catch (e) {}
    }
  } finally {
    // Best-effort cleanup of any leftover staged file
    const stagedLeftover = path.join(dataDir, 'restore-staged.db');
    if (fs.existsSync(stagedLeftover)) {
      try { fs.unlinkSync(stagedLeftover); } catch (e) {}
    }
  }
}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');


// --- ENCRYPTION HELPERS ---

db.encryptApiKey = function(plainText) {
  if (!plainText) return '';
  if (plainText.startsWith('safe:')) return plainText;
  try {
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(plainText);
      return 'safe:' + encrypted.toString('base64');
    }
  } catch (err) {
    console.error('[Encryption] Failed to encrypt API key:', err);
  }
  return plainText;
};

db.decryptApiKey = function(encryptedText) {
  if (!encryptedText) return '';
  if (!encryptedText.startsWith('safe:')) return encryptedText;
  try {
    const base64Str = encryptedText.substring(5);
    const buffer = Buffer.from(base64Str, 'base64');
    if (safeStorage && safeStorage.isEncryptionAvailable()) {
      return safeStorage.decryptString(buffer);
    } else {
      console.warn('[Encryption] safeStorage is not available for decryption.');
    }
  } catch (err) {
    console.error('[Encryption] Failed to decrypt API key:', err);
  }
  return '';
};

// --- DATABASE SCHEMA SETUP ---

db.exec(`
  CREATE TABLE IF NOT EXISTS api_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    baseUrl TEXT,
    apiKey TEXT,
    customConfig TEXT,
    models TEXT
  );

  CREATE TABLE IF NOT EXISTS writing_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    color TEXT,
    apiProfileId TEXT,
    model TEXT,
    temperature REAL,
    maxTokens INTEGER,
    systemPrompt TEXT,
    knowledgeFiles TEXT,
    manualMode INTEGER,
    manualJson TEXT,
    isAgentic INTEGER,
    agenticPrompt TEXT,
    agenticMaxTurns INTEGER DEFAULT 3,
    resultChannel TEXT DEFAULT 'replacement',
    contextWindow INTEGER DEFAULT 8192,
    last_modified INTEGER DEFAULT 0,
    syncToCloud INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    updatedAt INTEGER,
    isPinned INTEGER DEFAULT 0,
    maxContext INTEGER DEFAULT 128000,
    archiveThreshold INTEGER DEFAULT 60000,
    summarizedIndex INTEGER DEFAULT 0,
    activeProfiles TEXT,
    activeWorkflows TEXT,
    backgroundImage TEXT,
    backdropOpacity INTEGER DEFAULT 75,
    userBubbleOpacity INTEGER DEFAULT 100,
    aiBubbleOpacity INTEGER DEFAULT 0,
    memoryBlocks TEXT,
    knowledgeFiles TEXT,
    autoSummarize INTEGER DEFAULT 0,
    showContextBar INTEGER DEFAULT 0,
    wdContextWindow INTEGER DEFAULT 8192,
    wdLastChannel TEXT DEFAULT 'replacement',
    wdUseChatHistory INTEGER DEFAULT 1,
    last_modified INTEGER DEFAULT 0,
    syncToCloud INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    chatId TEXT,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    aiName TEXT,
    aiColor TEXT,
    debugNotice TEXT,
    attachedFiles TEXT,
    createdAt INTEGER,
    last_modified INTEGER DEFAULT 0,
    FOREIGN KEY(chatId) REFERENCES chats(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    entryProfileId TEXT,
    steps TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS variables (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    description TEXT,
    last_modified INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id TEXT PRIMARY KEY,
    ownerId TEXT NOT NULL,
    ownerType TEXT NOT NULL,
    source TEXT NOT NULL,
    text TEXT NOT NULL,
    vector TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    enabled INTEGER DEFAULT 1,
    manuallyEdited INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS deleted_records (
    id TEXT PRIMARY KEY,
    table_name TEXT NOT NULL,
    deleted_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    workspaceId TEXT NOT NULL,
    name TEXT NOT NULL,
    parentId TEXT,
    position INTEGER DEFAULT 0,
    createdAt INTEGER,
    last_modified INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_folders_workspace ON folders(workspaceId);

  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    workspaceId TEXT NOT NULL,
    folderId TEXT,
    title TEXT NOT NULL,
    content TEXT,
    sheetColor TEXT,
    defaultFont TEXT,
    sheetWidth INTEGER DEFAULT 720,
    pageSize TEXT DEFAULT 'A4',
    orientation TEXT DEFAULT 'portrait',
    pageWidth INTEGER DEFAULT 794,
    pageHeight INTEGER DEFAULT 1123,
    marginTop INTEGER DEFAULT 96,
    marginRight INTEGER DEFAULT 96,
    marginBottom INTEGER DEFAULT 96,
    marginLeft INTEGER DEFAULT 96,
    defaultFontSize INTEGER DEFAULT 18,
    lineHeight REAL DEFAULT 1.6,
    paragraphSpacing INTEGER DEFAULT 12,
    textAlign TEXT DEFAULT 'left',
    firstLineIndent INTEGER DEFAULT 0,
    wordGoal INTEGER DEFAULT 0,
    position INTEGER DEFAULT 0,
    vectorized INTEGER DEFAULT 0,
    createdAt INTEGER,
    updatedAt INTEGER,
    last_modified INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_documents_workspace ON documents(workspaceId);

  CREATE TABLE IF NOT EXISTS pinned_directives (
    id TEXT PRIMARY KEY,
    workspaceId TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'typed',
    text TEXT NOT NULL,
    sourceMessageId TEXT,
    enabled INTEGER DEFAULT 1,
    position INTEGER DEFAULT 0,
    createdAt INTEGER,
    last_modified INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_pinned_directives_workspace ON pinned_directives(workspaceId);

  CREATE TABLE IF NOT EXISTS pending_suggestions (
    id TEXT PRIMARY KEY,
    documentId TEXT NOT NULL,
    workspaceId TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'replacement',
    fromPos INTEGER NOT NULL,
    toPos INTEGER NOT NULL,
    originalText TEXT,
    proposedText TEXT,
    profileId TEXT,
    intermediatePrompt TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    createdAt INTEGER,
    last_modified INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_pending_suggestions_document ON pending_suggestions(documentId);

  -- Persistent per-chapter review notes. A note is either scoped to the whole chapter
  -- (excerpt NULL) or to a passage (excerpt = the selected text, used for best-effort
  -- jump-to). source='ai' notes keep the profile + instruction that produced them.
  CREATE TABLE IF NOT EXISTS document_notes (
    id TEXT PRIMARY KEY,
    documentId TEXT NOT NULL,
    workspaceId TEXT NOT NULL,
    body TEXT NOT NULL,
    excerpt TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    source TEXT NOT NULL DEFAULT 'manual',
    profileId TEXT,
    instruction TEXT,
    createdAt INTEGER,
    resolvedAt INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_document_notes_document ON document_notes(documentId);

  CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_owner ON knowledge_chunks(ownerId, ownerType);

  CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(
    chunkId,
    text
  );

  CREATE TABLE IF NOT EXISTS constant_memory (
    id TEXT PRIMARY KEY,
    ownerId TEXT NOT NULL,
    ownerType TEXT NOT NULL DEFAULT 'profile',
    title TEXT,
    content TEXT NOT NULL,
    keywords TEXT,
    createdAt INTEGER,
    last_modified INTEGER DEFAULT 0,
    enabled INTEGER DEFAULT 1
  );

  CREATE INDEX IF NOT EXISTS idx_constant_memory_owner ON constant_memory(ownerId, ownerType);

  -- Structured memory: the tag vocabulary. A tag's description IS the classifier
  -- criterion. isEntity marks tags whose items carry a specific entity instance.
  CREATE TABLE IF NOT EXISTS tags (
    name TEXT PRIMARY KEY,
    description TEXT NOT NULL DEFAULT '',
    isEntity INTEGER DEFAULT 0,
    createdAt INTEGER,
    last_modified INTEGER DEFAULT 0
  );

  -- Multi-label association beside each chunk's vector. entity holds the instance
  -- for entity-type tags (NULL otherwise) and later becomes an FK to an entities
  -- table without a re-migration. Tags are retrieval-only (never sent to generation).
  CREATE TABLE IF NOT EXISTS chunk_tags (
    chunkId TEXT NOT NULL,
    tag TEXT NOT NULL,
    entity TEXT,
    PRIMARY KEY (chunkId, tag, entity)
  );

  CREATE INDEX IF NOT EXISTS idx_chunk_tags_tag ON chunk_tags(tag, entity);
  CREATE INDEX IF NOT EXISTS idx_chunk_tags_chunk ON chunk_tags(chunkId);

  -- Garbage-collect tag associations whenever their chunk is deleted, covering
  -- every knowledge_chunks deletion path in one place.
  CREATE TRIGGER IF NOT EXISTS trg_chunk_tags_gc
  AFTER DELETE ON knowledge_chunks
  FOR EACH ROW
  BEGIN
      DELETE FROM chunk_tags WHERE chunkId = OLD.id;
  END;

  -- Per-workspace world registry (Worldbuild). Every authored element (System,
  -- Location, Item, Race, Faction, Character) lives here with a canonicalName + an
  -- aliases list (JSON) the tagger uses to map surface mentions to an entity id, so
  -- chunk_tags values stay consistent (chunk_tags.entity references entities.id).
  -- The type column aligns with the tag categories (Characters/Locations/Factions/
  -- Items/Races) plus 'System'. data is a JSON blob of type-specific scalars; lore links to a
  -- Writing Desk document (loreDocumentId). status='proposed' = AI suggestion pending.
  CREATE TABLE IF NOT EXISTS entities (
    id             TEXT PRIMARY KEY,
    workspaceId    TEXT,
    type           TEXT NOT NULL,
    canonicalName  TEXT NOT NULL,
    aliases        TEXT,
    lore           TEXT,
    loreDocumentId TEXT,
    data           TEXT,
    status         TEXT NOT NULL DEFAULT 'confirmed',
    createdAt      INTEGER,
    last_modified  INTEGER DEFAULT 0
  );

  -- NOTE: idx_entities_workspace is created in the migration block below, AFTER the
  -- ALTERs that add workspaceId/type, so an existing old-shape entities table doesn't
  -- fail the index here before its columns exist.

  -- Relations between world nodes, one row per directed edge. relType examples:
  -- inside (Location->Location), created_by / owned_by (Item->Character),
  -- found_in (Item->Location), is_race (Character->Race), member_of
  -- (Character->Faction), operates_in (Faction->Location), connected_to
  -- (Character->Location). Derived lists (inventory, members…) are reverse queries.
  CREATE TABLE IF NOT EXISTS entity_links (
    id          TEXT PRIMARY KEY,
    workspaceId TEXT,
    fromId      TEXT NOT NULL,
    relType     TEXT NOT NULL,
    toId        TEXT NOT NULL,
    label       TEXT,
    createdAt   INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_entity_links_from ON entity_links(fromId, relType);
  CREATE INDEX IF NOT EXISTS idx_entity_links_to ON entity_links(toId, relType);

  -- Drop an entity's edges (both directions) when it is deleted.
  CREATE TRIGGER IF NOT EXISTS trg_entity_links_gc
  AFTER DELETE ON entities
  FOR EACH ROW
  BEGIN
      DELETE FROM entity_links WHERE fromId = OLD.id OR toId = OLD.id;
  END;

  -- Drop an entity's chunk tags when it is deleted, so dismissing an AI-proposed
  -- entity also strips the tags that linked it to chunks (no orphan tag rows
  -- pointing at a dead entity id).
  CREATE TRIGGER IF NOT EXISTS trg_chunk_tags_entity_gc
  AFTER DELETE ON entities
  FOR EACH ROW
  BEGIN
      DELETE FROM chunk_tags WHERE entity = OLD.id;
  END;

  CREATE TRIGGER IF NOT EXISTS chats_last_modified_trigger
  AFTER UPDATE ON chats
  FOR EACH ROW
  WHEN NEW.last_modified <= OLD.last_modified OR NEW.last_modified IS NULL
  BEGIN
      UPDATE chats SET last_modified = (strftime('%s', 'now') * 1000) WHERE id = NEW.id;
  END;

  CREATE TRIGGER IF NOT EXISTS chats_insert_last_modified_trigger
  AFTER INSERT ON chats
  FOR EACH ROW
  WHEN NEW.last_modified = 0 OR NEW.last_modified IS NULL
  BEGIN
      UPDATE chats SET last_modified = (strftime('%s', 'now') * 1000) WHERE id = NEW.id;
  END;

  DROP TRIGGER IF EXISTS chats_delete_trigger;
  CREATE TRIGGER chats_delete_trigger
  AFTER DELETE ON chats
  FOR EACH ROW
  BEGIN
      INSERT OR REPLACE INTO deleted_records (id, table_name, deleted_at)
      VALUES (OLD.id, 'sync_chats', (strftime('%s', 'now') * 1000));
  END;

  CREATE TRIGGER IF NOT EXISTS writing_profiles_last_modified_trigger
  AFTER UPDATE ON writing_profiles
  FOR EACH ROW
  WHEN NEW.last_modified <= OLD.last_modified OR NEW.last_modified IS NULL
  BEGIN
      UPDATE writing_profiles SET last_modified = (strftime('%s', 'now') * 1000) WHERE id = NEW.id;
  END;

  CREATE TRIGGER IF NOT EXISTS writing_profiles_insert_last_modified_trigger
  AFTER INSERT ON writing_profiles
  FOR EACH ROW
  WHEN NEW.last_modified = 0 OR NEW.last_modified IS NULL
  BEGIN
      UPDATE writing_profiles SET last_modified = (strftime('%s', 'now') * 1000) WHERE id = NEW.id;
  END;

  DROP TRIGGER IF EXISTS writing_profiles_delete_trigger;
  CREATE TRIGGER writing_profiles_delete_trigger
  AFTER DELETE ON writing_profiles
  FOR EACH ROW
  BEGIN
      INSERT OR REPLACE INTO deleted_records (id, table_name, deleted_at)
      VALUES (OLD.id, 'sync_writing_profiles', (strftime('%s', 'now') * 1000));
  END;

  CREATE TRIGGER IF NOT EXISTS messages_last_modified_trigger
  AFTER UPDATE ON messages
  FOR EACH ROW
  WHEN NEW.last_modified <= OLD.last_modified OR NEW.last_modified IS NULL
  BEGIN
      UPDATE messages SET last_modified = (strftime('%s', 'now') * 1000) WHERE id = NEW.id;
  END;

  CREATE TRIGGER IF NOT EXISTS messages_insert_last_modified_trigger
  AFTER INSERT ON messages
  FOR EACH ROW
  WHEN NEW.last_modified = 0 OR NEW.last_modified IS NULL
  BEGIN
      UPDATE messages SET last_modified = (strftime('%s', 'now') * 1000) WHERE id = NEW.id;
  END;

  DROP TRIGGER IF EXISTS messages_delete_trigger;
  CREATE TRIGGER messages_delete_trigger
  AFTER DELETE ON messages
  FOR EACH ROW
  BEGIN
      INSERT OR REPLACE INTO deleted_records (id, table_name, deleted_at)
      VALUES (OLD.id, 'sync_messages', (strftime('%s', 'now') * 1000));
  END;

  CREATE TRIGGER IF NOT EXISTS variables_last_modified_trigger
  AFTER UPDATE ON variables
  FOR EACH ROW
  WHEN NEW.last_modified <= OLD.last_modified OR NEW.last_modified IS NULL
  BEGIN
      UPDATE variables SET last_modified = (strftime('%s', 'now') * 1000) WHERE id = NEW.id;
  END;

  CREATE TRIGGER IF NOT EXISTS variables_insert_last_modified_trigger
  AFTER INSERT ON variables
  FOR EACH ROW
  WHEN NEW.last_modified = 0 OR NEW.last_modified IS NULL
  BEGIN
      UPDATE variables SET last_modified = (strftime('%s', 'now') * 1000) WHERE id = NEW.id;
  END;
`);

// --- DATABASE MIGRATIONS ---

try {
  const tableInfo = db.pragma("table_info(chats)");
  const columns = tableInfo.map(col => col.name);
  if (!columns.includes('memoryBlocks')) {
    db.exec("ALTER TABLE chats ADD COLUMN memoryBlocks TEXT");
    console.log("Database Migration: Added memoryBlocks column to chats table.");
  }
  if (!columns.includes('description')) {
    db.exec("ALTER TABLE chats ADD COLUMN description TEXT");
    console.log("Database Migration: Added description column to chats table.");
  }
  if (!columns.includes('knowledgeFiles')) {
    db.exec("ALTER TABLE chats ADD COLUMN knowledgeFiles TEXT");
    console.log("Database Migration: Added knowledgeFiles column to chats table.");
  }
  if (!columns.includes('backgroundImage')) {
    db.exec("ALTER TABLE chats ADD COLUMN backgroundImage TEXT");
    console.log("Database Migration: Added backgroundImage column to chats table.");
  }
  if (!columns.includes('backdropOpacity')) {
    db.exec("ALTER TABLE chats ADD COLUMN backdropOpacity INTEGER DEFAULT 75");
    console.log("Database Migration: Added backdropOpacity column to chats table.");
  }
  if (!columns.includes('userBubbleOpacity')) {
    db.exec("ALTER TABLE chats ADD COLUMN userBubbleOpacity INTEGER DEFAULT 100");
    console.log("Database Migration: Added userBubbleOpacity column to chats table.");
  }
  if (!columns.includes('aiBubbleOpacity')) {
    db.exec("ALTER TABLE chats ADD COLUMN aiBubbleOpacity INTEGER DEFAULT 0");
    console.log("Database Migration: Added aiBubbleOpacity column to chats table.");
  }
  if (!columns.includes('autoSummarize')) {
    db.exec("ALTER TABLE chats ADD COLUMN autoSummarize INTEGER DEFAULT 0");
    console.log("Database Migration: Added autoSummarize column to chats table.");
  }
  if (!columns.includes('showContextBar')) {
    db.exec("ALTER TABLE chats ADD COLUMN showContextBar INTEGER DEFAULT 0");
    console.log("Database Migration: Added showContextBar column to chats table.");
  }
  if (!columns.includes('last_modified')) {
    db.exec("ALTER TABLE chats ADD COLUMN last_modified INTEGER DEFAULT 0");
    console.log("Database Migration: Added last_modified column to chats table.");
  }
  if (!columns.includes('syncToCloud')) {
    db.exec("ALTER TABLE chats ADD COLUMN syncToCloud INTEGER DEFAULT 0");
    console.log("Database Migration: Added syncToCloud column to chats table.");
  }
  if (!columns.includes('wdContextWindow')) {
    db.exec("ALTER TABLE chats ADD COLUMN wdContextWindow INTEGER DEFAULT 8192");
    console.log("Database Migration: Added wdContextWindow column to chats table.");
  }
  if (!columns.includes('wdLastChannel')) {
    db.exec("ALTER TABLE chats ADD COLUMN wdLastChannel TEXT DEFAULT 'replacement'");
    console.log("Database Migration: Added wdLastChannel column to chats table.");
  }
  if (!columns.includes('wdUseChatHistory')) {
    db.exec("ALTER TABLE chats ADD COLUMN wdUseChatHistory INTEGER DEFAULT 1");
    console.log("Database Migration: Added wdUseChatHistory column to chats table.");
  }

  const msgTableInfo = db.pragma("table_info(messages)");
  const msgColumns = msgTableInfo.map(col => col.name);
  if (!msgColumns.includes('alternatives')) {
    db.exec("ALTER TABLE messages ADD COLUMN alternatives TEXT");
    console.log("Database Migration: Added alternatives column to messages table.");
  }
  if (!msgColumns.includes('attachedFiles')) {
    db.exec("ALTER TABLE messages ADD COLUMN attachedFiles TEXT");
    console.log("Database Migration: Added attachedFiles column to messages table.");
  }
  if (!msgColumns.includes('last_modified')) {
    db.exec("ALTER TABLE messages ADD COLUMN last_modified INTEGER DEFAULT 0");
    console.log("Database Migration: Added last_modified column to messages table.");
  }

  const wpTableInfo = db.pragma("table_info(writing_profiles)");
  const wpColumns = wpTableInfo.map(col => col.name);
  if (!wpColumns.includes('last_modified')) {
    db.exec("ALTER TABLE writing_profiles ADD COLUMN last_modified INTEGER DEFAULT 0");
    console.log("Database Migration: Added last_modified column to writing_profiles table.");
  }
  if (!wpColumns.includes('syncToCloud')) {
    db.exec("ALTER TABLE writing_profiles ADD COLUMN syncToCloud INTEGER DEFAULT 0");
    console.log("Database Migration: Added syncToCloud column to writing_profiles table.");
  }
  if (!wpColumns.includes('agenticMaxTurns')) {
    db.exec("ALTER TABLE writing_profiles ADD COLUMN agenticMaxTurns INTEGER DEFAULT 3");
    console.log("Database Migration: Added agenticMaxTurns column to writing_profiles table.");
  }
  if (!wpColumns.includes('resultChannel')) {
    db.exec("ALTER TABLE writing_profiles ADD COLUMN resultChannel TEXT DEFAULT 'replacement'");
    console.log("Database Migration: Added resultChannel column to writing_profiles table.");
  }
  if (!wpColumns.includes('contextWindow')) {
    db.exec("ALTER TABLE writing_profiles ADD COLUMN contextWindow INTEGER DEFAULT 8192");
    console.log("Database Migration: Added contextWindow column to writing_profiles table.");
  }

  const apiProfTableInfo = db.pragma("table_info(api_profiles)");
  const apiProfColumns = apiProfTableInfo.map(col => col.name);
  if (!apiProfColumns.includes('customConfig')) {
    db.exec("ALTER TABLE api_profiles ADD COLUMN customConfig TEXT");
    console.log("Database Migration: Added customConfig column to api_profiles table.");
  }

  const kcTableInfo = db.pragma("table_info(knowledge_chunks)");
  const kcColumns = kcTableInfo.map(col => col.name);
  if (!kcColumns.includes('tokenCount')) {
    db.exec("ALTER TABLE knowledge_chunks ADD COLUMN tokenCount INTEGER DEFAULT 0");
    console.log("Database Migration: Added tokenCount column to knowledge_chunks table.");
  }
  if (!kcColumns.includes('enabled')) {
    db.exec("ALTER TABLE knowledge_chunks ADD COLUMN enabled INTEGER DEFAULT 1");
    console.log("Database Migration: Added enabled column to knowledge_chunks table.");
  }
  if (!kcColumns.includes('manuallyEdited')) {
    db.exec("ALTER TABLE knowledge_chunks ADD COLUMN manuallyEdited INTEGER DEFAULT 0");
    console.log("Database Migration: Added manuallyEdited column to knowledge_chunks table.");
  }
  // content_hash identifies a chunk by its text so document re-vectorization can diff
  // by content (not position): an unchanged chunk keeps its vector + tags untouched.
  // ordinal preserves the chunk's order within its owner for context reconstruction.
  if (!kcColumns.includes('content_hash')) {
    db.exec("ALTER TABLE knowledge_chunks ADD COLUMN content_hash TEXT");
    console.log("Database Migration: Added content_hash column to knowledge_chunks table.");
  }
  if (!kcColumns.includes('ordinal')) {
    db.exec("ALTER TABLE knowledge_chunks ADD COLUMN ordinal INTEGER");
    console.log("Database Migration: Added ordinal column to knowledge_chunks table.");
  }

  const cmTableInfo = db.pragma("table_info(constant_memory)");
  const cmColumns = cmTableInfo.map(col => col.name);
  if (!cmColumns.includes('enabled')) {
    db.exec("ALTER TABLE constant_memory ADD COLUMN enabled INTEGER DEFAULT 1");
    console.log("Database Migration: Added enabled column to constant_memory table.");
  }

  // Writing Desk page geometry + typography. The documents table is recent,
  // so existing installs may already have it without these columns.
  const docTableInfo = db.pragma("table_info(documents)");
  const docColumns = docTableInfo.map(col => col.name);
  const docColumnDefs = [
    ["pageSize", "TEXT DEFAULT 'A4'"],
    ["orientation", "TEXT DEFAULT 'portrait'"],
    ["pageWidth", "INTEGER DEFAULT 794"],
    ["pageHeight", "INTEGER DEFAULT 1123"],
    ["marginTop", "INTEGER DEFAULT 96"],
    ["marginRight", "INTEGER DEFAULT 96"],
    ["marginBottom", "INTEGER DEFAULT 96"],
    ["marginLeft", "INTEGER DEFAULT 96"],
    ["defaultFontSize", "INTEGER DEFAULT 18"],
    ["lineHeight", "REAL DEFAULT 1.6"],
    ["paragraphSpacing", "INTEGER DEFAULT 12"],
    ["textAlign", "TEXT DEFAULT 'left'"],
    ["firstLineIndent", "INTEGER DEFAULT 0"],
    ["wordGoal", "INTEGER DEFAULT 0"],
    ["position", "INTEGER DEFAULT 0"],
  ];
  for (const [name, def] of docColumnDefs) {
    if (!docColumns.includes(name)) {
      db.exec(`ALTER TABLE documents ADD COLUMN ${name} ${def}`);
      console.log(`Database Migration: Added ${name} column to documents table.`);
    }
  }

  const pdTableInfo = db.pragma("table_info(pinned_directives)");
  if (!pdTableInfo.map(c => c.name).includes('enabled')) {
    db.exec("ALTER TABLE pinned_directives ADD COLUMN enabled INTEGER DEFAULT 1");
    console.log("Database Migration: Added enabled column to pinned_directives table.");
  }

  // A relation edge can carry a free-text human label (e.g. "father", "rival") on top
  // of its structural relType, so character↔character relationships read naturally.
  const elTableInfo = db.pragma("table_info(entity_links)");
  if (elTableInfo.length && !elTableInfo.map(c => c.name).includes('label')) {
    db.exec("ALTER TABLE entity_links ADD COLUMN label TEXT");
    console.log("Database Migration: Added label column to entity_links table.");
  }

  // Seed the default structured-memory tag vocabulary (idempotent). Descriptions
  // are the classifier criteria, kept short and domain-neutral.
  const seedTag = db.prepare("INSERT OR IGNORE INTO tags (name, description, isEntity, createdAt, last_modified) VALUES (?, ?, ?, ?, ?)");
  const now = Date.now();
  const defaultTags = [
    ["Characters", "People, beings, or named agents present in the scene.", 1],
    ["Factions", "Organized groups present or referenced: guilds, houses, orders, nations, companies, teams.", 1],
    ["Items", "Notable objects in play: weapons, artifacts, tools, documents, substances.", 1],
    ["Locations", "Places where scenes happen: rooms, buildings, settlements, regions, landmarks.", 1],
    ["Races", "Species, lineages, or peoples a character can belong to.", 1],
    ["Creatures", "Monsters, beasts, spirits, or non-personified entities present or referenced.", 1],
    ["Events", "Notable happenings: battles, festivals, holidays, disasters, or milestones worth remembering.", 1],
    ["Planning", "Decisions, goals, deadlines, tasks, and who is responsible for them.", 0],
    ["Chat", "General context: what a conversation segment is broadly about.", 0],
  ];
  for (const [name, description, isEntity] of defaultTags) {
    seedTag.run(name, description, isEntity, now, now);
  }

  const folderTableInfo = db.pragma("table_info(folders)");
  if (!folderTableInfo.map(c => c.name).includes('position')) {
    db.exec("ALTER TABLE folders ADD COLUMN position INTEGER DEFAULT 0");
    console.log("Database Migration: Added position column to folders table.");
  }

  // Migrate the early-shape entities table (category NOT NULL / description /
  // editableByAI) to the per-workspace Worldbuild shape. Its `category NOT NULL`
  // column can't be dropped by ALTER and would block every new insert (which only
  // supplies `type`), so the table is rebuilt, preserving any rows.
  const entityCols = db.pragma("table_info(entities)").map(c => c.name);
  if (entityCols.includes('category')) {
    db.exec(`
      ALTER TABLE entities RENAME TO entities_legacy;
      CREATE TABLE entities (
        id             TEXT PRIMARY KEY,
        workspaceId    TEXT,
        type           TEXT NOT NULL,
        canonicalName  TEXT NOT NULL,
        aliases        TEXT,
        lore           TEXT,
        loreDocumentId TEXT,
        data           TEXT,
        status         TEXT NOT NULL DEFAULT 'confirmed',
        createdAt      INTEGER,
        last_modified  INTEGER DEFAULT 0
      );
      INSERT INTO entities (id, workspaceId, type, canonicalName, aliases, status, createdAt, last_modified)
        SELECT id, NULL, category, canonicalName, aliases, status, createdAt, last_modified FROM entities_legacy;
      DROP TABLE entities_legacy;
    `);
    console.log("Database Migration: Rebuilt entities table to the per-workspace Worldbuild shape.");
  } else if (entityCols.length) {
    // Already new (or fresh) shape: backfill any columns added after first release.
    const addEntityCol = (name, ddl) => {
      if (!entityCols.includes(name)) {
        db.exec(`ALTER TABLE entities ADD COLUMN ${ddl}`);
        console.log(`Database Migration: Added ${name} column to entities table.`);
      }
    };
    addEntityCol('workspaceId', 'workspaceId TEXT');
    addEntityCol('type', 'type TEXT');
    addEntityCol('lore', 'lore TEXT');
    addEntityCol('loreDocumentId', 'loreDocumentId TEXT');
    addEntityCol('data', 'data TEXT');
  }
  // Safe to index now that workspaceId/type are guaranteed to exist (fresh or migrated).
  db.exec("CREATE INDEX IF NOT EXISTS idx_entities_workspace ON entities(workspaceId, type)");
} catch (e) {
  console.error("Migration error adding columns to database tables:", e);
}

// Data migration: patch memoryBlocks entries missing the 'type' field (pre-fix data)
try {
  const chatRows = db.prepare("SELECT id, memoryBlocks FROM chats WHERE memoryBlocks IS NOT NULL AND memoryBlocks != '' AND memoryBlocks != '[]'").all();
  for (const row of chatRows) {
    try {
      const blocks = JSON.parse(row.memoryBlocks);
      let patched = false;
      for (const block of blocks) {
        if (!block.type) {
          block.type = block.id && block.id.startsWith('manual_') ? 'manual' : 'summarized';
          patched = true;
        }
      }
      if (patched) {
        db.prepare('UPDATE chats SET memoryBlocks = ? WHERE id = ?').run(JSON.stringify(blocks), row.id);
        console.log(`Database Migration: Patched memoryBlocks type fields for chat ${row.id}`);
      }
    } catch (parseErr) {
    }
  }
} catch (e) {
  console.error("Migration error patching memoryBlocks data:", e);
}

// Initialize RAG model metadata stamp (used to detect model upgrades)
try {
  const existingMeta = db.prepare("SELECT value FROM settings WHERE key = 'rag_model_metadata'").get();
  if (!existingMeta) {
    // First run — stamp will be written after successful re-index
    console.log("Database: No rag_model_metadata found. Will be created after first indexing.");
  }
} catch (e) {
  console.error("Migration error checking rag_model_metadata:", e);
}

function encryptExistingKeys() {
  try {
    const rows = db.prepare("SELECT id, apiKey, customConfig FROM api_profiles").all();
    db.transaction(() => {
      let keyCount = 0;
      let configCount = 0;
      for (const row of rows) {
        let needsUpdate = false;
        let encryptedKey = row.apiKey;
        let encryptedConfig = row.customConfig;

        if (row.apiKey && !row.apiKey.startsWith('safe:')) {
          encryptedKey = db.encryptApiKey(row.apiKey);
          keyCount++;
          needsUpdate = true;
        }

        if (row.customConfig && !row.customConfig.startsWith('safe:')) {
          encryptedConfig = db.encryptApiKey(row.customConfig);
          configCount++;
          needsUpdate = true;
        }

        if (needsUpdate) {
          db.prepare("UPDATE api_profiles SET apiKey = ?, customConfig = ? WHERE id = ?").run(encryptedKey, encryptedConfig, row.id);
        }
      }
      if (keyCount > 0 || configCount > 0) {
        console.log(`[Database Migration] Encrypted ${keyCount} API keys and ${configCount} custom configurations.`);
      }
    })();
  } catch (e) {
    console.error("[Database Migration] Error encrypting existing API profiles:", e);
  }
}

// --- CONSTANT MEMORY HELPERS (manual always-on snippets) ---

db.getConstantSnippets = function(ownerId, ownerType = 'profile') {
  try {
    const rows = db.prepare(
      'SELECT id, title, content, keywords, createdAt, enabled FROM constant_memory WHERE ownerId = ? AND ownerType = ? ORDER BY createdAt ASC'
    ).all(ownerId, ownerType);
    return rows.map(r => ({
      id: r.id,
      title: r.title || 'Custom Memory',
      content: r.content || '',
      keywords: r.keywords ? JSON.parse(r.keywords) : [],
      createdAt: r.createdAt,
      enabled: r.enabled !== 0
    }));
  } catch (e) {
    console.error('[Constant Memory] getConstantSnippets failed:', e);
    return [];
  }
};

db.replaceConstantSnippets = function(ownerId, snippets, ownerType = 'profile') {
  try {
    const del = db.prepare('DELETE FROM constant_memory WHERE ownerId = ? AND ownerType = ?');
    const ins = db.prepare(`
      INSERT OR REPLACE INTO constant_memory (id, ownerId, ownerType, title, content, keywords, createdAt, last_modified, enabled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    db.transaction(() => {
      del.run(ownerId, ownerType);
      for (const s of (snippets || [])) {
        ins.run(
          s.id || `manual_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
          ownerId,
          ownerType,
          s.title || s.name || s.source || 'Custom Memory',
          s.content || s.text || '',
          JSON.stringify(s.keywords || []),
          s.createdAt || Date.now(),
          Date.now(),
          s.enabled === false ? 0 : 1
        );
      }
    })();
  } catch (e) {
    console.error('[Constant Memory] replaceConstantSnippets failed:', e);
  }
};

db.deleteConstantSnippetByTitle = function(ownerId, title, ownerType = 'profile') {
  try {
    db.prepare('DELETE FROM constant_memory WHERE ownerId = ? AND ownerType = ? AND title = ?').run(ownerId, ownerType, title);
  } catch (e) {
    console.error('[Constant Memory] deleteConstantSnippetByTitle failed:', e);
  }
};

// Migrate legacy profile full_context.json manual snippets into the constant_memory table.
// File-content caches in the same JSON are intentionally dropped (re-derived from disk on demand).
function migrateConstantMemoryToSQLite() {
  const profilesDir = path.join(dataDir, 'AI Profiles');
  if (!fs.existsSync(profilesDir)) return;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO constant_memory (id, ownerId, ownerType, title, content, keywords, createdAt, last_modified)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  try {
    fs.readdirSync(profilesDir).forEach(profileId => {
      const fcPath = path.join(profilesDir, profileId, 'KnowledgeBase', 'full_context.json');
      if (!fs.existsSync(fcPath)) return;
      try {
        const data = JSON.parse(fs.readFileSync(fcPath, 'utf8'));
        if (Array.isArray(data)) {
          const manual = data.filter(c => c.type === 'manual');
          if (manual.length > 0) {
            db.transaction(() => {
              for (const m of manual) {
                insert.run(
                  m.id || `manual_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                  profileId,
                  'profile',
                  m.name || m.source || 'Custom Memory',
                  m.content || m.text || '',
                  JSON.stringify(m.keywords || []),
                  m.createdAt || Date.now(),
                  Date.now()
                );
              }
            })();
            console.log(`[Constant Memory Migration] Migrated ${manual.length} manual snippets for profile ${profileId}`);
          }
        }
        fs.renameSync(fcPath, fcPath + '.bak');
      } catch (e) {
        console.error(`[Constant Memory Migration] Failed for profile ${profileId}:`, e);
      }
    });
  } catch (e) {
    console.error('[Constant Memory Migration] Error reading profiles directory:', e);
  }
}

// --- ONBOARDING SEED ---

// ProseMirror node size: text = char count; any other node = its content size + 2
// (open + close tokens). Used to compute exact document positions for the seeded
// suggestion so it re-anchors instead of going stale on open.
function pmNodeSize(node) {
  if (node.type === 'text') return (node.text || '').length;
  return (node.content || []).reduce((s, c) => s + pmNodeSize(c), 0) + 2;
}

const seedId = (prefix) => `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;

// First-run onboarding: ship three editable AI Profiles (no API key by default) and
// one example workspace that already contains generated results — a chat exchange, a
// chapter with a pending AI edit, and canon memories. The point is "value before the
// key": the user sees real output before any configuration. Idempotent and one-shot —
// gated by a settings flag, so deleting the example never resurrects it.
function seedOnboarding() {
  try {
    const seeded = db.prepare("SELECT value FROM settings WHERE key = 'onboarding_seeded'").get();
    if (seeded) return;

    const now = Date.now();

    // All three ship agentic-RAG ON (isAgentic=1) with the default agentic loop — no
    // custom agenticPrompt, so the built-in behaviour drives retrieval.
    const profiles = [
      {
        id: seedId('wp'),
        name: 'Editing',
        description: '(Example) Line-editing for the Writing Desk. Select text and invoke to tighten and sharpen your prose.',
        color: '#7CC4F2',
        resultChannel: 'replacement',
        systemPrompt: "You are an expert line editor working inside a novelist's manuscript. Given a selected passage, you rewrite it to be tighter, clearer, and more evocative: cut redundancy and filler, replace vague abstractions with concrete sensory detail, vary sentence rhythm, and strengthen verbs. Always preserve the author's voice, tense, point of view, and intended meaning, and keep any established facts about characters and places intact. Return only the rewritten passage, with no preamble or explanation.",
      },
      {
        id: seedId('wp'),
        name: 'Brainstorming',
        description: '(Example) A thinking partner for the Chat tab. Talk through plot, character, and ideas.',
        color: '#F2C14E',
        resultChannel: 'replacement',
        systemPrompt: "You are a creative brainstorming partner for a fiction writer. Your job is to expand the writer's thinking, not to write the manuscript for them. Ask sharp, specific questions; offer several concrete, distinct options rather than one safe answer; and pressure-test plot logic, character motivation, and theme. Draw on the story's established canon and earlier conversation so your ideas stay consistent with the world. Keep your tone collaborative and energetic. Only write finished prose when the writer explicitly asks for it.",
      },
      {
        id: seedId('wp'),
        name: 'Review & Coherence',
        description: '(Example) Checks your text against your canon and flags contradictions. Try it from the Writing Desk.',
        color: '#C792EA',
        resultChannel: 'analysis',
        systemPrompt: "You are a continuity and coherence editor for a novel-in-progress. Compare the text under review against the project's established facts, memories, and worldbuilding, and surface problems: factual contradictions, timeline inconsistencies, characters acting against their established traits or knowledge, unexplained plot gaps, and details that clash with canon. For each issue, name what is wrong, quote or reference the conflicting text, and suggest how to resolve it. Be concise and specific. Report your findings as a critique only — never rewrite or replace the author's body text.",
      },
    ];

    const insertProfile = db.prepare(`
      INSERT INTO writing_profiles (
        id, name, description, color, apiProfileId, model, temperature, maxTokens,
        systemPrompt, knowledgeFiles, manualMode, manualJson, isAgentic, agenticPrompt, agenticMaxTurns,
        resultChannel, contextWindow, last_modified, syncToCloud
      ) VALUES (?, ?, ?, ?, NULL, NULL, ?, ?, ?, '[]', 0, '', 1, '', 3, ?, ?, ?, 0)
    `);

    // The example workspace, with the three profiles pre-activated.
    const workspaceId = seedId('chat');
    const memoryBlocks = [
      {
        id: seedId('manual'),
        title: 'Canon — The Lighthouse',
        summary: 'The lighthouse on Mourne Cliff has stood abandoned for forty years. Its last keeper, Aldous Finn, vanished without a trace in 1983. The villagers avoid the cliff path after dark.',
        type: 'manual', strategy: 'constant', profiles: [], keywords: ['lighthouse', 'Aldous Finn', 'Mourne Cliff'], enabled: true,
      },
      {
        id: seedId('manual'),
        title: 'Canon — Protagonist',
        summary: 'Mara Finn, 28, is Aldous’s granddaughter. She returns to the village to sell the family property, but the lighthouse and her grandfather’s disappearance pull her in.',
        type: 'manual', strategy: 'constant', profiles: [], keywords: ['Mara Finn', 'protagonist'], enabled: true,
      },
    ];

    // Ship a background image so the example also showcases workspace personalization.
    // Copied out of the app bundle into the workspace folder and served via app-file://;
    // best-effort — a failed copy just leaves the workspace without a background.
    let backgroundImage = '';
    try {
      const srcBg = path.join(__dirname, '..', 'assets', 'onboarding-bg.svg');
      if (fs.existsSync(srcBg)) {
        const chatDir = path.join(dataDir, 'ChatHistory', workspaceId);
        fs.mkdirSync(chatDir, { recursive: true });
        const destBg = path.join(chatDir, `bg_image_${now}.svg`);
        fs.copyFileSync(srcBg, destBg);
        backgroundImage = destBg;
      }
    } catch (bgErr) {
      console.error('[Onboarding] Background image copy failed:', bgErr);
    }

    // The chapter (a Writing Desk document) and its seeded pending edit. The target
    // paragraph is a single un-marked text node so textBetween() returns it verbatim,
    // which is what the renderer checks before showing the suggestion.
    const originalText = 'The lighthouse was very old and it was on a cliff. It was very tall and the light at the top did not work anymore because no one had fixed it for a long time.';
    const proposedText = 'The lighthouse had stood on the cliff for a century, gaunt and weatherbeaten, its lantern long since gone dark. No keeper had climbed those stairs in years.';

    const docBlocks = [
      { type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: 'Chapter One — The Lighthouse' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'The road to Mourne Cliff ended where the tarmac gave out, and from there it was gravel, then grass, then nothing but the wind. Mara left the car by the rusted gate and walked the rest of the way up, her grandfather’s keys cold in her fist.' }] },
      { type: 'paragraph', content: [{ type: 'text', text: originalText }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'She had not seen the place since she was a child. The years had not been kind to it. Gulls wheeled overhead but none of them landed on the rail, and the door at the base hung open a hand’s width, as though someone had left in a hurry and never come back.' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Forty years since anyone had kept the light. Forty years since Aldous Finn had walked up this same path and simply not walked down again. The village had its stories — they always did — but Mara had come for the deed and the sale, not the stories. That was what she told herself, anyway, as she pushed the door the rest of the way open.' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Inside, the stairs spiralled up into the dark, salt-rotted and soft underfoot. On the bottom step, where no rain could have reached it, lay a single page torn from a logbook — and the handwriting on it was her grandfather’s.' }] },
      { type: 'paragraph', content: [{ type: 'text', text: 'Try it yourself: select any sentence, click "Invoke AI", and pick the Editing profile. Open the Chat tab to keep brainstorming with the AI, or check the Worldbuild tab to see the characters and places behind this scene. (You’ll need to add an API key in Settings before the AI can generate anything new.)' }] },
    ];
    const docContent = JSON.stringify({ type: 'doc', content: docBlocks });

    // The weak paragraph (index 2) is the suggestion target. fromPos = total size of
    // every block before it + 1 to enter its content; toPos spans the text exactly.
    const targetIndex = 2;
    let fromPos = 1;
    for (let i = 0; i < targetIndex; i++) fromPos += pmNodeSize(docBlocks[i]);
    const toPos = fromPos + originalText.length;

    const docId = seedId('doc');

    // Worldbuild entities that tie back to the chapter and the brainstorming chat.
    const eMara = seedId('ent');
    const eAldous = seedId('ent');
    const eLighthouse = seedId('ent');
    const eLogbook = seedId('ent');
    const entities = [
      { id: eMara, type: 'Characters', name: 'Mara Finn', aliases: ['Mara'], data: { status: 'alive', loreDocumentIds: [docId] },
        lore: 'Aldous Finn’s granddaughter, 28. She returns to Mourne Cliff to settle the family estate and sell the lighthouse, but the open door and the torn logbook page pull her into her grandfather’s disappearance.' },
      { id: eAldous, type: 'Characters', name: 'Aldous Finn', aliases: ['Aldous', 'the keeper', 'the old keeper'], data: { status: 'missing', loreDocumentIds: [docId] },
        lore: 'The lighthouse’s last keeper. Vanished without a trace in 1983 and was never found. His handwriting survives on a logbook page Mara discovers on the bottom step.' },
      { id: eLighthouse, type: 'Locations', name: 'Mourne Cliff Lighthouse', aliases: ['the lighthouse', 'Mourne Cliff'], data: { loreDocumentIds: [docId] },
        lore: 'A tall, weatherbeaten lighthouse abandoned for forty years, its lantern long dark. The villagers avoid the cliff path after sundown. Setting of Chapter One.' },
      { id: eLogbook, type: 'Items', name: 'The Keeper’s Logbook', aliases: ['the logbook', 'the journal', 'the torn page'], data: { loreDocumentIds: [docId] },
        lore: 'Aldous’s keeper’s logbook. A single page, torn loose, is found at the foot of the stairs in his handwriting — dry, though no rain could have reached it.' },
    ];

    const insertEntity = db.prepare(`
      INSERT INTO entities (id, workspaceId, type, canonicalName, aliases, lore, loreDocumentId, data, status, createdAt, last_modified)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?)
    `);
    const insertLink = db.prepare(`
      INSERT INTO entity_links (id, workspaceId, fromId, relType, toId, createdAt)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertMessage = db.prepare(`
      INSERT INTO messages (id, chatId, role, content, aiName, aiColor, debugNotice, attachedFiles, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, '', '[]', ?)
    `);

    // A four-message brainstorming exchange (user/AI/user/AI) about this very story, so
    // the chat already shows real, on-topic output. Plain rows — no API call.
    const brainstormColor = profiles[1].color;
    const messages = [
      { role: 'user', name: '', color: '',
        content: "I'm starting a story about a woman who inherits an abandoned lighthouse where her grandfather vanished. How do I make the opening feel ominous without just saying it's scary?" },
      { role: 'assistant', name: 'Brainstorming', color: brainstormColor,
        content: "Lean on specifics instead of adjectives. \"Scary\" tells the reader what to feel; concrete detail makes them feel it. Three angles for Mara’s arrival:\n\n1. **Let the setting do the work** — gulls that wheel but won’t land on the rail, salt-rotted stairs that give underfoot, a door already hanging open.\n2. **Use her body, not her judgment** — the keys cold in her fist, a held breath, the urge to look back down the path. Fear lives in the nervous system before it becomes a thought.\n3. **Withhold** — ominous is mostly about what isn’t explained. Don’t name the threat; let the forty-year silence imply it.\n\nWant me to push on one of these, or sketch what she finds inside?" },
      { role: 'user', name: '', color: '',
        content: "I like the idea of her finding something inside. It should hook the mystery of Aldous immediately. What could it be?" },
      { role: 'assistant', name: 'Brainstorming', color: brainstormColor,
        content: "You want an object that’s small, undeniable, and impossible to explain away — proof he was here that raises more questions than it answers. A few options:\n\n- **A torn page from his keeper’s logbook**, in his handwriting, lying on the bottom step where no rain could have reached it. Intimate, and it implies an interrupted final entry.\n- **The lamp mechanism wound and oiled**, as if someone tended it last week — but the light still doesn’t work.\n- **Her own name**, written in the logbook in his hand, dated after he disappeared.\n\nThe torn page is the cleanest hook: it’s personal, it points forward (what did the entry say?), and it makes the empty lighthouse feel recently, wrongly, inhabited. You could end Chapter One on her picking it up." },
    ];

    const seedAll = db.transaction(() => {
      for (const p of profiles) {
        insertProfile.run(
          p.id, p.name, p.description, p.color, 0.7, 2048, p.systemPrompt, p.resultChannel, 8192, now
        );
      }

      db.prepare(`
        INSERT INTO chats (
          id, title, description, updatedAt, isPinned, maxContext, archiveThreshold, summarizedIndex,
          activeProfiles, activeWorkflows, backgroundImage, backdropOpacity, userBubbleOpacity, aiBubbleOpacity, memoryBlocks, knowledgeFiles, autoSummarize, syncToCloud
        ) VALUES (?, ?, ?, ?, 0, 128000, 60000, 0, ?, '[]', ?, 75, 100, 0, ?, '[]', 0, 0)
      `).run(
        workspaceId,
        'Example Project — The Lighthouse',
        '(Example) A sample workspace to explore Kallamo. Edit the chapter, continue the chat, or review against canon.',
        now,
        JSON.stringify(profiles.map(p => p.id)),
        backgroundImage,
        JSON.stringify(memoryBlocks)
      );

      db.prepare(`
        INSERT INTO documents (id, workspaceId, folderId, title, content, position, createdAt, updatedAt, last_modified)
        VALUES (?, ?, NULL, ?, ?, 0, ?, ?, ?)
      `).run(docId, workspaceId, 'Chapter One', docContent, now, now, now);

      db.prepare(`
        INSERT INTO pending_suggestions
          (id, documentId, workspaceId, channel, fromPos, toPos, originalText, proposedText, profileId, intermediatePrompt, status, createdAt, last_modified)
        VALUES (?, ?, ?, 'replacement', ?, ?, ?, ?, ?, ?, 'ok', ?, ?)
      `).run(
        seedId('psug'), docId, workspaceId, fromPos, toPos, originalText, proposedText,
        profiles[0].id, 'Tighten this and make it more evocative.', now, now
      );

      messages.forEach((m, i) => {
        insertMessage.run(seedId('msg'), workspaceId, m.role, m.content, m.name, m.color, now + i * 1000);
      });

      for (const e of entities) {
        insertEntity.run(
          e.id, workspaceId, e.type, e.name,
          JSON.stringify(e.aliases || []), e.lore || '', e.loreDocumentId || null,
          JSON.stringify(e.data || {}), now, now
        );
      }
      // Relations that mirror the scene: Mara is connected to Aldous; the logbook was
      // created by Aldous and is found in the lighthouse.
      insertLink.run(seedId('lnk'), workspaceId, eMara, 'connected_to', eAldous, now);
      insertLink.run(seedId('lnk'), workspaceId, eLogbook, 'created_by', eAldous, now);
      insertLink.run(seedId('lnk'), workspaceId, eLogbook, 'found_in', eLighthouse, now);

      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('onboarding_seeded', '1')").run();
    });

    seedAll();
    console.log('[Onboarding] Seeded 3 example profiles + example workspace.');
  } catch (e) {
    console.error('[Onboarding] Seeding failed:', e);
  }
}

// --- CORE EXECUTION ---

// Perform migrations when the app is ready so safeStorage is available
if (app.isReady()) {
  migrateConstantMemoryToSQLite();
  encryptExistingKeys();
  seedOnboarding();
} else {
  app.whenReady().then(() => {
    migrateConstantMemoryToSQLite();
    encryptExistingKeys();
    seedOnboarding();
  });
}

module.exports = db;
