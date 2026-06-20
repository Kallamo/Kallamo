const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const os = require('os');
const db = require('./database');

const appDataPath = process.env.APPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), '.local', 'share'));
const dataDir = path.join(appDataPath, 'Kallamo');
const profilesDir = path.join(dataDir, 'AI Profiles');
const chatsDir = path.join(dataDir, 'ChatHistory');

// Configure Hugging Face Transformers cache directory to be writable
const modelCacheDir = path.join(dataDir, 'ModelCache');
if (!fs.existsSync(modelCacheDir)) {
    fs.mkdirSync(modelCacheDir, { recursive: true });
}

const runtimeDir = path.join(dataDir, 'runtime');

function isLocalEngineInstalled() {
    const onnxDir = path.join(runtimeDir, 'node_modules', 'onnxruntime-node');
    const packageJsonPath = path.join(onnxDir, 'package.json');
    if (!fs.existsSync(packageJsonPath)) return false;

    // Verify the native .node binary actually exists (not just package.json)
    try {
        return findNodeBinary(onnxDir);
    } catch (e) {
        return false;
    }
}

function findNodeBinary(dir) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
        if (entry.isFile() && entry.name.endsWith('.node')) return true;
        if (entry.isDirectory()) {
            if (findNodeBinary(path.join(dir, entry.name))) return true;
        }
    }
    return false;
}

let engineInitialized = false;

function ensureLocalEngine() {
    if (engineInitialized) return;

    if (!isLocalEngineInstalled()) {
        throw new Error('Local AI Engine is not installed. Please download it from Settings or Onboarding.');
    }

    // Resolve module from runtime directory
    const nodeModulesPath = path.join(runtimeDir, 'node_modules');
    process.env.NODE_PATH = nodeModulesPath + path.delimiter + (process.env.NODE_PATH || '');
    require('module').Module._initPaths();

    engineInitialized = true;
}

let embeddingPipeline = null;
let rerankerModel = null;
let rerankerTokenizer = null;

function resetLocalEngine() {
    engineInitialized = false;
    embeddingPipeline = null;
    rerankerModel = null;
    rerankerTokenizer = null;
}

// --- CORE RAG UTILITIES ---

// Current local embedding model identifier (used for version-stamp checks)
const RAG_MODEL_ID = 'Xenova/multilingual-e5-small';
const RAG_MODEL_DIM = 384;

// Multilingual cross-encoder reranker (downloaded on demand, quantized; not bundled)
const RERANKER_MODEL_ID = 'onnx-community/bge-reranker-v2-m3-ONNX';

function chunkText(text, maxChunkSize = 1000) {
    if (!text || text.trim().length === 0) return [];

    const overlapSize = Math.floor(maxChunkSize * 0.15);
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
            // Keep the trailing portion as overlap seed for the next chunk
            const tail = currentChunk.slice(-overlapSize).trim();
            currentChunk = tail.length > 0 ? tail : "";
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
    ensureLocalEngine();
    const { pipeline, env } = require('@huggingface/transformers');
    env.cacheDir = modelCacheDir;

    if (!embeddingPipeline) {
        embeddingPipeline = await pipeline('feature-extraction', RAG_MODEL_ID, {
            quantized: true,
            device: 'cpu'
        });
    }
    return embeddingPipeline;
}

// --- RERANKER (cross-encoder) ---

async function getReranker() {
    ensureLocalEngine();
    const { AutoModelForSequenceClassification, AutoTokenizer, env } = require('@huggingface/transformers');
    env.cacheDir = modelCacheDir;

    if (!rerankerModel || !rerankerTokenizer) {
        rerankerTokenizer = await AutoTokenizer.from_pretrained(RERANKER_MODEL_ID);
        rerankerModel = await AutoModelForSequenceClassification.from_pretrained(RERANKER_MODEL_ID, {
            dtype: 'q8',
            device: 'cpu'
        });
    }
    return { model: rerankerModel, tokenizer: rerankerTokenizer };
}

