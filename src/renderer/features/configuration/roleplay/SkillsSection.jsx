import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Award, Check, ChevronDown, ChevronRight, ChevronUp, CornerDownRight, MoreHorizontal, Pencil, Plus, Search, Trash2, X } from 'lucide-react';
import Button from '../../../components/ui/Button';
import ConfirmDialog from '../../../components/ui/ConfirmDialog';
import IconButton from '../../../components/ui/IconButton';
import Modal from '../../../components/ui/Modal';
import SearchableSelect from '../../../components/ui/SearchableSelect';
import { Menu, MenuItem, MenuSeparator } from '../../../components/ui/Menu';
import { ConfigSection, FieldLabel, Help, SettingsList, SwitchRow } from '../ConfigParts';
import { Block, CheckRow, PolicyBlock, WhoProgresses } from './ProgressionSection';
import ResizableTextarea from '../../../components/ui/ResizableTextarea';

const NO_PARENT = '__none';
const MAX_RANKS = 12;
const COLLAPSED_SKILLS = 5;

const LEARN_WORDING = {
  label: 'Who learns',
  included: 'Learns',
  everyone: count => `Every character and specific being can learn: ${count} now, and anyone created later. The AI only hears about those in the scene or named in the turn.`,
  chosen: count => `${count > 1 ? `${count} characters learn. ` : ''}Anyone can hold skills you give them by hand. Only who learns gets new skills or ranks from the AI.`,
  noPlayer: 'Choose a player character in Configuration, Scene. They always learn.'
};

/**
 * What characters can be good at, apart from levels: a catalog of skills with optional
 * sub-skills, the world's rank ladder, who the AI may teach, and how far it may go.
 */
