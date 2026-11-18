import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import { NarrativeStateSystem, type ExtractedNarrativeEvent } from '../../src/main/features/narrative/narrative-state';
import { loadCurrentNarrativeRecords } from '../../src/main/features/narrative/narrative-record-projection';
import { selectPerspectiveRecords } from '../../src/main/features/narrative/narrative-state-routing.js';
import { resolveRecordReferences } from '../../src/main/features/narrative/story-refs.js';
import { NarrativeWorld } from '../../src/main/features/narrative/umwelt/narrative-world';
import { loadStoryRecords } from '../../src/main/features/narrative/umwelt/story-projection';
import { StoryTimelines } from '../../src/main/features/narrative/umwelt/story-timelines';
import { openTestDatabase } from '../sqlite-test-database';

const WORKSPACE = 'workspace-one';
const GATE = { subjectId: 'guild', predicate: 'gate-code', object: 'The gate code of the guild hall is Dawnfall.' };
const PASSAGE = { subjectId: 'guild', predicate: 'statement', object: 'A hidden passage runs from the cellar to the harbor.' };

describe('How something is held', () => {
  let directory: string;
  let db: Database.Database;
  let system: NarrativeStateSystem;
  const allowed = new Set(['elias', 'tess', 'guild', 'mara']);

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'kallamo-story-nuance-'));
    db = openTestDatabase(join(directory, 'state.db'));
    db.pragma('foreign_keys = ON');
    runDatabaseMigrations(db);
    db.exec(`CREATE TABLE entity_links (
      id TEXT PRIMARY KEY, workspaceId TEXT, fromId TEXT, relType TEXT,
      toId TEXT, label TEXT, metadata_json TEXT, createdAt INTEGER
    )`);
    system = new NarrativeStateSystem(db);
  });

  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  let turn = 0;
  function record(operations: ExtractedNarrativeEvent['operations'], participantIds = ['tess', 'elias']) {
    turn += 1;
    const result = system.createEvent({
      workspaceId: WORKSPACE, originId: `turn-${turn}`, interpreterId: 'system-model', allowedEntityIds: allowed, storyMinute: null,
      event: { type: 'custom', description: `Turn ${turn} of the guild story.`, excerpt: 'excerpt', participantIds, confidence: 0.97, operations }
    });
    if (result.decision === 'review') system.resolveEvent(WORKSPACE, result.record!.proposal.changeSet.event.id, 'approved');
    return result;
  }

  function holdings(holder: string, type: 'knowledge' | 'belief' = 'knowledge') {
    const world = NarrativeWorld.of(db, WORKSPACE);
    return loadStoryRecords(world, { recordTypes: [type], subjectIds: [holder] });
  }

  function refs() {
    const rows = loadCurrentNarrativeRecords(db, { workspaceId: WORKSPACE, recordTypes: ['knowledge', 'belief', 'memory'] })
      .reverse()
      .map(({ row, payload, interpreter }) => ({ type: row.record_type, subjectId: row.subject_id || null, value: payload, interpreter }));
    return selectPerspectiveRecords(rows, { holderIds: ['elias', 'tess', 'mara'], targetIds: ['guild'], focusIds: ['elias', 'tess'], withRefs: true });
  }

  function refFor(holder: string) {
    const selection = refs();
    const found = selection.records.find((item: { subjectId?: string }) => item.subjectId === holder) as unknown as { ref: string };
    return { ref: found.ref, refs: selection.refs! };
  }

  test('a suspicion is kept as one, and a confirmation turns it into knowledge', () => {
    record([{ type: 'belief', subjectId: 'elias', proposition: PASSAGE, category: 'secret', confidence: 0.6, attitude: 'suspects' }]);
    const [suspicion] = holdings('elias', 'belief');
    expect(suspicion.record.kind === 'holding' && suspicion.record.attitude).toBe('suspects');
    expect(suspicion.payload.attitude).toBe('suspects');
    const { ref, refs: map } = refFor('elias');
    const { events } = resolveRecordReferences([{ type: 'discovery', description: 'Elias finds the passage.', excerpt: 'x', participantIds: ['elias'], confidence: 0.97,
      operations: [{ type: 'revise', ref, attitude: 'knows', acquisition: 'witness', confidence: 0.97 }] }], map);
    record(events[0].operations, ['elias']);
    expect(holdings('elias', 'belief')).toEqual([]);
    const [known] = holdings('elias');
    expect(known.record.kind === 'holding' && known.record.attitude).toBe('knows');
    expect(known.payload.entryId).toBe(suspicion.payload.entryId);
  });

  test('holding that something is not so revises the record that held it was', () => {
    record([{ type: 'knowledge', subjectId: 'elias', proposition: GATE, category: 'capability', acquisition: 'witness', confidence: 0.97 }]);
    record([{ type: 'knowledge', subjectId: 'elias', proposition: GATE, category: 'capability', acquisition: 'witness', confidence: 0.97, negated: true }], ['elias']);
    const current = holdings('elias');
    expect(current).toHaveLength(1);
    expect(current[0].record.kind === 'holding' && current[0].record.claim.polarity).toBe(false);
    expect(current[0].payload.negated).toBe(true);
    // The same denial again is a repeat, not a change.
    expect(record([{ type: 'knowledge', subjectId: 'elias', proposition: GATE, category: 'capability', acquisition: 'witness', confidence: 0.97, negated: true }], ['elias']).skipped).toBe('no-valid-operations');
  });

  test('a lie keeps its intent and its teller, and waits for review', () => {
    record([{ type: 'knowledge', subjectId: 'tess', proposition: GATE, category: 'capability', acquisition: 'witness', confidence: 0.97 }], ['tess']);
    const { ref, refs: map } = refFor('tess');
    const told = { ...GATE, object: 'The gate code of the guild hall is Duskfall.' };
    const { events } = resolveRecordReferences([{ type: 'deception', description: 'Tess lies to Elias about the gate code.', excerpt: 'x', participantIds: ['tess', 'elias'], confidence: 0.97,
      operations: [{ type: 'knowledge', subjectId: 'elias', proposition: told, category: 'capability', acquisition: 'reported', confidence: 0.95, intent: 'deceptive', toldFrom: ref }] }], map);
    turn += 1;
    const result = system.createEvent({ workspaceId: WORKSPACE, originId: `turn-${turn}`, interpreterId: 'system-model', allowedEntityIds: allowed, storyMinute: null, event: events[0] });
    expect(result.decision).toBe('review');
    system.resolveEvent(WORKSPACE, result.record!.proposal.changeSet.event.id, 'approved');
    const [heard] = holdings('elias');
    const [source] = holdings('tess');
    // The hearer's own read never shows the lie; the trace of the telling does.
    expect(heard.record.kind === 'holding' && heard.record.acquisition).toEqual({ kind: 'told-by', sourceHolderId: 'tess', intent: 'unknown', sourceRecordId: source.record.id });
    expect(heard.payload).not.toHaveProperty('intent');
    const world = NarrativeWorld.of(db, WORKSPACE);
    const trace = world.call<{ chain: Array<{ acquisition: { intent?: string } | null }> }>('trace', { recordId: heard.record.id, timelineId: new StoryTimelines(world).readTimeline() });
    expect(trace.chain[0].acquisition?.intent).toBe('deceptive');
  });

  test('an inference names the records it rests on', () => {
    record([{ type: 'memory', subjectId: 'elias', summary: 'Elias saw wet footprints leading from the guild cellar.', category: 'revelation', salience: 0.9 }], ['elias']);
    const { ref, refs: map } = refFor('elias');
    const { events } = resolveRecordReferences([{ type: 'discovery', description: 'Elias works out the passage.', excerpt: 'x', participantIds: ['elias'], confidence: 0.97,
      operations: [{ type: 'knowledge', subjectId: 'elias', proposition: PASSAGE, category: 'secret', acquisition: 'inferred', confidence: 0.9, premises: [ref, '#99'] }] }], map);
    record(events[0].operations, ['elias']);
    const [inferred] = holdings('elias');
    const memoryId = map.get(ref).value.id;
    expect(inferred.record.kind === 'holding' && inferred.record.acquisition).toEqual({ kind: 'inferred', fromRecordIds: [memoryId], rule: 'narrative-analysis' });
  });

  test('a secret keeps its circle', () => {
    record([{ type: 'knowledge', subjectId: 'tess', proposition: PASSAGE, category: 'secret', acquisition: 'witness', confidence: 0.97, sharedWith: ['mara', 'tess', 'stranger'] }], ['tess']);
    const [secret] = holdings('tess');
    expect(secret.record.kind === 'holding' && secret.record.secrecy).toEqual({ sharedWith: ['mara'] });
  });

  test('what someone thinks another holds is checked against what that holder really holds', () => {
    record([{ type: 'knowledge', subjectId: 'elias', proposition: PASSAGE, category: 'secret', acquisition: 'witness', confidence: 0.97 }], ['elias']);
    const second = { type: 'belief' as const, subjectId: 'tess', proposition: PASSAGE, category: 'secret', confidence: 0.85, heldById: 'elias' };
    record([second]);
    const [belief] = holdings('tess', 'belief');
    expect(belief.record.kind === 'holding' && belief.record.claim.predicate).toBe('umwelt:holds');
    expect(belief.payload).toMatchObject({ heldById: 'elias', heldProposition: PASSAGE });
    expect(String((belief.payload.proposition as { object: string }).object)).toContain('elias holds that');
    const world = NarrativeWorld.of(db, WORKSPACE);
    const about = world.call<Array<{ actuallyHolds: boolean }>>('beliefsAbout', { holder: 'tess', about: 'elias', timelineId: new StoryTimelines(world).readTimeline() });
    expect(about.map(item => item.actuallyHolds)).toEqual([true]);
    expect(record([second]).skipped).toBe('no-valid-operations');
  });
});
