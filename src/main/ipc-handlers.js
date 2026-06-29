const { ipcMain, shell, dialog, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const os = require('os');
const https = require('https');
const crypto = require('crypto');
const db = require('./database');
const { chunkText, extractTextFromFile, extractDocxHtml, vectorizeChunks, insertChunksToDb, deleteChunksFromDb, searchKnowledgeBase, searchChatKnowledgeBase, searchChatMemories, RAG_MODEL_ID, RAG_MODEL_DIM, generateEmbeddingVector, countTokens } = require('./rag-service');

// Resolve the APPDATA data path
const appDataPath = process.env.APPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), '.local', 'share'));
const dataDir = path.join(appDataPath, 'Kallamo');
const profilesDir = path.join(dataDir, 'AI Profiles');
const chatsDir = path.join(dataDir, 'ChatHistory');

// Helper to index new knowledge base files in writing profile
async function indexProfileKnowledgeBase(sender, profileId, knowledgeFilesInput) {
  const knowledgeFiles = typeof knowledgeFilesInput === 'string'
    ? JSON.parse(knowledgeFilesInput)
    : (knowledgeFilesInput || []);

  const kbDir = path.join(profilesDir, profileId, 'KnowledgeBase');
  if (!fs.existsSync(kbDir)) {
    fs.mkdirSync(kbDir, { recursive: true });
  }

  let chunkSize = 500;
  try {
    const rowAdvanced = db.prepare("SELECT value FROM settings WHERE key = 'advanced'").get();
    if (rowAdvanced) {
      const advanced = JSON.parse(rowAdvanced.value);
      chunkSize = parseInt(advanced.chunkSize, 10) || 500;
    }
  } catch (e) { }

  let modified = false;

  const ragFiles = knowledgeFiles.filter(file => file.strategy === 'rag_search');

  const activeRagSources = new Set(ragFiles.map(f => f.name));
  const existingChunksSources = db.prepare('SELECT DISTINCT source FROM knowledge_chunks WHERE ownerId = ? AND ownerType = ?').all(profileId, 'profile_kb').map(r => r.source);

  for (const src of existingChunksSources) {
    const allKnownFiles = new Set(knowledgeFiles.map(f => f.name));
    if (allKnownFiles.has(src) && !activeRagSources.has(src)) {
      console.log(`[RAG Indexer] Garbage collecting chunks for profile file: ${src}`);
      deleteChunksFromDb(profileId, 'profile_kb', src);
      modified = true;
    }
  }

  for (const src of existingChunksSources) {
    const allKnownFiles = new Set(knowledgeFiles.map(f => f.name));
    if (!allKnownFiles.has(src)) {
      // Don't GC manual snippets — they are not represented in knowledgeFiles
      const onlyManual = db.prepare(
        "SELECT COUNT(*) AS cnt FROM knowledge_chunks WHERE ownerId = ? AND ownerType = ? AND source = ? AND id NOT LIKE 'manual_%' AND id NOT LIKE 'mem_%'"
      ).get(profileId, 'profile_kb', src);
      if (onlyManual.cnt === 0) continue;

      console.log(`[RAG Indexer] Garbage collecting deleted profile file chunks: ${src}`);
      deleteChunksFromDb(profileId, 'profile_kb', src);
      modified = true;
    }
  }

  for (const file of ragFiles) {
    if (!file.internalPath || !fs.existsSync(file.internalPath)) {
      console.warn(`[RAG Indexer] File not found: ${file.internalPath}`);
      continue;
    }

    let currentMtime = 0;
    try {
      currentMtime = fs.statSync(file.internalPath).mtimeMs;
    } catch (err) {
      console.warn(`[RAG Indexer] Failed to stat file: ${file.internalPath}`, err);
      continue;
    }

    const chunkCountRow = db.prepare('SELECT COUNT(*) as cnt FROM knowledge_chunks WHERE ownerId = ? AND ownerType = ? AND source = ?').get(profileId, 'profile_kb', file.name);
    const hasChunks = chunkCountRow && chunkCountRow.cnt > 0;

    if (hasChunks && file.lastIndexedMtime === currentMtime) {
      console.log(`[RAG Indexer] Skipping unmodified file: ${file.name}`);
      continue;
    }

    console.log(`[RAG Indexer] Indexing/Re-indexing file: ${file.name}`);

    deleteChunksFromDb(profileId, 'profile_kb', file.name);

    try {
      if (sender) {
        sender.send('vectorization-progress', {
          type: 'profile',
          id: profileId,
          status: 'indexing',
          fileName: file.name,
          current: 0,
          total: 100
        });
      }

      const fileText = await extractTextFromFile(file.internalPath);
      const chunks = chunkText(fileText, chunkSize);

      const vectors = await vectorizeChunks(chunks, file.name, (curr, tot) => {
        if (sender) {
          sender.send('vectorization-progress', {
            type: 'profile',
            id: profileId,
            status: 'indexing',
            fileName: file.name,
            current: curr,
            total: tot
          });
        }
      });

      insertChunksToDb(profileId, 'profile_kb', vectors);

      file.lastIndexedMtime = currentMtime;
      modified = true;
      console.log(`[RAG Indexer] Indexed ${chunks.length} chunks for ${file.name}`);
    } catch (err) {
      console.error(`[RAG Indexer] Failed to index ${file.name}:`, err);
      if (sender) {
        sender.send('vectorization-progress', {
          type: 'profile',
          id: profileId,
          status: 'error',
          fileName: file.name,
          error: err.message
        });
      }
    }
  }

  if (modified) {
    db.prepare('UPDATE writing_profiles SET knowledgeFiles = ? WHERE id = ?').run(JSON.stringify(knowledgeFiles), profileId);
  }

  if (sender) {
    sender.send('vectorization-progress', {
      type: 'profile',
      id: profileId,
      status: 'completed'
    });
  }
}

async function indexChatKnowledgeBase(sender, chatId, knowledgeFilesInput) {
  const knowledgeFiles = typeof knowledgeFilesInput === 'string'
    ? JSON.parse(knowledgeFilesInput)
    : (knowledgeFilesInput || []);

  const kbDir = path.join(chatsDir, chatId, 'KnowledgeBase');
  if (!fs.existsSync(kbDir)) {
    fs.mkdirSync(kbDir, { recursive: true });
  }

  let chunkSize = 500;
  try {
    const rowAdvanced = db.prepare("SELECT value FROM settings WHERE key = 'advanced'").get();
    if (rowAdvanced) {
      const advanced = JSON.parse(rowAdvanced.value);
      chunkSize = parseInt(advanced.chunkSize, 10) || 500;
    }
  } catch (e) { }

  let modified = false;

  const ragFiles = knowledgeFiles.filter(file => file.strategy === 'rag_search');

  const activeRagSources = new Set(ragFiles.map(f => f.name));
  const existingChunksSources = db.prepare('SELECT DISTINCT source FROM knowledge_chunks WHERE ownerId = ? AND ownerType = ?').all(chatId, 'chat_kb').map(r => r.source);

  for (const src of existingChunksSources) {
    const allKnownFiles = new Set(knowledgeFiles.map(f => f.name));
    if (allKnownFiles.has(src) && !activeRagSources.has(src)) {
      console.log(`[Chat RAG Indexer] Garbage collecting chunks for chat file: ${src}`);
      deleteChunksFromDb(chatId, 'chat_kb', src);
      modified = true;
    }
  }

  for (const src of existingChunksSources) {
    const allKnownFiles = new Set(knowledgeFiles.map(f => f.name));
    if (!allKnownFiles.has(src)) {
      // Don't GC manual snippets — they are not represented in knowledgeFiles
      const onlyManual = db.prepare(
        "SELECT COUNT(*) AS cnt FROM knowledge_chunks WHERE ownerId = ? AND ownerType = ? AND source = ? AND id NOT LIKE 'manual_%' AND id NOT LIKE 'mem_%'"
      ).get(chatId, 'chat_kb', src);
      if (onlyManual.cnt === 0) continue;

      console.log(`[Chat RAG Indexer] Garbage collecting deleted chat file chunks: ${src}`);
      deleteChunksFromDb(chatId, 'chat_kb', src);
      modified = true;
    }
  }

  for (const file of ragFiles) {
    if (!file.internalPath || !fs.existsSync(file.internalPath)) {
      console.warn(`[Chat RAG Indexer] File not found: ${file.internalPath}`);
      continue;
    }

    let currentMtime = 0;
    try {
      currentMtime = fs.statSync(file.internalPath).mtimeMs;
    } catch (err) {
      console.warn(`[Chat RAG Indexer] Failed to stat file: ${file.internalPath}`, err);
      continue;
    }

    const chunkCountRow = db.prepare('SELECT COUNT(*) as cnt FROM knowledge_chunks WHERE ownerId = ? AND ownerType = ? AND source = ?').get(chatId, 'chat_kb', file.name);
    const hasChunks = chunkCountRow && chunkCountRow.cnt > 0;

    if (hasChunks && file.lastIndexedMtime === currentMtime) {
      console.log(`[Chat RAG Indexer] Skipping unmodified file: ${file.name}`);
      continue;
    }

    console.log(`[Chat RAG Indexer] Indexing/Re-indexing file: ${file.name}`);

    deleteChunksFromDb(chatId, 'chat_kb', file.name);

    try {
      if (sender) {
        sender.send('vectorization-progress', {
          type: 'chat',
          id: chatId,
          status: 'indexing',
          fileName: file.name,
          current: 0,
          total: 100
        });
      }

      const fileText = await extractTextFromFile(file.internalPath);
      const chunks = chunkText(fileText, chunkSize);

      const vectors = await vectorizeChunks(chunks, file.name, (curr, tot) => {
        if (sender) {
          sender.send('vectorization-progress', {
            type: 'chat',
            id: chatId,
            status: 'indexing',
            fileName: file.name,
            current: curr,
            total: tot
          });
        }
      });

      insertChunksToDb(chatId, 'chat_kb', vectors);

      file.lastIndexedMtime = currentMtime;
      modified = true;
      console.log(`[Chat RAG Indexer] Indexed ${chunks.length} chunks for ${file.name}`);
    } catch (err) {
      console.error(`[Chat RAG Indexer] Failed to index ${file.name}:`, err);
      if (sender) {
        sender.send('vectorization-progress', {
          type: 'chat',
          id: chatId,
          status: 'error',
          fileName: file.name,
          error: err.message
        });
      }
    }
  }

  if (modified) {
    db.prepare('UPDATE chats SET knowledgeFiles = ? WHERE id = ?').run(JSON.stringify(knowledgeFiles), chatId);
  }

  if (sender) {
    sender.send('vectorization-progress', {
      type: 'chat',
      id: chatId,
      status: 'completed'
    });
  }
}


// ==========================================
// --- API CONNECTIONS IPC HANDLERS ---
// ==========================================
ipcMain.handle('get-api-profiles', async () => {
  try {
    const rows = db.prepare('SELECT * FROM api_profiles').all();
    return rows.map(r => ({
      ...r,
      apiKey: db.decryptApiKey(r.apiKey),
      customConfig: db.decryptApiKey(r.customConfig),
      models: JSON.parse(r.models || '[]')
    }));
  } catch (e) {
    console.error("Error fetching API profiles:", e);
    return [];
  }
});

ipcMain.handle('save-api-profile', async (event, profile) => {
  try {
    const insert = db.prepare(`
      INSERT OR REPLACE INTO api_profiles (id, name, provider, baseUrl, apiKey, customConfig, models)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const encryptedKey = db.encryptApiKey(profile.apiKey || '');
    const encryptedConfig = db.encryptApiKey(profile.customConfig || '');
    insert.run(
      profile.id,
      profile.name,
      profile.provider,
      profile.baseUrl || '',
      encryptedKey,
      encryptedConfig,
      typeof profile.models === 'string' ? profile.models : JSON.stringify(profile.models || [])
    );
    return { success: true };
  } catch (e) {
    console.error("Error saving API profile:", e);
    throw e;
  }
});

ipcMain.handle('delete-api-profile', async (event, id) => {
  try {
    db.prepare('DELETE FROM api_profiles WHERE id = ?').run(id);
    return { success: true };
  } catch (e) {
    console.error("Error deleting API profile:", e);
    throw e;
  }
});

// ==========================================
// --- AI/WRITING PROFILES IPC HANDLERS ---
// ==========================================
ipcMain.handle('get-writing-profiles', async () => {
  try {
    const rows = db.prepare('SELECT * FROM writing_profiles').all();
    return rows.map(r => ({
      ...r,
      knowledgeFiles: JSON.parse(r.knowledgeFiles || '[]'),
      manualMode: r.manualMode === 1,
      isAgentic: r.isAgentic === 1
    }));
  } catch (e) {
    console.error("Error fetching writing profiles:", e);
    return [];
  }
});

ipcMain.handle('save-writing-profile', async (event, profile) => {
  try {
    const exists = db.prepare('SELECT id, knowledgeFiles FROM writing_profiles WHERE id = ?').get(profile.id);
    const newKbStr = typeof profile.knowledgeFiles === 'string' ? profile.knowledgeFiles : JSON.stringify(profile.knowledgeFiles || []);
    let kbChanged = true;
    if (exists) {
      kbChanged = (exists.knowledgeFiles !== newKbStr);
    }

    if (exists) {
      const update = db.prepare(`
        UPDATE writing_profiles SET
          name = ?, description = ?, color = ?, apiProfileId = ?, model = ?, temperature = ?, maxTokens = ?,
          systemPrompt = ?, knowledgeFiles = ?, manualMode = ?, manualJson = ?, isAgentic = ?, agenticPrompt = ?,
          agenticMaxTurns = ?, resultChannel = ?, contextWindow = ?, syncToCloud = ?
        WHERE id = ?
      `);
      update.run(
        profile.name,
        profile.description || '',
        profile.color || '#FBCB2D',
        profile.apiProfileId,
        profile.model,
        profile.temperature ?? 0.7,
        profile.maxTokens ?? 2048,
        profile.systemPrompt || '',
        newKbStr,
        profile.manualMode ? 1 : 0,
        profile.manualJson || '',
        profile.isAgentic ? 1 : 0,
        profile.agenticPrompt || '',
        profile.agenticMaxTurns ?? 3,
        profile.resultChannel || 'replacement',
        profile.contextWindow ?? 8192,
        profile.syncToCloud ?? 0,
        profile.id
      );
    } else {
      const insert = db.prepare(`
        INSERT INTO writing_profiles (
          id, name, description, color, apiProfileId, model, temperature, maxTokens,
          systemPrompt, knowledgeFiles, manualMode, manualJson, isAgentic, agenticPrompt, agenticMaxTurns,
          resultChannel, contextWindow, syncToCloud
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      insert.run(
        profile.id,
        profile.name,
        profile.description || '',
        profile.color || '#FBCB2D',
        profile.apiProfileId,
        profile.model,
        profile.temperature ?? 0.7,
        profile.maxTokens ?? 2048,
        profile.systemPrompt || '',
        newKbStr,
        profile.manualMode ? 1 : 0,
        profile.manualJson || '',
        profile.isAgentic ? 1 : 0,
        profile.agenticPrompt || '',
        profile.agenticMaxTurns ?? 3,
        profile.resultChannel || 'replacement',
        profile.contextWindow ?? 8192,
        profile.syncToCloud ?? 0
      );
    }

    if (kbChanged && profile.knowledgeFiles) {
      indexProfileKnowledgeBase(event.sender, profile.id, profile.knowledgeFiles).catch(e => {
        console.error("Background profile indexing error:", e);
      });
    }

    return { success: true };
  } catch (e) {
    console.error("Error saving writing profile:", e);
    throw e;
  }
});

ipcMain.handle('delete-writing-profile', async (event, id) => {
  try {
    db.prepare('DELETE FROM writing_profiles WHERE id = ?').run(id);

    // Cascade: remove this profile's KB chunks and any now-orphaned FTS rows
    db.prepare('DELETE FROM knowledge_chunks WHERE ownerId = ?').run(id);
    db.prepare('DELETE FROM knowledge_chunks_fts WHERE chunkId NOT IN (SELECT id FROM knowledge_chunks)').run();

    const profileFolder = path.join(profilesDir, id);
    if (fs.existsSync(profileFolder)) {
      fs.rmSync(profileFolder, { recursive: true, force: true });
    }

    return { success: true };
  } catch (e) {
    console.error("Error deleting writing profile:", e);
    throw e;
  }
});

// --- LOCAL AI ENGINE MANAGERS (v1.0.5) ---

const ENGINE_ASSETS = {
  'win32-x64': {
    url: 'https://github.com/Kallamo/Kallamo/releases/download/engine-onnx-1.24.3/onnxruntime-node-1.24.3-win32-x64.zip',
    sha256: '34df0f5957732f8da940fb6acd6869b341496d48fcfeb8aac8aa74d98104c67e'
  },
  'win32-arm64': {
    url: 'https://github.com/Kallamo/Kallamo/releases/download/engine-onnx-1.24.3/onnxruntime-node-1.24.3-win32-arm64.zip',
    sha256: 'c92b91cf4fd34a110cba1ea1fde630ea44f6dea2213955ff6af1fe4fbcac592c'
  },
  'darwin-arm64': {
    url: 'https://github.com/Kallamo/Kallamo/releases/download/engine-onnx-1.24.3/onnxruntime-node-1.24.3-darwin-arm64.zip',
    sha256: '1bc4a3f428875f057183741e2cd70f5e758e2fe720297d5f851e32288cb18d13'
  },
  'linux-x64': {
    url: 'https://github.com/Kallamo/Kallamo/releases/download/engine-onnx-1.24.3/onnxruntime-node-1.24.3-linux-x64.zip',
    sha256: 'b1a9adde0a0558a0e1b6712429285ec9c8b41a7c35ee9361b20382fc9f5eef24'
  },
  'linux-arm64': {
    url: 'https://github.com/Kallamo/Kallamo/releases/download/engine-onnx-1.24.3/onnxruntime-node-1.24.3-linux-arm64.zip',
    sha256: '07c75780822c2a2ee0b5b0fc187cd68aaea4f51b534e0a4d06c854b617002723'
  }
};

function downloadFileWithProgress(url, destPath, progressCallback, abortSignal) {
  return new Promise((resolve, reject) => {
    const cleanupAndReject = (err) => {
      try { if (fs.existsSync(destPath)) fs.unlinkSync(destPath); } catch {}
      reject(err);
    };

    function get(currentUrl, redirectsLeft = 5) {
      const req = https.get(currentUrl, (res) => {
        // Follow 301/302/303/307/308
        if ([301, 302, 303, 307, 308].includes(res.statusCode) && res.headers.location) {
          res.resume(); // drain
          if (redirectsLeft <= 0) return cleanupAndReject(new Error('Too many redirects'));
          return get(res.headers.location, redirectsLeft - 1);
        }

        if (res.statusCode !== 200) {
          res.resume();
          return cleanupAndReject(new Error(`Download failed: HTTP ${res.statusCode}`));
        }

        const total = parseInt(res.headers['content-length'], 10) || 0;
        let loaded = 0;
        const file = fs.createWriteStream(destPath);

        res.on('data', (c) => {
          loaded += c.length;
          if (progressCallback) progressCallback(loaded, total);
        });

        res.pipe(file); // backpressure handled by pipe
        file.on('finish', () => file.close(() => resolve())); // resolve only after flush
        file.on('error', cleanupAndReject);
        res.on('error', cleanupAndReject);
      });

      req.setTimeout(60000, () => req.destroy(new Error('Download timed out')));
      req.on('error', cleanupAndReject);

      if (abortSignal) {
        abortSignal.addEventListener('abort', () => req.destroy(new Error('Download cancelled')), { once: true });
      }
    }
    get(url);
  });
}

function computeSha256(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (data) => hash.update(data));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', (err) => reject(err));
  });
}

function safeSend(sender, channel, data) {
  if (sender && !sender.isDestroyed()) {
    sender.send(channel, data);
  }
}

ipcMain.handle('get-engine-status', async (event) => {
  try {
    const { isLocalEngineInstalled } = require('./rag-service');
    return {
      installed: isLocalEngineInstalled(),
      platform: process.platform,
      arch: process.arch
    };
  } catch (e) {
    console.error("Error checking engine status:", e);
    throw e;
  }
});

let isDownloadingEngine = false;
let activeDownloadAbort = null;

