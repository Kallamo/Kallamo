import { useEffect, useMemo, useState } from 'react';
import { Activity, Brain, CalendarClock, ChevronDown, Link2, Package, Plus, Sparkles, Users, X } from 'lucide-react';
import Button from '../../components/ui/Button';
import Modal from '../../components/ui/Modal';
import SearchableSelect from '../../components/ui/SearchableSelect';
import WorldDateInput, { formatWorldDate } from './WorldDateInput';
import type {
  Toast,
  WorldbuildApi,
  WorldbuildEntity,
  WorldbuildEventOccurrence,
  WorldbuildEventOccurrenceParticipant,
} from './worldbuildTypes';

const INPUT = 'w-full rounded-lg border border-white/10 bg-[#06151c] px-3 py-2 text-sm text-gray-200 outline-none transition-colors placeholder:text-gray-600 focus:border-accent/60';

interface RoleplayDefinition {
  id: string;
  name: string;
  key: string;
  minimum: number;
  maximum: number;
  appliesTo: string[];
}

interface EditorState {
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
  const [showDetails, setShowDetails] = useState(false);
  const names = useMemo(() => new Map(entities.map(entity => [entity.id, entity.canonicalName])), [entities]);
  const entityById = useMemo(() => new Map(entities.map(entity => [entity.id, entity])), [entities]);
  const confirmed = useMemo(() => entities.filter(entity => entity.status !== 'proposed' && entity.id !== eventEntity.id), [entities, eventEntity.id]);
  const actors = useMemo(() => confirmed.filter(canOwnMemory), [confirmed]);
  const locations = useMemo(() => confirmed.filter(entity => entity.type === 'Locations'), [confirmed]);
  const items = useMemo(() => confirmed.filter(entity => entity.type === 'Items'), [confirmed]);
  const relationSubjects = useMemo(() => confirmed.filter(entity => entity.type === 'Characters' || entity.type === 'Factions' || (entity.type === 'Creatures' && String(entity.data?.scope ?? 'individual') !== 'group')), [confirmed]);
  const inventoryHolders = useMemo(() => relationSubjects.filter(entity => entity.type !== 'Factions'), [relationSubjects]);

