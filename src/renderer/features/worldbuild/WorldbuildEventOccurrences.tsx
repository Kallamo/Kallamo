import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Activity, Brain, CalendarClock, ChevronDown, Link2, Package, Pencil, Plus, Sparkles, Trash2, Users, X } from 'lucide-react';
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
      <section className="overflow-hidden rounded-card border border-border-subtle bg-surface-panel-muted/60">
        <header className="flex items-start justify-between gap-4 border-b border-border-subtle px-4 py-4">
          <div className="flex min-w-0 gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-card border border-status-warning/25 bg-status-warning/[0.08] text-status-warning">
              <CalendarClock className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-text-primary">Occurrences</h2>
              <p className="mt-1 max-w-xl text-xs leading-relaxed text-text-subtle">Concrete editions of this event, with their participants, memories, and lasting consequences.</p>
            </div>
          </div>
          <Button size="sm" icon={Plus} onClick={startAdd}>Record occurrence</Button>
        </header>

        <div className="space-y-2.5 p-4">
          {loading && <><div className="h-28 animate-pulse rounded-card bg-surface-hover/40" /><div className="h-24 animate-pulse rounded-card bg-surface-hover/35" /></>}
          {!loading && !occurrences.length && (
            <button type="button" onClick={startAdd} className="flex w-full flex-col items-center rounded-card border border-dashed border-border-subtle px-6 py-10 text-center transition-colors hover:border-status-warning/30 hover:bg-status-warning/[0.03]">
              <CalendarClock className="mb-2 h-5 w-5 text-text-disabled" />
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

      {editor && (
        <Modal onClose={() => setEditor(null)} size="2xl" title={editor.occurrenceId ? 'Edit event occurrence' : 'Record event occurrence'} icon={CalendarClock} closeOnOverlay={!saving} closeOnEsc={!saving}>
          <div className="max-h-[76vh] space-y-4 overflow-y-auto overscroll-contain p-5 custom-scrollbar">
            <EditorRegion title="Event details" description="Name this edition and record what happened.">
              <div className="space-y-4">
                <TextInput
                  autoFocus
                  required
                  label="Occurrence title"
                  hint="Use the edition name or year when it helps distinguish this occurrence."
                  value={editor.title}
                  onChange={(event: React.ChangeEvent<HTMLInputElement>) => setEditor({ ...editor, title: event.target.value })}
                  placeholder={`e.g. ${eventEntity.canonicalName}, Year 327`}
                />
                <Textarea
                  required
                  label="What happened"
                  className="min-h-32"
                  value={editor.summary}
                  onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => setEditor({ ...editor, summary: event.target.value })}
                  placeholder="Record what happened in this specific edition and why it matters."
                />
              </div>
            </EditorRegion>

            <EditorRegion title="When and where" description="Place this occurrence in the calendar and the world.">
              <div className="space-y-4">
                {calendar && (
                  <div className="grid gap-3 xl:grid-cols-2">
                    <Field label="Start date" optional>
                      <WorldDateInput label="Start date" emptyLabel="Set start date" calendar={calendar} value={editor.startDate} onChange={(startDate: Record<string, unknown> | null) => setEditor({ ...editor, startDate, endDate: startDate ? editor.endDate : null })} />
                    </Field>
                    <Field label="End date" hint="Only needed for multi-day occurrences." optional>
                      <WorldDateInput label="End date" emptyLabel={editor.startDate ? 'Add end date' : 'Set a start date first'} seedValue={editor.startDate} disabled={!editor.startDate} calendar={calendar} value={editor.endDate} onChange={(endDate: Record<string, unknown> | null) => setEditor({ ...editor, endDate })} />
                    </Field>
                  </div>
                )}
                <Field label="Locations" optional>
                  <SearchableSelect ariaLabel="Occurrence locations" multiple values={editor.locationIds} onChange={(locationIds: string[]) => setEditor({ ...editor, locationIds })} options={optionsWithHistorical(locations, editor.locationIds, entityById)} placeholder="Add locations" />
                </Field>
              </div>
            </EditorRegion>

            <EditorRegion title="People and context" description="Connect who was involved and anything else that matters to this edition.">
              <div className="grid gap-4 lg:grid-cols-2">
                <Field label="Participants" hint="Characters and factions selected here receive a memory by default." optional>
                  <SearchableSelect ariaLabel="Occurrence participants" multiple values={editor.participantIds} onChange={setParticipantIds} options={optionsWithHistorical(actors, editor.participantIds, entityById)} placeholder="Search participants" />
                </Field>
                <Field label="Other related entities" hint="Items, factions, locations, or other entities involved without automatically receiving a memory." optional>
                  <SearchableSelect ariaLabel="Other entities related to this occurrence" multiple values={editor.relatedEntityIds} onChange={(relatedEntityIds: string[]) => setEditor({ ...editor, relatedEntityIds })} options={optionsWithHistorical(confirmed, editor.relatedEntityIds, entityById)} placeholder="Add related entities" />
                </Field>
              </div>
            </EditorRegion>

            <button type="button" onClick={() => setShowDetails(value => !value)} aria-expanded={showDetails} aria-controls={advancedDetailsId} className="flex w-full items-center gap-3 rounded-card border border-border-subtle bg-surface-canvas/30 px-4 py-3 text-left transition-colors hover:border-border-strong hover:bg-surface-hover/35 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
              <span className="flex h-8 w-8 items-center justify-center rounded-control border border-entity-event/20 bg-entity-event/[0.06] text-entity-event"><Sparkles className="h-4 w-4" aria-hidden="true" /></span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-text-secondary">Memories and consequences</span><span className="mt-0.5 block text-xs text-text-subtle">{editor.occurrenceId ? 'Review participant memories. Applied consequences remain unchanged.' : 'Optional details for state, inventory, relationships, and faction memory.'}</span></span>
              <ChevronDown aria-hidden="true" className={`h-4 w-4 text-text-subtle transition-transform motion-reduce:transition-none ${showDetails ? 'rotate-180' : ''}`} />
            </button>

            {showDetails && (
              <div id={advancedDetailsId} className="space-y-5 rounded-card border border-border-subtle bg-surface-canvas/30 p-4">
                {editor.participantIds.length > 0 && (
                  <DetailSection icon={Brain} title="Participant memories">
                    <div className="space-y-2">
                      {editor.participantIds.map(id => {
                        const participant = editor.participants[id];
                        const entity = entityById.get(id);
                        const isFaction = entity?.type === 'Factions';
                        return (
                          <div key={id} className="rounded-control border border-border-subtle bg-surface-panel-muted/60 p-3">
                            <div className="grid gap-2 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
                              <Field label={entity?.canonicalName || 'Participant'}>
                                <input aria-label={`${entity?.canonicalName || 'Participant'} role`} className={INPUT} value={participant.role} onChange={event => patchParticipant(id, { role: event.target.value })} placeholder="Role in this occurrence" />
                              </Field>
                              <Field label="Memory access">
                                <select aria-label={`${entity?.canonicalName || 'Participant'} memory access`} className={INPUT} value={participant.memoryAccessibility} onChange={event => patchParticipant(id, { memoryAccessibility: event.target.value as WorldbuildEventOccurrenceParticipant['memoryAccessibility'] })}>
                                  <option value="available">Available</option>
                                  <option value="suppressed">Suppressed</option>
                                  <option value="inaccessible">Inaccessible</option>
                                </select>
                              </Field>
                              <div className="flex min-h-10 items-center"><Checkbox checked={participant.remember} onChange={remember => patchParticipant(id, { remember })} label="Create Memory" /></div>
                            </div>
                            {isFaction && participant.remember && (
                              <div className="mt-3 grid gap-2 lg:grid-cols-2">
                                <Field label="Faction audience">
                                  <select aria-label={`${entity?.canonicalName || 'Faction'} memory audience`} className={INPUT} value={participant.audienceType} onChange={event => patchParticipant(id, { audienceType: event.target.value as WorldbuildEventOccurrenceParticipant['audienceType'], selectedMemberIds: [] })}>
                                    <option value="all-members">All members</option>
                                    <option value="selected-members">Selected members</option>
                                  </select>
                                </Field>
                                {participant.audienceType === 'selected-members' && <Field label="Members"><SearchableSelect ariaLabel={`Members of ${entity?.canonicalName || 'faction'}`} multiple values={participant.selectedMemberIds} onChange={(selectedMemberIds: string[]) => patchParticipant(id, { selectedMemberIds })} options={optionsWithHistorical(confirmed.filter(candidate => canJoinFaction(candidate) && (factionMembers.get(id) || []).includes(candidate.id)), participant.selectedMemberIds, entityById)} placeholder="Choose members" /></Field>}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </DetailSection>
                )}

                {editor.occurrenceId ? (
                  <ImmutableConsequences editor={editor} />
                ) : (
                  <>
                    <ResourceConsequences editor={editor} setEditor={setEditor} definitions={definitions} entities={confirmed} />
                    <InventoryConsequences editor={editor} setEditor={setEditor} items={items} actors={inventoryHolders} locations={locations} />
                    <RelationshipConsequences editor={editor} setEditor={setEditor} subjects={relationSubjects} />
                  </>
                )}
              </div>
            )}
          </div>
          <footer className="flex justify-end gap-2 border-t border-border-subtle px-5 py-4">
            <Button variant="ghost" onClick={() => setEditor(null)} disabled={saving}>Cancel</Button>
            <Button onClick={save} loading={saving} disabled={!editor.title.trim() || !editor.summary.trim()}>{editor.occurrenceId ? 'Save changes' : 'Record occurrence'}</Button>
          </footer>
        </Modal>
      )}

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
    <section className="rounded-card border border-border-subtle bg-surface-panel/45 p-4">
      <header className="mb-4">
        <h3 className="text-sm font-semibold text-text-primary">{title}</h3>
        <p className="mt-1 text-xs leading-relaxed text-text-muted">{description}</p>
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
    <article className="rounded-card border border-border-subtle bg-surface-canvas/30 px-4 py-4 transition-colors hover:border-border-default hover:bg-surface-hover/25">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-status-warning">{occurrence.title}</h3>
            <span className={`rounded-full border px-2 py-0.5 text-xs ${occurrence.status === 'approved' ? 'border-status-success/20 bg-status-success/[0.06] text-status-success' : occurrence.status === 'proposed' ? 'border-entity-event/20 bg-entity-event/[0.06] text-entity-event' : 'border-status-danger/20 bg-status-danger/[0.06] text-status-danger'}`}>{occurrence.status}</span>
          </div>
          {occurrence.startDate && calendar && <p className="mt-1 text-xs text-text-subtle">{formatWorldDate(calendar, occurrence.startDate)}{occurrence.endDate ? ` to ${formatWorldDate(calendar, occurrence.endDate)}` : ''}</p>}
          <p className={`mt-2 whitespace-pre-wrap text-sm leading-relaxed text-text-secondary ${expanded ? '' : 'line-clamp-2'}`}>{occurrence.summary}</p>
          {expanded && <div id={detailsId} className="mt-3 flex flex-wrap gap-1.5 border-t border-border-subtle pt-3">
            {occurrence.participants.map(participant => <span key={participant.entityId} className="rounded-full border border-border-subtle bg-surface-hover/40 px-2 py-0.5 text-xs text-text-muted">{names.get(participant.entityId) || 'Unknown'} · {participant.role}</span>)}
            {occurrence.locationIds.map(id => <span key={id} className="rounded-full border border-status-success/15 bg-status-success/[0.04] px-2 py-0.5 text-xs text-status-success/80">{names.get(id) || 'Unknown location'}</span>)}
            {occurrence.relatedEntityIds.map(id => <span key={`related:${id}`} className="rounded-full border border-border-subtle bg-surface-hover/40 px-2 py-0.5 text-xs text-text-muted">{names.get(id) || 'Unknown entity'}</span>)}
          </div>}
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-text-subtle">
            <span className="inline-flex items-center gap-1">{occurrence.source === 'narrative-state' ? <><Sparkles className="h-3 w-3 text-entity-event" />Narrative State</> : 'Added manually'}</span>
            <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{occurrence.participants.length} participants</span>
            <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{occurrence.participants.filter(participant => participant.remember).length} memories</span>
            {consequenceCount > 0 && <span className="inline-flex items-center gap-1"><Activity className="h-3 w-3" />{consequenceCount} consequences</span>}
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-border-subtle pt-3">
            <button type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded} aria-controls={detailsId} className="inline-flex min-h-9 items-center gap-1.5 rounded-control px-2.5 text-xs font-semibold text-text-muted transition-colors hover:bg-surface-hover/40 hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
              {expanded ? 'Hide details' : 'View details'}
              <ChevronDown aria-hidden="true" className={`h-3.5 w-3.5 transition-transform motion-reduce:transition-none ${expanded ? 'rotate-180' : ''}`} />
            </button>
            {isManual && <div className="flex items-center gap-1">
              <button type="button" onClick={onEdit} className="inline-flex min-h-9 items-center gap-1.5 rounded-control px-2.5 text-xs font-semibold text-text-muted transition-colors hover:bg-surface-hover/40 hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"><Pencil className="h-3.5 w-3.5" aria-hidden="true" />Edit</button>
              <button type="button" onClick={onDelete} className="inline-flex min-h-9 items-center gap-1.5 rounded-control px-2.5 text-xs font-semibold text-text-subtle transition-colors hover:bg-status-danger/[0.06] hover:text-status-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger/40"><Trash2 className="h-3.5 w-3.5" aria-hidden="true" />Delete</button>
            </div>}
          </div>
        </div>
      </div>
    </article>
  );
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
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control border border-status-warning/15 bg-status-warning/[0.05] text-status-warning"><Activity className="h-4 w-4" aria-hidden="true" /></span>
        <div className="min-w-0">
          <h4 className="text-sm font-semibold text-text-secondary">Applied consequences</h4>
          <p className="mt-1 text-xs leading-relaxed text-text-subtle">State, inventory, and relationship effects are kept unchanged while this occurrence is edited.</p>
          {summary.length > 0 && <div className="mt-2 flex flex-wrap gap-2">{summary.map(item => <span key={item.label} className="rounded-control border border-border-subtle px-2 py-1 text-xs text-text-muted">{item.count} {item.label}</span>)}</div>}
        </div>
      </div>
    </section>
  );
}

function ResourceConsequences({ editor, setEditor, definitions, entities }: { editor: EditorState; setEditor(value: EditorState): void; definitions: RoleplayDefinition[]; entities: WorldbuildEntity[] }) {
  const add = () => setEditor({ ...editor, resourceChanges: [...editor.resourceChanges, { definitionId: '', entityId: '', value: 0 }] });
  return <DetailSection icon={Activity} title="State consequences" action={<Button variant="ghost" size="sm" icon={Plus} onClick={add}>Add state</Button>}>
    {!editor.resourceChanges.length && <EmptyDetail text="No state changes recorded." />}
    {editor.resourceChanges.map((change, index) => {
      const entityType = entities.find(entity => entity.id === change.entityId)?.type;
      const availableDefinitions = entityType ? definitions.filter(definition => definition.appliesTo.includes(entityType)) : definitions;
      return <ConsequenceRow key={index} onRemove={() => setEditor({ ...editor, resourceChanges: editor.resourceChanges.filter((_, itemIndex) => itemIndex !== index) })}>
      <ConsequenceField label="Subject"><SearchableSelect ariaLabel="State consequence subject" value={change.entityId} onChange={(entityId: string) => replaceAt(editor.resourceChanges, index, { ...change, entityId, definitionId: '' }, resourceChanges => setEditor({ ...editor, resourceChanges }))} options={options(entities)} placeholder="Choose entity…" searchPlaceholder="Filter entities…" /></ConsequenceField>
      <ConsequenceField label="State"><SearchableSelect ariaLabel="State consequence definition" value={change.definitionId} onChange={(definitionId: string) => replaceAt(editor.resourceChanges, index, { ...change, definitionId }, resourceChanges => setEditor({ ...editor, resourceChanges }))} options={availableDefinitions.map(definition => ({ id: definition.id, label: definition.name, group: definition.appliesTo.join(', ') }))} placeholder="Choose state…" searchPlaceholder="Filter states…" /></ConsequenceField>
      <ConsequenceField label="Result"><input className={INPUT} type="number" value={change.value} onChange={event => replaceAt(editor.resourceChanges, index, { ...change, value: Number(event.target.value) }, resourceChanges => setEditor({ ...editor, resourceChanges }))} aria-label="Resulting state value" /></ConsequenceField>
    </ConsequenceRow>;
    })}
  </DetailSection>;
}

function InventoryConsequences({ editor, setEditor, items, actors, locations }: { editor: EditorState; setEditor(value: EditorState): void; items: WorldbuildEntity[]; actors: WorldbuildEntity[]; locations: WorldbuildEntity[] }) {
  const add = () => setEditor({ ...editor, inventoryChanges: [...editor.inventoryChanges, { itemId: '', fromHolderId: '', toHolderId: '', locationId: '', quantity: 1 }] });
  const destinationOptions = [
    ...actors.map(entity => ({ ...option(entity), id: `holder:${entity.id}`, group: 'Inventory' })),
    ...locations.map(entity => ({ ...option(entity), id: `location:${entity.id}`, group: 'Location' })),
  ];
  return <DetailSection icon={Package} title="Inventory consequences" action={<Button variant="ghost" size="sm" icon={Plus} onClick={add}>Add inventory</Button>}>
    {!editor.inventoryChanges.length && <EmptyDetail text="No inventory changes recorded." />}
    {editor.inventoryChanges.map((change, index) => {
      const destination = change.toHolderId ? `holder:${change.toHolderId}` : change.locationId ? `location:${change.locationId}` : '';
      return <ConsequenceRow key={index} onRemove={() => setEditor({ ...editor, inventoryChanges: editor.inventoryChanges.filter((_, itemIndex) => itemIndex !== index) })}>
      <ConsequenceField label="Item"><SearchableSelect ariaLabel="Inventory consequence item" value={String(change.itemId || '')} onChange={(itemId: string) => replaceAt(editor.inventoryChanges, index, { ...change, itemId }, inventoryChanges => setEditor({ ...editor, inventoryChanges }))} options={options(items)} placeholder="Choose item…" searchPlaceholder="Filter items…" /></ConsequenceField>
      <ConsequenceField label="From"><SearchableSelect ariaLabel="Previous inventory holder" value={String(change.fromHolderId || '')} onChange={(fromHolderId: string) => replaceAt(editor.inventoryChanges, index, { ...change, fromHolderId: fromHolderId || null }, inventoryChanges => setEditor({ ...editor, inventoryChanges }))} options={options(actors)} placeholder="No previous holder" searchPlaceholder="Filter holders…" /></ConsequenceField>
      <ConsequenceField label="New placement"><SearchableSelect ariaLabel="New inventory placement" value={destination} onChange={(next: string) => {
        const [kind, id] = next.split(':');
        replaceAt(editor.inventoryChanges, index, { ...change, toHolderId: kind === 'holder' ? id : null, locationId: kind === 'location' ? id : null }, inventoryChanges => setEditor({ ...editor, inventoryChanges }));
      }} options={destinationOptions} placeholder="No destination set" searchPlaceholder="Filter inventories and locations…" /></ConsequenceField>
      <ConsequenceField label="Quantity"><input className={INPUT} type="number" min="1" value={Number(change.quantity || 1)} onChange={event => replaceAt(editor.inventoryChanges, index, { ...change, quantity: Math.max(1, Number(event.target.value) || 1) }, inventoryChanges => setEditor({ ...editor, inventoryChanges }))} aria-label="Quantity" /></ConsequenceField>
      </ConsequenceRow>;
    })}
  </DetailSection>;
}

function RelationshipConsequences({ editor, setEditor, subjects }: { editor: EditorState; setEditor(value: EditorState): void; subjects: WorldbuildEntity[] }) {
  const add = () => setEditor({ ...editor, relationshipChanges: [...editor.relationshipChanges, { sourceEntityId: '', targetEntityId: '', dimension: 'overall', value: 0, description: '' }] });
  return <DetailSection icon={Link2} title="Relationship consequences" action={<Button variant="ghost" size="sm" icon={Plus} onClick={add}>Add relationship</Button>}>
    {!editor.relationshipChanges.length && <EmptyDetail text="No relationship changes recorded." />}
    {editor.relationshipChanges.map((change, index) => <ConsequenceRow key={index} onRemove={() => setEditor({ ...editor, relationshipChanges: editor.relationshipChanges.filter((_, itemIndex) => itemIndex !== index) })}>
      <ConsequenceField label="Source"><SearchableSelect ariaLabel="Relationship source" value={change.sourceEntityId} onChange={(sourceEntityId: string) => replaceAt(editor.relationshipChanges, index, { ...change, sourceEntityId }, relationshipChanges => setEditor({ ...editor, relationshipChanges }))} options={options(subjects)} placeholder="Choose source…" searchPlaceholder="Filter entities…" /></ConsequenceField>
      <ConsequenceField label="Target"><SearchableSelect ariaLabel="Relationship target" value={change.targetEntityId} onChange={(targetEntityId: string) => replaceAt(editor.relationshipChanges, index, { ...change, targetEntityId }, relationshipChanges => setEditor({ ...editor, relationshipChanges }))} options={options(subjects.filter(entity => entity.id !== change.sourceEntityId))} placeholder="Choose target…" searchPlaceholder="Filter entities…" /></ConsequenceField>
      <ConsequenceField label="Dimension"><input aria-label="Relationship dimension" className={INPUT} value={change.dimension} onChange={event => replaceAt(editor.relationshipChanges, index, { ...change, dimension: event.target.value }, relationshipChanges => setEditor({ ...editor, relationshipChanges }))} placeholder="e.g. Trust" /></ConsequenceField>
      <ConsequenceField label="Result"><input className={INPUT} type="number" value={change.value} onChange={event => replaceAt(editor.relationshipChanges, index, { ...change, value: Number(event.target.value) }, relationshipChanges => setEditor({ ...editor, relationshipChanges }))} aria-label="Resulting relationship value" /></ConsequenceField>
      <ConsequenceField label="Context"><input aria-label="Relationship change context" className={INPUT} value={change.description} onChange={event => replaceAt(editor.relationshipChanges, index, { ...change, description: event.target.value }, relationshipChanges => setEditor({ ...editor, relationshipChanges }))} placeholder="What changed" /></ConsequenceField>
    </ConsequenceRow>)}
  </DetailSection>;
}

function DetailSection({ icon: Icon, title, action, children }: { icon: typeof Brain; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section><header className="mb-2 flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-sm font-semibold text-text-secondary"><Icon className="h-4 w-4 text-accent" />{title}</div>{action}</header>{children}</section>;
}

function ConsequenceRow({ onRemove, children }: { onRemove(): void; children: React.ReactNode }) {
  return <div className="mb-2 grid gap-3 rounded-card border border-border-subtle bg-surface-panel-muted/60 p-3 lg:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))_auto] lg:items-end">{children}<button type="button" onClick={onRemove} aria-label="Remove consequence" title="Remove consequence" className="inline-flex h-10 w-10 items-center justify-center rounded-control text-text-subtle hover:bg-status-danger/10 hover:text-status-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"><X className="h-4 w-4" /></button></div>;
}

function ConsequenceField({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="min-w-0"><span className="mb-1 block text-xs font-semibold uppercase tracking-wider text-text-subtle">{label}</span>{children}</div>;
}

function EmptyDetail({ text }: { text: string }) {
  return <p className="rounded-control border border-dashed border-border-subtle px-3 py-4 text-center text-sm text-text-disabled">{text}</p>;
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
