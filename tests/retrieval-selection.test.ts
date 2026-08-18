import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { selectRetrievedEntries } = require('../src/main/features/ai-engine/retrieval-selection');

describe('retrieval selection', () => {
  test('keeps distinct semantic evidence without imposing chronology heuristics', () => {
    const result = selectRetrievedEntries('Onde a história parou?', [
      entry('day-8', 'workspace-text', 'Registro - Dia 8.pdf', 'Dia 8 terminou na arena.', 0.95),
      entry('day-14', 'workspace-text', 'Registro - Dia 14.pdf', 'Dia 14 terminou na oficina.', 0.7),
      entry('kepler', 'worldbuild-canon', 'Kepler', 'Perfil completo de Kepler.', 1),
      entry('memory', 'workspace-memory', 'Chat Memory', 'Uma memória antiga.', 0.9)
    ]);

    expect(result.selected.map((value: { key: string }) => value.key)).toEqual(['day-8', 'day-14', 'kepler', 'memory']);
    expect(result.funnel).toMatchObject({
      intent: 'general',
      discovered: 4,
      selected: 4,
      excluded: 0,
      excludedByReason: {}
    });
  });

  test('deduplicates repeated evidence without reducing ordinary distinct results', () => {
    const repeated = 'Kepler, Mara e Nex entraram no Poço 04 para buscar provas.';
    const result = selectRetrievedEntries('O que aconteceu no Poço 04?', [
      entry('memory-a', 'workspace-memory', 'Kepler', repeated, 0.9),
      entry('memory-b', 'workspace-memory', 'Mara', repeated, 0.8),
      entry('fact', 'worldbuild-canon', 'Poço 04', 'O local foi selado pela Coroa.', 0.7)
    ]);

    expect(result.selected.map((value: { key: string }) => value.key)).toEqual(['memory-a', 'fact']);
    expect(result.funnel.excludedByReason).toEqual({ 'semantic-duplicate': 1 });
  });
});

function entry(key: string, kind: string, source: string, content: string, relevance: number) {
  return { key, kind, source, content, relevance };
}
