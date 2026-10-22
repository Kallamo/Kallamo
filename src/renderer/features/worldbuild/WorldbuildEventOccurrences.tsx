import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Activity, Brain, Check, ChevronDown, MoreHorizontal, Pencil, Plus, Trash2, Users, X, Backpack, Waypoints } from 'lucide-react';
import Menu, { MenuItem, MenuSeparator } from '../../components/ui/Menu';
import IconButton from '../../components/ui/IconButton';
import NumberInput from '../../components/ui/NumberInput';
import SelectMenuBase from '../../components/ui/SelectMenu';
import { AiGlyph, ConnectionsGlyph, StopwatchIcon } from '../../components/ui/glyphs';
import Button from '../../components/ui/Button';
import Checkbox from '../../components/ui/Checkbox';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import FieldBase from '../../components/ui/Field';
import Modal from '../../components/ui/Modal';
import SearchableSelectBase from '../../components/ui/SearchableSelect';
import TextareaBase from '../../components/ui/Textarea';
import TextInputBase from '../../components/ui/TextInput';
import { entityMeta } from './worldbuildConfig';
import WorldDateInput, { formatWorldDate } from './WorldDateInput';
import RelationshipSlider from './RelationshipSlider';
import type {
  Toast,
  WorldbuildApi,
  WorldbuildEntity,
  WorldbuildEventOccurrence,
  WorldbuildEventOccurrenceParticipant,
} from './worldbuildTypes';

const INPUT = 'min-h-10 w-full rounded-control border border-border-default bg-surface-input px-3 py-2 text-sm text-text-secondary outline-none transition-colors placeholder:text-text-subtle focus:border-accent/60 focus:ring-2 focus:ring-accent/20';
const Field = FieldBase as unknown as React.ComponentType<Record<string, unknown>>;
const SearchableSelect = SearchableSelectBase as unknown as React.ComponentType<Record<string, unknown>>;
const Textarea = TextareaBase as unknown as React.ComponentType<Record<string, unknown>>;
const TextInput = TextInputBase as unknown as React.ComponentType<Record<string, unknown>>;
const SelectMenu = SelectMenuBase as unknown as React.ComponentType<Record<string, unknown>>;

interface RoleplayDefinition {
  id: string;
  name: string;
  key: string;
  minimum: number;
  maximum: number;
  appliesTo: string[];
}

interface EditorState {
  occurrenceId: string | null;
  title: string;
  summary: string;
  startDate: Record<string, unknown> | null;
  endDate: Record<string, unknown> | null;
  participantIds: string[];
  participants: Record<string, WorldbuildEventOccurrenceParticipant>;
  locationIds: string[];
  relatedEntityIds: string[];
  resourceChanges: Array<{ definitionId: string; entityId: string; value: number }>;
  inventoryChanges: Array<Record<string, unknown>>;
  relationshipChanges: Array<{
    sourceEntityId: string;
    targetEntityId: string;
    dimension: string;
    value: number;
    description: string;
  }>;
}

