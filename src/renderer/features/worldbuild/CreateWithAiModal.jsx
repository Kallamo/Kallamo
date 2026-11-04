import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, FileText, GitMerge, Info, Loader2, Lock, Plus, Search, Sparkles, Upload, UserRound, BookOpen, X } from 'lucide-react';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import Checkbox from '../../components/ui/Checkbox';
import SelectMenu from '../../components/ui/SelectMenu';
import SearchableSelect from '../../components/ui/SearchableSelect';
import Toggle from '../../components/ui/Toggle';
import { RadioCard, ToneTile, megabytes } from '../../components/modals/ModalParts';
import { TYPE_ORDER, meta as typeMeta } from './worldbuildConfig';

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const thousands = value => (value >= 1000 ? `${Math.round(value / 100) / 10}k` : String(value));
const FIELD = 'min-h-10 w-full rounded-control border border-border-default bg-surface-input/90 px-3 py-2 text-sm text-text-primary placeholder:text-text-subtle focus:border-accent/70 focus:outline-none focus:ring-2 focus:ring-accent/20';
const TYPE_OPTIONS = TYPE_ORDER.map(type => ({ value: type, label: typeMeta(type).label }));
// The underline under a name in a passage takes its type's color, as entity links do in the Writing Desk.
const TYPE_COLOR = {
  Characters: 'character', Locations: 'location', Factions: 'faction', Events: 'event', Items: 'item',
  Creatures: 'creature', Races: 'race', System: 'concept',
};
const STEPS = [['sources', 'Sources'], ['review', 'Review'], ['estimate', 'Fill']];

function Stepper({ step, labels }) {
  const current = STEPS.findIndex(([key]) => key === step);
  return (
    <ol aria-label="Steps" className="mr-2 flex items-center gap-2 text-[0.8125rem]">
      {STEPS.map(([key, label], index) => {
        const done = index < current;
        const active = index === current;
        return (
          <li key={key} className="flex items-center gap-2" aria-current={active ? 'step' : undefined}>
            {index > 0 && <span aria-hidden="true" className="h-px w-5 bg-border-default" />}
            <span className={`inline-flex h-[1.375rem] w-[1.375rem] items-center justify-center rounded-full text-xs tabular-nums ${active ? 'border-[1.5px] border-accent font-semibold text-accent' : done ? 'bg-tint/[0.08] text-text-secondary' : 'border border-border-default text-text-subtle'}`}>
              {done ? <Check className="h-3 w-3" aria-hidden="true" /> : index + 1}
            </span>
            {(labels || active)
              ? <span className={`whitespace-nowrap ${active ? 'font-semibold text-text-primary' : done ? 'text-text-muted' : 'text-text-subtle'}`}>{label}</span>
              : <span className="sr-only">{label}</span>}
          </li>
        );
      })}
    </ol>
  );
}

function TypeMedallion({ type, size = 'sm' }) {
  const t = typeMeta(type);
  const Icon = t.icon;
  const box = { sm: 'h-[1.875rem] w-[1.875rem] rounded-md', lg: 'h-11 w-11 rounded-[0.6875rem]' }[size];
  const icon = size === 'lg' ? 'h-5 w-5' : 'h-3.5 w-3.5';
  return type
    ? <span aria-hidden="true" className={`inline-flex ${box} shrink-0 items-center justify-center border ${t.medallion}`}><Icon className={icon} /></span>
    : <span aria-hidden="true" className={`inline-flex ${box} shrink-0 items-center justify-center border border-status-warning/40 text-status-warning`}><Info className={icon} /></span>;
}

