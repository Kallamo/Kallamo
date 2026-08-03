import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Backpack, Check, ChevronRight, Clock3, Drama, Image as ImageIcon, MapPin,
  MoreVertical, Pencil, Plus, Settings2, Sparkles, Swords, Users, X
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

export default function RoleplayQuickPanel({
  workspaceId,
  api,
  showToast,
  onOpenConfiguration,
  onBackgroundChange
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [tab, setTab] = useState('scene');
  const [settings, setSettings] = useState({});
  const [scene, setScene] = useState(EMPTY_SCENE);
  const [calendar, setCalendar] = useState(null);
  const [clock, setClock] = useState(null);
  const [clockDraft, setClockDraft] = useState(null);
  const [editingClock, setEditingClock] = useState(false);
  const [entities, setEntities] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [inventory, setInventory] = useState([]);
  const [background, setBackground] = useState(null);
  const [addingCharacter, setAddingCharacter] = useState(false);
  const [openMenuId, setOpenMenuId] = useState(null);
  const [transfer, setTransfer] = useState(null);
  const [recentOpen, setRecentOpen] = useState(false);
  const [recentChanges, setRecentChanges] = useState([]);
  const [pendingCount, setPendingCount] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const backgroundInputRef = useRef(null);

  const load = useCallback(async () => {
    const [configuration, worldbuild, uiState, templateResult] = await Promise.all([
      api.getRoleplayConfiguration(workspaceId),
      api.listEntities(workspaceId),
      api.getWorkspaceUiState?.(workspaceId, 'roleplay-quick-panel'),
      api.listWorldbuildEntityTemplates?.(workspaceId)
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
    const recent = [
      ...(configuration.sceneChanges || []).map(change => ({ ...change, kind: 'Scene' })),
      ...(configuration.inventoryChanges || []).map(change => ({ ...change, kind: 'Inventory' }))
    ].filter(change => change.status === 'applied').slice(-8).reverse();
    setRecentChanges(recent);
    setPendingCount([
      ...(configuration.sceneChanges || []),
      ...(configuration.inventoryChanges || []),
      ...(configuration.changes || []),
      ...(configuration.entityChanges || []),
      ...(configuration.narrativeEvents || [])
    ].filter(change => change.status === 'pending' || change.status === 'proposed' || change.status === 'conflicting').length);
    if (uiState?.value && typeof uiState.value.collapsed === 'boolean') setCollapsed(uiState.value.collapsed);
    if (nextSettings.playerEntityId) {
      const result = await api.getRoleplayInventory(workspaceId, nextSettings.playerEntityId);
      if (result?.success) setInventory(result.inventory || []);
    } else {
      setInventory([]);
    }
    if (nextScene.locationId) {
      const result = await api.getRoleplayLocationBackground(workspaceId, nextScene.locationId);
      const nextBackground = result?.success ? result.background : null;
      setBackground(nextBackground);
      onBackgroundChange(nextBackground);
    } else {
      setBackground(null);
      onBackgroundChange(null);
    }
  }, [api, onBackgroundChange, workspaceId]);

  useEffect(() => {
    load().catch(error => showToast(error.message, 'error'));
  }, [load, refreshKey, showToast]);

  useEffect(() => {
    const refresh = event => {
      if (!event.detail?.workspaceId || event.detail.workspaceId === workspaceId) {
        setRefreshKey(value => value + 1);
      }
    };
    window.addEventListener('roleplay-state-change', refresh);
    const unsubscribe = api.onRoleplayResourceChanges?.(payload => {
      if (payload?.workspaceId === workspaceId) setRefreshKey(value => value + 1);
    });
    return () => {
      window.removeEventListener('roleplay-state-change', refresh);
      unsubscribe?.();
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
  const savePanelState = async nextCollapsed => {
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

  const openConfiguration = () => {
    onOpenConfiguration();
    requestAnimationFrame(() => requestAnimationFrame(() => {
      window.dispatchEvent(new CustomEvent('configuration-open-section', { detail: { sectionId: 'roleplay' } }));
    }));
  };

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => savePanelState(false)}
        aria-label="Open Roleplay panel"
        className="group absolute bottom-5 right-5 z-30 flex h-11 w-11 items-center justify-center rounded-xl border border-accent/35 bg-surface-panel/95 text-accent shadow-xl backdrop-blur-md transition-colors hover:bg-surface-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        <Drama className="h-5 w-5" />
        <span className="absolute right-1.5 top-1.5 h-1.5 w-1.5 animate-pulse rounded-full bg-accent" />
        <SceneSummaryTooltip
          player={player}
          participants={otherCharacters.filter(entity => scene.participantIds?.includes(entity.id))}
          nearby={otherCharacters.filter(entity => !scene.participantIds?.includes(entity.id))}
          locationName={names.get(scene.locationId)}
          calendar={calendar}
          clock={clock}
        />
      </button>
    );
  }

  return (
    <aside className="relative z-20 flex h-full w-[22.5rem] shrink-0 flex-col border-l border-border-subtle bg-surface-sidebar/90 shadow-2xl backdrop-blur-xl 2xl:w-[23.5rem]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border-subtle px-4">
        <button type="button" onClick={openConfiguration} className="flex items-center gap-2 text-accent" title="Open Roleplay Mode settings">
          <span className="h-2 w-2 animate-pulse rounded-full bg-accent" />
          <span className="text-xs font-bold uppercase tracking-[0.16em]">RP Mode</span>
          {pendingCount > 0 && <span className="rounded-full bg-accent px-1.5 text-xs text-on-accent">{pendingCount}</span>}
        </button>
        <div className="flex items-center gap-1">
          <button type="button" onClick={openConfiguration} className="rounded-lg p-2 text-gray-500 hover:bg-white/5 hover:text-accent" title="Roleplay Mode settings"><Settings2 className="h-4 w-4" /></button>
          <button type="button" onClick={() => savePanelState(true)} className="rounded-lg p-2 text-gray-500 hover:bg-white/5 hover:text-white" title="Minimize panel"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </header>

      <section className="shrink-0 border-b border-white/10 bg-black/10 px-4 py-3">
        {editingClock && calendar ? (
          <div className="space-y-2">
            <WorldDateInput calendar={calendar} value={clockDraft} includeTime allowClear={false} onChange={setClockDraft} />
            <div className="flex justify-end gap-1">
              <button type="button" onClick={() => { setClockDraft(clock); setEditingClock(false); }} className="rounded-md p-1.5 text-gray-500 hover:text-white"><X className="h-3.5 w-3.5" /></button>
              <button type="button" onClick={saveClock} className="rounded-md bg-accent p-1.5 text-[#011419]"><Check className="h-3.5 w-3.5" /></button>
            </div>
          </div>
        ) : (
          <button type="button" onClick={() => setEditingClock(true)} className="group/clock flex w-full items-center justify-between gap-3 text-left">
            <div className="min-w-0">
              <span className="block truncate text-xs font-bold uppercase tracking-[0.12em] text-text-muted">{formatWorldDate(calendar, clock)}</span>
              <span className="mt-0.5 block font-mono text-2xl font-semibold tracking-tight text-gray-100">{String(clock?.hour ?? 0).padStart(2, '0')}:{String(clock?.minute ?? 0).padStart(2, '0')}</span>
              {clock?.season && <span className="mt-0.5 block truncate text-xs text-text-subtle">{clock.season.name}</span>}
            </div>
            <Pencil className="h-3.5 w-3.5 text-gray-600 group-hover/clock:text-accent" />
          </button>
        )}
      </section>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 custom-scrollbar">
        {tab === 'scene' ? (
          <div className="space-y-5">
            <section>
              <div className="mb-2.5 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-100">Active Characters</h3>
                <button type="button" onClick={() => setAddingCharacter(value => !value)} className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-semibold text-accent hover:bg-accent/10"><Plus className="h-3.5 w-3.5" />Add</button>
              </div>
              {addingCharacter && (
                <div className="mb-2 rounded-xl border border-accent/20 bg-accent/[0.04] p-2">
                  <SearchableSelect
                    value=""
                    onChange={addCharacter}
                    options={actorOptions.filter(option => !presentIds.has(option.id))}
                    placeholder="Search characters"
                  />
                </div>
              )}
              <div className="space-y-2">
                {player ? <CharacterCard entity={player} protagonist typeLabel={typeLabels.get(player.type)} /> : <EmptyState text="Choose a Player Character in Roleplay Mode settings." />}
                <div className={(presentIds.size >= 5 ? 'max-h-[17rem] overflow-y-auto pr-1 custom-scrollbar' : '') + ' space-y-2'}>
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
                  {!otherCharacters.length && player && <p className="px-2 py-3 text-center text-xs text-gray-600">No one else is present.</p>}
                </div>
              </div>
            </section>

            <section>
              <label className="mb-2 block text-sm font-semibold text-gray-100">Current Location</label>
              <SearchableSelect
                value={scene.locationId || ''}
                onChange={locationId => saveScene({ locationId: locationId || null })}
                options={locationOptions}
                placeholder="Select a Location"
              />
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-100">Location Background</h3>
                {background?.imagePath && !background.inherited && (
                  <button type="button" onClick={removeBackground} className="text-xs font-semibold text-text-muted hover:text-status-danger">Remove</button>
                )}
              </div>
              <button
                type="button"
                disabled={!scene.locationId}
                onClick={() => backgroundInputRef.current?.click()}
                className="group relative flex h-32 w-full items-center justify-center overflow-hidden rounded-xl border border-border-subtle bg-surface-panel-muted disabled:cursor-not-allowed disabled:opacity-50"
                style={background?.imagePath ? {
                  backgroundImage: `url("app-file:///${background.imagePath.replace(/\\/g, '/')}")`,
                  backgroundPosition: 'center',
                  backgroundSize: 'cover'
                } : {}}
              >
                <div className={'absolute inset-0 rounded-[inherit] transition-colors ' + (background?.imagePath ? 'bg-black/0 group-hover:bg-black/50 group-focus-visible:bg-black/50' : 'bg-transparent')} />
                <div className={'relative flex flex-col items-center gap-2 transition-opacity ' + (background?.imagePath ? 'opacity-0 text-accent group-hover:opacity-100 group-focus-visible:opacity-100' : 'text-gray-500 group-hover:text-accent')}>
                  <ImageIcon className="h-6 w-6" />
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

            {!!recentChanges.length && (
              <section className="border-t border-white/10 pt-3">
                <button type="button" onClick={() => setRecentOpen(value => !value)} className="flex w-full items-center justify-between text-xs font-semibold text-gray-400 hover:text-white">
                  <span className="inline-flex items-center gap-2"><Sparkles className="h-3.5 w-3.5 text-accent" />Recent Changes</span>
                  <ChevronRight className={'h-3.5 w-3.5 transition-transform ' + (recentOpen ? 'rotate-90' : '')} />
                </button>
                {recentOpen && <div className="mt-2 space-y-1.5">{recentChanges.map(change => <RecentChange key={change.id} change={change} names={names} />)}</div>}
              </section>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-xl border border-accent/15 bg-accent/[0.04] p-3">
              <Avatar entity={player} />
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold text-gray-100">{player?.canonicalName || 'No controlled character'}</p>
                <p className="text-xs uppercase tracking-wider text-accent">Current inventory</p>
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

      <footer className="grid h-14 shrink-0 grid-cols-2 gap-1 border-t border-white/10 bg-[#020e13]/90 p-2">
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
    <article data-roleplay-menu-root className={'relative flex items-center gap-2.5 rounded-xl border p-2.5 transition-colors ' + (protagonist ? 'border-accent/35 bg-accent/[0.07]' : `${typeMeta.ring} bg-[#07151b]/90`)}>
      <Avatar entity={entity} protagonist={protagonist} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={'truncate text-xs font-semibold uppercase tracking-wider ' + typeMeta.soft}>{typeLabel || typeMeta.label}</span>
          <span className="text-xs text-text-disabled">·</span>
          {protagonist
            ? <span className="shrink-0 rounded-md bg-accent/15 px-1.5 py-0.5 text-xs font-bold uppercase tracking-wider text-accent">Playing</span>
            : <span className="inline-flex shrink-0 items-center gap-1 text-xs text-text-muted"><PresenceIcon className="h-3 w-3" />{presenceConfig.label}</span>}
        </div>
        <p className="mt-0.5 truncate text-sm font-semibold text-gray-100">{entity.canonicalName}</p>
      </div>
      {!protagonist && (
        <button ref={menuButtonRef} type="button" onClick={onMenu} className="rounded-lg p-1.5 text-gray-500 hover:bg-white/5 hover:text-white"><MoreVertical className="h-4 w-4" /></button>
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

function Avatar({ entity, protagonist = false, compact = false }) {
  const image = entity?.data?.image || entity?.data?.imagePath || entity?.data?.avatar;
  return (
    <div
      className={'flex shrink-0 items-center justify-center overflow-hidden border bg-surface-canvas font-bold ' + (compact ? 'h-7 w-7 rounded-lg text-xs ' : 'h-10 w-10 rounded-xl text-sm ') + (protagonist ? 'border-accent/50 text-accent' : 'border-border-subtle text-text-muted')}
      style={image ? { backgroundImage: `url("app-file:///${String(image).replace(/\\/g, '/')}")`, backgroundPosition: 'center', backgroundSize: 'cover' } : {}}
    >
      {!image && (entity?.canonicalName?.[0] || '?')}
    </div>
  );
}

function InventorySection({ title, items, empty, openMenuId, onMenu, onToggle, onTransfer }) {
  return (
    <section>
      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-500">{title}</h3>
      <div className="space-y-2">
        {items.map(item => <InventoryItemCard key={item.itemId} item={item} menuOpen={openMenuId === item.itemId} onMenu={() => onMenu(openMenuId === item.itemId ? null : item.itemId)} onCloseMenu={() => onMenu(null)} onToggle={onToggle} onTransfer={onTransfer} />)}
        {!items.length && <p className="rounded-xl border border-dashed border-white/10 px-3 py-5 text-center text-xs text-gray-600">{empty}</p>}
      </div>
    </section>
  );
}

function InventoryItemCard({ item, menuOpen, onMenu, onCloseMenu, onToggle, onTransfer }) {
  const menuButtonRef = useRef(null);
  const ItemIcon = itemMeta(item.data?.itemType).icon;
  return (
    <article data-roleplay-menu-root className={'relative flex items-center gap-2.5 rounded-xl border p-2.5 transition-colors ' + (item.equipped ? 'border-status-info/35 bg-status-info/[0.07]' : 'border-border-subtle bg-surface-panel-muted/90')}>
      <div className={'flex h-9 w-9 items-center justify-center rounded-lg border bg-surface-canvas ' + (item.equipped ? 'border-status-info/30 text-status-info' : 'border-border-default text-entity-item')}><ItemIcon className="h-4 w-4" /></div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-text-primary">{item.name}</p>
        <p className={'text-xs ' + (item.equipped ? 'text-status-info' : 'text-text-muted')}>{item.equipped ? 'Equipped' : item.nature === 'unique' ? 'Unique item' : `Quantity ${item.quantity}`}</p>
      </div>
      <button ref={menuButtonRef} type="button" aria-label={`Actions for ${item.name}`} onClick={onMenu} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-text-muted hover:bg-white/5 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"><MoreVertical className="h-4 w-4" /></button>
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
          <input type="number" min="1" max={item.quantity} value={transfer.quantity} onChange={event => setTransfer({ ...transfer, quantity: event.target.value })} className="min-h-10 w-20 rounded-lg border border-border-default bg-surface-input px-2 text-right text-sm text-text-primary outline-none focus:border-accent/50 focus:ring-2 focus:ring-accent/20" />
        </label>
      )}
      <button type="button" onClick={onApply} className="min-h-10 w-full rounded-lg border border-accent/30 bg-accent/10 px-4 text-sm font-semibold text-accent hover:bg-accent/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">Apply move</button>
    </section>
  );
}

function SceneSummaryTooltip({ player, participants, nearby, locationName, calendar, clock }) {
  const actors = [
    player,
    ...participants.filter(entity => entity.id !== player?.id),
    ...nearby.filter(entity => entity.id !== player?.id)
  ].filter(Boolean);
  const visibleActors = actors.slice(0, COLLAPSED_ACTOR_LIMIT);
  const overflowCount = actors.length - visibleActors.length;
  return (
    <div className="pointer-events-none absolute bottom-full right-0 mb-3 hidden w-56 rounded-xl border border-border-default bg-surface-panel/98 p-3 text-left shadow-2xl group-hover:block group-focus-visible:block">
      <span className="mb-2 block text-xs font-bold uppercase tracking-[0.16em] text-accent/80">RP Mode</span>
      <span className="mb-2 flex items-start gap-2 border-b border-white/[0.07] pb-2.5">
        <Clock3 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sky-300" />
        <span className="min-w-0"><span className="block truncate text-xs font-medium text-text-secondary">{formatWorldDate(calendar, clock)}</span><span className="block font-mono text-xs text-text-muted">{String(clock?.hour ?? 0).padStart(2, '0')}:{String(clock?.minute ?? 0).padStart(2, '0')}{clock?.season ? ` · ${clock.season.name}` : ''}</span></span>
      </span>
      <div className="flex flex-wrap items-center gap-1.5">
        {visibleActors.map(entity => (
          <div key={entity.id} title={entity.canonicalName}>
            <Avatar entity={entity} protagonist={entity.id === player?.id} compact />
          </div>
        ))}
        {overflowCount > 0 && <span className="flex h-7 min-w-7 items-center justify-center rounded-lg border border-border-default bg-surface-panel-muted px-1 text-xs font-semibold text-text-secondary">+{overflowCount}</span>}
        {!visibleActors.length && <span className="text-xs text-text-muted">No active characters</span>}
      </div>
      <span className="mt-3 flex items-center gap-2 border-t border-white/[0.07] pt-2.5">
        <MapPin className="h-3.5 w-3.5 shrink-0 text-emerald-300" />
        <span className="truncate text-xs font-medium text-text-secondary">{locationName || 'No current Location'}</span>
      </span>
    </div>
  );
}

function RecentChange({ change, names }) {
  const detail = change.kind === 'Scene'
    ? describeSceneChange(change.patch, names)
    : `${names.get(change.patch?.itemId) || 'Item'} updated`;
  return <div className="rounded-lg border border-border-subtle bg-surface-panel-muted px-2.5 py-2"><p className="text-xs font-semibold text-text-secondary">{change.kind}</p><p className="mt-0.5 truncate text-xs text-text-subtle">{detail}</p></div>;
}

function TabButton({ active, onClick, icon: Icon, label, count }) {
  return <button type="button" onClick={onClick} className={'flex items-center justify-center gap-2 rounded-lg text-xs font-semibold transition-colors ' + (active ? 'bg-accent/10 text-accent' : 'text-text-muted hover:bg-white/5 hover:text-text-secondary')}><Icon className="h-4 w-4" />{label}{count > 0 && <span className="rounded-full bg-white/[0.07] px-1.5 py-0.5 text-xs">{count}</span>}</button>;
}

function MenuAction({ onClick, icon: Icon, children, danger = false }) {
  return <button type="button" onClick={onClick} className={'flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors hover:bg-white/5 ' + (danger ? 'text-status-danger' : 'text-text-secondary hover:text-text-primary')}><Icon className="h-3.5 w-3.5" />{children}</button>;
}

function EmptyState({ text }) {
  return <p className="rounded-xl border border-dashed border-white/10 px-3 py-5 text-center text-xs text-gray-600">{text}</p>;
}

function presenceOf(entityId, scene) {
  if (scene.participantIds?.includes(entityId)) return 'participating';
  return 'nearby';
}

function describeSceneChange(patch, names) {
  if (patch?.locationId) return `Location changed to ${names.get(patch.locationId) || 'another Location'}`;
  if (patch?.participantIds) return 'Active character roster updated';
  if (patch?.possibleObserverIds || patch?.nearbyIds) return 'Nearby characters updated';
  return 'Scene state updated';
}
