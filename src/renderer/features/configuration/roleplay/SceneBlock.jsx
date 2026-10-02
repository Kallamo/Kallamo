import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import SearchableSelect from '../../../components/ui/SearchableSelect';
import { meta } from '../../worldbuild/worldbuildConfig';
import { FieldLabel, Help } from '../ConfigParts';

const entityOption = entity => ({
  id: entity.id,
  label: entity.canonicalName,
  aliases: Array.isArray(entity.aliases) ? entity.aliases : String(entity.aliases || '').split(',').map(alias => alias.trim()).filter(Boolean),
  group: meta(entity.type).label,
  dotClassName: meta(entity.type).dot
});

/** The live scene: who is played, where, who and what is present, and the situation. */
export default function SceneBlock({ sectionRef, settings, scene, groups, locationOptions, onSaveSettings, onSaveScene, onDraftSettings }) {
  const nearbyIds = [...new Set([...(scene.possibleObserverIds || []), ...(scene.nearbyIds || [])])];
  const actorOptions = groups.actors.map(entityOption);
  const locationChoices = locationOptions.map(option => ({ ...option, icon: undefined, dotClassName: 'bg-entity-location' }));
  const byId = new Map([...groups.actors, ...groups.items].map(entity => [entity.id, entity]));
  const present = new Set([settings.playerEntityId, ...(scene.participantIds || []), ...nearbyIds].filter(Boolean));

  return (
    <div ref={sectionRef} data-section="roleplay-scene" className="scroll-mt-6 border-t border-border-subtle pt-5">
      <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <h3 className="text-sm font-semibold text-text-primary">Scene</h3>
        <Help>Used on the next turn. The Roleplay panel in the chat changes the same scene.</Help>
      </div>

      <div className="mt-3.5 grid gap-4 md:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <FieldLabel>Player character</FieldLabel>
          <SearchableSelect ariaLabel="Player character" value={settings.playerEntityId || ''} onChange={value => onSaveSettings({ playerEntityId: value || null })} options={actorOptions} placeholder="Choose a character" searchInTrigger clearable={false} />
          <Help>Whose eyes the story follows.</Help>
        </div>
        <div className="flex flex-col gap-1.5">
          <FieldLabel>Location</FieldLabel>
          <SearchableSelect ariaLabel="Location" value={scene.locationId || ''} onChange={value => onSaveScene({ locationId: value || null })} options={locationChoices} placeholder="Choose a location" searchInTrigger clearable={false} />
          <Help>Where the scene is happening.</Help>
        </div>
      </div>

      <div className="mt-4">
        <ChipRow
          label="Taking part"
          help="In the scene with you."
          ids={(scene.participantIds || []).filter(id => id !== settings.playerEntityId)}
          byId={byId}
          options={actorOptions.map(option => present.has(option.id) ? { ...option, disabled: true, disabledLabel: 'In scene' } : option)}
          onAdd={id => onSaveScene({ participantIds: [...new Set([...(scene.participantIds || []), id])] })}
          onRemove={id => onSaveScene({ participantIds: (scene.participantIds || []).filter(item => item !== id) })}
          addLabel="Add someone taking part"
        />
        <ChipRow
          label="Nearby"
          help="Around, not in it. The AI decides what they notice."
          ids={nearbyIds}
          byId={byId}
          options={actorOptions.map(option => present.has(option.id) ? { ...option, disabled: true, disabledLabel: 'In scene' } : option)}
          onAdd={id => onSaveScene({ possibleObserverIds: [], nearbyIds: [...nearbyIds, id] })}
          onRemove={id => onSaveScene({ possibleObserverIds: [], nearbyIds: nearbyIds.filter(item => item !== id) })}
          addLabel="Add someone nearby"
        />
        <ChipRow
          label="Objects here"
          help="Being here doesn't change who owns them."
          ids={scene.objectIds || []}
          byId={byId}
          options={groups.items.map(entityOption).map(option => (scene.objectIds || []).includes(option.id) ? { ...option, disabled: true, disabledLabel: 'Here' } : option)}
          onAdd={id => onSaveScene({ objectIds: [...new Set([...(scene.objectIds || []), id])] })}
          onRemove={id => onSaveScene({ objectIds: (scene.objectIds || []).filter(item => item !== id) })}
          addLabel="Add an object"
          emptyText="Nothing"
        />
        <div className="grid gap-4 border-t border-border-subtle pt-3.5 md:grid-cols-[9.5rem_minmax(0,1fr)]">
          <div>
            <span className="block text-[0.8125rem] font-semibold text-text-secondary">Scenario</span>
            <Help className="mt-0.5">Optional. The immediate situation, without changing Worldbuild canon.</Help>
          </div>
          <div className="flex flex-col gap-2.5">
            <input
              aria-label="Scenario name"
              className="field-input h-10 px-3 text-sm"
              value={settings.scenarioName || ''}
              onChange={event => onDraftSettings({ scenarioName: event.target.value })}
              onBlur={() => onSaveSettings({ scenarioName: settings.scenarioName || '' })}
              placeholder="Name, e.g. Siege at dawn"
            />
            <textarea
              aria-label="What is happening right now"
              className="field-input min-h-20 resize-none px-3 py-2.5 text-sm leading-relaxed custom-scrollbar"
              value={settings.scenarioSummary || ''}
              onChange={event => onDraftSettings({ scenarioSummary: event.target.value })}
              onBlur={() => onSaveSettings({ scenarioSummary: settings.scenarioSummary || '' })}
              placeholder="What is happening right now"
            />
          </div>
        </div>
      </div>
    </div>
  );
}

