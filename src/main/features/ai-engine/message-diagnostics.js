function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : 0;
}

function normalizeNarrativeUsage(value = {}) {
  return {
    triageInput: number(value.triageInput),
    triageOutput: number(value.triageOutput),
    deepInput: number(value.deepInput),
    deepOutput: number(value.deepOutput),
    repairInput: number(value.repairInput),
    repairOutput: number(value.repairOutput),
  };
}

// Cache counters come from the provider, not from the local tokenizer, so they
// are the only measured numbers in an otherwise estimated report. `savedTokens`
// is what a read spared at full input price; `surchargeTokens` is the ~25% extra
// a write costs, so a turn that wrote without reading still shows its price.
function normalizeCacheUsage(value = {}) {
  const read = number(value.read);
  const write = number(value.write);
  return {
    read,
    write,
    uncachedInput: number(value.uncachedInput),
    savedTokens: Math.round(read * 0.9),
    surchargeTokens: Math.round(write * 0.25),
    active: read > 0 || write > 0
  };
}

function buildEstimatedUsage(value = {}) {
  const main = {
    systemInstructions: number(value.systemInstructions),
    narrativeContext: number(value.narrativeContext),
    userInput: number(value.userInput),
    chatHistory: number(value.chatHistory),
    output: number(value.output),
  };
  main.input = main.systemInstructions + main.narrativeContext + main.userInput + main.chatHistory;
  main.total = main.input + main.output;

  const agentic = {
    input: number(value.agenticInput),
    output: number(value.agenticOutput),
  };
  agentic.total = agentic.input + agentic.output;

  const narrativeState = normalizeNarrativeUsage(value.narrativeState);
  narrativeState.input = narrativeState.triageInput + narrativeState.deepInput + narrativeState.repairInput;
  narrativeState.output = narrativeState.triageOutput + narrativeState.deepOutput + narrativeState.repairOutput;
  narrativeState.total = narrativeState.input + narrativeState.output;

  return {
    accuracy: 'estimated',
    tokenizer: 'o200k_base',
    main,
    agentic,
    narrativeState,
    cache: normalizeCacheUsage(value.cache),
    total: {
      input: main.input + agentic.input + narrativeState.input,
      output: main.output + agentic.output + narrativeState.output,
      total: main.total + agentic.total + narrativeState.total,
    },
  };
}

function createMessageDiagnostics({
  workflowStatus = '',
  legacy = {},
  generation = {},
  retrieval = {},
  agentic,
  usage,
} = {}) {
  return {
    version: 2,
    workflowStatus,
    ...legacy,
    generation,
    retrieval,
    ...(agentic ? { agentic } : {}),
    usage: usage || buildEstimatedUsage(),
  };
}

function mergeNarrativeStateDiagnostics(diagnostic, narrativeState) {
  const next = {
    ...(diagnostic || {}),
    version: 2,
    narrativeState,
  };
  const currentUsage = next.usage || buildEstimatedUsage();
  next.usage = buildEstimatedUsage({
    systemInstructions: currentUsage.main?.systemInstructions,
    narrativeContext: currentUsage.main?.narrativeContext,
    userInput: currentUsage.main?.userInput,
    chatHistory: currentUsage.main?.chatHistory,
    output: currentUsage.main?.output,
    agenticInput: currentUsage.agentic?.input,
    agenticOutput: currentUsage.agentic?.output,
    narrativeState: narrativeState?.usage,
    cache: currentUsage.cache,
  });
  return next;
}

module.exports = {
  buildEstimatedUsage,
  createMessageDiagnostics,
  mergeNarrativeStateDiagnostics,
};
