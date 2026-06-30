const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const os = require('os');
const db = require('./database');
const { encode } = require('gpt-tokenizer/encoding/o200k_base');

// Approximate token count using the same encoding the app uses everywhere else.
// Computed once at write time and stored, so the UI can read it for free.
function countTokens(text) {
    if (!text) return 0;
    try {
        return encode(text).length;
    } catch (e) {
        return Math.ceil(text.length / 4);
    }
}

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

function resetLocalEngine() {
    engineInitialized = false;
    embeddingPipeline = null;
}

// --- CORE RAG UTILITIES ---

// Current local embedding model identifier (used for version-stamp checks)
const RAG_MODEL_ID = 'Xenova/multilingual-e5-small';
const RAG_MODEL_DIM = 384;

// Minimum amount of REAL informational content (after stripping scaffold/empty labels)
// a chunk must have to be indexed. Empty NPC/form skeletons ("Nome:\n● Raça:\n...") are
// pure structure with no content, yet score high cosine on facet-listing queries
// ("leaders, factions, population, economy") and poison the top results. Tune with 🔬.
const MIN_MEANINGFUL_CHARS = 60;

// Length of actual content in a chunk, ignoring bullet markers, lone bullets, and
// empty "Label:" lines (a field label with no value after the colon).
function meaningfulContentLength(text) {
    if (!text) return 0;
    const kept = [];
    for (const rawLine of text.split('\n')) {
        let line = rawLine.trim();
        if (!line) continue;
        // Strip leading bullet/list markers
        line = line.replace(/^[●○•◦▪‣·\-\*▪○\s]+/, '').trim();
        if (!line) continue;                 // lone bullet
        if (/^[^:]{1,40}:\s*$/.test(line)) continue; // empty "Label:" with no value
        kept.push(line);
    }
    return kept.join(' ').replace(/\s+/g, ' ').trim().length;
}

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

    // Drop low-information chunks (empty form skeletons, label-only fragments) so they
    // never enter the index and poison retrieval.
    return chunks.filter(c => meaningfulContentLength(c) >= MIN_MEANINGFUL_CHARS);
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

    // PDFs are extracted directly via the unpdf library
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

