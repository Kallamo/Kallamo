import zlib from 'node:zlib';
import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { parseSource, splitPassages, buildCandidates, passageSource } = require('../../src/main/features/worldbuild/source-import.js');

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buffer: Buffer) => {
  let c = 0xffffffff;
  for (const byte of buffer) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type: string, data: Buffer) => {
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
};
const pngWithText = (entries: Record<string, string>) => {
  const header = Buffer.alloc(13); header.writeUInt32BE(1, 0); header.writeUInt32BE(1, 4); header[8] = 8; header[9] = 2;
  const texts = Object.entries(entries).map(([key, value]) => chunk('tEXt', Buffer.concat([Buffer.from(key, 'latin1'), Buffer.from([0]), Buffer.from(value, 'latin1')])));
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', header), ...texts, chunk('IDAT', zlib.deflateSync(Buffer.from([0, 0, 0, 0]))), chunk('IEND', Buffer.alloc(0)),
  ]);
};
const base64 = (value: unknown) => Buffer.from(JSON.stringify(value), 'utf8').toString('base64');

const card = {
  spec: 'chara_card_v2',
  data: {
    name: 'The Innkeeper',
    description: '{{char}} runs the inn at the crossroads and greets {{user}} by name.',
    personality: 'Warm, nosy.',
    scenario: '',
    first_mes: 'Welcome back, {{user}}.',
    mes_example: '<START>{{user}}: Hi',
    system_prompt: 'Never break character.',
    character_book: { entries: [{ keys: ['the crossroads', 'Crossroads Inn'], content: 'An inn where four roads meet.', comment: 'The Crossroads Inn', enabled: true }] },
  },
};

