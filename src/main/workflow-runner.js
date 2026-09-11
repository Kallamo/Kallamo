const db = require('./database');
const entitiesStore = require('./entities');
const { sendApiRequest, getReservedOutputTokens, resolvePayloadLimit, createPromptVariableResolver } = require('./features/llm/llm.service');
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
const { TAGGER_RESPONSE_SCHEMA, parseTaggerResponse, createTaggerBatches, proposalDataForMention } = require('./features/world-index/tagger-response');
const { matchedEvidence, evidenceText } = require('./features/world-index/evidence-match');
const { buildCategoryResolver } = require('./features/world-index/category-match');
const {
    PAYLOAD_BUDGET_CONTRACT,
    assertPayloadWithinLimit,
    getAvailableHistoryTokens,
    normalizeMaxApiPayload,
    safetyMarginFor
} = require('./features/llm/payload-budget');
const {
    packContextItems,
    renderContextSections,
    selectRecentWithinBudget,
    splitRetrievalBudget,
    truncateToTokens
} = require('./features/llm/context-budget');
const { stripReasoning } = require('./features/chat/message-text');
const { reconstructKnowledgeFile } = require('./features/knowledge/kb-reconstruct');
const { parseCitations, isCitedChunk } = require('./features/knowledge/cited-sources');
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
    executeMultiOwnerSearch,
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

// The retrieval planner reads the recent conversation on every research turn. A
// fixed window keeps that prompt small no matter how long the replies are.
const PLANNER_HISTORY_BUDGET_TOKENS = 6000;

// A file the agent read, or an entity's lore, may take at most this share of the
// retrieval budget; the rest stays available for search results.
const AGENTIC_ITEM_MAX_SHARE = 0.6;

// Passages lookup_entity hands the agent (and the final context) per call.
const LOOKUP_ENTITY_CHUNK_LIMIT = 12;

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
            if (profile.isAgentic === 1 && retrievalPlanner.executor) {
                let ragChatHistory = [];
                if (i === 0 || includeChatHistory) {
                    ragChatHistory = formatActiveHistory(
                        activeMessages.slice(-10),
                        Math.min(availableForContext, PLANNER_HISTORY_BUDGET_TOKENS)
                    );
                }

                const agenticResult = await executeAgenticRagLoop(profile, chatId, currentInput, ragChatHistory, webContents, includeChatContext, retrievalPlanner.executor, currentRun);
                if (agenticResult) {
                    const packed = packContextItems(agenticResult.contextItems, retrievalBudget, {
                        estimate: estimateTokens,
                        maxItemShare: AGENTIC_ITEM_MAX_SHARE
                    });
                    retrievalOmitted += packed.dropped + packed.truncated;
                    if (agenticResult.degraded) agenticDegraded = true;
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
                const retrievalItems = [];
                let searchQuery = currentInput;
                const results = await searchKnowledgeBase(searchQuery, profile.id);
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
                    const chatKbResults = await searchChatKnowledgeBase(currentInput, chatId);
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
                    const memoryResults = await searchChatMemories(currentInput, chatId);
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
                    agenticRagContextGathered: capDebugText(lastAgenticRagContextGathered)
                } : {}),
                ...(debugSettings.ragDebug ? { standardRagContextGathered: capDebugText(lastStandardRagDebug) } : {}),
                context: { historySent, historyDropped, retrievalOmitted, agenticDegraded },
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

// A per-call fenced marker for the structured-items block, so the model can't
// collide with content. Random suffix, ASCII so it survives any provider.
function buildItemsFence() {
    const s = crypto.randomBytes(3).toString('hex');
    return { open: `<<ITEMS_${s}>>`, close: `<</ITEMS_${s}>>` };
}

