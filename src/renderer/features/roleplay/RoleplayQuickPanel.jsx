import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Backpack, CalendarDays, Check, ChevronRight, Clock3, Image as ImageIcon, MapPin,
  Loader2, MoreVertical, PanelRightOpen, Pencil, Plus, Settings2, Sparkles, Swords, Users, X
} from 'lucide-react';
import SearchableSelect from '../../components/ui/SearchableSelect';
import Popover from '../../components/ui/Popover';
import Modal from '../../components/ui/Modal';
import { itemMeta, meta } from '../worldbuild/worldbuildConfig';
import WorldDateInput, { formatWorldDate } from '../worldbuild/WorldDateInput';

const EMPTY_SCENE = {
  locationId: null,
  participantIds: [],
  possibleObserverIds: [],
  nearbyIds: [],
  objectIds: []
};

const PRESENCE = {
  participating: { label: 'Participating', icon: Swords },
  nearby: { label: 'Nearby', icon: MapPin }
};

const COLLAPSED_ACTOR_LIMIT = 5;

function RoleplayQuickPanel({
  workspaceId,
  api,
  showToast,
  onOpenConfiguration,
  onBackgroundChange,
  onCollapsedChange,
  narrativeStateProcessing = false,
  initialCollapsed = false
}) {
  const [collapsed, setCollapsed] = useState(initialCollapsed);
  const [tab, setTab] = useState('scene');
  const [settings, setSettings] = useState({});
  const [scene, setScene] = useState(EMPTY_SCENE);
  const [calendar, setCalendar] = useState(null);
  const [clock, setClock] = useState(null);
  const [clockDraft, setClockDraft] = useState(null);
  const [editingClock, setEditingClock] = useState(false);
  const [entities, setEntities] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [definitions, setDefinitions] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [background, setBackground] = useState(null);
  const [addingCharacter, setAddingCharacter] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [transfer, setTransfer] = useState(null);
  const [recentOpen, setRecentOpen] = useState(false);
  const [recentTurns, setRecentTurns] = useState([]);
  const [expandedTurnId, setExpandedTurnId] = useState(null);
  const [resolvingChangeId, setResolvingChangeId] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const backgroundInputRef = useRef(null);
  const refreshFrameRef = useRef(null);

  const load = useCallback(async () => {
    const configurationPromise = api.getRoleplayConfiguration(workspaceId);
    const inventoryPromise = configurationPromise.then(configuration => {
      const playerEntityId = configuration?.settings?.playerEntityId;
      return playerEntityId ? api.getRoleplayInventory(workspaceId, playerEntityId) : null;
    });
    const backgroundPromise = configurationPromise.then(configuration => {
      const locationId = configuration?.scene?.locationId;
      return locationId ? api.getRoleplayLocationBackground(workspaceId, locationId) : null;
    });
    const [configuration, worldbuild, templateResult, inventoryResult, backgroundResult] = await Promise.all([
      configurationPromise,
      api.listEntities(workspaceId),
      api.listWorldbuildEntityTemplates?.(workspaceId),
      inventoryPromise,
      backgroundPromise
    ]);
    if (!configuration?.success) throw new Error(configuration?.error || 'Could not load Roleplay state.');
    const nextSettings = configuration.settings || {};
    const nextScene = configuration.scene || EMPTY_SCENE;
    const nextEntities = (worldbuild?.entities || worldbuild || []).filter(entity => entity.status !== 'proposed');
    setSettings(nextSettings);
    setScene({ ...EMPTY_SCENE, ...nextScene });
    setCalendar(configuration.calendar || null);
    setClock(configuration.clock || null);
    setClockDraft(configuration.clock || null);
    setEntities(nextEntities);
    setTemplates(templateResult?.templates || []);
    setDefinitions(configuration.definitions || []);
    setRecentTurns(groupRecentTurns(configuration));
    setPendingCount([
      ...(configuration.sceneChanges || []),
      ...(configuration.inventoryChanges || []),
      ...(configuration.changes || []),
      ...(configuration.entityChanges || []),
      ...(configuration.narrativeEvents || [])
    ].filter(change => change.status === 'pending' || change.status === 'proposed' || change.status === 'conflicting').length);
    setInventory(inventoryResult?.success ? inventoryResult.inventory || [] : []);
    const nextBackground = backgroundResult?.success ? backgroundResult.background : null;
    setBackground(nextBackground);
    onBackgroundChange(nextBackground);
  }, [api, onBackgroundChange, workspaceId]);

  useEffect(() => {
    load().catch(error => showToast(error.message, 'error'));
  }, [load, refreshKey, showToast]);

  useEffect(() => {
    const scheduleRefresh = () => {
      if (refreshFrameRef.current) return;
      refreshFrameRef.current = requestAnimationFrame(() => {
        refreshFrameRef.current = null;
        setRefreshKey(value => value + 1);
      });
    };
    const refresh = event => {
      if (!event.detail?.workspaceId || event.detail.workspaceId === workspaceId) {
        scheduleRefresh();
      }
    };
    window.addEventListener('roleplay-state-change', refresh);
    const unsubscribe = api.onRoleplayResourceChanges?.(payload => {
      if (payload?.workspaceId === workspaceId) scheduleRefresh();
    });
    return () => {
      window.removeEventListener('roleplay-state-change', refresh);
      unsubscribe?.();
      if (refreshFrameRef.current) cancelAnimationFrame(refreshFrameRef.current);
      refreshFrameRef.current = null;
    };
  }, [api, workspaceId]);

  useEffect(() => {
    if (!openMenuId) return undefined;
    const closeMenu = event => {
      const isOutsideClick = event.type === 'pointerdown' && !event.target.closest('[data-roleplay-menu-root]');
      if (event.key === 'Escape' || isOutsideClick) setOpenMenuId(null);
    };
    document.addEventListener('pointerdown', closeMenu);
    document.addEventListener('keydown', closeMenu);
    return () => {
      document.removeEventListener('pointerdown', closeMenu);
      document.removeEventListener('keydown', closeMenu);
    };
  }, [openMenuId]);

  const groups = useMemo(() => ({
    actors: entities.filter(entity => entity.type === 'Characters'
      || (entity.type === 'Creatures' && (entity.data?.scope || 'individual') !== 'group')),
    locations: entities.filter(entity => entity.type === 'Locations')
  }), [entities]);
  const names = useMemo(() => new Map(entities.map(entity => [entity.id, entity.canonicalName])), [entities]);
  const typeLabels = useMemo(() => new Map(templates.map(template => [
    template.typeId,
    template.displayName || meta(template.typeId).label
  ])), [templates]);
  const actorOptions = groups.actors.map(entity => ({
    id: entity.id,
    label: entity.canonicalName,
    aliases: entity.aliases,
    group: entity.type.replace(/s$/, '')
  }));
  const locationOptions = groups.locations.map(entity => ({
    id: entity.id,
    label: entity.canonicalName,
    aliases: entity.aliases
  }));
  const player = groups.actors.find(entity => entity.id === settings.playerEntityId);
  const presentIds = new Set([
    ...(scene.participantIds || []),
    ...(scene.possibleObserverIds || []),
    ...(scene.nearbyIds || [])
  ]);
  const otherCharacters = groups.actors
    .filter(entity => entity.id !== settings.playerEntityId && presentIds.has(entity.id))
    .sort((left, right) => {
      const presenceOrder = Number(!scene.participantIds?.includes(left.id)) - Number(!scene.participantIds?.includes(right.id));
      return presenceOrder || left.canonicalName.localeCompare(right.canonicalName);
    });
  const roleplayStatusLabel = narrativeStateProcessing
    ? 'Updating Narrative State'
    : pendingCount > 0
      ? `${pendingCount} ${pendingCount === 1 ? 'change' : 'changes'} to review`
      : 'Active';
  const savePanelState = async nextCollapsed => {
    onCollapsedChange?.(nextCollapsed);
    setCollapsed(nextCollapsed);
    await api.setWorkspaceUiState?.(workspaceId, 'roleplay-quick-panel', { collapsed: nextCollapsed });
  };

  const resolveBackground = useCallback(async locationId => {
    if (!locationId) {
      setBackground(null);
      onBackgroundChange(null);
      return;
    }
    const result = await api.getRoleplayLocationBackground(workspaceId, locationId);
    const nextBackground = result?.success ? result.background : null;
    setBackground(nextBackground);
    onBackgroundChange(nextBackground);
  }, [api, onBackgroundChange, workspaceId]);

  const saveScene = async patch => {
    const result = await api.applyRoleplaySceneChange(workspaceId, patch);
    if (!result?.success) return showToast(result?.error || 'Could not update the scene.', 'error');
    const nextScene = { ...EMPTY_SCENE, ...result.scene };
    setScene(nextScene);
    if (Object.hasOwn(patch, 'locationId')) await resolveBackground(nextScene.locationId);
    window.dispatchEvent(new CustomEvent('roleplay-state-change', { detail: { workspaceId } }));
    return nextScene;
  };

  const setPlayer = async entityId => {
    const result = await api.saveRoleplaySettings(workspaceId, { ...settings, playerEntityId: entityId });
    if (!result?.success) return showToast(result?.error || 'Could not change the controlled character.', 'error');
    setOpenMenuId(null);
    window.dispatchEvent(new CustomEvent('roleplay-state-change', { detail: { workspaceId } }));
  };

  const addCharacter = async entityId => {
    if (!entityId) return;
    await saveScene({ participantIds: [...new Set([...(scene.participantIds || []), entityId])] });
    setAddingCharacter(false);
  };

  const changePresence = async (entityId, presence) => {
    const patch = {
      participantIds: (scene.participantIds || []).filter(id => id !== entityId),
      possibleObserverIds: (scene.possibleObserverIds || []).filter(id => id !== entityId),
      nearbyIds: (scene.nearbyIds || []).filter(id => id !== entityId)
    };
    const key = presence === 'participating' ? 'participantIds' : 'nearbyIds';
    patch[key] = [...patch[key], entityId];
    await saveScene(patch);
    setOpenMenuId(null);
  };

  const removeCharacter = async entityId => {
    await saveScene({
      participantIds: (scene.participantIds || []).filter(id => id !== entityId),
      possibleObserverIds: (scene.possibleObserverIds || []).filter(id => id !== entityId),
      nearbyIds: (scene.nearbyIds || []).filter(id => id !== entityId)
    });
    setOpenMenuId(null);
  };

  const toggleEquipped = async item => {
    const result = await api.setRoleplayEquipped(workspaceId, settings.playerEntityId, item.itemId, !item.equipped);
    if (!result?.success) return showToast(result?.error || 'Could not update equipment.', 'error');
    setInventory(result.inventory || []);
    setOpenMenuId(null);
  };

  const applyTransfer = async () => {
    const item = inventory.find(candidate => candidate.itemId === transfer.itemId);
    if (!item) return;
    const quantity = item.nature === 'unique' ? undefined : Math.min(item.quantity, Math.max(1, Number(transfer.quantity) || 1));
    const destinationId = transfer.targetId || (transfer.mode === 'location' ? scene.locationId : null);
    const patch = {
      itemId: item.itemId,
      fromHolderId: settings.playerEntityId,
      ...(transfer.mode === 'character' ? { toHolderId: destinationId } : { locationId: destinationId }),
      ...(item.equipped ? { equipped: false } : {}),
      ...(quantity ? { quantity } : {})
    };
    if ((transfer.mode === 'character' && !patch.toHolderId) || (transfer.mode === 'location' && !patch.locationId)) {
      return showToast('Choose a destination.', 'error');
    }
    const result = await api.applyRoleplayInventoryChange(workspaceId, patch);
    if (!result?.success) return showToast(result?.error || 'Could not move the item.', 'error');
    setTransfer(null);
    setOpenMenuId(null);
    setRefreshKey(value => value + 1);
  };

  const uploadBackground = async event => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !scene.locationId) return;
    const result = await api.uploadRoleplayLocationBackground(
      workspaceId,
      scene.locationId,
      file.path || '',
      file.name
    );
    if (!result?.success) return showToast(result?.error || 'Could not save the Location background.', 'error');
    setBackground(result.background);
    onBackgroundChange(result.background);
  };

  const removeBackground = async () => {
    const result = await api.setRoleplayLocationBackground(workspaceId, scene.locationId, null);
    if (!result?.success) return showToast(result?.error || 'Could not remove the Location background.', 'error');
    setBackground(result.background);
    onBackgroundChange(result.background);
  };

  const saveClock = async () => {
    const result = await api.saveRoleplayClock(workspaceId, clockDraft);
    if (!result?.success) return showToast(result?.error || 'Could not update RP time.', 'error');
    setClock(result.clock);
    setClockDraft(result.clock);
    setEditingClock(false);
    window.dispatchEvent(new CustomEvent('roleplay-state-change', { detail: { workspaceId } }));
  };

  const resolveRecentChange = async (change, decision) => {
    const methods = {
      resource: api.resolveRoleplayResourceChange,
      scene: api.resolveRoleplaySceneChange,
      inventory: api.resolveRoleplayInventoryChange,
      entity: api.resolveRoleplayEntityChange,
      narrative: api.resolveNarrativeStateEvent
    };
    const method = methods[change.kind];
    if (!method) return;
    setResolvingChangeId(change.id);
    const result = await method(workspaceId, change.id, decision);
    setResolvingChangeId(null);
    if (!result?.success) return showToast(result?.error || 'Could not resolve the Narrative State update.', 'error');
    setRefreshKey(value => value + 1);
    window.dispatchEvent(new CustomEvent('roleplay-state-change', { detail: { workspaceId } }));
  };

  const openConfiguration = () => {
    onOpenConfiguration();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent('configuration-open-section', { detail: { sectionId: 'roleplay' } }));
    }));
  };

  if (collapsed) {
    return (
      <div className="group absolute bottom-5 right-5 z-30 text-xs">
        <button
          type="button"
          onClick={() => savePanelState(false)}
          aria-label={launcherLabel(roleplayStatusLabel, calendar, clock, names.get(scene.locationId))}
          className="flex w-[10em] flex-col overflow-hidden rounded-surface border border-accent/35 bg-surface-panel/95 text-left text-accent shadow-panel backdrop-blur-md transition-[width,background-color,border-color,box-shadow] duration-300 ease-emphasized hover:w-[17.5em] hover:border-accent/55 hover:shadow-overlay focus-visible:w-[17.5em] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 group-focus-within:w-[17.5em]"
        >
          <span className="flex min-h-11 w-full items-center justify-between gap-2 px-3.5">
            <span className="flex shrink-0 items-center gap-2">
              <span className="font-bold uppercase tracking-[0.14em]">RP Mode</span>
              <RoleplayStatus processing={narrativeStateProcessing} pendingCount={pendingCount} />
            </span>
            {/* The only cue that a full panel exists behind this button. */}
            <span className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap text-text-subtle opacity-0 transition-opacity duration-200 ease-standard group-hover:opacity-100 group-hover:delay-150 group-focus-within:opacity-100 group-focus-within:delay-150">
              <span className="truncate font-semibold">Open panel</span>
              <PanelRightOpen aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
            </span>
          </span>
          <span
            aria-hidden="true"
            className="reveal group-hover:reveal-open group-focus-within:reveal-open"
          >
            <span className="reveal-body block">
              <LauncherSummary
                player={player}
                participants={otherCharacters.filter(entity => scene.participantIds?.includes(entity.id))}
                nearby={otherCharacters.filter(entity => !scene.participantIds?.includes(entity.id))}
                locationName={names.get(scene.locationId)}
                calendar={calendar}
                clock={clock}
              />
            </span>
          </span>
        </button>
      </div>
    );
  }

  return (
    <aside className="relative z-20 flex h-full w-[clamp(18rem,30vw,22.5rem)] shrink-0 flex-col border-l border-border-subtle bg-surface-sidebar/90 shadow-2xl backdrop-blur-xl 2xl:w-[23.5rem]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border-subtle px-4">
        {/* The pulsing dot already says "active", so the label only appears when
            there is something else to report. */}
        <div className="flex min-w-0 items-center gap-2.5 py-1 text-accent">
          <RoleplayStatus processing={narrativeStateProcessing} pendingCount={pendingCount} />
          <span className="min-w-0 text-left">
            <span className="block text-xs font-bold uppercase tracking-[0.16em]">RP Mode</span>
            {(narrativeStateProcessing || pendingCount > 0) && (
              <span className="mt-0.5 block truncate text-[0.625rem] font-medium text-text-subtle">{roleplayStatusLabel}</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <button type="button" onClick={openConfiguration} aria-label="Open Roleplay Mode settings" className="rounded-control p-2 text-text-subtle transition-colors hover:bg-surface-hover/60 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40" title="Roleplay Mode settings"><Settings2 aria-hidden="true" className="h-4 w-4" /></button>
          <button type="button" onClick={() => savePanelState(true)} aria-label="Minimize Roleplay panel" className="rounded-control p-2 text-text-subtle transition-colors hover:bg-surface-hover/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40" title="Minimize panel"><ChevronRight aria-hidden="true" className="h-4 w-4" /></button>
        </div>
      </header>

      <section className="shrink-0 border-b border-border-subtle bg-surface-canvas/40 px-4 py-3">
        {editingClock && calendar ? (
          <div className="space-y-3">
            <WorldDateInput calendar={calendar} value={clockDraft} includeTime allowClear={false} label="Roleplay date and time" emptyLabel="Set date and time" onChange={setClockDraft} />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => { setClockDraft(clock); setEditingClock(false); }} className="inline-flex min-h-9 items-center gap-1.5 rounded-control px-3 text-xs font-semibold text-text-muted transition-colors hover:bg-surface-hover/60 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"><X aria-hidden="true" className="h-3.5 w-3.5" />Cancel</button>
              <button type="button" onClick={saveClock} className="inline-flex min-h-9 items-center gap-1.5 rounded-control bg-accent px-3 text-xs font-bold text-on-accent transition-[filter] hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50"><Check aria-hidden="true" className="h-3.5 w-3.5" />Save time</button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setEditingClock(true)} className="group/clock flex w-full items-center justify-between gap-3 rounded-control text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
            <span className="min-w-0">
              <span className="flex min-w-0 items-center gap-2 truncate text-sm font-semibold text-text-secondary">
                <CalendarDays aria-hidden="true" className="h-4 w-4 shrink-0 text-status-info" />
                {formatWorldDate(calendar, clock)}
              </span>
              <span className="mt-1 flex items-baseline gap-2 text-text-muted">
                <span className="font-mono text-xl font-semibold tabular-nums tracking-tight text-text-primary">{String(clock?.hour ?? 0).padStart(2, '0')}:{String(clock?.minute ?? 0).padStart(2, '0')}</span>
                {clock?.weekdayName && <span className="truncate text-xs font-medium">{clock.weekdayName}</span>}
              </span>
            </span>
            <Pencil aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-text-disabled transition-colors group-hover/clock:text-accent" />
          </button>
        )}
      </section>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 custom-scrollbar">
        {tab === 'scene' ? (
          <div className="space-y-5">
            <section>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="eyebrow">Active Characters</h3>
                <button type="button" onClick={() => setAddingCharacter(value => !value)} aria-expanded={addingCharacter} className="inline-flex items-center gap-1 rounded-control px-2 py-1 text-xs font-semibold text-accent transition-colors hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"><Plus aria-hidden="true" className="h-3.5 w-3.5" />Add</button>
              </div>
              {addingCharacter && (
                <div className="mb-2 animate-rise-in rounded-card border border-accent/20 bg-accent/[0.04] p-2">
                  <SearchableSelect
                    value=""
                    onChange={addCharacter}
                    options={actorOptions.filter(option => !presentIds.has(option.id))}
                    placeholder="Search characters"
                    ariaLabel="Add a character to the scene"
                  />
                </div>
              )}
              <div className="space-y-1.5">
                {player ? <CharacterCard entity={player} protagonist typeLabel={typeLabels.get(player.type)} /> : <EmptyState text="Choose a Player Character in Roleplay Mode settings." />}
                <div className={(presentIds.size >= 5 ? 'max-h-[17rem] overflow-y-auto pr-1 custom-scrollbar' : '') + ' space-y-1.5'}>
                  {otherCharacters.map(entity => (
                    <CharacterCard
                      key={entity.id}
                      entity={entity}
                      typeLabel={typeLabels.get(entity.type)}
                      presence={presenceOf(entity.id, scene)}
                      menuOpen={openMenuId === entity.id}
                      onMenu={() => setOpenMenuId(openMenuId === entity.id ? null : entity.id)}
                      onPresence={presence => changePresence(entity.id, presence)}
                      onPlay={() => setPlayer(entity.id)}
                      onRemove={() => removeCharacter(entity.id)}
                    />
                  ))}
                  {!otherCharacters.length && player && <p className="px-2 py-3 text-center text-xs text-text-disabled">No one else is present.</p>}
                </div>
              </div>
            </section>

            <section>
              <h3 className="eyebrow mb-2">Current Location</h3>
              <SearchableSelect
                value={scene.locationId || ''}
                onChange={locationId => saveScene({ locationId: locationId || null })}
                options={locationOptions}
                placeholder="Select a Location"
                ariaLabel="Current Location"
              />
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between gap-2">
                <h3 className="eyebrow">Location Background</h3>
                {background?.imagePath && !background.inherited && (
                  <button type="button" onClick={removeBackground} className="rounded-control px-1.5 py-0.5 text-xs font-semibold text-text-muted transition-colors hover:text-status-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger/40">Remove</button>
                )}
              </div>
              <button
                type="button"
                disabled={!scene.locationId}
                onClick={() => backgroundInputRef.current?.click()}
                className={`group relative flex w-full overflow-hidden rounded-card border border-border-subtle bg-surface-panel-muted transition-colors duration-200 ease-standard hover:border-border-default focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed disabled:opacity-50 ${background?.imagePath ? 'h-32 items-center justify-center' : 'min-h-11 items-center px-3'}`}
                style={background?.imagePath ? {
                  backgroundImage: `url("app-file:///${background.imagePath.replace(/\\/g, '/')}")`,
                  backgroundPosition: 'center',
                  backgroundSize: 'cover'
                } : {}}
              >
                <div className={'absolute inset-0 rounded-[inherit] transition-colors ' + (background?.imagePath ? 'bg-black/0 group-hover:bg-black/50 group-focus-visible:bg-black/50' : 'bg-transparent')} />
                <div className={'relative flex items-center gap-2 transition-opacity ' + (background?.imagePath ? 'flex-col opacity-0 text-accent group-hover:opacity-100 group-focus-visible:opacity-100' : 'text-text-muted group-hover:text-accent')}>
                  <ImageIcon className={background?.imagePath ? 'h-6 w-6' : 'h-4 w-4'} />
                  <span className="text-xs font-semibold">{background?.imagePath ? 'Change background' : 'Choose background'}</span>
                </div>
              </button>
              <input ref={backgroundInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={uploadBackground} />
              <p className="mt-2 truncate text-xs text-text-subtle">
                {background?.inherited
                  ? `Inherited from ${names.get(background.sourceLocationId) || 'parent Location'}`
                  : background?.imagePath ? 'Saved to this Location' : 'Uses the workspace background'}
              </p>
            </section>

            {!!recentTurns.length && (
              <section className="border-t border-border-subtle pt-3">
                <button type="button" onClick={() => setRecentOpen(value => !value)} aria-expanded={recentOpen} className="flex w-full items-center justify-between rounded-control text-xs font-semibold text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                  <span className="inline-flex items-center gap-2"><Sparkles aria-hidden="true" className="h-3.5 w-3.5 text-accent" />Recent Changes</span>
                  <ChevronRight aria-hidden="true" className={'h-3.5 w-3.5 transition-transform duration-200 ease-standard ' + (recentOpen ? 'rotate-90' : '')} />
                </button>
                {recentOpen && (
                  <div className="mt-2 animate-rise-in space-y-2">
                    {recentTurns.map(turn => (
                      <RecentTurn
                        key={turn.originId}
                        turn={turn}
                        names={names}
                        definitions={definitions}
                        open={expandedTurnId === turn.originId}
                        onToggle={() => setExpandedTurnId(current => current === turn.originId ? null : turn.originId)}
                        onResolve={resolveRecentChange}
                        resolvingChangeId={resolvingChangeId}
                      />
                    ))}
                  </div>
                )}
              </section>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-card border border-accent/15 bg-accent/[0.04] p-3">
              <Avatar entity={player} />
              <div className="min-w-0">
                <p className="eyebrow text-accent">Current inventory</p>
                <p className="mt-0.5 truncate text-sm font-semibold text-text-primary">{player?.canonicalName || 'No controlled character'}</p>
              </div>
            </div>
            <InventorySection title="Equipped" items={inventory.filter(item => item.equipped)} empty="Nothing is equipped." onMenu={setOpenMenuId} openMenuId={openMenuId} onToggle={toggleEquipped} onTransfer={setTransfer} />
            <InventorySection title="Carried" items={inventory.filter(item => !item.equipped)} empty="This character carries no other items." onMenu={setOpenMenuId} openMenuId={openMenuId} onToggle={toggleEquipped} onTransfer={setTransfer} />
          </div>
        )}
      </div>

      {transfer && (
        <Modal
          title={`Move ${inventory.find(item => item.itemId === transfer.itemId)?.name || 'item'}`}
          icon={Backpack}
          onClose={() => setTransfer(null)}
          size="sm"
        >
          <TransferEditor
            transfer={transfer}
            setTransfer={setTransfer}
            item={inventory.find(item => item.itemId === transfer.itemId)}
            actors={actorOptions.filter(option => option.id !== settings.playerEntityId)}
            locations={locationOptions}
            currentLocationId={scene.locationId}
            onApply={applyTransfer}
          />
        </Modal>
      )}

      <footer className="grid h-14 shrink-0 grid-cols-2 gap-1 border-t border-border-subtle bg-surface-canvas/70 p-2">
        <TabButton active={tab === 'scene'} onClick={() => setTab('scene')} icon={Users} label="Scene" />
        <TabButton active={tab === 'inventory'} onClick={() => setTab('inventory')} icon={Backpack} label="Inventory" count={inventory.length} />
      </footer>
    </aside>
  );
}

function CharacterCard({ entity, typeLabel, protagonist = false, presence, menuOpen, onMenu, onPresence, onPlay, onRemove }) {
  const presenceConfig = PRESENCE[presence] || PRESENCE.participating;
  const PresenceIcon = presenceConfig.icon;
  const typeMeta = meta(entity.type);
  const menuButtonRef = useRef(null);
  return (
    <article data-roleplay-menu-root className={'group/card relative flex items-center gap-2.5 rounded-card border p-2 transition-colors duration-200 ease-standard ' + (protagonist ? 'border-accent/35 bg-accent/[0.07]' : `${typeMeta.ring} bg-surface-panel-muted/70 hover:bg-surface-panel-muted`)}>
      <Avatar entity={entity} protagonist={protagonist} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={'truncate text-[0.6875rem] font-bold uppercase tracking-[0.09em] ' + typeMeta.soft}>{typeLabel || typeMeta.label}</span>
          {protagonist
            ? <span className="shrink-0 rounded bg-accent/15 px-1.5 py-0.5 text-[0.6875rem] font-bold uppercase tracking-[0.09em] text-accent">Playing</span>
            : <span className="inline-flex shrink-0 items-center gap-1 text-[0.6875rem] font-medium text-text-muted"><PresenceIcon aria-hidden="true" className="h-3 w-3" />{presenceConfig.label}</span>}
        </div>
        <p className="mt-0.5 truncate text-sm font-semibold text-text-primary">{entity.canonicalName}</p>
      </div>
      {!protagonist && (
        <button ref={menuButtonRef} type="button" aria-label={`Actions for ${entity.canonicalName}`} onClick={onMenu} className="shrink-0 rounded-control p-1.5 text-text-subtle opacity-0 transition-[color,background-color,opacity] hover:bg-surface-hover/60 hover:text-text-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 group-focus-within/card:opacity-100 group-hover/card:opacity-100"><MoreVertical aria-hidden="true" className="h-4 w-4" /></button>
      )}
      {menuOpen && (
        <FloatingMenu anchorRef={menuButtonRef} onClose={onMenu}>
          <MenuAction onClick={onPlay} icon={Sparkles}>Play as character</MenuAction>
          {Object.entries(PRESENCE).map(([key, value]) => <MenuAction key={key} onClick={() => onPresence(key)} icon={value.icon}>{value.label}</MenuAction>)}
          <MenuAction onClick={onRemove} icon={X} danger>Remove from scene</MenuAction>
        </FloatingMenu>
      )}
    </article>
  );
}

function FloatingMenu({ anchorRef, onClose, children }) {
  return (
    <Popover anchorRef={anchorRef} open onClose={onClose} matchAnchorWidth={false} align="right" scroll={false} className="w-44 border-border-default bg-surface-panel-muted p-1.5">
      <div data-roleplay-menu-root>{children}</div>
    </Popover>
  );
}

/* A span so it stays valid phrasing content inside the launcher button. */
function Avatar({ entity, protagonist = false, compact = false }) {
  const image = entity?.data?.image || entity?.data?.imagePath || entity?.data?.avatar;
  return (
    <span
      className={'inline-flex shrink-0 items-center justify-center overflow-hidden border bg-surface-canvas font-bold uppercase ' + (compact ? 'h-7 w-7 rounded-control text-xs ' : 'h-10 w-10 rounded-card text-sm ') + (protagonist ? 'border-accent/50 text-accent' : 'border-border-subtle text-text-muted')}
      style={image ? { backgroundImage: `url("app-file:///${String(image).replace(/\\/g, '/')}")`, backgroundPosition: 'center', backgroundSize: 'cover' } : {}}
    >
      {!image && (entity?.canonicalName?.[0] || '?')}
    </span>
  );
}

function InventorySection({ title, items, empty, openMenuId, onMenu, onToggle, onTransfer }) {
  return (
    <section>
      <h3 className="eyebrow mb-2">{title}</h3>
      <div className="space-y-1.5">
        {items.map(item => <InventoryItemCard key={item.itemId} item={item} menuOpen={openMenuId === item.itemId} onMenu={() => onMenu(openMenuId === item.itemId ? null : item.itemId)} onCloseMenu={() => onMenu(null)} onToggle={onToggle} onTransfer={onTransfer} />)}
        {!items.length && <p className="rounded-card border border-dashed border-border-subtle px-3 py-5 text-center text-xs text-text-disabled">{empty}</p>}
      </div>
    </section>
  );
}

function InventoryItemCard({ item, menuOpen, onMenu, onCloseMenu, onToggle, onTransfer }) {
  const menuButtonRef = useRef(null);
  const ItemIcon = itemMeta(item.data?.itemType).icon;
  return (
    <article data-roleplay-menu-root className={'group/item relative flex items-center gap-2.5 rounded-card border p-2 transition-colors duration-200 ease-standard ' + (item.equipped ? 'border-status-info/35 bg-status-info/[0.07]' : 'border-border-subtle bg-surface-panel-muted/70 hover:bg-surface-panel-muted')}>
      <div className={'flex h-9 w-9 shrink-0 items-center justify-center rounded-control border bg-surface-canvas ' + (item.equipped ? 'border-status-info/30 text-status-info' : 'border-border-default text-entity-item')}><ItemIcon aria-hidden="true" className="h-4 w-4" /></div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-text-primary">{item.name}</p>
        <p className={'text-xs ' + (item.equipped ? 'text-status-info' : 'text-text-muted')}>{item.equipped ? 'Equipped' : item.nature === 'unique' ? 'Unique item' : `Quantity ${item.quantity}`}</p>
      </div>
      <button ref={menuButtonRef} type="button" aria-label={`Actions for ${item.name}`} onClick={onMenu} className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-control text-text-subtle opacity-0 transition-[color,background-color,opacity] hover:bg-surface-hover/60 hover:text-text-primary focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 group-focus-within/item:opacity-100 group-hover/item:opacity-100"><MoreVertical aria-hidden="true" className="h-4 w-4" /></button>
      {menuOpen ? (
        <FloatingMenu anchorRef={menuButtonRef} onClose={onCloseMenu}>
          <MenuAction onClick={() => onToggle(item)} icon={Swords}>{item.equipped ? 'Unequip' : 'Equip'}</MenuAction>
          <MenuAction onClick={() => onTransfer({ itemId: item.itemId, mode: 'location', targetId: '', quantity: 1 })} icon={MapPin}>Drop or move</MenuAction>
          <MenuAction onClick={() => onTransfer({ itemId: item.itemId, mode: 'character', targetId: '', quantity: 1 })} icon={Users}>Give to character</MenuAction>
        </FloatingMenu>
      ) : null}
    </article>
  );
}

function TransferEditor({ transfer, setTransfer, item, actors, locations, currentLocationId, onApply }) {
  const options = transfer.mode === 'character' ? actors : locations;
  return (
    <section className="space-y-3 p-5">
      <p className="text-sm text-text-muted">{transfer.mode === 'character' ? 'Choose the character who will receive this item.' : 'Choose the world location where this item will be placed.'}</p>
      <SearchableSelect
        value={transfer.targetId || (transfer.mode === 'location' ? currentLocationId || '' : '')}
        onChange={targetId => setTransfer({ ...transfer, targetId })}
        options={options}
        placeholder={transfer.mode === 'character' ? 'Select character' : 'Select Location'}
      />
      {item?.nature === 'type' && (
        <label className="flex items-center justify-between text-xs font-medium text-text-muted">
          Quantity
          <input type="number" min="1" max={item.quantity} value={transfer.quantity} onChange={event => setTransfer({ ...transfer, quantity: event.target.value })} className="min-h-10 w-20 rounded-control border border-border-default bg-surface-input px-2 text-right text-sm text-text-primary outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/20" />
        </label>
      )}
      <button type="button" onClick={onApply} className="min-h-10 w-full rounded-control border border-accent/30 bg-accent/10 px-4 text-sm font-semibold text-accent hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">Apply move</button>
    </section>
  );
}

/* Revealed inside the collapsed launcher itself. Purely visual: the button
   carries the equivalent text in its aria-label. */
function LauncherSummary({ player, participants, nearby, locationName, calendar, clock }) {
  const actors = [
    player,
    ...participants.filter(entity => entity.id !== player?.id),
    ...nearby.filter(entity => entity.id !== player?.id)
  ].filter(Boolean);
  const visibleActors = actors.slice(0, COLLAPSED_ACTOR_LIMIT);
  const overflowCount = actors.length - visibleActors.length;
  return (
    /* Full-width rows with edge-to-edge dividers. Short strings still read as
       filling the card because the row, not the text, defines the width. */
    <span className="block border-t border-border-subtle opacity-0 transition-opacity duration-200 ease-standard group-hover:opacity-100 group-hover:delay-100 group-focus-within:opacity-100 group-focus-within:delay-100">
      <span className="flex w-full items-start gap-2.5 px-3.5 py-2.5">
        <Clock3 aria-hidden="true" className="mt-0.5 h-3.5 w-3.5 shrink-0 text-status-info" />
        <span className="min-w-0 flex-1">
          <span className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate font-semibold text-text-primary">{formatWorldDate(calendar, clock)}</span>
            <span className="shrink-0 font-mono tabular-nums text-text-secondary">{String(clock?.hour ?? 0).padStart(2, '0')}:{String(clock?.minute ?? 0).padStart(2, '0')}</span>
          </span>
          {clock?.weekdayName && <span className="mt-0.5 block truncate text-text-muted">{clock.weekdayName}</span>}
        </span>
      </span>

      <span className="flex w-full items-center gap-2.5 border-t border-border-subtle px-3.5 py-2.5">
        <Users aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-accent/70" />
        <span className="flex min-w-0 flex-1 items-center gap-1.5">
          {visibleActors.map(entity => (
            <Avatar key={entity.id} entity={entity} protagonist={entity.id === player?.id} compact />
          ))}
          {overflowCount > 0 && (
            <span className="flex h-7 min-w-7 items-center justify-center rounded-control border border-border-default bg-surface-panel-muted px-1 font-semibold text-text-secondary">+{overflowCount}</span>
          )}
          {!visibleActors.length && <span className="text-text-muted">No active characters</span>}
        </span>
      </span>

      <span className="flex w-full items-center gap-2.5 border-t border-border-subtle px-3.5 py-2.5">
        <MapPin aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-status-success" />
        <span className="min-w-0 flex-1 truncate font-medium text-text-secondary">{locationName || 'No current Location'}</span>
      </span>
    </span>
  );
}

function launcherLabel(statusLabel, calendar, clock, locationName) {
  const time = `${String(clock?.hour ?? 0).padStart(2, '0')}:${String(clock?.minute ?? 0).padStart(2, '0')}`;
  return [
    'Open Roleplay panel',
    statusLabel,
    [formatWorldDate(calendar, clock), time].filter(Boolean).join(' '),
    locationName
  ].filter(Boolean).join('. ') + '.';
}

function RoleplayStatus({ processing, pendingCount }) {
  if (processing) {
    return (
      <span aria-hidden="true" className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-accent">
        <span className="inline-flex animate-spin motion-reduce:animate-none"><Loader2 className="h-4 w-4" /></span>
      </span>
    );
  }
  if (pendingCount > 0) {
    return (
      <span aria-hidden="true" className="inline-flex min-h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-accent px-1.5 text-[0.625rem] font-bold leading-none text-on-accent">
        {pendingCount > 99 ? '99+' : pendingCount}
      </span>
    );
  }
  /* Live state. Goes static as soon as there is something to review, so the
     motion always means "running", never "needs attention". */
  return (
    <span aria-hidden="true" className="relative inline-flex h-5 w-5 shrink-0 items-center justify-center">
      <span className="absolute h-2 w-2 animate-live-halo rounded-full bg-accent motion-reduce:animate-none" />
      <span className="relative h-2 w-2 animate-live-core rounded-full bg-accent motion-reduce:animate-none" />
    </span>
  );
}

function RecentTurn({ turn, names, definitions, open, onToggle, onResolve, resolvingChangeId }) {
  const point = turn.frame?.end;
  const date = point?.position ? formatTurnDate(point) : '';
  const time = point?.position ? `${String(point.position.hour ?? 0).padStart(2, '0')}:${String(point.position.minute ?? 0).padStart(2, '0')}` : '';
  const pending = turn.changes.filter(isPendingChange).length;
  return (
    <article className={`overflow-hidden rounded-card border transition-colors duration-200 ease-standard ${open ? 'border-accent/25 bg-accent/[0.035]' : 'border-border-subtle bg-surface-panel-muted/70 hover:bg-surface-panel-muted'}`}>
      <button type="button" aria-expanded={open} onClick={onToggle} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-control border border-accent/20 bg-accent/[0.06] text-accent"><Sparkles aria-hidden="true" className="h-3.5 w-3.5" /></span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-2 text-[0.6875rem] font-bold uppercase tracking-[0.09em] text-text-secondary">{turn.frame ? `Turn ${turn.turnNumber}` : 'Recent change'}{pending > 0 && <span className="rounded-full bg-status-warning/10 px-1.5 py-0.5 text-[0.625rem] text-status-warning">{pending} review</span>}</span>
          <span className="mt-0.5 block truncate text-[0.6875rem] text-text-subtle">{date}{date && time ? ' · ' : ''}{time}{point?.display?.weekdayName ? ` · ${point.display.weekdayName}` : ''}</span>
        </span>
        <ChevronRight aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 text-text-disabled transition-transform duration-200 ease-standard ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="animate-rise-in space-y-1.5 border-t border-border-subtle px-2.5 py-2.5">
          {turn.changes.map(change => (
            <RecentTurnChange
              key={`${change.kind}:${change.id}`}
              change={change}
              names={names}
              definitions={definitions}
              onResolve={onResolve}
              resolving={resolvingChangeId === change.id}
            />
          ))}
        </div>
      )}
    </article>
  );
}

