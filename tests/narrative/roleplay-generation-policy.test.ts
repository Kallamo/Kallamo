import { describe, expect, test } from 'vitest';
import {
  getRoleplayGenerationPolicy,
  ROLEPLAY_GENERATION_POLICY_VERSION
} from '../../src/main/features/narrative/roleplay-generation-policy';

describe('Roleplay generation policy', () => {
  test('keeps player agency and character knowledge separate from narrator authority', () => {
    const policy = getRoleplayGenerationPolicy();

    expect(ROLEPLAY_GENERATION_POLICY_VERSION).toBe('roleplay-generation-v1');
    expect(policy).toContain('The user alone controls the player character.');
    expect(policy).toContain('Narrative Authority defines world causality');
    expect(policy).toContain('An undetermined assessment is not unawareness.');
    expect(policy).toContain('AI Profile knowledge is narrator reference');
    expect(policy).toContain('Historical language such as "veteran"');
  });

  test('keeps story-evidence guidance in the narration policy', () => {
    const policy = getRoleplayGenerationPolicy();

    expect(policy).toContain(
      'Conversation history is story evidence, not automatic character knowledge.'
    );
  });
});
