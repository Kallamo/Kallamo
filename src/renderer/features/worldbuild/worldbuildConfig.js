import {
  Anvil, BookOpen, Box, CalendarClock, Coins, FileText, Flag, FlaskConical,
  Gem, Ghost, Globe, Hammer, MapPin, Package, Pickaxe, Shield, Sword, User, Users,
} from 'lucide-react';

// `wash` tints the open sheet's header with the type's colour, so each kind of
// record is recognisable before its name is read.
export const TYPES = {
  System: { label: 'System / Concept', icon: BookOpen, medallion: 'bg-entity-concept/15 text-entity-concept border-entity-concept/30', ring: 'border-entity-concept/25', soft: 'text-entity-concept', wash: 'from-entity-concept/12' },
  Locations: { label: 'Location', icon: MapPin, medallion: 'bg-entity-location/15 text-entity-location border-entity-location/30', ring: 'border-entity-location/25', soft: 'text-entity-location', wash: 'from-entity-location/12' },
  Items: { label: 'Item', icon: Package, medallion: 'bg-entity-item/15 text-entity-item border-entity-item/30', ring: 'border-entity-item/25', soft: 'text-entity-item', wash: 'from-entity-item/12' },
  Races: { label: 'Race', icon: Users, medallion: 'bg-entity-race/15 text-entity-race border-entity-race/30', ring: 'border-entity-race/25', soft: 'text-entity-race', wash: 'from-entity-race/12' },
  Factions: { label: 'Faction', icon: Flag, medallion: 'bg-entity-faction/15 text-entity-faction border-entity-faction/30', ring: 'border-entity-faction/25', soft: 'text-entity-faction', wash: 'from-entity-faction/12' },
  Characters: { label: 'Character', icon: User, medallion: 'bg-entity-character/15 text-entity-character border-entity-character/30', ring: 'border-entity-character/25', soft: 'text-entity-character', wash: 'from-entity-character/12' },
  Creatures: { label: 'Creature / Entity', icon: Ghost, medallion: 'bg-entity-creature/15 text-entity-creature border-entity-creature/30', ring: 'border-entity-creature/25', soft: 'text-entity-creature', wash: 'from-entity-creature/12' },
  Events: { label: 'Event', icon: CalendarClock, medallion: 'bg-entity-event/15 text-entity-event border-entity-event/30', ring: 'border-entity-event/25', soft: 'text-entity-event', wash: 'from-entity-event/12' },
};

export const TYPE_ORDER = ['Characters', 'Locations', 'Factions', 'Items', 'Races', 'Creatures', 'Events', 'System'];
export const ITEM_TYPES = [
  'Weapon', 'Armor', 'Tool', 'Consumable', 'Artifact', 'Document',
  'Container', 'Currency', 'Material', 'Resource', 'Object',
];

export const ITEM_TYPE_META = {
  Weapon: { icon: Sword, label: 'Weapon' },
  Armor: { icon: Shield, label: 'Armor' },
  Tool: { icon: Hammer, label: 'Tool' },
  Consumable: { icon: FlaskConical, label: 'Consumable' },
  Artifact: { icon: Gem, label: 'Artifact' },
  Document: { icon: FileText, label: 'Document' },
  Container: { icon: Box, label: 'Container' },
  Currency: { icon: Coins, label: 'Currency' },
  Material: { icon: Anvil, label: 'Material' },
  Resource: { icon: Pickaxe, label: 'Resource' },
  Object: { icon: Package, label: 'Object' },
};

export const itemMeta = (itemType) => ITEM_TYPE_META[itemType] || { icon: Package, label: itemType || 'Item' };
export const entityMeta = (entity) => {
  const base = meta(entity?.type);
  if (entity?.type !== 'Items') return base;
  return { ...base, icon: itemMeta(entity.data?.itemType).icon };
};
export const RARITY = ['Unique', 'Rare', 'Uncommon', 'Common', 'Abundant'];
export const THREAT = ['Harmless', 'Minor', 'Dangerous', 'Deadly', 'Legendary'];
export const STATUS = {
  alive: { label: 'Alive', cls: 'bg-status-success/15 text-status-success border-status-success/30' },
  deceased: { label: 'Deceased', cls: 'bg-status-danger/15 text-status-danger border-status-danger/30' },
  missing: { label: 'Missing', cls: 'bg-status-warning/15 text-status-warning border-status-warning/30' },
  unknown: { label: 'Unknown', cls: 'bg-surface-hover/45 text-text-muted border-border-default' },
};
export const DISPOSITION = {
  hostile: { label: 'Hostile', cls: 'bg-status-danger/15 text-status-danger border-status-danger/30' },
  neutral: { label: 'Neutral', cls: 'bg-surface-hover/45 text-text-muted border-border-default' },
  friendly: { label: 'Friendly', cls: 'bg-status-success/15 text-status-success border-status-success/30' },
  unknown: { label: 'Unknown', cls: 'bg-surface-hover/45 text-text-muted border-border-default' },
};
export const CREATURE_NATURES = ['Beast', 'Monster', 'Spirit', 'Undead', 'Construct', 'Elemental', 'Deity', 'Aberration'];
export const ABUNDANCE_HELP = [
  ['Unique', 'Only one exists in the whole world.'],
  ['Rare', 'Very few, hard to come by.'],
  ['Uncommon', 'Exists, but not everywhere.'],
  ['Common', 'Found in most places.'],
  ['Abundant', 'Everywhere, effectively unlimited.'],
];
export const RELATIONSHIP_LABELS = ['Father', 'Mother', 'Sibling', 'Child', 'Friend', 'Rival', 'Enemy', 'Mentor', 'Ally', 'Lover'];

const FIELD_LABELS = {
  status: 'Status', age: 'Age', appearance: 'Appearance', personality: 'Personality', role: 'Role', abilities: 'Abilities',
  disposition: 'Disposition', nature: 'Nature', abundance: 'Abundance', threat: 'Threat', kind: 'Kind',
  description: 'Description', locationType: 'Type', itemType: 'Type', content: 'Content',
};

export const meta = (type) => TYPES[type] || { label: type, icon: Globe, medallion: 'bg-entity-concept/15 text-entity-concept border-entity-concept/30', ring: 'border-entity-concept/25', soft: 'text-entity-concept', wash: 'from-entity-concept/12' };
export const fieldLabel = (field) => FIELD_LABELS[field] || field;