function RecentTurnChange({ change, names, definitions, onResolve, resolving }) {
  const details = describeRecentChange(change, names, definitions);
  const pending = isPendingChange(change);
  return (
    <div className="rounded-control border border-border-subtle bg-surface-canvas/40 px-2.5 py-2">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-[0.625rem] font-bold uppercase tracking-[0.09em] text-accent/80">{changeLabel(change.kind)}</span>
            {change.status && <span className={`text-[0.625rem] font-semibold uppercase ${pending ? 'text-status-warning' : change.status === 'rejected' ? 'text-status-danger' : 'text-text-disabled'}`}>{change.status}</span>}
          </div>
          <div className="mt-1 space-y-1">
            {details.map((detail, index) => <p key={index} className="text-xs leading-relaxed text-text-secondary">{detail}</p>)}
          </div>
        </div>
        {pending && (
          <div className="flex shrink-0 items-center gap-1">
            <button type="button" disabled={resolving} onClick={() => onResolve(change, 'rejected')} className="rounded border border-status-danger/25 px-2 py-1 text-[0.625rem] font-semibold text-status-danger transition-colors hover:bg-status-danger/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger/40 disabled:opacity-50">Reject</button>
            <button type="button" disabled={resolving} onClick={() => onResolve(change, 'approved')} className="rounded bg-accent px-2 py-1 text-[0.625rem] font-bold text-on-accent transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/50 disabled:opacity-50">Approve</button>
          </div>
        )}
      </div>
    </div>
  );
}

