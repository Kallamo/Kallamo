import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openFullSchemaDatabase, type FullSchemaDatabase } from './full-schema-harness';

const require = createRequire(import.meta.url);
const { createNewStoryService, resetPackage, storyCreatedEntities } = require('../../src/main/features/workspace/new-story.js');
const { nextStoryTitle } = require('../../src/main/features/workspace/story-title.js');
const { markPending, pendingIds, purgeUnfinished } = require('../../src/main/features/workspace/pending-workspaces.js');

let harness: FullSchemaDatabase;
let db: any;

beforeEach(() => { harness = openFullSchemaDatabase(); db = harness.db; });
afterEach(() => harness.close());

function chat(id: string, title: string, extra: Record<string, unknown> = {}) {
  db.prepare(`INSERT INTO chats (id, title, description, memoryBlocks, knowledgeFiles, activeProfiles, activeWorkflows) VALUES (?, ?, '', ?, '[]', '[]', '[]')`)
    .run(id, title, JSON.stringify(extra.memoryBlocks || []));
}

function entity(id: string, fields: Record<string, unknown> = {}) {
  const row = { workspaceId: 'ws', type: 'Characters', canonicalName: id, aliases: '[]', lore: '', data: {}, ...fields };
  db.prepare(`INSERT INTO entities (id, workspaceId, type, canonicalName, aliases, lore, data, status, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, 'confirmed', 1)`)
    .run(id, row.workspaceId, row.type, row.canonicalName, row.aliases, row.lore, JSON.stringify(row.data));
}

function chunk(id: string, ownerId: string, ownerType: string, extra: Record<string, unknown> = {}) {
  db.prepare(`INSERT INTO knowledge_chunks (id, ownerId, ownerType, source, text, vector, createdAt, memoryBlockId) VALUES (?, ?, ?, ?, ?, '[]', 1, ?)`)
    .run(id, ownerId, ownerType, extra.source || 'Notes', extra.text || id, extra.memoryBlockId || null);
}

function origin(entityId: string, kind: string, target: string, previous: unknown, next: unknown, evidence: string[]) {
  const wrap = (value: unknown) => (value === undefined ? null : JSON.stringify(kind === 'link' ? value : { value }));
  db.prepare(`
    INSERT INTO entity_update_origins (workspace_id, change_id, entity_id, kind, target, previous_json, next_json, applied_by, evidence_json, created_at)
    VALUES ('ws', ?, ?, ?, ?, ?, ?, 'automatic', ?, ?)
  `).run(`${entityId}-${target}`, entityId, kind, target, wrap(previous), wrap(next), JSON.stringify(evidence), Date.now());
}

const packageOf = (entities: any[], links: any[] = []) => ({ kallamoWorldbuild: 1, entities, links, placement: { version: 1, equipment: [], placed: [] } });

describe('new story titles', () => {
  test('count up from the highest copy, also when the source is a copy', () => {
    expect(nextStoryTitle('The Lighthouse', ['The Lighthouse'])).toBe('The Lighthouse 2');
    expect(nextStoryTitle('The Lighthouse 2', ['The Lighthouse', 'The Lighthouse 2', 'The Lighthouse 5'])).toBe('The Lighthouse 6');
    expect(nextStoryTitle('Evenwell', [])).toBe('Evenwell');
  });
});

