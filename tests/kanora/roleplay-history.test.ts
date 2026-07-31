import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const {
  STORY_EVIDENCE_MARKER,
  stripLeadingStoryEvidenceMarkers
} = require('../../src/main/features/kanora/roleplay-history');

describe('Roleplay chat history', () => {
  test('preserves ordinary history content', () => {
    expect(stripLeadingStoryEvidenceMarkers('The tavern begins to wake.'))
      .toBe('The tavern begins to wake.');
  });

  test('removes repeated legacy story-evidence markers from history', () => {
    const content = `${STORY_EVIDENCE_MARKER}\n${STORY_EVIDENCE_MARKER}\r\nThe tavern begins to wake.`;

    expect(stripLeadingStoryEvidenceMarkers(content))
      .toBe('The tavern begins to wake.');
  });

  test('does not remove marker-like text from the narrative body', () => {
    const content = `A note reads ${STORY_EVIDENCE_MARKER}.`;

    expect(stripLeadingStoryEvidenceMarkers(content)).toBe(content);
  });
});
