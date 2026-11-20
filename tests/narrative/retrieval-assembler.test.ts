import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { runDatabaseMigrations } from '../../src/main/database/migrations.js';
import { NarrativeStateSystem } from '../../src/main/features/narrative/narrative-state';
import { assembleContext } from '../../src/main/features/narrative/retrieval/assembler';
import { briefPrompt, NameIndex, parseBrief, mergeNeeds, namedNeeds, type SkillRef } from '../../src/main/features/narrative/retrieval/needs';
import { linkedNames } from '../../src/main/features/narrative/retrieval/linked-names';
import { RoleplaySkills } from '../../src/main/features/narrative/roleplay-skills';
import type { SceneInput, SceneStateSource } from '../../src/main/features/narrative/retrieval/scene-core';
import { openTestDatabase } from '../sqlite-test-database';

const WORKSPACE = 'workspace-retrieval';
const estimate = (text: string) => Math.max(1, Math.ceil(text.length / 4));
const source: SceneStateSource = { stateLines: () => [], sceneMemory: () => '', alwaysInContextIds: () => [] };

describe('Need-driven context assembly', () => {
  let directory: string;
  let db: Database.Database;

  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'kallamo-retrieval-'));
    db = openTestDatabase(join(directory, 'state.db'));
    db.pragma('foreign_keys = ON');
    runDatabaseMigrations(db);
    db.exec(`
      CREATE TABLE IF NOT EXISTS entities (
        id TEXT PRIMARY KEY, workspaceId TEXT, type TEXT NOT NULL, canonicalName TEXT NOT NULL, aliases TEXT,
        lore TEXT, data TEXT, status TEXT NOT NULL, createdAt INTEGER, last_modified INTEGER
      );
      CREATE TABLE IF NOT EXISTS entity_links (
        id TEXT PRIMARY KEY, workspaceId TEXT, fromId TEXT, relType TEXT, toId TEXT, label TEXT, metadata_json TEXT, createdAt INTEGER
      );
    `);
    const add = (id: string, type: string, name: string, data: Record<string, unknown>, aliases: string[] = []) => db.prepare(`
      INSERT INTO entities (id, workspaceId, type, canonicalName, aliases, lore, data, status) VALUES (?, ?, ?, ?, ?, NULL, ?, 'confirmed')
    `).run(id, WORKSPACE, type, name, JSON.stringify(aliases), JSON.stringify(data));
    add('elias', 'Characters', 'Elias', { appearance: 'A tall smith with burned hands. He limps.', personality: 'Patient and dry. He hates waste.', showBirthday: true, birthDate: { eraId: 'x', year: 3, month: 1, day: 1 } });
    add('tess', 'Characters', 'Tess', { appearance: 'Short and quick. Ink on her fingers.', personality: 'Curious. Talks too much.' });
    add('golem', 'Creatures', 'Iron Warden', { appearance: 'A siege construct of black iron. Two meters tall.', abilities: 'Cold shock from its core. Climbs walls.' });
    add('mara', 'Characters', 'Mara', { appearance: 'A courier with a red scarf. Never sits.', personality: 'Blunt. Loyal.' });
    add('sight', 'System', 'Insight', { content: 'Insight lets a holder read an object\'s structure and rarity.' }, ['insight']);
    add('guild', 'Factions', 'Harbor Guild', { description: 'Merchants who run the docks.' });
  });

  afterEach(() => {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  });

  const scene: SceneInput = { locationId: null, participantIds: ['elias', 'tess', 'golem'], possibleObserverIds: [], nearbyIds: [], objectIds: [], playerId: 'elias' };

  test('everyone present gets a sheet, a named absent person a card, a rule its full text', async () => {
    const result = await assembleContext({
      db, workspaceId: WORKSPACE, mode: 'roleplay', request: 'I use insight on the plate and think of Mara.', lastReply: '',
      scene, ceiling: 20000, estimateTokens: estimate, source
    });
    expect(result.context).toContain('Iron Warden (Creatures)\nAppearance: A siege construct');
    expect(result.context).toContain('Abilities: Cold shock from its core. Climbs walls.');
    expect(result.context).toContain('Mara (Characters)');
    expect(result.context).not.toContain('Never sits.\nPersonality: Blunt. Loyal.\nStatus');
    expect(result.context).toContain('Insight lets a holder read');
    expect(result.context).not.toContain('Show Birthday');
    expect(result.context).not.toContain('"eraId"');
    expect(result.report.needs.map(need => need.kind).sort()).toEqual(['entity', 'open', 'rule']);
  });

  test('a name the turn does not write and no need asks for stays out', async () => {
    const result = await assembleContext({
      db, workspaceId: WORKSPACE, mode: 'roleplay', request: 'I strike the iron.', lastReply: '',
      scene, ceiling: 20000, estimateTokens: estimate, source
    });
    expect(result.context).not.toContain('Harbor Guild');
    expect(result.context).not.toContain('Mara');
    // Without a planner the turn's own words are still searched, and found nothing here.
    expect(result.report.needs).toEqual([expect.objectContaining({ kind: 'open', source: 'message', items: 0 })]);
  });

  test('the ceiling shrinks what the turn asked for before it touches the scene', async () => {
    const roomy = await assembleContext({
      db, workspaceId: WORKSPACE, mode: 'roleplay', request: 'Mara and the Harbor Guild.', lastReply: '',
      scene, ceiling: 20000, estimateTokens: estimate, source,
      brief: { needs: [{ kind: 'entity', label: 'Mara', entities: ['Mara'], use: 'acts' }] }
    });
    const tight = await assembleContext({
      db, workspaceId: WORKSPACE, mode: 'roleplay', request: 'Mara and the Harbor Guild.', lastReply: '',
      scene, ceiling: Math.floor(roomy.usedTokens * 0.8), estimateTokens: estimate, source,
      brief: { needs: [{ kind: 'entity', label: 'Mara', entities: ['Mara'], use: 'acts' }] }
    });
    expect(roomy.report.degraded).toEqual([]);
    expect(tight.report.degraded.length).toBeGreaterThan(0);
    expect(tight.report.degraded.every(step => !['entity:elias', 'entity:tess', 'entity:golem'].includes(step.key))).toBe(true);
    expect(tight.context).toContain('Iron Warden (Creatures)');
  });

  test('what two people present both know is written once', async () => {
    const system = new NarrativeStateSystem(db);
    system.createEvent({
      workspaceId: WORKSPACE, originId: 'turn-1', interpreterId: 'model', allowedEntityIds: new Set(['elias', 'tess', 'guild']), storyMinute: null,
      event: {
        type: 'revelation', description: 'Elias and Tess learn the guild code.', excerpt: 'The code is Dawnfall.', participantIds: ['elias', 'tess'], confidence: 0.98,
        operations: [
          { type: 'knowledge', subjectId: 'elias', proposition: { subjectId: 'guild', predicate: 'gate-code', object: 'Dawnfall' }, category: 'capability', acquisition: 'witness', confidence: 0.98 },
          { type: 'knowledge', subjectId: 'tess', proposition: { subjectId: 'guild', predicate: 'gate-code', object: 'Dawnfall' }, category: 'capability', acquisition: 'witness', confidence: 0.98 }
        ]
      }
    });
    const result = await assembleContext({
      db, workspaceId: WORKSPACE, mode: 'roleplay', request: 'We walk to the Harbor Guild.', lastReply: '',
      scene: { ...scene, participantIds: ['elias', 'tess'] }, ceiling: 20000, estimateTokens: estimate, source
    });
    const lines = result.context.split('\n').filter(line => line.includes('Dawnfall'));
    expect(lines).toHaveLength(1);
    expect(result.context).toContain('Known to Everyone present:');
  });

  test('a skill the brief asks for comes as a rule, with who in the scene has it', async () => {
    const skills = new RoleplaySkills(db);
    skills.saveSettings(WORKSPACE, { enabled: true, config: { policy: 'automatic' } });
    const smithing = skills.saveSkill(WORKSPACE, { name: 'Smithing', description: 'Working metal at the forge.' });
    const memory = skills.saveSkill(WORKSPACE, { name: 'Memory Forging', description: 'Binding an echo into a receptive metal.', parentId: smithing.id });
    skills.setEntitySkill(WORKSPACE, 'elias', memory.id, 0);
    const result = await assembleContext({
      db, workspaceId: WORKSPACE, mode: 'roleplay', request: 'Can we give the copy a history?', lastReply: '',
      scene, ceiling: 20000, estimateTokens: estimate, source,
      brief: { needs: [{ kind: 'rule', label: 'how a piece gains a history', entities: ['Memory Forging'] }] }
    });
    expect(result.context).toContain('Memory Forging (skill, under Smithing): Binding an echo into a receptive metal.');
    expect(result.context).toContain('In the scene: Elias: Novice.');
    expect(result.report.needs).toEqual([expect.objectContaining({ kind: 'rule', items: 1, met: true })]);
  });

  test('the chat archive answers an open question only with passages about it', async () => {
    const result = await assembleContext({
      db, workspaceId: WORKSPACE, mode: 'roleplay', request: 'Can we give the copy a history?', lastReply: '',
      scene, ceiling: 20000, estimateTokens: estimate, source,
      brief: { needs: [{ kind: 'open', label: 'aging a forged piece', query: 'processos que imbuem história em peças sem danificá-las' }] },
      searchArchive: async () => [
        { id: 'a1', source: 'Chat Archive', text: 'Ela conhece a história do Poço 04. Claro que conhece.' },
        { id: 'a2', source: 'Chat Archive', text: 'Bancadas de reparo, peças de armadura e panos de polimento.' },
        { id: 'a3', source: 'Chat Archive', text: 'Tomas contou que o processo de têmpera lenta dá história a uma peça sem danificar o núcleo.' }
      ]
    });
    expect(result.context).toContain('processo de têmpera lenta');
    expect(result.context).not.toContain('Poço 04');
    expect(result.context).not.toContain('panos de polimento');
  });

  test('without a planner the turn is searched by its own words, and outside Roleplay the documents too', async () => {
    const searched: string[] = [];
    const result = await assembleContext({
      db, workspaceId: WORKSPACE, mode: 'standard', request: 'What did the harbor masters decide about the tolls?', lastReply: '',
      ceiling: 20000, estimateTokens: estimate, source,
      searchDocuments: async need => { searched.push(String(need.query)); return [{ id: 'd1', source: 'Harbor charter', text: 'The harbor masters doubled the tolls after the storm.' }]; }
    });
    expect(searched).toContain('What did the harbor masters decide about the tolls?');
    expect(result.context).toContain('The harbor masters doubled the tolls after the storm.');
    expect(result.report.needs.map(need => need.source)).toEqual(expect.arrayContaining(['message']));
  });

  test('a name in what the search brought comes along as a card', async () => {
    const result = await assembleContext({
      db, workspaceId: WORKSPACE, mode: 'roleplay', request: 'Where did the stolen crates go?', lastReply: '',
      scene, ceiling: 20000, estimateTokens: estimate, source,
      brief: { needs: [{ kind: 'open', label: 'the stolen crates', query: 'stolen crates went where' }] },
      searchArchive: async () => [{ id: 'a1', source: 'Chat Archive', text: 'The stolen crates went to the Harbor Guild warehouse at night.' }]
    });
    expect(result.context).toContain('[Named in what came up]');
    expect(result.context).toContain('Harbor Guild (Factions)');
  });

  test('outside Roleplay the context is the request\'s, with no scene', async () => {
    const result = await assembleContext({
      db, workspaceId: WORKSPACE, mode: 'standard', request: 'Describe the Harbor Guild for chapter two.', lastReply: '',
      ceiling: 20000, estimateTokens: estimate, source
    });
    expect(result.context).not.toContain('--- SCENE ---');
    expect(result.context).toContain('--- FOR THIS REQUEST ---');
    expect(result.context).toContain('Merchants who run the docks.');
  });
});

