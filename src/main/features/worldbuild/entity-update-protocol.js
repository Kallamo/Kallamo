const { CHANGE_KINDS } = require('./entity-update-schema');

function isEntityUpdateShape(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Array.isArray(value.changes)
    && value.changes.every(change => change && typeof change === 'object' && CHANGE_KINDS.includes(change.kind));
}

function decodeEntityUpdate(value) {
  const decoded = { lore: null, data: {}, links: {}, narrative: [] };
  for (const change of value.changes) {
    const proposal = {
      value: decodeValue(change.value),
      certainty: 'explicit',
      support: String(change.support || '').trim(),
      evidence: Array.isArray(change.evidence) ? change.evidence.map(String) : [],
    };
    if (change.kind === 'field' && change.key) decoded.data[change.key] = proposal;
    else if (change.kind === 'link' && change.key) {
      const item = {
        target: String(change.target || '').trim(),
        targetRole: String(change.targetRole || '').trim(),
        source: '',
        value: change.score,
        sourcePerspective: String(change.sourcePerspective || '').trim(),
        certainty: 'explicit',
        support: proposal.support,
        evidence: proposal.evidence,
      };
      if (!decoded.links[change.key]) decoded.links[change.key] = [];
      decoded.links[change.key].push(item);
    } else {
      decoded.narrative.push({
        kind: change.kind,
        key: String(change.key || '').trim(),
        value: String(change.value || '').trim(),
        subjectId: String(change.subjectId || '').trim(),
        target: String(change.target || '').trim(),
        targetId: String(change.targetId || '').trim(),
        perspectiveOwnerId: String(change.perspectiveOwnerId || '').trim(),
        targetRole: String(change.targetRole || '').trim(),
        sourcePerspective: String(change.sourcePerspective || '').trim(),
        score: Number(change.score),
        method: String(change.method || ''),
        accessibility: String(change.accessibility || ''),
        support: proposal.support,
        evidence: proposal.evidence,
      });
    }
  }
  return decoded;
}

function decodeValue(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  if (!/^(?:true|false|null|-?\d|\[|\{)/.test(text)) return text;
  try { return JSON.parse(text); } catch { return text; }
}

module.exports = { decodeEntityUpdate, isEntityUpdateShape };
