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
    createdAt INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS deleted_records (
    id TEXT PRIMARY KEY,
    table_name TEXT NOT NULL,
    deleted_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_owner ON knowledge_chunks(ownerId, ownerType);

  CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(
    chunkId,
    text
  );

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

  const apiProfTableInfo = db.pragma("table_info(api_profiles)");
  const apiProfColumns = apiProfTableInfo.map(col => col.name);
  if (!apiProfColumns.includes('customConfig')) {
    db.exec("ALTER TABLE api_profiles ADD COLUMN customConfig TEXT");
    console.log("Database Migration: Added customConfig column to api_profiles table.");
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

function migrateData() {
  const apiDir = path.join(dataDir, 'API Connections');
  const profilesDir = path.join(dataDir, 'AI Profiles');
  const chatsDir = path.join(dataDir, 'ChatHistory');
  const workflowsDir = path.join(dataDir, 'Workflows');
  const settingsFile = path.join(dataDir, 'settings.json');

  const loadFilesFromDir = (dir) => {
    const arr = [];
    if (fs.existsSync(dir)) {
      fs.readdirSync(dir).forEach(file => {
        if (file.endsWith('.json')) {
          try { arr.push(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))); }
          catch (e) { console.error(`Error loading JSON ${file}`, e); }
        }
      });
    }
    return arr;
  };

  if (fs.existsSync(apiDir)) {
    const apis = loadFilesFromDir(apiDir);
    if (apis.length > 0) {
      const insertApi = db.prepare(`
        INSERT OR IGNORE INTO api_profiles (id, name, provider, baseUrl, apiKey, models)
        VALUES (?, ?, ?, ?, ?, ?)
      `);
      db.transaction(() => {
        for (const api of apis) {
          insertApi.run(
            api.id,
            api.name || 'Untitled API',
            api.provider || 'openai',
            api.baseUrl || '',
            db.encryptApiKey(api.apiKey || ''),
            JSON.stringify(api.models || [])
          );
        }
      })();
      console.log(`Migrated ${apis.length} API connections.`);
    }
    try { fs.renameSync(apiDir, `${apiDir}_migrated`); } catch (e) { }
  }

  if (fs.existsSync(profilesDir)) {
    const profiles = [];
    fs.readdirSync(profilesDir).forEach(item => {
      const pFolder = path.join(profilesDir, item);
      if (fs.existsSync(pFolder) && fs.statSync(pFolder).isDirectory() && !item.endsWith('_migrated')) {
        const files = fs.readdirSync(pFolder);
        const jsonFile = files.find(f => f.endsWith('.json'));
        if (jsonFile) {
          try { profiles.push(JSON.parse(fs.readFileSync(path.join(pFolder, jsonFile), 'utf8'))); } catch (e) { }
        }
      }
    });
    if (profiles.length > 0) {
      const insertProfile = db.prepare(`
        INSERT OR IGNORE INTO writing_profiles (
          id, name, description, color, apiProfileId, model, temperature, maxTokens,
          systemPrompt, knowledgeFiles, manualMode, manualJson, isAgentic, agenticPrompt
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      db.transaction(() => {
        for (const p of profiles) {
          insertProfile.run(
            p.id,
            p.name || 'Untitled Profile',
            p.description || '',
            p.color || '#FBCB2D',
            p.apiProfileId || '',
            p.model || '',
            p.temperature ?? 0.7,
            p.maxTokens ?? 1000,
            p.systemPrompt || '',
            JSON.stringify(p.knowledgeFiles || []),
            p.manualMode ? 1 : 0,
            p.manualJson || '',
            p.isAgentic ? 1 : 0,
            p.agenticPrompt || ''
          );
        }
      })();
      console.log(`Migrated ${profiles.length} profiles.`);
    }
    try { fs.renameSync(profilesDir, `${profilesDir}_migrated`); } catch (e) { }
  }

  if (fs.existsSync(chatsDir)) {
    const chats = [];
    fs.readdirSync(chatsDir).forEach(item => {
      const cFolder = path.join(chatsDir, item);
      if (fs.existsSync(cFolder) && fs.statSync(cFolder).isDirectory() && !item.endsWith('_migrated')) {
        const jsonFile = path.join(cFolder, `${item}.json`);
        if (fs.existsSync(jsonFile)) {
          try { chats.push(JSON.parse(fs.readFileSync(jsonFile, 'utf8'))); } catch (e) { }
        }
      }
    });
    if (chats.length > 0) {
      const insertChat = db.prepare(`
        INSERT OR IGNORE INTO chats (
          id, title, updatedAt, isPinned, maxContext, archiveThreshold, summarizedIndex,
          activeProfiles, activeWorkflows, backgroundImage, backdropOpacity, userBubbleOpacity, aiBubbleOpacity
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertMessage = db.prepare(`
        INSERT OR IGNORE INTO messages (id, chatId, role, content, aiName, aiColor, debugNotice, attachedFiles, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      db.transaction(() => {
        for (const c of chats) {
          const visual = c.visualConfig || {};
          insertChat.run(
            c.id,
            c.title || 'Untitled Chat',
            c.updatedAt || Date.now(),
            c.isPinned ? 1 : 0,
            c.maxContext ?? 128000,
            c.archiveThreshold ?? 60000,
            c.summarizedIndex ?? 0,
            JSON.stringify(c.activeProfiles || []),
            JSON.stringify(c.activeWorkflows || []),
            visual.backgroundImage || '',
            visual.backdropOpacity ?? 75,
            visual.userBubbleOpacity ?? 100,
            visual.aiBubbleOpacity ?? 0
          );
          if (c.messages && c.messages.length > 0) {
            for (const msg of c.messages) {
              insertMessage.run(
                msg.id || `${c.id}_msg_${Math.random()}`,
                c.id,
                msg.role || 'user',
                msg.content || '',
                msg.aiName || '',
                msg.aiColor || '',
                msg.debugNotice || '',
                JSON.stringify(msg.attachedFiles || []),
                msg.createdAt || Date.now()
              );
            }
          }
        }
      })();
      console.log(`Migrated ${chats.length} chats with their messages.`);
    }
    try { fs.renameSync(chatsDir, `${chatsDir}_migrated`); } catch (e) { }
  }

  if (fs.existsSync(workflowsDir)) {
    const wfs = loadFilesFromDir(workflowsDir);
    if (wfs.length > 0) {
      const insertWorkflow = db.prepare(`
        INSERT OR IGNORE INTO workflows (id, name, entryProfileId, steps)
        VALUES (?, ?, ?, ?)
      `);
      db.transaction(() => {
        for (const w of wfs) {
          insertWorkflow.run(
            w.id,
            w.name || 'Untitled Workflow',
            w.entryProfileId || '',
            JSON.stringify(w.steps || [])
          );
        }
      })();
      console.log(`Migrated ${wfs.length} workflows.`);
    }
    try { fs.renameSync(workflowsDir, `${workflowsDir}_migrated`); } catch (e) { }
  }

  if (fs.existsSync(settingsFile)) {
    try {
      const s = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('interface', JSON.stringify(s.interface || {}));
      db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('advanced', JSON.stringify(s.advanced || {}));
      console.log('Migrated settings.');
    } catch (e) {
      console.error('Error migrating settings.json:', e);
    }
    try { fs.renameSync(settingsFile, `${settingsFile}_migrated`); } catch (e) { }
  }
}

// Scan and migrate legacy vector JSON files to SQLite knowledge_chunks table
function migrateVectorsToSQLite() {
  const profilesDir = path.join(dataDir, 'AI Profiles');
  const chatsDir = path.join(dataDir, 'ChatHistory');

  const insertChunk = db.prepare(`
    INSERT OR IGNORE INTO knowledge_chunks (id, ownerId, ownerType, source, text, vector, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertFts = db.prepare(`
    INSERT OR IGNORE INTO knowledge_chunks_fts (chunkId, text)
    VALUES (?, ?)
  `);

  if (fs.existsSync(profilesDir)) {
    try {
      fs.readdirSync(profilesDir).forEach(profileId => {
        const dbPath = path.join(profilesDir, profileId, 'KnowledgeBase', 'vector_db.json');
        if (fs.existsSync(dbPath)) {
          try {
            const vectorDB = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
            if (Array.isArray(vectorDB) && vectorDB.length > 0) {
              db.transaction(() => {
                for (const chunk of vectorDB) {
                  const chunkId = chunk.id || `chunk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
                  insertChunk.run(
                    chunkId,
                    profileId,
                    'profile_kb',
                    chunk.source || 'Unknown Source',
                    chunk.text || '',
                    JSON.stringify(chunk.vector || []),
                    chunk.createdAt || Date.now()
                  );
                  insertFts.run(chunkId, chunk.text || '');
                }
              })();
              console.log(`Vector Migration: Migrated ${vectorDB.length} chunks for profile ${profileId}`);
            }
            fs.renameSync(dbPath, dbPath + '.bak');
          } catch (e) {
            console.error(`Error migrating profile vector DB for ${profileId}:`, e);
          }
        }
      });
    } catch (err) {
      console.error("Error reading profiles directory during vector migration:", err);
    }
  }

  if (fs.existsSync(chatsDir)) {
    try {
      fs.readdirSync(chatsDir).forEach(chatId => {
        const kbPath = path.join(chatsDir, chatId, 'KnowledgeBase', 'vector_db.json');
        if (fs.existsSync(kbPath)) {
          try {
            const vectorDB = JSON.parse(fs.readFileSync(kbPath, 'utf8'));
            if (Array.isArray(vectorDB) && vectorDB.length > 0) {
              db.transaction(() => {
                for (const chunk of vectorDB) {
                  const chunkId = chunk.id || `chunk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
                  insertChunk.run(
                    chunkId,
                    chatId,
                    'chat_kb',
                    chunk.source || 'Unknown Source',
                    chunk.text || '',
                    JSON.stringify(chunk.vector || []),
                    chunk.createdAt || Date.now()
                  );
                  insertFts.run(chunkId, chunk.text || '');
                }
              })();
              console.log(`Vector Migration: Migrated ${vectorDB.length} KB chunks for chat ${chatId}`);
            }
            fs.renameSync(kbPath, kbPath + '.bak');
          } catch (e) {
            console.error(`Error migrating chat KB vector DB for ${chatId}:`, e);
          }
        }

        const memPath = path.join(chatsDir, chatId, 'Memory', 'vector_db.json');
        if (fs.existsSync(memPath)) {
          try {
            const vectorDB = JSON.parse(fs.readFileSync(memPath, 'utf8'));
            if (Array.isArray(vectorDB) && vectorDB.length > 0) {
              db.transaction(() => {
                for (const chunk of vectorDB) {
                  const chunkId = chunk.id || `chunk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
                  insertChunk.run(
                    chunkId,
                    chatId,
                    'chat_memory',
                    chunk.title || 'Summarized History',
                    chunk.text || '',
                    JSON.stringify(chunk.vector || []),
                    chunk.createdAt || Date.now()
                  );
                  insertFts.run(chunkId, chunk.text || '');
                }
              })();
              console.log(`Vector Migration: Migrated ${vectorDB.length} memory chunks for chat ${chatId}`);
            }
            fs.renameSync(memPath, memPath + '.bak');
          } catch (e) {
            console.error(`Error migrating chat memories vector DB for ${chatId}:`, e);
          }
        }
      });
    } catch (err) {
      console.error("Error reading chats directory during vector migration:", err);
    }
  }
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

// --- CORE EXECUTION ---

// Perform migrations when the app is ready so safeStorage is available
if (app.isReady()) {
  migrateData();
  migrateVectorsToSQLite();
  encryptExistingKeys();
} else {
  app.whenReady().then(() => {
    migrateData();
    migrateVectorsToSQLite();
    encryptExistingKeys();
  });
}

module.exports = db;
