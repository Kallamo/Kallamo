import type { ContextAdmitResult, Record as StoryRecord } from '@kallamo/umwelt' with { 'resolution-mode': 'import' };
import type Database from 'better-sqlite3';
import { knowledgeGroupsOf } from '../../worldbuild/knowledge-groups';
import { NarrativeWorld } from './narrative-world';
import { StoryReader } from './story-reader';

export interface AdmissionCandidate {
  id: string;
  /** The story record the candidate was rendered from, when it was rendered from one. */
  recordId?: string;
  /** A story event recalled as a scene: only someone who witnessed it may remember it. */
  eventId?: string;
}

export interface StoryRefusal {
  subjectId: string;
  candidateId: string;
  recordId: string;
  holderId: string | null;
  reason: string;
}

/**
 * The engine confirms each story record for its holder: the character, or a group whose knowledge
 * they read (Kallamo's sharing rule). Canon, sheets and other context are not checked here.
 */
export function admitForCharacter<T extends AdmissionCandidate>(
  db: Database.Database,
  workspaceId: string,
  subjectId: string,
  candidates: T[]
): { admitted: T[]; refused: StoryRefusal[] } {
  const checked = candidates.filter(candidate => candidate.recordId);
  const scenes = candidates.filter(candidate => candidate.eventId && !candidate.recordId);
  const world = NarrativeWorld.of(db, workspaceId);
  if (!world.exists() || (!checked.length && !scenes.length)) return { admitted: candidates.filter(candidate => !candidate.eventId), refused: [] };
  const reader = new StoryReader(world);
  const timelineId = reader.timelineId();
  const snapshot = reader.snapshot({ timelineId });
  const holderOf = new Map<string, string>();
  for (const record of [...snapshot.holdings.map(item => item.record), ...snapshot.dispositions] as StoryRecord[]) {
    if (record.kind === 'holding' || record.kind === 'disposition') holderOf.set(record.id, record.holder);
  }
  const readable = new Set([subjectId, ...knowledgeGroupsOf(db, workspaceId, subjectId).map(group => group.id)]);
  const refused: StoryRefusal[] = [];
  const byHolder = new Map<string, T[]>();
  for (const candidate of checked) {
    const holderId = holderOf.get(candidate.recordId!) ?? null;
    if (!holderId || !readable.has(holderId)) {
      refused.push({ subjectId, candidateId: candidate.id, recordId: candidate.recordId!, holderId, reason: holderId ? 'not-held' : 'inactive' });
      continue;
    }
    byHolder.set(holderId, [...(byHolder.get(holderId) ?? []), candidate]);
  }
  for (const [holderId, group] of byHolder) {
    const result = world.call<ContextAdmitResult>('context.admit', {
      holder: holderId,
      timelineId,
      candidates: group.map(candidate => ({ id: candidate.id, recordId: candidate.recordId }))
    });
    for (const rejection of result.rejected) {
      const candidate = group.find(item => item.id === rejection.id);
      if (candidate) refused.push({ subjectId, candidateId: candidate.id, recordId: candidate.recordId!, holderId, reason: String(rejection.reason) });
    }
  }
  const refusedIds = new Set(refused.map(item => item.candidateId));
  if (scenes.length && world.ensureEntities([subjectId]).has(subjectId)) {
    const result = world.call<ContextAdmitResult>('context.admit', {
      holder: subjectId,
      timelineId,
      candidates: scenes.map(candidate => ({ id: candidate.id, eventId: candidate.eventId }))
    });
    for (const rejection of result.rejected) refusedIds.add(rejection.id);
  } else {
    for (const scene of scenes) refusedIds.add(scene.id);
  }
  return { admitted: candidates.filter(candidate => !refusedIds.has(candidate.id)), refused };
}