function TypeDots({ counts, extra = null }) {
  const shown = TYPE_ORDER.filter(type => counts?.[type] > 0);
  if (!shown.length && !extra) return null;
  return (
    <div className="flex flex-wrap gap-x-[1.125rem] gap-y-2 text-[0.8125rem] text-text-secondary">
      {shown.map(type => (
        <span key={type} className="inline-flex items-center gap-2 whitespace-nowrap">
          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${typeMeta(type).dot}`} />
          {counts[type]} {(counts[type] === 1 ? typeMeta(type).label : typeMeta(type).plural).toLowerCase()}
        </span>
      ))}
      {extra && <span className="inline-flex items-center gap-2 whitespace-nowrap"><span aria-hidden="true" className="h-2 w-2 rounded-full bg-text-subtle" />{extra}</span>}
    </div>
  );
}

function sourceLine(source) {
  if (source.kind === 'card') {
    const parts = ['SillyTavern card', megabytes(source.size)];
    if (source.portrait) parts.push('with portrait');
    if (source.entries) parts.push(plural(source.entries, 'lorebook entry', 'lorebook entries'));
    return { icon: UserRound, tone: typeMeta('Characters').medallion, detail: parts.join(' · '), aside: '1 character' };
  }
  if (source.kind === 'lorebook') {
    return { icon: BookOpen, detail: `Lorebook · ${megabytes(source.size)}`, aside: plural(source.entries, 'entry', 'entries') };
  }
  return { icon: FileText, detail: `Text · ${megabytes(source.size)}`, aside: plural(source.passages || 0, 'passage', 'passages') };
}

function SourceRow({ source, onRemove }) {
  const line = source.error ? null : sourceLine(source);
  const Icon = line?.icon || FileText;
  return (
    <div className="flex items-center gap-3.5 border-t border-border-subtle px-1 py-3 last:border-b">
      <span aria-hidden="true" className={`inline-flex h-[2.125rem] w-[2.125rem] shrink-0 items-center justify-center rounded-lg border ${line?.tone || 'border-border-subtle bg-tint/[0.04] text-text-muted'}`}><Icon className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-text-primary">{source.fileName}</p>
        <p className={`mt-0.5 truncate text-xs ${source.error ? 'text-status-danger' : 'text-text-subtle'}`}>{source.error || line.detail}</p>
      </div>
      {line && <span className="shrink-0 whitespace-nowrap text-[0.8125rem] text-text-muted">{line.aside}</span>}
      {onRemove && (
        <button type="button" aria-label={`Remove ${source.fileName}`} onClick={onRemove}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-text-subtle transition-colors hover:bg-surface-hover/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      )}
    </div>
  );
}

function SourcesStep({ electronAPI, sources, setSources, showToast }) {
  const [pasting, setPasting] = useState(false);
  const [pasteText, setPasteText] = useState('');
  const [dragging, setDragging] = useState(false);
  const [adding, setAdding] = useState(false);
  const add = async (request) => {
    setAdding(true);
    try {
      const result = await request();
      if (result?.success === false) showToast(result.error || 'Could not add these sources.', 'error');
      else if (result?.sources?.length) setSources(current => [...current, ...result.sources]);
    } finally { setAdding(false); }
  };
  const remove = (key) => {
    electronAPI.discardImportSources?.([key]);
    setSources(current => current.filter(source => source.key !== key));
  };
  const valid = sources.filter(source => !source.error);
  const passageCount = valid.reduce((sum, source) => sum + (source.passages || 0), 0);
  // The size of the text itself, not what the Tagger will spend: its prompt and reply come on top.
  const tokenCount = valid.reduce((sum, source) => sum + (source.tokens || 0), 0);

  return (
    <div className="custom-scrollbar flex min-h-0 flex-col gap-[1.375rem] overflow-y-auto px-[1.625rem] py-6">
      <p className="text-sm leading-relaxed text-text-secondary">Add what you already have. Kallamo lists the characters, places and things it finds, and nothing is written to your world until you approve the list.</p>
      <div
        onDragOver={event => { event.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={event => { event.preventDefault(); setDragging(false); const files = [...event.dataTransfer.files]; if (files.length) add(() => electronAPI.inspectImportSources({ files })); }}
        className={`flex items-center gap-4 rounded-card border border-dashed px-5 py-[1.125rem] transition-colors ${dragging ? 'border-accent/60 bg-accent/5' : 'border-border-strong bg-tint/[0.03]'}`}
      >
        {adding ? <Loader2 className="h-5 w-5 shrink-0 animate-spin text-text-muted" aria-hidden="true" /> : <Upload className="h-5 w-5 shrink-0 text-text-muted" aria-hidden="true" />}
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-text-primary">Drop files here</p>
          <p className="mt-0.5 text-balance text-xs text-text-subtle">SillyTavern cards and lorebooks, text, Markdown, Word or PDF</p>
        </div>
        <Button variant="ghost" size="sm" disabled={adding} onClick={() => add(() => electronAPI.pickImportSources())}>Choose files</Button>
        <Button variant="ghost" size="sm" disabled={adding} aria-expanded={pasting} onClick={() => setPasting(open => !open)}>Paste text</Button>
      </div>
      {pasting && (
        <div className="space-y-2">
          <textarea value={pasteText} onChange={event => setPasteText(event.target.value)} rows={5} aria-label="Pasted text" placeholder="Notes, a wiki page, a chapter…" className={`${FIELD} resize-y leading-relaxed`} />
          <div className="flex justify-end gap-2">
            <Button variant="subtle" size="sm" onClick={() => { setPasting(false); setPasteText(''); }}>Cancel</Button>
            <Button size="sm" icon={Plus} disabled={!pasteText.trim() || adding} onClick={async () => {
              const text = pasteText;
              await add(() => electronAPI.inspectImportSources({ pasted: { name: `Pasted text ${sources.filter(source => source.fileName.startsWith('Pasted text')).length + 1}`, text } }));
              setPasteText(''); setPasting(false);
            }}>Add text</Button>
          </div>
        </div>
      )}
      {sources.length > 0 && (
        <div>
          <div className="flex items-baseline justify-between px-1 pb-2.5">
            <p className="text-[0.8125rem] font-semibold text-text-primary">{plural(valid.length, 'source', 'sources')}</p>
            <p className="text-xs text-text-subtle">{plural(passageCount, 'passage', 'passages')} · about {thousands(tokenCount)} tokens of text</p>
          </div>
          {sources.map(source => <SourceRow key={source.key} source={source} onRemove={() => remove(source.key)} />)}
        </div>
      )}
      {valid.some(source => source.kind === 'card') && (
        <p className="text-xs leading-relaxed text-text-subtle">From a card, only the description and personality are read: its scenario and opening message set up one roleplay, not the world.</p>
      )}
    </div>
  );
}

function ReadingStep({ sources, progress }) {
  const percent = progress?.total ? Math.round((progress.done / progress.total) * 100) : 0;
  return (
    <div className="flex flex-col gap-5 px-[1.625rem] py-6">
      <div className="space-y-2.5">
        <div className="flex items-baseline justify-between gap-3">
          <p className="text-sm font-semibold text-text-primary">Listing what is in your sources</p>
          {progress?.total ? <p className="text-xs tabular-nums text-text-muted">{progress.done} of {plural(progress.total, 'passage', 'passages')}</p> : null}
        </div>
        <div role="progressbar" aria-label="Reading progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-1.5 overflow-hidden rounded-full bg-tint/10">
          <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${percent}%` }} />
        </div>
        <p className="text-xs text-text-subtle">Only names and types for now. Sheets are filled later, from what you keep.</p>
      </div>
      <div>{sources.map(source => <SourceRow key={source.key} source={source} />)}</div>
    </div>
  );
}

function Chip({ tone, children }) {
  const styles = {
    match: 'border-status-info/40 text-status-info',
    off: 'border-border-subtle text-text-subtle',
    quiet: 'border-border-default text-text-muted',
    warn: 'border-status-warning/40 text-status-warning',
  };
  return <span className={`inline-flex h-[1.375rem] shrink-0 items-center whitespace-nowrap rounded-full border px-2.5 text-xs font-medium ${styles[tone]}`}>{children}</span>;
}

// New is the usual case, so only what asks for attention gets a chip.
function candidateChip(item) {
  if (!item.keep) return <Chip tone="off">Left out</Chip>;
  if (!item.type) return <Chip tone="warn">Needs a type</Chip>;
  if (item.targetId) return <Chip tone="match">In your world</Chip>;
  if (!item.fill) return <Chip tone="quiet">Name only</Chip>;
  return null;
}

const FILTERS = [
  ['all', 'All', () => true],
  ['new', 'New', item => item.keep && item.type && !item.targetId],
  ['world', 'In your world', item => item.keep && Boolean(item.targetId)],
  ['untyped', 'Needs a type', item => !item.type],
  ['out', 'Left out', item => !item.keep],
];

function AliasEditor({ aliases, merged, onChange }) {
  const [draft, setDraft] = useState('');
  const commit = () => {
    const value = draft.trim();
    if (value && !aliases.some(alias => alias.toLowerCase() === value.toLowerCase())) onChange([...aliases, value]);
    setDraft('');
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {aliases.map(alias => {
        const fromMerge = merged.has(alias.toLowerCase());
        return (
          <span key={alias} className={`inline-flex h-7 items-center gap-1.5 whitespace-nowrap rounded-full border pl-3 pr-1 text-[0.8125rem] ${fromMerge ? 'border-status-info/45 bg-status-info/[0.08] text-text-primary' : 'border-border-default text-text-secondary'}`}>
            {fromMerge && <GitMerge className="h-3.5 w-3.5 text-status-info" aria-label="From a merge" />}
            {alias}
            <button type="button" aria-label={`Remove alias ${alias}`} onClick={() => onChange(aliases.filter(item => item !== alias))}
              className="inline-flex h-5 w-5 items-center justify-center rounded-full text-text-subtle hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
              <X className="h-3 w-3" aria-hidden="true" />
            </button>
          </span>
        );
      })}
      <input value={draft} onChange={event => setDraft(event.target.value)} onBlur={commit}
        onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); commit(); } }}
        aria-label="Add alias" placeholder="Add alias"
        className="h-7 w-28 rounded-full border border-dashed border-border-strong bg-transparent px-3 text-[0.8125rem] text-text-primary placeholder:text-text-muted focus:border-accent/70 focus:outline-none" />
    </div>
  );
}

