import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { chunkText } = require('../src/main/features/knowledge/chunk-text');
const {
  orderKnowledgeChunks,
  reconstructKnowledgeFile,
  stripChunkHeader
} = require('../src/main/features/knowledge/kb-reconstruct');

// Rows the way vectorizeChunks stores them: one batch shares a timestamp, and the
// id ends with the chunk's index within the file.
function storedRows(chunks: string[], file: string, time = 1726000000000, tags = '') {
  return chunks.map((chunk, index) => ({
    id: `chunk_${time}_${Math.random().toString(36).substring(2, 7)}_${index}`,
    rowid: time + index,
    text: `Document: ${file}\n${tags}Content: ${chunk}`
  }));
}

const paragraphs = Array.from({ length: 8 }, (_, i) =>
  `P${i + 1} START. ` + `Sentence ${i + 1} of the character sheet, describing traits and history in some detail. `.repeat(3) + `P${i + 1} END.`);
const original = paragraphs.join('\n\n');

describe('knowledge file reconstruction', () => {
  test('rebuilds a chunked file exactly, opening paragraph included', () => {
    const rows = storedRows(chunkText(original, 500), 'sheet.txt');
    expect(rows.length).toBeGreaterThan(1);
    expect(reconstructKnowledgeFile(rows)).toBe(original);
  });

  test('restores the order of a batch that shares one timestamp', () => {
    const rows = storedRows(chunkText(original, 500), 'sheet.txt');
    const byId = [...rows].sort((a, b) => a.id.localeCompare(b.id));
    expect(reconstructKnowledgeFile(byId)).toBe(original);
  });

  test('keeps a chunk added later after the ones indexed before it', () => {
    const first = storedRows(['First batch text that is long enough to keep.'], 'notes.txt', 1000);
    const later = storedRows(['Added later, also long enough to keep here.'], 'notes.txt', 2000);
    expect(orderKnowledgeChunks([...later, ...first]).map((row: any) => row.id)).toEqual([first[0].id, later[0].id]);
  });

  test('strips the stored header with or without tags', () => {
    expect(stripChunkHeader('Document: a.txt\nContent: Line one\nLine two')).toBe('Line one\nLine two');
    expect(stripChunkHeader('Document: a.txt\nTags: #a, #b\nContent: Body')).toBe('Body');
    expect(stripChunkHeader('Plain edited text')).toBe('Plain edited text');
  });

  test('joins chunks that share no overlap without merging them', () => {
    const rows = storedRows([
      'Alpha paragraph with enough words in it.',
      'Beta paragraph with enough words in it.'
    ], 'x.txt');
    expect(reconstructKnowledgeFile(rows)).toBe('Alpha paragraph with enough words in it.\n\nBeta paragraph with enough words in it.');
  });
});

describe('chunking', () => {
  test('splits a paragraph longer than the chunk size', () => {
    const paragraph = 'One sentence that keeps going for a while. '.repeat(60).trim();
    const chunks = chunkText(paragraph, 500);
    expect(chunks.length).toBeGreaterThan(3);
    for (const chunk of chunks) expect(chunk.length).toBeLessThanOrEqual(600);
  });

  test('rebuilds a split long paragraph without losing text', () => {
    const paragraph = Array.from({ length: 40 }, (_, i) => `Sentence number ${i + 1} ends here.`).join(' ');
    const rebuilt = reconstructKnowledgeFile(storedRows(chunkText(paragraph, 300), 'long.txt'));
    for (let i = 1; i <= 40; i++) expect(rebuilt).toContain(`Sentence number ${i} ends here.`);
  });

  test('leaves a short paragraph as a single chunk', () => {
    const text = 'A paragraph with enough meaningful words to pass the content filter.';
    expect(chunkText(text, 500)).toEqual([text]);
  });
});
