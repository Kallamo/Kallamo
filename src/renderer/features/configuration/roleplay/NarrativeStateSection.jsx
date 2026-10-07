import { useState } from 'react';
import { AlertTriangle, BookMarked, Check, CheckCircle2, Info, Loader2, RefreshCw, Sparkles } from 'lucide-react';
import Button from '../../../components/ui/Button';
import { ConfigSection, ChoiceCard, Help, formatSigned } from '../ConfigParts';
import { entityChangeLabel, kindOf, narrativeEventLabel } from '../../roleplay/changeKinds';
import { locationSizeLabel } from '../../../../shared/location-sizes';

const POLICIES = [
  { value: 'manual', title: 'Manual', description: 'The AI never changes the record. Only you do.' },
  { value: 'review', title: 'Review everything', description: 'Every AI change waits here for your approval.' },
  { value: 'automatic', title: 'Automatic', description: 'Clear changes apply right away. Unclear ones wait here.' }
];
const GROUP_ORDER = ['entity', 'narrative', 'scene', 'inventory', 'resource', 'progress'];
const RECENT_STEP = 5;

/**
 * What the AI writes down after each reply, and what still needs the user. Problems come
 * first, then the rule, then the queue; housekeeping and cost close the section.
 */
export default function NarrativeStateSection({
  sectionRef, policy, onPolicy, pending, recent, problems, updating, metrics, names,
  onResolve, onResolveMany, onReprocess, onTidy, tidyBusy
}) {
  const [recentLimit, setRecentLimit] = useState(RECENT_STEP);
  const [bulkBusy, setBulkBusy] = useState(false);
  const pendingCount = pending.length;
  const status = updating
    ? { label: 'Reading the last reply', icon: Loader2, className: 'bg-status-info/12 text-status-info', spin: true }
    : pendingCount
      ? { label: `${pendingCount} to review`, className: 'bg-status-warning/12 text-status-warning' }
      : { label: 'Up to date', icon: CheckCircle2, className: 'bg-tint/[0.06] text-text-secondary' };
  const StatusIcon = status.icon;
  const groups = GROUP_ORDER.map(kind => ({ kind, items: pending.filter(item => item.kind === kind) })).filter(group => group.items.length);
  const totals = metrics.reduce((sum, metric) => ({
    turns: sum.turns + 1,
    deep: sum.deep + (metric.deepAnalysis ? 1 : 0),
    tokens: sum.tokens + metric.triageInputTokens + metric.triageOutputTokens + metric.deepInputTokens + metric.deepOutputTokens
  }), { turns: 0, deep: 0, tokens: 0 });

  const resolveAll = async decision => {
    setBulkBusy(true);
    try { await onResolveMany(pending, decision); } finally { setBulkBusy(false); }
  };

  return (
    <ConfigSection
      id="narrative-state"
      sectionRef={sectionRef}
      icon={BookMarked}
      title="Narrative State"
      description="After each reply, the AI writes down what changed in the story: where people are, what they learned, what they carry. That record is what it remembers on the next turn."
      status={(
        <span className={`inline-flex h-6.5 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold ${status.className}`}>
          {StatusIcon && <StatusIcon aria-hidden="true" className={`h-3.5 w-3.5 ${status.spin ? 'animate-spin motion-reduce:animate-none' : ''}`} />}
          {status.label}
        </span>
      )}
    >
      <div className="flex flex-col gap-6">
        {problems.length > 0 && (
          <div className="-mt-1 flex flex-col gap-2">
            {problems.map(problem => (
              <div key={problem.key} className={`flex flex-wrap items-center gap-3 rounded-card border px-3.5 py-3 ${problem.tone === 'warning' ? 'border-status-warning/30 bg-status-warning/[0.05]' : 'border-status-info/25 bg-status-info/[0.05]'}`}>
                {problem.tone === 'warning'
                  ? <AlertTriangle aria-hidden="true" className="h-4.5 w-4.5 shrink-0 text-status-warning" />
                  : <Info aria-hidden="true" className="h-4.5 w-4.5 shrink-0 text-status-info" />}
                <div className="min-w-0 flex-1">
                  <span className="block text-[0.8125rem] font-semibold text-text-primary">{problem.title}</span>
                  <span className="block text-xs leading-relaxed text-text-muted">{problem.detail}</span>
                </div>
                <Button variant="ghost" size="sm" icon={problem.tone === 'warning' ? RefreshCw : null} onClick={problem.onFix}>{problem.action}</Button>
              </div>
            ))}
          </div>
        )}

        <div>
          <h3 className="text-sm font-semibold text-text-primary">How AI changes are applied</h3>
          <div role="radiogroup" aria-label="How AI changes are applied" className="mt-3 grid gap-2.5 md:grid-cols-3">
            {POLICIES.map(option => (
              <ChoiceCard key={option.value} name="narrative-policy" selected={policy === option.value} onSelect={() => onPolicy(option.value)} title={option.title} description={option.description} />
            ))}
          </div>
          <Help className="mt-2">Resources and Progression can each follow their own rule, set in Worldbuild, Rules.</Help>
        </div>

        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2.5">
            <h3 className="text-sm font-semibold text-text-primary">Waiting for you</h3>
            <span className="flex-1 text-xs tabular-nums text-text-subtle">{pendingCount ? `${pendingCount} ${pendingCount === 1 ? 'change' : 'changes'}` : ''}</span>
            {pendingCount > 1 && (
              <>
                <Button variant="subtle" size="sm" disabled={bulkBusy} onClick={() => resolveAll('rejected')}>Reject all</Button>
                <Button variant="ghost" size="sm" loading={bulkBusy} onClick={() => resolveAll('approved')}>Approve all</Button>
              </>
            )}
          </div>
          {pendingCount ? (
            <div className="overflow-hidden rounded-card border border-border-subtle bg-surface-inset">
              {groups.map((group, groupIndex) => (
                <div key={group.kind}>
                  <div className={`flex items-center gap-2 bg-tint/[0.025] px-3.5 py-2 text-xs font-semibold text-text-muted ${groupIndex ? 'border-t border-border-subtle' : ''}`}>
                    <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${kindOf(group.kind).dot}`} />
                    {kindOf(group.kind).group}
                    <span className="font-medium tabular-nums text-text-subtle">{group.items.length}</span>
                  </div>
                  {group.items.map(item => <PendingItem key={`${item.kind}:${item.id}`} item={item} names={names} onResolve={onResolve} />)}
                </div>
              ))}
            </div>
          ) : (
            <p className="flex items-center gap-2 rounded-card border border-dashed border-border-subtle px-4 py-4 text-[0.8125rem] text-text-muted">
              <Check aria-hidden="true" className="h-4 w-4 shrink-0 text-text-subtle" />
              Nothing to review. Changes the AI isn't sure about will show up here.
            </p>
          )}
        </div>

        {recent.length > 0 && (
          <div>
            <div className="mb-3 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
              <h3 className="text-sm font-semibold text-text-primary">Recent changes</h3>
              <Help>Already in the record. The Roleplay panel in the chat shows them turn by turn.</Help>
            </div>
            <div className="divide-y divide-border-subtle overflow-hidden rounded-card border border-border-subtle bg-surface-inset">
              {recent.slice(0, recentLimit).map(item => {
                const view = describeChange(item, names);
                return (
                  <div key={`${item.kind}:${item.id}`} className="flex items-center gap-3 px-3.5 py-2.5">
                    <span className={`inline-flex h-5.5 shrink-0 items-center rounded-md px-2 text-xs font-semibold ${kindOf(item.kind).chip}`}>{view.label}</span>
                    <span className="min-w-0 flex-1 truncate text-[0.8125rem] text-text-secondary" data-tooltip={view.title.length > 90 ? view.title : undefined}>{view.title}</span>
                    {view.who && <span className="max-w-[12.5rem] shrink-0 truncate text-xs text-text-subtle">{view.who}</span>}
                  </div>
                );
              })}
              {recent.length > recentLimit && (
                <div className="flex justify-center p-1.5">
                  <Button variant="subtle" size="sm" onClick={() => setRecentLimit(limit => limit + RECENT_STEP)}>Show {Math.min(RECENT_STEP, recent.length - recentLimit)} more</Button>
                </div>
              )}
            </div>
          </div>
        )}

        <div className="grid gap-6 border-t border-border-subtle pt-5 md:grid-cols-2">
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Tidy the record</h3>
            <Help className="mb-3 mt-1">Finds statements stored twice and passing scene detail kept as lasting fact. You see the list before anything changes.</Help>
            <Button variant="ghost" size="sm" icon={Sparkles} loading={tidyBusy} onClick={onTidy}>Check records</Button>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-text-primary">Cost</h3>
            {totals.turns ? (
              <>
                <Help className="mb-2.5 mt-1">The last {totals.turns} {totals.turns === 1 ? 'turn' : 'turns'}.</Help>
                <dl className="flex flex-col gap-1.5 text-[0.8125rem] tabular-nums">
                  <div className="flex justify-between"><dt className="text-text-muted">Per turn, on average</dt><dd className="font-semibold text-text-primary">{compactTokens(totals.tokens / totals.turns)} tokens</dd></div>
                  <div className="flex justify-between"><dt className="text-text-muted">In total</dt><dd className="text-text-secondary">{compactTokens(totals.tokens)} tokens</dd></div>
                  <div className="flex justify-between"><dt className="text-text-muted">Read in depth</dt><dd className="text-text-secondary">{totals.deep} of {totals.turns} turns</dd></div>
                </dl>
              </>
            ) : <Help className="mt-1">No turn has been read yet.</Help>}
          </div>
        </div>
      </div>
    </ConfigSection>
  );
}

function PendingItem({ item, names, onResolve }) {
  const [busy, setBusy] = useState(false);
  const view = describeChange(item, names);
  const resolve = async decision => {
    setBusy(true);
    try { await onResolve(item, decision); } finally { setBusy(false); }
  };
  return (
    <div className="flex flex-wrap items-start gap-3.5 border-t border-border-subtle p-3.5 sm:flex-nowrap">
      <span className={`mt-px inline-flex h-5.5 shrink-0 items-center rounded-md px-2 text-xs font-semibold ${kindOf(item.kind).chip}`}>{view.label}</span>
      <div className="min-w-0 flex-1">
        <p className={`text-[0.8125rem] leading-relaxed text-text-primary ${item.kind === 'narrative' ? 'font-medium' : 'font-semibold'}`}>{view.title}</p>
        {view.detail && <p className="mt-0.5 text-xs leading-relaxed text-text-muted">{view.detail}</p>}
        {view.who && <p className="mt-1 text-xs text-text-subtle">{view.who}</p>}
      </div>
      <div className="flex shrink-0 gap-1.5">
        <Button variant="subtle" size="sm" disabled={busy} onClick={() => resolve('rejected')}>Reject</Button>
        <Button variant="ghost" size="sm" icon={Check} disabled={busy} onClick={() => resolve('approved')}>Approve</Button>
      </div>
    </div>
  );
}

/** Label, one line of what changed, an optional detail and who it is about. */
export function describeChange(item, names) {
  const name = id => names.get(id) || 'Someone';
  if (item.kind === 'entity') {
    const identity = item.identityUpdate;
    if (identity) {
      return {
        label: entityChangeLabel(item),
        title: identity.canonicalName ? `${identity.previousCanonicalName} → ${identity.canonicalName}` : `${identity.previousCanonicalName}: ${(identity.aliases || []).join(', ')}`,
        detail: [identity.reason, identity.canonicalName ? 'The previous name stays as an alias.' : ''].filter(Boolean).join(' ')
      };
    }
    const proposal = item.proposal || {};
    const placement = proposal.type === 'Locations' && (proposal.size || proposal.insideId)
      ? [locationSizeLabel(proposal.size), proposal.insideId ? `inside ${name(proposal.insideId)}` : ''].filter(Boolean).join(' ')
      : '';
    return {
      label: entityChangeLabel(item),
      title: proposal.name || 'Unnamed',
      detail: [placement ? `${placement}.` : '', item.status === 'conflicting' ? `Unclear: ${proposal.reason || proposal.description || ''}` : proposal.description || proposal.reason].filter(Boolean).join(' ')
    };
  }
  if (item.kind === 'narrative') {
    const event = item.record.proposal.changeSet.event;
    return {
      label: narrativeEventLabel(item.record),
      title: event.description,
      who: (event.participants || []).map(participant => name(participant.entityId)).join(', ')
    };
  }
  if (item.kind === 'scene') {
    const patch = item.patch || {};
    if (Object.hasOwn(patch, 'locationId') && patch.locationId) {
      return { label: 'Moved', title: `The scene is now at ${name(patch.locationId)}.`, detail: describeCast(patch, names) };
    }
    return { label: 'Scene', title: describeCast(patch, names) || 'Who is present changed.' };
  }
  if (item.kind === 'inventory') {
    const patch = item.patch || {};
    const itemName = name(patch.itemId);
    const to = patch.toHolderId ? name(patch.toHolderId) : patch.locationId ? name(patch.locationId) : null;
    const from = patch.fromHolderId ? name(patch.fromHolderId) : patch.fromLocationId ? name(patch.fromLocationId) : null;
    const quantity = patch.quantity ? `${patch.quantity} × ` : '';
    const title = !to && !from && patch.equipped !== undefined
      ? `${itemName} ${patch.equipped ? 'equipped' : 'put away'} by ${name(patch.holderId)}`
      : `${quantity}${itemName}${from ? ` from ${from}` : ''}${to ? ` to ${to}` : ' removed'}`;
    return { label: 'Item', title };
  }
  if (item.kind === 'resource') {
    const delta = item.delta ?? item.nextValue - item.previousValue;
    return {
      label: item.definitionName || 'Resource',
      title: `${name(item.entityId)}: ${item.definitionName || 'Resource'} ${formatSigned(delta)}`,
      detail: item.reason || ''
    };
  }
  if (item.kind === 'progress') {
    const trait = item.traitName || 'Attribute';
    const title = item.kind === 'progress' && item.progressKind === 'xp'
      ? `${name(item.entityId)}: XP ${formatSigned(item.delta)}`
      : item.progressKind === 'level'
        ? `${name(item.entityId)} reached level ${item.nextValue}`
        : `${name(item.entityId)}: ${trait} ${item.previousValue} → ${item.nextValue}`;
    return {
      label: item.progressKind === 'xp' ? 'XP' : item.progressKind === 'level' ? 'Level' : trait,
      title,
      detail: item.reason || ''
    };
  }
  return { label: 'Change', title: 'The record changed.' };
}

function describeCast(patch, names) {
  const list = ids => ids.map(id => names.get(id) || 'someone').join(', ') || 'no one';
  const nearby = [...new Set([...(patch.possibleObserverIds || []), ...(patch.nearbyIds || [])])];
  return [
    patch.participantIds ? `Taking part: ${list(patch.participantIds)}.` : '',
    patch.possibleObserverIds || patch.nearbyIds ? `Nearby: ${list(nearby)}.` : '',
    patch.objectIds ? `Objects here: ${list(patch.objectIds)}.` : ''
  ].filter(Boolean).join(' ');
}

function compactTokens(value) {
  const number = Math.round(Number(value) || 0);
  if (number >= 1e6) return `${(number / 1e6).toFixed(2).replace(/\.?0+$/, '')}M`;
  if (number >= 1e3) return `${(number / 1e3).toFixed(1).replace(/\.0$/, '')}k`;
  return String(number);
}
