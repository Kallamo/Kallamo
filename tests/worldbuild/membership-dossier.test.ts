import { describe, expect, test } from 'vitest';
import { edgeDetail, worldDateText } from '../../src/main/features/worldbuild/relation-dossier.js';

const calendar = {
  months: [{ name: 'Frostwane', days: 30 }, { name: 'Emberfall', days: 30 }],
  eras: [{ id: 'ae', shortName: 'AE', offset: 0 }],
};

describe('membership detail in the retrieval dossier', () => {
  test('a world date reads the way the sheet writes it', () => {
    expect(worldDateText(calendar, { day: 12, month: 1, year: 1245, eraId: 'ae' })).toBe('12 Frostwane 1245 AE');
    expect(worldDateText(calendar, { day: 3, month: 2, year: 880 })).toBe('3 Emberfall 880');
    expect(worldDateText(null, { day: 1, month: 1, year: 1 })).toBe('');
    expect(worldDateText(calendar, null)).toBe('');
  });

  test('a tenure carries its dates and its founder into the dossier', () => {
    const joined = { day: 12, month: 1, year: 1245, eraId: 'ae' };
    const left = { day: 2, month: 2, year: 1250, eraId: 'ae' };

    expect(edgeDetail({ metadata: { joined } }, calendar)).toBe(' (since 12 Frostwane 1245 AE)');
    expect(edgeDetail({ metadata: { joined, left } }, calendar))
      .toBe(' (from 12 Frostwane 1245 AE to 2 Emberfall 1250 AE)');
    expect(edgeDetail({ metadata: { left } }, calendar)).toBe(' (until 2 Emberfall 1250 AE)');
    expect(edgeDetail({ metadata: { founder: true, joined } }, calendar))
      .toBe(' (founder; since 12 Frostwane 1245 AE)');
    expect(edgeDetail({ metadata: { leaderSince: left } }, calendar))
      .toBe(' (leading since 2 Emberfall 1250 AE)');
  });

  test('edges with nothing to add stay exactly as they were', () => {
    expect(edgeDetail({ metadata: {} }, calendar)).toBe('');
    expect(edgeDetail({}, calendar)).toBe('');
    expect(edgeDetail({ metadata: { quantity: 2 } }, calendar)).toBe('');
    // Without a calendar the dates cannot be written, but the founder still can.
    expect(edgeDetail({ metadata: { founder: true, joined: { day: 1, month: 1, year: 1 } } }, null)).toBe(' (founder)');
  });
});