describe('parseSource', () => {
  test('reads a V2 card from a PNG, with placeholders resolved and only its description and personality as evidence', () => {
    const parsed = parseSource({ fileName: 'innkeeper.png', buffer: pngWithText({ chara: base64(card) }), filePath: '/cards/innkeeper.png' });
    expect(parsed.kind).toBe('card');
    expect(parsed.name).toBe('The Innkeeper');
    const [description, personality, entry] = parsed.units;
    expect(description.subject).toMatchObject({ name: 'The Innkeeper', type: 'Characters', portraitPath: '/cards/innkeeper.png' });
    expect(description).toMatchObject({ title: 'The Innkeeper', label: 'Description', text: 'The Innkeeper runs the inn at the crossroads and greets the user by name.' });
    expect(personality).toMatchObject({ label: 'Personality', text: 'Warm, nosy.' });
    const all = parsed.units.map((unit: any) => unit.text).join('\n');
    for (const left of ['Welcome back', 'Never break character', 'Hi']) expect(all).not.toContain(left);
    expect(entry.subject).toMatchObject({ name: 'The Crossroads Inn', aliases: ['the crossroads', 'Crossroads Inn'], type: null });
    expect(passageSource(entry)).toBe('The Crossroads Inn · entry');
    expect(parsed.entries).toBe(1);
  });

  test('splits a description by its tags, headings and title lines, and takes names from its name lines', () => {
    const description = [
      'A quiet harbor town.',
      '<Bio>', 'Full Name: Tamsin Hale (the elder)', 'Nicknames: Tam, Old Tam', 'Age: 61', '</Bio>',
      '## Appearance', 'Grey braid, ink-stained fingers.',
      '[Likes]', 'Tea, ledgers.',
      'Fears:', 'Deep water.',
    ].join('\n');
    const parsed = parseSource({ fileName: 'tam.json', text: JSON.stringify({ spec: 'chara_card_v2', data: { name: 'Tam', description } }) });
    expect(parsed.units.map((unit: any) => [unit.label, unit.text])).toEqual([
      ['Description', 'A quiet harbor town.'],
      ['Bio', 'Full Name: Tamsin Hale (the elder)\nNicknames: Tam, Old Tam\nAge: 61'],
      ['Appearance', 'Grey braid, ink-stained fingers.'],
      ['Likes', 'Tea, ledgers.'],
      ['Fears', 'Deep water.'],
    ]);
    expect(parsed.units[0].subject.aliases).toEqual(['Tamsin Hale', 'Old Tam']);
    expect(passageSource(parsed.units[1])).toBe('Tam · Bio');
  });

  test('prefers the V3 chunk and falls back to the V2 one when it is broken', () => {
    const v3 = { spec: 'chara_card_v3', data: { ...card.data, name: 'Newer' } };
    expect(parseSource({ fileName: 'a.png', buffer: pngWithText({ chara: base64(card), ccv3: base64(v3) }) }).name).toBe('Newer');
    expect(parseSource({ fileName: 'a.png', buffer: pngWithText({ chara: base64(card), ccv3: '@@@' }) }).name).toBe('The Innkeeper');
  });

  test('refuses an image without a card', () => {
    expect(() => parseSource({ fileName: 'photo.png', buffer: pngWithText({ Comment: 'hello' }) })).toThrow(/no character card/);
  });

  test('reads a SillyTavern lorebook, skipping disabled and empty entries and regex keys', () => {
    const lorebook = {
      entries: {
        0: { uid: 0, key: ['harbor', 'the docks'], keysecondary: ['night'], comment: 'Harbor District', content: 'The Harbor District, also called the docks, is where ships unload at dawn.' },
        1: { uid: 1, key: ['/drag(on|ons)/i', 'wyrm'], comment: '', content: 'Old wyrms sleep under the hills.' },
        2: { uid: 2, key: ['ghost'], comment: 'Ghost', content: 'Unused', disable: true },
        3: { uid: 3, key: ['empty'], comment: 'Empty', content: '   ' },
      },
    };
    const parsed = parseSource({ fileName: 'world.json', buffer: Buffer.from(JSON.stringify(lorebook)) });
    expect(parsed.kind).toBe('lorebook');
    expect(parsed.entries).toBe(2);
    expect(parsed.units.map((unit: any) => unit.subject)).toEqual([
      { name: 'Harbor District', aliases: ['harbor', 'the docks'], type: null },
      { name: 'wyrm', aliases: [], type: null },
    ]);
  });

  test('only keys the entry is called by become aliases, and an untitled entry takes the name its text opens with', () => {
    const lorebook = {
      entries: {
        0: { uid: 0, key: ['Eula', 'Spindrift Knight', 'Lawrence Clan'], comment: 'Eula Lawrence', content: 'Eula is the captain of the reconnaissance company.' },
        1: { uid: 1, key: ['Receptionist', 'Mira', "Adventurers' Guild"], comment: '', content: "Mira is the receptionist for the Adventurers' Guild." },
        2: { uid: 2, key: ['The Captain', 'Thrain', 'Il Capitano'], comment: '', content: 'Il Capitano, whose true name is Thrain, was the First of the Harbingers.' },
        3: { uid: 3, key: ['A', 'Alice', 'Hexenzirkel'], comment: '', content: 'Alice, also known by her codename "A," is a founding Elder of the Hexenzirkel.' },
      },
    };
    const parsed = parseSource({ fileName: 'world_info.json', buffer: Buffer.from(JSON.stringify(lorebook)) });
    expect(parsed.units.map((unit: any) => [unit.subject.name, unit.subject.aliases])).toEqual([
      ['Eula Lawrence', ['Eula']],
      ['Mira', []],
      ['Il Capitano', ['Thrain']],
      ['Alice', ['A']],
    ]);
  });

  test('a lorebook with its own name and description is still a lorebook, not a card', () => {
    const lorebook = {
      name: 'Harbor Lorebook',
      description: 'Everything about the harbor',
      entries: { 0: { uid: 0, key: ['harbor'], comment: 'Harbor District', content: 'Ships unload here at dawn.' } },
    };
    const parsed = parseSource({ fileName: 'world_info.json', buffer: Buffer.from(JSON.stringify(lorebook)) });
    expect(parsed.kind).toBe('lorebook');
    expect(parsed.units.map((unit: any) => unit.subject.name)).toEqual(['Harbor District']);
  });

  test('reads a card saved as JSON and plain text as passages without a subject', () => {
    expect(parseSource({ fileName: 'innkeeper.json', text: JSON.stringify(card) }).kind).toBe('card');
    const text = parseSource({ fileName: 'Session 3 notes.md', text: 'First paragraph.\n\nSecond paragraph.' });
    expect(text.kind).toBe('text');
    expect(text.units).toHaveLength(1);
    expect(text.units[0].subject).toBeNull();
    expect(passageSource(text.units[0])).toBe('Session 3 notes');
    expect(() => parseSource({ fileName: 'other.json', text: '{"hello": 1}' })).toThrow(/neither/);
  });
});

describe('splitPassages', () => {
  test('keeps paragraphs together up to the limit and cuts a long one at a sentence', () => {
    const passages = splitPassages(`${'A short one. '.repeat(3)}\n\n${'Long sentence here. '.repeat(20)}`, 120);
    expect(passages.every((passage: string) => passage.length <= 120)).toBe(true);
    expect(passages[0].startsWith('A short one.')).toBe(true);
  });
});

