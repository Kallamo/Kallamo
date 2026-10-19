import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import { EventOccurrenceService } from '../../src/main/features/worldbuild/event-occurrences';
import * as calendarService from '../../src/main/features/worldbuild/calendar-service.js';
import { openTestDatabase } from '../sqlite-test-database';

describe('Event occurrence memories', () => {
  let directory: string;
  let db: Database.Database;
  let service: EventOccurrenceService;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'kallamo-occurrence-memory-'));
    db = openTestDatabase(join(directory, 'state.db'));
    db.pragma('foreign_keys = ON');
    runDatabaseMigrations(db);
    db.exec(`
      CREATE TABLE entities (
        id TEXT PRIMARY KEY, workspaceId TEXT, type TEXT NOT NULL,
        canonicalName TEXT NOT NULL, aliases TEXT, lore TEXT, data TEXT,
        status TEXT NOT NULL, createdAt INTEGER, last_modified INTEGER
      );
      CREATE TABLE entity_links (
        id TEXT PRIMARY KEY, workspaceId TEXT, fromId TEXT, relType TEXT,
        toId TEXT, label TEXT, metadata_json TEXT, createdAt INTEGER
      );
    `);
    const insert = db.prepare(`
      INSERT INTO entities (id, workspaceId, type, canonicalName, aliases, lore, data, status, createdAt, last_modified)
      VALUES (?, 'workspace-one', ?, ?, '[]', '', '{}', 'confirmed', 1, 1)
    `);
    insert.run('harvest-fair', 'Events', 'Harvest Fair');
    insert.run('vharos', 'Characters', 'Vharos');
    for (const name of ['Ilsa', 'Corwin', 'Pip', 'Tamsin']) insert.run(name.toLowerCase(), 'Characters', name);
    service = new EventOccurrenceService(db, calendarService as never);
  });

  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const memoryDates = () => (db.prepare("SELECT payload_json FROM narrative_records WHERE record_type = 'memory' ORDER BY rowid").all() as Array<{ payload_json: string }>)
    .map(row => JSON.parse(row.payload_json).occurredOn ?? null);

  test('dates each remembered memory with the day the occurrence started', () => {
    const participant = { entityId: 'vharos', role: 'Rider', remember: true, memoryAccessibility: 'available' as const, audienceType: 'all-members' as const, selectedMemberIds: [] };
    const created = service.createManual({
      workspaceId: 'workspace-one', eventEntityId: 'harvest-fair', title: 'Harvest Fair 1001', summary: 'Vharos won the race.',
      startDate: { eraId: 'ce', year: 1001, month: 3, day: 23 }, endDate: null,
      participants: [participant], locationIds: [], relatedEntityIds: []
    });
    expect(memoryDates().at(-1)).toEqual({ eraId: 'ce', year: 1001, month: 3, day: 23 });

    service.updateManual({
      workspaceId: 'workspace-one', occurrenceId: created.id, eventEntityId: 'harvest-fair', title: 'Harvest Fair 1001', summary: 'Vharos won the race.',
      startDate: null, endDate: null, participants: [participant], locationIds: [], relatedEntityIds: []
    });
    expect(memoryDates().at(-1)).toBeNull();
  });

  test('gives a memory to everyone who remembers it, however many took part', () => {
    const people = ['vharos', 'ilsa', 'corwin', 'pip', 'tamsin'];
    service.createManual({
      workspaceId: 'workspace-one', eventEntityId: 'harvest-fair', title: 'Harvest Fair 1002', summary: 'Everyone watched the race.',
      startDate: null, endDate: null, locationIds: [], relatedEntityIds: [],
      participants: people.map(entityId => ({ entityId, role: 'Spectator', remember: true, memoryAccessibility: 'available' as const, audienceType: 'all-members' as const, selectedMemberIds: [] }))
    });
    const subjects = (db.prepare("SELECT subject_id FROM narrative_records WHERE record_type = 'memory'").all() as Array<{ subject_id: string }>).map(row => row.subject_id);
    expect(subjects.sort()).toEqual([...people].sort());
  });
});
