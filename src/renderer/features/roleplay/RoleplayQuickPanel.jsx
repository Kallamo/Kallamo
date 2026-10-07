import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Backpack, Check, ChevronRight, Clock3, PanelRightClose, Plus, Settings2, X } from 'lucide-react';
import SearchableSelect from '../../components/ui/SearchableSelect';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import IconButton from '../../components/ui/IconButton';
import { locationPresenceOptions, meta } from '../worldbuild/worldbuildConfig';
import { locationSizeLabel } from '../../../shared/location-sizes';
import WorldDateInput from '../worldbuild/WorldDateInput';
import { PortraitContext, usePortraits } from '../worldbuild/portraits';
import {
  CastGroup, CastRow, InventoryTab, LocationHero, PanelClock, PanelTabs, PlayerCard, RoleplayRail, RoleplayStatus, SectionHead
} from './RoleplayPanelParts';
import { kindOf } from './changeKinds';

const EMPTY_SCENE = {
  locationId: null,
  participantIds: [],
  possibleObserverIds: [],
  nearbyIds: [],
  objectIds: []
};

const RECENT_TURN_LIMIT = 5;
const EMPTY_VITALS = { resources: new Map(), progress: null };

function RoleplayQuickPanel({
  workspaceId,
  api,
  showToast,
  onOpenConfiguration,
  onBackgroundChange,
  onCollapsedChange,
  onPlayerChange,
  onNamesChange,
  narrativeStateProcessing = false,
  initialCollapsed = false,
  visible = true
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
  const [vitals, setVitals] = useState(EMPTY_VITALS);
  const [background, setBackground] = useState(null);
  const [addingCharacter, setAddingCharacter] = useState(false);
  const [transfer, setTransfer] = useState(null);
  const [showAllTurns, setShowAllTurns] = useState(false);
  const [recentTurns, setRecentTurns] = useState([]);
  const [expandedTurnId, setExpandedTurnId] = useState(null);
  const [resolvingChangeId, setResolvingChangeId] = useState(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [refreshKey, setRefreshKey] = useState(0);
  const backgroundInputRef = useRef(null);
  const refreshFrameRef = useRef(null);
  const wasVisibleRef = useRef(visible);

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
    // The player shows every resource and their progression; others only their first resource.
    const vitalsPromise = configurationPromise.then(async configuration => {
      const playerEntityId = configuration?.settings?.playerEntityId;
      const present = configuration?.scene
        ? [...new Set([...(configuration.scene.participantIds || []), ...(configuration.scene.possibleObserverIds || []), ...(configuration.scene.nearbyIds || [])])]
        : [];
      const ids = [...new Set([playerEntityId, ...present].filter(Boolean))];
      const [resourceResults, progressResult] = await Promise.all([
        Promise.all(ids.map(id => api.getRoleplayEntityResources(workspaceId, id).catch(() => null))),
        playerEntityId ? api.getRoleplayEntityProgress?.(workspaceId, playerEntityId).catch(() => null) : null
      ]);
      return {
        resources: new Map(ids.map((id, index) => [id, resourceResults[index]?.success ? resourceResults[index].resources || [] : []])),
        progress: progressResult?.success ? progressResult.progress : null
      };
    });
    const [configuration, worldbuild, templateResult, inventoryResult, backgroundResult, vitalsResult] = await Promise.all([
      configurationPromise,
      api.listEntities(workspaceId),
      api.listWorldbuildEntityTemplates?.(workspaceId),
      inventoryPromise,
      backgroundPromise,
      vitalsPromise
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
      ...(configuration.progressChanges || []),
      ...(configuration.entityChanges || []),
      ...(configuration.narrativeEvents || [])
    ].filter(change => change.status === 'pending' || change.status === 'proposed' || change.status === 'conflicting').length);
    setInventory(inventoryResult?.success ? inventoryResult.inventory || [] : []);
    setVitals(vitalsResult || EMPTY_VITALS);
    const nextBackground = backgroundResult?.success ? backgroundResult.background : null;
    setBackground(nextBackground);
    onBackgroundChange(nextBackground);
  }, [api, onBackgroundChange, workspaceId]);

  useEffect(() => {
    load().catch(error => showToast(error.message, 'error'));
  }, [load, refreshKey, showToast]);

  // The panel stays mounted behind other workspace tabs, where edits do not all announce
  // themselves; coming back re-reads the scene instead of trusting what it last loaded.
  useEffect(() => {
    if (visible && !wasVisibleRef.current) setRefreshKey(value => value + 1);
    wasVisibleRef.current = visible;
  }, [visible]);

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
  const locationOptions = useMemo(() => locationPresenceOptions(groups.locations), [groups.locations]);
  const player = groups.actors.find(entity => entity.id === settings.playerEntityId);
  // Each reload rebuilds the map; the chat only hears about it when a name really changed,
  // since every message row re-renders on a new one.
  const namesSignatureRef = useRef('');
  useEffect(() => {
    const signature = [...names].map(([id, name]) => id + '=' + name).join('|');
    if (signature === namesSignatureRef.current) return;
    namesSignatureRef.current = signature;
    onNamesChange?.(names);
  }, [names, onNamesChange]);
  useEffect(() => {
    onPlayerChange?.(player?.canonicalName || null);
  }, [onPlayerChange, player?.canonicalName]);
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
  };

  const removeCharacter = async entityId => {
    await saveScene({
      participantIds: (scene.participantIds || []).filter(id => id !== entityId),
      possibleObserverIds: (scene.possibleObserverIds || []).filter(id => id !== entityId),
      nearbyIds: (scene.nearbyIds || []).filter(id => id !== entityId)
    });
  };

  const toggleEquipped = async item => {
    const result = await api.setRoleplayEquipped(workspaceId, settings.playerEntityId, item.itemId, !item.equipped);
    if (!result?.success) return showToast(result?.error || 'Could not update equipment.', 'error');
    setInventory(result.inventory || []);
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
      progress: api.resolveRoleplayProgressChange,
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

  const openPanel = async target => {
    if (target === 'inventory') setTab('inventory');
    else if (target) setTab('scene');
    if (target === 'clock') setEditingClock(true);
    await savePanelState(false);
  };

  if (collapsed) {
    return (
      <RoleplayRail
        statusLabel={roleplayStatusLabel}
        processing={narrativeStateProcessing}
        pendingCount={pendingCount}
        calendar={calendar}
        clock={clock}
        player={player}
        others={otherCharacters}
        locationName={names.get(scene.locationId)}
        locationType={locationOptions.find(option => option.id === scene.locationId)?.group}
        presenceOf={entityId => presenceOf(entityId, scene)}
        typeLabels={typeLabels}
        inventoryCount={inventory.length}
        onOpen={openPanel}
      />
    );
  }

  const participants = otherCharacters.filter(entity => presenceOf(entity.id, scene) === 'participating');
  const nearby = otherCharacters.filter(entity => presenceOf(entity.id, scene) === 'nearby');
  const castRow = entity => (
    <CastRow
      key={entity.id}
      entity={entity}
      typeLabel={typeLabels.get(entity.type)}
      presence={presenceOf(entity.id, scene)}
      mark={vitals.resources.get(entity.id)?.[0] || null}
      onPlay={() => setPlayer(entity.id)}
      onPresence={presence => changePresence(entity.id, presence)}
      onRemove={() => removeCharacter(entity.id)}
    />
  );
  const visibleTurns = showAllTurns ? recentTurns : recentTurns.slice(0, RECENT_TURN_LIMIT);

  return (
    <aside aria-label="Roleplay" className="glass-rail glass-dense relative z-20 flex h-full pt-10 w-[clamp(18rem,30vw,22.5rem)] shrink-0 flex-col border-l border-border-subtle shadow-2xl 2xl:w-[23.5rem]">
      <header className="flex h-14 shrink-0 items-center justify-between border-b border-border-subtle pl-4 pr-3">
        <div className="flex min-w-0 items-center gap-2.5 text-accent">
          <RoleplayStatus processing={narrativeStateProcessing} pendingCount={pendingCount} />
          <span className="min-w-0">
            <span className="block text-xs font-bold uppercase tracking-[0.16em]">Roleplay</span>
            {(narrativeStateProcessing || pendingCount > 0) && (
              <span className="mt-0.5 block truncate text-[0.6875rem] font-medium text-text-subtle">{roleplayStatusLabel}</span>
            )}
          </span>
        </div>
        <div className="flex items-center gap-0.5">
          <IconButton icon={Settings2} label="Roleplay settings" size="sm" onClick={openConfiguration} />
          <IconButton icon={PanelRightClose} label="Collapse panel" size="sm" onClick={() => savePanelState(true)} />
        </div>
      </header>

      {editingClock && calendar ? (
        <section className="shrink-0 space-y-3 border-b border-border-subtle bg-surface-canvas/40 px-4 py-3">
          <WorldDateInput calendar={calendar} value={clockDraft} includeTime allowClear={false} label="Roleplay date and time" emptyLabel="Set date and time" onChange={setClockDraft} />
          <div className="flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => { setClockDraft(clock); setEditingClock(false); }}>Cancel</Button>
            <Button variant="primary" size="sm" icon={Check} onClick={saveClock}>Save time</Button>
          </div>
        </section>
      ) : (
        <PanelClock calendar={calendar} clock={clock} onEdit={() => setEditingClock(true)} />
      )}

      <PanelTabs tab={tab} onChange={setTab} inventoryCount={inventory.length} />

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-4 pt-2 custom-scrollbar">
        {tab === 'scene' ? (
          <div className="space-y-5">
            <section>
              <LocationHero
                locationId={scene.locationId}
                locationName={names.get(scene.locationId)}
                locationOptions={locationOptions}
                onChangeLocation={locationId => saveScene({ locationId: locationId || null })}
                background={background}
                inheritedFrom={background?.inherited ? (names.get(background.sourceLocationId) || 'a parent location') : null}
                onChooseBackground={() => backgroundInputRef.current?.click()}
                onRemoveBackground={removeBackground}
              />
              <input ref={backgroundInputRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="hidden" onChange={uploadBackground} />
            </section>

            <section>
              <SectionHead title="In scene">
                <Button variant="subtle" size="sm" icon={Plus} aria-expanded={addingCharacter} onClick={() => setAddingCharacter(value => !value)}>Add</Button>
              </SectionHead>
              {addingCharacter && (
                <div className="mb-2 animate-rise-in">
                  <SearchableSelect
                    value=""
                    onChange={addCharacter}
                    onClose={() => setAddingCharacter(false)}
                    options={actorOptions.map(option => presentIds.has(option.id) || option.id === settings.playerEntityId
                      ? { ...option, disabled: true, disabledLabel: 'In scene' }
                      : option)}
                    placeholder="Add a character"
                    searchPlaceholder="Search characters"
                    ariaLabel="Add a character to the scene"
                    searchInTrigger
                    autoOpen
                  />
                </div>
              )}
              {player
                ? <PlayerCard entity={player} typeLabel={typeLabels.get(player.type)} resources={vitals.resources.get(player.id) || []} progress={vitals.progress?.entityId === player.id ? vitals.progress : null} />
                : <p className="rounded-card border border-dashed border-border-subtle px-3 py-5 text-center text-xs text-text-disabled">Choose who you play in Roleplay settings.</p>}
              {participants.length > 0 && <CastGroup presence="participating" count={participants.length}>{participants.map(castRow)}</CastGroup>}
              {nearby.length > 0 && <CastGroup presence="nearby" count={nearby.length}>{nearby.map(castRow)}</CastGroup>}
              {!otherCharacters.length && player && <p className="px-2 pt-3 text-center text-xs text-text-disabled">No one else is here.</p>}
            </section>

            {recentTurns.length > 0 && (
              <section>
                <SectionHead title="Recent changes" />
                <ol className="relative">
                  {visibleTurns.map((turn, index) => (
                    <RecentTurn
                      key={turn.key}
                      turn={turn}
                      last={index === visibleTurns.length - 1}
                      names={names}
                      definitions={definitions}
                      open={expandedTurnId === turn.key}
                      onToggle={() => setExpandedTurnId(current => current === turn.key ? null : turn.key)}
                      onResolve={resolveRecentChange}
                      resolvingChangeId={resolvingChangeId}
                    />
                  ))}
                </ol>
                {recentTurns.length > RECENT_TURN_LIMIT && (
                  <button
                    type="button"
                    onClick={() => setShowAllTurns(value => !value)}
                    className="ml-8 mt-1.5 rounded-md px-1 text-xs font-semibold text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  >
                    {showAllTurns ? 'Show fewer' : 'Show all turns'}
                  </button>
                )}
              </section>
            )}
          </div>
        ) : (
          <InventoryTab player={player} inventory={inventory} onToggle={toggleEquipped} onTransfer={setTransfer} />
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
    </aside>
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
      <Button variant="primary" fullWidth onClick={onApply}>Apply move</Button>
    </section>
  );
}


function turnTitle(turn) {
  if (turn.manual) return 'You';
  return turn.frame ? `Turn ${turn.turnNumber}` : 'Recent change';
}

// Story turns carry the in-game moment; the player's own edits need no date at all.
function turnMoment(turn) {
  const point = turn.frame?.end;
  if (turn.manual || !point?.position) return '';
  const time = `${String(point.position.hour ?? 0).padStart(2, '0')}:${String(point.position.minute ?? 0).padStart(2, '0')}`;
  return `${formatTurnDate(point)} · ${time}`;
}

function RecentTurn({ turn, last, names, definitions, open, onToggle, onResolve, resolvingChangeId }) {
  const pending = turn.changes.filter(isPendingChange).length;
  const kinds = [...new Set(turn.changes.map(change => change.kind))];
  const moment = turnMoment(turn);
  const weekday = turn.frame?.end?.display?.weekdayName;
  return (
    <li className="relative">
      {!last && <span aria-hidden="true" className="absolute bottom-[-0.5rem] left-[0.9375rem] top-5 w-px bg-border-subtle" />}
      <button
        type="button"
        aria-expanded={open}
        onClick={onToggle}
        data-tooltip={moment && weekday ? `${moment} · ${weekday}` : undefined}
        className={`relative flex w-full items-center gap-3 rounded-lg px-2 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${open ? 'bg-tint/[0.05]' : 'hover:bg-tint/[0.03]'}`}
      >
        <span className="flex w-3.5 shrink-0 justify-center">
          <span aria-hidden="true" className={`h-2.5 w-2.5 rounded-full border ${turn.manual ? 'border-accent' : 'border-entity-event'} ${open ? (turn.manual ? 'bg-accent' : 'bg-entity-event') : 'bg-surface-panel'}`} />
        </span>
        <span className="flex min-w-0 flex-1 items-baseline gap-2 text-[0.8125rem]">
          <span className={`shrink-0 font-semibold ${turn.manual ? 'text-accent' : 'text-entity-event'}`}>{turnTitle(turn)}</span>
          {moment && <span className="truncate text-xs text-text-muted tabular-nums">{moment}</span>}
        </span>
        {pending > 0 && <span className="shrink-0 rounded-full bg-status-warning/12 px-2 py-0.5 text-[0.6875rem] font-semibold text-status-warning">{pending} to review</span>}
        <span aria-hidden="true" className="flex shrink-0 gap-1">
          {kinds.map(kind => <span key={kind} className={`h-[0.4375rem] w-[0.4375rem] rounded-full ${kindOf(kind).dot}`} />)}
        </span>
        <ChevronRight aria-hidden="true" className={`h-3.5 w-3.5 shrink-0 text-text-disabled transition-transform duration-200 ease-standard ${open ? 'rotate-90' : ''}`} />
      </button>
      {open && (
        <div className="mb-2 ml-8 mt-0.5 space-y-1.5 animate-rise-in">
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
    </li>
  );
}

function RecentTurnChange({ change, names, definitions, onResolve, resolving }) {
  const [lead, ...details] = describeRecentChange(change, names, definitions);
  const pending = isPendingChange(change);
  const kind = kindOf(change.kind);
  const rejected = change.status === 'rejected';
  return (
    <article className="rounded-lg border border-border-subtle bg-surface-canvas/40 px-3 py-2.5">
      <div className="mb-1.5 flex flex-wrap items-center gap-2">
        <span className={`inline-flex h-5 items-center rounded-md px-2 text-[0.6875rem] font-semibold ${kind.chip}`}>{kind.label}</span>
        {change.status && (
          <span className={`inline-flex items-center gap-1 text-[0.6875rem] ${pending ? 'text-status-warning' : rejected ? 'text-status-danger' : 'text-text-muted'}`}>
            {pending ? <Clock3 aria-hidden="true" className="h-3 w-3" /> : rejected ? <X aria-hidden="true" className="h-3 w-3" /> : <Check aria-hidden="true" className="h-3 w-3 text-status-success" />}
            {change.status.charAt(0).toUpperCase() + change.status.slice(1)}
          </span>
        )}
      </div>
      {lead && <p className="text-[0.8125rem] leading-relaxed text-text-secondary">{lead}</p>}
      {details.map((detail, index) => (
        <p key={index} className="mt-1 flex gap-2 text-xs leading-relaxed text-text-muted">
          <span aria-hidden="true" className={kind.bullet}>•</span>
          <span className="min-w-0">{detail}</span>
        </p>
      ))}
      {pending && (
        <div className="mt-2 flex justify-end gap-1.5">
          <Button variant="ghost" size="sm" disabled={resolving} onClick={() => onResolve(change, 'rejected')}>Reject</Button>
          <Button variant="primary" size="sm" disabled={resolving} onClick={() => onResolve(change, 'approved')}>Approve</Button>
        </div>
      )}
    </article>
  );
}

// What a manual edit changes; a later edit to the same thing replaces the earlier one.
function manualTarget(change) {
  if (change.kind === 'scene') return 'scene';
  if (change.kind === 'inventory') return `inventory:${change.patch?.itemId}`;
  if (change.kind === 'resource') return `resource:${change.definitionId}:${change.entityId}`;
  return `${change.kind}:${change.id}`;
}

// Turns come from message frames. Edits made in the panel have none, so every edit made
// since the last story turn gathers into one "You" entry, keeping only the latest edit of
// each thing; the next turn starts a new one. Without them the panel could not explain a
// change it shows.
function groupRecentTurns(configuration) {
  const frames = configuration.recentTurnFrames || [];
  const turns = new Map(frames.map(frame => [frame.originId, { ...frame, key: frame.originId, frame, changes: [] }]));
  const turnBefore = time => frames.reduce((latest, frame) => (frame.createdAt <= time ? frame.originId : latest), 'start');
  const add = (originId, change) => {
    if (!originId) return;
    const key = change.source === 'manual' ? `manual:after:${turnBefore(change.createdAt || 0)}` : originId;
    let turn = turns.get(key);
    if (!turn) {
      turn = { key, originId, frame: null, turnNumber: null, manual: change.source === 'manual', createdAt: change.createdAt || 0, changes: [] };
      turns.set(key, turn);
    }
    turn.createdAt = Math.max(turn.createdAt || 0, change.createdAt || 0);
    turn.changes.push(change);
  };
  (configuration.sceneChanges || []).forEach(change => add(change.provenanceId, { ...change, kind: 'scene' }));
  (configuration.inventoryChanges || []).forEach(change => add(change.provenanceId, { ...change, kind: 'inventory' }));
  (configuration.changes || []).forEach(change => add(change.provenanceId, { ...change, kind: 'resource' }));
  const traitNames = new Map((configuration.traits || []).map(trait => [trait.id, trait.name]));
  (configuration.progressChanges || []).forEach(change => add(change.provenanceId, { ...change, kind: 'progress', progressKind: change.kind, traitName: traitNames.get(change.traitId) }));
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
    .filter(turn => (turn.frame || turn.manual) && turn.changes.length)
    .map(turn => {
      const ordered = turn.changes.sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0));
      if (!turn.manual) return { ...turn, changes: ordered };
      const latest = new Map(ordered.map(change => [manualTarget(change), change]));
      return { ...turn, changes: [...latest.values()].sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0)) };
    })
    .sort((left, right) => (right.manual ? right.createdAt : right.frame?.createdAt || right.createdAt || 0) - (left.manual ? left.createdAt : left.frame?.createdAt || left.createdAt || 0))
    .slice(0, 12);
}

function isPendingChange(change) {
  return change.status === 'pending' || change.status === 'proposed' || change.status === 'conflicting';
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
    const delta = change.delta ?? change.nextValue - change.previousValue;
    const amount = change.status === 'pending' ? `${delta > 0 ? '+' : '−'}${Math.abs(delta)}` : `${change.previousValue} → ${change.nextValue}`;
    return [`${definition?.name || 'Tracked state'} for ${names.get(change.entityId) || 'entity'}: ${amount}`, ...(change.reason ? [change.reason] : [])];
  }
  if (change.kind === 'progress') {
    const who = names.get(change.entityId) || 'Someone';
    const lead = change.progressKind === 'xp'
      ? `${who}: XP ${change.delta > 0 ? '+' : '−'}${Math.abs(change.delta)}`
      : change.progressKind === 'level'
        ? `${who} reached level ${change.nextValue}`
        : `${who}: ${change.traitName || 'Attribute'} ${change.previousValue} → ${change.nextValue}`;
    return [lead, ...(change.reason ? [change.reason] : [])];
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
    const lines = [`${label} ${action}: ${change.proposal?.name || 'Unnamed entity'}`];
    if (change.proposal?.type === 'Locations' && (change.proposal.size || change.proposal.insideId)) {
      const size = locationSizeLabel(change.proposal.size) || 'Location';
      const parent = change.proposal.insideId ? names.get(change.proposal.insideId) : null;
      lines.push(parent ? `${size} inside ${parent}.` : `${size}.`);
    }
    return lines;
  }
  if (change.kind === 'narrative') {
    const proposal = change.record.proposal;
    const event = proposal.changeSet.event;
    const operations = proposal.changeSet.operations.map(operation => describeNarrativeOperation(operation, names)).filter(Boolean);
    return [event.description, ...operations];
  }
  if (change.kind === 'time') {
    const end = change.frame.end;
    const advance = change.frame.advance;
    const details = [`Time advanced to ${formatTurnDate(end)} at ${String(end.position.hour).padStart(2, '0')}:${String(end.position.minute).padStart(2, '0')}.`];
    // A jump of days or more is the one time change worth reading twice, and a bound that
    // fired is the only sign the campaign clock did not do what the turn asked for.
    const skipped = describeElapsed(advance?.duration);
    if (skipped) details.push(`Elapsed: ${skipped}.`);
    if (advance?.clamped) details.push(`Limited from a requested ${describeElapsed(advance.requestedDuration) || 'longer span'}.`);
    if (advance?.raisedToMinimum) details.push('Raised to the minimum this move costs.');
    return details;
  }
  return ['Narrative State updated.'];
}