describe('buildCandidates', () => {
  const passages = [
    { id: 'p1', fileName: 'innkeeper.png', label: 'card', text: 'The Innkeeper runs the inn.', subject: { name: 'The Innkeeper', aliases: [], type: 'Characters', portraitPath: '/p.png' } },
    { id: 'p2', fileName: 'world.json', label: 'entry', text: 'The innkeeper, called Old Tam, knows everyone.', subject: { name: 'Old Tam', aliases: ['the innkeeper'], type: null } },
    { id: 'p3', fileName: 'notes.md', label: '', text: 'Old Tam met a stranger at the Harbor District.', subject: null },
  ];
  const mentions = new Map([
    ['p3', [{ name: 'Old Tam', type: 'Characters', proposalKind: 'known' }, { name: 'Harbor District', type: 'Locations', proposalKind: 'named' }]],
    ['p2', [{ name: 'tavern', type: 'Locations', proposalKind: 'world_specific_type' }]],
  ]);

  test('joins subjects that share a name or alias and keeps where each came from', () => {
    const candidates = buildCandidates({ passages, mentions });
    const tam = candidates.find((candidate: any) => candidate.name === 'The Innkeeper');
    expect(tam).toMatchObject({ type: 'Characters', portraitPath: '/p.png', keep: true });
    expect(tam.aliases).toEqual(expect.arrayContaining(['Old Tam']));
    expect(tam.passageIds).toEqual(['p1', 'p2', 'p3']);
    expect(tam.mergedFrom.map((entry: any) => entry.fileName)).toEqual(['innkeeper.png', 'world.json']);
  });

  test('keeps every entry, and fills only subjects and names met in more than one passage', () => {
    const candidates = buildCandidates({ passages, mentions });
    expect(candidates.every((candidate: any) => candidate.keep)).toBe(true);
    expect(candidates.find((candidate: any) => candidate.name === 'The Innkeeper')).toMatchObject({ fill: true });
    expect(candidates.find((candidate: any) => candidate.name === 'Harbor District')).toMatchObject({ type: 'Locations', match: null, fill: false });
  });

  test('joins names that differ only by a leading article', () => {
    const candidates = buildCandidates({
      passages: [{ id: 'p1', fileName: 'notes.md', label: '', text: 'The Traveler met Traveler.', subject: null }],
      mentions: new Map([['p1', [{ name: 'the Traveler', type: 'Characters', proposalKind: 'named' }, { name: 'Traveler', type: 'Characters', proposalKind: 'named' }]]]),
      existing: [{ id: 'e1', type: 'Characters', canonicalName: 'Traveler', aliases: [], status: 'confirmed' }],
    });
    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({ name: 'the Traveler', aliases: ['Traveler'], match: { id: 'e1' } });
  });

  test('creates a reusable kind of item as an item type and a named one as a unique item', () => {
    const items = new Map([
      ['p3', [{ name: 'healing salve', type: 'Items', proposalKind: 'world_specific_type' }, { name: 'The Brass Key', type: 'Items', proposalKind: 'named' }]],
    ]);
    const candidates = buildCandidates({ passages, mentions: items });
    expect(candidates.find((candidate: any) => candidate.name === 'healing salve').itemNature).toBe('type');
    expect(candidates.find((candidate: any) => candidate.name === 'The Brass Key').itemNature).toBe('unique');
    expect(candidates.find((candidate: any) => candidate.name === 'The Innkeeper').itemNature).toBeNull();
  });

  test('points an entry at the entity it matches, by name or alias, of a fitting type', () => {
    const existing = [
      { id: 'e1', type: 'Locations', canonicalName: 'Harbor District', aliases: [], status: 'confirmed' },
      { id: 'e2', type: 'Characters', canonicalName: 'Tam', aliases: ['the innkeeper'], status: 'confirmed' },
      { id: 'e3', type: 'Characters', canonicalName: 'Old Tam', aliases: [], status: 'proposed' },
    ];
    const candidates = buildCandidates({ passages, mentions, existing });
    expect(candidates.find((candidate: any) => candidate.name === 'Harbor District').match).toMatchObject({ id: 'e1' });
    expect(candidates.find((candidate: any) => candidate.name === 'The Innkeeper').match).toMatchObject({ id: 'e2', name: 'Tam' });
  });
});
