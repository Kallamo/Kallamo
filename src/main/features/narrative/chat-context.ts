import type Database from 'better-sqlite3';
import type { NarrativePosition, Perspective } from '../../../narrative/contracts';
import type { ContextCandidate, ContextEpistemicMetadata, ContextSourceType } from '../../../narrative/context-planner';
import { RoleplaySystem } from './roleplay-system';
import { RoleplayProgression } from './roleplay-progression';
import { RoleplaySkills } from './roleplay-skills';
import { RoleplayConditions, describeConditionEnd, type ActiveCondition } from './roleplay-conditions';
import { createWorldbuildKnowledgeService, type WorldbuildKnowledgeService } from '../worldbuild/knowledge-service';
import { sharedKnowledgeCards } from '../worldbuild/knowledge-groups';
import { derivedAge } from '../../../shared/world-age';
import { CharacterSceneMemory, formatCharacterMemorySection } from './character-scene-memory';

type EntityExpansion = 'summary' | 'dossier';

interface EntityRow {
  id: string;
  type: string;
  canonicalName: string;
  lore: string | null;
  data: string | null;
  status: string;
}

interface FieldRow {
  type_id: string;
  field_key: string;
  label: string;
  ai_access: string;
  value_type?: string;
  options_json?: string | null;
  ai_guidance?: string | null;
}

interface KnownEntityAggregate {
  entity: EntityRow;
  ownerId: string;
  knownAs: string | null;
  fieldKeys: Set<string>;
  cardIds: Set<string>;
  sourceOwnerIds: Set<string>;
}

interface InventoryAggregate {
  holderId: string;
  holderName: string;
  itemId: string;
  itemName: string;
  isUnique: boolean;
  quantity: number;
  equipped: boolean;
  linkIds: string[];
}

/**
 * The Worldbuild and scene readers the turn context is built from: scene state, Knowledge cards,
 * pinned rules and scene memory. Choosing what enters the context is the assembler's work.
 */
export class NarrativeChatContext {
  private readonly roleplay: RoleplaySystem;
  private readonly knowledgeCards: WorldbuildKnowledgeService;
  private readonly characterMemory: CharacterSceneMemory;

  constructor(
    private readonly db: Database.Database,
    private readonly estimateTokens: (text: string) => number
  ) {
    this.characterMemory = new CharacterSceneMemory(db);
    this.roleplay = new RoleplaySystem(db);
    this.knowledgeCards = createWorldbuildKnowledgeService(db);
  }

  /** Brings the Worldbuild Knowledge cards in line with the story before anyone's knowledge is read. */
  prepare(workspaceId: string): void {
    this.knowledgeCards.reconcileWorkspace(workspaceId);
  }

  /** Resources, level, skills and inventory of these entities, one line each, for the scene core. */
  stateLines(workspaceId: string, entityIds: string[]): string[] {
    if (!entityIds.length) return [];
    return [
      ...this.loadRoleplayCandidates(workspaceId, entityIds),
      ...this.loadInventoryCandidates(workspaceId, entityIds)
    ].map(candidate => candidate.content);
  }

  /** The scene memory section without its heading. */
  sceneMemory(workspaceId: string, entityIds: string[]): string {
    return this.composeCharacterMemory(workspaceId, entityIds).replace(/^\s*---[^\n]*---\s*\n+/, '').trim();
  }

  /**
   * The names, fields and relationships one character knows of these entities. The sheets are
   * already in the context, so only field names are given.
   */
  knownLines(workspaceId: string, holderId: string, entityIds: string[]): Array<{ targetId: string; text: string }> {
    const targets = entityIds.filter(id => id !== holderId);
    if (!targets.length) return [];
    const perspective: Perspective = { access: 'subjective', focalSubjectId: holderId };
    const names = this.getEntityNames(workspaceId, uniqueIds([holderId, ...targets]));
    const lines: Array<{ targetId: string; text: string }> = [];
    for (const candidate of this.loadEntityCandidates(workspaceId, targets, perspective)) {
      const match = /^known-entity:[^:]+:(.+)$/.exec(candidate.id);
      if (!match) continue;
      const [first, ...rest] = candidate.content.split(/\r?\n/).filter(Boolean);
      const knownAs = first?.replace(/^Known identity:\s*/i, '').trim();
      const canonical = names.get(match[1]) ?? knownAs;
      const fields = [...new Set(rest.flatMap(line => {
        const separator = line.indexOf(':');
        return separator > 0 ? [line.slice(0, separator).trim()] : [];
      }))];
      const label = knownAs && knownAs !== canonical ? `${canonical}, as "${knownAs}"` : canonical;
      lines.push({ targetId: match[1], text: `Knows ${label}${fields.length ? `: ${fields.join(', ')}` : ''}` });
    }
    // A relationship is worth a line only between things the context holds.
    for (const candidate of this.loadKnownRelationshipCandidates(workspaceId, targets, perspective, uniqueIds([holderId, ...targets]))) {
      lines.push({ targetId: candidate.source.id, text: candidate.content });
    }
    return lines;
  }