describe('Reading the planner\'s brief', () => {
  const entities = [
    { id: 'a', type: 'Characters', canonicalName: 'Arkanos', aliases: [], lore: null, data: null, status: 'confirmed' },
    { id: 'b1', type: 'Locations', canonicalName: 'Forge', aliases: [], lore: null, data: null, status: 'confirmed' },
    { id: 'b2', type: 'Items', canonicalName: 'Forge', aliases: [], lore: null, data: null, status: 'confirmed' }
  ];
  const context = (request: string) => ({ mode: 'roleplay' as const, request, names: new NameIndex(entities), presentIds: new Set<string>(), inHandIds: new Set<string>() });

  test('names resolve to ids, an unknown name becomes an open question, a kind of the other mode is dropped', () => {
    const needs = parseBrief({ needs: [
      { kind: 'entity', label: 'Arkanos', entities: ['arkanos'] },
      { kind: 'entity', label: 'the ghost', entities: ['The Pale One'] },
      { kind: 'chronology', label: 'later', entities: ['Arkanos'] }
    ] }, context('Arkanos waits.'));
    expect(needs.map(need => [need.kind, need.entityIds])).toEqual([['entity', ['a']], ['open', []]]);
    expect(needs[1].query).toBe('The Pale One');
  });

  test('a rule named only in the label is found by its name, asked once, and a rule found nowhere is a question', () => {
    const rules = [...entities, { id: 'r', type: 'System', canonicalName: 'Rarities', aliases: ['rarity'], lore: null, data: null, status: 'confirmed' }];
    const ctx = { ...context('The rarity does not match.'), names: new NameIndex(rules) };
    const brief = parseBrief({ needs: [
      { kind: 'rule', label: 'how rarity works on artifacts', use: 'acts' },
      { kind: 'rule', label: 'whether history changes rarity', use: 'acts' },
      { kind: 'rule', label: 'aging techniques of the workshop' }
    ] }, ctx);
    expect(brief.map(need => [need.kind, need.entityIds])).toEqual([['rule', ['r']], ['open', []]]);
    expect(brief[1].query).toBe('aging techniques of the workshop');
    const merged = mergeNeeds(namedNeeds(ctx), brief);
    expect(merged.filter(need => need.entityIds.includes('r'))).toEqual([expect.objectContaining({ kind: 'rule', use: 'acts', source: 'brief' })]);
  });

  test('skills are rules: named by the brief, in its label, or in the turn by someone who has them', () => {
    const skills: SkillRef[] = [
      { id: 's1', name: 'Memory Forging', description: '', parentId: null },
      { id: 's2', name: 'Appraisal', description: '', parentId: null }
    ];
    const ctx = { ...context('I try appraisal on it.'), skills, heldSkillIds: new Set(['s2']) };
    const brief = parseBrief({ needs: [
      { kind: 'entity', label: 'the skill', entities: ['Memory Forging'] },
      { kind: 'rule', label: 'what appraisal reads' }
    ] }, ctx);
    expect(brief.map(need => [need.kind, need.skillIds])).toEqual([['rule', ['s1']], ['rule', ['s2']]]);
    expect(namedNeeds(ctx).map(need => need.skillIds)).toEqual([['s2']]);
    expect(namedNeeds({ ...ctx, heldSkillIds: new Set<string>() })).toEqual([]);
    expect(mergeNeeds(namedNeeds(ctx), brief)).toHaveLength(2);
  });

  test('a name is found by a distinctive part of it, in the brief or written as a proper noun', () => {
    const rows = [
      ...entities,
      { id: 'ore', type: 'Items', canonicalName: 'Minério de Brasaferrina', aliases: [], lore: null, data: null, status: 'confirmed' },
      { id: 'fangs', type: 'Items', canonicalName: 'Lâminas Gêmeas do Farol', aliases: [], lore: null, data: null, status: 'confirmed' },
      { id: 'forge-event', type: 'Events', canonicalName: 'A Forja das Lâminas Gêmeas', aliases: [], lore: null, data: null, status: 'confirmed' }
    ];
    const index = new NameIndex(rows);
    expect(index.resolve('Brasaferrina').map(entity => entity.id)).toEqual(['ore']);
    expect(index.resolve('Lâminas Gêmeas do Farol').map(entity => entity.id)).toEqual(['fangs']);
    // "Lâminas Gêmeas" is part of two names, so it names neither.
    expect(index.resolve('Lâminas Gêmeas')).toEqual([]);
    expect(index.partialMentions('Usamos Brasaferrina na forja.').map(match => match.entityId)).toEqual(['ore']);
    expect(index.partialMentions('usamos brasaferrina na forja').map(match => match.entityId)).toEqual(['ore']);
    expect(index.partialMentions('o farol apagou cedo')).toEqual([]);
  });

  describe('names in other languages', () => {
    const rows = [
      ...entities,
      { id: 'sword', type: 'Items', canonicalName: 'Épée de Cendrelune', aliases: [], lore: null, data: null, status: 'confirmed' },
      { id: 'smithy', type: 'Locations', canonicalName: 'Schmiede von Eisenhain', aliases: [], lore: null, data: null, status: 'confirmed' },
      { id: 'blade', type: 'Items', canonicalName: '月影の剣', aliases: ['Tsukikage'], lore: null, data: null, status: 'confirmed' },
      { id: 'es-rule', type: 'System', canonicalName: 'Habilidades', aliases: [], lore: null, data: null, status: 'confirmed' },
      { id: 'de-rule', type: 'System', canonicalName: 'Fähigkeiten', aliases: [], lore: null, data: null, status: 'confirmed' }
    ];
    const index = new NameIndex(rows);
    const ruleIds = (label: string) => parseBrief({ needs: [{ kind: 'rule', label }] }, { ...context(label), names: index }).map(need => need.entityIds);

    test('French: a name resolves without its accents', () => {
      expect(index.resolve('epee de cendrelune').map(entity => entity.id)).toEqual(['sword']);
    });
    test('French: a distinctive part written as a proper noun', () => {
      expect(index.partialMentions('Elle a forgé Cendrelune hier.').map(match => match.entityId)).toEqual(['sword']);
    });
    test('German: a distinctive part written as a proper noun', () => {
      expect(index.partialMentions('Wir gehen nach Eisenhain.').map(match => match.entityId)).toEqual(['smithy']);
    });
    test('Japanese: a name in another script resolves', () => {
      expect(index.resolve('月影の剣').map(entity => entity.id)).toEqual(['blade']);
      expect(index.resolve('tsukikage').map(entity => entity.id)).toEqual(['blade']);
    });
    test('Spanish: a rule named in the singular or the plural', () => {
      expect(ruleIds('cómo funciona una habilidad')).toEqual([['es-rule']]);
      expect(ruleIds('cómo funcionan las habilidades')).toEqual([['es-rule']]);
    });
    test('German: a rule named in the singular or the plural', () => {
      expect(ruleIds('wie eine Fähigkeit wirkt')).toEqual([['de-rule']]);
      expect(ruleIds('wie die Fähigkeiten wirken')).toEqual([['de-rule']]);
    });
    test('Portuguese and English: a rule named in the singular or the plural', () => {
      const rarities = new NameIndex([...entities, { id: 'r', type: 'System', canonicalName: 'Raridades', aliases: ['Rarities'], lore: null, data: null, status: 'confirmed' }]);
      const ids = (label: string) => parseBrief({ needs: [{ kind: 'rule', label }] }, { ...context(label), names: rarities }).map(need => need.entityIds);
      expect(ids('qual a raridade da peça')).toEqual([['r']]);
      expect(ids('how rarity works')).toEqual([['r']]);
    });
  });

  test('the planner sees what the Worldbuild links to the names, and the profile search guidance', () => {
    const view = {
      nameOf: (id: string) => ({ ilsa: 'Ilsa', fangs: 'Lâminas Gêmeas do Farol', corin: 'Corin' } as Record<string, string>)[id],
      entity: (id: string) => ({ fangs: { id: 'fangs', type: 'Items', canonicalName: 'Lâminas Gêmeas do Farol' }, corin: { id: 'corin', type: 'Characters', canonicalName: 'Corin' } } as Record<string, unknown>)[id],
      links: (id: string) => id === 'ilsa' ? [{ relType: 'owned_by', label: null, otherId: 'fangs', direction: 'to' }, { relType: 'friend_of', label: null, otherId: 'corin', direction: 'from' }] : []
    } as never;
    const linked = linkedNames(view, { mentionedIds: ['ilsa'], sceneIds: ['corin'] });
    expect(linked).toEqual(['Lâminas Gêmeas do Farol (Items, owned by Ilsa)']);
    const prompt = briefPrompt({ mode: 'roleplay', request: 'As adagas da Ilsa', lastReply: '', coreNames: ['Corin'], mentioned: ['Ilsa'], documents: [], linked, guidance: 'Look for items by their owner.' });
    expect(prompt.prompt).toContain('Linked to the names above: Lâminas Gêmeas do Farol (Items, owned by Ilsa)');
    expect(prompt.systemPrompt).toContain('Look for items by their owner.');
  });

  test('the names floor and the brief join without repeating an entity, and acting wins', () => {
    const ctx = context('Arkanos waits.');
    const merged = mergeNeeds(namedNeeds(ctx), parseBrief({ needs: [{ kind: 'entity', label: 'Arkanos', entities: ['Arkanos'], use: 'acts' }] }, ctx));
    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({ kind: 'entity', use: 'acts', entityIds: ['a'] });
  });
});
