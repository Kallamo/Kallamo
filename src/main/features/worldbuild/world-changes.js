// Recent changes to a world's entities, newest first, for the Worldbuild overview. Story events and
// resources stay out: the Narrative State panel already lists them.
const crypto = require('crypto');
const SEEDED_BY = require('../../../shared/seed-provenance.json');

// Edits to one sheet this close together read as one edit.
const EDIT_WINDOW_MS = 10 * 60 * 1000;
// Sheet settings and bookkeeping, not content.
const IGNORED_DATA_KEYS = new Set(['spoilers', 'aiPolicy', 'nameReviewDismissed', 'loreDocumentIds', 'proposalEvidence', 'narrativeOrigin', 'needsEnrichment', 'alwaysInContext']);

function hasTable(db, name) {
  return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));
}

function parseJson(text, fallback) {
  try { return JSON.parse(text); } catch { return fallback; }
}

/** The parts of a sheet that differ between two stored entities: name, aliases, lore and data keys. */
function editedParts(before, after) {
  if (!before || !after) return [];
  const parts = [];
  if (before.canonicalName !== after.canonicalName) parts.push('canonicalName');
  if (JSON.stringify(before.aliases || []) !== JSON.stringify(after.aliases || [])) parts.push('aliases');
  if ((before.lore || '') !== (after.lore || '')) parts.push('lore');
  const was = before.data || {};
  const now = after.data || {};
  for (const key of new Set([...Object.keys(was), ...Object.keys(now)])) {
    if (key.startsWith('_') || IGNORED_DATA_KEYS.has(key)) continue;
    if (key === 'customFields') {
      const wasCustom = was.customFields || {};
      const nowCustom = now.customFields || {};
      for (const custom of new Set([...Object.keys(wasCustom), ...Object.keys(nowCustom)])) {
        if (JSON.stringify(wasCustom[custom]) !== JSON.stringify(nowCustom[custom])) parts.push(`customFields.${custom}`);
      }
    } else if (JSON.stringify(was[key]) !== JSON.stringify(now[key])) parts.push(key);
  }
  return parts;
}