async function executeEngineDownload(sender, isBackground = false) {
  if (isDownloadingEngine) {
    throw new Error('An engine download is already in progress.');
  }

  const { runtimeDir, isLocalEngineInstalled } = require('./rag-service');
  const tempZip = path.join(runtimeDir, 'engine-download-temp.zip');
  const stagingDir = path.join(runtimeDir, 'staging');
  const finalDir = path.join(runtimeDir, 'node_modules', 'onnxruntime-node');

  const abortController = new AbortController();
  activeDownloadAbort = abortController;

  try {
    isDownloadingEngine = true;
    const platformKey = `${process.platform}-${process.arch}`;
    const asset = ENGINE_ASSETS[platformKey];

    if (!asset) {
      throw new Error(`Local AI Engine is not supported on this platform: ${platformKey}`);
    }

    // Ensure runtime directory exists
    if (!fs.existsSync(runtimeDir)) {
      fs.mkdirSync(runtimeDir, { recursive: true });
    }

    // 1. Download
    safeSend(sender, 'download-engine-progress', { status: 'downloading', loaded: 0, total: 100, percent: 0, isBackground });

    await downloadFileWithProgress(asset.url, tempZip, (loaded, total) => {
      const percent = total > 0 ? Math.round((loaded / total) * 100) : 0;
      safeSend(sender, 'download-engine-progress', { status: 'downloading', loaded, total, percent, isBackground });
    }, abortController.signal);

    // 2. Verify Checksum
    safeSend(sender, 'download-engine-progress', { status: 'verifying', percent: 100, isBackground });

    if (asset.sha256 && asset.sha256 !== 'mock_sha256_placeholder' && !asset.sha256.startsWith('YOUR_')) {
      const computedHash = await computeSha256(tempZip);
      if (computedHash !== asset.sha256) {
        throw new Error(`SHA-256 integrity check failed. Expected: ${asset.sha256}, Got: ${computedHash}`);
      }
    } else {
      console.warn(`[Engine Download] Skipping checksum verification (mock or unset hash).`);
    }

    // 3. Extract to staging directory (atomic install)
    safeSend(sender, 'download-engine-progress', { status: 'extracting', percent: 100, isBackground });

    // Clean up any previous staging attempt
    if (fs.existsSync(stagingDir)) {
      fs.rmSync(stagingDir, { recursive: true, force: true });
    }
    fs.mkdirSync(stagingDir, { recursive: true });

    const zip = new AdmZip(tempZip);
    const entries = zip.getEntries();
    const hasNestedNodeModules = entries.some(e => e.entryName.startsWith('node_modules/'));
    const stagingTarget = hasNestedNodeModules
      ? stagingDir  // zip has node_modules/ prefix — extract at staging root
      : path.join(stagingDir, 'onnxruntime-node');

    if (!fs.existsSync(stagingTarget)) {
      fs.mkdirSync(stagingTarget, { recursive: true });
    }
    zip.extractAllTo(stagingTarget, true);

    // 4. Verify staged install has the actual native binary
    const stagedOnnxDir = hasNestedNodeModules
      ? path.join(stagingDir, 'node_modules', 'onnxruntime-node')
      : path.join(stagingDir, 'onnxruntime-node');

    const stagedPackageJson = path.join(stagedOnnxDir, 'package.json');
    if (!fs.existsSync(stagedPackageJson)) {
      throw new Error('Extraction failed: package.json not found in the staged engine package. The zip structure may be invalid.');
    }

    // Check for the native .node binary
    const { findNodeBinary } = require('./rag-service');
    if (typeof findNodeBinary === 'function' && !findNodeBinary(stagedOnnxDir)) {
      throw new Error('Extraction failed: Native .node binary not found in the staged engine package. The bundle may be corrupt or for a different platform.');
    }

    // 5. Atomic swap: remove old install, move staging into place
    const nodeModulesDir = path.join(runtimeDir, 'node_modules');
    if (!fs.existsSync(nodeModulesDir)) {
      fs.mkdirSync(nodeModulesDir, { recursive: true });
    }
    if (fs.existsSync(finalDir)) {
      fs.rmSync(finalDir, { recursive: true, force: true });
    }
    fs.renameSync(stagedOnnxDir, finalDir);

    // 6. Completed
    safeSend(sender, 'download-engine-progress', { status: 'completed', percent: 100, isBackground });

    // Trigger startup reindexing now that the engine is installed successfully
    if (isBackground) {
      console.log('[Auto-Download] Download completed successfully. Initiating background re-indexing...');
      performReindexIfNeeded();
    }

    return { success: true };
  } catch (e) {
    console.error("Error downloading local engine:", e);
    const networkCodes = ['ENOTFOUND', 'ETIMEDOUT', 'ECONNREFUSED', 'ECONNRESET', 'EAI_AGAIN'];
    let errorMsg;
    if (e.message === 'Download cancelled') {
      errorMsg = 'Download was cancelled.';
    } else if (e.code && networkCodes.includes(e.code) || /ENOTFOUND|ETIMEDOUT|ECONNREFUSED|ECONNRESET|EAI_AGAIN|timed out/i.test(e.message)) {
      errorMsg = "No internet connection. Check your network and try again.";
    } else {
      errorMsg = e.message;
    }
    safeSend(sender, 'download-engine-progress', { status: 'error', error: errorMsg, isBackground });
    throw e;
  } finally {
    isDownloadingEngine = false;
    activeDownloadAbort = null;

    // Clean up temp zip
    if (fs.existsSync(tempZip)) {
      try { fs.unlinkSync(tempZip); } catch (err) {
        console.error("Failed to delete temp engine zip:", err);
      }
    }
    // Clean up staging directory
    if (fs.existsSync(stagingDir)) {
      try { fs.rmSync(stagingDir, { recursive: true, force: true }); } catch (err) {
        console.error("Failed to delete staging directory:", err);
      }
    }
  }
}

ipcMain.handle('cancel-engine-download', async () => {
  if (activeDownloadAbort) {
    activeDownloadAbort.abort();
    return { success: true };
  }
  return { success: false, reason: 'No active download' };
});

ipcMain.handle('download-engine', async (event) => {
  return executeEngineDownload(event.sender, false);
});

ipcMain.handle('delete-engine', async (event) => {
  try {
    const { runtimeDir, resetLocalEngine } = require('./rag-service');
    if (fs.existsSync(runtimeDir)) {
      fs.rmSync(runtimeDir, { recursive: true, force: true });
    }
    // Reset in-memory engine state so a same-session re-download/re-init works cleanly
    resetLocalEngine();
    return { success: true };
  } catch (e) {
    console.error("Error deleting local engine:", e);
    throw e;
  }
});

// Collect searchable file chunks for any source that has at least one manually-edited
// chunk. The WHOLE source travels (not just edited chunks) so the importer can
// restore a consistent chunk set and skip re-chunking that file from disk. Manual
// snippets (manual_/mem_) travel in manual_blocks.json, so they're excluded here.
function collectEditedSearchableChunks(ownerId, ownerType) {
  const editedSources = db.prepare(
    "SELECT DISTINCT source FROM knowledge_chunks WHERE ownerId = ? AND ownerType = ? AND manuallyEdited = 1 AND id NOT LIKE 'manual_%' AND id NOT LIKE 'mem_%'"
  ).all(ownerId, ownerType).map(r => r.source);
  if (editedSources.length === 0) return [];

  const selectChunks = db.prepare(
    "SELECT id, source, text, manuallyEdited FROM knowledge_chunks WHERE ownerId = ? AND ownerType = ? AND source = ? AND id NOT LIKE 'manual_%' AND id NOT LIKE 'mem_%' ORDER BY id"
  );
  const out = [];
  for (const source of editedSources) {
    for (const v of selectChunks.all(ownerId, ownerType, source)) {
      let cleanText = v.text || '';
      if (cleanText.startsWith('Document:') && cleanText.includes('\nContent: ')) {
        cleanText = cleanText.substring(cleanText.indexOf('\nContent: ') + 10);
      }
      let keywords = [];
      const tagsMatch = v.text ? v.text.match(/Tags: (.*)\n/) : null;
      if (tagsMatch && tagsMatch[1]) {
        keywords = tagsMatch[1].split(',').map(k => k.trim());
      }
      out.push({
        source: v.source,
        text: cleanText,
        keywords,
        manuallyEdited: v.manuallyEdited === 1
      });
    }
  }
  return out;
}

// Restore searchable chunks carried by an exported KB sidecar. Re-vectorizes each
// chunk's text with the LOCAL embedding model (so it's model-agnostic across the
// sender/receiver), preserves the manuallyEdited flag, and marks the owning file
// 'rag_search' + matching mtime so the background indexer skips re-chunking it (which
// would discard the edits) and the constant-file handler won't delete the chunks.
// `renameMap` maps the original exported source name to the (possibly renamed) local
// file name. `files` is the live knowledgeFiles array (mutated in place).
async function restoreSearchableChunks(ownerId, ownerType, sidecarChunks, renameMap, files) {
  if (!Array.isArray(sidecarChunks) || sidecarChunks.length === 0) return;

  const bySource = new Map();
  for (const c of sidecarChunks) {
    const importedName = (renameMap && renameMap[c.source]) || c.source;
    if (!bySource.has(importedName)) bySource.set(importedName, []);
    bySource.get(importedName).push(c);
  }

  const insertChunk = db.prepare(`
    INSERT OR REPLACE INTO knowledge_chunks (id, ownerId, ownerType, source, text, vector, createdAt, tokenCount, enabled, manuallyEdited)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);
  const insertFts = db.prepare(`
    INSERT OR REPLACE INTO knowledge_chunks_fts (chunkId, text)
    VALUES (?, ?)
  `);

  for (const [importedName, chunks] of bySource.entries()) {
    // Drop anything previously indexed for this source to avoid duplicate chunks.
    deleteChunksFromDb(ownerId, ownerType, importedName);

    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      const cleanKeywords = Array.isArray(c.keywords)
        ? c.keywords.map(k => { const t = k.trim().toLowerCase(); return t.startsWith('#') ? t : `#${t}`; }).filter(Boolean)
        : [];
      const vectorData = await vectorizeChunks([c.text], importedName, null, cleanKeywords);
      const chunk = vectorData[0] || null;
      if (!chunk) continue;
      const chunkId = `chunk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}_${i}`;
      const textToStore = chunk.text;
      db.transaction(() => {
        insertChunk.run(
          chunkId, ownerId, ownerType, importedName, textToStore,
          JSON.stringify(chunk.vector), Date.now(), countTokens(textToStore), 1,
          c.manuallyEdited ? 1 : 0
        );
        insertFts.run(chunkId, textToStore);
      })();
    }

    const fileEntry = files && files.find(f => f.name === importedName);
    if (fileEntry) {
      fileEntry.strategy = 'rag_search';
      try {
        if (fileEntry.internalPath && fs.existsSync(fileEntry.internalPath)) {
          fileEntry.lastIndexedMtime = fs.statSync(fileEntry.internalPath).mtimeMs;
        }
      } catch (e) { /* leave mtime unset; indexer will re-chunk as a fallback */ }
    }
  }
}

// Export AI Profile Config (.klp custom zip packaging, stripped of API links, variables resolved, optional KB)
ipcMain.handle('export-ai-profile', async (event, { profile, exportKb }) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    const saveResult = await dialog.showSaveDialog(win, {
      title: 'Export AI Profile',
      defaultPath: `${profile.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_profile.klp`,
      filters: [{ name: 'Kallamo Profile Package', extensions: ['klp'] }]
    });

    if (saveResult.canceled || !saveResult.filePath) {
      return { success: false, canceled: true };
    }

    event.sender.send('export-progress', { progress: 10, status: 'Initializing export container...' });
    const zip = new AdmZip();

    event.sender.send('export-progress', { progress: 20, status: 'Compiling profile settings...' });
    const profileJson = JSON.stringify({
      ...profile,
      apiProfileId: '',
      model: ''
    }, null, 2);
    zip.addFile('profile.json', Buffer.from(profileJson, 'utf8'));

    if (exportKb) {
      event.sender.send('export-progress', { progress: 30, status: 'Gathering knowledge base configuration...' });

      const manualBlocks = [];
      const chunks = db.prepare('SELECT id, source, text, vector, createdAt FROM knowledge_chunks WHERE ownerId = ? AND ownerType = ?').all(profile.id, 'profile_kb');
      chunks.forEach((v) => {
        if (v.id && (v.id.startsWith('mem_') || v.id.startsWith('manual_'))) {
          let cleanText = v.text || '';
          if (cleanText.startsWith('Document:') && cleanText.includes('\nContent: ')) {
            cleanText = cleanText.substring(cleanText.indexOf('\nContent: ') + 10);
          }
          let keywords = [];
          const tagsMatch = v.text ? v.text.match(/Tags: (.*)\n/) : null;
          if (tagsMatch && tagsMatch[1]) {
            keywords = tagsMatch[1].split(',').map(k => k.trim());
          }
          manualBlocks.push({
            source: v.source,
            text: cleanText,
            keywords: keywords
          });
        }
      });
      zip.addFile('manual_blocks.json', Buffer.from(JSON.stringify(manualBlocks, null, 2), 'utf8'));

      const editedChunks = collectEditedSearchableChunks(profile.id, 'profile_kb');
      if (editedChunks.length > 0) {
        zip.addFile('searchable_chunks.json', Buffer.from(JSON.stringify(editedChunks, null, 2), 'utf8'));
      }

      const profileRow = db.prepare('SELECT knowledgeFiles FROM writing_profiles WHERE id = ?').get(profile.id);
      if (profileRow && profileRow.knowledgeFiles) {
        try {
          const fileList = JSON.parse(profileRow.knowledgeFiles);
          const totalFiles = fileList.length;
          for (let i = 0; i < totalFiles; i++) {
            const file = fileList[i];
            if (file.internalPath && fs.existsSync(file.internalPath)) {
              const filePercent = Math.round(30 + ((i / totalFiles) * 50));
              event.sender.send('export-progress', { progress: filePercent, status: `Adding file: ${file.name}...` });
              zip.addLocalFile(file.internalPath, 'files');
            }
          }
        } catch (err) {
          console.error("Error reading profile files for export:", err);
        }
      }
    }

    event.sender.send('export-progress', { progress: 85, status: 'Compressing and writing archive...' });
    zip.writeZip(saveResult.filePath);

    event.sender.send('export-progress', { progress: 100, status: 'Export completed successfully!' });
    return { success: true };
  } catch (e) {
    console.error("Error exporting AI profile:", e);
    throw e;
  }
});

// Import AI Profile Config (Extracts .klp package, handles collisions, re-indexes)
ipcMain.handle('import-ai-profile', async (event) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    const openResult = await dialog.showOpenDialog(win, {
      title: 'Import AI Profile',
      filters: [{ name: 'Kallamo Profile Package', extensions: ['klp'] }],
      properties: ['openFile']
    });

    if (openResult.canceled || openResult.filePaths.length === 0) {
      return { success: false, canceled: true };
    }

    const filePath = openResult.filePaths[0];
    event.sender.send('import-progress', { progress: 10, status: 'Reading profile package archive...' });
    const zip = new AdmZip(filePath);

    const profileEntry = zip.getEntry('profile.json');
    if (!profileEntry) {
      throw new Error('Invalid package: profile.json not found inside package.');
    }

    const profileJson = zip.readAsText(profileEntry);
    const importedProfile = JSON.parse(profileJson);

    let newProfileId = importedProfile.id;
    let newProfileName = importedProfile.name;

    const idExists = db.prepare('SELECT id FROM writing_profiles WHERE id = ?').get(newProfileId);
    const nameExists = db.prepare('SELECT id FROM writing_profiles WHERE name = ?').get(newProfileName);

    if (idExists || nameExists) {
      newProfileId = 'profile_' + Math.random().toString(36).substr(2, 9);
      newProfileName = `${newProfileName} - Imported`;
    }

    importedProfile.apiProfileId = '';
    importedProfile.model = '';

    const knowledgeFilesMetadata = [];
    const kbDir = path.join(profilesDir, newProfileId, 'KnowledgeBase');

    const manualBlocksEntry = zip.getEntry('manual_blocks.json');
    const filesEntries = zip.getEntries().filter(entry => entry.entryName.startsWith('files/') && !entry.isDirectory);

    if (manualBlocksEntry || filesEntries.length > 0) {
      if (!fs.existsSync(kbDir)) {
        fs.mkdirSync(kbDir, { recursive: true });
      }

      event.sender.send('import-progress', { progress: 20, status: 'Extracting knowledge base files...' });

      const totalFiles = filesEntries.length;
      for (let i = 0; i < totalFiles; i++) {
        const entry = filesEntries[i];
        const fileName = path.basename(entry.entryName);
        const destPath = path.join(kbDir, fileName);

        const filePercent = Math.round(20 + ((i / totalFiles) * 50));
        event.sender.send('import-progress', { progress: filePercent, status: `Extracting ${fileName}...` });

        const contentBuffer = entry.getData();
        fs.writeFileSync(destPath, contentBuffer);

        knowledgeFilesMetadata.push({
          name: fileName,
          originalPath: '',
          internalPath: destPath,
          size: contentBuffer.length,
          strategy: 'full_context'
        });
      }

      if (manualBlocksEntry) {
        event.sender.send('import-progress', { progress: 70, status: 'Extracting manual snippets...' });
        const manualBlocksText = zip.readAsText(manualBlocksEntry);
        const manualBlocks = JSON.parse(manualBlocksText);

        const totalBlocks = manualBlocks.length;
        for (let i = 0; i < totalBlocks; i++) {
          const block = manualBlocks[i];
          const blockPercent = Math.round(70 + ((i / totalBlocks) * 20));
          event.sender.send('import-progress', { progress: blockPercent, status: `Vectorizing manual snippet: ${block.source}...` });

          const newBlockId = `manual_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
          const cleanKeywords = Array.isArray(block.keywords)
            ? block.keywords.map(k => {
              const trimmed = k.trim().toLowerCase();
              return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
            }).filter(Boolean)
            : [];

          const vectors = await vectorizeChunks([block.text], block.source, null, cleanKeywords);
          const chunk = vectors[0] || null;
          if (chunk) {
            chunk.id = newBlockId;
            chunk.keywords = cleanKeywords;
            insertChunksToDb(newProfileId, 'profile_kb', [chunk]);
          }
        }
      }

      const searchableEntry = zip.getEntry('searchable_chunks.json');
      if (searchableEntry) {
        event.sender.send('import-progress', { progress: 90, status: 'Restoring edited searchable chunks...' });
        try {
          const sidecar = JSON.parse(zip.readAsText(searchableEntry));
          await restoreSearchableChunks(newProfileId, 'profile_kb', sidecar, null, knowledgeFilesMetadata);
        } catch (err) {
          console.error("Error restoring searchable chunks during profile import:", err);
        }
      }
    }

    event.sender.send('import-progress', { progress: 95, status: 'Saving profile to database...' });

    const insert = db.prepare(`
      INSERT INTO writing_profiles (
        id, name, description, color, apiProfileId, model, temperature, maxTokens,
        systemPrompt, knowledgeFiles, manualMode, manualJson, isAgentic, agenticPrompt, agenticMaxTurns, syncToCloud
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run(
      newProfileId,
      newProfileName,
      importedProfile.description || '',
      importedProfile.color || '#FBCB2D',
      '',
      '',
      importedProfile.temperature ?? 0.7,
      importedProfile.maxTokens ?? 2048,
      importedProfile.systemPrompt || '',
      JSON.stringify(knowledgeFilesMetadata),
      importedProfile.manualMode ? 1 : 0,
      importedProfile.manualJson || '',
      importedProfile.isAgentic ? 1 : 0,
      importedProfile.agenticPrompt || '',
      importedProfile.agenticMaxTurns ?? 3,
      importedProfile.syncToCloud ?? 0
    );

    event.sender.send('import-progress', { progress: 100, status: 'Import completed successfully!' });

    if (knowledgeFilesMetadata.length > 0) {
      indexProfileKnowledgeBase(event.sender, newProfileId, knowledgeFilesMetadata).catch(e => {
        console.error("Background profile indexing error during import:", e);
      });
    }

    return {
      success: true,
      profile: {
        id: newProfileId,
        name: newProfileName,
        description: importedProfile.description || '',
        color: importedProfile.color || '#FBCB2D',
        apiProfileId: '',
        model: '',
        temperature: importedProfile.temperature ?? 0.7,
        maxTokens: importedProfile.maxTokens ?? 2048,
        systemPrompt: importedProfile.systemPrompt || '',
        knowledgeFiles: knowledgeFilesMetadata,
        manualMode: importedProfile.manualMode === 1 || importedProfile.manualMode === true,
        manualJson: importedProfile.manualJson || '',
        isAgentic: importedProfile.isAgentic === 1 || importedProfile.isAgentic === true,
        agenticPrompt: importedProfile.agenticPrompt || '',
        agenticMaxTurns: importedProfile.agenticMaxTurns ?? 3,
        syncToCloud: importedProfile.syncToCloud ?? 0
      }
    };
  } catch (e) {
    console.error("Error importing AI profile:", e);
    throw e;
  }
});

// Export Knowledge Base standalone
ipcMain.handle('export-knowledge-base', async (event, { profileId, profileName }) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    const saveResult = await dialog.showSaveDialog(win, {
      title: 'Export Knowledge Base',
      defaultPath: `${profileName.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_kb.klkb`,
      filters: [{ name: 'Kallamo KB Package', extensions: ['klkb'] }]
    });

    if (saveResult.canceled || !saveResult.filePath) {
      return { success: false, canceled: true };
    }

    event.sender.send('export-progress', { progress: 10, status: 'Gathering knowledge base configurations...' });
    const zip = new AdmZip();

    const manualBlocks = [];
    const chunks = db.prepare('SELECT id, source, text, vector, createdAt FROM knowledge_chunks WHERE ownerId = ? AND ownerType = ?').all(profileId, 'profile_kb');
    chunks.forEach((v) => {
      if (v.id && (v.id.startsWith('mem_') || v.id.startsWith('manual_'))) {
        let cleanText = v.text || '';
        if (cleanText.startsWith('Document:') && cleanText.includes('\nContent: ')) {
          cleanText = cleanText.substring(cleanText.indexOf('\nContent: ') + 10);
        }
        let keywords = [];
        const tagsMatch = v.text ? v.text.match(/Tags: (.*)\n/) : null;
        if (tagsMatch && tagsMatch[1]) {
          keywords = tagsMatch[1].split(',').map(k => k.trim());
        }
        manualBlocks.push({
          source: v.source,
          text: cleanText,
          keywords: keywords
        });
      }
    });
    zip.addFile('manual_blocks.json', Buffer.from(JSON.stringify(manualBlocks, null, 2), 'utf8'));

    const editedChunks = collectEditedSearchableChunks(profileId, 'profile_kb');
    if (editedChunks.length > 0) {
      zip.addFile('searchable_chunks.json', Buffer.from(JSON.stringify(editedChunks, null, 2), 'utf8'));
    }

    const profileRow = db.prepare('SELECT knowledgeFiles FROM writing_profiles WHERE id = ?').get(profileId);
    if (profileRow && profileRow.knowledgeFiles) {
      try {
        const fileList = JSON.parse(profileRow.knowledgeFiles);
        const totalFiles = fileList.length;
        for (let i = 0; i < totalFiles; i++) {
          const file = fileList[i];
          if (file.internalPath && fs.existsSync(file.internalPath)) {
            const filePercent = Math.round(10 + ((i / totalFiles) * 70));
            event.sender.send('export-progress', { progress: filePercent, status: `Adding file: ${file.name}...` });
            zip.addLocalFile(file.internalPath, 'files');
          }
        }
      } catch (err) {
        console.error("Error reading profile files for KB export:", err);
      }
    }

    event.sender.send('export-progress', { progress: 85, status: 'Compressing and writing archive...' });
    zip.writeZip(saveResult.filePath);

    event.sender.send('export-progress', { progress: 100, status: 'Knowledge Base exported successfully!' });
    return { success: true };
  } catch (e) {
    console.error("Error exporting Knowledge Base:", e);
    throw e;
  }
});

