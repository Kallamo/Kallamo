import { useCallback, useEffect, useId, useRef, useState } from 'react';
import {
  Backpack, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, Clapperboard, Gamepad2, HandHelping, Image as ImageIcon, Loader2, MapPin,
  MoreHorizontal, PanelRightOpen, Pencil, Search, Swords, Trash2, X
} from 'lucide-react';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from '../../components/ui/Menu';
import Popover from '../../components/ui/Popover';
import { itemFamily, itemMeta, meta } from '../worldbuild/worldbuildConfig';
import { formatWorldDate } from '../worldbuild/WorldDateInput';
import { DAYLIGHT, daylightPhase } from './daylight';
import Tooltip from '../../components/ui/Tooltip';

export const PRESENCE = {
  participating: { label: 'Participating', icon: Swords, hint: 'Acts and speaks in the scene.' },
  nearby: { label: 'Nearby', icon: MapPin, hint: 'Close enough to notice, not in it.' }
};

const COLLAPSED_ACTOR_LIMIT = 4;
const INVENTORY_FILTER_FROM = 8;

const clockText = clock => `${String(clock?.hour ?? 0).padStart(2, '0')}:${String(clock?.minute ?? 0).padStart(2, '0')}`;

export function shortDate(calendar, clock) {
  if (!clock) return '';
  const month = calendar?.months?.[(clock.month || 1) - 1]?.name || '';
  return `${clock.day ?? ''} ${month.slice(0, 3)}`.trim();
}

export function RoleplayStatus({ processing, pendingCount }) {
  if (processing) {
    return (
      <span aria-hidden="true" className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-accent">
        <span className="inline-flex animate-spin motion-reduce:animate-none"><Loader2 className="h-4 w-4" /></span>
      </span>
    );
  }
  if (pendingCount > 0) {
    return (
      <span aria-hidden="true" className="inline-flex min-h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[0.6875rem] font-bold leading-none text-on-accent">
        {pendingCount > 99 ? '99+' : pendingCount}
      </span>
    );
  }
  /* Live state. Goes static as soon as there is something to review, so the
     motion always means "running", never "needs attention". */
  return (
    <span aria-hidden="true" className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center">
      <span className="absolute h-2 w-2 animate-live-halo rounded-full bg-accent motion-reduce:animate-none" />
      <span className="relative h-2 w-2 animate-live-core rounded-full bg-accent motion-reduce:animate-none" />
    </span>
  );
}

/* A span so it stays valid phrasing content inside buttons. */
export function Avatar({ entity, player = false, size = 'md' }) {
  const image = entity?.data?.image || entity?.data?.imagePath || entity?.data?.avatar;
  const tone = player ? 'border-accent/55 bg-surface-canvas text-accent' : meta(entity?.type).medallion;
  const sizes = { sm: 'h-8 w-8 rounded-[0.5625rem] text-xs', md: 'h-9 w-9 rounded-control text-sm', lg: 'h-10 w-10 rounded-card text-[0.9375rem]' };
  return (
    <span
      className={`inline-flex shrink-0 items-center justify-center overflow-hidden border font-bold uppercase ${sizes[size]} ${tone}`}
      style={image ? { backgroundImage: `url("app-file:///${String(image).replace(/\\/g, '/')}")`, backgroundPosition: 'center', backgroundSize: 'cover' } : undefined}
    >
      {!image && (entity?.canonicalName?.[0] || '?')}
    </span>
  );
}