function recordSheetEdit(db, { workspaceId, entityId, parts, now = Date.now() }) {
  if (!workspaceId || !entityId || !parts?.length || !hasTable(db, 'entity_sheet_edits')) return;
  const latest = db.prepare(`
    SELECT edit_id, fields_json, created_at FROM entity_sheet_edits
    WHERE workspace_id = ? AND entity_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(workspaceId, entityId);
  if (latest && now - Number(latest.created_at) < EDIT_WINDOW_MS) {
    const merged = [...new Set([...parseJson(latest.fields_json, []), ...parts])];
    db.prepare('UPDATE entity_sheet_edits SET fields_json = ?, created_at = ? WHERE workspace_id = ? AND edit_id = ?')
      .run(JSON.stringify(merged), now, workspaceId, latest.edit_id);
    return;
  }
  db.prepare('INSERT INTO entity_sheet_edits (workspace_id, edit_id, entity_id, fields_json, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(workspaceId, crypto.randomUUID(), entityId, JSON.stringify(parts), now);
}

/**
 * Each row: { id, kind, entityId, status, source: 'turn' | 'you' | 'ai', turnNumber, createdAt, detail }.
 * kind is inventory, skill, progress, entity (from a story turn), edit (by the person) or update (Update entities).
 */
function listWorldChanges(db, workspaceId, { limit = 8 } = {}) {
  const take = Math.max(1, Math.min(50, Number(limit) || 8));
  const has = table => hasTable(db, table);
  const rows = [];
  // A turn that was replaced or deleted takes its changes with it.
  const activeOrigin = alias => `NOT EXISTS (
    SELECT 1 FROM narrative_origin_lifecycle lifecycle
    WHERE lifecycle.workspace_id = ${alias}.workspace_id AND lifecycle.origin_id = ${alias}.provenance_id AND lifecycle.status != 'active'
  )`;
  const lifecycle = has('narrative_origin_lifecycle');
  const storyFilter = alias => `${alias}.status != 'rejected' AND COALESCE(${alias}.provenance_id, '') != ?${lifecycle ? ` AND ${activeOrigin(alias)}` : ''}`;
  const source = (value) => (value === 'manual' ? 'you' : 'turn');

  if (has('roleplay_inventory_changes')) {
    for (const row of db.prepare(`
      SELECT * FROM roleplay_inventory_changes c WHERE c.workspace_id = ? AND ${storyFilter('c')}
      ORDER BY c.created_at DESC LIMIT ?
    `).all(workspaceId, SEEDED_BY.provenanceId, take)) {
      const patch = parseJson(row.payload_json, {});
      rows.push({ id: row.change_id, kind: 'inventory', entityId: patch.itemId || null, status: row.status, source: source(row.source), provenanceId: row.provenance_id, createdAt: Number(row.created_at), detail: { patch } });
    }
  }
  if (has('roleplay_skill_changes')) {
    for (const row of db.prepare(`
      SELECT * FROM roleplay_skill_changes c WHERE c.workspace_id = ? AND ${storyFilter('c')}
      ORDER BY c.created_at DESC LIMIT ?
    `).all(workspaceId, SEEDED_BY.provenanceId, take)) {
      rows.push({ id: row.change_id, kind: 'skill', entityId: row.entity_id, status: row.status, source: source(row.source), provenanceId: row.provenance_id, createdAt: Number(row.created_at),
        detail: { skillKind: row.kind, skillId: row.skill_id, previousRank: row.previous_rank, nextRank: row.next_rank } });
    }
  }
  if (has('roleplay_progress_changes')) {
    for (const row of db.prepare(`
      SELECT * FROM roleplay_progress_changes c WHERE c.workspace_id = ? AND ${storyFilter('c')}
      ORDER BY c.created_at DESC LIMIT ?
    `).all(workspaceId, SEEDED_BY.provenanceId, take)) {
      rows.push({ id: row.change_id, kind: 'progress', entityId: row.entity_id, status: row.status, source: row.source === 'manual' ? 'you' : 'turn', provenanceId: row.provenance_id, createdAt: Number(row.created_at),
        detail: { progressKind: row.kind, traitId: row.trait_id, delta: row.delta, previousValue: row.previous_value, nextValue: row.next_value } });
    }
  }
  if (has('roleplay_entity_changes')) {
    for (const row of db.prepare(`
      SELECT * FROM roleplay_entity_changes c WHERE c.workspace_id = ? AND ${storyFilter('c')}
      ORDER BY c.created_at DESC LIMIT ?
    `).all(workspaceId, SEEDED_BY.provenanceId, take)) {
      const payload = parseJson(row.payload_json, {});
      rows.push({ id: row.change_id, kind: 'entity', entityId: row.entity_id || payload.identityUpdate?.entityId || null, status: row.status === 'conflicting' ? 'pending' : row.status, source: 'turn', provenanceId: row.provenance_id, createdAt: Number(row.created_at),
        detail: { createdEntity: Boolean(row.created_entity), type: payload.type || null, name: payload.name || null, identityUpdate: payload.changeKind === 'identity-update' ? payload.identityUpdate || null : null } });
    }
  }
  if (has('entity_sheet_edits')) {
    for (const row of db.prepare(`
      SELECT * FROM entity_sheet_edits WHERE workspace_id = ? ORDER BY created_at DESC LIMIT ?
    `).all(workspaceId, take)) {
      rows.push({ id: row.edit_id, kind: 'edit', entityId: row.entity_id, status: 'applied', source: 'you', provenanceId: null, createdAt: Number(row.created_at), detail: { parts: parseJson(row.fields_json, []) } });
    }
  }
  if (has('entity_update_origins')) {
    // One accept or one automatic update writes its rows together, so they share a time.
    const groups = db.prepare(`
      SELECT entity_id, created_at, GROUP_CONCAT(kind || ':' || target, char(31)) AS parts
      FROM entity_update_origins WHERE workspace_id = ?
      GROUP BY entity_id, created_at ORDER BY created_at DESC LIMIT ?
    `).all(workspaceId, take);
    for (const group of groups) {
      const parts = String(group.parts || '').split('\u001f').filter(Boolean);
      const fields = [...new Set(parts.filter(part => !part.startsWith('link:')).map(part => part.slice(part.indexOf(':') + 1)))];
      const links = parts.filter(part => part.startsWith('link:')).length;
      rows.push({ id: `update:${group.entity_id}:${group.created_at}`, kind: 'update', entityId: group.entity_id, status: 'applied', source: 'ai', provenanceId: null, createdAt: Number(group.created_at), detail: { parts: fields, links } });
    }
  }

  const recent = rows
    .filter(row => row.entityId)
    .sort((left, right) => right.createdAt - left.createdAt)
    .slice(0, take);
  const turnNumbers = turnNumbersFor(db, workspaceId, recent.map(row => row.provenanceId).filter(Boolean));
  return recent.map(({ provenanceId, ...row }) => ({ ...row, turnNumber: row.source === 'turn' ? turnNumbers.get(provenanceId) ?? null : null }));
}

// A turn's number is its place among the workspace's message frames, as the Roleplay panel counts them.
function turnNumbersFor(db, workspaceId, originIds) {
  const numbers = new Map();
  if (!originIds.length || !hasTable(db, 'roleplay_message_frames')) return numbers;
  const wanted = new Set(originIds);
  const frames = db.prepare('SELECT origin_id FROM roleplay_message_frames WHERE workspace_id = ? ORDER BY created_at, origin_id').all(workspaceId);
  frames.forEach((frame, index) => { if (wanted.has(frame.origin_id)) numbers.set(frame.origin_id, index + 1); });
  return numbers;
}

module.exports = { editedParts, recordSheetEdit, listWorldChanges };
