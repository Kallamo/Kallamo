import {
  NARRATIVE_CONTRACT_VERSION,
  type EvidenceReference,
  type EntityFieldDefinition,
  type EntityReference,
  type Belief,
  type Knowledge,
  type Awareness,
  type NarrativeMemory,
  type NarrativeEvent,
  type NarrativeOperation,
  type NarrativeProposal,
  type NarrativeProjection,
  type Scene,
  type Proposition,
  type RelationshipState
} from './contracts';
import { isSupportedContractVersion } from './versioning';
import {
  KNOWLEDGE_CATEGORIES,
  MEMORY_CATEGORIES,
  RELATIONSHIP_CAUSES
} from './narrative-taxonomy';

export const VALIDATION_ISSUE_CODES = {
  INVALID_TYPE: 'invalid_type',
  REQUIRED: 'required',
  INVALID_VALUE: 'invalid_value',
  UNSUPPORTED_VERSION: 'unsupported_version',
  INVALID_REFERENCE: 'invalid_reference',
  OUT_OF_RANGE: 'out_of_range',
  EMPTY_COLLECTION: 'empty_collection'
} as const;

export type ValidationIssueCode = typeof VALIDATION_ISSUE_CODES[keyof typeof VALIDATION_ISSUE_CODES];

export interface ValidationIssue {
  code: ValidationIssueCode;
  path: string;
  message: string;
}

export type ValidationResult<T> =
  | { success: true; value: T }
  | { success: false; issues: ValidationIssue[] };

const EVENT_TYPES = new Set(['movement', 'possession-transfer', 'revelation', 'deception', 'discovery', 'relationship-change', 'custom']);
const OPERATION_TYPES = new Set(['assert-fact', 'set-state', 'record-observation', 'grant-awareness', 'grant-knowledge', 'set-belief', 'record-memory', 'set-relationship']);
const ENTITY_KINDS = ['agent', 'group', 'object', 'location', 'species', 'event', 'concept'];
const ENTITY_CAPABILITIES = ['appearance', 'personality', 'inventory', 'relationships', 'knowledge', 'beliefs', 'memory', 'perspective'];
const ENTITY_FIELD_TYPES = ['short-text', 'long-text', 'number', 'range', 'boolean', 'single-choice', 'multiple-choice', 'entity-reference', 'entity-reference-list'];
const ENTITY_FIELD_KEY = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const KNOWLEDGE_CATEGORY_VALUES = [...KNOWLEDGE_CATEGORIES];
const MEMORY_CATEGORY_VALUES = [...MEMORY_CATEGORIES];
const RELATIONSHIP_CAUSE_VALUES = [...RELATIONSHIP_CAUSES];

/** A taxonomy field is optional on the wire but, when present, has to be one of the known values. */
function optionalEnum(record: Record<string, unknown>, key: string, values: string[], path: string, issues: ValidationIssue[]): void {
  if (record[key] === undefined) return;
  requireEnum(record, key, values, path, issues);
}

function addIssue(issues: ValidationIssue[], code: ValidationIssueCode, path: string, message: string): void {
  issues.push({ code, path, message });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function requireRecord(value: unknown, path: string, issues: ValidationIssue[]): Record<string, unknown> | undefined {
  if (isRecord(value)) return value;
  addIssue(issues, VALIDATION_ISSUE_CODES.INVALID_TYPE, path, 'Expected an object.');
  return undefined;
}

function requireString(record: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]): void {
  if (typeof record[key] !== 'string' || record[key].length === 0) {
    addIssue(issues, VALIDATION_ISSUE_CODES.REQUIRED, `${path}.${key}`, 'Expected a non-empty string.');
  }
}

function optionalString(record: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]): void {
  if (record[key] !== undefined && typeof record[key] !== 'string') {
    addIssue(issues, VALIDATION_ISSUE_CODES.INVALID_TYPE, `${path}.${key}`, 'Expected a string.');
  }
}

function requireStringArray(record: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]): string[] {
  const value = record[key];
  if (Array.isArray(value) && value.every(item => typeof item === 'string' && item.length > 0)) return value;
  addIssue(issues, VALIDATION_ISSUE_CODES.INVALID_TYPE, `${path}.${key}`, 'Expected an array of non-empty strings.');
  return [];
}