/** The collapsed panel: a slim rail that keeps the scene in view beside the chat. */
export function RoleplayRail({ statusLabel, processing, pendingCount, calendar, clock, player, others, presenceOf, typeLabels, locationName, locationType, inventoryCount, onOpen }) {
  const visible = others.slice(0, COLLAPSED_ACTOR_LIMIT);
  const hidden = others.slice(COLLAPSED_ACTOR_LIMIT);
  const railButton = 'inline-flex items-center justify-center rounded-control transition-colors hover:bg-surface-hover/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';
  const separator = <span aria-hidden="true" className="my-1.5 h-px w-7 bg-border-subtle" />;
  const phase = DAYLIGHT[daylightPhase(clock?.hour)];
  const PhaseIcon = phase.icon;
  const actorTip = (entity, state) => (
    <span className="flex items-center gap-2.5">
      <Avatar entity={entity} player={state === 'playing'} size="sm" />
      <span className="min-w-0">
        <span className="block truncate text-[0.8125rem] font-semibold text-text-primary">{entity.canonicalName}</span>
        <span className="flex items-center gap-1.5">
          <span className={meta(entity.type).soft}>{typeLabels?.get(entity.type) || meta(entity.type).label}</span>
          <span aria-hidden="true" className="text-text-disabled">·</span>
          <span className={state === 'playing' ? 'text-accent' : 'text-text-muted'}>{state === 'playing' ? 'Playing' : PRESENCE[state]?.label}</span>
        </span>
      </span>
    </span>
  );
  return (
    <aside aria-label="Roleplay" className="glass-rail glass-dense relative z-20 flex h-full w-16 shrink-0 flex-col items-center gap-1 border-l border-border-subtle py-3">
      <Tooltip side="left" content="Open roleplay panel">
        <button type="button" onClick={() => onOpen()} aria-label="Open roleplay panel" className={`${railButton} h-10 w-10 text-text-muted hover:text-text-primary`}>
          <PanelRightOpen aria-hidden="true" className="h-[1.125rem] w-[1.125rem]" />
        </button>
      </Tooltip>
      <Tooltip side="left" content={<span className="font-medium text-text-primary">Roleplay · {statusLabel}</span>}>
        <span tabIndex={0} className="flex h-6 items-center rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          <RoleplayStatus processing={processing} pendingCount={pendingCount} /><span className="sr-only">{statusLabel}</span>
        </span>
      </Tooltip>
      {separator}
      <Tooltip
        side="left"
        content={(
          <span className="flex items-start gap-2.5">
            <span className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${phase.tile}`}><PhaseIcon aria-hidden="true" className="h-4 w-4" /></span>
            <span className="min-w-0">
              <span className="flex items-baseline gap-2">
                <span className="font-mono text-base font-semibold text-text-primary">{clockText(clock)}</span>
                {clock?.weekdayName && <span className={`font-medium ${phase.text}`}>{clock.weekdayName}</span>}
              </span>
              <span className="mt-0.5 block text-text-secondary">{formatWorldDate(calendar, clock)}</span>
              <span className="mt-0.5 block text-text-muted">{[phase.label, clock?.season?.name].filter(Boolean).join(' · ')}</span>
            </span>
          </span>
        )}
      >
        <button
          type="button"
          onClick={() => onOpen('clock')}
          aria-label={`${formatWorldDate(calendar, clock)}, ${clockText(clock)}. Edit date and time`}
          className={`${railButton} w-[3.25rem] flex-col gap-0.5 py-1.5`}
        >
          <span className="font-mono text-[0.8125rem] font-semibold text-text-primary">{clockText(clock)}</span>
          <span className="text-[0.6875rem] text-text-muted">{shortDate(calendar, clock)}</span>
        </button>
      </Tooltip>
      {separator}
      <div className="flex flex-col items-center gap-1.5">
        {player && (
          <Tooltip side="left" content={actorTip(player, 'playing')}>
            <button type="button" onClick={() => onOpen('scene')} aria-label={`${player.canonicalName}, playing`} className={`${railButton} p-0.5`}>
              <Avatar entity={player} player size="sm" />
            </button>
          </Tooltip>
        )}
        {visible.map(entity => (
          <Tooltip key={entity.id} side="left" content={actorTip(entity, presenceOf(entity.id))}>
            <button type="button" onClick={() => onOpen('scene')} aria-label={`${entity.canonicalName}, ${PRESENCE[presenceOf(entity.id)]?.label}`} className={`${railButton} p-0.5`}>
              <Avatar entity={entity} size="sm" />
            </button>
          </Tooltip>
        ))}
        {hidden.length > 0 && (
          <Tooltip side="left" content={<span className="block space-y-0.5">{hidden.map(entity => <span key={entity.id} className="block text-text-secondary">{entity.canonicalName}</span>)}</span>}>
            <button type="button" onClick={() => onOpen('scene')} aria-label={`${hidden.length} more in scene`} className={`${railButton} h-9 w-9 border border-border-default text-xs font-semibold text-text-secondary`}>
              +{hidden.length}
            </button>
          </Tooltip>
        )}
      </div>
      {separator}
      <Tooltip
        side="left"
        content={(
          <span className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-entity-location/40 bg-entity-location/15 text-entity-location"><MapPin aria-hidden="true" className="h-4 w-4" /></span>
            <span className="min-w-0">
              <span className="block truncate text-[0.8125rem] font-semibold text-text-primary">{locationName || 'No current location'}</span>
              <span className="text-entity-location">{locationType || 'Location'}</span>
            </span>
          </span>
        )}
      >
        <button type="button" onClick={() => onOpen('scene')} aria-label={`Location: ${locationName || 'none'}`} className={`${railButton} h-10 w-10 text-entity-location`}>
          <MapPin aria-hidden="true" className="h-[1.125rem] w-[1.125rem]" />
        </button>
      </Tooltip>
      <span className="flex-1" />
      <Tooltip side="left" content={<span><span className="font-semibold text-text-primary">Inventory</span> · {inventoryCount} {inventoryCount === 1 ? 'item' : 'items'}</span>}>
        <button type="button" onClick={() => onOpen('inventory')} aria-label={`Inventory, ${inventoryCount} items`} className={`${railButton} relative h-10 w-10 text-text-muted hover:text-text-primary`}>
          <Backpack aria-hidden="true" className="h-[1.125rem] w-[1.125rem]" />
          {inventoryCount > 0 && <span className="absolute right-0 top-0.5 flex h-4 min-w-[1.125rem] items-center justify-center rounded-full bg-surface-hover px-1 text-[0.625rem] font-semibold text-text-secondary">{inventoryCount}</span>}
        </button>
      </Tooltip>
    </aside>
  );
}

export function PanelClock({ calendar, clock, onEdit }) {
  const phase = DAYLIGHT[daylightPhase(clock?.hour)];
  const PhaseIcon = phase.icon;
  return (
    <button
      type="button"
      onClick={onEdit}
      aria-label={`${formatWorldDate(calendar, clock)}, ${clockText(clock)}. Edit date and time`}
      className={`group/clock flex w-full items-center gap-3.5 border-b border-border-subtle bg-gradient-to-br ${phase.band} to-transparent px-4 py-4 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40`}
    >
      <span className={`flex h-[2.625rem] w-[2.625rem] shrink-0 items-center justify-center rounded-card border ${phase.tile}`}>
        <PhaseIcon aria-hidden="true" className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-2.5">
          <span className="font-mono text-[1.625rem] font-semibold leading-none tracking-tight text-text-primary tabular-nums">{clockText(clock)}</span>
          {clock?.weekdayName && <span className={`truncate text-[0.8125rem] font-medium ${phase.text}`}>{clock.weekdayName}</span>}
        </span>
        <span className="mt-1.5 flex min-w-0 items-center gap-1.5 truncate text-[0.8125rem] text-text-secondary">
          <CalendarDays aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-status-info" />
          {formatWorldDate(calendar, clock)}
        </span>
      </span>
      <Pencil aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-text-subtle transition-colors group-hover/clock:text-accent" />
    </button>
  );
}

export function PanelTabs({ tab, onChange, inventoryCount }) {
  const tabs = [
    ['scene', 'Scene', Clapperboard],
    ['inventory', 'Inventory', Backpack]
  ];
  return (
    <div className="px-3 pb-1 pt-3">
      <div role="tablist" aria-label="Roleplay panel" className="flex gap-0.5 rounded-card border border-white/[0.06] bg-black/25 p-[3px]">
        {tabs.map(([id, label, Icon]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => onChange(id)}
            className={`flex h-[2.125rem] flex-1 items-center justify-center gap-2 rounded-lg text-[0.8125rem] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${tab === id ? 'bg-accent/12 text-accent' : 'text-text-muted hover:text-text-secondary'}`}
          >
            <Icon aria-hidden="true" className="h-4 w-4" />
            {label}
            {id === 'inventory' && inventoryCount > 0 && <span className="rounded-full bg-white/[0.08] px-1.5 text-[0.6875rem] font-semibold text-text-secondary tabular-nums">{inventoryCount}</span>}
          </button>
        ))}
      </div>
    </div>
  );
}

export function SectionHead({ title, children }) {
  return (
    <div className="mb-2 flex min-h-7 items-center justify-between gap-2 px-1">
      <h3 className="eyebrow">{title}</h3>
      {children}
    </div>
  );
}

function LocationPicker({ anchorRef, open, onClose, options, currentId, onSelect }) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const listId = useId();
  const needle = query.trim().toLocaleLowerCase();
  const filtered = needle
    ? options.filter(option => [option.label, option.group, ...(option.aliases || [])].some(text => String(text || '').toLocaleLowerCase().includes(needle)))
    : options;
  const close = () => {
    setQuery('');
    setActiveIndex(0);
    onClose();
  };
  const choose = id => {
    onSelect(id);
    close();
  };
  const onKeyDown = event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!filtered.length) return;
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex(index => (index + step + filtered.length) % filtered.length);
    } else if (event.key === 'Enter' && filtered[activeIndex]) {
      event.preventDefault();
      choose(filtered[activeIndex].id);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      close();
    }
  };
  return (
    <Popover anchorRef={anchorRef} open={open} onClose={close} maxHeight={360} scroll={false} className="!p-0 overflow-hidden border-border-default bg-surface-panel-muted shadow-overlay">
      <div className="flex items-center gap-2 border-b border-border-subtle px-3">
        <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-text-subtle" />
        <input
          autoFocus
          value={query}
          onChange={event => { setQuery(event.target.value); setActiveIndex(0); }}
          onKeyDown={onKeyDown}
          placeholder="Search locations"
          role="combobox"
          aria-label="Search locations"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={filtered[activeIndex] ? `${listId}-${filtered[activeIndex].id}` : undefined}
          className="h-11 min-w-0 flex-1 bg-transparent text-sm text-text-primary outline-none placeholder:text-text-subtle"
        />
      </div>
      <div id={listId} role="listbox" aria-label="Locations" className="max-h-72 overflow-y-auto overscroll-contain p-1.5 custom-scrollbar">
        {filtered.map((option, index) => {
          const Icon = option.icon || MapPin;
          const selected = option.id === currentId;
          return (
            <button
              key={option.id}
              id={`${listId}-${option.id}`}
              type="button"
              role="option"
              aria-selected={selected}
              onMouseEnter={() => setActiveIndex(index)}
              onClick={() => choose(option.id)}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors ${index === activeIndex ? 'bg-surface-hover/70' : ''}`}
            >
              <Icon aria-hidden="true" className={`h-4 w-4 shrink-0 ${selected ? 'text-entity-location' : 'text-text-muted'}`} />
              <span className={`min-w-0 flex-1 truncate text-sm ${selected ? 'font-semibold text-text-primary' : 'text-text-secondary'}`}>{option.label}</span>
              <span className="shrink-0 text-xs text-text-subtle">{option.group}</span>
              {selected && <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-entity-location" />}
            </button>
          );
        })}
        {!filtered.length && <p className="px-3 py-5 text-center text-sm text-text-subtle">No matching locations.</p>}
      </div>
    </Popover>
  );
}

