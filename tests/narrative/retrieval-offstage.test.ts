import { describe, expect, test } from 'vitest';
import { aboutEachOther, actorsAboutPresent, couldComeIn, reunions, storyAge, towardNamed } from '../../src/main/features/narrative/retrieval/offstage';

const DAY = 24 * 60;
const NOW = 100 * DAY;

const people: Record<string, { type: string; name: string; data?: Record<string, unknown> }> = {
  hakan: { type: 'Characters', name: 'Hakan', data: { personality: 'Gruff and careful.' } },
  mara: { type: 'Characters', name: 'Mara', data: { personality: 'Blunt. Loyal.' } },
  kepler: { type: 'Characters', name: 'Kepler' },
  valera: { type: 'Characters', name: 'Valera', data: { personality: 'Direct and intense.' } },
  barnaby: { type: 'Characters', name: 'Barnaby', data: { personality: 'Loud and warm.' } },
  ghost: { type: 'Characters', name: 'Old Tom', data: { status: 'deceased' } },
  player: { type: 'Characters', name: 'Observer' },
  inn: { type: 'Locations', name: 'The Inn' },
  forge: { type: 'Locations', name: 'The Forge' }
};

function view(links: Array<{ from: string; relType: string; to: string }> = []) {
  return {
    workspaceId: 'w', fields: [], calendar: null, clock: null, names: null,
    entity: (id: string) => people[id] ? { id, type: people[id].type, canonicalName: people[id].name, lore: null, data: JSON.stringify(people[id].data ?? {}), status: 'confirmed' } : undefined,
    nameOf: (id: string) => people[id]?.name,
    links: (id: string) => links.flatMap(link => link.from === id ? [{ relType: link.relType, label: null, otherId: link.to, direction: 'from' as const }]
      : link.to === id ? [{ relType: link.relType, label: null, otherId: link.from, direction: 'to' as const }] : []),
    locationChain: () => ''
  } as never;
}

interface FakeEvent { id: string; minute: number; location: string; participants: string[]; description: string }

function reads(input: {
  regard?: Array<{ from: string; to: string; value: number; title: string; description?: string }>;
  events?: FakeEvent[];
  memories?: Array<{ id: string; holder: string; eventId: string; text: string; related?: string[] }>;
  statements?: Array<{ id: string; holder: string; about: string; eventId: string; text: string; attitude?: string; salience?: number }>;
}) {
  const events = input.events ?? [];
  const minuteOf = (eventId: string) => events.find(event => event.id === eventId)?.minute ?? 0;
  const memoryItem = (memory: NonNullable<typeof input.memories>[number]) => ({
    record: {
      kind: 'holding', id: memory.id, holder: memory.holder, eventId: memory.eventId, text: memory.text, attitude: 'knows', accessibility: 'available',
      acquisition: { kind: 'witnessed' }, position: { tick: minuteOf(memory.eventId) },
      claim: { subject: memory.holder, predicate: 'remembers', object: { kind: 'value', value: memory.text }, polarity: 'affirms' },
      provenance: { metadata: { k: 'memory', relatedEntityIds: memory.related ?? [] } }
    }
  });
  const statementItem = (statement: NonNullable<typeof input.statements>[number]) => ({
    record: {
      kind: 'holding', id: statement.id, holder: statement.holder, eventId: statement.eventId, text: statement.text, attitude: statement.attitude ?? 'knows', accessibility: 'available',
      acquisition: { kind: 'witnessed' }, confidence: 1, position: { tick: minuteOf(statement.eventId) },
      claim: { subject: statement.about, predicate: 'note', object: { kind: 'value', value: statement.text }, polarity: 'affirms' },
      provenance: { metadata: { k: 'knowledge', ...(statement.salience !== undefined ? { salience: statement.salience } : {}) } }
    }
  });
  const memoriesInvolving = (holder: string, about: string) => (input.memories ?? [])
    .filter(memory => memory.holder === holder && ((memory.related ?? []).includes(about) || (events.find(event => event.id === memory.eventId)?.participants ?? []).includes(about)))
    .map(memoryItem);
  return {
    dispositions: (holder: string, target?: string) => (input.regard ?? [])
      .filter(item => item.from === holder && (!target || item.to === target))
      .map(item => ({ kind: 'disposition', id: `d-${item.from}-${item.to}`, holder: item.from, target: item.to, dimension: 'overall', value: item.value, provenance: { metadata: { title: item.title, description: item.description ?? '' } } })),
    eventsOf: (id: string, options: { from?: number; to?: number }) => events
      .filter(event => event.participants.includes(id) && (options.from === undefined || event.minute >= options.from) && (options.to === undefined || event.minute <= options.to))
      .sort((left, right) => left.minute - right.minute)
      .map(event => ({ id: event.id, type: 'scene', title: event.description, description: event.description, location: event.location, participants: event.participants, on: { story: event.minute }, position: { tick: event.minute } })),
    isScene: () => true,
    sceneIdsAt: (location: string) => events.filter(event => event.location === location).map(event => event.id),
    participantsOf: (eventId: string) => new Set(events.find(event => event.id === eventId)?.participants ?? []),
    memoriesInvolving,
    heldAbout: (holder: string, about: string) => [
      ...(input.statements ?? []).filter(statement => statement.holder === holder && statement.about === about).map(statementItem),
      ...memoriesInvolving(holder, about)
    ]
  } as never;
}

