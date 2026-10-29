import { describe, expect, test } from 'vitest';
import { compactNarrativeManifest, resolveAnalysisHolders, resolveNarrativeRouting, resolveSceneCast, selectPerspectiveRecords } from '../../src/main/features/narrative/narrative-state-routing.js';

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
    const fallback = resolveAnalysisHolders({ candidateIds, sceneIds: ['kepler'] });
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

  test('reads the rest of the room only on what the turn concerns', () => {
    const rows = [
      record('knowledge', 'rue', { status: 'active', proposition: { subjectId: 'silent-mile', predicate: 'p', object: 'o' } }),
      record('knowledge', 'wren', { status: 'active', proposition: { subjectId: 'lantern', predicate: 'p', object: 'o' } }),
      record('memory', 'wren', { status: 'active', summary: 'the stew', relatedEntityIds: ['rue'] }),
      record('memory', 'florian', { status: 'active', summary: 'the debt', relatedEntityIds: ['crownmoor'] }),
    ];
    const options = { holderIds: ['kepler', 'rue', 'wren', 'florian'], targetIds: [], focusIds: [] };
    const scoped = selectPerspectiveRecords(rows, { ...options, topicIds: ['kepler', 'rue', 'lantern'], fullHolderIds: ['kepler', 'rue'] });
    expect(scoped.records.map(item => item.subjectId).sort()).toEqual(['rue', 'wren', 'wren']);
    expect(scoped.records.some(item => item.summary === 'the debt')).toBe(false);
    // Someone nearby who hears about a topic they already hold keeps that record.
    const overheard = selectPerspectiveRecords(rows, { ...options, topicIds: ['crownmoor'], fullHolderIds: ['kepler'] });
    expect(overheard.records.map(item => item.summary)).toContain('the debt');
  });

  test('reads every present holder in full when the triage gives no topics', () => {
    const rows = [record('memory', 'florian', { status: 'active', summary: 'the debt', relatedEntityIds: ['crownmoor'] })];
    const { records } = selectPerspectiveRecords(rows, { holderIds: ['florian'], targetIds: [], focusIds: [], topicIds: null, fullHolderIds: [] });
    expect(records).toHaveLength(1);
  });

  test('puts what the turn concerns ahead of the rest when the cap cuts', () => {
    const rows = [
      record('knowledge', 'kepler', { status: 'active', proposition: { subjectId: 'elsewhere', predicate: 'p', object: 'newest' } }),
      record('knowledge', 'kepler', { status: 'active', proposition: { subjectId: 'rue', predicate: 'p', object: 'older' } }),
    ];
    const { records } = selectPerspectiveRecords(rows, { holderIds: ['kepler'], targetIds: [], focusIds: [], topicIds: ['rue'], fullHolderIds: ['kepler'], limit: 1 });
    expect(records[0].proposition.object).toBe('older');
  });

  test('groups the manifest by subject and leaves undetermined pairs and source ids out', () => {
    const manifest = {
      requestId: 'r', sequence: 1, sceneId: 's', playerSubjectId: 'kepler',
      subjectIds: ['kepler', 'rue', 'absent'], targetIds: ['rue', 'lantern', 'kepler'],
      assessments: [
        { subjectId: 'rue', targetId: 'lantern', state: 'confirmed', sourceIds: ['x'] },
        { subjectId: 'rue', targetId: 'kepler', state: 'undetermined', sourceIds: [] },
        { subjectId: 'kepler', targetId: 'rue', state: 'evidence-candidate', sourceIds: ['y'], evidence: 'a'.repeat(400) },
        { subjectId: 'kepler', targetId: 'lantern', state: 'derived', sourceIds: [] },
        { subjectId: 'absent', targetId: 'lantern', state: 'confirmed', sourceIds: [] },
      ],
      deepenedPairs: [{ subjectId: 'rue', targetId: 'lantern' }],
    };
    const compact = compactNarrativeManifest(manifest, ['kepler', 'rue'], ['rue', 'lantern', 'kepler']);
    expect(compact.subjectIds).toEqual(['kepler', 'rue']);
    expect(compact.subjects).toEqual([
      { subjectId: 'rue', confirmed: ['lantern'], deepened: ['lantern'] },
      { subjectId: 'kepler', candidates: [{ targetId: 'rue', evidence: 'a'.repeat(240) }], derived: ['lantern'] },
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

  const lantern = { participantIds: ['kepler', 'rue'], possibleObserverIds: ['jasper'], nearbyIds: ['wren', 'edwin', 'mina'] };

  test('someone heard speaking joins the conversation', () => {
    const patch = resolveSceneCast({ scene: lantern, playerId: 'kepler', speakerIds: ['wren', 'jasper'], involvedIds: ['rue'] });
    expect(patch.participantIds).toEqual(['rue', 'jasper', 'wren']);
    expect(patch.possibleObserverIds).toEqual([]);
    expect(patch.nearbyIds).toEqual(['edwin', 'mina']);
  });

  test('a participant idle for two turns steps back, but one quiet turn is not enough', () => {
    const scene = { ...lantern, participantIds: ['kepler', 'rue', 'wren'] };
    const twoTurns = resolveSceneCast({ scene, playerId: 'kepler', involvedIds: ['rue'], previous: { involvedIds: ['rue'] } });
    expect(twoTurns.participantIds).toEqual(['rue']);
    expect(twoTurns.nearbyIds).toEqual(['wren', 'edwin', 'mina']);
    const oneTurn = resolveSceneCast({ scene, playerId: 'kepler', involvedIds: ['rue'], previous: { involvedIds: ['rue', 'wren'] } });
    expect(oneTurn).toEqual({});
  });

  test('the presence list never takes anyone out of the scene', () => {
    // The triage tends to list only the people talking; leaving is the scene analysis's call.
    expect(resolveSceneCast({ scene: lantern, playerId: 'kepler', involvedIds: ['rue'], previous: { involvedIds: ['rue'] } })).toEqual({});
    expect(resolveSceneCast({ scene: lantern, playerId: 'kepler', involvedIds: ['rue'], previous: null })).toEqual({});
  });
});