// Import Knowledge Base standalone
ipcMain.handle('import-knowledge-base', async (event, { profileId }) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    const openResult = await dialog.showOpenDialog(win, {
      title: 'Import Knowledge Base',
      filters: [{ name: 'Kallamo KB Package', extensions: ['klkb'] }],
      properties: ['openFile']
    });

    if (openResult.canceled || openResult.filePaths.length === 0) {
      return { success: false, canceled: true };
    }

    const filePath = openResult.filePaths[0];
    event.sender.send('import-progress', { progress: 10, status: 'Reading KB package archive...' });

    const zip = new AdmZip(filePath);
    const kbDir = path.join(profilesDir, profileId, 'KnowledgeBase');
    if (!fs.existsSync(kbDir)) {
      fs.mkdirSync(kbDir, { recursive: true });
    }

    const profileRow = db.prepare('SELECT knowledgeFiles FROM writing_profiles WHERE id = ?').get(profileId);
    const currentFiles = profileRow?.knowledgeFiles ? JSON.parse(profileRow.knowledgeFiles) : [];

    const filesEntries = zip.getEntries().filter(entry => entry.entryName.startsWith('files/') && !entry.isDirectory);
    const manualBlocksEntry = zip.getEntry('manual_blocks.json');
    const renameMap = {};

    event.sender.send('import-progress', { progress: 20, status: 'Extracting knowledge files...' });

    const totalFiles = filesEntries.length;
    for (let i = 0; i < totalFiles; i++) {
      const entry = filesEntries[i];
      let importFileName = path.basename(entry.entryName);
      let baseName = path.basename(importFileName, path.extname(importFileName));
      let ext = path.extname(importFileName);

      let fileCollision = currentFiles.some(f => f.name.toLowerCase() === importFileName.toLowerCase());
      while (fileCollision) {
        baseName = `${baseName}_Imported`;
        importFileName = `${baseName}${ext}`;
        fileCollision = currentFiles.some(f => f.name.toLowerCase() === importFileName.toLowerCase());
      }

      renameMap[path.basename(entry.entryName)] = importFileName;

      const destPath = path.join(kbDir, importFileName);
      const contentBuffer = entry.getData();
      fs.writeFileSync(destPath, contentBuffer);

      const filePercent = Math.round(20 + ((i / totalFiles) * 50));
      event.sender.send('import-progress', { progress: filePercent, status: `Extracting ${importFileName}...` });

      currentFiles.push({
        name: importFileName,
        originalPath: '',
        internalPath: destPath,
        size: contentBuffer.length,
        strategy: 'full_context'
      });
    }

    if (manualBlocksEntry) {
      event.sender.send('import-progress', { progress: 70, status: 'Extracting manual snippets...' });
      const manualBlocksText = zip.readAsText(manualBlocksEntry);
      const manualBlocks = JSON.parse(manualBlocksText);

      const totalBlocks = manualBlocks.length;
      for (let i = 0; i < totalBlocks; i++) {
        const block = manualBlocks[i];
        const blockPercent = Math.round(70 + ((i / totalBlocks) * 20));
        event.sender.send('import-progress', { progress: blockPercent, status: `Vectorizing manual snippet: ${block.source}...` });

        const newBlockId = `manual_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

        let blockSource = block.source;
        const existingBlocks = db.prepare('SELECT source FROM knowledge_chunks WHERE ownerId = ? AND ownerType = ?').all(profileId, 'profile_kb');
        let blockCollision = existingBlocks.some(b => b.source.toLowerCase() === blockSource.toLowerCase());
        while (blockCollision) {
          blockSource = `${blockSource} - Imported`;
          blockCollision = existingBlocks.some(b => b.source.toLowerCase() === blockSource.toLowerCase());
        }

        const cleanKeywords = Array.isArray(block.keywords)
          ? block.keywords.map(k => {
            const trimmed = k.trim().toLowerCase();
            return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
          }).filter(Boolean)
          : [];

        const vectors = await vectorizeChunks([block.text], blockSource, null, cleanKeywords);
        const chunk = vectors[0] || null;
        if (chunk) {
          chunk.id = newBlockId;
          chunk.keywords = cleanKeywords;
          insertChunksToDb(profileId, 'profile_kb', [chunk]);
        }
      }
    }

    const searchableEntry = zip.getEntry('searchable_chunks.json');
    if (searchableEntry) {
      event.sender.send('import-progress', { progress: 90, status: 'Restoring edited searchable chunks...' });
      try {
        const sidecar = JSON.parse(zip.readAsText(searchableEntry));
        await restoreSearchableChunks(profileId, 'profile_kb', sidecar, renameMap, currentFiles);
      } catch (err) {
        console.error("Error restoring searchable chunks during KB import:", err);
      }
    }

    event.sender.send('import-progress', { progress: 95, status: 'Finalizing database configurations...' });
    const update = db.prepare('UPDATE writing_profiles SET knowledgeFiles = ? WHERE id = ?');
    update.run(JSON.stringify(currentFiles), profileId);

    event.sender.send('import-progress', { progress: 100, status: 'Knowledge Base imported successfully!' });

    if (currentFiles.length > 0) {
      indexProfileKnowledgeBase(event.sender, profileId, currentFiles).catch(e => {
        console.error("Background profile indexing error during KB import:", e);
      });
    }

    return { success: true };
  } catch (e) {
    console.error("Error importing Knowledge Base:", e);
    throw e;
  }
});

ipcMain.handle('export-chat-knowledge-base', async (event, { chatId, chatTitle }) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    const saveResult = await dialog.showSaveDialog(win, {
      title: 'Export Workspace Knowledge Base',
      defaultPath: `${chatTitle.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_kb.klkb`,
      filters: [{ name: 'Kallamo KB Package', extensions: ['klkb'] }]
    });

    if (saveResult.canceled || !saveResult.filePath) {
      return { success: false, canceled: true };
    }

    event.sender.send('export-progress', { progress: 10, status: 'Gathering manual snippets...' });
    const zip = new AdmZip();

    const chatRow = db.prepare('SELECT memoryBlocks, knowledgeFiles FROM chats WHERE id = ?').get(chatId);
    let manualBlocks = [];
    if (chatRow && chatRow.memoryBlocks) {
      try {
        manualBlocks = JSON.parse(chatRow.memoryBlocks);
      } catch (e) {
        console.error("Error parsing chat memoryBlocks for export:", e);
      }
    }
    zip.addFile('manual_blocks.json', Buffer.from(JSON.stringify(manualBlocks, null, 2), 'utf8'));

    const editedChunks = collectEditedSearchableChunks(chatId, 'chat_kb');
    if (editedChunks.length > 0) {
      zip.addFile('searchable_chunks.json', Buffer.from(JSON.stringify(editedChunks, null, 2), 'utf8'));
    }

    if (chatRow && chatRow.knowledgeFiles) {
      try {
        const fileList = JSON.parse(chatRow.knowledgeFiles);
        const totalFiles = fileList.length;
        for (let i = 0; i < totalFiles; i++) {
          const file = fileList[i];
          if (file.internalPath && fs.existsSync(file.internalPath)) {
            const filePercent = Math.round(10 + ((i / totalFiles) * 75));
            event.sender.send('export-progress', { progress: filePercent, status: `Adding file: ${file.name}...` });
            zip.addLocalFile(file.internalPath, 'files');
          }
        }
      } catch (err) {
        console.error("Error reading chat files for export:", err);
      }
    }

    event.sender.send('export-progress', { progress: 90, status: 'Writing zip archive...' });
    zip.writeZip(saveResult.filePath);

    event.sender.send('export-progress', { progress: 100, status: 'Export completed successfully!' });
    return { success: true };
  } catch (e) {
    console.error("Error exporting chat KB:", e);
    throw e;
  }
});

ipcMain.handle('import-chat-knowledge-base', async (event, { chatId }) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    const openResult = await dialog.showOpenDialog(win, {
      title: 'Import Workspace Knowledge Base',
      filters: [{ name: 'Kallamo KB Package', extensions: ['klkb'] }],
      properties: ['openFile']
    });

    if (openResult.canceled || openResult.filePaths.length === 0) {
      return { success: false, canceled: true };
    }

    const filePath = openResult.filePaths[0];
    event.sender.send('import-progress', { progress: 10, status: 'Reading KB package archive...' });
    const zip = new AdmZip(filePath);

    const chatKbDir = path.join(chatsDir, chatId, 'KnowledgeBase');
    if (!fs.existsSync(chatKbDir)) {
      fs.mkdirSync(chatKbDir, { recursive: true });
    }
    const chatFilesDir = path.join(chatsDir, chatId, 'Files');
    if (!fs.existsSync(chatFilesDir)) {
      fs.mkdirSync(chatFilesDir, { recursive: true });
    }

    const chatRow = db.prepare('SELECT memoryBlocks, knowledgeFiles FROM chats WHERE id = ?').get(chatId);
    const currentFiles = chatRow?.knowledgeFiles ? JSON.parse(chatRow.knowledgeFiles) : [];
    const currentBlocks = chatRow?.memoryBlocks ? JSON.parse(chatRow.memoryBlocks) : [];

    const filesEntries = zip.getEntries().filter(entry => entry.entryName.startsWith('files/') && !entry.isDirectory);
    const manualBlocksEntry = zip.getEntry('manual_blocks.json');
    const renameMap = {};

    event.sender.send('import-progress', { progress: 20, status: 'Extracting files...' });

    const totalFiles = filesEntries.length;
    for (let i = 0; i < totalFiles; i++) {
      const entry = filesEntries[i];
      let importFileName = path.basename(entry.entryName);
      let baseName = path.basename(importFileName, path.extname(importFileName));
      let ext = path.extname(importFileName);

      let fileCollision = currentFiles.some(f => f.name.toLowerCase() === importFileName.toLowerCase());
      while (fileCollision) {
        baseName = `${baseName}_Imported`;
        importFileName = `${baseName}${ext}`;
        fileCollision = currentFiles.some(f => f.name.toLowerCase() === importFileName.toLowerCase());
      }

      renameMap[path.basename(entry.entryName)] = importFileName;

      const destPath = path.join(chatKbDir, importFileName);
      const filesDestPath = path.join(chatFilesDir, importFileName);

      const contentBuffer = entry.getData();
      fs.writeFileSync(destPath, contentBuffer);
      fs.writeFileSync(filesDestPath, contentBuffer);

      const filePercent = Math.round(20 + ((i / totalFiles) * 50));
      event.sender.send('import-progress', { progress: filePercent, status: `Extracting ${importFileName}...` });

      currentFiles.push({
        name: importFileName,
        originalPath: '',
        internalPath: destPath,
        size: contentBuffer.length,
        strategy: 'full_context'
      });
    }

    if (manualBlocksEntry) {
      event.sender.send('import-progress', { progress: 70, status: 'Extracting custom snippets...' });
      const manualBlocksText = zip.readAsText(manualBlocksEntry);
      const manualBlocks = JSON.parse(manualBlocksText);

      const totalBlocks = manualBlocks.length;
      for (let i = 0; i < totalBlocks; i++) {
        const block = manualBlocks[i];
        const blockPercent = Math.round(70 + ((i / totalBlocks) * 20));
        event.sender.send('import-progress', { progress: blockPercent, status: `Vectorizing snippet: ${block.title || block.source}...` });

        const blockType = block.type || (block.id && block.id.startsWith('manual_') ? 'manual' : 'summarized');
        const newBlockId = blockType === 'summarized'
          ? `block_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`
          : `manual_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;

        let blockSource = block.title || block.source || 'Custom Memory';
        let blockCollision = currentBlocks.some(b => (b.title || b.source || '').toLowerCase() === blockSource.toLowerCase());
        while (blockCollision) {
          blockSource = `${blockSource} - Imported`;
          blockCollision = currentBlocks.some(b => (b.title || b.source || '').toLowerCase() === blockSource.toLowerCase());
        }

        const blockText = block.summary || block.text || '';
        const cleanKeywords = Array.isArray(block.keywords)
          ? block.keywords.map(k => {
            const trimmed = k.trim().toLowerCase();
            return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
          }).filter(Boolean)
          : [];

        currentBlocks.push({
          id: newBlockId,
          title: blockSource,
          summary: blockText,
          text: blockText,
          type: blockType,
          messages: block.messages || [],
          profiles: block.profiles || [],
          strategy: block.strategy || 'rag_search',
          keywords: cleanKeywords,
          timestamp: Date.now()
        });

        const vectors = await vectorizeChunks([blockText], blockSource, null, cleanKeywords);
        const chunk = vectors[0] || null;
        if (chunk) {
          chunk.id = newBlockId;
          chunk.keywords = cleanKeywords;
          insertChunksToDb(chatId, 'chat_memory', [chunk]);
        }
      }
    }

    const searchableEntry = zip.getEntry('searchable_chunks.json');
    if (searchableEntry) {
      event.sender.send('import-progress', { progress: 90, status: 'Restoring edited searchable chunks...' });
      try {
        const sidecar = JSON.parse(zip.readAsText(searchableEntry));
        await restoreSearchableChunks(chatId, 'chat_kb', sidecar, renameMap, currentFiles);
      } catch (err) {
        console.error("Error restoring searchable chunks during chat KB import:", err);
      }
    }

    event.sender.send('import-progress', { progress: 95, status: 'Finalizing database configurations...' });

    const update = db.prepare('UPDATE chats SET knowledgeFiles = ?, memoryBlocks = ? WHERE id = ?');
    update.run(JSON.stringify(currentFiles), JSON.stringify(currentBlocks), chatId);

    event.sender.send('import-progress', { progress: 100, status: 'Knowledge Base imported successfully!' });

    if (currentFiles.length > 0) {
      indexChatKnowledgeBase(event.sender, chatId, currentFiles).catch(e => {
        console.error("Background chat indexing error during KB import:", e);
      });
    }

    return { success: true };
  } catch (e) {
    console.error("Error importing chat KB:", e);
    throw e;
  }
});

// ==========================================
// --- KNOWLEDGE BASE FILES IPC HANDLERS ---
// ==========================================
ipcMain.handle('upload-kb-file', async (event, { profileId, name, path: filePath, size }) => {
  try {
    const profileKbDir = path.join(profilesDir, profileId, 'KnowledgeBase');
    if (!fs.existsSync(profileKbDir)) {
      fs.mkdirSync(profileKbDir, { recursive: true });
    }

    const destPath = path.join(profileKbDir, name);
    if (filePath && fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, destPath);
    } else {
      throw new Error(`File path not found: ${filePath}`);
    }

    return {
      name,
      originalPath: filePath,
      internalPath: destPath,
      size
    };
  } catch (e) {
    console.error("Error uploading knowledge file:", e);
    throw e;
  }
});

ipcMain.handle('delete-kb-file', async (event, { profileId, fileName }) => {
  try {
    const filePath = path.join(profilesDir, profileId, 'KnowledgeBase', fileName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }

    deleteChunksFromDb(profileId, 'profile_kb', fileName);

    const profile = db.prepare('SELECT knowledgeFiles FROM writing_profiles WHERE id = ?').get(profileId);
    if (profile && profile.knowledgeFiles) {
      let knowledgeFiles = [];
      try {
        knowledgeFiles = typeof profile.knowledgeFiles === 'string'
          ? JSON.parse(profile.knowledgeFiles)
          : (profile.knowledgeFiles || []);
      } catch (err) { }
      const updatedFiles = knowledgeFiles.filter(f => f.name !== fileName);
      db.prepare('UPDATE writing_profiles SET knowledgeFiles = ? WHERE id = ?').run(JSON.stringify(updatedFiles), profileId);
    }

    db.deleteConstantSnippetByTitle(profileId, fileName, 'profile');

    return { success: true };
  } catch (e) {
    console.error("Error deleting knowledge file:", e);
    throw e;
  }
});

ipcMain.handle('count-tokens', async (event, texts) => {
  try {
    if (Array.isArray(texts)) return texts.map(t => countTokens(t || ''));
    return countTokens(texts || '');
  } catch (e) {
    return Array.isArray(texts) ? texts.map(() => 0) : 0;
  }
});

