import type {
  Acquisition,
  Claim,
  CommitOutcome,
  HoldingItem,
  Origin,
  Provenance,
  Record as StoryRecord,
  RecordInput,
  TransitionInput,
  TransitionStatus
} from '@kallamo/umwelt' with { 'resolution-mode': 'import' };
import type { NarrativeOperation, Proposition } from '../../../../narrative/contracts';
import { isGenericPredicate, isProseStatement, propositionIdentity } from '../../../../narrative/narrative-taxonomy';
import { STORY_AXIS, STORY_PROJECT, type NarrativeWorld, type StoryEntityType } from './narrative-world';
import { kindOf, memoryKey, metadataOf, objectOf, statementIdentityOf, StoryReader, type StoryKind, type StoryMetadata } from './story-reader';

export interface StoryProvenanceInput {
  interpreter: 'model' | 'user' | 'deterministic' | 'import';
  interpreterId?: string;
  promptVersion?: string;
  originType?: string;
  originId?: string;
  excerpt?: string;
}

export interface StoryWrite {
  eventId: string;
  type: string;
  description: string;
  participants: string[];
  locationId?: string | null;
  provenance: StoryProvenanceInput;
  storyMinute?: number | null;
  operations: NarrativeOperation[];
  attemptId: string;
}

export interface StorySkip { operationId: string; reason: string }

/** Collects commits instead of sending them, for a batch that is sent in one transaction. */
export interface StoryCommitSink {
  push(commit: Record<string, unknown>): void;
  /** Pairs and slots claimed by earlier commits of the batch, which the engine has not seen yet. */
  claimed: Set<string>;
  /** Reads shared by every commit of the batch, which all start from the same story. */
  reads: Map<string, unknown>;
  tick?: number;
}

export interface StoryWriteResult {
  applied: string[];
  skipped: StorySkip[];
  outcome: CommitOutcome | null;
}

const PROSE_PREDICATE_TEXT = 220;

function originOf(provenance: StoryProvenanceInput): Origin {
  if (provenance.interpreter === 'model') return { kind: 'model', model: provenance.interpreterId || 'unknown' };
  if (provenance.interpreter === 'user') return provenance.interpreterId ? { kind: 'human', actorId: provenance.interpreterId } : { kind: 'human' };
  if (provenance.interpreter === 'import') return { kind: 'import' };
  return { kind: 'system', name: provenance.interpreterId || 'kallamo' };
}

function compact<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined && item !== null
    && !(Array.isArray(item) && item.length === 0))) as T;
}

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : JSON.stringify(value);
}

/** Retirement statuses Kallamo writes, as the transition each one becomes. */
function transitionStatus(status: unknown): TransitionStatus {
  if (status === 'forgotten') return 'forgotten';
  if (status === 'abandoned') return 'abandoned';
  if (status === 'revoked' || status === 'removed' || status === 'retired') return 'revoked';
  return 'retracted';
}

// A record ends once per commit: a revision that also removes the old entry must not end it twice.
class Draft {
  readonly records: RecordInput[] = [];
  readonly transitions: TransitionInput[] = [];
  private readonly ended = new Set<string>();

  end(transition: TransitionInput): void {
    if (this.ended.has(transition.targetRecordId)) return;
    this.ended.add(transition.targetRecordId);
    this.transitions.push(transition);
  }
}

/**
 * Turns Kallamo narrative operations into one Umwelt commit. Revisions supersede the record they
 * revise and retirements become transitions, so every earlier state stays readable.
 */
export class StoryWriter {
  private readonly reader: StoryReader;
  private known = new Map<string, StoryEntityType>();
  private readonly holdingsCache: Map<string, unknown>;
  private names = new Map<string, string>();

  constructor(private readonly world: NarrativeWorld, private readonly timelineId: string, private readonly sink?: StoryCommitSink) {
    this.reader = new StoryReader(world);
    this.holdingsCache = sink?.reads ?? new Map();
  }

