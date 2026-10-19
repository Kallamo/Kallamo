const { CHANGE_KINDS } = require('./entity-update-schema');

function isEntityUpdateShape(value) {
  return Boolean(value)
    && typeof value === 'object'
    && !Array.isArray(value)
    && Array.isArray(value.changes)
    && value.changes.every(change => change && typeof change === 'object' && CHANGE_KINDS.includes(change.kind));
}

function decodeEntityUpdate(value) {
  const decoded = { data: {}, links: {}, narrative: [], history: [], skills: [] };
  for (const change of value.changes) {
    const support = String(change.support || '').trim();
    const evidence = Array.isArray(change.evidence) ? change.evidence.map(String) : [];
    if (change.kind === 'field' && change.key) {
      decoded.data[change.key] = { value: decodeValue(change.value), support, evidence };
    } else if (change.kind === 'link' && change.key) {
      const item = {
        target: String(change.target || '').trim(),
        targetRole: String(change.targetRole || '').trim(),
        source: '',
        value: change.score,
        sourcePerspective: String(change.sourcePerspective || '').trim(),
        support,
        evidence,
      };
      if (!decoded.links[change.key]) decoded.links[change.key] = [];
      decoded.links[change.key].push(item);
    } else if (change.kind === 'history') {
      const statement = String(change.value || '').trim();
      if (statement) decoded.history.push({ kind: 'history', value: statement, support, evidence });
    } else if (change.kind === 'skill') {
      // The schema is closed, so a skill reuses the generic slots: key names it, value is the
      // rank, target its parent and sourcePerspective the meaning of a skill not yet in the catalog.
      const name = String(change.key || '').trim();
      if (name) decoded.skills.push({
        name,
        rank: String(change.value || '').trim(),
        parent: String(change.target || '').trim(),
        description: String(change.sourcePerspective || '').trim(),
        support,
        evidence,
      });
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
        support,
        evidence,
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
