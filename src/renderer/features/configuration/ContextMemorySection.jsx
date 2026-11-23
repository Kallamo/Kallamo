import { useEffect, useRef, useState } from 'react';
import { AlertTriangle, Drama, Loader2, MoreHorizontal, Pencil, RefreshCw, Trash2 } from 'lucide-react';
import { MemoryGlyph, WorkspaceGlyph } from '../../components/ui/glyphs';
import SegmentedControl from '../../components/ui/SegmentedControl';
import Button from '../../components/ui/Button';
import IconButton from '../../components/ui/IconButton';
import ConfirmDialog from '../../components/ui/ConfirmDialog';
import { Menu, MenuItem, MenuSeparator } from '../../components/ui/Menu';
import payloadBudgetContract from '../../../shared/payload-budget.json';
import { selectActiveMessages, selectArchivableMessages, coverageStats } from '../chat/archive-coverage';
import { estimateMessageTokens } from '../chat/message-content';
import { ConfigSection, SettingsList, ShareSlider, SwitchRow, Track, UnitNumberField, formatNumber } from './ConfigParts';

const SUMMARY_PREVIEW = 4;

const parseBlocks = value => {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};

// Summaries belong to one conversation; notes and files to both.
const ownSummary = (block, thread) => (block.thread === 'roleplay') === (thread === 'roleplay');