function requireConfidence(record: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]): void {
  const value = record[key];
  if (typeof value !== 'number' || value < 0 || value > 1) {
    addIssue(issues, VALIDATION_ISSUE_CODES.OUT_OF_RANGE, `${path}.${key}`, 'Expected a number between 0 and 1.');
  }
}

function requireRelationshipValue(record: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]): void {
  const value = record[key];
  if (typeof value !== 'number' || value < -100 || value > 100) {
    addIssue(issues, VALIDATION_ISSUE_CODES.OUT_OF_RANGE, `${path}.${key}`, 'Expected a number between -100 and 100.');
  }
}

function requireEnum(record: Record<string, unknown>, key: string, values: string[], path: string, issues: ValidationIssue[]): void {
  if (!values.includes(String(record[key]))) addIssue(issues, VALIDATION_ISSUE_CODES.INVALID_VALUE, `${path}.${key}`, `Expected one of: ${values.join(', ')}.`);
}

function validateFieldValue(definition: Record<string, unknown>, value: unknown, path: string, issues: ValidationIssue[]): void {
  const valueType = definition.valueType;
  const options = Array.isArray(definition.options) ? definition.options : [];
  const optionIds = new Set(options.flatMap(option => isRecord(option) && typeof option.id === 'string' ? [option.id] : []));
  const isStringList = Array.isArray(value) && value.every(item => typeof item === 'string');
  const isValid = valueType === 'boolean' ? typeof value === 'boolean'
    : valueType === 'number' || valueType === 'range' ? typeof value === 'number' && Number.isFinite(value)
      : valueType === 'multiple-choice' ? isStringList && value.every(item => optionIds.has(item))
        : valueType === 'entity-reference-list' ? isStringList
          : valueType === 'single-choice' ? typeof value === 'string' && optionIds.has(value)
            : typeof value === 'string';
  if (!isValid) addIssue(issues, VALIDATION_ISSUE_CODES.INVALID_VALUE, path, 'Default value does not match the field definition.');
}

function validateEntityFieldDefinitionValue(value: unknown, path: string, issues: ValidationIssue[]): void {
  const definition = requireRecord(value, path, issues);
  if (!definition) return;
  requireString(definition, 'id', path, issues);
  requireString(definition, 'projectId', path, issues);
  requireString(definition, 'typeId', path, issues);
  requireString(definition, 'key', path, issues);
  requireString(definition, 'label', path, issues);
  requireEnum(definition, 'valueType', ENTITY_FIELD_TYPES, path, issues);
  requireEnum(definition, 'aiAccess', ['read-write', 'read-only', 'hidden'], path, issues);
  optionalString(definition, 'aiGuidance', path, issues);
  if (typeof definition.key === 'string' && !ENTITY_FIELD_KEY.test(definition.key)) {
    addIssue(issues, VALIDATION_ISSUE_CODES.INVALID_VALUE, `${path}.key`, 'Expected a stable lowercase kebab-case key.');
  }
  if (typeof definition.required !== 'boolean') addIssue(issues, VALIDATION_ISSUE_CODES.INVALID_TYPE, `${path}.required`, 'Expected a boolean.');
  if (!Number.isInteger(definition.position) || (definition.position as number) < 0) {
    addIssue(issues, VALIDATION_ISSUE_CODES.OUT_OF_RANGE, `${path}.position`, 'Expected a non-negative integer.');
  }

  const isChoice = definition.valueType === 'single-choice' || definition.valueType === 'multiple-choice';
  if (isChoice) {
    if (!Array.isArray(definition.options) || definition.options.length === 0) {
      addIssue(issues, VALIDATION_ISSUE_CODES.EMPTY_COLLECTION, `${path}.options`, 'Choice fields require at least one option.');
    } else {
      const optionIds = new Set<string>();
      definition.options.forEach((value, index) => {
        const optionPath = `${path}.options[${index}]`;
        const option = requireRecord(value, optionPath, issues);
        if (!option) return;
        requireString(option, 'id', optionPath, issues);
        requireString(option, 'label', optionPath, issues);
        if (typeof option.id === 'string' && optionIds.has(option.id)) {
          addIssue(issues, VALIDATION_ISSUE_CODES.INVALID_VALUE, `${optionPath}.id`, 'Choice option IDs must be unique.');
        }
        if (typeof option.id === 'string') optionIds.add(option.id);
      });
    }
  } else if (definition.options !== undefined) {
    addIssue(issues, VALIDATION_ISSUE_CODES.INVALID_VALUE, `${path}.options`, 'Only choice fields can define options.');
  }

  if (definition.constraints !== undefined) {
    const constraints = requireRecord(definition.constraints, `${path}.constraints`, issues);
    if (definition.valueType !== 'number' && definition.valueType !== 'range') {
      addIssue(issues, VALIDATION_ISSUE_CODES.INVALID_VALUE, `${path}.constraints`, 'Only numeric fields can define constraints.');
    } else if (constraints) {
      for (const key of ['min', 'max', 'step']) {
        if (constraints[key] !== undefined && (typeof constraints[key] !== 'number' || !Number.isFinite(constraints[key]))) {
          addIssue(issues, VALIDATION_ISSUE_CODES.INVALID_TYPE, `${path}.constraints.${key}`, 'Expected a finite number.');
        }
      }
      if (typeof constraints.min === 'number' && typeof constraints.max === 'number' && constraints.min > constraints.max) {
        addIssue(issues, VALIDATION_ISSUE_CODES.OUT_OF_RANGE, `${path}.constraints`, 'Minimum cannot exceed maximum.');
      }
      if (typeof constraints.step === 'number' && constraints.step <= 0) {
        addIssue(issues, VALIDATION_ISSUE_CODES.OUT_OF_RANGE, `${path}.constraints.step`, 'Step must be greater than zero.');
      }
    }
  }
  if (Object.hasOwn(definition, 'defaultValue')) validateFieldValue(definition, definition.defaultValue, `${path}.defaultValue`, issues);
}

