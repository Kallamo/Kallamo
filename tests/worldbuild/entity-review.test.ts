import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const {
  discardEnrichPending,
  normalizeDirectionalRelationship,
  normalizeRelationshipLabel,
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
        links: [{ targetId: 'mara' }],
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
  const entities = new Set(['alistair', 'elian', 'kepler', 'isolde']);

  test('rejects roles left with a dangling connector', () => {
    expect(normalizeRelationshipLabel('Salvador de')).toBeNull();
    expect(normalizeRelationshipLabel('Capitã e líder que')).toBeNull();
  });

  test('rejects a relationship whose perspective belongs to the target', () => {
    expect(validateNarrativeChange({
      kind: 'relationship',
      subjectId: 'alistair',
      targetId: 'elian',
      perspectiveOwnerId: 'elian',
      sourcePerspective: 'Elian admires Alistair.',
    }, 'alistair', entities)).toEqual({ valid: false, reason: 'perspective-owner-mismatch' });
  });

  test('routes explicit knowledge to its declared owner', () => {
    expect(validateNarrativeChange({
      kind: 'knowledge',
      subjectId: 'kepler',
      targetId: 'isolde',
      value: 'Isolde lives in Zeth.',
      method: 'reported',
    }, 'isolde', entities)).toEqual({ valid: true, ownerId: 'kepler' });
  });

  test('rejects knowledge inferred by the update model instead of acquired in the story', () => {
    expect(validateNarrativeChange({
      kind: 'knowledge',
      subjectId: 'kepler',
      targetId: 'isolde',
      value: 'Isolde may still be alive.',
      method: 'inferred',
    }, 'isolde', entities)).toEqual({
      valid: false,
      reason: 'knowledge-acquisition-not-demonstrated',
    });
  });

  test('rejects knowledge without an explicit acquisition method', () => {
    expect(validateNarrativeChange({
      kind: 'knowledge',
      subjectId: 'kepler',
      targetId: 'isolde',
      value: 'Isolde lives in Zeth.',
    }, 'isolde', entities)).toEqual({
      valid: false,
      reason: 'knowledge-acquisition-not-demonstrated',
    });
  });

  test('rejects document-only observations from Update Entities', () => {
    expect(validateNarrativeChange({
      kind: 'observation',
      subjectId: 'alistair',
      method: 'reported',
    }, 'alistair', entities)).toEqual({ valid: false, reason: 'document-observation' });
  });
});

describe('directional relationship proposals', () => {
  test('keeps only the source entity perspective', () => {
    expect(normalizeDirectionalRelationship({ source: 'Arkanos', value: 75, sourcePerspective: 'Arkanos trusts Alistair.' }, 'Arkanos'))
      .toEqual({ value: 75, description: 'Arkanos trusts Alistair.' });
  });

  test('rejects the reciprocal perspective from the target entity', () => {
    expect(normalizeDirectionalRelationship({ source: 'Alistair', value: 40, sourcePerspective: 'Alistair respects Arkanos.' }, 'Arkanos'))
      .toBeNull();
  });

  test('clamps relationship intensity to the supported range', () => {
    expect(normalizeDirectionalRelationship({ source: 'Arkanos', value: 140, sourcePerspective: 'Complete devotion.' }, 'Arkanos')?.value)
      .toBe(100);
  });

  test('keeps only the concise relationship role before an explanation', () => {
    expect(normalizeRelationshipLabel('aliada; reconhece nele um trabalhador lutando contra o sistema'))
      .toBe('aliada');
  });

  test('limits an unpunctuated relationship role to four words', () => {
    expect(normalizeRelationshipLabel('aliado militar soldado do esquadrão profundamente leal'))
      .toBe('aliado militar soldado do esquadrão');
  });

  test('preserves concise roles on both sides of a slash', () => {
    expect(normalizeRelationshipLabel('Companheiro de Luto / Arquiteto Moral da Resistência'))
      .toBe('Companheiro de Luto / Arquiteto Moral da Resistência');
  });
});