  alwaysInContextIds(workspaceId: string): string[] {
    return this.loadAlwaysInContextCandidates(workspaceId).map(candidate => candidate.source.id);
  }

  private composeCharacterMemory(workspaceId: string, entityIds: string[]): string {
    const views = this.characterMemory.load(workspaceId, entityIds);
    if (!views.length) return '';
    const names = this.characterMemory.names(workspaceId, views.flatMap(view => [
      view.entityId,
      view.earlier?.locationId ?? '',
      ...[...view.current.lines, ...(view.earlier?.lines ?? [])].map(line => line.sourceId ?? '')
    ]));
    return formatCharacterMemorySection(views, names);
  }

  private loadRoleplayCandidates(workspaceId: string, entityIds: string[]): ContextCandidate[] {
    const settings = this.roleplay.getSettings(workspaceId);
    const ids = new Set(entityIds);
    if (settings.playerEntityId) ids.add(settings.playerEntityId);
    const usedDefinitions = new Map<string, ReturnType<RoleplaySystem['listEntityResources']>[number]>();
    const names = this.getEntityNames(workspaceId, [...ids]);
    const conditions = this.activeConditions(workspaceId, [...ids]);
    const usedConditions = new Map<string, ActiveCondition>();
    // One line per person, under their name: values without an owner are read as anyone's.
    const values = [...ids].flatMap(entityId => {
      if (!names.has(entityId)) return [];
      const resources = this.roleplay.listEntityResources(workspaceId, entityId);
      const held = conditions.filter(condition => condition.entityId === entityId);
      if (!resources.length && !held.length) return [];
      resources.forEach(resource => usedDefinitions.set(resource.definitionId, resource));
      held.forEach(condition => usedConditions.set(condition.conditionId, condition));
      const parts = [
        resources.length ? resources.map(resource => `${resource.name} ${resource.current} / ${resource.maximum}${resource.unit ? ` ${resource.unit}` : ''}`).join(', ') : '',
        held.length ? `${held.length === 1 ? 'condition' : 'conditions'}: ${held.map(describeHeldCondition).join('; ')}` : ''
      ].filter(Boolean);
      return [this.candidate({
        id: `roleplay-state:${entityId}`,
        workspaceId, sourceType: 'state', sourceId: entityId,
        content: `${names.get(entityId)}: ${parts.join('. ')}.`,
        relevance: 1,
        epistemic: { kind: 'knowledge', subjectId: entityId, accessibility: 'available' },
        provenanceIds: [entityId, ...resources.map(resource => resource.definitionId), ...held.map(condition => condition.conditionId)]
      })];
    });
    const conditionRules = [...usedConditions.values()].flatMap(condition => condition.description ? [this.candidate({
      id: `roleplay-condition-rule:${condition.conditionId}`,
      workspaceId, sourceType: 'state', sourceId: condition.conditionId,
      content: `${condition.name}: ${condition.description}`,
      relevance: 1,
      epistemic: { kind: 'canon', access: 'public' },
      provenanceIds: [condition.conditionId]
    })] : []);
    // What a resource means travels once, beside the values, so the narrator plays it as written.
    const rules = [...usedDefinitions.values()].flatMap(resource => {
      const lines = [
        resource.description ? `${resource.name}: ${resource.description}` : '',
        resource.lowestEffect ? `At ${resource.minimum}${resource.unit ? ` ${resource.unit}` : ''} ${resource.name}: ${resource.lowestEffect}` : ''
      ].filter(Boolean);
      return lines.length ? [this.candidate({
        id: `roleplay-resource-rule:${resource.definitionId}`,
        workspaceId, sourceType: 'state', sourceId: resource.definitionId,
        content: lines.join('\n'),
        relevance: 1,
        epistemic: { kind: 'canon', access: 'public' },
        provenanceIds: [resource.definitionId]
      })] : [];
    });
    return [...values, ...rules, ...conditionRules, ...this.loadProgressionCandidates(workspaceId, ids), ...this.loadSkillCandidates(workspaceId, ids)];
  }

  // Conditions on and off with the world's switch; a database without them yet has none.
  private activeConditions(workspaceId: string, entityIds: string[]): ActiveCondition[] {
    try {
      const system = new RoleplayConditions(this.db);
      return system.getSettings(workspaceId).enabled ? system.listActive(workspaceId, entityIds) : [];
    } catch {
      return [];
    }
  }

