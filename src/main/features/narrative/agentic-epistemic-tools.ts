import type Database from 'better-sqlite3';
import { EpistemicResolver } from './epistemic-resolver';
import { RoleplaySystem } from './roleplay-system';
import { isFactionOccurrenceMemoryShared } from '../worldbuild/event-occurrences';
import { sharedKnowledgeCards } from '../worldbuild/knowledge-groups';
import { currentNarrativeSequence, loadCurrentNarrativeRecords } from './narrative-record-projection';
import type { CompareResult, Record as StoryRecord } from '@kallamo/umwelt' with { 'resolution-mode': 'import' };
import { NarrativeWorld } from './umwelt/narrative-world';
import { objectOf, StoryReader } from './umwelt/story-reader';
import { searchStory } from './umwelt/story-search';
import { traceStoryRecord } from './umwelt/story-insights';

// Lines one story tool answer may hold, and characters per line, so a broad question never floods the planner.
const STORY_TOOL_LINES = 10;
const STORY_TOOL_TEXT = 240;
// Searched across every holder, so it reads fewer words of the query than a single search.
const WHO_KNOWS_TERMS = 3;
const GENERIC_PREDICATES = new Set(['statement', 'worldbuild-statement']);

interface EntityRow {
  id: string;
  canonicalName: string;
  aliases: string | null;
}

export class AgenticEpistemicTools {
  private readonly roleplay: RoleplaySystem;
  private readonly resolver: EpistemicResolver;

  constructor(private readonly db: Database.Database) {
    this.roleplay = new RoleplaySystem(db);
    this.resolver = new EpistemicResolver(db);
  }

  scanSceneAwareness(workspaceId: string, query = ''): string {
    const scene = this.roleplay.getScene(workspaceId);
    const playerId = this.roleplay.getSettings(workspaceId).playerEntityId
      ?? (scene?.perspective.access === 'subjective' ? scene.perspective.focalSubjectId : undefined);
    const subjectIds = unique([
      playerId,
      ...(scene?.participantIds ?? []),
      ...(scene?.possibleObserverIds ?? []),
      ...(scene?.nearbyIds ?? [])
    ]);
    const targetIds = unique([
      scene?.locationId,
      ...(scene?.participantIds ?? []),
      ...(scene?.objectIds ?? []),
      ...this.resolveMentionedEntityIds(workspaceId, query)
    ]);
    const names = this.entityNames(workspaceId, unique([...subjectIds, ...targetIds]));
    const through = { sequence: this.latestSequence(workspaceId) };
    const assessments = this.resolver.resolve({ workspaceId, subjectIds, targetIds, through }).assessments;
    if (!assessments.length) return 'No scene Awareness pairs are available.';
    return assessments.map(assessment => {
      const subject = names.get(assessment.subjectId) ?? assessment.subjectId;
      const target = names.get(assessment.targetId) ?? assessment.targetId;
      return `${subject} -> ${target}: ${assessment.state}`;
    }).join('\n');
  }

