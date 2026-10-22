import React, { useState, useEffect, useRef, useMemo } from 'react';
import { Plug, Trash2 } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { parseMarkdown, escapeHTML } from '../../utils/markdown';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import TextInput from '../ui/TextInput';
import Textarea from '../ui/Textarea';
import Toggle from '../ui/Toggle';
import SelectMenu from '../ui/SelectMenu';
import NumberInput from '../ui/NumberInput';
import SegmentedControl from '../ui/SegmentedControl';
import Popover from '../ui/Popover';
import { ReedPen } from '../../logo';

const COLORS = ['#FBCB2D', '#ff5f56', '#3b82f6', '#10b981', '#9c27b0', '#ec4899', '#6366f1', '#14b8a6', '#f97316', '#4b5563'];
const ROUNDS = [1, 2, 3, 4, 5].map(n => ({ value: n, label: String(n) }));
const MODES = [{ value: 'editor', label: 'Write' }, { value: 'preview', label: 'Preview' }];
const clampTurns = (value) => (Number.isInteger(value) ? Math.min(5, Math.max(1, value)) : 3);

// A profile without a working model keeps its colour but sits dimmed in a neutral tile.
export function ProfileAvatar({ color, size = 44, muted = false }) {
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center border"
      style={{
        width: size,
        height: size,
        borderRadius: Math.round(size * 0.3),
        background: muted ? 'color-mix(in srgb, var(--theme-tint) 4%, transparent)' : `color-mix(in srgb, ${color} 15%, var(--theme-surface-raised-low))`,
        borderColor: muted ? 'color-mix(in srgb, var(--theme-tint) 10%, transparent)' : `color-mix(in srgb, ${color} 32%, transparent)`,
      }}
    >
      <ReedPen size={Math.round(size * 0.74)} color={color} opacity={muted ? 0.45 : 1} />
    </span>
  );
}

