const { orderKnowledgeChunks, stripChunkHeader, joinChunksWithoutOverlap } = require('./kb-reconstruct');

// Archiving splits one scene across chunks, so a hit often holds the question and
// its neighbor the answer. Hits are widened to their neighbors in the same block.
const NEIGHBOR_RADIUS = 1;
const MAX_PASSAGE_CHUNKS = 6;

// hits: [{ id, memoryBlockId, text, score, uncited, origin, ... }]
// blocks: Map(blockId -> [{ id, text, rowid }]) holding every enabled chunk of that block.
// Returns merged passages plus the hits that could not be placed in a block.
function buildNeighborPassages(hits, blocks, { radius = NEIGHBOR_RADIUS, maxChunks = MAX_PASSAGE_CHUNKS } = {}) {
  const passages = [];
  const unplaced = [];
  const hitsByBlock = new Map();
  for (const hit of hits || []) {
    const rows = hit?.memoryBlockId ? blocks?.get(hit.memoryBlockId) : null;
    if (!rows || !rows.some(row => row.id === hit.id)) {
      unplaced.push(hit);
      continue;
    }
    if (!hitsByBlock.has(hit.memoryBlockId)) hitsByBlock.set(hit.memoryBlockId, new Map());
    hitsByBlock.get(hit.memoryBlockId).set(hit.id, hit);
  }

  for (const [blockId, blockHits] of hitsByBlock) {
    const ordered = orderKnowledgeChunks(blocks.get(blockId));
    const included = new Set();
    ordered.forEach((row, index) => {
      if (!blockHits.has(row.id)) return;
      for (let i = Math.max(0, index - radius); i <= Math.min(ordered.length - 1, index + radius); i++) included.add(i);
    });

    const contiguous = [];
    for (const index of [...included].sort((a, b) => a - b)) {
      const run = contiguous[contiguous.length - 1];
      if (run && index === run[run.length - 1] + 1) run.push(index);
      else contiguous.push([index]);
    }
    // Long runs split into equal parts, so a cut never strands one chunk of a scene.
    const runs = [];
    for (const run of contiguous) {
      const size = Math.ceil(run.length / Math.ceil(run.length / maxChunks));
      for (let start = 0; start < run.length; start += size) runs.push(run.slice(start, start + size));
    }

    for (const run of runs) {
      const rows = run.map(index => ordered[index]);
      const runHits = rows.map(row => blockHits.get(row.id)).filter(Boolean);
      if (!runHits.length) continue;
      const best = Math.max(...runHits.map(hit => Number(hit.fusionScore ?? hit.score) || 0));
      passages.push({
        ...runHits[0],
        ids: rows.map(row => row.id),
        text: joinChunksWithoutOverlap(rows.map(row => stripChunkHeader(row.text))),
        score: best,
        fusionScore: best,
        uncited: runHits.every(hit => hit.uncited),
        origin: runHits.some(hit => hit.origin === 'search') ? 'search' : runHits[0].origin
      });
    }
  }
  return { passages, unplaced };
}

module.exports = { buildNeighborPassages, NEIGHBOR_RADIUS, MAX_PASSAGE_CHUNKS };
