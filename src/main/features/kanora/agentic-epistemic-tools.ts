import type Database from 'better-sqlite3';
import { EpistemicResolver } from './epistemic-resolver';
import { RoleplaySystem } from './roleplay-system';
import { isFactionOccurrenceMemoryShared } from '../worldbuild/event-occurrences';
import { loadCurrentNarrativeRecords } from './narrative-record-projection';

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
    const cards = this.db.prepare(`
      SELECT cards.card_id AS cardId, cards.known_as AS knownAs,
        cards.owner_id AS sourceOwnerId
      FROM worldbuild_knowledge_cards cards
      LEFT JOIN entity_links membership
        ON membership.workspaceId = cards.workspace_id
        AND membership.relType = 'member_of'
        AND membership.fromId = ?
        AND membership.toId = cards.owner_id
      LEFT JOIN worldbuild_knowledge_audience_members audience
        ON audience.workspace_id = cards.workspace_id
        AND audience.card_id = cards.card_id
        AND audience.entry_type = 'card'
        AND audience.entry_id = cards.card_id
        AND audience.member_id = ?
      WHERE cards.workspace_id = ? AND cards.target_id = ? AND cards.status = 'active'
        AND (
          cards.owner_id = ?
          OR (
            membership.fromId IS NOT NULL
            AND (cards.audience_type = 'all-members' OR audience.member_id IS NOT NULL)
          )
      )
      ORDER BY CASE WHEN cards.owner_id = ? THEN 0 ELSE 1 END
    `).all(
      pair.subject.id,
      pair.subject.id,
      workspaceId,
      pair.target.id,
      pair.subject.id,
      pair.subject.id
    ) as Array<{ cardId: string; knownAs: string | null; sourceOwnerId: string }>;
    const fields = unique(cards.flatMap(card => this.db.prepare(`
      SELECT field_key AS fieldKey FROM worldbuild_known_fields
      WHERE workspace_id = ? AND card_id = ? ORDER BY field_key
    `).all(workspaceId, card.cardId).map(row => String((row as { fieldKey: string }).fieldKey))));
    const relationships = unique(cards.flatMap(card => this.db.prepare(`
      SELECT from_name AS fromName, relation_type AS relationType,
        relation_label AS relationLabel, to_name AS toName, metadata_json AS metadataJson
      FROM worldbuild_known_relationships
      WHERE workspace_id = ? AND card_id = ? AND relation_type = 'related_to'
      ORDER BY created_at, from_name, to_name
    `).all(workspaceId, card.cardId).map(row => {
      const relationship = row as {
        fromName: string; relationType: string; relationLabel: string | null;
        toName: string; metadataJson: string | null;
      };
      return `${relationship.fromName} knows ${relationship.toName}`;
    })));
    const records = loadCurrentNarrativeRecords(this.db, {
      workspaceId,
      recordTypes: ['knowledge', 'belief'],
      subjectIds: unique([pair.subject.id, ...cards.map(card => card.sourceOwnerId)]),
      throughSequence: this.latestSequence(workspaceId)
    }).filter(({ payload }) => {
      const proposition = objectValue(payload.proposition);
      return proposition.subjectId === pair.target.id;
    });
    const details = records.map(({ row, payload }) => {
      if (row.record_type === 'knowledge' && accessibility(payload.accessibility) !== 'available') {
        return `${row.record_type}: unavailable (${accessibility(payload.accessibility)})`;
      }
      return `${row.record_type}: ${formatPayload(payload)}`;
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
      throughSequence: this.latestSequence(workspaceId)
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

  private entityNames(workspaceId: string, ids: string[]): Map<string, string> {
    if (!ids.length) return new Map();
    const rows = this.db.prepare(`
      SELECT id, canonicalName FROM entities
      WHERE workspaceId = ? AND id IN (${ids.map(() => '?').join(', ')})
    `).all(workspaceId, ...ids) as Array<{ id: string; canonicalName: string }>;
    return new Map(rows.map(row => [row.id, row.canonicalName]));
  }

  private latestSequence(workspaceId: string): number {
    const row = this.db.prepare(`
      SELECT COALESCE(MAX(narrative_sequence), 0) AS sequence
      FROM kanora_narrative_events WHERE workspace_id = ?
    `).get(workspaceId) as { sequence: number };
    return row.sequence;
  }
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
