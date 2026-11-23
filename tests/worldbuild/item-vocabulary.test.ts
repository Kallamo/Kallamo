import { describe, expect, test } from 'vitest';
import { ABUNDANCE_IDS, ITEM_CATEGORY_IDS } from '../../src/shared/item-vocabulary';
import { ENRICH_ENUMS } from '../../src/main/features/worldbuild/entity-fields.js';
import { DEFAULT_CALENDAR, normalizeCalendar } from '../../src/main/features/worldbuild/calendar-service.js';

describe('item vocabulary and the default calendar', () => {
  test('the AI is offered and held to exactly the lists the sheet shows', () => {
    expect(ENRICH_ENUMS.abundance).toEqual([...ABUNDANCE_IDS]);
    expect(ENRICH_ENUMS.itemType).toEqual([...ITEM_CATEGORY_IDS]);
  });

  test('values saved before the new steps stay on the scale, in order', () => {
    const old = ['Unique', 'Rare', 'Uncommon', 'Common', 'Abundant'];
    const positions = old.map(id => ABUNDANCE_IDS.indexOf(id));
    expect(positions.every(position => position >= 0)).toBe(true);
    expect([...positions].sort((a, b) => a - b)).toEqual(positions);
    expect(ITEM_CATEGORY_IDS).toEqual(expect.arrayContaining(['Furniture', 'Art', 'Vehicle', 'Object']));
  });

  test('a new calendar comes with four seasons covering every day, the leap day too', () => {
    const calendar = normalizeCalendar(DEFAULT_CALENDAR);
    expect(calendar.seasons.map((season: { name: string }) => season.name)).toEqual(['Spring', 'Summer', 'Autumn', 'Winter']);
    const ordinal = (month: number, day: number) => month * 1000 + day;
    const covering = (month: number, day: number) => calendar.seasons.filter((season: { start: { month: number; day: number }; end: { month: number; day: number } }) => {
      const start = ordinal(season.start.month, season.start.day);
      const end = ordinal(season.end.month, season.end.day);
      const at = ordinal(month, day);
      return start <= end ? at >= start && at <= end : at >= start || at <= end;
    });
    for (const [index, month] of calendar.months.entries()) {
      const days = index === 1 ? 29 : month.days;
      for (let day = 1; day <= days; day++) expect(covering(index + 1, day), `${month.name} ${day}`).toHaveLength(1);
    }
  });
});