function groupRecentTurns(configuration) {
  const frames = configuration.recentTurnFrames || [];
  const turns = new Map(frames.map(frame => [frame.originId, { ...frame, frame, changes: [] }]));
  const add = (originId, change) => {
    if (!originId) return;
    let turn = turns.get(originId);
    if (!turn) {
      turn = { originId, frame: null, turnNumber: null, createdAt: change.createdAt || 0, changes: [] };
      turns.set(originId, turn);
    }
    turn.createdAt = Math.max(turn.createdAt || 0, change.createdAt || 0);
    turn.changes.push(change);
  };
  (configuration.sceneChanges || []).forEach(change => add(change.provenanceId, { ...change, kind: 'scene' }));
  (configuration.inventoryChanges || []).forEach(change => add(change.provenanceId, { ...change, kind: 'inventory' }));
  (configuration.changes || []).forEach(change => add(change.provenanceId, { ...change, kind: 'resource' }));
  (configuration.entityChanges || []).forEach(change => add(change.provenanceId, { ...change, kind: 'entity' }));
  (configuration.narrativeEvents || []).forEach(record => {
    const originId = record.proposal?.evidence?.[0]?.originId;
    const event = record.proposal?.changeSet?.event;
    if (!originId || !event) return;
    add(originId, {
      id: event.id,
      kind: 'narrative',
      status: record.status,
      createdAt: Date.parse(record.proposal.provenance?.createdAt || '') || 0,
      record
    });
  });
  frames.forEach(frame => {
    if (frame.advance) add(frame.originId, { id: `${frame.originId}:time`, kind: 'time', status: 'applied', createdAt: frame.createdAt, frame });
  });
  return [...turns.values()]
    .filter(turn => turn.frame && turn.changes.length)
    .map(turn => ({ ...turn, changes: turn.changes.sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0)) }))
    .sort((left, right) => (right.frame?.createdAt || right.createdAt || 0) - (left.frame?.createdAt || left.createdAt || 0))
    .slice(0, 12);
}

