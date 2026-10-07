import React, { useLayoutEffect, useRef, useState } from 'react';
import { ArrowLeft, BookOpen, ChevronDown, ChevronUp, Copy, Download, MessageSquare, MoreHorizontal, Pencil, Plus, Reply, Search, Trash2, Upload, Workflow } from 'lucide-react';
import Logo, { ReedPen } from '../../logo';
import Button from '../../components/ui/Button';
import IconButton from '../../components/ui/IconButton';
import { Menu, MenuItem, MenuSeparator } from '../../components/ui/Menu';
import { ProfileAvatar } from '../../components/modals/ProfileModal';
import { parseMarkdown } from '../../utils/markdown';

const SETUP = 'text-status-setup';

export function LibraryRail({ tabs, activeTab, onTab, search, onSearch, onBack, newLabel, onNew, onImport, children }) {
  return (
    <aside className="flex w-[21.25rem] shrink-0 flex-col border-r border-tint/[0.05] surface-rail px-4 pb-4 pt-16">
      <button type="button" onClick={onBack} className="inline-flex items-center gap-1.5 self-start rounded-md px-1 text-[0.8125rem] font-semibold text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
        <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />Workspaces
      </button>
      <div className="mt-3 flex items-center gap-3 px-1">
        <Logo size={26} className="shrink-0" />
        <h1 className="text-[1.375rem] font-extrabold tracking-[-0.02em] text-text-primary">Library</h1>
      </div>
      <div role="tablist" aria-label="Library sections" className="mt-[1.125rem] flex gap-0.5 rounded-[0.5625rem] bg-tint/[0.04] p-[3px]">
        {tabs.map(tab => {
          const active = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onTab(tab.id)}
              className={`flex-1 rounded-[0.4375rem] py-1.5 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${active ? 'bg-accent/[0.13] text-accent ring-1 ring-inset ring-accent/45' : 'text-text-subtle hover:text-text-secondary'}`}
            >
              {tab.label} <span className={`tabular-nums ${active ? 'text-accent/70' : 'text-text-subtle'}`}>{tab.count}</span>
            </button>
          );
        })}
      </div>
      <div className="mt-3 flex gap-2">
        <Button size="sm" icon={Plus} onClick={onNew} className="min-h-9 flex-[1.4]">{newLabel}</Button>
        {onImport && <Button variant="ghost" size="sm" icon={Upload} onClick={onImport} className="min-h-9 flex-1">Import</Button>}
      </div>
      <div className="relative mt-2.5">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-subtle" aria-hidden="true" />
        <input value={search} onChange={e => onSearch(e.target.value)} placeholder="Search" aria-label="Search the library" className="h-8 w-full rounded-control border border-border-default bg-surface-input pl-9 pr-3 text-[0.8125rem] text-text-secondary placeholder:text-text-subtle focus:border-accent focus:outline-none" />
      </div>
      <div className="mt-2.5 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto custom-scrollbar pr-0.5">{children}</div>
    </aside>
  );
}

