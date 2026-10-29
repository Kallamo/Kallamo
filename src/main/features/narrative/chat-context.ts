import type Database from 'better-sqlite3';
import type { NarrativePosition, Perspective } from '../../../narrative/contracts';
import {
  ContextPlanner,
  type ContextCandidate,
  type ContextEpistemicMetadata,
  type ContextPlanResult,
  type ContextSourceType
} from '../../../narrative/context-planner';
import type { ContextBundleResult } from '../../../narrative/context-bundle';
import { NarrativeSceneRepository } from '../../../narrative/scenes';
import {
  createRoleplayStrategy,
  createStandardStrategy,
  getWorkspaceExperienceMode,
  type KallamoContextStrategy
} from './mode-orchestration';
import { RoleplaySystem } from './roleplay-system';
import { RoleplayProgression } from './roleplay-progression';
import { RoleplaySkills } from './roleplay-skills';
import { createWorldbuildKnowledgeService, type WorldbuildKnowledgeService } from '../worldbuild/knowledge-service';
import { normalizeRetrievalSettings } from '../../../shared/retrieval-settings-runtime';
import { EpistemicResolver } from './epistemic-resolver';
import {
  KNOWLEDGE_CATEGORY_LABELS,
  MEMORY_CATEGORY_LABELS,
  normalizeKnowledgeCategory,
  normalizeMemoryCategory,
  statementKey
} from '../../../narrative/narrative-taxonomy';
import { canSubjectAccessOccurrence, isFactionOccurrenceMemoryShared } from '../worldbuild/event-occurrences';
import { sharedKnowledgeCards } from '../worldbuild/knowledge-groups';
import { describeLocationChain, loadLocationChain } from '../worldbuild/location-graph';
import { derivedAge } from '../../../shared/world-age';
import { NarrativeContextManifestRepository, type NarrativeContextManifest } from './context-manifest';
import { RoleplayContextOrchestrator } from './roleplay-context-orchestrator';
import { CharacterSceneMemory, formatCharacterMemorySection } from './character-scene-memory';
import {
  loadCurrentNarrativeRecords,
  type NarrativeRecordRow
} from './narrative-record-projection';

const { discoverEntityIds } = require('./worldbuild-entity-discovery');

export type RetrievedContextKind = 'workspace-text' | 'workspace-memory' | 'worldbuild-canon';
export type EntityExpansion = 'none' | 'summary' | 'dossier';

export interface RetrievedContextItem {
  id: string;
  kind: RetrievedContextKind;
  source: string;
  content: string;
  relevance?: number;
  entityExpansion?: EntityExpansion;
  entityIds?: string[];
  factIds?: string[];
  provenanceIds?: string[];
}

export interface PlanChatContextInput {
  requestId: string;
  workspaceId: string;
  query: string;
  tokenBudget: number;
  items: RetrievedContextItem[];
}

export interface PlannedChatContext {
  plan: ContextPlanResult;
  context: string;
  bundle?: ContextBundleResult;
  manifest?: NarrativeContextManifest;
}

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

export class NarrativeChatContext {
  private readonly planner = new ContextPlanner();
  private readonly scenes: NarrativeSceneRepository;
  private readonly roleplay: RoleplaySystem;
  private readonly knowledgeCards: WorldbuildKnowledgeService;
  private readonly epistemicResolver: EpistemicResolver;
  private readonly manifests: NarrativeContextManifestRepository;
  private readonly roleplayOrchestrator: RoleplayContextOrchestrator;
  private readonly characterMemory: CharacterSceneMemory;

  constructor(
    private readonly db: Database.Database,
    private readonly estimateTokens: (text: string) => number
  ) {
    this.characterMemory = new CharacterSceneMemory(db);
    this.scenes = new NarrativeSceneRepository(db);
    this.roleplay = new RoleplaySystem(db);
    this.knowledgeCards = createWorldbuildKnowledgeService(db);
    this.epistemicResolver = new EpistemicResolver(db);
    this.manifests = new NarrativeContextManifestRepository(db);
    this.roleplayOrchestrator = new RoleplayContextOrchestrator(estimateTokens);
  }

