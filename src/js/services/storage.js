const fs = require('fs');
const path = require('path');
const os = require('os');

// --- DIRECTORY SETUP ---
const appDataPath = process.env.APPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), '.local', 'share'));
const dataDir = path.join(appDataPath, 'AI Writer Companion');

const apiDir = path.join(dataDir, 'API Connections');
const profilesDir = path.join(dataDir, 'AI Profiles');
const chatsDir = path.join(dataDir, 'ChatHistory');
const workflowsDir = path.join(dataDir, 'Workflows');

[dataDir, apiDir, profilesDir, chatsDir, workflowsDir].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

// --- FILE HELPERS ---
function getSafeFilename(name, id) {
    let safeName = (name || 'Untitled').replace(/[<>:"/\\|?*\x00-\x1F]/g, '').trim();
    if (safeName.length > 50) safeName = safeName.substring(0, 50).trim();
    return `${safeName}_${id}.json`;
}

function loadFilesFromDir(dir) {
    const arr = [];
    if (fs.existsSync(dir)) {
        fs.readdirSync(dir).forEach(file => {
            if (file.endsWith('.json')) {
                try { arr.push(JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'))); } 
                catch (e) { console.error(`Error loading ${file}`, e); }
            }
        });
    }
    return arr;
}

function saveSingleFile(dir, item) {
    try { 
        const files = fs.readdirSync(dir);
        const oldFile = files.find(f => f.endsWith(`_${item.id}.json`) || f === `${item.id}.json`);
        if (oldFile) fs.unlinkSync(path.join(dir, oldFile));

        const fileName = getSafeFilename(item.name || item.title, item.id);
        fs.writeFileSync(path.join(dir, fileName), JSON.stringify(item, null, 2)); 
    }
    catch (e) { console.error(`Error saving to ${dir}:`, e); }
}

function deleteSingleFile(dir, id) {
    try {
        const files = fs.readdirSync(dir);
        const targetFile = files.find(f => f.endsWith(`_${id}.json`) || f === `${id}.json`);
        if (targetFile) fs.unlinkSync(path.join(dir, targetFile));
    } catch (e) { console.error(`Error deleting from ${dir}:`, e); }
}

// --- CHAT DATA ---
function loadChatsData() {
    const arr = [];
    if (!fs.existsSync(chatsDir)) return arr;
    fs.readdirSync(chatsDir).forEach(folderName => {
        const chatFolderPath = path.join(chatsDir, folderName);
        try {
            if (fs.statSync(chatFolderPath).isDirectory()) {
                const chatJsonPath = path.join(chatFolderPath, `${folderName}.json`);
                if (fs.existsSync(chatJsonPath)) {
                    arr.push(JSON.parse(fs.readFileSync(chatJsonPath, 'utf8')));
                }
            }
        } catch (e) {
            console.error(`Error loading chat folder ${folderName}:`, e);
        }
    });
    return arr;
}

function saveChatData(chat) {
    try {
        const chatFolderPath = path.join(chatsDir, chat.id);
        const filesFolderPath = path.join(chatFolderPath, 'Files');
        
        if (!fs.existsSync(chatFolderPath)) fs.mkdirSync(chatFolderPath, { recursive: true });
        if (!fs.existsSync(filesFolderPath)) fs.mkdirSync(filesFolderPath, { recursive: true });
        
        fs.writeFileSync(path.join(chatFolderPath, `${chat.id}.json`), JSON.stringify(chat, null, 2));
    } catch (e) { console.error('Error saving chat data:', e); }
}

function deleteChatFolder(chatId) {
    try {
        const folder = path.join(chatsDir, chatId);
        if (fs.existsSync(folder)) fs.rmSync(folder, { recursive: true, force: true });
    } catch (e) { console.error('Error deleting chat folder:', e); }
}

// --- PROFILE DATA ---
function loadProfilesData() {
    const arr = [];
    if (!fs.existsSync(profilesDir)) return arr;
    
    fs.readdirSync(profilesDir).forEach(item => {
        const profileFolderPath = path.join(profilesDir, item);
        
        if (fs.statSync(profileFolderPath).isDirectory()) {
            const files = fs.readdirSync(profileFolderPath);
            const jsonFile = files.find(f => f.endsWith('.json'));
            if (jsonFile) {
                try { arr.push(JSON.parse(fs.readFileSync(path.join(profileFolderPath, jsonFile), 'utf8'))); } 
                catch (e) { console.error(`Error loading profile folder ${item}:`, e); }
            }
        } 
        else if (item.endsWith('.json')) {
            try { arr.push(JSON.parse(fs.readFileSync(profileFolderPath, 'utf8'))); } 
            catch (e) {}
        }
    });
    return arr;
}

function saveProfileData(profile) {
    try {
        const profileFolderPath = path.join(profilesDir, profile.id);
        const kbFolderPath = path.join(profileFolderPath, 'KnowledgeBase');
        
        if (!fs.existsSync(profileFolderPath)) fs.mkdirSync(profileFolderPath, { recursive: true });
        if (!fs.existsSync(kbFolderPath)) fs.mkdirSync(kbFolderPath, { recursive: true });
        
        const fileName = getSafeFilename(profile.name, profile.id);
        
        const files = fs.readdirSync(profileFolderPath);
        const oldFile = files.find(f => f.endsWith('.json') && f !== fileName);
        if (oldFile) fs.unlinkSync(path.join(profileFolderPath, oldFile));

        fs.writeFileSync(path.join(profileFolderPath, fileName), JSON.stringify(profile, null, 2));
    } catch (e) { console.error('Error saving profile data:', e); }
}

function deleteProfileFolder(profileId) {
    try {
        const folder = path.join(profilesDir, profileId);
        if (fs.existsSync(folder)) fs.rmSync(folder, { recursive: true, force: true });
    } catch (e) { console.error('Error deleting profile folder:', e); }
}

// --- KNOWLEDGE BASE DATA ---
async function persistKnowledgeFiles(profileId, filesArray) {
    const profileKbDir = path.join(profilesDir, profileId, 'KnowledgeBase');
    if (!fs.existsSync(profileKbDir)) {
        fs.mkdirSync(profileKbDir, { recursive: true });
    }

    if (!filesArray || filesArray.length === 0) return [];

    const safelySavedFiles = [];

    for (const file of filesArray) {
        try {
            const destPath = path.join(profileKbDir, file.name);
            
            if (file.path && fs.existsSync(file.path)) {
                fs.copyFileSync(file.path, destPath);
            } 
            else if (file.fileObj) {
                const arrayBuffer = await file.fileObj.arrayBuffer();
                fs.writeFileSync(destPath, Buffer.from(arrayBuffer));
            }

            safelySavedFiles.push({
                name: file.name,
                originalPath: file.path || '',
                internalPath: destPath, 
                size: file.size
            });
        } catch (error) {
            console.error(`Error saving file ${file.name}:`, error);
        }
    }

    return safelySavedFiles;
}

const settingsFile = path.join(dataDir, 'settings.json');

function loadSettings() {
    const defaultSettings = {
        interface: { fontFamily: 'sans', fontSize: 'medium', layout: 'bubbles', blur: true, accentColor: '#DDBA6E', codeTheme: 'github-dark', lineNumbers: false },
        advanced: { chunkSize: 500, similarity: 0.3, topKKB: 5, topKMemory: 5, executionDevice: 'cpu', ragDebug: false }
    };
    if (!fs.existsSync(settingsFile)) {
        fs.writeFileSync(settingsFile, JSON.stringify(defaultSettings, null, 2));
        return defaultSettings;
    }
    try {
        const data = JSON.parse(fs.readFileSync(settingsFile, 'utf8'));
        return { interface: { ...defaultSettings.interface, ...(data.interface || {}) }, advanced: { ...defaultSettings.advanced, ...(data.advanced || {}) } };
    } catch (e) {
        console.error("Error reading settings.json", e);
        return defaultSettings;
    }
}

function saveSettings(settingsObj) {
    try {
        fs.writeFileSync(settingsFile, JSON.stringify(settingsObj, null, 2));
    } catch (e) {
        console.error("Error saving settings.json", e);
    }
}


function getSettings() {
    return loadSettings();
}

module.exports = {
    dataDir, apiDir, profilesDir, chatsDir, workflowsDir,
    loadFilesFromDir, saveSingleFile, deleteSingleFile,
    loadChatsData, saveChatData, deleteChatFolder,
    loadProfilesData, saveProfileData, deleteProfileFolder,
    persistKnowledgeFiles,
    loadSettings, saveSettings, getSettings
};