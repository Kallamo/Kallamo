// Empty form skeletons score high on facet-listing queries, so a chunk needs real content.
const MIN_MEANINGFUL_CHARS = 60;

// Length of actual content in a chunk, ignoring bullet markers, lone bullets, and
// empty "Label:" lines (a field label with no value after the colon).
function meaningfulContentLength(text) {
    if (!text) return 0;
    const kept = [];
    for (const rawLine of text.split('\n')) {
        let line = rawLine.trim();
        if (!line) continue;
        line = line.replace(/^[●○•◦▪‣·\-\*▪○\s]+/, '').trim();
        if (!line) continue;                 // lone bullet
        if (/^[^:]{1,40}:\s*$/.test(line)) continue; // empty "Label:" with no value
        kept.push(line);
    }
    return kept.join(' ').replace(/\s+/g, ' ').trim().length;
}

const SENTENCE_BREAK = /(?<=[.!?…。！？]["'”’»)\]]*)\s+|\n+/;

function splitOnWhitespace(text, maxChunkSize) {
    const pieces = [];
    let current = '';
    for (const word of text.split(/\s+/).filter(Boolean)) {
        if (word.length > maxChunkSize) {
            if (current) { pieces.push(current); current = ''; }
            for (let i = 0; i < word.length; i += maxChunkSize) pieces.push(word.slice(i, i + maxChunkSize));
            continue;
        }
        if (current && current.length + 1 + word.length > maxChunkSize) {
            pieces.push(current);
            current = word;
        } else {
            current = current ? `${current} ${word}` : word;
        }
    }
    if (current) pieces.push(current);
    return pieces;
}

// Long paragraphs split at sentence ends, then spaces, then hard.
function splitLongParagraph(paragraph, maxChunkSize) {
    if (paragraph.length <= maxChunkSize) return [paragraph];
    const pieces = [];
    let current = '';
    for (const raw of paragraph.split(SENTENCE_BREAK)) {
        const sentence = String(raw || '').trim();
        if (!sentence) continue;
        if (sentence.length > maxChunkSize) {
            if (current) { pieces.push(current); current = ''; }
            pieces.push(...splitOnWhitespace(sentence, maxChunkSize));
            continue;
        }
        if (current && current.length + 1 + sentence.length > maxChunkSize) {
            pieces.push(current);
            current = sentence;
        } else {
            current = current ? `${current} ${sentence}` : sentence;
        }
    }
    if (current) pieces.push(current);
    return pieces;
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

        // Pieces of one long paragraph stay joined by a space inside a chunk.
        splitLongParagraph(cleanPara, maxChunkSize).forEach((piece, pieceIndex) => {
            const joiner = pieceIndex > 0 ? ' ' : '\n\n';
            if (currentChunk.length + piece.length > maxChunkSize && currentChunk.length > 0) {
                if (currentChunk.length > 50) {
                    chunks.push(currentChunk.trim());
                }
                const tail = currentChunk.slice(-overlapSize).trim();
                currentChunk = tail.length > 0 ? tail : "";
            }

            currentChunk += (currentChunk.length > 0 ? joiner : "") + piece;
        });
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

module.exports = { chunkText, splitLongParagraph, meaningfulContentLength, MIN_MEANINGFUL_CHARS };