export default function SkillsSection({ sectionRef, workspaceId, api, showToast, skills, changes, groups, names, onChanged, embedded = false }) {
  const [config, setConfigState] = useState(skills.config);
  const configRef = useRef(skills.config);
  const setConfig = next => {
    const value = typeof next === 'function' ? next(configRef.current) : next;
    configRef.current = value;
    setConfigState(value);
  };
  const [skillDraft, setSkillDraft] = useState(null);
  const [deleting, setDeleting] = useState(null);
  useEffect(() => setConfig(skills.config), [skills.config]); // eslint-disable-line react-hooks/exhaustive-deps

  const persist = async patch => {
    const result = await api.saveRoleplaySkillSettings(workspaceId, patch);
    if (!result?.success) {
      showToast(result?.error || 'Could not save skills.', 'error');
      setConfig(skills.config);
      return;
    }
    await onChanged();
  };
  const saveConfig = async patch => {
    const next = { ...configRef.current, ...patch };
    setConfig(next);
    await persist({ config: next });
  };
  const commit = () => persist({ config: configRef.current });

  const setMembers = async members => {
    const result = await api.setRoleplaySkillMembers(workspaceId, members);
    if (!result?.success) return showToast(result?.error || 'Could not change who learns.', 'error');
    await onChanged();
  };
  const saveSkill = async draft => {
    const result = await api.saveRoleplaySkill(workspaceId, draft);
    if (!result?.success) return showToast(result?.error || 'Could not save the skill.', 'error');
    setSkillDraft(null);
    await onChanged();
  };
  const removeSkill = async skill => {
    const result = await api.deleteRoleplaySkill(workspaceId, skill.id);
    setDeleting(null);
    if (!result?.success) return showToast(result?.error || 'Could not delete it.', 'error');
    await onChanged();
  };
  const resolve = async (change, decision) => {
    const result = await api.resolveRoleplaySkillChange(workspaceId, change.id, decision);
    if (!result?.success) return showToast(result?.error || 'Could not resolve it.', 'error');
    await onChanged();
  };

  const catalog = skills.catalog || [];
  const confirmed = catalog.filter(skill => skill.status === 'confirmed');
  const proposals = new Map((changes || [])
    .filter(change => change.kind === 'create' && change.status === 'pending')
    .map(change => [change.skillId, change]));

  return (
    <ConfigSection
      id="skills"
      sectionRef={sectionRef}
      embedded={embedded}
      icon={Award}
      title="Skills"
      description="What characters are good at, each at a rank. Separate from levels: a world with no XP can still use them."
    >
      <div className="flex flex-col gap-5">
        <SettingsList>
          <SwitchRow
            label="Use skills in this world"
            description="Characters hold skills at a rank, and the AI can teach them new ones as the story earns it."
            checked={skills.enabled}
            onChange={enabled => persist({ enabled })}
          />
        </SettingsList>

        {skills.enabled && (
          <>
            <Block title={<>Skills{catalog.length > 0 && <span className="ml-1.5 font-normal tabular-nums text-text-subtle">{catalog.length}</span>}</>} aside="A class, a trade or a fighting style: the name and description say what it is.">
              <SkillList
                skills={catalog}
                proposals={proposals}
                names={names}
                onAdd={name => setSkillDraft({ name: name || '', description: '', parentId: null })}
                onEdit={skill => setSkillDraft(skill)}
                onAddSub={skill => setSkillDraft({ name: '', description: '', parentId: skill.id })}
                onDelete={skill => setDeleting(skill)}
                onResolve={resolve}
              />
            </Block>

            <Block title="Ranks" aside="Lowest first. Every skill uses the same ladder.">
              <RankLadder ranks={config.ranks} onSave={ranks => saveConfig({ ranks })} />
            </Block>

            <Block title="Who learns">
              <WhoProgresses progression={skills} groups={groups} names={names} onChange={setMembers} wording={LEARN_WORDING} />
            </Block>

            <Block title="How the AI changes skills">
              <div className="flex flex-col gap-2.5 rounded-card border border-border-subtle bg-surface-inset p-3.5">
                <CheckRow checked={config.aiAssigns} onChange={aiAssigns => saveConfig({ aiAssigns })} label="The AI gives skills from this list" help="When the story shows a character actually learning one: being taught, or practising until it takes." />
                <CheckRow checked={config.aiRaises} onChange={aiRaises => saveConfig({ aiRaises })} label="The AI raises ranks" help="Only for a milestone the scene shows, never for repetition alone. One rank at a time, and it says why." />
                <CheckRow checked={config.aiLowers} onChange={aiLowers => saveConfig({ aiLowers })} label="The AI can also lower ranks" help="For a lasting loss, such as a crippling injury. Off by default." />
                <CheckRow checked={config.aiCreates} onChange={aiCreates => saveConfig({ aiCreates })} label="The AI can propose new skills" help="When the story shows a lasting competence nothing here covers. A new skill always waits for your review before it joins the list." />
                <div className="flex flex-col gap-1.5">
                  <FieldLabel>When skills change</FieldLabel>
                  <ResizableTextarea storageKey="rules-skill-guidance" value={config.guidance} onChange={event => setConfig(current => ({ ...current, guidance: event.target.value }))} onBlur={commit} placeholder="A rank takes a real test: a commission beyond their skill, a duel they should have lost, a master's lesson finished. Master is rare." />
                  <Help>Leave it empty and the AI uses the general rule above.</Help>
                </div>
              </div>
            </Block>

            <PolicyBlock label="How AI changes are applied" help="Covers learning, ranks and new skills. Review shows each one in Narrative State first." value={config.policy} onChange={policy => saveConfig({ policy })} />
          </>
        )}
      </div>

      {skillDraft && <SkillModal initial={skillDraft} parents={confirmed.filter(skill => !skill.parentId && skill.id !== skillDraft.id)} hasChildren={Boolean(skillDraft.id && catalog.some(skill => skill.parentId === skillDraft.id))} onCancel={() => setSkillDraft(null)} onSave={saveSkill} />}
      {deleting && (
        <ConfirmDialog
          tone="danger"
          title={`Delete ${deleting.name}?`}
          message={`Every character loses ${deleting.name}.${catalog.some(skill => skill.parentId === deleting.id) ? ' Its sub-skills stay, as skills of their own.' : ''}`}
          actions={[
            { label: 'Cancel', variant: 'ghost', onClick: () => setDeleting(null) },
            { label: 'Delete', variant: 'danger', autoFocus: true, onClick: () => removeSkill(deleting) }
          ]}
          onClose={() => setDeleting(null)}
        />
      )}
    </ConfigSection>
  );
}

