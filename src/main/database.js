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
  if (!columns.includes('last_modified')) {
    db.exec("ALTER TABLE chats ADD COLUMN last_modified INTEGER DEFAULT 0");
    console.log("Database Migration: Added last_modified column to chats table.");
  }
  if (!columns.includes('syncToCloud')) {
    db.exec("ALTER TABLE chats ADD COLUMN syncToCloud INTEGER DEFAULT 0");
    console.log("Database Migration: Added syncToCloud column to chats table.");
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

  // Seed the default structured-memory tag vocabulary (idempotent). Descriptions
  // are the classifier criteria, kept short and domain-neutral.
  const seedTag = db.prepare("INSERT OR IGNORE INTO tags (name, description, isEntity, createdAt, last_modified) VALUES (?, ?, ?, ?, ?)");
  const now = Date.now();
  const defaultTags = [
    ["Characters", "People, beings, or named agents present in the scene.", 1],
    ["Factions", "Organized groups present or referenced: guilds, houses, orders, nations, companies, teams.", 1],
    ["Items", "Notable objects in play: weapons, artifacts, tools, documents, substances.", 1],
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

// --- CORE EXECUTION ---

// Perform migrations when the app is ready so safeStorage is available
if (app.isReady()) {
  migrateConstantMemoryToSQLite();
  encryptExistingKeys();
} else {
  app.whenReady().then(() => {
    migrateConstantMemoryToSQLite();
    encryptExistingKeys();
  });
}

module.exports = db;