/** The current location as the scene's hero: its background, its name, and the way to change either. */
export function LocationHero({ locationId, locationName, locationOptions, onChangeLocation, background, onChooseBackground, onRemoveBackground, inheritedFrom }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);
  const menuRef = useRef(null);
  const heroRef = useRef(null);
  const imageUrl = background?.imagePath ? `app-file:///${background.imagePath.replace(/\\/g, '/')}` : null;
  return (
    <div ref={heroRef} className={`relative overflow-hidden rounded-card border border-entity-location/30 ${imageUrl ? 'h-[9.5rem]' : 'h-[6.5rem] bg-gradient-to-br from-entity-location/12 to-transparent'}`}>
      {imageUrl && <img src={imageUrl} alt="" className="absolute inset-0 h-full w-full object-cover" />}
      {imageUrl && <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-b from-transparent from-30% to-surface-sidebar/95" />}
      <button
        ref={menuRef}
        type="button"
        aria-label="Location background"
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        disabled={!locationId}
        onClick={() => setMenuOpen(value => !value)}
        className="absolute right-2 top-2 inline-flex h-[1.875rem] w-[1.875rem] items-center justify-center rounded-lg border border-white/20 bg-surface-canvas/55 text-text-primary backdrop-blur-md transition-colors hover:bg-surface-canvas/75 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:opacity-40"
      >
        <ImageIcon aria-hidden="true" className="h-4 w-4" />
      </button>
      <Menu anchorRef={menuRef} open={menuOpen} onClose={() => setMenuOpen(false)} label="Location background" className="w-60">
        <MenuItem icon={ImageIcon} label={imageUrl ? 'Change background' : 'Choose background'} description={inheritedFrom ? `Now inherited from ${inheritedFrom}.` : undefined} onSelect={() => { setMenuOpen(false); onChooseBackground(); }} />
        {imageUrl && !inheritedFrom && (
          <>
            <MenuSeparator />
            <MenuItem icon={Trash2} label="Remove background" danger onSelect={() => { setMenuOpen(false); onRemoveBackground(); }} />
          </>
        )}
      </Menu>
      <button
        type="button"
        aria-haspopup="listbox"
        aria-expanded={pickerOpen}
        onClick={() => setPickerOpen(value => !value)}
        className="group/place absolute inset-x-2.5 bottom-2.5 flex items-center gap-2.5 rounded-lg text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.5625rem] border border-entity-location/40 bg-entity-location/18 text-entity-location backdrop-blur-sm">
          <MapPin aria-hidden="true" className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.9375rem] font-semibold text-white">{locationName || 'Choose a location'}</span>
          <span className="block truncate text-xs text-entity-location">{inheritedFrom ? `Background from ${inheritedFrom}` : 'Current location'}</span>
        </span>
        <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-white/15 bg-surface-canvas/55 text-text-primary backdrop-blur-md transition-colors group-hover/place:bg-surface-canvas/80">
          <ChevronDown aria-hidden="true" className={`h-4 w-4 transition-transform ${pickerOpen ? 'rotate-180' : ''}`} />
        </span>
      </button>
      <LocationPicker
        anchorRef={heroRef}
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        options={locationOptions}
        currentId={locationId}
        onSelect={onChangeLocation}
      />
    </div>
  );
}

