// Colour names the kind of change, in the chat panel and in Configuration alike.
// Whole class strings so Tailwind can see them.
export const CHANGE_KINDS = {
  scene: { label: 'Scene', group: 'Scene', chip: 'bg-entity-location/14 text-entity-location', dot: 'bg-entity-location', bullet: 'text-entity-location' },
  narrative: { label: 'Narrative', group: 'Story events', chip: 'bg-entity-event/14 text-entity-event', dot: 'bg-entity-event', bullet: 'text-entity-event' },
  inventory: { label: 'Inventory', group: 'Items', chip: 'bg-entity-item/14 text-entity-item', dot: 'bg-entity-item', bullet: 'text-entity-item' },
  resource: { label: 'State', group: 'Resources', chip: 'bg-status-warning/14 text-status-warning', dot: 'bg-status-warning', bullet: 'text-status-warning' },
  progress: { label: 'Progress', group: 'Progression', chip: 'bg-entity-creature/14 text-entity-creature', dot: 'bg-entity-creature', bullet: 'text-entity-creature' },
  entity: { label: 'Entity', group: 'Characters and places', chip: 'bg-entity-concept/12 text-entity-concept', dot: 'bg-entity-concept', bullet: 'text-entity-concept' },
  time: { label: 'Time', group: 'Time', chip: 'bg-status-info/14 text-status-info', dot: 'bg-status-info', bullet: 'text-status-info' }
};

export const kindOf = kind => CHANGE_KINDS[kind] || CHANGE_KINDS.entity;

const OPERATION_LABELS = {
  'assert-fact': 'Fact',
  'set-state': 'State',
  'record-observation': 'Noticed',
  'grant-awareness': 'Noticed',
  'grant-knowledge': 'Learned',
  'set-belief': 'Believes',
  'record-memory': 'Remembers',
  'set-relationship': 'Relationship'
};

const EVENT_LABELS = {
  movement: 'Moved',
  'possession-transfer': 'Handed over',
  revelation: 'Revealed',
  deception: 'Deceived',
  discovery: 'Discovered',
  'relationship-change': 'Relationship'
};

/** A readable name for a story event, from its first operation, then from the event type. */
export function narrativeEventLabel(record) {
  const operations = record?.proposal?.changeSet?.operations || [];
  const event = record?.proposal?.changeSet?.event;
  const first = operations[0];
  const status = first?.knowledge?.status || first?.memory?.status || first?.belief?.status;
  if (status === 'revoked' || status === 'forgotten') return 'Forgot';
  return OPERATION_LABELS[first?.type] || EVENT_LABELS[event?.type] || 'Event';
}

/** A readable name for an entity change: renamed, aliases, or what was introduced. */
export function entityChangeLabel(change) {
  const identity = change.identityUpdate;
  if (identity?.canonicalName) return 'Renamed';
  if (identity) return 'New alias';
  const type = change.proposal?.type?.replace(/s$/, '').toLowerCase() || 'entity';
  return change.status === 'conflicting' ? 'Unclear' : `New ${type}`;
}
