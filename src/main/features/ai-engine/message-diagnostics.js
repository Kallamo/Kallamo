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
  });
  return next;
}

module.exports = {
  buildEstimatedUsage,
  createMessageDiagnostics,
  mergeNarrativeStateDiagnostics,
};