function validatePosition(value: unknown, path: string, issues: ValidationIssue[]): void {
  const position = requireRecord(value, path, issues);
  if (!position || !Number.isInteger(position.sequence) || (position.sequence as number) < 0) {
    addIssue(issues, VALIDATION_ISSUE_CODES.OUT_OF_RANGE, `${path}.sequence`, 'Expected a non-negative integer.');
  }
}

function validateProposition(value: unknown, path: string, issues: ValidationIssue[]): void {
  const proposition = requireRecord(value, path, issues);
  if (!proposition) return;
  requireString(proposition, 'subjectId', path, issues);
  requireString(proposition, 'predicate', path, issues);
  if (!Object.hasOwn(proposition, 'object')) addIssue(issues, VALIDATION_ISSUE_CODES.REQUIRED, `${path}.object`, 'Expected a proposition object value.');
}

function validateKnowledgeValue(value: unknown, path: string, issues: ValidationIssue[]): void {
  const knowledge = requireRecord(value, path, issues);
  if (!knowledge) return;
  requireString(knowledge, 'id', path, issues);
  if (knowledge.entryId !== undefined) requireString(knowledge, 'entryId', path, issues);
  requireString(knowledge, 'subjectId', path, issues);
  requireString(knowledge, 'sourceEventId', path, issues);
  validateProposition(knowledge.proposition, `${path}.proposition`, issues);
  requireEnum(knowledge, 'acquisition', ['participant', 'witness', 'reported', 'inferred'], path, issues);
  requireConfidence(knowledge, 'confidence', path, issues);
  requireEnum(knowledge, 'accessibility', ['available', 'suppressed', 'inaccessible'], path, issues);
  requireEnum(knowledge, 'status', ['active', 'forgotten', 'revoked', 'superseded'], path, issues);
  optionalEnum(knowledge, 'category', KNOWLEDGE_CATEGORY_VALUES, path, issues);
  if (knowledge.factIds !== undefined) requireStringArray(knowledge, 'factIds', path, issues);
  if (knowledge.informantIds !== undefined) requireStringArray(knowledge, 'informantIds', path, issues);
}

function validateAwarenessValue(value: unknown, path: string, issues: ValidationIssue[]): void {
  const awareness = requireRecord(value, path, issues);
  if (!awareness) return;
  requireString(awareness, 'id', path, issues);
  requireString(awareness, 'subjectId', path, issues);
  requireString(awareness, 'targetId', path, issues);
  requireEnum(awareness, 'status', ['active', 'forgotten', 'revoked', 'superseded'], path, issues);
  requireString(awareness, 'sourceEventId', path, issues);
}

