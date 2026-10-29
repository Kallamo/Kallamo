const crypto = require('crypto');

// The parts of a Worldbuild package beyond sheets, links and Knowledge. Every one is named by
// entity refs, since ids change on import, and lands through the same calls the app uses.

const ENTITY_FIELD_TYPES = new Set(['entity-reference', 'entity-reference-list']);
const parseObject = (text) => { try { const value = JSON.parse(text || '{}'); return value && typeof value === 'object' ? value : {}; } catch { return {}; } };
const parseArray = (text) => { try { const value = JSON.parse(text || '[]'); return Array.isArray(value) ? value : []; } catch { return []; } };
const hasTable = (db, name) => Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name));

// Rewrites every string that is an exported entity ref, anywhere in a value.
function remapRefs(value, idMap) {
  if (typeof value === 'string') return idMap.get(value) || value;
  if (Array.isArray(value)) return value.map(item => remapRefs(item, idMap));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, remapRefs(item, idMap)]));
  return value;
}

function exportTemplates(db, workspaceId) {
  const templates = db.prepare('SELECT type_id, display_name, layout_json FROM worldbuild_entity_templates WHERE workspace_id = ?')
    .all(workspaceId).map(row => ({ typeId: row.type_id, displayName: row.display_name || '', layout: parseObject(row.layout_json) }));
  const fields = db.prepare(`
    SELECT field_id, type_id, field_key, label, value_type, options_json, constraints_json, default_value_json,
      has_default, required, position, ai_access, ai_guidance
    FROM worldbuild_field_definitions WHERE workspace_id = ? ORDER BY type_id, position
  `).all(workspaceId).map(row => ({
    id: row.field_id, typeId: row.type_id, key: row.field_key, label: row.label, valueType: row.value_type,
    ...(row.options_json ? { options: JSON.parse(row.options_json) } : {}),
    ...(row.constraints_json ? { constraints: JSON.parse(row.constraints_json) } : {}),
    ...(row.has_default === 1 ? { defaultValue: JSON.parse(row.default_value_json) } : {}),
    required: row.required === 1, position: row.position, aiAccess: row.ai_access, aiGuidance: row.ai_guidance || '',
  }));
  return { version: 1, templates, fields };
}

// Merges into the world: a field this world already has (same type and key) is kept as it is,
// and nothing the world already has is removed or renamed.
function importTemplates({ db, worldbuildData, workspaceId, templates, idMap }) {
  const result = { templatesAdded: 0, fieldsAdded: 0, fieldsKept: 0 };
  if (!templates || templates.version !== 1) return result;
  const fieldIdMap = new Map();
  for (const field of Array.isArray(templates.fields) ? templates.fields : []) {
    const existing = db.prepare('SELECT field_id FROM worldbuild_field_definitions WHERE workspace_id = ? AND type_id = ? AND field_key = ?')
      .get(workspaceId, field.typeId, field.key);
    if (existing) { fieldIdMap.set(field.id, existing.field_id); result.fieldsKept++; continue; }
    const idTaken = db.prepare('SELECT 1 FROM worldbuild_field_definitions WHERE workspace_id = ? AND field_id = ?').get(workspaceId, field.id);
    const id = idTaken ? crypto.randomUUID() : field.id;
    try {
      worldbuildData.saveFieldDefinition({
        ...field, id, projectId: workspaceId,
        ...(Object.hasOwn(field, 'defaultValue') ? { defaultValue: remapRefs(field.defaultValue, idMap) } : {}),
      });
      fieldIdMap.set(field.id, id);
      result.fieldsAdded++;
    } catch (error) {
      console.warn('[import-worldbuild] skipped a custom field:', error.message);
    }
  }

  const current = new Map(worldbuildData.listEntityTemplates(workspaceId).map(template => [template.typeId, template]));
  for (const template of Array.isArray(templates.templates) ? templates.templates : []) {
    const incoming = template.layout || {};
    const fieldSections = Object.fromEntries(Object.entries(incoming.fieldSections || {})
      .flatMap(([fieldId, sectionId]) => (fieldIdMap.has(fieldId) ? [[fieldIdMap.get(fieldId), sectionId]] : [])));
    const mine = current.get(template.typeId);
    if (!mine) {
      worldbuildData.saveEntityTemplate({ workspaceId, typeId: template.typeId, displayName: template.displayName, layout: { ...incoming, fieldSections } });
      result.templatesAdded++;
      continue;
    }
    const sections = mine.layout.sections || [];
    const known = new Set(sections.map(section => section.id));
    const added = (incoming.sections || []).filter(section => !known.has(section.id));
    const placed = { ...fieldSections, ...(mine.layout.fieldSections || {}) };
    worldbuildData.saveEntityTemplate({ workspaceId, typeId: template.typeId, displayName: mine.displayName, layout: { ...mine.layout, sections: [...sections, ...added], fieldSections: placed } });
  }

  // Entity-reference values were written with the package's refs.
  const referenceKeys = new Map();
  for (const field of templates.fields || []) {
    if (!ENTITY_FIELD_TYPES.has(field.valueType)) continue;
    referenceKeys.set(field.typeId, [...(referenceKeys.get(field.typeId) || []), field.key]);
  }
  if (referenceKeys.size) {
    const update = db.prepare('UPDATE entities SET data = ? WHERE id = ?');
    const landed = new Set(idMap.values());
    for (const entityId of landed) {
      const row = db.prepare('SELECT type, data FROM entities WHERE id = ?').get(entityId);
      const keys = row && referenceKeys.get(row.type);
      if (!keys) continue;
      const data = parseObject(row.data);
      if (!data.customFields) continue;
      for (const key of keys) {
        if (!Object.hasOwn(data.customFields, key)) continue;
        const mapped = remapRefs(data.customFields[key], idMap);
        data.customFields[key] = Array.isArray(mapped) ? mapped.filter(id => landed.has(id)) : (landed.has(mapped) ? mapped : null);
      }
      update.run(JSON.stringify(data), entityId);
    }
  }
  return result;
}

