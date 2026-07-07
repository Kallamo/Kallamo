const crypto = require('crypto');
const db = require('./database');
const { sendApiRequest } = require('./api-engine');
const {
    countTokens,
    chunkText,
    generateEmbeddingVector,
    executeHybridSearch,
    executeMultiOwnerSearch,
    fuseAndRank
} = require('./rag-service');

// Per-channel instruction appended to the system prompt. Replacement/insertion rely
// on the output fence; analysis is free prose with no fence (nothing to disobey).
// The marked span is given as Markdown (the default, models read/write it far more
// reliably than HTML) or HTML (the table fallback). The model returns the same format.
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
// Per-channel floor. Replacement/analysis scale with the selection, but an insertion's
// length is independent of the (often tiny) marked span, a small selection must not
// starve a full new passage, or it truncates on nearly every insert. maxTokens only
// caps output, so a generous floor costs nothing when the model writes less.
const MAXTOKENS_MIN = { replacement: 256, insertion: 1024, analysis: 256 };
const MAXTOKENS_CAP = 4096;

// Tokens kept in reserve beyond the output budget so the prompt + completion don't
// collide with the context window.
const BUDGET_MARGIN = 512;
const DEFAULT_CONTEXT_WINDOW = 8192;

// Characters of bidirectional context kept verbatim around the selection when the
// whole chapter does not fit the budget; the far parts fall to RAG.
const WINDOW_CHARS_EACH_SIDE = 4000;

function makeFence() {
    const suffix = crypto.randomBytes(4).toString('hex');
    return {
        selOpen: `⟦KSEL_${suffix}⟧`,
        selClose: `⟦/KSEL_${suffix}⟧`,
        outOpen: `⟦OUT_${suffix}⟧`,
        outClose: `⟦/OUT_${suffix}⟧`
    };
}

// Remove any stray fence sentinel (open/close, OUT/KSEL, any suffix) so a malformed
// or truncated model reply can never carry one into the manuscript. Applied to every
// proposedText return path as a last line of defense.
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
        // Open fence present but no close: a length-capped truncation. Keep the partial
        // body after the open token so the failure path can salvage it instead of the
        // whole raw reply (which carries the echoed context and the open sentinel).
        return { content: null, truncated: true, partial: raw.slice(afterOpen).trim() };
    }
    return { content: raw.slice(afterOpen, end).trim(), truncated: false };
}