export function PlayerCard({ entity, typeLabel }) {
  return (
    <div className="flex items-center gap-3 rounded-card border border-accent/30 bg-gradient-to-br from-accent/12 to-accent/[0.03] p-2.5">
      <Avatar entity={entity} player size="lg" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.9375rem] font-semibold text-text-primary">{entity.canonicalName}</span>
        <span className="flex items-center gap-1.5 text-xs">
          <span className={`font-medium ${meta(entity.type).soft}`}>{typeLabel || meta(entity.type).label}</span>
          <span aria-hidden="true" className="text-text-disabled">·</span>
          <span className="inline-flex items-center gap-1 text-accent/90"><Gamepad2 aria-hidden="true" className="h-3.5 w-3.5" />You play them</span>
        </span>
      </span>
    </div>
  );
}

export function CastRow({ entity, typeLabel, presence, onPlay, onPresence, onRemove }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const typeMeta = meta(entity.type);
  const presenceMeta = PRESENCE[presence] || PRESENCE.participating;
  const PresenceIcon = presenceMeta.icon;
  const choose = action => () => {
    setOpen(false);
    action();
  };
  return (
    <div className={`group/cast flex items-center gap-2.5 rounded-card px-2 py-1.5 transition-colors ${open ? 'bg-white/[0.05]' : 'hover:bg-white/[0.03]'}`}>
      <Avatar entity={entity} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-text-primary">{entity.canonicalName}</span>
        <span className="flex items-center gap-1.5 text-xs">
          <span className={`font-medium ${typeMeta.soft}`}>{typeLabel || typeMeta.label}</span>
          <span aria-hidden="true" className="text-text-disabled">·</span>
          <span className="inline-flex items-center gap-1 text-text-muted"><PresenceIcon aria-hidden="true" className="h-3 w-3" />{presenceMeta.label}</span>
        </span>
      </span>
      <button
        ref={anchorRef}
        type="button"
        aria-label={`Actions for ${entity.canonicalName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-[color,background-color,opacity] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${open ? 'bg-white/[0.08] text-text-primary opacity-100' : 'text-text-subtle opacity-0 hover:text-text-primary group-hover/cast:opacity-100 group-focus-within/cast:opacity-100'}`}
      >
        <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
      </button>
      <Menu anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} label={`Actions for ${entity.canonicalName}`} className="w-64">
        <MenuItem icon={Gamepad2} iconClassName="text-accent" label={`Play as ${entity.canonicalName}`} onSelect={choose(onPlay)} />
        <MenuSeparator />
        <MenuLabel>Presence</MenuLabel>
        {Object.entries(PRESENCE).map(([key, value]) => (
          <MenuItem key={key} icon={value.icon} label={value.label} description={value.hint} checked={presence === key} onSelect={choose(() => onPresence(key))} />
        ))}
        <MenuSeparator />
        <MenuItem icon={X} label="Remove from scene" danger onSelect={choose(onRemove)} />
      </Menu>
    </div>
  );
}

