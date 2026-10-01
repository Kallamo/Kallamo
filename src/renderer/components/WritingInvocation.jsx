import React, { useState } from 'react';
import { AlertTriangle, Pin } from 'lucide-react';
import { AiGlyph } from './ui/glyphs';
import Modal from './ui/Modal';
import Button from './ui/Button';
import SearchableSelect from './ui/SearchableSelect';

export const CHANNEL_LABELS = { replacement: 'Replace', insertion: 'Insert after', analysis: 'Analyze' };

// Each option previews how its result comes back; the review itself happens in the document.
const CHANNELS = [
  {
    value: 'replacement',
    description: 'Rewrites the selection. You accept or reject the changes.',
    preview: <><span className="block h-1.5 w-[90%] rounded-sm bg-red-300" /><span className="block h-1.5 w-3/4 rounded-sm bg-emerald-300" /><span className="block h-1.5 w-1/2 rounded-sm bg-slate-300" /></>,
  },
  {
    value: 'insertion',
    description: 'Adds new text right after the selection.',
    preview: <><span className="block h-1.5 w-[90%] rounded-sm bg-slate-300" /><span className="block h-1.5 w-2/3 rounded-sm bg-slate-300" /><span className="block h-1.5 w-4/5 rounded-sm bg-emerald-300" /></>,
  },
  {
    value: 'analysis',
    description: 'Keeps the text as it is and saves a note.',
    preview: (
      <span className="flex items-center gap-2">
        <span className="flex flex-1 flex-col gap-1.5"><span className="block h-1.5 w-[95%] rounded-sm bg-slate-300" /><span className="block h-1.5 w-2/3 rounded-sm bg-slate-300" /></span>
        <span className="h-7 w-5 rounded-sm bg-violet-200" />
      </span>
    ),
  },
];

const countWords = (text) => (String(text || '').match(/\S+/g) || []).length;

export function InvokeModal({ selection, profiles, initialChannel, directivesCount = 0, onSubmit, onClose }) {
  const [profileId, setProfileId] = useState(profiles[0]?.id || '');
  const [prompt, setPrompt] = useState('');
  const [channel, setChannel] = useState(CHANNELS.some(c => c.value === initialChannel) ? initialChannel : 'replacement');
  const selected = profiles.find(p => p.id === profileId);

  const canSubmit = profileId && profiles.length > 0 && !selected?.needsSetup;
  const submit = () => { if (canSubmit) onSubmit(profileId, prompt, channel); };
  const words = countWords(selection);

  return (
    <Modal onClose={onClose} size="xl" title="Invoke AI" icon={AiGlyph}>
      <div className="custom-scrollbar flex max-h-[70vh] flex-col gap-5 overflow-y-auto px-5 py-5">
        <div>
          <p className="mb-2 text-xs font-semibold text-text-secondary">Selection <span className="font-normal text-text-subtle">· {words} {words === 1 ? 'word' : 'words'}</span></p>
          <blockquote className="m-0 line-clamp-3 select-text whitespace-pre-wrap rounded-control bg-white/[0.035] px-3 py-2.5 text-sm leading-relaxed text-text-secondary">{selection}</blockquote>
        </div>

        {profiles.length === 0 ? (
          <p className="rounded-control border border-status-warning/30 bg-status-warning/[0.08] px-3 py-2.5 text-sm text-status-warning">
            No writing profiles are active in this workspace. Turn one on in the Workspace tab to invoke the AI here.
          </p>
        ) : (
          <div>
            <p className="mb-2 text-xs font-semibold text-text-secondary">Profile</p>
            <SearchableSelect
              value={profileId}
              onChange={setProfileId}
              ariaLabel="Profile"
              options={profiles.map(profile => ({ id: profile.id, label: profile.name, color: profile.color }))}
              placeholder="Search for a profile"
            />
            {selected?.needsSetup && (
              <div role="alert" className="mt-2.5 flex items-start gap-2.5 rounded-control border border-status-warning/30 bg-status-warning/[0.08] px-3 py-2.5 text-xs leading-relaxed text-status-warning">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{selected.name} can't run yet. Create an API profile in Settings, then link it to this profile in the Library.</span>
              </div>
            )}
          </div>
        )}

        <fieldset className="m-0 border-0 p-0">
          <legend className="mb-2 p-0 text-xs font-semibold text-text-secondary">What comes back</legend>
          <div role="radiogroup" aria-label="What comes back" className="grid grid-cols-3 gap-2.5">
            {CHANNELS.map(option => {
              const on = channel === option.value;
              return (
                <button
                  key={option.value}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setChannel(option.value)}
                  className={`flex min-w-0 flex-col gap-2 rounded-card border p-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${on ? 'border-accent/60 bg-accent/[0.07]' : 'border-border-subtle bg-white/[0.025] hover:border-border-default'}`}
                >
                  <span aria-hidden="true" className="flex h-12 w-full flex-col justify-center gap-1.5 rounded-md bg-[#f7f7f5] px-2.5">{option.preview}</span>
                  <span className="flex items-center gap-2 text-sm font-semibold text-text-primary">
                    <span aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 rounded-full ${on ? 'border-4 border-accent' : 'border-[1.5px] border-border-strong'}`} />
                    {CHANNEL_LABELS[option.value]}
                  </span>
                  <span className="text-xs leading-snug text-text-muted">{option.description}</span>
                </button>
              );
            })}
          </div>
        </fieldset>

        <label className="block">
          <span className="mb-2 block text-xs font-semibold text-text-secondary">Instruction <span className="font-normal text-text-subtle">· optional</span></span>
          <textarea
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit(); } }}
            rows={3}
            placeholder="Tighten this, add tension, foreshadow the betrayal…"
            className="w-full resize-none rounded-control border border-border-default bg-surface-input px-3 py-2.5 text-sm text-text-primary placeholder:text-text-subtle focus:border-accent/70 focus:outline-none"
          />
        </label>
      </div>

      <div className="flex items-center gap-2 border-t border-border-subtle px-5 py-3.5">
        {directivesCount > 0 && (
          <span className="inline-flex items-center gap-1.5 text-xs text-text-subtle">
            <Pin className="h-3.5 w-3.5" aria-hidden="true" />
            {directivesCount} {directivesCount === 1 ? 'directive goes' : 'directives go'} with it
          </span>
        )}
        <span className="flex-1" />
        <Button variant="subtle" onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!canSubmit} onClick={submit}>Invoke</Button>
      </div>
    </Modal>
  );
}
