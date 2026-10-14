const { releaseOrphanedEntityReferences } = require('../features/worldbuild/entity-references');

/** Predicates that name a moment the live scene already carries, never durable canon. */
const SCENE_PREDICATE_LIST = [
  'current-location', 'current-position', 'current-place', 'current-activity',
  'current-action', 'current-scene', 'current-state', 'current-mood',
  'current-emotion', 'location', 'position', 'activity', 'whereabouts',
  'present-at', 'presence', 'located-at', 'is-at', 'emotional-state',
  'emotional-state-reported', 'mood', 'posture', 'stance'
].map(value => `'${value}'`).join(', ');

const hasTable = (db, name) => Boolean(
  db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name)
);

// Base tables come from database.js; these helpers stay no-ops until those exist.
function ensureEntityLinkMetadata(db) {
  const columns = db.prepare('PRAGMA table_info(entity_links)').all();
  if (columns.length && !columns.some(column => column.name === 'metadata_json')) {
    db.exec('ALTER TABLE entity_links ADD COLUMN metadata_json TEXT');
  }
}

function enforceItemPresence(db) {
  if (!hasTable(db, 'entities') || !hasTable(db, 'entity_links')) return;
  db.prepare(`
    UPDATE entity_links SET relType = 'carried_by'
    WHERE relType = 'owned_by'
      AND fromId IN (
        SELECT id FROM entities
        WHERE type = 'Items' AND COALESCE(json_extract(data, '$.itemNature'), 'type') != 'unique'
      )
  `).run();
  db.prepare(`
    UPDATE entity_links SET relType = 'located_in'
    WHERE relType = 'found_in'
      AND fromId IN (
        SELECT id FROM entities
        WHERE type = 'Items' AND json_extract(data, '$.itemNature') = 'unique'
      )
      AND fromId NOT IN (SELECT fromId FROM entity_links WHERE relType = 'owned_by')
      AND fromId IN (
        SELECT fromId FROM entity_links WHERE relType = 'found_in'
        GROUP BY fromId HAVING COUNT(*) = 1
      )
  `).run();
  db.prepare(`
    DELETE FROM entity_links
    WHERE relType = 'owned_by' AND rowid NOT IN (
      SELECT MAX(rowid) FROM entity_links WHERE relType = 'owned_by'
      GROUP BY workspaceId, fromId
    )
  `).run();
  db.prepare(`
    DELETE FROM entity_links
    WHERE relType = 'carried_by' AND rowid NOT IN (
      SELECT MAX(rowid) FROM entity_links WHERE relType = 'carried_by'
      GROUP BY workspaceId, fromId, toId
    )
  `).run();
  db.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_item_owner
      ON entity_links (workspaceId, fromId) WHERE relType = 'owned_by';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_item_location
      ON entity_links (workspaceId, fromId) WHERE relType = 'located_in';
    CREATE UNIQUE INDEX IF NOT EXISTS idx_item_type_inventory
      ON entity_links (workspaceId, fromId, toId) WHERE relType = 'carried_by';
  `);
}

function ensureEntityUpdateEvidenceTriggers(db) {
  if (!hasTable(db, 'entity_update_evidence')) return;
  if (hasTable(db, 'knowledge_chunks')) {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_entity_update_evidence_chunk_gc
      AFTER DELETE ON knowledge_chunks
      FOR EACH ROW BEGIN
        DELETE FROM entity_update_evidence WHERE chunk_id = OLD.id;
      END;
    `);
  }
  if (hasTable(db, 'entities')) {
    db.exec(`
      CREATE TRIGGER IF NOT EXISTS trg_entity_update_evidence_entity_gc
      AFTER DELETE ON entities
      FOR EACH ROW BEGIN
        DELETE FROM entity_update_evidence WHERE entity_id = OLD.id;
      END;
    `);
  }
}

