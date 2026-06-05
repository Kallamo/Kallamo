function chunkText(text, maxChunkSize = 1000) {
    if (!text || text.trim().length === 0) return [];
    
    const chunks = [];
    const paragraphs = text.split(/\n\s*\n/);
    let currentChunk = "";

    for (const para of paragraphs) {
        const cleanPara = para.trim();
        if (cleanPara.length === 0) continue;

        if (currentChunk.length + cleanPara.length > maxChunkSize && currentChunk.length > 0) {
            if (currentChunk.length > 50) {
                chunks.push(currentChunk.trim());
            }
            currentChunk = "";
        }

        currentChunk += (currentChunk.length > 0 ? "\n\n" : "") + cleanPara;
    }

    if (currentChunk.trim().length > 50) {
        chunks.push(currentChunk.trim());
    } else if (currentChunk.trim().length > 0 && chunks.length > 0) {
        chunks[chunks.length - 1] += "\n\n" + currentChunk.trim();
    }

    return chunks;
}

function calculateSimilarity(vecA, vecB) {
    let dotProduct = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
    }
    return dotProduct;
}

module.exports = {
    chunkText,
    calculateSimilarity
};