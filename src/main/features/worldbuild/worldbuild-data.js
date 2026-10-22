const crypto = require('crypto');
const { createWorldbuildKnowledgeService } = require('./knowledge-service');
const {
  normalizeKnowledgeCategory,
  normalizeMemoryCategory,
} = require('../../../../dist-main/narrative/narrative-taxonomy');

const FIELD_TYPES = new Set([
  'short-text', 'long-text', 'number', 'range', 'boolean',
  'single-choice', 'multiple-choice', 'entity-reference', 'entity-reference-list',
]);
const AI_ACCESS = new Set(['read-write', 'read-only', 'hidden']);
const ACCESSIBILITY = new Set(['available', 'suppressed', 'inaccessible']);
const ACQUISITION = new Set(['participant', 'witness', 'reported', 'inferred']);

function createWorldbuildDataService(db) {
  const knowledgeCards = createWorldbuildKnowledgeService(db);
  const insertEvent = db.prepare(`
    INSERT INTO narrative_events (
      workspace_id, event_id, proposal_id, change_set_id, contract_version,
      event_type, description, narrative_sequence, status, version,
      operations_json, provenance_interpreter, provenance_schema_version,
      provenance_created_at, decided_at
    ) VALUES (?, ?, ?, ?, '1.0', 'custom', ?, ?, 'approved', 1, ?, 'user', '1.0', ?, ?)
  `);
  const insertParticipant = db.prepare(`
    INSERT INTO narrative_event_participants
      (workspace_id, event_id, ordinal, entity_id, role)
    VALUES (?, ?, 0, ?, 'subject')
  `);
  const insertEvidence = db.prepare(`
    INSERT INTO narrative_event_evidence
      (workspace_id, event_id, evidence_id, ordinal, origin_type, origin_id, excerpt)
    VALUES (?, ?, ?, 0, 'world-action', ?, ?)
  `);
  const insertRecord = db.prepare(`
    INSERT INTO narrative_records (
      workspace_id, record_type, record_id, subject_id, source_event_id,
      operation_id, payload_json, applied_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  function listFieldDefinitions(workspaceId, typeId) {
    const rows = db.prepare(`
      SELECT workspace_id, field_id, type_id, field_key, label, value_type,
        options_json, constraints_json, default_value_json, has_default,
        required, position, ai_access, ai_guidance
      FROM worldbuild_field_definitions
      WHERE workspace_id = ? AND type_id = ?
      ORDER BY position, field_id
    `).all(requireText(workspaceId, 'workspaceId'), requireText(typeId, 'typeId'));
    return rows.map(hydrateFieldDefinition);
  }

  function saveFieldDefinition(input) {
    const definition = normalizeFieldDefinition(input);
    const existing = db.prepare(`
      SELECT type_id, field_key, value_type FROM worldbuild_field_definitions
      WHERE workspace_id = ? AND field_id = ?
    `).get(definition.projectId, definition.id);
    const hasTypeChange = existing && existing.value_type !== definition.valueType;
    if (hasTypeChange && !input.clearValuesOnTypeChange) {
      throw new Error('Changing a custom field type requires clearing its existing values.');
    }
    const saveDefinition = db.prepare(`
      INSERT INTO worldbuild_field_definitions (
        workspace_id, field_id, type_id, field_key, label, value_type,
        options_json, constraints_json, default_value_json, has_default,
        required, position, ai_access, ai_guidance
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (workspace_id, field_id) DO UPDATE SET
        type_id = excluded.type_id,
        field_key = excluded.field_key,
        label = excluded.label,
        value_type = excluded.value_type,
        options_json = excluded.options_json,
        constraints_json = excluded.constraints_json,
        default_value_json = excluded.default_value_json,
        has_default = excluded.has_default,
        required = excluded.required,
        position = excluded.position,
        ai_access = excluded.ai_access,
        ai_guidance = excluded.ai_guidance
    `);
    db.transaction(() => {
      saveDefinition.run(
        definition.projectId, definition.id, definition.typeId, definition.key,
        definition.label, definition.valueType,
        definition.options ? JSON.stringify(definition.options) : null,
        definition.constraints ? JSON.stringify(definition.constraints) : null,
        definition.hasDefault ? JSON.stringify(definition.defaultValue) : null,
        definition.hasDefault ? 1 : 0, definition.required ? 1 : 0,
        definition.position, definition.aiAccess, definition.aiGuidance || null,
      );
      if (hasTypeChange) clearFieldValues(definition.projectId, existing.type_id, existing.field_key);
    })();
    return hydrateFieldDefinition(db.prepare(`
      SELECT workspace_id, field_id, type_id, field_key, label, value_type,
        options_json, constraints_json, default_value_json, has_default,
        required, position, ai_access, ai_guidance
      FROM worldbuild_field_definitions WHERE workspace_id = ? AND field_id = ?
    `).get(definition.projectId, definition.id));
  }

  function clearFieldValues(workspaceId, typeId, fieldKey) {
    const entities = db.prepare('SELECT id, data FROM entities WHERE workspaceId = ? AND type = ?').all(workspaceId, typeId);
    const updateEntity = db.prepare('UPDATE entities SET data = ?, last_modified = ? WHERE id = ?');
    for (const entity of entities) {
      const data = parseObject(entity.data);
      if (!data.customFields || !Object.hasOwn(data.customFields, fieldKey)) continue;
      const customFields = { ...data.customFields };
      delete customFields[fieldKey];
      if (Object.keys(customFields).length) data.customFields = customFields;
      else delete data.customFields;
      updateEntity.run(JSON.stringify(data), Date.now(), entity.id);
    }
  }

  function deleteFieldDefinition(workspaceId, fieldId) {
    const row = db.prepare(`
      SELECT type_id, field_key FROM worldbuild_field_definitions
      WHERE workspace_id = ? AND field_id = ?
    `).get(workspaceId, fieldId);
    if (!row) return false;
    return db.transaction(() => {
      clearFieldValues(workspaceId, row.type_id, row.field_key);
      return db.prepare(`
        DELETE FROM worldbuild_field_definitions WHERE workspace_id = ? AND field_id = ?
      `).run(workspaceId, fieldId).changes > 0;
    })();
  }

  function listEntityTemplates(workspaceId) {
    return db.prepare(`
      SELECT type_id, display_name, layout_json
      FROM worldbuild_entity_templates WHERE workspace_id = ?
      ORDER BY type_id
    `).all(requireText(workspaceId, 'workspaceId')).map(row => ({
      typeId: row.type_id,
      displayName: row.display_name || '',
      layout: parseObject(row.layout_json),
    }));
  }

  function saveEntityTemplate(input = {}) {
    const workspaceId = requireText(input.workspaceId, 'workspaceId');
    const typeId = requireText(input.typeId, 'typeId');
    const displayName = String(input.displayName || '').trim();
    const layout = input.layout && typeof input.layout === 'object' && !Array.isArray(input.layout) ? input.layout : {};
    db.prepare(`
      INSERT INTO worldbuild_entity_templates (workspace_id, type_id, display_name, layout_json, updated_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT (workspace_id, type_id) DO UPDATE SET
        display_name = excluded.display_name,
        layout_json = excluded.layout_json,
        updated_at = excluded.updated_at
    `).run(workspaceId, typeId, displayName || null, JSON.stringify(layout), Date.now());
    return { typeId, displayName, layout };
  }

  function getSubjectKnowledge(workspaceId, subjectId) {
    const rows = db.prepare(`
      SELECT records.rowid AS record_order, records.record_type, records.record_id,
        records.payload_json, records.source_event_id, records.applied_at,
        events.narrative_sequence, events.narrative_timestamp, events.provenance_interpreter,
        occurrences.occurrence_id, occurrences.event_entity_id, occurrences.title AS occurrence_title
      FROM narrative_records AS records
      JOIN narrative_events AS events
        ON events.workspace_id = records.workspace_id
        AND events.event_id = records.source_event_id
      LEFT JOIN worldbuild_event_occurrences AS occurrences
        ON occurrences.workspace_id = records.workspace_id
        AND occurrences.narrative_event_id = records.source_event_id
      LEFT JOIN narrative_event_evidence AS evidence
        ON evidence.workspace_id = events.workspace_id
        AND evidence.event_id = events.event_id
        AND evidence.ordinal = 0
      LEFT JOIN narrative_origin_lifecycle AS lifecycle
        ON lifecycle.workspace_id = events.workspace_id
        AND lifecycle.origin_id = evidence.origin_id
      WHERE records.workspace_id = ?
        AND records.subject_id = ?
        AND records.record_type IN ('observation', 'knowledge', 'belief', 'memory')
        AND COALESCE(lifecycle.status, 'active') = 'active'
      ORDER BY events.narrative_sequence, records.rowid
    `).all(requireText(workspaceId, 'workspaceId'), requireText(subjectId, 'subjectId'));
    const projection = projectSubjectKnowledge(workspaceId, subjectId, rows, createEntityNameResolver(workspaceId));
    projection.cards = knowledgeCards.listCards(workspaceId, subjectId);
    return projection;
  }

  function createEntityNameResolver(workspaceId) {
    const cache = new Map();
    return entityId => {
      if (cache.has(entityId)) return cache.get(entityId);
      const row = db.prepare('SELECT canonicalName FROM entities WHERE workspaceId = ? AND id = ?').get(workspaceId, entityId);
      const name = row?.canonicalName || '';
      cache.set(entityId, name);
      return name;
    };
  }

  // The review compares a relationship with what it says now, which may have moved since it was proposed.
  function currentRelationshipOf(workspaceId) {
    const hasLinks = db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'entity_links'").get();
    const statement = hasLinks ? db.prepare(`
      SELECT label, metadata_json FROM entity_links
      WHERE workspaceId = ? AND fromId = ? AND toId = ? AND relType = 'related_to'
      ORDER BY createdAt LIMIT 1
    `) : null;
    return (sourceId, targetId) => {
      const row = statement?.get(workspaceId, sourceId, targetId);
      if (!row) return null;
      const metadata = parseObject(row.metadata_json);
      return { title: row.label || '', value: Number(metadata.value || 0) };
    };
  }

  function getSubjectReview(workspaceId, subjectId) {
    const resolveEntityName = createEntityNameResolver(workspaceId);
    const currentRelationship = currentRelationshipOf(workspaceId);
    const proposals = db.prepare(`
      SELECT DISTINCT events.event_id, events.description, events.operations_json,
        events.provenance_created_at, events.provenance_prompt_version, evidence.excerpt
      FROM narrative_events events
      JOIN narrative_event_participants participants
        ON participants.workspace_id = events.workspace_id AND participants.event_id = events.event_id
      LEFT JOIN narrative_event_evidence evidence
        ON evidence.workspace_id = events.workspace_id AND evidence.event_id = events.event_id AND evidence.ordinal = 0
      LEFT JOIN narrative_origin_lifecycle lifecycle
        ON lifecycle.workspace_id = evidence.workspace_id AND lifecycle.origin_id = evidence.origin_id
      WHERE events.workspace_id = ? AND events.status = 'proposed'
        AND participants.entity_id = ?
        AND participants.ordinal = 0
        AND (lifecycle.status IS NULL OR lifecycle.status = 'active')
      ORDER BY events.narrative_sequence, events.event_id
    `).all(workspaceId, subjectId).flatMap(row => {
      const operations = JSON.parse(row.operations_json);
      const visibleOperations = operations
        .map(operation => summarizeProposedOperation(operation, resolveEntityName))
        .filter(Boolean)
        .map(operation => operation.kind === 'relationship'
          ? { ...operation, current: currentRelationship(operation.subjectId, operation.targetId) }
          : operation);
      return visibleOperations.length ? [{
        eventId: row.event_id,
        description: row.description,
        excerpt: row.excerpt || '',
        createdAt: row.provenance_created_at,
        legacy: row.provenance_prompt_version?.startsWith('entity-update-')
          && row.provenance_prompt_version !== 'entity-update-v3',
        operations: visibleOperations,
      }] : [];
    });
    return { subjectId, proposals };
  }

  // What waits for review on these sheets outside their staged update, so a bulk action can resolve it.
  function listPendingReviewIds(workspaceId, entityIds) {
    const ids = [...new Set((entityIds || []).filter(Boolean))];
    if (!ids.length) return { narrativeEventIds: [], skillChangeIds: [] };
    const placeholders = ids.map(() => '?').join(', ');
    const narrativeEventIds = db.prepare(`
      SELECT DISTINCT events.event_id
      FROM narrative_events events
      JOIN narrative_event_participants participants
        ON participants.workspace_id = events.workspace_id
        AND participants.event_id = events.event_id
        AND participants.ordinal = 0
      LEFT JOIN narrative_event_evidence evidence
        ON evidence.workspace_id = events.workspace_id AND evidence.event_id = events.event_id AND evidence.ordinal = 0
      LEFT JOIN narrative_origin_lifecycle lifecycle
        ON lifecycle.workspace_id = evidence.workspace_id AND lifecycle.origin_id = evidence.origin_id
      WHERE events.workspace_id = ? AND events.status = 'proposed'
        AND (lifecycle.status IS NULL OR lifecycle.status = 'active')
        AND participants.entity_id IN (${placeholders})
    `).all(workspaceId, ...ids).map(row => row.event_id);
    const skillChangeIds = db.prepare(`
      SELECT change_id FROM roleplay_skill_changes
      WHERE workspace_id = ? AND status = 'pending' AND source = 'ai' AND entity_id IN (${placeholders})
    `).all(workspaceId, ...ids).map(row => row.change_id);
    return { narrativeEventIds, skillChangeIds };
  }

  function listReviewCounts(workspaceId) {
    const counts = new Map();
    const entities = db.prepare('SELECT id, data FROM entities WHERE workspaceId = ?').all(requireText(workspaceId, 'workspaceId'));
    for (const entity of entities) {
      const data = parseObject(entity.data);
      const pending = data._enrichPending;
      const entityUpdates = pending
        ? Object.keys(pending.data || {}).length
          + (pending.lore ? 1 : 0)
          + (Array.isArray(pending.links) ? pending.links.length : 0)
          + (Array.isArray(pending.chapters) ? pending.chapters.length : 0)
        : 0;
      counts.set(entity.id, { entityUpdates, narrative: 0 });
    }
    // A skill the AI wants to give or raise is reviewed on the sheet too; it is stored once, in the Rules.
    const skillChanges = db.prepare(`
      SELECT entity_id, COUNT(*) AS total FROM roleplay_skill_changes
      WHERE workspace_id = ? AND status = 'pending' AND source = 'ai'
      GROUP BY entity_id
    `).all(workspaceId);
    for (const row of skillChanges) {
      const current = counts.get(row.entity_id);
      if (current) current.entityUpdates += row.total;
    }
    const events = db.prepare(`
      SELECT events.operations_json, participants.entity_id AS owner_id
      FROM narrative_events events
      JOIN narrative_event_participants participants
        ON participants.workspace_id = events.workspace_id
        AND participants.event_id = events.event_id
        AND participants.ordinal = 0
      LEFT JOIN narrative_event_evidence evidence
        ON evidence.workspace_id = events.workspace_id AND evidence.event_id = events.event_id AND evidence.ordinal = 0
      LEFT JOIN narrative_origin_lifecycle lifecycle
        ON lifecycle.workspace_id = evidence.workspace_id AND lifecycle.origin_id = evidence.origin_id
      WHERE events.workspace_id = ? AND events.status = 'proposed'
        AND (lifecycle.status IS NULL OR lifecycle.status = 'active')
    `).all(workspaceId);
    for (const event of events) {
      const current = counts.get(event.owner_id) || { entityUpdates: 0, narrative: 0 };
      current.narrative += JSON.parse(event.operations_json)
        .filter(operation => operation.type !== 'record-observation').length;
      counts.set(event.owner_id, current);
    }
    return Object.fromEntries(counts);
  }

  function getSubjectRecord(workspaceId, subjectId, kind, recordId) {
    const row = db.prepare(`
      SELECT records.record_id, records.payload_json, occurrences.occurrence_id
      FROM narrative_records AS records
      JOIN narrative_events AS events
        ON events.workspace_id = records.workspace_id
        AND events.event_id = records.source_event_id
      LEFT JOIN worldbuild_event_occurrences AS occurrences
        ON occurrences.workspace_id = records.workspace_id
        AND occurrences.narrative_event_id = records.source_event_id
      LEFT JOIN narrative_event_evidence AS evidence
        ON evidence.workspace_id = events.workspace_id
        AND evidence.event_id = events.event_id
        AND evidence.ordinal = 0
      LEFT JOIN narrative_origin_lifecycle AS lifecycle
        ON lifecycle.workspace_id = events.workspace_id
        AND lifecycle.origin_id = evidence.origin_id
      WHERE records.workspace_id = ? AND records.subject_id = ?
        AND records.record_type = ? AND records.record_id = ?
        AND COALESCE(lifecycle.status, 'active') = 'active'
    `).get(workspaceId, subjectId, kind, recordId);
    return row ? { id: row.record_id, payload: JSON.parse(row.payload_json), managed: Boolean(row.occurrence_id) } : null;
  }

  // Occurrence records are edited in their event: a revision here would shadow its later edits.
  function requireEditableRecord(current) {
    if (current?.managed) throw new Error('This entry belongs to an Event occurrence. Open the event to change it.');
  }

  function saveSubjectEntry(payload) {
    const { workspaceId, subjectId, kind, entry, existingId } = payload || {};
    requireEntryKind(kind);
    const current = existingId ? getSubjectRecord(workspaceId, subjectId, kind, existingId) : null;
    if (existingId && !current) throw new Error('The Knowledge entry no longer exists.');
    requireEditableRecord(current);
    const eventId = crypto.randomUUID();
    const evidenceId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const operations = buildRevisionOperations(kind, subjectId, entry || {}, current, eventId, evidenceId);
    db.transaction(() => {
      if (kind === 'knowledge' || kind === 'belief') {
        const sourceId = current?.payload?.entryId || existingId || operations.at(-1)?.id;
        knowledgeCards.ensureAwareness({
          workspaceId,
          ownerId: subjectId,
          targetId: requireText(entry?.aboutId, 'aboutId'),
          sourceType: 'statement',
          sourceId,
        });
        // Being told something means knowing who told you; otherwise retrieval attributes it to no one.
        const tellers = kind === 'knowledge' && entry?.acquisition === 'reported'
          ? normalizeIds(entry?.informantIds)
          : [];
        for (const informantId of tellers) {
          if (informantId === subjectId) continue;
          knowledgeCards.ensureAwareness({
            workspaceId, ownerId: subjectId, targetId: informantId,
            sourceType: 'statement', sourceId: `informant:${sourceId}:${informantId}`,
          });
        }
      }
      persistManualEvent({ workspaceId, subjectId, eventId, evidenceId, createdAt, operations, action: current ? 'updated' : 'added' });
    })();
    return getSubjectKnowledge(workspaceId, subjectId);
  }

  function deleteSubjectEntry(payload) {
    const { workspaceId, subjectId, kind, entryId } = payload || {};
    requireEntryKind(kind);
    const current = getSubjectRecord(workspaceId, subjectId, kind, entryId);
    if (!current) return getSubjectKnowledge(workspaceId, subjectId);
    requireEditableRecord(current);
    const eventId = crypto.randomUUID();
    const evidenceId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const operation = buildRemovalOperation(kind, current, eventId, evidenceId);
    persistManualEvent({
      workspaceId, subjectId, eventId, evidenceId, createdAt,
      operations: [operation], action: 'removed',
    });
    return getSubjectKnowledge(workspaceId, subjectId);
  }

  function listWorldFacts(workspaceId) {
    const projectId = requireText(workspaceId, 'workspaceId');
    const rows = db.prepare(`
      SELECT records.record_id, records.payload_json, records.source_event_id,
        records.applied_at, events.narrative_sequence, events.narrative_timestamp,
        events.provenance_interpreter
      FROM narrative_records records
      JOIN narrative_events events
        ON events.workspace_id = records.workspace_id
        AND events.event_id = records.source_event_id
      LEFT JOIN narrative_event_evidence evidence
        ON evidence.workspace_id = events.workspace_id
        AND evidence.event_id = events.event_id
        AND evidence.ordinal = 0
      LEFT JOIN narrative_origin_lifecycle lifecycle
        ON lifecycle.workspace_id = events.workspace_id
        AND lifecycle.origin_id = evidence.origin_id
      WHERE records.workspace_id = ? AND records.record_type = 'fact'
        AND COALESCE(lifecycle.status, 'active') = 'active'
      ORDER BY events.narrative_sequence, records.rowid
    `).all(projectId);
    const resolveEntityName = createEntityNameResolver(projectId);
    const current = new Map();
    for (const row of rows) {
      const payload = JSON.parse(row.payload_json);
      const referenceId = payload.referenceId || factReferenceId(payload.proposition, row.record_id);
      const key = referenceId;
      for (const [existingKey, existing] of current) {
        if (existing.id === referenceId) current.delete(existingKey);
      }
      if (payload.status === 'active') {
        const legacyAboutId = payload.proposition?.subjectId === projectId ? null : payload.proposition?.subjectId || null;
        const rendered = renderProposition(payload.proposition, resolveEntityName);
        current.set(key, {
          id: referenceId,
          title: rendered.title,
          statement: rendered.statement,
          predicate: String(payload.proposition?.predicate || ''),
          managed: rendered.managed,
          relatedEntityIds: normalizeIds(payload.relatedEntityIds?.length ? payload.relatedEntityIds : legacyAboutId ? [legacyAboutId] : []),
          sourceEventId: row.source_event_id,
          source: row.provenance_interpreter === 'user' ? 'manual' : 'narrative',
          position: {
            sequence: row.narrative_sequence,
            ...(row.narrative_timestamp ? { timestamp: row.narrative_timestamp } : {}),
          },
          appliedAt: row.applied_at,
        });
      } else {
        current.delete(key);
      }
    }
    return [...current.values()];
  }

  function getWorldFactRecord(workspaceId, factId) {
    const rows = db.prepare(`
      SELECT records.record_id, records.payload_json
      FROM narrative_records AS records
      JOIN narrative_events AS events
        ON events.workspace_id = records.workspace_id
        AND events.event_id = records.source_event_id
      LEFT JOIN narrative_event_evidence AS evidence
        ON evidence.workspace_id = events.workspace_id
        AND evidence.event_id = events.event_id
        AND evidence.ordinal = 0
      LEFT JOIN narrative_origin_lifecycle AS lifecycle
        ON lifecycle.workspace_id = events.workspace_id
        AND lifecycle.origin_id = evidence.origin_id
      WHERE records.workspace_id = ? AND records.record_type = 'fact'
        AND COALESCE(lifecycle.status, 'active') = 'active'
      ORDER BY records.rowid DESC
    `).all(requireText(workspaceId, 'workspaceId'));
    const requestedId = requireText(factId, 'factId');
    for (const row of rows) {
      const payload = JSON.parse(row.payload_json);
      const referenceId = payload.referenceId || factReferenceId(payload.proposition, row.record_id);
      if ((row.record_id === requestedId || referenceId === requestedId) && payload.status === 'active') {
        return { id: row.record_id, referenceId, payload };
      }
    }
    return null;
  }

  function saveWorldFact(payload = {}) {
    const workspaceId = requireText(payload.workspaceId, 'workspaceId');
    const current = payload.existingId ? getWorldFactRecord(workspaceId, payload.existingId) : null;
    if (payload.existingId && !current) throw new Error('The Fact no longer exists.');
    if (current && isManagedProposition(current.payload.proposition)) {
      throw new Error('This Fact is maintained by its source record and cannot be edited here.');
    }
    const eventId = crypto.randomUUID();
    const evidenceId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const entry = payload.entry || {};
    const title = requireText(entry.title, 'title');
    const statement = requireText(entry.statement, 'statement');
    const relatedEntityIds = normalizeIds(entry.relatedEntityIds ?? (entry.aboutId ? [entry.aboutId] : []));
    const referenceId = current?.referenceId || crypto.randomUUID();
    const operations = [];
    if (current) {
      operations.push(buildFactOperation(current.payload.proposition, 'retracted', evidenceId, {
        referenceId,
        relatedEntityIds: normalizeIds(current.payload.relatedEntityIds),
      }));
    }
    operations.push(buildFactOperation(
      { subjectId: workspaceId, predicate: title, object: statement },
      'active',
      evidenceId,
      { referenceId, relatedEntityIds },
    ));
    persistManualEvent({
      workspaceId,
      subjectId: null,
      participantId: workspaceId,
      eventId,
      evidenceId,
      createdAt,
      operations,
      action: current ? 'updated' : 'added',
      eventDescription: `Worldbuild Fact ${current ? 'updated' : 'added'}.`,
    });
    return listWorldFacts(workspaceId);
  }

  function deleteWorldFact(payload = {}) {
    const workspaceId = requireText(payload.workspaceId, 'workspaceId');
    const current = getWorldFactRecord(workspaceId, payload.factId);
    if (!current) return listWorldFacts(workspaceId);
    if (isManagedProposition(current.payload.proposition)) {
      throw new Error('This Fact is maintained by its source record and cannot be retracted here.');
    }
    const eventId = crypto.randomUUID();
    const evidenceId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    persistManualEvent({
      workspaceId,
      subjectId: null,
      participantId: workspaceId,
      eventId,
      evidenceId,
      createdAt,
      operations: [buildFactOperation(current.payload.proposition, 'retracted', evidenceId, {
        referenceId: current.referenceId,
        relatedEntityIds: normalizeIds(current.payload.relatedEntityIds),
      })],
      action: 'removed',
      eventDescription: 'Worldbuild Fact removed.',
    });
    return listWorldFacts(workspaceId);
  }

  // The narrative ledger is the one source of a relationship; a sheet edit is a new entry in it,
  // and removing the last edge between two characters retires the pair.
  function recordRelationship({ workspaceId, fromId, toId } = {}) {
    if (!workspaceId || !fromId || !toId) return;
    const link = db.prepare(`
      SELECT label, metadata_json FROM entity_links
      WHERE workspaceId = ? AND fromId = ? AND toId = ? AND relType = 'related_to'
      ORDER BY createdAt LIMIT 1
    `).get(workspaceId, fromId, toId);
    const current = currentLedgerRelationship(workspaceId, fromId, toId);
    const eventId = crypto.randomUUID();
    const evidenceId = crypto.randomUUID();
    let relationship;
    if (link) {
      const metadata = parseObject(link.metadata_json);
      const value = Number(metadata.value);
      const next = {
        title: link.label || '',
        value: Number.isFinite(value) ? Math.max(-100, Math.min(100, value)) : 0,
        description: String(metadata.description || ''),
      };
      if (current && current.title === next.title && Number(current.value) === next.value
        && String(current.description || '') === next.description) return;
      relationship = {
        id: crypto.randomUUID(), sourceEntityId: fromId, targetEntityId: toId, dimension: 'overall',
        ...next, status: 'active', sourceEventId: eventId, evidenceIds: [evidenceId],
      };
    } else {
      if (!current) return;
      relationship = { ...current, id: crypto.randomUUID(), status: 'retired', sourceEventId: eventId, evidenceIds: [evidenceId] };
    }
    persistManualEvent({
      workspaceId, subjectId: fromId, eventId, evidenceId, createdAt: new Date().toISOString(),
      operations: [{ id: crypto.randomUUID(), type: 'set-relationship', evidenceIds: [evidenceId], relationship }],
      action: link ? 'updated' : 'removed',
      eventDescription: link ? 'Worldbuild relationship updated.' : 'Worldbuild relationship removed.',
    });
  }

  function currentLedgerRelationship(workspaceId, fromId, toId) {
    const row = db.prepare(`
      SELECT records.payload_json FROM narrative_records records
      JOIN narrative_events events
        ON events.workspace_id = records.workspace_id AND events.event_id = records.source_event_id
      LEFT JOIN narrative_event_evidence evidence
        ON evidence.workspace_id = events.workspace_id AND evidence.event_id = events.event_id AND evidence.ordinal = 0
      LEFT JOIN narrative_origin_lifecycle lifecycle
        ON lifecycle.workspace_id = events.workspace_id AND lifecycle.origin_id = evidence.origin_id
      WHERE records.workspace_id = ? AND records.record_type = 'relationship' AND records.subject_id = ?
        AND json_extract(records.payload_json, '$.targetEntityId') = ?
        AND lower(COALESCE(json_extract(records.payload_json, '$.dimension'), 'overall')) = 'overall'
        AND COALESCE(lifecycle.status, 'active') = 'active'
      ORDER BY events.narrative_sequence DESC, records.rowid DESC LIMIT 1
    `).get(workspaceId, fromId, toId);
    const payload = row ? parseObject(row.payload_json) : null;
    return payload && payload.status !== 'retired' ? payload : null;
  }

  function persistManualEvent({ workspaceId, subjectId, participantId, eventId, evidenceId, createdAt, operations, action, eventDescription, excerpt }) {
    const sequence = nextNarrativeSequence(workspaceId);
    const description = eventDescription || `Worldbuild Knowledge entry ${action}.`;
    db.transaction(() => {
      insertEvent.run(
        workspaceId, eventId, crypto.randomUUID(), crypto.randomUUID(), description,
        sequence, JSON.stringify(operations), createdAt, createdAt,
      );
      insertParticipant.run(workspaceId, eventId, participantId || subjectId);
      insertEvidence.run(workspaceId, eventId, evidenceId, participantId || subjectId, excerpt || entryExcerpt(operations.at(-1)));
      for (const operation of operations) {
        const record = operationRecord(operation);
        insertRecord.run(
          workspaceId, record.type, record.payload.id,
          Object.hasOwn(record, 'subjectId') ? record.subjectId : subjectId,
          eventId,
          operation.id, JSON.stringify(record.payload), createdAt,
        );
      }
    })();
  }

  function nextNarrativeSequence(workspaceId) {
    const row = db.prepare(`
      SELECT COALESCE(MAX(narrative_sequence), 0) + 1 AS sequence
      FROM narrative_events WHERE workspace_id = ?
    `).get(workspaceId);
    return row.sequence;
  }

  return {
    listFieldDefinitions,
    saveFieldDefinition,
    deleteFieldDefinition,
    listEntityTemplates,
    saveEntityTemplate,
    getSubjectKnowledge,
    getSubjectReview,
    listReviewCounts,
    listPendingReviewIds,
    listWorldFacts,
    saveWorldFact,
    deleteWorldFact,
    saveSubjectEntry,
    deleteSubjectEntry,
    recordRelationship,
    listKnowledgeCards: knowledgeCards.listCards,
    getKnowledgeCard: knowledgeCards.getCard,
    ensureAwareness: knowledgeCards.ensureAwareness,
    setKnownFields: knowledgeCards.setKnownFields,
    markCurrentFieldsKnown: knowledgeCards.markCurrentFieldsKnown,
    setKnownRelationships: knowledgeCards.setKnownRelationships,
    removeKnowledgeCard: knowledgeCards.removeCard,
    setKnowledgeAudience: knowledgeCards.setAudience,
    reconcileKnowledge: knowledgeCards.reconcileWorkspace,
  };
}

function normalizeFieldDefinition(input = {}) {
  const projectId = requireText(input.projectId, 'projectId');
  const typeId = requireText(input.typeId, 'typeId');
  const label = requireText(input.label, 'label');
  const valueType = FIELD_TYPES.has(input.valueType) ? input.valueType : null;
  if (!valueType) throw new Error('Unsupported custom field type.');
  const key = String(input.key || '').trim() || fieldKeyFromLabel(label);
  const isChoice = valueType === 'single-choice' || valueType === 'multiple-choice';
  const options = isChoice ? normalizeOptions(input.options) : undefined;
  if (isChoice && !options.length) throw new Error('Choice fields need at least one option.');
  const aiAccess = AI_ACCESS.has(input.aiAccess) ? input.aiAccess : 'read-write';
  const position = Number.isInteger(input.position) && input.position >= 0 ? input.position : 0;
  const hasDefault = Object.hasOwn(input, 'defaultValue') && input.defaultValue !== undefined;
  return {
    id: input.id || crypto.randomUUID(), projectId, typeId, key, label, valueType,
    options, constraints: normalizeConstraints(input.constraints, valueType),
    defaultValue: input.defaultValue, hasDefault,
    required: Boolean(input.required), position, aiAccess,
    aiGuidance: String(input.aiGuidance || '').trim(),
  };
}

// Values store the option id, so it never derives from the label: a rename keeps every stored value.
function newOptionId() {
  return `opt-${crypto.randomUUID().slice(0, 8)}`;
}

// Only set when the field is created; the key then stays fixed through renames.
function fieldKeyFromLabel(label) {
  const slug = label.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  return slug || `field-${crypto.randomUUID().slice(0, 8)}`;
}

function normalizeOptions(options) {
  if (!Array.isArray(options)) return [];
  const seen = new Set();
  return options.flatMap(option => {
    const label = String(option?.label ?? option ?? '').trim();
    if (!label) return [];
    const given = typeof option?.id === 'string' ? option.id.trim() : '';
    let id = given && !seen.has(given) ? given : newOptionId();
    while (seen.has(id)) id = newOptionId();
    seen.add(id);
    return [{ id, label }];
  });
}

function normalizeConstraints(constraints, valueType) {
  if (valueType !== 'number' && valueType !== 'range') return undefined;
  const value = {};
  for (const key of ['min', 'max', 'step']) {
    const number = Number(constraints?.[key]);
    if (Number.isFinite(number)) value[key] = number;
  }
  if (value.min !== undefined && value.max !== undefined && value.min > value.max) {
    throw new Error('Minimum cannot exceed maximum.');
  }
  if (value.step !== undefined && value.step <= 0) throw new Error('Step must be greater than zero.');
  return Object.keys(value).length ? value : undefined;
}

function hydrateFieldDefinition(row) {
  const definition = {
    id: row.field_id,
    projectId: row.workspace_id,
    typeId: row.type_id,
    key: row.field_key,
    label: row.label,
    valueType: row.value_type,
    required: row.required === 1,
    position: row.position,
    aiAccess: row.ai_access,
    ...(row.ai_guidance ? { aiGuidance: row.ai_guidance } : {}),
  };
  if (row.options_json) definition.options = JSON.parse(row.options_json);
  if (row.constraints_json) definition.constraints = JSON.parse(row.constraints_json);
  if (row.has_default === 1) definition.defaultValue = JSON.parse(row.default_value_json);
  return definition;
}

function projectSubjectKnowledge(projectId, subjectId, rows, resolveEntityName) {
  const observations = new Map();
  const known = new Map();
  const beliefs = new Map();
  const memories = new Map();
  const entryKeys = { knowledge: new Map(), belief: new Map() };
  for (const row of rows) {
    const payload = JSON.parse(row.payload_json);
    const record = toEntry(row, payload, resolveEntityName);
    if (row.record_type === 'observation') {
      if (payload.supersedesObservationId) observations.delete(payload.supersedesObservationId);
      if ((payload.status || 'active') === 'active') observations.set(row.record_id, record);
    } else if (row.record_type === 'knowledge' || row.record_type === 'belief') {
      const target = row.record_type === 'knowledge' ? known : beliefs;
      const index = entryKeys[row.record_type];
      const key = payload.entryId || propositionKey(payload);
      // A record without an entryId is revised under its own id, not its statement key.
      const previousKey = payload.entryId ? index.get(payload.entryId) : undefined;
      if (previousKey && previousKey !== key) target.delete(previousKey);
      if (payload.status === 'active') {
        target.set(key, record);
        index.set(payload.entryId || payload.id, key);
      } else {
        target.delete(key);
      }
    } else if (row.record_type === 'memory') {
      if (payload.supersedesMemoryId) memories.delete(payload.supersedesMemoryId);
      if ((payload.status || 'active') !== 'forgotten') memories.set(payload.id, record);
    }
  }
  return {
    projectId,
    subjectId,
    observations: [...observations.values()],
    known: [...known.values()],
    beliefs: [...beliefs.values()],
    memories: [...memories.values()],
    // Declared here rather than only bolted on by the caller, so the projection has one
    // shape whether or not awareness cards were loaded onto it.
    cards: [],
  };
}

function summarizeProposedOperation(operation, resolveEntityName) {
  const common = { id: operation.id, evidenceIds: operation.evidenceIds || [] };
  if (operation.type === 'record-observation') return null;
  if (operation.type === 'grant-awareness') {
    return {
      ...common,
      kind: 'awareness',
      subjectId: operation.awareness.subjectId,
      targetId: operation.awareness.targetId,
      summary: 'Knows this subject exists.',
    };
  }
  if (operation.type === 'set-relationship') {
    const value = operation.relationship;
    return { ...common, kind: 'relationship', subjectId: value.sourceEntityId, targetId: value.targetEntityId, cause: value.cause || null, title: value.title || value.dimension, value: Number(value.value), summary: value.description || String(value.value) };
  }
  if (operation.type === 'grant-knowledge') return { ...common, kind: 'knowledge', subjectId: operation.knowledge.subjectId, targetId: operation.knowledge.proposition?.subjectId, acquisition: operation.knowledge.acquisition, category: operation.knowledge.category || null, confidence: operation.knowledge.confidence, summary: formatPropositionObject(operation.knowledge.proposition?.object, resolveEntityName) };
  if (operation.type === 'set-belief') return { ...common, kind: 'belief', subjectId: operation.belief.subjectId, targetId: operation.belief.proposition?.subjectId, category: operation.belief.category || null, confidence: operation.belief.confidence, summary: formatPropositionObject(operation.belief.proposition?.object, resolveEntityName) };
  if (operation.type === 'assert-fact') {
    return {
      ...common,
      kind: 'fact',
      targetId: operation.fact.proposition?.subjectId,
      category: operation.fact.category || null,
      title: humanizePredicate(String(operation.fact.proposition?.predicate || '')),
      summary: formatPropositionObject(operation.fact.proposition?.object, resolveEntityName),
    };
  }
  return { ...common, kind: 'memory', subjectId: operation.memory.subjectId, category: operation.memory.category || null, summary: operation.memory.summary };
}

// A record under an Event occurrence belongs to it and is edited there. The three origins match
// the Facts registry.
function entryOrigin(row) {
  if (row.occurrence_id) {
    return {
      kind: 'occurrence',
      occurrenceId: row.occurrence_id,
      eventEntityId: row.event_entity_id,
      title: row.occurrence_title || '',
    };
  }
  return { kind: row.provenance_interpreter === 'user' ? 'authored' : 'narrative' };
}

function toEntry(row, payload, resolveEntityName) {
  const origin = entryOrigin(row);
  const common = {
    id: payload.id,
    entryId: payload.entryId || payload.id,
    subjectId: payload.subjectId,
    accessibility: payload.accessibility || 'available',
    origin,
    managed: origin.kind === 'occurrence',
    sourceEventId: row.source_event_id,
    position: {
      sequence: row.narrative_sequence,
      ...(row.narrative_timestamp ? { timestamp: row.narrative_timestamp } : {}),
    },
    appliedAt: row.applied_at,
  };
  if (row.record_type === 'observation') {
    return {
      ...common,
      id: row.record_id,
      kind: 'observation',
      summary: String(payload.summary || ''),
      method: payload.method,
      confidence: payload.confidence,
      eventId: payload.eventId,
      factIds: normalizeIds(payload.factIds),
    };
  }
  if (row.record_type === 'memory') {
    return { ...common, kind: 'memory', summary: payload.summary, category: payload.category || null, occurredOn: payload.occurredOn || null };
  }
  return {
    ...common,
    kind: row.record_type,
    category: payload.category || null,
    aboutId: payload.proposition?.subjectId,
    statement: formatPropositionObject(payload.proposition?.object, resolveEntityName),
    confidence: payload.confidence,
    factIds: normalizeIds(payload.factIds),
    ...(row.record_type === 'knowledge'
      ? { acquisition: payload.acquisition, informantIds: normalizeIds(payload.informantIds) }
      : { relationToCanon: payload.relationToCanon }),
  };
}

function buildRevisionOperations(kind, subjectId, entry, current, eventId, evidenceId) {
  const operations = [];
  if (current && kind !== 'memory' && current.payload.proposition?.subjectId !== entry.aboutId) {
    operations.push(buildRemovalOperation(kind, current, eventId, evidenceId));
  }
  operations.push(buildActiveOperation(kind, subjectId, entry, current, eventId, evidenceId));
  return operations;
}

function buildActiveOperation(kind, subjectId, entry, current, eventId, evidenceId) {
  const operationId = crypto.randomUUID();
  if (kind === 'observation') {
    const summary = requireText(entry.summary, 'summary');
    return {
      id: operationId, type: 'record-observation', evidenceIds: [evidenceId],
      observation: {
        id: crypto.randomUUID(), subjectId, eventId, summary,
        method: ACQUISITION.has(entry.method) ? entry.method : 'reported',
        confidence: normalizeConfidence(entry.confidence),
        accessibility: normalizeAccessibility(entry.accessibility),
        factIds: normalizeIds(entry.factIds),
        status: 'active',
        ...(current ? { supersedesObservationId: current.id } : {}),
      },
    };
  }
  if (kind === 'memory') {
    const summary = requireText(entry.summary, 'summary');
    const memoryId = crypto.randomUUID();
    return {
      id: operationId, type: 'record-memory', evidenceIds: [evidenceId],
      memory: {
        id: memoryId, entryId: current?.payload.entryId || current?.payload.id || newEntryId(entry) || memoryId, subjectId, eventId, summary,
        accessibility: normalizeAccessibility(entry.accessibility), status: 'active',
        ...category(normalizeMemoryCategory(entry.category)),
        ...worldDay(entry.occurredOn),
        ...(current ? { supersedesMemoryId: current.payload.id } : {}),
      },
    };
  }
  const statement = requireText(entry.statement, 'statement');
  const aboutId = requireText(entry.aboutId || subjectId, 'aboutId');
  const proposition = { subjectId: aboutId, predicate: 'worldbuild-statement', object: statement };
  if (kind === 'knowledge') {
    const acquisition = ACQUISITION.has(entry.acquisition) ? entry.acquisition : 'reported';
    return {
      id: operationId, type: 'grant-knowledge', evidenceIds: [evidenceId],
      knowledge: {
        id: crypto.randomUUID(), entryId: current?.payload.entryId || current?.payload.id || newEntryId(entry) || crypto.randomUUID(),
        subjectId, proposition, sourceEventId: eventId,
        acquisition,
        confidence: normalizeConfidence(entry.confidence),
        accessibility: normalizeAccessibility(entry.accessibility), status: 'active',
        ...category(normalizeKnowledgeCategory(entry.category)),
        factIds: normalizeIds(entry.factIds),
        // Only hearsay has a teller, so a switch back to observed drops the name. A subject is never
        // its own informant.
        ...(acquisition === 'reported'
          ? { informantIds: normalizeIds(entry.informantIds).filter(id => id !== subjectId) }
          : {}),
      },
    };
  }
  return {
    id: operationId, type: 'set-belief', evidenceIds: [evidenceId],
    belief: {
      id: crypto.randomUUID(), entryId: current?.payload.entryId || current?.payload.id || newEntryId(entry) || crypto.randomUUID(),
      subjectId, proposition, sourceEventId: eventId,
      confidence: normalizeConfidence(entry.confidence), relationToCanon: 'unknown', status: 'active',
      ...category(normalizeKnowledgeCategory(entry.category)),
      factIds: normalizeIds(entry.factIds),
    },
  };
}

/** A package import names its new entries up front, so their hidden marks can follow them. */
function newEntryId(entry) {
  return typeof entry?.entryId === 'string' && entry.entryId.trim() ? entry.entryId.trim() : null;
}

/** An optional story day; a partial or malformed date is dropped rather than stored half-set. */
function worldDay(value) {
  if (!value || typeof value !== 'object' || typeof value.eraId !== 'string' || !value.eraId) return {};
  const day = { eraId: value.eraId, year: Number(value.year), month: Number(value.month), day: Number(value.day) };
  return [day.year, day.month, day.day].every(part => Number.isInteger(part) && part >= 1) ? { occurredOn: day } : {};
}

/** Keeps an unset category out of the payload instead of storing an empty value. */
function category(value) {
  return value ? { category: value } : {};
}

function buildRemovalOperation(kind, current, eventId, evidenceId) {
  const id = crypto.randomUUID();
  if (kind === 'observation') {
    return {
      id: crypto.randomUUID(), type: 'record-observation', evidenceIds: [evidenceId],
      observation: {
        ...current.payload,
        id,
        eventId,
        status: 'removed',
        supersedesObservationId: current.id,
      },
    };
  }
  if (kind === 'memory') {
    return {
      id: crypto.randomUUID(), type: 'record-memory', evidenceIds: [evidenceId],
      memory: {
        id, subjectId: current.payload.subjectId, eventId,
        summary: current.payload.summary, accessibility: current.payload.accessibility,
        status: 'forgotten', supersedesMemoryId: current.payload.id,
      },
    };
  }
  const payload = {
    ...current.payload,
    id,
    sourceEventId: eventId,
    status: kind === 'knowledge' ? 'revoked' : 'abandoned',
  };
  return {
    id: crypto.randomUUID(),
    type: kind === 'knowledge' ? 'grant-knowledge' : 'set-belief',
    evidenceIds: [evidenceId],
    [kind === 'knowledge' ? 'knowledge' : 'belief']: payload,
  };
}

function operationRecord(operation) {
  if (operation.type === 'assert-fact') return { type: 'fact', subjectId: null, payload: operation.fact };
  if (operation.type === 'record-observation') return { type: 'observation', payload: operation.observation };
  if (operation.type === 'grant-knowledge') return { type: 'knowledge', payload: operation.knowledge };
  if (operation.type === 'set-belief') return { type: 'belief', payload: operation.belief };
  if (operation.type === 'record-memory') return { type: 'memory', payload: operation.memory };
  return { type: 'relationship', payload: operation.relationship };
}

function buildFactOperation(proposition, status, evidenceId, metadata = {}) {
  return {
    id: crypto.randomUUID(),
    type: 'assert-fact',
    evidenceIds: [evidenceId],
    fact: {
      id: crypto.randomUUID(),
      proposition,
      status,
      evidenceIds: [evidenceId],
      referenceId: metadata.referenceId,
      relatedEntityIds: normalizeIds(metadata.relatedEntityIds),
    },
  };
}

function entryExcerpt(operation) {
  const record = operationRecord(operation).payload;
  return record.summary || record.description || record.title || String(record.proposition?.object || 'Worldbuild Knowledge entry');
}

function propositionKey(payload) {
  return `${payload.proposition?.subjectId || ''}\u0000${payload.proposition?.predicate || ''}`;
}

const ENTITY_REFERENCE_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Storage keeps the entity reference so a record survives a rename; it is named on the way out.
function formatPropositionObject(object, resolveEntityName) {
  if (typeof object !== 'string') return String(object ?? '');
  const trimmed = object.trim();
  if (!ENTITY_REFERENCE_PATTERN.test(trimmed)) return object;
  return (resolveEntityName && resolveEntityName(trimmed)) || object;
}

/* Manual Facts store a plain string, so the predicate is the author's title. System records store
   a structured object and are flagged managed, so the registry never offers to edit them. */
function renderProposition(proposition, resolveEntityName) {
  const object = proposition?.object;
  const predicate = String(proposition?.predicate || '');
  if (object === null || typeof object !== 'object') {
    return {
      title: humanizePredicate(predicate),
      statement: formatPropositionObject(object, resolveEntityName),
      managed: false,
    };
  }
  const title = String(object.title || object.name || humanizePredicate(predicate));
  const summary = object.summary || object.description || object.statement;
  return {
    title,
    statement: summary ? String(summary) : describeStructuredObject(object),
    managed: true,
  };
}

function isManagedProposition(proposition) {
  return proposition?.object !== null && typeof proposition?.object === 'object';
}

function humanizePredicate(predicate) {
  const text = predicate.replace(/[-_]+/g, ' ').trim();
  return text ? text[0].toLocaleUpperCase() + text.slice(1) : 'Record';
}

function describeStructuredObject(object) {
  return Object.entries(object)
    .filter(([key, value]) => value !== null && value !== undefined && value !== ''
      && typeof value !== 'object' && !/id$/i.test(key))
    .map(([key, value]) => `${humanizePredicate(key)}: ${value}`)
    .join('\n');
}

function factReferenceId(proposition, fallbackId) {
  const subjectId = String(proposition?.subjectId || '').trim();
  const predicate = String(proposition?.predicate || '').trim();
  if (!subjectId || !predicate) return fallbackId;
  return `fact:${encodeURIComponent(subjectId)}:${encodeURIComponent(predicate)}`;
}

function normalizeConfidence(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1, Math.max(0, number)) : 0.5;
}

function normalizeAccessibility(value) {
  return ACCESSIBILITY.has(value) ? value : 'available';
}

function normalizeIds(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(item => String(item || '').trim()).filter(Boolean))];
}

function requireEntryKind(kind) {
  if (!['knowledge', 'belief', 'memory'].includes(kind)) throw new Error('Unsupported Knowledge entry type.');
}

function requireText(value, label) {
  const text = String(value || '').trim();
  if (!text) throw new Error(`${label} is required.`);
  return text;
}

function parseObject(raw) {
  try {
    const value = JSON.parse(raw || '{}');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

module.exports = { createWorldbuildDataService };
