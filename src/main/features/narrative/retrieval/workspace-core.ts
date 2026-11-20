import { formatWorldDate, renderSheet, type WorldbuildView } from './entity-tiers';
import type { DraftItem } from './items';
import { ROLE_PRIORITY } from './salience';

/**
 * What every request outside Roleplay carries: the rules the user pinned and the world's date.
 * Pinned files and snippets already travel in the stable part of the prompt, so they are not repeated.
 */
export function buildWorkspaceCore(input: { view: WorldbuildView; alwaysInContextIds: string[] }): DraftItem[] {
  const { view } = input;
  const items: DraftItem[] = [];
  const today = formatWorldDate(view.clock, view.names);
  if (today) items.push({ key: 'workspace:date', section: 'core', needIds: [], tier: 'line', holders: [], group: 'Workspace', priority: ROLE_PRIORITY.core, text: `World date: ${today}` });
  for (const id of input.alwaysInContextIds) {
    const entity = view.entity(id);
    if (!entity) continue;
    items.push({ key: `entity:${id}`, section: 'rules', needIds: [], tier: 'sheet', holders: [], group: 'Rules', priority: ROLE_PRIORITY.core, text: renderSheet(view, entity) });
  }
  return items;
}
