import React, { useState, useEffect, useMemo } from 'react';
import { Archive, MessageSquare, EyeOff, AlertTriangle, User } from 'lucide-react';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import Checkbox from '../ui/Checkbox';
import Tooltip from '../ui/Tooltip';
import { ProfileAvatar } from './ProfileModal';
import { ToneTile } from './ModalParts';

// Each message is exactly one of archive, keep or drop, so the token bar and summary card agree.
const ARCHIVE = 'archive';
const KEEP = 'keep';
const DROP = 'drop';

const estimateTokens = (str) => Math.ceil((str || '').length / 4);

// Archiving runs in three stages and the slow ones are the first and the last.
// Naming the stage turns a long wait into something the reader can follow.
const STAGE_LABELS = {
  indexing: 'Saving history',
  summarizing: 'Writing recap',
  tagging: 'Tagging entities'
};

function progressLabel(progress) {
  if (!progress) return 'Archiving...';
  const label = STAGE_LABELS[progress.stage] || 'Archiving';
  if (progress.total > 1) return `${label} ${progress.done}/${progress.total}`;
  return `${label}...`;
}

export default function SummarizeModal({
  isOpen,
  onClose,
  chatId,
  electronAPI,
  nextSummaryNumber = 1,
  onConfirm,
  isVectorizing,
  progress,
  workspaceName = null
}) {
  const [customTitle, setCustomTitle] = useState('');
  const [pendingList, setPendingList] = useState([]);
  const [reservedList, setReservedList] = useState([]);
  const [includeRecent, setIncludeRecent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');

  // The window always reads the stored history, never a renderer copy: what it
  // offers is exactly what the archive will accept.
  useEffect(() => {
    if (!isOpen || !chatId || !electronAPI?.getArchiveOverview) return;
    let cancelled = false;

    (async () => {
      setLoading(true);
      setLoadError('');
      try {
        const overview = await electronAPI.getArchiveOverview(chatId);
        if (cancelled) return;
        if (!overview?.success) {
          setLoadError(overview?.error || 'Could not read this workspace history.');
          setPendingList([]);
          return;
        }

        const toEntry = (msg, state) => ({
          id: msg.id,
          role: msg.role,
          content: msg.content,
          aiName: msg.aiName,
          aiColor: msg.aiColor,
          reserved: !!msg.reserved,
          state
        });

        setPendingList(overview.messages.filter(m => m.archivable).map(m => toEntry(m, ARCHIVE)));
        // Recent messages start out staying put: including them is a decision,
        // never a side effect of opening the window.
        setReservedList(overview.messages.filter(m => m.reserved).map(m => toEntry(m, KEEP)));
        setIncludeRecent(false);
        setCustomTitle('');
      } catch (err) {
        if (!cancelled) setLoadError(err?.message || 'Could not read this workspace history.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => { cancelled = true; };
  }, [isOpen, chatId, electronAPI]);


  const visibleList = useMemo(
    () => (includeRecent ? [...pendingList, ...reservedList] : pendingList),
    [pendingList, reservedList, includeRecent]
  );

  const totals = useMemo(() => {
    let archiveTokens = 0;
    let keepTokens = 0;
    let dropTokens = 0;
    let archiveCount = 0;
    let keepCount = 0;
    let dropCount = 0;
    for (const msg of visibleList) {
      const tokens = estimateTokens(msg.content);
      if (msg.state === ARCHIVE) { archiveTokens += tokens; archiveCount += 1; }
      else if (msg.state === DROP) { dropTokens += tokens; dropCount += 1; }
      else { keepTokens += tokens; keepCount += 1; }
    }
    return { archiveTokens, keepTokens, dropTokens, archiveCount, keepCount, dropCount };
  }, [visibleList]);

  if (!isOpen) return null;

  const updateEntry = (id, resolve) => {
    if (isVectorizing) return;
    const apply = prev => prev.map(m => (m.id === id ? { ...m, state: resolve(m.state) } : m));
    setPendingList(apply);
    setReservedList(apply);
  };

  const setState = (id, state) => updateEntry(id, () => state);

  const setAll = (state) => {
    if (isVectorizing) return;
    const apply = prev => prev.map(m => ({ ...m, state }));
    setPendingList(apply);
    if (includeRecent) setReservedList(apply);
  };

  const handleConfirmSubmit = () => {
    if (isVectorizing) return;
    onConfirm({
      messageIds: visibleList.filter(m => m.state === ARCHIVE).map(m => m.id),
      excludedMessageIds: visibleList.filter(m => m.state === DROP).map(m => m.id),
      customTitle: customTitle.trim() || `Summarization ${nextSummaryNumber}`
    });
  };

  const nothingToDo = totals.archiveCount === 0 && totals.dropCount === 0;
  const leaving = totals.archiveTokens + totals.dropTokens;
  const carried = Math.max(1, leaving + totals.keepTokens);
  const share = value => `${(value / carried) * 100}%`;

  return (
    <Modal
      onClose={isVectorizing ? () => {} : onClose}
      closeOnOverlay={!isVectorizing}
      closeOnEsc={!isVectorizing}
      showClose={!isVectorizing}
      size="editor"
      title="Archive to memory"
      subtitle={`${workspaceName ? `${workspaceName} · ` : ''}${pendingList.length} ${pendingList.length === 1 ? 'message can' : 'messages can'} be archived`}
      leading={<ToneTile icon={Archive} color="var(--app-accent)" />}
      className="!max-w-[64rem] max-h-[85vh] min-h-[28rem]"
    >
      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <aside className="custom-scrollbar space-y-5 overflow-y-auto border-b border-border-subtle p-5 md:w-72 md:shrink-0 md:border-b-0 md:border-r">
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-text-secondary">Title</span>
            <input
              type="text"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              disabled={isVectorizing}
              placeholder={`Summarization ${nextSummaryNumber}`}
              className="field-input h-10 px-3 text-sm"
            />
          </label>

          <div className="rounded-control border px-3.5 py-3" style={{ background: 'var(--theme-surface-well)', borderColor: 'var(--theme-border-well)' }}>
            <p className="text-xs font-semibold text-text-secondary">What the prompt carries</p>
            <div className="mt-2 flex h-2 overflow-hidden rounded-full" style={{ background: 'var(--theme-surface-well)' }}>
              <span style={{ width: share(totals.keepTokens), background: 'var(--theme-text-muted)' }} />
              <span style={{ width: share(totals.archiveTokens), background: 'var(--app-accent)' }} />
              <span style={{ width: share(totals.dropTokens), background: 'var(--theme-status-danger)' }} />
            </div>
            <p className="mt-2 text-xs leading-relaxed text-text-subtle">
              {leaving ? `About ${leaving.toLocaleString()} tokens leave it, ${totals.keepTokens.toLocaleString()} stay.` : `Nothing leaves it yet. ${totals.keepTokens.toLocaleString()} tokens stay.`}
            </p>
          </div>

          <ul className="space-y-2.5">
            {[
              [Archive, 'text-accent', 'Archive', 'leaves the prompt and goes into memory, found again when it matters.'],
              [MessageSquare, 'text-text-secondary', 'Keep', 'stays in every prompt, word for word.'],
              [EyeOff, 'text-status-danger', 'Drop', 'leaves the prompt for good. The message stays in the chat.'],
            ].map(([Icon, tone, label, text]) => (
              <li key={label} className="flex gap-2.5">
                <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${tone}`} aria-hidden="true" />
                <span className="text-[0.8125rem] leading-relaxed text-text-muted"><b className="font-semibold text-text-primary">{label}</b> {text}</span>
              </li>
            ))}
          </ul>

          {reservedList.length > 0 && (
            <div className="flex items-start gap-3 border-t border-border-subtle pt-4">
              <span className="mt-0.5"><Checkbox checked={includeRecent} disabled={isVectorizing} onChange={setIncludeRecent} ariaLabel={`Include the last ${reservedList.length} messages`} /></span>
              <button type="button" disabled={isVectorizing} onClick={() => setIncludeRecent(value => !value)} className="min-w-0 text-left focus-visible:outline-none">
                <span className="block text-sm text-text-secondary">Include the last {reservedList.length} {reservedList.length === 1 ? 'message' : 'messages'}</span>
                <span className="block text-xs leading-relaxed text-text-subtle">They are held back so the next reply keeps its thread. Include them when this closes a scene.</span>
              </button>
            </div>
          )}
        </aside>

        <section className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-3 px-5 pb-3 pt-4">
            <p className="text-[0.8125rem] text-text-muted">
              <b className="font-semibold tabular-nums text-accent">{totals.archiveCount}</b> to archive · <b className="font-semibold tabular-nums text-text-primary">{totals.keepCount}</b> kept · <b className="font-semibold tabular-nums text-status-danger">{totals.dropCount}</b> dropped
            </p>
            <div className="flex gap-1">
              <Button variant="subtle" size="sm" disabled={isVectorizing} onClick={() => setAll(ARCHIVE)}>Archive all</Button>
              <Button variant="subtle" size="sm" disabled={isVectorizing} onClick={() => setAll(KEEP)}>Keep all</Button>
            </div>
          </div>

          <div className="custom-scrollbar mx-5 mb-5 min-h-0 flex-1 select-text overflow-y-auto rounded-xl border border-tint/[0.08] surface-card">
            {loading && <p className="caption px-4 py-6 text-center">Reading the history…</p>}
            {!loading && loadError && (
              <p className="flex items-start gap-2 px-4 py-4 text-sm text-status-danger"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{loadError}</p>
            )}
            {!loading && !loadError && visibleList.length === 0 && (
              <p className="caption px-4 py-6 text-center leading-relaxed">
                Nothing left to archive. Everything older is already in memory{reservedList.length > 0 ? ', and the rest is the recent part kept for the next reply.' : ', and there is no older history yet.'}
              </p>
            )}
            {!loading && visibleList.map((msgObj, index) => {
              const isUser = msgObj.role === 'user';
              const edge = msgObj.state === ARCHIVE ? 'var(--app-accent)' : msgObj.state === DROP ? 'var(--theme-status-danger)' : 'transparent';
              const tone = msgObj.state === DROP ? 'text-text-subtle line-through' : msgObj.state === ARCHIVE ? 'text-text-secondary' : 'text-text-muted';
              return (
                <div key={msgObj.id} className={`flex items-start gap-3 px-4 py-3 ${index ? 'border-t border-border-subtle' : ''}`} style={{ boxShadow: `inset 2px 0 0 ${edge}` }}>
                  {isUser
                    ? <span aria-hidden="true" className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-accent" style={{ background: 'color-mix(in srgb, var(--app-accent) 14%, transparent)', boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--app-accent) 30%, transparent)' }}><User className="h-3.5 w-3.5" /></span>
                    : <ProfileAvatar color={msgObj.aiColor || '#94a3b8'} size={24} />}
                  <div className="min-w-0 flex-1">
                    <span className={`text-xs font-semibold ${isUser ? 'text-accent' : 'text-text-secondary'}`}>
                      {isUser ? 'User' : msgObj.aiName || 'AI'}
                      {msgObj.reserved && <span className="ml-1.5 font-normal text-text-subtle">recent</span>}
                    </span>
                    <p className={`mt-0.5 line-clamp-2 whitespace-pre-wrap text-[0.8125rem] leading-relaxed ${tone}`}>{msgObj.content}</p>
                  </div>
                  <div role="radiogroup" aria-label="What happens to this message" className="inline-flex shrink-0 gap-0.5 rounded-control border border-border-default bg-surface-input p-0.5">
                    {[
                      [ARCHIVE, Archive, 'Archive', 'bg-accent/[0.13] text-accent ring-1 ring-inset ring-accent/45'],
                      [KEEP, MessageSquare, 'Keep', 'bg-surface-hover text-text-primary ring-1 ring-inset ring-border-strong'],
                      [DROP, EyeOff, 'Drop', 'bg-status-danger/10 text-status-danger ring-1 ring-inset ring-status-danger/40'],
                    ].map(([state, Icon, label, on]) => (
                      <Tooltip key={state} content={label}>
                        <button
                          type="button"
                          role="radio"
                          aria-checked={msgObj.state === state}
                          aria-label={label}
                          disabled={isVectorizing}
                          onClick={() => setState(msgObj.id, state)}
                          className={`inline-flex h-7 w-8 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-not-allowed ${msgObj.state === state ? on : 'text-text-muted hover:text-text-primary'}`}
                        >
                          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                        </button>
                      </Tooltip>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border-subtle px-5 py-3.5">
        <Button variant="subtle" disabled={isVectorizing} onClick={onClose}>Cancel</Button>
        <Button icon={isVectorizing ? null : Archive} loading={isVectorizing} disabled={loading || nothingToDo} onClick={handleConfirmSubmit}>
          {isVectorizing ? progressLabel(progress) : 'Archive'}
        </Button>
      </div>
    </Modal>
  );
}
