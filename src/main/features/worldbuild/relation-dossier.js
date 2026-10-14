// How a relation edge reads in the retrieval dossier. Whatever a link records has to be said
// here, or the model never learns it.

/** A world date as prose, mirroring the sheet's own formatting. */
function worldDateText(calendar, value) {
  if (!calendar || !value || value.day == null || value.month == null) return '';
  const month = calendar.months?.[Number(value.month) - 1]?.name || `month ${value.month}`;
  const era = calendar.eras?.find(item => item.id === value.eraId)?.shortName;
  return `${value.day} ${month} ${value.year}${era ? ` ${era}` : ''}`;
}

/** Detail beyond the label, such as a tenure's dates and the founder; empty when there is nothing to add. */
function edgeDetail(link, calendar) {
  const parts = [];
  // A specific being's nature lives on its species, so the species edge says it.
  const nature = link?.relType === 'is_race' && link.entity?.type === 'Creatures' ? String(link.entity.data?.nature || '').trim() : '';
  if (nature) parts.push(nature);
  const metadata = link && link.metadata;
  if (!metadata || typeof metadata !== 'object') return parts.length ? ` (${parts.join('; ')})` : '';
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
