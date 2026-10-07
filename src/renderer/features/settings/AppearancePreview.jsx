import React from 'react';
import { ArrowUp } from 'lucide-react';
import { ProfileAvatar } from '../../components/modals/ProfileModal';
import exampleBackground from '../../../assets/onboarding-bg.svg';

const CODE_THEMES = {
  'github-dark': { bg: '#0d1117', keyword: '#ff7b72', name: '#d2a8ff', string: '#a5d6ff', number: '#79c0ff', text: '#e6edf3' },
  'atom-one-dark': { bg: '#282c34', keyword: '#c678dd', name: '#e5c07b', string: '#98c379', number: '#d19a66', text: '#abb2bf' },
  'tokyo-night-dark': { bg: '#1a1b26', keyword: '#bb9af7', name: '#7dcfff', string: '#9ece6a', number: '#ff9e64', text: '#c0caf5' },
};

// Always the Example Project, so the preview never depends on what the user has written.
const SAMPLE = {
  image: { src: exampleBackground, position: 'center 50%' },
  prompt: 'Where does the next scene start?',
  reply: 'At the old lighthouse, an hour before the storm, with the keeper still missing.',
  profile: { name: 'Brainstorming', color: '#F2C14E' },
  place: 'the old lighthouse',
};

export default function AppearancePreview({ layout, fontClass, blur, codeTheme, lineNumbers }) {
  const sample = SAMPLE;
  const { image } = sample;
  const theme = CODE_THEMES[codeTheme] || CODE_THEMES['github-dark'];
  const glass = blur ? 'backdrop-blur-md' : '';
  const { color } = sample.profile;
  const n = index => (lineNumbers ? <span className="mr-3 select-none opacity-40">{index}</span> : null);

  return (
    <div className={fontClass}>
      <div className="relative h-[18.5rem] overflow-hidden rounded-2xl border border-tint/10 shadow-[0_1.5rem_3rem_-1.5rem_color-mix(in_srgb,var(--theme-shade)_80%,transparent)]">
        <img src={image.src} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition: image.position }} />
        <div aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(180deg,color-mix(in_srgb,var(--theme-surface-canvas)_55%,transparent),color-mix(in_srgb,var(--theme-surface-canvas)_35%,transparent)_40%,color-mix(in_srgb,var(--theme-surface-canvas)_85%,transparent))]" />
        <div className="relative flex h-full flex-col justify-end gap-3 p-3.5">
          {layout === 'document' ? (
            <>
              <div className={`rounded-[0.625rem] border border-tint/[0.07] bg-bubble-user/80 px-3 py-2.5 text-[0.8125rem] leading-normal text-text-primary ${glass}`}>{sample.prompt}</div>
              <div className="-mb-1 mt-1 flex items-center gap-1.5 pl-0.5 text-xs font-bold text-text-primary">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: color }} aria-hidden="true" />{sample.profile.name}
              </div>
              <div className={`rounded-[0.625rem] border border-tint/[0.07] bg-surface-panel/80 px-3 py-2.5 text-[0.8125rem] leading-relaxed text-text-primary ${glass}`}>{sample.reply}</div>
            </>
          ) : (
            <>
              <div className={`max-w-[78%] self-end rounded-[0.875rem] rounded-br-sm border border-tint/[0.08] bg-tint/[0.12] px-3 py-2 text-[0.8125rem] leading-normal text-text-primary ${glass}`}>{sample.prompt}</div>
              <div className="flex max-w-[92%] gap-2.5">
                <ProfileAvatar color={color} size={26} />
                <div className="min-w-0">
                  <div className="truncate text-xs font-bold [text-shadow:0_1px_3px_color-mix(in_srgb,var(--theme-shade)_85%,transparent)]" style={{ color }}>{sample.profile.name}</div>
                  <div
                    className={`mt-1 rounded-[0.875rem] rounded-tl-sm border px-3 py-2.5 text-[0.8125rem] leading-relaxed text-text-primary ${glass}`}
                    style={{ background: `color-mix(in srgb, ${color} 14%, var(--theme-surface-inset))`, borderColor: `color-mix(in srgb, ${color} 30%, transparent)` }}
                  >
                    {sample.reply}
                  </div>
                </div>
              </div>
            </>
          )}
          <div className="flex items-center gap-2 rounded-xl border border-accent/45 bg-surface-inset py-1.5 pl-3 pr-1.5 shadow-[0_0_0_3px] shadow-accent/15">
            <span className="flex-1 truncate text-[0.8125rem] text-text-subtle">Write your next message…</span>
            <span className="inline-flex h-7 w-7 items-center justify-center rounded-lg bg-accent text-on-accent"><ArrowUp className="h-3.5 w-3.5" strokeWidth={2.4} aria-hidden="true" /></span>
          </div>
        </div>
      </div>
      <p className="caption mt-2.5">The Example Project, with these settings.</p>
      <pre className="mt-3.5 overflow-hidden rounded-xl border border-tint/[0.08] px-3.5 py-3 font-mono text-xs leading-relaxed" style={{ background: theme.bg, color: theme.text }}>
        {n(1)}<span style={{ color: theme.keyword }}>const</span> <span style={{ color: theme.name }}>scene</span> = {'{'}{'\n'}
        {n(2)}  place: <span style={{ color: theme.string }}>"{sample.place}"</span>,{'\n'}
        {n(3)}  hour: <span style={{ color: theme.number }}>14</span>,{'\n'}
        {n(4)}{'};'}
      </pre>
    </div>
  );
}

