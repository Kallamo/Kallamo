const crypto = require('crypto');
const db = require('./database');
const { selectActiveMessages } = require('./features/chat/archive-coverage');
const { sendApiRequest, getReservedOutputTokens, resolvePayloadLimit } = require('./features/llm/llm.service');
const {
    PAYLOAD_BUDGET_CONTRACT,
    assertPayloadWithinLimit,
    getAvailableHistoryTokens,
    normalizeMaxApiPayload
} = require('./features/llm/payload-budget');
const { packContextItems, renderContextSections, selectRecentWithinBudget } = require('./features/llm/context-budget');
const { stripReasoning } = require('./features/chat/message-text');
const {
    countTokens,
    chunkText,
    generateEmbeddingVector,
    generateEmbeddingVectors,
    executeHybridSearch,
    executeMultiOwnerSearch,
    fuseAndRank
} = require('./rag-service');

// Analysis has no fence. The span is sent as Markdown, or HTML for tables; the model answers in kind.
const MD_RULES =
    `The marked span is Markdown. Return Markdown: # / ## / ### for H1/H2/H3, **bold**, *italic*, ` +
    `- for bullet lists, 1. for ordered lists, > for blockquotes. Do NOT use HTML tags. ` +
    `Preserve the formatting of the original where it still applies.`;
const HTML_RULES =
    `The marked span is HTML (it contains a table). Return valid HTML using the same tags ` +
    `(<table>, <tr>, <td>, <th>, <p>, <strong>, <em>, <ul>, <ol>, <li>, <blockquote>). ` +
    `Do NOT use Markdown. Preserve the table structure.`;

const CHANNEL_INSTRUCTIONS = {
    replacement: (open, close, rules) =>
        `You are editing a single span of the manuscript, marked with ${open} ... ${close} in the text below. ` +
        `Rewrite ONLY the marked span according to the instruction. Use the surrounding text for context but never alter it. ${rules} ` +
        `Return ONLY the new version of the marked span, wrapped exactly once in ${open} and ${close}, with nothing before or after.`,
    insertion: (open, close, rules) =>
        `You are expanding the manuscript at the span marked with ${open} ... ${close} in the text below. ` +
        `Produce new prose to ADD, that flows naturally from the marked span and into the text that follows. Do not repeat or alter the existing text. ${rules} ` +
        `Return ONLY the new prose to insert, wrapped exactly once in ${open} and ${close}, with nothing before or after.`,
    analysis:
        `You are analyzing the marked span of the manuscript in the context of the surrounding text. ` +
        `Write your critique, notes, or observations as plain prose for the writer to read. Do NOT rewrite the manuscript; this is a side note, not body text.`
};

// Factor applied to the selection's token count to size the output budget: a
// replacement is roughly the same length as the source, an insertion can be longer.
const MAXTOKENS_FACTOR = { replacement: 2, insertion: 3.5, analysis: 2 };
// An insertion's length is independent of the selection, so a small span must not starve it.
// maxTokens only caps output, so a generous floor is free.
const MAXTOKENS_MIN = { replacement: 256, insertion: 1024, analysis: 1024 };
const MAXTOKENS_CAP = 4096;

// Tokens kept in reserve beyond the output budget inside the reading size.
const BUDGET_MARGIN = 512;
const DEFAULT_CONTEXT_WINDOW = 8192;

// Characters of bidirectional context kept verbatim around the selection when the
// whole chapter does not fit the budget; the far parts fall to RAG.
const WINDOW_CHARS_EACH_SIDE = 4000;

// The chapter always gets at least this much; retrieved notes keep this share.
const MIN_CHAPTER_TOKENS = 1024;
const RETRIEVAL_SHARE_OF_READING = 0.2;

const RETRIEVED_CONTEXT_HEADER = '--- RETRIEVED CONTEXT ---';
const SECTIONS = {
    profile: '--- PROFILE KNOWLEDGE ---',
    workspace: '--- WORKSPACE KNOWLEDGE ---',
    memory: '--- WORKSPACE MEMORY ---',
    chapters: '--- OTHER CHAPTERS ---',
    chapter: '--- CURRENT CHAPTER (DISTANT PARTS) ---'
};
const SECTION_ORDER = [SECTIONS.profile, SECTIONS.workspace, SECTIONS.memory, SECTIONS.chapters, SECTIONS.chapter];

function makeFence() {
    const suffix = crypto.randomBytes(4).toString('hex');
    return {
        selOpen: `⟦KSEL_${suffix}⟧`,
        selClose: `⟦/KSEL_${suffix}⟧`,
        outOpen: `⟦OUT_${suffix}⟧`,
        outClose: `⟦/OUT_${suffix}⟧`
    };
}

