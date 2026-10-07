import React from 'react';

// Lucide has no brand marks, so the few the app needs live here.
export const DISCORD_PATH = 'M107.7,8.07A105.15,105.15,0,0,0,77.26,0a77.19,77.19,0,0,0-3.3,6.83A96.67,96.67,0,0,0,53.22,6.83,77.19,77.19,0,0,0,49.88,0,105.15,105.15,0,0,0,19.44,8.07C3.66,31.58-1.86,54.65,1,77.53A105.73,105.73,0,0,0,32,96.36a77.7,77.7,0,0,0,6.63-10.85,68.43,68.43,0,0,1-10.5-5A52.57,52.57,0,0,0,31,77.53,74.37,74.37,0,0,0,96.19,77.53a52.57,52.57,0,0,0,2.83,3a68.43,68.43,0,0,1-10.5,5,77.7,77.7,0,0,0,6.63,10.85,105.73,105.73,0,0,0,31-18.83C129.87,50.84,123.3,28,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53S36.18,40.36,42.45,40.36,53.83,46,53.83,53,48.72,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.24,60,73.24,53S78.41,40.36,84.69,40.36,96.07,46,96.07,53,91,65.69,84.69,65.69Z';

const GITHUB_PATH = 'M12 2C6.477 2 2 6.477 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.07 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0012 2z';

export function GithubIcon({ className = 'h-4 w-4' }) {
  return <svg viewBox="0 0 24 24" fill="currentColor" className={`shrink-0 ${className}`} aria-hidden="true"><path d={GITHUB_PATH} /></svg>;
}

export function DiscordIcon({ className = 'h-4 w-4' }) {
  return <svg viewBox="0 0 127.14 96.36" fill="currentColor" className={`shrink-0 ${className}`} aria-hidden="true"><path d={DISCORD_PATH} /></svg>;
}

export function RedditIcon({ className = 'h-4 w-4' }) {
  const id = React.useId();
  return (
    <svg viewBox="0 0 24 24" className={`shrink-0 ${className}`} aria-hidden="true">
      <mask id={id}>
        <rect width="24" height="24" fill="white" />
        <ellipse cx="12" cy="13.6" rx="6" ry="4.1" fill="black" />
        <circle cx="17.6" cy="10.4" r="1.5" fill="black" />
        <circle cx="6.4" cy="10.4" r="1.5" fill="black" />
        <path d="M12 9.5l1-3.6 2.8.7" stroke="black" strokeWidth="1" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="16.4" cy="6.7" r="1.15" fill="black" />
      </mask>
      <circle cx="12" cy="12" r="10.5" fill="currentColor" mask={`url(#${id})`} />
      <circle cx="9.7" cy="13" r="1" fill="currentColor" />
      <circle cx="14.3" cy="13" r="1" fill="currentColor" />
      <path d="M9.6 15.4c1.4.9 3.4.9 4.8 0" stroke="currentColor" strokeWidth="1" fill="none" strokeLinecap="round" />
    </svg>
  );
}
