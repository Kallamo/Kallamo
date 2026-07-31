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
    strong: true,
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
    if (!selectedDomains.has(domain)) {
      selectedDomains.add(domain);
      forceReasons.push(`explicit-${domain}-signal`);
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
  const requiresFullAnalysis = Boolean(triage?.requiresFullAnalysis) || domains.length >= 4;
  const forceDeepAnalysis = !triage?.consequential && domains.length > 0;

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
  NARRATIVE_DOMAINS,
  compactNarrativeManifest,
  extractNarrativeSignals,
  groupKnowledgeCardRows,
  hasEpistemicDomain,
  resolveNarrativeRouting,
};