export default function ContextMemorySection({ sectionRef, activeChat, handleSaveChat, electronAPI, refreshChats, showToast, activeMessages, onTriggerSummarize, roleplayEnabled = false }) {
  const [maxContext, setMaxContext] = useState(payloadBudgetContract.defaultMaxPayloadTokens);
  const [archiveThreshold, setArchiveThreshold] = useState(60000);
  // Which conversation the archive settings below are about. Without roleplay there is only the Chat.
  const [chosenThread, setChosenThread] = useState('roleplay');
  const thread = roleplayEnabled ? chosenThread : 'chat';
  const threadState = thread === 'roleplay'
    ? (activeChat.roleplayThread || {})
    : { autoSummarize: activeChat.autoSummarize, archiveThreshold: activeChat.archiveThreshold };
  const [roleplayShare, setRoleplayShare] = useState(30);
  useEffect(() => setRoleplayShare(Number(activeChat.chatRoleplayShare) || 30), [activeChat.id, activeChat.chatRoleplayShare]);
  const [archiveMessages, setArchiveMessages] = useState([]);
  const [showAll, setShowAll] = useState(false);
  const [renamingId, setRenamingId] = useState(null);
  const [renameDraft, setRenameDraft] = useState('');
  // { kind: 'reset' } | { kind: 'rebuild', block } | { kind: 'delete', block }
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [finishingId, setFinishingId] = useState(null);
  const [progress, setProgress] = useState({});

  useEffect(() => {
    setMaxContext(Number(activeChat.maxContext) > 0 ? Number(activeChat.maxContext) : payloadBudgetContract.defaultMaxPayloadTokens);
    setArchiveThreshold(Number(threadState.archiveThreshold ?? 60000) || 60000);
  }, [activeChat.id, activeChat.maxContext, threadState.archiveThreshold, thread]);

  useEffect(() => {
    let cancelled = false;
    electronAPI.getChatMessages(activeChat.id, thread).then(messages => { if (!cancelled) setArchiveMessages(messages || []); });
    return () => { cancelled = true; };
  }, [activeChat.id, activeMessages, electronAPI, thread]);

  // The finishing pass runs after the archive window closes, so this is where it reports itself.
  useEffect(() => {
    if (!electronAPI?.onSummarizationProgress) return undefined;
    return electronAPI.onSummarizationProgress(payload => {
      if (!payload?.blockId || payload.chatId !== activeChat.id) return;
      setProgress(current => ({ ...current, [payload.blockId]: payload }));
    });
  }, [activeChat.id, electronAPI]);

  const blocks = parseBlocks(activeChat.memoryBlocks).filter(block => block && (block.type !== 'summarized' || ownSummary(block, thread)));
  const summaries = blocks.filter(block => block.type !== 'manual').slice().reverse();
  const visibleSummaries = showAll ? summaries : summaries.slice(0, SUMMARY_PREVIEW);

  const save = patch => handleSaveChat({ ...activeChat, ...patch });
  // The Chat's archive settings live on the workspace row; the Roleplay's in its own state.
  const saveThread = async patch => {
    if (thread === 'chat') return save(patch);
    const result = await electronAPI.setThreadState(activeChat.id, 'roleplay', patch);
    if (!result?.success) showToast(result?.error || 'Could not save.', 'error');
    await refreshChats?.(activeChat.id);
  };
  const commitMaxContext = () => {
    const value = Math.min(payloadBudgetContract.maximumMaxPayloadTokens, Math.max(payloadBudgetContract.minimumMaxPayloadTokens, Math.floor(Number(maxContext) || payloadBudgetContract.defaultMaxPayloadTokens)));
    setMaxContext(value);
    if (value !== Number(activeChat.maxContext)) save({ maxContext: value });
  };
  const commitThreshold = () => {
    const value = Math.max(1000, Math.floor(Number(archiveThreshold) || 60000));
    setArchiveThreshold(value);
    if (value !== Number(threadState.archiveThreshold)) saveThread({ archiveThreshold: value });
  };

  const active = selectActiveMessages(archiveMessages, blocks);
  const tokensUsed = active.reduce((total, message) => total + estimateMessageTokens(message.content), 0);
  const stats = coverageStats(archiveMessages, blocks);
  const percentage = Math.min(100, (tokensUsed / Math.max(1, archiveThreshold)) * 100);
  const meterColor = percentage >= 95 ? 'var(--color-status-danger)' : percentage >= 75 ? 'var(--color-status-warning)' : 'var(--app-accent)';

  const summarizeNow = () => {
    if (!selectArchivableMessages(archiveMessages, blocks).length) {
      showToast(stats.active > 0
        ? 'Only the most recent messages are left, and those stay active for continuity.'
        : 'Every message is already archived or dropped.', 'info');
      return;
    }
    onTriggerSummarize?.(thread);
  };

  const run = async (work, failure) => {
    setBusy(true);
    try { await work(); } catch (error) {
      console.error(failure, error);
      showToast(failure, 'error');
    } finally {
      setBusy(false);
      setDialog(null);
    }
  };

  const resetSummaries = () => run(async () => {
    const result = await electronAPI.resetChatSummaries(activeChat.id, thread);
    if (!result?.success) throw new Error(result?.error);
    await refreshChats?.(activeChat.id);
    const parts = [];
    if (result.removedSummaries > 0) parts.push(`${result.removedSummaries} ${result.removedSummaries === 1 ? 'summary' : 'summaries'} removed`);
    if (result.restoredDropped > 0) parts.push(`${result.restoredDropped} dropped ${result.restoredDropped === 1 ? 'message' : 'messages'} restored`);
    showToast(parts.length ? `${parts.join(', ')}. That history is active again.` : 'There was nothing to rebuild.', 'info');
  }, 'Could not rebuild summaries.');

  const rebuildSummary = block => run(async () => {
    const result = await electronAPI.rebuildChatSummary(activeChat.id, block.id);
    if (!result?.success) throw new Error(result?.error);
    await refreshChats?.(activeChat.id);
    showToast(`${result.restoredMessages} ${result.restoredMessages === 1 ? 'message is' : 'messages are'} back in the conversation.`, 'info');
  }, 'Could not rebuild this summary.');

  const deleteSummary = block => run(async () => {
    await electronAPI.deleteChatKbBlock?.(activeChat.id, { id: block.id, type: block.type, source: block.title, text: block.summary });
    await refreshChats?.(activeChat.id);
  }, 'Could not delete this summary.');

  const finishSummary = async block => {
    setFinishingId(block.id);
    try {
      const result = await electronAPI.finalizeSummaryBlock(activeChat.id, block.id);
      await refreshChats?.(activeChat.id);
      if (result?.taggingError) showToast(result.taggingError, 'error');
      else if (result?.success) showToast('Summary finished.', 'info');
      else showToast(result?.error || 'Could not finish this summary.', 'error');
    } catch (error) {
      console.error('Failed to finish summary block:', error);
      showToast('Could not finish this summary.', 'error');
    } finally {
      setFinishingId(null);
      setProgress(current => {
        const next = { ...current };
        delete next[block.id];
        return next;
      });
    }
  };

  const rename = async block => {
    const title = renameDraft.trim();
    setRenamingId(null);
    if (!title || title === block.title) return;
    try {
      const result = await electronAPI.renameChatKbBlock(activeChat.id, block.id, title);
      if (!result?.success) throw new Error('rename failed');
      await refreshChats?.(activeChat.id);
    } catch (error) {
      console.error(error);
      showToast('Could not rename this summary.', 'error');
    }
  };

  return (
    <ConfigSection
      id="context"
      sectionRef={sectionRef}
      icon={MemoryGlyph}
      title="Context & memory"
      description="How much the AI reads on each request, and when older messages are archived."
    >
      <div className="grid gap-6 md:grid-cols-2">
        <UnitNumberField
          label="Max API payload"
          unit="tokens"
          value={maxContext}
          min={payloadBudgetContract.minimumMaxPayloadTokens}
          max={payloadBudgetContract.maximumMaxPayloadTokens}
          step={1024}
          onChange={setMaxContext}
          onCommit={commitMaxContext}
          help="Everything sent on one request. Retrieved context and older history are trimmed to fit. A smaller limit on the API connection wins."
        />
      </div>

      {roleplayEnabled && (
        <>
          <h3 className="mb-2.5 mt-7 text-[0.8125rem] font-semibold text-text-muted">Roleplay history in the Chat</h3>
          <SettingsList>
            <SwitchRow
              label="Send roleplay history to the Chat"
              description="The Chat sees what happened in the story. It never writes to it."
              checked={activeChat.chatReadsRoleplay !== 0}
              onChange={checked => save({ chatReadsRoleplay: checked ? 1 : 0 })}
            />
            {activeChat.chatReadsRoleplay !== 0 && (
              <>
                <ShareSlider
                  label="History room in the Chat"
                  value={roleplayShare}
                  summary={`${roleplayShare}% roleplay · ${100 - roleplayShare}% this chat`}
                  leftLabel="Less roleplay"
                  rightLabel="More roleplay"
                  help="Of the room left for history on each Chat request. Unused roleplay room goes back to the Chat's own messages."
                  onChange={setRoleplayShare}
                  onCommit={() => { if (roleplayShare !== Number(activeChat.chatRoleplayShare)) save({ chatRoleplayShare: roleplayShare }); }}
                />
                <SwitchRow
                  label="Include roleplay summaries"
                  description="Archived chapters of the story, read before the recent turns."
                  checked={activeChat.chatRoleplaySummaries !== 0}
                  onChange={checked => save({ chatRoleplaySummaries: checked ? 1 : 0 })}
                />
              </>
            )}
          </SettingsList>
        </>
      )}

      <div className="mb-3 mt-7 flex flex-wrap items-center gap-3">
        <h3 className="flex-1 text-[0.8125rem] font-semibold text-text-muted">Archive</h3>
        {roleplayEnabled && (
          <SegmentedControl
            label="Conversation"
            value={thread}
            onChange={setChosenThread}
            options={[
              { value: 'chat', label: 'Chat', icon: WorkspaceGlyph },
              { value: 'roleplay', label: 'Roleplay', icon: Drama }
            ]}
          />
        )}
      </div>
      <div className="grid gap-6 md:grid-cols-2">
        <UnitNumberField
          label="Archive threshold"
          unit="tokens"
          value={archiveThreshold}
          min={1000}
          step={1000}
          onChange={setArchiveThreshold}
          onCommit={commitThreshold}
          help={thread === 'roleplay' ? 'When the Roleplay reaches this size, older turns are ready to be summarized.' : 'When the active conversation reaches this size, older messages are ready to be summarized.'}
        />
      </div>

      <div className="mt-5 rounded-card border border-border-subtle bg-surface-inset p-4">
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
          <span className="text-[0.8125rem] font-semibold text-text-secondary">{roleplayEnabled ? (thread === 'roleplay' ? 'Active roleplay' : 'Active chat') : 'Active conversation'}</span>
          <span className="flex-1 text-xs tabular-nums text-text-subtle">{active.length} {active.length === 1 ? 'message' : 'messages'}</span>
          <span className="text-[0.8125rem] tabular-nums text-text-muted"><b className="font-semibold text-text-primary">{formatNumber(tokensUsed)}</b> of {formatNumber(archiveThreshold)} tokens</span>
        </div>
        <Track percent={percentage} color={meterColor} className="my-3 h-1.5" label="Active conversation size" value={Math.round(percentage)} />
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="ghost" size="sm" onClick={summarizeNow}>Summarize now</Button>
          <span className="flex-1 text-xs tabular-nums text-text-subtle">
            {formatNumber(stats.archived)} archived · {formatNumber(stats.active)} active{stats.excluded > 0 ? ` · ${formatNumber(stats.excluded)} dropped` : ''}
          </span>
          {(stats.archived > 0 || stats.excluded > 0) && (
            <Button variant="subtle" size="sm" icon={RefreshCw} onClick={() => setDialog({ kind: 'reset' })}>Rebuild everything</Button>
          )}
        </div>
      </div>

      <SettingsList className="mt-3">
        <SwitchRow
          label="Summarize automatically"
          description={thread === 'roleplay' ? 'Archive older turns on their own when the threshold is reached.' : 'Archive older messages on their own when the threshold is reached.'}
          checked={threadState.autoSummarize === 1}
          onChange={checked => saveThread({ autoSummarize: checked ? 1 : 0 })}
        />
        <SwitchRow
          label="Context meter in the message box"
          description="Shows how full the active conversation is next to the attach button."
          checked={activeChat.showContextBar === 1}
          onChange={checked => save({ showContextBar: checked ? 1 : 0 })}
        />
      </SettingsList>

      {summaries.length > 0 && (
        <div className="mt-6">
          <div className="mb-2.5 flex items-center gap-2">
            <span className="text-xs font-semibold text-text-muted">Summaries</span>
            <span className="flex-1 text-xs tabular-nums text-text-subtle">{summaries.length}, newest first</span>
            {summaries.length > SUMMARY_PREVIEW && (
              <Button variant="subtle" size="sm" onClick={() => setShowAll(value => !value)}>
                {showAll ? 'Show fewer' : `Show all ${summaries.length}`}
              </Button>
            )}
          </div>
          <div className="grid gap-2.5 md:grid-cols-2">
            {visibleSummaries.map(block => (
              <SummaryCard
                key={block.id}
                block={block}
                progress={progress[block.id]}
                finishing={finishingId === block.id}
                renaming={renamingId === block.id}
                renameDraft={renameDraft}
                onRenameDraft={setRenameDraft}
                onStartRename={() => { setRenamingId(block.id); setRenameDraft(block.title || ''); }}
                onRename={() => rename(block)}
                onCancelRename={() => setRenamingId(null)}
                onRebuild={() => setDialog({ kind: 'rebuild', block })}
                onDelete={() => (block.type === 'summarized' ? setDialog({ kind: 'delete', block }) : deleteSummary(block))}
                onFinish={() => finishSummary(block)}
              />
            ))}
          </div>
        </div>
      )}

      {dialog?.kind === 'reset' && (
        <ConfirmDialog
          tone="warning"
          icon={RefreshCw}
          title="Rebuild the whole archive?"
          message={<>
            Every summary in this workspace is deleted and the entire conversation returns to active
            context, starting from the very first message. Messages dropped by deleting a summary come back too.
            <br /><br />
            Nothing is lost, but your context jumps back to its full size and you will have to archive
            again from scratch. Custom memory and uploaded files are not affected.
          </>}
          actions={[
            { label: 'Cancel', variant: 'ghost', onClick: () => setDialog(null) },
            { label: 'Rebuild everything', variant: 'primary', loading: busy, onClick: resetSummaries }
          ]}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'rebuild' && (
        <ConfirmDialog
          tone="question"
          icon={RefreshCw}
          title={`Rebuild "${dialog.block.title}"?`}
          message="This summary is deleted and the messages it covered return to the conversation, ready to be archived differently. Your other summaries stay exactly as they are."
          actions={[
            { label: 'Cancel', variant: 'ghost', onClick: () => setDialog(null) },
            { label: 'Rebuild this summary', variant: 'primary', loading: busy, onClick: () => rebuildSummary(dialog.block) }
          ]}
          onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'delete' && (
        <ConfirmDialog
          tone="danger"
          title={`Delete "${dialog.block.title}"?`}
          message={<>
            The recap and the stored history both go, and every message this summary covered is
            dropped: it stays in your log but never reaches the AI again.
            <br /><br />
            Rebuild everything is the only way to bring those messages back. To keep them in the
            conversation instead, use Rebuild on this summary.
          </>}
          actions={[
            { label: 'Cancel', variant: 'ghost', onClick: () => setDialog(null) },
            { label: 'Delete and drop messages', variant: 'danger', loading: busy, onClick: () => deleteSummary(dialog.block) }
          ]}
          onClose={() => setDialog(null)}
        />
      )}
    </ConfigSection>
  );
}

function SummaryCard({ block, progress, finishing, renaming, renameDraft, onRenameDraft, onStartRename, onRename, onCancelRename, onRebuild, onDelete, onFinish }) {
  const [menuOpen, setMenuOpen] = useState(false);
  const anchorRef = useRef(null);
  const messageCount = Array.isArray(block.messages) ? block.messages.length : 0;
  return (
    <article className="flex flex-col gap-1.5 rounded-card border border-border-subtle bg-surface-inset py-3 pl-3.5 pr-2.5">
      <div className="flex items-center gap-2">
        {renaming ? (
          <input
            autoFocus
            value={renameDraft}
            onChange={event => onRenameDraft(event.target.value)}
            onBlur={onRename}
            onKeyDown={event => {
              if (event.key === 'Enter') event.currentTarget.blur();
              if (event.key === 'Escape') onCancelRename();
            }}
            aria-label="Summary name"
            className="field-input h-7 min-w-0 flex-1 px-2 text-[0.8125rem] font-semibold"
          />
        ) : (
          <span className="min-w-0 flex-1 truncate text-sm font-semibold text-text-primary">{block.title}</span>
        )}
        {messageCount > 0 && <span className="shrink-0 text-xs tabular-nums text-text-subtle">{messageCount} {messageCount === 1 ? 'message' : 'messages'}</span>}
        <IconButton ref={anchorRef} icon={MoreHorizontal} size="sm" label={`${block.title} actions`} aria-haspopup="menu" aria-expanded={menuOpen} onClick={() => setMenuOpen(value => !value)} />
        <Menu anchorRef={anchorRef} open={menuOpen} onClose={() => setMenuOpen(false)} label={`${block.title} actions`} className="w-56">
          <MenuItem icon={Pencil} label="Rename" onSelect={() => { setMenuOpen(false); onStartRename(); }} />
          {block.type === 'summarized' && <MenuItem icon={RefreshCw} label="Rebuild this summary" onSelect={() => { setMenuOpen(false); onRebuild(); }} />}
          <MenuSeparator />
          <MenuItem icon={Trash2} label="Delete" danger onSelect={() => { setMenuOpen(false); onDelete(); }} />
        </Menu>
      </div>
      <SummaryState block={block} progress={progress} busy={finishing} onFinish={onFinish} />
    </article>
  );
}

// Recap and tags report separately, so a tagging failure never hides a written recap.
function SummaryState({ block, progress, busy, onFinish }) {
  const recapPending = busy || block.recapStatus === 'pending';
  const recapFailed = block.recapStatus === 'failed';
  const taggingPending = block.taggingStatus === 'pending';
  const taggingFailed = block.taggingStatus === 'failed';
  const summarized = block.type === 'summarized';
  const needsFinish = summarized && !busy && (recapFailed || taggingFailed);
  const tagging = progress?.stage === 'tagging' && progress.total
    ? `Tagging names, ${progress.done} of ${progress.total}`
    : progress?.stage === 'summarizing' ? 'Writing the recap' : 'Tagging names';

  return (
    <>
      <p className="line-clamp-2 text-[0.8125rem] leading-relaxed text-text-muted">
        {block.summary
          ? block.summary
          : summarized && recapPending
            ? <span className="italic text-text-subtle">Writing the recap...</span>
            : summarized && recapFailed
              ? <span className="text-status-warning">{block.recapError || 'The recap could not be written.'}</span>
              : <span className="italic text-text-subtle">No recap was written for this archive.</span>}
      </p>
      {summarized && taggingFailed && (
        <span className="flex items-center gap-1.5 text-xs text-status-warning">
          <AlertTriangle aria-hidden="true" className="h-3.5 w-3.5 shrink-0" />
          <span className="min-w-0 flex-1" data-tooltip={block.taggingError || undefined}>
            {block.tagChunksPending > 0 && block.tagChunkTotal
              ? `Names not tagged in ${block.tagChunksPending} of ${block.tagChunkTotal} passages`
              : 'Names not tagged yet'}
          </span>
          {needsFinish && <Button variant="ghost" size="sm" className="!min-h-7" onClick={onFinish}>Finish</Button>}
        </span>
      )}
      {summarized && taggingPending && !taggingFailed && (
        <span className="flex items-center gap-1.5 text-xs text-text-muted">
          <Loader2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
          {tagging}
        </span>
      )}
      {needsFinish && !taggingFailed && (
        <span className="flex justify-end"><Button variant="ghost" size="sm" className="!min-h-7" onClick={onFinish}>Finish</Button></span>
      )}
      {busy && !taggingPending && (
        <span className="flex items-center gap-1.5 text-xs text-text-muted">
          <Loader2 aria-hidden="true" className="h-3.5 w-3.5 shrink-0 animate-spin motion-reduce:animate-none" />
          Finishing
        </span>
      )}
    </>
  );
}