  plan(input: PlanChatContextInput): PlannedChatContext {
    this.knowledgeCards.reconcileWorkspace(input.workspaceId);
    const strategy = this.resolveStrategy(input.workspaceId);
    const retrievalSettings = this.getRetrievalSettings();
    const entityExpansion = strategy.mode === 'roleplay'
      ? 'dossier'
      : resolveEntityExpansion(input.items);
    const linkedChunkIds = this.resolveLinkedChunkIds(input.workspaceId, input.items);
    const retrieved = input.items.flatMap(item => {
      if (item.kind === 'worldbuild-canon' && item.entityIds?.length) return [];
      return [this.toRetrievedCandidate(input.workspaceId, item, linkedChunkIds, strategy.hasActiveScene)];
    });
    const { ids: seedEntityIds, focusIds } = this.resolveRelevantEntityIds(
      input.workspaceId,
      input.query,
      input.items,
      strategy.perspective
    );
    const entityIds = this.expandEntityIds(
      input.workspaceId,
      seedEntityIds,
      retrievalSettings.worldbuildBreadth,
      retrievalSettings.worldbuildEntityLimit
    );
    const structured = [
      ...(strategy.mode === 'roleplay' ? this.loadSceneCandidates(input.workspaceId) : []),
      ...(entityExpansion === 'none' ? [] : this.loadEntityCandidates(
        input.workspaceId,
        entityIds,
        strategy.perspective,
        entityExpansion
      )),
      ...(entityExpansion === 'dossier'
        ? this.loadKnownRelationshipCandidates(input.workspaceId, entityIds, strategy.perspective)
        : []),
      ...(entityExpansion === 'dossier'
        ? this.loadRelationCandidates(input.workspaceId, entityIds, strategy.perspective)
        : []),
      ...(strategy.mode === 'roleplay' ? this.loadInventoryCandidates(input.workspaceId, entityIds) : []),
      ...this.loadEpistemicCandidates(
        input.workspaceId,
        entityIds,
        input.query,
        input.items.flatMap(item => item.factIds ?? []),
        strategy.perspective,
        entityExpansion === 'dossier'
      ),
      ...(strategy.mode === 'roleplay' ? this.loadRoleplayCandidates(input.workspaceId, entityIds) : [])
    ];
    const uniqueCandidates = deduplicateCandidates([...retrieved, ...structured]);
    const candidates = strategy.prepareCandidates(strategy.mode === 'standard'
      ? deduplicateStandardEvidence(uniqueCandidates)
      : uniqueCandidates);
    const plan = this.planner.plan({
      id: input.requestId,
      workspaceId: input.workspaceId,
      query: input.query,
      perspective: strategy.perspective,
      through: strategy.through,
      tokenBudget: Math.max(0, Math.floor(input.tokenBudget)),
      policy: { allowInaccessible: false }
    }, candidates);
    if (strategy.mode === 'roleplay') {
      return this.planRoleplay(input, strategy, entityIds, new Set(focusIds), retrieved, plan);
    }
    return { plan, context: composeContext(plan) };
  }

