import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';
import { describeSceneLocation } from '../../src/renderer/features/chat/diagnostic-format.js';

const require = createRequire(import.meta.url);
const { summarizeSceneLocation } = require('../../src/main/features/narrative/narrative-state-routing');

const names = new Map([['pier', 'Pier'], ['residence', "Player's Residence"]]);

describe('scene location report', () => {
  test('says the scene was not checked when triage left it out', () => {
    const summary = summarizeSceneLocation({ analyzed: false, fromLocationId: 'pier' });
    expect(summary.outcome).toBe('not-analyzed');
    expect(describeSceneLocation(summary, names)).toBe('Not checked this turn: triage did not mark the scene');
  });

  test('says the analysis reported no move', () => {
    const summary = summarizeSceneLocation({ analyzed: true, fromLocationId: 'pier', change: { status: 'applied', patch: { participantIds: [] } } });
    expect(describeSceneLocation(summary, names)).toBe('Kept at Pier: the analysis reported no move');
  });

  test('reports an applied move and one awaiting approval', () => {
    const moved = summarizeSceneLocation({ analyzed: true, fromLocationId: 'pier', change: { status: 'applied', patch: { locationId: 'residence' } } });
    expect(describeSceneLocation(moved, names)).toBe("Moved from Pier to Player's Residence");
    const pending = summarizeSceneLocation({ analyzed: true, fromLocationId: 'pier', change: { status: 'pending', patch: { locationId: 'residence' } } });
    expect(pending.outcome).toBe('awaiting-approval');
  });

  test('names why a destination was dropped, even when the cast still changed', () => {
    const summary = summarizeSceneLocation({
      analyzed: true,
      fromLocationId: 'pier',
      rejected: { reason: 'no-completed-movement', locationId: 'residence', fromLocationId: 'pier' },
      change: { status: 'applied', patch: { participantIds: ['guide'] } }
    });
    expect(summary).toMatchObject({ outcome: 'rejected', reason: 'no-completed-movement', locationId: 'residence' });
    expect(describeSceneLocation(summary, names))
      .toBe("Stayed at Pier: the analysis named Player's Residence, but the move was not judged complete");
    expect(describeSceneLocation({ ...summary, reason: 'unnamed-destination' }, names))
      .toBe("Stayed at Pier: the turn never names Player's Residence");
  });

  test('falls back for places it cannot name', () => {
    const summary = summarizeSceneLocation({ analyzed: true, fromLocationId: null, rejected: { reason: 'manual-updates', locationId: 'x' } });
    expect(describeSceneLocation(summary, names)).toBe('Stayed at no location: scene updates are set to manual');
    expect(describeSceneLocation(null, names)).toBeNull();
  });
});