  write(input: StoryWrite): StoryWriteResult {
    const skipped: StorySkip[] = [];
    const applied: string[] = [];
    const referenced = referencedIds(input);
    this.known = this.world.ensureEntities([this.world.workspaceId, ...referenced.ids], referenced.candidates);
    this.names = this.world.names([...this.known.keys()]);
    const eventProvenance: Provenance = {
      origin: originOf(input.provenance),
      metadata: compact({
        originType: input.provenance.originType,
        originId: input.provenance.originId,
        promptVersion: input.provenance.promptVersion,
        excerpt: input.provenance.excerpt
      })
    };
    const draft = new Draft();
    const claimed = this.sink?.claimed ?? new Set<string>();
    for (const operation of input.operations) {
      const reason = this.add(draft, operation, input, eventProvenance, claimed);
      if (reason) skipped.push({ operationId: operation.id, reason });
      else applied.push(operation.id);
    }
    if (!draft.records.length && !draft.transitions.length) return { applied: [], skipped, outcome: null };
    const tick = this.nextTick();
    const commit = {
      projectId: STORY_PROJECT,
      attemptId: input.attemptId,
      timelineId: this.timelineId,
      event: compact({
        id: input.eventId,
        type: input.type || 'custom',
        title: (input.description || input.type || 'Story event').trim().slice(0, 120) || 'Story event',
        description: input.description,
        position: { tick },
        on: Number.isSafeInteger(input.storyMinute) ? { [STORY_AXIS]: input.storyMinute as number } : undefined,
        participants: [...new Set(input.participants.filter(id => this.known.has(id)))],
        location: input.locationId && this.known.has(input.locationId) ? input.locationId : undefined,
        provenance: eventProvenance
      }),
      records: draft.records,
      transitions: draft.transitions
    };
    if (this.sink) {
      this.sink.push(commit);
      return { applied, skipped, outcome: null };
    }
    const outcome = this.world.call<CommitOutcome>('commit', commit);
    StoryReader.invalidate(this.world);
    return { applied, skipped, outcome };
  }