function ChipRow({ label, help, ids, byId, options, onAdd, onRemove, addLabel, emptyText = 'No one' }) {
  const [adding, setAdding] = useState(false);
  return (
    <div className="grid gap-4 border-t border-border-subtle py-3.5 md:grid-cols-[9.5rem_minmax(0,1fr)]">
      <div>
        <span className="block text-[0.8125rem] font-semibold text-text-secondary">{label}</span>
        <Help className="mt-0.5">{help}</Help>
      </div>
      <div className="flex min-w-0 flex-wrap items-center gap-1.5">
        {!ids.length && !adding && <span className="mr-1 text-xs text-text-subtle">{emptyText}</span>}
        {ids.map(id => {
          const entity = byId.get(id);
          const name = entity?.canonicalName || 'Unknown';
          return (
            <span key={id} className="inline-flex h-7 items-center gap-1.5 rounded-control bg-white/[0.06] pl-2.5 pr-1 text-[0.8125rem] text-text-primary">
              <span aria-hidden="true" className={`h-2 w-2 rounded-full ${entity ? meta(entity.type).dot : 'bg-text-subtle'}`} />
              <span className="max-w-[14rem] truncate">{name}</span>
              <button type="button" onClick={() => onRemove(id)} aria-label={`Remove ${name}`} className="inline-flex h-5 w-5 items-center justify-center rounded text-text-subtle hover:bg-white/10 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                <X aria-hidden="true" className="h-3.5 w-3.5" />
              </button>
            </span>
          );
        })}
        {adding ? (
          <SearchableSelect
            className="w-64"
            value=""
            onChange={id => { setAdding(false); if (id) onAdd(id); }}
            onClose={() => setAdding(false)}
            options={options}
            placeholder={addLabel}
            searchPlaceholder="Search"
            ariaLabel={addLabel}
            searchInTrigger
            autoOpen
          />
        ) : (
          <button type="button" onClick={() => setAdding(true)} className="inline-flex h-7 items-center gap-1 rounded-control border border-dashed border-border-default px-2.5 text-xs font-semibold text-text-muted hover:border-border-strong hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
            <Plus aria-hidden="true" className="h-3.5 w-3.5" />Add
          </button>
        )}
      </div>
    </div>
  );
}