// Marks every place the search term appears, so a match deep in a description is easy to spot.
function Highlight({ text, query }) {
  if (!query || !text) return text || null;
  const lower = text.toLowerCase();
  const parts = [];
  let from = 0;
  let at = lower.indexOf(query);
  while (at !== -1) {
    if (at > from) parts.push(text.slice(from, at));
    parts.push(<mark key={at} className="rounded-sm bg-accent/30 px-0.5 text-text-primary">{text.slice(at, at + query.length)}</mark>);
    from = at + query.length;
    at = lower.indexOf(query, from);
  }
  if (from < text.length) parts.push(text.slice(from));
  return parts;
}

// Skills arrive flat; a sub-skill whose parent is gone is shown as a skill of its own.
function familiesOf(skills) {
  const ids = new Set(skills.map(skill => skill.id));
  const children = new Map();
  const roots = [];
  for (const skill of skills) {
    if (skill.parentId && ids.has(skill.parentId)) children.set(skill.parentId, [...(children.get(skill.parentId) || []), skill]);
    else roots.push(skill);
  }
  return roots.map(skill => ({ skill, children: children.get(skill.id) || [] }));
}

function SkillList({ skills, proposals, names, onAdd, onEdit, onAddSub, onDelete, onResolve }) {
  const [search, setSearch] = useState('');
  const [openIds, setOpenIds] = useState(() => new Set());
  const [showAll, setShowAll] = useState(false);
  // Skills added while the page is open stay in view even when the list is collapsed.
  const [knownIds] = useState(() => new Set(skills.map(skill => skill.id)));
  const listRef = useRef(null);
  const query = search.trim().toLowerCase();
  const families = familiesOf(skills);
  const matches = skill => !query || `${skill.name} ${skill.description || ''}`.toLowerCase().includes(query);
  const toggle = id => setOpenIds(current => {
    const next = new Set(current);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const withChildren = families.filter(family => family.children.length);
  const allOpen = withChildren.length > 0 && withChildren.every(family => openIds.has(family.skill.id));

  let found = 0;
  const shown = families.flatMap(({ skill, children }) => {
    const hit = matches(skill);
    const hitChildren = children.filter(matches);
    if (query && !hit && !hitChildren.length) return [];
    found += (hit ? 1 : 0) + hitChildren.length;
    // A family opens by itself when the search finds a sub-skill or one of them waits for review.
    const pending = children.some(child => child.status === 'proposed');
    const open = openIds.has(skill.id) || (query ? hitChildren.length > 0 : pending);
    const visibleChildren = !open ? [] : query && !openIds.has(skill.id) ? hitChildren : children;
    return [{ skill, children: visibleChildren, count: children.length, open, dim: Boolean(query) && !hit, pending: skill.status === 'proposed' || pending }];
  });

  // Search already narrows the list, so the limit only applies without one. A skill waiting
  // for review is never hidden by it.
  const collapsible = !query && shown.length > COLLAPSED_SKILLS;
  const visible = collapsible && !showAll
    ? shown.filter((family, index) => index < COLLAPSED_SKILLS || family.pending || !knownIds.has(family.skill.id))
    : shown;
  const hiddenCount = shown.filter(family => !visible.includes(family)).reduce((total, family) => total + 1 + family.count, 0);
  const showFewer = () => {
    setShowAll(false);
    requestAnimationFrame(() => listRef.current?.scrollIntoView({ block: 'nearest' }));
  };

  const addButton = <Button variant="ghost" size="sm" icon={Plus} onClick={() => onAdd()}>Add skill</Button>;
  if (!skills.length) {
    return (
      <>
        <p className="rounded-card border border-dashed border-border-subtle px-4 py-5 text-center text-[0.8125rem] text-text-muted">No skills yet.</p>
        <div>{addButton}</div>
      </>
    );
  }
  return (
    <>
      <div className="flex items-center gap-2.5">
        <label className="field-input flex h-9 min-w-0 flex-1 items-center gap-2 px-3 focus-within:border-accent">
          <Search aria-hidden="true" className="h-4 w-4 shrink-0 text-text-subtle" />
          <input
            type="search"
            value={search}
            onChange={event => setSearch(event.target.value)}
            onKeyDown={event => { if (event.key === 'Escape' && search) { event.stopPropagation(); setSearch(''); } }}
            placeholder="Search skills"
            aria-label="Search skills"
            className="min-w-0 flex-1 bg-transparent text-sm text-text-primary placeholder:text-text-subtle focus:outline-none [&::-webkit-search-cancel-button]:hidden"
          />
          {search && <IconButton icon={X} size="sm" label="Clear search" onClick={() => setSearch('')} />}
        </label>
        {query
          ? <span className="shrink-0 text-xs tabular-nums text-text-muted">{found} of {skills.length}</span>
          : withChildren.length > 0 && (
            <Button variant="subtle" size="sm" onClick={() => setOpenIds(allOpen ? new Set() : new Set(withChildren.map(family => family.skill.id)))}>
              {allOpen ? 'Collapse all' : 'Expand all'}
            </Button>
          )}
        {addButton}
      </div>
      {shown.length ? (
        <div ref={listRef} className="divide-y divide-border-subtle overflow-hidden rounded-card border border-border-subtle bg-surface-inset">
          {visible.map(({ skill, children, count, open, dim }) => (
            <div key={skill.id} className="divide-y divide-border-subtle">
              <SkillRow
                skill={skill}
                query={query}
                dim={dim}
                childCount={count}
                open={open}
                onToggle={count ? () => toggle(skill.id) : null}
                proposal={proposals.get(skill.id)}
                proposedFor={names.get(proposals.get(skill.id)?.entityId)}
                onEdit={() => onEdit(skill)}
                onAddSub={skill.status !== 'confirmed' ? null : () => onAddSub(skill)}
                onDelete={() => onDelete(skill)}
                onResolve={onResolve}
              />
              {children.map(child => (
                <SkillRow
                  key={child.id}
                  skill={child}
                  child
                  query={query}
                  proposal={proposals.get(child.id)}
                  proposedFor={names.get(proposals.get(child.id)?.entityId)}
                  onEdit={() => onEdit(child)}
                  onAddSub={null}
                  onDelete={() => onDelete(child)}
                  onResolve={onResolve}
                />
              ))}
            </div>
          ))}
          {collapsible && (
            <button
              type="button"
              aria-expanded={showAll}
              onClick={showAll ? showFewer : () => setShowAll(true)}
              className="flex w-full items-center justify-center gap-1.5 py-2.5 text-xs font-semibold text-text-muted transition-colors hover:bg-tint/[0.04] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
            >
              {showAll ? <ChevronUp aria-hidden="true" className="h-3.5 w-3.5" /> : <ChevronDown aria-hidden="true" className="h-3.5 w-3.5" />}
              {showAll ? 'Show fewer' : `Show ${hiddenCount} more ${hiddenCount === 1 ? 'skill' : 'skills'}`}
            </button>
          )}
        </div>
      ) : (
        <div className="rounded-card border border-dashed border-border-subtle px-4 py-7 text-center">
          <p className="text-sm text-text-secondary">No skill matches “{search.trim()}”.</p>
          <p className="caption mt-1">Search looks in names and descriptions.</p>
          <div className="mt-3 flex justify-center">
            <Button variant="ghost" size="sm" icon={Plus} onClick={() => onAdd(search.trim())}>Add “{search.trim()}”</Button>
          </div>
        </div>
      )}
    </>
  );
}

function SkillRow({ skill, child = false, query = '', dim = false, childCount = 0, open = false, onToggle = null, proposal, proposedFor, onEdit, onAddSub, onDelete, onResolve }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const anchorRef = useRef(null);
  const proposed = skill.status === 'proposed';
  const description = proposed && proposal
    ? [proposedFor ? `For ${proposedFor}.` : '', proposal.reason].filter(Boolean).join(' ') || skill.description || '—'
    : skill.description || '—';
  return (
    <div className={`flex items-center gap-2.5 py-2 pl-2 pr-2 ${proposed ? 'bg-status-warning/[0.04]' : ''}`}>
      {child
        ? <CornerDownRight aria-hidden="true" className="ml-9 mr-1.5 h-3.5 w-3.5 shrink-0 text-text-subtle" />
        : onToggle
          ? <IconButton icon={open ? ChevronDown : ChevronRight} size="sm" label={open ? `Hide the sub-skills of ${skill.name}` : `Show the sub-skills of ${skill.name}`} aria-expanded={open} onClick={onToggle} />
          : <span aria-hidden="true" className="w-8 shrink-0" />}
      <div className={`min-w-0 flex-1 ${dim ? 'opacity-55' : ''}`}>
        <span className="flex items-center gap-2">
          <span className="truncate text-[0.8125rem] font-semibold text-text-secondary"><Highlight text={skill.name} query={query} /></span>
          {childCount > 0 && <span className="shrink-0 rounded-full bg-tint/[0.06] px-2 py-0.5 text-xs font-medium tabular-nums text-text-muted">{childCount} {childCount === 1 ? 'sub-skill' : 'sub-skills'}</span>}
          {proposed && <span className="shrink-0 rounded-full bg-status-warning/12 px-2 py-0.5 text-xs font-semibold text-status-warning">Proposed by the AI</span>}
        </span>
        <span className="block truncate text-xs text-text-muted" data-tooltip={description.length > 90 ? description : undefined}>
          <Highlight text={description} query={query} />
        </span>
      </div>
      {proposed && proposal ? (
        <>
          <Button variant="subtle" size="sm" icon={X} onClick={() => onResolve(proposal, 'rejected')}>Dismiss</Button>
          <Button variant="ghost" size="sm" icon={Check} onClick={() => onResolve(proposal, 'approved')}>Add</Button>
        </>
      ) : (
        <>
          <IconButton ref={anchorRef} icon={MoreHorizontal} size="sm" label={`${skill.name} actions`} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)} />
          <Menu anchorRef={anchorRef} open={menuOpen} onClose={() => setMenuOpen(false)} label={`${skill.name} actions`} className="w-48">
            <MenuItem icon={Pencil} label="Edit" onSelect={() => { setMenuOpen(false); onEdit(); }} />
            {onAddSub && <MenuItem icon={Plus} label="Add sub-skill" onSelect={() => { setMenuOpen(false); onAddSub(); }} />}
            <MenuSeparator />
            <MenuItem icon={Trash2} label="Delete" danger onSelect={() => { setMenuOpen(false); onDelete(); }} />
          </Menu>
        </>
      )}
    </div>
  );
}