ipcMain.handle('get-profile-kb-blocks', async (event, { profileId }) => {
  try {
    const loadedKbData = [];

    const chunks = db.prepare('SELECT id, source, text, vector, createdAt, tokenCount, enabled, manuallyEdited FROM knowledge_chunks WHERE ownerId = ? AND ownerType = ?').all(profileId, 'profile_kb');
    chunks.forEach((v) => {
      let cleanText = v.text || '';
      if (cleanText.startsWith('Document:') && cleanText.includes('\nContent: ')) {
        cleanText = cleanText.substring(cleanText.indexOf('\nContent: ') + 10);
      }

      let blockType = 'rag';
      if (v.id && (v.id.startsWith('mem_') || v.id.startsWith('manual_'))) {
        blockType = 'manual';
      }

      let keywords = [];
      const tagsMatch = v.text ? v.text.match(/Tags: (.*)\n/) : null;
      if (tagsMatch && tagsMatch[1]) {
        keywords = tagsMatch[1].split(',').map(k => k.trim());
      }

      loadedKbData.push({
        id: v.id,
        type: blockType,
        source: v.source,
        text: cleanText,
        tokenCount: v.tokenCount || countTokens(v.text),
        enabled: v.enabled !== 0,
        manuallyEdited: v.manuallyEdited === 1,
        rawItem: {
          id: v.id,
          source: v.source,
          text: v.text,
          vector: JSON.parse(v.vector || '[]'),
          createdAt: v.createdAt,
          keywords: keywords,
          manuallyEdited: v.manuallyEdited === 1
        }
      });
    });

    const profileRow = db.prepare('SELECT knowledgeFiles FROM writing_profiles WHERE id = ?').get(profileId);
    if (profileRow && profileRow.knowledgeFiles) {
      try {
        const files = JSON.parse(profileRow.knowledgeFiles);

        for (let idx = 0; idx < files.length; idx++) {
          const file = files[idx];
          const isConstant = !file.strategy || file.strategy === 'constant' || file.strategy === 'full_context';
          if (isConstant) {
            const dbRows = db.prepare('SELECT id FROM knowledge_chunks WHERE ownerId = ? AND source = ?').all(profileId, file.name);
            if (dbRows.length > 0) {
              db.transaction(() => {
                const deleteChunk = db.prepare('DELETE FROM knowledge_chunks WHERE id = ?');
                const deleteFts = db.prepare('DELETE FROM knowledge_chunks_fts WHERE chunkId = ?');
                for (const r of dbRows) {
                  deleteChunk.run(r.id);
                  deleteFts.run(r.id);
                }
              })();
            }

            let content = '';
            if (file.internalPath && fs.existsSync(file.internalPath)) {
              try {
                const ext = path.extname(file.name).toLowerCase();
                if (ext === '.txt' || ext === '.md' || ext === '.json' || ext === '.csv') {
                  content = fs.readFileSync(file.internalPath, 'utf8');
                } else {
                  content = await extractTextFromFile(file.internalPath);
                }
              } catch (e) {
                console.error("Error reading constant file fallback:", e);
              }
            }

            loadedKbData.push({
              id: `const_${Date.now()}_${idx}`,
              type: 'constant',
              source: file.name,
              text: content || '',
              tokenCount: countTokens(content || ''),
              enabled: file.enabled !== false,
              rawItem: file
            });
          }
        }

        const manualConstants = db.getConstantSnippets(profileId);
        for (const mc of manualConstants) {
          const dbRows = db.prepare('SELECT id FROM knowledge_chunks WHERE ownerId = ? AND id = ?').all(profileId, mc.id);
          if (dbRows.length > 0) {
            db.transaction(() => {
              const deleteChunk = db.prepare('DELETE FROM knowledge_chunks WHERE id = ?');
              const deleteFts = db.prepare('DELETE FROM knowledge_chunks_fts WHERE chunkId = ?');
              for (const r of dbRows) {
                deleteChunk.run(r.id);
                deleteFts.run(r.id);
              }
            })();
          }

          loadedKbData.push({
            id: mc.id,
            type: 'manual',
            source: mc.title || 'Custom Memory',
            text: mc.content || '',
            strategy: 'constant',
            keywords: mc.keywords || [],
            tokenCount: countTokens(mc.content || ''),
            enabled: mc.enabled !== false,
            rawItem: {
              id: mc.id,
              source: mc.title || 'Custom Memory',
              text: mc.content || '',
              strategy: 'constant',
              keywords: mc.keywords || []
            }
          });
        }
      } catch (e) {
        console.error("Error parsing profile knowledgeFiles:", e);
      }
    }

    // Ensure every block carries an approximate token count for the UI
    for (const b of loadedKbData) {
      if (b.tokenCount == null) {
        b.tokenCount = countTokens(b.text || '');
      }
    }

    return loadedKbData;
  } catch (e) {
    console.error("Error getting profile KB blocks:", e);
    throw e;
  }
});

ipcMain.handle('save-profile-kb-blocks', async (event, { profileId, blocks }) => {
  try {
    const kbDir = path.join(profilesDir, profileId, 'KnowledgeBase');
    if (!fs.existsSync(kbDir)) {
      fs.mkdirSync(kbDir, { recursive: true });
    }

    const isConstantSnippet = (b) => b.type === 'manual' && (b.strategy === 'constant' || b.rawItem?.strategy === 'constant');

    const manualSnippets = blocks.filter(item => isConstantSnippet(item)).map(b => ({
      id: b.id,
      title: b.source,
      content: b.text,
      keywords: b.keywords || [],
      enabled: b.enabled !== false
    }));
    db.replaceConstantSnippets(profileId, manualSnippets, 'profile');

    const activeBlockIds = new Set(blocks.filter(b => b.type === 'rag' || (b.type === 'manual' && !isConstantSnippet(b))).map(b => b.id));
    const existingDbChunks = db.prepare('SELECT id FROM knowledge_chunks WHERE ownerId = ? AND ownerType = ?').all(profileId, 'profile_kb');

    db.transaction(() => {
      const deleteChunk = db.prepare('DELETE FROM knowledge_chunks WHERE id = ?');
      const deleteFts = db.prepare('DELETE FROM knowledge_chunks_fts WHERE chunkId = ?');
      for (const row of existingDbChunks) {
        if (!activeBlockIds.has(row.id)) {
          deleteChunk.run(row.id);
          deleteFts.run(row.id);
        }
      }

      const insertChunk = db.prepare(`
        INSERT OR REPLACE INTO knowledge_chunks (id, ownerId, ownerType, source, text, vector, createdAt, tokenCount, enabled, manuallyEdited)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);
      const insertFts = db.prepare(`
        INSERT OR REPLACE INTO knowledge_chunks_fts (chunkId, text)
        VALUES (?, ?)
      `);

      for (const b of blocks) {
        if (b.type === 'rag' || (b.type === 'manual' && !isConstantSnippet(b))) {
          const chunk = b.rawItem;
          if (chunk && chunk.vector) {
            const textToStore = chunk.text || `Document: ${b.source}\nContent: ${b.text}`;
            const manuallyEdited = (b.manuallyEdited || chunk.manuallyEdited) ? 1 : 0;
            insertChunk.run(
              b.id,
              profileId,
              'profile_kb',
              b.source,
              textToStore,
              JSON.stringify(chunk.vector),
              chunk.createdAt || Date.now(),
              countTokens(textToStore),
              b.enabled === false ? 0 : 1,
              manuallyEdited
            );
            insertFts.run(b.id, textToStore);
          }
        }
      }
    })();

    const activeSources = new Set(blocks.map(b => b.source));
    const profileRow = db.prepare('SELECT knowledgeFiles FROM writing_profiles WHERE id = ?').get(profileId);
    if (profileRow && profileRow.knowledgeFiles) {
      let knowledgeFiles = JSON.parse(profileRow.knowledgeFiles);
      const originalLen = knowledgeFiles.length;

      const updatedFiles = [];
      for (const file of knowledgeFiles) {
        if (activeSources.has(file.name)) {
          updatedFiles.push(file);
        } else {
          const filePath = path.join(kbDir, file.name);
          if (fs.existsSync(filePath)) {
            try { fs.unlinkSync(filePath); } catch (e) { console.error(e); }
          }
        }
      }

      if (updatedFiles.length !== originalLen) {
        db.prepare('UPDATE writing_profiles SET knowledgeFiles = ? WHERE id = ?').run(JSON.stringify(updatedFiles), profileId);
      }
    }

    return { success: true };
  } catch (e) {
    console.error("Error saving KB blocks to disk:", e);
    throw e;
  }
});

ipcMain.handle('toggle-kb-block-enabled', async (event, { profileId, block, enabled }) => {
  try {
    const val = enabled ? 1 : 0;
    const isConstantSnippet = block.type === 'manual'
      && (block.strategy === 'constant' || block.rawItem?.strategy === 'constant');

    if (block.type === 'rag_file') {
      db.prepare('UPDATE knowledge_chunks SET enabled = ? WHERE ownerId = ? AND ownerType = ? AND source = ?')
        .run(val, profileId, 'profile_kb', block.source);
    } else if (isConstantSnippet) {
      db.prepare('UPDATE constant_memory SET enabled = ? WHERE ownerId = ? AND id = ?')
        .run(val, profileId, block.id);
    } else if (block.type === 'manual' || block.type === 'rag') {
      db.prepare('UPDATE knowledge_chunks SET enabled = ? WHERE ownerId = ? AND id = ?')
        .run(val, profileId, block.id);
    } else if (block.type === 'constant') {
      const row = db.prepare('SELECT knowledgeFiles FROM writing_profiles WHERE id = ?').get(profileId);
      if (row && row.knowledgeFiles) {
        const files = JSON.parse(row.knowledgeFiles);
        const target = files.find(f => f.name === block.source);
        if (target) {
          target.enabled = enabled;
          db.prepare('UPDATE writing_profiles SET knowledgeFiles = ? WHERE id = ?')
            .run(JSON.stringify(files), profileId);
        }
      }
    }

    return { success: true };
  } catch (e) {
    console.error("Error toggling KB block enabled state:", e);
    throw e;
  }
});

ipcMain.handle('toggle-chat-kb-block-enabled', async (event, { chatId, block, enabled }) => {
  try {
    const val = enabled ? 1 : 0;
    const isConstantSnippet = (block.type === 'snippet' || block.type === 'manual')
      && (block.strategy === 'constant' || block.rawItem?.strategy === 'constant');

    if (block.type === 'rag_file') {
      db.prepare('UPDATE knowledge_chunks SET enabled = ? WHERE ownerId = ? AND ownerType = ? AND source = ?')
        .run(val, chatId, 'chat_kb', block.source);
    } else if (block.type === 'constant') {
      const row = db.prepare('SELECT knowledgeFiles FROM chats WHERE id = ?').get(chatId);
      if (row && row.knowledgeFiles) {
        const files = JSON.parse(row.knowledgeFiles);
        const target = files.find(f => f.name === block.source);
        if (target) {
          target.enabled = enabled;
          db.prepare('UPDATE chats SET knowledgeFiles = ? WHERE id = ?').run(JSON.stringify(files), chatId);
        }
      }
    } else if (block.type === 'snippet' || block.type === 'manual') {
      // Persist the flag on the memoryBlocks JSON entry (drives constant injection + UI state)
      const row = db.prepare('SELECT memoryBlocks FROM chats WHERE id = ?').get(chatId);
      if (row && row.memoryBlocks) {
        const memoryBlocks = JSON.parse(row.memoryBlocks);
        const target = memoryBlocks.find(b => b.id === block.id);
        if (target) {
          target.enabled = enabled;
          db.prepare('UPDATE chats SET memoryBlocks = ? WHERE id = ?').run(JSON.stringify(memoryBlocks), chatId);
        }
      }
      // Searchable snippets are also a vector row (chat_memory) — gate retrieval too
      if (!isConstantSnippet) {
        db.prepare('UPDATE knowledge_chunks SET enabled = ? WHERE ownerId = ? AND id = ?')
          .run(val, chatId, block.id);
      }
    }

    return { success: true };
  } catch (e) {
    console.error("Error toggling chat KB block enabled state:", e);
    throw e;
  }
});

ipcMain.handle('vectorize-kb-chunk', async (event, { text, source, keywords }) => {
  try {
    const cleanKeywords = Array.isArray(keywords)
      ? keywords.map(k => {
        const trimmed = k.trim().toLowerCase();
        return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
      }).filter(Boolean)
      : [];
    const vectors = await vectorizeChunks([text], source, null, cleanKeywords);
    const chunk = vectors[0] || null;
    if (chunk) {
      chunk.keywords = cleanKeywords;
    }
    return chunk;
  } catch (e) {
    console.error("Error vectorizing single chunk:", e);
    throw e;
  }
});

ipcMain.handle('add-profile-constant-file', async (event, { profileId, name, path: filePath, size }) => {
  try {
    const kbDir = path.join(profilesDir, profileId, 'KnowledgeBase');
    if (!fs.existsSync(kbDir)) {
      fs.mkdirSync(kbDir, { recursive: true });
    }

    const destPath = path.join(kbDir, name);
    if (filePath && fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, destPath);
    } else {
      throw new Error(`File path not found: ${filePath}`);
    }

    const text = await extractTextFromFile(destPath);
    if (!text || text.trim().length === 0) {
      throw new Error("File is empty or could not be read.");
    }

    const newRawItem = { name: name, content: text.trim() };

    const profileRow = db.prepare('SELECT knowledgeFiles FROM writing_profiles WHERE id = ?').get(profileId);
    let knowledgeFiles = [];
    if (profileRow && profileRow.knowledgeFiles) {
      knowledgeFiles = JSON.parse(profileRow.knowledgeFiles);
    }
    const fileInfo = {
      name,
      internalPath: destPath,
      size,
      strategy: 'full_context'
    };
    if (!knowledgeFiles.some(f => f.name === name)) {
      knowledgeFiles.push(fileInfo);
      db.prepare('UPDATE writing_profiles SET knowledgeFiles = ? WHERE id = ?').run(JSON.stringify(knowledgeFiles), profileId);
    }

    return {
      id: `const_${Date.now()}`,
      type: 'constant',
      source: name,
      text: text.trim(),
      rawItem: newRawItem
    };
  } catch (e) {
    console.error("Error adding constant file:", e);
    throw e;
  }
});

ipcMain.handle('add-profile-searchable-file', async (event, { profileId, name, path: filePath, size }) => {
  try {
    const kbDir = path.join(profilesDir, profileId, 'KnowledgeBase');
    if (!fs.existsSync(kbDir)) {
      fs.mkdirSync(kbDir, { recursive: true });
    }

    const destPath = path.join(kbDir, name);
    if (filePath && fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, destPath);
    } else {
      throw new Error(`File path not found: ${filePath}`);
    }

    const text = await extractTextFromFile(destPath);
    if (!text || text.trim().length === 0) {
      throw new Error("File is empty or could not be read.");
    }

    let chunkSize = 500;
    try {
      const rowAdvanced = db.prepare("SELECT value FROM settings WHERE key = 'advanced'").get();
      if (rowAdvanced) {
        const advanced = JSON.parse(rowAdvanced.value);
        chunkSize = parseInt(advanced.chunkSize, 10) || 500;
      }
    } catch (e) { }

    const chunks = chunkText(text, chunkSize);

    const fileVectors = await vectorizeChunks(chunks, name, (curr, tot) => {
      if (event && event.sender) {
        event.sender.send('vectorization-progress', {
          type: 'profile',
          id: profileId,
          status: 'indexing',
          fileName: name,
          current: curr,
          total: tot
        });
      }
    });

    deleteChunksFromDb(profileId, 'profile_kb', name);
    insertChunksToDb(profileId, 'profile_kb', fileVectors);

    if (event && event.sender) {
      event.sender.send('vectorization-progress', {
        type: 'profile',
        id: profileId,
        status: 'completed'
      });
    }

    const profileRow = db.prepare('SELECT knowledgeFiles FROM writing_profiles WHERE id = ?').get(profileId);
    let knowledgeFiles = [];
    if (profileRow && profileRow.knowledgeFiles) {
      knowledgeFiles = JSON.parse(profileRow.knowledgeFiles);
    }
    const fileInfo = {
      name,
      internalPath: destPath,
      size,
      strategy: 'rag_search'
    };
    if (!knowledgeFiles.some(f => f.name === name)) {
      knowledgeFiles.push(fileInfo);
      db.prepare('UPDATE writing_profiles SET knowledgeFiles = ? WHERE id = ?').run(JSON.stringify(knowledgeFiles), profileId);
    }

    const blocks = fileVectors.map((v, idx) => {
      let cleanText = v.text || '';
      if (cleanText.startsWith('Document:') && cleanText.includes('\nContent: ')) {
        cleanText = cleanText.substring(cleanText.indexOf('\nContent: ') + 10);
      }
      return {
        id: v.id || `vec_new_${Date.now()}_${idx}`,
        type: 'rag',
        source: v.source,
        text: cleanText,
        rawItem: v
      };
    });

    return { blocks };
  } catch (e) {
    console.error("Error adding searchable file:", e);
    throw e;
  }
});

// ==========================================
// --- WORKSPACE CHATS IPC HANDLERS ---
// ==========================================
// --- WRITING DESK: DOCUMENTS & FOLDERS ---

// Remove a document's searchable chunks (owner = document) and their FTS rows.
function deleteDocumentChunks(documentId) {
  try {
    const ids = db.prepare("SELECT id FROM knowledge_chunks WHERE ownerId = ? AND ownerType = 'document'").all(documentId);
    const delFts = db.prepare('DELETE FROM knowledge_chunks_fts WHERE chunkId = ?');
    for (const row of ids) delFts.run(row.id);
    db.prepare("DELETE FROM knowledge_chunks WHERE ownerId = ? AND ownerType = 'document'").run(documentId);
  } catch (e) {
    console.error('[Writing Desk] Failed to delete document chunks:', e);
  }
}

ipcMain.handle('get-writing-tree', async (event, { workspaceId }) => {
  try {
    const folders = db.prepare('SELECT * FROM folders WHERE workspaceId = ? ORDER BY position ASC, name COLLATE NOCASE').all(workspaceId);
    const documents = db.prepare(
      'SELECT id, workspaceId, folderId, title, position, updatedAt FROM documents WHERE workspaceId = ? ORDER BY position ASC, title COLLATE NOCASE'
    ).all(workspaceId);
    return { folders, documents };
  } catch (e) {
    console.error('[Writing Desk] Error loading tree:', e);
    return { folders: [], documents: [] };
  }
});

ipcMain.handle('get-document', async (event, { id }) => {
  try {
    return db.prepare('SELECT * FROM documents WHERE id = ?').get(id) || null;
  } catch (e) {
    console.error('[Writing Desk] Error loading document:', e);
    return null;
  }
});

// Next position (append to end) within a sibling group of a given type.
function nextPosition(workspaceId, type, parentId) {
  const col = type === 'folder' ? 'parentId' : 'folderId';
  const table = type === 'folder' ? 'folders' : 'documents';
  const row = db.prepare(`SELECT MAX(position) AS m FROM ${table} WHERE workspaceId = ? AND ${col} IS ?`).get(workspaceId, parentId || null);
  return (row && row.m != null ? row.m : -1) + 1;
}

ipcMain.handle('create-folder', async (event, { workspaceId, name, parentId }) => {
  const id = crypto.randomUUID();
  const now = Date.now();
  const position = nextPosition(workspaceId, 'folder', parentId);
  db.prepare('INSERT INTO folders (id, workspaceId, name, parentId, position, createdAt, last_modified) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, workspaceId, name || 'New folder', parentId || null, position, now, now);
  return { id, workspaceId, name: name || 'New folder', parentId: parentId || null, position, createdAt: now };
});

// Bulk reorder/move: each update sets an item's parent + position. Used by drag-and-drop.
ipcMain.handle('reorder-writing-items', async (event, { updates }) => {
  try {
    const upDoc = db.prepare('UPDATE documents SET folderId = ?, position = ?, last_modified = ? WHERE id = ?');
    const upFolder = db.prepare('UPDATE folders SET parentId = ?, position = ?, last_modified = ? WHERE id = ?');
    const now = Date.now();
    const tx = db.transaction((items) => {
      for (const u of items) {
        if (u.type === 'folder') upFolder.run(u.parentId || null, u.position, now, u.id);
        else upDoc.run(u.parentId || null, u.position, now, u.id);
      }
    });
    tx(updates || []);
    return { success: true };
  } catch (e) {
    console.error('[Writing Desk] Reorder failed:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('rename-folder', async (event, { id, name }) => {
  db.prepare('UPDATE folders SET name = ?, last_modified = ? WHERE id = ?').run(name, Date.now(), id);
  return { success: true };
});

ipcMain.handle('move-folder', async (event, { id, parentId }) => {
  const row = db.prepare('SELECT workspaceId FROM folders WHERE id = ?').get(id);
  const position = row ? nextPosition(row.workspaceId, 'folder', parentId) : 0;
  db.prepare('UPDATE folders SET parentId = ?, position = ?, last_modified = ? WHERE id = ?').run(parentId || null, position, Date.now(), id);
  return { success: true };
});

ipcMain.handle('delete-folder', async (event, { id }) => {
  try {
    // Cascade: gather the folder subtree, delete their documents (and chunks), then the folders.
    const allFolders = db.prepare('SELECT id, parentId FROM folders WHERE workspaceId = (SELECT workspaceId FROM folders WHERE id = ?)').all(id);
    const toDelete = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const f of allFolders) {
        if (f.parentId && toDelete.has(f.parentId) && !toDelete.has(f.id)) {
          toDelete.add(f.id);
          grew = true;
        }
      }
    }
    const delDoc = db.prepare('DELETE FROM documents WHERE folderId = ?');
    const delFolder = db.prepare('DELETE FROM folders WHERE id = ?');
    for (const folderId of toDelete) {
      const docs = db.prepare('SELECT id FROM documents WHERE folderId = ?').all(folderId);
      for (const d of docs) deleteDocumentChunks(d.id);
      delDoc.run(folderId);
      delFolder.run(folderId);
    }
    return { success: true };
  } catch (e) {
    console.error('[Writing Desk] Error deleting folder:', e);
    return { success: false, error: e.message };
  }
});

// Page geometry + typography columns a new document can inherit from its workspace
// defaults. Anything omitted falls back to the column DEFAULT in the schema.
const PAGE_COLUMNS = [
  'sheetColor', 'defaultFont', 'pageSize', 'orientation', 'pageWidth', 'pageHeight',
  'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
  'defaultFontSize', 'lineHeight', 'paragraphSpacing', 'textAlign', 'firstLineIndent', 'wordGoal'
];

function insertDocumentWithDefaults({ workspaceId, folderId, title, content, defaults }) {
  const id = crypto.randomUUID();
  const now = Date.now();
  const cols = ['id', 'workspaceId', 'folderId', 'title', 'content', 'position', 'createdAt', 'updatedAt', 'last_modified'];
  const vals = [id, workspaceId, folderId || null, title, content, nextPosition(workspaceId, 'document', folderId), now, now, now];
  if (defaults && typeof defaults === 'object') {
    for (const c of PAGE_COLUMNS) {
      if (defaults[c] !== undefined && defaults[c] !== null) {
        cols.push(c);
        vals.push(defaults[c]);
      }
    }
  }
  const placeholders = cols.map(() => '?').join(', ');
  db.prepare(`INSERT INTO documents (${cols.join(', ')}) VALUES (${placeholders})`).run(...vals);
  return db.prepare('SELECT * FROM documents WHERE id = ?').get(id);
}

ipcMain.handle('create-document', async (event, { workspaceId, folderId, title, content, defaults }) => {
  const docContent = content || JSON.stringify({ type: 'doc', content: [{ type: 'paragraph' }] });
  return insertDocumentWithDefaults({ workspaceId, folderId, title: title || 'Untitled', content: docContent, defaults });
});

ipcMain.handle('rename-document', async (event, { id, title }) => {
  db.prepare('UPDATE documents SET title = ?, last_modified = ? WHERE id = ?').run(title, Date.now(), id);
  return { success: true };
});

ipcMain.handle('move-document', async (event, { id, folderId }) => {
  const row = db.prepare('SELECT workspaceId FROM documents WHERE id = ?').get(id);
  const position = row ? nextPosition(row.workspaceId, 'document', folderId) : 0;
  db.prepare('UPDATE documents SET folderId = ?, position = ?, last_modified = ? WHERE id = ?').run(folderId || null, position, Date.now(), id);
  return { success: true };
});

ipcMain.handle('delete-document', async (event, { id }) => {
  try {
    deleteDocumentChunks(id);
    db.prepare('DELETE FROM documents WHERE id = ?').run(id);
    return { success: true };
  } catch (e) {
    console.error('[Writing Desk] Error deleting document:', e);
    return { success: false, error: e.message };
  }
});

ipcMain.handle('save-document-content', async (event, { id, content }) => {
  const now = Date.now();
  db.prepare('UPDATE documents SET content = ?, updatedAt = ?, vectorized = 0, last_modified = ? WHERE id = ?')
    .run(content, now, now, id);
  return { success: true, updatedAt: now };
});

ipcMain.handle('save-document-sheet', async (event, { id, sheetColor, defaultFont, sheetWidth }) => {
  db.prepare('UPDATE documents SET sheetColor = ?, defaultFont = ?, sheetWidth = ?, last_modified = ? WHERE id = ?')
    .run(sheetColor || null, defaultFont || null, sheetWidth ?? 720, Date.now(), id);
  return { success: true };
});

// Partial update of page geometry / typography columns. Only whitelisted keys present in
// `page` are written, so the editor can persist a single changed control at a time.
ipcMain.handle('save-document-page', async (event, { id, page }) => {
  if (!page || typeof page !== 'object') return { success: false };
  const keys = Object.keys(page).filter(k => PAGE_COLUMNS.includes(k));
  if (keys.length === 0) return { success: true };
  const setClause = keys.map(k => `${k} = ?`).join(', ');
  const vals = keys.map(k => page[k]);
  db.prepare(`UPDATE documents SET ${setClause}, last_modified = ? WHERE id = ?`).run(...vals, Date.now(), id);
  return { success: true };
});

// --- WRITING DESK: AI select->invoke ---

// A single invocation may be in flight at a time (one-at-a-time lock). Main owns the
// authoritative flag so the renderer can't double-dispatch across sub-tab switches.
let wdInFlight = null;

function broadcast(channel, payload) {
  const wins = BrowserWindow.getAllWindows();
  if (wins.length > 0) wins[0].webContents.send(channel, payload);
}

// Run a select->invoke detached: returns immediately with an invocationId, then
// emits 'wd-invocation-complete' when the model returns. The result is persisted to
// pending_suggestions so it survives leaving/reopening the workspace.
ipcMain.handle('invoke-writing-desk', async (event, payload) => {
  if (wdInFlight) {
    return { error: 'An AI suggestion is already in progress. Resolve it before starting another.' };
  }
  const invocationId = `wdi_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  wdInFlight = invocationId;

  const { runWritingDeskInvocation } = require('./writing-desk-invocation');

  (async () => {
    try {
      const result = await runWritingDeskInvocation(payload);
      const id = `psug_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      db.prepare(`
        INSERT INTO pending_suggestions
          (id, documentId, workspaceId, channel, fromPos, toPos, originalText, proposedText, profileId, intermediatePrompt, status, createdAt, last_modified)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id, payload.documentId, payload.workspaceId, result.channel,
        result.fromPos, result.toPos, payload.selection || '', result.proposedText || '',
        payload.profileId, payload.intermediatePrompt || '', result.status || 'ok',
        Date.now(), Date.now()
      );
      broadcast('wd-invocation-complete', {
        invocationId, suggestionId: id, documentId: payload.documentId,
        workspaceId: payload.workspaceId, channel: result.channel, status: result.status
      });
    } catch (e) {
      console.error('[Writing Desk] invocation failed:', e);
      broadcast('wd-invocation-complete', {
        invocationId, documentId: payload.documentId,
        workspaceId: payload.workspaceId, error: e.message
      });
    } finally {
      wdInFlight = null;
    }
  })();

  return { invocationId };
});

ipcMain.handle('wd-invocation-status', async () => ({ inFlight: wdInFlight }));

ipcMain.handle('get-pending-suggestion', async (event, { documentId }) => {
  const row = db.prepare(
    "SELECT * FROM pending_suggestions WHERE documentId = ? AND status != 'resolved' ORDER BY createdAt DESC LIMIT 1"
  ).get(documentId);
  return { suggestion: row || null };
});

ipcMain.handle('resolve-pending-suggestion', async (event, { id }) => {
  db.prepare('DELETE FROM pending_suggestions WHERE id = ?').run(id);
  return { success: true };
});

// Document ids in this workspace that currently hold an unresolved suggestion,
// used to mark the sidebar chapter rows.
ipcMain.handle('get-pending-suggestion-ids', async (event, { workspaceId }) => {
  const rows = db.prepare(
    "SELECT DISTINCT documentId FROM pending_suggestions WHERE workspaceId = ? AND status != 'resolved'"
  ).all(workspaceId);
  return { ids: rows.map(r => r.documentId) };
});

// --- WRITING DESK: pinned directives (always-on instructions per workspace) ---

ipcMain.handle('get-directives', async (event, { workspaceId }) => {
  const rows = db.prepare(
    'SELECT * FROM pinned_directives WHERE workspaceId = ? ORDER BY position, createdAt'
  ).all(workspaceId);
  return { directives: rows };
});

ipcMain.handle('add-directive', async (event, { workspaceId, type, text, sourceMessageId }) => {
  const id = `dir_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const max = db.prepare('SELECT MAX(position) AS m FROM pinned_directives WHERE workspaceId = ?').get(workspaceId);
  const position = (max && max.m != null ? max.m : -1) + 1;
  db.prepare(`
    INSERT INTO pinned_directives (id, workspaceId, type, text, sourceMessageId, position, createdAt, last_modified)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, workspaceId, type || 'typed', text, sourceMessageId || null, position, Date.now(), Date.now());
  return { id };
});

ipcMain.handle('update-directive', async (event, { id, text }) => {
  db.prepare('UPDATE pinned_directives SET text = ?, last_modified = ? WHERE id = ?').run(text, Date.now(), id);
  return { success: true };
});

ipcMain.handle('delete-directive', async (event, { id }) => {
  db.prepare('DELETE FROM pinned_directives WHERE id = ?').run(id);
  return { success: true };
});

// Export a chapter to PDF. The renderer composes a self-contained HTML document;
// it loads in a hidden window and prints paginated via webContents.printToPDF.
ipcMain.handle('export-document-pdf', async (event, { html, title, pageSize, pageWidth, pageHeight, margins, paginate, contentHeight, pageNumbers }) => {
  let pdfWin = null;
  try {
    const parent = BrowserWindow.getFocusedWindow();
    const saveResult = await dialog.showSaveDialog(parent, {
      title: 'Export chapter to PDF',
      defaultPath: `${(title || 'chapter').replace(/[\\/:*?"<>|]/g, '_')}.pdf`,
      filters: [{ name: 'PDF', extensions: ['pdf'] }]
    });
    if (saveResult.canceled || !saveResult.filePath) return { canceled: true };

    pdfWin = new BrowserWindow({ show: false, webPreferences: { sandbox: true, javascript: false } });
    await pdfWin.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));

    const MAX_MICRON = Math.round(200 * 25400); // PDF max page dimension ~200in
    const px2micron = (px) => Math.min(Math.round((px / 96) * 25400), MAX_MICRON);
    // Margins are set identically in the HTML @page rule AND here (marginType
    // 'custom', inches). Whichever Chromium gives precedence, the value is the
    // same, so content margins stay correct (no doubling) and printToPDF still
    // reserves the bottom band the page-number footer needs.
    const inch = (v) => (v || 0) / 96;
    const opts = {
      printBackground: true,
      margins: margins
        ? { marginType: 'custom', top: inch(margins.top), right: inch(margins.right), bottom: inch(margins.bottom), left: inch(margins.left) }
        : { marginType: 'none' },
    };
    if (paginate === false && pageWidth && contentHeight) {
      // Single continuous page sized to the measured content (clamped to PDF max).
      opts.pageSize = { width: px2micron(pageWidth), height: px2micron(contentHeight) };
    } else if (pageSize === 'A4' || pageSize === 'Letter') {
      opts.pageSize = pageSize;
    } else if (pageWidth && pageHeight) {
      opts.pageSize = { width: px2micron(pageWidth), height: px2micron(pageHeight) };
    }

    const wantNumbers = pageNumbers && pageNumbers.enabled && paginate !== false;
    if (wantNumbers) {
      opts.displayHeaderFooter = true;
      opts.headerTemplate = '<span></span>';
      const justify = pageNumbers.position === 'left' ? 'flex-start' : pageNumbers.position === 'right' ? 'flex-end' : 'center';
      const pad = pageNumbers.position === 'left' ? `padding-left:${(margins?.left || 0) / 96}in;`
        : pageNumbers.position === 'right' ? `padding-right:${(margins?.right || 0) / 96}in;` : '';
      opts.footerTemplate = `<div style="width:100%;font-size:10px;display:flex;justify-content:${justify};${pad}"><span class="pageNumber"></span></div>`;
    }

    const data = await pdfWin.webContents.printToPDF(opts);
    fs.writeFileSync(saveResult.filePath, data);
    return { success: true, filePath: saveResult.filePath };
  } catch (e) {
    console.error('[Writing Desk] PDF export failed:', e);
    return { error: e.message };
  } finally {
    if (pdfWin && !pdfWin.isDestroyed()) pdfWin.close();
  }
});

