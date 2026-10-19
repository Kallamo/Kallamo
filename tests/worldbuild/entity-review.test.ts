import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const {
  discardEnrichPending,
  normalizeDirectionalRelationship,
  normalizeRelationshipLabel,
  resolveRelationshipUpdate,
  validateNarrativeChange,
} = require('../../src/main/features/worldbuild/entity-review.js');

describe('bulk entity update rejection', () => {
  test('removes only staged updates and preserves canonical data', () => {
    const result = discardEnrichPending({
      personality: 'Reserved',
      customFields: { oath: 'Dawn' },
      _enrichPending: {
        data: { personality: { value: 'Bold' } },
        lore: { value: 'Replacement lore' },
        links: [{ targetId: 'tess' }],
        chapters: [{ id: 'chapter-one' }],
        evidence: { E1: { excerpt: 'Evidence' } }
      }
    });

    expect(result).toEqual({
      data: { personality: 'Reserved', customFields: { oath: 'Dawn' } },
      fields: 1,
      lore: 1,
      links: 1,
      chapters: 1
    });
  });

  test('returns null when the entity has no staged update', () => {
    expect(discardEnrichPending({ personality: 'Reserved' })).toBeNull();
  });
});

describe('narrative update hardening', () => {
  const entities = new Set(['rosalind', 'brann', 'corwin', 'sabine']);

  test('keeps a short role whole instead of cutting it at a word count', () => {
    expect(normalizeRelationshipLabel('Rival in the arena who')).toBe('Rival in the arena who');
    expect(normalizeRelationshipLabel('Companion who offered presence')).toBe('Companion who offered presence');
  });

  test('rejects a relationship whose perspective belongs to the target', () => {
    expect(validateNarrativeChange({
      kind: 'relationship',
      subjectId: 'rosalind',
      targetId: 'brann',
      perspectiveOwnerId: 'brann',
      sourcePerspective: 'Brann admires Rosalind.',
    }, 'rosalind', entities)).toEqual({ valid: false, reason: 'perspective-owner-mismatch' });
  });

  test('routes explicit knowledge to its declared owner', () => {
    expect(validateNarrativeChange({
      kind: 'knowledge',
      subjectId: 'corwin',
      targetId: 'sabine',
      value: 'Sabine lives in Kesh.',
      method: 'reported',
    }, 'sabine', entities)).toEqual({ valid: true, ownerId: 'corwin' });
  });

  test('rejects knowledge inferred by the update model instead of acquired in the story', () => {
    expect(validateNarrativeChange({
      kind: 'knowledge',
      subjectId: 'corwin',
      targetId: 'sabine',
      value: 'Sabine may still be alive.',
      method: 'inferred',
    }, 'sabine', entities)).toEqual({
      valid: false,
      reason: 'knowledge-acquisition-not-demonstrated',
    });
  });

  test('rejects knowledge without an explicit acquisition method', () => {
    expect(validateNarrativeChange({
      kind: 'knowledge',
      subjectId: 'corwin',
      targetId: 'sabine',
      value: 'Sabine lives in Kesh.',
    }, 'sabine', entities)).toEqual({
      valid: false,
      reason: 'knowledge-acquisition-not-demonstrated',
    });
  });

  test('rejects document-only observations from Update Entities', () => {
    expect(validateNarrativeChange({
      kind: 'observation',
      subjectId: 'rosalind',
      method: 'reported',
    }, 'rosalind', entities)).toEqual({ valid: false, reason: 'document-observation' });
  });
});

describe('directional relationship proposals', () => {
  test('keeps only the source entity perspective', () => {
    expect(normalizeDirectionalRelationship({ source: 'Quillon', value: 75, sourcePerspective: 'Quillon trusts Rosalind.' }, 'Quillon'))
      .toEqual({ value: 75, description: 'Quillon trusts Rosalind.' });
  });

  test('rejects the reciprocal perspective from the target entity', () => {
    expect(normalizeDirectionalRelationship({ source: 'Rosalind', value: 40, sourcePerspective: 'Rosalind respects Quillon.' }, 'Quillon'))
      .toBeNull();
  });

  test('clamps relationship intensity to the supported range', () => {
    expect(normalizeDirectionalRelationship({ source: 'Quillon', value: 140, sourcePerspective: 'Complete devotion.' }, 'Quillon')?.value)
      .toBe(100);
  });

  test('keeps only the concise relationship role before an explanation', () => {
    expect(normalizeRelationshipLabel('ally; sees in him a worker fighting the system'))
      .toBe('ally');
  });

  test('drops a role that is a sentence rather than truncating it', () => {
    expect(normalizeRelationshipLabel('military ally and soldier of Ravenhold deeply loyal')).toBeNull();
  });

  test('preserves concise roles on both sides of a slash', () => {
    expect(normalizeRelationshipLabel('Road Companion / Moral Guardian of Kesh'))
      .toBe('Road Companion / Moral Guardian of Kesh');
  });
});

describe('editing an existing relationship', () => {
  const current = { title: 'Mentor', value: 60, description: 'Brann trusts Rosalind with the forge and listens when she corrects him, even in front of others.' };

  test('a new relationship is taken as proposed', () => {
    expect(resolveRelationshipUpdate(null, { title: 'Rival', value: -30, description: 'Brann resents her.' }))
      .toEqual({ title: 'Rival', value: -30, description: 'Brann resents her.' });
  });

  test('keeps the title and moves the score one bounded step', () => {
    const update = resolveRelationshipUpdate(current, { title: 'Trusted teacher', value: 95, description: `${current.description} After the trial he defends her openly.` });
    expect(update).toEqual({ title: 'Mentor', value: 85, description: `${current.description} After the trial he defends her openly.` });
  });

  test('only a reversal may rename the bond, still within a step', () => {
    expect(resolveRelationshipUpdate(current, { title: 'Betrayer', value: -60, description: `${current.description} Then she sold the forge.` }))
      .toEqual({ title: 'Betrayer', value: 10, description: `${current.description} Then she sold the forge.` });
  });

  test('keeps the current perspective when the new one drops most of it', () => {
    expect(resolveRelationshipUpdate(current, { title: 'Mentor', value: 75, description: 'He respects her.' })?.description)
      .toBe(current.description);
  });

  test('nothing to review when only the wording around the same bond changed', () => {
    expect(resolveRelationshipUpdate(current, { title: 'Wise teacher', value: 62, description: 'He trusts her.' })).toBeNull();
  });
});
