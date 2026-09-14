const db = require('./database');
const entitiesStore = require('./entities');
const { sendApiRequest, sendAgentRequest, nativeToolSupport, getReservedOutputTokens, resolvePayloadLimit, createPromptVariableResolver } = require('./features/llm/llm.service');
const { sendApiRequestStream } = require('./features/llm/llm.stream');
const { applyGenerationHistory, resolveWorkspaceGenerationTarget } = require('./features/chat/generation-target');
const { selectActiveMessages, selectArchivableMessages, coveredMessageIds, parseMemoryBlocks } = require('./features/chat/archive-coverage');
const { syncSummarizedIndex, setMessagesExcluded, readMemoryBlocks } = require('./features/chat/archive-store');
const {
    filterWorkspaceKnowledgeResults,
    filterWorkspaceMemoryResults
} = require('./features/chat/workspace-context-scope');
const { ROLE_IDS, readAdvancedSettings, resolveAiEngineRole } = require('./features/ai-engine/role-resolver');
const { parseEntityUpdateObject } = require('./features/worldbuild/entity-update-json');
const {
    filterUpdateFields,
    filterUpdateRelations,
    buildFieldCoverage,
    isUnsupportedNumericDelta
} = require('./features/worldbuild/entity-update-contract');
const { buildEntityUpdateSchema, buildEntityLoreSchema } = require('./features/worldbuild/entity-update-schema');
const {
    ENRICH_ENUMS,
    ENRICH_FIELDS,
    ENRICH_TYPE_GUIDANCE,
    ENRICH_FIELD_GUIDANCE,
    entityDataFacts
} = require('./features/worldbuild/entity-fields');
const { decodeEntityUpdate, isEntityUpdateShape: isStructuredEntityUpdate } = require('./features/worldbuild/entity-update-protocol');
const { buildLorePrompt, buildLoreAppendPrompt, validateEntityLore, validateEntityLoreAppend } = require('./features/worldbuild/entity-lore');
const { createEntityUpdateState } = require('./features/worldbuild/entity-update-state');
const { shouldStopEntityUpdates } = require('./features/worldbuild/entity-update-resilience');
const { proposalDataForMention } = require('./features/world-index/tagger-response');
const { runModelTagger } = require('./features/world-index/tagger');
const { applyNameTags, createNameMatcher, refreshWorkspaceNameTags, loadWorkspaceEntities } = require('./features/world-index/name-tags');
const { saveChunkStatus } = require('./features/world-index/chunk-status');
const { checkProposal } = require('./features/world-index/name-quality');
const { collectLowercaseWords, findCandidateMentions } = require('./features/world-index/literal-mentions');
const { foldText } = require('./features/world-index/text-fold');
const {
    PAYLOAD_BUDGET_CONTRACT,
    assertPayloadWithinLimit,
    estimatePayloadTokens,
    getAvailableHistoryTokens,
    normalizeMaxApiPayload,
    safetyMarginFor
} = require('./features/llm/payload-budget');
const {
    packContextItems,
    renderContextSections,
    selectRecentWithinBudget,
    splitRetrievalBudget,
    retrievalTopK,
    truncateToTokens
} = require('./features/llm/context-budget');
const { stripReasoning } = require('./features/chat/message-text');
const { reconstructKnowledgeFile } = require('./features/knowledge/kb-reconstruct');
const { parseCitations, isCitedChunk } = require('./features/knowledge/cited-sources');
const { parseAgentTurn } = require('./features/knowledge/agent-output');
const {
    queryKey,
    plannerWindowShape,
    downgradeUntilFits,
    shouldRunPlanner,
    entityMentionIds,
    worldMapBlock,
    formatCoverage
} = require('./features/knowledge/agent-planner');
const retrievalLedger = require('./features/knowledge/retrieval-ledger');
const { TOOL_NAMES, argOf, plannerToolDefinitions, textToolCatalog, renderTextCall } = require('./features/knowledge/planner-tools');
const { flattenConversation } = require('./features/llm/tool-conversation');
const { recordTokenCount, tokenRatio, calibrateTokens } = require('./features/llm/token-calibration');
const { buildNeighborPassages } = require('./features/knowledge/passage-neighbors');
const { encode } = require('gpt-tokenizer/encoding/o200k_base');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const appDataPath = process.env.APPDATA || (process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support') : path.join(os.homedir(), '.local', 'share'));
const dataDir = path.join(appDataPath, 'Kallamo');
const chatsDir = path.join(dataDir, 'ChatHistory');
const profilesDir = path.join(dataDir, 'AI Profiles');

const {
    searchKnowledgeBase,
    searchChatKnowledgeBase,
    searchChatMemories,
    generateEmbeddingVector,
    getWorldVocabulary,
    lookupEntityChunks,
    searchLoreDocuments,
    extractTextFromFile,
    chunkText,
    vectorizeChunks,
    insertChunksToDb,
    loadMemoryBlockChunks
} = require('./rag-service');

let activeRun = null;
let errorDeferred = null;
let overflowDeferred = null;

function createCancellationError() {
    const error = new Error('Generation cancelled.');
    error.name = 'AbortError';
    return error;
}

function throwIfRunCancelled(run) {
    if (run?.isCancelled || run?.controller?.signal.aborted) {
        throw createCancellationError();
    }
}

function sendRunEvent(webContents, channel, run, payload) {
    if (!webContents || run?.isCancelled) return;
    webContents.send(channel, {
        ...payload,
        chatId: run?.chatId ?? payload.chatId,
        runId: run?.id ?? payload.runId
    });
}

function cancelRun(run) {
    if (!run) return;
    run.isCancelled = true;
    run.controller?.abort();
    if (errorDeferred?.runId === run.id) {
        errorDeferred.resolve('interrupt');
        errorDeferred = null;
    }
    if (overflowDeferred?.runId === run.id) {
        overflowDeferred.resolve({ decision: 'interrupt', editedText: '' });
        overflowDeferred = null;
    }
}

// Formats a retrieved result set for the RAG debug panel: source + fusion/similarity
// score + the full chunk text.
function formatRagDebugSection(label, resultObjs) {
    if (!Array.isArray(resultObjs) || resultObjs.length === 0) return '';
    const lines = resultObjs.map((r, idx) => {
        const fusion = typeof r.fusionScore === 'number' ? r.fusionScore : (r.score || 0);
        const cosine = typeof r.score === 'number' ? r.score : fusion;
        const scoreLabel = `fusion ${fusion.toFixed(4)} | cos ${cosine.toFixed(4)}`;
        const fullText = (r.text || '').trim();
        const tagStr = Array.isArray(r.tags) && r.tags.length
            ? ` {${r.tags.map(t => t.entity ? `${t.tag}=${t.entity}` : t.tag).join(', ')}}`
            : '';
        const boostMark = r.tagBoosted ? ' ⤴boost' : '';
        return `${idx + 1}. [${r.source}]${tagStr}${boostMark} (${scoreLabel})\n${fullText}`;
    });
    return `${label} (${resultObjs.length}):\n${lines.join('\n\n')}\n`;
}

// --- TOKEN UTILITIES ---

function estimateTokens(str) {
    if (!str) return 0;
    try {
        return encode(str).length;
    } catch (e) {
        return Math.ceil(str.length / 4);
    }
}

// Executors that should skip native tool calling for the rest of the session. A failed native
// request marks one at once; a first reply without any call is one strike, since a capable
// model may simply have been done.
const TEXT_PROTOCOL_STRIKES = new Map();
const TEXT_PROTOCOL_STRIKE_LIMIT = 2;

// A file the agent read, or an entity's lore, may take at most this share of the
// retrieval budget; the rest stays available for search results.
const AGENTIC_ITEM_MAX_SHARE = 0.6;

// Passages lookup_entity hands the agent (and the final context) per call.
const LOOKUP_ENTITY_CHUNK_LIMIT = 12;

// Profile knowledge, workspace files and archived memory each ask for their own passages.
const RETRIEVAL_TIERS = 3;

const PROFILE_RETRIEVAL_HEADER = '--- PROFILE RELEVANT RETRIEVED KNOWLEDGE ---';
const CHAT_RETRIEVAL_HEADER = '--- CHAT RELEVANT RETRIEVED KNOWLEDGE ---';
const MEMORY_RETRIEVAL_HEADER = '--- CHAT PERSISTENT SUMMARIZED MEMORIES ---';

// Retrieved text kept on a message for the debug panels, when those are on.
const DEBUG_TEXT_LIMIT = 60000;

function capDebugText(text) {
    const value = String(text || '');
    return value.length > DEBUG_TEXT_LIMIT ? `${value.slice(0, DEBUG_TEXT_LIMIT)}\n[...debug text cut]` : value;
}

// A reply with no visible text is a failure; reporting it as success lets
// Regenerate delete the previous reply.
function emptyResponseError(finishReason, rawOutput) {
    const reason = String(finishReason || '').toLowerCase();
    const reasoned = /<think/i.test(String(rawOutput || ''));
    let message;
    if (['length', 'max_tokens', 'max_output_tokens'].includes(reason)) {
        message = reasoned
            ? 'The model spent its whole output budget reasoning and wrote no reply. Raise Max Tokens on the AI Profile and try again.'
            : 'The model reached its output limit before writing a visible reply. Raise Max Tokens on the AI Profile and try again.';
    } else if (reasoned) {
        message = 'The model returned reasoning but no reply. Try again, or raise Max Tokens on the AI Profile.';
    } else if (reason && !['stop', 'end_turn', 'stop_sequence'].includes(reason)) {
        message = `The provider returned no reply (${finishReason}). Nothing was saved.`;
    } else {
        message = 'The provider returned an empty reply. Nothing was saved, and the conversation is unchanged.';
    }
    const error = new Error(message);
    error.code = 'EMPTY_RESPONSE';
    return error;
}

// Widens archive hits to their neighbors in the same block; falls back to the hits alone.
function expandMemoryResults(results, chatId) {
    const list = Array.isArray(results) ? results : [];
    if (!list.length) return list;
    try {
        const blocks = loadMemoryBlockChunks(chatId, list.map(result => result.memoryBlockId));
        const { passages, unplaced } = buildNeighborPassages(list, blocks);
        return [...passages, ...unplaced];
    } catch (e) {
        console.warn('[RAG] Neighbor expansion failed:', e.message);
        return list;
    }
}

function pushRetrievalItems(items, results, section, origin) {
    const seen = new Set(items.filter(item => item.section === section).map(item => item.text));
    for (const result of results || []) {
        const text = String(result?.text || '');
        if (!text || seen.has(text)) continue;
        seen.add(text);
        items.push({ section, text, tier: 1, score: Number(result.fusionScore ?? result.score) || 0, origin });
    }
}

// Reasoning is kept for display but never sent back to a model.
function messageHistoryText(msg) {
    let content = stripReasoning(msg.content || '');
    if (msg.attachedFiles) {
        let files = [];
        try {
            files = typeof msg.attachedFiles === 'string'
                ? JSON.parse(msg.attachedFiles)
                : msg.attachedFiles;
        } catch (e) { }

        if (Array.isArray(files) && files.length > 0) {
            const fileMarkers = files.map(f => `File - ${f.name}`).join('\n');
            content = `${fileMarkers}\n${content}`;
        }
    }
    return content;
}

function selectActiveHistory(messages, maxTokensAllowed) {
    const { selected, tokens, dropped } = selectRecentWithinBudget(messages, maxTokensAllowed, {
        estimate: estimateTokens,
        overhead: PAYLOAD_BUDGET_CONTRACT.messageOverheadTokens,
        toText: messageHistoryText
    });
    // Unarchived, so no memory chunk can retrieve what is cut here.
    if (dropped > 0) {
        console.warn(`[Context] ${dropped} unarchived message(s) did not fit the payload budget and were not sent. Archiving them would keep them searchable.`);
    }
    return { history: selected.map(({ message, text }) => ({ role: message.role, content: text })), tokens, dropped };
}

function formatActiveHistory(messages, maxTokensAllowed) {
    return selectActiveHistory(messages, maxTokensAllowed).history;
}

// --- WORKFLOW RUNNER ---

// Live token streaming is on unless the user turned it off in Advanced settings.
function isStreamingEnabled() {
    try {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'advanced'").get();
        if (!row) return true;
        return JSON.parse(row.value).streaming !== false;
    } catch (e) {
        return true;
    }
}

async function runWorkflow({ chatId, messageContent, targetId, attachedFiles, historyEdit, regenerateMessageId, webContents }) {
    let resolvedTarget;
    try {
        resolvedTarget = resolveWorkspaceGenerationTarget(db, chatId, targetId);
    } catch (error) {
        webContents?.send('workflow-error', {
            chatId,
            runId: crypto.randomUUID(),
            step: 0,
            profileName: 'Generation',
            errorMessage: error.message,
            errorCode: error.code || 'invalid-generation-target',
            retryable: false,
            isWorkflow: false
        });
        return { success: false, error: error.message, errorCode: error.code };
    }
    if (activeRun) {
        cancelRun(activeRun);
    }

    const controller = new AbortController();
    const currentRun = {
        id: crypto.randomUUID(),
        chatId,
        isCancelled: false,
        controller: controller
    };
    activeRun = currentRun;
    let isWorkflow = false;

    try {
        const chat = resolvedTarget.chat;
        let steps = [];
        let totalSteps = 1;

        if (resolvedTarget.kind === 'workflow') {
            steps = JSON.parse(resolvedTarget.target.steps || '[]');
            totalSteps = steps.length;
            isWorkflow = true;
        } else {
            steps = [{ profileId: resolvedTarget.target.id, prompt: '', includeContext: true }];
        }

        if (steps.length === 0) {
            throw new Error("Target workflow contains no steps.");
        }

        const mediaExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.webm', '.mov', '.mp3', '.wav', '.ogg', '.flac'];
        const imageExtensions = ['.png', '.jpg', '.jpeg', '.gif', '.webp'];

        function isMedia(fileName) {
            const ext = path.extname(fileName).toLowerCase();
            return mediaExtensions.includes(ext);
        }

        function isImage(fileName) {
            const ext = path.extname(fileName).toLowerCase();
            return imageExtensions.includes(ext);
        }

        function isVideoOrAudio(fileName) {
            const ext = path.extname(fileName).toLowerCase();
            return ['.mp4', '.webm', '.mov', '.mp3', '.wav', '.ogg', '.flac'].includes(ext);
        }

        let attachmentsContext = '';
        const attachedImages = [];
        const updatedAttachedFiles = [];

        if (attachedFiles && attachedFiles.length > 0) {
            for (const file of attachedFiles) {
                try {
                    if (file.path && fs.existsSync(file.path)) {
                        if (isMedia(file.name)) {
                            const chatMediaDir = path.join(chatsDir, chatId, 'Media');
                            if (!fs.existsSync(chatMediaDir)) {
                                fs.mkdirSync(chatMediaDir, { recursive: true });
                            }
                            const chatFilesDir = path.join(chatsDir, chatId, 'Files');
                            if (!fs.existsSync(chatFilesDir)) {
                                fs.mkdirSync(chatFilesDir, { recursive: true });
                            }
                            const destMediaPath = path.join(chatMediaDir, file.name);
                            const destFilesPath = path.join(chatFilesDir, file.name);
                            fs.copyFileSync(file.path, destMediaPath);
                            fs.copyFileSync(file.path, destFilesPath);

                            updatedAttachedFiles.push({
                                name: file.name,
                                path: destFilesPath,
                                size: file.size
                            });

                            if (isImage(file.name)) {
                                attachedImages.push({
                                    name: file.name,
                                    path: destFilesPath
                                });
                            } else if (isVideoOrAudio(file.name)) {
                                const mediaType = ['.mp4', '.webm', '.mov'].includes(path.extname(file.name).toLowerCase()) ? 'Video' : 'Audio';
                                attachmentsContext += `\n[Attached ${mediaType}: ${file.name}]\n`;
                            }
                        } else {
                            const chatKbDir = path.join(chatsDir, chatId, 'KnowledgeBase');
                            if (!fs.existsSync(chatKbDir)) {
                                fs.mkdirSync(chatKbDir, { recursive: true });
                            }
                            const chatFilesDir = path.join(chatsDir, chatId, 'Files');
                            if (!fs.existsSync(chatFilesDir)) {
                                fs.mkdirSync(chatFilesDir, { recursive: true });
                            }

                            const destKbPath = path.join(chatKbDir, file.name);
                            const destFilesPath = path.join(chatFilesDir, file.name);
                            fs.copyFileSync(file.path, destKbPath);
                            fs.copyFileSync(file.path, destFilesPath);

                            updatedAttachedFiles.push({
                                name: file.name,
                                path: destKbPath,
                                size: file.size
                            });

                            const chunkCountRow = db.prepare('SELECT COUNT(*) as cnt FROM knowledge_chunks WHERE ownerId = ? AND ownerType = ? AND source = ?').get(chatId, 'chat_kb', file.name);
                            const hasChunks = chunkCountRow && chunkCountRow.cnt > 0;

                            if (!hasChunks) {
                                console.log(`[Workflow Runner] Auto-indexing text attachment to chat KB: ${file.name}`);
                                const fileContent = await extractTextFromFile(destKbPath);
                                let chunkSize = 500;
                                try {
                                    const rowAdvanced = db.prepare("SELECT value FROM settings WHERE key = 'advanced'").get();
                                    if (rowAdvanced) {
                                        const advanced = JSON.parse(rowAdvanced.value);
                                        chunkSize = parseInt(advanced.chunkSize, 10) || 500;
                                    }
                                } catch (e) { }

                                const chunks = chunkText(fileContent, chunkSize);
                                const vectors = await vectorizeChunks(chunks, file.name);
                                insertChunksToDb(chatId, 'chat_kb', vectors);
                            }

                            const chatRow = db.prepare('SELECT knowledgeFiles FROM chats WHERE id = ?').get(chatId);
                            let chatKnowledgeFiles = [];
                            if (chatRow && chatRow.knowledgeFiles) {
                                chatKnowledgeFiles = typeof chatRow.knowledgeFiles === 'string'
                                    ? JSON.parse(chatRow.knowledgeFiles)
                                    : (chatRow.knowledgeFiles || []);
                            }
                            if (!chatKnowledgeFiles.some(f => f.name === file.name)) {
                                chatKnowledgeFiles.push({
                                    name: file.name,
                                    internalPath: destKbPath,
                                    size: file.size,
                                    strategy: 'rag_search'
                                });
                                db.prepare('UPDATE chats SET knowledgeFiles = ? WHERE id = ?').run(JSON.stringify(chatKnowledgeFiles), chatId);
                            }

                            const fileContent = await extractTextFromFile(destKbPath);
                            attachmentsContext += `\n\n--- ATTACHED FILE: ${file.name} ---\n${fileContent}\n------------------\n`;
                        }
                    }
                } catch (e) {
                    console.error(`Error processing attached file ${file.name}:`, e);
                }
            }
        }

        try {
            const userMsg = db.prepare("SELECT * FROM messages WHERE chatId = ? AND role = 'user' ORDER BY createdAt DESC LIMIT 1").get(chatId);
            if (!historyEdit && userMsg && updatedAttachedFiles.length > 0) {
                db.prepare('UPDATE messages SET attachedFiles = ? WHERE id = ?').run(JSON.stringify(updatedAttachedFiles), userMsg.id);
            }
        } catch (e) {
            console.error("Error updating user message attachedFiles:", e);
        }

        const maxContextTokens = normalizeMaxApiPayload(chat?.maxContext);
        // Budgets measure prompts as the provider receives them, variables expanded.
        const resolveVariables = createPromptVariableResolver(db);
        const debugSettings = readAdvancedSettings();

        // The debug record is not read here: on older messages it can be very large.
        const persistedMessages = db.prepare('SELECT id, role, content, attachedFiles, excluded, createdAt FROM messages WHERE chatId = ? ORDER BY createdAt ASC').all(chatId);
        const messages = applyGenerationHistory(persistedMessages, { historyEdit, regenerateMessageId });
        // Live history is whatever no summary covers and the user has not muted,
        // so a gap left by a deleted summary comes back on its own.
        const activeMessages = selectActiveMessages(messages, chat?.memoryBlocks);

        let currentInput = messageContent;
        let finalOutput = '';
        let lastProfileUsed = null;
        let didStreamFinalResponse = false;

        let lastAgenticRagResponse = '';
        let lastAgenticRagContextGathered = '';
        let lastStandardRagDebug = '';
        let totalProfileKbTokens = 0;
        let totalChatKbTokens = 0;
        let totalChatHistoryTokens = 0;
        let totalMainInputTokens = 0;
        let totalAgenticInputTokens = 0;
        let totalAgenticOutputTokens = 0;
        let totalOutputTokens = 0;
        let historySent = 0;
        let historyDropped = 0;
        let retrievalOmitted = 0;
        let agenticDegraded = false;
        let lastAgenticTrajectory = null;
        let retrievalPath = '';
        let retrievalGateReason = '';
        let finalTruncated = false;
        let finalFinishReason = null;

        for (let i = 0; i < steps.length; i++) {
            if (currentRun.isCancelled) {
                console.log("Workflow run cancelled by user.");
                return { success: false, cancelled: true };
            }

            const step = steps[i];
            const includeChatContext = step.includeContext !== false;
            const includeChatHistory = step.includeChatHistory !== false;
            const profile = db.prepare('SELECT * FROM writing_profiles WHERE id = ?').get(step.profileId);
            if (!profile) {
                throw new Error(`Workflow step profile not found: ${step.profileId}`);
            }
            lastProfileUsed = profile;

            let profileKbTokens = 0;
            let chatKbTokens = 0;
            let chatHistoryTokens = 0;
            let agenticRagResponse = '';
            let agenticRagContextGathered = '';
            let standardRagDebug = '';
            let agenticInputTokens = 0;
            let agenticOutputTokens = 0;

            sendRunEvent(webContents, 'workflow-progress', currentRun, {
                step: i + 1,
                totalSteps,
                profileName: profile.name,
                status: 'Searching Context...'
            });

            // --- BUILD CONTEXT ---
            let compiledSystemPrompt = profile.systemPrompt || '';
            if (step.prompt) {
                compiledSystemPrompt += `\n\nAdditional Instruction: ${step.prompt}`;
            }

            let constantKnowledge = '';
            const knowledgeFiles = JSON.parse(profile.knowledgeFiles || '[]');

            for (const file of knowledgeFiles) {
                try {
                    if (file.enabled === false) continue;
                    if (!file.strategy || file.strategy === 'constant' || file.strategy === 'full_context') {
                        if (fs.existsSync(file.internalPath)) {
                            let fileContent = readEntireKbFile(profile.id, file.name);
                            if (fileContent.startsWith('[System: File not found')) {
                                fileContent = await extractTextFromFile(file.internalPath);
                            }
                            constantKnowledge += `\n\n--- KNOWLEDGE FILE: ${file.name} ---\n${fileContent}\n------------------\n`;
                            profileKbTokens += estimateTokens(fileContent);
                        }
                    }
                } catch (e) {
                    console.error(`Error reading constant file ${file.name}:`, e);
                }
            }

            try {
                const manualConstants = db.getConstantSnippets(profile.id);
                for (const mc of manualConstants) {
                    if (mc.enabled === false) continue;
                    const content = mc.content || '';
                    const title = mc.title || 'Custom Memory';
                    constantKnowledge += `\n\n--- KNOWLEDGE SNIPPET: ${title} ---\n${content}\n------------------\n`;
                    profileKbTokens += estimateTokens(content);
                }
            } catch (e) {
                console.error(`Error loading profile constant manual snippets:`, e);
            }

            if (includeChatContext && chat && chat.knowledgeFiles) {
                try {
                    const chatKbFiles = typeof chat.knowledgeFiles === 'string'
                        ? JSON.parse(chat.knowledgeFiles)
                        : (chat.knowledgeFiles || []);

                    for (const file of chatKbFiles) {
                        try {
                            if (file.enabled === false) continue;
                            if (!file.strategy || file.strategy === 'constant' || file.strategy === 'full_context') {
                                if (file.profiles && file.profiles.length > 0 && !file.profiles.includes(profile.id)) {
                                    continue;
                                }
                                if (fs.existsSync(file.internalPath)) {
                                    let fileContent = readEntireKbFile(chatId, file.name);
                                    if (fileContent.startsWith('[System: File not found')) {
                                        fileContent = await extractTextFromFile(file.internalPath);
                                    }
                                    constantKnowledge += `\n\n--- CHAT KNOWLEDGE FILE: ${file.name} ---\n${fileContent}\n------------------\n`;
                                    chatKbTokens += estimateTokens(fileContent);
                                }
                            }
                        } catch (e) {
                            console.error(`Error reading chat constant file ${file.name}:`, e);
                        }
                    }
                } catch (e) {
                    console.error(`Error parsing chat knowledgeFiles:`, e);
                }
            }

            if (includeChatContext && chat && chat.memoryBlocks) {
                try {
                    const snippets = typeof chat.memoryBlocks === 'string'
                        ? JSON.parse(chat.memoryBlocks)
                        : (chat.memoryBlocks || []);
                    const constantSnippets = snippets.filter(s => s.type === 'manual' && s.strategy === 'constant');
                    for (const s of constantSnippets) {
                        if (s.enabled === false) continue;
                        if (s.profiles && s.profiles.length > 0 && !s.profiles.includes(profile.id)) {
                            continue;
                        }
                        const content = s.summary || s.text || '';
                        const title = s.title || s.source || 'Custom Memory';
                        constantKnowledge += `\n\n--- CHAT KNOWLEDGE SNIPPET: ${title} ---\n${content}\n------------------\n`;
                        chatKbTokens += estimateTokens(content);
                    }
                } catch (e) {
                    console.error(`Error loading chat constant manual snippets:`, e);
                }
            }

            let contextBlock = '';
            if (constantKnowledge) {
                contextBlock += `\n\n--- CONSTANT CONTEXT SYSTEM BACKGROUND ---\n${constantKnowledge}\n`;
            }

            const attachmentsPayloadContext = attachmentsContext
                ? `\n\n--- ATTACHED FILES FOR CURRENT MESSAGE ---\n${attachmentsContext}\n`
                : '';
            const stepLimit = resolvePayloadLimit({ apiProfileId: profile.apiProfileId, maxPayloadTokens: maxContextTokens });
            const fixedPrompt = resolveVariables(compiledSystemPrompt + contextBlock + attachmentsPayloadContext);
            const fixedTokens = estimateTokens(fixedPrompt);
            const budgetInput = {
                maxPayloadTokens: stepLimit.limit,
                limitSource: stepLimit.source,
                newPrompt: resolveVariables(currentInput),
                attachedImageCount: i === 0 ? attachedImages.length : 0,
                outputTokens: getReservedOutputTokens({ maxTokens: profile.maxTokens })
            };
            // Only the fixed part can overflow on its own: retrieval and history are
            // sized below to whatever it leaves.
            assertPayloadWithinLimit({
                ...budgetInput,
                systemPrompt: fixedPrompt,
                breakdown: { fixed: fixedTokens, retrieved: 0, history: 0 }
            });

            // History is measured first so retrieval cannot push the conversation out.
            const availableForContext = getAvailableHistoryTokens({ ...budgetInput, systemPrompt: fixedPrompt });
            let historySource = [];
            if (i === 0 || includeChatHistory) {
                historySource = activeMessages;
                if (i === 0) {
                    const last = activeMessages[activeMessages.length - 1];
                    if (last && last.role === 'user') {
                        historySource = activeMessages.slice(0, -1);
                    }
                }
            }
            const historyNeed = selectRecentWithinBudget(historySource, availableForContext, {
                estimate: estimateTokens,
                overhead: PAYLOAD_BUDGET_CONTRACT.messageOverheadTokens,
                toText: messageHistoryText
            }).tokens;
            const retrievalBudget = splitRetrievalBudget({ availableTokens: availableForContext, historyTokens: historyNeed });

            const retrievalPlanner = getRoleExecutor(ROLE_IDS.RETRIEVAL_PLANNER, profile);
            const plannerAvailable = profile.isAgentic === 1 && Boolean(retrievalPlanner.executor);
            // The user's own message decides, not the step input: from step 2 on that input is
            // generated prose, which says nothing about whether this turn needs research.
            const plannerGate = plannerAvailable
                ? resolvePlannerGate(chatId, messageContent || currentInput, {
                    includeChatContext,
                    force: String(debugSettings.agenticGate || 'auto') === 'always'
                })
                : { plan: false, reason: 'profile is not agentic, or no Retrieval Planner is configured' };
            if (plannerAvailable) {
                retrievalPath = plannerGate.plan ? 'agentic' : 'deterministic';
                retrievalGateReason = plannerGate.reason;
                console.log(`[Agentic RAG] Gate: ${retrievalPath} (${plannerGate.reason})`);
            }
            if (plannerGate.plan) {
                let ragChatHistory = [];
                if (i === 0 || includeChatHistory) {
                    // The planner reads this history, so its own window sizes it, not the writer's.
                    const plannerLimit = resolvePayloadLimit({ apiProfileId: retrievalPlanner.executor.apiProfileId, maxPayloadTokens: maxContextTokens });
                    ragChatHistory = formatActiveHistory(
                        activeMessages.slice(-10),
                        plannerWindowShape(plannerLimit.limit).historyTokens
                    );
                }

                const agenticResult = await executeAgenticRagLoop(profile, chatId, currentInput, ragChatHistory, webContents, includeChatContext, retrievalPlanner.executor, currentRun, {
                    retrievalBudget,
                    userRequest: messageContent,
                    knownEntities: plannerGate.entities,
                    mentionedIds: plannerGate.mentionedIds,
                    toolProtocol: String(debugSettings.agenticToolProtocol || 'auto') === 'text' ? 'text' : 'auto'
                });
                if (agenticResult) {
                    const packed = packContextItems(agenticResult.contextItems, retrievalBudget, {
                        estimate: estimateTokens,
                        maxItemShare: AGENTIC_ITEM_MAX_SHARE
                    });
                    retrievalOmitted += packed.dropped + packed.truncated;
                    if (agenticResult.degraded) agenticDegraded = true;
                    // The ids are for the evaluation harness; the message record keeps only counts.
                    lastAgenticTrajectory = {
                        anchorQuery: agenticResult.trajectory.anchorQuery,
                        toolK: agenticResult.trajectory.toolK,
                        protocol: agenticResult.trajectory.protocol,
                        finalProtocol: agenticResult.trajectory.finalProtocol,
                        protocolFallback: agenticResult.trajectory.protocolFallback,
                        stopped: agenticResult.trajectory.stopped,
                        plannerWindow: agenticResult.trajectory.plannerWindow,
                        gate: { path: 'agentic', reason: plannerGate.reason },
                        seed: agenticResult.trajectory.seed
                            ? { calls: agenticResult.trajectory.seed.calls, items: agenticResult.trajectory.seed.items }
                            : null,
                        turns: agenticResult.trajectory.turns.map(({ newIds, ...turn }) => turn),
                        packing: { kept: packed.kept.length, dropped: packed.dropped, truncated: packed.truncated, total: packed.total, budget: retrievalBudget }
                    };
                    const gathered = renderContextSections(packed.kept, agenticResult.contextSections);
                    // Never pass the agent's summary off as facts; an explicit notice keeps
                    // the model from inventing document-based answers.
                    const noContextNotice = packed.total > 0
                        ? `--- RAG NOTICE ---\nThe retrieved context did not fit this request's payload budget and was left out. Answer using only the conversation and the user's instructions; do not fabricate document-based facts.`
                        : `--- RAG NOTICE ---\nNo relevant context was retrieved from the knowledge base or memory for this request. Answer using only the conversation and the user's instructions; do not fabricate document-based facts.`;
                    contextBlock += `\n\n${gathered ? `--- DETAILED RESEARCH CONTEXT ---\n${gathered}` : noContextNotice}\n`;

                    if (!gathered) profileKbTokens += estimateTokens(noContextNotice);
                    for (const item of packed.kept) {
                        if (item.origin === 'profile') profileKbTokens += item.tokens;
                        else chatKbTokens += item.tokens;
                    }

                    agenticRagResponse = agenticResult.agenticResponse;
                    agenticRagContextGathered = gathered;
                    agenticInputTokens = agenticResult.agenticInputTokens || 0;
                    agenticOutputTokens = agenticResult.agenticOutputTokens || 0;
                }
            } else {
                if (plannerAvailable) {
                    lastAgenticTrajectory = { gate: { path: 'deterministic', reason: plannerGate.reason }, turns: [] };
                }
                const retrievalItems = [];
                let searchQuery = currentInput;
                // Profile knowledge, workspace files and archived memory share the budget.
                const topK = retrievalTopK(0, retrievalBudget, { tiers: RETRIEVAL_TIERS });
                const results = await searchKnowledgeBase(searchQuery, profile.id, { k: topK });
                standardRagDebug += formatRagDebugSection('PROFILE KB', results);
                if (results && results.length > 0) {
                    let constantSnippetTitles = [];
                    try {
                        constantSnippetTitles = db.getConstantSnippets(profile.id)
                            .map(c => (c.title || '').toLowerCase());
                    } catch (e) { }

                    const profileResults = results.filter(r => {
                        const fileMatch = knowledgeFiles.find(f => f.name.toLowerCase() === r.source.toLowerCase());
                        if (fileMatch && (fileMatch.strategy === 'constant' || fileMatch.strategy === 'full_context')) {
                            return false;
                        }
                        if (constantSnippetTitles.includes(r.source.toLowerCase())) {
                            return false;
                        }
                        return true;
                    });
                    pushRetrievalItems(retrievalItems, profileResults, PROFILE_RETRIEVAL_HEADER, 'profile');
                }

                if (includeChatContext && chat) {
                    const chatKbResults = await searchChatKnowledgeBase(currentInput, chatId, { k: topK });
                    if (chatKbResults && chatKbResults.length > 0) {
                        const chatKbFiles = typeof chat.knowledgeFiles === 'string'
                            ? JSON.parse(chat.knowledgeFiles)
                            : (chat.knowledgeFiles || []);
                        pushRetrievalItems(
                            retrievalItems,
                            filterWorkspaceKnowledgeResults(chatKbResults, chatKbFiles, profile.id),
                            CHAT_RETRIEVAL_HEADER,
                            'chat'
                        );
                    }
                    standardRagDebug += formatRagDebugSection('CHAT KB', chatKbResults);
                }

                if (includeChatContext && chat) {
                    const memoryResults = await searchChatMemories(currentInput, chatId, { k: topK });
                    if (memoryResults && memoryResults.length > 0) {
                        const blocksList = typeof chat.memoryBlocks === 'string'
                            ? JSON.parse(chat.memoryBlocks)
                            : (chat.memoryBlocks || []);
                        pushRetrievalItems(
                            retrievalItems,
                            expandMemoryResults(filterWorkspaceMemoryResults(memoryResults, blocksList, profile.id), chatId),
                            MEMORY_RETRIEVAL_HEADER,
                            'chat'
                        );
                    }
                    standardRagDebug += formatRagDebugSection('CHAT MEMORY', memoryResults);
                }

                const packed = packContextItems(retrievalItems, retrievalBudget, { estimate: estimateTokens });
                retrievalOmitted += packed.dropped + packed.truncated;
                for (const section of [PROFILE_RETRIEVAL_HEADER, CHAT_RETRIEVAL_HEADER, MEMORY_RETRIEVAL_HEADER]) {
                    const texts = packed.kept.filter(item => item.section === section).map(item => item.text);
                    if (texts.length === 0) continue;
                    contextBlock += `\n\n${section}\n${texts.join('\n\n')}\n`;
                    const sectionTokens = estimateTokens(texts.join('\n\n'));
                    if (section === PROFILE_RETRIEVAL_HEADER) profileKbTokens += sectionTokens;
                    else chatKbTokens += sectionTokens;
                }
            }
            if (attachmentsContext) {
                contextBlock += `\n\n--- ATTACHED FILES FOR CURRENT MESSAGE ---\n${attachmentsContext}\n`;
            }

            if (contextBlock) {
                compiledSystemPrompt += contextBlock;
            }

            const inputTokens = estimateTokens(currentInput);
            const systemTokens = estimateTokens(compiledSystemPrompt);
            const measuredSystemPrompt = resolveVariables(compiledSystemPrompt);
            // Measured against the prompt actually sent, so the request always fits.
            const remainingTokens = getAvailableHistoryTokens({ ...budgetInput, systemPrompt: measuredSystemPrompt });

            let chatHistory = [];
            if (i === 0 || includeChatHistory) {
                const selection = selectActiveHistory(historySource, remainingTokens);
                chatHistory = selection.history;
                historySent = Math.max(historySent, chatHistory.length);
                historyDropped = Math.max(historyDropped, selection.dropped);
            }

            let historyMessagesTokens = 0;
            chatHistory.forEach(msg => {
                historyMessagesTokens += estimateTokens(msg.content);
            });
            chatHistoryTokens += historyMessagesTokens;
            const totalInputTokens = systemTokens + inputTokens + historyMessagesTokens;
            const payloadBreakdown = {
                fixed: fixedTokens,
                retrieved: Math.max(0, estimateTokens(measuredSystemPrompt) - fixedTokens),
                history: historyMessagesTokens
            };

            let success = false;
            let stepOutput = '';
            let stepTruncated = false;
            let stepFinishReason = null;

            while (!success) {
                if (currentRun.isCancelled) {
                    return { success: false, cancelled: true };
                }

                sendRunEvent(webContents, 'workflow-progress', currentRun, {
                    step: i + 1,
                    totalSteps,
                    profileName: profile.name,
                    status: 'Thinking...'
                });

                try {
                    const genParams = {
                        apiProfileId: profile.apiProfileId,
                        model: profile.model,
                        systemPrompt: compiledSystemPrompt,
                        chatHistory,
                        newPrompt: currentInput,
                        temperature: profile.temperature,
                        maxTokens: profile.maxTokens,
                        maxPayloadTokens: maxContextTokens,
                        payloadBreakdown,
                        includeResponseMetadata: true,
                        manualMode: profile.manualMode === 1,
                        manualJson: profile.manualJson,
                        abortSignal: currentRun.controller.signal,
                        attachedImages: (i === 0 ? attachedImages : [])
                    };

                    // Only the final, user-facing generation streams; intermediate
                    // workflow steps are plumbing and stay non-streaming.
                    let result;
                    if ((i === steps.length - 1) && isStreamingEnabled()) {
                        result = await sendApiRequestStream(
                            genParams,
                            (delta) => {
                                sendRunEvent(webContents, 'stream:token', currentRun, {
                                    contentDelta: delta.contentDelta || '',
                                    reasoningDelta: delta.reasoningDelta || ''
                                });
                            },
                            () => {
                                didStreamFinalResponse = true;
                            });
                        if (currentRun.isCancelled) {
                            return { success: false, cancelled: true };
                        }
                    } else {
                        result = await sendApiRequest(genParams);
                    }
                    stepOutput = typeof result === 'string' ? result : String(result?.content || '');
                    if (!stripReasoning(stepOutput).trim()) {
                        throw emptyResponseError(result?.finishReason, stepOutput);
                    }
                    stepTruncated = Boolean(result?.truncated);
                    stepFinishReason = result?.finishReason ?? null;
                    success = true;
                } catch (apiError) {
                    if (apiError.name === 'AbortError' || currentRun.isCancelled) {
                        return { success: false, cancelled: true };
                    }
                    console.error(`API Error in step ${i + 1} (${profile.name}):`, apiError);

                    // Retrying a request that failed the payload check sends the same
                    // payload again, so that error only offers to close.
                    sendRunEvent(webContents, 'workflow-error', currentRun, {
                        step: i + 1,
                        profileName: profile.name,
                        errorMessage: apiError.message || 'API request failed.',
                        retryable: apiError.retryable !== false && apiError.code !== 'MAX_API_PAYLOAD_EXCEEDED',
                        isWorkflow: isWorkflow
                    });

                    const decision = await new Promise((resolve) => {
                        errorDeferred = { runId: currentRun.id, resolve };
                    });

                    if (decision === 'interrupt') {
                        if (i > 0) {
                            const partialMsgId = 'msg_' + Math.random().toString(36).substr(2, 9);
                            db.prepare(`
                                INSERT INTO messages (id, chatId, role, content, aiName, aiColor, debugNotice, attachedFiles, createdAt)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                            `).run(
                                partialMsgId,
                                chatId,
                                'ai',
                                `[Workflow execution interrupted at step ${i + 1} (${profile.name})]. Last successful output:\n\n${currentInput}`,
                                lastProfileUsed.name,
                                lastProfileUsed.color,
                                'interrupted',
                                JSON.stringify([]),
                                Date.now()
                            );
                        }
                        return { success: false, interrupted: true };
                    } else if (decision === 'skip') {
                        stepOutput = currentInput;
                        success = true;
                    } else if (decision === 'retry') {
                        // Loop retries sendApiRequest
                    }
                }
            }

            const isLastStep = (i === steps.length - 1);
            if (estimateTokens(stripReasoning(stepOutput)) > 4000 && !isLastStep) {
                sendRunEvent(webContents, 'workflow-context-overflow', currentRun, {
                    step: i + 1,
                    profileName: profile.name,
                    outputText: stepOutput
                });

                const overflowResponse = await new Promise((resolve) => {
                    overflowDeferred = { runId: currentRun.id, resolve };
                });

                if (overflowResponse.decision === 'send_edited') {
                    stepOutput = overflowResponse.editedText;
                }
            }

            // The next step reads the reply, not the reasoning behind it.
            currentInput = stripReasoning(stepOutput);
            finalOutput = stepOutput;
            if (isLastStep) {
                finalTruncated = stepTruncated;
                finalFinishReason = stepFinishReason;
            }

            lastAgenticRagResponse = agenticRagResponse;
            lastAgenticRagContextGathered = agenticRagContextGathered;
            if (standardRagDebug) lastStandardRagDebug = standardRagDebug;

            totalProfileKbTokens += profileKbTokens;
            totalChatKbTokens += chatKbTokens;
            totalChatHistoryTokens += chatHistoryTokens;
            totalMainInputTokens += totalInputTokens;
            totalAgenticInputTokens += agenticInputTokens;
            totalAgenticOutputTokens += agenticOutputTokens;
            totalOutputTokens += estimateTokens(stepOutput);
        }

        throwIfRunCancelled(currentRun);
        if (finalOutput && lastProfileUsed) {
            const aiMsgId = 'msg_' + Math.random().toString(36).substr(2, 9);

            // Stored on every AI message and read per visible message: keep it small.
            const debugObj = {
                workflowStatus: isWorkflow ? `Workflow complete (${steps.length} steps)` : '',
                ...(debugSettings.agenticDebug ? {
                    agenticRagResponse: capDebugText(lastAgenticRagResponse),
                    agenticRagContextGathered: capDebugText(lastAgenticRagContextGathered),
                    ...(lastAgenticTrajectory ? { agenticTrajectory: lastAgenticTrajectory } : {})
                } : {}),
                ...(debugSettings.ragDebug ? { standardRagContextGathered: capDebugText(lastStandardRagDebug) } : {}),
                context: { historySent, historyDropped, retrievalOmitted, agenticDegraded, retrievalPath, retrievalGateReason },
                ...(finalTruncated ? { truncated: true, finishReason: finalFinishReason } : {}),
                tokens: {
                    knowledgeBase: totalProfileKbTokens + totalChatKbTokens,
                    profileKb: totalProfileKbTokens,
                    chatKb: totalChatKbTokens,
                    chatHistory: totalChatHistoryTokens,
                    totalInput: totalMainInputTokens,
                    output: totalOutputTokens,
                    agenticInput: totalAgenticInputTokens,
                    agenticOutput: totalAgenticOutputTokens
                }
            };

            db.prepare(`
                INSERT INTO messages (id, chatId, role, content, aiName, aiColor, debugNotice, attachedFiles, createdAt)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
                aiMsgId,
                chatId,
                'ai',
                finalOutput,
                lastProfileUsed.name,
                lastProfileUsed.color,
                JSON.stringify(debugObj),
                JSON.stringify([]),
                Date.now()
            );

            db.prepare('UPDATE chats SET updatedAt = ? WHERE id = ?').run(Date.now(), chatId);

            checkAndAutoSummarize(chatId, lastProfileUsed.id).catch(e => {
                console.error("[Auto-Summarize] error:", e);
            });

            return { success: true, aiMsgId, streamed: didStreamFinalResponse };
        }

        // Every step either produced text or raised an error above; this only keeps an
        // empty result from ever being reported as success.
        sendRunEvent(webContents, 'workflow-error', currentRun, {
            step: steps.length,
            profileName: lastProfileUsed?.name || 'Generation',
            errorMessage: 'The provider returned an empty reply. Nothing was saved, and the conversation is unchanged.',
            retryable: false,
            isWorkflow: isWorkflow
        });
        return { success: false, error: 'empty-response' };

    } catch (e) {
        if (e.name === 'AbortError' || currentRun.isCancelled) {
            return { success: false, cancelled: true };
        }
        console.error("Workflow Execution Failure:", e);
        sendRunEvent(webContents, 'workflow-error', currentRun, {
            step: 0,
            profileName: 'Workflow Engine',
            errorMessage: e.message || 'Fatal error during workflow execution.',
            retryable: false,
            isWorkflow: isWorkflow
        });
        return { success: false, error: e.message };
    } finally {
        if (activeRun === currentRun) activeRun = null;
        if (errorDeferred?.runId === currentRun.id) errorDeferred = null;
        if (overflowDeferred?.runId === currentRun.id) overflowDeferred = null;
    }
}

function cancelGeneration() {
    cancelRun(activeRun);
}

function resolveErrorDeferred(decision, runId = null) {
    if (errorDeferred && (!runId || errorDeferred.runId === runId)) {
        errorDeferred.resolve(decision);
        errorDeferred = null;
    }
}

function resolveOverflowDeferred(decision, editedText, runId = null) {
    if (overflowDeferred && (!runId || overflowDeferred.runId === runId)) {
        overflowDeferred.resolve({ decision, editedText });
        overflowDeferred = null;
    }
}

// --- HYBRID SEARCH Fallback / Helpers ---

// The designated System AI (api profile + model) for background tasks, read from
// global settings. Both fields are required so a provider never picks a default model.
function getLegacySystemAiConfiguration() {
    try {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'advanced'").get();
        const advanced = row ? JSON.parse(row.value) : {};
        const apiProfileId = String(advanced.systemApiProfileId || '').trim();
        const model = String(advanced.systemModelName || '').trim();

        if (!apiProfileId) {
            return { systemAi: null, error: 'System AI needs an API Connection. Select one in Settings → Engine & Memory.' };
        }
        if (!model) {
            return { systemAi: null, error: 'System AI needs a model for the selected API Connection. Select one in Settings → Engine & Memory.' };
        }

        const apiProfile = db.prepare('SELECT id, models FROM api_profiles WHERE id = ?').get(apiProfileId);
        if (!apiProfile) {
            return { systemAi: null, error: 'The selected System AI connection is no longer available. Choose another API Connection in Settings → Engine & Memory.' };
        }

        let models = [];
        try { models = typeof apiProfile.models === 'string' ? JSON.parse(apiProfile.models) : (apiProfile.models || []); } catch (e) { models = []; }
        if (Array.isArray(models) && models.length && !models.includes(model)) {
            return { systemAi: null, error: 'The selected System AI model is no longer available on this API Connection. Choose a model in Settings → Engine & Memory.' };
        }

        return { systemAi: { apiProfileId, model }, error: null };
    } catch (e) {
        return { systemAi: null, error: 'System AI settings could not be read. Open Settings → Engine & Memory and select an API Connection and model again.' };
    }
}

function getSystemAiConfiguration() {
    const resolved = resolveAiEngineRole(ROLE_IDS.SYSTEM);
    return { systemAi: resolved.executor, error: resolved.error };
}

function entityEvidenceExcerpt(text, entityName, limit = 500) {
    const source = String(text || '').trim();
    if (source.length <= limit) return source;
    const index = source.toLowerCase().indexOf(String(entityName || '').toLowerCase());
    const start = Math.max(0, (index === -1 ? 0 : index) - Math.floor(limit * 0.3));
    const excerpt = source.slice(start, start + limit).trim();
    return `${start > 0 ? '…' : ''}${excerpt}${start + limit < source.length ? '…' : ''}`;
}

function getSystemAi() {
    return getSystemAiConfiguration().systemAi;
}

function getRoleExecutor(roleId, profile = null) {
    return resolveAiEngineRole(roleId, { profile });
}

// Deterministic choice between the planner and the free retrieval path. It can only
// downgrade to the deterministic path, which still fills the context, so a wrong skip
// costs the multi-hop reach and never the context itself.
function resolvePlannerGate(chatId, request, { includeChatContext = true, force = false } = {}) {
    let entities = [];
    try {
        entities = includeChatContext ? entitiesStore.listEntities({ workspaceId: chatId }) : [];
    } catch (e) { entities = []; }
    const mentionedIds = entityMentionIds(request, entities);
    const decision = shouldRunPlanner(request, { entityMentions: mentionedIds.size, force });
    return { ...decision, entities, mentionedIds };
}

function isChatArchiveSummarizationEnabled() {
    return readAdvancedSettings().archiveSummarization !== false;
}

function getSystemLanguageInstruction() {
    const language = String(readAdvancedSettings().systemOutputLanguage || 'English').trim() || 'English';
    return `Write all generated natural-language content in ${language}. Never translate or transliterate proper nouns, canonical names, titles used as names, identifiers, JSON keys, enum values, control markers, or verbatim evidence. Keep each of them exactly as supplied.`;
}

// Lets the classifier reuse canonical names instead of coining variants.
function buildEntityVocab(workspaceId, sourceText = '') {
    if (!workspaceId) return '';
    let rows = [];
    try { rows = db.prepare('SELECT type, canonicalName, aliases FROM entities WHERE workspaceId IS ?').all(workspaceId); } catch (e) { return ''; }
    if (!rows.length) return '';
    const byType = new Map();
    const normalizedSource = foldText(sourceText);
    for (const r of rows) {
        let aliases = [];
        try { const a = JSON.parse(r.aliases); if (Array.isArray(a)) aliases = a; } catch (e) { }
        if (normalizedSource) {
            const names = [r.canonicalName, ...aliases].map(foldText).filter(Boolean);
            if (!names.some(name => normalizedSource.includes(name))) continue;
        }
        const label = aliases.length ? `${r.canonicalName} [aka ${aliases.join(', ')}]` : r.canonicalName;
        if (!byType.has(r.type)) byType.set(r.type, []);
        byType.get(r.type).push(label);
    }
    const lines = [];
    for (const [type, names] of byType) lines.push(`${type}: ${names.join('; ')}`);
    return "Known entities (prefer these canonical names; map any variant or title to the canonical form):\n" + lines.join('\n');
}

function resolveEntity(workspaceId, type, value) {
    return entitiesStore.resolveMention(value, type, workspaceId) || null;
}

// Provider errors often arrive as a JSON string; unwrap to readable text.
function cleanErrorMessage(error) {
    let msg = (error && error.message) ? error.message : String(error || 'Unknown error');
    const brace = msg.indexOf('{');
    if (brace !== -1) {
        try {
            const parsed = JSON.parse(msg.slice(brace));
            const inner = parsed && (parsed.error?.message || parsed.message || parsed.error);
            if (typeof inner === 'string' && inner.trim()) return inner.trim();
        } catch (e) { /* not JSON: fall through to the raw message */ }
    }
    return msg;
}

// Tagging never blocks the caller, so a failure must be announced or it looks like
// it ran. The renderer dedupes the toast; every window, as the main one isn't index 0.
function notifyTaggingFailure(error) {
    try {
        const { BrowserWindow } = require('electron');
        const payload = { error: cleanErrorMessage(error) };
        for (const win of BrowserWindow.getAllWindows()) {
            if (win && !win.isDestroyed()) {
                win.webContents.send('world-index-tagging-failed', payload);
            }
        }
    } catch (e) { /* no window (headless/tests): nothing to notify */ }
}

async function sendTaggerRequest(payload, tries = 5) {
    let delay = 2000;
    for (let attempt = 1; attempt <= tries; attempt++) {
        try {
            return await sendApiRequest(payload);
        } catch (e) {
            const msg = String((e && e.message) || e);
            const rateLimited = /too many requests|rate.?limit|429|throttl/i.test(msg);
            if (attempt === tries || !rateLimited) throw e;
            await new Promise(resolve => setTimeout(resolve, delay));
            delay = Math.min(delay * 2, 30000);
        }
    }
}

// Names first, without a model; then the Tagger only for what names cannot settle.
// Every chunk ends completed or failed in world_index_chunk_status, with its real tag count.
// notify:false is for callers that report the failure themselves.
async function tagChunkRecords(records, workspaceId, { runId = null, onProgress = null, notify = true, matcher = null } = {}) {
    const list = (Array.isArray(records) ? records : []).filter(record => record && record.id);
    const result = { taggedRecords: [], failedRecords: [], nameRows: 0, modelRows: 0, error: null, failed: false, skipped: false };
    if (!list.length) return result;

    const names = workspaceId ? (matcher || createNameMatcher(db, workspaceId)) : { empty: true, entities: [] };
    const found = applyNameTags(db, workspaceId, list, { matcher: names });
    result.nameRows = found.rows;

    const tagger = getRoleExecutor(ROLE_IDS.TAGGER);
    if (!tagger.executor) {
        if (onProgress) onProgress(list.length, list.length);
        if (!tagger.error) return { ...result, skipped: true };
        saveChunkStatus(db, list, 'failed', { runId, error: tagger.error });
        if (notify) notifyTaggingFailure(new Error(tagger.error));
        return { ...result, failedRecords: list, error: tagger.error, failed: true };
    }

    let categories = [];
    try { categories = db.prepare('SELECT name, description FROM tags WHERE isEntity = 1').all(); } catch (e) { categories = []; }
    const labels = new Map((names.entities || []).map(entity => [entity.id, entity.canonicalName]));
    const hints = new Map([...found.detected].map(([id, mentions]) => [id, mentions.map(mention => labels.get(mention.entityId)).filter(Boolean)]));
    const candidates = new Map(names.empty ? [] : list.map(record => [record.id,
        findCandidateMentions(record.text, names.index, { lowercaseWords: names.lowercaseWords })
            .map(candidate => `${candidate.surface} -> ${candidate.entities.map(entity => `${labels.get(entity.entityId)} (${entity.type})`).join(' or ')}`)]));
    const { apiProfileId, model } = tagger.executor;
    const outcome = await runModelTagger({
        records: list,
        detected: hints,
        candidates,
        categories,
        vocabFor: text => buildEntityVocab(workspaceId, text),
        languageInstruction: getSystemLanguageInstruction(),
        send: payload => sendTaggerRequest({ apiProfileId, model, chatHistory: [], manualMode: false, manualJson: null, ...payload }),
        onProgress
    });

    const applied = applyChunkTags(outcome.chunkTags, list, workspaceId, { lowercaseWords: names.lowercaseWords });
    result.modelRows = applied.rows;
    if (applied.created.length && workspaceId) refreshWorkspaceNameTags(db, workspaceId, { entityIds: applied.created });

    result.taggedRecords = list.filter(record => outcome.outcomes.get(record.id)?.status === 'completed');
    result.failedRecords = list.filter(record => outcome.outcomes.get(record.id)?.status !== 'completed');
    const rejected = new Map(result.taggedRecords.map(record => [record.id, outcome.outcomes.get(record.id).rejected]));
    saveChunkStatus(db, result.taggedRecords, 'completed', { runId, rejected });
    const byError = new Map();
    for (const record of result.failedRecords) {
        const error = cleanErrorMessage(outcome.outcomes.get(record.id)?.error || 'The Tagger could not process this passage.');
        if (!byError.has(error)) byError.set(error, []);
        byError.get(error).push(record);
    }
    for (const [error, failed] of byError) saveChunkStatus(db, failed, 'failed', { runId, error });
    if (byError.size) {
        result.error = [...byError.keys()][0];
        result.failed = true;
        console.error(`[Tagger] ${result.failedRecords.length}/${list.length} passage(s) failed: ${result.error}`);
        if (notify) notifyTaggingFailure(new Error(result.error));
    }
    return result;
}

// Fenced so a story-tuned model describes the transcript instead of continuing it.
const ARCHIVE_FENCE_OPEN = '<<<TRANSCRIPT';
const ARCHIVE_FENCE_CLOSE = 'END TRANSCRIPT>>>';

// Headings, rules and role prefixes mean the model has started narrating.
function trimArchiveRecap(text) {
    const lines = String(text || '').trim().split('\n');
    const kept = [];
    for (const line of lines) {
        const trimmed = line.trim();
        if (/^#{1,6}\s/.test(trimmed)) break;
        if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) break;
        if (/^(USER|ASSISTANT|SYSTEM)\s*:/i.test(trimmed)) break;
        kept.push(line);
    }
    return kept.join('\n').trim();
}

// A transcript-sized recap is worse than none.
function isUsableRecap(text) {
    const value = String(text || '').trim();
    return value.length >= 2 && value.length <= 1200;
}

// Room for the fence, the instruction line and message framing around a segment.
const ARCHIVE_PROMPT_OVERHEAD_TOKENS = 200;
const ARCHIVE_RECAP_TOKENS = 500;

function workspacePayloadLimit(chatId) {
    try {
        return normalizeMaxApiPayload(db.prepare('SELECT maxContext FROM chats WHERE id = ?').get(chatId)?.maxContext);
    } catch (e) {
        return normalizeMaxApiPayload(null);
    }
}

// An entry larger than a whole segment is cut to fit, not dropped.
function segmentTranscript(entries, budgetTokens) {
    const segments = [];
    let current = [];
    let used = 0;
    for (const entry of entries) {
        const text = estimateTokens(entry) > budgetTokens ? truncateToTokens(entry, budgetTokens, estimateTokens) : entry;
        const cost = estimateTokens(text) + PAYLOAD_BUDGET_CONTRACT.messageOverheadTokens;
        if (current.length && used + cost > budgetTokens) {
            segments.push(current.join('\n\n'));
            current = [];
            used = 0;
        }
        current.push(text);
        used += cost;
    }
    if (current.length) segments.push(current.join('\n\n'));
    return segments;
}

// Oversized archives are summarized per segment, then the cards are merged.
async function summarizeArchiveSegment(transcript, { maxPayloadTokens = null } = {}) {
    const summarizer = getRoleExecutor(ROLE_IDS.SUMMARIZER);
    if (!summarizer.executor) return { title: 'Chat Archive', summary: '', skipped: true, error: summarizer.error };

    const systemPrompt =
        `${getSystemLanguageInstruction()}\n` +
        'You write a short archive card describing a conversation that has already happened. ' +
        'The material between the transcript markers is a record to describe, never a scene to continue. ' +
        'Never answer it, never roleplay, and never write in any character voice.\n' +
        'Reply with exactly two lines and nothing else:\n' +
        'TITLE: <concise 3-word title>\n' +
        '<two sentences of plain prose covering the consequential facts, decisions, changes, and unresolved threads>\n' +
        'No headings, no lists, no markdown, no transcript excerpts, and no invented details.';

    const limit = resolvePayloadLimit({
        apiProfileId: summarizer.executor.apiProfileId,
        maxPayloadTokens: normalizeMaxApiPayload(maxPayloadTokens)
    }).limit;
    const segmentBudget = Math.max(
        1024,
        limit - estimateTokens(systemPrompt) - ARCHIVE_RECAP_TOKENS - safetyMarginFor(limit) - ARCHIVE_PROMPT_OVERHEAD_TOKENS
    );
    const entries = (Array.isArray(transcript) ? transcript : [String(transcript || '')])
        .filter(entry => String(entry || '').trim());
    const segments = segmentTranscript(entries, segmentBudget);

    const request = (text, { correction = false, instruction = 'Write the archive card for the transcript above.' } = {}) => sendApiRequest({
        ...summarizer.executor,
        systemPrompt: correction
            ? `${systemPrompt}\nCORRECTION: your previous reply was not an archive card. Return only the TITLE line and two sentences.`
            : systemPrompt,
        chatHistory: [],
        newPrompt: `${ARCHIVE_FENCE_OPEN}\n${text}\n${ARCHIVE_FENCE_CLOSE}\n\n${instruction}`,
        temperature: 0.1,
        maxTokens: ARCHIVE_RECAP_TOKENS,
        maxPayloadTokens: limit,
        manualMode: false,
        manualJson: null
    });

    const read = (response) => {
        const lines = String(response || '').trim().split('\n');
        const hasTitle = lines[0] ? lines[0].toUpperCase().startsWith('TITLE:') : false;
        return {
            title: hasTitle ? lines[0].slice(6).trim() || 'Chat Archive' : 'Chat Archive',
            summary: trimArchiveRecap((hasTitle ? lines.slice(1) : lines).join('\n')),
            hasTitle
        };
    };

    const cardFor = async (text, instruction) => {
        let card = read(await request(text, { instruction }));
        if (!card.hasTitle || !isUsableRecap(card.summary)) {
            const retry = read(await request(text, { correction: true, instruction }));
            if (isUsableRecap(retry.summary)) card = retry;
        }
        return card;
    };

    let parsed;
    if (segments.length <= 1) {
        parsed = await cardFor(segments[0] || '');
    } else {
        const cards = [];
        for (const segment of segments) {
            const card = await cardFor(segment);
            if (isUsableRecap(card.summary)) cards.push(card);
        }
        if (!cards.length) return { title: 'Chat Archive', summary: '' };
        const parts = cards.map((card, index) => `PART ${index + 1}: ${card.title}\n${card.summary}`).join('\n\n');
        parsed = await cardFor(
            parts,
            'The transcript above lists archive cards for consecutive parts of one conversation. Write one archive card that covers all of them.'
        );
        if (!isUsableRecap(parsed.summary)) parsed = cards[cards.length - 1];
    }

    return {
        title: parsed.title,
        summary: isUsableRecap(parsed.summary) ? parsed.summary : ''
    };
}

// Off by default: tagging is confirmed-only unless the user opts in.
function allowAiEntityCreation() {
    try {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'advanced'").get();
        return !!(row && JSON.parse(row.value).allowAiEntityCreation);
    } catch (e) { return false; }
}

// Returns the rows written and the ids of entities proposed along the way.
function applyChunkTags(chunkTags, chunkRecords, workspaceId = null, { lowercaseWords: workspaceWords = null } = {}) {
    const applied = { rows: 0, created: [], rejectedProposals: 0 };
    if (!getRoleExecutor(ROLE_IDS.TAGGER).executor) return applied;
    if (!Array.isArray(chunkTags) || !chunkTags.length) return applied;
    const insert = db.prepare("INSERT OR IGNORE INTO chunk_tags (chunkId, tag, entity, manual, origin) VALUES (?, ?, ?, 0, 'model')");
    const isSuppressed = db.prepare('SELECT 1 FROM chunk_tag_suppressions WHERE chunkId = ? AND entity = ?');
    // Within a run the cache dedupes proposals; across runs resolveEntity finds them.
    const allowCreate = allowAiEntityCreation();
    const proposedCache = new Map();
    const knownByWorkspace = new Map();
    const knownEntities = ws => {
        if (!knownByWorkspace.has(ws)) knownByWorkspace.set(ws, loadWorkspaceEntities(db, ws));
        return knownByWorkspace.get(ws);
    };
    const lowercaseWords = collectLowercaseWords(chunkRecords.map(record => (record && record.text) || ''));
    if (workspaceWords) for (const word of workspaceWords) lowercaseWords.add(word);
    db.transaction(() => {
        for (const entry of chunkTags) {
            const rec = chunkRecords[entry.chunkIndex];
            if (!rec || !rec.id) continue;
            // Document chunks have ownerId = documentId, so the caller's workspace wins.
            const ws = workspaceId || rec.ownerId;
            for (const t of entry.tags) {
                let entityRef = resolveEntity(ws, t.tag, t.value) || resolveEntity(ws, null, t.value)
                    || (t.surface ? resolveEntity(ws, null, t.surface) : null);
                if (!entityRef && allowCreate) {
                    const proposalData = proposalDataForMention(t.tag, t.proposalKind);
                    if (!proposalData) continue;
                    const key = `${ws || ''}|${t.tag}|${foldText(t.value)}`;
                    if (proposedCache.has(key)) {
                        entityRef = proposedCache.get(key);
                    } else {
                        const verdict = checkProposal({
                            value: t.value,
                            surface: t.surface,
                            type: t.tag,
                            proposalKind: t.proposalKind,
                            chunkText: rec.text,
                            entities: knownEntities(ws),
                            siblings: entry.tags.filter(other => other !== t).map(other => ({ value: other.value, type: other.tag })),
                            lowercaseWords
                        });
                        if (!verdict.ok) {
                            applied.rejectedProposals++;
                            continue;
                        }
                        const ent = entitiesStore.createEntity({
                            workspaceId: ws,
                            type: t.tag,
                            canonicalName: t.value,
                            status: 'proposed',
                            data: {
                                ...proposalData,
                                proposalEvidence: t.evidence ? [{ chunkId: rec.id, excerpt: t.evidence }] : []
                            }
                        });
                        entityRef = ent && ent.id;
                        if (!entityRef) throw new Error(`Could not create proposed entity: ${t.value}`);
                        proposedCache.set(key, entityRef);
                        applied.created.push(entityRef);
                        knownEntities(ws).push({ id: entityRef, type: t.tag, canonicalName: t.value, aliases: [] });
                    }
                }
                if (!entityRef) continue;
                const resolved = entitiesStore.getEntity(entityRef);
                const resolvedTag = resolved?.type || t.tag;
                if (resolved?.status === 'proposed' && t.evidence) {
                    const evidence = Array.isArray(resolved.data?.proposalEvidence) ? resolved.data.proposalEvidence : [];
                    if (!evidence.some(item => item.chunkId === rec.id && item.excerpt === t.evidence)) {
                        entitiesStore.updateEntity(entityRef, {
                            data: { ...(resolved.data || {}), proposalEvidence: [...evidence, { chunkId: rec.id, excerpt: t.evidence }].slice(-8) }
                        });
                    }
                }
                if (!isSuppressed.get(rec.id, entityRef)) applied.rows += insert.run(rec.id, resolvedTag, entityRef).changes;
            }
        }
    })();
    if (applied.rejectedProposals) console.log(`[Tagger] ${applied.rejectedProposals} proposal(s) did not look like a standalone name and were skipped.`);
    return applied;
}

const BACKFILL_SLICE = 24;

// chatId null backfills every chat.
async function backfillWorldIndex(chatId = null, { full = false, tier = 'archive', chunkIds = null, runId = null, progressCallback = null } = {}) {
    const tagger = getRoleExecutor(ROLE_IDS.TAGGER);
    if (!tagger.executor) throw new Error(tagger.error || 'Tagger is disabled.');
    let categoryCount = 0;
    try { categoryCount = db.prepare('SELECT COUNT(*) AS count FROM tags WHERE isEntity = 1').get().count; } catch (e) { categoryCount = 0; }
    if (!categoryCount) throw new Error('No entity tag categories seeded');
    // archive = Chat Archive, custom = Custom Memory snippets, searchable = chat_kb files.
    let ownerType = 'chat_memory';
    let sourceClause = "AND kc.source = 'Chat Archive'";
    if (tier === 'custom') {
        sourceClause = "AND (kc.id LIKE 'manual_%' OR kc.id LIKE 'mem_%')";
    } else if (tier === 'searchable') {
        ownerType = 'chat_kb';
        sourceClause = '';
    }
    const where = (chatId ? 'kc.ownerId = ? AND ' : '') + `kc.ownerType = '${ownerType}' ${sourceClause}`;
    const selectedIds = Array.isArray(chunkIds) ? [...new Set(chunkIds.filter(Boolean))] : [];
    if (Array.isArray(chunkIds) && !selectedIds.length) return { chunks: 0, batches: 0, tagged: 0, taggedChunks: 0, processed: 0, empty: 0, failed: 0 };
    const selectedClause = selectedIds.length ? `AND kc.id IN (${selectedIds.map(() => '?').join(', ')})` : '';
    const queryParams = [...(chatId ? [chatId] : []), ...selectedIds];
    const scopedWhere = `${where} ${selectedClause}`;

    if (full) {
        // Manual tags survive a full re-tag.
        const delSql = `DELETE FROM chunk_tags WHERE (manual IS NULL OR manual = 0) AND chunkId IN
                        (SELECT kc.id FROM knowledge_chunks kc WHERE ${scopedWhere})`;
        db.prepare(delSql).run(...queryParams);
    }
    // Coverage, not tag rows, marks a chunk done: a chunk with no entity is a result.
    const skipTagged = full ? '' : "AND NOT EXISTS (SELECT 1 FROM world_index_chunk_status wis WHERE wis.chunkId = kc.id AND wis.status = 'completed')";
    const sql = `SELECT kc.id, kc.text, kc.ownerId FROM knowledge_chunks kc WHERE ${scopedWhere}
                 ${skipTagged}
                 ORDER BY kc.createdAt ASC`;
    const chunks = db.prepare(sql).all(...queryParams);
    if (!chunks.length) return { chunks: 0, batches: 0, tagged: 0, taggedChunks: 0, processed: 0, empty: 0, failed: 0 };

    const countTags = db.prepare('SELECT COUNT(*) AS count FROM chunk_tags WHERE chunkId = ?');
    const matchers = new Map();
    let tagged = 0, batches = 0, processed = 0, taggedChunks = 0, empty = 0, failed = 0, lastError = null;
    // Slices keep progress moving; each one is recorded before the next starts.
    for (let i = 0; i < chunks.length; i += BACKFILL_SLICE) {
        const slice = chunks.slice(i, i + BACKFILL_SLICE);
        const byOwner = new Map();
        for (const chunk of slice) {
            if (!byOwner.has(chunk.ownerId)) byOwner.set(chunk.ownerId, []);
            byOwner.get(chunk.ownerId).push(chunk);
        }
        for (const [ownerId, records] of byOwner) {
            if (!matchers.has(ownerId)) matchers.set(ownerId, createNameMatcher(db, ownerId));
            const result = await tagChunkRecords(records, ownerId, { runId, notify: false, matcher: matchers.get(ownerId) });
            tagged += result.nameRows + result.modelRows;
            processed += result.taggedRecords.length;
            failed += result.failedRecords.length;
            if (result.error) lastError = result.error;
            for (const record of result.taggedRecords) {
                if (countTags.get(record.id).count) taggedChunks++; else empty++;
            }
        }
        batches++;
        console.log(`[World Index][backfill] ${Math.min(i + BACKFILL_SLICE, chunks.length)}/${chunks.length} chunks, ${tagged} tag row(s) so far.`);
        if (progressCallback) progressCallback({ total: chunks.length, processed, tagged, taggedChunks, empty, failed, batches, error: lastError });
    }
    return { chunks: chunks.length, batches, tagged, processed, taggedChunks, empty, failed, error: lastError };
}

// --- WRITING DESK: per-chapter vectorization ---

// Minimum trimmed length for a block to enter the index; drops blank lines and
// stray label fragments so they never poison retrieval.
const DOC_CHUNK_MIN_CHARS = 15;

// One top-level block per chunk, so editing a paragraph re-embeds only that chunk.
function blockToText(node) {
    if (!node) return '';
    if (node.type === 'text') return node.text || '';
    if (node.type === 'hardBreak') return '\n';
    if (!node.content) return '';
    const sep = (node.type === 'paragraph' || node.type === 'heading') ? '' : '\n';
    return node.content.map(blockToText).join(sep);
}

function pmDocToChunkUnits(content) {
    let json;
    try { json = typeof content === 'string' ? JSON.parse(content) : content; }
    catch (e) { return []; }
    const blocks = (json && json.content) || [];
    const units = [];
    let ordinal = 0;
    for (const block of blocks) {
        const text = blockToText(block).replace(/ /g, ' ').trim();
        if (text.length < DOC_CHUNK_MIN_CHARS) continue;
        const hash = crypto.createHash('sha256').update(text).digest('hex');
        units.push({ text, ordinal: ordinal++, hash });
    }
    return units;
}

// Compares block hashes rather than the `vectorized` flag, which any save resets.
// Returns 'done' | 'outdated' | 'never'.
function computeDocumentVectorStatus(documentId) {
    const doc = db.prepare('SELECT content FROM documents WHERE id = ?').get(documentId);
    if (!doc) return 'never';
    const units = pmDocToChunkUnits(doc.content);
    const rows = db.prepare(
        "SELECT content_hash, manuallyEdited FROM knowledge_chunks WHERE ownerId = ? AND ownerType = 'document'"
    ).all(documentId);
    // No index yet: 'never' unless the chapter is also empty (nothing to index).
    if (!rows.length) return units.length ? 'never' : 'done';
    // Manually edited chunks survive re-index, so they are excluded from the match.
    const stored = new Set(rows.filter(r => !r.manuallyEdited && r.content_hash).map(r => r.content_hash));
    const current = new Set(units.map(u => u.hash));
    if (stored.size !== current.size) return 'outdated';
    for (const h of current) if (!stored.has(h)) return 'outdated';
    return 'done';
}

// Incremental by content hash: unchanged blocks keep their vectors and tags.
async function vectorizeDocument(documentId, progressCallback = null) {
    const doc = db.prepare('SELECT id, workspaceId, title, content FROM documents WHERE id = ?').get(documentId);
    if (!doc) throw new Error('Document not found');

    const units = pmDocToChunkUnits(doc.content);
    const source = doc.title || 'Chapter';

    // Existing chunks keyed by content hash. Legacy rows without a hash are treated as
    // unmatchable, so they fall into the delete/refresh path.
    const existing = db.prepare(
        "SELECT id, content_hash, manuallyEdited FROM knowledge_chunks WHERE ownerId = ? AND ownerType = 'document'"
    ).all(documentId);
    const existingByHash = new Map();
    for (const row of existing) { if (row.content_hash) existingByHash.set(row.content_hash, row); }

    const newHashes = new Set(units.map(u => u.hash));
    const toEmbed = [];
    const keepOrdinal = [];
    for (const u of units) {
        const match = existingByHash.get(u.hash);
        if (match) keepOrdinal.push({ id: match.id, ordinal: u.ordinal });
        else toEmbed.push(u);
    }

    // Delete stored chunks whose text is gone, except manually-edited ones (protected
    // from automated re-index, same rule as the KB path).
    const toDelete = existing
        .filter(row => !row.manuallyEdited && (!row.content_hash || !newHashes.has(row.content_hash)))
        .map(r => r.id);

    if (keepOrdinal.length) {
        const upd = db.prepare('UPDATE knowledge_chunks SET ordinal = ? WHERE id = ?');
        db.transaction(() => { for (const k of keepOrdinal) upd.run(k.ordinal, k.id); })();
    }

    if (toDelete.length) {
        const delChunk = db.prepare('DELETE FROM knowledge_chunks WHERE id = ?');
        const delFts = db.prepare('DELETE FROM knowledge_chunks_fts WHERE chunkId = ?');
        db.transaction(() => { for (const id of toDelete) { delChunk.run(id); delFts.run(id); } })();
    }

    let added = 0;
    if (toEmbed.length) {
        const texts = toEmbed.map(u => u.text);
        const vectors = await vectorizeChunks(texts, source, (done, total) => {
            if (progressCallback) progressCallback({ phase: 'embedding', done, total });
        });
        vectors.forEach((v, i) => { v.content_hash = toEmbed[i].hash; v.ordinal = toEmbed[i].ordinal; });
        insertChunksToDb(documentId, 'document', vectors);
        added = vectors.length;

        const records = vectors.map(v => ({ id: v.id, text: v.text, ownerId: doc.workspaceId }));
        const tagging = await tagChunkRecords(records, doc.workspaceId, {
            onProgress: (done, total) => { if (progressCallback) progressCallback({ phase: 'tagging', done, total }); }
        });
        if (tagging.failed) {
            console.error('[Vectorize Document] tagging failed (vectorization continues):', tagging.error);
            db.prepare('UPDATE documents SET vectorized = 1 WHERE id = ?').run(documentId);
            throw new Error(`Entity tagging failed: ${tagging.error}. Text embeddings were preserved.`);
        }
    }

    db.prepare('UPDATE documents SET vectorized = 1 WHERE id = ?').run(documentId);

    return { added, kept: keepOrdinal.length, deleted: toDelete.length, total: units.length };
}

// Re-tags from scratch without re-embedding.
async function retagDocumentChunks(documentId, progressCallback = null) {
    const doc = db.prepare('SELECT id, workspaceId FROM documents WHERE id = ?').get(documentId);
    if (!doc) throw new Error('Document not found');

    const rows = db.prepare(
        "SELECT id, text FROM knowledge_chunks WHERE ownerId = ? AND ownerType = 'document' ORDER BY ordinal ASC"
    ).all(documentId);
    if (!rows.length) return { tagged: 0, chunks: 0 };

    const records = rows.map(r => ({ id: r.id, text: r.text, ownerId: doc.workspaceId }));
    // Without a Tagger, existing tags stay and only names are refreshed.
    if (!getRoleExecutor(ROLE_IDS.TAGGER).executor) {
        const names = applyNameTags(db, doc.workspaceId, records);
        return { tagged: names.rows, chunks: rows.length, skipped: true };
    }

    const del = db.prepare('DELETE FROM chunk_tags WHERE chunkId = ? AND (manual IS NULL OR manual = 0)');
    db.transaction(() => { for (const r of rows) del.run(r.id); })();

    const result = await tagChunkRecords(records, doc.workspaceId, {
        onProgress: (done, total) => { if (progressCallback) progressCallback({ phase: 'tagging', done, total }); }
    });
    if (result.failed) {
        console.error('[Retag Document] tagging failed:', result.error);
        throw new Error(`Entity tagging failed: ${result.error}`);
    }
    return { tagged: result.nameRows + result.modelRows, chunks: rows.length };
}

const ENRICH_RELATION_GUIDANCE = {
    'Characters.race': 'Only an explicitly established ancestry, species, lineage, or people.',
    'Characters.factions': 'Only explicit membership or formal allegiance, not cooperation, employment, sympathy, or proximity.',
    'Characters.locations': 'Only a persistent meaningful connection, such as residence, origin, rule, or established base; not presence in one scene.',
    'Characters.relationships': 'Only an explicitly established personal relationship; the label must state the supported role.',
    'Characters.inventory': 'Only an item explicitly held or owned by the character, not briefly touched, observed, or used by someone else.',
    'Locations.inside': 'Only explicit physical containment inside another location, never proximity, jurisdiction, association, or travel between places.',
    'Locations.leader': 'Only explicit ownership, leadership, or governance of the location.',
    'Items.creator': 'Only the explicitly established creator or maker.',
    'Items.owner': 'Only current explicit ownership; use, custody, discovery, or theft alone does not prove ownership.',
    'Items.currentLocation': 'Only the current explicit physical location of a unique item.',
    'Items.foundIn': 'Only an explicit place where the item or resource is found, stored, produced, or gathered.',
    'Items.soldIn': 'Only an explicit place where this item type is regularly sold or traded.',
    'Creatures.habitat': 'Only an explicitly established natural or habitual location, not a single encounter site.',
    'Creatures.relationships': 'Only an explicitly established personal relationship for an individual creature; the label must state the supported role.',
    'Factions.leader': 'Only an explicitly established current leader.',
    'Factions.operatesIn': 'Only an established area of operation, base, territory, or sustained activity.',
    'Factions.members': 'Only explicit membership; the label must state the supported role when available.',
    'Events.happenedAt': 'Only a location where the event explicitly occurred.',
    'Events.involved': 'Only a character explicitly participating in or materially affected by the event, not merely mentioned nearby.',
};

const ENTITY_ENRICHMENT_SCHEMA_VERSION = 'semantic-v8-general';

function entityEnrichmentSignature(chunk, fieldCoverageSignature = '') {
    return `${ENTITY_ENRICHMENT_SCHEMA_VERSION}:${fieldCoverageSignature}:${chunk.isTagged ? 'tagged' : 'text'}:${chunk.contentHash}`;
}

function enrichFieldsForEntity(entity) {
    return filterUpdateFields(entity, ENRICH_FIELDS[entity.type] || []);
}

// When a full rewrite would not fit the output limit, lore is appended instead.
const LORE_REWRITE_OVERHEAD_TOKENS = 600;

function loreNeedsAppend(currentLore, outputTokens) {
    const lore = String(currentLore || '').trim();
    if (!lore) return false;
    return Math.ceil(estimateTokens(lore) * 1.15) + LORE_REWRITE_OVERHEAD_TOKENS > outputTokens;
}

function entityEnrichmentMaxTokens(entity) {
    const currentLoreLength = String(entity.type === 'System' ? entity.data?.content || '' : entity.lore || '').length;
    const minimum = entity.type === 'System' ? 2400 : 1800;
    const maximum = entity.type === 'System' ? 5000 : 4000;
    return Math.min(maximum, Math.max(minimum, 1200 + Math.ceil(currentLoreLength / 3.5)));
}

// Usually the output budget, not formatting: reasoning models spend it thinking.
function describeEntityUpdateFailure(result, parsed) {
    const content = String(result?.content || '');
    if (result?.truncated) {
        return { cause: 'budget', message: 'The System AI response reached its output limit before the entity update was complete.' };
    }
    if (parsed) {
        return { cause: 'shape', message: 'The System AI returned JSON using an unsupported entity update shape.' };
    }
    if (!content.includes('{')) {
        return { cause: 'empty', message: 'The System AI reply contained no JSON object. Reasoning models can spend the whole output budget before answering.' };
    }
    return { cause: 'format', message: 'The System AI returned invalid structured JSON.' };
}

function entityUpdateRetryTokens(cause, maxTokens) {
    if (cause === 'budget' || cause === 'empty') return Math.min(16000, maxTokens * 2);
    return maxTokens;
}

// Without the raw reply and the finish reason there is no way to tell these causes
// apart after the fact.
function logEntityUpdateFailure(entity, attempt, failure, result) {
    console.error(
        `[Entity Update] ${entity.canonicalName} (${entity.type}) ${attempt} failed: ${failure.cause} | finishReason=${result?.finishReason ?? 'unknown'} | truncated=${Boolean(result?.truncated)}
` +
        `[Entity Update] raw response (first 1000 chars): ${String(result?.content || '').slice(0, 1000)}`
    );
}

// `from: 'target'` means the edge starts at the linked entity. Enrichment only links
// existing entities; it never creates them.
const ENRICH_RELATIONS = {
    Characters: [
        { key: 'race',          label: 'Race',         relType: 'is_race',      targetType: 'Races',      from: 'self',   single: true },
        { key: 'factions',      label: 'Faction',      relType: 'member_of',    targetType: 'Factions',   from: 'self',   single: false },
        { key: 'locations',     label: 'Location',     relType: 'connected_to', targetType: 'Locations',  from: 'self',   single: false },
        { key: 'relationships', label: 'Relationship', relType: 'related_to', targetTypes: ['Characters', 'Creatures'], from: 'self', single: false, labeled: true },
    ],
    Locations: [
        { key: 'inside', label: 'Inside',         relType: 'inside', targetType: 'Locations',  from: 'self', single: true },
        { key: 'leader', label: 'Owner / leader', relType: 'led_by', targetType: 'Characters', from: 'self', single: true },
    ],
    Items: [
        { key: 'creator', label: 'Creator',     relType: 'created_by', targetType: 'Characters', from: 'self', single: true },
        { key: 'owner', label: 'Owner', relType: 'owned_by', targetTypes: ['Characters', 'Creatures'], from: 'self', single: true, itemNature: 'unique' },
        { key: 'currentLocation', label: 'Current location', relType: 'located_in', targetType: 'Locations', from: 'self', single: true, itemNature: 'unique' },
        { key: 'foundIn', label: 'Where found', relType: 'found_in', targetType: 'Locations', from: 'self', single: false, itemNature: 'type' },
        { key: 'soldIn', label: 'Where sold', relType: 'sold_in', targetType: 'Locations', from: 'self', single: false, itemNature: 'type' },
    ],
    Creatures: [
        { key: 'habitat', label: 'Habitat', relType: 'found_in', targetType: 'Locations', from: 'self', single: false },
        { key: 'relationships', label: 'Relationship', relType: 'related_to', targetTypes: ['Characters', 'Creatures'], from: 'self', single: false, labeled: true, individualOnly: true },
    ],
    Factions: [
        { key: 'leader',     label: 'Leader',            relType: 'led_by',      targetType: 'Characters', from: 'self',   single: true },
        { key: 'operatesIn', label: 'Area of operation', relType: 'operates_in', targetType: 'Locations',  from: 'self',   single: false },
        { key: 'members',    label: 'Member',            relType: 'member_of',   targetType: 'Characters', from: 'target', single: false, labeled: true },
    ],
    Races: [],
    Events: [
        { key: 'happenedAt', label: 'Where it happened', relType: 'happened_at', targetType: 'Locations',  from: 'self', single: false },
        { key: 'involved',   label: 'Who was involved',   relType: 'involved',    targetType: 'Characters', from: 'self', single: false },
    ],
    System: [],
};

function enrichRelationsForEntity(entity) {
    return filterUpdateRelations(entity, ENRICH_RELATIONS[entity.type] || []);
}

// The set of target ids this entity already links to for a given relation spec, so the
// enrichment never re-proposes an edge that already exists.
function existingLinkTargets(entityId, spec) {
    const rows = spec.from === 'target'
        ? entitiesStore.getLinksTo(entityId, spec.relType)
        : entitiesStore.getLinksFrom(entityId, spec.relType);
    return new Set(rows.map(r => r.entity && r.entity.id).filter(Boolean));
}

// Create one proposed edge. `from` decides which end the entity sits on: 'target' means
// the edge runs from the linked entity into this one (e.g. an item owned_by a character),
// so we swap the endpoints. `single` clears any prior edge of that (fromId, relType).
function applyProposedLink(entityId, link, workspaceId) {
    const fromId = link.from === 'target' ? link.targetId : entityId;
    const toId = link.from === 'target' ? entityId : link.targetId;
    entitiesStore.setLink({ workspaceId, fromId, relType: link.relType, toId, single: !!link.single, label: link.label || null });
}

// Pick chunk texts in order within a char budget. When they overflow, keep a head + a
// tail (recent state matters for status changes; the head preserves origin/lore) with
// an elision marker, so the model still sees both ends in chronological order.
function windowChunks(texts, budget = 16000) {
    const joined = texts.join('\n\n');
    if (joined.length <= budget) return joined;
    const headBudget = Math.floor(budget * 0.4);
    const head = [], tail = [];
    let used = 0;
    for (const t of texts) { if (used + t.length > headBudget) break; head.push(t); used += t.length + 2; }
    let tailUsed = 0;
    for (let i = texts.length - 1; i >= head.length; i--) {
        if (tailUsed + texts[i].length > budget - used) break;
        tail.unshift(texts[i]); tailUsed += texts[i].length + 2;
    }
    return head.join('\n\n') + '\n\n[…earlier passages omitted…]\n\n' + tail.join('\n\n');
}

function entityMentionNames(entity) {
    return [...new Set([entity.canonicalName, ...(entity.aliases || [])]
        .map(entitiesStore.normalizeName)
        .filter(Boolean))];
}

function textMentionsEntity(text, names) {
    const normalized = entitiesStore.normalizeName(text);
    return names.some(name => {
        const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'u').test(normalized);
    });
}

function chronologicalSlice(entries, budget) {
    const cost = entry => estimateTokens(entry.prompt) + 4;
    const total = entries.reduce((sum, entry) => sum + cost(entry), 0);
    if (total <= budget) return entries;
    const selected = [];
    const selectedIds = new Set();
    let used = 0;
    const headBudget = Math.floor(budget * 0.4);
    for (const entry of entries) {
        if (used + cost(entry) > headBudget) break;
        selected.push(entry); selectedIds.add(entry.id); used += cost(entry);
    }
    for (let index = entries.length - 1; index >= 0; index--) {
        const entry = entries[index];
        if (selectedIds.has(entry.id)) continue;
        if (used + cost(entry) > budget) break;
        selected.push(entry); selectedIds.add(entry.id); used += cost(entry);
    }
    return selected.sort((a, b) => a.order - b.order);
}

function selectEntityEvidence(entries, budget = 6000) {
    const tagged = chronologicalSlice(entries.filter(entry => entry.chunk.isTagged), budget);
    const used = tagged.reduce((sum, entry) => sum + estimateTokens(entry.prompt) + 4, 0);
    if (used >= budget) return tagged;
    const untagged = chronologicalSlice(entries.filter(entry => !entry.chunk.isTagged), budget - used);
    return [...tagged, ...untagged].sort((a, b) => a.order - b.order);
}

async function loadConstantMemoryChunks(workspaceId) {
    const row = db.prepare('SELECT memoryBlocks, knowledgeFiles FROM chats WHERE id = ?').get(workspaceId);
    if (!row) return [];
    const sources = [];
    try {
        for (const block of JSON.parse(row.memoryBlocks || '[]')) {
            if (block.strategy !== 'constant' || block.enabled === false) continue;
            sources.push({ key: `memory:${block.id}`, source: block.title || block.source || 'Constant Memory', text: block.summary || block.text || '', createdAt: block.createdAt || 0 });
        }
    } catch (error) { console.warn('[Enrich] Could not read constant memory blocks:', error.message); }
    try {
        for (const file of JSON.parse(row.knowledgeFiles || '[]')) {
            if (!['constant', 'full_context'].includes(file.strategy || 'constant') || file.enabled === false || !file.internalPath || !fs.existsSync(file.internalPath)) continue;
            const extension = path.extname(file.name || file.internalPath).toLowerCase();
            const text = ['.txt', '.md', '.json', '.csv'].includes(extension)
                ? fs.readFileSync(file.internalPath, 'utf8')
                : await extractTextFromFile(file.internalPath);
            sources.push({ key: `file:${file.internalPath}`, source: file.name || 'Full-context Memory', text, createdAt: 0 });
        }
    } catch (error) { console.warn('[Enrich] Could not read full-context memory files:', error.message); }
    return sources.flatMap(source => chunkText(String(source.text || ''), 800).map((text, index) => {
        const id = `virtual_memory_${crypto.createHash('sha256').update(`${workspaceId}:${source.key}:${index}`).digest('hex')}`;
        return { id, text, source: source.source, createdAt: source.createdAt + index, contentHash: crypto.createHash('sha256').update(text).digest('hex'), evidenceSource: 'Memory', isTagged: false };
    }));
}

// aiPolicy: 'open' applies directly, 'review' stages into data._enrichPending without
// touching live values, 'locked' is skipped. One entity failing never aborts the run.
async function enrichEntities(workspaceId, progressCallback = null) {
    if (!workspaceId) throw new Error('workspaceId is required');
    // Precise extraction: System AI only, never a writing profile.
    const systemAiConfig = getSystemAiConfiguration();
    const systemAi = systemAiConfig.systemAi;
    if (!systemAi) throw new Error(systemAiConfig.error);
    const apiProfileId = systemAi.apiProfileId;
    const model = systemAi.model;
    const manualMode = false;
    const manualJson = null;

    const all = entitiesStore.listEntities({ workspaceId });
    const targets = all.filter(e => e.status !== 'proposed' && (e.data?.aiPolicy || 'review') !== 'locked');
    const updateState = createEntityUpdateState(db);
    const runId = updateState.startRun(workspaceId, targets.map(entity => entity.id));
    let consecutiveStructuredFailures = 0;
    const taggedWritingChunks = db.prepare(`
        SELECT DISTINCT kc.id, kc.text, kc.source, kc.createdAt,
          COALESCE(kc.content_hash, '') AS contentHash, 'Writing Desk' AS evidenceSource, 1 AS isTagged
        FROM chunk_tags ct
        JOIN knowledge_chunks kc ON ct.chunkId = kc.id AND kc.ownerType = 'document'
        JOIN documents d ON d.id = kc.ownerId
        WHERE ct.entity = ? AND d.workspaceId = ? AND kc.enabled = 1
        ORDER BY kc.createdAt ASC
    `);
    const memoryChunks = db.prepare(`
        SELECT id, text, source, ownerType, createdAt, COALESCE(content_hash, '') AS contentHash
        FROM knowledge_chunks
        WHERE ownerId = ? AND ownerType IN ('chat_kb', 'chat_memory') AND enabled = 1
        ORDER BY createdAt ASC
    `).all(workspaceId).map(chunk => ({ ...chunk, evidenceSource: 'Memory' }));
    const constantMemoryChunks = await loadConstantMemoryChunks(workspaceId);
    const taggedMemoryChunks = db.prepare(`
        SELECT ct.chunkId FROM chunk_tags ct
        JOIN knowledge_chunks kc ON kc.id = ct.chunkId
        WHERE ct.entity = ? AND kc.ownerId = ? AND kc.ownerType IN ('chat_kb', 'chat_memory')
    `);
    const markChunkProcessed = db.prepare(`
        INSERT INTO entity_enrichment_chunks (entityId, chunkId, contentHash, processedAt)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(entityId, chunkId) DO UPDATE SET contentHash = excluded.contentHash, processedAt = excluded.processedAt
    `);
    const recordEnrichmentError = db.prepare(`
        INSERT INTO entity_enrichment_errors (id, workspaceId, entityId, entityName, entityType, error, createdAt, dismissedAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL)
        ON CONFLICT(workspaceId, entityId) DO UPDATE SET entityName = excluded.entityName,
          entityType = excluded.entityType, error = excluded.error, createdAt = excluded.createdAt, dismissedAt = NULL
    `);
    const clearEnrichmentError = db.prepare('DELETE FROM entity_enrichment_errors WHERE workspaceId = ? AND entityId = ?');
    const failures = [];
    const rememberFailure = (entity, error) => {
        const message = cleanErrorMessage(error) || 'The System AI could not produce a valid entity update.';
        failures.push({ entityId: entity.id, entityName: entity.canonicalName, entityType: entity.type, error: message });
        recordEnrichmentError.run(`enrich_error_${crypto.randomUUID()}`, workspaceId, entity.id, entity.canonicalName, entity.type, message, Date.now());
    };

    // Names the AI may reference when proposing links (only existing, non-proposed
    // entities), grouped by type.
    const namesByType = {};
    for (const e of all) {
        if (e.status === 'proposed') continue;
        (namesByType[e.type] = namesByType[e.type] || []).push(e.canonicalName);
    }
    let updated = 0, staged = 0, upToDate = 0, noEvidence = 0, failed = 0;
    let evidenceUsed = 0, taggedEvidenceRemaining = 0, textMatchesSkipped = 0;
    for (let i = 0; i < targets.length; i++) {
        if (shouldStopEntityUpdates(consecutiveStructuredFailures)) {
            for (let pendingIndex = i; pendingIndex < targets.length; pendingIndex++) {
                updateState.updateJob(runId, targets[pendingIndex].id, {
                    status: 'skipped',
                    error: 'Circuit breaker stopped the run after repeated structured-output failures.'
                });
            }
            break;
        }
        const ent = targets[i];
        updateState.updateJob(runId, ent.id, { status: 'processing' });
        if (ent.type === 'System' && ent.data?._enrichPending?.lore != null) {
            const pending = { ...ent.data._enrichPending };
            delete pending.lore;
            const hasActionableChanges = Object.keys(pending.data || {}).length || (pending.links || []).length || (pending.chapters || []).length;
            const nextData = { ...ent.data };
            if (hasActionableChanges) nextData._enrichPending = pending;
            else delete nextData._enrichPending;
            entitiesStore.updateEntity(ent.id, { data: nextData });
            ent.data = nextData;
        }
        if (progressCallback) progressCallback({ phase: 'enriching', done: i, total: targets.length, name: ent.canonicalName });
        const candidates = new Map();
        for (const chunk of taggedWritingChunks.all(ent.id, workspaceId)) {
            if (chunk.text) candidates.set(chunk.id, chunk);
        }
        const taggedMemoryIds = new Set(taggedMemoryChunks.all(ent.id, workspaceId).map(row => row.chunkId));
        for (const chunk of memoryChunks) {
            if (chunk.text && taggedMemoryIds.has(chunk.id)) candidates.set(chunk.id, { ...chunk, isTagged: true });
        }
        const mentionNames = entityMentionNames(ent);
        for (const chunk of memoryChunks) {
            if (chunk.text && textMentionsEntity(chunk.text, mentionNames)) {
                if (!candidates.has(chunk.id)) candidates.set(chunk.id, { ...chunk, isTagged: false });
            }
        }
        for (const chunk of constantMemoryChunks) {
            if (chunk.text && textMentionsEntity(chunk.text, mentionNames)) candidates.set(chunk.id, chunk);
        }
        if (!candidates.size) {
            noEvidence++;
            updateState.updateJob(runId, ent.id, { status: 'skipped' });
            continue;
        }
        const allowed = enrichFieldsForEntity(ent);
        const fieldCoverage = buildFieldCoverage(ent, allowed);
        const discoveredEntries = [...candidates.values()].map(chunk => ({
            chunk,
            signature: entityEnrichmentSignature(chunk, fieldCoverage.signature)
        }));
        const evidenceStates = updateState.discover(workspaceId, ent.id, discoveredEntries);
        const chunks = [...candidates.values()]
            .filter(chunk => ['discovered', 'queued', 'deferred'].includes(evidenceStates.get(chunk.id)?.state))
            .sort((a, b) => (a.createdAt - b.createdAt) || String(a.id).localeCompare(String(b.id)));
        if (!chunks.length) {
            upToDate++;
            updateState.updateJob(runId, ent.id, { status: 'skipped' });
            continue;
        }

        const fieldLines = allowed.map(field => {
            const shape = ENRICH_ENUMS[field]
                ? `one of [${ENRICH_ENUMS[field].join(', ')}]`
                : 'a concise literal value';
            return `- ${field}: ${shape}. ${ENRICH_FIELD_GUIDANCE[field]}`;
        }).join('\n');
        const relSpecs = enrichRelationsForEntity(ent);
        const currentData = {};
        for (const f of allowed) if (ent.data && ent.data[f] != null) currentData[f] = ent.data[f];

        // Relations without candidates are omitted: never ask for links that can't exist.
        const evidencePrefix = crypto.randomBytes(2).toString('hex');
        const evidenceExample = `E_${evidencePrefix}_1`;
        const relBlocks = [];
        for (const spec of relSpecs) {
            const targetTypes = spec.targetTypes || [spec.targetType];
            const names = targetTypes.flatMap(type => namesByType[type] || []).filter(n => n !== ent.canonicalName);
            if (!names.length) continue;
            const base = `{"name": "<one name>", "certainty": "explicit", "support": "<why the evidence directly proves this relation>", "evidence": ["${evidenceExample}"]`;
            const item = spec.labeled ? `${base}, "label": "<short supported role/relation>"}` : `${base}}`;
            const shape = spec.single ? item : `[${item}]`;
            const guidance = ENRICH_RELATION_GUIDANCE[`${ent.type}.${spec.key}`] || 'Only when the exact relation is explicitly established.';
            relBlocks.push({ spec, names, line: `- ${spec.key}: ${spec.label} — ${shape}. ${guidance} Candidates: ${names.join(', ')}` });
        }

        const evidenceEntries = chunks.map((chunk, index) => ({
            id: `E_${evidencePrefix}_${index + 1}`,
            order: index,
            chunk,
            prompt: `[E_${evidencePrefix}_${index + 1} | ${chunk.evidenceSource}: ${chunk.source || 'Untitled'} | ${chunk.isTagged ? 'indexed entity match' : 'name or alias match'} | chunk ${chunk.id}]\n${chunk.text}`
        }));
        const includedEvidence = selectEntityEvidence(evidenceEntries);
        const includedIds = new Set(includedEvidence.map(entry => entry.id));
        const deferredEvidence = evidenceEntries.filter(entry => !includedIds.has(entry.id));
        updateState.transition(workspaceId, ent.id, includedEvidence, 'queued', runId);
        updateState.transition(workspaceId, ent.id, deferredEvidence, 'deferred', runId, 'token-budget');
        const evidenceWindow = includedEvidence.map(entry => entry.prompt).join('\n\n');
        const chunkIds = includedEvidence.map(entry => entry.chunk.id);
        let relevantSystems = [];
        if (chunkIds.length) {
            const placeholders = chunkIds.map(() => '?').join(', ');
            const relatedIds = new Set(db.prepare(
                `SELECT DISTINCT entity FROM chunk_tags WHERE chunkId IN (${placeholders}) AND entity IS NOT NULL`
            ).all(...chunkIds).map(row => row.entity));
            const normalizedEvidence = entitiesStore.normalizeName(evidenceWindow);
            relevantSystems = all.filter(candidate => {
                if (candidate.id === ent.id || candidate.type !== 'System' || candidate.status === 'proposed') return false;
                const names = [candidate.canonicalName, ...(candidate.aliases || [])]
                    .map(entitiesStore.normalizeName)
                    .filter(Boolean);
                return relatedIds.has(candidate.id) || names.some(name => normalizedEvidence.includes(name));
            }).slice(0, 3);
        }
        const systemContext = relevantSystems.map(system => {
            const aliases = system.aliases?.length ? ` (aliases: ${system.aliases.join(', ')})` : '';
            const content = [system.data?.content, system.lore]
                .map(value => String(value || '').trim())
                .filter(Boolean)
                .join('\n');
            return content ? `### ${system.canonicalName}${aliases}\n${content.slice(0, 2400)}` : '';
        }).filter(Boolean).join('\n\n');

        const allowLore = ent.type !== 'System';
        const responseShape = `{"data": {}, "links": {}}`;
        const systemPrompt =
            getSystemLanguageInstruction() + "\n" +
            `You maintain a story's world bible. Update the record for one ${ent.type.replace(/s$/, '')} named "${ent.canonicalName}" ` +
            (allowLore
                ? `using the CURRENT RECORD plus ONLY the NEW STORY EVIDENCE provided. Preserve established lore unless new evidence explicitly changes or contradicts it.\n`
                : `using the CURRENT CONCEPT plus ONLY the NEW STORY EVIDENCE provided. Preserve established concept content unless new evidence explicitly changes or contradicts it.\n`) +
            `Return one valid JSON object and nothing else. The complete top-level shape is:\n${responseShape}\n` +
            `Lore is composed separately. Never return a lore key here. Use {} for no data or link changes. A changed data field must use ` +
            `{"value":"<value>","certainty":"explicit","support":"<direct support>","evidence":["${evidenceExample}"]}. ` +
            `A link entry must use the exact valid JSON shape shown in ALLOWED LINKS below. Never output angle-bracket placeholders.\n` +
            `ENTITY TYPE CONTRACT:\n${ENRICH_TYPE_GUIDANCE[ent.type] || 'A persistent canonical world entity.'}\n` +
            (fieldLines ? `Allowed data fields:\n${fieldLines}\n` : '') +
            (fieldCoverage.emptyFields.length ? `Empty writable fields that deserve explicit coverage when evidence supports them: ${fieldCoverage.emptyFields.join(', ')}\n` : '') +
            (relBlocks.length ? `Allowed links (use the exact candidate names, never invent a name):\n${relBlocks.map(b => b.line).join('\n')}\n` : '') +
            `STRICT RULES:\n` +
            `- Fill a field or propose a link ONLY when the passages state it explicitly and unambiguously. When unsure, omit it — returning few or no fields is correct and expected.\n` +
            `- Every proposed change must cite one or more supplied evidence IDs. Never cite an ID that does not support the exact change.\n` +
            `- Set certainty to "explicit" only when the evidence directly entails the exact value or relation. Inference, implication, symbolism, genre convention, probability, and interpretation are not explicit. Omit anything that is not explicit.\n` +
            `- Do not return unchanged fields or unchanged links. Empty data and links objects are correct when the new evidence changes nothing.\n` +
            `- Existing values are canonical context, not protected blanks. When new explicit evidence changes an existing value, propose the replacement and explain the direct support. Never replace a value merely to rephrase it.\n` +
            `- Never infer, estimate, or compute a value. Do not write reasoning, ranges, or hedged phrases ("about", "at least", "since ...") as a value; give the concrete literal value or omit the field entirely.\n` +
            `- Only link two entities when the text directly establishes that exact relation. In particular, only nest a location inside another when the passages explicitly say one place is physically within the other — never by mere association or proximity.\n` +
            `- Field and link VALUES must be literal and drawn straight from the evidence.\n` +
            `- CANONICAL SYSTEM / CONCEPT CONTEXT defines setting-specific terms. Use it to interpret evidence, but do not copy a concept's facts into this entity unless the evidence explicitly connects them.\n` +
            `Do not invent facts, names, or fields absent from the passages.`;
        const userPromptPrefix =
            `${allowLore ? 'CURRENT RECORD' : 'CURRENT CONCEPT'}:\nName: ${ent.canonicalName}\nAliases: ${ent.aliases?.join(', ') || '(none)'}\n` +
            (allowLore ? `Lore: ${ent.lore ? ent.lore : '(no lore yet)'}\n` : '') +
            (Object.keys(currentData).length ? `Current fields: ${JSON.stringify(currentData)}\n` : '') +
            (systemContext ? `\nCANONICAL SYSTEM / CONCEPT CONTEXT:\n${systemContext}\n` : '');

        let entityInputTokens = 0;
        let entityOutputTokens = 0;
        try {
            const maxTokens = entityEnrichmentMaxTokens(ent);
            const requestUpdate = async (evidence, retry = false, outputTokens = maxTokens) => {
                const requestSystemPrompt = retry
                    ? `${systemPrompt}\nCORRECTION: Your previous reply could not be parsed. Return only the valid JSON object. Keep unchanged sections empty and make the response as concise as the evidence permits.`
                    : systemPrompt;
                const requestPrompt = `${userPromptPrefix}\nNEW STORY EVIDENCE (chronological):\n${evidence.map(entry => entry.prompt).join('\n\n')}`;
                entityInputTokens += estimateTokens(requestSystemPrompt) + estimateTokens(requestPrompt);
                const requestResult = await sendApiRequest({
                    apiProfileId,
                    model,
                    systemPrompt: requestSystemPrompt,
                    chatHistory: [],
                    newPrompt: requestPrompt,
                    temperature: 0.1,
                    maxTokens: outputTokens,
                    manualMode,
                    manualJson,
                    jsonMode: true,
                    jsonSchema: buildEntityUpdateSchema(allowed, relBlocks.map(block => block.spec.key)),
                    includeResponseMetadata: true
                });
                entityOutputTokens += estimateTokens(requestResult.content);
                return requestResult;
            };
            let activeEvidence = includedEvidence;
            let retryCount = 0;
            let result = await requestUpdate(activeEvidence);
            let response = result.content;
            let parsedResult = parseEntityUpdateObject(response);
            let parsed = parsedResult.value;
            if (!isStructuredEntityUpdate(parsed)) {
                const firstFailure = describeEntityUpdateFailure(result, parsed);
                logEntityUpdateFailure(ent, 'first attempt', firstFailure, result);
                // Only a budget failure is helped by less evidence.
                if (firstFailure.cause === 'budget' || firstFailure.cause === 'empty') {
                    const previousActive = activeEvidence;
                    activeEvidence = selectEntityEvidence(evidenceEntries, 3000);
                    const retainedIds = new Set(activeEvidence.map(entry => entry.id));
                    updateState.transition(
                        workspaceId,
                        ent.id,
                        previousActive.filter(entry => !retainedIds.has(entry.id)),
                        'deferred',
                        runId,
                        'token-budget'
                    );
                }
                const retryTokens = entityUpdateRetryTokens(firstFailure.cause, maxTokens);
                retryCount++;
                result = await requestUpdate(activeEvidence, true, retryTokens);
                response = result.content;
                parsedResult = parseEntityUpdateObject(response);
                parsed = parsedResult.value;
                if (!isStructuredEntityUpdate(parsed)) {
                    failed++;
                    consecutiveStructuredFailures++;
                    const retry = describeEntityUpdateFailure(result, parsed);
                    logEntityUpdateFailure(ent, 'retry', retry, result);
                    const retryFailure = retry.message;
                    rememberFailure(ent, `${retryFailure} Automatic retry also failed. First response: ${firstFailure.message}`);
                    updateState.transition(workspaceId, ent.id, activeEvidence, 'deferred', runId, 'structured-output-failure');
                    updateState.updateJob(runId, ent.id, {
                        status: 'failed',
                        input_tokens: entityInputTokens,
                        output_tokens: entityOutputTokens,
                        retry_count: retryCount,
                        evidence_used: activeEvidence.length,
                        error: retryFailure
                    });
                    continue;
                }
            }

            consecutiveStructuredFailures = 0;
            parsed = decodeEntityUpdate(parsed);
            const policy = ent.data?.aiPolicy || 'review';
            const incoming = parsed.data;
            const activeEvidenceIds = new Set(activeEvidence.map(entry => entry.id));
            const skippedTextualEvidence = evidenceEntries.filter(entry => !entry.chunk.isTagged && !activeEvidenceIds.has(entry.id));
            const pendingTaggedEvidence = evidenceEntries.filter(entry => entry.chunk.isTagged && !activeEvidenceIds.has(entry.id));
            const validEvidenceIds = activeEvidenceIds;
            const readProposal = (raw) => {
                if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.value == null) return null;
                if (String(raw.certainty || '').toLowerCase() !== 'explicit') return null;
                const support = String(raw.support || '').trim();
                if (!support) return null;
                const evidence = (Array.isArray(raw.evidence) ? raw.evidence : [])
                    .map(String)
                    .filter(id => validEvidenceIds.has(id));
                const value = String(raw.value).trim();
                return value && evidence.length ? { value, evidence, support } : null;
            };
            // Only fields that differ from the current value; shared by both policies.
            const proposedData = {};
            for (const f of allowed) {
                const proposal = readProposal(incoming[f]);
                if (!proposal) continue;
                let v = proposal.value;
                if (isUnsupportedNumericDelta(v, proposal.support)) continue;
                if (ENRICH_ENUMS[f]) {
                    const match = ENRICH_ENUMS[f].find(o => o.toLowerCase() === v.toLowerCase());
                    if (!match) continue;
                    v = match;
                }
                const cur = ent.data?.[f] == null ? '' : String(ent.data[f]).trim();
                if (v !== cur) proposedData[f] = { value: v, evidence: proposal.evidence, support: proposal.support };
            }
            let loreProposal = null;

            const proposedLinks = [];
            const incomingLinks = (parsed.links && typeof parsed.links === 'object') ? parsed.links : {};
            for (const { spec } of relBlocks) {
                const raw = incomingLinks[spec.key];
                if (raw == null) continue;
                const items = Array.isArray(raw) ? raw : [raw];
                const existing = existingLinkTargets(ent.id, spec);
                const seen = new Set();
                for (const item of items) {
                    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
                    if (String(item.certainty || '').toLowerCase() !== 'explicit') continue;
                    const support = String(item.support || '').trim();
                    if (!support) continue;
                    const evidence = (Array.isArray(item.evidence) ? item.evidence : [])
                        .map(String)
                        .filter(id => validEvidenceIds.has(id));
                    if (!evidence.length) continue;
                    const name = String(item.name || '').trim();
                    if (!name) continue;
                    const label = (spec.labeled && item && typeof item === 'object' && item.label != null) ? String(item.label).trim() : null;
                    const targetId = (spec.targetTypes || [spec.targetType])
                        .map(type => entitiesStore.resolveMention(name, type, workspaceId))
                        .find(Boolean);
                    if (!targetId || targetId === ent.id || existing.has(targetId)) continue;
                    const dedupe = `${targetId}:${label || ''}`;
                    if (seen.has(dedupe)) continue;
                    seen.add(dedupe);
                    proposedLinks.push({ relKey: spec.key, relLabel: spec.label, relType: spec.relType, from: spec.from, single: !!spec.single, label, targetId, targetName: name, evidence, support });
                    if (spec.single) break; // one target for single-valued relations
                }
            }

            let loreFailure = null;
            if (allowLore) {
                const loreEvidence = activeEvidence.map(entry => entry.prompt).join('\n\n');
                const loreOutputTokens = entityEnrichmentMaxTokens(ent);
                const appendLore = loreNeedsAppend(ent.lore, loreOutputTokens);
                const loreSystemPrompt = `${getSystemLanguageInstruction()}\n${appendLore
                    ? 'Extend canonical Lore with new paragraphs drawn from validated findings and cited evidence.'
                    : 'Compose cumulative canonical Lore from validated findings and cited evidence.'} Return only the requested JSON object.`;
                const lorePrompt = (appendLore ? buildLoreAppendPrompt : buildLorePrompt)({
                    entityName: ent.canonicalName,
                    entityType: ent.type,
                    currentLore: ent.lore,
                    findings: { data: proposedData, links: proposedLinks },
                    evidence: loreEvidence
                });
                entityInputTokens += estimateTokens(loreSystemPrompt) + estimateTokens(lorePrompt);
                const loreResult = await sendApiRequest({
                    apiProfileId,
                    model,
                    systemPrompt: loreSystemPrompt,
                    chatHistory: [],
                    newPrompt: lorePrompt,
                    temperature: 0.1,
                    maxTokens: loreOutputTokens,
                    manualMode,
                    manualJson,
                    jsonMode: true,
                    jsonSchema: buildEntityLoreSchema(),
                    includeResponseMetadata: true
                });
                const loreResponse = loreResult.content;
                entityOutputTokens += estimateTokens(loreResponse);
                const loreObject = parseEntityUpdateObject(loreResponse).value;
                const loreEvidenceIds = new Set(activeEvidence.map(entry => entry.id));
                loreProposal = appendLore
                    ? validateEntityLoreAppend(loreObject, ent.lore, loreEvidenceIds)
                    : validateEntityLore(loreObject, ent.lore, loreEvidenceIds);
                // A cut-off or unreadable reply is a failure; a valid no-op stays silent.
                if (!loreProposal && (loreResult.truncated || !loreObject)) {
                    loreFailure = loreResult.truncated
                        ? `The Lore update for ${ent.canonicalName} reached the System AI output limit and was not applied.`
                        : `The Lore update for ${ent.canonicalName} could not be read and was not applied.`;
                    console.warn(`[Entity Update] ${loreFailure} finishReason=${loreResult.finishReason ?? 'unknown'}`);
                }
            }
            const incomingLore = loreProposal?.value || '';
            const loreChanged = Boolean(loreProposal);
            const hasChange = Object.keys(proposedData).length || loreChanged || proposedLinks.length;
            evidenceUsed += activeEvidence.length;
            taggedEvidenceRemaining += pendingTaggedEvidence.length;
            textMatchesSkipped += skippedTextualEvidence.length;
            const markIncludedProcessed = () => {
                const processedAt = Date.now();
                db.transaction(() => {
                    for (const entry of activeEvidence) {
                        markChunkProcessed.run(ent.id, entry.chunk.id, entityEnrichmentSignature(entry.chunk, fieldCoverage.signature), processedAt);
                    }
                })();
            };
            // Keep the evidence pending so a later run retries it.
            if (!hasChange && loreFailure) {
                failed++;
                rememberFailure(ent, loreFailure);
                updateState.transition(workspaceId, ent.id, activeEvidence, 'deferred', runId, 'lore-output-failure');
                updateState.updateJob(runId, ent.id, {
                    status: 'failed',
                    input_tokens: entityInputTokens,
                    output_tokens: entityOutputTokens,
                    retry_count: retryCount,
                    evidence_used: activeEvidence.length,
                    error: loreFailure
                });
                continue;
            }
            if (!hasChange) {
                markIncludedProcessed();
                updateState.transition(workspaceId, ent.id, activeEvidence, 'non-actionable', runId);
                updateState.updateJob(runId, ent.id, {
                    status: 'completed',
                    input_tokens: entityInputTokens,
                    output_tokens: entityOutputTokens,
                    retry_count: retryCount,
                    evidence_used: activeEvidence.length,
                    proposals_created: 0
                });
                clearEnrichmentError.run(workspaceId, ent.id);
                continue;
            }

            if (policy === 'open') {
                // Clears any review staged while the entity was on 'review'.
                const nextData = { ...(ent.data || {}) };
                delete nextData._enrichPending;
                for (const [field, proposal] of Object.entries(proposedData)) nextData[field] = proposal.value;
                const fields = { data: nextData };
                if (loreChanged) fields.lore = incomingLore;
                entitiesStore.updateEntity(ent.id, fields);
                for (const l of proposedLinks) applyProposedLink(ent.id, l, workspaceId);
                updated++;
            } else {
                // Unresolved review items are preserved.
                const previous = (ent.data?._enrichPending && typeof ent.data._enrichPending === 'object') ? ent.data._enrichPending : {};
                const pending = { ...previous };
                pending.evidence = {
                    ...(previous.evidence || {}),
                    ...Object.fromEntries(activeEvidence.map(entry => [entry.id, {
                        chunkId: entry.chunk.id,
                        excerpt: entityEvidenceExcerpt(entry.chunk.text, ent.canonicalName)
                    }]))
                };
                if (Object.keys(proposedData).length) pending.data = { ...(previous.data || {}), ...proposedData };
                if (loreChanged) pending.lore = { value: incomingLore, evidence: loreProposal.evidence, support: loreProposal.support };
                if (proposedLinks.length) {
                    const priorLinks = Array.isArray(previous.links) ? previous.links : [];
                    const links = new Map(priorLinks.map(link => [`${link.relKey}:${link.targetId}:${link.label || ''}`, link]));
                    for (const link of proposedLinks) links.set(`${link.relKey}:${link.targetId}:${link.label || ''}`, link);
                    pending.links = [...links.values()];
                }
                pending.at = Date.now();
                const nextData = { ...(ent.data || {}), _enrichPending: pending };
                entitiesStore.updateEntity(ent.id, { data: nextData });
                staged++;
            }
            markIncludedProcessed();
            updateState.transition(workspaceId, ent.id, activeEvidence, 'actionable', runId);
            updateState.updateJob(runId, ent.id, {
                status: 'completed',
                input_tokens: entityInputTokens,
                output_tokens: entityOutputTokens,
                retry_count: retryCount,
                evidence_used: activeEvidence.length,
                proposals_created: Object.keys(proposedData).length + proposedLinks.length + (loreChanged ? 1 : 0)
            });
            clearEnrichmentError.run(workspaceId, ent.id);
            if (loreFailure) rememberFailure(ent, loreFailure);
        } catch (e) {
            console.error(`[Enrich] ${ent.canonicalName} failed (continues):`, e.message);
            failed++;
            rememberFailure(ent, e);
            updateState.transition(workspaceId, ent.id, includedEvidence, 'deferred', runId, 'processing-failure');
            updateState.updateJob(runId, ent.id, {
                status: 'failed',
                input_tokens: entityInputTokens,
                output_tokens: entityOutputTokens,
                error: cleanErrorMessage(e)
            });
        }
    }
    if (progressCallback) progressCallback({ phase: 'enriching', done: targets.length, total: targets.length });
    const runStatus = failed || shouldStopEntityUpdates(consecutiveStructuredFailures) ? 'partial' : 'completed';
    const runTotals = updateState.finishRun(runId, runStatus);
    return { entities: targets.length, updated, staged, upToDate, noEvidence, failed, failures, evidenceUsed, taggedEvidenceRemaining, textMatchesSkipped, runId, runStatus, runTotals };
}