  private add(draft: Draft, operation: NarrativeOperation, input: StoryWrite, event: Provenance, claimed: Set<string>): string | null {
    const provenance = (metadata: StoryMetadata): Provenance => ({ ...event, metadata: compact({ ...metadata, op: operation.id }) });
    switch (operation.type) {
      case 'record-observation': {
        const observation = operation.observation as unknown as Record<string, unknown>;
        const subjectId = String(observation.subjectId ?? '');
        if (!this.isHolder(subjectId)) return 'not-a-holder';
        const previous = observation.supersedesObservationId ? this.findById(subjectId, String(observation.supersedesObservationId)) : null;
        if ((observation.status ?? 'active') !== 'active') {
          if (!previous) return 'nothing-to-retire';
          draft.end({ targetRecordId: previous.id, status: 'revoked' });
          return null;
        }
        const id = String(observation.id);
        draft.records.push({
          kind: 'holding', id, holder: subjectId, attitude: 'knows',
          claim: { subject: subjectId, predicate: 'observation', object: { kind: 'value', value: memoryKey(observation.summary) }, polarity: true },
          acquisition: { kind: 'witnessed', eventId: input.eventId },
          confidence: clamp(observation.confidence), accessibility: accessibility(observation.accessibility),
          text: String(observation.summary ?? ''),
          provenance: provenance({ k: 'observation', method: observation.method, factIds: ids(observation.factIds) })
        });
        if (previous) draft.end({ targetRecordId: previous.id, status: 'superseded', supersededBy: id });
        return null;
      }
      case 'grant-awareness': {
        const { subjectId, targetId, status } = operation.awareness;
        if (!this.isHolder(subjectId)) return 'not-a-holder';
        if (!this.known.has(targetId)) return 'unknown-entity';
        const current = this.awarenessOf(subjectId).filter(record => record.kind === 'awareness' && record.target === targetId);
        if (status !== 'active') {
          if (!current.length) return 'nothing-to-retire';
          for (const record of current) draft.end({ targetRecordId: record.id, status: transitionStatus(status) });
          return null;
        }
        const pair = `aware\u0000${subjectId}\u0000${targetId}`;
        if (current.length || claimed.has(pair)) return 'already-aware';
        claimed.add(pair);
        draft.records.push({ kind: 'awareness', id: operation.awareness.id, holder: subjectId, target: targetId, provenance: provenance({}) });
        return null;
      }
      case 'set-relationship': {
        const relationship = operation.relationship;
        const holder = relationship.sourceEntityId;
        if (!this.isHolder(holder)) return 'not-a-holder';
        if (!this.known.has(relationship.targetEntityId)) return 'unknown-entity';
        const dimension = String(relationship.dimension || 'overall');
        // One current value per pair and dimension: a new value or a retirement ends the last one.
        const current = this.reader.dispositions(holder, { timelineId: this.timelineId, target: relationship.targetEntityId })
          .filter(record => record.kind === 'disposition' && record.dimension.toLowerCase() === dimension.toLowerCase());
        if (relationship.status === 'retired') {
          if (!current.length) return 'nothing-to-retire';
          for (const record of current) draft.end({ targetRecordId: record.id, status: 'revoked' });
          return null;
        }
        const pair = `rel\u0000${holder}\u0000${relationship.targetEntityId}\u0000${dimension.toLowerCase()}`;
        if (claimed.has(pair)) return 'duplicate-in-event';
        claimed.add(pair);
        draft.records.push({
          kind: 'disposition', id: relationship.id, holder, target: relationship.targetEntityId, dimension,
          value: Number(relationship.value),
          provenance: provenance({
            k: 'relationship', title: relationship.title, description: relationship.description, cause: relationship.cause,
            previousValue: relationship.previousValue, requestedValue: relationship.requestedValue, occurredOn: relationship.occurredOn,
            evidenceIds: ids(operation.evidenceIds)
          })
        });
        for (const record of current) draft.end({ targetRecordId: record.id, status: 'superseded', supersededBy: relationship.id });
        return null;
      }
      case 'record-memory': {
        const memory = operation.memory;
        if (!this.isHolder(memory.subjectId)) return 'not-a-holder';
        // A memory is revised under a stable entry, so an edit replaces it however often it is edited.
        const sameEntry = memory.entryId
          ? this.activeOf(memory.subjectId, 'memory', { predicate: 'memory' }).filter(item => item.record.id !== memory.id && metadataOf(item.record).entryId === memory.entryId).map(item => item.record)
          : [];
        const previous = memory.supersedesMemoryId ? this.findById(memory.subjectId, memory.supersedesMemoryId) : null;
        const replaced = [...new Map([...(previous ? [previous] : []), ...sameEntry].map(record => [record.id, record])).values()];
        const status = memory.status ?? 'active';
        if (status !== 'active') {
          const targets = replaced.length ? replaced : [this.findById(memory.subjectId, memory.id)].filter((record): record is StoryRecord => Boolean(record));
          if (!targets.length) return 'nothing-to-retire';
          for (const target of targets) draft.end({ targetRecordId: target.id, status: transitionStatus(status) });
          return null;
        }
        draft.records.push({
          kind: 'holding', id: memory.id, holder: memory.subjectId, attitude: 'remembers',
          claim: { subject: memory.subjectId, predicate: 'memory', object: { kind: 'value', value: memoryKey(memory.summary) }, polarity: true },
          acquisition: { kind: 'witnessed', eventId: input.eventId },
          confidence: 1, accessibility: accessibility(memory.accessibility),
          text: memory.summary,
          provenance: provenance({
            k: 'memory', entryId: memory.entryId ?? memory.id, category: memory.category,
            relatedEntityIds: ids(memory.relatedEntityIds).filter(id => this.known.has(id)), occurredOn: memory.occurredOn
          })
        });
        for (const record of replaced) draft.end({ targetRecordId: record.id, status: 'superseded', supersededBy: memory.id });
        return null;
      }
      case 'grant-knowledge':
      case 'set-belief': {
        const kind: StoryKind = operation.type === 'grant-knowledge' ? 'knowledge' : 'belief';
        const payload = (operation.type === 'grant-knowledge' ? operation.knowledge : operation.belief) as unknown as Record<string, unknown>;
        const holder = String(payload.subjectId ?? '');
        const proposition = payload.proposition as Proposition;
        if (!this.isHolder(holder)) return 'not-a-holder';
        if (!proposition || !this.known.has(proposition.subjectId)) return 'unknown-entity';
        const claim = this.claimOf(proposition);
        const identity = statementIdentityOf(holder, claim);
        const entryId = payload.entryId ? String(payload.entryId) : undefined;
        const current = this.activeOf(holder, kind, { about: proposition.subjectId });
        const revised = current.filter(item => item.record.id !== payload.id && (
          (entryId && metadataOf(item.record).entryId === entryId)
          || (item.record.kind === 'holding' && statementIdentityOf(holder, item.record.claim) === identity)
        ));
        if (payload.status !== 'active') {
          const targets = entryId
            ? current.filter(item => metadataOf(item.record).entryId === entryId)
            : current.filter(item => item.record.id === payload.id || (item.record.kind === 'holding' && statementIdentityOf(holder, item.record.claim) === identity)).slice(0, 1);
          if (!targets.length) return 'nothing-to-retire';
          for (const item of targets) draft.end(retirement(item.record.id, payload.status, payload.supersededBy));
          return null;
        }
        const informants = ids(payload.informantIds).filter(id => id !== holder && this.known.has(id));
        const id = String(payload.id);
        draft.records.push({
          kind: 'holding', id, holder,
          attitude: kind === 'knowledge' ? 'knows' : 'believes',
          claim,
          acquisition: this.acquisitionOf(kind === 'knowledge' ? payload.acquisition : 'authored', informants, input, identity, proposition.subjectId, draft),
          confidence: clamp(payload.confidence), accessibility: accessibility(payload.accessibility),
          text: this.statementText(proposition),
          provenance: provenance({
            k: kind, entryId, category: payload.category, factIds: ids(payload.factIds),
            ...(kind === 'knowledge' ? { method: payload.acquisition, informantIds: informants } : {}),
            ...(kind === 'belief' && payload.relationToCanon && payload.relationToCanon !== 'unknown' ? { relationToCanon: payload.relationToCanon } : {})
          })
        });
        for (const item of revised) draft.end({ targetRecordId: item.record.id, status: 'superseded', supersededBy: id });
        return null;
      }
      case 'assert-fact': {
        const fact = operation.fact as unknown as Record<string, unknown>;
        const proposition = fact.proposition as Proposition;
        if (!proposition || !this.known.has(proposition.subjectId)) return 'unknown-entity';
        const referenceId = fact.referenceId ? String(fact.referenceId) : occurrenceReference(proposition.object);
        return this.addFact(draft, String(fact.id), proposition, fact.status, provenance({
          k: 'fact', referenceId, category: fact.category,
          relatedEntityIds: ids(fact.relatedEntityIds).filter(id => this.known.has(id)), evidenceIds: ids(fact.evidenceIds)
        }), referenceId);
      }
      case 'set-state': {
        const state = operation.state;
        if (!this.known.has(state.entityId)) return 'unknown-entity';
        const proposition = { subjectId: state.entityId, predicate: `state:${state.property}`, object: state.value };
        return this.addFact(draft, operation.id, proposition, state.status === 'retired' ? 'retired' : 'active', provenance({ k: 'state' }), undefined, true);
      }
    }
    return 'unsupported';
  }

