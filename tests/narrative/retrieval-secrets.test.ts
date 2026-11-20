import { describe, expect, test } from 'vitest';
import { secretsAtRisk } from '../../src/main/features/narrative/retrieval/scene-core';

const names: Record<string, string> = { corin: 'Corin', tomas: 'Tomas', mara: 'Mara' };
const view = { nameOf: (id: string) => names[id] } as never;

function secret(id: string, holder: string, subject: string, text: string, eventId: string) {
  return {
    record: {
      id, kind: 'holding', holder, eventId, text, secrecy: { sharedWith: [] },
      claim: { subject, predicate: 'note', object: { kind: 'value', value: text }, polarity: 'affirms' }
    }
  };
}

function reads(held: Record<string, ReturnType<typeof secret>[]>, participants: Record<string, string[]> = {}) {
  return {
    holdings: (holder: string) => held[holder] ?? [],
    participantsOf: (eventId: string) => new Set(participants[eventId] ?? [])
  } as never;
}

describe('Secrets at risk in a scene', () => {
  const present = ['corin', 'tomas', 'mara'];
  const focusIds = new Set(present);

  test('whoever was there when it was said is not kept from it', () => {
    const items = secretsAtRisk({
      view, present, focusIds,
      reads: reads({ corin: [secret('h1', 'corin', 'corin', 'The seal is forged.', 'scene-1')] }, { 'scene-1': ['corin', 'tomas', 'mara'] })
    });
    expect(items).toEqual([]);
  });

  test('what is about someone is not kept from them', () => {
    const items = secretsAtRisk({
      view, present, focusIds,
      reads: reads({ tomas: [secret('h1', 'tomas', 'corin', 'Corin bet his Insight on a pact.', 'entry-1')] }, { 'entry-1': ['tomas'] })
    });
    expect(items.map(item => item.text)).toEqual(['Tomas keeps from Mara: Corin bet his Insight on a pact.']);
  });

  test('one statement kept by two people from the same person is one line', () => {
    const text = 'Assessors may report the copy.';
    const items = secretsAtRisk({
      view, present, focusIds,
      reads: reads({
        corin: [secret('h1', 'corin', 'corin', text, 'entry-1')],
        mara: [secret('h2', 'mara', 'corin', text, 'entry-2')]
      }, { 'entry-1': ['corin'], 'entry-2': ['mara'] })
    });
    expect(items.map(item => item.text)).toEqual([`Corin, Mara keep from Tomas: ${text}`]);
  });
});
