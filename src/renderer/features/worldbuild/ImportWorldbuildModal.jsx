import React, { useState } from 'react';
import { CalendarDays, Check, Eye, Info, Link, Plus, Scale, Upload, Image as ImageIcon } from 'lucide-react';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import { RadioCard, ToneTile, TypeStrip, megabytes } from '../../components/modals/ModalParts';

const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;
const PROGRESSION = { levels: 'Levels', off: 'No progression' };

// Each rule chip says where it ends up: kept from this world, taken from the package, new, or removed.
const CHIP = {
  yours: { color: 'var(--theme-text-secondary)', borderColor: 'var(--theme-border-default)' },
  theirs: { color: 'var(--theme-status-info)', borderColor: 'color-mix(in srgb, var(--theme-status-info) 40%, transparent)' },
  new: { color: 'var(--theme-status-success)', borderColor: 'color-mix(in srgb, var(--theme-status-success) 40%, transparent)' },
  gone: { color: 'var(--theme-text-subtle)', borderColor: 'var(--theme-border-subtle)', textDecoration: 'line-through' },
};
const KIND_LABEL = { yours: 'kept', theirs: 'from the package', new: 'new', gone: 'removed' };

function Outcome({ chips, note }) {
  return (
    <span className="ml-7 mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border-subtle pt-2.5">
      <span className="mr-1 text-xs font-semibold text-text-muted">You get</span>
      {chips.length ? chips.map(chip => (
        <span key={`${chip.kind}-${chip.name}`} data-tooltip={KIND_LABEL[chip.kind]} className="inline-flex h-6 items-center rounded-full border px-2 text-xs font-medium" style={CHIP[chip.kind]}>{chip.name}</span>
      )) : <span className="text-xs text-text-subtle">No resources</span>}
      {note && <span className="text-xs text-text-subtle">· {note}</span>}
    </span>
  );
}

function outcomes(rules) {
  const local = rules.localResources || [];
  const incoming = rules.packageResources || [];
  const localSet = new Set(local);
  const incomingSet = new Set(incoming);
  const progression = (mode, attributes) => mode === 'levels' ? `levels, ${plural(attributes, 'attribute', 'attributes')}` : 'no progression';
  const localProgression = progression(rules.localProgressionMode, rules.localAttributes || 0);
  const packageProgression = progression(rules.packageProgressionMode, rules.packageAttributes || 0);
  // A world without progression of its own takes the package's even when it keeps its rules.
  const mergeTakesProgression = rules.localProgressionMode === 'off' && !rules.localAttributes;
  return {
    merge: {
      chips: [...local.map(name => ({ name, kind: 'yours' })), ...incoming.filter(name => !localSet.has(name)).map(name => ({ name, kind: 'new' }))],
      note: mergeTakesProgression ? `the package's ${packageProgression}` : `your ${localProgression}`,
    },
    replace: {
      chips: [...incoming.map(name => ({ name, kind: localSet.has(name) ? 'theirs' : 'new' })), ...local.filter(name => !incomingSet.has(name)).map(name => ({ name, kind: 'gone' }))],
      note: `its ${packageProgression}`,
    },
    skip: {
      chips: local.map(name => ({ name, kind: 'yours' })),
      note: `your ${localProgression}`,
    },
  };
}

