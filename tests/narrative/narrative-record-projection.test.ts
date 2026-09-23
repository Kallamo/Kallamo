import { describe, expect, test } from 'vitest';
import {
  projectCurrentNarrativeRecords,
  type NarrativeRecordRow
} from '../../src/main/features/narrative/narrative-record-projection';

describe('current narrative record projection', () => {
  test('replaces a stable Knowledge entry and removes its revoked revision', () => {
    const rows = [
      record('knowledge', 'knowledge-one', 1, {
        entryId: 'entry-one',
        status: 'active',
        proposition: { subjectId: 'order', predicate: 'statement', object: 'Old statement' }
      }),
      record('knowledge', 'knowledge-two', 2, {
        entryId: 'entry-one',
        status: 'active',
        proposition: { subjectId: 'order', predicate: 'statement', object: 'Current statement' }
      })
    ];

    expect(projectCurrentNarrativeRecords(rows).map(value => value.row.record_id))
      .toEqual(['knowledge-two']);

    rows.push(record('knowledge', 'knowledge-three', 3, {
      entryId: 'entry-one',
      status: 'revoked',
      proposition: { subjectId: 'order', predicate: 'statement', object: 'Current statement' }
    }));
    expect(projectCurrentNarrativeRecords(rows)).toEqual([]);
  });

  test('removes forgotten and superseded memories from the current projection', () => {
    const rows = [
      record('memory', 'memory-one', 1, {
        id: 'memory-one',
        status: 'active',
        summary: 'First version'
      }),
      record('memory', 'memory-two', 2, {
        id: 'memory-two',
        supersedesMemoryId: 'memory-one',
        status: 'active',
        summary: 'Second version'
      }),
      record('memory', 'memory-three', 3, {
        id: 'memory-three',
        supersedesMemoryId: 'memory-two',
        status: 'forgotten',
        summary: 'Second version'
      })
    ];

    expect(projectCurrentNarrativeRecords(rows)).toEqual([]);
  });
});

function record(
  recordType: NarrativeRecordRow['record_type'],
  recordId: string,
  sequence: number,
  payload: Record<string, unknown>
): NarrativeRecordRow {
  return {
    record_type: recordType,
    record_id: recordId,
    subject_id: 'kepler',
    source_event_id: `event-${sequence}`,
    payload_json: JSON.stringify(payload),
    narrative_sequence: sequence
  };
}
