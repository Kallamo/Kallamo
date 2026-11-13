import type { Record as StoryRecord } from '@kallamo/umwelt' with { 'resolution-mode': 'import' };
import type Database from 'better-sqlite3';
import { NarrativeWorld } from './narrative-world';
import { objectOf, StoryReader } from './story-reader';
import { searchStory } from './story-search';

const GENERIC_PREDICATES = new Set(['statement', 'worldbuild-statement', 'recorded-occurrence']);
const CANON_FACTS = 5;
const CANON_SCENES = 3;

/** Story records by id on the current timeline; one retired since the search is left out. */
export function storyRecordsById(db: Database.Database, workspaceId: string, ids: string[]): Map<string, StoryRecord> {
  const world = NarrativeWorld.of(db, workspaceId);
  const records = new Map<string, StoryRecord>();
  if (!world.exists()) return records;
  const timelineId = new StoryReader(world).timelineId();
  for (const id of new Set(ids)) {
    try {
      records.set(id, world.call<StoryRecord>('record', { recordId: id, timelineId }));
    } catch {
      // Nothing to show for a record that is gone.
    }
  }
  return records;
}

/** A Fact or a holding as one line of plain text, with entity ids turned into names. */
export function storyRecordText(db: Database.Database, workspaceId: string, record: StoryRecord, names = entityNames(db, workspaceId)): string {
  if (record.kind === 'holding' && record.text) return record.text;
  if (record.kind !== 'holding' && record.kind !== 'fact') return '';
  const claim = record.claim;
  const subject = names(claim.subject);
  const value = objectOf(claim);
  // An occurrence is stored as a structured value; what reads as text is its title and summary.
  const object = claim.object.kind === 'entity'
    ? names(claim.object.id)
    : value && typeof value === 'object'
      ? [(value as Record<string, unknown>).title, (value as Record<string, unknown>).summary].filter(Boolean).join(': ')
      : String(value ?? '');
  const negation = claim.polarity === false ? 'not ' : '';
  // A Fact about the world itself is stated without a subject.
  const statement = GENERIC_PREDICATES.has(claim.predicate) ? `${negation}${object}` : `${negation}${claim.predicate}: ${object}`;
  return claim.subject === workspaceId ? statement : GENERIC_PREDICATES.has(claim.predicate) ? `${subject}: ${statement}` : `${subject} ${statement}`;
}

/** A name lookup that reads the workspace's entities once. */
export function entityNames(db: Database.Database, workspaceId: string): (id: string) => string {
  let names: Map<string, string> | null = null;
  return id => {
    names ??= new Map((db.prepare('SELECT id, canonicalName FROM entities WHERE workspaceId = ?').all(workspaceId) as Array<{ id: string; canonicalName: string }>)
      .map(row => [row.id, row.canonicalName]));
    return names.get(id) ?? id;
  };
}

/**
 * Facts and earlier scenes close to a passage, as plain lines for a writing request, so a rewrite
 * does not contradict what the story established. Facts rank above scenes.
 */
export function storyCanonPassages(db: Database.Database, workspaceId: string, text: string, vector: number[] | null = null): Array<{ text: string; score: number }> {
  const facts = searchStory(db, workspaceId, { text, vector, limit: CANON_FACTS });
  const scenes = searchStory(db, workspaceId, { docType: 'event', text, vector, limit: CANON_SCENES });
  const records = storyRecordsById(db, workspaceId, facts.map(hit => hit.docId));
  const names = entityNames(db, workspaceId);
  const factLines = facts.flatMap(hit => {
    const record = records.get(hit.docId);
    const line = record ? storyRecordText(db, workspaceId, record, names) : '';
    return line ? [{ text: `Fact: ${line}`, score: hit.match === 'both' ? 0.85 : 0.8 }] : [];
  });
  // An occurrence is written as a Fact and as its event, so a scene a Fact already tells is left out.
  const sceneLines = scenes.flatMap(hit => {
    const line = hit.event?.description || hit.event?.title;
    if (!line || factLines.some(fact => fact.text.includes(line.slice(0, 80)))) return [];
    return [{ text: `Earlier scene: ${line}`, score: hit.match === 'both' ? 0.75 : 0.7 }];
  });
  return [...factLines, ...sceneLines];
}
