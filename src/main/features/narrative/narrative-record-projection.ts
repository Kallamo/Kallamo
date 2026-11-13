import type { At } from '@kallamo/umwelt' with { 'resolution-mode': 'import' };
import type Database from 'better-sqlite3';
import { NarrativeWorld } from './umwelt/narrative-world';
import { loadStoryRecords, projectStoryRecord, type ProjectedRecordType, type ProjectedRow, type ProjectedStoryRecord } from './umwelt/story-projection';
import { StoryReader } from './umwelt/story-reader';

/** Observations live on the Knowledge tab only; the narrative readers never ask for them. */
export type NarrativeRecordType = Exclude<ProjectedRecordType, 'observation'>;
export type NarrativeRecordRow = Omit<ProjectedRow, 'record_type'> & { record_type: NarrativeRecordType };

export interface ProjectedNarrativeRecord {
  row: NarrativeRecordRow;
  payload: Record<string, unknown>;
}

export interface LoadCurrentNarrativeRecordsInput {
  workspaceId: string;
  recordTypes: NarrativeRecordType[];
  subjectIds?: string[];
}

/** The current records of a workspace's story, in the shape narrative payloads have always had. */
export function loadCurrentNarrativeRecords(
  db: Database.Database,
  input: LoadCurrentNarrativeRecordsInput
): ProjectedNarrativeRecord[] {
  const world = NarrativeWorld.of(db, input.workspaceId);
  if (!world.exists()) return [];
  return loadStoryRecords(world, { recordTypes: input.recordTypes, ...(input.subjectIds ? { subjectIds: input.subjectIds } : {}) })
    .map(({ row, payload }) => ({ row: row as NarrativeRecordRow, payload }));
}

/**
 * The position of the story as it stands, on the scale record positions use. The journal's own
 * count is kept as a floor, for a workspace that has a journal but no story file yet.
 */
export function currentNarrativeSequence(db: Database.Database, workspaceId: string): number {
  const hasJournal = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'narrative_events'").get();
  const journal = hasJournal ? (db.prepare(`
    SELECT COALESCE(MAX(narrative_sequence), 0) AS sequence FROM narrative_events WHERE workspace_id = ?
  `).get(workspaceId) as { sequence: number }).sequence : 0;
  const world = NarrativeWorld.of(db, workspaceId);
  if (!world.exists()) return journal;
  const reader = new StoryReader(world);
  const timelineId = reader.timelineId();
  const main = reader.timeline('main').maxTick;
  return Math.max(journal, main, timelineId === 'main' ? main : reader.timeline(timelineId).maxTick);
}

/** Records one holder keeps, Knowledge-tab observations included. */
export function loadSubjectRecords(db: Database.Database, workspaceId: string, subjectId: string, at?: At): ProjectedStoryRecord[] {
  const world = NarrativeWorld.of(db, workspaceId);
  if (!world.exists()) return [];
  return loadStoryRecords(world, { recordTypes: ['observation', 'knowledge', 'belief', 'memory'], subjectIds: [subjectId], ...(at ? { at } : {}) });
}

/** Every current Fact of the story. */
export function loadStoryFacts(db: Database.Database, workspaceId: string): ProjectedStoryRecord[] {
  const world = NarrativeWorld.of(db, workspaceId);
  if (!world.exists()) return [];
  return loadStoryRecords(world, { recordTypes: ['fact'] });
}

/** The current bond from one entity to another along a dimension, if the story has one. */
export function loadStoryRelationship(db: Database.Database, workspaceId: string, sourceId: string, targetId: string, dimension = 'overall'): ProjectedStoryRecord | null {
  const world = NarrativeWorld.of(db, workspaceId);
  if (!world.exists()) return null;
  const record = new StoryReader(world).dispositions(sourceId, { target: targetId })
    .find(item => item.kind === 'disposition' && item.dimension.toLowerCase() === dimension.toLowerCase());
  return record ? projectStoryRecord(record) : null;
}

/** How a story record came to be, for a record whose journal row is gone or never existed. */
export function interpreterOf(record: ProjectedStoryRecord): 'model' | 'user' | 'deterministic' | 'import' {
  const origin = record.record.provenance?.origin as { kind?: string } | undefined;
  if (origin?.kind === 'model') return 'model';
  if (origin?.kind === 'human') return 'user';
  if (origin?.kind === 'import') return 'import';
  return 'deterministic';
}

/** The journal event a story event belongs to: an edit of an occurrence is written as `<event>@<revision>`. */
export function journalEventId(storyEventId: string): string {
  const at = storyEventId.lastIndexOf('@');
  return at > 0 ? storyEventId.slice(0, at) : storyEventId;
}