  // Only who progresses carries a level and attributes; everyone else is a fixed NPC.
  private loadProgressionCandidates(workspaceId: string, ids: Set<string>): ContextCandidate[] {
    const progression = new RoleplayProgression(this.db);
    const settings = progression.getSettings(workspaceId);
    if (settings.mode === 'off') return [];
    const present = progression.progressingIds(workspaceId).filter(id => ids.has(id));
    if (!present.length) return [];
    const names = this.getEntityNames(workspaceId, present);
    const traits = progression.listTraits(workspaceId);
    const states = present.map(entityId => {
      const progress = progression.getEntityProgress(workspaceId, entityId);
      const name = names.get(entityId) ?? entityId;
      const content = [
        `${name}: level ${progress.level}${progress.goal ? ` (${progress.xp} of ${progress.goal} XP to the next)` : ''}.`,
        progress.attributes.length ? `Attributes: ${progress.attributes.map(attribute => `${attribute.name} ${attribute.value}`).join(', ')}.` : ''
      ].filter(Boolean).join(' ');
      return this.candidate({
        id: `roleplay-progress:${entityId}`,
        workspaceId, sourceType: 'state', sourceId: entityId,
        content,
        relevance: 1,
        epistemic: { kind: 'knowledge', subjectId: entityId, accessibility: 'available' },
        provenanceIds: [entityId]
      });
    });
    const meanings = traits.filter(trait => trait.description);
    if (!meanings.length) return states;
    return [...states, this.candidate({
      id: `roleplay-progress-rules:${workspaceId}`,
      workspaceId, sourceType: 'state', sourceId: `progression:${settings.mode}`,
      content: [
        `Attributes (${meanings[0].minimum} to ${meanings[0].maximum}):`,
        ...meanings.map(trait => `- ${trait.name}: ${trait.description}`)
      ].join('\n'),
      relevance: 1,
      epistemic: { kind: 'canon', access: 'public' },
      provenanceIds: meanings.map(trait => trait.id)
    })];
  }

  // Anyone present with skills shows them, learner or not: a master smith NPC is still a master.
  private loadSkillCandidates(workspaceId: string, ids: Set<string>): ContextCandidate[] {
    const skills = new RoleplaySkills(this.db);
    const settings = skills.getSettings(workspaceId);
    if (!settings.enabled || !ids.size) return [];
    const held = [...ids].map(entityId => ({ entityId, skills: skills.getEntitySkills(workspaceId, entityId).skills })).filter(item => item.skills.length);
    if (!held.length) return [];
    const names = this.getEntityNames(workspaceId, held.map(item => item.entityId));
    const states = held.map(({ entityId, skills: list }) => this.candidate({
      id: `roleplay-skills:${entityId}`,
      workspaceId, sourceType: 'state', sourceId: entityId,
      content: `${names.get(entityId) ?? entityId} skills: ${list.map(skill => `${skill.name} (${skill.rankName})`).join(', ')}.`,
      relevance: 1,
      epistemic: { kind: 'knowledge', subjectId: entityId, accessibility: 'available' },
      provenanceIds: [entityId]
    }));
    return [...states, this.candidate({
      id: `roleplay-skill-ranks:${workspaceId}`,
      workspaceId, sourceType: 'state', sourceId: 'skills:ranks',
      content: `Skill ranks, lowest first: ${settings.config.ranks.join(', ')}.`,
      relevance: 1,
      epistemic: { kind: 'canon', access: 'public' },
      provenanceIds: ['skills:ranks']
    })];
  }

  private getEntityNames(workspaceId: string, entityIds: string[]): Map<string, string> {
    if (!entityIds.length) return new Map();
    const placeholders = entityIds.map(() => '?').join(', ');
    const rows = this.db.prepare(`
      SELECT id, canonicalName FROM entities
      WHERE workspaceId = ? AND id IN (${placeholders}) AND status != 'proposed'
    `).all(workspaceId, ...entityIds) as Array<{ id: string; canonicalName: string }>;
    return new Map(rows.map(row => [row.id, row.canonicalName]));
  }

  // Read straight from the stored rows, like the names below: building a context must not create a calendar or a clock.
  private getAgeClock(workspaceId: string): { calendar: Record<string, any> | null; clock: Record<string, any> | null } {
    const read = (table: string, sql: string): Record<string, any> | null => {
      const exists = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(table);
      const row = exists ? this.db.prepare(sql).get(workspaceId) as { json: string } | undefined : undefined;
      try { return row ? JSON.parse(row.json) : null; } catch { return null; }
    };
    return {
      calendar: read('worldbuild_calendars', 'SELECT definition_json AS json FROM worldbuild_calendars WHERE workspace_id = ?'),
      clock: read('roleplay_time_state', 'SELECT position_json AS json FROM roleplay_time_state WHERE workspace_id = ?')
    };
  }