describe('the world before the story', () => {
  beforeEach(() => {
    chat('ws', 'The Lighthouse');
    chunk('from-chat', 'ws', 'chat_memory', { source: 'Chat Archive' });
    chunk('from-chapter', 'doc-1', 'document');
  });

  test('takes back what Update entities read from the chat, unless it was edited since', () => {
    origin('mara', 'field', 'mood', 'calm', 'grieving', ['from-chat']);
    origin('mara', 'field', 'job', 'keeper', 'smuggler', ['from-chat']);
    origin('mara', 'lore', 'lore', 'Keeps the light.', 'Keeps the light, and a secret.', ['from-chat']);
    const payload = packageOf([{ ref: 'mara', canonicalName: 'Mara', lore: 'Keeps the light, and a secret.', data: { mood: 'grieving', job: 'retired' } }]);
    resetPackage(db, 'ws', payload, null);
    expect(payload.entities[0].data).toEqual({ mood: 'calm', job: 'retired' });
    expect(payload.entities[0].lore).toBe('Keeps the light.');
  });

  test('keeps what Update entities read from documents', () => {
    origin('mara', 'field', 'age', undefined, '34', ['from-chapter']);
    const payload = packageOf([{ ref: 'mara', canonicalName: 'Mara', data: { age: '34' } }]);
    resetPackage(db, 'ws', payload, null);
    expect(payload.entities[0].data).toEqual({ age: '34' });
  });

  test('a field the story added is removed, and a link it added goes', () => {
    entity('mara'); entity('aldous');
    origin('mara', 'field', 'customFields.debt', undefined, 'Owes the guild', ['from-chat']);
    origin('mara', 'link', 'link-1', undefined, { fromId: 'mara', relType: 'related_to', toId: 'aldous', label: 'rival' }, ['from-chat']);
    const payload = packageOf(
      [{ ref: 'mara', canonicalName: 'Mara', data: { customFields: { debt: 'Owes the guild' } } }, { ref: 'aldous', canonicalName: 'Aldous', data: {} }],
      [{ fromRef: 'mara', toRef: 'aldous', relType: 'related_to', label: 'rival' }]
    );
    resetPackage(db, 'ws', payload, null);
    expect(payload.entities[0].data.customFields).toEqual({});
    expect(payload.links).toEqual([]);
  });

  test('a rename from the story is undone, and entities it brought in are found', () => {
    db.prepare(`
      INSERT INTO roleplay_entity_changes (workspace_id, change_id, entity_id, created_entity, payload_json, status, provenance_id, created_at)
      VALUES ('ws', 'c1', 'stranger', 0, ?, 'applied', 'turn-1', 1), ('ws', 'c2', 'smith', 1, '{}', 'applied', 'turn-1', 1)
    `).run(JSON.stringify({ identityUpdate: { canonicalName: 'Silas', aliases: ['the smith'], previousCanonicalName: 'The stranger', previousAliases: [] } }));
    const payload = packageOf([{ ref: 'stranger', canonicalName: 'Silas', aliases: ['the smith', 'old man'], data: {} }]);
    resetPackage(db, 'ws', payload, null);
    expect(payload.entities[0]).toMatchObject({ canonicalName: 'The stranger', aliases: ['old man'] });
    expect([...storyCreatedEntities(db, 'ws')]).toEqual(['smith']);
  });

  test('holdings, places and bonds come back as the first reply found them', () => {
    const start = {
      links: [{ fromId: 'lamp', relType: 'owned_by', toId: 'mara', label: null, metadata_json: '{}' }],
      equipment: [{ entity_id: 'mara', item_id: 'lamp' }],
      locationInventory: [{ location_id: 'tower', item_id: 'logbook', quantity: 1 }],
    };
    const payload = packageOf(
      ['mara', 'lamp', 'tower', 'logbook', 'aldous'].map(ref => ({ ref, canonicalName: ref, data: {} })),
      [{ fromRef: 'lamp', toRef: 'aldous', relType: 'owned_by' }, { fromRef: 'mara', toRef: 'tower', relType: 'member_of' }]
    );
    resetPackage(db, 'ws', payload, start);
    expect(payload.links).toEqual([
      { fromRef: 'mara', toRef: 'tower', relType: 'member_of' },
      { fromRef: 'lamp', toRef: 'mara', relType: 'owned_by', label: null, metadata: {} },
    ]);
    expect(payload.placement).toEqual({ version: 1, equipment: [{ holderRef: 'mara', itemRef: 'lamp' }], placed: [{ locationRef: 'tower', itemRef: 'logbook', quantity: 1 }] });
  });
});

