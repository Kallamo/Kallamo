import { describe, expect, test } from 'vitest';
import {
  getRoleplayGenerationPolicy,
  ROLEPLAY_GENERATION_POLICY_VERSION
} from '../../src/main/features/narrative/roleplay-generation-policy';

describe('Roleplay generation policy', () => {
  test('keeps player agency and character knowledge separate from narrator authority', () => {
    const policy = getRoleplayGenerationPolicy();

    expect(ROLEPLAY_GENERATION_POLICY_VERSION).toBe('roleplay-generation-v3');
    expect(policy).toContain('The user alone controls the player character.');
    expect(policy).toContain('Narrative Authority defines world causality');
    expect(policy).toContain('An undetermined assessment is not unawareness.');
    expect(policy).toContain('AI Profile knowledge is narrator reference');
    expect(policy).toContain('Historical language such as "veteran"');
  });

  test('names how any character can come to know something, and what never reaches them', () => {
    const policy = getRoleplayGenerationPolicy();

    expect(policy).toContain('knows something only when it reaches them through one of these channels');
    expect(policy).toContain('background, role, training, affiliations and surroundings make plausible');
    expect(policy).toContain("not another character's possessions, status sheets or records");
    expect(policy).toContain('A secret stays with those who hold it');
  });

  test('keeps story-evidence guidance in the narration policy', () => {
    const policy = getRoleplayGenerationPolicy();

    expect(policy).toContain(
      'Conversation history is story evidence, not automatic character knowledge.'
    );
  });

  test('reads presence notes and scene memory as the limits of what a character witnessed', () => {
    const policy = getRoleplayGenerationPolicy();

    expect(policy).toContain('anyone it does not name was absent then and perceived nothing of it');
    expect(policy).toContain('they repeat the figure they were given, not the narrator');
    expect(policy).toContain('not as a mood that never paused');
  });

  test('asks for a private scene plan that grounds every line in a source', () => {
    const policy = getRoleplayGenerationPolicy();

    expect(policy).toContain('<scene_plan></scene_plan>');
    expect(policy).toContain('knows: the facts their behavior relies on, each with its source');
    expect(policy).toContain('<scene_plan>none</scene_plan>');
  });
});