// The two small drawings behind the layout and toolbar choices.
export function OptionTile({ kind, selected, onSelect, label }) {
  const strong = selected ? 'var(--app-accent)' : 'color-mix(in srgb, var(--theme-tint) 28%, transparent)';
  const strongOpacity = selected ? 0.9 : 0.5;
  const soft = 'color-mix(in srgb, var(--theme-tint) 14%, transparent)';
  const lines = [[26, 74], [34, 70], [42, 62], [50, 72]].map(([y, w]) => <rect key={y} x="8" y={y} width={w} height="4" rx="2" fill={soft} />);
  const keys = xs => xs.map(x => <rect key={x} x={x} y={kind === 'fixed' ? 9 : 17.5} width="6" height="4" rx="1.5" style={{ fill: 'var(--theme-surface-canvas)' }} fillOpacity="0.7" />);
  const art = {
    bubbles: (
      <>
        <rect x="38" y="8" width="46" height="12" rx="6" fill={soft} />
        <rect x="6" y="26" width="58" height="16" rx="7" fill={strong} fillOpacity={strongOpacity} />
        <rect x="44" y="48" width="40" height="10" rx="5" fill={soft} />
      </>
    ),
    document: (
      <>
        <rect x="6" y="9" width="40" height="5" rx="2.5" fill={soft} />
        {[[22, 78], [30, 72], [38, 60]].map(([y, w]) => <rect key={y} x="6" y={y} width={w} height="4" rx="2" fill={strong} fillOpacity={strongOpacity} />)}
        <rect x="6" y="50" width="34" height="5" rx="2.5" fill={soft} />
      </>
    ),
    fixed: (
      <>
        <rect x="4" y="5" width="82" height="12" rx="4" fill={strong} fillOpacity={selected ? 0.85 : 0.45} />
        {keys([9, 18, 27, 36])}
        {lines}
      </>
    ),
    bubble: (
      <>
        {lines}
        <rect x="20" y="34" width="34" height="4" rx="2" fill={strong} fillOpacity="0.55" />
        <rect x="18" y="13" width="44" height="13" rx="4" fill={strong} fillOpacity={selected ? 0.85 : 0.45} />
        {keys([23, 32, 41, 50])}
      </>
    ),
  }[kind];
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      onClick={onSelect}
      className={`w-28 rounded-[0.6875rem] border px-2 pb-1.5 pt-2 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${selected ? 'border-accent/45 bg-accent/[0.13]' : 'border-tint/[0.08] bg-surface-inset/75 hover:border-tint/[0.16]'}`}
    >
      <svg viewBox="0 0 90 64" className="mx-auto block h-[3.875rem] w-24" aria-hidden="true">{art}</svg>
      <span className={`mt-1 block text-xs font-semibold ${selected ? 'text-accent' : 'text-text-muted'}`}>{label}</span>
    </button>
  );
}