// Last line of defense: no sentinel may ever reach the manuscript.
const SENTINEL_RE = /⟦\/?(?:OUT|KSEL)_[0-9a-f]+⟧/g;
function stripSentinels(text) {
    return (text || '').replace(SENTINEL_RE, '').trim();
}

function computeMaxTokens(selectionText, channel) {
    const factor = MAXTOKENS_FACTOR[channel] || 1.5;
    const floor = MAXTOKENS_MIN[channel] || 256;
    const selTokens = countTokens(selectionText);
    return Math.min(MAXTOKENS_CAP, Math.max(floor, Math.ceil(selTokens * factor) + 64));
}

// Tolerant fence parse: extract the content between the exact OUT tokens, ignoring
// any preamble/whitespace the model may emit around them.
function extractFence(raw, outOpen, outClose) {
    if (!raw) return null;
    const start = raw.indexOf(outOpen);
    if (start === -1) return { content: null, truncated: false };
    const afterOpen = start + outOpen.length;
    const end = raw.indexOf(outClose, afterOpen);
    if (end === -1) {
        // Truncated reply: keep the partial body so the failure path can salvage it.
        return { content: null, truncated: true, partial: raw.slice(afterOpen).trim() };
    }
    return { content: raw.slice(afterOpen, end).trim(), truncated: false };
}

// Whole chapter when it fits, else a verbatim window around the selection plus RAG over the rest.
async function buildChapterContext({ before, markedSpan, after, selOpen, selClose, queryVector, budgetTokens, threshold }) {
    const whole = `${before}${selOpen}${markedSpan}${selClose}${after}`;
    if (countTokens(whole) <= budgetTokens) {
        return { contextText: whole, farChunks: [] };
    }

    const roomChars = Math.max(0, budgetTokens - countTokens(markedSpan)) * 3.5;
    const charsEachSide = Math.min(WINDOW_CHARS_EACH_SIDE, Math.floor(roomChars / 2));
    const nearBefore = charsEachSide > 0 ? before.slice(-charsEachSide) : '';
    const nearAfter = after.slice(0, charsEachSide);
    const farBefore = before.slice(0, before.length - nearBefore.length);
    const farAfter = after.slice(nearAfter.length);

    let farChunks = [];
    const farText = `${farBefore}\n\n${farAfter}`.trim();
    if (farText.length > 0 && queryVector) {
        const pieces = chunkText(farText);
        let vectors = [];
        try { vectors = await generateEmbeddingVectors(pieces); } catch (e) { vectors = []; }
        const candidates = pieces.map((text, i) => ({
            id: `live_${i}`,
            source: 'current chapter',
            text,
            createdAt: 0,
            vector: vectors[i] || []
        }));
        farChunks = fuseAndRank(queryVector, candidates, null, threshold, 5);
    }

    const windowText = `${nearBefore}${selOpen}${markedSpan}${selClose}${nearAfter}`;
    return { contextText: windowText, farChunks };
}

function loadDirectives(workspaceId) {
    try {
        const rows = db.prepare(
            'SELECT text FROM pinned_directives WHERE workspaceId = ? AND enabled != 0 ORDER BY position, createdAt'
        ).all(workspaceId);
        return rows.map(r => r.text).filter(Boolean);
    } catch (e) {
        return [];
    }
}

// Query = selection + intermediate prompt. Results are budget items, fitted by score.
async function gatherRag({ profileId, workspaceId, currentDocId, retrievalQuery, threshold }) {
    const items = [];
    const add = (section, results) => {
        for (const r of results || []) {
            if (r && r.text) items.push({ section, text: r.text, tier: 1, score: Number(r.fusionScore ?? r.score) || 0 });
        }
    };
    try {
        add(SECTIONS.profile, await executeHybridSearch(retrievalQuery, profileId, 'profile_kb', threshold, 5));
    } catch (e) { }
    try {
        add(SECTIONS.workspace, await executeHybridSearch(retrievalQuery, workspaceId, 'chat_kb', threshold, 5));
    } catch (e) { }
    try {
        // Enable the tag boost, as the chat path does.
        add(SECTIONS.memory, await executeHybridSearch(retrievalQuery, workspaceId, 'chat_memory', threshold, 5, true));
    } catch (e) { }
    try {
        const siblingIds = db.prepare(
            'SELECT id FROM documents WHERE workspaceId = ? AND id != ?'
        ).all(workspaceId, currentDocId).map(r => r.id);
        if (siblingIds.length) {
            // Sibling chapters are world-indexed (WD chapter indexing tags their chunks),
            // so ride the tag boost here too, this is the cross-chapter coherence lever.
            add(SECTIONS.chapters, await executeMultiOwnerSearch(retrievalQuery, siblingIds, 'document', threshold, 5, true));
        }
    } catch (e) { }
    return items;
}