export function RailItem({ active, onClick, leading = null, title, meta }) {
  return (
    <button
      type="button"
      aria-current={active ? 'true' : undefined}
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-[0.625rem] px-2.5 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${active ? 'bg-accent/[0.13] shadow-[inset_3px_0_0_var(--app-accent)]' : 'hover:bg-tint/[0.035]'}`}
    >
      {leading}
      <span className="min-w-0 flex-1">
        <span className={`block truncate text-[0.8125rem] font-semibold ${active ? 'text-text-primary' : 'text-text-secondary'}`}>{title}</span>
        {meta && <span className="block truncate">{meta}</span>}
      </span>
    </button>
  );
}

export function RailEmpty({ children }) {
  return <p className="caption px-2 py-3">{children}</p>;
}

function Section({ title, aside = null, children }) {
  return (
    <section className="mt-7">
      <div className="mb-2.5 flex items-baseline justify-between gap-4">
        <h3 className="text-[0.8125rem] font-semibold text-text-secondary">{title}</h3>
        {aside}
      </div>
      {children}
    </section>
  );
}

function Card({ children, className = '' }) {
  return <div className={`overflow-hidden rounded-xl border border-tint/[0.08] surface-card ${className}`}>{children}</div>;
}

function Facts({ items }) {
  return (
    <div className="mt-6 flex flex-wrap gap-y-3">
      {items.map(([value, label], index) => (
        <div key={label} className={`flex flex-col gap-1 pr-7 ${index ? 'border-l border-tint/[0.08] pl-7' : ''}`}>
          <b className="text-lg font-extrabold tabular-nums tracking-[-0.02em] text-text-primary">{value}</b>
          <span className="caption whitespace-nowrap">{label}</span>
        </div>
      ))}
    </div>
  );
}

function SetupNotice({ title, text, action, onAction }) {
  return (
    <div className="mt-6 flex items-center gap-4 rounded-xl border border-status-setup/30 bg-status-setup/[0.05] px-[1.125rem] py-3.5">
      <div className="min-w-0 flex-1">
        <div className="text-sm font-semibold text-status-setup-strong">{title}</div>
        <div className="mt-0.5 text-[0.8125rem] text-text-muted">{text}</div>
      </div>
      <button type="button" onClick={onAction} className="inline-flex min-h-8 shrink-0 items-center rounded-control bg-status-setup px-3 text-xs font-semibold text-on-setup transition-[filter] hover:brightness-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-setup/50">{action}</button>
    </div>
  );
}

// Long text shows its start; the footer can open the whole of it in place and fold it back.
function Excerpt({ html, text, info, actions = null }) {
  const bodyRef = useRef(null);
  const [expanded, setExpanded] = useState(false);
  const [overflows, setOverflows] = useState(false);
  useLayoutEffect(() => {
    const el = bodyRef.current;
    if (el && !expanded) setOverflows(el.scrollHeight > el.clientHeight + 1);
  }, [html, text, expanded]);
  return (
    <Card>
      <div ref={bodyRef} className={`relative px-5 pt-4 ${expanded ? 'pb-4' : 'max-h-52 overflow-hidden'} ${!expanded && overflows ? '[mask-image:linear-gradient(to_bottom,black_calc(100%-3rem),transparent)]' : ''}`}>
        {html
          ? <div className="markdown-body select-text text-[0.8125rem] leading-relaxed text-text-muted [&_h1]:mb-1 [&_h1]:mt-3 [&_h1]:border-0 [&_h1]:pb-0 [&_h1]:text-[0.9375rem] [&_h2]:mb-1 [&_h2]:mt-3 [&_h2]:text-sm [&_h3]:mb-1 [&_h3]:mt-3 [&_h3]:text-[0.8125rem] [&_h3]:normal-case [&_h3]:tracking-normal [&_h3]:text-text-primary [&_li]:text-[0.8125rem] [&_p]:my-1.5 [&_p]:text-[0.8125rem]" dangerouslySetInnerHTML={{ __html: html }} />
          : <p className="whitespace-pre-line text-[0.8125rem] leading-relaxed text-text-muted select-text">{text}</p>}
      </div>
      <div className="flex items-center gap-2 border-t border-tint/[0.055] px-5 py-3">
        <span className="caption flex-1">{info}</span>
        {actions}
        {(overflows || expanded) && (
          <Button variant="subtle" size="sm" icon={expanded ? ChevronUp : ChevronDown} aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
            {expanded ? 'Show less' : 'Show all'}
          </Button>
        )}
      </div>
    </Card>
  );
}

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const chars = n => `${n.toLocaleString()} character${n === 1 ? '' : 's'}`;

function MoreMenu({ label, children }) {
  const ref = useRef(null);
  const [open, setOpen] = useState(false);
  return (
    <>
      <span ref={ref}><IconButton icon={MoreHorizontal} label="More" onClick={() => setOpen(value => !value)} /></span>
      <Menu anchorRef={ref} open={open} onClose={() => setOpen(false)} label={label} className="w-56">
        {typeof children === 'function' ? children(() => setOpen(false)) : children}
      </Menu>
    </>
  );
}

function DetailHeader({ leading, title, meta, actions }) {
  return (
    <div className="flex items-start gap-[1.125rem]">
      {leading}
      <div className="min-w-0 flex-1">
        <h2 className="truncate text-[1.75rem] font-extrabold tracking-[-0.02em] text-text-primary">{title}</h2>
        {meta && <div className="mt-1 text-sm text-text-muted">{meta}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-1">{actions}</div>
    </div>
  );
}

export function ProfileDetail({ profile, apiName, workspaces, workflows, knowledgeCount, onEdit, onSetUp, onSearchInstructions, onKnowledge, onDuplicate, onExport, onDelete }) {
  const color = profile.color || '#FBCB2D';
  const ready = !profile.needsSetup;
  const rules = profile.systemPrompt || '';
  const search = profile.agenticPrompt || '';
  const searchOn = profile.isAgentic === true || profile.isAgentic === 1;
  const rounds = profile.agenticMaxTurns || 3;
  const blockedFlows = ready ? [] : workflows;

  return (
    <div className="relative min-h-full">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-72" style={{ background: `radial-gradient(55% 100% at 18% 0%, color-mix(in srgb, ${color} ${ready ? 15 : 7}%, transparent), transparent 70%)` }} />
      <div className="relative mx-auto max-w-[54rem] px-14 pb-16 pt-10">
        <DetailHeader
          leading={<ProfileAvatar color={color} size={64} muted={!ready} />}
          title={profile.name}
          meta={ready
            ? <>{apiName} · <span className="font-mono text-[0.8125rem]">{profile.model}</span></>
            : <button type="button" onClick={onSetUp} className={`font-semibold ${SETUP} hover:brightness-110`}>No connection yet · Set up</button>}
          actions={(
            <>
              <Button variant="ghost" size="sm" icon={Download} onClick={onExport}>Export</Button>
              <Button variant="ghost" size="sm" icon={BookOpen} onClick={onKnowledge}>Knowledge base</Button>
              <Button variant="ghost" size="sm" icon={Pencil} onClick={onEdit}>Edit</Button>
              <MoreMenu label={`${profile.name} actions`}>
                {close => (
                  <>
                    <MenuItem icon={Copy} label="Duplicate" onSelect={() => { close(); onDuplicate(); }} />
                    <MenuSeparator />
                    <MenuItem icon={Trash2} label="Delete…" danger onSelect={() => { close(); onDelete(); }} />
                  </>
                )}
              </MoreMenu>
            </>
          )}
        />
        <p className="mt-6 text-[0.9375rem] leading-relaxed text-text-secondary select-text">
          {profile.description || <span className="text-text-subtle">No description.</span>}
        </p>

        {!ready && (
          <SetupNotice
            title="This profile can’t reply yet"
            text={blockedFlows.length
              ? `Give it a connection and a model. Until then ${blockedFlows.length === 1 ? `the workflow “${blockedFlows[0].name}” can’t run` : `${blockedFlows.length} workflows can’t run`} either.`
              : 'Give it a connection and a model.'}
            action="Set up"
            onAction={onSetUp}
          />
        )}

        <Facts items={[
          [workspaces.length, workspaces.length === 1 ? 'workspace' : 'workspaces'],
          [knowledgeCount, knowledgeCount === 1 ? 'knowledge file' : 'knowledge files'],
          [profile.temperature ?? 0.7, 'temperature'],
          [(profile.maxTokens ?? 2048).toLocaleString(), 'max reply tokens'],
        ]} />

        <Section title="Behavior and rules">
          {rules ? (
            <Excerpt html={parseMarkdown(rules)} info={chars(rules.length)} />
          ) : (
            <Card className="px-5 py-4">
              <p className="text-sm font-semibold text-text-primary">No rules yet</p>
              <p className="mt-0.5 text-[0.8125rem] text-text-muted">Rules are how it writes: voice, format, what it should never do.</p>
              <Button variant="ghost" size="sm" icon={Pencil} className="mt-3" onClick={onEdit}>Write rules</Button>
            </Card>
          )}
        </Section>

        <Section
          title="Smart search"
          aside={<span className="caption inline-flex items-center gap-2">{searchOn && <span className="h-1.5 w-1.5 rounded-full bg-accent" aria-hidden="true" />}{searchOn ? 'On' : 'Off'}</span>}
        >
          {!searchOn ? (
            <Card className="px-5 py-4">
              <p className="text-[0.8125rem] text-text-muted">Off. Retrieval matches your message against what Kallamo has stored, word for word.</p>
            </Card>
          ) : search ? (
            <Excerpt text={search} info={`${chars(search.length)} · ${plural(rounds, 'search round')}`} actions={<Button variant="subtle" size="sm" icon={Pencil} onClick={onSearchInstructions}>Edit</Button>} />
          ) : (
            <Card className="px-5 py-4">
              <p className="text-sm font-semibold text-text-primary">No search instructions</p>
              <p className="mt-0.5 text-[0.8125rem] text-text-muted">It searches with Kallamo’s built-in approach. Write instructions to tell it what to look for.</p>
              <div className="mt-3 flex items-center gap-3.5">
                <Button variant="ghost" size="sm" icon={Pencil} onClick={onSearchInstructions}>Write instructions</Button>
                <span className="caption">{plural(rounds, 'search round')}</span>
              </div>
            </Card>
          )}
        </Section>

        <Section title="Knowledge base" aside={<Button variant="subtle" size="sm" icon={knowledgeCount ? BookOpen : Plus} onClick={onKnowledge}>{knowledgeCount ? 'Open' : 'Add files'}</Button>}>
          <Card className="px-5 py-3.5">
            <p className="text-[0.8125rem] text-text-muted">
              {knowledgeCount ? `${plural(knowledgeCount, 'file')} this profile can look up.` : 'No files yet. Add a style guide, notes or lore this profile can look up.'}
            </p>
          </Card>
        </Section>

        <Section title="Used in">
          {workspaces.length === 0 && workflows.length === 0 ? (
            <p className="text-[0.8125rem] text-text-subtle">Not in a workspace or workflow yet.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {workspaces.map(title => <span key={`w-${title}`} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-tint/[0.05] px-2.5 text-xs text-text-secondary"><BookOpen className="h-3 w-3" aria-hidden="true" />{title}</span>)}
              {workflows.map(flow => <span key={`f-${flow.id}`} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-tint/[0.05] px-2.5 text-xs text-text-secondary"><Workflow className="h-3 w-3" aria-hidden="true" />{flow.name}</span>)}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}

function ChainLink() {
  return <div aria-hidden="true" className="ml-[1.0625rem] h-[1.125rem] w-0.5 bg-tint/15" />;
}

function ChainEnd({ icon: Icon, title, text }) {
  return (
    <div className="flex items-center gap-4">
      <span className="inline-flex h-[2.125rem] w-[2.125rem] shrink-0 items-center justify-center rounded-[0.625rem] border border-tint/10 bg-tint/[0.035] text-text-secondary"><Icon className="h-4 w-4" aria-hidden="true" /></span>
      <div><div className="text-sm font-semibold text-text-primary">{title}</div><div className="text-[0.8125rem] text-text-muted">{text}</div></div>
    </div>
  );
}

export function WorkflowDetail({ workflow, steps, profileOf, uses, onEdit, onSetUp, onExport, onDuplicate, onDelete }) {
  const blocked = steps.map((step, index) => ({ step, index, profile: profileOf(step.profileId) })).filter(({ profile }) => !profile || profile.needsSetup);
  const firstBlocked = blocked[0];
  return (
    <div className="mx-auto max-w-[54rem] px-14 pb-16 pt-10">
      <DetailHeader
        title={workflow.name}
        meta={`${plural(steps.length, 'step')}. Each one reads what the step before it wrote.`}
        actions={(
          <>
            <Button variant="ghost" size="sm" icon={Download} onClick={onExport}>Export</Button>
            <Button variant="ghost" size="sm" icon={Pencil} onClick={onEdit}>Edit</Button>
            <MoreMenu label={`${workflow.name} actions`}>
              {close => (
                <>
                  <MenuItem icon={Copy} label="Duplicate" onSelect={() => { close(); onDuplicate(); }} />
                  <MenuSeparator />
                  <MenuItem icon={Trash2} label="Delete…" danger onSelect={() => { close(); onDelete(); }} />
                </>
              )}
            </MoreMenu>
          </>
        )}
      />
      {firstBlocked && (
        <SetupNotice
          title="It can’t run yet"
          text={firstBlocked.profile ? `${firstBlocked.profile.name}, step ${firstBlocked.index + 1}, has no model.` : `Step ${firstBlocked.index + 1} uses a profile that no longer exists.`}
          action={firstBlocked.profile ? `Set up ${firstBlocked.profile.name}` : 'Edit the workflow'}
          onAction={() => (firstBlocked.profile ? onSetUp(firstBlocked.profile) : onEdit())}
        />
      )}
      <Facts items={[[steps.length, steps.length === 1 ? 'step' : 'steps'], [uses, uses === 1 ? 'workspace' : 'workspaces'], [`${steps.length - blocked.length} of ${steps.length}`, 'steps ready']]} />
      <Section title="The chain">
        <ChainEnd icon={MessageSquare} title="Your message" text="Starts the run" />
        {steps.map((step, index) => {
          const profile = profileOf(step.profileId);
          const ready = profile && !profile.needsSetup;
          return (
            <React.Fragment key={index}>
              <ChainLink />
              <div className="flex gap-4">
                {profile ? <ProfileAvatar color={profile.color || '#FBCB2D'} size={34} muted={!ready} /> : <span className="h-[2.125rem] w-[2.125rem] shrink-0 rounded-[0.625rem] border border-dashed border-tint/20" />}
                <Card className="min-w-0 flex-1 px-[1.125rem] py-3.5">
                  <div className="flex items-baseline gap-2.5"><span className="caption tabular-nums">{index + 1}</span><span className="truncate text-sm font-semibold text-text-primary">{profile?.name || 'Missing profile'}</span></div>
                  <p className={`mt-0.5 text-[0.8125rem] ${step.prompt ? 'text-text-muted' : 'italic text-text-subtle'}`}>{step.prompt || 'No extra instructions. It follows its own rules.'}</p>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {ready
                      ? <span className="rounded-md bg-tint/[0.05] px-2 py-0.5 font-mono text-[0.6875rem] text-text-secondary">{profile.model}</span>
                      : profile && <button type="button" onClick={() => onSetUp(profile)} className={`text-[0.8125rem] font-semibold ${SETUP}`}>No model · Set up</button>}
                    <span className="rounded-md bg-tint/[0.05] px-2 py-0.5 text-xs text-text-secondary">{step.includeContext === false ? 'No workspace context' : 'Workspace context'}</span>
                    {index > 0 && <span className="rounded-md bg-tint/[0.05] px-2 py-0.5 text-xs text-text-secondary">{step.includeChatHistory === false ? 'No chat history' : 'Chat history'}</span>}
                  </div>
                </Card>
              </div>
            </React.Fragment>
          );
        })}
        <ChainLink />
        <ChainEnd icon={Reply} title="Reply in chat" text="Only the last step answers" />
      </Section>
    </div>
  );
}

export function VariableDetail({ variable, usedBy, onEdit, onCopy, onDelete }) {
  return (
    <div className="mx-auto max-w-[54rem] px-14 pb-16 pt-10">
      <DetailHeader
        title={variable.name}
        meta={<>Type <button type="button" onClick={onCopy} className="font-mono text-accent hover:brightness-110" aria-label="Copy the tag">{`{{${variable.key}}}`}</button> in any rules or workflow step</>}
        actions={(
          <>
            <IconButton icon={Copy} label="Copy the tag" onClick={onCopy} />
            <IconButton icon={Trash2} label="Delete" tone="danger" onClick={onDelete} />
            <Button variant="ghost" size="sm" icon={Pencil} onClick={onEdit}>Edit</Button>
          </>
        )}
      />
      {variable.description && <p className="mt-6 text-[0.9375rem] leading-relaxed text-text-secondary">{variable.description}</p>}
      <Section title="It becomes">
        <Card className="px-5 py-4"><p className="whitespace-pre-wrap text-sm leading-relaxed text-text-primary select-text">{variable.value || <span className="text-text-subtle">Empty</span>}</p></Card>
      </Section>
      <Section title="Used in">
        {usedBy.length === 0
          ? <p className="text-[0.8125rem] text-text-subtle">No profile or workflow uses it yet.</p>
          : <div className="flex flex-wrap gap-2">{usedBy.map(item => <span key={item.key} className="inline-flex h-7 items-center gap-1.5 rounded-md bg-tint/[0.05] px-2.5 text-xs text-text-secondary">{item.color ? <ReedPen size={12} color={item.color} /> : <Workflow className="h-3 w-3" aria-hidden="true" />}{item.name}</span>)}</div>}
      </Section>
    </div>
  );
}
