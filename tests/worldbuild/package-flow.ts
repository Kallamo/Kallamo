import { createRequire } from 'node:module';
import { EventOccurrenceService } from '../../src/main/features/worldbuild/event-occurrences';
import * as calendarService from '../../src/main/features/worldbuild/calendar-service.js';

const require = createRequire(import.meta.url);
const { exportAuthoredKnowledge, importAuthoredKnowledge, exportAuthoredFacts, importAuthoredFacts } = require('../../src/main/features/worldbuild/knowledge-package.js');
const parts = require('../../src/main/features/worldbuild/package-parts.js');
const inWorldTexts = require('../../src/main/features/worldbuild/in-world-texts.js');
const identity = require('../../src/main/features/worldbuild/package-identity.js');

// The export and import handlers' steps over the Worldbuild store, without images and rules.
export function createPackageFlow({ db, store, worldbuild }: { db: any; store: any; worldbuild: any }) {
  let next = 0;
  db.exec(`
    CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, workspaceId TEXT NOT NULL, name TEXT, parentId TEXT, position INTEGER, createdAt INTEGER, last_modified INTEGER);
    CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, workspaceId TEXT NOT NULL, folderId TEXT, title TEXT NOT NULL, content TEXT);
    CREATE TABLE IF NOT EXISTS in_world_texts (
      document_id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL, item_id TEXT, author_id TEXT, ordinal INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL
    );
  `);

  const writing = {
    createFolder: ({ workspaceId, name, parentId = null }: any) => {
      const id = `folder-${++next}`;
      db.prepare('INSERT INTO folders (id, workspaceId, name, parentId, position, createdAt) VALUES (?, ?, ?, ?, 0, 0)').run(id, workspaceId, name, parentId);
      return { id };
    },
    createDocument: ({ workspaceId, folderId, title, content }: any) => {
      const id = `doc-${++next}`;
      db.prepare('INSERT INTO documents (id, workspaceId, folderId, title, content) VALUES (?, ?, ?, ?, ?)').run(id, workspaceId, folderId, title, content);
      return { id };
    },
  };

  /** A package as the export handler builds it, uids included. */
  function buildPackage(workspaceId: string) {
    const data = store.exportWorldbuild(workspaceId);
    const refs = data.entities.map((entity: any) => entity.ref);
    data.knowledge = exportAuthoredKnowledge({ db, worldbuildData: worldbuild, workspaceId, entityIds: refs });
    data.facts = exportAuthoredFacts({ worldbuildData: worldbuild, workspaceId, entityIds: refs });
    data.templates = parts.exportTemplates(db, workspaceId);
    data.occurrences = parts.exportOccurrences(db, workspaceId, refs);
    data.placement = parts.exportPlacement(db, workspaceId, refs);
    data.chapters = parts.exportChapters(db, workspaceId, refs);
    data.texts = inWorldTexts.exportItemTexts(db, workspaceId, refs);
    identity.stampUids(db, workspaceId, data);
    return data;
  }

  /** A package the person saves: its identity is stamped and kept. */
  function exportPackage(workspaceId: string) {
    const data = buildPackage(workspaceId);
    identity.stampIdentity(db, workspaceId, data)();
    return JSON.parse(JSON.stringify(data));
  }

  /** Imports the way the import handler does; `record: false` lands it as an app from before identities would. */
  function importPackage(workspaceId: string, payload: any, { record = true } = {}) {
    const { idMap, linkIdByEnds } = store.importWorldbuild(workspaceId, payload, { confirmed: true });
    const landed: Record<string, Map<string, string>> = {
      entities: idMap, knowledge: new Map(), facts: new Map(), occurrences: new Map(), texts: new Map(), chapters: new Map(),
    };
    importAuthoredKnowledge({ db, worldbuildData: worldbuild, workspaceId, knowledge: payload.knowledge, idMap, linkIdByEnds, landed: landed.knowledge });
    importAuthoredFacts({ worldbuildData: worldbuild, workspaceId, facts: payload.facts, idMap, landed: landed.facts });
    parts.importTemplates({ db, worldbuildData: worldbuild, workspaceId, templates: payload.templates, idMap });
    parts.importOccurrences({
      db, service: new EventOccurrenceService(db, calendarService as never, { includeProposed: true }), workspaceId, occurrences: payload.occurrences, idMap, landed: landed.occurrences,
    });
    parts.importPlacement({ db, workspaceId, placement: payload.placement, idMap });
    inWorldTexts.importItemTexts(db, workspaceId, payload.texts, idMap, writing, landed.texts);
    parts.importChapters({ db, workspaceId, chapters: payload.chapters, idMap, ...writing, landed: landed.chapters });
    const recorded = record ? identity.recordImport(db, workspaceId, payload, landed) : null;
    return { idMap, landed, recorded };
  }

  return { writing, buildPackage, exportPackage, importPackage };
}