  /** Systems the user marked to go with every message: world rules, outside retrieval and the entity limit. */
  private loadAlwaysInContextCandidates(workspaceId: string): ContextCandidate[] {
    const entities = (this.db.prepare(`
      SELECT id, type, canonicalName, lore, data, status
      FROM entities
      WHERE workspaceId = ? AND type = 'System' AND status != 'proposed'
      ORDER BY canonicalName
    `).all(workspaceId) as EntityRow[])
      .filter(entity => parseObject(entity.data).alwaysInContext === true);
    if (!entities.length) return [];
    const fields = this.db.prepare(`
      SELECT type_id, field_key, label, ai_access, value_type, options_json, ai_guidance
      FROM worldbuild_field_definitions WHERE workspace_id = ? AND type_id = 'System'
    `).all(workspaceId) as FieldRow[];
    return entities.flatMap(entity => {
      const content = composeEntity(entity, fields);
      return content ? [this.candidate({
        id: `entity:${entity.id}`,
        workspaceId,
        sourceType: 'canon',
        sourceId: entity.id,
        content,
        relevance: 1,
        epistemic: { kind: 'canon', access: 'public' },
        provenanceIds: [entity.id]
      })] : [];
    });
  }

  private loadEntityCandidates(
    workspaceId: string,
    entityIds: string[],
    perspective: Perspective,
    expansion: Exclude<EntityExpansion, 'none'> = 'dossier'
  ): ContextCandidate[] {
    if (!entityIds.length) return [];
    const placeholders = entityIds.map(() => '?').join(', ');
    const entities = this.db.prepare(`
      SELECT id, type, canonicalName, lore, data, status
      FROM entities
      WHERE workspaceId = ? AND id IN (${placeholders}) AND status != 'proposed'
    `).all(workspaceId, ...entityIds) as EntityRow[];
    const fields = this.db.prepare(`
      SELECT type_id, field_key, label, ai_access, value_type, options_json, ai_guidance
      FROM worldbuild_field_definitions WHERE workspace_id = ?
    `).all(workspaceId) as FieldRow[];
    const shown = new Map<string, FieldRow>();
    const note = (entity: EntityRow, knownKeys?: Set<string>) => {
      if (expansion === 'summary') return;
      shownCustomFields(entity, fields, knownKeys).forEach(field => shown.set(`${field.type_id}:${field.field_key}`, field));
    };
    const withGuidance = (candidates: ContextCandidate[]) => [
      ...candidates,
      ...this.fieldGuidanceCandidates(workspaceId, [...shown.values()])
    ];
    if (perspective.access !== 'omniscient') {
      const ownerIds = perspective.access === 'subjective'
        ? [perspective.focalSubjectId!]
        : perspective.allowedSubjectIds ?? [];
      if (!ownerIds.length) {
        return withGuidance(entities.flatMap(entity => {
          const content = expansion === 'summary' ? composeEntitySummary(entity) : composeEntity(entity, fields);
          if (content) note(entity);
          return content ? [this.candidate({
            id: `entity:${entity.id}`,
            workspaceId,
            sourceType: 'canon',
            sourceId: entity.id,
            content,
            relevance: 1,
            epistemic: { kind: 'canon', access: 'public' },
            provenanceIds: [entity.id]
          })] : [];
        }));
      }
      const ownCards = this.db.prepare(`
        SELECT cards.card_id AS cardId, cards.owner_id AS sourceOwnerId,
          cards.target_id AS targetId, cards.known_as AS knownAs, cards.owner_id AS effectiveOwnerId
        FROM worldbuild_knowledge_cards cards
        WHERE cards.workspace_id = ?
          AND cards.status = 'active'
          AND cards.target_id IN (${placeholders})
          AND cards.owner_id IN (${ownerIds.map(() => '?').join(', ')})
      `).all(workspaceId, ...entityIds, ...ownerIds) as Array<{ cardId: string; sourceOwnerId: string; targetId: string; knownAs: string | null; effectiveOwnerId: string }>;
      const cards = [
        ...ownCards,
        ...sharedKnowledgeCards(this.db, workspaceId, ownerIds, entityIds).map(card => ({
          cardId: card.cardId,
          sourceOwnerId: card.groupId,
          targetId: card.targetId,
          knownAs: card.knownAs,
          effectiveOwnerId: card.memberId
        }))
      ];
      const byId = new Map(entities.map(entity => [entity.id, entity]));
      const aggregates = new Map<string, KnownEntityAggregate>();
      cards.forEach(card => {
        const entity = byId.get(card.targetId);
        if (!entity || !card.effectiveOwnerId) return;
        const keys = new Set((this.db.prepare(`
          SELECT field_key FROM worldbuild_known_fields
          WHERE workspace_id = ? AND card_id = ?
        `).all(workspaceId, card.cardId) as Array<{ field_key: string }>).map(row => row.field_key));
        const aggregateKey = `${card.effectiveOwnerId}:${card.targetId}`;
        const aggregate = aggregates.get(aggregateKey) ?? {
          entity,
          ownerId: card.effectiveOwnerId,
          knownAs: null,
          fieldKeys: new Set<string>(),
          cardIds: new Set<string>(),
          sourceOwnerIds: new Set<string>()
        };
        keys.forEach(key => aggregate.fieldKeys.add(key));
        aggregate.cardIds.add(card.cardId);
        aggregate.sourceOwnerIds.add(card.sourceOwnerId);
        if (card.knownAs && (!aggregate.knownAs || card.sourceOwnerId === card.effectiveOwnerId)) {
          aggregate.knownAs = card.knownAs;
        }
        aggregates.set(aggregateKey, aggregate);
      });
      let ageClock: { calendar: Record<string, any> | null; clock: Record<string, any> | null } | null = null;
      const ageOf = (data: Record<string, unknown>): unknown => {
        if (!data.birthDate) return data.age;
        ageClock ??= this.getAgeClock(workspaceId);
        return derivedAge(ageClock.calendar, ageClock.clock, data);
      };
      const knownCandidates = [...aggregates.values()].map(aggregate => {
        const cardIds = [...aggregate.cardIds];
        note(aggregate.entity, aggregate.fieldKeys);
        return this.candidate({
          id: `known-entity:${aggregate.ownerId}:${aggregate.entity.id}`,
          workspaceId,
          sourceType: 'knowledge',
          sourceId: cardIds[0] ?? aggregate.entity.id,
          content: composeKnownEntity(aggregate.entity, fields, aggregate.fieldKeys, aggregate.knownAs, ageOf),
          relevance: 1,
          epistemic: { kind: 'knowledge', subjectId: aggregate.ownerId, accessibility: 'available' },
          provenanceIds: uniqueIds([
            ...cardIds,
            aggregate.entity.id,
            ...aggregate.sourceOwnerIds
          ])
        });
      });
      if (perspective.access === 'subjective' && perspective.focalSubjectId) {
        const self = byId.get(perspective.focalSubjectId);
        if (self && !cards.some(card => card.targetId === self.id)) {
          knownCandidates.push(this.candidate({
            id: `known-self:${self.id}`,
            workspaceId,
            sourceType: 'knowledge',
            sourceId: self.id,
            content: `${self.canonicalName} (${self.type})`,
            relevance: 1,
            epistemic: { kind: 'knowledge', subjectId: self.id, accessibility: 'available' },
            provenanceIds: [self.id]
          }));
        }
      }
      return withGuidance(knownCandidates);
    }
    return withGuidance(entities.flatMap(entity => {
      const content = expansion === 'summary' ? composeEntitySummary(entity) : composeEntity(entity, fields);
      if (!content) return [];
      note(entity);
      return [this.candidate({
        id: `entity:${entity.id}`,
        workspaceId,
        sourceType: 'canon',
        sourceId: entity.id,
        content,
        relevance: 1,
        epistemic: { kind: 'canon', access: 'public' },
        provenanceIds: [entity.id]
      })];
    }));
  }