function validateBeliefValue(value: unknown, path: string, issues: ValidationIssue[]): void {
  const belief = requireRecord(value, path, issues);
  if (!belief) return;
  requireString(belief, 'id', path, issues);
  if (belief.entryId !== undefined) requireString(belief, 'entryId', path, issues);
  requireString(belief, 'subjectId', path, issues);
  requireString(belief, 'sourceEventId', path, issues);
  validateProposition(belief.proposition, `${path}.proposition`, issues);
  requireConfidence(belief, 'confidence', path, issues);
  requireEnum(belief, 'relationToCanon', ['aligned', 'contradicted', 'uncertain', 'unknown'], path, issues);
  requireEnum(belief, 'status', ['active', 'superseded', 'abandoned'], path, issues);
  optionalEnum(belief, 'category', KNOWLEDGE_CATEGORY_VALUES, path, issues);
  if (belief.factIds !== undefined) requireStringArray(belief, 'factIds', path, issues);
}

function validateNarrativeMemoryValue(value: unknown, path: string, issues: ValidationIssue[]): void {
  const memory = requireRecord(value, path, issues);
  if (!memory) return;
  requireString(memory, 'id', path, issues);
  requireString(memory, 'subjectId', path, issues);
  requireString(memory, 'eventId', path, issues);
  requireString(memory, 'summary', path, issues);
  requireEnum(memory, 'accessibility', ['available', 'suppressed', 'inaccessible'], path, issues);
  optionalEnum(memory, 'category', MEMORY_CATEGORY_VALUES, path, issues);
  if (memory.status !== undefined) requireEnum(memory, 'status', ['active', 'superseded', 'forgotten'], path, issues);
  if (memory.supersedesMemoryId !== undefined) requireString(memory, 'supersedesMemoryId', path, issues);
  if (memory.relatedEntityIds !== undefined) requireStringArray(memory, 'relatedEntityIds', path, issues);
}

function validateRelationshipValue(value: unknown, path: string, issues: ValidationIssue[]): void {
  const relationship = requireRecord(value, path, issues);
  if (!relationship) return;
  requireString(relationship, 'id', path, issues);
  requireString(relationship, 'sourceEntityId', path, issues);
  requireString(relationship, 'targetEntityId', path, issues);
  requireString(relationship, 'dimension', path, issues);
  if (relationship.title !== undefined && typeof relationship.title !== 'string') {
    addIssue(issues, VALIDATION_ISSUE_CODES.INVALID_TYPE, `${path}.title`, 'Expected a string.');
  }
  requireRelationshipValue(relationship, 'value', path, issues);
  if (relationship.previousValue !== undefined) requireRelationshipValue(relationship, 'previousValue', path, issues);
  if (relationship.description !== undefined && typeof relationship.description !== 'string') {
    addIssue(issues, VALIDATION_ISSUE_CODES.INVALID_TYPE, `${path}.description`, 'Expected a string.');
  }
  optionalEnum(relationship, 'cause', RELATIONSHIP_CAUSE_VALUES, path, issues);
  requireString(relationship, 'sourceEventId', path, issues);
  if (relationship.status !== undefined) requireEnum(relationship, 'status', ['retired'], path, issues);
}

function validateEvidence(value: unknown, path: string, issues: ValidationIssue[]): void {
  const evidence = requireRecord(value, path, issues);
  if (!evidence) return;
  requireString(evidence, 'id', path, issues);
  requireString(evidence, 'originId', path, issues);
  if (!['chat-message', 'writing-document', 'world-action', 'worldbuild-update', 'import'].includes(String(evidence.originType))) {
    addIssue(issues, VALIDATION_ISSUE_CODES.INVALID_VALUE, `${path}.originType`, 'Unknown evidence origin type.');
  }
}

