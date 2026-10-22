import { useCallback, useEffect, useRef, useState } from 'react';
import { Award, Check, CornerDownRight, Pencil, Plus, Trash2 } from 'lucide-react';
import Button from '../../components/ui/Button';
import IconButton from '../../components/ui/IconButton';
import SearchableSelect from '../../components/ui/SearchableSelect';
import { describeSkillChange, skillChangeItems } from '../roleplay/changeKinds';
import { FieldEye, SpoilerCover } from './Spoilers';

/**
 * A character's skills, drawn as a sheet section while the world uses skills. Edit gives,
 * moves or takes away a skill at once; what the AI wants to change waits here to be approved.
 */
export default function WorldbuildEntitySkills({ workspaceId, entity, api, showToast }) {
  const [state, setState] = useState(null);
  const [catalog, setCatalog] = useState([]);
  const [ranks, setRanks] = useState([]);
  const [pending, setPending] = useState([]);
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const requestRef = useRef(0);

  const load = useCallback(async () => {
    const request = ++requestRef.current;
    const [result, config] = await Promise.all([
      api.getRoleplayEntitySkills?.(workspaceId, entity.id),
      api.getRoleplayConfiguration?.(workspaceId)
    ]);
    if (request !== requestRef.current) return;
    setState(result?.success ? result.skills : null);
    setCatalog((config?.skills?.catalog || []).filter(skill => skill.status === 'confirmed'));
    setRanks(config?.skills?.config?.ranks || []);
    setPending(skillChangeItems(config).filter(change => change.entityId === entity.id && change.status === 'pending'));
  }, [api, entity.id, workspaceId]);

  useEffect(() => { setEditing(false); setAdding(false); load(); }, [load]);
  useEffect(() => {
    const refresh = event => { if (!event.detail?.workspaceId || event.detail.workspaceId === workspaceId) load(); };
    window.addEventListener('roleplay-state-change', refresh);
    const unsubscribe = api.onRoleplayResourceChanges?.(payload => { if (payload?.workspaceId === workspaceId) load(); });
    return () => { window.removeEventListener('roleplay-state-change', refresh); unsubscribe?.(); };
  }, [api, load, workspaceId]);

  if (!state?.enabled) return null;
  const held = state.skills;
  if (!held.length && !pending.length && !catalog.length) return null;

  const announce = () => window.dispatchEvent(new CustomEvent('roleplay-state-change', { detail: { workspaceId } }));
  const setRank = async (skillId, rank) => {
    const result = await api.setRoleplayEntitySkill(workspaceId, entity.id, skillId, rank);
    if (!result?.success) return showToast(result?.error || 'Could not change the skill.', 'error');
    setState(result.skills);
    announce();
  };
  const resolve = async (change, decision) => {
    const result = await api.resolveRoleplaySkillChange(workspaceId, change.id, decision);
    if (!result?.success) return showToast(result?.error || 'Could not resolve the change.', 'error');
    await load();
    announce();
  };

  const heldIds = new Set(held.map(skill => skill.skillId));
  const nameOf = new Map(catalog.map(skill => [skill.id, skill.name]));
  const addOptions = catalog.map(skill => ({
    id: skill.id,
    label: skill.parentId ? `${nameOf.get(skill.parentId) || ''} › ${skill.name}` : skill.name,
    ...(heldIds.has(skill.id) ? { disabled: true, disabledLabel: 'Has it' } : {})
  }));
  const rankOptions = ranks.map((rank, index) => ({ id: String(index), label: rank }));
  const headerButton = 'inline-flex h-7 shrink-0 items-center gap-1 rounded-md px-2 text-xs font-semibold text-text-muted transition-colors hover:bg-surface-hover/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40';

  return (
    <section className="ws-card overflow-hidden rounded-card border border-border-default bg-surface-panel-muted/60 backdrop-blur-md">
      <header className="flex min-h-11 items-center gap-2.5 border-b border-border-subtle pl-4 pr-2">
        <Award className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
        <h2 className="text-sm font-semibold text-text-primary">Skills</h2>
        {editing && <span className="text-xs text-text-subtle">Editing</span>}
        <span className="flex-1" />
        {editing
          ? <button type="button" onClick={() => { setEditing(false); setAdding(false); }} className={headerButton}><Check className="h-3.5 w-3.5" aria-hidden="true" />Done</button>
          : <button type="button" onClick={() => setEditing(true)} aria-label="Edit Skills" className={headerButton}>{held.length ? <Pencil className="h-3.5 w-3.5" aria-hidden="true" /> : <Plus className="h-3.5 w-3.5" aria-hidden="true" />}{held.length ? 'Edit' : 'Add'}</button>}
      </header>

      <div className="flex flex-col gap-3 p-4">
        {held.length > 0 ? (
          <div className="divide-y divide-border-subtle overflow-hidden rounded-card border border-border-subtle bg-surface-canvas/40">
            {held.map(skill => (
              <SpoilerCover key={skill.skillId} field={`skill:${skill.key}`} className="m-1.5">
              <div className={`flex min-h-11 items-center gap-3 py-1.5 pr-2 ${skill.parentId ? 'pl-8' : 'pl-3.5'}`}>
                {skill.parentId && <CornerDownRight aria-hidden="true" className="-ml-4 h-3.5 w-3.5 shrink-0 text-text-subtle" />}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[0.8125rem] font-semibold text-text-secondary">{skill.name}</span>
                  {skill.description && <span className="block truncate text-xs text-text-subtle" data-tooltip={skill.description.length > 80 ? skill.description : undefined}>{skill.description}</span>}
                </span>
                {editing ? (
                  <>
                    <FieldEye field={`skill:${skill.key}`} />
                    <SearchableSelect className="w-40" clearable={false} value={String(skill.rank)} onChange={value => setRank(skill.skillId, Number(value))} options={rankOptions} ariaLabel={`${skill.name} rank`} />
                    <IconButton icon={Trash2} size="sm" tone="danger" label={`Remove ${skill.name}`} onClick={() => setRank(skill.skillId, null)} />
                  </>
                ) : (
                  <span className="shrink-0 rounded-full bg-tint/[0.06] px-2.5 py-0.5 text-xs font-semibold text-text-primary">{skill.rankName}</span>
                )}
              </div>
              </SpoilerCover>
            ))}
          </div>
        ) : !editing && (
          <p className="text-sm text-text-disabled">{state.learns ? 'No skills yet. The AI can teach them as the story earns it.' : 'No skills yet.'}</p>
        )}

        {editing && (adding ? (
          <SearchableSelect
            className="w-80 max-w-full"
            value=""
            onChange={skillId => { setAdding(false); if (skillId) setRank(skillId, 0); }}
            onClose={() => setAdding(false)}
            options={addOptions}
            placeholder="Add a skill"
            searchPlaceholder="Search skills"
            ariaLabel="Add a skill"
            searchInTrigger
            autoOpen
          />
        ) : (
          <Button variant="ghost" size="sm" icon={Plus} className="self-start" disabled={!catalog.length} onClick={() => setAdding(true)}>Add a skill</Button>
        ))}
        {editing && !catalog.length && <p className="caption">Create skills first, in Worldbuild, Rules, Skills.</p>}

        {!editing && pending.length > 0 && (
          <div className="flex flex-col gap-2">
            {pending.map(change => (
              <div key={change.id} className="flex flex-wrap items-center gap-3 rounded-control border border-status-warning/25 bg-status-warning/[0.04] px-3.5 py-3">
                <div className="min-w-0 flex-1">
                  <span className="block text-[0.8125rem] font-semibold text-text-primary">{describeSkillChange(change, entity.canonicalName)}</span>
                  {change.reason && <span className="block text-xs leading-relaxed text-text-muted">{change.reason}</span>}
                </div>
                <Button variant="subtle" size="sm" onClick={() => resolve(change, 'rejected')}>Reject</Button>
                <Button variant="ghost" size="sm" icon={Check} onClick={() => resolve(change, 'approved')}>Approve</Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