const base = { locationId: 'inn', playerId: 'player', nowMinute: NOW, isRecent: () => false };

describe('Who is off the stage', () => {
  test('story time reads as an age', () => {
    expect(storyAge(NOW, NOW - 15)).toBe('15 min ago');
    expect(storyAge(NOW, NOW - 180)).toBe('3 h ago');
    expect(storyAge(NOW, NOW - 2 * DAY)).toBe('2 days ago');
    expect(storyAge(NOW, NOW - 90 * DAY)).toBe('3 months ago');
  });

  test('someone the turn names who is not here comes with how each one here stands toward them, by title', () => {
    const items = towardNamed({
      ...base, view: view(), present: ['hakan', 'mara'], involved: new Set(['kepler', 'inn']), exclude: new Set(),
      reads: reads({ regard: [
        { from: 'hakan', to: 'kepler', value: 94, title: 'Son in all but name', description: 'Long story.' },
        { from: 'kepler', to: 'mara', value: 80, title: 'Sister in arms' }
      ] })
    });
    expect(items.map(item => item.text)).toEqual(['Kepler, not here:\nHakan → Kepler (overall 94): Son in all but name\nKepler → Mara (overall 80): Sister in arms']);
  });

  test('who could come in: nearby, who runs the place and who was last seen here, never the dead or someone only ahead of the clock', () => {
    const items = couldComeIn({
      ...base, present: ['hakan'], involved: new Set(), nearby: ['valera'],
      view: view([{ from: 'inn', relType: 'led_by', to: 'barnaby' }, { from: 'ghost', relType: 'connected_to', to: 'inn' }]),
      reads: reads({
        regard: [{ from: 'hakan', to: 'valera', value: 40, title: 'Pragmatic ally' }],
        events: [
          { id: 'e1', minute: NOW - 15, location: 'inn', participants: ['valera', 'hakan'], description: 'Valera took the stairs to guard the prisoners.' },
          { id: 'e2', minute: NOW - 2 * DAY, location: 'inn', participants: ['mara'], description: 'Mara served the night shift.' },
          { id: 'e3', minute: NOW + 60, location: 'forge', participants: ['mara'], description: 'Mara walked to the forge.' }
        ]
      })
    });
    const text = items.map(item => item.text).join('\n\n');
    expect(items.map(item => item.key)).toEqual(['come-in:valera', 'come-in:barnaby', 'come-in:mara']);
    expect(text).toContain('Why: nearby\nLast seen 15 min ago here: Valera took the stairs to guard the prisoners.\nHakan → Valera (overall 40): Pragmatic ally');
    expect(text).toContain('Why: runs this place');
    expect(text).toContain('Why: last seen here\nLast seen 2 days ago here: Mara served the night shift.');
    expect(text).not.toContain('Old Tom');
  });

  test('someone the turn already speaks to is in the conversation, not waiting at the door', () => {
    const items = couldComeIn({ ...base, present: ['hakan'], involved: new Set(['valera']), nearby: ['valera'], view: view(), reads: reads({}) });
    expect(items).toEqual([]);
  });

  test('people meeting again get the last scene they shared before this one and what each remembers of the other', () => {
    const items = reunions({
      ...base, view: view(), present: ['hakan', 'mara', 'player'], involved: new Set(),
      isRecent: eventId => eventId === 'arrival', recentEventIds: new Set(['arrival']),
      reads: reads({
        events: [
          { id: 'arrival', minute: NOW - 5, location: 'inn', participants: ['hakan', 'mara', 'player'], description: 'Hakan walked into the inn.' },
          { id: 'old', minute: NOW - 3 * DAY, location: 'forge', participants: ['hakan', 'mara', 'player'], description: 'They argued over the plan at the forge.' }
        ],
        memories: [
          { id: 'm1', holder: 'mara', eventId: 'old', text: 'Hakan told me to stop and I did not.', related: ['hakan'] },
          { id: 'm2', holder: 'player', eventId: 'old', text: 'I watched them argue.', related: ['hakan'] }
        ]
      })
    });
    const text = items.map(item => item.text);
    expect(text).toContain('Hakan and Mara, last together 3 days ago at The Forge: They argued over the plan at the forge.');
    expect(text).toContain('Remembers: Hakan told me to stop and I did not.');
    expect(items.find(item => item.text.includes('Hakan told me'))).toMatchObject({ section: 'knows', holders: ['mara'], recordId: 'm1' });
    // The player's own recall is the user's to make.
    expect(text.join('\n')).not.toContain('I watched them argue.');
  });

  test('a pair the history keeps together is already living it', () => {
    const recent = ['r1', 'r2', 'r3'];
    const items = reunions({
      ...base, view: view(), present: ['hakan', 'mara'], involved: new Set(),
      isRecent: eventId => recent.includes(eventId), recentEventIds: new Set(recent),
      reads: reads({
        events: [
          ...recent.map((id, index) => ({ id, minute: NOW - 10 - index, location: 'inn', participants: ['hakan', 'mara'], description: 'Talk at the inn.' })),
          { id: 'old', minute: NOW - 3 * DAY, location: 'forge', participants: ['hakan', 'mara'], description: 'At the forge.' }
        ]
      })
    });
    expect(items).toEqual([]);
  });

  test('what the people here hold about each other comes on its own, a couple per pair, the pairs the turn is about first', () => {
    const items = aboutEachOther({
      ...base, view: view(), present: ['hakan', 'mara', 'valera', 'player'], involved: new Set(['valera']),
      isRecent: eventId => eventId === 'now',
      reads: reads({
        events: [
          { id: 'old', minute: NOW - 3 * DAY, location: 'forge', participants: ['hakan', 'mara'], description: 'At the forge.' },
          { id: 'now', minute: NOW - 5, location: 'inn', participants: ['hakan', 'mara'], description: 'Here.' }
        ],
        statements: [
          { id: 's1', holder: 'mara', about: 'hakan', eventId: 'old', text: 'Hakan hides a debt to the Guild.', attitude: 'suspects' },
          { id: 's2', holder: 'mara', about: 'hakan', eventId: 'old', text: 'Hakan forged the gate.', salience: 0.9 },
          { id: 's3', holder: 'mara', about: 'hakan', eventId: 'old', text: 'Hakan likes rye bread.', salience: 0.4 },
          { id: 's4', holder: 'hakan', about: 'mara', eventId: 'now', text: 'Mara is here.' },
          { id: 's5', holder: 'hakan', about: 'valera', eventId: 'old', text: 'Valera fought in the pits.' },
          { id: 's6', holder: 'player', about: 'hakan', eventId: 'old', text: 'The player knows Hakan.' }
        ],
        memories: [{ id: 'm1', holder: 'hakan', eventId: 'old', text: 'Mara stood by me at the forge.', related: ['mara'] }]
      })
    });
    const text = items.map(item => item.text);
    // The pair the turn is about leads; then each pair keeps its two strongest.
    expect(text[0]).toBe('Valera fought in the pits.');
    expect(text).toContain('Hakan forged the gate.');
    expect(text).toContain('Suspects: Hakan hides a debt to the Guild.');
    expect(text).not.toContain('Hakan likes rye bread.');
    // A memory the other is part of counts as held about them.
    expect(text).toContain('Remembers: Mara stood by me at the forge.');
    // What the history still shows, and what the player holds, stay out.
    expect(text).not.toContain('Mara is here.');
    expect(text).not.toContain('The player knows Hakan.');
    expect(items.every(item => item.section === 'knows' && item.recordId)).toBe(true);
  });

  test('someone the turn has acting before the scene lists them brings what they hold about those here', () => {
    const items = actorsAboutPresent({
      ...base, view: view(), present: ['hakan', 'mara', 'player'], involved: new Set(), actors: ['valera', 'mara', 'player'],
      reads: reads({
        events: [{ id: 'old', minute: NOW - 3 * DAY, location: 'forge', participants: ['valera', 'hakan'], description: 'At the forge.' }],
        statements: [
          { id: 's1', holder: 'valera', about: 'hakan', eventId: 'old', text: 'Hakan owes the pits a fight.' },
          { id: 's2', holder: 'mara', about: 'hakan', eventId: 'old', text: 'Mara is already here.' }
        ]
      })
    });
    // Only the one not in the scene; what those present hold already comes as About each other.
    expect(items.map(item => [item.text, item.holders])).toEqual([['Hakan owes the pits a fight.', ['valera']]]);
  });
});