function validateEvent(value: unknown, path: string, issues: ValidationIssue[]): void {
  const event = requireRecord(value, path, issues);
  if (!event) return;
  requireString(event, 'id', path, issues);
  requireString(event, 'description', path, issues);
  requireStringArray(event, 'evidenceIds', path, issues);
  if (!EVENT_TYPES.has(String(event.type))) addIssue(issues, VALIDATION_ISSUE_CODES.INVALID_VALUE, `${path}.type`, 'Unknown event type.');
  validatePosition(event.position, `${path}.position`, issues);
  if (!Array.isArray(event.participants) || event.participants.length === 0) {
    addIssue(issues, VALIDATION_ISSUE_CODES.EMPTY_COLLECTION, `${path}.participants`, 'Expected at least one participant.');
  } else {
    event.participants.forEach((value, index) => {
      const participant = requireRecord(value, `${path}.participants[${index}]`, issues);
      if (!participant) return;
      requireString(participant, 'entityId', `${path}.participants[${index}]`, issues);
      requireString(participant, 'role', `${path}.participants[${index}]`, issues);
    });
  }
}

function validateOperationPayload(operation: Record<string, unknown>, path: string, issues: ValidationIssue[]): void {
  const payloadKey = {
    'assert-fact': 'fact',
    'set-state': 'state',
    'record-observation': 'observation',
    'grant-awareness': 'awareness',
    'grant-knowledge': 'knowledge',
    'set-belief': 'belief',
    'record-memory': 'memory',
    'set-relationship': 'relationship'
  }[String(operation.type)];
  const payload = payloadKey ? requireRecord(operation[payloadKey], `${path}.${payloadKey}`, issues) : undefined;
  if (!payload) return;
  const payloadPath = `${path}.${payloadKey}`;

  switch (operation.type) {
    case 'assert-fact':
      requireString(payload, 'id', payloadPath, issues);
      validateProposition(payload.proposition, `${payloadPath}.proposition`, issues);
      requireEnum(payload, 'status', ['active', 'superseded', 'retracted'], payloadPath, issues);
      requireStringArray(payload, 'evidenceIds', payloadPath, issues);
      break;
    case 'set-state':
      requireString(payload, 'entityId', payloadPath, issues);
      requireString(payload, 'property', payloadPath, issues);
      if (!Object.hasOwn(payload, 'value')) addIssue(issues, VALIDATION_ISSUE_CODES.REQUIRED, `${payloadPath}.value`, 'Expected a state value.');
      validatePosition(payload.effectiveFrom, `${payloadPath}.effectiveFrom`, issues);
      break;
    case 'record-observation':
      requireString(payload, 'subjectId', payloadPath, issues);
      requireString(payload, 'eventId', payloadPath, issues);
      requireEnum(payload, 'method', ['participant', 'witness', 'reported', 'inferred'], payloadPath, issues);
      requireConfidence(payload, 'confidence', payloadPath, issues);
      break;
    case 'grant-awareness':
      validateAwarenessValue(payload, payloadPath, issues);
      break;
    case 'grant-knowledge':
      validateKnowledgeValue(payload, payloadPath, issues);
      break;
    case 'set-belief':
      validateBeliefValue(payload, payloadPath, issues);
      break;
    case 'record-memory':
      validateNarrativeMemoryValue(payload, payloadPath, issues);
      break;
    case 'set-relationship':
      validateRelationshipValue(payload, payloadPath, issues);
      break;
  }
}

function validateOperation(value: unknown, path: string, issues: ValidationIssue[]): void {
  const operation = requireRecord(value, path, issues);
  if (!operation) return;
  requireString(operation, 'id', path, issues);
  requireStringArray(operation, 'evidenceIds', path, issues);
  if (!OPERATION_TYPES.has(String(operation.type))) {
    addIssue(issues, VALIDATION_ISSUE_CODES.INVALID_VALUE, `${path}.type`, 'Unknown narrative operation type.');
    return;
  }
  validateOperationPayload(operation, path, issues);
}

function validateReferences(proposal: Record<string, unknown>, issues: ValidationIssue[]): void {
  const evidence = proposal.evidence as EvidenceReference[];
  const changeSet = proposal.changeSet as { event: NarrativeEvent; operations: NarrativeOperation[] };
  if (!Array.isArray(evidence) || !isRecord(changeSet)) return;
  const knownEvidenceIds = new Set(evidence.filter(isRecord).map(item => item.id).filter((id): id is string => typeof id === 'string'));
  const referencedIds = [
    ...(Array.isArray(changeSet.event?.evidenceIds) ? changeSet.event.evidenceIds : []),
    ...(Array.isArray(changeSet.operations) ? changeSet.operations.flatMap(operation => operation.evidenceIds ?? []) : [])
  ];
  for (const id of referencedIds) {
    if (!knownEvidenceIds.has(id)) addIssue(issues, VALIDATION_ISSUE_CODES.INVALID_REFERENCE, '$.changeSet', `Unknown evidence reference: ${id}.`);
  }
}

