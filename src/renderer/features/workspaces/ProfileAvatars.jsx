import React from 'react';
import Tooltip from '../../components/ui/Tooltip';
import { ReedPen } from '../../logo';

// The profiles a workspace starts with, as bare pens in each profile's colour.
export default function ProfileAvatars({ profiles, max = 3, size = 18 }) {
  if (!profiles.length) return null;
  const shown = profiles.slice(0, max);
  const extra = profiles.length - shown.length;
  return (
    <Tooltip content={profiles.map(profile => profile.name).join(', ')}>
      <span className="inline-flex shrink-0 items-center gap-0.5" aria-label={`Profiles: ${profiles.map(profile => profile.name).join(', ')}`}>
        {shown.map(profile => (
          <ReedPen key={profile.id} size={size} color={profile.color || '#FBCB2D'} />
        ))}
        {extra > 0 && <span className="pl-0.5 text-xs font-semibold tabular-nums text-text-secondary">+{extra}</span>}
      </span>
    </Tooltip>
  );
}