// Recap and tags are tracked separately so one failing never costs the other,
// and a retry redoes only what is missing.
const SUMMARY_PART = Object.freeze({ PENDING: 'pending', READY: 'ready', FAILED: 'failed', SKIPPED: 'skipped' });

function writeSummaryBlock(chatId, blockId, changes) {
    const blocks = readMemoryBlocks(db, chatId);
    const next = blocks.map(block => (block && block.id === blockId ? { ...block, ...changes } : block));
    db.prepare('UPDATE chats SET memoryBlocks = ? WHERE id = ?').run(JSON.stringify(next), chatId);
    return next;
}

function pendingBlockChunks(chatId, blockId) {
    return db.prepare(`
        SELECT kc.id, kc.text FROM knowledge_chunks kc
        WHERE kc.ownerId = ? AND kc.ownerType = 'chat_memory' AND kc.memoryBlockId = ?
          AND NOT EXISTS (
            SELECT 1 FROM world_index_chunk_status wis
            WHERE wis.chunkId = kc.id AND wis.status = 'completed'
          )
        ORDER BY kc.createdAt ASC
    `).all(chatId, blockId);
}

// Idempotent per block: rerunning recovers an interrupted or failed pass.
async function finalizeSummaryBlock({ chatId, blockId, onProgress = null }) {
    const report = (stage, done = 0, total = 0) => {
        if (onProgress) {
            try { onProgress({ stage, done, total }); } catch (e) { /* reporting must never break the pass */ }
        }
    };

    const block = readMemoryBlocks(db, chatId).find(entry => entry && entry.id === blockId);
    if (!block) return { success: false, missing: true };

    const messages = Array.isArray(block.messages) ? block.messages : [];
    const transcript = messages
        .filter(message => message && message.role)
        .map(message => `${String(message.role).toUpperCase()}: ${stripReasoning(message.content)}`);
    const rawText = transcript.join('\n\n');

    let title = block.title;
    let summary = block.summary || '';
    let recapStatus = block.recapStatus || SUMMARY_PART.PENDING;
    let recapError = null;

    // Written on its own so a tagging failure cannot take it away.
    if (!isChatArchiveSummarizationEnabled()) {
        recapStatus = SUMMARY_PART.SKIPPED;
    } else if (recapStatus !== SUMMARY_PART.READY && rawText) {
        report('summarizing');
        try {
            const result = await summarizeArchiveSegment(transcript, { maxPayloadTokens: workspacePayloadLimit(chatId) });
            summary = result.summary || summary;
            // A title the user typed is never overwritten by the summarizer.
            if (block.autoTitle && result.title) title = result.title;
            recapStatus = summary ? SUMMARY_PART.READY : SUMMARY_PART.FAILED;
            if (!summary) recapError = 'The Summarizer did not return a usable recap.';
        } catch (smErr) {
            console.error("[Summarizer] archive recap failed (the archive itself is already stored):", smErr);
            recapStatus = SUMMARY_PART.FAILED;
            recapError = cleanErrorMessage(smErr) || 'The Summarizer could not write a recap.';
        }
    }
    writeSummaryBlock(chatId, blockId, { title, summary, recapStatus, recapError });

    let taggingError = null;
    const pending = pendingBlockChunks(chatId, blockId);
    if (pending.length) {
        report('tagging', 0, pending.length);
        try {
            const tagged = await tagChunkRecords(pending, chatId, {
                onProgress: (done, total) => report('tagging', done, total),
                notify: false
            });
            if (tagged.failed) taggingError = tagged.error || 'The Tagger could not process this archive.';
            console.log(`[Tagger] archive block ${blockId}: ${tagged.taggedRecords.length}/${pending.length} chunk(s) done, ${tagged.nameRows} tag row(s) by name, ${tagged.modelRows} by the model.`);
        } catch (tagError) {
            console.error("[Tagger] archive tagging failed (the archive itself is already stored):", tagError);
            taggingError = cleanErrorMessage(tagError) || 'The Tagger could not process this archive.';
        }
    }

    // Status comes from remaining chunks, not from whether a call threw.
    const stillPending = pendingBlockChunks(chatId, blockId).length;
    const taggedChunks = Math.max(0, (block.tagChunkTotal || pending.length) - stillPending);
    const taggingStatus = stillPending > 0 ? SUMMARY_PART.FAILED : SUMMARY_PART.READY;
    const memoryBlocks = writeSummaryBlock(chatId, blockId, {
        title, summary, recapStatus, recapError,
        taggingStatus,
        taggingError: stillPending > 0 ? (taggingError || 'Some passages are still untagged.') : null,
        tagChunkTotal: block.tagChunkTotal || pending.length,
        tagChunksPending: stillPending
    });
    return {
        success: true, blockId, title, summary,
        recapStatus, recapError,
        taggingStatus, taggingError: stillPending > 0 ? (taggingError || 'Some passages are still untagged.') : null,
        tagChunksPending: stillPending, taggedChunks,
        memoryBlocks
    };
}

