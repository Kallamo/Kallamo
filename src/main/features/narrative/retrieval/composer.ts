import type { WorldbuildView } from './entity-tiers';
import type { ContextItem, ContextSection } from './items';
import type { ContextMode, Need } from './needs';

const CORE_GROUPS = ['Scene', 'Workspace', 'Player', 'Present', 'Location', 'Objects here', 'State', 'Between them', 'Toward who is named', 'Last together', 'Nearby', 'Could come in', 'Character scene memory'];

function grouped(items: ContextItem[], order: string[] = []): string {
  const groups = new Map<string, string[]>();
  for (const item of items) {
    const name = item.group ?? '';
    groups.set(name, [...(groups.get(name) ?? []), item.text]);
  }
  const names = [...groups.keys()].sort((left, right) => {
    const a = order.indexOf(left);
    const b = order.indexOf(right);
    return (a < 0 ? order.length : a) - (b < 0 ? order.length : b);
  });
  return names.map(name => {
    const body = groups.get(name)!.join('\n\n');
    return name ? `[${name}]\n${body}` : body;
  }).join('\n\n');
}

/**
 * What the characters know, written once per statement: one held by everyone present stands under
 * one heading, the rest under the names of those who hold it.
 */
function knowledge(items: ContextItem[], view: WorldbuildView, presentIds: string[]): string {
  const byHolders = new Map<string, string[]>();
  for (const item of items) {
    const holders = [...new Set(item.holders)].sort();
    const everyone = presentIds.length > 1 && presentIds.every(id => holders.includes(id));
    const label = everyone ? 'Everyone present' : holders.map(id => view.nameOf(id) ?? 'Someone').join(', ');
    byHolders.set(label, [...(byHolders.get(label) ?? []), `- ${item.text}`]);
  }
  return [...byHolders].map(([label, lines]) => `Known to ${label}:\n${lines.join('\n')}`).join('\n\n');
}

function fieldGuidance(items: ContextItem[], view: WorldbuildView): string[] {
  const types = new Set(items.flatMap(item => item.key.startsWith('entity:') ? [view.entity(item.key.slice('entity:'.length))?.type] : []).filter(Boolean));
  return view.fields
    .filter(field => types.has(field.type_id) && field.ai_access !== 'hidden' && field.ai_guidance?.trim())
    .map(field => `Field "${field.label}" (${field.type_id}): ${field.ai_guidance!.trim()}`);
}

// Who is in the scene changes far less often than what happens in it; these groups lead the stable part.
const STABLE_GROUPS = new Set(['Player', 'Present', 'Location', 'Objects here']);

/**
 * The context in two parts: what holds while the scene lasts (rules and the sheets of who is here),
 * which a provider that caches can reuse, and what this turn adds.
 */
export function composeContextParts(input: { mode: ContextMode; items: ContextItem[]; needs: Need[]; view: WorldbuildView; presentIds: string[] }): { stable: string; volatile: string } {
  const { mode, items, view } = input;
  const of = (section: ContextSection) => items.filter(item => item.section === section);
  const needOrder = input.needs.map(need => need.label).filter(Boolean);
  const stable: string[] = [];
  const volatile: string[] = [];
  const core = of('core');
  const turn = of('turn');
  const knows = of('knows');
  const narrator = of('narrator');
  const rules = [...of('rules').map(item => item.text), ...fieldGuidance(items, view)];
  if (rules.length) stable.push(`--- RULES ---\n${rules.join('\n\n')}`);
  if (mode === 'roleplay') {
    const cast = core.filter(item => STABLE_GROUPS.has(item.group ?? ''));
    const now = core.filter(item => !STABLE_GROUPS.has(item.group ?? ''));
    stable.unshift('Context for this turn. WHO IS HERE, SCENE and FOR THIS TURN are what is true in the story. WHAT THE CHARACTERS KNOW says who knows what: a character may act only on what is known to them, on what they perceive now, and on their own sheet. NARRATOR ONLY never reaches a character who does not know it.');
    if (cast.length) stable.push(`--- WHO IS HERE ---\n${grouped(cast, CORE_GROUPS)}`);
    if (now.length) volatile.push(`--- SCENE ---\n${grouped(now, CORE_GROUPS)}`);
    if (turn.length) volatile.push(`--- FOR THIS TURN ---\n${grouped(turn, needOrder)}`);
    if (knows.length) volatile.push(`--- WHAT THE CHARACTERS KNOW ---\n${knowledge(knows, view, input.presentIds)}`);
    if (narrator.length) volatile.push(`--- NARRATOR ONLY ---\n${grouped(narrator)}`);
  } else {
    if (core.length) volatile.push(`--- WORKSPACE ---\n${grouped(core, CORE_GROUPS)}`);
    if (turn.length || knows.length) volatile.push(`--- FOR THIS REQUEST ---\n${grouped([...turn, ...knows], needOrder)}`);
    if (narrator.length) volatile.push(`--- NOTES ---\n${grouped(narrator)}`);
  }
  return { stable: stable.join('\n\n'), volatile: volatile.join('\n\n') };
}

export function composeContext(input: { mode: ContextMode; items: ContextItem[]; needs: Need[]; view: WorldbuildView; presentIds: string[] }): string {
  const { stable, volatile } = composeContextParts(input);
  return [stable, volatile].filter(Boolean).join('\n\n');
}
