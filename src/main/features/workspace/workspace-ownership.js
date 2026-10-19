// Every table that holds rows of one workspace, and how deleting the workspace reaches them.
// Only messages reference chats through a foreign key, so a table missing here keeps its rows
// after the workspace is gone. The coverage test compares these lists with the live schema.

/** Rows carry the workspace id in this column and are removed with it. */
const WORKSPACE_OWNED_COLUMNS = [
  { table: 'folders', column: 'workspaceId' },
  { table: 'documents', column: 'workspaceId' },
  { table: 'pinned_directives', column: 'workspaceId' },
  { table: 'pending_suggestions', column: 'workspaceId' },
  { table: 'document_notes', column: 'workspaceId' },
  { table: 'document_analyses', column: 'workspaceId' },
  { table: 'entities', column: 'workspaceId' },
  { table: 'entity_links', column: 'workspaceId' },
  { table: 'entity_enrichment_errors', column: 'workspaceId' },
  { table: 'entity_redirects', column: 'workspace_id' },
  { table: 'entity_update_runs', column: 'workspace_id' },
  { table: 'entity_update_evidence', column: 'workspace_id' },
  { table: 'workspace_ui_state', column: 'workspaceId' },
  { table: 'workspace_experience_modes', column: 'workspace_id' },
  { table: 'world_index_runs', column: 'chatId' },
  { table: 'worldbuild_field_definitions', column: 'workspace_id' },
  { table: 'worldbuild_entity_templates', column: 'workspace_id' },
  { table: 'worldbuild_entity_images', column: 'workspace_id' },
  { table: 'worldbuild_calendars', column: 'workspace_id' },
  { table: 'worldbuild_knowledge_cards', column: 'workspace_id' },
  { table: 'worldbuild_knowledge_sources', column: 'workspace_id' },
  { table: 'worldbuild_known_fields', column: 'workspace_id' },
  { table: 'worldbuild_knowledge_audience_members', column: 'workspace_id' },
  { table: 'worldbuild_knowledge_exclusions', column: 'workspace_id' },
  { table: 'worldbuild_known_relationships', column: 'workspace_id' },
  { table: 'worldbuild_event_occurrences', column: 'workspace_id' },
  { table: 'narrative_events', column: 'workspace_id' },
  { table: 'narrative_event_participants', column: 'workspace_id' },
  { table: 'narrative_event_evidence', column: 'workspace_id' },
  { table: 'narrative_records', column: 'workspace_id' },
  { table: 'narrative_change_set_attempts', column: 'workspace_id' },
  { table: 'narrative_operation_reviews', column: 'workspace_id' },
  { table: 'narrative_awareness_records', column: 'workspace_id' },
  { table: 'narrative_scenes', column: 'workspace_id' },
  { table: 'narrative_scene_participants', column: 'workspace_id' },
  { table: 'narrative_scene_possible_observers', column: 'workspace_id' },
  { table: 'narrative_state_jobs', column: 'workspace_id' },
  { table: 'narrative_state_metrics', column: 'workspace_id' },
  { table: 'narrative_state_fingerprints', column: 'workspace_id' },
  { table: 'narrative_origin_lifecycle', column: 'workspace_id' },
  { table: 'narrative_context_manifests', column: 'workspace_id' },
  { table: 'narrative_turn_replacements', column: 'workspace_id' },
  { table: 'roleplay_workspace_settings', column: 'workspace_id' },
  { table: 'roleplay_resource_definitions', column: 'workspace_id' },
  { table: 'roleplay_resource_values', column: 'workspace_id' },
  { table: 'roleplay_resource_changes', column: 'workspace_id' },
  { table: 'roleplay_progression_settings', column: 'workspace_id' },
  { table: 'roleplay_progression_members', column: 'workspace_id' },
  { table: 'roleplay_trait_definitions', column: 'workspace_id' },
  { table: 'roleplay_progress_values', column: 'workspace_id' },
  { table: 'roleplay_progress_changes', column: 'workspace_id' },
  { table: 'roleplay_skill_settings', column: 'workspace_id' },
  { table: 'roleplay_skill_members', column: 'workspace_id' },
  { table: 'roleplay_skills', column: 'workspace_id' },
  { table: 'roleplay_skill_values', column: 'workspace_id' },
  { table: 'roleplay_skill_changes', column: 'workspace_id' },
  { table: 'roleplay_scene_objects', column: 'workspace_id' },
  { table: 'roleplay_scene_nearby', column: 'workspace_id' },
  { table: 'roleplay_scene_changes', column: 'workspace_id' },
  { table: 'roleplay_inventory_changes', column: 'workspace_id' },
  { table: 'roleplay_entity_changes', column: 'workspace_id' },
  { table: 'roleplay_turn_snapshots', column: 'workspace_id' },
  { table: 'roleplay_turn_presence', column: 'workspace_id' },
  { table: 'roleplay_character_memory', column: 'workspace_id' },
  { table: 'roleplay_location_backgrounds', column: 'workspace_id' },
  { table: 'roleplay_equipment', column: 'workspace_id' },
  { table: 'roleplay_location_inventory', column: 'workspace_id' },
  { table: 'roleplay_time_state', column: 'workspace_id' },
  { table: 'roleplay_time_matrices', column: 'workspace_id' },
  { table: 'roleplay_time_advances', column: 'workspace_id' },
  { table: 'roleplay_message_frames', column: 'workspace_id' }
];

