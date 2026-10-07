import React from 'react';
import { Drama } from 'lucide-react';

// Marks a roleplay workspace with the same mask Roleplay uses in Configuration.
export default function RoleplayChip() {
  return (
    <span className="inline-flex h-6 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-roleplay/45 bg-roleplay-soft/55 pl-2 pr-2.5 text-xs font-semibold text-roleplay-text backdrop-blur-md">
      <Drama className="h-3 w-3" aria-hidden="true" />
      Roleplay
    </span>
  );
}