export function CastGroup({ presence, count, children }) {
  const { icon: Icon, label } = PRESENCE[presence];
  return (
    <div className="mt-3">
      <p className="mb-0.5 flex items-center gap-2 px-1 text-xs text-text-muted">
        <Icon aria-hidden="true" className="h-3.5 w-3.5" />{label}<span className="text-text-disabled tabular-nums">{count}</span>
      </p>
      {children}
    </div>
  );
}

function ItemTile({ item, large = false }) {
  const ItemIcon = itemMeta(item.data?.itemType).icon;
  return (
    <span className={`flex shrink-0 items-center justify-center border ${itemFamily(item.data?.itemType).tile} ${large ? 'h-11 w-11 rounded-card' : 'h-[2.125rem] w-[2.125rem] rounded-[0.5625rem]'}`}>
      <ItemIcon aria-hidden="true" className={large ? 'h-[1.375rem] w-[1.375rem]' : 'h-4 w-4'} />
    </span>
  );
}

function ItemMenu({ item, anchorRef, open, onClose, onToggle, onTransfer }) {
  const choose = action => () => {
    onClose();
    action();
  };
  return (
    <Menu anchorRef={anchorRef} open={open} onClose={onClose} label={`Actions for ${item.name}`} className="w-56">
      <MenuItem icon={Swords} label={item.equipped ? 'Unequip' : 'Equip'} onSelect={choose(() => onToggle(item))} />
      <MenuItem icon={MapPin} label="Drop or move" onSelect={choose(() => onTransfer({ itemId: item.itemId, mode: 'location', targetId: '', quantity: 1 }))} />
      <MenuItem icon={HandHelping} label="Give to character" onSelect={choose(() => onTransfer({ itemId: item.itemId, mode: 'character', targetId: '', quantity: 1 }))} />
    </Menu>
  );
}

