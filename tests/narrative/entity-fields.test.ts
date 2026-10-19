import { describe, expect, test } from 'vitest';
import type { EntityFieldDefinition, EntityReference } from '../../src/narrative/contracts';
import { validateEntityFieldDefinition, validateEntityReference } from '../../src/narrative/validation';

const materialField: EntityFieldDefinition = {
  id: 'field-material',
  projectId: 'project-example',
  typeId: 'items',
  key: 'material',
  label: 'Material',
  valueType: 'single-choice',
  options: [
    { id: 'iron', label: 'Iron' },
    { id: 'silver', label: 'Silver' }
  ],
  defaultValue: 'iron',
  required: false,
  position: 0,
  aiAccess: 'read-write'
};

describe('portable entity contracts', () => {
  test('validates an individual creature as a perspective-capable agent', () => {
    const creature: EntityReference = {
      id: 'vharos',
      projectId: 'project-example',
      kind: 'agent',
      typeId: 'creature',
      name: 'Vharos',
      aliases: [],
      capabilities: ['appearance', 'personality', 'inventory', 'relationships', 'knowledge', 'beliefs', 'memory', 'perspective']
    };

    expect(validateEntityReference(creature)).toEqual({ success: true, value: creature });
  });

  test('validates a choice field with predefined options', () => {
    expect(validateEntityFieldDefinition(materialField)).toEqual({ success: true, value: materialField });
  });

  test('rejects a choice field without options', () => {
    const invalid = { ...materialField, options: [] };
    const result = validateEntityFieldDefinition(invalid);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues).toContainEqual(expect.objectContaining({ path: '$.options' }));
  });

  test('rejects a default value outside the predefined options', () => {
    const invalid = { ...materialField, defaultValue: 'gold' };
    const result = validateEntityFieldDefinition(invalid);

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues).toContainEqual(expect.objectContaining({ path: '$.defaultValue' }));
  });

  test('rejects duplicate capabilities', () => {
    const result = validateEntityReference({
      id: 'tess',
      projectId: 'project-example',
      kind: 'agent',
      typeId: 'character',
      name: 'Tess',
      aliases: [],
      capabilities: ['relationships', 'relationships']
    });

    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.issues).toContainEqual(expect.objectContaining({ path: '$.capabilities' }));
  });
});
