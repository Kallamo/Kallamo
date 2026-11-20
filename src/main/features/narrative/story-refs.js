// What the story pass may do with a record it was shown, by its ref: change it, end it, or name it
// as what someone was told or reasoned from. Refs resolve here, so no id travels through the model.

/** The status each kind takes for each way a record can end. */
const END_STATUS = {
  knowledge: { forgot: 'forgotten', abandoned: 'revoked', disproved: 'revoked', retracted: 'revoked', settled: 'revoked' },
  belief: { forgot: 'abandoned', lost: 'abandoned', abandoned: 'abandoned', disproved: 'abandoned', retracted: 'abandoned', settled: 'abandoned' },
  memory: { forgot: 'forgotten', abandoned: 'forgotten', disproved: 'forgotten', retracted: 'forgotten' }
};

const ACQUISITIONS = new Set(['participant', 'witness', 'reported', 'inferred']);
const ATTITUDES = new Set(['knows', 'believes', 'suspects']);
// What a record replaces or rests on is only ever set from a ref, never taken from the model.
const RESOLVED_ONLY = new Set(['supersedesId', 'supersedesMemoryId', 'mergesMemoryIds', 'entryId', 'authored', 'sourceRecordId', 'premiseIds', 'toldFrom', 'premises']);

function withoutResolvedFields(operation) {
  return Object.fromEntries(Object.entries(operation).filter(([key]) => !RESOLVED_ONLY.has(key)));
}

/** The teller's record and the premises a knowledge or belief names, resolved or reported. */
function resolveSupport(operation, source, refs, unresolved) {
  if (operation.type !== 'knowledge' && operation.type !== 'belief') return operation;
  const resolved = { ...operation };
  if (source.toldFrom !== undefined) {
    const row = refs.get(String(source.toldFrom));
    if (row && (row.type === 'knowledge' || row.type === 'belief') && row.subjectId && row.subjectId !== operation.subjectId) {
      resolved.sourceRecordId = String(row.value.id);
      resolved.informantIds = [...new Set([row.subjectId, ...(Array.isArray(operation.informantIds) ? operation.informantIds : [])])];
      if (operation.type === 'knowledge') resolved.acquisition = 'reported';
    } else {
      unresolved.push({ ref: source.toldFrom ?? null, type: 'toldFrom', reason: row ? 'not-a-teller-record' : 'unknown-ref' });
    }
  }
  if (Array.isArray(source.premises) && source.premises.length) {
    const premiseIds = [];
    for (const ref of source.premises) {
      const row = refs.get(String(ref));
      // An inference rests on what its own holder already holds.
      if (row && row.subjectId === operation.subjectId) premiseIds.push(String(row.value.id));
      else unresolved.push({ ref: ref ?? null, type: 'premise', reason: row ? 'not-the-holders' : 'unknown-ref' });
    }
    if (premiseIds.length) {
      resolved.premiseIds = [...new Set(premiseIds)];
      if (operation.type === 'knowledge') resolved.acquisition = 'inferred';
    }
  }
  return resolved;
}

// Forgetting keeps the record with its holder, out of reach: for now, or for good.
const OUT_OF_REACH = { forgot: 'suppressed', lost: 'inaccessible' };

function resolveEnd(operation, row, authored) {
  const value = row.value || {};
  if (OUT_OF_REACH[operation.how] && (row.type === 'knowledge' || row.type === 'memory')) {
    return resolveRevision({ accessibility: OUT_OF_REACH[operation.how] }, row, authored);
  }
  const status = END_STATUS[row.type]?.[operation.how];
  if (!status) return { unresolved: { ref: operation.ref, type: 'end', reason: 'cannot-end' } };
  return {
    operation: {
      type: 'end',
      kind: row.type,
      recordId: String(value.id),
      entryId: String(value.entryId || value.id),
      subjectId: row.subjectId,
      ...(value.proposition ? { proposition: value.proposition } : {}),
      ...(value.summary ? { summary: value.summary } : {}),
      ...(value.acquisition ? { acquisition: value.acquisition } : {}),
      status,
      reason: String(operation.reason || ''),
      authored
    }
  };
}

function resolveRevision(operation, row, authored) {
  const value = row.value || {};
  if (row.type === 'memory') {
    return {
      operation: {
        type: 'memory',
        subjectId: row.subjectId,
        summary: operation.summary || value.summary,
        category: operation.category || value.category,
        salience: Number.isFinite(operation.salience) ? operation.salience : Number.isFinite(value.salience) ? value.salience : 0.9,
        accessibility: operation.accessibility || value.accessibility,
        supersedesMemoryId: String(value.id),
        authored
      }
    };
  }
  // What someone thinks another holds is ended and written anew, never revised in place.
  if ((row.type !== 'knowledge' && row.type !== 'belief') || value.heldById) {
    return { unresolved: { ref: operation.ref, type: 'revise', reason: 'cannot-revise' } };
  }
  // A suspicion the story confirms becomes a belief or knowledge: the attitude decides the kind.
  const current = row.type === 'knowledge' ? 'knows' : value.attitude === 'suspects' ? 'suspects' : 'believes';
  const attitude = ATTITUDES.has(operation.attitude) ? operation.attitude : current;
  const negated = typeof operation.negated === 'boolean' ? operation.negated : value.negated === true;
  const common = {
    subjectId: row.subjectId,
    proposition: operation.proposition || value.proposition,
    category: operation.category || value.category,
    confidence: Number.isFinite(operation.confidence) ? operation.confidence : Number(value.confidence ?? 1),
    // The correction stays under the entry of what it corrects, so what refers to it survives.
    entryId: String(value.entryId || value.id),
    supersedesId: String(value.id),
    ...(Number.isFinite(value.salience) ? { salience: value.salience } : {}),
    ...(negated ? { negated: true } : {}),
    authored
  };
  if (attitude === 'knows') {
    const kept = row.type === 'knowledge' && ACQUISITIONS.has(value.acquisition) ? value.acquisition : 'witness';
    const acquisition = ACQUISITIONS.has(operation.acquisition) ? operation.acquisition : kept;
    return {
      operation: {
        type: 'knowledge',
        ...common,
        acquisition,
        ...(acquisition === 'reported' && row.type === 'knowledge' && Array.isArray(value.informantIds) ? { informantIds: value.informantIds } : {}),
        accessibility: operation.accessibility || value.accessibility
      }
    };
  }
  return { operation: { type: 'belief', ...common, ...(attitude === 'suspects' ? { attitude: 'suspects' } : {}) } };
}

