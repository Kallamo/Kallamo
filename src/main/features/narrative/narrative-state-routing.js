const NARRATIVE_DOMAINS = [
  'entity',
  'scene',
  'resource',
  'inventory',
  'awareness',
  'knowledge',
  'belief',
  'memory',
  'relationship',
  'fact',
];

/**
 * Only mechanical domains may be decided by a pattern: the evidence is in the words. Whether
 * dialogue produced lasting knowledge is a judgement about consequence, so the epistemic ones are absent.
 */
const MECHANICAL_DOMAINS = new Set([
  'entity',
  'scene',
  'resource',
  'inventory',
]);

const EPISTEMIC_DOMAINS = new Set([
  'awareness',
  'knowledge',
  'belief',
  'memory',
  'relationship',
  'fact',
]);

const SIGNAL_PATTERNS = [
  {
    domain: 'inventory',
    action: 'equip',
    strong: true,
    pattern: /\b(equip(?:s|ped|ping)?|unequip(?:s|ped|ping)?|wear(?:s|ing)?|wore|draw(?:s|n)?|sheathe[ds]?|brandishe[ds]?)\b/i,
  },
  {
    domain: 'inventory',
    action: 'transfer',
    strong: true,
    pattern: /\b(gave|given|hand(?:s|ed|ing)?|pass(?:es|ed|ing)?|transfer(?:s|red|ring)?|receiv(?:e[sd]?|ing)|took from)\b/i,
  },
  {
    domain: 'inventory',
    action: 'drop',
    strong: true,
    pattern: /\b(drop(?:s|ped|ping)?|discard(?:s|ed|ing)?|leave(?:s)? (?:it|them) (?:on|at)|left (?:it|them) (?:on|at))\b/i,
  },
  {
    domain: 'inventory',
    action: 'pick-up',
    strong: true,
    pattern: /\b(pick(?:s|ed|ing)? up|collect(?:s|ed|ing)?|retrieve[ds]?|grab(?:s|bed|bing)?)\b/i,
  },
  {
    domain: 'inventory',
    action: 'consume',
    strong: true,
    pattern: /\b(drank|drink(?:s|ing)?|ate|eat(?:s|ing)?|consum(?:e[ds]?|ing)|used up)\b/i,
  },
  {
    domain: 'inventory',
    action: 'lose',
    strong: true,
    pattern: /\b(lost|lose[sd]?|stole|stolen|robbed)\b/i,
  },
  {
    domain: 'scene',
    action: 'movement',
    strong: true,
    pattern: /\b(enter(?:s|ed|ing)?|arrive[sd]?|leave[sd]?|depart(?:s|ed)?|approach(?:es|ed)?|sit(?:s|ting)? down|sat down|descend(?:s|ed)?|ascend(?:s|ed)?)\b/i,
  },
  {
    domain: 'resource',
    action: 'resource-change',
    strong: true,
    pattern: /\b(gain(?:s|ed)?|lose[sd]?|spend(?:s|ing)?|spent|heal(?:s|ed)?|recover(?:s|ed)?|damage[sd]?|restore[sd]?)\b/i,
  },
  {
    domain: 'knowledge',
    action: 'disclosure',
    strong: false,
    pattern: /\b(reveal(?:s|ed)?|explain(?:s|ed)?|inform(?:s|ed)?|confess(?:es|ed)?|warn(?:s|ed)?|teach(?:es|t)?|discover(?:s|ed)?|recognize[sd]?)\b/i,
  },
  {
    domain: 'knowledge',
    action: 'dialogue',
    strong: false,
    pattern: /(^|\n)\s*[—-]\s*\p{L}|["“”][^"“”]{2,}["“”]/u,
  },
  {
    domain: 'relationship',
    action: 'relationship-change',
    strong: true,
    pattern: /\b(betray(?:s|ed)?|forgive[sn]?|swear(?:s)? loyalty|owes? (?:him|her|them)|romance[sd]?|betrayal)\b/i,
  },
  {
    domain: 'relationship',
    action: 'interaction',
    strong: false,
    pattern: /\b(speak(?:s|ing)? to|spoke to|talk(?:s|ed|ing)? to|address(?:es|ed)?|convers(?:e[sd]?|ing)|listen(?:s|ed|ing)? to|overhear(?:s|d|ing)?|hear(?:s|d|ing)? .*\b(?:say|speak|talk))\b/i,
  },
  {
    domain: 'entity',
    action: 'introduction',
    strong: true,
    pattern: /\b(introduc(?:e[sd]?|ing)|meet(?:s)? for the first time|named (?:himself|herself|themselves))\b/i,
  },
];

function normalizeNarrativeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase();
}

function parseAliases(value) {
  if (Array.isArray(value)) return value.map(String);
  try {
    const parsed = JSON.parse(String(value || '[]'));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return String(value || '').split(',').map(alias => alias.trim()).filter(Boolean);
  }
}

function containsName(text, name) {
  const normalizedName = normalizeNarrativeText(name).trim();
  if (normalizedName.length < 2) return false;
  const escaped = normalizedName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'u').test(text);
}

