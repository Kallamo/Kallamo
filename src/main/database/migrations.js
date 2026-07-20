const MIGRATIONS = [
  {
    id: 'kanora_narrative_event_ledger_v1',
    up: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS kanora_narrative_events (
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

      CREATE TABLE IF NOT EXISTS kanora_narrative_event_participants (
        workspace_id TEXT NOT NULL,
        event_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
        entity_id TEXT NOT NULL,
        role TEXT NOT NULL,
        PRIMARY KEY (workspace_id, event_id, ordinal),
        FOREIGN KEY (workspace_id, event_id)
          REFERENCES kanora_narrative_events (workspace_id, event_id)
          ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS kanora_narrative_event_evidence (
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
          REFERENCES kanora_narrative_events (workspace_id, event_id)
          ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_kanora_events_workspace_order
        ON kanora_narrative_events (workspace_id, narrative_sequence, event_id);

      CREATE INDEX IF NOT EXISTS idx_kanora_evidence_origin
        ON kanora_narrative_event_evidence (workspace_id, origin_type, origin_id);
    `)
  },
  {
    id: 'kanora_transactional_change_sets_v1',
    up: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS kanora_narrative_records (
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
          REFERENCES kanora_narrative_events (workspace_id, event_id)
          ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS kanora_change_set_attempts (
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
          REFERENCES kanora_narrative_events (workspace_id, event_id)
          ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_kanora_records_workspace_event
        ON kanora_narrative_records (workspace_id, source_event_id);

      CREATE INDEX IF NOT EXISTS idx_kanora_attempts_workspace_event
        ON kanora_change_set_attempts (workspace_id, event_id, attempted_at, attempt_id);
    `)
  },
  {
    id: 'kanora_scenes_and_individual_knowledge_v1',
    up: (db) => db.exec(`
      CREATE TABLE IF NOT EXISTS kanora_scenes (
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

      CREATE TABLE IF NOT EXISTS kanora_scene_participants (
        workspace_id TEXT NOT NULL,
        scene_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
        entity_id TEXT NOT NULL,
        PRIMARY KEY (workspace_id, scene_id, ordinal),
        UNIQUE (workspace_id, scene_id, entity_id),
        FOREIGN KEY (workspace_id, scene_id)
          REFERENCES kanora_scenes (workspace_id, scene_id)
          ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS kanora_scene_possible_observers (
        workspace_id TEXT NOT NULL,
        scene_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
        entity_id TEXT NOT NULL,
        PRIMARY KEY (workspace_id, scene_id, ordinal),
        UNIQUE (workspace_id, scene_id, entity_id),
        FOREIGN KEY (workspace_id, scene_id)
          REFERENCES kanora_scenes (workspace_id, scene_id)
          ON DELETE CASCADE
      );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_kanora_one_active_scene
        ON kanora_scenes (workspace_id) WHERE status = 'active';

      CREATE INDEX IF NOT EXISTS idx_kanora_scenes_workspace_order
        ON kanora_scenes (workspace_id, narrative_sequence, scene_id);

      CREATE INDEX IF NOT EXISTS idx_kanora_knowledge_subject
        ON kanora_narrative_records (workspace_id, subject_id, applied_at, record_id)
        WHERE record_type = 'knowledge';
    `)
  },
  {
    id: 'kanora_explicit_knowledge_accessibility_draft_v1',
    up: (db) => {
      const columns = db.prepare('PRAGMA table_info(kanora_narrative_records)').all();
      if (!columns.some(column => column.name === 'subject_id')) {
        db.exec('ALTER TABLE kanora_narrative_records ADD COLUMN subject_id TEXT');
      }
      db.exec(`
        UPDATE kanora_narrative_records
        SET subject_id = json_extract(payload_json, '$.subjectId')
        WHERE record_type = 'knowledge'
          AND subject_id IS NULL
          AND json_valid(payload_json);

        UPDATE kanora_narrative_records
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

        DROP INDEX IF EXISTS idx_kanora_knowledge_subject;

        CREATE INDEX idx_kanora_knowledge_subject
          ON kanora_narrative_records (workspace_id, subject_id, applied_at, record_id)
          WHERE record_type = 'knowledge';
      `);
    }
  },
  {
    id: 'kanora_beliefs_and_dynamic_relationships_v1',
    up: (db) => db.exec(`
      UPDATE kanora_narrative_records
      SET subject_id = json_extract(payload_json, '$.subjectId')
      WHERE record_type = 'belief'
        AND subject_id IS NULL
        AND json_valid(payload_json);

      UPDATE kanora_narrative_records
      SET subject_id = json_extract(payload_json, '$.sourceEntityId')
      WHERE record_type = 'relationship'
        AND subject_id IS NULL
        AND json_valid(payload_json);

      CREATE INDEX IF NOT EXISTS idx_kanora_belief_subject
        ON kanora_narrative_records (workspace_id, subject_id, applied_at, record_id)
        WHERE record_type = 'belief';

      CREATE INDEX IF NOT EXISTS idx_kanora_relationship_source
        ON kanora_narrative_records (workspace_id, subject_id, applied_at, record_id)
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
    up: (db) => {
      const columns = db.prepare('PRAGMA table_info(entity_links)').all();
      if (columns.length && !columns.some(column => column.name === 'metadata_json')) {
        db.exec('ALTER TABLE entity_links ADD COLUMN metadata_json TEXT');
      }
    }
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
  }
];

function runDatabaseMigrations(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL
    );
  `);

  const hasMigration = db.prepare('SELECT 1 FROM schema_migrations WHERE id = ?');
  const recordMigration = db.prepare('INSERT INTO schema_migrations (id, applied_at) VALUES (?, ?)');

  for (const migration of MIGRATIONS) {
    if (hasMigration.get(migration.id)) continue;
    db.transaction(() => {
      migration.up(db);
      recordMigration.run(migration.id, new Date().toISOString());
    })();
  }
}

module.exports = { MIGRATIONS, runDatabaseMigrations };