export default function WorldbuildEventOccurrences({
  workspaceId,
  eventEntity,
  entities,
  calendar,
  api,
  showToast,
}: {
  workspaceId: string;
  eventEntity: WorldbuildEntity;
  entities: WorldbuildEntity[];
  calendar: Record<string, unknown> | null;
  api: WorldbuildApi & { getRoleplayConfiguration?(workspaceId: string): Promise<Record<string, unknown>> };
  showToast: Toast;
}) {
  const [occurrences, setOccurrences] = useState<WorldbuildEventOccurrence[]>([]);
  const [definitions, setDefinitions] = useState<RoleplayDefinition[]>([]);
  const [factionMembers, setFactionMembers] = useState<Map<string, string[]>>(new Map());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [editor, setEditor] = useState<EditorState | null>(null);
  const [deleting, setDeleting] = useState<WorldbuildEventOccurrence | null>(null);
  const [deletingBusy, setDeletingBusy] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const loadRequestRef = useRef(0);
  const scopeKey = `${workspaceId}:${eventEntity.id}`;
  const scopeKeyRef = useRef(scopeKey);
  scopeKeyRef.current = scopeKey;
  const advancedDetailsId = useId();
  const names = useMemo(() => new Map(entities.map(entity => [entity.id, entity.canonicalName])), [entities]);
  const entityById = useMemo(() => new Map(entities.map(entity => [entity.id, entity])), [entities]);
  const confirmed = useMemo(() => entities.filter(entity => entity.status !== 'proposed' && entity.id !== eventEntity.id), [entities, eventEntity.id]);
  const actors = useMemo(() => confirmed.filter(canOwnMemory), [confirmed]);
  const locations = useMemo(() => confirmed.filter(entity => entity.type === 'Locations'), [confirmed]);
  const items = useMemo(() => confirmed.filter(entity => entity.type === 'Items'), [confirmed]);
  const relationSubjects = useMemo(() => confirmed.filter(entity => entity.type === 'Characters' || entity.type === 'Factions' || (entity.type === 'Creatures' && String(entity.data?.scope ?? 'individual') !== 'group')), [confirmed]);
  const inventoryHolders = useMemo(() => relationSubjects.filter(entity => entity.type !== 'Factions'), [relationSubjects]);

  const load = async () => {
    const requestId = ++loadRequestRef.current;
    setLoading(true);
    try {
      const [result, configuration, membershipResult] = await Promise.all([
        api.listWorldbuildEventOccurrences(workspaceId, eventEntity.id),
        api.getRoleplayConfiguration?.(workspaceId) ?? Promise.resolve(null),
        api.listEntityLinks(workspaceId, 'member_of'),
      ]);
      if (requestId !== loadRequestRef.current) return;
      if (!result.success) throw new Error(result.error || 'Could not load event occurrences.');
      if (configuration && !configuration.success) throw new Error(String(configuration.error || 'Could not load Roleplay state definitions.'));
      if (!membershipResult.success) throw new Error(membershipResult.error || 'Could not load faction memberships.');
      setOccurrences(result.occurrences || []);
      setDefinitions(Array.isArray(configuration?.definitions) ? configuration.definitions as RoleplayDefinition[] : []);
      const members = new Map<string, string[]>();
      for (const link of membershipResult.links || []) {
        members.set(link.toId, [...(members.get(link.toId) || []), link.fromId]);
      }
      setFactionMembers(members);
    } catch (error) {
      if (requestId !== loadRequestRef.current) return;
      showToast(error instanceof Error ? error.message : 'Could not load event occurrences.', 'error');
    } finally {
      if (requestId === loadRequestRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    setEditor(null);
    setDeleting(null);
    setSaving(false);
    setDeletingBusy(false);
    setShowDetails(false);
    setOccurrences([]);
    setDefinitions([]);
    setFactionMembers(new Map());
    void load();
    return () => { loadRequestRef.current += 1; };
  }, [workspaceId, eventEntity.id]);

  const startAdd = () => {
    setShowDetails(false);
    setEditor({
      occurrenceId: null,
      title: '',
      summary: '',
      startDate: null,
      endDate: null,
      participantIds: [],
      participants: {},
      locationIds: [],
      relatedEntityIds: [],
      resourceChanges: [],
      inventoryChanges: [],
      relationshipChanges: [],
    });
  };

  const startEdit = (occurrence: WorldbuildEventOccurrence) => {
    if (occurrence.source !== 'user') return;
    const participants = Object.fromEntries(occurrence.participants.map(participant => [
      participant.entityId,
      { ...participant, selectedMemberIds: [...participant.selectedMemberIds] },
    ]));
    setShowDetails(false);
    setEditor({
      occurrenceId: occurrence.id,
      title: occurrence.title,
      summary: occurrence.summary,
      startDate: occurrence.startDate,
      endDate: occurrence.endDate,
      participantIds: occurrence.participants.map(participant => participant.entityId),
      participants,
      locationIds: [...occurrence.locationIds],
      relatedEntityIds: [...occurrence.relatedEntityIds],
      resourceChanges: consequenceArray<EditorState['resourceChanges'][number]>(occurrence.consequences.resources),
      inventoryChanges: consequenceArray<Record<string, unknown>>(occurrence.consequences.inventory),
      relationshipChanges: consequenceArray<EditorState['relationshipChanges'][number]>(occurrence.consequences.relationships),
    });
  };

  const setParticipantIds = (participantIds: string[]) => {
    if (!editor) return;
    const participants = { ...editor.participants };
    for (const id of participantIds) {
      if (!participants[id]) participants[id] = defaultParticipant(id);
    }
    for (const id of Object.keys(participants)) {
      if (!participantIds.includes(id)) delete participants[id];
    }
    setEditor({ ...editor, participantIds, participants });
  };

  const patchParticipant = (entityId: string, patch: Partial<WorldbuildEventOccurrenceParticipant>) => {
    if (!editor) return;
    setEditor({
      ...editor,
      participants: {
        ...editor.participants,
        [entityId]: { ...editor.participants[entityId], ...patch },
      },
    });
  };

  const save = async () => {
    if (!editor) return;
    const operationScope = scopeKey;
    const eligibleParticipantIds = new Set(actors.map(entity => entity.id));
    const eligibleLocationIds = new Set(locations.map(entity => entity.id));
    const eligibleRelatedIds = new Set(confirmed.map(entity => entity.id));
    const unavailableReferenceIds = uniqueIds([
      ...editor.participantIds.filter(id => !eligibleParticipantIds.has(id)),
      ...editor.locationIds.filter(id => !eligibleLocationIds.has(id)),
      ...editor.relatedEntityIds.filter(id => !eligibleRelatedIds.has(id)),
      ...editor.participantIds.flatMap(id => {
        const participant = editor.participants[id];
        if (participant?.audienceType !== 'selected-members') return [];
        const eligibleMembers = new Set((factionMembers.get(id) || []).filter(memberId => {
          const member = entityById.get(memberId);
          return Boolean(member && canJoinFaction(member) && eligibleRelatedIds.has(memberId));
        }));
        return participant.selectedMemberIds.filter(memberId => !eligibleMembers.has(memberId));
      }),
    ]);
    if (unavailableReferenceIds.length) {
      setShowDetails(true);
      showToast('Remove unavailable historical references before saving this occurrence.', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        workspaceId,
        title: editor.title.trim(),
        summary: editor.summary.trim(),
        startDate: editor.startDate,
        endDate: editor.endDate,
        participants: editor.participantIds.map(id => editor.participants[id]),
        locationIds: editor.locationIds,
        relatedEntityIds: editor.relatedEntityIds,
      };
      const result = editor.occurrenceId
        ? await api.updateWorldbuildEventOccurrence({ ...payload, eventEntityId: eventEntity.id, occurrenceId: editor.occurrenceId })
        : await api.createWorldbuildEventOccurrence({
          ...payload,
          eventEntityId: eventEntity.id,
          resourceChanges: editor.resourceChanges.filter(change => change.definitionId && change.entityId && Number.isFinite(change.value)),
          inventoryChanges: editor.inventoryChanges.filter(change => String(change.itemId || '').trim()),
          relationshipChanges: editor.relationshipChanges.filter(change => change.sourceEntityId && change.targetEntityId && change.sourceEntityId !== change.targetEntityId && change.dimension.trim()),
        });
      if (operationScope !== scopeKeyRef.current) return;
      if (!result.success) throw new Error(result.error || 'Could not save the occurrence.');
      const updated = Boolean(editor.occurrenceId);
      setEditor(null);
      await load();
      showToast(updated ? 'Event occurrence updated.' : 'Event occurrence recorded.', 'success');
    } catch (error) {
      if (operationScope !== scopeKeyRef.current) return;
      showToast(error instanceof Error ? error.message : 'Could not save the occurrence.', 'error');
    } finally {
      if (operationScope === scopeKeyRef.current) setSaving(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    const operationScope = scopeKey;
    setDeletingBusy(true);
    try {
      const result = await api.deleteWorldbuildEventOccurrence(workspaceId, eventEntity.id, deleting.id);
      if (operationScope !== scopeKeyRef.current) return;
      if (!result.success) throw new Error(result.error || 'Could not delete the occurrence.');
      setDeleting(null);
      await load();
      showToast('Event occurrence deleted.', 'success');
    } catch (error) {
      if (operationScope !== scopeKeyRef.current) return;
      showToast(error instanceof Error ? error.message : 'Could not delete the occurrence.', 'error');
    } finally {
      if (operationScope === scopeKeyRef.current) setDeletingBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="ws-card overflow-hidden rounded-card border border-border-default bg-surface-panel-muted/60 backdrop-blur-md">
        <header className="flex min-h-11 items-center gap-2.5 border-b border-border-subtle pl-4 pr-2">
          <StopwatchIcon className="h-4 w-4 shrink-0 text-text-muted" />
          <h2 className="text-sm font-semibold text-text-primary">Occurrences</h2>
          {occurrences.length > 0 && <span className="text-xs tabular-nums text-text-subtle">{occurrences.length}</span>}
          <span className="flex-1" />
          <Button size="sm" icon={Plus} onClick={startAdd} className="whitespace-nowrap">Record occurrence</Button>
        </header>

        <div className="divide-y divide-border-subtle px-4">
          {loading && <><div className="my-4 h-24 animate-pulse rounded-card bg-surface-hover/40" /></>}
          {!loading && !occurrences.length && (
            <button type="button" onClick={startAdd} className="my-4 flex w-full flex-col items-center rounded-card border border-dashed border-border-subtle px-6 py-10 text-center transition-colors hover:border-border-strong hover:bg-surface-hover/30">
              <StopwatchIcon className="mb-2 h-5 w-5 text-text-disabled" />
              <span className="text-sm font-semibold text-text-secondary">Record the first occurrence</span>
              <span className="mt-1 max-w-md text-xs leading-relaxed text-text-subtle">Each edition remains connected to this event while keeping its own date, participants, memories, and consequences.</span>
            </button>
          )}
          {[...occurrences].reverse().map(occurrence => (
            <OccurrenceCard
              key={occurrence.id}
              occurrence={occurrence}
              names={names}
              calendar={calendar}
              onEdit={() => startEdit(occurrence)}
              onDelete={() => setDeleting(occurrence)}
            />
          ))}
        </div>
      </section>

      {editor && (() => {
        const eventMeta = entityMeta(eventEntity);
        const EventIcon = eventMeta.icon;
        return (
        <Modal onClose={() => setEditor(null)} size="2xl" title={editor.occurrenceId ? 'Edit occurrence' : 'Record occurrence'} subtitle={eventEntity.canonicalName}
          leading={<span className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-control border ${eventMeta.medallion}`}><EventIcon className="h-4 w-4" aria-hidden="true" /></span>}
          closeOnOverlay={!saving} closeOnEsc={!saving}>
          <div className="max-h-[76vh] space-y-5 overflow-y-auto overscroll-contain p-5 custom-scrollbar">
            <div className="space-y-4">
              <TextInput
                autoFocus
                required
                label="Title"
                hint="The edition name or year, when it tells this one apart."
                value={editor.title}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => setEditor({ ...editor, title: event.target.value })}
                placeholder={`e.g. ${eventEntity.canonicalName}, Year 327`}
              />
              <Textarea
                required
                label="What happened"
                className="min-h-28"
                value={editor.summary}
                onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setEditor({ ...editor, summary: event.target.value })}
                placeholder="What happened in this edition, and why it matters."
              />
            </div>

            <EditorRegion title="When and where" description="">
              <div className="space-y-4">
                {calendar && (
                  <div className={`grid gap-3 ${editor.startDate ? '' : 'sm:grid-cols-2'}`}>
                    <Field label="Starts">
                      <WorldDateInput label="Starts" emptyLabel="Set date" calendar={calendar} value={editor.startDate} onChange={(startDate: Record<string, unknown> | null) => setEditor({ ...editor, startDate, endDate: startDate ? editor.endDate : null })} />
                    </Field>
                    <Field label="Ends" hint="Only for occurrences that span days.">
                      <WorldDateInput label="Ends" emptyLabel={editor.startDate ? 'Add end date' : 'Set a start date first'} seedValue={editor.startDate} disabled={!editor.startDate} calendar={calendar} value={editor.endDate} onChange={(endDate: Record<string, unknown> | null) => setEditor({ ...editor, endDate })} />
                    </Field>
                  </div>
                )}
                <Field label="Where" optional>
                  <SearchableSelect ariaLabel="Occurrence locations" multiple values={editor.locationIds} onChange={(locationIds: string[]) => setEditor({ ...editor, locationIds })} options={optionsWithHistorical(locations, editor.locationIds, entityById)} placeholder="Add places" />
                </Field>
              </div>
            </EditorRegion>

            <EditorRegion title="Who took part" description="">
              <div className="space-y-3">
                <Field hint="Each participant keeps a memory of it unless you turn that off.">
                  <SearchableSelect ariaLabel="Occurrence participants" multiple values={editor.participantIds} onChange={setParticipantIds} options={optionsWithHistorical(actors, editor.participantIds, entityById)} placeholder="Add participants" />
                </Field>
                {editor.participantIds.length > 0 && (
                  <div className="divide-y divide-border-subtle border-y border-border-subtle">
                    {editor.participantIds.map(id => {
                      const participant = editor.participants[id];
                      const entity = entityById.get(id);
                      const isFaction = entity?.type === 'Factions';
                      const participantMeta = entity ? entityMeta(entity) : null;
                      const ParticipantIcon = participantMeta?.icon;
                      return (
                        <div key={id} className="py-2.5">
                          <div className="flex flex-wrap items-center gap-3">
                            {participantMeta && ParticipantIcon && <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-control border ${participantMeta.medallion}`}><ParticipantIcon className="h-4 w-4" aria-hidden="true" /></span>}
                            <div className="min-w-0 flex-1">
                              <p className="truncate text-sm font-semibold text-text-primary">{entity?.canonicalName || 'Participant'}</p>
                              <input aria-label={`${entity?.canonicalName || 'Participant'} role`} className="w-full bg-transparent text-xs text-text-muted placeholder:text-text-disabled focus:text-text-primary focus:outline-none" value={participant.role} onChange={event => patchParticipant(id, { role: event.target.value })} placeholder={isFaction && participant.remember ? (participant.audienceType === 'all-members' ? 'Shared with all members' : 'Shared with some members') : 'Role in this occurrence'} />
                            </div>
                            <Checkbox checked={participant.remember} onChange={remember => patchParticipant(id, { remember })} label="Remembers it" />
                            {participant.remember && (
                              <div className="w-40">
                                <SelectMenu ariaLabel={`${entity?.canonicalName || 'Participant'} memory access`} value={participant.memoryAccessibility} onChange={(memoryAccessibility: WorldbuildEventOccurrenceParticipant['memoryAccessibility']) => patchParticipant(id, { memoryAccessibility })}
                                  options={[{ value: 'available', label: 'Available' }, { value: 'suppressed', label: 'Suppressed' }, { value: 'inaccessible', label: 'Inaccessible' }]} />
                              </div>
                            )}
                          </div>
                          {isFaction && participant.remember && (
                            <div className="mt-2.5 grid gap-2 pl-11 sm:grid-cols-2">
                              <SelectMenu ariaLabel={`${entity?.canonicalName || 'Faction'} memory audience`} value={participant.audienceType} onChange={(audienceType: WorldbuildEventOccurrenceParticipant['audienceType']) => patchParticipant(id, { audienceType, selectedMemberIds: [] })}
                                options={[{ value: 'all-members', label: 'Shared with every member' }, { value: 'selected-members', label: 'Shared with some members' }]} />
                              {participant.audienceType === 'selected-members' && <SearchableSelect ariaLabel={`Members of ${entity?.canonicalName || 'faction'}`} multiple values={participant.selectedMemberIds} onChange={(selectedMemberIds: string[]) => patchParticipant(id, { selectedMemberIds })} options={optionsWithHistorical(confirmed.filter(candidate => canJoinFaction(candidate) && (factionMembers.get(id) || []).includes(candidate.id)), participant.selectedMemberIds, entityById)} placeholder="Choose members" />}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
                <Field label="Also involved" hint="Items, places or anyone else tied to it, without a memory." optional>
                  <SearchableSelect ariaLabel="Other entities related to this occurrence" multiple values={editor.relatedEntityIds} onChange={(relatedEntityIds: string[]) => setEditor({ ...editor, relatedEntityIds })} options={optionsWithHistorical(confirmed, editor.relatedEntityIds, entityById)} placeholder="Add entities" />
                </Field>
              </div>
            </EditorRegion>

            <EditorRegion title="What it changed" description={editor.occurrenceId ? 'Changes applied when it was recorded stay as they were.' : 'Optional. State, inventory and relationships change when you record it.'}>
              {editor.occurrenceId ? (
                <ImmutableConsequences editor={editor} />
              ) : (
                <ChangesEditor editor={editor} setEditor={setEditor} definitions={definitions} entities={confirmed} items={items} actors={inventoryHolders} locations={locations} subjects={relationSubjects} />
              )}
            </EditorRegion>
          </div>
          <footer className="flex items-center gap-3 border-t border-border-subtle px-5 py-4">
            <p className="caption min-w-0 flex-1">{editor.occurrenceId ? 'Editing now changes memories only.' : 'After recording, only its memories can be changed.'}</p>
            <Button variant="ghost" onClick={() => setEditor(null)} disabled={saving}>Cancel</Button>
            <Button onClick={save} loading={saving} disabled={!editor.title.trim() || !editor.summary.trim()}>{editor.occurrenceId ? 'Save changes' : 'Record occurrence'}</Button>
          </footer>
        </Modal>
        );
      })()}

      {deleting && (
        <ConfirmDialog
          tone="danger"
          title="Delete event occurrence"
          message={<>Delete <strong className="text-text-primary">"{deleting.title}"</strong> from this event history? The occurrence, its fact, and its memories will leave active narrative context. Previously applied resource values, inventory placements, and canonical relationship changes will not be rolled back.</>}
          actions={[
            { label: 'Cancel', variant: 'ghost', onClick: () => { if (!deletingBusy) setDeleting(null); } },
            { label: 'Delete occurrence', variant: 'danger', loading: deletingBusy, autoFocus: true, onClick: remove },
          ]}
          onClose={() => { if (!deletingBusy) setDeleting(null); }}
        />
      )}
    </div>
  );
}

function EditorRegion({ title, description, children }: { title: string; description: string; children: React.ReactNode }) {
  return (
    <section className="border-t border-border-subtle pt-4 first:border-t-0 first:pt-0">
      <header className="mb-3.5">
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        {description && <p className="caption mt-0.5">{description}</p>}
      </header>
      {children}
    </section>
  );
}

function OccurrenceCard({ occurrence, names, calendar, onEdit, onDelete }: {
  occurrence: WorldbuildEventOccurrence;
  names: Map<string, string>;
  calendar: Record<string, unknown> | null;
  onEdit(): void;
  onDelete(): void;
}) {
  const [expanded, setExpanded] = useState(false);
  const detailsId = useId();
  const consequenceCount = countConsequences(occurrence.consequences);
  const isManual = occurrence.source === 'user';
  return (
    <article className="py-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <h3 className="text-[0.9375rem] font-semibold text-text-primary">{occurrence.title}</h3>
            {occurrence.startDate && calendar && <span className="text-xs text-text-subtle">{formatWorldDate(calendar, occurrence.startDate)}{occurrence.endDate ? ` to ${formatWorldDate(calendar, occurrence.endDate)}` : ''}</span>}
            {occurrence.status !== 'approved' && <span className={`text-xs font-medium ${occurrence.status === 'proposed' ? 'text-entity-event' : 'text-status-danger'}`}>{occurrence.status === 'proposed' ? 'Proposed' : 'Rejected'}</span>}
          </div>
          <p className={`mt-2 whitespace-pre-wrap text-sm leading-relaxed text-text-secondary ${expanded ? '' : 'line-clamp-2'}`}>{occurrence.summary}</p>
          {expanded && <div id={detailsId} className="mt-3 flex flex-wrap gap-1.5 border-t border-border-subtle pt-3">
            {occurrence.participants.map(participant => <span key={participant.entityId} className="rounded-full border border-border-subtle bg-surface-hover/40 px-2 py-0.5 text-xs text-text-muted">{names.get(participant.entityId) || 'Unknown'} · {participant.role}</span>)}
            {occurrence.locationIds.map(id => <span key={id} className="inline-flex items-center gap-1.5 rounded-full border border-border-subtle bg-surface-hover/40 px-2 py-0.5 text-xs text-text-muted"><span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-entity-location" />{names.get(id) || 'Unknown location'}</span>)}
            {occurrence.relatedEntityIds.map(id => <span key={`related:${id}`} className="rounded-full border border-border-subtle bg-surface-hover/40 px-2 py-0.5 text-xs text-text-muted">{names.get(id) || 'Unknown entity'}</span>)}
          </div>}
          <div className="mt-2.5 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-text-muted">
            <span className="inline-flex items-center gap-1.5"><Users className="h-3.5 w-3.5" aria-hidden="true" />{occurrence.participants.length} {occurrence.participants.length === 1 ? 'participant' : 'participants'}</span>
            <span className="inline-flex items-center gap-1.5"><Brain className="h-3.5 w-3.5" aria-hidden="true" />{occurrence.participants.filter(participant => participant.remember).length} {occurrence.participants.filter(participant => participant.remember).length === 1 ? 'memory' : 'memories'}</span>
            {consequenceCount > 0 && <span className="inline-flex items-center gap-1.5"><Activity className="h-3.5 w-3.5" aria-hidden="true" />{consequenceCount} {consequenceCount === 1 ? 'consequence' : 'consequences'}</span>}
            <span className="inline-flex items-center gap-1.5">{occurrence.source === 'narrative-state' ? <><AiGlyph className="h-3.5 w-3.5 text-entity-event" />From the narrative state</> : <><Pencil className="h-3 w-3" aria-hidden="true" />Added by you</>}</span>
            <span className="flex-1" />
            <button type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-controls={detailsId} className="inline-flex min-h-7 items-center gap-1 rounded-md px-2 text-xs font-semibold text-text-secondary transition-colors hover:bg-surface-hover/40 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
              {expanded ? 'Less' : 'Details'}
              <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`} />
            </button>
          </div>
        </div>
        {isManual && <OccurrenceActions onEdit={onEdit} onDelete={onDelete} />}
      </div>
    </article>
  );
}

function OccurrenceActions({ onEdit, onDelete }: { onEdit(): void; onDelete(): void }) {
  const anchorRef = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return <>
    <IconButton ref={anchorRef} icon={MoreHorizontal} size="sm" label="Occurrence actions" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(value => !value)} />
    <Menu anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} label="Occurrence actions" className="w-48">
      <MenuItem icon={Pencil} label="Edit" onSelect={() => { setOpen(false); onEdit(); }} />
      <MenuSeparator />
      <MenuItem icon={Trash2} label="Delete occurrence" danger onSelect={() => { setOpen(false); onDelete(); }} />
    </Menu>
  </>;
}

function ImmutableConsequences({ editor }: { editor: EditorState }) {
  const summary = consequenceSummary({
    resources: editor.resourceChanges,
    inventory: editor.inventoryChanges,
    relationships: editor.relationshipChanges,
  });
  return (
    <section className="rounded-card border border-border-subtle bg-surface-hover/25 p-3.5">
      <div className="flex items-start gap-3">
        <Activity className="mt-0.5 h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-text-primary">Already applied</h4>
          <p className="caption mt-0.5">Editing now changes memories only. State, inventory and relationship effects stay as they were.</p>
          {summary.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{summary.map(item => <span key={item.label} className="rounded-control border border-border-subtle px-2 py-1 text-xs text-text-muted">{item.count} {item.label}</span>)}</div>}
        </div>
      </div>
    </section>
  );
}

type ChangeKind = 'resource' | 'inventory' | 'relationship';
const CHANGE_KEYS = { resource: 'resourceChanges', inventory: 'inventoryChanges', relationship: 'relationshipChanges' } as const;

// What the occurrence changed, read as sentences. One change is edited at a time, in place,
// and joins the list as a sentence once it is added.
function ChangesEditor({ editor, setEditor, definitions, entities, items, actors, locations, subjects }: {
  editor: EditorState; setEditor(value: EditorState): void; definitions: RoleplayDefinition[];
  entities: WorldbuildEntity[]; items: WorldbuildEntity[]; actors: WorldbuildEntity[]; locations: WorldbuildEntity[]; subjects: WorldbuildEntity[];
}) {
  const [open, setOpen] = useState<{ kind: ChangeKind; index: number; fresh: boolean } | null>(null);
  const nameOf = (id?: string | null) => (id && entities.find(entity => entity.id === id)?.canonicalName) || '';
  const listOf = (kind: ChangeKind) => editor[CHANGE_KEYS[kind]] as unknown[];
  const add = (kind: ChangeKind) => {
    const blank = kind === 'resource' ? { definitionId: '', entityId: '', value: 0 }
      : kind === 'inventory' ? { itemId: '', fromHolderId: '', toHolderId: '', locationId: '', quantity: 1 }
      : { sourceEntityId: '', targetEntityId: '', dimension: 'overall', value: 0, description: '' };
    setEditor({ ...editor, [CHANGE_KEYS[kind]]: [...listOf(kind), blank] });
    setOpen({ kind, index: listOf(kind).length, fresh: true });
  };
  const removeAt = (kind: ChangeKind, index: number) => setEditor({ ...editor, [CHANGE_KEYS[kind]]: listOf(kind).filter((_, itemIndex) => itemIndex !== index) });
  const cancel = () => { if (open?.fresh) removeAt(open.kind, open.index); setOpen(null); };
  const signed = (value: number) => `${value > 0 ? '+' : ''}${value}`;
  const sentences: Array<{ key: string; kind: ChangeKind; index: number; text: string }> = [
    ...editor.resourceChanges.map((change, index) => ({ key: `r${index}`, kind: 'resource' as const, index,
      text: `${nameOf(change.entityId) || 'Someone'} · ${definitions.find(definition => definition.id === change.definitionId)?.name || 'state'} becomes ${change.value}` })),
    ...editor.inventoryChanges.map((change, index) => ({ key: `i${index}`, kind: 'inventory' as const, index,
      text: `${nameOf(String(change.itemId || '')) || 'An item'}${Number(change.quantity) > 1 ? ` ×${change.quantity}` : ''}${change.fromHolderId ? ` from ${nameOf(String(change.fromHolderId))}` : ''} to ${nameOf(String(change.toHolderId || change.locationId || '')) || 'nowhere yet'}` })),
    ...editor.relationshipChanges.map((change, index) => ({ key: `l${index}`, kind: 'relationship' as const, index,
      text: `${nameOf(change.sourceEntityId) || 'Someone'} → ${nameOf(change.targetEntityId) || 'someone'} · ${change.dimension || 'overall'} ${signed(Number(change.value) || 0)}${change.description ? ` · ${change.description}` : ''}` })),
  ].filter(entry => !(open && open.kind === entry.kind && open.index === entry.index));

  return <div className="space-y-2">
    {sentences.length > 0 && <div className="divide-y divide-border-subtle rounded-control border border-border-subtle">{sentences.map(entry => (
      <div key={entry.key} className="flex items-center gap-2 px-3 py-2 text-sm text-text-secondary">
        {entry.kind === 'resource' ? <Activity className="h-3.5 w-3.5 shrink-0 text-text-subtle" aria-hidden="true" /> : entry.kind === 'inventory' ? <Backpack className="h-3.5 w-3.5 shrink-0 text-text-subtle" aria-hidden="true" /> : <ConnectionsGlyph className="h-3.5 w-3.5 shrink-0 text-text-subtle" aria-hidden="true" />}
        <button type="button" onClick={() => setOpen({ kind: entry.kind, index: entry.index, fresh: false })} className="min-w-0 flex-1 truncate rounded text-left hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">{entry.text}</button>
        <button type="button" onClick={() => removeAt(entry.kind, entry.index)} aria-label="Remove change" data-tooltip="Remove" className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-subtle hover:bg-status-danger/10 hover:text-status-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"><X className="h-3.5 w-3.5" /></button>
      </div>
    ))}</div>}
    {open ? (
      <div className="rounded-card border border-accent/35 bg-surface-panel-muted/70 p-4">
        <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-text-primary">
          {open.kind === 'resource' ? <Activity className="h-4 w-4 text-text-muted" aria-hidden="true" /> : open.kind === 'inventory' ? <Backpack className="h-4 w-4 text-text-muted" aria-hidden="true" /> : <ConnectionsGlyph className="h-4 w-4 text-text-muted" aria-hidden="true" />}
          {open.fresh ? 'New' : 'Edit'} {open.kind === 'resource' ? 'state change' : open.kind === 'inventory' ? 'inventory change' : 'relationship change'}
        </p>
        {open.kind === 'resource' && <ResourceChangeFields editor={editor} setEditor={setEditor} index={open.index} definitions={definitions} entities={entities} />}
        {open.kind === 'inventory' && <InventoryChangeFields editor={editor} setEditor={setEditor} index={open.index} items={items} actors={actors} locations={locations} />}
        {open.kind === 'relationship' && <RelationshipChangeFields editor={editor} setEditor={setEditor} index={open.index} subjects={subjects} />}
        <div className="mt-3 flex justify-end gap-2">
          <Button variant="subtle" size="sm" onClick={cancel}>Cancel</Button>
          <Button variant="ghost" size="sm" icon={Check} onClick={() => setOpen(null)}>{open.fresh ? 'Add change' : 'Done'}</Button>
        </div>
      </div>
    ) : (
      <div className="flex flex-wrap gap-1.5">
        <Button variant="ghost" size="sm" icon={Activity} onClick={() => add('resource')}>State</Button>
        <Button variant="ghost" size="sm" icon={Backpack} onClick={() => add('inventory')}>Inventory</Button>
        <Button variant="ghost" size="sm" icon={ConnectionsGlyph} onClick={() => add('relationship')}>Relationship</Button>
      </div>
    )}
  </div>;
}

function ResourceChangeFields({ editor, setEditor, index, definitions, entities }: { editor: EditorState; setEditor(value: EditorState): void; index: number; definitions: RoleplayDefinition[]; entities: WorldbuildEntity[] }) {
  const change = editor.resourceChanges[index];
  if (!change) return null;
  const entityType = entities.find(entity => entity.id === change.entityId)?.type;
  const availableDefinitions = entityType ? definitions.filter(definition => definition.appliesTo.includes(entityType)) : definitions;
  const put = (patch: Partial<typeof change>) => replaceAt(editor.resourceChanges, index, { ...change, ...patch }, resourceChanges => setEditor({ ...editor, resourceChanges }));
  return <div className="grid gap-3 sm:grid-cols-3">
    <ConsequenceField label="Who"><SearchableSelect ariaLabel="State consequence subject" value={change.entityId} onChange={(entityId: string) => put({ entityId, definitionId: '' })} options={options(entities)} placeholder="Choose entity…" searchPlaceholder="Filter entities…" /></ConsequenceField>
    <ConsequenceField label="State"><SearchableSelect ariaLabel="State consequence definition" value={change.definitionId} onChange={(definitionId: string) => put({ definitionId })} options={availableDefinitions.map(definition => ({ id: definition.id, label: definition.name, group: definition.appliesTo.join(', ') }))} placeholder="Choose state…" searchPlaceholder="Filter states…" /></ConsequenceField>
    <ConsequenceField label="Becomes"><NumberInput className={INPUT} integer={false} value={Number(change.value)} onChange={value => put({ value: value ?? undefined })} aria-label="Resulting state value" /></ConsequenceField>
  </div>;
}

function InventoryChangeFields({ editor, setEditor, index, items, actors, locations }: { editor: EditorState; setEditor(value: EditorState): void; index: number; items: WorldbuildEntity[]; actors: WorldbuildEntity[]; locations: WorldbuildEntity[] }) {
  const change = editor.inventoryChanges[index];
  if (!change) return null;
  const destinationOptions = [
    ...actors.map(entity => ({ ...option(entity), id: `holder:${entity.id}`, group: 'Inventory' })),
    ...locations.map(entity => ({ ...option(entity), id: `location:${entity.id}`, group: 'Location' })),
  ];
  const destination = change.toHolderId ? `holder:${change.toHolderId}` : change.locationId ? `location:${change.locationId}` : '';
  const put = (patch: Partial<typeof change>) => replaceAt(editor.inventoryChanges, index, { ...change, ...patch }, inventoryChanges => setEditor({ ...editor, inventoryChanges }));
  return <div className="grid gap-3 sm:grid-cols-2">
    <ConsequenceField label="Item"><SearchableSelect ariaLabel="Inventory consequence item" value={String(change.itemId || '')} onChange={(itemId: string) => put({ itemId })} options={options(items)} placeholder="Choose item…" searchPlaceholder="Filter items…" /></ConsequenceField>
    <ConsequenceField label="How many"><NumberInput className={INPUT} min={1} value={Number(change.quantity || 1)} onChange={quantity => put({ quantity })} aria-label="Quantity" /></ConsequenceField>
    <ConsequenceField label="From"><SearchableSelect ariaLabel="Previous inventory holder" value={String(change.fromHolderId || '')} onChange={(fromHolderId: string) => put({ fromHolderId: fromHolderId || null })} options={options(actors)} placeholder="No previous holder" searchPlaceholder="Filter holders…" /></ConsequenceField>
    <ConsequenceField label="To"><SearchableSelect ariaLabel="New inventory placement" value={destination} onChange={(next: string) => {
      const [kind, id] = next.split(':');
      put({ toHolderId: kind === 'holder' ? id : null, locationId: kind === 'location' ? id : null });
    }} options={destinationOptions} placeholder="Choose an inventory or place" searchPlaceholder="Filter inventories and locations…" /></ConsequenceField>
  </div>;
}

function RelationshipChangeFields({ editor, setEditor, index, subjects }: { editor: EditorState; setEditor(value: EditorState): void; index: number; subjects: WorldbuildEntity[] }) {
  const change = editor.relationshipChanges[index];
  if (!change) return null;
  const put = (patch: Partial<typeof change>) => replaceAt(editor.relationshipChanges, index, { ...change, ...patch }, relationshipChanges => setEditor({ ...editor, relationshipChanges }));
  const people = (list: WorldbuildEntity[]) => list.map(entity => ({ ...option(entity), icon: undefined, dotClassName: entityMeta(entity).dot }));
  return <div className="grid gap-3 sm:grid-cols-2">
    <ConsequenceField label="From"><SearchableSelect ariaLabel="Relationship source" value={change.sourceEntityId} onChange={(sourceEntityId: string) => put({ sourceEntityId })} options={people(subjects)} placeholder="Choose who…" searchPlaceholder="Filter entities…" /></ConsequenceField>
    <ConsequenceField label="Toward"><SearchableSelect ariaLabel="Relationship target" value={change.targetEntityId} onChange={(targetEntityId: string) => put({ targetEntityId })} options={people(subjects.filter(entity => entity.id !== change.sourceEntityId))} placeholder="Choose whom…" searchPlaceholder="Filter entities…" /></ConsequenceField>
    <ConsequenceField label="Dimension"><input aria-label="Relationship dimension" className={INPUT} value={change.dimension} onChange={event => put({ dimension: event.target.value })} placeholder="e.g. Trust" /></ConsequenceField>
    <ConsequenceField label="Result"><RelationshipSlider label="Resulting relationship value" value={Number(change.value) || 0} onChange={value => put({ value })} ends={false} /></ConsequenceField>
    <div className="sm:col-span-2"><ConsequenceField label="Context"><input aria-label="Relationship change context" className={INPUT} value={change.description} onChange={event => put({ description: event.target.value })} placeholder="What changed" /></ConsequenceField></div>
  </div>;
}

function DetailSection({ icon: Icon, title, action, children }: { icon: typeof Brain; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section><header className="mb-2 flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-sm font-semibold text-text-primary"><Icon className="h-4 w-4 text-text-muted" />{title}</div>{action}</header>{children}</section>;
}

function ConsequenceRow({ onRemove, children }: { onRemove(): void; children: React.ReactNode }) {
  return <div className="ws-card mb-2 grid gap-3 rounded-card border border-border-subtle bg-surface-panel-muted/60 p-3 lg:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))_auto] lg:items-end">{children}<button type="button" onClick={onRemove} aria-label="Remove consequence" data-tooltip="Remove" className="inline-flex h-10 w-10 items-center justify-center rounded-control text-text-subtle hover:bg-status-danger/10 hover:text-status-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"><X className="h-4 w-4" /></button></div>;
}

function ConsequenceField({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0"><span className="mb-1.5 block text-xs font-medium text-text-muted">{label}</span>{children}</div>;
}

function EmptyDetail({ text }: { text: string }) {
  return <p className="py-1 text-sm text-text-disabled">{text}</p>;
}

function canOwnMemory(entity: WorldbuildEntity): boolean {
  return entity.type === 'Factions' || canJoinFaction(entity);
}

/** Who a roster can hold: anyone who is a someone rather than a kind of thing. */
function canJoinFaction(entity: WorldbuildEntity): boolean {
  return entity.type === 'Characters'
    || (entity.type === 'Creatures' && String(entity.data?.scope ?? 'individual') !== 'group');
}

function defaultParticipant(entityId: string): WorldbuildEventOccurrenceParticipant {
  return { entityId, role: 'involved', remember: true, memoryAccessibility: 'available', audienceType: 'all-members', selectedMemberIds: [] };
}

function options(entities: WorldbuildEntity[]) {
  return entities.map(option);
}

function optionsWithHistorical(entities: WorldbuildEntity[], selectedIds: string[], entityById: Map<string, WorldbuildEntity>) {
  const availableIds = new Set(entities.map(entity => entity.id));
  const historical = uniqueIds(selectedIds).filter(id => !availableIds.has(id)).map(id => {
    const entity = entityById.get(id);
    return entity
      ? { ...option(entity), label: `${entity.canonicalName} (unavailable)`, description: 'Remove this historical reference before saving.' }
      : { id, label: `Missing entity (${id})`, group: 'Unavailable', description: 'Remove this historical reference before saving.' };
  });
  return [...options(entities), ...historical];
}

function option(entity: WorldbuildEntity) {
  const metadata = entityMeta(entity);
  return { id: entity.id, label: entity.canonicalName, aliases: entity.aliases, group: metadata.label, icon: metadata.icon };
}

function replaceAt<T>(values: T[], index: number, value: T, set: (values: T[]) => void) {
  set(values.map((current, currentIndex) => currentIndex === index ? value : current));
}

function uniqueIds(values: string[]) {
  return [...new Set(values.filter(Boolean))];
}

function consequenceArray<T>(value: unknown): T[] {
  if (!Array.isArray(value)) return [];
  return value.filter(item => item && typeof item === 'object').map(item => ({ ...item })) as T[];
}

function consequenceSummary(value: Record<string, unknown>): Array<{ label: string; count: number }> {
  const labels: Record<string, string> = {
    resources: 'state changes',
    inventory: 'inventory changes',
    relationships: 'relationship changes',
    memories: 'memories',
    facts: 'facts',
  };
  return Object.entries(value).flatMap(([key, item]) => {
    const count = Array.isArray(item) ? item.length : Number(item) || 0;
    return count > 0 ? [{ label: labels[key] ?? key, count }] : [];
  });
}

function countConsequences(value: Record<string, unknown>): number {
  return Object.values(value).reduce<number>((total, item) => total + (Array.isArray(item) ? item.length : Number(item) || 0), 0);
}
