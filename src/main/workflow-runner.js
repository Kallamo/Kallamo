const db = require('./database');
const entitiesStore = require('./entities');
const inWorldTexts = require('./features/worldbuild/in-world-texts');
const { sendApiRequest, sendAgentRequest, nativeToolSupport, getReservedOutputTokens, resolvePayloadLimit, createPromptVariableResolver } = require('./features/llm/llm.service');
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
const { deferredNarrativeState, findPendingNarrativeTurn, replacedReplyIds } = require('./features/chat/narrative-turns');
const { parseEntityUpdateObject } = require('./features/worldbuild/entity-update-json');
const {
    buildEstimatedUsage,
    createMessageDiagnostics,
    mergeNarrativeStateDiagnostics
} = require('./features/ai-engine/message-diagnostics');
const {
    selectRetrievedEntries
} = require('./features/ai-engine/retrieval-selection');
const { normalizeRelationshipLabel, resolveRelationshipUpdate, validateNarrativeChange } = require('./features/worldbuild/entity-review');
const {
    filterUpdateFields,
    filterUpdateRelations,
    buildFieldCoverage,
    isUnsupportedNumericDelta,
    isWeakTextReplacement,
    comparableText,
} = require('./features/worldbuild/entity-update-contract');
const { buildEntityUpdateSchema, buildEntityLoreSchema } = require('./features/worldbuild/entity-update-schema');
const {
    ENRICH_ENUMS,
    ENRICH_FIELDS,
    ENRICH_TYPE_GUIDANCE,
    ENRICH_FIELD_GUIDANCE,
    entityDataFacts
} = require('./features/worldbuild/entity-fields');
const { decodeEntityUpdate, isEntityUpdateShape } = require('./features/worldbuild/entity-update-protocol');
const { buildLorePrompt, buildLoreAppendPrompt, buildSpoilerRetryNote, validateEntityLore, validateEntityLoreAppend } = require('./features/worldbuild/entity-lore');
const { precedingPassageText, memorySummaries, entitySkillContext } = require('./features/worldbuild/entity-update-context');
const { buildNarrativeOptionPalette } = require('./features/worldbuild/narrative-options');
const { createEntityUpdateState } = require('./features/worldbuild/entity-update-state');
const { shouldStopEntityUpdates } = require('./features/worldbuild/entity-update-resilience');
const { NARRATIVE_TRIAGE_SCHEMA, NARRATIVE_STATE_SCHEMA } = require('../../dist-main/main/features/narrative/narrative-state-schema');
const { findReachableLocations, locationSizesOf, travelCategory } = require('../../dist-main/main/features/worldbuild/location-graph');
const { findByReference } = require('../../dist-main/main/features/narrative/rule-keys');
const { missingSpoilers } = require('../../dist-main/shared/spoilers');
const {
    compactNarrativeManifest,
    extractNarrativeSignals,
    groupKnowledgeCardRows,
    hasEpistemicDomain,
    resolveAnalysisHolders,
    resolveNarrativeRouting,
    selectPerspectiveRecords
} = require('./features/narrative/narrative-state-routing');
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

function formatContextPlanDebug(plan) {
    if (!plan?.package) return '';
    const includedSources = new Map(
        plan.package.items.map(item => [item.candidateId, `${item.source.type}:${item.source.id}`])
    );
    const decisions = (plan.decisions || []).map(decision => {
        const source = includedSources.get(decision.candidateId);
        return `- ${decision.candidateId}${source ? ` [${source}]` : ''}: ${decision.outcome} (${decision.reason})`;
    });
    return [
        'CONTEXT POLICY',
        `Budget: ${plan.package.usedTokens}/${plan.package.tokenBudget} tokens`,
        ...decisions
    ].join('\n');
}

function formatContextBundleDebug(planned) {
    if (!planned?.bundle) return '';
    return `ROLEPLAY CONTEXT BUNDLE:\n${JSON.stringify(serializeContextBundle(planned), null, 2)}`;
}