  inspectSubjectKnowledge(workspaceId: string, query: string): string {
    const pair = this.resolvePair(workspaceId, query);
    if (!pair) return 'Use "subject | target" with two known entity names.';
    const assessment = this.resolver.resolve({
      workspaceId,
      subjectIds: [pair.subject.id],
      targetIds: [pair.target.id],
      through: { sequence: this.latestSequence(workspaceId) }
    }).assessments[0];
    // The subject's own card first, then what a faction or a place they are local to shares.
    const cards = [
      ...this.db.prepare(`
        SELECT card_id AS cardId, known_as AS knownAs, owner_id AS sourceOwnerId
        FROM worldbuild_knowledge_cards
        WHERE workspace_id = ? AND owner_id = ? AND target_id = ? AND status = 'active'
      `).all(workspaceId, pair.subject.id, pair.target.id) as Array<{ cardId: string; knownAs: string | null; sourceOwnerId: string }>,
      ...sharedKnowledgeCards(this.db, workspaceId, [pair.subject.id], [pair.target.id])
        .map(card => ({ cardId: card.cardId, knownAs: card.knownAs, sourceOwnerId: card.groupId }))
    ];
    const fields = unique(cards.flatMap(card => this.db.prepare(`
      SELECT field_key AS fieldKey FROM worldbuild_known_fields
      WHERE workspace_id = ? AND card_id = ? ORDER BY field_key
    `).all(workspaceId, card.cardId).map(row => String((row as { fieldKey: string }).fieldKey))));
    const relationships = unique(cards.flatMap(card => this.db.prepare(`
      SELECT from_name AS fromName, relation_type AS relationType,
        relation_label AS relationLabel, to_name AS toName, metadata_json AS metadataJson
      FROM worldbuild_known_relationships
      WHERE workspace_id = ? AND card_id = ?
      ORDER BY created_at, from_name, to_name
    `).all(workspaceId, card.cardId).map(row => {
      const relationship = row as {
        fromName: string; relationType: string; relationLabel: string | null;
        toName: string; metadataJson: string | null;
      };
      return `${relationship.fromName} / ${relationship.relationType} / ${relationship.toName}`;
    })));
    const records = loadCurrentNarrativeRecords(this.db, {
      workspaceId,
      recordTypes: ['knowledge', 'belief'],
      subjectIds: unique([pair.subject.id, ...cards.map(card => card.sourceOwnerId)]),
    }).filter(({ payload }) => {
      const proposition = objectValue(payload.proposition);
      return proposition.subjectId === pair.target.id;
    });
    const details = records.map(({ row, payload }) => {
      if (row.record_type === 'knowledge' && accessibility(payload.accessibility) !== 'available') {
        return `${row.record_type}: unavailable (${accessibility(payload.accessibility)})`;
      }
      // A tool answer that omits how a statement was acquired invites the model to treat
      // hearsay as something the subject saw for themselves.
      const informants = Array.isArray(payload.informantIds)
        ? payload.informantIds.map(id => this.entityName(workspaceId, String(id))).filter(Boolean)
        : [];
      const attribution = row.record_type === 'knowledge' && typeof payload.acquisition === 'string'
        ? ` [${payload.acquisition}${informants.length ? ` by ${informants.join(', ')}` : ''}]`
        : '';
      return `${row.record_type}: ${formatPayload(payload)}${attribution}`;
    });
    return [
      `${pair.subject.canonicalName} -> ${pair.target.canonicalName}: ${assessment?.state ?? 'undetermined'}`,
      `Known as: ${cards.find(card => card.sourceOwnerId === pair.subject.id)?.knownAs
        || cards.find(card => card.knownAs)?.knownAs
        || pair.target.canonicalName}`,
      `Known fields: ${fields.length ? fields.join(', ') : 'none'}`,
      `Known relationships: ${relationships.length ? relationships.join(' | ') : 'none'}`,
      ...(details.length ? details : ['Specific statements: none'])
    ].join('\n');
  }

  inspectSubjectEvidence(workspaceId: string, query: string): string {
    const pair = this.resolvePair(workspaceId, query);
    if (!pair) return 'Use "subject | target" with two known entity names.';
    const assessment = this.resolver.resolve({
      workspaceId,
      subjectIds: [pair.subject.id],
      targetIds: [pair.target.id],
      through: { sequence: this.latestSequence(workspaceId) }
    }).assessments[0];
    if (!assessment) return 'No assessment was produced.';
    return [
      `Assessment: ${assessment.state}`,
      `Sources: ${assessment.sourceIds.join(', ') || 'none'}`,
      `Evidence: ${assessment.evidence || 'none'}`
    ].join('\n');
  }

  inspectSubjectRelationships(workspaceId: string, subjectQuery: string): string {
    const subject = this.resolveEntity(workspaceId, subjectQuery);
    if (!subject) return 'No known subject matched.';
    const rows = this.db.prepare(`
      SELECT links.relType, links.label, target.canonicalName AS targetName,
        links.metadata_json AS metadata
      FROM entity_links links
      JOIN entities target ON target.workspaceId = links.workspaceId AND target.id = links.toId
      WHERE links.workspaceId = ? AND links.fromId = ?
      ORDER BY links.createdAt DESC LIMIT 20
    `).all(workspaceId, subject.id) as Array<Record<string, unknown>>;
    if (!rows.length) return `${subject.canonicalName} has no current outgoing structural relationships.`;
    return rows.map(row => {
      const metadata = parseObject(row.metadata);
      const description = String(metadata.description ?? '').trim();
      return `${subject.canonicalName} -> ${String(row.targetName)}: ${String(row.label || row.relType)}${description ? `; ${description}` : ''}`;
    }).join('\n');
  }