function RulesCompare({ rules }) {
  const describe = (resources, mode, attributes) => ({
    resources: resources.length ? resources.join(', ') : 'None',
    progression: mode === 'levels' ? `${PROGRESSION.levels}, ${plural(attributes || 0, 'attribute', 'attributes')}` : PROGRESSION.off,
  });
  const mine = describe(rules.localResources || [], rules.localProgressionMode, rules.localAttributes);
  const theirs = describe(rules.packageResources || [], rules.packageProgressionMode, rules.packageAttributes);
  const differs = { resources: rules.resources.changed.length + rules.resources.added.length > 0, progression: rules.progression === 'different' || rules.progression === 'added', skills: rules.skills === 'different' || rules.skills === 'added' };
  const skills = count => (count ? plural(count, 'skill', 'skills') : 'None');
  const time = rules.timeCosts === 'same' ? 'The same' : rules.timeCosts === 'different' ? 'Different ranges' : 'None';
  const rows = [
    ['Resources', mine.resources, theirs.resources, differs.resources],
    ['Progression', mine.progression, theirs.progression, differs.progression],
    ['Skills', skills(rules.localSkills || 0), skills(rules.packageSkills || 0), differs.skills],
    ['Time costs', 'Yours', time, rules.timeCosts === 'different'],
  ];
  return (
    <div className="rounded-control border px-4 pb-1" style={{ background: 'var(--theme-surface-well)', borderColor: 'var(--theme-border-well)' }}>
      <table className="w-full border-separate" style={{ borderSpacing: 0 }}>
        <thead>
          <tr>
            <th className="w-[6.5rem]" />
            <th className="pb-1.5 pt-2.5 text-left text-xs font-semibold text-text-primary">This world</th>
            <th className="pb-1.5 pt-2.5 text-left text-xs font-semibold text-text-primary">The package</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([label, a, b, changed]) => (
            <tr key={label}>
              <th className="border-t border-border-subtle py-2 pr-3 text-left text-xs font-semibold text-text-muted">{label}</th>
              <td className="border-t border-border-subtle py-2 pr-3 text-[0.8125rem] text-text-secondary">{a}</td>
              <td className={`border-t border-border-subtle py-2 text-[0.8125rem] ${changed ? 'text-status-warning' : 'text-text-muted'}`}>{b}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Everything a .klwb brings, how it lands, and the two choices it needs, before anything is written. */
export default function ImportWorldbuildModal({ inspected, workspaceName = null, currentDate = null, onCancel, onImport }) {
  const { rules, calendar } = inspected;
  const hasRuleChoice = Boolean(rules?.localRules && rules?.differs);
  const canTakeCalendar = Boolean(calendar && !calendar.same && !calendar.datesThatDoNotFit);
  const [rulesMode, setRulesMode] = useState('merge');
  const [calendarMode, setCalendarMode] = useState(calendar && !calendar.same && calendar.datesThatDoNotFit === 0 && !inspected.worldHasEntities ? 'replace' : 'keep');
  const [busy, setBusy] = useState(false);
  const ends = rules ? outcomes(rules) : null;

  const run = async () => {
    setBusy(true);
    try { await onImport({ rulesMode: rules ? rulesMode : 'merge', calendarMode: calendar && !calendar.same ? calendarMode : null }); } finally { setBusy(false); }
  };

  const left = (
    <div className="min-w-0 flex-1 space-y-4">
      <div className="space-y-2.5">
        <p className="text-xs font-semibold text-text-primary">In the package</p>
        <TypeStrip counts={inspected.typeCounts} />
        <div className="divide-y divide-border-subtle rounded-control border" style={{ background: 'var(--theme-surface-well)', borderColor: 'var(--theme-border-well)' }}>
          <div className="flex items-center gap-3 px-4 py-3">
            <Eye className="h-4 w-4 shrink-0 text-status-info" aria-hidden="true" />
            <p className="text-[0.8125rem] leading-relaxed text-text-secondary"><b className="font-semibold text-text-primary">{plural(inspected.entities, 'new entity', 'new entities')}, for review.</b> Nothing changes your world until you accept or dismiss each one in the sidebar.</p>
          </div>
          {(inspected.links > 0 || inspected.images > 0) && (
            <div className="flex items-center gap-3 px-4 py-3">
              {inspected.images > 0 ? <ImageIcon className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" /> : <Link className="h-4 w-4 shrink-0 text-text-muted" aria-hidden="true" />}
              <p className="text-[0.8125rem] leading-relaxed text-text-secondary">
                {inspected.links > 0 && <><b className="font-semibold text-text-primary">{plural(inspected.links, 'link', 'links')}</b> between them</>}
                {inspected.links > 0 && inspected.images > 0 && ', and '}
                {inspected.images > 0 && <><b className="font-semibold text-text-primary">{plural(inspected.images, 'image', 'images')}</b> with their sheets</>}.
              </p>
            </div>
          )}
        </div>
      </div>
      {calendar && !calendar.same && (
        <div>
          <p className="mb-2 flex items-center gap-2 text-xs font-semibold text-text-primary"><CalendarDays className="h-3.5 w-3.5 text-entity-event" aria-hidden="true" />Calendar</p>
          <div role="radiogroup" aria-label="Calendar" className="space-y-2">
            <RadioCard
              name="import-calendar"
              selected={calendarMode === 'keep'}
              onSelect={() => setCalendarMode('keep')}
              title="Keep this world's calendar"
              description="Imported dates are read in it."
              aside={<span className="shrink-0 text-right"><span className="block text-xs font-semibold text-text-secondary">{calendar.currentName}</span>{currentDate && <span className="block text-xs text-text-subtle">{currentDate}</span>}</span>}
            />
            <RadioCard
              name="import-calendar"
              selected={calendarMode === 'replace'}
              onSelect={() => canTakeCalendar && setCalendarMode('replace')}
              title="Use the package's calendar"
              description={canTakeCalendar
                ? 'It replaces yours, with its months, weekdays and current date.'
                : `${plural(calendar.datesThatDoNotFit, 'date', 'dates')} in your world would not fit it, so it cannot replace yours.`}
              aside={<span className="shrink-0 text-right text-xs font-semibold text-text-secondary">{calendar.packageName}</span>}
            />
          </div>
        </div>
      )}
    </div>
  );

  const right = rules && (
    <div className="min-w-0 flex-1 space-y-2.5">
      <p className="flex items-center gap-2 text-xs font-semibold text-text-primary"><Scale className="h-3.5 w-3.5 text-text-muted" aria-hidden="true" />Roleplay rules</p>
      <RulesCompare rules={rules} />
      {hasRuleChoice ? (
        <div role="radiogroup" aria-label="Roleplay rules" className="space-y-2">
          <RadioCard name="import-rules" selected={rulesMode === 'merge'} onSelect={() => setRulesMode('merge')} title="Keep mine, add what is missing" description="Your rules stay as they are. Rules only the package has are added.">
            <Outcome {...ends.merge} />
          </RadioCard>
          <RadioCard name="import-rules" selected={rulesMode === 'replace'} onSelect={() => setRulesMode('replace')} title="Switch to the package's rules" description="Its rules replace yours. Characters keep their values where a resource still exists.">
            <Outcome {...ends.replace} />
          </RadioCard>
          <RadioCard name="import-rules" selected={rulesMode === 'skip'} onSelect={() => setRulesMode('skip')} title="Bring only the entities" description="Your rules stay exactly as they are. Nothing from the package's rules comes in.">
            <Outcome {...ends.skip} />
          </RadioCard>
        </div>
      ) : (
        <p className="flex items-center gap-2.5 text-[0.8125rem] leading-relaxed text-text-muted"><Info className="h-4 w-4 shrink-0" aria-hidden="true" />{rules.localRules ? 'They match this world\'s, so nothing changes.' : 'This world has none yet, so they come in as they are.'}</p>
      )}
      {inspected.currentValues && rulesMode !== 'skip' && <p className="caption">The package also carries its characters' current values. They go to the imported characters.</p>}
    </div>
  );

  return (
    <Modal
      onClose={() => { if (!busy) onCancel(); }}
      size="2xl"
      title="Import Worldbuild"
      subtitle={[inspected.fileName, inspected.fileBytes ? megabytes(inspected.fileBytes) : null, workspaceName ? `into ${workspaceName}` : null].filter(Boolean).join(' · ')}
      leading={<ToneTile icon={Upload} color="var(--theme-entity-location)" />}
      className={`${right ? '!max-w-[66rem]' : '!max-w-[36rem]'} max-h-[90vh]`}
    >
      <div className="custom-scrollbar flex min-h-0 flex-col gap-5 overflow-y-auto p-5 md:flex-row">
        {left}
        {right}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-3.5">
        <Button variant="subtle" disabled={busy} onClick={onCancel}>Cancel</Button>
        <Button icon={Upload} loading={busy} onClick={run}>Import {plural(inspected.entities, 'entity', 'entities')}</Button>
      </div>
    </Modal>
  );
}

/** What arrived, in the same terms as the import window; nothing is in the world until it is reviewed. */
export function ImportWorldbuildDone({ inspected, result, rulesMode, onClose, onReview }) {
  const name = String(inspected.fileName || 'The package').replace(/\.klwb$/i, '');
  const stat = (value, label, color, Icon) => (
    <div className="flex flex-1 items-center gap-3 rounded-control border px-3.5 py-3" style={{ background: 'var(--theme-surface-well)', borderColor: 'var(--theme-border-well)' }}>
      <Icon className="h-4 w-4 shrink-0" style={{ color }} aria-hidden="true" />
      <span><span className="block text-base font-semibold tabular-nums text-text-primary">{value}</span><span className="block text-xs text-text-subtle">{label}</span></span>
    </div>
  );
  const rulesLine = !result.rulesImported
    ? (inspected.rules ? 'Rules: yours stayed as they were.' : null)
    : rulesMode === 'replace' ? 'Rules: you switched to the package\'s.' : 'Rules: you kept yours and added what was missing.';
  const calendarLine = result.calendarImported
    ? `Calendar: you now use ${inspected.calendar?.packageName || 'the package\'s'}.`
    : inspected.calendar && !inspected.calendar.same ? `Calendar: you kept ${inspected.calendar.currentName}.` : null;
  return (
    <Modal onClose={onClose} size="lg" className="!max-w-[36rem]">
      <div className="space-y-3.5 p-5">
        <div className="flex items-center gap-4">
          <ToneTile icon={Check} color="var(--theme-status-success)" />
          <div className="min-w-0">
            <h2 className="text-base font-semibold text-text-primary">{name} is waiting for review</h2>
            <p className="mt-1 text-sm leading-relaxed text-text-muted">Nothing in your world changed yet. Open each one in the sidebar to accept or dismiss it.</p>
          </div>
        </div>
        <TypeStrip counts={inspected.typeCounts} />
        <div className="flex gap-2">
          {stat(result.entitiesAdded ?? inspected.entities, 'new entities', 'var(--theme-status-info)', Plus)}
          {result.linksAdded > 0 && stat(result.linksAdded, 'links', 'var(--theme-text-muted)', Link)}
          {result.imagesAdded > 0 && stat(result.imagesAdded, 'images', 'var(--theme-text-muted)', ImageIcon)}
        </div>
        {(rulesLine || calendarLine) && (
          <ul className="space-y-1.5 pt-1">
            {[rulesLine, calendarLine].filter(Boolean).map(text => (
              <li key={text} className="flex items-center gap-2.5 text-sm leading-relaxed text-text-secondary"><Check className="h-4 w-4 shrink-0 text-status-success" aria-hidden="true" />{text}</li>
            ))}
          </ul>
        )}
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-3.5">
        <Button variant="subtle" onClick={onClose}>Later</Button>
        <Button icon={Eye} onClick={onReview}>Review now</Button>
      </div>
    </Modal>
  );
}
