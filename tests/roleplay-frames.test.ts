import { describe, expect, test } from 'vitest';
import { holdDeferredFrames } from '../src/renderer/features/chat/diagnostic-format.js';

const end = { position: { hour: 19, minute: 0 }, locationName: 'The Last Lantern' };
const reply = (id: string, debug: Record<string, unknown> = {}) => ({ id, role: 'ai', debugNotice: JSON.stringify(debug) });

describe('holding a reply frame until Narrative State writes one', () => {
  const messages = [reply('opening'), { id: 'u1', role: 'user' }, reply('newest')];
  const frames = { opening: { originId: 'opening', start: end, end } };

  test('the newest reply holds the previous end point while the analysis runs', () => {
    expect(holdDeferredFrames(messages, frames, { analyzing: true }).newest)
      .toEqual({ originId: 'newest', start: end, end, advance: null, pending: 'analyzing' });
  });

  test('without a running analysis nothing is held', () => {
    expect(holdDeferredFrames(messages, frames)).toEqual({});
  });

  test('a deferred reply stays deferred, and a reply with its own frame is never held', () => {
    const deferred = [reply('opening'), reply('waiting', { narrativeState: { status: 'deferred' } })];
    expect(holdDeferredFrames(deferred, frames, { analyzing: true }).waiting?.pending).toBe('deferred');
    expect(holdDeferredFrames(messages, { ...frames, newest: { originId: 'newest', start: end, end } }, { analyzing: true })).toEqual({});
  });
});
