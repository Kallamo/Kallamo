import type { StoryRecord } from './story-reads';
import { metadataOf } from './story-reads';
import { relevanceOf } from '../memory-relevance';

/** What an item is there for, before the story's own signals refine it. */
export const ROLE_PRIORITY = { core: 100, direct: 80, support: 50, fallback: 20 } as const;

const ACQUISITION: Record<string, number> = { witnessed: 6, 'told-by': 3, evidence: 3, inferred: 1, authored: 0 };
const ATTITUDE: Record<string, number> = { knows: 4, remembers: 4, believes: 2, suspects: 1 };
const MINUTES_PER_DAY = 24 * 60;
const RECENCY_DAYS = 30;

export interface SalienceInput {
  role: keyof typeof ROLE_PRIORITY;
  record?: StoryRecord | null;
  /** Story-axis minute of the record's event, and of now. */
  minute?: number | null;
  now?: number | null;
  /** A holder of the record is in the scene. */
  heldByPresent?: boolean;
  /** How the search ranked it (0..1), when a search found it. */
  match?: number;
}

/**
 * The order items are kept in when the context must shrink: what the item is for first, then how
 * firmly and how recently the story holds it. Never a reason to add an item, only to rank it.
 */
export function salience(input: SalienceInput): number {
  let score: number = ROLE_PRIORITY[input.role];
  const record = input.record;
  if (record?.kind === 'holding') {
    score += ACQUISITION[record.acquisition.kind] ?? 0;
    score += ATTITUDE[record.attitude] ?? 0;
    score += Math.max(0, Math.min(1, Number(record.confidence ?? 1))) * 4;
    // How much it matters to its holder: what shaped them outranks a passing detail.
    const meta = metadataOf(record);
    score += relevanceOf(meta.salience, meta.category) * 6;
  }
  if (Number.isFinite(input.minute) && Number.isFinite(input.now)) {
    const days = Math.max(0, (Number(input.now) - Number(input.minute)) / MINUTES_PER_DAY);
    score += Math.max(0, 6 * (1 - days / RECENCY_DAYS));
  }
  if (input.heldByPresent) score += 5;
  if (Number.isFinite(input.match)) score += Math.max(0, Math.min(1, Number(input.match))) * 4;
  return score;
}

/** Records that no current read should see; the engine already leaves most of them out. */
export function isRetired(record: StoryRecord): boolean {
  const status = (record as { status?: string | null }).status;
  return Boolean(status && status !== 'active') || metadataOf(record).status === 'forgotten';
}