function EquippedSlot({ item, onToggle, onTransfer }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const family = itemFamily(item.data?.itemType);
  return (
    <div className={`group/slot relative flex w-[7.25rem] shrink-0 snap-start flex-col items-start gap-2 rounded-card border bg-gradient-to-b ${family.wash} to-transparent p-2.5 transition-colors ${open ? 'bg-white/[0.04]' : 'hover:bg-white/[0.03]'}`}>
      <ItemTile item={item} large />
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        className="min-w-0 text-left focus-visible:outline-none after:absolute after:inset-0 after:rounded-card focus-visible:after:ring-2 focus-visible:after:ring-accent/40"
      >
        <span className="line-clamp-2 text-[0.8125rem] font-semibold leading-snug text-text-primary">{item.name}</span>
      </button>
      <span className={`-mt-1 text-[0.6875rem] ${family.soft}`}>{itemMeta(item.data?.itemType).label}</span>
      <button
        ref={anchorRef}
        type="button"
        aria-label={`Actions for ${item.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className={`absolute right-1.5 top-1.5 z-10 inline-flex h-7 w-7 items-center justify-center rounded-lg transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${open ? 'bg-white/[0.1] text-text-primary' : 'text-text-muted hover:bg-white/[0.08] hover:text-text-primary'}`}
      >
        <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
      </button>
      <ItemMenu item={item} anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} onToggle={onToggle} onTransfer={onTransfer} />
    </div>
  );
}

// One row that scrolls sideways, so a long loadout never pushes the carried list down.
function EquippedCarousel({ items, onToggle, onTransfer }) {
  const trackRef = useRef(null);
  const [edges, setEdges] = useState({ start: true, end: true });
  const measure = useCallback(() => {
    const track = trackRef.current;
    if (!track) return;
    setEdges({ start: track.scrollLeft <= 2, end: track.scrollLeft + track.clientWidth >= track.scrollWidth - 2 });
  }, []);
  useEffect(() => {
    measure();
    const track = trackRef.current;
    if (!track || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(track);
    return () => observer.disconnect();
  }, [measure, items.length]);
  const page = direction => trackRef.current?.scrollBy({ left: direction * trackRef.current.clientWidth * 0.8, behavior: 'smooth' });
  const arrow = 'absolute top-1/2 z-20 inline-flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full border border-border-default bg-surface-panel text-text-primary shadow-panel transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';
  return (
    <div className="relative">
      <div
        ref={trackRef}
        onScroll={measure}
        className="flex snap-x snap-mandatory gap-2 overflow-x-auto scroll-smooth pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {items.map(item => <EquippedSlot key={item.itemId} item={item} onToggle={onToggle} onTransfer={onTransfer} />)}
      </div>
      {!edges.start && (
        <>
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-0 w-8 bg-gradient-to-r from-surface-sidebar to-transparent" />
          <button type="button" aria-label="Previous equipped items" onClick={() => page(-1)} className={`${arrow} -left-1`}><ChevronLeft aria-hidden="true" className="h-4 w-4" /></button>
        </>
      )}
      {!edges.end && (
        <>
          <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-8 bg-gradient-to-l from-surface-sidebar to-transparent" />
          <button type="button" aria-label="More equipped items" onClick={() => page(1)} className={`${arrow} -right-1`}><ChevronRight aria-hidden="true" className="h-4 w-4" /></button>
        </>
      )}
    </div>
  );
}

function CarriedRow({ item, onToggle, onTransfer }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  const family = itemFamily(item.data?.itemType);
  return (
    <div className={`group/item flex items-center gap-3 rounded-lg px-2 py-1.5 transition-colors ${open ? 'bg-white/[0.05]' : 'hover:bg-white/[0.03]'}`}>
      <ItemTile item={item} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-text-primary">{item.name}</span>
        <span className={`block text-xs ${family.soft}`}>{itemMeta(item.data?.itemType).label}</span>
      </span>
      {item.nature !== 'unique' && <span className="rounded-md bg-white/[0.07] px-1.5 text-xs font-semibold text-text-secondary tabular-nums">×{item.quantity}</span>}
      <button
        ref={anchorRef}
        type="button"
        aria-label={`Actions for ${item.name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className={`inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg transition-[color,background-color,opacity] focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${open ? 'bg-white/[0.08] text-text-primary opacity-100' : 'text-text-subtle opacity-0 hover:text-text-primary group-hover/item:opacity-100 group-focus-within/item:opacity-100'}`}
      >
        <MoreHorizontal aria-hidden="true" className="h-4 w-4" />
      </button>
      <ItemMenu item={item} anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} onToggle={onToggle} onTransfer={onTransfer} />
    </div>
  );
}

export function InventoryTab({ player, inventory, onToggle, onTransfer }) {
  const [query, setQuery] = useState('');
  const equipped = inventory.filter(item => item.equipped);
  const carried = inventory.filter(item => !item.equipped);
  const needle = query.trim().toLocaleLowerCase();
  const visibleCarried = needle
    ? carried.filter(item => [item.name, itemMeta(item.data?.itemType).label].some(text => String(text || '').toLocaleLowerCase().includes(needle)))
    : carried;
  const totalCount = inventory.reduce((sum, item) => sum + (item.nature === 'unique' ? 1 : Number(item.quantity) || 1), 0);
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2.5 rounded-card border border-accent/30 bg-gradient-to-br from-accent/12 to-accent/[0.03] p-2.5">
        <Avatar entity={player} player />
        <span className="min-w-0">
          <span className="block truncate text-sm font-semibold text-text-primary">{player?.canonicalName || 'No controlled character'}</span>
          <span className="block text-xs text-accent/90">{player ? `Carrying ${totalCount} ${totalCount === 1 ? 'item' : 'items'}` : 'Choose one in Roleplay settings.'}</span>
        </span>
      </div>
      <section>
        <SectionHead title="Equipped"><span className="text-xs text-text-subtle tabular-nums">{equipped.length}</span></SectionHead>
        {equipped.length
          ? <EquippedCarousel items={equipped} onToggle={onToggle} onTransfer={onTransfer} />
          : <p className="rounded-card border border-dashed border-border-subtle px-3 py-4 text-center text-xs text-text-disabled">Nothing is equipped.</p>}
      </section>
      <section>
        <SectionHead title="Carried"><span className="text-xs text-text-subtle tabular-nums">{carried.length}</span></SectionHead>
        {carried.length >= INVENTORY_FILTER_FROM && (
          <label className="mb-1.5 flex h-9 items-center gap-2 rounded-control border border-border-subtle bg-surface-input/50 px-3 text-text-subtle focus-within:border-accent/50">
            <Search aria-hidden="true" className="h-4 w-4 shrink-0" />
            <span className="sr-only">Filter items</span>
            <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Filter items" className="h-full min-w-0 flex-1 bg-transparent text-[0.8125rem] text-text-primary outline-none placeholder:text-text-subtle" />
          </label>
        )}
        <div>
          {visibleCarried.map(item => <CarriedRow key={item.itemId} item={item} onToggle={onToggle} onTransfer={onTransfer} />)}
          {!carried.length && <p className="rounded-card border border-dashed border-border-subtle px-3 py-4 text-center text-xs text-text-disabled">This character carries nothing else.</p>}
          {carried.length > 0 && !visibleCarried.length && <p className="px-3 py-4 text-center text-xs text-text-disabled">No items match.</p>}
        </div>
      </section>
    </div>
  );
}
