import { describe, expect, test } from 'vitest';
import { resolveAnalysisHolders, resolveNarrativeRouting, selectPerspectiveRecords } from '../../src/main/features/narrative/narrative-state-routing.js';

const record = (type: string, subjectId: string | null, value: Record<string, unknown>) => ({ type, subjectId, value });

describe('analysis scope', () => {
  test('keeps what present holders know about anyone, and drops what absent holders know', () => {
    const rows = [
      record('knowledge', 'kepler', { id: 'k1', status: 'active', proposition: { subjectId: 'absent-brother', predicate: 'p', object: 'o' } }),
      record('memory', 'elian', { id: 'm1', status: 'active', summary: 'far away' }),
    ];
    const { records } = selectPerspectiveRecords(rows, { holderIds: ['kepler'], targetIds: [], focusIds: [] });
    expect(records).toEqual([{ type: 'knowledge', subjectId: 'kepler', proposition: { subjectId: 'absent-brother', predicate: 'p', object: 'o' } }]);
  });

  test('reads someone only mentioned around the focus, never dropping them', () => {
    const rows = [
      record('knowledge', 'barnaby', { status: 'active', proposition: { subjectId: 'nex', predicate: 'p', object: 'o' } }),
      record('memory', 'barnaby', { status: 'active', summary: 'unrelated', relatedEntityIds: ['someone-else'] }),
      record('memory', 'alistair', { status: 'active', summary: 'anything' }),
    ];
    const { records } = selectPerspectiveRecords(rows, { holderIds: ['alistair'], mentionedHolderIds: ['barnaby'], targetIds: [], focusIds: ['nex'] });
    expect(records.map(item => item.subjectId)).toEqual(['barnaby', 'alistair']);
    expect(records.some(item => item.summary === 'unrelated')).toBe(false);
  });

  test('splits holders into present and mentioned only when the triage says who is present', () => {
    const candidateIds = ['kepler', 'alistair', 'barnaby'];
    const tiers = resolveAnalysisHolders({ candidateIds, sceneIds: ['kepler'], presentIds: ['alistair'] });
    expect([...tiers.present]).toEqual(['kepler', 'alistair']);
    expect([...tiers.mentioned]).toEqual(['barnaby']);
    const fallback = resolveAnalysisHolders({ candidateIds, sceneIds: ['kepler'], presentIds: null });
    expect([...fallback.present]).toEqual(candidateIds);
    expect(fallback.mentioned.size).toBe(0);
  });

  test('drops inactive, superseded and relationship records', () => {
    const rows = [
      record('memory', 'kepler', { id: 'new', status: 'active', summary: 'new', supersedesMemoryId: 'old' }),
      record('memory', 'kepler', { id: 'old', status: 'active', summary: 'old' }),
      record('knowledge', 'kepler', { id: 'k', status: 'revoked', proposition: {} }),
      record('fact', null, { id: 'f', status: 'retracted', proposition: { subjectId: 'kepler' } }),
      record('relationship', 'kepler', { sourceEntityId: 'kepler', targetEntityId: 'nex', value: 10 }),
    ];
    const { records } = selectPerspectiveRecords(rows, { holderIds: ['kepler'], targetIds: ['kepler'], focusIds: [] });
    expect(records.map(item => item.summary)).toEqual(['new']);
  });

  test('keeps facts by subject and puts the turn focus first', () => {
    const rows = [
      record('fact', null, { status: 'active', proposition: { subjectId: 'tower' } }),
      record('fact', null, { status: 'active', proposition: { subjectId: 'elsewhere' } }),
      record('fact', null, { status: 'active', proposition: { subjectId: 'world' }, relatedEntityIds: ['nex'] }),
    ];
    const { records, candidates } = selectPerspectiveRecords(rows, { holderIds: [], targetIds: ['tower'], focusIds: ['nex'], limit: 1 });
    expect(candidates).toBe(2);
    expect(records).toEqual([{ type: 'fact', proposition: { subjectId: 'world' } }]);
  });

  const route = (types: string[]) => resolveNarrativeRouting({
    triage: { consequential: true, types, requiresFullAnalysis: false },
    signals: { strongDomains: [], candidateDomains: [], signals: [] },
  });

  test('reports a full analysis forced by the number of domains', () => {
    const routing = route(['entity', 'scene', 'inventory', 'knowledge']);
    expect(routing.requiresFullAnalysis).toBe(true);
    expect(routing.forceReasons).toContain('four-or-more-domains');
  });

  test('counts the epistemic domains once, so their labels do not decide the cost', () => {
    expect(route(['scene', 'inventory', 'awareness', 'relationship']).requiresFullAnalysis).toBe(false);
    expect(route(['scene', 'inventory', 'knowledge']).mode).toBe(route(['scene', 'inventory', 'awareness', 'relationship']).mode);
  });
});