// Re-judges (query, chunk) pairs with the cross-encoder and returns the top-k.
// Falls back to the input order on any failure so retrieval never breaks.
async function rerankResults(queryText, results, k) {
    if (!Array.isArray(results) || results.length === 0) return results;
    try {
        const { model, tokenizer } = await getReranker();
        const queries = new Array(results.length).fill(queryText);
        const passages = results.map(r => r.text || '');
        const inputs = tokenizer(queries, {
            text_pair: passages,
            padding: true,
            truncation: true
        });
        const { logits } = await model(inputs);
        const scores = logits.sigmoid().tolist();

        const reranked = results.map((r, i) => ({
            ...r,
            rerankScore: Array.isArray(scores[i]) ? scores[i][0] : scores[i]
        }));
        reranked.sort((a, b) => b.rerankScore - a.rerankScore);
        return reranked.slice(0, k);
    } catch (e) {
        console.error('Reranker failed, falling back to fusion order:', e);
        return results.slice(0, k);
    }
}

async function generateEmbeddingVector(text, isQuery = false) {
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

    if (embeddingEngine === 'external') {
        if (!apiProfileId) {
            throw new Error("[EMBEDDING_CONFIG_MISSING] External embedding API is selected but no API profile is configured.");
        }
        const { getEmbeddings } = require('./api-engine');
        try {
            return await getEmbeddings(text, apiProfileId, modelName);
        } catch (e) {
            throw e;
        }
    } else {
        // E5 models expect 'query: ' or 'passage: ' prefixes
        const prefixedText = isQuery ? `query: ${text}` : `passage: ${text}`;
        const pipe = await getEmbeddingPipeline();
        const output = await pipe(prefixedText, { pooling: 'mean', normalize: true });
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
    const deleteFts = db.prepare(`
        DELETE FROM knowledge_chunks_fts WHERE chunkId = ?
    `);
    const insertFts = db.prepare(`
        INSERT OR REPLACE INTO knowledge_chunks_fts (chunkId, text)
        VALUES (?, ?)
    `);

    db.transaction(() => {
        for (const v of vectors) {
            insertChunk.run(v.id, ownerId, ownerType, v.source, v.text, JSON.stringify(v.vector), Date.now());
            deleteFts.run(v.id);
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

        const queryVector = await generateEmbeddingVector(queryText, true);

        const denseResults = candidateRows
            .map(row => {
                let parsedVector = [];
                try {
                    parsedVector = JSON.parse(row.vector);
                } catch (e) { }

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
                    } catch (err) { }
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
                    } catch (e) { }
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

        // Optional cross-encoder rerank pass over the top-N fusion candidates
        let rerankEnabled = false;
        let rerankTopN = 25;
        try {
            const rowAdvanced = db.prepare("SELECT value FROM settings WHERE key = 'advanced'").get();
            if (rowAdvanced) {
                const advanced = JSON.parse(rowAdvanced.value);
                rerankEnabled = advanced.rerankerEnabled === true;
                rerankTopN = parseInt(advanced.rerankTopN, 10) || 25;
            }
        } catch (e) { }

        if (rerankEnabled && fusedResults.length > 1) {
            const candidates = fusedResults.slice(0, rerankTopN);
            return await rerankResults(queryText, candidates, k);
        }

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
    } catch (e) { }

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
    } catch (e) { }

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
    } catch (e) { }

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
    const deleteFts = db.prepare(`
        DELETE FROM knowledge_chunks_fts WHERE chunkId = ?
    `);
    const insertFts = db.prepare(`
        INSERT OR REPLACE INTO knowledge_chunks_fts (chunkId, text)
        VALUES (?, ?)
    `);

    db.transaction(() => {
        insertChunk.run(chunkId, chatId, 'chat_memory', title, summary, JSON.stringify(vector), Date.now());
        deleteFts.run(chunkId);
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
    RAG_MODEL_ID,
    RAG_MODEL_DIM,
    chunkText,
    extractTextFromFile,
    generateEmbeddingVector,
    getEmbeddingPipeline,
    vectorizeChunks,
    getReranker,
    rerankResults,
    insertChunksToDb,
    deleteChunksFromDb,
    searchKnowledgeBase,
    searchChatKnowledgeBase,
    searchChatMemories,
    saveChatMemory,
    isLocalEngineInstalled,
    findNodeBinary,
    ensureLocalEngine,
    resetLocalEngine,
    runtimeDir
};