  // A field's guidance goes once, as a canon note, like the skill ranks: not repeated per dossier.
  private fieldGuidanceCandidates(workspaceId: string, fields: FieldRow[]): ContextCandidate[] {
    return fields.flatMap(field => {
      const guidance = field.ai_guidance?.trim();
      if (!guidance) return [];
      const id = `field-guidance:${field.type_id}:${field.field_key}`;
      return [this.candidate({
        id,
        workspaceId,
        sourceType: 'canon',
        sourceId: id,
        content: `Field "${field.label}" (${field.type_id}): ${guidance}`,
        relevance: 1,
        epistemic: { kind: 'canon', access: 'public' },
        provenanceIds: [id]
      })];
    });
  }

  private loadInventoryCandidates(workspaceId: string, entityIds: string[]): ContextCandidate[] {
    if (!entityIds.length) return [];
    const placeholders = entityIds.map(() => '?').join(', ');
    const rows = this.db.prepare(`
      SELECT links.id, links.toId AS holderId, links.metadata_json AS metadataJson,
        item.id AS itemId, item.canonicalName AS itemName, item.data AS itemData,
        holder.canonicalName AS holderName,
        CASE WHEN equipment.item_id IS NULL THEN 0 ELSE 1 END AS equipped
      FROM entity_links AS links
      JOIN entities AS item ON item.id = links.fromId AND item.workspaceId = links.workspaceId
      JOIN entities AS holder ON holder.id = links.toId AND holder.workspaceId = links.workspaceId
      LEFT JOIN roleplay_equipment AS equipment
        ON equipment.workspace_id = links.workspaceId
        AND equipment.entity_id = links.toId AND equipment.item_id = links.fromId
      WHERE links.workspaceId = ? AND links.relType IN ('owned_by', 'carried_by')
        AND links.toId IN (${placeholders})
        AND item.status != 'proposed' AND holder.status != 'proposed'
      ORDER BY holder.canonicalName, item.canonicalName
    `).all(workspaceId, ...entityIds) as Array<{
      id: string; holderId: string; metadataJson: string | null;
      itemId: string; itemName: string; itemData: string; holderName: string; equipped: number;
    }>;
    const aggregates = new Map<string, InventoryAggregate>();
    rows.forEach(row => {
      const metadata = parseObject(row.metadataJson);
      const itemData = parseObject(row.itemData);
      const isUnique = itemData.itemNature === 'unique';
      const quantity = isUnique ? 1 : Math.max(1, Math.round(Number(metadata.quantity) || 1));
      const aggregateKey = `${row.holderId}:${row.itemId}`;
      const aggregate = aggregates.get(aggregateKey);
      if (aggregate) {
        aggregate.linkIds.push(row.id);
        aggregate.equipped = aggregate.equipped || Boolean(row.equipped);
        if (!aggregate.isUnique) aggregate.quantity += quantity;
        return;
      }
      aggregates.set(aggregateKey, {
        holderId: row.holderId,
        holderName: row.holderName,
        itemId: row.itemId,
        itemName: row.itemName,
        isUnique,
        quantity,
        equipped: Boolean(row.equipped),
        linkIds: [row.id]
      });
    });
    return [...aggregates.values()].map(aggregate => {
      const quantity = aggregate.isUnique ? '' : ` x${aggregate.quantity}`;
      return this.candidate({
        id: `inventory:${aggregate.holderId}:${aggregate.itemId}`,
        workspaceId,
        sourceType: 'state',
        sourceId: aggregate.linkIds[0],
        content: `${aggregate.holderName} inventory: ${aggregate.itemName}${aggregate.isUnique ? ' (unique)' : quantity}${aggregate.equipped ? ' [equipped]' : ''}`,
        relevance: 1,
        epistemic: { kind: 'knowledge', subjectId: aggregate.holderId, accessibility: 'available' },
        provenanceIds: uniqueIds([...aggregate.linkIds, aggregate.itemId, aggregate.holderId])
      });
    });
  }

