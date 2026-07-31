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
});
