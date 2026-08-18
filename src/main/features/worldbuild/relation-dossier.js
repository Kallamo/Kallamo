// How a relation edge is written into the retrieval dossier. Kept apart from the runner
// so the wording can be exercised on its own: everything the author records on a link has
// to be said here, or the model never learns it.

/** A world date as prose, mirroring the sheet's own formatting. */
function worldDateText(calendar, value) {
  if (!calendar || !value || value.day == null || value.month == null) return '';
  const month = calendar.months?.[Number(value.month) - 1]?.name || `month ${value.month}`;
  const era = calendar.eras?.find(item => item.id === value.eraId)?.shortName;
  return `${value.day} ${month} ${value.year}${era ? ` ${era}` : ''}`;
}

/**
 * Detail an edge carries beyond its label. Membership records when a tenure began and
 * ended and who founded the group; without this the dossier would show only the rank.
 * Returns an empty string for edges with nothing to add, so their line is untouched.
 */
function edgeDetail(link, calendar) {
  const metadata = link && link.metadata;
  if (!metadata || typeof metadata !== 'object') return '';
  const parts = [];
  if (metadata.founder) parts.push('founder');
  const joined = worldDateText(calendar, metadata.joined);
  const left = worldDateText(calendar, metadata.left);
  const leaderSince = worldDateText(calendar, metadata.leaderSince);
  if (joined && left) parts.push(`from ${joined} to ${left}`);
  else if (joined) parts.push(`since ${joined}`);
  else if (left) parts.push(`until ${left}`);
  if (leaderSince) parts.push(`leading since ${leaderSince}`);
  return parts.length ? ` (${parts.join('; ')})` : '';
}

module.exports = { edgeDetail, worldDateText };