/** A duration in words, and nothing at all when it is under a day. */
function describeElapsed(duration) {
  if (!duration) return '';
  const parts = [
    [duration.years, 'year'],
    [duration.months, 'month'],
    [duration.days, 'day'],
    [duration.hours, 'hour']
  ].filter(([value]) => value > 0);
  if (!parts.length || (!duration.years && !duration.months && !duration.days)) return '';
  return parts.map(([value, unit]) => `${value} ${unit}${value === 1 ? '' : 's'}`).join(', ');
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
  if (operation.type === 'set-state') return `State: ${names.get(operation.state?.entityId) || 'Entity'} · ${operation.state?.property || 'property'} → ${displayValue(operation.state?.value, names)}`;
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
  return `${subject} · ${proposition.predicate || 'fact'}: ${displayValue(proposition.object, names)}`;
}

// Values may hold entity ids (a location, an owner); show the name the user knows.
function displayValue(value, names) {
  if (typeof value === 'string') return names.get(value) || value;
  if (Array.isArray(value) && value.every(item => typeof item === 'string')) return value.map(item => names.get(item) || item).join(', ');
  if (value === null || value === undefined) return 'empty';
  return JSON.stringify(value);
}

function nameList(ids, names) {
  return ids?.length ? ids.map(id => names.get(id) || 'Unknown entity').join(', ') : 'none';
}

function presenceOf(entityId, scene) {
  if (scene.participantIds?.includes(entityId)) return 'participating';
  return 'nearby';
}

// Portraits reach every avatar in the panel through context, loaded once per workspace.
function RoleplayQuickPanelWithPortraits(props) {
  const portraits = usePortraits(props.workspaceId, props.api);
  return <PortraitContext.Provider value={portraits}><RoleplayQuickPanel {...props} /></PortraitContext.Provider>;
}

export default memo(RoleplayQuickPanelWithPortraits);