function result<T>(value: unknown, issues: ValidationIssue[]): ValidationResult<T> {
  return issues.length ? { success: false, issues } : { success: true, value: value as T };
}

export function validateEvidenceReference(value: unknown): ValidationResult<EvidenceReference> {
  const issues: ValidationIssue[] = [];
  validateEvidence(value, '$', issues);
  return result(value, issues);
}

export function validateEntityReference(value: unknown): ValidationResult<EntityReference> {
  const issues: ValidationIssue[] = [];
  const entity = requireRecord(value, '$', issues);
  if (!entity) return { success: false, issues };
  requireString(entity, 'id', '$', issues);
  requireString(entity, 'projectId', '$', issues);
  requireString(entity, 'typeId', '$', issues);
  requireString(entity, 'name', '$', issues);
  requireStringArray(entity, 'aliases', '$', issues);
  requireEnum(entity, 'kind', ENTITY_KINDS, '$', issues);
  const capabilities = requireStringArray(entity, 'capabilities', '$', issues);
  capabilities.forEach((capability, index) => {
    if (!ENTITY_CAPABILITIES.includes(capability)) addIssue(issues, VALIDATION_ISSUE_CODES.INVALID_VALUE, `$.capabilities[${index}]`, 'Unknown entity capability.');
  });
  if (new Set(capabilities).size !== capabilities.length) addIssue(issues, VALIDATION_ISSUE_CODES.INVALID_VALUE, '$.capabilities', 'Entity capabilities must be unique.');
  return result(value, issues);
}

export function validateEntityFieldDefinition(value: unknown): ValidationResult<EntityFieldDefinition> {
  const issues: ValidationIssue[] = [];
  validateEntityFieldDefinitionValue(value, '$', issues);
  return result(value, issues);
}

export function validateNarrativeEvent(value: unknown): ValidationResult<NarrativeEvent> {
  const issues: ValidationIssue[] = [];
  validateEvent(value, '$', issues);
  return result(value, issues);
}

export function validateNarrativeOperation(value: unknown): ValidationResult<NarrativeOperation> {
  const issues: ValidationIssue[] = [];
  validateOperation(value, '$', issues);
  return result(value, issues);
}

export function validateKnowledge(value: unknown): ValidationResult<Knowledge> {
  const issues: ValidationIssue[] = [];
  validateKnowledgeValue(value, '$', issues);
  return result(value, issues);
}

export function validateAwareness(value: unknown): ValidationResult<Awareness> {
  const issues: ValidationIssue[] = [];
  validateAwarenessValue(value, '$', issues);
  return result(value as Awareness, issues);
}

export function validateBelief(value: unknown): ValidationResult<Belief> {
  const issues: ValidationIssue[] = [];
  validateBeliefValue(value, '$', issues);
  return result(value, issues);
}

export function validateNarrativeMemory(value: unknown): ValidationResult<NarrativeMemory> {
  const issues: ValidationIssue[] = [];
  validateNarrativeMemoryValue(value, '$', issues);
  return result(value, issues);
}

export function validateRelationshipState(value: unknown): ValidationResult<RelationshipState> {
  const issues: ValidationIssue[] = [];
  validateRelationshipValue(value, '$', issues);
  return result(value, issues);
}

export function validateScene(value: unknown): ValidationResult<Scene> {
  const issues: ValidationIssue[] = [];
  const scene = requireRecord(value, '$', issues);
  if (!scene) return { success: false, issues };
  requireString(scene, 'id', '$', issues);
  requireString(scene, 'projectId', '$', issues);
  requireEnum(scene, 'status', ['active', 'completed'], '$', issues);
  requireStringArray(scene, 'participantIds', '$', issues);
  requireStringArray(scene, 'possibleObserverIds', '$', issues);
  validatePosition(scene.position, '$.position', issues);
  const perspective = requireRecord(scene.perspective, '$.perspective', issues);
  if (perspective) {
    requireEnum(perspective, 'access', ['subjective', 'omniscient', 'explicit'], '$.perspective', issues);
    if (perspective.access === 'subjective') requireString(perspective, 'focalSubjectId', '$.perspective', issues);
    if (perspective.access === 'explicit') requireStringArray(perspective, 'allowedSubjectIds', '$.perspective', issues);
  }
  if (scene.origin !== undefined) validateEvidence({ id: 'scene-origin', ...scene.origin }, '$.origin', issues);
  return result(value, issues);
}