// Only occurrences the author recorded travel; those the story recorded belong to its play.
function exportOccurrences(db, workspaceId, entityIds) {
  const ids = new Set(entityIds);
  const keep = list => list.filter(id => ids.has(id));
  return {
    version: 1,
    entries: db.prepare(`
      SELECT occurrences.* FROM worldbuild_event_occurrences occurrences
      JOIN narrative_events events ON events.workspace_id = occurrences.workspace_id AND events.event_id = occurrences.narrative_event_id
      WHERE occurrences.workspace_id = ? AND occurrences.archived = 0 AND occurrences.source = 'user' AND events.status = 'approved'
      ORDER BY occurrences.created_at
    `).all(workspaceId).filter(row => ids.has(row.event_entity_id)).map(row => ({
      eventRef: row.event_entity_id,
      title: row.title,
      summary: row.summary,
      startDate: row.start_date_json ? JSON.parse(row.start_date_json) : null,
      endDate: row.end_date_json ? JSON.parse(row.end_date_json) : null,
      participants: parseArray(row.participants_json).filter(participant => ids.has(participant.entityId)).map(participant => ({
        ...participant, selectedMemberIds: keep(participant.selectedMemberIds || []),
      })),
      locationRefs: keep(parseArray(row.location_ids_json)),
      relatedRefs: keep(parseArray(row.related_entity_ids_json)),
      consequences: parseObject(row.consequences_json),
    })),
  };
}

// The consequences already shaped the exported state, so they are recorded, never applied again.
function importOccurrences({ db, service, workspaceId, occurrences, idMap }) {
  const result = { occurrencesAdded: 0, occurrencesSkipped: 0 };
  if (!occurrences || occurrences.version !== 1) return result;
  const record = db.prepare('UPDATE worldbuild_event_occurrences SET consequences_json = ? WHERE workspace_id = ? AND occurrence_id = ?');
  for (const entry of Array.isArray(occurrences.entries) ? occurrences.entries : []) {
    const eventEntityId = idMap.get(entry.eventRef);
    if (!eventEntityId) { result.occurrencesSkipped++; continue; }
    const mapIds = list => (list || []).map(ref => idMap.get(ref)).filter(Boolean);
    try {
      const created = service.createManual({
        workspaceId, eventEntityId, title: entry.title, summary: entry.summary,
        startDate: entry.startDate, endDate: entry.endDate,
        participants: (entry.participants || []).flatMap(participant => (idMap.get(participant.entityId)
          ? [{ ...participant, entityId: idMap.get(participant.entityId), selectedMemberIds: mapIds(participant.selectedMemberIds) }]
          : [])),
        locationIds: mapIds(entry.locationRefs),
        relatedEntityIds: mapIds(entry.relatedRefs),
      });
      record.run(JSON.stringify(remapRefs(entry.consequences || {}, idMap)), workspaceId, created.id);
      result.occurrencesAdded++;
    } catch (error) {
      console.warn('[import-worldbuild] skipped an occurrence:', error.message);
      result.occurrencesSkipped++;
    }
  }
  return result;
}

const CHAPTERS_FOLDER = 'Background chapters';