function isPendingChange(change) {
  return change.status === 'pending' || change.status === 'proposed' || change.status === 'conflicting';
}

function changeLabel(kind) {
  return ({ scene: 'Scene', inventory: 'Inventory', resource: 'State', entity: 'Entity', narrative: 'Narrative', time: 'Time' })[kind] || 'Update';
}

function formatTurnDate(point) {
  const position = point.position;
  return `${position.day} ${point.display?.monthName || `Month ${position.month}`} ${position.year}${point.display?.eraShortName ? ` ${point.display.eraShortName}` : ''}`;
}

function describeRecentChange(change, names, definitions) {
  if (change.kind === 'scene') return describeSceneChange(change.patch, names);
  if (change.kind === 'inventory') return describeInventoryChange(change.patch, names);
  if (change.kind === 'resource') {
    const definition = definitions.find(item => item.id === change.definitionId);
    return [`${definition?.name || 'Tracked state'} for ${names.get(change.entityId) || 'entity'}: ${change.previousValue} → ${change.nextValue}`];
  }
  if (change.kind === 'entity') {
    if (change.identityUpdate) {
      const identity = change.identityUpdate;
      const details = [];
      if (identity.canonicalName) details.push(`Name: ${identity.previousCanonicalName} → ${identity.canonicalName}.`);
      if (identity.aliases?.length) details.push(`Aliases added to ${identity.canonicalName || identity.previousCanonicalName}: ${identity.aliases.join(', ')}.`);
      if (isPendingChange(change)) details.push('Awaiting identity review.');
      return details;
    }
    const label = change.proposal?.type?.replace(/s$/, '') || 'Entity';
    const action = change.createdEntity ? 'created' : isPendingChange(change) ? 'awaiting identity review' : 'matched';
    return [`${label} ${action}: ${change.proposal?.name || 'Unnamed entity'}`];
  }
  if (change.kind === 'narrative') {
    const proposal = change.record.proposal;
    const event = proposal.changeSet.event;
    const operations = proposal.changeSet.operations.map(operation => describeNarrativeOperation(operation, names)).filter(Boolean);
    return [event.description, ...operations];
  }
  if (change.kind === 'time') {
    const end = change.frame.end;
    return [`Time advanced to ${formatTurnDate(end)} at ${String(end.position.hour).padStart(2, '0')}:${String(end.position.minute).padStart(2, '0')}.`];
  }
  return ['Narrative State updated.'];
}