const escapeRegExp = value => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// Every name the entry goes by is underlined where the passage uses it.
function MarkedText({ text, names, color }) {
  const usable = [...new Set(names.map(name => name.trim()).filter(name => name.length > 1))].sort((a, b) => b.length - a.length);
  if (!usable.length) return text;
  const pattern = new RegExp(`(${usable.map(escapeRegExp).join('|')})`, 'gi');
  return String(text).split(pattern).map((part, index) => (index % 2
    ? <span key={index} className="text-text-primary underline decoration-[1.5px] underline-offset-[3px]" style={{ textDecorationColor: color }}>{part}</span>
    : part));
}

function FormRow({ label, hint = null, children }) {
  return (
    <div className="grid grid-cols-[9.375rem_minmax(0,1fr)] gap-5 border-t border-border-subtle py-[1.125rem]">
      <div>
        <p className="text-[0.8125rem] font-semibold text-text-primary">{label}</p>
        {hint && <p className="mt-1 text-xs leading-relaxed text-text-subtle">{hint}</p>}
      </div>
      <div className="min-w-0">{children}</div>
    </div>
  );
}

function CandidateDetail({ item, items, passages, onChange, onMerge, onSeparate }) {
  const t = typeMeta(item.type);
  const matchFits = item.match && item.match.type === item.type;
  const merged = item.merged || [];
  const mergedNames = new Set(merged.flatMap(entry => [entry.name, ...entry.aliases]).map(name => name.toLowerCase()));
  // A passage only a merged entry brought says whose it was.
  const ownPassages = new Set(item.original ? item.original.passageIds : item.passageIds);
  const broughtBy = new Map();
  for (const entry of merged) for (const id of entry.passageIds) if (!ownPassages.has(id) && !broughtBy.has(id)) broughtBy.set(id, entry.name);
  const shown = item.passageIds.slice(0, 5).map(id => passages.get(id)).filter(Boolean);
  const color = `var(--theme-entity-${TYPE_COLOR[item.type] || 'concept'})`;
  const names = [item.name, ...item.aliases];
  const mergeOptions = items
    .filter(other => other.id !== item.id)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(other => ({
      id: other.id,
      label: other.name || 'Unnamed',
      aliases: other.aliases,
      icon: other.type ? typeMeta(other.type).icon : Info,
      iconClassName: other.type ? typeMeta(other.type).soft : 'text-status-warning',
      description: [other.type ? typeMeta(other.type).label : 'Needs a type', other.targetId ? 'in your world' : null].filter(Boolean).join(' · '),
    }));

  return (
    <div className="custom-scrollbar flex min-w-0 flex-1 flex-col overflow-y-auto px-7 pb-4 pt-[1.375rem]">
      <div className="flex items-center gap-3.5 pb-[1.125rem]">
        <TypeMedallion type={item.type} size="lg" />
        <label className="min-w-0 flex-1">
          <span className="sr-only">Name</span>
          <input value={item.name} onChange={event => onChange({ name: event.target.value })} placeholder="Name"
            className="h-11 w-full rounded-control border border-transparent bg-transparent px-3 text-[1.375rem] font-semibold text-text-primary placeholder:text-text-subtle hover:border-border-subtle focus:border-accent/70 focus:outline-none focus:ring-2 focus:ring-accent/20" />
        </label>
        <div className="w-48 shrink-0">
          <SelectMenu ariaLabel="Type" value={item.type || ''} options={item.type ? TYPE_OPTIONS : [{ value: '', label: 'Choose a type' }, ...TYPE_OPTIONS]}
            onChange={type => onChange({ type: type || null, targetId: item.match && item.match.type === type ? item.targetId : null })} />
        </div>
      </div>

      {matchFits && (
        <FormRow label="In your world">
          <div role="radiogroup" aria-label="Where it goes" className="space-y-2">
            <RadioCard name={`target-${item.id}`} selected={Boolean(item.targetId)} onSelect={() => onChange({ targetId: item.match.id })}
              title={`Add to ${item.match.name}`} description="Its sheet gets suggestions from these sources, reviewed like any update." />
            <RadioCard name={`target-${item.id}`} selected={!item.targetId} onSelect={() => onChange({ targetId: null })}
              title={`Create a new ${t.label.toLowerCase()}`} description="Keeps both. You can merge them later." />
          </div>
        </FormRow>
      )}

      <FormRow label="Fill the sheet">
        <div className="flex items-start gap-3">
          <Toggle checked={item.fill} onChange={fill => onChange({ fill })} ariaLabel="Fill the sheet from the sources" />
          <p className="text-[0.8125rem] leading-relaxed text-text-muted">
            {item.fill
              ? `The AI reads ${item.passageIds.length === 1 ? 'the passage' : `the ${item.passageIds.length} passages`} below and suggests fields, links and lore.`
              : 'Created with its name only. The sources are not kept after the import, so turn this on when the passages really describe it.'}
          </p>
        </div>
      </FormRow>

      <FormRow label="Aliases">
        <AliasEditor aliases={item.aliases} merged={mergedNames} onChange={aliases => onChange({ aliases })} />
      </FormRow>

      <FormRow label="Same as" hint="When two entries are one">
        <div className="space-y-2.5">
          {merged.length > 0 && (
            <div className="flex items-center gap-3">
              <p className="min-w-0 flex-1 text-[0.8125rem] leading-relaxed text-text-secondary">
                <span className="font-semibold text-text-primary">{merged.map(entry => entry.name).join(', ')}</span> {merged.length === 1 ? 'was' : 'were'} merged here: {merged.length === 1 ? 'its name is an alias and its passages are' : 'their names are aliases and their passages are'} read with these.
              </p>
              <Button variant="ghost" size="sm" onClick={onSeparate}>Separate</Button>
            </div>
          )}
          {mergeOptions.length > 0 && (
            <SearchableSelect searchInTrigger clearable={false} value="" options={mergeOptions} ariaLabel="Merge into another entry"
              placeholder="Merge into another entry" searchPlaceholder="Search the list" emptyMessage="No entry with that name."
              onChange={intoId => { if (intoId) onMerge(intoId); }} />
          )}
        </div>
      </FormRow>

      <FormRow label="Where it comes from" hint={plural(item.passageIds.length, 'passage', 'passages')}>
        <div className="space-y-3.5">
          {shown.map(passage => (
            <div key={passage.id}>
              <p className="mb-1 flex min-w-0 items-center gap-2 text-xs font-semibold text-text-subtle">
                <span className="truncate">{passage.label ? `${passage.fileName} · ${passage.label}` : passage.fileName}</span>
                {broughtBy.has(passage.id) && <Chip tone="match">from {broughtBy.get(passage.id)}</Chip>}
              </p>
              <p className="line-clamp-4 whitespace-pre-line text-[0.8125rem] leading-relaxed text-text-secondary"><MarkedText text={passage.text} names={names} color={color} /></p>
            </div>
          ))}
          {item.passageIds.length > shown.length && <p className="text-xs text-text-subtle">And {plural(item.passageIds.length - shown.length, 'more passage', 'more passages')}.</p>}
        </div>
      </FormRow>
    </div>
  );
}

