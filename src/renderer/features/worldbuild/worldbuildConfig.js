import { BookOpen, CalendarClock, Flag, Ghost, Globe, MapPin, Package, User, Users } from 'lucide-react';

export const TYPES = {
  System: { label: 'System / Concept', icon: BookOpen, medallion: 'bg-slate-400/15 text-slate-200 border-slate-400/30', ring: 'border-slate-400/30', soft: 'text-slate-300' },
  Locations: { label: 'Location', icon: MapPin, medallion: 'bg-emerald-400/15 text-emerald-200 border-emerald-400/30', ring: 'border-emerald-400/25', soft: 'text-emerald-300' },
  Items: { label: 'Item', icon: Package, medallion: 'bg-amber-400/15 text-amber-200 border-amber-400/30', ring: 'border-amber-400/25', soft: 'text-amber-300' },
  Races: { label: 'Race', icon: Users, medallion: 'bg-sky-400/15 text-sky-200 border-sky-400/30', ring: 'border-sky-400/25', soft: 'text-sky-300' },
  Factions: { label: 'Faction', icon: Flag, medallion: 'bg-rose-400/15 text-rose-200 border-rose-400/30', ring: 'border-rose-400/25', soft: 'text-rose-300' },
  Characters: { label: 'Character', icon: User, medallion: 'bg-accent/15 text-accent border-accent/30', ring: 'border-accent/25', soft: 'text-accent' },
  Creatures: { label: 'Creature / Entity', icon: Ghost, medallion: 'bg-violet-400/15 text-violet-200 border-violet-400/30', ring: 'border-violet-400/25', soft: 'text-violet-300' },
  Events: { label: 'Event', icon: CalendarClock, medallion: 'bg-orange-400/15 text-orange-200 border-orange-400/30', ring: 'border-orange-400/25', soft: 'text-orange-300' },
};

export const TYPE_ORDER = ['Characters', 'Locations', 'Factions', 'Items', 'Races', 'Creatures', 'Events', 'System'];
export const ITEM_TYPES = ['Weapon', 'Armor', 'Artifact', 'Resource'];
export const RARITY = ['Unique', 'Rare', 'Uncommon', 'Common', 'Abundant'];
export const THREAT = ['Harmless', 'Minor', 'Dangerous', 'Deadly', 'Legendary'];
export const STATUS = {
  alive: { label: 'Alive', cls: 'bg-emerald-400/15 text-emerald-200 border-emerald-400/30' },
  deceased: { label: 'Deceased', cls: 'bg-rose-400/15 text-rose-200 border-rose-400/30' },
  missing: { label: 'Missing', cls: 'bg-amber-400/15 text-amber-200 border-amber-400/30' },
  unknown: { label: 'Unknown', cls: 'bg-slate-400/15 text-slate-300 border-slate-400/30' },
};
export const DISPOSITION = {
  hostile: { label: 'Hostile', cls: 'bg-rose-400/15 text-rose-200 border-rose-400/30' },
  neutral: { label: 'Neutral', cls: 'bg-slate-400/15 text-slate-300 border-slate-400/30' },
  friendly: { label: 'Friendly', cls: 'bg-emerald-400/15 text-emerald-200 border-emerald-400/30' },
  unknown: { label: 'Unknown', cls: 'bg-slate-400/15 text-slate-300 border-slate-400/30' },
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
  status: 'Status', age: 'Age', role: 'Role', abilities: 'Abilities',
  disposition: 'Disposition', nature: 'Nature', abundance: 'Abundance', threat: 'Threat',
  description: 'Description', locationType: 'Type', itemType: 'Type', content: 'Content',
};

export const meta = (type) => TYPES[type] || { label: type, icon: Globe, medallion: 'bg-white/10 text-gray-300 border-white/20', ring: 'border-white/15', soft: 'text-gray-300' };
export const fieldLabel = (field) => FIELD_LABELS[field] || field;
