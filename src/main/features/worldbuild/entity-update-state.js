const crypto = require('node:crypto');

function createEntityUpdateState(db) {
  const upsertEvidence = db.prepare(`
    INSERT INTO entity_update_evidence (
      workspace_id, entity_id, chunk_id, signature, state, strength,
      last_run_id, reason, discovered_at, evaluated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(workspace_id, entity_id, chunk_id) DO UPDATE SET
      signature = excluded.signature,
      state = CASE
        WHEN entity_update_evidence.signature != excluded.signature THEN 'discovered'
        ELSE entity_update_evidence.state
      END,
      strength = excluded.strength,
      reason = CASE
        WHEN entity_update_evidence.signature != excluded.signature THEN 'source-changed'
        ELSE entity_update_evidence.reason
      END,
      discovered_at = CASE
        WHEN entity_update_evidence.signature != excluded.signature THEN excluded.discovered_at
        ELSE entity_update_evidence.discovered_at
      END,
      evaluated_at = CASE
        WHEN entity_update_evidence.signature != excluded.signature THEN NULL
        ELSE entity_update_evidence.evaluated_at
      END
  `);
  const setEvidenceState = db.prepare(`
    UPDATE entity_update_evidence
    SET state = ?, last_run_id = ?, reason = ?, evaluated_at = ?
    WHERE workspace_id = ? AND entity_id = ? AND chunk_id = ?
  `);

  function startRun(workspaceId, entityIds) {
    const runId = `entity_update_${crypto.randomUUID()}`;
    const now = Date.now();
    db.transaction(() => {
      db.prepare(`
        INSERT INTO entity_update_runs (run_id, workspace_id, status, started_at)
        VALUES (?, ?, 'running', ?)
      `).run(runId, workspaceId, now);
      const insertJob = db.prepare(`
        INSERT INTO entity_update_jobs (run_id, entity_id, status, updated_at)
        VALUES (?, ?, 'queued', ?)
      `);
      for (const entityId of entityIds) insertJob.run(runId, entityId, now);
    })();
    return runId;
  }

  function discover(workspaceId, entityId, entries) {
    const now = Date.now();
    db.transaction(() => {
      for (const entry of entries) {
        upsertEvidence.run(
          workspaceId, entityId, entry.chunk.id, entry.signature, 'discovered',
          entry.chunk.isTagged ? 'tagged' : 'mention', null, null, now, null
        );
      }
    })();
    const rows = db.prepare(`
      SELECT chunk_id AS chunkId, signature, state
      FROM entity_update_evidence
      WHERE workspace_id = ? AND entity_id = ?
    `).all(workspaceId, entityId);
    return new Map(rows.map(row => [row.chunkId, row]));
  }

  function transition(workspaceId, entityId, entries, state, runId, reason = '') {
    const evaluatedAt = ['evaluated', 'actionable', 'non-actionable'].includes(state) ? Date.now() : null;
    db.transaction(() => {
      for (const entry of entries) {
        setEvidenceState.run(state, runId, reason, evaluatedAt, workspaceId, entityId, entry.chunk.id);
      }
    })();
  }

  function updateJob(runId, entityId, patch) {
    const allowed = ['status', 'input_tokens', 'output_tokens', 'retry_count', 'evidence_used', 'proposals_created', 'error'];
    const values = Object.entries(patch).filter(([key]) => allowed.includes(key));
    if (!values.length) return;
    db.prepare(`UPDATE entity_update_jobs SET ${values.map(([key]) => `${key} = ?`).join(', ')}, updated_at = ? WHERE run_id = ? AND entity_id = ?`)
      .run(...values.map(([, value]) => value), Date.now(), runId, entityId);
  }

  function finishRun(runId, status) {
    const totals = db.prepare(`
      SELECT COALESCE(SUM(input_tokens), 0) AS inputTokens,
        COALESCE(SUM(output_tokens), 0) AS outputTokens,
        COALESCE(SUM(evidence_used), 0) AS evidenceUsed,
        COALESCE(SUM(proposals_created), 0) AS proposalsCreated
      FROM entity_update_jobs WHERE run_id = ?
    `).get(runId);
    db.prepare(`
      UPDATE entity_update_runs SET status = ?, input_tokens = ?, output_tokens = ?,
        evidence_used = ?, proposals_created = ?, completed_at = ?
      WHERE run_id = ?
    `).run(status, totals.inputTokens, totals.outputTokens, totals.evidenceUsed, totals.proposalsCreated, Date.now(), runId);
    return totals;
  }

  return { startRun, discover, transition, updateJob, finishRun };
}

module.exports = { createEntityUpdateState };
