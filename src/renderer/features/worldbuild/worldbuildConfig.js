import {
  Anvil, Box, CircleHelp, Coins, DoorOpen, FlaskRound, Gem, Hammer, LandPlot, Map as MapIcon, MapPin, Orbit, Package, Pickaxe, Scroll, Shield, Sword, UserRound, UsersRound,
} from 'lucide-react';
import { DragonIcon, MoneybagIcon, PennantIcon, StopwatchIcon, StoreIcon } from '../../components/ui/glyphs';
import { LOCATION_SIZES, locationSizeGuide, locationSizeLabel, locationSizeOf, presenceOrder } from '../../../shared/location-sizes';

// `wash` tints the open sheet's header with the type's color, so each kind of
// record is recognizable before its name is read.
export const TYPES = {
  System: { label: 'System or concept', plural: 'Systems', icon: Orbit, medallion: 'bg-entity-concept/15 text-entity-concept border-entity-concept/30', ring: 'border-entity-concept/25', soft: 'text-entity-concept', dot: 'bg-entity-concept', wash: 'from-entity-concept/12' },
  Locations: { label: 'Location', plural: 'Locations', icon: MapPin, medallion: 'bg-entity-location/15 text-entity-location border-entity-location/30', ring: 'border-entity-location/25', soft: 'text-entity-location', dot: 'bg-entity-location', wash: 'from-entity-location/12' },
  Items: { label: 'Item', plural: 'Items', icon: MoneybagIcon, medallion: 'bg-entity-item/15 text-entity-item border-entity-item/30', ring: 'border-entity-item/25', soft: 'text-entity-item', dot: 'bg-entity-item', wash: 'from-entity-item/12' },
  Races: { label: 'Race', plural: 'Races', icon: UsersRound, medallion: 'bg-entity-race/15 text-entity-race border-entity-race/30', ring: 'border-entity-race/25', soft: 'text-entity-race', dot: 'bg-entity-race', wash: 'from-entity-race/12' },
  Factions: { label: 'Faction', plural: 'Factions', icon: PennantIcon, medallion: 'bg-entity-faction/15 text-entity-faction border-entity-faction/30', ring: 'border-entity-faction/25', soft: 'text-entity-faction', dot: 'bg-entity-faction', wash: 'from-entity-faction/12' },
  Characters: { label: 'Character', plural: 'Characters', icon: UserRound, medallion: 'bg-entity-character/15 text-entity-character border-entity-character/30', ring: 'border-entity-character/25', soft: 'text-entity-character', dot: 'bg-entity-character', wash: 'from-entity-character/12' },
  Creatures: { label: 'Creature', plural: 'Creatures', icon: DragonIcon, medallion: 'bg-entity-creature/15 text-entity-creature border-entity-creature/30', ring: 'border-entity-creature/25', soft: 'text-entity-creature', dot: 'bg-entity-creature', wash: 'from-entity-creature/12' },
  Events: { label: 'Event', plural: 'Events', icon: StopwatchIcon, medallion: 'bg-entity-event/15 text-entity-event border-entity-event/30', ring: 'border-entity-event/25', soft: 'text-entity-event', dot: 'bg-entity-event', wash: 'from-entity-event/12' },
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

const ITEM_FAMILIES = {
  combat: { tile: 'bg-item-combat/12 text-item-combat border-item-combat/30', soft: 'text-item-combat', wash: 'from-item-combat/10 border-item-combat/25' },
  craft: { tile: 'bg-item-craft/12 text-item-craft border-item-craft/30', soft: 'text-item-craft', wash: 'from-item-craft/10 border-item-craft/25' },
  consumable: { tile: 'bg-item-consumable/12 text-item-consumable border-item-consumable/30', soft: 'text-item-consumable', wash: 'from-item-consumable/10 border-item-consumable/25' },
  artifact: { tile: 'bg-item-artifact/12 text-item-artifact border-item-artifact/30', soft: 'text-item-artifact', wash: 'from-item-artifact/10 border-item-artifact/25' },
  neutral: { tile: 'bg-item-neutral/10 text-item-neutral border-item-neutral/25', soft: 'text-item-neutral', wash: 'from-item-neutral/8 border-item-neutral/20' },
};

const ITEM_TYPE_FAMILY = {
  Weapon: 'combat', Armor: 'combat',
  Tool: 'craft', Material: 'craft', Resource: 'craft',
  Consumable: 'consumable',
  Artifact: 'artifact',
};

/** Colour classes for an item type's family; unknown types read as neutral. */
export const itemFamily = (itemType) => ITEM_FAMILIES[ITEM_TYPE_FAMILY[itemType] || 'neutral'];

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
// `dot` is the state read at a glance; the label stays neutral text beside it.
export const STATUS = {
  alive: { label: 'Alive', dot: 'bg-status-success' },
  deceased: { label: 'Deceased', dot: 'bg-status-danger' },
  missing: { label: 'Missing', dot: 'bg-status-warning' },
  unknown: { label: 'Unknown', dot: 'bg-text-subtle' },
};
export const DISPOSITION = {
  hostile: { label: 'Hostile', dot: 'bg-status-danger' },
  neutral: { label: 'Neutral', dot: 'bg-text-subtle' },
  friendly: { label: 'Friendly', dot: 'bg-status-success' },
  unknown: { label: 'Unknown', dot: 'bg-text-subtle' },
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

export const meta = (type) => TYPES[type] || { label: type, icon: CircleHelp, medallion: 'bg-entity-concept/15 text-entity-concept border-entity-concept/30', ring: 'border-entity-concept/25', soft: 'text-entity-concept', dot: 'bg-entity-concept', wash: 'from-entity-concept/12' };
export const fieldLabel = (field) => FIELD_LABELS[field] || field;