// Build the bidirectional chapter context with the selection wrapped in sentinels.
// Whole chapter when it fits the budget, otherwise a verbatim window around the
// selection plus freshly-embedded RAG over the chapter's far parts.
async function buildChapterContext({ before, markedSpan, after, selOpen, selClose, queryVector, budgetTokens, threshold }) {
    const whole = `${before}${selOpen}${markedSpan}${selClose}${after}`;
    if (countTokens(whole) <= budgetTokens) {
        return { contextText: whole, farChunks: [] };
    }

    const nearBefore = before.slice(-WINDOW_CHARS_EACH_SIDE);
    const nearAfter = after.slice(0, WINDOW_CHARS_EACH_SIDE);
    const farBefore = before.slice(0, before.length - nearBefore.length);
    const farAfter = after.slice(nearAfter.length);

    let farChunks = [];
    const farText = `${farBefore}\n\n${farAfter}`.trim();
    if (farText.length > 0 && queryVector) {
        const pieces = chunkText(farText);
        const candidates = [];
        for (let i = 0; i < pieces.length; i++) {
            try {
                const vector = await generateEmbeddingVector(pieces[i]);
                candidates.push({ id: `live_${i}`, source: 'current chapter', text: pieces[i], createdAt: 0, vector });
            } catch (e) { }
        }
        farChunks = fuseAndRank(queryVector, candidates, null, threshold, 5).map(r => r.text);
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

// Retrieval over the persistent channels: profile KB, chat KB, chat memory, and the
// sibling chapters of the same workspace (cross-chapter). Query = selection +
// intermediate prompt (the analog of the chat's currentInput).
async function gatherRag({ profileId, workspaceId, currentDocId, retrievalQuery, threshold }) {
    const out = [];
    try {
        const kb = await executeHybridSearch(retrievalQuery, profileId, 'profile_kb', threshold, 5);
        if (kb.length) out.push(`--- PROFILE KNOWLEDGE ---\n${kb.map(r => r.text).join('\n\n')}`);
    } catch (e) { }
    try {
        const chatKb = await executeHybridSearch(retrievalQuery, workspaceId, 'chat_kb', threshold, 5);
        if (chatKb.length) out.push(`--- WORKSPACE KNOWLEDGE ---\n${chatKb.map(r => r.text).join('\n\n')}`);
    } catch (e) { }
    try {
        // Workspace memory is the world-indexed tier: enable the dynamic-tag boost, same
        // as the chat path (searchChatMemories), so entity mentions in the query surface
        // the tagged chunks.
        const mem = await executeHybridSearch(retrievalQuery, workspaceId, 'chat_memory', threshold, 5, true);
        if (mem.length) out.push(`--- WORKSPACE MEMORY ---\n${mem.map(r => r.text).join('\n\n')}`);
    } catch (e) { }
    try {
        const siblingIds = db.prepare(
            'SELECT id FROM documents WHERE workspaceId = ? AND id != ?'
        ).all(workspaceId, currentDocId).map(r => r.id);
        if (siblingIds.length) {
            // Sibling chapters are world-indexed (WD chapter indexing tags their chunks),
            // so ride the tag boost here too, this is the cross-chapter coherence lever.
            const cross = await executeMultiOwnerSearch(retrievalQuery, siblingIds, 'document', threshold, 5, true);
            if (cross.length) out.push(`--- OTHER CHAPTERS ---\n${cross.map(r => r.text).join('\n\n')}`);
        }
    } catch (e) { }
    return out;
}

function loadActiveChatWindow(workspaceId) {
    try {
        const chat = db.prepare('SELECT summarizedIndex FROM chats WHERE id = ?').get(workspaceId);
        const summarizedIndex = chat ? (chat.summarizedIndex || 0) : 0;
        const messages = db.prepare(
            'SELECT role, content FROM messages WHERE chatId = ? ORDER BY createdAt'
        ).all(workspaceId);
        return messages.slice(summarizedIndex);
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

    // Channel is chosen per-invocation (Invoke modal). Context window is a workspace
    // setting living on the chat row, alongside maxContext. Both fall back sanely.
    const channel = resultChannel || 'replacement';
    const chatRow = db.prepare('SELECT wdContextWindow, wdUseChatHistory FROM chats WHERE id = ?').get(workspaceId);
    const contextWindow = (chatRow && chatRow.wdContextWindow) || DEFAULT_CONTEXT_WINDOW;
    // Default on: the workspace chat rides as history. Off (per-workspace toggle) drops
    // it, the biggest lever against the chat's language/topic bleeding into edits.
    const useChatHistory = !chatRow || chatRow.wdUseChatHistory !== 0;
    const { selOpen, selClose, outOpen, outClose } = makeFence();

    // The model sees + echoes the formatted span, so size the output budget on it.
    const formatRules = format === 'html' ? HTML_RULES : MD_RULES;
    const markedSpan = spanContent || selection;
    const maxTokens = computeMaxTokens(markedSpan, channel);
    const budgetTokens = contextWindow - maxTokens - BUDGET_MARGIN;
    const threshold = 0.3;

    const retrievalQuery = `${selection}\n${intermediatePrompt || ''}`.trim();

    let queryVector = null;
    try {
        queryVector = await generateEmbeddingVector(retrievalQuery, true);
    } catch (e) { }

    const { contextText, farChunks } = await buildChapterContext({
        before, markedSpan, after, selOpen, selClose, queryVector, budgetTokens, threshold
    });

    const ragBlocks = await gatherRag({
        profileId: profile.id, workspaceId, currentDocId: documentId, retrievalQuery, threshold
    });
    if (farChunks.length) ragBlocks.push(`--- CURRENT CHAPTER (DISTANT PARTS) ---\n${farChunks.join('\n\n')}`);

    const directives = loadDirectives(workspaceId);
    const activeWindow = useChatHistory ? loadActiveChatWindow(workspaceId) : [];

    // Assemble the system prompt: profile prompt + permanent directives + channel
    // instruction + RAG context. The active chat window rides as chatHistory.
    const channelInstruction = channel === 'analysis'
        ? CHANNEL_INSTRUCTIONS.analysis
        : CHANNEL_INSTRUCTIONS[channel](outOpen, outClose, formatRules);

    // Built once, injected twice: in the system prompt and again just before the
    // instruction. Directives are user-authored and treated equally (no per-directive
    // special-casing); restating the whole block by recency is what makes the model
    // actually honor them against the English scaffold and the chat history.
    const directivesBlock = directives.length
        ? `--- PERMANENT DIRECTIVES (always honor) ---\n${directives.map(d => `- ${d}`).join('\n')}`
        : '';

    let systemPrompt = profile.systemPrompt || '';
    if (directivesBlock) {
        systemPrompt += `\n\n${directivesBlock}`;
    }
    if (ragBlocks.length) {
        systemPrompt += `\n\n--- RETRIEVED CONTEXT ---\n${ragBlocks.join('\n\n')}`;
    }
    systemPrompt += `\n\n--- TASK ---\n${channelInstruction}`;

    // Fail fast if the always-on context alone overflows the window.
    const fixedTokens = countTokens(systemPrompt) + countTokens(contextText);
    if (fixedTokens >= contextWindow) {
        throw new Error(`Writing Desk: the assembled context (~${fixedTokens} tokens) exceeds the workspace context window of ${contextWindow}. Reduce directives/knowledge or raise the window.`);
    }

    const newPrompt =
        `${contextText}` +
        (directivesBlock ? `\n\n${directivesBlock}` : '') +
        `\n\n--- INSTRUCTION ---\n${intermediatePrompt || 'Apply the profile\'s purpose to the marked span.'}`;

    const callApi = (budget) => sendApiRequest({
        apiProfileId: profile.apiProfileId,
        model: profile.model,
        systemPrompt,
        chatHistory: activeWindow,
        newPrompt,
        temperature: profile.temperature,
        maxTokens: budget,
        manualMode: profile.manualMode === 1,
        manualJson: profile.manualJson,
        abortSignal
    });

    let raw = await callApi(maxTokens);

    // Analysis: free prose, the whole response is the note.
    if (channel === 'analysis') {
        return { channel, status: 'ok', proposedText: (raw || '').trim(), fromPos, toPos };
    }

    let parsed = extractFence(raw, outOpen, outClose);

    // Truncation (open fence, no close) → one retry at the cap. Truncation means the
    // model wanted more room than we gave, so jump straight to the ceiling rather than
    // merely doubling and risking a second truncation.
    if (parsed && parsed.truncated && maxTokens < MAXTOKENS_CAP) {
        raw = await callApi(MAXTOKENS_CAP);
        parsed = extractFence(raw, outOpen, outClose);
    }

    // No valid fence → one free correction retry asking for the fence explicitly.
    if (!parsed || parsed.content == null) {
        // Hold the truncated body from the earlier attempt in case the retry also fails.
        const priorPartial = parsed && parsed.partial;
        const correction = await sendApiRequest({
            apiProfileId: profile.apiProfileId,
            model: profile.model,
            systemPrompt,
            chatHistory: activeWindow,
            newPrompt: `${newPrompt}\n\nIMPORTANT: your previous reply was not wrapped correctly. Return ONLY the result wrapped exactly once in ${outOpen} and ${outClose}.`,
            temperature: profile.temperature,
            maxTokens,
            manualMode: profile.manualMode === 1,
            manualJson: profile.manualJson,
            abortSignal
        });
        parsed = extractFence(correction, outOpen, outClose);
        if (!parsed || parsed.content == null) {
            // Everything failed. Salvage the cleanest partial we have (a truncated fence
            // body beats the raw reply, which carries the echoed context), sentinel-
            // stripped, and flag it so the UI warns the writer it may be incomplete.
            const salvage = (parsed && parsed.partial) || priorPartial || correction || raw || '';
            return { channel, status: 'flagged', proposedText: stripSentinels(salvage), fromPos, toPos };
        }
        raw = correction;
    }

    return { channel, status: 'ok', proposedText: stripSentinels(parsed.content), fromPos, toPos };
}

module.exports = { runWritingDeskInvocation };
