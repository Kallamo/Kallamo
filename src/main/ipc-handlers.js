const { ipcMain, shell, dialog, BrowserWindow } = require('electron');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const os = require('os');
const db = require('./database');
const { chunkText, extractTextFromFile, vectorizeChunks, insertChunksToDb, deleteChunksFromDb, searchKnowledgeBase, searchChatKnowledgeBase, searchChatMemories } = require('./rag-service');

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
  const vectorDbPath = path.join(kbDir, 'vector_db.json');

  let vectorDB = [];
  if (fs.existsSync(vectorDbPath)) {
    try {
      vectorDB = JSON.parse(fs.readFileSync(vectorDbPath, 'utf8'));
    } catch (e) {
      console.error("Error reading vector_db.json:", e);
    }
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
      vectorDB = vectorDB.filter(c => c.source !== src);
      modified = true;
    }
  }

  for (const src of existingChunksSources) {
    const allKnownFiles = new Set(knowledgeFiles.map(f => f.name));
    if (!allKnownFiles.has(src)) {
      console.log(`[RAG Indexer] Garbage collecting deleted profile file chunks: ${src}`);
      deleteChunksFromDb(profileId, 'profile_kb', src);
      vectorDB = vectorDB.filter(c => c.source !== src);
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
    vectorDB = vectorDB.filter(c => c.source !== file.name);

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

      vectorDB.push(...vectors);

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
    fs.writeFileSync(vectorDbPath, JSON.stringify(vectorDB, null, 2));
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
          syncToCloud = ?
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
        profile.syncToCloud ?? 0,
        profile.id
      );
    } else {
      const insert = db.prepare(`
        INSERT INTO writing_profiles (
          id, name, description, color, apiProfileId, model, temperature, maxTokens,
          systemPrompt, knowledgeFiles, manualMode, manualJson, isAgentic, agenticPrompt, syncToCloud
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
    }

    event.sender.send('import-progress', { progress: 95, status: 'Saving profile to database...' });

    const insert = db.prepare(`
      INSERT INTO writing_profiles (
        id, name, description, color, apiProfileId, model, temperature, maxTokens,
        systemPrompt, knowledgeFiles, manualMode, manualJson, isAgentic, agenticPrompt, syncToCloud
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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

    const fullContextPath = path.join(profilesDir, profileId, 'KnowledgeBase', 'full_context.json');
    if (fs.existsSync(fullContextPath)) {
      try {
        let constantData = JSON.parse(fs.readFileSync(fullContextPath, 'utf8'));
        constantData = constantData.filter(c => c.name !== fileName);
        fs.writeFileSync(fullContextPath, JSON.stringify(constantData, null, 2));
      } catch (e) {
        console.error("Error cleaning up profile full_context.json cache:", e);
      }
    }

    return { success: true };
  } catch (e) {
    console.error("Error deleting knowledge file:", e);
    throw e;
  }
});

