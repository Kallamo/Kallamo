import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { shouldRunPlanner, turnAddedNothing } = require('../src/main/features/knowledge/agent-planner.js');

const dialogue = '— Historiador. Essa é nova? Normalmente é mercador, mercenário ou alguém que não diz o que faz por aqui.';

describe('the planner gate', () => {
  test('outside a roleplay, a question or a long message is researched', () => {
    expect(shouldRunPlanner(dialogue).plan).toBe(true);
    expect(shouldRunPlanner('ok').plan).toBe(false);
  });

  test('in a roleplay, dialogue that stays inside the scene is not researched', () => {
    const decision = shouldRunPlanner(dialogue, { entityMentions: 1, scene: { outside: 0, bystanders: 0 } });
    expect(decision).toMatchObject({ plan: false });
    expect(decision.reason).toContain('inside the scene');
  });

  test('in a roleplay, naming something outside the scene or someone nearby is researched', () => {
    expect(shouldRunPlanner(dialogue, { entityMentions: 1, scene: { outside: 1, bystanders: 0 } }).reason).toContain('outside the scene');
    expect(shouldRunPlanner(dialogue, { entityMentions: 1, scene: { outside: 0, bystanders: 1 } }).reason).toContain('nearby');
  });

  test('the override still forces research in a roleplay', () => {
    expect(shouldRunPlanner(dialogue, { force: true, scene: { outside: 0, bystanders: 0 } }).plan).toBe(true);
  });
});

describe('finishing a research loop', () => {
  test('a turn that found only what was already gathered ends the loop', () => {
    expect(turnAddedNothing({ newItems: 0, calls: [
      { tool: 'lookup_entity', status: 'in-context', hits: 0 },
      { tool: 'search_kb', status: 'repeat', hits: 3 },
      { tool: 'search_memories', status: 'ran', hits: 2 }
    ] })).toBe(true);
  });

  test('a turn that added something, or whose search came back empty, keeps going', () => {
    expect(turnAddedNothing({ newItems: 2, calls: [{ tool: 'lookup_entity', status: 'ran', hits: 1 }] })).toBe(false);
    expect(turnAddedNothing({ newItems: 0, calls: [{ tool: 'search_kb', status: 'ran', hits: 0 }] })).toBe(false);
    expect(turnAddedNothing({ newItems: 0, calls: [{ tool: 'search_kb', status: 'known-empty', hits: 0 }] })).toBe(false);
    expect(turnAddedNothing({ newItems: 0, calls: [] })).toBe(false);
  });
});
