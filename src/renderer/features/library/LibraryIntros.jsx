import React from 'react';
import { ArrowRight, MessageSquare, Plug, Plus, Upload } from 'lucide-react';
import Button from '../../components/ui/Button';
import { ProfileAvatar } from '../../components/modals/ProfileModal';

export const VARIABLE_STARTERS = [
  { label: 'tone', name: 'Tone', description: 'The voice the AI writes in.' },
  { label: 'point of view', name: 'Point of view', description: 'Whose eyes the story is told through.' },
  { label: 'house style', name: 'House style', description: 'Spelling, punctuation and formatting rules.' },
];

// Literal {{tag}}, as typed in a profile's rules.
const Token = ({ name }) => (
  <span className="mx-0.5 inline-flex h-6 items-center whitespace-nowrap rounded-[0.4375rem] border border-tint/[0.16] bg-tint/[0.05] px-2 align-[1px] font-mono text-[0.8125rem] text-text-primary">{`{{${name}}}`}</span>
);
const Swapped = ({ children }) => (
  <span className="whitespace-nowrap rounded-[0.3125rem] bg-tint/[0.06] px-1 py-px text-text-primary shadow-[inset_0_-1.5px_0_color-mix(in_srgb,var(--theme-tint)_28%,transparent)]">{children}</span>
);

export function VariablesIntro({ onNew, onStart }) {
  return (
    <article className="rounded-2xl border border-border-subtle surface-card px-8 py-7">
      <div className="grid grid-cols-[1fr_4rem_1fr] items-stretch">
        <div className="rounded-[0.875rem] border border-border-subtle bg-tint/[0.02] px-5 py-[1.125rem]">
          <span className="caption mb-2.5 block">What you write in a profile&apos;s rules</span>
          <p className="text-[0.9375rem] leading-[2] text-text-secondary">
            Write in <Token name="tone" />. Keep each scene under <Token name="scene_length" />, and follow <Token name="house_style" />.
          </p>
        </div>
        <div className="flex items-center justify-center text-text-disabled"><ArrowRight className="h-5 w-5" aria-hidden="true" /></div>
        <div className="rounded-[0.875rem] border border-border-subtle bg-tint/[0.02] px-5 py-[1.125rem]">
          <span className="caption mb-2.5 block">What the AI reads, every time it runs</span>
          <p className="text-[0.9375rem] leading-[2] text-text-muted">
            Write in <Swapped>a dry, wry voice with short sentences</Swapped>. Keep each scene under <Swapped>400 words</Swapped>, and follow <Swapped>American spelling, no em dashes</Swapped>.
          </p>
        </div>
      </div>
      <IntroFooter
        title="Write it once, use it in every profile"
        text="Change a variable and every profile and workflow step that uses it changes too."
        newLabel="New variable"
        onNew={onNew}
        starters={VARIABLE_STARTERS}
        onStart={onStart}
      />
    </article>
  );
}