// Tolerant: grab the first [...] block and JSON.parse it. Any failure -> [].
function safeParseArray(body) {
    if (!body) return [];
    try {
        const start = body.indexOf('[');
        const end = body.lastIndexOf(']');
        if (start === -1 || end === -1 || end < start) return [];
        const parsed = JSON.parse(body.slice(start, end + 1));
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
}

function describeTagRejections(rejections) {
    const counts = new Map();
    const samples = new Map();
    for (const entry of rejections) {
        counts.set(entry.reason, (counts.get(entry.reason) || 0) + 1);
        if (!samples.has(entry.reason)) samples.set(entry.reason, entry.detail);
    }
    const wording = {
        'unknown-category': (n, sample) => `${n} used a category this workspace does not have (for example "${sample}")`,
        'no-name': (n) => `${n} carried no name`,
        'evidence-not-found': (n, sample) => `${n} quoted text that is not in the chunk (for example "${sample}")`
    };
    const parts = [];
    for (const [reason, count] of [...counts.entries()].sort((a, b) => b[1] - a[1])) {
        const describe = wording[reason];
        if (describe) parts.push(describe(count, samples.get(reason)));
    }
    return parts.join('; ');
}

// `rejections` records why each mention was dropped: an unknown category and
// unquoted evidence need opposite fixes, so the error must name which one.
function validateChunkTags(arr, categories, chunkRecords, rejections = null) {
    const reject = (reason, detail) => {
        if (rejections) rejections.push({ reason, detail });
    };
    const chunkCount = Array.isArray(chunkRecords) ? chunkRecords.length : Number(chunkRecords) || 0;
    // Tolerates the label the model actually writes (singular for plural, casing,
    // accents) while still only ever resolving to a category this workspace has.
    const resolveCategory = buildCategoryResolver(categories);
    const out = [];
    for (const entry of (Array.isArray(arr) ? arr : [])) {
        if (!entry || typeof entry !== 'object') continue;
        const idx = Number(entry.chunk);
        if (!Number.isInteger(idx) || idx < 0 || idx >= chunkCount) continue;
        const tags = [];
        const chunkText = Array.isArray(chunkRecords) ? String(chunkRecords[idx]?.text || '') : '';
        for (const mention of (Array.isArray(entry.mentions) ? entry.mentions : [])) {
            const rawType = String(mention && (mention.type || mention.tag) || '').trim();
            const name = resolveCategory(rawType);
            const value = String(mention && (mention.canonicalName || mention.value || mention.text) || '').trim();
            // Store the excerpt the chunk actually supports, not everything the
            // model offered: it may answer with several, only some of them real.
            const evidence = matchedEvidence(chunkText, mention && mention.evidence);
            if (!name) { reject('unknown-category', rawType || '(empty)'); continue; }
            if (!value) { reject('no-name', rawType); continue; }
            if (!evidence) { reject('evidence-not-found', evidenceText(mention && mention.evidence).slice(0, 160)); continue; }
            const proposalKind = String(mention && mention.proposalKind || '').trim().toLowerCase();
            tags.push({ tag: name, value, evidence, proposalKind });
        }
        for (const rt of (Array.isArray(entry.tags) ? entry.tags : [])) {
            const name = resolveCategory(rt && rt.tag);
            if (!name) continue;
            const values = Array.isArray(rt.values) ? rt.values : (rt.value ? [rt.value] : []);
            for (const v of values) {
                const val = String(v == null ? '' : v).trim();
                if (val && val.toLowerCase() !== 'null') tags.push({ tag: name, value: val });
            }
        }
        if (tags.length) out.push({ chunkIndex: idx, tags });
    }
    return out;
}

// Split the model reply into title + summary (the pre-fence head) and the raw body
// (the fenced JSON, or any trailing array if the fence is missing). Tolerant.
function splitHeadAndBody(response, fence) {
    const raw = String(response || '');
    const openIdx = raw.indexOf(fence.open);

    let body = '';
    let headEnd;
    if (openIdx !== -1) {
        const afterOpen = openIdx + fence.open.length;
        const closeIdx = raw.indexOf(fence.close, afterOpen);
        body = raw.slice(afterOpen, closeIdx === -1 ? undefined : closeIdx);
        headEnd = openIdx;
    } else {
        const firstBracket = raw.indexOf('[');
        body = firstBracket === -1 ? '' : raw.slice(firstBracket);
        headEnd = firstBracket === -1 ? raw.length : firstBracket;
    }

    const head = raw.slice(0, headEnd);
    const lines = head.split('\n');
    let title = 'Archived Memory';
    let summary = head.trim();
    if (lines[0] && lines[0].toUpperCase().startsWith('TITLE:')) {
        title = lines[0].substring(6).trim() || title;
        summary = lines.slice(1).join('\n').trim();
    }
    return { title, summary, body };
}

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
    const normalizedSource = entitiesStore.normalizeName(sourceText);
    for (const r of rows) {
        let aliases = [];
        try { const a = JSON.parse(r.aliases); if (Array.isArray(a)) aliases = a; } catch (e) { }
        if (normalizedSource) {
            const names = [r.canonicalName, ...aliases].map(entitiesStore.normalizeName).filter(Boolean);
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

// Kept low: higher earns 429s, and it only pays off with the backoff below.
const TAGGER_CONCURRENCY = 3;

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

// Results keep input order regardless of completion order.
async function mapWithConcurrency(items, limit, worker) {
    const results = new Array(items.length);
    let next = 0;
    const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
        while (true) {
            const index = next++;
            if (index >= items.length) return;
            results[index] = await worker(items[index], index);
        }
    });
    await Promise.all(runners);
    return results;
}

async function classifyAndTagSegment(chunkRecords, profile, workspaceId = null, onProgress = null, { notify = true } = {}) {
    let title = 'Archived Memory';
    let summary = '';
    let chunkTags = [];

    const tagger = getRoleExecutor(ROLE_IDS.TAGGER);
    if (!tagger.executor) return { title, summary, chunkTags, failed: Boolean(tagger.error), error: tagger.error };
    const { apiProfileId, model } = tagger.executor;
    const manualMode = false;
    const manualJson = null;

    let categories = [];
    try { categories = db.prepare('SELECT name, description FROM tags WHERE isEntity = 1').all(); } catch (e) { categories = []; }

    const catLines = categories.length
        ? categories.map(c => `- ${c.name}: ${c.description}`).join('\n')
        : '- Characters: People, beings, or named agents present in the scene.';

    let offset = 0;
    const batches = createTaggerBatches(chunkRecords).map(records => {
        const entry = { start: offset, records };
        offset += records.length;
        return entry;
    });

    // Successful batches are kept; the first error marks the pass incomplete.
    let firstError = null;
    let chunksDone = 0;

    const runBatch = async ({ start, records }, batchIndex) => {
        const numbered = records.map((c, i) => `[CHUNK ${i}]\n${c.text}`).join('\n\n');
        const vocab = buildEntityVocab(workspaceId, numbered);
        const systemPrompt =
            getSystemLanguageInstruction() + "\n" +
            "You tag a text segment that is split into numbered chunks.\n" +
            "For EACH chunk, identify the specific persistent story entities explicitly named in the text. A persistent entity is something a user would reasonably find and reuse in a world bible.\n" +
            catLines + "\n" +
            (vocab ? vocab + "\n" : "") +
            "Resolve titles, shortened names, and aliases to the supplied canonical name when the text supports that match. Never propose a name already present in Known entities, even under another category. Do not turn generic nouns, unnamed roles, pronouns, descriptive phrases, or ordinary objects into entities. A role alone (for example captain, duke, guard, blacksmith), a generic organization word (order, guild, army), or an ordinary object (sword, spear, cane, coat) is not an entity. Distinctive reusable world-specific items or materials (for example Dragon Mead or Salamander Leather) are valid item types even when they are not unique objects. When identity or category is ambiguous, omit the mention. Every mention must include a short verbatim evidence excerpt copied from that chunk. " +
            "Use ONLY these category names; skip a chunk when it has no qualifying named entity. " +
            "Return one valid JSON object and nothing else. Its exact shape is " +
            "{\"items\": [{\"chunk\": <number>, \"mentions\": [{\"text\": \"<surface text>\", \"canonicalName\": \"<existing canonical name or exact explicit name>\", \"type\": \"<Category>\", \"proposalKind\": \"known|named|world_specific_type\", \"evidence\": \"<verbatim excerpt>\"}]}]}. " +
            "Use proposalKind=known only for a supplied Known entity, named for a specific proper entity or unique named artifact, and world_specific_type only for a distinctive reusable Items type or material. Never use named for a generic role, category, or ordinary object. " +
            "Use {\"items\": []} only when none of the chunks contains a qualifying named entity.";

        const maxTokens = 4096;
        const request = (prompt, repair = false) => sendTaggerRequest({
            apiProfileId, model, systemPrompt,
            chatHistory: [],
            newPrompt: prompt,
            temperature: repair ? 0 : 0.1,
            maxTokens,
            manualMode, manualJson,
            jsonMode: true,
            jsonSchema: TAGGER_RESPONSE_SCHEMA
        });

        try {
            let response = await request(numbered);
            let structured = parseTaggerResponse(response);
            let rejections = [];
            let validated = structured.valid ? validateChunkTags(structured.items, categories, records, rejections) : [];
            const needsRepair = !structured.valid || (structured.items.length > 0 && validated.length === 0);
            if (needsRepair) {
                response = await request(
                    `Repair the response below to the exact required JSON shape. Preserve only mentions supported by the original numbered chunks.\n\nORIGINAL CHUNKS:\n${numbered}\n\nINVALID RESPONSE:\n${String(response || '').slice(0, 12000)}`,
                    true
                );
                structured = parseTaggerResponse(response);
                rejections = [];
                validated = structured.valid ? validateChunkTags(structured.items, categories, records, rejections) : [];
            }
            if (!structured.valid) throw new Error('The Tagger returned invalid structured JSON after one repair attempt.');
            if (structured.items.length > 0 && validated.length === 0) {
                const detail = describeTagRejections(rejections);
                console.error('[World Index] every mention was rejected:', JSON.stringify(rejections.slice(0, 10), null, 2));
                throw new Error(detail
                    ? `The Tagger returned mentions, but none could be used: ${detail}.`
                    : 'The Tagger returned mentions, but none could be used.');
            }
            // Chunk indexes come back relative to the batch; shift them onto the segment.
            return { tags: validated.map(entry => ({ ...entry, chunkIndex: entry.chunkIndex + start })), error: null, records };
        } catch (e) {
            console.error(`[World Index] classify+tag failed on batch ${batchIndex + 1}/${batches.length}:`, e);
            return { tags: [], error: e, records };
        } finally {
            // In chunks, the unit the caller announced the total in.
            chunksDone += records.length;
            if (onProgress) onProgress(Math.min(chunksDone, chunkRecords.length), chunkRecords.length);
        }
    };

    const outcomes = await mapWithConcurrency(batches, TAGGER_CONCURRENCY, runBatch);
    const taggedRecords = [];
    const failedRecords = [];
    for (const outcome of outcomes) {
        if (outcome.error) {
            if (!firstError) firstError = outcome.error;
            failedRecords.push(...outcome.records);
            continue;
        }
        chunkTags.push(...outcome.tags);
        taggedRecords.push(...outcome.records);
    }

    if (firstError) {
        // notify:false is for callers that report the failure themselves.
        if (notify) notifyTaggingFailure(firstError);
        return { title, summary, chunkTags, taggedRecords, failedRecords, failed: true, error: cleanErrorMessage(firstError) };
    }
    return { title, summary, chunkTags, taggedRecords, failedRecords };
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

function applyChunkTags(chunkTags, chunkRecords, workspaceId = null) {
    if (!getRoleExecutor(ROLE_IDS.TAGGER).executor) return 0;
    if (!Array.isArray(chunkTags) || !chunkTags.length) return 0;
    const insert = db.prepare('INSERT OR IGNORE INTO chunk_tags (chunkId, tag, entity, manual) VALUES (?, ?, ?, 0)');
    const isSuppressed = db.prepare('SELECT 1 FROM chunk_tag_suppressions WHERE chunkId = ? AND tag = ? AND entity = ?');
    // Within a run the cache dedupes proposals; across runs resolveEntity finds them.
    const allowCreate = allowAiEntityCreation();
    const proposedCache = new Map();
    let rows = 0;
    db.transaction(() => {
        for (const entry of chunkTags) {
            const rec = chunkRecords[entry.chunkIndex];
            if (!rec || !rec.id) continue;
            // Document chunks have ownerId = documentId, so the caller's workspace wins.
            const ws = workspaceId || rec.ownerId;
            for (const t of entry.tags) {
                let entityRef = resolveEntity(ws, t.tag, t.value);
                if (!entityRef) entityRef = resolveEntity(ws, null, t.value);
                if (!entityRef && allowCreate) {
                    const proposalData = proposalDataForMention(t.tag, t.proposalKind);
                    if (!proposalData) continue;
                    const key = `${ws || ''}|${t.tag}|${entitiesStore.normalizeName(t.value)}`;
                    if (proposedCache.has(key)) {
                        entityRef = proposedCache.get(key);
                    } else {
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
                if (!isSuppressed.get(rec.id, resolvedTag, entityRef)) {
                    insert.run(rec.id, resolvedTag, entityRef);
                    rows++;
                }
            }
        }
    })();
    return rows;
}

// chatId null backfills every chat.
async function backfillWorldIndex(chatId = null, { batchSize = 12, full = false, tier = 'archive', chunkIds = null, runId = null, progressCallback = null } = {}) {
    const tagger = getRoleExecutor(ROLE_IDS.TAGGER);
    if (!tagger.executor) throw new Error(tagger.error || 'Tagger is disabled.');
    const apiProfileId = tagger.executor.apiProfileId;
    const model = tagger.executor.model;
    const manualMode = false;
    const manualJson = null;

    let categories = [];
    try { categories = db.prepare('SELECT name, description FROM tags WHERE isEntity = 1').all(); } catch (e) { categories = []; }
    if (!categories.length) throw new Error('No entity tag categories seeded');
    const catLines = categories.map(c => `- ${c.name}: ${c.description}`).join('\n');
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

    const saveCoverage = db.prepare(`
        INSERT INTO world_index_chunk_status (chunkId, status, tagCount, lastRunId, error, updatedAt)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(chunkId) DO UPDATE SET
          status = excluded.status,
          tagCount = excluded.tagCount,
          lastRunId = excluded.lastRunId,
          error = excluded.error,
          updatedAt = excluded.updatedAt
    `);
    const countAutomaticTags = db.prepare("SELECT COUNT(*) AS count FROM chunk_tags WHERE chunkId = ? AND (manual IS NULL OR manual = 0)");

    // Retry on provider rate-limits (Bedrock "Too many requests") with exponential
    // backoff so the run completes instead of dropping batches.
    const callWithRetry = async (payload, tries = 5) => {
        let delay = 2000;
        for (let attempt = 1; attempt <= tries; attempt++) {
            try {
                return await sendApiRequest(payload);
            } catch (e) {
                const msg = String((e && e.message) || e);
                const rateLimited = /too many requests|rate.?limit|429|throttl/i.test(msg);
                if (attempt === tries || !rateLimited) throw e;
                await new Promise(r => setTimeout(r, delay));
                delay = Math.min(delay * 2, 30000);
            }
        }
    };

    let tagged = 0, batches = 0, processed = 0, taggedChunks = 0, empty = 0, failed = 0, lastError = null;
    for (let i = 0; i < chunks.length; i += batchSize) {
        if (i > 0) await new Promise(r => setTimeout(r, 600)); // gentle pacing between batches
        const batch = chunks.slice(i, i + batchSize);
        const numbered = batch.map((c, idx) => `[CHUNK ${idx}]\n${c.text}`).join('\n\n');
        const batchVocab = buildEntityVocab(chatId, numbered);
        const fence = buildItemsFence();
        const systemPrompt =
            getSystemLanguageInstruction() + "\n" +
            "You tag conversation chunks. For EACH numbered chunk, identify persistent story entities explicitly named in the text, grouped under these categories:\n" +
            catLines + "\n" +
            (batchVocab ? batchVocab + "\n" : "") +
            "Resolve aliases to supplied canonical names. Never propose an entity already present in Known entities. Omit generic nouns, unnamed roles, pronouns, descriptive phrases, and ambiguous identities. Every mention must include a short verbatim evidence excerpt copied from that chunk. Use ONLY these category names. " +
            "Output ONLY a JSON array wrapped exactly once in " + fence.open + " and " + fence.close + ", " +
            "one element per chunk that has any entity: {\"chunk\": <number>, \"mentions\": [{\"text\": \"<surface text>\", \"canonicalName\": \"<canonical or exact explicit name>\", \"type\": \"<Category>\", \"evidence\": \"<verbatim excerpt>\"}]}. " +
            "Write nothing else.";
        try {
            const response = await callWithRetry({ apiProfileId, model, systemPrompt, chatHistory: [], newPrompt: numbered, temperature: 0.3, maxTokens: 1500, manualMode, manualJson });
            const head = splitHeadAndBody(response, fence);
            const chunkTags = validateChunkTags(safeParseArray(head.body), categories, batch);
            tagged += applyChunkTags(chunkTags, batch, chatId);
            const now = Date.now();
            db.transaction(() => {
                for (const chunk of batch) {
                    const tagCount = countAutomaticTags.get(chunk.id).count;
                    saveCoverage.run(chunk.id, 'completed', tagCount, runId, null, now);
                    if (tagCount) taggedChunks++; else empty++;
                }
            })();
            processed += batch.length;
        } catch (e) {
            console.error(`[World Index][backfill] batch ${batches} failed:`, e.message);
            const now = Date.now();
            const message = e.message || String(e);
            db.transaction(() => {
                for (const chunk of batch) saveCoverage.run(chunk.id, 'failed', 0, runId, message, now);
            })();
            failed += batch.length;
            lastError = message;
        }
        batches++;
        console.log(`[World Index][backfill] batch ${batches}: ${Math.min(i + batchSize, chunks.length)}/${chunks.length} chunks, ${tagged} tag row(s) so far.`);
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

        if (getRoleExecutor(ROLE_IDS.TAGGER).executor) {
                try {
                    const records = vectors.map(v => ({ id: v.id, text: v.text, ownerId: doc.workspaceId }));
                    const batches = createTaggerBatches(records);
                    let processed = 0;
                    for (const batch of batches) {
                        const cls = await classifyAndTagSegment(batch, null, doc.workspaceId);
                        if (cls.failed) throw new Error(cls.error || 'Tagger failed.');
                        applyChunkTags(cls.chunkTags, batch, doc.workspaceId);
                        processed += batch.length;
                        if (progressCallback) progressCallback({ phase: 'tagging', done: processed, total: records.length });
                    }
                } catch (e) {
                    console.error('[Vectorize Document] tagging failed (vectorization continues):', e.message);
                    db.prepare('UPDATE documents SET vectorized = 1 WHERE id = ?').run(documentId);
                    throw new Error(`Entity tagging failed: ${e.message}. Text embeddings were preserved.`);
                }
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

    // Without a Tagger, keep the existing tags.
    if (!getRoleExecutor(ROLE_IDS.TAGGER).executor) return { tagged: 0, chunks: rows.length, skipped: true };

    const del = db.prepare('DELETE FROM chunk_tags WHERE chunkId = ?');
    db.transaction(() => { for (const r of rows) del.run(r.id); })();

    const profile = db.prepare('SELECT * FROM writing_profiles LIMIT 1').get();
    const records = rows.map(r => ({ id: r.id, text: r.text, ownerId: doc.workspaceId }));
    let tagged = 0;
    const batches = createTaggerBatches(records);
    let processed = 0;
    for (const batch of batches) {
        try {
            const cls = await classifyAndTagSegment(batch, profile, doc.workspaceId);
            if (cls.failed) throw new Error(cls.error || 'Tagger failed.');
            tagged += applyChunkTags(cls.chunkTags, batch, doc.workspaceId);
            processed += batch.length;
            if (progressCallback) progressCallback({ phase: 'tagging', done: processed, total: records.length });
        } catch (e) {
            console.error('[Retag Document] batch failed:', e.message);
            throw new Error(`Entity tagging failed: ${e.message}`);
        }
    }
    return { tagged, chunks: rows.length };
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

function recordChunkCoverage(records, status, error = null) {
    if (!Array.isArray(records) || !records.length) return;
    const save = db.prepare(`
        INSERT INTO world_index_chunk_status (chunkId, status, tagCount, lastRunId, error, updatedAt)
        VALUES (?, ?, 0, NULL, ?, ?)
        ON CONFLICT(chunkId) DO UPDATE SET
          status = excluded.status,
          error = excluded.error,
          updatedAt = excluded.updatedAt
    `);
    const now = Date.now();
    db.transaction(() => {
        for (const record of records) save.run(record.id, status, error, now);
    })();
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
            const tagged = await classifyAndTagSegment(
                pending, null, chatId,
                (done, total) => report('tagging', done, total),
                { notify: false }
            );
            const written = applyChunkTags(tagged.chunkTags, pending, chatId);
            recordChunkCoverage(tagged.taggedRecords || [], 'completed');
            if (tagged.failed) {
                taggingError = cleanErrorMessage(tagged.error) || 'The Tagger could not process this archive.';
                recordChunkCoverage(tagged.failedRecords || [], 'failed', taggingError);
            }
            console.log(`[Tagger] archive block ${blockId}: ${tagged.chunkTags.length}/${pending.length} chunk(s) tagged, ${written} tag row(s).`);
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

async function executeAgenticRagLoop(profile, chatId, currentInput, chatHistory = [], webContents = null, includeChatContext = true, executor = profile, run = null) {
    console.log(`[Agentic RAG] Starting autonomous retrieval loop for: ${profile.name}`);
    const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId);

    let currentTurn = 1;
    // Per-profile configurable depth (clamped 1-5). Higher = better multi-hop reasoning, higher cost.
    const maxTurns = Math.min(5, Math.max(1, Number.isInteger(profile.agenticMaxTurns) ? profile.agenticMaxTurns : 3));
    let finished = false;
    let correctionRetries = 0;
    const maxCorrectionRetries = 1; // Free retry (does not consume a turn) when the model emits neither a tool call nor finish.
    let loopDegraded = false; // True if a retrieval error forced an early break; surfaced to the caller.
    const MAX_AGENT_FILE_CHARS = 5000; // read_file truncation for the agent's reasoning only; full text still flows to final context.

    const retrievedProfileChunks = new Map();
    const retrievedChatChunks = new Map();
    const retrievedMemories = new Map();
    const retrievedLore = new Map();
    const retrievedWorldFacts = new Map(); // Deterministic Worldbuild registry facts (lore + relations); exempt from finish-sources pruning.
    const readFiles = new Map();

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

    let historyText = '';
    if (Array.isArray(chatHistory) && chatHistory.length > 0) {
        historyText = chatHistory.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
    } else {
        historyText = 'No previous messages in this chat session.';
    }

    const defaultAgenticInstruction = "You are a search query optimizer. Extract the specific names, proper nouns, and primary search keywords from the user prompt. Always keep specific names and proper nouns intact. Output ONLY the optimized query terms without quotes, introduction, or explanation.";

    const mainInstruction = profile.agenticPrompt && profile.agenticPrompt.trim()
        ? profile.agenticPrompt.trim()
        : defaultAgenticInstruction;

    // Exact canonical names keep the agent from guessing keywords.
    let worldMapBlock = '';
    try {
        const known = includeChatContext ? entitiesStore.listEntities({ workspaceId: chatId }) : [];
        if (known.length > 0) {
            const lines = known.slice(0, 60).map(e => {
                const aka = (e.aliases && e.aliases.length) ? ` (aka ${e.aliases.join(', ')})` : '';
                return `- ${e.canonicalName} [${e.type}]${aka}`;
            }).join('\n');
            worldMapBlock = `\nKNOWN ENTITIES IN THIS WORLD (use these EXACT names in your queries; prefer lookup_entity to gather everything known about one of them):\n${lines}\n`;
        }
    } catch (e) { }

    const toolsPrompt = `
${getSystemLanguageInstruction()}
${mainInstruction}

You are an expert Research Assistant Agent. Your task is to investigate the knowledge bases and memories of the chat to retrieve all relevant details needed to answer the user's prompt.
You must run in a loop of THOUGHT and ACTION (tool calls), up to ${maxTurns} turns maximum.
At each turn, analyze what you have found so far, and output either one or more tool calls OR your final research findings inside the finish block.

CONVERSATION HISTORY:
${historyText}

USER PROMPT: "${currentInput}"
${worldMapBlock}
AVAILABLE TOOLS:
1. <tool_call name="search_kb" query="search terms" />
   Searches the profile's and chat's knowledge base files for matching concepts.
2. <tool_call name="read_file" filename="filename.txt" />
   Reads the entire text of a specific file in the knowledge base (useful to get complete code or full lore/character profile).
3. <tool_call name="search_memories" query="search terms or #tags" />
   Searches the chat's past summarized memory blocks, custom snippets, and manual tags (e.g. query for keywords or exact hashtags like #character, #backstory).
4. <tool_call name="lookup_entity" query="entity name or alias" />
   Returns the memory chunks tagged with a known world entity (see KNOWN ENTITIES) that are most relevant to the user prompt, by exact name or alias. Passages that only mention the entity in passing may be untagged, so use search_memories with specific terms (e.g. what was said, a time, a place) when looking for one detail. Also lists that entity's RELATED ENTITIES (its graph edges, e.g. "owns → Star Paradox; ally_of → Port Brea"). Prefer this over search_kb/search_memories when the user prompt refers to a known entity and you want its full dossier (traits, relationships, history). Follow a listed relation with another lookup_entity to traverse the world by structure instead of guessing from prose. Use search_kb/search_memories for concepts, scenes, or things not in the entity list.
5. <tool_call name="read_lore" query="entity name or alias" />
   For an entity that has a linked lore document (Writing Desk), returns the passages of that document most relevant to the user prompt. Use it when lookup_entity shows an entity has authored lore and you need its canonical background, not just scene mentions. Does nothing if the entity has no linked lore.
6. <tool_call name="expand" query="R3 or a source name" />
   Re-reads the FULL text of a previously retrieved item that was summarized in an earlier turn (results are shown by a handle like [R3 · source]). Use it only when a summarized item's snippet is not enough to decide. Everything you retrieve is already sent to the writing assistant in full — expand is just for YOUR reasoning.
7. <finish sources="source1, source2, ...">summary of retrieved facts</finish>
   Concludes your research. Inside the 'sources' attribute, list the result handles (e.g. R3, R7) and exact filenames of the retrieved contexts that were ACTUALLY relevant to the user prompt. Listed sources are given priority in the final context.
   If no sources are listed or if you omit the attribute, all searched contexts are included with equal priority.
   Only state facts that appear verbatim in the tool results. If the results do not contain the answer, say so instead of guessing.
   
   CRITICAL SUMMARY RULE: Keep the text content inside the <finish> tag extremely short and concise (1-2 sentences maximum, e.g., "Found Jonathan's resume file"). DO NOT write a full summary, quote, or copy the content of the files/chunks inside the tag, as the system automatically retrieves and sends the full raw content of your listed sources to the writing assistant.

CRITICAL DIRECTIVES FOR COST & EFFICIENCY OPTIMIZATION:
- EARLY EXIT: If you have already found all the necessary details to answer the user's prompt (e.g., character relationships, specific descriptions, context), DO NOT run additional tool calls or turns. Immediately call <finish> to conclude your research and minimize token costs.
- NO REPETITIVE QUERIES: Do not run search queries with identical or very similar terms that you have already executed. Do not read the same file twice.
- RELEVANCY ONLY: Only query for concepts directly related to the user's prompt. Do not fetch unrelated files or memories.

OUTPUT FORMAT:
Your response MUST contain a THOUGHT section explaining your reasoning, followed by one or more tool calls, OR the <finish> tag.
Example output:
THOUGHT: I need to locate where the protagonist meets the dragon and check if the code has a render function.
<tool_call name="search_kb" query="protagonista dragão encontro" />
<tool_call name="search_kb" query="render function" />

If you have collected all necessary information to answer the prompt, call finish:
THOUGHT: I have retrieved the lore about the dragon from chapter 3 and the render function implementation.
<finish sources="dragon_lore.txt, render_implementation.js">
- Dragon met in Chapter 3: "The Dragon of the Mist".
- Code function renderStory(canvas) uses canvas 2d context to draw.
</finish>
`;

    let messages = [
        { role: 'user', content: toolsPrompt }
    ];

    // Final context comes from the retrieved* maps, so older turns can shrink to a digest.
    const LEAN_AGENT_HISTORY = true;
    const LEAN_HISTORY_BUDGET_TOKENS = 1200;
    const LEAN_HISTORY_KEEP_TURNS = 1; // newest N turns are always kept in full
    const SNIPPET_CHARS = 160;
    const turnLog = [];               // { msgIndex, digestContent, fullTokens, digestTokens, downgraded }
    const itemRegistry = new Map();   // handle -> { source, full }, backs the expand tool
    const handleIds = new Map();      // handle -> retrieved chunk id, so finish can cite R3
    const coveredSources = new Set();
    const coveredEntities = new Set();
    let handleSeq = 0;
    const makeSnippet = (t) => {
        const s = String(t || '').replace(/\s+/g, ' ').trim();
        return s.length > SNIPPET_CHARS ? s.slice(0, SNIPPET_CHARS) + '…' : s;
    };

    let finishResponse = '';
    let agenticRagInputTokens = 0;
    let agenticRagOutputTokens = 0;

    // One embedding of the request ranks the passages lookup_entity returns.
    let lookupQueryVector = null;
    if (includeChatContext) {
        try { lookupQueryVector = await generateEmbeddingVector(currentInput, true); } catch (e) { lookupQueryVector = null; }
    }

    while (currentTurn <= maxTurns && !finished) {
        throwIfRunCancelled(run);
        console.log(`[Agentic RAG] Turn ${currentTurn}/${maxTurns}`);
        if (webContents) {
            sendRunEvent(webContents, 'workflow-progress', run, {
                profileName: profile.name,
                status: `Agentic RAG: Investigating... (Turn ${currentTurn}/${maxTurns})`
            });
        }

        try {
            const systemPromptText = `You are a precise researcher. You communicate strictly using the tools specified. ${getSystemLanguageInstruction()}`;
            const messagesText = JSON.stringify(messages);
            agenticRagInputTokens += estimateTokens(systemPromptText) + estimateTokens(messagesText);

            const agentOutput = await sendApiRequest({
                apiProfileId: executor.apiProfileId,
                model: executor.model,
                systemPrompt: systemPromptText,
                chatHistory: [],
                newPrompt: messagesText,
                temperature: 0.1,
                maxTokens: 4000,
                maxPayloadTokens: normalizeMaxApiPayload(chat?.maxContext),
                manualMode: false,
                manualJson: '',
                abortSignal: run?.controller?.signal
            });

            agenticRagOutputTokens += estimateTokens(agentOutput);

            console.log(`[Agentic RAG] Agent output:\n${agentOutput}`);

            // Tolerant attribute parser: accepts double quotes, single quotes, or unquoted values, in any order.
            const parseAttrs = (attrStr) => {
                const attrs = {};
                const attrRegex = /([\w-]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/g;
                let m;
                while ((m = attrRegex.exec(attrStr)) !== null) {
                    attrs[m[1].toLowerCase()] = (m[2] ?? m[3] ?? m[4] ?? '').trim();
                }
                return attrs;
            };

            const KNOWN_TOOLS = ['search_kb', 'read_file', 'search_memories', 'lookup_entity', 'read_lore', 'expand'];

            // Models vary: accept any quoting, order, arg alias, or inner-text arg.
            const toolCalls = [];
            const toolBlockRegex = /<tool_call\b([^>]*?)\/?>([\s\S]*?<\/tool_call>)?/gi;
            let tb;
            while ((tb = toolBlockRegex.exec(agentOutput)) !== null) {
                const attrs = parseAttrs(tb[1] || '');
                const name = (attrs.name || '').toLowerCase();
                let arg = attrs.query ?? attrs.filename ?? attrs.file ?? attrs.q ?? attrs.term ?? attrs.arg ?? '';
                if (!arg && tb[2]) {
                    arg = tb[2].replace(/<\/tool_call>/i, '').trim();
                }
                if (KNOWN_TOOLS.includes(name) && arg) {
                    toolCalls.push({ name, arg });
                }
            }

            // Tolerant finish parsing: flexible sources quoting.
            let finishMatch = null;
            const finishBlock = /<finish\b([^>]*)>([\s\S]*?)<\/finish>/i.exec(agentOutput);
            if (finishBlock) {
                const finishAttrs = parseAttrs(finishBlock[1] || '');
                finishMatch = { sources: finishAttrs.sources || '', body: finishBlock[2] };
            }

            if (finishMatch) {
                const sourcesAttr = finishMatch.sources;
                finishResponse = finishMatch.body.trim();
                finished = true;

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
                    for (const map of [retrievedProfileChunks, retrievedChatChunks, retrievedMemories]) {
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
                        if (!keep) retrievedWorldFacts.delete(id);
                    }
                }
                break;
            }

            // Never treat raw THOUGHT text as the answer; correct once, for free.
            if (toolCalls.length === 0) {
                if (correctionRetries < maxCorrectionRetries) {
                    correctionRetries++;
                    console.warn(`[Agentic RAG] Malformed turn (no valid tool_call/finish). Correction retry ${correctionRetries}/${maxCorrectionRetries}.`);
                    messages.push({ role: 'assistant', content: agentOutput });
                    messages.push({
                        role: 'user',
                        content: `Your last response did not contain a valid <tool_call .../> or <finish>...</finish>. Respond using ONLY the exact tool syntax. Example: <tool_call name="search_kb" query="..." />. If you already have enough information, use <finish sources="...">brief note</finish>.`
                    });
                    continue; // does not increment currentTurn
                }
                console.warn('[Agentic RAG] Correction budget exhausted; finishing with whatever context was gathered.');
                finishResponse = '';
                finished = true;
                break;
            }

            const turnItems = []; // { kind:'result', handle, source, full, meta } | { kind:'note', text }
            const pushResult = ({ id, source, full, meta }) => {
                const handle = `R${++handleSeq}`;
                itemRegistry.set(handle, { source, full });
                if (id) handleIds.set(handle, id);
                if (source) coveredSources.add(source);
                turnItems.push({ kind: 'result', handle, source: source || '?', full: full || '', meta: meta || '' });
                return handle;
            };
            const pushNote = (text) => turnItems.push({ kind: 'note', text });
            for (const call of toolCalls) {
                console.log(`[Agentic RAG] Executing tool: ${call.name} with: "${call.arg}"`);

                if (call.name === 'search_kb') {
                    const rawProfileResults = await searchKnowledgeBase(call.arg, profile.id);
                    const rawChatKbResults = includeChatContext ? await searchChatKnowledgeBase(call.arg, chatId) : [];

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

                    let chatKbFiles = [];
                    if (includeChatContext && chat && chat.knowledgeFiles) {
                        try {
                            chatKbFiles = typeof chat.knowledgeFiles === 'string'
                                ? JSON.parse(chat.knowledgeFiles)
                                : (chat.knowledgeFiles || []);
                        } catch (e) { }
                    }
                    const chatKbResults = filterWorkspaceKnowledgeResults(
                        rawChatKbResults,
                        chatKbFiles,
                        profile.id
                    );

                    profileResults.forEach(r => rememberRetrieved(retrievedProfileChunks, r, 'search'));
                    if (includeChatContext) {
                        chatKbResults.forEach(r => rememberRetrieved(retrievedChatChunks, r, 'search'));
                    }

                    const combined = [...profileResults, ...chatKbResults];

                    if (combined.length === 0) {
                        pushNote(`Tool [search_kb] for "${call.arg}": No matches found.`);
                    } else {
                        pushNote(`Tool [search_kb] for "${call.arg}": ${combined.length} result(s).`);
                        combined.forEach(r => pushResult({
                            id: r.id, source: r.source, full: r.text,
                            meta: `search_kb "${call.arg}"${typeof r.score === 'number' ? ` sim=${r.score.toFixed(2)}` : ''}`
                        }));
                    }
                } else if (call.name === 'search_memories') {
                    const rawMemResults = includeChatContext ? await searchChatMemories(call.arg, chatId) : [];

                    let chatMemoryBlocks = [];
                    if (includeChatContext && chat && chat.memoryBlocks) {
                        try {
                            chatMemoryBlocks = typeof chat.memoryBlocks === 'string'
                                ? JSON.parse(chat.memoryBlocks)
                                : (chat.memoryBlocks || []);
                        } catch (e) { }
                    }
                    const memResults = filterWorkspaceMemoryResults(
                        rawMemResults,
                        chatMemoryBlocks,
                        profile.id
                    );

                    if (includeChatContext) {
                        memResults.forEach(r => rememberRetrieved(retrievedMemories, r, 'search'));
                    }

                    if (memResults.length === 0) {
                        pushNote(`Tool [search_memories] for "${call.arg}": No matches found.`);
                    } else {
                        pushNote(`Tool [search_memories] for "${call.arg}": ${memResults.length} match(es).`);
                        memResults.forEach(r => pushResult({
                            id: r.id, source: r.source, full: r.text,
                            meta: `search_memories "${call.arg}"${typeof r.score === 'number' ? ` sim=${r.score.toFixed(2)}` : ''}`
                        }));
                    }
                } else if (call.name === 'lookup_entity') {
                    // Registry is resolved directly so never-tagged entities are still found.
                    let entityChunks = [], entityIds = [], entityChunkTotal = 0;
                    if (includeChatContext) {
                        const looked = lookupEntityChunks(call.arg, chatId, 'chat_memory', { queryVector: lookupQueryVector });
                        const available = filterWorkspaceMemoryResults(
                            looked.chunks || [],
                            chat?.memoryBlocks || [],
                            profile.id
                        );
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
                        entityChunks.forEach(r => rememberRetrieved(retrievedMemories, r, 'lookup'));
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

                    // Exempt from finish-sources pruning.
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

                    if (registryEntity) coveredEntities.add(registryEntity.canonicalName);
                    if (registryEntity) {
                        let head = `Worldbuild entity ${registryEntity.canonicalName} (${registryEntity.type})`;
                        const headDetails = entityDataFacts(registryEntity.data);
                        if (headDetails) head += ` [${headDetails}]`;
                        const headDesc = registryEntity.data && (registryEntity.data.description || registryEntity.data.content);
                        if (headDesc && String(headDesc).trim()) head += ` — ${String(headDesc).trim()}`;
                        if (registryEntity.lore && String(registryEntity.lore).trim()) head += `: ${registryEntity.lore}`;
                        pushResult({ source: registryEntity.canonicalName, full: head, meta: `lookup_entity "${call.arg}"` });
                    }
                    entityChunks.forEach(r => pushResult({ id: r.id, source: r.source, full: r.text, meta: `lookup_entity "${call.arg}"` }));
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
                        pushNote(`NOTE: this entity has linked lore — call read_lore query="${call.arg}" for its authored background.`);
                    }
                } else if (call.name === 'read_lore') {
                    let loreResults = [];
                    let docTitle = '';
                    if (includeChatContext) {
                        try {
                            const looked = lookupEntityChunks(call.arg, chatId, 'chat_memory', { idsOnly: true });
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
                                loreResults = await executeMultiOwnerSearch(currentInput, loreDocIds, 'document', 0.3, 4);
                            }
                        } catch (e) { }
                    }
                    if (loreResults.length === 0) {
                        pushNote(`Tool [read_lore] for "${call.arg}": No linked lore document, or no relevant passages found.`);
                    } else {
                        pushNote(`Tool [read_lore] for "${call.arg}": ${loreResults.length} passage(s) from linked lore of ${docTitle}.`);
                        loreResults.forEach(r => {
                            let text = r.text || '';
                            if (text.length > MAX_AGENT_FILE_CHARS) text = text.slice(0, MAX_AGENT_FILE_CHARS) + '\n[...truncated...]';
                            retrievedLore.set(r.id, { text, source: r.source || docTitle, score: Number(r.fusionScore ?? r.score) || 0 });
                            pushResult({ id: r.id, source: r.source || docTitle, full: text, meta: `read_lore "${call.arg}"` });
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

                    if (!isConstant && includeChatContext && chat && chat.knowledgeFiles) {
                        try {
                            const chatKbFiles = typeof chat.knowledgeFiles === 'string'
                                ? JSON.parse(chat.knowledgeFiles)
                                : chat.knowledgeFiles;
                            const fileMatch = chatKbFiles.find(f => f.name.toLowerCase() === call.arg.toLowerCase());
                            if (fileMatch && (!fileMatch.profiles || fileMatch.profiles.length === 0 || fileMatch.profiles.includes(profile.id))
                                && (!fileMatch.strategy || fileMatch.strategy === 'constant' || fileMatch.strategy === 'full_context')) {
                                isConstant = true;
                            }
                        } catch (e) { }
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

                    if (!isConstant && includeChatContext && chat && chat.memoryBlocks) {
                        try {
                            const snippets = typeof chat.memoryBlocks === 'string'
                                ? JSON.parse(chat.memoryBlocks)
                                : chat.memoryBlocks;
                            const snippetMatch = snippets.find(s => s.type === 'manual'
                                && (s.title || s.source || '').toLowerCase() === call.arg.toLowerCase()
                                && (!s.profiles || s.profiles.length === 0 || s.profiles.includes(profile.id))
                                && s.strategy === 'constant');
                            if (snippetMatch) {
                                isConstant = true;
                            }
                        } catch (e) { }
                    }

                    if (isConstant) {
                        pushNote(`Tool [read_file] for "${call.arg}": Access Denied — "${call.arg}" is a Constant context block already permanently included in the main prompt.`);
                    } else {
                        let fileText = readEntireKbFile(profile.id, call.arg);
                        let fileSource = 'profile';
                        if (fileText.startsWith("[System: File not found") && includeChatContext) {
                            const chatFiles = typeof chat?.knowledgeFiles === 'string'
                                ? JSON.parse(chat.knowledgeFiles || '[]')
                                : (chat?.knowledgeFiles || []);
                            const allowed = chatFiles.some(file =>
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
                    if (hit) pushNote(`Tool [expand] "${call.arg}":\n[${hit.source}] ${hit.full}`);
                    else pushNote(`Tool [expand] "${call.arg}": no such retrieved item.`);
                }
            }

            // This turn is added in full; the digest is what it collapses to once it ages out.
            const coverageLine = () => {
                const ents = coveredEntities.size ? [...coveredEntities].join(', ') : '—';
                const srcs = coveredSources.size ? [...coveredSources].slice(0, 12).join(', ') : '—';
                return `COVERED SO FAR — entities: ${ents} | sources: ${srcs} | ${itemRegistry.size} items`;
            };
            const renderItem = (it, full) => it.kind === 'note'
                ? it.text
                : (full
                    ? `[${it.handle} · ${it.source}] ${it.full}`
                    : `[${it.handle} · ${it.source}]${it.meta ? ` (${it.meta})` : ''} ${makeSnippet(it.full)}`);
            const fullContent = `${coverageLine()}\n\n${turnItems.map(it => renderItem(it, true)).join('\n\n')}`;
            const digestContent = `${coverageLine()}\n${turnItems.map(it => renderItem(it, false)).join('\n')}`;

            messages.push({ role: 'assistant', content: agentOutput });
            const msgIndex = messages.push({ role: 'user', content: `TOOL RESULTS:\n${fullContent}\n\nWhat is your next step?` }) - 1;
            turnLog.push({
                msgIndex, digestContent,
                fullTokens: estimateTokens(fullContent),
                digestTokens: estimateTokens(digestContent),
                downgraded: false
            });

            if (LEAN_AGENT_HISTORY) {
                // Oldest first; the newest KEEP_TURNS always stay in full.
                const liveTokens = () => turnLog.reduce((s, e) => s + (e.downgraded ? e.digestTokens : e.fullTokens), 0);
                const protectedFrom = turnLog.length - LEAN_HISTORY_KEEP_TURNS;
                for (let i = 0; i < protectedFrom && liveTokens() > LEAN_HISTORY_BUDGET_TOKENS; i++) {
                    const e = turnLog[i];
                    if (e.downgraded) continue;
                    messages[e.msgIndex].content = `TOOL RESULTS (earlier, summarized):\n${e.digestContent}`;
                    e.downgraded = true;
                }
            }

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
    const UNCITED_TIER = 4;
    const sections = {
        profile: '--- PROFILE KNOWLEDGE BASE CHUNKS ---',
        files: '--- READ FILES CONTENT ---',
        chat: '--- CHAT KNOWLEDGE BASE CHUNKS ---',
        memory: '--- CHAT SUMMARIZED MEMORIES & SNIPPETS ---',
        lore: '--- LINKED LORE (WRITING DESK) ---',
        facts: '--- WORLDBUILD FACTS ---'
    };
    const contextItems = [];
    for (const r of retrievedProfileChunks.values()) {
        contextItems.push({ section: sections.profile, text: `[Result from Profile KB - ${r.source}]: ${r.text}`, tier: r.uncited ? UNCITED_TIER : 2, score: r.score || 0, origin: 'profile' });
    }
    for (const [filename, data] of readFiles.entries()) {
        contextItems.push({
            section: sections.files,
            text: `[File Contents: ${filename}]:\n${data.text}`,
            tier: data.uncited ? UNCITED_TIER : 1,
            truncatable: true,
            origin: data.source === 'profile' ? 'profile' : 'chat'
        });
    }
    for (const r of retrievedChatChunks.values()) {
        contextItems.push({ section: sections.chat, text: `[Result from Chat KB - ${r.source}]: ${r.text}`, tier: r.uncited ? UNCITED_TIER : 2, score: r.score || 0, origin: 'chat' });
    }
    const memoryPassages = expandMemoryResults([...retrievedMemories.entries()].map(([id, r]) => ({ id, ...r })), chatId);
    for (const r of memoryPassages) {
        contextItems.push({ section: sections.memory, text: `[Chat Memory]: ${r.text}`, tier: r.uncited ? UNCITED_TIER : (r.origin === 'search' ? 2 : 3), score: r.score || 0, origin: 'chat' });
    }
    for (const r of retrievedLore.values()) {
        contextItems.push({ section: sections.lore, text: `[Linked Lore - ${r.source}]: ${r.text}`, tier: 2, score: r.score || 0, origin: 'chat' });
    }
    for (const r of retrievedWorldFacts.values()) {
        contextItems.push({ section: sections.facts, text: `[${r.source}]: ${r.text}`, tier: 0, truncatable: true, origin: 'chat' });
    }

    return {
        agenticResponse: finishResponse || '[Agent passed context directly — no summary needed]',
        contextItems,
        contextSections: Object.values(sections),
        agenticInputTokens: agenticRagInputTokens,
        agenticOutputTokens: agenticRagOutputTokens,
        degraded: loopDegraded
    };
}

// --- EXPORTS ---

module.exports = {
    runWorkflow,
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
    classifyAndTagSegment,
    applyChunkTags,
    computeDocumentVectorStatus,
    checkAndAutoSummarize,
    getSystemAiConfiguration
};