// Export a chapter to .docx. Built from the editor's ProseMirror JSON via the
// `docx` library (schema-valid OOXML), not html-to-docx (which produced files
// Word refused to open, especially with tables).
ipcMain.handle('export-document-docx', async (event, { docJson, title, page, margins, pageNumbers, pageNumberStart }) => {
  try {
    const parent = BrowserWindow.getFocusedWindow();
    const saveResult = await dialog.showSaveDialog(parent, {
      title: 'Export chapter to Word',
      defaultPath: `${(title || 'chapter').replace(/[\\/:*?"<>|]/g, '_')}.docx`,
      filters: [{ name: 'Word document', extensions: ['docx'] }]
    });
    if (saveResult.canceled || !saveResult.filePath) return { canceled: true };

    const { buildDocxBuffer } = require('./docx-export');
    const buffer = await buildDocxBuffer(docJson, page || {}, { margins, pageNumbers, pageNumberStart });
    fs.writeFileSync(saveResult.filePath, buffer);
    return { success: true, filePath: saveResult.filePath };
  } catch (e) {
    console.error('[Writing Desk] DOCX export failed:', e);
    return { error: e.message };
  }
});

// Export an entire folder ("book") as one combined .docx, with an optional TOC.
ipcMain.handle('export-book-docx', async (event, { chapters, title, page, margins, pageNumbers, pageNumberStart, toc, tocTitle, tocAlign, chapterTitles }) => {
  try {
    const parent = BrowserWindow.getFocusedWindow();
    const saveResult = await dialog.showSaveDialog(parent, {
      title: 'Export book to Word',
      defaultPath: `${(title || 'book').replace(/[\\/:*?"<>|]/g, '_')}.docx`,
      filters: [{ name: 'Word document', extensions: ['docx'] }]
    });
    if (saveResult.canceled || !saveResult.filePath) return { canceled: true };

    const { buildBookDocxBuffer } = require('./docx-export');
    const buffer = await buildBookDocxBuffer(chapters || [], page || {}, { margins, pageNumbers, pageNumberStart, toc, tocTitle, tocAlign, chapterTitles });
    fs.writeFileSync(saveResult.filePath, buffer);
    return { success: true, filePath: saveResult.filePath };
  } catch (e) {
    console.error('[Writing Desk] Book DOCX export failed:', e);
    return { error: e.message };
  }
});

// Step 1 of import: pick a file and extract its content. DOCX returns rich HTML
// (formatting preserved); pdf/txt/md return plain text. The renderer converts the
// HTML into ProseMirror JSON against the editor schema, then calls create-document.
ipcMain.handle('import-document', async (event, { } = {}) => {
  try {
    const win = BrowserWindow.getFocusedWindow();
    const openResult = await dialog.showOpenDialog(win, {
      title: 'Import chapter',
      properties: ['openFile'],
      filters: [{ name: 'Documents', extensions: ['docx', 'pdf', 'txt', 'md'] }]
    });
    if (openResult.canceled || !openResult.filePaths || openResult.filePaths.length === 0) {
      return { canceled: true };
    }
    const filePath = openResult.filePaths[0];
    const ext = path.extname(filePath).toLowerCase();
    const baseName = path.basename(filePath, ext) || 'Imported';
    if (ext === '.docx') {
      const html = await extractDocxHtml(filePath);
      return { kind: 'html', html, baseName };
    }
    const text = await extractTextFromFile(filePath);
    return { kind: 'text', text, baseName };
  } catch (e) {
    console.error('[Writing Desk] Import failed:', e);
    return { error: e.message };
  }
});

ipcMain.handle('get-chats', async () => {
  try {
    const rows = db.prepare(`
      SELECT c.*, (SELECT COUNT(*) FROM messages m WHERE m.chatId = c.id) as messageCount
      FROM chats c
    `).all();
    return rows.map(r => ({
      ...r,
      activeProfiles: JSON.parse(r.activeProfiles || '[]'),
      activeWorkflows: JSON.parse(r.activeWorkflows || '[]'),
      memoryBlocks: JSON.parse(r.memoryBlocks || '[]'),
      knowledgeFiles: JSON.parse(r.knowledgeFiles || '[]')
    }));
  } catch (e) {
    console.error("Error loading chats:", e);
    return [];
  }
});

