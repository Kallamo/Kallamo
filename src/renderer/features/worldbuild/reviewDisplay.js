import { locationSizeLabel } from '../../../shared/location-sizes';

/** A native field's stored value as the sheet names it. */
export function displayNativeValue(field, value) {
  if (field === 'size') return locationSizeLabel(value) || String(value);
  return String(value);
}

export function displayProposalValue(field, proposal, definitions, entities) {
  const value = proposal && typeof proposal === 'object' && 'value' in proposal ? proposal.value : proposal;
  if (!field.startsWith('customFields.')) return displayNativeValue(field, value);
  const key = field.slice('customFields.'.length);
  const definition = definitions.find(candidate => candidate.key === key);
  if (!definition) return String(value);
  const optionNames = new Map((definition.options || []).map(option => [option.id, option.label]));
  const entityNames = new Map(entities.map(entity => [entity.id, entity.canonicalName]));
  if (definition.valueType === 'single-choice') return optionNames.get(String(value)) || String(value);
  if (definition.valueType === 'multiple-choice' && Array.isArray(value)) return value.map(item => optionNames.get(String(item)) || String(item)).join(', ');
  if (definition.valueType === 'entity-reference') return entityNames.get(String(value)) || String(value);
  if (definition.valueType === 'entity-reference-list' && Array.isArray(value)) return value.map(item => entityNames.get(String(item)) || String(item)).join(', ');
  if (definition.valueType === 'boolean') return value ? 'Yes' : 'No';
  return String(value);
}
