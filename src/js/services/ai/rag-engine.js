const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const { ipcRenderer } = require('electron');
const { pipeline } = require('@huggingface/transformers');
const { getSettings } = require('../storage.js');
const { chunkText, calculateSimilarity } = require('../../utils/ragMath.js');

let embeddingPipeline = null;

// --- FILE EXTRACTION ---
async function extractTextFromFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.pdf') return await ipcRenderer.invoke('parse-pdf', filePath);
    if (ext === '.docx') {
        const dataBuffer = fs.readFileSync(filePath);
        const result = await mammoth.extractRawText({ buffer: dataBuffer });
        return result.value; 
    }
    return fs.readFileSync(filePath, 'utf-8');
}

// --- VECTORIZATION ENGINE ---
async function getEmbeddingPipeline() {
    if (!embeddingPipeline) {
        const settings = getSettings();
        let targetDevice = settings.advanced.executionDevice || 'cpu';

        if (targetDevice === 'auto' || targetDevice === 'webgpu' || targetDevice === 'gpu') {
            targetDevice = 'cpu';
        }

        embeddingPipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
            quantized: true,
            device: targetDevice
        });
    }
    return embeddingPipeline;
}

async function vectorizeChunks(chunks, sourceFileName, progressCallback) {
    const pipe = await getEmbeddingPipeline();
    const vectors = [];
    
    for (let i = 0; i < chunks.length; i++) {
        const originalChunk = chunks[i];
        const enrichedText = `Document: ${sourceFileName}\nContent: ${originalChunk}`;
        
        const output = await pipe(enrichedText, { pooling: 'mean', normalize: true });
        
        vectors.push({
            id: `chunk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}_${i}`,
            source: sourceFileName,
            text: enrichedText,
            vector: Array.from(output.data) 
        });

        if (progressCallback) {
            progressCallback(i + 1, chunks.length);
        }
    }
    return vectors;
}

// --- RAG SEARCH (Profiles & Chat Memories) ---
async function searchKnowledgeBase(queryText, profileId, profilesDir) {
    const dbPath = path.join(profilesDir, profileId, 'KnowledgeBase', 'vector_db.json');
    if (!fs.existsSync(dbPath)) return [];

    try {
        const vectorDB = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        if (vectorDB.length === 0) return [];

        let settings;
        try { settings = getSettings(); } catch(e) { settings = {}; }
        const threshold = parseFloat(settings?.advanced?.similarity) || 0.3;
        const k = parseInt(settings?.advanced?.topKKB, 10) || 5;

        const pipe = await getEmbeddingPipeline();
        const queryOutput = await pipe(queryText, { pooling: 'mean', normalize: true });
        const queryVector = Array.from(queryOutput.data);

        const results = vectorDB.map(chunk => ({ ...chunk, score: calculateSimilarity(queryVector, chunk.vector) }));
        results.sort((a, b) => b.score - a.score);
        
        console.log(`\n[KB SEARCH] Query: "${queryText.substring(0, 40)}..."`);
        console.log(`Target Threshold: ${threshold} | Top-K: ${k}`);
        console.log(`Top 3 Matches Scores:`, results.slice(0, 3).map(r => r.score.toFixed(4)));

        return results.filter(res => res.score >= threshold).slice(0, k);
    } catch (error) {
        console.error("Error searching KB:", error);
        return [];
    }
}

async function searchChatKnowledgeBase(queryText, chatId, chatsDir) {
    const dbPath = path.join(chatsDir, chatId, 'KnowledgeBase', 'vector_db.json');
    if (!fs.existsSync(dbPath)) return [];

    try {
        const vectorDB = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        if (vectorDB.length === 0) return [];

        let settings;
        try { settings = getSettings(); } catch(e) { settings = {}; }
        const threshold = parseFloat(settings?.advanced?.similarity) || 0.3;
        const k = parseInt(settings?.advanced?.topKKB, 10) || 5;

        const pipe = await getEmbeddingPipeline();
        const queryOutput = await pipe(queryText, { pooling: 'mean', normalize: true });
        const queryVector = Array.from(queryOutput.data);

        const results = vectorDB.map(chunk => ({ ...chunk, score: calculateSimilarity(queryVector, chunk.vector) }));
        results.sort((a, b) => b.score - a.score);
        
        console.log(`\n[WORKSPACE KB SEARCH] Query: "${queryText.substring(0, 40)}..."`);
        console.log(`Target Threshold: ${threshold} | Top-K: ${k}`);

        return results.filter(res => res.score >= threshold).slice(0, k);
    } catch (error) {
        console.error("Error searching Workspace KB:", error);
        return [];
    }
}