// On startup, a pending pass has nothing driving it; mark it failed so it can rerun.
function markInterruptedSummaries() {
    const interrupted = (value) => value === SUMMARY_PART.PENDING;
    try {
        const chats = db.prepare('SELECT id, memoryBlocks FROM chats').all();
        for (const chat of chats) {
            const blocks = parseMemoryBlocks(chat.memoryBlocks);
            if (!blocks.some(block => block && (interrupted(block.recapStatus) || interrupted(block.taggingStatus)))) continue;
            const next = blocks.map(block => {
                if (!block) return block;
                const changes = {};
                if (interrupted(block.recapStatus)) {
                    changes.recapStatus = SUMMARY_PART.FAILED;
                    changes.recapError = 'Kallamo closed before the recap was written.';
                }
                if (interrupted(block.taggingStatus)) {
                    changes.taggingStatus = SUMMARY_PART.FAILED;
                    changes.taggingError = 'Kallamo closed before entity tagging finished.';
                }
                return Object.keys(changes).length ? { ...block, ...changes } : block;
            });
            db.prepare('UPDATE chats SET memoryBlocks = ? WHERE id = ?').run(JSON.stringify(next), chat.id);
        }
    } catch (e) {
        console.error('Could not mark interrupted summaries:', e);
    }
}

