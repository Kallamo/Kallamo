import { createRequire } from 'node:module';
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { openEntityStore, type EntityStoreHarness } from '../worldbuild/entity-store-harness';

const require = createRequire(import.meta.url);
const AdmZip = require('adm-zip');
const story = require('../../src/main/features/onboarding/evenwell-story.js');
const { createEvenwellOnboarding } = require('../../src/main/features/onboarding/evenwell-seed.js');
const { createWorldbuildDataService } = require('../../src/main/features/worldbuild/worldbuild-data.js');

const PACKAGE = require.resolve('../../src/assets/onboarding/evenwell.klwb');
const readPackage = (file: string) => JSON.parse(new AdmZip(file).readAsText('worldbuild.json'));

// The tables outside the Worldbuild store that the seed writes to, as database.js creates them.
const APP_TABLES = `
  CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY, title TEXT, description TEXT, updatedAt INTEGER, isPinned INTEGER, maxContext INTEGER,
    archiveThreshold INTEGER, summarizedIndex INTEGER, activeProfiles TEXT, activeWorkflows TEXT, backgroundImage TEXT,
    backdropOpacity INTEGER, userBubbleOpacity INTEGER, aiBubbleOpacity INTEGER, memoryBlocks TEXT, knowledgeFiles TEXT,
    autoSummarize INTEGER, syncToCloud INTEGER
  );
  CREATE TABLE IF NOT EXISTS writing_profiles (
    id TEXT PRIMARY KEY, name TEXT, description TEXT, color TEXT, apiProfileId TEXT, model TEXT, temperature REAL,
    maxTokens INTEGER, systemPrompt TEXT, knowledgeFiles TEXT, manualMode INTEGER, manualJson TEXT, isAgentic INTEGER,
    agenticPrompt TEXT, agenticMaxTurns INTEGER, resultChannel TEXT, contextWindow INTEGER, last_modified INTEGER, syncToCloud INTEGER
  );
  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY, chatId TEXT, role TEXT, content TEXT, aiName TEXT, aiColor TEXT, debugNotice TEXT,
    attachedFiles TEXT, createdAt INTEGER
  );
  CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY, workspaceId TEXT NOT NULL, name TEXT NOT NULL, parentId TEXT, position INTEGER, createdAt INTEGER
  );
  CREATE TABLE IF NOT EXISTS workspace_ui_state (
    workspaceId TEXT NOT NULL, scope TEXT NOT NULL, valueJson TEXT, updatedAt INTEGER, PRIMARY KEY (workspaceId, scope)
  );
`;

let harness: EntityStoreHarness;
beforeEach(() => {
  harness = openEntityStore();
  harness.db.exec(APP_TABLES);
});
afterEach(() => harness.close());

describe('the bundled Evenwell package', () => {
  test('holds every name the story relies on', () => {
    const names = new Set(readPackage(PACKAGE).entities.map((entity: any) => entity.canonicalName));
    const needed = [
      story.LOCATION,
      ...story.IN_ROOM,
      ...story.CAST.map((member: any) => member.name),
      ...story.CAST.map((member: any) => member.companion).filter(Boolean),
      story.NEWCOMER_COMPANION,
    ];
    expect(needed.filter(name => !names.has(name))).toEqual([]);
  });
});

describe('the journal in the package', () => {
  test("carries Harrow's journal and the torn pages, both in his hand", () => {
    const payload = readPackage(PACKAGE);
    const ref = (name: string) => payload.entities.find((entity: any) => entity.canonicalName === name)?.ref;
    const of = (name: string) => payload.texts.filter((text: any) => text.itemRef === ref(name));
    expect(of("Harrow's Journal").map((text: any) => text.title)).toEqual([
      '3 Seedtide 48 YC', '30 Highsun 48 YC', '12 Leaffall 49 YC', '6 Firstsnow 50 YC', '2 Rainmoon 54 YC',
      '1 Duskmonth 56 YC', '17 Harvest 58 YC', '12 Leaffall 59 YC', '19 Leaffall 59 YC',
    ]);
    expect(of('The Torn Pages')).toHaveLength(3);
    expect(payload.texts.every((text: any) => text.authorRef === ref('Harrow Venn'))).toBe(true);
  });
});

describe('importing a package', () => {
  test('lands as proposals by default and confirmed when the app ships it', () => {
    const payload = readPackage(PACKAGE);
    harness.store.importWorldbuild('user', payload);
    harness.store.importWorldbuild('seed', payload, { confirmed: true });
    const statuses = (workspaceId: string) => harness.db
      .prepare('SELECT status, data FROM entities WHERE workspaceId = ?').all(workspaceId) as Array<{ status: string; data: string }>;
    expect(statuses('user').every(row => row.status === 'proposed' && JSON.parse(row.data)._imported)).toBe(true);
    expect(statuses('seed').every(row => row.status === 'confirmed' && !JSON.parse(row.data)._imported)).toBe(true);
  });
});

