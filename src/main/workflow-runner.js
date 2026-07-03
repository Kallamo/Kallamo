const db = require('./database');
const entitiesStore = require('./entities');
const { sendApiRequest } = require('./api-engine');
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

// Format history messages into standard list, respecting max context tokens
function formatActiveHistory(messages, maxTokensAllowed) {
    let tokensUsed = 0;
    const history = [];

    for (let i = messages.length - 1; i >= 0; i--) {
        const msg = messages[i];
        let content = msg.content || '';

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

        const msgTokens = estimateTokens(content);
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

// Orchestrate workflow linear chain execution
async function runWorkflow({ chatId, messageContent, targetId, attachedFiles, webContents }) {
    if (activeRun) {
        activeRun.isCancelled = true;
        if (activeRun.controller) {
            activeRun.controller.abort();
        }
    }

    const controller = new AbortController();
    const currentRun = {
        isCancelled: false,
        controller: controller
    };
    activeRun = currentRun;
    let isWorkflow = false;

    try {
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

        let steps = [];
        let totalSteps = 1;
        isWorkflow = false;

        // Fall back to the first available profile if targetId is empty or undefined
        let resolvedTargetId = targetId;
        if (!resolvedTargetId) {
            const firstProfile = db.prepare('SELECT id FROM writing_profiles LIMIT 1').get();
            if (firstProfile) {
                resolvedTargetId = firstProfile.id;
            }
        }

        const workflow = db.prepare('SELECT * FROM workflows WHERE id = ?').get(resolvedTargetId);
        if (workflow) {
            steps = JSON.parse(workflow.steps || '[]');
            totalSteps = steps.length;
            isWorkflow = true;
        } else {
            const profile = db.prepare('SELECT * FROM writing_profiles WHERE id = ?').get(resolvedTargetId);
            if (profile) {
                steps = [{ profileId: resolvedTargetId, prompt: '', includeContext: true }];
                totalSteps = 1;
            } else {
                throw new Error(`Profile or Workflow target not found: ${resolvedTargetId}`);
            }
        }

        if (steps.length === 0) {
            throw new Error("Target workflow contains no steps.");
        }

        const chat = db.prepare('SELECT * FROM chats WHERE id = ?').get(chatId);
        const maxContextTokens = chat ? (chat.maxContext || 128000) : 128000;
        const summarizedIndex = chat ? (chat.summarizedIndex || 0) : 0;

        const messages = db.prepare('SELECT * FROM messages WHERE chatId = ? ORDER BY createdAt ASC').all(chatId);
        const activeMessages = messages.slice(summarizedIndex);

        let currentInput = messageContent;
        let finalOutput = '';
        let lastProfileUsed = null;

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

            webContents.send('workflow-progress', {
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
            let searchableChunks = [];
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

            // Fail fast when constant / full-context knowledge alone already exceeds the
            // context window. Uses the token counts already accumulated while building the
            // context (no re-tokenization of the huge block), so it both prevents a doomed
            // "prompt too long" API call (wasted tokens) and avoids the UI freeze caused by
            // repeatedly tokenizing oversized constant context and running the agentic loop.
            const constantKnowledgeTokens = profileKbTokens + chatKbTokens;
            const projectedConstantTokens = constantKnowledgeTokens + estimateTokens(compiledSystemPrompt) + estimateTokens(currentInput);
            if (projectedConstantTokens >= maxContextTokens) {
                throw new Error(`Profile "${profile.name}": its constant / full-context knowledge is ~${projectedConstantTokens.toLocaleString()} tokens, which exceeds this chat's context window of ${maxContextTokens.toLocaleString()} tokens. Reduce the constant knowledge or switch those knowledge files to RAG search strategy.`);
            }

            if (profile.isAgentic === 1) {
                const initialInputTokens = estimateTokens(currentInput);
                const initialSystemTokens = estimateTokens(compiledSystemPrompt + contextBlock);
                const initialRemainingTokens = maxContextTokens - initialInputTokens - initialSystemTokens;
                const ragActiveMessages = activeMessages.slice(-10);

                let ragChatHistory = [];
                if (i === 0 || includeChatHistory) {
                    ragChatHistory = formatActiveHistory(ragActiveMessages, initialRemainingTokens);
                }

                const agenticResult = await executeAgenticRagLoop(profile, chatId, currentInput, ragChatHistory, webContents, includeChatContext);
                if (agenticResult) {
                    // If detailed research context was gathered, include only it (prevents duplicate token recitation).
                    // If NOTHING was retrieved, do NOT pass the agent's 1-sentence summary off as facts — emit an
                    // explicit notice so the main AI knows retrieval ran and found nothing, instead of hallucinating
                    // document-based facts (fail-loud degradation).
                    const noContextNotice = `--- RAG NOTICE ---\nNo relevant context was retrieved from the knowledge base or memory for this request. Answer using only the conversation and the user's instructions; do not fabricate document-based facts.`;
                    const combinedContext = agenticResult.contextGathered
                        ? `--- DETAILED RESEARCH CONTEXT ---\n${agenticResult.contextGathered}`
                        : noContextNotice;
                    contextBlock += `\n\n${combinedContext}\n`;

                    let agenticResponseTokens = 0;
                    if (!agenticResult.contextGathered) {
                        agenticResponseTokens = estimateTokens(noContextNotice);
                    }
                    const hasProfileTokens = (agenticResult.profileKbTokens || 0) > 0;
                    const hasChatTokens = (agenticResult.chatKbTokens || 0) > 0;

                    if (hasProfileTokens && hasChatTokens) {
                        const half = Math.ceil(agenticResponseTokens / 2);
                        profileKbTokens += (agenticResult.profileKbTokens || 0) + half;
                        chatKbTokens += (agenticResult.chatKbTokens || 0) + (agenticResponseTokens - half);
                    } else if (hasChatTokens) {
                        profileKbTokens += (agenticResult.profileKbTokens || 0);
                        chatKbTokens += (agenticResult.chatKbTokens || 0) + agenticResponseTokens;
                    } else {
                        profileKbTokens += (agenticResult.profileKbTokens || 0) + agenticResponseTokens;
                        chatKbTokens += (agenticResult.chatKbTokens || 0);
                    }

                    agenticRagResponse = agenticResult.agenticResponse;
                    agenticRagContextGathered = agenticResult.contextGathered;
                    agenticInputTokens = agenticResult.agenticInputTokens || 0;
                    agenticOutputTokens = agenticResult.agenticOutputTokens || 0;
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

                    searchableChunks = results
                        .filter(r => {
                            const fileMatch = knowledgeFiles.find(f => f.name.toLowerCase() === r.source.toLowerCase());
                            if (fileMatch && (fileMatch.strategy === 'constant' || fileMatch.strategy === 'full_context')) {
                                return false;
                            }
                            if (constantSnippetTitles.includes(r.source.toLowerCase())) {
                                return false;
                            }
                            return true;
                        })
                        .map(r => r.text);
                    searchableChunks = Array.from(new Set(searchableChunks));
                    profileKbTokens += estimateTokens(searchableChunks.join('\n\n'));
                }

                if (includeChatContext && chat) {
                    const chatKbResults = await searchChatKnowledgeBase(currentInput, chatId);
                    standardRagDebug += formatRagDebugSection('CHAT KB', chatKbResults);
                    if (chatKbResults && chatKbResults.length > 0) {
                        const chatKbFiles = typeof chat.knowledgeFiles === 'string'
                            ? JSON.parse(chat.knowledgeFiles)
                            : (chat.knowledgeFiles || []);
                        const allowedFileNames = chatKbFiles
                            .filter(f => (!f.profiles || f.profiles.length === 0 || f.profiles.includes(profile.id)) && f.strategy !== 'constant' && f.strategy !== 'full_context')
                            .map(f => f.name);

                        chatKbChunks = chatKbResults
                            .filter(r => allowedFileNames.includes(r.source))
                            .map(r => r.text);
                        chatKbChunks = Array.from(new Set(chatKbChunks));
                        chatKbTokens += estimateTokens(chatKbChunks.join('\n\n'));
                    }
                }

                if (includeChatContext && chat) {
                    const memoryResults = await searchChatMemories(currentInput, chatId);
                    standardRagDebug += formatRagDebugSection('CHAT MEMORY', memoryResults);
                    if (memoryResults && memoryResults.length > 0) {
                        const blocksList = typeof chat.memoryBlocks === 'string'
                            ? JSON.parse(chat.memoryBlocks)
                            : (chat.memoryBlocks || []);
                        const allowedBlockIds = blocksList
                            .filter(b => (!b.profiles || b.profiles.length === 0 || b.profiles.includes(profile.id)) && b.strategy !== 'constant')
                            .map(b => b.id);

                        chatMemories = memoryResults
                            .filter(r => !r.blockId || allowedBlockIds.includes(r.blockId))
                            .map(r => r.text);
                        chatMemories = Array.from(new Set(chatMemories));
                        chatKbTokens += estimateTokens(chatMemories.join('\n\n'));
                    }
                }

                if (searchableChunks.length > 0) {
                    contextBlock += `\n\n--- PROFILE RELEVANT RETRIEVED KNOWLEDGE ---\n${searchableChunks.join('\n\n')}\n`;
                }
                if (chatKbChunks.length > 0) {
                    contextBlock += `\n\n--- CHAT RELEVANT RETRIEVED KNOWLEDGE ---\n${chatKbChunks.join('\n\n')}\n`;
                }
                if (chatMemories.length > 0) {
                    contextBlock += `\n\n--- CHAT PERSISTENT SUMMARIZED MEMORIES ---\n${chatMemories.join('\n\n')}\n`;
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
            const remainingTokens = maxContextTokens - inputTokens - systemTokens;

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

                webContents.send('workflow-progress', {
                    step: i + 1,
                    totalSteps,
                    profileName: profile.name,
                    status: 'Thinking...'
                });

                try {
                    stepOutput = await sendApiRequest({
                        apiProfileId: profile.apiProfileId,
                        model: profile.model,
                        systemPrompt: compiledSystemPrompt,
                        chatHistory,
                        newPrompt: currentInput,
                        temperature: profile.temperature,
                        maxTokens: profile.maxTokens,
                        manualMode: profile.manualMode === 1,
                        manualJson: profile.manualJson,
                        abortSignal: currentRun.controller.signal,
                        attachedImages: (i === 0 ? attachedImages : [])
                    });
                    success = true;
                } catch (apiError) {
                    if (apiError.name === 'AbortError' || currentRun.isCancelled) {
                        return { success: false, cancelled: true };
                    }
                    console.error(`API Error in step ${i + 1} (${profile.name}):`, apiError);

                    webContents.send('workflow-error', {
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
                webContents.send('workflow-context-overflow', {
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

            totalProfileKbTokens += profileKbTokens;
            totalChatKbTokens += chatKbTokens;
            totalChatHistoryTokens += chatHistoryTokens;
            totalMainInputTokens += totalInputTokens;
            totalAgenticInputTokens += agenticInputTokens;
            totalAgenticOutputTokens += agenticOutputTokens;
            totalOutputTokens += estimateTokens(stepOutput);
        }

        if (finalOutput && lastProfileUsed) {
            const aiMsgId = 'msg_' + Math.random().toString(36).substr(2, 9);

            const debugObj = {
                workflowStatus: isWorkflow ? `Workflow complete (${steps.length} steps)` : '',
                agenticRagResponse: lastAgenticRagResponse,
                agenticRagContextGathered: lastAgenticRagContextGathered,
                standardRagContextGathered: lastStandardRagDebug,
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

            return { success: true, aiMsgId };
        }

        return { success: true };

    } catch (e) {
        console.error("Workflow Execution Failure:", e);
        webContents.send('workflow-error', {
            step: 0,
            profileName: 'Workflow Engine',
            errorMessage: e.message || 'Fatal error during workflow execution.',
            isWorkflow: isWorkflow
        });
        return { success: false, error: e.message };
    } finally {
        if (activeRun === currentRun) {
            activeRun = null;
        }
        errorDeferred = null;
        overflowDeferred = null;
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
function validateChunkTags(arr, categories, chunkCount) {
    const byName = new Map(categories.map(c => [c.name.toLowerCase(), c.name]));
    const out = [];
    for (const entry of (Array.isArray(arr) ? arr : [])) {
        if (!entry || typeof entry !== 'object') continue;
        const idx = Number(entry.chunk);
        if (!Number.isInteger(idx) || idx < 0 || idx >= chunkCount) continue;
        const tags = [];
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
// global settings. Null when unset → callers fall back to the active profile.
function getSystemAi() {
    try {
        const row = db.prepare("SELECT value FROM settings WHERE key = 'advanced'").get();
        if (row) {
            const adv = JSON.parse(row.value);
            if (adv.systemApiProfileId) return { apiProfileId: adv.systemApiProfileId, model: adv.systemModelName || '' };
        }
    } catch (e) { }
    return null;
}

// Render a workspace's entity registry as a prompt block so the classifier reuses
// existing canonical names (and maps titles/variants to them) instead of coining
// inconsistent values. Empty string when the registry has no entities yet.
// Serialize an entity's structured `data` fields into a short human-readable clause
// for the retrieval dossier. Nothing curated into the registry may be lost from
// retrieval, so every scalar attribute the user set surfaces to the model. Long-form
// prose (description/content) is skipped here — it rides on the entity's Lore instead.
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

function buildEntityVocab(workspaceId) {
    if (!workspaceId) return '';
    let rows = [];
    try { rows = db.prepare('SELECT type, canonicalName, aliases FROM entities WHERE workspaceId IS ?').all(workspaceId); } catch (e) { return ''; }
    if (!rows.length) return '';
    const byType = new Map();
    for (const r of rows) {
        let aliases = [];
        try { const a = JSON.parse(r.aliases); if (Array.isArray(a)) aliases = a; } catch (e) { }
        const label = aliases.length ? `${r.canonicalName} [aka ${aliases.join(', ')}]` : r.canonicalName;
        if (!byType.has(r.type)) byType.set(r.type, []);
        byType.get(r.type).push(label);
    }
    const lines = [];
    for (const [type, names] of byType) lines.push(`${type}: ${names.join('; ')}`);
    return "Known entities (prefer these canonical names; map any variant or title to the canonical form):\n" + lines.join('\n');
}

// Map a classifier's surface mention to a canonical entity id within a workspace.
// Returns null on a miss — the tagger only tags entities that already exist in the
// Worldbuild registry, so unknown names are dropped rather than proposed or stored
// as loose literal text.
function resolveEntity(workspaceId, type, value) {
    return entitiesStore.resolveMention(value, type, workspaceId) || null;
}

// World-index pass: ONE System-AI call over a segment's numbered raw chunks. Returns
// the block's title + summary AND the per-chunk dynamic tags (which named entities,
// under which variable category, appear in each chunk). Variable categories = the
// entity-bearing vocabulary; their descriptions are the classifier criteria.
async function classifyAndTagSegment(chunkRecords, profile, workspaceId = null) {
    let title = 'Archived Memory';
    let summary = '';
    let chunkTags = [];

    const systemAi = getSystemAi();
    if (!profile && !systemAi) return { title, summary, chunkTags };
    const apiProfileId = systemAi ? systemAi.apiProfileId : profile.apiProfileId;
    const model = systemAi ? systemAi.model : profile.model;
    const manualMode = systemAi ? false : (profile && profile.manualMode === 1);
    const manualJson = systemAi ? null : (profile && profile.manualJson);

    let categories = [];
    try { categories = db.prepare('SELECT name, description FROM tags WHERE isEntity = 1').all(); } catch (e) { categories = []; }

    const numbered = chunkRecords.map((c, i) => `[CHUNK ${i}]\n${c.text}`).join('\n\n');
    const catLines = categories.length
        ? categories.map(c => `- ${c.name}: ${c.description}`).join('\n')
        : '- Characters: People, beings, or named agents present in the scene.';
    const fence = buildItemsFence();
    const vocab = buildEntityVocab(workspaceId);
    const systemPrompt =
        "You index a conversation segment that is split into numbered chunks.\n" +
        "First line MUST be 'TITLE: [3-word title]'. Then write a 2-sentence summary of the whole segment.\n" +
        "Then, for EACH chunk, list the specific NAMED entities that actually appear in it, grouped under these categories:\n" +
        catLines + "\n" +
        (vocab ? vocab + "\n" : "") +
        "Use ONLY these category names; skip a category when it has no named instance in that chunk. " +
        "Output a JSON array wrapped exactly once in " + fence.open + " and " + fence.close + ", " +
        "one element per chunk that has any entity: {\"chunk\": <number>, \"tags\": [{\"tag\": \"<Category>\", \"values\": [\"<name>\", ...]}]}. " +
        "Write nothing after the closing marker.";
    try {
        const response = await sendApiRequest({
            apiProfileId, model, systemPrompt,
            chatHistory: [],
            newPrompt: numbered,
            temperature: 0.3,
            maxTokens: 1200,
            manualMode, manualJson
        });
        const head = splitHeadAndBody(response, fence);
        title = head.title || title;
        summary = head.summary || String(response || '').trim();
        chunkTags = validateChunkTags(safeParseArray(head.body), categories, chunkRecords.length);
    } catch (e) {
        console.error("[World Index] classify+tag failed:", e);
    }
    return { title, summary, chunkTags };
}

// Persist the validated per-chunk tags into chunk_tags, mapping the classifier's
// chunk index back to the real stored chunk id. Variable tags: tag=category,
// entity=value. Runs in one transaction; never throws on a bad index.
function applyChunkTags(chunkTags, chunkRecords, workspaceId = null) {
    if (!Array.isArray(chunkTags) || !chunkTags.length) return 0;
    const insert = db.prepare('INSERT OR IGNORE INTO chunk_tags (chunkId, tag, entity) VALUES (?, ?, ?)');
    let rows = 0;
    db.transaction(() => {
        for (const entry of chunkTags) {
            const rec = chunkRecords[entry.chunkIndex];
            if (!rec || !rec.id) continue;
            const ws = rec.ownerId || workspaceId;
            for (const t of entry.tags) {
                // Only tag mentions that resolve to an existing Worldbuild entity;
                // unknown names are skipped (no proposal, no loose literal text).
                const entityRef = resolveEntity(ws, t.tag, t.value);
                if (!entityRef) continue;
                insert.run(rec.id, t.tag, entityRef);
                rows++;
            }
        }
    })();
    return rows;
}

// Backfill the world index over a chat's already-archived raw chunks (or all chats
// when chatId is null). These predate the per-chunk tagger, so they carry no tags.
// Batches the chunks through ONE System-AI call each (tagging only — no title/
// summary) and writes chunk_tags. INSERT OR IGNORE keeps re-runs from duplicating.
async function backfillWorldIndex(chatId = null, { batchSize = 12, full = false, tier = 'archive' } = {}) {
    const profile = db.prepare('SELECT * FROM writing_profiles LIMIT 1').get();
    const systemAi = getSystemAi();
    if (!profile && !systemAi) throw new Error('No System AI or writing profile configured');
    const apiProfileId = systemAi ? systemAi.apiProfileId : profile.apiProfileId;
    const model = systemAi ? systemAi.model : profile.model;
    const manualMode = systemAi ? false : (profile && profile.manualMode === 1);
    const manualJson = systemAi ? null : (profile && profile.manualJson);

    let categories = [];
    try { categories = db.prepare('SELECT name, description FROM tags WHERE isEntity = 1').all(); } catch (e) { categories = []; }
    if (!categories.length) throw new Error('No entity tag categories seeded');
    const catLines = categories.map(c => `- ${c.name}: ${c.description}`).join('\n');
    // Scoped vocab only when backfilling a single chat; the all-chats path leaves it
    // empty to avoid bleeding one workspace's names into another's prompt.
    const vocab = buildEntityVocab(chatId);

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

    // full: wipe this scope's existing tags and re-tag every chunk from scratch (the
    // "Index this Chat's memories" button), so a re-run reflects the current tagger and
    // entity registry instead of accumulating stale tags. Incremental (default): skip
    // chunks that already have tags so re-runs only fill gaps (e.g. a rate-limited tail).
    if (full) {
        const delSql = `DELETE FROM chunk_tags WHERE chunkId IN
                        (SELECT kc.id FROM knowledge_chunks kc WHERE ${where})`;
        if (chatId) db.prepare(delSql).run(chatId); else db.prepare(delSql).run();
    }
    const skipTagged = full ? '' : 'AND NOT EXISTS (SELECT 1 FROM chunk_tags ct WHERE ct.chunkId = kc.id)';
    const sql = `SELECT kc.id, kc.text, kc.ownerId FROM knowledge_chunks kc WHERE ${where}
                 ${skipTagged}
                 ORDER BY kc.createdAt ASC`;
    const chunks = chatId ? db.prepare(sql).all(chatId) : db.prepare(sql).all();
    if (!chunks.length) return { chunks: 0, batches: 0, tagged: 0 };

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

    let tagged = 0, batches = 0;
    for (let i = 0; i < chunks.length; i += batchSize) {
        if (i > 0) await new Promise(r => setTimeout(r, 600)); // gentle pacing between batches
        const batch = chunks.slice(i, i + batchSize);
        const numbered = batch.map((c, idx) => `[CHUNK ${idx}]\n${c.text}`).join('\n\n');
        const fence = buildItemsFence();
        const systemPrompt =
            "You index conversation chunks. For EACH numbered chunk, list the specific NAMED entities present, grouped under these categories:\n" +
            catLines + "\n" +
            (vocab ? vocab + "\n" : "") +
            "Use ONLY these category names; skip a category with no named instance in that chunk. " +
            "Output ONLY a JSON array wrapped exactly once in " + fence.open + " and " + fence.close + ", " +
            "one element per chunk that has any entity: {\"chunk\": <number>, \"tags\": [{\"tag\": \"<Category>\", \"values\": [\"<name>\", ...]}]}. " +
            "Write nothing else.";
        try {
            const response = await callWithRetry({ apiProfileId, model, systemPrompt, chatHistory: [], newPrompt: numbered, temperature: 0.3, maxTokens: 1500, manualMode, manualJson });
            const head = splitHeadAndBody(response, fence);
            const chunkTags = validateChunkTags(safeParseArray(head.body), categories, batch.length);
            tagged += applyChunkTags(chunkTags, batch, chatId);
        } catch (e) {
            console.error(`[World Index][backfill] batch ${batches} failed:`, e.message);
        }
        batches++;
        console.log(`[World Index][backfill] batch ${batches}: ${Math.min(i + batchSize, chunks.length)}/${chunks.length} chunks, ${tagged} tag row(s) so far.`);
    }
    return { chunks: chunks.length, batches, tagged };
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
// hash sets — the source of truth for the editor's "indexed" indicator. Immune to the
// mutable vectorized flag (which any save can reset). Returns 'done' | 'stale'.
function computeDocumentVectorStatus(documentId) {
    const doc = db.prepare('SELECT content FROM documents WHERE id = ?').get(documentId);
    if (!doc) return 'stale';
    const units = pmDocToChunkUnits(doc.content);
    const rows = db.prepare(
        "SELECT content_hash, manuallyEdited FROM knowledge_chunks WHERE ownerId = ? AND ownerType = 'document'"
    ).all(documentId);
    // Never indexed: stale unless the chapter is also empty (nothing to index).
    if (!rows.length) return units.length ? 'stale' : 'done';
    // Manually-edited chunks are preserved across re-index, so they don't count toward
    // the match; compare current blocks against the automated index only.
    const stored = new Set(rows.filter(r => !r.manuallyEdited && r.content_hash).map(r => r.content_hash));
    const current = new Set(units.map(u => u.hash));
    if (stored.size !== current.size) return 'stale';
    for (const h of current) if (!stored.has(h)) return 'stale';
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

        // Tag only the freshly embedded chunks (World index). Best-effort: a failed
        // pass just leaves the new chunks untagged, vectorization still succeeds.
        try {
            const profile = db.prepare('SELECT * FROM writing_profiles LIMIT 1').get();
            const records = vectors.map(v => ({ id: v.id, text: v.text, ownerId: doc.workspaceId }));
            const BATCH = 12;
            for (let i = 0; i < records.length; i += BATCH) {
                if (progressCallback) progressCallback({ phase: 'tagging', done: Math.min(i + BATCH, records.length), total: records.length });
                const batch = records.slice(i, i + BATCH);
                const cls = await classifyAndTagSegment(batch, profile, doc.workspaceId);
                applyChunkTags(cls.chunkTags, batch, doc.workspaceId);
            }
        } catch (e) {
            console.error('[Vectorize Document] tagging failed (vectorization continues):', e.message);
        }
    }

    db.prepare('UPDATE documents SET vectorized = 1 WHERE id = ?').run(documentId);

    return { added, kept: keepOrdinal.length, deleted: toDelete.length, total: units.length };
}

// Re-tag every already-embedded chunk of a chapter WITHOUT re-embedding (the "Reindex
// all" variant of the chapter index button). Wipes this document's existing chunk_tags
// and reclassifies from scratch, so a re-run reflects the current tagger and entity
// registry. Vectors are left untouched — new/changed blocks are still embedded by
// vectorizeDocument ("Index new").
async function retagDocumentChunks(documentId, progressCallback = null) {
    const doc = db.prepare('SELECT id, workspaceId FROM documents WHERE id = ?').get(documentId);
    if (!doc) throw new Error('Document not found');

    const rows = db.prepare(
        "SELECT id, text FROM knowledge_chunks WHERE ownerId = ? AND ownerType = 'document' ORDER BY ordinal ASC"
    ).all(documentId);
    if (!rows.length) return { tagged: 0, chunks: 0 };

    const del = db.prepare('DELETE FROM chunk_tags WHERE chunkId = ?');
    db.transaction(() => { for (const r of rows) del.run(r.id); })();

    const profile = db.prepare('SELECT * FROM writing_profiles LIMIT 1').get();
    const records = rows.map(r => ({ id: r.id, text: r.text, ownerId: doc.workspaceId }));
    let tagged = 0;
    const BATCH = 12;
    for (let i = 0; i < records.length; i += BATCH) {
        if (progressCallback) progressCallback({ phase: 'tagging', done: Math.min(i + BATCH, records.length), total: records.length });
        const batch = records.slice(i, i + BATCH);
        try {
            const cls = await classifyAndTagSegment(batch, profile, doc.workspaceId);
            tagged += applyChunkTags(cls.chunkTags, batch, doc.workspaceId);
        } catch (e) {
            console.error('[Retag Document] batch failed (continues):', e.message);
        }
    }
    return { tagged, chunks: rows.length };
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

    const profile = db.prepare('SELECT * FROM writing_profiles WHERE id = ?').get(profileId) || db.prepare('SELECT * FROM writing_profiles LIMIT 1').get();
    let title = customTitle || "Archived Memory";
    let summary = "Archived conversation context.";

    // Persist the raw chunks first so they have ids to tag (verbatim tier).
    try {
        insertChunksToDb(chatId, 'chat_memory', vectors);
    } catch (dbErr) {
        console.error("Failed to insert summarized vectors to SQLite:", dbErr);
    }

    // World index: one System-AI pass tags each raw chunk (who/what) and gives the
    // block its title + summary. Never blocks archiving — a failed pass just leaves
    // the chunks untagged.
    try {
        const chunkRecords = vectors.map(v => ({ id: v.id, text: v.text }));
        const cls = await classifyAndTagSegment(chunkRecords, profile, chatId);
        if (!customTitle && cls.title) title = cls.title;
        if (cls.summary) summary = cls.summary;
        const tagged = applyChunkTags(cls.chunkTags, chunkRecords, chatId);
        console.log(`[World Index] segment "${title}": ${cls.chunkTags.length}/${chunkRecords.length} chunk(s) tagged, ${tagged} tag row(s).`);
    } catch (smErr) {
        console.error("[World Index] tagging failed (archiving continues):", smErr);
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

async function executeAgenticRagLoop(profile, chatId, currentInput, chatHistory = [], webContents = null, includeChatContext = true) {
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
   Returns EVERY memory chunk tagged with a known world entity (see KNOWN ENTITIES), by exact name or alias — no semantic guessing. Also lists that entity's RELATED ENTITIES (its graph edges, e.g. "owns → Star Paradox; ally_of → Port Brea"). Prefer this over search_kb/search_memories when the user prompt refers to a known entity and you want its full dossier (traits, relationships, history). Follow a listed relation with another lookup_entity to traverse the world by structure instead of guessing from prose. Use search_kb/search_memories for concepts, scenes, or things not in the entity list.
5. <tool_call name="read_lore" query="entity name or alias" />
   For an entity that has a linked lore document (Writing Desk), returns the passages of that document most relevant to the user prompt. Use it when lookup_entity shows an entity has authored lore and you need its canonical background, not just scene mentions. Does nothing if the entity has no linked lore.
6. <tool_call name="expand" query="R3 or a source name" />
   Re-reads the FULL text of a previously retrieved item that was summarized in an earlier turn (results are shown by a handle like [R3 · source]). Use it only when a summarized item's snippet is not enough to decide. Everything you retrieve is already sent to the writing assistant in full — expand is just for YOUR reasoning.
7. <finish sources="source1, source2, ...">summary of retrieved facts</finish>
   Concludes your research. Inside the 'sources' attribute, you MUST list the exact filenames, character names, or document names of the retrieved contexts that were ACTUALLY relevant and helpful to answer the user prompt. Only these sources will be kept in the final context.
   If no sources are listed or if you omit the attribute, all searched contexts will be included by default.
   
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

    while (currentTurn <= maxTurns && !finished) {
        console.log(`[Agentic RAG] Turn ${currentTurn}/${maxTurns}`);
        if (webContents) {
            webContents.send('workflow-progress', {
                profileName: profile.name,
                status: `Agentic RAG: Investigating... (Turn ${currentTurn}/${maxTurns})`
            });
        }

        try {
            const systemPromptText = "You are a precise researcher. You communicate strictly using the tools specified.";
            const messagesText = JSON.stringify(messages);
            agenticRagInputTokens += estimateTokens(systemPromptText) + estimateTokens(messagesText);

            const agentOutput = await sendApiRequest({
                apiProfileId: profile.apiProfileId,
                model: profile.model,
                systemPrompt: systemPromptText,
                chatHistory: [],
                newPrompt: messagesText,
                temperature: 0.1,
                maxTokens: 4000,
                manualMode: false,
                manualJson: '',
                abortSignal: activeRun?.controller?.signal
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
                    const chatKbResults = rawChatKbResults.filter(r => {
                        const fileMatch = chatKbFiles.find(f => f.name.toLowerCase() === r.source.toLowerCase());
                        if (fileMatch && (fileMatch.strategy === 'constant' || fileMatch.strategy === 'full_context')) {
                            return false;
                        }
                        return true;
                    });

                    profileResults.forEach(r => {
                        retrievedProfileChunks.set(r.id, { text: r.text, source: r.source });
                    });
                    if (includeChatContext) {
                        chatKbResults.forEach(r => {
                            retrievedChatChunks.set(r.id, { text: r.text, source: r.source });
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
                    const memResults = rawMemResults.filter(r => {
                        const snippetMatch = chatMemoryBlocks.find(b => b.id === r.blockId || (b.title && b.title.toLowerCase() === r.source.toLowerCase()));
                        if (snippetMatch && snippetMatch.strategy === 'constant') {
                            return false;
                        }
                        return true;
                    });

                    if (includeChatContext) {
                        memResults.forEach(r => {
                            retrievedMemories.set(r.id, { text: r.text, source: r.source });
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
                } else if (call.name === 'lookup_entity') {
                    // Dossier retrieval by known entity. Two sources, fused: (1) the curated
                    // Worldbuild registry (authored lore + relations), resolved directly so an
                    // entity that was never tagged in chat memory is still found; (2) the
                    // entity's tagged chat_memory chunks (scene mentions). Feeds retrievedMemories
                    // so pruning/dedup with search_memories is shared; respects includeChatContext.
                    let entityChunks = [], entityIds = [];
                    if (includeChatContext) {
                        const looked = lookupEntityChunks(call.arg, chatId, 'chat_memory');
                        entityChunks = looked.chunks || [];
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
                            retrievedMemories.set(r.id, { text: r.text, source: r.source });
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
                    // worldbuild fact — shown in the final context and exempt from pruning.
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
                            retrievedLore.set(r.id, { text, source: r.source || docTitle });
                            pushResult({ source: r.source || docTitle, full: text, meta: `read_lore "${call.arg}"` });
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
                            if (fileMatch && (!fileMatch.strategy || fileMatch.strategy === 'constant' || fileMatch.strategy === 'full_context')) {
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
                            const snippetMatch = snippets.find(s => s.type === 'manual' && (s.title || s.source || '').toLowerCase() === call.arg.toLowerCase() && s.strategy === 'constant');
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
            console.error(`[Agentic RAG] Loop error at turn ${currentTurn}:`, err);
            loopDegraded = true;
            if (webContents) {
                webContents.send('workflow-progress', {
                    profileName: profile.name,
                    status: 'Agentic RAG: retrieval error, continuing with partial context'
                });
            }
            break; // preserve whatever was gathered in prior turns
        }
    }

    let gatheredContextParts = [];

    if (retrievedProfileChunks.size > 0) {
        const profileParts = Array.from(retrievedProfileChunks.values()).map(r => `[Result from Profile KB - ${r.source}]: ${r.text}`);
        gatheredContextParts.push(`--- PROFILE KNOWLEDGE BASE CHUNKS ---\n${profileParts.join('\n\n')}`);
    }

    if (readFiles.size > 0) {
        const fileParts = Array.from(readFiles.entries()).map(([filename, data]) => `[File Contents: ${filename}]:\n${data.text}`);
        gatheredContextParts.push(`--- READ FILES CONTENT ---\n${fileParts.join('\n\n')}`);
    }

    if (retrievedChatChunks.size > 0) {
        const chatParts = Array.from(retrievedChatChunks.values()).map(r => `[Result from Chat KB - ${r.source}]: ${r.text}`);
        gatheredContextParts.push(`--- CHAT KNOWLEDGE BASE CHUNKS ---\n${chatParts.join('\n\n')}`);
    }

    if (retrievedMemories.size > 0) {
        const memoryParts = Array.from(retrievedMemories.values()).map(r => `[Chat Memory]: ${r.text}`);
        gatheredContextParts.push(`--- CHAT SUMMARIZED MEMORIES & SNIPPETS ---\n${memoryParts.join('\n\n')}`);
    }

    if (retrievedLore.size > 0) {
        const loreParts = Array.from(retrievedLore.values()).map(r => `[Linked Lore - ${r.source}]: ${r.text}`);
        gatheredContextParts.push(`--- LINKED LORE (WRITING DESK) ---\n${loreParts.join('\n\n')}`);
    }

    if (retrievedWorldFacts.size > 0) {
        const factParts = Array.from(retrievedWorldFacts.values()).map(r => `[${r.source}]: ${r.text}`);
        gatheredContextParts.push(`--- WORLDBUILD FACTS ---\n${factParts.join('\n\n')}`);
    }

    const finalContextGathered = gatheredContextParts.join('\n\n');

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
        contextGathered: finalContextGathered.trim(),
        profileKbTokens: loopProfileKbTokens,
        chatKbTokens: loopChatKbTokens,
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
    backfillWorldIndex,
    vectorizeDocument,
    retagDocumentChunks,
    classifyAndTagSegment,
    applyChunkTags,
    computeDocumentVectorStatus,
    checkAndAutoSummarize
};