ipcMain.handle('get-profile-kb-blocks', async (event, { profileId }) => {
  try {
    const loadedKbData = [];

    const chunks = db.prepare('SELECT id, source, text, vector, createdAt FROM knowledge_chunks WHERE ownerId = ? AND ownerType = ?').all(profileId, 'profile_kb');
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
        rawItem: {
          id: v.id,
          source: v.source,
          text: v.text,
          vector: JSON.parse(v.vector || '[]'),
          createdAt: v.createdAt,
          keywords: keywords
        }
      });
    });

    const profileRow = db.prepare('SELECT knowledgeFiles FROM writing_profiles WHERE id = ?').get(profileId);
    if (profileRow && profileRow.knowledgeFiles) {
      try {
        const files = JSON.parse(profileRow.knowledgeFiles);
        const kbDir = path.join(profilesDir, profileId, 'KnowledgeBase');
        const fullContextPath = path.join(kbDir, 'full_context.json');

        let constantData = [];
        if (fs.existsSync(fullContextPath)) {
          try {
            constantData = JSON.parse(fs.readFileSync(fullContextPath, 'utf8'));
          } catch (err) {
            console.error("Error reading full_context.json:", err);
          }
        }

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

            if (file.internalPath && !fs.existsSync(file.internalPath)) {
              const migratedPath = file.internalPath.replace(/\\AI Profiles\\|\\ChatHistory\\/, (match) => {
                return match === '\\AI Profiles\\' ? '\\AI Profiles_migrated\\' : '\\ChatHistory_migrated\\';
              });
              if (fs.existsSync(migratedPath)) {
                try {
                  const fileDir = path.dirname(file.internalPath);
                  if (!fs.existsSync(fileDir)) {
                    fs.mkdirSync(fileDir, { recursive: true });
                  }
                  fs.copyFileSync(migratedPath, file.internalPath);
                  console.log(`[Self-Healing Profile] Recovered file: ${migratedPath} -> ${file.internalPath}`);
                } catch (copyErr) {
                  console.error(`[Self-Healing Profile] Failed to copy migrated file:`, copyErr);
                }
              }
            }

            let content = '';
            const found = constantData.find(c => c.name === file.name);
            if (found) {
              content = found.content;
            }

            if (!content && file.internalPath && fs.existsSync(file.internalPath)) {
              try {
                const ext = path.extname(file.name).toLowerCase();
                if (ext === '.txt' || ext === '.md' || ext === '.json' || ext === '.csv') {
                  content = fs.readFileSync(file.internalPath, 'utf8');
                } else {
                  content = await extractTextFromFile(file.internalPath);
                }

                if (content && content.trim()) {
                  if (!constantData.some(c => c.name === file.name)) {
                    constantData.push({ name: file.name, content: content.trim() });
                    fs.writeFileSync(fullContextPath, JSON.stringify(constantData, null, 2));
                  }
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
              rawItem: file
            });
          }
        }

        const manualConstants = constantData.filter(c => c.type === 'manual');
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
            source: mc.name || mc.source || 'Custom Memory',
            text: mc.content || mc.text || '',
            strategy: 'constant',
            keywords: mc.keywords || [],
            rawItem: {
              id: mc.id,
              source: mc.name || mc.source || 'Custom Memory',
              text: mc.content || mc.text || '',
              strategy: 'constant',
              keywords: mc.keywords || []
            }
          });
        }
      } catch (e) {
        console.error("Error parsing profile knowledgeFiles:", e);
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

    const vectorDbPath = path.join(kbDir, 'vector_db.json');
    const fullContextPath = path.join(kbDir, 'full_context.json');

    const isConstantSnippet = (b) => b.type === 'manual' && (b.strategy === 'constant' || b.rawItem?.strategy === 'constant');

    const vectorData = blocks.filter(item => item.type === 'rag' || (item.type === 'manual' && !isConstantSnippet(item))).map(item => item.rawItem);

    const constantData = [];
    blocks.filter(item => item.type === 'constant').forEach(item => {
      constantData.push(item.rawItem);
    });
    blocks.filter(item => isConstantSnippet(item)).forEach(b => {
      constantData.push({
        id: b.id,
        type: 'manual',
        name: b.source,
        content: b.text,
        strategy: 'constant',
        keywords: b.keywords
      });
    });

    if (vectorData.length > 0) {
      fs.writeFileSync(vectorDbPath, JSON.stringify(vectorData, null, 2));
    } else if (fs.existsSync(vectorDbPath)) {
      fs.unlinkSync(vectorDbPath);
    }

    if (constantData.length > 0) {
      fs.writeFileSync(fullContextPath, JSON.stringify(constantData, null, 2));
    } else if (fs.existsSync(fullContextPath)) {
      fs.unlinkSync(fullContextPath);
    }

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
        INSERT OR REPLACE INTO knowledge_chunks (id, ownerId, ownerType, source, text, vector, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
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
            insertChunk.run(
              b.id,
              profileId,
              'profile_kb',
              b.source,
              textToStore,
              JSON.stringify(chunk.vector),
              chunk.createdAt || Date.now()
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

    const fullContextPath = path.join(kbDir, 'full_context.json');
    let constantData = [];
    if (fs.existsSync(fullContextPath)) {
      try {
        constantData = JSON.parse(fs.readFileSync(fullContextPath, 'utf8'));
      } catch (err) { }
    }
    if (!constantData.some(c => c.name === name)) {
      constantData.push(newRawItem);
      fs.writeFileSync(fullContextPath, JSON.stringify(constantData, null, 2));
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

    const vectorDbPath = path.join(kbDir, 'vector_db.json');
    let vectorDB = [];
    if (fs.existsSync(vectorDbPath)) {
      try {
        vectorDB = JSON.parse(fs.readFileSync(vectorDbPath, 'utf8'));
      } catch (err) { }
    }
    vectorDB.push(...fileVectors);
    fs.writeFileSync(vectorDbPath, JSON.stringify(vectorDB, null, 2));

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

    const newKbStr = typeof chat.knowledgeFiles === 'string' ? chat.knowledgeFiles : JSON.stringify(chat.knowledgeFiles || []);
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

    if (kbChanged && chat.knowledgeFiles) {
      indexChatKnowledgeBase(event.sender, chat.id, chat.knowledgeFiles).catch(e => {
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
          systemPrompt, knowledgeFiles, manualMode, manualJson, isAgentic, agenticPrompt, syncToCloud
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      const dbFile = path.join(dataDir, 'kallamo.db');
      if (fs.existsSync(dbFile)) {
        fs.copyFileSync(dbFile, filePath);
        return { success: true, filePath };
      } else {
        throw new Error("Source database file not found.");
      }
    }
    return { cancelled: true };
  } catch (err) {
    console.error("Backup failed:", err);
    throw err;
  }
});

ipcMain.handle('purge-vectors', async (event) => {
  try {
    db.prepare('DELETE FROM knowledge_chunks').run();
    db.prepare('DELETE FROM knowledge_chunks_fts').run();

    if (fs.existsSync(profilesDir)) {
      const folders = fs.readdirSync(profilesDir);
      for (const folder of folders) {
        const vDb = path.join(profilesDir, folder, 'KnowledgeBase', 'vector_db.json');
        if (fs.existsSync(vDb)) {
          fs.unlinkSync(vDb);
        }
      }
    }
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

    const memoryDir = path.join(chatsDir, chatId, 'Memory');
    if (!fs.existsSync(memoryDir)) {
      fs.mkdirSync(memoryDir, { recursive: true });
    }
    const dbPath = path.join(memoryDir, 'vector_db.json');
    let vectorDB = [];
    if (fs.existsSync(dbPath)) {
      try {
        vectorDB = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
      } catch (e) { }
    }
    if (chunk) {
      chunk.id = snippetId;
      chunk.blockId = snippetId;
      vectorDB = vectorDB.filter(c => c.blockId !== snippetId);
      vectorDB.push(chunk);
      fs.writeFileSync(dbPath, JSON.stringify(vectorDB, null, 2));
    }
    return { success: true };
  } catch (e) {
    console.error("Error saving manual chat snippet vector:", e);
    throw e;
  }
});

ipcMain.handle('delete-chat-manual-snippet', async (event, { chatId, snippetId }) => {
  try {
    const dbPaths = [
      path.join(chatsDir, chatId, 'Memory', 'vector_db.json'),
      path.join(chatsDir, chatId, 'Memory', 'vector_db.json.bak')
    ];
    let chunkIdsToDelete = [snippetId];

    for (const dbPath of dbPaths) {
      if (fs.existsSync(dbPath)) {
        try {
          let vectorDB = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
          const targetChunks = vectorDB.filter(chunk => chunk.blockId === snippetId || chunk.id === snippetId);
          targetChunks.forEach(c => {
            if (c.id) chunkIdsToDelete.push(c.id);
          });

          const originalLength = vectorDB.length;
          const filteredDB = vectorDB.filter(chunk => chunk.blockId !== snippetId && chunk.id !== snippetId);
          if (filteredDB.length !== originalLength) {
            fs.writeFileSync(dbPath, JSON.stringify(filteredDB, null, 2));
            console.log(`[Chat Memory Clean] Deleted snippet ${snippetId} vectors from JSON`);
          }
        } catch (err) {
          console.error("Error cleaning vector DB on snippet delete:", err);
        }
      }
    }

    db.transaction(() => {
      const deleteChunk = db.prepare('DELETE FROM knowledge_chunks WHERE ownerId = ? AND id = ?');
      const deleteFts = db.prepare('DELETE FROM knowledge_chunks_fts WHERE chunkId = ?');
      for (const id of chunkIdsToDelete) {
        deleteChunk.run(chatId, id);
        deleteFts.run(id);
      }
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

    const ragChunks = db.prepare('SELECT id, source, text FROM knowledge_chunks WHERE ownerId = ? AND ownerType = ?').all(chatId, 'chat_kb');
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

            const dbPath = path.join(chatsDir, chatId, 'Memory', 'vector_db.json');
            if (fs.existsSync(dbPath)) {
              try {
                let vectorDB = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
                const originalLength = vectorDB.length;
                vectorDB = vectorDB.filter(chunk => chunk.blockId !== v.id);
                if (vectorDB.length !== originalLength) {
                  fs.writeFileSync(dbPath, JSON.stringify(vectorDB, null, 2));
                }
              } catch (err) { }
            }
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

            if (file.internalPath && !fs.existsSync(file.internalPath)) {
              const migratedPath = file.internalPath.replace(/\\AI Profiles\\|\\ChatHistory\\/, (match) => {
                return match === '\\AI Profiles\\' ? '\\AI Profiles_migrated\\' : '\\ChatHistory_migrated\\';
              });
              if (fs.existsSync(migratedPath)) {
                try {
                  const fileDir = path.dirname(file.internalPath);
                  if (!fs.existsSync(fileDir)) {
                    fs.mkdirSync(fileDir, { recursive: true });
                  }
                  fs.copyFileSync(migratedPath, file.internalPath);
                  console.log(`[Self-Healing Chat] Recovered file: ${migratedPath} -> ${file.internalPath}`);
                } catch (copyErr) {
                  console.error(`[Self-Healing Chat] Failed to copy migrated file:`, copyErr);
                }
              }
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
              rawItem: file
            });
          }
        }
      } catch (e) {
        console.error("Error parsing chat knowledgeFiles:", e);
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

      if (block.strategy === 'constant') {
        db.transaction(() => {
          db.prepare('DELETE FROM knowledge_chunks WHERE ownerId = ? AND id = ?').run(chatId, snippetId);
          db.prepare('DELETE FROM knowledge_chunks_fts WHERE chunkId = ?').run(snippetId);
        })();

        const memoryDir = path.join(chatsDir, chatId, 'Memory');
        const dbPath = path.join(memoryDir, 'vector_db.json');
        if (fs.existsSync(dbPath)) {
          try {
            let vectorDB = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
            const originalLen = vectorDB.length;
            vectorDB = vectorDB.filter(c => c.blockId !== snippetId);
            if (vectorDB.length !== originalLen) {
              fs.writeFileSync(dbPath, JSON.stringify(vectorDB, null, 2));
            }
          } catch (e) { }
        }
      } else {
        const vectorData = await vectorizeChunks([block.text], block.source || 'Custom Memory', null, cleanKeywords);
        const chunk = vectorData[0] || null;
        if (chunk) {
          chunk.id = snippetId;
          chunk.blockId = snippetId;
          chunk.keywords = cleanKeywords;

          const memoryDir = path.join(chatsDir, chatId, 'Memory');
          if (!fs.existsSync(memoryDir)) {
            fs.mkdirSync(memoryDir, { recursive: true });
          }
          const dbPath = path.join(memoryDir, 'vector_db.json');
          let vectorDB = [];
          if (fs.existsSync(dbPath)) {
            try {
              vectorDB = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
            } catch (e) { }
          }

          vectorDB = vectorDB.filter(c => c.blockId !== snippetId);
          vectorDB.push(chunk);
          fs.writeFileSync(dbPath, JSON.stringify(vectorDB, null, 2));

          const insertChunk = db.prepare(`
            INSERT OR REPLACE INTO knowledge_chunks (id, ownerId, ownerType, source, text, vector, createdAt)
            VALUES (?, ?, ?, ?, ?, ?, ?)
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
              Date.now()
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
        keywords: cleanKeywords
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
        db.prepare('UPDATE knowledge_chunks SET text = ?, vector = ? WHERE id = ?').run(
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
      const dbPaths = [
        path.join(chatsDir, chatId, 'Memory', 'vector_db.json'),
        path.join(chatsDir, chatId, 'Memory', 'vector_db.json.bak')
      ];
      let chunkIdsToDelete = [block.id];

      for (const dbPath of dbPaths) {
        if (fs.existsSync(dbPath)) {
          try {
            let vectorDB = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
            const targetChunks = vectorDB.filter(chunk => chunk.blockId === block.id || chunk.id === block.id);
            targetChunks.forEach(c => {
              if (c.id) chunkIdsToDelete.push(c.id);
            });

            const filteredDB = vectorDB.filter(chunk => chunk.blockId !== block.id && chunk.id !== block.id);
            fs.writeFileSync(dbPath, JSON.stringify(filteredDB, null, 2));
          } catch (err) {
            console.error("Error cleaning chat vector DB on block delete:", err);
          }
        }
      }

      const chatRow = db.prepare('SELECT memoryBlocks FROM chats WHERE id = ?').get(chatId);
      if (chatRow && chatRow.memoryBlocks) {
        let memoryBlocks = JSON.parse(chatRow.memoryBlocks);
        memoryBlocks = memoryBlocks.filter(b => b.id !== block.id);
        db.prepare('UPDATE chats SET memoryBlocks = ? WHERE id = ?').run(JSON.stringify(memoryBlocks), chatId);
      }

      db.transaction(() => {
        const deleteChunk = db.prepare('DELETE FROM knowledge_chunks WHERE ownerId = ? AND id = ?');
        const deleteFts = db.prepare('DELETE FROM knowledge_chunks_fts WHERE chunkId = ?');
        for (const id of chunkIdsToDelete) {
          deleteChunk.run(chatId, id);
          deleteFts.run(id);
        }
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




