const fs = require('fs');
const path = require('path');
const mammoth = require('mammoth');
const os = require('os');
const db = require('./database');
const { encode } = require('gpt-tokenizer/encoding/o200k_base');
const { chunkText, meaningfulContentLength, MIN_MEANINGFUL_CHARS } = require('./features/knowledge/chunk-text');
const { buildFtsMatchQuery } = require('./features/knowledge/fts-query');
const { applyNameTags } = require('./features/world-index/name-tags');
const retrievalLedger = require('./features/knowledge/retrieval-ledger');
const {
    calculateSimilarity,
    normalizeSparseRanks,
    queryMentions,
    fuseAndRank,
    tagNeedles,
    buildEntityEvidenceMap,
    rankLookupChunks
} = require('./features/knowledge/retrieval-rank');

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

    // The engine zip carries only onnxruntime-node's native binary; its JS dependency
    // onnxruntime-common lives in the asar, so add the app's node_modules to the path too.
    const nodeModulesPath = path.join(runtimeDir, 'node_modules');
    const { app } = require('electron');
    const appNodeModules = path.join(app.getAppPath(), 'node_modules');
    process.env.NODE_PATH = nodeModulesPath + path.delimiter + appNodeModules + path.delimiter + (process.env.NODE_PATH || '');
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

// --- FILE EXTRACTION ---

async function extractTextFromFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();

    // Skip binary media and archive formats to prevent garbage character generation
    const mediaExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.webm', '.mov', '.mp3', '.wav', '.ogg', '.flac', '.zip', '.tar', '.gz', '.klp', '.klkb', '.klw', '.klwb', '.db'];
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

// HTML keeps formatting for Writing Desk import; RAG still uses plain text.
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
            dtype: 'q8',
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
        const { getEmbeddings } = require('./features/llm/llm.service');
        try {
            return await getEmbeddings(text, apiProfileId, modelName);
        } catch (e) {
            throw e;
        }
    } else {
        // E5 models expect 'query: ' or 'passage: ' prefixes
        const pipe = await getEmbeddingPipeline();
        if (isQuery) return embedQueryWindows(pipe, String(text || ''));
        const output = await pipe(`passage: ${text}`, { pooling: 'mean', normalize: true });
        return Array.from(output.data);
    }
}

// The local model reads at most 512 tokens, so long queries are embedded in windows and averaged.
const QUERY_WINDOW_CHARS = 1500;
const MAX_QUERY_WINDOWS = 8;

function splitQueryWindows(text) {
    if (text.length <= QUERY_WINDOW_CHARS) return [text];
    const windows = [];
    let current = '';
    for (const piece of text.split(/(?<=[.!?…\n])\s+/)) {
        if (!piece) continue;
        if (current && current.length + 1 + piece.length > QUERY_WINDOW_CHARS) {
            windows.push(current);
            current = '';
        }
        if (piece.length > QUERY_WINDOW_CHARS) {
            for (let i = 0; i < piece.length; i += QUERY_WINDOW_CHARS) windows.push(piece.slice(i, i + QUERY_WINDOW_CHARS));
            continue;
        }
        current = current ? `${current} ${piece}` : piece;
    }
    if (current) windows.push(current);
    // A very long query keeps its end, which is where the request usually is.
    return windows.length > MAX_QUERY_WINDOWS ? windows.slice(-MAX_QUERY_WINDOWS) : windows;
}

async function embedQueryWindows(pipe, text) {
    const windows = splitQueryWindows(text);
    if (windows.length === 1) {
        const output = await pipe(`query: ${windows[0]}`, { pooling: 'mean', normalize: true });
        return Array.from(output.data);
    }
    const output = await pipe(windows.map(window => `query: ${window}`), { pooling: 'mean', normalize: true });
    const dims = output.dims || [];
    const width = dims[dims.length - 1];
    const flat = output.data;
    const mean = new Array(width).fill(0);
    for (let row = 0; row < windows.length; row++) {
        for (let col = 0; col < width; col++) mean[col] += flat[row * width + col];
    }
    const norm = Math.sqrt(mean.reduce((sum, value) => sum + value * value, 0)) || 1;
    return mean.map(value => value / norm);
}

// Kept modest so a large archive cannot spike memory.
const EMBEDDING_BATCH_SIZE = 16;