  private planRoleplay(
    input: PlanChatContextInput,
    strategy: KallamoContextStrategy,
    entityIds: string[],
    focusIds: Set<string>,
    retrieved: ContextCandidate[],
    fallbackPlan: ContextPlanResult
  ): PlannedChatContext {
    const scene = this.roleplay.getScene(input.workspaceId);
    const configuredPlayerId = this.roleplay.getSettings(input.workspaceId).playerEntityId;
    const playerId = configuredPlayerId
      ?? (scene?.perspective.access === 'subjective' ? scene.perspective.focalSubjectId : undefined);
    const participantIds = uniqueIds(scene?.participantIds ?? []);
    const actorIds = participantIds.filter(id => id !== playerId);
    const subjectIds = uniqueIds([
      playerId,
      ...participantIds,
      ...(scene?.possibleObserverIds ?? []),
      ...(scene?.nearbyIds ?? [])
    ]);
    const targetIds = uniqueIds(entityIds);
    const names = this.getEntityNames(input.workspaceId, uniqueIds([...subjectIds, ...targetIds]));
    const assessments = this.epistemicResolver.resolve({
      workspaceId: input.workspaceId,
      subjectIds,
      targetIds,
      through: strategy.through
    }).assessments;
    const authorityPerspective: Perspective = { access: 'omniscient' };
    // A full sheet for whoever the turn is about; a one-line mention for an entity that only came
    // along because a retrieved passage or a relation named it.
    const authorityCandidates = deduplicateCandidates([
      ...this.loadSceneCandidates(input.workspaceId),
      ...this.loadEntityCandidates(input.workspaceId, entityIds.filter(id => focusIds.has(id)), authorityPerspective),
      ...this.loadEntityMentions(input.workspaceId, entityIds.filter(id => !focusIds.has(id))),
      ...this.loadEpistemicCandidates(
        input.workspaceId,
        entityIds,
        input.query,
        input.items.flatMap(item => item.factIds ?? []),
        authorityPerspective
      ).filter(candidate => candidate.epistemic.kind === 'canon'),
      ...retrieved.filter(candidate => candidate.source.type === 'canon')
    ]);
    const subjects = uniqueIds([playerId, ...actorIds]).map(subjectId => {
      const perspective: Perspective = { access: 'subjective', focalSubjectId: subjectId };
      return {
        id: subjectId,
        name: names.get(subjectId) ?? subjectId,
        kind: subjectId === playerId ? 'player' as const : 'actor' as const,
        candidates: createRoleplayStrategy(perspective, strategy.through, strategy.hasActiveScene)
          .prepareCandidates(deduplicateCandidates([
            ...this.loadEntityCandidates(input.workspaceId, entityIds, perspective),
            // Only bonds that touch the turn's focus: two absent entities' ties rarely shape a scene.
            ...this.loadKnownRelationshipCandidates(input.workspaceId, entityIds.filter(id => focusIds.has(id)), perspective),
            ...this.loadRelationCandidates(input.workspaceId, entityIds, perspective),
            ...this.loadEpistemicCandidates(
              input.workspaceId,
              entityIds,
              input.query,
              input.items.flatMap(item => item.factIds ?? []),
              perspective
            ),
            ...this.loadInventoryCandidates(input.workspaceId, entityIds),
            ...this.loadRoleplayCandidates(input.workspaceId, entityIds)
          ]))
      };
    });
    // Scene memory is bounded per character and always sent, so the planner gets what it leaves.
    const memorySection = this.composeCharacterMemory(
      input.workspaceId,
      uniqueIds([...participantIds, ...(scene?.possibleObserverIds ?? [])]).filter(id => id !== playerId)
    );
    const orchestrated = this.roleplayOrchestrator.plan({
      requestId: input.requestId,
      workspaceId: input.workspaceId,
      query: input.query,
      through: strategy.through,
      tokenBudget: Math.max(0, Math.floor(input.tokenBudget) - (memorySection ? this.estimateTokens(memorySection) : 0)),
      authorityCandidates,
      evidenceCandidates: strategy.hasActiveScene
        ? retrieved.filter(candidate => candidate.source.type !== 'canon')
        : [],
      subjects,
      assessments,
      targetNames: names
    });
    const manifest = this.manifests.save({
      requestId: input.requestId,
      workspaceId: input.workspaceId,
      sequence: strategy.through.sequence,
      ...(scene?.id ? { sceneId: scene.id } : {}),
      ...(playerId ? { playerSubjectId: playerId } : {}),
      subjectIds,
      targetIds,
      assessments,
      deepenedPairs: orchestrated.deepenedPairs
    });
    return {
      plan: orchestrated.playerPlan ?? fallbackPlan,
      bundle: orchestrated.bundle,
      manifest,
      context: [orchestrated.context, memorySection].filter(Boolean).join('\n\n')
    };
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

  private getRetrievalSettings(): {
    worldbuildBreadth: 'focused' | 'balanced' | 'broad';
    worldbuildEntityLimit: number;
  } {
    const hasSettings = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'settings'").get();
    const row = hasSettings
      ? this.db.prepare("SELECT value FROM settings WHERE key = 'advanced'").get() as { value?: string } | undefined
      : undefined;
    const advanced = row?.value ? parseObject(row.value) : {};
    return normalizeRetrievalSettings(advanced);
  }

  private expandEntityIds(
    workspaceId: string,
    seedIds: string[],
    breadth: 'focused' | 'balanced' | 'broad',
    limit: number
  ): string[] {
    return discoverEntityIds(seedIds, breadth, limit, (frontier: string[], edgeLimit: number) => {
      const placeholders = frontier.map(() => '?').join(', ');
      return this.db.prepare(`
        SELECT links.fromId, links.toId
        FROM entity_links AS links
        JOIN entities AS source ON source.id = links.fromId AND source.workspaceId = links.workspaceId
        JOIN entities AS target ON target.id = links.toId AND target.workspaceId = links.workspaceId
        WHERE links.workspaceId = ?
          AND (links.fromId IN (${placeholders}) OR links.toId IN (${placeholders}))
          AND source.status != 'proposed' AND target.status != 'proposed'
        ORDER BY links.rowid
        LIMIT ?
      `).all(workspaceId, ...frontier, ...frontier, edgeLimit) as Array<{ fromId: string; toId: string }>;
    });
  }

  private resolveStrategy(workspaceId: string): KallamoContextStrategy {
    const through = this.getLatestPosition(workspaceId);
    if (getWorkspaceExperienceMode(this.db, workspaceId) === 'standard') {
      return createStandardStrategy(through);
    }
    const scene = this.scenes.getActive(workspaceId);
    if (scene) return createRoleplayStrategy(
      scene.perspective,
      { sequence: Math.max(scene.position.sequence, through.sequence), timestamp: through.timestamp ?? scene.position.timestamp },
      true
    );
    const playerEntityId = this.roleplay.getSettings(workspaceId).playerEntityId;
    if (playerEntityId) return createRoleplayStrategy({ access: 'subjective', focalSubjectId: playerEntityId }, through, false);
    return createRoleplayStrategy({ access: 'explicit', allowedSubjectIds: [] }, through, false);
  }

  private loadRoleplayCandidates(workspaceId: string, entityIds: string[]): ContextCandidate[] {
    const settings = this.roleplay.getSettings(workspaceId);
    const ids = new Set(entityIds);
    if (settings.playerEntityId) ids.add(settings.playerEntityId);
    const usedDefinitions = new Map<string, ReturnType<RoleplaySystem['listEntityResources']>[number]>();
    const values = [...ids].flatMap(entityId => {
      const entity = this.db.prepare(`
        SELECT 1 FROM entities WHERE workspaceId = ? AND id = ? AND status != 'proposed'
      `).get(workspaceId, entityId);
      if (!entity) return [];
      return this.roleplay.listEntityResources(workspaceId, entityId).map(resource => {
        usedDefinitions.set(resource.definitionId, resource);
        return this.candidate({
          id: `roleplay-state:${entityId}:${resource.definitionId}`,
          workspaceId, sourceType: 'state', sourceId: `${entityId}:${resource.key}`,
          content: `${resource.name}: ${resource.current} / ${resource.maximum}${resource.unit ? ` ${resource.unit}` : ''}`,
          relevance: 1,
          epistemic: { kind: 'knowledge', subjectId: entityId, accessibility: 'available' },
          provenanceIds: [resource.definitionId, entityId]
        });
      });
    });
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
    return [...values, ...rules, ...this.loadProgressionCandidates(workspaceId, ids), ...this.loadSkillCandidates(workspaceId, ids)];
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

  private loadSceneCandidates(workspaceId: string): ContextCandidate[] {
    const scene = this.roleplay.getScene(workspaceId);
    if (!scene) return [];
    const names = this.getEntityNames(workspaceId, uniqueIds([
      scene.locationId,
      ...scene.participantIds,
      ...scene.possibleObserverIds,
      ...scene.nearbyIds,
      ...scene.objectIds
    ]));
    const nearbyIds = uniqueIds([...scene.possibleObserverIds, ...scene.nearbyIds]);
    // The surroundings travel with the place, so the narrator knows the tavern is in a port
    // city without having to look the city up.
    const locationChain = loadLocationChain(this.db, workspaceId, scene.locationId);
    const lines = [
      `Scene: ${scene.id}`,
      `Location: ${locationChain.length ? describeLocationChain(locationChain) : scene.locationId ? names.get(scene.locationId) ?? scene.locationId : 'Unspecified'}`,
      `Active participants: ${formatEntityList(scene.participantIds, names)}`,
      `Nearby characters: ${formatEntityList(nearbyIds, names)}. Presence alone does not mean they noticed or learned what happened.`,
      `Objects present: ${formatEntityList(scene.objectIds, names)}`
    ];
    return [this.candidate({
      id: `roleplay-scene:${scene.id}`,
      workspaceId,
      sourceType: 'state',
      sourceId: scene.id,
      content: lines.join('\n'),
      relevance: 1,
      epistemic: { kind: 'canon', access: 'public' },
      provenanceIds: [scene.id]
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

  // Read straight from the stored definition: the context only needs names, and must not create one.
  private getCalendarNames(workspaceId: string): CalendarNames | null {
    const exists = this.db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'worldbuild_calendars'").get();
    const row = exists
      ? this.db.prepare('SELECT definition_json FROM worldbuild_calendars WHERE workspace_id = ?').get(workspaceId) as { definition_json: string } | undefined
      : undefined;
    if (!row) return null;
    try {
      const definition = JSON.parse(row.definition_json) as { months?: Array<{ name?: string }>; eras?: Array<{ id?: string; shortName?: string; name?: string }> };
      return {
        months: (definition.months ?? []).map(month => String(month?.name ?? '')),
        eras: new Map((definition.eras ?? []).map(era => [String(era?.id ?? ''), String(era?.shortName || era?.name || '')]))
      };
    } catch {
      return null;
    }
  }

  private getLatestPosition(workspaceId: string): NarrativePosition {
    const row = this.db.prepare(`
      SELECT COALESCE(MAX(narrative_sequence), 0) AS sequence
      FROM narrative_events WHERE workspace_id = ?
    `).get(workspaceId) as { sequence: number };
    return { sequence: row.sequence };
  }

  /** The focus is what a record, the scene, the perspective or the request names; tags alone never make it. */
  private resolveRelevantEntityIds(
    workspaceId: string,
    query: string,
    items: RetrievedContextItem[],
    perspective: Perspective
  ): { ids: string[]; focusIds: string[] } {
    const ids = new Set(items.flatMap(item => item.entityIds ?? []));
    const focus = new Set(ids);
    const chunkIds = items
      .filter(item => item.entityExpansion !== 'none')
      .map(item => item.id)
      .filter(Boolean);
    if (chunkIds.length) {
      const placeholders = chunkIds.map(() => '?').join(', ');
      const rows = this.db.prepare(`
        SELECT DISTINCT ct.entity AS id
        FROM chunk_tags AS ct
        JOIN entities AS e ON e.id = ct.entity AND e.workspaceId = ?
        WHERE ct.chunkId IN (${placeholders})
      `).all(workspaceId, ...chunkIds) as Array<{ id: string }>;
      rows.forEach(row => ids.add(row.id));
    }
    const scene = this.roleplay.getScene(workspaceId);
    [
      perspective.focalSubjectId,
      ...(perspective.allowedSubjectIds ?? []),
      ...(scene?.participantIds ?? []),
      ...(scene?.possibleObserverIds ?? []),
      ...(scene?.nearbyIds ?? []),
      ...(scene?.objectIds ?? []),
      scene?.locationId,
      ...this.resolveMentionedEntityIds(workspaceId, query)
    ].forEach(id => {
      if (!id) return;
      ids.add(id);
      focus.add(id);
    });
    return { ids: [...ids], focusIds: [...focus] };
  }

  private loadEntityMentions(workspaceId: string, entityIds: string[]): ContextCandidate[] {
    if (!entityIds.length) return [];
    const placeholders = entityIds.map(() => '?').join(', ');
    const entities = this.db.prepare(`
      SELECT id, type, canonicalName, lore, data, status
      FROM entities
      WHERE workspaceId = ? AND id IN (${placeholders}) AND status != 'proposed'
    `).all(workspaceId, ...entityIds) as EntityRow[];
    return entities.map(entity => this.candidate({
      id: `entity:${entity.id}`,
      workspaceId,
      sourceType: 'canon',
      sourceId: entity.id,
      content: composeEntityMention(entity),
      relevance: 0.5,
      epistemic: { kind: 'canon', access: 'public' },
      provenanceIds: [entity.id]
    }));
  }

  private resolveMentionedEntityIds(workspaceId: string, query: string): string[] {
    const normalizedQuery = query.toLocaleLowerCase();
    if (!normalizedQuery.trim()) return [];
    const rows = this.db.prepare(`
      SELECT id, canonicalName, aliases FROM entities
      WHERE workspaceId = ? AND status != 'proposed'
    `).all(workspaceId) as Array<{ id: string; canonicalName: string; aliases: string | null }>;
    return rows.flatMap(row => {
      const aliases = parseStringList(row.aliases);
      const matched = [row.canonicalName, ...aliases].some(name => {
        const normalized = name.trim().toLocaleLowerCase();
        return normalized.length >= 2 && normalizedQuery.includes(normalized);
      });
      return matched ? [row.id] : [];
    });
  }

  private resolveLinkedChunkIds(workspaceId: string, items: RetrievedContextItem[]): Set<string> {
    const chunkIds = items.map(item => item.id).filter(Boolean);
    if (!chunkIds.length) return new Set();
    const placeholders = chunkIds.map(() => '?').join(', ');
    const rows = this.db.prepare(`
      SELECT DISTINCT ct.chunkId AS id
      FROM chunk_tags AS ct
      JOIN entities AS e ON e.id = ct.entity AND e.workspaceId = ?
      WHERE ct.chunkId IN (${placeholders})
    `).all(workspaceId, ...chunkIds) as Array<{ id: string }>;
    return new Set(rows.map(row => row.id));
  }

  private toRetrievedCandidate(
    workspaceId: string,
    item: RetrievedContextItem,
    linkedChunkIds: Set<string>,
    hasActiveScene: boolean
  ): ContextCandidate {
    const epistemic: ContextEpistemicMetadata = item.kind === 'worldbuild-canon'
      ? { kind: 'canon', access: 'public' }
      : {
        kind: 'unclassified',
        sensitivity: !hasActiveScene || linkedChunkIds.has(item.id) ? 'unknown' : 'neutral'
      };
    return this.candidate({
      id: `retrieved:${item.kind}:${item.id}`,
      workspaceId,
      sourceType: item.kind === 'worldbuild-canon' ? 'canon' : 'text',
      sourceId: item.id,
      content: item.content,
      relevance: normalizeRelevance(item.relevance),
      epistemic,
      provenanceIds: item.provenanceIds
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
      SELECT type_id, field_key, label, ai_access, value_type, options_json
      FROM worldbuild_field_definitions WHERE workspace_id = ?
    `).all(workspaceId) as FieldRow[];
    if (perspective.access !== 'omniscient') {
      const ownerIds = perspective.access === 'subjective'
        ? [perspective.focalSubjectId!]
        : perspective.allowedSubjectIds ?? [];
      if (!ownerIds.length) {
        return entities.flatMap(entity => {
          const content = expansion === 'summary' ? composeEntitySummary(entity) : composeEntity(entity, fields);
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
      return knownCandidates;
    }
    return entities.flatMap(entity => {
      const content = expansion === 'summary' ? composeEntitySummary(entity) : composeEntity(entity, fields);
      if (!content) return [];
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
    });
  }

  private loadEpistemicCandidates(
    workspaceId: string,
    entityIds: string[],
    query: string,
    explicitFactIds: string[],
    perspective: Perspective,
    includeEntityRecords = true
  ): ContextCandidate[] {
    const relevantIds = new Set(entityIds);
    const requiredFactIds = new Set(explicitFactIds);
    const queryTerms = meaningfulTerms(query);
    const sharedCache = new Map<string, Set<string>>();
    const rows = loadCurrentNarrativeRecords(this.db, {
      workspaceId,
      recordTypes: ['fact', 'state', 'knowledge', 'belief', 'memory', 'relationship']
    });
    // Tellers and entity-reference objects are named in one read, so no uuid reaches the model.
    const calendar = this.getCalendarNames(workspaceId);
    const informantNames = this.getEntityNames(workspaceId, [...new Set(rows.flatMap(({ row, payload }) => [
      ...(Array.isArray(payload.informantIds) ? payload.informantIds.map(String) : []),
      ...entityReferencesIn(payload),
      ...(row.record_type === 'relationship' ? [row.subject_id, String(payload.targetEntityId ?? '')] : [])
    ]))]);
    return rows.flatMap(({ row, payload }) => {
      const aboutId = String((payload.proposition as Record<string, unknown> | undefined)?.subjectId ?? '');
      const stateEntityId = String(payload.entityId ?? '');
      const targetId = String(payload.targetEntityId ?? '');
      const relatedEntityIds = Array.isArray(payload.relatedEntityIds)
        ? payload.relatedEntityIds.map(String)
        : [];
      const isEntityRelevant = relevantIds.has(row.subject_id)
        || relevantIds.has(aboutId)
        || relevantIds.has(stateEntityId)
        || relevantIds.has(targetId)
        || relatedEntityIds.some(id => relevantIds.has(id));
      const isFactRelevant = row.record_type === 'fact'
        && (requiredFactIds.has(row.record_id) || hasMeaningfulOverlap(queryTerms, JSON.stringify(payload)));
      if ((!includeEntityRecords || !isEntityRelevant) && !isFactRelevant) return [];
      if (
        row.record_type === 'fact'
        && (payload.proposition as Record<string, unknown> | undefined)?.predicate === 'recorded-occurrence'
        && perspective.access === 'subjective'
        && perspective.focalSubjectId
        && !canSubjectAccessOccurrence(this.db, workspaceId, row.source_event_id, perspective.focalSubjectId)
      ) return [];
      const normalized = normalizeRecord(row, payload, informantNames, calendar);
      if (!normalized) return [];
      if (
        perspective.access === 'subjective'
        && perspective.focalSubjectId
        && (row.record_type === 'knowledge' || row.record_type === 'belief')
        && row.subject_id !== perspective.focalSubjectId
        && this.isGroupKnowledgeShared(workspaceId, row.subject_id, aboutId, perspective.focalSubjectId, sharedCache)
      ) {
        normalized.epistemic = row.record_type === 'knowledge'
          ? { kind: 'knowledge', subjectId: perspective.focalSubjectId, accessibility: accessibility(payload.accessibility) }
          : { kind: 'belief', subjectId: perspective.focalSubjectId, relationToCanon: beliefRelation(payload.relationToCanon) };
      }
      if (
        perspective.access === 'subjective'
        && perspective.focalSubjectId
        && row.record_type === 'memory'
        && row.subject_id !== perspective.focalSubjectId
        && isFactionOccurrenceMemoryShared(
          this.db,
          workspaceId,
          row.source_event_id,
          row.subject_id,
          perspective.focalSubjectId
        )
      ) {
        normalized.epistemic = {
          kind: 'memory',
          subjectId: perspective.focalSubjectId,
          accessibility: accessibility(payload.accessibility)
        };
      }
      return [this.candidate({
        id: `${row.record_type}:${row.record_id}`,
        workspaceId,
        sourceType: row.record_type === 'fact' ? 'canon' : row.record_type,
        sourceId: row.record_id,
        content: `Narrative sequence: ${row.narrative_sequence}\n${normalized.content}`,
        relevance: requiredFactIds.has(row.record_id) ? 1 : (isEntityRelevant ? 0.95 : 0.85),
        position: { sequence: row.narrative_sequence },
        epistemic: normalized.epistemic,
        provenanceIds: [row.source_event_id, row.record_id]
      })];
    });
  }

  private loadRelationCandidates(workspaceId: string, entityIds: string[], perspective: Perspective): ContextCandidate[] {
    if (!entityIds.length) return [];
    const placeholders = entityIds.map(() => '?').join(', ');
    const rows = this.db.prepare(`
      SELECT links.id, links.fromId, links.toId, links.relType, links.label, links.metadata_json AS metadataJson,
        source.canonicalName AS sourceName, target.canonicalName AS targetName
      FROM entity_links AS links
      JOIN entities AS source ON source.id = links.fromId AND source.workspaceId = links.workspaceId
      JOIN entities AS target ON target.id = links.toId AND target.workspaceId = links.workspaceId
      WHERE links.workspaceId = ?
        AND (links.fromId IN (${placeholders}) OR links.toId IN (${placeholders}))
        AND source.status != 'proposed' AND target.status != 'proposed'
    `).all(workspaceId, ...entityIds, ...entityIds) as Array<{
      id: string; fromId: string; toId: string; relType: string; label: string | null;
      sourceName: string; targetName: string; metadataJson: string | null;
    }>;
    const authorized = new Set(perspective.access === 'subjective'
      ? [perspective.focalSubjectId!]
      : perspective.access === 'explicit' ? perspective.allowedSubjectIds ?? [] : []);
    // A relationship the narrative ledger holds is rendered from the ledger; the edge would repeat it.
    const ledgerPairs = new Set(loadCurrentNarrativeRecords(this.db, { workspaceId, recordTypes: ['relationship'] })
      .map(({ row, payload }) => `${row.subject_id}\u0000${String(payload.targetEntityId ?? '')}`));
    return rows
      .filter(row => row.relType !== 'related_to' || !ledgerPairs.has(`${row.fromId}\u0000${row.toId}`))
      .filter(row => perspective.access === 'omniscient' || authorized.has(row.fromId)).map(row => {
      const metadata = parseObject(row.metadataJson);
      const value = Number(metadata.value);
      const description = String(metadata.description ?? '').trim();
      const lines = [
        `${row.sourceName} → ${row.targetName}`,
        `Title: ${row.label || row.relType}`,
        ...(Number.isFinite(value) ? [`Value: ${Math.max(-100, Math.min(100, value))}`] : []),
        ...(description ? [`Description: ${description}`] : [])
      ];
      return this.candidate({
        id: `relation:${row.id}`,
        workspaceId,
        sourceType: 'relationship',
        sourceId: row.id,
        content: lines.join('\n'),
        relevance: 1,
        epistemic: { kind: 'relationship', subjectIds: [row.fromId] },
        provenanceIds: [row.id, row.fromId, row.toId]
      });
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
    perspective: Perspective
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
    `).all(workspaceId, ...cardIds, ...entityIds, ...entityIds) as Array<{
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

  /** Whether a statement a faction or a place holds about a target reaches this member. */
  private isGroupKnowledgeShared(
    workspaceId: string,
    groupId: string,
    targetId: string,
    memberId: string,
    cache: Map<string, Set<string>>
  ): boolean {
    let readable = cache.get(memberId);
    if (!readable) {
      readable = new Set(sharedKnowledgeCards(this.db, workspaceId, [memberId])
        .map(card => `${card.groupId}\u0000${card.targetId}`));
      cache.set(memberId, readable);
    }
    return readable.has(`${groupId}\u0000${targetId}`);
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

function normalizeRecord(
  row: NarrativeRecordRow,
  payload: Record<string, unknown>,
  nameById: Map<string, string> = new Map(),
  calendar: CalendarNames | null = null
): { content: string; epistemic: ContextEpistemicMetadata } | undefined {
  const subjectId = row.subject_id;
  if (row.record_type === 'fact') {
    if ((payload.status ?? 'active') !== 'active') return undefined;
    const proposition = payload.proposition as Record<string, unknown> | undefined;
    const predicate = String(proposition?.predicate ?? '').trim();
    if (!predicate || proposition?.object === undefined) return undefined;
    return {
      content: withCategory(payload, `${predicate}: ${formatNarrativeValue(proposition.object, nameById)}`),
      epistemic: { kind: 'canon', access: 'public' }
    };
  }
  if (row.record_type === 'state') {
    const property = String(payload.property ?? '').trim();
    if (!property || payload.value === undefined) return undefined;
    return {
      content: `${property}: ${formatNarrativeValue(payload.value, nameById)}`,
      epistemic: { kind: 'canon', access: 'public' }
    };
  }
  if (row.record_type === 'relationship') {
    const targetId = String(payload.targetEntityId ?? '');
    const dimension = String(payload.dimension ?? '').trim();
    if (!targetId || !dimension || !Number.isFinite(Number(payload.value))) return undefined;
    const title = String(payload.title ?? '').trim();
    const description = String(payload.description ?? '').trim();
    return {
      content: [
        `${nameById.get(subjectId) ?? subjectId} → ${nameById.get(targetId) ?? targetId}`,
        ...(title ? [`Title: ${title}`] : []),
        `Dimension: ${dimension}`,
        `Value: ${Number(payload.value)}`,
        ...(description ? [`Description: ${description}`] : [])
      ].join('\n'),
      epistemic: { kind: 'relationship', subjectIds: [subjectId, targetId] }
    };
  }

  if (row.record_type === 'memory') {
    if ((payload.status ?? 'active') === 'forgotten') return undefined;
    const content = String(payload.summary ?? '').trim();
    if (!content) return undefined;
    const happenedOn = formatWorldDay(payload.occurredOn, calendar);
    return {
      content: withCategory(payload, happenedOn ? `${content}
Happened on: ${happenedOn}` : content),
      epistemic: { kind: 'memory', subjectId, accessibility: accessibility(payload.accessibility) }
    };
  }
  if (payload.status !== 'active') return undefined;
  const proposition = payload.proposition as Record<string, unknown> | undefined;
  const content = proposition?.object === undefined || proposition?.object === null
    ? ''
    : formatNarrativeValue(proposition.object, nameById).trim();
  if (!content) return undefined;
  if (row.record_type === 'belief') {
    const relation = payload.relationToCanon;
    return {
      content: withCategory(payload, content),
      epistemic: {
        kind: 'belief',
        subjectId,
        relationToCanon: relation === 'aligned' || relation === 'contradicted' ? relation : 'unknown'
      }
    };
  }
  // Hearsay that reads like first-hand perception makes a character state a rumour as fact.
  const informants = Array.isArray(payload.informantIds) ? payload.informantIds.map(String).filter(Boolean) : [];
  const attribution = payload.acquisition === 'reported'
    ? `Learned: reported${informants.length ? ` by ${informants.map(id => nameById.get(id) ?? id).join(', ')}` : ''}`
    : payload.acquisition === 'inferred'
      ? 'Learned: inferred by the subject'
      : payload.acquisition === 'participant' || payload.acquisition === 'witness'
        ? 'Learned: observed first-hand'
        : '';
  return {
    content: attribution ? `${content}\n${attribution}` : content,
    epistemic: { kind: 'knowledge', subjectId, accessibility: accessibility(payload.accessibility) }
  };
}

/** A secret and world lore read the same as bare sentences; the category says which may be repeated aloud. */
interface CalendarNames {
  months: string[];
  eras: Map<string, string>;
}

function formatWorldDay(value: unknown, calendar: CalendarNames | null): string {
  if (!value || typeof value !== 'object') return '';
  const date = value as Record<string, unknown>;
  const [year, month, day] = [date.year, date.month, date.day].map(Number);
  if (![year, month, day].every(part => Number.isInteger(part) && part >= 1)) return '';
  const monthName = calendar?.months[month - 1] || `month ${month}`;
  const era = calendar?.eras.get(String(date.eraId ?? '')) ?? '';
  return `${day} ${monthName} ${year}${era ? ` ${era}` : ''}`;
}

function withCategory(payload: Record<string, unknown>, content: string): string {
  const label = categoryLabel(payload.category);
  return label ? `${content}
Kind: ${label}` : content;
}

function categoryLabel(value: unknown): string | undefined {
  const category = normalizeKnowledgeCategory(value);
  if (category) return KNOWLEDGE_CATEGORY_LABELS[category];
  const memory = normalizeMemoryCategory(value);
  return memory ? MEMORY_CATEGORY_LABELS[memory] : undefined;
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
    lines.push(`${field?.label || nativeFieldLabel(key)}: ${formatNarrativeValue(field ? choiceLabels(field, value) : value)}`);
  }
  return lines.join('\n');
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

// The name, type and first sentence of the description: enough to place a name a passage uses.
function composeEntityMention(entity: EntityRow): string {
  const data = parseObject(entity.data);
  const description = String(data.description ?? data.content ?? entity.lore ?? '').replace(/\s+/g, ' ').trim();
  const sentence = description.match(/^.{1,200}?[.!?](?=\s|$)/)?.[0] ?? description.slice(0, 200);
  return sentence ? `${entity.canonicalName} (${entity.type}): ${sentence}` : `${entity.canonicalName} (${entity.type})`;
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
    status: 'Status', age: 'Age', appearance: 'Appearance', personality: 'Personality',
    disposition: 'Disposition', nature: 'Nature', abundance: 'Abundance', threat: 'Threat',
    abilities: 'Abilities', locationType: 'Type', size: 'Size', itemType: 'Type', description: 'Description',
    kind: 'Kind', content: 'Content'
  };
  return labels[key] || key;
}

function beliefRelation(value: unknown): 'aligned' | 'contradicted' | 'unknown' {
  return value === 'aligned' || value === 'contradicted' ? value : 'unknown';
}

const ENTITY_REFERENCE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function entityReferencesIn(payload: Record<string, unknown>): string[] {
  const candidates = [
    (payload.proposition as Record<string, unknown> | undefined)?.object,
    payload.value
  ];
  return candidates
    .filter((value): value is string => typeof value === 'string' && ENTITY_REFERENCE_PATTERN.test(value.trim()))
    .map(value => value.trim());
}

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
      && !['description', 'content', 'customFields', 'loreDocumentId', 'loreDocumentIds', 'aiPolicy', 'spoilers'].includes(key)
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

function composeContext(plan: ContextPlanResult): string {
  const sections = new Map<ContextSourceType, string[]>();
  plan.package.items.forEach(item => {
    const values = sections.get(item.source.type) ?? [];
    values.push(composePackageItem(item));
    sections.set(item.source.type, values);
  });
  const labels: Array<[ContextSourceType, string]> = [
    ['canon', 'CANONICAL CONTEXT'],
    ['state', 'ROLEPLAY STATE'],
    ['knowledge', 'SUBJECT KNOWLEDGE'],
    ['belief', 'BELIEFS AND UNCERTAINTY'],
    ['relationship', 'RELATIONSHIP CONTEXT'],
    ['memory', 'SUBJECT MEMORIES'],
    ['text', 'RETRIEVED EVIDENCE']
  ];
  return labels.flatMap(([type, label]) => {
    const values = sections.get(type);
    return values?.length ? [`--- ${label} ---\n${values.join('\n\n')}`] : [];
  }).join('\n\n');
}

function composePackageItem(item: ContextPlanResult['package']['items'][number]): string {
  const details = [`Source: ${item.source.type}:${item.source.id}`];
  const epistemic = item.epistemic;
  if ('subjectId' in epistemic) details.push(`Owner: ${epistemic.subjectId}`);
  if (epistemic.kind === 'belief') details.push(`Canon relation: ${epistemic.relationToCanon}`);
  if ('accessibility' in epistemic) details.push(`Accessibility: ${epistemic.accessibility}`);
  if (item.provenanceIds.length) details.push(`Provenance: ${item.provenanceIds.join(', ')}`);
  return `[${details.join(' | ')}]\n${item.content}`;
}

function deduplicateCandidates(candidates: ContextCandidate[]): ContextCandidate[] {
  const unique = new Map<string, ContextCandidate>();
  candidates.forEach(candidate => unique.set(candidate.id, candidate));
  return [...unique.values()];
}

/** One statement reaches the prompt once; the merged copies keep every source id. */
function deduplicateStandardEvidence(candidates: ContextCandidate[]): ContextCandidate[] {
  const selected: ContextCandidate[] = [];
  const memoryIndexes = new Map<string, number>();
  for (const candidate of candidates) {
    const kind = candidate.epistemic.kind;
    if (kind !== 'memory' && kind !== 'knowledge' && kind !== 'belief') {
      selected.push(candidate);
      continue;
    }
    // Two subjects knowing the same thing stay two records; an identical memory collapses.
    const owner = kind === 'memory' || !('subjectId' in candidate.epistemic)
      ? ''
      : candidate.epistemic.subjectId;
    const contentKey = statementKey(candidate.content.replace(/^Narrative sequence:\s*\d+\s*/i, ''));
    const key = `${kind}:${owner}:${contentKey}`;
    const existingIndex = memoryIndexes.get(key);
    if (existingIndex === undefined) {
      memoryIndexes.set(key, selected.length);
      selected.push(candidate);
      continue;
    }
    const existing = selected[existingIndex];
    const newer = (candidate.position?.sequence ?? 0) > (existing.position?.sequence ?? 0)
      ? candidate
      : existing;
    selected[existingIndex] = {
      ...newer,
      provenanceIds: uniqueIds([
        ...(existing.provenanceIds ?? []),
        ...(candidate.provenanceIds ?? [])
      ])
    };
  }
  return selected;
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

function accessibility(value: unknown): 'available' | 'suppressed' | 'inaccessible' {
  return value === 'suppressed' || value === 'inaccessible' ? value : 'available';
}

function normalizeRelevance(value: number | undefined): number {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value!)) : 0.5;
}

function resolveEntityExpansion(items: RetrievedContextItem[]): EntityExpansion {
  if (items.some(item => item.entityExpansion === 'dossier')) return 'dossier';
  if (items.some(item => item.entityExpansion === 'summary')) return 'summary';
  if (items.length && items.every(item => item.entityExpansion === 'none')) return 'none';
  return 'dossier';
}

function parseStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return value.split(',').map(item => item.trim()).filter(Boolean);
  }
}

function meaningfulTerms(value: string): Set<string> {
  return new Set(
    String(value || '')
      .toLocaleLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter(term => term.length >= 4)
  );
}

function hasMeaningfulOverlap(queryTerms: Set<string>, value: string): boolean {
  if (!queryTerms.size) return false;
  const candidateTerms = meaningfulTerms(value);
  let matches = 0;
  for (const term of queryTerms) {
    if (!candidateTerms.has(term)) continue;
    matches += 1;
    if (matches >= Math.min(2, queryTerms.size)) return true;
  }
  return false;
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

function formatEntityList(ids: string[], names: Map<string, string>): string {
  return ids.length ? ids.map(id => `${names.get(id) ?? id} [${id}]`).join(', ') : 'None';
}

export function createNarrativeChatContext(
  db: Database.Database,
  estimateTokens: (text: string) => number
): NarrativeChatContext {
  return new NarrativeChatContext(db, estimateTokens);
}
