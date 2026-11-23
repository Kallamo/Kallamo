import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import { RoleplaySystem } from '../../src/main/features/narrative/roleplay-system';
import { RoleplayConditions, describeConditionEnd } from '../../src/main/features/narrative/roleplay-conditions';
import { SceneGrowthLedger } from '../../src/main/features/narrative/scene-growth';
import { RoleplayRulesPackager } from '../../src/main/features/narrative/roleplay-rules-package';
import { mentionedMechanics, resolveNarrativeRouting } from '../../src/main/features/narrative/narrative-state-routing.js';
import { openTestDatabase } from '../sqlite-test-database';

const W = 'workspace-one';

describe('Roleplay mechanics: rest, conditions and scene growth', () => {
  let directory: string;
  let db: Database.Database;
  let roleplay: RoleplaySystem;
  let conditions: RoleplayConditions;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'kallamo-mechanics-'));
    db = openTestDatabase(join(directory, 'mechanics.db'));
    runDatabaseMigrations(db);
    db.exec(`
      CREATE TABLE entities (
        id TEXT PRIMARY KEY, workspaceId TEXT, type TEXT NOT NULL,
        canonicalName TEXT NOT NULL, data TEXT, status TEXT NOT NULL
      );
      CREATE TABLE entity_links (
        id TEXT PRIMARY KEY, workspaceId TEXT, fromId TEXT, relType TEXT,
        toId TEXT, label TEXT, metadata_json TEXT, createdAt INTEGER
      );
      CREATE TABLE messages (
        id TEXT PRIMARY KEY, chatId TEXT, role TEXT, content TEXT, createdAt INTEGER, excluded INTEGER DEFAULT 0,
        thread TEXT NOT NULL DEFAULT 'roleplay'
      );
    `);
    const insert = db.prepare('INSERT INTO entities (id, workspaceId, type, canonicalName, data, status) VALUES (?, ?, ?, ?, ?, ?)');
    insert.run('kepler', W, 'Characters', 'Kepler', '{}', 'confirmed');
    insert.run('hakan', W, 'Characters', 'Hakan', '{}', 'confirmed');
    roleplay = new RoleplaySystem(db);
    conditions = new RoleplayConditions(db);
  });

  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const mana = () => roleplay.saveDefinition(W, {
    name: 'Mana', key: 'mana', color: '#001bff', minimum: 0, maximum: 160,
    appliesTo: ['Characters'], updatePolicy: 'automatic', sleepRate: 18, restRate: 4
  });

  test('sleep gives back what the resource says per hour, only to who slept, once per turn', () => {
    const definition = mana();
    roleplay.setTargetValue(W, definition.id, 'entity', 'kepler', { current: 30 });
    roleplay.setTargetValue(W, definition.id, 'entity', 'hakan', { current: 30 });

    const changes = roleplay.applyRest(W, 'turn-5am', { sleepMinutes: 195, restMinutes: 0, entityIds: ['kepler'] });
    expect(changes).toEqual([expect.objectContaining({ entityId: 'kepler', delta: 58, source: 'time', reason: '3 hours 15 minutes of sleep' })]);
    roleplay.applyRest(W, 'turn-5am', { sleepMinutes: 195, restMinutes: 0, entityIds: ['kepler'] });
    const current = (id: string) => roleplay.listEntityResources(W, id).find(item => item.definitionId === definition.id)!.current;
    expect(current('kepler')).toBe(88);
    expect(current('hakan')).toBe(30);
    expect(roleplay.listDefinitions(W)[0]).toMatchObject({ sleepRate: 18, restRate: 4 });
  });

  test('a condition tied to a resource starts below its line and ends above it', () => {
    const definition = mana();
    const fatigue = conditions.saveDefinition(W, { name: 'Magic fatigue', triggerDefinitionId: definition.id, triggerBelowPercent: 33 });
    roleplay.setTargetValue(W, definition.id, 'entity', 'kepler', { current: 30 });

    conditions.applyThresholds(W, 'turn-1', ['kepler'], 'Day 16, 01:40');
    expect(conditions.listActive(W, ['kepler'])).toEqual([expect.objectContaining({ conditionId: fatigue.id, source: 'threshold', startedLabel: 'Day 16, 01:40' })]);

    roleplay.setTargetValue(W, definition.id, 'entity', 'kepler', { current: 120 });
    conditions.applyThresholds(W, 'turn-2', ['kepler']);
    expect(conditions.listActive(W, ['kepler'])).toEqual([]);
  });

  test('sleep ends a condition only once enough of it was slept; a short night is not enough', () => {
    conditions.saveSettings(W, { updatePolicy: 'automatic' });
    const resonance = conditions.saveDefinition(W, { name: 'Flux Resonance', description: 'Veins swell and burn.', sleepMinutes: 360 });
    const started = conditions.proposeChange({ id: 'turn-1:condition:0', workspaceId: W, entityId: 'kepler', condition: 'Flux Resonance', kind: 'start', reason: 'held the mana lid for minutes', source: 'ai', provenanceId: 'turn-1' });
    expect(started?.status).toBe('applied');

    conditions.applyTime(W, 'turn-2', { minutes: 195, sleepMinutes: 195, restingIds: ['kepler'] });
    expect(conditions.listActive(W, ['kepler'])).toEqual([expect.objectContaining({ conditionId: resonance.id, sleepLeftMinutes: 165 })]);
    // The same turn analysed again does not count the night twice.
    conditions.applyTime(W, 'turn-2', { minutes: 195, sleepMinutes: 195, restingIds: ['kepler'] });
    expect(conditions.listActive(W, ['kepler'])[0].sleepLeftMinutes).toBe(165);

    const ended = conditions.applyTime(W, 'turn-3', { minutes: 200, sleepMinutes: 200, restingIds: ['kepler'] });
    expect(ended).toEqual([expect.objectContaining({ kind: 'end', source: 'time', reason: 'Passed with sleep' })]);
    expect(conditions.listActive(W, ['kepler'])).toEqual([]);
  });

  test('the AI waits for review, and a condition the catalog lacks is proposed with it', () => {
    conditions.saveDefinition(W, { name: 'Bleeding', durationMinutes: 120, endsWhen: 'when the wound is treated' });
    const start = conditions.proposeChange({ id: 'turn-1:condition:0', workspaceId: W, entityId: 'hakan', condition: 'bleeding', kind: 'start', source: 'ai', provenanceId: 'turn-1' });
    expect(start?.status).toBe('pending');
    expect(conditions.listActive(W)).toEqual([]);
    conditions.resolveChange(W, start!.id, 'approved');
    expect(conditions.listActive(W, ['hakan'])[0]).toMatchObject({ name: 'Bleeding', timeLeftMinutes: 120 });

    const created = conditions.proposeChange({ id: 'turn-2:condition:0', workspaceId: W, entityId: 'kepler', condition: 'Shadowsulfide poisoning', kind: 'start', source: 'ai', provenanceId: 'turn-2', create: { description: 'Lungs burn.' } });
    expect(created?.status).toBe('pending');
    expect(conditions.listDefinitions(W).find(item => item.name === 'Shadowsulfide poisoning')?.status).toBe('proposed');
    conditions.resolveChange(W, created!.id, 'approved');
    expect(conditions.listDefinitions(W).find(item => item.name === 'Shadowsulfide poisoning')?.status).toBe('confirmed');
    expect(describeConditionEnd({ durationMinutes: 120, sleepMinutes: null, restMinutes: null, endsWhen: 'when the wound is treated' }))
      .toBe('wears off in 2 h; ends when the wound is treated');
  });

  test('the scene for growth is the replies after the last weighed scene', () => {
    const insert = db.prepare('INSERT INTO messages (id, chatId, role, content, createdAt) VALUES (?, ?, ?, ?, ?)');
    for (let index = 1; index <= 6; index += 1) {
      insert.run(`user-${index}`, W, 'user', `action ${index}`, index * 10);
      insert.run(`reply-${index}`, W, 'ai', `reply ${index}`, index * 10 + 1);
    }
    const ledger = new SceneGrowthLedger(db);
    expect(ledger.sceneTurns(W, 'reply-3').map(turn => turn.originId)).toEqual(['reply-1', 'reply-2', 'reply-3']);
    ledger.record(W, 'reply-3', { reason: 'moved', turnCount: 3, proposalCount: 1 });
    expect(ledger.isSettled(W, 'reply-3')).toBe(true);
    expect(ledger.sceneTurns(W, 'reply-6')).toEqual([
      expect.objectContaining({ originId: 'reply-4', userMessage: 'action 4' }),
      expect.objectContaining({ originId: 'reply-5' }),
      expect.objectContaining({ originId: 'reply-6', reply: 'reply 6' })
    ]);
    expect(ledger.turnsSinceSettled(W, 'reply-6')).toBe(3);
    expect(ledger.latestReplyId(W)).toBe('reply-6');
  });

  test('the condition catalog travels in the rules package; who has one stays', () => {
    const definition = mana();
    conditions.saveDefinition(W, { name: 'Magic fatigue', description: 'Hands tremble.', triggerDefinitionId: definition.id, triggerBelowPercent: 33, sleepMinutes: 480 });
    conditions.setActive(W, 'kepler', conditions.listDefinitions(W)[0].id, true);
    const packager = new RoleplayRulesPackager(db);
    const rules = packager.export(W, new Set(['kepler']), false);
    expect(rules.conditions?.catalog).toEqual([expect.objectContaining({ name: 'Magic fatigue', triggerResourceKey: 'mana', sleepMinutes: 480 })]);

    packager.import('workspace-two', rules, 'merge', new Map());
    const imported = new RoleplayConditions(db).listDefinitions('workspace-two');
    const importedMana = roleplay.listDefinitions('workspace-two').find(item => item.key === 'mana');
    expect(imported).toEqual([expect.objectContaining({ name: 'Magic fatigue', triggerDefinitionId: importedMana?.id, triggerBelowPercent: 33 })]);
    expect(new RoleplayConditions(db).listActive('workspace-two')).toEqual([]);
  });

  test('a turn that names a resource or condition is read for it, only when the triage found it consequential', () => {
    const terms = [{ name: 'Mana', domain: 'resource' }, { name: 'Ressonância de Fluxo', domain: 'condition' }];
    const named = mentionedMechanics({ userMessage: 'Fechava os olhos, concentrado no fluxo de mana.', narrativeResponse: 'A ressonancia de fluxo volta a queimar.', terms });
    expect(named).toEqual(['resource', 'condition']);
    const signals = { strongDomains: [], candidateDomains: [], signals: [] };
    const read = resolveNarrativeRouting({ triage: { consequential: true, types: ['knowledge'] }, signals, namedMechanics: named });
    expect(read.selectedDomains).toEqual(expect.arrayContaining(['resource', 'condition', 'knowledge']));
    expect(read.forceReasons).toEqual(expect.arrayContaining(['mechanic-named-resource', 'mechanic-named-condition']));
    const quiet = resolveNarrativeRouting({ triage: { consequential: false, types: [] }, signals, namedMechanics: named });
    expect(quiet.selectedDomains).toEqual([]);
  });
});
