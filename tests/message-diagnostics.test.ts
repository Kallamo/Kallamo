import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const {
  buildEstimatedUsage,
  createMessageDiagnostics,
  mergeNarrativeStateDiagnostics,
} = require('../src/main/features/ai-engine/message-diagnostics');

describe('message diagnostics', () => {
  test('keeps the main, agentic, and narrative state totals separate without double counting', () => {
    const usage = buildEstimatedUsage({
      systemInstructions: 100,
      narrativeContext: 40,
      userInput: 20,
      chatHistory: 30,
      output: 25,
      agenticInput: 50,
      agenticOutput: 10,
      narrativeState: {
        triageInput: 12,
        triageOutput: 3,
        deepInput: 18,
        deepOutput: 7,
      },
    });

    expect(usage.main).toMatchObject({ input: 190, output: 25, total: 215 });
    expect(usage.agentic).toMatchObject({ input: 50, output: 10, total: 60 });
    expect(usage.narrativeState).toMatchObject({ input: 30, output: 10, total: 40 });
    expect(usage.total).toEqual({ input: 270, output: 45, total: 315 });
    expect(usage.accuracy).toBe('estimated');
  });

  test('creates a versioned envelope while preserving legacy diagnostic fields', () => {
    const diagnostic = createMessageDiagnostics({
      workflowStatus: 'Workflow complete',
      legacy: {
        agenticRagResponse: 'Finished',
        agenticRagContextGathered: 'Agentic context',
        standardRagContextGathered: 'Retrieved chunks',
        tokens: { totalInput: 10, output: 5 },
      },
      generation: { context: { exactText: 'Final context' } },
      retrieval: { mode: 'standard', retrievedSourcesText: 'Retrieved chunks' },
    });

    expect(diagnostic.version).toBe(2);
    expect(diagnostic.workflowStatus).toBe('Workflow complete');
    expect(diagnostic.standardRagContextGathered).toBe('Retrieved chunks');
    expect(diagnostic.generation.context.exactText).toBe('Final context');
  });

  test('adds Narrative State results without discarding generation diagnostics', () => {
    const original = createMessageDiagnostics({
      generation: { context: { exactText: 'Final context' } },
    });
    const updated = mergeNarrativeStateDiagnostics(original, {
      status: 'completed',
      triage: { consequential: true, reason: 'A revelation occurred.' },
      usage: { triageInput: 12, triageOutput: 3, deepInput: 18, deepOutput: 7 },
    });

    expect(updated.generation.context.exactText).toBe('Final context');
    expect(updated.narrativeState.status).toBe('completed');
    expect(updated.usage.narrativeState.total).toBe(40);
    expect(original.narrativeState).toBeUndefined();
  });

  test('reports cache per stage and prices only what the provider rates make known', () => {
    const usage = buildEstimatedUsage({
      cache: {
        main: { read: 1000, write: 0, mode: 'automatic' },
        agentic: { read: 10000, write: 2000, longWrite: 1000, mode: 'explicit' },
        narrativeState: {}
      }
    });
    expect(usage.cache.stages.agentic).toMatchObject({ savedTokens: 9000, surchargeTokens: 1250 });
    expect(usage.cache.stages.main.savedTokens).toBeNull();
    expect(usage.cache).toMatchObject({ read: 11000, write: 2000, savedTokens: 9000, savingsKnown: false, active: true });
  });

  test('an older report keeps its one count as the main stage, and the Narrative State joins later', () => {
    const legacy = createMessageDiagnostics({ usage: { cache: { read: 500, write: 100 } } });
    const merged = mergeNarrativeStateDiagnostics(legacy, { status: 'completed', usage: { cache: { read: 300, write: 0, mode: 'explicit' } } });
    expect(merged.usage.cache.stages.main).toMatchObject({ read: 500, write: 100 });
    expect(merged.usage.cache.stages.narrativeState).toMatchObject({ read: 300 });
    expect(merged.usage.cache.read).toBe(800);
  });
});
