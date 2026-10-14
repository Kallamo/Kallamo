import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const { createScenePlanStreamFilter, extractScenePlan } = require('../src/main/features/chat/scene-plan.js');

const PLAN = 'Warden Bram | knows: Ilse said eight (told by Ilse) | wants: a count | does: asks for names';

describe('extracting the scene plan', () => {
  test('separates the plan from the narration', () => {
    expect(extractScenePlan(`<scene_plan>\n${PLAN}\n</scene_plan>\n\nBram frowns.`)).toEqual({ plan: PLAN, text: 'Bram frowns.' });
  });

  test('keeps reasoning in place and leaves a reply without a plan untouched', () => {
    expect(extractScenePlan(`<think>hm</think><scene_plan>none</scene_plan>\nRain.`)).toEqual({ plan: 'none', text: '<think>hm</think>Rain.' });
    expect(extractScenePlan('Rain falls.')).toEqual({ plan: '', text: 'Rain falls.' });
  });

  test('an unclosed plan never leaks into the reply', () => {
    expect(extractScenePlan(`<scene_plan>${PLAN}`)).toEqual({ plan: PLAN, text: '' });
  });
});

describe('filtering the plan out of a stream', () => {
  const run = (deltas: string[]) => {
    const filter = createScenePlanStreamFilter();
    return deltas.map(delta => filter.push(delta)).join('') + filter.flush();
  };

  test('drops a plan split across many deltas', () => {
    expect(run(['<sce', 'ne_plan>', PLAN.slice(0, 20), PLAN.slice(20), '</scene', '_plan>', '\n\n', 'Bram ', 'frowns.'])).toBe('Bram frowns.');
  });

  test('streams a reply without a plan as it arrives', () => {
    const filter = createScenePlanStreamFilter();
    expect(filter.push('Rain')).toBe('Rain');
    expect(filter.push(' falls.')).toBe(' falls.');
  });

  test('releases text that only looked like the start of a plan', () => {
    expect(run(['<', 'b>Loud</b> rain.'])).toBe('<b>Loud</b> rain.');
    expect(run(['<sc'])).toBe('<sc');
  });

  test('a plan that never closes is held back entirely', () => {
    expect(run(['<scene_plan>', PLAN])).toBe('');
  });
});
