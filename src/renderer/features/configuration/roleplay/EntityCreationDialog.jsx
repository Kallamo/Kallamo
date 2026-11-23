import { useState } from 'react';
import { SquarePlus } from 'lucide-react';
import Modal from '../../../components/ui/Modal';
import Button from '../../../components/ui/Button';
import SegmentedControl from '../../../components/ui/SegmentedControl';
import { meta } from '../../worldbuild/worldbuildConfig';
import { DEFAULT_ENTITY_CREATION_POLICY, normalizeEntityCreationPolicy } from '../../../../shared/entity-creation-policy';

const MODES = [
  { value: 'off', label: 'Off' },
  { value: 'review', label: 'Review' },
  { value: 'auto', label: 'Automatic' }
];

export const CREATION_GROUPS = [
  { label: 'People', type: 'Characters', rows: [
    { kind: 'characters', label: 'Characters', noun: 'characters', description: 'Someone who appears with a name, a title or a role that stays.' },
    { kind: 'races', label: 'Races', noun: 'races', description: 'A new people. Turn it on if your world grows its peoples in play.' }
  ] },
  { label: 'Creatures', type: 'Creatures', rows: [
    { kind: 'creatures', label: 'Specific creatures', noun: 'creatures', description: 'One being you could point at, of a species the world already has.' },
    { kind: 'species', label: 'Species groups', noun: 'species groups', description: 'A kind of creature, like a pack or a breed, never one of them.' }
  ] },
  { label: 'Items', type: 'Items', rows: [
    { kind: 'named', label: 'Named items', noun: 'named items', description: 'A unique thing with a name, a mark or an owner of its own.' },
    { kind: 'ordinary', label: 'Ordinary items', noun: 'ordinary items', description: 'Common things like rope or a lantern. Inventory already keeps them.' }
  ] },
  { label: 'Locations', type: 'Locations', rows: [
    { kind: 'spots', label: 'Spots', noun: 'spots', description: 'A room or corner inside a place.' },
    { kind: 'places', label: 'Places', noun: 'places', description: 'Somewhere a scene happens.' },
    { kind: 'areas', label: 'Areas', noun: 'areas', description: 'A district or stretch that holds many places.' },
    { kind: 'regions', label: 'Regions', noun: 'regions', description: 'Land wider than any scene.' }
  ] }
];

const ROWS = CREATION_GROUPS.flatMap(group => group.rows);

/** One line on what the AI creates on its own and what it asks about first. Review everything holds back Automatic too. */
export function describeCreationPolicy(value, updatePolicy) {
  const policy = normalizeEntityCreationPolicy(value);
  const effective = kind => (updatePolicy === 'review' && policy[kind] === 'auto' ? 'review' : policy[kind]);
  const nouns = mode => ROWS.filter(row => effective(row.kind) === mode).map(row => row.noun);
  const auto = nouns('auto');
  const review = nouns('review');
  const parts = [
    auto.length ? `On its own: ${auto.join(', ')}.` : '',
    review.length ? `Asks first: ${review.join(', ')}.` : ''
  ].filter(Boolean);
  return parts.length ? parts.join(' ') : 'The AI creates nothing new.';
}

/** Off, Review or Automatic for each kind of thing a scene can bring into the world. */
export default function EntityCreationDialog({ value, updatePolicy, onSave, onClose }) {
  const [policy, setPolicy] = useState(() => normalizeEntityCreationPolicy(value));
  const change = (kind, mode) => {
    const next = { ...policy, [kind]: mode };
    setPolicy(next);
    onSave(next);
  };
  const reset = () => {
    const next = { ...DEFAULT_ENTITY_CREATION_POLICY };
    setPolicy(next);
    onSave(next);
  };

  return (
    <Modal
      title="What the AI may create"
      icon={SquarePlus}
      iconClassName="text-text-secondary"
      subtitle="New people, things and places that show up in a scene. Review puts them in the story at once and waits for you before they join Worldbuild."
      onClose={onClose}
      size="xl"
      className="max-h-[calc(100vh-2rem)]"
    >
      <div className="flex min-h-0 flex-1 flex-col gap-4.5 overflow-y-auto overscroll-contain custom-scrollbar px-6 py-5">
        {CREATION_GROUPS.map(group => (
          <div key={group.label}>
            <div className="mb-1.5 flex items-center gap-2 text-xs font-semibold text-text-muted">
              <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${meta(group.type).dot}`} />
              {group.label}
            </div>
            <div className="divide-y divide-border-subtle overflow-hidden rounded-card border border-border-subtle bg-surface-inset">
              {group.rows.map(row => (
                <div key={row.kind} className="flex items-center gap-3.5 px-3.5 py-2.5">
                  <div className="min-w-0 flex-1">
                    <span className="block text-[0.8125rem] font-semibold text-text-secondary">{row.label}</span>
                    <span className="block text-xs leading-relaxed text-text-subtle">{row.description}</span>
                  </div>
                  <SegmentedControl label={row.label} value={policy[row.kind]} options={MODES} onChange={mode => change(row.kind, mode)} className="shrink-0 flex-nowrap" />
                </div>
              ))}
            </div>
          </div>
        ))}
        <p className="text-xs leading-relaxed text-text-subtle">
          A spot or place is created only inside an area or place that already exists. Off keeps what the turn says about it unattached, never pinned to something else.
          {updatePolicy === 'review' && ' While changes are set to Review everything, Automatic ones wait for you too.'}
        </p>
      </div>
      <div className="flex shrink-0 items-center gap-2 border-t border-border-subtle px-6 py-3.5">
        <Button variant="subtle" size="sm" onClick={reset}>Reset to defaults</Button>
        <span className="flex-1" />
        <Button variant="primary" onClick={onClose} autoFocus>Done</Button>
      </div>
    </Modal>
  );
}
