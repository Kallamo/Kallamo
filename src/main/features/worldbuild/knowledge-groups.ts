import type Database from 'better-sqlite3';
import { locationSizeOf } from '../../../shared/location-sizes';

export type KnowledgeGroupKind = 'faction' | 'locality';

export interface KnowledgeGroup {
  id: string;
  kind: KnowledgeGroupKind;
}

/** A card a group holds that one of its members reads in play. */
export interface SharedKnowledgeCard {
  cardId: string;
  groupId: string;
  kind: KnowledgeGroupKind;
  targetId: string;
  knownAs: string | null;
  memberId: string;
}

// A containment chain longer than this is a cycle or a data error, never a real world.
const CHAIN_LIMIT = 16;
const SHARING_SIZES = new Set(['region', 'area']);

/**
 * The groups whose Knowledge a subject reads in play: each faction it belongs to now, and each
 * Region or Area it is local to together with every Region and Area around it.
 */
export function knowledgeGroupsOf(db: Database.Database, workspaceId: string, subjectId: string): KnowledgeGroup[] {
  const groups = new Map<string, KnowledgeGroupKind>();
  const links = db.prepare(`
    SELECT toId, relType FROM entity_links
    WHERE workspaceId = ? AND fromId = ? AND relType IN ('member_of', 'local_to')
  `).all(workspaceId, subjectId) as Array<{ toId: string; relType: string }>;
  const parents = db.prepare(`
    SELECT links.toId AS id, entities.data AS data
    FROM entity_links AS links
    JOIN entities ON entities.workspaceId = links.workspaceId AND entities.id = links.toId
    WHERE links.workspaceId = ? AND links.fromId = ? AND links.relType = 'inside'
  `);
  const seen = new Set<string>();
  let frontier: string[] = [];
  for (const link of links) {
    if (link.toId === subjectId) continue;
    if (link.relType === 'member_of') groups.set(link.toId, 'faction');
    else if (!groups.has(link.toId)) {
      groups.set(link.toId, 'locality');
      frontier.push(link.toId);
    }
    seen.add(link.toId);
  }
  // A place in between (a district that is not an Area) is walked through, never shared from.
  for (let depth = 0; depth < CHAIN_LIMIT && frontier.length; depth += 1) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const parent of parents.all(workspaceId, id) as Array<{ id: string; data: string | null }>) {
        if (seen.has(parent.id)) continue;
        seen.add(parent.id);
        next.push(parent.id);
        if (SHARING_SIZES.has(locationSizeOf({ data: parent.data }) ?? '') && !groups.has(parent.id)) {
          groups.set(parent.id, 'locality');
        }
      }
    }
    frontier = next;
  }
  return [...groups].map(([id, kind]) => ({ id, kind }));
}

/**
 * Every card a group holds that these members read. A faction may leave members out of a card;
 * a Region or Area always speaks to all of its locals. Without targets, every target counts.
 */
export function sharedKnowledgeCards(
  db: Database.Database,
  workspaceId: string,
  memberIds: string[],
  targetIds?: string[]
): SharedKnowledgeCard[] {
  if (!memberIds.length || (targetIds && !targetIds.length)) return [];
  const groupsByMember = new Map(memberIds.map(memberId => [memberId, knowledgeGroupsOf(db, workspaceId, memberId)]));
  const groupIds = [...new Set([...groupsByMember.values()].flatMap(groups => groups.map(group => group.id)))];
  if (!groupIds.length) return [];
  const cards = db.prepare(`
    SELECT card_id AS cardId, owner_id AS ownerId, target_id AS targetId,
      known_as AS knownAs, audience_type AS audienceType
    FROM worldbuild_knowledge_cards
    WHERE workspace_id = ? AND status = 'active'
      AND owner_id IN (${groupIds.map(() => '?').join(', ')})
      ${targetIds ? `AND target_id IN (${targetIds.map(() => '?').join(', ')})` : ''}
  `).all(workspaceId, ...groupIds, ...(targetIds ?? [])) as Array<{
    cardId: string; ownerId: string; targetId: string; knownAs: string | null; audienceType: string;
  }>;
  if (!cards.length) return [];
  const selected = new Set((db.prepare(`
    SELECT card_id AS cardId, member_id AS memberId FROM worldbuild_knowledge_audience_members
    WHERE workspace_id = ? AND entry_type = 'card' AND entry_id = card_id
      AND card_id IN (${cards.map(() => '?').join(', ')})
  `).all(workspaceId, ...cards.map(card => card.cardId)) as Array<{ cardId: string; memberId: string }>)
    .map(row => `${row.cardId}\u0000${row.memberId}`));
  const shared: SharedKnowledgeCard[] = [];
  for (const [memberId, groups] of groupsByMember) {
    const kindOf = new Map(groups.map(group => [group.id, group.kind]));
    for (const card of cards) {
      const kind = kindOf.get(card.ownerId);
      if (!kind) continue;
      const reads = kind === 'locality'
        || card.audienceType === 'all-members'
        || selected.has(`${card.cardId}\u0000${memberId}`);
      if (reads) {
        shared.push({ cardId: card.cardId, groupId: card.ownerId, kind, targetId: card.targetId, knownAs: card.knownAs, memberId });
      }
    }
  }
  return shared;
}