// Ids are resolved against stored history, so a stale renderer list can't archive
// a message twice or archive one the user muted.
async function executeSummarizationInternal({ chatId, selectedMessages, messageIds, excludedMessageIds, customTitle, profileId, onProgress = null }) {
    const report = (stage, done = 0, total = 0) => {
        if (onProgress) {
            try { onProgress({ stage, done, total }); } catch (e) { /* reporting must never break archiving */ }
        }
    };
    const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId);
    if (!chat) throw new Error("Chat not found");

    const requestedIds = Array.isArray(messageIds) && messageIds.length
        ? messageIds
        : (Array.isArray(selectedMessages) ? selectedMessages : []).map(m => m && m.id);
    const wanted = new Set(requestedIds.filter(Boolean));

    const excludeIds = (Array.isArray(excludedMessageIds) ? excludedMessageIds : []).filter(Boolean);
    if (excludeIds.length > 0) {
        setMessagesExcluded(db, chatId, excludeIds, true);
    }

    const history = db.prepare('SELECT id, role, content, excluded FROM messages WHERE chatId = ? ORDER BY createdAt ASC').all(chatId);
    const covered = coveredMessageIds(chat.memoryBlocks);
    const excludedNow = new Set(excludeIds);

    // Chat order, stored content, nothing already covered, nothing just muted.
    const archiveMessages = history
        .filter(m => wanted.has(m.id) && !covered.has(m.id) && !excludedNow.has(m.id) && m.excluded !== 1)
        .map(m => ({ id: m.id, role: m.role, content: m.content }));

    if (archiveMessages.length === 0) {
        const summarizedIndex = syncSummarizedIndex(db, chatId);
        const memoryBlocks = readMemoryBlocks(db, chatId);
        return { memoryBlocks, summarizedIndex, archivedMessages: 0, excludedMessages: excludeIds.length };
    }

    const rawTextToArchive = archiveMessages.map(m => `${m.role.toUpperCase()}: ${stripReasoning(m.content)}`).join('\n\n');
    const blockId = `block_${Date.now()}`;

    // Changing this size needs a re-index.
    const chunks = chunkText(rawTextToArchive, 800);
    report('indexing', 0, chunks.length);
    const vectors = await vectorizeChunks(chunks, "Chat Archive", (done, total) => report('indexing', done, total));
    vectors.forEach(v => v.blockId = blockId);

    const title = customTitle || "Chat Archive";

    // Persist the raw chunks first so they have ids to tag (verbatim tier).
    try {
        insertChunksToDb(chatId, 'chat_memory', vectors);
    } catch (dbErr) {
        console.error("Failed to insert summarized vectors to SQLite:", dbErr);
    }

    // Written before any AI call: recap and tags are produced afterwards.
    const memoryBlocks = readMemoryBlocks(db, chatId);
    memoryBlocks.push({
        id: blockId,
        title,
        summary: '',
        type: 'summarized',
        messages: archiveMessages,
        autoTitle: !customTitle,
        recapStatus: SUMMARY_PART.PENDING,
        taggingStatus: SUMMARY_PART.PENDING
    });
    db.prepare('UPDATE chats SET memoryBlocks = ? WHERE id = ?').run(JSON.stringify(memoryBlocks), chatId);
    const summarizedIndex = syncSummarizedIndex(db, chatId);

    return {
        memoryBlocks,
        summarizedIndex,
        blockId,
        archivedMessages: archiveMessages.length,
        excludedMessages: excludeIds.length
    };
}

