import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { createEntityLabels, labelPrefix } = require('../src/main/features/ai-engine/entity-labels');

const JASPER = '8f160f32-257d-4304-a8df-d79c10d27223';
const ODRIS = '8ce4559b-92ca-4d4e-96ff-461111d013bb';
const LANTERN = 'c23683bd-5fba-4bd5-bfb6-7e2e0c5c4a73';
const KEY = 'e2051f66-45be-4aa3-851c-55176cca4d66';
const RAVEN = '7b749619-7a77-434a-a897-8788c15a83fe';

const labels = createEntityLabels([
  { id: JASPER, type: 'Characters', canonicalName: 'Jasper' },
  { id: ODRIS, type: 'Characters', canonicalName: 'Odris' },
  { id: RAVEN, type: 'Creatures', canonicalName: 'The "Grey" Raven' },
  { id: LANTERN, type: 'Locations', canonicalName: 'The Last Lantern' },
  { id: KEY, type: 'Items', canonicalName: 'Room key' }
]);

describe('entity labels', () => {
  test('read as the English singular of each type, numbered per type', () => {
    expect([JASPER, ODRIS, RAVEN, LANTERN, KEY].map(labels.labelFor))
      .toEqual(['character1', 'character2', 'creature1', 'location1', 'item1']);
    expect(labelPrefix('Spells')).toBe('spell');
    expect(labelPrefix('???')).toBe('entity');
  });

  test('replace every known UUID in a request, wherever it sits, and leave others alone', () => {
    const other = '11111111-2222-4333-8444-555555555555';
    const request = JSON.stringify({
      currentScene: { locationId: LANTERN, participantIds: [JASPER, ODRIS] },
      byHolder: { [ODRIS]: [KEY] },
      note: `${ODRIS} keeps the key`,
      eventId: other
    });
    expect(labels.encode(request)).toBe(JSON.stringify({
      currentScene: { locationId: 'location1', participantIds: ['character1', 'character2'] },
      byHolder: { character2: ['item1'] },
      note: 'character2 keeps the key',
      eventId: other
    }));
  });

  test('turn a reply back: IDs to UUIDs, labels written in prose to names', () => {
    const reply = '{"presentIds":["character1","Character2"],"inventoryChanges":[{"itemId":"item1","toHolderId":"character2"}],"reason":"character1 gives item1 to character2 at location1.","quote":"creature1 watches"}';
    expect(JSON.parse(labels.decode(reply))).toEqual({
      presentIds: [JASPER, ODRIS],
      inventoryChanges: [{ itemId: KEY, toHolderId: ODRIS }],
      reason: 'Jasper gives Room key to Odris at The Last Lantern.',
      quote: 'The "Grey" Raven watches'
    });
  });

  test('leave labels that were never issued, new references and UUIDs as they came', () => {
    const reply = `{"entityId":"character9","referenceId":"new:waiter","holderId":"${JASPER}","label":"character10 or item12"}`;
    expect(labels.decode(reply)).toBe(reply);
  });

  test('round-trip a value and list the labels a request uses', () => {
    const value = { availableEntities: [{ id: ODRIS, name: 'Odris' }], currentScene: { locationId: LANTERN } };
    const encoded = labels.encodeValue(value);
    expect(encoded).toEqual({ availableEntities: [{ id: 'character2', name: 'Odris' }], currentScene: { locationId: 'location1' } });
    expect(JSON.parse(labels.decode(JSON.stringify(encoded)))).toEqual(value);
    expect(labels.legendFor(JSON.stringify(encoded))).toEqual([
      { label: 'character2', name: 'Odris' },
      { label: 'location1', name: 'The Last Lantern' }
    ]);
  });

  test('with no entities, nothing changes', () => {
    const empty = createEntityLabels([]);
    expect(empty.encode(`{"id":"${JASPER}"}`)).toBe(`{"id":"${JASPER}"}`);
    expect(empty.decode('{"id":"character1"}')).toBe('{"id":"character1"}');
    expect(empty.legendFor('character1')).toEqual([]);
  });
});
