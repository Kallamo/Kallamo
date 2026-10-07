import React from 'react';
import Tooltip from '../../components/ui/Tooltip';

// The profiles a workspace starts with, as overlapping initials in each profile's colour.
export default function ProfileAvatars({ profiles, max = 3, size = 22 }) {
  if (!profiles.length) return null;
  const shown = profiles.slice(0, max);
  const extra = profiles.length - shown.length;
  return (
    <Tooltip content={profiles.map(profile => profile.name).join(', ')}>
      <span className="inline-flex shrink-0 items-center" aria-label={`Profiles: ${profiles.map(profile => profile.name).join(', ')}`}>
        {shown.map((profile, index) => (
          <span
            key={profile.id}
            className="inline-flex items-center justify-center rounded-full border-2 border-surface-raised-low text-xs font-bold"
            style={{
              width: size,
              height: size,
              marginLeft: index ? -7 : 0,
              color: profile.color,
              background: `color-mix(in srgb, ${profile.color} 30%, var(--theme-surface-panel))`,
              fontSize: Math.round(size * 0.45),
            }}
          >
            {(profile.name || '?').trim().charAt(0).toUpperCase()}
          </span>
        ))}
        {extra > 0 && (
          <span
            className="inline-flex items-center justify-center rounded-full border-2 border-surface-raised-low bg-surface-hover text-xs font-semibold text-text-secondary"
            style={{ width: size, height: size, marginLeft: -7, fontSize: Math.round(size * 0.42) }}
          >
            +{extra}
          </span>
        )}
      </span>
    </Tooltip>
  );
}
