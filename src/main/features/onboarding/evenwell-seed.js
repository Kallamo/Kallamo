const path = require('path');
const crypto = require('crypto');
const story = require('./evenwell-story');

const PACKAGE_PATH = path.join(__dirname, '..', '..', '..', 'assets', 'onboarding', 'evenwell.klwb');
const SEEDED_KEY = 'onboarding_evenwell_seeded';
const SCOPE = 'onboarding';
const STAGES = new Set(['intro', 'own-character', 'playing']);

const newId = prefix => `${prefix}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;

// Seeds the Evenwell roleplay and runs its first scene. The world comes from the bundled
// package through the same import as a user's package, so the seed cannot drift from it.
function createEvenwellOnboarding({ db, readPackage, importPayload, roleplay, calendar, setExperienceMode, purgeWorkspace }) {
  const readState = workspaceId => {
    const row = db.prepare('SELECT valueJson FROM workspace_ui_state WHERE workspaceId = ? AND scope = ?').get(workspaceId, SCOPE);
    try { return row ? JSON.parse(row.valueJson) : null; } catch { return null; }
  };
  const writeState = (workspaceId, value) => db.prepare(`
    INSERT INTO workspace_ui_state (workspaceId, scope, valueJson, updatedAt) VALUES (?, ?, ?, ?)
    ON CONFLICT(workspaceId, scope) DO UPDATE SET valueJson = excluded.valueJson, updatedAt = excluded.updatedAt
  `).run(workspaceId, SCOPE, JSON.stringify(value), Date.now());

  const entityIdsByName = (workspaceId, type) => new Map(db.prepare(
    "SELECT id, canonicalName FROM entities WHERE workspaceId = ? AND type = ? AND status != 'proposed'"
  ).all(workspaceId, type).map(row => [row.canonicalName, row.id]));

  // A profile still in the Library under the same name is reused as it is, model and all.
  function ensureProfile(now) {
    const existing = db.prepare('SELECT id FROM writing_profiles WHERE name = ? ORDER BY last_modified DESC LIMIT 1').get(story.GM_PROFILE.name);
    if (existing) return existing.id;
    const id = newId('wp');
    db.prepare(`
      INSERT INTO writing_profiles (
        id, name, description, color, apiProfileId, model, temperature, maxTokens,
        systemPrompt, knowledgeFiles, manualMode, manualJson, isAgentic, agenticPrompt, agenticMaxTurns,
        resultChannel, contextWindow, last_modified, syncToCloud
      ) VALUES (?, ?, ?, ?, NULL, NULL, 0.8, 2048, ?, '[]', 0, '', 1, '', 3, 'replacement', 8192, ?, 0)
    `).run(id, story.GM_PROFILE.name, story.GM_PROFILE.description, story.GM_PROFILE.color, story.GM_PROFILE.systemPrompt, now);
    return id;
  }

  // `recent` puts the story first on the launch screen; an update adds it without moving the user's work.
  function seed({ recent = true } = {}) {
    const now = Date.now();
    const workspaceId = newId('chat');
    try {
      const profileId = ensureProfile(now);
      db.prepare(`
        INSERT INTO chats (
          id, title, description, updatedAt, isPinned, maxContext, archiveThreshold, summarizedIndex,
          activeProfiles, activeWorkflows, backgroundImage, backdropOpacity, userBubbleOpacity, aiBubbleOpacity, memoryBlocks, knowledgeFiles, autoSummarize, syncToCloud
        ) VALUES (?, ?, ?, ?, 0, 128000, 60000, 0, ?, '[]', '', 25, 75, 75, '[]', '[]', 0, 0)
      `).run(workspaceId, story.WORKSPACE.title, story.WORKSPACE.description, recent ? now : 0, JSON.stringify([profileId]));
      setExperienceMode(workspaceId, 'roleplay');

      const result = importPayload(workspaceId, PACKAGE_PATH, readPackage(PACKAGE_PATH), { rulesMode: 'replace', confirmed: true });
      if (!result?.success) throw new Error(result?.error || 'The Evenwell package did not import.');

      const locationId = entityIdsByName(workspaceId, 'Locations').get(story.LOCATION);
      if (!locationId) throw new Error(`The package has no ${story.LOCATION}.`);
      const system = roleplay();
      system.saveScene(workspaceId, { locationId, participantIds: [], nearbyIds: [] });
      const items = entityIdsByName(workspaceId, 'Items');
      const places = entityIdsByName(workspaceId, 'Locations');
      for (const placement of story.PLACEMENTS) {
        const itemId = items.get(placement.item);
        const placeId = places.get(placement.location);
        if (!itemId || !placeId) continue;
        system.proposeInventoryChange({ id: `onboarding-${itemId}`, workspaceId, patch: { itemId, locationId: placeId, quantity: 1 }, source: 'manual', provenanceId: 'onboarding' });
      }
      calendar.saveRoleplayClock(db, workspaceId, story.CLOCK);
      writeState(workspaceId, { story: story.STORY_ID, stage: 'intro', profileId });
      return workspaceId;
    } catch (error) {
      try { purgeWorkspace(db, workspaceId); } catch { /* the original error matters more */ }
      throw error;
    }
  }

  // Once per install, fresh or updated; deleting the story never brings it back on its own.
  function seedOnce() {
    if (db.prepare('SELECT value FROM settings WHERE key = ?').get(SEEDED_KEY)) return null;
    const workspaceId = seed({ recent: Boolean(db.isFreshInstall) });
    db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES (?, '1')").run(SEEDED_KEY);
    return workspaceId;
  }

  let packagedNames = null;
  const isPackaged = name => {
    if (!packagedNames) packagedNames = new Set((readPackage(PACKAGE_PATH).entities || []).map(entity => entity.canonicalName));
    return packagedNames.has(name);
  };

  // Characters the player made here can be picked too, beside the written cast.
  function getStory(workspaceId) {
    const state = readState(workspaceId);
    if (state?.story !== story.STORY_ID) return null;
    const ids = entityIdsByName(workspaceId, 'Characters');
    const settings = roleplay().getSettings(workspaceId);
    const created = db.prepare("SELECT id, canonicalName, lore, data FROM entities WHERE workspaceId = ? AND type = 'Characters' AND status != 'proposed' ORDER BY createdAt")
      .all(workspaceId)
      .filter(row => !isPackaged(row.canonicalName))
      .map(row => {
        let data = {};
        try { data = JSON.parse(row.data || '{}'); } catch { data = {}; }
        const about = String(data.personality || data.appearance || row.lore || '').replace(/\|\|[\s\S]*?\|\|/g, '').trim();
        return {
          name: row.canonicalName, short: row.canonicalName.split(/\s+/)[0], age: data.age ? String(data.age) : '', role: 'Your character', icon: 'user',
          intro: about.length > 260 ? `${about.slice(0, 260).replace(/\s+\S*$/, '')}…` : about,
          start: story.NEWCOMER.start, entityId: row.id,
        };
      });
    return {
      id: story.STORY_ID,
      stage: STAGES.has(state.stage) ? state.stage : 'intro',
      profileId: state.profileId || null,
      playerId: settings.playerEntityId,
      intro: story.INTRO,
      world: story.WORLD,
      newcomer: story.NEWCOMER,
      cast: [
        ...story.CAST
          .filter(member => ids.has(member.name))
          .map(({ opening, companion, ...member }) => ({ ...member, entityId: ids.get(member.name) })),
        ...created,
      ],
    };
  }

  function setStage(workspaceId, stage) {
    const state = readState(workspaceId);
    if (state?.story !== story.STORY_ID || !STAGES.has(stage)) return getStory(workspaceId);
    writeState(workspaceId, { ...state, stage });
    return getStory(workspaceId);
  }

  // The chosen character and their companion are in the scene; the rest of the room is nearby.
  function begin(workspaceId, entityId) {
    const state = readState(workspaceId);
    if (state?.story !== story.STORY_ID) throw new Error('This workspace has no onboarding story.');
    const entity = db.prepare("SELECT id, canonicalName FROM entities WHERE id = ? AND workspaceId = ? AND type = 'Characters'").get(entityId, workspaceId);
    if (!entity) throw new Error('Choose a character from this world.');
    const member = story.CAST.find(item => item.name === entity.canonicalName) || null;
    const ids = entityIdsByName(workspaceId, 'Characters');
    const companionId = ids.get(member ? member.companion : story.NEWCOMER_COMPANION) || null;
    const participantIds = [entity.id, companionId].filter(Boolean);
    const nearbyIds = story.IN_ROOM.map(name => ids.get(name)).filter(id => id && !participantIds.includes(id));

    const system = roleplay();
    system.saveSettings(workspaceId, { playerEntityId: entity.id });
    system.saveScene(workspaceId, { participantIds, nearbyIds });

    const profile = db.prepare('SELECT name, color FROM writing_profiles WHERE id = ?').get(state.profileId || '')
      || { name: story.GM_PROFILE.name, color: story.GM_PROFILE.color };
    const now = Date.now();
    const message = {
      id: newId('msg'),
      chatId: workspaceId,
      role: 'ai',
      content: member ? member.opening : story.newcomerOpening(entity.canonicalName),
      aiName: profile.name,
      aiColor: profile.color,
      debugNotice: '',
      attachedFiles: '[]',
      createdAt: now,
    };
    db.transaction(() => {
      db.prepare(`
        INSERT INTO messages (id, chatId, role, content, aiName, aiColor, debugNotice, attachedFiles, createdAt)
        VALUES (@id, @chatId, @role, @content, @aiName, @aiColor, @debugNotice, @attachedFiles, @createdAt)
      `).run(message);
      db.prepare('UPDATE chats SET updatedAt = ? WHERE id = ?').run(now, workspaceId);
      writeState(workspaceId, { ...state, stage: 'playing' });
    })();
    return { message, story: getStory(workspaceId) };
  }

  return { seed, seedOnce, getStory, setStage, begin };
}

module.exports = { createEvenwellOnboarding };