/** Rows that belong to a workspace through another row instead of a column of their own. */
const WORKSPACE_OWNED_THROUGH = [
  { table: 'chats', through: 'is the workspace itself; removed last' },
  { table: 'messages', through: 'chats.id, ON DELETE CASCADE' },
  { table: 'entity_update_jobs', through: 'entity_update_runs.run_id, ON DELETE CASCADE' },
  { table: 'knowledge_chunks', through: 'ownerId: the workspace, or one of its documents' },
  { table: 'knowledge_chunks_fts', through: 'chunkId (trigger)' },
  { table: 'chunk_tags', through: 'chunkId (trigger) and entity (trigger)' },
  { table: 'chunk_tag_suppressions', through: 'chunkId (trigger)' },
  { table: 'world_index_chunk_status', through: 'chunkId (trigger)' },
  { table: 'entity_enrichment_chunks', through: 'chunkId and entityId (triggers)' }
];

/** Tables shared by every workspace, or not about workspaces at all. */
const NOT_WORKSPACE_TABLES = [
  { table: 'api_profiles', reason: 'Connections are app-wide.' },
  { table: 'writing_profiles', reason: 'AI Profiles live in the Library and are shared.' },
  { table: 'constant_memory', reason: 'Owned by an AI Profile.' },
  { table: 'workflows', reason: 'Shared across workspaces.' },
  { table: 'settings', reason: 'App-wide.' },
  { table: 'variables', reason: 'App-wide.' },
  { table: 'tags', reason: 'The shared tag vocabulary.' },
  { table: 'token_calibration', reason: 'Measured per connection and model.' },
  { table: 'schema_migrations', reason: 'Schema bookkeeping.' },
  { table: 'app_meta', reason: 'Schema bookkeeping.' }
];

const hasTable = (db, name) => Boolean(
  db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
);

// Chapters own their chunks by document id, so this runs while the documents still exist. The
// keyword index and the chunk-keyed tables follow through the knowledge_chunks delete trigger.
function removeWorkspaceChunks(db, workspaceId) {
  return db.prepare(`
    DELETE FROM knowledge_chunks
    WHERE ownerId = @workspaceId
       OR (ownerType = 'document' AND ownerId IN (SELECT id FROM documents WHERE workspaceId = @workspaceId))
  `).run({ workspaceId }).changes;
}

/** Removes the workspace and everything it owns in one transaction. Files on disk are the caller's. */
function purgeWorkspace(db, workspaceId) {
  if (!workspaceId) throw new Error('A workspace id is required.');
  let removed = 0;
  db.transaction(() => {
    // Some narrative tables reference each other without a cascade; checked once all are gone.
    db.pragma('defer_foreign_keys = ON');
    removed += removeWorkspaceChunks(db, workspaceId);
    for (const { table, column } of WORKSPACE_OWNED_COLUMNS) {
      if (!hasTable(db, table)) continue;
      removed += db.prepare(`DELETE FROM ${table} WHERE ${column} = ?`).run(workspaceId).changes;
    }
    removed += db.prepare('DELETE FROM chats WHERE id = ?').run(workspaceId).changes;
  })();
  return { removed };
}

/** Workspace ids that still own rows although their workspace is gone. */
function orphanWorkspaceIds(db) {
  const ids = new Set();
  for (const { table, column } of WORKSPACE_OWNED_COLUMNS) {
    if (!hasTable(db, table)) continue;
    for (const row of db.prepare(`SELECT DISTINCT ${column} AS id FROM ${table} WHERE ${column} IS NOT NULL AND ${column} NOT IN (SELECT id FROM chats)`).all()) {
      ids.add(row.id);
    }
  }
  const chatChunks = "SELECT DISTINCT ownerId AS id FROM knowledge_chunks WHERE ownerType IN ('chat_kb', 'chat_memory') AND ownerId NOT IN (SELECT id FROM chats)";
  for (const row of db.prepare(chatChunks).all()) ids.add(row.id);
  return [...ids];
}

module.exports = {
  WORKSPACE_OWNED_COLUMNS,
  WORKSPACE_OWNED_THROUGH,
  NOT_WORKSPACE_TABLES,
  orphanWorkspaceIds,
  purgeWorkspace
};
