import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus, Search, BookOpen, MapPin, Package, Users, Flag, User,
  Sparkles, Trash2, Save, X, Pencil, Check, Link2, Globe, Tag, ScrollText, Ghost, Info, Replace,
  Lock, ShieldCheck, RefreshCw, Upload, Download, CalendarClock, ChevronRight, ChevronsLeftRight,
  AlertTriangle, LayoutTemplate, BookCheck, Bot, CircleHelp, ChevronLeft, UserMinus, Undo2, Crown,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import Button from './ui/Button';
import Checkbox from './ui/Checkbox';
import Popover from './ui/Popover';
import SearchableSelect from './ui/SearchableSelect';
import ConfirmDialog from './ui/ConfirmDialog';
import ExportWorldbuildModal from './modals/ExportWorldbuildModal';
import { buildLocationTree } from '../features/worldbuild/locationTree';
import EntityPickerButton from '../features/worldbuild/EntityPickerButton';
import { useSidebarWidth } from '../features/worldbuild/useSidebarWidth';
import { useWorldbuildNavigationState } from '../features/worldbuild/useWorldbuildNavigationState';
import WorldbuildCustomFields from '../features/worldbuild/WorldbuildCustomFields';
import WorldbuildKnowledgeTab from '../features/worldbuild/WorldbuildKnowledgeTab';
import WorldbuildKanoraReview from '../features/worldbuild/WorldbuildKanoraReview';
import WorldbuildFactsRegistry from '../features/worldbuild/WorldbuildFactsRegistry';
import WorldbuildCalendar from '../features/worldbuild/WorldbuildCalendar';
import WorldbuildEventOccurrences from '../features/worldbuild/WorldbuildEventOccurrences';
import WorldDateInput, { formatWorldDate } from '../features/worldbuild/WorldDateInput';
import { WorldbuildInventory, WorldbuildRelationships } from '../features/worldbuild/WorldbuildAgentCollections';
import WorldbuildTemplateManager from '../features/worldbuild/WorldbuildTemplateManager';
import WorldbuildRoleplayResources from '../features/worldbuild/WorldbuildRoleplayResources';
import { displayProposalValue } from '../features/worldbuild/reviewDisplay';
import {
  ABUNDANCE_HELP, CREATURE_NATURES, DISPOSITION, entityMeta, fieldLabel, ITEM_TYPES, itemMeta, meta, TYPES,
  RARITY, RELATIONSHIP_LABELS, STATUS, THREAT, TYPE_ORDER,
} from '../features/worldbuild/worldbuildConfig';
import { normalizeTemplateSections, sheetTabs as sheetTabsFor, tabLabel } from '../features/worldbuild/worldbuildSections';

// Frosted dark inputs: their own dark backing guarantees legible text over BOTH
// light and dark workspace backgrounds, while the blur keeps the background alive.
const FIELD = 'wb-input min-h-10 w-full bg-surface-input/90 backdrop-blur-md border border-border-default text-text-primary text-sm rounded-control px-3 py-2 placeholder:text-text-subtle focus:outline-none focus:border-accent/70 focus:ring-2 focus:ring-accent/20 transition-colors';
const LInput = (p) => <input {...p} className={`${FIELD} ${p.className || ''}`} />;
const LTextarea = (p) => <textarea {...p} className={`${FIELD} resize-none leading-relaxed custom-scrollbar ${p.className || ''}`} />;
const LSelect = ({ children, ...p }) => <select {...p} className={`${FIELD} cursor-pointer ${p.className || ''}`}>{children}</select>;

// A colored state pill (life status, disposition…). `map` is one of STATUS/DISPOSITION.
const StateTag = ({ map, value }) => {
  const s = map[value]; if (!s) return null;
  return <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[0.6875rem] font-medium tracking-wide ${s.cls}`}>{s.label}</span>;
};

const EvidenceReferences = ({ excerpts, support = '' }) => {
  const [open, setOpen] = useState(false);
  const references = excerpts.filter(Boolean);
  if (!references.length && !support) return null;
  return (
    <div className="mt-2">
      <button type="button" onClick={() => setOpen(value => !value)} className="inline-flex items-center gap-1 text-xs font-semibold text-status-info/75 hover:text-status-info transition-colors">
        <ChevronRight className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
        {open ? 'Hide references' : references.length ? `View references (${references.length})` : 'View explanation'}
      </button>
      {open && <div className="mt-2 max-h-56 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
        {support && <p className="caption text-status-info/75">{support}</p>}
        {references.map((excerpt, index) => <p key={index} className="caption text-status-info/75">“{excerpt}”</p>)}
      </div>}
    </div>
  );
};

// Per-entity AI write permission, used by the "Update entities" enrichment pass:
// open = AI writes directly, review = AI stages changes for approval, locked = the
// enrichment skips it entirely (still readable by search/tagging). Stored in
// data.aiPolicy; default 'review'.
const AI_POLICY = {
  open:   { label: 'Open',   icon: Pencil,      tip: 'AI can edit this entity freely',        active: 'bg-accent/20 text-accent border-accent/40' },
  review: { label: 'Review', icon: ShieldCheck, tip: 'AI edits are staged for your approval', active: 'bg-status-warning/15 text-status-warning border-status-warning/40' },
  locked: { label: 'Locked', icon: Lock,        tip: 'AI can read but never edit this entity', active: 'bg-slate-400/15 text-slate-200 border-slate-400/40' },
};
const AiPolicyControl = ({ value, onChange }) => {
  const cur = AI_POLICY[value] ? value : 'review';
  return (
    <div className="flex flex-col items-end gap-1 shrink-0">
      <div className="inline-flex rounded-control border border-border-subtle bg-surface-canvas/45 p-0.5">
        {Object.entries(AI_POLICY).map(([k, v]) => {
          const Icon = v.icon; const on = k === cur;
          return (
            <button key={k} type="button" onClick={() => onChange(k)} data-tooltip={v.tip}
              className={`p-1.5 rounded-md transition-colors cursor-pointer ${on ? v.active + ' border' : 'text-text-subtle hover:text-text-secondary border border-transparent'}`}>
              <Icon className="w-3.5 h-3.5" />
            </button>
          );
        })}
      </div>
      <span className="text-[0.625rem] font-semibold uppercase tracking-wider text-text-subtle">AI: {AI_POLICY[cur].label}</span>
    </div>
  );
};

// A select whose options come from a keyed state map (STATUS/DISPOSITION).
const StateSelect = ({ map, value, onChange }) => (
  <LSelect value={value || ''} onChange={onChange}>
    {Object.entries(map).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
  </LSelect>
);

// Free-text field with a themed suggestion dropdown: seed values plus anything the
// user has typed before. Open-ended yet self-completing, and styled to match. No
// native datalist (whose popup we cannot theme). onChange receives an event-like
// object so callers read e.target.value uniformly.
const FreeDatalist = ({ value, onChange, options, placeholder }) => {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const opts = [...new Set(options.filter(Boolean))];
  const q = (value || '').toLowerCase();
  const filtered = opts.filter(o => o.toLowerCase().includes(q));
  return (
    <div className="relative" ref={wrapRef}>
      <LInput placeholder={placeholder} value={value || ''} onFocus={() => setOpen(true)} onChange={(e) => { onChange(e); setOpen(true); }} />
      <Popover anchorRef={wrapRef} open={open && filtered.length > 0} onClose={() => setOpen(false)} maxHeight={176} scroll={false} className="border-border-default bg-surface-panel-muted p-1">
        <div className="max-h-44 overflow-y-auto custom-scrollbar">
          {filtered.map(o => (
            <button key={o} type="button" onMouseDown={(e) => { e.preventDefault(); onChange({ target: { value: o } }); setOpen(false); }}
              className="w-full rounded-md px-3 py-2 text-left text-sm text-text-secondary transition-colors hover:bg-accent/15 hover:text-text-primary">{o}</button>
          ))}
        </div>
      </Popover>
    </div>
  );
};

// A small "?" that reveals a themed legend on hover, matching the app's tooltips.
const InfoPopover = ({ items }) => {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef(null);
  return (
    <span ref={anchorRef} className="relative inline-flex align-middle" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <Info className="w-3 h-3 text-text-subtle hover:text-accent cursor-help" />
      <Popover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} matchAnchorWidth={false} scroll={false} className="w-60 border-border-default bg-surface-panel-muted p-3 normal-case tracking-normal">
        <div className="space-y-1.5">
          {items.map(([k, v]) => <div key={k} className="text-xs leading-snug"><span className="font-semibold text-text-primary">{k}</span> <span className="text-text-muted">{v}</span></div>)}
        </div>
      </Popover>
    </span>
  );
};

const FieldLabel = ({ children }) => <label className="eyebrow mb-1 block">{children}</label>;
const Hint = ({ children }) => <span className="caption mt-1 block">{children}</span>;
const Edit = ({ label, hint, children }) => (
  <div>{label && <FieldLabel>{label}</FieldLabel>}{children}{hint && <Hint>{hint}</Hint>}</div>
);

// Read-only field in the rendered sheet. `value` may be a node (a state tag, a chip
// row) as well as text; `full` spans both columns of the surrounding FactGrid.
const ViewField = ({ label, value, empty = 'Not set', full = false }) => (
  <div className={full ? 'col-span-2 min-w-0' : 'min-w-0'}>
    <div className="eyebrow mb-1">{label}</div>
    {value === null || value === undefined || value === ''
      ? <div className="text-sm text-text-disabled italic">{empty}</div>
      : typeof value === 'object' ? value : <div className="text-sm text-text-primary whitespace-pre-wrap break-words leading-relaxed">{value}</div>}
  </div>
);

// The scannable half of a sheet. Framing the short facts as one block keeps them
// from floating against the prose that follows them.
const FactGrid = ({ children }) => (
  <div className="grid grid-cols-2 gap-x-5 gap-y-3.5 rounded-control border border-border-subtle bg-surface-canvas/30 px-3.5 py-3.5">{children}</div>
);

const Prose = ({ text, empty = 'Nothing written yet.' }) =>
  text && text.trim()
    ? <p className="text-sm text-text-secondary leading-relaxed whitespace-pre-wrap">{text}</p>
    : <p className="text-sm text-text-disabled italic">{empty}</p>;

const Chip = ({ children }) => (
  <span className="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-surface-hover/35 px-2 py-0.5 text-[0.6875rem] font-medium text-text-secondary">{children}</span>
);

// A sheet section: titled card with an optional pencil that flips it to edit mode.
// The pencil rests quietly and comes forward on hover or keyboard focus.
function Section({ icon, title, editing, onEdit, showPencil, children }) {
  const Icon = icon || BookOpen;
  return (
    <section className="group/section rounded-card border border-border-default bg-surface-panel-muted/60 backdrop-blur-md overflow-hidden">
      <header className="flex items-center justify-between gap-3 px-4 py-2.5 border-b border-border-subtle bg-surface-canvas/20">
        <div className="flex min-w-0 items-center gap-2.5">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-accent/20 bg-accent/10 text-accent"><Icon className="w-3.5 h-3.5" /></span>
          <span className="eyebrow truncate text-text-secondary">{title}</span>
        </div>
        {showPencil && !editing && (
          <button onClick={onEdit} aria-label={`Edit ${title || 'section'}`} data-tooltip="Edit this section"
            className="p-1.5 -mr-1 shrink-0 rounded-md text-text-subtle opacity-60 transition-[color,background-color,opacity] duration-200 ease-standard hover:bg-surface-hover/60 hover:text-accent group-hover/section:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 cursor-pointer">
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}
      </header>
      <div className="p-4 space-y-3.5">{children}</div>
    </section>
  );
}

const draftFor = (type, data = {}) => ({ id: null, type, canonicalName: '', aliases: '', lore: '', loreDocumentId: '', status: 'confirmed', data });

// Relation pickers (single-value and many-to-many), styled to match the light inputs.
// Links need a saved entity id, so these render nothing until the entity exists,
// the create form shows only fields that can be filled before the first save.
function SingleRelation({ label, hint, current, options, onSet, disabled }) {
  if (disabled) return null;
  const currentName = options.find(o => o.id === current)?.canonicalName;
  return (
    <Edit label={label} hint={hint}>
      <div className="flex items-center gap-2 flex-wrap">
        {currentName
          ? <div className="inline-flex min-h-9 items-center gap-2 rounded-control border border-border-default bg-surface-input/70 pl-3 pr-1.5 text-sm font-medium text-text-primary">
              <span>{currentName}</span>
              <button type="button" aria-label={`Clear ${label}`} onClick={() => onSet(null)} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-muted hover:bg-status-danger/10 hover:text-status-danger"><X className="w-3.5 h-3.5" /></button>
            </div>
          : <span className="inline-flex min-h-9 items-center rounded-control border border-dashed border-border-default px-3 text-sm text-text-subtle">None set</span>}
        <EntityPickerButton icon={currentName ? Replace : Plus} label={currentName ? 'Change' : 'Set'} title={label} options={options} onPick={(id) => onSet(id)} />
      </div>
    </Edit>
  );
}
function MultiRelation({ label, hint, links, options, onAdd, onRemove, disabled }) {
  if (disabled) return null;
  const linked = new Set(links.map(l => l.entity.id));
  const remaining = options.filter(o => !linked.has(o.id));
  return (
    <Edit label={label} hint={hint}>
      <div className="flex flex-wrap items-center gap-1.5">
        {links.map(l => (
          <span key={l.linkId} className="inline-flex items-center gap-1 text-[0.6875rem] font-medium text-text-primary bg-surface-hover/65 border border-border-default rounded-full pl-2.5 pr-1 py-0.5">
            {l.entity.canonicalName}
            <button onClick={() => onRemove(l.linkId)} className="text-text-muted hover:text-status-danger cursor-pointer p-0.5"><X className="w-3 h-3" /></button>
          </span>
        ))}
        <EntityPickerButton title={label} options={remaining} onPick={onAdd} />
      </div>
    </Edit>
  );
}

// Character↔character relationships are directional. Outgoing edges can be edited
// from the open sheet's point of view; incoming edges are shown as the other
// character's perspective and remain read-only here.
function LabeledRelation({ subjectName, links, options, priorLabels, onAdd, onRemove, disabled }) {
  const [toId, setToId] = useState('');
  const [role, setRole] = useState('');
  if (disabled) return null;
  const who = subjectName?.trim() ? subjectName.trim() : 'this character';
  const linked = new Set((links || []).map(l => l.entity.id));
  const remaining = options.filter(o => !linked.has(o.id));
  const suggestions = [...new Set([...RELATIONSHIP_LABELS, ...priorLabels])];
  const pickedName = options.find(o => o.id === toId)?.canonicalName;
  const submit = () => { if (!toId) return; onAdd(toId, role.trim()); setToId(''); setRole(''); };
  return (
    <Edit label="Relationships">
      <Hint>Pick a character and say what they are to {who}. For example, choose "John" and type "father" to record that John is {who}'s father.</Hint>
      <div className="flex flex-wrap gap-1.5 my-2">
        {(!links || links.length === 0) && <span className="caption">None yet.</span>}
        {(links || []).map(l => (
          <span key={l.linkId} className="inline-flex items-center gap-1 text-[0.6875rem] font-medium text-text-primary bg-surface-hover/65 border border-border-default rounded-full pl-2.5 pr-1 py-0.5">
            <span className="text-accent/90 font-semibold">{l.label || 'related'}</span> · {l.entity.canonicalName}
            <button onClick={() => onRemove(l.linkId)} className="text-text-muted hover:text-status-danger cursor-pointer p-0.5"><X className="w-3 h-3" /></button>
          </span>
        ))}
      </div>
      {remaining.length === 0
        ? <span className="caption">Everyone is already linked.</span>
        : toId
          ? <div className="flex items-center gap-1.5">
              <span className="caption shrink-0"><span className="text-text-secondary font-medium">{pickedName}</span> is {who}'s</span>
              <div className="flex-1"><FreeDatalist value={role} onChange={(e) => setRole(e.target.value)} options={suggestions} placeholder="e.g. father, rival, mentor (optional)" /></div>
              <Button size="sm" icon={Check} onClick={submit}>Add</Button>
              <Button size="sm" variant="ghost" onClick={() => { setToId(''); setRole(''); }}>Cancel</Button>
            </div>
          : <EntityPickerButton label="Add relationship" title="Choose a character" options={remaining} onPick={(id) => setToId(id)} />}
    </Edit>
  );
}

// A membership badge: leader, founder. Small enough to sit beside a name.
const MemberFlag = ({ icon: Icon, label, tone }) => (
  <span className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-0.5 text-[0.625rem] font-semibold ${tone}`}>
    <Icon className="h-2.5 w-2.5" />{label}
  </span>
);