const MIGRATIONS = [
  {
    id: 'narrative_event_ledger_v1',
    up: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS narrative_events (
        workspace_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        proposal_id TEXT NOT NULL,
        change_set_id TEXT NOT NULL,
        contract_version TEXT NOT NULL,
        event_type TEXT NOT NULL,
        description TEXT NOT NULL,
        scene_id TEXT,
        location_id TEXT,
        narrative_sequence INTEGER NOT NULL CHECK (narrative_sequence >= 0),
        narrative_timestamp TEXT,
        status TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'rejected')),
        version INTEGER NOT NULL CHECK (version > 0),
        operations_json TEXT NOT NULL,
        provenance_interpreter TEXT NOT NULL,
        provenance_interpreter_id TEXT,
        provenance_prompt_version TEXT,
        provenance_schema_version TEXT NOT NULL,
        provenance_created_at TEXT NOT NULL,
        decided_at TEXT,
        PRIMARY KEY (workspace_id, event_id),
        UNIQUE (workspace_id, proposal_id)
      );

      CREATE TABLE IF NOT EXISTS narrative_event_participants (
        workspace_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
        entity_id TEXT NOT NULL,
        role TEXT NOT NULL,
        PRIMARY KEY (workspace_id, event_id, ordinal),
        FOREIGN KEY (workspace_id, event_id)
          REFERENCES narrative_events (workspace_id, event_id)
          ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS narrative_event_evidence (
        workspace_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        evidence_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
        origin_type TEXT NOT NULL,
        origin_id TEXT NOT NULL,
        excerpt TEXT,
        PRIMARY KEY (workspace_id, event_id, evidence_id),
        UNIQUE (workspace_id, event_id, ordinal),
        FOREIGN KEY (workspace_id, event_id)
          REFERENCES narrative_events (workspace_id, event_id)
          ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_narrative_events_workspace_order
        ON narrative_events (workspace_id, narrative_sequence, event_id);

      CREATE INDEX IF NOT EXISTS idx_narrative_evidence_origin
        ON narrative_event_evidence (workspace_id, origin_type, origin_id);
    `)
  },
  {
    id: 'narrative_transactional_change_sets_v1',
    up: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS narrative_records (
        workspace_id TEXT NOT NULL,
        record_type TEXT NOT NULL CHECK (record_type IN (
          'fact', 'state', 'observation', 'knowledge', 'belief', 'memory', 'relationship'
        )),
        record_id TEXT NOT NULL,
        subject_id TEXT,
        source_event_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, record_type, record_id),
        UNIQUE (workspace_id, operation_id),
        FOREIGN KEY (workspace_id, source_event_id)
          REFERENCES narrative_events (workspace_id, event_id)
          ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS narrative_change_set_attempts (
        workspace_id TEXT NOT NULL,
        attempt_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        expected_version INTEGER NOT NULL CHECK (expected_version > 0),
        result TEXT NOT NULL CHECK (result IN ('applied', 'failed')),
        resulting_version INTEGER,
        failed_operation_id TEXT,
        error_code TEXT,
        error_message TEXT,
        attempted_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, attempt_id),
        FOREIGN KEY (workspace_id, event_id)
          REFERENCES narrative_events (workspace_id, event_id)
          ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_narrative_records_workspace_event
        ON narrative_records (workspace_id, source_event_id);

      CREATE INDEX IF NOT EXISTS idx_narrative_attempts_workspace_event
        ON narrative_change_set_attempts (workspace_id, event_id, attempted_at, attempt_id);
    `)
  },
  {
    id: 'narrative_scenes_and_individual_knowledge_v1',
    up: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS narrative_scenes (
        workspace_id TEXT NOT NULL,
        scene_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'completed')),
        location_id TEXT,
        perspective_access TEXT NOT NULL CHECK (perspective_access IN ('subjective', 'omniscient', 'explicit')),
        focal_subject_id TEXT,
        allowed_subject_ids_json TEXT,
        narrative_sequence INTEGER NOT NULL CHECK (narrative_sequence >= 0),
        narrative_timestamp TEXT,
        origin_type TEXT,
        origin_id TEXT,
        PRIMARY KEY (workspace_id, scene_id)
      );

      CREATE TABLE IF NOT EXISTS narrative_scene_participants (
        workspace_id TEXT NOT NULL,
        scene_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
        entity_id TEXT NOT NULL,
        PRIMARY KEY (workspace_id, scene_id, ordinal),
        UNIQUE (workspace_id, scene_id, entity_id),
        FOREIGN KEY (workspace_id, scene_id)
          REFERENCES narrative_scenes (workspace_id, scene_id)
          ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS narrative_scene_possible_observers (
        workspace_id TEXT NOT NULL,
        scene_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
        entity_id TEXT NOT NULL,
        PRIMARY KEY (workspace_id, scene_id, ordinal),
        UNIQUE (workspace_id, scene_id, entity_id),
        FOREIGN KEY (workspace_id, scene_id)
          REFERENCES narrative_scenes (workspace_id, scene_id)
          ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_narrative_one_active_scene
        ON narrative_scenes (workspace_id) WHERE status = 'active';

      CREATE INDEX IF NOT EXISTS idx_narrative_scenes_workspace_order
        ON narrative_scenes (workspace_id, narrative_sequence, scene_id);

      CREATE INDEX IF NOT EXISTS idx_narrative_knowledge_subject
        ON narrative_records (workspace_id, subject_id, applied_at, record_id)
        WHERE record_type = 'knowledge';
    `)
  },
  {
    id: 'narrative_explicit_knowledge_accessibility_draft_v1',
    up: (db) => {
      const columns = db.prepare('PRAGMA table_info(narrative_records)').all();
      if (!columns.some(column => column.name === 'subject_id')) {
        db.exec('ALTER TABLE narrative_records ADD COLUMN subject_id TEXT');
      }
      db.exec(`
        UPDATE narrative_records
        SET subject_id = json_extract(payload_json, '$.subjectId')
        WHERE record_type = 'knowledge'
          AND subject_id IS NULL
          AND json_valid(payload_json);

        UPDATE narrative_records
        SET payload_json = json_set(
          payload_json,
          '$.accessibility',
          CASE json_extract(payload_json, '$.status')
            WHEN 'active' THEN 'available'
            ELSE 'inaccessible'
          END
        )
        WHERE record_type = 'knowledge'
          AND json_valid(payload_json)
          AND json_type(payload_json, '$.accessibility') IS NULL;

        DROP INDEX IF EXISTS idx_narrative_knowledge_subject;

        CREATE INDEX idx_narrative_knowledge_subject
          ON narrative_records (workspace_id, subject_id, applied_at, record_id)
          WHERE record_type = 'knowledge';
      `);
    }
  },
  {
    id: 'narrative_beliefs_and_dynamic_relationships_v1',
    up: (db) => db.exec(`
      UPDATE narrative_records
      SET subject_id = json_extract(payload_json, '$.subjectId')
      WHERE record_type = 'belief'
        AND subject_id IS NULL
        AND json_valid(payload_json);

      UPDATE narrative_records
      SET subject_id = json_extract(payload_json, '$.sourceEntityId')
      WHERE record_type = 'relationship'
        AND subject_id IS NULL
        AND json_valid(payload_json);

      CREATE INDEX IF NOT EXISTS idx_narrative_belief_subject
        ON narrative_records (workspace_id, subject_id, applied_at, record_id)
        WHERE record_type = 'belief';

      CREATE INDEX IF NOT EXISTS idx_narrative_relationship_source
        ON narrative_records (workspace_id, subject_id, applied_at, record_id)
        WHERE record_type = 'relationship';
      `)
  },
  {
    id: 'worldbuild_custom_field_definitions_v1',
    up: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS worldbuild_field_definitions (
        workspace_id TEXT NOT NULL,
        field_id TEXT NOT NULL,
        type_id TEXT NOT NULL,
        field_key TEXT NOT NULL,
        label TEXT NOT NULL,
        value_type TEXT NOT NULL CHECK (value_type IN (
          'short-text', 'long-text', 'number', 'range', 'boolean',
          'single-choice', 'multiple-choice', 'entity-reference', 'entity-reference-list'
        )),
        options_json TEXT,
        constraints_json TEXT,
        default_value_json TEXT,
        has_default INTEGER NOT NULL CHECK (has_default IN (0, 1)),
        required INTEGER NOT NULL CHECK (required IN (0, 1)),
        position INTEGER NOT NULL CHECK (position >= 0),
        ai_access TEXT NOT NULL CHECK (ai_access IN ('read-write', 'read-only', 'hidden')),
        PRIMARY KEY (workspace_id, field_id),
        UNIQUE (workspace_id, type_id, field_key)
      );

      CREATE INDEX IF NOT EXISTS idx_worldbuild_fields_type_order
        ON worldbuild_field_definitions (workspace_id, type_id, position, field_id);
    `)
  },
  {
    id: 'worldbuild_rich_entity_links_v1',
    up: (db) => ensureEntityLinkMetadata(db)
  },
  {
    id: 'worldbuild_entity_templates_v1',
    up: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS worldbuild_entity_templates (
        workspace_id TEXT NOT NULL,
        type_id TEXT NOT NULL,
        display_name TEXT,
        layout_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, type_id)
      );
    `)
  },
  {
    id: 'worldbuild_field_ai_guidance_v1',
    up: (db) => {
      const columns = db.prepare('PRAGMA table_info(worldbuild_field_definitions)').all();
      if (columns.length && !columns.some(column => column.name === 'ai_guidance')) {
        db.exec('ALTER TABLE worldbuild_field_definitions ADD COLUMN ai_guidance TEXT');
      }
    }
  },
  {
    id: 'narrative_awareness_temporal_records_v1',
    up: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS narrative_awareness_records (
        workspace_id TEXT NOT NULL,
        awareness_id TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'forgotten', 'revoked', 'superseded')),
        source_event_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        applied_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, awareness_id),
        UNIQUE (workspace_id, operation_id),
        FOREIGN KEY (workspace_id, source_event_id)
          REFERENCES narrative_events (workspace_id, event_id)
      );
      CREATE INDEX IF NOT EXISTS idx_narrative_awareness_subject_target
        ON narrative_awareness_records (workspace_id, subject_id, target_id, applied_at);
      CREATE INDEX IF NOT EXISTS idx_narrative_awareness_target
        ON narrative_awareness_records (workspace_id, target_id, applied_at);
    `)
  },
  {
    id: 'kallamo_workspace_experience_mode_v1',
    up: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_experience_modes (
        workspace_id TEXT PRIMARY KEY,
        mode TEXT NOT NULL CHECK (mode IN ('standard', 'roleplay')),
        updated_at INTEGER NOT NULL
      );
    `)
  },
  {
    id: 'kallamo_roleplay_system_v1',
    up: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS roleplay_workspace_settings (
        workspace_id TEXT PRIMARY KEY,
        player_entity_id TEXT,
        location_entity_id TEXT,
        active_scene_id TEXT,
        scenario_name TEXT NOT NULL DEFAULT '',
        scenario_summary TEXT NOT NULL DEFAULT '',
        default_update_policy TEXT NOT NULL DEFAULT 'review'
          CHECK (default_update_policy IN ('manual', 'review', 'automatic')),
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS roleplay_resource_definitions (
        workspace_id TEXT NOT NULL,
        definition_id TEXT NOT NULL,
        resource_key TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        color TEXT NOT NULL,
        minimum REAL NOT NULL,
        maximum REAL NOT NULL,
        starts_full INTEGER NOT NULL DEFAULT 1 CHECK (starts_full IN (0, 1)),
        unit TEXT NOT NULL DEFAULT '',
        applies_to_json TEXT NOT NULL,
        update_policy TEXT NOT NULL CHECK (update_policy IN ('manual', 'review', 'automatic')),
        position INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, definition_id),
        UNIQUE (workspace_id, resource_key),
        CHECK (maximum > minimum)
      );

      CREATE TABLE IF NOT EXISTS roleplay_resource_values (
        workspace_id TEXT NOT NULL,
        definition_id TEXT NOT NULL,
        target_type TEXT NOT NULL CHECK (target_type IN ('entity', 'race', 'species')),
        target_id TEXT NOT NULL,
        current_value REAL,
        adjustment REAL NOT NULL DEFAULT 0,
        base_value REAL,
        growth_value REAL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, definition_id, target_type, target_id),
        FOREIGN KEY (workspace_id, definition_id)
          REFERENCES roleplay_resource_definitions (workspace_id, definition_id)
          ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS roleplay_resource_changes (
        workspace_id TEXT NOT NULL,
        change_id TEXT NOT NULL,
        definition_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        previous_value REAL NOT NULL,
        next_value REAL NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'applied', 'rejected')),
        source TEXT NOT NULL CHECK (source IN ('manual', 'ai')),
        provenance_id TEXT,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER,
        PRIMARY KEY (workspace_id, change_id),
        FOREIGN KEY (workspace_id, definition_id)
          REFERENCES roleplay_resource_definitions (workspace_id, definition_id)
      );

      CREATE INDEX IF NOT EXISTS idx_roleplay_values_target
        ON roleplay_resource_values (workspace_id, target_type, target_id);
      CREATE INDEX IF NOT EXISTS idx_roleplay_changes_entity
        ON roleplay_resource_changes (workspace_id, entity_id, created_at);
    `)
  },
  {
    id: 'kallamo_roleplay_scene_objects_v1',
    up: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS roleplay_scene_objects (
        workspace_id TEXT NOT NULL,
        scene_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, scene_id, entity_id),
        UNIQUE (workspace_id, scene_id, ordinal)
      );
      CREATE INDEX IF NOT EXISTS idx_roleplay_scene_objects
        ON roleplay_scene_objects (workspace_id, scene_id, ordinal);

      CREATE TABLE IF NOT EXISTS roleplay_scene_changes (
        workspace_id TEXT NOT NULL,
        change_id TEXT NOT NULL,
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'applied', 'rejected')),
        source TEXT NOT NULL CHECK (source IN ('manual', 'ai')),
        provenance_id TEXT,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER,
        PRIMARY KEY (workspace_id, change_id)
      );
      CREATE INDEX IF NOT EXISTS idx_roleplay_scene_changes_status
        ON roleplay_scene_changes (workspace_id, status, created_at);
    `)
  },
  {
    id: 'narrative_state_runtime_v1',
    up: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS narrative_state_jobs (
        workspace_id TEXT NOT NULL,
        origin_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'skipped')),
        event_fingerprint TEXT,
        deep_analysis INTEGER NOT NULL DEFAULT 0 CHECK (deep_analysis IN (0, 1)),
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        error_message TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, origin_id)
      );

      CREATE TABLE IF NOT EXISTS narrative_state_metrics (
        workspace_id TEXT NOT NULL,
        origin_id TEXT NOT NULL,
        triage_input_tokens INTEGER NOT NULL DEFAULT 0,
        triage_output_tokens INTEGER NOT NULL DEFAULT 0,
        deep_input_tokens INTEGER NOT NULL DEFAULT 0,
        deep_output_tokens INTEGER NOT NULL DEFAULT 0,
        deep_analysis INTEGER NOT NULL DEFAULT 0 CHECK (deep_analysis IN (0, 1)),
        proposal_count INTEGER NOT NULL DEFAULT 0,
        elapsed_ms INTEGER NOT NULL DEFAULT 0,
        recorded_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, origin_id)
      );

      CREATE TABLE IF NOT EXISTS narrative_state_fingerprints (
        workspace_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        origin_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, fingerprint),
        UNIQUE (workspace_id, event_id)
      );

      CREATE INDEX IF NOT EXISTS idx_narrative_state_jobs_status
        ON narrative_state_jobs (workspace_id, status, created_at);
      CREATE INDEX IF NOT EXISTS idx_narrative_state_metrics_time
        ON narrative_state_metrics (workspace_id, recorded_at);
    `)
  },
  {
    id: 'kallamo_item_presence_v1',
    up: (db) => db.transaction(() => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS roleplay_inventory_changes (
          workspace_id TEXT NOT NULL,
          change_id TEXT NOT NULL,
          payload_json TEXT NOT NULL,
          status TEXT NOT NULL CHECK (status IN ('pending', 'applied', 'rejected')),
          source TEXT NOT NULL CHECK (source IN ('manual', 'ai')),
          provenance_id TEXT,
          created_at INTEGER NOT NULL,
          resolved_at INTEGER,
          PRIMARY KEY (workspace_id, change_id)
        );
        CREATE INDEX IF NOT EXISTS idx_roleplay_inventory_changes_status
          ON roleplay_inventory_changes (workspace_id, status, created_at);
      `);
      enforceItemPresence(db);
    })()
  },
  {
    id: 'kallamo_narrative_entity_identity_v1',
    up: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS roleplay_entity_changes (
        workspace_id TEXT NOT NULL,
        change_id TEXT NOT NULL,
        entity_id TEXT,
        created_entity INTEGER NOT NULL DEFAULT 0 CHECK (created_entity IN (0, 1)),
        payload_json TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('pending', 'applied', 'rejected', 'conflicting')),
        provenance_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        resolved_at INTEGER,
        PRIMARY KEY (workspace_id, change_id)
      );

      CREATE INDEX IF NOT EXISTS idx_roleplay_entity_changes_status
        ON roleplay_entity_changes (workspace_id, status, created_at);
      CREATE UNIQUE INDEX IF NOT EXISTS idx_roleplay_entity_origin_reference
        ON roleplay_entity_changes (workspace_id, provenance_id, json_extract(payload_json, '$.referenceId'));

      CREATE TABLE IF NOT EXISTS narrative_origin_lifecycle (
        workspace_id TEXT NOT NULL,
        origin_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('active', 'superseded', 'deleted')),
        replacement_origin_id TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, origin_id)
      );

      CREATE INDEX IF NOT EXISTS idx_narrative_origin_lifecycle_status
        ON narrative_origin_lifecycle (workspace_id, status, updated_at);

      CREATE TABLE IF NOT EXISTS roleplay_turn_snapshots (
        workspace_id TEXT NOT NULL,
        origin_id TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, origin_id)
      );
    `)
  },
  {
    id: 'remove_legacy_dynamic_relationships_v1',
    up: (db) => db.transaction(() => {
      const hasEvents = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'narrative_events'").get();
      if (!hasEvents) return;
      const events = db.prepare(`
        SELECT workspace_id, event_id FROM narrative_events
        WHERE description LIKE 'Worldbuild relationship updated:%'
      `).all();
      if (!events.length) return;
      const removeEvent = db.prepare('DELETE FROM narrative_events WHERE workspace_id = ? AND event_id = ?');
      for (const event of events) removeEvent.run(event.workspace_id, event.event_id);
    })()
  },
  {
    id: 'entity_update_evidence_lifecycle_v1',
    up: (db) => {
      db.exec(`
      CREATE TABLE IF NOT EXISTS entity_update_runs (
        run_id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'partial', 'failed')),
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        evidence_used INTEGER NOT NULL DEFAULT 0,
        proposals_created INTEGER NOT NULL DEFAULT 0,
        started_at INTEGER NOT NULL,
        completed_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS entity_update_jobs (
        run_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'skipped')),
        input_tokens INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        retry_count INTEGER NOT NULL DEFAULT 0,
        evidence_used INTEGER NOT NULL DEFAULT 0,
        proposals_created INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (run_id, entity_id),
        FOREIGN KEY (run_id) REFERENCES entity_update_runs (run_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS entity_update_evidence (
        workspace_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        chunk_id TEXT NOT NULL,
        signature TEXT NOT NULL,
        state TEXT NOT NULL CHECK (state IN (
          'discovered', 'queued', 'deferred', 'evaluated', 'actionable',
          'non-actionable', 'superseded', 'invalidated'
        )),
        strength TEXT NOT NULL CHECK (strength IN ('tagged', 'mention')),
        last_run_id TEXT,
        reason TEXT,
        discovered_at INTEGER NOT NULL,
        evaluated_at INTEGER,
        PRIMARY KEY (workspace_id, entity_id, chunk_id)
      );

      CREATE INDEX IF NOT EXISTS idx_entity_update_evidence_queue
        ON entity_update_evidence (workspace_id, entity_id, state, discovered_at);
      CREATE INDEX IF NOT EXISTS idx_entity_update_jobs_status
        ON entity_update_jobs (run_id, status, updated_at);

      `);
      ensureEntityUpdateEvidenceTriggers(db);
    }
  },
  {
    id: 'worldbuild_awareness_knowledge_cards_v1',
    up: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS worldbuild_knowledge_cards (
        workspace_id TEXT NOT NULL,
        card_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        known_as TEXT,
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'forgotten', 'revoked', 'superseded')),
        audience_type TEXT NOT NULL DEFAULT 'all-members'
          CHECK (audience_type IN ('all-members', 'selected-members')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, card_id),
        UNIQUE (workspace_id, owner_id, target_id)
      );

      CREATE TABLE IF NOT EXISTS worldbuild_knowledge_sources (
        workspace_id TEXT NOT NULL,
        card_id TEXT NOT NULL,
        source_type TEXT NOT NULL CHECK (source_type IN (
          'manual', 'relationship', 'faction-membership', 'inventory',
          'memory', 'narrative', 'fact', 'statement', 'import'
        )),
        source_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, card_id, source_type, source_id),
        FOREIGN KEY (workspace_id, card_id)
          REFERENCES worldbuild_knowledge_cards (workspace_id, card_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS worldbuild_known_fields (
        workspace_id TEXT NOT NULL,
        card_id TEXT NOT NULL,
        field_key TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        audience_type TEXT NOT NULL DEFAULT 'inherit'
          CHECK (audience_type IN ('inherit', 'all-members', 'selected-members')),
        created_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, card_id, field_key),
        FOREIGN KEY (workspace_id, card_id)
          REFERENCES worldbuild_knowledge_cards (workspace_id, card_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS worldbuild_knowledge_audience_members (
        workspace_id TEXT NOT NULL,
        card_id TEXT NOT NULL,
        entry_type TEXT NOT NULL CHECK (entry_type IN ('card', 'field', 'knowledge', 'belief')),
        entry_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        PRIMARY KEY (workspace_id, card_id, entry_type, entry_id, member_id),
        FOREIGN KEY (workspace_id, card_id)
          REFERENCES worldbuild_knowledge_cards (workspace_id, card_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS worldbuild_knowledge_exclusions (
        workspace_id TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        target_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        source_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, owner_id, target_id, source_type, source_id)
      );

      CREATE INDEX IF NOT EXISTS idx_worldbuild_knowledge_owner
        ON worldbuild_knowledge_cards (workspace_id, owner_id, status);
      CREATE INDEX IF NOT EXISTS idx_worldbuild_knowledge_target
        ON worldbuild_knowledge_cards (workspace_id, target_id, status);
      CREATE INDEX IF NOT EXISTS idx_worldbuild_knowledge_source
        ON worldbuild_knowledge_sources (workspace_id, source_type, source_id);
      CREATE INDEX IF NOT EXISTS idx_worldbuild_knowledge_audience
        ON worldbuild_knowledge_audience_members (workspace_id, member_id, card_id);
    `)
  },
  {
    id: 'worldbuild_known_relationships_v1',
    up: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS worldbuild_known_relationships (
        workspace_id TEXT NOT NULL,
        card_id TEXT NOT NULL,
        relationship_id TEXT NOT NULL,
        from_id TEXT NOT NULL,
        from_name TEXT NOT NULL,
        relation_type TEXT NOT NULL,
        relation_label TEXT,
        to_id TEXT NOT NULL,
        to_name TEXT NOT NULL,
        metadata_json TEXT,
        source_type TEXT NOT NULL DEFAULT 'manual',
        source_id TEXT NOT NULL,
        audience_type TEXT NOT NULL DEFAULT 'inherit'
          CHECK (audience_type IN ('inherit', 'all-members', 'selected-members')),
        created_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, card_id, relationship_id),
        FOREIGN KEY (workspace_id, card_id)
          REFERENCES worldbuild_knowledge_cards (workspace_id, card_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_worldbuild_known_relationships_entities
        ON worldbuild_known_relationships (workspace_id, from_id, to_id);
      CREATE INDEX IF NOT EXISTS idx_worldbuild_known_relationships_card
        ON worldbuild_known_relationships (workspace_id, card_id, created_at);
    `)
  },
  {
    id: 'narrative_operation_review_v1',
    up: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS narrative_operation_reviews (
        workspace_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        operation_id TEXT NOT NULL,
        decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
        decided_at TEXT NOT NULL,
        PRIMARY KEY (workspace_id, event_id, operation_id),
        FOREIGN KEY (workspace_id, event_id)
          REFERENCES narrative_events (workspace_id, event_id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_narrative_operation_reviews_event
        ON narrative_operation_reviews (workspace_id, event_id, decision);
    `)
  },
  {
    id: 'kallamo_roleplay_quick_panel_v1',
    up: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS roleplay_scene_nearby (
        workspace_id TEXT NOT NULL,
        scene_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, scene_id, entity_id),
        UNIQUE (workspace_id, scene_id, ordinal)
      );

      CREATE TABLE IF NOT EXISTS roleplay_location_backgrounds (
        workspace_id TEXT NOT NULL,
        location_id TEXT NOT NULL,
        image_path TEXT NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, location_id)
      );

      CREATE TABLE IF NOT EXISTS roleplay_equipment (
        workspace_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        equipped_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, entity_id, item_id)
      );

      CREATE TABLE IF NOT EXISTS roleplay_location_inventory (
        workspace_id TEXT NOT NULL,
        location_id TEXT NOT NULL,
        item_id TEXT NOT NULL,
        quantity INTEGER NOT NULL CHECK (quantity > 0),
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, location_id, item_id)
      );

      CREATE INDEX IF NOT EXISTS idx_roleplay_nearby_scene
        ON roleplay_scene_nearby (workspace_id, scene_id, ordinal);
      CREATE INDEX IF NOT EXISTS idx_roleplay_equipment_entity
        ON roleplay_equipment (workspace_id, entity_id, equipped_at);
      CREATE INDEX IF NOT EXISTS idx_roleplay_location_inventory_location
        ON roleplay_location_inventory (workspace_id, location_id, item_id);
    `)
  },
  {
    id: 'narrative_context_manifest_v1',
    up: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS narrative_context_manifests (
        workspace_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        origin_id TEXT,
        narrative_sequence INTEGER NOT NULL,
        scene_id TEXT,
        player_subject_id TEXT,
        manifest_json TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'active'
          CHECK (status IN ('active', 'invalidated')),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, request_id),
        UNIQUE (workspace_id, origin_id)
      );

      CREATE INDEX IF NOT EXISTS idx_narrative_context_manifest_origin
        ON narrative_context_manifests (workspace_id, origin_id, status);
      CREATE INDEX IF NOT EXISTS idx_narrative_context_manifest_sequence
        ON narrative_context_manifests (workspace_id, narrative_sequence, created_at);
    `)
  },
  {
    id: 'kallamo_world_calendar_and_roleplay_time_v1',
    up: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS worldbuild_calendars (
        workspace_id TEXT PRIMARY KEY,
        definition_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS roleplay_time_state (
        workspace_id TEXT PRIMARY KEY,
        position_json TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS roleplay_time_matrices (
        workspace_id TEXT PRIMARY KEY,
        matrix_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS roleplay_time_advances (
        workspace_id TEXT NOT NULL,
        origin_id TEXT NOT NULL,
        start_json TEXT NOT NULL,
        end_json TEXT NOT NULL,
        advance_json TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, origin_id)
      );

      CREATE TABLE IF NOT EXISTS roleplay_message_frames (
        workspace_id TEXT NOT NULL,
        origin_id TEXT NOT NULL,
        start_json TEXT NOT NULL,
        end_json TEXT NOT NULL,
        advance_json TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, origin_id)
      );

      CREATE INDEX IF NOT EXISTS idx_roleplay_time_advances_created
        ON roleplay_time_advances (workspace_id, created_at);
      CREATE INDEX IF NOT EXISTS idx_roleplay_message_frames_created
        ON roleplay_message_frames (workspace_id, created_at);
    `)
  },
  {
    id: 'kallamo_worldbuild_event_occurrences_v1',
    up: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS worldbuild_event_occurrences (
        workspace_id TEXT NOT NULL,
        occurrence_id TEXT NOT NULL,
        event_entity_id TEXT NOT NULL,
        narrative_event_id TEXT NOT NULL,
        title TEXT NOT NULL,
        summary TEXT NOT NULL,
        start_date_json TEXT,
        end_date_json TEXT,
        participants_json TEXT NOT NULL DEFAULT '[]',
        location_ids_json TEXT NOT NULL DEFAULT '[]',
        related_entity_ids_json TEXT NOT NULL DEFAULT '[]',
        consequences_json TEXT NOT NULL DEFAULT '{}',
        source TEXT NOT NULL CHECK (source IN ('user', 'narrative-state')),
        origin_id TEXT,
        archived INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, occurrence_id),
        UNIQUE (workspace_id, narrative_event_id),
        FOREIGN KEY (workspace_id, narrative_event_id)
          REFERENCES narrative_events (workspace_id, event_id)
          ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_worldbuild_occurrences_event
        ON worldbuild_event_occurrences (workspace_id, event_entity_id, archived, created_at);
      CREATE INDEX IF NOT EXISTS idx_worldbuild_occurrences_origin
        ON worldbuild_event_occurrences (workspace_id, origin_id);
    `)
  },
  {
    /**
     * Retires model-written scene-state records filed as canon. Only their status changes: rows,
     * events and evidence stay.
     */
    id: 'narrative_record_categories_v1',
    up: (db) => {
      const hasEvents = db.prepare(
        "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'narrative_events'"
      ).get();
      if (!hasEvents) return;
      const scenePredicates = `(${SCENE_PREDICATE_LIST})`;
      const retire = (recordTypes, status) => db.prepare(`
        UPDATE narrative_records
        SET payload_json = json_set(payload_json, '$.status', ?)
        WHERE record_type IN (${recordTypes.map(() => '?').join(', ')})
          AND json_valid(payload_json)
          AND COALESCE(json_extract(payload_json, '$.status'), 'active') = 'active'
          AND lower(replace(
            COALESCE(json_extract(payload_json, '$.proposition.predicate'), ''), '_', '-'
          )) IN ${scenePredicates}
          AND source_event_id IN (
            SELECT event_id FROM narrative_events
            WHERE workspace_id = narrative_records.workspace_id
              AND provenance_interpreter = 'model'
          )
      `).run(status, ...recordTypes);
      retire(['fact'], 'retracted');
      retire(['knowledge', 'belief'], 'superseded');
    }
  },
  {
    // A fresh install could record these steps before the base tables existed, without applying them.
    id: 'worldbuild_base_schema_repair_v1',
    up: (db) => {
      ensureEntityLinkMetadata(db);
      enforceItemPresence(db);
      ensureEntityUpdateEvidenceTriggers(db);
    }
  },
  {
    // A regenerated or edited turn is superseded before its replacement is generated;
    // the restore point brings it back if that generation never completes.
    id: 'narrative_turn_replacements_v1',
    up: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS narrative_turn_replacements (
        workspace_id TEXT NOT NULL,
        replacement_id TEXT NOT NULL,
        origin_ids_json TEXT NOT NULL,
        restore_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, replacement_id)
      );
    `)
  },
  {
    // A merged entity's old id, so a write that was already under way still lands on the survivor.
    id: 'entity_redirects_v1',
    up: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS entity_redirects (
        workspace_id TEXT NOT NULL,
        from_id TEXT NOT NULL,
        to_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, from_id)
      );
    `)
  },
  {
    // Releases narrative and roleplay rows that still point at merged or deleted entities.
    id: 'entity_reference_orphans_v1',
    up: (db) => { releaseOrphanedEntityReferences(db); }
  },
  {
    // Portraits live in their own table, never in entity data, so a file path cannot reach
    // the prompt or an export. Backgrounds gain a framing point.
    id: 'worldbuild_entity_images_v1',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS worldbuild_entity_images (
          workspace_id TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          kind TEXT NOT NULL,
          image_path TEXT NOT NULL,
          focus TEXT,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (workspace_id, entity_id, kind)
        );
      `);
      const columns = db.prepare('PRAGMA table_info(roleplay_location_backgrounds)').all().map(column => column.name);
      if (columns.length && !columns.includes('focus')) db.exec('ALTER TABLE roleplay_location_backgrounds ADD COLUMN focus TEXT');
    }
  },
  {
    // A Writing Desk result keeps what it cost and what it read, for the token and retrieval readouts.
    id: 'writing_desk_invocation_debug_v1',
    up: (db) => {
      for (const table of ['pending_suggestions', 'document_notes']) {
        const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name);
        if (columns.length && !columns.includes('debug')) db.exec(`ALTER TABLE ${table} ADD COLUMN debug TEXT`);
      }
    }
  },
  {
    // Analyze results are their own history per chapter; a writer copies one into Notes on purpose.
    id: 'writing_desk_analyses_v1',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS document_analyses (
          id TEXT PRIMARY KEY,
          documentId TEXT NOT NULL,
          workspaceId TEXT NOT NULL,
          body TEXT NOT NULL,
          excerpt TEXT,
          profileId TEXT,
          instruction TEXT,
          status TEXT NOT NULL DEFAULT 'ok',
          debug TEXT,
          notedAt INTEGER,
          createdAt INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_document_analyses_document ON document_analyses(documentId, createdAt);
      `);
    }
  },
  {
    // A resource can belong to chosen characters only, say what happens at its lowest, move
    // with story time and grow with level. Its changes carry the amount and a reason, and progression (levels, XP,
    // attributes) gets its own definitions, values and history.
    id: 'kallamo_roleplay_progression_v1',
    up: (db) => {
      if (!hasTable(db, 'roleplay_resource_definitions')) return;
      const columns = db.prepare('PRAGMA table_info(roleplay_resource_definitions)').all().map(column => column.name);
      const add = (name, sql) => { if (!columns.includes(name)) db.exec(`ALTER TABLE roleplay_resource_definitions ADD COLUMN ${sql}`); };
      add('scope', "scope TEXT NOT NULL DEFAULT 'everyone' CHECK (scope IN ('everyone', 'chosen'))");
      add('lowest_effect', "lowest_effect TEXT NOT NULL DEFAULT ''");
      add('time_rate', 'time_rate REAL NOT NULL DEFAULT 0 CHECK (time_rate >= 0)');
      add('time_direction', "time_direction TEXT NOT NULL DEFAULT 'recovers' CHECK (time_direction IN ('recovers', 'drains'))");
      add('time_period', "time_period TEXT NOT NULL DEFAULT 'hour' CHECK (time_period IN ('hour', 'day'))");
      add('growth_per_level', 'growth_per_level REAL NOT NULL DEFAULT 0');
      add('refill_on_level_up', 'refill_on_level_up INTEGER NOT NULL DEFAULT 0 CHECK (refill_on_level_up IN (0, 1))');
      add('ai_changes_maximum', 'ai_changes_maximum INTEGER NOT NULL DEFAULT 0 CHECK (ai_changes_maximum IN (0, 1))');
      add('maximum_rule', "maximum_rule TEXT NOT NULL DEFAULT ''");

      db.exec(`
        CREATE TABLE roleplay_resource_changes_next (
          workspace_id TEXT NOT NULL,
          change_id TEXT NOT NULL,
          definition_id TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          previous_value REAL NOT NULL,
          next_value REAL NOT NULL,
          delta REAL,
          maximum_delta REAL NOT NULL DEFAULT 0,
          reason TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL CHECK (status IN ('pending', 'applied', 'rejected')),
          source TEXT NOT NULL CHECK (source IN ('manual', 'ai', 'time', 'level')),
          provenance_id TEXT,
          created_at INTEGER NOT NULL,
          resolved_at INTEGER,
          PRIMARY KEY (workspace_id, change_id),
          FOREIGN KEY (workspace_id, definition_id)
            REFERENCES roleplay_resource_definitions (workspace_id, definition_id)
        );
        INSERT INTO roleplay_resource_changes_next (
          workspace_id, change_id, definition_id, entity_id, previous_value, next_value, delta,
          status, source, provenance_id, created_at, resolved_at
        )
        SELECT workspace_id, change_id, definition_id, entity_id, previous_value, next_value,
          next_value - previous_value, status, source, provenance_id, created_at, resolved_at
        FROM roleplay_resource_changes;
        DROP TABLE roleplay_resource_changes;
        ALTER TABLE roleplay_resource_changes_next RENAME TO roleplay_resource_changes;
        CREATE INDEX IF NOT EXISTS idx_roleplay_changes_entity
          ON roleplay_resource_changes (workspace_id, entity_id, created_at);

        CREATE TABLE IF NOT EXISTS roleplay_progression_settings (
          workspace_id TEXT PRIMARY KEY,
          mode TEXT NOT NULL DEFAULT 'off' CHECK (mode IN ('off', 'levels')),
          config_json TEXT NOT NULL DEFAULT '{}',
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS roleplay_progression_members (
          workspace_id TEXT NOT NULL,
          target_type TEXT NOT NULL CHECK (target_type IN ('everyone', 'entity', 'race', 'species', 'type')),
          target_id TEXT NOT NULL DEFAULT '',
          added_at INTEGER NOT NULL,
          PRIMARY KEY (workspace_id, target_type, target_id)
        );

        CREATE TABLE IF NOT EXISTS roleplay_trait_definitions (
          workspace_id TEXT NOT NULL,
          trait_id TEXT NOT NULL,
          trait_key TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          initial_value REAL NOT NULL DEFAULT 0,
          minimum REAL NOT NULL DEFAULT 0,
          maximum REAL NOT NULL DEFAULT 20,
          position INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (workspace_id, trait_id),
          UNIQUE (workspace_id, trait_key)
        );

        CREATE TABLE IF NOT EXISTS roleplay_progress_values (
          workspace_id TEXT NOT NULL,
          target_type TEXT NOT NULL CHECK (target_type IN ('entity', 'race', 'species')),
          target_id TEXT NOT NULL,
          trait_id TEXT NOT NULL,
          value REAL NOT NULL,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (workspace_id, target_type, target_id, trait_id)
        );

        CREATE TABLE IF NOT EXISTS roleplay_progress_changes (
          workspace_id TEXT NOT NULL,
          change_id TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('xp', 'level', 'attribute')),
          trait_id TEXT,
          delta REAL NOT NULL,
          previous_value REAL NOT NULL,
          next_value REAL NOT NULL,
          reason TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL CHECK (status IN ('pending', 'applied', 'rejected')),
          source TEXT NOT NULL CHECK (source IN ('manual', 'ai', 'level')),
          provenance_id TEXT,
          created_at INTEGER NOT NULL,
          resolved_at INTEGER,
          PRIMARY KEY (workspace_id, change_id)
        );
        CREATE INDEX IF NOT EXISTS idx_roleplay_progress_changes_entity
          ON roleplay_progress_changes (workspace_id, entity_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_roleplay_progress_values_target
          ON roleplay_progress_values (workspace_id, target_type, target_id);
      `);
    }
  },
  {
    // Skills are held by characters at a rank from the world's ladder, apart from progression.
    // A sub-skill names its parent; a skill the AI proposed waits as 'proposed' until confirmed.
    id: 'kallamo_roleplay_skills_v1',
    up: (db) => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS roleplay_skill_settings (
          workspace_id TEXT PRIMARY KEY,
          enabled INTEGER NOT NULL DEFAULT 0,
          config_json TEXT NOT NULL DEFAULT '{}',
          updated_at INTEGER NOT NULL
        );

        CREATE TABLE IF NOT EXISTS roleplay_skill_members (
          workspace_id TEXT NOT NULL,
          target_type TEXT NOT NULL CHECK (target_type IN ('everyone', 'entity', 'race', 'species', 'type')),
          target_id TEXT NOT NULL DEFAULT '',
          added_at INTEGER NOT NULL,
          PRIMARY KEY (workspace_id, target_type, target_id)
        );

        CREATE TABLE IF NOT EXISTS roleplay_skills (
          workspace_id TEXT NOT NULL,
          skill_id TEXT NOT NULL,
          skill_key TEXT NOT NULL,
          name TEXT NOT NULL,
          description TEXT NOT NULL DEFAULT '',
          parent_id TEXT,
          status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed', 'proposed')),
          position INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (workspace_id, skill_id),
          UNIQUE (workspace_id, skill_key)
        );

        CREATE TABLE IF NOT EXISTS roleplay_skill_values (
          workspace_id TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          skill_id TEXT NOT NULL,
          rank INTEGER NOT NULL DEFAULT 0,
          updated_at INTEGER NOT NULL,
          PRIMARY KEY (workspace_id, entity_id, skill_id)
        );

        CREATE TABLE IF NOT EXISTS roleplay_skill_changes (
          workspace_id TEXT NOT NULL,
          change_id TEXT NOT NULL,
          entity_id TEXT NOT NULL,
          skill_id TEXT NOT NULL,
          kind TEXT NOT NULL CHECK (kind IN ('assign', 'rank', 'remove', 'create')),
          previous_rank INTEGER,
          next_rank INTEGER,
          reason TEXT NOT NULL DEFAULT '',
          status TEXT NOT NULL CHECK (status IN ('pending', 'applied', 'rejected')),
          source TEXT NOT NULL CHECK (source IN ('manual', 'ai')),
          provenance_id TEXT,
          created_at INTEGER NOT NULL,
          resolved_at INTEGER,
          PRIMARY KEY (workspace_id, change_id)
        );
        CREATE INDEX IF NOT EXISTS idx_roleplay_skill_changes_entity
          ON roleplay_skill_changes (workspace_id, entity_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_roleplay_skill_values_entity
          ON roleplay_skill_values (workspace_id, entity_id);
      `);
    }
  },
  {
    // Rebuilds every key from its name: a renamed rule could keep a key that matched another rule on import.
    id: 'kallamo_roleplay_rule_keys_v1',
    up: (db) => {
      const slug = name => String(name || '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
        .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
      const tables = [
        { table: 'roleplay_trait_definitions', id: 'trait_id', key: 'trait_key', prefix: 'trait' },
        { table: 'roleplay_skills', id: 'skill_id', key: 'skill_key', prefix: 'skill' },
        { table: 'roleplay_resource_definitions', id: 'definition_id', key: 'resource_key', prefix: 'resource' }
      ];
      for (const spec of tables) {
        if (!hasTable(db, spec.table)) continue;
        const rows = db.prepare(`SELECT workspace_id, ${spec.id} AS id, ${spec.key} AS key, name FROM ${spec.table} ORDER BY workspace_id, rowid`).all();
        const byWorkspace = new Map();
        for (const row of rows) {
          if (!byWorkspace.has(row.workspace_id)) byWorkspace.set(row.workspace_id, []);
          byWorkspace.get(row.workspace_id).push(row);
        }
        const update = db.prepare(`UPDATE ${spec.table} SET ${spec.key} = ? WHERE workspace_id = ? AND ${spec.id} = ?`);
        for (const [workspaceId, list] of byWorkspace) {
          const wanted = list.map(row => {
            let base = slug(row.name) || row.key;
            if (!/^[a-z][a-z0-9_-]*$/.test(base)) base = `${spec.prefix}-${base}`;
            return { row, base };
          });
          // Rows already right keep their key; the rest take theirs in order, numbered on a clash.
          const taken = new Set(wanted.filter(item => item.base === item.row.key).map(item => item.row.key));
          const moves = [];
          for (const item of wanted) {
            if (item.base === item.row.key) continue;
            let key = item.base;
            for (let suffix = 2; taken.has(key); suffix += 1) key = `${item.base}-${suffix}`;
            if (key === item.row.key) { taken.add(key); continue; }
            taken.add(key);
            moves.push({ id: item.row.id, key });
          }
          // A free placeholder first, so two rows can trade keys without breaking uniqueness.
          moves.forEach(move => update.run(`__moving-${move.id}`, workspaceId, move.id));
          moves.forEach(move => update.run(move.key, workspaceId, move.id));
        }
      }
    }
  },
  {
    // A specific being takes its nature from its species. A nature the species already states
    // is dropped; anything else is prepended to its abilities.
    id: 'kallamo_creature_nature_on_species_v1',
    up: (db) => {
      if (!hasTable(db, 'entities')) return;
      const parse = text => { try { const value = JSON.parse(text || '{}'); return value && typeof value === 'object' ? value : {}; } catch { return {}; } };
      const speciesOf = hasTable(db, 'entity_links') ? db.prepare(`
        SELECT species.data FROM entity_links AS links
        JOIN entities AS species ON species.id = links.toId
        WHERE links.fromId = ? AND links.relType = 'is_race' AND species.type = 'Creatures' LIMIT 1
      `) : null;
      const update = db.prepare('UPDATE entities SET data = ? WHERE id = ?');
      for (const row of db.prepare("SELECT id, data FROM entities WHERE type = 'Creatures'").all()) {
        const data = parse(row.data);
        const nature = String(data.nature || '').trim();
        if (data.scope === 'group' || !nature) continue;
        const speciesNature = String(parse(speciesOf?.get(row.id)?.data).nature || '').trim();
        const abilities = String(data.abilities || '').trim();
        const { nature: _nature, ...rest } = data;
        if (nature.toLowerCase() !== speciesNature.toLowerCase() && !abilities.toLowerCase().includes(nature.toLowerCase())) {
          rest.abilities = abilities ? `${nature}. ${abilities}` : nature;
        }
        update.run(JSON.stringify(rest), row.id);
      }
    }
  },
  {
    // Rows are keyed by the reply that produced them and read through narrative_origin_lifecycle,
    // so a replaced or deleted reply drops out without a snapshot.
    id: 'roleplay_character_scene_memory_v1',
    up: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS roleplay_turn_presence (
        workspace_id TEXT NOT NULL,
        origin_id TEXT NOT NULL,
        location_id TEXT,
        present_ids_json TEXT NOT NULL,
        time_label TEXT,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, origin_id)
      );
      CREATE INDEX IF NOT EXISTS idx_roleplay_turn_presence_order
        ON roleplay_turn_presence (workspace_id, created_at);

      CREATE TABLE IF NOT EXISTS roleplay_character_memory (
        workspace_id TEXT NOT NULL,
        entry_id TEXT NOT NULL,
        entity_id TEXT NOT NULL,
        origin_id TEXT NOT NULL,
        kind TEXT NOT NULL CHECK (kind IN ('perceived', 'heard', 'stance')),
        text TEXT NOT NULL,
        source_id TEXT,
        ordinal INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (workspace_id, entry_id)
      );
      CREATE INDEX IF NOT EXISTS idx_roleplay_character_memory_entity
        ON roleplay_character_memory (workspace_id, entity_id, created_at, ordinal);
      CREATE INDEX IF NOT EXISTS idx_roleplay_character_memory_origin
        ON roleplay_character_memory (workspace_id, origin_id);
    `)
  }
];

function runDatabaseMigrations(db, migrations = MIGRATIONS) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const hasMigration = db.prepare('SELECT 1 FROM schema_migrations WHERE id = ?');
  const recordMigration = db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');

  for (const migration of migrations) {
    if (hasMigration.get(migration.id)) continue;
    try {
      db.transaction(() => {
        migration.up(db);
        recordMigration.run(migration.id, new Date().toISOString());
      })();
    } catch (error) {
      const failure = new Error(`Migration ${migration.id} failed: ${error.message}`, { cause: error });
      failure.migrationId = migration.id;
      throw failure;
    }
  }
}

module.exports = { MIGRATIONS, runDatabaseMigrations };
