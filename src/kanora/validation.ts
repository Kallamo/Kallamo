import {
  KANORA_CONTRACT_VERSION,
  type EvidenceReference,
  type NarrativeEvent,
  type NarrativeOperation,
  type NarrativeProposal,
  type NarrativeProjection,
  type Scene,
  type Proposition
} from './contracts';
import { isSupportedContractVersion } from './versioning';

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
const OPERATION_TYPES = new Set(['assert-fact', 'set-state', 'record-observation', 'grant-knowledge', 'set-belief', 'record-memory', 'set-relationship']);

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

function requireNumber(record: Record<string, unknown>, key: string, path: string, issues: ValidationIssue[]): void {
  if (typeof record[key] !== 'number' || !Number.isFinite(record[key])) {
    addIssue(issues, VALIDATION_ISSUE_CODES.INVALID_TYPE, `${path}.${key}`, 'Expected a finite number.');
  }
}

function requireEnum(record: Record<string, unknown>, key: string, values: string[], path: string, issues: ValidationIssue[]): void {
  if (!values.includes(String(record[key]))) addIssue(issues, VALIDATION_ISSUE_CODES.INVALID_VALUE, `${path}.${key}`, `Expected one of: ${values.join(', ')}.`);
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

function validateEvidence(value: unknown, path: string, issues: ValidationIssue[]): void {
  const evidence = requireRecord(value, path, issues);
  if (!evidence) return;
  requireString(evidence, 'id', path, issues);
  requireString(evidence, 'originId', path, issues);
  if (!['chat-message', 'writing-document', 'world-action', 'import'].includes(String(evidence.originType))) {
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
    case 'grant-knowledge':
      requireString(payload, 'id', payloadPath, issues);
      requireString(payload, 'subjectId', payloadPath, issues);
      requireString(payload, 'sourceEventId', payloadPath, issues);
      validateProposition(payload.proposition, `${payloadPath}.proposition`, issues);
      requireEnum(payload, 'acquisition', ['participant', 'witness', 'reported', 'inferred'], payloadPath, issues);
      requireConfidence(payload, 'confidence', payloadPath, issues);
      requireEnum(payload, 'status', ['active', 'forgotten', 'revoked', 'superseded'], payloadPath, issues);
      break;
    case 'set-belief':
      requireString(payload, 'id', payloadPath, issues);
      requireString(payload, 'subjectId', payloadPath, issues);
      requireString(payload, 'sourceEventId', payloadPath, issues);
      validateProposition(payload.proposition, `${payloadPath}.proposition`, issues);
      requireConfidence(payload, 'confidence', payloadPath, issues);
      requireEnum(payload, 'relationToCanon', ['aligned', 'contradicted', 'uncertain', 'unknown'], payloadPath, issues);
      requireEnum(payload, 'status', ['active', 'superseded', 'abandoned'], payloadPath, issues);
      break;
    case 'record-memory':
      requireString(payload, 'id', payloadPath, issues);
      requireString(payload, 'subjectId', payloadPath, issues);
      requireString(payload, 'eventId', payloadPath, issues);
      requireString(payload, 'summary', payloadPath, issues);
      requireEnum(payload, 'accessibility', ['available', 'suppressed', 'inaccessible'], payloadPath, issues);
      break;
    case 'set-relationship':
      requireString(payload, 'id', payloadPath, issues);
      requireString(payload, 'sourceEntityId', payloadPath, issues);
      requireString(payload, 'targetEntityId', payloadPath, issues);
      requireString(payload, 'dimension', payloadPath, issues);
      requireNumber(payload, 'value', payloadPath, issues);
      requireString(payload, 'sourceEventId', payloadPath, issues);
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
  if (!isSupportedContractVersion(proposal.contractVersion)) addIssue(issues, VALIDATION_ISSUE_CODES.UNSUPPORTED_VERSION, '$.contractVersion', 'Unsupported Kanora contract version.');
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
    if (provenance.schemaVersion !== KANORA_CONTRACT_VERSION) addIssue(issues, VALIDATION_ISSUE_CODES.UNSUPPORTED_VERSION, '$.provenance.schemaVersion', 'Provenance schema version must match the contract.');
  }

  validateReferences(proposal, issues);
  return result(proposal, issues);
}