describe('the Evenwell onboarding', () => {
  function createOnboarding() {
    const scenes: any[] = [];
    const placements: any[] = [];
    const backgrounds: any[] = [];
    const frames: any[] = [];
    let settings: any = { playerEntityId: null };
    const onboarding = createEvenwellOnboarding({
      db: harness.db,
      readPackage,
      importPayload: (workspaceId: string, _file: string, payload: any, options: any) => {
        harness.store.importWorldbuild(workspaceId, payload, { confirmed: options.confirmed });
        // The app's import writes the package's Facts as authored narrative events.
        createWorldbuildDataService(harness.db).saveWorldFact({ workspaceId, entry: { title: 'The well', statement: 'It has never run dry.' } });
        return { success: true };
      },
      roleplay: () => ({
        saveScene: (_workspaceId: string, patch: any) => scenes.push(patch),
        saveSettings: (_workspaceId: string, input: any) => { settings = { ...settings, ...input }; },
        getSettings: () => settings,
        proposeInventoryChange: (change: any) => placements.push(change.patch),
      }),
      calendar: { saveRoleplayClock: () => {}, applyRoleplayTurnFrame: (_db: any, frame: any) => frames.push(frame) },
      setExperienceMode: () => {},
      purgeWorkspace: (db: any, workspaceId: string) => db.prepare('DELETE FROM chats WHERE id = ?').run(workspaceId),
      setBackground: (workspaceId: string, _file: string, entry: string) => backgrounds.push({ workspaceId, entry }),
    });
    return { onboarding, scenes, placements, backgrounds, frames, settings: () => settings };
  }

  test('seeds once, with the Game Master and the opening dialogues pending', () => {
    const { onboarding, scenes, placements, backgrounds, settings } = createOnboarding();
    const workspaceId = onboarding.seedOnce();
    expect(settings().defaultUpdatePolicy).toBe('automatic');
    const village = readPackage(PACKAGE).entities.find((entity: any) => entity.canonicalName === 'Evenwell').ref;
    expect(backgrounds).toEqual([{ workspaceId, entry: `images/${village}/background.webp` }]);
    expect(onboarding.seedOnce()).toBeNull();
    const chat = harness.db.prepare('SELECT title, activeProfiles FROM chats WHERE id = ?').get(workspaceId) as any;
    expect(chat.title).toBe('Evenwell');
    const profile = harness.db.prepare('SELECT name FROM writing_profiles WHERE id = ?').get(JSON.parse(chat.activeProfiles)[0]) as any;
    expect(profile.name).toBe(story.GM_PROFILE.name);
    expect(scenes[0].locationId).toBeTruthy();
    const authored = harness.db.prepare(`
      SELECT provenance_interpreter_id AS by, COUNT(*) AS count FROM narrative_events
      WHERE workspace_id = ? AND provenance_interpreter = 'user' GROUP BY provenance_interpreter_id
    `).all(workspaceId) as Array<{ by: string | null; count: number }>;
    expect(authored.map(row => row.by)).toEqual(['kallamo-seed']);
    const [fact] = createWorldbuildDataService(harness.db).listWorldFacts(workspaceId);
    expect(fact).toMatchObject({ source: 'manual', by: 'kallamo' });
    const camp = (harness.db.prepare("SELECT id FROM entities WHERE workspaceId = ? AND canonicalName = 'Harrow''s Last Camp'").get(workspaceId) as any).id;
    expect(placements).toContainEqual(expect.objectContaining({ locationId: camp, quantity: 1 }));
    const treasury = (harness.db.prepare("SELECT id FROM entities WHERE workspaceId = ? AND canonicalName = 'The Counting House'").get(workspaceId) as any).id;
    expect(placements).toContainEqual(expect.objectContaining({ locationId: treasury, quantity: 12 }));
    expect(placements).toHaveLength(story.PLACEMENTS.length);
    const purse = harness.db.prepare(`
      SELECT coin.canonicalName AS coin, link.metadata_json AS metadata FROM entity_links link
      JOIN entities coin ON coin.id = link.fromId JOIN entities holder ON holder.id = link.toId
      WHERE link.workspaceId = ? AND holder.canonicalName = 'Rue' AND coin.canonicalName = 'Gold Crown'
    `).get(workspaceId) as any;
    expect(JSON.parse(purse.metadata).quantity).toBe(3);
    const opened = onboarding.getStory(workspaceId);
    expect(opened.stage).toBe('intro');
    expect(opened.cast.map((member: any) => member.name)).toEqual(story.CAST.map((member: any) => member.name));
    expect(opened.cast.every((member: any) => member.entityId && !member.opening)).toBe(true);
  });

  test('starting as Jasper puts Odris beside him, the room nearby and the opening in the chat', () => {
    const { onboarding, scenes, frames, settings } = createOnboarding();
    const workspaceId = onboarding.seed();
    const jasper = onboarding.getStory(workspaceId).cast.find((member: any) => member.name === 'Jasper');
    const { message, story: started } = onboarding.begin(workspaceId, jasper.entityId);

    const ids = new Map((harness.db.prepare("SELECT id, canonicalName FROM entities WHERE workspaceId = ?").all(workspaceId) as any[])
      .map(row => [row.canonicalName, row.id]));
    expect(settings().playerEntityId).toBe(jasper.entityId);
    const scene = scenes.at(-1);
    expect(scene.participantIds).toEqual([ids.get('Jasper'), ids.get('Odris')]);
    expect(scene.nearbyIds).toContain(ids.get('Edwin Hale'));
    expect(scene.nearbyIds).not.toContain(ids.get('Odris'));
    expect(message.content).toBe(story.CAST.find((member: any) => member.name === 'Jasper').opening);
    expect(harness.db.prepare('SELECT COUNT(*) AS count FROM messages WHERE chatId = ?').get(workspaceId)).toEqual({ count: 1 });
    expect(started.stage).toBe('playing');
    expect(frames).toEqual([expect.objectContaining({ originId: message.id, startLocationId: ids.get(story.LOCATION), endLocationId: ids.get(story.LOCATION) })]);
    expect(jasper.look).toMatch(/^Broad-shouldered.*auburn hair.$/);
  });

  test('a character the player made can be picked and starts as a newcomer', () => {
    const { onboarding, scenes } = createOnboarding();
    const workspaceId = onboarding.seed();
    onboarding.setStage(workspaceId, 'own-character');
    const tess = harness.store.createEntity({ workspaceId, type: 'Characters', canonicalName: 'Tess Varley', data: { personality: 'Curious and blunt.', appearance: 'Short and wiry. ||A hidden tattoo.||' } });
    const pick = onboarding.getStory(workspaceId).cast.find((member: any) => member.entityId === tess.id);
    expect(pick).toMatchObject({ name: 'Tess Varley', role: 'Your character', own: true, intro: 'Curious and blunt.', look: 'Short and wiry.' });

    const { message } = onboarding.begin(workspaceId, tess.id);
    expect(message.content).toContain('You are Tess Varley, and your road is your own.');
    const rue = (harness.db.prepare("SELECT id FROM entities WHERE workspaceId = ? AND canonicalName = 'Rue'").get(workspaceId) as any).id;
    expect(scenes.at(-1).participantIds).toEqual([tess.id, rue]);
  });

  test('refuses a character from another world', () => {
    const { onboarding } = createOnboarding();
    const workspaceId = onboarding.seed();
    const stranger = harness.store.createEntity({ workspaceId: 'elsewhere', type: 'Characters', canonicalName: 'Stranger' });
    expect(() => onboarding.begin(workspaceId, stranger.id)).toThrow('Choose a character from this world.');
  });
});