  inspectSubjectMemories(workspaceId: string, query: string): string {
    const [subjectQuery, topic = ''] = splitPair(query);
    const subject = this.resolveEntity(workspaceId, subjectQuery);
    if (!subject) return 'No known subject matched.';
    const rows = loadCurrentNarrativeRecords(this.db, {
      workspaceId,
      recordTypes: ['memory'],
    }).filter(({ row }) => row.subject_id === subject.id || isFactionOccurrenceMemoryShared(
      this.db,
      workspaceId,
      row.source_event_id,
      row.subject_id,
      subject.id
    ));
    const normalizedTopic = topic.toLocaleLowerCase();
    const memories = rows
      .map(({ payload }) => accessibility(payload.accessibility) === 'available'
        ? formatPayload(payload)
        : `memory: unavailable (${accessibility(payload.accessibility)})`)
      .filter(memory => !normalizedTopic || memory.toLocaleLowerCase().includes(normalizedTopic))
      .slice(0, 10);
    return memories.length ? memories.join('\n') : `No matching active memories were found for ${subject.canonicalName}.`;
  }

  private resolvePair(workspaceId: string, query: string) {
    const [subjectQuery, targetQuery] = splitPair(query);
    if (!subjectQuery || !targetQuery) return null;
    const subject = this.resolveEntity(workspaceId, subjectQuery);
    const target = this.resolveEntity(workspaceId, targetQuery);
    return subject && target ? { subject, target } : null;
  }

  private resolveEntity(workspaceId: string, query: string): EntityRow | null {
    const normalized = query.trim().toLocaleLowerCase();
    if (!normalized) return null;
    const rows = this.db.prepare(`
      SELECT id, canonicalName, aliases FROM entities
      WHERE workspaceId = ? AND status != 'proposed'
    `).all(workspaceId) as EntityRow[];
    return rows.find(row => {
      const names = [row.canonicalName, ...parseAliases(row.aliases)];
      return names.some(name => name.toLocaleLowerCase() === normalized);
    }) ?? null;
  }

  private resolveMentionedEntityIds(workspaceId: string, query: string): string[] {
    const normalized = query.toLocaleLowerCase();
    if (!normalized.trim()) return [];
    const rows = this.db.prepare(`
      SELECT id, canonicalName, aliases FROM entities
      WHERE workspaceId = ? AND status != 'proposed'
    `).all(workspaceId) as EntityRow[];
    return rows.flatMap(row => {
      const matches = [row.canonicalName, ...parseAliases(row.aliases)].some(name => {
        const candidate = name.trim().toLocaleLowerCase();
        return candidate.length >= 2 && normalized.includes(candidate);
      });
      return matches ? [row.id] : [];
    });
  }

  /** Facts and earlier scenes close to the query, by its words and meaning: narrator material. */
  recallStory(workspaceId: string, query: string, vector: number[] | null = null): string {
    const facts = searchStory(this.db, workspaceId, { text: query, vector, limit: 6 });
    const scenes = searchStory(this.db, workspaceId, { docType: 'event', text: query, vector, limit: 4 });
    const records = this.storyRecords(workspaceId, facts.map(hit => hit.docId));
    const lines = [
      ...facts.flatMap(hit => {
        const record = records.get(hit.docId);
        return record ? [`Fact: ${this.recordText(workspaceId, record)}`] : [];
      }),
      ...scenes.flatMap(hit => (hit.event ? [`Scene: ${hit.event.description || hit.event.title}`] : []))
    ];
    return lines.length ? `Story for "${query}":\n${lines.join('\n')}` : `Story for "${query}": nothing close enough.`;
  }

