import {
  ContextBundlePlanner,
  type ContextBundleCompositionMetrics,
  type ContextBundleResult,
  type EpistemicAssessment,
  type ScopedContextCandidate
} from '../../../kanora/context-bundle';
import type { ContextCandidate, ContextPlanResult } from '../../../kanora/context-planner';
import type { NarrativePosition } from '../../../kanora/contracts';

export interface RoleplayContextSubject {
  id: string;
  name: string;
  kind: 'player' | 'actor';
  candidates: ContextCandidate[];
}

export interface RoleplayContextOrchestrationInput {
  requestId: string;
  workspaceId: string;
  query: string;
  through: NarrativePosition;
  tokenBudget: number;
  authorityCandidates: ContextCandidate[];
  evidenceCandidates: ContextCandidate[];
  subjects: RoleplayContextSubject[];
  assessments: EpistemicAssessment[];
  targetNames: Map<string, string>;
}

export interface RoleplayContextOrchestration {
  bundle: ContextBundleResult;
  context: string;
  playerPlan?: ContextPlanResult;
  deepenedPairs: Array<{ subjectId: string; targetId: string }>;
}

type ContextPackageItem = ContextPlanResult['package']['items'][number];

interface ComposedRecord {
  item: ContextPackageItem;
  content: string;
  scopeIds: Set<string>;
  order: number;
}

interface ComposedRoleplayContext {
  context: string;
  metrics: ContextBundleCompositionMetrics;
}

export class RoleplayContextOrchestrator {
  private readonly planner = new ContextBundlePlanner();

  constructor(private readonly estimateTokens: (text: string) => number) {}

  plan(input: RoleplayContextOrchestrationInput): RoleplayContextOrchestration {
    const actorCount = Math.max(1, input.subjects.filter(subject => subject.kind === 'actor').length);
    const scopes = [
      {
        id: 'authority',
        label: 'Narrative Authority',
        priority: 100,
        perspective: { access: 'omniscient' as const },
        tokenLimit: Math.ceil(input.tokenBudget * 0.45)
      },
      ...input.subjects.map((subject, index) => ({
        id: `subject:${subject.id}`,
        label: subject.kind === 'player'
          ? `Player Perspective: ${subject.name}`
          : `Scene Actor Perspective: ${subject.name}`,
        priority: subject.kind === 'player' ? 90 : Math.max(60, 80 - index),
        perspective: { access: 'subjective' as const, focalSubjectId: subject.id },
        tokenLimit: Math.ceil(input.tokenBudget * (subject.kind === 'player' ? 0.25 : 0.2 / actorCount))
      })),
      {
        id: 'evidence',
        label: 'Unresolved Story Evidence',
        priority: 40,
        perspective: { access: 'omniscient' as const },
        tokenLimit: Math.ceil(input.tokenBudget * 0.1)
      }
    ];
    const scoped: ScopedContextCandidate[] = [
      ...input.authorityCandidates.map(candidate => ({ scopeIds: ['authority'], candidate })),
      ...input.subjects.flatMap(subject => subject.candidates.map(candidate => ({
        scopeIds: [`subject:${subject.id}`],
        candidate
      }))),
      ...input.evidenceCandidates.map(candidate => ({ scopeIds: ['evidence'], candidate }))
    ];
    const bundle = this.planner.plan({
      id: input.requestId,
      workspaceId: input.workspaceId,
      query: input.query,
      through: input.through,
      tokenBudget: input.tokenBudget,
      policy: { allowInaccessible: false },
      scopes
    }, scoped);
    const composed = composeRoleplayContext(
      bundle,
      input.subjects,
      input.assessments,
      input.targetNames,
      this.estimateTokens
    );
    bundle.composition = composed.metrics;
    bundle.usedTokens = composed.metrics.renderedTokens;
    const player = input.subjects.find(subject => subject.kind === 'player');
    const playerScope = player
      ? bundle.scopes.find(scope => scope.scopeId === `subject:${player.id}`)
      : undefined;
    const playerPlan = playerScope ? {
      decisions: bundle.decisions
        .filter(decision => decision.scopeId === playerScope.scopeId)
        .map(({ scopeId: _scopeId, ...decision }) => decision),
      package: playerScope.package
    } : undefined;
    return {
      bundle,
      context: composed.context,
      playerPlan,
      deepenedPairs: findDeepenedPairs(bundle, input.subjects, input.assessments)
    };
  }
}

