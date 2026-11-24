import { describe, expect, test } from 'vitest';
import {
  getRoleplayGenerationPolicy,
  ROLEPLAY_GENERATION_POLICY_VERSION
} from '../../src/main/features/narrative/roleplay-generation-policy';

describe('Roleplay generation policy', () => {
  test('leaves tone, style and how a reply ends to the AI Profile', () => {
    const policy = getRoleplayGenerationPolicy();

    expect(ROLEPLAY_GENERATION_POLICY_VERSION).toBe('roleplay-generation-v7');
    expect(policy).toContain('Tone, style, voices, pacing, length, formatting and how a reply ends belong to the AI Profile');
    expect(policy).not.toMatch(/guess or ask/);
    expect(policy).not.toMatch(/Narrative Authority|Player Perspective|Scene Actor Perspective/);
  });

  test('keeps the player character the user\'s, while what it shows can be perceived', () => {
    const policy = getRoleplayGenerationPolicy();

    expect(policy).toContain('The user alone controls the player character.');
    expect(policy).toContain('inner thought reaches no one');
    expect(policy).toContain('is there for anyone present to perceive');
    expect(policy).toContain('Never narrate the player character remembering something');
  });

  test('reads each section of the context for its own job', () => {
    const policy = getRoleplayGenerationPolicy();

    expect(policy).toContain('WHO IS HERE, SCENE and FOR THIS TURN are what is true in the story');
    expect(policy).toContain('RULES are binding');
    expect(policy).toContain('Between them is how each present character stands toward the others now');
    expect(policy).toContain('NARRATOR ONLY is for you alone');
    expect(policy).toContain('is undetermined, not unaware');
    expect(policy).toContain('anyone it does not name perceived nothing of it');
    expect(policy).toContain('they repeat the figure they were given, not the narrator');
    expect(policy).toContain('Conversation history is story evidence, not character knowledge.');
    expect(policy).toContain('"former member" or "veteran" describe the past');
  });

  test('names how any character can come to know something, and keeps that out of how they speak', () => {
    const policy = getRoleplayGenerationPolicy();

    expect(policy).toContain('A character knows something only when it reached them');
    expect(policy).toContain('background, trade, affiliations and surroundings make plausible');
    expect(policy).toContain("not another character's thoughts, feelings, plans, sheet or belongings");
    expect(policy).toContain('A secret stays with those who hold it');
    expect(policy).toContain('These limits decide what characters know and do, not how they speak');
  });

  test('plays memory and belief as held, not as the story recorded them', () => {
    const policy = getRoleplayGenerationPolicy();

    expect(policy).toContain('Each carries that much certainty in what the character says and does.');
    expect(policy).toContain('A belief can be false.');
    expect(policy).toContain('never present as remembered a detail the records do not give');
    expect(policy).toContain('What NARRATOR ONLY lists as out of reach is still theirs');
    expect(policy).toContain('being told it again is learning, not remembering');
  });

  test('asks the prose to show what Narrative State records', () => {
    const policy = getRoleplayGenerationPolicy();

    expect(policy).toContain('Kallamo records the story from your narration');
    expect(policy).toContain('never state a change the story did not show');
  });

  test('asks for a private scene plan that notices the people present', () => {
    const policy = getRoleplayGenerationPolicy();

    expect(policy).toContain('<scene_plan></scene_plan>');
    expect(policy).toContain('knows: what their behavior relies on, with where it came from');
    expect(policy).toContain('notices: what they perceive of the others right now, the player character included');
    expect(policy).toContain('their own trade and background count as knowing');
    expect(policy).toContain('<scene_plan>none</scene_plan>');
  });
});
