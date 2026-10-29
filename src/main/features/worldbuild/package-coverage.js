// What a Worldbuild package (.klwb) does with every table. A new table must be declared here, or
// the coverage test fails: a world part left out of export is a bug, not a default.

/** Travels in the package, through the module named in `by`. */
const PACKAGED = [
  { table: 'entities', by: 'sheets' },
  { table: 'entity_links', by: 'links, relationships, memberships, inventory' },
  { table: 'worldbuild_calendars', by: 'calendar' },
  { table: 'worldbuild_entity_images', by: 'images' },
  { table: 'roleplay_location_backgrounds', by: 'images' },
  { table: 'worldbuild_field_definitions', by: 'templates' },
  { table: 'worldbuild_entity_templates', by: 'templates' },
  { table: 'worldbuild_event_occurrences', by: 'occurrences the author recorded' },
  { table: 'worldbuild_knowledge_cards', by: 'authored Knowledge' },
  { table: 'worldbuild_knowledge_sources', by: 'authored Knowledge' },
  { table: 'worldbuild_known_fields', by: 'authored Knowledge' },
  { table: 'worldbuild_known_relationships', by: 'authored Knowledge' },
  { table: 'worldbuild_knowledge_audience_members', by: 'authored Knowledge' },
  { table: 'worldbuild_knowledge_exclusions', by: 'authored Knowledge' },
  { table: 'narrative_records', by: 'authored Knowledge, Facts and occurrences; play records stay' },
  { table: 'narrative_events', by: 'rebuilt with the authored records' },
  { table: 'narrative_event_participants', by: 'rebuilt with the authored records' },
  { table: 'narrative_event_evidence', by: 'rebuilt with the authored records' },
  { table: 'in_world_texts', by: 'texts written inside items' },
  { table: 'documents', by: 'texts inside items and background chapters only' },
  { table: 'folders', by: 'texts inside items and background chapters only' },
  { table: 'roleplay_resource_definitions', by: 'rules' },
  { table: 'roleplay_resource_values', by: 'rules; a character\'s current value only with current values' },
  { table: 'roleplay_progression_settings', by: 'rules' },
  { table: 'roleplay_progression_members', by: 'rules' },
  { table: 'roleplay_trait_definitions', by: 'rules' },
  { table: 'roleplay_progress_values', by: 'rules; a character\'s level and XP only with current values' },
  { table: 'roleplay_skills', by: 'rules' },
  { table: 'roleplay_skill_settings', by: 'rules' },
  { table: 'roleplay_skill_members', by: 'rules' },
  { table: 'roleplay_skill_values', by: 'rules' },
  { table: 'roleplay_time_matrices', by: 'rules' },
  { table: 'roleplay_equipment', by: 'what characters wear' },
  { table: 'roleplay_location_inventory', by: 'items lying in places' },
];

/** Stays in the workspace, with the reason the export dialog gives. */
const STAYS = [
  // The story as played.
  ...[
    'narrative_awareness_records', 'narrative_scenes', 'narrative_scene_participants', 'narrative_scene_possible_observers',
    'narrative_state_jobs', 'narrative_state_metrics', 'narrative_state_fingerprints', 'narrative_context_manifests',
    'narrative_change_set_attempts', 'narrative_operation_reviews', 'narrative_origin_lifecycle', 'narrative_turn_replacements',
    'roleplay_workspace_settings', 'roleplay_message_frames', 'roleplay_turn_presence', 'roleplay_turn_snapshots',
    'roleplay_time_state', 'roleplay_time_advances', 'roleplay_character_memory', 'roleplay_scene_changes',
    'roleplay_scene_nearby', 'roleplay_scene_objects', 'roleplay_entity_changes', 'roleplay_inventory_changes',
    'roleplay_resource_changes', 'roleplay_progress_changes', 'roleplay_skill_changes',
  ].map(table => ({ table, reason: 'play' })),
  // Review work in progress on this workspace.
  ...[
    'entity_enrichment_chunks', 'entity_enrichment_errors', 'entity_update_jobs', 'entity_update_runs',
    'entity_update_evidence', 'entity_redirects',
  ].map(table => ({ table, reason: 'review' })),
  // Not part of a world.
  ...[
    'chats', 'messages', 'api_profiles', 'writing_profiles', 'workflows', 'variables', 'settings', 'token_calibration',
    'knowledge_chunks', 'knowledge_chunks_fts', 'chunk_tags', 'chunk_tag_suppressions', 'constant_memory', 'tags',
    'world_index_chunk_status', 'world_index_runs', 'document_notes', 'document_analyses', 'pending_suggestions',
    'pinned_directives', 'workspace_ui_state', 'workspace_experience_modes', 'schema_migrations',
  ].map(table => ({ table, reason: 'not-world' })),
];

module.exports = { PACKAGED, STAYS };
