import type {
  At,
  Claim,
  Entity,
  HoldingItem,
  HoldingsResult,
  PerspectiveResult,
  Record as StoryRecord,
  RecordPageResult,
  Timeline
} from '@kallamo/umwelt' with { 'resolution-mode': 'import' };
import { propositionIdentity, statementKey } from '../../../../narrative/narrative-taxonomy';
import type { NarrativeWorld } from './narrative-world';
import { StoryTimelines } from './story-timelines';

/** The narrative record kinds Kallamo writes, carried in each record's provenance metadata. */
export type StoryKind = 'fact' | 'state' | 'knowledge' | 'belief' | 'memory' | 'observation' | 'relationship';

export type StoryMetadata = Record<string, unknown> & { k?: StoryKind };

const PAGE = 1000;

export function metadataOf(record: StoryRecord): StoryMetadata {
  return (record.provenance?.metadata ?? {}) as StoryMetadata;
}

/** The Kallamo kind of a stored record; holdings written outside Kallamo read as knowledge. */
export function kindOf(record: StoryRecord): StoryKind | 'awareness' {
  const kind = metadataOf(record).k;
  if (kind) return kind;
  if (record.kind === 'awareness') return 'awareness';
  if (record.kind === 'disposition') return 'relationship';
  if (record.kind === 'fact') return 'fact';
  return record.attitude === 'believes' || record.attitude === 'suspects' ? 'belief' : record.attitude === 'remembers' ? 'memory' : 'knowledge';
}

/** The proposition's object as Kallamo stores it: an entity is its id, a value is itself. */
export function objectOf(claim: Claim): unknown {
  const object = claim.object as { kind: string; id?: string; value?: unknown };
  if (object.kind === 'entity') return object.id;
  if (object.kind === 'value') return object.value;
  return null;
}

/** Whose statement it is, who it is about and what it says; for prose the predicate is left out. */
export function statementIdentityOf(holder: string, claim: Claim): string {
  return `${holder}\u0000${propositionIdentity(claim.subject, claim.predicate, objectOf(claim))}`;
}

export function memoryKey(summary: unknown): string {
  return statementKey(summary);
}

export interface ReadOptions {
  timelineId?: string;
  at?: At;
}

interface SnapshotCache { key: string; snapshot: StorySnapshot }
const CACHE = Symbol.for('kallamo.umwelt.snapshot');

/** Every current record of a timeline at one version, read once and reused until the story changes. */
export interface StorySnapshot {
  timelineId: string;
  version: number;
  maxTick: number;
  facts: StoryRecord[];
  holdings: HoldingItem[];
  dispositions: StoryRecord[];
  awareness: StoryRecord[];
}

/** Reads of the current story, on the timeline the turn lifecycle says is current. */
export class StoryReader {
  constructor(private readonly world: NarrativeWorld) {}

  timelineId(options: ReadOptions = {}): string {
    return options.timelineId ?? new StoryTimelines(this.world).readTimeline();
  }

  timeline(timelineId: string): Timeline {
    return this.world.call<Timeline>('timeline.get', { timelineId });
  }

  holdings(holder: string, options: ReadOptions & { about?: string; predicate?: string; includeWithheld?: boolean } = {}): HoldingItem[] {
    const items: HoldingItem[] = [];
    let cursor: string | undefined;
    do {
      const page = this.world.call<HoldingsResult>('holdings', {
        holder,
        timelineId: this.timelineId(options),
        filter: {
          includeWithheld: options.includeWithheld ?? true,
          ...(options.about ? { about: options.about } : {}),
          ...(options.predicate ? { predicate: options.predicate } : {})
        },
        ...(options.at ? { at: options.at } : {}),
        page: { limit: PAGE, ...(cursor ? { cursor } : {}) }
      });
      items.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return items;
  }

  facts(options: ReadOptions & { subject?: string; predicate?: string } = {}): StoryRecord[] {
    const items: StoryRecord[] = [];
    let cursor: string | undefined;
    do {
      const page = this.world.call<RecordPageResult>('canon', {
        timelineId: this.timelineId(options),
        filter: { ...(options.subject ? { subject: options.subject } : {}), ...(options.predicate ? { predicate: options.predicate } : {}) },
        ...(options.at ? { at: options.at } : {}),
        page: { limit: PAGE, ...(cursor ? { cursor } : {}) }
      });
      items.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return items;
  }

  dispositions(holder: string, options: ReadOptions & { target?: string; dimension?: string } = {}): StoryRecord[] {
    return this.world.call<StoryRecord[]>('dispositions', {
      holder,
      timelineId: this.timelineId(options),
      ...(options.target ? { target: options.target } : {}),
      ...(options.dimension ? { dimension: options.dimension } : {}),
      ...(options.at ? { at: options.at } : {})
    });
  }

  awareness(holder: string, options: ReadOptions = {}): StoryRecord[] {
    return this.world.call<PerspectiveResult>('perspective', {
      holder,
      timelineId: this.timelineId(options),
      ...(options.at ? { at: options.at } : {}),
      page: { limit: 1 }
    }).awareness;
  }

  /** Entities that can hold knowledge in this story. */
  holders(): string[] {
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = this.world.call<{ items: Entity[]; nextCursor?: string | null }>('entity.list', { page: { limit: PAGE, ...(cursor ? { cursor } : {}) } });
      for (const entity of page.items) {
        if (entity.typeId === 'agent' || entity.typeId === 'group') ids.push(entity.id);
      }
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return ids;
  }

  /** Every current record, reused while the timeline's version stays the same. */
  snapshot(options: ReadOptions = {}): StorySnapshot {
    const timelineId = this.timelineId(options);
    const head = this.timeline(timelineId);
    const key = JSON.stringify([timelineId, head.headVersion, options.at ?? null]);
    const holder = this.world as unknown as Record<symbol, SnapshotCache | undefined>;
    if (holder[CACHE]?.key === key) return holder[CACHE]!.snapshot;
    const read = { timelineId, ...(options.at ? { at: options.at } : {}) };
    const holders = this.holders();
    const snapshot: StorySnapshot = {
      timelineId,
      version: head.headVersion,
      maxTick: head.maxTick,
      facts: this.facts(read),
      holdings: holders.flatMap(id => this.holdings(id, read)),
      dispositions: holders.flatMap(id => this.dispositions(id, read)),
      awareness: holders.flatMap(id => this.awareness(id, read))
    };
    holder[CACHE] = { key, snapshot };
    return snapshot;
  }

  /** Drops the cached snapshot; writes call it so the next read sees them. */
  static invalidate(world: NarrativeWorld): void {
    (world as unknown as Record<symbol, SnapshotCache | undefined>)[CACHE] = undefined;
  }
}