  private loadKnownRelationshipCandidates(
    workspaceId: string,
    entityIds: string[],
    perspective: Perspective,
    /** When given, both ends of a relationship must be among these. */
    within?: string[]
  ): ContextCandidate[] {
    if (!entityIds.length || perspective.access === 'omniscient') return [];
    const ownerIds = perspective.access === 'subjective'
      ? [perspective.focalSubjectId!]
      : perspective.allowedSubjectIds ?? [];
    if (!ownerIds.length) return [];
    const entityPlaceholders = entityIds.map(() => '?').join(', ');
    // Each card a reader holds or inherits from a faction or a place they are local to.
    const readers = new Map<string, Array<{ sourceOwnerId: string; effectiveOwnerId: string }>>();
    const addReader = (cardId: string, sourceOwnerId: string, effectiveOwnerId: string) => {
      const list = readers.get(cardId) ?? [];
      list.push({ sourceOwnerId, effectiveOwnerId });
      readers.set(cardId, list);
    };
    for (const card of this.db.prepare(`
      SELECT card_id AS cardId, owner_id AS ownerId FROM worldbuild_knowledge_cards
      WHERE workspace_id = ? AND status = 'active' AND owner_id IN (${ownerIds.map(() => '?').join(', ')})
    `).all(workspaceId, ...ownerIds) as Array<{ cardId: string; ownerId: string }>) addReader(card.cardId, card.ownerId, card.ownerId);
    for (const card of sharedKnowledgeCards(this.db, workspaceId, ownerIds)) addReader(card.cardId, card.groupId, card.memberId);
    if (!readers.size) return [];
    const cardIds = [...readers.keys()];
    const relationshipRows = this.db.prepare(`
      SELECT relationships.relationship_id AS relationshipId,
        relationships.from_id AS fromId, relationships.from_name AS fromName,
        relationships.relation_type AS relationType,
        relationships.relation_label AS relationLabel,
        relationships.to_id AS toId, relationships.to_name AS toName,
        relationships.metadata_json AS metadataJson,
        relationships.card_id AS cardId
      FROM worldbuild_known_relationships relationships
      WHERE relationships.workspace_id = ?
        AND relationships.card_id IN (${cardIds.map(() => '?').join(', ')})
        AND (relationships.from_id IN (${entityPlaceholders}) OR relationships.to_id IN (${entityPlaceholders}))
        ${within ? `AND relationships.from_id IN (${within.map(() => '?').join(', ')}) AND relationships.to_id IN (${within.map(() => '?').join(', ')})` : ''}
    `).all(workspaceId, ...cardIds, ...entityIds, ...entityIds, ...(within ? [...within, ...within] : [])) as Array<{
      relationshipId: string; fromId: string; fromName: string;
      relationType: string; relationLabel: string | null;
      toId: string; toName: string; metadataJson: string | null;
      cardId: string;
    }>;
    const rows = relationshipRows.flatMap(row => (readers.get(row.cardId) ?? []).map(reader => ({ ...row, ...reader })));
    // A bond known through several cards (one's own, a faction's) is still one bond to the reader.
    const known = new Map<string, { row: typeof rows[number]; provenance: string[] }>();
    for (const row of rows) {
      if (!row.effectiveOwnerId) continue;
      const key = `${row.effectiveOwnerId}:${row.relationshipId}`;
      const entry = known.get(key) ?? { row, provenance: [row.relationshipId, row.fromId, row.toId] };
      entry.provenance.push(row.cardId, row.sourceOwnerId);
      known.set(key, entry);
    }
    // A subjective scope has one owner, so the id can leave it out: the same bond known by several
    // people in the scene is then rendered once, under a header that names them all.
    return [...known.entries()].map(([key, { row, provenance }]) => this.candidate({
      id: `known-relationship:${perspective.access === 'subjective' ? row.relationshipId : key}`,
      workspaceId,
      sourceType: 'knowledge',
      sourceId: row.relationshipId,
      content: `Known relationship: ${row.fromName} / ${row.relationType.replace(/_/g, ' ')} / ${row.toName}`,
      relevance: 1,
      epistemic: { kind: 'knowledge', subjectId: row.effectiveOwnerId, accessibility: 'available' },
      provenanceIds: uniqueIds(provenance)
    }));
  }

