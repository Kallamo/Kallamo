import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openEntityStore, type EntityStoreHarness } from './entity-store-harness';

const require = createRequire(import.meta.url);
const texts = require('../../src/main/features/worldbuild/in-world-texts.js');
const { releaseEntityReferences } = require('../../src/main/features/worldbuild/entity-references.js');

const WRITING_TABLES = `
  CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, workspaceId TEXT NOT NULL, name TEXT, parentId TEXT, position INTEGER, createdAt INTEGER, last_modified INTEGER);
  CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, workspaceId TEXT NOT NULL, folderId TEXT, title TEXT NOT NULL, content TEXT, position INTEGER DEFAULT 0);
`;

let harness: EntityStoreHarness;
let world: { journal: string; letter: string; harrow: string; jasper: string; inn: string };
beforeEach(() => {
  harness = openEntityStore();
  harness.db.exec(WRITING_TABLES);
  const { store } = harness;
  const make = (type: string, name: string, aliases: string[] = []) => store.createEntity({ workspaceId: 'ws', type, canonicalName: name, aliases }).id;
  world = {
    journal: make('Items', "Harrow's Journal", ['the journal']),
    letter: make('Items', 'Unsent Letter'),
    harrow: make('Characters', 'Harrow Venn'),
    jasper: make('Characters', 'Jasper'),
    inn: make('Locations', 'The Last Lantern'),
  };
});
afterEach(() => harness.close());

const paragraphs = (...lines: string[]) => JSON.stringify({ type: 'doc', content: lines.map(text => ({ type: 'paragraph', content: [{ type: 'text', text }] })) });
let documentCount = 0;
function addDocument(title: string, ...lines: string[]) {
  const id = `doc-${++documentCount}`;
  harness.db.prepare('INSERT INTO documents (id, workspaceId, title, content) VALUES (?, ?, ?, ?)').run(id, 'ws', title, paragraphs(...lines));
  return id;
}

// A scene the reading rules can ask about; only what reach depends on is modelled.
function scene({ objects = [] as string[], carried = {} as Record<string, string[]>, player = null as string | null } = {}) {
  return {
    getScene: () => ({ locationId: world.inn, objectIds: objects, participantIds: Object.keys(carried), possibleObserverIds: [] }),
    getSettings: () => ({ playerEntityId: player }),
    listInventory: (_ws: string, holder: string) => (carried[holder] || []).map(itemId => ({ itemId })),
  };
}