  const load = async () => {
    setLoading(true);
    try {
      const result = await api.listWorldbuildEventOccurrences(workspaceId, eventEntity.id);
      if (!result.success) throw new Error(result.error || 'Could not load event occurrences.');
      setOccurrences(result.occurrences || []);
      if (api.getRoleplayConfiguration) {
        const configuration = await api.getRoleplayConfiguration(workspaceId);
        setDefinitions(Array.isArray(configuration.definitions) ? configuration.definitions as RoleplayDefinition[] : []);
      }
      const membershipResult = await api.listEntityLinks(workspaceId, 'member_of');
      const members = new Map<string, string[]>();
      for (const link of membershipResult.links || []) {
        members.set(link.toId, [...(members.get(link.toId) || []), link.fromId]);
      }
      setFactionMembers(members);
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not load event occurrences.', 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void load(); }, [workspaceId, eventEntity.id]);

  const startAdd = () => {
    setShowDetails(false);
    setEditor({
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
    setSaving(true);
    try {
      const result = await api.createWorldbuildEventOccurrence({
        workspaceId,
        eventEntityId: eventEntity.id,
        title: editor.title.trim(),
        summary: editor.summary.trim(),
        startDate: editor.startDate,
        endDate: editor.endDate,
        participants: editor.participantIds.map(id => editor.participants[id]),
        locationIds: editor.locationIds,
        relatedEntityIds: editor.relatedEntityIds,
        resourceChanges: editor.resourceChanges.filter(change => change.definitionId && change.entityId && Number.isFinite(change.value)),
        inventoryChanges: editor.inventoryChanges.filter(change => String(change.itemId || '').trim()),
        relationshipChanges: editor.relationshipChanges.filter(change => change.sourceEntityId && change.targetEntityId && change.sourceEntityId !== change.targetEntityId && change.dimension.trim()),
      });
      if (!result.success) throw new Error(result.error || 'Could not save the occurrence.');
      setEditor(null);
      await load();
      showToast('Event occurrence recorded.', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Could not save the occurrence.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="overflow-hidden rounded-xl border border-white/10 bg-[#0a1721]/60">
        <header className="flex items-start justify-between gap-4 border-b border-white/[0.08] px-4 py-4">
          <div className="flex min-w-0 gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-orange-300/25 bg-orange-300/[0.08] text-orange-200">
              <CalendarClock className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-sm font-semibold text-gray-100">Occurrences</h2>
              <p className="mt-1 max-w-xl text-xs leading-relaxed text-gray-500">Concrete editions of this event, with their participants, memories, and lasting consequences.</p>
            </div>
          </div>
          <Button size="sm" icon={Plus} onClick={startAdd}>Record occurrence</Button>
        </header>

        <div className="space-y-2.5 p-4">
          {loading && <><div className="h-28 animate-pulse rounded-xl bg-white/[0.04]" /><div className="h-24 animate-pulse rounded-xl bg-white/[0.03]" /></>}
          {!loading && !occurrences.length && (
            <button type="button" onClick={startAdd} className="flex w-full flex-col items-center rounded-xl border border-dashed border-white/10 px-6 py-10 text-center transition-colors hover:border-orange-300/30 hover:bg-orange-300/[0.03]">
              <CalendarClock className="mb-2 h-5 w-5 text-gray-600" />
              <span className="text-sm font-semibold text-gray-300">Record the first occurrence</span>
              <span className="mt-1 max-w-md text-xs leading-relaxed text-gray-500">Each edition remains connected to this event while keeping its own date, participants, memories, and consequences.</span>
            </button>
          )}
          {[...occurrences].reverse().map(occurrence => (
            <OccurrenceCard key={occurrence.id} occurrence={occurrence} names={names} calendar={calendar} />
          ))}
        </div>
      </section>

      {editor && (
        <Modal onClose={() => setEditor(null)} size="xl" title="Record event occurrence" icon={CalendarClock} closeOnOverlay={!saving} closeOnEsc={!saving}>
          <div className="max-h-[76vh] space-y-5 overflow-y-auto p-5 custom-scrollbar">
            <div className="grid gap-4 lg:grid-cols-2">
              <Field label="Occurrence title" hint="Use the edition name or year when it helps distinguish this occurrence.">
                <input autoFocus className={INPUT} value={editor.title} onChange={event => setEditor({ ...editor, title: event.target.value })} placeholder={`e.g. ${eventEntity.canonicalName}, Year 327`} />
              </Field>
              <Field label="Participants" hint="Characters and factions selected here receive a memory by default.">
                <SearchableSelect multiple values={editor.participantIds} onChange={setParticipantIds} options={options(actors)} placeholder="Search participants" />
              </Field>
            </div>

            <Field label="What happened">
              <textarea className={`${INPUT} min-h-28 resize-y`} value={editor.summary} onChange={event => setEditor({ ...editor, summary: event.target.value })} placeholder="Record what happened in this specific edition and why it matters." />
            </Field>

            {calendar && (
              <div className="grid gap-4 lg:grid-cols-2">
                <Field label="Start date"><WorldDateInput calendar={calendar} value={editor.startDate} onChange={(startDate: Record<string, unknown> | null) => setEditor({ ...editor, startDate })} /></Field>
                <Field label="End date" hint="Optional for multi-day occurrences."><WorldDateInput calendar={calendar} value={editor.endDate} onChange={(endDate: Record<string, unknown> | null) => setEditor({ ...editor, endDate })} /></Field>
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <Field label="Locations">
                <SearchableSelect multiple values={editor.locationIds} onChange={(locationIds: string[]) => setEditor({ ...editor, locationIds })} options={options(locations)} placeholder="Add locations" />
              </Field>
              <Field label="Other related entities" hint="Items, factions, locations, or other entities involved without automatically receiving a memory.">
                <SearchableSelect multiple values={editor.relatedEntityIds} onChange={(relatedEntityIds: string[]) => setEditor({ ...editor, relatedEntityIds })} options={options(confirmed)} placeholder="Add related entities" />
              </Field>
            </div>

            <button type="button" onClick={() => setShowDetails(value => !value)} className="flex w-full items-center gap-3 rounded-xl border border-white/10 bg-black/10 px-4 py-3 text-left transition-colors hover:border-white/20 hover:bg-white/[0.03]">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-violet-300/20 bg-violet-300/[0.06] text-violet-200"><Sparkles className="h-4 w-4" /></span>
              <span className="min-w-0 flex-1"><span className="block text-sm font-semibold text-gray-200">Memories and consequences</span><span className="mt-0.5 block text-xs text-gray-500">Optional details for state, inventory, relationships, and faction memory.</span></span>
              <ChevronDown className={`h-4 w-4 text-gray-500 transition-transform ${showDetails ? 'rotate-180' : ''}`} />
            </button>

            {showDetails && (
              <div className="space-y-5 rounded-xl border border-white/[0.08] bg-black/10 p-4">
                {editor.participantIds.length > 0 && (
                  <DetailSection icon={Brain} title="Participant memories">
                    <div className="space-y-2">
                      {editor.participantIds.map(id => {
                        const participant = editor.participants[id];
                        const entity = entityById.get(id);
                        const isFaction = entity?.type === 'Factions';
                        return (
                          <div key={id} className="rounded-lg border border-white/[0.08] bg-[#07151e]/60 p-3">
                            <div className="grid gap-2 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
                              <Field label={entity?.canonicalName || 'Participant'}>
                                <input className={INPUT} value={participant.role} onChange={event => patchParticipant(id, { role: event.target.value })} placeholder="Role in this occurrence" />
                              </Field>
                              <Field label="Memory access">
                                <select className={INPUT} value={participant.memoryAccessibility} onChange={event => patchParticipant(id, { memoryAccessibility: event.target.value as WorldbuildEventOccurrenceParticipant['memoryAccessibility'] })}>
                                  <option value="available">Available</option>
                                  <option value="suppressed">Suppressed</option>
                                  <option value="inaccessible">Inaccessible</option>
                                </select>
                              </Field>
                              <label className="flex min-h-10 items-center gap-2 text-xs text-gray-400"><input type="checkbox" checked={participant.remember} onChange={event => patchParticipant(id, { remember: event.target.checked })} />Create Memory</label>
                            </div>
                            {isFaction && participant.remember && (
                              <div className="mt-3 grid gap-2 lg:grid-cols-2">
                                <Field label="Faction audience">
                                  <select className={INPUT} value={participant.audienceType} onChange={event => patchParticipant(id, { audienceType: event.target.value as WorldbuildEventOccurrenceParticipant['audienceType'], selectedMemberIds: [] })}>
                                    <option value="all-members">All members</option>
                                    <option value="selected-members">Selected members</option>
                                  </select>
                                </Field>
                                {participant.audienceType === 'selected-members' && <Field label="Members"><SearchableSelect multiple values={participant.selectedMemberIds} onChange={(selectedMemberIds: string[]) => patchParticipant(id, { selectedMemberIds })} options={options(confirmed.filter(candidate => (factionMembers.get(id) || []).includes(candidate.id)))} placeholder="Choose members" /></Field>}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </DetailSection>
                )}

                <ResourceConsequences editor={editor} setEditor={setEditor} definitions={definitions} entities={confirmed} />
                <InventoryConsequences editor={editor} setEditor={setEditor} items={items} actors={inventoryHolders} locations={locations} />
                <RelationshipConsequences editor={editor} setEditor={setEditor} subjects={relationSubjects} />
              </div>
            )}
          </div>
          <footer className="flex justify-end gap-2 border-t border-white/10 px-5 py-4">
            <Button variant="ghost" onClick={() => setEditor(null)} disabled={saving}>Cancel</Button>
            <Button onClick={save} loading={saving} disabled={!editor.title.trim() || !editor.summary.trim()}>Record occurrence</Button>
          </footer>
        </Modal>
      )}
    </div>
  );
}

function OccurrenceCard({ occurrence, names, calendar }: { occurrence: WorldbuildEventOccurrence; names: Map<string, string>; calendar: Record<string, unknown> | null }) {
  const consequenceCount = countConsequences(occurrence.consequences);
  return (
    <article className="rounded-xl border border-white/[0.08] bg-black/10 px-4 py-4 transition-colors hover:border-white/15 hover:bg-white/[0.025]">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-sm font-semibold text-orange-100">{occurrence.title}</h3>
            <span className={`rounded-full border px-2 py-0.5 text-xs ${occurrence.status === 'approved' ? 'border-emerald-300/20 bg-emerald-300/[0.06] text-emerald-200' : occurrence.status === 'proposed' ? 'border-violet-300/20 bg-violet-300/[0.06] text-violet-200' : 'border-red-300/20 bg-red-300/[0.06] text-red-200'}`}>{occurrence.status}</span>
          </div>
          {occurrence.startDate && calendar && <p className="mt-1 text-xs text-gray-500">{formatWorldDate(calendar, occurrence.startDate)}{occurrence.endDate ? ` to ${formatWorldDate(calendar, occurrence.endDate)}` : ''}</p>}
          <p className="mt-2 whitespace-pre-wrap text-sm leading-relaxed text-gray-300">{occurrence.summary}</p>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {occurrence.participants.map(participant => <span key={participant.entityId} className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-xs text-gray-400">{names.get(participant.entityId) || 'Unknown'} · {participant.role}</span>)}
            {occurrence.locationIds.map(id => <span key={id} className="rounded-full border border-emerald-300/15 bg-emerald-300/[0.04] px-2 py-0.5 text-xs text-emerald-200/80">{names.get(id) || 'Unknown location'}</span>)}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-500">
            <span className="inline-flex items-center gap-1">{occurrence.source === 'narrative-state' ? <><Sparkles className="h-3 w-3 text-violet-300" />Narrative State</> : 'Added manually'}</span>
            <span className="inline-flex items-center gap-1"><Users className="h-3 w-3" />{occurrence.participants.filter(participant => participant.remember).length} memories</span>
            {consequenceCount > 0 && <span className="inline-flex items-center gap-1"><Activity className="h-3 w-3" />{consequenceCount} consequences</span>}
          </div>
        </div>
      </div>
    </article>
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
      <select className={INPUT} value={change.entityId} onChange={event => replaceAt(editor.resourceChanges, index, { ...change, entityId: event.target.value }, resourceChanges => setEditor({ ...editor, resourceChanges }))}><option value="">Entity</option>{entities.map(entity => <option key={entity.id} value={entity.id}>{entity.canonicalName}</option>)}</select>
      <select className={INPUT} value={change.definitionId} onChange={event => replaceAt(editor.resourceChanges, index, { ...change, definitionId: event.target.value }, resourceChanges => setEditor({ ...editor, resourceChanges }))}><option value="">State</option>{availableDefinitions.map(definition => <option key={definition.id} value={definition.id}>{definition.name}</option>)}</select>
      <input className={INPUT} type="number" value={change.value} onChange={event => replaceAt(editor.resourceChanges, index, { ...change, value: Number(event.target.value) }, resourceChanges => setEditor({ ...editor, resourceChanges }))} aria-label="Resulting state value" />
    </ConsequenceRow>;
    })}
  </DetailSection>;
}

function InventoryConsequences({ editor, setEditor, items, actors, locations }: { editor: EditorState; setEditor(value: EditorState): void; items: WorldbuildEntity[]; actors: WorldbuildEntity[]; locations: WorldbuildEntity[] }) {
  const add = () => setEditor({ ...editor, inventoryChanges: [...editor.inventoryChanges, { itemId: '', fromHolderId: '', toHolderId: '', locationId: '', quantity: 1 }] });
  return <DetailSection icon={Package} title="Inventory consequences" action={<Button variant="ghost" size="sm" icon={Plus} onClick={add}>Add inventory</Button>}>
    {!editor.inventoryChanges.length && <EmptyDetail text="No inventory changes recorded." />}
    {editor.inventoryChanges.map((change, index) => <ConsequenceRow key={index} onRemove={() => setEditor({ ...editor, inventoryChanges: editor.inventoryChanges.filter((_, itemIndex) => itemIndex !== index) })}>
      <select className={INPUT} value={String(change.itemId || '')} onChange={event => replaceAt(editor.inventoryChanges, index, { ...change, itemId: event.target.value }, inventoryChanges => setEditor({ ...editor, inventoryChanges }))}><option value="">Item</option>{items.map(item => <option key={item.id} value={item.id}>{item.canonicalName}</option>)}</select>
      <select className={INPUT} value={String(change.fromHolderId || '')} onChange={event => replaceAt(editor.inventoryChanges, index, { ...change, fromHolderId: event.target.value || null }, inventoryChanges => setEditor({ ...editor, inventoryChanges }))}><option value="">No previous holder</option>{actors.map(entity => <option key={entity.id} value={entity.id}>From {entity.canonicalName}</option>)}</select>
      <select className={INPUT} value={String(change.toHolderId || '')} onChange={event => replaceAt(editor.inventoryChanges, index, { ...change, toHolderId: event.target.value || null, locationId: null }, inventoryChanges => setEditor({ ...editor, inventoryChanges }))}><option value="">No new holder</option>{actors.map(entity => <option key={entity.id} value={entity.id}>To {entity.canonicalName}</option>)}</select>
      <select className={INPUT} value={String(change.locationId || '')} onChange={event => replaceAt(editor.inventoryChanges, index, { ...change, locationId: event.target.value || null, toHolderId: null }, inventoryChanges => setEditor({ ...editor, inventoryChanges }))}><option value="">No destination location</option>{locations.map(location => <option key={location.id} value={location.id}>{location.canonicalName}</option>)}</select>
      <input className={INPUT} type="number" min="1" value={Number(change.quantity || 1)} onChange={event => replaceAt(editor.inventoryChanges, index, { ...change, quantity: Math.max(1, Number(event.target.value) || 1) }, inventoryChanges => setEditor({ ...editor, inventoryChanges }))} aria-label="Quantity" />
    </ConsequenceRow>)}
  </DetailSection>;
}

function RelationshipConsequences({ editor, setEditor, subjects }: { editor: EditorState; setEditor(value: EditorState): void; subjects: WorldbuildEntity[] }) {
  const add = () => setEditor({ ...editor, relationshipChanges: [...editor.relationshipChanges, { sourceEntityId: '', targetEntityId: '', dimension: 'overall', value: 0, description: '' }] });
  return <DetailSection icon={Link2} title="Relationship consequences" action={<Button variant="ghost" size="sm" icon={Plus} onClick={add}>Add relationship</Button>}>
    {!editor.relationshipChanges.length && <EmptyDetail text="No relationship changes recorded." />}
    {editor.relationshipChanges.map((change, index) => <ConsequenceRow key={index} onRemove={() => setEditor({ ...editor, relationshipChanges: editor.relationshipChanges.filter((_, itemIndex) => itemIndex !== index) })}>
      <select className={INPUT} value={change.sourceEntityId} onChange={event => replaceAt(editor.relationshipChanges, index, { ...change, sourceEntityId: event.target.value }, relationshipChanges => setEditor({ ...editor, relationshipChanges }))}><option value="">From</option>{subjects.map(entity => <option key={entity.id} value={entity.id}>{entity.canonicalName}</option>)}</select>
      <select className={INPUT} value={change.targetEntityId} onChange={event => replaceAt(editor.relationshipChanges, index, { ...change, targetEntityId: event.target.value }, relationshipChanges => setEditor({ ...editor, relationshipChanges }))}><option value="">Toward</option>{subjects.map(entity => <option key={entity.id} value={entity.id}>{entity.canonicalName}</option>)}</select>
      <input className={INPUT} value={change.dimension} onChange={event => replaceAt(editor.relationshipChanges, index, { ...change, dimension: event.target.value }, relationshipChanges => setEditor({ ...editor, relationshipChanges }))} placeholder="Dimension" />
      <input className={INPUT} type="number" value={change.value} onChange={event => replaceAt(editor.relationshipChanges, index, { ...change, value: Number(event.target.value) }, relationshipChanges => setEditor({ ...editor, relationshipChanges }))} aria-label="Resulting relationship value" />
      <input className={INPUT} value={change.description} onChange={event => replaceAt(editor.relationshipChanges, index, { ...change, description: event.target.value }, relationshipChanges => setEditor({ ...editor, relationshipChanges }))} placeholder="What changed" />
    </ConsequenceRow>)}
  </DetailSection>;
}

function DetailSection({ icon: Icon, title, action, children }: { icon: typeof Brain; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return <section><header className="mb-2 flex items-center justify-between gap-3"><div className="flex items-center gap-2 text-xs font-semibold text-gray-300"><Icon className="h-4 w-4 text-violet-200" />{title}</div>{action}</header>{children}</section>;
}

function ConsequenceRow({ onRemove, children }: { onRemove(): void; children: React.ReactNode }) {
  return <div className="mb-2 grid gap-2 rounded-lg border border-white/[0.08] bg-[#07151e]/60 p-3 lg:grid-cols-[repeat(auto-fit,minmax(8rem,1fr))_auto] lg:items-center">{children}<button type="button" onClick={onRemove} aria-label="Remove consequence" className="rounded-md p-2 text-gray-500 hover:bg-red-400/10 hover:text-red-300"><X className="h-4 w-4" /></button></div>;
}

function EmptyDetail({ text }: { text: string }) {
  return <p className="rounded-lg border border-dashed border-white/[0.08] px-3 py-4 text-center text-xs text-gray-600">{text}</p>;
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return <label className="block"><span className="mb-1 block text-xs font-semibold text-gray-400">{label}</span>{children}{hint && <span className="mt-1 block text-xs leading-relaxed text-gray-500">{hint}</span>}</label>;
}

function canOwnMemory(entity: WorldbuildEntity): boolean {
  return entity.type === 'Characters' || entity.type === 'Factions' || (entity.type === 'Creatures' && String(entity.data?.scope ?? 'individual') !== 'group');
}

function defaultParticipant(entityId: string): WorldbuildEventOccurrenceParticipant {
  return { entityId, role: 'involved', remember: true, memoryAccessibility: 'available', audienceType: 'all-members', selectedMemberIds: [] };
}

function options(entities: WorldbuildEntity[]) {
  return entities.map(entity => ({ id: entity.id, label: entity.canonicalName, aliases: entity.aliases, group: entity.type.replace(/s$/, '') }));
}

function replaceAt<T>(values: T[], index: number, value: T, set: (values: T[]) => void) {
  set(values.map((current, currentIndex) => currentIndex === index ? value : current));
}

function countConsequences(value: Record<string, unknown>): number {
  return Object.values(value).reduce<number>((total, item) => total + (Array.isArray(item) ? item.length : Number(item) || 0), 0);
}