function IntroFooter({ title, text, newLabel, onNew, onImport, starters, onStart }) {
  return (
    <div className="mt-6 flex flex-wrap items-center gap-6">
      <div className="min-w-[18rem] flex-1">
        <h3 className="text-xl font-extrabold tracking-[-0.01em] text-text-primary">{title}</h3>
        <p className="mt-1.5 text-balance text-sm leading-relaxed text-text-muted">{text}</p>
      </div>
      <div className="flex flex-col items-end gap-2.5">
        <div className="flex gap-2">
          {onImport && <Button variant="ghost" icon={Upload} onClick={onImport}>Import</Button>}
          <Button icon={Plus} onClick={onNew}>{newLabel}</Button>
        </div>
        {starters && (
          <div className="flex items-center gap-1.5 whitespace-nowrap">
            <span className="caption">Or start with</span>
            {starters.map(starter => (
              <button
                key={starter.label}
                type="button"
                onClick={() => onStart(starter)}
                className="inline-flex h-6 items-center rounded-full border border-border-default px-2.5 text-xs font-medium text-text-secondary transition-colors hover:border-border-strong hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
              >
                {starter.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const Panel = ({ caption, className = '', children }) => (
  <div className={`rounded-[0.875rem] border border-border-subtle bg-tint/[0.02] px-5 py-4 ${className}`}>
    <span className="caption mb-2 block">{caption}</span>
    {children}
  </div>
);

const IntroRow = ({ label, children }) => (
  <div className="grid grid-cols-[5.75rem_minmax(0,1fr)] items-baseline gap-3 border-t border-tint/[0.06] py-2.5">
    <span className="whitespace-nowrap text-[0.8125rem] font-semibold text-text-secondary">{label}</span>
    <div className="min-w-0 text-sm leading-normal text-text-muted">{children}</div>
  </div>
);

export const PROFILE_STARTERS = [
  {
    label: 'Line editor',
    name: 'Line editor',
    color: '#3b82f6',
    description: 'Tightens prose in the Writing Desk without changing your voice.',
    systemPrompt: "Edit the selected text for clarity and rhythm. Keep the author's voice, names and facts exactly as written. Return only the edited text.",
  },
  {
    label: 'Brainstorm partner',
    name: 'Brainstorm partner',
    color: '#10b981',
    description: 'Talks through plot, character and ideas in the chat.',
    systemPrompt: 'You are a brainstorming partner. Offer a few distinct options, ask one sharp question at a time, and only write finished prose when asked.',
  },
  {
    label: 'Narrator',
    name: 'Narrator',
    color: '#ff5f56',
    description: "Runs an interactive story and reacts to the player's choices.",
    systemPrompt: 'Narrate the story in second person, present tense. Describe what the player perceives, play every other character, and end each reply on a moment that invites a choice. Never decide for the player.',
  },
];

export function ProfilesIntro({ onNew, onImport, onStart }) {
  return (
    <article className="rounded-2xl border border-border-subtle surface-card px-8 py-7">
      <div className="grid grid-cols-[1fr_4rem_1fr] items-stretch">
        <Panel caption="What you give it" className="pb-1.5">
          <IntroRow label="Model">
            <span className="inline-flex flex-wrap items-center gap-2">
              <span className="inline-flex h-6 items-center gap-1.5 whitespace-nowrap rounded-md border border-border-default bg-tint/[0.04] px-2 text-xs font-medium text-text-secondary">
                <Plug className="h-3 w-3" aria-hidden="true" />
                Your connection
              </span>
              <span className="whitespace-nowrap font-mono text-xs text-text-subtle">any model it offers</span>
            </span>
          </IntroRow>
          <IntroRow label="Rules"><i className="text-text-secondary">Tighten the prose. Keep the author&apos;s voice, names and facts exactly as written.</i></IntroRow>
          <IntroRow label="Knowledge">Files and memories it can look up</IntroRow>
        </Panel>
        <div className="flex items-center justify-center text-text-disabled"><ArrowRight className="h-5 w-5" aria-hidden="true" /></div>
        <Panel caption="What you get">
          <div className="mt-1 flex flex-col gap-2.5 rounded-[0.875rem] border border-border-subtle p-4" style={{ background: 'radial-gradient(120% 90% at 0% 0%, color-mix(in srgb, #3b82f6 10%, transparent), var(--theme-surface-well) 60%)' }}>
            <div className="flex items-center gap-3">
              <ProfileAvatar color="#3b82f6" size={40} />
              <div className="min-w-0">
                <span className="block truncate text-[0.9375rem] font-bold text-text-primary">Line editor</span>
                <span className="caption">Ready in every workspace</span>
              </div>
            </div>
            <p className="text-[0.8125rem] leading-normal text-text-muted">Tightens prose in the Writing Desk without changing your voice.</p>
          </div>
          <p className="caption mt-3">Call it from the chat, the Writing Desk or a workflow step.</p>
        </Panel>
      </div>
      <IntroFooter
        title="Give each voice its own model and rules"
        text="The rules are how it writes. The knowledge base is what it knows. Every workspace can use it."
        newLabel="New profile"
        onNew={onNew}
        onImport={onImport}
        starters={PROFILE_STARTERS}
        onStart={onStart}
      />
    </article>
  );
}

const EXAMPLE_STEPS = [
  { color: '#ff5f56', name: 'Writer', text: 'Writes the next scene from your message.' },
  { color: '#9c27b0', name: 'Continuity check', text: 'Reads the draft against your canon and fixes what contradicts it.' },
];
const EDGE = 'color-mix(in srgb, var(--theme-tint) 25%, transparent)';

const ExampleEnd = ({ label, sub }) => (
  <div className="flex w-[8.75rem] shrink-0 flex-col gap-1.5">
    <span className="inline-flex h-[2.125rem] w-[2.125rem] items-center justify-center rounded-[0.625rem] border border-border-default text-text-secondary">
      <MessageSquare className="h-4 w-4" aria-hidden="true" />
    </span>
    <span className="whitespace-nowrap text-[0.8125rem] font-semibold text-text-secondary">{label}</span>
    <span className="caption whitespace-nowrap">{sub}</span>
  </div>
);
const ExampleLink = ({ from, to, short }) => (
  <div className={`shrink-0 pt-4 ${short ? 'w-8' : 'w-14'}`} aria-hidden="true">
    <div className="h-[3px] rounded-full opacity-75" style={{ background: `linear-gradient(90deg, ${from}, ${to})` }} />
  </div>
);

export function WorkflowsIntro({ onNew, onImport }) {
  return (
    <article className="rounded-2xl border border-border-subtle surface-card px-8 py-7">
      <Panel caption="An example" className="pb-5">
        <div className="mt-2 flex items-start">
          <ExampleEnd label="Your message" sub="Starts the run" />
          <ExampleLink from={EDGE} to={EXAMPLE_STEPS[0].color} short />
          {EXAMPLE_STEPS.map((step, index) => (
            <React.Fragment key={step.name}>
              {index > 0 && <ExampleLink from={EXAMPLE_STEPS[index - 1].color} to={step.color} />}
              <div className="flex min-w-0 flex-1 gap-3.5">
                <span className="inline-flex h-[2.125rem] w-[2.125rem] shrink-0 items-center justify-center rounded-[0.625rem] text-sm font-extrabold tabular-nums" style={{ background: step.color, color: '#0b1418' }}>{index + 1}</span>
                <div className="flex min-w-0 flex-col gap-1.5 pt-1.5">
                  <span className="truncate text-[0.9375rem] font-bold text-text-primary">{step.name}</span>
                  <p className="text-[0.8125rem] leading-normal text-text-muted">{step.text}</p>
                </div>
              </div>
            </React.Fragment>
          ))}
          <ExampleLink from={EXAMPLE_STEPS[EXAMPLE_STEPS.length - 1].color} to={EDGE} short />
          <ExampleEnd label="Reply in chat" sub="The last step answers" />
        </div>
      </Panel>
      <IntroFooter
        title="Chain profiles into one reply"
        text="Each step reads the text of the step before it. Only the last one answers in the chat."
        newLabel="New workflow"
        onNew={onNew}
        onImport={onImport}
      />
    </article>
  );
}