  private addFact(draft: Draft, id: string, proposition: Proposition, status: unknown, provenance: Provenance, referenceId?: string, slot = false): string | null {
    const claim = this.claimOf(proposition);
    const identity = propositionIdentity(claim.subject, claim.predicate, objectOf(claim));
    // A specific predicate is one slot per subject; under a generic one each sentence stands alone.
    const sameSlot = slot || !isGenericPredicate(claim.predicate);
    const current = this.reader.facts({ timelineId: this.timelineId, subject: claim.subject }).filter(record => record.kind === 'fact');
    const matches = current.filter(record => {
      if (record.kind !== 'fact' || record.id === id) return false;
      if (referenceId && metadataOf(record).referenceId === referenceId) return true;
      if (referenceId && metadataOf(record).referenceId) return false;
      if (propositionIdentity(record.claim.subject, record.claim.predicate, objectOf(record.claim)) === identity) return true;
      return sameSlot && record.claim.predicate === claim.predicate;
    });
    if ((status ?? 'active') !== 'active') {
      if (!matches.length) return 'nothing-to-retire';
      for (const record of matches) draft.end({ targetRecordId: record.id, status: transitionStatus(status) });
      return null;
    }
    draft.records.push({ kind: 'fact', id, claim, provenance });
    for (const record of matches) draft.end({ targetRecordId: record.id, status: 'superseded', supersededBy: id });
    return null;
  }