  private candidate(input: {
    id: string;
    workspaceId: string;
    sourceType: ContextSourceType;
    sourceId: string;
    content: string;
    relevance: number;
    position?: NarrativePosition;
    epistemic: ContextEpistemicMetadata;
    provenanceIds?: string[];
  }): ContextCandidate {
    return {
      id: input.id,
      workspaceId: input.workspaceId,
      source: { type: input.sourceType, id: input.sourceId },
      content: input.content,
      relevance: input.relevance,
      tokenCost: Math.max(1, this.estimateTokens(input.content)),
      ...(input.position ? { position: input.position } : {}),
      epistemic: input.epistemic,
      provenanceIds: input.provenanceIds ?? []
    };
  }
}

function composeKnownEntity(
  entity: EntityRow,
  fields: FieldRow[],
  knownFieldKeys: Set<string>,
  knownAs: string | null,
  ageOf: (data: Record<string, unknown>) => unknown = data => data.age
): string {
  const data = parseObject(entity.data);
  const lines = [`Known identity: ${knownAs || entity.canonicalName}`];
  const definitions = new Map(fields
    .filter(field => field.type_id === entity.type && field.ai_access !== 'hidden')
    .map(field => [`customFields.${field.field_key}`, field]));
  for (const key of knownFieldKeys) {
    const field = definitions.get(key);
    const value = key.startsWith('customFields.')
      ? (data.customFields as Record<string, unknown> | undefined)?.[key.slice('customFields.'.length)]
      : key === 'age' ? ageOf(data) : data[key];
    if (value === undefined || value === null || value === '') continue;
    // One line per field: a value written in paragraphs would otherwise read as more fields.
    lines.push(`${field?.label || nativeFieldLabel(key)}: ${formatNarrativeValue(field ? choiceLabels(field, value) : value).replace(/\s*\n+\s*/g, ' ')}`);
  }
  return lines.join('\n');
}