function ReviewStep({ items, setItems, passages, notes }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState(items[0]?.id || null);
  const needle = search.trim().toLowerCase();
  const test = (FILTERS.find(([key]) => key === filter) || FILTERS[0])[2];
  const visible = items.filter(item => test(item) && (!needle || [item.name, ...item.aliases].some(name => name.toLowerCase().includes(needle))));
  const groups = [...TYPE_ORDER, null]
    .map(type => ({ type, items: visible.filter(item => (item.type || null) === type) }))
    .filter(group => group.items.length);
  const selected = items.find(item => item.id === selectedId) || null;
  const update = (id, change) => setItems(current => current.map(item => item.id === id ? { ...item, ...change } : item));
  const setKeep = (ids, keep) => setItems(current => current.map(item => ids.has(item.id) ? { ...item, keep } : item));
  // The entry merged away becomes aliases of the one kept; the state before the first merge is
  // kept too, so Separate gives both entries back as they were.
  const merge = (sourceId, intoId) => {
    setItems(current => {
      const source = current.find(item => item.id === sourceId);
      const into = current.find(item => item.id === intoId);
      if (!source || !into) return current;
      const { original: _o, merged: _m, ...plainInto } = into;
      const names = [source.name, ...source.aliases].map(name => name.trim()).filter(Boolean);
      const aliases = [...into.aliases];
      for (const name of names) {
        if (name.toLowerCase() !== into.name.trim().toLowerCase() && !aliases.some(alias => alias.toLowerCase() === name.toLowerCase())) aliases.push(name);
      }
      const joined = {
        ...into,
        aliases,
        passageIds: [...new Set([...into.passageIds, ...source.passageIds])],
        sources: [...new Set([...(into.sources || []), ...(source.sources || [])])],
        fill: into.fill || source.fill,
        keep: true,
        original: into.original || plainInto,
        merged: [...(into.merged || []), source],
      };
      return current.filter(item => item.id !== sourceId).map(item => item.id === intoId ? joined : item);
    });
    setSelectedId(intoId);
  };
  const separate = (id) => setItems(current => {
    const item = current.find(entry => entry.id === id);
    if (!item?.original) return current;
    return current.flatMap(entry => entry.id === id ? [item.original, ...item.merged] : [entry]);
  });

  if (!items.length) {
    return (
      <div className="flex flex-col items-center gap-2 px-6 py-16 text-center">
        <p className="text-sm font-semibold text-text-primary">Nothing to add was found</p>
        <p className="max-w-md text-sm leading-relaxed text-text-muted">{notes || 'The sources did not name any character, place or thing the Tagger could list.'}</p>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-1">
      <div className="flex w-[23.75rem] shrink-0 flex-col border-r border-border-subtle bg-surface-rail/60">
        <div className="space-y-3 px-4 pb-2.5 pt-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-subtle" aria-hidden="true" />
            <input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search names and aliases" aria-label="Search names and aliases" className={`${FIELD} pl-9`} />
          </div>
          <div role="tablist" aria-label="Show" className="flex flex-wrap gap-1.5">
            {FILTERS.map(([key, label, match]) => {
              const count = items.filter(match).length;
              if (key !== 'all' && !count) return null;
              const active = filter === key;
              return (
                <button key={key} type="button" role="tab" aria-selected={active} onClick={() => setFilter(key)}
                  className={`h-7 whitespace-nowrap rounded-full border px-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${active ? 'border-accent/45 bg-accent/[0.12] font-semibold text-accent' : key === 'untyped' ? 'border-status-warning/35 font-medium text-status-warning hover:bg-surface-hover/50' : 'border-border-subtle font-medium text-text-secondary hover:bg-surface-hover/50'}`}>
                  {label} <span className="tabular-nums">{count}</span>
                </button>
              );
            })}
          </div>
          {notes && <p className="flex items-start gap-2 text-xs leading-relaxed text-status-warning"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{notes}</p>}
        </div>
        <div className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {!groups.length && <p className="px-3 py-6 text-center text-[0.8125rem] text-text-subtle">Nothing here matches.</p>}
          {groups.map(group => {
            const ids = new Set(group.items.map(item => item.id));
            const allKept = group.items.every(item => item.keep);
            return (
              <div key={group.type || 'untyped'}>
                <div className="flex items-center justify-between px-3 pb-1.5 pt-3.5">
                  <p className="text-xs font-semibold text-text-muted">{group.type ? typeMeta(group.type).plural : 'Needs a type'} <span className="font-medium tabular-nums text-text-subtle">{group.items.length}</span></p>
                  <button type="button" onClick={() => setKeep(ids, !allKept)} className="rounded-md px-1.5 py-0.5 text-xs text-text-subtle hover:bg-surface-hover/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">{allKept ? 'Keep none' : 'Keep all'}</button>
                </div>
                {group.items.map(item => {
                  const sourceCount = item.sources?.length || 0;
                  const detail = [sourceCount ? plural(sourceCount, 'source', 'sources') : null, plural(item.passageIds.length, 'passage', 'passages'), item.merged?.length ? `${item.merged.length} merged` : null].filter(Boolean).join(' · ');
                  return (
                    <div key={item.id} className={`flex items-center gap-3 rounded-[0.625rem] px-3 py-2 ${item.id === selectedId ? 'bg-surface-hover ring-1 ring-inset ring-border-strong' : 'hover:bg-surface-hover/50'}`}>
                      <Checkbox size="sm" checked={item.keep} ariaLabel={`Keep ${item.name}`} onChange={keep => update(item.id, { keep })} />
                      <button type="button" onClick={() => setSelectedId(item.id)} className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline-none">
                        <span className={item.keep ? '' : 'opacity-55'}><TypeMedallion type={item.type} /></span>
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className={`truncate text-[0.8125rem] ${item.keep ? 'font-semibold text-text-primary' : 'font-medium text-text-subtle'}`}>{item.name || 'Unnamed'}</span>
                          <span className="truncate text-xs text-text-subtle">{detail}</span>
                        </span>
                        {candidateChip(item)}
                      </button>
                    </div>
                  );
                })}
              </div>
            );
          })}
        </div>
      </div>
      {selected
        ? <CandidateDetail key={selected.id} item={selected} items={items} passages={passages} onChange={change => update(selected.id, change)}
            onMerge={intoId => merge(selected.id, intoId)} onSeparate={() => separate(selected.id)} />
        : <div className="flex flex-1 items-center justify-center text-sm text-text-subtle">Choose an entry to see where it comes from.</div>}
    </div>
  );
}

function EstimateStep({ items, estimate }) {
  const counts = {};
  for (const item of items) counts[item.type] = (counts[item.type] || 0) + 1;
  for (const name of estimate?.locked || []) {
    const item = items.find(entry => entry.targetId && entry.match?.name === name);
    if (item) counts[item.type] -= 1;
  }
  if (!estimate) {
    return <p className="flex items-center gap-2 px-[1.625rem] py-8 text-[0.8125rem] text-text-muted"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Working it out…</p>;
  }
  const created = estimate.sheets - estimate.existing;
  const lands = [
    estimate.existing ? `${plural(estimate.existing, 'sheet you have gets', 'sheets you have get')} suggestions to review.` : null,
    created ? `${plural(created, 'new sheet is', 'new sheets are')} created and filled.` : null,
  ].filter(Boolean).join(' ');
  const rows = [
    ['Model', `System AI · ${estimate.model || 'not set'}`],
    ['Passages read', `${estimate.passages} from your sources`],
    ...(lands ? [['Where it lands', lands]] : []),
  ];
  return (
    <div className="flex flex-col gap-6 px-[1.625rem] pb-[1.375rem] pt-[1.625rem]">
      <div>
        <p className="text-[2rem] font-semibold leading-tight tracking-[-0.01em] text-text-primary tabular-nums">{plural(estimate.sheets, 'sheet', 'sheets')}</p>
        <p className="mt-0.5 text-[0.8125rem] text-text-muted">filled from your sources, one request each</p>
      </div>
      <TypeDots counts={counts} extra={estimate.unfilled > 0 ? `${estimate.unfilled} name only, at no cost` : null} />
      <dl>
        {rows.map(([label, value]) => (
          <div key={label} className="grid grid-cols-[8.75rem_minmax(0,1fr)] gap-4 border-t border-border-subtle py-3 text-sm last:border-b">
            <dt className="text-text-muted">{label}</dt>
            <dd className="leading-relaxed text-text-primary">{value}</dd>
          </div>
        ))}
      </dl>
      {(estimate.locked || []).map(name => (
        <p key={name} className="flex items-center gap-2.5 text-[0.8125rem] leading-relaxed text-text-secondary">
          <Lock className="h-4 w-4 shrink-0 text-status-warning" aria-hidden="true" /><span><b className="font-semibold text-text-primary">{name}</b> is locked and will be skipped.</span>
        </p>
      ))}
      <p className="text-xs leading-relaxed text-text-subtle">The tokens used show when the fill ends.</p>
    </div>
  );
}

const flattenMerged = item => (item.merged || []).flatMap(entry => [entry.id, ...flattenMerged(entry)]);

/** Sources in, a list to approve, an estimate, then the fill runs as an entity update. */
export default function CreateWithAiModal({ electronAPI, workspaceId, workspaceName = null, hasSystemAi, updating = false, showToast, onClose, onFill }) {
  const [step, setStep] = useState('sources');
  const [sources, setSources] = useState([]);
  const [progress, setProgress] = useState(null);
  const [found, setFound] = useState(null);
  const [items, setItems] = useState([]);
  const [estimate, setEstimate] = useState(null);
  const [busy, setBusy] = useState(false);
  const readToken = useRef(0);
  const valid = sources.filter(source => !source.error);
  const kept = items.filter(item => item.keep);
  const passages = useMemo(() => new Map((found?.passages || []).map(passage => [passage.id, passage])), [found]);
  const decisions = kept.map(item => ({ id: item.id, name: item.name.trim(), type: item.type, aliases: item.aliases, targetId: item.targetId || null, fill: item.fill, mergedIds: flattenMerged(item) }));

  useEffect(() => electronAPI.onImportSourcesProgress?.(data => { if (data.workspaceId === workspaceId) setProgress(data); }), [electronAPI, workspaceId]);

  const close = () => {
    if (busy) return;
    electronAPI.discardImportSources?.(sources.map(source => source.key), workspaceId);
    onClose();
  };

  const read = async () => {
    const token = ++readToken.current;
    setStep('reading'); setProgress(null);
    const result = await electronAPI.discoverImportSources(workspaceId, valid.map(source => source.key));
    if (token !== readToken.current) return;
    if (!result?.success) { setStep('sources'); showToast(result?.error || 'Could not read the sources.', 'error'); return; }
    setFound(result);
    setItems(result.candidates.map(candidate => ({ ...candidate, targetId: candidate.match?.id || null })));
    setStep('review');
  };

  const toEstimate = async () => {
    setStep('estimate'); setEstimate(null);
    const result = await electronAPI.estimateImportFill(workspaceId, decisions);
    if (result?.success) setEstimate(result);
    else { setStep('review'); showToast(result?.error || 'Could not estimate the fill.', 'error'); }
  };

  const fill = async () => {
    setBusy(true);
    try {
      const result = await electronAPI.applyImportSources(workspaceId, decisions, valid.map(source => source.key));
      if (!result?.success) { showToast(result?.error || 'Could not add these entities.', 'error'); return; }
      onFill(result);
    } finally { setBusy(false); }
  };

  const notes = found
    ? [
        found.taggerMissing ? 'No Tagger is set up, so only cards and lorebook entries were listed.' : null,
        found.failedPassages ? `${plural(found.failedPassages, 'passage', 'passages')} could not be read and added nothing.` : null,
      ].filter(Boolean).join(' ')
    : '';
  const missingName = kept.some(item => !item.name.trim());
  const untyped = kept.filter(item => !item.type).length;
  const matched = kept.filter(item => item.targetId).length;
  const fillable = estimate ? estimate.sheets : kept.filter(item => item.fill).length;
  const stepKey = step === 'reading' ? 'sources' : step;
  const subtitle = [workspaceName ? `Into ${workspaceName}` : null, step === 'review' ? `${plural(valid.length, 'source', 'sources')} read` : null].filter(Boolean).join(' · ') || null;

  return (
    <Modal
      onClose={close}
      closeOnOverlay={false}
      size={step === 'review' ? '2xl' : step === 'estimate' ? 'lg' : 'xl'}
      title="Create with AI"
      subtitle={subtitle}
      leading={<ToneTile icon={Sparkles} color="var(--theme-status-info)" />}
      aside={<Stepper step={stepKey} labels={step === 'review'} />}
      className={`${step === 'review' ? '!max-w-[69rem] h-[min(48.75rem,90vh)]' : step === 'estimate' ? '!max-w-[40rem]' : '!max-w-[45rem]'} max-h-[90vh]`}
    >
      {step === 'sources' && <SourcesStep electronAPI={electronAPI} sources={sources} setSources={setSources} showToast={showToast} />}
      {step === 'reading' && <ReadingStep sources={valid} progress={progress} />}
      {step === 'review' && <ReviewStep items={items} setItems={setItems} passages={passages} notes={notes} />}
      {step === 'estimate' && <EstimateStep items={kept.filter(item => item.fill)} estimate={estimate} />}

      <div className="flex shrink-0 items-center justify-end gap-2.5 border-t border-border-subtle px-[1.375rem] py-3.5">
        {step === 'review' && items.length > 0 && (
          <p className={`mr-auto min-w-0 truncate text-[0.8125rem] ${untyped || missingName ? 'text-status-warning' : 'text-text-muted'}`}>
            {untyped ? `Choose a type for ${plural(untyped, 'entry', 'entries')} to continue.`
              : missingName ? 'Every kept entry needs a name.'
              : <><span className="font-semibold text-text-primary">{kept.length} kept</span> · {matched} add to sheets you have · {kept.length - matched} new · {kept.filter(item => item.fill).length} filled from the sources</>}
          </p>
        )}
        {step === 'sources' && <>
          <Button variant="subtle" onClick={close}>Cancel</Button>
          <Button icon={Search} disabled={!valid.length} onClick={read}>Read {plural(valid.length, 'source', 'sources')}</Button>
        </>}
        {step === 'reading' && <>
          <Button variant="ghost" onClick={() => { readToken.current++; electronAPI.cancelDiscoverImportSources?.(workspaceId); setStep('sources'); }}>Stop</Button>
          <Button disabled loading>Review what was found</Button>
        </>}
        {step === 'review' && <>
          <Button variant="subtle" onClick={() => setStep('sources')}>Back</Button>
          <Button disabled={!kept.length || untyped > 0 || missingName} onClick={toEstimate}>Continue with {kept.length}</Button>
        </>}
        {step === 'estimate' && <>
          <Button variant="subtle" disabled={busy} onClick={() => setStep('review')}>Back</Button>
          <span data-tooltip={!fillable ? undefined : !hasSystemAi ? 'Choose an API connection and a model for System AI in Settings to fill sheets' : updating ? 'Wait for the entity update that is running to finish' : undefined}>
            <Button icon={fillable ? Sparkles : Plus} loading={busy} disabled={!estimate || !kept.length || (fillable > 0 && (!hasSystemAi || updating))} onClick={fill}>
              {fillable ? `Fill ${plural(fillable, 'sheet', 'sheets')}` : `Create ${plural(kept.length, 'entry', 'entries')}`}
            </Button>
          </span>
        </>}
      </div>
    </Modal>
  );
}

/** How the fill ended, in the terms of the update that ran it. */
export function CreateWithAiDone({ summary, result, onClose, onReview }) {
  const staged = result?.staged || 0;
  const updated = result?.updated || 0;
  const created = summary.created?.length || 0;
  const nameOnly = (summary.entityIds?.length || 0) - (summary.fillIds?.length || 0);
  const big = (value, label) => (
    <div>
      <p className="text-[1.75rem] font-semibold leading-tight tracking-[-0.01em] tabular-nums text-text-primary">{value}</p>
      <p className="mt-0.5 text-[0.8125rem] text-text-muted">{label}</p>
    </div>
  );
  const landed = [
    created ? `${plural(created, 'new entity was', 'new entities were')} added to your world` : null,
    nameOnly > 0 ? `${plural(nameOnly, 'entry was', 'entries were')} kept with ${nameOnly === 1 ? 'its name' : 'their names'} only, for the story to fill` : null,
    updated ? `${plural(updated, 'sheet was', 'sheets were')} updated directly, as ${updated === 1 ? 'its sheet allows' : 'their sheets allow'}` : null,
    summary.portraitsAdded ? `${plural(summary.portraitsAdded, 'portrait', 'portraits')} from the cards` : null,
    summary.aliasesAdded ? `${plural(summary.aliasesAdded, 'alias', 'aliases')} from names and keywords` : null,
  ].filter(Boolean);
  const usage = result?.tokenUsage;
  const missed = [
    result?.noEvidence ? `${plural(result.noEvidence, 'sheet had', 'sheets had')} nothing new to read and stayed as ${result.noEvidence === 1 ? 'it was' : 'they were'}` : null,
    result?.failed ? `${plural(result.failed, 'sheet', 'sheets')} could not be filled. Retry from the update errors in the sidebar` : null,
    result?.cancelled && result?.remaining ? `${plural(result.remaining, 'sheet was', 'sheets were')} not read because the update was stopped` : null,
  ].filter(Boolean);
  const title = staged
    ? `${plural(staged, 'sheet has', 'sheets have')} suggestions to review`
    : updated ? `${plural(updated, 'sheet was', 'sheets were')} updated` : 'Your sources are in';
  return (
    <Modal onClose={onClose} size="lg" className="!max-w-[40rem]">
      <div className="flex items-start gap-3.5 px-[1.375rem] pb-5 pt-[1.375rem]">
        <ToneTile icon={Check} color="var(--theme-status-success)" />
        <div className="min-w-0 flex-1">
          <h2 className="text-[1.0625rem] font-semibold text-text-primary">{title}</h2>
          {staged > 0 && <p className="mt-1 text-sm leading-relaxed text-text-muted">Their current values stay as they are. Open each one to accept or dismiss what changed.</p>}
        </div>
        <button type="button" onClick={onClose} aria-label="Close dialog"
          className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-text-muted transition-colors hover:bg-surface-hover/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <div className="flex flex-col gap-[1.375rem] pb-6 pl-[4.75rem] pr-[1.625rem]">
        <div className="grid grid-cols-2 gap-5">
          {big(staged, staged === 1 ? 'sheet to review' : 'sheets to review')}
          {big(created, 'new in your world')}
        </div>
        <TypeDots counts={summary.typeCounts} />
        {(landed.length > 0 || missed.length > 0) && (
          <ul className="space-y-2 border-t border-border-subtle pt-[1.125rem]">
            {landed.map(text => <li key={text} className="flex items-start gap-2.5 text-sm leading-relaxed text-text-secondary"><Check className="mt-0.5 h-4 w-4 shrink-0 text-status-success" aria-hidden="true" />{text}</li>)}
            {missed.map(text => <li key={text} className="flex items-start gap-2.5 text-sm leading-relaxed text-text-secondary"><Info className="mt-0.5 h-4 w-4 shrink-0 text-status-warning" aria-hidden="true" />{text}</li>)}
          </ul>
        )}
        {usage?.inputTokens > 0 && (
          <div className="grid grid-cols-2 gap-5 border-t border-border-subtle pt-[1.125rem]">
            {big(thousands(usage.inputTokens), 'tokens in')}
            {big(thousands(usage.outputTokens || 0), 'tokens out')}
          </div>
        )}
      </div>
      <div className="flex items-center justify-end gap-2.5 border-t border-border-subtle px-[1.375rem] py-3.5">
        <Button variant="subtle" onClick={onClose}>Later</Button>
        <Button disabled={!staged} onClick={onReview}>Review now</Button>
      </div>
    </Modal>
  );
}
