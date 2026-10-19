// Tables every database starts from. Versioned changes live in migrations.js, which runs after these.

const BASE_SCHEMA = `
  CREATE TABLE IF NOT EXISTS api_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    provider TEXT NOT NULL,
    baseUrl TEXT,
    apiKey TEXT,
    customConfig TEXT,
    models TEXT
  );

  CREATE TABLE IF NOT EXISTS writing_profiles (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    description TEXT,
    color TEXT,
    apiProfileId TEXT,
    model TEXT,
    temperature REAL,
    maxTokens INTEGER,
    systemPrompt TEXT,
    knowledgeFiles TEXT,
    manualMode INTEGER,
    manualJson TEXT,
    isAgentic INTEGER,
    agenticPrompt TEXT,
    agenticMaxTurns INTEGER DEFAULT 3,
    resultChannel TEXT DEFAULT 'replacement',
    contextWindow INTEGER DEFAULT 8192,
    last_modified INTEGER DEFAULT 0,
    syncToCloud INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS chats (
    id TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    description TEXT,
    updatedAt INTEGER,
    isPinned INTEGER DEFAULT 0,
    maxContext INTEGER DEFAULT 128000,
    archiveThreshold INTEGER DEFAULT 60000,
    summarizedIndex INTEGER DEFAULT 0,
    activeProfiles TEXT,
    activeWorkflows TEXT,
    backgroundImage TEXT,
    backdropOpacity INTEGER DEFAULT 75,
    userBubbleOpacity INTEGER DEFAULT 100,
    aiBubbleOpacity INTEGER DEFAULT 0,
    memoryBlocks TEXT,
    knowledgeFiles TEXT,
    pinnedFiles TEXT DEFAULT '[]',
    autoSummarize INTEGER DEFAULT 0,
    showContextBar INTEGER DEFAULT 0,
    wdContextWindow INTEGER DEFAULT 8192,
    wdLastChannel TEXT DEFAULT 'replacement',
    wdUseChatHistory INTEGER DEFAULT 1,
    lastTargetId TEXT,
    last_modified INTEGER DEFAULT 0,
    syncToCloud INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS messages (
    id TEXT PRIMARY KEY,
    chatId TEXT,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    aiName TEXT,
    aiColor TEXT,
    debugNotice TEXT,
    attachedFiles TEXT,
    createdAt INTEGER,
    last_modified INTEGER DEFAULT 0,
    FOREIGN KEY(chatId) REFERENCES chats(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON messages(chatId, createdAt, id);

  CREATE TABLE IF NOT EXISTS workflows (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    entryProfileId TEXT,
    steps TEXT
  );

  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS variables (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    key TEXT NOT NULL UNIQUE,
    value TEXT NOT NULL,
    description TEXT,
    last_modified INTEGER DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS knowledge_chunks (
    id TEXT PRIMARY KEY,
    ownerId TEXT NOT NULL,
    ownerType TEXT NOT NULL,
    source TEXT NOT NULL,
    text TEXT NOT NULL,
    vector TEXT NOT NULL,
    createdAt INTEGER NOT NULL,
    enabled INTEGER DEFAULT 1,
    manuallyEdited INTEGER DEFAULT 0,
    memoryBlockId TEXT
  );

  CREATE TABLE IF NOT EXISTS folders (
    id TEXT PRIMARY KEY,
    workspaceId TEXT NOT NULL,
    name TEXT NOT NULL,
    parentId TEXT,
    position INTEGER DEFAULT 0,
    createdAt INTEGER,
    last_modified INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_folders_workspace ON folders(workspaceId);

  CREATE TABLE IF NOT EXISTS documents (
    id TEXT PRIMARY KEY,
    workspaceId TEXT NOT NULL,
    folderId TEXT,
    title TEXT NOT NULL,
    content TEXT,
    sheetColor TEXT,
    defaultFont TEXT,
    sheetWidth INTEGER DEFAULT 720,
    pageSize TEXT DEFAULT 'A4',
    orientation TEXT DEFAULT 'portrait',
    pageWidth INTEGER DEFAULT 794,
    pageHeight INTEGER DEFAULT 1123,
    marginTop INTEGER DEFAULT 96,
    marginRight INTEGER DEFAULT 96,
    marginBottom INTEGER DEFAULT 96,
    marginLeft INTEGER DEFAULT 96,
    defaultFontSize INTEGER DEFAULT 18,
    lineHeight REAL DEFAULT 1.6,
    paragraphSpacing INTEGER DEFAULT 12,
    textAlign TEXT DEFAULT 'left',
    firstLineIndent INTEGER DEFAULT 0,
    wordGoal INTEGER DEFAULT 0,
    position INTEGER DEFAULT 0,
    vectorized INTEGER DEFAULT 0,
    createdAt INTEGER,
    updatedAt INTEGER,
    last_modified INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_documents_workspace ON documents(workspaceId);

  CREATE TABLE IF NOT EXISTS pinned_directives (
    id TEXT PRIMARY KEY,
    workspaceId TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'typed',
    text TEXT NOT NULL,
    sourceMessageId TEXT,
    enabled INTEGER DEFAULT 1,
    position INTEGER DEFAULT 0,
    createdAt INTEGER,
    last_modified INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_pinned_directives_workspace ON pinned_directives(workspaceId);

  CREATE TABLE IF NOT EXISTS pending_suggestions (
    id TEXT PRIMARY KEY,
    documentId TEXT NOT NULL,
    workspaceId TEXT NOT NULL,
    channel TEXT NOT NULL DEFAULT 'replacement',
    fromPos INTEGER NOT NULL,
    toPos INTEGER NOT NULL,
    originalText TEXT,
    proposedText TEXT,
    profileId TEXT,
    intermediatePrompt TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    createdAt INTEGER,
    last_modified INTEGER DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_pending_suggestions_document ON pending_suggestions(documentId);

  -- Persistent per-chapter review notes. A note is either scoped to the whole chapter
  -- (excerpt NULL) or to a passage (excerpt = the selected text, used for best-effort
  -- jump-to). source='ai' notes keep the profile + instruction that produced them.
  CREATE TABLE IF NOT EXISTS document_notes (
    id TEXT PRIMARY KEY,
    documentId TEXT NOT NULL,
    workspaceId TEXT NOT NULL,
    body TEXT NOT NULL,
    excerpt TEXT,
    status TEXT NOT NULL DEFAULT 'open',
    source TEXT NOT NULL DEFAULT 'manual',
    profileId TEXT,
    instruction TEXT,
    createdAt INTEGER,
    resolvedAt INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_document_notes_document ON document_notes(documentId);

  CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_owner ON knowledge_chunks(ownerId, ownerType);

  CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(
    chunkId,
    text
  );

  CREATE TABLE IF NOT EXISTS constant_memory (
    id TEXT PRIMARY KEY,
    ownerId TEXT NOT NULL,
    ownerType TEXT NOT NULL DEFAULT 'profile',
    title TEXT,
    content TEXT NOT NULL,
    keywords TEXT,
    createdAt INTEGER,
    last_modified INTEGER DEFAULT 0,
    enabled INTEGER DEFAULT 1
  );

  CREATE INDEX IF NOT EXISTS idx_constant_memory_owner ON constant_memory(ownerId, ownerType);

  -- Structured memory: the tag vocabulary. A tag's description IS the classifier
  -- criterion. isEntity marks tags whose items carry a specific entity instance.
  CREATE TABLE IF NOT EXISTS tags (
    name TEXT PRIMARY KEY,
    description TEXT NOT NULL DEFAULT '',
    isEntity INTEGER DEFAULT 0,
    createdAt INTEGER,
    last_modified INTEGER DEFAULT 0
  );

  -- Multi-label association beside each chunk's vector. entity holds the instance
  -- for entity-type tags (NULL otherwise) and later becomes an FK to an entities
  -- table without a re-migration. Tags are retrieval-only (never sent to generation).
  CREATE TABLE IF NOT EXISTS chunk_tags (
    chunkId TEXT NOT NULL,
    tag TEXT NOT NULL,
    entity TEXT,
    PRIMARY KEY (chunkId, tag, entity)
  );

  CREATE INDEX IF NOT EXISTS idx_chunk_tags_tag ON chunk_tags(tag, entity);
  CREATE INDEX IF NOT EXISTS idx_chunk_tags_chunk ON chunk_tags(chunkId);

  -- Garbage-collect tag associations whenever their chunk is deleted, covering
  -- every knowledge_chunks deletion path in one place.
  CREATE TRIGGER IF NOT EXISTS trg_chunk_tags_gc
  AFTER DELETE ON knowledge_chunks
  FOR EACH ROW
  BEGIN
      DELETE FROM chunk_tags WHERE chunkId = OLD.id;
  END;

  -- Per-workspace world registry (Worldbuild). Every authored element (System,
  -- Location, Item, Race, Faction, Character) lives here with a canonicalName + an
  -- aliases list (JSON) the tagger uses to map surface mentions to an entity id, so
  -- chunk_tags values stay consistent (chunk_tags.entity references entities.id).
  -- The type column aligns with the tag categories (Characters/Locations/Factions/
  -- Items/Races) plus 'System'. data is a JSON blob of type-specific scalars; lore links to a
  -- Writing Desk document (loreDocumentId). status='proposed' = AI suggestion pending.
  CREATE TABLE IF NOT EXISTS entities (
    id             TEXT PRIMARY KEY,
    workspaceId    TEXT,
    type           TEXT NOT NULL,
    canonicalName  TEXT NOT NULL,
    aliases        TEXT,
    lore           TEXT,
    loreDocumentId TEXT,
    data           TEXT,
    status         TEXT NOT NULL DEFAULT 'confirmed',
    createdAt      INTEGER,
    last_modified  INTEGER DEFAULT 0
  );

  -- NOTE: idx_entities_workspace is created in the migration block below, AFTER the
  -- ALTERs that add workspaceId/type, so an existing old-shape entities table doesn't
  -- fail the index here before its columns exist.

  -- Relations between world nodes, one row per directed edge. relType examples:
  -- inside (Location->Location), created_by / owned_by (Item->Character),
  -- found_in (Item->Location), is_race (Character->Race), member_of
  -- (Character->Faction), operates_in (Faction->Location), connected_to
  -- (Character->Location). Derived lists (inventory, members…) are reverse queries.
  CREATE TABLE IF NOT EXISTS entity_links (
    id          TEXT PRIMARY KEY,
    workspaceId TEXT,
    fromId      TEXT NOT NULL,
    relType     TEXT NOT NULL,
    toId        TEXT NOT NULL,
    label       TEXT,
    createdAt   INTEGER
  );

  CREATE INDEX IF NOT EXISTS idx_entity_links_from ON entity_links(fromId, relType);
  CREATE INDEX IF NOT EXISTS idx_entity_links_to ON entity_links(toId, relType);

  CREATE TABLE IF NOT EXISTS workspace_ui_state (
    workspaceId TEXT NOT NULL,
    scope       TEXT NOT NULL,
    valueJson   TEXT NOT NULL,
    updatedAt   INTEGER NOT NULL,
    PRIMARY KEY (workspaceId, scope)
  );

  -- Drop an entity's edges (both directions) when it is deleted.
  CREATE TRIGGER IF NOT EXISTS trg_entity_links_gc
  AFTER DELETE ON entities
  FOR EACH ROW
  BEGIN
      DELETE FROM entity_links WHERE fromId = OLD.id OR toId = OLD.id;
  END;

  -- Drop an entity's chunk tags when it is deleted, so dismissing an AI-proposed
  -- entity also strips the tags that linked it to chunks (no orphan tag rows
  -- pointing at a dead entity id).
  CREATE TRIGGER IF NOT EXISTS trg_chunk_tags_entity_gc
  AFTER DELETE ON entities
  FOR EACH ROW
  BEGIN
      DELETE FROM chunk_tags WHERE entity = OLD.id;
  END;

  CREATE TRIGGER IF NOT EXISTS chats_last_modified_trigger
  AFTER UPDATE ON chats
  FOR EACH ROW
  WHEN NEW.last_modified <= OLD.last_modified OR NEW.last_modified IS NULL
  BEGIN
      UPDATE chats SET last_modified = (strftime('%s', 'now') * 1000) WHERE id = NEW.id;
  END;

  CREATE TRIGGER IF NOT EXISTS chats_insert_last_modified_trigger
  AFTER INSERT ON chats
  FOR EACH ROW
  WHEN NEW.last_modified = 0 OR NEW.last_modified IS NULL
  BEGIN
      UPDATE chats SET last_modified = (strftime('%s', 'now') * 1000) WHERE id = NEW.id;
  END;

  CREATE TRIGGER IF NOT EXISTS writing_profiles_last_modified_trigger
  AFTER UPDATE ON writing_profiles
  FOR EACH ROW
  WHEN NEW.last_modified <= OLD.last_modified OR NEW.last_modified IS NULL
  BEGIN
      UPDATE writing_profiles SET last_modified = (strftime('%s', 'now') * 1000) WHERE id = NEW.id;
  END;

  CREATE TRIGGER IF NOT EXISTS writing_profiles_insert_last_modified_trigger
  AFTER INSERT ON writing_profiles
  FOR EACH ROW
  WHEN NEW.last_modified = 0 OR NEW.last_modified IS NULL
  BEGIN
      UPDATE writing_profiles SET last_modified = (strftime('%s', 'now') * 1000) WHERE id = NEW.id;
  END;

  CREATE TRIGGER IF NOT EXISTS messages_last_modified_trigger
  AFTER UPDATE ON messages
  FOR EACH ROW
  WHEN NEW.last_modified <= OLD.last_modified OR NEW.last_modified IS NULL
  BEGIN
      UPDATE messages SET last_modified = (strftime('%s', 'now') * 1000) WHERE id = NEW.id;
  END;

  CREATE TRIGGER IF NOT EXISTS messages_insert_last_modified_trigger
  AFTER INSERT ON messages
  FOR EACH ROW
  WHEN NEW.last_modified = 0 OR NEW.last_modified IS NULL
  BEGIN
      UPDATE messages SET last_modified = (strftime('%s', 'now') * 1000) WHERE id = NEW.id;
  END;

  CREATE TRIGGER IF NOT EXISTS variables_last_modified_trigger
  AFTER UPDATE ON variables
  FOR EACH ROW
  WHEN NEW.last_modified <= OLD.last_modified OR NEW.last_modified IS NULL
  BEGIN
      UPDATE variables SET last_modified = (strftime('%s', 'now') * 1000) WHERE id = NEW.id;
  END;

  CREATE TRIGGER IF NOT EXISTS variables_insert_last_modified_trigger
  AFTER INSERT ON variables
  FOR EACH ROW
  WHEN NEW.last_modified = 0 OR NEW.last_modified IS NULL
  BEGIN
      UPDATE variables SET last_modified = (strftime('%s', 'now') * 1000) WHERE id = NEW.id;
  END;
`;