function findEvidence(text, pattern) {
  const match = pattern.exec(text);
  if (!match) return '';
  const start = Math.max(0, text.lastIndexOf('\n', match.index) + 1);
  const nextBreak = text.indexOf('\n', match.index + match[0].length);
  const end = nextBreak === -1 ? text.length : nextBreak;
  return text.slice(start, end).trim().slice(0, 320);
}

function extractNarrativeSignals({ userMessage, narrativeResponse, entities = [] }) {
  const sourceText = `${String(userMessage || '')}\n${String(narrativeResponse || '')}`;
  const normalizedText = normalizeNarrativeText(sourceText);
  const mentionedEntityIds = [];
  const mentionedItemIds = [];
  const mentionedActorIds = [];

  for (const entity of entities) {
    const names = [entity.canonicalName, ...parseAliases(entity.aliases)];
    if (!names.some(name => containsName(normalizedText, name))) continue;
    mentionedEntityIds.push(entity.id);
    if (entity.type === 'Items') mentionedItemIds.push(entity.id);
    if (entity.type === 'Characters' || entity.type === 'Creatures') mentionedActorIds.push(entity.id);
  }

  const signals = SIGNAL_PATTERNS.flatMap(definition => {
    const evidence = findEvidence(sourceText, definition.pattern);
    return evidence ? [{
      domain: definition.domain,
      action: definition.action,
      strength: definition.strong ? 'strong' : 'candidate',
      evidence,
    }] : [];
  });

  return {
    candidateDomains: unique(signals.map(signal => signal.domain)),
    strongDomains: unique(signals.filter(signal => signal.strength === 'strong').map(signal => signal.domain)),
    mentionedEntityIds: unique(mentionedEntityIds),
    mentionedItemIds: unique(mentionedItemIds),
    mentionedActorIds: unique(mentionedActorIds),
    signals: signals.slice(0, 12),
  };
}

function resolveNarrativeRouting({ triage, signals }) {
  const triageDomains = unique(
    (Array.isArray(triage?.types) ? triage.types : []).filter(type => NARRATIVE_DOMAINS.includes(type))
  );
  const selectedDomains = new Set(triage?.consequential ? triageDomains : []);
  const forceReasons = [];

  for (const domain of signals.strongDomains || []) {
    if (!MECHANICAL_DOMAINS.has(domain) || selectedDomains.has(domain)) continue;
    selectedDomains.add(domain);
    forceReasons.push(`explicit-${domain}-signal`);
  }

  const hasIntroduction = (signals.signals || []).some(signal => signal.domain === 'entity' && signal.action === 'introduction');
  if (selectedDomains.has('entity') && hasIntroduction) {
    if (!selectedDomains.has('scene')) {
      selectedDomains.add('scene');
      forceReasons.push('entity-presence-signal');
    }
    if (!selectedDomains.has('relationship')) {
      selectedDomains.add('relationship');
      forceReasons.push('entity-first-contact-signal');
    }
  }

  const changesSceneObjects = (signals.signals || []).some(signal =>
    signal.domain === 'inventory' && ['drop', 'pick-up', 'consume'].includes(signal.action)
  );
  if (selectedDomains.has('inventory') && changesSceneObjects && !selectedDomains.has('scene')) {
    selectedDomains.add('scene');
    forceReasons.push('inventory-scene-object-signal');
  }

  if (triage?.consequential && selectedDomains.size === 0) {
    for (const domain of signals.candidateDomains || []) selectedDomains.add(domain);
  }

  const domains = NARRATIVE_DOMAINS.filter(domain => selectedDomains.has(domain));
  // The epistemic domains share one prompt and one context, so naming several of them is one
  // breadth, not several; otherwise the cost would follow how many labels the triage wrote.
  const breadth = domains.filter(domain => !EPISTEMIC_DOMAINS.has(domain)).length + (hasEpistemicDomain(domains) ? 1 : 0);
  const requiresFullAnalysis = Boolean(triage?.requiresFullAnalysis) || breadth >= 4;
  if (requiresFullAnalysis && !triage?.requiresFullAnalysis) forceReasons.push('four-or-more-domains');
  // Overriding the triage costs a full analysis, so only mechanical evidence earns it.
  const forceDeepAnalysis = !triage?.consequential
    && domains.some(domain => MECHANICAL_DOMAINS.has(domain));

  return {
    selectedDomains: domains,
    forceDeepAnalysis,
    forceReasons,
    requiresFullAnalysis,
    mode: domains.length === 0
      ? 'none'
      : requiresFullAnalysis
        ? 'full'
        : domains.length === 1
          ? 'single-domain'
          : 'multi-domain',
  };
}

