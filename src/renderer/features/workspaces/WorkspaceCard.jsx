import React, { useRef, useState } from 'react';
import { Clock, MapPin, MoreHorizontal, Pencil, Pin, PinOff, Plus, Trash2 } from 'lucide-react';
import { Menu, MenuItem, MenuSeparator } from '../../components/ui/Menu';
import ContourCover from './ContourCover';
import ProfileAvatars from './ProfileAvatars';
import RoleplayChip from './RoleplayChip';
import { leadImage, plural, timeAgo } from './workspaceFormat';

export default function WorkspaceCard({ chat, profiles, onOpen, onTogglePin, onEdit, onDelete }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuAnchorRef = useRef(null);
  // A picture that fails to load steps down: the scene's place, then the cover, then none.
  const [failed, setFailed] = useState(0);
  const sceneImage = chat.experienceMode === 'roleplay' && Boolean(chat.roleplayScene?.background?.path);
  const image = failed >= 2 ? null : leadImage(chat, { skipScene: failed >= 1 });
  const stepDown = () => setFailed(level => (level === 0 && !sceneImage ? 2 : level + 1));
  const messages = chat.messageCount ? plural(chat.messageCount, 'message') : 'No messages yet';
  const pinned = chat.isPinned === 1;
  const roleplay = chat.experienceMode === 'roleplay';
  const scene = roleplay ? chat.roleplayScene : null;
  const hasScene = Boolean(scene && (scene.locationName || scene.time));

  return (
    <div className="group relative h-56">
      <button
        type="button"
        onClick={() => onOpen(chat)}
        className={`absolute inset-0 overflow-hidden rounded-2xl border surface-card text-left shadow-[0_10px_24px_color-mix(in_srgb,var(--theme-shade)_25%,transparent)] transition-[transform,box-shadow,border-color] duration-300
          hover:-translate-y-[3px] hover:border-border-strong hover:shadow-[0_22px_40px_color-mix(in_srgb,var(--theme-shade)_45%,transparent)]
          focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${menuOpen ? 'border-border-strong' : 'border-border-subtle'}`}
      >
        {image ? (
          <img key={image.src} src={image.src} alt="" onError={stepDown} style={{ objectPosition: image.position }} className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-hover:scale-[1.06]" />
        ) : (
          <ContourCover title={chat.title} />
        )}
        {hasScene && <span aria-hidden="true" className="absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-scrim/70 to-transparent" />}
        <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-scrim/96 from-[8%] via-scrim/55 via-[48%] to-transparent to-[78%]" />
        {(pinned || roleplay) && (
          <span className="absolute inset-x-3 top-3 flex flex-col items-start gap-2">
            <span className="flex gap-1.5">
              {pinned && <CardChip icon={Pin}>Pinned</CardChip>}
              {roleplay && <RoleplayChip />}
            </span>
            {hasScene && (
              <span className="flex min-w-0 max-w-full items-center gap-3 pl-1 text-xs font-medium text-text-primary [text-shadow:0_1px_3px_color-mix(in_srgb,var(--theme-shade)_85%,transparent)]">
                {scene.locationName && (
                  <span className="flex min-w-0 items-center gap-1.5">
                    <MapPin className="h-3 w-3 shrink-0 text-entity-location" aria-hidden="true" />
                    <span className="truncate">{scene.locationName}</span>
                  </span>
                )}
                {scene.time && (
                  <span className="flex shrink-0 items-center gap-1.5 tabular-nums">
                    <Clock className="h-3 w-3 shrink-0 text-text-secondary" aria-hidden="true" />
                    {scene.time}
                  </span>
                )}
              </span>
            )}
          </span>
        )}
        <span className="absolute inset-x-4 bottom-3.5 flex flex-col gap-2">
          <span className="truncate text-[1.0625rem] font-bold leading-tight text-text-primary">{chat.title}</span>
          <span className="flex items-center gap-2">
            <span className="flex-1 truncate text-xs font-semibold tabular-nums text-accent">{messages} · {timeAgo(chat.updatedAt)}</span>
            <ProfileAvatars profiles={profiles} />
          </span>
        </span>
      </button>

      <button
        ref={menuAnchorRef}
        type="button"
        aria-label={`Options for ${chat.title}`}
        aria-haspopup="menu"
        aria-expanded={menuOpen}
        onClick={() => setMenuOpen(open => !open)}
        className={`absolute right-2.5 top-2.5 inline-flex h-8 w-8 items-center justify-center rounded-[0.5625rem] border border-tint/10 bg-surface-canvas/55 text-text-secondary backdrop-blur-md transition-opacity
          hover:text-text-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${menuOpen ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}
      >
        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
      </button>
      <Menu anchorRef={menuAnchorRef} open={menuOpen} onClose={() => setMenuOpen(false)} label={`${chat.title} options`} className="w-48">
        <MenuItem icon={pinned ? PinOff : Pin} label={pinned ? 'Unpin' : 'Pin to top'} onSelect={() => { setMenuOpen(false); onTogglePin(chat); }} />
        <MenuItem icon={Pencil} label="Edit workspace" onSelect={() => { setMenuOpen(false); onEdit(chat); }} />
        <MenuSeparator />
        <MenuItem icon={Trash2} label="Delete" danger onSelect={() => { setMenuOpen(false); onDelete(chat); }} />
      </Menu>
    </div>
  );
}

function CardChip({ icon: Icon, children }) {
  return (
    <span className="inline-flex h-6 items-center gap-1.5 rounded-full border border-tint/10 bg-surface-canvas/45 px-2.5 text-xs font-medium text-text-secondary backdrop-blur-md">
      {Icon && <Icon className="h-3 w-3" aria-hidden="true" />}
      {children}
    </span>
  );
}

export function NewWorkspaceTile({ onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="group flex h-56 flex-col items-center justify-center gap-3 rounded-2xl border-[1.5px] border-dashed border-accent/35 bg-accent/[0.05] p-6 text-center text-text-secondary transition-colors hover:border-accent/60 hover:bg-accent/[0.09] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <span className="inline-flex h-11 w-11 items-center justify-center rounded-[0.875rem] bg-accent/90 text-on-accent shadow-[0_0.375rem_1.125rem_-0.5rem] shadow-accent/50 transition-colors group-hover:bg-accent">
        <Plus className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="text-sm font-semibold text-accent">New workspace</span>
      <span className="caption max-w-[12.5rem]">A story with its own chat, world, memory and writing.</span>
    </button>
  );
}
