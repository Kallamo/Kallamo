const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const os = require('os');
const { pipeline } = require('@huggingface/transformers');
const db = require('./database');

const appDataPath = process.env.APPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), '.local', 'share'));
const dataDir = path.join(appDataPath, 'Kallamo');
const profilesDir = path.join(dataDir, 'AI Profiles');
const chatsDir = path.join(dataDir, 'ChatHistory');

let embeddingPipeline = null;

// --- CORE RAG UTILITIES ---

function chunkText(text, maxChunkSize = 1000) {
    if (!text || text.trim().length === 0) return [];
    
    const chunks = [];
    const paragraphs = text.split(/\n\s*\n/);
    let currentChunk = "";

    for (const para of paragraphs) {
        const cleanPara = para.trim();
        if (cleanPara.length === 0) continue;

        if (currentChunk.length + cleanPara.length > maxChunkSize && currentChunk.length > 0) {
            if (currentChunk.length > 50) {
                chunks.push(currentChunk.trim());
            }
            currentChunk = "";
        }

        currentChunk += (currentChunk.length > 0 ? "\n\n" : "") + cleanPara;
    }

    if (currentChunk.trim().length > 50) {
        chunks.push(currentChunk.trim());
    } else if (currentChunk.trim().length > 0 && chunks.length > 0) {
        chunks[chunks.length - 1] += "\n\n" + currentChunk.trim();
    }

    return chunks;
}

function calculateSimilarity(vecA, vecB) {
    let dotProduct = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
    }
    return dotProduct;
}

// --- FILE EXTRACTION ---

async function extractTextFromFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    
    // Skip binary media and archive formats to prevent garbage character generation
    const mediaExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.webm', '.mov', '.mp3', '.wav', '.ogg', '.flac', '.zip', '.tar', '.gz', '.klp', '.klkb', '.db'];
    if (mediaExtensions.includes(ext)) {
        return '';
    }

    // For PDFs, we can extract using unpdf library directly
    if (ext === '.pdf') {
        const { extractText } = require('unpdf');
        const nodeBuffer = fs.readFileSync(filePath);
        const uint8Array = new Uint8Array(nodeBuffer);
        let { text } = await extractText(uint8Array);
        if (Array.isArray(text)) {
            text = text.join('\n\n');
        } else if (typeof text !== 'string') {
            text = String(text);
        }
        return text;
    }
    
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
        let executionDevice = 'cpu';
        try {
            const rowAdvanced = db.prepare("SELECT value FROM settings WHERE key = 'advanced'").get();
            if (rowAdvanced) {
                const advanced = JSON.parse(rowAdvanced.value);
                executionDevice = advanced.executionDevice || 'cpu';
            }
        } catch (e) {
            console.error("Error reading settings for executionDevice:", e);
        }

        if (executionDevice === 'auto' || executionDevice === 'webgpu' || executionDevice === 'gpu') {
            executionDevice = 'cpu';
        }

        embeddingPipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2', {
            quantized: true,
            device: executionDevice
        });
    }
    return embeddingPipeline;
}

async function generateEmbeddingVector(text) {
    let embeddingEngine = 'local';
    let apiProfileId = '';
    let modelName = '';
    
    try {
        const rowAdvanced = db.prepare("SELECT value FROM settings WHERE key = 'advanced'").get();
        if (rowAdvanced) {
            const advanced = JSON.parse(rowAdvanced.value);
            embeddingEngine = advanced.embeddingEngine || 'local';
            apiProfileId = advanced.embeddingApiProfileId || '';
            modelName = advanced.embeddingModelName || '';
        }
    } catch (e) {
        console.error("Error reading embedding settings:", e);
    }

    if (embeddingEngine === 'external' && apiProfileId) {
        const { getEmbeddings } = require('./api-engine');
        return await getEmbeddings(text, apiProfileId, modelName);
    } else {
        const pipe = await getEmbeddingPipeline();
        const output = await pipe(text, { pooling: 'mean', normalize: true });
        return Array.from(output.data);
    }
}