// Read the embedding configuration once instead of per chunk.
function readEmbeddingConfig() {
    try {
        const rowAdvanced = db.prepare("SELECT value FROM settings WHERE key = 'advanced'").get();
        const advanced = rowAdvanced ? JSON.parse(rowAdvanced.value) : {};
        return {
            engine: advanced.embeddingEngine || 'local',
            apiProfileId: advanced.embeddingApiProfileId || '',
            modelName: advanced.embeddingModelName || ''
        };
    } catch (e) {
        console.error("Error reading embedding settings:", e);
        return { engine: 'local', apiProfileId: '', modelName: '' };
    }
}

// Mean pooling honours the attention mask, so padding doesn't change vectors.
// A failed batch falls back to one-at-a-time.
async function generateEmbeddingVectors(texts) {
    const config = readEmbeddingConfig();
    if (config.engine !== 'local') {
        const vectors = [];
        for (const text of texts) vectors.push(await generateEmbeddingVector(text));
        return vectors;
    }

    const prefixed = texts.map(text => `passage: ${text}`);
    try {
        const pipe = await getEmbeddingPipeline();
        const output = await pipe(prefixed, { pooling: 'mean', normalize: true, padding: true, truncation: true });
        const dims = output.dims || [];
        const width = dims.length >= 2 ? dims[dims.length - 1] : 0;
        const flat = Array.from(output.data);
        if (!width || flat.length !== width * texts.length) throw new Error('Unexpected embedding batch shape');
        return texts.map((_, index) => flat.slice(index * width, (index + 1) * width));
    } catch (e) {
        console.warn('[Embeddings] batch failed, falling back to one at a time:', e.message);
        const vectors = [];
        for (const text of texts) vectors.push(await generateEmbeddingVector(text));
        return vectors;
    }
}

async function vectorizeChunks(chunks, sourceFileName, progressCallback, keywords = []) {
    const vectors = [];
    const tagsString = Array.isArray(keywords) && keywords.length > 0 ? `Tags: ${keywords.join(', ')}\n` : '';

    // The shared "Document:/Content:" scaffold stays out of the vector: it compresses cosine spread.
    // Changing this requires a re-index.
    for (let start = 0; start < chunks.length; start += EMBEDDING_BATCH_SIZE) {
        const slice = chunks.slice(start, start + EMBEDDING_BATCH_SIZE);
        let batchVectors;
        try {
            batchVectors = await generateEmbeddingVectors(slice.map(chunk => `${tagsString}${chunk}`));
        } catch (err) {
            console.error(`Failed to generate vectors for ${sourceFileName} at chunk ${start}:`, err);
            throw err;
        }

        slice.forEach((originalChunk, offset) => {
            const index = start + offset;
            const enrichedText = `Document: ${sourceFileName}
${tagsString}Content: ${originalChunk}`;
            vectors.push({
                id: `chunk_${Date.now()}_${Math.random().toString(36).substring(2, 7)}_${index}`,
                source: sourceFileName,
                text: enrichedText,
                vector: batchVectors[offset],
                tokenCount: countTokens(enrichedText)
            });
        });

        if (progressCallback) {
            progressCallback(Math.min(start + slice.length, chunks.length), chunks.length);
        }
    }
    return vectors;
}

// --- DATABASE OPERATIONS ---

