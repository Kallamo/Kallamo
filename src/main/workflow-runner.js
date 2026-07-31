const db = require('./database');
const entitiesStore = require('./entities');
const { sendApiRequest } = require('./features/llm/llm.service');
const { sendApiRequestStream } = require('./features/llm/llm.stream');
const { resolveWorkspaceGenerationTarget } = require('./features/chat/generation-target');
const {
    filterWorkspaceKnowledgeResults,
    filterWorkspaceMemoryResults,
    isAvailableToProfile,
    isSearchable
} = require('./features/chat/workspace-context-scope');
const { ROLE_IDS, readAdvancedSettings, resolveAiEngineRole } = require('./features/ai-engine/role-resolver');
const { stripLeadingStoryEvidenceMarkers } = require('./features/kanora/roleplay-history');
const { parseEntityUpdateObject } = require('./features/worldbuild/entity-update-json');
const {
    buildEstimatedUsage,
    createMessageDiagnostics,
    mergeNarrativeStateDiagnostics
} = require('./features/ai-engine/message-diagnostics');
const {
    selectRetrievedEntries
} = require('./features/ai-engine/retrieval-selection');
const { normalizeDirectionalRelationship, normalizeRelationshipLabel, validateNarrativeChange } = require('./features/worldbuild/entity-review');
const {
    filterUpdateFields,
    filterUpdateRelations,
    buildFieldCoverage,
    isUnsupportedNumericDelta,
} = require('./features/worldbuild/entity-update-contract');
const { buildEntityUpdateSchema, buildEntityLoreSchema } = require('./features/worldbuild/entity-update-schema');
const { decodeEntityUpdate, isEntityUpdateShape } = require('./features/worldbuild/entity-update-protocol');
const { buildLorePrompt, validateEntityLore } = require('./features/worldbuild/entity-lore');
const { buildNarrativeOptionPalette } = require('./features/worldbuild/narrative-options');
const { createEntityUpdateState } = require('./features/worldbuild/entity-update-state');
const { shouldStopEntityUpdates } = require('./features/worldbuild/entity-update-resilience');
const { NARRATIVE_TRIAGE_SCHEMA, NARRATIVE_STATE_SCHEMA } = require('./features/kanora/narrative-state-schema');
const {
    compactNarrativeManifest,
    extractNarrativeSignals,
    groupKnowledgeCardRows,
    hasEpistemicDomain,
    resolveNarrativeRouting
} = require('./features/kanora/narrative-state-routing');
const { parseTaggerResponse, createTaggerBatches, proposalDataForMention } = require('./features/world-index/tagger-response');
const {
    PAYLOAD_BUDGET_CONTRACT,
    assertPayloadWithinLimit,
    getAvailableHistoryTokens,
    normalizeMaxApiPayload
} = require('./features/llm/payload-budget');
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
    getWorldVocabulary,
    lookupEntityChunks,
    executeMultiOwnerSearch,
    extractTextFromFile,
    chunkText,
    vectorizeChunks,
    insertChunksToDb
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