function loadActiveChatWindow(workspaceId) {
    try {
        const chat = db.prepare('SELECT memoryBlocks FROM chats WHERE id = ?').get(workspaceId);
        const messages = db.prepare(
            'SELECT id, role, content, excluded FROM messages WHERE chatId = ? ORDER BY createdAt'
        ).all(workspaceId);
        // Same live-history rule as the chat; reasoning never goes back to a model.
        return selectActiveMessages(messages, chat && chat.memoryBlocks)
            .map(m => ({ role: m.role, content: stripReasoning(m.content) }));
    } catch (e) {
        return [];
    }
}

// The bridge: assemble the envelope, call the API, and return ONLY the proposed text
// + channel. No message insert, no chat side effects (unlike runWorkflow).
async function runWritingDeskInvocation({
    documentId,
    workspaceId,
    before,
    selection,
    spanContent,
    format,
    after,
    fromPos,
    toPos,
    profileId,
    intermediatePrompt,
    resultChannel,
    abortSignal
}) {
    const profile = db.prepare('SELECT * FROM writing_profiles WHERE id = ?').get(profileId);
    if (!profile) throw new Error(`Writing profile not found: ${profileId}`);

    // Channel is chosen per-invocation (Invoke modal). The reading size is a workspace
    // setting living on the chat row, alongside maxContext. Both fall back sanely.
    const channel = resultChannel || 'replacement';
    const chatRow = db.prepare('SELECT wdContextWindow, wdUseChatHistory, maxContext FROM chats WHERE id = ?').get(workspaceId);
    const readingSize = (chatRow && chatRow.wdContextWindow) || DEFAULT_CONTEXT_WINDOW;
    // Default on: the workspace chat rides as history. Off (per-workspace toggle) drops
    // it, the biggest lever against the chat's language/topic bleeding into edits.
    const useChatHistory = !chatRow || chatRow.wdUseChatHistory !== 0;
    const workspaceLimit = normalizeMaxApiPayload(chatRow && chatRow.maxContext);
    const payload = resolvePayloadLimit({ apiProfileId: profile.apiProfileId, model: profile.model, maxPayloadTokens: workspaceLimit });
    const { selOpen, selClose, outOpen, outClose } = makeFence();

    // The model sees + echoes the formatted span, so size the output budget on it.
    const formatRules = format === 'html' ? HTML_RULES : MD_RULES;
    const markedSpan = spanContent || selection;
    const maxTokens = computeMaxTokens(markedSpan, channel);
    const threshold = 0.3;

    const retrievalQuery = `${selection}\n${intermediatePrompt || ''}`.trim();

    let queryVector = null;
    try {
        queryVector = await generateEmbeddingVector(retrievalQuery, true);
    } catch (e) { }

    const directives = loadDirectives(workspaceId);
    const channelInstruction = channel === 'analysis'
        ? CHANNEL_INSTRUCTIONS.analysis
        : CHANNEL_INSTRUCTIONS[channel](outOpen, outClose, formatRules);

    // Injected twice: restating directives near the instruction is what makes the model honor them.
    const directivesBlock = directives.length
        ? `--- PERMANENT DIRECTIVES (always honor) ---\n${directives.map(d => `- ${d}`).join('\n')}`
        : '';

    let baseSystemPrompt = profile.systemPrompt || '';
    if (directivesBlock) {
        baseSystemPrompt += `\n\n${directivesBlock}`;
    }
    const taskBlock = `\n\n--- TASK ---\n${channelInstruction}`;
    const promptTail =
        (directivesBlock ? `\n\n${directivesBlock}` : '') +
        `\n\n--- INSTRUCTION ---\n${intermediatePrompt || 'Apply the profile\'s purpose to the marked span.'}`;

    // The chapter gets what the fixed part leaves, minus the share kept for notes.
    const coreTokens = countTokens(baseSystemPrompt + taskBlock) + countTokens(promptTail);
    const retrievalReserve = Math.floor(readingSize * RETRIEVAL_SHARE_OF_READING);
    const chapterBudget = Math.max(
        MIN_CHAPTER_TOKENS,
        readingSize - maxTokens - BUDGET_MARGIN - coreTokens - retrievalReserve
    );

    const { contextText, farChunks } = await buildChapterContext({
        before, markedSpan, after, selOpen, selClose, queryVector, budgetTokens: chapterBudget, threshold
    });
    const chapterTokens = countTokens(contextText);

    const ragItems = await gatherRag({
        profileId: profile.id, workspaceId, currentDocId: documentId, retrievalQuery, threshold
    });
    for (const chunk of farChunks) {
        ragItems.push({ section: SECTIONS.chapter, text: chunk.text, tier: 0, score: Number(chunk.fusionScore ?? chunk.score) || 0 });
    }
    const retrievalBudget = Math.max(
        retrievalReserve,
        readingSize - maxTokens - BUDGET_MARGIN - coreTokens - chapterTokens
    );
    const packedRag = packContextItems(ragItems, retrievalBudget, { estimate: countTokens });
    const retrieved = renderContextSections(packedRag.kept, SECTION_ORDER);

    // Assemble the system prompt: profile prompt + permanent directives + RAG context
    // + channel instruction. The active chat window rides as chatHistory.
    let systemPrompt = baseSystemPrompt;
    if (retrieved) {
        systemPrompt += `\n\n${RETRIEVED_CONTEXT_HEADER}\n${retrieved}`;
    }
    systemPrompt += taskBlock;

    const newPrompt = `${contextText}${promptTail}`;
    const correctionSuffix = `\n\nIMPORTANT: your previous reply was not wrapped correctly. Return ONLY the result wrapped exactly once in ${outOpen} and ${outClose}.`;

    // Must fit the payload limit with room for the retry at the output cap.
    const budgetInput = {
        maxPayloadTokens: payload.limit,
        configuredPayloadTokens: payload.configured,
        tokenRatio: payload.ratio,
        limitSource: payload.source,
        systemPrompt,
        newPrompt: newPrompt + correctionSuffix,
        outputTokens: getReservedOutputTokens({ maxTokens: MAXTOKENS_CAP })
    };
    assertPayloadWithinLimit({
        ...budgetInput,
        breakdown: { fixed: coreTokens + chapterTokens, retrieved: packedRag.usedTokens, history: 0 }
    });

    // The workspace chat rides as a recent window, never the whole conversation: at
    // most the reading size, and never more than the payload limit leaves.
    let activeWindow = [];
    if (useChatHistory) {
        const historyBudget = Math.min(readingSize, getAvailableHistoryTokens(budgetInput));
        activeWindow = selectRecentWithinBudget(loadActiveChatWindow(workspaceId), historyBudget, {
            estimate: countTokens,
            overhead: PAYLOAD_BUDGET_CONTRACT.messageOverheadTokens
        }).selected.map(({ message, text }) => ({ role: message.role, content: text }));
    }

    const callApi = (budget, prompt = newPrompt) => sendApiRequest({
        apiProfileId: profile.apiProfileId,
        model: profile.model,
        systemPrompt,
        chatHistory: activeWindow,
        newPrompt: prompt,
        temperature: profile.temperature,
        maxTokens: budget,
        maxPayloadTokens: workspaceLimit,
        payloadLimit: payload,
        manualMode: profile.manualMode === 1,
        manualJson: profile.manualJson,
        abortSignal,
        includeResponseMetadata: true
    });
    // Reasoning a model returns alongside the reply never reaches the manuscript or a
    // note, and cannot carry a stray fence token into the parse.
    const readReply = (result) => ({
        text: stripReasoning(typeof result === 'string' ? result : (result?.content || '')),
        truncated: Boolean(result?.truncated)
    });

    let reply = readReply(await callApi(maxTokens));

    // Analysis: the whole response is the note; a truncated one is retried at the cap.
    if (channel === 'analysis') {
        if (reply.truncated && maxTokens < MAXTOKENS_CAP) {
            reply = readReply(await callApi(MAXTOKENS_CAP));
        }
        const note = reply.text.trim();
        if (!note) {
            throw new Error('The model returned an empty analysis. Nothing was saved; try again.');
        }
        return {
            channel,
            status: reply.truncated ? 'flagged' : 'ok',
            proposedText: reply.truncated ? `${note}\n\n_This analysis reached the output limit and may be incomplete._` : note,
            fromPos,
            toPos
        };
    }

    let parsed = extractFence(reply.text, outOpen, outClose);

    // Truncation means it wanted more room: retry straight at the cap.
    if (parsed && parsed.truncated && maxTokens < MAXTOKENS_CAP) {
        reply = readReply(await callApi(MAXTOKENS_CAP));
        parsed = extractFence(reply.text, outOpen, outClose);
    }

    // No valid fence → one free correction retry asking for the fence explicitly.
    if (!parsed || parsed.content == null) {
        // Hold the truncated body from the earlier attempt in case the retry also fails.
        const priorPartial = parsed && parsed.partial;
        const correction = readReply(await callApi(maxTokens, `${newPrompt}${correctionSuffix}`));
        parsed = extractFence(correction.text, outOpen, outClose);
        if (!parsed || parsed.content == null) {
            // Salvage the cleanest partial, sentinel-stripped, and flag it as possibly incomplete.
            const salvage = (parsed && parsed.partial) || priorPartial || correction.text || reply.text || '';
            return { channel, status: 'flagged', proposedText: stripSentinels(salvage), fromPos, toPos };
        }
    }

    return { channel, status: 'ok', proposedText: stripSentinels(parsed.content), fromPos, toPos };
}

module.exports = { runWritingDeskInvocation };