// Chapters a sheet uses as its background. Texts written inside items travel on their own.
function exportChapters(db, workspaceId, entityIds) {
  const ids = new Set(entityIds);
  const inWorld = hasTable(db, 'in_world_texts')
    ? new Set(db.prepare('SELECT document_id FROM in_world_texts WHERE workspace_id = ?').all(workspaceId).map(row => row.document_id))
    : new Set();
  const owners = new Map();
  for (const row of db.prepare('SELECT id, data FROM entities WHERE workspaceId = ?').all(workspaceId)) {
    if (!ids.has(row.id)) continue;
    for (const documentId of parseObject(row.data).loreDocumentIds || []) {
      if (inWorld.has(documentId)) continue;
      owners.set(documentId, [...(owners.get(documentId) || []), row.id]);
    }
  }
  const getDocument = db.prepare('SELECT id, title, content FROM documents WHERE id = ? AND workspaceId = ?');
  return {
    version: 1,
    entries: [...owners].flatMap(([documentId, entityRefs]) => {
      const document = getDocument.get(documentId, workspaceId);
      return document ? [{ ref: document.id, title: document.title, content: document.content, entityRefs }] : [];
    }),
  };
}

function importChapters({ db, workspaceId, chapters, idMap, createFolder, createDocument }) {
  const result = { chaptersAdded: 0 };
  const entries = chapters?.version === 1 && Array.isArray(chapters.entries) ? chapters.entries : [];
  if (!entries.length) return result;
  const folder = db.prepare('SELECT id FROM folders WHERE workspaceId = ? AND name = ? AND parentId IS NULL').get(workspaceId, CHAPTERS_FOLDER)
    || createFolder({ workspaceId, name: CHAPTERS_FOLDER });
  const update = db.prepare('UPDATE entities SET data = ? WHERE id = ?');
  for (const entry of entries) {
    const owners = (entry.entityRefs || []).map(ref => idMap.get(ref)).filter(Boolean);
    if (!owners.length) continue;
    const document = createDocument({ workspaceId, folderId: folder.id, title: entry.title || 'Untitled', content: entry.content });
    for (const entityId of owners) {
      const row = db.prepare('SELECT data FROM entities WHERE id = ?').get(entityId);
      const data = parseObject(row?.data);
      data.loreDocumentIds = [...new Set([...(data.loreDocumentIds || []), document.id])];
      update.run(JSON.stringify(data), entityId);
    }
    result.chaptersAdded++;
  }
  return result;
}

// What characters wear, and what lies in places.
function exportPlacement(db, workspaceId, entityIds) {
  const ids = new Set(entityIds);
  const equipment = hasTable(db, 'roleplay_equipment')
    ? db.prepare('SELECT entity_id, item_id FROM roleplay_equipment WHERE workspace_id = ?').all(workspaceId)
      .filter(row => ids.has(row.entity_id) && ids.has(row.item_id)).map(row => ({ holderRef: row.entity_id, itemRef: row.item_id }))
    : [];
  const placed = hasTable(db, 'roleplay_location_inventory')
    ? db.prepare('SELECT location_id, item_id, quantity FROM roleplay_location_inventory WHERE workspace_id = ?').all(workspaceId)
      .filter(row => ids.has(row.location_id) && ids.has(row.item_id)).map(row => ({ locationRef: row.location_id, itemRef: row.item_id, quantity: row.quantity }))
    : [];
  return { version: 1, equipment, placed };
}

function importPlacement({ db, workspaceId, placement, idMap }) {
  const result = { equippedAdded: 0, placedAdded: 0 };
  if (!placement || placement.version !== 1) return result;
  const now = Date.now();
  if (hasTable(db, 'roleplay_equipment')) {
    const equip = db.prepare('INSERT OR IGNORE INTO roleplay_equipment (workspace_id, entity_id, item_id, equipped_at) VALUES (?, ?, ?, ?)');
    for (const row of placement.equipment || []) {
      const holder = idMap.get(row.holderRef), item = idMap.get(row.itemRef);
      if (holder && item) result.equippedAdded += equip.run(workspaceId, holder, item, now).changes;
    }
  }
  if (hasTable(db, 'roleplay_location_inventory')) {
    const place = db.prepare('INSERT OR IGNORE INTO roleplay_location_inventory (workspace_id, location_id, item_id, quantity, updated_at) VALUES (?, ?, ?, ?, ?)');
    for (const row of placement.placed || []) {
      const location = idMap.get(row.locationRef), item = idMap.get(row.itemRef);
      if (location && item && row.quantity > 0) result.placedAdded += place.run(workspaceId, location, item, row.quantity, now).changes;
    }
  }
  return result;
}

module.exports = {
  CHAPTERS_FOLDER,
  exportTemplates, importTemplates,
  exportOccurrences, importOccurrences,
  exportChapters, importChapters,
  exportPlacement, importPlacement,
};
