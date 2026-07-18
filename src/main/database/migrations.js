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
