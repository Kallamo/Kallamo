import { useEffect, useRef, useState } from 'react';
import { Activity, ChevronDown, ChevronRight, ChevronUp, Copy } from 'lucide-react';
import { describeSpanCheck, formatFrameTime } from '../frame-format';
import {
  diagnosticText,
  formatAgenticTrace,
  formatPlannerDecisions,
  formatRetrievalDiagnostics
} from '../diagnostic-format';

const fmt = value => (Number(value) || 0).toLocaleString();

export function compactNumber(value) {
  if (!Number.isFinite(value)) return '0';
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

export function tokenTotals(debug) {
  const usage = debug?.usage;
  const legacy = debug?.tokens;
  if (!usage && !legacy) return null;
  const input = usage ? usage.total.input : (legacy.totalInput || 0) + (legacy.agenticInput || 0);
  const output = usage ? usage.total.output : (legacy.output || 0) + (legacy.agenticOutput || 0);
  return { input, output, total: usage ? usage.total.total : input + output };
}

/** The readouts this reply has, in tab order; `copy` is the full text report. */
export function diagnosticsFor(debug, flags) {
  const totals = tokenTotals(debug);
  return [
    flags.tokenDebug && totals && { key: 'tokens', label: 'Tokens', copy: null },
    flags.agenticDebug && (debug?.agentic || debug?.agenticRagResponse || debug?.agenticTrajectory)
      && { key: 'agentic', label: 'Agentic trace', copy: formatAgenticTrace(debug) },
    flags.ragDebug && (debug?.retrieval || debug?.standardRagContextGathered)
      && { key: 'retrieval', label: 'Retrieval', copy: formatRetrievalDiagnostics(debug) },
    flags.ragDebug && (debug?.legacyText || debug?.workflowStatus)
      && { key: 'workflow', label: 'Workflow', copy: debug.legacyText || debug.workflowStatus },
    flags.narrativeStateDebug && debug?.generation?.scenePlan
      && { key: 'scene-plan', label: 'Scene plan', copy: debug.generation.scenePlan },
    flags.narrativeStateDebug && debug?.narrativeState
      && { key: 'narrative', label: 'Narrative state', copy: diagnosticText(debug.narrativeState) }
  ].filter(Boolean);
}

/** The report lies inside the reply, so it scrolls with its button and never pushes the thread down. */
export function MessageDiagnostics({ debug, items, names, onCopy, copiedKey }) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const totals = tokenTotals(debug);

  useEffect(() => {
    if (!open) return undefined;
    const onDown = event => {
      if (rootRef.current?.contains(event.target)) return;
      if (event.target.closest?.('[data-floating-layer]')) return;
      setOpen(false);
    };
    const onKey = event => {
      if (event.key !== 'Escape') return;
      setOpen(false);
      buttonRef.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} data-diagnostics-open={open || undefined} className={`relative ml-auto shrink-0 ${open ? 'z-10' : ''}`}>
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen(value => !value)}
        className={`relative inline-flex h-7 items-center gap-1.5 border px-2.5 text-xs font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${open
          ? 'z-10 rounded-t-lg border-border-default border-b-surface-panel bg-surface-panel text-text-primary'
          : 'chat-action rounded-lg border-border-subtle text-text-muted hover:border-border-default hover:text-text-secondary'}`}
      >
        <Activity aria-hidden="true" className="h-3.5 w-3.5" />
        {totals ? `${compactNumber(totals.total)} tokens` : 'Diagnostics'}
        {open ? <ChevronUp aria-hidden="true" className="h-3 w-3" /> : <ChevronDown aria-hidden="true" className="h-3 w-3" />}
      </button>
      {open && (
        <div role="dialog" aria-label="Reply diagnostics" className="absolute right-0 top-full -mt-px">
          <DiagnosticsPanel debug={debug} items={items} names={names} onCopy={onCopy} copiedKey={copiedKey} />
        </div>
      )}
    </div>
  );
}

function Stat({ label, value, sub, tone = 'text-text-primary' }) {
  return (
    <div className="min-w-0 rounded-lg border border-border-subtle bg-surface-canvas/50 px-3 py-2">
      <p className="truncate text-[0.6875rem] font-medium text-text-muted">{label}</p>
      <p className={`mt-0.5 text-base font-semibold tabular-nums ${tone}`}>{value}</p>
      {sub && <p className="mt-0.5 truncate text-[0.6875rem] text-text-subtle tabular-nums">{sub}</p>}
    </div>
  );
}