  private claimOf(proposition: Proposition): Claim {
    const object = proposition.object;
    const entityId = typeof object === 'string' ? object.trim() : '';
    return {
      subject: proposition.subjectId,
      predicate: String(proposition.predicate || 'statement').slice(0, PROSE_PREDICATE_TEXT),
      object: entityId && this.known.has(entityId)
        ? { kind: 'entity', id: entityId }
        : object === undefined || object === null ? { kind: 'none' } : { kind: 'value', value: object },
      polarity: true
    };
  }

  /**
   * How a holder came to know something. Hearsay keeps its teller and, when the teller holds the
   * same statement, the record they told it from, so the chain can be traced back.
   */
  private acquisitionOf(method: unknown, informants: string[], input: StoryWrite, identity: string, aboutId: string, draft: Draft): Acquisition {
    if (method === 'witness' || method === 'participant') return { kind: 'witnessed', eventId: input.eventId };
    if (method === 'inferred') return { kind: 'inferred', fromRecordIds: [], rule: 'narrative-analysis' };
    if (method === 'reported') {
      const teller = informants.find(id => this.isHolder(id));
      if (!teller) return { kind: 'evidence', evidenceId: input.eventId };
      const statement = identity.slice(identity.indexOf('\u0000') + 1);
      const said = (holder: string, claim: Claim) => statementIdentityOf(holder, claim) === `${teller}\u0000${statement}`;
      // The teller may have learned it in this same event, written just before.
      const pending = draft.records.find(record => record.kind === 'holding' && record.holder === teller && said(record.holder, record.claim));
      const stored = this.activeOf(teller, 'knowledge', { about: aboutId }).concat(this.activeOf(teller, 'belief', { about: aboutId }))
        .find(item => item.record.kind === 'holding' && said(teller, item.record.claim));
      const sourceRecordId = (pending?.id ?? undefined) || stored?.record.id;
      return { kind: 'told-by', sourceHolderId: teller, intent: 'unknown', ...(sourceRecordId ? { sourceRecordId } : {}) };
    }
    return { kind: 'authored' };
  }

  private statementText(proposition: Proposition): string {
    const subject = this.names.get(proposition.subjectId) || proposition.subjectId;
    const object = proposition.object;
    const rendered = typeof object === 'string' && this.names.has(object.trim())
      ? this.names.get(object.trim())!
      : textOf(object);
    return isProseStatement(object)
      ? `${subject}: ${rendered}`
      : `${subject}: ${String(proposition.predicate || '').replace(/[-_]+/g, ' ')} ${rendered}`.trim();
  }

  private activeOf(holder: string, kind: StoryKind, filter: { about?: string; predicate?: string } = {}): HoldingItem[] {
    const key = `holdings\u0000${holder}\u0000${filter.about ?? ''}\u0000${filter.predicate ?? ''}`;
    let items = this.holdingsCache.get(key) as HoldingItem[] | undefined;
    if (!items) {
      items = this.reader.holdings(holder, { timelineId: this.timelineId, ...filter });
      this.holdingsCache.set(key, items);
    }
    return items.filter(item => kindOf(item.record) === kind);
  }