async function checkAndAutoSummarize(chatId, profileId, webContents) {
    try {
        const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId);
        if (!chat || chat.autoSummarize !== 1) return;

        const archiveThreshold = chat.archiveThreshold || 60000;

        const messages = db.prepare('SELECT id, role, content, excluded FROM messages WHERE chatId = ? ORDER BY createdAt ASC').all(chatId);
        const activeMessages = selectActiveMessages(messages, chat.memoryBlocks);

        let tokensUsed = 0;
        activeMessages.forEach(m => {
            tokensUsed += estimateTokens(stripReasoning(m.content));
        });

        // Nothing to offer means nagging would be a dead end: everything left is
        // either already archived or inside the reserved recent window.
        const archivable = selectArchivableMessages(messages, chat.memoryBlocks);

        if (tokensUsed > archiveThreshold && archivable.length > 0) {
            console.log(`[Auto-Summarize] Active tokens (${tokensUsed}) exceed threshold (${archiveThreshold}). Notifying frontend to show selection modal...`);
            webContents.send('trigger-auto-summarize', { chatId, profileId });
        }
    } catch (e) {
        console.error("Auto-summarization failed:", e);
    }
}

function readEntireKbFile(ownerId, fileName) {
    try {
        const rows = db.prepare('SELECT rowid, id, text, ordinal FROM knowledge_chunks WHERE ownerId = ? AND source = ?').all(ownerId, fileName);
        if (rows.length === 0) return "[System: File not found or has no content.]";
        return reconstructKnowledgeFile(rows);
    } catch (e) {
        console.error("Error reading entire KB file from database:", e);
        return `[System: Error reading file: ${e.message}]`;
    }
}

