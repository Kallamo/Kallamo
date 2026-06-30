import React, { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import {
  Plus, Search, BookOpen, MapPin, Package, Users, Flag, User,
  Sparkles, Trash2, Save, X, Pencil, Check, Link2, Globe, Tag, ScrollText,
} from 'lucide-react';
import { useApp } from '../context/AppContext';
import Button from './ui/Button';

// Each entity type carries its own personality: a friendly label, an icon, and a
// tonal palette (static classes so Tailwind keeps them) used for its medallion and
// accents. `key` is the stored type, aligned with the tagger's tag categories.
const TYPES = {
  System:     { label: 'System / Concept', icon: BookOpen, medallion: 'bg-slate-400/15 text-slate-200 border-slate-400/30', ring: 'border-slate-400/30', soft: 'text-slate-300' },
  Locations:  { label: 'Location',         icon: MapPin,   medallion: 'bg-emerald-400/15 text-emerald-200 border-emerald-400/30', ring: 'border-emerald-400/25', soft: 'text-emerald-300' },
  Items:      { label: 'Item',             icon: Package,  medallion: 'bg-amber-400/15 text-amber-200 border-amber-400/30', ring: 'border-amber-400/25', soft: 'text-amber-300' },
  Races:      { label: 'Race',             icon: Users,    medallion: 'bg-sky-400/15 text-sky-200 border-sky-400/30', ring: 'border-sky-400/25', soft: 'text-sky-300' },
  Factions:   { label: 'Faction',          icon: Flag,     medallion: 'bg-rose-400/15 text-rose-200 border-rose-400/30', ring: 'border-rose-400/25', soft: 'text-rose-300' },
  Characters: { label: 'Character',        icon: User,     medallion: 'bg-accent/15 text-accent border-accent/30', ring: 'border-accent/25', soft: 'text-accent' },
};
const TYPE_ORDER = ['Characters', 'Locations', 'Factions', 'Items', 'Races', 'System'];
const meta = (t) => TYPES[t] || { label: t, icon: Globe, medallion: 'bg-white/10 text-gray-300 border-white/20', ring: 'border-white/15', soft: 'text-gray-300' };
const ITEM_TYPES = ['Weapon', 'Armor', 'Artifact', 'Resource'];

// Frosted dark inputs: their own dark backing guarantees legible text over BOTH
// light and dark workspace backgrounds, while the blur keeps the background alive.
const FIELD = 'wb-input w-full bg-[#06121a]/75 backdrop-blur-md border border-white/15 text-gray-100 text-sm rounded-lg px-3 py-2 placeholder-gray-400/70 focus:outline-none focus:border-accent/70 focus:bg-[#06121a]/90 transition-colors';
const LInput = (p) => <input {...p} className={`${FIELD} ${p.className || ''}`} />;
const LTextarea = (p) => <textarea {...p} className={`${FIELD} resize-none leading-relaxed custom-scrollbar ${p.className || ''}`} />;
const LSelect = ({ children, ...p }) => <select {...p} className={`${FIELD} cursor-pointer ${p.className || ''}`}>{children}</select>;

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
function SingleRelation({ label, hint, current, options, onSet, disabled }) {
  return (
    <Edit label={label} hint={hint}>
      <LSelect value={current || ''} disabled={disabled} onChange={(e) => onSet(e.target.value || null)}>
        <option value="">{disabled ? 'Save first to link' : 'None'}</option>
        {options.map(o => <option key={o.id} value={o.id}>{o.canonicalName}</option>)}
      </LSelect>
    </Edit>
  );
}
function MultiRelation({ label, hint, links, options, onAdd, onRemove, disabled }) {
  const linked = new Set(links.map(l => l.entity.id));
  const remaining = options.filter(o => !linked.has(o.id));
  return (
    <Edit label={label} hint={hint}>
      <div className="flex flex-wrap gap-1.5 mb-2">
        {links.length === 0 && <span className="caption">{disabled ? 'Save first to link.' : 'None yet.'}</span>}
        {links.map(l => (
          <span key={l.linkId} className="inline-flex items-center gap-1 text-[11px] font-medium text-gray-100 bg-white/[0.08] border border-white/15 rounded-full pl-2.5 pr-1 py-0.5">
            {l.entity.canonicalName}
            <button onClick={() => onRemove(l.linkId)} className="text-gray-400 hover:text-rose-300 cursor-pointer p-0.5"><X className="w-3 h-3" /></button>
          </span>
        ))}
      </div>
      {!disabled && remaining.length > 0 && (
        <LSelect value="" onChange={(e) => { if (e.target.value) onAdd(e.target.value); }}>
          <option value="">+ Add…</option>
          {remaining.map(o => <option key={o.id} value={o.id}>{o.canonicalName}</option>)}
        </LSelect>
      )}
    </Edit>
  );
}

export default function WorldbuildView({ chat, electronAPI }) {
  const { showToast } = useApp();
  const workspaceId = chat?.id;

  const [entities, setEntities] = useState([]);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterType, setFilterType] = useState(null);
  const [selected, setSelected] = useState(null);
  const [rel, setRel] = useState({});
  const [charTab, setCharTab] = useState('data');
  const [editingSection, setEditingSection] = useState(null);
  const [saving, setSaving] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const createRef = useRef(null);

  const isNew = !selected?.id;
  const docTitle = (id) => documents.find(d => d.id === id)?.title;

  const byType = useMemo(() => {
    const m = {}; for (const t of Object.keys(TYPES)) m[t] = [];
    for (const e of entities) (m[e.type] = m[e.type] || []).push(e);
    return m;
  }, [entities]);

  const load = useCallback(async () => {
    if (!workspaceId) return;
    try { const res = await electronAPI.listEntities(workspaceId); setEntities(res?.entities || []); }
    catch { setEntities([]); }
    finally { setLoading(false); }
  }, [workspaceId, electronAPI]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { electronAPI.getWritingTree(workspaceId).then(t => setDocuments(t?.documents || [])).catch(() => setDocuments([])); }, [workspaceId, electronAPI]);
  useEffect(() => {
    const onClick = (e) => { if (createRef.current && !createRef.current.contains(e.target)) setShowCreate(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const loadRelations = useCallback(async (ent) => {
    if (!ent?.id) { setRel({}); return; }
    const from = (r) => electronAPI.getEntityLinks(ent.id, 'from', r).then(x => x?.links || []);
    const to = (r) => electronAPI.getEntityLinks(ent.id, 'to', r).then(x => x?.links || []);
    const n = {};
    if (ent.type === 'Locations') n.inside = (await from('inside'))[0] || null;
    if (ent.type === 'Items') { n.createdBy = (await from('created_by'))[0] || null; n.ownedBy = (await from('owned_by'))[0] || null; n.foundIn = (await from('found_in'))[0] || null; }
    if (ent.type === 'Races') n.members = await to('is_race');
    if (ent.type === 'Factions') { n.operatesIn = await from('operates_in'); n.members = await to('member_of'); }
    if (ent.type === 'Characters') { n.isRace = (await from('is_race'))[0] || null; n.inventory = await to('owned_by'); n.memberOf = await from('member_of'); n.connectedTo = await from('connected_to'); }
    setRel(n);
  }, [electronAPI]);

  const openEntity = async (en) => {
    setEditingSection(null); setCharTab('data');
    setSelected({ id: en.id, type: en.type, canonicalName: en.canonicalName || '', aliases: (en.aliases || []).join(', '), lore: en.lore || '', loreDocumentId: en.loreDocumentId || '', status: en.status || 'confirmed', data: en.data || {} });
    await loadRelations(en);
  };
  const startNew = (type) => { setShowCreate(false); setEditingSection(null); setCharTab('data'); setSelected(draftFor(type)); setRel({}); };
  const patch = (f) => setSelected(p => ({ ...p, ...f }));
  const patchData = (f) => setSelected(p => ({ ...p, data: { ...p.data, ...f } }));
  const aliasesArr = (raw) => raw.split(',').map(s => s.trim()).filter(Boolean);

  const persist = async ({ accept = false } = {}) => {
    if (!selected) return null;
    if (!selected.canonicalName.trim()) { showToast('A name is required.', 'error'); return null; }
    setSaving(true);
    try {
      const payload = { workspaceId, type: selected.type, canonicalName: selected.canonicalName.trim(), aliases: aliasesArr(selected.aliases), lore: selected.lore, loreDocumentId: selected.loreDocumentId || null, data: selected.data || {}, status: accept ? 'confirmed' : selected.status };
      let id = selected.id;
      if (selected.id) { const r = await electronAPI.updateEntity(selected.id, payload); if (!r?.success) throw new Error(r?.error || 'update failed'); patch({ status: payload.status }); }
      else { const r = await electronAPI.createEntity(payload); if (!r?.success) throw new Error(r?.error || 'create failed'); id = r.entity.id; setSelected(s => ({ ...s, id, status: r.entity.status })); }
      await load();
      return id;
    } catch (e) { showToast(`Save failed: ${e.message}`, 'error'); return null; }
    finally { setSaving(false); }
  };

  const saveSection = async () => { const id = await persist(); if (id) setEditingSection(null); };
  const cancelSection = async () => { const cur = entities.find(e => e.id === selected.id); if (cur) await openEntity(cur); setEditingSection(null); };
  const remove = async () => { if (!selected?.id) { setSelected(null); return; } setSaving(true); try { await electronAPI.deleteEntity(selected.id); setSelected(null); await load(); } finally { setSaving(false); } };

  const reloadRel = async () => { await loadRelations({ id: selected.id, type: selected.type }); await load(); };
  const setSingle = async (relType, toId) => { if (!selected?.id) return; await electronAPI.setEntityLink({ workspaceId, fromId: selected.id, relType, toId, single: true }); await reloadRel(); };
  const addMulti = async (relType, toId, fromSelected = true) => { if (!selected?.id) return; await electronAPI.setEntityLink({ workspaceId, fromId: fromSelected ? selected.id : toId, relType, toId: fromSelected ? toId : selected.id, single: false }); await reloadRel(); };
  const addInventory = async (itemId) => { await electronAPI.setEntityLink({ workspaceId, fromId: itemId, relType: 'owned_by', toId: selected.id, single: true }); await reloadRel(); };
  const removeLink = async (linkId) => { await electronAPI.removeEntityLink(linkId); await reloadRel(); };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = entities.filter(en => (!filterType || en.type === filterType) && (!q || [en.canonicalName, ...(en.aliases || [])].join(' ').toLowerCase().includes(q)));
    return list.sort((a, b) => (TYPE_ORDER.indexOf(a.type) - TYPE_ORDER.indexOf(b.type)) || a.canonicalName.localeCompare(b.canonicalName));
  }, [entities, search, filterType]);
  const proposedCount = useMemo(() => entities.filter(e => e.status === 'proposed').length, [entities]);

  const isGear = selected?.type === 'Items' && (selected?.data?.itemType || '') !== 'Resource';
  const unsaved = isNew;

  // Lore editor (prose + Writing Desk file link), reused by several types.
  const loreEdit = (
    <>
      <Edit label="Lore"><LTextarea rows={5} placeholder="History, secrets, texture. Or link a Writing Desk file below." value={selected?.lore || ''} onChange={(e) => patch({ lore: e.target.value })} /></Edit>
      <Edit label="Linked Writing Desk file" hint="Once chapter vectorization ships, RAG will auto-correlate the two.">
        <LSelect value={selected?.loreDocumentId || ''} onChange={(e) => patch({ loreDocumentId: e.target.value })}>
          <option value="">None</option>
          {documents.map(d => <option key={d.id} value={d.id}>{d.title}</option>)}
        </LSelect>
      </Edit>
    </>
  );
  const loreView = (
    <>
      <Prose text={selected?.lore} />
      {selected?.loreDocumentId && docTitle(selected.loreDocumentId) && (
        <div className="flex items-center gap-1.5 text-xs text-accent/90"><ScrollText className="w-3.5 h-3.5" /> {docTitle(selected.loreDocumentId)}</div>
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
        view: <div className="grid grid-cols-2 gap-4"><ViewField label="Type" value={selected.data.locationType} empty="—" /><ViewField label="Inside" value={rel.inside?.entity?.canonicalName} empty="—" /></div>,
        edit: <>
          <Edit label="Type"><LInput placeholder="e.g. continent / kingdom / city / tavern" value={selected.data.locationType || ''} onChange={(e) => patchData({ locationType: e.target.value })} /></Edit>
          <SingleRelation label="Inside another place" hint="Nest this within a larger location." disabled={unsaved} current={rel.inside?.entity?.id} options={byType.Locations.filter(o => o.id !== selected.id)} onSet={(id) => setSingle('inside', id)} />
        </> });
      S.push({ key: 'lore', title: 'Lore', icon: ScrollText, scalar: true, view: loreView, edit: loreEdit });
    }
    if (type === 'Items') {
      S.push({ key: 'details', title: 'Details', icon: Package, scalar: true,
        view: <>
          <div className="grid grid-cols-2 gap-4">
            <ViewField label="Type" value={selected.data.itemType} empty="—" />
            {isGear && <ViewField label="Owner" value={rel.ownedBy?.entity?.canonicalName} empty="Unowned" />}
            {isGear && <ViewField label="Creator" value={rel.createdBy?.entity?.canonicalName} empty="Unknown" />}
            <ViewField label="Where found" value={rel.foundIn?.entity?.canonicalName} empty="—" />
          </div>
          <div className="pt-1"><Prose text={selected.data.description} empty="No description." /></div>
        </>,
        edit: <>
          <Edit label="Item type"><LSelect value={selected.data.itemType || ''} onChange={(e) => patchData({ itemType: e.target.value })}><option value="">Choose…</option>{ITEM_TYPES.map(t => <option key={t} value={t}>{t}{t === 'Resource' ? ' (natural / drops)' : ''}</option>)}</LSelect></Edit>
          {isGear && <SingleRelation label="Creator" hint="Leave blank if unknown." disabled={unsaved} current={rel.createdBy?.entity?.id} options={byType.Characters} onSet={(id) => setSingle('created_by', id)} />}
          {isGear && <SingleRelation label="Owner" hint="Blank = the AI decides." disabled={unsaved} current={rel.ownedBy?.entity?.id} options={byType.Characters} onSet={(id) => setSingle('owned_by', id)} />}
          <SingleRelation label={selected.data.itemType === 'Resource' ? 'Where found (required)' : 'Where found'} hint={selected.data.itemType === 'Resource' ? 'Where this resource is gathered.' : 'Only needed when it has no owner.'} disabled={unsaved} current={rel.foundIn?.entity?.id} options={byType.Locations} onSet={(id) => setSingle('found_in', id)} />
          <Edit label="Description"><LTextarea rows={4} placeholder="What it looks like and does." value={selected.data.description || ''} onChange={(e) => patchData({ description: e.target.value })} /></Edit>
        </> });
      S.push({ key: 'lore', title: 'Lore', icon: ScrollText, scalar: true, view: loreView, edit: loreEdit });
    }
    if (type === 'Races') {
      S.push({ key: 'desc', title: 'Description', icon: Users, scalar: true, view: <Prose text={selected.data.description} />, edit: <Edit label="Description"><LTextarea rows={5} placeholder="Traits, appearance, culture." value={selected.data.description || ''} onChange={(e) => patchData({ description: e.target.value })} /></Edit> });
      S.push({ key: 'lore', title: 'Lore', icon: ScrollText, scalar: true, view: loreView, edit: loreEdit });
      S.push({ key: 'members', title: 'Known members', icon: User, scalar: false, derived: true, view: <ChipList links={rel.members} empty="Auto-filled as you assign this race to characters." />, edit: <ChipList links={rel.members} empty="Auto-filled as you assign this race to characters." /> });
    }
    if (type === 'Factions') {
      S.push({ key: 'overview', title: 'Area of operation', icon: MapPin, scalar: false, view: <ChipList links={rel.operatesIn} empty="No territory set." />, edit: <MultiRelation label="Origin / area of operation" hint="Locations this faction works out of." disabled={unsaved} links={rel.operatesIn || []} options={byType.Locations} onAdd={(id) => addMulti('operates_in', id)} onRemove={removeLink} /> });
      S.push({ key: 'desc', title: 'Description', icon: Flag, scalar: true, view: <Prose text={selected.data.description} />, edit: <Edit label="Description"><LTextarea rows={5} placeholder="Goals, structure, reputation." value={selected.data.description || ''} onChange={(e) => patchData({ description: e.target.value })} /></Edit> });
      S.push({ key: 'lore', title: 'Lore', icon: ScrollText, scalar: true, view: loreView, edit: loreEdit });
      S.push({ key: 'members', title: 'Members', icon: Users, scalar: false, view: <ChipList links={rel.members} empty="No members yet." />, edit: <MultiRelation label="Members" hint="Characters who belong to this faction." disabled={unsaved} links={rel.members || []} options={byType.Characters} onAdd={(id) => addMulti('member_of', id, false)} onRemove={removeLink} /> });
    }
    return S;
  };

  // Character sheet is tabbed; build its sections per active tab.
  const characterSections = () => {
    if (charTab === 'data') return [
      { key: 'identity', title: 'Identity', icon: User, scalar: true,
        view: <div className="grid grid-cols-2 gap-4"><ViewField label="Age" value={selected.data.age} empty="—" /><ViewField label="Race" value={rel.isRace?.entity?.canonicalName} empty="—" /></div>,
        edit: <><Edit label="Age"><LInput placeholder="e.g. 34" value={selected.data.age || ''} onChange={(e) => patchData({ age: e.target.value })} /></Edit><SingleRelation label="Race" disabled={unsaved} current={rel.isRace?.entity?.id} options={byType.Races} onSet={(id) => setSingle('is_race', id)} /></> },
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
    ];
  };

  const sections = selected ? (selected.type === 'Characters' ? characterSections() : sectionsFor(selected.type)) : [];
  const m = selected ? meta(selected.type) : null;
  const nameLabel = selected?.type === 'System' ? 'Title' : 'Name';
  const showAliases = selected?.type !== 'System';

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

  return (
    <div className="flex-1 flex flex-col md:flex-row h-full overflow-hidden bg-[#000508]/40 select-none">
      {/* Sidebar */}
      <div className="w-full md:w-72 shrink-0 flex flex-col h-full overflow-hidden border-r border-gray-800/40 bg-[#011419]/25 backdrop-blur-md">
        <div className="px-3 py-3 border-b border-gray-800/80 bg-[#011419]/35 flex items-center justify-between">
          <div className="flex items-center gap-2"><Globe className="w-4 h-4 text-accent" /><span className="text-sm font-bold text-white tracking-wide">Worldbuild</span></div>
          {proposedCount > 0 && <span className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-300 bg-amber-400/10 border border-amber-400/30 rounded-full px-2 py-0.5"><Sparkles className="w-3 h-3" />{proposedCount}</span>}
        </div>

        <div className="p-3 space-y-3">
          <div className="relative" ref={createRef}>
            <Button fullWidth icon={Plus} onClick={() => setShowCreate(v => !v)}>Create</Button>
            {showCreate && (
              <div className="absolute z-30 mt-1 w-full bg-[#021a20] border border-white/10 rounded-lg shadow-2xl overflow-hidden py-1 backdrop-blur-sm">
                {TYPE_ORDER.map(key => { const t = meta(key); const Icon = t.icon; return (
                  <button key={key} onClick={() => startNew(key)} className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-white/5 hover:text-white transition-colors flex items-center gap-2.5 cursor-pointer font-medium">
                    <span className={`w-6 h-6 rounded-md border flex items-center justify-center ${t.medallion}`}><Icon className="w-3.5 h-3.5" /></span>
                    {t.label}
                  </button>
                ); })}
              </div>
            )}
          </div>

          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-500 pointer-events-none" />
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search the world..." className={`${FIELD} pl-9`} />
          </div>

          <div className="flex flex-wrap gap-1.5">
            <button onClick={() => setFilterType(null)} className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md transition-colors cursor-pointer ${!filterType ? 'bg-accent text-[#011419]' : 'bg-white/5 text-gray-400 hover:text-white border border-white/10'}`}>All</button>
            {TYPE_ORDER.map(key => <button key={key} onClick={() => setFilterType(key === filterType ? null : key)} className={`text-[10px] font-bold uppercase tracking-wider px-2 py-1 rounded-md transition-colors cursor-pointer ${filterType === key ? 'bg-accent text-[#011419]' : 'bg-white/5 text-gray-400 hover:text-white border border-white/10'}`}>{meta(key).label}</button>)}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto custom-scrollbar px-2 pb-2 space-y-0.5">
          {loading ? <p className="caption text-center py-8">Loading...</p>
            : filtered.length === 0 ? <p className="caption text-center py-8">Nothing here yet.</p>
            : filtered.map(en => { const t = meta(en.type); const Icon = t.icon; const active = selected?.id === en.id; return (
              <button key={en.id} onClick={() => openEntity(en)} className={`w-full text-left px-2.5 py-2 rounded-lg flex items-center gap-2.5 transition-colors cursor-pointer group ${active ? 'bg-accent/15' : 'hover:bg-white/5'}`}>
                <span className={`w-7 h-7 rounded-md border flex items-center justify-center shrink-0 ${t.medallion}`}><Icon className="w-3.5 h-3.5" /></span>
                <span className={`flex-1 min-w-0 truncate text-sm font-medium ${active ? 'text-accent' : 'text-gray-200'}`}>{en.canonicalName}</span>
                {en.status === 'proposed' && <Sparkles className="w-3.5 h-3.5 text-amber-300 shrink-0" data-tooltip="AI proposal — needs accept" />}
              </button>
            ); })}
        </div>
      </div>

      {/* Detail */}
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
            {/* Header band */}
            <div className={`rounded-2xl border ${m.ring} bg-[#0a1721]/60 backdrop-blur-md p-5`}>
              {selected.status === 'proposed' && (
                <div className="flex items-center justify-between gap-3 mb-4 bg-amber-400/10 border border-amber-400/30 rounded-xl px-3 py-2">
                  <span className="flex items-center gap-2 text-xs font-semibold text-amber-200 min-w-0"><Sparkles className="w-4 h-4 shrink-0" /> AI proposal — accept to keep it.</span>
                  <Button size="sm" loading={saving} onClick={() => persist({ accept: true })}>Accept</Button>
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
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <h1 className="text-2xl font-bold text-white truncate">{selected.canonicalName}</h1>
                      <button onClick={() => setEditingSection('__header__')} data-tooltip="Edit name & aliases" className="p-1.5 text-gray-500 hover:text-accent hover:bg-white/5 rounded-md transition-colors cursor-pointer shrink-0"><Pencil className="w-3.5 h-3.5" /></button>
                    </div>
                    <div className={`text-[11px] font-bold uppercase tracking-widest mt-0.5 ${m.soft}`}>{m.label}</div>
                    {showAliases && aliasesArr(selected.aliases).length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mt-2.5">{aliasesArr(selected.aliases).map((a, i) => <Chip key={i}><Tag className="w-2.5 h-2.5" />{a}</Chip>)}</div>
                    )}
                  </div>
                </div>
              )}
            </div>

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
                {selected.type !== 'Characters' && sections.map(s => (
                  <Section key={s.key} icon={s.icon} title={s.title}>{s.edit}</Section>
                ))}
                {selected.type === 'Characters' && (
                  <Section icon={User} title="Identity">
                    <Edit label="Age"><LInput placeholder="e.g. 34" value={selected.data.age || ''} onChange={(e) => patchData({ age: e.target.value })} /></Edit>
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
                  <Button variant="danger" size="sm" icon={Trash2} loading={saving} onClick={remove}>Delete</Button>
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
  return { System: 'e.g. The Three Laws of Aether', Locations: 'e.g. Thornhall', Items: 'e.g. Stormglass Lantern', Races: 'e.g. Tidewalkers', Factions: 'e.g. The Ember Concord', Characters: 'e.g. Captain Aldric Venn' }[type] || 'Name';
}
function placeholderAlias(type) {
  return { Locations: 'e.g. The Bramble Keep', Items: 'e.g. The Tempest Lamp', Races: 'e.g. Brinekin', Factions: 'e.g. The Concord', Characters: 'e.g. Captain, The Grey Wolf' }[type] || '';
}
