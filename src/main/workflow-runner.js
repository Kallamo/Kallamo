const db = require('./database');
const entitiesStore = require('./entities');
const inWorldTexts = require('./features/worldbuild/in-world-texts');
const { sendApiRequest, sendAgentRequest, isConnectionFailure, nativeToolSupport, getReservedOutputTokens, resolvePayloadLimit, createPromptVariableResolver } = require('./features/llm/llm.service');
const { sendApiRequestStream } = require('./features/llm/llm.stream');
const { applyGenerationHistory, resolveWorkspaceGenerationTarget } = require('./features/chat/generation-target');
const { selectActiveMessages, selectArchivableMessages, coveredMessageIds, parseMemoryBlocks } = require('./features/chat/archive-coverage');
const { syncSummarizedIndex, setMessagesExcluded, readMemoryBlocks } = require('./features/chat/archive-store');
const {
    filterWorkspaceKnowledgeResults,
    filterWorkspaceMemoryResults,
    isAvailableToProfile,
    isSearchable
} = require('./features/chat/workspace-context-scope');
const { ROLE_IDS, readAdvancedSettings, resolveAiEngineRole } = require('./features/ai-engine/role-resolver');
const { formatActiveHistory, planActiveHistory, selectActiveHistory } = require('./features/chat/history-window');
const { cacheTtlForPace } = require('./features/llm/prompt-cache');
const { refreshLocalContextWindows } = require('./features/llm/local-context-window');
const { createEntityLabels } = require('./features/ai-engine/entity-labels');
const { deferredNarrativeState, findPendingNarrativeTurn, replacedReplyIds } = require('./features/chat/narrative-turns');
const { purgeDeadTurns } = require('./features/narrative/turn-ownership');
const { parseEntityUpdateObject } = require('./features/worldbuild/entity-update-json');
const {
    addCacheUsage,
    buildEstimatedUsage,
    createMessageDiagnostics,
    mergeNarrativeStateDiagnostics
} = require('./features/ai-engine/message-diagnostics');
const {
    selectRetrievedEntries
} = require('./features/ai-engine/retrieval-selection');
const { normalizeRelationshipLabel, resolveRelationshipChange, validateNarrativeChange } = require('./features/worldbuild/entity-review');
const {
    filterUpdateFields,
    filterUpdateRelations,
    buildFieldCoverage,
    isUnsupportedNumericDelta,
    isWeakTextReplacement,
    comparableText,
} = require('./features/worldbuild/entity-update-contract');
const { NARRATIVE_KINDS, buildEntityUpdateSchema, buildEntityLoreSchema, buildLoreCleanupSchema } = require('./features/worldbuild/entity-update-schema');
const { buildCanonSystemPrompt, buildNarrativeSystemPrompt } = require('./features/worldbuild/entity-update-prompts');
const { createMemoryIndex } = require('./features/worldbuild/entity-update-memories');
const {
    ENRICH_ENUMS,
    ENRICH_FIELDS,
    ENRICH_TYPE_GUIDANCE,
    ENRICH_FIELD_GUIDANCE,
    entityDataFacts
} = require('./features/worldbuild/entity-fields');
const { decodeEntityUpdate, isEntityUpdateShape } = require('./features/worldbuild/entity-update-protocol');
const { buildLorePrompt, buildLoreAppendPrompt, buildSpoilerRetryNote, validateEntityLore, validateEntityLoreAppend } = require('./features/worldbuild/entity-lore');
const { precedingPassageText, entitySkillContext } = require('./features/worldbuild/entity-update-context');
const { buildNarrativeOptionPalette } = require('./features/worldbuild/narrative-options');
const { createEntityUpdateState } = require('./features/worldbuild/entity-update-state');
const { createStoryCoverage } = require('./features/worldbuild/entity-update-coverage');
const { shouldStopEntityUpdates } = require('./features/worldbuild/entity-update-resilience');
const { NARRATIVE_TRIAGE_SCHEMA, NARRATIVE_MECHANICS_SCHEMA, NARRATIVE_STORY_SCHEMA } = require('../../dist-main/main/features/narrative/narrative-state-schema');
const {
    describeLocationChain, findReachableLocations, inferLocationSizes, isNestedLocation, loadLocationChain, locationSizesOf, travelCategory
} = require('../../dist-main/main/features/worldbuild/location-graph');
const { findByReference } = require('../../dist-main/main/features/narrative/rule-keys');
const { missingSpoilers } = require('../../dist-main/shared/spoilers');
const { RELATIONSHIP_SCALE_GUIDE } = require('../../dist-main/narrative/relationship-bands');
const { DURABLE_RELATIONSHIP_CAUSES } = require('../../dist-main/narrative/narrative-taxonomy');
const {
    EPISTEMIC_DOMAINS,
    MECHANICAL_DOMAINS,
    compactNarrativeManifest,
    resolveSceneCast,
    extractNarrativeSignals,
    groupKnowledgeCardRows,
    hasEpistemicDomain,
    mentionedMechanics,
    resolveAnalysisHolders,
    resolveNarrativeRouting,
    selectPerspectiveRecords,
    summarizeSceneLocation
} = require('./features/narrative/narrative-state-routing');
const { resolveRecordReferences } = require('./features/narrative/story-refs');
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
    splitRetrievalBudget,
    retrievalTopK,
    truncateToTokens
} = require('./features/llm/context-budget');
const { stripReasoning } = require('./features/chat/message-text');
const { createScenePlanStreamFilter, extractScenePlan } = require('./features/chat/scene-plan');
const { reconstructKnowledgeFile } = require('./features/knowledge/kb-reconstruct');
const { parseCitations, isCitedChunk } = require('./features/knowledge/cited-sources');
const { parseAgentTurn } = require('./features/knowledge/agent-output');
const {
    queryKey,
    plannerWindowShape,
    downgradeUntilFits,
    shouldRunPlanner,
    turnAddedNothing,
    entityMentionIds,
    worldMapBlock,
    formatCoverage
} = require('./features/knowledge/agent-planner');
const retrievalLedger = require('./features/knowledge/retrieval-ledger');
const { argOf, canonicalToolName, plannerToolDefinitions, renderTextCall, textToolCatalog, toolNamesFor } = require('./features/knowledge/planner-tools');
const { flattenConversation } = require('./features/llm/tool-conversation');
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
    generateEmbeddingVectors,
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
const narrativeStructuredOutputUnavailable = new Set();

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

function sendRunEvent(webContents, channel, run, payload) {
    if (!webContents || run?.isCancelled) return;
    webContents.send(channel, {
        ...payload,
        chatId: run?.chatId ?? payload.chatId,
        runId: run?.id ?? payload.runId
    });
}

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

// Every message carries the bundle, and the list of excluded records alone ran to hundreds of
// kilobytes in a long campaign. Without the retrieval panel on, only how many and why are kept.
function compactContextBundle(bundle, keepExcluded) {
    if (!bundle) return bundle;
    const scopes = bundle.scopes.map(({ items: _items, ...scope }) => scope);
    if (keepExcluded) return { ...bundle, scopes };
    const excludedByReason = {};
    for (const decision of bundle.excluded || []) {
        const key = `${decision.outcome}:${decision.reason}`;
        excludedByReason[key] = (excludedByReason[key] || 0) + 1;
    }
    const { excluded: _excluded, ...rest } = bundle;
    return { ...rest, scopes, excludedByReason };
}

// A text read in the scene arrives whole up to this size; a longer one names the pages left out.
const IN_WORLD_TEXT_TOKENS = 1800;

function roleplaySystem() {
    const { RoleplaySystem } = require('../../dist-main/main/features/narrative/roleplay-system');
    return new RoleplaySystem(db);
}

// Items named in the player's message or the last reply, read when their pages are within reach.
function readTextsInPlay(chatId, isRoleplay, mentionText, maxTokens) {
    try {
        return inWorldTexts.textsInPlay(db, {
            workspaceId: chatId,
            roleplay: isRoleplay ? roleplaySystem() : null,
            mentionText,
            maxTokens,
            estimate: estimateTokens
        });
    } catch (error) {
        console.warn('[In-world texts] Could not read texts in play:', error.message);
        return [];
    }
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

// Executors kept on the text protocol for the session. A failed native request reaches the limit
// at once; a first reply without calls is one strike, since the model may simply be done.
const TEXT_PROTOCOL_STRIKES = new Map();
const TEXT_PROTOCOL_STRIKE_LIMIT = 2;

// A file the agent read, or an entity's lore, may take at most this share of the
// retrieval budget; the rest stays available for search results.
const AGENTIC_ITEM_MAX_SHARE = 0.6;

// Roleplay tools answered from per-subject records: tool name -> [method, reply outside Roleplay Mode].
const EPISTEMIC_TOOLS = {
    scan_scene_awareness: ['scanSceneAwareness', 'Scene Awareness is unavailable outside Roleplay Mode.'],
    inspect_subject_knowledge: ['inspectSubjectKnowledge', 'Subject Knowledge inspection is unavailable outside Roleplay Mode.'],
    inspect_subject_evidence: ['inspectSubjectEvidence', 'Subject evidence inspection is unavailable outside Roleplay Mode.'],
    inspect_subject_relationships: ['inspectSubjectRelationships', 'Subject relationship inspection is unavailable outside Roleplay Mode.'],
    inspect_subject_memories: ['inspectSubjectMemories', 'Subject memory inspection is unavailable outside Roleplay Mode.']
};

// Story tools, offered in every workspace: tool name -> method. Like the per-subject tools, they inform the planner only.
const STORY_TOOL_METHODS = {
    recall_story: 'recallStory',
    who_knows: 'whoKnows',
    compare_knowledge: 'compareKnowledge',
    how_they_know: 'howTheyKnow'
};

// Passages lookup_entity hands the agent per call.
const LOOKUP_ENTITY_CHUNK_LIMIT = 12;
// Of those, the most relevant ones reach the writer on their own; the rest only when the agent
// cites them or a search also found them.
const LOOKUP_CONTEXT_PASSAGES = 3;

// Profile knowledge, workspace files and archived memory each ask for their own passages.
const RETRIEVAL_TIERS = 3;

const PROFILE_RETRIEVAL_HEADER = '--- PROFILE RELEVANT RETRIEVED KNOWLEDGE ---';
const CHAT_RETRIEVAL_HEADER = '--- CHAT RELEVANT RETRIEVED KNOWLEDGE ---';
const MEMORY_RETRIEVAL_HEADER = '--- CHAT PERSISTENT SUMMARIZED MEMORIES ---';

// Retrieved text kept on a message for the debug panels, when those are on.
const DEBUG_TEXT_LIMIT = 60000;

function capDebugText(text, limit = DEBUG_TEXT_LIMIT) {
    const value = String(text || '');
    return value.length > limit ? `${value.slice(0, limit)}\n[...debug text cut]` : value;
}

// The request as sent is read to find what the model was told, so it keeps far more than the
// other panels; a long roleplay context alone runs past 100,000 characters.
const REQUEST_TEXT_LIMIT = 600000;

function recordGenerationRequest(request, { step, profileName, response, elapsedMs, outputTokens }) {
    return {
        step,
        profileName,
        elapsedMs,
        inputTokens: request.inputTokens,
        outputTokens,
        ...(request.attachedImageCount ? { attachedImages: request.attachedImageCount } : {}),
        systemPrompt: capDebugText(request.systemPrompt, REQUEST_TEXT_LIMIT),
        history: (request.chatHistory || []).map(message => ({
            role: message.role,
            content: capDebugText(message.content, REQUEST_TEXT_LIMIT)
        })),
        newPrompt: capDebugText(request.newPrompt, REQUEST_TEXT_LIMIT),
        response: capDebugText(response, REQUEST_TEXT_LIMIT)
    };
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
        items.push({ section, text, source: result.source, tier: 1, score: Number(result.fusionScore ?? result.score) || 0, origin });
    }
}

// Workspace passages go through the narrative context planner, which applies perspective.
// Without a planned workspace (narrativeItems null) they are packed like any retrieved text.
function routeRetrievedResults(results, { retrievalItems, narrativeItems, section, kind }) {
    if (!narrativeItems) {
        pushRetrievalItems(retrievalItems, results, section, 'chat');
        return;
    }
    const seen = new Set(narrativeItems.map(item => item.content));
    for (const result of results || []) {
        const text = String(result?.text || '');
        if (!text || seen.has(text)) continue;
        seen.add(text);
        narrativeItems.push({ id: result.id, kind, source: result.source, content: text, relevance: Number(result.fusionScore ?? result.score) || 0 });
    }
}

// --- WORKFLOW RUNNER ---

// Prompt caching is on unless the user turned it off. Turning it off restores
// the pre-cache request byte for byte: no breakpoints, no anchored window.
function isPromptCacheEnabled() {
    try {
        return readAdvancedSettings().promptCache !== false;
    } catch (e) {
        return true;
    }
}

// Start-to-start spacing of the chat's recent turns, oldest first. Read from the stored
// messages so the pace survives a restart.
function recentTurnGaps(chatId) {
    const times = db.prepare(`
        SELECT createdAt FROM messages WHERE chatId = ? AND role = 'user'
        ORDER BY createdAt DESC LIMIT 12
    `).all(chatId).map(row => Number(row.createdAt)).reverse();
    return times.slice(1).map((time, index) => time - times[index]);
}

// 'turn' puts the volatile context behind the history, the only layout where the history can be cached.
function getContextPlacement() {
    try {
        return readAdvancedSettings().promptCacheContextPlacement === 'system' ? 'system' : 'turn';
    } catch (e) {
        return 'turn';
    }
}

function isStreamingEnabled() {
    try {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'advanced'").get();
        if (!row) return true;
        return JSON.parse(row.value).streaming !== false;
    } catch (e) {
        return true;
    }
}

// One background analysis per chat; the next turn awaits it so it never reads a stale story state.
const narrativeStateRuns = new Map();

function sendNarrativeStateStatus(webContents, workspaceId, processing) {
    if (webContents && !webContents.isDestroyed()) webContents.send('narrative-state-status', { workspaceId, processing });
}

function runNarrativeStateInBackground(chatId, webContents, task) {
    const previous = narrativeStateRuns.get(chatId) || Promise.resolve();
    sendNarrativeStateStatus(webContents, chatId, true);
    const run = previous
        .then(task)
        .catch(error => console.error('[Narrative State] Background update failed:', error))
        .finally(() => {
            // A reply reverted while it was being read is analyzed into a dead turn; clear it at once.
            try {
                purgeDeadTurns(db, chatId);
            } catch (error) {
                console.error('[Narrative State] Could not clean up dead turns:', error);
            }
            if (narrativeStateRuns.get(chatId) !== run) return;
            narrativeStateRuns.delete(chatId);
            sendNarrativeStateStatus(webContents, chatId, false);
        });
    narrativeStateRuns.set(chatId, run);
    return run;
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
    cancelRun(activeRun);
    // Every budget below is measured against it, so a local server's context size is known first.
    await refreshLocalContextWindows(db);

    const controller = new AbortController();
    const currentRun = {
        id: crypto.randomUUID(),
        chatId,
        isCancelled: false,
        controller: controller
    };
    activeRun = currentRun;
    let isWorkflow = false;
    let turnReplacementId = null;

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

        // In a roleplay, the replaced replies are reverted before anything reads the story
        // state, and the turn before them catches up if it was never analyzed.
        const roleplayTurns = isRoleplayWorkspace(chatId);
        if (narrativeStateRuns.has(chatId)) {
            sendRunEvent(webContents, 'workflow-progress', currentRun, {
                step: 1,
                totalSteps,
                profileName: 'Narrative State',
                status: 'Updating Narrative State…',
                phase: 'narrative-state'
            });
            await narrativeStateRuns.get(chatId);
        }
        if (roleplayTurns) narrativeEntitySystem().cancelOpenTurnReplacements(chatId);
        const replacedIds = roleplayTurns ? replacedReplyIds(persistedMessages, { historyEdit, regenerateMessageId }) : [];
        // A story pass still writing must land before its turn is set aside, or it would write past the rewind.
        if (replacedIds.length && narrativeStoryRuns.has(chatId)) await narrativeStoryRuns.get(chatId);
        if (replacedIds.length) {
            turnReplacementId = narrativeEntitySystem().beginTurnReplacement(chatId, replacedIds);
        }
        if (roleplayTurns) {
            await analyzePendingNarrativeTurn({ chatId, excludedIds: replacedIds, webContents, currentRun, totalSteps });
            // What is still queued (a kept alternative, a pass that failed earlier) runs behind the reply.
            // A regeneration holds it: the story is being rewound under it.
            if (!replacedIds.length) runQueuedNarrativeStories(chatId);
        }

        let currentInput = messageContent;
        let finalOutput = '';
        let lastProfileUsed = null;
        let didStreamFinalResponse = false;

        let lastAgenticRagResponse = '';
        let lastAgenticRagContextGathered = '';
        let lastStandardRagDebug = '';
        let lastNarrativeContextRequestId = null;
        let lastFinalContextText = '';
        let lastContextBundle = null;
        let lastWorldbuildOrigins = null;
        let lastAssembly = null;
        let lastRetrievalMode = 'standard';
        let lastAgenticTrace = null;
        let lastRetrievalFunnel = null;
        let lastGenerationPolicyId = null;
        let lastScenePlan = '';
        const generationRequests = [];
        let totalProfileKbTokens = 0;
        let totalChatKbTokens = 0;
        let totalChatHistoryTokens = 0;
        let totalSystemInstructionTokens = 0;
        let totalNarrativeContextTokens = 0;
        let totalUserInputTokens = 0;
        let totalMainInputTokens = 0;
        let finalPayloadLimit = null;
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

        const promptCacheEnabled = isPromptCacheEnabled();
        const contextPlacement = getContextPlacement();
        // Measured once per run: every step of a workflow is sent at the same pace.
        const cacheTtl = promptCacheEnabled ? cacheTtlForPace(recentTurnGaps(chatId)) : '5m';
        // The anchor belongs to the conversation, so every profile in a workflow
        // shares one window. Cooldown state is per profile, since each profile
        // carries a different stable prefix.
        const historyCacheScopeId = promptCacheEnabled ? chatId : null;
        // What the provider actually billed, as opposed to what was estimated.
        const measuredCache = {};
        const measuredAgenticCache = {};

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
            let narrativeContextRequestId = null;
            let contextBundleDiagnostic = null;
            let worldbuildOriginsDiagnostic = null;
            let assemblyDiagnostic = null;
            let retrievalMode = 'standard';
            let agenticTrace = null;
            let retrievalFunnel = null;
            let generationPolicyId = null;
            let agenticInputTokens = 0;
            let agenticOutputTokens = 0;

            sendRunEvent(webContents, 'workflow-progress', currentRun, {
                step: i + 1,
                totalSteps,
                profileName: profile.name,
                status: 'Searching Context...'
            });

            // --- BUILD CONTEXT ---
            // Stable head first, volatile tail after: cache matching is a byte prefix (docs/prompt-cache.md).
            let stableSystemPrompt = profile.systemPrompt || '';
            let volatileSystemPrompt = '';
            let isRoleplayWorkspace = false;
            try {
                const { getWorkspaceExperienceMode } = require('../../dist-main/main/features/narrative/mode-orchestration');
                isRoleplayWorkspace = getWorkspaceExperienceMode(db, chatId) === 'roleplay';
                if (isRoleplayWorkspace) {
                    const { getRoleplayGenerationPolicy } = require('../../dist-main/main/features/narrative/roleplay-generation-policy');
                    const generationPolicy = getRoleplayGenerationPolicy();
                    const { buildRoleplayTemporalContext } = require('./features/worldbuild/calendar-service');
                    stableSystemPrompt += `\n\n${generationPolicy}`;
                    volatileSystemPrompt += `\n\n${buildRoleplayTemporalContext(db, chatId)}`;
                    generationPolicyId = `sha256:${crypto.createHash('sha256').update(generationPolicy).digest('hex').slice(0, 16)}`;
                }
            } catch (error) {
                console.warn('[Roleplay Context] Could not load the narration policy:', error.message);
            }
            if (step.prompt) {
                stableSystemPrompt += `\n\nAdditional Instruction: ${step.prompt}`;
            }
            const systemInstructionsTokens = estimateTokens(stableSystemPrompt);

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

            // Constant knowledge is pinned reference, not a per-turn lookup, so it joins the stable head.
            let stableContextBlock = '';
            let contextBlock = '';
            if (constantKnowledge) {
                const constantLabel = isRoleplayWorkspace
                    ? 'NARRATOR REFERENCE: CONSTANT CONTEXT'
                    : 'CONSTANT CONTEXT SYSTEM BACKGROUND';
                stableContextBlock += `\n\n--- ${constantLabel} ---\n${constantKnowledge}\n`;
            }

            const composeStableSystem = () => stableSystemPrompt + stableContextBlock;
            const composeSystemPrompt = () => composeStableSystem() + volatileSystemPrompt + contextBlock;

            const attachmentsPayloadContext = attachmentsContext
                ? `\n\n--- ATTACHED FILES FOR CURRENT MESSAGE ---\n${attachmentsContext}\n`
                : '';
            const stepLimit = resolvePayloadLimit({ apiProfileId: profile.apiProfileId, model: profile.model, maxPayloadTokens: maxContextTokens });
            const fixedPrompt = resolveVariables(composeSystemPrompt() + attachmentsPayloadContext);
            const fixedTokens = estimateTokens(fixedPrompt);
            // The user message carries the same note now as it will in later history, so the cached prefix holds.
            // Read across archived messages too, so archiving never moves a note inside the window.
            const presenceNotes = isRoleplayWorkspace ? loadPresenceNotes(chatId, messages) : new Map();
            const lastActiveMessage = activeMessages[activeMessages.length - 1];
            const inputPresenceNote = i === 0 && lastActiveMessage?.role === 'user' ? presenceNotes.get(lastActiveMessage.id) : null;
            const modelInput = inputPresenceNote ? `${inputPresenceNote}\n${currentInput}` : currentInput;
            const budgetInput = {
                maxPayloadTokens: stepLimit.limit,
                configuredPayloadTokens: stepLimit.configured,
                tokenRatio: stepLimit.ratio,
                limitSource: stepLimit.source,
                newPrompt: resolveVariables(modelInput),
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

            // History is measured first so retrieval cannot push the conversation out. The anchored
            // window is measured, so the room reserved here is the room the final window takes.
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
                if (presenceNotes.size) {
                    historySource = historySource.map(message => presenceNotes.has(message.id)
                        ? { ...message, presenceNote: presenceNotes.get(message.id) }
                        : message);
                }
            }
            const historyNeed = planActiveHistory(historySource, availableForContext, historyCacheScopeId).tokens;
            // Profile knowledge is packed first; what it leaves is the narrative planner's budget.
            const splitBudget = splitRetrievalBudget({ availableTokens: availableForContext, historyTokens: historyNeed });
            // A text named this turn and within reach is read whether or not the planner runs; its
            // pages come out of the retrieval budget so the payload limit still holds.
            // The narration only: names in the reasoning saved with it are not what the story said.
            const lastReply = stripReasoning([...activeMessages].reverse().find(message => message.role === 'ai')?.content || '');
            const textReadings = includeChatContext
                ? readTextsInPlay(chatId, isRoleplayWorkspace, `${messageContent || currentInput}\n${lastReply}`, Math.min(IN_WORLD_TEXT_TOKENS, Math.floor(splitBudget / 3)))
                : [];
            const textTokens = textReadings.reduce((total, reading) => total + reading.tokens, 0);
            const retrievalBudget = Math.max(0, splitBudget - textTokens);
            if (textReadings.length) {
                contextBlock += `\n\n--- TEXTS IN THE WORLD ---\n${textReadings.map(reading => reading.text).join('\n\n')}\n`;
                chatKbTokens += textTokens;
            }
            const planWorkspaceContext = shouldPlanWorkspaceContext(chatId, includeChatContext);
            const profileRetrievalHeader = isRoleplayWorkspace
                ? '--- NARRATOR REFERENCE: PROFILE RETRIEVAL ---'
                : PROFILE_RETRIEVAL_HEADER;

            const retrievalPlanner = getRoleExecutor(ROLE_IDS.RETRIEVAL_PLANNER, profile);
            const plannerAvailable = profile.isAgentic === 1 && Boolean(retrievalPlanner.executor);
            // Constant files and snippets already travel whole, so a search never repeats them.
            const filterProfileResults = results => {
                let constantSnippetTitles = [];
                try {
                    constantSnippetTitles = db.getConstantSnippets(profile.id).map(c => (c.title || '').toLowerCase());
                } catch (e) { }
                return (results || []).filter(r => {
                    const fileMatch = knowledgeFiles.find(f => f.name.toLowerCase() === r.source.toLowerCase());
                    if (fileMatch && (fileMatch.strategy === 'constant' || fileMatch.strategy === 'full_context')) return false;
                    return !constantSnippetTitles.includes(r.source.toLowerCase());
                });
            };
            // A workspace builds its context from what the turn needs; only a chat with no workspace
            // context of its own keeps the search-and-pack retrieval.
            const needDriven = planWorkspaceContext;
            // The user's own message decides, not the step input: from step 2 on that input is
            // generated prose, which says nothing about whether this turn needs research.
            const plannerGate = needDriven
                ? { plan: false, reason: 'need-driven' }
                : plannerAvailable
                    ? resolvePlannerGate(chatId, messageContent || currentInput, {
                        includeChatContext,
                        roleplay: isRoleplayWorkspace,
                        force: String(debugSettings.agenticGate || 'auto') === 'always'
                    })
                    : { plan: false, reason: 'profile is not agentic, or no Retrieval Planner is configured' };
            if (plannerAvailable && !needDriven) {
                retrievalPath = plannerGate.plan ? 'agentic' : 'deterministic';
                retrievalGateReason = plannerGate.reason;
                console.log(`[Agentic RAG] Gate: ${retrievalPath} (${plannerGate.reason})`);
            }
            if (needDriven) {
                const assembled = await assembleTurnContext({
                    chatId,
                    chat,
                    profile,
                    request: messageContent || currentInput,
                    lastReply,
                    ceiling: retrievalBudget,
                    isRoleplay: isRoleplayWorkspace,
                    plannerExecutor: plannerAvailable ? retrievalPlanner.executor : null,
                    run: currentRun,
                    webContents,
                    includeChatContext,
                    filterProfileResults,
                    // The last replies always reach the narrator whole, so their scenes are not searched for.
                    recentOriginIds: activeMessages.slice(-20).filter(message => message.role === 'ai').map(message => message.id)
                });
                retrievalMode = 'need-driven';
                retrievalPath = 'need-driven';
                retrievalGateReason = assembled.brief.note;
                if (assembled.profileText) {
                    contextBlock += `\n\n${profileRetrievalHeader}\n${assembled.profileText}\n`;
                    profileKbTokens += assembled.profileTokens;
                }
                // Rules and who is here hold for the whole scene, so they join the stable head a cache can reuse.
                if (assembled.stable) stableContextBlock += `\n\n${assembled.stable}\n`;
                if (assembled.volatile) contextBlock += `\n\n${assembled.volatile}\n`;
                chatKbTokens += assembled.usedTokens;
                assemblyDiagnostic = { ...assembled.report, brief: { note: assembled.brief.note, inputTokens: assembled.brief.inputTokens, outputTokens: assembled.brief.outputTokens } };
                agenticInputTokens = assembled.brief.inputTokens;
                agenticOutputTokens = assembled.brief.outputTokens;
                for (const key of ['read', 'write', 'longWrite', 'uncachedInput']) {
                    measuredAgenticCache[key] = (measuredAgenticCache[key] || 0) + (assembled.brief.cache?.[key] || 0);
                }
                agenticRagResponse = assembled.brief.response;
                agenticRagContextGathered = assembled.context;
            } else if (plannerGate.plan) {
                let ragChatHistory = [];
                if (i === 0 || includeChatHistory) {
                    // The planner reads this history, so its own window sizes it, not the writer's.
                    const plannerLimit = resolvePayloadLimit({ apiProfileId: retrievalPlanner.executor.apiProfileId, model: retrievalPlanner.executor.model, maxPayloadTokens: maxContextTokens });
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
                    sceneContext: plannerGate.sceneContext,
                    readItemIds: new Set(textReadings.map(reading => reading.itemId)),
                    toolProtocol: String(debugSettings.agenticToolProtocol || 'auto') === 'text' ? 'text' : 'auto'
                });
                if (agenticResult) {
                    retrievalMode = 'agentic';
                    // A chat with no workspace context: what the loop found is packed as passages.
                    const packed = packContextItems(
                        agenticResult.contextItems,
                        retrievalBudget,
                        { estimate: estimateTokens, maxItemShare: AGENTIC_ITEM_MAX_SHARE }
                    );
                    retrievalOmitted += packed.dropped + packed.truncated;
                    if (agenticResult.degraded) agenticDegraded = true;
                    // Stored on the message, so chunk ids are left out and only counts are kept.
                    lastAgenticTrajectory = {
                        anchorQuery: agenticResult.trajectory.anchorQuery,
                        toolK: agenticResult.trajectory.toolK,
                        protocol: agenticResult.trajectory.protocol,
                        finalProtocol: agenticResult.trajectory.finalProtocol,
                        protocolFallback: agenticResult.trajectory.protocolFallback,
                        stopped: agenticResult.trajectory.stopped,
                        plannerWindow: agenticResult.trajectory.plannerWindow,
                        withheldLookupPassages: agenticResult.trajectory.withheldLookupPassages || 0,
                        gate: { path: 'agentic', reason: plannerGate.reason },
                        seed: agenticResult.trajectory.seed
                            ? { calls: agenticResult.trajectory.seed.calls, items: agenticResult.trajectory.seed.items }
                            : null,
                        turns: agenticResult.trajectory.turns.map(({ newIds, ...turn }) => turn),
                        packing: {
                            kept: packed.kept.length,
                            dropped: packed.dropped,
                            truncated: packed.truncated,
                            total: packed.total,
                            budget: retrievalBudget
                        }
                    };
                    const gathered = renderContextSections(packed.kept, agenticResult.contextSections);
                    const retrievedAnything = packed.total > 0;
                    // Never pass the agent's summary off as facts; an explicit notice keeps
                    // the model from inventing document-based answers.
                    const noContextNotice = retrievedAnything
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
                    for (const key of ['read', 'write', 'longWrite', 'uncachedInput']) {
                        measuredAgenticCache[key] = (measuredAgenticCache[key] || 0) + (agenticResult.agenticCache?.[key] || 0);
                    }
                    if (agenticResult.agenticCache?.mode) {
                        const mode = agenticResult.agenticCache.mode;
                        measuredAgenticCache.mode = !measuredAgenticCache.mode || measuredAgenticCache.mode === mode ? mode : 'mixed';
                    }
                    agenticOutputTokens = agenticResult.agenticOutputTokens || 0;
                    agenticTrace = {
                        turns: agenticResult.trace || [],
                        finish: agenticResult.agenticResponse,
                        degraded: Boolean(agenticResult.degraded),
                        stopReason: agenticResult.stopReason || 'finished'
                    };
                    retrievalFunnel = agenticResult.selection || null;
                }
            } else {
                if (plannerAvailable) {
                    lastAgenticTrajectory = { gate: { path: 'deterministic', reason: plannerGate.reason }, turns: [] };
                }
                const retrievalItems = [];
                // Profile knowledge, workspace files and archived memory share the budget.
                const topK = retrievalTopK(0, retrievalBudget, { tiers: RETRIEVAL_TIERS });
                const results = await searchKnowledgeBase(currentInput, profile.id, { k: topK });
                standardRagDebug += formatRagDebugSection('PROFILE KB', results);
                if (results && results.length > 0) {
                    pushRetrievalItems(retrievalItems, filterProfileResults(results), profileRetrievalHeader, 'profile');
                }

                if (includeChatContext && chat) {
                    const chatKbResults = await searchChatKnowledgeBase(currentInput, chatId, { k: topK });
                    if (chatKbResults && chatKbResults.length > 0) {
                        const chatKbFiles = typeof chat.knowledgeFiles === 'string'
                            ? JSON.parse(chat.knowledgeFiles)
                            : (chat.knowledgeFiles || []);
                        routeRetrievedResults(
                            filterWorkspaceKnowledgeResults(chatKbResults, chatKbFiles, profile.id),
                            { retrievalItems, narrativeItems: null, section: CHAT_RETRIEVAL_HEADER, kind: 'workspace-text' }
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
                        routeRetrievedResults(
                            expandMemoryResults(filterWorkspaceMemoryResults(memoryResults, blocksList, profile.id), chatId),
                            { retrievalItems, narrativeItems: null, section: MEMORY_RETRIEVAL_HEADER, kind: 'workspace-memory' }
                        );
                    }
                    standardRagDebug += formatRagDebugSection('CHAT MEMORY', memoryResults);
                }

                const selection = selectRetrievedEntries(currentInput, retrievalItems.map(item => ({ key: item, kind: item.origin === 'profile' ? 'profile-knowledge' : 'workspace-text', source: item.source, content: item.text })));
                const selectedItems = new Set(selection.selected.map(entry => entry.key));
                retrievalFunnel = selection.funnel;
                const packed = packContextItems(retrievalItems.filter(item => selectedItems.has(item)), retrievalBudget, { estimate: estimateTokens });
                retrievalOmitted += packed.dropped + packed.truncated;
                for (const section of [profileRetrievalHeader, CHAT_RETRIEVAL_HEADER, MEMORY_RETRIEVAL_HEADER]) {
                    const texts = packed.kept.filter(item => item.section === section).map(item => item.text);
                    if (texts.length === 0) continue;
                    contextBlock += `\n\n${section}\n${texts.join('\n\n')}\n`;
                    const sectionTokens = estimateTokens(texts.join('\n\n'));
                    if (section === profileRetrievalHeader) profileKbTokens += sectionTokens;
                    else chatKbTokens += sectionTokens;
                }
            }
            if (attachmentsContext) {
                contextBlock += `\n\n--- ATTACHED FILES FOR CURRENT MESSAGE ---\n${attachmentsContext}\n`;
            }

            const stableSystemSegment = composeStableSystem();
            const volatileSystemSegment = volatileSystemPrompt + contextBlock;
            const compiledSystemPrompt = stableSystemSegment + volatileSystemSegment;

            const inputTokens = estimateTokens(modelInput);
            const systemTokens = estimateTokens(compiledSystemPrompt);
            const narrativeContextTokens = Math.max(0, systemTokens - systemInstructionsTokens);
            const measuredSystemPrompt = resolveVariables(compiledSystemPrompt);
            // Measured against the prompt actually sent, so the request always fits.
            const remainingTokens = getAvailableHistoryTokens({ ...budgetInput, systemPrompt: measuredSystemPrompt });

            let chatHistory = [];
            if (i === 0 || includeChatHistory) {
                const selection = selectActiveHistory(historySource, remainingTokens, historyCacheScopeId);
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
            let stepScenePlan = '';
            let stepRawOutputTokens = null;
            let stepTruncated = false;
            let stepFinishReason = null;
            let stepLearnedRatio = null;
            let stepRequest = null;

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
                    const attemptStartedAt = Date.now();
                    const genParams = {
                        apiProfileId: profile.apiProfileId,
                        model: profile.model,
                        systemPrompt: compiledSystemPrompt,
                        chatHistory,
                        newPrompt: modelInput,
                        temperature: profile.temperature,
                        maxTokens: profile.maxTokens,
                        maxPayloadTokens: maxContextTokens,
                        // History and retrieval were sized on this limit; the final check must use the same one.
                        payloadLimit: stepLimit,
                        payloadBreakdown,
                        learnTokenCount: true,
                        includeResponseMetadata: true,
                        manualMode: profile.manualMode === 1,
                        manualJson: profile.manualJson,
                        abortSignal: currentRun.controller.signal,
                        attachedImages: (i === 0 ? attachedImages : []),
                        // systemPrompt stays the authority for the budget; the segments only mark the reusable half.
                        promptCache: promptCacheEnabled ? {
                            policy: 'conversation',
                            placement: contextPlacement,
                            scopeId: `${chatId}::${profile.id}`,
                            stable: stableSystemSegment,
                            volatile: volatileSystemSegment,
                            ttl: cacheTtl
                        } : null,
                        onUsage: (metadata) => addCacheUsage(measuredCache, metadata),
                        onRequest: debugSettings.ragDebug ? (request) => { stepRequest = request; } : null
                    };

                    // Only the final, user-facing generation streams; intermediate
                    // workflow steps are plumbing and stay non-streaming.
                    let result;
                    if ((i === steps.length - 1) && isStreamingEnabled()) {
                        const planFilter = isRoleplayWorkspace ? createScenePlanStreamFilter() : null;
                        result = await sendApiRequestStream(
                            genParams,
                            (delta) => {
                                const contentDelta = planFilter ? planFilter.push(delta.contentDelta || '') : (delta.contentDelta || '');
                                if (!contentDelta && !delta.reasoningDelta) return;
                                sendRunEvent(webContents, 'stream:token', currentRun, {
                                    contentDelta,
                                    reasoningDelta: delta.reasoningDelta || ''
                                });
                            },
                            () => {
                                didStreamFinalResponse = true;
                            });
                        const heldBack = planFilter?.flush();
                        if (heldBack) sendRunEvent(webContents, 'stream:token', currentRun, { contentDelta: heldBack, reasoningDelta: '' });
                        if (currentRun.isCancelled) {
                            return { success: false, cancelled: true };
                        }
                    } else {
                        result = await sendApiRequest(genParams);
                    }
                    stepOutput = typeof result === 'string' ? result : String(result?.content || '');
                    stepRawOutputTokens = estimateTokens(stepOutput);
                    const rawStepOutput = stepOutput;
                    if (isRoleplayWorkspace) {
                        const planned = extractScenePlan(stepOutput);
                        stepOutput = planned.text;
                        stepScenePlan = planned.plan;
                    }
                    if (!stripReasoning(stepOutput).trim()) {
                        throw emptyResponseError(result?.finishReason, stepOutput);
                    }
                    stepTruncated = Boolean(result?.truncated);
                    stepFinishReason = result?.finishReason ?? null;
                    stepLearnedRatio = result?.learnedTokenRatio ?? null;
                    success = true;
                    if (stepRequest) generationRequests.push(recordGenerationRequest(stepRequest, { step: i + 1, profileName: profile.name, response: rawStepOutput, elapsedMs: Date.now() - attemptStartedAt, outputTokens: stepRawOutputTokens }));
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
                        // Who failed and where, so the error can show the profile, its model and the chain.
                        profileId: profile.id,
                        model: profile.model || null,
                        apiProfileId: profile.apiProfileId || null,
                        workflowName: isWorkflow ? resolvedTarget.target.name : null,
                        stepProfileIds: steps.map(step => step.profileId),
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

            // Past about 4,000 tokens an intermediate output would crowd the next step, so the run
            // pauses and asks. The last step is exempt: its output goes to the user.
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
                finalPayloadLimit = {
                    limit: stepLimit.limit,
                    configured: stepLimit.configured,
                    ratio: stepLimit.ratio,
                    source: stepLimit.source,
                    learnedRatio: stepLearnedRatio
                };
            }

            lastAgenticRagResponse = agenticRagResponse;
            lastAgenticRagContextGathered = agenticRagContextGathered;
            if (standardRagDebug) lastStandardRagDebug = standardRagDebug;
            lastNarrativeContextRequestId = narrativeContextRequestId;
            lastFinalContextText = stableContextBlock + contextBlock;
            lastContextBundle = contextBundleDiagnostic;
            lastWorldbuildOrigins = worldbuildOriginsDiagnostic;
            lastAssembly = assemblyDiagnostic;
            lastRetrievalMode = retrievalMode;
            lastAgenticTrace = agenticTrace;
            lastRetrievalFunnel = retrievalFunnel;
            lastGenerationPolicyId = generationPolicyId;
            lastScenePlan = stepScenePlan;

            totalProfileKbTokens += profileKbTokens;
            totalChatKbTokens += chatKbTokens;
            totalChatHistoryTokens += chatHistoryTokens;
            totalSystemInstructionTokens += systemInstructionsTokens;
            totalNarrativeContextTokens += narrativeContextTokens;
            totalUserInputTokens += inputTokens;
            totalMainInputTokens += totalInputTokens;
            totalAgenticInputTokens += agenticInputTokens;
            totalAgenticOutputTokens += agenticOutputTokens;
            // The plan was written and billed even though the reply no longer shows it.
            totalOutputTokens += stepRawOutputTokens ?? estimateTokens(stepOutput);
        }

        if (finalOutput && lastProfileUsed) {
            const aiMsgId = 'msg_' + Math.random().toString(36).substr(2, 9);
            let roleplayChanges = [];

            const legacyTokens = {
                knowledgeBase: totalProfileKbTokens + totalChatKbTokens,
                profileKb: totalProfileKbTokens,
                chatKb: totalChatKbTokens,
                chatHistory: totalChatHistoryTokens,
                totalInput: totalMainInputTokens,
                output: totalOutputTokens,
                agenticInput: totalAgenticInputTokens,
                agenticOutput: totalAgenticOutputTokens
            };
            // Stored on every AI message and read per visible message, so retrieved text is kept
            // only while its debug panel is on, and capped.
            const keepAgenticText = Boolean(debugSettings.agenticDebug);
            const keepRetrievalText = Boolean(debugSettings.ragDebug);
            let debugObj = createMessageDiagnostics({
                workflowStatus: isWorkflow ? `Workflow complete (${steps.length} steps)` : '',
                legacy: {
                    ...(keepAgenticText ? {
                        agenticRagResponse: capDebugText(lastAgenticRagResponse),
                        agenticRagContextGathered: capDebugText(lastAgenticRagContextGathered),
                        ...(lastAgenticTrajectory ? { agenticTrajectory: lastAgenticTrajectory } : {})
                    } : {}),
                    context: { historySent, historyDropped, retrievalOmitted, agenticDegraded, retrievalPath, retrievalGateReason, payloadLimit: finalPayloadLimit },
                    ...(finalTruncated ? { truncated: true, finishReason: finalFinishReason } : {}),
                    tokens: legacyTokens
                },
                generation: {
                    profileName: lastProfileUsed.name,
                    context: {
                        exactTokens: estimateTokens(lastFinalContextText),
                        workflowContextTokens: totalNarrativeContextTokens,
                        manifestRequestId: lastNarrativeContextRequestId
                    },
                    policyId: lastGenerationPolicyId,
                    ...(debugSettings.narrativeStateDebug && lastScenePlan ? { scenePlan: capDebugText(lastScenePlan) } : {}),
                    ...(generationRequests.length ? { requests: generationRequests } : {}),
                    steps: steps.length
                },
                retrieval: {
                    mode: lastRetrievalMode,
                    // One copy of the context: the Request tab holds it again, whole, inside the request.
                    ...(keepRetrievalText ? { finalContextText: capDebugText(lastFinalContextText) } : {}),
                    bundle: compactContextBundle(lastContextBundle, keepRetrievalText),
                    ...(keepRetrievalText && lastWorldbuildOrigins?.length ? { worldbuild: lastWorldbuildOrigins } : {}),
                    ...(lastAssembly ? { assembly: lastAssembly } : {}),
                    selection: lastRetrievalFunnel
                },
                agentic: lastAgenticTrace ? {
                    ...lastAgenticTrace,
                    ...(keepAgenticText ? { contextText: capDebugText(lastAgenticRagContextGathered) } : {}),
                    usage: {
                        input: totalAgenticInputTokens,
                        output: totalAgenticOutputTokens
                    }
                } : undefined,
                usage: buildEstimatedUsage({
                    systemInstructions: totalSystemInstructionTokens,
                    narrativeContext: totalNarrativeContextTokens,
                    userInput: totalUserInputTokens,
                    chatHistory: totalChatHistoryTokens,
                    output: totalOutputTokens,
                    agenticInput: totalAgenticInputTokens,
                    agenticOutput: totalAgenticOutputTokens,
                    cache: { main: measuredCache, agentic: measuredAgenticCache }
                })
            });

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
            if (turnReplacementId) {
                narrativeEntitySystem().completeTurnReplacement(chatId, turnReplacementId);
                turnReplacementId = null;
                // The replaced turns can no longer come back, so what they wrote goes.
                try {
                    purgeDeadTurns(db, chatId);
                } catch (error) {
                    console.error('[Narrative State] Could not clean up replaced turns:', error);
                }
            }
            if (lastNarrativeContextRequestId) {
                try {
                    const { NarrativeContextManifestRepository } = require('../../dist-main/main/features/narrative/context-manifest');
                    new NarrativeContextManifestRepository(db)
                        .attachOrigin(chatId, lastNarrativeContextRequestId, aiMsgId);
                } catch (error) {
                    console.error('[Roleplay Context] Could not attach the context manifest:', error);
                }
            }

            const profileId = lastProfileUsed.id;
            // The reply is already saved; the story state catches up without holding the chat.
            runNarrativeStateInBackground(chatId, webContents, async () => {
                const modelCalls = debugSettings.narrativeStateDebug ? [] : null;
                try {
                    // A reply that replaced another waits for the story to continue, so trying alternatives
                    // never bills an analysis per reply.
                    const narrativeResult = replacedIds.length
                        ? { changes: [], diagnostics: deferredNarrativeState() }
                        : await updateRoleplayStateWithSystemAi({
                            workspaceId: chatId,
                            provenanceId: aiMsgId,
                            userMessage: messageContent,
                            narrativeResponse: finalOutput,
                            modelCalls
                        });
                    roleplayChanges = narrativeResult.changes;
                    if (narrativeResult.diagnostics) {
                        debugObj = mergeNarrativeStateDiagnostics(debugObj, narrativeResult.diagnostics, modelCalls);
                    }
                } catch (error) {
                    console.error('[Roleplay State] System AI update failed:', error);
                    try {
                        const { getRoleplayClock, applyRoleplayTurnFrame } = require('./features/worldbuild/calendar-service');
                        const { RoleplaySystem } = require('../../dist-main/main/features/narrative/roleplay-system');
                        const failedScene = new RoleplaySystem(db).getScene(chatId);
                        const failedClock = getRoleplayClock(db, chatId);
                        applyRoleplayTurnFrame(db, {
                            workspaceId: chatId,
                            originId: aiMsgId,
                            startClock: failedClock,
                            startLocationId: failedScene?.locationId,
                            endLocationId: failedScene?.locationId,
                            timeAdvance: null
                        });
                    } catch (frameError) {
                        console.error('[Roleplay Time] Could not preserve the failed turn frame:', frameError);
                    }
                    const failedNarrativeDiagnostic = {
                        status: 'failed',
                        error: error.message || 'Narrative State update failed.',
                        usage: {}
                    };
                    debugObj = mergeNarrativeStateDiagnostics(debugObj, failedNarrativeDiagnostic, modelCalls);
                    try {
                        const { NarrativeStateSystem } = require('../../dist-main/main/features/narrative/narrative-state');
                        new NarrativeStateSystem(db).finishJob(chatId, aiMsgId, 'failed', { error: error.message || 'Narrative State update failed.' });
                    } catch (jobError) {
                        console.error('[Narrative State] Could not persist failed job:', jobError);
                    }
                }
                const debugNotice = JSON.stringify(debugObj);
                db.prepare('UPDATE messages SET debugNotice = ? WHERE id = ? AND chatId = ?')
                    .run(debugNotice, aiMsgId, chatId);
                // Patches only this message's diagnostics in the open chat, without reloading it.
                if (!webContents.isDestroyed()) webContents.send('message-debug-notice', { workspaceId: chatId, messageId: aiMsgId, debugNotice });

                if (!webContents.isDestroyed()) webContents.send('roleplay-resource-changes', { workspaceId: chatId, changes: roleplayChanges });

                // The story pass follows on its own queue: the next turn waits for this scene pass, not for it.
                if (!replacedIds.length) {
                    runQueuedNarrativeStories(chatId).then(() => {
                        const recorded = db.prepare('SELECT debugNotice FROM messages WHERE id = ? AND chatId = ?').get(aiMsgId, chatId);
                        if (recorded && !webContents.isDestroyed()) {
                            webContents.send('message-debug-notice', { workspaceId: chatId, messageId: aiMsgId, debugNotice: recorded.debugNotice });
                        }
                    }).catch(error => console.error('[Narrative State] Could not refresh the story diagnostics:', error));
                }

                checkAndAutoSummarize(chatId, profileId).catch(e => {
                    console.error("[Auto-Summarize] error:", e);
                });
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
        if (turnReplacementId) {
            try {
                narrativeEntitySystem().cancelTurnReplacement(chatId, turnReplacementId);
            } catch (error) {
                console.error('[Narrative State] Could not restore the replaced turn:', error);
            }
        }
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

// --- SYSTEM AI, TAGGING AND ARCHIVE SUMMARIES ---

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

// The sheets and perspectives the roleplay context carries before any research. The places the
// scene sits within are named there too, so they count as inside it.
function roleplaySceneContext(chatId) {
    try {
        const { RoleplaySystem } = require('../../dist-main/main/features/narrative/roleplay-system');
        const roleplay = new RoleplaySystem(db);
        const scene = roleplay.getScene(chatId);
        if (!scene) return null;
        const playerId = roleplay.getSettings(chatId)?.playerEntityId || null;
        const perspectiveIds = new Set([playerId, ...(scene.participantIds || [])].filter(Boolean));
        const bystanderIds = new Set([...(scene.possibleObserverIds || []), ...(scene.nearbyIds || [])].filter(id => !perspectiveIds.has(id)));
        const placeIds = new Set();
        for (let id = scene.locationId; id && !placeIds.has(id);) {
            placeIds.add(id);
            id = db.prepare("SELECT toId FROM entity_links WHERE workspaceId = ? AND fromId = ? AND relType = 'inside' LIMIT 1").get(chatId, id)?.toId;
        }
        return {
            perspectiveIds,
            bystanderIds,
            sheetIds: new Set([...perspectiveIds, ...bystanderIds, scene.locationId].filter(Boolean)),
            insideIds: new Set([...perspectiveIds, ...bystanderIds, ...placeIds, ...(scene.objectIds || [])])
        };
    } catch (error) {
        console.warn('[Agentic RAG] Scene context unavailable:', error.message);
        return null;
    }
}

const GATE_CASE_FREE_TYPES = new Set(['Events']);

// Can only downgrade to the deterministic path, which still fills the context.
function resolvePlannerGate(chatId, request, { includeChatContext = true, force = false, roleplay = false } = {}) {
    let entities = [];
    try {
        entities = includeChatContext ? entitiesStore.listEntities({ workspaceId: chatId }) : [];
    } catch (e) { entities = []; }
    // Events are spoken of as common nouns ("the festival"), so their names match in any casing;
    // a false match costs one planner run, a missed one the research.
    const mentionedIds = entityMentionIds(request, entities, { caseFreeTypes: GATE_CASE_FREE_TYPES });
    const sceneContext = roleplay && includeChatContext ? roleplaySceneContext(chatId) : null;
    const nameOf = new Map(entities.map(entity => [entity.id, entity.canonicalName]));
    const names = ids => ids.map(id => nameOf.get(id) || id);
    const scene = sceneContext ? {
        outside: names([...mentionedIds].filter(id => !sceneContext.insideIds.has(id))),
        bystanders: names([...mentionedIds].filter(id => sceneContext.bystanderIds.has(id)))
    } : null;
    const decision = shouldRunPlanner(request, { entityMentions: mentionedIds.size, force, scene });
    return { ...decision, entities, mentionedIds, sceneContext };
}

function isChatArchiveSummarizationEnabled() {
    return readAdvancedSettings().archiveSummarization !== false;
}

function getSystemLanguageInstruction() {
    const language = String(readAdvancedSettings().systemOutputLanguage || 'English').trim() || 'English';
    return `Write all generated natural-language content in ${language}. Never translate or transliterate proper nouns, canonical names, titles used as names, identifiers, JSON keys, enum values, control markers, or verbatim evidence. Keep each of them exactly as supplied.`;
}

// Imported cards and documents are often in another language; the sheet still follows the one the person chose.
function getSourceLanguageInstruction() {
    const language = String(readAdvancedSettings().systemOutputLanguage || 'English').trim() || 'English';
    return `The evidence may be written in another language. Every value you write (field values, lore, history, sourcePerspective, targetRole, support, and every statement) is still written in ${language}: translate what you take from the evidence instead of copying its language. Names and verbatim quotes stay as written.`;
}

const { edgeDetail } = require('./features/worldbuild/relation-dossier');
const { relationTitle } = require('../../dist-main/shared/relation-phrases');
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

// The workspace's MAX API Payload, for background calls that have no step budget of their own.
// Every entity of the workspace, oldest first, so a turn's labels stay the same as the world grows.
function loadEntityLabels(workspaceId) {
    try {
        return createEntityLabels(db.prepare('SELECT id, type, canonicalName FROM entities WHERE workspaceId = ? ORDER BY rowid').all(workspaceId));
    } catch (error) {
        console.warn('[Entity labels] Requests keep their IDs:', error.message);
        return createEntityLabels([]);
    }
}

function workspacePayloadTokens(workspaceId) {
    try {
        return normalizeMaxApiPayload(db.prepare('SELECT maxContext FROM chats WHERE id = ?').get(workspaceId)?.maxContext);
    } catch (e) {
        return normalizeMaxApiPayload(null);
    }
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
// Every chunk must end completed or failed in world_index_chunk_status, with its real tag count.
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
        send: payload => sendTaggerRequest({ apiProfileId, model, chatHistory: [], manualMode: false, manualJson: null, maxPayloadTokens: workspacePayloadTokens(workspaceId), ...payload }),
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

    const payloadLimit = resolvePayloadLimit({
        apiProfileId: summarizer.executor.apiProfileId,
        model: summarizer.executor.model,
        maxPayloadTokens: normalizeMaxApiPayload(maxPayloadTokens)
    });
    const limit = payloadLimit.limit;
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
        payloadLimit,
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
        return !row || JSON.parse(row.value).allowAiEntityCreation !== false;
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
        db.transaction(() => { for (const id of toDelete) { delChunk.run(id); } })();
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

// A per-call random fence, so a reply cannot close the structured block by accident.
function buildItemsFence() {
    const s = crypto.randomBytes(3).toString('hex');
    return { open: `<<ITEMS_${s}>>`, close: `<</ITEMS_${s}>>` };
}

// The reasoning head before the fence and the structured body inside it.
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

// First JSON array in a reply body; an unreadable body is an empty list.
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

function safeParseObject(body) {
    if (!body) return null;
    try {
        const start = body.indexOf('{');
        const end = body.lastIndexOf('}');
        if (start === -1 || end === -1 || end < start) return null;
        const o = JSON.parse(body.slice(start, end + 1));
        return (o && typeof o === 'object' && !Array.isArray(o)) ? o : null;
    } catch (e) { return null; }
}

const ENRICH_RELATION_GUIDANCE = {
    'Characters.race': 'Only an explicitly established ancestry, species, lineage, or people.',
    'Creatures.species': 'Only an explicitly established species or kind this specific being belongs to, never a resemblance or comparison.',
    'Characters.factions': 'Only explicit membership or formal allegiance, not cooperation, employment, sympathy, or proximity.',
    'Characters.livesIn': 'Where this character lives now, as specific as the passages allow: the house, inn, room or building rather than the city it stands in. Stated or shown again and again (they sleep there, keep their room there, come home there). Not where they were born, work, or visit in one scene, and not a home they left.',
    'Characters.worksAt': 'Where or for whom this character works now, as specific as the passages allow: the workshop, inn or post rather than the city it stands in. A job, trade or service stated or shown again and again (they run, staff or serve that place or faction). Never a former employer, nor a group they left, deserted, were captured from or turned against. Formal membership is a faction, not work. A Works at link already on the record without a job is returned again with its job.',
    'Characters.locations': 'Only another persistent meaningful tie to a place that is neither home nor work, such as birthplace, a place they rule or guard, or an established haunt; not presence in one scene.',
    'Characters.relationships': 'Only an explicitly established directional personal relationship. targetRole states what TARGET is to SOURCE. value and sourcePerspective state how SOURCE feels about and relates to TARGET.',
    'Creatures.relationships': 'Only an explicitly established directional personal relationship involving a specific creature. targetRole states what TARGET is to SOURCE. value and sourcePerspective state how SOURCE feels about and relates to TARGET.',
    'Locations.inside': 'Only explicit physical containment inside another location, never proximity, jurisdiction, association, or travel between places. SOURCE is the smaller place and TARGET the larger one around it: a nation, region or city is never inside a building or a smaller place.',
    'Locations.leader': 'Only explicit ownership, leadership, or governance of the location. Working, serving, living, studying or being raised there, or being affiliated with it, is not leadership.',
    'Items.creator': 'Only the explicitly established creator or maker.',
    'Items.owner': 'Only current explicit ownership; use, custody, discovery, or theft alone does not prove ownership.',
    'Items.currentLocation': 'Only the explicit current world location of this unique item. Do not propose it when the item is currently held in an individual inventory.',
    'Items.foundIn': 'For item types only: explicit places where the type is found, produced, or gathered.',
    'Items.soldIn': 'For item types only: explicit places where the type is normally sold.',
    'Creatures.habitat': 'Only an explicitly established natural or habitual location, not a single encounter site.',
    'Factions.leader': 'Only an explicitly established current leader. A member, officer, secretary or envoy is not the leader.',
    'Factions.operatesIn': 'Only an established area of operation, base, territory, or sustained activity of the group itself. Where one member works or lives is not the group\'s base.',
    'Factions.members': 'Only explicit membership; the label must state the supported role when available.',
    'Factions.relationships': 'Only an explicitly established stance of the group as a whole toward another faction or a person: alliance, rivalry, war, patronage, a debt, a feud. targetRole states what TARGET is to SOURCE (Ally, Rival, Patron, Enemy). value and sourcePerspective state how SOURCE as a group regards TARGET, never one member\'s private feeling. Membership and leadership are not relations.',
    'Events.happenedAt': 'Only a location where the event explicitly occurred.',
    'Events.involved': 'Only a character explicitly participating in or materially affected by the event, not merely mentioned nearby.',
};

const ENRICH_RELATION_DIRECTION = {
    'Locations.inside': name => `TARGET must be a larger place that physically contains ${name}; if ${name} contains the candidate instead, return nothing.`,
    'Locations.leader': name => `TARGET must be someone who rules, governs or owns ${name} itself.`,
    'Factions.operatesIn': name => `TARGET must be a place where ${name} as a group is based or active.`,
    'Factions.leader': name => `TARGET must be the one who leads ${name}.`,
};

const ENTITY_ENRICHMENT_SCHEMA_VERSION = 'semantic-v8-field-coverage';

// A passage is read again only when its text or strength changes; empty fields have a pass of their own.
function entityEnrichmentSignature(chunk) {
    return `${ENTITY_ENRICHMENT_SCHEMA_VERSION}:${chunk.isTagged ? 'tagged' : 'text'}:${chunk.contentHash}`;
}

function enrichFieldsForEntity(entity) {
    return filterUpdateFields(entity, ENRICH_FIELDS[entity.type] || []);
}

let narrativeChatContext = null;
function getNarrativeChatContext() {
    if (!narrativeChatContext) {
        const { createNarrativeChatContext } = require('../../dist-main/main/features/narrative/chat-context');
        narrativeChatContext = createNarrativeChatContext(db, estimateTokens);
    }
    return narrativeChatContext;
}

// A passage cut from a longer text starts at its first full sentence, not in the middle of a word.
function fromSentenceStart(text) {
    const value = String(text || '').trim();
    if (!/^[\p{Ll}\p{N}]/u.test(value)) return value;
    const start = value.search(/[.!?…]["'”»)]*\s+\S/u);
    return start >= 0 && start < value.length / 2 ? value.slice(start).replace(/^[.!?…"'”»)\s]+/u, '') : value;
}

function roleplaySceneInput(workspaceId) {
    try {
        const { RoleplaySystem } = require('../../dist-main/main/features/narrative/roleplay-system');
        const roleplay = new RoleplaySystem(db);
        const scene = roleplay.getScene(workspaceId);
        const playerId = roleplay.getSettings(workspaceId)?.playerEntityId || null;
        if (!scene && !playerId) return null;
        return {
            locationId: scene?.locationId || null,
            participantIds: scene?.participantIds || [],
            possibleObserverIds: scene?.possibleObserverIds || [],
            nearbyIds: scene?.nearbyIds || [],
            objectIds: scene?.objectIds || [],
            playerId
        };
    } catch (error) {
        console.warn('[Retrieval] Scene unavailable:', error.message);
        return null;
    }
}

/**
 * The context of one turn in a workspace: the planner lists what the turn needs, and the assembler
 * reads exactly that. The budget is a ceiling the context stays under, never a size to reach.
 */
async function assembleTurnContext({ chatId, chat, profile, request, lastReply, ceiling, isRoleplay, plannerExecutor, run, webContents, includeChatContext, filterProfileResults, recentOriginIds = [] }) {
    const { assembleContext } = require('../../dist-main/main/features/narrative/retrieval/assembler');
    const { briefPrompt, briefSchema, ROLEPLAY_NEEDS, STANDARD_NEEDS } = require('../../dist-main/main/features/narrative/retrieval/needs');
    const mode = isRoleplay ? 'roleplay' : 'standard';
    const scene = isRoleplay ? roleplaySceneInput(chatId) : null;
    const brief = { response: '', inputTokens: 0, outputTokens: 0, cache: {}, error: null, needs: null };

    // Profile knowledge is the narrator's own reference: searched apart, and kept small.
    let profileText = '';
    let profileTokens = 0;
    try {
        const results = filterProfileResults(await searchKnowledgeBase(request, profile.id, { k: 4 }) || []);
        const room = Math.floor(ceiling * 0.2);
        for (const result of results) {
            const text = `[${result.source}]: ${result.text}`;
            const tokens = estimateTokens(text);
            if (profileTokens + tokens > room) break;
            profileText += `${profileText ? '\n\n' : ''}${text}`;
            profileTokens += tokens;
        }
    } catch (error) {
        console.warn('[Retrieval] Profile knowledge search failed:', error.message);
    }

    const entities = (() => { try { return entitiesStore.listEntities({ workspaceId: chatId }); } catch { return []; } })();
    const nameOf = new Map(entities.map(entity => [entity.id, entity.canonicalName]));
    const documents = (() => {
        try {
            const files = typeof chat?.knowledgeFiles === 'string' ? JSON.parse(chat.knowledgeFiles) : (chat?.knowledgeFiles || []);
            return files.map(file => file.name).filter(Boolean);
        } catch { return []; }
    })();

    if (plannerExecutor) {
        const coreIds = scene ? [scene.playerId, ...scene.participantIds, ...scene.possibleObserverIds, ...scene.nearbyIds, ...scene.objectIds, scene.locationId].filter(Boolean) : [];
        const mentionedIds = [...entityMentionIds(request, entities, { caseFreeTypes: new Set(['Events', 'System']) })];
        const mentioned = mentionedIds.map(id => nameOf.get(id)).filter(Boolean);
        // What the Worldbuild links to the names in the turn and the scene, so the planner can name what
        // the turn describes without naming it.
        const linked = (() => {
            try {
                const { createWorldbuildView } = require('../../dist-main/main/features/narrative/retrieval/entity-tiers');
                const { linkedNames } = require('../../dist-main/main/features/narrative/retrieval/linked-names');
                const replyIds = [...entityMentionIds(String(lastReply || '').slice(-1500), entities, { caseFreeTypes: new Set(['Events', 'System']) })];
                return linkedNames(createWorldbuildView(db, chatId), { mentionedIds: [...new Set([...mentionedIds, ...replyIds])], sceneIds: coreIds });
            } catch (error) {
                console.warn('[Retrieval] Could not list linked names:', error.message);
                return [];
            }
        })();
        const sceneSkills = (() => {
            if (!scene) return [];
            try {
                const { loadSkillBook } = require('../../dist-main/main/features/narrative/retrieval/skills');
                return loadSkillBook(db, chatId, [scene.playerId, ...scene.participantIds].filter(Boolean), id => nameOf.get(id)).heldNames;
            } catch (error) {
                console.warn('[Retrieval] Could not list the skills in the scene:', error.message);
                return [];
            }
        })();
        const prompt = briefPrompt({
            mode,
            request,
            lastReply,
            coreNames: [...new Set(coreIds.map(id => nameOf.get(id)).filter(Boolean))],
            mentioned,
            documents: mode === 'standard' ? documents : [],
            skills: sceneSkills,
            linked,
            guidance: profile.agenticPrompt || ''
        });
        const telemetry = { structuredFallbacks: 0, structuredFallbackStages: [], structuredFallbackReasons: [], structuredOutputMode: 'schema', cache: brief.cache, calls: null };
        try {
            if (webContents) sendRunEvent(webContents, 'workflow-progress', run, { profileName: profile.name, status: 'Reading the turn...' });
            const systemPrompt = `${getSystemLanguageInstruction()}\n${prompt.systemPrompt}`;
            brief.response = await sendNarrativeJson({
                apiProfileId: plannerExecutor.apiProfileId,
                model: plannerExecutor.model,
                systemPrompt,
                chatHistory: [],
                newPrompt: prompt.prompt,
                temperature: 0,
                maxTokens: 1200,
                maxPayloadTokens: workspacePayloadTokens(chatId),
                manualMode: false,
                manualJson: null,
                cacheScope: `${chatId}::retrieval-brief`
            }, briefSchema(isRoleplay ? ROLEPLAY_NEEDS : STANDARD_NEEDS), 'Retrieval brief', telemetry);
            brief.inputTokens = estimateTokens(systemPrompt) + estimateTokens(prompt.prompt);
            brief.outputTokens = estimateTokens(brief.response);
            brief.needs = safeParseObject(brief.response);
        } catch (error) {
            // Without the brief the context still holds the scene and every name the turn wrote.
            brief.error = String(error.message || error).slice(0, 300);
            console.warn('[Retrieval] The brief failed; continuing with the names in the turn:', brief.error);
        }
    }

    // A research need gets the tool loop, on its own question, and only what the loop cites.
    const research = new Map();
    const researchNeeds = (Array.isArray(brief.needs?.needs) ? brief.needs.needs : []).filter(need => need?.kind === 'research');
    if (mode === 'standard' && plannerExecutor && researchNeeds.length) {
        let index = 0;
        for (const need of brief.needs.needs) {
            index += 1;
            if (need?.kind !== 'research') continue;
            const question = String(need.query || need.label || '').trim();
            if (!question) continue;
            try {
                const result = await executeAgenticRagLoop(profile, chatId, question, [], webContents, includeChatContext, plannerExecutor, run, {
                    retrievalBudget: Math.floor(ceiling / 3),
                    userRequest: question,
                    skipSeed: true,
                    maxTurns: Math.min(5, Math.max(1, Number.isInteger(profile.agenticMaxTurns) ? profile.agenticMaxTurns : 2))
                });
                brief.inputTokens += result?.agenticInputTokens || 0;
                brief.outputTokens += result?.agenticOutputTokens || 0;
                // Keyed by its place in the planner's answer, which the parsed need keeps.
                research.set(index - 1, (result?.contextItems || []).slice(0, 6).map((item, position) => ({ id: (item.ids || [])[0] || `research-${index}-${position}`, source: item.source || 'research', text: item.text })));
            } catch (error) {
                console.warn('[Retrieval] Research need failed:', error.message);
            }
        }
    }

    try {
        require('../../dist-main/main/features/narrative/umwelt/story-fact-text').addFactTexts(db, chatId);
    } catch (error) {
        console.warn('[Narrative State] Could not add search text to earlier facts:', error.message);
    }
    const local = (readAdvancedSettings().embeddingEngine || 'local') === 'local';
    if (local) fillStoryVectors(chatId);
    const blocks = (() => {
        try { return typeof chat?.memoryBlocks === 'string' ? JSON.parse(chat.memoryBlocks) : (chat?.memoryBlocks || []); } catch { return []; }
    })();
    const assembled = await assembleContext({
        db,
        workspaceId: chatId,
        mode,
        request,
        lastReply,
        recentOriginIds,
        scene,
        ceiling: Math.max(0, ceiling - profileTokens),
        estimateTokens,
        source: getNarrativeChatContext(),
        brief: brief.needs,
        ...(local ? { embed: text => generateEmbeddingVector(text, true) } : {}),
        searchDocuments: async need => {
            const query = need.query || need.label;
            if (!query) return [];
            const results = await searchChatKnowledgeBase(query, chatId, { k: 4, source: need.documentName || null });
            return (results || []).map(result => ({ id: result.id, source: result.source, text: fromSentenceStart(result.text), score: result.score }));
        },
        searchArchive: async need => {
            const query = need.query || need.label;
            if (!query) return [];
            const results = filterWorkspaceMemoryResults(await searchChatMemories(query, chatId, { k: 3 }) || [], blocks, profile.id);
            return results.map(result => ({ id: result.id, source: result.source || 'Chat Archive', text: fromSentenceStart(result.text), score: result.score }));
        },
        research
    });
    return {
        ...assembled,
        profileText,
        profileTokens,
        brief: {
            ...brief,
            needs: assembled.needs.length,
            note: brief.error ? `the brief failed (${brief.error}); names and the message's own words` : plannerExecutor ? `${assembled.needs.length} need(s)` : 'Smart search off; names and the message\'s own words'
        }
    };
}

// The story's own texts get vectors from the local model only, so turning this on never bills a
// paid embedding API. A failure leaves the request to the name and keyword matching it had before.
async function storyQueryVector(workspaceId, query) {
    if ((readAdvancedSettings().embeddingEngine || 'local') !== 'local' || !String(query || '').trim()) return null;
    try {
        fillStoryVectors(workspaceId);
        return await generateEmbeddingVector(query, true);
    } catch (error) {
        console.warn('[Narrative State] Could not search the story by meaning:', error.message);
        return null;
    }
}

// One background run per workspace, a small page at a time, so a long backlog never holds up a turn.
// The engine's resume cursor keeps later runs to what was written since.
const storyVectorRuns = new Map();
const storyVectorCursors = new Map();
const STORY_VECTOR_PAGE = 16;

function fillStoryVectors(workspaceId) {
    if (!workspaceId || (readAdvancedSettings().embeddingEngine || 'local') !== 'local') return null;
    if (storyVectorRuns.has(workspaceId)) return storyVectorRuns.get(workspaceId);
    const run = (async () => {
        const search = require('../../dist-main/main/features/narrative/umwelt/story-search');
        let stored = 0;
        let cursor = storyVectorCursors.get(workspaceId) || null;
        for (;;) {
            const page = search.pendingStoryPage(db, workspaceId, { limit: STORY_VECTOR_PAGE, cursor });
            if (page.items.length) {
                const vectors = await generateEmbeddingVectors(page.items.map(item => item.text));
                stored += search.storeStoryVectors(db, workspaceId, page.items.map((item, index) => ({ ...item, vector: vectors[index] })));
            }
            if (!page.nextCursor) {
                if (page.resumeCursor) storyVectorCursors.set(workspaceId, page.resumeCursor);
                break;
            }
            cursor = page.nextCursor;
            await new Promise(resolve => setImmediate(resolve));
        }
        return stored;
    })().catch(error => {
        console.warn('[Narrative State] Could not prepare the story for search by meaning:', error.message);
        return 0;
    }).finally(() => storyVectorRuns.delete(workspaceId));
    storyVectorRuns.set(workspaceId, run);
    return run;
}

function shouldPlanWorkspaceContext(chatId, includeChatContext) {
    if (includeChatContext) return true;
    try {
        const { getWorkspaceExperienceMode } = require('../../dist-main/main/features/narrative/mode-orchestration');
        return getWorkspaceExperienceMode(db, chatId) === 'roleplay';
    } catch {
        return false;
    }
}

// What may be created is the workspace's creation policy; Review everything sends all of it to the user.
function shouldProcessNarrativeEntityProposal(proposal, updatePolicy) {
    return updatePolicy !== 'manual' && Boolean(proposal);
}

function entityCreationFor(settings) {
    const policy = settings.entityCreation || {};
    if (settings.defaultUpdatePolicy !== 'review') return policy;
    return Object.fromEntries(Object.entries(policy).map(([kind, mode]) => [kind, mode === 'auto' ? 'review' : mode]));
}

function shouldProcessNarrativeIdentityUpdate(update, updatePolicy) {
    if (updatePolicy === 'manual') return false;
    if (updatePolicy === 'review') return true;
    return update?.identityEstablished === true && Number(update.confidence) >= 0.9;
}

async function updateRoleplayStateWithSystemAi({ workspaceId, provenanceId, userMessage, narrativeResponse: storedResponse, modelCalls = null }) {
    // The narrator's reasoning holds plans and guesses, not events, so the analysis reads only the narration.
    const narrativeResponse = stripReasoning(storedResponse);
    const { getWorkspaceExperienceMode } = require('../../dist-main/main/features/narrative/mode-orchestration');
    if (getWorkspaceExperienceMode(db, workspaceId) !== 'roleplay') {
        return { changes: [], diagnostics: null };
    }

    const calendarService = require('./features/worldbuild/calendar-service');
    const { RoleplaySystem } = require('../../dist-main/main/features/narrative/roleplay-system');
    const roleplay = new RoleplaySystem(db);
    const scene = roleplay.getScene(workspaceId);
    const startClock = calendarService.getRoleplayClock(db, workspaceId);
    // Resources that recover or drain follow the time the turn moved the clock, for the player
    // and whoever is in the scene; a manual clock correction is not story time and moves nothing.
    const recordTimeFrame = (timeAdvance, endLocationId = roleplay.getScene(workspaceId)?.locationId, minimumMinutes = 0, maximumMinutes = 0) => {
        const frame = calendarService.applyRoleplayTurnFrame(db, {
            workspaceId,
            originId: provenanceId,
            startClock,
            startLocationId: scene?.locationId,
            endLocationId,
            timeAdvance,
            minimumMinutes,
            maximumMinutes
        });
        if (frame?.advance?.duration) {
            try {
                const minutes = calendarService.durationTotalMinutes(calendarService.getCalendar(db, workspaceId), frame.advance.duration);
                const present = roleplay.getScene(workspaceId);
                const inScene = [
                    roleplay.getSettings(workspaceId).playerEntityId,
                    ...(present?.participantIds || []),
                    ...(scene?.participantIds || [])
                ].filter(Boolean);
                roleplay.applyElapsedTime(workspaceId, provenanceId, minutes, inScene);
                const rest = restWithin(timeAdvance?.rest, minutes, new Set(inScene));
                if (rest) roleplay.applyRest(workspaceId, provenanceId, rest);
                applyConditionTime(workspaceId, provenanceId, { minutes, rest });
            } catch (error) {
                console.warn('[Roleplay Time] Could not apply resource changes over time:', error.message);
            }
        }
        // What the turn and the clock did to resources may cross a condition's line either way.
        applyConditionThresholds(workspaceId, provenanceId, [
            roleplay.getSettings(workspaceId).playerEntityId,
            ...(roleplay.getScene(workspaceId)?.participantIds || []),
            ...(scene?.participantIds || [])
        ].filter(Boolean));
        return frame;
    };

    const { ROLE_IDS, resolveAiEngineRole } = require('./features/ai-engine/role-resolver');
    const role = resolveAiEngineRole(ROLE_IDS.NARRATIVE_STATE);
    if (!role.executor) {
        if (role.error) console.warn('[Narrative State] Skipped:', role.error);
        recordTimeFrame(null);
        return {
            changes: [],
            diagnostics: {
                status: 'skipped',
                reason: role.error || 'Narrative State has no configured executor.',
                usage: {}
            }
        };
    }

    const { NarrativeStateSystem } = require('../../dist-main/main/features/narrative/narrative-state');
    const { NarrativeEntitySystem } = require('../../dist-main/main/features/narrative/narrative-entities');
    const { NarrativeContextManifestRepository } = require('../../dist-main/main/features/narrative/context-manifest');
    const narrativeState = new NarrativeStateSystem(db);
    const narrativeEntities = new NarrativeEntitySystem(db);
    const contextManifests = new NarrativeContextManifestRepository(db);
    if (narrativeState.beginJob(workspaceId, provenanceId) === 'complete') {
        const existingMetric = narrativeState.listMetrics(workspaceId, 100)
            .find(metric => metric.originId === provenanceId);
        return {
            changes: [],
            diagnostics: {
                status: 'already-processed',
                usage: existingMetric ? {
                    triageInput: existingMetric.triageInputTokens,
                    triageOutput: existingMetric.triageOutputTokens,
                    deepInput: existingMetric.deepInputTokens,
                    deepOutput: existingMetric.deepOutputTokens
                } : {}
            }
        };
    }
    const preTurnManifest = contextManifests.getByOrigin(workspaceId, provenanceId);
    narrativeEntities.captureTurnSnapshot(workspaceId, provenanceId);
    const startedAt = Date.now();
    const definitions = roleplay.listDefinitions(workspaceId)
        .filter(definition => definition.enabled && definition.updatePolicy !== 'manual');
    const { RoleplayProgression } = require('../../dist-main/main/features/narrative/roleplay-progression');
    const progression = new RoleplayProgression(db);
    const { RoleplaySkills } = require('../../dist-main/main/features/narrative/roleplay-skills');
    const skillSystem = new RoleplaySkills(db);
    const allEntities = db.prepare(`
        SELECT id, type, canonicalName, aliases, lore, data FROM entities
        WHERE workspaceId = ?
          AND (status != 'proposed' OR id IN (
            SELECT entity_id FROM roleplay_entity_changes
            WHERE workspace_id = entities.workspaceId AND status IN ('pending', 'conflicting') AND created_entity = 1
          ))
          AND type IN ('Characters', 'Creatures', 'Locations', 'Items', 'Factions', 'Events', 'Races')
        ORDER BY type, canonicalName COLLATE NOCASE
    `).all(workspaceId);
    const roleplaySettings = roleplay.getSettings(workspaceId);
    const activeIds = new Set([
        roleplaySettings.playerEntityId,
        scene?.locationId,
        ...(scene?.participantIds || []),
        ...(scene?.possibleObserverIds || []),
        ...(scene?.nearbyIds || []),
        ...(scene?.objectIds || [])
    ].filter(Boolean));
    if (scene?.locationId) {
        db.prepare(`
            SELECT fromId, toId FROM entity_links
            WHERE workspaceId = ? AND relType = 'inside' AND (fromId = ? OR toId = ?)
        `).all(workspaceId, scene.locationId, scene.locationId)
            .forEach(link => { activeIds.add(link.fromId); activeIds.add(link.toId); });
    }
    const narrativeSignals = extractNarrativeSignals({
        userMessage,
        narrativeResponse,
        entities: allEntities
    });
    const mentionedEntityIds = new Set(narrativeSignals.mentionedEntityIds);
    const entities = allEntities.filter(entity => {
        if (activeIds.has(entity.id)) return true;
        return mentionedEntityIds.has(entity.id);
    }).map(({ id, type, canonicalName, aliases, lore, data }) => ({
        id,
        type,
        canonicalName,
        aliases: safeParseArray(aliases),
        lore: String(lore || '').slice(0, 2000),
        data: safeParseObject(data) || {}
    }));
    const locationSizes = locationSizesOf(allEntities);
    const compactEntities = entities.map(entity => ({
        id: entity.id,
        type: entity.type,
        canonicalName: entity.canonicalName,
        aliases: entity.aliases,
        ...(entity.type === 'Items' ? {
            itemNature: entity.data.itemNature === 'unique' ? 'unique' : 'type'
        } : {}),
        ...(entity.type === 'Locations' && locationSizes.get(entity.id) ? { size: locationSizes.get(entity.id) } : {}),
        ...(entity.type === 'Events' ? {
            eventNature: entity.data.eventNature === 'recurring' ? 'recurring' : 'one-time',
            kind: entity.data.kind || '',
            recurrence: entity.data.recurrence || null
        } : {})
    }));
    const allowedEntityIds = new Set(allEntities.map(entity => entity.id));
    const entityLabels = loadEntityLabels(workspaceId);
    const actorIds = new Set(allEntities
        .filter(entity => entity.type === 'Characters' || entity.type === 'Creatures')
        .map(entity => entity.id));
    const locationIds = new Set(allEntities.filter(entity => entity.type === 'Locations').map(entity => entity.id));
    const locationLinks = db.prepare(`
        SELECT fromId, toId, relType FROM entity_links
        WHERE workspaceId = ? AND relType IN ('inside', 'connected_to', 'adjacent_to')
    `).all(workspaceId).filter(link => locationIds.has(link.fromId) && locationIds.has(link.toId));
    // Sized worlds climb to the region around the scene. Unsized ones fall back to four levels,
    // enough for a room nested inside a district; the world root is never expanded either way.
    const reachableLocationIds = findReachableLocations(scene?.locationId, locationLinks, { maxDepth: 4, sizes: locationSizes });
    const calendar = calendarService.getCalendar(db, workspaceId);
    const timeMatrix = calendarService.getTimeMatrix(db, workspaceId);
    const narrativeLanguageInstruction = getSystemLanguageInstruction();
    const triageSystemPrompt = `${narrativeLanguageInstruction}\n${NARRATIVE_TRIAGE_SYSTEM_PROMPT}`;
    const repairSystemPrompt = `${narrativeLanguageInstruction}\n${NARRATIVE_REPAIR_SYSTEM_PROMPT}`;
    const { CharacterSceneMemory, normalizeSceneMemoryUpdates } = require('../../dist-main/main/features/narrative/character-scene-memory');
    const sceneMemory = new CharacterSceneMemory(db);
    const characterStances = sceneMemory.latestStances(workspaceId, [
        ...(scene?.participantIds || []),
        ...(scene?.possibleObserverIds || [])
    ].filter(id => id !== roleplaySettings.playerEntityId));
    const sceneMechanics = describeSceneMechanics({ workspaceId, roleplay, actorIds: [
        roleplaySettings.playerEntityId,
        ...(scene?.participantIds || [])
    ].filter(id => id && actorIds.has(id)) });
    // What rarely changes comes first, so a provider that reuses a repeated prefix keeps more of it.
    const triagePayloadValue = entityLabels.encodeValue({
        calendar: {
            name: calendar.name,
            hoursPerDay: calendar.hoursPerDay,
            months: calendar.months.map(month => ({ name: month.name, days: month.days })),
            weekdays: calendar.weekdays,
            seasons: calendar.seasons
        },
        timeMatrix,
        availableEntities: compactEntities,
        currentScene: compactNarrativeScene(scene, roleplaySettings.playerEntityId),
        currentLocation: describeSceneLocationChain(workspaceId, scene?.locationId, inferLocationSizes(locationLinks, locationSizes)),
        mechanics: sceneMechanics.entries.length ? sceneMechanics.entries : undefined,
        currentTime: startClock,
        candidateSignals: narrativeSignals,
        characterStances: characterStances.length ? characterStances : undefined,
        userMessage,
        narrativeResponse
    });
    const triagePayload = JSON.stringify(triagePayloadValue);
    const narrativePayloadTokens = workspacePayloadTokens(workspaceId);
    const narrativeTelemetry = {
        structuredFallbacks: 0,
        structuredFallbackStages: [],
        structuredFallbackReasons: [],
        structuredOutputMode: 'schema',
        cache: {},
        calls: modelCalls,
        labels: entityLabels
    };
    let triageRepairCount = 0;
    let deepRepairCount = 0;
    let repairInputTokens = 0;
    let repairOutputTokens = 0;
    // Only what the model writes is billed, so the cap only has to be safely above a full answer:
    // a cut one loses sceneMemory, the last field, and costs a repair.
    let triageResponse = await sendNarrativeJson({
        apiProfileId: role.executor.apiProfileId,
        model: role.executor.model,
        systemPrompt: triageSystemPrompt,
        chatHistory: [], newPrompt: triagePayload, temperature: 0, maxTokens: 2560, maxPayloadTokens: narrativePayloadTokens, manualMode: false, manualJson: null,
        cacheScope: `${workspaceId}::narrative-triage`
    }, NARRATIVE_TRIAGE_SCHEMA, 'Narrative State triage', narrativeTelemetry);
    const triagePrimaryOutputTokens = estimateTokens(triageResponse);
    let triage = safeParseObject(entityLabels.decode(triageResponse));
    if (!triage) {
        triageRepairCount += 1;
        repairInputTokens += estimateTokens(repairSystemPrompt)
            + estimateTokens(`INVALID RESPONSE:\n${String(triageResponse || '').slice(0, 16000)}`);
        triageResponse = await repairNarrativeJson({
            executor: role.executor,
            invalidResponse: triageResponse,
            schema: NARRATIVE_TRIAGE_SCHEMA,
            label: 'Narrative State triage',
            telemetry: narrativeTelemetry,
            maxPayloadTokens: narrativePayloadTokens,
            languageInstruction: narrativeLanguageInstruction
        });
        repairOutputTokens += estimateTokens(triageResponse);
        triage = safeParseObject(entityLabels.decode(triageResponse));
    }
    if (triage) {
        triage.timeAdvance = resolveNarrativeTimeAdvance({
            timeAdvance: triage.timeAdvance,
            startClock,
            calendar,
            userMessage,
            narrativeResponse
        });
        triage.sceneMemory = recordCharacterSceneMemory({
            sceneMemory,
            normalizeSceneMemoryUpdates,
            workspaceId,
            provenanceId,
            triage,
            actorIds,
            playerEntityId: roleplaySettings.playerEntityId,
            locationId: scene?.locationId || null
        });
    }
    // Who joined or left the conversation, from this triage and the previous turn's.
    const castSignals = triage ? {
        playerId: roleplaySettings.playerEntityId,
        ...turnCastSignals(triage, actorIds),
        previous: previousTurnCastSignals(workspaceId, provenanceId, actorIds)
    } : null;
    const proposeCastChange = () => {
        if (!castSignals || !scene) return null;
        const patch = resolveSceneCast({ scene, ...castSignals });
        if (!Object.keys(patch).length) return null;
        try {
            const change = roleplay.proposeSceneChange({ id: `${provenanceId}:scene`, workspaceId, patch, source: 'ai', provenanceId });
            return { kind: 'scene', changeId: change.id, ...change };
        } catch (error) {
            console.warn('[Roleplay State] Ignored the conversation change:', error.message);
            return null;
        }
    };
    // Where and when the turn ended, for the "last time" a character comes back to.
    const settleSceneMemory = () => {
        try {
            const clock = calendarService.getRoleplayClock(db, workspaceId);
            const formatted = calendarService.formatClock(calendarService.getCalendar(db, workspaceId), clock);
            sceneMemory.settleTurn(workspaceId, provenanceId, {
                locationId: roleplay.getScene(workspaceId)?.locationId || null,
                timeLabel: [formatted.date, formatted.time].filter(Boolean).join(', ') || null
            });
        } catch (error) {
            console.warn('[Scene Memory] Could not record where the turn ended:', error.message);
        }
    };
    // Items someone in the scene carries or that lie where it happens: the ones a turn can hand over.
    const sceneHolderIds = [roleplaySettings.playerEntityId, ...(scene?.participantIds || []), ...(scene?.possibleObserverIds || []), ...(scene?.nearbyIds || [])].filter(Boolean);
    const reachableItemIds = new Set(scene?.objectIds || []);
    if (sceneHolderIds.length) {
        db.prepare(`
            SELECT fromId FROM entity_links
            WHERE workspaceId = ? AND relType IN ('owned_by', 'carried_by') AND toId IN (${sceneHolderIds.map(() => '?').join(',')})
        `).all(workspaceId, ...sceneHolderIds).forEach(link => reachableItemIds.add(link.fromId));
    }
    if (scene?.locationId) {
        db.prepare('SELECT item_id FROM roleplay_location_inventory WHERE workspace_id = ? AND location_id = ?')
            .all(workspaceId, scene.locationId).forEach(row => reachableItemIds.add(row.item_id));
    }
    const routing = resolveNarrativeRouting({
        triage,
        signals: narrativeSignals,
        hasResourceDefinitions: definitions.length > 0,
        reachableItemIds,
        namedMechanics: mentionedMechanics({ userMessage, narrativeResponse, terms: sceneMechanics.terms })
    });
    const forceDeepAnalysis = routing.forceDeepAnalysis;
    if (!triage?.consequential && !forceDeepAnalysis) {
        const timeFrame = recordTimeFrame(triage?.timeAdvance);
        const castChange = proposeCastChange();
        settleSceneMemory();
        // A night slept or a day skipped still ends the scene, with nothing else to record.
        const skippedSceneEnd = endedScene({ workspaceId, scene, finalScene: roleplay.getScene(workspaceId), timeFrame, calendarService })
            || longSceneCheckpoint({ workspaceId, originId: provenanceId, scene });
        if (skippedSceneEnd) narrativeState.queueStory(workspaceId, provenanceId, { maintenance: skippedSceneEnd, domains: [] });
        const triageInputTokens = estimateTokens(triageSystemPrompt) + estimateTokens(triagePayload);
        const triageOutputTokens = triagePrimaryOutputTokens;
        const elapsedMs = Date.now() - startedAt;
        narrativeState.finishJob(workspaceId, provenanceId, 'skipped', { inputTokens: triageInputTokens, outputTokens: triageOutputTokens });
        narrativeState.recordMetric({ workspaceId, originId: provenanceId, triageInputTokens, triageOutputTokens, deepInputTokens: 0, deepOutputTokens: 0, deepAnalysis: false, proposalCount: 0, elapsedMs, recordedAt: Date.now() });
        return {
            changes: [...(timeFrame.advance ? [{ kind: 'time', frame: timeFrame }] : []), ...(castChange ? [castChange] : [])],
            diagnostics: {
                status: 'skipped',
                manifest: preTurnManifest ? {
                    requestId: preTurnManifest.requestId,
                    sequence: preTurnManifest.sequence
                } : null,
                triage,
                timeFrame,
                forceDeepAnalysis,
                routing,
                story: skippedSceneEnd ? { status: 'queued', domains: [], sceneEnded: skippedSceneEnd.reason } : { status: 'not-needed', domains: [] },
                contextUsage: measureNarrativeContextSections(triagePayloadValue, triageSystemPrompt),
                repairs: {
                    triage: triageRepairCount,
                    deep: 0,
                    structuredFallbacks: narrativeTelemetry.structuredFallbacks,
                    structuredFallbackStages: narrativeTelemetry.structuredFallbackStages,
                    structuredFallbackReasons: narrativeTelemetry.structuredFallbackReasons,
                    structuredOutputMode: narrativeTelemetry.structuredOutputMode
                },
                usage: { triageInput: triageInputTokens, triageOutput: triageOutputTokens, repairInput: repairInputTokens, repairOutput: repairOutputTokens, cache: narrativeTelemetry.cache },
                elapsedMs
            }
        };
    }

    const selectedDomains = routing.selectedDomains;
    // The scene pass applies what the next turn needs now; what lasts waits for the story pass.
    const mechanicalDomains = selectedDomains.filter(domain => MECHANICAL_DOMAINS.has(domain));
    const storyDomains = selectedDomains.filter(domain => EPISTEMIC_DOMAINS.has(domain));
    const shouldAnalyzeEpistemicState = false;
    const triageEntityIds = (Array.isArray(triage?.entityIds) ? triage.entityIds : [])
        .filter(id => allowedEntityIds.has(id));
    const triagePresentIds = Array.isArray(triage?.presentIds)
        ? triage.presentIds.filter(id => actorIds.has(id))
        : null;
    const witnessIds = new Set([
        roleplaySettings.playerEntityId,
        ...(scene?.participantIds || []),
        ...(scene?.possibleObserverIds || []),
        ...narrativeSignals.mentionedActorIds,
        ...triageEntityIds,
        ...(triagePresentIds || [])
    ].filter(id => actorIds.has(id)));
    const targetIds = new Set([
        scene?.locationId,
        ...narrativeSignals.mentionedEntityIds,
        ...triageEntityIds
    ].filter(id => allowedEntityIds.has(id)));
    if (shouldAnalyzeEpistemicState) {
        for (const id of witnessIds) targetIds.add(id);
    }
    if (routing.requiresFullAnalysis) {
        for (const id of preTurnManifest?.subjectIds || []) witnessIds.add(id);
        for (const id of preTurnManifest?.targetIds || []) targetIds.add(id);
    }
    const affectedIds = new Set([...witnessIds, ...targetIds]);
    // What the turn concerns, by the triage. The player, the scene's participants and anyone who spoke
    // are read in full; the rest of the room, background actions included, only on these topics.
    const triageAboutIds = Array.isArray(triage?.aboutIds) ? triage.aboutIds.filter(id => allowedEntityIds.has(id)) : null;
    const speakerIds = (Array.isArray(triage?.sceneMemory) ? triage.sceneMemory : [])
        .flatMap(update => (update.heard || []).map(line => line.fromId))
        .filter(Boolean);
    const fullHolderIds = new Set([
        roleplaySettings.playerEntityId,
        ...(scene?.participantIds || []),
        ...speakerIds
    ].filter(Boolean));
    const topicIds = triageAboutIds ? new Set([
        ...triageAboutIds,
        ...fullHolderIds,
        scene?.locationId,
        ...narrativeSignals.mentionedEntityIds
    ].filter(Boolean)) : null;
    const shouldAnalyzeInventory = mechanicalDomains.includes('inventory');
    const shouldAnalyzeResources = mechanicalDomains.includes('resource');
    const shouldAnalyzeScene = mechanicalDomains.includes('scene');
    const relevantHolderIds = new Set([
        roleplaySettings.playerEntityId,
        ...(scene?.participantIds || []),
        ...(scene?.possibleObserverIds || []),
        ...(scene?.nearbyIds || []),
        ...witnessIds
    ].filter(id => actorIds.has(id)));
    const relevantItemIds = new Set(narrativeSignals.mentionedItemIds);
    // With the triage's topics, whole inventories only for who acts or is involved; anyone else
    // in the scene shows only the items the turn names.
    const inventoryHolderIds = topicIds
        ? new Set([...fullHolderIds, ...(triageAboutIds || [])].filter(id => actorIds.has(id)))
        : relevantHolderIds;
    const currentInventoryState = shouldAnalyzeInventory
        ? loadNarrativeInventoryState(workspaceId, inventoryHolderIds, relevantItemIds, relevantHolderIds)
        : [];
    const currentLocationInventoryState = shouldAnalyzeInventory
        ? loadNarrativeLocationInventoryState(workspaceId, scene?.locationId, relevantItemIds)
        : [];
    const currentResourceStates = shouldAnalyzeResources
        ? [...affectedIds].flatMap(entityId => roleplay.listEntityResources(workspaceId, entityId)
            .map(resource => ({
                entityId,
                resource: resource.name,
                current: resource.current,
                maximum: resource.maximum
            })))
        : [];
    const relevantEntities = entities.filter(entity =>
        routing.requiresFullAnalysis || affectedIds.has(entity.id) || activeIds.has(entity.id)
    );
    const newCharacterProfile = mechanicalDomains.includes('entity')
        ? describeNewCharacterProfile(progression, skillSystem, workspaceId)
        : null;
    // What rarely changes comes first (rules, then the places around), so a provider that reuses a
    // repeated prefix keeps more of it; the turn itself comes last.
    const payloadValue = entityLabels.encodeValue({
        availableResources: shouldAnalyzeResources
            ? definitions.map(({ name, description, minimum, maximum, unit, lowestEffect, updatePolicy, aiChangesMaximum, maximumRule }) => ({
                name,
                description,
                minimum,
                maximum,
                ...(unit ? { unit } : {}),
                ...(lowestEffect ? { lowestEffect } : {}),
                ...(aiChangesMaximum ? { maximumRule: maximumRule || 'Only a lasting change the story clearly shows.' } : {}),
                updatePolicy
            }))
            : undefined,
        newCharacterProfile: newCharacterProfile || undefined,
        ...(mechanicalDomains.includes('condition') ? describeConditionsForAnalysis(workspaceId, [...affectedIds, roleplaySettings.playerEntityId].filter(Boolean)) : {}),
        reachableLocationIds: shouldAnalyzeScene ? [...reachableLocationIds] : undefined,
        // A move outside the reachable set is rejected anyway, so links beyond it only cost tokens.
        locationLinks: shouldAnalyzeScene
            ? locationLinks.filter(link => reachableLocationIds.has(link.fromId) && reachableLocationIds.has(link.toId))
            : undefined,
        routing: {
            selectedDomains: mechanicalDomains,
            mode: routing.mode,
            requiresFullAnalysis: routing.requiresFullAnalysis,
            candidateSignals: narrativeSignals.signals
        },
        currentScene: compactNarrativeScene(scene, roleplaySettings.playerEntityId),
        availableEntities: mechanicalDomains.includes('entity')
            ? relevantEntities
            : relevantEntities.map(entity => compactEntities.find(candidate => candidate.id === entity.id)),
        currentResourceStates: shouldAnalyzeResources ? currentResourceStates : undefined,
        currentInventoryState: shouldAnalyzeInventory ? currentInventoryState : undefined,
        currentLocationInventoryState: shouldAnalyzeInventory ? currentLocationInventoryState : undefined,
        userMessage,
        narrativeResponse
    });
    const narrativeStateSystemPrompt = buildMechanicsSystemPrompt(
        mechanicalDomains,
        narrativeLanguageInstruction,
        Boolean(newCharacterProfile),
        Boolean(shouldAnalyzeResources && definitions.some(definition => definition.aiChangesMaximum))
    );
    const stateOutputBudget = Math.min(
        8192,
        Math.max(2048, 1024 + (relevantEntities.length * 64) + (shouldAnalyzeResources ? definitions.length * 96 : 0))
    );
    // Entity lore is the part of the analysis input that can shrink without losing the turn,
    // so it is shortened before the request is allowed to exceed the payload limit.
    const narrativeLimit = resolvePayloadLimit({ apiProfileId: role.executor.apiProfileId, model: role.executor.model, maxPayloadTokens: narrativePayloadTokens });
    let payload = JSON.stringify(payloadValue);
    for (const loreChars of [800, 0]) {
        const estimate = estimatePayloadTokens({ systemPrompt: narrativeStateSystemPrompt, newPrompt: payload, outputTokens: stateOutputBudget, maxPayloadTokens: narrativeLimit.limit });
        if (estimate.totalTokens <= narrativeLimit.limit || !Array.isArray(payloadValue.availableEntities)) break;
        payload = JSON.stringify({
            ...payloadValue,
            availableEntities: payloadValue.availableEntities.map(entity => (entity?.lore ? { ...entity, lore: String(entity.lore).slice(0, loreChars) } : entity))
        });
    }
    let response = mechanicalDomains.length ? await sendNarrativeJson({
        apiProfileId: role.executor.apiProfileId,
        model: role.executor.model,
        systemPrompt: narrativeStateSystemPrompt,
        chatHistory: [],
        newPrompt: payload,
        temperature: 0,
        maxTokens: stateOutputBudget,
        payloadLimit: narrativeLimit,
        manualMode: false,
        manualJson: null,
        cacheScope: `${workspaceId}::narrative-analysis`
    }, NARRATIVE_MECHANICS_SCHEMA, 'Narrative State scene', narrativeTelemetry) : JSON.stringify(EMPTY_MECHANICS);
    const deepPrimaryOutputTokens = mechanicalDomains.length ? estimateTokens(response) : 0;
    let parsed = safeParseObject(entityLabels.decode(response));
    if (!parsed) {
        deepRepairCount += 1;
        repairInputTokens += estimateTokens(repairSystemPrompt)
            + estimateTokens(`INVALID RESPONSE:\n${String(response || '').slice(0, 16000)}`);
        response = await repairNarrativeJson({
            executor: role.executor,
            invalidResponse: response,
            schema: NARRATIVE_MECHANICS_SCHEMA,
            label: 'Narrative State scene',
            telemetry: narrativeTelemetry,
            maxPayloadTokens: narrativePayloadTokens,
            languageInstruction: narrativeLanguageInstruction
        });
        repairOutputTokens += estimateTokens(response);
        parsed = safeParseObject(entityLabels.decode(response));
    }
    if (!parsed) {
        narrativeState.finishJob(workspaceId, provenanceId, 'failed', { deepAnalysis: true, error: 'Narrative State returned invalid JSON.' });
        throw new Error('Narrative State returned invalid Roleplay state JSON.');
    }
    const routedResult = constrainNarrativeStateResult(parsed, mechanicalDomains);

    const changes = [];
    const referenceIds = new Map();
    const narrativeIntroductions = [];
    const identityContactCandidates = [];
    const invalidInventoryChanges = [];
    let rejectedSceneChange = null;
    db.transaction(() => {
    for (const identityUpdate of routedResult.identityUpdates) {
        if (!shouldProcessNarrativeIdentityUpdate(identityUpdate, roleplaySettings.defaultUpdatePolicy)) continue;
        if (identityUpdate?.identityEstablished === true && actorIds.has(identityUpdate.entityId)) {
            identityContactCandidates.push({
                entityId: identityUpdate.entityId,
                excerpt: identityUpdate.excerpt,
                confidence: Number(identityUpdate.confidence),
                reason: identityUpdate.reason
            });
        }
        try {
            const change = narrativeEntities.resolveIdentityUpdate(
                workspaceId,
                provenanceId,
                identityUpdate,
                roleplaySettings.defaultUpdatePolicy
            );
            if (change) changes.push({ kind: 'entity', ...change });
        } catch (error) {
            console.warn('[Narrative State] Ignored invalid identity update:', error.message);
        }
    }
    for (const proposal of routedResult.newEntities) {
        if (!shouldProcessNarrativeEntityProposal(proposal, roleplaySettings.defaultUpdatePolicy)) continue;
        const change = narrativeEntities.resolveOrPropose(workspaceId, provenanceId, proposal, { sceneLocationId: scene?.locationId, policy: entityCreationFor(roleplaySettings) });
        changes.push({ kind: 'entity', ...change });
        if (change.entityId) {
            referenceIds.set(proposal.referenceId, change.entityId);
            allowedEntityIds.add(change.entityId);
            if (proposal.type === 'Characters' || (proposal.type === 'Creatures' && proposal.scope !== 'group')) actorIds.add(change.entityId);
            narrativeIntroductions.push({ proposal, entityId: change.entityId });
        }
    }
    const resolveReference = value => referenceIds.get(value) || value;
    const resolved = resolveNarrativeEntityReferences(routedResult, resolveReference);
    const scenePatch = buildNarrativeScenePatch(scene, resolved.scenePatch, narrativeIntroductions, narrativeSignals, {
        triageMarkedScene: Array.isArray(triage?.types) && triage.types.includes('scene')
    });
    // A destination dropped for lack of a completed move is reported, so the report says why the place stayed.
    const reportedLocationId = resolved.scenePatch?.locationId;
    if (reportedLocationId && reportedLocationId !== (scene?.locationId ?? null) && !Object.hasOwn(scenePatch, 'locationId')) {
        rejectedSceneChange = {
            reason: 'no-completed-movement',
            locationId: reportedLocationId,
            fromLocationId: scene?.locationId ?? null
        };
    }
    // The analysis may have moved people already; the conversation rules apply to the cast it left.
    if (castSignals && scene && !Object.hasOwn(scenePatch, 'locationId')) {
        const cast = {
            participantIds: scenePatch.participantIds ?? scene.participantIds,
            possibleObserverIds: scenePatch.possibleObserverIds ?? scene.possibleObserverIds,
            nearbyIds: scenePatch.nearbyIds ?? scene.nearbyIds
        };
        Object.assign(scenePatch, resolveSceneCast({ scene: cast, ...castSignals }));
    }
    for (const [index, proposal] of (Array.isArray(resolved.resourceChanges) ? resolved.resourceChanges : []).entries()) {
        if (typeof proposal?.entityId !== 'string') continue;
        // Growth is weighed once, when the scene ends; a turn that still reports it is ignored.
        if (proposal.skill || proposal.progress) continue;
        const definition = findByReference(definitions, proposal?.resource ?? proposal?.resourceKey);
        // A lasting change to the maximum is its own change, and always waits for review.
        if (definition?.aiChangesMaximum && Number.isFinite(proposal?.maximum) && Number(proposal.maximum) !== 0) {
            try {
                const change = roleplay.proposeChange({
                    id: `${provenanceId}:resource-maximum:${index}`,
                    workspaceId,
                    definitionId: definition.id,
                    entityId: proposal.entityId,
                    delta: 0,
                    maximumDelta: Number(proposal.maximum),
                    reason: typeof proposal.reason === 'string' ? proposal.reason : '',
                    source: 'ai',
                    provenanceId
                });
                changes.push({ kind: 'resource', changeId: change.id, ...change });
            } catch (error) {
                console.warn('[Roleplay State] Ignored invalid maximum change:', error.message);
            }
        }
        // The amount is what the story shows; an older absolute value is turned into one.
        const delta = Number.isFinite(proposal?.change)
            ? Number(proposal.change)
            : Number.isFinite(proposal?.value)
                ? Number(proposal.value) - (currentResourceStates.find(state => state.entityId === proposal.entityId && state.resource === definition?.name)?.current ?? Number(proposal.value))
                : NaN;
        if (!definition || !Number.isFinite(delta) || delta === 0) continue;
        try {
            const change = roleplay.proposeChange({
                id: `${provenanceId}:resource:${index}`,
                workspaceId,
                definitionId: definition.id,
                entityId: proposal.entityId,
                delta,
                reason: typeof proposal.reason === 'string' ? proposal.reason : '',
                source: 'ai',
                provenanceId
            });
            changes.push({ kind: 'resource', changeId: change.id, ...change });
        } catch (error) {
            console.warn('[Roleplay State] Ignored invalid resource change:', error.message);
        }
    }
    changes.push(...proposeConditionChanges({
        workspaceId,
        provenanceId,
        proposals: Array.isArray(resolved.conditionChanges) ? resolved.conditionChanges : [],
        allowedIds: new Set([...affectedIds, roleplaySettings.playerEntityId].filter(id => id && actorIds.has(id)))
    }));
    if (Object.keys(scenePatch).length) {
        try {
            // A patch is one moment: cast and destination apply together or not at all, with the reason reported.
            if (scene?.locationId && scenePatch.locationId && !reachableLocationIds.has(scenePatch.locationId)) {
                rejectedSceneChange = {
                    reason: 'unreachable-location',
                    locationId: scenePatch.locationId,
                    fromLocationId: scene.locationId
                };
                throw new Error(`Scene patch names a location outside the current region: ${scenePatch.locationId}.`);
            }
            // Going upstairs to a room the map lacks once landed the scene in an unrelated place nearby.
            // A move to somewhere neither inside nor around the current location has to be named this turn.
            if (scene?.locationId && scenePatch.locationId && scenePatch.locationId !== scene.locationId
                && !isNestedLocation(scene.locationId, scenePatch.locationId, locationLinks)
                && !mentionedEntityIds.has(scenePatch.locationId)) {
                rejectedSceneChange = {
                    reason: 'unnamed-destination',
                    locationId: scenePatch.locationId,
                    fromLocationId: scene.locationId
                };
                throw new Error(`Scene patch moves to a location the turn never names: ${scenePatch.locationId}.`);
            }
            const change = roleplay.proposeSceneChange({
                id: `${provenanceId}:scene`,
                workspaceId,
                patch: scenePatch,
                source: 'ai',
                provenanceId
            });
            changes.push({ kind: 'scene', changeId: change.id, ...change });
        } catch (error) {
            rejectedSceneChange ??= {
                reason: roleplaySettings.defaultUpdatePolicy === 'manual' ? 'manual-updates' : 'invalid-change',
                locationId: scenePatch.locationId ?? null,
                fromLocationId: scene?.locationId ?? null
            };
            console.warn('[Roleplay State] Ignored invalid scene change:', error.message);
        }
    }
    for (const [index, patch] of (Array.isArray(resolved.inventoryChanges) ? resolved.inventoryChanges : []).entries()) {
        try {
            const normalizedPatch = normalizeNarrativeInventoryPatch(
                patch,
                currentInventoryState,
                currentLocationInventoryState,
                {
                    userMessage,
                    narrativeResponse,
                    playerEntityId: roleplaySettings.playerEntityId
                }
            );
            const change = roleplay.proposeInventoryChange({
                id: `${provenanceId}:inventory:${index}`,
                workspaceId,
                patch: normalizedPatch,
                source: 'ai',
                provenanceId
            });
            changes.push({ kind: 'inventory', changeId: change.id, ...change });
        } catch (error) {
            invalidInventoryChanges.push({ index, reason: error.message });
            console.warn('[Roleplay State] Ignored invalid inventory change:', error.message);
        }
    }
    })();
    const appliedLocationId = roleplay.getScene(workspaceId)?.locationId;
    const endLocationId = (rejectedSceneChange ? null : routedResult.scenePatch?.locationId) || appliedLocationId;
    // Only a move that happened charges the clock; one awaiting approval may still be rejected.
    const travel = resolveTravelBounds({
        startLocationId: scene?.locationId,
        endLocationId: appliedLocationId,
        locationLinks,
        locationSizes,
        timeMatrix,
        timeAdvance: triage?.timeAdvance
    });
    const timeFrame = recordTimeFrame(triage?.timeAdvance, endLocationId, travel.floorMinutes, travel.ceilingMinutes);
    settleSceneMemory();
    for (const event of buildHeardContactEvents({
        workspaceId,
        triage,
        participantIds: roleplay.getScene(workspaceId)?.participantIds || [],
        playerEntityId: roleplaySettings.playerEntityId,
        actorIds,
        entityNames: new Map(allEntities.map(entity => [entity.id, entity.canonicalName]))
    })) {
        try {
            const result = narrativeState.createEvent({
                workspaceId,
                originId: provenanceId,
                sceneId: scene?.id,
                locationId: scene?.locationId,
                interpreterId: role.executor.model,
                event: normalizeNarrativeEvent(event),
                allowedEntityIds,
                updatePolicy: roleplaySettings.defaultUpdatePolicy
            });
            if (result.record) changes.push({ kind: 'narrative', eventId: result.record.proposal.changeSet.event.id, status: result.record.status, decision: result.decision, description: result.record.proposal.changeSet.event.description });
        } catch (error) {
            console.warn('[Narrative State] Ignored first-contact awareness:', error.message);
        }
    }
    if (timeFrame.advance) changes.push({ kind: 'time', frame: timeFrame });
    // What the story pass needs of this turn, settled now so it reads the scene as it was.
    const finalScene = roleplay.getScene(workspaceId);
    const sceneEnd = endedScene({ workspaceId, scene, finalScene, timeFrame, calendarService })
        || longSceneCheckpoint({ workspaceId, originId: provenanceId, scene: finalScene || scene });
    const storyNeeded = storyDomains.length > 0 || narrativeIntroductions.length > 0 || identityContactCandidates.length > 0;
    if (storyNeeded || sceneEnd) {
        narrativeState.queueStory(workspaceId, provenanceId, {
            ...(sceneEnd ? { maintenance: sceneEnd } : {}),
            domains: storyDomains,
            wide: Boolean(routing.requiresFullAnalysis),
            presentIds: triagePresentIds || [],
            aboutIds: triageAboutIds || [],
            entityIds: triageEntityIds,
            speakerIds,
            startScene: compactNarrativeScene(scene, roleplaySettings.playerEntityId),
            endScene: compactNarrativeScene(finalScene, roleplaySettings.playerEntityId),
            introductions: narrativeIntroductions.map(({ proposal, entityId }) => ({
                entityId,
                proposal: {
                    type: proposal.type,
                    name: proposal.name,
                    description: proposal.description,
                    excerpt: proposal.excerpt,
                    confidence: proposal.confidence,
                    scenePresence: proposal.scenePresence
                }
            })),
            identityContacts: identityContactCandidates,
            startClock
        });
    }
    const triageInputTokens = estimateTokens(triageSystemPrompt) + estimateTokens(triagePayload);
    const triageOutputTokens = triagePrimaryOutputTokens;
    const deepInputTokens = mechanicalDomains.length ? estimateTokens(narrativeStateSystemPrompt) + estimateTokens(payload) : 0;
    const deepOutputTokens = deepPrimaryOutputTokens;
    const elapsedMs = Date.now() - startedAt;
    narrativeState.finishJob(workspaceId, provenanceId, 'completed', { deepAnalysis: mechanicalDomains.length > 0, inputTokens: deepInputTokens, outputTokens: deepOutputTokens });
    narrativeState.recordMetric({ workspaceId, originId: provenanceId, triageInputTokens, triageOutputTokens, deepInputTokens, deepOutputTokens, deepAnalysis: mechanicalDomains.length > 0, proposalCount: changes.length, elapsedMs, recordedAt: Date.now() });
    return {
        changes,
        diagnostics: {
            status: invalidInventoryChanges.length || rejectedSceneChange ? 'completed-with-warnings' : 'completed',
            manifest: preTurnManifest ? {
                requestId: preTurnManifest.requestId,
                sequence: preTurnManifest.sequence
            } : null,
            triage,
            timeFrame,
            forceDeepAnalysis,
            routing,
            contextUsage: {
                triage: measureNarrativeContextSections(triagePayloadValue, triageSystemPrompt),
                ...(mechanicalDomains.length ? { analysis: measureNarrativeContextSections(payloadValue, narrativeStateSystemPrompt) } : {})
            },
            repairs: {
                triage: triageRepairCount,
                deep: deepRepairCount,
                structuredFallbacks: narrativeTelemetry.structuredFallbacks,
                structuredFallbackStages: narrativeTelemetry.structuredFallbackStages,
                structuredFallbackReasons: narrativeTelemetry.structuredFallbackReasons,
                structuredOutputMode: narrativeTelemetry.structuredOutputMode
            },
            analysis: {
                newEntities: routedResult.newEntities.length,
                identityUpdates: routedResult.identityUpdates.length,
                resourceChanges: routedResult.resourceChanges.length,
                inventoryChanges: routedResult.inventoryChanges.length,
                inventoryChangesApplied: changes.filter(change => change.kind === 'inventory').length,
                invalidInventoryChanges: invalidInventoryChanges.length,
                scenePatch: Boolean(routedResult.scenePatch && Object.keys(routedResult.scenePatch).length),
                rejectedScenePatch: rejectedSceneChange?.reason ?? null,
                sceneLocation: {
                    ...summarizeSceneLocation({
                        analyzed: shouldAnalyzeScene,
                        fromLocationId: scene?.locationId ?? null,
                        rejected: rejectedSceneChange,
                        change: changes.find(change => change.kind === 'scene' && change.patch?.locationId)
                    }),
                    ...(travel.category ? { travel } : {})
                }
            },
            story: storyNeeded || sceneEnd ? { status: 'queued', domains: storyDomains, ...(sceneEnd ? { sceneEnded: sceneEnd.reason } : {}) } : { status: 'not-needed', domains: [] },
            rejectedSceneChange,
            invalidInventoryChanges,
            proposals: changes.map(change => ({
                kind: change.kind,
                status: change.status || change.decision || 'processed',
                id: change.eventId || change.proposalId || change.entityId || change.changeId || change.id || null,
                description: change.description || null
            })),
            usage: {
                triageInput: triageInputTokens,
                triageOutput: triageOutputTokens,
                deepInput: deepInputTokens,
                deepOutput: deepOutputTokens,
                repairInput: repairInputTokens,
                repairOutput: repairOutputTokens,
                cache: narrativeTelemetry.cache
            },
            elapsedMs
        }
    };
}

/**
 * The story pass of one turn: what lasts from it, written to the story file. It runs after the
 * state pass and once the story moved past the turn, so a reply the player discards costs nothing.
 */
async function recordNarrativeStory({ workspaceId, originId, modelCalls = null }) {
    const { NarrativeStateSystem } = require('../../dist-main/main/features/narrative/narrative-state');
    const narrativeState = new NarrativeStateSystem(db);
    const job = narrativeState.getStory(workspaceId, originId);
    if (!job || job.status === 'completed' || job.status === 'skipped') return null;
    if (!narrativeState.isOriginActive(workspaceId, originId)) {
        narrativeState.finishStory(workspaceId, originId, 'skipped', { error: 'The reply no longer stands.' });
        return null;
    }
    const { ROLE_IDS, resolveAiEngineRole } = require('./features/ai-engine/role-resolver');
    const role = resolveAiEngineRole(ROLE_IDS.NARRATIVE_STORY);
    if (!role.executor) {
        narrativeState.finishStory(workspaceId, originId, 'skipped', { error: role.error || 'No model records the story.' });
        return { changes: [], diagnostics: { status: 'skipped', reason: role.error || 'No model records the story.' } };
    }
    const narrative = db.prepare("SELECT content, createdAt FROM messages WHERE id = ? AND chatId = ? AND role = 'ai'").get(originId, workspaceId);
    const user = narrative ? db.prepare(`
        SELECT content FROM messages
        WHERE chatId = ? AND role = 'user' AND createdAt <= ?
        ORDER BY createdAt DESC LIMIT 1
    `).get(workspaceId, narrative.createdAt) : null;
    if (!narrative || !user) {
        narrativeState.finishStory(workspaceId, originId, 'skipped', { error: 'The turn was not found.' });
        return null;
    }
    narrativeState.beginStory(workspaceId, originId);
    const startedAt = Date.now();
    const queued = job.handoff || {};
    // A scene that ended with nothing else to record still has what its people carry tidied.
    if (queued.maintenance && !(queued.domains || []).length && !(queued.introductions || []).length && !(queued.identityContacts || []).length) {
        const maintenance = await maintainEndedScene({ workspaceId, originId, maintenance: queued.maintenance, role, modelCalls });
        narrativeState.finishStory(workspaceId, originId, 'completed', { inputTokens: maintenance.usage.input, outputTokens: maintenance.usage.output });
        return { changes: [], diagnostics: { status: 'completed', domains: [], maintenance, usage: { input: maintenance.usage.input, output: maintenance.usage.output, repairInput: 0, repairOutput: 0 }, elapsedMs: Date.now() - startedAt } };
    }
    // The narrator's reasoning holds plans and guesses, not events, so the story reads only the narration.
    const narrativeResponse = stripReasoning(narrative.content);
    const userMessage = user.content;
    const handoff = job.handoff || {};
    const { RoleplaySystem } = require('../../dist-main/main/features/narrative/roleplay-system');
    const { EVENT_BUDGET_PER_TURN } = require('../../dist-main/main/features/narrative/narrative-quality');
    const { NarrativeContextManifestRepository } = require('../../dist-main/main/features/narrative/context-manifest');
    const { EventOccurrenceService } = require('../../dist-main/main/features/worldbuild/event-occurrences');
    const calendarService = require('./features/worldbuild/calendar-service');
    const roleplay = new RoleplaySystem(db);
    const eventOccurrences = new EventOccurrenceService(db, calendarService);
    const roleplaySettings = roleplay.getSettings(workspaceId);
    const scene = handoff.startScene || null;
    const endScene = handoff.endScene || scene;
    const startClock = handoff.startClock || null;
    const preTurnManifest = new NarrativeContextManifestRepository(db).getByOrigin(workspaceId, originId);
    const allEntities = db.prepare(`
        SELECT id, type, canonicalName, aliases, lore, data FROM entities
        WHERE workspaceId = ?
          AND (status != 'proposed' OR id IN (
            SELECT entity_id FROM roleplay_entity_changes
            WHERE workspace_id = entities.workspaceId AND status IN ('pending', 'conflicting') AND created_entity = 1
          ))
          AND type IN ('Characters', 'Creatures', 'Locations', 'Items', 'Factions', 'Events', 'Races')
        ORDER BY type, canonicalName COLLATE NOCASE
    `).all(workspaceId);
    const allowedEntityIds = new Set(allEntities.map(entity => entity.id));
    const actorIds = new Set(allEntities.filter(entity => entity.type === 'Characters' || entity.type === 'Creatures').map(entity => entity.id));
    const factionIds = new Set(allEntities.filter(entity => entity.type === 'Factions').map(entity => entity.id));
    const entityLabels = loadEntityLabels(workspaceId);
    const narrativeSignals = extractNarrativeSignals({ userMessage, narrativeResponse, entities: allEntities });
    const triage = {
        entityIds: handoff.entityIds || [],
        presentIds: handoff.presentIds || [],
        aboutIds: handoff.aboutIds || [],
        sceneMemory: (handoff.speakerIds || []).map(id => ({ heard: [{ fromId: id }] }))
    };
    const routing = { requiresFullAnalysis: Boolean(handoff.wide) };
    const shouldAnalyzeEpistemicState = true;
    const triageEntityIds = (Array.isArray(triage?.entityIds) ? triage.entityIds : [])
        .filter(id => allowedEntityIds.has(id));
    const triagePresentIds = Array.isArray(triage?.presentIds)
        ? triage.presentIds.filter(id => actorIds.has(id))
        : null;
    const witnessIds = new Set([
        roleplaySettings.playerEntityId,
        ...(scene?.participantIds || []),
        ...(scene?.possibleObserverIds || []),
        ...narrativeSignals.mentionedActorIds,
        ...triageEntityIds,
        ...(triagePresentIds || [])
    ].filter(id => actorIds.has(id)));
    const targetIds = new Set([
        scene?.locationId,
        ...narrativeSignals.mentionedEntityIds,
        ...triageEntityIds
    ].filter(id => allowedEntityIds.has(id)));
    if (shouldAnalyzeEpistemicState) {
        for (const id of witnessIds) targetIds.add(id);
    }
    // Taken before a full analysis widens the witnesses to everyone nearby, who did not perceive the turn.
    const perceiverIds = new Set(witnessIds);
    if (routing.requiresFullAnalysis) {
        for (const id of preTurnManifest?.subjectIds || []) witnessIds.add(id);
        for (const id of preTurnManifest?.targetIds || []) targetIds.add(id);
    }
    const affectedIds = new Set([...witnessIds, ...targetIds]);
    const scopedManifest = shouldAnalyzeEpistemicState
        ? compactNarrativeManifest(preTurnManifest, [...witnessIds], [...targetIds])
        : null;
    // Who could perceive the turn and what it is about. Holders bound the perspective records:
    // those present in full, those only mentioned around the focus. The focus also decides which
    // records come first when there are more than fit.
    const holders = resolveAnalysisHolders({
        candidateIds: [
            ...perceiverIds,
            ...[...narrativeSignals.mentionedEntityIds, ...triageEntityIds].filter(id => factionIds.has(id))
        ],
        sceneIds: [roleplaySettings.playerEntityId, ...(scene?.participantIds || []), ...(scene?.possibleObserverIds || [])],
        presentIds: triagePresentIds
    });
    const holderIds = new Set([...holders.present, ...holders.mentioned]);
    // What the turn concerns, by the triage. The player, the scene's participants and anyone who spoke
    // are read in full; the rest of the room, background actions included, only on these topics.
    const triageAboutIds = Array.isArray(triage?.aboutIds) ? triage.aboutIds.filter(id => allowedEntityIds.has(id)) : null;
    const speakerIds = (Array.isArray(triage?.sceneMemory) ? triage.sceneMemory : [])
        .flatMap(update => (update.heard || []).map(line => line.fromId))
        .filter(Boolean);
    const fullHolderIds = new Set([
        roleplaySettings.playerEntityId,
        ...(scene?.participantIds || []),
        ...speakerIds
    ].filter(Boolean));
    const topicIds = triageAboutIds ? new Set([
        ...triageAboutIds,
        ...fullHolderIds,
        scene?.locationId,
        ...narrativeSignals.mentionedEntityIds
    ].filter(Boolean)) : null;
    const focusIds = new Set([
        roleplaySettings.playerEntityId,
        ...(scene?.participantIds || []),
        ...(triagePresentIds || []),
        ...narrativeSignals.mentionedEntityIds,
        ...triageEntityIds
    ].filter(Boolean));
    const perspectiveSelection = shouldAnalyzeEpistemicState && holderIds.size + targetIds.size ? selectPerspectiveRecords(loadNarrativeRecords(workspaceId, ['knowledge', 'belief', 'memory', 'fact', 'state'])
        .filter(({ row }) => row.record_type === 'fact' || row.record_type === 'state' || holderIds.has(row.subject_id))
        .reverse()
        .map(({ row, payload, interpreter }) => ({ type: row.record_type, subjectId: row.subject_id || null, value: payload, interpreter })), {
        holderIds: holders.present,
        mentionedHolderIds: holders.mentioned,
        targetIds,
        focusIds,
        topicIds,
        fullHolderIds,
        withRefs: true
    }) : { records: [], candidates: 0, refs: new Map() };
    const currentPerspectiveState = perspectiveSelection.records;
    const knowledgeCardRows = shouldAnalyzeEpistemicState && perceiverIds.size && targetIds.size ? db.prepare(`
        SELECT cards.owner_id AS ownerId, cards.target_id AS targetId,
          cards.card_id AS cardId, cards.known_as AS knownAs,
          fields.field_key AS fieldKey
        FROM worldbuild_knowledge_cards cards
        LEFT JOIN worldbuild_known_fields fields
          ON fields.workspace_id = cards.workspace_id AND fields.card_id = cards.card_id
        WHERE cards.workspace_id = ? AND cards.status = 'active'
          AND cards.owner_id IN (${[...perceiverIds].map(() => '?').join(',')})
          AND cards.target_id IN (${[...targetIds].map(() => '?').join(',')})
        ORDER BY cards.owner_id, cards.target_id, fields.field_key
    `).all(workspaceId, ...perceiverIds, ...targetIds)
        .filter(row => holders.present.has(row.ownerId) || focusIds.has(row.targetId)) : [];
    const currentKnowledgeCards = groupKnowledgeCardRows(knowledgeCardRows);
    const currentRelationshipState = shouldAnalyzeEpistemicState
        ? loadNarrativeRelationshipState(workspaceId, holders, focusIds, roleplaySettings.playerEntityId)
        : { rows: [], candidates: 0 };
    const sceneEntityIds = new Set([
        roleplaySettings.playerEntityId,
        scene?.locationId,
        endScene?.locationId,
        ...(scene?.participantIds || []),
        ...(endScene?.participantIds || []),
        ...(scene?.possibleObserverIds || []),
        ...(endScene?.possibleObserverIds || [])
    ].filter(Boolean));
    const storyEntities = allEntities
        .filter(entity => routing.requiresFullAnalysis || affectedIds.has(entity.id) || sceneEntityIds.has(entity.id) || entity.type === 'Events')
        .map(entity => {
            const data = safeParseObject(entity.data) || {};
            return {
                id: entity.id,
                type: entity.type,
                canonicalName: entity.canonicalName,
                aliases: safeParseArray(entity.aliases),
                ...(entity.type === 'Events' ? {
                    eventNature: data.eventNature === 'recurring' ? 'recurring' : 'one-time',
                    kind: data.kind || '',
                    recurrence: data.recurrence || null
                } : {})
            };
        });
    const startParticipants = new Set(scene?.participantIds || []);
    const endParticipants = new Set(endScene?.participantIds || []);
    const storyDomains = Array.isArray(handoff.domains) && handoff.domains.length ? handoff.domains : ['awareness', 'relationship'];
    // What rarely changes comes first, so a provider that reuses a repeated prefix keeps more of it.
    const payloadValue = entityLabels.encodeValue({
        availableEntities: storyEntities,
        currentScene: compactNarrativeScene(endScene, roleplaySettings.playerEntityId),
        turnState: {
            domains: storyDomains,
            presentIds: handoff.presentIds || [],
            arrivedIds: [...endParticipants].filter(id => !startParticipants.has(id)),
            leftIds: [...startParticipants].filter(id => !endParticipants.has(id)),
            introducedIds: (handoff.introductions || []).map(introduction => introduction.entityId),
            startLocationId: scene?.locationId ?? null,
            endLocationId: endScene?.locationId ?? null
        },
        preTurnContext: scopedManifest || undefined,
        currentKnowledgeCards,
        currentPerspectiveState,
        currentRelationshipState: currentRelationshipState.rows,
        userMessage,
        narrativeResponse
    });
    const payload = JSON.stringify(payloadValue);
    const narrativeLanguageInstruction = getSystemLanguageInstruction();
    const systemPrompt = buildStoryRecordSystemPrompt(narrativeLanguageInstruction);
    const repairSystemPrompt = `${narrativeLanguageInstruction}\n${NARRATIVE_REPAIR_SYSTEM_PROMPT}`;
    const narrativePayloadTokens = workspacePayloadTokens(workspaceId);
    const narrativeTelemetry = {
        structuredFallbacks: 0,
        structuredFallbackStages: [],
        structuredFallbackReasons: [],
        structuredOutputMode: 'schema',
        cache: {},
        calls: modelCalls,
        labels: entityLabels
    };
    let repairCount = 0;
    let repairInputTokens = 0;
    let repairOutputTokens = 0;
    const storyOutputBudget = Math.min(8192, Math.max(2048, 1024 + (storyEntities.length * 48)));
    let response;
    try {
        response = await sendNarrativeJson({
            apiProfileId: role.executor.apiProfileId,
            model: role.executor.model,
            systemPrompt,
            chatHistory: [],
            newPrompt: payload,
            temperature: 0,
            maxTokens: storyOutputBudget,
            maxPayloadTokens: narrativePayloadTokens,
            manualMode: false,
            manualJson: null,
            cacheScope: `${workspaceId}::narrative-story`
        }, NARRATIVE_STORY_SCHEMA, 'Narrative State story', narrativeTelemetry);
    } catch (error) {
        narrativeState.finishStory(workspaceId, originId, 'failed', { error: error.message });
        throw error;
    }
    const primaryOutputTokens = estimateTokens(response);
    let parsed = safeParseObject(entityLabels.decode(response));
    if (!parsed) {
        repairCount += 1;
        repairInputTokens += estimateTokens(repairSystemPrompt)
            + estimateTokens(`INVALID RESPONSE:\n${String(response || '').slice(0, 16000)}`);
        response = await repairNarrativeJson({
            executor: role.executor,
            invalidResponse: response,
            schema: NARRATIVE_STORY_SCHEMA,
            label: 'Narrative State story',
            telemetry: narrativeTelemetry,
            maxPayloadTokens: narrativePayloadTokens,
            languageInstruction: narrativeLanguageInstruction
        });
        repairOutputTokens += estimateTokens(response);
        parsed = safeParseObject(entityLabels.decode(response));
    }
    if (!parsed) {
        narrativeState.finishStory(workspaceId, originId, 'failed', { error: 'The story pass returned invalid JSON.' });
        throw new Error('Narrative State returned invalid story JSON.');
    }
    // The reply may have been deleted or replaced while the model was answering.
    if (!narrativeState.isOriginActive(workspaceId, originId)) {
        narrativeState.finishStory(workspaceId, originId, 'skipped', { error: 'The reply no longer stands.' });
        return null;
    }
    const referenced = resolveRecordReferences(parsed.events, perspectiveSelection.refs);
    const events = referenced.events;
    const changes = [];
    const narrativeSkips = [];
    const excludedRelationshipSourceIds = new Set([roleplaySettings.playerEntityId].filter(Boolean));
    let generatedContactEventCount = 0;
    let narrativeProposalCount = 0;
    let overflowEventCount = 0;
    const narrativeRejections = [];
    const relationshipNotes = [];
    const storyChecks = { breaches: [], unsupported: [] };
    const narrativeIntroductions = handoff.introductions || [];
    const identityContactCandidates = handoff.identityContacts || [];
    const resolved = { events };
    db.transaction(() => {
    const resolvedEvents = ensureEncounterRelationshipOperations(
        workspaceId,
        resolved.events,
        roleplaySettings.playerEntityId
    );
    const finalParticipantIds = endScene?.participantIds ?? [];
    const initialContactEvents = buildNarrativeInitialContactEvents({
        workspaceId,
        playerEntityId: roleplaySettings.playerEntityId,
        participantIds: finalParticipantIds,
        introductions: narrativeIntroductions,
        identityContacts: identityContactCandidates,
        actorIds,
        relationshipPairs: collectRelationshipPairs(resolvedEvents),
        awarenessPairs: collectAwarenessPairs(resolvedEvents)
    });
    generatedContactEventCount = initialContactEvents.length;
    resolvedEvents.push(...initialContactEvents);
    // Dozens of durable events from one turn means a runaway response; the cut is reported.
    if (resolvedEvents.length > EVENT_BUDGET_PER_TURN) {
        overflowEventCount = resolvedEvents.length - EVENT_BUDGET_PER_TURN;
        resolvedEvents.length = EVENT_BUDGET_PER_TURN;
    }
    const eventBatches = chunkValues(resolvedEvents, 8);
    for (const batch of eventBatches) {
        for (const event of batch) {
            try {
                const normalizedEvent = normalizeNarrativeEvent(event);
                const result = narrativeState.createEvent({
                    workspaceId,
                    originId: originId,
                    sceneId: scene?.id,
                    locationId: scene?.locationId,
                    interpreterId: role.executor.model,
                    event: normalizedEvent,
                    allowedEntityIds,
                    updatePolicy: roleplaySettings.defaultUpdatePolicy,
                    excludedRelationshipSourceIds
                });
                if (result.record) {
                    narrativeProposalCount += 1;
                    if (normalizedEvent.worldbuildEventId) {
                        eventOccurrences.linkNarrative({ workspaceId, originId: originId, record: result.record, event: normalizedEvent, startDate: startClock });
                    }
                    changes.push({ kind: 'narrative', eventId: result.record.proposal.changeSet.event.id, status: result.record.status, decision: result.decision, description: result.record.proposal.changeSet.event.description });
                } else if (result.skipped) {
                    narrativeSkips.push({ description: event.description, reason: result.skipped });
                }
                for (const rejection of result.rejections || []) narrativeRejections.push(rejection);
                for (const note of result.relationshipNotes || []) relationshipNotes.push(note);
                storyChecks.breaches.push(...(result.storyChecks?.breaches || []));
                storyChecks.unsupported.push(...(result.storyChecks?.unsupported || []));
            } catch (error) {
                narrativeSkips.push({
                    description: event.description,
                    reason: 'invalid-event',
                    detail: error.message,
                    validationIssues: Array.isArray(error.issues) ? error.issues : []
                });
                console.warn('[Narrative State] Ignored invalid event:', error.message);
            }
        }
    }
    })();
    const maintenance = handoff.maintenance
        ? await maintainEndedScene({ workspaceId, originId, maintenance: handoff.maintenance, role, modelCalls })
        : null;
    const inputTokens = estimateTokens(systemPrompt) + estimateTokens(payload) + (maintenance?.usage.input || 0);
    const outputTokens = primaryOutputTokens + (maintenance?.usage.output || 0);
    const elapsedMs = Date.now() - startedAt;
    narrativeState.finishStory(workspaceId, originId, 'completed', { inputTokens, outputTokens });
    return {
        changes,
        diagnostics: {
            status: narrativeSkips.length ? 'completed-with-warnings' : 'completed',
            domains: storyDomains,
            contextUsage: {
                story: measureNarrativeContextSections(payloadValue, systemPrompt),
                analysisScope: {
                    holders: { present: holders.present.size, mentioned: holders.mentioned.size, readInFull: topicIds ? [...holders.present].filter(id => fullHolderIds.has(id)).length : holders.present.size },
                    topics: topicIds ? topicIds.size : null,
                    perspectiveRecords: { sent: currentPerspectiveState.length, candidates: perspectiveSelection.candidates, ...(perspectiveSelection.reserved ? { reserved: perspectiveSelection.reserved } : {}) },
                    relationships: { sent: currentRelationshipState.rows.length, candidates: currentRelationshipState.candidates }
                }
            },
            repairs: {
                story: repairCount,
                structuredFallbacks: narrativeTelemetry.structuredFallbacks,
                structuredFallbackStages: narrativeTelemetry.structuredFallbackStages,
                structuredFallbackReasons: narrativeTelemetry.structuredFallbackReasons,
                structuredOutputMode: narrativeTelemetry.structuredOutputMode
            },
            analysis: {
                events: events.length + generatedContactEventCount,
                rawEvents: events.length,
                persistedEvents: narrativeProposalCount,
                skippedEvents: narrativeSkips.length,
                skippedEventReasons: [...new Set(narrativeSkips.map(skip => skip.reason))],
                generatedContactEvents: generatedContactEventCount,
                overflowEvents: overflowEventCount,
                filteredOperations: narrativeRejections.length,
                filteredOperationReasons: summarizeNarrativeRejections(narrativeRejections),
                revisedRecords: countOperations(events, operation => Boolean(operation.supersedesId || operation.supersedesMemoryId)),
                endedRecords: countOperations(events, operation => operation.type === 'end'),
                unresolvedRefs: referenced.unresolved.length
            },
            ...(referenced.unresolved.length ? { unresolvedRefs: referenced.unresolved } : {}),
            ...(maintenance ? { maintenance } : {}),
            skippedNarrativeEvents: narrativeSkips,
            ...(relationshipNotes.length ? { relationshipChanges: relationshipNotes } : {}),
            ...(storyChecks.breaches.length || storyChecks.unsupported.length ? { storyChecks } : {}),
            proposals: changes.map(change => ({
                kind: change.kind,
                status: change.status || change.decision || 'processed',
                id: change.eventId || null,
                description: change.description || null
            })),
            usage: {
                input: inputTokens,
                output: outputTokens,
                repairInput: repairInputTokens,
                repairOutput: repairOutputTokens,
                cache: narrativeTelemetry.cache
            },
            elapsedMs
        }
    };
}

// A jump of the clock this long ends a scene as surely as leaving the place does.
const SCENE_END_MINUTES = 6 * 60;

/** The scene this turn closed, by a change of place or a long jump of the clock, and who was in it. */
function endedScene({ workspaceId, scene, finalScene, timeFrame, calendarService }) {
    if (!scene) return null;
    const moved = Boolean(scene.locationId && finalScene?.locationId && scene.locationId !== finalScene.locationId);
    let minutes = 0;
    if (timeFrame?.advance?.duration) {
        try {
            minutes = calendarService.durationTotalMinutes(calendarService.getCalendar(db, workspaceId), timeFrame.advance.duration);
        } catch {
            minutes = 0;
        }
    }
    if (!moved && minutes < SCENE_END_MINUTES) return null;
    const holderIds = [...new Set([...(scene.participantIds || []), ...(scene.possibleObserverIds || [])].filter(Boolean))];
    return holderIds.length ? { reason: moved ? 'moved' : 'time-skip', minutes, locationId: scene.locationId || null, holderIds } : null;
}

const SCENE_MAINTENANCE_SCHEMA = {
    type: 'object',
    additionalProperties: false,
    required: ['operations'],
    properties: {
        operations: {
            type: 'array',
            items: {
                type: 'object',
                additionalProperties: false,
                required: ['type'],
                properties: {
                    type: { type: 'string', enum: ['end', 'merge'] },
                    ref: { type: 'string' },
                    refs: { type: 'array', items: { type: 'string' } },
                    how: { type: 'string', enum: ['settled'] },
                    reason: { type: 'string' },
                    summary: { type: 'string' }
                }
            }
        }
    }
};

const SCENE_MAINTENANCE_PROMPT = `You tidy what characters carry after a scene ended. Never write narrative prose. records lists the current knowledge, beliefs and memories of the characters who were in the scene; each has a ref, and names maps ids to names. Return JSON only: {"operations":[]}. Use only these operations:
{"type":"end","ref":"#1","how":"settled","reason":"a few words"} for a record of category intent (a plan, promise, condition, refusal, demand or open question) that the other records show was carried out, met, answered, dropped or overtaken. Leave one that may still be pending.
{"type":"merge","refs":["#1","#2"],"summary":"one account"} for memories of one holder that tell the same experience. The summary keeps every detail that matters, in that holder's perspective and in the language of the records.
Never end or merge on a guess. When nothing needs tidying, answer {"operations":[]}.`;

/**
 * What a scene's people left unused slips out of reach by rule, then one model call settles overtaken
 * intents and joins repeated memories. The player character is left as the user keeps them.
 */
// The end of a scene: what its people carry is tidied, and what they went through is weighed for growth.
// A long scene that never ended is only weighed, at its checkpoint.
async function maintainEndedScene({ workspaceId, originId, maintenance, role, modelCalls = null }) {
    const result = maintenance.growthOnly
        ? { reason: maintenance.reason, faded: [], settled: 0, merged: 0, unresolved: 0, usage: { input: 0, output: 0 } }
        : await tidyEndedScene({ workspaceId, originId, maintenance, role, modelCalls });
    try {
        const growth = await settleSceneGrowth({ workspaceId, originId, reason: maintenance.reason, holderIds: maintenance.holderIds || [], role, modelCalls });
        if (growth) {
            result.growth = { turns: growth.turns, proposals: growth.proposals };
            result.usage.input += growth.usage.input;
            result.usage.output += growth.usage.output;
        }
    } catch (error) {
        console.warn('[Narrative State] Could not weigh the scene for growth:', error.message);
    }
    return result;
}

async function tidyEndedScene({ workspaceId, originId, maintenance, role, modelCalls = null }) {
    const result = { reason: maintenance.reason, faded: [], settled: 0, merged: 0, unresolved: 0, usage: { input: 0, output: 0 } };
    const { RoleplaySystem } = require('../../dist-main/main/features/narrative/roleplay-system');
    const settings = new RoleplaySystem(db).getSettings(workspaceId);
    const holderIds = (maintenance.holderIds || []).filter(id => id && id !== settings.playerEntityId);
    if (!holderIds.length) return result;
    try {
        const { fadeIdleRecords } = require('../../dist-main/main/features/narrative/umwelt/story-maintenance');
        const { storyMinuteFor } = require('../../dist-main/main/features/narrative/umwelt/story-clock');
        result.faded = fadeIdleRecords(db, workspaceId, { originId, holderIds, nowMinute: storyMinuteFor(db, workspaceId) });
    } catch (error) {
        console.warn('[Narrative State] Could not let unused memories fade:', error.message);
    }
    if (!role?.executor) return result;
    const holders = new Set(holderIds);
    const selection = selectPerspectiveRecords(loadNarrativeRecords(workspaceId, ['knowledge', 'belief', 'memory'], holderIds)
        .reverse()
        .map(({ row, payload, interpreter }) => ({ type: row.record_type, subjectId: row.subject_id || null, value: payload, interpreter })), {
        holderIds,
        targetIds: [],
        focusIds: [...holderIds, maintenance.locationId].filter(Boolean),
        fullHolderIds: holderIds,
        limit: 80,
        withRefs: true
    });
    const memoriesBy = new Map();
    for (const record of selection.records) if (record.type === 'memory') memoriesBy.set(record.subjectId, (memoriesBy.get(record.subjectId) || 0) + 1);
    const worthAsking = selection.records.some(record => record.category === 'intent') || [...memoriesBy.values()].some(count => count > 1);
    if (!worthAsking) return result;
    const ids = [...new Set(selection.records.flatMap(record => [record.subjectId, record.proposition?.subjectId].filter(Boolean)))];
    const names = ids.length ? Object.fromEntries(db.prepare(`SELECT id, canonicalName FROM entities WHERE workspaceId = ? AND id IN (${ids.map(() => '?').join(', ')})`)
        .all(workspaceId, ...ids).map(row => [row.id, row.canonicalName])) : {};
    const systemPrompt = `${getSystemLanguageInstruction()}\n${SCENE_MAINTENANCE_PROMPT}`;
    const prompt = JSON.stringify({ sceneEnded: maintenance.reason, names, records: selection.records });
    result.usage.input = estimateTokens(systemPrompt) + estimateTokens(prompt);
    let parsed = null;
    try {
        const response = await sendNarrativeJson({
            apiProfileId: role.executor.apiProfileId,
            model: role.executor.model,
            systemPrompt,
            chatHistory: [],
            newPrompt: prompt,
            temperature: 0,
            maxTokens: 2048,
            maxPayloadTokens: workspacePayloadTokens(workspaceId),
            manualMode: false,
            manualJson: null,
            cacheScope: `${workspaceId}::scene-maintenance`
        }, SCENE_MAINTENANCE_SCHEMA, 'Scene maintenance', { structuredFallbacks: 0, structuredFallbackStages: [], structuredFallbackReasons: [], structuredOutputMode: 'schema', cache: {}, calls: modelCalls });
        result.usage.output = estimateTokens(response);
        parsed = safeParseObject(response);
    } catch (error) {
        console.warn('[Narrative State] Scene maintenance failed:', error.message);
        return result;
    }
    const asked = (Array.isArray(parsed?.operations) ? parsed.operations : []).filter(operation => operation?.type === 'merge' || (operation?.type === 'end' && operation.how === 'settled'));
    if (!asked.length) return result;
    const referenced = resolveRecordReferences([{ operations: asked }], selection.refs);
    result.unresolved = referenced.unresolved.length;
    // Only what was asked of the holders of the scene, whatever a ref resolved to.
    const operations = (referenced.events[0]?.operations || []).filter(operation => holders.has(operation.subjectId));
    if (!operations.length) return result;
    try {
        const { NarrativeStateSystem } = require('../../dist-main/main/features/narrative/narrative-state');
        const outcome = new NarrativeStateSystem(db).createEvent({
            workspaceId,
            originId,
            locationId: maintenance.locationId || undefined,
            interpreterId: role.executor.model,
            event: {
                type: 'maintenance',
                description: 'After the scene ended, what its people carry was tidied.',
                excerpt: 'Scene ended.',
                participantIds: holderIds,
                confidence: 1,
                operations
            },
            allowedEntityIds: new Set(db.prepare("SELECT id FROM entities WHERE workspaceId = ? AND status != 'proposed'").all(workspaceId).map(row => row.id)),
            updatePolicy: settings.defaultUpdatePolicy
        });
        if (outcome.record) {
            result.settled = operations.filter(operation => operation.type === 'end').length;
            result.merged = operations.filter(operation => operation.type === 'memory').length;
            result.status = outcome.record.status;
        }
    } catch (error) {
        console.warn('[Narrative State] Could not record the scene maintenance:', error.message);
    }
    return result;
}

// Scene text the growth judge reads: the newest turns whole, older ones cut short past the budget.
const GROWTH_SCENE_CHARS = 48000;
const GROWTH_OLD_TURN_CHARS = 500;

const NARRATIVE_GROWTH_PROMPT = `You are Kallamo's growth judge. A scene of a Roleplay has ended. Never write narrative prose. sceneTurns hold the scene, oldest first: what the player did (userMessage) and what happened (reply); older turns may be cut short. Weigh what each person in progression.characters and skills.characters went through in the scene as a whole. A project finished across many turns, a hard fight, a feat above their level, a discovery, or a real social or political advance counts by what the whole scene cost them, even when no single turn finished anything. spentInScene lists the resources each one spent during the scene, which shows the effort. alreadyGiven lists growth already recorded during this scene: never give it again. Return JSON only with {"changes":[]}. Each reason names what in the scene earned it, in a short phrase. A scene that taught nothing returns no changes, and that is a correct answer.`;

/** Who may grow in a scene, and what the judge needs to know about them. */
function loadGrowthContext(workspaceId, holderIds) {
    const { RoleplayProgression } = require('../../dist-main/main/features/narrative/roleplay-progression');
    const { RoleplaySkills } = require('../../dist-main/main/features/narrative/roleplay-skills');
    const { RoleplaySystem } = require('../../dist-main/main/features/narrative/roleplay-system');
    const progression = new RoleplayProgression(db);
    const skillSystem = new RoleplaySkills(db);
    const people = new Set([new RoleplaySystem(db).getSettings(workspaceId).playerEntityId, ...holderIds].filter(Boolean));
    const narrow = context => {
        if (!context) return null;
        const ids = context.ids.filter(id => people.has(id));
        return ids.length ? { ...context, ids } : null;
    };
    return {
        progression,
        skillSystem,
        progressionContext: narrow(loadNarrativeProgressionContext(progression, workspaceId)),
        skillsContext: narrow(loadNarrativeSkillsContext(skillSystem, workspaceId))
    };
}

/**
 * Experience, attributes and skills for a whole scene, once, by the reply that closed it. Each
 * change goes through its system's policy, so a world on review sees every one before it counts.
 */
async function settleSceneGrowth({ workspaceId, originId, reason, holderIds = [], role, modelCalls = null }) {
    const { SceneGrowthLedger } = require('../../dist-main/main/features/narrative/scene-growth');
    const { NARRATIVE_GROWTH_SCHEMA } = require('../../dist-main/main/features/narrative/narrative-state-schema');
    const ledger = new SceneGrowthLedger(db);
    if (ledger.isSettled(workspaceId, originId)) return null;
    const { progression, skillSystem, progressionContext, skillsContext } = loadGrowthContext(workspaceId, holderIds);
    const turns = ledger.sceneTurns(workspaceId, originId);
    if (!turns.length) return null;
    if (!progressionContext && !skillsContext) {
        ledger.record(workspaceId, originId, { reason, turnCount: turns.length, proposalCount: 0 });
        return { turns: turns.length, proposals: 0, usage: { input: 0, output: 0 } };
    }
    const growingIds = [...new Set([...(progressionContext?.ids || []), ...(skillsContext?.ids || [])])];
    const sceneStart = turns[0].createdAt;
    const originIds = turns.map(turn => turn.originId);
    const marks = originIds.map(() => '?').join(', ');
    const idMarks = growingIds.map(() => '?').join(', ');
    const spent = db.prepare(`
        SELECT changes.entity_id AS entityId, definitions.name AS resource, SUM(changes.delta) AS total
        FROM roleplay_resource_changes AS changes
        JOIN roleplay_resource_definitions AS definitions
          ON definitions.workspace_id = changes.workspace_id AND definitions.definition_id = changes.definition_id
        WHERE changes.workspace_id = ? AND changes.source = 'ai' AND changes.status != 'rejected' AND changes.delta < 0
          AND changes.provenance_id IN (${marks}) AND changes.entity_id IN (${idMarks})
        GROUP BY changes.entity_id, definitions.name
    `).all(workspaceId, ...originIds, ...growingIds).map(row => ({ entityId: row.entityId, resource: row.resource, spent: -Number(row.total) }));
    const alreadyGiven = [
        ...db.prepare(`
            SELECT entity_id AS entityId, kind, delta, reason FROM roleplay_progress_changes
            WHERE workspace_id = ? AND status != 'rejected' AND created_at >= ? AND entity_id IN (${idMarks})
        `).all(workspaceId, sceneStart, ...growingIds),
        ...db.prepare(`
            SELECT changes.entity_id AS entityId, changes.kind AS kind, skills.name AS skill, changes.reason AS reason
            FROM roleplay_skill_changes AS changes
            LEFT JOIN roleplay_skills AS skills ON skills.workspace_id = changes.workspace_id AND skills.skill_id = changes.skill_id
            WHERE changes.workspace_id = ? AND changes.status != 'rejected' AND changes.created_at >= ? AND changes.entity_id IN (${idMarks})
        `).all(workspaceId, sceneStart, ...growingIds)
    ];
    let budget = GROWTH_SCENE_CHARS;
    const sceneTurns = [...turns].reverse().map(turn => {
        const entry = { userMessage: String(turn.userMessage || ''), reply: stripReasoning(turn.reply) };
        const size = entry.userMessage.length + entry.reply.length;
        if (size <= budget) {
            budget -= size;
            return entry;
        }
        return {
            userMessage: entry.userMessage.slice(0, Math.floor(GROWTH_OLD_TURN_CHARS / 2)),
            reply: entry.reply.slice(0, GROWTH_OLD_TURN_CHARS)
        };
    }).reverse();
    const entityLabels = loadEntityLabels(workspaceId);
    const payloadValue = entityLabels.encodeValue({
        sceneEnded: reason,
        progression: progressionContext ? describeNarrativeProgression(progression, workspaceId, progressionContext) : undefined,
        skills: skillsContext ? describeNarrativeSkills(skillSystem, workspaceId, skillsContext) : undefined,
        spentInScene: spent.length ? spent : undefined,
        alreadyGiven: alreadyGiven.length ? alreadyGiven : undefined,
        sceneTurns
    });
    const systemPrompt = [
        getSystemLanguageInstruction(),
        NARRATIVE_GROWTH_PROMPT,
        progressionContext ? NARRATIVE_PROGRESSION_PROMPT : null,
        skillsContext ? NARRATIVE_SKILLS_PROMPT : null
    ].filter(Boolean).join('\n\n');
    const payload = JSON.stringify(payloadValue);
    const response = await sendNarrativeJson({
        apiProfileId: role.executor.apiProfileId,
        model: role.executor.model,
        systemPrompt,
        chatHistory: [],
        newPrompt: payload,
        temperature: 0,
        maxTokens: 2048,
        maxPayloadTokens: workspacePayloadTokens(workspaceId),
        manualMode: false,
        manualJson: null,
        cacheScope: `${workspaceId}::scene-growth`
    }, NARRATIVE_GROWTH_SCHEMA, 'Scene growth', { structuredFallbacks: 0, structuredFallbackStages: [], structuredFallbackReasons: [], structuredOutputMode: 'schema', cache: {}, calls: modelCalls, labels: entityLabels });
    const parsed = safeParseObject(entityLabels.decode(response));
    const proposals = (Array.isArray(parsed?.changes) ? parsed.changes : [])
        .filter(proposal => growingIds.includes(proposal?.entityId));
    const changes = proposeGrowthChanges({
        workspaceId, provenanceId: originId, proposals, progression, skillSystem, progressionContext, skillsContext
    });
    ledger.record(workspaceId, originId, { reason, turnCount: turns.length, proposalCount: changes.length });
    return {
        turns: turns.length,
        proposals: changes.length,
        usage: { input: estimateTokens(systemPrompt) + estimateTokens(payload), output: estimateTokens(response) }
    };
}

// Experience and attributes for who progresses, skills for who learns; anything else is dropped.
function proposeGrowthChanges({ workspaceId, provenanceId, proposals, progression, skillSystem, progressionContext, skillsContext }) {
    const changes = [];
    for (const [index, proposal] of proposals.entries()) {
        if (typeof proposal?.entityId !== 'string') continue;
        if (proposal.skill) {
            if (!skillsContext?.ids.includes(proposal.entityId) || !['assign', 'rank', 'create'].includes(proposal.skill)) continue;
            try {
                const change = skillSystem.proposeChange({
                    id: `${provenanceId}:growth:skill:${index}`,
                    workspaceId,
                    entityId: proposal.entityId,
                    kind: proposal.skill,
                    skillKey: typeof (proposal.name ?? proposal.key) === 'string' && proposal.skill !== 'create' ? (proposal.name ?? proposal.key) : undefined,
                    rank: proposal.rank,
                    direction: Number(proposal.change),
                    name: typeof proposal.name === 'string' ? proposal.name : undefined,
                    description: typeof proposal.description === 'string' ? proposal.description : undefined,
                    parentKey: typeof (proposal.parent ?? proposal.parentKey) === 'string' ? (proposal.parent ?? proposal.parentKey) : undefined,
                    reason: typeof proposal.reason === 'string' ? proposal.reason : '',
                    source: 'ai',
                    provenanceId
                });
                if (change) changes.push({ kind: 'skill', changeId: change.id, ...change });
            } catch (error) {
                console.warn('[Scene growth] Ignored invalid skill change:', error.message);
            }
            continue;
        }
        if (!proposal.progress || !progressionContext?.ids.includes(proposal.entityId)) continue;
        const trait = findByReference(progressionContext.traits, proposal.attribute ?? proposal.key);
        if (proposal.progress !== 'xp' && (proposal.progress !== 'attribute' || !trait)) continue;
        try {
            const change = progression.proposeChange({
                id: `${provenanceId}:growth:progress:${index}`,
                workspaceId,
                entityId: proposal.entityId,
                kind: proposal.progress === 'attribute' ? 'attribute' : 'xp',
                traitId: trait?.id ?? null,
                delta: Number(proposal.change),
                reason: typeof proposal.reason === 'string' ? proposal.reason : '',
                source: 'ai',
                provenanceId
            });
            if (change) changes.push({ kind: 'progress', changeId: change.id, ...change });
        } catch (error) {
            console.warn('[Scene growth] Ignored invalid progression change:', error.message);
        }
    }
    return changes;
}

/**
 * The user closes the scene: it ends at the latest reply, what its people carry is tidied and what
 * they went through is weighed, as when the story moves on by itself.
 */
async function closeRoleplayScene(workspaceId) {
    const { SceneGrowthLedger } = require('../../dist-main/main/features/narrative/scene-growth');
    const { RoleplaySystem } = require('../../dist-main/main/features/narrative/roleplay-system');
    const ledger = new SceneGrowthLedger(db);
    const originId = ledger.latestReplyId(workspaceId);
    if (!originId) return { success: false, error: 'There is no reply to close the scene on.' };
    if (ledger.isSettled(workspaceId, originId)) return { success: true, alreadyClosed: true };
    const role = resolveAiEngineRole(ROLE_IDS.NARRATIVE_STORY);
    if (!role.executor) return { success: false, error: role.error || 'No model records the story.' };
    const scene = new RoleplaySystem(db).getScene(workspaceId);
    const holderIds = [...new Set([...(scene?.participantIds || []), ...(scene?.possibleObserverIds || [])].filter(Boolean))];
    const result = await maintainEndedScene({
        workspaceId,
        originId,
        maintenance: { reason: 'closed-by-hand', minutes: 0, locationId: scene?.locationId || null, holderIds },
        role
    });
    return { success: true, turns: result.growth?.turns ?? 0, proposals: result.growth?.proposals ?? 0 };
}

/** A scene that never moves nor skips time is still weighed once it runs this long. */
function longSceneCheckpoint({ workspaceId, originId, scene }) {
    try {
        const { SceneGrowthLedger, LONG_SCENE_TURNS } = require('../../dist-main/main/features/narrative/scene-growth');
        if (new SceneGrowthLedger(db).turnsSinceSettled(workspaceId, originId) < LONG_SCENE_TURNS) return null;
        const holderIds = [...new Set([...(scene?.participantIds || []), ...(scene?.possibleObserverIds || [])].filter(Boolean))];
        return { reason: 'long-scene', growthOnly: true, minutes: 0, locationId: scene?.locationId || null, holderIds };
    } catch (error) {
        console.warn('[Scene growth] Could not count the scene:', error.message);
        return null;
    }
}

function countOperations(events, matches) {
    return events.reduce((total, event) => total + event.operations.filter(matches).length, 0);
}

function narrativeEntitySystem() {
    const { NarrativeEntitySystem } = require('../../dist-main/main/features/narrative/narrative-entities');
    return new NarrativeEntitySystem(db);
}

function isRoleplayWorkspace(workspaceId) {
    try {
        const { getWorkspaceExperienceMode } = require('../../dist-main/main/features/narrative/mode-orchestration');
        return getWorkspaceExperienceMode(db, workspaceId) === 'roleplay';
    } catch (error) {
        console.warn('[Narrative State] Could not read the workspace mode:', error.message);
        return false;
    }
}

// Runs before the next reply is generated, so it reads the state of the reply the user kept.
async function analyzePendingNarrativeTurn({ chatId, excludedIds, webContents, currentRun, totalSteps }) {
    const pending = findPendingNarrativeTurn(db, chatId, excludedIds);
    if (!pending || !resolveAiEngineRole(ROLE_IDS.NARRATIVE_STATE).executor) return;
    sendRunEvent(webContents, 'workflow-progress', currentRun, {
        step: 1,
        totalSteps,
        profileName: 'Narrative State',
        status: 'Updating Narrative State…',
        phase: 'narrative-state'
    });
    try {
        await reprocessNarrativeStateTurn(chatId, pending.originId);
    } catch (error) {
        console.error('[Narrative State] Could not analyze the kept reply:', error);
    }
}

/** The current records of a workspace's story, as the narrative projection gives them. */
function loadNarrativeRecords(workspaceId, recordTypes, subjectIds) {
    const { loadCurrentNarrativeRecords } = require('../../dist-main/main/features/narrative/narrative-record-projection');
    return loadCurrentNarrativeRecords(db, { workspaceId, recordTypes, ...(subjectIds ? { subjectIds } : {}) });
}

function deferNarrativeStateTurn(workspaceId, originId) {
    const current = db.prepare("SELECT debugNotice FROM messages WHERE id = ? AND chatId = ? AND role = 'ai'").get(originId, workspaceId);
    if (!current) throw new Error('Narrative response was not found for this turn.');
    const updated = mergeNarrativeStateDiagnostics(safeParseObject(current.debugNotice) || {}, deferredNarrativeState());
    const debugNotice = JSON.stringify(updated);
    db.prepare('UPDATE messages SET debugNotice = ? WHERE id = ? AND chatId = ?').run(debugNotice, originId, workspaceId);
    return debugNotice;
}

async function reprocessNarrativeStateTurn(workspaceId, originId) {
    const narrative = db.prepare("SELECT content, createdAt FROM messages WHERE id = ? AND chatId = ? AND role = 'ai'")
        .get(originId, workspaceId);
    if (!narrative) throw new Error('Narrative response was not found for this turn.');
    const user = db.prepare(`
        SELECT content FROM messages
        WHERE chatId = ? AND role = 'user' AND createdAt <= ?
        ORDER BY createdAt DESC LIMIT 1
    `).get(workspaceId, narrative.createdAt);
    if (!user) throw new Error('User message was not found for this turn.');
    const modelCalls = readAdvancedSettings().narrativeStateDebug ? [] : null;
    const result = await updateRoleplayStateWithSystemAi({
        workspaceId,
        provenanceId: originId,
        userMessage: user.content,
        narrativeResponse: narrative.content,
        modelCalls
    });
    if (result.diagnostics) {
        const current = db.prepare('SELECT debugNotice FROM messages WHERE id = ? AND chatId = ?')
            .get(originId, workspaceId);
        const parsed = safeParseObject(current?.debugNotice) || {};
        const updated = mergeNarrativeStateDiagnostics(parsed, result.diagnostics, modelCalls);
        db.prepare('UPDATE messages SET debugNotice = ? WHERE id = ? AND chatId = ?')
            .run(JSON.stringify(updated), originId, workspaceId);
    }
    // Asked for by hand, so the story pass of this turn runs now instead of waiting for the next one.
    const story = await recordAndSaveNarrativeStory(workspaceId, originId);
    return [...result.changes, ...(story?.changes || [])];
}

// One story pass at a time per chat, oldest turn first, so the story is written in the order it happened.
const narrativeStoryRuns = new Map();

function runQueuedNarrativeStories(chatId) {
    const previous = narrativeStoryRuns.get(chatId) || Promise.resolve();
    const run = previous.then(async () => {
        const { NarrativeStateSystem } = require('../../dist-main/main/features/narrative/narrative-state');
        const tried = [];
        for (;;) {
            const next = new NarrativeStateSystem(db).nextQueuedStory(chatId, tried);
            if (!next) break;
            tried.push(next.originId);
            try {
                await recordAndSaveNarrativeStory(chatId, next.originId);
            } catch (error) {
                console.error('[Narrative State] Could not record the story of a turn:', error);
            }
        }
    }).finally(() => {
        // A reply deleted while its story was being recorded leaves writes behind; clear them at once.
        try {
            purgeDeadTurns(db, chatId);
        } catch (error) {
            console.error('[Narrative State] Could not clean up dead turns:', error);
        }
        if (narrativeStoryRuns.get(chatId) === run) narrativeStoryRuns.delete(chatId);
    });
    narrativeStoryRuns.set(chatId, run);
    return run;
}

/** Runs the story pass of one turn and adds what it did to that reply's diagnostics. */
async function recordAndSaveNarrativeStory(workspaceId, originId) {
    const modelCalls = readAdvancedSettings().narrativeStateDebug ? [] : null;
    let result;
    try {
        result = await recordNarrativeStory({ workspaceId, originId, modelCalls });
    } catch (error) {
        saveNarrativeStoryFailure(workspaceId, originId, error, modelCalls);
        throw error;
    }
    if (!result) return null;
    fillStoryVectors(workspaceId);
    const current = db.prepare('SELECT debugNotice FROM messages WHERE id = ? AND chatId = ?').get(originId, workspaceId);
    if (!current) return result;
    const parsed = safeParseObject(current.debugNotice) || {};
    const state = parsed.narrativeState && typeof parsed.narrativeState === 'object' ? parsed.narrativeState : {};
    const story = result.diagnostics || {};
    const usage = {
        ...(state.usage || {}),
        storyInput: story.usage?.input || 0,
        storyOutput: story.usage?.output || 0,
        repairInput: (state.usage?.repairInput || 0) + (story.usage?.repairInput || 0),
        repairOutput: (state.usage?.repairOutput || 0) + (story.usage?.repairOutput || 0)
    };
    // The story pass fills the fields the diagnostics already show for recorded events.
    const merged = {
        ...state,
        story,
        analysis: { ...(state.analysis || {}), ...(story.analysis || {}) },
        skippedNarrativeEvents: story.skippedNarrativeEvents || [],
        ...(story.relationshipChanges ? { relationshipChanges: story.relationshipChanges } : {}),
        ...(story.storyChecks ? { storyChecks: story.storyChecks } : {}),
        proposals: [...(state.proposals || []), ...(story.proposals || [])],
        usage
    };
    const calls = [...(parsed.narrativeCalls || []), ...(modelCalls || [])];
    const updated = mergeNarrativeStateDiagnostics(parsed, merged, calls.length ? calls : null);
    db.prepare('UPDATE messages SET debugNotice = ? WHERE id = ? AND chatId = ?').run(JSON.stringify(updated), originId, workspaceId);
    return result;
}

// A failed story pass is shown on its reply with the reason, and whether a later turn tries it again.
function saveNarrativeStoryFailure(workspaceId, originId, error, modelCalls) {
    const { NarrativeStateSystem, STORY_PASS_MAX_ATTEMPTS } = require('../../dist-main/main/features/narrative/narrative-state');
    const narrativeState = new NarrativeStateSystem(db);
    const message = error?.message || String(error);
    let job = narrativeState.getStory(workspaceId, originId);
    if (job?.status === 'processing') {
        narrativeState.finishStory(workspaceId, originId, 'failed', { error: message });
        job = narrativeState.getStory(workspaceId, originId);
    }
    const current = db.prepare('SELECT debugNotice FROM messages WHERE id = ? AND chatId = ?').get(originId, workspaceId);
    if (!current) return;
    const parsed = safeParseObject(current.debugNotice) || {};
    const state = parsed.narrativeState && typeof parsed.narrativeState === 'object' ? parsed.narrativeState : {};
    const story = {
        ...(state.story || {}),
        status: 'failed',
        error: job?.error || message,
        attempts: job?.attempts || 0,
        willRetry: (job?.attempts || 0) < STORY_PASS_MAX_ATTEMPTS
    };
    const calls = [...(parsed.narrativeCalls || []), ...(modelCalls || [])];
    const updated = mergeNarrativeStateDiagnostics(parsed, { ...state, story }, calls.length ? calls : null);
    db.prepare('UPDATE messages SET debugNotice = ? WHERE id = ? AND chatId = ?').run(JSON.stringify(updated), originId, workspaceId);
}

function loadPresenceNotes(workspaceId, messages) {
    try {
        const { CharacterSceneMemory } = require('../../dist-main/main/features/narrative/character-scene-memory');
        return new CharacterSceneMemory(db).presenceNotes(workspaceId, messages);
    } catch (error) {
        console.warn('[Scene Memory] Could not load the presence notes:', error.message);
        return new Map();
    }
}

// Only present non-player characters remember; the reply's own time keeps a reprocessed turn in story order.
function recordCharacterSceneMemory({ sceneMemory, normalizeSceneMemoryUpdates, workspaceId, provenanceId, triage, actorIds, playerEntityId, locationId }) {
    const presentIds = Array.isArray(triage.presentIds) ? triage.presentIds.filter(id => actorIds.has(id)) : [];
    const updates = normalizeSceneMemoryUpdates(triage.sceneMemory, {
        eligibleIds: presentIds.filter(id => id !== playerEntityId),
        speakerIds: actorIds
    });
    try {
        const reply = db.prepare('SELECT createdAt FROM messages WHERE id = ? AND chatId = ?').get(provenanceId, workspaceId);
        sceneMemory.recordTurn({
            workspaceId,
            originId: provenanceId,
            presentIds,
            locationId,
            createdAt: Number(reply?.createdAt) || Date.now(),
            updates
        });
    } catch (error) {
        console.warn('[Scene Memory] Could not record the turn:', error.message);
    }
    return updates;
}

// The sleep and rest a turn's time held, never more than the time that passed, for people in the scene.
function restWithin(rest, minutes, allowedIds) {
    if (!rest || typeof rest !== 'object' || !(minutes > 0)) return null;
    let sleepMinutes = Math.max(0, Math.round(Number(rest.sleepMinutes) || 0));
    let restMinutes = Math.max(0, Math.round(Number(rest.restMinutes) || 0));
    const entityIds = [...new Set((Array.isArray(rest.restingIds) ? rest.restingIds : []).filter(id => allowedIds.has(id)))];
    if (!entityIds.length || !(sleepMinutes + restMinutes > 0)) return null;
    const total = sleepMinutes + restMinutes;
    if (total > minutes) {
        sleepMinutes = Math.floor(sleepMinutes * minutes / total);
        restMinutes = Math.floor(restMinutes * minutes / total);
    }
    return { sleepMinutes, restMinutes, entityIds };
}

function conditionSystem() {
    const { RoleplayConditions } = require('../../dist-main/main/features/narrative/roleplay-conditions');
    return new RoleplayConditions(db);
}

function loadActiveConditionNames(workspaceId, entityId) {
    try {
        const conditions = conditionSystem();
        if (!conditions.getSettings(workspaceId).enabled) return [];
        return conditions.listActive(workspaceId, [entityId]).map(condition => condition.name);
    } catch (error) {
        console.warn('[Conditions] Could not read who has what:', error.message);
        return [];
    }
}

// The story date and time now, as a condition records when it began.
function roleplayClockLabel(workspaceId) {
    try {
        const calendarService = require('./features/worldbuild/calendar-service');
        const formatted = calendarService.formatClock(calendarService.getCalendar(db, workspaceId), calendarService.getRoleplayClock(db, workspaceId));
        return [formatted.date, formatted.time].filter(Boolean).join(', ');
    } catch {
        return '';
    }
}

function applyConditionTime(workspaceId, provenanceId, { minutes, rest }) {
    try {
        conditionSystem().applyTime(workspaceId, provenanceId, {
            minutes,
            sleepMinutes: rest?.sleepMinutes || 0,
            restMinutes: rest?.restMinutes || 0,
            restingIds: rest?.entityIds || []
        });
    } catch (error) {
        console.warn('[Conditions] Could not let time pass for conditions:', error.message);
    }
}

function applyConditionThresholds(workspaceId, provenanceId, entityIds) {
    try {
        conditionSystem().applyThresholds(workspaceId, provenanceId, entityIds, roleplayClockLabel(workspaceId));
    } catch (error) {
        console.warn('[Conditions] Could not check resource lines:', error.message);
    }
}

// The catalog and who has what now, for the scene pass when the turn may change a condition.
function describeConditionsForAnalysis(workspaceId, entityIds) {
    try {
        const { describeConditionEnd } = require('../../dist-main/main/features/narrative/roleplay-conditions');
        const conditions = conditionSystem();
        const settings = conditions.getSettings(workspaceId);
        if (!settings.enabled) return {};
        const { RoleplaySystem } = require('../../dist-main/main/features/narrative/roleplay-system');
        const resourceNames = new Map(new RoleplaySystem(db).listDefinitions(workspaceId).map(definition => [definition.id, definition.name]));
        const catalog = conditions.listDefinitions(workspaceId).filter(condition => condition.status === 'confirmed');
        return {
            conditionCatalog: {
                createAllowed: settings.aiCreates || undefined,
                conditions: catalog.map(condition => ({
                    name: condition.name,
                    ...(condition.description ? { meaning: condition.description } : {}),
                    ...(describeConditionEnd(condition) ? { ends: describeConditionEnd(condition) } : {}),
                    ...(condition.endsWhen ? { endsWhen: condition.endsWhen } : {}),
                    ...(condition.triggerDefinitionId && resourceNames.has(condition.triggerDefinitionId)
                        ? { startsBelow: `${resourceNames.get(condition.triggerDefinitionId)} below ${condition.triggerBelowPercent}%` }
                        : {})
                }))
            },
            currentConditions: conditions.listActive(workspaceId, entityIds).map(condition => ({
                entityId: condition.entityId,
                condition: condition.name,
                ...(condition.cause ? { cause: condition.cause } : {})
            }))
        };
    } catch (error) {
        console.warn('[Conditions] Could not describe conditions:', error.message);
        return {};
    }
}

// Starts, extensions and ends the scene pass read, for people in the scene; the rest is dropped.
function proposeConditionChanges({ workspaceId, provenanceId, proposals, allowedIds }) {
    if (!proposals.length) return [];
    const conditions = conditionSystem();
    const startedLabel = roleplayClockLabel(workspaceId);
    const changes = [];
    for (const [index, proposal] of proposals.entries()) {
        if (typeof proposal?.entityId !== 'string' || !allowedIds.has(proposal.entityId)) continue;
        const kind = ['start', 'extend', 'end'].includes(proposal.action) ? proposal.action : null;
        if (!kind || typeof proposal.condition !== 'string') continue;
        try {
            const change = conditions.proposeChange({
                id: `${provenanceId}:condition:${index}`,
                workspaceId,
                entityId: proposal.entityId,
                condition: proposal.condition,
                kind,
                durationMinutes: Number.isFinite(Number(proposal.durationMinutes)) ? Number(proposal.durationMinutes) : null,
                reason: typeof proposal.reason === 'string' ? proposal.reason : '',
                source: 'ai',
                provenanceId,
                startedLabel,
                create: kind === 'start' && typeof proposal.description === 'string' ? { description: proposal.description } : undefined
            });
            if (change) changes.push({ kind: 'condition', changeId: change.id, ...change });
        } catch (error) {
            console.warn('[Roleplay State] Ignored invalid condition change:', error.message);
        }
    }
    return changes;
}

// What the triage needs to route mechanics: each person's tracked resources and active conditions,
// and the names a turn may use for them.
function describeSceneMechanics({ workspaceId, roleplay, actorIds }) {
    const entries = [];
    const terms = new Map();
    for (const entityId of [...new Set(actorIds)]) {
        let resources = [];
        try {
            resources = roleplay.listEntityResources(workspaceId, entityId).filter(resource => resource.enabled);
        } catch {
            resources = [];
        }
        const conditions = loadActiveConditionNames(workspaceId, entityId);
        if (!resources.length && !conditions.length) continue;
        resources.forEach(resource => terms.set(resource.name, 'resource'));
        conditions.forEach(name => terms.set(name, 'condition'));
        entries.push({
            entityId,
            ...(resources.length ? { resources: resources.map(resource => ({ name: resource.name, current: resource.current, maximum: resource.maximum })) } : {}),
            ...(conditions.length ? { conditions } : {})
        });
    }
    return { entries, terms: [...terms].map(([name, domain]) => ({ name, domain })) };
}

// What this turn's triage saw of the conversation: who was heard speaking and who the turn involved.
function turnCastSignals(triage, actorIds) {
    const speakerIds = (Array.isArray(triage?.sceneMemory) ? triage.sceneMemory : [])
        .flatMap(update => (update.heard || []).map(line => line.fromId))
        .filter(id => id && actorIds.has(id));
    const aboutIds = Array.isArray(triage?.aboutIds) ? triage.aboutIds.filter(id => actorIds.has(id)) : [];
    return { speakerIds, involvedIds: [...new Set([...speakerIds, ...aboutIds])] };
}

// The previous reply's triage, kept in its diagnostics. Without it nobody steps back.
function previousTurnCastSignals(workspaceId, originId, actorIds) {
    try {
        const current = db.prepare("SELECT createdAt FROM messages WHERE id = ? AND chatId = ?").get(originId, workspaceId);
        if (!current) return null;
        const previous = db.prepare(`
            SELECT debugNotice FROM messages
            WHERE chatId = ? AND role = 'ai' AND createdAt < ?
            ORDER BY createdAt DESC LIMIT 1
        `).get(workspaceId, current.createdAt);
        const triage = safeParseObject(previous?.debugNotice)?.narrativeState?.triage;
        if (!triage || !Array.isArray(triage.aboutIds)) return null;
        return { involvedIds: turnCastSignals(triage, actorIds).involvedIds };
    } catch (error) {
        return null;
    }
}

function compactNarrativeScene(scene, playerEntityId = null) {
    if (!scene) return null;
    return {
        id: scene.id,
        playerEntityId,
        locationId: scene.locationId,
        participantIds: scene.participantIds || [],
        possibleObserverIds: scene.possibleObserverIds || [],
        nearbyIds: scene.nearbyIds || [],
        objectIds: scene.objectIds || []
    };
}

function measureNarrativeContextSections(value, systemPrompt = '') {
    const sections = {};
    const systemPromptTokens = estimateTokens(systemPrompt);
    let sectionTokens = 0;
    for (const [key, section] of Object.entries(value || {})) {
        if (section === undefined) continue;
        const tokens = estimateTokens(JSON.stringify(section));
        sectionTokens += tokens;
        sections[key] = {
            tokens,
            ...(Array.isArray(section) ? { count: section.length } : {})
        };
    }
    const payloadTokens = estimateTokens(JSON.stringify(value || {}));
    return {
        systemPromptTokens,
        payloadTokens,
        sectionTokens,
        total: systemPromptTokens + payloadTokens,
        sections
    };
}

function constrainNarrativeStateResult(value, domains) {
    const selected = new Set(domains);
    return {
        newEntities: selected.has('entity') && Array.isArray(value.newEntities) ? value.newEntities : [],
        identityUpdates: selected.has('entity') && Array.isArray(value.identityUpdates) ? value.identityUpdates : [],
        resourceChanges: selected.has('resource') && Array.isArray(value.resourceChanges) ? value.resourceChanges : [],
        conditionChanges: selected.has('condition') && Array.isArray(value.conditionChanges) ? value.conditionChanges : [],
        scenePatch: selected.has('scene') && value.scenePatch && typeof value.scenePatch === 'object' && !Array.isArray(value.scenePatch)
            ? value.scenePatch
            : {},
        inventoryChanges: selected.has('inventory') && Array.isArray(value.inventoryChanges) ? value.inventoryChanges : [],
        events: hasEpistemicDomain(domains) && Array.isArray(value.events) ? value.events : []
    };
}

const NARRATIVE_EVENT_TYPES = new Set([
    'movement',
    'possession-transfer',
    'revelation',
    'deception',
    'discovery',
    'relationship-change',
    'custom'
]);

function normalizeNarrativeEvent(event) {
    if (NARRATIVE_EVENT_TYPES.has(event?.type)) return event;
    const operations = Array.isArray(event?.operations) ? event.operations : [];
    let type = 'custom';
    if (operations.some(operation => operation?.type === 'relationship')) type = 'relationship-change';
    else if (operations.some(operation => operation?.type === 'knowledge' || operation?.type === 'awareness')) type = 'revelation';
    else if (operations.some(operation => operation?.type === 'fact')) type = 'discovery';
    return { ...event, type };
}

// A regard can only move for someone who perceived the turn, so edges are read from their side:
// all of them for those present, only toward the focus for those merely mentioned. The player's
// own regard is the player's to set and is never analyzed.
function loadNarrativeRelationshipState(workspaceId, holders, focusIds, playerEntityId, limit = 120) {
    const ids = [...holders.present, ...holders.mentioned].filter(id => id && id !== playerEntityId);
    if (!ids.length) return { rows: [], candidates: 0 };
    const rows = db.prepare(`
        SELECT links.fromId AS sourceEntityId, links.toId AS targetEntityId,
          links.metadata_json AS metadataJson
        FROM entity_links links
        WHERE links.workspaceId = ? AND links.relType = 'related_to'
          AND links.fromId IN (${ids.map(() => '?').join(',')})
        ORDER BY links.createdAt DESC
    `).all(workspaceId, ...ids)
        .filter(row => holders.present.has(row.sourceEntityId) || focusIds.has(row.targetEntityId));
    // Stable sort: edges toward the turn's focus first, newest first inside each group.
    rows.sort((a, b) => Number(focusIds.has(b.targetEntityId)) - Number(focusIds.has(a.targetEntityId)));
    return {
        candidates: rows.length,
        rows: rows.slice(0, limit).map(row => {
            const metadata = safeParseObject(row.metadataJson) || {};
            const value = Number(metadata.value);
            return {
                sourceEntityId: row.sourceEntityId,
                targetEntityId: row.targetEntityId,
                dimension: 'overall',
                value: Number.isFinite(value) ? Math.max(-100, Math.min(100, value)) : 0
            };
        })
    };
}

// Everything the holders carry, and a mentioned item only in the hands of someone in the scene:
// a common item named in passing must not bring in every holder of it in the world.
function loadNarrativeInventoryState(workspaceId, holderIds, itemIds, sceneHolderIds = holderIds) {
    const holders = [...holderIds];
    const items = [...itemIds];
    const sceneHolders = [...sceneHolderIds];
    const conditions = [];
    const parameters = [workspaceId];
    if (holders.length) {
        conditions.push(`links.toId IN (${holders.map(() => '?').join(',')})`);
        parameters.push(...holders);
    }
    if (items.length && sceneHolders.length) {
        conditions.push(`(links.fromId IN (${items.map(() => '?').join(',')}) AND links.toId IN (${sceneHolders.map(() => '?').join(',')}))`);
        parameters.push(...items, ...sceneHolders);
    }
    if (!conditions.length) return [];
    const rows = db.prepare(`
        SELECT links.fromId AS itemId, links.toId AS holderId,
          links.metadata_json AS metadataJson, items.canonicalName AS itemName, items.data AS itemData,
          CASE WHEN equipment.item_id IS NULL THEN 0 ELSE 1 END AS equipped
        FROM entity_links AS links
        JOIN entities AS items ON items.id = links.fromId AND items.workspaceId = links.workspaceId
        LEFT JOIN roleplay_equipment AS equipment
          ON equipment.workspace_id = links.workspaceId
          AND equipment.entity_id = links.toId AND equipment.item_id = links.fromId
        WHERE links.workspaceId = ? AND links.relType IN ('owned_by', 'carried_by')
          AND items.type = 'Items' AND items.status != 'proposed'
          AND (${conditions.join(' OR ')})
        ORDER BY items.canonicalName COLLATE NOCASE, links.toId
        LIMIT 120
    `).all(...parameters);
    const placements = new Map();
    for (const row of rows) {
        const itemData = safeParseObject(row.itemData) || {};
        const metadata = safeParseObject(row.metadataJson) || {};
        const nature = itemData.itemNature === 'unique' ? 'unique' : 'type';
        const key = `${row.itemId}\u0000${row.holderId}`;
        const placement = placements.get(key) || {
            itemId: row.itemId,
            itemName: row.itemName,
            holderId: row.holderId,
            nature,
            quantity: 0,
            equipped: false
        };
        placement.quantity += nature === 'unique' ? 1 : Math.max(1, Math.round(Number(metadata.quantity) || 1));
        placement.equipped ||= Boolean(row.equipped);
        placements.set(key, placement);
    }
    return [...placements.values()];
}

function loadNarrativeLocationInventoryState(workspaceId, locationId, itemIds) {
    const items = [...itemIds];
    const typeConditions = [];
    const typeParameters = [workspaceId];
    if (locationId) {
        typeConditions.push('inventory.location_id = ?');
        typeParameters.push(locationId);
    }
    if (items.length) {
        typeConditions.push(`inventory.item_id IN (${items.map(() => '?').join(',')})`);
        typeParameters.push(...items);
    }
    const typeItems = typeConditions.length ? db.prepare(`
        SELECT inventory.item_id AS itemId, items.canonicalName AS itemName,
          inventory.location_id AS locationId, inventory.quantity
        FROM roleplay_location_inventory AS inventory
        JOIN entities AS items
          ON items.id = inventory.item_id AND items.workspaceId = inventory.workspace_id
        WHERE inventory.workspace_id = ? AND (${typeConditions.join(' OR ')})
        ORDER BY items.canonicalName COLLATE NOCASE
        LIMIT 80
    `).all(...typeParameters).map(row => ({ ...row, nature: 'type', equipped: false })) : [];

    const uniqueConditions = [];
    const uniqueParameters = [workspaceId];
    if (locationId) {
        uniqueConditions.push('links.toId = ?');
        uniqueParameters.push(locationId);
    }
    if (items.length) {
        uniqueConditions.push(`links.fromId IN (${items.map(() => '?').join(',')})`);
        uniqueParameters.push(...items);
    }
    const uniqueItems = uniqueConditions.length ? db.prepare(`
        SELECT links.fromId AS itemId, items.canonicalName AS itemName,
          links.toId AS locationId, 1 AS quantity
        FROM entity_links AS links
        JOIN entities AS items
          ON items.id = links.fromId AND items.workspaceId = links.workspaceId
        WHERE links.workspaceId = ? AND links.relType = 'located_in'
          AND items.type = 'Items' AND items.status != 'proposed'
          AND (${uniqueConditions.join(' OR ')})
        ORDER BY items.canonicalName COLLATE NOCASE
        LIMIT 80
    `).all(...uniqueParameters).map(row => ({ ...row, nature: 'unique', equipped: false })) : [];
    return [...uniqueItems, ...typeItems];
}

const NARRATIVE_TRIAGE_SYSTEM_PROMPT = `You route Roleplay turns to durable-state analyzers and estimate elapsed narrative time. Inspect the user action, final narrative, current time, calendar, time matrix, compact scene, named entities, and locally extracted candidate signals. Candidate signals are hints, not conclusions.
Return JSON only with {"consequential":boolean,"types":["entity","scene","resource","condition","inventory","awareness","knowledge","belief","memory","relationship","fact"],"entityIds":["existing-id"],"presentIds":["existing-id"],"aboutIds":["existing-id"],"confidence":0.0,"evidence":["short verbatim excerpt"],"requiresFullAnalysis":boolean,"reason":"brief","timeAdvance":null,"sceneMemory":[]}. entityIds lists every supplied entity the turn involves or is about, including one that is discussed or implied without being present. presentIds lists the supplied Characters and Creatures physically in the scene when the turn ends, including anyone who arrived during it and excluding anyone only mentioned, remembered or written to. Everyone in currentScene who has not left stays in presentIds, whether or not they speak or are mentioned this turn. aboutIds is a separate list and never narrows presentIds, which still holds everyone physically in the scene. aboutIds lists the supplied entities this turn concerns: anyone who speaks, acts or is spoken to, and every person, place, item, group or event that is discussed, asked about, revealed or implied, even when it is only described and never named. A person who is only in the background of this turn stays in presentIds and out of aboutIds.
Always evaluate elapsed time, even when no other durable domain is consequential. For an in-world action, timeAdvance is {"actionType":"short_snake_case","basis":"explicit|matrix","duration":{"years":0,"months":0,"days":0,"hours":0,"minutes":0},"targetPosition":null,"confidence":0.0,"evidence":"short verbatim excerpt","statedSpan":null,"movementOnly":false,"rest":{"sleepMinutes":0,"restMinutes":0,"restingIds":[]}}. When the final narrative establishes an absolute ending date or time, set basis to "explicit", copy the complete resulting calendar position into targetPosition, and also return the calculated duration. Use null for out-of-character instructions, corrections, hypothetical actions, or when no in-world time passed. A skip of days, months or years is returned in the same duration object and is accepted only when the turn says so in words: an estimate on its own is held to a week. Whenever the user message or the narrative states a span of time, also return statedSpan as {"excerpt":"the exact words that state it, copied verbatim","amount":3,"unit":"minutes|hours|days|weeks|months|years|decades","asserts":"now|framing|history"}: "now" when that time passes in this turn, "framing" when it only frames a scene (a flashback or a setting), "history" when it recounts the world's past. A span needs a stated amount and unit ("two hours later", "20 minutes"): a vague promise such as "it won't take long" or a clock time such as "at 19h" is not a span. Otherwise statedSpan is null. Never translate or paraphrase the excerpt. Travel always costs time: when the turn completes a journey between places, timeAdvance is never null, and its duration must match the distance actually crossed rather than the length of the passage describing it. Walking somewhere is usually described in two lines and still takes as long as the walk takes, so read the duration off the timeMatrix category the journey belongs to and never below that category's minimumMinutes. The category of a journey comes from where the two locations sit, not from the timeMatrix guidance, which describes actions: currentLocation lists the scene's location with what contains it, and each location in availableEntities carries its size. Between spots inside one place is Micro; between places of one area, Local; across the districts of an area, Transit; between areas of a region, Macro. Set movementOnly to true when the turn's time is the journey itself, with only talk, glances or other Micro actions on the way; set it to false when something longer also happens before or after the move (work, a meal, a search, rest, a long conversation), and add that action's time to the duration. With no journey, movementOnly is false. rest says how much of the duration was spent asleep or resting: sleepMinutes for actual sleep, restMinutes for resting awake (sitting down to recover, a meal break, lying down without sleeping), and restingIds for the supplied Characters and Creatures who did it. Count only what the turn shows happening, never a plan to sleep later, and never more than the duration; work, travel, a fight or a long conversation is not rest. A night's sleep the turn skips over counts in full. Otherwise both are 0 and restingIds is empty.
An explicit final position or duration in the narrative wins over the matrix. Reconcile every clock reference with currentTime; do not describe a turn as reaching a later time while returning null or a conflicting duration. Otherwise choose a reasonable value within the supplied matrix: Micro for dialogue lines, combat rounds, lockpicking, and quick scans; Local for same-district walking, wound care, and careful room inspection; Transit for cross-district travel, crowds, minor repairs, and setting camp; Macro for crafting, deep study, rest, and inter-city travel; Timeskip for supported downtime, recovery, waiting, long-distance travel, or another transition spanning one or more calendar days. Do not advance hours during line-by-line dialogue. Do not use a tiny advance for substantial travel. A jump of one day or more must be explicitly supported by the final narrative or by a completed action whose duration is covered by the configured Timeskip range. Return calendar units directly instead of assuming a 24-hour day.
mechanics lists, for each Character and Creature in the scene, the resources the world tracks with their current and maximum values, and the conditions they have now. Mark resource when one of them spends, suffers, recovers or consumes something that moves one of those resources, even when the narrative gives no numbers: casting, forging with mana, a hard effort, a wound, a potion. Mark condition when one of them gains, loses, worsens or is treated for a condition, by the meaning of what happens. Sleep and rest are not resource changes: they belong in timeAdvance.rest.
Mark inventory for explicit pickup, drop, transfer, gift, payment, purchase, sale, trade, tip, loan, theft, loss, consumption, equip, unequip, drawing, sheathing, or quantity change. Money is coins, which are items: paying, spending or receiving money is inventory, never resource. Judge every domain by what happens, in whatever language the turn is written, never by keywords. Mark scene for explicit arrival, departure, movement, participation, observer, nearby, object, or location change, including someone joining or leaving the conversation, stepping away within the place, or leaving the place. Mark epistemic domains only for information actually communicated, perceived, discovered, remembered, believed, or relationally consequential. Mark relationship for a first demonstrated encounter or interaction that must initialize a directional relationship, even when its initial value is 0, and for an event that materially and durably changes an existing value. Direct conversation is mutual interaction. Listening or overhearing is interaction only from the aware listener toward the speaker unless the speaker also perceives the listener. Mere co-presence is not interaction. Ordinary politeness, irritation, banter, compliance, disagreement, or passing mood does not change an existing value. Mark resource for an actual value change, not a price mention or hypothetical. Experience, attributes and skills are weighed when the scene ends, never per turn. A concrete edition of a supplied recurring Event is consequential when it actually takes place, even if the tradition itself is already known.
A newly introduced persistent named character, stably identifiable individual creature, new race or species, named location, or narratively important unique item is consequential even without an existing ID, and so is a thing made, forged, copied, split off or transformed into something new during the turn, or a new room or place the scene moves into. An unnamed person distinguished only by appearance, ancestry, clothing, age, expression, or scene position may be routed as a sparse entity candidate, but is not yet a Worldbuild identity. Mark entity only for someone or something absent from availableEntities, or for a new name, nickname or title of an existing one. Someone learning, hearing or using the name already on an existing sheet is awareness or knowledge, never entity. Mark false for crowds, atmosphere, repetition, casual dialogue, hypotheticals, offers not completed, item mentions without possession changes, and events without durable consequences. Presence alone never grants awareness or knowledge. Set requiresFullAnalysis only when four or more domains interact or the consequence cannot be safely isolated.
sceneMemory is short-lived working memory, separate from every durable domain above, and is filled even when consequential is false. For each Character or Creature in presentIds other than currentScene.playerEntityId who took in something new this turn, return {"entityId":"id","perceived":["..."],"heard":[{"fromId":"speaker id or empty string","text":"..."}],"stance":"..."}. perceived lists what that character directly saw or heard happen in front of them, a few words each, with names, numbers and objects exactly as they appeared to that character. heard lists what was said to them or within their hearing, as the speaker's claim and never as the truth, keeping the speaker's own figures and wording; fromId is the speaker's supplied id, or an empty string when the speaker has none. A character who arrived during the turn records only what happened after arriving. Never record another character's thoughts, narration they could not perceive, or anything only the narrator knows: if the narration counts ten crates but the character was only told eight, they heard eight. stance is one short line on what they want right now and how they regard the player character, written only when it is new or differs from characterStances, otherwise an empty string. Skip characters with nothing new, and return [] when nobody qualifies.`;
const NARRATIVE_REPAIR_SYSTEM_PROMPT = 'Repair the supplied response into one valid JSON object that follows the required schema. Preserve supported values. Return JSON only.';

const NARRATIVE_ENTITY_SCOPED_PROMPT = `ENTITY DOMAIN: Retain each newly introduced persistent thing absent from availableEntities as either an established identity or a sparse candidate: a person, a creature, a race or species, a location, or a unique item, including one made, forged, copied, split off or transformed into something new during this turn. Return it in newEntities as {"referenceId":"new:stable-local-key","name":"canonical name or concise sparse label","type":"Characters|Creatures|Races|Locations|Items","aliases":[],"description":"explicit introduction facts","excerpt":"short verbatim evidence","confidence":0.0,"decision":"new|ambiguous|conflicting","identityEstablished":true|false,"reason":"brief","scope":"individual|group","itemNature":"unique|type","groupId":"existing race or species id or empty","derivedFromId":"existing id it was made from, copied from or split off, or empty","classificationDoubt":false,"scenePresence":"participant|observer|nearby|absent","size":"region|area|place|spot"}.
One or a kind: decide this first, and say classificationDoubt true when the narrative leaves it open. For Creatures, scope is individual for one being someone could point at, even an unnamed one, and group for a species, breed, pack type or kind of creature, never for one of them. A new people of the world is type Races. For Items, itemNature is unique for one particular thing with a name, a mark, a history or an owner of its own, and type for an ordinary kind of thing anyone could have. A copy or replica of an existing item is its own unique item, with derivedFromId naming the original; facts about the copy belong to it, never to the original. For a Character or individual Creature of a race or species in availableEntities, set groupId to it.
For Locations, size is region when wider than a scene, area when it holds many places, place when a scene happens there, and spot for a room or enclosed space inside a place. For Characters and individual Creatures, use participant only for direct involvement, observer only for explicit witnessing or listening, nearby only for broader physical presence, and absent for recollections, reports, or offscreen mentions. This presence can change without a location change. Set identityEstablished true only for a proper name, stable title, number, designation, unmistakable continuity identity, or explicit registration. Appearance, ancestry, clothing, age, expression, or scene position alone means false. Anonymous individuals with false remain sparse and reviewable; they do not become Worldbuild entities automatically. Use referenceId elsewhere. Do not create crowds, ordinary item mentions without a lasting role, disguises, a changed state of something that keeps its identity, or duplicates.`;

const NARRATIVE_SCENE_SCOPED_PROMPT = `SCENE DOMAIN: scenePatch may contain locationId, participantIds, possibleObserverIds, nearbyIds, and objectIds. Return complete replacement arrays only for fields that changed. Participants are directly involved, possible observers can witness, nearby entities are in the broader location, and objects are physically present. Explicit completed arrivals, departures, joining a conversation, sitting with the group, leaving, and deliberate movement can change scene membership independently from locationId. Include newly introduced entity referenceIds in the appropriate array. When inventory is also selected, dropping a unique item may add it to objectIds, while picking up, consuming, destroying, or removing it may remove it. Keep unrelated existing objectIds. Change location only after movement is completed and use reachableLocationIds. When the destination is a part of the current location with no entry of its own, such as a room, a floor or a yard, keep the current locationId; never substitute another place for it. Intention, preparation, a destination plan, an open door, or a visible route is not a completed location change. reachableLocationIds already spans the whole surrounding region, so a completed journey across a city, district, or road belongs here. A scene patch is applied whole or not at all: if the destination is not in reachableLocationIds, the participant and object arrays are discarded with it, so return the arrays that match the location you actually set. Presence is not ownership or knowledge.`;

const NARRATIVE_RESOURCE_SCOPED_PROMPT = `RESOURCE DOMAIN: resourceChanges contain {"entityId":"id","resource":"resource name","change":signed-number,"reason":"short phrase from the story"}. change is the amount gained (+) or lost (-), never the resulting total; currentResourceStates shows where each value stands, and the value is kept within its range for you. Use only resources listed for that entity in currentResourceStates. Apply the gains, losses, recovery, damage and expenditure the turn shows happening, even when the narrative gives no numbers: each resource description says what moves it and by how much, so read the amount from what the scene shows (a small adjustment, a hard effort, a heavy blow). lowestEffect says what happens at its lowest. Prices, wages, comparisons, plans, hypotheticals, and narration without an actual change are not resource changes. Elapsed time, sleep and rest are applied by the app: never report recovery or drain that comes only from time passing, sleeping or resting. Report only what they do not cover, such as a potion, a healer or a meal that restores something.`;

const NARRATIVE_RESOURCE_MAXIMUM_PROMPT = `RESOURCE MAXIMUM: a resource with maximumRule in availableResources can have its maximum changed for good. Report it as {"entityId":"id","resource":"resource name","maximum":signed-number,"reason":"short phrase from the story"}, only for a lasting change the story clearly shows and that maximumRule allows, such as long training, an implant, a lost limb or a permanent curse. maximum is the amount the maximum moves, never the new total. Potions, blessings, fatigue and anything that will wear off change the current value with change, never the maximum. Rarely, and never twice for the same resource in a turn.`;

const NARRATIVE_PROGRESSION_PROMPT = `PROGRESSION: progression.characters are the only characters who grow. Report their growth in changes.
- XP: {"entityId":"id","progress":"xp","change":positive-integer,"reason":"short phrase"} for what the scene earned as progression.xpGuidance describes, such as a won fight, a finished project or quest, or a clever solution. progression.xpGuidance is the world's own scale: follow its amounts. Routine actions alone earn nothing. XP is only added, unless progression.xpCanDrop is true and the story takes experience away. Never report a level: levels follow from XP.
- Attribute: {"entityId":"id","progress":"attribute","attribute":"attribute name","change":1,"reason":"short phrase"} only when the story clearly earns a lasting change: sustained training, a hard-won lesson, a breakthrough. When progression.attributeRules.whenToRaise is given, it is the world's own bar for a raise and is stricter than any general reason: follow it. One point at a time, and rarely. Use change -1 only when progression.attributeRules.lower is true and the story shows a lasting injury, curse or age. When progression.attributeRules.raise is false, report no attribute raise.`;

const NARRATIVE_CONDITION_SCOPED_PROMPT = `CONDITION DOMAIN: conditionCatalog lists the conditions this world tracks, with what each does and how it ends; currentConditions lists who has which one now. conditionChanges contain {"entityId":"id","condition":"condition name","action":"start|extend|end","durationMinutes":integer-or-null,"reason":"short phrase from the story"}.
- start: the turn shows the cause happening to a Character or Creature in the scene: a wound that bleeds, a poison, a curse, an overload the condition describes. durationMinutes only when the story sets how long it lasts; otherwise null and the catalog's rule applies.
- extend: someone who already has it makes it worse or longer.
- end: a treatment, a cure or an event the catalog's endsWhen names happens in the turn. Time, sleep and rest end conditions by themselves: never report those.
A condition tied to a resource (startsBelow) starts and ends by itself with that resource: never report it. When conditionCatalog.createAllowed is true and the turn clearly gives someone a lasting condition the catalog lacks, start it with its own name and add "description":"what it does to them"; prefer an existing condition whenever one fits. Moods, passing pain and anything that ends within the same scene are not conditions.`;

const NARRATIVE_INVENTORY_SCOPED_PROMPT = `INVENTORY DOMAIN: Track explicit pickup, drop, deliberate placement, gift, transfer, theft, loss, consumption, destruction, equip, unequip, drawing, sheathing, and quantity changes. currentInventoryState and currentLocationInventoryState are the pre-turn truth.
For a unique item move return {"itemId":"id","fromHolderId":"id-or-null","toHolderId":"id-or-null","locationId":"id-or-null","equipped":boolean-when-explicit}. It has exactly one holder or location. Dropping or deliberately leaving it uses locationId. Loss, consumption, or destruction with no destination uses null targets.
For an item type transfer return {"itemId":"id","fromHolderId":"id-or-null","fromLocationId":"id-or-null","toHolderId":"id-or-null","locationId":"id-or-null","quantity":positive-integer,"equipped":boolean-when-explicit}. fromLocationId means pickup; locationId means dropped or stored. Consumption or loss removes quantity without adding a destination.
For equipment only return {"itemId":"id","holderId":"id","equipped":boolean}. Apply these same rules to every Character and individual Creature in currentInventoryState, including currentScene.playerEntityId. Inventory is possession without active use. Equipped is reserved for active use, such as wielding, holding in use, or wearing. A belt, sheath, scabbard, holster, bag, pocket, or ordinary inventory is not equipped. Determine the final state after the entire turn. Drawing, wielding, wearing, or putting on a carried item normally equips it. Sheathing, stowing, taking off, putting away, or placing it on a belt normally unequips it without changing holder. If an item is used first and then put away later in the same message, return equipped:false. A transfer from an equipped holder includes equipped:false; equipping by the recipient uses equipped:true.
Do not mutate inventory from seeing, discussing, pricing, offering, requesting, touching, or temporary use unless possession, placement, quantity, or equipped state explicitly changes. Never invent an item ID.`;

const NARRATIVE_EPISTEMIC_SCOPED_PROMPT = `EPISTEMIC DOMAINS: preTurnContext is the scoped epistemic manifest used for generation; each entry in preTurnContext.subjects lists one subject's targets under their state (confirmed, derived, candidates with evidence, deepened). A pair not listed is undetermined, and undetermined is not ignorance. derived targets and candidates are not automatically canon. currentKnowledgeCards groups Awareness and known fields by card. currentPerspectiveState holds the current knowledge, beliefs and memories of whoever could perceive this turn (subjectId is the holder), about anyone, plus facts about the entities involved. Long texts there end in … where they were shortened; a record is already stored when its opening matches.
Each event contains type, description, a short verbatim excerpt, participantIds, confidence from 0 to 1, and operations. Event type must be exactly one of movement, possession-transfer, revelation, deception, discovery, relationship-change, or custom. Use custom when no narrower allowed type fits. When a concrete edition of a supplied recurring Worldbuild Event actually happens, also return worldbuildEventId, occurrenceTitle, worldDate, and participants with roles plus Faction audience. Do not link plans, recollections, comparisons, or passing mentions as new occurrences. Allowed operations:
{"type":"fact","proposition":{"subjectId":"id","predicate":"stable-key","object":any},"category":"knowledge-category","confidence":0.0}
{"type":"awareness","subjectId":"id","targetId":"id","confidence":0.0}
{"type":"knowledge","subjectId":"id","proposition":{"subjectId":"id","predicate":"stable-key","object":any},"category":"knowledge-category","acquisition":"participant|witness|reported|inferred","informantIds":["id"],"confidence":0.0,"accessibility":"available|suppressed|inaccessible"}
{"type":"belief","subjectId":"id","proposition":{"subjectId":"id","predicate":"stable-key","object":any},"category":"knowledge-category","confidence":0.0}
{"type":"memory","subjectId":"id","summary":"durable personal memory","category":"memory-category","salience":0.0,"accessibility":"available|suppressed|inaccessible"}
{"type":"relationship","sourceEntityId":"id","targetEntityId":"id","dimension":"overall","value":absolute-number,"cause":"relationship-cause","impact":"meaningful|significant|drastic"}

THE DURABILITY TEST: a record exists to keep a campaign coherent across dozens of scenes, not to transcribe the one that just happened. Before every fact, knowledge, belief and memory, ask whether it would still change what someone says, does or withholds ten scenes from now. If the answer is no, it is not a record. The narrative itself is already in the window, so repeating it here buries the few statements that matter under a log of the ones that do not.

KNOWLEDGE CATEGORIES. Every fact, knowledge and belief must declare exactly one category.
Durable, and stored: world-lore (how the world, an institution, a material, a custom or a law works), identity (who or what someone really is, including a true name, origin, allegiance, station or condition), history (a past event, what happened in it and to whom), secret (information deliberately concealed, whose exposure would change what people do), capability (what a person, item, creature or technique can do), property (what a thing is made of, its present condition, or what examining or testing it showed), intent (a plan, promise, threat or goal that outlives the scene), bond (what a subject knows about a relationship between others).
Momentary, and discarded: scene-state (where someone is, what they are doing right now, who is present, how they look, what they are holding), small-talk (courtesy, mood, banter, routine action, an observation with no later consequence).
Classify honestly. Momentary content given a durable category corrupts the campaign, while classifying it as scene-state or small-talk is the correct answer and costs nothing. Never invent a category outside this list.

MEMORY CATEGORIES. Every memory must declare exactly one: formative, bond, loss, trauma, triumph, oath or revelation for what a character carries; routine for anything they would not still be thinking about tomorrow. A memory is one person's experience in their own perspective, not a summary of the event. Do not write the same summary for several subjects: give each their own, or record none. Record memories only for directly participating Characters, individual Creatures, and institutionally involved Factions, never for Locations or Items.
SALIENCE. Every memory gives salience, how much it will matter to its holder later: 0.9 to 1 shapes who they are (what formed them, a wound, a loss, an oath, a truth about themselves) and never fades; 0.7 to 0.85 moves the plot or a relationship (a plan under way, a quarrel, a mission) and fades slowly; 0.4 to 0.6 is useful context of one moment (where a meeting was, a price agreed, who was in the room) and fades fast; below 0.4 it is a passing detail and not a memory. A faded memory is out of reach, not gone: the story can bring it back.

RELATIONSHIP CAUSES. Every relationship operation must name the cause that actually moved the bar.
Events of weight: rescue (saved them from danger, death or ruin), sacrifice (gave up something dear for them), oath (a formal promise between them), revelation (a truth that changes how one sees the other), shared-loss (went through a loss together), forgiveness (forgave a past wrong), betrayal (a deliberate breach of trust), cruelty (hurt them on purpose), humiliation (shamed them before others), rejection (refused a bond, a request or a feeling they offered).
Closeness built over time: sustained-trust (trust earned by a repeated pattern, never by one pleasant scene), affection (tenderness, care or attraction shown), confidence-shared (a secret or vulnerability entrusted to them), reliance (coming to count on them for something that matters), material-debt (owing something concrete: a favour, a payment, an item).
Ordinary closeness, which moves a bond only slightly: courtesy, banter, routine-cooperation.
first-impression only for two characters with no relationship yet in currentRelationshipState.
Causes that never move it: mood, compliance, instruction, presence. Omit the operation for these.

Awareness requires demonstrated interaction, recognition, testimony, discovery, conscious possession, or a relationship. Shared presence is insufficient. Grant knowledge only when the subject actually acquires the exact proposition in this turn. Set acquisition from how they came by it: participant or witness for first-hand perception, reported when someone told them, inferred when they reasoned it out. Reading a written text in the scene counts as being told by its author: use reported, with the author's id in informantIds when the author is known, and record what the text claims as the author's claim, not as fact. Return informantIds only with reported acquisition, naming the supplied ids of whoever told them, and omit the field otherwise. A subject is never their own informant, and never records knowledge about themselves unless the category is secret, identity or intent. Narrator-only information, unnoticed events, private thoughts, vague implication, and contextual availability are not character knowledge. Use belief for rumors, deception, disputed claims, suspicion, and unsupported inference. When a speaker reports observations and a personal theory, listeners gain reported Knowledge of the observations and of the speaker's claim; only the speaker receives the Belief unless a listener explicitly accepts it. Existing Awareness in currentKnowledgeCards is sufficient; do not repeat it only to make knowledge valid. Group knowledge requires explicit collective communication or a shared source. Do not union member knowledge. A Faction that learns through one of its own uses reported acquisition with that member in informantIds. Knowledge held by a Faction is institutional and never becomes a member's own record automatically: when a scene shows a member being told what the group holds, record it for that member with reported acquisition naming who told them.
A proposition object is a statement in words, never an id and never a bare key. When an object names an entity, use its supplied id; otherwise write plain prose. Scene membership, position and current activity belong to scenePatch alone and never to a fact, knowledge or belief, whatever the predicate is called. A perception shared by everyone present, withheld from nobody, and without later consequence is already carried by the scene and needs no record.
Relationship changes only the directional numeric bar. Never return a title or description. currentScene.playerEntityId identifies the Player. The Player's feelings are unknowable: never emit a relationship operation whose sourceEntityId is the Player. You may emit Awareness with the Player as subject or target. When an NPC is explicitly presented to the Player, record Player-to-NPC Awareness, NPC-to-Player Awareness, and only the NPC-to-Player directional relationship. Use currentRelationshipState as the baseline and return an absolute value. On a first demonstrated encounter or interaction, initialize the supported non-Player directional relationship and Awareness card with cause first-impression. Direct mutual interaction normally requires both directions. Listening or overhearing requires listener-to-speaker only unless the speaker perceives the listener. Default a new relationship to 0. Prior favorable or adverse information normally supports an initial value within -25 to 25 with meaningful impact. Significant explicit evidence may support up to -50 or 50 with significant impact. Set drastic impact and use values approaching -100 or 100 only for extreme explicit evidence such as established hatred, mortal enmity, absolute devotion, or an equivalent relationship-defining fact. Directions may differ. For an existing relationship, impact is meaningful for an ordinary shift, significant for a major act or a repeated pattern, and drastic only for an event that defines the relationship: betrayal, sacrifice, saving a life, a devastating revelation or an equivalent rupture. The app limits how far each change goes: a bond moves less the nearer it is to 100 or -100, a wound from someone loved costs more, someone deeply disliked is slow to win back, and ordinary closeness stops counting past certain points. Return the value the scene supports and the honest impact; never inflate either to get past a limit.
${RELATIONSHIP_SCALE_GUIDE}
Ignore existing knowledge and existing memories when deciding what happened, but never restate something the campaign already holds. A turn that changes nothing durable returns no events at all, and that is a correct answer. Most turns produce at most one or two records, and returning many is a sign the durability test was skipped.`;

const NARRATIVE_SKILLS_PROMPT = `SKILLS: skills.characters are the only characters whose skills change. Report them in changes. Ranks are skills.ranks, lowest first; each character's skills show the rank they hold now.
- Learn: {"entityId":"id","skill":"assign","name":"skill name","rank":"rank name","reason":"short phrase"} when the story shows them actually acquiring a skill from skills.catalog they do not hold yet: being taught, practising until it takes, or proving they already had it. Start at the lowest rank unless the story clearly shows more. Only when skills.rules.assign is true.
- Rank: {"entityId":"id","skill":"rank","name":"skill name","change":1,"reason":"short phrase"} only for a milestone the scene shows: succeeding at something beyond their current rank, overcoming a failure, finishing a lesson from someone better. Repetition alone never earns a rank. One step at a time, never twice for the same skill in a turn, and rarely. Use change -1 only when skills.rules.lower is true and the story shows lasting loss. When skills.rules.raise is false, report no raise. When skills.rules.guidance is given, it is the world's own bar and is stricter than these: follow it.
- New skill: {"entityId":"id","skill":"create","name":"New skill name","description":"what it covers","parent":"optional parent skill name","rank":"rank name","reason":"short phrase"} only when skills.rules.create is true and the story shows a distinct, lasting competence that nothing in skills.catalog covers. Prefer an existing skill, or a sub-skill under one with parent, over a broad new one. Never create a skill for a single action.`;

const NARRATIVE_STARTING_PROFILE_PROMPT = `STARTING PROFILE: newCharacterProfile describes this world's levels, attributes and skills. A new Character or individual Creature in newEntities may carry "startingProfile":{"level":integer,"attributes":{"attribute name":integer},"skills":{"skill name":"rank name"}} for who they already are when introduced: a veteran captain, a renowned smith, a frightened child, a beast known for its strength. Fill only what the story shows or clearly implies, and omit everything else: an omitted level stays at 1 and an omitted attribute keeps the world's starting value. Use only attribute names, skill names and ranks listed in newCharacterProfile, keep values inside their ranges, and never describe growth that happens during this turn here. Omit startingProfile entirely for an ordinary person the story says nothing special about.`;

// What a new character's starting profile may use: only parts the world has on and the AI may set.
function describeNewCharacterProfile(progression, skillSystem, workspaceId) {
    const settings = progression.getSettings(workspaceId);
    const levels = settings.mode === 'levels' && settings.config.policy !== 'manual';
    const traits = levels ? progression.listTraits(workspaceId) : [];
    const skillSettings = skillSystem.getSettings(workspaceId);
    const catalog = skillSettings.enabled && skillSettings.config.policy !== 'manual'
        ? skillSystem.listSkills(workspaceId).filter(skill => skill.status === 'confirmed')
        : [];
    if (!levels && !catalog.length) return null;
    return {
        ...(levels ? {
            maxLevel: settings.config.xp.maxLevel || undefined,
            attributes: traits.map(trait => ({ name: trait.name, startsAt: trait.initialValue, minimum: trait.minimum, maximum: trait.maximum }))
        } : {}),
        ...(catalog.length ? {
            skillRanks: skillSettings.config.ranks,
            skills: catalog.map(skill => ({ name: skill.name, ...(skill.description ? { meaning: skill.description } : {}) }))
        } : {})
    };
}

// Skills reach the analysis only when they are on, the AI may change them, and someone learns.
function loadNarrativeSkillsContext(skills, workspaceId) {
    const settings = skills.getSettings(workspaceId);
    if (!settings.enabled || settings.config.policy === 'manual') return null;
    const ids = skills.learningIds(workspaceId);
    return ids.length ? { settings, ids } : null;
}

function describeNarrativeSkills(skills, workspaceId, context) {
    const { config } = context.settings;
    const catalog = skills.listSkills(workspaceId).filter(skill => skill.status === 'confirmed');
    const nameById = new Map(catalog.map(skill => [skill.id, skill.name]));
    return {
        ranks: config.ranks,
        catalog: catalog.map(skill => ({
            name: skill.name,
            ...(skill.description ? { meaning: skill.description } : {}),
            ...(skill.parentId && nameById.has(skill.parentId) ? { parent: nameById.get(skill.parentId) } : {})
        })),
        rules: {
            assign: config.aiAssigns,
            raise: config.aiRaises,
            lower: config.aiLowers,
            create: config.aiCreates,
            guidance: config.guidance.trim() || undefined
        },
        characters: context.ids.map(entityId => ({
            entityId,
            skills: Object.fromEntries(skills.getEntitySkills(workspaceId, entityId).skills.map(skill => [skill.name, skill.rankName]))
        }))
    };
}

// Progression reaches the analysis only when it is on, its rule lets the AI change it, and
// someone progresses; everyone else stays a fixed NPC with nothing to report.
function loadNarrativeProgressionContext(progression, workspaceId) {
    const settings = progression.getSettings(workspaceId);
    if (settings.mode === 'off' || settings.config.policy === 'manual') return null;
    const ids = progression.progressingIds(workspaceId);
    if (!ids.length) return null;
    const traits = progression.listTraits(workspaceId);
    return { settings, ids, traits };
}

function describeNarrativeProgression(progression, workspaceId, context) {
    const { settings, ids, traits } = context;
    const characters = ids.map(entityId => {
        const progress = progression.getEntityProgress(workspaceId, entityId);
        return {
            entityId,
            level: progress.level,
            xp: progress.xp,
            xpForNextLevel: progress.goal,
            attributes: Object.fromEntries(progress.attributes.map(attribute => [attribute.name, attribute.value]))
        };
    });
    return {
        characters,
        attributes: traits.map(trait => ({ name: trait.name, meaning: trait.description, minimum: trait.minimum, maximum: trait.maximum })),
        attributeRules: {
            raise: settings.config.attributes.aiRaises,
            lower: settings.config.attributes.aiLowers,
            whenToRaise: (settings.config.attributes.aiRaises && settings.config.attributes.guidance.trim()) || undefined
        },
        xpCanDrop: !settings.config.xp.aiOnlyAdds || undefined,
        xpGuidance: settings.config.xp.guidance || undefined
    };
}

const EMPTY_MECHANICS = { newEntities: [], identityUpdates: [], resourceChanges: [], conditionChanges: [], scenePatch: {}, inventoryChanges: [] };

const NARRATIVE_MECHANICS_BASE_PROMPT = `You are Kallamo's Narrative State interpreter for the live scene. Never write narrative prose. Analyze only routing.selectedDomains. Extract the explicit consequences of the user action and final narrative for the scene, the people in it, their resources and conditions, and their items. Lasting knowledge, beliefs, memories, facts and relationships are recorded by a separate pass, never here. Candidate signals are hints, not facts. Use only supplied IDs and resource keys.
Return JSON only with {"newEntities":[],"identityUpdates":[],"resourceChanges":[],"conditionChanges":[],"scenePatch":{},"inventoryChanges":[]}. Leave every unselected domain empty. The user message is the player character's chosen action. The narrative response contains world and NPC consequences. Never invent a player choice, line, intention, emotion, memory, or private thought. Empty arrays and an empty scenePatch are correct.`;

const NARRATIVE_STORY_RECORD_PROMPT = `You are Kallamo's story recorder. Never write narrative prose. The live scene of this turn is already settled: turnState says who was present when it ended, who arrived and who left, where it began and ended, and who was introduced. Record only what lasts from the user action and the final narrative, for the domains in turnState.domains. Use only supplied entity IDs.
Return JSON only with {"events":[]}. The user message is the player character's chosen action. The narrative response contains world and NPC consequences. Never invent a player choice, line, intention, emotion, memory, or private thought. An empty events list is the correct answer when nothing durable happened.
Who could perceive what follows from turnState: someone present when a thing happened in front of them may witness it; someone who arrived later, left earlier, or was never there can only learn it by being told, by reading it, or by working it out. Never give a character who left the scene what was said after they left.
Write each event description as one self-contained sentence a reader would understand months later, naming who did what, to whom, and where. Later turns recall a scene through that sentence.`;

const NARRATIVE_STORY_REFS_PROMPT = `CHANGING WHAT IS STORED. A knowledge, belief or memory in currentPerspectiveState that carries a ref can be changed by this turn, and only by these operations:
{"type":"revise","ref":"#1","proposition":{"subjectId":"id","predicate":"stable-key","object":any},"confidence":0.0} when the turn shows the holder now holds a corrected version of it; for a memory give "summary" instead of proposition. The stored record ends and the correction takes its place.
{"type":"confirm","ref":"#1","by":"witnessed|told|evidence"} when the turn puts proof of a belief, a suspicion or an uncertain knowledge in front of its holder: witnessed or evidence makes it certain knowledge, told makes it firmer. A record merely repeated or mentioned again is left alone.
{"type":"end","ref":"#1","how":"forgot|lost|abandoned|disproved|retracted|settled","reason":"a few words"} when the holder stops holding it with nothing in its place: forgot when it slips out of reach for now or they push it away (it stays theirs and can come back), lost when the turn destroys it for good (magic, an injury, a mind broken), abandoned when they give up a belief, disproved when the turn shows the holder themself that it is false, retracted when whoever told them takes it back, settled when it is an intent, condition, refusal, demand or open question that this turn carried out, met, answered, dropped or overtook. A belief the world contradicts but its holder has not seen contradicted is left alone.
{"type":"recall","ref":"#1","cue":"what brought it back"} when something in the turn (the place, an object, a person, the same words, a shock) brings back a record marked "accessibility":"suppressed". One marked "inaccessible" is lost for good and is never recalled; being told it again is new knowledge with reported acquisition.
{"type":"merge","refs":["#1","#2"],"summary":"one account"} when several memories of one holder tell the same experience: they become one memory, in that holder's perspective.
An intent is not permanent. When the turn settles one, end it under every holder that carries a ref for it, so nobody keeps acting on a plan, refusal or question the scene already left behind. A new intent that replaces an old one revises it instead.
Use only refs present in currentPerspectiveState, and put the holder in the event's participantIds. A record that is merely repeated, confirmed or mentioned again is left alone. Never write a new knowledge, belief or memory that contradicts a stored one without revising or ending the stored one in the same event.`;

const NARRATIVE_STORY_NUANCE_PROMPT = `HOW SOMETHING IS HELD. These optional fields say what a plain knowledge or belief cannot. Leave each out unless the turn shows it.
"attitude":"suspects" on a belief when the holder only suspects it. A suspicion the story later confirms is revised with "attitude":"believes" or "attitude":"knows".
"negated":true on a knowledge or belief when the holder holds that the statement is not so. Write the statement itself plainly and let negated carry the "not".
"intent":"honest" or "intent":"deceptive" on a knowledge with reported acquisition, or on a belief with informantIds, only when the narration makes plain whether the teller meant it. A lie told to someone is a belief for them with intent deceptive. The hearer never learns the intent from this field.
"toldFrom":"#2" names the teller's own record in currentPerspectiveState that they passed on. When the hearer took it differently, write what the hearer understood and still name the teller's record.
"premises":["#1","#4"] on an inferred knowledge or belief names the holder's own records in currentPerspectiveState it was reasoned from.
"sharedWith":["id"] on a secret names those its holder knowingly keeps it with; telling anyone else is a breach.
"heldById":"id" on a belief records what the subject thinks another character holds: the proposition is what they think that character knows or believes, with negated when they think that character does not know it. Record this only when it will shape what the subject says, does or hides later.`;

function buildMechanicsSystemPrompt(domains, languageInstruction = '', withStartingProfile = false, withMaximum = false) {
    return [
        languageInstruction,
        NARRATIVE_MECHANICS_BASE_PROMPT,
        domains.includes('entity') ? NARRATIVE_ENTITY_SCOPED_PROMPT : null,
        domains.includes('entity') && withStartingProfile ? NARRATIVE_STARTING_PROFILE_PROMPT : null,
        domains.includes('scene') ? NARRATIVE_SCENE_SCOPED_PROMPT : null,
        domains.includes('resource') ? NARRATIVE_RESOURCE_SCOPED_PROMPT : null,
        domains.includes('resource') && withMaximum ? NARRATIVE_RESOURCE_MAXIMUM_PROMPT : null,
        domains.includes('condition') ? NARRATIVE_CONDITION_SCOPED_PROMPT : null,
        domains.includes('inventory') ? NARRATIVE_INVENTORY_SCOPED_PROMPT : null,
        `Selected domains: ${domains.join(', ')}.`
    ].filter(Boolean).join('\n\n');
}

// The same text every turn, so the provider keeps it cached; the turn's domains travel in turnState.
function buildStoryRecordSystemPrompt(languageInstruction = '') {
    return [
        languageInstruction,
        NARRATIVE_STORY_RECORD_PROMPT,
        NARRATIVE_EPISTEMIC_SCOPED_PROMPT,
        NARRATIVE_STORY_REFS_PROMPT,
        NARRATIVE_STORY_NUANCE_PROMPT
    ].filter(Boolean).join('\n\n');
}

// With Narrative State diagnostics on, every call is kept as sent and as answered, failures included,
// so a turn that went wrong on a local model can be read back exactly.
async function sendNarrativeJson(requestParams, schema, label, telemetry) {
    const legend = telemetry?.calls ? telemetry.labels?.legendFor(requestParams.newPrompt) : null;
    const startedAt = Date.now();
    if (telemetry) telemetry.fallbackReason = null;
    const record = outcome => telemetry?.calls?.push({
        stage: label,
        mode: telemetry.structuredOutputMode,
        elapsedMs: Date.now() - startedAt,
        ...(telemetry.fallbackReason ? { fallbackReason: telemetry.fallbackReason } : {}),
        systemPrompt: capDebugText(requestParams.systemPrompt, REQUEST_TEXT_LIMIT),
        input: capDebugText(requestParams.newPrompt, REQUEST_TEXT_LIMIT),
        ...(legend?.length ? { legend } : {}),
        ...outcome
    });
    for (let attempt = 0; ; attempt += 1) {
        try {
            const response = await requestNarrativeJson(requestParams, schema, label, telemetry);
            record({
                response: capDebugText(response, REQUEST_TEXT_LIMIT),
                inputTokens: estimateTokens(requestParams.systemPrompt) + estimateTokens(requestParams.newPrompt),
                outputTokens: estimateTokens(response)
            });
            return response;
        } catch (error) {
            const retry = isConnectionFailure(error) && attempt < NARRATIVE_CONNECTION_RETRY_DELAYS_MS.length;
            record({ error: error.message || String(error), ...(retry ? { retried: true } : {}) });
            if (!retry) throw error;
            await new Promise(resolve => setTimeout(resolve, NARRATIVE_CONNECTION_RETRY_DELAYS_MS[attempt]));
        }
    }
}

// A dropped connection is asked again before the pass fails; a provider's refusal is not.
const NARRATIVE_CONNECTION_RETRY_DELAYS_MS = [2000, 6000];

// Both calls open with a fixed system prompt, so it is offered for caching on every route; what the
// provider reports counts for the Narrative State stage.
async function requestNarrativeJson(requestParams, schema, label, telemetry) {
    const { cacheScope, ...request } = requestParams;
    const workspaceId = String(cacheScope || '').split('::')[0];
    const params = {
        ...request,
        promptCache: cacheScope && isPromptCacheEnabled() ? {
            policy: 'conversation',
            placement: 'system',
            scopeId: cacheScope,
            stable: request.systemPrompt,
            volatile: '',
            ttl: cacheTtlForPace(recentTurnGaps(workspaceId))
        } : null,
        onUsage: metadata => { if (telemetry) addCacheUsage(telemetry.cache, metadata); }
    };
    const capabilityBase = `${params.apiProfileId || 'profile'}\u0000${params.model || 'model'}`;
    const schemaKind = schema === NARRATIVE_TRIAGE_SCHEMA ? 'triage' : schema === NARRATIVE_MECHANICS_SCHEMA ? 'state' : schema === NARRATIVE_STORY_SCHEMA ? 'story' : 'other';
    const globalCapabilityKey = `${capabilityBase}\u0000all`;
    const schemaCapabilityKey = `${capabilityBase}\u0000${schemaKind}`;
    if (narrativeStructuredOutputUnavailable.has(globalCapabilityKey)
        || narrativeStructuredOutputUnavailable.has(schemaCapabilityKey)) {
        if (telemetry) {
            telemetry.structuredOutputMode = 'prompt-cached';
            telemetry.fallbackReason = 'refused earlier in this session';
        }
        return sendApiRequest({ ...params, jsonMode: false, jsonSchema: null });
    }
    // Why a provider refused the schema is what decides whether the schema or the provider needs fixing.
    const noteFallback = reason => {
        telemetry.fallbackReason = String(reason || 'unknown').slice(0, 500);
        telemetry.structuredFallbackReasons?.push({ stage: label, reason: telemetry.fallbackReason });
    };
    const onStructuredFallback = ({ remembered, reason }) => {
        if (!telemetry) return;
        if (remembered) {
            telemetry.structuredOutputMode = 'prompt-cached';
            telemetry.fallbackReason = 'refused earlier in this session';
            return;
        }
        telemetry.structuredFallbacks += 1;
        telemetry.structuredFallbackStages.push(label);
        telemetry.structuredOutputMode = 'prompt-fallback';
        noteFallback(reason);
    };
    try {
        return await sendApiRequest({ ...params, jsonMode: true, jsonSchema: schema, onStructuredFallback });
    } catch (error) {
        const errorText = String(error.message || '');
        if (!/response.?format|json.?mode|structured output|output_config.*(unsupported|not supported)|compiled grammar.*too large|tool schemas?.*too large/i.test(errorText)) {
            throw error;
        }
        console.warn(`[${label}] Structured output unavailable; retrying with prompt validation:`, error.message);
        // A refused schema says nothing about the others, so only a refused format disables them all.
        const isSchemaFailure = /schema|compiled grammar/i.test(errorText);
        narrativeStructuredOutputUnavailable.add(isSchemaFailure ? schemaCapabilityKey : globalCapabilityKey);
        if (telemetry) {
            telemetry.structuredFallbacks += 1;
            telemetry.structuredFallbackStages.push(label);
            telemetry.structuredOutputMode = 'prompt-fallback';
            noteFallback(errorText);
        }
        return sendApiRequest({ ...params, jsonMode: false, jsonSchema: null });
    }
}

function repairNarrativeJson({ executor, invalidResponse, schema, label, telemetry, languageInstruction = '', maxPayloadTokens = null }) {
    return sendNarrativeJson({
        maxPayloadTokens,
        apiProfileId: executor.apiProfileId,
        model: executor.model,
        systemPrompt: languageInstruction
            ? `${languageInstruction}\n${NARRATIVE_REPAIR_SYSTEM_PROMPT}`
            : NARRATIVE_REPAIR_SYSTEM_PROMPT,
        chatHistory: [],
        newPrompt: `INVALID RESPONSE:\n${String(invalidResponse || '').slice(0, 16000)}`,
        temperature: 0,
        maxTokens: 8192,
        manualMode: false,
        manualJson: null
    }, schema, `${label} repair`, telemetry);
}

/**
 * What the quality gate refused, grouped so a turn can say why it recorded nothing. Without
 * this a campaign that suddenly stops storing anything looks identical to a quiet campaign.
 */
function summarizeNarrativeRejections(rejections) {
    const counts = new Map();
    for (const rejection of rejections) {
        const key = `${rejection.type}:${rejection.reason}`;
        counts.set(key, (counts.get(key) || 0) + 1);
    }
    return [...counts.entries()]
        .sort((left, right) => right[1] - left[1])
        .map(([key, count]) => ({ key, count }));
}

function resolveNarrativeEntityReferences(value, resolveReference) {
    const clone = JSON.parse(JSON.stringify(value || {}));
    const singular = ['entityId', 'subjectId', 'sourceEntityId', 'targetEntityId', 'locationId', 'fromLocationId', 'itemId', 'holderId', 'fromHolderId', 'toHolderId'];
    const plural = ['participantIds', 'possibleObserverIds', 'nearbyIds', 'objectIds', 'entityIds'];
    const visit = current => {
        if (!current || typeof current !== 'object') return;
        if (Array.isArray(current)) return current.forEach(visit);
        for (const [key, item] of Object.entries(current)) {
            if (singular.includes(key) && typeof item === 'string') current[key] = resolveReference(item);
            else if (plural.includes(key) && Array.isArray(item)) current[key] = item.map(entry => typeof entry === 'string' ? resolveReference(entry) : entry);
            else visit(item);
        }
    };
    visit(clone);
    return clone;
}

/**
 * The journey's band from the location graph and the Time Cost Matrix. The floor always applies to a
 * move; the ceiling only when the triage says the move was all the turn did and no span was stated.
 */
function resolveTravelBounds({ startLocationId, endLocationId, locationLinks, locationSizes, timeMatrix, timeAdvance }) {
    const category = travelCategory(startLocationId, endLocationId, locationLinks || [], locationSizes);
    if (!category) return { category: null, floorMinutes: 0, ceilingMinutes: 0 };
    const calendar = require('./features/worldbuild/calendar-service');
    const floorMinutes = calendar.matrixMinimumMinutes(timeMatrix, category)
        || calendar.matrixMinimumMinutes(timeMatrix, 'local');
    const onlyMoving = timeAdvance?.movementOnly === true && !timeAdvance.statedSpan
        && timeAdvance.basis !== 'explicit' && !timeAdvance.targetPosition;
    const ceilingMinutes = onlyMoving ? Math.max(floorMinutes, calendar.matrixMaximumMinutes(timeMatrix, category)) : 0;
    return { category, floorMinutes, ceilingMinutes };
}

/** "Kitchen (spot), within Inn (place), within Old Harbor (area)", with sizes the map implies. */
function describeSceneLocationChain(workspaceId, locationId, sizes) {
    if (!locationId) return undefined;
    const chain = loadLocationChain(db, workspaceId, locationId);
    return describeLocationChain(chain.map(node => ({ ...node, size: node.size || sizes.get(node.id) || null }))) || undefined;
}

function resolveNarrativeTimeAdvance({ timeAdvance, startClock, calendar, userMessage, narrativeResponse }) {
    const calendarService = require('./features/worldbuild/calendar-service');
    // A span asserted as passing now moves the clock even when the estimate is smaller.
    const { statedSpan, check: spanCheck } = calendarService.resolveStatedSpan(calendar, {
        claimedSpan: timeAdvance?.statedSpan,
        sourceText: `${userMessage || ''}
${narrativeResponse || ''}`
    });
    // The clock parser only reads the current day, so a stated skip of a day or more outranks it.
    const spansDays = Boolean(statedSpan) && statedSpan.minutes >= calendar.hoursPerDay * 60;
    const responseTarget = spansDays ? null : calendarService.extractClockTarget(narrativeResponse, startClock, calendar);
    const requestedTarget = spansDays
        ? null
        : responseTarget || calendarService.extractClockTarget(userMessage, startClock, calendar, true);
    if (!requestedTarget && !timeAdvance && !statedSpan) return null;
    const current = timeAdvance && typeof timeAdvance === 'object' && !Array.isArray(timeAdvance)
        ? { ...timeAdvance }
        : {
            actionType: statedSpan ? 'stated_time_skip' : 'explicit_clock_progression',
            basis: 'matrix',
            duration: { years: 0, months: 0, days: 0, hours: 0, minutes: 0 },
            confidence: 1,
            evidence: statedSpan?.evidence || ''
        };
    if (requestedTarget) {
        current.basis = 'explicit';
        current.targetPosition = requestedTarget;
        current.evidence = current.evidence || 'Explicit narrative clock position.';
    } else if (!Object.hasOwn(current, 'targetPosition')) {
        current.targetPosition = null;
    }
    if (statedSpan) current.statedSpan = statedSpan;
    else delete current.statedSpan;
    if (spanCheck) current.spanCheck = spanCheck;
    return current;
}

function hasPlayerInventoryAction(text, itemName) {
    const normalized = normalizeInventoryText(text);
    const primaryTerm = normalizeInventoryText(itemName).match(/[a-z0-9]+/g)?.find(term => term.length >= 4);
    if (!primaryTerm || !normalized.includes(primaryTerm)) return false;
    return /\b(?:i|my)\b/.test(normalized);
}

function normalizeNarrativeInventoryPatch(value, currentInventoryState, currentLocationInventoryState = [], context = {}) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
        throw new Error('Inventory changes must be objects.');
    }
    const patch = { ...value };
    if (patch.equipped !== undefined) {
        if (typeof patch.equipped === 'string') {
            const normalized = patch.equipped.trim().toLowerCase();
            if (normalized === 'true' || normalized === 'false') patch.equipped = normalized === 'true';
            else delete patch.equipped;
        } else {
            patch.equipped = Boolean(patch.equipped);
        }
    }
    if (patch.quantity !== undefined) patch.quantity = Math.round(Number(patch.quantity));
    const inventoryItem = [...(currentInventoryState || []), ...(currentLocationInventoryState || [])]
        .find(item => item.itemId === patch.itemId);
    if (inventoryItem?.itemName && hasPlayerInventoryAction(context.userMessage, inventoryItem.itemName)) {
        for (const key of ['fromHolderId', 'holderId']) {
            if (!patch[key] || patch[key] === context.playerEntityId) continue;
            const playerHasItem = (currentInventoryState || []).some(item =>
                item.itemId === patch.itemId && item.holderId === context.playerEntityId
            );
            if (!playerHasItem) throw new Error('Inventory source conflicts with explicit player action evidence.');
            patch[key] = context.playerEntityId;
        }
    }
    const playerOwnsAction = patch.holderId === context.playerEntityId
        || patch.fromHolderId === context.playerEntityId
        || (patch.toHolderId === context.playerEntityId && patch.fromLocationId);
    const actionText = playerOwnsAction
        ? context.userMessage
        : context.narrativeResponse;
    const inferredEquipmentState = inferNarrativeEquipmentState(actionText, inventoryItem?.itemName);
    if (inferredEquipmentState !== null) patch.equipped = inferredEquipmentState;
    if (patch.fromHolderId && patch.equipped === undefined) {
        const sourceIsEquipped = (currentInventoryState || []).some(item =>
            item.itemId === patch.itemId
            && item.holderId === patch.fromHolderId
            && item.equipped === true
        );
        if (sourceIsEquipped) patch.equipped = false;
    }
    return patch;
}

function normalizeInventoryText(value) {
    return String(value || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase();
}

function lastPatternIndex(text, patterns) {
    return patterns.reduce((lastIndex, pattern) => {
        const matches = text.matchAll(pattern);
        for (const match of matches) lastIndex = Math.max(lastIndex, match.index ?? -1);
        return lastIndex;
    }, -1);
}

function inferNarrativeEquipmentState(text, itemName) {
    if (!itemName || !text) return null;
    const normalizedText = normalizeInventoryText(text);
    const itemTerms = normalizeInventoryText(itemName).match(/[a-z0-9]+/g) || [];
    const primaryTerm = itemTerms.find(term => term.length >= 4) || itemTerms[0];
    if (!primaryTerm) return null;
    const itemIndex = normalizedText.lastIndexOf(primaryTerm);
    if (itemIndex < 0) return null;

    const windowStart = Math.max(0, itemIndex - 180);
    const windowEnd = Math.min(normalizedText.length, itemIndex + 220);
    const actionWindow = normalizedText.slice(windowStart, windowEnd);
    const equipPatterns = [
        /\b(?:draw\w*|drew|wield\w*|brandish\w*)\b/g,
        /\b(?:hold\w*|held|grip\w*)\b.{0,90}\bhand\b/g,
        /\b(?:in|on)\s+(?:my|your|his|her|the)?\s*hand\b/g,
        /\b(?:wear\w*|wore|put on|equip\w*)\b/g,
        /\bdraw\w*\b.{0,100}\bfrom\s+(?:belt|waist|scabbard|sheath|holster)\b/g
    ];
    const unequipPatterns = [
        /\b(?:sheathe\w*|stow\w*|store\w*|put away|put back)\b/g,
        /\bput\b.{0,100}\b(?:belt|waist|scabbard|sheath|holster|inventory|bag|pack|pocket)\b/g,
        /\b(?:remov\w*|take off|took off)\b.{0,90}\b(?:hand|body|armor|helmet)\b/g
    ];
    const equipIndex = lastPatternIndex(actionWindow, equipPatterns);
    const unequipIndex = lastPatternIndex(actionWindow, unequipPatterns);
    if (equipIndex < 0 && unequipIndex < 0) return null;
    return unequipIndex > equipIndex;
}

function buildNarrativeScenePatch(currentScene, rawPatch, introductions, narrativeSignals = {}, { triageMarkedScene = false } = {}) {
    const patch = {};
    const source = rawPatch && typeof rawPatch === 'object' && !Array.isArray(rawPatch) ? rawPatch : {};
    if (Object.hasOwn(source, 'locationId') && (source.locationId === null || typeof source.locationId === 'string')) {
        patch.locationId = source.locationId;
    }
    for (const key of ['participantIds', 'possibleObserverIds', 'nearbyIds', 'objectIds']) {
        if (Array.isArray(source[key])) patch[key] = [...new Set(source[key].filter(value => typeof value === 'string' && value))];
    }

    const presenceFields = {
        participant: 'participantIds',
        observer: 'possibleObserverIds',
        nearby: 'nearbyIds'
    };
    for (const introduction of introductions || []) {
        const targetField = presenceFields[introduction.proposal?.scenePresence];
        if (!targetField) continue;
        for (const key of ['participantIds', 'possibleObserverIds', 'nearbyIds']) {
            const values = [...(patch[key] ?? currentScene?.[key] ?? [])].filter(id => id !== introduction.entityId);
            if (key === targetField) values.push(introduction.entityId);
            patch[key] = [...new Set(values)];
        }
    }

    if (Object.hasOwn(patch, 'locationId') && patch.locationId === (currentScene?.locationId ?? null)) delete patch.locationId;
    const hasCompletedMovement = (narrativeSignals.signals || []).some(signal =>
        signal.domain === 'scene' && signal.action === 'movement'
    );
    // The movement words are English; a triage that marked the scene judged a completed move in any language.
    if (Object.hasOwn(patch, 'locationId') && !hasCompletedMovement && !triageMarkedScene) delete patch.locationId;
    for (const key of ['participantIds', 'possibleObserverIds', 'nearbyIds', 'objectIds']) {
        if (Object.hasOwn(patch, key) && sameIdSet(patch[key], currentScene?.[key] ?? [])) delete patch[key];
    }
    return patch;
}

function buildNarrativeInitialContactEvents({
    workspaceId,
    playerEntityId,
    participantIds,
    introductions,
    identityContacts,
    actorIds,
    relationshipPairs,
    awarenessPairs
}) {
    const events = [];
    const seenEntityIds = new Set();
    const participantSet = new Set(participantIds || []);
    const relationshipPairSet = new Set(relationshipPairs || []);
    const awarenessPairSet = new Set(awarenessPairs || []);
    const candidates = [
        ...(introductions || []).map(introduction => ({
            entityId: introduction.entityId,
            name: introduction.proposal?.name,
            description: introduction.proposal?.description,
            excerpt: introduction.proposal?.excerpt,
            confidence: introduction.proposal?.confidence,
            scenePresence: introduction.proposal?.scenePresence,
            isNew: true
        })),
        ...(identityContacts || []).map(identity => ({
            entityId: identity.entityId,
            name: null,
            description: identity.reason,
            excerpt: identity.excerpt,
            confidence: identity.confidence,
            scenePresence: 'participant',
            isNew: false
        }))
    ];
    for (const candidate of candidates) {
        const entityId = candidate.entityId;
        const isActor = actorIds.has(entityId);
        if (!entityId || seenEntityIds.has(entityId) || (!isActor && !candidate.isNew)) continue;
        if (candidate.isNew && candidate.scenePresence !== 'participant') {
            if (!candidate.description && !candidate.excerpt) continue;
        } else if (!participantSet.has(entityId)) {
            continue;
        }
        seenEntityIds.add(entityId);
        const operations = [];
        if (candidate.isNew) {
            operations.push({
                type: 'fact',
                proposition: {
                    subjectId: entityId,
                    predicate: 'narrative-introduction',
                    object: candidate.description || `${candidate.name || 'An individual'} enters the narrative.`
                },
                category: 'identity',
                confidence: clampNarrativeConfidence(candidate.confidence)
            });
        }
        const participantIdsForEvent = [entityId];
        if (isActor && playerEntityId && playerEntityId !== entityId && participantSet.has(entityId)) {
            participantIdsForEvent.push(playerEntityId);
            appendInitialAwarenessOperation(operations, awarenessPairSet, playerEntityId, entityId, candidate.confidence);
            appendInitialAwarenessOperation(operations, awarenessPairSet, entityId, playerEntityId, candidate.confidence);
            appendInitialRelationshipOperation(
                workspaceId,
                operations,
                relationshipPairSet,
                entityId,
                playerEntityId,
                playerEntityId
            );
        }
        if (!operations.length) continue;
        const label = candidate.name || 'An existing character';
        events.push({
            type: 'custom',
            description: candidate.isNew
                ? candidate.description || `${label} is introduced to the scene.`
                : `${label} is introduced to the controlled character.`,
            excerpt: candidate.excerpt || candidate.description || label,
            participantIds: [...new Set(participantIdsForEvent)],
            confidence: clampNarrativeConfidence(candidate.confidence),
            operations
        });
    }
    return events;
}

// Two participants who heard each other speak this turn become aware of each other. The player
// pairs go through the introduction path, and someone only nearby is left out on purpose.
function buildHeardContactEvents({ workspaceId, triage, participantIds, playerEntityId, actorIds, entityNames }) {
    const participants = new Set((participantIds || []).filter(id => id && id !== playerEntityId && actorIds.has(id)));
    const heard = new Set();
    for (const update of Array.isArray(triage?.sceneMemory) ? triage.sceneMemory : []) {
        if (!participants.has(update?.entityId)) continue;
        for (const line of update.heard || []) {
            if (participants.has(line?.fromId) && line.fromId !== update.entityId) heard.add(`${update.entityId}\u0000${line.fromId}`);
        }
    }
    const hasCard = db.prepare(`
        SELECT 1 FROM worldbuild_knowledge_cards
        WHERE workspace_id = ? AND owner_id = ? AND target_id = ? AND status = 'active'
    `);
    const events = new Map();
    for (const pair of heard) {
        const [listenerId, speakerId] = pair.split('\u0000');
        if (hasCard.get(workspaceId, listenerId, speakerId)) continue;
        const key = [listenerId, speakerId].sort().join('\u0000');
        const names = key.split('\u0000').map(id => entityNames.get(id) || id);
        const event = events.get(key) ?? {
            type: 'custom',
            description: `${names[0]} and ${names[1]} spoke within each other's hearing.`,
            excerpt: `${names[0]} / ${names[1]}`,
            participantIds: key.split('\u0000'),
            confidence: 0.9,
            operations: []
        };
        event.operations.push({ type: 'awareness', subjectId: listenerId, targetId: speakerId, confidence: 0.9 });
        events.set(key, event);
    }
    return [...events.values()];
}

function collectAwarenessPairs(events) {
    const pairs = new Set();
    for (const event of events || []) {
        for (const operation of event?.operations || []) {
            if (operation?.type === 'awareness' && operation.subjectId && operation.targetId) {
                pairs.add(`${operation.subjectId}\u0000${operation.targetId}`);
            }
        }
    }
    return pairs;
}

function appendInitialAwarenessOperation(operations, pairs, subjectId, targetId, confidenceValue) {
    if (!subjectId || !targetId || subjectId === targetId) return;
    const pair = `${subjectId}\u0000${targetId}`;
    if (pairs.has(pair) || operations.some(operation => operation?.type === 'awareness' && operation.subjectId === subjectId && operation.targetId === targetId)) return;
    operations.push({
        type: 'awareness',
        subjectId,
        targetId,
        confidence: clampNarrativeConfidence(confidenceValue)
    });
    pairs.add(pair);
}

function clampNarrativeConfidence(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.max(0, Math.min(1, numeric)) : 0.9;
}

function ensureEncounterRelationshipOperations(workspaceId, events, playerEntityId = null) {
    const resolvedEvents = Array.isArray(events) ? events : [];
    const pairs = collectRelationshipPairs(resolvedEvents);
    for (const event of resolvedEvents) {
        if (!Array.isArray(event.operations)) continue;
        const additions = [];
        for (const operation of event.operations) {
            if (operation?.type !== 'awareness') continue;
            appendInitialRelationshipOperation(
                workspaceId,
                additions,
                pairs,
                operation.subjectId,
                operation.targetId,
                playerEntityId
            );
        }
        event.operations.push(...additions);
    }
    return resolvedEvents;
}

function collectRelationshipPairs(events) {
    const pairs = new Set();
    for (const event of events || []) {
        for (const operation of event?.operations || []) {
            if (operation?.type === 'relationship' && operation.sourceEntityId && operation.targetEntityId) {
                pairs.add(`${operation.sourceEntityId}\u0000${operation.targetEntityId}`);
            }
        }
    }
    return pairs;
}

function appendInitialRelationshipOperation(workspaceId, operations, pairs, sourceEntityId, targetEntityId, excludedSourceId = null) {
    if (!sourceEntityId || !targetEntityId || sourceEntityId === targetEntityId || sourceEntityId === excludedSourceId) return;
    const pair = `${sourceEntityId}\u0000${targetEntityId}`;
    if (pairs.has(pair) || hasStoredRelationship(workspaceId, sourceEntityId, targetEntityId)) return;
    operations.push({
        type: 'relationship',
        sourceEntityId,
        targetEntityId,
        dimension: 'overall',
        value: 0,
        // Meeting someone is the cause here, and naming it keeps this generated operation in
        // the same vocabulary the quality gate holds every other relationship change to.
        cause: 'first-impression',
        impact: 'meaningful'
    });
    pairs.add(pair);
}

function hasStoredRelationship(workspaceId, sourceEntityId, targetEntityId) {
    return Boolean(db.prepare(`
        SELECT 1 FROM entity_links
        WHERE workspaceId = ? AND fromId = ? AND relType = 'related_to' AND toId = ?
        LIMIT 1
    `).get(workspaceId, sourceEntityId, targetEntityId));
}

function sameIdSet(left, right) {
    const leftIds = [...new Set(left || [])];
    const rightIds = [...new Set(right || [])];
    return leftIds.length === rightIds.length && leftIds.every(id => rightIds.includes(id));
}

function chunkValues(values, size) {
    const chunks = [];
    for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
    return chunks;
}

// Choice values are stored as opaque ids; the model reads and answers with labels.
function choiceOptionLabels(field, value) {
    if (field.valueType !== 'single-choice' && field.valueType !== 'multiple-choice') return value;
    const label = id => field.options.find(option => option.id === id)?.label || id;
    return Array.isArray(value) ? value.map(label) : label(value);
}

// A value still equal to the template default was set by the template, not by the sources, so the
// model is told it may replace it.
function customFieldState(field, entity, emptyFields) {
    if (emptyFields.includes(`customFields.${field.key}`)) return 'EMPTY';
    const value = entity.data?.customFields?.[field.key];
    if (Object.hasOwn(field, 'defaultValue') && JSON.stringify(value) === JSON.stringify(field.defaultValue)) {
        return 'TEMPLATE DEFAULT, replace it when the sources establish another value';
    }
    return 'CURRENT VALUE PRESENT';
}

function customFieldPromptShape(field) {
    if (field.valueType === 'boolean') return 'true or false';
    if (field.valueType === 'number' || field.valueType === 'range') return 'a JSON number';
    if (field.valueType === 'multiple-choice') return `an array using only [${field.options.map(option => option.label).join(', ')}]`;
    if (field.valueType === 'single-choice') return `one of [${field.options.map(option => option.label).join(', ')}]`;
    if (field.valueType === 'entity-reference-list') return 'an array of exact existing entity names';
    if (field.valueType === 'entity-reference') return 'one exact existing entity name';
    return 'a concise literal string';
}

function normalizeCustomProposalValue(value, field, workspaceId) {
    if (field.valueType === 'boolean') {
        if (typeof value === 'boolean') return value;
        if (String(value).toLowerCase() === 'true') return true;
        if (String(value).toLowerCase() === 'false') return false;
        return undefined;
    }
    if (field.valueType === 'number' || field.valueType === 'range') {
        const number = Number(value);
        return Number.isFinite(number) ? number : undefined;
    }
    if (field.valueType === 'single-choice') {
        const option = field.options.find(candidate => candidate.id === value || candidate.label.toLowerCase() === String(value).toLowerCase());
        return option?.id;
    }
    if (field.valueType === 'multiple-choice') {
        if (!Array.isArray(value)) return undefined;
        const selected = value.map(item => field.options.find(candidate => candidate.id === item || candidate.label.toLowerCase() === String(item).toLowerCase())?.id);
        return selected.every(Boolean) ? [...new Set(selected)] : undefined;
    }
    if (field.valueType === 'entity-reference') return entitiesStore.resolveMention(String(value || ''), null, workspaceId) || undefined;
    if (field.valueType === 'entity-reference-list') {
        if (!Array.isArray(value)) return undefined;
        const ids = value.map(item => entitiesStore.resolveMention(String(item || ''), null, workspaceId));
        return ids.every(Boolean) ? [...new Set(ids)] : undefined;
    }
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function describeStructuredObjectFailure(response, fence) {
    const raw = String(response || '').trim();
    if (!raw) return 'The System AI returned an empty response.';
    const hasOpenFence = raw.includes(fence.open);
    const hasCloseFence = raw.includes(fence.close);
    const firstBrace = raw.indexOf('{');
    const lastBrace = raw.lastIndexOf('}');
    if (firstBrace === -1) return 'The System AI response did not contain a JSON object.';
    if (lastBrace < firstBrace) return 'The System AI response was truncated before the JSON object was complete.';
    try {
        JSON.parse(raw.slice(firstBrace, lastBrace + 1));
    } catch (error) {
        return `The System AI returned invalid JSON: ${cleanErrorMessage(error)}`;
    }
    if (hasOpenFence && !hasCloseFence) return 'The System AI response was truncated before the structured update was closed.';
    return 'The System AI response used an unsupported structured update shape.';
}

// When a full rewrite would not fit the output limit, lore is appended instead.
const LORE_REWRITE_OVERHEAD_TOKENS = 600;

function loreNeedsAppend(currentLore, outputTokens) {
    const lore = String(currentLore || '').trim();
    if (!lore) return false;
    return Math.ceil(estimateTokens(lore) * 1.15) + LORE_REWRITE_OVERHEAD_TOKENS > outputTokens;
}

// Dense evidence, such as a whole character profile, yields many changes at once, so the
// allowance grows with the evidence as well as with the lore it may rewrite.
function entityEnrichmentMaxTokens(entity, evidenceTokens = 0) {
    const currentLoreLength = String(entity.type === 'System' ? entity.data?.content || '' : entity.lore || '').length;
    const minimum = entity.type === 'System' ? 2400 : 1800;
    const maximum = 12000;
    return Math.min(maximum, Math.max(minimum, 1200 + Math.ceil(currentLoreLength / 3.5) + Math.ceil(evidenceTokens * 1.5)));
}

// Usually the output budget, not formatting: reasoning models spend it thinking. `budget` and
// `empty` are retried with a bigger allowance, the others with the same one.
function describeEntityUpdateFailure(result, parsed, fence) {
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
    return { cause: 'format', message: describeStructuredObjectFailure(content, fence) };
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

const PLACE_LINKS = new Set(['livesIn', 'worksAt']);

// Where someone lives or works must be named by its own support; a city chosen over a place inside
// it that the support also names moves to the inner place, the most specific one.
function placeLinkTarget({ targetId, support, candidates }) {
    const target = entitiesStore.getEntity(targetId);
    if (!target || !textMentionsEntity(support, entityMentionNames(target))) return null;
    if (target.type !== 'Locations') return target;
    const parentOf = id => entitiesStore.getLinksFrom(id, 'inside')[0]?.entity?.id || null;
    const depthInside = id => {
        let depth = 0;
        for (let at = parentOf(id); at && depth < 12; at = parentOf(at)) {
            depth += 1;
            if (at === targetId) return depth;
        }
        return 0;
    };
    let best = target, bestDepth = 0;
    for (const candidate of candidates) {
        if (candidate.type !== 'Locations' || candidate.id === targetId || !textMentionsEntity(support, entityMentionNames(candidate))) continue;
        const depth = depthInside(candidate.id);
        if (depth > bestDepth) { best = candidate; bestDepth = depth; }
    }
    return best;
}

// `from: 'target'` means the edge starts at the linked entity. Enrichment only links
// existing entities; it never creates them.
const ENRICH_RELATIONS = {
    Characters: [
        { key: 'race',          label: 'Race',         relType: 'is_race',      targetType: 'Races',      from: 'self',   single: true },
        { key: 'factions',      label: 'Faction',      relType: 'member_of',    targetType: 'Factions',   from: 'self',   single: false },
        { key: 'livesIn',       label: 'Lives in',     relType: 'lives_in',     targetType: 'Locations',  from: 'self',   single: true },
        { key: 'worksAt',       label: 'Works at',     relType: 'works_at',     targetTypes: ['Locations', 'Factions'], from: 'self', single: false, labeled: true, roleMeaning: 'the job SOURCE does there, in one to three words' },
        { key: 'locations',     label: 'Tied to',      relType: 'connected_to', targetType: 'Locations',  from: 'self',   single: false },
        { key: 'relationships', label: 'Relationship', relType: 'related_to', targetTypes: ['Characters', 'Creatures'], from: 'self', single: false, labeled: true, detailed: true },
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
        // A specific being's species is the same edge as a character's race, pointing at a species sheet.
        { key: 'species', label: 'Species', relType: 'is_race', targetType: 'Creatures', targetScope: 'group', from: 'self', single: true, individualOnly: true },
        { key: 'factions', label: 'Faction', relType: 'member_of', targetType: 'Factions', from: 'self', single: false, individualOnly: true },
        { key: 'relationships', label: 'Relationship', relType: 'related_to', targetTypes: ['Characters', 'Creatures'], from: 'self', single: false, labeled: true, detailed: true, individualOnly: true },
    ],
    Factions: [
        { key: 'leader',     label: 'Leader',            relType: 'led_by',      targetTypes: ['Characters', 'Creatures'], from: 'self',   single: true },
        { key: 'operatesIn', label: 'Area of operation', relType: 'operates_in', targetType: 'Locations',  from: 'self',   single: false },
        { key: 'members',    label: 'Member',            relType: 'member_of',   targetTypes: ['Characters', 'Creatures'], from: 'target', single: false, labeled: true },
        // The sheet's Relations: how the group stands toward another group or a person.
        { key: 'relationships', label: 'Relation', relType: 'related_to', targetTypes: ['Factions', 'Characters', 'Creatures'], from: 'self', single: false, labeled: true, detailed: true },
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

// What a related_to edge already says, read from the entity whose perspective it is.
function currentRelationship(ownerId, targetId) {
    const link = entitiesStore.getLinksFrom(ownerId, 'related_to').find(row => row.entity?.id === targetId);
    return link ? { title: link.label || '', value: Number(link.metadata?.value || 0), description: String(link.metadata?.description || '') } : null;
}

async function submitEntityNarrativeSuggestions({ workspaceId, entity, changes, allEntities, evidenceEntries, interpreterId, memoryIndex }) {
    if (!Array.isArray(changes) || !changes.length) return null;
    const entityByName = new Map();
    for (const candidate of allEntities) {
        for (const name of [candidate.canonicalName, ...(candidate.aliases || [])]) {
            const normalized = entitiesStore.normalizeName(name);
            if (normalized) entityByName.set(normalized, candidate.id);
        }
    }
    const entityIds = new Set(allEntities.map(candidate => candidate.id));
    const resolveTarget = (id, name) => entityIds.has(id) ? id : entityByName.get(entitiesStore.normalizeName(name)) || null;
    // The same scene, told again in any words, is not a new memory; held and pending memories both count.
    const isKnownMemory = async (ownerId, summary) => (await memoryIndex.isDuplicate(ownerId, summary)).duplicate;
    const operationsByOwner = new Map();
    const memoryScenes = new Set();
    const evidenceText = new Map(evidenceEntries.map(entry => [entry.id, String(entry.chunk.text || '')]));
    const ownerEntity = new Map(allEntities.map(candidate => [candidate.id, candidate]));
    // A memory needs its owner in the scene: one the cited passages never name was not there.
    // The first memory for an owner and scene stands; later ones split the same moment.
    const acceptsMemory = (ownerId, evidenceIds) => {
        const owner = ownerEntity.get(ownerId);
        const cited = (evidenceIds || []).filter(id => evidenceText.has(id));
        if (!owner || !cited.length) return false;
        if (owner.id !== entity.id && !cited.some(id => textMentionsEntity(evidenceText.get(id), entityMentionNames(owner)))) return false;
        const scene = `${ownerId}\u0000${cited.slice().sort()[0]}`;
        if (memoryScenes.has(scene)) return false;
        memoryScenes.add(scene);
        return true;
    };
    for (const change of changes) {
        if (entity.type === 'Characters' && change.kind === 'fact') continue;
        const validation = validateNarrativeChange(change, entity.id, entityIds);
        if (!validation.valid) continue;
        const ownerId = validation.ownerId;
        const operations = operationsByOwner.get(ownerId) || [];
        const accessibility = ['available', 'suppressed', 'inaccessible'].includes(change.accessibility) ? change.accessibility : 'available';
        const method = ['participant', 'witness', 'reported', 'inferred'].includes(change.method) ? change.method : 'reported';
        const confidence = change.kind === 'knowledge'
            ? (method === 'participant' || method === 'witness' ? 0.95 : 0.8)
            : 0.85;
        if (change.kind === 'fact' && change.value) {
            const aboutId = resolveTarget(change.targetId, change.target) || ownerId;
            operations.push({ type: 'fact', proposition: { subjectId: aboutId, predicate: change.key || 'worldbuild-statement', object: change.value }, confidence });
        } else if (change.kind === 'awareness') {
            const targetId = resolveTarget(change.targetId, change.target);
            if (targetId && targetId !== ownerId) operations.push({ type: 'awareness', subjectId: ownerId, targetId, confidence });
        } else if (change.kind === 'memory' && change.value) {
            if (await isKnownMemory(ownerId, change.value) || !acceptsMemory(ownerId, change.evidence)) continue;
            memoryIndex.remember(ownerId, change.value);
            const relatedId = resolveTarget(change.targetId, change.target);
            operations.push({ type: 'memory', subjectId: ownerId, summary: change.value, salience: 0.8, accessibility, relatedEntityIds: relatedId && relatedId !== ownerId ? [relatedId] : [] });
        } else if (change.kind === 'knowledge' || change.kind === 'belief') {
            const aboutId = resolveTarget(change.targetId, change.target) || ownerId;
            if (!aboutId || !change.value) continue;
            // What the subject did or lived through belongs to their memories, not to what they know
            // about the world: a character never learns their own deeds.
            if (change.kind === 'knowledge' && (aboutId === ownerId || method === 'participant')) {
                if (await isKnownMemory(ownerId, change.value) || !acceptsMemory(ownerId, change.evidence)) continue;
                memoryIndex.remember(ownerId, change.value);
                operations.push({ type: 'memory', subjectId: ownerId, summary: change.value, salience: 0.8, accessibility, relatedEntityIds: aboutId !== ownerId ? [aboutId] : [] });
                if (operations.length) operationsByOwner.set(ownerId, operations);
                continue;
            }
            const proposition = { subjectId: aboutId, predicate: 'worldbuild-statement', object: change.value };
            if (change.kind === 'knowledge') {
                operations.push({ type: 'knowledge', subjectId: ownerId, proposition, acquisition: method, confidence, accessibility });
            }
            else operations.push({ type: 'belief', subjectId: ownerId, proposition, confidence });
        } else if (change.kind === 'relationship') {
            const targetId = resolveTarget(change.targetId, change.target);
            if (!targetId || targetId === ownerId || !change.sourcePerspective) continue;
            const current = currentRelationship(ownerId, targetId);
            const title = normalizeRelationshipLabel(change.targetRole);
            if (!title && !current?.title) continue;
            const update = resolveRelationshipChange(current, {
                title,
                score: change.score,
                description: change.sourcePerspective,
                direction: change.direction,
                cause: change.cause,
                impact: change.impact,
            });
            if (!update) continue;
            const { cause, ...relationship } = update;
            operations.push({
                type: 'relationship',
                sourceEntityId: ownerId,
                targetEntityId: targetId,
                dimension: 'overall',
                ...relationship,
            });
        }
        if (operations.length) operationsByOwner.set(ownerId, operations);
    }
    if (!operationsByOwner.size) return null;
    const operationCount = [...operationsByOwner.values()].reduce((total, operations) => total + operations.length, 0);
    const evidenceIds = new Set(changes.flatMap(change => change.evidence || []));
    const excerpt = evidenceEntries
        .filter(entry => evidenceIds.has(entry.id))
        .map(entry => entry.chunk.text)
        .join('\n')
        .slice(0, 500);
    const allowedEntityIds = new Set(allEntities.map(candidate => candidate.id));
    const { NarrativeStateSystem } = require('../../dist-main/main/features/narrative/narrative-state');
    const narrativeState = new NarrativeStateSystem(db);
    const records = [];
    for (const [ownerId, operations] of operationsByOwner) {
        const owner = allEntities.find(candidate => candidate.id === ownerId);
        const result = narrativeState.createEvent({
            workspaceId,
            originId: `entity-update:${entity.id}:${ownerId}:${crypto.createHash('sha256').update(JSON.stringify(operations)).digest('hex').slice(0, 16)}`,
            interpreterId,
            originType: 'worldbuild-update',
            promptVersion: 'entity-update-v3',
            forceReview: true,
            allowedEntityIds,
            event: {
                type: 'custom',
                description: `Worldbuild update suggestions for ${owner?.canonicalName || entity.canonicalName}.`,
                excerpt,
                participantIds: [...new Set([ownerId, ...operations.flatMap(operation => operation.type === 'relationship' ? [operation.targetEntityId] : operation.proposition ? [operation.proposition.subjectId] : [])])],
                confidence: 0.85,
                operations,
            },
        });
        if (result.record) records.push(result.record);
    }
    return records.length ? { record: records[0], records, operationCount } : null;
}

// Creature targets are specific beings, unless the relation points at a species.
function relationCandidates(all, entity, spec) {
    const targetTypes = spec.targetTypes || [spec.targetType];
    const wantsGroup = spec.targetScope === 'group';
    return all.filter(candidate => candidate.status !== 'proposed'
        && candidate.id !== entity.id
        && targetTypes.includes(candidate.type)
        && (candidate.type !== 'Creatures' || ((candidate.data?.scope || 'individual') === 'group') === wantsGroup));
}

function resolveRelationTarget(name, spec, workspaceId) {
    for (const targetType of (spec.targetTypes || [spec.targetType])) {
        const targetId = entitiesStore.resolveMention(name, targetType, workspaceId);
        if (targetId) return targetId;
    }
    return null;
}

function existingLinksByTarget(entityId, spec) {
    const rows = spec.from === 'target'
        ? entitiesStore.getLinksTo(entityId, spec.relType)
        : entitiesStore.getLinksFrom(entityId, spec.relType);
    return new Map(rows.filter(row => row.entity?.id).map(row => [row.entity.id, row]));
}

// Create one proposed edge. `from` decides which end the entity sits on: 'target' means
// the edge runs from the linked entity into this one (e.g. an item owned_by a character),
// so we swap the endpoints. `single` clears any prior edge of that (fromId, relType).
function applyProposedLink(entityId, link, workspaceId) {
    if (link.existingLinkId) {
        entitiesStore.updateLink(link.existingLinkId, { label: link.label || null, metadata: link.metadata });
        return;
    }
    const fromId = link.from === 'target' ? link.targetId : entityId;
    const toId = link.from === 'target' ? entityId : link.targetId;
    entitiesStore.setLink({ workspaceId, fromId, relType: link.relType, toId, single: !!link.single, label: link.label || null, metadata: link.metadata });
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
    const tokenCost = entry => entry.tokenCount ?? (entry.tokenCount = estimateTokens(entry.prompt));
    const total = entries.reduce((sum, entry) => sum + tokenCost(entry), 0);
    if (total <= budget) return entries;
    const selected = [];
    const selectedIds = new Set();
    let used = 0;
    const headBudget = Math.floor(budget * 0.4);
    for (const entry of entries) {
        const cost = tokenCost(entry);
        if (used + cost > headBudget) break;
        selected.push(entry); selectedIds.add(entry.id); used += cost;
    }
    for (let index = entries.length - 1; index >= 0; index--) {
        const entry = entries[index];
        if (selectedIds.has(entry.id)) continue;
        const cost = tokenCost(entry);
        if (used + cost > budget) break;
        selected.push(entry); selectedIds.add(entry.id); used += cost;
    }
    return selected.sort((a, b) => a.order - b.order);
}

const WRITTEN_TEXT_FIELDS = new Set(['appearance', 'personality', 'description', 'abilities', 'content']);

function selectEntityEvidence(entries, budget = 5500) {
    const selectByStrength = (candidates, candidateBudget) => {
        const tagged = chronologicalSlice(candidates.filter(entry => entry.chunk.isTagged), candidateBudget);
        const used = tagged.reduce((sum, entry) => sum + (entry.tokenCount ?? estimateTokens(entry.prompt)), 0);
        if (used >= candidateBudget) return tagged;
        const untagged = chronologicalSlice(candidates.filter(entry => !entry.chunk.isTagged), candidateBudget - used);
        return [...tagged, ...untagged].sort((a, b) => a.order - b.order);
    };
    const fresh = entries.filter(entry => !entry.chunk.isDeferred);
    const deferred = entries.filter(entry => entry.chunk.isDeferred);
    const selectedFresh = selectByStrength(fresh, budget);
    const used = selectedFresh.reduce((sum, entry) => sum + (entry.tokenCount ?? estimateTokens(entry.prompt)), 0);
    if (used >= budget || !deferred.length) return selectedFresh;
    const deferredBudget = fresh.length ? Math.min(1000, budget - used) : budget - used;
    return [...selectedFresh, ...selectByStrength(deferred, deferredBudget)].sort((a, b) => a.order - b.order);
}

async function loadConstantMemoryChunks(workspaceId) {
    const row = db.prepare('SELECT memoryBlocks, knowledgeFiles FROM chats WHERE id = ?').get(workspaceId);
    if (!row) return [];
    const sources = [];
    try {
        for (const block of JSON.parse(row.memoryBlocks || '[]')) {
            if (block.strategy !== 'constant' || block.enabled === false) continue;
            sources.push({ key: `memory:${block.id}`, source: block.title || block.source || 'Constant Memory', text: block.summary || block.text || '', createdAt: block.createdAt || 0, isRecap: true });
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
        return { id, text, source: source.source, createdAt: source.createdAt + index, contentHash: crypto.createHash('sha256').update(text).digest('hex'), evidenceSource: 'Memory', isTagged: false, isRecap: Boolean(source.isRecap) };
    }));
}

// --- CREATE WITH AI: sources read into candidates, then filled like any entity update ---

// What the last reading found, per workspace, so applying never needs the passages sent back.
const sourceImportSessions = new Map();
// Imported passages are deleted when the fill ends, so a sheet keeps reading until none is left.
const MAX_EXTRA_ENTITY_PASSES = 3;

// Only names and types are read here; nothing is written until the list is applied.
async function discoverImportSources(workspaceId, sources, { onProgress = null, shouldCancel = null } = {}) {
    const { buildCandidates } = require('./features/worldbuild/source-import');
    const passages = [];
    for (const source of sources || []) {
        for (const unit of source.units || []) passages.push({ ...unit, id: `p${passages.length + 1}` });
    }
    const mentions = new Map();
    let failedPassages = 0;
    const tagger = getRoleExecutor(ROLE_IDS.TAGGER);
    if (tagger.executor && passages.length) {
        let categories = [];
        try { categories = db.prepare('SELECT name, description FROM tags WHERE isEntity = 1').all(); } catch (e) { categories = []; }
        const known = loadWorkspaceEntities(db, workspaceId).filter(entity => entity.status !== 'proposed');
        const lowercaseWords = collectLowercaseWords(passages.map(passage => passage.text));
        const { apiProfileId, model } = tagger.executor;
        const outcome = await runModelTagger({
            records: passages.map(passage => ({ id: passage.id, text: passage.text })),
            categories,
            vocabFor: text => buildEntityVocab(workspaceId, text),
            languageInstruction: getSystemLanguageInstruction(),
            send: payload => sendTaggerRequest({ apiProfileId, model, chatHistory: [], manualMode: false, manualJson: null, maxPayloadTokens: workspacePayloadTokens(workspaceId), ...payload }),
            onProgress,
            shouldCancel
        });
        if (shouldCancel && shouldCancel()) return { cancelled: true };
        for (const entry of outcome.chunkTags) {
            const passage = passages[entry.chunkIndex];
            if (!passage) continue;
            const list = [];
            for (const tag of entry.tags) {
                if (tag.proposalKind !== 'known') {
                    const verdict = checkProposal({
                        value: tag.value, surface: tag.surface, type: tag.tag, proposalKind: tag.proposalKind, chunkText: passage.text,
                        entities: known, siblings: entry.tags.filter(other => other !== tag).map(other => ({ value: other.value, type: other.tag })), lowercaseWords
                    });
                    if (!verdict.ok) continue;
                }
                list.push({ name: tag.value, type: tag.tag, proposalKind: tag.proposalKind });
            }
            mentions.set(passage.id, list);
        }
        failedPassages = [...outcome.outcomes.values()].filter(item => item.status !== 'completed').length;
    } else if (onProgress) {
        onProgress(passages.length, passages.length);
    }
    const candidates = buildCandidates({ passages, mentions, existing: loadWorkspaceEntities(db, workspaceId) });
    sourceImportSessions.set(workspaceId, { passages, candidates });
    return {
        candidates,
        passages: passages.map(passage => ({ id: passage.id, fileName: passage.fileName, label: passage.label, text: passage.text })),
        taggerMissing: !tagger.executor,
        failedPassages
    };
}

// targetId adds to that sheet, fill false creates the sheet with its name only, and mergedIds
// lists the candidates joined into this one.
function importDecisionsWithPassages(workspaceId, decisions) {
    const session = sourceImportSessions.get(workspaceId);
    if (!session) throw new Error('Read the sources again: the list is no longer available.');
    const byId = new Map(session.candidates.map(candidate => [candidate.id, candidate]));
    const passages = new Map(session.passages.map(passage => [passage.id, passage]));
    return (decisions || []).map(decision => {
        const found = byId.get(decision.id);
        if (!found) return null;
        // An entry the person merged into this one brings its passages and portrait along.
        const merged = (decision.mergedIds || []).map(id => byId.get(id)).filter(item => item && item !== found);
        const passageIds = [...new Set([found, ...merged].flatMap(item => item.passageIds))];
        const candidate = { ...found, passageIds, portraitPath: found.portraitPath || merged.find(item => item.portraitPath)?.portraitPath || null };
        return { ...decision, candidate, passages: passageIds.map(id => passages.get(id)).filter(Boolean) };
    }).filter(Boolean);
}

function estimateImportFill(workspaceId, decisions) {
    const resolved = importDecisionsWithPassages(workspaceId, decisions);
    // No token estimate here: it cannot be known before the run, so only the real use is shown at the end.
    const locked = [];
    let sheets = 0, passages = 0, unfilled = 0, existing = 0;
    for (const decision of resolved) {
        if (decision.fill === false) { unfilled++; continue; }
        const target = decision.targetId ? entitiesStore.getEntity(decision.targetId) : null;
        if (target && (target.data?.aiPolicy || 'review') === 'locked') { locked.push(target.canonicalName); continue; }
        sheets++;
        if (target) existing++;
        passages += decision.passages.length;
    }
    return { sheets, existing, passages, locked, unfilled, model: getSystemAiConfiguration().systemAi?.model || null };
}

// Imported passages carry no vector: only the fill reads them, never retrieval.
function applyImportSources(workspaceId, decisions) {
    const { passageSource } = require('./features/worldbuild/source-import');
    const resolved = importDecisionsWithPassages(workspaceId, decisions);
    const entityIds = [];
    const fillIds = [];
    const created = [];
    const portraits = [];
    let aliasesAdded = 0;
    const typeCounts = {};
    const entityFor = new Map();
    db.transaction(() => {
        for (const decision of resolved) {
            const aliases = (decision.aliases || []).map(alias => String(alias || '').trim()).filter(Boolean);
            const target = decision.targetId ? entitiesStore.getEntity(decision.targetId) : null;
            let entity;
            if (target) {
                const known = new Set([target.canonicalName, ...(target.aliases || [])].map(foldText));
                const added = [...new Set(aliases)].filter(alias => !known.has(foldText(alias)));
                if (added.length) entitiesStore.updateEntity(target.id, { aliases: [...(target.aliases || []), ...added] });
                aliasesAdded += added.length;
                entity = target;
            } else {
                if (!decision.type || !String(decision.name || '').trim()) continue;
                const data = {
                    ...(decision.type === 'Items' ? { itemNature: decision.candidate.itemNature === 'type' ? 'type' : 'unique' } : {}),
                    ...(decision.type === 'Creatures' ? { scope: 'individual' } : {}),
                };
                entity = entitiesStore.createEntity({ workspaceId, type: decision.type, canonicalName: decision.name, aliases, data });
                created.push(entity.id);
                aliasesAdded += aliases.length;
            }
            entityIds.push(entity.id);
            if (decision.fill !== false) fillIds.push(entity.id);
            typeCounts[entity.type] = (typeCounts[entity.type] || 0) + 1;
            entityFor.set(decision.candidate.id, entity);
            if (decision.candidate.portraitPath) portraits.push({ entityId: entity.id, sourcePath: decision.candidate.portraitPath, replace: !target });
        }

        const insertChunk = db.prepare(`
            INSERT INTO knowledge_chunks (id, ownerId, ownerType, source, text, vector, createdAt, tokenCount, content_hash, ordinal)
            VALUES (?, ?, 'import_source', ?, ?, '[]', ?, ?, ?, ?)
        `);
        const insertTag = db.prepare("INSERT OR IGNORE INTO chunk_tags (chunkId, tag, entity, manual, origin) VALUES (?, ?, ?, 0, 'import')");
        // The same text, from a card and a lorebook or an import not yet cleared, is kept once.
        const sameText = db.prepare("SELECT id FROM knowledge_chunks WHERE ownerType = 'import_source' AND ownerId = ? AND content_hash = ? LIMIT 1");
        const chunkFor = new Map();
        const byHash = new Map();
        const now = Date.now();
        for (const decision of resolved) {
            // A name-only entry is never read by the fill, so its passages are not kept.
            if (decision.fill === false) continue;
            const entity = entityFor.get(decision.candidate.id);
            if (!entity) continue;
            for (const passage of decision.passages) {
                if (!chunkFor.has(passage.id)) {
                    const hash = crypto.createHash('sha256').update(passage.text).digest('hex');
                    let id = byHash.get(hash) || sameText.get(workspaceId, hash)?.id;
                    if (!id) {
                        id = `import_${crypto.randomUUID()}`;
                        insertChunk.run(id, workspaceId, passageSource(passage), passage.text, now + byHash.size, encode(passage.text).length, hash, byHash.size);
                    }
                    byHash.set(hash, id);
                    chunkFor.set(passage.id, id);
                }
                insertTag.run(chunkFor.get(passage.id), entity.type, entity.id);
            }
        }
    })();
    sourceImportSessions.delete(workspaceId);
    return { entityIds, fillIds, created, portraits, aliasesAdded, typeCounts };
}

// Imported files leave nothing behind: a passage goes once every sheet that needed it has read
// it. Only passages a failed sheet or an unread leftover still needs stay, for the retry.
function clearImportSources(workspaceId) {
    if (!workspaceId) return 0;
    const removed = db.transaction(() => {
        const changes = db.prepare(`
            DELETE FROM knowledge_chunks
            WHERE ownerType = 'import_source' AND ownerId = @workspaceId AND id NOT IN (
              SELECT chunk_id FROM entity_update_evidence
              WHERE workspace_id = @workspaceId AND state IN ('discovered', 'queued', 'deferred')
                AND entity_id IN (SELECT id FROM entities WHERE workspaceId = @workspaceId)
              UNION
              SELECT ct.chunkId FROM chunk_tags ct
              JOIN entity_enrichment_errors er ON er.entityId = ct.entity AND er.workspaceId = @workspaceId AND er.dismissedAt IS NULL
            )
        `).run({ workspaceId }).changes;
        db.prepare(`
            DELETE FROM entity_update_evidence
            WHERE workspace_id = ? AND chunk_id LIKE 'import\\_%' ESCAPE '\\' AND chunk_id NOT IN (SELECT id FROM knowledge_chunks)
        `).run(workspaceId);
        return changes;
    })();
    return removed;
}

function discardImportSession(workspaceId) {
    sourceImportSessions.delete(workspaceId);
}

// aiPolicy: 'open' applies directly, 'review' stages into data._enrichPending without
// touching live values, 'locked' is skipped. One entity failing never aborts the run.
// What to look for when a field is empty, as a search for the passages that would show it.
const FIELD_GAP_CUES = {
    gender: 'gender and the pronouns used for them',
    age: 'age, how many years old',
    appearance: 'appearance: face, hair, eyes, build, height, how they dress',
    personality: 'personality, temperament and habits',
    status: 'alive, dead or missing',
    description: 'what it is like, description',
    locationType: 'what kind of place it is',
    size: 'how large the place is',
    itemType: 'what kind of object it is',
    abundance: 'how common or rare it is',
    disposition: 'hostile, wary or friendly toward people',
    nature: 'what kind of being it is',
    threat: 'how dangerous it is',
    abilities: 'abilities and powers',
    kind: 'what kind of event it was',
    'link.livesIn': 'where they live, their home or room, where they sleep',
    'link.worksAt': 'where they work, their job or trade, who they work for',
    'link.race': 'race, species or people they belong to',
};
const FIELD_GAP_LINKS = { Characters: ['livesIn', 'worksAt', 'race'] };
const FIELD_GAP_PER_FIELD = 3;
const FIELD_GAP_BUDGET = 3500;
// One run fills at most this many sheets, the best documented first; the rest wait for the next run.
const FIELD_GAP_MAX_SHEETS = 30;

// Reads the passages that best show each empty field of the sheets given, whatever was read before,
// and asks one answer per field: found or absent. An absent answer is remembered with the passages
// it saw, so the field is asked again only when something new about it appears.
async function fillEntityFieldGaps({ workspaceId, entityIds, candidatesByEntity, runId, updateState, passTokens, shouldCancel = null, progressCallback = null }) {
    const outcome = { examined: 0, found: 0, absent: 0, sheets: 0, remaining: 0 };
    if (!entityIds.length) return outcome;
    const ordered = [...entityIds].sort((left, right) => (candidatesByEntity.get(right)?.length || 0) - (candidatesByEntity.get(left)?.length || 0));
    const systemAi = getSystemAiConfiguration().systemAi;
    if (!systemAi) return outcome;
    const { apiProfileId, model } = systemAi;
    const { buildFieldGapSystemPrompt } = require('./features/worldbuild/entity-update-prompts');
    const { buildFieldGapSchema } = require('./features/worldbuild/entity-update-schema');
    const systemPrompt = buildFieldGapSystemPrompt({ languageInstruction: getSystemLanguageInstruction(), sourceLanguageInstruction: getSourceLanguageInstruction() });
    const localEmbeddings = (readAdvancedSettings().embeddingEngine || 'local') === 'local';
    const all = entitiesStore.listEntities({ workspaceId });
    const readChecks = db.prepare('SELECT field_key AS key, evidence_signature AS signature, result FROM entity_field_checks WHERE workspace_id = ? AND entity_id = ?');
    const writeCheck = db.prepare(`
        INSERT INTO entity_field_checks (workspace_id, entity_id, field_key, evidence_signature, result, checked_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(workspace_id, entity_id, field_key) DO UPDATE SET
          evidence_signature = excluded.evidence_signature, result = excluded.result, checked_at = excluded.checked_at
    `);
    const vectorOf = db.prepare('SELECT vector FROM knowledge_chunks WHERE id = ?');
    const customDefinitions = db.prepare(`
        SELECT field_key AS key, label, value_type AS valueType, options_json AS optionsJson,
          constraints_json AS constraintsJson, ai_access AS aiAccess, ai_guidance AS aiGuidance
        FROM worldbuild_field_definitions WHERE workspace_id = ? AND type_id = ? AND ai_access = 'read-write'
        ORDER BY position, field_id
    `);
    const entityLabels = loadEntityLabels(workspaceId);
    const cosine = (left, right) => left.reduce((sum, value, index) => sum + value * (right[index] || 0), 0);

    for (let index = 0; index < ordered.length; index++) {
        if (shouldCancel?.()) break;
        if (outcome.sheets >= FIELD_GAP_MAX_SHEETS) {
            outcome.remaining = ordered.length - index;
            break;
        }
        const ent = entitiesStore.getEntity(ordered[index]);
        if (!ent || ent.status === 'proposed' || (ent.data?.aiPolicy || 'review') === 'locked') continue;
        const chunks = (candidatesByEntity.get(ent.id) || []).filter(chunk => chunk.text);
        if (!chunks.length) continue;
        if (progressCallback) progressCallback({ phase: 'filling-fields', done: index, total: ordered.length, name: ent.canonicalName, entityId: ent.id });

        const allowed = enrichFieldsForEntity(ent);
        const writableCustom = customDefinitions.all(workspaceId, ent.type).map(row => ({
            ...row,
            options: row.optionsJson ? JSON.parse(row.optionsJson) : [],
            constraints: row.constraintsJson ? JSON.parse(row.constraintsJson) : {},
        }));
        const { emptyFields } = buildFieldCoverage(ent, allowed, writableCustom);
        // A field already waiting in the review is not asked again.
        const staged = ent.data?._enrichPending || {};
        const stagedLinkKeys = new Set((staged.links || []).map(link => link.relKey));
        const gaps = emptyFields.filter(key => !staged.data?.[key]).map(key => {
            if (key.startsWith('customFields.')) {
                const field = writableCustom.find(item => `customFields.${item.key}` === key);
                return field ? { key, label: field.label, cue: `${field.label}${field.aiGuidance ? `: ${field.aiGuidance}` : ''}`, custom: field } : null;
            }
            return { key, label: key, cue: FIELD_GAP_CUES[key] || key };
        }).filter(Boolean);
        const relSpecs = enrichRelationsForEntity(ent);
        for (const relKey of FIELD_GAP_LINKS[ent.type] || []) {
            const spec = relSpecs.find(item => item.key === relKey);
            if (!spec || stagedLinkKeys.has(relKey)) continue;
            const existing = [...existingLinksByTarget(ent.id, spec).values()];
            if (!existing.length) {
                gaps.push({ key: `link.${relKey}`, label: spec.label, cue: FIELD_GAP_CUES[`link.${relKey}`] || spec.label, spec });
                continue;
            }
            // A place already linked can still miss what the character does there.
            if (!spec.labeled) continue;
            for (const link of existing.filter(item => !item.label)) {
                gaps.push({ key: `job.${relKey}.${link.entity.id}`, label: `Job at ${link.entity.canonicalName}`, cue: `their job or trade at ${link.entity.canonicalName}`, spec, link });
            }
        }
        if (!gaps.length) continue;

        // The passages that best answer each field, by meaning when the local model is in use.
        const vectors = new Map();
        if (localEmbeddings) {
            for (const chunk of chunks) {
                try {
                    const vector = JSON.parse(vectorOf.get(chunk.id)?.vector || 'null');
                    if (Array.isArray(vector) && vector.length) vectors.set(chunk.id, vector);
                } catch { /* a passage without a vector is ranked by position */ }
            }
        }
        const picks = new Map();
        for (const gap of gaps) {
            let chosen = [];
            if (vectors.size) {
                try {
                    const query = await generateEmbeddingVector(`${ent.canonicalName}: ${gap.cue}`, true);
                    chosen = chunks
                        .filter(chunk => vectors.has(chunk.id))
                        .map(chunk => ({ chunk, score: cosine(query, vectors.get(chunk.id)) }))
                        .sort((left, right) => right.score - left.score)
                        .slice(0, FIELD_GAP_PER_FIELD)
                        .map(item => item.chunk);
                } catch (error) {
                    console.warn('[Field gaps] Search by meaning failed:', error.message);
                }
            }
            if (!chosen.length) chosen = [...chunks.slice(0, 1), ...chunks.slice(-2)];
            picks.set(gap.key, chosen);
        }
        const selected = [];
        let budget = 0;
        for (let rank = 0; rank < FIELD_GAP_PER_FIELD; rank++) {
            for (const gap of gaps) {
                const chunk = picks.get(gap.key)[rank];
                if (!chunk || selected.includes(chunk)) continue;
                const cost = estimateTokens(chunk.text);
                if (budget + cost > FIELD_GAP_BUDGET && selected.length) continue;
                selected.push(chunk);
                budget += cost;
            }
        }
        selected.sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0));
        const signatureOf = gap => crypto.createHash('sha256')
            .update(picks.get(gap.key).filter(chunk => selected.includes(chunk)).map(chunk => `${chunk.id}:${chunk.contentHash || ''}`).sort().join('|'))
            .digest('hex').slice(0, 24);
        const checks = new Map(readChecks.all(workspaceId, ent.id).map(row => [row.key, row]));
        const asked = gaps.filter(gap => {
            const check = checks.get(gap.key);
            return !(check && check.result === 'absent' && check.signature === signatureOf(gap));
        });
        if (!asked.length) continue;

        const prefix = crypto.randomBytes(2).toString('hex');
        const entries = selected.map((chunk, position) => ({
            id: `F_${prefix}_${position + 1}`,
            chunk,
            prompt: `[F_${prefix}_${position + 1} | ${chunk.evidenceSource || 'Story'}: ${chunk.source || 'Untitled'}]\n${chunk.text}`,
        }));
        const evidenceText = entries.map(entry => entry.prompt).join('\n\n');
        const linkCandidates = new Map();
        const fieldLines = asked.map(gap => {
            if (gap.link) return `- ${gap.key} (${gap.label}): the job ${ent.canonicalName} does at ${gap.link.entity.canonicalName}, in one to three words. Only a job, trade or service shown there again and again.`;
            if (gap.spec) {
                const names = relationCandidates(all, ent, gap.spec)
                    .filter(candidate => textMentionsEntity(evidenceText, entityMentionNames(candidate)))
                    .map(candidate => candidate.canonicalName);
                linkCandidates.set(gap.key, names);
                const guidance = ENRICH_RELATION_GUIDANCE[`${ent.type}.${gap.spec.key}`] || '';
                const shape = gap.spec.labeled ? 'a list of two: the candidate name and the job there in one to three words' : 'one candidate name';
                return `- ${gap.key} (${gap.label}): ${shape}${names.length ? `, the candidate from [${names.join(', ')}]` : ' (no candidate appears: answer absent)'}. ${guidance}`;
            }
            if (gap.custom) return `- ${gap.key} (${gap.label}): ${customFieldPromptShape(gap.custom)}. ${gap.custom.aiGuidance || `Only the meaning expressed by “${gap.label}”.`}`;
            const shape = ENRICH_ENUMS[gap.key] ? `one of [${ENRICH_ENUMS[gap.key].join(', ')}]` : 'a concise literal value';
            return `- ${gap.key}: ${shape}. ${ENRICH_FIELD_GUIDANCE[gap.key] || ''}`;
        });
        const currentData = {};
        for (const field of allowed) if (ent.data?.[field] != null && String(ent.data[field]).trim()) currentData[field] = ent.data[field];
        const prompt = `RECORD: ${ent.canonicalName} (${ent.type.replace(/s$/, '')})\nAliases: ${ent.aliases?.join(', ') || '(none)'}\n` +
            `ENTITY TYPE CONTRACT:\n${ENRICH_TYPE_GUIDANCE[ent.type] || 'A persistent canonical world entity.'}\n` +
            (ent.lore ? `Lore (background): ${String(ent.lore).slice(0, 2400)}\n` : '') +
            (Object.keys(currentData).length ? `Filled fields: ${JSON.stringify(currentData)}\n` : '') +
            `\nEMPTY FIELDS (answer each one):\n${fieldLines.join('\n')}\n` +
            `\nPASSAGES:\n${evidenceText}`;

        let result;
        try {
            const systemText = entityLabels.encode(systemPrompt);
            result = await sendApiRequest({
                apiProfileId, model,
                systemPrompt: systemText,
                chatHistory: [],
                newPrompt: entityLabels.encode(prompt),
                temperature: 0.1,
                maxTokens: Math.min(4000, 400 + asked.length * 300),
                maxPayloadTokens: workspacePayloadTokens(workspaceId),
                keepSpoilerMarkers: true,
                jsonMode: true,
                jsonSchema: buildFieldGapSchema(),
                includeResponseMetadata: true,
                promptCache: { policy: 'conversation', scopeId: `entity-update-fields:${workspaceId}`, ttl: '5m', stable: systemText, volatile: '' },
            });
        } catch (error) {
            console.warn(`[Field gaps] ${ent.canonicalName} failed:`, cleanErrorMessage(error));
            continue;
        }
        const tokens = passTokens.get(ent.id) || { input: 0, output: 0 };
        tokens.input += result.inputTokens || estimateTokens(`${systemPrompt}\n${prompt}`);
        tokens.output += result.outputTokens || estimateTokens(result.content);
        passTokens.set(ent.id, tokens);
        updateState.updateJob(runId, ent.id, { input_tokens: tokens.input, output_tokens: tokens.output });
        const countFound = () => {
            tokens.proposals = (tokens.proposals || 0) + Object.keys(proposedData).length + proposedLinks.length;
            updateState.updateJob(runId, ent.id, { proposals_created: tokens.proposals });
        };
        const answer = parseEntityUpdateObject(entityLabels.decode(result.content)).value;
        const answers = Array.isArray(answer?.fields) ? answer.fields : [];
        outcome.sheets++;
        const validIds = new Set(entries.map(entry => entry.id));
        const proposedData = {};
        const proposedLinks = [];
        const now = Date.now();
        for (const gap of asked) {
            outcome.examined++;
            const reply = answers.find(item => item && item.key === gap.key);
            const evidence = (Array.isArray(reply?.evidence) ? reply.evidence : []).map(String).filter(id => validIds.has(id));
            const support = String(reply?.support || '').trim();
            let accepted = false;
            if (reply?.status === 'found' && evidence.length && support) {
                const raw = decodeEntityUpdate({ changes: [{ kind: 'field', key: gap.key, value: reply.value, support, evidence }] }).data[gap.key]?.value;
                if (gap.link) {
                    const job = normalizeRelationshipLabel(Array.isArray(raw) ? raw[0] : raw);
                    if (job) {
                        proposedLinks.push({ relKey: gap.spec.key, relLabel: gap.spec.label, relType: gap.spec.relType, from: gap.spec.from, single: !!gap.spec.single, label: job, metadata: undefined, existingLinkId: gap.link.linkId, targetId: gap.link.entity.id, targetName: gap.link.entity.canonicalName, evidence, support });
                        accepted = true;
                    }
                } else if (gap.spec) {
                    const [rawName, rawJob] = Array.isArray(raw) ? raw : [raw, ''];
                    const name = String(rawName || '').trim();
                    const allowedNames = linkCandidates.get(gap.key) || [];
                    const chosen = allowedNames.some(candidate => foldText(candidate) === foldText(name)) ? resolveRelationTarget(name, gap.spec, workspaceId) : null;
                    const place = chosen && chosen !== ent.id
                        ? (PLACE_LINKS.has(gap.spec.key) ? placeLinkTarget({ targetId: chosen, support, candidates: relationCandidates(all, ent, gap.spec) }) : entitiesStore.getEntity(chosen))
                        : null;
                    if (place) {
                        const label = gap.spec.labeled ? normalizeRelationshipLabel(rawJob) : null;
                        proposedLinks.push({ relKey: gap.spec.key, relLabel: gap.spec.label, relType: gap.spec.relType, from: gap.spec.from, single: !!gap.spec.single, label, metadata: undefined, existingLinkId: undefined, targetId: place.id, targetName: place.canonicalName, evidence, support });
                        accepted = true;
                    }
                } else if (gap.custom) {
                    const isNumeric = gap.custom.valueType === 'number' || gap.custom.valueType === 'range';
                    const value = isNumeric && isUnsupportedNumericDelta(raw, support) ? undefined : normalizeCustomProposalValue(raw, gap.custom, workspaceId);
                    if (value !== undefined) {
                        proposedData[gap.key] = { value, evidence, support, fieldLabel: gap.label };
                        accepted = true;
                    }
                } else {
                    let value = String(raw ?? '').trim();
                    if (ENRICH_ENUMS[gap.key]) value = ENRICH_ENUMS[gap.key].find(option => option.toLowerCase() === value.toLowerCase()) || '';
                    if (gap.key === 'age' && isUnsupportedNumericDelta(value, support)) value = '';
                    if (value) {
                        proposedData[gap.key] = { value, evidence, support };
                        accepted = true;
                    }
                }
            }
            if (accepted) outcome.found++;
            else outcome.absent++;
            writeCheck.run(workspaceId, ent.id, gap.key, signatureOf(gap), accepted ? 'found' : 'absent', now);
        }
        if (!Object.keys(proposedData).length && !proposedLinks.length) continue;
        const used = entries.filter(entry => [...Object.values(proposedData), ...proposedLinks].some(item => item.evidence.includes(entry.id)));
        stageSheetProposals({ workspaceId, entity: ent, proposedData, proposedLinks, evidenceEntries: used, runId });
        countFound();
    }
    return outcome;
}

// A lore's sentences, keeping a spoiler span whole even when it holds several sentences.
function splitLoreSentences(lore) {
    const paragraphs = String(lore || '').split(/\n\s*\n/).map(paragraph => paragraph.trim()).filter(Boolean);
    const sentences = [];
    paragraphs.forEach((paragraph, paragraphIndex) => {
        let open = '';
        for (const piece of paragraph.split(/(?<=[.!?…])\s+/)) {
            open = open ? `${open} ${piece}` : piece;
            if (((open.match(/\|\|/g) || []).length % 2) === 0) {
                sentences.push({ paragraph: paragraphIndex, text: open });
                open = '';
            }
        }
        if (open) sentences.push({ paragraph: paragraphIndex, text: open });
    });
    return sentences;
}

// Sorts the sentences a lore update adds into background and story, and returns the new lore
// without the story ones, or null when no background is left to add.
async function keepBackgroundSentences({ entity, currentLore, nextLore, classify }) {
    const { buildLoreCleanupSystemPrompt } = require('./features/worldbuild/entity-update-prompts');
    const flat = text => String(text || '').replace(/\s+/g, ' ').trim();
    const held = flat(currentLore);
    const sentences = splitLoreSentences(nextLore);
    const added = sentences.filter(sentence => !held.includes(flat(sentence.text)));
    if (!added.length) return null;
    const prompt = `RECORD: ${entity.canonicalName} (${entity.type.replace(/s$/, '')})\n` +
        `LORE SENTENCES:\n${added.map((sentence, position) => `${position + 1}. ${sentence.text}`).join('\n')}`;
    let answer = null;
    try {
        const result = await classify(buildLoreCleanupSystemPrompt({ languageInstruction: getSystemLanguageInstruction() }), prompt, 300 + added.length * 12);
        answer = parseEntityUpdateObject(result.content).value;
    } catch (error) {
        console.warn(`[Entity Update] The new lore of ${entity.canonicalName} could not be sorted:`, cleanErrorMessage(error));
    }
    const keep = new Set((Array.isArray(answer?.keep) ? answer.keep : []).map(Number));
    // Unsorted additions are not trusted: the lore stays as it is.
    const dropped = new Set(added.filter((_, position) => !keep.has(position + 1)));
    if (dropped.size === added.length) return null;
    const out = [];
    for (const sentence of sentences) {
        if (dropped.has(sentence)) continue;
        const last = out[out.length - 1];
        if (last && last.paragraph === sentence.paragraph) last.text += ` ${sentence.text}`;
        else out.push({ ...sentence });
    }
    return out.map(item => item.text).join('\n\n');
}

// Moves what happens in the story out of each lore, keeping the background word for word. Nothing is
// written to the sheets: each cleaned lore waits in its review, with the sentences it would drop and
// whether the story record already holds them.
async function cleanLoreToBackground(workspaceId, { entityIds = null, progressCallback = null, shouldCancel = null } = {}) {
    const systemAi = getSystemAiConfiguration().systemAi;
    if (!systemAi) throw new Error(getSystemAiConfiguration().error);
    const { apiProfileId, model } = systemAi;
    const { buildLoreCleanupSystemPrompt } = require('./features/worldbuild/entity-update-prompts');
    const { buildLoreCleanupSchema } = require('./features/worldbuild/entity-update-schema');
    const search = require('../../dist-main/main/features/narrative/umwelt/story-search');
    const systemPrompt = buildLoreCleanupSystemPrompt({ languageInstruction: getSystemLanguageInstruction() });
    const only = Array.isArray(entityIds) && entityIds.length ? new Set(entityIds) : null;
    const targets = entitiesStore.listEntities({ workspaceId }).filter(entity => entity.status !== 'proposed'
        && entity.type !== 'System'
        && String(entity.lore || '').trim()
        && (entity.data?.aiPolicy || 'review') !== 'locked'
        && entity.data?._enrichPending?.lore == null
        && (!only || only.has(entity.id)));
    const outcome = { lore: { examined: 0, proposed: 0, alreadyBackground: 0, allStory: [], failed: 0 } };
    const entityLabels = loadEntityLabels(workspaceId);
    let inputTokens = 0, outputTokens = 0;
    for (let index = 0; index < targets.length; index++) {
        if (shouldCancel?.()) { outcome.cancelled = true; break; }
        const ent = targets[index];
        if (progressCallback) progressCallback({ phase: 'cleaning-lore', done: index, total: targets.length, name: ent.canonicalName, entityId: ent.id });
        const sentences = splitLoreSentences(ent.lore);
        if (!sentences.length) continue;
        outcome.lore.examined++;
        const prompt = `RECORD: ${ent.canonicalName} (${ent.type.replace(/s$/, '')})\n` +
            `LORE SENTENCES:\n${sentences.map((sentence, position) => `${position + 1}. ${sentence.text}`).join('\n')}`;
        let answer = null;
        try {
            const systemText = entityLabels.encode(systemPrompt);
            const result = await sendApiRequest({
                apiProfileId, model,
                systemPrompt: systemText,
                chatHistory: [],
                newPrompt: entityLabels.encode(prompt),
                temperature: 0,
                maxTokens: 400 + sentences.length * 12,
                maxPayloadTokens: workspacePayloadTokens(workspaceId),
                keepSpoilerMarkers: true,
                jsonMode: true,
                jsonSchema: buildLoreCleanupSchema(),
                includeResponseMetadata: true,
                promptCache: { policy: 'conversation', scopeId: `entity-update-lore:${workspaceId}`, ttl: '5m', stable: systemText, volatile: '' },
            });
            inputTokens += result.inputTokens || estimateTokens(`${systemPrompt}\n${prompt}`);
            outputTokens += result.outputTokens || estimateTokens(result.content);
            answer = parseEntityUpdateObject(result.content).value;
        } catch (error) {
            console.warn(`[Lore cleanup] ${ent.canonicalName} failed:`, cleanErrorMessage(error));
        }
        const keep = new Set((Array.isArray(answer?.keep) ? answer.keep : []).map(Number));
        const story = new Set((Array.isArray(answer?.story) ? answer.story : []).map(Number));
        // Every sentence must be sorted once; an answer that skips or doubles one is not trusted.
        const sorted = sentences.every((_, position) => keep.has(position + 1) !== story.has(position + 1));
        if (!answer || !sorted) { outcome.lore.failed++; continue; }
        if (!story.size) { outcome.lore.alreadyBackground++; continue; }
        if (!keep.size) { outcome.lore.allStory.push(ent.canonicalName); continue; }
        const kept = [];
        sentences.forEach((sentence, position) => {
            if (!keep.has(position + 1)) return;
            const last = kept[kept.length - 1];
            if (last && last.paragraph === sentence.paragraph) last.text += ` ${sentence.text}`;
            else kept.push({ ...sentence });
        });
        const removed = sentences.filter((_, position) => story.has(position + 1)).map(sentence => sentence.text);
        const missing = [];
        for (const text of removed) {
            let held = false;
            try {
                const vector = await storyQueryVector(workspaceId, text);
                // Two shared words are chance; only a match by meaning says the record tells the same thing.
                const meant = hits => hits.some(hit => hit.match !== 'text');
                held = Boolean(vector) && (meant(search.searchStory(db, workspaceId, { text, vector, docType: 'event', limit: 3 }))
                    || meant(search.searchStory(db, workspaceId, { text, vector, docType: 'record', subject: ent.id, limit: 3 })));
            } catch { /* without the story record the sentence is listed as not found */ }
            if (!held) missing.push(text);
        }
        const quote = text => `«${text.length > 220 ? `${text.slice(0, 217)}…` : text}»`;
        const support = `Keeps the background and moves out ${removed.length} ${removed.length === 1 ? 'sentence' : 'sentences'} about the story itself: ${removed.map(quote).join(' ')}` +
            (missing.length
                ? ` Not found in the story record, so worth keeping somewhere before accepting: ${missing.map(quote).join(' ')}`
                : ' The story record already holds each of them.');
        const fresh = entitiesStore.getEntity(ent.id);
        if (!fresh || fresh.data?._enrichPending?.lore != null) continue;
        const pending = { ...(fresh.data?._enrichPending || {}), lore: { value: kept.map(item => item.text).join('\n\n'), evidence: [], support }, at: Date.now() };
        entitiesStore.updateEntity(fresh.id, { data: { ...(fresh.data || {}), _enrichPending: pending } });
        outcome.lore.proposed++;
    }
    if (progressCallback) progressCallback({ phase: 'cleaning-lore', done: targets.length, total: targets.length });
    return { ...outcome, entities: targets.length, processedEntities: outcome.lore.examined, updated: 0, staged: outcome.lore.proposed, tokenUsage: { inputTokens, outputTokens } };
}

// A sheet set to open takes the change at once; any other waits in its review with what it cites.
function stageSheetProposals({ workspaceId, entity, proposedData, proposedLinks, evidenceEntries, runId }) {
    const fresh = entitiesStore.getEntity(entity.id) || entity;
    if ((fresh.data?.aiPolicy || 'review') === 'open') {
        const nextData = { ...(fresh.data || {}) };
        for (const [field, proposal] of Object.entries(proposedData)) {
            if (field.startsWith('customFields.')) {
                nextData.customFields = { ...(nextData.customFields || {}), [field.slice('customFields.'.length)]: proposal.value };
            } else nextData[field] = proposal.value;
        }
        const origin = { appliedBy: 'automatic', runId, evidence: evidenceEntries.map(entry => entry.chunk.id), relatedIds: proposedLinks.map(link => link.targetId) };
        entitiesStore.withUpdateOrigin(fresh.id, origin, () => {
            entitiesStore.updateEntity(fresh.id, { data: nextData });
            for (const link of proposedLinks) applyProposedLink(fresh.id, link, workspaceId);
        });
        return 'applied';
    }
    const previous = (fresh.data?._enrichPending && typeof fresh.data._enrichPending === 'object') ? fresh.data._enrichPending : {};
    const pending = { ...previous };
    pending.evidence = {
        ...(previous.evidence || {}),
        ...Object.fromEntries(evidenceEntries.map(entry => [entry.id, { chunkId: entry.chunk.id, excerpt: entityEvidenceExcerpt(entry.chunk.text, fresh.canonicalName) }])),
    };
    if (Object.keys(proposedData).length) pending.data = { ...(previous.data || {}), ...proposedData };
    if (proposedLinks.length) {
        const links = new Map((Array.isArray(previous.links) ? previous.links : []).map(link => [`${link.relKey}:${link.targetId}:${link.label || ''}`, link]));
        for (const link of proposedLinks) links.set(`${link.relKey}:${link.targetId}:${link.label || ''}`, link);
        pending.links = [...links.values()];
    }
    pending.at = Date.now();
    entitiesStore.updateEntity(fresh.id, { data: { ...(fresh.data || {}), _enrichPending: pending } });
    return 'staged';
}

async function enrichEntities(workspaceId, progressCallback = null, { entityIds = null, shouldCancel = null } = {}) {
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
    const only = Array.isArray(entityIds) && entityIds.length ? new Set(entityIds) : null;
    const targets = all.filter(e => e.status !== 'proposed' && (e.data?.aiPolicy || 'review') !== 'locked' && (!only || only.has(e.id)));
    const updateState = createEntityUpdateState(db);
    const runId = updateState.startRun(workspaceId, targets.map(entity => entity.id));
    const taggedWritingChunks = db.prepare(`
        SELECT DISTINCT kc.id, kc.text, kc.source, kc.createdAt, kc.ownerId, kc.ownerType, kc.ordinal,
          COALESCE(kc.content_hash, '') AS contentHash, 'Writing Desk' AS evidenceSource, 1 AS isTagged
        FROM chunk_tags ct
        JOIN knowledge_chunks kc ON ct.chunkId = kc.id AND kc.ownerType = 'document'
        JOIN documents d ON d.id = kc.ownerId
        WHERE ct.entity = ? AND d.workspaceId = ? AND kc.enabled = 1
          AND d.id NOT IN (SELECT document_id FROM in_world_texts)
        ORDER BY kc.createdAt ASC
    `);
    const memoryChunks = db.prepare(`
        SELECT id, text, source, ownerId, ownerType, ordinal, createdAt, memoryBlockId, COALESCE(content_hash, '') AS contentHash
        FROM knowledge_chunks
        WHERE ownerId = ? AND ownerType IN ('chat_kb', 'chat_memory') AND enabled = 1
        ORDER BY createdAt ASC
    `).all(workspaceId).map(chunk => ({ ...chunk, evidenceSource: 'Memory' }));
    const importedChunks = db.prepare(`
        SELECT DISTINCT kc.id, kc.text, kc.source, kc.createdAt, kc.ownerId, kc.ownerType, kc.ordinal,
          COALESCE(kc.content_hash, '') AS contentHash, 'Imported source' AS evidenceSource, 1 AS isTagged
        FROM chunk_tags ct
        JOIN knowledge_chunks kc ON ct.chunkId = kc.id AND kc.ownerType = 'import_source'
        WHERE ct.entity = ? AND kc.ownerId = ? AND kc.enabled = 1
        ORDER BY kc.createdAt ASC
    `);
    const precedingChunk = {
        byOrdinal: db.prepare(`
            SELECT id, text FROM knowledge_chunks
            WHERE ownerId = ? AND ownerType = ? AND source = ? AND ordinal = ? AND enabled = 1
            LIMIT 1
        `),
        byTime: db.prepare(`
            SELECT id, text FROM knowledge_chunks
            WHERE ownerId = ? AND ownerType = ? AND source = ? AND createdAt < ? AND enabled = 1
            ORDER BY createdAt DESC LIMIT 1
        `),
    };
    // Memories waiting for review count as held: a second run must not propose the same scene again.
    const pendingMemoryRows = db.prepare(`
        SELECT operations_json FROM narrative_events
        WHERE workspace_id = ? AND status = 'proposed' AND operations_json LIKE '%record-memory%'
    `).all(workspaceId);
    const pendingMemories = new Map();
    for (const row of pendingMemoryRows) {
        for (const operation of safeParseArray(row.operations_json)) {
            const memory = operation?.type === 'record-memory' ? operation.memory : null;
            if (!memory?.subjectId || !memory.summary) continue;
            if (!pendingMemories.has(memory.subjectId)) pendingMemories.set(memory.subjectId, []);
            pendingMemories.get(memory.subjectId).push(memory.summary);
        }
    }
    const localEmbeddings = (readAdvancedSettings().embeddingEngine || 'local') === 'local';
    const memoryIndex = createMemoryIndex({
        load: ownerId => [
            ...loadNarrativeRecords(workspaceId, ['memory'], [ownerId]).map(({ payload }) => payload?.summary),
            ...(pendingMemories.get(ownerId) || []),
        ],
        embed: localEmbeddings ? texts => generateEmbeddingVectors(texts) : null,
        comparable: comparableText,
    });
    const storyCoverage = createStoryCoverage(db, workspaceId, { stripReasoning });
    const canonSystemPrompt = buildCanonSystemPrompt({
        languageInstruction: getSystemLanguageInstruction(),
        sourceLanguageInstruction: getSourceLanguageInstruction(),
    });
    const narrativeSystemPrompt = buildNarrativeSystemPrompt({
        languageInstruction: getSystemLanguageInstruction(),
        sourceLanguageInstruction: getSourceLanguageInstruction(),
        scaleGuide: RELATIONSHIP_SCALE_GUIDE,
        causes: [...DURABLE_RELATIONSHIP_CAUSES],
    });
    // Sheets with an empty field get the field pass after the run, whether or not they had new passages.
    const gapTargets = new Set();
    const candidatesByEntity = new Map();
    const { RoleplaySkills } = require('../../dist-main/main/features/narrative/roleplay-skills');
    const skillSystem = new RoleplaySkills(db);
    const playerEntityId = skillSystem.getSettings(workspaceId).playerEntityId;
    const playerEntity = playerEntityId ? all.find(entity => entity.id === playerEntityId && entity.status !== 'proposed') || null : null;
    const constantMemoryChunks = await loadConstantMemoryChunks(workspaceId);
    const taggedMemoryChunks = db.prepare(`
        SELECT ct.chunkId FROM chunk_tags ct
        JOIN knowledge_chunks kc ON kc.id = ct.chunkId
        WHERE ct.entity = ? AND kc.ownerId = ? AND kc.ownerType IN ('chat_kb', 'chat_memory')
    `);
    const customFieldDefinitions = db.prepare(`
        SELECT field_key AS key, label, value_type AS valueType,
          options_json AS optionsJson, constraints_json AS constraintsJson,
          ai_access AS aiAccess, ai_guidance AS aiGuidance,
          default_value_json AS defaultValueJson, has_default AS hasDefault
        FROM worldbuild_field_definitions
        WHERE workspace_id = ? AND type_id = ?
        ORDER BY position, field_id
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

    // Sets, since a sheet read in several passes is still one sheet.
    const updatedIds = new Set(), stagedIds = new Set();
    let upToDate = 0, noEvidence = 0, failed = 0;
    let canonicalSuggestionCount = 0, narrativeSuggestionCount = 0, skillSuggestionCount = 0;
    let evidenceUsed = 0, taggedEvidenceRemaining = 0, textMatchesDeferred = 0;
    let emptyFieldsExamined = 0, emptyFieldSuggestions = 0;
    let emptyFieldsWithoutSupport = 0, emptyFieldsAwaitingEvidence = 0;
    let consecutiveStructuredFailures = 0;
    let processedEntities = 0;
    const extraPasses = new Map();
    const passTokens = new Map();
    const runRelationships = new Map();
    // One direction of one bond is proposed once per run, whichever sheet's passage found it first.
    const runRelationshipPairs = new Set();
    let stoppedEarly = false;
    let cancelled = false;
    for (let i = 0; i < targets.length; i++) {
        if (shouldStopEntityUpdates(consecutiveStructuredFailures)) {
            stoppedEarly = true;
            console.error('[Enrich] Stopped after three consecutive structured response failures. Unprocessed evidence remains pending.');
            break;
        }
        // Stop is honoured between entities, so no sheet is left half updated.
        if (shouldCancel?.()) { cancelled = true; break; }
        processedEntities++;
        // The Worldbuild stays editable during a run, so each sheet is read fresh when its turn comes.
        const ent = entitiesStore.getEntity(targets[i].id);
        if (!ent || ent.status === 'proposed' || (ent.data?.aiPolicy || 'review') === 'locked') {
            updateState.updateJob(runId, targets[i].id, { status: 'skipped' });
            continue;
        }
        updateState.updateJob(runId, ent.id, { status: 'processing', error: null });
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
        if (progressCallback) progressCallback({ phase: 'enriching', done: i, total: targets.length, name: ent.canonicalName, entityId: ent.id });
        const candidates = new Map();
        for (const chunk of taggedWritingChunks.all(ent.id, workspaceId)) {
            if (chunk.text) candidates.set(chunk.id, chunk);
        }
        for (const chunk of importedChunks.all(ent.id, workspaceId)) {
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
        const narrativeOrigin = ent.data?.narrativeOrigin;
        if (narrativeOrigin?.originId && narrativeOrigin?.excerpt) {
            const text = String(narrativeOrigin.excerpt);
            candidates.set(`narrative_origin_${narrativeOrigin.originId}`, {
                id: `narrative_origin_${narrativeOrigin.originId}`,
                text,
                source: 'Narrative State',
                createdAt: ent.createdAt || 0,
                contentHash: crypto.createHash('sha256').update(text).digest('hex'),
                evidenceSource: 'Narrative State',
                isTagged: true
            });
        }
        if (candidates.size) candidatesByEntity.set(ent.id, [...candidates.values()]);
        if (!candidates.size) {
            noEvidence++;
            updateState.updateJob(runId, ent.id, { status: 'skipped' });
            continue;
        }
        const allowed = enrichFieldsForEntity(ent);
        const customDefinitions = customFieldDefinitions.all(workspaceId, ent.type).map(row => ({
            ...row,
            options: row.optionsJson ? JSON.parse(row.optionsJson) : [],
            constraints: row.constraintsJson ? JSON.parse(row.constraintsJson) : {},
            ...(row.hasDefault === 1 ? { defaultValue: JSON.parse(row.defaultValueJson) } : {})
        }));
        const visibleCustomFields = customDefinitions.filter(field => field.aiAccess !== 'hidden');
        const writableCustomFields = visibleCustomFields.filter(field => field.aiAccess === 'read-write');
        const { emptyFields: emptyWritableFields } = buildFieldCoverage(ent, allowed, writableCustomFields);
        if (emptyWritableFields.length) gapTargets.add(ent.id);
        const discoveredEntries = [...candidates.values()].map(chunk => ({
            chunk,
            signature: entityEnrichmentSignature(chunk),
        }));
        const evidenceStates = updateState.discover(workspaceId, ent.id, discoveredEntries);
        const terminalStates = new Set(['evaluated', 'actionable', 'non-actionable']);
        const chunks = discoveredEntries
            .filter(entry => {
                const state = evidenceStates.get(entry.chunk.id);
                return !state || state.signature !== entry.signature || !terminalStates.has(state.state);
            })
            .map(entry => ({
                ...entry.chunk,
                isDeferred: evidenceStates.get(entry.chunk.id)?.state === 'deferred',
            }))
            .sort((a, b) => (Number(a.isDeferred) - Number(b.isDeferred)) || (a.createdAt - b.createdAt) || String(a.id).localeCompare(String(b.id)));
        if (!chunks.length) {
            upToDate++;
            updateState.updateJob(runId, ent.id, { status: 'skipped' });
            continue;
        }

        const nativeFieldLines = allowed.map(field => {
            const shape = ENRICH_ENUMS[field]
                ? `one of [${ENRICH_ENUMS[field].join(', ')}]`
                : 'a concise literal value';
            const state = emptyWritableFields.includes(field) ? 'EMPTY' : 'CURRENT VALUE PRESENT';
            return `- ${field} [${state}]: ${shape}. ${ENRICH_FIELD_GUIDANCE[field]}`;
        });
        const customFieldLines = writableCustomFields.map(field =>
            `- customFields.${field.key} [${customFieldState(field, ent, emptyWritableFields)}]: ${customFieldPromptShape(field)}. ${field.aiGuidance || `Use this field only for the meaning expressed by “${field.label}”.`}`
        );
        const fieldLines = [...nativeFieldLines, ...customFieldLines].join('\n');
        const relSpecs = enrichRelationsForEntity(ent);
        const fence = buildItemsFence();
        // A later pass of this run builds on what the earlier ones staged, or it would replace a
        // field, the lore or a link it never saw. Only the prompt sees them; live data stays.
        const carried = extraPasses.has(ent.id) && ent.data?._enrichPending && typeof ent.data._enrichPending === 'object'
            ? ent.data._enrichPending : null;
        if (carried?.lore?.value) ent.lore = carried.lore.value;
        const currentData = {};
        for (const f of allowed) if (ent.data && ent.data[f] != null) currentData[f] = ent.data[f];
        for (const [f, proposal] of Object.entries(carried?.data || {})) {
            if (allowed.includes(f) && proposal?.value != null) currentData[f] = proposal.value;
        }
        const currentCustomFields = {};
        for (const field of visibleCustomFields) {
            const value = ent.data?.customFields?.[field.key];
            if (value != null) currentCustomFields[field.key] = {
                label: field.label,
                value: choiceOptionLabels(field, value),
                access: field.aiAccess,
                ...(field.aiGuidance ? { guidance: field.aiGuidance } : {})
            };
        }

        const evidencePrefix = crypto.randomBytes(2).toString('hex');
        const runChunkIds = new Set(chunks.map(chunk => chunk.id));
        const evidenceEntries = chunks.map((chunk, index) => {
            const lead = precedingPassageText(precedingChunk, chunk, runChunkIds);
            return {
                id: `E_${evidencePrefix}_${index + 1}`,
                order: index,
                chunk,
                // A played turn the story pass already read, or a recap of the story, feeds the sheet only.
                coverage: storyCoverage.classify(chunk),
                prompt: `[E_${evidencePrefix}_${index + 1} | ${chunk.evidenceSource}: ${chunk.source || 'Untitled'} | ${chunk.isTagged ? 'indexed entity match' : 'name or alias match'} | chunk ${chunk.id}]\n` +
                    (lead ? `(Preceding passage of the same source, context only and never evidence: ${lead})\n` : '') +
                    chunk.text
            };
        });
        let includedEvidence = selectEntityEvidence(evidenceEntries);
        const includedIds = new Set(includedEvidence.map(entry => entry.id));
        const skippedTextualEvidence = evidenceEntries.filter(entry => !entry.chunk.isTagged && !includedIds.has(entry.id));
        const pendingTaggedEvidence = evidenceEntries.filter(entry => entry.chunk.isTagged && !includedIds.has(entry.id));
        const evidenceWindow = includedEvidence.map(entry => entry.prompt).join('\n\n');
        const chunkIds = includedEvidence.map(entry => entry.chunk.id);
        const relatedIds = new Set();
        if (chunkIds.length) {
            const placeholders = chunkIds.map(() => '?').join(', ');
            for (const row of db.prepare(`SELECT DISTINCT entity FROM chunk_tags WHERE chunkId IN (${placeholders}) AND entity IS NOT NULL`).all(...chunkIds)) {
                relatedIds.add(row.entity);
            }
        }

        const relBlocks = [];
        const currentLinks = [];
        const relationshipBlock = { names: [], line: '' };
        const currentRelationships = [];
        for (const spec of relSpecs) {
            const existing = existingLinksByTarget(ent.id, spec);
            const candidates = relationCandidates(all, ent, spec).filter(candidate =>
                existing.has(candidate.id)
                || relatedIds.has(candidate.id)
                || textMentionsEntity(evidenceWindow, entityMentionNames(candidate))
            );
            const names = candidates.map(candidate => candidate.canonicalName);
            const guidance = ENRICH_RELATION_GUIDANCE[`${ent.type}.${spec.key}`] || 'Only when the exact relation is explicitly established.';
            // Stated with this record's name, since a generic rule about direction is the one models skip.
            const direction = ENRICH_RELATION_DIRECTION[`${ent.type}.${spec.key}`]?.(ent.canonicalName);
            if (spec.detailed) {
                // Bonds are the story's: they belong to the pass that reads what the story record has not.
                for (const link of existing.values()) {
                    currentRelationships.push({
                        target: link.entity.canonicalName,
                        targetRole: link.label || '',
                        value: Number(link.metadata?.value || 0),
                        sourcePerspective: String(link.metadata?.description || ''),
                    });
                }
                if (names.length) relationshipBlock.names = names;
                relationshipBlock.line = `${direction ? `${direction} ` : ''}${guidance}`;
                continue;
            }
            if (!names.length) continue;
            const operation = `kind "link", key "${spec.key}", target one candidate${spec.labeled ? `, targetRole ${spec.roleMeaning || 'what TARGET is to SOURCE'}` : ''}`;
            relBlocks.push({ spec, names, line: `- ${spec.label}: ${operation}.${direction ? ` ${direction}` : ''} ${guidance} Candidates: ${names.join(', ')}` });
            for (const link of existing.values()) {
                currentLinks.push({
                    field: spec.key,
                    source: ent.canonicalName,
                    target: link.entity.canonicalName,
                    ...(link.label ? { targetRole: link.label } : {}),
                });
            }
        }
        for (const link of Array.isArray(carried?.links) ? carried.links : []) {
            if (link?.targetName) currentLinks.push({ field: link.relKey, source: ent.canonicalName, target: link.targetName, ...(link.label ? { targetRole: link.label } : {}) });
        }
        for (const relationship of (runRelationships.get(ent.id) || new Map()).values()) currentRelationships.push(relationship);
        let relevantSystems = [];
        if (chunkIds.length) {
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
        const skillContext = entitySkillContext(skillSystem, workspaceId, ent, evidenceWindow);
        const skillOperations = skillContext ? [
            skillContext.config.aiAssigns ? 'give a catalog skill the evidence shows them using or having' : '',
            skillContext.config.aiRaises ? 'raise a held skill when the evidence shows a level beyond its current rank' : '',
            skillContext.config.aiCreates ? 'add a new skill when no catalog skill covers a clearly shown ability' : '',
        ].filter(Boolean) : [];
        const skillLines = skillContext
            ? `SKILLS (the world's Rules). Ranks from lowest to highest: ${skillContext.config.ranks.join(', ')}.\n` +
                `Held: ${skillContext.held.length ? skillContext.held.map(skill => `${skill.name} (${skill.rankName})`).join(', ') : '(none)'}\n` +
                (skillContext.related.length ? `Catalog skills these passages may concern:\n${skillContext.related.map(skill => `- ${skillContext.describe(skill)}`).join('\n')}\n` : '') +
                `You may ${skillOperations.join('; ')}.` +
                (skillContext.config.guidance?.trim() ? `\nWorld rule for skills: ${skillContext.config.guidance.trim()}` : '') + '\n'
            : '';
        const playerLine = playerEntity
            ? `The player character is ${playerEntity.canonicalName} (id ${playerEntity.id})${playerEntity.id === ent.id ? ', this record' : ''}.\n`
            : '';
        const canonKinds = ['field', 'link', ...(allowLore ? ['history'] : []), ...(skillContext ? ['skill'] : [])];
        const canonPrompt = evidence =>
            `RECORD TYPE: ${ent.type.replace(/s$/, '')}\n` +
            `ENTITY TYPE CONTRACT:\n${ENRICH_TYPE_GUIDANCE[ent.type] || 'A persistent canonical world entity.'}\n` +
            `Kinds allowed for this record: ${canonKinds.join(', ')}.\n` +
            (fieldLines ? `Allowed data fields:\n${fieldLines}\n` : '') +
            (relBlocks.length ? `Allowed links (use the exact candidate names, never invent a name):\n${relBlocks.map(b => b.line).join('\n')}\n` : '') +
            skillLines +
            playerLine +
            `\n${allowLore ? 'CURRENT RECORD' : 'CURRENT CONCEPT'}:\nName: ${ent.canonicalName}\nAliases: ${ent.aliases?.join(', ') || '(none)'}\n` +
            (ent.type === 'Items' ? `Item nature: ${(ent.data?.itemNature || 'type') === 'unique' ? 'unique item (one persistent object; may have one owner or current location)' : 'item type (repeatable category; may have abundance and availability locations, never one fixed owner or current location)'}\n` : '') +
            (allowLore ? `Lore (background): ${ent.lore ? ent.lore : '(no lore yet)'}\n` : '') +
            (Object.keys(currentData).length ? `Current fields: ${JSON.stringify(currentData)}\n` : '') +
            (Object.keys(currentCustomFields).length ? `Current custom fields (read-only fields are context and must never be proposed): ${JSON.stringify(currentCustomFields)}\n` : '') +
            (currentLinks.length ? `Current links: ${JSON.stringify(currentLinks)}\n` : '') +
            (systemContext ? `\nCANONICAL SYSTEM / CONCEPT CONTEXT:\n${systemContext}\n` : '') +
            `\nNEW STORY EVIDENCE (chronological):\n${evidence}`;

        // Only passages the story record never read can hold memories, knowledge or bonds to record.
        const narrativeCapable = ['Characters', 'Creatures', 'Factions', 'Items', 'Locations', 'Events'].includes(ent.type);
        const narrativeEntries = narrativeCapable ? includedEvidence.filter(entry => entry.coverage === 'open') : [];
        const openEvidenceIds = new Set(narrativeEntries.map(entry => entry.id));
        let narrativePrompt = null;
        if (narrativeEntries.length) {
            const narrativeWindow = narrativeEntries.map(entry => entry.prompt).join('\n\n');
            const narrativeEntities = all
                .filter(candidate => candidate.status !== 'proposed' && (
                    candidate.id === ent.id
                    || relatedIds.has(candidate.id)
                    || textMentionsEntity(narrativeWindow, entityMentionNames(candidate))
                ))
                .slice(0, 60);
            const narrativeIds = new Set(narrativeEntities.map(candidate => candidate.id));
            // How others see this entity comes first; then a few bonds per person, so one cast list cannot fill it.
            const otherRelationships = narrativeEntities
                .filter(candidate => candidate.id !== ent.id && ['Characters', 'Creatures'].includes(candidate.type))
                .flatMap(candidate => entitiesStore.getLinksFrom(candidate.id, 'related_to')
                    .filter(link => narrativeIds.has(link.entity?.id))
                    .sort((a, b) => Number(b.entity.id === ent.id) - Number(a.entity.id === ent.id) || Number(relatedIds.has(b.entity.id)) - Number(relatedIds.has(a.entity.id)))
                    .slice(0, 3)
                    .map(link => ({
                        aboutThis: link.entity.id === ent.id,
                        line: `- ${candidate.canonicalName} → ${link.entity.canonicalName}: "${link.label || ''}", score ${Number(link.metadata?.value || 0)}${link.metadata?.description ? `; ${String(link.metadata.description).slice(0, 80)}` : ''}`,
                    })))
                .sort((a, b) => Number(b.aboutThis) - Number(a.aboutThis))
                .slice(0, 12)
                .map(entry => entry.line);
            const knownMemories = ['Characters', 'Creatures'].includes(ent.type)
                ? await memoryIndex.nearest(ent.id, narrativeEntries.map(entry => String(entry.chunk.text || '').slice(0, 1500)))
                : [];
            narrativePrompt = evidence =>
                `RECORD: ${ent.canonicalName} (${ent.type.replace(/s$/, '')}, id ${ent.id})\n` +
                playerLine +
                `\nENTITY IDS FOR FINDINGS:\n${narrativeEntities.map(candidate => `- ${candidate.canonicalName}: ${candidate.id}`).join('\n')}\n` +
                (relationshipBlock.line ? `\nRELATIONSHIPS of ${ent.canonicalName}: SOURCE is ${ent.canonicalName}. ${relationshipBlock.line}${relationshipBlock.names.length ? ` Candidates: ${relationshipBlock.names.join(', ')}` : ''}\n` : '') +
                (currentRelationships.length ? `CURRENT RELATIONSHIPS of ${ent.canonicalName}: ${JSON.stringify(currentRelationships)}\n` : '') +
                (otherRelationships.length ? `EXISTING RELATIONSHIPS OF OTHERS (how each one already sees the other):\n${otherRelationships.join('\n')}\n` : '') +
                (knownMemories.length ? `EXISTING MEMORIES of ${ent.canonicalName} (already recorded, never tell these scenes again):\n${knownMemories.map(summary => `- ${summary}`).join('\n')}\n` : '') +
                (systemContext ? `\nCANONICAL SYSTEM / CONCEPT CONTEXT:\n${systemContext}\n` : '') +
                `\nNEW STORY EVIDENCE (chronological):\n${evidence}`;
        }

        try {
            const maxTokens = entityEnrichmentMaxTokens(ent, estimateTokens(evidenceWindow));
            // A sheet's job row holds every pass of this run, not only the last one.
            let inputTokenEstimate = passTokens.get(ent.id)?.input || 0;
            let outputTokenEstimate = passTokens.get(ent.id)?.output || 0;
            let retryCount = 0;
            const entityLabels = loadEntityLabels(workspaceId);
            const sendJsonRequest = async (requestParams, schema) => {
                // Worldbuild text is rewritten here, so its spoiler markers must reach the model and come back.
                const systemText = entityLabels.encode(requestParams.systemPrompt);
                const params = {
                    maxPayloadTokens: workspacePayloadTokens(workspaceId),
                    keepSpoilerMarkers: true,
                    ...requestParams,
                    systemPrompt: systemText,
                    newPrompt: entityLabels.encode(requestParams.newPrompt),
                    // The rules of a pass are the same for every sheet of the run, so later sheets read them from cache.
                    ...(requestParams.cacheScope ? { promptCache: { policy: 'conversation', scopeId: `${requestParams.cacheScope}:${workspaceId}`, ttl: '5m', stable: systemText, volatile: '' } } : {}),
                };
                delete params.cacheScope;
                const estimatedInput = estimateTokens(`${params.systemPrompt || ''}\n${params.newPrompt || ''}\n${JSON.stringify(schema || {})}`);
                try {
                    const result = await sendApiRequest({ ...params, jsonMode: true, jsonSchema: schema, includeResponseMetadata: true });
                    inputTokenEstimate += result.inputTokens || estimatedInput;
                    outputTokenEstimate += result.outputTokens || estimateTokens(result.content);
                    return { ...result, content: entityLabels.decode(result.content) };
                } catch (error) {
                    if (!/response.?format|json.?mode|structured output|output_config.*(unsupported|not supported)|compiled grammar.*too large|tool schemas?.*too large|reduce the number of strict tools/i.test(String(error.message || ''))) throw error;
                    console.warn(`[Enrich] Structured output unavailable for ${ent.canonicalName}; retrying with prompt validation:`, error.message);
                    retryCount++;
                    const result = await sendApiRequest({ ...params, jsonMode: false, jsonSchema: null, includeResponseMetadata: true });
                    inputTokenEstimate += result.inputTokens || estimateTokens(`${params.systemPrompt || ''}\n${params.newPrompt || ''}`);
                    outputTokenEstimate += result.outputTokens || estimateTokens(result.content);
                    return { ...result, content: entityLabels.decode(result.content) };
                }
            };
            // One pass of the sheet: a reply cut short is asked again with less evidence and more room,
            // anything else malformed goes to a repair; what a smaller request leaves out stays pending.
            const runPass = async ({ scope, systemPrompt, schema, entries, buildPrompt }) => {
                let used = entries;
                const ask = (prompt, tokenBudget) => sendJsonRequest({
                    apiProfileId, model, systemPrompt, chatHistory: [], newPrompt: prompt,
                    temperature: 0.1, maxTokens: tokenBudget, manualMode, manualJson, cacheScope: scope,
                }, schema);
                let result = await ask(buildPrompt(used.map(entry => entry.prompt).join('\n\n')), maxTokens);
                let response = result.content;
                let parsedPass = parseEntityUpdateObject(response).value;
                if (isEntityUpdateShape(parsedPass)) return { parsed: parsedPass, used, dropped: [] };
                const firstFailure = describeEntityUpdateFailure(result, parsedPass, fence);
                logEntityUpdateFailure(ent, `${scope} first attempt`, firstFailure, result);
                const retryTokens = entityUpdateRetryTokens(firstFailure.cause, maxTokens);
                retryCount++;
                let dropped = [];
                if (firstFailure.cause === 'budget' || firstFailure.cause === 'empty') {
                    const reduced = selectEntityEvidence(used, Math.max(1200, Math.floor(estimateTokens(used.map(entry => entry.prompt).join('\n\n')) / 2)));
                    const reducedIds = new Set(reduced.map(entry => entry.id));
                    dropped = used.filter(entry => !reducedIds.has(entry.id));
                    if (reduced.length && dropped.length) used = reduced;
                    else dropped = [];
                    result = await ask(buildPrompt(used.map(entry => entry.prompt).join('\n\n')), retryTokens);
                } else {
                    result = await sendJsonRequest({
                        apiProfileId, model,
                        systemPrompt: `${systemPrompt}\nREPAIR TASK: Correct only the JSON syntax and required shape of the supplied response. Preserve its proposed values, evidence IDs, SOURCE, and TARGET direction. Return only the corrected JSON object.`,
                        chatHistory: [],
                        newPrompt: `INVALID RESPONSE TO REPAIR:\n${String(response || '').slice(0, 12000)}`,
                        temperature: 0, maxTokens: retryTokens, manualMode, manualJson,
                    }, schema);
                }
                response = result.content;
                parsedPass = parseEntityUpdateObject(response).value;
                if (isEntityUpdateShape(parsedPass)) return { parsed: parsedPass, used, dropped };
                const retryFailure = describeEntityUpdateFailure(result, parsedPass, fence);
                logEntityUpdateFailure(ent, `${scope} retry`, retryFailure, result);
                const finish = result.finishReason ? ` Finish reason: ${result.finishReason}.` : '';
                return {
                    failure: `${retryFailure.message} Automatic retry also failed.${finish} Response length: ${String(response || '').length}. First response: ${firstFailure.message}`,
                    failureMessage: retryFailure.message,
                    used,
                    dropped,
                };
            };
            updateState.transition(workspaceId, ent.id, includedEvidence, 'queued', runId);
            const deferredEvidence = evidenceEntries.filter(entry => !includedIds.has(entry.id));
            updateState.transition(workspaceId, ent.id, deferredEvidence, 'deferred', runId, 'token-budget');

            const canonPass = await runPass({
                scope: 'entity-update-sheet',
                systemPrompt: canonSystemPrompt,
                schema: buildEntityUpdateSchema({ pass: 'canon', kinds: canonKinds }),
                entries: includedEvidence,
                buildPrompt: canonPrompt,
            });
            const leaveForLater = dropped => {
                if (!dropped.length) return;
                updateState.transition(workspaceId, ent.id, dropped, 'deferred', runId, 'token-budget');
                deferredEvidence.push(...dropped);
                pendingTaggedEvidence.push(...dropped.filter(entry => entry.chunk.isTagged));
            };
            if (canonPass.failure) {
                failed++;
                consecutiveStructuredFailures++;
                rememberFailure(ent, canonPass.failure);
                updateState.transition(workspaceId, ent.id, includedEvidence, 'deferred', runId, 'invalid-structured-output');
                updateState.updateJob(runId, ent.id, {
                    status: 'failed',
                    input_tokens: inputTokenEstimate,
                    output_tokens: outputTokenEstimate,
                    retry_count: retryCount,
                    evidence_used: includedEvidence.length,
                    error: canonPass.failureMessage,
                });
                continue;
            }
            leaveForLater(canonPass.dropped);
            includedEvidence = canonPass.used;
            const changes = [...canonPass.parsed.changes];
            let narrativeFailure = null;
            if (narrativePrompt) {
                const narrativeCandidates = narrativeEntries.filter(entry => includedEvidence.includes(entry));
                if (narrativeCandidates.length) {
                    const narrativePass = await runPass({
                        scope: 'entity-update-story',
                        systemPrompt: narrativeSystemPrompt,
                        schema: buildEntityUpdateSchema({ pass: 'narrative', causes: [...DURABLE_RELATIONSHIP_CAUSES] }),
                        entries: narrativeCandidates,
                        buildPrompt: narrativePrompt,
                    });
                    if (narrativePass.failure) {
                        narrativeFailure = narrativePass.failure;
                        // The sheet's findings stand; the passages the story pass needs are read again next run.
                        updateState.transition(workspaceId, ent.id, narrativeCandidates, 'deferred', runId, 'invalid-structured-output');
                        const failedIds = new Set(narrativeCandidates.map(entry => entry.id));
                        includedEvidence = includedEvidence.filter(entry => !failedIds.has(entry.id));
                    } else {
                        const droppedIds = new Set(narrativePass.dropped.map(entry => entry.id));
                        if (droppedIds.size) {
                            updateState.transition(workspaceId, ent.id, narrativePass.dropped, 'deferred', runId, 'token-budget');
                            includedEvidence = includedEvidence.filter(entry => !droppedIds.has(entry.id));
                        }
                        changes.push(...narrativePass.parsed.changes.filter(change => NARRATIVE_KINDS.includes(change.kind)));
                    }
                }
            }
            if (narrativeFailure) rememberFailure(ent, narrativeFailure);
            consecutiveStructuredFailures = 0;
            let parsed = decodeEntityUpdate({ changes: changes.filter(change => change && typeof change === 'object') });

            const policy = ent.data?.aiPolicy || 'review';
            const incoming = (parsed.data && typeof parsed.data === 'object') ? parsed.data : {};
            const validEvidenceIds = new Set(includedEvidence.map(entry => entry.id));
            const readProposal = (raw) => {
                if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.value == null) return null;
                const support = String(raw.support || '').trim();
                if (!support) return null;
                const evidence = (Array.isArray(raw.evidence) ? raw.evidence : [])
                    .map(String)
                    .filter(id => validEvidenceIds.has(id));
                const value = String(raw.value).trim();
                return value && evidence.length ? { value, evidence, support } : null;
            };
            const readTypedProposal = (raw) => {
                if (!raw || typeof raw !== 'object' || Array.isArray(raw) || raw.value == null) return null;
                const support = String(raw.support || '').trim();
                if (!support) return null;
                const evidence = (Array.isArray(raw.evidence) ? raw.evidence : [])
                    .map(String)
                    .filter(id => validEvidenceIds.has(id));
                return evidence.length ? { value: raw.value, evidence, support } : null;
            };
            // Validate the AI's proposal against the allowlist + enums first, keeping only
            // fields whose value actually differs from what the entity holds now. `review`
            // and `open` share this diff; they only differ in where it lands.
            const proposedData = {};
            for (const f of allowed) {
                const proposal = readProposal(incoming[f]);
                if (!proposal) continue;
                let v = proposal.value;
                if (f === 'age' && isUnsupportedNumericDelta(v, proposal.support)) continue;
                if (ENRICH_ENUMS[f]) {
                    const match = ENRICH_ENUMS[f].find(o => o.toLowerCase() === v.toLowerCase());
                    if (!match) continue;
                    v = match;
                }
                const cur = ent.data?.[f] == null ? '' : String(ent.data[f]).trim();
                if (WRITTEN_TEXT_FIELDS.has(f) && isWeakTextReplacement(cur, v)) continue;
                // A rewrite that drops or alters a spoiler would show it to the reader; the field keeps its text.
                if (WRITTEN_TEXT_FIELDS.has(f) && missingSpoilers(cur, v).length) continue;
                if (v !== cur) proposedData[f] = { value: v, evidence: proposal.evidence, support: proposal.support };
            }
            for (const field of writableCustomFields) {
                const proposal = readTypedProposal(incoming[`customFields.${field.key}`]);
                if (!proposal) continue;
                if ((field.valueType === 'number' || field.valueType === 'range')
                    && isUnsupportedNumericDelta(proposal.value, proposal.support)) continue;
                const value = normalizeCustomProposalValue(proposal.value, field, workspaceId);
                if (value === undefined) continue;
                const current = ent.data?.customFields?.[field.key];
                if (JSON.stringify(value) !== JSON.stringify(current)) {
                    proposedData[`customFields.${field.key}`] = {
                        value,
                        evidence: proposal.evidence,
                        support: proposal.support,
                        fieldLabel: field.label
                    };
                }
            }
            const relationshipLinkChanges = relBlocks.flatMap(({ spec }) => {
                if (!spec.detailed) return [];
                const raw = parsed.links?.[spec.key];
                return (Array.isArray(raw) ? raw : raw ? [raw] : []).map(item => ({
                    kind: 'relationship',
                    subjectId: ent.id,
                    targetId: resolveRelationTarget(String(item.target || '').trim(), spec, workspaceId) || '',
                    perspectiveOwnerId: ent.id,
                    key: 'overall',
                    value: '',
                    target: String(item.target || '').trim(),
                    targetRole: String(item.targetRole || '').trim(),
                    sourcePerspective: String(item.sourcePerspective || '').trim(),
                    score: Number(item.value),
                    method: '',
                    accessibility: '',
                    support: String(item.support || '').trim(),
                    evidence: Array.isArray(item.evidence) ? item.evidence.map(String) : [],
                }));
            });
            const relationshipSpec = relSpecs.find(spec => spec.detailed);
            // A new relationship that names no feeling is an empty card in the review.
            const isEmptyRelationship = change => {
                if (change.kind !== 'relationship' || !relationshipSpec) return false;
                const ownerId = change.subjectId || ent.id;
                const targetId = all.some(entity => entity.id === change.targetId)
                    ? change.targetId
                    : resolveRelationTarget(change.target, relationshipSpec, workspaceId);
                // An existing one is edited later, from what it already says.
                return !(targetId && currentRelationship(ownerId, targetId)) && Math.round(Number(change.score) || 0) === 0;
            };
            const earlierRelationships = runRelationships.get(ent.id) || new Map();
            const relationshipKey = change => foldText(change.target || change.targetId || '');
            // The pair is read by owner and target, so a sheet that proposes someone else's bond with it
            // meets the one that sheet already proposed.
            const relationshipPair = change => {
                const targetId = all.some(entity => entity.id === change.targetId)
                    ? change.targetId
                    : (relationshipSpec && resolveRelationTarget(change.target, relationshipSpec, workspaceId)) || '';
                const target = targetId || relationshipKey(change);
                return target ? `${change.subjectId || ent.id}\u0000${target}` : '';
            };
            // The same pairs the sheets allow: a being relates to beings, and a faction to factions and
            // beings. A place, item or species neither holds a relationship nor is the target of one.
            const isBeing = entity => Boolean(entity) && (entity.type === 'Characters'
                || (entity.type === 'Creatures' && (entity.data?.scope || 'individual') !== 'group'));
            const canRelate = (owner, target) => Boolean(owner && target) && owner.id !== target.id
                && (isBeing(owner) ? isBeing(target) : owner.type === 'Factions' && (isBeing(target) || target.type === 'Factions'));
            const isAllowedBond = change => {
                const owner = all.find(entity => entity.id === (change.subjectId || ent.id));
                const name = foldText(change.target || '');
                const target = all.find(entity => entity.id === change.targetId)
                    || (name ? all.find(entity => [entity.canonicalName, ...(entity.aliases || [])].some(alias => foldText(alias) === name)) : null);
                return canRelate(owner, target);
            };
            const proposedBefore = change => {
                const pair = relationshipPair(change);
                if (!pair) return false;
                if (runRelationshipPairs.has(pair)) return true;
                runRelationshipPairs.add(pair);
                return false;
            };
            const narrativeChanges = [...parsed.narrative, ...relationshipLinkChanges].filter(change =>
                !(ent.type === 'Characters' && change.kind === 'fact')
                && change.support
                && change.evidence.some(id => validEvidenceIds.has(id))
                // A played turn the story pass read already has its memories, knowledge and bonds.
                && change.evidence.some(id => openEvidenceIds.has(id))
                && !isEmptyRelationship(change)
                && (change.kind !== 'relationship' || isAllowedBond(change))
                // A relationship already proposed in this run, by this sheet or another, is not proposed twice.
                && !(change.kind === 'relationship' && proposedBefore(change))
            );
            for (const change of narrativeChanges) {
                if (change.kind !== 'relationship' || !relationshipKey(change)) continue;
                earlierRelationships.set(relationshipKey(change), {
                    field: 'relationships', source: ent.canonicalName, target: change.target || change.targetId,
                    ...(change.targetRole ? { targetRole: change.targetRole } : {}),
                    value: Math.round(Number(change.score) || 0), sourcePerspective: change.sourcePerspective || '',
                });
            }
            runRelationships.set(ent.id, earlierRelationships);

            const proposedLinks = [];
            const incomingLinks = (parsed.links && typeof parsed.links === 'object') ? parsed.links : {};
            for (const { spec } of relBlocks) {
                if (spec.detailed) continue;
                const raw = incomingLinks[spec.key];
                if (raw == null) continue;
                const items = Array.isArray(raw) ? raw : [raw];
                const existing = existingLinksByTarget(ent.id, spec);
                const seen = new Set();
                for (const item of items) {
                    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
                    const support = String(item.support || '').trim();
                    if (!support) continue;
                    const evidence = (Array.isArray(item.evidence) ? item.evidence : [])
                        .map(String)
                        .filter(id => validEvidenceIds.has(id));
                    if (!evidence.length) continue;
                    const name = String(item.target || item.name || '').trim();
                    if (!name) continue;
                    const rawTargetRole = item.targetRole ?? item.label;
                    const label = spec.labeled && rawTargetRole != null ? normalizeRelationshipLabel(rawTargetRole) : null;
                    let targetId = resolveRelationTarget(name, spec, workspaceId);
                    if (!targetId || targetId === ent.id) continue;
                    // A name shared by a specific being and a species must land on the shape asked for.
                    if (spec.targetScope && !relationCandidates(all, ent, spec).some(candidate => candidate.id === targetId)) continue;
                    if (PLACE_LINKS.has(spec.key)) {
                        const place = placeLinkTarget({ targetId, support, candidates: relationCandidates(all, ent, spec) });
                        if (!place) continue;
                        targetId = place.id;
                    }
                    const existingLink = existing.get(targetId);
                    // A link already on the sheet only takes the job it was missing.
                    if (existingLink) {
                        if (spec.labeled && label && !existingLink.label && !seen.has(`${targetId}:job`)) {
                            seen.add(`${targetId}:job`);
                            proposedLinks.push({ relKey: spec.key, relLabel: spec.label, relType: spec.relType, from: spec.from, single: !!spec.single, label, metadata: undefined, existingLinkId: existingLink.linkId, targetId, targetName: existingLink.entity.canonicalName, evidence, support });
                        }
                        continue;
                    }
                    const dedupe = `${targetId}:${label || ''}`;
                    if (seen.has(dedupe)) continue;
                    seen.add(dedupe);
                    proposedLinks.push({ relKey: spec.key, relLabel: spec.label, relType: spec.relType, from: spec.from, single: !!spec.single, label, metadata: undefined, existingLinkId: undefined, targetId, targetName: name, evidence, support });
                    if (spec.single) break; // one target for single-valued relations
                }
            }

            // Lore is background: only a statement about the past before the story, or the origin of
            // something born in it, reaches it.
            const historyFindings = (parsed.history || []).filter(finding => ['before-story', 'origin'].includes(finding.era)
                && finding.support && finding.evidence.some(id => validEvidenceIds.has(id)));
            let loreProposal = null;
            let loreFailure = null;
            if (allowLore && historyFindings.length) {
                const canonicalFindings = historyFindings;
                if (canonicalFindings.length) {
                    try {
                        const citedIds = new Set(canonicalFindings.flatMap(finding => finding.evidence || []));
                        const loreEvidence = includedEvidence
                            .filter(entry => citedIds.has(entry.id))
                            .map(entry => entry.prompt)
                            .join('\n\n')
                            .slice(0, 6000);
                        // A long lore is extended instead of rewritten: a full rewrite stops fitting the output limit.
                        const appendLore = loreNeedsAppend(ent.lore, maxTokens);
                        const loreSystemPrompt = `${getSystemLanguageInstruction()}\n${getSourceLanguageInstruction()}\n${appendLore
                            ? 'You extend grounded world-bible lore with new paragraphs from validated findings.'
                            : 'You compose grounded cumulative world-bible lore from validated findings.'} Never invent or collapse an established entity into one event.`;
                        const lorePrompt = (appendLore ? buildLoreAppendPrompt : buildLorePrompt)({
                            entityName: ent.canonicalName,
                            entityType: ent.type,
                            currentLore: ent.lore,
                            findings: canonicalFindings,
                            evidence: loreEvidence,
                            skillsInUse: Boolean(skillContext),
                        });
                        let loreResult = null;
                        let loreObject = null;
                        let lostSpoilers = [];
                        // A lore that loses a spoiler is asked for once more, naming what must stay;
                        // a second loss is reported and the stored lore is left as it is.
                        for (let attempt = 0; attempt < 2; attempt++) {
                            loreResult = await sendJsonRequest({
                                apiProfileId,
                                model,
                                systemPrompt: loreSystemPrompt,
                                chatHistory: [],
                                newPrompt: attempt === 0 ? lorePrompt : `${lorePrompt}\n\n${buildSpoilerRetryNote(lostSpoilers)}`,
                                temperature: 0.1,
                                maxTokens,
                                manualMode,
                                manualJson,
                            }, buildEntityLoreSchema());
                            loreObject = parseEntityUpdateObject(loreResult.content).value;
                            loreProposal = appendLore
                                ? validateEntityLoreAppend(loreObject, ent.lore, validEvidenceIds)
                                : validateEntityLore(loreObject, ent.lore, validEvidenceIds);
                            lostSpoilers = loreProposal ? missingSpoilers(ent.lore, loreProposal.value) : [];
                            if (!lostSpoilers.length) break;
                            if (attempt === 0) retryCount++;
                        }
                        if (lostSpoilers.length) {
                            loreProposal = null;
                            loreFailure = `The Lore update for ${ent.canonicalName} would have removed or changed a spoiler, so it was not applied.`;
                            console.warn(`[Entity Update] ${loreFailure}`);
                        }
                        // A cut-off or unreadable reply is a failure; a valid no-op stays silent.
                        if (!loreProposal && !loreFailure && (loreResult.truncated || !loreObject)) {
                            loreFailure = loreResult.truncated
                                ? `The Lore update for ${ent.canonicalName} reached the System AI output limit and was not applied.`
                                : `The Lore update for ${ent.canonicalName} could not be read and was not applied.`;
                            console.warn(`[Entity Update] ${loreFailure} finishReason=${loreResult.finishReason ?? 'unknown'}`);
                        }
                        // The reading labels the era of what it found and gets it wrong for scenes of the
                        // story; each new sentence is sorted again on its own, and story ones are dropped.
                        if (loreProposal) {
                            const kept = await keepBackgroundSentences({
                                entity: ent,
                                currentLore: ent.lore,
                                nextLore: loreProposal.value,
                                classify: (systemPrompt, prompt, tokens) => sendJsonRequest({
                                    apiProfileId, model, systemPrompt, chatHistory: [], newPrompt: prompt,
                                    temperature: 0, maxTokens: tokens, manualMode, manualJson, cacheScope: 'entity-update-lore',
                                }, buildLoreCleanupSchema()),
                            });
                            loreProposal = kept ? { ...loreProposal, value: kept } : null;
                        }
                    } catch (error) {
                        loreFailure = `The Lore update for ${ent.canonicalName} failed: ${cleanErrorMessage(error)}`;
                        console.warn(`[Entity Update] ${loreFailure}`);
                    }
                }
            }
            const incomingLore = loreProposal?.value || '';
            const loreChanged = Boolean(loreProposal);

            const skillChanges = [];
            if (skillContext) {
                const { config: skillConfig, held } = skillContext;
                const rankOf = name => skillConfig.ranks.findIndex(rank => comparableText(rank) === comparableText(name));
                const skillProvenance = `entity-update:${runId}:${ent.id}`;
                for (const finding of parsed.skills || []) {
                    if (!finding.support || !finding.evidence.some(id => validEvidenceIds.has(id))) continue;
                    const requested = rankOf(finding.rank);
                    const known = skillSystem.findSkillByReference(workspaceId, finding.name);
                    const heldSkill = known ? held.find(skill => skill.skillId === known.id) : null;
                    let operation = null;
                    // Documents are read out of order, so a rank only rises toward a level the evidence
                    // shows, one step a run, and never falls.
                    if (heldSkill) {
                        if (skillConfig.aiRaises && requested > heldSkill.rank) operation = { kind: 'rank', skillKey: known.key, direction: 1 };
                    } else if (known) {
                        if (skillConfig.aiAssigns && known.status === 'confirmed') operation = { kind: 'assign', skillKey: known.key, rank: Math.max(0, requested) };
                    } else if (skillConfig.aiCreates && finding.description) {
                        operation = { kind: 'create', name: finding.name, description: finding.description, parentKey: finding.parent || undefined, rank: Math.max(0, requested) };
                    }
                    if (!operation) continue;
                    try {
                        const change = skillSystem.proposeChange({
                            id: `${skillProvenance}:skill:${crypto.createHash('sha256').update(comparableText(finding.name)).digest('hex').slice(0, 12)}`,
                            workspaceId,
                            entityId: ent.id,
                            ...operation,
                            reason: finding.support.slice(0, 240),
                            source: 'ai',
                            provenanceId: skillProvenance,
                            forceReview: policy !== 'open',
                        });
                        if (change) skillChanges.push(change);
                    } catch (error) {
                        console.warn(`[Entity Update] Ignored a skill change for ${ent.canonicalName}:`, error.message);
                    }
                }
            }

            const narrativeSuggestion = await submitEntityNarrativeSuggestions({
                workspaceId,
                entity: ent,
                changes: narrativeChanges,
                allEntities: all,
                evidenceEntries: includedEvidence,
                interpreterId: `${apiProfileId}:${model}`,
                memoryIndex,
            });
            const hasCanonicalChange = Object.keys(proposedData).length || loreChanged || proposedLinks.length;
            const hasChange = hasCanonicalChange || narrativeSuggestion?.record || skillChanges.length;
            evidenceUsed += includedEvidence.length;
            // A sheet with evidence left over gets another pass in this run, so a dense source is read
            // in full without the person running the update again.
            const passes = extraPasses.get(ent.id) || 0;
            if (pendingTaggedEvidence.length && passes < MAX_EXTRA_ENTITY_PASSES) {
                extraPasses.set(ent.id, passes + 1);
                targets.push(targets[i]);
            } else {
                taggedEvidenceRemaining += pendingTaggedEvidence.length;
            }
            textMatchesDeferred += skippedTextualEvidence.length;
            const canonicalProposalCount = Object.keys(proposedData).length
                + proposedLinks.length
                + (loreChanged ? 1 : 0);
            const narrativeProposalCount = narrativeSuggestion?.operationCount || 0;
            const proposalCount = canonicalProposalCount + narrativeProposalCount + skillChanges.length;
            canonicalSuggestionCount += canonicalProposalCount;
            narrativeSuggestionCount += narrativeProposalCount;
            skillSuggestionCount += skillChanges.length;
            const emptySuggestionCount = emptyWritableFields.filter(field => Object.hasOwn(proposedData, field)).length;
            const emptyFieldsStillOpen = Math.max(0, emptyWritableFields.length - emptySuggestionCount);
            emptyFieldsExamined += emptyWritableFields.length;
            emptyFieldSuggestions += emptySuggestionCount;
            if (deferredEvidence.length) emptyFieldsAwaitingEvidence += emptyFieldsStillOpen;
            else emptyFieldsWithoutSupport += emptyFieldsStillOpen;
            const finishEntity = (actionable) => {
                // A sheet read in several passes reports what all of them read and proposed.
                const earlier = passTokens.get(ent.id) || {};
                const totals = {
                    input: inputTokenEstimate,
                    output: outputTokenEstimate,
                    evidence: (earlier.evidence || 0) + includedEvidence.length,
                    proposals: (earlier.proposals || 0) + proposalCount,
                };
                passTokens.set(ent.id, totals);
                updateState.transition(workspaceId, ent.id, includedEvidence, actionable ? 'actionable' : 'non-actionable', runId, actionable ? 'proposals-created' : 'no-supported-change');
                updateState.updateJob(runId, ent.id, {
                    status: 'completed',
                    input_tokens: totals.input,
                    output_tokens: totals.output,
                    retry_count: retryCount,
                    evidence_used: totals.evidence,
                    proposals_created: totals.proposals,
                    error: null,
                });
            };
            // Keep the evidence pending so a later run retries it.
            if (!hasChange && loreFailure) {
                failed++;
                rememberFailure(ent, loreFailure);
                updateState.transition(workspaceId, ent.id, includedEvidence, 'deferred', runId, 'lore-output-failure');
                updateState.updateJob(runId, ent.id, {
                    status: 'failed',
                    input_tokens: inputTokenEstimate,
                    output_tokens: outputTokenEstimate,
                    retry_count: retryCount,
                    evidence_used: includedEvidence.length,
                    error: loreFailure,
                });
                continue;
            }
            if (!hasChange) {
                finishEntity(false);
                clearEnrichmentError.run(workspaceId, ent.id);
                continue;
            }
            if (!hasCanonicalChange) {
                stagedIds.add(ent.id);
                finishEntity(true);
                clearEnrichmentError.run(workspaceId, ent.id);
                if (loreFailure) rememberFailure(ent, loreFailure);
                continue;
            }

            if (policy === 'open') {
                // Clears any review staged while the entity was on 'review'.
                const nextData = { ...(ent.data || {}) };
                delete nextData._enrichPending;
                for (const [field, proposal] of Object.entries(proposedData)) {
                    if (field.startsWith('customFields.')) {
                        const key = field.slice('customFields.'.length);
                        nextData.customFields = { ...(nextData.customFields || {}), [key]: proposal.value };
                    } else nextData[field] = proposal.value;
                }
                const fields = { data: nextData };
                if (loreChanged) fields.lore = incomingLore;
                const origin = {
                    appliedBy: 'automatic',
                    runId,
                    evidence: includedEvidence.map(entry => entry.chunk.id),
                    relatedIds: proposedLinks.map(link => link.targetId),
                };
                entitiesStore.withUpdateOrigin(ent.id, origin, () => {
                    entitiesStore.updateEntity(ent.id, fields);
                    for (const l of proposedLinks) applyProposedLink(ent.id, l, workspaceId);
                });
                updatedIds.add(ent.id);
            } else {
                // Unresolved review items are preserved.
                const previous = (ent.data?._enrichPending && typeof ent.data._enrichPending === 'object') ? ent.data._enrichPending : {};
                const pending = { ...previous };
                pending.evidence = {
                    ...(previous.evidence || {}),
                    ...Object.fromEntries(includedEvidence.map(entry => [entry.id, {
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
                stagedIds.add(ent.id);
            }
            finishEntity(true);
            clearEnrichmentError.run(workspaceId, ent.id);
            if (loreFailure) rememberFailure(ent, loreFailure);
        } catch (e) {
            console.error(`[Enrich] ${ent.canonicalName} failed (continues):`, e.message);
            const systemicStructuredFailure = /compiled grammar|structured output|response.?format|json.?mode|unsupported entity update shape|invalid json|empty response|truncated/i.test(String(e.message || ''));
            consecutiveStructuredFailures = systemicStructuredFailure ? consecutiveStructuredFailures + 1 : 0;
            failed++;
            rememberFailure(ent, e);
            updateState.transition(workspaceId, ent.id, includedEvidence, 'deferred', runId, 'entity-update-failed');
            updateState.updateJob(runId, ent.id, { status: 'failed', error: cleanErrorMessage(e) });
        }
    }
    if (progressCallback) progressCallback({ phase: 'enriching', done: processedEntities, total: targets.length });
    let fieldGaps = { examined: 0, found: 0, absent: 0, sheets: 0, remaining: 0 };
    if (!stoppedEarly && !cancelled && gapTargets.size) {
        try {
            fieldGaps = await fillEntityFieldGaps({ workspaceId, entityIds: [...gapTargets], candidatesByEntity, runId, updateState, passTokens, shouldCancel, progressCallback });
        } catch (error) {
            console.warn('[Field gaps] The field pass stopped:', cleanErrorMessage(error));
        }
    }
    const runStatus = stoppedEarly || cancelled || failed ? (processedEntities > failed ? 'partial' : 'failed') : 'completed';
    const tokenUsage = updateState.finishRun(runId, runStatus);
    try { clearImportSources(workspaceId); }
    catch (error) { console.warn('[Enrich] Imported passages could not be cleared:', error.message); }
    const updated = updatedIds.size;
    const staged = [...stagedIds].filter(id => !updatedIds.has(id)).length;
    return {
        runId, entities: new Set(targets.map(target => target.id)).size, processedEntities, updated, staged, upToDate, noEvidence,
        failed, failures, evidenceUsed, taggedEvidenceRemaining, textMatchesDeferred,
        canonicalSuggestionCount, narrativeSuggestionCount, skillSuggestionCount, emptyFieldsExamined,
        emptyFieldSuggestions, emptyFieldsWithoutSupport, emptyFieldsAwaitingEvidence,
        stoppedEarly, cancelled, remaining: targets.length - processedEntities, tokenUsage, fieldGaps
    };
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

    const history = db.prepare('SELECT id, role, content, excluded, aiName, aiColor, createdAt FROM messages WHERE chatId = ? ORDER BY createdAt ASC').all(chatId);
    const covered = coveredMessageIds(chat.memoryBlocks);
    const excludedNow = new Set(excludeIds);

    // Chat order, stored content, nothing already covered, nothing just muted.
    const archiveMessages = history
        .filter(m => wanted.has(m.id) && !covered.has(m.id) && !excludedNow.has(m.id) && m.excluded !== 1)
        .map(m => ({ id: m.id, role: m.role, content: m.content, aiName: m.aiName || null, aiColor: m.aiColor || null, createdAt: m.createdAt || null }));

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
    const experienceMode = db.prepare('SELECT mode FROM workspace_experience_modes WHERE workspace_id = ?').get(chatId)?.mode;
    const isRoleplay = experienceMode === 'roleplay';
    let epistemicTools = null;
    let storyTools = null;
    let awarenessOverview = '';
    try {
        const { AgenticEpistemicTools } = require('../../dist-main/main/features/narrative/agentic-epistemic-tools');
        storyTools = new AgenticEpistemicTools(db);
        if (isRoleplay) {
            epistemicTools = storyTools;
            awarenessOverview = epistemicTools.scanSceneAwareness(chatId, currentInput);
        }
    } catch (error) {
        console.warn('[Agentic RAG] Awareness scan unavailable:', error.message);
    }
    const offeredTools = toolNamesFor({ roleplay: isRoleplay });
    // The roleplay context already holds these; research is for what lies outside them.
    const sceneContext = isRoleplay ? options.sceneContext || null : null;
    const nameOf = id => { try { return entitiesStore.getEntity(id)?.canonicalName || null; } catch (e) { return null; } };
    const sceneSheetNames = sceneContext ? [...sceneContext.sheetIds].map(nameOf).filter(Boolean) : [];
    const scenePerspectiveNames = sceneContext ? [...sceneContext.perspectiveIds].map(nameOf).filter(Boolean) : [];
    const inContextLine = sceneSheetNames.length
        ? `- ALREADY IN THE WRITER'S CONTEXT: the Worldbuild sheets of ${sceneSheetNames.join(', ')}, and what ${scenePerspectiveNames.join(' and ') || 'the player'} know. Do not fetch them again. Spend calls on what lies outside: absent people, other places, items, events, rumours, the story so far, and what someone nearby knows (inspect_subject_knowledge). lookup_entity on someone in the scene is only for their past in this story; their sheet will not be repeated.
`
        : '';

    // What the research is for. A workflow step feeds the previous step's prose as its input,
    // and ranking passages against generated prose buries the request the user actually made.
    const anchorQuery = String(options.userRequest || '').trim() || currentInput;
    const retrievalBudget = Number(options.retrievalBudget) || 0;

    let currentTurn = 1;
    // Per-profile configurable depth (clamped 1-5). Higher = better multi-hop reasoning, higher cost.
    const profileTurns = Math.min(5, Math.max(1, Number.isInteger(profile.agenticMaxTurns) ? profile.agenticMaxTurns : 3));
    const maxTurns = Number.isInteger(options.maxTurns) ? Math.max(1, Math.min(profileTurns, options.maxTurns)) : profileTurns;
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
    const toolK = retrievalBudget > 0 ? retrievalTopK(0, retrievalBudget, { tiers: RETRIEVAL_TIERS }) : null;

    // The planner may run on a smaller model than the writer, so it is measured against its own window.
    const executorKey = `${executor.apiProfileId}:${executor.model}`;
    let protocol = options.toolProtocol !== 'text'
        && (TEXT_PROTOCOL_STRIKES.get(executorKey) || 0) < TEXT_PROTOCOL_STRIKE_LIMIT
        && nativeToolSupport({ apiProfileId: executor.apiProfileId, model: executor.model })
        ? 'native'
        : 'text';
    let nativeConfirmed = false;
    const toolDefinitions = plannerToolDefinitions({ roleplay: isRoleplay });
    // Resolved per protocol: native tool definitions add their own framing to what the model counts.
    const plannerLimitNow = () => resolvePayloadLimit({
        apiProfileId: executor.apiProfileId,
        model: executor.model,
        protocol,
        maxPayloadTokens: normalizeMaxApiPayload(chat?.maxContext)
    });
    const plannerLimit = plannerLimitNow();
    const plannerWindow = plannerWindowShape(plannerLimit.limit);

    const retrievedProfileChunks = new Map();
    const retrievedChatChunks = new Map();
    const retrievedMemories = new Map();
    const retrievedLore = new Map();
    const retrievedWorldFacts = new Map(); // Deterministic Worldbuild registry facts (lore + relations).
    const retrievedNarrativeOptions = new Map();
    const retrievedTexts = new Map(); // Pages of in-world texts read through their item.
    const readFiles = new Map();
    // Ids the free deterministic pass found. They are the floor this loop may not fall below.
    const seededIds = new Set();

    const retrievedIds = () => [
        ...retrievedProfileChunks.keys(), ...retrievedChatChunks.keys(), ...retrievedMemories.keys(),
        ...retrievedLore.keys(), ...retrievedWorldFacts.keys(), ...retrievedNarrativeOptions.keys(), ...retrievedTexts.keys(), ...readFiles.keys()
    ];

    // The best rank each passage reached inside a lookup, and whether the agent's sources were applied.
    const lookupRanks = new Map();
    let citationsApplied = false;

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
${worldMapText}${awarenessOverview ? `
SCENE AWARENESS OVERVIEW (cheap first pass; deepen only relevant subject-target pairs):
${awarenessOverview}
` : ''}`;

    const textProtocolSection = `
AVAILABLE TOOLS (write every call exactly in this syntax):
${textToolCatalog({ roleplay: isRoleplay })}

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
${isRoleplay ? `${inContextLine}- PERSPECTIVE: lookup_entity returns what the narrator knows. Use inspect_subject_knowledge for what one character knows about another.
- CONTROLLED NARRATIVE ENRICHMENT: When the prompt asks the narrator to reveal, distinguish, or choose an undefined detail and a Worldbuild category can supply plausible options, call explore_worldbuild_options before finishing. Also retrieve scene, location, faction, or character canon needed to constrain the choice. Treat the palette as possibilities only. Do not use it for an already established fact, force variety, or assume every option fits the scene.
` : ''}`;

    const headFor = mode => `${sharedHead}${mode === 'native' ? nativeProtocolSection : textProtocolSection}${guidance}`;
    const systemPromptText = `You are a precise researcher. You communicate strictly using the tools specified. ${getSystemLanguageInstruction()}`;

    const SNIPPET_CHARS = 160;
    const itemRegistry = new Map();   // handle -> { source, full }, backs the expand tool
    const handleIds = new Map();      // handle -> retrieved chunk id, for citations in finish
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
    // What the provider billed from cache across the research turns.
    const agenticCache = {};
    let agenticRagOutputTokens = 0;
    const trajectory = {
        anchorQuery,
        toolK,
        protocol,
        finalProtocol: protocol,
        protocolFallback: null,
        stopped: null,
        plannerWindow: { limit: plannerLimit.limit, configured: plannerLimit.configured, source: plannerLimit.source, outputTokens: plannerWindow.outputTokens, tokenRatio: plannerLimit.ratio },
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
    const runToolCall = async (requested, { pushResult, pushNote }) => {
        const call = { ...requested, name: canonicalToolName(requested.name) };
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
        let status = 'ran';

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
                entityChunks.forEach((r, rank) => {
                    lookupRanks.set(r.id, Math.min(lookupRanks.get(r.id) ?? Infinity, rank));
                    if (r.ownerType === 'chat_kb') rememberRetrieved(retrievedChatChunks, r, 'lookup');
                    else if (r.ownerType === 'document') {
                        if (!retrievedLore.get(r.id)?.read) retrievedLore.set(r.id, { text: r.text, source: r.source, score: Number(r.score) || 0 });
                    } else rememberRetrieved(retrievedMemories, r, 'lookup');
                });
            }
            const relLines = [];
            const edgesByEntity = new Map();
            let anyLore = false;
            let dossierCalendar = null;
            let dossierClock = null;
            try {
                const calendarService = require('./features/worldbuild/calendar-service');
                dossierCalendar = calendarService.getCalendar(db, chatId);
                if (registryEntity?.data?.birthDate) dossierClock = calendarService.getRoleplayClock(db, chatId);
            } catch (e) { }
            // With a birth date the age is read off the story clock, never a stored snapshot.
            const dossierData = data => {
                if (!data?.birthDate || !dossierCalendar) return data;
                const { derivedAge } = require('./features/worldbuild/calendar-service');
                return { ...data, age: derivedAge(dossierCalendar, dossierClock, data) };
            };
            try {
                for (const eid of entityIds) {
                    const ent = entitiesStore.getEntity(eid);
                    if (!ent) continue;
                    const links = entitiesStore.getLinksFrom(eid) || [];
                    if (links.length) {
                        const edges = links.map(l => `${relationTitle(l.relType, l.label)} → ${l.entity ? l.entity.canonicalName : '?'}${edgeDetail(l, dossierCalendar)}`).join('; ');
                        relLines.push(`${ent.canonicalName}: ${edges}`);
                        edgesByEntity.set(eid, edges);
                    }
                    if (entitiesStore.linkedLoreDocIds(ent).length) anyLore = true;
                }
            } catch (e) { }

            // A sheet the scene already carries is not sent twice; the entity's past in the story still is.
            const sheetInContext = Boolean(registryEntity && sceneContext?.sheetIds.has(registryEntity.id));
            if (registryEntity && !sheetInContext) {
                const factParts = [];
                const details = entityDataFacts(dossierData(registryEntity.data));
                if (details) factParts.push(`Details: ${details}`);
                const desc = registryEntity.data && (registryEntity.data.description || registryEntity.data.content);
                if (desc && String(desc).trim()) factParts.push(`Description: ${String(desc).trim()}`);
                if (registryEntity.lore && String(registryEntity.lore).trim()) factParts.push(`Lore: ${registryEntity.lore}`);
                const ownEdges = edgesByEntity.get(registryEntity.id);
                if (ownEdges) factParts.push(`Relations: ${ownEdges}`);
                // Recorded even without details, so the narrative planner learns the entity is in play.
                const detailText = factParts.length ? ` — ${factParts.join(' | ')}` : '';
                retrievedWorldFacts.set(registryEntity.id, {
                    text: `${registryEntity.canonicalName} (${registryEntity.type})${detailText}`,
                    source: `Worldbuild — ${registryEntity.canonicalName}`,
                    canonicalName: registryEntity.canonicalName,
                    aliases: Array.isArray(registryEntity.aliases) ? registryEntity.aliases : [],
                    entityIds: [registryEntity.id]
                });
            }

            if (registryEntity) {
                coveredEntities.add(registryEntity.canonicalName);
                if (includeChatContext) retrievalLedger.recordEntity(chatId, registryEntity.canonicalName);
                if (sheetInContext) {
                    pushNote(`Tool [lookup_entity] for "${call.arg}": the sheet of ${registryEntity.canonicalName} is already in the writer's context.`);
                }
                let head = `Worldbuild entity ${registryEntity.canonicalName} (${registryEntity.type})`;
                const headDetails = entityDataFacts(dossierData(registryEntity.data));
                if (headDetails) head += ` [${headDetails}]`;
                const headDesc = registryEntity.data && (registryEntity.data.description || registryEntity.data.content);
                if (headDesc && String(headDesc).trim()) head += ` — ${String(headDesc).trim()}`;
                if (registryEntity.lore && String(registryEntity.lore).trim()) head += `: ${registryEntity.lore}`;
                if (!sheetInContext) pushResult({ source: registryEntity.canonicalName, full: head, meta: `lookup_entity "${call.arg}"` });
            }
            entityChunks.forEach((r, index) => pushResult({
                id: r.id, source: r.source, full: r.text,
                preview: index < AGENT_FULL_RESULTS_PER_CALL ? 'full' : 'digest',
                meta: `lookup_entity "${call.arg}"`
            }));
            hits = entityChunks.length + (registryEntity && !sheetInContext ? 1 : 0);
            if (sheetInContext && !entityChunks.length) status = 'in-context';
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
                    retrievedLore.set(r.id, { text, source: r.source || docTitle, score: Number(r.fusionScore ?? r.score) || 0, read: true });
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
        } else if (call.name === 'read_text') {
            let reading = null;
            let reason = 'no workspace context in this run';
            if (includeChatContext) {
                try {
                    const itemId = entitiesStore.resolveMention(call.arg, 'Items', chatId);
                    if (!itemId) reason = 'no item by that name';
                    else if (options.readItemIds?.has(itemId)) reason = 'its pages are already in the context';
                    else if (isRoleplay && !inWorldTexts.itemsInScene(db, roleplaySystem(), chatId).has(itemId)) reason = 'that item is not within reach of the scene';
                    else {
                        reading = inWorldTexts.readItemText(db, chatId, itemId, { maxTokens: IN_WORLD_TEXT_TOKENS, estimate: estimateTokens });
                        if (!reading) reason = 'the item has no written text';
                    }
                } catch (e) { reason = e.message; }
            }
            hits = reading ? 1 : 0;
            if (!reading) {
                pushNote(`Tool [read_text] for "${call.arg}": nothing to read (${reason}).`);
            } else {
                const id = `text:${reading.itemId}`;
                retrievedTexts.set(id, { text: reading.text, source: reading.itemName, read: true });
                pushNote(`Tool [read_text] for "${call.arg}": the written pages of ${reading.itemName}.`);
                pushResult({
                    id, source: reading.itemName,
                    full: reading.text.length > MAX_AGENT_FILE_CHARS ? `${reading.text.slice(0, MAX_AGENT_FILE_CHARS)}\n[...truncated for agent reasoning; the full text is preserved for the final context...]` : reading.text,
                    preview: 'full',
                    meta: `read_text "${call.arg}"`
                });
            }
        } else if (call.name === 'read_file') {
            let isConstant = false;
            let isUnavailable = false;
            let canReadWorkspaceSource = false;
            try {
                const kbFiles = JSON.parse(profile.knowledgeFiles || '[]');
                const fileMatch = kbFiles.find(f => f.name.toLowerCase() === call.arg.toLowerCase());
                if (fileMatch?.enabled === false) isUnavailable = true;
                if (fileMatch && (!fileMatch.strategy || fileMatch.strategy === 'constant' || fileMatch.strategy === 'full_context')) {
                    isConstant = true;
                }
            } catch (e) { }

            if (!isConstant && includeChatContext) {
                const fileMatch = workspaceKbFiles.find(f => String(f.name || '').toLowerCase() === call.arg.toLowerCase());
                if (fileMatch) {
                    isConstant = !isSearchable(fileMatch);
                    canReadWorkspaceSource = isAvailableToProfile(fileMatch, profile.id) && isSearchable(fileMatch);
                    if (!canReadWorkspaceSource && !isConstant) isUnavailable = true;
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
                const snippetMatch = workspaceMemoryBlocks.find(s => (s.title || s.source || '').toLowerCase() === call.arg.toLowerCase());
                if (snippetMatch) {
                    isConstant = !isSearchable(snippetMatch);
                    canReadWorkspaceSource = isAvailableToProfile(snippetMatch, profile.id) && isSearchable(snippetMatch);
                    if (!canReadWorkspaceSource && !isConstant) isUnavailable = true;
                }
            }

            if (isConstant) {
                pushNote(`Tool [read_file] for "${call.arg}": Access Denied — "${call.arg}" is a Constant context block already permanently included in the main prompt.`);
            } else if (isUnavailable) {
                pushNote(`Tool [read_file] for "${call.arg}": Access Denied — this source is disabled or outside the current AI Profile scope.`);
            } else {
                let fileText = readEntireKbFile(profile.id, call.arg);
                let fileSource = 'profile';
                if (fileText.startsWith("[System: File not found") && includeChatContext && canReadWorkspaceSource) {
                    fileText = readEntireKbFile(chatId, call.arg);
                    fileSource = 'chat';
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
        } else if (call.name === 'explore_worldbuild_options') {
            if (!isRoleplay || !includeChatContext) {
                pushNote('Narrative option exploration is available only in Roleplay Mode with workspace context.');
            } else {
                const palette = buildNarrativeOptionPalette({
                    workspaceId: chatId,
                    query: call.arg,
                    listEntities: entitiesStore.listEntities
                });
                if (palette.error) {
                    pushNote(`Tool [explore_worldbuild_options]: ${palette.error}`);
                } else if (!palette.count) {
                    pushNote(`Tool [explore_worldbuild_options] for "${call.arg}": No registered ${palette.type} options found.`);
                } else {
                    retrievedNarrativeOptions.set(palette.type, { text: palette.content, source: palette.source, score: 1 });
                    hits = palette.count;
                    pushResult({ source: palette.source, full: palette.content, meta: `explore_worldbuild_options "${call.arg}"` });
                }
            }
        } else if (EPISTEMIC_TOOLS[call.name]) {
            // Per-subject records stay in the planner's reasoning; the context planner decides what the writer sees.
            const [method, unavailable] = EPISTEMIC_TOOLS[call.name];
            const text = epistemicTools
                ? (call.name === 'scan_scene_awareness'
                    ? `Scene Awareness:\n${epistemicTools.scanSceneAwareness(chatId)}`
                    : epistemicTools[method](chatId, call.arg))
                : unavailable;
            hits = epistemicTools ? 1 : 0;
            pushNote(text);
        } else if (STORY_TOOL_METHODS[call.name]) {
            const vector = call.name === 'compare_knowledge'
                ? null
                : await storyQueryVector(chatId, String(call.arg || '').split('|').pop());
            const text = storyTools
                ? storyTools[STORY_TOOL_METHODS[call.name]](chatId, call.arg, vector)
                : 'The story is unavailable right now.';
            hits = storyTools ? 1 : 0;
            pushNote(text);
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
        // Scene records change turn by turn, so an empty answer from them is not remembered.
        if (includeChatContext && call.name !== 'expand' && !EPISTEMIC_TOOLS[call.name] && !STORY_TOOL_METHODS[call.name] && call.name !== 'explore_worldbuild_options') {
            retrievalLedger.recordQuery(chatId, { key, tool: call.name, query: call.arg, hits });
        }
        return { tool: call.name, arg: call.arg, hits, status };
    };

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
    // A research need starts from its own question, with nothing floored into the writer's context.
    if (!options.skipSeed) try {
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
            // Shown whole so a pre-search that already answers lets the planner finish at once.
            // The preview is bounded by the planner's window; every seeded passage reaches the writer.
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

    let turnLimit = plannerLimit;
    const estimateRequest = () => estimatePayloadTokens({
        systemPrompt: systemPromptText,
        chatHistory: protocol === 'native' ? flattenConversation(renderNativeConversation(), toolDefinitions) : renderTextMessages(),
        newPrompt: '',
        outputTokens: plannerWindow.outputTokens,
        maxPayloadTokens: turnLimit.limit
    });
    // The limit already carries the correction for this model's count; the estimate stays raw.
    const fitsPlannerWindow = () => {
        turnLimit = plannerLimitNow();
        return estimateRequest().totalTokens <= turnLimit.limit;
    };

    const requestPlannerTurn = () => {
        const request = {
            apiProfileId: executor.apiProfileId,
            model: executor.model,
            systemPrompt: systemPromptText,
            temperature: 0.1,
            maxTokens: plannerWindow.outputTokens,
            maxPayloadTokens: normalizeMaxApiPayload(chat?.maxContext),
            payloadLimit: turnLimit,
            learnTokenCount: true,
            manualMode: false,
            manualJson: '',
            abortSignal: run?.controller?.signal,
            // The last turn reads the transcript back but writes nothing: no later turn would read it.
            promptCache: { policy: 'transcript', scopeId: `${chatId}::retrieval-planner`, ...(currentTurn >= maxTurns ? { final: true } : {}) },
            onUsage: metadata => addCacheUsage(agenticCache, metadata)
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
            const correction = turnLimit.ratio > 1
                ? ` (${turnLimit.limit} by Kallamo's estimate, as this model counts about ${turnLimit.ratio.toFixed(2)} times as many)`
                : '';
            trajectory.stopped = `the research no longer fits the planner model's context window of ${turnLimit.configured} tokens${correction}`;
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
            if (reply.learnedTokenRatio != null) turnRecord.tokenRatio = reply.learnedTokenRatio;
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
                    citationsApplied = true;
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
                    for (const [id, palette] of retrievedNarrativeOptions.entries()) {
                        const source = String(palette.source || '').toLowerCase();
                        const content = String(palette.text || '').toLowerCase();
                        const keep = allowedSources.some(candidate =>
                            source.includes(candidate) || candidate.includes(source) || content.includes(candidate));
                        if (!keep) retrievedNarrativeOptions.set(id, { ...palette, uncited: true });
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
                if (!offeredTools.includes(canonicalToolName(call.name))) {
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

            if (turnAddedNothing(turnRecord)) {
                finished = true;
                finishResponse = '';
                turnRecord.finished = true;
                trajectory.autoFinished = `turn ${currentTurn} added nothing new`;
                console.log(`[Agentic RAG] Finishing after turn ${currentTurn}: it added nothing new.`);
                break;
            }

            currentTurn++;

        } catch (err) {
            if (err.name === 'AbortError' || run?.isCancelled) throw err;
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

    // Pre-search results never fall to the bottom tier: the deterministic path would have sent
    // them, and the agent staying silent about them is not evidence against them.
    const UNCITED_TIER = 4;
    const SEEDED_UNCITED_TIER = 3;
    const uncitedTier = (ids) => (ids.some(id => seededIds.has(id)) ? SEEDED_UNCITED_TIER : UNCITED_TIER);

    // A lookup's lower-ranked passages helped the agent reason; the writer gets them only when
    // the agent cited them, a search or the pre-search also found them, or the agent read them.
    let withheldLookupPassages = 0;
    for (const map of [retrievedChatChunks, retrievedMemories, retrievedLore]) {
        for (const [id, entry] of map.entries()) {
            const rank = lookupRanks.get(id);
            if (rank === undefined || rank < LOOKUP_CONTEXT_PASSAGES) continue;
            if (seededIds.has(id) || entry.origin === 'search' || entry.read) continue;
            if (citationsApplied && !entry.uncited) continue;
            map.delete(id);
            withheldLookupPassages += 1;
        }
    }
    trajectory.withheldLookupPassages = withheldLookupPassages;

    // The same passage reached by two tools is sent once.
    const selection = selectRetrievedEntries(anchorQuery, [
        ...[...retrievedProfileChunks.entries()].map(([id, r]) => ({ collection: retrievedProfileChunks, id, kind: 'profile-knowledge', source: r.source, content: r.text })),
        ...[...retrievedChatChunks.entries()].map(([id, r]) => ({ collection: retrievedChatChunks, id, kind: 'workspace-text', source: r.source, content: r.text })),
        ...[...retrievedMemories.entries()].map(([id, r]) => ({ collection: retrievedMemories, id, kind: 'workspace-memory', source: r.source, content: r.text })),
        ...[...retrievedLore.entries()].map(([id, r]) => ({ collection: retrievedLore, id, kind: 'worldbuild-canon', source: r.source, content: r.text })),
        ...[...retrievedWorldFacts.entries()].map(([id, r]) => ({ collection: retrievedWorldFacts, id, kind: 'worldbuild-canon', source: r.source, content: r.text })),
        ...[...retrievedNarrativeOptions.entries()].map(([id, r]) => ({ collection: retrievedNarrativeOptions, id, kind: 'worldbuild-canon', source: r.source, content: r.text })),
        ...[...readFiles.entries()].map(([id, r]) => ({ collection: readFiles, id, kind: r.source === 'profile' ? 'profile-knowledge' : 'workspace-text', source: id, content: r.text }))
    ]);
    selection.excluded.forEach(({ entry }) => entry.collection.delete(entry.id));

    // narrativeKind marks what the narrative context planner receives when the workspace is
    // planned; profile knowledge carries none and is packed directly.
    const sections = {
        profile: '--- PROFILE KNOWLEDGE BASE CHUNKS ---',
        files: '--- READ FILES CONTENT ---',
        chat: '--- CHAT KNOWLEDGE BASE CHUNKS ---',
        memory: '--- CHAT SUMMARIZED MEMORIES & SNIPPETS ---',
        lore: '--- LINKED LORE (WRITING DESK) ---',
        texts: '--- TEXTS IN THE WORLD ---',
        facts: '--- WORLDBUILD FACTS ---',
        options: '--- WORLDBUILD OPTIONS ---'
    };
    const contextItems = [];
    for (const [id, r] of retrievedProfileChunks.entries()) {
        contextItems.push({ section: sections.profile, ids: [id], source: r.source, text: `[Result from Profile KB - ${r.source}]: ${r.text}`, tier: r.uncited ? uncitedTier([id]) : 2, score: r.score || 0, origin: 'profile' });
    }
    for (const [filename, data] of readFiles.entries()) {
        contextItems.push({
            section: sections.files,
            ids: [filename],
            source: filename,
            text: `[File Contents: ${filename}]:\n${data.text}`,
            tier: data.uncited ? UNCITED_TIER : 1,
            score: 1,
            truncatable: true,
            origin: data.source === 'profile' ? 'profile' : 'chat',
            ...(data.source === 'profile' ? {} : { narrativeKind: 'workspace-text' })
        });
    }
    for (const [id, r] of retrievedChatChunks.entries()) {
        contextItems.push({ section: sections.chat, ids: [id], source: r.source, text: `[Result from Chat KB - ${r.source}]: ${r.text}`, tier: r.uncited ? uncitedTier([id]) : 2, score: r.score || 0, origin: 'chat', narrativeKind: 'workspace-text' });
    }
    const memoryPassages = expandMemoryResults([...retrievedMemories.entries()].map(([id, r]) => ({ id, ...r })), chatId);
    for (const r of memoryPassages) {
        const ids = r.ids || [r.id];
        contextItems.push({ section: sections.memory, ids, source: r.source || 'Chat Memory', text: `[Chat Memory]: ${r.text}`, tier: r.uncited ? uncitedTier(ids) : (r.origin === 'search' ? 2 : 3), score: r.score || 0, origin: 'chat', narrativeKind: 'workspace-memory' });
    }
    for (const [id, r] of retrievedLore.entries()) {
        contextItems.push({ section: sections.lore, ids: [id], source: r.source, text: `[Linked Lore - ${r.source}]: ${r.text}`, tier: r.uncited ? uncitedTier([id]) : 2, score: r.score || 0, origin: 'chat', narrativeKind: 'worldbuild-canon' });
    }
    // Narrator material: routed with canon so no character's perspective receives it unread.
    for (const [id, r] of retrievedTexts.entries()) {
        contextItems.push({ section: sections.texts, ids: [id], source: r.source, text: r.text, tier: 1, score: 1, truncatable: true, origin: 'chat', narrativeKind: 'worldbuild-canon' });
    }
    for (const [id, r] of retrievedWorldFacts.entries()) {
        contextItems.push({ section: sections.facts, ids: [id], source: r.source, text: `[${r.source}]: ${r.text}`, tier: r.uncited ? SEEDED_UNCITED_TIER : 0, score: 1, truncatable: true, origin: 'chat', narrativeKind: 'worldbuild-canon', entityIds: r.entityIds || [id] });
    }
    for (const [id, r] of retrievedNarrativeOptions.entries()) {
        contextItems.push({ section: sections.options, ids: [`narrative-options:${id}`], source: r.source, text: r.text, tier: r.uncited ? UNCITED_TIER : 2, score: 1, truncatable: true, origin: 'chat', narrativeKind: 'worldbuild-canon' });
    }

    const stopReason = finished
        ? 'finished'
        : (trajectory.stopped ? 'planner-window' : (loopDegraded ? 'retrieval-error' : 'max-turns'));
    return {
        agenticResponse: finishResponse || '[Agent passed context directly — no summary needed]',
        contextItems,
        contextSections: Object.values(sections),
        agenticInputTokens: agenticRagInputTokens,
        agenticOutputTokens: agenticRagOutputTokens,
        agenticCache,
        degraded: loopDegraded,
        trajectory,
        trace: trajectory.turns.map(({ newIds, ...turn }) => turn),
        stopReason,
        selection: selection.funnel
    };
}

module.exports = {
    runWorkflow,
    closeRoleplayScene,
    roleplayClockLabel,
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
    cleanLoreToBackground,
    discoverImportSources,
    estimateImportFill,
    applyImportSources,
    clearImportSources,
    discardImportSession,
    tagChunkRecords,
    applyChunkTags,
    computeDocumentVectorStatus,
    checkAndAutoSummarize,
    getSystemAiConfiguration,
    deferNarrativeStateTurn,
    reprocessNarrativeStateTurn
};