function insertChunksToDb(ownerId, ownerType, vectors) {
    const insertChunk = db.prepare(`
        INSERT OR REPLACE INTO knowledge_chunks (id, ownerId, ownerType, source, text, vector, createdAt, tokenCount, content_hash, ordinal, memoryBlockId)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
            const memoryBlockId = ownerType === 'chat_memory'
                ? (v.memoryBlockId || v.blockId || (/^(?:block|manual|mem)_/.test(v.id) ? v.id : null))
                : null;
            insertChunk.run(v.id, ownerId, ownerType, v.source, v.text, JSON.stringify(v.vector), Date.now(), v.tokenCount || countTokens(v.text), v.content_hash ?? null, v.ordinal ?? null, memoryBlockId);
            deleteFts.run(v.id);
            insertFts.run(v.id, v.text);
        }
    })();
    invalidateVectorCache(vectors.map(v => v.id));
    tagNamesOnInsert(ownerId, ownerType, vectors);
    forgetRetrievalLedger(ownerId, ownerType);
}

// Names cost nothing to find, so new passages carry them before any Tagger run.
function workspaceOf(ownerId, ownerType) {
    if (ownerType === 'chat_memory' || ownerType === 'chat_kb') return ownerId;
    if (ownerType === 'document') {
        return db.prepare('SELECT workspaceId FROM documents WHERE id = ?').get(ownerId)?.workspaceId || null;
    }
    return null;
}

// What the retrieval ledger remembers was measured on the old corpus, so new or removed
// passages retire it.
function forgetRetrievalLedger(ownerId, ownerType) {
    try {
        const workspaceId = workspaceOf(ownerId, ownerType);
        if (workspaceId) retrievalLedger.clear(workspaceId);
    } catch (e) { }
}

function tagNamesOnInsert(ownerId, ownerType, vectors) {
    try {
        const workspaceId = workspaceOf(ownerId, ownerType);
        if (workspaceId) applyNameTags(db, workspaceId, vectors.map(v => ({ id: v.id, text: v.text })));
    } catch (e) {
        console.error('[Name tags] tagging new passages failed:', e.message);
    }
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
    forgetRetrievalLedger(ownerId, ownerType);
}

// --- HYBRID SEARCH ENGINE ---

// Enough keyword hits to rank the owner's chunks; normalization only needs the top.
const SPARSE_RESULT_LIMIT = 500;

// Restricted to the searched owners so other workspaces never shape the normalization.
function computeSparseNormMap(queryText, ownerIds = null, ownerType = null) {
    let sparseResults = [];
    const matchQuery = buildFtsMatchQuery(queryText);
    if (matchQuery) {
        try {
            if (Array.isArray(ownerIds) && ownerIds.length && ownerType) {
                const placeholders = ownerIds.map(() => '?').join(', ');
                sparseResults = db.prepare(`
                    SELECT knowledge_chunks_fts.chunkId AS chunkId, bm25(knowledge_chunks_fts) AS rank
                    FROM knowledge_chunks_fts
                    JOIN knowledge_chunks kc ON kc.id = knowledge_chunks_fts.chunkId
                    WHERE knowledge_chunks_fts MATCH ? AND kc.ownerType = ? AND kc.ownerId IN (${placeholders})
                    ORDER BY rank
                    LIMIT ${SPARSE_RESULT_LIMIT}
                `).all(matchQuery, ownerType, ...ownerIds);
            } else {
                sparseResults = db.prepare(`
                    SELECT chunkId, bm25(knowledge_chunks_fts) AS rank
                    FROM knowledge_chunks_fts
                    WHERE knowledge_chunks_fts MATCH ?
                    ORDER BY rank
                    LIMIT ${SPARSE_RESULT_LIMIT}
                `).all(matchQuery);
            }
        } catch (e) {
            console.warn('[RAG] Keyword search failed:', e.message);
            sparseResults = [];
        }
    }

    return normalizeSparseRanks(sparseResults);
}

function computeTagBoostMap(queryText, ownerId, ownerType, totalChunks = 0) {
    return computeTagBoostMapForOwners(queryText, [ownerId], ownerType, totalChunks);
}

// Same as computeTagBoostMap but across several owners (e.g. the sibling chapters of a
// Writing Desk document), so cross-chapter retrieval also rides the world-index tags.
function computeTagBoostMapForOwners(queryText, ownerIds, ownerType, totalChunks = 0) {
    if (!ownerIds || !ownerIds.length) return new Map();
    const placeholders = ownerIds.map(() => '?').join(',');
    let rows = [];
    try {
        rows = db.prepare(
            `SELECT ct.chunkId AS chunkId, ct.tag AS tag, ct.entity AS entity,
                    e.type AS type, e.canonicalName AS canonicalName, e.aliases AS aliases
             FROM chunk_tags ct
             JOIN knowledge_chunks kc ON ct.chunkId = kc.id
             LEFT JOIN entities e ON ct.entity = e.id
             WHERE kc.ownerId IN (${placeholders}) AND kc.ownerType = ?`
        ).all(...ownerIds, ownerType);
    } catch (e) { return new Map(); }
    return buildEntityEvidenceMap(queryText, rows, { totalChunks });
}

// From tags on this owner's chunks, not the whole registry, so it reflects what is indexed here.
function getWorldVocabulary(ownerId, ownerType, limit = 40) {
    let rows = [];
    try {
        rows = db.prepare(
            `SELECT ct.tag AS tag, ct.entity AS entity,
                    e.canonicalName AS canonicalName, e.aliases AS aliases,
                    COUNT(DISTINCT ct.chunkId) AS chunkCount
             FROM chunk_tags ct
             JOIN knowledge_chunks kc ON ct.chunkId = kc.id
             LEFT JOIN entities e ON ct.entity = e.id
             WHERE kc.ownerId = ? AND kc.ownerType = ?
             GROUP BY ct.entity, ct.tag`
        ).all(ownerId, ownerType);
    } catch (e) { return []; }

    // Collapse to one entry per canonical name (an entity may surface through several
    // literal tag rows), keeping the highest chunk count.
    const byName = new Map();
    for (const r of rows) {
        let name, aliases = [];
        if (r.canonicalName) {
            name = r.canonicalName;
            try { const a = JSON.parse(r.aliases); if (Array.isArray(a)) aliases = a; } catch (e) { }
        } else {
            name = r.entity || r.tag;
        }
        if (!name) continue;
        const key = name.toLowerCase();
        const existing = byName.get(key);
        if (!existing || r.chunkCount > existing.chunkCount) {
            byName.set(key, { name, aliases, chunkCount: r.chunkCount });
        }
    }
    return Array.from(byName.values())
        .sort((a, b) => b.chunkCount - a.chunkCount)
        .slice(0, limit);
}

// Parsed vectors by chunk id. Reused only while the stored vector's fingerprint
// (length + both ends of its JSON) matches, so re-embedded chunks are reloaded.
const vectorCache = new Map();
const VECTOR_CACHE_LIMIT = 60000;
const EMPTY_VECTOR = new Float32Array(0);
const VECTOR_FINGERPRINT_SQL = "length(vector) || ':' || substr(vector, 1, 32) || substr(vector, -32)";

function cachedVectors(rows) {
    const missing = rows
        .filter(row => !vectorCache.has(row.id) || vectorCache.get(row.id).fingerprint !== row.fingerprint)
        .map(row => row.id);
    if (missing.length) {
        if (vectorCache.size + missing.length > VECTOR_CACHE_LIMIT) vectorCache.clear();
        for (let start = 0; start < missing.length; start += 500) {
            const batch = missing.slice(start, start + 500);
            const placeholders = batch.map(() => '?').join(', ');
            const vectorRows = db.prepare(
                `SELECT id, vector, ${VECTOR_FINGERPRINT_SQL} AS fingerprint FROM knowledge_chunks WHERE id IN (${placeholders})`
            ).all(...batch);
            for (const row of vectorRows) {
                let parsed = [];
                try { parsed = JSON.parse(row.vector); } catch (e) { }
                vectorCache.set(row.id, {
                    fingerprint: row.fingerprint,
                    vector: Array.isArray(parsed) && parsed.length ? Float32Array.from(parsed) : EMPTY_VECTOR
                });
            }
        }
    }
    return new Map(rows.map(row => [row.id, vectorCache.get(row.id)?.vector || EMPTY_VECTOR]));
}

function invalidateVectorCache(ids = null) {
    if (!ids) {
        vectorCache.clear();
        return;
    }
    for (const id of ids) vectorCache.delete(id);
}

// Every surface the Tagger marks, so an entity's dossier is not limited to chat archives.
const WORKSPACE_CHUNK_SCOPE = `((kc.ownerId = ? AND kc.ownerType IN ('chat_memory', 'chat_kb'))
     OR (kc.ownerType = 'document' AND kc.ownerId IN (SELECT id FROM documents WHERE workspaceId = ?)))`;

function chunkScope(ownerId, ownerType, scope) {
    return scope === 'workspace'
        ? { where: WORKSPACE_CHUNK_SCOPE, params: [ownerId, ownerId] }
        : { where: '(kc.ownerId = ? AND kc.ownerType = ?)', params: [ownerId, ownerType] };
}

// No similarity floor. With scope 'workspace', `ownerId` is the workspace and `ownerType` is ignored.
function lookupEntityChunks(nameOrAlias, ownerId, ownerType, { queryVector = null, limit = null, idsOnly = false, scope = 'owner' } = {}) {
    const needle = String(nameOrAlias || '').toLowerCase().trim();
    if (!needle) return { chunks: [], entityIds: [], total: 0 };
    const { where, params } = chunkScope(ownerId, ownerType, scope);
    let tagRows = [];
    try {
        tagRows = db.prepare(
            `SELECT DISTINCT ct.tag AS tag, ct.entity AS entity,
                    e.canonicalName AS canonicalName, e.aliases AS aliases
             FROM chunk_tags ct
             JOIN knowledge_chunks kc ON ct.chunkId = kc.id
             LEFT JOIN entities e ON ct.entity = e.id
             WHERE ${where} AND kc.enabled = 1`
        ).all(...params);
    } catch (e) { return { chunks: [], entityIds: [], total: 0 }; }

    const matchedTags = [];
    const entityIds = new Set();
    for (const r of tagRows) {
        const hit = tagNeedles(r).some(n => {
            const nl = String(n).toLowerCase().trim();
            if (!nl) return false;
            return nl === needle || queryMentions(needle, nl) || queryMentions(nl, needle);
        });
        if (!hit) continue;
        matchedTags.push({ tag: r.tag, entity: r.entity });
        // canonicalName present => ct.entity is a real registry id worth hopping from.
        if (r.canonicalName && r.entity) entityIds.add(r.entity);
    }
    if (idsOnly || !matchedTags.length) return { chunks: [], entityIds: Array.from(entityIds), total: 0 };

    let rows = [];
    try {
        const clause = matchedTags.map(() => '(ct.tag = ? AND ct.entity IS ?)').join(' OR ');
        rows = db.prepare(
            `SELECT DISTINCT kc.id AS id, kc.source AS source, kc.text AS text, kc.ownerType AS ownerType,
                    kc.memoryBlockId AS memoryBlockId, kc.createdAt AS createdAt,
                    ${VECTOR_FINGERPRINT_SQL} AS fingerprint
             FROM chunk_tags ct
             JOIN knowledge_chunks kc ON ct.chunkId = kc.id
             WHERE ${where} AND kc.enabled = 1 AND (${clause})`
        ).all(...params, ...matchedTags.flatMap(t => [t.tag, t.entity]));
    } catch (e) { return { chunks: [], entityIds: Array.from(entityIds), total: 0 }; }

    const vectors = Array.isArray(queryVector) && queryVector.length ? cachedVectors(rows) : null;
    const ranked = rankLookupChunks(rows, queryVector, id => vectors && vectors.get(id));
    const capped = Number.isInteger(limit) && limit > 0 ? ranked.slice(0, limit) : ranked;
    return {
        chunks: capped.map(({ id, source, text, ownerType: chunkOwnerType, memoryBlockId, score }) => ({ id, source, text, ownerType: chunkOwnerType, memoryBlockId, score })),
        entityIds: Array.from(entityIds),
        total: rows.length
    };
}

function loadOwnerCandidates(ownerIds, ownerType) {
    if (!ownerIds || ownerIds.length === 0) return [];
    const placeholders = ownerIds.map(() => '?').join(', ');
    const rows = db.prepare(
        `SELECT id, source, text, createdAt, memoryBlockId, ${VECTOR_FINGERPRINT_SQL} AS fingerprint
         FROM knowledge_chunks WHERE ownerType = ? AND enabled = 1 AND ownerId IN (${placeholders})`
    ).all(ownerType, ...ownerIds);
    const vectors = cachedVectors(rows);
    return rows.map(row => ({
        id: row.id,
        source: row.source,
        text: row.text,
        createdAt: row.createdAt,
        memoryBlockId: row.memoryBlockId,
        vector: vectors.get(row.id)
    }));
}

async function executeHybridSearch(queryText, ownerId, ownerType, threshold = 0.3, k = 5, applyTagBoost = false) {
    try {
        const candidates = loadOwnerCandidates([ownerId], ownerType);
        if (candidates.length === 0) return [];
        const queryVector = await generateEmbeddingVector(queryText, true);
        const sparseNormMap = computeSparseNormMap(queryText, [ownerId], ownerType);
        const boostMap = applyTagBoost ? computeTagBoostMap(queryText, ownerId, ownerType, candidates.length) : null;
        return fuseAndRank(queryVector, candidates, sparseNormMap, threshold, k, boostMap);
    } catch (error) {
        console.error(`Error in executeHybridSearch for owner ${ownerId}:`, error);
        return [];
    }
}

// Embeds the query once and fuses over several owners' chunks (e.g. neighbor chapters).
async function executeMultiOwnerSearch(queryText, ownerIds, ownerType, threshold = 0.3, k = 5, applyTagBoost = false) {
    try {
        const candidates = loadOwnerCandidates(ownerIds, ownerType);
        if (candidates.length === 0) return [];
        const queryVector = await generateEmbeddingVector(queryText, true);
        const sparseNormMap = computeSparseNormMap(queryText, ownerIds, ownerType);
        const boostMap = applyTagBoost ? computeTagBoostMapForOwners(queryText, ownerIds, ownerType, candidates.length) : null;
        return fuseAndRank(queryVector, candidates, sparseNormMap, threshold, k, boostMap);
    } catch (error) {
        console.error(`Error in executeMultiOwnerSearch for owners [${(ownerIds || []).join(',')}]:`, error);
        return [];
    }
}

// Strictness and Top-K as the user set them. `k` may be raised by the caller when the
// payload budget has room for more passages; it is never lowered below this.
function readRetrievalSettings(topKKey, fallbackK) {
    let threshold = 0.3;
    let k = fallbackK;
    try {
        const rowAdvanced = db.prepare("SELECT value FROM settings WHERE key = 'advanced'").get();
        if (rowAdvanced) {
            const advanced = JSON.parse(rowAdvanced.value);
            threshold = parseFloat(advanced.similarity) || 0.3;
            k = parseInt(advanced[topKKey], 10) || fallbackK;
        }
    } catch (e) { }
    return { threshold, k };
}

function resolveTopK(configured, override) {
    const requested = parseInt(override, 10);
    return Number.isInteger(requested) && requested > 0 ? Math.max(configured, requested) : configured;
}

async function searchKnowledgeBase(queryText, profileId, { k: topK = null } = {}) {
    const { threshold, k } = readRetrievalSettings('topKKB', 5);
    return await executeHybridSearch(queryText, profileId, 'profile_kb', threshold, resolveTopK(k, topK));
}

// Workspace files carry world-index tags, so the caller may ask for the same evidence
// boost the archive gets. Profile files are never tagged, so there is nothing to boost there.
async function searchChatKnowledgeBase(queryText, chatId, { k: topK = null, boost = false } = {}) {
    const { threshold, k } = readRetrievalSettings('topKKB', 5);
    return await executeHybridSearch(queryText, chatId, 'chat_kb', threshold, resolveTopK(k, topK), boost);
}

// Passages of the documents linked to an entity, under the user's own strictness and Top-K.
async function searchLoreDocuments(queryText, documentIds, { k: topK = null } = {}) {
    const ids = Array.isArray(documentIds) ? documentIds.filter(Boolean) : [];
    if (!ids.length) return [];
    const { threshold, k } = readRetrievalSettings('topKKB', 5);
    return await executeMultiOwnerSearch(queryText, ids, 'document', threshold, resolveTopK(k, topK), true);
}

async function searchChatMemories(queryText, chatId, { k: topK = null } = {}) {
    const { threshold, k } = readRetrievalSettings('topKMemory', 8);

    // Chat memory is the world-indexed tier: enable the dynamic-tag boost.
    const results = await executeHybridSearch(queryText, chatId, 'chat_memory', threshold, resolveTopK(k, topK), true);
    // Attach each surviving chunk's tags for debug visibility (which tags it carries).
    try {
        const tagStmt = db.prepare(
            `SELECT ct.tag AS tag, COALESCE(e.canonicalName, ct.entity) AS entity
             FROM chunk_tags ct LEFT JOIN entities e ON ct.entity = e.id
             WHERE ct.chunkId = ?`
        );
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

function loadMemoryBlockChunks(ownerId, blockIds) {
    const ids = [...new Set((blockIds || []).filter(Boolean))];
    const blocks = new Map();
    if (!ids.length) return blocks;
    const placeholders = ids.map(() => '?').join(', ');
    const rows = db.prepare(
        `SELECT rowid, id, text, memoryBlockId FROM knowledge_chunks
         WHERE ownerId = ? AND ownerType = 'chat_memory' AND enabled = 1 AND memoryBlockId IN (${placeholders})`
    ).all(ownerId, ...ids);
    for (const row of rows) {
        if (!blocks.has(row.memoryBlockId)) blocks.set(row.memoryBlockId, []);
        blocks.get(row.memoryBlockId).push(row);
    }
    return blocks;
}

// --- EXPORTS ---

module.exports = {
    loadMemoryBlockChunks,
    RAG_MODEL_ID,
    RAG_MODEL_DIM,
    countTokens,
    chunkText,
    extractTextFromFile,
    extractDocxHtml,
    generateEmbeddingVector,
    generateEmbeddingVectors,
    getEmbeddingPipeline,
    vectorizeChunks,
    invalidateVectorCache,
    calculateSimilarity,
    insertChunksToDb,
    deleteChunksFromDb,
    searchKnowledgeBase,
    searchChatKnowledgeBase,
    searchChatMemories,
    executeHybridSearch,
    executeMultiOwnerSearch,
    searchLoreDocuments,
    fuseAndRank,
    getWorldVocabulary,
    lookupEntityChunks,
    saveChatMemory,
    tagChunks,
    isLocalEngineInstalled,
    findNodeBinary,
    ensureLocalEngine,
    resetLocalEngine,
    runtimeDir
};
