// Rows re-render often, so parsed records are cached by their source string.
const debugNoticeCache = new Map();
const DEBUG_NOTICE_CACHE_LIMIT = 400;

export const safeParseDebugNotice = (notice) => {
  if (!notice) return null;
  const cached = debugNoticeCache.get(notice);
  if (cached !== undefined) return cached;
  let parsed;
  try {
    parsed = JSON.parse(notice);
  } catch (e) {
    parsed = { legacyText: notice };
  }
  if (debugNoticeCache.size >= DEBUG_NOTICE_CACHE_LIMIT) debugNoticeCache.clear();
  debugNoticeCache.set(notice, parsed);
  return parsed;
};

export const safeParseJson = (str, fallback = []) => {
  if (!str) return fallback;
  if (typeof str !== 'string') return str;
  try {
    const parsed = JSON.parse(str);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (e) {
    console.error('safeParseJson error in chat workspace:', e);
    return fallback;
  }
};

export const diagnosticText = value => {
  if (!value) return '';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
};

const formatSelectionFunnel = selection => {
  if (!selection) return 'No selection funnel recorded.';
  const counts = value => Object.entries(value || {})
    .map(([key, count]) => `${key}: ${count}`)
    .join(', ') || 'none';
  return [
    `Intent: ${selection.intent || 'general'}`,
    ...(selection.evidence ? [
      `Evidence: ${selection.evidence.status || 'inconclusive'} (${selection.evidence.reason || 'unspecified'})`,
      ...(selection.evidence.source ? [`Latest source: ${selection.evidence.source}`] : [])
    ] : []),
    `Discovered: ${selection.discovered || 0} (${counts(selection.discoveredByKind)})`,
    `Selected: ${selection.selected || 0} (${counts(selection.selectedByKind)})`,
    `Excluded: ${selection.excluded || 0} (${counts(selection.excludedByReason)})`,
    '',
    'SELECTED SOURCES',
    ...(selection.selectedSources?.length
      ? selection.selectedSources.map(item => `- ${item.source || 'Unknown'} [${item.kind}]`)
      : ['- None']),
    '',
    'EXCLUDED SOURCES',
    ...(selection.excludedSources?.length
      ? selection.excludedSources.map(item => `- ${item.source || 'Unknown'} [${item.kind}]: ${item.reason}`)
      : ['- None'])
  ].join('\n');
};

export const formatPlannerDecisions = bundle => {
  if (!bundle?.scopes?.length) return 'No perspective bundle.';
  const composition = bundle.composition;
  const summary = composition ? [
    `Rendered roleplay context: ${composition.renderedTokens || 0}/${bundle.tokenBudget || 0} tokens`,
    `Unique records: ${composition.uniqueRecords || 0}`,
    `Shared records: ${composition.sharedRecords || 0}`,
    `Scope memberships: ${composition.scopeMemberships || 0}`,
    `Duplicate renderings avoided: ${composition.avoidedDuplicateRenderings || 0}`,
    `Content tokens avoided: ${composition.avoidedContentTokens || 0}`,
    ''
  ] : [];
  const scopeLabels = new Map(bundle.scopes.map(scope => [scope.id, scope.label || scope.id]));
  const memberships = new Map();
  bundle.scopes.forEach(scope => {
    (scope.itemIds || []).forEach(candidateId => {
      const scopeIds = memberships.get(candidateId) || new Set();
      scopeIds.add(scope.id);
      memberships.set(candidateId, scopeIds);
    });
  });
  const scopeSummary = bundle.scopes.map(scope =>
    `${scope.label || scope.id}: ${scope.itemIds?.length || 0} authorized records (${scope.usedTokens || 0} tokens before sharing)`);
  const shared = [...memberships.entries()]
    .filter(([, scopeIds]) => scopeIds.size > 1)
    .map(([candidateId, scopeIds]) =>
      `- ${candidateId}: ${[...scopeIds].map(scopeId => scopeLabels.get(scopeId) || scopeId).join(', ')}`);
  const exclusive = bundle.scopes.flatMap(scope => {
    const records = (scope.itemIds || []).filter(candidateId => memberships.get(candidateId)?.size === 1);
    return records.length
      ? [`${scope.label || scope.id}`, ...records.map(candidateId => `- ${candidateId}`)]
      : [];
  });
  const excludedByDecision = new Map();
  (bundle.excluded || []).forEach(decision => {
    const key = JSON.stringify([decision.candidateId, decision.outcome, decision.reason]);
    const grouped = excludedByDecision.get(key) || { decision, scopeIds: new Set() };
    grouped.scopeIds.add(decision.scopeId);
    excludedByDecision.set(key, grouped);
  });
  const excluded = [...excludedByDecision.values()].map(({ decision, scopeIds }) => {
    const scopes = [...scopeIds].map(scopeId => scopeLabels.get(scopeId) || scopeId).join(', ');
    return `- ${decision.candidateId}: ${decision.outcome} (${decision.reason}) [${scopes}]`;
  });
  return [
    ...summary,
    ...scopeSummary,
    ...(shared.length ? ['', 'SHARED RECORDS', ...shared] : []),
    ...(exclusive.length ? ['', 'SCOPE-ONLY RECORDS', ...exclusive] : []),
    ...(excluded.length ? ['', 'EXCLUDED', ...excluded] : [])
  ].join('\n');
};

const formatTrajectory = trajectory => {
  if (!trajectory) return '';
  const lines = [];
  if (trajectory.gate) lines.push(`Path: ${trajectory.gate.path} (${trajectory.gate.reason})`);
  if (trajectory.protocol) {
    const fallback = trajectory.protocolFallback ? `, fell back from native: ${trajectory.protocolFallback}` : '';
    lines.push(`Protocol: ${trajectory.finalProtocol || trajectory.protocol}${fallback}`);
  }
  if (trajectory.plannerWindow) {
    const plannerWindow = trajectory.plannerWindow;
    const configured = plannerWindow.configured && plannerWindow.configured !== plannerWindow.limit ? ` of ${plannerWindow.configured} configured` : '';
    const ratio = Number(plannerWindow.tokenRatio) > 1 ? `, corrected for a measured x${Number(plannerWindow.tokenRatio).toFixed(2)} token count` : '';
    lines.push(`Planner window: ${plannerWindow.limit} tokens${configured} (${plannerWindow.source}), ${plannerWindow.outputTokens} reserved for its reply${ratio}`);
  }
  if (trajectory.seed) {
    const seedCalls = (trajectory.seed.calls || []).map(call => `${call.tool} -> ${call.hits}`).join(', ');
    lines.push(`Pre-search: ${trajectory.seed.items} passage(s) [${seedCalls}]`);
  }
  for (const turn of trajectory.turns || []) {
    const calls = (turn.calls || []).length
      ? turn.calls.map(call => `${call.tool}("${call.arg}") -> ${call.hits}${call.status === 'ran' ? '' : ` [${call.status}]`}`).join('; ')
      : (turn.finished ? 'finish' : 'no call');
    const usage = turn.providerUsage;
    const reported = usage && usage.inputTokens != null
      ? ` | provider: ${usage.inputTokens} in${usage.cacheReadTokens != null ? `, ${usage.cacheReadTokens} read from cache` : ''}${usage.cacheWriteTokens ? `, ${usage.cacheWriteTokens} written to cache` : ''}`
      : '';
    const learned = turn.tokenRatio ? ` | learned x${Number(turn.tokenRatio).toFixed(2)}` : '';
    lines.push(`Turn ${turn.turn}: ${calls} | +${turn.newItems} new | ${turn.inputTokens} in / ${turn.outputTokens} out${reported}${learned}`);
  }
  if (trajectory.stopped) lines.push(`Stopped: ${trajectory.stopped}`);
  if (trajectory.packing) {
    const pack = trajectory.packing;
    lines.push(`Packed ${pack.kept}/${pack.total} items into ${pack.budget} tokens (${pack.dropped} dropped, ${pack.truncated} cut)`);
  }
  if (trajectory.withheldLookupPassages) {
    lines.push(`Lookup passages kept from the writer: ${trajectory.withheldLookupPassages} (uncited, below the top 3 of their lookup)`);
  }
  return lines.join('\n');
};

export const formatAgenticTrace = diagnostic => {
  const trajectory = formatTrajectory(diagnostic?.agenticTrajectory);
  if (!diagnostic?.agentic) {
    return `### Agentic RAG Response\n${diagnostic?.agenticRagResponse || ''}\n\n### Trajectory\n${trajectory}\n\n### Context Gathered\n${diagnostic?.agenticRagContextGathered || ''}`;
  }
  return [
    `Stop reason: ${diagnostic.agentic.stopReason || 'unknown'}`,
    `Degraded: ${diagnostic.agentic.degraded ? 'yes' : 'no'}`,
    ...(trajectory ? ['', 'TRAJECTORY', trajectory] : []),
    '',
    'TOOL TRACE',
    diagnosticText(diagnostic.agentic.turns),
    '',
    'FINISH',
    diagnostic.agentic.finish || '',
    '',
    'FINAL CONTEXT',
    diagnostic.agentic.contextText || ''
  ].join('\n');
};

export const formatRetrievalDiagnostics = diagnostic => {
  const retrieval = diagnostic?.retrieval;
  if (!retrieval) return diagnostic?.standardRagContextGathered || '';
  return [
    `Mode: ${retrieval.mode || 'standard'}`,
    `Generation policy: ${diagnostic?.generation?.policyId || 'none'}`,
    `Generation target: ${diagnostic?.generation?.profileName || 'Unknown AI Profile'}`,
    '',
    'SELECTION FUNNEL',
    formatSelectionFunnel(retrieval.selection),
    '',
    'PLANNER DECISIONS',
    formatPlannerDecisions(retrieval.bundle),
    '',
    'EXACT FINAL NARRATIVE CONTEXT',
    retrieval.finalContextText || 'No additional narrative context was sent.'
  ].join('\n');
};

// A deferred reply has no frame until Narrative State analyzes it, so it holds the previous
// turn's end point; writing a frame here would block the real one (frames are write-once).
export const holdDeferredFrames = (messages, frames) => {
  const held = {};
  let lastEnd = null;
  for (const message of messages) {
    if (message.role === 'user') continue;
    const frame = frames[message.id];
    if (frame?.end) {
      lastEnd = frame.end;
    } else if (lastEnd && safeParseDebugNotice(message.debugNotice)?.narrativeState?.status === 'deferred') {
      held[message.id] = { originId: message.id, start: lastEnd, end: lastEnd, advance: null, pending: true };
    }
  }
  return held;
};