ipcMain.handle('save-chat', async (event, chat) => {
  try {
    const exists = db.prepare('SELECT id, knowledgeFiles, syncToCloud FROM chats WHERE id = ?').get(chat.id);
    const backdropOpacityDefault = chat.backdropOpacity ?? 75;

    // Preserve server-managed index metadata (lastIndexedMtime) that the renderer doesn't
    // track. Without this, every chat save (e.g. adding a profile) ships a knowledgeFiles
    // blob missing lastIndexedMtime, which both makes the comparison below always differ
    // and wipes the stored mtime — forcing a needless full re-index of every KB file.
    let incomingKb = typeof chat.knowledgeFiles === 'string'
      ? JSON.parse(chat.knowledgeFiles || '[]')
      : (chat.knowledgeFiles || []);
    if (exists && exists.knowledgeFiles) {
      try {
        const oldKb = JSON.parse(exists.knowledgeFiles);
        const oldByKey = new Map(oldKb.map(f => [f.internalPath || f.name, f]));
        incomingKb = incomingKb.map(f => {
          const old = oldByKey.get(f.internalPath || f.name);
          if (old && old.lastIndexedMtime != null && f.lastIndexedMtime == null) {
            return { ...f, lastIndexedMtime: old.lastIndexedMtime };
          }
          return f;
        });
      } catch (e) { }
    }
    const newKbStr = JSON.stringify(incomingKb);
    let kbChanged = true;
    if (exists) {
      kbChanged = (exists.knowledgeFiles !== newKbStr);
    }

    if (exists) {
      const oldSyncToCloud = exists.syncToCloud ?? 0;
      const newSyncToCloud = chat.syncToCloud ?? 0;

      const update = db.prepare(`
        UPDATE chats SET
          title = ?, description = ?, updatedAt = ?, isPinned = ?, maxContext = ?,
          archiveThreshold = ?, summarizedIndex = ?, activeProfiles = ?, activeWorkflows = ?,
          backgroundImage = ?, backdropOpacity = ?, userBubbleOpacity = ?, aiBubbleOpacity = ?,
          memoryBlocks = ?, knowledgeFiles = ?, autoSummarize = ?, syncToCloud = ?
        WHERE id = ?
      `);

      update.run(
        chat.title,
        chat.description || '',
        chat.updatedAt || Date.now(),
        chat.isPinned ? 1 : 0,
        chat.maxContext ?? 128000,
        chat.archiveThreshold ?? 60000,
        chat.summarizedIndex ?? 0,
        typeof chat.activeProfiles === 'string' ? chat.activeProfiles : JSON.stringify(chat.activeProfiles || []),
        typeof chat.activeWorkflows === 'string' ? chat.activeWorkflows : JSON.stringify(chat.activeWorkflows || []),
        chat.backgroundImage || '',
        backdropOpacityDefault,
        chat.userBubbleOpacity ?? 100,
        chat.aiBubbleOpacity ?? 0,
        typeof chat.memoryBlocks === 'string' ? chat.memoryBlocks : JSON.stringify(chat.memoryBlocks || []),
        newKbStr,
        chat.autoSummarize ?? 0,
        newSyncToCloud,
        chat.id
      );

      if (oldSyncToCloud === 0 && newSyncToCloud === 1) {
        db.prepare('UPDATE messages SET last_modified = ? WHERE chatId = ?').run(Date.now(), chat.id);
        console.log(`[Sync Touch] Touched all messages for chat ${chat.id} to trigger sync push.`);
      }
    } else {
      const insert = db.prepare(`
        INSERT INTO chats (
          id, title, description, updatedAt, isPinned, maxContext, archiveThreshold, summarizedIndex,
          activeProfiles, activeWorkflows, backgroundImage, backdropOpacity, userBubbleOpacity, aiBubbleOpacity, memoryBlocks, knowledgeFiles, autoSummarize, syncToCloud
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      insert.run(
        chat.id,
        chat.title,
        chat.description || '',
        chat.updatedAt || Date.now(),
        chat.isPinned ? 1 : 0,
        chat.maxContext ?? 128000,
        chat.archiveThreshold ?? 60000,
        chat.summarizedIndex ?? 0,
        typeof chat.activeProfiles === 'string' ? chat.activeProfiles : JSON.stringify(chat.activeProfiles || []),
        typeof chat.activeWorkflows === 'string' ? chat.activeWorkflows : JSON.stringify(chat.activeWorkflows || []),
        chat.backgroundImage || '',
        backdropOpacityDefault,
        chat.userBubbleOpacity ?? 100,
        chat.aiBubbleOpacity ?? 0,
        typeof chat.memoryBlocks === 'string' ? chat.memoryBlocks : JSON.stringify(chat.memoryBlocks || []),
        newKbStr,
        chat.autoSummarize ?? 0,
        chat.syncToCloud ?? 0
      );
    }

    if (kbChanged && incomingKb.length > 0) {
      indexChatKnowledgeBase(event.sender, chat.id, incomingKb).catch(e => {
        console.error("Background chat indexing error:", e);
      });
    }

    return { success: true };
  } catch (e) {
    console.error("Error saving chat:", e);
    throw e;
  }
});

ipcMain.handle('delete-chat', async (event, id) => {
  try {
    db.prepare('DELETE FROM chats WHERE id = ?').run(id);

    db.prepare('DELETE FROM knowledge_chunks WHERE ownerId = ?').run(id);
    db.prepare('DELETE FROM knowledge_chunks_fts WHERE chunkId NOT IN (SELECT id FROM knowledge_chunks)').run();

    const chatFolder = path.join(chatsDir, id);
    if (fs.existsSync(chatFolder)) {
      fs.rmSync(chatFolder, { recursive: true, force: true });
    }

    return { success: true };
  } catch (e) {
    console.error("Error deleting chat:", e);
    throw e;
  }
});

ipcMain.handle('upload-chat-bg-image', async (event, { chatId, filePath, fileName }) => {
  try {
    const chatDir = path.join(chatsDir, chatId);
    if (!fs.existsSync(chatDir)) {
      fs.mkdirSync(chatDir, { recursive: true });
    } else {
      const files = fs.readdirSync(chatDir);
      for (const f of files) {
        if (f.startsWith('bg_image_')) {
          try { fs.unlinkSync(path.join(chatDir, f)); } catch (err) { }
        }
      }
    }
    const ext = fileName.includes('.') ? fileName.substring(fileName.lastIndexOf('.')) : '';
    const destBgName = `bg_image_${Date.now()}${ext}`;
    const destBgPath = path.join(chatDir, destBgName);
    if (filePath && fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, destBgPath);
    } else {
      throw new Error(`File path not found: ${filePath}`);
    }
    return destBgPath;
  } catch (e) {
    console.error("Error uploading chat background image:", e);
    throw e;
  }
});

ipcMain.handle('upload-chat-kb-file', async (event, { chatId, name, path: filePath, size }) => {
  try {
    const chatKbDir = path.join(chatsDir, chatId, 'KnowledgeBase');
    if (!fs.existsSync(chatKbDir)) {
      fs.mkdirSync(chatKbDir, { recursive: true });
    }
    const chatFilesDir = path.join(chatsDir, chatId, 'Files');
    if (!fs.existsSync(chatFilesDir)) {
      fs.mkdirSync(chatFilesDir, { recursive: true });
    }

    const destPath = path.join(chatKbDir, name);
    const filesDestPath = path.join(chatFilesDir, name);

    if (filePath && fs.existsSync(filePath)) {
      fs.copyFileSync(filePath, destPath);
      fs.copyFileSync(filePath, filesDestPath);
    } else {
      throw new Error(`File path not found: ${filePath}`);
    }

    return {
      name,
      originalPath: filePath,
      internalPath: destPath,
      size
    };
  } catch (e) {
    console.error("Error uploading chat knowledge file:", e);
    throw e;
  }
});

ipcMain.handle('delete-chat-kb-file', async (event, { chatId, fileName }) => {
  try {
    const filePath = path.join(chatsDir, chatId, 'KnowledgeBase', fileName);
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    const filesPath = path.join(chatsDir, chatId, 'Files', fileName);
    if (fs.existsSync(filesPath)) {
      fs.unlinkSync(filesPath);
    }

    deleteChunksFromDb(chatId, 'chat_kb', fileName);

    const chat = db.prepare('SELECT knowledgeFiles FROM chats WHERE id = ?').get(chatId);
    if (chat && chat.knowledgeFiles) {
      let knowledgeFiles = [];
      try {
        knowledgeFiles = typeof chat.knowledgeFiles === 'string'
          ? JSON.parse(chat.knowledgeFiles)
          : (chat.knowledgeFiles || []);
      } catch (err) { }
      const updatedFiles = knowledgeFiles.filter(f => f.name !== fileName);
      db.prepare('UPDATE chats SET knowledgeFiles = ? WHERE id = ?').run(JSON.stringify(updatedFiles), chatId);
    }

    return { success: true };
  } catch (e) {
    console.error("Error deleting chat knowledge file:", e);
    throw e;
  }
});

ipcMain.handle('get-chat-files', async (event, chatId) => {
  try {
    const filesDir = path.join(chatsDir, chatId, 'Files');
    if (!fs.existsSync(filesDir)) return [];
    const files = fs.readdirSync(filesDir);
    return files.map(file => {
      const filePath = path.join(filesDir, file);
      const stats = fs.statSync(filePath);
      return {
        name: file,
        size: stats.size,
        path: filePath
      };
    });
  } catch (e) {
    console.error("Error reading chat files:", e);
    return [];
  }
});


ipcMain.handle('get-chat-messages', async (event, chatId) => {
  try {
    const rows = db.prepare('SELECT * FROM messages WHERE chatId = ? ORDER BY createdAt ASC').all(chatId);
    return rows.map(r => ({
      ...r,
      attachedFiles: JSON.parse(r.attachedFiles || '[]')
    }));
  } catch (e) {
    console.error("Error loading chat messages:", e);
    return [];
  }
});

ipcMain.handle('save-message', async (event, message) => {
  try {
    const insert = db.prepare(`
      INSERT OR REPLACE INTO messages (id, chatId, role, content, aiName, aiColor, debugNotice, attachedFiles, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    insert.run(
      message.id,
      message.chatId,
      message.role,
      message.content,
      message.aiName || '',
      message.aiColor || '',
      message.debugNotice || '',
      typeof message.attachedFiles === 'string' ? message.attachedFiles : JSON.stringify(message.attachedFiles || []),
      message.createdAt || Date.now()
    );
    return { success: true };
  } catch (e) {
    console.error("Error saving message:", e);
    throw e;
  }
});

ipcMain.handle('delete-message', async (event, messageId, deleteAttachedFilesFromMemory) => {
  try {
    if (deleteAttachedFilesFromMemory) {
      const msgObj = db.prepare('SELECT chatId, attachedFiles FROM messages WHERE id = ?').get(messageId);
      if (msgObj && msgObj.attachedFiles) {
        let filesList = [];
        try {
          filesList = JSON.parse(msgObj.attachedFiles);
        } catch (err) { }

        if (Array.isArray(filesList) && filesList.length > 0) {
          const chatId = msgObj.chatId;
          const chat = db.prepare('SELECT knowledgeFiles FROM chats WHERE id = ?').get(chatId);
          let chatKbFiles = [];
          if (chat && chat.knowledgeFiles) {
            try {
              chatKbFiles = JSON.parse(chat.knowledgeFiles);
            } catch (err) { }
          }

          for (const file of filesList) {
            try {
              deleteChunksFromDb(chatId, 'chat_kb', file.name);

              const kbPath = path.join(chatsDir, chatId, 'KnowledgeBase', file.name);
              if (fs.existsSync(kbPath)) fs.unlinkSync(kbPath);

              const filesPath = path.join(chatsDir, chatId, 'Files', file.name);
              if (fs.existsSync(filesPath)) fs.unlinkSync(filesPath);

              const mediaPath = path.join(chatsDir, chatId, 'Media', file.name);
              if (fs.existsSync(mediaPath)) fs.unlinkSync(mediaPath);

              chatKbFiles = chatKbFiles.filter(f => f.name !== file.name);
            } catch (err) {
              console.error(`Error deleting attached file ${file.name} on message deletion:`, err);
            }
          }

          db.prepare('UPDATE chats SET knowledgeFiles = ? WHERE id = ?').run(JSON.stringify(chatKbFiles), chatId);
        }
      }
    }

    db.prepare('DELETE FROM messages WHERE id = ?').run(messageId);
    return { success: true };
  } catch (e) {
    console.error("Error deleting message:", e);
    throw e;
  }
});

ipcMain.handle('revert-chat-to-message', async (event, { chatId, messageId }) => {
  try {
    const messages = db.prepare('SELECT id FROM messages WHERE chatId = ? ORDER BY createdAt ASC').all(chatId);
    const targetIndex = messages.findIndex(m => m.id === messageId);
    if (targetIndex === -1) throw new Error("Message not found in this chat");

    const toDelete = messages.slice(targetIndex + 1);
    if (toDelete.length > 0) {
      const deleteStmt = db.prepare('DELETE FROM messages WHERE id = ?');
      const transaction = db.transaction((ids) => {
        for (const id of ids) {
          deleteStmt.run(id);
        }
      });
      transaction(toDelete.map(m => m.id));
    }
    return { success: true };
  } catch (e) {
    console.error("Error reverting chat to message:", e);
    throw e;
  }
});

ipcMain.handle('trigger-manual-summarize', async (event, { chatId, profileId }) => {
  try {
    const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId);
    if (!chat) throw new Error("Chat not found");

    const messages = db.prepare('SELECT * FROM messages WHERE chatId = ? ORDER BY createdAt ASC').all(chatId);
    const summarizedIndex = chat.summarizedIndex || 0;

    const tempSummarizeEndIndex = Math.max(0, messages.length - 10);
    if (tempSummarizeEndIndex <= summarizedIndex) {
      return { success: false, message: "Not enough active messages to archive (need at least 11)." };
    }

    const activeRange = messages.slice(summarizedIndex, tempSummarizeEndIndex);
    const { executeSummarizationInternal } = require('./workflow-runner');
    const result = await executeSummarizationInternal({
      chatId,
      selectedMessages: activeRange,
      newSummarizedIndex: tempSummarizeEndIndex,
      customTitle: '',
      profileId
    });

    return { success: true, ...result };
  } catch (e) {
    console.error("Manual summarization failed:", e);
    throw e;
  }
});

ipcMain.handle('execute-summarization', async (event, { chatId, selectedMessages, newSummarizedIndex, customTitle, profileId }) => {
  try {
    const { executeSummarizationInternal } = require('./workflow-runner');
    const result = await executeSummarizationInternal({ chatId, selectedMessages, newSummarizedIndex, customTitle, profileId });
    return { success: true, ...result };
  } catch (e) {
    console.error("Error executing summarization:", e);
    throw e;
  }
});

// ==========================================
// --- AGENT WORKFLOWS IPC HANDLERS ---
// ==========================================
ipcMain.handle('get-workflows', async () => {
  try {
    const rows = db.prepare('SELECT * FROM workflows').all();
    return rows;
  } catch (e) {
    console.error("Error loading workflows:", e);
    return [];
  }
});

ipcMain.handle('save-workflow', async (event, workflow) => {
  try {
    const insert = db.prepare(`
      INSERT OR REPLACE INTO workflows (id, name, entryProfileId, steps)
      VALUES (?, ?, ?, ?)
    `);
    insert.run(
      workflow.id,
      workflow.name,
      workflow.entryProfileId,
      typeof workflow.steps === 'string' ? workflow.steps : JSON.stringify(workflow.steps || [])
    );
    return { success: true };
  } catch (e) {
    console.error("Error saving workflow:", e);
    throw e;
  }
});

ipcMain.handle('delete-workflow', async (event, id) => {
  try {
    db.prepare('DELETE FROM workflows WHERE id = ?').run(id);
    return { success: true };
  } catch (e) {
    console.error("Error deleting workflow:", e);
    throw e;
  }
});

ipcMain.handle('export-workflow', async (event, { workflow, exportKb }) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    const saveResult = await dialog.showSaveDialog(win, {
      title: 'Export Workflow Package',
      defaultPath: `${workflow.name.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_workflow.klw`,
      filters: [{ name: 'Kallamo Workflow Package', extensions: ['klw'] }]
    });

    if (saveResult.canceled || !saveResult.filePath) {
      return { success: false, canceled: true };
    }

    event.sender.send('export-progress', { progress: 10, status: 'Initializing export container...' });
    const zip = new AdmZip();

    event.sender.send('export-progress', { progress: 20, status: 'Compiling workflow settings...' });
    zip.addFile('workflow.json', Buffer.from(JSON.stringify(workflow, null, 2), 'utf8'));

    event.sender.send('export-progress', { progress: 30, status: 'Gathering workflow AI profiles...' });
    let stepsList = [];
    try {
      stepsList = typeof workflow.steps === 'string' ? JSON.parse(workflow.steps) : (workflow.steps || []);
    } catch (e) {
      stepsList = [];
    }

    const profileIds = new Set();
    if (workflow.entryProfileId) profileIds.add(workflow.entryProfileId);
    stepsList.forEach(s => {
      if (s.profileId) profileIds.add(s.profileId);
    });

    const profilesList = [];
    const profileIdsArray = Array.from(profileIds);
    const totalProfiles = profileIdsArray.length;

    for (let idx = 0; idx < totalProfiles; idx++) {
      const pId = profileIdsArray[idx];
      const profile = db.prepare('SELECT * FROM writing_profiles WHERE id = ?').get(pId);
      if (profile) {
        profilesList.push({
          ...profile,
          apiProfileId: '',
          model: ''
        });

        if (exportKb) {
          const profileProgressPercent = Math.round(30 + ((idx / totalProfiles) * 50));
          event.sender.send('export-progress', {
            progress: profileProgressPercent,
            status: `Gathering knowledge base for profile: ${profile.name}...`
          });

          const manualBlocks = [];
          const chunks = db.prepare('SELECT id, source, text, vector, createdAt FROM knowledge_chunks WHERE ownerId = ? AND ownerType = ?').all(pId, 'profile_kb');
          chunks.forEach((v) => {
            if (v.id && (v.id.startsWith('mem_') || v.id.startsWith('manual_'))) {
              let cleanText = v.text || '';
              if (cleanText.startsWith('Document:') && cleanText.includes('\nContent: ')) {
                cleanText = cleanText.substring(cleanText.indexOf('\nContent: ') + 10);
              }
              let keywords = [];
              const tagsMatch = v.text ? v.text.match(/Tags: (.*)\n/) : null;
              if (tagsMatch && tagsMatch[1]) {
                keywords = tagsMatch[1].split(',').map(k => k.trim());
              }
              manualBlocks.push({
                source: v.source,
                text: cleanText,
                keywords: keywords
              });
            }
          });
          if (manualBlocks.length > 0) {
            zip.addFile(`manual_blocks_${pId}.json`, Buffer.from(JSON.stringify(manualBlocks, null, 2), 'utf8'));
          }

          if (profile.knowledgeFiles) {
            try {
              const fileList = JSON.parse(profile.knowledgeFiles);
              for (const file of fileList) {
                if (file.internalPath && fs.existsSync(file.internalPath)) {
                  zip.addLocalFile(file.internalPath, `files/${pId}`);
                }
              }
            } catch (err) {
              console.error(`Error packaging files for profile ${pId}:`, err);
            }
          }
        }
      }
    }

    zip.addFile('profiles.json', Buffer.from(JSON.stringify(profilesList, null, 2), 'utf8'));

    event.sender.send('export-progress', { progress: 85, status: 'Compressing and writing workflow package...' });
    zip.writeZip(saveResult.filePath);

    event.sender.send('export-progress', { progress: 100, status: 'Export completed successfully!' });
    return { success: true };
  } catch (e) {
    console.error("Error exporting workflow package:", e);
    throw e;
  }
});

