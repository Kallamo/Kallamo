import { createStore, useStore } from '../../utils/store';
import {
  defaultLayout, normalizeLayout, withBlock, withBlockMoved, withBlockStep, withPanel,
} from './layout-model';

// Read once before React mounts, so every panel's first paint already has its saved layout.
// Changes land here at once and reach the disk a moment later.
const LOAD_TIMEOUT_MS = 400;
const SAVE_DELAY_MS = 250;

const layoutStore = createStore(defaultLayout());
let api = null;
let saveTimer = null;

export async function loadLayout(electronAPI) {
  api = electronAPI || null;
  if (!api?.getUiLayout) return;
  const result = await Promise.race([
    api.getUiLayout().catch(() => undefined),
    new Promise(resolve => setTimeout(() => resolve(undefined), LOAD_TIMEOUT_MS)),
  ]);
  if (result?.success && result.value) layoutStore.set(normalizeLayout(result.value));
}

const save = () => {
  saveTimer = null;
  api?.setUiLayout?.(layoutStore.get())?.catch?.(() => undefined);
};

function update(change) {
  layoutStore.set(change);
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, SAVE_DELAY_MS);
}

if (typeof window !== 'undefined') window.addEventListener('beforeunload', () => { if (saveTimer) { clearTimeout(saveTimer); save(); } });

export const getLayout = layoutStore.get;
export const useLayout = () => useStore(layoutStore);

const adopted = (layout, id) => (id === 'worldbuild' ? { ...layout, worldbuildWidthAdopted: true } : layout);
export const setPanelWidth = (id, width) => update(layout => adopted(withPanel(layout, id, { width: Math.round(width) }), id));
export const resetPanelWidth = id => update(layout => adopted(withPanel(layout, id, { width: undefined }), id));
export const setPanelSide = (id, side) => update(layout => withPanel(layout, id, { side }));
export const setBlock = (id, changes) => update(layout => withBlock(layout, id, changes));
export const moveBlock = (id, targetId, placeAfter) => update(layout => withBlockMoved(layout, id, targetId, placeAfter));
export const stepBlock = (id, step) => update(layout => withBlockStep(layout, id, step));
export const resetRoleplayBlocks = () => update(layout => ({ ...layout, roleplayBlocks: defaultLayout().roleplayBlocks }));
export const resetLayout = () => update(layout => ({ ...defaultLayout(), worldbuildWidthAdopted: layout.worldbuildWidthAdopted }));

// The Worldbuild sidebar width used to be kept per workspace; the first one read seeds the
// app layout once, so nobody loses the width they had and a later reset stays reset.
export function adoptLegacyUiState(scope, value) {
  if (scope !== 'worldbuild-navigation' || layoutStore.get().worldbuildWidthAdopted) return;
  const width = Number(value?.sidebarWidth);
  if (Number.isFinite(width) && width > 0) setPanelWidth('worldbuild', width);
}
export const resetRoleplayLayout = () => update(layout => ({
  ...withPanel(layout, 'roleplay', { width: undefined, side: undefined }),
  roleplayBlocks: defaultLayout().roleplayBlocks,
}));
export const resetWritingDeskLayout = () => update(layout => ['chapters', 'notes', 'directives', 'analyses']
  .reduce((next, id) => withPanel(next, id, { width: undefined, side: undefined }), layout));