describe('starting a new story', () => {
  function service(overrides: Record<string, unknown> = {}) {
    const purged: string[] = [];
    const svc = createNewStoryService({
      db,
      buildPackage: (workspaceId: string, { exclude }: { exclude: Set<string> }) => ({
        data: packageOf(db.prepare('SELECT id, canonicalName, data FROM entities WHERE workspaceId = ?').all(workspaceId)
          .filter((row: any) => !exclude.has(row.id))
          .map((row: any) => ({ ref: row.id, canonicalName: row.canonicalName, data: JSON.parse(row.data) }))),
        writeZip: () => {},
      }),
      importPayload: (workspaceId: string, _file: string, payload: any) => {
        const idMap = new Map();
        for (const item of payload.entities) {
          const id = `${workspaceId}-${item.ref}`;
          entity(id, { workspaceId, canonicalName: item.canonicalName, data: item.data });
          idMap.set(item.ref, id);
        }
        return { success: true, idMap };
      },
      roleplay: () => ({ getSettings: () => ({ scenarioName: 'Night watch', scenarioSummary: '', defaultUpdatePolicy: 'review', locationEntityId: null }), saveSettings: () => {} }),
      setExperienceMode: () => {},
      purgeWorkspace: (id: string) => { purged.push(id); db.prepare('DELETE FROM chats WHERE id = ?').run(id); },
      evenwell: { isStory: (id: string) => id === 'guided', seed: () => 'evenwell-copy' },
      tempPath: (name: string) => name,
      removeFile: () => {},
      copyBackground: () => {},
      ...overrides,
    });
    return { svc, purged };
  }

  test('copies documents, file passages and hand-written memories, not the chat or its summaries', async () => {
    chat('ws', 'The Lighthouse', { memoryBlocks: [{ id: 'notes', type: 'custom' }, { id: 'sum-1', type: 'summarized' }] });
    entity('mara', { data: { loreDocumentIds: ['doc-1'] } });
    db.prepare("INSERT INTO messages (id, chatId, role, content, createdAt) VALUES ('m1', 'ws', 'user', 'Hello', 1)").run();
    db.prepare("INSERT INTO folders (id, workspaceId, name) VALUES ('f1', 'ws', 'Chapters')").run();
    db.prepare("INSERT INTO documents (id, workspaceId, folderId, title, content) VALUES ('doc-1', 'ws', 'f1', 'Chapter one', 'text')").run();
    chunk('d1', 'doc-1', 'document');
    chunk('kb1', 'ws', 'chat_kb');
    chunk('manual_1', 'ws', 'chat_memory', { memoryBlockId: 'notes' });
    chunk('arch1', 'ws', 'chat_memory', { source: 'Chat Archive', memoryBlockId: 'sum-1' });
    db.prepare("INSERT INTO chunk_tags (chunkId, tag, entity) VALUES ('d1', 'Characters', 'mara')").run();

    const { svc } = service();
    expect(svc.preview('ws')).toEqual({ guided: false, title: 'The Lighthouse 2' });
    const steps: string[] = [];
    const { id } = await svc.start('ws', { onProgress: (step: string) => steps.push(step) });
    expect(steps).toEqual(['world', 'import', 'writing', 'done']);
    expect(pendingIds(db).size).toBe(0);

    expect(db.prepare('SELECT title, memoryBlocks FROM chats WHERE id = ?').get(id)).toEqual({ title: 'The Lighthouse 2', memoryBlocks: JSON.stringify([{ id: 'notes', type: 'custom' }]) });
    expect(db.prepare('SELECT COUNT(*) AS count FROM messages WHERE chatId = ?').get(id).count).toBe(0);
    const copy = db.prepare('SELECT id, folderId, title FROM documents WHERE workspaceId = ?').get(id);
    expect(copy.title).toBe('Chapter one');
    expect(db.prepare('SELECT name FROM folders WHERE id = ?').get(copy.folderId).name).toBe('Chapters');
    const passages = db.prepare(`
      SELECT ownerType, id FROM knowledge_chunks WHERE ownerId IN (?, ?) ORDER BY ownerType
    `).all(id, copy.id).map((row: any) => [row.ownerType, row.id.replace(/[0-9a-f-]{36}$/, '')]);
    expect(passages).toEqual([['chat_kb', 'kc_'], ['chat_memory', 'manual_'], ['document', 'kc_']]);
    const mara = db.prepare('SELECT data, loreDocumentId FROM entities WHERE id = ?').get(`${id}-mara`);
    expect(JSON.parse(mara.data).loreDocumentIds).toEqual([copy.id]);
    expect(mara.loreDocumentId).toBe(copy.id);
    const docChunk = db.prepare("SELECT id FROM knowledge_chunks WHERE ownerType = 'document' AND ownerId = ?").get(copy.id).id;
    expect(db.prepare('SELECT entity FROM chunk_tags WHERE chunkId = ?').get(docChunk).entity).toBe(`${id}-mara`);
  });

  test('a guided story is seeded again instead of copied', async () => {
    chat('guided', 'Evenwell');
    const { svc } = service();
    expect(svc.preview('guided').guided).toBe(true);
    expect(await svc.start('guided', {})).toEqual({ id: 'evenwell-copy', guided: true });
  });

  test('a copy that fails is removed, and the workspace it came from stays', async () => {
    chat('ws', 'The Lighthouse');
    const { svc, purged } = service({ importPayload: () => ({ success: false, error: 'broken package' }) });
    await expect(svc.start('ws', {})).rejects.toThrow('broken package');
    expect(purged).toHaveLength(1);
    expect(purged).not.toContain('ws');
    expect(db.prepare('SELECT id FROM chats').all()).toEqual([{ id: 'ws' }]);
    expect(pendingIds(db).size).toBe(0);
  });

  test('a copy the app closed on stays listed until the next start removes it', async () => {
    chat('ws', 'The Lighthouse');
    let pending: string[] = [];
    const { svc: halted } = service({
      importPayload: () => { pending = [...pendingIds(db)]; throw new Error('closed'); },
      purgeWorkspace: () => { throw new Error('the app is gone'); },
    });
    await expect(halted.start('ws', {})).rejects.toThrow('closed');
    expect(pending).toHaveLength(1);
    expect([...pendingIds(db)]).toEqual(pending);

    const removed = purgeUnfinished(db, { purgeWorkspace: (id: string) => db.prepare('DELETE FROM chats WHERE id = ?').run(id) });
    expect(removed).toEqual(pending);
    expect(db.prepare('SELECT id FROM chats').all()).toEqual([{ id: 'ws' }]);
    expect(pendingIds(db).size).toBe(0);
  });
});

describe('unfinished workspaces', () => {
  test('a workspace never lists itself as its own copy', () => {
    expect(() => markPending(db, 'ws', 'ws')).toThrow();
  });

  test('a listed workspace another entry was made from is never removed', () => {
    markPending(db, 'copy-1', 'ws');
    markPending(db, 'copy-2', 'copy-1');
    const removed: string[] = [];
    purgeUnfinished(db, { purgeWorkspace: (id: string) => removed.push(id) });
    expect(removed).toEqual(['copy-2']);
    expect(pendingIds(db).size).toBe(0);
  });
});
