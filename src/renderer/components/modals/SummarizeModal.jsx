import React, { useState, useEffect, useRef, useMemo } from 'react';
import { X, Check, CheckSquare, Square, Info, Archive, MessageSquare, EyeOff, AlertTriangle } from 'lucide-react';

// Three things can happen to a message in this window, and only one of them at
// a time. "archive" folds it into the new summary and out of live history;
// "keep" leaves it whole in the payload; "drop" mutes it for good. A message can
// never be archived and live at the same time, which is what used to make the
// token bar and the summary card disagree.
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
  progress
}) {
  const [customTitle, setCustomTitle] = useState('');
  const [pendingList, setPendingList] = useState([]);
  const [reservedList, setReservedList] = useState([]);
  const [includeRecent, setIncludeRecent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState('');
  const modalRef = useRef(null);

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

  useEffect(() => {
    function handleClickOutside(event) {
      if (modalRef.current && !modalRef.current.contains(event.target) && !isVectorizing) {
        onClose();
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, onClose, isVectorizing]);

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

  const cycleState = (id) => updateEntry(
    id,
    current => (current === ARCHIVE ? KEEP : current === KEEP ? DROP : ARCHIVE)
  );

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm select-none p-4">
      <div
        ref={modalRef}
        className="w-full max-w-5xl max-h-[85vh] min-h-[28rem] bg-[#0a161d]/95 border border-gray-800/80 rounded-2xl flex flex-col shadow-2xl relative animate-in zoom-in-95 duration-200"
      >
        {/* Modal Header */}
        <div className="flex items-center justify-between p-5 border-b border-gray-800/80">
          <div className="flex flex-col">
            <h3 className="text-sm font-bold text-white uppercase tracking-wider">Archive Chat Memory</h3>
            <span className="caption mt-0.5">Choose what moves into long-term memory and what stays in the conversation</span>
          </div>
          <button
            disabled={isVectorizing}
            onClick={onClose}
            className="text-gray-500 hover:text-white hover:bg-white/5 p-1 rounded-md transition-colors disabled:opacity-30 disabled:cursor-not-allowed cursor-pointer"
          >
            <X className="w-4.5 h-4.5" />
          </button>
        </div>

        {/* Modal Body: settings rail on the left, the messages themselves on the right */}
        <div className="flex-1 min-h-0 flex flex-col md:flex-row">
          <aside className="md:w-72 md:shrink-0 md:border-r border-b md:border-b-0 border-gray-800/80 p-5 space-y-4 overflow-y-auto custom-scrollbar">
          {/* Custom title block */}
          <div className="flex flex-col space-y-1.5 shrink-0">
            <label className="text-[0.625rem] font-bold text-gray-400 uppercase tracking-wider">Memory Chapter Title (Optional)</label>
            <input
              type="text"
              value={customTitle}
              onChange={(e) => setCustomTitle(e.target.value)}
              disabled={isVectorizing}
              placeholder={`e.g. Summarization ${nextSummaryNumber}`}
              className="bg-[#011419] border border-gray-800/80 rounded-xl px-3 py-2 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-accent transition-colors"
            />
          </div>

          {/* Premium Info Tooltip Block */}
          <div className="flex items-start space-x-2.5 bg-[#1a2d32]/20 border border-[#FBCB2D]/15 rounded-xl p-3 select-text shrink-0">
            <Info className="w-4 h-4 text-accent shrink-0 mt-0.5" />
            <div className="flex flex-col space-y-1 text-[0.625rem] text-gray-300 leading-relaxed">
              <span className="font-bold text-gray-200">How Memory Archiving Works:</span>
              <p>
                <strong className="text-gray-200">Archive</strong> stores the message word for word in your local vector database (RAG) and takes it out of the active context.
                The AI searches that database each turn and pulls back only what is relevant, so a long history costs a fraction of its size.
                If Chat Archive Summaries is enabled and a System AI is configured, Kallamo also writes a short recap and World Index tags.
                <br />
                <strong className="text-gray-200">Keep active</strong> leaves the message whole in every prompt. <strong className="text-gray-200">Drop</strong> removes it from context for good, without deleting it from the log.
                Archived and dropped messages stay visible in the chat either way.
                {reservedList.length > 0 && (
                  <> The most recent <strong className="text-gray-200">{reservedList.length}</strong> {reservedList.length === 1 ? 'message is' : 'messages are'} held back so the next reply keeps its continuity. Include them if they belong to the chapter you are closing.</>
                )}
              </p>
            </div>
          </div>

          {reservedList.length > 0 && (
            <label className={`flex items-start gap-2.5 rounded-xl border p-3 cursor-pointer transition-colors ${includeRecent ? 'bg-accent/5 border-accent/30' : 'bg-[#011419] border-gray-800/80 hover:border-gray-700'}`}>
              <input
                type="checkbox"
                checked={includeRecent}
                disabled={isVectorizing}
                onChange={(e) => setIncludeRecent(e.target.checked)}
                className="mt-0.5 accent-[#FBCB2D] cursor-pointer"
              />
              <span className="flex flex-col">
                <span className="text-[0.625rem] font-bold text-gray-200 uppercase tracking-wider">Include the last {reservedList.length}</span>
                <span className="text-[0.625rem] text-gray-400 leading-relaxed">
                  Archiving a recent message takes it out of the conversation right away, and the AI will only see it again if it matches what you write next. Best when you are closing a scene, not continuing one.
                </span>
              </span>
            </label>
          )}
          </aside>

          <section className="flex-1 min-h-0 flex flex-col p-5 space-y-3">
          {/* Selection Controls */}
          <div className="flex items-center justify-between shrink-0 flex-wrap gap-y-2">
            <span className="text-[0.625rem] font-bold text-gray-400 uppercase tracking-wide">
              <span className="text-accent font-mono">{totals.archiveCount}</span> archiving
              <span className="text-gray-700 mx-1.5">|</span>
              <span className="text-gray-300 font-mono">{totals.keepCount}</span> staying
              <span className="text-gray-700 mx-1.5">|</span>
              <span className="text-red-400/90 font-mono">{totals.dropCount}</span> dropped
            </span>
            <div className="flex items-center space-x-2 text-[0.625rem] uppercase font-bold tracking-wider">
              <button
                disabled={isVectorizing}
                onClick={() => setAll(ARCHIVE)}
                className="flex items-center space-x-1 text-gray-400 hover:text-white cursor-pointer transition-colors"
              >
                <CheckSquare className="w-3.5 h-3.5" />
                <span>Archive All</span>
              </button>
              <span className="text-gray-800">|</span>
              <button
                disabled={isVectorizing}
                onClick={() => setAll(KEEP)}
                className="flex items-center space-x-1 text-gray-400 hover:text-white cursor-pointer transition-colors"
              >
                <Square className="w-3.5 h-3.5" />
                <span>Clear All</span>
              </button>
            </div>
          </div>

          {/* Messages list */}
          <div className="flex-1 min-h-0 space-y-2 overflow-y-auto custom-scrollbar pr-1 select-text">
            {loading && (
              <p className="text-xs text-gray-500 py-6 text-center">Reading history...</p>
            )}
            {!loading && loadError && (
              <div className="flex items-start space-x-2 bg-red-500/5 border border-red-500/25 rounded-xl p-3">
                <AlertTriangle className="w-4 h-4 text-red-400 shrink-0 mt-0.5" />
                <p className="text-xs text-red-300 leading-relaxed">{loadError}</p>
              </div>
            )}
            {!loading && !loadError && visibleList.length === 0 && (
              <p className="text-xs text-gray-500 py-6 text-center leading-relaxed">
                Nothing left to archive. Everything older is already in long-term memory,
                {reservedList.length > 0 ? ' and the rest is inside the recent window kept for continuity.' : ' and there is no older history yet.'}
              </p>
            )}
            {!loading && visibleList.map(msgObj => {
              const isUser = msgObj.role === 'user';
              const isArchive = msgObj.state === ARCHIVE;
              const isDrop = msgObj.state === DROP;
              return (
                <div
                  key={msgObj.id}
                  onClick={() => cycleState(msgObj.id)}
                  className={`flex items-start p-3 rounded-xl border transition-colors cursor-pointer ${isArchive
                    ? 'bg-[#1a2d32]/50 border-accent/35 shadow-md shadow-black/10'
                    : isDrop
                      ? 'bg-red-950/15 border-red-500/25 opacity-70'
                      : 'bg-[#011419]/45 border-gray-800/40 opacity-70'
                    }`}
                >
                  <div className="flex-1 pr-4">
                    <span className={`text-[0.5625rem] font-bold uppercase mb-1 block ${isUser ? 'text-accent' : 'text-gray-400'
                      }`}>
                      {isUser ? 'User Prompt' : 'AI Response'}
                      {msgObj.reserved && <span className="ml-1.5 text-gray-500 normal-case font-semibold">recent</span>}
                    </span>
                    <p className={`text-xs leading-relaxed line-clamp-3 whitespace-pre-wrap ${isDrop ? 'text-gray-500 line-through decoration-red-500/40' : 'text-gray-300'}`}>
                      {msgObj.content}
                    </p>
                  </div>
                  <div className="shrink-0 flex items-center space-x-1 pt-0.5 select-none" onClick={(e) => e.stopPropagation()}>
                    <StateButton
                      active={isArchive}
                      onClick={() => setState(msgObj.id, ARCHIVE)}
                      title="Archive into this summary"
                      activeClass="bg-accent border-accent text-[#011419]"
                      disabled={isVectorizing}
                    >
                      <Archive className="w-3 h-3" />
                    </StateButton>
                    <StateButton
                      active={msgObj.state === KEEP}
                      onClick={() => setState(msgObj.id, KEEP)}
                      title="Keep in the active conversation"
                      activeClass="bg-gray-300 border-gray-300 text-[#011419]"
                      disabled={isVectorizing}
                    >
                      <MessageSquare className="w-3 h-3" />
                    </StateButton>
                    <StateButton
                      active={isDrop}
                      onClick={() => setState(msgObj.id, DROP)}
                      title="Drop from context entirely"
                      activeClass="bg-red-500/80 border-red-500/80 text-white"
                      disabled={isVectorizing}
                    >
                      <EyeOff className="w-3 h-3" />
                    </StateButton>
                  </div>
                </div>
              );
            })}
          </div>
          </section>
        </div>

        {/* Modal Footer */}
        <div className="p-5 border-t border-gray-800/80 flex items-center justify-between gap-3 shrink-0 flex-wrap">
          <span className="text-[0.625rem] text-gray-500 uppercase tracking-wide font-bold">
            {totals.archiveTokens > 0 || totals.dropTokens > 0
              ? <>~{(totals.archiveTokens + totals.dropTokens).toLocaleString()} tokens leaving active context</>
              : <>Nothing selected yet</>}
          </span>
          <div className="flex items-center space-x-3">
            <button
              disabled={isVectorizing}
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold uppercase tracking-wider text-gray-400 hover:text-white hover:bg-white/5 rounded-xl cursor-pointer transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Cancel
            </button>
            <button
              disabled={isVectorizing || loading || nothingToDo}
              onClick={handleConfirmSubmit}
              className="px-4 py-2 text-xs font-bold uppercase tracking-wider bg-accent text-[#011419] rounded-xl hover:brightness-110 cursor-pointer transition-all disabled:opacity-40 disabled:cursor-not-allowed flex items-center space-x-2"
            >
              {isVectorizing ? (
                <span>{progressLabel(progress)}</span>
              ) : (
                <>
                  <Check className="w-3.5 h-3.5" />
                  <span>Archive</span>
                </>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function StateButton({ active, onClick, title, activeClass, disabled, children }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`w-6 h-6 rounded-md border flex items-center justify-center transition-colors cursor-pointer disabled:cursor-not-allowed ${active ? activeClass : 'border-gray-700 text-gray-500 hover:text-gray-300 hover:border-gray-500'
        }`}
    >
      {children}
    </button>
  );
}
