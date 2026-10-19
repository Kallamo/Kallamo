import { Fragment, type KeyboardEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import {
  BookOpenCheck, Brain, Check, ChevronDown, Eye, EyeOff, Lightbulb, Link2, Lock, LockKeyhole,
  Pencil, Plus, Search, Trash2, Users, UserMinus, X, Ear, Info, MoreHorizontal,
} from 'lucide-react';
import Menu, { MenuItem } from '../../components/ui/Menu';
import IconButton from '../../components/ui/IconButton';
import { AiGlyph, KnowledgeGlyph, OccurrencesGlyph } from '../../components/ui/glyphs';
import Button from '../../components/ui/Button';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import Modal from '../../components/ui/Modal';
import SearchableSelect from '../../components/ui/SearchableSelect';
import WorldDateInput, { formatWorldDate, type WorldDateValue } from './WorldDateInput';
import {
  DURABLE_KNOWLEDGE_CATEGORIES,
  KNOWLEDGE_CATEGORY_LABELS,
  MEMORY_CATEGORY_LABELS,
  normalizeKnowledgeCategory,
  normalizeMemoryCategory,
  type DurableKnowledgeCategory
} from '../../../narrative/narrative-taxonomy';
import type {
  KnowledgeEntryKind, Toast, WorldbuildApi, WorldbuildEntity,
  WorldbuildKnowledgeCard, WorldbuildKnowledgeEntry, WorldbuildKnowledgeProjection,
  WorldbuildKnownRelationship,
} from './worldbuildTypes';
import { meta, TYPE_ORDER } from './worldbuildConfig';

const INPUT = 'wb-input w-full rounded-control border border-border-default bg-surface-input px-3 py-2 text-sm text-text-primary transition-[border-color,box-shadow] placeholder:text-text-subtle focus:border-accent/70 focus:outline-none focus:ring-2 focus:ring-accent/15 motion-reduce:transition-none';
type Surface = 'knowledge' | 'memories';
type MemoryAccessibility = WorldbuildKnowledgeEntry['accessibility'];
const MEMORY_STATES: Record<MemoryAccessibility, {
  label: string; description: string; icon: typeof Eye; tone: string; badge: string;
}> = {
  available: {
    label: 'Available',
    description: 'Recalled and used normally.',
    icon: Eye,
    tone: 'border-status-success/30 bg-status-success/[0.07] text-status-success',
    badge: 'border-status-success/30 bg-status-success/10 text-status-success',
  },
  suppressed: {
    label: 'Suppressed',
    description: 'Exists, but out of reach for now.',
    icon: EyeOff,
    tone: 'border-status-warning/30 bg-status-warning/[0.07] text-status-warning',
    badge: 'border-status-warning/30 bg-status-warning/10 text-status-warning',
  },
  inaccessible: {
    label: 'Inaccessible',
    description: 'Lost for good.',
    icon: LockKeyhole,
    tone: 'border-status-danger/30 bg-status-danger/[0.07] text-status-danger',
    badge: 'border-status-danger/30 bg-status-danger/10 text-status-danger',
  },
};
// Same three origins the Facts registry names, so one vocabulary covers every record
// the world keeps. An occurrence entry is owned by its event and read-only here.
const ENTRY_ORIGINS: Record<'authored' | 'narrative' | 'occurrence', { label: string; icon: typeof Lock | null; tone: string }> = {
  occurrence: { label: 'From an event', icon: OccurrencesGlyph, tone: 'text-text-muted' },
  narrative: { label: 'From the narrative state', icon: AiGlyph, tone: 'text-text-muted' },
  authored: { label: 'Written by you', icon: Pencil, tone: 'text-text-muted' },
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
  former_member_of: 'Former member of',
  operates_in: 'Operates in',
  owned_by: 'Owned by',
  located_in: 'Located in',
  created_by: 'Created by',
  found_in: 'Found in',
  sold_in: 'Sold in',
  is_race: 'Race / species',
  connected_to: 'Connected to',
  adjacent_to: 'Adjacent to',
  related_to: 'Related to',
};
// Every row on a card reads outward from the subject, so the subject's name is a constant
// and only the verb and the other party carry meaning. An edge stored pointing at the
// subject says the same fact read backwards, and these are the words for that reading.
const INVERSE_RELATION_LABELS: Record<string, string> = {
  inside: 'Contains',
  led_by: 'Leads',
  member_of: 'Has member',
  former_member_of: 'Has former member',
  operates_in: 'Territory of',
  owned_by: 'Owns',
  located_in: 'Holds',
  created_by: 'Created',
  found_in: 'Source of',
  sold_in: 'Sells',
  is_race: 'Includes',
};

interface Props {
  workspaceId: string;
  entity: WorldbuildEntity;
  entities: WorldbuildEntity[];
  api: WorldbuildApi;
  showToast: Toast;
  /** The world calendar and the story's current moment; memories are dated against them. */
  calendar?: Record<string, any> | null;
  clock?: WorldDateValue | null;
  /** Opens another sheet, used to send an Event record back to the occurrence that owns it. */
  onOpenEntity?(entityId: string, options?: { tab?: string }): void;
}

export default function WorldbuildKnowledgeTab({ workspaceId, entity, entities, api, showToast, calendar = null, clock = null, onOpenEntity }: Props) {
  const [surface, setSurface] = useState<Surface>('knowledge');
  const [memberships, setMemberships] = useState<Array<{ fromId: string; toId: string }>>([]);
  const [projection, setProjection] = useState<WorldbuildKnowledgeProjection | null>(null);
  const [selectedCard, setSelectedCard] = useState<WorldbuildKnowledgeCard | null>(null);
  const [addingCard, setAddingCard] = useState(false);
  const [deletingCard, setDeletingCard] = useState<WorldbuildKnowledgeCard | null>(null);
  const [cardSearch, setCardSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const projectionRequestRef = useRef(0);
  const projectionScope = JSON.stringify([workspaceId, entity.id]);
  const projectionScopeRef = useRef(projectionScope);
  projectionScopeRef.current = projectionScope;
  const currentProjection = projection?.subjectId === entity.id ? projection : null;
  // The Add memory button lives in the shared header; each press asks Memories to open its form.
  const [composeSignal, setComposeSignal] = useState(0);
  // Sharing runs one way. A faction hands each card down to the members it names, and
  // nothing a member learns alone ever climbs back up, so both sides of that rule are
  // read from the same roster: who receives from here, and who this subject receives from.
  const roster = useMemo(
    () => memberships.filter(link => link.toId === entity.id).map(link => link.fromId),
    [memberships, entity.id],
  );
  const ownFactions = useMemo(
    () => memberships.filter(link => link.fromId === entity.id).map(link => link.toId),
    [memberships, entity.id],
  );
  const filteredCards = useMemo(() => {
    const query = normalizeSearch(cardSearch);
    if (!query) return currentProjection?.cards ?? [];
    return (currentProjection?.cards ?? []).filter(card => (
      normalizeSearch(card.targetName).includes(query)
      || normalizeSearch(meta(card.targetType).label).includes(query)
    ));
  }, [cardSearch, currentProjection?.cards]);

  const handleSurfaceKeyDown = (event: KeyboardEvent<HTMLButtonElement>, current: Surface) => {
    let next: Surface | null = null;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      next = current === 'knowledge' ? 'memories' : 'knowledge';
    } else if (event.key === 'Home') {
      next = 'knowledge';
    } else if (event.key === 'End') {
      next = 'memories';
    }
    if (!next) return;
    event.preventDefault();
    setSurface(next);
    document.getElementById(`${next}-surface-tab`)?.focus();
  };

  const reload = async (options?: { cardIdToSelect?: string; preserveSelection?: boolean }) => {
    const requestScope = projectionScope;
    if (requestScope !== projectionScopeRef.current) return false;
    const requestId = ++projectionRequestRef.current;
    try {
      const result = await api.getWorldbuildSubjectKnowledge(workspaceId, entity.id);
      if (requestScope !== projectionScopeRef.current) return false;
      if (requestId !== projectionRequestRef.current) return true;
      if (!result.success || !result.projection) throw new Error(result.error || 'Could not load Knowledge.');
      setProjection(result.projection);
      setSelectedCard(current => {
        const selectedCardId = options?.cardIdToSelect ?? (options?.preserveSelection === false ? undefined : current?.cardId);
        return selectedCardId
          ? result.projection?.cards.find(card => card.cardId === selectedCardId) ?? null
          : null;
      });
      return true;
    } catch (error) {
      if (requestScope !== projectionScopeRef.current) return false;
      if (requestId !== projectionRequestRef.current) return true;
      throw error;
    } finally {
      if (requestId === projectionRequestRef.current && requestScope === projectionScopeRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    const requestId = ++projectionRequestRef.current;
    const requestScope = projectionScope;
    setLoading(true);
    setProjection(null);
    setSelectedCard(null);
    setDeletingCard(null);
    setAddingCard(false);
    setCardSearch('');
    api.getWorldbuildSubjectKnowledge(workspaceId, entity.id).then(result => {
      if (!active || requestId !== projectionRequestRef.current || requestScope !== projectionScopeRef.current) return;
      if (result.success && result.projection) setProjection(result.projection);
      else showToast(result.error || 'Could not load Knowledge.', 'error');
      setLoading(false);
    }).catch(error => {
      if (!active || requestId !== projectionRequestRef.current || requestScope !== projectionScopeRef.current) return;
      showToast(error instanceof Error ? error.message : 'Could not load Knowledge.', 'error');
      setLoading(false);
    });
    return () => { active = false; };
  }, [api, entity.id, projectionScope, showToast, workspaceId]);

  // Read once per sheet rather than per card: the audience picker, the recipient counts
  // and the note about inherited Knowledge all answer from the same set of memberships.
  useEffect(() => {
    let active = true;
    api.listEntityLinks(workspaceId, 'member_of').then(result => {
      if (!active) return;
      setMemberships(result.success ? result.links ?? [] : []);
    }).catch(() => {
      if (active) setMemberships([]);
    });
    return () => { active = false; };
  }, [api, entity.id, workspaceId]);

  const addCard = async (targetId: string) => {
    const mutationScope = projectionScope;
    const result = await api.ensureWorldbuildAwareness({
      workspaceId, ownerId: entity.id, targetId, sourceType: 'manual', sourceId: crypto.randomUUID(),
      audienceType: entity.type === 'Factions' ? 'all-members' : undefined,
    });
    if (mutationScope !== projectionScopeRef.current) return;
    if (!result.success) throw new Error(result.error || 'Could not create the Knowledge card.');
    const reloaded = await reload({ cardIdToSelect: result.card?.cardId });
    if (!reloaded) return;
    setAddingCard(false);
  };

  const removeCard = async () => {
    if (!deletingCard) return;
    const mutationScope = projectionScope;
    const result = await api.removeWorldbuildKnowledgeCard({
      workspaceId, ownerId: entity.id, targetId: deletingCard.targetId,
    });
    if (mutationScope !== projectionScopeRef.current) return;
    if (!result.success) {
      showToast(result.error || 'Could not remove the Knowledge card.', 'error');
      return;
    }
    const reloaded = await reload({ preserveSelection: false });
    if (!reloaded) return;
    setDeletingCard(null);
    setSelectedCard(null);
    showToast('Knowledge card removed.', 'success');
  };

  return (
    <section className="ws-card space-y-3 rounded-card border border-border-default bg-surface-panel-muted/60 p-4 backdrop-blur-md">
      <div className="flex flex-wrap items-center gap-2">
      <div role="tablist" aria-label="Knowledge views" aria-orientation="horizontal" className="inline-flex gap-1 rounded-control border border-border-default bg-surface-input p-1">
        <SurfaceButton id="knowledge-surface-tab" controls="knowledge-surface-panel" active={surface === 'knowledge'} onClick={() => setSurface('knowledge')} onKeyDown={event => handleSurfaceKeyDown(event, 'knowledge')} icon={KnowledgeGlyph} label="Subjects" count={currentProjection?.cards.length ?? 0} />
        <SurfaceButton id="memories-surface-tab" controls="memories-surface-panel" active={surface === 'memories'} onClick={() => setSurface('memories')} onKeyDown={event => handleSurfaceKeyDown(event, 'memories')} icon={Brain} label="Memories" count={currentProjection?.memories.length ?? 0} />
      </div>
      <span className="flex-1" />
      {surface === 'knowledge'
        ? <Button variant="ghost" size="sm" icon={Plus} onClick={() => setAddingCard(true)}>Add subject</Button>
        : <Button variant="ghost" size="sm" icon={Plus} onClick={() => setComposeSignal(value => value + 1)}>Add memory</Button>}
      </div>

      <div id="knowledge-surface-panel" role="tabpanel" aria-labelledby="knowledge-surface-tab" hidden={surface !== 'knowledge'} aria-busy={loading} className="space-y-3">
          <p className="flex gap-2 text-xs leading-relaxed text-text-muted">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-subtle" aria-hidden="true" />
            <span>
              {entity.type === 'Factions'
                ? <>Each card is something {entity.canonicalName} knows exists. What the group knows reaches its whole roster{roster.length ? `, ${roster.length} today` : ''}, unless a card names exceptions.</>
                : <>Each card is something {firstName(entity.canonicalName)} knows exists. Open it to choose what else {firstName(entity.canonicalName)} knows.<SharingRule entity={entity} factions={ownFactions} entities={entities} onOpenEntity={onOpenEntity} /></>}
            </span>
          </p>
          <div>
            <label className="relative block">
              <span className="sr-only">Search known subjects</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle" aria-hidden="true" />
              <input
                type="search"
                name="knowledge-card-search"
                autoComplete="off"
                value={cardSearch}
                onChange={event => setCardSearch(event.target.value)}
                placeholder="Search known subjects"
                className="wb-input field-input py-2 pl-9 pr-9 text-sm [&::-webkit-search-cancel-button]:hidden"
              />
              {cardSearch && (
                <button
                  type="button"
                  onClick={() => setCardSearch('')}
                  className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1.5 text-text-subtle transition-colors hover:bg-surface-hover/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 motion-reduce:transition-none"
                  aria-label="Clear Knowledge search"
                >
                  <X className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              )}
            </label>
          </div>
          <div className="custom-scrollbar grid max-h-[40rem] gap-2 overflow-y-auto overscroll-contain sm:grid-cols-2">
            {loading && <div className="col-span-full h-24 animate-pulse rounded-card bg-surface-panel-muted/60 motion-reduce:animate-none" />}
            {!loading && !currentProjection?.cards.length && <EmptyState text="No known subjects yet." onClick={() => setAddingCard(true)} />}
            {!loading && (currentProjection?.cards.length ?? 0) > 0 && !filteredCards.length && (
              <div className="col-span-full rounded-card border border-dashed border-border-subtle px-5 py-8 text-center text-sm text-text-muted">
                No known subjects match your search.
              </div>
            )}
            {filteredCards.map(card => {
              const known = currentProjection?.known.filter(entry => entry.aboutId === card.targetId).length ?? 0;
              const beliefs = currentProjection?.beliefs.filter(entry => entry.aboutId === card.targetId).length ?? 0;
              const typeMeta = meta(card.targetType);
              const TypeIcon = typeMeta.icon;
              return (
                <article key={card.cardId} className="group relative overflow-hidden rounded-card border border-border-subtle bg-surface-canvas/30 transition-colors duration-200 ease-standard hover:border-border-default hover:bg-surface-hover/35 focus-within:border-border-default motion-reduce:transition-none">
                  <button type="button" onClick={() => setSelectedCard(card)} className="flex w-full items-center gap-3 p-3 pr-10 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/50">
                    <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-control border ${typeMeta.medallion}`}>
                      <TypeIcon className="h-4.5 w-4.5" aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate text-xs font-semibold ${typeMeta.soft}`}>{typeMeta.label}</span>
                      <span className="block truncate text-sm font-semibold text-text-primary">{card.targetName}</span>
                    <CardStats
                      counts={[
                        { value: card.knownFieldKeys.length, label: 'fields' },
                        { value: card.knownRelationships.length, label: 'connections' },
                        { value: known, label: 'known' },
                        { value: beliefs, label: 'believed' },
                      ]}
                    />
                    </span>
                  </button>
                  <button type="button" onClick={() => setDeletingCard(card)} className="absolute right-2 top-2 rounded p-1.5 text-text-subtle transition-[color,background-color,opacity] hover:bg-status-danger/10 hover:text-status-danger focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger/50 motion-reduce:transition-none sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100" aria-label={`Remove Knowledge card for ${card.targetName}`}>
                    <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  </button>
                </article>
              );
            })}
          </div>
      </div>
      <Memories key={entity.id} hidden={surface !== 'memories'} loading={loading} workspaceId={workspaceId} owner={entity} projection={currentProjection} api={api} reload={reload} showToast={showToast} calendar={calendar} clock={clock} onOpenEntity={onOpenEntity} composeSignal={composeSignal} />

      {addingCard && <AddCardModal owner={entity} entities={entities} existing={currentProjection?.cards ?? []} onClose={() => setAddingCard(false)} onAdd={addCard} />}
      {selectedCard && currentProjection && (
        <KnowledgeCardModal
          workspaceId={workspaceId}
          owner={entity}
          card={selectedCard}
          entity={entities.find(item => item.id === selectedCard.targetId)}
          entities={entities}
          roster={roster}
          projection={currentProjection}
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
    </section>
  );
}

const firstName = (name: string) => String(name || '').trim().split(/\s+/)[0] || name;

type CardPane = 'access' | 'statements';
type CardSection = 'fields' | 'connections' | 'audience';
type Acquisition = NonNullable<WorldbuildKnowledgeEntry['acquisition']>;
interface StatementDraft {
  kind: 'knowledge' | 'belief';
  statement: string;
  category: DurableKnowledgeCategory;
  acquisition: Acquisition;
  informantIds: string[];
}

const emptyStatementDraft = (): StatementDraft => ({
  kind: 'knowledge', statement: '', category: 'world-lore', acquisition: 'witness', informantIds: [],
});

// Why a card exists, in words: the stored source types are internal keys.
const SOURCE_LABELS: Record<string, string> = {
  manual: 'you', relationship: 'a relationship', 'faction-membership': 'faction membership', inventory: 'their inventory',
  memory: 'a memory', narrative: 'the narrative state', fact: 'a fact', statement: 'a statement', import: 'an import',
};

/* The same sentence can be public lore or a secret; only the category tells them apart, and it is
   what the Narrative State filters on. */
const CATEGORY_HINTS: Record<DurableKnowledgeCategory, string> = {
  'world-lore': 'How the world, an institution, a material or a custom works.',
  identity: 'Who or what someone really is.',
  history: 'A past event and what happened in it.',
  secret: 'Concealed information whose exposure would change what people do.',
  capability: 'What a person, item, creature or technique can do.',
  intent: 'A plan, promise, threat or goal that outlives the scene.',
  bond: 'What the subject knows about a relationship between others.',
};

function normalizeDurableCategory(value: unknown): DurableKnowledgeCategory | undefined {
  const category = normalizeKnowledgeCategory(value);
  return category && (DURABLE_KNOWLEDGE_CATEGORIES as readonly string[]).includes(category)
    ? category as DurableKnowledgeCategory
    : undefined;
}

export function entryCategoryLabel(value: unknown): string | null {
  const knowledge = normalizeKnowledgeCategory(value);
  if (knowledge) return KNOWLEDGE_CATEGORY_LABELS[knowledge];
  const memory = normalizeMemoryCategory(value);
  return memory ? MEMORY_CATEGORY_LABELS[memory] : null;
}

/* Observed covers both first-hand methods, since the scene already says which. Inferred only comes
   from the Narrative State, so it is shown but never offered. */
const ACQUISITION_META: Record<Acquisition, { label: string; icon: typeof Eye; hint: string }> = {
  witness: { label: 'Observed', icon: Eye, hint: 'They found this out for themselves.' },
  participant: { label: 'Observed', icon: Eye, hint: 'They were part of it.' },
  reported: { label: 'Reported', icon: Ear, hint: 'Someone told them.' },
  inferred: { label: 'Inferred', icon: Lightbulb, hint: 'They worked it out from what they had.' },
};
const AUTHORED_ACQUISITIONS: Acquisition[] = ['witness', 'reported'];

function KnowledgeCardModal({ workspaceId, owner, card, entity, entities, roster, projection, api, reload, onClose, showToast }: {
  workspaceId: string;
  owner: WorldbuildEntity;
  card: WorldbuildKnowledgeCard;
  entity?: WorldbuildEntity;
  entities: WorldbuildEntity[];
  /** Ids currently on the owner's roster. Only meaningful while the owner is a Faction. */
  roster: string[];
  projection: WorldbuildKnowledgeProjection;
  api: WorldbuildApi;
  reload(options?: { cardIdToSelect?: string; preserveSelection?: boolean }): Promise<boolean>;
  onClose(): void;
  showToast: Toast;
}) {
  const [pane, setPane] = useState<CardPane>('access');
  const [openSection, setOpenSection] = useState<CardSection | null>('fields');
  const [definitions, setDefinitions] = useState<Array<{ key: string; label: string; aiAccess: string }>>([]);
  const [fieldKeys, setFieldKeys] = useState(card.knownFieldKeys);
  const [relationshipIds, setRelationshipIds] = useState(card.knownRelationships.map(item => item.relationshipId));
  const [draft, setDraft] = useState<StatementDraft>(emptyStatementDraft());
  const [editing, setEditing] = useState<WorldbuildKnowledgeEntry | null>(null);
  const [deleting, setDeleting] = useState<WorldbuildKnowledgeEntry | null>(null);
  const [saving, setSaving] = useState(false);
  const [savingFields, setSavingFields] = useState(false);
  const [savingRelationships, setSavingRelationships] = useState(false);
  const [savingAudience, setSavingAudience] = useState(false);
  const [audienceType, setAudienceType] = useState(card.audienceType);
  const [selectedMemberIds, setSelectedMemberIds] = useState(card.selectedMemberIds);
  const statementEditorRef = useRef<HTMLElement | null>(null);
  const statementInputRef = useRef<HTMLTextAreaElement | null>(null);
  const statements = [
    ...projection.known.filter(entry => entry.aboutId === card.targetId),
    ...projection.beliefs.filter(entry => entry.aboutId === card.targetId),
  ];
  const [kindFilter, setKindFilter] = useState<'all' | 'knowledge' | 'belief'>('all');
  const visibleStatements = kindFilter !== 'all'
    ? statements.filter(entry => entry.kind === kindFilter)
    : statements;
  const relationships = mergeRelationships(card.availableRelationships, card.knownRelationships);
  const typeMeta = meta(card.targetType);
  const TypeIcon = typeMeta.icon;
  const toggleSection = (section: CardSection) => setOpenSection(current => current === section ? null : section);

  useEffect(() => {
    setFieldKeys(card.knownFieldKeys);
    setRelationshipIds(card.knownRelationships.map(item => item.relationshipId));
    setAudienceType(card.audienceType);
    setSelectedMemberIds(card.selectedMemberIds);
  }, [card]);

  useEffect(() => {
    if (!editing) return;
    const frame = window.requestAnimationFrame(() => {
      const behavior = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 'auto' : 'smooth';
      statementInputRef.current?.focus({ preventScroll: true });
      statementEditorRef.current?.scrollIntoView({ behavior, block: 'nearest' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [editing]);

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

  const restoreFailedDetails = async (rollback: () => void) => {
    try {
      return await reload();
    } catch {
      rollback();
      return true;
    }
  };

  const refreshSavedDetails = async (label: string) => {
    try {
      return await reload();
    } catch {
      showToast(`${label} was saved, but Knowledge could not be refreshed. Reopen the card to confirm the latest state.`, 'error');
      return true;
    }
  };

  const saveFields = async (next: string[]) => {
    if (savingFields) return;
    const previous = [...fieldKeys];
    setFieldKeys(next);
    setSavingFields(true);
    let mutationCurrent = true;
    try {
      const result = await api.setWorldbuildKnownFields({
        workspaceId, ownerId: owner.id, targetId: card.targetId, fieldKeys: next,
      });
      if (!result.success) {
        const current = await restoreFailedDetails(() => setFieldKeys(previous));
        mutationCurrent = current;
        if (current) showToast(result.error || 'Could not update Known Fields.', 'error');
        return;
      }
      const current = await refreshSavedDetails('Known Fields');
      mutationCurrent = current;
      if (!current) return;
      setFieldKeys(result.card?.knownFieldKeys ?? next);
    } catch (error) {
      const current = await restoreFailedDetails(() => setFieldKeys(previous));
      mutationCurrent = current;
      if (current) showToast(error instanceof Error ? error.message : 'Could not update Known Fields.', 'error');
    } finally {
      if (mutationCurrent) setSavingFields(false);
    }
  };

  const markAll = async () => {
    if (savingFields) return;
    const previous = [...fieldKeys];
    setSavingFields(true);
    let mutationCurrent = true;
    try {
      const result = await api.markWorldbuildCurrentFieldsKnown({ workspaceId, ownerId: owner.id, targetId: card.targetId });
      if (!result.success || !result.card) {
        const current = await restoreFailedDetails(() => setFieldKeys(previous));
        mutationCurrent = current;
        if (current) showToast(result.error || 'Could not mark current fields as known.', 'error');
        return;
      }
      const current = await refreshSavedDetails('Known Fields');
      mutationCurrent = current;
      if (!current) return;
      setFieldKeys(result.card.knownFieldKeys);
    } catch (error) {
      const current = await restoreFailedDetails(() => setFieldKeys(previous));
      mutationCurrent = current;
      if (current) showToast(error instanceof Error ? error.message : 'Could not mark current fields as known.', 'error');
    } finally {
      if (mutationCurrent) setSavingFields(false);
    }
  };

  const saveRelationships = async (next: string[]) => {
    if (savingRelationships) return;
    const previous = [...relationshipIds];
    setRelationshipIds(next);
    setSavingRelationships(true);
    let mutationCurrent = true;
    try {
      const result = await api.setWorldbuildKnownRelationships({
        workspaceId, ownerId: owner.id, targetId: card.targetId, relationshipIds: next,
      });
      if (!result.success) {
        const current = await restoreFailedDetails(() => setRelationshipIds(previous));
        mutationCurrent = current;
        if (current) showToast(result.error || 'Could not update Known Relationships.', 'error');
        return;
      }
      const current = await refreshSavedDetails('Known Relationships');
      mutationCurrent = current;
      if (!current) return;
      setRelationshipIds(result.card?.knownRelationships.map(item => item.relationshipId) ?? next);
    } catch (error) {
      const current = await restoreFailedDetails(() => setRelationshipIds(previous));
      mutationCurrent = current;
      if (current) showToast(error instanceof Error ? error.message : 'Could not update Known Relationships.', 'error');
    } finally {
      if (mutationCurrent) setSavingRelationships(false);
    }
  };

  const saveStatement = async () => {
    if (!draft.statement.trim()) return;
    const wasEditing = Boolean(editing);
    setSaving(true);
    let mutationCurrent = true;
    try {
      const result = await api.saveWorldbuildSubjectEntry({
        workspaceId,
        subjectId: owner.id,
        kind: draft.kind,
        existingId: editing?.id,
        entry: {
          aboutId: card.targetId,
          statement: draft.statement.trim(),
          // First-hand acquisition is the more reliable of the two, so it carries the
          // higher confidence the extraction path already assigns for the same reason.
          confidence: draft.kind === 'knowledge' && draft.acquisition !== 'reported' ? 0.95 : 0.75,
          accessibility: 'available',
          category: draft.category,
          acquisition: draft.acquisition,
          informantIds: draft.acquisition === 'reported' ? draft.informantIds : [],
        },
      });
      if (!result.success) {
        try {
          mutationCurrent = await reload();
        } catch {
          mutationCurrent = true;
        }
        if (mutationCurrent) showToast(result.error || 'Could not save the Statement.', 'error');
        return;
      }
      let refreshed = true;
      try {
        mutationCurrent = await reload();
      } catch {
        refreshed = false;
      }
      if (!mutationCurrent) return;
      setDraft(emptyStatementDraft());
      setEditing(null);
      showToast(
        refreshed
          ? wasEditing ? 'Statement updated.' : 'Statement added.'
          : 'Statement was saved, but Knowledge could not be refreshed. Reopen the card to confirm the latest state.',
        refreshed ? 'success' : 'error',
      );
    } catch (error) {
      try {
        mutationCurrent = await reload();
      } catch {
        mutationCurrent = true;
      }
      if (mutationCurrent) showToast(error instanceof Error ? error.message : 'Could not save the Statement.', 'error');
    } finally {
      if (mutationCurrent) setSaving(false);
    }
  };

  const startEditing = (entry: WorldbuildKnowledgeEntry) => {
    setPane('statements');
    setEditing(entry);
    setDraft({
      kind: entry.kind as 'knowledge' | 'belief',
      statement: entry.statement || '',
      // An entry written before categories existed opens on the neutral one rather than on
      // nothing, so saving it does not silently invent a classification the author skipped.
      category: normalizeDurableCategory(entry.category) ?? 'world-lore',
      // A record the Narrative State wrote as inferred has no authored equivalent, so the
      // editor opens on the nearest thing an author can express rather than on nothing.
      acquisition: entry.acquisition === 'reported' ? 'reported' : 'witness',
      informantIds: entry.informantIds ?? [],
    });
  };

  const cancelEditing = () => {
    setEditing(null);
    setDraft(emptyStatementDraft());
  };

  const removeStatement = async () => {
    if (!deleting) return;
    const entry = deleting;
    try {
      const result = await api.deleteWorldbuildSubjectEntry({
        workspaceId, subjectId: owner.id, kind: entry.kind, entryId: entry.id,
      });
      if (!result.success) {
        const current = await restoreFailedDetails(() => undefined);
        if (current) showToast(result.error || 'Could not delete the Statement.', 'error');
        return;
      }
      let current = true;
      let refreshed = true;
      try {
        current = await reload();
      } catch {
        refreshed = false;
      }
      if (!current) return;
      if (editing?.id === entry.id) cancelEditing();
      setDeleting(null);
      showToast(
        refreshed
          ? 'Statement deleted.'
          : 'Statement was deleted, but Knowledge could not be refreshed. Reopen the card to confirm the latest state.',
        refreshed ? 'success' : 'error',
      );
    } catch (error) {
      let current = true;
      try {
        current = await reload();
      } catch {
        current = true;
      }
      if (current) showToast(error instanceof Error ? error.message : 'Could not delete the Statement.', 'error');
    }
  };

  const saveAudience = async (nextType: 'all-members' | 'selected-members', nextMembers = selectedMemberIds) => {
    if (savingAudience) return;
    const previousType = audienceType;
    const previousMembers = [...selectedMemberIds];
    setAudienceType(nextType);
    setSelectedMemberIds(nextMembers);
    setSavingAudience(true);
    let mutationCurrent = true;
    try {
      const result = await api.setWorldbuildKnowledgeAudience({
        workspaceId,
        ownerId: owner.id,
        targetId: card.targetId,
        audienceType: nextType,
        memberIds: nextMembers,
      });
      if (!result.success) {
        const current = await restoreFailedDetails(() => {
          setAudienceType(previousType);
          setSelectedMemberIds(previousMembers);
        });
        mutationCurrent = current;
        if (current) showToast(result.error || 'Could not update the faction audience.', 'error');
        return;
      }
      const current = await refreshSavedDetails('Faction audience');
      mutationCurrent = current;
      if (!current) return;
      setAudienceType(result.card?.audienceType ?? nextType);
      setSelectedMemberIds(result.card?.selectedMemberIds ?? nextMembers);
    } catch (error) {
      const current = await restoreFailedDetails(() => {
        setAudienceType(previousType);
        setSelectedMemberIds(previousMembers);
      });
      mutationCurrent = current;
      if (current) showToast(error instanceof Error ? error.message : 'Could not update the faction audience.', 'error');
    } finally {
      if (mutationCurrent) setSavingAudience(false);
    }
  };

  return (
    <>
    <Modal onClose={onClose} closeOnEsc={!deleting} size="2xl" className="max-h-[calc(100vh-2rem)]"
      title={<><span className={`block text-xs font-semibold ${typeMeta.soft}`}>{typeMeta.label}</span>{card.targetName}</>}
      subtitle={`What ${owner.canonicalName} knows about it`}
      leading={<span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-card border ${typeMeta.medallion}`}><TypeIcon className="h-5 w-5" aria-hidden="true" /></span>}>
      <div className="px-4 pt-4 sm:px-5">
        {/* Two different questions, so two panes rather than one stack: what this
            perspective is allowed to read, and what it actually holds in its own words. */}
        <div role="tablist" aria-label="Knowledge card views" className="inline-flex gap-1 rounded-control border border-border-default bg-surface-input p-1">
          <PaneButton id="card-access-tab" controls="card-access-pane" active={pane === 'access'} onClick={() => setPane('access')} icon={Check} label="Access" count={fieldKeys.length + relationshipIds.length} />
          <PaneButton id="card-statements-tab" controls="card-statements-pane" active={pane === 'statements'} onClick={() => setPane('statements')} icon={BookOpenCheck} label="Statements" count={statements.length} />
        </div>
      </div>
      <div id="card-access-pane" role="tabpanel" aria-labelledby="card-access-tab" className="custom-scrollbar min-h-0 flex-1 overflow-y-auto px-4 pb-4 pt-2 sm:px-5" hidden={pane !== 'access'}>
        <KnowledgeSection
          id="knowledge-fields-section"
          open={openSection === 'fields'}
          onToggle={() => toggleSection('fields')}
          icon={Check}
          title="Known fields"
          description={`Which of ${card.targetName}'s filled fields this perspective can read.`}
          summary={definitions.length ? `${fieldKeys.length} of ${definitions.length}` : 'None filled'}
        >
          <div className="p-3 sm:p-4">
            {!definitions.length ? (
              <p className="text-xs text-text-subtle">No eligible fields are currently filled on this subject.</p>
            ) : (
              <>
                <BulkActions
                  selected={fieldKeys.length}
                  total={definitions.length}
                  busy={savingFields}
                  noun="field"
                  onAll={markAll}
                  onNone={() => saveFields([])}
                />
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {definitions.map(field => {
                    const checked = fieldKeys.includes(field.key);
                    return (
                      <button
                        key={field.key}
                        type="button"
                        aria-pressed={checked}
                        disabled={savingFields}
                        onClick={() => saveFields(checked ? fieldKeys.filter(key => key !== field.key) : [...fieldKeys, field.key])}
                        className={`flex min-h-10 items-center gap-2 rounded-control border px-3 py-2 text-left text-sm transition-colors duration-200 ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none ${checked ? 'border-border-strong bg-surface-hover/80 text-text-primary' : 'border-border-subtle bg-surface-input/45 text-text-muted hover:border-border-default hover:text-text-secondary'}`}
                      >
                        <span aria-hidden="true" className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? 'border-accent bg-accent text-on-accent' : 'border-border-strong'}`}>{checked && <Check className="h-3 w-3" />}</span>
                        {field.label}
                      </button>
                    );
                  })}
                </div>
              </>
            )}
          </div>
        </KnowledgeSection>

        <KnowledgeSection
          id="knowledge-connections-section"
          open={openSection === 'connections'}
          onToggle={() => toggleSection('connections')}
          icon={Link2}
          title="Known connections"
          description={`Which of ${card.targetName}'s ties this perspective knows about. What a tie is privately called stays hidden.`}
          summary={relationships.length ? `${relationshipIds.length} of ${relationships.length}` : 'None available'}
        >
          <KnownConnections
            subjectId={card.targetId}
            subjectName={card.targetName}
            relationships={relationships}
            currentIds={card.availableRelationships.map(item => item.relationshipId)}
            selectedIds={relationshipIds}
            entities={entities}
            busy={savingRelationships}
            onChange={saveRelationships}
          />
        </KnowledgeSection>

        {owner.type === 'Factions' && (
          <KnowledgeSection
            id="knowledge-audience-section"
            open={openSection === 'audience'}
            onToggle={() => toggleSection('audience')}
            icon={Users}
            title="Shared with"
            description={`Who inside ${owner.canonicalName} reads this perspective in play.`}
            summary={audienceSummary(audienceType, selectedMemberIds.length, roster.length)}
          >
            <FactionAudience
              roster={roster}
              entities={entities}
              audienceType={audienceType}
              selectedMemberIds={selectedMemberIds}
              busy={savingAudience}
              onChange={saveAudience}
            />
          </KnowledgeSection>
        )}

        {card.sources.length > 0 && <p className="mt-2 flex gap-2 border-t border-border-subtle pt-3 text-xs text-text-muted"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-subtle" aria-hidden="true" />Known through {[...new Set(card.sources.map(source => SOURCE_LABELS[source.sourceType] ?? 'another record'))].join(', ')}</p>}
      </div>

      <div id="card-statements-pane" role="tabpanel" aria-labelledby="card-statements-tab" className="custom-scrollbar min-h-0 flex-1 space-y-4 overflow-y-auto p-3 sm:p-5" hidden={pane !== 'statements'}>
        <section ref={statementEditorRef} aria-labelledby="statement-editor-heading" className="card-surface p-3 sm:p-4">
          <div className="mb-4 flex flex-wrap items-center gap-3">
            <h4 id="statement-editor-heading" className="text-sm font-semibold text-text-primary">{editing ? 'Edit statement' : 'New statement'}</h4>
            <span className="flex-1" />
            <div role="radiogroup" aria-label="Known or believed" className="inline-flex gap-1 rounded-control border border-border-default bg-surface-input p-1">
              {(['knowledge', 'belief'] as const).map(kind => (
                <button
                  key={kind}
                  type="button"
                  role="radio"
                  aria-checked={draft.kind === kind}
                  disabled={Boolean(editing)}
                  onClick={() => setDraft(current => ({ ...current, kind }))}
                  className={`inline-flex min-h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 motion-reduce:transition-none ${draft.kind === kind ? 'bg-surface-hover text-text-primary ring-1 ring-inset ring-border-strong' : 'text-text-muted hover:text-text-secondary'} disabled:cursor-not-allowed disabled:opacity-60`}
                >
                  {kind === 'knowledge' ? <Check className="h-3.5 w-3.5" aria-hidden="true" /> : <Lightbulb className="h-3.5 w-3.5" aria-hidden="true" />}
                  {kind === 'knowledge' ? 'Known' : 'Believed'}
                </button>
              ))}
            </div>
          </div>

          <fieldset className="mb-4">
            <legend className="mb-1.5 text-xs font-medium text-text-muted">Kind</legend>
            <div className="flex flex-wrap gap-1.5">
              {DURABLE_KNOWLEDGE_CATEGORIES.map(category => (
                <button
                  key={category}
                  type="button"
                  aria-pressed={draft.category === category}
                  data-tooltip={CATEGORY_HINTS[category]}
                  onClick={() => setDraft(current => ({ ...current, category }))}
                  className={`min-h-8 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 motion-reduce:transition-none ${draft.category === category ? 'border-border-strong bg-surface-hover text-text-primary' : 'border-border-subtle text-text-muted hover:bg-surface-hover/60 hover:text-text-secondary'}`}
                >
                  {KNOWLEDGE_CATEGORY_LABELS[category]}
                </button>
              ))}
            </div>
            <p className="caption mt-1.5">{CATEGORY_HINTS[draft.category]}</p>
          </fieldset>

          {/* Only Known carries a route. A belief is what the subject holds regardless of
              where it came from, and forcing a source onto one would invent a witness. */}
          {draft.kind === 'knowledge' && (
            <AcquisitionPicker
              owner={owner}
              entities={entities}
              acquisition={draft.acquisition}
              informantIds={draft.informantIds}
              onChange={patch => setDraft(current => ({ ...current, ...patch }))}
            />
          )}

          <label htmlFor="knowledge-statement" className="mb-1.5 mt-4 block text-xs font-medium text-text-muted">Statement</label>
          <textarea ref={statementInputRef} id="knowledge-statement" className={`${INPUT} custom-scrollbar min-h-28 max-h-48 resize-none overflow-y-auto leading-relaxed`} value={draft.statement} onChange={event => setDraft(current => ({ ...current, statement: event.target.value }))} placeholder="Add a specific statement about this subject" />
          <div className="mt-3 flex justify-end gap-2">
            <Button variant="ghost" onClick={cancelEditing} disabled={saving || (!editing && !draft.statement.trim())}>{editing ? 'Cancel' : 'Clear'}</Button>
            <Button onClick={saveStatement} loading={saving} disabled={!draft.statement.trim()}>{editing ? 'Save changes' : 'Add statement'}</Button>
          </div>
        </section>

        <section aria-labelledby="recorded-statements-heading">
          <div className="mb-1 flex flex-wrap items-center gap-2 border-b border-border-subtle pb-3">
            <h4 id="recorded-statements-heading" className="text-sm font-semibold text-text-primary">Recorded</h4>
            <span className="text-xs tabular-nums text-text-subtle">{statements.length}</span>
            <span className="flex-1" />
            <div role="radiogroup" aria-label="Show statements" className="inline-flex gap-1 rounded-control border border-border-default bg-surface-input p-1">
              {([['all', 'All'], ['knowledge', 'Known'], ['belief', 'Believed']] as const).map(([value, text]) => (
                <button key={value} type="button" role="radio" aria-checked={kindFilter === value} onClick={() => setKindFilter(value)}
                  className={`min-h-7 rounded-md px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${kindFilter === value ? 'bg-surface-hover text-text-primary ring-1 ring-inset ring-border-strong' : 'text-text-muted hover:text-text-primary'}`}>{text}</button>
              ))}
            </div>
          </div>
          <div className="divide-y divide-border-subtle">
            {visibleStatements.map(entry => (
              <Statement
                key={entry.id}
                entry={entry}
                entities={entities}
                onEdit={entry.managed ? undefined : () => startEditing(entry)}
                onDelete={entry.managed ? undefined : () => setDeleting(entry)}
              />
            ))}
            {!statements.length && <p className="rounded-card border border-dashed border-border-subtle px-4 py-8 text-center text-xs text-text-subtle">No statements recorded.</p>}
            {Boolean(statements.length) && !visibleStatements.length && <p className="rounded-card border border-dashed border-border-subtle px-4 py-8 text-center text-xs text-text-subtle">No statements of this kind.</p>}
          </div>
        </section>
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

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick(): void }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`min-h-8 rounded-full border px-2.5 py-1 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 motion-reduce:transition-none ${active ? 'border-border-strong bg-surface-hover text-text-primary' : 'border-border-subtle text-text-muted hover:bg-surface-hover/60 hover:text-text-secondary'}`}
    >
      {label}
    </button>
  );
}

function mergeRelationships(current: WorldbuildKnownRelationship[], known: WorldbuildKnownRelationship[]) {
  const byId = new Map<string, WorldbuildKnownRelationship>();
  for (const relationship of [...current, ...known]) byId.set(relationship.relationshipId, relationship);
  return [...byId.values()];
}

/* What was told can be wrong or a lie; recording the teller lets a scene trace a rumour back. */
function AcquisitionPicker({ owner, entities, acquisition, informantIds, onChange }: {
  owner: WorldbuildEntity;
  entities: WorldbuildEntity[];
  acquisition: Acquisition;
  informantIds: string[];
  onChange(patch: Partial<StatementDraft>): void;
}) {
  const options = useMemo(() => entities
    .filter(item => item.id !== owner.id && item.status !== 'proposed' && canInform(item))
    .map(item => ({ id: item.id, label: item.canonicalName, aliases: item.aliases, group: meta(item.type).label })),
    [entities, owner.id]);
  return (
    <>
      <fieldset>
        <legend className="mb-1.5 text-xs font-medium text-text-muted">How they learned it</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {AUTHORED_ACQUISITIONS.map(value => {
            const state = ACQUISITION_META[value];
            const StateIcon = state.icon;
            const selected = acquisition === value || (value === 'witness' && acquisition === 'participant');
            return (
              <button
                key={value}
                type="button"
                aria-pressed={selected}
                onClick={() => onChange({ acquisition: value, ...(value === 'reported' ? {} : { informantIds: [] }) })}
                className={`rounded-card border p-3 text-left transition-colors duration-200 ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 motion-reduce:transition-none ${selected ? 'border-border-strong bg-surface-hover/80 text-text-primary' : 'border-border-subtle bg-surface-input/45 text-text-muted hover:border-border-default hover:text-text-secondary'}`}
              >
                <span className="flex items-center gap-2 text-xs font-semibold"><StateIcon className="h-4 w-4" aria-hidden="true" />{state.label}</span>
                <span className="mt-1.5 block text-xs leading-relaxed opacity-75">{state.hint}</span>
              </button>
            );
          })}
        </div>
      </fieldset>
      {acquisition === 'reported' && (
        <div className="mt-3">
          <label className="mb-1.5 block text-xs font-medium text-text-muted">Told by</label>
          <SearchableSelect
            multiple
            values={informantIds}
            onChange={(next: string[]) => onChange({ informantIds: next })}
            options={options}
            ariaLabel="Who reported this to the subject"
            placeholder="Name who told them"
          />
          <p className="caption mt-1.5">
            {owner.type === 'Factions'
              ? 'A group usually learns through one of its own. Naming them keeps the report traceable.'
              : 'Optional, but naming the source lets the story hold them to it later.'}
            {' '}Whoever is named here becomes someone {owner.canonicalName} is aware of.
          </p>
        </div>
      )}
    </>
  );
}

/** Only someone with a perspective of their own can pass something on. */
function canInform(entity: WorldbuildEntity): boolean {
  return entity.type === 'Characters'
    || entity.type === 'Factions'
    || (entity.type === 'Creatures' && String(entity.data?.scope ?? 'individual') !== 'group');
}

function PaneButton({ id, controls, active, onClick, icon: Icon, label, count }: {
  id: string; controls: string; active: boolean; onClick(): void;
  icon: typeof Check; label: string; count: number;
}) {
  return (
    <button
      id={id}
      type="button"
      role="tab"
      aria-selected={active}
      aria-controls={controls}
      tabIndex={active ? 0 : -1}
      onClick={onClick}
      className={`flex min-h-9 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 motion-reduce:transition-none ${active ? 'bg-surface-hover text-text-primary shadow-sm' : 'text-text-muted hover:text-text-secondary'}`}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {label}
      {count > 0 && <span className="rounded-full bg-surface-canvas/60 px-1.5 py-0.5 text-xs tabular-nums">{count}</span>}
    </button>
  );
}

interface OrientedRelationship {
  relationshipId: string;
  counterpartId: string;
  counterpartName: string;
  counterpartType: string;
  verb: string;
}

/** One tie read outward from the card's subject: what they are to the other party. */
function orient(relationship: WorldbuildKnownRelationship, subjectId: string, typeById: Map<string, string>): OrientedRelationship {
  const outgoing = relationship.fromId === subjectId;
  const counterpartId = outgoing ? relationship.toId : relationship.fromId;
  // A related_to edge carries a private title ("the brother who left", "rival"). Knowing a
  // tie exists is not knowing what it is called, so those rows keep the neutral wording.
  const authored = relationship.relationType === 'related_to' ? '' : relationship.relationLabel?.trim() ?? '';
  const fallback = outgoing
    ? RELATION_LABELS[relationship.relationType]
    : INVERSE_RELATION_LABELS[relationship.relationType] ?? RELATION_LABELS[relationship.relationType];
  return {
    relationshipId: relationship.relationshipId,
    counterpartId,
    counterpartName: outgoing ? relationship.toName : relationship.fromName,
    counterpartType: typeById.get(counterpartId) ?? '',
    verb: authored || fallback || relationship.relationType.replace(/_/g, ' '),
  };
}

/* Ties told the way the subject would tell them: the subject's name is dropped, leaving the other
   party and the verb, grouped by what that party is. */
function KnownConnections({ subjectId, subjectName, relationships, currentIds, selectedIds, entities, busy, onChange }: {
  subjectId: string;
  subjectName: string;
  relationships: WorldbuildKnownRelationship[];
  currentIds: string[];
  selectedIds: string[];
  entities: WorldbuildEntity[];
  busy: boolean;
  onChange(next: string[]): void;
}) {
  const [query, setQuery] = useState('');
  const typeById = useMemo(() => new Map(entities.map(item => [item.id, item.type])), [entities]);
  const current = useMemo(() => new Set(currentIds), [currentIds]);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const groups = useMemo(() => {
    const needle = normalizeSearch(query);
    const rows = relationships
      .map(relationship => orient(relationship, subjectId, typeById))
      .filter(row => !needle
        || normalizeSearch(row.counterpartName).includes(needle)
        || normalizeSearch(row.verb).includes(needle));
    const byType = new Map<string, OrientedRelationship[]>();
    for (const row of rows) byType.set(row.counterpartType, [...(byType.get(row.counterpartType) ?? []), row]);
    return [...byType.entries()]
      .map(([type, items]) => ({
        type,
        rows: [...items].sort((a, b) => a.counterpartName.localeCompare(b.counterpartName)),
      }))
      .sort((a, b) => typeRank(a.type) - typeRank(b.type));
  }, [query, relationships, subjectId, typeById]);

  const setMany = (ids: string[], include: boolean) => {
    if (include) onChange([...new Set([...selectedIds, ...ids])]);
    else {
      const dropping = new Set(ids);
      onChange(selectedIds.filter(id => !dropping.has(id)));
    }
  };

  if (!relationships.length) {
    return (
      <div className="p-3 sm:p-4">
        <p className="rounded-card border border-dashed border-border-subtle px-4 py-8 text-center text-xs text-text-subtle">
          {subjectName} has no ties recorded yet. Add them on the subject&apos;s own Connections tab.
        </p>
      </div>
    );
  }

  return (
    <div className="p-3 sm:p-4">
      <BulkActions
        selected={selectedIds.length}
        total={relationships.length}
        busy={busy}
        noun="connection"
        onAll={() => setMany(relationships.map(item => item.relationshipId), true)}
        onNone={() => onChange([])}
      />
      {relationships.length > 8 && (
        <label className="relative mt-3 block">
          <span className="sr-only">Filter connections</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-text-subtle" aria-hidden="true" />
          <input
            type="search"
            autoComplete="off"
            value={query}
            onChange={event => setQuery(event.target.value)}
            placeholder="Filter by name or connection…"
            className="wb-input field-input py-2 pl-9 pr-3 text-sm [&::-webkit-search-cancel-button]:hidden"
          />
        </label>
      )}
      <div className="mt-3 space-y-4">
        {groups.map(group => {
          const groupMeta = meta(group.type);
          const GroupIcon = groupMeta.icon;
          // A tie can outlive the entity at its other end; those rows still belong somewhere.
          const groupLabel: string = groupMeta.label || 'Other';
          const ids = group.rows.map(row => row.relationshipId);
          const chosen = ids.filter(id => selected.has(id)).length;
          const all = chosen === ids.length;
          return (
            <section key={group.type || 'other'} aria-label={groupLabel}>
              <div className="mb-2 flex items-center gap-2">
                <span aria-hidden="true" className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-md border ${groupMeta.medallion}`}>
                  <GroupIcon className="h-3 w-3" />
                </span>
                <span className={`text-xs font-semibold ${groupMeta.soft}`}>{groupLabel}</span>
                <span className="text-xs tabular-nums text-text-subtle">{chosen}/{ids.length}</span>
                <span aria-hidden="true" className="h-px flex-1 bg-border-subtle" />
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => setMany(ids, !all)}
                  className="rounded px-1.5 py-0.5 text-xs text-text-subtle transition-colors hover:bg-surface-hover/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none"
                >
                  {all ? 'Clear' : 'Select all'}
                </button>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {group.rows.map(row => {
                  const checked = selected.has(row.relationshipId);
                  return (
                    <button
                      key={row.relationshipId}
                      type="button"
                      aria-pressed={checked}
                      disabled={busy}
                      onClick={() => setMany([row.relationshipId], !checked)}
                      className={`flex min-h-12 items-start gap-2.5 rounded-control border px-3 py-2 text-left transition-colors duration-200 ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-wait disabled:opacity-60 motion-reduce:transition-none ${checked ? 'border-border-strong bg-surface-hover/80' : 'border-border-subtle bg-surface-input/45 hover:border-border-default'}`}
                    >
                      <span aria-hidden="true" className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? 'border-accent bg-accent text-on-accent' : 'border-border-strong'}`}>{checked && <Check className="h-3 w-3" />}</span>
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate text-sm font-medium ${checked ? 'text-text-primary' : 'text-text-secondary'}`}>{row.counterpartName}</span>
                        <span className="mt-0.5 block truncate text-xs text-text-muted">{row.verb}</span>
                        {!current.has(row.relationshipId) && <span className="mt-0.5 block text-xs text-status-warning/80">No longer current in canon</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            </section>
          );
        })}
        {!groups.length && (
          <p className="rounded-card border border-dashed border-border-subtle px-4 py-8 text-center text-xs text-text-subtle">
            No connections match your filter.
          </p>
        )}
      </div>
    </div>
  );
}

function audienceSummary(audienceType: 'all-members' | 'selected-members', chosen: number, total: number): string {
  if (audienceType === 'all-members') return total ? `All ${total} members` : 'All members';
  // A restricted card with nobody on it reaches no one at all. Saying "0 of 3" reads like a
  // count waiting to be filled, when it is really a card that does nothing.
  if (!chosen) return 'Nobody';
  return total ? `${chosen} of ${total} members` : `${chosen} chosen`;
}

/* Restricting seeds the whole roster, so the author removes who is out of the loop rather than
   naming who is in. Someone named who has since left stays visible. */
function FactionAudience({ roster, entities, audienceType, selectedMemberIds, busy, onChange }: {
  roster: string[];
  entities: WorldbuildEntity[];
  audienceType: 'all-members' | 'selected-members';
  selectedMemberIds: string[];
  busy: boolean;
  onChange(next: 'all-members' | 'selected-members', memberIds?: string[]): void;
}) {
  const byId = useMemo(() => new Map(entities.map(item => [item.id, item])), [entities]);
  const options = useMemo(() => {
    const onRoster = new Set(roster);
    const toOption = (id: string, description?: string) => {
      const member = byId.get(id);
      return member ? [{ id, label: member.canonicalName, aliases: member.aliases, description }] : [];
    };
    return [
      ...roster.flatMap(id => toOption(id)),
      ...selectedMemberIds.filter(id => !onRoster.has(id)).flatMap(id => toOption(id, 'No longer a member')),
    ];
  }, [byId, roster, selectedMemberIds]);

  // Stored as who receives it; shown as who is left out, which is the question people ask.
  const excluded = roster.filter(id => !selectedMemberIds.includes(id));
  const readers = audienceType === 'all-members' ? roster.length : selectedMemberIds.filter(id => roster.includes(id)).length;
  return (
    <div className="space-y-3 pl-6">
      {!roster.length && (
        <p className="rounded-card border border-dashed border-border-subtle px-4 py-6 text-center text-xs text-text-subtle">
          Nobody is on the roster yet. Add members on the faction&apos;s Members tab and this perspective reaches them.
        </p>
      )}
      <div role="radiogroup" aria-label="Shared with" className="inline-flex gap-1 rounded-control border border-border-default bg-surface-input p-1">
        {([['all-members', 'Every member', Users], ['selected-members', 'Every member except…', UserMinus]] as const).map(([value, label, Icon]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={audienceType === value}
            disabled={busy || !roster.length}
            onClick={() => onChange(value, value === 'selected-members' && !selectedMemberIds.length ? roster : undefined)}
            className={`inline-flex min-h-8 items-center gap-1.5 rounded-md px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none ${audienceType === value ? 'bg-surface-hover text-text-primary ring-1 ring-inset ring-border-strong' : 'text-text-muted hover:text-text-secondary'}`}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}
          </button>
        ))}
      </div>
      {audienceType === 'selected-members' && roster.length > 0 && (
        <SearchableSelect
          multiple
          values={excluded}
          disabled={busy}
          onChange={(left: string[]) => onChange('selected-members', roster.filter(id => !left.includes(id)))}
          options={options.filter(option => roster.includes(option.id))}
          ariaLabel="Members left out"
          placeholder="Add members to leave out"
        />
      )}
      {roster.length > 0 && (
        <p className="caption">
          {readers === 0
            ? 'Nobody on the roster reads this in play. Switch back to Every member, or leave fewer people out.'
            : audienceType === 'all-members'
              ? `In play, all ${roster.length} ${roster.length === 1 ? 'member reads' : 'members read'} this. Anyone who joins later reads it too; anyone who leaves keeps what they knew.`
              : `In play, the other ${readers} ${readers === 1 ? 'member reads' : 'members read'} this. Anyone who leaves keeps what they knew.`}
        </p>
      )}
    </div>
  );
}

/* The direction is the part that is easy to get backwards, so the sheet says it outright
   on both sides of the relationship rather than leaving it to be inferred from behavior. */
function SharingRule({ entity, factions, entities, onOpenEntity }: {
  entity: WorldbuildEntity; factions: string[]; entities: WorldbuildEntity[];
  onOpenEntity?(entityId: string, options?: { tab?: string }): void;
}) {
  const found = factions.map(id => entities.find(item => item.id === id)).filter((item): item is WorldbuildEntity => Boolean(item));
  if (!found.length) return null;
  return (
    <>
      {' '}In play {firstName(entity.canonicalName)} also reads what{' '}
      {found.map((faction, index) => (
        <Fragment key={faction.id}>
          {index > 0 && (index === found.length - 1 ? ' and ' : ', ')}
          <button type="button" onClick={() => onOpenEntity?.(faction.id, { tab: 'knowledge' })}
            className="rounded font-medium text-text-secondary underline decoration-border-strong underline-offset-2 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">{faction.canonicalName}</button>
        </Fragment>
      ))}
      {' '}{found.length > 1 ? 'share' : 'shares'}.
    </>
  );
}

function BulkActions({ selected, total, busy, noun, onAll, onNone }: {
  selected: number; total: number; busy: boolean; noun: string; onAll(): void; onNone(): void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
      <span className="text-xs text-text-muted">
        <span className="font-semibold tabular-nums text-text-secondary">{selected}</span> of {total} {noun}{total === 1 ? '' : 's'} known
      </span>
      <span aria-hidden="true" className="h-px flex-1 bg-border-subtle" />
      <span className="flex shrink-0 gap-1">
        <Button variant="ghost" size="sm" onClick={onAll} disabled={busy || selected === total}>Select all</Button>
        <Button variant="ghost" size="sm" onClick={onNone} disabled={busy || !selected}>Clear</Button>
      </span>
    </div>
  );
}

function typeRank(type: string): number {
  const index = TYPE_ORDER.indexOf(type);
  return index < 0 ? TYPE_ORDER.length : index;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

type MemoryDraft = { summary: string; accessibility: MemoryAccessibility; occurredOn: WorldDateValue | null };
const EMPTY_MEMORY: MemoryDraft = { summary: '', accessibility: 'available', occurredOn: null };

function Memories({ hidden, loading, workspaceId, owner, projection, api, reload, showToast, calendar, clock, onOpenEntity, composeSignal = 0 }: {
  hidden: boolean; loading: boolean; composeSignal?: number;
  calendar: Record<string, any> | null; clock: WorldDateValue | null;
  workspaceId: string; owner: WorldbuildEntity; projection: WorldbuildKnowledgeProjection | null;
  api: WorldbuildApi; reload(options?: { cardIdToSelect?: string; preserveSelection?: boolean }): Promise<boolean>; showToast: Toast;
  onOpenEntity?(entityId: string, options?: { tab?: string }): void;
}) {
  const [draft, setDraft] = useState<MemoryDraft>(EMPTY_MEMORY);
  const [editing, setEditing] = useState<WorldbuildKnowledgeEntry | null>(null);
  const [composing, setComposing] = useState(false);
  const [deleting, setDeleting] = useState<WorldbuildKnowledgeEntry | null>(null);
  const [saving, setSaving] = useState(false);
  const memoryEditorRef = useRef<HTMLDivElement | null>(null);
  const memoryInputRef = useRef<HTMLTextAreaElement | null>(null);
  const composerOpen = composing || Boolean(editing);
  const [filter, setFilter] = useState<MemoryAccessibility | 'all'>('all');
  const name = firstName(owner.canonicalName);
  useEffect(() => {
    if (!composeSignal) return;
    setEditing(null);
    setDraft(EMPTY_MEMORY);
    setComposing(true);
  }, [composeSignal]);

  useEffect(() => {
    if (!composerOpen) return;
    const frame = window.requestAnimationFrame(() => {
      const behavior = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ? 'auto' : 'smooth';
      memoryInputRef.current?.focus({ preventScroll: true });
      memoryEditorRef.current?.scrollIntoView({ behavior, block: 'nearest' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [composerOpen]);

  const reconcileCurrentScope = async () => {
    try {
      return await reload();
    } catch {
      return true;
    }
  };

  const save = async () => {
    setSaving(true);
    const wasEditing = Boolean(editing);
    let mutationCurrent = true;
    try {
      const result = await api.saveWorldbuildSubjectEntry({
        workspaceId,
        subjectId: owner.id,
        kind: 'memory',
        existingId: editing?.id,
        entry: { summary: draft.summary.trim(), accessibility: draft.accessibility, occurredOn: draft.occurredOn },
      });
      if (!result.success) {
        mutationCurrent = await reconcileCurrentScope();
        if (mutationCurrent) showToast(result.error || 'Could not save the Memory.', 'error');
        return;
      }
      let refreshed = true;
      try {
        mutationCurrent = await reload();
      } catch {
        refreshed = false;
      }
      if (!mutationCurrent) return;
      setDraft(EMPTY_MEMORY);
      setEditing(null);
      setComposing(false);
      showToast(
        refreshed
          ? wasEditing ? 'Memory updated.' : 'Memory added.'
          : 'Memory was saved, but Memories could not be refreshed. Reopen the subject to confirm the latest state.',
        refreshed ? 'success' : 'error',
      );
    } catch (error) {
      mutationCurrent = await reconcileCurrentScope();
      if (mutationCurrent) showToast(error instanceof Error ? error.message : 'Could not save the Memory.', 'error');
    } finally {
      if (mutationCurrent) setSaving(false);
    }
  };

  const startEditing = (entry: WorldbuildKnowledgeEntry) => {
    setEditing(entry);
    setComposing(false);
    setDraft({ summary: entry.summary || '', accessibility: entry.accessibility, occurredOn: entry.occurredOn ?? null });
  };

  const cancelEditing = () => {
    setEditing(null);
    setComposing(false);
    setDraft(EMPTY_MEMORY);
  };

  const remove = async () => {
    if (!deleting) return;
    const entry = deleting;
    try {
      const result = await api.deleteWorldbuildSubjectEntry({
        workspaceId, subjectId: owner.id, kind: 'memory', entryId: entry.id,
      });
      if (!result.success) {
        const current = await reconcileCurrentScope();
        if (current) showToast(result.error || 'Could not delete the Memory.', 'error');
        return;
      }
      let current = true;
      let refreshed = true;
      try {
        current = await reload();
      } catch {
        refreshed = false;
      }
      if (!current) return;
      if (editing?.id === entry.id) cancelEditing();
      setDeleting(null);
      showToast(
        refreshed
          ? 'Memory deleted.'
          : 'Memory was deleted, but Memories could not be refreshed. Reopen the subject to confirm the latest state.',
        refreshed ? 'success' : 'error',
      );
    } catch (error) {
      const current = await reconcileCurrentScope();
      if (current) showToast(error instanceof Error ? error.message : 'Could not delete the Memory.', 'error');
    }
  };

  return (
    <>
    <div id="memories-surface-panel" role="tabpanel" aria-labelledby="memories-surface-tab" hidden={hidden} aria-busy={loading} className="space-y-3">
      {composerOpen && (
        <div ref={memoryEditorRef} className="animate-rise-in rounded-card border border-border-default bg-surface-canvas/40 p-4">
          <div className="mb-3">
            <h4 className="text-sm font-semibold text-text-primary">{editing ? 'Edit memory' : 'New memory'}</h4>
            <p className="caption mt-1">Write what {name} remembers, then say whether {name} can recall it.</p>
          </div>

          <label htmlFor="memory-summary" className="mb-1.5 block text-xs font-medium text-text-muted">Memory</label>
          <textarea ref={memoryInputRef} id="memory-summary" className={`${INPUT} custom-scrollbar min-h-28 max-h-48 resize-none overflow-y-auto leading-relaxed`} value={draft.summary} onChange={event => setDraft(current => ({ ...current, summary: event.target.value }))} placeholder={`What does ${name} remember?`} />

          {calendar && (
            <div className="mt-4">
              <span className="mb-1.5 block text-xs font-medium text-text-muted">When it happened</span>
              <WorldDateInput
                label="When it happened"
                emptyLabel="Set the day"
                calendar={calendar}
                value={draft.occurredOn}
                seedValue={storyDay(clock)}
                onChange={occurredOn => setDraft(current => ({ ...current, occurredOn }))}
              />
            </div>
          )}

          <fieldset className="mt-4">
            <legend className="mb-2 text-xs font-medium text-text-muted">Can {name} recall it?</legend>
            <div className="grid gap-2 md:grid-cols-3">
              {(Object.entries(MEMORY_STATES) as Array<[MemoryAccessibility, typeof MEMORY_STATES[MemoryAccessibility]]>).map(([value, state]) => {
                const StateIcon = state.icon;
                const selected = draft.accessibility === value;
                return (
                  <button
                    key={value}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => setDraft(current => ({ ...current, accessibility: value }))}
                    className={`rounded-card border p-3 text-left transition-colors duration-200 ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 motion-reduce:transition-none ${selected ? state.tone : 'border-border-subtle bg-surface-input/45 text-text-muted hover:border-border-default hover:text-text-secondary'}`}
                  >
                    <span className="flex items-center gap-2 text-xs font-semibold"><StateIcon className="h-4 w-4" aria-hidden="true" />{state.label}</span>
                    <span className="mt-1.5 block text-xs leading-relaxed opacity-75">{state.description}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={cancelEditing} disabled={saving}>Cancel</Button>
            <Button onClick={save} loading={saving} disabled={!draft.summary.trim()}>{editing ? 'Save changes' : 'Add memory'}</Button>
          </div>
        </div>
      )}

      <div>
        <div role="group" aria-label="Show memories" className="flex flex-wrap items-center gap-1.5 border-b border-border-subtle pb-3">
          <span className="mr-1 text-xs text-text-subtle">Show</span>
          {([['all', 'All', projection?.memories.length ?? 0], ...(Object.entries(MEMORY_STATES) as Array<[MemoryAccessibility, typeof MEMORY_STATES[MemoryAccessibility]]>).map(([value, state]) => [value, state.label, projection?.memories.filter(entry => entry.accessibility === value).length ?? 0])] as Array<[MemoryAccessibility | 'all', string, number]>).map(([value, label, count]) => (
            <button key={value} type="button" aria-pressed={filter === value} onClick={() => setFilter(value)}
              className={`inline-flex min-h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${filter === value ? 'border-border-strong bg-surface-hover text-text-primary' : count ? 'border-border-subtle text-text-secondary hover:text-text-primary' : 'border-border-subtle text-text-disabled'}`}>
              {label}<span className="font-medium tabular-nums text-text-subtle">{count}</span>
            </button>
          ))}
        </div>
        <div className="custom-scrollbar max-h-[40rem] divide-y divide-border-subtle overflow-y-auto overscroll-contain">
          {loading && <div className="mt-3 h-24 animate-pulse rounded-card bg-surface-panel-muted/60 motion-reduce:animate-none" />}
          {!loading && projection?.memories.filter(entry => filter === 'all' || entry.accessibility === filter).map(entry => {
            const originEventId = entry.origin?.eventEntityId;
            return (
              <Statement
                key={entry.id}
                entry={entry}
                calendar={calendar}
                onEdit={entry.managed ? undefined : () => startEditing(entry)}
                onDelete={entry.managed ? undefined : () => setDeleting(entry)}
                onOpenOrigin={originEventId && onOpenEntity ? () => onOpenEntity(originEventId, { tab: 'occurrences' }) : undefined}
              />
            );
          })}
          {!loading && !projection?.memories.length && (
            <button type="button" onClick={() => setComposing(true)} className="mt-3 w-full rounded-card border border-dashed border-border-subtle px-5 py-9 text-center text-xs text-text-subtle transition-colors duration-200 ease-standard hover:border-border-strong hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 motion-reduce:transition-none">
              <Plus className="mx-auto mb-2 h-5 w-5" aria-hidden="true" />
              No memories recorded yet.
            </button>
          )}
        </div>
      </div>
    </div>
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

// Only the day: a memory is placed on the calendar, not at an hour.
function storyDay(clock: WorldDateValue | null): WorldDateValue | null {
  if (!clock) return null;
  const { eraId, year, month, day } = clock;
  return { eraId, year, month, day };
}

function Statement({ entry, entities = [], calendar = null, onEdit, onDelete, onOpenOrigin }: {
  entry: WorldbuildKnowledgeEntry; entities?: WorldbuildEntity[]; calendar?: Record<string, any> | null;
  onEdit?(): void; onDelete?(): void; onOpenOrigin?(): void;
}) {
  const menuRef = useRef<HTMLButtonElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const memoryState = entry.kind === 'memory' ? MEMORY_STATES[entry.accessibility] : null;
  const MemoryIcon = memoryState?.icon;
  const label = memoryState?.label || (entry.kind === 'belief' ? 'Believed' : 'Known');
  const origin = ENTRY_ORIGINS[entry.origin?.kind ?? 'authored'] ?? ENTRY_ORIGINS.authored;
  const OriginIcon = origin.icon;
  const occurrenceTitle = entry.origin?.kind === 'occurrence' ? entry.origin.title : '';
  const categoryLabel = entryCategoryLabel(entry.category);
  const route = entry.kind === 'knowledge' && entry.acquisition ? ACQUISITION_META[entry.acquisition] : null;
  const RouteIcon = route?.icon;
  const tellers = (entry.informantIds ?? [])
    .map(id => entities.find(item => item.id === id)?.canonicalName)
    .filter((name): name is string => Boolean(name));
  const dot = <span aria-hidden="true" className="text-text-disabled">·</span>;
  const happenedOn = entry.kind === 'memory' && calendar && entry.occurredOn ? formatWorldDate(calendar, entry.occurredOn) : '';
  return (
    <article className="group flex gap-3 py-3 text-sm text-text-secondary">
      {MemoryIcon && (
        <span data-tooltip={label} className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-control border ${memoryState?.badge}`}>
          <MemoryIcon className="h-3.5 w-3.5" aria-label={label} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <div className="mb-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs">
          {entry.kind === 'memory' ? (
            <>
              {happenedOn && <><span className="font-medium tabular-nums text-text-secondary">{happenedOn}</span>{dot}</>}
              <span className="inline-flex items-center gap-1 text-text-muted">{OriginIcon && <OriginIcon className="h-3 w-3" aria-hidden="true" />}{origin.label}</span>
              {occurrenceTitle && (onOpenOrigin
                ? <button type="button" onClick={onOpenOrigin} className="ml-1 inline-flex min-h-6 max-w-full items-center gap-1.5 truncate rounded-full border border-border-subtle bg-surface-hover/35 px-2.5 font-medium text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"><span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-entity-event" />{occurrenceTitle}</button>
                : <span className="max-w-full truncate text-text-muted">{occurrenceTitle}</span>)}
            </>
          ) : (
            <>
              <span className="font-semibold text-text-secondary">{label}</span>
              {categoryLabel && <>{dot}<span className="text-text-muted">{categoryLabel}</span></>}
              {route && RouteIcon && <>{dot}<span className="inline-flex items-center gap-1 text-text-muted"><RouteIcon className="h-3 w-3" aria-hidden="true" />{route.label}{tellers.length ? ` by ${joinNames(tellers)}` : ''}</span></>}
            </>
          )}
        </div>
        <p className="whitespace-pre-wrap leading-relaxed text-text-primary">{entry.statement || entry.summary}</p>
      </div>
      {(onEdit || onDelete) && (
        <>
          <IconButton ref={menuRef} icon={MoreHorizontal} size="sm" label={`${label} entry actions`} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)} />
          <Menu anchorRef={menuRef} open={menuOpen} onClose={() => setMenuOpen(false)} label={`${label} entry actions`} className="w-48" align="right">
            {onEdit && <MenuItem icon={Pencil} label="Edit" onSelect={() => { setMenuOpen(false); onEdit(); }} />}
            {onDelete && <MenuItem icon={Trash2} label="Delete" danger onSelect={() => { setMenuOpen(false); onDelete(); }} />}
          </Menu>
        </>
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
    <Modal onClose={onClose} size="md" title="Add Knowledge card" icon={KnowledgeGlyph} iconClassName="text-text-muted">
      <div className="space-y-4 p-4 sm:p-5">
        <p className="text-sm leading-relaxed text-text-muted">Choose a subject whose existence {owner.canonicalName} knows about.</p>
        <SearchableSelect value={targetId} onChange={setTargetId} options={options} ariaLabel="Choose known subject" placeholder="Search for an entity" />
      </div>
      <footer className="flex justify-end gap-2 border-t border-border-subtle px-4 py-4 sm:px-5">
        <Button variant="ghost" onClick={onClose}>Cancel</Button>
        <Button onClick={() => onAdd(targetId)} disabled={!targetId}>Add card</Button>
      </footer>
    </Modal>
  );
}

function EmptyState({ text, onClick }: { text: string; onClick(): void }) {
  return <button type="button" onClick={onClick} className="col-span-full rounded-card border border-dashed border-border-subtle px-5 py-9 text-sm text-text-muted transition-colors hover:border-border-strong hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 motion-reduce:transition-none"><Plus className="mx-auto mb-2 h-5 w-5" aria-hidden="true" />{text}</button>;
}

function CardStats({ counts }: { counts: Array<{ value: number; label: string }> }) {
  const filled = counts.filter(entry => entry.value > 0);
  if (!filled.length) {
    return <span className="block text-xs text-text-subtle">Knows it exists</span>;
  }
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-xs text-text-subtle">
      {filled.map((entry, index) => (
        <span key={entry.label} className="inline-flex items-center gap-1">
          {index > 0 && <span aria-hidden="true" className="mr-1 text-text-disabled">·</span>}
          <span className="tabular-nums">{entry.value}</span>
          {entry.value === 1 ? entry.label.replace(/s$/, '') : entry.label}
        </span>
      ))}
    </span>
  );
}

function KnowledgeSection({ id, open, onToggle, icon: Icon, title, description, summary, children }: {
  id: string; open: boolean; onToggle(): void; icon: typeof Check;
  title: string; description: string; summary: string; children: ReactNode;
}) {
  const triggerId = `${id}-trigger`;
  const panelId = `${id}-panel`;
  // Sections are flat parts of one card, so they take no icon.
  void Icon;
  return (
    <section className="border-t border-border-subtle first:border-t-0">
      <button
        id={triggerId}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={onToggle}
        className="flex min-h-12 w-full items-center gap-2 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
      >
        <ChevronDown aria-hidden="true" className={`h-4 w-4 shrink-0 text-text-subtle transition-transform duration-200 motion-reduce:transition-none ${open ? '' : '-rotate-90'}`} />
        <span className="text-sm font-semibold text-text-primary">{title}</span>
        <span className="text-xs tabular-nums text-text-subtle">{summary}</span>
      </button>
      {open && (
        <div id={panelId} role="region" aria-labelledby={triggerId} className="pb-3">
          <p className="caption mb-1 pl-6">{description}</p>
          {children}
        </div>
      )}
    </section>
  );
}

function SurfaceButton({ id, controls, active, onClick, onKeyDown, icon: Icon, label, count }: {
  id: string; controls: string; active: boolean; onClick(): void;
  onKeyDown(event: KeyboardEvent<HTMLButtonElement>): void;
  icon: typeof BookOpenCheck; label: string; count: number;
}) {
  return <button id={id} type="button" role="tab" aria-controls={controls} aria-selected={active} tabIndex={active ? 0 : -1} onClick={onClick} onKeyDown={onKeyDown} className={`flex min-h-8 items-center justify-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 motion-reduce:transition-none ${active ? 'bg-surface-hover font-semibold text-text-primary ring-1 ring-inset ring-border-strong' : 'font-medium text-text-muted hover:text-text-primary'}`}><Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}{count > 0 && <span className="text-xs tabular-nums text-text-subtle">{count}</span>}</button>;
}

function hasFilledValue(value: unknown): boolean {
  if (value === null || value === undefined || value === '') return false;
  return !Array.isArray(value) || value.length > 0;
}

function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim().toLocaleLowerCase();
}
