import { useState } from 'react';
import { Upload } from 'lucide-react';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import { ChoiceCard } from '../configuration/ConfigParts';

const STYLE = { levels: 'Levels and attributes', off: 'no progression' };

const list = names => names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];

function describeResources(resources) {
  const parts = [];
  if (resources.changed.length) parts.push(`${list(resources.changed)} ${resources.changed.length === 1 ? 'exists' : 'exist'} in both with other settings.`);
  if (resources.added.length) parts.push(`${list(resources.added)} ${resources.added.length === 1 ? 'is' : 'are'} new.`);
  return parts.join(' ') || 'Same as here.';
}

function describeProgression(rules) {
  if (rules.progression === 'same') return 'Same as here.';
  if (rules.progression === 'none') return 'None in the package.';
  if (rules.progression === 'added') return `${STYLE[rules.packageProgressionMode]}. This world has none yet.`;
  return `${STYLE[rules.packageProgressionMode]}, set up differently from this world.`;
}

/** A package with rules of its own: keep this world's, take the package's, or leave them out. */
export default function RulesImportDialog({ inspected, onCancel, onImport }) {
  const [mode, setMode] = useState('merge');
  const [busy, setBusy] = useState(false);
  const { rules } = inspected;
  const run = async () => {
    setBusy(true);
    try { await onImport(mode); } finally { setBusy(false); }
  };
  return (
    <Modal title="The package has its own rules" icon={Upload} iconClassName="text-text-muted" onClose={() => { if (!busy) onCancel(); }} size="lg">
      <div className="flex flex-col gap-3.5 px-6 py-5">
        <p className="text-sm leading-relaxed text-text-secondary">Its {inspected.entities} {inspected.entities === 1 ? 'entity comes' : 'entities come'} in for review as always. Its roleplay rules differ from this world's:</p>
        <dl className="flex flex-col gap-1.5 rounded-card border border-border-subtle bg-surface-canvas/45 px-3.5 py-3 text-[0.8125rem]">
          <div className="flex gap-3"><dt className="w-24 shrink-0 text-xs font-semibold text-text-muted">Resources</dt><dd className="text-text-secondary">{describeResources(rules.resources)}</dd></div>
          <div className="flex gap-3"><dt className="w-24 shrink-0 text-xs font-semibold text-text-muted">Progression</dt><dd className="text-text-secondary">{describeProgression(rules)}</dd></div>
          <div className="flex gap-3"><dt className="w-24 shrink-0 text-xs font-semibold text-text-muted">Time costs</dt><dd className="text-text-secondary">{rules.timeCosts === 'different' ? 'Different ranges.' : rules.timeCosts === 'same' ? 'Same ranges.' : 'None in the package.'}</dd></div>
        </dl>
        <div role="radiogroup" aria-label="What to do with the rules" className="flex flex-col gap-2">
          <ChoiceCard name="rules-import" selected={mode === 'merge'} onSelect={() => setMode('merge')} title="Keep this world's rules, add what is new" description="New resources come in. Everything this world already has stays as it is." />
          <ChoiceCard name="rules-import" selected={mode === 'replace'} onSelect={() => setMode('replace')} title="Use the package's rules" description="Its resources, progression and time costs replace these. Characters keep their values where the resource still exists." />
          <ChoiceCard name="rules-import" selected={mode === 'skip'} onSelect={() => setMode('skip')} title="Leave the rules out" description="Only the entities come in." />
        </div>
        {inspected.currentValues && mode !== 'skip' && <p className="text-xs leading-relaxed text-text-subtle">The package also carries its characters' current values. They go to the imported characters.</p>}
      </div>
      <div className="flex justify-end gap-2 border-t border-border-subtle px-6 py-3.5">
        <Button variant="ghost" disabled={busy} onClick={onCancel}>Cancel import</Button>
        <Button variant="primary" loading={busy} onClick={run}>Continue</Button>
      </div>
    </Modal>
  );
}
