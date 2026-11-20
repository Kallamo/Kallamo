import type { HoldingItem, StoryRecord } from './story-reads';
import { kindOf, metadataOf } from './story-reads';
import { dateOfStoryMinute, type OrdinalCalendar } from '../../../../shared/calendar-ordinal';
import { formatWorldDate, type WorldbuildView } from './entity-tiers';

/** Where an item is rendered. */
export type ContextSection = 'core' | 'turn' | 'knows' | 'narrator' | 'rules';

export type ItemTier = 'sheet' | 'card' | 'mention' | 'line';

export interface ContextItem {
  /** One key per thing: an entity, a story record, an event, a passage. Duplicates merge. */
  key: string;
  section: ContextSection;
  /** The needs it answers; the core's items have none and are never cut. */
  needIds: string[];
  tier: ItemTier;
  /** The story record or event behind it, for the engine's admission. */
  recordId?: string;
  eventId?: string;
  /** Who in the scene knows it, for the knowledge section. */
  holders: string[];
  /** A heading the item is grouped under inside its section. */
  group?: string;
  priority: number;
  text: string;
  tokens: number;
  /** The same thing one tier lower, or nothing when it cannot shrink. */
  degrade?: () => Omit<ContextItem, 'tokens'> | null;
}

export type DraftItem = Omit<ContextItem, 'tokens'>;

const ATTITUDE_PREFIX: Record<string, string> = { believes: 'Believes: ', suspects: 'Suspects: ' };

function holdingDate(record: StoryRecord, view: WorldbuildView): string {
  const date = formatWorldDate(metadataOf(record).occurredOn, view.names);
  return date ? ` (${date})` : '';
}

/** A held statement as one line: what is held, how it was learned, and when it happened if known. */
export function renderHolding(item: HoldingItem, view: WorldbuildView, names: (id: string) => string | undefined): string {
  const record = item.record;
  if (record.kind !== 'holding') return '';
  const text = String(record.text ?? '').trim();
  if (!text) return '';
  const kind = kindOf(record);
  const prefix = kind === 'memory' ? 'Remembers: ' : ATTITUDE_PREFIX[record.attitude] ?? '';
  const acquisition = record.acquisition;
  const how = acquisition.kind === 'told-by'
    ? ` (told by ${names(acquisition.sourceHolderId) ?? 'someone'})`
    : acquisition.kind === 'inferred' ? ' (inferred)' : acquisition.kind === 'evidence' ? ' (from evidence)' : '';
  const secret = record.secrecy ? ' [kept secret]' : '';
  return `${prefix}${text}${how}${holdingDate(record, view)}${secret}`;
}

export function renderFact(record: StoryRecord, fallback: (record: StoryRecord) => string): string {
  if (record.kind !== 'fact') return '';
  return String((record as { text?: string | null }).text ?? '').trim() || fallback(record);
}

/** A story-axis minute as the world's date, in the clock's era. */
export function storyDateLabel(minute: number | undefined, view: WorldbuildView): string {
  const date = dateOfStoryMinute(view.calendar as unknown as OrdinalCalendar, minute, String((view.clock as { eraId?: unknown } | null)?.eraId ?? '') || undefined);
  return date ? formatWorldDate(date, view.names) : '';
}
