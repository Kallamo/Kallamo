import { describe, expect, test } from 'vitest';
import { compactNarrativeManifest, resolveAnalysisHolders, resolveNarrativeRouting, resolveSceneCast, selectPerspectiveRecords } from '../../src/main/features/narrative/narrative-state-routing.js';

const record = (type: string, subjectId: string | null, value: Record<string, unknown>) => ({ type, subjectId, value });

describe('analysis scope', () => {
  test('keeps what present holders know about anyone, and drops what absent holders know', () => {
    const rows = [
      record('knowledge', 'tobin', { id: 'k1', status: 'active', proposition: { subjectId: 'absent-brother', predicate: 'p', object: 'o' } }),
      record('memory', 'corbin', { id: 'm1', status: 'active', summary: 'far away' }),
    ];
    const { records } = selectPerspectiveRecords(rows, { holderIds: ['tobin'], targetIds: [], focusIds: [] });
    expect(records).toEqual([{ type: 'knowledge', subjectId: 'tobin', proposition: { subjectId: 'absent-brother', predicate: 'p', object: 'o' } }]);
  });

  test('reads someone only mentioned around the focus, never dropping them', () => {
    const rows = [
      record('knowledge', 'pell', { status: 'active', proposition: { subjectId: 'quill', predicate: 'p', object: 'o' } }),
      record('memory', 'pell', { status: 'active', summary: 'unrelated', relatedEntityIds: ['someone-else'] }),
      record('memory', 'edric', { status: 'active', summary: 'anything' }),
    ];
    const { records } = selectPerspectiveRecords(rows, { holderIds: ['edric'], mentionedHolderIds: ['pell'], targetIds: [], focusIds: ['quill'] });
    expect(records.map(item => item.subjectId)).toEqual(['pell', 'edric']);
    expect(records.some(item => item.summary === 'unrelated')).toBe(false);
  });

  test('sends a record stored twice once, and long texts shortened', () => {
    const long = `${'The night of the ambush. '.repeat(20)}End.`;
    const rows = [
      record('fact', null, { status: 'active', proposition: { subjectId: 'tobin', predicate: 'founded', object: 'The Watch was founded.' } }),
      record('fact', null, { status: 'active', proposition: { subjectId: 'tobin', predicate: 'founded', object: 'The Watch was founded.' } }),
      record('memory', 'tobin', { status: 'active', summary: long }),
    ];
    const { records, candidates } = selectPerspectiveRecords(rows, { holderIds: ['tobin'], targetIds: ['tobin'], focusIds: [] });
    expect(candidates).toBe(2);
    expect(records.filter(item => item.type === 'fact')).toHaveLength(1);
    const summary = records.find(item => item.type === 'memory')?.summary as string;
    expect(summary.length).toBeLessThanOrEqual(281);
    expect(summary.endsWith('…')).toBe(true);
    expect(long.startsWith(summary.slice(0, -1))).toBe(true);
  });

  test('splits holders into present and mentioned only when the triage says who is present', () => {
    const candidateIds = ['tobin', 'edric', 'pell'];
    const tiers = resolveAnalysisHolders({ candidateIds, sceneIds: ['tobin'], presentIds: ['edric'] });
    expect([...tiers.present]).toEqual(['tobin', 'edric']);
    expect([...tiers.mentioned]).toEqual(['pell']);
    const fallback = resolveAnalysisHolders({ candidateIds, sceneIds: ['tobin'] });
    expect([...fallback.present]).toEqual(candidateIds);
    expect(fallback.mentioned.size).toBe(0);
  });

  test('drops inactive, superseded and relationship records', () => {
    const rows = [
      record('memory', 'tobin', { id: 'new', status: 'active', summary: 'new', supersedesMemoryId: 'old' }),
      record('memory', 'tobin', { id: 'old', status: 'active', summary: 'old' }),
      record('knowledge', 'tobin', { id: 'k', status: 'revoked', proposition: {} }),
      record('fact', null, { id: 'f', status: 'retracted', proposition: { subjectId: 'tobin' } }),
      record('relationship', 'tobin', { sourceEntityId: 'tobin', targetEntityId: 'quill', value: 10 }),
    ];
    const { records } = selectPerspectiveRecords(rows, { holderIds: ['tobin'], targetIds: ['tobin'], focusIds: [] });
    expect(records.map(item => item.summary)).toEqual(['new']);
  });

  test('keeps facts by subject and puts the turn focus first', () => {
    const rows = [
      record('fact', null, { status: 'active', proposition: { subjectId: 'tower' } }),
      record('fact', null, { status: 'active', proposition: { subjectId: 'elsewhere' } }),
      record('fact', null, { status: 'active', proposition: { subjectId: 'world' }, relatedEntityIds: ['quill'] }),
    ];
    const { records, candidates } = selectPerspectiveRecords(rows, { holderIds: [], targetIds: ['tower'], focusIds: ['quill'], limit: 1 });
    expect(candidates).toBe(2);
    expect(records).toEqual([{ type: 'fact', proposition: { subjectId: 'world' } }]);
  });

  test('reads the rest of the room only on what the turn concerns', () => {
    const rows = [
      record('knowledge', 'rue', { status: 'active', proposition: { subjectId: 'silent-mile', predicate: 'p', object: 'o' } }),
      record('knowledge', 'wren', { status: 'active', proposition: { subjectId: 'lantern', predicate: 'p', object: 'o' } }),
      record('memory', 'wren', { status: 'active', summary: 'the stew', relatedEntityIds: ['rue'] }),
      record('memory', 'florian', { status: 'active', summary: 'the debt', relatedEntityIds: ['crownmoor'] }),
    ];
    const options = { holderIds: ['tobin', 'rue', 'wren', 'florian'], targetIds: [], focusIds: [] };
    const scoped = selectPerspectiveRecords(rows, { ...options, topicIds: ['tobin', 'rue', 'lantern'], fullHolderIds: ['tobin', 'rue'] });
    expect(scoped.records.map(item => item.subjectId).sort()).toEqual(['rue', 'wren', 'wren']);
    expect(scoped.records.some(item => item.summary === 'the debt')).toBe(false);
    // Someone nearby who hears about a topic they already hold keeps that record.
    const overheard = selectPerspectiveRecords(rows, { ...options, topicIds: ['crownmoor'], fullHolderIds: ['tobin'] });
    expect(overheard.records.map(item => item.summary)).toContain('the debt');
  });

  test('reads every present holder in full when the triage gives no topics', () => {
    const rows = [record('memory', 'florian', { status: 'active', summary: 'the debt', relatedEntityIds: ['crownmoor'] })];
    const { records } = selectPerspectiveRecords(rows, { holderIds: ['florian'], targetIds: [], focusIds: [], topicIds: null, fullHolderIds: [] });
    expect(records).toHaveLength(1);
  });

  test('puts what the turn concerns ahead of the rest when the cap cuts', () => {
    const rows = [
      record('knowledge', 'tobin', { status: 'active', proposition: { subjectId: 'elsewhere', predicate: 'p', object: 'newest' } }),
      record('knowledge', 'tobin', { status: 'active', proposition: { subjectId: 'rue', predicate: 'p', object: 'older' } }),
    ];
    const { records } = selectPerspectiveRecords(rows, { holderIds: ['tobin'], targetIds: [], focusIds: [], topicIds: ['rue'], fullHolderIds: ['tobin'], limit: 1 });
    expect(records[0].proposition.object).toBe('older');
  });

  test('groups the manifest by subject and leaves undetermined pairs and source ids out', () => {
    const manifest = {
      requestId: 'r', sequence: 1, sceneId: 's', playerSubjectId: 'tobin',
      subjectIds: ['tobin', 'rue', 'absent'], targetIds: ['rue', 'lantern', 'tobin'],
      assessments: [
        { subjectId: 'rue', targetId: 'lantern', state: 'confirmed', sourceIds: ['x'] },
        { subjectId: 'rue', targetId: 'tobin', state: 'undetermined', sourceIds: [] },
        { subjectId: 'tobin', targetId: 'rue', state: 'evidence-candidate', sourceIds: ['y'], evidence: 'a'.repeat(400) },
        { subjectId: 'tobin', targetId: 'lantern', state: 'derived', sourceIds: [] },
        { subjectId: 'absent', targetId: 'lantern', state: 'confirmed', sourceIds: [] },
      ],
      deepenedPairs: [{ subjectId: 'rue', targetId: 'lantern' }],
    };
    const compact = compactNarrativeManifest(manifest, ['tobin', 'rue'], ['rue', 'lantern', 'tobin']);
    expect(compact?.subjectIds).toEqual(['tobin', 'rue']);
    expect(compact?.subjects).toEqual([
      { subjectId: 'rue', confirmed: ['lantern'], deepened: ['lantern'] },
      { subjectId: 'tobin', candidates: [{ targetId: 'rue', evidence: 'a'.repeat(240) }], derived: ['lantern'] },
    ]);
    expect(JSON.stringify(compact)).not.toContain('sourceIds');
  });

  const route = (types: string[]) => resolveNarrativeRouting({
    triage: { consequential: true, types, requiresFullAnalysis: false },
    signals: { strongDomains: [], candidateDomains: [], signals: [] },
  });

  const noSignals = { strongDomains: [], candidateDomains: [], signals: [] };

  test('a payment filed as a resource in a world without resources opens the inventory', () => {
    const triage = { consequential: true, types: ['resource', 'knowledge'], requiresFullAnalysis: false };
    const routing = resolveNarrativeRouting({ triage, signals: noSignals, hasResourceDefinitions: false });
    expect(routing.selectedDomains).toEqual(expect.arrayContaining(['resource', 'inventory']));
    expect(routing.forceReasons).toContain('resource-without-definitions');
    expect(resolveNarrativeRouting({ triage, signals: noSignals, hasResourceDefinitions: true }).selectedDomains).not.toContain('inventory');
  });

  test('a turn about an item within reach opens the inventory, in any language', () => {
    const triage = { consequential: true, types: ['knowledge'], aboutIds: ['rue', 'copper-penny'], entityIds: [], requiresFullAnalysis: false };
    const routing = resolveNarrativeRouting({ triage, signals: noSignals, reachableItemIds: ['copper-penny'] });
    expect(routing.selectedDomains).toContain('inventory');
    expect(routing.forceReasons).toContain('item-in-reach');
    expect(resolveNarrativeRouting({ triage, signals: noSignals, reachableItemIds: ['harrows-journal'] }).selectedDomains).not.toContain('inventory');
    expect(resolveNarrativeRouting({ triage: { ...triage, consequential: false }, signals: noSignals, reachableItemIds: ['copper-penny'] }).selectedDomains).toEqual([]);
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

  const lantern = { participantIds: ['tobin', 'rue'], possibleObserverIds: ['jasper'], nearbyIds: ['wren', 'edwin', 'mina'] };

  test('someone heard speaking joins the conversation', () => {
    const patch = resolveSceneCast({ scene: lantern, playerId: 'tobin', speakerIds: ['wren', 'jasper'], involvedIds: ['rue'] });
    expect(patch.participantIds).toEqual(['rue', 'jasper', 'wren']);
    expect(patch.possibleObserverIds).toEqual([]);
    expect(patch.nearbyIds).toEqual(['edwin', 'mina']);
  });

  test('a participant idle for two turns steps back, but one quiet turn is not enough', () => {
    const scene = { ...lantern, participantIds: ['tobin', 'rue', 'wren'] };
    const twoTurns = resolveSceneCast({ scene, playerId: 'tobin', involvedIds: ['rue'], previous: { involvedIds: ['rue'] } });
    expect(twoTurns.participantIds).toEqual(['rue']);
    expect(twoTurns.nearbyIds).toEqual(['wren', 'edwin', 'mina']);
    const oneTurn = resolveSceneCast({ scene, playerId: 'tobin', involvedIds: ['rue'], previous: { involvedIds: ['rue', 'wren'] } });
    expect(oneTurn).toEqual({});
  });

  test('the presence list never takes anyone out of the scene', () => {
    // The triage tends to list only the people talking; leaving is the scene analysis's call.
    expect(resolveSceneCast({ scene: lantern, playerId: 'tobin', involvedIds: ['rue'], previous: { involvedIds: ['rue'] } })).toEqual({});
    expect(resolveSceneCast({ scene: lantern, playerId: 'tobin', involvedIds: ['rue'], previous: null })).toEqual({});
  });
});
