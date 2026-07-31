import { useEffect, useMemo, useState } from 'react';
import {
  BookOpenCheck, Brain, Check, Eye, EyeOff, Lightbulb, LockKeyhole,
  Pencil, Plus, Search, Trash2, X,
} from 'lucide-react';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Modal from '../../components/ui/Modal';
import SearchableSelect from '../../components/ui/SearchableSelect';
import type {
  KnowledgeEntryKind, Toast, WorldbuildApi, WorldbuildEntity,
  WorldbuildKnowledgeCard, WorldbuildKnowledgeEntry, WorldbuildKnowledgeProjection,
  WorldbuildKnownRelationship,
} from './worldbuildTypes';
import { meta } from './worldbuildConfig';

const INPUT = 'wb-input w-full rounded-lg border border-white/15 bg-[#06121a]/80 px-3 py-2 text-sm text-gray-100 placeholder-gray-500 focus:border-accent/70 focus:outline-none';
type Surface = 'knowledge' | 'memories';
type MemoryAccessibility = WorldbuildKnowledgeEntry['accessibility'];
const MEMORY_STATES: Record<MemoryAccessibility, {
  label: string; description: string; icon: typeof Eye; tone: string; badge: string;
}> = {
  available: {
    label: 'Available',
    description: 'This memory can be recalled and used normally.',
    icon: Eye,
    tone: 'border-emerald-400/25 bg-emerald-400/[0.06] text-emerald-200',
    badge: 'border-emerald-400/25 bg-emerald-400/10 text-emerald-200',
  },
  suppressed: {
    label: 'Suppressed',
    description: 'The memory exists, but cannot currently be recalled or used.',
    icon: EyeOff,
    tone: 'border-amber-400/25 bg-amber-400/[0.06] text-amber-200',
    badge: 'border-amber-400/25 bg-amber-400/10 text-amber-200',
  },
  inaccessible: {
    label: 'Inaccessible',
    description: 'The memory cannot be recovered, as if destroyed or permanently lost.',
    icon: LockKeyhole,
    tone: 'border-rose-400/25 bg-rose-400/[0.06] text-rose-200',
    badge: 'border-rose-400/25 bg-rose-400/10 text-rose-200',
  },
};
const NATIVE_FIELDS: Record<string, Array<{ key: string; label: string }>> = {
  Characters: [{ key: 'status', label: 'Status' }, { key: 'age', label: 'Age' }, { key: 'appearance', label: 'Appearance' }, { key: 'personality', label: 'Personality' }],
  Creatures: [{ key: 'status', label: 'Status' }, { key: 'disposition', label: 'Disposition' }, { key: 'nature', label: 'Nature' }, { key: 'abundance', label: 'Abundance' }, { key: 'threat', label: 'Threat' }, { key: 'abilities', label: 'Abilities' }, { key: 'appearance', label: 'Appearance' }, { key: 'personality', label: 'Personality' }],
  Locations: [{ key: 'locationType', label: 'Type' }, { key: 'description', label: 'Description' }],
  Items: [{ key: 'itemType', label: 'Type' }, { key: 'abundance', label: 'Abundance' }, { key: 'description', label: 'Description' }],
  Factions: [{ key: 'description', label: 'Description' }],
  Races: [{ key: 'description', label: 'Description' }],
  Events: [{ key: 'kind', label: 'Kind' }, { key: 'description', label: 'Description' }],
  System: [{ key: 'content', label: 'Content' }],
};
const RELATION_LABELS: Record<string, string> = {
  inside: 'Inside',
  led_by: 'Led by',
  member_of: 'Member of',
  operates_in: 'Operates in',
  owned_by: 'Owned by',
  located_in: 'Located in',
  carried_by: 'Carried by',
  created_by: 'Created by',
  found_in: 'Found in',
  sold_in: 'Sold in',
  is_race: 'Race / species',
  connected_to: 'Connected to',
  adjacent_to: 'Adjacent to',
  related_to: 'Related to',
};

interface Props {
  workspaceId: string;
  entity: WorldbuildEntity;
  entities: WorldbuildEntity[];
  api: WorldbuildApi;
  showToast: Toast;
}