export function validateNarrativeProjection(value: unknown): ValidationResult<NarrativeProjection> {
  const issues: ValidationIssue[] = [];
  const projection = requireRecord(value, '$', issues);
  if (!projection) return { success: false, issues };
  requireString(projection, 'projectId', '$', issues);
  validatePosition(projection.through, '$.through', issues);
  const collections = [
    { key: 'facts', type: 'assert-fact', payloadKey: 'fact' },
    { key: 'states', type: 'set-state', payloadKey: 'state' },
    { key: 'awareness', type: 'grant-awareness', payloadKey: 'awareness' },
    { key: 'knowledge', type: 'grant-knowledge', payloadKey: 'knowledge' },
    { key: 'beliefs', type: 'set-belief', payloadKey: 'belief' },
    { key: 'relationships', type: 'set-relationship', payloadKey: 'relationship' }
  ] as const;
  for (const collection of collections) {
    const values = projection[collection.key];
    if (!Array.isArray(values)) {
      addIssue(issues, VALIDATION_ISSUE_CODES.INVALID_TYPE, `$.${collection.key}`, 'Expected an array.');
      continue;
    }
    values.forEach((item, index) => {
      validateOperationPayload(
        { type: collection.type, [collection.payloadKey]: item },
        `$.${collection.key}[${index}]`,
        issues
      );
    });
  }
  return result(value, issues);
}

export function validateNarrativeProposal(value: unknown): ValidationResult<NarrativeProposal> {
  const issues: ValidationIssue[] = [];
  const proposal = requireRecord(value, '$', issues);
  if (!proposal) return { success: false, issues };

  requireString(proposal, 'id', '$', issues);
  requireString(proposal, 'projectId', '$', issues);
  if (!isSupportedContractVersion(proposal.contractVersion)) addIssue(issues, VALIDATION_ISSUE_CODES.UNSUPPORTED_VERSION, '$.contractVersion', 'Unsupported narrative contract version.');
  if (proposal.status !== 'proposed') addIssue(issues, VALIDATION_ISSUE_CODES.INVALID_VALUE, '$.status', 'A proposal must have proposed status.');

  const evidence = proposal.evidence;
  if (!Array.isArray(evidence) || evidence.length === 0) addIssue(issues, VALIDATION_ISSUE_CODES.EMPTY_COLLECTION, '$.evidence', 'Expected at least one evidence reference.');
  else evidence.forEach((item, index) => validateEvidence(item, `$.evidence[${index}]`, issues));

  const changeSet = requireRecord(proposal.changeSet, '$.changeSet', issues);
  if (changeSet) {
    requireString(changeSet, 'id', '$.changeSet', issues);
    validateEvent(changeSet.event, '$.changeSet.event', issues);
    if (!Array.isArray(changeSet.operations) || changeSet.operations.length === 0) addIssue(issues, VALIDATION_ISSUE_CODES.EMPTY_COLLECTION, '$.changeSet.operations', 'Expected at least one narrative operation.');
    else changeSet.operations.forEach((item, index) => validateOperation(item, `$.changeSet.operations[${index}]`, issues));
  }

  const provenance = requireRecord(proposal.provenance, '$.provenance', issues);
  if (provenance) {
    requireString(provenance, 'createdAt', '$.provenance', issues);
    if (!['user', 'deterministic', 'model'].includes(String(provenance.interpreter))) addIssue(issues, VALIDATION_ISSUE_CODES.INVALID_VALUE, '$.provenance.interpreter', 'Unknown interpreter type.');
    if (provenance.schemaVersion !== NARRATIVE_CONTRACT_VERSION) addIssue(issues, VALIDATION_ISSUE_CODES.UNSUPPORTED_VERSION, '$.provenance.schemaVersion', 'Provenance schema version must match the contract.');
  }

  validateReferences(proposal, issues);
  return result(proposal, issues);
}
