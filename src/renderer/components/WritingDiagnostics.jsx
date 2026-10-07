import React, { useRef, useState } from 'react';
import { Activity, Check, ChevronRight, Copy } from 'lucide-react';
import Popover from './ui/Popover';
import { compactNumber } from '../features/chat/components/MessageDiagnostics';

const fmt = value => (Number(value) || 0).toLocaleString();

const INPUT_PARTS = [
  ['instructions', 'Profile and directives', 'bg-entity-event'],
  ['chapter', 'Chapter around it', 'bg-entity-concept'],
  ['retrieved', 'Retrieved', 'bg-status-info'],
  ['history', 'Chat history', 'bg-mode-history'],
];

const CALL_REASONS = {
  first: 'First try',
  'output-cap': 'Retry at the output cap',
  correction: 'Format correction',
};

const SOURCES = {
  profile: 'Profile knowledge',
  workspace: 'Workspace files',
  memory: 'Memory',
  chapters: 'Other chapters',
  chapter: 'Far parts of this chapter',
  other: 'Other',
};

function reportText(debug) {
  const usage = debug.usage || {};
  const lines = [
    `Tokens: ${fmt(usage.input)} in, ${fmt(usage.output)} out, ${fmt(usage.total)} total (${usage.accuracy || 'estimated'})`,
    ...(debug.calls || []).map(c => `- ${CALL_REASONS[c.reason] || c.reason}: ${fmt(c.input)} in, ${fmt(c.output)} out${c.truncated ? ', cut off' : ''}`),
    `Input: ${INPUT_PARTS.map(([key, label]) => `${label} ${fmt(debug.input?.[key])}`).join(', ')}`,
  ];
  const retrieval = debug.retrieval;
  if (retrieval) {
    lines.push(`Retrieval: ${retrieval.sent} of ${retrieval.found} sent, ${fmt(retrieval.used)} of ${fmt(retrieval.budget)} tokens`);
    for (const item of retrieval.items || []) {
      lines.push(`- [${item.sent ? 'sent' : 'left out'}] ${SOURCES[item.source] || item.source} ${item.score.toFixed(3)}: ${item.text.replace(/\s+/g, ' ')}`);
    }
  }
  return lines.join('\n');
}

function Stat({ label, value, sub, tone = 'text-text-primary' }) {
  return (
    <div className="min-w-0 rounded-lg border border-border-subtle bg-surface-canvas/50 px-3 py-2">
      <p className="truncate text-xs font-medium text-text-muted">{label}</p>
      <p className={`mt-0.5 text-base font-semibold tabular-nums ${tone}`}>{value}</p>
      {sub && <p className="mt-0.5 truncate text-xs text-text-subtle">{sub}</p>}
    </div>
  );
}

const SectionTitle = ({ children }) => <h4 className="mb-1.5 text-xs font-semibold uppercase tracking-[0.08em] text-text-subtle">{children}</h4>;

function TokensView({ debug }) {
  const usage = debug.usage || {};
  const calls = debug.calls || [];
  const parts = INPUT_PARTS.map(([key, label, tone]) => ({ label, tone, value: Number(debug.input?.[key]) || 0 }));
  const partsTotal = parts.reduce((sum, part) => sum + part.value, 0) || 1;
  const limit = debug.limit;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Input" value={fmt(usage.input)} sub={usage.accuracy === 'reported' ? 'From the provider' : 'Estimated'} />
        <Stat label="Output" value={fmt(usage.output)} />
        <Stat label="Total" value={fmt(usage.total)} sub={`${calls.length} ${calls.length === 1 ? 'call' : 'calls'}`} tone="text-accent" />
      </div>
      <div>
        <SectionTitle>Each call's input</SectionTitle>
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
        <SectionTitle>By call</SectionTitle>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-6 gap-y-1.5 text-xs tabular-nums">
          <span className="text-text-subtle">Call</span><span className="text-right text-text-subtle">Input</span><span className="text-right text-text-subtle">Output</span>
          {calls.map((c, i) => (
            <React.Fragment key={i}>
              <span className="text-text-secondary">{CALL_REASONS[c.reason] || c.reason}{c.truncated && <span className="text-status-warning"> · cut off</span>}</span>
              <span className="text-right text-text-primary">{fmt(c.input)}</span>
              <span className="text-right text-text-primary">{fmt(c.output)}</span>
            </React.Fragment>
          ))}
        </div>
      </div>
      {(usage.cacheRead > 0 || usage.cacheWrite > 0) && (
        <p className="text-xs text-text-muted tabular-nums">Prompt cache: read <b className="font-semibold text-text-primary">{fmt(usage.cacheRead)}</b>, written <b className="font-semibold text-text-primary">{fmt(usage.cacheWrite)}</b></p>
      )}
      {limit && (
        <p className="border-t border-border-subtle pt-3 text-xs text-text-subtle tabular-nums">
          Payload limit {fmt(limit.payload)} tokens · {fmt(limit.output)} reserved for the reply, {fmt(limit.outputCap)} at the cap
        </p>
      )}
    </div>
  );
}