describe('the Knowledge in the package', () => {
  test('lands whole: every entry, every Fact and every hidden mark', () => {
    const { createWorldbuildDataService } = require('../../src/main/features/worldbuild/worldbuild-data.js');
    const { importAuthoredKnowledge, importAuthoredFacts } = require('../../src/main/features/worldbuild/knowledge-package.js');
    const worldbuild = createWorldbuildDataService(harness.db);
    const payload = readPackage(PACKAGE);
    const { idMap, linkIdByEnds } = harness.store.importWorldbuild('seed', payload, { confirmed: true });
    const knowledge = importAuthoredKnowledge({ db: harness.db, worldbuildData: worldbuild, workspaceId: 'seed', knowledge: payload.knowledge, idMap, linkIdByEnds });
    const facts = importAuthoredFacts({ worldbuildData: worldbuild, workspaceId: 'seed', facts: payload.facts, idMap });
    expect(knowledge).toEqual({ knowledgeAdded: payload.knowledge.entries.length, knowledgeSkipped: 0 });
    expect(facts).toEqual({ factsAdded: payload.facts.entries.length, factsSkipped: 0 });
    const hiddenBefore = payload.entities.flatMap((entity: any) => (entity.data?.spoilers || []).filter((key: string) => key.startsWith('knowledge:')));
    const hiddenAfter = (harness.db.prepare("SELECT data FROM entities WHERE workspaceId = 'seed'").all() as Array<{ data: string }>)
      .flatMap(row => (JSON.parse(row.data).spoilers || []).filter((key: string) => key.startsWith('knowledge:')));
    expect(hiddenAfter).toHaveLength(hiddenBefore.length);
  });
});