function Chip({ children, tone = 'bg-tint/[0.06] text-text-secondary' }) {
  return <span className={`inline-flex h-6 max-w-full items-center gap-1 truncate rounded-md px-2 text-xs font-medium ${tone}`}>{children}</span>;
}

function Disclosure({ title, children }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-lg border border-border-subtle">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(value => !value)}
        className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40"
      >
        <ChevronRight aria-hidden="true" className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
        {title}
      </button>
      {open && (
        <div className="max-h-72 overflow-y-auto border-t border-border-subtle px-3 py-2.5 font-mono text-xs leading-relaxed text-text-muted whitespace-pre-wrap select-text custom-scrollbar">
          {children}
        </div>
      )}
    </div>
  );
}

const SectionTitle = ({ children }) => <h4 className="mb-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-text-subtle">{children}</h4>;

const INPUT_PARTS = [
  ['systemInstructions', 'System', 'bg-entity-event'],
  ['narrativeContext', 'Context', 'bg-status-info'],
  ['chatHistory', 'History', 'bg-mode-history'],
  ['userInput', 'Message', 'bg-accent']
];

const CACHE_STAGES = [['main', 'Main generation'], ['agentic', 'Agentic retrieval'], ['narrativeState', 'Narrative state']];
const CACHE_MODES = { explicit: 'Marked by Kallamo', automatic: 'Cached by the provider', mixed: 'Marked and automatic' };

function TokensView({ debug }) {
  const usage = debug.usage;
  const legacy = debug.tokens || {};
  const totals = tokenTotals(debug);
  const main = usage?.main || { input: legacy.totalInput || 0, output: legacy.output || 0, narrativeContext: legacy.knowledgeBase || 0, chatHistory: legacy.chatHistory || 0 };
  const agentic = usage?.agentic || { input: legacy.agenticInput || 0, output: legacy.agenticOutput || 0 };
  const parts = INPUT_PARTS.map(([key, label, tone]) => ({ label, tone, value: Number(main[key]) || 0 }));
  const partsTotal = parts.reduce((sum, part) => sum + part.value, 0) || 1;
  const cache = usage?.cache;
  const cacheNet = cache ? cache.savedTokens - cache.surchargeTokens : 0;
  // A report with one count holds the main generation's.
  const cacheStages = cache?.stages || (cache ? { main: cache } : {});
  const stageCache = key => Number(cacheStages[key]?.read) || 0;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Input" value={fmt(totals.input)} sub={usage?.accuracy === 'estimated' || !usage ? 'Estimated' : usage.accuracy} />
        <Stat label="Output" value={fmt(totals.output)} />
        <Stat label="Total" value={fmt(totals.total)} tone="text-accent" />
      </div>

      <div>
        <SectionTitle>Main input</SectionTitle>
        <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-tint/[0.06]" role="img" aria-label={parts.map(part => `${part.label} ${fmt(part.value)}`).join(', ')}>
          {parts.map(part => part.value > 0 && <span key={part.label} className={part.tone} style={{ width: `${(part.value / partsTotal) * 100}%` }} />)}
        </div>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
          {parts.map(part => (
            <span key={part.label} className="inline-flex items-center gap-1.5">
              <span aria-hidden="true" className={`h-2 w-2 rounded-full ${part.tone}`} />
              {part.label}<span className="font-semibold text-text-secondary tabular-nums">{fmt(part.value)}</span>
            </span>
          ))}
        </div>
      </div>

      <div>
        <SectionTitle>By stage</SectionTitle>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-x-6 gap-y-1.5 text-xs tabular-nums">
          <span className="text-text-subtle">Stage</span><span className="text-right text-text-subtle">Input</span><span className="text-right text-text-subtle">From cache</span><span className="text-right text-text-subtle">Output</span>
          <span className="text-text-secondary">Main generation</span><span className="text-right text-text-primary">{fmt(main.input)}</span><span className="text-right text-text-muted">{fmt(stageCache('main'))}</span><span className="text-right text-text-primary">{fmt(main.output)}</span>
          {(agentic.input || agentic.output) > 0 && <><span className="text-text-secondary">Agentic retrieval</span><span className="text-right text-text-primary">{fmt(agentic.input)}</span><span className="text-right text-text-muted">{fmt(stageCache('agentic'))}</span><span className="text-right text-text-primary">{fmt(agentic.output)}</span></>}
          {usage?.narrativeState?.total > 0 && <><span className="text-text-secondary">Narrative state</span><span className="text-right text-text-primary">{fmt(usage.narrativeState.input)}</span><span className="text-right text-text-muted">{fmt(stageCache('narrativeState'))}</span><span className="text-right text-text-primary">{fmt(usage.narrativeState.output)}</span></>}
        </div>
      </div>

      {cache?.active && (
        <div className="rounded-lg border border-border-subtle bg-surface-canvas/50 px-3 py-2.5">
          <div className="flex items-center justify-between gap-2">
            <SectionTitle>Prompt cache</SectionTitle>
            <span className="text-[0.6875rem] text-text-subtle">Reported by the provider</span>
          </div>
          <div className="space-y-1 text-xs text-text-muted tabular-nums">
            {CACHE_STAGES.filter(([key]) => (Number(cacheStages[key]?.read) || 0) + (Number(cacheStages[key]?.write) || 0) > 0).map(([key, label]) => (
              <div key={key} className="flex flex-wrap items-baseline gap-x-5 gap-y-1">
                <span className="min-w-[8.5rem] text-text-secondary">{label}</span>
                <span>Read <b className="font-semibold text-text-primary">{fmt(cacheStages[key].read)}</b></span>
                <span>Written <b className="font-semibold text-text-primary">{fmt(cacheStages[key].write)}</b></span>
                {cacheStages[key].mode && <span className="text-text-subtle">{CACHE_MODES[cacheStages[key].mode] || ''}</span>}
              </div>
            ))}
          </div>
          <p className={`mt-1.5 text-xs ${cacheNet >= 0 ? 'text-status-success' : 'text-status-warning'}`}>
            {cacheNet >= 0 ? `Saved ≈ ${fmt(cacheNet)} input tokens` : `Cost ≈ ${fmt(-cacheNet)} extra input tokens this turn`}
            {cache.savingsKnown === false && <span className="text-text-muted"> · reads from an automatic cache are billed at the model's cached-input rate</span>}
          </p>
        </div>
      )}
    </div>
  );
}

