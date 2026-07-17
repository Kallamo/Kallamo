import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import {
  Plus, Search, BookOpen, MapPin, Package, Users, Flag, User,
  Sparkles, Trash2, Save, X, Pencil, Check, Link2, Globe, Tag, ScrollText, Ghost, Info, Replace,
  Lock, ShieldCheck, RefreshCw, Upload, Download, CalendarClock, ChevronRight, ChevronsLeftRight,
  AlertTriangle,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import Button from './ui/Button';
import Checkbox from './ui/Checkbox';
import Popover from './ui/Popover';
import ConfirmDialog from './ui/ConfirmDialog';
import ExportWorldbuildModal from './modals/ExportWorldbuildModal';
import { buildLocationTree } from '../features/worldbuild/locationTree';
import EntityPickerButton from '../features/worldbuild/EntityPickerButton';
import { useSidebarWidth } from '../features/worldbuild/useSidebarWidth';
import { useWorldbuildNavigationState } from '../features/worldbuild/useWorldbuildNavigationState';
import {
  ABUNDANCE_HELP, CREATURE_NATURES, DISPOSITION, fieldLabel, ITEM_TYPES, meta, TYPES,
  RARITY, RELATIONSHIP_LABELS, STATUS, THREAT, TYPE_ORDER,
} from '../features/worldbuild/worldbuildConfig';

// Frosted dark inputs: their own dark backing guarantees legible text over BOTH
// light and dark workspace backgrounds, while the blur keeps the background alive.
const FIELD = 'wb-input w-full bg-[#06121a]/75 backdrop-blur-md border border-white/15 text-gray-100 text-sm rounded-lg px-3 py-2 placeholder-gray-400/70 focus:outline-none focus:border-accent/70 focus:bg-[#06121a]/90 transition-colors';
const LInput = (p) => <input {...p} className={`${FIELD} ${p.className || ''}`} />;
const LTextarea = (p) => <textarea {...p} className={`${FIELD} resize-none leading-relaxed custom-scrollbar ${p.className || ''}`} />;
const LSelect = ({ children, ...p }) => <select {...p} className={`${FIELD} cursor-pointer ${p.className || ''}`}>{children}</select>;

// A colored state pill (life status, disposition…). `map` is one of STATUS/DISPOSITION.
const StateTag = ({ map, value }) => {
  const s = map[value]; if (!s) return null;
  return <span className={`inline-flex items-center text-[10px] font-bold uppercase tracking-wider border rounded-full px-2 py-0.5 ${s.cls}`}>{s.label}</span>;
};

const EvidenceReferences = ({ excerpts, support = '' }) => {
  const [open, setOpen] = useState(false);
  const references = excerpts.filter(Boolean);
  if (!references.length && !support) return null;
  return (
    <div className="mt-2">
      <button type="button" onClick={() => setOpen(value => !value)} className="inline-flex items-center gap-1 text-xs font-semibold text-sky-100/75 hover:text-sky-50 transition-colors">
        <ChevronRight className={`w-3.5 h-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
        {open ? 'Hide references' : references.length ? `View references (${references.length})` : 'View explanation'}
      </button>
      {open && <div className="mt-2 max-h-56 overflow-y-auto space-y-2 pr-1 custom-scrollbar">
        {support && <p className="caption text-sky-100/75">{support}</p>}
        {references.map((excerpt, index) => <p key={index} className="caption text-sky-100/75">“{excerpt}”</p>)}
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
  review: { label: 'Review', icon: ShieldCheck, tip: 'AI edits are staged for your approval', active: 'bg-amber-400/15 text-amber-200 border-amber-400/40' },
  locked: { label: 'Locked', icon: Lock,        tip: 'AI can read but never edit this entity', active: 'bg-slate-400/15 text-slate-200 border-slate-400/40' },
};
const AiPolicyControl = ({ value, onChange }) => {
  const cur = AI_POLICY[value] ? value : 'review';
  return (
    <div className="flex flex-col items-end gap-1 shrink-0">
      <div className="inline-flex rounded-lg border border-white/10 bg-black/20 p-0.5">
        {Object.entries(AI_POLICY).map(([k, v]) => {
          const Icon = v.icon; const on = k === cur;
          return (
            <button key={k} type="button" onClick={() => onChange(k)} data-tooltip={v.tip}
              className={`p-1.5 rounded-md transition-colors cursor-pointer ${on ? v.active + ' border' : 'text-gray-500 hover:text-gray-300 border border-transparent'}`}>
              <Icon className="w-3.5 h-3.5" />
            </button>
          );
        })}
      </div>
      <span className="text-[10px] font-semibold uppercase tracking-wider text-gray-500">AI: {AI_POLICY[cur].label}</span>
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
  const [rect, setRect] = useState(null);
  const wrapRef = useRef(null);
  const menuRef = useRef(null);
  const opts = [...new Set(options.filter(Boolean))];
  const q = (value || '').toLowerCase();
  const filtered = opts.filter(o => o.toLowerCase().includes(q));
  const openMenu = () => { if (wrapRef.current) setRect(wrapRef.current.getBoundingClientRect()); setOpen(true); };
  useEffect(() => {
    if (!open) return;
    const close = (e) => { if (wrapRef.current && !wrapRef.current.contains(e.target)) setOpen(false); };
    // Close when the panel scrolls (the fixed menu would detach), but not when the
    // scroll happens inside the menu itself.
    const drop = (e) => { if (menuRef.current && menuRef.current.contains(e.target)) return; setOpen(false); };
    document.addEventListener('mousedown', close);
    window.addEventListener('scroll', drop, true);
    window.addEventListener('resize', drop);
    return () => { document.removeEventListener('mousedown', close); window.removeEventListener('scroll', drop, true); window.removeEventListener('resize', drop); };
  }, [open]);
  return (
    <div className="relative" ref={wrapRef}>
      <LInput placeholder={placeholder} value={value || ''} onFocus={openMenu} onChange={(e) => { onChange(e); openMenu(); }} />
      {open && filtered.length > 0 && rect && createPortal(
        <div ref={menuRef} style={{ position: 'fixed', top: rect.bottom + 4, left: rect.left, width: rect.width, zIndex: 60 }}
          className="max-h-44 overflow-y-auto custom-scrollbar rounded-lg border border-white/15 bg-[#021a20] shadow-xl py-1">
          {filtered.map(o => (
            <button key={o} type="button" onMouseDown={(e) => { e.preventDefault(); onChange({ target: { value: o } }); setOpen(false); }}
              className="w-full text-left px-3 py-1.5 text-sm text-gray-200 hover:bg-accent/15 hover:text-white cursor-pointer transition-colors">{o}</button>
          ))}
        </div>, document.body)}
    </div>
  );
};

// A small "?" that reveals a themed legend on hover, matching the app's tooltips.
const InfoPopover = ({ items }) => {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex align-middle" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <Info className="w-3 h-3 text-gray-500 hover:text-accent cursor-help" />
      {open && (
        <div className="absolute z-30 top-6 left-0 w-60 rounded-lg border border-white/15 bg-[#021a20] shadow-xl p-3 space-y-1.5 normal-case tracking-normal">
          {items.map(([k, v]) => <div key={k} className="text-xs leading-snug"><span className="font-semibold text-gray-100">{k}</span> <span className="text-gray-400">{v}</span></div>)}
        </div>
      )}
    </span>
  );
};

const FieldLabel = ({ children }) => <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">{children}</label>;
const Hint = ({ children }) => <span className="caption mt-1 block">{children}</span>;
const Edit = ({ label, hint, children }) => (
  <div>{label && <FieldLabel>{label}</FieldLabel>}{children}{hint && <Hint>{hint}</Hint>}</div>
);

// Read-only field in the rendered sheet.
const ViewField = ({ label, value, empty = 'Not set' }) => (
  <div>
    <div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-0.5">{label}</div>
    {value ? <div className="text-sm text-gray-100">{value}</div> : <div className="text-sm text-gray-600 italic">{empty}</div>}
  </div>
);

const Prose = ({ text, empty = 'Nothing written yet.' }) =>
  text && text.trim()
    ? <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap">{text}</p>
    : <p className="text-sm text-gray-600 italic">{empty}</p>;

const Chip = ({ children }) => (
  <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-200 bg-white/[0.06] border border-white/10 rounded-full px-2.5 py-0.5">{children}</span>
);

// A sheet section: titled card with an optional pencil that flips it to edit mode.
function Section({ icon: Icon, title, editing, onEdit, showPencil, children }) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#0a1721]/60 backdrop-blur-md overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-white/[0.08]">
        <div className="flex items-center gap-2">
          <Icon className="w-3.5 h-3.5 text-accent" />
          <span className="text-[11px] font-bold uppercase tracking-wider text-gray-300">{title}</span>
        </div>
        {showPencil && !editing && (
          <button onClick={onEdit} data-tooltip="Edit this section"
            className="p-1.5 -mr-1 text-gray-500 hover:text-accent hover:bg-white/5 rounded-md transition-colors cursor-pointer">
            <Pencil className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
      <div className="p-4 space-y-3.5">{children}</div>
    </div>
  );
}

const draftFor = (type) => ({ id: null, type, canonicalName: '', aliases: '', lore: '', loreDocumentId: '', status: 'confirmed', data: {} });

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
          ? <span className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-100 bg-white/[0.08] border border-white/15 rounded-full pl-2.5 pr-1 py-0.5">
              {currentName}
              <button onClick={() => onSet(null)} className="text-gray-400 hover:text-rose-300 cursor-pointer p-0.5"><X className="w-3 h-3" /></button>
            </span>
          : <span className="caption">None set.</span>}
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
          <span key={l.linkId} className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-100 bg-white/[0.08] border border-white/15 rounded-full pl-2.5 pr-1 py-0.5">
            {l.entity.canonicalName}
            <button onClick={() => onRemove(l.linkId)} className="text-gray-400 hover:text-rose-300 cursor-pointer p-0.5"><X className="w-3 h-3" /></button>
          </span>
        ))}
        <EntityPickerButton title={label} options={remaining} onPick={onAdd} />
      </div>
    </Edit>
  );
}

// Character↔character relationships: a labeled edge from the open sheet's point of
// view. You pick another character and name how they relate to this one (e.g. their
// father, their rival). The role is free text and self-completing; it is optional so
// Add never silently blocks. Reads naturally: "{role} · {name}".
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
          <span key={l.linkId} className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-100 bg-white/[0.08] border border-white/15 rounded-full pl-2.5 pr-1 py-0.5">
            <span className="text-accent/90 font-semibold">{l.label || 'related'}</span> · {l.entity.canonicalName}
            <button onClick={() => onRemove(l.linkId)} className="text-gray-400 hover:text-rose-300 cursor-pointer p-0.5"><X className="w-3 h-3" /></button>
          </span>
        ))}
      </div>
      {remaining.length === 0
        ? <span className="caption">Everyone is already linked.</span>
        : toId
          ? <div className="flex items-center gap-1.5">
              <span className="caption shrink-0"><span className="text-gray-200 font-medium">{pickedName}</span> is {who}'s</span>
              <div className="flex-1"><FreeDatalist value={role} onChange={(e) => setRole(e.target.value)} options={suggestions} placeholder="e.g. father, rival, mentor (optional)" /></div>
              <Button size="sm" icon={Check} onClick={submit}>Add</Button>
              <Button size="sm" variant="ghost" onClick={() => { setToId(''); setRole(''); }}>Cancel</Button>
            </div>
          : <EntityPickerButton label="Add relationship" title="Choose a character" options={remaining} onPick={(id) => setToId(id)} />}
    </Edit>
  );
}

// One member row with an inline, optional role that saves on blur / Enter.
function MemberRole({ link, onSetRole, onRemove }) {
  const [role, setRole] = useState(link.label || '');
  useEffect(() => { setRole(link.label || ''); }, [link.label]);
  const commit = () => { if ((role.trim() || '') !== (link.label || '')) onSetRole(link.linkId, role.trim()); };
  return (
    <div className="flex items-center gap-2 py-1">
      <span className="text-sm text-gray-100 flex-1 min-w-0 truncate">{link.entity.canonicalName}</span>
      <input value={role} onChange={(e) => setRole(e.target.value)} onBlur={commit} onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); }}
        placeholder="role (optional)"
        className="wb-input w-36 bg-[#06121a]/75 border border-white/15 text-gray-100 text-xs rounded-md px-2 py-1 placeholder-gray-500 focus:outline-none focus:border-accent/70" />
      <button onClick={() => onRemove(link.linkId)} className="text-gray-400 hover:text-rose-300 cursor-pointer p-1"><X className="w-3.5 h-3.5" /></button>
    </div>
  );
}

// Faction membership with per-member roles: an editable list plus an add picker.
function MemberRoles({ links, options, onAdd, onSetRole, onRemove, disabled }) {
  if (disabled) return null;
  const linked = new Set((links || []).map(l => l.entity.id));
  const remaining = options.filter(o => !linked.has(o.id));
  return (
    <Edit label="Members" hint="Add characters, then give each an optional role (captain, spy, initiate).">
      <div className="divide-y divide-white/[0.06] mb-2">
        {(!links || links.length === 0) && <span className="caption">No members yet.</span>}
        {(links || []).map(l => <MemberRole key={l.linkId} link={l} onSetRole={onSetRole} onRemove={onRemove} />)}
      </div>
      <EntityPickerButton label="Add member" title="Add member" options={remaining} onPick={onAdd} />
    </Edit>
  );
}

export default function WorldbuildView({ chat, electronAPI, focusEntityId, onFocusHandled }) {
  const { showToast, settings, openSettings } = useApp();
  // Entity enrichment (and world tagging) run on the dedicated System AI only. Without one
  // the "Update entities" button stays visible but disabled, with a tooltip pointing here.
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
  const [bulkConfirm, setBulkConfirm] = useState(null);
  const [bulkSaving, setBulkSaving] = useState(false);
  const [selected, setSelected] = useState(null);
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
  const docTitle = (id) => documents.find(d => d.id === id)?.title;

  const byType = useMemo(() => {
    const m = {}; for (const t of Object.keys(TYPES)) m[t] = [];
    for (const e of entities) (m[e.type] = m[e.type] || []).push(e);
    return m;
  }, [entities]);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    try {
      const [entityRes, linkRes] = await Promise.all([
        electronAPI.listEntities(workspaceId),
        electronAPI.listEntityLinks(workspaceId, 'inside'),
      ]);
      setEntities(entityRes?.entities || []);
      setInsideLinks(linkRes?.links || []);
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
    setRel({});
    setManageMode(false);
    setSelectedIds(new Set());
    setReviewFilter(null);
    load();
    loadEnrichErrors();
  }, [load, loadEnrichErrors]);
  useEffect(() => { electronAPI.getWritingTree(workspaceId).then(t => setDocuments(t?.documents || [])).catch(() => setDocuments([])); }, [workspaceId, electronAPI]);
  const loadRelations = useCallback(async (ent) => {
    if (!ent?.id) { setRel({}); return; }
    const from = (r) => electronAPI.getEntityLinks(ent.id, 'from', r).then(x => x?.links || []);
    const to = (r) => electronAPI.getEntityLinks(ent.id, 'to', r).then(x => x?.links || []);
    const n = {};
    if (ent.type === 'Locations') { n.inside = (await from('inside'))[0] || null; n.leader = (await from('led_by'))[0] || null; }
    if (ent.type === 'Items') { n.createdBy = (await from('created_by'))[0] || null; n.ownedBy = (await from('owned_by'))[0] || null; n.foundIn = await from('found_in'); }
    if (ent.type === 'Races') n.members = await to('is_race');
    if (ent.type === 'Creatures') n.foundIn = await from('found_in');
    if (ent.type === 'Events') { n.happenedAt = await from('happened_at'); n.involved = await from('involved'); }
    if (ent.type === 'Factions') { n.operatesIn = await from('operates_in'); n.members = await to('member_of'); n.leader = (await from('led_by'))[0] || null; }
    if (ent.type === 'Characters') { n.isRace = (await from('is_race'))[0] || null; n.inventory = await to('owned_by'); n.memberOf = await from('member_of'); n.connectedTo = await from('connected_to'); n.relationships = await from('related_to'); }
    setRel(n);
  }, [electronAPI]);

  const openEntity = async (en) => {
    setEditingSection(null); setCharTab('data'); setMergePrompt(null);
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
    if (!navigationStateReady || focusEntityId || selected || !restoredEntityId) return;
    const en = entities.find(e => e.id === restoredEntityId);
    if (en) openEntity(en);
  }, [navigationStateReady, focusEntityId, selected, restoredEntityId, entities]); // eslint-disable-line react-hooks/exhaustive-deps
  const startNew = (type) => { setShowCreate(false); setEditingSection(null); setCharTab('data'); setSelected(draftFor(type)); setRel({}); };
  const patch = (f) => setSelected(p => ({ ...p, ...f }));
  const patchData = (f) => setSelected(p => ({ ...p, data: { ...p.data, ...f } }));

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
      if (res.upToDate) bits.push(`${res.upToDate} already up to date`);
      if (res.noEvidence) bits.push(`${res.noEvidence} with no matching evidence`);
      if (res.evidenceUsed) bits.push(`${res.evidenceUsed} evidence passages read`);
      if (res.taggedEvidenceRemaining) bits.push(`${res.taggedEvidenceRemaining} tagged passages pending`);
      if (res.textMatchesSkipped) bits.push(`${res.textMatchesSkipped} lower-priority text matches skipped`);
      if (res.failed) bits.push(`${res.failed} failed`);
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
    showToast(`Imported ${r.entitiesAdded} entit${r.entitiesAdded === 1 ? 'y' : 'ies'}${linkBit} for review. Accept, merge, or dismiss each in the sidebar.`, 'success');
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
      if (r.entity) await openEntity(r.entity);
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

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = entities.filter(en =>
      (!filterType || en.type === filterType) &&
      (!reviewFilter || (reviewFilter === 'proposed' ? en.status === 'proposed' : en.status !== 'proposed' && en.data?._enrichPending)) &&
      (!q || [en.canonicalName, ...(en.aliases || [])].join(' ').toLowerCase().includes(q))
    );
    return list.sort((a, b) => (TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type)) || a.canonicalName.localeCompare(b.canonicalName));
  }, [entities, search, filterType, reviewFilter]);
  const locationTree = useMemo(() => buildLocationTree(entities, insideLinks), [entities, insideLinks]);
  const useLocationTree = !search.trim() && !reviewFilter && (!filterType || filterType === 'Locations');
  const toggleLocation = (id) => setExpandedLocations(current => ({ ...current, [id]: current[id] === false }));
  const proposedCount = useMemo(() => entities.filter(e => e.status === 'proposed').length, [entities]);
  const pendingUpdateCount = useMemo(() => entities.filter(e => e.status !== 'proposed' && e.data?._enrichPending).length, [entities]);
  const exportableCount = useMemo(() => entities.filter(e => e.status !== 'proposed').length, [entities]);
  const selectedEntities = useMemo(() => entities.filter(entity => selectedIds.has(entity.id)), [entities, selectedIds]);
  const visibleIds = useMemo(() => new Set(filtered.map(entity => entity.id)), [filtered]);
  const hiddenSelectedCount = useMemo(() => selectedEntities.filter(entity => !visibleIds.has(entity.id)).length, [selectedEntities, visibleIds]);
  const selectedProposedCount = selectedEntities.filter(entity => entity.status === 'proposed').length;
  const selectedUpdateCount = selectedEntities.filter(entity => entity.status !== 'proposed' && entity.data?._enrichPending).length;

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
      else if (action === 'accept-all') showToast(`Accepted ${result.proposed.accepted} proposal${result.proposed.accepted === 1 ? '' : 's'} and updates for ${result.updates.accepted} entit${result.updates.accepted === 1 ? 'y' : 'ies'}.`, 'success');
      else if (action === 'delete') showToast(`Deleted ${result.deleted} entit${result.deleted === 1 ? 'y' : 'ies'}.`, 'success');
      const selectedId = selected?.id;
      if (action === 'delete' && selectedId && ids.includes(selectedId)) setSelected(null);
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

  const isResource = selected?.type === 'Items' && (selected?.data?.itemType || '') === 'Resource';
  const isGear = selected?.type === 'Items' && !isResource;
  const unsaved = isNew;

  // Owner as a single 3-mode choice: the AI decides, it is deliberately lost, or a
  // character holds it. A character owner is an owned_by edge; the two ownerless modes
  // live in data.ownership. Picking a character also clears the ownerless flag.
  const ownerVal = rel.ownedBy ? rel.ownedBy.entity.id : (selected?.data?.ownership === 'lost' ? 'lost' : 'ai');
  const setOwner = async (val) => {
    if (val === 'ai' || val === 'lost') { patchData({ ownership: val }); await setSingle('owned_by', null); }
    else { patchData({ ownership: 'character' }); await setSingle('owned_by', val); }
  };
  // Where-found is hidden once a character owns the item (it lives in their inventory).
  const showWhereFound = isResource || !rel.ownedBy;
  const ownerLabel = rel.ownedBy ? rel.ownedBy.entity.canonicalName : (selected?.data?.ownership === 'lost' ? 'Unknown / Lost' : 'AI decides');

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
            <span key={id} className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-100 bg-white/[0.08] border border-white/15 rounded-full pl-2.5 pr-1 py-0.5">
              <ScrollText className="w-3 h-3 text-accent/80" />{docTitle(id) || 'Untitled'}
              <button onClick={() => removeLoreDoc(id)} className="text-gray-400 hover:text-rose-300 cursor-pointer p-0.5"><X className="w-3 h-3" /></button>
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
        view: <div className="grid grid-cols-2 gap-4"><ViewField label="Type" value={selected.data.locationType} empty="Not set" /><ViewField label="Inside" value={rel.inside?.entity?.canonicalName} empty="Not set" /><ViewField label="Owner / leader" value={rel.leader?.entity?.canonicalName} empty="Not set" /></div>,
        edit: <>
          <Edit label="Type"><LInput placeholder="e.g. continent / kingdom / city / tavern" value={selected.data.locationType || ''} onChange={(e) => patchData({ locationType: e.target.value })} /></Edit>
          <SingleRelation label="Inside another place" hint="Nest this within a larger location." disabled={unsaved} current={rel.inside?.entity?.id} options={byType.Locations.filter(o => o.id !== selected.id)} onSet={(id) => setSingle('inside', id)} />
          <SingleRelation label="Owner / leader (optional)" hint="Who holds or rules this place, if anyone." disabled={unsaved} current={rel.leader?.entity?.id} options={byType.Characters} onSet={(id) => setSingle('led_by', id)} />
        </> });
      S.push({ key: 'lore', title: 'Lore', icon: ScrollText, scalar: true, view: loreView, edit: loreEdit });
    }
    if (type === 'Items') {
      S.push({ key: 'details', title: 'Details', icon: Package, scalar: true,
        view: <>
          <div className="grid grid-cols-2 gap-4">
            <ViewField label="Type" value={selected.data.itemType} empty="Not set" />
            {isGear && <ViewField label="Owner" value={ownerLabel} empty="Not set" />}
            {isGear && <ViewField label="Creator" value={rel.createdBy?.entity?.canonicalName} empty="Unknown" />}
            {isResource && <ViewField label="Abundance" value={selected.data.abundance} empty="Not set" />}
            {showWhereFound && <div className="col-span-2"><div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-0.5">Where found</div><ChipList links={rel.foundIn} empty="Not set" /></div>}
          </div>
          <div className="pt-1"><Prose text={selected.data.description} empty="No description." /></div>
        </>,
        edit: <>
          <Edit label="Item type"><LSelect value={selected.data.itemType || ''} onChange={(e) => patchData({ itemType: e.target.value })}><option value="">Choose…</option>{ITEM_TYPES.map(t => <option key={t} value={t}>{t}{t === 'Resource' ? ' (natural / drops)' : ''}</option>)}</LSelect></Edit>
          {isGear && <SingleRelation label="Creator" hint="Leave blank if unknown." disabled={unsaved} current={rel.createdBy?.entity?.id} options={byType.Characters} onSet={(id) => setSingle('created_by', id)} />}
          {isGear && <Edit label="Owner" hint={unsaved ? 'Save first to assign an owner.' : 'Who holds it. Or let the AI decide, or leave it lost.'}>
            <LSelect value={ownerVal} disabled={unsaved} onChange={(e) => setOwner(e.target.value)}>
              <option value="ai">AI decides</option>
              <option value="lost">Unknown / Lost</option>
              {byType.Characters.map(o => <option key={o.id} value={o.id}>{o.canonicalName}</option>)}
            </LSelect>
          </Edit>}
          {isResource && <Edit label={<>Abundance <InfoPopover items={ABUNDANCE_HELP} /></>} hint="How much of it exists in the world."><LSelect value={selected.data.abundance || ''} onChange={(e) => patchData({ abundance: e.target.value })}><option value="">Choose…</option>{RARITY.map(r => <option key={r} value={r}>{r}</option>)}</LSelect></Edit>}
          {showWhereFound && <MultiRelation label="Where found" hint={isResource ? 'Every place this resource can be gathered.' : 'Where it turns up when no one owns it.'} disabled={unsaved} links={rel.foundIn || []} options={byType.Locations} onAdd={(id) => addMulti('found_in', id)} onRemove={removeLink} />}
          <Edit label="Description"><LTextarea rows={4} placeholder="What it looks like and does." value={selected.data.description || ''} onChange={(e) => patchData({ description: e.target.value })} /></Edit>
        </> });
      S.push({ key: 'lore', title: 'Lore', icon: ScrollText, scalar: true, view: loreView, edit: loreEdit });
    }
    if (type === 'Races') {
      S.push({ key: 'desc', title: 'Description', icon: Users, scalar: true, view: <Prose text={selected.data.description} />, edit: <Edit label="Description"><LTextarea rows={5} placeholder="Traits, appearance, culture." value={selected.data.description || ''} onChange={(e) => patchData({ description: e.target.value })} /></Edit> });
      S.push({ key: 'lore', title: 'Lore', icon: ScrollText, scalar: true, view: loreView, edit: loreEdit });
      S.push({ key: 'members', title: 'Known members', icon: User, scalar: false, derived: true, relational: true, view: <ChipList links={rel.members} empty="Auto-filled as you assign this race to characters." />, edit: <ChipList links={rel.members} empty="Auto-filled as you assign this race to characters." /> });
    }
    if (type === 'Creatures') {
      const natureOpts = [...CREATURE_NATURES, ...byType.Creatures.map(c => c.data?.nature).filter(Boolean)];
      const isIndividual = (selected.data.scope || 'individual') !== 'group';
      S.push({ key: 'details', title: 'Details', icon: Ghost, scalar: true,
        view: <>
          <div className="flex flex-wrap gap-2 mb-3">
            <StateTag map={DISPOSITION} value={selected.data.disposition || 'unknown'} />
            {isIndividual && <StateTag map={STATUS} value={selected.data.status || 'unknown'} />}
          </div>
          <div className="grid grid-cols-2 gap-4">
            <ViewField label="Kind" value={isIndividual ? 'A specific being' : 'A group / species'} />
            <ViewField label="Nature" value={selected.data.nature} empty="Not set" />
            {!isIndividual && <ViewField label="Abundance" value={selected.data.abundance} empty="Not set" />}
            <ViewField label="Threat" value={selected.data.threat} empty="Not set" />
          </div>
          <div className="pt-1"><ViewField label="Abilities & traits" value={selected.data.abilities} empty="Not set" /></div>
          <div className="pt-1"><div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-0.5">Habitat</div><ChipList links={rel.foundIn} empty="Not set" /></div>
        </>,
        edit: <>
          <Edit label="This entity is">
            <div className="flex bg-white/[0.04] p-0.5 rounded-lg border border-white/10 w-fit">
              {[['individual', 'A specific being'], ['group', 'A group / species']].map(([k, l]) => (
                <button key={k} type="button" onClick={() => patchData({ scope: k })} className={`px-3 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${(selected.data.scope || 'individual') === k ? 'bg-accent text-[#011419]' : 'text-gray-400 hover:text-white'}`}>{l}</button>
              ))}
            </div>
            <Hint>A group (goblins, a wolf pack) has no single life state. A specific being (one tamed wolf) does.</Hint>
          </Edit>
          <Edit label="Nature / category" hint="What kind of thing it is. Type your own or reuse one."><FreeDatalist value={selected.data.nature} onChange={(e) => patchData({ nature: e.target.value })} options={natureOpts} placeholder="e.g. Beast, Spirit, Deity" /></Edit>
          <div className="grid grid-cols-2 gap-3">
            <Edit label="Disposition"><StateSelect map={DISPOSITION} value={selected.data.disposition || 'unknown'} onChange={(e) => patchData({ disposition: e.target.value })} /></Edit>
            {isIndividual && <Edit label="Status"><StateSelect map={STATUS} value={selected.data.status || 'unknown'} onChange={(e) => patchData({ status: e.target.value })} /></Edit>}
            {!isIndividual && <Edit label={<>Abundance <InfoPopover items={ABUNDANCE_HELP} /></>}><LSelect value={selected.data.abundance || ''} onChange={(e) => patchData({ abundance: e.target.value })}><option value="">Choose…</option>{RARITY.map(r => <option key={r} value={r}>{r}</option>)}</LSelect></Edit>}
            <Edit label="Threat"><LSelect value={selected.data.threat || ''} onChange={(e) => patchData({ threat: e.target.value })}><option value="">Choose…</option>{THREAT.map(t => <option key={t} value={t}>{t}</option>)}</LSelect></Edit>
          </div>
          <Edit label="Abilities & traits" hint="Short, concrete powers the AI can use in a scene."><LTextarea rows={3} placeholder="e.g. flies, breathes fire, immune to steel." value={selected.data.abilities || ''} onChange={(e) => patchData({ abilities: e.target.value })} /></Edit>
          <MultiRelation label="Habitat" hint="Where it is found or dwells." disabled={unsaved} links={rel.foundIn || []} options={byType.Locations} onAdd={(id) => addMulti('found_in', id)} onRemove={removeLink} />
        </> });
      S.push({ key: 'lore', title: 'Lore', icon: ScrollText, scalar: true, view: loreView, edit: loreEdit });
    }
    if (type === 'Factions') {
      S.push({ key: 'overview', title: 'Overview', icon: MapPin, scalar: false, relational: true,
        view: <>
          <ViewField label="Leader" value={rel.leader?.entity?.canonicalName} empty="Not set" />
          <div className="pt-2"><div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-0.5">Area of operation</div><ChipList links={rel.operatesIn} empty="No territory set." /></div>
        </>,
        edit: <>
          <SingleRelation label="Leader (optional)" hint="Who heads this faction." disabled={unsaved} current={rel.leader?.entity?.id} options={byType.Characters} onSet={(id) => setSingle('led_by', id)} />
          <MultiRelation label="Origin / area of operation" hint="Locations this faction works out of." disabled={unsaved} links={rel.operatesIn || []} options={byType.Locations} onAdd={(id) => addMulti('operates_in', id)} onRemove={removeLink} />
        </> });
      S.push({ key: 'desc', title: 'Description', icon: Flag, scalar: true, view: <Prose text={selected.data.description} />, edit: <Edit label="Description"><LTextarea rows={5} placeholder="Goals, structure, reputation." value={selected.data.description || ''} onChange={(e) => patchData({ description: e.target.value })} /></Edit> });
      S.push({ key: 'lore', title: 'Lore', icon: ScrollText, scalar: true, view: loreView, edit: loreEdit });
      S.push({ key: 'members', title: 'Members', icon: Users, scalar: false, relational: true,
        view: (!rel.members || rel.members.length === 0)
          ? <p className="text-sm text-gray-600 italic">No members yet.</p>
          : <div className="flex flex-wrap gap-1.5">{rel.members.map(l => <Chip key={l.linkId}>{l.entity.canonicalName}{l.label && <span className="text-accent/90"> · {l.label}</span>}</Chip>)}</div>,
        edit: <MemberRoles disabled={unsaved} links={rel.members || []} options={byType.Characters} onAdd={(id) => addMulti('member_of', id, false)} onSetRole={setRole} onRemove={removeLink} /> });
    }
    if (type === 'Events') {
      const kindOpts = ['Battle', 'Festival', 'Holiday', 'Disaster', 'Ceremony', 'Discovery'];
      S.push({ key: 'overview', title: 'Overview', icon: CalendarClock, scalar: false, relational: true,
        view: <>
          <ViewField label="Kind" value={selected.data.kind} empty="Not set" />
          <div className="pt-2"><div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-0.5">Where it happened</div><ChipList links={rel.happenedAt} empty="No place set." /></div>
          <div className="pt-2"><div className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-0.5">Who was involved</div><ChipList links={rel.involved} empty="No one set." /></div>
        </>,
        edit: <>
          <Edit label="Kind" hint="What sort of event. Type your own or reuse one."><FreeDatalist value={selected.data.kind} onChange={(e) => patchData({ kind: e.target.value })} options={kindOpts} placeholder="e.g. Battle, Festival, Holiday" /></Edit>
          <MultiRelation label="Where it happened" hint="Places this event took place." disabled={unsaved} links={rel.happenedAt || []} options={byType.Locations} onAdd={(id) => addMulti('happened_at', id)} onRemove={removeLink} />
          <MultiRelation label="Who was involved" hint="Characters who took part." disabled={unsaved} links={rel.involved || []} options={byType.Characters} onAdd={(id) => addMulti('involved', id)} onRemove={removeLink} />
        </> });
      S.push({ key: 'desc', title: 'Description', icon: CalendarClock, scalar: true, view: <Prose text={selected.data.description} />, edit: <Edit label="Description"><LTextarea rows={5} placeholder="What happened, and why it matters." value={selected.data.description || ''} onChange={(e) => patchData({ description: e.target.value })} /></Edit> });
      S.push({ key: 'lore', title: 'Lore', icon: ScrollText, scalar: true, view: loreView, edit: loreEdit });
    }
    return S;
  };

  // Character sheet is tabbed; build its sections per active tab.
  const characterSections = () => {
    if (charTab === 'data') return [
      { key: 'identity', title: 'Identity', icon: User, scalar: true,
        view: <>
          <div className="mb-3 flex items-center gap-2"><span className="text-[10px] font-bold uppercase tracking-wider text-gray-500">Status</span><StateTag map={STATUS} value={selected.data.status || 'unknown'} /></div>
          <div className="grid grid-cols-2 gap-4"><ViewField label="Age" value={selected.data.age} empty="Not set" /><ViewField label="Race" value={rel.isRace?.entity?.canonicalName} empty="Not set" /></div>
        </>,
        edit: <>
          <div className="grid grid-cols-2 gap-3">
            <Edit label="Age"><LInput placeholder="e.g. 34" value={selected.data.age || ''} onChange={(e) => patchData({ age: e.target.value })} /></Edit>
            <Edit label="Status"><StateSelect map={STATUS} value={selected.data.status || 'unknown'} onChange={(e) => patchData({ status: e.target.value })} /></Edit>
          </div>
          <SingleRelation label="Race" disabled={unsaved} current={rel.isRace?.entity?.id} options={byType.Races} onSet={(id) => setSingle('is_race', id)} />
        </> },
      { key: 'lore', title: 'Lore', icon: ScrollText, scalar: true, view: loreView, edit: loreEdit },
    ];
    if (charTab === 'inventory') return [
      { key: 'inv', title: 'Inventory', icon: Package, scalar: false,
        view: <ChipList links={rel.inventory} empty="Carrying nothing yet." />,
        edit: <MultiRelation label="Inventory" hint="Assigning here sets the item's owner to this character." disabled={unsaved} links={rel.inventory || []} options={byType.Items} onAdd={addInventory} onRemove={removeLink} /> },
    ];
    return [
      { key: 'fac', title: 'Factions', icon: Flag, scalar: false, view: <ChipList links={rel.memberOf} empty="Belongs to no faction." />, edit: <MultiRelation label="Factions" hint="Groups this character belongs to." disabled={unsaved} links={rel.memberOf || []} options={byType.Factions} onAdd={(id) => addMulti('member_of', id)} onRemove={removeLink} /> },
      { key: 'loc', title: 'Locations', icon: MapPin, scalar: false, view: <ChipList links={rel.connectedTo} empty="Tied to no place." />, edit: <MultiRelation label="Locations" hint="Places this character is tied to." disabled={unsaved} links={rel.connectedTo || []} options={byType.Locations} onAdd={(id) => addMulti('connected_to', id)} onRemove={removeLink} /> },
      { key: 'rels', title: 'Relationships', icon: Users, scalar: false,
        view: (!rel.relationships || rel.relationships.length === 0)
          ? <p className="text-sm text-gray-600 italic">No relationships yet.</p>
          : <div className="flex flex-wrap gap-1.5">{rel.relationships.map(l => <Chip key={l.linkId}><span className="text-accent/90">{l.label || 'related'}</span> · {l.entity.canonicalName}</Chip>)}</div>,
        edit: <LabeledRelation subjectName={selected.canonicalName} disabled={unsaved} links={rel.relationships || []} options={byType.Characters.filter(o => o.id !== selected.id)} priorLabels={(rel.relationships || []).map(l => l.label).filter(Boolean)} onAdd={addRelationship} onRemove={removeLink} /> },
    ];
  };

  const sections = selected ? (selected.type === 'Characters' ? characterSections() : sectionsFor(selected.type)) : [];
  const m = selected ? meta(selected.type) : null;
  const nameLabel = selected?.type === 'System' ? 'Title' : 'Name';
  const showAliases = !!selected;

  const renderEntityButton = (en) => {
    const t = meta(en.type);
    const Icon = t.icon;
    const active = selected?.id === en.id;
    return (
      <div key={en.id} className="relative">
        {manageMode && <Checkbox size="sm" checked={selectedIds.has(en.id)} onChange={() => toggleEntitySelection(en.id)} ariaLabel={`Select ${en.canonicalName}`} className="absolute z-10 left-2.5 top-1/2 -translate-y-1/2" />}
        <button onClick={() => openEntity(en)} className={`w-full text-left pr-2.5 py-2 rounded-lg flex items-center gap-2.5 transition-colors cursor-pointer group ${manageMode ? 'pl-9' : 'pl-2.5'} ${active ? 'bg-accent/15' : 'hover:bg-white/5'}`}>
          <span className={`w-7 h-7 rounded-md border flex items-center justify-center shrink-0 ${t.medallion}`}><Icon className="w-3.5 h-3.5" /></span>
          <span className={`flex-1 min-w-0 truncate text-sm font-medium ${active ? 'text-accent' : 'text-gray-200'}`}>{en.canonicalName}</span>
          {en.status === 'proposed' && <Sparkles className="w-3.5 h-3.5 text-amber-300 shrink-0" data-tooltip="AI proposal, needs accept" />}
          {en.status !== 'proposed' && en.data?._enrichPending && <ShieldCheck className="w-3.5 h-3.5 text-sky-300 shrink-0" data-tooltip="AI updates awaiting review" />}
        </button>
      </div>
    );
  };

  const renderLocationNode = (node, isNested = false, isLast = false) => {
    const { entity, children } = node;
    const hasChildren = children.length > 0;
    const isExpanded = expandedLocations[entity.id] !== false;
    const t = meta(entity.type);
    const Icon = t.icon;
    const active = selected?.id === entity.id;
    return (
      <div key={entity.id} className={`relative ${isNested ? 'pl-4' : ''}`}>
        {isNested && (isLast
          ? <span className="absolute left-0 top-0 h-5 w-4 rounded-bl-sm border-b border-l border-emerald-300/25" />
          : <>
              <span className="absolute left-0 top-0 bottom-0 border-l border-emerald-300/25" />
              <span className="absolute left-0 top-5 w-4 border-t border-emerald-300/25" />
            </>)}
        <div className="relative">
            {manageMode && <Checkbox size="sm" checked={selectedIds.has(entity.id)} onChange={() => toggleEntitySelection(entity.id)} ariaLabel={`Select ${entity.canonicalName}`} className="absolute z-10 left-2.5 top-1/2 -translate-y-1/2" />}
            <button onClick={() => openEntity(entity)} className={`w-full text-left pr-2.5 py-2 rounded-lg flex items-center gap-2.5 transition-colors cursor-pointer group focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent ${manageMode ? 'pl-9' : 'pl-2.5'} ${hasChildren ? 'pr-9' : ''} ${active ? 'bg-accent/15' : 'hover:bg-white/5'}`}>
              <span className={`w-7 h-7 rounded-md border flex items-center justify-center shrink-0 ${t.medallion}`}><Icon className="w-3.5 h-3.5" /></span>
              <span className={`flex-1 min-w-0 truncate text-sm font-medium ${active ? 'text-accent' : 'text-gray-200'}`}>{entity.canonicalName}</span>
              {entity.status === 'proposed' && <Sparkles className="w-3.5 h-3.5 text-amber-300 shrink-0" data-tooltip="AI proposal, needs accept" />}
              {entity.status !== 'proposed' && entity.data?._enrichPending && <ShieldCheck className="w-3.5 h-3.5 text-sky-300 shrink-0" data-tooltip="AI updates awaiting review" />}
            </button>
            {hasChildren && <button type="button" onClick={() => toggleLocation(entity.id)} aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${entity.canonicalName}`} className="absolute right-1 top-1/2 -translate-y-1/2 w-7 h-7 flex items-center justify-center rounded-md text-gray-500 hover:text-gray-200 hover:bg-white/5 cursor-pointer focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent">
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
    return {
      tone: 'warning', title: 'Accept proposals and updates', confirm: 'Accept both',
      message: `Confirm ${summary.proposed} proposed entities and accept pending changes for ${summary.pendingUpdates} entities: ${updateDetails}.`,
    };
  })();

  return (
    <div className="flex-1 flex flex-col lg:flex-row h-full overflow-hidden bg-[#000508]/40 select-none relative">
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
            { label: bulkDialog.confirm, variant: bulkConfirm.action === 'delete' ? 'danger' : 'primary', autoFocus: true, loading: bulkSaving, onClick: () => runBulkAction(bulkConfirm.action) },
          ]}
          onClose={() => setBulkConfirm(null)}
        />
      )}
      {confirmDelete && selected && (
        <ConfirmDialog
          tone="danger"
          title="Delete entity"
          message={<>The {meta(selected.type).label.toLowerCase()} <strong className="text-gray-200">“{selected.canonicalName}”</strong> will be permanently deleted, along with its connections and story tags. This cannot be undone.</>}
          actions={[
            { label: 'Cancel', variant: 'ghost', onClick: () => setConfirmDelete(false) },
            { label: 'Delete', variant: 'danger', autoFocus: true, loading: saving, onClick: async () => { await remove(); setConfirmDelete(false); } },
          ]}
          onClose={() => setConfirmDelete(false)}
        />
      )}
      {enriching && (
        <div className="absolute inset-0 z-[70] flex flex-col items-center justify-center gap-3 bg-[#000508]/80 backdrop-blur-sm">
          <RefreshCw className="w-7 h-7 text-accent animate-spin" />
          <div className="text-center">
            <p className="text-sm font-bold text-white">Updating your world…</p>
            <p className="caption mt-1">
              {enrichProgress?.total
                ? `Reading passages for ${enrichProgress.name || 'your entities'} (${Math.min(enrichProgress.done + 1, enrichProgress.total)}/${enrichProgress.total})`
                : 'Reading your story and refreshing each entity.'}
            </p>
          </div>
        </div>
      )}
      {showEnrichErrors && enrichErrors.length > 0 && (
        <aside className="fixed right-5 bottom-20 z-[70] w-[min(30rem,calc(100vw-2.5rem))] max-h-[70vh] overflow-hidden rounded-xl border border-red-400/40 bg-[#180b0b]/85 backdrop-blur-xl shadow-2xl flex flex-col" aria-labelledby="entity-update-errors-title">
          <header className="shrink-0 flex items-start justify-between gap-4 px-4 py-3 border-b border-red-400/20 bg-[#210d0d]/70">
            <div className="flex min-w-0 gap-3">
              <AlertTriangle className="w-5 h-5 shrink-0 mt-0.5 text-red-300" />
              <div>
                <h2 id="entity-update-errors-title" className="font-bold text-red-100">Entity updates need attention</h2>
                <p className="mt-0.5 text-sm leading-relaxed text-red-200/80">{enrichErrorSummary || `${enrichErrors.length} ${enrichErrors.length === 1 ? 'entity update failed' : 'entity updates failed'}.`}</p>
              </div>
            </div>
            <button type="button" aria-label="Dismiss all entity update errors" onClick={dismissAllEnrichErrors} className="shrink-0 p-1 rounded text-red-200/70 hover:text-white focus-visible:ring-2 focus-visible:ring-red-300"><X className="w-5 h-5" /></button>
          </header>
          <div className="flex-1 overflow-y-auto overscroll-contain divide-y divide-red-500/20 custom-scrollbar" aria-live="polite">
              {enrichErrors.map(error => (
                <article key={error.id} className="p-4 text-sm">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <h3 className="font-bold text-red-100">{error.entityName}</h3>
                      <p className="mt-0.5 text-red-200/80">{meta(error.entityType).label}</p>
                      <p className="mt-3 leading-relaxed break-words text-red-100">{error.error}</p>
                    </div>
                  </div>
                  <div className="mt-4 flex items-center justify-between gap-3">
                    <button type="button" onClick={() => openSettings('engine', 'system-ai')} className="font-bold text-red-100 hover:text-white underline underline-offset-4">Open System AI settings</button>
                    <button type="button" onClick={() => dismissEnrichError(error.id)} className="text-red-200/80 hover:text-white">Dismiss</button>
                  </div>
                </article>
              ))}
          </div>
        </aside>
      )}
      <div style={{ '--worldbuild-sidebar-width': `${sidebarWidth}px` }} className="relative w-full lg:w-[var(--worldbuild-sidebar-width)] shrink-0 flex flex-col h-full overflow-visible border-r border-gray-800/40 bg-[#011419]/25 backdrop-blur-md">
        <button type="button" aria-label="Resize Worldbuild sidebar" onPointerDown={startSidebarResize} onKeyDown={handleSidebarResizeKey} className="hidden lg:flex absolute -right-4 top-3 z-20 w-8 h-8 items-center justify-center rounded-full border border-white/20 bg-[#071720] text-white shadow-lg cursor-col-resize transition-colors hover:border-accent hover:text-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent">
          <ChevronsLeftRight className="w-4 h-4" />
        </button>
        <div className="px-3 py-3 border-b border-gray-800/80 bg-[#011419]/35 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Globe className="w-4 h-4 text-accent" /><span className="text-sm font-bold text-white tracking-wide">Worldbuild</span>
            <button type="button" onClick={() => manageMode ? leaveManageMode() : setManageMode(true)} className={`ml-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border transition-colors cursor-pointer ${manageMode ? 'bg-accent/20 text-accent border-accent/40' : 'text-gray-400 border-white/10 hover:text-white hover:bg-white/5'}`}>{manageMode ? 'Done' : 'Manage'}</button>
          </div>
          <div className="flex items-center gap-2">
            {proposedCount > 0 && <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-300 bg-amber-400/10 border border-amber-400/30 rounded-full px-2 py-0.5"><Sparkles className="w-3 h-3" />{proposedCount}</span>}
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
            <Button fullWidth icon={Plus} onClick={() => setShowCreate(v => !v)}>Create</Button>
            <Popover anchorRef={createRef} open={showCreate} onClose={() => setShowCreate(false)} className="!bg-[#021a20] backdrop-blur-sm">
              {TYPE_ORDER.map(key => { const t = meta(key); const Icon = t.icon; return (
                <button key={key} onClick={() => startNew(key)} className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-white/5 hover:text-white transition-colors flex items-center gap-2.5 cursor-pointer font-medium rounded-lg">
                  <span className={`w-6 h-6 rounded-md border flex items-center justify-center ${t.medallion}`}><Icon className="w-3.5 h-3.5" /></span>
                  {t.label}
                </button>
              ); })}
            </Popover>
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search the world..." className={`${FIELD} pl-9`} />
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => { setFilterType(null); setReviewFilter(null); }} className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md transition-colors cursor-pointer ${!filterType && !reviewFilter ? 'bg-accent text-[#011419]' : 'bg-white/5 text-gray-400 hover:text-white border border-white/10'}`}>All</button>
            {TYPE_ORDER.map(key => <button key={key} onClick={() => setFilterType(key === filterType ? null : key)} className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md transition-colors cursor-pointer ${filterType === key ? 'bg-accent text-[#011419]' : 'bg-white/5 text-gray-400 hover:text-white border border-white/10'}`}>{meta(key).label}</button>)}
            {proposedCount > 0 && <button onClick={() => setReviewFilter(reviewFilter === 'proposed' ? null : 'proposed')} className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border transition-colors cursor-pointer ${reviewFilter === 'proposed' ? 'bg-amber-400/20 text-amber-200 border-amber-400/40' : 'bg-amber-400/[0.06] text-amber-300/80 border-amber-400/20 hover:bg-amber-400/10'}`}><Sparkles className="w-3 h-3" />Proposed</button>}
            {pendingUpdateCount > 0 && <button onClick={() => setReviewFilter(reviewFilter === 'updates' ? null : 'updates')} className={`inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md border transition-colors cursor-pointer ${reviewFilter === 'updates' ? 'bg-sky-400/20 text-sky-100 border-sky-400/40' : 'bg-sky-400/[0.06] text-sky-300/80 border-sky-400/20 hover:bg-sky-400/10'}`}><ShieldCheck className="w-3 h-3" />AI Updates</button>}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-2 pb-2 space-y-0.5">
          {loading ? <p className="caption text-center py-8">Loading...</p>
            : filtered.length === 0 ? <p className="caption text-center py-8">Nothing here yet.</p>
            : renderSidebarEntities()}
        </div>
        {manageMode && (
          <div className="shrink-0 border-t border-white/10 bg-[#03141d]/95 backdrop-blur-md p-3 space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-gray-200">{selectedIds.size} selected{hiddenSelectedCount ? ` · ${hiddenSelectedCount} hidden` : ''}</span>
              <button type="button" onClick={() => setSelectedIds(new Set())} disabled={!selectedIds.size} className="text-[10px] font-bold uppercase tracking-wider text-gray-500 hover:text-white disabled:opacity-40 cursor-pointer">Clear</button>
            </div>
            <div className="space-y-1.5">
              <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-500">Select entities</span>
              <div className="flex flex-wrap gap-1.5">
              <button type="button" onClick={selectVisibleEntities} disabled={!filtered.length} className="text-[10px] font-semibold px-2 py-1 rounded-md border border-white/10 text-gray-300 hover:bg-white/5 disabled:opacity-40 cursor-pointer">Select visible</button>
              {proposedCount > 0 && <button type="button" onClick={() => selectEntities(entities.filter(entity => entity.status === 'proposed'))} className="text-[10px] font-semibold px-2 py-1 rounded-md border border-amber-400/25 text-amber-300 hover:bg-amber-400/10 cursor-pointer">Proposed</button>}
              {pendingUpdateCount > 0 && <button type="button" onClick={() => selectEntities(entities.filter(entity => entity.status !== 'proposed' && entity.data?._enrichPending))} className="text-[10px] font-semibold px-2 py-1 rounded-md border border-sky-400/25 text-sky-300 hover:bg-sky-400/10 cursor-pointer">AI updates</button>}
              {Object.keys(AI_POLICY).map(policy => {
                const matches = entities.filter(entity => entity.status !== 'proposed' && (entity.data?.aiPolicy || 'review') === policy);
                return <button key={`select-${policy}`} type="button" onClick={() => selectEntities(matches)} disabled={!matches.length} data-tooltip={`Select all entities with the ${AI_POLICY[policy].label} AI policy`} className="text-[10px] font-semibold px-2 py-1 rounded-md border border-white/10 text-gray-400 hover:bg-white/5 hover:text-white disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer">{AI_POLICY[policy].label} ({matches.length})</button>;
              })}
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mr-1">Set AI policy</span>
              {Object.entries(AI_POLICY).map(([policy, config]) => {
                const Icon = config.icon;
                return <button key={policy} type="button" onClick={() => runBulkAction('policy', policy)} disabled={!selectedIds.size || bulkSaving} data-tooltip={config.tip} className="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-1 rounded-md border border-white/10 text-gray-300 hover:bg-white/5 disabled:opacity-40 cursor-pointer"><Icon className="w-3 h-3" />{config.label}</button>;
              })}
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              <button type="button" onClick={() => requestBulkConfirmation('accept-proposed')} disabled={!selectedProposedCount || bulkSaving} className="text-[10px] font-semibold px-2 py-1.5 rounded-md border border-amber-400/25 text-amber-200 hover:bg-amber-400/10 disabled:opacity-40 cursor-pointer">Accept proposals</button>
              <button type="button" onClick={() => requestBulkConfirmation('accept-updates')} disabled={!selectedUpdateCount || bulkSaving} className="text-[10px] font-semibold px-2 py-1.5 rounded-md border border-sky-400/25 text-sky-100 hover:bg-sky-400/10 disabled:opacity-40 cursor-pointer">Accept updates</button>
              <button type="button" onClick={() => requestBulkConfirmation('accept-all')} disabled={(!selectedProposedCount && !selectedUpdateCount) || bulkSaving} className="text-[10px] font-semibold px-2 py-1.5 rounded-md border border-accent/25 text-accent hover:bg-accent/10 disabled:opacity-40 cursor-pointer">Accept both</button>
              <button type="button" onClick={() => requestBulkConfirmation('delete')} disabled={!selectedIds.size || bulkSaving} className="inline-flex items-center justify-center gap-1 text-[10px] font-semibold px-2 py-1.5 rounded-md border border-red-400/25 text-red-300 hover:bg-red-400/10 disabled:opacity-40 cursor-pointer"><Trash2 className="w-3 h-3" />Delete</button>
            </div>
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0 overflow-y-auto custom-scrollbar">
        {!selected ? (
          <div className="h-full flex flex-col items-center justify-center text-center px-8 gap-4">
            <div className="w-16 h-16 rounded-2xl border border-white/10 bg-white/[0.03] flex items-center justify-center"><Globe className="w-8 h-8 text-accent/70" /></div>
            <div>
              <h2 className="text-lg font-bold text-white">Build your world</h2>
              <p className="caption mt-1 max-w-sm">Create characters, locations, factions, items and the rules that bind them. The AI tags your story against this registry so it remembers who's who.</p>
            </div>
          </div>
        ) : (
          <div className="max-w-2xl mx-auto p-6 space-y-4">
            <div className={`rounded-2xl border ${m.ring} bg-[#0a1721]/60 backdrop-blur-md p-5`}>
              {selected.status === 'proposed' && (
                <div className="flex flex-col gap-2 mb-4 bg-amber-400/10 border border-amber-400/30 rounded-xl px-3 py-2.5">
                  <span className="flex items-center gap-2 text-xs font-semibold text-amber-200 min-w-0">
                    <Sparkles className="w-4 h-4 shrink-0" />
                    {selected.data?._imported
                      ? 'Imported from a Worldbuild package. Keep it as a new entity, merge it into an existing one, or dismiss it.'
                      : 'The AI proposed this entity. Keep it, fold it into an existing one, or dismiss it.'}
                  </span>
                  {!selected.data?._imported && Array.isArray(selected.data?.proposalEvidence) && <EvidenceReferences excerpts={selected.data.proposalEvidence.map(item => item.excerpt)} />}
                  {mergePrompt ? (
                    <div className="flex items-center flex-wrap gap-2">
                      <span className="text-xs text-amber-100/90 min-w-0">Merge into “{mergePrompt.name}”. On conflicting details, keep:</span>
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
                <div className="flex items-start gap-4">
                  <span className={`w-14 h-14 rounded-xl border flex items-center justify-center shrink-0 ${m.medallion}`}>{React.createElement(m.icon, { className: 'w-7 h-7' })}</span>
                  {!isNew && selected.status !== 'proposed' && <div className="order-last"><AiPolicyControl value={selected.data?.aiPolicy} onChange={setAiPolicy} /></div>}
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h1 className="text-2xl font-bold text-white truncate">{selected.canonicalName}</h1>
                      <button onClick={() => setEditingSection('__header__')} data-tooltip="Edit name & aliases" className="p-1.5 text-gray-500 hover:text-accent hover:bg-white/5 rounded-md transition-colors cursor-pointer shrink-0"><Pencil className="w-3.5 h-3.5" /></button>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className={`text-[11px] font-bold uppercase tracking-widest ${m.soft}`}>{m.label}</span>
                      {(selected.type === 'Characters' || (selected.type === 'Creatures' && (selected.data.scope || 'individual') !== 'group')) && <StateTag map={STATUS} value={selected.data.status || 'unknown'} />}
                    </div>
                    {showAliases && aliasesArr(selected.aliases).length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2.5">{aliasesArr(selected.aliases).map((a, i) => <Chip key={i}><Tag className="w-2.5 h-2.5" />{a}</Chip>)}</div>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Staged AI enrichment (review policy): per-field accept/reject */}
            {!isNew && selected.status !== 'proposed' && selected.data?._enrichPending && (() => {
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
                <div className="rounded-2xl border border-sky-400/30 bg-sky-400/[0.06] backdrop-blur-md p-4 space-y-3">
                  <div className="flex items-center gap-2">
                    <ShieldCheck className="w-4 h-4 text-sky-300 shrink-0" />
                    <span className="text-xs font-semibold text-sky-100">The AI suggested updates from your story. Accept or reject each change.</span>
                  </div>
                  <div className="space-y-2">
                    {fields.map(f => {
                      const cur = selected.data?.[f];
                      const curStr = cur == null || String(cur).trim() === '' ? '(empty)' : String(cur);
                      return (
                        <div key={f} className="flex items-start gap-3 bg-black/20 border border-white/10 rounded-lg px-3 py-2">
                          <div className="min-w-0 flex-1">
                            <span className="block text-[10px] font-bold uppercase tracking-wider text-gray-400 mb-1">{fieldLabel(f)}</span>
                            <div className="flex items-center flex-wrap gap-2 text-sm">
                              <span className="text-gray-500 line-through">{curStr}</span>
                              <span className="text-gray-500">→</span>
                              <span className="text-sky-100 font-medium">{String(proposalValue(pData[f]))}</span>
                            </div>
                            <EvidenceReferences excerpts={proposalEvidence(pData[f])} support={proposalSupport(pData[f])} />
                          </div>
                          <div className="flex items-center gap-1 shrink-0">
                            <button onClick={() => resolveReview({ fields: [f] }, {})} disabled={saving} data-tooltip="Accept" className="p-1.5 rounded-md text-emerald-300 hover:bg-emerald-400/15 transition-colors cursor-pointer"><Check className="w-3.5 h-3.5" /></button>
                            <button onClick={() => resolveReview({}, { fields: [f] })} disabled={saving} data-tooltip="Reject" className="p-1.5 rounded-md text-gray-400 hover:bg-white/10 transition-colors cursor-pointer"><X className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                      );
                    })}
                    {hasLore && (
                      <div className="bg-black/20 border border-white/10 rounded-lg px-3 py-2">
                        <div className="flex items-center justify-between gap-3 mb-1">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Lore</span>
                          <div className="flex items-center gap-1 shrink-0">
                            <button onClick={() => resolveReview({ lore: true }, {})} disabled={saving} data-tooltip="Accept" className="p-1.5 rounded-md text-emerald-300 hover:bg-emerald-400/15 transition-colors cursor-pointer"><Check className="w-3.5 h-3.5" /></button>
                            <button onClick={() => resolveReview({}, { lore: true })} disabled={saving} data-tooltip="Reject" className="p-1.5 rounded-md text-gray-400 hover:bg-white/10 transition-colors cursor-pointer"><X className="w-3.5 h-3.5" /></button>
                          </div>
                        </div>
                        <p className="text-sm text-sky-100 leading-relaxed whitespace-pre-wrap">{String(proposalValue(pending.lore))}</p>
                        <EvidenceReferences excerpts={proposalEvidence(pending.lore)} support={proposalSupport(pending.lore)} />
                      </div>
                    )}
                    {links.map(l => { const k = linkKey(l); return (
                      <div key={k} className="flex items-center gap-3 bg-black/20 border border-white/10 rounded-lg px-3 py-2">
                        <Link2 className="w-3.5 h-3.5 text-sky-300 shrink-0" />
                        <div className="min-w-0 flex-1 text-sm">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mr-2">{l.relLabel || l.relKey}</span>
                          <span className="text-sky-100 font-medium">{l.targetName}</span>
                          <EvidenceReferences excerpts={proposalEvidence(l)} support={proposalSupport(l)} />
                          {l.label && <span className="text-accent/90"> · {l.label}</span>}
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => resolveReview({ links: [k] }, {})} disabled={saving} data-tooltip="Accept" className="p-1.5 rounded-md text-emerald-300 hover:bg-emerald-400/15 transition-colors cursor-pointer"><Check className="w-3.5 h-3.5" /></button>
                          <button onClick={() => resolveReview({}, { links: [k] })} disabled={saving} data-tooltip="Reject" className="p-1.5 rounded-md text-gray-400 hover:bg-white/10 transition-colors cursor-pointer"><X className="w-3.5 h-3.5" /></button>
                        </div>
                      </div>
                    ); })}
                    {chapters.map(c => (
                      <div key={c.id} className="flex items-center gap-3 bg-black/20 border border-white/10 rounded-lg px-3 py-2">
                        <ScrollText className="w-3.5 h-3.5 text-sky-300 shrink-0" />
                        <div className="min-w-0 flex-1 text-sm">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400 mr-2">Chapter</span>
                          <span className="text-sky-100 font-medium">{c.title || 'Untitled'}</span>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          <button onClick={() => resolveReview({ chapters: [c.id] }, {})} disabled={saving} data-tooltip="Accept" className="p-1.5 rounded-md text-emerald-300 hover:bg-emerald-400/15 transition-colors cursor-pointer"><Check className="w-3.5 h-3.5" /></button>
                          <button onClick={() => resolveReview({}, { chapters: [c.id] })} disabled={saving} data-tooltip="Reject" className="p-1.5 rounded-md text-gray-400 hover:bg-white/10 transition-colors cursor-pointer"><X className="w-3.5 h-3.5" /></button>
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

            {/* Character tab switcher */}
            {selected.type === 'Characters' && !isNew && (
              <div className="flex bg-white/[0.04] p-0.5 rounded-lg border border-white/10 w-fit">
                {['data', 'inventory', 'connections'].map(t => (
                  <button key={t} onClick={() => { setCharTab(t); setEditingSection(null); }} className={`px-3.5 py-1.5 rounded-md text-[10px] font-bold uppercase tracking-wider transition-colors cursor-pointer ${charTab === t ? 'bg-accent text-[#011419]' : 'text-gray-400 hover:text-white'}`}>{t}</button>
                ))}
              </div>
            )}

            {/* Body: create form (all sections in edit) or rendered sheet */}
            {isNew ? (
              <>
                {selected.type !== 'Characters' && sections.filter(s => !s.relational).map(s => (
                  <Section key={s.key} icon={s.icon} title={s.title}>{s.edit}</Section>
                ))}
                {selected.type === 'Characters' && (
                  <Section icon={User} title="Identity">
                    <div className="grid grid-cols-2 gap-3">
                      <Edit label="Age"><LInput placeholder="e.g. 34" value={selected.data.age || ''} onChange={(e) => patchData({ age: e.target.value })} /></Edit>
                      <Edit label="Status"><StateSelect map={STATUS} value={selected.data.status || 'unknown'} onChange={(e) => patchData({ status: e.target.value })} /></Edit>
                    </div>
                    <Hint>Race, inventory and connections unlock once you create the character.</Hint>
                    {loreEdit}
                  </Section>
                )}
                <div className="flex items-center justify-between pt-1">
                  <Button variant="danger" size="sm" icon={Trash2} onClick={() => setSelected(null)}>Discard</Button>
                  <Button icon={Save} loading={saving} onClick={() => persist()}>Create {meta(selected.type).label}</Button>
                </div>
              </>
            ) : (
              <>
                {sections.map(renderSection)}
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

// Read-only chip row for derived/relation lists.
function ChipList({ links, empty }) {
  if (!links || links.length === 0) return <p className="text-sm text-gray-600 italic">{empty}</p>;
  return <div className="flex flex-wrap gap-1.5">{links.map(l => <Chip key={l.linkId}>{l.entity.canonicalName}</Chip>)}</div>;
}

// Invented (non-user) example names, English.
function placeholderName(type) {
  return { System: 'e.g. The Three Laws of Aether', Locations: 'e.g. Thornhall', Items: 'e.g. Stormglass Lantern', Races: 'e.g. Tidewalkers', Factions: 'e.g. The Ember Concord', Characters: 'e.g. Captain Aldric Venn', Creatures: 'e.g. The Gloamwyrm', Events: 'e.g. The Siege of Thornhall' }[type] || 'Name';
}
function placeholderAlias(type) {
  return { System: 'e.g. Assimilation, The Assimilation Protocol', Locations: 'e.g. The Bramble Keep', Items: 'e.g. The Tempest Lamp', Races: 'e.g. Brinekin', Factions: 'e.g. The Concord', Characters: 'e.g. Captain, The Grey Wolf', Creatures: 'e.g. The Bog Serpent', Events: 'e.g. The Long Night' }[type] || '';
}