function RetrievalView({ retrieval }) {
  const [open, setOpen] = useState(false);
  const sources = Object.entries(retrieval.sources || {});
  return (
    <div className="space-y-3">
      {sources.length ? (
        <div className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-x-6 gap-y-1.5 text-xs tabular-nums">
          <span className="text-text-subtle">Source</span><span className="text-right text-text-subtle">Found</span><span className="text-right text-text-subtle">Sent</span>
          {sources.map(([key, value]) => (
            <React.Fragment key={key}>
              <span className="text-text-secondary">{SOURCES[key] || key}</span>
              <span className="text-right text-text-primary">{value.found}</span>
              <span className="text-right text-text-primary">{value.sent}</span>
            </React.Fragment>
          ))}
        </div>
      ) : <p className="text-xs text-text-muted">Nothing was retrieved for this passage.</p>}
      <p className="text-xs text-text-muted tabular-nums">{retrieval.sent} of {retrieval.found} fit the retrieval budget, {fmt(retrieval.used)} of {fmt(retrieval.budget)} tokens.</p>
      {(retrieval.items || []).length > 0 && (
        <div className="rounded-lg border border-border-subtle">
          <button type="button" aria-expanded={open} onClick={() => setOpen(v => !v)} className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs font-semibold text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40">
            <ChevronRight aria-hidden="true" className={`h-3.5 w-3.5 transition-transform ${open ? 'rotate-90' : ''}`} />
            What was found
          </button>
          {open && (
            <ul className="custom-scrollbar max-h-64 space-y-2 overflow-y-auto border-t border-border-subtle px-3 py-2.5">
              {retrieval.items.map((item, i) => (
                <li key={i} className="text-xs leading-relaxed">
                  <span className="flex items-center gap-2 text-text-subtle tabular-nums">
                    <span className={item.sent ? 'text-status-success' : ''}>{item.sent ? 'Sent' : 'Left out'}</span>
                    <span>{SOURCES[item.source] || item.source}</span>
                    <span className="ml-auto">{item.score.toFixed(3)}</span>
                  </span>
                  <span className="mt-0.5 block select-text text-text-muted">{item.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Token and retrieval readout for one Writing Desk result, shown only when the matching
 * debug setting is on. `compact` is the note-card size.
 */
export default function WritingDiagnostics({ debug, tokenDebug, ragDebug, compact = false, align = 'right' }) {
  const anchorRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const tabs = [
    tokenDebug && debug?.usage && { key: 'tokens', label: 'Tokens' },
    ragDebug && debug?.retrieval && { key: 'retrieval', label: 'Retrieval' },
  ].filter(Boolean);
  const [tab, setTab] = useState(null);
  if (!tabs.length) return null;
  const active = tabs.find(t => t.key === tab) ? tab : tabs[0].key;
  const total = debug.usage?.total;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(reportText(debug));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard unavailable */ }
  };

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(v => !v)}
        className={`inline-flex shrink-0 items-center gap-1.5 rounded-md border font-medium tabular-nums transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${compact ? 'h-6 px-1.5 text-xs' : 'h-7 px-2.5 text-xs'} ${open ? 'border-border-strong bg-surface-panel text-text-primary' : 'border-border-subtle text-text-muted hover:border-border-default hover:text-text-secondary'}`}
      >
        <Activity aria-hidden="true" className={compact ? 'h-3 w-3' : 'h-3.5 w-3.5'} />
        {total != null ? `${compactNumber(total)}${compact ? '' : ' tokens'}` : 'Diagnostics'}
      </button>
      <Popover anchorRef={anchorRef} open={open} onClose={() => setOpen(false)} matchAnchorWidth={false} align={align} maxHeight={520} className="w-[26rem] !p-3.5" role="dialog">
        <div className="mb-4 flex items-center gap-2">
          {tabs.length > 1 ? (
            <div role="tablist" className="flex gap-0.5 rounded-lg border border-border-subtle bg-surface-input p-0.5">
              {tabs.map(t => (
                <button key={t.key} type="button" role="tab" aria-selected={active === t.key} onClick={() => setTab(t.key)}
                  className={`h-7 rounded-md px-2.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${active === t.key ? 'bg-surface-hover text-text-primary' : 'text-text-muted hover:text-text-primary'}`}>
                  {t.label}
                </button>
              ))}
            </div>
          ) : <span className="text-sm font-semibold text-text-primary">{tabs[0].label}</span>}
          <span className="flex-1" />
          <button type="button" aria-label="Copy report" onClick={copy} className="inline-flex h-7 w-7 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-surface-hover hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
            {copied ? <Check className="h-3.5 w-3.5 text-status-success" /> : <Copy className="h-3.5 w-3.5" />}
          </button>
        </div>
        {active === 'tokens' ? <TokensView debug={debug} /> : <RetrievalView retrieval={debug.retrieval} />}
      </Popover>
    </>
  );
}
