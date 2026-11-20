import type {
  Acquisition,
  CheckUtteranceResult,
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
import { relevanceOf } from '../memory-relevance';
import { kindOf, memoryKey, metadataOf, objectOf, statementIdentityOf, StoryReader, type StoryKind, type StoryMetadata } from './story-reader';
import { canonRelation, canonSlots, type CanonSlots } from './story-projection';

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

/** A secret told outside its circle, as the engine reported it. */
export interface StoryBreach { tellerId: string; hearerId: string; recordId: string }

/**
 * Someone passed on a statement the story never recorded them holding. `verdict` is the engine's
 * reading of what the teller holds instead; `canon` is the statement against canon's Facts.
 */
export interface StoryUnsupportedTelling {
  tellerId: string;
  hearerId: string;
  recordId: string;
  verdict?: 'holds-opposite' | 'holds-other-value' | 'withheld' | 'future' | 'unknown';
  canon?: 'aligned' | 'contradicted';
}

export interface StoryChecks { breaches: StoryBreach[]; unsupported: StoryUnsupportedTelling[] }

export interface StoryWriteResult {
  applied: string[];
  skipped: StorySkip[];
  outcome: CommitOutcome | null;
  checks: StoryChecks;
}

const PROSE_PREDICATE_TEXT = 220;

/** The engine's reserved predicate for what one holder thinks another holds. */
export const HOLDS_PREDICATE = 'umwelt:holds';

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
  private tellings: Array<{ tellerId: string; hearerId: string; recordId: string; sourced: boolean; secret: boolean }> = [];

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
    this.tellings = [];
    const claimed = this.sink?.claimed ?? new Set<string>();
    for (const operation of input.operations) {
      const reason = this.add(draft, operation, input, eventProvenance, claimed);
      if (reason) skipped.push({ operationId: operation.id, reason });
      else applied.push(operation.id);
    }
    if (!draft.records.length && !draft.transitions.length) return { applied: [], skipped, outcome: null, checks: { breaches: [], unsupported: [] } };
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
    const unsupported = this.tellings.filter(telling => !telling.sourced).map(({ tellerId, hearerId, recordId }) => ({ tellerId, hearerId, recordId }));
    if (this.sink) {
      this.sink.push(commit);
      return { applied, skipped, outcome: null, checks: { breaches: [], unsupported } };
    }
    const checked = this.withVerdicts(unsupported, draft);
    const outcome = this.world.call<CommitOutcome>('commit', commit);
    StoryReader.invalidate(this.world);
    // The engine decides what counts as a breach; it names none individually, so the secret tellings are listed.
    const breached = (outcome.warnings ?? []).some(warning => warning.code === 'SECRET_BREACH');
    const breaches = breached
      ? this.tellings.filter(telling => telling.secret).map(({ tellerId, hearerId, recordId }) => ({ tellerId, hearerId, recordId }))
      : [];
    return { applied, skipped, outcome, checks: { breaches, unsupported: checked } };
  }

  /**
   * Asks the engine what each teller holds about what they told. A teller who holds it after all
   * (the same claim in other words) is dropped; the rest say why the story has no record behind it.
   */
  private withVerdicts(tellings: StoryUnsupportedTelling[], draft: Draft): StoryUnsupportedTelling[] {
    let canon: CanonSlots | null = null;
    return tellings.flatMap(telling => {
      const record = draft.records.find(item => item.id === telling.recordId);
      if (!record || record.kind !== 'holding') return [telling];
      canon ??= canonSlots(new StoryReader(this.world).snapshot({ timelineId: this.timelineId }).facts);
      const relation = canonRelation(record.claim as Claim, canon);
      const withCanon = relation === 'unknown' ? telling : { ...telling, canon: relation };
      try {
        const result = this.world.call<CheckUtteranceResult>('check.utterance', { holder: telling.tellerId, claims: [record.claim], timelineId: this.timelineId });
        const item = result.items[0];
        if (item?.verdict === 'holds') return [];
        return [item ? { ...withCanon, verdict: item.verdict } : withCanon];
      } catch {
        // The check only explains a finding; without it the telling is still reported.
        return [withCanon];
      }
    });
  }

  private add(draft: Draft, operation: NarrativeOperation, input: StoryWrite, event: Provenance, claimed: Set<string>): string | null {
    // What a record needs of its event travels with it: the operation it came from and where that came from.
    const provenance = (metadata: StoryMetadata): Provenance => ({
      ...event,
      metadata: compact({ ...metadata, op: operation.id, originType: input.provenance.originType })
    });
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
        const entryMatches = memory.entryId
          ? this.activeOf(memory.subjectId, 'memory', { predicate: 'memory' }).filter(item => item.record.id !== memory.id && sameEntry(item.record, memory.entryId!)).map(item => item.record)
          : [];
        const previous = memory.supersedesMemoryId ? this.findById(memory.subjectId, memory.supersedesMemoryId) : null;
        // Memories gathered into one account end with it, each superseded by the merged memory.
        const merged = (memory.mergesMemoryIds ?? []).map(id => this.findById(memory.subjectId, id)).filter((record): record is StoryRecord => Boolean(record));
        const replaced = [...new Map([...(previous ? [previous] : []), ...entryMatches, ...merged].map(record => [record.id, record])).values()];
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
            k: 'memory', entryId: memory.entryId ?? memory.id, category: memory.category, salience: relevanceOf(memory.salience, memory.category),
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
        const heldById = kind === 'belief' && payload.heldById ? String(payload.heldById) : null;
        if (heldById && (heldById === holder || !this.isHolder(heldById))) return 'not-a-holder';
        const negated = payload.negated === true;
        const stated = this.claimOf(proposition);
        // Second order names the claim the other holder would hold by its key, which only the engine computes.
        const claim: Claim = heldById
          ? { subject: heldById, predicate: HOLDS_PREDICATE, object: { kind: 'value', value: { claimKey: this.claimKey(stated) } }, polarity: !negated }
          : { ...stated, polarity: !negated };
        const identity = statementIdentityOf(holder, claim);
        const entryId = payload.entryId ? String(payload.entryId) : undefined;
        // The interpreter mints a new entry for every record, so only an author's edit revises one by entry.
        const byEntry = Boolean(entryId) && input.provenance.interpreter !== 'model';
        const current = this.activeOf(holder, kind, {
          about: claim.subject,
          ...(byEntry || (!heldById && isProseStatement(proposition.object)) ? {} : { predicate: claim.predicate })
        });
        const supersedesId = payload.supersedesId ? String(payload.supersedesId) : null;
        // A correction may restate the claim about someone else, or turn a suspicion into knowledge,
        // so what it corrects is looked up among everything the holder holds.
        const corrected = supersedesId
          ? [...this.activeOf(holder, 'knowledge'), ...this.activeOf(holder, 'belief')].filter(item => item.record.id === supersedesId)
          : [];
        // Identity leaves polarity out: the same statement held the other way round revises the record.
        const revised = [...corrected, ...current.filter(item => item.record.id !== payload.id && item.record.id !== supersedesId && (
          (byEntry && sameEntry(item.record, entryId!))
          || (item.record.kind === 'holding' && statementIdentityOf(holder, item.record.claim) === identity)
        ))];
        if (payload.status !== 'active') {
          const targets = entryId
            ? current.filter(item => sameEntry(item.record, entryId))
            : current.filter(item => item.record.id === payload.id || (item.record.kind === 'holding' && statementIdentityOf(holder, item.record.claim) === identity)).slice(0, 1);
          if (!targets.length) return 'nothing-to-retire';
          for (const item of targets) draft.end(retirement(item.record.id, payload.status, payload.supersededBy));
          return null;
        }
        const informants = ids(payload.informantIds).filter(id => id !== holder && this.known.has(id));
        const premises = ids(payload.premiseIds);
        const method = kind === 'knowledge' ? payload.acquisition : informants.length ? 'reported' : premises.length ? 'inferred' : 'authored';
        const id = String(payload.id);
        draft.records.push({
          kind: 'holding', id, holder,
          attitude: kind === 'knowledge' ? 'knows' : payload.attitude === 'suspects' ? 'suspects' : 'believes',
          claim,
          acquisition: this.acquisitionOf(method, informants, input, identity, claim.subject, draft, { hearerId: holder, recordId: id }, {
            premises,
            intent: payload.intent === 'honest' || payload.intent === 'deceptive' ? payload.intent : 'unknown',
            sourceRecordId: payload.sourceRecordId ? String(payload.sourceRecordId) : null
          }),
          // A secret is kept by its holder; telling it outside its circle is reported, never blocked.
          ...(payload.category === 'secret' ? { secrecy: { sharedWith: ids(payload.sharedWith).filter(other => other !== holder && this.known.has(other)) } } : {}),
          confidence: clamp(payload.confidence), accessibility: accessibility(payload.accessibility),
          text: heldById ? this.secondOrderText(heldById, proposition, negated) : negated ? `It is not so that ${this.statementText(proposition)}` : this.statementText(proposition),
          provenance: provenance({
            k: kind, entryId, category: payload.category, factIds: ids(payload.factIds), salience: relevanceOf(payload.salience, payload.category),
            ...(kind === 'knowledge' ? { method: payload.acquisition, informantIds: informants } : { informantIds: informants }),
            ...(kind === 'belief' && payload.relationToCanon && payload.relationToCanon !== 'unknown' ? { relationToCanon: payload.relationToCanon } : {}),
            // What the other holder is thought to hold, readable without asking the engine for the key.
            ...(heldById ? { held: { subjectId: proposition.subjectId, predicate: stated.predicate, object: proposition.object } } : {})
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
    const text = factTextOf(claim, id => this.names.get(id), this.world.workspaceId);
    draft.records.push({ kind: 'fact', id, claim, provenance, ...(text ? { text } : {}) });
    for (const record of matches) draft.end({ targetRecordId: record.id, status: 'superseded', supersededBy: id });
    return null;
  }

  private claimOf(proposition: Proposition): Claim {
    return claimOfProposition(proposition, id => this.known.has(id));
  }

  /**
   * How a holder came to know something. Hearsay keeps its teller and, when the teller holds the
   * same statement, the record they told it from, so the chain can be traced back.
   */
  private acquisitionOf(
    method: unknown,
    informants: string[],
    input: StoryWrite,
    identity: string,
    aboutId: string,
    draft: Draft,
    hearing: { hearerId: string; recordId: string },
    told: { premises: string[]; intent: 'honest' | 'deceptive' | 'unknown'; sourceRecordId: string | null }
  ): Acquisition {
    if (method === 'witness' || method === 'participant') return { kind: 'witnessed', eventId: input.eventId };
    if (method === 'inferred') return { kind: 'inferred', fromRecordIds: told.premises, rule: 'narrative-analysis' };
    if (method === 'reported') {
      const teller = informants.find(id => this.isHolder(id));
      if (!teller) return { kind: 'evidence', evidenceId: input.eventId };
      const tellerRecords = (filter: { about?: string }) => this.activeOf(teller, 'knowledge', filter).concat(this.activeOf(teller, 'belief', filter));
      // Named outright, the teller's record may say something else: the hearer heard it wrong.
      const named = told.sourceRecordId ? tellerRecords({}).find(item => item.record.id === told.sourceRecordId) : undefined;
      const statement = identity.slice(identity.indexOf('\u0000') + 1);
      const said = (holder: string, claim: Claim) => statementIdentityOf(holder, claim) === `${teller}\u0000${statement}`;
      // The teller may have learned it in this same event, written just before.
      const pending = named ? undefined : draft.records.find(record => record.kind === 'holding' && record.holder === teller && said(record.holder, record.claim));
      const stored = named ?? tellerRecords({ about: aboutId }).find(item => item.record.kind === 'holding' && said(teller, item.record.claim));
      const sourceRecordId = (pending?.id ?? undefined) || stored?.record.id;
      const secret = Boolean((pending?.kind === 'holding' && pending.secrecy) || (stored?.record.kind === 'holding' && stored.record.secrecy));
      this.tellings.push({ tellerId: teller, ...hearing, sourced: Boolean(sourceRecordId), secret });
      return { kind: 'told-by', sourceHolderId: teller, intent: told.intent, ...(sourceRecordId ? { sourceRecordId } : {}) };
    }
    return { kind: 'authored' };
  }

  private claimKey(claim: Claim): string {
    return this.world.raw<{ claimKey: string }>('claim.key', { claim }).claimKey;
  }

  private secondOrderText(heldById: string, proposition: Proposition, negated: boolean): string {
    const other = this.names.get(heldById) || heldById;
    return `${other} ${negated ? 'does not hold' : 'holds'} that ${this.statementText(proposition)}`;
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

/**
 * What search and vectors read for a Fact: names instead of ids, and an occurrence's title and
 * summary instead of its JSON. A Fact about the world itself is stated without a subject.
 */
export function factTextOf(claim: Claim, nameOf: (id: string) => string | undefined, workspaceId: string): string {
  const value = objectOf(claim);
  const rendered = claim.object.kind === 'entity'
    ? nameOf(claim.object.id) ?? ''
    : value && typeof value === 'object' && !Array.isArray(value)
      ? [(value as Record<string, unknown>).title, (value as Record<string, unknown>).summary].filter(item => typeof item === 'string' && item.trim()).join(': ') || textOf(value)
      : value === undefined || value === null ? '' : String(value);
  const predicate = String(claim.predicate || '');
  const negation = claim.polarity === false ? 'not ' : '';
  // An occurrence is told by its own title and summary.
  const statement = isGenericPredicate(predicate) || predicate === 'recorded-occurrence'
    ? `${negation}${rendered}`
    : `${negation}${predicate.replace(/^state:/, '').replace(/[-_]+/g, ' ')} ${rendered}`;
  const subject = claim.subject === workspaceId ? '' : nameOf(claim.subject) ?? '';
  return (subject ? `${subject}: ${statement}` : statement).trim();
}

/** A proposition as the engine's claim: an object naming a known entity points at it. */
export function claimOfProposition(proposition: Proposition, isEntity: (id: string) => boolean): Claim {
  const object = proposition.object;
  const entityId = typeof object === 'string' ? object.trim() : '';
  return {
    subject: proposition.subjectId,
    predicate: String(proposition.predicate || 'statement').slice(0, PROSE_PREDICATE_TEXT),
    object: entityId && isEntity(entityId)
      ? { kind: 'entity', id: entityId }
      : object === undefined || object === null ? { kind: 'none' } : { kind: 'value', value: object },
    polarity: true
  };
}

/** A record written before entries existed is revised under its own id. */
function sameEntry(record: StoryRecord, entryId: string): boolean {
  const own = metadataOf(record).entryId;
  return own ? own === entryId : record.id === entryId;
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
    for (const key of ['subjectId', 'targetId', 'sourceEntityId', 'targetEntityId', 'entityId', 'heldById']) add(payload[key]);
    const proposition = payload.proposition as Proposition | undefined;
    if (proposition) {
      add(proposition.subjectId);
      if (typeof proposition.object === 'string' && proposition.object.trim().length <= 200) candidates.add(proposition.object.trim());
    }
    for (const key of ['informantIds', 'relatedEntityIds', 'sharedWith']) for (const id of ids(payload[key])) found.add(id);
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