function composeRoleplayContext(
  bundle: ContextBundleResult,
  subjects: RoleplayContextSubject[],
  assessments: EpistemicAssessment[],
  targetNames: Map<string, string>,
  estimateTokens: (text: string) => number
): ComposedRoleplayContext {
  const subjectByScope = new Map(subjects.map(subject => [`subject:${subject.id}`, subject]));
  const records = collectRecords(bundle);
  compactKnownEntityRecords(records);
  const exclusiveByScope = new Map<string, ComposedRecord[]>();
  const sharedBySignature = new Map<string, ComposedRecord[]>();
  records.forEach(record => {
    const scopeIds = [...record.scopeIds];
    if (scopeIds.length === 1) {
      const values = exclusiveByScope.get(scopeIds[0]) ?? [];
      values.push(record);
      exclusiveByScope.set(scopeIds[0], values);
      return;
    }
    const signature = getScopeSignature(bundle, record.scopeIds);
    const values = sharedBySignature.get(signature) ?? [];
    values.push(record);
    sharedBySignature.set(signature, values);
  });

  const sections: string[] = [];
  appendScopeSection(sections, bundle, 'authority', exclusiveByScope, subjectByScope, assessments, targetNames);
  [...sharedBySignature.values()]
    .sort((left, right) => left[0].order - right[0].order)
    .forEach(group => sections.push(formatSharedSection(bundle, group, subjectByScope)));
  bundle.scopes
    .filter(scope => scope.scopeId !== 'authority' && scope.scopeId !== 'evidence')
    .forEach(scope => appendScopeSection(
      sections,
      bundle,
      scope.scopeId,
      exclusiveByScope,
      subjectByScope,
      assessments,
      targetNames
    ));
  appendScopeSection(sections, bundle, 'evidence', exclusiveByScope, subjectByScope, assessments, targetNames);

  const context = sections.length
    ? [
      '--- ROLEPLAY NARRATIVE CONTEXT ---',
      'Each record is rendered once. Section headers define which perspectives may use it. A character may only know a record when their perspective is named.',
      ...sections
    ].join('\n\n')
    : '';
  const scopeMemberships = records.reduce((total, record) => total + record.scopeIds.size, 0);
  return {
    context,
    metrics: {
      uniqueRecords: records.length,
      sharedRecords: records.filter(record => record.scopeIds.size > 1).length,
      scopeMemberships,
      avoidedDuplicateRenderings: scopeMemberships - records.length,
      avoidedContentTokens: Math.max(
        0,
        records.reduce(
          (total, record) => total + estimateTokens(record.item.content) * record.scopeIds.size,
          0
        ) - records.reduce((total, record) => total + estimateTokens(record.content), 0)
      ),
      renderedTokens: estimateTokens(context)
    }
  };
}

function collectRecords(bundle: ContextBundleResult): ComposedRecord[] {
  const records = new Map<string, ComposedRecord>();
  let order = 0;
  bundle.scopes.forEach(scope => {
    scope.package.items.forEach(item => {
      const key = [item.candidateId, item.source.type, item.source.id, item.content].join('\u0000');
      const existing = records.get(key);
      if (existing) {
        existing.scopeIds.add(scope.scopeId);
        return;
      }
      records.set(key, { item, content: item.content, scopeIds: new Set([scope.scopeId]), order: order++ });
    });
  });
  return [...records.values()];
}

function compactKnownEntityRecords(records: ComposedRecord[]): void {
  const canonicalNames = new Map<string, string>();
  records.forEach(record => {
    const match = /^entity:(.+)$/.exec(record.item.candidateId);
    if (!match || !record.scopeIds.has('authority')) return;
    canonicalNames.set(match[1], record.item.content.split(/\r?\n/, 1)[0].replace(/\s+\([^)]+\)$/, ''));
  });
  records.forEach(record => {
    const match = /^known-entity:[^:]+:(.+)$/.exec(record.item.candidateId);
    const canonicalName = match ? canonicalNames.get(match[1]) : undefined;
    if (!canonicalName) return;
    const lines = record.item.content.split(/\r?\n/).filter(Boolean);
    const knownAs = lines[0]?.replace(/^Known identity:\s*/i, '').trim() || canonicalName;
    const fields = [...new Set(lines.slice(1).flatMap(line => {
      const separator = line.indexOf(':');
      return separator > 0 ? [line.slice(0, separator).trim()] : [];
    }))];
    record.content = [
      `Known entity reference: ${knownAs}`,
      `Canonical entity record: ${canonicalName}`,
      ...(fields.length ? [`Authorized fields from the canonical entity record: ${fields.join(', ')}`] : [])
    ].join('\n');
  });
}

function getScopeSignature(bundle: ContextBundleResult, scopeIds: Set<string>): string {
  return bundle.scopes
    .filter(scope => scopeIds.has(scope.scopeId))
    .map(scope => scope.scopeId)
    .join('|');
}