function describeSceneChange(patch, names) {
  const details = [];
  if (Object.hasOwn(patch || {}, 'locationId')) details.push(`Location changed to ${names.get(patch.locationId) || 'no current Location'}.`);
  if (patch?.participantIds) details.push(`Active characters: ${nameList(patch.participantIds, names)}.`);
  if (patch?.possibleObserverIds) details.push(`Possible observers: ${nameList(patch.possibleObserverIds, names)}.`);
  if (patch?.nearbyIds) details.push(`Nearby characters: ${nameList(patch.nearbyIds, names)}.`);
  if (patch?.objectIds) details.push(`Scene objects: ${nameList(patch.objectIds, names)}.`);
  return details.length ? details : ['Scene state updated.'];
}

function describeInventoryChange(patch, names) {
  const item = names.get(patch?.itemId) || 'Item';
  const quantity = patch?.quantity ? `${patch.quantity} × ` : '';
  const hasMove = Boolean(patch?.toHolderId || patch?.locationId || patch?.fromHolderId || patch?.fromLocationId);
  if (!hasMove && patch?.equipped !== undefined) {
    return [`${item} ${patch.equipped ? 'equipped' : 'unequipped'} by ${names.get(patch.holderId) || 'character'}.`];
  }
  const details = [];
  if (patch?.toHolderId) {
    const from = patch.fromHolderId || patch.fromLocationId;
    details.push(`${quantity}${item} moved${from ? ` from ${names.get(from) || 'its previous holder'}` : ''} to ${names.get(patch.toHolderId) || 'character'}.`);
  } else if (patch?.locationId) {
    const from = patch.fromHolderId || patch.fromLocationId;
    details.push(`${quantity}${item} moved${from ? ` from ${names.get(from) || 'its previous holder'}` : ''} to ${names.get(patch.locationId) || 'Location'}.`);
  } else if (patch?.fromHolderId || patch?.fromLocationId) {
    details.push(`${quantity}${item} removed from ${names.get(patch.fromHolderId || patch.fromLocationId) || 'its previous holder'}.`);
  }
  if (patch?.equipped !== undefined && patch?.fromHolderId) {
    details.push(`${item} was ${patch.equipped ? 'equipped for the recipient' : 'unequipped'} by ${names.get(patch.fromHolderId) || 'character'}.`);
  }
  return details.length ? details : [`${item} inventory state updated.`];
}