// One line of a faction roster, past or present: name on the left, rank on the right,
// and the dates of the tenure underneath. The same row serves both lists so a departure
// changes only the wording, never the shape of what you are reading.
function MemberRow({ link, calendar, kind, isLeader, editing, onOpen, onSetRole, onSetMeta, onSetFormer, onRestore, onRemove }) {
  const [role, setRole] = useState(link.label || '');
  const [datesOpen, setDatesOpen] = useState(false);
  useEffect(() => { setRole(link.label || ''); }, [link.label]);
  const meta = link.metadata || {};
  const isFormer = kind === 'former';
  const commitRole = () => { if ((role.trim() || '') !== (link.label || '')) onSetRole(link, role.trim()); };
  const rank = link.label || (isFormer ? 'former member' : '');
  const joined = formatWorldDate(calendar, meta.joined);
  const left = formatWorldDate(calendar, meta.left);
  const leaderSince = formatWorldDate(calendar, meta.leaderSince);
  const tenure = [
    joined && (left ? `${joined} to ${left}` : `Joined ${joined}`),
    !joined && left && `Left ${left}`,
    isLeader && leaderSince && `Leading since ${leaderSince}`,
  ].filter(Boolean).join(' · ');

  return (
    <div className="py-1.5">
      <div className="flex items-center gap-2">
        {onOpen
          ? <button type="button" onClick={() => onOpen(link.entity.id)} title={`Open ${link.entity.canonicalName}`} className="min-w-0 truncate text-left text-sm text-text-primary transition-colors hover:text-accent cursor-pointer">{link.entity.canonicalName}</button>
          : <span className="min-w-0 truncate text-sm text-text-primary">{link.entity.canonicalName}</span>}
        {isLeader && <MemberFlag icon={Crown} label="Leader" tone="border-accent/30 bg-accent/10 text-accent" />}
        {meta.founder && <MemberFlag icon={Sparkles} label="Founder" tone="border-entity-faction/30 bg-entity-faction/10 text-entity-faction" />}
        {editing ? (
          <>
            <input value={role} onChange={(e) => setRole(e.target.value)} onBlur={commitRole} onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
              placeholder={isFormer ? 'last rank' : 'rank (optional)'} aria-label={`Rank of ${link.entity.canonicalName}`}
              className="wb-input ml-auto w-36 rounded-md border border-border-default bg-surface-input/90 px-2 py-1 text-xs text-text-primary placeholder:text-text-subtle focus:border-accent/70 focus:outline-none" />
            <button onClick={() => setDatesOpen(open => !open)} aria-label={`Dates for ${link.entity.canonicalName}`} data-tooltip="Tenure dates" aria-expanded={datesOpen}
              className={`p-1 cursor-pointer ${datesOpen ? 'text-accent' : 'text-text-muted hover:text-accent'}`}><CalendarClock className="w-3.5 h-3.5" /></button>
            <button onClick={() => onSetMeta(link, { founder: !meta.founder })} aria-label={`${meta.founder ? 'Unmark' : 'Mark'} ${link.entity.canonicalName} as founder`} data-tooltip={meta.founder ? 'Not a founder' : 'Founded this faction'}
              className={`p-1 cursor-pointer ${meta.founder ? 'text-entity-faction' : 'text-text-muted hover:text-entity-faction'}`}><Sparkles className="w-3.5 h-3.5" /></button>
            {onSetFormer && <button onClick={() => onSetFormer(link)} aria-label={`Move ${link.entity.canonicalName} to former members`} data-tooltip="Moved on: keeps what they knew, stops receiving what the faction shares"
              className="p-1 text-text-muted hover:text-status-warning cursor-pointer"><UserMinus className="w-3.5 h-3.5" /></button>}
            {onRestore && <button onClick={() => onRestore(link)} aria-label={`Restore ${link.entity.canonicalName} to the roster`} data-tooltip="Back on the roster"
              className="p-1 text-text-muted hover:text-status-success cursor-pointer"><Undo2 className="w-3.5 h-3.5" /></button>}
            <button onClick={() => onRemove(link.linkId)} aria-label={`Remove ${link.entity.canonicalName}`} data-tooltip={isFormer ? 'Drop this record entirely' : 'Remove from the roster entirely'}
              className="p-1 text-text-muted hover:text-status-danger cursor-pointer"><X className="w-3.5 h-3.5" /></button>
          </>
        ) : (
          rank && <span className={`ml-auto shrink-0 text-xs font-medium ${isFormer ? 'text-text-muted' : 'text-accent'}`}>{rank}</span>
        )}
      </div>
      {tenure && <p className="caption mt-0.5">{tenure}</p>}
      {/* One date per row: the control needs its full width to show the month by name. */}
      {editing && datesOpen && calendar && (
        <div className="mt-2 grid gap-3 rounded-control border border-border-subtle bg-surface-canvas/30 p-3">
          <Edit label="Joined"><WorldDateInput label="Joined" emptyLabel="Set the date they joined" calendar={calendar} value={meta.joined} onChange={joinedDate => onSetMeta(link, { joined: joinedDate })} /></Edit>
          {isFormer && <Edit label="Left"><WorldDateInput label="Left" emptyLabel="Set the date they left" calendar={calendar} value={meta.left} onChange={leftDate => onSetMeta(link, { left: leftDate })} /></Edit>}
          {isLeader && <Edit label="Leading since"><WorldDateInput label="Leading since" emptyLabel="Set the date they took charge" calendar={calendar} value={meta.leaderSince} onChange={since => onSetMeta(link, { leaderSince: since })} /></Edit>}
        </div>
      )}
      {editing && datesOpen && !calendar && <p className="caption mt-2">Set up the world calendar to record dates.</p>}
    </div>
  );
}

// The roster. The leader sits at the top: they are a member like any other, and reading
// a faction should start with who answers for it.
function MemberList({ links, calendar, kind = 'member', leaderId, editing, options, onOpen, onAdd, onSetRole, onSetMeta, onSetFormer, onRestore, onRemove, empty }) {
  const rows = [...(links || [])].sort((a, b) => {
    if (a.entity.id === leaderId) return -1;
    if (b.entity.id === leaderId) return 1;
    return a.entity.canonicalName.localeCompare(b.entity.canonicalName);
  });
  const linked = new Set(rows.map(l => l.entity.id));
  const remaining = (options || []).filter(o => !linked.has(o.id));
  return (
    <div>
      {editing && kind === 'member' && <p className="caption mb-2">Add anyone who belongs here, give each a rank, and record when they joined.</p>}
      {rows.length === 0
        ? <p className="text-sm text-text-disabled italic">{empty}</p>
        : <div className="divide-y divide-border-subtle">
            {rows.map(link => (
              <MemberRow key={link.linkId} link={link} calendar={calendar} kind={kind} isLeader={link.entity.id === leaderId}
                editing={editing} onOpen={onOpen} onSetRole={onSetRole} onSetMeta={onSetMeta}
                onSetFormer={onSetFormer} onRestore={onRestore} onRemove={onRemove} />
            ))}
          </div>}
      {editing && onAdd && <div className="mt-2"><EntityPickerButton label="Add member" title="Add member" options={remaining} onPick={onAdd} /></div>}
    </div>
  );
}

