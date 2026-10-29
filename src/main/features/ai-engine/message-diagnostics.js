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

const CACHE_STAGES = ['main', 'agentic', 'narrativeState'];

// What the provider billed for one stage of a turn. Requests add up; a stage that mixed routes is 'mixed'.
function addCacheUsage(target, metadata) {
  if (!target || !metadata) return target;
  target.read = number(target.read) + number(metadata.cacheReadTokens);
  target.write = number(target.write) + number(metadata.cacheWriteTokens);
  target.longWrite = number(target.longWrite) + number(metadata.cacheLongWriteTokens);
  target.uncachedInput = number(target.uncachedInput) + number(metadata.uncachedInputTokens);
  const mode = metadata.cacheMode || null;
  if (mode) target.mode = !target.mode || target.mode === mode ? mode : 'mixed';
  return target;
}

// Explicit routes bill a read at a tenth of the input and a write at 1.25 times (twice for an hour).
// An automatic cache discounts reads by a rate each model sets, so its reads are reported, not priced.
function priceCacheStage(value = {}) {
  const read = number(value.read);
  const write = number(value.write);
  const longWrite = Math.min(write, number(value.longWrite));
  const mode = ['explicit', 'automatic', 'mixed'].includes(value.mode) ? value.mode : 'explicit';
  return {
    read,
    write,
    longWrite,
    uncachedInput: number(value.uncachedInput),
    mode,
    savedTokens: mode === 'explicit' ? Math.round(read * 0.9) : null,
    surchargeTokens: Math.round((write - longWrite) * 0.25 + longWrite)
  };
}

// The only measured numbers in an estimated report. A report with one flat count holds the main stage's.
function normalizeCacheUsage(value = {}) {
  const staged = value && CACHE_STAGES.some(stage => value[stage] && typeof value[stage] === 'object');
  const stages = Object.fromEntries(CACHE_STAGES.map(stage => [
    stage,
    priceCacheStage(staged ? value[stage] : (stage === 'main' ? value : {}))
  ]));
  const list = Object.values(stages);
  const read = list.reduce((total, stage) => total + stage.read, 0);
  const write = list.reduce((total, stage) => total + stage.write, 0);
  return {
    read,
    write,
    uncachedInput: list.reduce((total, stage) => total + stage.uncachedInput, 0),
    savedTokens: list.reduce((total, stage) => total + (stage.savedTokens || 0), 0),
    surchargeTokens: list.reduce((total, stage) => total + stage.surchargeTokens, 0),
    // False when a stage read from an automatic cache, whose discount depends on the model.
    savingsKnown: list.every(stage => stage.savedTokens !== null || stage.read === 0),
    stages,
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
    // The analysis runs after the reply is saved, so its cache joins the stages already measured.
    cache: {
      ...(currentUsage.cache?.stages || { main: currentUsage.cache || {} }),
      narrativeState: narrativeState?.usage?.cache || {}
    },
  });
  return next;
}

module.exports = {
  addCacheUsage,
  buildEstimatedUsage,
  createMessageDiagnostics,
  mergeNarrativeStateDiagnostics,
};