ipcMain.handle('import-workflow', async (event) => {
  try {
    const win = BrowserWindow.fromWebContents(event.sender);
    const openResult = await dialog.showOpenDialog(win, {
      title: 'Import Workflow Package',
      filters: [{ name: 'Kallamo Workflow Package', extensions: ['klw'] }],
      properties: ['openFile']
    });

    if (openResult.canceled || openResult.filePaths.length === 0) {
      return { success: false, canceled: true };
    }

    const filePath = openResult.filePaths[0];
    event.sender.send('import-progress', { progress: 10, status: 'Reading workflow package archive...' });
    const zip = new AdmZip(filePath);

    const workflowEntry = zip.getEntry('workflow.json');
    if (!workflowEntry) {
      throw new Error('Invalid package: workflow.json not found inside package.');
    }

    const workflowJson = zip.readAsText(workflowEntry);
    const importedWorkflow = JSON.parse(workflowJson);

    let newWorkflowId = importedWorkflow.id;
    let newWorkflowName = importedWorkflow.name;

    const wfIdExists = db.prepare('SELECT id FROM workflows WHERE id = ?').get(newWorkflowId);
    const wfNameExists = db.prepare('SELECT id FROM workflows WHERE name = ?').get(newWorkflowName);

    if (wfIdExists || wfNameExists) {
      newWorkflowId = 'wf_' + Math.random().toString(36).substr(2, 9);
      newWorkflowName = `${newWorkflowName} - Imported`;
    }

    const profilesEntry = zip.getEntry('profiles.json');
    const importedProfiles = profilesEntry ? JSON.parse(zip.readAsText(profilesEntry)) : [];

    const profileIdMap = new Map();
    const totalProfiles = importedProfiles.length;

    for (let idx = 0; idx < totalProfiles; idx++) {
      const profile = importedProfiles[idx];
      let newProfileId = profile.id;
      let newProfileName = profile.name;

      const pIdExists = db.prepare('SELECT id FROM writing_profiles WHERE id = ?').get(newProfileId);
      const pNameExists = db.prepare('SELECT id FROM writing_profiles WHERE name = ?').get(newProfileName);

      if (pIdExists || pNameExists) {
        newProfileId = 'profile_' + Math.random().toString(36).substr(2, 9);
        newProfileName = `${newProfileName} - Imported`;
      }

      profileIdMap.set(profile.id, newProfileId);

      profile.apiProfileId = '';
      profile.model = '';

      const knowledgeFilesMetadata = [];
      const kbDir = path.join(profilesDir, newProfileId, 'KnowledgeBase');

      const manualBlocksEntry = zip.getEntry(`manual_blocks_${profile.id}.json`);
      const filesPrefix = `files/${profile.id}/`;
      const filesEntries = zip.getEntries().filter(entry => entry.entryName.startsWith(filesPrefix) && !entry.isDirectory);

      if (manualBlocksEntry || filesEntries.length > 0) {
        if (!fs.existsSync(kbDir)) {
          fs.mkdirSync(kbDir, { recursive: true });
        }

        const totalFiles = filesEntries.length;
        for (let i = 0; i < totalFiles; i++) {
          const entry = filesEntries[i];
          const fileName = path.basename(entry.entryName);
          const destPath = path.join(kbDir, fileName);

          const contentBuffer = entry.getData();
          fs.writeFileSync(destPath, contentBuffer);

          knowledgeFilesMetadata.push({
            name: fileName,
            originalPath: '',
            internalPath: destPath,
            size: contentBuffer.length,
            strategy: 'full_context'
          });
        }

        if (manualBlocksEntry) {
          const manualBlocksText = zip.readAsText(manualBlocksEntry);
          const manualBlocks = JSON.parse(manualBlocksText);

          const totalBlocks = manualBlocks.length;
          for (let i = 0; i < totalBlocks; i++) {
            const block = manualBlocks[i];
            const newBlockId = `manual_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
            const cleanKeywords = Array.isArray(block.keywords)
              ? block.keywords.map(k => {
                const trimmed = k.trim().toLowerCase();
                return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
              }).filter(Boolean)
              : [];

            const vectors = await vectorizeChunks([block.text], block.source, null, cleanKeywords);
            const chunk = vectors[0] || null;
            if (chunk) {
              chunk.id = newBlockId;
              chunk.keywords = cleanKeywords;
              insertChunksToDb(newProfileId, 'profile_kb', [chunk]);
            }
          }
        }
      }

      event.sender.send('import-progress', {
        progress: Math.round(20 + ((idx / totalProfiles) * 60)),
        status: `Saving profile: ${newProfileName}...`
      });

      const insertProfile = db.prepare(`
        INSERT INTO writing_profiles (
          id, name, description, color, apiProfileId, model, temperature, maxTokens,
          systemPrompt, knowledgeFiles, manualMode, manualJson, isAgentic, agenticPrompt, agenticMaxTurns, syncToCloud
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      insertProfile.run(
        newProfileId,
        newProfileName,
        profile.description || '',
        profile.color || '#FBCB2D',
        '',
        '',
        profile.temperature ?? 0.7,
        profile.maxTokens ?? 2048,
        profile.systemPrompt || '',
        JSON.stringify(knowledgeFilesMetadata),
        profile.manualMode ? 1 : 0,
        profile.manualJson || '',
        profile.isAgentic ? 1 : 0,
        profile.agenticPrompt || '',
        profile.agenticMaxTurns ?? 3,
        profile.syncToCloud ?? 0
      );

      if (knowledgeFilesMetadata.length > 0) {
        indexProfileKnowledgeBase(event.sender, newProfileId, knowledgeFilesMetadata).catch(e => {
          console.error(`Background profile indexing error during workflow import for profile ${newProfileId}:`, e);
        });
      }
    }

    event.sender.send('import-progress', { progress: 90, status: 'Mapping and saving workflow steps...' });

    let stepsList = [];
    try {
      stepsList = typeof importedWorkflow.steps === 'string' ? JSON.parse(importedWorkflow.steps) : (importedWorkflow.steps || []);
    } catch (e) {
      stepsList = [];
    }

    const updatedSteps = stepsList.map(step => {
      const mappedProfileId = profileIdMap.get(step.profileId);
      return {
        ...step,
        profileId: mappedProfileId || step.profileId
      };
    });

    const mappedEntryProfileId = profileIdMap.get(importedWorkflow.entryProfileId) || importedWorkflow.entryProfileId;

    const insertWorkflow = db.prepare(`
      INSERT INTO workflows (id, name, entryProfileId, steps)
      VALUES (?, ?, ?, ?)
    `);

    insertWorkflow.run(
      newWorkflowId,
      newWorkflowName,
      mappedEntryProfileId,
      JSON.stringify(updatedSteps)
    );

    event.sender.send('import-progress', { progress: 100, status: 'Import completed successfully!' });
    return { success: true, workflow: { id: newWorkflowId, name: newWorkflowName } };
  } catch (e) {
    console.error("Error importing workflow package:", e);
    throw e;
  }
});

// ==========================================
// --- SETTINGS IPC HANDLERS ---
// ==========================================
ipcMain.handle('get-settings', async () => {
  try {
    const rowInterface = db.prepare("SELECT value FROM settings WHERE key = 'interface'").get();
    const rowAdvanced = db.prepare("SELECT value FROM settings WHERE key = 'advanced'").get();

    const defaultSettings = {
      interface: { fontFamily: 'sans', fontSize: 'medium', layout: 'bubbles', blur: true, accentColor: '#FBCB2D', codeTheme: 'github-dark', lineNumbers: false },
      advanced: { chunkSize: 500, similarity: 0.3, topKKB: 5, topKMemory: 5, executionDevice: 'cpu', ragDebug: false, agenticDebug: false, tokenDebug: false }
    };

    return {
      interface: rowInterface ? JSON.parse(rowInterface.value) : defaultSettings.interface,
      advanced: rowAdvanced ? JSON.parse(rowAdvanced.value) : defaultSettings.advanced
    };
  } catch (e) {
    console.error("Error reading settings from SQLite:", e);
    return null;
  }
});

ipcMain.handle('save-settings', async (event, settingsObj) => {
  try {
    const insert = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    insert.run('interface', JSON.stringify(settingsObj.interface || {}));
    insert.run('advanced', JSON.stringify(settingsObj.advanced || {}));
    return { success: true };
  } catch (e) {
    console.error("Error saving settings to SQLite:", e);
    throw e;
  }
});

// ==========================================
// --- UTILITIES IPC HANDLERS ---
// ==========================================
ipcMain.on('open-workspace-folder', () => {
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true });
  }
  shell.openPath(dataDir);
});

// ==========================================
// --- WORKFLOW GENERATION IPC HANDLERS ---
// ==========================================
const { runWorkflow, cancelGeneration, resolveErrorDeferred, resolveOverflowDeferred } = require('./workflow-runner');

ipcMain.handle('send-message', async (event, { chatId, messageContent, targetId, attachedFiles }) => {
  try {
    return await runWorkflow({ chatId, messageContent, targetId, attachedFiles, webContents: event.sender });
  } catch (error) {
    console.error("Error in send-message IPC handler:", error);
    throw error;
  }
});

ipcMain.on('cancel-generation', () => {
  cancelGeneration();
});

ipcMain.on('respond-to-error', (event, decision) => {
  resolveErrorDeferred(decision);
});

ipcMain.on('respond-to-overflow', (event, { decision, editedText }) => {
  resolveOverflowDeferred(decision, editedText);
});

// ==========================================
// --- UTILITIES SYSTEM DIALOGS HANDLERS ---
// ==========================================
ipcMain.handle('backup-workspace', async (event) => {
  try {
    const { BrowserWindow } = require('electron');
    const win = BrowserWindow.fromWebContents(event.sender);

    const { filePath } = await dialog.showSaveDialog(win, {
      title: 'Export Workspace Backup',
      defaultPath: path.join(os.homedir(), 'Downloads', 'kallamo_backup.db'),
      filters: [
        { name: 'SQLite Database', extensions: ['db'] }
      ]
    });

    if (filePath) {
      await db.backup(filePath);
      return { success: true, filePath };
    }
    return { cancelled: true };
  } catch (err) {
    console.error("Backup failed:", err);
    throw err;
  }
});

ipcMain.handle('restore-workspace', async (event) => {
  try {
    const { BrowserWindow } = require('electron');
    const win = BrowserWindow.fromWebContents(event.sender);

    const { filePaths } = await dialog.showOpenDialog(win, {
      title: 'Import Workspace Backup',
      filters: [{ name: 'SQLite Database', extensions: ['db'] }],
      properties: ['openFile']
    });

    if (!filePaths || filePaths.length === 0) {
      return { cancelled: true };
    }

    const pickedFile = filePaths[0];

    const Database = require('better-sqlite3');
    let tempDb;
    try {
      tempDb = new Database(pickedFile, { readonly: true });

      const integrity = tempDb.pragma('integrity_check', { simple: true });
      if (integrity !== 'ok') {
        throw new Error("Database integrity check failed.");
      }

      const requiredTables = ['chats', 'messages', 'knowledge_chunks', 'settings'];
      for (const table of requiredTables) {
        const row = tempDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
        if (!row) {
          throw new Error(`Required table "${table}" is missing.`);
        }
      }
    } catch (validationErr) {
      console.error("Backup validation failed:", validationErr);
      return { success: false, error: `Invalid backup file: ${validationErr.message}` };
    } finally {
      if (tempDb) {
        try { tempDb.close(); } catch (e) { }
      }
    }

    const { response } = await dialog.showMessageBox(win, {
      type: 'warning',
      buttons: ['Cancel', 'Restore & Restart'],
      defaultId: 0,
      title: 'Restore Workspace',
      message: 'This will replace ALL current data. A safety backup of your current workspace will be saved. Continue?',
      detail: 'The application will restart to complete the restore process safely.'
    });

    if (response !== 1) {
      return { cancelled: true };
    }

    // WAL-safe snapshot of the current DB before overwriting (db.backup, not copyFileSync)
    const timestamp = Date.now();
    const safetyBackupPath = path.join(dataDir, `pre-restore-backup-${timestamp}.db`);
    await db.backup(safetyBackupPath);

    // Prune pre-restore-backup-* to keep last 5
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
        .sort((a, b) => b.ts - a.ts); // newest first

      if (backups.length > 5) {
        const filesToDelete = backups.slice(5);
        for (const b of filesToDelete) {
          const bp = path.join(dataDir, b.file);
          if (fs.existsSync(bp)) fs.unlinkSync(bp);
        }
      }
    } catch (e) {
      console.error("Failed to prune old safety backups:", e);
    }

    const stagedPath = path.join(dataDir, 'restore-staged.db');
    fs.copyFileSync(pickedFile, stagedPath);

    const markerPath = path.join(dataDir, 'RESTORE_PENDING.json');
    fs.writeFileSync(markerPath, JSON.stringify({
      staged: 'restore-staged.db',
      ts: timestamp,
      sourceName: path.basename(pickedFile)
    }, null, 2), 'utf8');

    setTimeout(() => {
      app.relaunch();
      app.exit(0);
    }, 1000);

    return { success: true };
  } catch (err) {
    console.error("Restore failed:", err);
    return { success: false, error: err.message || 'An unexpected error occurred.' };
  }
});

ipcMain.handle('purge-vectors', async (event) => {
  try {
    db.prepare('DELETE FROM knowledge_chunks').run();
    db.prepare('DELETE FROM knowledge_chunks_fts').run();
    console.log("Vector DB cache purged successfully.");
    return { success: true };
  } catch (err) {
    console.error("Purge vectors failed:", err);
    throw err;
  }
});

ipcMain.handle('clear-model-cache', async (event) => {
  try {
    const cacheDir = path.join(os.homedir(), '.cache', 'huggingface');
    if (fs.existsSync(cacheDir)) {
      fs.rmSync(cacheDir, { recursive: true, force: true });
    }
    console.log("Embedding models cache cleared.");
    return { success: true };
  } catch (err) {
    console.error("Clear cache failed:", err);
    throw err;
  }
});

ipcMain.handle('save-chat-manual-snippet', async (event, { chatId, snippetId, title, content }) => {
  try {
    const vectorData = await vectorizeChunks([content], title);
    const chunk = vectorData[0] || null;
    if (chunk) {
      const insertChunk = db.prepare(`
        INSERT OR REPLACE INTO knowledge_chunks (id, ownerId, ownerType, source, text, vector, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `);
      const insertFts = db.prepare(`
        INSERT OR REPLACE INTO knowledge_chunks_fts (chunkId, text)
        VALUES (?, ?)
      `);
      db.transaction(() => {
        insertChunk.run(snippetId, chatId, 'chat_memory', title, content, JSON.stringify(chunk.vector), Date.now());
        insertFts.run(snippetId, content);
      })();
    }

    return { success: true };
  } catch (e) {
    console.error("Error saving manual chat snippet vector:", e);
    throw e;
  }
});

ipcMain.handle('delete-chat-manual-snippet', async (event, { chatId, snippetId }) => {
  try {
    db.transaction(() => {
      db.prepare('DELETE FROM knowledge_chunks WHERE ownerId = ? AND id = ?').run(chatId, snippetId);
      db.prepare('DELETE FROM knowledge_chunks_fts WHERE chunkId = ?').run(snippetId);
    })();

    return { success: true };
  } catch (e) {
    console.error("Error deleting manual snippet:", e);
    throw e;
  }
});

ipcMain.handle('get-chat-kb-blocks', async (event, { chatId }) => {
  try {
    const loadedKbData = [];

    const ragChunks = db.prepare('SELECT id, source, text, enabled, manuallyEdited FROM knowledge_chunks WHERE ownerId = ? AND ownerType = ?').all(chatId, 'chat_kb');
    ragChunks.forEach((v) => {
      let cleanText = v.text || '';
      if (cleanText.startsWith('Document:') && cleanText.includes('\nContent: ')) {
        cleanText = cleanText.substring(cleanText.indexOf('\nContent: ') + 10);
      }
      loadedKbData.push({
        id: v.id,
        type: 'rag',
        source: v.source,
        text: cleanText,
        enabled: v.enabled !== 0,
        manuallyEdited: v.manuallyEdited === 1,
        rawItem: v
      });
    });

    const chatRow = db.prepare('SELECT memoryBlocks, knowledgeFiles FROM chats WHERE id = ?').get(chatId);
    if (chatRow && chatRow.memoryBlocks) {
      try {
        const snippets = JSON.parse(chatRow.memoryBlocks);

        for (const v of snippets) {
          if (!v.id) continue;
          if (v.type === 'summarized') continue; // Skip migration check for history summaries

          if (v.strategy === 'constant') {
            db.transaction(() => {
              db.prepare('DELETE FROM knowledge_chunks WHERE ownerId = ? AND id = ?').run(chatId, v.id);
              db.prepare('DELETE FROM knowledge_chunks_fts WHERE chunkId = ?').run(v.id);
            })();
            continue;
          }

          const exists = db.prepare('SELECT id FROM knowledge_chunks WHERE ownerId = ? AND id = ?').get(chatId, v.id);
          if (!exists) {
            console.log(`[Migration] Manual snippet ${v.id} ("${v.title || v.source}") missing from SQLite. Vectorizing...`);
            const content = v.summary || v.text || '';
            const title = v.title || v.source || 'Custom Memory';
            try {
              const vectorData = await vectorizeChunks([content], title);
              const chunk = vectorData[0] || null;
              if (chunk) {
                const insertChunk = db.prepare(`
                  INSERT OR REPLACE INTO knowledge_chunks (id, ownerId, ownerType, source, text, vector, createdAt)
                  VALUES (?, ?, ?, ?, ?, ?, ?)
                `);
                const insertFts = db.prepare(`
                  INSERT OR REPLACE INTO knowledge_chunks_fts (chunkId, text)
                  VALUES (?, ?)
                `);
                db.transaction(() => {
                  insertChunk.run(v.id, chatId, 'chat_memory', title, content, JSON.stringify(chunk.vector), Date.now());
                  insertFts.run(v.id, content);
                })();
              }
            } catch (err) {
              console.error(`Failed to migrate manual snippet ${v.id}:`, err);
            }
          }
        }

        snippets.forEach((v, idx) => {
          if (v.type === 'summarized') return; // Skip history summaries so they are not loaded as manual/custom snippets

          let cleanText = v.summary || v.text || '';
          if (cleanText.startsWith('Document:') && cleanText.includes('\nContent: ')) {
            cleanText = cleanText.substring(cleanText.indexOf('\nContent: ') + 10);
          }
          const rawItem = v.rawItem || {
            id: v.id,
            source: v.title || v.source || 'Custom Memory',
            text: v.summary || v.text || '',
            keywords: v.keywords || []
          };
          loadedKbData.push({
            id: v.id || `manual_${Date.now()}_${idx}`,
            type: 'manual',
            source: v.title || v.source || 'Custom Memory',
            text: cleanText,
            strategy: v.strategy || 'rag_search',
            enabled: v.enabled !== false,
            rawItem: {
              ...rawItem,
              strategy: v.strategy || 'rag_search'
            }
          });
        });
      } catch (e) {
        console.error("Error reading chat memoryBlocks:", e);
      }
    }

    if (chatRow && chatRow.knowledgeFiles) {
      try {
        const files = JSON.parse(chatRow.knowledgeFiles);
        for (let idx = 0; idx < files.length; idx++) {
          const file = files[idx];
          const isConstant = !file.strategy || file.strategy === 'constant' || file.strategy === 'full_context';
          if (isConstant) {
            const dbRows = db.prepare('SELECT id FROM knowledge_chunks WHERE ownerId = ? AND source = ?').all(chatId, file.name);
            if (dbRows.length > 0) {
              db.transaction(() => {
                const deleteChunk = db.prepare('DELETE FROM knowledge_chunks WHERE id = ?');
                const deleteFts = db.prepare('DELETE FROM knowledge_chunks_fts WHERE chunkId = ?');
                for (const r of dbRows) {
                  deleteChunk.run(r.id);
                  deleteFts.run(r.id);
                }
              })();
            }

            let content = '';
            if (file.internalPath && fs.existsSync(file.internalPath)) {
              try {
                const ext = path.extname(file.name).toLowerCase();
                if (ext === '.txt' || ext === '.md' || ext === '.json' || ext === '.csv') {
                  content = fs.readFileSync(file.internalPath, 'utf8');
                } else {
                  content = await extractTextFromFile(file.internalPath);
                }
              } catch (e) {
                console.error("Error reading chat constant file:", e);
              }
            }
            loadedKbData.push({
              id: `const_${Date.now()}_${idx}`,
              type: 'constant',
              source: file.name,
              text: content || '',
              enabled: file.enabled !== false,
              rawItem: file
            });
          }
        }
      } catch (e) {
        console.error("Error parsing chat knowledgeFiles:", e);
      }
    }

    // Ensure every block carries an approximate token count for the UI
    for (const b of loadedKbData) {
      if (b.tokenCount == null) {
        b.tokenCount = countTokens(b.text || '');
      }
    }

    return loadedKbData;
  } catch (e) {
    console.error("Error getting chat KB blocks:", e);
    throw e;
  }
});

ipcMain.handle('save-chat-kb-block', async (event, { chatId, block }) => {
  try {
    if (block.type === 'manual') {
      const snippetId = block.id && !block.id.startsWith('manual_new') ? block.id : `manual_${Date.now()}`;

      const cleanKeywords = Array.isArray(block.keywords)
        ? block.keywords.map(k => {
          const trimmed = k.trim().toLowerCase();
          return trimmed.startsWith('#') ? trimmed : `#${trimmed}`;
        }).filter(Boolean)
        : [];

      // Resolve the enable flag up front so a rebuilt searchable chunk keeps it
      // (the INSERT below would otherwise reset enabled to the default).
      const existingMemoryRow = db.prepare('SELECT memoryBlocks FROM chats WHERE id = ?').get(chatId);
      const existingEntry = existingMemoryRow && existingMemoryRow.memoryBlocks
        ? JSON.parse(existingMemoryRow.memoryBlocks).find(b => b.id === snippetId)
        : null;
      const resolvedEnabled = block.enabled !== undefined
        ? block.enabled !== false
        : (existingEntry ? existingEntry.enabled !== false : true);

      if (block.strategy === 'constant') {
        db.transaction(() => {
          db.prepare('DELETE FROM knowledge_chunks WHERE ownerId = ? AND id = ?').run(chatId, snippetId);
          db.prepare('DELETE FROM knowledge_chunks_fts WHERE chunkId = ?').run(snippetId);
        })();
      } else {
        const vectorData = await vectorizeChunks([block.text], block.source || 'Custom Memory', null, cleanKeywords);
        const chunk = vectorData[0] || null;
        if (chunk) {
          chunk.id = snippetId;
          chunk.blockId = snippetId;
          chunk.keywords = cleanKeywords;

          const insertChunk = db.prepare(`
            INSERT OR REPLACE INTO knowledge_chunks (id, ownerId, ownerType, source, text, vector, createdAt, enabled)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `);
          const insertFts = db.prepare(`
            INSERT OR REPLACE INTO knowledge_chunks_fts (chunkId, text)
            VALUES (?, ?)
          `);
          db.transaction(() => {
            insertChunk.run(
              snippetId,
              chatId,
              'chat_memory',
              block.source || 'Custom Memory',
              chunk.text,
              JSON.stringify(chunk.vector),
              Date.now(),
              resolvedEnabled ? 1 : 0
            );
            insertFts.run(snippetId, chunk.text);
          })();
        }
      }

      const chatRow = db.prepare('SELECT memoryBlocks FROM chats WHERE id = ?').get(chatId);
      let memoryBlocks = [];
      if (chatRow && chatRow.memoryBlocks) {
        memoryBlocks = JSON.parse(chatRow.memoryBlocks);
      }

      const snippetCard = {
        id: snippetId,
        title: block.source || 'Custom Memory',
        summary: block.text,
        type: 'manual',
        strategy: block.strategy || 'rag_search',
        profiles: block.profiles || [],
        keywords: cleanKeywords,
        enabled: resolvedEnabled
      };

      const index = memoryBlocks.findIndex(b => b.id === snippetId);
      if (index >= 0) {
        memoryBlocks[index] = snippetCard;
      } else {
        memoryBlocks.unshift(snippetCard);
      }

      db.prepare('UPDATE chats SET memoryBlocks = ? WHERE id = ?').run(JSON.stringify(memoryBlocks), chatId);
    }
    else if (block.type === 'constant') {
      const chatRow = db.prepare('SELECT knowledgeFiles FROM chats WHERE id = ?').get(chatId);
      if (chatRow && chatRow.knowledgeFiles) {
        const files = JSON.parse(chatRow.knowledgeFiles);
        const fileIndex = files.findIndex(f => f.name === block.source);
        if (fileIndex >= 0) {
          const file = files[fileIndex];
          if (file.internalPath) {
            fs.writeFileSync(file.internalPath, block.text, 'utf8');
            const stats = fs.statSync(file.internalPath);
            file.size = stats.size;
            files[fileIndex] = file;
            db.prepare('UPDATE chats SET knowledgeFiles = ? WHERE id = ?').run(JSON.stringify(files), chatId);
          }
        }
      }
    }
    else if (block.type === 'rag') {
      const vectorData = await vectorizeChunks([block.text], block.source);
      const chunk = vectorData[0] || null;
      if (chunk) {
        db.prepare('UPDATE knowledge_chunks SET text = ?, vector = ?, manuallyEdited = 1 WHERE id = ?').run(
          chunk.text,
          JSON.stringify(chunk.vector),
          block.id
        );
        db.prepare('UPDATE knowledge_chunks_fts SET text = ? WHERE chunkId = ?').run(
          chunk.text,
          block.id
        );
      }
    }

    return { success: true };
  } catch (e) {
    console.error("Error saving chat KB block:", e);
    throw e;
  }
});