function appendScopeSection(
  sections: string[],
  bundle: ContextBundleResult,
  scopeId: string,
  exclusiveByScope: Map<string, ComposedRecord[]>,
  subjectByScope: Map<string, RoleplayContextSubject>,
  assessments: EpistemicAssessment[],
  targetNames: Map<string, string>
): void {
  const scope = bundle.scopes.find(candidate => candidate.scopeId === scopeId);
  if (!scope) return;
  const subject = subjectByScope.get(scopeId);
  const awareness = subject
    ? assessments
      .filter(assessment => assessment.subjectId === subject.id)
      .map(assessment => formatAssessment(assessment, targetNames))
    : [];
  const records = exclusiveByScope.get(scopeId) ?? [];
  if (!records.length && !awareness.length) return;
  sections.push([
    `--- ${scope.label.toUpperCase()} ---`,
    scopeGuidance(scopeId, subject),
    ...(awareness.length ? ['Awareness map:', ...awareness] : []),
    ...records.map(record => record.content)
  ].join('\n'));
}

function formatSharedSection(
  bundle: ContextBundleResult,
  records: ComposedRecord[],
  subjectByScope: Map<string, RoleplayContextSubject>
): string {
  const scopeIds = records[0].scopeIds;
  const hasAuthority = scopeIds.has('authority');
  const hasEvidence = scopeIds.has('evidence');
  const subjects = bundle.scopes
    .filter(scope => scopeIds.has(scope.scopeId))
    .flatMap(scope => {
      const subject = subjectByScope.get(scope.scopeId);
      return subject ? [subject.name] : [];
    });
  const labels = bundle.scopes
    .filter(scope => scopeIds.has(scope.scopeId))
    .map(scope => scope.label);
  const title = hasAuthority && subjects.length
    ? `SHARED CANON: KNOWN TO ${subjects.join(', ').toUpperCase()}`
    : subjects.length
      ? `SHARED SUBJECT CONTEXT: ${subjects.join(', ').toUpperCase()}`
      : `SHARED CONTEXT: ${labels.join(', ').toUpperCase()}`;
  const guidance = hasAuthority && subjects.length
    ? `These records are world truth and are known to: ${subjects.join(', ')}. Do not treat them as known by other characters.`
    : hasAuthority
      ? 'These records are world truth shared by the named non-character scopes. They do not define character knowledge.'
    : hasEvidence
      ? 'These records are unresolved story evidence shared by the named scopes. They are not automatically canon.'
      : `These records are available only to: ${subjects.join(', ')}.`;
  return [
    `--- ${title} ---`,
    guidance,
    ...records.map(record => record.content)
  ].join('\n');
}

function scopeGuidance(scopeId: string, subject?: RoleplayContextSubject): string {
  if (scopeId === 'authority') {
    return 'Use this section to keep world causality and current state coherent. It does not define what any character knows.';
  }
  if (scopeId === 'evidence') {
    return 'This material is story evidence for the narrator. It is not automatically canon or character knowledge.';
  }
  if (subject?.kind === 'player') {
    return 'Use this section to determine familiarity, novelty, and what may be described directly to the player.';
  }
  return 'Use this private section only to drive this actor’s behavior, dialogue, and reactions. Do not reveal private information directly.';
}

function formatAssessment(assessment: EpistemicAssessment, targetNames: Map<string, string>): string {
  const target = targetNames.get(assessment.targetId) ?? assessment.targetId;
  const source = assessment.sourceIds.length ? `; sources: ${assessment.sourceIds.join(', ')}` : '';
  const evidence = assessment.evidence ? `; evidence: ${assessment.evidence}` : '';
  return `- ${target}: ${assessment.state}${source}${evidence}`;
}

function findDeepenedPairs(
  bundle: ContextBundleResult,
  subjects: RoleplayContextSubject[],
  assessments: EpistemicAssessment[]
): Array<{ subjectId: string; targetId: string }> {
  const includedBySubject = new Map(subjects.map(subject => {
    const scope = bundle.scopes.find(candidate => candidate.scopeId === `subject:${subject.id}`);
    const provenanceIds = new Set(scope?.package.items.flatMap(item => item.provenanceIds) ?? []);
    return [subject.id, provenanceIds];
  }));
  return assessments.flatMap(assessment => {
    if (assessment.state !== 'confirmed' && assessment.state !== 'derived') return [];
    const included = includedBySubject.get(assessment.subjectId);
    return included?.has(assessment.targetId)
      ? [{ subjectId: assessment.subjectId, targetId: assessment.targetId }]
      : [];
  });
}