  /** Who holds something close to the statement, and how each came to hold it. */
  whoKnows(workspaceId: string, query: string, vector: number[] | null = null): string {
    const world = NarrativeWorld.of(this.db, workspaceId);
    if (!world.exists()) return 'The story has no records yet.';
    const reader = new StoryReader(world);
    const timelineId = reader.timelineId();
    const found = reader.holders()
      .flatMap(holderId => searchStory(this.db, workspaceId, { holderId, text: query, vector, limit: 2, maxTerms: WHO_KNOWS_TERMS, timelineId }))
      .sort((left, right) => right.score - left.score)
      .slice(0, STORY_TOOL_LINES);
    const records = this.storyRecords(workspaceId, found.map(hit => hit.docId));
    const lines = found.flatMap(hit => {
      const record = records.get(hit.docId);
      if (!record || record.kind !== 'holding') return [];
      return [`${this.entityName(workspaceId, record.holder) || record.holder} ${record.attitude}: ${this.recordText(workspaceId, record)} (${this.acquisitionText(workspaceId, record)})`];
    });
    return lines.length ? `Who holds "${query}":\n${lines.join('\n')}` : `Nobody holds anything close to "${query}".`;
  }

  /** What one holder holds that the other does not, and where they disagree. */
  compareKnowledge(workspaceId: string, query: string): string {
    const pair = this.resolvePair(workspaceId, query);
    if (!pair) return 'Use "name | name" with two known characters, factions or places.';
    const world = NarrativeWorld.of(this.db, workspaceId);
    const known = world.exists() ? world.ensureEntities([pair.subject.id, pair.target.id]) : new Map();
    if (!known.has(pair.subject.id) || !known.has(pair.target.id)) return 'Neither holds anything in the story yet.';
    const result = world.call<CompareResult>('compare', { a: pair.subject.id, b: pair.target.id, timelineId: new StoryReader(world).timelineId() });
    const text = (record: StoryRecord | null | undefined) => (record ? this.recordText(workspaceId, record) : '');
    const a = pair.subject.canonicalName;
    const b = pair.target.canonicalName;
    return [
      `${a} and ${b}: ${result.counts.shared} shared, ${result.counts.onlyA} only ${a}, ${result.counts.onlyB} only ${b}, ${result.counts.conflicting} in conflict.`,
      ...result.onlyA.slice(0, 5).map(entry => `Only ${a}: ${text(entry.a)}`),
      ...result.onlyB.slice(0, 5).map(entry => `Only ${b}: ${text(entry.b)}`),
      ...result.conflicting.slice(0, 4).map(entry => `Conflict: ${a} holds "${text(entry.a)}", ${b} holds "${text(entry.b)}"`)
    ].join('\n');
  }

  /** How someone came to hold the statement closest to the query, link by link. */
  howTheyKnow(workspaceId: string, query: string, vector: number[] | null = null): string {
    const [subjectQuery, statement] = splitPair(query);
    const subject = subjectQuery ? this.resolveEntity(workspaceId, subjectQuery) : null;
    if (!subject || !statement) return 'Use "name | the statement in a few words".';
    const hit = searchStory(this.db, workspaceId, { holderId: subject.id, text: statement, vector, limit: 1 })[0];
    const trace = hit ? traceStoryRecord(this.db, workspaceId, hit.docId) : null;
    if (!trace?.steps.length) return `${subject.canonicalName} holds nothing close to "${statement}".`;
    const steps = trace.steps.map(step => {
      const from = step.fromName ? ` from ${step.fromName}` : '';
      const intent = step.intent && step.intent !== 'unknown' ? `, ${step.intent}` : '';
      return `${step.holderName ?? 'Someone'}: ${step.how}${from}${intent}${step.eventDescription ? ` (${step.eventDescription})` : ''}`;
    });
    const record = this.storyRecords(workspaceId, [hit!.docId]).get(hit!.docId);
    return [`How ${subject.canonicalName} holds: ${record ? this.recordText(workspaceId, record) : statement}`, ...steps, ...(trace.truncated ? ['The chain goes further back.'] : [])].join('\n');
  }