ipcMain.handle('delete-chat-kb-block', async (event, { chatId, block }) => {
  try {
    if (block.type === 'manual' || block.type === 'summarized') {
      const chatRow = db.prepare('SELECT memoryBlocks FROM chats WHERE id = ?').get(chatId);
      if (chatRow && chatRow.memoryBlocks) {
        let memoryBlocks = JSON.parse(chatRow.memoryBlocks);
        memoryBlocks = memoryBlocks.filter(b => b.id !== block.id);
        db.prepare('UPDATE chats SET memoryBlocks = ? WHERE id = ?').run(JSON.stringify(memoryBlocks), chatId);
      }

      db.transaction(() => {
        db.prepare('DELETE FROM knowledge_chunks WHERE ownerId = ? AND id = ?').run(chatId, block.id);
        db.prepare('DELETE FROM knowledge_chunks_fts WHERE chunkId = ?').run(block.id);
      })();
    }
    else if (block.type === 'constant') {
      const chatRow = db.prepare('SELECT knowledgeFiles FROM chats WHERE id = ?').get(chatId);
      if (chatRow && chatRow.knowledgeFiles) {
        let files = JSON.parse(chatRow.knowledgeFiles);
        const fileObj = files.find(f => f.name === block.source);
        files = files.filter(f => f.name !== block.source);
        db.prepare('UPDATE chats SET knowledgeFiles = ? WHERE id = ?').run(JSON.stringify(files), chatId);

        if (fileObj && fileObj.internalPath) {
          if (fs.existsSync(fileObj.internalPath)) {
            try { fs.unlinkSync(fileObj.internalPath); } catch (e) { }
          }
          const filesPath = path.join(chatsDir, chatId, 'Files', fileObj.name);
          if (fs.existsSync(filesPath)) {
            try { fs.unlinkSync(filesPath); } catch (e) { }
          }
        }
      }
    }
    else if (block.type === 'rag') {
      db.prepare('DELETE FROM knowledge_chunks WHERE id = ?').run(block.id);
      db.prepare('DELETE FROM knowledge_chunks_fts WHERE chunkId = ?').run(block.id);

      const remainingRow = db.prepare('SELECT COUNT(*) as cnt FROM knowledge_chunks WHERE ownerId = ? AND ownerType = ? AND source = ?').get(chatId, 'chat_kb', block.source);
      const remainingCount = remainingRow ? remainingRow.cnt : 0;

      if (remainingCount === 0) {
        const chatRow = db.prepare('SELECT knowledgeFiles FROM chats WHERE id = ?').get(chatId);
        if (chatRow && chatRow.knowledgeFiles) {
          let files = JSON.parse(chatRow.knowledgeFiles);
          const fileObj = files.find(f => f.name === block.source);
          files = files.filter(f => f.name !== block.source);
          db.prepare('UPDATE chats SET knowledgeFiles = ? WHERE id = ?').run(JSON.stringify(files), chatId);

          if (fileObj && fileObj.internalPath) {
            if (fs.existsSync(fileObj.internalPath)) {
              try { fs.unlinkSync(fileObj.internalPath); } catch (e) { }
            }
            const filesPath = path.join(chatsDir, chatId, 'Files', fileObj.name);
            if (fs.existsSync(filesPath)) {
              try { fs.unlinkSync(filesPath); } catch (e) { }
            }
          }
        }
      }
    }

    return { success: true };
  } catch (e) {
    console.error("Error deleting chat KB block:", e);
    throw e;
  }
});

ipcMain.handle('test-chat-rag-search', async (event, { chatId, queryText, profileId }) => {
  try {
    const profile = profileId ? db.prepare('SELECT * FROM writing_profiles WHERE id = ?').get(profileId) : null;

    let searchQuery = queryText;
    let isAgenticApplied = false;

    if (profile && profile.isAgentic === 1) {
      const { sendApiRequest } = require('./api-engine');
      try {
        const agenticSystemPrompt = profile.agenticPrompt && profile.agenticPrompt.trim()
          ? profile.agenticPrompt.trim()
          : "You are a search query optimizer. Extract the specific names, proper nouns, and primary search keywords from the user prompt. Always keep specific names and proper nouns intact. Output ONLY the optimized query terms without quotes, introduction, or explanation.";

        const refinedOutput = await sendApiRequest({
          apiProfileId: profile.apiProfileId,
          model: profile.model,
          systemPrompt: agenticSystemPrompt,
          chatHistory: [],
          newPrompt: queryText,
          temperature: 0.1,
          maxTokens: 100,
          manualMode: false,
          manualJson: ''
        });

        if (refinedOutput && refinedOutput.trim() && !refinedOutput.startsWith('[Error]') && !refinedOutput.startsWith('[Connection Error]')) {
          searchQuery = refinedOutput.trim().replace(/^["']|["']$/g, '').replace(/\.$/, '').trim();
          isAgenticApplied = true;
          console.log(`[Simulator Agentic RAG] Refined query: "${searchQuery}"`);
        }
      } catch (err) {
        console.error("Agentic RAG refinement in simulator failed:", err);
      }
    }

    const chatKbResults = await searchChatKnowledgeBase(searchQuery, chatId);
    const memoryResults = await searchChatMemories(searchQuery, chatId);

    let profileKbResults = [];
    if (profile) {
      const results = await searchKnowledgeBase(searchQuery, profileId);
      if (results && results.length > 0) {
        profileKbResults = results.map(r => ({ source: r.source, text: r.text, score: r.score }));
      }
    }

    return {
      searchQuery,
      isAgenticApplied,
      kbResults: chatKbResults.map(r => ({ source: r.source, text: r.text, score: r.score })),
      memoryResults: memoryResults.map(r => ({ source: r.title || 'Summarized History', text: r.text, score: r.score })),
      profileResults: profileKbResults
    };
  } catch (e) {
    console.error("Error testing chat RAG search:", e);
    return { kbResults: [], memoryResults: [], profileResults: [], searchQuery: queryText, isAgenticApplied: false };
  }
});

// Variables CRUD IPC Handlers
ipcMain.handle('variables:get', async () => {
  try {
    return db.prepare('SELECT * FROM variables ORDER BY name ASC').all();
  } catch (e) {
    console.error("Error fetching variables:", e);
    throw e;
  }
});

ipcMain.handle('variables:save', async (event, variable) => {
  try {
    const stmt = db.prepare(`
      INSERT INTO variables (id, name, key, value, description)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        name = excluded.name,
        key = excluded.key,
        value = excluded.value,
        description = excluded.description,
        last_modified = (strftime('%s', 'now') * 1000)
    `);
    stmt.run(
      variable.id,
      variable.name,
      variable.key,
      variable.value,
      variable.description || ''
    );
    return { success: true };
  } catch (e) {
    console.error("Error saving variable:", e);
    throw e;
  }
});

ipcMain.handle('variables:delete', async (event, id) => {
  try {
    db.prepare('DELETE FROM variables WHERE id = ?').run(id);
    return { success: true };
  } catch (e) {
    console.error("Error deleting variable:", e);
    throw e;
  }
});

// --- STARTUP RAG MODEL RE-INDEXING ---
// Detects when the local embedding model has changed and re-vectorizes
// all knowledge base content automatically in the background.
const { app } = require('electron');

async function performReindexIfNeeded() {
  try {
    const { isLocalEngineInstalled } = require('./rag-service');

    let embeddingEngine = 'local';
    try {
      const rowAdvanced = db.prepare("SELECT value FROM settings WHERE key = 'advanced'").get();
      if (rowAdvanced) {
        const advanced = JSON.parse(rowAdvanced.value);
        embeddingEngine = advanced.embeddingEngine || 'local';
      }
    } catch (e) { }

    if (embeddingEngine !== 'local') {
      console.log('[Re-Index] External embedding engine selected. Skipping local model re-index.');
      return;
    }

    if (!isLocalEngineInstalled()) {
      console.log('[Re-Index] Local embedding engine is not installed. Skipping background re-indexing.');
      const windows = BrowserWindow.getAllWindows();
      if (windows.length > 0 && !windows[0].webContents.isDestroyed()) {
        windows[0].webContents.send('reindex-progress', {
          status: 'idle',
          message: 'Download the Local AI Engine to finish indexing.'
        });
      }
      return;
    }

    const metaRow = db.prepare("SELECT value FROM settings WHERE key = 'rag_model_metadata'").get();
    let needsReindex = false;

    if (metaRow) {
      try {
        const meta = JSON.parse(metaRow.value);
        if (meta.model !== RAG_MODEL_ID || meta.dimension !== RAG_MODEL_DIM) {
          needsReindex = true;
        }
      } catch (e) {
        needsReindex = true;
      }
    } else {
      // No stamp exists — check if there are existing chunks that need re-vectorizing
      const chunkCount = db.prepare('SELECT COUNT(*) as cnt FROM knowledge_chunks').get();
      if (chunkCount && chunkCount.cnt > 0) {
        needsReindex = true;
      } else {
        // Fresh install, no data — just stamp it
        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
          'rag_model_metadata',
          JSON.stringify({ model: RAG_MODEL_ID, dimension: RAG_MODEL_DIM })
        );
        return;
      }
    }

    if (!needsReindex) return;

    console.log('[Re-Index] Model mismatch detected. Starting background re-indexing...');

    const windows = BrowserWindow.getAllWindows();
    const sender = windows.length > 0 ? windows[0].webContents : null;
    const sendProgress = (data) => {
      if (sender && !sender.isDestroyed()) {
        sender.send('reindex-progress', data);
      }
    };

    sendProgress({ status: 'started', message: 'Upgrading Knowledge Base...' });

    // Pre-flight: make sure the embedding pipeline actually loads before touching any data.
    try {
      const { getEmbeddingPipeline } = require('./rag-service');
      await getEmbeddingPipeline();
    } catch (preflightErr) {
      console.error('[Re-Index] Embedding pipeline failed to load. Aborting WITHOUT stamping:', preflightErr);
      sendProgress({ status: 'error', message: `Re-indexing aborted: embedding model failed to load.` });
      return; // <-- critical: do NOT proceed, do NOT stamp
    }

    let successCount = 0;
    let failureCount = 0;

    // Re-index chat memories
    const memoryChunks = db.prepare("SELECT * FROM knowledge_chunks WHERE ownerType = 'chat_memory'").all();
    let processed = 0;
    const totalMemories = memoryChunks.length;

    for (const chunk of memoryChunks) {
      try {
        const newVector = await generateEmbeddingVector(chunk.text, false);
        db.prepare('UPDATE knowledge_chunks SET vector = ? WHERE id = ?').run(
          JSON.stringify(newVector), chunk.id
        );
        successCount++;
      } catch (e) {
        failureCount++;
        console.error(`[Re-Index] Failed to re-vectorize memory chunk ${chunk.id}:`, e);
      }
      processed++;
      sendProgress({
        status: 'running',
        phase: 'memories',
        current: processed,
        total: totalMemories,
        message: `Re-indexing memories (${processed}/${totalMemories})...`
      });
    }

    // Re-index file-based knowledge bases
    let chunkSize = 500;
    try {
      const rowAdvanced = db.prepare("SELECT value FROM settings WHERE key = 'advanced'").get();
      if (rowAdvanced) {
        const advanced = JSON.parse(rowAdvanced.value);
        chunkSize = parseInt(advanced.chunkSize, 10) || 500;
      }
    } catch (e) { }

    const fileOwners = db.prepare(
      "SELECT DISTINCT ownerId, ownerType FROM knowledge_chunks WHERE ownerType IN ('profile_kb', 'chat_kb')"
    ).all();

    let fileTotal = 0;
    for (const owner of fileOwners) {
      const sourcesCount = db.prepare(
        'SELECT COUNT(DISTINCT source) AS c FROM knowledge_chunks WHERE ownerId = ? AND ownerType = ?'
      ).get(owner.ownerId, owner.ownerType);
      fileTotal += (sourcesCount ? sourcesCount.c : 0);
    }
    let fileProcessed = 0;

    for (const owner of fileOwners) {
      const sources = db.prepare(
        'SELECT DISTINCT source FROM knowledge_chunks WHERE ownerId = ? AND ownerType = ?'
      ).all(owner.ownerId, owner.ownerType);

      for (const srcRow of sources) {
        const sourceName = srcRow.source;
        sendProgress({
          status: 'running',
          phase: 'files',
          current: fileProcessed + 1,
          total: fileTotal,
          message: `Re-indexing: ${sourceName}...`
        });

        // Try to find the original file to re-extract text
        let baseDir;
        if (owner.ownerType === 'profile_kb') {
          baseDir = path.join(profilesDir, owner.ownerId, 'KnowledgeBase');
        } else {
          baseDir = path.join(chatsDir, owner.ownerId, 'KnowledgeBase');
        }

        const filePath = path.join(baseDir, sourceName);
        let success = false;

        // If any chunk of this file was manually edited, never re-chunk from disk
        // (that would discard the edits). Fall through to re-embedding the stored
        // chunk text instead, which still upgrades vectors for the new model.
        const editedCount = db.prepare(
          'SELECT COUNT(*) AS c FROM knowledge_chunks WHERE ownerId = ? AND ownerType = ? AND source = ? AND manuallyEdited = 1'
        ).get(owner.ownerId, owner.ownerType, sourceName);
        const hasManualEdits = editedCount && editedCount.c > 0;

        if (!hasManualEdits && fs.existsSync(filePath)) {
          try {
            const text = await extractTextFromFile(filePath);
            if (text && text.trim().length > 0) {
              const chunks = chunkText(text, chunkSize);
              const vectors = await vectorizeChunks(chunks, sourceName, null);

              deleteChunksFromDb(owner.ownerId, owner.ownerType, sourceName);
              insertChunksToDb(owner.ownerId, owner.ownerType, vectors);
              successCount += vectors.length;
              success = true;
            }
          } catch (e) {
            console.error(`[Re-Index] Failed to re-index file ${sourceName} from disk, falling back to database chunks:`, e);
          }
        }

        if (!success) {
          console.log(`[Re-Index] Re-vectorizing database chunks directly for ${sourceName} (${hasManualEdits ? 'has manual edits' : 'no source file'} — re-embedding stored chunks).`);
          const existingChunks = db.prepare('SELECT id, text FROM knowledge_chunks WHERE ownerId = ? AND ownerType = ? AND source = ?').all(owner.ownerId, owner.ownerType, sourceName);
          for (const chunk of existingChunks) {
            try {
              const newVector = await generateEmbeddingVector(chunk.text, false);
              db.prepare('UPDATE knowledge_chunks SET vector = ? WHERE id = ?').run(
                JSON.stringify(newVector), chunk.id
              );
              successCount++;
            } catch (err) {
              failureCount++;
              console.error(`[Re-Index] Failed to re-vectorize database chunk ${chunk.id}:`, err);
            }
          }
        }
        fileProcessed++;
      }
    }

    // Re-index manual snippets
    const manualChunks = db.prepare(
      "SELECT * FROM knowledge_chunks WHERE id LIKE 'manual_%'"
    ).all();

    let manualProcessed = 0;
    const totalManual = manualChunks.length;

    for (const chunk of manualChunks) {
      try {
        const newVector = await generateEmbeddingVector(chunk.text, false);
        db.prepare('UPDATE knowledge_chunks SET vector = ? WHERE id = ?').run(
          JSON.stringify(newVector), chunk.id
        );
        successCount++;
      } catch (e) {
        failureCount++;
        console.error(`[Re-Index] Failed to re-vectorize manual chunk ${chunk.id}:`, e);
      }
      manualProcessed++;
      sendProgress({
        status: 'running',
        phase: 'manual',
        current: manualProcessed,
        total: totalManual,
        message: `Re-indexing manual snippets (${manualProcessed}/${totalManual})...`
      });
    }

    if (failureCount === 0) {
      db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)").run(
        'rag_model_metadata',
        JSON.stringify({ model: RAG_MODEL_ID, dimension: RAG_MODEL_DIM })
      );
      sendProgress({ status: 'completed', message: 'Knowledge Base upgrade complete!' });
      console.log(`[Re-Index] Completed successfully. ${successCount} chunks re-indexed.`);
    } else {
      // Do NOT stamp — leaves the old stamp so the next launch retries.
      sendProgress({
        status: 'error',
        message: `Re-indexing incomplete: ${failureCount} chunk(s) failed. Will retry on next launch.`
      });
      console.error(`[Re-Index] ${failureCount} failures, ${successCount} successes. Stamp NOT written; will retry.`);
    }

  } catch (error) {
    console.error('[Re-Index] Fatal error during re-indexing:', error);
    const windows = BrowserWindow.getAllWindows();
    if (windows.length > 0 && !windows[0].webContents.isDestroyed()) {
      windows[0].webContents.send('reindex-progress', {
        status: 'error',
        message: `Re-indexing failed: ${error.message}`
      });
    }
  }
}

async function autoDownloadEngineIfNeeded() {
  try {
    const { isLocalEngineInstalled } = require('./rag-service');

    // 1. Check if embeddingEngine is 'local'
    let embeddingEngine = 'local';
    try {
      const rowAdvanced = db.prepare("SELECT value FROM settings WHERE key = 'advanced'").get();
      if (rowAdvanced) {
        const advanced = JSON.parse(rowAdvanced.value);
        embeddingEngine = advanced.embeddingEngine || 'local';
      }
    } catch (e) { }

    if (embeddingEngine !== 'local') {
      console.log('[Auto-Download] Embedding engine is not local. Skipping auto-download.');
      performReindexIfNeeded();
      return;
    }

    // 2. Check if platform is supported
    const platformKey = `${process.platform}-${process.arch}`;
    const asset = ENGINE_ASSETS[platformKey];
    if (!asset) {
      console.log(`[Auto-Download] Unsupported platform: ${platformKey}.`);
      
      // Fallback only if a valid external profile already exists
      try {
        const apiProfiles = db.prepare('SELECT id FROM api_profiles').all();
        const rowAdvanced = db.prepare("SELECT value FROM settings WHERE key = 'advanced'").get();
        const advanced = rowAdvanced ? JSON.parse(rowAdvanced.value) : {};
        
        let hasValidExternalProfile = false;
        if (apiProfiles.length > 0 && advanced.embeddingApiProfileId) {
          hasValidExternalProfile = apiProfiles.some(p => p.id === advanced.embeddingApiProfileId);
        }

        if (hasValidExternalProfile) {
          console.log('[Auto-Download] Valid external profile configured. Switching to external embedding engine...');
          advanced.embeddingEngine = 'external';
          db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)').run('advanced', JSON.stringify(advanced));
          
          // Notify the renderer to refresh settings
          const windows = BrowserWindow.getAllWindows();
          if (windows.length > 0 && !windows[0].webContents.isDestroyed()) {
            windows[0].webContents.send('settings-changed');
          }
        }
      } catch (e) {
        console.error('[Auto-Download] Failed to fall back to external engine settings:', e);
      }
      return;
    }

    // 3. Check if engine is installed
    if (isLocalEngineInstalled()) {
      console.log('[Auto-Download] Local AI Engine is already installed.');
      performReindexIfNeeded();
      return;
    }

    // 4. Run download in the background
    console.log('[Auto-Download] Local AI Engine is absent. Starting background auto-download...');
    const windows = BrowserWindow.getAllWindows();
    const sender = windows.length > 0 ? windows[0].webContents : null;

    if (!sender) {
      console.log('[Auto-Download] No window sender found. Aborting background download.');
      return;
    }

    executeEngineDownload(sender, true).catch(err => {
      console.error('[Auto-Download] Background engine download failed:', err);
    });

  } catch (error) {
    console.error('[Auto-Download] Error checking auto-download on startup:', error);
  }
}

app.whenReady().then(() => {
  // One-time orphan + FTS cleanup (v1)
  try {
    const done = db.prepare("SELECT value FROM settings WHERE key = 'orphan_cleanup_v1'").get();
    if (!done) {
      // SAFETY GUARD: only proceed if the owner tables are intact.
      // If both owner tables are empty but chunks exist, the DB is in a degenerate/half-loaded
      // state — abort rather than mass-delete everything.
      const profCount = db.prepare('SELECT COUNT(*) c FROM writing_profiles').get().c;
      const chatCount = db.prepare('SELECT COUNT(*) c FROM chats').get().c;
      const chunkCount = db.prepare('SELECT COUNT(*) c FROM knowledge_chunks').get().c;

      if (chunkCount === 0 || profCount > 0 || chatCount > 0) {
        // profile_kb chunks whose owner no longer exists in writing_profiles
        const profOrphans = db.prepare(
          "DELETE FROM knowledge_chunks WHERE ownerType = 'profile_kb' AND ownerId NOT IN (SELECT id FROM writing_profiles)"
        ).run().changes;

        // chat_kb / chat_memory chunks whose owner no longer exists in chats
        const chatOrphans = db.prepare(
          "DELETE FROM knowledge_chunks WHERE ownerType IN ('chat_kb','chat_memory') AND ownerId NOT IN (SELECT id FROM chats)"
        ).run().changes;

        // Rebuild FTS from scratch so it exactly mirrors knowledge_chunks (removes dupes + orphans)
        db.prepare('DELETE FROM knowledge_chunks_fts').run();
        db.prepare('INSERT INTO knowledge_chunks_fts (chunkId, text) SELECT id, text FROM knowledge_chunks').run();

        db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('orphan_cleanup_v1', ?)")
          .run(JSON.stringify({ profOrphans, chatOrphans, ts: Date.now() }));
        console.log(`[Cleanup] Removed ${profOrphans} profile + ${chatOrphans} chat orphan chunks; FTS rebuilt.`);
      } else {
        console.warn('[Cleanup] Skipped: owner tables look empty while chunks exist (degenerate state).');
      }
    }
  } catch (e) {
    console.error('[Cleanup] Orphan cleanup failed (non-fatal):', e);
  }

  // Small delay to ensure the renderer has loaded and IPC listeners are registered
  setTimeout(() => {
    autoDownloadEngineIfNeeded();
  }, 3000);
});





