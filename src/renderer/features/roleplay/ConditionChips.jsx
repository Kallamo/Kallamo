import { useState } from 'react';
import { Plus, X } from 'lucide-react';
import SearchableSelect from '../../components/ui/SearchableSelect';
import { formatMinutes } from '../configuration/roleplay/ConditionsSection';

/** What still ends a held condition, as the tooltip says it. */
function heldDetail(condition) {
  return [
    condition.cause,
    condition.startedLabel ? `Since ${condition.startedLabel}.` : '',
    condition.timeLeftMinutes ? `Wears off in ${formatMinutes(condition.timeLeftMinutes)}.` : '',
    condition.sleepLeftMinutes ? `Passes after ${formatMinutes(condition.sleepLeftMinutes)} of sleep.` : '',
    condition.restLeftMinutes ? `Passes after ${formatMinutes(condition.restLeftMinutes)} of rest.` : '',
    condition.endsWhen ? `Ends ${condition.endsWhen}.` : '',
    condition.source === 'threshold' ? 'Follows its resource.' : ''
  ].filter(Boolean).join(' ');
}

/** The conditions someone has now, each removable, and a way to give them one by hand. */
export default function ConditionChips({ held, catalog, onAdd, onRemove }) {
  const [adding, setAdding] = useState(false);
  const heldIds = new Set(held.map(condition => condition.conditionId));
  const options = catalog.map(condition => heldIds.has(condition.id)
    ? { id: condition.id, label: condition.name, disabled: true, disabledLabel: 'Has it' }
    : { id: condition.id, label: condition.name });
  if (adding) {
    return (
      <SearchableSelect
        value=""
        onChange={conditionId => { setAdding(false); if (conditionId) onAdd(conditionId); }}
        onClose={() => setAdding(false)}
        options={options}
        placeholder="Add a condition"
        searchPlaceholder="Search conditions"
        ariaLabel="Add a condition"
        searchInTrigger
        autoOpen
      />
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {held.map(condition => (
        <span
          key={condition.conditionId}
          data-tooltip={heldDetail(condition) || undefined}
          className="inline-flex h-6 max-w-full items-center gap-1.5 rounded-full border border-border-subtle bg-surface-canvas/50 pl-2 pr-1 text-[0.6875rem] font-semibold text-text-secondary"
        >
          <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: condition.color }} />
          <span className="truncate">{condition.name}</span>
          <button
            type="button"
            aria-label={`Remove ${condition.name}`}
            onClick={() => onRemove(condition.conditionId)}
            className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-text-subtle transition-colors hover:bg-tint/[0.08] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <X aria-hidden="true" className="h-3 w-3" />
          </button>
        </span>
      ))}
      {catalog.length > 0 && (
        <button
          type="button"
          onClick={() => setAdding(true)}
          aria-label="Add a condition"
          data-tooltip="Add a condition"
          className="inline-flex h-6 items-center gap-1 rounded-full border border-dashed border-border-subtle px-2 text-[0.6875rem] font-medium text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
        >
          <Plus aria-hidden="true" className="h-3 w-3" />
          {held.length ? null : 'Condition'}
        </button>
      )}
    </div>
  );
}