function describeNarrativeOperation(operation, names) {
  if (operation.type === 'assert-fact') return `Fact: ${describeProposition(operation.fact?.proposition, names)}`;
  if (operation.type === 'set-state') return `State: ${names.get(operation.state?.entityId) || 'Entity'} · ${operation.state?.property || 'property'} → ${displayValue(operation.state?.value)}`;
  if (operation.type === 'grant-awareness') return `${names.get(operation.awareness?.subjectId) || 'Entity'} became aware of ${names.get(operation.awareness?.targetId) || 'another entity'}.`;
  if (operation.type === 'grant-knowledge') {
    const knowledge = operation.knowledge;
    return `Knowledge: ${names.get(knowledge?.subjectId) || 'Entity'} learned ${describeProposition(knowledge?.proposition, names)} (${knowledge?.acquisition || 'acquired'}).`;
  }
  if (operation.type === 'set-belief') return `${names.get(operation.belief?.subjectId) || 'Entity'} now believes ${describeProposition(operation.belief?.proposition, names)}.`;
  if (operation.type === 'record-memory') return `Memory for ${names.get(operation.memory?.subjectId) || 'entity'}: ${operation.memory?.summary || 'Memory updated.'}`;
  if (operation.type === 'set-relationship') {
    const relationship = operation.relationship;
    const previous = Number.isFinite(relationship?.previousValue) ? relationship.previousValue : '?';
    return `Relationship bar: ${names.get(relationship?.sourceEntityId) || 'Entity'} → ${names.get(relationship?.targetEntityId) || 'Entity'} · ${previous} → ${relationship?.value}.`;
  }
  return null;
}