export default function WorldbuildView({ chat, electronAPI, focusEntityId, onFocusHandled }) {
  const { showToast, settings, openSettings } = useApp();
  // Update Entities always uses System AI, independently of the Tagger executor.
  const hasSystemAi = !!settings?.advanced?.systemApiProfileId && !!settings?.advanced?.systemModelName;
  const workspaceId = chat?.id;

  const [entities, setEntities] = useState([]);
  const [insideLinks, setInsideLinks] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState(null);
  const [reviewFilter, setReviewFilter] = useState(null);
  const [manageMode, setManageMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const filterStripRef = useRef(null);
  const [bulkConfirm, setBulkConfirm] = useState(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [selected, setSelected] = useState(null);
  const [surface, setSurface] = useState('entities');
  const [factCount, setFactCount] = useState(0);
  const [worldCalendar, setWorldCalendar] = useState(null);
  const [rel, setRel] = useState({});
  const [charTab, setCharTab] = useState('data');
  const [editingSection, setEditingSection] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const createRef = useRef(null);
  const [enriching, setEnriching] = useState(false);
  const [enrichProgress, setEnrichProgress] = useState(null);
  const [enrichErrors, setEnrichErrors] = useState([]);
  const [showEnrichErrors, setShowEnrichErrors] = useState(false);
  const [enrichErrorSummary, setEnrichErrorSummary] = useState('');
  const [mergePrompt, setMergePrompt] = useState(null); // { id, name } while choosing merge priority
  const [showExportModal, setShowExportModal] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [templates, setTemplates] = useState([]);
  const [fieldDefinitions, setFieldDefinitions] = useState([]);
  const [reviewCounts, setReviewCounts] = useState({});
  const [subjectReview, setSubjectReview] = useState({ proposals: [] });
  const [reviewKind, setReviewKind] = useState('entity');
  const [showTemplateManager, setShowTemplateManager] = useState(false);
  const { sidebarWidth, updateSidebarWidth, startSidebarResize, handleSidebarResizeKey } = useSidebarWidth();
  const {
    expandedLocations,
    setExpandedLocations,
    restoredEntityId,
    isNavigationStateReady: navigationStateReady,
  } = useWorldbuildNavigationState({
    workspaceId,
    electronAPI,
    selectedEntityId: selected?.id || null,
    sidebarWidth,
    updateSidebarWidth,
  });

  const isNew = !selected?.id;
  const isIndividualCreature = selected?.type === 'Creatures' && (selected?.data?.scope || 'individual') !== 'group';
  const hasKnowledgeTab = selected?.type === 'Characters' || selected?.type === 'Factions' || isIndividualCreature;
  const hasOccurrencesTab = selected?.type === 'Events';
  // Templates are read through the registry on this side too. Reading them raw is what
  // left a Creature's "Details" ignoring the layout saved under its former id, which
  // pushed the section to the end of the sheet and detached it from the editor.
  const storedTemplate = templates.find(template => template.typeId === selected?.type);
  const activeTemplate = useMemo(() => storedTemplate && {
    ...storedTemplate,
    layout: { ...storedTemplate.layout, sections: normalizeTemplateSections(storedTemplate.typeId, storedTemplate.layout?.sections) },
  }, [storedTemplate]);
  const templateSections = activeTemplate?.layout?.sections || [];
  const sectionSetting = (id) => templateSections.find(section => section.id === id);
  const selectedReviewCounts = reviewCounts[selected?.id] || { entityUpdates: selected?.data?._enrichPending ? 1 : 0, kanora: 0 };
  const hasEntityReview = selectedReviewCounts.entityUpdates > 0;
  const hasKanoraReview = selectedReviewCounts.kanora > 0;
  const hasReview = hasEntityReview || hasKanoraReview;
  const isFaction = selected?.type === 'Factions';
  // Which tabs a sheet shows follows from the type and its shape. The relational tabs are
  // systematic, so the template has no say over them.
  const sheetVariant = selected?.type === 'Creatures' ? (isIndividualCreature ? 'individual' : 'group') : null;
  const visibleSheetTabs = sheetTabsFor(selected?.type, sheetVariant);
  if (hasReview && !isNew) visibleSheetTabs.push('review');
  const sheetTabLabel = (tab) => tab === 'review' ? 'Review' : tabLabel(selected?.type, sheetVariant, tab);
  const typeMeta = (type) => {
    const base = meta(type);
    const displayName = templates.find(template => template.typeId === type)?.displayName;
    return displayName ? { ...base, label: displayName } : base;
  };
  const concreteEntityMeta = (entity) => {
    const base = entityMeta(entity);
    const displayName = templates.find(template => template.typeId === entity?.type)?.displayName;
    return displayName ? { ...base, label: displayName } : base;
  };
  const docTitle = (id) => documents.find(d => d.id === id)?.title;
  // A creature is either one being or a whole species, and the two get different sheets.
  // Offering the choice here, instead of a toggle found later inside the sheet, means the
  // right shape opens from the start.
  const createOptions = TYPE_ORDER.flatMap(type => type === 'Creatures'
    ? [
        { id: 'Creatures:individual', type, note: 'A specific being', data: { scope: 'individual' } },
        { id: 'Creatures:group', type, note: 'A group or species', data: { scope: 'group' } },
      ]
    : [{ id: type, type, data: {} }]);

  const byType = useMemo(() => {
    const m = {}; for (const t of Object.keys(TYPES)) m[t] = [];
    for (const e of entities) (m[e.type] = m[e.type] || []).push(e);
    return m;
  }, [entities]);
  // A group creature is a species or a swarm, not someone a relation can point at.
  // Only specific beings can own things, hold a relationship, or be regarded by a faction.
  const individualCreatures = useMemo(
    () => (byType.Creatures || []).filter(entity => (entity.data?.scope || 'individual') !== 'group'),
    [byType.Creatures],
  );

  const load = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const [entityRes, linkRes, reviewRes, factRes, calendarRes] = await Promise.all([
        electronAPI.listEntities(workspaceId),
        electronAPI.listEntityLinks(workspaceId, 'inside'),
        electronAPI.listWorldbuildReviewCounts?.(workspaceId),
        electronAPI.listWorldbuildFacts?.(workspaceId),
        electronAPI.getWorldCalendar?.(workspaceId),
      ]);
      setEntities(entityRes?.entities || []);
      setInsideLinks(linkRes?.links || []);
      setReviewCounts(reviewRes?.counts || {});
      setFactCount(factRes?.facts?.length || 0);
      setWorldCalendar(calendarRes?.calendar || null);
    } catch { setEntities([]); setInsideLinks([]); }
    finally { setLoading(false); }
  }, [workspaceId, electronAPI]);

  const loadEnrichErrors = useCallback(async () => {
    if (!workspaceId || !electronAPI.getEntityEnrichmentErrors) return;
    const result = await electronAPI.getEntityEnrichmentErrors(workspaceId).catch(() => null);
    setEnrichErrors(result?.errors || []);
    if (result?.errors?.length) setShowEnrichErrors(true);
  }, [workspaceId, electronAPI]);

  useEffect(() => {
    setLoading(true);
    setSelected(null);
    setSurface('entities');
    setRel({});
    setManageMode(false);
    setSelectedIds(new Set());
    setReviewFilter(null);
    load();
    loadEnrichErrors();
  }, [load, loadEnrichErrors]);
  useEffect(() => { electronAPI.getWritingTree(workspaceId).then(t => setDocuments(t?.documents || [])).catch(() => setDocuments([])); }, [workspaceId, electronAPI]);
  useEffect(() => {
    if (!workspaceId || !electronAPI.listWorldbuildEntityTemplates) return;
    electronAPI.listWorldbuildEntityTemplates(workspaceId).then(result => setTemplates(result?.templates || [])).catch(() => setTemplates([]));
  }, [electronAPI, workspaceId]);
  useEffect(() => {
    if (!workspaceId || !selected?.type || !electronAPI.listWorldbuildFieldDefinitions) { setFieldDefinitions([]); return; }
    electronAPI.listWorldbuildFieldDefinitions(workspaceId, selected.type)
      .then(result => setFieldDefinitions(result?.fields || []))
      .catch(() => setFieldDefinitions([]));
  }, [electronAPI, selected?.type, workspaceId]);
  const loadSubjectReview = useCallback(async () => {
    if (!workspaceId || !selected?.id || !electronAPI.getWorldbuildSubjectReview) {
      setSubjectReview({ proposals: [] });
      return;
    }
    const result = await electronAPI.getWorldbuildSubjectReview(workspaceId, selected.id).catch(() => null);
    setSubjectReview(result?.review || { proposals: [] });
  }, [electronAPI, selected?.id, workspaceId]);
  useEffect(() => { loadSubjectReview(); }, [loadSubjectReview]);
  useEffect(() => {
    if (!hasEntityReview && hasKanoraReview) setReviewKind('kanora');
    else if (hasEntityReview && !hasKanoraReview) setReviewKind('entity');
  }, [hasEntityReview, hasKanoraReview, selected?.id]);
  // A tab can disappear under the reader: the template hides its section, or a creature
  // changes shape. Fall back to Data instead of leaving an empty tab selected.
  useEffect(() => {
    if (selected && !visibleSheetTabs.includes(charTab)) setCharTab('data');
  }, [visibleSheetTabs.join(','), charTab, selected?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  // Every edge a sheet needs, fetched in one round of parallel reads. These used to run
  // one after another, so opening a character waited on eight sequential IPC calls.
  const loadRelations = useCallback(async (ent) => {
    if (!ent?.id) { setRel({}); return; }
    const request = (direction, relType) => electronAPI.getEntityLinks(ent.id, direction, relType).then(x => x?.links || []);
    const wanted = {
      Locations: { inside: ['from', 'inside'], leader: ['from', 'led_by'] },
      Items: {
        createdBy: ['from', 'created_by'], ownedBy: ['from', 'owned_by'], locatedIn: ['from', 'located_in'],
        foundIn: ['from', 'found_in'], soldIn: ['from', 'sold_in'],
      },
      Races: { members: ['to', 'is_race'] },
      Creatures: {
        foundIn: ['from', 'found_in'], memberOf: ['from', 'member_of'],
        formerMemberOf: ['from', 'former_member_of'],
      },
      Events: { happenedAt: ['from', 'happened_at'], involved: ['from', 'involved'] },
      Factions: {
        operatesIn: ['from', 'operates_in'], members: ['to', 'member_of'],
        formerMembers: ['to', 'former_member_of'], leader: ['from', 'led_by'],
      },
      Characters: {
        isRace: ['from', 'is_race'], memberOf: ['from', 'member_of'],
        formerMemberOf: ['from', 'former_member_of'], connectedTo: ['from', 'connected_to'],
      },
    }[ent.type] || {};
    const singles = new Set(['inside', 'leader', 'createdBy', 'ownedBy', 'locatedIn', 'isRace']);
    const isAgent = ent.type === 'Characters' || (ent.type === 'Creatures' && (ent.data?.scope || 'individual') !== 'group');
    const wantsRelationships = isAgent || ent.type === 'Factions';
    const extras = {
      ...(isAgent ? { owned: ['to', 'owned_by'], carried: ['to', 'carried_by'] } : {}),
      ...(wantsRelationships ? { outgoing: ['from', 'related_to'], incoming: ['to', 'related_to'] } : {}),
    };
    const keys = [...Object.keys(wanted), ...Object.keys(extras)];
    const results = await Promise.all(keys.map(key => {
      const [direction, relType] = wanted[key] || extras[key];
      return request(direction, relType);
    }));
    const links = Object.fromEntries(keys.map((key, index) => [key, results[index]]));
    const n = {};
    for (const key of Object.keys(wanted)) n[key] = singles.has(key) ? links[key][0] || null : links[key];
    if (isAgent) n.inventory = [...links.owned, ...links.carried];
    if (wantsRelationships) {
      n.relationships = [
        ...links.outgoing.map(link => ({ ...link, direction: 'outgoing' })),
        ...links.incoming.map(link => ({ ...link, direction: 'incoming' })),
      ];
    }
    setRel(n);
  }, [electronAPI]);

  const openEntity = async (en, { preserveTab = false, tab = null } = {}) => {
    setSurface('entities');
    setEditingSection(null); if (tab) setCharTab(tab); else if (!preserveTab) setCharTab('data'); setMergePrompt(null);
    setSelected({ id: en.id, type: en.type, canonicalName: en.canonicalName || '', aliases: (en.aliases || []).join(', '), lore: en.lore || '', loreDocumentId: en.loreDocumentId || '', status: en.status || 'confirmed', data: en.data || {} });
    await loadRelations(en);
  };

  // Focus an entity requested from outside (the Writing Desk "Open in Worldbuild" action),
  // once the registry has loaded. Clear the request so it fires only once.
  useEffect(() => {
    if (!focusEntityId || !entities.length) return;
    const en = entities.find(e => e.id === focusEntityId);
    if (en) openEntity(en);
    onFocusHandled?.();
  }, [focusEntityId, entities]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!navigationStateReady || surface !== 'entities' || focusEntityId || selected || !restoredEntityId) return;
    const en = entities.find(e => e.id === restoredEntityId);
    if (en) openEntity(en);
  }, [navigationStateReady, surface, focusEntityId, selected, restoredEntityId, entities]); // eslint-disable-line react-hooks/exhaustive-deps
  const openEntityById = (entityId, options) => {
    const target = entities.find(item => item.id === entityId);
    if (target) openEntity(target, options);
  };
  const startNew = (type, data = {}) => { setSurface('entities'); setShowCreate(false); setEditingSection(null); setCharTab('data'); setSelected(draftFor(type, data)); setRel({}); };
  const patch = (f) => setSelected(p => ({ ...p, ...f }));
  const patchData = (f) => setSelected(p => ({ ...p, data: { ...p.data, ...f } }));
  const applyIntegratedEntity = (entity) => {
    setSelected(current => current?.id === entity.id ? { ...current, data: entity.data || {} } : current);
    setEntities(current => current.map(item => item.id === entity.id ? { ...item, data: entity.data || {} } : item));
  };

  // Linked chapters: many-valued, stored in data.loreDocumentIds. Legacy entities that
  // only have the single loreDocumentId column read through the fallback below.
  const loreDocIds = () => {
    const arr = selected?.data?.loreDocumentIds;
    if (Array.isArray(arr)) return arr.filter(Boolean);
    return selected?.loreDocumentId ? [selected.loreDocumentId] : [];
  };
  const addLoreDoc = (id) => { if (!id) return; const cur = loreDocIds(); if (cur.includes(id)) return; patchData({ loreDocumentIds: [...cur, id] }); };
  const removeLoreDoc = (id) => patchData({ loreDocumentIds: loreDocIds().filter(x => x !== id) });
  const aliasesArr = (raw) => raw.split(',').map(s => s.trim()).filter(Boolean);

  const persist = async ({ accept = false } = {}) => {
    if (!selected) return null;
    if (!selected.canonicalName.trim()) { showToast('A name is required.', 'error'); return null; }
    setSaving(true);
    try {
      const ids = loreDocIds();
      const data = { ...(selected.data || {}), loreDocumentIds: ids };
      if (accept) delete data._imported; // accepting an imported proposal makes it a real entity
      const payload = { workspaceId, type: selected.type, canonicalName: selected.canonicalName.trim(), aliases: aliasesArr(selected.aliases), lore: selected.lore, loreDocumentId: ids[0] || null, data, status: accept ? 'confirmed' : selected.status };
      let id = selected.id;
      if (selected.id) { const r = await electronAPI.updateEntity(selected.id, payload); if (!r?.success) throw new Error(r?.error || 'update failed'); patch({ status: payload.status }); }
      else { const r = await electronAPI.createEntity(payload); if (!r?.success) throw new Error(r?.error || 'create failed'); id = r.entity.id; setSelected(s => ({ ...s, id, status: r.entity.status })); }
      await load();
      await loadEnrichErrors();
      return id;
    } catch (e) { showToast(`Save failed: ${e.message}`, 'error'); return null; }
    finally { setSaving(false); }
  };

  const saveSection = async () => { const id = await persist(); if (id) setEditingSection(null); };
  const cancelSection = async () => { const cur = entities.find(e => e.id === selected.id); if (cur) await openEntity(cur); setEditingSection(null); };
  const remove = async () => { if (!selected?.id) { setSelected(null); return; } setSaving(true); try { await electronAPI.deleteEntity(selected.id); setSelected(null); await load(); } finally { setSaving(false); } };

  // Folding a proposal into an existing entity: absorbs the name as an alias, repoints its
  // tags + relation edges, combines data/lore (with `prefer` deciding conflicts), deletes
  // the source. Used for AI proposals ("this is really X") and imported duplicates.
  const mergeInto = async (targetId, prefer = 'target') => {
    if (!selected?.id || !targetId) return;
    setSaving(true);
    try {
      const r = await electronAPI.mergeEntity(selected.id, targetId, prefer);
      if (!r?.success) { showToast(`Merge failed: ${r?.error || 'unknown error'}`, 'error'); return; }
      setMergePrompt(null);
      await load();
      if (r.entity) await openEntity(r.entity); else setSelected(null);
    } catch (e) { showToast(`Merge failed: ${e.message}`, 'error'); }
    finally { setSaving(false); }
  };
  // Picking a merge target: an imported entity carries its own data, so ask which side wins
  // on conflicts; a bare AI proposal has nothing to weigh, so merge straight into the target.
  const startMerge = (targetId) => {
    const t = entities.find(e => e.id === targetId);
    if (selected?.data?._imported) setMergePrompt({ id: targetId, name: t?.canonicalName || 'that entity' });
    else mergeInto(targetId, 'target');
  };
  // Candidates a proposal can fold into: every other real (non-proposed) entity.
  const mergeTargets = useMemo(() => entities.filter(e => e.id !== selected?.id && e.status !== 'proposed'), [entities, selected]);

  // Per-entity AI write permission. Persists immediately for saved entities; for an
  // unsaved draft it just rides along in data until the first save.
  const setAiPolicy = async (policy) => {
    patchData({ aiPolicy: policy });
    if (!selected?.id) return;
    try {
      const data = { ...(selected.data || {}), aiPolicy: policy };
      const r = await electronAPI.updateEntity(selected.id, { data });
      if (!r?.success) { showToast(`Could not change AI permission: ${r?.error || 'unknown error'}`, 'error'); return; }
      await load();
    } catch (e) { showToast(`Could not change AI permission: ${e.message}`, 'error'); }
  };

  // Update entities: read each non-locked entity's related chunks and let the AI refresh it.
  // The run lives in the main process, so it outlives this view. On mount we restore the
  // lock from the main-process status, and a broadcast completion event clears it, so
  // switching away and back keeps the overlay while the update is still running.
  useEffect(() => {
    if (!electronAPI.onEnrichEntitiesProgress) return;
    return electronAPI.onEnrichEntitiesProgress((p) => setEnrichProgress(p));
  }, [electronAPI]);

  // Restore the overlay if an update is already in flight when this view (re)mounts.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!electronAPI.getEnrichStatus) return;
      const s = await electronAPI.getEnrichStatus();
      if (cancelled || !s?.running || (s.workspaceId && s.workspaceId !== workspaceId)) return;
      setEnriching(true);
      if (s.progress) setEnrichProgress(s.progress);
    })();
    return () => { cancelled = true; };
  }, [electronAPI, workspaceId]);

  // Completion is broadcast, so it clears the lock and refreshes even if a different mount
  // of this view started the run. A ref keeps the handler's closure current without
  // re-subscribing on every render.
  const onEnrichComplete = async (res) => {
    setEnriching(false); setEnrichProgress(null);
    if (res && res.workspaceId && res.workspaceId !== workspaceId) return;
    if (res && res.success) {
      await load();
      await loadEnrichErrors();
      if (selected?.id) { const cur = (await electronAPI.getEntity(selected.id))?.entity; if (cur) await openEntity(cur); }
      const bits = [`${res.updated} updated`];
      if (res.staged) bits.push(`${res.staged} staged for review`);
      if (res.upToDate) bits.push(`${res.upToDate} with no unprocessed evidence`);
      if (res.noEvidence) bits.push(`${res.noEvidence} with no matching evidence`);
      if (res.evidenceUsed) bits.push(`${res.evidenceUsed} evidence passages read`);
      if (res.taggedEvidenceRemaining) bits.push(`${res.taggedEvidenceRemaining} tagged passages pending`);
      if (res.textMatchesDeferred) bits.push(`${res.textMatchesDeferred} lower-priority text matches deferred`);
      if (res.canonicalSuggestionCount) bits.push(`${res.canonicalSuggestionCount} entity suggestions`);
      if (res.kanoraSuggestionCount) bits.push(`${res.kanoraSuggestionCount} Kanora suggestions`);
      if (res.emptyFieldSuggestions) bits.push(`${res.emptyFieldSuggestions} empty field suggestions`);
      if (res.emptyFieldsWithoutSupport) bits.push(`${res.emptyFieldsWithoutSupport} empty fields without supporting evidence`);
      if (res.emptyFieldsAwaitingEvidence) bits.push(`${res.emptyFieldsAwaitingEvidence} empty fields still awaiting deferred evidence`);
      if (res.tokenUsage?.inputTokens) bits.push(`~${res.tokenUsage.inputTokens.toLocaleString()} input tokens`);
      if (res.tokenUsage?.outputTokens) bits.push(`~${res.tokenUsage.outputTokens.toLocaleString()} output tokens`);
      if (res.failed) bits.push(`${res.failed} failed`);
      if (res.stoppedEarly && res.remaining) bits.push(`${res.remaining} left pending after repeated structured-output failures`);
      const summary = bits.join(', ');
      if (res.failed) {
        setShowEnrichErrors(true);
      }
      if (res.failed && !res.updated) {
        setEnrichErrorSummary(`Update Failed: ${summary}.`);
      } else {
        setEnrichErrorSummary('');
        showToast(`Update complete: ${summary}.`, res.failed ? 'error' : 'success');
      }
    } else if (res) {
      showToast(`Update failed: ${res.error || 'unknown error'}`, 'error');
    }
  };
  const dismissEnrichError = async (id) => {
    const result = await electronAPI.dismissEntityEnrichmentError?.(id);
    if (result?.success) setEnrichErrors(current => {
      const next = current.filter(item => item.id !== id);
      if (!next.length) setShowEnrichErrors(false);
      return next;
    });
  };
  const dismissAllEnrichErrors = async () => {
    const ids = enrichErrors.map(error => error.id);
    const results = await Promise.all(ids.map(id => electronAPI.dismissEntityEnrichmentError?.(id)));
    const dismissed = new Set(ids.filter((_, index) => results[index]?.success));
    setEnrichErrors(current => current.filter(error => !dismissed.has(error.id)));
    if (dismissed.size === ids.length) setShowEnrichErrors(false);
    else showToast('Some update errors could not be dismissed.', 'error');
  };
  const onEnrichCompleteRef = useRef(onEnrichComplete);
  onEnrichCompleteRef.current = onEnrichComplete;
  useEffect(() => {
    if (!electronAPI.onEnrichEntitiesComplete) return;
    return electronAPI.onEnrichEntitiesComplete((res) => onEnrichCompleteRef.current(res));
  }, [electronAPI]);

  const runEnrichment = async () => {
    if (enriching || !workspaceId) return;
    if (!hasSystemAi) { showToast('System AI needs both an API Connection and a model in Settings → Engine & Memory.', 'error'); return; }
    setEnriching(true); setEnrichProgress(null);
    // The completion event drives the toast, reload and clearing of the overlay. Here we
    // only surface a failure to even start the run (e.g. one is already in flight).
    try {
      const r = await electronAPI.enrichEntities(workspaceId);
      if (r && r.success === false) { setEnriching(false); showToast(`Update failed: ${r.error || 'unknown error'}`, 'error'); }
    } catch (e) { setEnriching(false); showToast(`Update failed: ${e.message}`, 'error'); }
  };

  // Export this workspace's Worldbuild to a portable file; import merges one back in
  // (de-duped by name+type, non-destructive).
  const exportWorld = async () => {
    const r = await electronAPI.exportWorldbuild(workspaceId);
    if (r?.cancelled) return;
    if (!r?.success) { showToast(`Export failed: ${r?.error || 'unknown error'}`, 'error'); return; }
    const ent = `${r.entities} ${r.entities === 1 ? 'entity' : 'entities'}`;
    const con = r.links ? ` and ${r.links} ${r.links === 1 ? 'connection' : 'connections'}` : '';
    showToast(`Exported ${ent}${con}.`, 'success');
  };
  const importWorld = async () => {
    const r = await electronAPI.importWorldbuild(workspaceId);
    if (r?.cancelled) return;
    if (!r?.success) { showToast(`Import failed: ${r?.error || 'unknown error'}`, 'error'); return; }
    await load();
    const linkBit = r.linksAdded ? ` and ${r.linksAdded} link${r.linksAdded === 1 ? '' : 's'}` : '';
    const calendarBit = r.calendarConflict ? ' The package uses a different calendar, so your current calendar was preserved.' : r.calendarImported ? ' Its calendar was imported too.' : '';
    showToast(`Imported ${r.entitiesAdded} entit${r.entitiesAdded === 1 ? 'y' : 'ies'}${linkBit} for review. Accept, merge, or dismiss each in the sidebar.${calendarBit}`, r.calendarConflict ? 'info' : 'success');
  };

  // Resolve a staged 'review' enrichment proposal (data._enrichPending). Accept applies
  // the named fields/lore to the live record, reject drops them; the sheet reloads so the
  // remaining staged bits (if any) stay visible.
  const resolveReview = async (accept = {}, reject = {}) => {
    if (!selected?.id) return;
    setSaving(true);
    try {
      const r = await electronAPI.resolveEnrichReview(selected.id, accept, reject);
      if (!r?.success) { showToast(`Review failed: ${r?.error || 'unknown error'}`, 'error'); return; }
      await load();
      if (r.entity) await openEntity(r.entity, { preserveTab: true });
    } catch (e) { showToast(`Review failed: ${e.message}`, 'error'); }
    finally { setSaving(false); }
  };

  const reloadRel = async () => { await loadRelations({ id: selected.id, type: selected.type }); await load(); };
  // Every link op reports failure loudly, a silent SQL error once made every add
  // look like a no-op. Any { success:false } surfaces as a toast instead of vanishing.
  const linkOp = async (fn) => {
    try { const r = await fn(); if (r && r.success === false) { showToast(`Link failed: ${r.error || 'unknown error'}`, 'error'); return false; } await reloadRel(); return true; }
    catch (e) { showToast(`Link failed: ${e.message}`, 'error'); return false; }
  };
  const setSingle = async (relType, toId) => { if (!selected?.id) return; await linkOp(() => electronAPI.setEntityLink({ workspaceId, fromId: selected.id, relType, toId, single: true })); };
  const addMulti = async (relType, toId, fromSelected = true) => { if (!selected?.id) return; await linkOp(() => electronAPI.setEntityLink({ workspaceId, fromId: fromSelected ? selected.id : toId, relType, toId: fromSelected ? toId : selected.id, single: false })); };
  const addInventory = async (itemId) => { await linkOp(() => electronAPI.setEntityLink({ workspaceId, fromId: itemId, relType: 'owned_by', toId: selected.id, single: true })); };
  const addRelationship = async (toId, label) => { if (!selected?.id) return; await linkOp(() => electronAPI.setEntityLink({ workspaceId, fromId: selected.id, relType: 'related_to', toId, single: false, label })); };
  const setRole = async (linkId, role) => { await linkOp(() => electronAPI.updateEntityLinkLabel(linkId, role)); };
  const removeLink = async (linkId) => { await linkOp(() => electronAPI.removeEntityLink(linkId)); };

  // Leaving and rejoining a faction swap one edge for the other. Membership is its own
  // relation on purpose: everything that reads member_of (retrieval context, the
  // epistemic resolver, occurrence audiences) means "member right now", so a former
  // member stops receiving what the faction shares without any of them changing.
  // The label carries the departure in plain words, since the retrieval dossier prints
  // it verbatim; the old role is kept in metadata so rejoining can restore it.
  const swapMembership = async (link, relType, label, metadata) => {
    if (!selected?.id) return;
    await linkOp(async () => {
      const created = await electronAPI.setEntityLink({
        workspaceId, fromId: link.entity.id, relType, toId: selected.id, single: false, label, metadata,
      });
      if (created && created.success === false) return created;
      return electronAPI.removeEntityLink(link.linkId);
    });
  };
  // A tenure carries its own record: when it began, when it ended, and whether this is
  // the person the faction started with. Leaving keeps all of it.
  const tenureOf = (link) => {
    const meta = link.metadata || {};
    return { ...(meta.joined ? { joined: meta.joined } : {}), ...(meta.founder ? { founder: true } : {}) };
  };
  const markFormerMember = async (link) => {
    const role = (link.label || '').trim();
    await swapMembership(link, 'former_member_of', role ? `former ${role}` : 'former member', { ...tenureOf(link), ...(role ? { role } : {}) });
  };
  const restoreMember = async (link) => {
    const role = String(link.metadata?.role || '').trim();
    await swapMembership(link, 'member_of', role, tenureOf(link));
  };
  const setMemberMeta = async (link, patch) => {
    await linkOp(() => electronAPI.updateEntityLink(link.linkId, { metadata: { ...(link.metadata || {}), ...patch } }));
  };
  const setMemberRole = async (link, value) => { await setRole(link.linkId, value); };
  // A departure carries the rank in two places: the label the dossier prints, and the
  // rank kept for a return. Editing one has to move the other.
  const setFormerRole = async (link, value) => {
    const rank = value.trim().replace(/^former\s+/i, '');
    await linkOp(() => electronAPI.updateEntityLink(link.linkId, {
      label: value.trim() || 'former member',
      metadata: { ...(link.metadata || {}), ...(rank ? { role: rank } : {}) },
    }));
  };
  // Leading a faction without belonging to it made no sense, so naming a leader puts them
  // on the roster. Someone who had left keeps the rank and dates they already had.
  const setFactionLeader = async (characterId) => {
    if (!selected?.id) return;
    const alreadyMember = (rel.members || []).some(link => link.entity.id === characterId);
    const former = (rel.formerMembers || []).find(link => link.entity.id === characterId);
    await linkOp(async () => {
      const led = await electronAPI.setEntityLink({ workspaceId, fromId: selected.id, relType: 'led_by', toId: characterId, single: true });
      if (led && led.success === false) return led;
      if (!characterId || alreadyMember) return led;
      return electronAPI.setEntityLink({
        workspaceId, fromId: characterId, relType: 'member_of', toId: selected.id, single: false,
        label: String(former?.metadata?.role || '').trim() || 'Leader',
        metadata: former ? tenureOf(former) : {},
      });
    });
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = entities.filter(en =>
      (!filterType || en.type === filterType) &&
      (!reviewFilter || (reviewFilter === 'proposed' ? en.status === 'proposed' : en.status !== 'proposed' && ((reviewCounts[en.id]?.entityUpdates || 0) > 0 || (reviewCounts[en.id]?.kanora || 0) > 0))) &&
      (!q || [en.canonicalName, ...(en.aliases || [])].join(' ').toLowerCase().includes(q))
    );
    return list.sort((a, b) => (TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type)) || a.canonicalName.localeCompare(b.canonicalName));
  }, [entities, search, filterType, reviewFilter, reviewCounts]);
  const locationTree = useMemo(() => buildLocationTree(entities, insideLinks), [entities, insideLinks]);
  const useLocationTree = !search.trim() && !reviewFilter && (!filterType || filterType === 'Locations');
  const toggleLocation = (id) => setExpandedLocations(current => ({ ...current, [id]: current[id] === false }));
  const proposedCount = useMemo(() => entities.filter(e => e.status === 'proposed').length, [entities]);
  const pendingUpdateCount = useMemo(() => entities.filter(e => e.status !== 'proposed' && ((reviewCounts[e.id]?.entityUpdates || 0) > 0 || (reviewCounts[e.id]?.kanora || 0) > 0)).length, [entities, reviewCounts]);
  const exportableCount = useMemo(() => entities.filter(e => e.status !== 'proposed').length, [entities]);
  const selectedEntities = useMemo(() => entities.filter(entity => selectedIds.has(entity.id)), [entities, selectedIds]);
  const visibleIds = useMemo(() => new Set(filtered.map(entity => entity.id)), [filtered]);
  const hiddenSelectedCount = useMemo(() => selectedEntities.filter(entity => !visibleIds.has(entity.id)).length, [selectedEntities, visibleIds]);
  const selectedProposedCount = selectedEntities.filter(entity => entity.status === 'proposed').length;
  const selectedUpdateCount = selectedEntities.filter(entity => entity.status !== 'proposed' && ((reviewCounts[entity.id]?.entityUpdates || 0) > 0 || (reviewCounts[entity.id]?.kanora || 0) > 0)).length;
  const selectedConfirmedCount = selectedEntities.length - selectedProposedCount;

  useEffect(() => {
    if (reviewFilter === 'proposed' && proposedCount === 0) setReviewFilter(null);
    if (reviewFilter === 'updates' && pendingUpdateCount === 0) setReviewFilter(null);
  }, [reviewFilter, proposedCount, pendingUpdateCount]);

  const toggleEntitySelection = (id) => setSelectedIds(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const selectEntities = list => setSelectedIds(new Set(list.map(entity => entity.id)));
  const selectVisibleEntities = () => setSelectedIds(current => new Set([...current, ...filtered.map(entity => entity.id)]));
  const leaveManageMode = () => { setManageMode(false); setSelectedIds(new Set()); };
  const moveFilterStrip = direction => filterStripRef.current?.scrollBy({ left: direction * 180, behavior: 'smooth' });

  const runBulkAction = async (action, policy = null) => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    setBulkSaving(true);
    try {
      const result = await electronAPI.bulkManageEntities(workspaceId, ids, action, policy);
      if (!result?.success) throw new Error(result?.error || 'bulk action failed');
      if (action === 'policy') showToast(`AI policy changed for ${result.updated} entit${result.updated === 1 ? 'y' : 'ies'}${result.skipped ? `; ${result.skipped} proposal${result.skipped === 1 ? '' : 's'} skipped` : ''}.`, 'success');
      else if (action === 'accept-proposed') showToast(`Accepted ${result.accepted} proposed entit${result.accepted === 1 ? 'y' : 'ies'}.`, 'success');
      else if (action === 'accept-updates') showToast(`Accepted AI updates for ${result.accepted} entit${result.accepted === 1 ? 'y' : 'ies'}.`, 'success');
      else if (action === 'reject-proposed') showToast(`Rejected ${result.rejected} proposed entit${result.rejected === 1 ? 'y' : 'ies'}.`, 'success');
      else if (action === 'reject-updates') showToast(`Rejected AI updates for ${result.rejected} entit${result.rejected === 1 ? 'y' : 'ies'}.`, 'success');
      else if (action === 'reprocess') showToast(`${result.reset} entit${result.reset === 1 ? 'y is' : 'ies are'} ready to be reprocessed.`, 'success');
      else if (action === 'delete') showToast(`Deleted ${result.deleted} entit${result.deleted === 1 ? 'y' : 'ies'}.`, 'success');
      const selectedId = selected?.id;
      if (selectedId && ids.includes(selectedId) && (action === 'delete' || (action === 'reject-proposed' && selected?.status === 'proposed'))) setSelected(null);
      setSelectedIds(new Set());
      setBulkConfirm(null);
      await load();
      if (action !== 'delete' && selectedId && ids.includes(selectedId)) {
        const refreshed = await electronAPI.getEntity(selectedId);
        if (refreshed?.entity) await openEntity(refreshed.entity);
      }
    } catch (error) {
      showToast(`Bulk action failed: ${error.message}`, 'error');
    } finally {
      setBulkSaving(false);
    }
  };

  const requestBulkConfirmation = async action => {
    const ids = [...selectedIds];
    if (!ids.length) return;
    try {
      const summary = await electronAPI.summarizeBulkEntities(workspaceId, ids);
      if (!summary?.success) throw new Error(summary?.error || 'could not inspect selection');
      setBulkConfirm({ action, summary });
    } catch (error) {
      showToast(`Could not inspect selection: ${error.message}`, 'error');
    }
  };

  const isUniqueItem = selected?.type === 'Items' && selected?.data?.itemNature === 'unique';
  const isItemType = selected?.type === 'Items' && !isUniqueItem;
  const unsaved = isNew;

  // Owner as a single 3-mode choice: the AI decides, it is deliberately lost, or a
  // character holds it. A character owner is an owned_by edge; the two ownerless modes
  // live in data.ownership. Picking a character also clears the ownerless flag.
  const ownerVal = rel.ownedBy ? rel.ownedBy.entity.id : (selected?.data?.ownership === 'lost' ? 'lost' : 'ai');
  const ownerOptions = [...byType.Characters, ...individualCreatures];
  const persistItemDraft = async () => {
    if (!selected?.id) return false;
    return Boolean(await persist());
  };
  const setOwner = async (val) => {
    if (!await persistItemDraft()) return;
    if (val === 'ai' || val === 'lost') { patchData({ ownership: val }); await setSingle('owned_by', null); }
    else { patchData({ ownership: 'character' }); await setSingle('located_in', null); await setSingle('owned_by', val); }
  };
  const ownerLabel = rel.ownedBy ? rel.ownedBy.entity.canonicalName : (selected?.data?.ownership === 'lost' ? 'Unknown / Lost' : 'AI decides');
  const setItemLocation = async (locationId) => {
    if (!await persistItemDraft()) return;
    if (locationId) await setSingle('owned_by', null);
    await setSingle('located_in', locationId || null);
  };

  // Lore editor (prose + Writing Desk file link), reused by several types.
  const linkedDocs = loreDocIds();
  const remainingDocs = documents.filter(d => !linkedDocs.includes(d.id));
  const loreEdit = (
    <>
      <Edit label="Lore"><LTextarea rows={5} placeholder="History, secrets, texture. Or link Writing Desk chapters below." value={selected?.lore || ''} onChange={(e) => patch({ lore: e.target.value })} /></Edit>
      <Edit label="Linked Writing Desk chapters" hint="Explicitly link chapters authored as canonical background for this entity. Ordinary story mentions remain available through the World Index.">
        <div className="flex flex-wrap gap-1.5 mb-2">
          {linkedDocs.length === 0 && <span className="caption">None linked.</span>}
          {linkedDocs.map(id => (
            <span key={id} className="inline-flex items-center gap-1 text-[0.6875rem] font-medium text-text-primary bg-surface-hover/65 border border-border-default rounded-full pl-2.5 pr-1 py-0.5">
              <ScrollText className="w-3 h-3 text-accent/80" />{docTitle(id) || 'Untitled'}
              <button onClick={() => removeLoreDoc(id)} className="text-text-muted hover:text-status-danger cursor-pointer p-0.5"><X className="w-3 h-3" /></button>
            </span>
          ))}
        </div>
        <EntityPickerButton label="Add chapter" title="Link a chapter" options={remainingDocs.map(d => ({ id: d.id, canonicalName: d.title }))} onPick={addLoreDoc} />
      </Edit>
    </>
  );
  const loreView = (
    <>
      <Prose text={selected?.lore} />
      {linkedDocs.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {linkedDocs.map(id => docTitle(id) && (
            <span key={id} className="inline-flex items-center gap-1.5 text-xs text-accent/90"><ScrollText className="w-3.5 h-3.5" />{docTitle(id)}</span>
          ))}
        </div>
      )}
    </>
  );

  // ---- Section model: each returns { key, title, icon, view, edit, scalar } ----
  const sectionsFor = (type) => {
    const S = [];
    if (type === 'System') {
      S.push({ key: 'concept', title: 'Concept', icon: BookOpen, scalar: true,
        view: <Prose text={selected.data.content} empty="No rules written yet." />,
        edit: <Edit label="Content"><LTextarea rows={10} placeholder="Rules and concepts of this universe the AI should always honor." value={selected.data.content || ''} onChange={(e) => patchData({ content: e.target.value })} /></Edit> });
    }
    if (type === 'Locations') {
      S.push({ key: 'overview', title: 'Overview', icon: MapPin, scalar: true,
        view: <>
          <FactGrid>
            <ViewField label="Type" value={selected.data.locationType} />
            <ViewField label="Inside" value={rel.inside?.entity?.canonicalName} />
            <ViewField label="Owner / leader" value={rel.leader?.entity?.canonicalName} />
          </FactGrid>
          <Prose text={selected.data.description} empty="No description." />
        </>,
        edit: <>
          <Edit label="Type"><LInput placeholder="e.g. continent / kingdom / city / tavern" value={selected.data.locationType || ''} onChange={(e) => patchData({ locationType: e.target.value })} /></Edit>
          <Edit label="Description"><LTextarea rows={5} placeholder="What this place looks and feels like, including its defining features." value={selected.data.description || ''} onChange={(e) => patchData({ description: e.target.value })} /></Edit>
          <SingleRelation label="Inside another place" hint="Nest this within a larger location." disabled={unsaved} current={rel.inside?.entity?.id} options={byType.Locations.filter(o => o.id !== selected.id)} onSet={(id) => setSingle('inside', id)} />
          <SingleRelation label="Owner / leader (optional)" hint="Who holds or rules this place, if anyone." disabled={unsaved} current={rel.leader?.entity?.id} options={byType.Characters} onSet={(id) => setSingle('led_by', id)} />
        </> });
      S.push({ key: 'lore', title: 'Lore', icon: ScrollText, scalar: true, view: loreView, edit: loreEdit });
    }
    if (type === 'Items') {
      S.push({ key: 'details', title: 'Details', icon: itemMeta(selected.data.itemType).icon, scalar: true,
        view: <>
          <FactGrid>
            <ViewField label="Nature" value={(selected.data.itemNature || 'type') === 'unique' ? 'Unique item' : 'Item type'} />
            <ViewField label="Category" value={selected.data.itemType} />
            {isUniqueItem && <ViewField label="Owner" value={ownerLabel} />}
            {isUniqueItem && <ViewField label="Current location" value={rel.locatedIn?.entity?.canonicalName} empty={rel.ownedBy ? `In ${rel.ownedBy.entity.canonicalName}'s inventory` : 'Not set'} />}
            <ViewField label="Creator" value={rel.createdBy?.entity?.canonicalName} empty="Unknown" />
            {isItemType && <ViewField label="Abundance" value={selected.data.abundance} />}
            {isItemType && <ViewField full label="Where found" value={<ChipList onOpen={openEntityById} links={rel.foundIn} empty="Not set" />} />}
            {isItemType && <ViewField full label="Where sold" value={<ChipList onOpen={openEntityById} links={rel.soldIn} empty="Not set" />} />}
          </FactGrid>
          <Prose text={selected.data.description} empty="No description." />
        </>,
        edit: <>
          <Edit label="Item nature" hint={(selected.data.itemNature || 'type') === 'unique' ? 'A unique item exists only once.' : 'An item type can appear in quantities.'}>
            <div className="flex w-fit rounded-control border border-border-subtle bg-surface-hover/40 p-0.5">
              {[['type', 'Item type'], ['unique', 'Unique item']].map(([value, label]) => <button key={value} type="button" onClick={() => patchData({ itemNature: value })} className={`rounded-md px-3 py-1.5 text-xs font-bold uppercase tracking-wider transition-colors ${(selected.data.itemNature || 'type') === value ? 'bg-accent text-on-accent' : 'text-text-muted hover:text-text-primary'}`}>{label}</button>)}
            </div>
          </Edit>
          <Edit label="Category">
            <SearchableSelect
              value={selected.data.itemType || ''}
              onChange={(itemType) => patchData({ itemType })}
              options={ITEM_TYPES.map(itemType => ({
                id: itemType,
                label: itemType,
                icon: itemMeta(itemType).icon,
                description: itemType === 'Resource' ? 'Natural resources and creature drops' : undefined,
              }))}
              placeholder="Choose a category…"
              searchPlaceholder="Filter item categories…"
              ariaLabel="Item category"
            />
          </Edit>
          <SingleRelation label="Creator" hint="Leave blank if unknown." disabled={unsaved} current={rel.createdBy?.entity?.id} options={byType.Characters} onSet={(id) => setSingle('created_by', id)} />
          {isUniqueItem && !unsaved && <Edit label="Owner" hint="A unique item can be in one inventory or one world location.">
            <div className="flex items-center gap-2 flex-wrap">
              <button type="button" onClick={() => setOwner('ai')} aria-pressed={ownerVal === 'ai'} className={`inline-flex min-h-9 items-center gap-2 rounded-control border px-3 py-2 text-xs font-semibold transition-colors ${ownerVal === 'ai' ? 'border-accent/40 bg-accent/15 text-accent' : 'border-border-default bg-surface-input/70 text-text-muted hover:border-border-strong hover:text-text-primary'}`}><Bot className="h-3.5 w-3.5" />AI decides</button>
              <button type="button" onClick={() => setOwner('lost')} aria-pressed={ownerVal === 'lost'} className={`inline-flex min-h-9 items-center gap-2 rounded-control border px-3 py-2 text-xs font-semibold transition-colors ${ownerVal === 'lost' ? 'border-accent/40 bg-accent/15 text-accent' : 'border-border-default bg-surface-input/70 text-text-muted hover:border-border-strong hover:text-text-primary'}`}><CircleHelp className="h-3.5 w-3.5" />Unknown / Lost</button>
              {rel.ownedBy && <div className="inline-flex min-h-9 items-center gap-2 rounded-control border border-accent/40 bg-accent/15 px-3 py-2 text-xs font-semibold text-accent"><User className="h-3.5 w-3.5" />{rel.ownedBy.entity.canonicalName}</div>}
              <EntityPickerButton icon={rel.ownedBy ? Replace : Plus} label={rel.ownedBy ? 'Change' : 'Choose entity'} title="Choose owner" options={ownerOptions} onPick={setOwner} />
            </div>
          </Edit>}
          {isUniqueItem && <SingleRelation label="Current location" hint="Setting a location removes this item from its current inventory." disabled={unsaved} current={rel.locatedIn?.entity?.id} options={byType.Locations} onSet={setItemLocation} />}
          {isItemType && <Edit label={<>Abundance <InfoPopover items={ABUNDANCE_HELP} /></>} hint="How common this item type is in the world."><LSelect value={selected.data.abundance || ''} onChange={(e) => patchData({ abundance: e.target.value })}><option value="">Choose…</option>{RARITY.map(r => <option key={r} value={r}>{r}</option>)}</LSelect></Edit>}
          {isItemType && <MultiRelation label="Where found" hint="Places where this item type can be found, gathered, or obtained." disabled={unsaved} links={rel.foundIn || []} options={byType.Locations} onAdd={(id) => addMulti('found_in', id)} onRemove={removeLink} />}
          {isItemType && <MultiRelation label="Where sold" hint="Places where this item type can normally be purchased." disabled={unsaved} links={rel.soldIn || []} options={byType.Locations} onAdd={(id) => addMulti('sold_in', id)} onRemove={removeLink} />}
          <Edit label="Description"><LTextarea rows={4} placeholder="What it looks like and does." value={selected.data.description || ''} onChange={(e) => patchData({ description: e.target.value })} /></Edit>
        </> });
      S.push({ key: 'lore', title: 'Lore', icon: ScrollText, scalar: true, view: loreView, edit: loreEdit });
    }
    if (type === 'Races') {
      S.push({ key: 'desc', title: 'Description', icon: Users, scalar: true, view: <Prose text={selected.data.description} />, edit: <Edit label="Description"><LTextarea rows={5} placeholder="Traits, appearance, culture." value={selected.data.description || ''} onChange={(e) => patchData({ description: e.target.value })} /></Edit> });
      S.push({ key: 'lore', title: 'Lore', icon: ScrollText, scalar: true, view: loreView, edit: loreEdit });
      S.push({ key: 'members', title: 'Known members', icon: User, scalar: false, derived: true, relationalOnly: true, view: <ChipList onOpen={openEntityById} links={rel.members} empty="Auto-filled as you assign this race to characters." />, edit: <ChipList onOpen={openEntityById} links={rel.members} empty="Auto-filled as you assign this race to characters." /> });
    }
    if (type === 'Creatures') {
      const natureOpts = [...CREATURE_NATURES, ...byType.Creatures.map(c => c.data?.nature).filter(Boolean)];
      const isIndividual = (selected.data.scope || 'individual') !== 'group';
      S.push({ key: 'details', title: 'Details', icon: Ghost, scalar: true,
        view: <>
          <FactGrid>
            <ViewField label="Kind" value={isIndividual ? 'A specific being' : 'A group / species'} />
            <ViewField label="Nature" value={selected.data.nature} />
            <ViewField label="Disposition" value={<StateTag map={DISPOSITION} value={selected.data.disposition || 'unknown'} />} />
            {isIndividual && <ViewField label="Status" value={<StateTag map={STATUS} value={selected.data.status || 'unknown'} />} />}
            {!isIndividual && <ViewField label="Abundance" value={selected.data.abundance} />}
            <ViewField label="Threat" value={selected.data.threat} />
            {isIndividual && <ViewField label="Born" value={formatWorldDate(worldCalendar, selected.data.birthDate)} />}
            {isIndividual && selected.data.status === 'deceased' && <ViewField label="Died" value={formatWorldDate(worldCalendar, selected.data.deathDate)} />}
            {isIndividual && selected.data.status === 'missing' && <ViewField label="Disappeared" value={formatWorldDate(worldCalendar, selected.data.missingDate)} />}
            <ViewField full label="Abilities & traits" value={selected.data.abilities} />
            <ViewField full label="Habitat" value={<ChipList onOpen={openEntityById} links={rel.foundIn} empty="Not set" />} />
          </FactGrid>
        </>,
        edit: <>
          <Edit label="This entity is">
            <div className="flex bg-surface-hover/40 p-0.5 rounded-control border border-border-subtle w-fit">
              {[['individual', 'A specific being'], ['group', 'A group / species']].map(([k, l]) => (
                <button key={k} type="button" onClick={() => patchData({ scope: k })} className={`px-3 py-1.5 rounded-md text-[0.625rem] font-bold uppercase tracking-wider transition-colors cursor-pointer ${(selected.data.scope || 'individual') === k ? 'bg-accent text-on-accent' : 'text-text-muted hover:text-text-primary'}`}>{l}</button>
              ))}
            </div>
            <Hint>A group (goblins, a wolf pack) has no single life state. A specific being (one tamed wolf) does.</Hint>
            {isIndividual && (rel.inventory?.length || 0) + (rel.relationships?.length || 0) > 0 && (
              <Hint>Turning this into a group hides its inventory, connections and knowledge. Nothing is deleted, and switching back brings them into view again.</Hint>
            )}
          </Edit>
          <Edit label="Nature / category" hint="What kind of thing it is. Type your own or reuse one."><FreeDatalist value={selected.data.nature} onChange={(e) => patchData({ nature: e.target.value })} options={natureOpts} placeholder="e.g. Beast, Spirit, Deity" /></Edit>
          <div className="grid grid-cols-2 gap-3">
            <Edit label="Disposition"><StateSelect map={DISPOSITION} value={selected.data.disposition || 'unknown'} onChange={(e) => patchData({ disposition: e.target.value })} /></Edit>
            {isIndividual && <Edit label="Status"><StateSelect map={STATUS} value={selected.data.status || 'unknown'} onChange={(e) => patchData({ status: e.target.value })} /></Edit>}
            {!isIndividual && <Edit label={<>Abundance <InfoPopover items={ABUNDANCE_HELP} /></>}><LSelect value={selected.data.abundance || ''} onChange={(e) => patchData({ abundance: e.target.value })}><option value="">Choose…</option>{RARITY.map(r => <option key={r} value={r}>{r}</option>)}</LSelect></Edit>}
            <Edit label="Threat"><LSelect value={selected.data.threat || ''} onChange={(e) => patchData({ threat: e.target.value })}><option value="">Choose…</option>{THREAT.map(t => <option key={t} value={t}>{t}</option>)}</LSelect></Edit>
          </div>
          <Edit label="Abilities & traits" hint="Short, concrete powers the AI can use in a scene."><LTextarea rows={3} placeholder="e.g. flies, breathes fire, immune to steel." value={selected.data.abilities || ''} onChange={(e) => patchData({ abilities: e.target.value })} /></Edit>
          {isIndividual && worldCalendar && <Edit label="Birth date">
            <WorldDateInput label="Birth date" emptyLabel="Set birth date" calendar={worldCalendar} value={selected.data.birthDate} onChange={birthDate => patchData({ birthDate })} />
            <div className="mt-2"><Checkbox checked={Boolean(selected.data.showBirthday)} onChange={showBirthday => patchData({ showBirthday })} label="Show birthday in Calendar" /></div>
          </Edit>}
          {isIndividual && selected.data.status === 'deceased' && worldCalendar && <Edit label="Death date"><WorldDateInput label="Death date" emptyLabel="Set death date" calendar={worldCalendar} value={selected.data.deathDate} onChange={deathDate => patchData({ deathDate })} /></Edit>}
          {isIndividual && selected.data.status === 'missing' && worldCalendar && <Edit label="Disappearance date"><WorldDateInput label="Disappearance date" emptyLabel="Set disappearance date" calendar={worldCalendar} value={selected.data.missingDate} onChange={missingDate => patchData({ missingDate })} /></Edit>}
          <MultiRelation label="Habitat" hint="Where it is found or dwells." disabled={unsaved} links={rel.foundIn || []} options={byType.Locations} onAdd={(id) => addMulti('found_in', id)} onRemove={removeLink} />
        </> });
      S.push({ key: 'lore', title: 'Lore', icon: ScrollText, scalar: true, view: loreView, edit: loreEdit });
    }
    if (type === 'Factions') {
      S.push({ key: 'desc', title: 'Description', icon: Flag, scalar: true, view: <Prose text={selected.data.description} />, edit: <Edit label="Description"><LTextarea rows={5} placeholder="Goals, structure, reputation." value={selected.data.description || ''} onChange={(e) => patchData({ description: e.target.value })} /></Edit> });
      S.push({ key: 'lore', title: 'Lore', icon: ScrollText, scalar: true, view: loreView, edit: loreEdit });
    }
    if (type === 'Events') {
      const kindOpts = ['Battle', 'Festival', 'Holiday', 'Disaster', 'Ceremony', 'Discovery'];
      S.push({ key: 'overview', title: 'Overview', icon: CalendarClock, scalar: true,
        view: <>
          <FactGrid>
            <ViewField label="Event type" value={(selected.data.eventNature || 'one-time') === 'recurring' ? 'Recurring event' : 'One-time event'} />
            <ViewField label="Kind" value={selected.data.kind} />
            {(selected.data.eventNature || 'one-time') === 'recurring'
              ? <ViewField full label="Schedule" value={selected.data.recurrence?.anchorDate ? `${formatWorldDate(worldCalendar, selected.data.recurrence.anchorDate)} · every ${selected.data.recurrence.interval || 1} ${selected.data.recurrence.unit || 'year'}(s)` : null} />
              : <ViewField full label="Date" value={selected.data.startDate ? `${formatWorldDate(worldCalendar, selected.data.startDate)}${selected.data.endDate ? ` to ${formatWorldDate(worldCalendar, selected.data.endDate)}` : ''}` : null} />}
            <ViewField full label="Where it happened" value={<ChipList onOpen={openEntityById} links={rel.happenedAt} empty="No place set." />} />
            <ViewField full label="Who was involved" value={<ChipList onOpen={openEntityById} links={rel.involved} empty="No one set." />} />
          </FactGrid>
        </>,
        edit: <>
          <Edit label="Event type">
            <div className="flex w-fit rounded-control border border-border-subtle bg-surface-hover/40 p-0.5">
              {[['one-time', 'One-time event'], ['recurring', 'Recurring event']].map(([value, label]) => <button key={value} type="button" onClick={() => patchData({ eventNature: value })} className={`rounded-md px-3 py-1.5 text-xs font-bold uppercase tracking-wider ${(selected.data.eventNature || 'one-time') === value ? 'bg-accent text-on-accent' : 'text-text-muted hover:text-text-primary'}`}>{label}</button>)}
            </div>
          </Edit>
          <Edit label="Kind" hint="What sort of event. Type your own or reuse one."><FreeDatalist value={selected.data.kind} onChange={(e) => patchData({ kind: e.target.value })} options={kindOpts} placeholder="e.g. Battle, Festival, Holiday" /></Edit>
          {worldCalendar && (selected.data.eventNature || 'one-time') === 'recurring' ? (
            <>
              <Edit label="First occurrence"><WorldDateInput label="First occurrence" emptyLabel="Set the first occurrence" calendar={worldCalendar} value={selected.data.recurrence?.anchorDate} onChange={anchorDate => patchData({ recurrence: { ...(selected.data.recurrence || {}), anchorDate } })} /></Edit>
              <Edit label="Repeats every"><div className="grid grid-cols-[7rem_1fr] gap-2"><LInput type="number" min="1" value={selected.data.recurrence?.interval || 1} onChange={event => patchData({ recurrence: { ...(selected.data.recurrence || {}), interval: Math.max(1, Number(event.target.value) || 1) } })} /><LSelect value={selected.data.recurrence?.unit || 'year'} onChange={event => patchData({ recurrence: { ...(selected.data.recurrence || {}), unit: event.target.value } })}><option value="day">Days</option><option value="week">Weeks</option><option value="month">Months</option><option value="year">Years</option></LSelect></div></Edit>
            </>
          ) : worldCalendar ? (
            <>
              <Edit label="Start date"><WorldDateInput label="Start date" emptyLabel="Set start date" calendar={worldCalendar} value={selected.data.startDate} onChange={startDate => patchData({ startDate })} /></Edit>
              <Edit label="End date" hint="Optional. Leave blank for a single-day event."><WorldDateInput label="End date" emptyLabel="Add end date" calendar={worldCalendar} value={selected.data.endDate} onChange={endDate => patchData({ endDate })} /></Edit>
            </>
          ) : null}
          <MultiRelation label="Where it happened" hint="Places this event took place." disabled={unsaved} links={rel.happenedAt || []} options={byType.Locations} onAdd={(id) => addMulti('happened_at', id)} onRemove={removeLink} />
          <MultiRelation label="Who was involved" hint="Characters who took part." disabled={unsaved} links={rel.involved || []} options={byType.Characters} onAdd={(id) => addMulti('involved', id)} onRemove={removeLink} />
        </> });
      S.push({ key: 'desc', title: 'Description', icon: CalendarClock, scalar: true, view: <Prose text={selected.data.description} />, edit: <Edit label="Description"><LTextarea rows={5} placeholder="What happened, and why it matters." value={selected.data.description || ''} onChange={(e) => patchData({ description: e.target.value })} /></Edit> });
      S.push({ key: 'lore', title: 'Lore', icon: ScrollText, scalar: true, view: loreView, edit: loreEdit });
    }
    return S;
  };

  // Belonging reads the same whoever is doing it, so the section is written once and both
  // the character sheet and a specific being's sheet render it.
  const membershipSection = (hint) => {
    const pastFactions = rel.formerMemberOf || [];
    const previously = pastFactions.length > 0 && (
      <div className="flex flex-wrap gap-1.5">{pastFactions.map(l => <EntityChip key={l.linkId} entity={l.entity} label={l.label} onOpen={openEntityById} />)}</div>
    );
    return { key: 'fac', title: 'Factions', icon: Flag, scalar: false,
      view: <>
        <ChipList onOpen={openEntityById} links={rel.memberOf} empty="Belongs to no faction." />
        {previously && <div className="mt-3 border-t border-border-subtle pt-3">
          <div className="eyebrow mb-1.5">Previously</div>
          {previously}
        </div>}
      </>,
      edit: <>
        <MultiRelation label="Factions" hint={hint} disabled={unsaved} links={rel.memberOf || []} options={byType.Factions} onAdd={(id) => addMulti('member_of', id)} onRemove={removeLink} />
        {previously && <Edit label="Previously" hint="Departures are recorded on the faction sheet.">{previously}</Edit>}
      </> };
  };

  // Character sheet is tabbed; build its sections per active tab.
  const characterSections = () => {
    if (charTab === 'data') return [
      { key: 'identity', title: 'Identity', icon: User, scalar: true,
        view: <>
          <FactGrid>
            <ViewField label="Status" value={<StateTag map={STATUS} value={selected.data.status || 'unknown'} />} />
            <ViewField label="Age" value={selected.data.age} />
            <ViewField label="Race" value={rel.isRace?.entity?.canonicalName} />
            <ViewField label="Born" value={formatWorldDate(worldCalendar, selected.data.birthDate)} />
            {selected.data.status === 'deceased' && <ViewField label="Died" value={formatWorldDate(worldCalendar, selected.data.deathDate)} />}
            {selected.data.status === 'missing' && <ViewField label="Disappeared" value={formatWorldDate(worldCalendar, selected.data.missingDate)} />}
          </FactGrid>
        </>,
        edit: <>
          <div className="grid grid-cols-2 gap-3">
            <Edit label="Age"><LInput placeholder="e.g. 34" value={selected.data.age || ''} onChange={(e) => patchData({ age: e.target.value })} /></Edit>
            <Edit label="Status"><StateSelect map={STATUS} value={selected.data.status || 'unknown'} onChange={(e) => patchData({ status: e.target.value })} /></Edit>
          </div>
          <SingleRelation label="Race" disabled={unsaved} current={rel.isRace?.entity?.id} options={byType.Races} onSet={(id) => setSingle('is_race', id)} />
          {worldCalendar && <Edit label="Birth date">
            <WorldDateInput label="Birth date" emptyLabel="Set birth date" calendar={worldCalendar} value={selected.data.birthDate} onChange={birthDate => patchData({ birthDate })} />
            <div className="mt-2"><Checkbox checked={Boolean(selected.data.showBirthday)} onChange={showBirthday => patchData({ showBirthday })} label="Show birthday in Calendar" /></div>
          </Edit>}
          {selected.data.status === 'deceased' && worldCalendar && <Edit label="Death date"><WorldDateInput label="Death date" emptyLabel="Set death date" calendar={worldCalendar} value={selected.data.deathDate} onChange={deathDate => patchData({ deathDate })} /></Edit>}
          {selected.data.status === 'missing' && worldCalendar && <Edit label="Disappearance date"><WorldDateInput label="Disappearance date" emptyLabel="Set disappearance date" calendar={worldCalendar} value={selected.data.missingDate} onChange={missingDate => patchData({ missingDate })} /></Edit>}
        </> },
      { key: 'appearance', title: 'Appearance', icon: User, scalar: true, view: <Prose text={selected.data.appearance} />, edit: <Edit label="Appearance"><LTextarea rows={5} placeholder="Physical presence, clothing, and distinguishing features." value={selected.data.appearance || ''} onChange={(e) => patchData({ appearance: e.target.value })} /></Edit> },
      { key: 'personality', title: 'Personality', icon: Users, scalar: true, view: <Prose text={selected.data.personality} />, edit: <Edit label="Personality"><LTextarea rows={5} placeholder="Temperament, habits, values, and contradictions." value={selected.data.personality || ''} onChange={(e) => patchData({ personality: e.target.value })} /></Edit> },
      { key: 'lore', title: 'Lore', icon: ScrollText, scalar: true, view: loreView, edit: loreEdit },
    ];
    if (charTab === 'inventory') return [
      { key: 'inv', raw: <WorldbuildInventory workspaceId={workspaceId} subject={selected} links={rel.inventory || []} options={byType.Items} api={electronAPI} showToast={showToast} onChanged={() => loadRelations(selected)} /> },
    ];
    return [
      membershipSection('Groups this character belongs to.'),
      { key: 'loc', title: 'Locations', icon: MapPin, scalar: false, view: <ChipList onOpen={openEntityById} links={rel.connectedTo} empty="Tied to no place." />, edit: <MultiRelation label="Locations" hint="Places this character is tied to." disabled={unsaved} links={rel.connectedTo || []} options={byType.Locations} onAdd={(id) => addMulti('connected_to', id)} onRemove={removeLink} /> },
      { key: 'rels', raw: <WorldbuildRelationships workspaceId={workspaceId} subject={selected} links={rel.relationships || []} options={[...byType.Characters, ...individualCreatures]} api={electronAPI} showToast={showToast} onChanged={() => loadRelations(selected)} /> },
    ];
  };

  // Faction sheet mirrors the Character one: Data holds what a faction is, the
  // connections tab holds who it is made of and how it stands with the world.
  const factionSections = () => {
    if (charTab !== 'connections') return sectionsFor('Factions');
    const leaderId = rel.leader?.entity?.id;
    const founders = [...(rel.members || []), ...(rel.formerMembers || [])].filter(link => link.metadata?.founder);
    // A roster is not only people: a bonded mount, a familiar or a dragon at the head of a
    // cult belongs to the group as much as any of its members do.
    const candidates = [...byType.Characters, ...individualCreatures];
    const roster = (editing) => (
      <MemberList links={rel.members} calendar={worldCalendar} leaderId={leaderId} editing={editing}
        options={candidates} onOpen={openEntityById} onAdd={(id) => addMulti('member_of', id, false)}
        onSetRole={setMemberRole} onSetMeta={setMemberMeta} onSetFormer={markFormerMember} onRemove={removeLink}
        empty="No members yet." />
    );
    return [
      { key: 'overview', title: 'Command & territory', icon: MapPin, scalar: true,
        view: <FactGrid>
          <ViewField label="Leader" value={rel.leader?.entity?.canonicalName} />
          <ViewField label="Founded" value={formatWorldDate(worldCalendar, selected.data.foundedDate)} empty="Unknown" />
          <ViewField full label="Founded by" value={founders.length
            ? <div className="flex flex-wrap gap-1.5">{founders.map(link => <EntityChip key={link.linkId} entity={link.entity} onOpen={openEntityById} />)}</div>
            : null} empty="Not recorded" />
          <ViewField full label="Area of operation" value={<ChipList onOpen={openEntityById} links={rel.operatesIn} empty="No territory set." />} />
        </FactGrid>,
        edit: <>
          <SingleRelation label="Leader (optional)" hint="Who heads this faction. They join the roster automatically, with an editable rank." disabled={unsaved} current={leaderId} options={candidates} onSet={setFactionLeader} />
          {worldCalendar && <Edit label="Founded" hint="When this faction came into being."><WorldDateInput label="Founded" emptyLabel="Set founding date" calendar={worldCalendar} value={selected.data.foundedDate} onChange={foundedDate => patchData({ foundedDate })} /></Edit>}
          <Edit label="Founded by" hint="Mark a founder with the star on their row in Members or Former members.">
            {founders.length
              ? <div className="flex flex-wrap gap-1.5">{founders.map(link => <EntityChip key={link.linkId} entity={link.entity} onOpen={openEntityById} />)}</div>
              : <span className="caption">Nobody marked yet.</span>}
          </Edit>
          <MultiRelation label="Origin / area of operation" hint="Locations this faction works out of." disabled={unsaved} links={rel.operatesIn || []} options={byType.Locations} onAdd={(id) => addMulti('operates_in', id)} onRemove={removeLink} />
        </> },
      { key: 'members', title: 'Members', icon: Users, scalar: false,
        view: roster(false),
        edit: unsaved ? null : roster(true) },
      { key: 'formerMembers', title: 'Former members', icon: UserMinus, scalar: false,
        view: <MemberList links={rel.formerMembers} calendar={worldCalendar} kind="former" onOpen={openEntityById} empty="Nobody has left yet." />,
        edit: <div>
          <p className="caption mb-2">They keep what they already knew. From here on, whatever the faction shares with all members no longer reaches them.</p>
          <MemberList links={rel.formerMembers} calendar={worldCalendar} kind="former" editing onOpen={openEntityById}
            onSetRole={setFormerRole} onSetMeta={setMemberMeta} onRestore={restoreMember} onRemove={removeLink}
            empty="Nobody has left yet." />
        </div> },
      { key: 'diplomacy', raw: <WorldbuildRelationships title="Relations" workspaceId={workspaceId} subject={selected} links={rel.relationships || []} options={[...byType.Factions.filter(entity => entity.id !== selected.id), ...byType.Characters, ...individualCreatures]} api={electronAPI} showToast={showToast} onChanged={() => loadRelations(selected)} /> },
    ];
  };

  const individualCreatureSections = () => {
    if (charTab === 'inventory') return [{ key: 'inv', raw: <WorldbuildInventory workspaceId={workspaceId} subject={selected} links={rel.inventory || []} options={byType.Items} api={electronAPI} showToast={showToast} onChanged={() => loadRelations(selected)} /> }];
    if (charTab === 'connections') return [
      membershipSection('Groups this being belongs to. A pack, a cult, or the household that keeps it.'),
      { key: 'rels', raw: <WorldbuildRelationships workspaceId={workspaceId} subject={selected} links={rel.relationships || []} options={[...byType.Characters, ...individualCreatures]} api={electronAPI} showToast={showToast} onChanged={() => loadRelations(selected)} /> },
    ];
    const base = sectionsFor('Creatures');
    const loreIndex = base.findIndex(section => section.key === 'lore');
    const agentFields = [
      { key: 'appearance', title: 'Appearance', icon: User, scalar: true, view: <Prose text={selected.data.appearance} />, edit: <Edit label="Appearance"><LTextarea rows={5} placeholder="Physical presence and distinguishing features." value={selected.data.appearance || ''} onChange={(e) => patchData({ appearance: e.target.value })} /></Edit> },
      { key: 'personality', title: 'Personality', icon: Users, scalar: true, view: <Prose text={selected.data.personality} />, edit: <Edit label="Personality"><LTextarea rows={5} placeholder="Temperament, instincts, habits, and values." value={selected.data.personality || ''} onChange={(e) => patchData({ personality: e.target.value })} /></Edit> },
    ];
    return loreIndex < 0 ? [...base, ...agentFields] : [...base.slice(0, loreIndex), ...agentFields, ...base.slice(loreIndex)];
  };

  // Template fields for one section. Before the first save the entity has no row to
  // write to, so the inputs feed the draft and ride along with the create payload.
  const customFieldsFor = (sectionId, embedded = false) => (
    <WorldbuildCustomFields
      workspaceId={workspaceId} entity={selected} entities={entities} api={electronAPI} showToast={showToast}
      definitions={fieldDefinitions}
      onEntityChange={applyIntegratedEntity} onDraftChange={(customFields) => patchData({ customFields })}
      template={activeTemplate} sectionId={sectionId} embedded={embedded}
    />
  );
  const customizeSections = (source) => {
    if (!templateSections.length) return charTab === 'data' ? [...source, {
      key: 'custom-fields',
      raw: customFieldsFor('custom-fields'),
    }] : source;
    const positions = new Map(templateSections.map((section, index) => [section.id, index]));
    const custom = charTab === 'data' ? templateSections.filter(section => section.kind === 'custom' && !section.hidden).map(section => ({
      key: section.id,
      raw: customFieldsFor(section.id),
    })) : [];
    return [...source, ...custom]
      .filter(section => !sectionSetting(section.key)?.hidden)
      .map(section => ({ ...section, title: sectionSetting(section.key)?.label || section.title }))
      .sort((left, right) => (positions.get(left.key) ?? 999) - (positions.get(right.key) ?? 999));
  };
  const sections = selected
    ? (charTab === 'knowledge' && hasKnowledgeTab) || (charTab === 'occurrences' && hasOccurrencesTab)
      ? []
      : customizeSections(selected.type === 'Characters' ? characterSections() : isIndividualCreature ? individualCreatureSections() : isFaction ? factionSections() : sectionsFor(selected.type))
    : [];
  const m = selected ? concreteEntityMeta(selected) : null;
  const nameLabel = selected?.type === 'System' ? 'Title' : 'Name';
  const showAliases = !!selected;

  const renderEntityButton = (en) => {
    const t = concreteEntityMeta(en);
    const Icon = t.icon;
    const active = selected?.id === en.id;
    return (
      <div key={en.id} className="relative">
        {manageMode && <Checkbox size="sm" checked={selectedIds.has(en.id)} onChange={() => toggleEntitySelection(en.id)} ariaLabel={`Select ${en.canonicalName}`} className="absolute z-10 left-2.5 top-1/2 -translate-y-1/2" />}
        <button onClick={() => openEntity(en)} className={`w-full rounded-control pr-2.5 text-left flex items-center transition-colors cursor-pointer group ${manageMode ? 'gap-2 py-1.5 pl-9' : 'gap-2.5 py-2 pl-2.5'} ${active ? 'bg-accent/15' : 'hover:bg-surface-hover/60'}`}>
          <span className={`${manageMode ? 'h-6 w-6' : 'h-7 w-7'} rounded-md border flex items-center justify-center shrink-0 ${t.medallion}`}><Icon className="w-3.5 h-3.5" /></span>
          <span className={`flex-1 min-w-0 truncate text-sm font-medium ${active ? 'text-accent' : 'text-text-secondary'}`}>{en.canonicalName}</span>
          {en.status === 'proposed' && <Sparkles className="w-3.5 h-3.5 text-status-warning shrink-0" data-tooltip="AI proposal, needs accept" />}
          {en.status !== 'proposed' && (reviewCounts[en.id]?.entityUpdates || 0) > 0 && <ShieldCheck className="w-3.5 h-3.5 text-status-info shrink-0" data-tooltip={`${reviewCounts[en.id].entityUpdates} entity update suggestions`} />}
          {en.status !== 'proposed' && (reviewCounts[en.id]?.kanora || 0) > 0 && <Sparkles className="w-3.5 h-3.5 text-entity-event shrink-0" data-tooltip={`${reviewCounts[en.id].kanora} Kanora suggestions`} />}
        </button>
      </div>
    );
  };

  const renderLocationNode = (node, isNested = false, isLast = false) => {
    const { entity, children } = node;
    const hasChildren = children.length > 0;
    const isExpanded = expandedLocations[entity.id] !== false;
    const t = concreteEntityMeta(entity);
    const Icon = t.icon;
    const active = selected?.id === entity.id;
    return (
      <div key={entity.id} className={`relative ${isNested ? 'pl-4' : ''}`}>
        {isNested && (isLast
          ? <span className="absolute left-0 top-0 h-5 w-4 rounded-bl-sm border-b border-l border-status-success/25" />
          : <>
              <span className="absolute left-0 top-0 bottom-0 border-l border-status-success/25" />
              <span className="absolute left-0 top-5 w-4 border-t border-status-success/25" />
            </>)}
        <div className="relative">
            {manageMode && <Checkbox size="sm" checked={selectedIds.has(entity.id)} onChange={() => toggleEntitySelection(entity.id)} ariaLabel={`Select ${entity.canonicalName}`} className="absolute z-10 left-2.5 top-1/2 -translate-y-1/2" />}
            <button onClick={() => openEntity(entity)} className={`w-full rounded-control pr-2.5 text-left flex items-center transition-colors cursor-pointer group focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ${manageMode ? 'gap-2 py-1.5 pl-9' : 'gap-2.5 py-2 pl-2.5'} ${hasChildren ? 'pr-9' : ''} ${active ? 'bg-accent/15' : 'hover:bg-surface-hover/60'}`}>
              <span className={`${manageMode ? 'h-6 w-6' : 'h-7 w-7'} rounded-md border flex items-center justify-center shrink-0 ${t.medallion}`}><Icon className="w-3.5 h-3.5" /></span>
              <span className={`flex-1 min-w-0 truncate text-sm font-medium ${active ? 'text-accent' : 'text-text-secondary'}`}>{entity.canonicalName}</span>
              {entity.status === 'proposed' && <Sparkles className="w-3.5 h-3.5 text-status-warning shrink-0" data-tooltip="AI proposal, needs accept" />}
              {entity.status !== 'proposed' && (reviewCounts[entity.id]?.entityUpdates || 0) > 0 && <ShieldCheck className="w-3.5 h-3.5 text-status-info shrink-0" data-tooltip={`${reviewCounts[entity.id].entityUpdates} entity update suggestions`} />}
              {entity.status !== 'proposed' && (reviewCounts[entity.id]?.kanora || 0) > 0 && <Sparkles className="w-3.5 h-3.5 text-entity-event shrink-0" data-tooltip={`${reviewCounts[entity.id].kanora} Kanora suggestions`} />}
            </button>
            {hasChildren && <button type="button" onClick={() => toggleLocation(entity.id)} aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${entity.canonicalName}`} className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-md text-text-subtle hover:text-text-secondary hover:bg-surface-hover/60 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent">
              <ChevronRight className={`w-3.5 h-3.5 transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
            </button>}
        </div>
        {hasChildren && isExpanded && (
          <div className="relative ml-4 py-0.5">
            {children.map((child, index) => renderLocationNode(child, true, index === children.length - 1))}
          </div>
        )}
      </div>
    );
  };

  const renderSidebarEntities = () => {
    if (!useLocationTree) return filtered.map(renderEntityButton);
    if (filterType === 'Locations') return locationTree.map(node => renderLocationNode(node));
    return TYPE_ORDER.flatMap((type) => {
      if (type === 'Locations') return locationTree.map(node => renderLocationNode(node));
      return entities.filter(en => en.type === type).sort((a, b) => a.canonicalName.localeCompare(b.canonicalName)).map(renderEntityButton);
    });
  };

  const renderSection = (s) => {
    if (s.raw) return <React.Fragment key={s.key}>{s.raw}</React.Fragment>;
    const editing = editingSection === s.key;
    return (
      <Section key={s.key} icon={s.icon} title={s.title} editing={editing} showPencil={!s.derived} onEdit={() => setEditingSection(s.key)}>
        {editing ? (
          <>
            {s.edit}
            <div className="flex items-center justify-end gap-2 pt-1">
              {s.scalar ? (
                <>
                  <Button variant="ghost" size="sm" onClick={cancelSection}>Cancel</Button>
                  <Button size="sm" icon={Check} loading={saving} onClick={saveSection}>Save</Button>
                </>
              ) : (
                <Button variant="ghost" size="sm" onClick={() => setEditingSection(null)}>Done</Button>
              )}
            </div>
          </>
        ) : s.view}
        {activeTemplate && charTab === 'data' && customFieldsFor(s.key, true)}
      </Section>
    );
  };

  // Create form: every native section of the Data tab, opened for editing, plus the
  // template's own fields. Sections made only of relations are left out — links need a
  // saved id, so they are filled once the sheet exists.
  const renderCreateSection = (s) => {
    if (s.raw) return <React.Fragment key={s.key}>{s.raw}</React.Fragment>;
    if (!s.edit || s.relationalOnly) return null;
    return (
      <Section key={s.key} icon={s.icon} title={s.title}>
        {s.edit}
        {activeTemplate && customFieldsFor(s.key, true)}
      </Section>
    );
  };

  const bulkDialog = (() => {
    if (!bulkConfirm) return null;
    const { action, summary } = bulkConfirm;
    if (action === 'delete') return {
      tone: 'danger',
      title: `Delete ${summary.entities} entities`,
      confirm: 'Delete entities',
      message: `${summary.proposed} proposed and ${summary.entities - summary.proposed} confirmed entities will be permanently deleted, together with ${summary.relationships} relationships and ${summary.storyTags} World Index associations. This cannot be undone.`,
    };
    const updateDetails = `${summary.pendingFields} field changes, ${summary.pendingLore} lore updates, and ${summary.pendingLinks} relationships`;
    if (action === 'accept-proposed') return {
      tone: 'warning', title: 'Accept proposed entities', confirm: 'Accept proposals',
      message: `${summary.proposed} selected proposals will become confirmed entities. Possible duplicates still need to be merged manually.`,
    };
    if (action === 'accept-updates') return {
      tone: 'warning', title: 'Accept AI updates', confirm: 'Accept updates',
      message: `Accept all pending AI changes for ${summary.pendingUpdates} selected entities: ${updateDetails}.`,
    };
    if (action === 'reject-proposed') return {
      tone: 'danger', title: 'Reject proposed entities', confirm: 'Reject proposals',
      message: `Reject and remove ${summary.proposed} selected proposed entities. Confirmed entities in the selection will not be changed.`,
    };
    if (action === 'reject-updates') return {
      tone: 'danger', title: 'Reject AI updates', confirm: 'Reject updates',
      message: `Discard all pending AI changes for ${summary.pendingUpdates} selected entities: ${updateDetails}. Current canonical data will not be changed.`,
    };
    if (action === 'reprocess') return {
      tone: 'warning', title: 'Reprocess selected entities', confirm: 'Reset progress',
      message: `Clear the processed-evidence status for ${summary.entities - summary.proposed} confirmed entities. Current data and pending reviews will be preserved. The next Update Entities run will read their matching evidence again.`,
    };
    return null;
  })();

  return (
    <div className="flex-1 flex flex-col lg:flex-row h-full overflow-hidden bg-surface-canvas/40 select-none relative">
      {showExportModal && createPortal(
        <ExportWorldbuildModal
          entityCount={exportableCount}
          onClose={() => setShowExportModal(false)}
          onConfirm={() => { setShowExportModal(false); exportWorld(); }}
        />, document.body)}
      {bulkDialog && (
        <ConfirmDialog
          tone={bulkDialog.tone}
          title={bulkDialog.title}
          message={bulkDialog.message}
          actions={[
            { label: 'Cancel', variant: 'ghost', onClick: () => setBulkConfirm(null) },
            { label: bulkDialog.confirm, variant: bulkDialog.tone === 'danger' ? 'danger' : 'primary', autoFocus: true, loading: bulkSaving, onClick: () => runBulkAction(bulkConfirm.action) },
          ]}
          onClose={() => setBulkConfirm(null)}
        />
      )}
      {showTemplateManager && (
        <WorldbuildTemplateManager
          workspaceId={workspaceId}
          api={electronAPI}
          templates={templates}
          showToast={showToast}
          onClose={() => setShowTemplateManager(false)}
          onSaved={(template) => setTemplates(current => [...current.filter(item => item.typeId !== template.typeId), template])}
        />
      )}
      {confirmDelete && selected && (
        <ConfirmDialog
          tone="danger"
          title="Delete entity"
          message={<>The {typeMeta(selected.type).label.toLowerCase()} <strong className="text-text-secondary">“{selected.canonicalName}”</strong> will be permanently deleted, along with its connections and story tags. This cannot be undone.</>}
          actions={[
            { label: 'Cancel', variant: 'ghost', onClick: () => setConfirmDelete(false) },
            { label: 'Delete', variant: 'danger', autoFocus: true, loading: saving, onClick: async () => { await remove(); setConfirmDelete(false); } },
          ]}
          onClose={() => setConfirmDelete(false)}
        />
      )}
      {enriching && (
        <div className="absolute inset-0 z-[70] flex flex-col items-center justify-center gap-3 bg-surface-canvas/80 backdrop-blur-sm">
          <RefreshCw className="w-7 h-7 text-accent animate-spin" />
          <div className="text-center">
            <p className="text-sm font-bold text-text-primary">Updating your world…</p>
            <p className="caption mt-1">
              {enrichProgress?.total
                ? `Reading passages for ${enrichProgress.name || 'your entities'} (${Math.min(enrichProgress.done + 1, enrichProgress.total)}/${enrichProgress.total})`
                : 'Reading your story and refreshing each entity.'}
            </p>
          </div>
        </div>
      )}
      {showEnrichErrors && enrichErrors.length > 0 && (
        <aside className="fixed right-5 bottom-20 z-[70] w-[min(30rem,calc(100vw-2.5rem))] max-h-[70vh] overflow-hidden rounded-surface border border-status-danger/30 bg-surface-panel/95 backdrop-blur-xl shadow-overlay flex flex-col" aria-labelledby="entity-update-errors-title">
          <header className="shrink-0 flex items-start justify-between gap-4 px-4 py-3 border-b border-status-danger/20 bg-status-danger/[0.08]">
            <div className="flex min-w-0 gap-3">
              <AlertTriangle aria-hidden="true" className="w-5 h-5 shrink-0 mt-0.5 text-status-danger" />
              <div className="min-w-0">
                <h2 id="entity-update-errors-title" className="font-bold text-status-danger">Entity updates need attention</h2>
                <p className="caption mt-0.5">{enrichErrorSummary || `${enrichErrors.length} ${enrichErrors.length === 1 ? 'entity update failed' : 'entity updates failed'}.`}</p>
              </div>
            </div>
            <button type="button" aria-label="Dismiss all entity update errors" onClick={dismissAllEnrichErrors} className="shrink-0 p-1 rounded text-text-subtle transition-colors hover:bg-status-danger/10 hover:text-status-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger/40"><X aria-hidden="true" className="w-5 h-5" /></button>
          </header>
          <div className="flex-1 overflow-y-auto overscroll-contain divide-y divide-border-subtle custom-scrollbar" aria-live="polite">
              {enrichErrors.map(error => (
                <article key={error.id} className="p-4 text-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="font-bold text-text-primary">{error.entityName}</h3>
                      <p className="eyebrow mt-1">{typeMeta(error.entityType).label}</p>
                      <p className="mt-3 leading-relaxed break-words text-text-secondary">{error.error}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <button type="button" onClick={() => openSettings('engine', 'system-ai')} className="font-bold text-accent hover:brightness-110 underline underline-offset-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded">Open System AI settings</button>
                    <button type="button" onClick={() => dismissEnrichError(error.id)} className="text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded">Dismiss</button>
                  </div>
                </article>
              ))}
          </div>
        </aside>
      )}
      <div style={{ '--worldbuild-sidebar-width': `${sidebarWidth}px` }} className="relative w-full lg:w-[var(--worldbuild-sidebar-width)] shrink-0 flex flex-col h-full overflow-visible border-r border-border-subtle/40 bg-surface-canvas/25 backdrop-blur-md">
        <button type="button" aria-label="Resize Worldbuild sidebar" onPointerDown={startSidebarResize} onKeyDown={handleSidebarResizeKey} className="hidden lg:flex absolute -right-4 top-3 z-20 w-8 h-8 items-center justify-center rounded-full border border-border-strong bg-surface-panel text-text-primary shadow-lg cursor-col-resize transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent">
          <ChevronsLeftRight className="w-4 h-4" />
        </button>
        <div className="px-3 py-3 border-b border-border-subtle/80 bg-surface-canvas/35 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-accent" /><span className="text-sm font-bold text-text-primary tracking-wide">Worldbuild</span>
            <button type="button" onClick={() => manageMode ? leaveManageMode() : setManageMode(true)} className={`ml-1 text-[0.625rem] font-bold uppercase tracking-wider px-2 py-1 rounded-md border transition-colors cursor-pointer ${manageMode ? 'bg-accent/20 text-accent border-accent/40' : 'text-text-muted border-border-subtle hover:text-text-primary hover:bg-surface-hover/60'}`}>{manageMode ? 'Done' : 'Manage'}</button>
            <button type="button" onClick={() => setShowTemplateManager(true)} aria-label="Customize entity types" data-tooltip="Entity types & templates" className="rounded-md border border-border-subtle p-1 text-text-subtle transition-colors hover:bg-surface-hover/60 hover:text-accent"><LayoutTemplate className="h-3.5 w-3.5" /></button>
          </div>
          <div className="flex items-center gap-2">
            {proposedCount > 0 && <span className="inline-flex items-center gap-1 text-[0.625rem] font-bold text-status-warning bg-status-warning/10 border border-status-warning/30 rounded-full px-2 py-0.5"><Sparkles className="w-3 h-3" />{proposedCount}</span>}
          </div>
        </div>

        <div className="p-3 space-y-3">
          {/* Secondary actions: Update entities (left) + Import / Export (right). Sits
              above Create so the primary action stays the most prominent. */}
          <div className="flex items-center gap-2">
            {/* Wrapper carries the tooltip so it still shows while the button is disabled
                (a disabled button has pointer-events: none). */}
            <div className="flex-1 min-w-0" data-tooltip={hasSystemAi
              ? "Read your story and refresh each entity's details (skips locked ones)"
              : 'Select both an API Connection and a model in Settings → Engine & Memory to update entities.'}>
              <Button fullWidth size="sm" variant="ghost" icon={RefreshCw} loading={enriching}
                disabled={enriching || entities.length === 0 || !hasSystemAi}
                onClick={runEnrichment}>
                Update entities
              </Button>
            </div>
            <Button size="sm" variant="ghost" icon={Upload} onClick={importWorld}
              data-tooltip="Import a Worldbuild from a file (merges in)" />
            <div data-tooltip={exportableCount === 0 ? 'Nothing to export yet' : 'Export this Worldbuild to a file'}>
              <Button size="sm" variant="ghost" icon={Download} onClick={() => setShowExportModal(true)} disabled={exportableCount === 0} />
            </div>
          </div>

          <div className="relative" ref={createRef}>
            <Button fullWidth icon={Plus} onClick={() => setShowCreate(v => !v)} className="!border !border-accent/25 !bg-accent/10 !text-accent hover:!bg-accent/15">Create</Button>
            <Popover anchorRef={createRef} open={showCreate} onClose={() => setShowCreate(false)} className="!bg-surface-panel-muted backdrop-blur-sm">
              {createOptions.map(option => { const t = typeMeta(option.type); const Icon = t.icon; return (
                <button key={option.id} onClick={() => startNew(option.type, option.data)} className="w-full text-left px-3 py-2 text-xs text-text-secondary hover:bg-surface-hover/60 hover:text-text-primary transition-colors flex items-center gap-2.5 cursor-pointer font-medium rounded-control">
                  <span className={`w-6 h-6 shrink-0 rounded-md border flex items-center justify-center ${t.medallion}`}><Icon className="w-3.5 h-3.5" /></span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate">{t.label}</span>
                    {option.note && <span className="block truncate text-[0.6875rem] font-normal text-text-subtle">{option.note}</span>}
                  </span>
                </button>
              ); })}
            </Popover>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-text-subtle pointer-events-none" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search the world..." className={`${FIELD} pl-9`} />
          </div>

          <div className="flex items-center gap-1.5">
            <button type="button" onClick={() => moveFilterStrip(-1)} aria-label="Move entity filters left" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-subtle transition-colors duration-200 ease-standard hover:bg-surface-hover/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"><ChevronLeft className="h-3.5 w-3.5" /></button>
            <div ref={filterStripRef} className="flex min-w-0 flex-1 gap-1.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
              <button onClick={() => { setFilterType(null); setReviewFilter(null); }} className={`shrink-0 rounded-full border px-2.5 py-1 text-[0.6875rem] font-semibold tracking-wide transition-colors cursor-pointer ${!filterType && !reviewFilter ? 'border-accent/30 bg-accent/15 text-accent' : 'border-border-subtle bg-surface-hover/35 text-text-muted hover:bg-surface-hover/55 hover:text-text-primary'}`}>All</button>
              {TYPE_ORDER.map(key => <button key={key} onClick={() => setFilterType(key === filterType ? null : key)} className={`shrink-0 rounded-full border px-2.5 py-1 text-[0.6875rem] font-semibold tracking-wide transition-colors cursor-pointer ${filterType === key ? 'border-accent/30 bg-accent/15 text-accent' : 'border-border-subtle bg-surface-hover/35 text-text-muted hover:bg-surface-hover/55 hover:text-text-primary'}`}>{typeMeta(key).label}</button>)}
            </div>
            <button type="button" onClick={() => moveFilterStrip(1)} aria-label="Move entity filters right" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-text-subtle transition-colors duration-200 ease-standard hover:bg-surface-hover/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"><ChevronRight className="h-3.5 w-3.5" /></button>
          </div>
          {(proposedCount > 0 || pendingUpdateCount > 0) && (
            <div className="flex items-center gap-1.5 border-t border-border-subtle pt-2">
              <span className="mr-1 shrink-0 eyebrow">AI review</span>
              {proposedCount > 0 && <button onClick={() => setReviewFilter(reviewFilter === 'proposed' ? null : 'proposed')} className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[0.6875rem] font-semibold tracking-wide transition-colors cursor-pointer ${reviewFilter === 'proposed' ? 'bg-status-warning/15 text-status-warning border-status-warning/35' : 'bg-status-warning/[0.05] text-status-warning/80 border-status-warning/20 hover:bg-status-warning/10'}`}><Sparkles className="w-3 h-3" />Proposed</button>}
              {pendingUpdateCount > 0 && <button onClick={() => setReviewFilter(reviewFilter === 'updates' ? null : 'updates')} className={`inline-flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-1 text-[0.6875rem] font-semibold tracking-wide transition-colors cursor-pointer ${reviewFilter === 'updates' ? 'bg-status-info/15 text-status-info border-status-info/35' : 'bg-status-info/[0.05] text-status-info/80 border-status-info/20 hover:bg-status-info/10'}`}><ShieldCheck className="w-3 h-3" />Reviews</button>}
            </div>
          )}
        </div>

        {!manageMode && (
          <div className="space-y-1.5 px-2 pb-2">
            <button type="button" onClick={() => { setSurface('calendar'); setSelected(null); setEditingSection(null); }}
              className={`flex w-full items-center gap-2.5 rounded-card border px-2.5 py-2.5 text-left transition-colors duration-200 ease-standard ${surface === 'calendar' ? 'border-status-info/25 bg-status-info/[0.08] text-status-info' : 'border-border-subtle bg-surface-hover/25 text-text-secondary hover:border-border-default hover:bg-surface-hover/60'}`}>
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-control border ${surface === 'calendar' ? 'border-status-info/25 bg-status-info/[0.08] text-status-info' : 'border-border-subtle bg-surface-canvas/30 text-text-subtle'}`}><CalendarClock className="h-3.5 w-3.5" /></span>
              <span className="min-w-0 flex-1"><span className="block text-xs font-bold uppercase tracking-wider">Calendar</span><span className="block truncate text-[0.6875rem] text-text-subtle">Dates, seasons, and events</span></span>
            </button>
            <button type="button" onClick={() => { setSurface('facts'); setSelected(null); setEditingSection(null); }}
              className={`flex w-full items-center gap-2.5 rounded-card border px-2.5 py-2.5 text-left transition-colors duration-200 ease-standard ${surface === 'facts' ? 'border-accent/25 bg-accent/[0.08] text-accent' : 'border-border-subtle bg-surface-hover/25 text-text-secondary hover:border-border-default hover:bg-surface-hover/60'}`}>
              <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-control border ${surface === 'facts' ? 'border-accent/25 bg-accent/[0.08] text-accent' : 'border-border-subtle bg-surface-canvas/30 text-text-subtle'}`}><BookCheck className="h-3.5 w-3.5" /></span>
              <span className="min-w-0 flex-1">
                <span className="block text-xs font-bold uppercase tracking-wider">Facts</span>
                <span className="block truncate text-[0.6875rem] text-text-subtle">Canonical world truths</span>
              </span>
              {factCount > 0 && <span className="rounded-full bg-surface-hover/60 px-2 py-0.5 text-xs text-text-muted">{factCount}</span>}
            </button>
          </div>
        )}

        <div className="flex-1 overflow-y-auto custom-scrollbar px-2 pb-2 space-y-0.5">
          {loading ? <p className="caption text-center py-8">Loading...</p>
            : filtered.length === 0 ? <p className="caption text-center py-8">Nothing here yet.</p>
            : renderSidebarEntities()}
        </div>
        {manageMode && (
          <div className="shrink-0 space-y-2 border-t border-border-subtle bg-surface-panel/95 p-3 backdrop-blur-md">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-text-secondary">{selectedIds.size} selected{hiddenSelectedCount ? ` · ${hiddenSelectedCount} hidden` : ''}</span>
              <button type="button" onClick={() => setSelectedIds(new Set())} disabled={!selectedIds.size} className="eyebrow hover:text-text-primary disabled:opacity-40 cursor-pointer">Clear</button>
            </div>
            <details className="group rounded-control border border-border-subtle bg-surface-hover/25">
              <summary className="flex cursor-pointer list-none items-center justify-between px-2.5 py-1.5 text-[0.6875rem] font-semibold text-text-muted hover:text-text-primary [&::-webkit-details-marker]:hidden">
                Selection tools
                <ChevronRight className="h-3.5 w-3.5 transition-transform group-open:rotate-90" />
              </summary>
              <div className="space-y-2 border-t border-border-subtle px-2.5 py-2">
              <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={selectVisibleEntities} disabled={!filtered.length} className="text-[0.625rem] font-semibold px-2 py-1 rounded-md border border-border-subtle text-text-secondary hover:bg-surface-hover/60 disabled:opacity-40 cursor-pointer">Select visible</button>
              {proposedCount > 0 && <button type="button" onClick={() => selectEntities(entities.filter(entity => entity.status === 'proposed'))} className="text-[0.625rem] font-semibold px-2 py-1 rounded-md border border-status-warning/25 text-status-warning hover:bg-status-warning/10 cursor-pointer">Proposed</button>}
              {pendingUpdateCount > 0 && <button type="button" onClick={() => selectEntities(entities.filter(entity => entity.status !== 'proposed' && ((reviewCounts[entity.id]?.entityUpdates || 0) > 0 || (reviewCounts[entity.id]?.kanora || 0) > 0)))} className="text-[0.625rem] font-semibold px-2 py-1 rounded-md border border-status-info/25 text-status-info hover:bg-status-info/10 cursor-pointer">Reviews</button>}
              {Object.keys(AI_POLICY).map(policy => {
                const matches = entities.filter(entity => entity.status !== 'proposed' && (entity.data?.aiPolicy || 'review') === policy);
                return <button key={`select-${policy}`} type="button" onClick={() => selectEntities(matches)} disabled={!matches.length} data-tooltip={`Select all entities with the ${AI_POLICY[policy].label} AI policy`} className="text-[0.625rem] font-semibold px-2 py-1 rounded-md border border-border-subtle text-text-muted hover:bg-surface-hover/60 hover:text-text-primary disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">{AI_POLICY[policy].label} ({matches.length})</button>;
              })}
              </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-[0.6875rem] font-medium text-text-subtle">Set AI policy</span>
              {Object.entries(AI_POLICY).map(([policy, config]) => {
                const Icon = config.icon;
                return <button key={policy} type="button" onClick={() => runBulkAction('policy', policy)} disabled={!selectedIds.size || bulkSaving} data-tooltip={config.tip} className="inline-flex items-center gap-1 text-[0.625rem] font-semibold px-2 py-1 rounded-md border border-border-subtle text-text-secondary hover:bg-surface-hover/60 disabled:opacity-40 cursor-pointer"><Icon className="w-3 h-3" />{config.label}</button>;
              })}
            </div>
              </div>
            </details>
            <div className="grid grid-cols-2 gap-1.5">
              <button type="button" onClick={() => requestBulkConfirmation('accept-proposed')} disabled={!selectedProposedCount || bulkSaving} className="text-[0.625rem] font-semibold px-2 py-1.5 rounded-md border border-status-warning/25 text-status-warning hover:bg-status-warning/10 disabled:opacity-40 cursor-pointer">Accept proposals</button>
              <button type="button" onClick={() => requestBulkConfirmation('reject-proposed')} disabled={!selectedProposedCount || bulkSaving} className="text-[0.625rem] font-semibold px-2 py-1.5 rounded-md border border-status-danger/25 text-status-danger hover:bg-status-danger/10 disabled:opacity-40 cursor-pointer">Reject proposals</button>
              <button type="button" onClick={() => requestBulkConfirmation('accept-updates')} disabled={!selectedUpdateCount || bulkSaving} className="text-[0.625rem] font-semibold px-2 py-1.5 rounded-md border border-status-info/25 text-status-info hover:bg-status-info/10 disabled:opacity-40 cursor-pointer">Accept updates</button>
              <button type="button" onClick={() => requestBulkConfirmation('reject-updates')} disabled={!selectedUpdateCount || bulkSaving} className="text-[0.625rem] font-semibold px-2 py-1.5 rounded-md border border-status-danger/25 text-status-danger hover:bg-status-danger/10 disabled:opacity-40 cursor-pointer">Reject updates</button>
              <button type="button" onClick={() => requestBulkConfirmation('reprocess')} disabled={!selectedConfirmedCount || bulkSaving} data-tooltip="Clear the processed-evidence history for the selected entities so Update entities reads their evidence again" className="inline-flex items-center justify-center gap-1 text-[0.625rem] font-semibold px-2 py-1.5 rounded-md border border-border-subtle text-text-muted hover:bg-surface-hover/60 hover:text-text-primary disabled:opacity-40 cursor-pointer"><RefreshCw className="w-3 h-3" />Reprocess</button>
              <button type="button" onClick={() => requestBulkConfirmation('delete')} disabled={!selectedIds.size || bulkSaving} className="inline-flex items-center justify-center gap-1 text-[0.625rem] font-semibold px-2 py-1.5 rounded-md border border-status-danger/25 text-status-danger hover:bg-status-danger/10 disabled:opacity-40 cursor-pointer"><Trash2 className="w-3 h-3" />Delete</button>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0 overflow-y-auto custom-scrollbar">
        {surface === 'calendar' ? (
          <WorldbuildCalendar
            workspaceId={workspaceId}
            api={electronAPI}
            showToast={showToast}
            onCalendarChanged={setWorldCalendar}
            onOpenEntity={openEntityById}
          />
        ) : surface === 'facts' ? (
          <WorldbuildFactsRegistry
            workspaceId={workspaceId}
            entities={entities}
            api={electronAPI}
            showToast={showToast}
            onCountChanged={setFactCount}
          />
        ) : !selected ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-8 gap-4">
            <div className="w-16 h-16 rounded-surface border border-border-subtle bg-surface-hover/35 flex items-center justify-center"><Globe className="w-8 h-8 text-accent/70" /></div>
            <div>
              <h2 className="text-lg font-bold text-text-primary">Build your world</h2>
              <p className="caption mt-1 max-w-sm">Create characters, locations, factions, items and the rules that bind them. The AI tags your story against this registry so it remembers who's who.</p>
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto p-6 space-y-4">
            <div className={`relative overflow-hidden rounded-surface border ${m.ring} bg-surface-panel-muted/60 backdrop-blur-md p-5`}>
              <div aria-hidden="true" className={`pointer-events-none absolute inset-0 bg-gradient-to-br ${m.wash} via-transparent to-transparent`} />
              <div className="relative">
              {selected.status === 'proposed' && (
                <div className="flex flex-col gap-2 mb-4 bg-status-warning/10 border border-status-warning/30 rounded-card px-3 py-2.5">
                  <span className="flex items-center gap-2 text-xs font-semibold text-status-warning min-w-0">
                    <Sparkles className="w-4 h-4 shrink-0" />
                    {selected.data?._imported
                      ? 'Imported from a Worldbuild package. Keep it as a new entity, merge it into an existing one, or dismiss it.'
                      : 'The AI proposed this entity. Keep it, fold it into an existing one, or dismiss it.'}
                  </span>
                  {!selected.data?._imported && Array.isArray(selected.data?.proposalEvidence) && <EvidenceReferences excerpts={selected.data.proposalEvidence.map(item => item.excerpt)} />}
                  {mergePrompt ? (
                    <div className="flex items-center flex-wrap gap-2">
                      <span className="text-xs text-status-warning/90 min-w-0">Merge into “{mergePrompt.name}”. On conflicting details, keep:</span>
                      <Button size="sm" loading={saving} onClick={() => mergeInto(mergePrompt.id, 'source')}>Imported</Button>
                      <Button size="sm" loading={saving} onClick={() => mergeInto(mergePrompt.id, 'target')}>Existing</Button>
                      <Button size="sm" variant="ghost" loading={saving} onClick={() => setMergePrompt(null)}>Cancel</Button>
                    </div>
                  ) : (
                    <div className="flex items-center flex-wrap gap-2">
                      <Button size="sm" loading={saving} onClick={() => persist({ accept: true })}>Accept as new</Button>
                      <EntityPickerButton icon={Link2} label="Merge into…" title="Fold this into" options={mergeTargets} onPick={startMerge} />
                      <Button size="sm" variant="ghost" loading={saving} onClick={remove}>Dismiss</Button>
                    </div>
                  )}
                </div>
              )}
              {(isNew || editingSection === '__header__') ? (
                <div className="space-y-3">
                  <Edit label={nameLabel}><LInput autoFocus placeholder={placeholderName(selected.type)} value={selected.canonicalName} onChange={(e) => patch({ canonicalName: e.target.value })} /></Edit>
                  {showAliases && <Edit label="Aliases & titles (comma-separated)" hint="Surface mentions matching any of these map to this entity."><LInput placeholder={placeholderAlias(selected.type)} value={selected.aliases} onChange={(e) => patch({ aliases: e.target.value })} /></Edit>}
                  {!isNew && (
                    <div className="flex justify-end gap-2">
                      <Button variant="ghost" size="sm" onClick={cancelSection}>Cancel</Button>
                      <Button size="sm" icon={Check} loading={saving} onClick={saveSection}>Save</Button>
                    </div>
                  )}
                </div>
              ) : (
                <div className="group/header flex items-start gap-3.5">
                  <span className={`w-12 h-12 rounded-card border flex items-center justify-center shrink-0 ${m.medallion}`}>{React.createElement(m.icon, { className: 'w-6 h-6' })}</span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`eyebrow ${m.soft}`}>{m.label}</span>
                      {(selected.type === 'Characters' || (selected.type === 'Creatures' && (selected.data.scope || 'individual') !== 'group')) && <StateTag map={STATUS} value={selected.data.status || 'unknown'} />}
                    </div>
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <h1 className="text-2xl font-bold text-text-primary truncate leading-tight">{selected.canonicalName}</h1>
                      <button onClick={() => setEditingSection('__header__')} aria-label="Edit name and aliases" data-tooltip="Edit name & aliases" className="p-1.5 text-text-subtle hover:text-accent hover:bg-surface-hover/60 rounded transition-[color,background-color,opacity] duration-200 ease-standard cursor-pointer shrink-0 opacity-0 group-hover/header:opacity-100 focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"><Pencil className="w-3.5 h-3.5" /></button>
                    </div>
                    {showAliases && aliasesArr(selected.aliases).length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2.5">{aliasesArr(selected.aliases).map((a, i) => <Chip key={i}><Tag className="w-2.5 h-2.5" />{a}</Chip>)}</div>
                    )}
                  </div>
                  {!isNew && selected.status !== 'proposed' && <div className="shrink-0"><AiPolicyControl value={selected.data?.aiPolicy} onChange={setAiPolicy} /></div>}
                </div>
              )}
              </div>
            </div>

            {!isNew && selected.status !== 'proposed' && (selected.type === 'Characters' || (selected.type === 'Creatures' && (selected.data?.scope || 'individual') !== 'group')) && (
              <WorldbuildRoleplayResources workspaceId={workspaceId} entity={selected} api={electronAPI} showToast={showToast} />
            )}

            {/* Subject sheet tabs */}
            {visibleSheetTabs.length > 0 && !isNew && (
              <div className="flex w-fit rounded-full border border-border-default bg-surface-input/95 p-0.5 shadow-sm">
                {visibleSheetTabs.map(t => (
                  <button key={t} onClick={() => { setCharTab(t); setEditingSection(null); }} className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[0.6875rem] font-semibold tracking-wide transition-colors cursor-pointer ${charTab === t ? 'bg-accent/20 text-accent shadow-sm' : 'text-text-muted hover:bg-surface-hover hover:text-text-primary'}`}>
                    {sheetTabLabel(t)}
                    {t === 'review' && <span className={`rounded-full px-1.5 py-0.5 text-[0.625rem] ${charTab === t ? 'bg-accent/10' : 'bg-surface-hover/60'}`}>{selectedReviewCounts.entityUpdates + selectedReviewCounts.kanora}</span>}
                  </button>
                ))}
              </div>
            )}

            {charTab === 'review' && hasEntityReview && hasKanoraReview && (
              <div className="grid grid-cols-2 gap-1 rounded-card border border-border-subtle bg-surface-panel-muted/60 p-1.5 backdrop-blur-md">
                <button type="button" onClick={() => setReviewKind('entity')} aria-pressed={reviewKind === 'entity'} className={`rounded-control px-3 py-2 text-xs font-bold uppercase tracking-[0.09em] transition-colors duration-200 ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${reviewKind === 'entity' ? 'bg-status-info text-on-accent' : 'text-text-subtle hover:bg-surface-hover/60 hover:text-text-secondary'}`}>Entity updates <span className="ml-1 rounded-full bg-surface-canvas/35 px-1.5 py-0.5 tabular-nums">{selectedReviewCounts.entityUpdates}</span></button>
                <button type="button" onClick={() => setReviewKind('kanora')} aria-pressed={reviewKind === 'kanora'} className={`rounded-control px-3 py-2 text-xs font-bold uppercase tracking-[0.09em] transition-colors duration-200 ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${reviewKind === 'kanora' ? 'bg-entity-event text-on-accent' : 'text-text-subtle hover:bg-surface-hover/60 hover:text-text-secondary'}`}>Kanora <span className="ml-1 rounded-full bg-surface-canvas/35 px-1.5 py-0.5 tabular-nums">{selectedReviewCounts.kanora}</span></button>
              </div>
            )}

            {/* Staged AI enrichment (review policy): per-field accept/reject */}
            {charTab === 'review' && hasEntityReview && reviewKind === 'entity' && !isNew && selected.status !== 'proposed' && selected.data?._enrichPending && (() => {
              const pending = selected.data._enrichPending;
              const pData = (pending.data && typeof pending.data === 'object') ? pending.data : {};
              const proposalValue = proposal => proposal && typeof proposal === 'object' && 'value' in proposal ? proposal.value : proposal;
              const proposalEvidence = proposal => {
                const ids = proposal && typeof proposal === 'object' && Array.isArray(proposal.evidence) ? proposal.evidence : [];
                return ids.map(id => pending.evidence?.[id]?.excerpt).filter(Boolean);
              };
              const proposalSupport = proposal => proposal && typeof proposal === 'object' ? String(proposal.support || '').trim() : '';
              const fields = Object.keys(pData);
              const hasLore = selected.type !== 'System' && pending.lore != null && String(pending.lore).trim() !== '';
              const links = Array.isArray(pending.links) ? pending.links : [];
              const chapters = Array.isArray(pending.chapters) ? pending.chapters : [];
              const linkKey = (l) => `${l.relKey}:${l.targetId}:${l.label || ''}`;
              const allFields = fields.slice();
              const allLinks = links.map(linkKey);
              const allChapters = chapters.map(c => c.id);
              return (
                <div className="rounded-surface border border-status-info/30 bg-status-info/[0.06] backdrop-blur-md p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-status-info shrink-0" />
                    <span className="text-xs font-semibold text-status-info">The AI suggested updates from your story. Accept or reject each change.</span>
                  </div>
                  <div className="space-y-2">
                    {fields.map(f => {
                      const customFieldKey = f.startsWith('customFields.') ? f.slice('customFields.'.length) : null;
                      const cur = customFieldKey ? selected.data?.customFields?.[customFieldKey] : selected.data?.[f];
                      const curStr = cur == null || String(cur).trim() === '' ? '(empty)' : String(cur);
                      return (
                        <div key={f} className="flex items-start gap-3 bg-surface-canvas/45 border border-border-subtle rounded-control px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <span className="block eyebrow text-text-muted mb-1">{pData[f]?.fieldLabel || fieldLabel(f)}</span>
                            <div className="flex items-center flex-wrap gap-2 text-sm">
                              <span className="text-text-subtle line-through">{curStr}</span>
                              <span className="text-text-subtle">→</span>
                              <span className="text-status-info font-medium">{displayProposalValue(f, pData[f], fieldDefinitions, entities)}</span>
                            </div>
                            <EvidenceReferences excerpts={proposalEvidence(pData[f])} support={proposalSupport(pData[f])} />
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button onClick={() => resolveReview({ fields: [f] }, {})} disabled={saving} data-tooltip="Accept" className="p-1.5 rounded-md text-status-success hover:bg-status-success/15 transition-colors cursor-pointer"><Check className="w-3.5 h-3.5" /></button>
                            <button onClick={() => resolveReview({}, { fields: [f] })} disabled={saving} data-tooltip="Reject" className="p-1.5 rounded-md text-text-muted hover:bg-surface-hover transition-colors cursor-pointer"><X className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                      );
                    })}
                    {hasLore && (
                      <div className="bg-surface-canvas/45 border border-border-subtle rounded-control px-3 py-2">
                        <div className="flex items-center justify-between gap-3 mb-1">
                          <span className="eyebrow text-text-muted">Lore</span>
                          <div className="flex items-center gap-1 shrink-0">
                            <button onClick={() => resolveReview({ lore: true }, {})} disabled={saving} data-tooltip="Accept" className="p-1.5 rounded-md text-status-success hover:bg-status-success/15 transition-colors cursor-pointer"><Check className="w-3.5 h-3.5" /></button>
                            <button onClick={() => resolveReview({}, { lore: true })} disabled={saving} data-tooltip="Reject" className="p-1.5 rounded-md text-text-muted hover:bg-surface-hover transition-colors cursor-pointer"><X className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                        <p className="text-sm text-status-info leading-relaxed whitespace-pre-wrap">{String(proposalValue(pending.lore))}</p>
                        <EvidenceReferences excerpts={proposalEvidence(pending.lore)} support={proposalSupport(pending.lore)} />
                      </div>
                    )}
                    {links.map(l => { const k = linkKey(l); return (
                      <div key={k} className="flex items-center gap-3 bg-surface-canvas/45 border border-border-subtle rounded-control px-3 py-2">
                        <Link2 className="w-3.5 h-3.5 text-status-info shrink-0" />
                        <div className="min-w-0 flex-1 text-sm">
                          <span className="eyebrow text-text-muted mr-2">{l.relLabel || l.relKey}</span>
                          <span className="text-status-info font-medium">{l.metadata ? `${selected.canonicalName} → ${l.targetName}` : l.targetName}</span>
                          {l.label && <span className="text-accent/90"> · {l.label}</span>}
                          {l.metadata && <p className="mt-1 text-xs text-text-muted"><span className="font-semibold text-text-secondary">How {selected.canonicalName} sees {l.targetName}:</span> {l.metadata.value}{l.metadata.description ? ` · ${l.metadata.description}` : ''}</p>}
                          <EvidenceReferences excerpts={proposalEvidence(l)} support={proposalSupport(l)} />
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => resolveReview({ links: [k] }, {})} disabled={saving} data-tooltip="Accept" className="p-1.5 rounded-md text-status-success hover:bg-status-success/15 transition-colors cursor-pointer"><Check className="w-3.5 h-3.5" /></button>
                          <button onClick={() => resolveReview({}, { links: [k] })} disabled={saving} data-tooltip="Reject" className="p-1.5 rounded-md text-text-muted hover:bg-surface-hover transition-colors cursor-pointer"><X className="w-3.5 h-3.5" /></button>
                        </div>
                      </div>
                    ); })}
                    {chapters.map(c => (
                      <div key={c.id} className="flex items-center gap-3 bg-surface-canvas/45 border border-border-subtle rounded-control px-3 py-2">
                        <ScrollText className="w-3.5 h-3.5 text-status-info shrink-0" />
                        <div className="min-w-0 flex-1 text-sm">
                          <span className="eyebrow text-text-muted mr-2">Chapter</span>
                          <span className="text-status-info font-medium">{c.title || 'Untitled'}</span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => resolveReview({ chapters: [c.id] }, {})} disabled={saving} data-tooltip="Accept" className="p-1.5 rounded-md text-status-success hover:bg-status-success/15 transition-colors cursor-pointer"><Check className="w-3.5 h-3.5" /></button>
                          <button onClick={() => resolveReview({}, { chapters: [c.id] })} disabled={saving} data-tooltip="Reject" className="p-1.5 rounded-md text-text-muted hover:bg-surface-hover transition-colors cursor-pointer"><X className="w-3.5 h-3.5" /></button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="flex items-center justify-end gap-2 pt-1">
                    <Button size="sm" variant="ghost" loading={saving} onClick={() => resolveReview({}, { fields: allFields, lore: true, links: allLinks, chapters: allChapters })}>Reject all</Button>
                    <Button size="sm" loading={saving} onClick={() => resolveReview({ fields: allFields, lore: true, links: allLinks, chapters: allChapters }, {})}>Accept all</Button>
                  </div>
                </div>
              );
            })()}

            {/* Body: create form (all sections in edit) or rendered sheet */}
            {isNew ? (
              <>
                {sections.map(renderCreateSection)}
                {createRelationHint(selected.type) && (
                  <p className="caption flex items-center gap-1.5"><Link2 className="w-3 h-3 shrink-0" />{createRelationHint(selected.type)}</p>
                )}
                <div className="flex items-center justify-between pt-1">
                  <Button variant="danger" size="sm" icon={Trash2} onClick={() => setSelected(null)}>Discard</Button>
                  <Button icon={Save} loading={saving} onClick={() => persist()}>Create {typeMeta(selected.type).label}</Button>
                </div>
              </>
            ) : (
              <>
                {charTab === 'review' && hasReview ? (
                  <div className="space-y-4">
                    {reviewKind === 'kanora' && hasKanoraReview && (
                      <WorldbuildKanoraReview
                        workspaceId={workspaceId}
                        proposals={subjectReview.proposals || []}
                        entities={entities}
                        api={electronAPI}
                        showToast={showToast}
                        onChanged={async () => { await load(); await loadSubjectReview(); }}
                      />
                    )}
                  </div>
                ) : charTab === 'knowledge' && hasKnowledgeTab ? (
                  <WorldbuildKnowledgeTab
                    workspaceId={workspaceId}
                    entity={selected}
                    entities={entities}
                    api={electronAPI}
                    showToast={showToast}
                    onOpenEntity={openEntityById}
                  />
                ) : charTab === 'occurrences' && hasOccurrencesTab ? (
                  <WorldbuildEventOccurrences
                    workspaceId={workspaceId}
                    eventEntity={selected}
                    entities={entities}
                    calendar={worldCalendar}
                    api={electronAPI}
                    showToast={showToast}
                  />
                ) : (
                  <>
                    {sections.map(renderSection)}
                  </>
                )}
                <div className="flex items-center gap-2 pt-1">
                  <Button variant="danger" size="sm" icon={Trash2} loading={saving} onClick={() => setConfirmDelete(true)}>Delete</Button>
                  {unsaved && <span className="caption flex items-center gap-1"><Link2 className="w-3 h-3" /> Save to unlock relations</span>}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// Chip row for derived/relation lists. Every name on a sheet is a way into that sheet:
// reading a faction and wanting its captain was a trip back through the sidebar.
function ChipList({ links, empty, onOpen }) {
  if (!links || links.length === 0) return <p className="text-sm text-text-disabled italic">{empty}</p>;
  return <div className="flex flex-wrap gap-1.5">{links.map(l => (
    <EntityChip key={l.linkId} entity={l.entity} label={l.label} onOpen={onOpen} />
  ))}</div>;
}

function EntityChip({ entity, label, onOpen }) {
  const body = <>{entity.canonicalName}{label && <span className="text-accent/90"> · {label}</span>}</>;
  if (!onOpen) return <Chip>{body}</Chip>;
  return (
    <button type="button" onClick={() => onOpen(entity.id)} title={`Open ${entity.canonicalName}`}
      className="inline-flex items-center gap-1 rounded-full border border-border-subtle bg-surface-hover/35 px-2 py-0.5 text-[0.6875rem] font-medium text-text-secondary transition-colors duration-200 ease-standard hover:border-accent/40 hover:bg-accent/10 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 cursor-pointer">
      {body}
    </button>
  );
}

// What each type gains once it exists: links always need a saved id, and the
// relational tabs (inventory, connections, knowledge, occurrences) open with it.
function createRelationHint(type) {
  return {
    System: '',
    Locations: 'Its parent place and its owner can be set once the location exists.',
    Items: 'Creator, owner, and where it is found or sold can be set once the item exists.',
    Races: 'Members are filled in automatically as you assign this race to characters.',
    Factions: 'Leader, territory, members, and knowledge open once the faction exists.',
    Characters: 'Race, inventory, connections, and knowledge open once the character exists.',
    Creatures: 'Habitat, inventory, connections, and knowledge open once it exists.',
    Events: 'Places, participants, and recorded occurrences open once the event exists.',
  }[type] || 'Connections can be added once this entity exists.';
}

// Invented (non-user) example names, English.
function placeholderName(type) {
  return { System: 'e.g. The Three Laws of Aether', Locations: 'e.g. Thornhall', Items: 'e.g. Stormglass Lantern', Races: 'e.g. Tidewalkers', Factions: 'e.g. The Ember Concord', Characters: 'e.g. Captain Aldric Venn', Creatures: 'e.g. The Gloamwyrm', Events: 'e.g. The Siege of Thornhall' }[type] || 'Name';
}
function placeholderAlias(type) {
  return { System: 'e.g. Assimilation, The Assimilation Protocol', Locations: 'e.g. The Bramble Keep', Items: 'e.g. The Tempest Lamp', Races: 'e.g. Brinekin', Factions: 'e.g. The Concord', Characters: 'e.g. Captain, The Grey Wolf', Creatures: 'e.g. The Bog Serpent', Events: 'e.g. The Long Night' }[type] || '';
}