const CONFIRMED_BY = new Set(['witnessed', 'told', 'evidence']);

/**
 * Proof in front of the holder: seen or shown makes it certain, and a suspicion or belief becomes
 * knowledge; being told makes it firmer without making it certain.
 */
function resolveConfirm(operation, row, authored) {
  const value = row.value || {};
  if (row.type !== 'knowledge' && row.type !== 'belief') return { unresolved: { ref: operation.ref, type: 'confirm', reason: 'cannot-confirm' } };
  const by = CONFIRMED_BY.has(operation.by) ? operation.by : 'told';
  const current = Number.isFinite(Number(value.confidence)) ? Number(value.confidence) : 0.8;
  if (by === 'told') {
    const attitude = row.type === 'knowledge' ? 'knows' : 'believes';
    return resolveRevision({ confidence: Math.min(0.95, Math.max(current, current + 0.15)), attitude }, row, authored);
  }
  return resolveRevision({ confidence: 1, attitude: 'knows', acquisition: row.type === 'knowledge' && value.acquisition ? value.acquisition : 'witness' }, row, authored);
}

/** A record out of reach for now comes back; one lost for good never does. */
function resolveRecall(operation, row, authored) {
  const value = row.value || {};
  if (row.type !== 'knowledge' && row.type !== 'memory') return { unresolved: { ref: operation.ref, type: 'recall', reason: 'cannot-recall' } };
  if (value.accessibility === 'inaccessible') return { unresolved: { ref: operation.ref, type: 'recall', reason: 'lost-for-good' } };
  if (value.accessibility !== 'suppressed') return { unresolved: { ref: operation.ref, type: 'recall', reason: 'within-reach' } };
  return resolveRevision({ accessibility: 'available' }, row, authored);
}

/** Several memories of one holder telling the same experience become one, in that holder's words. */
function resolveMerge(operation, refs) {
  const rows = [...new Set(Array.isArray(operation.refs) ? operation.refs.map(String) : [])].map(ref => refs.get(ref));
  const summary = String(operation.summary || '').trim();
  if (rows.length < 2 || rows.some(row => !row || row.type !== 'memory') || !summary) {
    return { unresolved: { ref: Array.isArray(operation.refs) ? operation.refs.join(',') : null, type: 'merge', reason: 'cannot-merge' } };
  }
  if (new Set(rows.map(row => row.subjectId)).size > 1) return { unresolved: { ref: operation.refs.join(','), type: 'merge', reason: 'different-holders' } };
  const [first, ...rest] = rows;
  const salience = Math.max(...rows.map(row => (Number.isFinite(row.value?.salience) ? row.value.salience : 0.6)));
  return {
    operation: {
      type: 'memory',
      subjectId: first.subjectId,
      summary,
      category: first.value?.category || rest.find(row => row.value?.category)?.value.category,
      salience,
      accessibility: 'available',
      supersedesMemoryId: String(first.value.id),
      mergesMemoryIds: rest.map(row => String(row.value.id)),
      authored: rows.some(row => row.interpreter !== undefined && row.interpreter !== 'model')
    }
  };
}

const REF_OPERATIONS = new Set(['end', 'revise', 'confirm', 'recall', 'merge']);

function resolveOperation(operation, refs, unresolved) {
  if (!operation || typeof operation !== 'object') return { operation };
  if (operation.type === 'merge') return resolveMerge(operation, refs);
  if (!REF_OPERATIONS.has(operation.type)) {
    return { operation: resolveSupport(withoutResolvedFields(operation), operation, refs, unresolved) };
  }
  const row = refs.get(String(operation.ref || ''));
  if (!row) return { unresolved: { ref: operation.ref ?? null, type: operation.type, reason: 'unknown-ref' } };
  const authored = row.interpreter !== undefined && row.interpreter !== 'model';
  if (operation.type === 'end') return resolveEnd(operation, row, authored);
  if (operation.type === 'confirm') return resolveConfirm(operation, row, authored);
  if (operation.type === 'recall') return resolveRecall(operation, row, authored);
  const revised = resolveRevision(operation, row, authored);
  return revised.operation ? { operation: resolveSupport(revised.operation, operation, refs, unresolved) } : revised;
}

/** The events with every ref resolved against the slice; refs that resolve to nothing are reported. */
function resolveRecordReferences(events, refs) {
  const unresolved = [];
  const map = refs || new Map();
  const resolved = (Array.isArray(events) ? events : []).map(event => ({
    ...event,
    operations: (Array.isArray(event?.operations) ? event.operations : []).flatMap(operation => {
      const result = resolveOperation(operation, map, unresolved);
      if (result.unresolved) {
        unresolved.push(result.unresolved);
        return [];
      }
      return [result.operation];
    })
  }));
  return { events: resolved, unresolved };
}

module.exports = { END_STATUS, resolveRecordReferences };