  private storyRecords(workspaceId: string, ids: string[]): Map<string, StoryRecord> {
    const world = NarrativeWorld.of(this.db, workspaceId);
    const records = new Map<string, StoryRecord>();
    if (!world.exists()) return records;
    const timelineId = new StoryReader(world).timelineId();
    for (const id of new Set(ids)) {
      try {
        records.set(id, world.call<StoryRecord>('record', { recordId: id, timelineId }));
      } catch {
        // A record retired since the search ran is simply left out.
      }
    }
    return records;
  }

  private recordText(workspaceId: string, record: StoryRecord): string {
    return clip(this.fullRecordText(workspaceId, record));
  }

  private fullRecordText(workspaceId: string, record: StoryRecord): string {
    if (record.kind === 'holding' && record.text) return record.text;
    if (record.kind !== 'holding' && record.kind !== 'fact') return '';
    const claim = record.claim;
    const subject = this.entityName(workspaceId, claim.subject) || claim.subject;
    const value = objectOf(claim);
    // An occurrence is stored as a structured value; what reads as text is its title and summary.
    const object = claim.object.kind === 'entity'
      ? this.entityName(workspaceId, claim.object.id) || claim.object.id
      : value && typeof value === 'object'
        ? [(value as Record<string, unknown>).title, (value as Record<string, unknown>).summary].filter(Boolean).join(': ')
        : String(value ?? '');
    const negation = claim.polarity === false ? 'not ' : '';
    return GENERIC_PREDICATES.has(claim.predicate) || claim.predicate === 'recorded-occurrence'
      ? `${subject}: ${negation}${object}`
      : `${subject} ${negation}${claim.predicate}: ${object}`;
  }

  private acquisitionText(workspaceId: string, record: StoryRecord): string {
    if (record.kind !== 'holding') return '';
    const acquisition = record.acquisition;
    if (acquisition.kind === 'told-by') return `told by ${this.entityName(workspaceId, acquisition.sourceHolderId) || acquisition.sourceHolderId}`;
    return acquisition.kind;
  }

  private entityNames(workspaceId: string, ids: string[]): Map<string, string> {
    if (!ids.length) return new Map();
    const rows = this.db.prepare(`
      SELECT id, canonicalName FROM entities
      WHERE workspaceId = ? AND id IN (${ids.map(() => '?').join(', ')})
    `).all(workspaceId, ...ids) as Array<{ id: string; canonicalName: string }>;
    return new Map(rows.map(row => [row.id, row.canonicalName]));
  }

  private entityName(workspaceId: string, entityId: string): string {
    const row = this.db.prepare(`
      SELECT canonicalName FROM entities WHERE workspaceId = ? AND id = ?
    `).get(workspaceId, entityId) as { canonicalName: string } | undefined;
    return row?.canonicalName ?? '';
  }

  private latestSequence(workspaceId: string): number {
    return currentNarrativeSequence(this.db, workspaceId);
  }
}

function clip(text: string): string {
  return text.length > STORY_TOOL_TEXT ? `${text.slice(0, STORY_TOOL_TEXT - 1).trimEnd()}…` : text;
}

function splitPair(query: string): [string, string] {
  const [left = '', right = ''] = query.split('|', 2);
  return [left.trim(), right.trim()];
}

function parseAliases(value: string | null): string[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return value.split(',').map(alias => alias.trim()).filter(Boolean);
  }
}

function parseObject(value: unknown): Record<string, unknown> {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function formatPayload(value: string | Record<string, unknown>): string {
  const payload = parseObject(value);
  if (typeof payload.summary === 'string') return payload.summary;
  const proposition = parseObject(JSON.stringify(payload.proposition ?? {}));
  if (typeof proposition.predicate === 'string') {
    return `${proposition.predicate}: ${JSON.stringify(proposition.object)}`;
  }
  return JSON.stringify(payload);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function accessibility(value: unknown): 'available' | 'suppressed' | 'inaccessible' {
  return value === 'suppressed' || value === 'inaccessible' ? value : 'available';
}

function unique(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}