async function vectorizeChunks(chunks, sourceFileName, progressCallback, keywords = []) {
    const vectors = [];
    const tagsString = Array.isArray(keywords) && keywords.length > 0 ? `Tags: ${keywords.join(', ')}\n` : '';
    
    for (let i = 0; i < chunks.length; i++) {
        const originalChunk = chunks[i];
        const enrichedText = `Document: ${sourceFileName}\n${tagsString}Content: ${originalChunk}`;
        
        try {
            const vector = await generateEmbeddingVector(enrichedText);
            vectors.push({
                id: `chunk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}_${i}`,
                source: sourceFileName,
                text: enrichedText,
                vector: vector
            });
        } catch (err) {
            console.error(`Failed to generate vector for chunk ${i} of ${sourceFileName}:`, err);
            throw err;
        }

        if (progressCallback) {
            progressCallback(i + 1, chunks.length);
        }
    }
    return vectors;
}

// --- DATABASE OPERATIONS ---

function insertChunksToDb(ownerId, ownerType, vectors) {
    const insertChunk = db.prepare(`
        INSERT OR REPLACE INTO knowledge_chunks (id, ownerId, ownerType, source, text, vector, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertFts = db.prepare(`
        INSERT OR REPLACE INTO knowledge_chunks_fts (chunkId, text)
        VALUES (?, ?)
    `);

    db.transaction(() => {
        for (const v of vectors) {
            insertChunk.run(v.id, ownerId, ownerType, v.source, v.text, JSON.stringify(v.vector), Date.now());
            insertFts.run(v.id, v.text);
        }
    })();
}

function deleteChunksFromDb(ownerId, ownerType, sourceFileName) {
    const chunks = db.prepare('SELECT id FROM knowledge_chunks WHERE ownerId = ? AND ownerType = ? AND source = ?').all(ownerId, ownerType, sourceFileName);
    if (chunks.length === 0) return;

    const chunkIds = chunks.map(c => c.id);

    db.transaction(() => {
        const deleteChunk = db.prepare('DELETE FROM knowledge_chunks WHERE id = ?');
        const deleteFts = db.prepare('DELETE FROM knowledge_chunks_fts WHERE chunkId = ?');
        for (const id of chunkIds) {
            deleteChunk.run(id);
            deleteFts.run(id);
        }
    })();
}

// --- HYBRID SEARCH ENGINE ---

async function executeHybridSearch(queryText, ownerId, ownerType, threshold = 0.3, k = 5) {
    try {
        const candidateRows = db.prepare('SELECT * FROM knowledge_chunks WHERE ownerId = ? AND ownerType = ?').all(ownerId, ownerType);
        if (candidateRows.length === 0) return [];

        const queryVector = await generateEmbeddingVector(queryText);

        const denseResults = candidateRows
            .map(row => {
                let parsedVector = [];
                try {
                    parsedVector = JSON.parse(row.vector);
                } catch (e) {}
                
                return {
                    id: row.id,
                    source: row.source,
                    text: row.text,
                    score: calculateSimilarity(queryVector, parsedVector),
                    createdAt: row.createdAt
                };
            })
            .filter(r => r.score >= threshold)
            .sort((a, b) => b.score - a.score);

        let sparseResults = [];
        const ftsQuery = queryText.replace(/"/g, '""').trim();
        if (ftsQuery.length > 0) {
            try {
                sparseResults = db.prepare(`
                    SELECT chunkId, bm25(knowledge_chunks_fts) as rank
                    FROM knowledge_chunks_fts
                    WHERE knowledge_chunks_fts MATCH ?
                `).all(ftsQuery);
            } catch (e) {
                const simpleQuery = ftsQuery.replace(/[^a-zA-Z0-9\s]/g, ' ').trim();
                if (simpleQuery.length > 0) {
                    try {
                        sparseResults = db.prepare(`
                            SELECT chunkId, bm25(knowledge_chunks_fts) as rank
                            FROM knowledge_chunks_fts
                            WHERE knowledge_chunks_fts MATCH ?
                        `).all(simpleQuery);
                    } catch (err) {}
                }
            }
        }

        sparseResults.sort((a, b) => a.rank - b.rank);

        const denseRankMap = new Map();
        denseResults.forEach((res, index) => {
            denseRankMap.set(res.id, index);
        });

        const sparseRankMap = new Map();
        sparseResults.forEach((res, index) => {
            sparseRankMap.set(res.chunkId, index);
        });

        const allChunkIds = new Set([...denseRankMap.keys(), ...sparseRankMap.keys()]);
        const fusedResults = [];

        for (const chunkId of allChunkIds) {
            const denseIndex = denseRankMap.get(chunkId);
            const sparseIndex = sparseRankMap.get(chunkId);

            const w_dense = denseIndex !== undefined ? (1 / (60 + denseIndex + 1)) : 0;
            const w_sparse = sparseIndex !== undefined ? (1 / (60 + sparseIndex + 1)) : 0;
            const fusionScore = w_dense + w_sparse;

            let chunkData = denseResults.find(r => r.id === chunkId);
            if (!chunkData) {
                const dbRow = candidateRows.find(r => r.id === chunkId);
                if (dbRow) {
                    let parsedVector = [];
                    try {
                        parsedVector = JSON.parse(dbRow.vector);
                    } catch (e) {}
                    const similarityScore = parsedVector && parsedVector.length === queryVector.length
                        ? calculateSimilarity(queryVector, parsedVector)
                        : 0;
                    chunkData = {
                        id: dbRow.id,
                        source: dbRow.source,
                        text: dbRow.text,
                        score: similarityScore,
                        createdAt: dbRow.createdAt
                    };
                }
            }

            if (chunkData) {
                fusedResults.push({
                    ...chunkData,
                    fusionScore
                });
            }
        }

        fusedResults.sort((a, b) => b.fusionScore - a.fusionScore);

        return fusedResults.slice(0, k);

    } catch (error) {
        console.error(`Error in executeHybridSearch for owner ${ownerId}:`, error);
        return [];
    }
}

async function searchKnowledgeBase(queryText, profileId) {
    let threshold = 0.3;
    let k = 5;
    try {
        const rowAdvanced = db.prepare("SELECT value FROM settings WHERE key = 'advanced'").get();
        if (rowAdvanced) {
            const advanced = JSON.parse(rowAdvanced.value);
            threshold = parseFloat(advanced.similarity) || 0.3;
            k = parseInt(advanced.topKKB, 10) || 5;
        }
    } catch (e) {}

    return await executeHybridSearch(queryText, profileId, 'profile_kb', threshold, k);
}

async function searchChatKnowledgeBase(queryText, chatId) {
    let threshold = 0.3;
    let k = 5;
    try {
        const rowAdvanced = db.prepare("SELECT value FROM settings WHERE key = 'advanced'").get();
        if (rowAdvanced) {
            const advanced = JSON.parse(rowAdvanced.value);
            threshold = parseFloat(advanced.similarity) || 0.3;
            k = parseInt(advanced.topKKB, 10) || 5;
        }
    } catch (e) {}

    return await executeHybridSearch(queryText, chatId, 'chat_kb', threshold, k);
}

async function searchChatMemories(queryText, chatId) {
    let threshold = 0.3;
    let k = 5;
    try {
        const rowAdvanced = db.prepare("SELECT value FROM settings WHERE key = 'advanced'").get();
        if (rowAdvanced) {
            const advanced = JSON.parse(rowAdvanced.value);
            threshold = parseFloat(advanced.similarity) || 0.3;
            k = parseInt(advanced.topKMemory, 10) || 5;
        }
    } catch (e) {}

    return await executeHybridSearch(queryText, chatId, 'chat_memory', threshold, k);
}

async function saveChatMemory(title, summary, chatId) {
    const enrichedText = `Memory Context [${title}]: ${summary}`;
    const vector = await generateEmbeddingVector(enrichedText);
    const chunkId = `mem_${Date.now()}`;

    const insertChunk = db.prepare(`
        INSERT OR REPLACE INTO knowledge_chunks (id, ownerId, ownerType, source, text, vector, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    const insertFts = db.prepare(`
        INSERT OR REPLACE INTO knowledge_chunks_fts (chunkId, text)
        VALUES (?, ?)
    `);

    db.transaction(() => {
        insertChunk.run(chunkId, chatId, 'chat_memory', title, summary, JSON.stringify(vector), Date.now());
        insertFts.run(chunkId, summary);
    })();

    return {
        id: chunkId,
        title: title,
        text: summary,
        vector: vector,
        createdAt: Date.now()
    };
}

// --- EXPORTS ---

module.exports = {
    chunkText,
    extractTextFromFile,
    vectorizeChunks,
    insertChunksToDb,
    deleteChunksFromDb,
    searchKnowledgeBase,
    searchChatKnowledgeBase,
    searchChatMemories,
    saveChatMemory
};