async function searchChatMemories(queryText, chatId, chatsDir) {
    const dbPath = path.join(chatsDir, chatId, 'Memory', 'vector_db.json');
    if (!fs.existsSync(dbPath)) return [];

    try {
        const vectorDB = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
        if (vectorDB.length === 0) return [];

        let settings;
        try { settings = getSettings(); } catch(e) { settings = {}; }
        const threshold = parseFloat(settings?.advanced?.similarity) || 0.3;
        const k = parseInt(settings?.advanced?.topKMemory, 10) || 5;

        const pipe = await getEmbeddingPipeline();
        const queryOutput = await pipe(queryText, { pooling: 'mean', normalize: true });
        const queryVector = Array.from(queryOutput.data);

        const results = vectorDB.map(mem => ({ ...mem, score: calculateSimilarity(queryVector, mem.vector) }));
        results.sort((a, b) => b.score - a.score);
        
        console.log(`\n[MEMORY SEARCH] Query: "${queryText.substring(0, 40)}..."`);
        console.log(`Target Threshold: ${threshold} | Top-K: ${k}`);

        return results.filter(res => res.score >= threshold).slice(0, k);
    } catch (error) {
        console.error("Error searching Chat Memories:", error);
        return [];
    }
}

// --- CHAT MEMORY ARCHIVER ---
async function saveChatMemory(title, summary, chatId, chatsDir) {
    const pipe = await getEmbeddingPipeline();
    const enrichedText = `Memory Context [${title}]: ${summary}`;
    const output = await pipe(enrichedText, { pooling: 'mean', normalize: true });
    
    const memoryRecord = {
        id: `mem_${Date.now()}`,
        title: title,
        text: summary,
        vector: Array.from(output.data),
        createdAt: Date.now()
    };

    const memoryDir = path.join(chatsDir, chatId, 'Memory');
    if (!fs.existsSync(memoryDir)) fs.mkdirSync(memoryDir, { recursive: true });
    
    const dbPath = path.join(memoryDir, 'vector_db.json');
    let vectorDB = [];
    if (fs.existsSync(dbPath)) vectorDB = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    
    vectorDB.push(memoryRecord);
    fs.writeFileSync(dbPath, JSON.stringify(vectorDB, null, 2));
    
    return memoryRecord;
}

// --- CONTEXT LIMITER ---
function trimContextWindow(enrichedSystemPrompt, text, currentChat, maxTokensAllowed = 4096) {
    const estimateTokens = (str) => Math.ceil((str || '').length / 4);
    let tokensUsed = estimateTokens(enrichedSystemPrompt) + estimateTokens(text);
    let trimmedHistory = [];
    
    if (!currentChat || !currentChat.messages) return trimmedHistory;

    // A MÁGICA ESTÁ AQUI: Ignoramos as mensagens anteriores ao index de sumarização!
    const startIndex = currentChat.summarizedIndex || 0;
    const activeMessages = currentChat.messages.slice(startIndex, -1);
    
    for (let i = activeMessages.length - 1; i >= 0; i--) {
        const msg = activeMessages[i];
        const msgTokens = estimateTokens(msg.content);
        
        if (tokensUsed + msgTokens <= maxTokensAllowed) {
            trimmedHistory.unshift(msg);
            tokensUsed += msgTokens;
        } else {
            console.log(`[Context] Memory trimmed. Excluded older active messages.`);
            break;
        }
    }
    return trimmedHistory;
}

module.exports = {
    extractTextFromFile,
    vectorizeChunks,
    searchKnowledgeBase,
    searchChatKnowledgeBase,
    searchChatMemories,
    saveChatMemory,
    trimContextWindow
};