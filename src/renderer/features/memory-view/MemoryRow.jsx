import React, { useRef, useState } from 'react';
import { ChevronRight, MoreHorizontal } from 'lucide-react';
import Checkbox from '../../components/ui/Checkbox';
import IconButton from '../../components/ui/IconButton';
import ItemTile from '../../components/ui/ItemTile';
import ProfileScopeButton from '../../components/ui/ProfileScopeButton';
import TagChip from '../../components/ui/TagChip';
import Toggle from '../../components/ui/Toggle';
import { Menu, MenuItem, MenuSeparator } from '../../components/ui/Menu';

const MAX_ROW_TAGS = 2;

/**
 * One memory in the list. The row opens the item; switch, profiles and the action
 * menu sit on the right. Summaries pass no controls and get a chevron instead.
 */
export default function MemoryRow({
  icon,
  tone,
  title,
  meta,
  preview,
  tokens,
  tags = [],
  enabled = true,
  onOpen,
  onToggleEnabled,
  selectable = false,
  selected = false,
  selectionActive = false,
  onToggleSelect,
  profiles,
  profileIds,
  onToggleProfile,
  menuItems,
}) {
  const menuAnchorRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const shownTags = tags.slice(0, MAX_ROW_TAGS);
  const hiddenTags = tags.length - shownTags.length;
  const hasControls = Boolean(onToggleEnabled || menuItems);

  return (
    <div className={`group relative flex items-center gap-3 border-t border-border-subtle px-4 py-2.5 transition-colors ${selected ? 'bg-accent/5' : 'hover:bg-tint/[0.02]'}`}>
      {selectable && (
        <span className={`flex shrink-0 transition-opacity ${selected || selectionActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}>
          <Checkbox size="sm" checked={selected} onChange={() => onToggleSelect?.()} ariaLabel={`Select ${title}`} />
        </span>
      )}
      <button
        type="button"
        onClick={onOpen}
        className="flex min-w-0 flex-1 items-center gap-3 rounded-lg text-left cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <span className={`flex min-w-0 flex-1 items-center gap-3 transition-opacity ${enabled ? '' : 'opacity-50'}`}>
          <ItemTile icon={icon} tone={tone} />
          <span className="flex min-w-0 flex-1 flex-col gap-0.5">
            <span className="truncate text-sm font-semibold text-text-primary">{title}</span>
            <span className="flex min-w-0 items-center gap-1.5 text-xs text-text-muted">
              <span className="shrink-0">{meta}</span>
              {shownTags.map(tag => <TagChip key={`${tag.variant}_${tag.label}`} label={tag.label} variant={tag.variant} icon={tag.icon} size="sm" />)}
              {hiddenTags > 0 && <TagChip label={`+${hiddenTags}`} size="sm" />}
            </span>
            {preview && <span className="truncate text-xs text-text-subtle">{preview}</span>}
          </span>
          {tokens && <span className="min-w-[2.75rem] shrink-0 text-right text-sm font-medium text-text-muted tabular-nums">{tokens}</span>}
        </span>
        {!hasControls && <ChevronRight className="mx-1 h-4 w-4 shrink-0 text-text-subtle" aria-hidden="true" />}
      </button>
      {profiles && <ProfileScopeButton profiles={profiles} selectedIds={profileIds} onToggle={onToggleProfile} />}
      {onToggleEnabled && <Toggle checked={enabled} onChange={onToggleEnabled} />}
      {menuItems && (
        <>
          <IconButton
            ref={menuAnchorRef}
            icon={MoreHorizontal}
            label="More actions"
            size="sm"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen(value => !value)}
            className={menuOpen ? 'bg-surface-hover text-text-primary' : ''}
          />
          <Menu anchorRef={menuAnchorRef} open={menuOpen} onClose={() => setMenuOpen(false)} label={`${title} actions`}>
            {menuItems.map((item, index) => item === 'separator'
              ? <MenuSeparator key={`separator-${index}`} />
              : <MenuItem key={item.label} {...item} onSelect={() => { setMenuOpen(false); item.onSelect?.(); }} />)}
          </Menu>
        </>
      )}
    </div>
  );
}