function describeProposition(proposition, names) {
  if (!proposition) return 'narrative fact updated';
  const subject = names.get(proposition.subjectId) || 'entity';
  return `${subject} · ${proposition.predicate || 'fact'}: ${displayValue(proposition.object)}`;
}

function displayValue(value) {
  if (typeof value === 'string') return value;
  if (value === null || value === undefined) return 'empty';
  return JSON.stringify(value);
}

function nameList(ids, names) {
  return ids?.length ? ids.map(id => names.get(id) || 'Unknown entity').join(', ') : 'none';
}

function TabButton({ active, onClick, icon: Icon, label, count }) {
  return <button type="button" onClick={onClick} aria-pressed={active} className={'flex items-center justify-center gap-2 rounded-control text-xs font-semibold transition-colors duration-200 ease-standard focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ' + (active ? 'bg-accent/10 text-accent' : 'text-text-muted hover:bg-surface-hover/60 hover:text-text-secondary')}><Icon aria-hidden="true" className="h-4 w-4" />{label}{count > 0 && <span className="rounded-full bg-surface-hover px-1.5 py-0.5 text-xs tabular-nums">{count}</span>}</button>;
}

function MenuAction({ onClick, icon: Icon, children, danger = false }) {
  return <button type="button" onClick={onClick} className={'flex w-full items-center gap-2 rounded-control px-2.5 py-2 text-left text-xs transition-colors hover:bg-surface-hover/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ' + (danger ? 'text-status-danger' : 'text-text-secondary hover:text-text-primary')}><Icon aria-hidden="true" className="h-3.5 w-3.5" />{children}</button>;
}

function EmptyState({ text }) {
  return <p className="rounded-card border border-dashed border-border-subtle px-3 py-5 text-center text-xs text-text-disabled">{text}</p>;
}

function presenceOf(entityId, scene) {
  if (scene.participantIds?.includes(entityId)) return 'participating';
  return 'nearby';
}

export default memo(RoleplayQuickPanel);