function serializeContextBundle(planned) {
    if (!planned?.bundle) return null;
    const scopes = planned.bundle.scopes.map(scope => ({
        id: scope.scopeId,
        label: scope.label,
        usedTokens: scope.package.usedTokens,
        itemIds: scope.package.items.map(item => item.candidateId),
        items: scope.package.items.map(item => ({
            candidateId: item.candidateId,
            source: item.source,
            provenanceIds: item.provenanceIds,
            tokens: item.tokens
        }))
    }));
    const excluded = planned.bundle.decisions
        .filter(decision => decision.outcome !== 'include')
        .map(decision => ({
            scopeId: decision.scopeId,
            candidateId: decision.candidateId,
            outcome: decision.outcome,
            reason: decision.reason
        }));
    const manifest = planned.manifest ? {
        requestId: planned.manifest.requestId,
        sequence: planned.manifest.sequence,
        subjects: planned.manifest.subjectIds,
        targets: planned.manifest.targetIds,
        assessments: planned.manifest.assessments,
        deepenedPairs: planned.manifest.deepenedPairs
    } : null;
    return {
        usedTokens: planned.bundle.usedTokens,
        tokenBudget: planned.bundle.tokenBudget,
        composition: planned.bundle.composition || null,
        scopes,
        excluded,
        manifest
    };
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

// Agentic context items become planner items. Uncited results rank lower instead of being
// dropped, and one file or lore read keeps the same share cap the packer applies.
function toNarrativeItems(contextItems, retrievalBudget) {
    const itemCap = Math.floor(Math.max(0, retrievalBudget) * AGENTIC_ITEM_MAX_SHARE);
    return (contextItems || []).map((item, index) => ({
        id: item.ids?.[0] || `agentic-${index}`,
        kind: item.narrativeKind,
        source: item.source,
        content: item.truncatable && estimateTokens(item.text) > itemCap
            ? truncateToTokens(item.text, itemCap, estimateTokens)
            : item.text,
        relevance: (Number(item.score) || 0) * (item.tier >= 3 ? 0.75 : 1),
        ...(item.entityIds ? { entityIds: item.entityIds } : {})
    })).filter(item => item.content);
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
        return readAdvancedSettings().promptCacheContextPlacement === 'turn' ? 'turn' : 'system';
    } catch (e) {
        return 'system';
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
        if (replacedIds.length) {
            turnReplacementId = narrativeEntitySystem().beginTurnReplacement(chatId, replacedIds);
        }
        if (roleplayTurns) {
            await analyzePendingNarrativeTurn({ chatId, excludedIds: replacedIds, webContents, currentRun, totalSteps });
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
        let lastRetrievalMode = 'standard';
        let lastAgenticTrace = null;
        let lastRetrievalFunnel = null;
        let lastGenerationPolicyId = null;
        let lastScenePlan = '';
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
        const measuredCache = { read: 0, write: 0, uncachedInput: 0 };

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
            const lastReply = [...activeMessages].reverse().find(message => message.role === 'ai')?.content || '';
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
                    readItemIds: new Set(textReadings.map(reading => reading.itemId)),
                    toolProtocol: String(debugSettings.agenticToolProtocol || 'auto') === 'text' ? 'text' : 'auto'
                });
                if (agenticResult) {
                    retrievalMode = 'agentic';
                    // Workspace passages and Worldbuild records go through the narrative planner, which
                    // applies perspective; profile knowledge is packed on its own first.
                    const narrativeCandidates = planWorkspaceContext
                        ? agenticResult.contextItems.filter(item => item.narrativeKind)
                        : [];
                    const packed = packContextItems(
                        planWorkspaceContext ? agenticResult.contextItems.filter(item => !item.narrativeKind) : agenticResult.contextItems,
                        retrievalBudget,
                        { estimate: estimateTokens, maxItemShare: AGENTIC_ITEM_MAX_SHARE }
                    );
                    retrievalOmitted += packed.dropped + packed.truncated;
                    if (agenticResult.degraded) agenticDegraded = true;
                    let planned = null;
                    if (planWorkspaceContext) {
                        const narrativeBudget = Math.max(0, retrievalBudget - packed.usedTokens);
                        planned = planNarrativeContext({
                            chatId,
                            query: currentInput,
                            items: toNarrativeItems(narrativeCandidates, retrievalBudget),
                            tokenBudget: narrativeBudget
                        });
                        if (planned?.manifest?.requestId) narrativeContextRequestId = planned.manifest.requestId;
                        contextBundleDiagnostic = serializeContextBundle(planned);
                    }
                    const narrativeTokens = planned?.plan.package.usedTokens || 0;
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
                            kept: packed.kept.length + (planned?.plan.package.items.length || 0),
                            dropped: packed.dropped,
                            truncated: packed.truncated,
                            total: packed.total + narrativeCandidates.length,
                            budget: retrievalBudget
                        }
                    };
                    const gathered = [renderContextSections(packed.kept, agenticResult.contextSections), planned?.context]
                        .filter(Boolean)
                        .join('\n\n');
                    const retrievedAnything = packed.total > 0 || narrativeCandidates.length > 0;
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
                    chatKbTokens += narrativeTokens;

                    agenticRagResponse = agenticResult.agenticResponse;
                    agenticRagContextGathered = [
                        gathered,
                        planned ? formatContextPlanDebug(planned.plan) : '',
                        formatContextBundleDebug(planned)
                    ].filter(Boolean).join('\n\n');
                    agenticInputTokens = agenticResult.agenticInputTokens || 0;
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
                const narrativeItems = [];
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
                    pushRetrievalItems(retrievalItems, profileResults, profileRetrievalHeader, 'profile');
                }

                if (includeChatContext && chat) {
                    const chatKbResults = await searchChatKnowledgeBase(currentInput, chatId, { k: topK });
                    if (chatKbResults && chatKbResults.length > 0) {
                        const chatKbFiles = typeof chat.knowledgeFiles === 'string'
                            ? JSON.parse(chat.knowledgeFiles)
                            : (chat.knowledgeFiles || []);
                        routeRetrievedResults(
                            filterWorkspaceKnowledgeResults(chatKbResults, chatKbFiles, profile.id),
                            { retrievalItems, narrativeItems: planWorkspaceContext ? narrativeItems : null, section: CHAT_RETRIEVAL_HEADER, kind: 'workspace-text' }
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
                            { retrievalItems, narrativeItems: planWorkspaceContext ? narrativeItems : null, section: MEMORY_RETRIEVAL_HEADER, kind: 'workspace-memory' }
                        );
                    }
                    standardRagDebug += formatRagDebugSection('CHAT MEMORY', memoryResults);
                }

                // Duplicates are removed across both paths before anything is packed or planned.
                const selection = selectRetrievedEntries(currentInput, [
                    ...retrievalItems.map(item => ({ key: item, kind: item.origin === 'profile' ? 'profile-knowledge' : 'workspace-text', source: item.source, content: item.text })),
                    ...narrativeItems.map(item => ({ key: item, kind: item.kind, source: item.source, content: item.content }))
                ]);
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
                if (planWorkspaceContext) {
                    const planned = planNarrativeContext({
                        chatId,
                        query: currentInput,
                        items: narrativeItems.filter(item => selectedItems.has(item)),
                        tokenBudget: Math.max(0, retrievalBudget - packed.usedTokens)
                    });
                    if (planned.manifest?.requestId) narrativeContextRequestId = planned.manifest.requestId;
                    contextBundleDiagnostic = serializeContextBundle(planned);
                    if (planned.context) contextBlock += `\n\n${planned.context}\n`;
                    standardRagDebug += `\n${formatContextPlanDebug(planned.plan)}\n`;
                    standardRagDebug += `\n${formatContextBundleDebug(planned)}\n`;
                    chatKbTokens += planned.plan.package.usedTokens;
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
                        onUsage: (metadata) => {
                            if (!metadata) return;
                            measuredCache.read += metadata.cacheReadTokens || 0;
                            measuredCache.write += metadata.cacheWriteTokens || 0;
                            measuredCache.uncachedInput += metadata.uncachedInputTokens || 0;
                        }
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
                    ...(keepRetrievalText ? { standardRagContextGathered: capDebugText(lastStandardRagDebug) } : {}),
                    context: { historySent, historyDropped, retrievalOmitted, agenticDegraded, retrievalPath, retrievalGateReason, payloadLimit: finalPayloadLimit },
                    ...(finalTruncated ? { truncated: true, finishReason: finalFinishReason } : {}),
                    tokens: legacyTokens
                },
                generation: {
                    profileName: lastProfileUsed.name,
                    context: {
                        ...(keepRetrievalText ? { exactText: capDebugText(lastFinalContextText) } : {}),
                        exactTokens: estimateTokens(lastFinalContextText),
                        workflowContextTokens: totalNarrativeContextTokens,
                        manifestRequestId: lastNarrativeContextRequestId
                    },
                    policyId: lastGenerationPolicyId,
                    ...(debugSettings.narrativeStateDebug && lastScenePlan ? { scenePlan: capDebugText(lastScenePlan) } : {}),
                    steps: steps.length
                },
                retrieval: {
                    mode: lastRetrievalMode,
                    ...(keepRetrievalText ? {
                        retrievedSourcesText: capDebugText(lastRetrievalMode === 'agentic'
                            ? lastAgenticRagContextGathered
                            : lastStandardRagDebug),
                        finalContextText: capDebugText(lastFinalContextText)
                    } : {}),
                    bundle: lastContextBundle,
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
                    cache: {
                        read: measuredCache.read,
                        write: measuredCache.write,
                        uncachedInput: measuredCache.uncachedInput
                    }
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
                try {
                    // A reply that replaced another waits for the story to continue, so trying alternatives
                    // never bills an analysis per reply.
                    const narrativeResult = replacedIds.length
                        ? { changes: [], diagnostics: deferredNarrativeState() }
                        : await updateRoleplayStateWithSystemAi({
                            workspaceId: chatId,
                            provenanceId: aiMsgId,
                            userMessage: messageContent,
                            narrativeResponse: finalOutput
                        });
                    roleplayChanges = narrativeResult.changes;
                    if (narrativeResult.diagnostics) {
                        debugObj = mergeNarrativeStateDiagnostics(debugObj, narrativeResult.diagnostics);
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
                    debugObj = mergeNarrativeStateDiagnostics(debugObj, failedNarrativeDiagnostic);
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

// Can only downgrade to the deterministic path, which still fills the context.
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

const { edgeDetail } = require('./features/worldbuild/relation-dossier');
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
    'Characters.locations': 'Only a persistent meaningful connection, such as residence, origin, rule, or established base; not presence in one scene.',
    'Characters.relationships': 'Only an explicitly established directional personal relationship. targetRole states what TARGET is to SOURCE. value and sourcePerspective state how SOURCE feels about and relates to TARGET.',
    'Creatures.relationships': 'Only an explicitly established directional personal relationship involving a specific creature. targetRole states what TARGET is to SOURCE. value and sourcePerspective state how SOURCE feels about and relates to TARGET.',
    'Locations.inside': 'Only explicit physical containment inside another location, never proximity, jurisdiction, association, or travel between places.',
    'Locations.leader': 'Only explicit ownership, leadership, or governance of the location.',
    'Items.creator': 'Only the explicitly established creator or maker.',
    'Items.owner': 'Only current explicit ownership; use, custody, discovery, or theft alone does not prove ownership.',
    'Items.currentLocation': 'Only the explicit current world location of this unique item. Do not propose it when the item is currently held in an individual inventory.',
    'Items.foundIn': 'For item types only: explicit places where the type is found, produced, or gathered.',
    'Items.soldIn': 'For item types only: explicit places where the type is normally sold.',
    'Creatures.habitat': 'Only an explicitly established natural or habitual location, not a single encounter site.',
    'Factions.leader': 'Only an explicitly established current leader.',
    'Factions.operatesIn': 'Only an established area of operation, base, territory, or sustained activity.',
    'Factions.members': 'Only explicit membership; the label must state the supported role when available.',
    'Events.happenedAt': 'Only a location where the event explicitly occurred.',
    'Events.involved': 'Only a character explicitly participating in or materially affected by the event, not merely mentioned nearby.',
};

const ENTITY_ENRICHMENT_SCHEMA_VERSION = 'semantic-v8-field-coverage';

function entityEnrichmentSignature(chunk, fieldCoverageSignature) {
    return `${ENTITY_ENRICHMENT_SCHEMA_VERSION}:${fieldCoverageSignature}:${chunk.isTagged ? 'tagged' : 'text'}:${chunk.contentHash}`;
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

function planNarrativeContext({ chatId, query, items, tokenBudget }) {
    return getNarrativeChatContext().plan({
        requestId: crypto.randomUUID(),
        workspaceId: chatId,
        query,
        items,
        tokenBudget
    });
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

function shouldProcessNarrativeEntityProposal(proposal, updatePolicy) {
    if (updatePolicy === 'manual') return false;
    if (updatePolicy === 'review') return true;
    return proposal?.decision === 'new'
        && (proposal.type === 'Characters' || proposal.type === 'Creatures')
        && proposal.identityEstablished === true
        && Number(proposal.confidence) >= 0.9;
}

function shouldProcessNarrativeIdentityUpdate(update, updatePolicy) {
    if (updatePolicy === 'manual') return false;
    if (updatePolicy === 'review') return true;
    return update?.identityEstablished === true && Number(update.confidence) >= 0.9;
}

async function updateRoleplayStateWithSystemAi({ workspaceId, provenanceId, userMessage, narrativeResponse }) {
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
    const recordTimeFrame = (timeAdvance, endLocationId = roleplay.getScene(workspaceId)?.locationId, minimumMinutes = 0) => {
        const frame = calendarService.applyRoleplayTurnFrame(db, {
            workspaceId,
            originId: provenanceId,
            startClock,
            startLocationId: scene?.locationId,
            endLocationId,
            timeAdvance,
            minimumMinutes
        });
        if (frame?.advance?.duration) {
            try {
                const minutes = calendarService.durationTotalMinutes(calendarService.getCalendar(db, workspaceId), frame.advance.duration);
                const present = roleplay.getScene(workspaceId);
                roleplay.applyElapsedTime(workspaceId, provenanceId, minutes, [
                    roleplay.getSettings(workspaceId).playerEntityId,
                    ...(present?.participantIds || [])
                ].filter(Boolean));
            } catch (error) {
                console.warn('[Roleplay Time] Could not apply resource changes over time:', error.message);
            }
        }
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
    const { EVENT_BUDGET_PER_TURN } = require('../../dist-main/main/features/narrative/narrative-quality');
    const { NarrativeEntitySystem } = require('../../dist-main/main/features/narrative/narrative-entities');
    const { NarrativeContextManifestRepository } = require('../../dist-main/main/features/narrative/context-manifest');
    const { EventOccurrenceService } = require('../../dist-main/main/features/worldbuild/event-occurrences');
    const narrativeState = new NarrativeStateSystem(db);
    const narrativeEntities = new NarrativeEntitySystem(db);
    const contextManifests = new NarrativeContextManifestRepository(db);
    const eventOccurrences = new EventOccurrenceService(db, calendarService);
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
    let progressionContext = loadNarrativeProgressionContext(progression, workspaceId);
    const { RoleplaySkills } = require('../../dist-main/main/features/narrative/roleplay-skills');
    const skillSystem = new RoleplaySkills(db);
    let skillsContext = loadNarrativeSkillsContext(skillSystem, workspaceId);
    const allEntities = db.prepare(`
        SELECT id, type, canonicalName, aliases, lore, data FROM entities
        WHERE workspaceId = ? AND status != 'proposed'
          AND type IN ('Characters', 'Creatures', 'Locations', 'Items', 'Factions', 'Events')
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
    // Only who is in the scene or named this turn can grow, so Everyone never sends the whole cast.
    if (progressionContext) {
        const ids = progressionContext.ids.filter(id => activeIds.has(id) || mentionedEntityIds.has(id));
        progressionContext = ids.length ? { ...progressionContext, ids } : null;
    }
    if (skillsContext) {
        const ids = skillsContext.ids.filter(id => activeIds.has(id) || mentionedEntityIds.has(id));
        skillsContext = ids.length ? { ...skillsContext, ids } : null;
    }
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
    const actorIds = new Set(allEntities
        .filter(entity => entity.type === 'Characters' || entity.type === 'Creatures')
        .map(entity => entity.id));
    const factionIds = new Set(allEntities.filter(entity => entity.type === 'Factions').map(entity => entity.id));
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
    const triagePayloadValue = {
        currentScene: compactNarrativeScene(scene, roleplaySettings.playerEntityId),
        currentTime: startClock,
        calendar: {
            name: calendar.name,
            hoursPerDay: calendar.hoursPerDay,
            months: calendar.months.map(month => ({ name: month.name, days: month.days })),
            weekdays: calendar.weekdays,
            seasons: calendar.seasons
        },
        timeMatrix,
        availableEntities: compactEntities,
        progression: progressionContext ? {
            characterIds: progressionContext.ids
        } : undefined,
        skills: skillsContext ? {
            characterIds: skillsContext.ids
        } : undefined,
        candidateSignals: narrativeSignals,
        characterStances: characterStances.length ? characterStances : undefined,
        userMessage,
        narrativeResponse
    };
    const triagePayload = JSON.stringify(triagePayloadValue);
    const narrativePayloadTokens = workspacePayloadTokens(workspaceId);
    const narrativeTelemetry = {
        structuredFallbacks: 0,
        structuredFallbackStages: [],
        structuredOutputMode: 'schema'
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
        chatHistory: [], newPrompt: triagePayload, temperature: 0, maxTokens: 2560, maxPayloadTokens: narrativePayloadTokens, manualMode: false, manualJson: null
    }, NARRATIVE_TRIAGE_SCHEMA, 'Narrative State triage', narrativeTelemetry);
    const triagePrimaryOutputTokens = estimateTokens(triageResponse);
    let triage = safeParseObject(triageResponse);
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
        triage = safeParseObject(triageResponse);
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
    const routing = resolveNarrativeRouting({ triage, signals: narrativeSignals });
    const forceDeepAnalysis = routing.forceDeepAnalysis;
    if (!triage?.consequential && !forceDeepAnalysis) {
        const timeFrame = recordTimeFrame(triage?.timeAdvance);
        settleSceneMemory();
        const triageInputTokens = estimateTokens(triageSystemPrompt) + estimateTokens(triagePayload);
        const triageOutputTokens = triagePrimaryOutputTokens;
        const elapsedMs = Date.now() - startedAt;
        narrativeState.finishJob(workspaceId, provenanceId, 'skipped', { inputTokens: triageInputTokens, outputTokens: triageOutputTokens });
        narrativeState.recordMetric({ workspaceId, originId: provenanceId, triageInputTokens, triageOutputTokens, deepInputTokens: 0, deepOutputTokens: 0, deepAnalysis: false, proposalCount: 0, elapsedMs, recordedAt: Date.now() });
        return {
            changes: timeFrame.advance ? [{ kind: 'time', frame: timeFrame }] : [],
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
                contextUsage: measureNarrativeContextSections(triagePayloadValue, triageSystemPrompt),
                repairs: {
                    triage: triageRepairCount,
                    deep: 0,
                    structuredFallbacks: narrativeTelemetry.structuredFallbacks,
                    structuredFallbackStages: narrativeTelemetry.structuredFallbackStages,
                    structuredOutputMode: narrativeTelemetry.structuredOutputMode
                },
                usage: { triageInput: triageInputTokens, triageOutput: triageOutputTokens, repairInput: repairInputTokens, repairOutput: repairOutputTokens },
                elapsedMs
            }
        };
    }

    const selectedDomains = routing.selectedDomains;
    const shouldAnalyzeEpistemicState = hasEpistemicDomain(selectedDomains);
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
    const focusIds = new Set([
        roleplaySettings.playerEntityId,
        ...(scene?.participantIds || []),
        ...(triagePresentIds || []),
        ...narrativeSignals.mentionedEntityIds,
        ...triageEntityIds
    ].filter(Boolean));
    const perspectiveSelection = shouldAnalyzeEpistemicState && holderIds.size + targetIds.size ? selectPerspectiveRecords(db.prepare(`
        SELECT records.record_type AS type, records.subject_id AS subjectId, records.payload_json AS payload
        FROM narrative_records records
        JOIN narrative_events events
          ON events.workspace_id = records.workspace_id AND events.event_id = records.source_event_id
        LEFT JOIN narrative_event_evidence evidence
          ON evidence.workspace_id = events.workspace_id AND evidence.event_id = events.event_id AND evidence.ordinal = 0
        LEFT JOIN narrative_origin_lifecycle lifecycle
          ON lifecycle.workspace_id = events.workspace_id AND lifecycle.origin_id = evidence.origin_id
        WHERE records.workspace_id = ? AND (
          (records.record_type IN ('knowledge', 'belief', 'memory') AND records.subject_id IN (${[...holderIds].map(() => '?').join(',') || 'NULL'}))
          OR records.record_type IN ('fact', 'state')
        )
          AND COALESCE(lifecycle.status, 'active') = 'active'
        ORDER BY records.applied_at DESC
    `).all(workspaceId, ...holderIds)
        .map(row => ({ type: row.type, subjectId: row.subjectId, value: safeParseObject(row.payload) || {} })), {
        holderIds: holders.present,
        mentionedHolderIds: holders.mentioned,
        targetIds,
        focusIds
    }) : { records: [], candidates: 0 };
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
    const shouldAnalyzeInventory = selectedDomains.includes('inventory');
    const shouldAnalyzeResources = selectedDomains.includes('resource');
    const shouldAnalyzeScene = selectedDomains.includes('scene');
    const relevantHolderIds = new Set([
        roleplaySettings.playerEntityId,
        ...(scene?.participantIds || []),
        ...(scene?.possibleObserverIds || []),
        ...(scene?.nearbyIds || []),
        ...witnessIds
    ].filter(id => actorIds.has(id)));
    const relevantItemIds = new Set(narrativeSignals.mentionedItemIds);
    const currentInventoryState = shouldAnalyzeInventory
        ? loadNarrativeInventoryState(workspaceId, relevantHolderIds, relevantItemIds)
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
    const newCharacterProfile = selectedDomains.includes('entity')
        ? describeNewCharacterProfile(progression, skillSystem, workspaceId)
        : null;
    const payloadValue = {
        routing: {
            selectedDomains,
            mode: routing.mode,
            requiresFullAnalysis: routing.requiresFullAnalysis,
            candidateSignals: narrativeSignals.signals
        },
        currentScene: compactNarrativeScene(scene, roleplaySettings.playerEntityId),
        preTurnContext: scopedManifest || undefined,
        availableEntities: selectedDomains.includes('entity')
            ? relevantEntities
            : relevantEntities.map(entity => compactEntities.find(candidate => candidate.id === entity.id)),
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
        currentResourceStates: shouldAnalyzeResources ? currentResourceStates : undefined,
        newCharacterProfile: newCharacterProfile || undefined,
        progression: shouldAnalyzeResources && progressionContext
            ? describeNarrativeProgression(progression, workspaceId, progressionContext)
            : undefined,
        skills: shouldAnalyzeResources && skillsContext
            ? describeNarrativeSkills(skillSystem, workspaceId, skillsContext)
            : undefined,
        currentInventoryState: shouldAnalyzeInventory ? currentInventoryState : undefined,
        currentLocationInventoryState: shouldAnalyzeInventory ? currentLocationInventoryState : undefined,
        reachableLocationIds: shouldAnalyzeScene ? [...reachableLocationIds] : undefined,
        // A move outside the reachable set is rejected anyway, so links beyond it only cost tokens.
        locationLinks: shouldAnalyzeScene
            ? locationLinks.filter(link => reachableLocationIds.has(link.fromId) && reachableLocationIds.has(link.toId))
            : undefined,
        currentPerspectiveState: shouldAnalyzeEpistemicState ? currentPerspectiveState : undefined,
        currentKnowledgeCards: shouldAnalyzeEpistemicState ? currentKnowledgeCards : undefined,
        currentRelationshipState: shouldAnalyzeEpistemicState ? currentRelationshipState.rows : undefined,
        userMessage,
        narrativeResponse
    };
    const narrativeStateSystemPrompt = buildNarrativeStateSystemPrompt(
        selectedDomains,
        narrativeLanguageInstruction,
        Boolean(shouldAnalyzeResources && progressionContext),
        Boolean(shouldAnalyzeResources && skillsContext),
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
    let response = await sendNarrativeJson({
        apiProfileId: role.executor.apiProfileId,
        model: role.executor.model,
        systemPrompt: narrativeStateSystemPrompt,
        chatHistory: [],
        newPrompt: payload,
        temperature: 0,
        maxTokens: stateOutputBudget,
        payloadLimit: narrativeLimit,
        manualMode: false,
        manualJson: null
    }, NARRATIVE_STATE_SCHEMA, 'Narrative State analysis', narrativeTelemetry);
    const deepPrimaryOutputTokens = estimateTokens(response);
    let parsed = safeParseObject(response);
    if (!parsed) {
        deepRepairCount += 1;
        repairInputTokens += estimateTokens(repairSystemPrompt)
            + estimateTokens(`INVALID RESPONSE:\n${String(response || '').slice(0, 16000)}`);
        response = await repairNarrativeJson({
            executor: role.executor,
            invalidResponse: response,
            schema: NARRATIVE_STATE_SCHEMA,
            label: 'Narrative State analysis',
            telemetry: narrativeTelemetry,
            maxPayloadTokens: narrativePayloadTokens,
            languageInstruction: narrativeLanguageInstruction
        });
        repairOutputTokens += estimateTokens(response);
        parsed = safeParseObject(response);
    }
    if (!parsed) {
        narrativeState.finishJob(workspaceId, provenanceId, 'failed', { deepAnalysis: true, error: 'Narrative State returned invalid JSON.' });
        throw new Error('Narrative State returned invalid Roleplay state JSON.');
    }
    const routedResult = constrainNarrativeStateResult(parsed, selectedDomains);

    const changes = [];
    const referenceIds = new Map();
    const narrativeIntroductions = [];
    const identityContactCandidates = [];
    const narrativeSkips = [];
    const invalidInventoryChanges = [];
    const excludedRelationshipSourceIds = new Set([roleplaySettings.playerEntityId].filter(Boolean));
    let generatedContactEventCount = 0;
    let narrativeProposalCount = 0;
    let overflowEventCount = 0;
    const narrativeRejections = [];
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
        const change = narrativeEntities.resolveOrPropose(workspaceId, provenanceId, proposal, { sceneLocationId: scene?.locationId });
        changes.push({ kind: 'entity', ...change });
        if (change.entityId) {
            referenceIds.set(proposal.referenceId, change.entityId);
            allowedEntityIds.add(change.entityId);
            if (proposal.type === 'Characters' || proposal.type === 'Creatures') actorIds.add(change.entityId);
            narrativeIntroductions.push({ proposal, entityId: change.entityId });
        }
    }
    const resolveReference = value => referenceIds.get(value) || value;
    const resolved = resolveNarrativeEntityReferences(routedResult, resolveReference);
    const scenePatch = buildNarrativeScenePatch(scene, resolved.scenePatch, narrativeIntroductions, narrativeSignals);
    const resolvedEvents = ensureEncounterRelationshipOperations(
        workspaceId,
        resolved.events,
        roleplaySettings.playerEntityId
    );
    const finalParticipantIds = scenePatch.participantIds ?? scene?.participantIds ?? [];
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
    for (const [index, proposal] of (Array.isArray(resolved.resourceChanges) ? resolved.resourceChanges : []).entries()) {
        if (typeof proposal?.entityId !== 'string') continue;
        if (proposal.skill) {
            if (!skillsContext || !['assign', 'rank', 'create'].includes(proposal.skill)) continue;
            try {
                const change = skillSystem.proposeChange({
                    id: `${provenanceId}:skill:${index}`,
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
                console.warn('[Roleplay State] Ignored invalid skill change:', error.message);
            }
            continue;
        }
        if (proposal.progress) {
            const trait = progressionContext ? findByReference(progressionContext.traits, proposal.attribute ?? proposal.key) : undefined;
            if (proposal.progress !== 'xp' && (proposal.progress !== 'attribute' || !trait)) continue;
            try {
                const change = progression.proposeChange({
                    id: `${provenanceId}:progress:${index}`,
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
                console.warn('[Roleplay State] Ignored invalid progression change:', error.message);
            }
            continue;
        }
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
            const change = roleplay.proposeSceneChange({
                id: `${provenanceId}:scene`,
                workspaceId,
                patch: scenePatch,
                source: 'ai',
                provenanceId
            });
            changes.push({ kind: 'scene', changeId: change.id, ...change });
        } catch (error) {
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
                    originId: provenanceId,
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
                        eventOccurrences.linkNarrative({ workspaceId, originId: provenanceId, record: result.record, event: normalizedEvent, startDate: startClock });
                    }
                    changes.push({ kind: 'narrative', eventId: result.record.proposal.changeSet.event.id, status: result.record.status, decision: result.decision, description: result.record.proposal.changeSet.event.description });
                } else if (result.skipped) {
                    narrativeSkips.push({ description: event.description, reason: result.skipped });
                }
                for (const rejection of result.rejections || []) narrativeRejections.push(rejection);
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
    const appliedLocationId = roleplay.getScene(workspaceId)?.locationId;
    const endLocationId = (rejectedSceneChange ? null : routedResult.scenePatch?.locationId) || appliedLocationId;
    // Only a move that happened charges the clock; one awaiting approval may still be rejected.
    const travelFloorMinutes = resolveTravelFloorMinutes({
        startLocationId: scene?.locationId,
        endLocationId: appliedLocationId,
        locationLinks,
        locationSizes,
        timeMatrix
    });
    const timeFrame = recordTimeFrame(triage?.timeAdvance, endLocationId, travelFloorMinutes);
    settleSceneMemory();
    if (timeFrame.advance) changes.push({ kind: 'time', frame: timeFrame });
    const triageInputTokens = estimateTokens(triageSystemPrompt) + estimateTokens(triagePayload);
    const triageOutputTokens = triagePrimaryOutputTokens;
    const deepInputTokens = estimateTokens(narrativeStateSystemPrompt) + estimateTokens(payload);
    const deepOutputTokens = deepPrimaryOutputTokens;
    const elapsedMs = Date.now() - startedAt;
    narrativeState.finishJob(workspaceId, provenanceId, 'completed', { deepAnalysis: true, inputTokens: deepInputTokens, outputTokens: deepOutputTokens });
    narrativeState.recordMetric({ workspaceId, originId: provenanceId, triageInputTokens, triageOutputTokens, deepInputTokens, deepOutputTokens, deepAnalysis: true, proposalCount: narrativeProposalCount, elapsedMs, recordedAt: Date.now() });
    return {
        changes,
        diagnostics: {
            status: narrativeSkips.length || invalidInventoryChanges.length || rejectedSceneChange ? 'completed-with-warnings' : 'completed',
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
                analysis: measureNarrativeContextSections(payloadValue, narrativeStateSystemPrompt),
                analysisScope: shouldAnalyzeEpistemicState ? {
                    holders: { present: holders.present.size, mentioned: holders.mentioned.size },
                    perspectiveRecords: { sent: currentPerspectiveState.length, candidates: perspectiveSelection.candidates },
                    relationships: { sent: currentRelationshipState.rows.length, candidates: currentRelationshipState.candidates }
                } : undefined
            },
            repairs: {
                triage: triageRepairCount,
                deep: deepRepairCount,
                structuredFallbacks: narrativeTelemetry.structuredFallbacks,
                structuredFallbackStages: narrativeTelemetry.structuredFallbackStages,
                structuredOutputMode: narrativeTelemetry.structuredOutputMode
            },
            analysis: {
                newEntities: routedResult.newEntities.length,
                identityUpdates: routedResult.identityUpdates.length,
                resourceChanges: routedResult.resourceChanges.length,
                inventoryChanges: routedResult.inventoryChanges.length,
                inventoryChangesApplied: changes.filter(change => change.kind === 'inventory').length,
                invalidInventoryChanges: invalidInventoryChanges.length,
                events: routedResult.events.length + generatedContactEventCount,
                rawEvents: routedResult.events.length,
                persistedEvents: narrativeProposalCount,
                skippedEvents: narrativeSkips.length,
                skippedEventReasons: [...new Set(narrativeSkips.map(skip => skip.reason))],
                generatedContactEvents: generatedContactEventCount,
                scenePatch: Boolean(routedResult.scenePatch && Object.keys(routedResult.scenePatch).length),
                rejectedScenePatch: rejectedSceneChange?.reason ?? null,
                overflowEvents: overflowEventCount,
                filteredOperations: narrativeRejections.length,
                filteredOperationReasons: summarizeNarrativeRejections(narrativeRejections)
            },
            skippedNarrativeEvents: narrativeSkips,
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
                repairOutput: repairOutputTokens
            },
            elapsedMs
        }
    };
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
    const result = await updateRoleplayStateWithSystemAi({
        workspaceId,
        provenanceId: originId,
        userMessage: user.content,
        narrativeResponse: narrative.content
    });
    if (result.diagnostics) {
        const current = db.prepare('SELECT debugNotice FROM messages WHERE id = ? AND chatId = ?')
            .get(originId, workspaceId);
        const parsed = safeParseObject(current?.debugNotice) || {};
        const updated = mergeNarrativeStateDiagnostics(parsed, result.diagnostics);
        db.prepare('UPDATE messages SET debugNotice = ? WHERE id = ? AND chatId = ?')
            .run(JSON.stringify(updated), originId, workspaceId);
    }
    return result.changes;
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

function loadNarrativeInventoryState(workspaceId, holderIds, itemIds) {
    const holders = [...holderIds];
    const items = [...itemIds];
    const conditions = [];
    const parameters = [workspaceId];
    if (holders.length) {
        conditions.push(`links.toId IN (${holders.map(() => '?').join(',')})`);
        parameters.push(...holders);
    }
    if (items.length) {
        conditions.push(`links.fromId IN (${items.map(() => '?').join(',')})`);
        parameters.push(...items);
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
Return JSON only with {"consequential":boolean,"types":["entity","scene","resource","inventory","awareness","knowledge","belief","memory","relationship","fact"],"entityIds":["existing-id"],"presentIds":["existing-id"],"confidence":0.0,"evidence":["short verbatim excerpt"],"requiresFullAnalysis":boolean,"reason":"brief","timeAdvance":null,"sceneMemory":[]}. entityIds lists every supplied entity the turn involves or is about, including one that is discussed or implied without being present. presentIds lists the supplied Characters and Creatures physically in the scene when the turn ends, including anyone who arrived during it and excluding anyone only mentioned, remembered or written to.
Always evaluate elapsed time, even when no other durable domain is consequential. For an in-world action, timeAdvance is {"actionType":"short_snake_case","basis":"explicit|matrix","duration":{"years":0,"months":0,"days":0,"hours":0,"minutes":0},"targetPosition":null,"confidence":0.0,"evidence":"short verbatim excerpt","statedSpan":null}. When the final narrative establishes an absolute ending date or time, set basis to "explicit", copy the complete resulting calendar position into targetPosition, and also return the calculated duration. Use null for out-of-character instructions, corrections, hypothetical actions, or when no in-world time passed. A skip of days, months or years is returned in the same duration object and is accepted only when the turn says so in words: an estimate on its own is held to a week. Whenever the user message or the narrative states a span of time, also return statedSpan as {"excerpt":"the exact words that state it, copied verbatim","amount":3,"unit":"minutes|hours|days|weeks|months|years|decades","asserts":"now|framing|history"}: "now" when that time passes in this turn, "framing" when it only frames a scene (a flashback or a setting), "history" when it recounts the world's past. Otherwise statedSpan is null. Never translate or paraphrase the excerpt. Travel always costs time: when the turn completes a journey between places, timeAdvance is never null, and its duration must match the distance actually crossed rather than the length of the passage describing it. Walking somewhere is usually described in two lines and still takes as long as the walk takes, so read the duration off the timeMatrix category the journey belongs to and never below that category's minimumMinutes.
An explicit final position or duration in the narrative wins over the matrix. Reconcile every clock reference with currentTime; do not describe a turn as reaching a later time while returning null or a conflicting duration. Otherwise choose a reasonable value within the supplied matrix: Micro for dialogue lines, combat rounds, lockpicking, and quick scans; Local for same-district walking, wound care, and careful room inspection; Transit for cross-district travel, crowds, minor repairs, and setting camp; Macro for crafting, deep study, rest, and inter-city travel; Timeskip for supported downtime, recovery, waiting, long-distance travel, or another transition spanning one or more calendar days. Do not advance hours during line-by-line dialogue. Do not use a tiny advance for substantial travel. A jump of one day or more must be explicitly supported by the final narrative or by a completed action whose duration is covered by the configured Timeskip range. Return calendar units directly instead of assuming a 24-hour day.
Mark inventory for explicit pickup, drop, transfer, gift, theft, loss, consumption, equip, unequip, drawing, sheathing, or quantity change. Mark scene for explicit arrival, departure, movement, participation, observer, nearby, object, or location change. Mark epistemic domains only for information actually communicated, perceived, discovered, remembered, believed, or relationally consequential. Mark relationship for a first demonstrated encounter or interaction that must initialize a directional relationship, even when its initial value is 0, and for an event that materially and durably changes an existing value. Direct conversation is mutual interaction. Listening or overhearing is interaction only from the aware listener toward the speaker unless the speaker also perceives the listener. Mere co-presence is not interaction. Ordinary politeness, irritation, banter, compliance, disagreement, or passing mood does not change an existing value. Mark resource for an actual value change, not a price mention or hypothetical. When progression is supplied, also mark resource for an outcome that earns experience, or training that changes an attribute, for one of progression.characterIds. When skills is supplied, also mark resource when one of skills.characterIds clearly learns a skill or reaches a milestone in one. A concrete edition of a supplied recurring Event is consequential when it actually takes place, even if the tradition itself is already known.
A newly introduced persistent named character, stably identifiable individual creature, named location, or narratively important unique item is consequential even without an existing ID. An unnamed person distinguished only by appearance, ancestry, clothing, age, expression, or scene position may be routed as a sparse entity candidate, but is not yet a Worldbuild identity. Mark false for crowds, atmosphere, repetition, casual dialogue, hypotheticals, offers not completed, item mentions without possession changes, and events without durable consequences. Presence alone never grants awareness or knowledge. Set requiresFullAnalysis only when four or more domains interact or the consequence cannot be safely isolated.
sceneMemory is short-lived working memory, separate from every durable domain above, and is filled even when consequential is false. For each Character or Creature in presentIds other than currentScene.playerEntityId who took in something new this turn, return {"entityId":"id","perceived":["..."],"heard":[{"fromId":"speaker id or empty string","text":"..."}],"stance":"..."}. perceived lists what that character directly saw or heard happen in front of them, a few words each, with names, numbers and objects exactly as they appeared to that character. heard lists what was said to them or within their hearing, as the speaker's claim and never as the truth, keeping the speaker's own figures and wording; fromId is the speaker's supplied id, or an empty string when the speaker has none. A character who arrived during the turn records only what happened after arriving. Never record another character's thoughts, narration they could not perceive, or anything only the narrator knows: if the narration counts ten crates but the character was only told eight, they heard eight. stance is one short line on what they want right now and how they regard the player character, written only when it is new or differs from characterStances, otherwise an empty string. Skip characters with nothing new, and return [] when nobody qualifies.`;
const NARRATIVE_REPAIR_SYSTEM_PROMPT = 'Repair the supplied response into one valid JSON object that follows the required schema. Preserve supported values. Return JSON only.';

const NARRATIVE_FULL_STATE_SYSTEM_PROMPT = `You are Kallamo's Narrative State interpreter. Never write narrative prose. Extract only explicit, durable consequences from the supplied user message and narrative response. Use only supplied entity IDs and resource keys.
Return JSON only with {"newEntities":[],"identityUpdates":[],"resourceChanges":[],"scenePatch":{},"inventoryChanges":[],"events":[]}.
The user message is the player character's chosen action. The narrative response contains world and NPC consequences. Never infer a player choice, line, intention, emotion, memory, or private thought that the user did not supply.
preTurnContext is the exact compact epistemic manifest used for generation. Use its separate subject assessments to decide who could acquire information this turn. "undetermined" is not ignorance. "derived" and "evidence-candidate" are not automatically canon. currentKnowledgeCards contains Awareness and known-field coverage at the start of the turn.
When the final narrative clearly introduces a persistent Character, individual Creature, named Location, or narratively important Item that is absent from availableEntities, add {"referenceId":"new:stable-local-key","name":"canonical name or concise sparse label","type":"Characters|Creatures|Locations|Items","aliases":[],"description":"only explicit introduction facts","excerpt":"short verbatim evidence","confidence":0.0,"decision":"new|ambiguous|conflicting","identityEstablished":true|false,"reason":"brief","itemNature":"unique|type","scenePresence":"participant|observer|nearby|absent","size":"region|area|place|spot"}. Use its referenceId everywhere else in this response. For Locations, size is region when wider than a scene, area when it holds many places, place when a scene happens there, and spot for a room or enclosed space inside a place. For Characters and individual Creatures, set scenePresence to participant only when directly engaged in the action or conversation, observer only when explicitly able to witness or listen, nearby only when physically present in the broader location, and absent for recollections, reports, or offscreen mentions. Scene presence is independent from a location change. Set identityEstablished true only when a proper name, stable title, number, designation, unmistakable continuity identity, or explicit registration establishes who the individual is. Appearance, ancestry, clothing, age, expression, or scene position alone never establishes identity. An individually described but anonymous person may be retained with a concise sparse label and identityEstablished false; it remains reviewable and must not become a Worldbuild entity automatically. Characters and individual Creatures may be created automatically only when identityEstablished is true and the identity is unequivocal. Locations and Items are reviewable. Do not create generic crowds, ordinary item mentions, transformations, disguises, or duplicates. Mark ambiguous identity or possible duplication as ambiguous. Mark an invention that contradicts supplied canon as conflicting.
When the narrative establishes that an existing Character or individual Creature has a newly revealed proper name, corrected name, nickname, title, designation, or alternate spelling, add {"referenceId":"identity:stable-local-key","entityId":"existing-id","canonicalName":"new primary name or empty string","aliases":["new alternate name"],"excerpt":"short verbatim evidence","confidence":0.0,"identityEstablished":true|false,"reason":"brief"} to identityUpdates. Use canonicalName only when the text clearly replaces a provisional, descriptive, or incorrect primary label. Put nicknames, titles, alternate spellings, and additional forms in aliases. The previous canonical name is retained automatically as an alias after a rename. Never remove aliases, change an entity ID or type, or update a Location or Item through identityUpdates. Require explicit same-person evidence such as self-identification, direct naming, registration, or unmistakable continuity. Proximity, pronouns, appearance, ancestry, clothing, age, expression, and scene position are insufficient. If the target identity is uncertain, return no identity update.
Scene patch may contain locationId, participantIds, possibleObserverIds, nearbyIds, and objectIds. Participants are directly involved, possible observers can witness the scene, and nearby entities are present in the broader location without necessarily witnessing it. Update these arrays when an existing or newly introduced character enters, leaves, joins, observes, or moves nearby, even if locationId does not change. When inventory also changes, keep objectIds consistent with unique items explicitly dropped, picked up, consumed, destroyed, or removed. Change location only after movement is completed in the user action or final narrative and use only reachableLocationIds; intention, preparation, a destination plan, an open door, or a visible route is not a completed location change. Never jump to an unrelated branch of the location hierarchy. reachableLocationIds already spans the whole surrounding region, so a completed journey across a city, district, or road belongs here and must not be downgraded to an epistemic record instead. A scene patch is applied whole or not at all: if the destination is not in reachableLocationIds, the participant and object arrays are discarded with it, so return the arrays that match the location you actually set. Presence is not ownership. A possible observer is only a candidate and does not automatically observe or learn.
Inventory changes must be explicit and use currentInventoryState plus currentLocationInventoryState. Track pickup, drop, placement, gift, transfer, theft, loss, consumption, destruction, equip, unequip, drawing, sheathing, and quantities for every Character and individual Creature, including currentScene.playerEntityId. Inventory means everything the character possesses but is not actively using; equipped means only what is actively being used, wielded, worn, or held in use. A carried item in a belt, sheath, scabbard, holster, bag, pocket, or ordinary inventory remains inventory and is not equipped. Determine the final state after the whole user message and narrative response, not the first intermediate action. If the same item is drawn or used and later sheathed, stowed, put away, placed on a belt, or taken off, return only the final equipped:false state. For a unique item move return {"itemId":"id","fromHolderId":"id-or-null","toHolderId":"id-or-null","locationId":"id-or-null","equipped":boolean-when-explicit}. For an item type transfer return {"itemId":"id","fromHolderId":"id-or-null","fromLocationId":"id-or-null","toHolderId":"id-or-null","locationId":"id-or-null","quantity":1,"equipped":boolean-when-explicit}. locationId means deliberately dropped or stored; fromLocationId means picked up. Removal, consumption, or loss may have no destination. For equipment only return {"itemId":"id","holderId":"id","equipped":boolean}. Drawing, wielding, or wearing normally equips; sheathing, stowing, taking off, or putting away normally unequips without changing possession. Never mutate inventory from a mere mention, observation, price, request, offer, or speculation.`;

const NARRATIVE_SCOPED_BASE_PROMPT = `You are Kallamo's Narrative State interpreter. Never write narrative prose. Analyze only routing.selectedDomains. Extract explicit durable consequences from the user action and final narrative. Candidate signals are hints, not facts. Use only supplied IDs and resource keys.
Return JSON only with {"newEntities":[],"identityUpdates":[],"resourceChanges":[],"scenePatch":{},"inventoryChanges":[],"events":[]}. Leave every unselected domain empty. The user message is the player character's chosen action. The narrative response contains world and NPC consequences. Never invent a player choice, line, intention, emotion, memory, or private thought. Empty arrays and an empty scenePatch are correct.`;

const NARRATIVE_ENTITY_SCOPED_PROMPT = `ENTITY DOMAIN: Retain a newly introduced persistent individual absent from availableEntities as either an established identity or a sparse candidate. Return it in newEntities as {"referenceId":"new:stable-local-key","name":"canonical name or concise sparse label","type":"Characters|Creatures|Locations|Items","aliases":[],"description":"explicit introduction facts","excerpt":"short verbatim evidence","confidence":0.0,"decision":"new|ambiguous|conflicting","identityEstablished":true|false,"reason":"brief","itemNature":"unique|type","scenePresence":"participant|observer|nearby|absent","size":"region|area|place|spot"}. For Locations, size is region when wider than a scene, area when it holds many places, place when a scene happens there, and spot for a room or enclosed space inside a place. For Characters and individual Creatures, use participant only for direct involvement, observer only for explicit witnessing or listening, nearby only for broader physical presence, and absent for recollections, reports, or offscreen mentions. This presence can change without a location change. Set identityEstablished true only for a proper name, stable title, number, designation, unmistakable continuity identity, or explicit registration. Appearance, ancestry, clothing, age, expression, or scene position alone means false. Anonymous individuals with false remain sparse and reviewable; they do not become Worldbuild entities automatically. Use referenceId elsewhere. Do not create crowds, ordinary item mentions, disguises, transformations, or duplicates.
When an existing Character or individual Creature is explicitly identified by a newly revealed or corrected primary name, return in identityUpdates {"referenceId":"identity:stable-local-key","entityId":"existing-id","canonicalName":"new primary name or empty string","aliases":["new nickname, title, alternate spelling, or designation"],"excerpt":"short verbatim evidence","confidence":0.0,"identityEstablished":true|false,"reason":"brief"}. Use canonicalName only to replace a provisional, descriptive, or incorrect primary label. Use aliases for additional valid forms. Renames retain the previous primary label as an alias automatically. Never remove an alias or alter an ID or type. Require explicit same-person evidence; proximity, pronouns, appearance, and scene position are insufficient. Return no identity update when the association is uncertain.`;

const NARRATIVE_SCENE_SCOPED_PROMPT = `SCENE DOMAIN: scenePatch may contain locationId, participantIds, possibleObserverIds, nearbyIds, and objectIds. Return complete replacement arrays only for fields that changed. Participants are directly involved, possible observers can witness, nearby entities are in the broader location, and objects are physically present. Explicit completed arrivals, departures, joining a conversation, sitting with the group, leaving, and deliberate movement can change scene membership independently from locationId. Include newly introduced entity referenceIds in the appropriate array. When inventory is also selected, dropping a unique item may add it to objectIds, while picking up, consuming, destroying, or removing it may remove it. Keep unrelated existing objectIds. Change location only after movement is completed and use reachableLocationIds. Intention, preparation, a destination plan, an open door, or a visible route is not a completed location change. reachableLocationIds already spans the whole surrounding region, so a completed journey across a city, district, or road belongs here. A scene patch is applied whole or not at all: if the destination is not in reachableLocationIds, the participant and object arrays are discarded with it, so return the arrays that match the location you actually set. Presence is not ownership or knowledge.`;

const NARRATIVE_RESOURCE_SCOPED_PROMPT = `RESOURCE DOMAIN: resourceChanges contain {"entityId":"id","resource":"resource name","change":signed-number,"reason":"short phrase from the story"}. change is the amount gained (+) or lost (-), never the resulting total; currentResourceStates shows where each value stands, and the value is kept within its range for you. Use only resources listed for that entity in currentResourceStates. Apply only explicit mechanical gains, losses, recovery, damage, or expenditure. Each resource description says what moves it, and lowestEffect says what happens at its lowest. Prices, wages, comparisons, plans, hypotheticals, and narration without an actual value change are not resource changes. Elapsed time is handled separately: never report recovery or drain that comes only from time passing.`;

const NARRATIVE_RESOURCE_MAXIMUM_PROMPT = `RESOURCE MAXIMUM: a resource with maximumRule in availableResources can have its maximum changed for good. Report it as {"entityId":"id","resource":"resource name","maximum":signed-number,"reason":"short phrase from the story"}, only for a lasting change the story clearly shows and that maximumRule allows, such as long training, an implant, a lost limb or a permanent curse. maximum is the amount the maximum moves, never the new total. Potions, blessings, fatigue and anything that will wear off change the current value with change, never the maximum. Rarely, and never twice for the same resource in a turn.`;

const NARRATIVE_PROGRESSION_PROMPT = `PROGRESSION: progression.characters are the only characters who grow. Report their growth as extra items in resourceChanges.
- XP: {"entityId":"id","progress":"xp","change":positive-integer,"reason":"short phrase"} for an outcome that earns experience as progression.xpGuidance describes, such as a won fight, a finished quest or a clever solution. Never for routine actions. XP is only added, unless progression.xpCanDrop is true and the story takes experience away. Never report a level: levels follow from XP.
- Attribute: {"entityId":"id","progress":"attribute","attribute":"attribute name","change":1,"reason":"short phrase"} only when the story clearly earns a lasting change: sustained training, a hard-won lesson, a breakthrough. When progression.attributeRules.whenToRaise is given, it is the world's own bar for a raise and is stricter than any general reason: follow it. One point at a time, and rarely. Use change -1 only when progression.attributeRules.lower is true and the story shows a lasting injury, curse or age. When progression.attributeRules.raise is false, report no attribute raise.`;

const NARRATIVE_INVENTORY_SCOPED_PROMPT = `INVENTORY DOMAIN: Track explicit pickup, drop, deliberate placement, gift, transfer, theft, loss, consumption, destruction, equip, unequip, drawing, sheathing, and quantity changes. currentInventoryState and currentLocationInventoryState are the pre-turn truth.
For a unique item move return {"itemId":"id","fromHolderId":"id-or-null","toHolderId":"id-or-null","locationId":"id-or-null","equipped":boolean-when-explicit}. It has exactly one holder or location. Dropping or deliberately leaving it uses locationId. Loss, consumption, or destruction with no destination uses null targets.
For an item type transfer return {"itemId":"id","fromHolderId":"id-or-null","fromLocationId":"id-or-null","toHolderId":"id-or-null","locationId":"id-or-null","quantity":positive-integer,"equipped":boolean-when-explicit}. fromLocationId means pickup; locationId means dropped or stored. Consumption or loss removes quantity without adding a destination.
For equipment only return {"itemId":"id","holderId":"id","equipped":boolean}. Apply these same rules to every Character and individual Creature in currentInventoryState, including currentScene.playerEntityId. Inventory is possession without active use. Equipped is reserved for active use, such as wielding, holding in use, or wearing. A belt, sheath, scabbard, holster, bag, pocket, or ordinary inventory is not equipped. Determine the final state after the entire turn. Drawing, wielding, wearing, or putting on a carried item normally equips it. Sheathing, stowing, taking off, putting away, or placing it on a belt normally unequips it without changing holder. If an item is used first and then put away later in the same message, return equipped:false. A transfer from an equipped holder includes equipped:false; equipping by the recipient uses equipped:true.
Do not mutate inventory from seeing, discussing, pricing, offering, requesting, touching, or temporary use unless possession, placement, quantity, or equipped state explicitly changes. Never invent an item ID.`;

const NARRATIVE_EPISTEMIC_SCOPED_PROMPT = `EPISTEMIC DOMAINS: preTurnContext is the scoped epistemic manifest used for generation. "undetermined" is not ignorance. "derived" and "evidence-candidate" are not automatically canon. currentKnowledgeCards groups Awareness and known fields by card. currentPerspectiveState holds the current knowledge, beliefs and memories of whoever could perceive this turn (subjectId is the holder), about anyone, plus facts about the entities involved.
Each event contains type, description, a short verbatim excerpt, participantIds, confidence from 0 to 1, and operations. Event type must be exactly one of movement, possession-transfer, revelation, deception, discovery, relationship-change, or custom. Use custom when no narrower allowed type fits. When a concrete edition of a supplied recurring Worldbuild Event actually happens, also return worldbuildEventId, occurrenceTitle, worldDate, and participants with roles plus Faction audience. Do not link plans, recollections, comparisons, or passing mentions as new occurrences. Allowed operations:
{"type":"fact","proposition":{"subjectId":"id","predicate":"stable-key","object":any},"category":"knowledge-category","confidence":0.0}
{"type":"awareness","subjectId":"id","targetId":"id","confidence":0.0}
{"type":"knowledge","subjectId":"id","proposition":{"subjectId":"id","predicate":"stable-key","object":any},"category":"knowledge-category","acquisition":"participant|witness|reported|inferred","informantIds":["id"],"confidence":0.0,"accessibility":"available|suppressed|inaccessible"}
{"type":"belief","subjectId":"id","proposition":{"subjectId":"id","predicate":"stable-key","object":any},"category":"knowledge-category","confidence":0.0}
{"type":"memory","subjectId":"id","summary":"durable personal memory","category":"memory-category","salience":0.0,"accessibility":"available|suppressed|inaccessible"}
{"type":"relationship","sourceEntityId":"id","targetEntityId":"id","dimension":"overall","value":absolute-number,"cause":"relationship-cause","impact":"meaningful|significant|drastic"}

THE DURABILITY TEST: a record exists to keep a campaign coherent across dozens of scenes, not to transcribe the one that just happened. Before every fact, knowledge, belief and memory, ask whether it would still change what someone says, does or withholds ten scenes from now. If the answer is no, it is not a record. The narrative itself is already in the window, so repeating it here buries the few statements that matter under a log of the ones that do not.

KNOWLEDGE CATEGORIES. Every fact, knowledge and belief must declare exactly one category.
Durable, and stored: world-lore (how the world, an institution, a material, a custom or a law works), identity (who or what someone really is, including a true name, origin, allegiance, station or condition), history (a past event, what happened in it and to whom), secret (information deliberately concealed, whose exposure would change what people do), capability (what a person, item, creature or technique can do), intent (a plan, promise, threat or goal that outlives the scene), bond (what a subject knows about a relationship between others).
Momentary, and discarded: scene-state (where someone is, what they are doing right now, who is present, how they look, what they are holding), small-talk (courtesy, mood, banter, routine action, an observation with no later consequence).
Classify honestly. Momentary content given a durable category corrupts the campaign, while classifying it as scene-state or small-talk is the correct answer and costs nothing. Never invent a category outside this list.

MEMORY CATEGORIES. Every memory must declare exactly one: formative, bond, loss, trauma, triumph, oath or revelation for what a character carries; routine for anything they would not still be thinking about tomorrow. A memory is one person's experience in their own perspective, not a summary of the event. Do not write the same summary for several subjects: give each their own, or record none. Record memories only for directly participating Characters, individual Creatures, and institutionally involved Factions, never for Locations or Items.

RELATIONSHIP CAUSES. Every relationship operation must name the cause that actually moved the bar.
Causes that move it: betrayal, sacrifice, rescue, revelation, oath, cruelty, humiliation, forgiveness, shared-loss, sustained-trust, material-debt, first-impression.
Causes that never move it: courtesy, banter, routine-cooperation, mood, compliance, instruction, presence. A helping hand, a polite greeting, following an order, training together, sharing a room and ordinary kindness are not changes of regard. Name one of these and return the current value unchanged, or omit the operation entirely.

Awareness requires demonstrated interaction, recognition, testimony, discovery, conscious possession, or a relationship. Shared presence is insufficient. Grant knowledge only when the subject actually acquires the exact proposition in this turn. Set acquisition from how they came by it: participant or witness for first-hand perception, reported when someone told them, inferred when they reasoned it out. Reading a written text in the scene counts as being told by its author: use reported, with the author's id in informantIds when the author is known, and record what the text claims as the author's claim, not as fact. Return informantIds only with reported acquisition, naming the supplied ids of whoever told them, and omit the field otherwise. A subject is never their own informant, and never records knowledge about themselves unless the category is secret, identity or intent. Narrator-only information, unnoticed events, private thoughts, vague implication, and contextual availability are not character knowledge. Use belief for rumors, deception, disputed claims, suspicion, and unsupported inference. When a speaker reports observations and a personal theory, listeners gain reported Knowledge of the observations and of the speaker's claim; only the speaker receives the Belief unless a listener explicitly accepts it. Existing Awareness in currentKnowledgeCards is sufficient; do not repeat it only to make knowledge valid. Group knowledge requires explicit collective communication or a shared source. Do not union member knowledge. A Faction that learns through one of its own uses reported acquisition with that member in informantIds. Knowledge held by a Faction is institutional and never becomes a member's own record automatically: when a scene shows a member being told what the group holds, record it for that member with reported acquisition naming who told them.
A proposition object is a statement in words, never an id and never a bare key. When an object names an entity, use its supplied id; otherwise write plain prose. Scene membership, position and current activity belong to scenePatch alone and never to a fact, knowledge or belief, whatever the predicate is called. A perception shared by everyone present, withheld from nobody, and without later consequence is already carried by the scene and needs no record.
Relationship changes only the directional numeric bar. Never return a title or description. currentScene.playerEntityId identifies the Player. The Player's feelings are unknowable: never emit a relationship operation whose sourceEntityId is the Player. You may emit Awareness with the Player as subject or target. When an NPC is explicitly presented to the Player, record Player-to-NPC Awareness, NPC-to-Player Awareness, and only the NPC-to-Player directional relationship. Use currentRelationshipState as the baseline and return an absolute value. On a first demonstrated encounter or interaction, initialize the supported non-Player directional relationship and Awareness card with cause first-impression. Direct mutual interaction normally requires both directions. Listening or overhearing requires listener-to-speaker only unless the speaker perceives the listener. Default a new relationship to 0. Prior favorable or adverse information normally supports an initial value within -25 to 25 with meaningful impact. Significant explicit evidence may support up to -50 or 50 with significant impact. Set drastic impact and use values approaching -100 or 100 only for extreme explicit evidence such as established hatred, mortal enmity, absolute devotion, or an equivalent relationship-defining fact. Directions may differ. For an existing relationship, a meaningful durable shift should stay near 5 points, a significant major act or repeated pattern may move up to 15, and drastic is reserved for explicit betrayal, sacrifice, life-saving action, devastating revelation, or equivalent rupture.
Ignore existing knowledge and existing memories when deciding what happened, but never restate something the campaign already holds. A turn that changes nothing durable returns no events at all, and that is a correct answer. Most turns produce at most one or two records, and returning many is a sign the durability test was skipped.`;

const NARRATIVE_SKILLS_PROMPT = `SKILLS: skills.characters are the only characters whose skills change. Report changes as extra items in resourceChanges. Ranks are skills.ranks, lowest first; each character's skills show the rank they hold now.
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

function buildNarrativeStateSystemPrompt(domains, languageInstruction = '', withProgression = false, withSkills = false, withStartingProfile = false, withMaximum = false) {
    const sections = languageInstruction ? [languageInstruction] : [];
    const progressionPrompt = [
        domains.includes('resource') && withProgression ? NARRATIVE_PROGRESSION_PROMPT : null,
        domains.includes('resource') && withSkills ? NARRATIVE_SKILLS_PROMPT : null
    ].filter(Boolean).join('\n\n') || null;
    if (domains.length >= 4) {
        sections.push(NARRATIVE_FULL_STATE_SYSTEM_PROMPT);
        if (domains.includes('resource')) sections.push(NARRATIVE_RESOURCE_SCOPED_PROMPT);
        if (domains.includes('resource') && withMaximum) sections.push(NARRATIVE_RESOURCE_MAXIMUM_PROMPT);
        if (progressionPrompt) sections.push(progressionPrompt);
        if (withStartingProfile) sections.push(NARRATIVE_STARTING_PROFILE_PROMPT);
        // Events and the durability taxonomy are defined once, in the epistemic prompt.
        if (hasEpistemicDomain(domains)) sections.push(NARRATIVE_EPISTEMIC_SCOPED_PROMPT);
        sections.push(`Selected domains: ${domains.join(', ')}. Leave unselected domains empty.`);
        return sections.join('\n\n');
    }
    sections.push(NARRATIVE_SCOPED_BASE_PROMPT);
    if (domains.includes('entity')) sections.push(NARRATIVE_ENTITY_SCOPED_PROMPT);
    if (domains.includes('entity') && withStartingProfile) sections.push(NARRATIVE_STARTING_PROFILE_PROMPT);
    if (domains.includes('scene')) sections.push(NARRATIVE_SCENE_SCOPED_PROMPT);
    if (domains.includes('resource')) sections.push(NARRATIVE_RESOURCE_SCOPED_PROMPT);
    if (domains.includes('resource') && withMaximum) sections.push(NARRATIVE_RESOURCE_MAXIMUM_PROMPT);
    if (progressionPrompt) sections.push(progressionPrompt);
    if (domains.includes('inventory')) sections.push(NARRATIVE_INVENTORY_SCOPED_PROMPT);
    if (hasEpistemicDomain(domains)) sections.push(NARRATIVE_EPISTEMIC_SCOPED_PROMPT);
    sections.push(`Selected domains: ${domains.join(', ')}.`);
    return sections.join('\n\n');
}

async function sendNarrativeJson(params, schema, label, telemetry) {
    const capabilityBase = `${params.apiProfileId || 'profile'}\u0000${params.model || 'model'}`;
    const schemaKind = schema === NARRATIVE_TRIAGE_SCHEMA ? 'triage' : schema === NARRATIVE_STATE_SCHEMA ? 'state' : 'other';
    const globalCapabilityKey = `${capabilityBase}\u0000all`;
    const schemaCapabilityKey = `${capabilityBase}\u0000${schemaKind}`;
    if (narrativeStructuredOutputUnavailable.has(globalCapabilityKey)
        || narrativeStructuredOutputUnavailable.has(schemaCapabilityKey)) {
        if (telemetry) telemetry.structuredOutputMode = 'prompt-cached';
        return sendApiRequest({ ...params, jsonMode: false, jsonSchema: null });
    }
    const onStructuredFallback = ({ remembered }) => {
        if (!telemetry) return;
        if (remembered) {
            telemetry.structuredOutputMode = 'prompt-cached';
            return;
        }
        telemetry.structuredFallbacks += 1;
        telemetry.structuredFallbackStages.push(label);
        telemetry.structuredOutputMode = 'prompt-fallback';
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

/** The journey's floor from the location graph and the Time Cost Matrix; what the map cannot place is transit. */
function resolveTravelFloorMinutes({ startLocationId, endLocationId, locationLinks, locationSizes, timeMatrix }) {
    const categoryId = travelCategory(startLocationId, endLocationId, locationLinks || [], locationSizes);
    if (!categoryId) return 0;
    const calendar = require('./features/worldbuild/calendar-service');
    return calendar.matrixMinimumMinutes(timeMatrix, categoryId)
        || calendar.matrixMinimumMinutes(timeMatrix, 'local');
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

function buildNarrativeScenePatch(currentScene, rawPatch, introductions, narrativeSignals = {}) {
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
    if (Object.hasOwn(patch, 'locationId') && !hasCompletedMovement) delete patch.locationId;
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

function entityEnrichmentMaxTokens(entity) {
    const currentLoreLength = String(entity.type === 'System' ? entity.data?.content || '' : entity.lore || '').length;
    const minimum = entity.type === 'System' ? 2400 : 1800;
    const maximum = entity.type === 'System' ? 5000 : 4000;
    return Math.min(maximum, Math.max(minimum, 1200 + Math.ceil(currentLoreLength / 3.5)));
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

// `from: 'target'` means the edge starts at the linked entity. Enrichment only links
// existing entities; it never creates them.
const ENRICH_RELATIONS = {
    Characters: [
        { key: 'race',          label: 'Race',         relType: 'is_race',      targetType: 'Races',      from: 'self',   single: true },
        { key: 'factions',      label: 'Faction',      relType: 'member_of',    targetType: 'Factions',   from: 'self',   single: false },
        { key: 'locations',     label: 'Location',     relType: 'connected_to', targetType: 'Locations',  from: 'self',   single: false },
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

function submitEntityNarrativeSuggestions({ workspaceId, entity, changes, allEntities, evidenceEntries, interpreterId }) {
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
    const recordedMemories = new Map();
    const memoriesOf = ownerId => {
        if (!recordedMemories.has(ownerId)) {
            const rows = db.prepare(`SELECT payload_json FROM narrative_records WHERE workspace_id = ? AND record_type = 'memory' AND subject_id = ?`).all(workspaceId, ownerId);
            recordedMemories.set(ownerId, rows.flatMap(row => {
                try {
                    const memory = JSON.parse(row.payload_json);
                    return memory?.status === 'active' ? [comparableText(memory.summary)] : [];
                } catch { return []; }
            }).filter(Boolean));
        }
        return recordedMemories.get(ownerId);
    };
    // The same past event, told again with fewer or the same words, is not a new memory.
    const isKnownMemory = (ownerId, summary) => {
        const text = comparableText(summary);
        return memoriesOf(ownerId).some(known => known === text || known.includes(text) || (text.length > 40 && text.includes(known)));
    };
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
            if (isKnownMemory(ownerId, change.value) || !acceptsMemory(ownerId, change.evidence)) continue;
            memoriesOf(ownerId).push(comparableText(change.value));
            const relatedId = resolveTarget(change.targetId, change.target);
            operations.push({ type: 'memory', subjectId: ownerId, summary: change.value, salience: 0.8, accessibility, relatedEntityIds: relatedId && relatedId !== ownerId ? [relatedId] : [] });
        } else if (change.kind === 'knowledge' || change.kind === 'belief') {
            const aboutId = resolveTarget(change.targetId, change.target) || ownerId;
            if (!aboutId || !change.value) continue;
            // What the subject did or lived through belongs to their memories, not to what they know
            // about the world: a character never learns their own deeds.
            if (change.kind === 'knowledge' && (aboutId === ownerId || method === 'participant')) {
                if (isKnownMemory(ownerId, change.value) || !acceptsMemory(ownerId, change.evidence)) continue;
                memoriesOf(ownerId).push(comparableText(change.value));
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
            const update = resolveRelationshipUpdate(current, { title, value: change.score, description: change.sourcePerspective });
            if (!update) continue;
            operations.push({
                type: 'relationship',
                sourceEntityId: ownerId,
                targetEntityId: targetId,
                dimension: change.key || 'overall',
                ...update,
            });
        }
        if (operations.length) operationsByOwner.set(ownerId, operations);
    }
    if (!operationsByOwner.size) return null;
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
    return records.length ? { record: records[0], records } : null;
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
        SELECT id, text, source, ownerId, ownerType, ordinal, createdAt, COALESCE(content_hash, '') AS contentHash
        FROM knowledge_chunks
        WHERE ownerId = ? AND ownerType IN ('chat_kb', 'chat_memory') AND enabled = 1
        ORDER BY createdAt ASC
    `).all(workspaceId).map(chunk => ({ ...chunk, evidenceSource: 'Memory' }));
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
    const existingMemories = db.prepare(`
        SELECT payload_json FROM narrative_records
        WHERE workspace_id = ? AND record_type = 'memory' AND subject_id = ?
        ORDER BY applied_at DESC
        LIMIT 40
    `);
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
          ai_access AS aiAccess, ai_guidance AS aiGuidance
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

    let updated = 0, staged = 0, upToDate = 0, noEvidence = 0, failed = 0;
    let canonicalSuggestionCount = 0, narrativeSuggestionCount = 0, skillSuggestionCount = 0;
    let evidenceUsed = 0, taggedEvidenceRemaining = 0, textMatchesDeferred = 0;
    let emptyFieldsExamined = 0, emptyFieldSuggestions = 0;
    let emptyFieldsWithoutSupport = 0, emptyFieldsAwaitingEvidence = 0;
    let consecutiveStructuredFailures = 0;
    let processedEntities = 0;
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
        if (!candidates.size) {
            noEvidence++;
            updateState.updateJob(runId, ent.id, { status: 'skipped' });
            continue;
        }
        const allowed = enrichFieldsForEntity(ent);
        const customDefinitions = customFieldDefinitions.all(workspaceId, ent.type).map(row => ({
            ...row,
            options: row.optionsJson ? JSON.parse(row.optionsJson) : [],
            constraints: row.constraintsJson ? JSON.parse(row.constraintsJson) : {}
        }));
        const visibleCustomFields = customDefinitions.filter(field => field.aiAccess !== 'hidden');
        const writableCustomFields = visibleCustomFields.filter(field => field.aiAccess === 'read-write');
        const { emptyFields: emptyWritableFields, signature: fieldCoverageSignature } =
            buildFieldCoverage(ent, allowed, writableCustomFields);
        const discoveredEntries = [...candidates.values()].map(chunk => ({
            chunk,
            signature: entityEnrichmentSignature(chunk, fieldCoverageSignature),
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
            `- customFields.${field.key} [${emptyWritableFields.includes(`customFields.${field.key}`) ? 'EMPTY' : 'CURRENT VALUE PRESENT'}]: ${customFieldPromptShape(field)}. ${field.aiGuidance || `Use this field only for the meaning expressed by “${field.label}”.`}`
        );
        const fieldLines = [...nativeFieldLines, ...customFieldLines].join('\n');
        const relSpecs = enrichRelationsForEntity(ent);
        const fence = buildItemsFence();
        const currentData = {};
        for (const f of allowed) if (ent.data && ent.data[f] != null) currentData[f] = ent.data[f];
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
        const evidenceExample = `E_${evidencePrefix}_1`;
        const runChunkIds = new Set(chunks.map(chunk => chunk.id));
        const evidenceEntries = chunks.map((chunk, index) => {
            const lead = precedingPassageText(precedingChunk, chunk, runChunkIds);
            return {
                id: `E_${evidencePrefix}_${index + 1}`,
                order: index,
                chunk,
                prompt: `[E_${evidencePrefix}_${index + 1} | ${chunk.evidenceSource}: ${chunk.source || 'Untitled'} | ${chunk.isTagged ? 'indexed entity match' : 'name or alias match'} | chunk ${chunk.id}]\n` +
                    (lead ? `(Preceding passage of the same source, context only and never evidence: ${lead})\n` : '') +
                    chunk.text
            };
        });
        const includedEvidence = selectEntityEvidence(evidenceEntries);
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
        for (const spec of relSpecs) {
            const existing = existingLinksByTarget(ent.id, spec);
            const candidates = relationCandidates(all, ent, spec).filter(candidate =>
                existing.has(candidate.id)
                || relatedIds.has(candidate.id)
                || textMentionsEntity(evidenceWindow, entityMentionNames(candidate))
            );
            const names = candidates.map(candidate => candidate.canonicalName);
            if (!names.length) continue;
            const operation = spec.detailed
                ? `kind "relationship", key "overall", target one candidate, targetRole what TARGET is to SOURCE, score -100 to 100, sourcePerspective how SOURCE sees TARGET`
                : `kind "link", key "${spec.key}", target one candidate${spec.labeled ? ', targetRole what TARGET is to SOURCE' : ''}`;
            const guidance = ENRICH_RELATION_GUIDANCE[`${ent.type}.${spec.key}`] || 'Only when the exact relation is explicitly established.';
            relBlocks.push({ spec, names, line: `- ${spec.label}: ${operation}. ${guidance} Candidates: ${names.join(', ')}` });
            for (const link of existing.values()) {
                currentLinks.push({
                    field: spec.key,
                    source: ent.canonicalName,
                    target: link.entity.canonicalName,
                    ...(link.label ? { targetRole: link.label } : {}),
                    ...(spec.detailed ? { value: Number(link.metadata?.value || 0), sourcePerspective: String(link.metadata?.description || '') } : {})
                });
            }
        }
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
        const narrativeEntities = all
            .filter(candidate => candidate.status !== 'proposed' && (
                candidate.id === ent.id
                || relatedIds.has(candidate.id)
                || textMentionsEntity(evidenceWindow, entityMentionNames(candidate))
            ))
            .slice(0, 60);
        const narrativeEntityContext = narrativeEntities
            .map(candidate => `- ${candidate.canonicalName}: ${candidate.id}`)
            .join('\n');
        // Others' relationships with people in these passages, so an update edits them instead of starting over.
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
                `kind "skill": key is the exact skill name, value the rank name the evidence shows, target the parent skill name for a new sub-skill or "", sourcePerspective a one-sentence meaning only for a new skill. You may ${skillOperations.join('; ')}. ` +
                `Never lower a rank. Use the closest catalog skill before creating one.` +
                (skillContext.config.guidance?.trim() ? `\nWorld rule for skills: ${skillContext.config.guidance.trim()}` : '') + '\n'
            : '';
        const knownMemories = ['Characters', 'Creatures'].includes(ent.type) ? memorySummaries(existingMemories, workspaceId, ent.id).slice(0, 10) : [];
        const responseShape = `{"changes":[{"kind":"field","key":"<allowed field key>","value":"<JSON encoded value>","subjectId":"","targetId":"","perspectiveOwnerId":"","target":"","targetRole":"","sourcePerspective":"","score":0,"method":"","accessibility":"","support":"<direct support>","evidence":["${evidenceExample}"]}]}`;
        const kinds = ['field', 'link', ...(allowLore ? ['history'] : []), ...(skillContext ? ['skill'] : []), 'fact', 'awareness', 'knowledge', 'belief', 'memory', 'relationship'];
        const systemPrompt =
            getSystemLanguageInstruction() + "\n" +
            `You maintain a story's world bible. Update the record for one ${ent.type.replace(/s$/, '')} named "${ent.canonicalName}" ` +
            `using the CURRENT RECORD plus ONLY the NEW STORY EVIDENCE provided. Extract supported changes and narrative findings; lore is composed in a separate step from your history findings.\n` +
            `Return one valid JSON object and nothing else. Use {"changes":[]} when nothing should change. Every change uses this fixed shape:\n${responseShape}\n` +
            `All keys are required. Use an empty string or 0 for fields that do not apply. Encode field values as JSON inside value: plain text remains plain text, numbers use "12", booleans use "true", and lists use "[\\"one\\",\\"two\\"]". ` +
            `Kinds: ${kinds.join(', ')}. Never output angle-bracket placeholders.\n` +
            `ENTITY TYPE CONTRACT:\n${ENRICH_TYPE_GUIDANCE[ent.type] || 'A persistent canonical world entity.'}\n` +
            (fieldLines ? `Allowed data fields:\n${fieldLines}\n` : '') +
            (allowLore ? `kind "history": value is one durable statement for the lore (origin, role, title, trajectory, or an event that changed this entity), written as a full sentence. Never appearance, temperament${skillContext ? ', abilities' : ''}, a passing scene detail, or a general trait of its race, people, or culture.\n` : '') +
            skillLines +
            (relBlocks.length ? `Allowed links (use the exact candidate names, never invent a name):\n${relBlocks.map(b => b.line).join('\n')}\n` : '') +
            `STRICT RULES:\n` +
            `- Return a change ONLY when the passages state it explicitly and unambiguously. Inference, implication, symbolism, genre convention, probability, and interpretation are not explicit: omit them. Returning few or no changes is correct and expected.\n` +
            `- Never return a change to say that something is absent, unknown, or not established; omit it instead.\n` +
            `- Every change must cite one or more supplied evidence IDs that support that exact change. support restates what the evidence says; never speculate about why a current value differs.\n` +
            `- A preceding passage shown before an evidence block only tells whose section or scene the block belongs to. Use it to decide who a line is about; never cite it.\n` +
            (playerEntity && playerEntity.id !== ent.id ? `- In roleplay logs, "you" and "your" refer to the player character ${playerEntity.canonicalName} (id ${playerEntity.id}).\n` : '') +
            (playerEntity && playerEntity.id === ent.id ? `- In roleplay logs, "you" and "your" refer to ${ent.canonicalName}, the player character.\n` : '') +
            `- Do not return unchanged fields or unchanged links. An empty changes array is correct when the new evidence changes nothing.\n` +
            `- Existing values are canonical context, not protected blanks. When new explicit evidence changes an existing value, return the full replacement: keep every part of the current value that is still true and change only what the evidence changes. Never replace a value merely to rephrase it, and never shorten it to one scene.\n` +
            `- EMPTY fields: fill one only when the evidence describes a durable trait for it. A single reaction, gesture, or action in one scene does not fill appearance or personality.\n` +
            `- Never infer, estimate, or compute a value. Numeric fields require the explicit resulting absolute value. A delta such as "+1", "-2", "gained 1", or "increased by 2" is not a field value unless the evidence also states the resulting total. Never replace a newer canonical number with an older progression value.\n` +
            `- Persistent fields contain durable canonical characteristics. Do not place a temporary pose, scene location, passing emotion, current lighting, momentary clothing, or short-lived injury into appearance, personality, disposition, description, or another lasting field.\n` +
            `- Only link two entities when the text directly establishes that exact relation. A name, title, accent, or appearance in a scene does not establish origin, residence, or membership. Only nest a location inside another when the passages explicitly say one place is physically within the other.\n` +
            `- RELATIONSHIP DIRECTION: SOURCE is always the current record (${ent.canonicalName}); TARGET is the named related entity. targetRole must state what TARGET is to SOURCE (Dorian to Tess: targetRole "Daughter"; Tess to Dorian: targetRole "Father"). value and sourcePerspective describe only how SOURCE feels about and relates to TARGET. Never return TARGET's feelings toward SOURCE. The reciprocal direction belongs exclusively to TARGET's own record.\n` +
            `- Return a relationship only when the evidence shows SOURCE's own attitude, bond, or role toward TARGET. Fighting, meeting, or sharing a scene once is not a relationship. targetRole is a complete short role of one to four words, never a sentence.\n` +
            `- An existing relationship (in Current links and relationships or EXISTING RELATIONSHIPS OF OTHERS) is edited, not rewritten: return its targetRole exactly as it is unless the bond itself changed in kind, such as an ally becoming an enemy; write sourcePerspective as the current perspective carried forward with only what the evidence changes; move score from its current value by what the evidence shows.\n` +
            `- Every narrative change must state ownership explicitly. subjectId is the entity whose mind, memory, knowledge, belief, fact, or perspective owns the change. perspectiveOwnerId must equal subjectId for relationships. targetId is the existing entity the statement or relationship is about. Use the IDs from the candidate context, never infer ownership from the current record.\n` +
            `- Awareness requires evidence that the perspective owner knows the target exists. Documentary extraction alone never grants it.\n` +
            `- For knowledge, belief, and memory, put the statement or summary in value. For knowledge and belief, target must be the exact existing entity the proposition is primarily about, not a location, group, or concept merely mentioned in the sentence.\n` +
            `- MEMORY is what subjectId did, lived through, decided, or took part in, told as a past event with who was involved (targetId: the main other entity involved, or ""). Anything the subject did or experienced is a memory, never knowledge. Do not record a memory that only restates a current trait or one already listed under EXISTING MEMORIES.\n` +
            `- A memory belongs only to someone present in the scene, or who perceived it directly. Never give a memory of a conversation or event to someone who was absent, even when it is about them.\n` +
            `- A memory is a moment that matters to its owner: a bond formed or broken, a decision, a revelation, a victory, a loss, a turning point. Never record logistics or routine: walking somewhere, leaving, checking for danger, handing over paperwork, waiting.\n` +
            `- At most one memory per scene for each owner: tell what mattered in that scene in a single memory instead of splitting it into steps.\n` +
            `- KNOWLEDGE is a fact about someone or something else that subjectId learned inside the story by witnessing it or being told (method "witness" or "reported"). The update model inferring something while reading a document is never character Knowledge. Biography, public canon, self-description, predictions, private information unavailable to the subject, and documentary analysis are not new Knowledge. Never use method "inferred" for Knowledge.\n` +
            `- BELIEF is something subjectId explicitly holds true in the story. It is never your own reading of their motives or psychology.\n` +
            (ent.type === 'Characters'
                ? `- Never return fact for a Character update. Global canonical Facts belong to the workspace Fact registry, not to a character sheet.\n`
                : `- Use fact for an explicit canonical proposition. Put a concise predicate in key, the proposition in value, and its existing subject name in target.\n`) +
            `- CANONICAL SYSTEM / CONCEPT CONTEXT defines setting-specific terms. Use it to interpret evidence, but do not copy a concept's facts into this entity unless the evidence explicitly connects them. The same holds for a passage about a race, people, or culture in general: it describes the group, not this entity.\n` +
            `- Text between || and || in the current record is a spoiler: true, but hidden from the person reading the sheet. A new value for a field that holds one must keep each span exactly, markers included, and must never restate it outside them. Write a new fact that would spoil a surprise inside new || markers on a single line.\n` +
            `Do not invent facts, names, or fields absent from the passages.`;
        const userPromptPrefix =
            `${allowLore ? 'CURRENT RECORD' : 'CURRENT CONCEPT'}:\nName: ${ent.canonicalName}\nAliases: ${ent.aliases?.join(', ') || '(none)'}\n` +
            (ent.type === 'Items' ? `Item nature: ${(ent.data?.itemNature || 'type') === 'unique' ? 'unique item (one persistent object; may have one owner or current location)' : 'item type (repeatable category; may have abundance and availability locations, never one fixed owner or current location)'}\n` : '') +
            (allowLore ? `Lore: ${ent.lore ? ent.lore : '(no lore yet)'}\n` : '') +
            (Object.keys(currentData).length ? `Current fields: ${JSON.stringify(currentData)}\n` : '') +
            (Object.keys(currentCustomFields).length ? `Current custom fields (read-only fields are context and must never be proposed): ${JSON.stringify(currentCustomFields)}\n` : '') +
            (currentLinks.length ? `Current links and relationships: ${JSON.stringify(currentLinks)}\n` : '') +
            (otherRelationships.length ? `EXISTING RELATIONSHIPS OF OTHERS (how each one already sees the other):\n${otherRelationships.join('\n')}\n` : '') +
            (knownMemories.length ? `EXISTING MEMORIES (already recorded, never repeat): ${knownMemories.map(summary => `«${summary.slice(0, 110)}»`).join(' ')}\n` : '') +
            (narrativeEntityContext ? `\nENTITY IDS FOR NARRATIVE FINDINGS:\n${narrativeEntityContext}\n` : '') +
            (systemContext ? `\nCANONICAL SYSTEM / CONCEPT CONTEXT:\n${systemContext}\n` : '');
        const buildUserPrompt = evidence => `${userPromptPrefix}\nNEW STORY EVIDENCE (chronological):\n${evidence}`;

        try {
            const maxTokens = entityEnrichmentMaxTokens(ent);
            const jsonSchema = buildEntityUpdateSchema();
            let inputTokenEstimate = 0;
            let outputTokenEstimate = 0;
            let retryCount = 0;
            const sendJsonRequest = async (requestParams, schema = jsonSchema) => {
                // Worldbuild text is rewritten here, so its spoiler markers must reach the model and come back.
                const params = { maxPayloadTokens: workspacePayloadTokens(workspaceId), keepSpoilerMarkers: true, ...requestParams };
                const estimatedInput = estimateTokens(`${params.systemPrompt || ''}\n${params.newPrompt || ''}\n${JSON.stringify(schema || {})}`);
                try {
                    const result = await sendApiRequest({ ...params, jsonMode: true, jsonSchema: schema, includeResponseMetadata: true });
                    inputTokenEstimate += result.inputTokens || estimatedInput;
                    outputTokenEstimate += result.outputTokens || estimateTokens(result.content);
                    return result;
                } catch (error) {
                    if (!/response.?format|json.?mode|structured output|output_config.*(unsupported|not supported)|compiled grammar.*too large|tool schemas?.*too large|reduce the number of strict tools/i.test(String(error.message || ''))) throw error;
                    console.warn(`[Enrich] Structured output unavailable for ${ent.canonicalName}; retrying with prompt validation:`, error.message);
                    retryCount++;
                    const result = await sendApiRequest({ ...params, jsonMode: false, jsonSchema: null, includeResponseMetadata: true });
                    inputTokenEstimate += result.inputTokens || estimateTokens(`${params.systemPrompt || ''}\n${params.newPrompt || ''}`);
                    outputTokenEstimate += result.outputTokens || estimateTokens(result.content);
                    return result;
                }
            };
            const requestUpdate = (prompt, tokenBudget = maxTokens) => sendJsonRequest({
                apiProfileId,
                model,
                systemPrompt,
                chatHistory: [],
                newPrompt: prompt,
                temperature: 0.1,
                maxTokens: tokenBudget,
                manualMode,
                manualJson
            });
            const repairUpdate = (invalidResponse, tokenBudget = maxTokens) => sendJsonRequest({
                apiProfileId,
                model,
                systemPrompt: `${systemPrompt}\nREPAIR TASK: Correct only the JSON syntax and required shape of the supplied response. Preserve its proposed values, evidence IDs, SOURCE, and TARGET direction. Return only the corrected JSON object.`,
                chatHistory: [],
                newPrompt: `INVALID RESPONSE TO REPAIR:\n${String(invalidResponse || '').slice(0, 12000)}`,
                temperature: 0,
                maxTokens: tokenBudget,
                manualMode,
                manualJson
            });
            updateState.transition(workspaceId, ent.id, includedEvidence, 'queued', runId);
            const deferredEvidence = evidenceEntries.filter(entry => !includedIds.has(entry.id));
            updateState.transition(workspaceId, ent.id, deferredEvidence, 'deferred', runId, 'token-budget');
            let responseResult = await requestUpdate(buildUserPrompt(evidenceWindow));
            let response = responseResult.content;
            let head = splitHeadAndBody(response, fence);
            let parsed = parseEntityUpdateObject(head.body).value || parseEntityUpdateObject(response).value;
            if (!isEntityUpdateShape(parsed)) {
                const firstFailure = describeEntityUpdateFailure(responseResult, parsed, fence);
                logEntityUpdateFailure(ent, 'first attempt', firstFailure, responseResult);
                const retryTokens = entityUpdateRetryTokens(firstFailure.cause, maxTokens);
                retryCount++;
                // Both mean no room was left to write: less evidence and a larger allowance is the only
                // retry that helps. Anything else is a formatting fault for the repair pass.
                if (firstFailure.cause === 'budget' || firstFailure.cause === 'empty') {
                    const reducedEvidence = selectEntityEvidence(evidenceEntries, 2500).map(entry => entry.prompt).join('\n\n');
                    responseResult = await requestUpdate(buildUserPrompt(reducedEvidence), retryTokens);
                } else {
                    responseResult = await repairUpdate(response, retryTokens);
                }
                response = responseResult.content;
                head = splitHeadAndBody(response, fence);
                parsed = parseEntityUpdateObject(head.body).value || parseEntityUpdateObject(response).value;
                if (!isEntityUpdateShape(parsed)) {
                    failed++;
                    consecutiveStructuredFailures++;
                    const retryFailure = describeEntityUpdateFailure(responseResult, parsed, fence);
                    logEntityUpdateFailure(ent, 'retry', retryFailure, responseResult);
                    const finish = responseResult.finishReason ? ` Finish reason: ${responseResult.finishReason}.` : '';
                    rememberFailure(ent, `${retryFailure.message} Automatic retry also failed.${finish} Response length: ${String(response || '').length}. First response: ${firstFailure.message}`);
                    updateState.transition(workspaceId, ent.id, includedEvidence, 'deferred', runId, 'invalid-structured-output');
                    updateState.updateJob(runId, ent.id, {
                        status: 'failed',
                        input_tokens: inputTokenEstimate,
                        output_tokens: outputTokenEstimate,
                        retry_count: retryCount,
                        evidence_used: includedEvidence.length,
                        error: retryFailure.message,
                    });
                    continue;
                }
            }
            consecutiveStructuredFailures = 0;
            parsed = decodeEntityUpdate(parsed);

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
            const narrativeChanges = [...parsed.narrative, ...relationshipLinkChanges].filter(change =>
                !(ent.type === 'Characters' && change.kind === 'fact')
                && change.support
                && change.evidence.some(id => validEvidenceIds.has(id))
                && !isEmptyRelationship(change)
            );

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
                    const targetId = resolveRelationTarget(name, spec, workspaceId);
                    if (!targetId || targetId === ent.id) continue;
                    // A name shared by a specific being and a species must land on the shape asked for.
                    if (spec.targetScope && !relationCandidates(all, ent, spec).some(candidate => candidate.id === targetId)) continue;
                    const existingLink = existing.get(targetId);
                    if (existingLink) continue;
                    const dedupe = `${targetId}:${label || ''}`;
                    if (seen.has(dedupe)) continue;
                    seen.add(dedupe);
                    proposedLinks.push({ relKey: spec.key, relLabel: spec.label, relType: spec.relType, from: spec.from, single: !!spec.single, label, metadata: undefined, existingLinkId: undefined, targetId, targetName: name, evidence, support });
                    if (spec.single) break; // one target for single-valued relations
                }
            }

            const historyFindings = (parsed.history || []).filter(finding => finding.support && finding.evidence.some(id => validEvidenceIds.has(id)));
            let loreProposal = null;
            let loreFailure = null;
            // Lore is moved by history. A new link alone only starts a lore that does not exist yet.
            if (allowLore && (historyFindings.length || (!String(ent.lore || '').trim() && proposedLinks.length))) {
                const canonicalFindings = [
                    ...historyFindings,
                    ...proposedLinks.map(link => ({ kind: 'link', key: link.relKey, target: link.targetName, ...(link.label ? { targetRole: link.label } : {}), support: link.support, evidence: link.evidence })),
                    ...narrativeChanges.filter(change => change.kind === 'fact'),
                ];
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
                        const loreSystemPrompt = `${getSystemLanguageInstruction()}\n${appendLore
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

            const narrativeSuggestion = submitEntityNarrativeSuggestions({
                workspaceId,
                entity: ent,
                changes: narrativeChanges,
                allEntities: all,
                evidenceEntries: includedEvidence,
                interpreterId: `${apiProfileId}:${model}`,
            });
            const hasCanonicalChange = Object.keys(proposedData).length || loreChanged || proposedLinks.length;
            const hasChange = hasCanonicalChange || narrativeSuggestion?.record || skillChanges.length;
            evidenceUsed += includedEvidence.length;
            taggedEvidenceRemaining += pendingTaggedEvidence.length;
            textMatchesDeferred += skippedTextualEvidence.length;
            const canonicalProposalCount = Object.keys(proposedData).length
                + proposedLinks.length
                + (loreChanged ? 1 : 0);
            const narrativeProposalCount = (narrativeSuggestion?.records || [])
                .reduce((total, record) => total + (record?.proposal?.changeSet?.operations?.length || 0), 0);
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
                updateState.transition(workspaceId, ent.id, includedEvidence, actionable ? 'actionable' : 'non-actionable', runId, actionable ? 'proposals-created' : 'no-supported-change');
                updateState.updateJob(runId, ent.id, {
                    status: 'completed',
                    input_tokens: inputTokenEstimate,
                    output_tokens: outputTokenEstimate,
                    retry_count: retryCount,
                    evidence_used: includedEvidence.length,
                    proposals_created: proposalCount,
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
                staged++;
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
                entitiesStore.updateEntity(ent.id, fields);
                for (const l of proposedLinks) applyProposedLink(ent.id, l, workspaceId);
                updated++;
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
                staged++;
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
    const runStatus = stoppedEarly || cancelled || failed ? (processedEntities > failed ? 'partial' : 'failed') : 'completed';
    const tokenUsage = updateState.finishRun(runId, runStatus);
    return {
        runId, entities: targets.length, processedEntities, updated, staged, upToDate, noEvidence,
        failed, failures, evidenceUsed, taggedEvidenceRemaining, textMatchesDeferred,
        canonicalSuggestionCount, narrativeSuggestionCount, skillSuggestionCount, emptyFieldsExamined,
        emptyFieldSuggestions, emptyFieldsWithoutSupport, emptyFieldsAwaitingEvidence,
        stoppedEarly, cancelled, remaining: targets.length - processedEntities, tokenUsage
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
    let awarenessOverview = '';
    if (isRoleplay) {
        try {
            const { AgenticEpistemicTools } = require('../../dist-main/main/features/narrative/agentic-epistemic-tools');
            epistemicTools = new AgenticEpistemicTools(db);
            awarenessOverview = epistemicTools.scanSceneAwareness(chatId, currentInput);
        } catch (error) {
            console.warn('[Agentic RAG] Awareness scan unavailable:', error.message);
        }
    }
    const offeredTools = toolNamesFor({ roleplay: isRoleplay });

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
${isRoleplay ? `- PERSPECTIVE: lookup_entity returns what the narrator knows. Use inspect_subject_knowledge for what one character knows about another.
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
            try { dossierCalendar = require('./features/worldbuild/calendar-service').getCalendar(db, chatId); } catch (e) { }
            try {
                for (const eid of entityIds) {
                    const ent = entitiesStore.getEntity(eid);
                    if (!ent) continue;
                    const links = entitiesStore.getLinksFrom(eid) || [];
                    if (links.length) {
                        const edges = links.map(l => `${l.label || l.relType} → ${l.entity ? l.entity.canonicalName : '?'}${edgeDetail(l, dossierCalendar)}`).join('; ');
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
        if (includeChatContext && call.name !== 'expand' && !EPISTEMIC_TOOLS[call.name] && call.name !== 'explore_worldbuild_options') {
            retrievalLedger.recordQuery(chatId, { key, tool: call.name, query: call.arg, hits });
        }
        return { tool: call.name, arg: call.arg, hits, status: 'ran' };
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
            promptCache: { policy: 'transcript', ...(currentTurn >= maxTurns ? { final: true } : {}) }
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
        degraded: loopDegraded,
        trajectory,
        trace: trajectory.turns.map(({ newIds, ...turn }) => turn),
        stopReason,
        selection: selection.funnel
    };
}

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
    getSystemAiConfiguration,
    deferNarrativeStateTurn,
    reprocessNarrativeStateTurn
};