function compactNarrativeManifest(manifest, subjectIds, targetIds) {
  if (!manifest) return null;
  const subjects = new Set(subjectIds);
  const targets = new Set(targetIds);
  const assessments = (manifest.assessments || []).filter(assessment =>
    subjects.has(assessment.subjectId) && targets.has(assessment.targetId)
  );
  const deepenedPairs = (manifest.deepenedPairs || []).filter(pair =>
    subjects.has(pair.subjectId) && targets.has(pair.targetId)
  );
  return {
    requestId: manifest.requestId,
    sequence: manifest.sequence,
    sceneId: manifest.sceneId,
    playerSubjectId: manifest.playerSubjectId,
    subjectIds: (manifest.subjectIds || []).filter(subjectId => subjects.has(subjectId)),
    targetIds: (manifest.targetIds || []).filter(targetId => targets.has(targetId)),
    assessments,
    deepenedPairs,
  };
}

const HOLDER_RECORD_TYPES = new Set(['knowledge', 'belief', 'memory']);

/**
 * Presence decides how much of a perspective is read, never whether: someone left out of
 * presentIds still keeps what they hold about the focus.
 */
function resolveAnalysisHolders({ candidateIds, sceneIds, presentIds }) {
  const candidates = [...new Set(candidateIds)];
  if (!Array.isArray(presentIds)) return { present: new Set(candidates), mentioned: new Set() };
  const present = new Set([...sceneIds, ...presentIds].filter(id => candidates.includes(id)));
  return { present, mentioned: new Set(candidates.filter(id => !present.has(id))) };
}

/**
 * Knowledge, beliefs and memories only change for someone who perceived the turn, so they are kept
 * by holder; facts by what they are about. Relationships have their own baseline.
 * @param {Array<{ type: string, subjectId: string | null, value: any }>} rows
 * @param {{ holderIds: Iterable<string>, mentionedHolderIds?: Iterable<string>, targetIds: Iterable<string>, focusIds: Iterable<string>, limit?: number }} options
 */
function selectPerspectiveRecords(rows, { holderIds, mentionedHolderIds = [], targetIds, focusIds, limit = 120 }) {
  const holders = new Set(holderIds);
  const mentionedHolders = new Set(mentionedHolderIds);
  const targets = new Set(targetIds);
  const focus = new Set(focusIds);
  const active = (rows || []).filter(row => row.type !== 'relationship'
    && (row.value?.status === undefined || row.value.status === 'active'));
  const superseded = new Set(active.map(row => row.value.supersedesMemoryId).filter(Boolean));
  const scored = [];
  for (const row of active) {
    const value = row.value;
    if (row.type === 'memory' && superseded.has(value.id)) continue;
    const about = [value.proposition?.subjectId, value.entityId, ...(value.relatedEntityIds || [])].filter(Boolean);
    const inFocus = about.some(id => focus.has(id));
    if (HOLDER_RECORD_TYPES.has(row.type)) {
      if (!holders.has(row.subjectId) && !(inFocus && mentionedHolders.has(row.subjectId))) continue;
    } else if (!inFocus && !about.some(id => targets.has(id))) {
      continue;
    }
    scored.push({ row, inFocus });
  }
  // Rows arrive newest first, and a stable sort keeps that order inside each group.
  scored.sort((a, b) => Number(b.inFocus) - Number(a.inFocus));
  return {
    records: scored.slice(0, limit).map(({ row }) => compactPerspectiveRecord(row)),
    candidates: scored.length,
  };
}

// The analysis never refers to a stored record by id, so ids and provenance stay out of the payload.
function compactPerspectiveRecord({ type, subjectId, value }) {
  return {
    type,
    ...(HOLDER_RECORD_TYPES.has(type) ? { subjectId } : {}),
    ...(value.proposition ? { proposition: value.proposition } : {}),
    ...(value.summary ? { summary: value.summary } : {}),
    ...(value.entityId ? { entityId: value.entityId } : {}),
    ...(value.acquisition ? { acquisition: value.acquisition } : {}),
    ...(value.accessibility && value.accessibility !== 'available' ? { accessibility: value.accessibility } : {}),
  };
}

function groupKnowledgeCardRows(rows) {
  const cards = new Map();
  for (const row of rows || []) {
    const key = `${row.ownerId}\u0000${row.targetId}\u0000${row.cardId}`;
    const card = cards.get(key) || {
      ownerId: row.ownerId,
      targetId: row.targetId,
      cardId: row.cardId,
      knownAs: row.knownAs,
      fieldKeys: [],
    };
    if (row.fieldKey && !card.fieldKeys.includes(row.fieldKey)) card.fieldKeys.push(row.fieldKey);
    cards.set(key, card);
  }
  return [...cards.values()];
}

function hasEpistemicDomain(domains) {
  return domains.some(domain => EPISTEMIC_DOMAINS.has(domain));
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

module.exports = {
  EPISTEMIC_DOMAINS,
  MECHANICAL_DOMAINS,
  NARRATIVE_DOMAINS,
  compactNarrativeManifest,
  extractNarrativeSignals,
  groupKnowledgeCardRows,
  hasEpistemicDomain,
  resolveAnalysisHolders,
  resolveNarrativeRouting,
  selectPerspectiveRecords,
};