  private awarenessOf(holder: string): StoryRecord[] {
    const key = `awareness\u0000${holder}`;
    let records = this.holdingsCache.get(key) as StoryRecord[] | undefined;
    if (!records) {
      records = this.reader.awareness(holder, { timelineId: this.timelineId });
      this.holdingsCache.set(key, records);
    }
    return records;
  }

  /** A memory or observation by its id; each kind is held under its own predicate. */
  private findById(holder: string, id: string): StoryRecord | null {
    for (const kind of ['memory', 'observation'] as StoryKind[]) {
      const found = this.activeOf(holder, kind, { predicate: kind }).find(item => item.record.id === id);
      if (found) return found.record;
    }
    return null;
  }

  private isHolder(id: string): boolean {
    const type = this.known.get(id);
    return type === 'agent' || type === 'group';
  }

  private nextTick(): number {
    if (this.sink?.tick !== undefined) return this.sink.tick;
    const tick = this.readNextTick();
    if (this.sink) this.sink.tick = tick;
    return tick;
  }

  private readNextTick(): number {
    const main = this.reader.timeline('main');
    if (this.timelineId === 'main') return main.maxTick + 1;
    return Math.max(main.maxTick, this.reader.timeline(this.timelineId).maxTick) + 1;
  }
}

/** Each recorded occurrence of an event is its own Fact, revised by its occurrence id. */
function occurrenceReference(object: unknown): string | undefined {
  const id = object && typeof object === 'object' ? (object as Record<string, unknown>).occurrenceId : undefined;
  return typeof id === 'string' && id ? `occurrence:${id}` : undefined;
}

function retirement(targetRecordId: string, status: unknown, supersededBy: unknown): TransitionInput {
  if (status === 'superseded' && typeof supersededBy === 'string' && supersededBy) {
    return { targetRecordId, status: 'superseded', supersededBy };
  }
  return { targetRecordId, status: transitionStatus(status) };
}

function clamp(value: unknown): number {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(1, number)) : 1;
}

function accessibility(value: unknown): 'available' | 'suppressed' | 'inaccessible' {
  return value === 'suppressed' || value === 'inaccessible' ? value : 'available';
}

function ids(value: unknown): string[] {
  return Array.isArray(value) ? [...new Set(value.filter((item): item is string => typeof item === 'string' && Boolean(item)))] : [];
}

/** Every entity id an event names, and the values that may be one, so the story registers them first. */
function referencedIds(input: StoryWrite): { ids: string[]; candidates: string[] } {
  const found = new Set<string>([...input.participants, ...(input.locationId ? [input.locationId] : [])]);
  const candidates = new Set<string>();
  const add = (value: unknown) => { if (typeof value === 'string' && value.trim()) found.add(value.trim()); };
  for (const operation of input.operations) {
    const payload = (operation as unknown as Record<string, Record<string, unknown>>)[payloadKey(operation)] ?? {};
    for (const key of ['subjectId', 'targetId', 'sourceEntityId', 'targetEntityId', 'entityId']) add(payload[key]);
    const proposition = payload.proposition as Proposition | undefined;
    if (proposition) {
      add(proposition.subjectId);
      if (typeof proposition.object === 'string' && proposition.object.trim().length <= 200) candidates.add(proposition.object.trim());
    }
    for (const key of ['informantIds', 'relatedEntityIds']) for (const id of ids(payload[key])) found.add(id);
  }
  return { ids: [...found], candidates: [...candidates] };
}

function payloadKey(operation: NarrativeOperation): string {
  switch (operation.type) {
    case 'assert-fact': return 'fact';
    case 'set-state': return 'state';
    case 'record-observation': return 'observation';
    case 'grant-awareness': return 'awareness';
    case 'grant-knowledge': return 'knowledge';
    case 'set-belief': return 'belief';
    case 'record-memory': return 'memory';
    case 'set-relationship': return 'relationship';
  }
}
