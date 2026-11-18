// How a structural link reads to the AI. A raw relType such as "connected_to" tells the model
// nothing about what the author meant, so every link it reads is said in these words.
const RELATION_PHRASES: Record<string, string> = {
  inside: 'inside',
  led_by: 'led by',
  member_of: 'member of',
  former_member_of: 'former member of',
  operates_in: 'operates in',
  owned_by: 'owned by',
  carried_by: 'carried by',
  located_in: 'located in',
  created_by: 'created by',
  found_in: 'found in',
  sold_in: 'sold in',
  is_race: 'race / species',
  happened_at: 'happened at',
  involved: 'involved',
  local_to: 'local to (knows what everyone there knows)',
  lives_in: 'lives in',
  works_at: 'works at',
  connected_to: 'tied to',
  adjacent_to: 'adjacent to',
  related_to: 'related to',
};

export function relationPhrase(relType: string): string {
  return RELATION_PHRASES[relType] ?? relType.replace(/_/g, ' ');
}

/** The phrase plus the link's own label, so a job or a rank never hides what the link is. */
export function relationTitle(relType: string, label: string | null | undefined): string {
  const own = String(label ?? '').trim();
  if (relType === 'related_to') return own || relationPhrase(relType);
  return own ? `${relationPhrase(relType)} (${own})` : relationPhrase(relType);
}