// --- AGENTIC RAG SYSTEM ---

async function executeAgenticRagLoop(profile, chatId, currentInput, chatHistory = [], webContents = null, includeChatContext = true, executor = profile, run = null, options = {}) {
    console.log(`[Agentic RAG] Starting autonomous retrieval loop for: ${profile.name}`);
    const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId);

    // What the research is for. A workflow step feeds the previous step's prose as its input,
    // and ranking passages against generated prose buries the request the user actually made.
    const anchorQuery = String(options.userRequest || '').trim() || currentInput;
    const retrievalBudget = Number(options.retrievalBudget) || 0;

    let currentTurn = 1;
    // Per-profile configurable depth (clamped 1-5). Higher = better multi-hop reasoning, higher cost.
    const maxTurns = Math.min(5, Math.max(1, Number.isInteger(profile.agenticMaxTurns) ? profile.agenticMaxTurns : 3));
    let finished = false;
    let correctionRetries = 0;
    const maxCorrectionRetries = 1; // Free retry (does not consume a turn) when the model emits neither a tool call nor finish.
    let loopDegraded = false; // True if a retrieval error forced an early break; surfaced to the caller.
    const MAX_AGENT_FILE_CHARS = 5000; // read_file truncation for the agent's reasoning only; full text still flows to final context.
    // How many results of one call the agent reads in full. The rest arrive as snippets it can
    // expand, while every one of them still reaches the writing assistant.
    const AGENT_FULL_RESULTS_PER_CALL = 5;
    const SEED_FULL_RESULTS = 5;

    // Search width follows the writer's payload budget, because the results feed the writer.
    // What the planner itself reads is sized by the planner's own window below.
    const toolK = retrievalBudget > 0 ? retrievalTopK(0, retrievalBudget, { tiers: RETRIEVAL_TIERS }) : null;

    // The planner can run on another connection than the writer, often a smaller local model,
    // so its requests are measured against its own context window.
    const plannerLimit = resolvePayloadLimit({ apiProfileId: executor.apiProfileId, maxPayloadTokens: normalizeMaxApiPayload(chat?.maxContext) });
    const plannerMaximum = normalizeMaxApiPayload(plannerLimit.limit);
    const plannerWindow = plannerWindowShape(plannerMaximum);

    const executorKey = `${executor.apiProfileId}:${executor.model}`;
    let protocol = options.toolProtocol !== 'text'
        && (TEXT_PROTOCOL_STRIKES.get(executorKey) || 0) < TEXT_PROTOCOL_STRIKE_LIMIT
        && nativeToolSupport({ apiProfileId: executor.apiProfileId, model: executor.model })
        ? 'native'
        : 'text';
    let nativeConfirmed = false;
    const toolDefinitions = plannerToolDefinitions();
    // Token counts are learned per protocol too: native tool definitions add their own framing.
    const calibrationKey = () => `${executorKey}:${protocol}`;

    const retrievedProfileChunks = new Map();
    const retrievedChatChunks = new Map();
    const retrievedMemories = new Map();
    const retrievedLore = new Map();
    const retrievedWorldFacts = new Map(); // Deterministic Worldbuild registry facts (lore + relations).
    const readFiles = new Map();
    // Ids the free deterministic pass found. They are the floor this loop may not fall below.
    const seededIds = new Set();

    const retrievedIds = () => [
        ...retrievedProfileChunks.keys(), ...retrievedChatChunks.keys(), ...retrievedMemories.keys(),
        ...retrievedLore.keys(), ...retrievedWorldFacts.keys(), ...readFiles.keys()
    ];

    // Keeps the best score a chunk reached across tool calls, and whether a search
    // (not only an entity lookup) found it; both rank it in the final context.
    const rememberRetrieved = (map, result, origin) => {
        const score = Number(result.fusionScore ?? result.score) || 0;
        const previous = map.get(result.id);
        map.set(result.id, {
            text: previous?.text ?? result.text,
            source: result.source,
            memoryBlockId: previous?.memoryBlockId ?? result.memoryBlockId ?? null,
            score: Math.max(score, previous?.score ?? 0),
            origin: previous?.origin === 'search' ? 'search' : origin
        });
    };

    let workspaceKbFiles = [];
    if (includeChatContext && chat && chat.knowledgeFiles) {
        try {
            workspaceKbFiles = typeof chat.knowledgeFiles === 'string'
                ? JSON.parse(chat.knowledgeFiles)
                : (chat.knowledgeFiles || []);
        } catch (e) { workspaceKbFiles = []; }
    }
    let workspaceMemoryBlocks = [];
    if (includeChatContext && chat && chat.memoryBlocks) {
        try {
            workspaceMemoryBlocks = typeof chat.memoryBlocks === 'string'
                ? JSON.parse(chat.memoryBlocks)
                : (chat.memoryBlocks || []);
        } catch (e) { workspaceMemoryBlocks = []; }
    }

    let historyText = '';
    if (Array.isArray(chatHistory) && chatHistory.length > 0) {
        historyText = chatHistory.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
    } else {
        historyText = 'No previous messages in this chat session.';
    }

    const defaultAgenticInstruction = "You are a retrieval planner. Turn the user's request into complete natural-language questions for the search tools, keeping every proper noun exactly as it is written. The search engine is semantic: a whole question retrieves far more than loose keywords.";

    const mainInstruction = profile.agenticPrompt && profile.agenticPrompt.trim()
        ? profile.agenticPrompt.trim()
        : defaultAgenticInstruction;

    // Exact canonical names keep the agent from guessing keywords.
    let knownEntities = [];
    try {
        knownEntities = Array.isArray(options.knownEntities)
            ? options.knownEntities
            : (includeChatContext ? entitiesStore.listEntities({ workspaceId: chatId }) : []);
    } catch (e) { knownEntities = []; }
    const mentionedIds = options.mentionedIds instanceof Set
        ? options.mentionedIds
        : entityMentionIds(anchorQuery, knownEntities);
    const worldMapText = worldMapBlock(knownEntities, {
        mentionedIds,
        recentIds: entityMentionIds(historyText, knownEntities),
        limit: plannerWindow.worldMapLimit
    });

    const sharedHead = `
${getSystemLanguageInstruction()}
${mainInstruction}

You are an expert Research Assistant Agent. Your task is to investigate the knowledge bases and memories of the chat to retrieve all relevant details needed to answer the user's prompt.
You work in a loop of THOUGHT and ACTION (tool calls), up to ${maxTurns} turns. At each turn, analyze what you have found so far, then either call tools or finish.

CONVERSATION HISTORY:
${historyText}

USER PROMPT: "${currentInput}"
${worldMapText}`;

    const textProtocolSection = `
AVAILABLE TOOLS (write every call exactly in this syntax):
${textToolCatalog()}

OUTPUT FORMAT:
Your response MUST contain a THOUGHT section explaining your reasoning, followed by one or more tool calls, OR the <finish> tag.
Never write tool results yourself. Results arrive in the next message; a reply that calls a tool ends there, and a <finish> written alongside a tool call is ignored.
Example output:
THOUGHT: I need to locate where the protagonist meets the dragon and check if the code has a render function.
<tool_call name="search_kb" query="Where does the protagonist meet the dragon?" />
<tool_call name="search_kb" query="Which function renders the story on the canvas?" />

If you have collected all necessary information to answer the prompt, call finish:
THOUGHT: I have retrieved the lore about the dragon from chapter 3 and the render function implementation.
<finish sources="R2, render_implementation.js">Found the dragon's first appearance and the render function.</finish>
`;

    const nativeProtocolSection = `
TOOLS:
The tools are provided as functions, and each description says when to use it. Reply with a short THOUGHT and call one or more tools. End the research only by calling finish with the handles of the results that were relevant. A finish called together with other tools is ignored, because their results have not been seen yet.
`;

    const guidance = `
HOW TO QUERY:
- Write search_kb and search_memories queries as a whole question or statement, in the language of the material, keeping proper nouns exactly as written. Retrieval is semantic first: "What time did Rowan say the shop opens?" reaches what "Rowan shop time" misses.
- The free pre-search below already ran the user's own words. If its strongest results already answer the request, finish on this turn and cite them; otherwise ask something it did not.

CRITICAL DIRECTIVES FOR COST & EFFICIENCY OPTIMIZATION:
- EARLY EXIT: If you have already found all the necessary details to answer the user's prompt (e.g., character relationships, specific descriptions, context), DO NOT run additional tool calls or turns. Finish immediately to minimize token costs.
- AN EMPTY RESULT IS NOT AN ANSWER: a tool that returns nothing only proves those words were not a match. Before concluding that something is unknown, try one different angle: another wording, another tool, or lookup_entity on a name involved. Say that the answer is missing only once that second angle has also come back empty.
- NO REPETITIVE QUERIES: Do not run search queries with identical or very similar terms that you have already executed. Do not read the same file twice. A repeat is refused and still costs you a turn.
- RELEVANCY ONLY: Only query for concepts directly related to the user's prompt. Do not fetch unrelated files or memories.
`;

    const headFor = mode => `${sharedHead}${mode === 'native' ? nativeProtocolSection : textProtocolSection}${guidance}`;
    const systemPromptText = `You are a precise researcher. You communicate strictly using the tools specified. ${getSystemLanguageInstruction()}`;

    const SNIPPET_CHARS = 160;
    const itemRegistry = new Map();   // handle -> { source, full }, backs the expand tool
    const handleIds = new Map();      // handle -> retrieved chunk id, so finish can cite R3
    const coveredSources = new Set();
    const coveredEntities = new Set();
    const executedQueries = new Map(); // query key -> { tool, query, hits, handles }, the repeat guard
    const ledgerEmptyKeys = includeChatContext ? retrievalLedger.emptyQueryKeys(chatId) : new Set();
    let handleSeq = 0;
    const makeSnippet = (t) => {
        const s = String(t || '').replace(/\s+/g, ' ').trim();
        return s.length > SNIPPET_CHARS ? s.slice(0, SNIPPET_CHARS) + '…' : s;
    };

    let finishResponse = '';
    let agenticRagInputTokens = 0;
    let agenticRagOutputTokens = 0;
    const trajectory = {
        anchorQuery,
        toolK,
        protocol,
        finalProtocol: protocol,
        protocolFallback: null,
        stopped: null,
        plannerWindow: { limit: plannerMaximum, source: plannerLimit.source, outputTokens: plannerWindow.outputTokens, tokenRatio: tokenRatio(calibrationKey()) },
        seed: null,
        turns: []
    };

    // One embedding of the request ranks the passages lookup_entity returns.
    let lookupQueryVector = null;
    if (includeChatContext) {
        try { lookupQueryVector = await generateEmbeddingVector(anchorQuery, true); } catch (e) { lookupQueryVector = null; }
    }

    const coverageLine = () => formatCoverage({
        entities: [...coveredEntities],
        sources: [...coveredSources],
        queries: [...executedQueries.values()].map(entry => ({ tool: entry.tool, query: entry.query, hits: entry.hits })),
        items: itemRegistry.size
    });
    const renderItem = (it, full) => it.kind === 'note'
        ? it.text
        : (full && it.preview !== 'digest'
            ? `[${it.handle} · ${it.source}] ${it.full}`
            : `[${it.handle} · ${it.source}]${it.meta ? ` (${it.meta})` : ''} ${makeSnippet(it.full)}`);
    const renderItems = (items, full) => items.map(it => renderItem(it, full)).join(full ? '\n\n' : '\n');

    // Runs one tool call and reports what it yielded. A repeat never reaches the database:
    // its answer is already in the transcript, and running it again cannot change the context.
    const runToolCall = async (call, { pushResult, pushNote }) => {
        const key = queryKey(call.name, call.arg);
        const seen = executedQueries.get(key);
        if (seen) {
            const where = seen.handles.length ? ` See ${seen.handles.join(', ')}.` : '';
            pushNote(`Tool [${call.name}] for "${call.arg}": already executed, ${seen.hits} result(s).${where} Ask something different.`);
            return { tool: call.name, arg: call.arg, hits: seen.hits, status: 'repeat' };
        }
        if (ledgerEmptyKeys.has(key)) {
            pushNote(`Tool [${call.name}] for "${call.arg}": this exact query already returned nothing earlier in this conversation. Try another angle.`);
            executedQueries.set(key, { tool: call.name, query: call.arg, hits: 0, handles: [] });
            return { tool: call.name, arg: call.arg, hits: 0, status: 'known-empty' };
        }

        const firstHandle = handleSeq + 1;
        let hits = 0;

        if (call.name === 'search_kb') {
            const rawProfileResults = await searchKnowledgeBase(call.arg, profile.id, { k: toolK });
            const rawChatKbResults = includeChatContext
                ? await searchChatKnowledgeBase(call.arg, chatId, { k: toolK, boost: true })
                : [];

            const knowledgeFiles = JSON.parse(profile.knowledgeFiles || '[]');
            let constantSnippetTitles = [];
            try {
                constantSnippetTitles = db.getConstantSnippets(profile.id)
                    .map(c => (c.title || '').toLowerCase());
            } catch (e) { }

            const profileResults = rawProfileResults.filter(r => {
                const fileMatch = knowledgeFiles.find(f => f.name.toLowerCase() === r.source.toLowerCase());
                if (fileMatch && (fileMatch.strategy === 'constant' || fileMatch.strategy === 'full_context')) {
                    return false;
                }
                if (constantSnippetTitles.includes(r.source.toLowerCase())) {
                    return false;
                }
                return true;
            });

            const chatKbResults = filterWorkspaceKnowledgeResults(
                rawChatKbResults,
                workspaceKbFiles,
                profile.id
            );

            profileResults.forEach(r => rememberRetrieved(retrievedProfileChunks, r, 'search'));
            if (includeChatContext) {
                chatKbResults.forEach(r => rememberRetrieved(retrievedChatChunks, r, 'search'));
            }

            const combined = [...profileResults, ...chatKbResults];
            hits = combined.length;

            if (combined.length === 0) {
                pushNote(`Tool [search_kb] for "${call.arg}": No matches found.`);
            } else {
                pushNote(`Tool [search_kb] for "${call.arg}": ${combined.length} result(s).`);
                combined.forEach((r, index) => pushResult({
                    id: r.id, source: r.source, full: r.text, score: r.fusionScore ?? r.score,
                    preview: index < AGENT_FULL_RESULTS_PER_CALL ? 'full' : 'digest',
                    meta: `search_kb "${call.arg}"${typeof r.score === 'number' ? ` sim=${r.score.toFixed(2)}` : ''}`
                }));
            }
        } else if (call.name === 'search_memories') {
            const rawMemResults = includeChatContext ? await searchChatMemories(call.arg, chatId, { k: toolK }) : [];

            const memResults = filterWorkspaceMemoryResults(
                rawMemResults,
                workspaceMemoryBlocks,
                profile.id
            );

            if (includeChatContext) {
                memResults.forEach(r => rememberRetrieved(retrievedMemories, r, 'search'));
            }
            hits = memResults.length;

            if (memResults.length === 0) {
                pushNote(`Tool [search_memories] for "${call.arg}": No matches found.`);
            } else {
                pushNote(`Tool [search_memories] for "${call.arg}": ${memResults.length} match(es).`);
                memResults.forEach((r, index) => pushResult({
                    id: r.id, source: r.source, full: r.text, score: r.fusionScore ?? r.score,
                    preview: index < AGENT_FULL_RESULTS_PER_CALL ? 'full' : 'digest',
                    meta: `search_memories "${call.arg}"${typeof r.score === 'number' ? ` sim=${r.score.toFixed(2)}` : ''}`
                }));
            }
        } else if (call.name === 'lookup_entity') {
            // Registry is resolved directly so never-tagged entities are still found.
            let entityChunks = [], entityIds = [], entityChunkTotal = 0;
            if (includeChatContext) {
                const looked = lookupEntityChunks(call.arg, chatId, 'chat_memory', { queryVector: lookupQueryVector, scope: 'workspace' });
                const ranked = looked.chunks || [];
                const allowedMemory = new Set(
                    filterWorkspaceMemoryResults(ranked.filter(r => r.ownerType === 'chat_memory'), workspaceMemoryBlocks, profile.id)
                        .map(r => r.id)
                );
                const allowedKb = new Set(
                    filterWorkspaceKnowledgeResults(ranked.filter(r => r.ownerType === 'chat_kb'), workspaceKbFiles, profile.id)
                        .map(r => r.id)
                );
                const available = ranked.filter(r => r.ownerType === 'document' || allowedMemory.has(r.id) || allowedKb.has(r.id));
                entityChunkTotal = available.length;
                entityChunks = available.slice(0, LOOKUP_ENTITY_CHUNK_LIMIT);
                entityIds = Array.isArray(looked.entityIds) ? [...looked.entityIds] : [];
            }
            let registryEntity = null;
            try {
                const rid = entitiesStore.resolveMention(call.arg, null, chatId);
                if (rid) {
                    registryEntity = entitiesStore.getEntity(rid);
                    if (!entityIds.includes(rid)) entityIds.push(rid);
                }
            } catch (e) { }

            if (includeChatContext) {
                for (const r of entityChunks) {
                    if (r.ownerType === 'chat_kb') rememberRetrieved(retrievedChatChunks, r, 'lookup');
                    else if (r.ownerType === 'document') retrievedLore.set(r.id, { text: r.text, source: r.source, score: Number(r.score) || 0 });
                    else rememberRetrieved(retrievedMemories, r, 'lookup');
                }
            }
            const relLines = [];
            const edgesByEntity = new Map();
            let anyLore = false;
            try {
                for (const eid of entityIds) {
                    const ent = entitiesStore.getEntity(eid);
                    if (!ent) continue;
                    const links = entitiesStore.getLinksFrom(eid) || [];
                    if (links.length) {
                        const edges = links.map(l => `${l.label || l.relType} → ${l.entity ? l.entity.canonicalName : '?'}`).join('; ');
                        relLines.push(`${ent.canonicalName}: ${edges}`);
                        edgesByEntity.set(eid, edges);
                    }
                    if (entitiesStore.linkedLoreDocIds(ent).length) anyLore = true;
                }
            } catch (e) { }

            if (registryEntity) {
                const factParts = [];
                const details = entityDataFacts(registryEntity.data);
                if (details) factParts.push(`Details: ${details}`);
                const desc = registryEntity.data && (registryEntity.data.description || registryEntity.data.content);
                if (desc && String(desc).trim()) factParts.push(`Description: ${String(desc).trim()}`);
                if (registryEntity.lore && String(registryEntity.lore).trim()) factParts.push(`Lore: ${registryEntity.lore}`);
                const ownEdges = edgesByEntity.get(registryEntity.id);
                if (ownEdges) factParts.push(`Relations: ${ownEdges}`);
                if (factParts.length) {
                    retrievedWorldFacts.set(registryEntity.id, {
                        text: `${registryEntity.canonicalName} (${registryEntity.type}) — ${factParts.join(' | ')}`,
                        source: `Worldbuild — ${registryEntity.canonicalName}`,
                        canonicalName: registryEntity.canonicalName,
                        aliases: Array.isArray(registryEntity.aliases) ? registryEntity.aliases : []
                    });
                }
            }

            if (registryEntity) {
                coveredEntities.add(registryEntity.canonicalName);
                if (includeChatContext) retrievalLedger.recordEntity(chatId, registryEntity.canonicalName);
                let head = `Worldbuild entity ${registryEntity.canonicalName} (${registryEntity.type})`;
                const headDetails = entityDataFacts(registryEntity.data);
                if (headDetails) head += ` [${headDetails}]`;
                const headDesc = registryEntity.data && (registryEntity.data.description || registryEntity.data.content);
                if (headDesc && String(headDesc).trim()) head += ` — ${String(headDesc).trim()}`;
                if (registryEntity.lore && String(registryEntity.lore).trim()) head += `: ${registryEntity.lore}`;
                pushResult({ source: registryEntity.canonicalName, full: head, meta: `lookup_entity "${call.arg}"` });
            }
            entityChunks.forEach((r, index) => pushResult({
                id: r.id, source: r.source, full: r.text,
                preview: index < AGENT_FULL_RESULTS_PER_CALL ? 'full' : 'digest',
                meta: `lookup_entity "${call.arg}"`
            }));
            hits = entityChunks.length + (registryEntity ? 1 : 0);
            if (entityChunkTotal > entityChunks.length) {
                pushNote(`Tool [lookup_entity] for "${call.arg}": showing the ${entityChunks.length} passages most relevant to the request out of ${entityChunkTotal} tagged. Use search_memories with specific terms to reach others.`);
            }
            if (!registryEntity && entityChunks.length === 0 && relLines.length === 0) {
                pushNote(`Tool [lookup_entity] for "${call.arg}": No known entity matched.`);
            }
            if (relLines.length) {
                pushNote(`RELATED ENTITIES (follow with lookup_entity): ${relLines.join(' | ')}`);
            }
            if (anyLore) {
                pushNote(`NOTE: this entity has linked lore — call read_lore with "${call.arg}" for its authored background.`);
            }
        } else if (call.name === 'read_lore') {
            let loreResults = [];
            let docTitle = '';
            if (includeChatContext) {
                try {
                    const looked = lookupEntityChunks(call.arg, chatId, 'chat_memory', { idsOnly: true, scope: 'workspace' });
                    const ids = Array.isArray(looked.entityIds) ? [...looked.entityIds] : [];
                    try {
                        const rid = entitiesStore.resolveMention(call.arg, null, chatId);
                        if (rid && !ids.includes(rid)) ids.push(rid);
                    } catch (e) { }
                    let loreDocIds = [];
                    for (const eid of ids) {
                        const ent = entitiesStore.getEntity(eid);
                        const docs = ent ? entitiesStore.linkedLoreDocIds(ent) : [];
                        if (docs.length) { loreDocIds = docs; docTitle = ent.canonicalName; break; }
                    }
                    if (loreDocIds.length) {
                        loreResults = await searchLoreDocuments(anchorQuery, loreDocIds, { k: toolK });
                    }
                } catch (e) { }
            }
            hits = loreResults.length;
            if (loreResults.length === 0) {
                pushNote(`Tool [read_lore] for "${call.arg}": No linked lore document, or no relevant passages found.`);
            } else {
                pushNote(`Tool [read_lore] for "${call.arg}": ${loreResults.length} passage(s) from linked lore of ${docTitle}.`);
                loreResults.forEach((r, index) => {
                    const text = r.text || '';
                    retrievedLore.set(r.id, { text, source: r.source || docTitle, score: Number(r.fusionScore ?? r.score) || 0 });
                    const agentText = text.length > MAX_AGENT_FILE_CHARS
                        ? text.slice(0, MAX_AGENT_FILE_CHARS) + '\n[...truncated for agent reasoning; the full passage is preserved for the final context...]'
                        : text;
                    pushResult({
                        id: r.id, source: r.source || docTitle, full: agentText,
                        preview: index < AGENT_FULL_RESULTS_PER_CALL ? 'full' : 'digest',
                        meta: `read_lore "${call.arg}"`
                    });
                });
            }
        } else if (call.name === 'read_file') {
            let isConstant = false;
            try {
                const kbFiles = JSON.parse(profile.knowledgeFiles || '[]');
                const fileMatch = kbFiles.find(f => f.name.toLowerCase() === call.arg.toLowerCase());
                if (fileMatch && (!fileMatch.strategy || fileMatch.strategy === 'constant' || fileMatch.strategy === 'full_context')) {
                    isConstant = true;
                }
            } catch (e) { }

            if (!isConstant && includeChatContext) {
                const fileMatch = workspaceKbFiles.find(f => String(f.name || '').toLowerCase() === call.arg.toLowerCase());
                if (fileMatch && (!fileMatch.profiles || fileMatch.profiles.length === 0 || fileMatch.profiles.includes(profile.id))
                    && (!fileMatch.strategy || fileMatch.strategy === 'constant' || fileMatch.strategy === 'full_context')) {
                    isConstant = true;
                }
            }

            if (!isConstant) {
                try {
                    const snippetMatch = db.getConstantSnippets(profile.id)
                        .find(c => (c.title || '').toLowerCase() === call.arg.toLowerCase());
                    if (snippetMatch) {
                        isConstant = true;
                    }
                } catch (e) { }
            }

            if (!isConstant && includeChatContext) {
                const snippetMatch = workspaceMemoryBlocks.find(s => s.type === 'manual'
                    && (s.title || s.source || '').toLowerCase() === call.arg.toLowerCase()
                    && (!s.profiles || s.profiles.length === 0 || s.profiles.includes(profile.id))
                    && s.strategy === 'constant');
                if (snippetMatch) {
                    isConstant = true;
                }
            }

            if (isConstant) {
                pushNote(`Tool [read_file] for "${call.arg}": Access Denied — "${call.arg}" is a Constant context block already permanently included in the main prompt.`);
            } else {
                let fileText = readEntireKbFile(profile.id, call.arg);
                let fileSource = 'profile';
                if (fileText.startsWith("[System: File not found") && includeChatContext) {
                    const allowed = workspaceKbFiles.some(file =>
                        String(file.name || '').toLowerCase() === call.arg.toLowerCase()
                        && file.enabled !== false
                        && (!file.profiles || file.profiles.length === 0 || file.profiles.includes(profile.id))
                    );
                    if (allowed) {
                        fileText = readEntireKbFile(chatId, call.arg);
                        fileSource = 'chat';
                    }
                }

                if (!fileText.startsWith("[System: File not found")) {
                    readFiles.set(call.arg, { text: fileText, source: fileSource });
                    hits = 1;
                }

                // Truncated for the agent only; readFiles keeps the full text.
                let agentFileText = fileText;
                if (fileText.length > MAX_AGENT_FILE_CHARS) {
                    agentFileText = fileText.slice(0, MAX_AGENT_FILE_CHARS) +
                        `\n[...truncated at ${MAX_AGENT_FILE_CHARS} chars for agent reasoning; the full file is preserved for the final context...]`;
                }

                pushResult({ source: call.arg, full: agentFileText, meta: `read_file (${fileSource})` });
            }
        } else if (call.name === 'expand') {
            // Re-read one previously summarized item's full text into THIS turn only.
            const hit = itemRegistry.get(call.arg) ||
                [...itemRegistry.values()].find(v => entitiesStore.normalizeName(v.source) === entitiesStore.normalizeName(call.arg));
            if (hit) {
                hits = 1;
                pushNote(`Tool [expand] "${call.arg}":\n[${hit.source}] ${hit.full}`);
            } else {
                pushNote(`Tool [expand] "${call.arg}": no such retrieved item.`);
            }
        }

        const handles = [];
        for (let n = firstHandle; n <= handleSeq; n++) handles.push(`R${n}`);
        executedQueries.set(key, { tool: call.name, query: call.arg, hits, handles });
        if (includeChatContext && call.name !== 'expand') {
            retrievalLedger.recordQuery(chatId, { key, tool: call.name, query: call.arg, hits });
        }
        return { tool: call.name, arg: call.arg, hits, status: 'ran' };
    };

    // Collects one tool call's results into renderable items.
    const createCollector = () => {
        const turnItems = [];
        const pushResult = ({ id, source, full, meta, preview, score }) => {
            const handle = `R${++handleSeq}`;
            itemRegistry.set(handle, { source, full });
            if (id) handleIds.set(handle, id);
            if (source) coveredSources.add(source);
            turnItems.push({ kind: 'result', handle, source: source || '?', full: full || '', meta: meta || '', preview: preview || 'full', score: Number(score) || 0 });
            return handle;
        };
        const pushNote = (text) => turnItems.push({ kind: 'note', text });
        return { turnItems, pushResult, pushNote };
    };

    const nextStepLine = (turnAboutToRun) => (turnAboutToRun >= maxTurns
        ? `TURN ${turnAboutToRun}/${maxTurns}. This is your LAST turn: finish now. A tool call now still runs and its results still reach the writing assistant, but you will not see them.`
        : `TURN ${turnAboutToRun}/${maxTurns}. What is your next step?`);

    // The free pass the deterministic path would have made anyway. It is the floor of this
    // loop, and it keeps turn 1 from spending a model call to rediscover the obvious.
    let seedBlock = '';
    try {
        const seed = createCollector();
        const seedCalls = [{ name: 'search_kb', arg: anchorQuery }];
        if (includeChatContext) seedCalls.push({ name: 'search_memories', arg: anchorQuery });
        const seedRuns = [];
        for (const call of seedCalls) {
            seedRuns.push(await runToolCall(call, seed));
        }
        for (const map of [retrievedProfileChunks, retrievedChatChunks, retrievedMemories]) {
            for (const id of map.keys()) seededIds.add(id);
        }
        trajectory.seed = { calls: seedRuns, items: seededIds.size, ids: [...seededIds] };
        if (seed.turnItems.length) {
            // The strongest passages are shown whole, so a pre-search that already answers lets the
            // planner finish at once instead of spending a turn to expand them. The preview is bounded
            // by the planner's window; every seeded passage reaches the writer either way.
            const ranked = seed.turnItems.filter(it => it.kind === 'result').sort((a, b) => b.score - a.score);
            const shownInFull = new Set();
            const fullLines = [];
            const snippetLines = [];
            let used = 0;
            let hidden = 0;
            for (const it of ranked.slice(0, SEED_FULL_RESULTS)) {
                const line = `[${it.handle} · ${it.source}] ${it.full}`;
                const cost = estimateTokens(line);
                if (used + cost > plannerWindow.seedPreviewTokens) continue;
                fullLines.push(line);
                shownInFull.add(it);
                used += cost;
            }
            for (const it of seed.turnItems) {
                if (shownInFull.has(it)) continue;
                const line = renderItem(it, false);
                const cost = estimateTokens(line);
                if (it.kind === 'result' && used + cost > plannerWindow.seedPreviewTokens) {
                    hidden++;
                    continue;
                }
                snippetLines.push(line);
                used += cost;
            }
            if (hidden) snippetLines.push(`(${hidden} more pre-search result(s) are already in the final context and not shown here.)`);
            const strongest = fullLines.length
                ? `STRONGEST RESULTS, IN FULL (if these already answer the request, finish now and cite them):\n${fullLines.join('\n\n')}\n\n`
                : '';
            seedBlock = `PRE-SEARCH RESULTS (free deterministic retrieval for the user's request; already included in the final context):\n${coverageLine()}\n\n${strongest}OTHER RESULTS (snippets you can expand):\n${snippetLines.join('\n')}`;
        }
        console.log(`[Agentic RAG] Pre-search seeded ${seededIds.size} passage(s) before turn 1.`);
    } catch (err) {
        console.warn('[Agentic RAG] Pre-search failed, continuing without a floor:', err.message);
    }

    // The transcript is neutral and only grows, so either protocol can render it and a
    // provider that reuses prefixes reads each earlier turn back from cache.
    const transcript = [];
    const firstUserText = mode => `${headFor(mode)}\n${seedBlock ? `${seedBlock}\n\n` : ''}${nextStepLine(1)}`;
    const resultsOf = (step, joiner) => step.results.map(result => (step.downgraded ? result.digest : result.full)).join(joiner);

    const renderTextMessages = () => {
        const messages = [{ role: 'user', content: firstUserText('text') }];
        for (const step of transcript) {
            if (step.kind === 'correction') {
                messages.push({ role: 'assistant', content: step.text || '(empty reply)' });
                messages.push({ role: 'user', content: step.notice });
                continue;
            }
            const assistant = step.textReply != null
                ? step.textReply
                : [step.thought, ...step.calls.map(renderTextCall)].filter(Boolean).join('\n');
            messages.push({ role: 'assistant', content: assistant || '(empty reply)' });
            const label = step.downgraded ? 'TOOL RESULTS (earlier, summarized)' : 'TOOL RESULTS';
            messages.push({ role: 'user', content: `${label}:\n${step.coverage}\n\n${resultsOf(step, step.downgraded ? '\n' : '\n\n')}\n\n${step.footer}` });
        }
        return messages;
    };

    const renderNativeConversation = () => {
        const conversation = [{ role: 'user', text: firstUserText('native') }];
        for (const step of transcript) {
            if (step.kind === 'correction') {
                conversation.push({ role: 'assistant', text: step.text || '(empty reply)', toolCalls: [] });
                conversation.push({ role: 'user', text: step.notice });
                continue;
            }
            conversation.push({ role: 'assistant', text: step.thought, toolCalls: step.calls, raw: step.raw, rawFormat: step.rawFormat });
            conversation.push({
                role: 'tool',
                results: step.results.map(result => ({ id: result.id, name: result.name, content: step.downgraded ? result.digest : result.full }))
            });
            conversation.push({ role: 'user', text: `${step.coverage}\n\n${step.footer}` });
        }
        return conversation;
    };

    const estimateRequest = () => estimatePayloadTokens({
        systemPrompt: systemPromptText,
        chatHistory: protocol === 'native' ? flattenConversation(renderNativeConversation(), toolDefinitions) : renderTextMessages(),
        newPrompt: '',
        outputTokens: plannerWindow.outputTokens,
        maxPayloadTokens: plannerMaximum
    });
    // Measured with the correction learned from what this model really counted.
    const fitsPlannerWindow = () => {
        const estimate = estimateRequest();
        return calibrateTokens(calibrationKey(), estimate.inputTokens) + estimate.reservedOutputTokens + estimate.safetyMarginTokens <= plannerMaximum;
    };

    const requestPlannerTurn = () => {
        const request = {
            apiProfileId: executor.apiProfileId,
            model: executor.model,
            systemPrompt: systemPromptText,
            temperature: 0.1,
            maxTokens: plannerWindow.outputTokens,
            maxPayloadTokens: normalizeMaxApiPayload(chat?.maxContext),
            manualMode: false,
            manualJson: '',
            abortSignal: run?.controller?.signal,
            cachePrefix: true
        };
        if (protocol === 'native') {
            return sendAgentRequest({ ...request, conversation: renderNativeConversation(), tools: toolDefinitions });
        }
        const messages = renderTextMessages();
        return sendAgentRequest({ ...request, chatHistory: messages.slice(0, -1), newPrompt: messages[messages.length - 1].content });
    };

    const abandonNative = (reason, permanent) => {
        protocol = 'text';
        trajectory.finalProtocol = 'text';
        trajectory.protocolFallback = reason;
        const strikes = permanent ? TEXT_PROTOCOL_STRIKE_LIMIT : (TEXT_PROTOCOL_STRIKES.get(executorKey) || 0) + 1;
        TEXT_PROTOCOL_STRIKES.set(executorKey, strikes);
        console.warn(`[Agentic RAG] Falling back to the text protocol: ${reason}.`);
    };

    while (currentTurn <= maxTurns && !finished) {
        throwIfRunCancelled(run);
        console.log(`[Agentic RAG] Turn ${currentTurn}/${maxTurns}`);
        if (webContents) {
            sendRunEvent(webContents, 'workflow-progress', run, {
                profileName: profile.name,
                status: `Agentic RAG: Investigating... (Turn ${currentTurn}/${maxTurns})`
            });
        }

        if (!downgradeUntilFits(transcript.filter(step => step.kind === 'turn'), fitsPlannerWindow)) {
            trajectory.stopped = `the research no longer fits the planner model's context window of ${plannerMaximum} tokens`;
            console.warn(`[Agentic RAG] Stopping: ${trajectory.stopped}.`);
            break;
        }

        const before = new Set(retrievedIds());
        const turnRecord = { turn: currentTurn, protocol, calls: [], inputTokens: 0, outputTokens: 0, providerUsage: null, newItems: 0, newIds: [], finished: false };
        trajectory.turns.push(turnRecord);

        try {
            turnRecord.inputTokens = estimateRequest().inputTokens;
            agenticRagInputTokens += turnRecord.inputTokens;

            let reply;
            try {
                reply = await requestPlannerTurn();
            } catch (requestError) {
                const aborted = Boolean(run?.controller?.signal?.aborted) || requestError?.name === 'AbortError';
                if (aborted || protocol !== 'native' || nativeConfirmed || requestError?.code === 'MAX_API_PAYLOAD_EXCEEDED') throw requestError;
                turnRecord.calls.push({ tool: '-', arg: '', hits: 0, status: 'native-request-failed' });
                abandonNative(`the native request failed: ${String(requestError?.message || requestError).slice(0, 160)}`, true);
                continue;
            }

            const agentOutput = reply.content || '';
            turnRecord.outputTokens = estimateTokens(agentOutput) + estimateTokens(reply.toolCalls && reply.toolCalls.length ? JSON.stringify(reply.toolCalls) : '');
            turnRecord.providerUsage = reply.usage || null;
            if (reply.usage && reply.usage.totalInputTokens != null) {
                turnRecord.tokenRatio = recordTokenCount(calibrationKey(), turnRecord.inputTokens, reply.usage.totalInputTokens);
            }
            agenticRagOutputTokens += turnRecord.outputTokens;

            console.log(`[Agentic RAG] Agent output:\n${agentOutput}${reply.toolCalls && reply.toolCalls.length ? `\n${JSON.stringify(reply.toolCalls)}` : ''}`);

            // Reasoning is never read as an action, in either protocol.
            const thought = stripReasoning(agentOutput);
            let calls = [];
            let finishMatch = null;
            let ignoredFinishes = [];

            if (protocol === 'native') {
                const nativeCalls = (reply.toolCalls || []).map((call, index) => ({
                    // Google matches responses by name when it sent no id, so none is invented there.
                    id: call.id || (reply.rawFormat === 'google' ? null : `call_${currentTurn}_${index}`),
                    name: String(call.name || '').toLowerCase(),
                    args: call.args || {}
                }));
                if (!nativeCalls.length && !nativeConfirmed) {
                    turnRecord.calls.push({ tool: '-', arg: '', hits: 0, status: 'no-native-call' });
                    abandonNative('the first native reply called no tool', false);
                    continue;
                }
                if (nativeCalls.length && !nativeConfirmed) {
                    nativeConfirmed = true;
                    TEXT_PROTOCOL_STRIKES.delete(executorKey);
                }
                const finishes = nativeCalls.filter(call => call.name === 'finish');
                calls = nativeCalls.filter(call => call.name !== 'finish');
                if (!nativeCalls.length) {
                    // After tools have worked once, a plain reply is the model concluding.
                    finishMatch = { sources: '', body: thought };
                } else if (!calls.length) {
                    const args = finishes[0].args || {};
                    finishMatch = {
                        sources: Array.isArray(args.sources) ? args.sources.join(', ') : String(args.sources || ''),
                        body: String(args.summary || '')
                    };
                } else if (finishes.length) {
                    ignoredFinishes = finishes;
                    console.log('[Agentic RAG] Ignoring a finish called alongside other tools; their results had not been delivered yet.');
                }
            } else {
                const parsed = parseAgentTurn(agentOutput);
                if (parsed.imaginedFinish) {
                    console.log('[Agentic RAG] Ignoring a finish written alongside tool calls; the results had not been delivered yet.');
                }
                calls = parsed.toolCalls.map(call => ({ id: null, name: call.name, args: { query: call.arg } }));
                finishMatch = parsed.finish ? { sources: parsed.finish.sources, body: parsed.finish.body } : null;
            }

            if (finishMatch) {
                const sourcesAttr = finishMatch.sources;
                finishResponse = String(finishMatch.body || '').trim();
                finished = true;
                turnRecord.finished = true;

                if (sourcesAttr) {
                    const citations = parseCitations(sourcesAttr);
                    const allowedSources = citations.names;
                    const cited = {
                        names: allowedSources,
                        ids: new Set([...citations.handles].map(handle => handleIds.get(handle)).filter(Boolean))
                    };
                    console.log(`[Agentic RAG] Agent specified relevant sources:`, sourcesAttr);

                    // Uncited results are demoted, never dropped: a citation by character name
                    // must not empty the context of the archive passages that mention them.
                    for (const map of [retrievedProfileChunks, retrievedChatChunks, retrievedMemories, retrievedLore]) {
                        for (const [id, chunk] of map.entries()) {
                            if (!isCitedChunk({ id, ...chunk }, cited)) map.set(id, { ...chunk, uncited: true });
                        }
                    }
                    for (const [filename, data] of readFiles.entries()) {
                        const filenameLower = filename.toLowerCase();
                        const matches = allowedSources.some(src => filenameLower.includes(src) || src.includes(filenameLower));
                        if (!matches) readFiles.set(filename, { ...data, uncited: true });
                    }

                    // Facts prune by entity identity, not fuzzy chunk matching.
                    const norm = entitiesStore.normalizeName;
                    const normalizedSources = allowedSources.map(s => norm(s)).filter(Boolean);
                    for (const [id, fact] of retrievedWorldFacts.entries()) {
                        const factText = norm(fact.text || '');
                        const keep = normalizedSources.some(s =>
                            norm(fact.canonicalName || '') === s ||
                            (fact.aliases || []).some(a => norm(a) === s) ||
                            factText.includes(s)
                        );
                        if (!keep) retrievedWorldFacts.set(id, { ...fact, uncited: true });
                    }
                }
                break;
            }

            // Only the text protocol can produce a reply that is neither a call nor a finish.
            if (calls.length === 0) {
                if (correctionRetries < maxCorrectionRetries) {
                    correctionRetries++;
                    console.warn(`[Agentic RAG] Malformed turn (no valid tool_call/finish). Correction retry ${correctionRetries}/${maxCorrectionRetries}.`);
                    turnRecord.calls.push({ tool: '-', arg: '', hits: 0, status: 'malformed' });
                    transcript.push({
                        kind: 'correction',
                        text: thought,
                        notice: `Your last response did not contain a valid <tool_call .../> or <finish>...</finish>. Respond using ONLY the exact tool syntax. Example: <tool_call name="search_kb" query="..." />. If you already have enough information, use <finish sources="...">brief note</finish>.`
                    });
                    continue; // does not increment currentTurn
                }
                console.warn('[Agentic RAG] Correction budget exhausted; finishing with whatever context was gathered.');
                turnRecord.calls.push({ tool: '-', arg: '', hits: 0, status: 'malformed' });
                finishResponse = '';
                finished = true;
                break;
            }

            const results = [];
            for (const call of calls) {
                const collector = createCollector();
                const arg = argOf(call.name, call.args);
                if (!TOOL_NAMES.includes(call.name)) {
                    collector.pushNote(`Tool [${call.name}]: there is no such tool. Use only the tools provided.`);
                    turnRecord.calls.push({ tool: call.name, arg, hits: 0, status: 'unknown-tool' });
                } else if (!arg) {
                    collector.pushNote(`Tool [${call.name}]: the call had no argument, so nothing was searched.`);
                    turnRecord.calls.push({ tool: call.name, arg: '', hits: 0, status: 'missing-argument' });
                } else {
                    console.log(`[Agentic RAG] Executing tool: ${call.name} with: "${arg}"`);
                    turnRecord.calls.push(await runToolCall({ name: call.name, arg }, collector));
                }
                const full = renderItems(collector.turnItems, true);
                results.push({ id: call.id, name: call.name, full: full || '(no output)', digest: renderItems(collector.turnItems, false) || '(no output)' });
            }
            for (const ignored of ignoredFinishes) {
                const note = 'finish ignored: it was called together with other tools, before their results were seen.';
                results.push({ id: ignored.id, name: 'finish', full: note, digest: note });
            }

            turnRecord.newIds = retrievedIds().filter(id => !before.has(id));
            turnRecord.newItems = turnRecord.newIds.length;

            transcript.push({
                kind: 'turn',
                thought: protocol === 'native' ? thought : '',
                textReply: protocol === 'text' ? thought : null,
                calls: [...calls, ...ignoredFinishes],
                raw: protocol === 'native' ? reply.raw : null,
                rawFormat: protocol === 'native' ? reply.rawFormat : null,
                results,
                coverage: coverageLine(),
                footer: nextStepLine(currentTurn + 1),
                downgraded: false
            });

            currentTurn++;

        } catch (err) {
            console.error(`[Agentic RAG] Loop error at turn ${currentTurn}:`, err);
            loopDegraded = true;
            if (webContents) {
                sendRunEvent(webContents, 'workflow-progress', run, {
                    profileName: profile.name,
                    status: 'Agentic RAG: retrieval error, continuing with partial context'
                });
            }
            break; // preserve whatever was gathered in prior turns
        }
    }

    // Tier sets packing priority: facts, read files, search hits, lookup-only passages, uncited.
    // What the free pre-search found never falls to the bottom tier: the deterministic path
    // would have sent it, and the agent staying silent about it is not evidence against it.
    const UNCITED_TIER = 4;
    const SEEDED_UNCITED_TIER = 3;
    const uncitedTier = (ids) => (ids.some(id => seededIds.has(id)) ? SEEDED_UNCITED_TIER : UNCITED_TIER);
    const sections = {
        profile: '--- PROFILE KNOWLEDGE BASE CHUNKS ---',
        files: '--- READ FILES CONTENT ---',
        chat: '--- CHAT KNOWLEDGE BASE CHUNKS ---',
        memory: '--- CHAT SUMMARIZED MEMORIES & SNIPPETS ---',
        lore: '--- LINKED LORE (WRITING DESK) ---',
        facts: '--- WORLDBUILD FACTS ---'
    };
    const contextItems = [];
    for (const [id, r] of retrievedProfileChunks.entries()) {
        contextItems.push({ section: sections.profile, ids: [id], text: `[Result from Profile KB - ${r.source}]: ${r.text}`, tier: r.uncited ? uncitedTier([id]) : 2, score: r.score || 0, origin: 'profile' });
    }
    for (const [filename, data] of readFiles.entries()) {
        contextItems.push({
            section: sections.files,
            ids: [filename],
            text: `[File Contents: ${filename}]:\n${data.text}`,
            tier: data.uncited ? UNCITED_TIER : 1,
            truncatable: true,
            origin: data.source === 'profile' ? 'profile' : 'chat'
        });
    }
    for (const [id, r] of retrievedChatChunks.entries()) {
        contextItems.push({ section: sections.chat, ids: [id], text: `[Result from Chat KB - ${r.source}]: ${r.text}`, tier: r.uncited ? uncitedTier([id]) : 2, score: r.score || 0, origin: 'chat' });
    }
    const memoryPassages = expandMemoryResults([...retrievedMemories.entries()].map(([id, r]) => ({ id, ...r })), chatId);
    for (const r of memoryPassages) {
        const ids = r.ids || [r.id];
        contextItems.push({ section: sections.memory, ids, text: `[Chat Memory]: ${r.text}`, tier: r.uncited ? uncitedTier(ids) : (r.origin === 'search' ? 2 : 3), score: r.score || 0, origin: 'chat' });
    }
    for (const [id, r] of retrievedLore.entries()) {
        contextItems.push({ section: sections.lore, ids: [id], text: `[Linked Lore - ${r.source}]: ${r.text}`, tier: r.uncited ? uncitedTier([id]) : 2, score: r.score || 0, origin: 'chat' });
    }
    for (const [id, r] of retrievedWorldFacts.entries()) {
        contextItems.push({ section: sections.facts, ids: [id], text: `[${r.source}]: ${r.text}`, tier: r.uncited ? SEEDED_UNCITED_TIER : 0, truncatable: true, origin: 'chat' });
    }

    return {
        agenticResponse: finishResponse || '[Agent passed context directly — no summary needed]',
        contextItems,
        contextSections: Object.values(sections),
        agenticInputTokens: agenticRagInputTokens,
        agenticOutputTokens: agenticRagOutputTokens,
        degraded: loopDegraded,
        trajectory
    };
}

// --- EXPORTS ---

module.exports = {
    runWorkflow,
    executeAgenticRagLoop,
    cancelGeneration,
    resolveErrorDeferred,
    resolveOverflowDeferred,
    executeSummarizationInternal,
    finalizeSummaryBlock,
    markInterruptedSummaries,
    SUMMARY_PART,
    backfillWorldIndex,
    vectorizeDocument,
    retagDocumentChunks,
    enrichEntities,
    tagChunkRecords,
    applyChunkTags,
    computeDocumentVectorStatus,
    checkAndAutoSummarize,
    getSystemAiConfiguration
};