// Rich DOCX extraction: convert to HTML so structural formatting (headings,
// bold/italic, lists, blockquotes, tables) survives, instead of the flat plain
// text extractTextFromFile produces. Used by the Writing Desk import so imported
// chapters keep their formatting; the RAG path still uses plain text.
async function extractDocxHtml(filePath) {
    const dataBuffer = fs.readFileSync(filePath);
    const result = await mammoth.convertToHtml({ buffer: dataBuffer });
    return result.value;
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

        // EXPERIMENT (boilerplate-raw): embed only the chunk content + tags, NOT the
        // constant "Document:/Content:" scaffold. That scaffold is identical across every
        // chunk, so it injects a shared vector component that compresses cosine spread and
        // makes unrelated chunks look ~0.84 alike. The enrichedText is still stored/shown to
        // the LLM; only the vector changes. Requires a re-index to take effect.
        const embeddingInput = `${tagsString}${originalChunk}`;

        try {
            const vector = await generateEmbeddingVector(embeddingInput);
            vectors.push({
                id: `chunk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}_${i}`,
                source: sourceFileName,
                text: enrichedText,
                vector: vector,
                tokenCount: countTokens(enrichedText)
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
        INSERT OR REPLACE INTO knowledge_chunks (id, ownerId, ownerType, source, text, vector, createdAt, tokenCount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
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
            insertChunk.run(v.id, ownerId, ownerType, v.source, v.text, JSON.stringify(v.vector), Date.now(), v.tokenCount || countTokens(v.text));
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

// Weight favoring dense (semantic) similarity over sparse (BM25 keyword) in the
// fused score. Dense is the trustworthy signal; sparse mainly breaks ties and
// rescues exact keyword matches. Tuned with the 🔬 debug panel.
const ALPHA_DENSE = 0.7;

// Real similarity scores live in a narrow high band (normalized e5 cosines rarely
// drop below ~0.70 even for unrelated text), so a raw 0-1 threshold is meaningless.
// The Retrieval Strictness slider sends a 0-1 dial mapped onto this band: the low
// end only trims obvious off-topic noise, the high end keeps near-exact matches.
const SIMILARITY_FLOOR_MIN = 0.70;
const SIMILARITY_FLOOR_MAX = 0.88;

// Run the BM25 sparse pass against the FTS table and return a chunkId -> [0,1]
// normalized relevance map. The FTS table is not owner-filtered, so callers fuse
// this against an owner-scoped dense set (the dense map drives membership; a
// sparse-only hit for some other owner never enters the result).
function computeSparseNormMap(queryText) {
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

    // SQLite bm25() returns negative scores (more negative = more relevant).
    // Convert to positive relevance and min-max normalize to [0,1] within the
    // result set so it's comparable to the dense cosine (magnitude-aware fusion).
    const sparseNormMap = new Map();
    if (sparseResults.length > 0) {
        const relevances = sparseResults.map(r => -r.rank);
        const minRel = Math.min(...relevances);
        const maxRel = Math.max(...relevances);
        const span = maxRel - minRel;
        sparseResults.forEach((r, i) => {
            const norm = span > 0 ? (relevances[i] - minRel) / span : 1;
            sparseNormMap.set(r.chunkId, norm);
        });
    }
    return sparseNormMap;
}

// Pure ranking core, decoupled from any DB fetch. Given an already-embedded query
// vector and a list of candidate chunks (each carrying its own vector, either from
// the DB or freshly embedded in memory), score by cosine, fuse with the optional
// sparse map, prune by the strictness floor, and return the top k. This is the
// single fusion path shared by single-owner, multi-owner (cross-chapter), and the
// in-memory volatile-chapter searches.
function fuseAndRank(queryVector, candidates, sparseNormMap, threshold = 0.3, k = 5, boostMap = null) {
    const cosineFloor = SIMILARITY_FLOOR_MIN + threshold * (SIMILARITY_FLOOR_MAX - SIMILARITY_FLOOR_MIN);

    const fusedResults = [];
    for (const cand of candidates) {
        const vector = cand.vector || [];
        const cosine = vector.length === queryVector.length
            ? calculateSimilarity(queryVector, vector)
            : 0;
        const sparseNorm = (sparseNormMap && sparseNormMap.get(cand.id)) || 0;
        // Dynamic-tag boost: a fixed bonus when the chunk carries a tag the query
        // mentions. Added on top of fusion — never rescues a chunk below the floor.
        const boost = (boostMap && boostMap.get(cand.id)) || 0;
        const fusionScore = ALPHA_DENSE * cosine + (1 - ALPHA_DENSE) * sparseNorm + boost;
        fusedResults.push({
            id: cand.id,
            source: cand.source,
            text: cand.text,
            createdAt: cand.createdAt,
            denseScore: cosine,
            score: cosine,
            fusionScore,
            tagBoosted: boost > 0
        });
    }

    return fusedResults
        .filter(r => r.denseScore >= cosineFloor)
        .sort((a, b) => b.fusionScore - a.fusionScore)
        .slice(0, k);
}

// Fixed bonus added to a chunk's fusion score when the query mentions one of its
// dynamic tags. Small relative to the cosine band (~0.70–0.90) so it reorders within
// the surviving set without swamping semantic similarity. Tuned at runtime.
const TAG_BOOST = 0.05;

// Whole-word containment of `term` in `queryLower`, delimited by non-letter/digit on
// both sides (Unicode-aware, so accented names work). Avoids a short term like "Ana"
// matching inside "banana".
function containsWord(queryLower, term) {
    if (!term || term.length < 2) return false;
    const isWord = (ch) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);
    let from = 0;
    while (true) {
        const i = queryLower.indexOf(term, from);
        if (i === -1) return false;
        const before = i > 0 ? queryLower[i - 1] : undefined;
        const after = i + term.length < queryLower.length ? queryLower[i + term.length] : undefined;
        if (!isWord(before) && !isWord(after)) return true;
        from = i + 1;
    }
}

// A tag value "mentions" the query when the query contains the whole value OR any of
// its distinctive tokens (>=4 letters, so honorifics/particles like "de"/"o"/"da"
// are skipped). This tolerates name variants until the canonical entity registry
// (Worldbuild tab) makes tag values consistent: tag "Capitã Seraphina Valois" still
// matches a query that only says "Seraphina Valois".
function queryMentions(queryLower, needleLower) {
    if (!needleLower || needleLower.length < 2) return false;
    if (containsWord(queryLower, needleLower)) return true;
    const tokens = needleLower.split(/[^\p{L}\p{N}]+/u).filter(t => t.length >= 4);
    for (const t of tokens) {
        if (containsWord(queryLower, t)) return true;
    }
    return false;
}

// Build chunkId -> boost map for an owner: load the owner's tag vocabulary (entity
// values, falling back to tag names) and flag every chunk whose tag the query
// mentions. Fixed boost per chunk (decision: not scaled by match count).
function computeTagBoostMap(queryText, ownerId, ownerType) {
    const q = String(queryText || '').toLowerCase();
    const boost = new Map();
    if (!q.trim()) return boost;
    let rows = [];
    try {
        rows = db.prepare(
            `SELECT ct.chunkId AS chunkId, ct.tag AS tag, ct.entity AS entity
             FROM chunk_tags ct JOIN knowledge_chunks kc ON ct.chunkId = kc.id
             WHERE kc.ownerId = ? AND kc.ownerType = ?`
        ).all(ownerId, ownerType);
    } catch (e) { return boost; }
    for (const r of rows) {
        const needle = String(r.entity || r.tag || '').toLowerCase().trim();
        if (queryMentions(q, needle)) boost.set(r.chunkId, TAG_BOOST);
    }
    return boost;
}

// Load enabled candidate chunks for the given owners and parse their vectors once.
function loadOwnerCandidates(ownerIds, ownerType) {
    if (!ownerIds || ownerIds.length === 0) return [];
    const placeholders = ownerIds.map(() => '?').join(', ');
    const rows = db.prepare(
        `SELECT * FROM knowledge_chunks WHERE ownerType = ? AND enabled = 1 AND ownerId IN (${placeholders})`
    ).all(ownerType, ...ownerIds);
    return rows.map(row => {
        let vector = [];
        try { vector = JSON.parse(row.vector); } catch (e) { }
        return { id: row.id, source: row.source, text: row.text, createdAt: row.createdAt, vector };
    });
}

async function executeHybridSearch(queryText, ownerId, ownerType, threshold = 0.3, k = 5, applyTagBoost = false) {
    try {
        const candidates = loadOwnerCandidates([ownerId], ownerType);
        if (candidates.length === 0) return [];
        const queryVector = await generateEmbeddingVector(queryText, true);
        const sparseNormMap = computeSparseNormMap(queryText);
        const boostMap = applyTagBoost ? computeTagBoostMap(queryText, ownerId, ownerType) : null;
        return fuseAndRank(queryVector, candidates, sparseNormMap, threshold, k, boostMap);
    } catch (error) {
        console.error(`Error in executeHybridSearch for owner ${ownerId}:`, error);
        return [];
    }
}

// Cross-owner retrieval: pool the chunks of several owners (e.g. the neighbor
// chapters of a Writing Desk document), embed the query once, and fuse over the
// whole pool. Used by the Writing Desk so a select->invoke can reach other
// chapters without re-embedding the query per owner.
async function executeMultiOwnerSearch(queryText, ownerIds, ownerType, threshold = 0.3, k = 5) {
    try {
        const candidates = loadOwnerCandidates(ownerIds, ownerType);
        if (candidates.length === 0) return [];
        const queryVector = await generateEmbeddingVector(queryText, true);
        const sparseNormMap = computeSparseNormMap(queryText);
        return fuseAndRank(queryVector, candidates, sparseNormMap, threshold, k);
    } catch (error) {
        console.error(`Error in executeMultiOwnerSearch for owners [${(ownerIds || []).join(',')}]:`, error);
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

    // Chat memory is the world-indexed tier: enable the dynamic-tag boost.
    const results = await executeHybridSearch(queryText, chatId, 'chat_memory', threshold, k, true);
    // Attach each surviving chunk's tags for debug visibility (which tags it carries).
    try {
        const tagStmt = db.prepare('SELECT tag, entity FROM chunk_tags WHERE chunkId = ?');
        for (const r of results) r.tags = tagStmt.all(r.id);
    } catch (e) { }
    return results;
}

async function saveChatMemory(title, summary, chatId) {
    const enrichedText = `Memory Context [${title}]: ${summary}`;
    const vector = await generateEmbeddingVector(enrichedText);
    const chunkId = `mem_${Date.now()}`;

    const insertChunk = db.prepare(`
        INSERT OR REPLACE INTO knowledge_chunks (id, ownerId, ownerType, source, text, vector, createdAt, tokenCount)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const deleteFts = db.prepare(`
        DELETE FROM knowledge_chunks_fts WHERE chunkId = ?
    `);
    const insertFts = db.prepare(`
        INSERT OR REPLACE INTO knowledge_chunks_fts (chunkId, text)
        VALUES (?, ?)
    `);

    const memoryTokens = countTokens(summary);

    db.transaction(() => {
        insertChunk.run(chunkId, chatId, 'chat_memory', title, summary, JSON.stringify(vector), Date.now(), memoryTokens);
        deleteFts.run(chunkId);
        insertFts.run(chunkId, summary);
    })();

    return {
        id: chunkId,
        title: title,
        text: summary,
        vector: vector,
        tokenCount: memoryTokens,
        createdAt: Date.now()
    };
}

// Attach retrieval-only tags to already-stored chunk ids. tags = [{tag, entity}].
function tagChunks(chunkIds, tags) {
    if (!chunkIds || !chunkIds.length || !tags || !tags.length) return;
    const insertTag = db.prepare('INSERT OR IGNORE INTO chunk_tags (chunkId, tag, entity) VALUES (?, ?, ?)');
    db.transaction(() => {
        for (const id of chunkIds) {
            for (const t of tags) insertTag.run(id, t.tag, t.entity || null);
        }
    })();
}


// --- EXPORTS ---

module.exports = {
    RAG_MODEL_ID,
    RAG_MODEL_DIM,
    countTokens,
    chunkText,
    extractTextFromFile,
    extractDocxHtml,
    generateEmbeddingVector,
    getEmbeddingPipeline,
    vectorizeChunks,
    insertChunksToDb,
    deleteChunksFromDb,
    searchKnowledgeBase,
    searchChatKnowledgeBase,
    searchChatMemories,
    executeHybridSearch,
    executeMultiOwnerSearch,
    fuseAndRank,
    saveChatMemory,
    tagChunks,
    isLocalEngineInstalled,
    findNodeBinary,
    ensureLocalEngine,
    resetLocalEngine,
    runtimeDir
};