export default function ProfileModal({ profile, preset, starters = null, onClose, onSave, onDelete, initialTab = 'rules', inline = false }) {
  const { apiProfiles, handleSaveProfile, variables, chats } = useApp();
  const isEditing = !!profile;

  // Stable id for new profiles so the KB Manager (opened later) targets the right folder.
  const [profileId] = useState(() => profile?.id || 'profile_' + Math.random().toString(36).substr(2, 9));
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#FBCB2D');
  const [apiProfileId, setApiProfileId] = useState('');
  const [model, setModel] = useState('');
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [manualMode, setManualMode] = useState(false);
  const [manualJson, setManualJson] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');
  const [isAgentic, setIsAgentic] = useState(false);
  const [agenticPrompt, setAgenticPrompt] = useState('');
  const [agenticMaxTurns, setAgenticMaxTurns] = useState(3);
  const [tab, setTab] = useState(initialTab);
  const [chosenPreset, setChosenPreset] = useState(preset);

  useEffect(() => {
    // A starter fills a new profile's identity and rules; the connection stays the user's choice.
    if (!profile && chosenPreset) {
      setName(chosenPreset.name || '');
      setDescription(chosenPreset.description || '');
      setColor(chosenPreset.color || '#FBCB2D');
      setSystemPrompt(chosenPreset.systemPrompt || '');
      return;
    }
    if (!profile) return;
    setName(profile.name || '');
    setDescription(profile.description || '');
    setColor(profile.color || '#FBCB2D');
    setApiProfileId(profile.apiProfileId || '');
    setModel(profile.model || '');
    setTemperature(profile.temperature ?? 0.7);
    setMaxTokens(profile.maxTokens ?? 2048);
    setManualMode(profile.manualMode === true || profile.manualMode === 1);
    setManualJson(profile.manualJson || '');
    setSystemPrompt(profile.systemPrompt || '');
    setIsAgentic(profile.isAgentic === true || profile.isAgentic === 1);
    setAgenticPrompt(profile.agenticPrompt || '');
    setAgenticMaxTurns(clampTurns(profile.agenticMaxTurns));
  }, [profile, chosenPreset]);

  const selectedApi = apiProfiles.find(ap => ap.id === apiProfileId);
  const availableModels = selectedApi ? (typeof selectedApi.models === 'string' ? JSON.parse(selectedApi.models) : selectedApi.models) || [] : [];
  // Keep the saved model selectable, or the picker shows the first option while saving the stale value.
  const modelOptions = (model && !availableModels.includes(model)) ? [model, ...availableModels] : availableModels;
  const workspaceUses = useMemo(() => chats.filter(chat => {
    const ids = typeof chat.activeProfiles === 'string' ? JSON.parse(chat.activeProfiles || '[]') : (chat.activeProfiles || []);
    return ids.includes(profileId);
  }).length, [chats, profileId]);

  // The KB is authored in the KB Manager; carry it through untouched.
  const handleSave = async () => {
    if (!name.trim()) return;
    const preservedKb = profile?.knowledgeFiles
      ? (typeof profile.knowledgeFiles === 'string' ? profile.knowledgeFiles : JSON.stringify(profile.knowledgeFiles))
      : JSON.stringify([]);
    const updatedProfile = {
      id: profileId,
      name: name.trim(),
      description: description.trim(),
      color,
      apiProfileId,
      model,
      temperature: Number(temperature),
      maxTokens: Number(maxTokens),
      systemPrompt: systemPrompt.trim(),
      knowledgeFiles: preservedKb,
      manualMode: manualMode ? 1 : 0,
      manualJson: manualJson.trim(),
      isAgentic: isAgentic ? 1 : 0,
      agenticPrompt: agenticPrompt.trim(),
      agenticMaxTurns: clampTurns(agenticMaxTurns),
      syncToCloud: profile?.syncToCloud ?? 0,
    };
    try {
      await handleSaveProfile(updatedProfile);
      if (onSave) onSave(updatedProfile, { isNew: !isEditing });
      onClose();
    } catch (e) {
      console.error('Error saving profile:', e);
    }
  };

  const subtitle = isEditing
    ? `AI profile · ${workspaceUses === 0 ? 'not used in any workspace' : `in ${workspaceUses} workspace${workspaceUses === 1 ? '' : 's'}`}`
    : 'A voice, a model and the rules it follows, usable in any workspace.';
  const apiLabel = selectedApi ? [selectedApi.provider, 'Keys and endpoints live in Settings, under Connections.'].filter(Boolean).join('. ') : 'Connections are set up in Settings.';

  return (
    <Modal
      onClose={onClose}
      size="editor"
      title={name.trim() || (isEditing ? 'Untitled profile' : 'New AI profile')}
      subtitle={subtitle}
      leading={<ProfileAvatar color={color} size={40} />}
      className={inline ? '' : 'h-[min(55rem,calc(100vh-2rem))]'}
      inline={inline}
    >
      {!isEditing && starters && (
        <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-tint/[0.06] px-6 py-3">
          <span className="caption mr-1">Start from</span>
          {starters.map(starter => (
            <button
              key={starter.label}
              type="button"
              onClick={() => setChosenPreset(starter)}
              aria-pressed={chosenPreset?.label === starter.label}
              className={`inline-flex h-7 items-center gap-2 rounded-full border px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${chosenPreset?.label === starter.label ? 'border-accent/55 text-text-primary' : 'border-border-default text-text-secondary hover:border-border-strong hover:text-text-primary'}`}
            >
              <ReedPen size={13} color={starter.color} />
              {starter.label}
            </button>
          ))}
        </div>
      )}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <div className="flex shrink-0 flex-col gap-6 overflow-y-auto custom-scrollbar border-border-subtle px-6 py-5 lg:w-[26rem] lg:border-r">
          <section className="flex flex-col gap-3.5">
            <h3 className="text-sm font-bold text-text-primary">Identity</h3>
            <TextInput label="Name" value={name} onChange={e => setName(e.target.value)} placeholder="Line editor" autoFocus={!isEditing} />
            <Textarea label="Description" value={description} onChange={e => setDescription(e.target.value)} placeholder="Tightens prose in the Writing Desk without changing your voice." rows={3} className="min-h-[5.25rem]" />
            <div>
              <span className="mb-1.5 block text-sm font-medium text-text-secondary">
                Colour <span className="caption">(names this profile in the chat)</span>
              </span>
              <div className="flex flex-wrap gap-2.5">
                {COLORS.map(c => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => setColor(c)}
                    aria-label={`Use colour ${c}`}
                    aria-pressed={color === c}
                    style={{ backgroundColor: c, boxShadow: color === c ? '0 0 0 2px var(--theme-surface-canvas), 0 0 0 4px var(--theme-text-primary)' : undefined }}
                    className="h-[1.625rem] w-[1.625rem] rounded-full transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  />
                ))}
              </div>
            </div>
          </section>

          <section data-tour="profile-connection" className="flex flex-col gap-3.5">
            <h3 className="text-sm font-bold text-text-primary">Connection</h3>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <span className="mb-1.5 block text-sm font-medium text-text-secondary">API profile</span>
                <SelectMenu
                  ariaLabel="API profile"
                  value={apiProfileId}
                  onChange={value => { setApiProfileId(value); setModel(''); }}
                  options={[{ value: '', label: 'Not linked' }, ...apiProfiles.map(ap => ({ value: ap.id, label: ap.name }))]}
                />
              </div>
              <div>
                <span className="mb-1.5 block text-sm font-medium text-text-secondary">Model</span>
                {apiProfileId ? (
                  <SelectMenu
                    ariaLabel="Model"
                    value={model}
                    onChange={setModel}
                    options={[{ value: '', label: 'Choose a model' }, ...modelOptions.map(m => ({ value: m, label: m }))]}
                  />
                ) : (
                  <div className="flex min-h-9 min-w-0 items-center rounded-control border border-border-default bg-surface-input px-3 text-sm text-text-disabled"><span className="truncate">No connection</span></div>
                )}
              </div>
            </div>
            {!apiProfiles.length ? (
              <p className="flex items-center gap-2 text-xs text-status-warning"><Plug className="h-3.5 w-3.5" aria-hidden="true" />No connections yet. Add one in Settings, under Connections.</p>
            ) : (!apiProfileId || !model) ? (
              <p className="flex items-center gap-2 text-xs text-status-warning"><Plug className="h-3.5 w-3.5" aria-hidden="true" />Without a connection and a model this profile can't reply.</p>
            ) : (
              <span className="caption">{apiLabel}</span>
            )}
          </section>

          <section className="flex flex-col gap-3.5">
            <div className="flex items-center gap-2">
              <h3 className="flex-1 text-sm font-bold text-text-primary">Generation</h3>
              <span className="caption">Custom JSON</span>
              <Toggle checked={manualMode} onChange={setManualMode} ariaLabel="Custom JSON" />
            </div>
            {!manualMode ? (
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <div className="mb-1.5 flex justify-between">
                    <label htmlFor="profile-temperature" className="text-sm font-medium text-text-secondary">Temperature</label>
                    <span className="text-sm tabular-nums text-text-primary">{temperature}</span>
                  </div>
                  <input
                    id="profile-temperature"
                    type="range"
                    min="0"
                    max="2"
                    step="0.1"
                    value={temperature}
                    onChange={e => setTemperature(parseFloat(e.target.value))}
                    className="mt-2 w-full cursor-pointer accent-text-secondary"
                  />
                </div>
                <div>
                  <label htmlFor="profile-max-tokens" className="mb-1.5 block text-sm font-medium text-text-secondary">Max reply tokens</label>
                  <NumberInput
                    id="profile-max-tokens"
                    value={maxTokens}
                    onChange={setMaxTokens}
                    min={64}
                    max={200000}
                    step={256}
                    className="min-h-9 w-full rounded-control border border-border-default bg-surface-input px-3 text-sm tabular-nums text-text-secondary focus:border-accent focus:outline-none"
                  />
                </div>
              </div>
            ) : (
              <Textarea
                hint="Raw JSON properties added to the API request."
                value={manualJson}
                onChange={e => setManualJson(e.target.value)}
                rows={4}
                monospace
                placeholder={`{\n  "presence_penalty": 0.5,\n  "top_p": 0.9\n}`}
              />
            )}
          </section>
        </div>

        <div className="flex min-h-[28rem] min-w-0 flex-1 flex-col px-6 pb-5">
          <div role="tablist" aria-label="Profile instructions" className="flex shrink-0 border-b border-border-subtle">
            <TabButton active={tab === 'rules'} onClick={() => setTab('rules')}>Behavior and rules</TabButton>
            <TabButton active={tab === 'search'} onClick={() => setTab('search')}>
              Smart search
              {isAgentic && <span className="rounded-full bg-tint/[0.07] px-1.5 py-px text-xs font-medium text-text-secondary">On</span>}
            </TabButton>
          </div>

          {tab === 'rules' ? (
            <PromptEditor
              key="rules"
              value={systemPrompt}
              onChange={setSystemPrompt}
              variables={variables}
              caption="How this profile writes: voice, rules, format."
              placeholder="Edit the selected text for clarity and rhythm. Keep the author's voice, names and facts exactly as written. Return only the edited text."
            />
          ) : (
            <div className="mt-4 flex min-h-0 flex-1 flex-col gap-4">
              <div className="rounded-[0.875rem] border border-border-subtle bg-tint/[0.02] px-4 py-3.5">
                <Toggle
                  checked={isAgentic}
                  onChange={setIsAgentic}
                  label="Search before replying"
                  description="The AI reads the conversation and writes its own searches through Memory, Worldbuild and this profile's knowledge base, instead of matching your message word for word."
                />
              </div>
              {isAgentic ? (
                <>
                  <div className="flex flex-wrap items-center gap-4 px-0.5">
                    <div className="min-w-0 flex-1">
                      <span className="block text-sm font-bold text-text-secondary">Search rounds</span>
                      <p className="caption mt-1">One round is a search and a look at what came back. 1 is cheapest, 3 is balanced, more follows leads further and costs more.</p>
                    </div>
                    <SegmentedControl label="Search rounds" value={agenticMaxTurns} onChange={setAgenticMaxTurns} options={ROUNDS} />
                  </div>
                  <PromptEditor
                    key="search"
                    title="Search instructions"
                    value={agenticPrompt}
                    onChange={setAgenticPrompt}
                    variables={variables}
                    caption="Tells the search step what to look for. The reply itself still follows Behavior and rules."
                    placeholder="Find the passages where the selected characters and places appear, so the edit keeps every fact consistent."
                  />
                </>
              ) : (
                <p className="caption max-w-lg px-0.5 leading-relaxed">
                  Off: retrieval runs a plain similarity search against your message text. Turn it on to let the AI write its own searches.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      <footer className="flex shrink-0 items-center gap-2.5 border-t border-border-subtle px-6 py-3.5">
        {isEditing && onDelete && (
          <Button variant="subtle" icon={Trash2} className="!text-status-danger hover:!bg-status-danger/10" onClick={() => onDelete(profile)}>Delete</Button>
        )}
        <span className="flex-1" />
        <Button variant="subtle" onClick={onClose}>Cancel</Button>
        <Button data-tour="profile-save" onClick={handleSave} disabled={!name.trim()}>Save profile</Button>
      </footer>
    </Modal>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`relative mr-6 inline-flex h-[3.25rem] items-center gap-2 px-0.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${active ? 'text-text-primary' : 'text-text-subtle hover:text-text-secondary'}`}
    >
      {children}
      {active && <span aria-hidden="true" className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-accent" />}
    </button>
  );
}

// A prompt field with Write / Preview, {{variable}} autocomplete and an expanded preview.
function PromptEditor({ title, value, onChange, variables, caption, placeholder }) {
  const [mode, setMode] = useState('editor');
  const [ac, setAc] = useState({ isOpen: false, search: '', triggerIndex: -1 });
  const [acIndex, setAcIndex] = useState(0);
  const textareaRef = useRef(null);

  const closeAc = () => {
    setAc({ isOpen: false, search: '', triggerIndex: -1 });
    setAcIndex(0);
  };

  const handleChange = (e) => {
    const next = e.target.value;
    onChange(next);
    const before = next.substring(0, e.target.selectionStart);
    const open = before.lastIndexOf('{{');
    if (open !== -1 && open > before.lastIndexOf('}}')) {
      const search = before.substring(open + 2);
      if (!/\s/.test(search)) {
        setAc({ isOpen: true, search, triggerIndex: open });
        setAcIndex(0);
        return;
      }
    }
    closeAc();
  };

  const matches = variables.filter(v => v.key.toLowerCase().includes(ac.search.toLowerCase()));

  const insertVariable = (variable) => {
    const area = textareaRef.current;
    if (!variable || !area) return;
    const before = value.substring(0, ac.triggerIndex);
    const inserted = `{{${variable.key}}}`;
    onChange(before + inserted + value.substring(area.selectionStart));
    closeAc();
    setTimeout(() => {
      area.focus();
      const pos = before.length + inserted.length;
      area.setSelectionRange(pos, pos);
    }, 50);
  };

  const handleKeyDown = (e) => {
    if (!ac.isOpen || !matches.length) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); setAcIndex(i => (i + 1) % matches.length); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setAcIndex(i => (i - 1 + matches.length) % matches.length); }
    else if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); insertVariable(matches[acIndex]); }
    else if (e.key === 'Escape') { e.preventDefault(); closeAc(); }
  };

  const preview = useMemo(() => {
    if (!value) return '<p class="caption italic">Nothing written yet.</p>';
    return parseMarkdown(value).replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key) => {
      const found = variables.find(v => v.key === key);
      if (!found) return `<span class="inline-flex items-center rounded px-2 py-0.5 text-xs font-semibold bg-status-danger/10 text-status-danger border border-status-danger/30">{{${key}}} not found</span>`;
      return `<div class="my-3 overflow-hidden rounded-lg border border-border-subtle bg-surface-input"><div class="border-b border-border-subtle px-3 py-1.5 font-mono text-xs text-text-muted">{{${key}}}</div><div class="whitespace-pre-wrap p-3 font-mono text-xs leading-relaxed text-text-secondary">${escapeHTML(found.value)}</div></div>`;
    });
  }, [value, variables]);

  return (
    <div className="mt-3.5 flex min-h-0 flex-1 flex-col gap-3">
      <div className="flex items-center gap-2.5">
        {title ? <h3 className="flex-1 text-sm font-bold text-text-primary">{title}</h3> : <span className="caption flex-1">{caption}</span>}
        <SegmentedControl label="Editor mode" value={mode} onChange={(next) => { setMode(next); closeAc(); }} options={MODES} />
      </div>
      {mode === 'editor' ? (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <textarea
            ref={textareaRef}
            value={value}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            className="min-h-[14rem] flex-1 resize-none rounded-xl border border-border-default bg-surface-input p-4 font-mono text-[0.8125rem] leading-[1.7] text-text-secondary custom-scrollbar placeholder:text-text-subtle focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
          />
          {ac.isOpen && matches.length > 0 && (
            <Popover anchorRef={textareaRef} open onClose={closeAc} maxHeight={200} scroll={false} className="p-1.5">
              <div className="max-h-48 overflow-y-auto custom-scrollbar">
                {matches.map((v, idx) => (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => insertVariable(v)}
                    className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-1.5 text-left text-xs transition-colors ${idx === acIndex ? 'bg-surface-hover text-text-primary' : 'text-text-secondary hover:bg-surface-hover/60'}`}
                  >
                    <span className="font-mono font-semibold">{`{{${v.key}}}`}</span>
                    <span className="truncate text-text-subtle">{v.name}</span>
                  </button>
                ))}
              </div>
            </Popover>
          )}
        </div>
      ) : (
        <div
          className="markdown-body min-h-[14rem] flex-1 overflow-y-auto rounded-xl border border-border-default bg-surface-input p-4 text-sm leading-relaxed text-text-secondary custom-scrollbar select-text"
          dangerouslySetInnerHTML={{ __html: preview }}
        />
      )}
      <div className="flex items-center gap-3">
        {title && caption && <span className="caption">{caption}</span>}
        <span className="caption ml-auto">Type <span className="font-mono text-text-secondary">{'{{'}</span> to insert a variable.</span>
      </div>
    </div>
  );
}