// Names are edited in place and saved together when a field is left, so typing never reorders.
function RankLadder({ ranks, onSave }) {
  const [draft, setDraft] = useState(ranks);
  useEffect(() => setDraft(ranks), [ranks]);
  const save = next => {
    const clean = next.map(rank => rank.trim()).filter(Boolean);
    if (clean.length < 2) { setDraft(ranks); return; }
    if (JSON.stringify(clean) !== JSON.stringify(ranks)) onSave(clean);
    else setDraft(ranks);
  };
  const move = (index, step) => {
    const next = [...draft];
    [next[index], next[index + step]] = [next[index + step], next[index]];
    setDraft(next);
    save(next);
  };
  return (
    <>
      <ol className="divide-y divide-border-subtle overflow-hidden rounded-card border border-border-subtle bg-surface-inset">
        {draft.map((rank, index) => (
          <li key={index} className="flex items-center gap-2 py-1.5 pl-3.5 pr-2">
            <span className="w-5 text-xs tabular-nums text-text-subtle">{index + 1}</span>
            <input
              aria-label={`Rank ${index + 1}`}
              className="field-input h-8 min-w-0 flex-1 px-2.5 text-[0.8125rem]"
              value={rank}
              maxLength={40}
              onChange={event => setDraft(current => current.map((item, position) => (position === index ? event.target.value : item)))}
              onBlur={() => save(draft)}
              onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur(); }}
            />
            <IconButton icon={ArrowUp} size="sm" label={`Move ${rank || 'rank'} up`} disabled={index === 0} onClick={() => move(index, -1)} />
            <IconButton icon={ArrowDown} size="sm" label={`Move ${rank || 'rank'} down`} disabled={index === draft.length - 1} onClick={() => move(index, 1)} />
            <IconButton icon={Trash2} size="sm" tone="danger" label={`Remove ${rank || 'rank'}`} disabled={draft.length <= 2} onClick={() => save(draft.filter((_, position) => position !== index))} />
          </li>
        ))}
      </ol>
      <Button variant="ghost" size="sm" icon={Plus} className="self-start" disabled={draft.length >= MAX_RANKS} onClick={() => setDraft(current => [...current, ''])}>Add rank</Button>
      <Help>Removing the top rank moves whoever held it to the new top.</Help>
    </>
  );
}

