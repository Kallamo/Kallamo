import {
  Anvil, Box, CircleHelp, Coins, DoorOpen, FlaskRound, Gem, Hammer, LandPlot, Map as MapIcon, MapPin, Orbit, Package, Pickaxe, Scroll, Shield, Sword, UserRound, UsersRound,
} from 'lucide-react';
import { DragonIcon, MoneybagIcon, PennantIcon, StopwatchIcon, StoreIcon } from '../../components/ui/glyphs';
import { LOCATION_SIZES, locationSizeGuide, locationSizeLabel, locationSizeOf, presenceOrder } from '../../../shared/location-sizes';

// `wash` tints the open sheet's header with the type's color, so each kind of
// record is recognizable before its name is read.
export const TYPES = {
  System: { label: 'System / Concept', icon: Orbit, medallion: 'bg-entity-concept/15 text-entity-concept border-entity-concept/30', ring: 'border-entity-concept/25', soft: 'text-entity-concept', wash: 'from-entity-concept/12' },
  Locations: { label: 'Location', icon: MapPin, medallion: 'bg-entity-location/15 text-entity-location border-entity-location/30', ring: 'border-entity-location/25', soft: 'text-entity-location', wash: 'from-entity-location/12' },
  Items: { label: 'Item', icon: MoneybagIcon, medallion: 'bg-entity-item/15 text-entity-item border-entity-item/30', ring: 'border-entity-item/25', soft: 'text-entity-item', wash: 'from-entity-item/12' },
  Races: { label: 'Race', icon: UsersRound, medallion: 'bg-entity-race/15 text-entity-race border-entity-race/30', ring: 'border-entity-race/25', soft: 'text-entity-race', wash: 'from-entity-race/12' },
  Factions: { label: 'Faction', icon: PennantIcon, medallion: 'bg-entity-faction/15 text-entity-faction border-entity-faction/30', ring: 'border-entity-faction/25', soft: 'text-entity-faction', wash: 'from-entity-faction/12' },
  Characters: { label: 'Character', icon: UserRound, medallion: 'bg-entity-character/15 text-entity-character border-entity-character/30', ring: 'border-entity-character/25', soft: 'text-entity-character', wash: 'from-entity-character/12' },
  Creatures: { label: 'Creature / Entity', icon: DragonIcon, medallion: 'bg-entity-creature/15 text-entity-creature border-entity-creature/30', ring: 'border-entity-creature/25', soft: 'text-entity-creature', wash: 'from-entity-creature/12' },
  Events: { label: 'Event', icon: StopwatchIcon, medallion: 'bg-entity-event/15 text-entity-event border-entity-event/30', ring: 'border-entity-event/25', soft: 'text-entity-event', wash: 'from-entity-event/12' },
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
  Consumable: { icon: FlaskRound, label: 'Consumable' },
  Artifact: { icon: Gem, label: 'Artifact' },
  Document: { icon: Scroll, label: 'Document' },
  Container: { icon: Box, label: 'Container' },
  Currency: { icon: Coins, label: 'Currency' },
  Material: { icon: Anvil, label: 'Material' },
  Resource: { icon: Pickaxe, label: 'Resource' },
  Object: { icon: Package, label: 'Object' },
};

export const itemMeta = (itemType) => ITEM_TYPE_META[itemType] || { icon: Package, label: itemType || 'Item' };

// The icon grows with the place, so a list of locations reads as a scale before any name.
const LOCATION_SIZE_ICONS = { region: MapIcon, area: LandPlot, place: StoreIcon, spot: DoorOpen };
export const LOCATION_SIZE_OPTIONS = LOCATION_SIZES.map(size => ({
  value: size.id, label: size.label, guide: locationSizeGuide(size.id), icon: LOCATION_SIZE_ICONS[size.id],
}));
export const locationSizeIcon = (size) => LOCATION_SIZE_ICONS[size] || MapPin;

export const entityMeta = (entity) => {
  const base = meta(entity?.type);
  if (entity?.type === 'Items') return { ...base, icon: itemMeta(entity.data?.itemType).icon };
  if (entity?.type === 'Locations') return { ...base, icon: locationSizeIcon(locationSizeOf(entity)) };
  return base;
};

/** Locations for a "where is it" picker: places and spots first, alphabetical within a size. */
export const sortLocationsForPresence = (locations) => [...locations]
  .sort((a, b) => presenceOrder(locationSizeOf(a)) - presenceOrder(locationSizeOf(b))
    || String(a.canonicalName).localeCompare(String(b.canonicalName)));

export const locationPresenceOptions = (locations) => sortLocationsForPresence(locations)
  .map(entity => {
    const size = locationSizeOf(entity);
    return {
      id: entity.id,
      label: entity.canonicalName,
      aliases: Array.isArray(entity.aliases) ? entity.aliases : String(entity.aliases || '').split(',').map(alias => alias.trim()).filter(Boolean),
      group: locationSizeLabel(size) || 'Location',
      icon: locationSizeIcon(size),
    };
  });
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
  description: 'Description', locationType: 'Type', size: 'Size', itemType: 'Type', content: 'Content',
};

export const meta = (type) => TYPES[type] || { label: type, icon: CircleHelp, medallion: 'bg-entity-concept/15 text-entity-concept border-entity-concept/30', ring: 'border-entity-concept/25', soft: 'text-entity-concept', wash: 'from-entity-concept/12' };
export const fieldLabel = (field) => FIELD_LABELS[field] || field;
