import { describe, expect, test } from 'vitest';
import {
  PANELS, ROLEPLAY_BLOCKS, blocksOfTab, clampPanelWidth, defaultLayout, normalizeLayout, panelSide, panelWidth,
  withBlockMoved, withBlockStep, withPanel,
} from '../src/renderer/features/layout/layout-model';

const ids = (blocks: { id: string }[]) => blocks.map(block => block.id);

describe('normalizeLayout', () => {
  test('anything unreadable opens the default layout', () => {
    for (const raw of [null, undefined, 'x', 42, [], { panels: 'no', roleplayBlocks: 'no' }]) {
      expect(normalizeLayout(raw)).toEqual(defaultLayout());
    }
  });

  test('keeps saved widths and sides, clamped to each panel', () => {
    const layout = normalizeLayout({ version: 1, panels: { roleplay: { width: 9999, side: 'left' }, memory: { width: 10 }, worldbuild: { width: '400' } } });
    expect(panelWidth(layout, 'roleplay')).toBe(PANELS.roleplay.max);
    expect(panelSide(layout, 'roleplay')).toBe('left');
    expect(panelWidth(layout, 'memory')).toBe(PANELS.memory.min);
    expect(panelWidth(layout, 'worldbuild')).toBe(400);
  });

  test('drops unknown panels, bad values, and sides on panels that cannot move', () => {
    const layout = normalizeLayout({ panels: { sidebar: { width: 300 }, memory: { width: 'wide', side: 'left' }, roleplay: { side: 'top' } } });
    expect(layout.panels).toEqual({});
    expect(panelWidth(layout, 'memory')).toBe(PANELS.memory.width);
    expect(panelSide(layout, 'roleplay')).toBe('right');
  });

  test('ignores unknown and repeated blocks and appends missing ones at the end', () => {
    const layout = normalizeLayout({
      roleplayBlocks: [
        { id: 'recent-changes', hidden: true },
        { id: 'weather', hidden: false },
        { id: 'location', collapsed: true },
        { id: 'recent-changes', hidden: false },
      ],
    });
    expect(ids(layout.roleplayBlocks)).toEqual(['recent-changes', 'location', 'clock', 'in-scene', 'equipped', 'carried']);
    expect(layout.roleplayBlocks[0]).toEqual({ id: 'recent-changes', hidden: true, collapsed: false });
    expect(layout.roleplayBlocks[1]).toEqual({ id: 'location', hidden: false, collapsed: true });
    expect(ids(blocksOfTab(layout, 'scene'))).toEqual(['recent-changes', 'location', 'in-scene']);
  });

  test('a layout from before the rail had blocks keeps its widths', () => {
    const layout = normalizeLayout({ panels: { chapters: { width: 300, side: 'right' } } });
    expect(ids(layout.roleplayBlocks)).toEqual(ROLEPLAY_BLOCKS.map(block => block.id));
    expect(panelSide(layout, 'chapters')).toBe('right');
  });
});

describe('panel widths', () => {
  test('clamp to the panel range and to the room the window leaves', () => {
    expect(clampPanelWidth('roleplay', 400)).toBe(400);
    expect(clampPanelWidth('roleplay', 100)).toBe(PANELS.roleplay.min);
    expect(clampPanelWidth('roleplay', 470, 420)).toBe(420);
    expect(clampPanelWidth('roleplay', 470, 100)).toBe(PANELS.roleplay.min);
    expect(clampPanelWidth('roleplay', Number.NaN)).toBe(PANELS.roleplay.width);
  });

  test('removing every change leaves no entry behind', () => {
    const changed = withPanel(defaultLayout(), 'memory', { width: 360 });
    expect(changed.panels.memory).toEqual({ width: 360 });
    expect(withPanel(changed, 'memory', { width: undefined }).panels).toEqual({});
  });
});

describe('moving blocks', () => {
  test('a block moves only within its own tab', () => {
    const layout = defaultLayout();
    expect(ids(blocksOfTab(withBlockMoved(layout, 'recent-changes', 'location', false), 'scene'))).toEqual(['recent-changes', 'location', 'in-scene']);
    expect(withBlockMoved(layout, 'equipped', 'location', false)).toBe(layout);
  });

  test('stepping skips hidden blocks and stops at the ends', () => {
    const layout = normalizeLayout({ roleplayBlocks: [{ id: 'location' }, { id: 'in-scene', hidden: true }, { id: 'recent-changes' }] });
    expect(ids(blocksOfTab(withBlockStep(layout, 'recent-changes', -1), 'scene'))).toEqual(['recent-changes', 'location', 'in-scene']);
    expect(withBlockStep(layout, 'location', -1)).toBe(layout);
  });
});