function SkillModal({ initial, parents, hasChildren, onCancel, onSave }) {
  const [draft, setDraft] = useState(initial);
  const [saving, setSaving] = useState(false);
  const set = patch => setDraft(current => ({ ...current, ...patch }));
  const submit = async event => {
    event.preventDefault();
    setSaving(true);
    try { await onSave({ ...draft, parentId: draft.parentId || null }); } finally { setSaving(false); }
  };
  const parentOptions = [{ id: NO_PARENT, label: 'None, a skill of its own' }, ...parents.map(skill => ({ id: skill.id, label: skill.name }))];
  return (
    <Modal title={initial.id ? `Edit ${initial.name}` : initial.parentId ? 'New sub-skill' : 'New skill'} icon={Award} iconClassName="text-text-secondary" onClose={() => { if (!saving) onCancel(); }} size="md">
      <form onSubmit={submit} className="flex flex-col gap-4 px-6 py-5">
        <label className="flex flex-col gap-1.5">
          <span className="text-[0.8125rem] font-semibold text-text-secondary">Name</span>
          <input autoFocus className="field-input h-10 px-3 text-sm" value={draft.name || ''} onChange={event => set({ name: event.target.value })} placeholder="Blacksmithing" />
        </label>
        {!hasChildren && (
          <div className="flex flex-col gap-1.5">
            <span className="text-[0.8125rem] font-semibold text-text-secondary">Part of</span>
            <SearchableSelect clearable={false} value={draft.parentId || NO_PARENT} onChange={value => set({ parentId: value === NO_PARENT ? null : value })} options={parentOptions} placeholder="None, a skill of its own" ariaLabel="Parent skill" />
            <Help>A sub-skill is a narrower part of another, such as Tempering under Blacksmithing.</Help>
          </div>
        )}
        <label className="flex flex-col gap-1.5">
          <span className="text-[0.8125rem] font-semibold text-text-secondary">What it means to the AI</span>
          <ResizableTextarea storageKey="rules-skill-meaning" value={draft.description || ''} onChange={event => set({ description: event.target.value })} placeholder="Working metal at a forge: tools, blades, armour and repairs." />
        </label>
        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="ghost" disabled={saving} onClick={onCancel}>Cancel</Button>
          <Button type="submit" variant="primary" loading={saving} disabled={!draft.name?.trim()}>{initial.id ? 'Save' : 'Add skill'}</Button>
        </div>
      </form>
    </Modal>
  );
}