function sendRunEvent(webContents, channel, run, payload) {
    if (!webContents || run?.isCancelled) return;
    webContents.send(channel, {
        ...payload,
        chatId: run?.chatId ?? payload.chatId,
        runId: run?.id ?? payload.runId
    });
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

// --- TOKEN UTILITIES ---

function estimateTokens(str) {
    if (!str) return 0;
    try {
        return encode(str).length;
    } catch (e) {
        return Math.ceil(str.length / 4);
    }
}

// Format history messages into standard list, respecting max context tokens
function formatActiveHistory(messages, maxTokensAllowed) {
    let tokensUsed = 0;
    const history = [];

    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        let content = stripLeadingStoryEvidenceMarkers(msg.content);

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

        const msgTokens = estimateTokens(content) + PAYLOAD_BUDGET_CONTRACT.messageOverheadTokens;
        if (tokensUsed + msgTokens <= maxTokensAllowed) {
            history.unshift({ role: msg.role, content: content });
            tokensUsed += msgTokens;
        } else {
            break;
        }
    }
    return history;
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

// Orchestrate workflow linear chain execution
async function runWorkflow({ chatId, messageContent, targetId, attachedFiles, webContents }) {
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
            isWorkflow: false
        });
        return { success: false, error: error.message, errorCode: error.code };
    }
    if (activeRun) {
        activeRun.isCancelled = true;
        if (activeRun.controller) {
            activeRun.controller.abort();
        }
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
            if (userMsg && updatedAttachedFiles.length > 0) {
                db.prepare('UPDATE messages SET attachedFiles = ? WHERE id = ?').run(JSON.stringify(updatedAttachedFiles), userMsg.id);
            }
        } catch (e) {
            console.error("Error updating user message attachedFiles:", e);
        }

        const maxContextTokens = normalizeMaxApiPayload(chat?.maxContext);
        const summarizedIndex = chat ? (chat.summarizedIndex || 0) : 0;

        const messages = db.prepare('SELECT * FROM messages WHERE chatId = ? ORDER BY createdAt ASC').all(chatId);
        const activeMessages = messages.slice(summarizedIndex);

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
        let totalProfileKbTokens = 0;
        let totalChatKbTokens = 0;
        let totalChatHistoryTokens = 0;
        let totalSystemInstructionTokens = 0;
        let totalNarrativeContextTokens = 0;
        let totalUserInputTokens = 0;
        let totalMainInputTokens = 0;
        let totalAgenticInputTokens = 0;
        let totalAgenticOutputTokens = 0;
        let totalOutputTokens = 0;

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
            let compiledSystemPrompt = profile.systemPrompt || '';
            let isRoleplayWorkspace = false;
            try {
                const { getWorkspaceExperienceMode } = require('../../dist-main/main/features/kanora/mode-orchestration');
                isRoleplayWorkspace = getWorkspaceExperienceMode(db, chatId) === 'roleplay';
                if (isRoleplayWorkspace) {
                    const { getRoleplayGenerationPolicy } = require('../../dist-main/main/features/kanora/roleplay-generation-policy');
                    const generationPolicy = getRoleplayGenerationPolicy();
                    const { buildRoleplayTemporalContext } = require('./features/worldbuild/calendar-service');
                    compiledSystemPrompt += `\n\n${generationPolicy}\n\n${buildRoleplayTemporalContext(db, chatId)}`;
                    generationPolicyId = `sha256:${crypto.createHash('sha256').update(generationPolicy).digest('hex').slice(0, 16)}`;
                }
            } catch (error) {
                console.warn('[Roleplay Context] Could not load the narration policy:', error.message);
            }
            if (step.prompt) {
                compiledSystemPrompt += `\n\nAdditional Instruction: ${step.prompt}`;
            }
            const systemInstructionsTokens = estimateTokens(compiledSystemPrompt);

            let constantKnowledge = '';
            let searchableChunks = [];
            let searchableResults = [];
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
                const constantLabel = isRoleplayWorkspace
                    ? 'NARRATOR REFERENCE: CONSTANT CONTEXT'
                    : 'CONSTANT CONTEXT SYSTEM BACKGROUND';
                contextBlock += `\n\n--- ${constantLabel} ---\n${constantKnowledge}\n`;
            }

            const attachmentsPayloadContext = attachmentsContext
                ? `\n\n--- ATTACHED FILES FOR CURRENT MESSAGE ---\n${attachmentsContext}\n`
                : '';
            assertPayloadWithinLimit({
                maxPayloadTokens: maxContextTokens,
                systemPrompt: compiledSystemPrompt + contextBlock + attachmentsPayloadContext,
                newPrompt: currentInput,
                attachedImageCount: i === 0 ? attachedImages.length : 0,
                outputTokens: profile.maxTokens ?? 1000
            });

            const retrievalPlanner = getRoleExecutor(ROLE_IDS.RETRIEVAL_PLANNER, profile);
            const planWorkspaceContext = shouldPlanWorkspaceContext(chatId, includeChatContext);
            if (profile.isAgentic === 1 && retrievalPlanner.executor) {
                retrievalMode = 'agentic';
                const initialRemainingTokens = getAvailableHistoryTokens({
                    maxPayloadTokens: maxContextTokens,
                    systemPrompt: compiledSystemPrompt + contextBlock,
                    newPrompt: currentInput,
                    attachedImageCount: i === 0 ? attachedImages.length : 0,
                    outputTokens: 4000
                });
                const ragActiveMessages = activeMessages.slice(-10);

                let ragChatHistory = [];
                if (i === 0 || includeChatHistory) {
                    ragChatHistory = formatActiveHistory(ragActiveMessages, initialRemainingTokens);
                }

                const agenticResult = await executeAgenticRagLoop(
                    profile,
                    chatId,
                    currentInput,
                    ragChatHistory,
                    webContents,
                    includeChatContext,
                    retrievalPlanner.executor,
                    maxContextTokens,
                    currentRun
                );
                if (agenticResult) {
                    // If detailed research context was gathered, include only it (prevents duplicate token recitation).
                    // If NOTHING was retrieved, do NOT pass the agent's 1-sentence summary off as facts, emit an
                    // explicit notice so the main AI knows retrieval ran and found nothing, instead of hallucinating
                    // document-based facts (fail-loud degradation).
                    const noContextNotice = `--- RAG NOTICE ---\nNo relevant context was retrieved from the knowledge base or memory for this request. Answer using only the conversation and the user's instructions; do not fabricate document-based facts.`;
                    const externalPayloadContext = agenticResult.externalContextGathered
                        ? `\n\n--- DETAILED RESEARCH CONTEXT ---\n${agenticResult.externalContextGathered}\n`
                        : '';
                    const kanoraBudget = getAvailableHistoryTokens({
                        maxPayloadTokens: maxContextTokens,
                        systemPrompt: compiledSystemPrompt + contextBlock + externalPayloadContext + attachmentsPayloadContext,
                        newPrompt: currentInput,
                        attachedImageCount: i === 0 ? attachedImages.length : 0,
                        outputTokens: profile.maxTokens ?? 1000
                    });
                    const planned = planWorkspaceContext
                        ? planKanoraContext({
                            chatId,
                            query: currentInput,
                            items: agenticResult.kanoraItems,
                            tokenBudget: kanoraBudget
                        })
                        : null;
                    if (planned?.manifest?.requestId) narrativeContextRequestId = planned.manifest.requestId;
                    contextBundleDiagnostic = serializeContextBundle(planned);
                    const approvedContext = [agenticResult.externalContextGathered, planned?.context]
                        .filter(Boolean)
                        .join('\n\n');
                    const approvedChatTokens = planned?.plan.package.usedTokens || 0;
                    const combinedContext = approvedContext
                        ? `--- DETAILED RESEARCH CONTEXT ---\n${approvedContext}`
                        : noContextNotice;
                    contextBlock += `\n\n${combinedContext}\n`;

                    let agenticResponseTokens = 0;
                    if (!approvedContext) {
                        agenticResponseTokens = estimateTokens(noContextNotice);
                    }
                    const hasProfileTokens = (agenticResult.profileKbTokens || 0) > 0;
                    const hasChatTokens = approvedChatTokens > 0;

                    if (hasProfileTokens && hasChatTokens) {
                        const half = Math.ceil(agenticResponseTokens / 2);
                        profileKbTokens += (agenticResult.profileKbTokens || 0) + half;
                        chatKbTokens += approvedChatTokens + (agenticResponseTokens - half);
                    } else if (hasChatTokens) {
                        profileKbTokens += (agenticResult.profileKbTokens || 0);
                        chatKbTokens += approvedChatTokens + agenticResponseTokens;
                    } else {
                        profileKbTokens += (agenticResult.profileKbTokens || 0) + agenticResponseTokens;
                        chatKbTokens += approvedChatTokens;
                    }

                    agenticRagResponse = agenticResult.agenticResponse;
                    agenticRagContextGathered = [
                        approvedContext,
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
                let chatKbChunks = [];
                let chatMemories = [];
                let searchQuery = currentInput;
                const results = await searchKnowledgeBase(searchQuery, profile.id);
                standardRagDebug += formatRagDebugSection('PROFILE KB', results);
                if (results && results.length > 0) {
                    let constantSnippetTitles = [];
                    try {
                        constantSnippetTitles = db.getConstantSnippets(profile.id)
                            .map(c => (c.title || '').toLowerCase());
                    } catch (e) { }

                    searchableResults = results
                        .filter(r => {
                            const fileMatch = knowledgeFiles.find(f => f.name.toLowerCase() === r.source.toLowerCase());
                            if (fileMatch && (fileMatch.strategy === 'constant' || fileMatch.strategy === 'full_context')) {
                                return false;
                            }
                            if (constantSnippetTitles.includes(r.source.toLowerCase())) {
                                return false;
                            }
                            return true;
                        });
                    searchableResults = Array.from(
                        new Map(searchableResults.map(result => [result.text, result])).values()
                    );
                }

                if (includeChatContext && chat) {
                    const chatKbResults = await searchChatKnowledgeBase(currentInput, chatId);
                    if (chatKbResults && chatKbResults.length > 0) {
                        const chatKbFiles = typeof chat.knowledgeFiles === 'string'
                            ? JSON.parse(chat.knowledgeFiles)
                            : (chat.knowledgeFiles || []);
                        chatKbChunks = filterWorkspaceKnowledgeResults(
                            chatKbResults,
                            chatKbFiles,
                            profile.id
                        );
                    }
                    standardRagDebug += formatRagDebugSection('CHAT KB', chatKbChunks);
                }

                if (includeChatContext && chat) {
                    const memoryResults = await searchChatMemories(currentInput, chatId);
                    if (memoryResults && memoryResults.length > 0) {
                        const blocksList = typeof chat.memoryBlocks === 'string'
                            ? JSON.parse(chat.memoryBlocks)
                            : (chat.memoryBlocks || []);
                        chatMemories = filterWorkspaceMemoryResults(
                            memoryResults,
                            blocksList,
                            profile.id
                        );
                    }
                    standardRagDebug += formatRagDebugSection('CHAT MEMORY', chatMemories);
                }

                const standardEntries = [
                    ...searchableResults.map(result => ({
                        key: `profile:${result.id}`,
                        kind: 'profile-knowledge',
                        source: result.source,
                        content: result.text,
                        relevance: result.fusionScore ?? result.score
                    })),
                    ...chatKbChunks.map(result => ({
                        key: `workspace-text:${result.id}`,
                        kind: 'workspace-text',
                        source: result.source,
                        content: result.text,
                        relevance: result.fusionScore ?? result.score
                    })),
                    ...chatMemories.map(result => ({
                        key: `workspace-memory:${result.id}`,
                        kind: 'workspace-memory',
                        source: result.source,
                        content: result.text,
                        relevance: result.fusionScore ?? result.score
                    }))
                ];
                const standardSelection = selectRetrievedEntries(currentInput, standardEntries);
                const selectedStandardKeys = new Set(standardSelection.selected.map(entry => entry.key));
                searchableResults = searchableResults.filter(result => selectedStandardKeys.has(`profile:${result.id}`));
                chatKbChunks = chatKbChunks.filter(result => selectedStandardKeys.has(`workspace-text:${result.id}`));
                chatMemories = chatMemories.filter(result => selectedStandardKeys.has(`workspace-memory:${result.id}`));
                searchableChunks = searchableResults.map(result => result.text);
                profileKbTokens += estimateTokens(searchableChunks.join('\n\n'));
                retrievalFunnel = standardSelection.funnel;
                if (searchableChunks.length > 0) {
                    const profileLabel = isRoleplayWorkspace
                        ? 'NARRATOR REFERENCE: PROFILE RETRIEVAL'
                        : 'PROFILE RELEVANT RETRIEVED KNOWLEDGE';
                    contextBlock += `\n\n--- ${profileLabel} ---\n${searchableChunks.join('\n\n')}\n`;
                }
                const kanoraItems = [
                    ...chatKbChunks.map(r => ({
                        id: r.id,
                        kind: 'workspace-text',
                        source: r.source,
                        content: r.text,
                        relevance: r.fusionScore ?? r.score
                    })),
                    ...chatMemories.map(r => ({
                        id: r.id,
                        kind: 'workspace-memory',
                        source: r.source,
                        content: r.text,
                        relevance: r.fusionScore ?? r.score
                    }))
                ];
                if (planWorkspaceContext) {
                    const kanoraBudget = getAvailableHistoryTokens({
                        maxPayloadTokens: maxContextTokens,
                        systemPrompt: compiledSystemPrompt + contextBlock + attachmentsPayloadContext,
                        newPrompt: currentInput,
                        attachedImageCount: i === 0 ? attachedImages.length : 0,
                        outputTokens: profile.maxTokens ?? 1000
                    });
                    const planned = planKanoraContext({
                        chatId,
                        query: currentInput,
                        items: kanoraItems,
                        tokenBudget: kanoraBudget
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

            if (contextBlock) {
                compiledSystemPrompt += contextBlock;
            }

            const inputTokens = estimateTokens(currentInput);
            const systemTokens = estimateTokens(compiledSystemPrompt);
            const narrativeContextTokens = Math.max(0, systemTokens - systemInstructionsTokens);
            const remainingTokens = getAvailableHistoryTokens({
                maxPayloadTokens: maxContextTokens,
                systemPrompt: compiledSystemPrompt,
                newPrompt: currentInput,
                attachedImageCount: i === 0 ? attachedImages.length : 0,
                outputTokens: profile.maxTokens ?? 1000
            });

            let chatHistory = [];
            if (i === 0 || includeChatHistory) {
                let historySource = activeMessages;
                if (i === 0) {
                    const last = activeMessages[activeMessages.length - 1];
                    if (last && last.role === 'user') {
                        historySource = activeMessages.slice(0, -1);
                    }
                }
                chatHistory = formatActiveHistory(historySource, remainingTokens);
            }

            let historyMessagesTokens = 0;
            chatHistory.forEach(msg => {
                historyMessagesTokens += estimateTokens(msg.content);
            });
            chatHistoryTokens += historyMessagesTokens;
            const totalInputTokens = systemTokens + inputTokens + historyMessagesTokens;

            let success = false;
            let stepOutput = '';

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
                        manualMode: profile.manualMode === 1,
                        manualJson: profile.manualJson,
                        abortSignal: currentRun.controller.signal,
                        attachedImages: (i === 0 ? attachedImages : [])
                    };

                    // Only the final, user-facing generation streams; intermediate
                    // workflow steps are plumbing and stay non-streaming.
                    if ((i === steps.length - 1) && isStreamingEnabled()) {
                        stepOutput = await sendApiRequestStream(
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
                        stepOutput = await sendApiRequest(genParams);
                    }
                    success = true;
                } catch (apiError) {
                    if (apiError.name === 'AbortError' || currentRun.isCancelled) {
                        return { success: false, cancelled: true };
                    }
                    console.error(`API Error in step ${i + 1} (${profile.name}):`, apiError);

                    sendRunEvent(webContents, 'workflow-error', currentRun, {
                        step: i + 1,
                        profileName: profile.name,
                        errorMessage: apiError.message || 'API request failed.',
                        isWorkflow: isWorkflow
                    });

                    const decision = await new Promise((resolve) => {
                        errorDeferred = { resolve };
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

            // Handle Context Overflow for intermediates
            // A threshold of 16,000 characters (roughly 4,000 tokens) checks for large outputs
            const isLastStep = (i === steps.length - 1);
            if (estimateTokens(stepOutput) > 4000 && !isLastStep) {
                sendRunEvent(webContents, 'workflow-context-overflow', currentRun, {
                    step: i + 1,
                    profileName: profile.name,
                    outputText: stepOutput
                });

                const overflowResponse = await new Promise((resolve) => {
                    overflowDeferred = { resolve };
                });

                if (overflowResponse.decision === 'send_edited') {
                    stepOutput = overflowResponse.editedText;
                }
            }

            currentInput = stepOutput;
            finalOutput = stepOutput;

            lastAgenticRagResponse = agenticRagResponse;
            lastAgenticRagContextGathered = agenticRagContextGathered;
            if (standardRagDebug) lastStandardRagDebug = standardRagDebug;
            lastNarrativeContextRequestId = narrativeContextRequestId;
            lastFinalContextText = contextBlock;
            lastContextBundle = contextBundleDiagnostic;
            lastRetrievalMode = retrievalMode;
            lastAgenticTrace = agenticTrace;
            lastRetrievalFunnel = retrievalFunnel;
            lastGenerationPolicyId = generationPolicyId;

            totalProfileKbTokens += profileKbTokens;
            totalChatKbTokens += chatKbTokens;
            totalChatHistoryTokens += chatHistoryTokens;
            totalSystemInstructionTokens += systemInstructionsTokens;
            totalNarrativeContextTokens += narrativeContextTokens;
            totalUserInputTokens += inputTokens;
            totalMainInputTokens += totalInputTokens;
            totalAgenticInputTokens += agenticInputTokens;
            totalAgenticOutputTokens += agenticOutputTokens;
            totalOutputTokens += estimateTokens(stepOutput);
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
            let debugObj = createMessageDiagnostics({
                workflowStatus: isWorkflow ? `Workflow complete (${steps.length} steps)` : '',
                legacy: {
                    agenticRagResponse: lastAgenticRagResponse,
                    agenticRagContextGathered: lastAgenticRagContextGathered,
                    standardRagContextGathered: lastStandardRagDebug,
                    tokens: legacyTokens
                },
                generation: {
                    profileName: lastProfileUsed.name,
                    context: {
                        exactText: lastFinalContextText,
                        exactTokens: estimateTokens(lastFinalContextText),
                        workflowContextTokens: totalNarrativeContextTokens,
                        manifestRequestId: lastNarrativeContextRequestId
                    },
                    policyId: lastGenerationPolicyId,
                    steps: steps.length
                },
                retrieval: {
                    mode: lastRetrievalMode,
                    retrievedSourcesText: lastRetrievalMode === 'agentic'
                        ? lastAgenticRagContextGathered
                        : lastStandardRagDebug,
                    finalContextText: lastFinalContextText,
                    bundle: lastContextBundle,
                    selection: lastRetrievalFunnel
                },
                agentic: lastAgenticTrace ? {
                    ...lastAgenticTrace,
                    contextText: lastAgenticRagContextGathered,
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
                    agenticOutput: totalAgenticOutputTokens
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
            if (lastNarrativeContextRequestId) {
                try {
                    const { NarrativeContextManifestRepository } = require('../../dist-main/main/features/kanora/context-manifest');
                    new NarrativeContextManifestRepository(db)
                        .attachOrigin(chatId, lastNarrativeContextRequestId, aiMsgId);
                } catch (error) {
                    console.error('[Roleplay Context] Could not attach the context manifest:', error);
                }
            }

            try {
                const narrativeResult = await updateRoleplayStateWithSystemAi({
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
                    const { RoleplaySystem } = require('../../dist-main/main/features/kanora/roleplay-system');
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
                    const { NarrativeStateSystem } = require('../../dist-main/main/features/kanora/narrative-state');
                    new NarrativeStateSystem(db).finishJob(chatId, aiMsgId, 'failed', { error: error.message || 'Narrative State update failed.' });
                } catch (jobError) {
                    console.error('[Narrative State] Could not persist failed job:', jobError);
                }
            }
            db.prepare('UPDATE messages SET debugNotice = ? WHERE id = ? AND chatId = ?')
                .run(JSON.stringify(debugObj), aiMsgId, chatId);

            if (roleplayChanges.length) {
                webContents.send('roleplay-resource-changes', { workspaceId: chatId, changes: roleplayChanges });
            }

            checkAndAutoSummarize(chatId, lastProfileUsed.id).catch(e => {
                console.error("[Auto-Summarize] error:", e);
            });

            return { success: true, aiMsgId, streamed: didStreamFinalResponse };
        }

        return { success: true };

    } catch (e) {
        if (e.name === 'AbortError' || currentRun.isCancelled) {
            return { success: false, cancelled: true };
        }
        console.error("Workflow Execution Failure:", e);
        sendRunEvent(webContents, 'workflow-error', currentRun, {
            step: 0,
            profileName: 'Workflow Engine',
            errorMessage: e.message || 'Fatal error during workflow execution.',
            isWorkflow: isWorkflow
        });
        return { success: false, error: e.message };
    } finally {
        if (activeRun === currentRun) {
            activeRun = null;
            errorDeferred = null;
            overflowDeferred = null;
        }
    }
}

function cancelGeneration() {
    if (activeRun) {
        activeRun.isCancelled = true;
        if (activeRun.controller) {
            activeRun.controller.abort();
        }
    }
}

function resolveErrorDeferred(decision) {
    if (errorDeferred) {
        errorDeferred.resolve(decision);
        errorDeferred = null;
    }
}

function resolveOverflowDeferred(decision, editedText) {
    if (overflowDeferred) {
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

// Validate the per-chunk tag array from the classifier. Keep only known categories
// and in-range chunk indices; explode each category's value list into {tag, value}
// pairs (create-off: unknown categories dropped). Returns [{chunkIndex, tags:[{tag,value}]}].
function validateChunkTags(arr, categories, chunkRecords) {
    const chunkCount = Array.isArray(chunkRecords) ? chunkRecords.length : Number(chunkRecords) || 0;
    const byName = new Map(categories.map(c => [c.name.toLowerCase(), c.name]));
    const out = [];
    for (const entry of (Array.isArray(arr) ? arr : [])) {
        if (!entry || typeof entry !== 'object') continue;
        const idx = Number(entry.chunk);
        if (!Number.isInteger(idx) || idx < 0 || idx >= chunkCount) continue;
        const tags = [];
        const chunkText = Array.isArray(chunkRecords) ? String(chunkRecords[idx]?.text || '') : '';
        for (const mention of (Array.isArray(entry.mentions) ? entry.mentions : [])) {
            const name = byName.get(String(mention && (mention.type || mention.tag) || '').toLowerCase());
            const value = String(mention && (mention.canonicalName || mention.value || mention.text) || '').trim();
            const evidence = String(mention && evidenceText(mention.evidence) || '').trim();
            if (!name || !value || !evidence || !chunkContainsEvidence(chunkText, evidence)) continue;
            const proposalKind = String(mention && mention.proposalKind || '').trim().toLowerCase();
            tags.push({ tag: name, value, evidence, proposalKind });
        }
        for (const rt of (Array.isArray(entry.tags) ? entry.tags : [])) {
            const name = byName.get(String(rt && rt.tag || '').toLowerCase());
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

function evidenceText(value) {
    if (Array.isArray(value)) return value.map(v => String(v || '').trim()).filter(Boolean).join(' ');
    return value;
}

function normalizeEvidence(value) {
    return String(value || '').toLowerCase().replace(/\s+/g, ' ').trim();
}

function chunkContainsEvidence(chunkText, evidence) {
    const haystack = normalizeEvidence(chunkText);
    const needle = normalizeEvidence(evidence);
    return needle.length >= 2 && haystack.includes(needle);
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

// Render a workspace's entity registry as a prompt block so the classifier reuses
// existing canonical names (and maps titles/variants to them) instead of coining
// inconsistent values. Empty string when the registry has no entities yet.
// Serialize an entity's structured `data` fields into a short human-readable clause
// for the retrieval dossier. Nothing curated into the registry may be lost from
// retrieval, so every scalar attribute the user set surfaces to the model. Long-form
// prose (description/content) is skipped here, it rides on the entity's Lore instead.
const DOSSIER_DATA_FIELDS = [
    ['status', 'status'], ['itemType', 'type'], ['locationType', 'type'],
    ['nature', 'nature'], ['scope', 'kind'], ['disposition', 'disposition'],
    ['rarity', 'abundance'], ['abundance', 'abundance'], ['threat', 'threat'],
    ['age', 'age'], ['role', 'role'], ['abilities', 'abilities'], ['ownership', 'ownership'],
];
function entityDataFacts(data) {
    if (!data || typeof data !== 'object') return '';
    const parts = [];
    for (const [key, label] of DOSSIER_DATA_FIELDS) {
        const v = data[key];
        if (v == null) continue;
        const s = String(v).trim();
        if (s) parts.push(`${label}: ${s}`);
    }
    return parts.join('; ');
}

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

// Map a classifier's surface mention to a canonical entity id within a workspace.
// Returns null on a miss, the tagger only tags entities that already exist in the
// Worldbuild registry, so unknown names are dropped rather than proposed or stored
// as loose literal text.
function resolveEntity(workspaceId, type, value) {
    return entitiesStore.resolveMention(value, type, workspaceId) || null;
}

// World-index pass: ONE System-AI call over a segment's numbered raw chunks. Returns
// the block's title + summary AND the per-chunk dynamic tags (which named entities,
// under which variable category, appear in each chunk). Variable categories = the
// entity-bearing vocabulary; their descriptions are the classifier criteria.
// Provider errors often arrive as a JSON string (e.g. '{"message":"..."}'); unwrap
// to the human-readable text so the toast doesn't show raw JSON.
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

// The entity tagger fails silently by design (a broken pass never blocks the chat,
// summarization, or a document save). But when a System AI IS configured, a silent
// failure misleads the user into thinking indexing/tagging ran. Notify every time it
// fails, so a failure that slipped by once is still caught the next time. The renderer
// keeps a single toast (later sends just refresh it), so repeats don't stack. Broadcast
// to every window since the main window is not guaranteed to be index 0.
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

async function classifyAndTagSegment(chunkRecords, profile, workspaceId = null) {
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

    const numbered = chunkRecords.map((c, i) => `[CHUNK ${i}]\n${c.text}`).join('\n\n');
    const catLines = categories.length
        ? categories.map(c => `- ${c.name}: ${c.description}`).join('\n')
        : '- Characters: People, beings, or named agents present in the scene.';
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
    try {
        const maxTokens = 4096;
        const request = (prompt, repair = false) => sendApiRequest({
            apiProfileId, model, systemPrompt,
            chatHistory: [],
            newPrompt: prompt,
            temperature: repair ? 0 : 0.1,
            maxTokens,
            manualMode, manualJson,
            jsonMode: true
        });
        let response = await request(numbered);
        let structured = parseTaggerResponse(response);
        let validated = structured.valid ? validateChunkTags(structured.items, categories, chunkRecords) : [];
        const needsRepair = !structured.valid || (structured.items.length > 0 && validated.length === 0);
        if (needsRepair) {
            response = await request(
                `Repair the response below to the exact required JSON shape. Preserve only mentions supported by the original numbered chunks.\n\nORIGINAL CHUNKS:\n${numbered}\n\nINVALID RESPONSE:\n${String(response || '').slice(0, 12000)}`,
                true
            );
            structured = parseTaggerResponse(response);
            validated = structured.valid ? validateChunkTags(structured.items, categories, chunkRecords) : [];
        }
        if (!structured.valid) throw new Error('The Tagger returned invalid structured JSON after one repair attempt.');
        if (structured.items.length > 0 && validated.length === 0) {
            throw new Error('The Tagger response contained mentions, but none passed category and evidence validation.');
        }
        chunkTags = validated;
    } catch (e) {
        console.error("[World Index] classify+tag failed:", e);
        // Only surface when a System AI is configured: without one, tagging is
        // intentionally off and this path only produced a title/summary.
        notifyTaggingFailure(e);
        return { title, summary, chunkTags, failed: true, error: cleanErrorMessage(e) };
    }
    return { title, summary, chunkTags };
}

async function summarizeArchiveSegment(rawText) {
    const summarizer = getRoleExecutor(ROLE_IDS.SUMMARIZER);
    if (!summarizer.executor) return { title: 'Chat Archive', summary: '', skipped: true, error: summarizer.error };

    const response = await sendApiRequest({
        ...summarizer.executor,
        systemPrompt: `${getSystemLanguageInstruction()}\nCreate faithful long-term memory from an archived conversation. The first line must be 'TITLE: [concise 3-word title]'. Then write a concise two-sentence summary that preserves consequential facts, decisions, changes, and unresolved threads. Do not invent details.`,
        chatHistory: [],
        newPrompt: rawText,
        temperature: 0.1,
        maxTokens: 500,
        manualMode: false,
        manualJson: null
    });
    const lines = String(response || '').trim().split('\n');
    const hasTitle = lines[0]?.toUpperCase().startsWith('TITLE:');
    return {
        title: hasTitle ? lines[0].slice(6).trim() || 'Chat Archive' : 'Chat Archive',
        summary: (hasTitle ? lines.slice(1) : lines).join('\n').trim()
    };
}

// Whether the "let the AI create unregistered entities" opt-in is on. Off by default,
// so tagging stays confirmed-only unless the user turns it on in Engine & Memory.
function allowAiEntityCreation() {
    try {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'advanced'").get();
        return !!(row && JSON.parse(row.value).allowAiEntityCreation);
    } catch (e) { return false; }
}

// Persist the validated per-chunk tags into chunk_tags, mapping the classifier's
// chunk index back to the real stored chunk id. Variable tags: tag=category,
// entity=value. Runs in one transaction; never throws on a bad index.
function applyChunkTags(chunkTags, chunkRecords, workspaceId = null) {
    // Tagger may inherit System AI or use a dedicated model. If it is unavailable,
    // vectorization still succeeds and existing tags remain untouched.
    if (!getRoleExecutor(ROLE_IDS.TAGGER).executor) return 0;
    if (!Array.isArray(chunkTags) || !chunkTags.length) return 0;
    const insert = db.prepare('INSERT OR IGNORE INTO chunk_tags (chunkId, tag, entity, manual) VALUES (?, ?, ?, 0)');
    const isSuppressed = db.prepare('SELECT 1 FROM chunk_tag_suppressions WHERE chunkId = ? AND tag = ? AND entity = ?');
    // Opt-in: unresolved mentions become empty `proposed` entities instead of being
    // dropped. Within one run a name is proposed once and reused across chunks (keyed
    // by workspace|type|normalized-name); across runs resolveEntity finds the proposed
    // row, so it is never re-proposed.
    const allowCreate = allowAiEntityCreation();
    const proposedCache = new Map();
    let rows = 0;
    db.transaction(() => {
        for (const entry of chunkTags) {
            const rec = chunkRecords[entry.chunkIndex];
            if (!rec || !rec.id) continue;
            // Prefer the caller's authoritative workspace; fall back to the chunk's
            // ownerId only when it is absent (the all-chats backfill passes null).
            // For Writing Desk documents ownerId is the documentId, so relying on it
            // would scope the registry lookup to the wrong id.
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

// Backfill the world index over a chat's already-archived raw chunks (or all chats
// when chatId is null). These predate the per-chunk tagger, so they carry no tags.
// Batches the chunks through ONE System-AI call each (tagging only, no title/
// summary) and writes chunk_tags. INSERT OR IGNORE keeps re-runs from duplicating.
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
    // Scoped vocab only when backfilling a single chat; the all-chats path leaves it
    // empty to avoid bleeding one workspace's names into another's prompt.
    // Which slice of a chat's memory this run tags. Each tier maps to its own button:
    // archive = summarized Chat Archive (also tagged live at summarization); custom =
    // searchable Custom Memory snippets (manual_/mem_); searchable = uploaded RAG files
    // (chat_kb, a distinct ownerType).
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

    // full: wipe this scope's existing tags and re-tag every chunk from scratch (the
    // "Index this Chat's memories" button), so a re-run reflects the current tagger and
    // entity registry instead of accumulating stale tags. Incremental (default): skip
    // chunks that already have tags so re-runs only fill gaps (e.g. a rate-limited tail).
    if (full) {
        // Preserve user-pinned tags (manual=1, e.g. yellow keywords on file chunks);
        // only the auto tagger's own rows reset.
        const delSql = `DELETE FROM chunk_tags WHERE (manual IS NULL OR manual = 0) AND chunkId IN
                        (SELECT kc.id FROM knowledge_chunks kc WHERE ${scopedWhere})`;
        db.prepare(delSql).run(...queryParams);
    }
    // Coverage, rather than tag rows, determines whether a chunk is done. A chunk
    // with no named entity is still a successful World Index result and must not be
    // sent to the System AI again by every "Tag new" run.
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

// One top-level ProseMirror block = one chunk. Splitting on paragraph / scene-break
// boundaries (instead of a fixed-size window) keeps each chunk's text stable: editing
// one paragraph only changes that paragraph's hash, so re-vectorization re-embeds just
// the touched chunk. Presentation (marks, page styling) never enters the text.
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

// Whether a chapter's current text matches its stored index, by comparing the block
// hash sets, the source of truth for the editor's "indexed" indicator. Immune to the
// mutable vectorized flag (which any save can reset). Returns 'done' | 'stale'.
// Returns 'done' (index current), 'outdated' (indexed once but content changed
// since), or 'never' (no index yet). The caller renders these as distinct states,
// 'never' is neutral, 'outdated' is the alert (AI is reading the old version).
function computeDocumentVectorStatus(documentId) {
    const doc = db.prepare('SELECT content FROM documents WHERE id = ?').get(documentId);
    if (!doc) return 'never';
    const units = pmDocToChunkUnits(doc.content);
    const rows = db.prepare(
        "SELECT content_hash, manuallyEdited FROM knowledge_chunks WHERE ownerId = ? AND ownerType = 'document'"
    ).all(documentId);
    // No index yet: 'never' unless the chapter is also empty (nothing to index).
    if (!rows.length) return units.length ? 'never' : 'done';
    // Manually-edited chunks are preserved across re-index, so they don't count toward
    // the match; compare current blocks against the automated index only.
    const stored = new Set(rows.filter(r => !r.manuallyEdited && r.content_hash).map(r => r.content_hash));
    const current = new Set(units.map(u => u.hash));
    if (stored.size !== current.size) return 'outdated';
    for (const h of current) if (!stored.has(h)) return 'outdated';
    return 'done';
}

// Vectorize (or re-vectorize) a single chapter into ownerType='document' chunks.
// Incremental by content hash: unchanged blocks keep their vector + tags untouched,
// only new/changed blocks are embedded and tagged, removed blocks are deleted. This
// is what feeds gatherRag's "OTHER CHAPTERS" cross-chapter retrieval. User-triggered.
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

        // Tag only the freshly embedded chunks (World index). Requires a System AI,
        // without one, indexing only vectorizes and this whole pass is skipped.
        // Best-effort: a failed pass just leaves the new chunks untagged.
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

// Re-tag every already-embedded chunk of a chapter WITHOUT re-embedding (the "Reindex
// all" variant of the chapter index button). Wipes this document's existing chunk_tags
// and reclassifies from scratch, so a re-run reflects the current tagger and entity
// registry. Vectors are left untouched, new/changed blocks are still embedded by
// vectorizeDocument ("Index new").
async function retagDocumentChunks(documentId, progressCallback = null) {
    const doc = db.prepare('SELECT id, workspaceId FROM documents WHERE id = ?').get(documentId);
    if (!doc) throw new Error('Document not found');

    const rows = db.prepare(
        "SELECT id, text FROM knowledge_chunks WHERE ownerId = ? AND ownerType = 'document' ORDER BY ordinal ASC"
    ).all(documentId);
    if (!rows.length) return { tagged: 0, chunks: 0 };

    // No System AI → tagging is disabled; don't wipe the existing tags for nothing.
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

// Tolerant object parse: grab the first {...} block and JSON.parse it. null on failure.
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

// Which data fields the enrichment may set per type, and the closed vocabularies for
// the ones that are enums. Anything outside the allowlist is ignored; enum values that
// don't match are dropped. Mirrors the WorldbuildView editors.
const ENRICH_ENUMS = {
    status: ['alive', 'deceased', 'missing', 'unknown'],
    disposition: ['hostile', 'neutral', 'friendly', 'unknown'],
    abundance: ['Unique', 'Rare', 'Uncommon', 'Common', 'Abundant'],
    threat: ['Harmless', 'Minor', 'Dangerous', 'Deadly', 'Legendary'],
    itemType: ['Weapon', 'Armor', 'Tool', 'Consumable', 'Artifact', 'Document', 'Container', 'Currency', 'Material', 'Resource', 'Object'],
};
// Each list mirrors the scalar `data` fields the WorldbuildView actually renders for
// that type, nothing else. The AI may only fill what the user can see; it must never
// invent fields (e.g. a Character has no "role"/"abilities", a Creature has no
// "description"). Relational fields (owner, race, faction, habitat…) and chapter links
// are edges, not data, and are handled separately.
const ENRICH_FIELDS = {
    Characters: ['status', 'age', 'appearance', 'personality'],
    Creatures: ['status', 'disposition', 'nature', 'abundance', 'threat', 'abilities', 'appearance', 'personality'],
    Locations: ['locationType', 'description'],
    Items: ['itemType', 'abundance', 'description'],
    Factions: ['description'],
    Races: ['description'],
    Events: ['kind', 'description'],
    System: ['content'],
};

const ENRICH_TYPE_GUIDANCE = {
    Characters: 'A specific person or personified agent. Record their current canonical state, not temporary scene circumstances or thematic interpretations.',
    Creatures: 'An individual creature or a creature group/species. Respect its scope: individuals have status; groups have abundance. Do not convert metaphorical descriptions into biology or powers.',
    Locations: 'A persistent physical place. Do not treat a temporary scene setting, organization, plane of thought, or mere association as physical containment.',
    Items: 'A persistent object, artifact, equipment, or resource. Distinguish possession, use, creation, and discovery; they are not interchangeable.',
    Factions: 'An organized group with shared identity. Describe established goals, structure, or reputation without inferring collective intent from one member.',
    Races: 'A canonical species, lineage, ancestry, or people. Describe established traits and culture without generalizing from one individual.',
    Events: 'A named or canonically significant happening. Record what occurred and why it factually matters, not speculative consequences.',
    System: 'A reusable canonical concept, law, doctrine, magic system, technology, currency, cosmological mechanism, or world rule. Content must explain its operation, scope, limits, terminology, and consequences without turning examples into universal rules.',
};

const ENRICH_FIELD_GUIDANCE = {
    status: 'Current state only. alive requires explicit survival or a current direct action that cannot be posthumous. deceased requires explicit confirmation of death or a canonically defined irreversible equivalent. Surrender, defeat, disappearance, transformation, assimilation, imprisonment, incapacitation, or leaving a role are not death. missing means whereabouts are explicitly unknown; unknown means the evidence cannot establish a state.',
    age: 'A literal current age explicitly stated for this character. Never calculate it from dates, elapsed time, appearance, or life stage.',
    appearance: 'Stable physical appearance, clothing, presentation, and distinguishing features explicitly attributed to this individual. Exclude temporary pose, location, lighting, injuries that immediately resolve, and subjective comparisons.',
    personality: 'Stable temperament, habits, values, instincts, and contradictions explicitly established across narration or behavior. Do not turn a single reaction, mood, or unsupported interpretation into a lasting trait.',
    disposition: 'A stable default attitude toward relevant people, not a momentary emotional reaction in one scene.',
    nature: 'The explicitly established creature category or nature, such as Beast, Spirit, or Deity. Do not infer it from appearance or abilities.',
    abundance: 'World-level prevalence of a resource or creature group, not the quantity present in one scene.',
    threat: 'An explicitly established general danger level, not how frightening or powerful one scene makes the entity appear.',
    abilities: 'Concrete repeatable capabilities or traits explicitly demonstrated or stated. Exclude metaphors, one-time circumstances, equipment, and speculation.',
    locationType: 'The explicit kind of place, such as continent, city, fortress, or tavern. Do not use its name, owner, atmosphere, or current purpose as its type.',
    itemType: 'Classify the item by its canonical function. Resource is an ordinary category for naturally occurring or gathered items; item nature, not category, controls ownership and abundance.',
    description: 'A concise factual description built only from established properties, function, appearance, culture, goals, structure, or importance appropriate to this entity type.',
    kind: 'The explicit category of event, such as Battle, Festival, Holiday, Disaster, or Coronation. Do not use its outcome or emotional tone as its kind.',
    content: 'A precise canonical explanation of the concept or system: definition, mechanism, scope, constraints, terminology, exceptions, and consequences when supported. Preserve distinctions between related concepts and never universalize a single example.',
};

const ENRICH_RELATION_GUIDANCE = {
    'Characters.race': 'Only an explicitly established ancestry, species, lineage, or people.',
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

let kanoraChatContext = null;
function getKanoraChatContext() {
    if (!kanoraChatContext) {
        const { createKallamoKanoraChatContext } = require('../../dist-main/main/features/kanora/chat-context');
        kanoraChatContext = createKallamoKanoraChatContext(db, estimateTokens);
    }
    return kanoraChatContext;
}

function planKanoraContext({ chatId, query, items, tokenBudget }) {
    return getKanoraChatContext().plan({
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
        const { getWorkspaceExperienceMode } = require('../../dist-main/main/features/kanora/mode-orchestration');
        return getWorkspaceExperienceMode(db, chatId) === 'roleplay';
    } catch {
        return false;
    }
}

async function updateRoleplayStateWithSystemAi({ workspaceId, provenanceId, userMessage, narrativeResponse }) {
    const { getWorkspaceExperienceMode } = require('../../dist-main/main/features/kanora/mode-orchestration');
    if (getWorkspaceExperienceMode(db, workspaceId) !== 'roleplay') {
        return { changes: [], diagnostics: null };
    }

    const calendarService = require('./features/worldbuild/calendar-service');
    const { RoleplaySystem } = require('../../dist-main/main/features/kanora/roleplay-system');
    const roleplay = new RoleplaySystem(db);
    const scene = roleplay.getScene(workspaceId);
    const startClock = calendarService.getRoleplayClock(db, workspaceId);
    const recordTimeFrame = (timeAdvance, endLocationId = roleplay.getScene(workspaceId)?.locationId) =>
        calendarService.applyRoleplayTurnFrame(db, {
            workspaceId,
            originId: provenanceId,
            startClock,
            startLocationId: scene?.locationId,
            endLocationId,
            timeAdvance
        });

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

    const { NarrativeStateSystem } = require('../../dist-main/main/features/kanora/narrative-state');
    const { NarrativeEntitySystem } = require('../../dist-main/main/features/kanora/narrative-entities');
    const { NarrativeContextManifestRepository } = require('../../dist-main/main/features/kanora/context-manifest');
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
    const allEntities = db.prepare(`
        SELECT id, type, canonicalName, aliases, lore, data FROM entities
        WHERE workspaceId = ? AND status != 'proposed'
          AND type IN ('Characters', 'Creatures', 'Locations', 'Items')
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
    const compactEntities = entities.map(entity => ({
        id: entity.id,
        type: entity.type,
        canonicalName: entity.canonicalName,
        aliases: entity.aliases,
        ...(entity.type === 'Items' ? {
            itemNature: entity.data.itemNature === 'unique' ? 'unique' : 'type'
        } : {})
    }));
    const allowedEntityIds = new Set(allEntities.map(entity => entity.id));
    const actorIds = new Set(allEntities
        .filter(entity => entity.type === 'Characters' || entity.type === 'Creatures')
        .map(entity => entity.id));
    const locationIds = new Set(allEntities.filter(entity => entity.type === 'Locations').map(entity => entity.id));
    const locationLinks = db.prepare(`
        SELECT fromId, toId, relType FROM entity_links
        WHERE workspaceId = ? AND relType IN ('inside', 'connected_to', 'adjacent_to')
    `).all(workspaceId).filter(link => locationIds.has(link.fromId) && locationIds.has(link.toId));
    const reachableLocationIds = findReachableLocations(scene?.locationId, locationLinks, 2);
    const calendar = calendarService.getCalendar(db, workspaceId);
    const timeMatrix = calendarService.getTimeMatrix(db, workspaceId);
    const triagePayloadValue = {
        currentScene: compactNarrativeScene(scene),
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
        candidateSignals: narrativeSignals,
        userMessage,
        narrativeResponse
    };
    const triagePayload = JSON.stringify(triagePayloadValue);
    const narrativeTelemetry = {
        structuredFallbacks: 0,
        structuredFallbackStages: [],
        structuredOutputMode: 'schema'
    };
    let triageRepairCount = 0;
    let deepRepairCount = 0;
    let repairInputTokens = 0;
    let repairOutputTokens = 0;
    let triageResponse = await sendNarrativeJson({
        apiProfileId: role.executor.apiProfileId,
        model: role.executor.model,
        systemPrompt: NARRATIVE_TRIAGE_SYSTEM_PROMPT,
        chatHistory: [], newPrompt: triagePayload, temperature: 0, maxTokens: 512, manualMode: false, manualJson: null
    }, NARRATIVE_TRIAGE_SCHEMA, 'Narrative State triage', narrativeTelemetry);
    const triagePrimaryOutputTokens = estimateTokens(triageResponse);
    let triage = safeParseObject(triageResponse);
    if (!triage) {
        triageRepairCount += 1;
        repairInputTokens += estimateTokens(NARRATIVE_REPAIR_SYSTEM_PROMPT)
            + estimateTokens(`INVALID RESPONSE:\n${String(triageResponse || '').slice(0, 16000)}`);
        triageResponse = await repairNarrativeJson({
            executor: role.executor,
            invalidResponse: triageResponse,
            schema: NARRATIVE_TRIAGE_SCHEMA,
            label: 'Narrative State triage',
            telemetry: narrativeTelemetry
        });
        repairOutputTokens += estimateTokens(triageResponse);
        triage = safeParseObject(triageResponse);
    }
    const routing = resolveNarrativeRouting({ triage, signals: narrativeSignals });
    const forceDeepAnalysis = routing.forceDeepAnalysis;
    if (!triage?.consequential && !forceDeepAnalysis) {
        const timeFrame = recordTimeFrame(triage?.timeAdvance);
        const triageInputTokens = estimateTokens(NARRATIVE_TRIAGE_SYSTEM_PROMPT) + estimateTokens(triagePayload);
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
                contextUsage: measureNarrativeContextSections(triagePayloadValue, NARRATIVE_TRIAGE_SYSTEM_PROMPT),
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
    const witnessIds = new Set([
        roleplaySettings.playerEntityId,
        ...(scene?.participantIds || []),
        ...(scene?.possibleObserverIds || []),
        ...narrativeSignals.mentionedActorIds,
        ...triageEntityIds
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
    const scopedManifest = shouldAnalyzeEpistemicState
        ? compactNarrativeManifest(preTurnManifest, [...witnessIds], [...targetIds])
        : null;
    const currentPerspectiveState = shouldAnalyzeEpistemicState && affectedIds.size ? db.prepare(`
        SELECT records.record_type AS type, records.subject_id AS subjectId, records.payload_json AS payload
        FROM kanora_narrative_records records
        JOIN kanora_narrative_events events
          ON events.workspace_id = records.workspace_id AND events.event_id = records.source_event_id
        LEFT JOIN kanora_narrative_event_evidence evidence
          ON evidence.workspace_id = events.workspace_id AND evidence.event_id = events.event_id AND evidence.ordinal = 0
        LEFT JOIN kanora_narrative_origin_lifecycle lifecycle
          ON lifecycle.workspace_id = events.workspace_id AND lifecycle.origin_id = evidence.origin_id
        WHERE records.workspace_id = ? AND (
          subject_id IN (${[...affectedIds].map(() => '?').join(',')})
          OR json_extract(payload_json, '$.proposition.subjectId') IN (${[...affectedIds].map(() => '?').join(',')})
          OR json_extract(payload_json, '$.entityId') IN (${[...affectedIds].map(() => '?').join(',')})
        )
          AND records.record_type IN ('fact', 'state', 'knowledge', 'belief', 'memory', 'relationship')
          AND COALESCE(lifecycle.status, 'active') = 'active'
        ORDER BY records.applied_at DESC LIMIT 120
    `).all(workspaceId, ...affectedIds, ...affectedIds, ...affectedIds)
        .map(row => ({ type: row.type, subjectId: row.subjectId, value: JSON.parse(row.payload) })) : [];
    const knowledgeCardRows = shouldAnalyzeEpistemicState && witnessIds.size && targetIds.size ? db.prepare(`
        SELECT cards.owner_id AS ownerId, cards.target_id AS targetId,
          cards.card_id AS cardId, cards.known_as AS knownAs,
          fields.field_key AS fieldKey
        FROM worldbuild_knowledge_cards cards
        LEFT JOIN worldbuild_known_fields fields
          ON fields.workspace_id = cards.workspace_id AND fields.card_id = cards.card_id
        WHERE cards.workspace_id = ? AND cards.status = 'active'
          AND cards.owner_id IN (${[...witnessIds].map(() => '?').join(',')})
          AND cards.target_id IN (${[...targetIds].map(() => '?').join(',')})
        ORDER BY cards.owner_id, cards.target_id, fields.field_key
    `).all(workspaceId, ...witnessIds, ...targetIds) : [];
    const currentKnowledgeCards = groupKnowledgeCardRows(knowledgeCardRows);
    const shouldAnalyzeInventory = selectedDomains.includes('inventory');
    const shouldAnalyzeResources = selectedDomains.includes('resource');
    const shouldAnalyzeScene = selectedDomains.includes('scene');
    const relevantHolderIds = new Set([...witnessIds].filter(Boolean));
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
                key: resource.key,
                current: resource.current,
                maximum: resource.maximum
            })))
        : [];
    const relevantEntities = entities.filter(entity =>
        routing.requiresFullAnalysis || affectedIds.has(entity.id) || activeIds.has(entity.id)
    );
    const payloadValue = {
        routing: {
            selectedDomains,
            mode: routing.mode,
            requiresFullAnalysis: routing.requiresFullAnalysis,
            candidateSignals: narrativeSignals.signals
        },
        currentScene: compactNarrativeScene(scene),
        preTurnContext: scopedManifest || undefined,
        availableEntities: selectedDomains.includes('entity')
            ? relevantEntities
            : relevantEntities.map(entity => compactEntities.find(candidate => candidate.id === entity.id)),
        availableResources: shouldAnalyzeResources
            ? definitions.map(({ key, name, description, minimum, maximum, updatePolicy }) => ({
                key,
                name,
                description,
                minimum,
                maximum,
                updatePolicy
            }))
            : undefined,
        currentResourceStates: shouldAnalyzeResources ? currentResourceStates : undefined,
        currentInventoryState: shouldAnalyzeInventory ? currentInventoryState : undefined,
        currentLocationInventoryState: shouldAnalyzeInventory ? currentLocationInventoryState : undefined,
        reachableLocationIds: shouldAnalyzeScene ? [...reachableLocationIds] : undefined,
        locationLinks: shouldAnalyzeScene ? locationLinks : undefined,
        currentPerspectiveState: shouldAnalyzeEpistemicState ? currentPerspectiveState : undefined,
        currentKnowledgeCards: shouldAnalyzeEpistemicState ? currentKnowledgeCards : undefined,
        userMessage,
        narrativeResponse
    };
    const payload = JSON.stringify(payloadValue);
    const narrativeStateSystemPrompt = buildNarrativeStateSystemPrompt(selectedDomains);
    const stateOutputBudget = Math.min(
        8192,
        Math.max(2048, 1024 + (relevantEntities.length * 64) + (shouldAnalyzeResources ? definitions.length * 96 : 0))
    );
    let response = await sendNarrativeJson({
        apiProfileId: role.executor.apiProfileId,
        model: role.executor.model,
        systemPrompt: narrativeStateSystemPrompt,
        chatHistory: [],
        newPrompt: payload,
        temperature: 0,
        maxTokens: stateOutputBudget,
        manualMode: false,
        manualJson: null
    }, NARRATIVE_STATE_SCHEMA, 'Narrative State analysis', narrativeTelemetry);
    const deepPrimaryOutputTokens = estimateTokens(response);
    let parsed = safeParseObject(response);
    if (!parsed) {
        deepRepairCount += 1;
        repairInputTokens += estimateTokens(NARRATIVE_REPAIR_SYSTEM_PROMPT)
            + estimateTokens(`INVALID RESPONSE:\n${String(response || '').slice(0, 16000)}`);
        response = await repairNarrativeJson({
            executor: role.executor,
            invalidResponse: response,
            schema: NARRATIVE_STATE_SCHEMA,
            label: 'Narrative State analysis',
            telemetry: narrativeTelemetry
        });
        repairOutputTokens += estimateTokens(response);
        parsed = safeParseObject(response);
    }
    if (!parsed) {
        narrativeState.finishJob(workspaceId, provenanceId, 'failed', { deepAnalysis: true, error: 'Narrative State returned invalid JSON.' });
        throw new Error('Narrative State returned invalid Roleplay state JSON.');
    }
    const routedResult = constrainNarrativeStateResult(parsed, selectedDomains);

    const definitionsByKey = new Map(definitions.map(definition => [definition.key, definition]));
    const changes = [];
    const referenceIds = new Map();
    let narrativeProposalCount = 0;
    db.transaction(() => {
    for (const proposal of routedResult.newEntities) {
        const change = narrativeEntities.resolveOrPropose(workspaceId, provenanceId, proposal);
        changes.push({ kind: 'entity', ...change });
        if (change.entityId) {
            referenceIds.set(proposal.referenceId, change.entityId);
            allowedEntityIds.add(change.entityId);
            const introduction = narrativeState.createEvent({
                    workspaceId,
                    originId: provenanceId,
                    sceneId: scene?.id,
                    locationId: scene?.locationId,
                    interpreterId: role.executor.model,
                    allowedEntityIds,
                    event: {
                        type: 'custom',
                        description: proposal.description || `${proposal.name} enters the narrative.`,
                        excerpt: proposal.excerpt || proposal.name,
                        participantIds: [change.entityId],
                        confidence: proposal.confidence,
                        operations: [{
                            type: 'fact',
                            proposition: {
                                subjectId: change.entityId,
                                predicate: 'narrative-introduction',
                                object: proposal.description || `${proposal.name} enters the narrative.`
                            },
                            confidence: proposal.confidence
                        }]
                    }
            });
            if (introduction.record) {
                narrativeProposalCount += 1;
                changes.push({
                  kind: 'narrative',
                  eventId: introduction.record.proposal.changeSet.event.id,
                  status: introduction.record.status,
                  decision: introduction.decision,
                  description: introduction.record.proposal.changeSet.event.description
                });
            }
        }
    }
    const resolveReference = value => referenceIds.get(value) || value;
    const resolved = resolveNarrativeEntityReferences(routedResult, resolveReference);
    for (const [index, proposal] of (Array.isArray(resolved.resourceChanges) ? resolved.resourceChanges : []).entries()) {
        const definition = definitionsByKey.get(proposal?.resourceKey);
        if (!definition || typeof proposal?.entityId !== 'string' || !Number.isFinite(proposal?.value)) continue;
        try {
            const change = roleplay.proposeChange({
                id: `${provenanceId}:resource:${index}`,
                workspaceId,
                definitionId: definition.id,
                entityId: proposal.entityId,
                value: proposal.value,
                source: 'ai',
                provenanceId
            });
            changes.push({ kind: 'resource', changeId: change.id, ...change });
        } catch (error) {
            console.warn('[Roleplay State] Ignored invalid resource change:', error.message);
        }
    }
    if (resolved.scenePatch && typeof resolved.scenePatch === 'object' && !Array.isArray(resolved.scenePatch)) {
        try {
            const scenePatch = { ...resolved.scenePatch };
            if (scene?.locationId && scenePatch.locationId && !reachableLocationIds.has(scenePatch.locationId)) {
                delete scenePatch.locationId;
            }
            if (!Object.keys(scenePatch).length) throw new Error('Scene patch did not contain a locally valid change.');
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
            const change = roleplay.proposeInventoryChange({
                id: `${provenanceId}:inventory:${index}`,
                workspaceId,
                patch,
                source: 'ai',
                provenanceId
            });
            changes.push({ kind: 'inventory', changeId: change.id, ...change });
        } catch (error) {
            console.warn('[Roleplay State] Ignored invalid inventory change:', error.message);
        }
    }
    const eventBatches = chunkValues(Array.isArray(resolved.events) ? resolved.events : [], 8);
    for (const batch of eventBatches) {
        for (const event of batch) {
            try {
                const result = narrativeState.createEvent({ workspaceId, originId: provenanceId, sceneId: scene?.id, locationId: scene?.locationId, interpreterId: role.executor.model, event, allowedEntityIds });
                if (result.record) {
                    narrativeProposalCount += 1;
                    changes.push({ kind: 'narrative', eventId: result.record.proposal.changeSet.event.id, status: result.record.status, decision: result.decision, description: result.record.proposal.changeSet.event.description });
                }
            } catch (error) {
                console.warn('[Narrative State] Ignored invalid event:', error.message);
            }
        }
    }
    })();
    const timeFrame = recordTimeFrame(
        triage?.timeAdvance,
        routedResult.scenePatch?.locationId || roleplay.getScene(workspaceId)?.locationId
    );
    if (timeFrame.advance) changes.push({ kind: 'time', frame: timeFrame });
    const triageInputTokens = estimateTokens(NARRATIVE_TRIAGE_SYSTEM_PROMPT) + estimateTokens(triagePayload);
    const triageOutputTokens = triagePrimaryOutputTokens;
    const deepInputTokens = estimateTokens(narrativeStateSystemPrompt) + estimateTokens(payload);
    const deepOutputTokens = deepPrimaryOutputTokens;
    const elapsedMs = Date.now() - startedAt;
    narrativeState.finishJob(workspaceId, provenanceId, 'completed', { deepAnalysis: true, inputTokens: deepInputTokens, outputTokens: deepOutputTokens });
    narrativeState.recordMetric({ workspaceId, originId: provenanceId, triageInputTokens, triageOutputTokens, deepInputTokens, deepOutputTokens, deepAnalysis: true, proposalCount: narrativeProposalCount, elapsedMs, recordedAt: Date.now() });
    return {
        changes,
        diagnostics: {
            status: 'completed',
            manifest: preTurnManifest ? {
                requestId: preTurnManifest.requestId,
                sequence: preTurnManifest.sequence
            } : null,
            triage,
            timeFrame,
            forceDeepAnalysis,
            routing,
            contextUsage: {
                triage: measureNarrativeContextSections(triagePayloadValue, NARRATIVE_TRIAGE_SYSTEM_PROMPT),
                analysis: measureNarrativeContextSections(payloadValue, narrativeStateSystemPrompt)
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
                resourceChanges: routedResult.resourceChanges.length,
                inventoryChanges: routedResult.inventoryChanges.length,
                events: routedResult.events.length,
                rawEvents: routedResult.events.length,
                persistedEvents: narrativeProposalCount,
                scenePatch: Boolean(routedResult.scenePatch && Object.keys(routedResult.scenePatch).length)
            },
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

function compactNarrativeScene(scene) {
    if (!scene) return null;
    return {
        id: scene.id,
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
        resourceChanges: selected.has('resource') && Array.isArray(value.resourceChanges) ? value.resourceChanges : [],
        scenePatch: selected.has('scene') && value.scenePatch && typeof value.scenePatch === 'object' && !Array.isArray(value.scenePatch)
            ? value.scenePatch
            : {},
        inventoryChanges: selected.has('inventory') && Array.isArray(value.inventoryChanges) ? value.inventoryChanges : [],
        events: hasEpistemicDomain(domains) && Array.isArray(value.events) ? value.events : []
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
Return JSON only with {"consequential":boolean,"types":["entity","scene","resource","inventory","awareness","knowledge","belief","memory","relationship","fact"],"entityIds":["existing-id"],"confidence":0.0,"evidence":["short verbatim excerpt"],"requiresFullAnalysis":boolean,"reason":"brief","timeAdvance":null}.
Always evaluate elapsed time, even when no other durable domain is consequential. For an in-world action, timeAdvance is {"actionType":"short_snake_case","basis":"explicit|matrix","duration":{"years":0,"months":0,"days":0,"hours":0,"minutes":0},"confidence":0.0,"evidence":"short verbatim excerpt"}. Use null for out-of-character instructions, corrections, hypothetical actions, or when no in-world time passed.
Explicit duration in the final narrative wins over the matrix. Otherwise choose a reasonable value within the supplied matrix: Micro for dialogue lines, combat rounds, lockpicking, and quick scans; Local for same-district walking, wound care, and careful room inspection; Transit for cross-district travel, crowds, minor repairs, and setting camp; Macro for crafting, deep study, rest, and inter-city travel. Do not advance hours during line-by-line dialogue. Do not use a tiny advance for substantial travel. A jump of one day or more must be explicitly supported by the final narrative. Return calendar units directly instead of assuming a 24-hour day.
Mark inventory for explicit pickup, drop, transfer, gift, theft, loss, consumption, equip, unequip, drawing, sheathing, or quantity change. Mark scene for explicit arrival, departure, movement, participation, observer, nearby, object, or location change. Mark epistemic domains only for information actually communicated, perceived, discovered, remembered, believed, or relationally consequential. Mark resource for an actual value change, not a price mention or hypothetical.
A newly introduced persistent named character, stably identifiable individual creature, named location, or narratively important unique item is consequential even without an existing ID. An unnamed person distinguished only by appearance, ancestry, clothing, age, expression, or scene position may be routed as a sparse entity candidate, but is not yet a Worldbuild identity. Mark false for crowds, atmosphere, repetition, casual dialogue, hypotheticals, offers not completed, item mentions without possession changes, and events without durable consequences. Presence alone never grants awareness or knowledge. Set requiresFullAnalysis only when four or more domains interact or the consequence cannot be safely isolated.`;
const NARRATIVE_REPAIR_SYSTEM_PROMPT = 'Repair the supplied response into one valid JSON object that follows the required schema. Preserve supported values. Return JSON only.';

const NARRATIVE_FULL_STATE_SYSTEM_PROMPT = `You are Kallamo's Narrative State interpreter. Never write narrative prose. Extract only explicit, durable consequences from the supplied user message and narrative response. Use only supplied entity IDs and resource keys.
Return JSON only with {"newEntities":[],"resourceChanges":[],"scenePatch":{},"inventoryChanges":[],"events":[]}.
The user message is the player character's chosen action. The narrative response contains world and NPC consequences. Never infer a player choice, line, intention, emotion, memory, or private thought that the user did not supply.
preTurnContext is the exact compact epistemic manifest used for generation. Use its separate subject assessments to decide who could acquire information this turn. "undetermined" is not ignorance. "derived" and "evidence-candidate" are not automatically canon. currentKnowledgeCards contains Awareness and known-field coverage at the start of the turn.
When the final narrative clearly introduces a persistent Character, individual Creature, named Location, or narratively important Item that is absent from availableEntities, add {"referenceId":"new:stable-local-key","name":"canonical name or concise sparse label","type":"Characters|Creatures|Locations|Items","aliases":[],"description":"only explicit introduction facts","excerpt":"short verbatim evidence","confidence":0.0,"decision":"new|ambiguous|conflicting","identityEstablished":true|false,"reason":"brief","itemNature":"unique|type"}. Use its referenceId everywhere else in this response. Set identityEstablished true only when a proper name, stable title, number, designation, unmistakable continuity identity, or explicit registration establishes who the individual is. Appearance, ancestry, clothing, age, expression, or scene position alone never establishes identity. An individually described but anonymous person may be retained with a concise sparse label and identityEstablished false; it remains reviewable and must not become a Worldbuild entity automatically. Characters and individual Creatures may be created automatically only when identityEstablished is true and the identity is unequivocal. Locations and Items are reviewable. Do not create generic crowds, ordinary item mentions, aliases of existing entities, transformations, disguises, or duplicates. Mark ambiguous identity or possible duplication as ambiguous. Mark an invention that contradicts supplied canon as conflicting.
Scene patch may contain locationId, participantIds, possibleObserverIds, nearbyIds, and objectIds. Participants are directly involved, possible observers can witness the scene, and nearby entities are present in the broader location without necessarily witnessing it. When inventory also changes, keep objectIds consistent with unique items explicitly dropped, picked up, consumed, destroyed, or removed. Change location only when movement is explicit and use only reachableLocationIds; never jump to an unrelated branch of the location hierarchy. Presence is not ownership. A possible observer is only a candidate and does not automatically observe or learn.
Inventory changes must be explicit and use currentInventoryState plus currentLocationInventoryState. Track pickup, drop, placement, gift, transfer, theft, loss, consumption, destruction, equip, unequip, drawing, sheathing, and quantities. For a unique item move return {"itemId":"id","fromHolderId":"id-or-null","toHolderId":"id-or-null","locationId":"id-or-null","equipped":boolean-when-explicit}. For an item type transfer return {"itemId":"id","fromHolderId":"id-or-null","fromLocationId":"id-or-null","toHolderId":"id-or-null","locationId":"id-or-null","quantity":1,"equipped":boolean-when-explicit}. locationId means deliberately dropped or stored; fromLocationId means picked up. Removal, consumption, or loss may have no destination. For equipment only return {"itemId":"id","holderId":"id","equipped":boolean}. Drawing, wielding, or wearing normally equips; sheathing, stowing, or taking off normally unequips. Never mutate inventory from a mere mention, observation, price, request, offer, temporary use, or speculation.
Each event must contain: type, description, a short verbatim excerpt, participantIds, confidence from 0 to 1, and operations.
Allowed operations:
{"type":"fact","proposition":{"subjectId":"id","predicate":"stable-key","object":any},"confidence":0.0}
{"type":"awareness","subjectId":"id","targetId":"id","confidence":0.0}
{"type":"knowledge","subjectId":"id","proposition":{"subjectId":"id","predicate":"stable-key","object":any},"acquisition":"participant|witness|reported|inferred","confidence":0.0,"accessibility":"available|suppressed|inaccessible"}
{"type":"belief","subjectId":"id","proposition":{"subjectId":"id","predicate":"stable-key","object":any},"confidence":0.0}
{"type":"memory","subjectId":"id","summary":"durable personal memory","salience":0.0,"accessibility":"available|suppressed|inaccessible"}
{"type":"relationship","sourceEntityId":"id","targetEntityId":"id","dimension":"trust|fear|respect|affection|hostility|debt|loyalty|overall","title":"current relationship title when explicitly changed","value":number,"description":"current subjective description"}
Awareness means the subject demonstrably knows the target exists through interaction, recognition, testimony, discovery, conscious possession, or a relationship. Presence in the same scene is insufficient. Directly acquired information may become knowledge. Unverified claims normally become beliefs. Group knowledge requires explicit collective communication, an official report, meeting, archive, or equivalent. Do not union member knowledge. Record memory only for identity, goals, emotional impact, material consequence, or likely future use. Ignore repeated knowledge and memories already present in currentPerspectiveState. Relationship values are directional and absolute current values; do not change them for isolated politeness, rudeness, mood, or speculation. Do not report atmosphere, repetition, casual dialogue, hypotheticals, private thoughts unavailable to a subject, or out-of-character instructions. Empty arrays and an empty scenePatch are correct.`;

const NARRATIVE_SCOPED_BASE_PROMPT = `You are Kallamo's Narrative State interpreter. Never write narrative prose. Analyze only routing.selectedDomains. Extract explicit durable consequences from the user action and final narrative. Candidate signals are hints, not facts. Use only supplied IDs and resource keys.
Return JSON only with {"newEntities":[],"resourceChanges":[],"scenePatch":{},"inventoryChanges":[],"events":[]}. Leave every unselected domain empty. The user message is the player character's chosen action. The narrative response contains world and NPC consequences. Never invent a player choice, line, intention, emotion, memory, or private thought. Empty arrays and an empty scenePatch are correct.`;

const NARRATIVE_ENTITY_SCOPED_PROMPT = `ENTITY DOMAIN: Retain a newly introduced persistent individual absent from availableEntities as either an established identity or a sparse candidate. Return {"referenceId":"new:stable-local-key","name":"canonical name or concise sparse label","type":"Characters|Creatures|Locations|Items","aliases":[],"description":"explicit introduction facts","excerpt":"short verbatim evidence","confidence":0.0,"decision":"new|ambiguous|conflicting","identityEstablished":true|false,"reason":"brief","itemNature":"unique|type"}. Set identityEstablished true only for a proper name, stable title, number, designation, unmistakable continuity identity, or explicit registration. Appearance, ancestry, clothing, age, expression, or scene position alone means false. Anonymous individuals with false remain sparse and reviewable; they do not become Worldbuild entities automatically. Use referenceId elsewhere. Do not create crowds, ordinary item mentions, aliases, disguises, transformations, or duplicates.`;

const NARRATIVE_SCENE_SCOPED_PROMPT = `SCENE DOMAIN: scenePatch may contain locationId, participantIds, possibleObserverIds, nearbyIds, and objectIds. Return complete replacement arrays only for fields that changed. Participants are directly involved, possible observers can witness, nearby entities are in the broader location, and objects are physically present. Explicit arrivals, departures, joining a conversation, sitting with the group, leaving, and deliberate movement can change scene membership. When inventory is also selected, dropping a unique item may add it to objectIds, while picking up, consuming, destroying, or removing it may remove it. Keep unrelated existing objectIds. Change location only when movement is explicit and use reachableLocationIds. Presence is not ownership or knowledge.`;

const NARRATIVE_RESOURCE_SCOPED_PROMPT = `RESOURCE DOMAIN: resourceChanges contain {"entityId":"id","resourceKey":"key","value":absolute-number}. Use currentResourceStates and return the absolute result. Apply only explicit mechanical gains, losses, recovery, damage, or expenditure. Prices, wages, comparisons, plans, hypotheticals, and narration without an actual value change are not resource changes.`;

const NARRATIVE_INVENTORY_SCOPED_PROMPT = `INVENTORY DOMAIN: Track explicit pickup, drop, deliberate placement, gift, transfer, theft, loss, consumption, destruction, equip, unequip, drawing, sheathing, and quantity changes. currentInventoryState and currentLocationInventoryState are the pre-turn truth.
For a unique item move return {"itemId":"id","fromHolderId":"id-or-null","toHolderId":"id-or-null","locationId":"id-or-null","equipped":boolean-when-explicit}. It has exactly one holder or location. Dropping or deliberately leaving it uses locationId. Loss, consumption, or destruction with no destination uses null targets.
For an item type transfer return {"itemId":"id","fromHolderId":"id-or-null","fromLocationId":"id-or-null","toHolderId":"id-or-null","locationId":"id-or-null","quantity":positive-integer,"equipped":boolean-when-explicit}. fromLocationId means pickup; locationId means dropped or stored. Consumption or loss removes quantity without adding a destination.
For equipment only return {"itemId":"id","holderId":"id","equipped":boolean}. Drawing, wielding, wearing, or putting on a carried item normally equips it. Sheathing, stowing, taking off, or putting away normally unequips it without changing holder. A transfer from an equipped holder includes equipped:false; equipping by the recipient uses equipped:true.
Do not mutate inventory from seeing, discussing, pricing, offering, requesting, touching, or temporary use unless possession, placement, quantity, or equipped state explicitly changes. Never invent an item ID.`;

const NARRATIVE_EPISTEMIC_SCOPED_PROMPT = `EPISTEMIC DOMAINS: preTurnContext is the scoped epistemic manifest used for generation. "undetermined" is not ignorance. "derived" and "evidence-candidate" are not automatically canon. currentKnowledgeCards groups Awareness and known fields by card. currentPerspectiveState contains relevant current records.
Each event contains type, description, a short verbatim excerpt, participantIds, confidence from 0 to 1, and operations. Allowed operations:
{"type":"fact","proposition":{"subjectId":"id","predicate":"stable-key","object":any},"confidence":0.0}
{"type":"awareness","subjectId":"id","targetId":"id","confidence":0.0}
{"type":"knowledge","subjectId":"id","proposition":{"subjectId":"id","predicate":"stable-key","object":any},"acquisition":"participant|witness|reported|inferred","confidence":0.0,"accessibility":"available|suppressed|inaccessible"}
{"type":"belief","subjectId":"id","proposition":{"subjectId":"id","predicate":"stable-key","object":any},"confidence":0.0}
{"type":"memory","subjectId":"id","summary":"durable personal memory","salience":0.0,"accessibility":"available|suppressed|inaccessible"}
{"type":"relationship","sourceEntityId":"id","targetEntityId":"id","dimension":"trust|fear|respect|affection|hostility|debt|loyalty|overall","title":"current relationship title when explicitly changed","value":number,"description":"current subjective description"}
Awareness requires demonstrated interaction, recognition, testimony, discovery, conscious possession, or a relationship. Shared presence is insufficient. Direct information may become knowledge; unverified claims normally become beliefs. Group knowledge requires explicit collective communication or a shared source. Do not union member knowledge. Record memory only for identity, goals, emotional impact, material consequence, or likely future use. Ignore existing records. Relationship values are directional absolute current values; isolated mood, politeness, or rudeness is not durable.`;

function buildNarrativeStateSystemPrompt(domains) {
    if (domains.length >= 4) {
        return `${NARRATIVE_FULL_STATE_SYSTEM_PROMPT}\nSelected domains: ${domains.join(', ')}. Leave unselected domains empty.`;
    }
    const sections = [NARRATIVE_SCOPED_BASE_PROMPT];
    if (domains.includes('entity')) sections.push(NARRATIVE_ENTITY_SCOPED_PROMPT);
    if (domains.includes('scene')) sections.push(NARRATIVE_SCENE_SCOPED_PROMPT);
    if (domains.includes('resource')) sections.push(NARRATIVE_RESOURCE_SCOPED_PROMPT);
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
    try {
        return await sendApiRequest({ ...params, jsonMode: true, jsonSchema: schema });
    } catch (error) {
        const errorText = String(error.message || '');
        if (!/response.?format|json.?mode|structured output|output_config.*(unsupported|not supported)|compiled grammar.*too large|tool schemas?.*too large/i.test(errorText)) {
            throw error;
        }
        console.warn(`[${label}] Structured output unavailable; retrying with prompt validation:`, error.message);
        const isSchemaSizeFailure = /compiled grammar.*too large|tool schemas?.*too large/i.test(errorText);
        narrativeStructuredOutputUnavailable.add(isSchemaSizeFailure ? schemaCapabilityKey : globalCapabilityKey);
        if (telemetry) {
            telemetry.structuredFallbacks += 1;
            telemetry.structuredFallbackStages.push(label);
            telemetry.structuredOutputMode = 'prompt-fallback';
        }
        return sendApiRequest({ ...params, jsonMode: false, jsonSchema: null });
    }
}

function repairNarrativeJson({ executor, invalidResponse, schema, label, telemetry }) {
    return sendNarrativeJson({
        apiProfileId: executor.apiProfileId,
        model: executor.model,
        systemPrompt: NARRATIVE_REPAIR_SYSTEM_PROMPT,
        chatHistory: [],
        newPrompt: `INVALID RESPONSE:\n${String(invalidResponse || '').slice(0, 16000)}`,
        temperature: 0,
        maxTokens: 8192,
        manualMode: false,
        manualJson: null
    }, schema, `${label} repair`, telemetry);
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

function findReachableLocations(originId, links, maxDepth) {
    if (!originId) return new Set();
    const reachable = new Set([originId]);
    let frontier = [originId];
    for (let depth = 0; depth < maxDepth && frontier.length; depth += 1) {
        const next = [];
        for (const id of frontier) {
            for (const link of links) {
                const neighbor = link.fromId === id ? link.toId : link.toId === id ? link.fromId : null;
                if (neighbor && !reachable.has(neighbor)) {
                    reachable.add(neighbor);
                    next.push(neighbor);
                }
            }
        }
        frontier = next;
    }
    return reachable;
}

function chunkValues(values, size) {
    const chunks = [];
    for (let index = 0; index < values.length; index += size) chunks.push(values.slice(index, index + size));
    return chunks;
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

function entityEnrichmentMaxTokens(entity) {
    const currentLoreLength = String(entity.type === 'System' ? entity.data?.content || '' : entity.lore || '').length;
    const minimum = entity.type === 'System' ? 2400 : 1800;
    const maximum = entity.type === 'System' ? 5000 : 4000;
    return Math.min(maximum, Math.max(minimum, 1200 + Math.ceil(currentLoreLength / 3.5)));
}

// The entity-to-entity edges the enrichment may propose per type, mirroring the relation
// controls the WorldbuildView renders. `relType`/`single`/`labeled` match entities.setLink;
// `from` says which end of the edge the entity sits on ('self' = fromId is this entity,
// 'target' = fromId is the linked entity, e.g. an item owned_by a character). `targetType`
// narrows name resolution. Only EXISTING entities are linked, enrichment never creates
// new ones (only the tagger does that, when allowed). Derived-only relations (Race
// members) are omitted.
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
        { key: 'relationships', label: 'Relationship', relType: 'related_to', targetTypes: ['Characters', 'Creatures'], from: 'self', single: false, labeled: true, detailed: true, individualOnly: true },
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
    const operationsByOwner = new Map();
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
            operations.push({ type: 'memory', subjectId: ownerId, summary: change.value, salience: 0.8, accessibility });
        } else if (change.kind === 'knowledge' || change.kind === 'belief') {
            const aboutId = resolveTarget(change.targetId, change.target) || ownerId;
            if (!aboutId || !change.value) continue;
            const proposition = { subjectId: aboutId, predicate: 'worldbuild-statement', object: change.value };
            if (change.kind === 'knowledge') {
                operations.push({ type: 'knowledge', subjectId: ownerId, proposition, acquisition: method, confidence, accessibility });
            }
            else operations.push({ type: 'belief', subjectId: ownerId, proposition, confidence });
        } else if (change.kind === 'relationship') {
            const targetId = resolveTarget(change.targetId, change.target);
            if (!targetId || targetId === ownerId || !change.sourcePerspective) continue;
            const title = normalizeRelationshipLabel(change.targetRole);
            if (!title) continue;
            operations.push({
                type: 'relationship',
                sourceEntityId: ownerId,
                targetEntityId: targetId,
                dimension: change.key || 'overall',
                title,
                value: Math.max(-100, Math.min(100, Math.round(change.score || 0))),
                description: change.sourcePerspective,
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
    const { NarrativeStateSystem } = require('../../dist-main/main/features/kanora/narrative-state');
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

function relationCandidates(all, entity, spec) {
    const targetTypes = spec.targetTypes || [spec.targetType];
    return all.filter(candidate => candidate.status !== 'proposed'
        && candidate.id !== entity.id
        && targetTypes.includes(candidate.type)
        && !(candidate.type === 'Creatures' && (candidate.data?.scope || 'individual') === 'group'));
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

function selectEntityEvidence(entries, budget = 5000) {
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

// The "Update entities" enrichment pass. Reads each non-locked, confirmed entity's
// related chunks in chronological order and lets the System AI refresh the fields valid
// for that entity type and its links to existing entities. System entities update Concept
// instead of Lore. Linking a dedicated lore document remains an explicit user decision;
// ordinary mentions stay in the World Index and never become linked lore documents.
// Per-entity aiPolicy governs writes: 'open' applies everything directly,
// 'review' stages it all into data._enrichPending for per-item accept/reject in the sheet
// (never touches live values), 'locked' is skipped. Best-effort; one failure never aborts.
async function enrichEntities(workspaceId, progressCallback = null) {
    if (!workspaceId) throw new Error('workspaceId is required');
    // Entity enrichment is a precise-extraction task; it runs on the dedicated System AI
    // only, never on a writing profile. No System AI → the feature is unavailable.
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
    let canonicalSuggestionCount = 0, kanoraSuggestionCount = 0;
    let evidenceUsed = 0, taggedEvidenceRemaining = 0, textMatchesDeferred = 0;
    let emptyFieldsExamined = 0, emptyFieldSuggestions = 0;
    let emptyFieldsWithoutSupport = 0, emptyFieldsAwaitingEvidence = 0;
    let consecutiveStructuredFailures = 0;
    let processedEntities = 0;
    let stoppedEarly = false;
    for (let i = 0; i < targets.length; i++) {
        if (shouldStopEntityUpdates(consecutiveStructuredFailures)) {
            stoppedEarly = true;
            console.error('[Enrich] Stopped after three consecutive structured response failures. Unprocessed evidence remains pending.');
            break;
        }
        const ent = targets[i];
        processedEntities++;
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
                value,
                access: field.aiAccess,
                ...(field.aiGuidance ? { guidance: field.aiGuidance } : {})
            };
        }

        const evidencePrefix = crypto.randomBytes(2).toString('hex');
        const evidenceExample = `E_${evidencePrefix}_1`;
        const evidenceEntries = chunks.map((chunk, index) => ({
            id: `E_${evidencePrefix}_${index + 1}`,
            order: index,
            chunk,
            prompt: `[E_${evidencePrefix}_${index + 1} | ${chunk.evidenceSource}: ${chunk.source || 'Untitled'} | ${chunk.isTagged ? 'indexed entity match' : 'name or alias match'} | chunk ${chunk.id}]\n${chunk.text}`
        }));
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
        const narrativeEntityContext = all
            .filter(candidate => candidate.status !== 'proposed' && (
                candidate.id === ent.id
                || relatedIds.has(candidate.id)
                || textMentionsEntity(evidenceWindow, entityMentionNames(candidate))
            ))
            .slice(0, 60)
            .map(candidate => `- ${candidate.canonicalName}: ${candidate.id}`)
            .join('\n');

        const allowLore = ent.type !== 'System';
        const responseShape = `{"changes":[{"kind":"field","key":"<allowed field key>","value":"<JSON encoded value>","subjectId":"","targetId":"","perspectiveOwnerId":"","target":"","targetRole":"","sourcePerspective":"","score":0,"method":"","accessibility":"","support":"<direct support>","evidence":["${evidenceExample}"]}]}`;
        const systemPrompt =
            getSystemLanguageInstruction() + "\n" +
            `You maintain a story's world bible. Update the record for one ${ent.type.replace(/s$/, '')} named "${ent.canonicalName}" ` +
            `using the CURRENT RECORD plus ONLY the NEW STORY EVIDENCE provided. Extract supported changes and narrative findings; lore is composed in a separate step.\n` +
            `Return one valid JSON object and nothing else. Use {"changes":[]} when nothing should change. Every change uses this fixed shape:\n${responseShape}\n` +
            `All keys are required. Use an empty string or 0 for fields that do not apply. Encode field values as JSON inside value: plain text remains plain text, numbers use "12", booleans use "true", and lists use "[\\"one\\",\\"two\\"]". ` +
            `Kinds: field, link, fact, awareness, knowledge, belief, memory, relationship. Never output angle-bracket placeholders.\n` +
            `ENTITY TYPE CONTRACT:\n${ENRICH_TYPE_GUIDANCE[ent.type] || 'A persistent canonical world entity.'}\n` +
            (fieldLines ? `Allowed data fields:\n${fieldLines}\n` : '') +
            (relBlocks.length ? `Allowed links (use the exact candidate names, never invent a name):\n${relBlocks.map(b => b.line).join('\n')}\n` : '') +
            `STRICT RULES:\n` +
            `- Fill a field or propose a link ONLY when the passages state it explicitly and unambiguously. When unsure, omit it — returning few or no fields is correct and expected.\n` +
            `- Every proposed change must cite one or more supplied evidence IDs. Never cite an ID that does not support the exact change.\n` +
            `- Set certainty to "explicit" only when the evidence directly entails the exact value or relation. Inference, implication, symbolism, genre convention, probability, and interpretation are not explicit. Omit anything that is not explicit.\n` +
            `- Do not return unchanged fields or unchanged links. An empty changes array is correct when the new evidence changes nothing.\n` +
            `- Existing values are canonical context, not protected blanks. When new explicit evidence changes an existing value, propose the replacement and explain the direct support. Never replace a value merely to rephrase it.\n` +
            `- EMPTY FIELD COVERAGE: inspect every field marked EMPTY and fill every one directly supported by the supplied evidence. Do not omit a supported empty field merely to be cautious. If no supplied evidence establishes its value, omit it rather than inventing a placeholder.\n` +
            `- Never infer, estimate, or compute a value. Numeric fields require the explicit resulting absolute value. A delta such as "+1", "-2", "gained 1", or "increased by 2" is not a field value unless the evidence also states the resulting total. Never replace a newer canonical number with an older progression value.\n` +
            `- Persistent fields contain durable canonical characteristics. Do not place a temporary pose, scene location, passing emotion, current lighting, momentary clothing, or short-lived injury into appearance, personality, disposition, description, or another lasting field.\n` +
            `- Only link two entities when the text directly establishes that exact relation. In particular, only nest a location inside another when the passages explicitly say one place is physically within the other — never by mere association or proximity.\n` +
            `- RELATIONSHIP DIRECTION: SOURCE is always the current record (${ent.canonicalName}); TARGET is the named related entity. targetRole must state what TARGET is to SOURCE (Kaelen to Mara: targetRole "Daughter"; Mara to Kaelen: targetRole "Father"). value and sourcePerspective describe only how SOURCE feels about and relates to TARGET. Never return TARGET's feelings toward SOURCE. The reciprocal direction belongs exclusively to TARGET's own record.\n` +
            `- Every narrative change must state ownership explicitly. subjectId is the entity whose mind, memory, knowledge, belief, fact, or perspective owns the change. perspectiveOwnerId must equal subjectId for relationships. targetId is the existing entity the statement or relationship is about. Use the IDs from the candidate context, never infer ownership from the current record.\n` +
            `- Awareness requires evidence that the perspective owner knows the target exists. Documentary extraction alone never grants it.\n` +
            `- For knowledge, belief, and memory, put the statement or summary in value. For knowledge and belief, target must be the exact existing entity the proposition is primarily about, not a location, group, or concept merely mentioned in the sentence.\n` +
            `- KNOWLEDGE requires evidence of how subjectId acquired the proposition inside the story: direct participation, direct witnessing, or explicit communication/reporting. The update model inferring something while reading a document is never character Knowledge. Biography, public canon, self-description, predictions, private information unavailable to the subject, and documentary analysis are not new Knowledge. Use belief for an explicitly evidenced in-story belief; otherwise omit the change. Never use method "inferred" for Knowledge.\n` +
            (ent.type === 'Characters'
                ? `- Never return fact for a Character update. Global canonical Facts belong to the workspace Fact registry, not to a character sheet.\n`
                : `- Use fact for an explicit canonical proposition. Put a concise predicate in key, the proposition in value, and its existing subject name in target.\n`) +
            `- Use relationship only for a directional relationship update backed by the evidence. targetRole says what TARGET is to SOURCE; sourcePerspective describes SOURCE's perspective. score is from -100 to 100.\n` +
            `- CANONICAL SYSTEM / CONCEPT CONTEXT defines setting-specific terms. Use it to interpret evidence, but do not copy a concept's facts into this entity unless the evidence explicitly connects them.\n` +
            `Do not invent facts, names, or fields absent from the passages.`;
        const userPromptPrefix =
            `${allowLore ? 'CURRENT RECORD' : 'CURRENT CONCEPT'}:\nName: ${ent.canonicalName}\nAliases: ${ent.aliases?.join(', ') || '(none)'}\n` +
            (ent.type === 'Items' ? `Item nature: ${(ent.data?.itemNature || 'type') === 'unique' ? 'unique item (one persistent object; may have one owner or current location)' : 'item type (repeatable category; may have abundance and availability locations, never one fixed owner or current location)'}\n` : '') +
            (allowLore ? `Lore: ${ent.lore ? ent.lore : '(no lore yet)'}\n` : '') +
            (Object.keys(currentData).length ? `Current fields: ${JSON.stringify(currentData)}\n` : '') +
            (Object.keys(currentCustomFields).length ? `Current custom fields (read-only fields are context and must never be proposed): ${JSON.stringify(currentCustomFields)}\n` : '') +
            (currentLinks.length ? `Current links and relationships: ${JSON.stringify(currentLinks)}\n` : '') +
            (narrativeEntityContext ? `\nENTITY IDS FOR NARRATIVE FINDINGS:\n${narrativeEntityContext}\n` : '') +
            (systemContext ? `\nCANONICAL SYSTEM / CONCEPT CONTEXT:\n${systemContext}\n` : '');
        const buildUserPrompt = evidence => `${userPromptPrefix}\nNEW STORY EVIDENCE (chronological):\n${evidence}`;

        try {
            const maxTokens = entityEnrichmentMaxTokens(ent);
            const jsonSchema = buildEntityUpdateSchema();
            let inputTokenEstimate = 0;
            let outputTokenEstimate = 0;
            let retryCount = 0;
            const sendJsonRequest = async (params, schema = jsonSchema) => {
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
                const firstFailure = parsed
                    ? 'The System AI returned JSON using an unsupported entity update shape.'
                    : describeStructuredObjectFailure(response, fence);
                const retryTokens = Math.min(8000, Math.max(maxTokens, Math.ceil(maxTokens * 1.5)));
                if (responseResult.truncated) {
                    retryCount++;
                    const reducedEvidence = selectEntityEvidence(evidenceEntries, 2500).map(entry => entry.prompt).join('\n\n');
                    responseResult = await requestUpdate(buildUserPrompt(reducedEvidence), retryTokens);
                } else {
                    retryCount++;
                    responseResult = await repairUpdate(response, retryTokens);
                }
                response = responseResult.content;
                head = splitHeadAndBody(response, fence);
                parsed = parseEntityUpdateObject(head.body).value || parseEntityUpdateObject(response).value;
                if (!isEntityUpdateShape(parsed)) {
                    failed++;
                    consecutiveStructuredFailures++;
                    const retryFailure = parsed
                        ? 'The System AI returned JSON using an unsupported entity update shape.'
                        : describeStructuredObjectFailure(response, fence);
                    const finish = responseResult.finishReason ? ` Finish reason: ${responseResult.finishReason}.` : '';
                    rememberFailure(ent, `${retryFailure} Automatic retry also failed.${finish} Response length: ${String(response || '').length}. First response: ${firstFailure}`);
                    updateState.transition(workspaceId, ent.id, includedEvidence, 'deferred', runId, 'invalid-structured-output');
                    updateState.updateJob(runId, ent.id, {
                        status: 'failed',
                        input_tokens: inputTokenEstimate,
                        output_tokens: outputTokenEstimate,
                        retry_count: retryCount,
                        evidence_used: includedEvidence.length,
                        error: retryFailure,
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
                if (String(raw.certainty || '').toLowerCase() !== 'explicit') return null;
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
                if (String(raw.certainty || '').toLowerCase() !== 'explicit') return null;
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
            const narrativeChanges = [...parsed.narrative, ...relationshipLinkChanges].filter(change =>
                !(ent.type === 'Characters' && change.kind === 'fact')
                &&
                change.support
                && change.evidence.some(id => validEvidenceIds.has(id))
            );
            let loreProposal = null;
            if (allowLore) {
                const canonicalFindings = [
                    ...Object.entries(proposedData).map(([key, proposal]) => ({ kind: 'field', key, value: proposal.value, support: proposal.support, evidence: proposal.evidence })),
                    ...Object.entries(parsed.links || {}).flatMap(([key, links]) => (Array.isArray(links) ? links : [links]).map(link => ({ kind: 'link', key, ...link }))),
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
                        const loreSystemPrompt = `${getSystemLanguageInstruction()}\nYou compose grounded cumulative world-bible lore from validated findings. Never invent or collapse an established entity into one event.`;
                        const lorePrompt = buildLorePrompt({
                            entityName: ent.canonicalName,
                            entityType: ent.type,
                            currentLore: ent.lore,
                            findings: canonicalFindings,
                            evidence: loreEvidence,
                        });
                        const loreResult = await sendJsonRequest({
                            apiProfileId,
                            model,
                            systemPrompt: loreSystemPrompt,
                            chatHistory: [],
                            newPrompt: lorePrompt,
                            temperature: 0.1,
                            maxTokens,
                            manualMode,
                            manualJson,
                        }, buildEntityLoreSchema());
                        const loreObject = parseEntityUpdateObject(loreResult.content).value;
                        loreProposal = validateEntityLore(loreObject, ent.lore, validEvidenceIds);
                    } catch (error) {
                        console.warn(`[Enrich] Lore composition skipped for ${ent.canonicalName}:`, error.message);
                    }
                }
            }
            const incomingLore = loreProposal?.value || '';
            const loreChanged = Boolean(loreProposal);

            // Resolve the AI's link proposals: only listed candidate names, resolved to real
            // ids of the right type, excluding self and edges that already exist.
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
                    if (String(item.certainty || '').toLowerCase() !== 'explicit') continue;
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
                    const existingLink = existing.get(targetId);
                    const metadata = spec.detailed ? normalizeDirectionalRelationship(item, ent.canonicalName) : undefined;
                    if (spec.detailed && !metadata) continue;
                    if (existingLink && !spec.detailed) continue;
                    if (existingLink && spec.detailed
                        && (label || null) === (existingLink.label || null)
                        && metadata.value === Number(existingLink.metadata?.value || 0)
                        && metadata.description === String(existingLink.metadata?.description || '').trim()) continue;
                    const dedupe = `${targetId}:${label || ''}`;
                    if (seen.has(dedupe)) continue;
                    seen.add(dedupe);
                    proposedLinks.push({ relKey: spec.key, relLabel: spec.label, relType: spec.relType, from: spec.from, single: !!spec.single, label, metadata, existingLinkId: existingLink?.linkId, targetId, targetName: name, evidence, support });
                    if (spec.single) break; // one target for single-valued relations
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
            const hasChange = hasCanonicalChange || narrativeSuggestion?.record;
            evidenceUsed += includedEvidence.length;
            taggedEvidenceRemaining += pendingTaggedEvidence.length;
            textMatchesDeferred += skippedTextualEvidence.length;
            const canonicalProposalCount = Object.keys(proposedData).length
                + proposedLinks.length
                + (loreChanged ? 1 : 0);
            const narrativeProposalCount = (narrativeSuggestion?.records || [])
                .reduce((total, record) => total + (record?.proposal?.changeSet?.operations?.length || 0), 0);
            const proposalCount = canonicalProposalCount + narrativeProposalCount;
            canonicalSuggestionCount += canonicalProposalCount;
            kanoraSuggestionCount += narrativeProposalCount;
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
            if (!hasChange) {
                finishEntity(false);
                clearEnrichmentError.run(workspaceId, ent.id);
                continue;
            }
            if (!hasCanonicalChange) {
                staged++;
                finishEntity(true);
                clearEnrichmentError.run(workspaceId, ent.id);
                continue;
            }

            if (policy === 'open') {
                // Apply everything directly. Only touch what changed, and clear any staged
                // review left over from when this entity was on the 'review' policy.
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
                // Review stages everything for per-item accept/reject without touching live values.
                // Preserve unresolved review items while adding evidence from new chunks.
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
    const runStatus = stoppedEarly || failed ? (processedEntities > failed ? 'partial' : 'failed') : 'completed';
    const tokenUsage = updateState.finishRun(runId, runStatus);
    return {
        runId, entities: targets.length, processedEntities, updated, staged, upToDate, noEvidence,
        failed, failures, evidenceUsed, taggedEvidenceRemaining, textMatchesDeferred,
        canonicalSuggestionCount, kanoraSuggestionCount, emptyFieldsExamined,
        emptyFieldSuggestions, emptyFieldsWithoutSupport, emptyFieldsAwaitingEvidence,
        stoppedEarly, remaining: targets.length - processedEntities, tokenUsage
    };
}

async function executeSummarizationInternal({ chatId, selectedMessages, newSummarizedIndex, customTitle, profileId }) {
    const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId);
    if (!chat) throw new Error("Chat not found");

    const rawTextToArchive = selectedMessages.map(m => `${m.role.toUpperCase()}: ${m.content}`).join('\n\n');
    const blockId = `block_${Date.now()}`;

    // Narrative memory reads better with fuller scene context per chunk than the old
    // 500-char fragments, so archive chat memory at ~800 (still under the 1000 KB
    // default to keep some retrieval precision). Changing this needs a re-index.
    const chunks = chunkText(rawTextToArchive, 800);
    const vectors = await vectorizeChunks(chunks, "Chat Archive");
    vectors.forEach(v => v.blockId = blockId);

    const shouldSummarize = isChatArchiveSummarizationEnabled();
    let title = customTitle || "Chat Archive";
    let summary = '';

    // Persist the raw chunks first so they have ids to tag (verbatim tier).
    try {
        insertChunksToDb(chatId, 'chat_memory', vectors);
    } catch (dbErr) {
        console.error("Failed to insert summarized vectors to SQLite:", dbErr);
    }

    if (shouldSummarize) {
        try {
            const result = await summarizeArchiveSegment(rawTextToArchive);
            if (!customTitle && result.title) title = result.title;
            summary = result.summary || '';
        } catch (smErr) {
            console.error("[Summarizer] archive summary failed (archiving continues):", smErr);
        }
    }

    const chunkRecords = vectors.map(v => ({ id: v.id, text: v.text }));
    try {
        const taggedResult = await classifyAndTagSegment(chunkRecords, null, chatId);
        const tagged = applyChunkTags(taggedResult.chunkTags, chunkRecords, chatId);
        console.log(`[Tagger] archive segment: ${taggedResult.chunkTags.length}/${chunkRecords.length} chunk(s) tagged, ${tagged} tag row(s).`);
    } catch (tagError) {
        console.error("[Tagger] archive tagging failed (archiving continues):", tagError);
    }

    let memoryBlocks = [];
    if (chat.memoryBlocks) {
        memoryBlocks = typeof chat.memoryBlocks === 'string' ? JSON.parse(chat.memoryBlocks) : chat.memoryBlocks;
    }
    memoryBlocks.push({ id: blockId, title, summary, type: 'summarized', messages: selectedMessages });

    db.prepare('UPDATE chats SET summarizedIndex = ?, memoryBlocks = ? WHERE id = ?').run(
        newSummarizedIndex,
        JSON.stringify(memoryBlocks),
        chatId
    );

    return { memoryBlocks, summarizedIndex: newSummarizedIndex };
}

async function checkAndAutoSummarize(chatId, profileId, webContents) {
    try {
        const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId);
        if (!chat || chat.autoSummarize !== 1) return;

        const archiveThreshold = chat.archiveThreshold || 60000;
        const summarizedIndex = chat.summarizedIndex || 0;

        const messages = db.prepare('SELECT * FROM messages WHERE chatId = ? ORDER BY createdAt ASC').all(chatId);
        const activeMessages = messages.slice(summarizedIndex);

        let tokensUsed = 0;
        activeMessages.forEach(m => {
            tokensUsed += estimateTokens(m.content);
        });

        if (tokensUsed > archiveThreshold) {
            console.log(`[Auto-Summarize] Active tokens (${tokensUsed}) exceed threshold (${archiveThreshold}). Notifying frontend to show selection modal...`);
            webContents.send('trigger-auto-summarize', { chatId, profileId });
        }
    } catch (e) {
        console.error("Auto-summarization failed:", e);
    }
}

function readEntireKbFile(ownerId, fileName) {
    try {
        const rows = db.prepare('SELECT text FROM knowledge_chunks WHERE ownerId = ? AND source = ? ORDER BY id ASC').all(ownerId, fileName);
        if (rows.length === 0) return "[System: File not found or has no content.]";
        return rows.map(r => {
            const lines = r.text.split('\n');
            if (lines[0] && lines[0].startsWith('Document: ') && lines[1] && lines[1].startsWith('Content: ')) {
                return lines.slice(2).join('\n');
            }
            return r.text;
        }).join('\n\n');
    } catch (e) {
        console.error("Error reading entire KB file from database:", e);
        return `[System: Error reading file: ${e.message}]`;
    }
}

// --- AGENTIC RAG SYSTEM ---

async function executeAgenticRagLoop(
    profile,
    chatId,
    currentInput,
    chatHistory = [],
    webContents = null,
    includeChatContext = true,
    executor = profile,
    maxPayloadTokens = null,
    run = null
) {
    console.log(`[Agentic RAG] Starting autonomous retrieval loop for: ${profile.name}`);
    const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId);
    const experienceMode = db.prepare('SELECT mode FROM workspace_experience_modes WHERE workspace_id = ?').get(chatId)?.mode;
    let epistemicTools = null;
    let awarenessOverview = '';
    if (experienceMode === 'roleplay') {
        try {
            const { AgenticEpistemicTools } = require('../../dist-main/main/features/kanora/agentic-epistemic-tools');
            epistemicTools = new AgenticEpistemicTools(db);
            awarenessOverview = epistemicTools.scanSceneAwareness(chatId, currentInput);
        } catch (error) {
            console.warn('[Agentic RAG] Awareness scan unavailable:', error.message);
        }
    }

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
    const retrievedNarrativeOptions = new Map();
    const readFiles = new Map();

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

    // World map: the known entities of this chat's world index. Giving the agent the
    // exact canonical names stops it from guessing keywords and lets it pull a full
    // dossier via lookup_entity. Only names + aliases are injected (cheap); omitted
    // entirely when the world has no tagged entities yet, so no empty section leaks.
    let worldMapBlock = '';
    try {
        // List the curated Worldbuild entities for this workspace straight from the
        // registry (not only entities that happen to be tagged in chat memory), so the
        // agent knows the full canonical vocabulary of the world even before anything
        // has been summarized/tagged.
        const known = includeChatContext
            ? entitiesStore.listEntities({ workspaceId: chatId })
            : [];
        if (known.length > 0) {
            const lines = known.slice(0, 60).map(e => {
                const aka = (e.aliases && e.aliases.length) ? ` (aka ${e.aliases.join(', ')})` : '';
                return `- ${e.canonicalName} [${e.type}]${aka}`;
            }).join('\n');
            worldMapBlock = `\nKNOWN ENTITIES IN THIS WORLD (use these EXACT names in your queries; use lookup_world_entity for narrator-authority facts and inspect_subject_knowledge for one subject's knowledge):\n${lines}\n`;
        }
    } catch (e) { }
    const awarenessBlock = awarenessOverview
        ? `\nSCENE AWARENESS OVERVIEW (cheap first pass; deepen only relevant subject-target pairs):\n${awarenessOverview}\n`
        : '';

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
${awarenessBlock}
AVAILABLE TOOLS:
1. <tool_call name="search_kb" query="search terms" />
   Searches the profile's and chat's knowledge base files for matching concepts.
2. <tool_call name="read_file" filename="filename.txt" />
   Reads the entire text of a specific file in the knowledge base (useful to get complete code or full lore/character profile).
3. <tool_call name="search_memories" query="search terms or #tags" />
   Searches the chat's past summarized memory blocks, custom snippets, and manual tags (e.g. query for keywords or exact hashtags like #character, #backstory).
4. <tool_call name="lookup_world_entity" query="entity name or alias" />
   Retrieves narrator-authority Worldbuild facts, lore, current fields, and structural relations. This does not imply that any character knows those facts. Follow a listed relation with another lookup_world_entity call only when the related entity matters to the current scene.
5. <tool_call name="read_lore" query="entity name or alias" />
   For an entity that has a linked lore document (Writing Desk), returns the passages of that document most relevant to the user prompt. Use it when lookup_world_entity shows authored lore and you need canonical background, not just scene mentions. Does nothing if the entity has no linked lore.
6. <tool_call name="scan_scene_awareness" query="current" />
   Re-reads the compact Awareness map for the player, scene actors, possible observers, and nearby characters.
7. <tool_call name="inspect_subject_knowledge" query="subject name | target name" />
   Deepens one subject-target pair into known fields and active knowledge or beliefs. Use only when Awareness is insufficient for this scene.
8. <tool_call name="inspect_subject_evidence" query="subject name | target name" />
   Explains why one pair is confirmed, derived, evidence-candidate, explicitly unaware, or undetermined.
9. <tool_call name="inspect_subject_relationships" query="subject name" />
   Reads the subject's outgoing current relationships for private behavior planning.
10. <tool_call name="inspect_subject_memories" query="subject name | optional topic" />
   Reads only that subject's relevant active memories.
11. <tool_call name="expand" query="R3 or a source name" />
   Re-reads the FULL text of a previously retrieved item that was summarized in an earlier turn (results are shown by a handle like [R3 · source]). Use it only when a summarized item's snippet is not enough to decide. Everything you retrieve is already sent to the writing assistant in full — expand is just for YOUR reasoning.
12. <tool_call name="explore_worldbuild_options" query="Races | optional scene need" />
   Roleplay only. Retrieves a bounded palette from one registered Worldbuild category: System, Locations, Items, Races, Factions, Characters, Creatures, or Events. Options are narrator material, not facts already selected for the scene and not automatic character knowledge.
13. <finish sources="source1, source2, ...">summary of retrieved facts</finish>
   Concludes your research. Inside the 'sources' attribute, you MUST list the exact filenames, character names, or document names of the retrieved contexts that were ACTUALLY relevant and helpful to answer the user prompt. Only these sources will be kept in the final context.
   If no sources are listed or if you omit the attribute, all searched contexts will be included by default.
   
   CRITICAL SUMMARY RULE: Keep the text content inside the <finish> tag extremely short and concise (1-2 sentences maximum, e.g., "Found Jonathan's resume file"). DO NOT write a full summary, quote, or copy the content of the files/chunks inside the tag, as the system automatically retrieves and sends the full raw content of your listed sources to the writing assistant.

CRITICAL DIRECTIVES FOR COST & EFFICIENCY OPTIMIZATION:
- EARLY EXIT: If you have already found all the necessary details to answer the user's prompt (e.g., character relationships, specific descriptions, context), DO NOT run additional tool calls or turns. Immediately call <finish> to conclude your research and minimize token costs.
- NO REPETITIVE QUERIES: Do not run search queries with identical or very similar terms that you have already executed. Do not read the same file twice.
- RELEVANCY ONLY: Only query for concepts directly related to the user's prompt. Do not fetch unrelated files or memories.
${experienceMode === 'roleplay' ? `- CONTROLLED NARRATIVE ENRICHMENT: When the prompt asks the narrator to reveal, distinguish, or choose an undefined detail and a Worldbuild category can supply plausible options, call explore_worldbuild_options before finishing. Also retrieve scene, location, faction, or character canon needed to constrain the choice. Treat the palette as possibilities only. Do not use it for an already established fact, force variety, or assume every option fits the scene.` : ''}

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

    // The final answer is assembled from the retrieved* Maps below, so mid-loop the agent
    // only needs a coverage view, not the full text of every prior turn. Older turns are
    // compacted to a digest once the accumulated results exceed a token budget.
    const LEAN_AGENT_HISTORY = true;
    const LEAN_HISTORY_BUDGET_TOKENS = 1200;
    const LEAN_HISTORY_KEEP_TURNS = 1; // newest N turns are always kept in full
    const SNIPPET_CHARS = 160;
    const turnLog = [];               // { msgIndex, digestContent, fullTokens, digestTokens, downgraded }
    const itemRegistry = new Map();   // handle -> { source, full }, backs the expand tool
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
    const toolTrace = [];
    let stopReason = 'max-turns';

    while (currentTurn <= maxTurns && !finished) {
        throwIfRunCancelled(run);
        console.log(`[Agentic RAG] Turn ${currentTurn}/${maxTurns}`);
        sendRunEvent(webContents, 'workflow-progress', run, {
            profileName: profile.name,
            status: `Agentic RAG: Investigating... (Turn ${currentTurn}/${maxTurns})`
        });

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
                maxPayloadTokens,
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

            const KNOWN_TOOLS = [
                'search_kb', 'read_file', 'search_memories', 'lookup_entity', 'lookup_world_entity',
                'read_lore', 'scan_scene_awareness', 'inspect_subject_knowledge',
                'inspect_subject_evidence', 'inspect_subject_relationships',
                'inspect_subject_memories', 'explore_worldbuild_options', 'expand'
            ];

            // Tolerant tool_call parsing: self-closing or not, any quote style, any attribute order,
            // arg under several aliases, or as the element's inner text.
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
                stopReason = 'finished';

                if (sourcesAttr) {
                    const allowedSources = sourcesAttr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
                    console.log(`[Agentic RAG] Agent specified relevant sources:`, allowedSources);

                    const checkMatch = (chunk) => {
                        const sourceLower = (chunk.source || '').toLowerCase();
                        const textLower = (chunk.text || '').toLowerCase();

                        return allowedSources.some(src => {
                            const srcLower = src.toLowerCase();

                            if (sourceLower && sourceLower !== 'summarized history' && sourceLower !== 'chat archive') {
                                if (sourceLower.includes(srcLower) || srcLower.includes(sourceLower)) return true;
                            }

                            const docMatch = textLower.match(/^document:\s*([^\n]+)/);
                            if (docMatch) {
                                const docName = docMatch[1].trim();
                                if (docName.includes(srcLower) || srcLower.includes(docName)) return true;
                                const docNameClean = docName.replace(/_/g, ' ');
                                if (docNameClean.includes(srcLower) || srcLower.includes(docNameClean)) return true;
                            }

                            const memMatch = textLower.match(/^memory context\s*\[([^\]]+)\]/);
                            if (memMatch) {
                                const memTitle = memMatch[1].trim();
                                if (memTitle.includes(srcLower) || srcLower.includes(memTitle)) return true;
                            }

                            const firstLine = textLower.split('\n')[0] || '';
                            if (firstLine.includes(srcLower)) return true;

                            return false;
                        });
                    };

                    for (const [id, chunk] of retrievedProfileChunks.entries()) {
                        if (!checkMatch(chunk)) {
                            retrievedProfileChunks.delete(id);
                        }
                    }

                    for (const [filename, data] of readFiles.entries()) {
                        const filenameLower = filename.toLowerCase();
                        const matches = allowedSources.some(src =>
                            filenameLower.includes(src) ||
                            src.includes(filenameLower)
                        );
                        if (!matches) {
                            readFiles.delete(filename);
                        }
                    }

                    for (const [id, chunk] of retrievedChatChunks.entries()) {
                        if (!checkMatch(chunk)) {
                            retrievedChatChunks.delete(id);
                        }
                    }

                    for (const [id, chunk] of retrievedMemories.entries()) {
                        if (!checkMatch(chunk)) {
                            retrievedMemories.delete(id);
                        }
                    }

                    // Worldbuild facts prune by ENTITY IDENTITY, not fuzzy chunk matching:
                    // keep a fact if a listed source resolves to its own name/alias, or names
                    // a related entity that appears in the fact text (so "Aldous Finn" keeps
                    // the logbook fact that cites him). Drops facts for entities the agent
                    // looked up but did not deem relevant, so many-entity queries stay lean.
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
                    for (const [id, palette] of retrievedNarrativeOptions.entries()) {
                        const source = String(palette.source || '').toLowerCase();
                        const content = String(palette.text || '').toLowerCase();
                        const keep = allowedSources.some(candidate =>
                            source.includes(candidate) ||
                            candidate.includes(source) ||
                            content.includes(candidate)
                        );
                        if (!keep) retrievedNarrativeOptions.delete(id);
                    }
                }
                break;
            }

            // Malformed turn: neither a valid tool call nor a finish block. Instead of treating raw
            // THOUGHT text as the final answer (silent zero-retrieval failure), inject a correction
            // and retry once for free (without consuming a research turn).
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
                // Correction budget exhausted: stop, but do NOT pass the raw text off as retrieved facts.
                // Whatever was gathered in prior turns is preserved; the caller degrades gracefully (Item 5).
                console.warn('[Agentic RAG] Correction budget exhausted; finishing with whatever context was gathered.');
                finishResponse = '';
                finished = true;
                stopReason = 'malformed-output';
                break;
            }

            const turnItems = []; // { kind:'result', handle, source, full, meta } | { kind:'note', text }
            const pushResult = ({ source, full, meta }) => {
                const handle = `R${++handleSeq}`;
                itemRegistry.set(handle, { source, full });
                if (source) coveredSources.add(source);
                turnItems.push({ kind: 'result', handle, source: source || '?', full: full || '', meta: meta || '' });
                return handle;
            };
            const pushNote = (text) => turnItems.push({ kind: 'note', text });
            for (const call of toolCalls) {
                throwIfRunCancelled(run);
                console.log(`[Agentic RAG] Executing tool: ${call.name} with: "${call.arg}"`);
                const traceStartedAt = Date.now();
                const traceItemStart = turnItems.length;

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

                    profileResults.forEach(r => {
                        retrievedProfileChunks.set(r.id, {
                            text: r.text,
                            source: r.source,
                            relevance: r.fusionScore ?? r.score
                        });
                    });
                    if (includeChatContext) {
                        chatKbResults.forEach(r => {
                            retrievedChatChunks.set(r.id, {
                                text: r.text,
                                source: r.source,
                                relevance: r.fusionScore ?? r.score
                            });
                        });
                    }

                    const combined = [...profileResults, ...chatKbResults];

                    if (combined.length === 0) {
                        pushNote(`Tool [search_kb] for "${call.arg}": No matches found.`);
                    } else {
                        pushNote(`Tool [search_kb] for "${call.arg}": ${combined.length} result(s).`);
                        combined.forEach(r => pushResult({
                            source: r.source, full: r.text,
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
                        memResults.forEach(r => {
                            retrievedMemories.set(r.id, {
                                text: r.text,
                                source: r.source,
                                relevance: r.fusionScore ?? r.score
                            });
                        });
                    }

                    if (memResults.length === 0) {
                        pushNote(`Tool [search_memories] for "${call.arg}": No matches found.`);
                    } else {
                        pushNote(`Tool [search_memories] for "${call.arg}": ${memResults.length} match(es).`);
                        memResults.forEach(r => pushResult({
                            source: r.source, full: r.text,
                            meta: `search_memories "${call.arg}"${typeof r.score === 'number' ? ` sim=${r.score.toFixed(2)}` : ''}`
                        }));
                    }
                } else if (call.name === 'explore_worldbuild_options') {
                    if (experienceMode !== 'roleplay' || !includeChatContext) {
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
                            retrievedNarrativeOptions.set(palette.type, {
                                text: palette.content,
                                source: palette.source,
                                relevance: 1
                            });
                            pushResult({
                                source: palette.source,
                                full: palette.content,
                                meta: `explore_worldbuild_options "${call.arg}"`
                            });
                        }
                    }
                } else if (call.name === 'scan_scene_awareness') {
                    pushNote(epistemicTools
                        ? `Scene Awareness:\n${epistemicTools.scanSceneAwareness(chatId)}`
                        : 'Scene Awareness is unavailable outside Roleplay Mode.');
                } else if (call.name === 'inspect_subject_knowledge') {
                    pushNote(epistemicTools
                        ? epistemicTools.inspectSubjectKnowledge(chatId, call.arg)
                        : 'Subject Knowledge inspection is unavailable outside Roleplay Mode.');
                } else if (call.name === 'inspect_subject_evidence') {
                    pushNote(epistemicTools
                        ? epistemicTools.inspectSubjectEvidence(chatId, call.arg)
                        : 'Subject evidence inspection is unavailable outside Roleplay Mode.');
                } else if (call.name === 'inspect_subject_relationships') {
                    pushNote(epistemicTools
                        ? epistemicTools.inspectSubjectRelationships(chatId, call.arg)
                        : 'Subject relationship inspection is unavailable outside Roleplay Mode.');
                } else if (call.name === 'inspect_subject_memories') {
                    pushNote(epistemicTools
                        ? epistemicTools.inspectSubjectMemories(chatId, call.arg)
                        : 'Subject memory inspection is unavailable outside Roleplay Mode.');
                } else if (call.name === 'lookup_entity' || call.name === 'lookup_world_entity') {
                    // Dossier retrieval by known entity. Two sources, fused: (1) the curated
                    // Worldbuild registry (authored lore + relations), resolved directly so an
                    // entity that was never tagged in chat memory is still found; (2) the
                    // entity's tagged chat_memory chunks (scene mentions). Feeds retrievedMemories
                    // so pruning/dedup with search_memories is shared; respects includeChatContext.
                    let entityChunks = [], entityIds = [];
                    if (includeChatContext) {
                        const looked = lookupEntityChunks(call.arg, chatId, 'chat_memory');
                        entityChunks = filterWorkspaceMemoryResults(
                            looked.chunks || [],
                            chat?.memoryBlocks,
                            profile.id
                        );
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
                        entityChunks.forEach(r => {
                            retrievedMemories.set(r.id, {
                                text: r.text,
                                source: r.source,
                                relevance: r.fusionScore ?? r.score
                            });
                        });
                    }
                    // Outgoing relations for every resolved entity (registry + tagged), by
                    // structure. edgesByEntity keeps each entity's own edges so we can attach
                    // them to that entity's worldbuild fact.
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

                    // Persist the resolved entity's lore + relations as a deterministic
                    // worldbuild fact, shown in the final context and exempt from pruning.
                    if (registryEntity) {
                        const factParts = [];
                        const details = entityDataFacts(registryEntity.data);
                        if (details) factParts.push(`Details: ${details}`);
                        const desc = registryEntity.data && (registryEntity.data.description || registryEntity.data.content);
                        if (desc && String(desc).trim()) factParts.push(`Description: ${String(desc).trim()}`);
                        if (registryEntity.lore && String(registryEntity.lore).trim()) factParts.push(`Lore: ${registryEntity.lore}`);
                        const ownEdges = edgesByEntity.get(registryEntity.id);
                        if (ownEdges) factParts.push(`Relations: ${ownEdges}`);
                        const detailText = factParts.length ? ` — ${factParts.join(' | ')}` : '';
                        retrievedWorldFacts.set(registryEntity.id, {
                            text: `${registryEntity.canonicalName} (${registryEntity.type})${detailText}`,
                            source: `Worldbuild — ${registryEntity.canonicalName}`,
                            canonicalName: registryEntity.canonicalName,
                            aliases: Array.isArray(registryEntity.aliases) ? registryEntity.aliases : [],
                            entityIds: [registryEntity.id]
                        });
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
                    entityChunks.forEach(r => pushResult({ source: r.source, full: r.text, meta: `lookup_entity "${call.arg}"` }));
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
                    // Semantic top-k over the entity's linked Writing Desk document, scored
                    // against the user prompt (not a dump). Opt-in + truncated → same cost as
                    // a search_kb call. chat_memory tier only.
                    let loreResults = [];
                    let docTitle = '';
                    if (includeChatContext) {
                        try {
                            const looked = lookupEntityChunks(call.arg, chatId, 'chat_memory');
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
                            retrievedLore.set(r.id, {
                                text,
                                source: r.source || docTitle,
                                relevance: r.fusionScore ?? r.score
                            });
                            pushResult({ source: r.source || docTitle, full: text, meta: `read_lore "${call.arg}"` });
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

                    if (!isConstant && includeChatContext && chat && chat.knowledgeFiles) {
                        try {
                            const chatKbFiles = typeof chat.knowledgeFiles === 'string'
                                ? JSON.parse(chat.knowledgeFiles)
                                : chat.knowledgeFiles;
                            const fileMatch = chatKbFiles.find(f => f.name.toLowerCase() === call.arg.toLowerCase());
                            if (fileMatch) {
                                isConstant = !isSearchable(fileMatch);
                                canReadWorkspaceSource = isAvailableToProfile(fileMatch, profile.id) && isSearchable(fileMatch);
                                if (!canReadWorkspaceSource && !isConstant) isUnavailable = true;
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
                            const snippetMatch = snippets.find(s => (s.title || s.source || '').toLowerCase() === call.arg.toLowerCase());
                            if (snippetMatch) {
                                isConstant = !isSearchable(snippetMatch);
                                canReadWorkspaceSource = isAvailableToProfile(snippetMatch, profile.id) && isSearchable(snippetMatch);
                                if (!canReadWorkspaceSource && !isConstant) isUnavailable = true;
                            }
                        } catch (e) { }
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
                        }

                        // Asymmetric guard: the agent only needs enough to judge relevance, so truncate
                        // what enters its reasoning history. The FULL text stays in readFiles → final context
                        // (the writing assistant wants the whole file). Pruning is by filename, so truncation
                        // here never affects which files survive.
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
                const produced = turnItems.slice(traceItemStart);
                const resultCount = produced.filter(item => item.kind === 'result').length;
                const summary = produced.map(item => item.kind === 'note'
                    ? item.text
                    : `${item.handle} · ${item.source}`).join(' | ');
                toolTrace.push({
                    turn: currentTurn,
                    tool: call.name,
                    query: String(call.arg).slice(0, 500),
                    status: /unavailable|access denied/i.test(summary)
                        ? 'unavailable'
                        : (/no matches|no known|no such|no relevant/i.test(summary) && resultCount === 0 ? 'empty' : 'completed'),
                    resultCount,
                    summary: makeSnippet(summary),
                    durationMs: Date.now() - traceStartedAt
                });
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
                // Downgrade oldest→newest until the live results history fits the budget, always
                // preserving the newest KEEP_TURNS in full. Small loops never trip this.
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
            if (err.name === 'AbortError' || run?.isCancelled) throw err;
            console.error(`[Agentic RAG] Loop error at turn ${currentTurn}:`, err);
            loopDegraded = true;
            stopReason = 'retrieval-error';
            toolTrace.push({
                turn: currentTurn,
                tool: 'turn',
                query: '',
                status: 'failed',
                resultCount: 0,
                summary: String(err.message || err).slice(0, 160),
                durationMs: 0
            });
            sendRunEvent(webContents, 'workflow-progress', run, {
                profileName: profile.name,
                status: 'Agentic RAG: retrieval error, continuing with partial context'
            });
            break; // preserve whatever was gathered in prior turns
        }
    }

    const selectionEntries = [
        ...Array.from(retrievedProfileChunks.entries()).map(([id, value]) => ({
            key: `profile:${id}`, collection: retrievedProfileChunks, id,
            kind: 'profile-knowledge', source: value.source, content: value.text, relevance: value.relevance
        })),
        ...Array.from(retrievedChatChunks.entries()).map(([id, value]) => ({
            key: `workspace-text:${id}`, collection: retrievedChatChunks, id,
            kind: 'workspace-text', source: value.source, content: value.text, relevance: value.relevance
        })),
        ...Array.from(retrievedMemories.entries()).map(([id, value]) => ({
            key: `workspace-memory:${id}`, collection: retrievedMemories, id,
            kind: 'workspace-memory', source: value.source, content: value.text, relevance: value.relevance
        })),
        ...Array.from(retrievedLore.entries()).map(([id, value]) => ({
            key: `worldbuild-lore:${id}`, collection: retrievedLore, id,
            kind: 'worldbuild-canon', source: value.source, content: value.text, relevance: value.relevance
        })),
        ...Array.from(retrievedWorldFacts.entries()).map(([id, value]) => ({
            key: `worldbuild-fact:${id}`, collection: retrievedWorldFacts, id,
            kind: 'worldbuild-canon', source: value.source, content: value.text, relevance: 1
        })),
        ...Array.from(retrievedNarrativeOptions.entries()).map(([id, value]) => ({
            key: `worldbuild-options:${id}`, collection: retrievedNarrativeOptions, id,
            kind: 'worldbuild-canon', source: value.source, content: value.text, relevance: value.relevance
        })),
        ...Array.from(readFiles.entries()).map(([id, value]) => ({
            key: `file:${id}`, collection: readFiles, id,
            kind: value.source === 'profile' ? 'profile-knowledge' : 'workspace-text',
            source: id, content: value.text, relevance: 1
        }))
    ];
    const selection = selectRetrievedEntries(currentInput, selectionEntries);
    selection.excluded.forEach(({ entry }) => entry.collection.delete(entry.id));
    const externalContextParts = [];

    if (retrievedProfileChunks.size > 0) {
        const profileParts = Array.from(retrievedProfileChunks.values()).map(r => `[Result from Profile KB - ${r.source}]: ${r.text}`);
        externalContextParts.push(`--- PROFILE KNOWLEDGE BASE CHUNKS ---\n${profileParts.join('\n\n')}`);
    }

    if (readFiles.size > 0) {
        const fileParts = Array.from(readFiles.entries())
            .filter(([, data]) => data.source === 'profile')
            .map(([filename, data]) => `[File Contents: ${filename}]:\n${data.text}`);
        if (fileParts.length) {
            externalContextParts.push(`--- READ FILES CONTENT ---\n${fileParts.join('\n\n')}`);
        }
    }

    const kanoraItems = [
        ...Array.from(readFiles.entries())
            .filter(([, data]) => data.source !== 'profile')
            .map(([filename, data]) => ({
                id: `file:${filename}`, kind: 'workspace-text', source: filename, content: data.text
            })),
        ...Array.from(retrievedChatChunks.entries()).map(([id, value]) => ({
            id, kind: 'workspace-text', source: value.source, content: value.text,
            relevance: value.relevance
        })),
        ...Array.from(retrievedMemories.entries()).map(([id, value]) => ({
            id, kind: 'workspace-memory', source: value.source || 'Chat Memory', content: value.text,
            relevance: value.relevance
        })),
        ...Array.from(retrievedLore.entries()).map(([id, value]) => ({
            id, kind: 'worldbuild-canon', source: value.source, content: value.text
        })),
        ...Array.from(retrievedWorldFacts.entries()).map(([id, value]) => ({
            id, kind: 'worldbuild-canon', source: value.source, content: value.text,
            entityIds: value.entityIds || [id]
        })),
        ...Array.from(retrievedNarrativeOptions.entries()).map(([id, value]) => ({
            id: `narrative-options:${id}`,
            kind: 'worldbuild-canon',
            source: value.source,
            content: value.text
        }))
    ];
    const externalContextGathered = externalContextParts.join('\n\n').trim();

    let loopProfileKbTokens = 0;
    let loopChatKbTokens = 0;

    if (retrievedProfileChunks.size > 0) {
        const texts = Array.from(retrievedProfileChunks.values()).map(r => r.text).join('\n\n');
        loopProfileKbTokens += estimateTokens(texts);
    }

    for (const [filename, data] of readFiles.entries()) {
        const tokens = estimateTokens(data.text);
        if (data.source === 'profile') {
            loopProfileKbTokens += tokens;
        } else {
            loopChatKbTokens += tokens;
        }
    }

    if (retrievedLore.size > 0) {
        const texts = Array.from(retrievedLore.values()).map(r => r.text).join('\n\n');
        loopChatKbTokens += estimateTokens(texts);
    }

    if (retrievedWorldFacts.size > 0) {
        const texts = Array.from(retrievedWorldFacts.values()).map(r => r.text).join('\n\n');
        loopChatKbTokens += estimateTokens(texts);
    }

    if (retrievedNarrativeOptions.size > 0) {
        const texts = Array.from(retrievedNarrativeOptions.values()).map(r => r.text).join('\n\n');
        loopChatKbTokens += estimateTokens(texts);
    }

    if (retrievedChatChunks.size > 0) {
        const texts = Array.from(retrievedChatChunks.values()).map(r => r.text).join('\n\n');
        loopChatKbTokens += estimateTokens(texts);
    }

    if (retrievedMemories.size > 0) {
        const texts = Array.from(retrievedMemories.values()).map(r => r.text).join('\n\n');
        loopChatKbTokens += estimateTokens(texts);
    }

    return {
        agenticResponse: finishResponse || '[Agent passed context directly — no summary needed]',
        externalContextGathered,
        kanoraItems,
        profileKbTokens: loopProfileKbTokens,
        chatKbTokens: loopChatKbTokens,
        agenticInputTokens: agenticRagInputTokens,
        agenticOutputTokens: agenticRagOutputTokens,
        degraded: loopDegraded,
        trace: toolTrace,
        stopReason,
        selection: selection.funnel
    };
}

// --- EXPORTS ---

module.exports = {
    runWorkflow,
    cancelGeneration,
    resolveErrorDeferred,
    resolveOverflowDeferred,
    executeSummarizationInternal,
    backfillWorldIndex,
    vectorizeDocument,
    retagDocumentChunks,
    enrichEntities,
    classifyAndTagSegment,
    applyChunkTags,
    computeDocumentVectorStatus,
    checkAndAutoSummarize,
    getSystemAiConfiguration,
    reprocessNarrativeStateTurn
};
