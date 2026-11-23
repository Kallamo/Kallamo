// The app-wide panel layout: widths, sides and the Roleplay rail's blocks. A saved layout only
// holds what the person changed; everything else reads from these defaults.
export const LAYOUT_VERSION = 1;

export const PANELS = {
  roleplay: { width: 360, min: 288, max: 480, side: 'right' },
  memory: { width: 320, min: 280, max: 440 },
  worldbuild: { width: 368, min: 300, max: 520 },
  chapters: { width: 336, min: 260, max: 440, side: 'left' },
  notes: { width: 336, min: 288, max: 480 },
  directives: { width: 336, min: 288, max: 480 },
  analyses: { width: 416, min: 300, max: 560 },
};

// Narrowest the column beside the panels may get; the window's minimum width keeps every
// view able to honor it with its panels at their minimum.
export const CENTER_MIN = { chat: 480, memory: 480, worldbuild: 672, writing: 448 };

// Blocks reorder within their own tab of the rail; the clock sits above the tabs and only hides.
export const ROLEPLAY_BLOCKS = [
  { id: 'clock', tab: null, label: 'Clock' },
  { id: 'location', tab: 'scene', label: 'Location' },
  { id: 'in-scene', tab: 'scene', label: 'In scene' },
  { id: 'recent-changes', tab: 'scene', label: 'Recent changes' },
  { id: 'equipped', tab: 'inventory', label: 'Equipped' },
  { id: 'carried', tab: 'inventory', label: 'Carried' },
];
const BLOCK_IDS = new Set(ROLEPLAY_BLOCKS.map(block => block.id));

const SIDES = ['left', 'right'];
const isObject = value => !!value && typeof value === 'object' && !Array.isArray(value);

export const defaultBlocks = () => ROLEPLAY_BLOCKS.map(({ id }) => ({ id, hidden: false, collapsed: false }));
export const defaultLayout = () => ({ version: LAYOUT_VERSION, panels: {}, roleplayBlocks: defaultBlocks() });

export function clampPanelWidth(id, width, available = Infinity) {
  const spec = PANELS[id];
  const value = Number.isFinite(width) ? width : spec.width;
  return Math.round(Math.max(spec.min, Math.min(spec.max, available, value)));
}

// Unknown panels and blocks are dropped, and blocks a newer release adds join at the end of
// their tab, so a layout saved by another version still opens.
export function normalizeLayout(raw) {
  const layout = defaultLayout();
  if (!isObject(raw)) return layout;

  if (isObject(raw.panels)) {
    for (const [id, saved] of Object.entries(raw.panels)) {
      if (!PANELS[id] || !isObject(saved)) continue;
      const panel = {};
      const width = Number(saved.width);
      if (saved.width != null && Number.isFinite(width)) panel.width = clampPanelWidth(id, width);
      if (PANELS[id].side && SIDES.includes(saved.side)) panel.side = saved.side;
      if (Object.keys(panel).length) layout.panels[id] = panel;
    }
  }

  if (Array.isArray(raw.roleplayBlocks)) {
    const seen = new Set();
    const blocks = [];
    for (const saved of raw.roleplayBlocks) {
      if (!isObject(saved) || !BLOCK_IDS.has(saved.id) || seen.has(saved.id)) continue;
      seen.add(saved.id);
      blocks.push({ id: saved.id, hidden: saved.hidden === true, collapsed: saved.collapsed === true });
    }
    for (const block of defaultBlocks()) if (!seen.has(block.id)) blocks.push(block);
    layout.roleplayBlocks = blocks;
  }

  if (raw.worldbuildWidthAdopted === true) layout.worldbuildWidthAdopted = true;
  return layout;
}

export const panelWidth = (layout, id) => layout.panels[id]?.width ?? PANELS[id].width;
export const panelSide = (layout, id) => layout.panels[id]?.side ?? PANELS[id].side;

export function withPanel(layout, id, changes) {
  const panel = { ...layout.panels[id], ...changes };
  Object.keys(panel).forEach(key => panel[key] === undefined && delete panel[key]);
  const panels = { ...layout.panels };
  if (Object.keys(panel).length) panels[id] = panel;
  else delete panels[id];
  return { ...layout, panels };
}

export const blocksOfTab = (layout, tab) => layout.roleplayBlocks
  .filter(block => ROLEPLAY_BLOCKS.find(known => known.id === block.id)?.tab === tab);

export const roleplayBlock = (layout, id) => layout.roleplayBlocks.find(block => block.id === id)
  || { id, hidden: false, collapsed: false };

export function withBlock(layout, id, changes) {
  return { ...layout, roleplayBlocks: layout.roleplayBlocks.map(block => (block.id === id ? { ...block, ...changes } : block)) };
}

// Moves a block before or after another block of the same tab; other tabs keep their places.
export function withBlockMoved(layout, id, targetId, placeAfter) {
  const blocks = layout.roleplayBlocks;
  const moving = blocks.find(block => block.id === id);
  const tabOf = blockId => ROLEPLAY_BLOCKS.find(known => known.id === blockId)?.tab;
  if (!moving || id === targetId || tabOf(id) !== tabOf(targetId)) return layout;
  const rest = blocks.filter(block => block.id !== id);
  const targetIndex = rest.findIndex(block => block.id === targetId);
  if (targetIndex < 0) return layout;
  rest.splice(targetIndex + (placeAfter ? 1 : 0), 0, moving);
  return { ...layout, roleplayBlocks: rest };
}

// One step up or down among the visible blocks of its tab.
export function withBlockStep(layout, id, step) {
  const tab = ROLEPLAY_BLOCKS.find(known => known.id === id)?.tab;
  const visible = blocksOfTab(layout, tab).filter(block => !block.hidden);
  const index = visible.findIndex(block => block.id === id);
  const target = visible[index + step];
  if (index < 0 || !target) return layout;
  return withBlockMoved(layout, id, target.id, step > 0);
}
