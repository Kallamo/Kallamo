import React from 'react';
import { DISCORD_PATH } from '../../components/ui/BrandIcons';

const DISCORD_URL = 'https://discord.com/invite/CE4C9JRS9H';

// Discord's own colour marks it as a community link without borrowing the accent.
export default function DiscordButton() {
  return (
    <a
      href={DISCORD_URL}
      target="_blank"
      rel="noopener noreferrer"
      className="absolute bottom-9 right-12 z-30 inline-flex items-center gap-2.5 rounded-[0.875rem] border border-discord/40 bg-discord-soft/72 py-2 pl-2 pr-[1.125rem] text-sm font-semibold text-discord-text shadow-[0_10px_30px_color-mix(in_srgb,var(--theme-shade)_35%,transparent)] backdrop-blur-xl transition-[background-color,border-color] duration-300 hover:border-discord/70 hover:bg-discord-soft-hover/85 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-discord/60"
    >
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-[0.5625rem] bg-discord text-discord-on">
        <svg viewBox="0 0 127.14 96.36" fill="currentColor" className="h-[1.0625rem] w-[1.0625rem]" aria-hidden="true">
          <path d={DISCORD_PATH} />
        </svg>
      </span>
      Join the community on Discord
    </a>
  );
}