export default function WorldbuildKnowledgeTab({ workspaceId, entity, entities, api, showToast }: Props) {
  const [surface, setSurface] = useState<Surface>('knowledge');
  const [projection, setProjection] = useState<WorldbuildKnowledgeProjection | null>(null);
  const [selectedCard, setSelectedCard] = useState<WorldbuildKnowledgeCard | null>(null);
  const [addingCard, setAddingCard] = useState(false);
  const [deletingCard, setDeletingCard] = useState<WorldbuildKnowledgeCard | null>(null);
  const [cardSearch, setCardSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const filteredCards = useMemo(() => {
    const query = normalizeSearch(cardSearch);
    if (!query) return projection?.cards ?? [];
    return (projection?.cards ?? []).filter(card => (
      normalizeSearch(card.targetName).includes(query)
      || normalizeSearch(meta(card.targetType).label).includes(query)
    ));
  }, [cardSearch, projection?.cards]);

  const reload = async () => {
    const result = await api.getWorldbuildSubjectKnowledge(workspaceId, entity.id);
    if (!result.success || !result.projection) throw new Error(result.error || 'Could not load Knowledge.');
    setProjection(result.projection);
    setSelectedCard(current => current
      ? result.projection?.cards.find(card => card.cardId === current.cardId) ?? null
      : null);
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    api.getWorldbuildSubjectKnowledge(workspaceId, entity.id).then(result => {
      if (!active) return;
      if (result.success && result.projection) setProjection(result.projection);
      else showToast(result.error || 'Could not load Knowledge.', 'error');
      setLoading(false);
    });
    return () => { active = false; };
  }, [api, entity.id, showToast, workspaceId]);

  const addCard = async (targetId: string) => {
    const result = await api.ensureWorldbuildAwareness({
      workspaceId, ownerId: entity.id, targetId, sourceType: 'manual', sourceId: crypto.randomUUID(),
      audienceType: entity.type === 'Factions' ? 'all-members' : undefined,
    });
    if (!result.success) throw new Error(result.error || 'Could not create the Knowledge card.');
    await reload();
    setAddingCard(false);
    if (result.card) setSelectedCard(result.card);
  };

  const removeCard = async () => {
    if (!deletingCard) return;
    const result = await api.removeWorldbuildKnowledgeCard({
      workspaceId, ownerId: entity.id, targetId: deletingCard.targetId,
    });
    if (!result.success) {
      showToast(result.error || 'Could not remove the Knowledge card.', 'error');
      return;
    }
    setDeletingCard(null);
    setSelectedCard(null);
    await reload();
    showToast('Knowledge card removed.', 'success');
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-[#0a1721]/60 p-1.5">
        <SurfaceButton active={surface === 'knowledge'} onClick={() => setSurface('knowledge')} icon={BookOpenCheck} label="Knowledge" count={projection?.cards.length ?? 0} />
        <SurfaceButton active={surface === 'memories'} onClick={() => setSurface('memories')} icon={Brain} label="Memories" count={projection?.memories.length ?? 0} />
      </div>

      {surface === 'knowledge' ? (
        <section className="rounded-xl border border-white/10 bg-[#0a1721]/60">
          <header className="flex items-start justify-between border-b border-white/[0.08] px-4 py-3.5">
            <div>
              <h3 className="text-sm font-semibold text-gray-100">Known subjects</h3>
              <p className="mt-1 text-xs text-gray-500">A card means {entity.canonicalName} knows that subject exists. Its contents define what else is known.</p>
            </div>
            <button type="button" onClick={() => setAddingCard(true)} className="rounded-md p-1.5 text-gray-500 hover:bg-white/5 hover:text-accent" aria-label="Add Knowledge card">
              <Plus className="h-4 w-4" />
            </button>
          </header>
          <div className="border-b border-white/[0.08] px-4 py-3">
            <label className="relative block">
              <span className="sr-only">Search known subjects</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-600" aria-hidden="true" />
              <input
                type="search"
                name="knowledge-card-search"
                autoComplete="off"
                value={cardSearch}
                onChange={event => setCardSearch(event.target.value)}
                placeholder="Search known subjects…"
                className="wb-input w-full rounded-lg border border-white/10 bg-[#06121a]/70 py-2 pl-9 pr-9 text-sm text-gray-200 placeholder-gray-600 focus:border-accent/50 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30 [&::-webkit-search-cancel-button]:hidden"
              />
              {cardSearch && (
                <button
                  type="button"
                  onClick={() => setCardSearch('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-gray-600 hover:bg-white/5 hover:text-gray-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  aria-label="Clear Knowledge search"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </label>
          </div>
          <div className="custom-scrollbar max-h-[40rem] space-y-2 overflow-y-auto overscroll-contain p-4">
            {loading && <div className="h-20 animate-pulse rounded-xl bg-white/[0.04]" />}
            {!loading && !projection?.cards.length && <EmptyState text="No known subjects yet." onClick={() => setAddingCard(true)} />}
            {!loading && (projection?.cards.length ?? 0) > 0 && !filteredCards.length && (
              <div className="rounded-xl border border-dashed border-white/10 px-5 py-8 text-center text-sm text-gray-500">
                No known subjects match your search.
              </div>
            )}
            {filteredCards.map(card => {
              const known = projection?.known.filter(entry => entry.aboutId === card.targetId).length ?? 0;
              const beliefs = projection?.beliefs.filter(entry => entry.aboutId === card.targetId).length ?? 0;
              const typeMeta = meta(card.targetType);
              const TypeIcon = typeMeta.icon;
              return (
                <article key={card.cardId} className={`group relative overflow-hidden rounded-xl border bg-[#07151e]/70 transition duration-200 hover:bg-[#0a1b25]/90 focus-within:bg-[#0a1b25]/90 ${typeMeta.ring}`}>
                  <button type="button" onClick={() => setSelectedCard(card)} className="flex min-h-20 w-full items-center gap-3 py-3 pl-3 pr-12 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50">
                    <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border shadow-inner ${typeMeta.medallion}`}>
                      <TypeIcon className="h-5 w-5" aria-hidden="true" />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className={`text-[0.625rem] font-bold uppercase tracking-[0.16em] ${typeMeta.soft}`}>{typeMeta.label}</p>
                      <p className="mt-0.5 truncate text-sm font-semibold text-gray-100">{card.targetName}</p>
                    </div>
                    <div className="grid shrink-0 grid-cols-4 gap-1.5">
                      <CardMetric value={card.knownFieldKeys.length} label="Fields known" />
                      <CardMetric value={card.knownRelationships.length} label="Relations" />
                      <CardMetric value={known} label="Known" />
                      <CardMetric value={beliefs} label="Believed" />
                    </div>
                  </button>
                  <button type="button" onClick={() => setDeletingCard(card)} className="absolute right-2 top-2 rounded-md p-1.5 text-gray-500 opacity-0 transition hover:bg-red-400/10 hover:text-red-300 group-hover:opacity-100 group-focus-within:opacity-100 focus:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-300/60" aria-label={`Remove Knowledge card for ${card.targetName}`}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      ) : (
        <Memories workspaceId={workspaceId} owner={entity} projection={projection} api={api} reload={reload} showToast={showToast} />
      )}

      {addingCard && <AddCardModal owner={entity} entities={entities} existing={projection?.cards ?? []} onClose={() => setAddingCard(false)} onAdd={addCard} />}
      {selectedCard && projection && (
        <KnowledgeCardModal
          workspaceId={workspaceId}
          owner={entity}
          card={selectedCard}
          entity={entities.find(item => item.id === selectedCard.targetId)}
          entities={entities}
          projection={projection}
          api={api}
          reload={reload}
          onClose={() => setSelectedCard(null)}
          showToast={showToast}
        />
      )}
      {deletingCard && (
        <ConfirmDialog
          title="Remove Knowledge card"
          message={`Remove awareness of ${deletingCard.targetName}? Structural sources will remain unchanged and will be recorded as exclusions.`}
          actions={[
            { label: 'Cancel', variant: 'ghost', onClick: () => setDeletingCard(null) },
            { label: 'Remove', variant: 'danger', onClick: removeCard },
          ]}
          onClose={() => setDeletingCard(null)}
        />
      )}
    </div>
  );
}

function KnowledgeCardModal({ workspaceId, owner, card, entity, entities, projection, api, reload, onClose, showToast }: {
  workspaceId: string;
  owner: WorldbuildEntity;
  card: WorldbuildKnowledgeCard;
  entity?: WorldbuildEntity;
  entities: WorldbuildEntity[];
  projection: WorldbuildKnowledgeProjection;
  api: WorldbuildApi;
  reload(): Promise<void>;
  onClose(): void;
  showToast: Toast;
}) {
  const [tab, setTab] = useState<'fields' | 'statements'>('fields');
  const [definitions, setDefinitions] = useState<Array<{ key: string; label: string; aiAccess: string }>>([]);
  const [fieldKeys, setFieldKeys] = useState(card.knownFieldKeys);
  const [relationshipIds, setRelationshipIds] = useState(card.knownRelationships.map(item => item.relationshipId));
  const [draft, setDraft] = useState<{ kind: 'knowledge' | 'belief'; statement: string }>({ kind: 'knowledge', statement: '' });
  const [editing, setEditing] = useState<WorldbuildKnowledgeEntry | null>(null);
  const [deleting, setDeleting] = useState<WorldbuildKnowledgeEntry | null>(null);
  const [saving, setSaving] = useState(false);
  const [audienceType, setAudienceType] = useState(card.audienceType);
  const [selectedMemberIds, setSelectedMemberIds] = useState(card.selectedMemberIds);
  const statements = [
    ...projection.known.filter(entry => entry.aboutId === card.targetId),
    ...projection.beliefs.filter(entry => entry.aboutId === card.targetId),
  ];
  const relationships = mergeRelationships(card.availableRelationships, card.knownRelationships);
  const typeMeta = meta(card.targetType);
  const TypeIcon = typeMeta.icon;

  useEffect(() => {
    if (!entity) return;
    api.listWorldbuildFieldDefinitions(workspaceId, entity.type).then(result => {
      if (!result.success) return;
      const native = (NATIVE_FIELDS[entity.type] ?? []).filter(field => hasFilledValue(entity.data[field.key]));
      const custom = (result.fields ?? [])
        .filter(field => field.aiAccess !== 'hidden' && hasFilledValue(entity.data.customFields?.[field.key]))
        .map(field => ({ ...field, key: `customFields.${field.key}` }));
      setDefinitions([...native.map(field => ({ ...field, aiAccess: 'read-write' })), ...custom]);
    });
  }, [api, entity, workspaceId]);

  const saveFields = async (next: string[]) => {
    setFieldKeys(next);
    const result = await api.setWorldbuildKnownFields({
      workspaceId, ownerId: owner.id, targetId: card.targetId, fieldKeys: next,
    });
    if (!result.success) showToast(result.error || 'Could not update Known Fields.', 'error');
    else await reload();
  };

  const markAll = async () => {
    const result = await api.markWorldbuildCurrentFieldsKnown({ workspaceId, ownerId: owner.id, targetId: card.targetId });
    if (!result.success || !result.card) {
      showToast(result.error || 'Could not mark current fields as known.', 'error');
      return;
    }
    setFieldKeys(result.card.knownFieldKeys);
    await reload();
  };

  const saveRelationships = async (next: string[]) => {
    setRelationshipIds(next);
    const result = await api.setWorldbuildKnownRelationships({
      workspaceId, ownerId: owner.id, targetId: card.targetId, relationshipIds: next,
    });
    if (!result.success) showToast(result.error || 'Could not update Known Relationships.', 'error');
    else await reload();
  };

  const saveStatement = async () => {
    if (!draft.statement.trim()) return;
    setSaving(true);
    const result = await api.saveWorldbuildSubjectEntry({
      workspaceId,
      subjectId: owner.id,
      kind: draft.kind,
      existingId: editing?.id,
      entry: { aboutId: card.targetId, statement: draft.statement.trim(), confidence: 0.75, accessibility: 'available', acquisition: 'reported' },
    });
    setSaving(false);
    if (!result.success) {
      showToast(result.error || 'Could not save the Statement.', 'error');
      return;
    }
    setDraft(current => ({ ...current, statement: '' }));
    setEditing(null);
    await reload();
    showToast(editing ? 'Statement updated.' : 'Statement added.', 'success');
  };

  const startEditing = (entry: WorldbuildKnowledgeEntry) => {
    setEditing(entry);
    setDraft({ kind: entry.kind as 'knowledge' | 'belief', statement: entry.statement || '' });
  };

  const cancelEditing = () => {
    setEditing(null);
    setDraft(current => ({ ...current, statement: '' }));
  };

  const removeStatement = async () => {
    if (!deleting) return;
    const result = await api.deleteWorldbuildSubjectEntry({
      workspaceId, subjectId: owner.id, kind: deleting.kind, entryId: deleting.id,
    });
    if (!result.success) {
      showToast(result.error || 'Could not delete the Statement.', 'error');
      return;
    }
    if (editing?.id === deleting.id) cancelEditing();
    setDeleting(null);
    await reload();
    showToast('Statement deleted.', 'success');
  };

  const saveAudience = async (nextType: 'all-members' | 'selected-members', nextMembers = selectedMemberIds) => {
    setAudienceType(nextType);
    setSelectedMemberIds(nextMembers);
    const result = await api.setWorldbuildKnowledgeAudience({
      workspaceId,
      ownerId: owner.id,
      targetId: card.targetId,
      audienceType: nextType,
      memberIds: nextMembers,
    });
    if (!result.success) showToast(result.error || 'Could not update the faction audience.', 'error');
    else await reload();
  };

  return (
    <>
    <Modal onClose={onClose} size="lg" title={card.targetName} icon={TypeIcon}>
      <div className="border-b border-white/[0.08] bg-gradient-to-b from-white/[0.025] to-transparent px-5 pb-4 pt-5">
        <div className="flex items-center gap-3">
          <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border ${typeMeta.medallion}`}>
            <TypeIcon className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className={`text-[0.6875rem] font-bold uppercase tracking-[0.16em] ${typeMeta.soft}`}>{typeMeta.label}</p>
            <p className="mt-1 text-sm text-gray-400"><span className="text-gray-200">{owner.canonicalName}</span> is aware this subject exists.</p>
          </div>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-1 rounded-xl border border-white/[0.08] bg-black/15 p-1">
          <ModalTab active={tab === 'fields'} onClick={() => setTab('fields')} icon={Check} label="Details" count={fieldKeys.length + relationshipIds.length} />
          <ModalTab active={tab === 'statements'} onClick={() => setTab('statements')} icon={BookOpenCheck} label="Statements" count={statements.length} />
        </div>
      </div>
      <div className="max-h-[62vh] overflow-y-auto p-5 custom-scrollbar">
        {tab === 'fields' ? <div className="space-y-6">
        <section>
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h4 className="text-xs font-bold uppercase tracking-wider text-gray-300">Available details</h4>
              <p className="mt-1 text-xs text-gray-600">Choose which current entity fields this perspective can access.</p>
            </div>
            <Button variant="ghost" onClick={markAll}>Mark all current fields as known</Button>
          </div>
          {!definitions.length && <p className="text-xs text-gray-600">No eligible custom fields are currently filled.</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            {definitions.map(field => {
              const checked = fieldKeys.includes(field.key);
              return (
                <button key={field.key} type="button" onClick={() => saveFields(checked ? fieldKeys.filter(key => key !== field.key) : [...fieldKeys, field.key])}
                  className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm ${checked ? 'border-accent/30 bg-accent/[0.08] text-gray-100' : 'border-white/[0.08] text-gray-500'}`}>
                  <span className={`flex h-4 w-4 items-center justify-center rounded border ${checked ? 'border-accent bg-accent text-[#011419]' : 'border-white/20'}`}>{checked && <Check className="h-3 w-3" />}</span>
                  {field.label}
                </button>
              );
            })}
          </div>
        </section>
        <section>
          <div className="mb-3">
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-300">Relationships</h4>
            <p className="mt-1 text-xs text-gray-600">Choose which current or previously known connections this perspective can access.</p>
          </div>
          {!relationships.length && <p className="text-xs text-gray-600">No eligible relationships are currently available.</p>}
          <div className="grid gap-2">
            {relationships.map(relationship => {
              const checked = relationshipIds.includes(relationship.relationshipId);
              const isCurrent = card.availableRelationships.some(item => item.relationshipId === relationship.relationshipId);
              return (
                <button
                  key={relationship.relationshipId}
                  type="button"
                  onClick={() => saveRelationships(checked
                    ? relationshipIds.filter(id => id !== relationship.relationshipId)
                    : [...relationshipIds, relationship.relationshipId])}
                  className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-left text-sm ${checked ? 'border-accent/30 bg-accent/[0.08] text-gray-100' : 'border-white/[0.08] text-gray-500'}`}
                >
                  <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? 'border-accent bg-accent text-[#011419]' : 'border-white/20'}`}>{checked && <Check className="h-3 w-3" />}</span>
                  <span className="min-w-0">
                    <span className="block">{formatRelationship(relationship)}</span>
                    {!isCurrent && <span className="mt-0.5 block text-xs text-amber-300/70">No longer current in canon</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </section>
        {owner.type === 'Factions' && (
          <section>
            <h4 className="mb-3 text-xs font-bold uppercase tracking-wider text-gray-300">Shared with</h4>
            <select className={INPUT} value={audienceType} onChange={event => saveAudience(event.target.value as 'all-members' | 'selected-members')}>
              <option value="all-members">All members</option>
              <option value="selected-members">Selected members</option>
            </select>
            {audienceType === 'selected-members' && (
              <div className="mt-2">
                <SearchableSelect
                  multiple
                  values={selectedMemberIds}
                  onChange={(memberIds: string[]) => saveAudience('selected-members', memberIds)}
                  options={entities.filter(item => item.type === 'Characters' && item.status !== 'proposed').map(item => ({ id: item.id, label: item.canonicalName, aliases: item.aliases }))}
                  placeholder="Select faction members"
                />
              </div>
            )}
          </section>
        )}
        </div> : <section>
          <div className="mb-4">
            <h4 className="text-xs font-bold uppercase tracking-wider text-gray-300">Subjective statements</h4>
            <p className="mt-1 text-xs text-gray-600">Record facts this subject knows or claims they believe.</p>
          </div>
          <div className="space-y-2">
            {statements.map(entry => (
              <Statement key={entry.id} entry={entry} onEdit={() => startEditing(entry)} onDelete={() => setDeleting(entry)} />
            ))}
            {!statements.length && <p className="text-xs text-gray-600">No Statements recorded.</p>}
          </div>
          <div className="mt-4 rounded-xl border border-white/[0.08] bg-black/15 p-3">
            <div className="mb-3 flex items-center justify-between">
              <p className="text-xs font-semibold text-gray-300">{editing ? 'Edit Statement' : 'New Statement'}</p>
              {editing && <button type="button" onClick={cancelEditing} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-200"><X className="h-3.5 w-3.5" />Cancel</button>}
            </div>
            <div className="mb-2 grid grid-cols-2 gap-1 rounded-lg bg-black/20 p-1">
              {(['knowledge', 'belief'] as const).map(kind => (
                <button key={kind} type="button" disabled={Boolean(editing)} onClick={() => setDraft(current => ({ ...current, kind }))}
                  className={`rounded-md px-2 py-1.5 text-xs font-semibold ${draft.kind === kind ? 'bg-white/10 text-gray-100' : 'text-gray-500'} disabled:cursor-not-allowed disabled:opacity-60`}>
                  {kind === 'knowledge' ? 'Known' : 'Believed'}
                </button>
              ))}
            </div>
            <textarea className={`${INPUT} min-h-24 resize-y`} value={draft.statement} onChange={event => setDraft(current => ({ ...current, statement: event.target.value }))} placeholder="Add a specific statement about this subject" />
            <div className="mt-2 flex justify-end"><Button onClick={saveStatement} loading={saving} disabled={!draft.statement.trim()}>{editing ? 'Save changes' : 'Add Statement'}</Button></div>
          </div>
        </section>
        }
        {card.sources.length > 0 && <p className="text-xs text-gray-600">Sources: {[...new Set(card.sources.map(source => source.sourceType))].join(', ')}</p>}
      </div>
    </Modal>
    {deleting && (
      <ConfirmDialog
        title="Delete Statement"
        message="Delete this Statement? This removes it from the subject's current perspective."
        actions={[
          { label: 'Cancel', variant: 'ghost', onClick: () => setDeleting(null) },
          { label: 'Delete', variant: 'danger', onClick: removeStatement },
        ]}
        onClose={() => setDeleting(null)}
      />
    )}
    </>
  );
}

function mergeRelationships(current: WorldbuildKnownRelationship[], known: WorldbuildKnownRelationship[]) {
  const byId = new Map<string, WorldbuildKnownRelationship>();
  for (const relationship of [...current, ...known]) byId.set(relationship.relationshipId, relationship);
  return [...byId.values()];
}

function formatRelationship(relationship: WorldbuildKnownRelationship) {
  const label = relationship.relationLabel
    || RELATION_LABELS[relationship.relationType]
    || relationship.relationType.replaceAll('_', ' ');
  const role = typeof relationship.metadata.role === 'string' && relationship.metadata.role.trim()
    ? ` (${relationship.metadata.role.trim()})`
    : '';
  return `${relationship.fromName} / ${label}${role} / ${relationship.toName}`;
}

function Memories({ workspaceId, owner, projection, api, reload, showToast }: {
  workspaceId: string; owner: WorldbuildEntity; projection: WorldbuildKnowledgeProjection | null;
  api: WorldbuildApi; reload(): Promise<void>; showToast: Toast;
}) {
  const [draft, setDraft] = useState<{ summary: string; accessibility: MemoryAccessibility }>({
    summary: '', accessibility: 'available',
  });
  const [editing, setEditing] = useState<WorldbuildKnowledgeEntry | null>(null);
  const [deleting, setDeleting] = useState<WorldbuildKnowledgeEntry | null>(null);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    const result = await api.saveWorldbuildSubjectEntry({
      workspaceId,
      subjectId: owner.id,
      kind: 'memory',
      existingId: editing?.id,
      entry: { summary: draft.summary.trim(), accessibility: draft.accessibility },
    });
    setSaving(false);
    if (!result.success) return showToast(result.error || 'Could not save the Memory.', 'error');
    setDraft({ summary: '', accessibility: 'available' });
    setEditing(null);
    await reload();
    showToast(editing ? 'Memory updated.' : 'Memory added.', 'success');
  };

  const startEditing = (entry: WorldbuildKnowledgeEntry) => {
    setEditing(entry);
    setDraft({ summary: entry.summary || '', accessibility: entry.accessibility });
  };

  const cancelEditing = () => {
    setEditing(null);
    setDraft({ summary: '', accessibility: 'available' });
  };

  const remove = async () => {
    if (!deleting) return;
    const result = await api.deleteWorldbuildSubjectEntry({
      workspaceId, subjectId: owner.id, kind: 'memory', entryId: deleting.id,
    });
    if (!result.success) {
      showToast(result.error || 'Could not delete the Memory.', 'error');
      return;
    }
    if (editing?.id === deleting.id) cancelEditing();
    setDeleting(null);
    await reload();
    showToast('Memory deleted.', 'success');
  };

  return (
    <>
    <section className="overflow-hidden rounded-xl border border-white/10 bg-[#0a1721]/60">
      <header className="border-b border-white/[0.08] px-4 py-3.5">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-accent" />
          <h3 className="text-sm font-semibold text-gray-100">Memories</h3>
        </div>
        <p className="mt-1 text-xs text-gray-500">Events and experiences this subject remembers, including memories that cannot be reached.</p>
      </header>

      <div className="border-b border-white/[0.08] bg-black/10 p-4">
        <div className="mb-3 flex items-center justify-between">
          <p className="text-xs font-semibold text-gray-300">{editing ? 'Edit Memory' : 'New Memory'}</p>
          {editing && <button type="button" onClick={cancelEditing} className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-200"><X className="h-3.5 w-3.5" />Cancel</button>}
        </div>
        <div className="grid gap-2 lg:grid-cols-3">
          {(Object.entries(MEMORY_STATES) as Array<[MemoryAccessibility, typeof MEMORY_STATES[MemoryAccessibility]]>).map(([value, state]) => {
            const StateIcon = state.icon;
            const selected = draft.accessibility === value;
            return (
              <button key={value} type="button" onClick={() => setDraft(current => ({ ...current, accessibility: value }))}
                className={`rounded-xl border p-3 text-left transition ${selected ? state.tone : 'border-white/[0.07] bg-black/10 text-gray-500 hover:border-white/15 hover:text-gray-300'}`}>
                <span className="flex items-center gap-2 text-xs font-semibold"><StateIcon className="h-4 w-4" />{state.label}</span>
                <span className="mt-1.5 block text-[0.6875rem] leading-relaxed opacity-70">{state.description}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex items-stretch gap-2">
          <textarea className={`${INPUT} min-h-20 flex-1 resize-y`} value={draft.summary} onChange={event => setDraft(current => ({ ...current, summary: event.target.value }))} placeholder="What does this subject remember?" />
          <Button onClick={save} loading={saving} disabled={!draft.summary.trim()}>{editing ? 'Save' : 'Add'}</Button>
        </div>
      </div>

      <div className="space-y-2 p-4">
        {projection?.memories.map(entry => (
          <Statement key={entry.id} entry={entry} onEdit={() => startEditing(entry)} onDelete={() => setDeleting(entry)} />
        ))}
        {!projection?.memories.length && <div className="rounded-xl border border-dashed border-white/[0.08] px-5 py-8 text-center text-xs text-gray-600">No Memories recorded.</div>}
      </div>
    </section>
    {deleting && (
      <ConfirmDialog
        title="Delete Memory"
        message="Delete this Memory? This removes it from the subject's current perspective."
        actions={[
          { label: 'Cancel', variant: 'ghost', onClick: () => setDeleting(null) },
          { label: 'Delete', variant: 'danger', onClick: remove },
        ]}
        onClose={() => setDeleting(null)}
      />
    )}
    </>
  );
}

function Statement({ entry, onEdit, onDelete }: {
  entry: WorldbuildKnowledgeEntry; onEdit?(): void; onDelete?(): void;
}) {
  const memoryState = entry.kind === 'memory' ? MEMORY_STATES[entry.accessibility] : null;
  const Icon = memoryState?.icon || (entry.kind === 'belief' ? Lightbulb : BookOpenCheck);
  return (
    <article className="group flex gap-3 rounded-xl border border-white/[0.07] bg-[#07151e]/55 px-3.5 py-3 text-sm text-gray-300 transition hover:border-white/[0.13] hover:bg-[#091923]/70">
      <span className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border ${memoryState?.badge || (entry.kind === 'belief' ? 'border-amber-400/20 bg-amber-400/[0.07] text-amber-300' : 'border-accent/20 bg-accent/[0.07] text-accent')}`}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="mb-1.5 flex items-center gap-2">
          <span className="text-[0.6875rem] font-bold uppercase tracking-wider text-gray-500">
            {memoryState?.label || (entry.kind === 'belief' ? 'Believed' : 'Known')}
          </span>
        </div>
        <p className="whitespace-pre-wrap leading-relaxed">{entry.statement || entry.summary}</p>
      </div>
      {(onEdit || onDelete) && (
        <div className="flex shrink-0 items-start gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
          {onEdit && <button type="button" onClick={onEdit} className="rounded-md p-1.5 text-gray-500 hover:bg-white/[0.06] hover:text-gray-200" aria-label="Edit"><Pencil className="h-3.5 w-3.5" /></button>}
          {onDelete && <button type="button" onClick={onDelete} className="rounded-md p-1.5 text-gray-500 hover:bg-red-400/10 hover:text-red-300" aria-label="Delete"><Trash2 className="h-3.5 w-3.5" /></button>}
        </div>
      )}
    </article>
  );
}

function AddCardModal({ owner, entities, existing, onClose, onAdd }: {
  owner: WorldbuildEntity; entities: WorldbuildEntity[]; existing: WorldbuildKnowledgeCard[];
  onClose(): void; onAdd(targetId: string): Promise<void>;
}) {
  const [targetId, setTargetId] = useState('');
  const options = useMemo(() => {
    const known = new Set(existing.map(card => card.targetId));
    return entities.filter(entity => entity.id !== owner.id && entity.status !== 'proposed' && !known.has(entity.id)).map(entity => ({
      id: entity.id, label: entity.canonicalName, aliases: entity.aliases, group: entity.type.replace(/s$/, ''),
    }));
  }, [entities, existing, owner.id]);
  return (
    <Modal onClose={onClose} size="md" title="Add Knowledge card" icon={BookOpenCheck}>
      <div className="space-y-4 p-5">
        <p className="text-sm text-gray-400">Choose a subject whose existence {owner.canonicalName} knows about.</p>
        <SearchableSelect value={targetId} onChange={setTargetId} options={options} placeholder="Search for an entity" />
      </div>
      <footer className="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={() => onAdd(targetId)} disabled={!targetId}>Add card</Button>
      </footer>
    </Modal>
  );
}

function EmptyState({ text, onClick }: { text: string; onClick(): void }) {
  return <button type="button" onClick={onClick} className="col-span-full rounded-xl border border-dashed border-white/10 px-5 py-9 text-sm text-gray-500 hover:border-accent/30 hover:text-gray-300"><Plus className="mx-auto mb-2 h-5 w-5" />{text}</button>;
}

function CardMetric({ value, label }: { value: number; label: string }) {
  return (
    <span className="flex h-12 w-16 flex-col items-center justify-center rounded-lg border border-white/[0.07] bg-black/15 text-center">
      <span className="block text-sm font-semibold leading-none text-gray-200 tabular-nums">{value}</span>
      <span className="mt-1 block text-[0.5625rem] font-semibold uppercase leading-tight tracking-wide text-gray-500">{label}</span>
    </span>
  );
}

function ModalTab({ active, onClick, icon: Icon, label, count }: {
  active: boolean; onClick(): void; icon: typeof Check; label: string; count: number;
}) {
  return (
    <button type="button" onClick={onClick}
      className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-semibold transition ${active ? 'bg-white/[0.09] text-gray-100 shadow-sm' : 'text-gray-500 hover:bg-white/[0.04] hover:text-gray-300'}`}>
      <Icon className="h-3.5 w-3.5" />
      {label}
      <span className={`rounded-full px-1.5 py-0.5 text-[0.625rem] ${active ? 'bg-accent/15 text-accent' : 'bg-white/[0.05] text-gray-600'}`}>{count}</span>
    </button>
  );
}

function SurfaceButton({ active, onClick, icon: Icon, label, count }: { active: boolean; onClick(): void; icon: typeof BookOpenCheck; label: string; count: number }) {
  return <button type="button" onClick={onClick} className={`flex items-center justify-center gap-2 rounded-lg px-3 py-2 text-xs font-bold uppercase tracking-wider ${active ? 'bg-accent text-[#011419]' : 'text-gray-500 hover:bg-white/5 hover:text-gray-200'}`}><Icon className="h-3.5 w-3.5" />{label}{count > 0 && <span className="rounded-full bg-black/15 px-1.5 py-0.5">{count}</span>}</button>;
}

function hasFilledValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false;
  return !Array.isArray(value) || value.length > 0;
}

function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase();
}