// The custom fields a dossier actually shows: visible, filled and, for a subject, known.
function shownCustomFields(entity: EntityRow, fields: FieldRow[], knownKeys?: Set<string>): FieldRow[] {
  const customFields = parseObject(parseObject(entity.data).customFields);
  return fields.filter(field => {
    if (field.type_id !== entity.type || field.ai_access === 'hidden') return false;
    if (knownKeys && !knownKeys.has(`customFields.${field.field_key}`)) return false;
    const value = customFields[field.field_key];
    return value !== undefined && value !== null && value !== '';
  });
}

// A choice field stores opaque option ids; the model reads the label the user chose.
function choiceLabels(field: FieldRow, value: unknown): unknown {
  if (field.value_type !== 'single-choice' && field.value_type !== 'multiple-choice') return value;
  let options: Array<{ id?: string; label?: string }> = [];
  try {
    const parsed: unknown = JSON.parse(field.options_json || '[]');
    if (Array.isArray(parsed)) options = parsed;
  } catch {
    return value;
  }
  const label = (id: unknown) => options.find(option => option?.id === id)?.label || id;
  return Array.isArray(value) ? value.map(label) : label(value);
}

function composeEntitySummary(entity: EntityRow): string {
  const data = parseObject(entity.data);
  const description = String(data.description ?? data.content ?? '').trim();
  return description
    ? `${entity.canonicalName} (${entity.type})\n${description}`
    : `${entity.canonicalName} (${entity.type})`;
}

function nativeFieldLabel(key: string): string {
  const labels: Record<string, string> = {
    status: 'Status', gender: 'Gender', age: 'Age', appearance: 'Appearance', personality: 'Personality',
    disposition: 'Disposition', nature: 'Nature', abundance: 'Abundance', threat: 'Threat',
    abilities: 'Abilities', locationType: 'Type', size: 'Size', itemType: 'Type', description: 'Description',
    kind: 'Kind', content: 'Content'
  };
  return labels[key] || key;
}

const ENTITY_REFERENCE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function formatNarrativeValue(value: unknown, nameById: Map<string, string> = new Map()): string {
  if (typeof value !== 'string') return JSON.stringify(value);
  const trimmed = value.trim();
  return ENTITY_REFERENCE_PATTERN.test(trimmed) ? nameById.get(trimmed) ?? value : value;
}

function composeEntity(entity: EntityRow, fields: FieldRow[]): string {
  const data = parseObject(entity.data);
  const parts = [`${entity.canonicalName} (${entity.type})`];
  const description = String(data.description ?? data.content ?? '').trim();
  if (description) parts.push(description);
  if (entity.lore?.trim()) parts.push(entity.lore.trim());
  Object.entries(data)
    .filter(([key, value]) => !key.startsWith('_')
      && !['description', 'content', 'customFields', 'loreDocumentId', 'loreDocumentIds', 'aiPolicy', 'spoilers', 'alwaysInContext'].includes(key)
      && value !== undefined && value !== null && value !== '')
    .forEach(([key, value]) => parts.push(`${humanizeKey(key)}: ${formatValue(value)}`));
  const customFields = parseObject(data.customFields);
  fields
    .filter(field => field.type_id === entity.type && field.ai_access !== 'hidden')
    .forEach(field => {
      const value = customFields[field.field_key];
      if (value !== undefined && value !== null && value !== '') parts.push(`${field.label}: ${formatValue(choiceLabels(field, value))}`);
    });
  return parts.join('\n');
}

function parseObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === 'object' && !Array.isArray(value)) return value as Record<string, unknown>;
  try {
    const parsed = JSON.parse(String(value));
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function formatValue(value: unknown): string {
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

function humanizeKey(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/[-_]+/g, ' ').replace(/^./, letter => letter.toUpperCase());
}

function uniqueIds(values: Array<string | null | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))];
}

export function createNarrativeChatContext(
  db: Database.Database,
  estimateTokens: (text: string) => number
): NarrativeChatContext {
  return new NarrativeChatContext(db, estimateTokens);
}

/** One held condition as the narrator reads it: since when, and what ends it. */
function describeHeldCondition(condition: ActiveCondition): string {
  const end = describeConditionEnd({ durationMinutes: null, sleepMinutes: null, restMinutes: null, endsWhen: condition.endsWhen, timeLeftMinutes: condition.timeLeftMinutes, sleepLeftMinutes: condition.sleepLeftMinutes, restLeftMinutes: condition.restLeftMinutes });
  const details = [condition.startedLabel ? `since ${condition.startedLabel}` : '', end].filter(Boolean).join('; ');
  return details ? `${condition.name} (${details})` : condition.name;
}