describe('in-world texts', () => {
  test('keep their pages in reading order and can be moved', () => {
    const first = addDocument('First page', 'One.');
    const second = addDocument('Second page', 'Two.');
    texts.setInWorldText(harness.db, { documentId: first, itemId: world.journal, authorId: world.harrow });
    texts.setInWorldText(harness.db, { documentId: second, itemId: world.journal });
    expect(texts.listItemTexts(harness.db, 'ws', world.journal).map((page: any) => page.title)).toEqual(['First page', 'Second page']);
    const moved = texts.moveItemText(harness.db, second, -1);
    expect(moved.map((page: any) => page.title)).toEqual(['Second page', 'First page']);
  });

  test('only an item can hold a text, and only from the same world', () => {
    const page = addDocument('Page', 'Text.');
    expect(() => texts.setInWorldText(harness.db, { documentId: page, itemId: world.harrow })).toThrow('Choose an item from this world.');
    const elsewhere = harness.store.createEntity({ workspaceId: 'other', type: 'Items', canonicalName: 'Far Book' }).id;
    expect(() => texts.setInWorldText(harness.db, { documentId: page, itemId: elsewhere })).toThrow('Choose an item from this world.');
  });

  test('read as what the author wrote, never as truth, with the pages that did not fit named', () => {
    const first = addDocument('3 Seedtide 48 YC', 'Five of us at the long table.');
    const second = addDocument('19 Leaffall 59 YC', 'They will come. '.repeat(400));
    texts.setInWorldText(harness.db, { documentId: first, itemId: world.journal, authorId: world.harrow });
    texts.setInWorldText(harness.db, { documentId: second, itemId: world.journal, authorId: world.harrow });
    const reading = texts.readItemText(harness.db, 'ws', world.journal, { maxTokens: 200 });
    expect(reading.text).toContain("[Text in the world: Harrow's Journal, written by Harrow Venn.");
    expect(reading.text).toContain('not established truth');
    expect(reading.text).toContain('## 3 Seedtide 48 YC\nFive of us at the long table.');
    expect(reading.text).toContain('[Further pages not shown here: 19 Leaffall 59 YC.]');
  });

  test('come into play only when named and, in a roleplay, within reach of the scene', () => {
    const page = addDocument('Page', 'The forest goes quiet.');
    texts.setInWorldText(harness.db, { documentId: page, itemId: world.journal, authorId: world.harrow });
    const read = (mentionText: string, roleplay: any) => texts.textsInPlay(harness.db, { workspaceId: 'ws', roleplay, mentionText });

    expect(read('I open the journal and read.', null)).toHaveLength(1);
    expect(read('I order another ale.', null)).toHaveLength(0);
    expect(read('I open the journal and read.', scene())).toHaveLength(0);
    expect(read('I open the journal and read.', scene({ carried: { [world.jasper]: [world.journal] } }))).toHaveLength(1);
    expect(read("I pick up Harrow's Journal from the table.", scene({ objects: [world.journal] }))).toHaveLength(1);
  });

  test('stay out of an entity\'s background chapters', () => {
    const background = addDocument('Background', 'Lore.');
    const page = addDocument('Page', 'Diary.');
    harness.store.updateEntity(world.harrow, { data: { loreDocumentIds: [background, page] } });
    texts.setInWorldText(harness.db, { documentId: page, itemId: world.journal });
    expect(harness.store.linkedLoreDocIds(harness.store.getEntity(world.harrow))).toEqual([background]);
  });

  test('lose their item when it is deleted but stay inside the story', () => {
    const page = addDocument('Page', 'Text.');
    texts.setInWorldText(harness.db, { documentId: page, itemId: world.letter, authorId: world.harrow });
    releaseEntityReferences(harness.db, { workspaceId: 'ws', entityId: world.letter });
    releaseEntityReferences(harness.db, { workspaceId: 'ws', entityId: world.harrow });
    expect(texts.getInWorldText(harness.db, page)).toMatchObject({ itemId: null, authorId: null });
    expect(texts.inWorldDocumentIds(harness.db, 'ws').has(page)).toBe(true);
  });

  test('travel in a package with their item and author', () => {
    const page = addDocument('Last entry', 'If it will not show itself.');
    texts.setInWorldText(harness.db, { documentId: page, itemId: world.journal, authorId: world.harrow });
    const exported = texts.exportItemTexts(harness.db, 'ws', [world.journal, world.harrow]);
    expect(exported).toEqual([expect.objectContaining({ itemRef: world.journal, authorRef: world.harrow, title: 'Last entry' })]);

    const copy = harness.store.createEntity({ workspaceId: 'ws2', type: 'Items', canonicalName: "Harrow's Journal" }).id;
    const author = harness.store.createEntity({ workspaceId: 'ws2', type: 'Characters', canonicalName: 'Harrow Venn' }).id;
    const folders: any[] = [];
    const result = texts.importItemTexts(harness.db, 'ws2', exported, new Map([[world.journal, copy], [world.harrow, author]]), {
      createFolder: ({ workspaceId, name, parentId = null }: any) => {
        const folder = { id: `folder-${folders.length}`, workspaceId, name };
        harness.db.prepare('INSERT INTO folders (id, workspaceId, name, parentId) VALUES (?, ?, ?, ?)').run(folder.id, workspaceId, name, parentId);
        folders.push(folder);
        return folder;
      },
      createDocument: ({ workspaceId, folderId, title, content }: any) => {
        const id = `imported-${title}`;
        harness.db.prepare('INSERT INTO documents (id, workspaceId, folderId, title, content) VALUES (?, ?, ?, ?, ?)').run(id, workspaceId, folderId, title, content);
        return { id };
      },
    });
    expect(result).toEqual({ textsAdded: 1 });
    expect(folders.map(folder => folder.name)).toEqual([texts.TEXTS_FOLDER, "Harrow's Journal"]);
    expect(texts.readItemText(harness.db, 'ws2', copy).text).toContain('If it will not show itself.');
  });
});
