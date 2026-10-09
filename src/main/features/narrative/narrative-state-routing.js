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
 * Domains a local pattern is allowed to decide on its own. These are mechanical: an item
 * moved, someone walked in, a value changed. The evidence is in the words themselves, and a
 * miss is visible to the player on the next turn.
 *
 * The epistemic domains are deliberately absent. Whether a line of dialogue produced durable
 * knowledge, a lasting belief or a change of regard is a judgement about consequence, and no
 * regular expression can make it. Letting one try is what made every turn escalate to the
 * expensive pass: a quotation mark or the word "explained" was enough to force a full
 * analysis, and the analysis then correctly found nothing worth storing.
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
    pattern: /\b(equip(?:s|ped|ping)?|unequip(?:s|ped|ping)?|wear(?:s|ing)?|wore|draw(?:s|n)?|sheathe[ds]?|brandishe[ds]?|equip(?:a|ei|ou|ar|ado|ada|ados|adas|ava)|desequip(?:a|ei|ou|ar|ado|ada|ados|adas|ava)|vest(?:e|i|iu|ido|ida)|cal[cç](?:a|ei|ou)|empunh(?:a|ei|ou)|saqu(?:e|ei|ou)|embainh(?:a|ei|ou)|guard(?:a|ei|ou))\b/i,
  },
  {
    domain: 'inventory',
    action: 'transfer',
    strong: true,
    pattern: /\b(gave|given|hand(?:s|ed|ing)?|pass(?:es|ed|ing)?|transfer(?:s|red|ring)?|receiv(?:e[sd]?|ing)|took from|entreg(?:a|uei|ou)|pass(?:a|ei|ou)|deu|receb(?:e|i|eu)|transfer(?:e|i|iu)|tom(?:a|ei|ou) de)\b/i,
  },
  {
    domain: 'inventory',
    action: 'drop',
    strong: true,
    pattern: /\b(drop(?:s|ped|ping)?|discard(?:s|ed|ing)?|leave(?:s)? (?:it|them) (?:on|at)|left (?:it|them) (?:on|at)|larg(?:a|uei|ou)|solt(?:a|ei|ou)|descart(?:a|ei|ou)|abandon(?:a|ei|ou)|jog(?:a|uei|ou) (?:no|na|ao|sobre)|deix(?:a|ei|ou) (?:o|a|os|as|isso|ele|ela|eles|elas)?\s*(?:no|na|sobre|em cima|ch[aã]o))\b/i,
  },
  {
    domain: 'inventory',
    action: 'pick-up',
    strong: true,
    pattern: /\b(pick(?:s|ed|ing)? up|collect(?:s|ed|ing)?|retrieve[ds]?|grab(?:s|bed|bing)?|peg(?:a|uei|ou)|apanh(?:a|ei|ou)|recolh(?:e|i|eu)|recuper(?:a|ei|ou)|tir(?:a|ei|ou) (?:do|da|dos|das))\b/i,
  },
  {
    domain: 'inventory',
    action: 'consume',
    strong: true,
    pattern: /\b(drank|drink(?:s|ing)?|ate|eat(?:s|ing)?|consum(?:e[ds]?|ing)|used up|beb(?:e|i|eu|er)|tom(?:a|ei|ou)|com(?:e|i|eu|er)|consum(?:e|i|iu|ir)|gast(?:a|ei|ou)|esgot(?:a|ei|ou))\b/i,
  },
  {
    domain: 'inventory',
    action: 'lose',
    strong: true,
    pattern: /\b(lost|lose[sd]?|stole|stolen|robbed|perd(?:e|i|eu)|roub(?:a|ei|ou|ado|ada)|furt(?:a|ei|ou|ado|ada))\b/i,
  },
  {
    domain: 'scene',
    action: 'movement',
    strong: true,
    pattern: /\b(enter(?:s|ed|ing)?|arrive[sd]?|leave[sd]?|depart(?:s|ed)?|approach(?:es|ed)?|sit(?:s|ting)? down|sat down|descend(?:s|ed)?|ascend(?:s|ed)?|entr(?:a|ei|ou)|cheg(?:a|uei|ou)|sa(?:i|iu)|part(?:e|i|iu)|afast(?:a|ei|ou)|aproxim(?:a|ei|ou)|sent(?:a|ei|ou)|desc(?:e|i|eu)|sub(?:e|i|iu))\b/i,
  },
  {
    domain: 'resource',
    action: 'resource-change',
    strong: true,
    pattern: /\b(gain(?:s|ed)?|lose[sd]?|spend(?:s|ing)?|spent|heal(?:s|ed)?|recover(?:s|ed)?|damage[sd]?|restore[sd]?|ganh(?:a|ei|ou)|perd(?:e|i|eu)|gast(?:a|ei|ou)|cur(?:a|ei|ou)|recuper(?:a|ei|ou)|sofr(?:e|i|eu) dano|restaur(?:a|ei|ou))\b/i,
  },
  {
    domain: 'knowledge',
    action: 'disclosure',
    strong: false,
    pattern: /\b(reveal(?:s|ed)?|explain(?:s|ed)?|inform(?:s|ed)?|confess(?:es|ed)?|warn(?:s|ed)?|teach(?:es|t)?|discover(?:s|ed)?|recognize[sd]?|revel(?:a|ei|ou)|explic(?:a|ei|ou)|inform(?:a|ei|ou)|confess(?:a|ei|ou)|avis(?:a|ei|ou)|ensin(?:a|ei|ou)|descobr(?:e|i|iu)|reconhec(?:e|i|eu))\b/i,
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
    pattern: /\b(betray(?:s|ed)?|forgive[sn]?|swear(?:s)? loyalty|owes? (?:him|her|them)|romance[sd]?|betrayal|tra(?:i|iu)|perdo(?:a|ei|ou)|jur(?:a|ei|ou) lealdade|deve (?:a|ao|[àa])|romance|noiv(?:a|ei|ou)|cas(?:a|ei|ou))\b/i,
  },
  {
    domain: 'relationship',
    action: 'interaction',
    strong: false,
    pattern: /\b(speak(?:s|ing)? to|spoke to|talk(?:s|ed|ing)? to|address(?:es|ed)?|convers(?:e[sd]?|ing)|listen(?:s|ed|ing)? to|overhear(?:s|d|ing)?|hear(?:s|d|ing)? .*\b(?:say|speak|talk)|fal(?:a|ou|ando) com|convers(?:a|ou|ando) com|dirig(?:e|iu)-se a|escut(?:a|ou|ando)|ouv(?:e|iu|indo)|ouve por acaso)\b/i,
  },
  {
    domain: 'entity',
    action: 'introduction',
    strong: true,
    pattern: /\b(introduc(?:e[sd]?|ing)|meet(?:s)? for the first time|named (?:himself|herself|themselves)|apresent(?:a|ei|ou|ado|ada)|conhec(?:e|i|eu) pela primeira vez|disse se chamar|chamava-se)\b/i,
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
  // Overriding the triage costs a full analysis of the turn, so only mechanical evidence
  // earns it. Without this restriction the override fired on ordinary prose and the deep
  // pass ran on every single turn.
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
 * Whose perspective the analysis reads in full and whose only around the turn's focus. Being
 * present decides the detail, never the inclusion: someone the triage leaves out of presentIds
 * still keeps what they hold about the focus. Without presentIds everyone counts as present.
 */
function resolveAnalysisHolders({ candidateIds, sceneIds, presentIds }) {
  const candidates = [...new Set(candidateIds)];
  if (!Array.isArray(presentIds)) return { present: new Set(candidates), mentioned: new Set() };
  const present = new Set([...sceneIds, ...presentIds].filter(id => candidates.includes(id)));
  return { present, mentioned: new Set(candidates.filter(id => !present.has(id))) };
}

/**
 * The perspective records the analysis compares a turn against. Knowledge, beliefs and memories
 * can only change for someone who could perceive the turn, so they are kept by holder, about
 * anyone; facts are kept by what they are about. Records about the turn's focus go first.
 * Relationships are left out because currentRelationshipState is their baseline.
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