const STOP_REASONS = {
  finished: 'Finished',
  'max-turns': 'Turn limit reached',
  budget: 'Budget reached'
};

function AgenticView({ debug, copy }) {
  const agentic = debug.agentic;
  const trajectory = debug.agenticTrajectory;
  if (!agentic && !trajectory) return <Disclosure title="Report">{copy}</Disclosure>;
  const planner = trajectory?.plannerWindow;
  const pack = trajectory?.packing;
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {agentic && <Chip tone={agentic.stopReason === 'finished' ? 'bg-status-success/12 text-status-success' : 'bg-status-warning/12 text-status-warning'}>{STOP_REASONS[agentic.stopReason] || agentic.stopReason || 'Unknown stop'}</Chip>}
        {agentic?.degraded && <Chip tone="bg-status-danger/12 text-status-danger">Degraded</Chip>}
        {trajectory?.gate && <Chip>Path: {trajectory.gate.path}</Chip>}
        {trajectory?.protocol && <Chip>Protocol: {trajectory.finalProtocol || trajectory.protocol}</Chip>}
      </div>

      {planner && (
        <div>
          <SectionTitle>Planner window</SectionTitle>
          <div className="h-2 w-full overflow-hidden rounded-full bg-tint/[0.06]">
            <span className="block h-full bg-status-info" style={{ width: `${Math.min(100, (planner.limit / (planner.configured || planner.limit)) * 100)}%` }} />
          </div>
          <p className="mt-1.5 text-xs text-text-muted tabular-nums">
            {fmt(planner.limit)} of {fmt(planner.configured || planner.limit)} tokens ({planner.source}) · {fmt(planner.outputTokens)} reserved for its reply
            {Number(planner.tokenRatio) > 1 && ` · corrected ×${Number(planner.tokenRatio).toFixed(2)}`}
          </p>
        </div>
      )}

      {trajectory?.seed && (
        <div>
          <SectionTitle>Pre-search · {trajectory.seed.items} passages</SectionTitle>
          <div className="flex flex-wrap gap-1.5">
            {(trajectory.seed.calls || []).map(call => <Chip key={call.tool}>{call.tool}<span className="text-text-subtle">→</span><b className="font-semibold text-text-primary">{call.hits}</b></Chip>)}
          </div>
        </div>
      )}

      {trajectory?.turns?.length > 0 && (
        <div>
          <SectionTitle>Turns</SectionTitle>
          <ol className="space-y-1.5">
            {trajectory.turns.map(turn => (
              <li key={turn.turn} className="rounded-lg border border-border-subtle bg-surface-canvas/50 px-3 py-2">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                  <span className="font-semibold text-text-primary">Turn {turn.turn}</span>
                  <span className="text-text-muted tabular-nums">
                    +{turn.newItems} new · {fmt(turn.inputTokens)} in / {fmt(turn.outputTokens)} out
                    {turn.tokenRatio ? ` · ×${Number(turn.tokenRatio).toFixed(2)}` : ''}
                  </span>
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {(turn.calls || []).length
                    ? turn.calls.map((call, index) => (
                      <Chip key={index} tone={call.status && call.status !== 'ran' ? 'bg-status-warning/12 text-status-warning' : 'bg-tint/[0.06] text-text-secondary'}>
                        <span className="text-text-subtle">{call.tool}</span>
                        <span className="truncate text-text-primary">{call.arg}</span>
                        <span className="text-text-subtle">→</span>
                        <b className="font-semibold">{call.hits}</b>
                      </Chip>
                    ))
                    : <Chip>{turn.finished ? 'Finished' : 'No call'}</Chip>}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {pack && (
        <div className="grid grid-cols-3 gap-2">
          <Stat label="Items packed" value={`${pack.kept}/${pack.total}`} />
          <Stat label="Context budget" value={fmt(pack.budget)} sub="tokens" />
          <Stat label="Dropped · cut" value={`${pack.dropped} · ${pack.truncated}`} tone={pack.dropped || pack.truncated ? 'text-status-warning' : 'text-text-primary'} />
        </div>
      )}

      <div className="space-y-1.5">
        {agentic?.finish && <Disclosure title="Planner's final answer">{agentic.finish}</Disclosure>}
        {agentic?.contextText && <Disclosure title="Final context">{agentic.contextText}</Disclosure>}
        {agentic?.turns && <Disclosure title="Raw tool trace">{diagnosticText(agentic.turns)}</Disclosure>}
        {!agentic && debug.agenticRagResponse && <Disclosure title="Response">{debug.agenticRagResponse}</Disclosure>}
      </div>
    </div>
  );
}

const KIND_LABELS = { 'workspace-text': 'Workspace text', 'worldbuild-canon': 'Worldbuild' };
const kindLabel = kind => KIND_LABELS[kind] || kind;

function groupSources(list = []) {
  const groups = new Map();
  list.forEach(item => {
    const key = `${item.source || 'Unknown'}\u0000${item.kind}\u0000${item.reason || ''}`;
    const group = groups.get(key) || { source: item.source || 'Unknown', kind: item.kind, reason: item.reason, count: 0 };
    group.count += 1;
    groups.set(key, group);
  });
  return [...groups.values()];
}

const SOURCE_LIMIT = 8;

function SourceList({ items, excluded = false }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? items : items.slice(0, SOURCE_LIMIT);
  if (!items.length) return <p className="text-xs text-text-subtle">None.</p>;
  return (
    <div>
      <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle">
        {visible.map((item, index) => (
          <li key={index} className="flex items-center gap-2 px-3 py-1.5 text-xs">
            <span className="min-w-0 flex-1 truncate text-text-secondary" data-tooltip={item.source}>{item.source}</span>
            {excluded && item.reason && <span className="shrink-0 text-status-warning">{item.reason}</span>}
            <span className="shrink-0 rounded bg-tint/[0.06] px-1.5 text-[0.6875rem] text-text-muted">{kindLabel(item.kind)}</span>
            {item.count > 1 && <span className="shrink-0 font-semibold text-text-muted tabular-nums">×{item.count}</span>}
          </li>
        ))}
      </ul>
      {items.length > SOURCE_LIMIT && (
        <button type="button" onClick={() => setShowAll(value => !value)} className="mt-1.5 rounded px-1 text-xs font-semibold text-text-muted hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          {showAll ? 'Show fewer' : `Show all ${items.length}`}
        </button>
      )}
    </div>
  );
}

function RetrievalView({ debug, copy }) {
  const retrieval = debug.retrieval;
  if (!retrieval) return <Disclosure title="Report">{copy}</Disclosure>;
  const selection = retrieval.selection;
  const breakdown = value => Object.entries(value || {}).map(([key, count]) => `${kindLabel(key)} ${count}`).join(' · ');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        <Chip>Mode: {retrieval.mode || 'standard'}</Chip>
        {selection?.intent && <Chip>Intent: {selection.intent}</Chip>}
        {debug.generation?.profileName && <Chip>Target: {debug.generation.profileName}</Chip>}
      </div>

      {selection && (
        <>
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Discovered" value={fmt(selection.discovered)} sub={breakdown(selection.discoveredByKind)} />
            <Stat label="Selected" value={fmt(selection.selected)} sub={breakdown(selection.selectedByKind)} tone="text-status-success" />
            <Stat label="Excluded" value={fmt(selection.excluded)} sub={breakdown(selection.excludedByReason) || 'None'} tone={selection.excluded ? 'text-status-warning' : 'text-text-primary'} />
          </div>
          {selection.evidence && (
            <p className="text-xs text-text-muted">
              Evidence: <span className="text-text-secondary">{selection.evidence.status || 'inconclusive'}</span> ({selection.evidence.reason || 'unspecified'})
              {selection.evidence.source && <> · latest from {selection.evidence.source}</>}
            </p>
          )}
          <div>
            <SectionTitle>Selected sources</SectionTitle>
            <SourceList items={groupSources(selection.selectedSources)} />
          </div>
          {selection.excludedSources?.length > 0 && (
            <div>
              <SectionTitle>Excluded sources</SectionTitle>
              <SourceList items={groupSources(selection.excludedSources)} excluded />
            </div>
          )}
        </>
      )}

      <div className="space-y-1.5">
        {retrieval.bundle?.scopes?.length > 0 && <Disclosure title="Planner decisions">{formatPlannerDecisions(retrieval.bundle)}</Disclosure>}
        <Disclosure title="Exact final narrative context">{retrieval.finalContextText || 'No additional narrative context was sent.'}</Disclosure>
      </div>
      {debug.generation?.policyId && <p className="font-mono text-[0.6875rem] text-text-subtle">Policy {debug.generation.policyId}</p>}
    </div>
  );
}

const NARRATIVE_STATUS = {
  completed: { label: 'Completed', tone: 'bg-status-success/12 text-status-success' },
  'completed-with-warnings': { label: 'Completed with warnings', tone: 'bg-status-warning/12 text-status-warning' },
  skipped: { label: 'Nothing to record', tone: 'bg-tint/[0.06] text-text-secondary' },
  deferred: { label: 'Waiting for the next turn', tone: 'bg-status-info/12 text-status-info' },
  failed: { label: 'Failed', tone: 'bg-status-danger/12 text-status-danger' }
};

// One colour per story domain, matching the kinds in the roleplay panel's Recent changes.
const DOMAIN_TONES = {
  scene: 'bg-entity-location/14 text-entity-location',
  inventory: 'bg-entity-item/14 text-entity-item',
  resource: 'bg-status-warning/14 text-status-warning',
  entity: 'bg-entity-concept/12 text-entity-concept',
  relationship: 'bg-entity-creature/14 text-entity-creature',
  knowledge: 'bg-mode-searchable/14 text-mode-searchable',
  event: 'bg-entity-event/14 text-entity-event',
  time: 'bg-status-info/14 text-status-info'
};
const domainTone = domain => DOMAIN_TONES[domain] || 'bg-tint/[0.06] text-text-secondary';
const humanize = value => String(value || '').replace(/[-_]/g, ' ').replace(/^\w/, letter => letter.toUpperCase());
const seconds = ms => (Number(ms) > 0 ? `${(ms / 1000).toFixed(1)} s` : null);

const SECTION_TONES = ['bg-entity-event', 'bg-status-info', 'bg-mode-history', 'bg-accent', 'bg-entity-creature', 'bg-entity-location'];

function ContextSections({ usage }) {
  if (!usage?.sections) return null;
  const sections = Object.entries(usage.sections)
    .map(([key, section]) => ({ key, tokens: section.tokens || 0, count: section.count }))
    .filter(section => section.tokens > 0)
    .sort((left, right) => right.tokens - left.tokens);
  const shown = sections.slice(0, SECTION_TONES.length - 1);
  const rest = sections.slice(shown.length).reduce((sum, section) => sum + section.tokens, 0);
  const parts = [
    { key: 'System prompt', tokens: usage.systemPromptTokens || 0 },
    ...shown.map(section => ({ key: humanize(section.key), tokens: section.tokens, count: section.count })),
    ...(rest > 0 ? [{ key: 'Other', tokens: rest }] : [])
  ].map((part, index) => ({ ...part, tone: index === 0 ? 'bg-text-subtle' : SECTION_TONES[(index - 1) % SECTION_TONES.length] }));
  const total = parts.reduce((sum, part) => sum + part.tokens, 0) || 1;
  return (
    <div>
      <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-tint/[0.06]" role="img" aria-label={parts.map(part => `${part.key} ${fmt(part.tokens)}`).join(', ')}>
        {parts.map(part => <span key={part.key} className={part.tone} style={{ width: `${(part.tokens / total) * 100}%` }} />)}
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-text-muted">
        {parts.map(part => (
          <span key={part.key} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className={`h-2 w-2 rounded-full ${part.tone}`} />
            {part.key}{part.count != null && <span className="text-text-subtle">({part.count})</span>}
            <span className="font-semibold text-text-secondary tabular-nums">{fmt(part.tokens)}</span>
          </span>
        ))}
      </div>
    </div>
  );
}

const PLAN_FIELDS = ['knows', 'wants', 'does'];

// Each plan line is "Name | knows: … | wants: … | does: …"; anything else is shown as written.
function parsePlanLine(line) {
  const [name, ...parts] = line.split('|').map(part => part.trim());
  const fields = Object.fromEntries(parts.flatMap(part => {
    const match = /^(knows|wants|does)\s*:\s*(.*)$/i.exec(part);
    return match ? [[match[1].toLowerCase(), match[2]]] : [];
  }));
  return name && Object.keys(fields).length ? { name, fields } : null;
}

function ScenePlanView({ plan }) {
  const lines = String(plan || '').split(/\r?\n/).map(line => line.replace(/^[-*•]\s*/, '').trim()).filter(Boolean);
  const parsed = lines.map(parsePlanLine);
  if (!lines.length || /^none\.?$/i.test(lines.join(' '))) {
    return <p className="text-xs text-text-muted">No non-player character acted this turn.</p>;
  }
  if (parsed.some(entry => !entry)) {
    return <div className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-text-muted select-text">{plan}</div>;
  }
  return (
    <div className="space-y-3">
      <p className="text-xs text-text-muted">What each character could rely on before the narration was written. Hidden from the reply.</p>
      <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle">
        {parsed.map((entry, index) => (
          <li key={index} className="px-3 py-2.5 select-text">
            <p className="text-sm font-semibold text-text-primary">{entry.name}</p>
            <dl className="mt-1.5 grid grid-cols-[3.5rem_minmax(0,1fr)] gap-x-3 gap-y-1 text-xs leading-relaxed">
              {PLAN_FIELDS.filter(field => entry.fields[field]).map(field => (
                <div key={field} className="contents">
                  <dt className="text-text-subtle">{field}</dt>
                  <dd className="text-text-secondary">{entry.fields[field]}</dd>
                </div>
              ))}
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

function SceneMemoryList({ updates, names }) {
  return (
    <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle">
      {updates.map(update => (
        <li key={update.entityId} className="px-3 py-2 text-xs select-text">
          <p className="font-semibold text-text-primary">{names?.get(update.entityId) || 'Unknown character'}</p>
          <ul className="mt-1 space-y-0.5 text-text-secondary">
            {(update.perceived || []).map((text, index) => <li key={`p${index}`}><span className="text-text-subtle">perceived</span> {text}</li>)}
            {(update.heard || []).map((line, index) => (
              <li key={`h${index}`}><span className="text-text-subtle">heard{line.fromId && names?.get(line.fromId) ? ` from ${names.get(line.fromId)}` : ''}</span> {line.text}</li>
            ))}
            {update.stance && <li><span className="text-text-subtle">stance</span> {update.stance}</li>}
          </ul>
        </li>
      ))}
    </ul>
  );
}

function NarrativeView({ debug, names, copy }) {
  const state = debug.narrativeState;
  if (!state || typeof state !== 'object') return <Disclosure title="Report">{copy}</Disclosure>;
  const status = NARRATIVE_STATUS[state.status] || { label: humanize(state.status || 'unknown'), tone: 'bg-tint/[0.06] text-text-secondary' };
  const triage = state.triage || {};
  const routing = state.routing || {};
  const analysis = state.analysis;
  const usage = state.usage || {};
  const entityIds = Array.isArray(triage.entityIds) ? triage.entityIds : [];
  const named = entityIds.map(id => names?.get(id)).filter(Boolean);
  const unnamed = entityIds.length - named.length;
  const frame = state.timeFrame;
  const spanNote = describeSpanCheck(frame?.advance?.spanCheck || triage.timeAdvance?.spanCheck);
  const contextUsage = state.contextUsage?.analysis || state.contextUsage?.triage || (state.contextUsage?.sections ? state.contextUsage : null);
  const warnings = [
    ...(analysis?.skippedEventReasons || []).map(reason => `Event skipped: ${humanize(reason)}`),
    ...(analysis?.filteredOperationReasons || []).map(item => `${humanize(item.key.replace(':', ' · '))}${item.count > 1 ? ` ×${item.count}` : ''}`),
    analysis?.rejectedScenePatch && `Scene change rejected: ${humanize(analysis.rejectedScenePatch)}`,
    spanNote?.warning && spanNote.text,
    analysis?.invalidInventoryChanges > 0 && `${analysis.invalidInventoryChanges} inventory ${analysis.invalidInventoryChanges === 1 ? 'change' : 'changes'} could not apply`
  ].filter(Boolean);
  const outcome = analysis ? [
    ['Events recorded', analysis.persistedEvents ?? analysis.events],
    ['New entities', analysis.newEntities],
    ['Identity updates', analysis.identityUpdates],
    ['Inventory applied', analysis.inventoryChangesApplied],
    ['State changes', analysis.resourceChanges],
    ['Filtered out', analysis.filteredOperations]
  ].filter(([, value]) => value != null) : [];
  const usageRows = [
    ['Triage', usage.triageInput, usage.triageOutput],
    ['Analysis', usage.deepInput, usage.deepOutput],
    ['Repairs', usage.repairInput, usage.repairOutput]
  ].filter(([, input, output]) => (input || 0) + (output || 0) > 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        <Chip tone={status.tone}>{status.label}</Chip>
        {routing.mode && routing.mode !== 'none' && <Chip>Analysis: {humanize(routing.mode)}</Chip>}
        {state.forceDeepAnalysis && <Chip tone="bg-status-warning/12 text-status-warning">Forced deep pass</Chip>}
        {seconds(state.elapsedMs) && <Chip>{seconds(state.elapsedMs)}</Chip>}
        {state.manifest?.sequence != null && <Chip>Manifest #{state.manifest.sequence}</Chip>}
      </div>

      {state.error && <p className="rounded-lg border border-status-danger/30 bg-status-danger/10 px-3 py-2 text-xs text-status-danger">{state.error}</p>}

      <div className="grid grid-cols-2 gap-2">
        <div className="rounded-lg border border-border-subtle bg-surface-canvas/50 px-3 py-2.5">
          <SectionTitle>Triage</SectionTitle>
          <p className="text-xs text-text-secondary">{triage.consequential ? 'Consequential turn' : 'Nothing lasting happened'}</p>
          {(triage.types || []).length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1">
              {triage.types.map(type => <Chip key={type} tone={domainTone(type)}>{humanize(type)}</Chip>)}
            </div>
          )}
        </div>
        <div className="rounded-lg border border-border-subtle bg-surface-canvas/50 px-3 py-2.5">
          <SectionTitle>Analyzed</SectionTitle>
          {(routing.selectedDomains || []).length
            ? <div className="flex flex-wrap gap-1">{routing.selectedDomains.map(domain => <Chip key={domain} tone={domainTone(domain)}>{humanize(domain)}</Chip>)}</div>
            : <p className="text-xs text-text-muted">Triage only</p>}
          {(routing.forceReasons || []).length > 0 && <p className="mt-1.5 text-[0.6875rem] text-status-warning">{routing.forceReasons.map(humanize).join(' · ')}</p>}
        </div>
      </div>

      {Array.isArray(triage.sceneMemory) && triage.sceneMemory.length > 0 && (
        <div>
          <SectionTitle>Scene memory · {triage.sceneMemory.length}</SectionTitle>
          <SceneMemoryList updates={triage.sceneMemory} names={names} />
        </div>
      )}

      {entityIds.length > 0 && (
        <div>
          <SectionTitle>Involved · {entityIds.length}</SectionTitle>
          <div className="flex flex-wrap gap-1">
            {named.map(name => <Chip key={name}>{name}</Chip>)}
            {unnamed > 0 && <Chip tone="bg-tint/[0.04] text-text-subtle">{named.length ? `+${unnamed} more` : `${unnamed} ${unnamed === 1 ? 'entity' : 'entities'}`}</Chip>}
          </div>
        </div>
      )}

      {frame?.end && (
        <div>
          <SectionTitle>Time and place</SectionTitle>
          <p className="text-xs text-text-secondary tabular-nums">
            {formatFrameTime(frame.start)} → <b className="font-semibold text-text-primary">{formatFrameTime(frame.end)}</b>
            {frame.end.locationName && <> · {frame.start?.locationName && frame.start.locationName !== frame.end.locationName ? `${frame.start.locationName} → ` : ''}{frame.end.locationName}</>}
          </p>
          {spanNote && !spanNote.warning && <p className="mt-1 text-xs text-text-muted">{spanNote.text}</p>}
        </div>
      )}

      {outcome.length > 0 && (
        <div className="grid grid-cols-3 gap-2">
          {outcome.map(([label, value]) => <Stat key={label} label={label} value={fmt(value)} tone={value ? 'text-text-primary' : 'text-text-subtle'} />)}
        </div>
      )}

      {warnings.length > 0 && (
        <div>
          <SectionTitle>Warnings</SectionTitle>
          <ul className="space-y-1">
            {warnings.map((warning, index) => <li key={index} className="flex gap-2 text-xs text-status-warning"><span aria-hidden="true">•</span><span>{warning}</span></li>)}
          </ul>
        </div>
      )}

      {(state.proposals || []).length > 0 && (
        <div>
          <SectionTitle>Proposals · {state.proposals.length}</SectionTitle>
          <ul className="divide-y divide-border-subtle rounded-lg border border-border-subtle">
            {state.proposals.map((proposal, index) => (
              <li key={index} className="flex items-center gap-2 px-3 py-1.5 text-xs">
                <Chip tone={domainTone(proposal.kind)}>{humanize(proposal.kind)}</Chip>
                <span className="min-w-0 flex-1 truncate text-text-secondary">{proposal.description || names?.get(proposal.id) || '—'}</span>
                <span className="shrink-0 text-text-muted">{humanize(proposal.status)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {usageRows.length > 0 && (
        <div>
          <SectionTitle>Tokens</SectionTitle>
          <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-6 gap-y-1.5 text-xs tabular-nums">
            <span className="text-text-subtle">Pass</span><span className="text-right text-text-subtle">Input</span><span className="text-right text-text-subtle">Output</span>
            {usageRows.map(([label, input, output]) => (
              <span key={label} className="contents"><span className="text-text-secondary">{label}</span><span className="text-right text-text-primary">{fmt(input)}</span><span className="text-right text-text-primary">{fmt(output)}</span></span>
            ))}
          </div>
          {state.repairs && (state.repairs.triage || state.repairs.deep || state.repairs.structuredFallbacks) > 0 && (
            <p className="mt-1.5 text-xs text-text-muted">Repairs: triage {state.repairs.triage || 0} · analysis {state.repairs.deep || 0} · structured fallbacks {state.repairs.structuredFallbacks || 0}</p>
          )}
        </div>
      )}

      {contextUsage && (
        <div>
          <SectionTitle>Analysis input · {fmt(contextUsage.total)} tokens</SectionTitle>
          <ContextSections usage={contextUsage} />
        </div>
      )}

      <Disclosure title="Raw record">{copy}</Disclosure>
    </div>
  );
}

function DiagnosticsPanel({ debug, items, names, onCopy, copiedKey }) {
  const [activeKey, setActiveKey] = useState(items[0]?.key);
  const active = items.find(item => item.key === activeKey) || items[0];
  if (!active) return null;
  const copyText = active.key === 'tokens' ? null : active.copy;
  return (
    <div className="w-[min(42rem,calc(100vw-2rem))] rounded-card rounded-tr-none border border-border-default bg-surface-panel p-3.5 shadow-overlay select-none">
      <div className="mb-3.5 flex items-center gap-2">
        {items.length > 1 && (
          <div role="tablist" aria-label="Diagnostics" className="flex min-w-0 flex-1 flex-wrap gap-0.5 rounded-control bg-shade/25 p-0.5">
            {items.map(item => (
              <button
                key={item.key}
                type="button"
                role="tab"
                aria-selected={item.key === active.key}
                onClick={() => setActiveKey(item.key)}
                className={`h-7 flex-1 whitespace-nowrap rounded-md px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${item.key === active.key ? 'bg-tint/10 text-text-primary' : 'text-text-muted hover:text-text-secondary'}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
        {copyText && (
          <button
            type="button"
            onClick={() => onCopy(active.key, copyText)}
            className="ml-auto inline-flex h-8 shrink-0 items-center gap-1.5 rounded-md border border-border-default px-2.5 text-xs font-semibold text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <Copy aria-hidden="true" className="h-3.5 w-3.5" />
            {copiedKey === active.key ? 'Copied' : 'Copy report'}
          </button>
        )}
      </div>
      <div className="max-h-[28rem] overflow-y-auto pr-1 custom-scrollbar">
        {active.key === 'tokens' && <TokensView debug={debug} />}
        {active.key === 'agentic' && <AgenticView debug={debug} copy={active.copy} />}
        {active.key === 'retrieval' && <RetrievalView debug={debug} copy={active.copy} />}
        {active.key === 'scene-plan' && <ScenePlanView plan={active.copy} />}
        {active.key === 'narrative' && <NarrativeView debug={debug} names={names} copy={active.copy} />}
        {active.key === 'workflow' && (
          <div className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-text-muted select-text">{active.copy}</div>
        )}
      </div>
    </div>
  );
}