// How much more each model counts than the local estimate, so the first request after a
// restart is already sized to the model's real count.
const TOKEN_CALIBRATION_SCHEMA = `
    CREATE TABLE IF NOT EXISTS token_calibration (
      apiProfileId TEXT NOT NULL,
      model TEXT NOT NULL,
      protocol TEXT NOT NULL,
      ratio REAL NOT NULL,
      updatedAt INTEGER NOT NULL,
      PRIMARY KEY (apiProfileId, model, protocol)
    );
`;

// World Index tags are retrieval metadata, separate from vectorization. Coverage
// records each chunk the tagger has examined, including valid no-entity results.
const WORLD_INDEX_SCHEMA = `
    CREATE TABLE IF NOT EXISTS world_index_chunk_status (
      chunkId TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      tagCount INTEGER NOT NULL DEFAULT 0,
      lastRunId TEXT,
      error TEXT,
      updatedAt INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_world_index_chunk_status_run ON world_index_chunk_status(lastRunId);

    CREATE TABLE IF NOT EXISTS world_index_runs (
      id TEXT PRIMARY KEY,
      chatId TEXT NOT NULL,
      tier TEXT NOT NULL,
      mode TEXT NOT NULL,
      status TEXT NOT NULL,
      totalChunks INTEGER NOT NULL DEFAULT 0,
      processedChunks INTEGER NOT NULL DEFAULT 0,
      taggedChunks INTEGER NOT NULL DEFAULT 0,
      emptyChunks INTEGER NOT NULL DEFAULT 0,
      failedChunks INTEGER NOT NULL DEFAULT 0,
      error TEXT,
      startedAt INTEGER NOT NULL,
      completedAt INTEGER,
      dismissedAt INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_world_index_runs_scope ON world_index_runs(chatId, tier, startedAt DESC);

    CREATE TABLE IF NOT EXISTS chunk_tag_suppressions (
      chunkId TEXT NOT NULL,
      tag TEXT NOT NULL,
      entity TEXT NOT NULL,
      PRIMARY KEY (chunkId, tag, entity)
    );

    CREATE TABLE IF NOT EXISTS entity_enrichment_chunks (
      entityId TEXT NOT NULL,
      chunkId TEXT NOT NULL,
      contentHash TEXT NOT NULL DEFAULT '',
      processedAt INTEGER NOT NULL,
      PRIMARY KEY (entityId, chunkId)
    );
    CREATE INDEX IF NOT EXISTS idx_entity_enrichment_chunks_entity ON entity_enrichment_chunks(entityId);

    CREATE TABLE IF NOT EXISTS entity_enrichment_errors (
      id TEXT PRIMARY KEY,
      workspaceId TEXT NOT NULL,
      entityId TEXT NOT NULL,
      entityName TEXT NOT NULL,
      entityType TEXT NOT NULL,
      error TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      dismissedAt INTEGER,
      UNIQUE(workspaceId, entityId)
    );
    CREATE INDEX IF NOT EXISTS idx_entity_enrichment_errors_workspace ON entity_enrichment_errors(workspaceId, createdAt DESC);

    CREATE TRIGGER IF NOT EXISTS trg_entity_enrichment_chunks_chunk_gc
    AFTER DELETE ON knowledge_chunks
    FOR EACH ROW
    BEGIN
        DELETE FROM entity_enrichment_chunks WHERE chunkId = OLD.id;
    END;

    CREATE TRIGGER IF NOT EXISTS trg_entity_enrichment_chunks_entity_gc
    AFTER DELETE ON entities
    FOR EACH ROW
    BEGIN
        DELETE FROM entity_enrichment_chunks WHERE entityId = OLD.id;
        DELETE FROM entity_enrichment_errors WHERE entityId = OLD.id;
    END;
`;

module.exports = { BASE_SCHEMA, TOKEN_CALIBRATION_SCHEMA, WORLD_INDEX_SCHEMA };
