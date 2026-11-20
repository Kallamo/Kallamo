import type Database from 'better-sqlite3';
import { RoleplaySkills } from '../roleplay-skills';
import type { SkillRef } from './needs';
import type { SkillRule } from './resolvers';

/** The workspace's skills as rules a turn may ask for, with who in the scene has each. */
export interface SkillBook {
  refs: SkillRef[];
  /** Skills someone in the scene has. */
  held: Set<string>;
  /** Their names, for the planner. */
  heldNames: string[];
  rule(id: string): SkillRule | null;
}

const EMPTY: SkillBook = { refs: [], held: new Set(), heldNames: [], rule: () => null };

export function loadSkillBook(db: Database.Database, workspaceId: string, holderIds: string[], nameOf: (id: string) => string | undefined): SkillBook {
  const store = new RoleplaySkills(db);
  try {
    if (!store.getSettings(workspaceId).enabled) return EMPTY;
  } catch {
    return EMPTY;
  }
  const refs = store.listSkills(workspaceId)
    .filter(skill => skill.status === 'confirmed')
    .map(skill => ({ id: skill.id, name: skill.name, description: skill.description, parentId: skill.parentId }));
  const byId = new Map(refs.map(ref => [ref.id, ref]));
  const holders = new Map<string, Array<{ name: string; rank: string }>>();
  for (const holderId of [...new Set(holderIds)]) {
    for (const skill of store.getEntitySkills(workspaceId, holderId).skills) {
      holders.set(skill.skillId, [...(holders.get(skill.skillId) ?? []), { name: nameOf(holderId) ?? 'Someone', rank: skill.rankName }]);
    }
  }
  return {
    refs,
    held: new Set(holders.keys()),
    heldNames: [...holders.keys()].map(id => byId.get(id)?.name).filter((name): name is string => Boolean(name)),
    rule(id) {
      const ref = byId.get(id);
      if (!ref) return null;
      const parent = ref.parentId ? byId.get(ref.parentId)?.name : undefined;
      return { name: ref.name, description: ref.description.trim(), ...(parent ? { parentName: parent } : {}), holders: holders.get(id) ?? [] };
    }
  };
}
