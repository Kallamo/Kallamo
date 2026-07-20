import type Database from 'better-sqlite3';
import type { EntityFieldDefinition } from '../../../kanora/contracts';
import { validateEntityFieldDefinition, type ValidationIssue } from '../../../kanora/validation';

interface FieldDefinitionRow {
  workspace_id: string;
  field_id: string;
  type_id: string;
  field_key: string;
  label: string;
  value_type: EntityFieldDefinition['valueType'];
  options_json: string | null;
  constraints_json: string | null;
  default_value_json: string | null;
  has_default: number;
  required: number;
  position: number;
  ai_access: EntityFieldDefinition['aiAccess'];
  ai_guidance: string | null;
}

export class WorldbuildFieldDefinitionValidationError extends Error {
  constructor(readonly issues: ValidationIssue[]) {
    super('Worldbuild field definition is invalid.');
  }
}

export class WorldbuildFieldDefinitionRepository {
  constructor(private readonly db: Database.Database) {}

  save(definition: EntityFieldDefinition): EntityFieldDefinition {
    const validation = validateEntityFieldDefinition(definition);
    if (!validation.success) throw new WorldbuildFieldDefinitionValidationError(validation.issues);
    const hasDefault = Object.hasOwn(definition, 'defaultValue');
    this.db.prepare(`
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
    `).run(
      definition.projectId,
      definition.id,
      definition.typeId,
      definition.key,
      definition.label,
      definition.valueType,
      definition.options === undefined ? null : JSON.stringify(definition.options),
      definition.constraints === undefined ? null : JSON.stringify(definition.constraints),
      hasDefault ? JSON.stringify(definition.defaultValue) : null,
      hasDefault ? 1 : 0,
      definition.required ? 1 : 0,
      definition.position,
      definition.aiAccess,
      definition.aiGuidance || null
    );
    return this.get(definition.projectId, definition.id)!;
  }

  get(projectId: string, fieldId: string): EntityFieldDefinition | undefined {
    const row = this.db.prepare(`
      SELECT workspace_id, field_id, type_id, field_key, label, value_type,
        options_json, constraints_json, default_value_json, has_default,
        required, position, ai_access, ai_guidance
      FROM worldbuild_field_definitions
      WHERE workspace_id = ? AND field_id = ?
    `).get(projectId, fieldId) as FieldDefinitionRow | undefined;
    return row ? hydrate(row) : undefined;
  }

  list(projectId: string, typeId?: string): EntityFieldDefinition[] {
    const rows = (typeId
      ? this.db.prepare(`
          SELECT workspace_id, field_id, type_id, field_key, label, value_type,
            options_json, constraints_json, default_value_json, has_default,
            required, position, ai_access, ai_guidance
          FROM worldbuild_field_definitions
          WHERE workspace_id = ? AND type_id = ?
          ORDER BY position, field_id
        `).all(projectId, typeId)
      : this.db.prepare(`
          SELECT workspace_id, field_id, type_id, field_key, label, value_type,
            options_json, constraints_json, default_value_json, has_default,
            required, position, ai_access, ai_guidance
          FROM worldbuild_field_definitions
          WHERE workspace_id = ?
          ORDER BY type_id, position, field_id
        `).all(projectId)) as FieldDefinitionRow[];
    return rows.map(hydrate);
  }

  delete(projectId: string, fieldId: string): boolean {
    return this.db.prepare(`
      DELETE FROM worldbuild_field_definitions WHERE workspace_id = ? AND field_id = ?
    `).run(projectId, fieldId).changes > 0;
  }
}

function hydrate(row: FieldDefinitionRow): EntityFieldDefinition {
  const definition: EntityFieldDefinition = {
    id: row.field_id,
    projectId: row.workspace_id,
    typeId: row.type_id,
    key: row.field_key,
    label: row.label,
    valueType: row.value_type,
    required: row.required === 1,
    position: row.position,
    aiAccess: row.ai_access,
    ...(row.ai_guidance ? { aiGuidance: row.ai_guidance } : {})
  };
  if (row.options_json !== null) definition.options = JSON.parse(row.options_json);
  if (row.constraints_json !== null) definition.constraints = JSON.parse(row.constraints_json);
  if (row.has_default === 1) definition.defaultValue = JSON.parse(row.default_value_json!);
  return definition;
}
