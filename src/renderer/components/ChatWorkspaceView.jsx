import { Suspense, useCallback, useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { ArrowDown, ArrowLeft, Paperclip, X, Folder, SlidersHorizontal, Trash2, History, Drama, RefreshCw } from 'lucide-react';
import { WorkspaceGlyph, WritingGlyph, WorldbuildGlyph, MemoryGlyph } from './ui/glyphs';
import SummarizeModal from './modals/SummarizeModal';
import { selectActiveMessages, selectArchivableMessages } from '../features/chat/archive-coverage';
import FilePreviewModal from './modals/FilePreviewModal';
import ConfirmDialog from './ui/ConfirmDialog';
import Checkbox from './ui/Checkbox';
import IconButton from './ui/IconButton';
import ChatInput from '../features/chat/components/ChatInput';
import ChatFind from '../features/chat/components/ChatFind';
import { findInMessages, rangesIn } from '../features/chat/chat-find';
import ChatMessageItem, { isImage, isVideo } from '../features/chat/components/ChatMessageItem';
import GenerationBubble from '../features/chat/components/GenerationBubble';
import ContextMeter from '../features/chat/components/ContextMeter';
import ReplyTargetPicker from '../features/chat/components/ReplyTargetPicker';
import RoleplayHistoryChip from '../features/chat/components/RoleplayHistoryChip';
import ThreadMoveDialog from '../features/chat/components/ThreadMoveDialog';
import Button from './ui/Button';
import { BLOCK_DRAG_TYPE } from '../features/roleplay/RoleplayLayoutBlock';
import RoleplayQuickPanel from '../features/roleplay/RoleplayQuickPanel';
import StoryIntro from '../features/onboarding/StoryIntro';
import { useTour } from '../features/onboarding/GuidedTour';
import { prepareGenerationSubmission, resolveActiveGenerationTarget } from '../features/chat/generation-target';
import { holdDeferredFrames, safeParseJson } from '../features/chat/diagnostic-format';
import { estimateMessageTokens } from '../features/chat/message-content';
import { useArchiveHistory } from '../features/chat/useArchiveHistory';
import {
  fetchPresentation,
  getCachedBackground,
  getCachedPresentation,
  getPreloadedFrames,
  setCachedBackground,
  setCachedPresentation
} from '../features/chat/workspace-presentation';
import { useStableCallback } from '../utils/useStableCallback';
import { perfEndAfterPaint, perfStart } from '../utils/perf';
import { ChatFilesView, ChatMemoryView, ConfigurationView, WorldbuildView, WritingDeskView, workspaceTabViews } from '../views';
import { forgetWorldbuildView } from '../features/worldbuild/worldbuildViewCache';
import { openConfigurationSection } from '../features/configuration/open-section';
import Tooltip from './ui/Tooltip';
import { firstActiveProfile, moveBetweenThreads, rebuildFailureMessage } from '../features/chat/thread-move-actions';

// Within this distance of the end the reader counts as following the conversation.
const FOLLOW_LATEST_THRESHOLD_PX = 96;
// The newest rows always render in full: the view opens on them, so their real heights
// must be known when the scroll position is set. Older rows may skip offscreen rendering.
const ALWAYS_RENDERED_ROWS = 10;

const bubbleAlpha = opacity => opacity / 100;
const ROLEPLAY_KEPT_LINE = count => `Your roleplay is kept (${count} ${count === 1 ? 'message' : 'messages'}). It comes back when Roleplay mode is on.`;

// The full name shows in a tooltip only when the header has cut it short.
function WorkspaceTitle({ title }) {
  const ref = useRef(null);
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node || typeof ResizeObserver === 'undefined') return undefined;
    const measure = () => setClipped(node.scrollWidth > node.clientWidth);
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    measure();
    return () => observer.disconnect();
  }, [title]);
  return (
    <Tooltip content={title} side="bottom" disabled={!clipped}>
      <h2 ref={ref} className="min-w-0 truncate text-sm font-semibold text-text-primary">{title}</h2>
    </Tooltip>
  );
}

export default function ChatWorkspaceView() {
  const {
    activeChat,
    activeMessages,
    hasOlderMessages,
    isLoadingOlderMessages,
    loadOlderChatMessages,
    jumpToChatStart,
    loadOlderUntil,
    writingProfiles,
    workflows,
    handleSendMessage,
    handleRegenerateMessage,
    handleEditUserMessage,
    handleSwitchAIAlternative,
    isGenerating,
    generationProgress,
    handleCancelGeneration,
    setCurrentView,
    activeWorkspaceView,
    setActiveWorkspaceView,
    settings,
    electronAPI,
    editError,
    setEditError,
    handleSaveChat,
    refreshChats,
    lastGeneratedMessageId,
    setLastGeneratedMessageId,
    setActiveMessages,
    showToast,
    activeThread,
    selectThread,
    forgetThreadCache,
    uiFlags,
    uiFlagsLoaded,
    dismissHint
  } = useApp();
  // The Chat and the Roleplay share this view; `thread` is the one on screen.
  const thread = activeThread === 'roleplay' ? 'roleplay' : 'chat';

  const workspaceId = activeChat?.id;
  // Seeded from the preload done while opening, so the first paint has the final layout.
  const [initialPresentation] = useState(() => getCachedPresentation(workspaceId));
  const [roleplayMode, setRoleplayMode] = useState(() => initialPresentation?.mode ?? false);
  const [roleplayPlayerName, setRoleplayPlayerName] = useState(null);
  const [entityNames, setEntityNames] = useState(null);
  const [roleplayPanelCollapsed, setRoleplayPanelCollapsed] = useState(() => initialPresentation?.collapsed ?? false);
  const [roleplayWorkspaceId, setRoleplayWorkspaceId] = useState(() => (initialPresentation ? workspaceId : null));
  const [roleplayBackground, setRoleplayBackground] = useState(() => getCachedBackground(workspaceId) || null);
  const roleplayBackgroundRequestRef = useRef(0);
  const [initialFrames] = useState(() => getPreloadedFrames(workspaceId));
  const [roleplayFrames, setRoleplayFrames] = useState(() => initialFrames?.frames || {});
  const [roleplayFrameRevision, setRoleplayFrameRevision] = useState(0);
  const [selectedTargetId, setSelectedTargetId] = useState(''); // Selected profile or workflow ID

  // Closing the workspace ends the visit: the next one opens Worldbuild on the overview.
  useEffect(() => {
    const workspaceId = activeChat.id;
    // After the tab's own unmount, which stores its place on the way out.
    return () => queueMicrotask(() => forgetWorldbuildView(workspaceId));
  }, [activeChat.id]);

  useEffect(() => {
    let active = true;
    const workspaceId = activeChat.id;
    roleplayBackgroundRequestRef.current += 1;
    const cachedPresentation = getCachedPresentation(workspaceId);
    setRoleplayBackground(getCachedBackground(workspaceId) || null);
    if (cachedPresentation) {
      setRoleplayMode(cachedPresentation.mode);
      setRoleplayPanelCollapsed(cachedPresentation.collapsed);
      setRoleplayWorkspaceId(workspaceId);
    } else {
      setRoleplayWorkspaceId(null);
      fetchPresentation(electronAPI, workspaceId).then(presentation => {
        if (!active) return;
        setRoleplayMode(presentation.mode);
        setRoleplayPanelCollapsed(presentation.collapsed);
        setRoleplayWorkspaceId(workspaceId);
      }).catch(() => {
        if (!active) return;
        setRoleplayMode(false);
        setRoleplayWorkspaceId(workspaceId);
      });
    }
    const updateMode = event => {
      if (event.detail?.workspaceId !== workspaceId) return;
      const mode = Boolean(event.detail.enabled);
      setCachedPresentation(workspaceId, {
        mode,
        collapsed: getCachedPresentation(workspaceId)?.collapsed ?? false
      });
      setRoleplayMode(mode);
      setRoleplayWorkspaceId(workspaceId);
    };
    window.addEventListener('roleplay-mode-change', updateMode);
    return () => { active = false; window.removeEventListener('roleplay-mode-change', updateMode); };
  }, [activeChat.id, electronAPI]);

  const handleRoleplayBackgroundChange = useCallback(background => {
    setCachedBackground(activeChat.id, background);
    const requestId = ++roleplayBackgroundRequestRef.current;
    if (!background?.imagePath) {
      setRoleplayBackground(background);
      return;
    }
    const image = new Image();
    const applyBackground = () => {
      if (roleplayBackgroundRequestRef.current === requestId) setRoleplayBackground(background);
    };
    image.addEventListener('load', applyBackground, { once: true });
    image.addEventListener('error', applyBackground, { once: true });
    image.src = `app-file:///${background.imagePath.replace(/\\/g, '/')}`;
    if (image.complete) applyBackground();
  }, [activeChat.id]);

  useEffect(() => {
    const refresh = event => {
      if (!event.detail?.workspaceId || event.detail.workspaceId === activeChat.id) {
        setRoleplayFrameRevision(value => value + 1);
      }
    };
    window.addEventListener('roleplay-state-change', refresh);
    const unsubscribe = electronAPI.onRoleplayResourceChanges?.(payload => {
      if (payload?.workspaceId === activeChat.id) setRoleplayFrameRevision(value => value + 1);
    });
    return () => {
      window.removeEventListener('roleplay-state-change', refresh);
      unsubscribe?.();
    };
  }, [activeChat.id, electronAPI]);

  const [backgroundNarrativeIds, setBackgroundNarrativeIds] = useState(() => new Set());
  useEffect(() => electronAPI.onNarrativeStateStatus?.(({ workspaceId: id, processing }) => {
    setBackgroundNarrativeIds(current => {
      const next = new Set(current);
      if (processing) next.add(id); else next.delete(id);
      return next;
    });
    // The analysis wrote the newest reply's frame; read it now rather than at the next state change.
    if (!processing && id === activeChat.id) setRoleplayFrameRevision(value => value + 1);
  }), [electronAPI, activeChat.id]);

  const roleplayFrameRequestRef = useRef(null);
  if (!roleplayFrameRequestRef.current) {
    roleplayFrameRequestRef.current = initialFrames
      ? { workspaceId, revision: 0, requestedIds: new Set(initialFrames.originIds) }
      : { workspaceId: null, revision: -1, requestedIds: new Set() };
  }

  useEffect(() => {
    const requestState = roleplayFrameRequestRef.current;
    if (requestState.workspaceId !== activeChat.id || requestState.revision !== roleplayFrameRevision) {
      // Another workspace starts empty; a new revision keeps the frames on screen until their reread lands.
      if (requestState.workspaceId !== activeChat.id) setRoleplayFrames({});
      requestState.workspaceId = activeChat.id;
      requestState.revision = roleplayFrameRevision;
      requestState.requestedIds = new Set();
    }
    // The Chat keeps the Roleplay's frames as they are, so coming back shows them without a reread.
    if (thread !== 'roleplay') return;
    const originIds = activeMessages.filter(message => message.role !== 'user').map(message => message.id);
    if (!originIds.length || !electronAPI.getRoleplayMessageFrames) {
      setRoleplayFrames({});
      requestState.requestedIds = new Set();
      return;
    }
    const missingOriginIds = originIds.filter(originId => !requestState.requestedIds.has(originId));
    if (!missingOriginIds.length) return;
    missingOriginIds.forEach(originId => requestState.requestedIds.add(originId));
    const requestWorkspaceId = activeChat.id;
    const requestRevision = roleplayFrameRevision;
    electronAPI.getRoleplayMessageFrames(activeChat.id, missingOriginIds).then(result => {
      const currentRequest = roleplayFrameRequestRef.current;
      if (currentRequest.workspaceId !== requestWorkspaceId || currentRequest.revision !== requestRevision || !result?.success) return;
      setRoleplayFrames(previous => {
        const next = { ...previous };
        for (const originId of missingOriginIds) delete next[originId];
        for (const frame of result.frames || []) next[frame.originId] = frame;
        return next;
      });
    }).catch(() => {
      const currentRequest = roleplayFrameRequestRef.current;
      if (currentRequest.workspaceId === requestWorkspaceId && currentRequest.revision === requestRevision) {
        missingOriginIds.forEach(originId => currentRequest.requestedIds.delete(originId));
      }
    });
  }, [activeChat.id, activeMessages, electronAPI, roleplayFrameRevision, thread]);

  const heldRoleplayFrames = useMemo(
    () => holdDeferredFrames(activeMessages, roleplayFrames, { analyzing: backgroundNarrativeIds.has(activeChat.id) }),
    [activeMessages, roleplayFrames, backgroundNarrativeIds, activeChat.id]
  );

  const [editingMessageId, setEditingMessageId] = useState(null);

  const [confirmDeleteData, setConfirmDeleteData] = useState(null);
  const [deleteAttachedFiles, setDeleteAttachedFiles] = useState(true);

  const [pendingFiles, setPendingFiles] = useState([]);

  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  const [summarizeModalOpen, setSummarizeModalOpen] = useState(false);
  const [summarizeProgress, setSummarizeProgress] = useState(null); // { stage, done, total }
  const [finishingBlockId, setFinishingBlockId] = useState(null);

  // Coverage reads this conversation's summaries only; notes and files belong to both.
  const threadMemoryBlocks = useMemo(() => {
    const blocks = safeParseJson(activeChat?.memoryBlocks, []);
    return (Array.isArray(blocks) ? blocks : []).filter(block => !block || block.type !== 'summarized'
      || (block.thread === 'roleplay') === (thread === 'roleplay'));
  }, [activeChat?.memoryBlocks, thread]);
  const threadState = thread === 'roleplay'
    ? (activeChat?.roleplayThread || {})
    : { autoSummarize: activeChat?.autoSummarize, archiveThreshold: activeChat?.archiveThreshold, lastTargetId: activeChat?.lastTargetId };
  const autoSummarizeKey = `${activeChat?.id}:${thread}`;

  // Counts summaries only, from the highest number used, so a deleted one never hands its number on.
  const nextSummaryNumber = useMemo(() => {
    const blocks = safeParseJson(activeChat?.memoryBlocks, []);
    const used = (Array.isArray(blocks) ? blocks : [])
      .filter(block => block && block.type === 'summarized')
      .map(block => {
        const match = /^\s*Summarization\s+(\d+)\s*$/i.exec(String(block.title || ''));
        return match ? Number(match[1]) : 0;
      });
    const summaryCount = (Array.isArray(blocks) ? blocks : []).filter(block => block && block.type === 'summarized').length;
    return Math.max(summaryCount, ...used, 0) + 1;
  }, [activeChat?.memoryBlocks]);
  const [isVectorizing, setIsVectorizing] = useState(false);
  // Bumped whenever archiving changes message state (covered or dropped) without
  // adding or removing messages, so the full history is read again.
  const [historyRevision, setHistoryRevision] = useState(0);
  const dismissedAutoSummarizeChatsRef = useRef(new Set());

  // The chat viewport is paginated for rendering only. Memory calculations and
  // archiving must always use the complete persisted history.
  const archiveMessages = useArchiveHistory({
    api: electronAPI,
    chatId: activeChat?.id,
    thread,
    activeMessages,
    revision: historyRevision,
    memoryBlocks: activeChat?.memoryBlocks
  });

  const activeSubView = activeWorkspaceView;
  const setActiveSubView = useCallback(view => {
    perfStart('tab-switch');
    setActiveWorkspaceView(view);
  }, [setActiveWorkspaceView]);
  const isChatVisible = activeSubView === 'chat' || activeSubView === 'roleplay';
  const [worldbuildFocusId, setWorldbuildFocusId] = useState(null); // entity to focus when opening Worldbuild from the text

  const openEntityInWorldbuild = (entityId) => {
    setWorldbuildFocusId(entityId || null);
    setActiveSubView('worldbuild');
  };
  // Other views open one of Worldbuild's own pages, such as Rules, by name.
  const [worldbuildSurface, setWorldbuildSurface] = useState(null);
  useEffect(() => {
    const open = event => {
      if (!event.detail?.surface) return;
      setWorldbuildSurface(event.detail.surface);
      setActiveSubView('worldbuild');
    };
    window.addEventListener('open-worldbuild-surface', open);
    return () => window.removeEventListener('open-worldbuild-surface', open);
  }, [setActiveSubView]);
  const [previewFile, setPreviewFile] = useState(null);

  const handleReinjectFile = (file) => {
    setPendingFiles(prev => {
      if (prev.some(f => f.name.toLowerCase() === file.name.toLowerCase())) return prev;
      return [...prev, {
        name: file.name,
        path: file.path || '',
        size: file.size || 0
      }];
    });
    setActiveSubView('chat');
  };

  const messageContainerRef = useRef(null);
  const messageContentRef = useRef(null);
  const previousScrollHeightRef = useRef(0);
  const preserveScrollPositionRef = useRef(false);
  const isFollowingLatestRef = useRef(true);
  const savedScrollTopRef = useRef(0);
  const chatShownRef = useRef(false);
  const wasGeneratingRef = useRef(false);
  const layoutAnchorRef = useRef(null);
  const fileInputRef = useRef(null);
  const [isFollowingLatest, setIsFollowingLatest] = useState(true);
  const [hasCompletedResponseBelow, setHasCompletedResponseBelow] = useState(false);

  // The list is revealed only once the roleplay layout is known, so it is never laid out
  // at one width and then re-flowed at another under the reader.
  const presentationReady = roleplayWorkspaceId === workspaceId;

  // The chat stays mounted behind the other tabs; coming back restores where the reader was.
  useLayoutEffect(() => {
    const container = messageContainerRef.current;
    if (!isChatVisible || !presentationReady || !container) return;
    container.scrollTop = isFollowingLatestRef.current ? container.scrollHeight : savedScrollTopRef.current;
    if (!chatShownRef.current) {
      chatShownRef.current = true;
      perfEndAfterPaint('workspace-open');
    }
  }, [isChatVisible, presentationReady]);

  useLayoutEffect(() => {
    perfEndAfterPaint('tab-switch');
  }, [activeSubView]);

  const pinToLatestIfFollowing = useCallback(() => {
    const container = messageContainerRef.current;
    // A hidden tab has no size, and a prepend restores its own position.
    if (!container || !container.clientHeight || preserveScrollPositionRef.current) return;
    if (isFollowingLatestRef.current) container.scrollTop = container.scrollHeight;
  }, []);

  // Any growth of the thread (a frame, an image, a reflow) keeps the end in view while the
  // reader follows it. Resize observations land before paint.
  useEffect(() => {
    const container = messageContainerRef.current;
    const content = messageContentRef.current;
    if (!container || !content || typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(pinToLatestIfFollowing);
    observer.observe(container);
    observer.observe(content);
    return () => observer.disconnect();
  }, [Boolean(activeChat), pinToLatestIfFollowing]);

  // New messages and the reply bubble are pinned in the same commit, without waiting for
  // an observation; declared before the prepend restore so it still sees that flag.
  useLayoutEffect(pinToLatestIfFollowing, [activeMessages, isGenerating, pinToLatestIfFollowing]);

  useLayoutEffect(() => {
    const container = messageContainerRef.current;
    if (!preserveScrollPositionRef.current || !container) return;
    container.scrollTop += container.scrollHeight - previousScrollHeightRef.current;
    preserveScrollPositionRef.current = false;
  }, [activeMessages]);

  useLayoutEffect(() => {
    const snapshot = layoutAnchorRef.current;
    const container = messageContainerRef.current;
    if (!snapshot || !container) return;
    layoutAnchorRef.current = null;

    if (snapshot.type === 'bottom') {
      container.scrollTop = container.scrollHeight - container.clientHeight - snapshot.distance;
      return;
    }

    const anchor = Array.from(container.querySelectorAll('[data-chat-message-id]'))
      .find(element => element.dataset.chatMessageId === snapshot.messageId);
    if (anchor) {
      const containerTop = container.getBoundingClientRect().top;
      container.scrollTop += anchor.getBoundingClientRect().top - containerTop - snapshot.offset;
    }
  }, [roleplayPanelCollapsed]);

  useEffect(() => {
    if (isGenerating) {
      setHasCompletedResponseBelow(false);
    } else if (wasGeneratingRef.current && !isFollowingLatestRef.current) {
      setHasCompletedResponseBelow(true);
    }
    wasGeneratingRef.current = isGenerating;
  }, [isGenerating]);

  const updateFollowingLatest = () => {
    const container = messageContainerRef.current;
    // A hidden tab reports no size; its last real position is what gets restored.
    if (!container || !container.clientHeight) return;
    savedScrollTopRef.current = container.scrollTop;

    const nextIsFollowingLatest = container.scrollHeight - container.scrollTop - container.clientHeight <= FOLLOW_LATEST_THRESHOLD_PX;
    if (nextIsFollowingLatest === isFollowingLatestRef.current) return;

    isFollowingLatestRef.current = nextIsFollowingLatest;
    setIsFollowingLatest(nextIsFollowingLatest);
    if (nextIsFollowingLatest) setHasCompletedResponseBelow(false);
  };

  const scrollToLatest = () => {
    isFollowingLatestRef.current = true;
    setIsFollowingLatest(true);
    setHasCompletedResponseBelow(false);
    messageContainerRef.current?.scrollTo({ top: messageContainerRef.current.scrollHeight, behavior: 'smooth' });
  };

  const handleRoleplayPanelCollapsedChange = useCallback(nextCollapsed => {
    const container = messageContainerRef.current;
    if (container) {
      const distance = Math.max(0, container.scrollHeight - container.scrollTop - container.clientHeight);
      if (isFollowingLatestRef.current) {
        layoutAnchorRef.current = { type: 'bottom', distance };
      } else {
        const containerTop = container.getBoundingClientRect().top;
        const anchor = Array.from(container.querySelectorAll('[data-chat-message-id]'))
          .find(element => element.getBoundingClientRect().bottom >= containerTop);
        layoutAnchorRef.current = anchor
          ? {
              type: 'message',
              messageId: anchor.dataset.chatMessageId,
              offset: anchor.getBoundingClientRect().top - containerTop
            }
          : { type: 'bottom', distance };
      }
    }
    setCachedPresentation(activeChat.id, { mode: roleplayMode, collapsed: nextCollapsed });
    setRoleplayPanelCollapsed(nextCollapsed);
  }, [activeChat.id, roleplayMode]);

  const openRoleplayConfiguration = useCallback(() => {
    setActiveSubView('configuration');
  }, [setActiveSubView]);

  const followLatestResponse = () => {
    isFollowingLatestRef.current = true;
    setIsFollowingLatest(true);
    setHasCompletedResponseBelow(false);
  };

  const handleLoadOlderMessages = async () => {
    if (messageContainerRef.current) {
      previousScrollHeightRef.current = messageContainerRef.current.scrollHeight;
      preserveScrollPositionRef.current = true;
    }
    try {
      await loadOlderChatMessages();
    } catch (error) {
      preserveScrollPositionRef.current = false;
      console.error('Failed to load older messages:', error);
    }
  };

  const handleJumpToStart = async () => {
    isFollowingLatestRef.current = false;
    setIsFollowingLatest(false);
    await jumpToChatStart();
    requestAnimationFrame(() => messageContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' }));
  };

  // navigator.clipboard is gated in Electron: main-process clipboard first, execCommand last.
  const copyText = useCallback(async (text) => {
    try { if (electronAPI?.copyToClipboard) return await electronAPI.copyToClipboard(text); } catch (e) {}
    try { return await navigator.clipboard.writeText(text); } catch (e) {}
    try {
      const ta = document.createElement('textarea');
      ta.value = text == null ? '' : String(text);
      ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.focus(); ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    } catch (e) {}
  }, [electronAPI]);

  // Prevent default window drag/drop behavior to stop Electron from navigating/opening files
  useEffect(() => {
    const preventDefault = (e) => {
      e.preventDefault();
    };

    window.addEventListener('dragover', preventDefault);
    window.addEventListener('drop', preventDefault);

    return () => {
      window.removeEventListener('dragover', preventDefault);
      window.removeEventListener('drop', preventDefault);
    };
  }, []);

  useEffect(() => {
    if (!electronAPI.onTriggerAutoSummarize) return;
    const unsubscribe = electronAPI.onTriggerAutoSummarize(({ chatId, thread: fromThread }) => {
      if (activeChat && activeChat.id === chatId && (fromThread || 'chat') === thread && !dismissedAutoSummarizeChatsRef.current.has(autoSummarizeKey)) {
        setSummarizeModalOpen(true);
      }
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [activeChat, electronAPI, thread, autoSummarizeKey]);

  // Token threshold auto-trigger monitor (runs on frontend when token usage is exceeded)
  useEffect(() => {
    if (
      activeChat
      && threadState.autoSummarize === 1
      && archiveMessages.length > 0
      && !summarizeModalOpen
      && !dismissedAutoSummarizeChatsRef.current.has(autoSummarizeKey)
    ) {
      const archiveThreshold = threadState.archiveThreshold || 60000;
      const activeMsgs = selectActiveMessages(archiveMessages, threadMemoryBlocks);

      const tokensUsed = activeMsgs.reduce((total, message) => total + estimateMessageTokens(message.content), 0);

      // Only nag when the window would actually have something to offer.
      const archivable = selectArchivableMessages(archiveMessages, threadMemoryBlocks);
      if (tokensUsed >= archiveThreshold && archivable.length > 0) {
        setSummarizeModalOpen(true);
      }
    }
  }, [archiveMessages, activeChat, summarizeModalOpen, threadMemoryBlocks, threadState.autoSummarize, threadState.archiveThreshold, autoSummarizeKey]);

  // Archiving reports which stage it is in, so a long run can say so instead of
  // looking frozen.
  useEffect(() => {
    if (!electronAPI?.onSummarizationProgress) return;
    return electronAPI.onSummarizationProgress((payload) => {
      if (!payload || payload.chatId !== activeChat?.id) return;
      setSummarizeProgress(payload);
    });
  }, [activeChat?.id]);

  // Each conversation remembers its own reply target; a choice made here wins until the chat row catches up.
  const chosenTargetsRef = useRef(new Map());
  // Restore the last target used, else the first active profile.
  useEffect(() => {
    if (activeChat) {
      const activeProfs = safeParseJson(activeChat.activeProfiles).filter(id => id && id !== 'undefined');
      const activeWfs = safeParseJson(activeChat.activeWorkflows).filter(id => id && id !== 'undefined');

      const validActiveProf = activeProfs.find(id => writingProfiles.some(p => p.id === id));
      const validActiveWf = activeWfs.find(id => workflows.some(w => w.id === id));

      const chosen = chosenTargetsRef.current.get(autoSummarizeKey);
      // The Roleplay starts on what the Chat used when it has nothing of its own yet.
      const lastTargetId = chosen || threadState.lastTargetId || (thread === 'roleplay' ? activeChat.lastTargetId : null);
      const lastStillValid = lastTargetId &&
        ((activeProfs.includes(lastTargetId) && writingProfiles.some(p => p.id === lastTargetId)) ||
         (activeWfs.includes(lastTargetId) && workflows.some(w => w.id === lastTargetId)));

      if (lastStillValid) {
        setSelectedTargetId(lastTargetId);
      } else if (validActiveProf) {
        setSelectedTargetId(validActiveProf);
      } else if (validActiveWf) {
        setSelectedTargetId(validActiveWf);
      } else {
        setSelectedTargetId('');
      }
    }
  }, [activeChat, writingProfiles, workflows, thread, threadState.lastTargetId, autoSummarizeKey]);

  const activeProfilesList = safeParseJson(activeChat?.activeProfiles);
  const activeWorkflowsList = safeParseJson(activeChat?.activeWorkflows);

  // Only show the active ones. No fallback to all if active settings are empty.
  const displayProfiles = writingProfiles.filter(p => activeProfilesList.includes(p.id));
  const displayWorkflows = workflows.filter(wf => activeWorkflowsList.includes(wf.id));

  const selectedTarget = displayProfiles.find(p => p.id === selectedTargetId) ||
    displayWorkflows.find(w => w.id === selectedTargetId);

  // Readiness uses the app's canonical, provider-aware `needsSetup` flag (linked API
  // profile + model + credentials). The onboarding profiles ship needing setup.
  const profileReady = (p) => !!p && !p.needsSetup;
  const effectiveTarget = resolveActiveGenerationTarget({
    selectedTargetId,
    activeProfileIds: activeProfilesList,
    activeWorkflowIds: activeWorkflowsList,
    profiles: writingProfiles,
    workflows
  });
  const isWorkflowTarget = !!effectiveTarget && displayWorkflows.some(w => w.id === effectiveTarget.id);
  const canSend = !!effectiveTarget && (isWorkflowTarget || profileReady(effectiveTarget));

  const getGenerationTargetId = () => {
    if (!effectiveTarget) {
      showToast('Select an active AI Profile or Workflow before generating.', 'error');
      return null;
    }
    if (!isWorkflowTarget && !profileReady(effectiveTarget)) {
      showToast('This AI Profile is not set up yet. Create an API profile in Settings, then link it to this profile in the Library.', 'error');
      return null;
    }
    return effectiveTarget.id;
  };

  // Archived messages are already out of context, so they are not offered.
  const handleToggleExcluded = async (messageId, excluded) => {
    if (!activeChat || !electronAPI?.setMessagesExcluded) return;
    try {
      const result = await electronAPI.setMessagesExcluded(activeChat.id, [messageId], excluded);
      if (!result?.success) {
        showToast(result?.error || "Could not update this message.", 'error');
        return;
      }
      setActiveMessages(previous => previous.map(item => (
        item.id === messageId ? { ...item, excluded: excluded ? 1 : 0 } : item
      )));
      setHistoryRevision(rev => rev + 1);
      await refreshChats(activeChat.id);
    } catch (e) {
      console.error("Failed to toggle message exclusion:", e);
      showToast("Could not update this message.", 'error');
    }
  };

  // Rows are memoized, so everything they call keeps one identity across renders.
  const saveUserEdit = useStableCallback(async (messageId, text) => {
    const targetId = getGenerationTargetId();
    if (!targetId) return;
    setEditingMessageId(null);
    setEditError(null);
    await handleEditUserMessage(messageId, text, targetId);
  });
  const saveAiEdit = useStableCallback(async (message, text) => {
    setEditingMessageId(null);
    const updatedMsg = { ...message, content: text };
    await electronAPI.saveMessage(updatedMsg);
    setActiveMessages(prev => prev.map(m => m.id === message.id ? updatedMsg : m));
  });
  const regenerate = useStableCallback(messageId => {
    const targetId = getGenerationTargetId();
    if (targetId) handleRegenerateMessage(messageId, targetId);
  });
  const switchAlternative = useStableCallback((messageId, index) => handleSwitchAIAlternative(messageId, index));
  const toggleExcluded = useStableCallback((messageId, excluded) => handleToggleExcluded(messageId, excluded));
  const finishTyping = useStableCallback(() => setLastGeneratedMessageId(null));

  // Moving messages between the Chat and the Roleplay: a menu choice, or a range picked by hand.
  const moveTo = roleplayWorkspaceId === workspaceId && roleplayMode ? (thread === 'chat' ? 'roleplay' : 'chat') : null;
  const [moveSelection, setMoveSelection] = useState(null);
  const [movePlan, setMovePlan] = useState(null);
  const [moveBusy, setMoveBusy] = useState(false);
  const [movedNotice, setMovedNotice] = useState(null);
  useEffect(() => { setMoveSelection(null); setMovePlan(null); }, [activeChat.id, thread]);
  useEffect(() => { setMovedNotice(null); }, [activeChat.id]);

  const openMovePlan = async messageIds => {
    if (!moveTo || !messageIds.length) return;
    const plan = await electronAPI.planThreadMove({ chatId: activeChat.id, messageIds, toThread: moveTo });
    if (!plan?.success) {
      showToast(plan?.error || 'Could not prepare the move.', 'error');
      return;
    }
    if (!plan.moving.length) return;
    setMovePlan({ ...plan, requested: messageIds });
  };
  const requestMove = useStableCallback((messageId, scope) => {
    const index = activeMessages.findIndex(message => message.id === messageId);
    if (index < 0) return;
    if (scope === 'choose') setMoveSelection(new Set([messageId]));
    else openMovePlan(scope === 'after' ? activeMessages.slice(index).map(message => message.id) : [messageId]);
  });
  const countFrom = useStableCallback(messageId => {
    const index = activeMessages.findIndex(message => message.id === messageId);
    return index < 0 ? 1 : activeMessages.length - index;
  });
  const toggleMoveSelection = messageId => setMoveSelection(current => {
    const next = new Set(current);
    if (next.has(messageId)) next.delete(messageId); else next.add(messageId);
    return next;
  });
  const selectEverythingAfter = () => setMoveSelection(current => {
    const first = activeMessages.findIndex(message => current.has(message.id));
    return new Set(activeMessages.slice(Math.max(0, first)).map(message => message.id));
  });

  const confirmMove = async ({ rebuildMixed }) => {
    if (!movePlan) return;
    setMoveBusy(true);
    try {
      const { result, failed } = await moveBetweenThreads(electronAPI, { chatId: activeChat.id, plan: movePlan, rebuildMixed, profileId: firstActiveProfile(activeChat) });
      if (!result?.success) {
        showToast(result?.error || 'Could not move the messages.', 'error');
        return;
      }
      const moved = new Set(movePlan.moving);
      setActiveMessages(previous => previous.filter(message => !moved.has(message.id)));
      forgetThreadCache?.();
      setMovePlan(null);
      setMoveSelection(null);
      setHistoryRevision(revision => revision + 1);
      if (result.takenBack) window.dispatchEvent(new CustomEvent('roleplay-state-change', { detail: { workspaceId: activeChat.id } }));
      if (movePlan.target === 'roleplay') setMovedNotice({ count: result.moved });
      if (failed.length) showToast(rebuildFailureMessage(failed), 'error');
      else showToast(`${result.moved} ${result.moved === 1 ? 'message' : 'messages'} moved to the ${movePlan.target === 'roleplay' ? 'Roleplay' : 'Chat'}.`, 'success');
      await refreshChats(activeChat.id);
    } catch (error) {
      console.error('Failed to move messages:', error);
      showToast('Could not move the messages.', 'error');
    } finally {
      setMoveBusy(false);
    }
  };

  // Moved story has no Narrative State yet; Update entities can read it and suggest changes.
  const runUpdateEntities = async () => {
    setMovedNotice(null);
    try {
      const result = await electronAPI.enrichEntities?.(activeChat.id, { mode: 'update' });
      if (result && result.success === false) showToast(`Update failed: ${result.error || 'unknown error'}`, 'error');
      else showToast('Update entities is reading the story. Its suggestions appear in Worldbuild.', 'info');
    } catch (error) {
      showToast(`Update failed: ${error.message}`, 'error');
    }
  };

  const messageActions = useMemo(() => ({
    copyText,
    startEdit: messageId => setEditingMessageId(messageId),
    cancelEdit: () => setEditingMessageId(null),
    saveUserEdit,
    saveAiEdit,
    regenerate,
    switchAlternative,
    toggleExcluded,
    finishTyping,
    requestDelete: messageId => setConfirmDeleteData({ type: 'delete_msg', messageId }),
    requestRevert: messageId => setConfirmDeleteData({ type: 'revert_chat', messageId }),
    requestArchive: () => setSummarizeModalOpen(true),
    requestMove,
    countFrom
  }), [copyText, saveUserEdit, saveAiEdit, regenerate, switchAlternative, toggleExcluded, finishTyping, requestMove, countFrom]);

  const isCurrentRoleplayMode = roleplayWorkspaceId === workspaceId && roleplayMode;
  // The first time a workspace shows both conversations, a short tip says what each is for.
  const [storyIntroActive, setStoryIntroActive] = useState(false);
  const { tour: runningTour, startTour } = useTour();
  useEffect(() => {
    if (!uiFlagsLoaded || uiFlags.threadsTipSeen || !isCurrentRoleplayMode || !isChatVisible || storyIntroActive || runningTour) return undefined;
    const timer = setTimeout(() => { dismissHint('threadsTipSeen'); startTour('threads'); }, 700);
    return () => clearTimeout(timer);
  }, [uiFlagsLoaded, uiFlags.threadsTipSeen, isCurrentRoleplayMode, isChatVisible, storyIntroActive, runningTour, dismissHint, startTour]);

  // Turning the mode off hides the Roleplay; its messages stay and come back when it is on again.
  useEffect(() => {
    if (roleplayWorkspaceId !== workspaceId || roleplayMode || thread !== 'roleplay') return;
    if (activeSubView === 'roleplay') setActiveSubView('chat');
    else selectThread('chat');
  }, [roleplayWorkspaceId, workspaceId, roleplayMode, thread, activeSubView, setActiveSubView, selectThread]);
  // The narrator's rail, scene art and frames belong to the Roleplay tab alone.
  const isRoleplayVisible = isCurrentRoleplayMode && isChatVisible && thread === 'roleplay';
  const effectiveBackground = isRoleplayVisible && roleplayBackground?.imagePath
    ? roleplayBackground.imagePath
    : activeChat?.backgroundImage;
  const hasBg = Boolean(effectiveBackground && effectiveBackground.trim() !== '');

  const isDocumentMode = settings?.interface?.layout === 'document';
  // Blurring what lies behind a bubble only shows over a background image, and only through
  // a see-through bubble; elsewhere it costs a full-bubble filter on every scroll frame.
  const softBlur = hasBg && (settings?.interface?.blur ?? true);
  const userBubbleOpacity = activeChat?.userBubbleOpacity ?? 100;
  const aiBubbleOpacity = activeChat?.aiBubbleOpacity ?? 0;
  const fontSize = settings?.interface?.fontSize;
  const advanced = settings?.advanced || {};

  const messageView = useMemo(() => {
    const blurStyle = alpha => (softBlur && alpha < 1
      ? { backdropFilter: 'blur(20px) saturate(1.15)', WebkitBackdropFilter: 'blur(20px) saturate(1.15)' }
      : {});
    const userAlpha = bubbleAlpha(userBubbleOpacity);
    const aiAlpha = bubbleAlpha(aiBubbleOpacity);
    // Without art the bubbles sit on the page gradient, so they carry a gradient and a lit top edge too.
    const lit = (top, bottom, alpha) => (hasBg ? {} : {
      backgroundImage: `linear-gradient(180deg, color-mix(in srgb, ${top} ${alpha * 100}%, transparent), color-mix(in srgb, ${bottom} ${alpha * 100}%, transparent))`,
      backgroundColor: 'transparent',
      boxShadow: alpha > 0.5 ? 'inset 0 1px 0 var(--theme-highlight)' : undefined
    });
    return {
      sizeClass: fontSize === 'small' ? 'text-xs' : fontSize === 'large' ? 'text-base' : 'text-sm',
      isDocumentMode,
      softBlur,
      userBubbleStyle: {
        backgroundColor: `color-mix(in srgb, var(--theme-bubble-user) ${userAlpha * 100}%, transparent)`,
        borderColor: 'color-mix(in srgb, var(--theme-tint) 10%, transparent)',
        ...blurStyle(userAlpha),
        ...lit('var(--theme-bubble-user)', 'color-mix(in srgb, var(--theme-bubble-user) 80%, var(--theme-surface-raised-low))', userAlpha),
        ...(isDocumentMode ? { padding: '1.25rem', borderRadius: '0.75rem' } : {})
      },
      aiBubbleStyle: {
        backgroundColor: `color-mix(in srgb, var(--theme-surface-panel) ${aiAlpha * 100}%, transparent)`,
        borderColor: 'var(--theme-border-subtle)',
        ...lit('var(--theme-surface-raised)', 'var(--theme-surface-raised-low)', aiAlpha),
        ...(isDocumentMode ? { padding: '1.25rem', borderRadius: '0.75rem' } : blurStyle(aiAlpha))
      },
      entityNames,
      moveTo,
      flags: {
        tokenDebug: Boolean(advanced.tokenDebug),
        ragDebug: Boolean(advanced.ragDebug),
        agenticDebug: Boolean(advanced.agenticDebug),
        narrativeStateDebug: Boolean(advanced.narrativeStateDebug)
      }
    };
  }, [entityNames, moveTo, fontSize, isDocumentMode, softBlur, hasBg, userBubbleOpacity, aiBubbleOpacity, advanced.tokenDebug, advanced.ragDebug, advanced.agenticDebug, advanced.narrativeStateDebug]);

  const lastUserMessageId = useMemo(() => activeMessages.findLast(m => m.role === 'user')?.id, [activeMessages]);
  const lastAiMessage = useMemo(() => activeMessages.findLast(m => m.role === 'ai'), [activeMessages]);

  // Active context usage bar (optional, shown at the top of the chat)
  const ctxTokens = useMemo(() => selectActiveMessages(archiveMessages, threadMemoryBlocks)
    .reduce((total, message) => total + estimateMessageTokens(message.content), 0), [archiveMessages, threadMemoryBlocks]);

  // Find in chat searches the whole history, not just the rendered page, and paints its
  // matches with CSS highlights so the rendered markdown and dialogue colours stay untouched.
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState('');
  const [findCaseSensitive, setFindCaseSensitive] = useState(false);
  const [findPosition, setFindPosition] = useState({ key: '', index: 0 });
  const [findFocusSignal, setFindFocusSignal] = useState(0);
  const [findLoading, setFindLoading] = useState(false);
  const findScrolledRef = useRef('');
  const loadOlderUntilRef = useRef(loadOlderUntil);
  loadOlderUntilRef.current = loadOlderUntil;
  const findSource = archiveMessages.length ? archiveMessages : activeMessages;
  const findMatches = useMemo(
    () => (findOpen ? findInMessages(findSource.filter(message => message.id !== lastGeneratedMessageId), findQuery, findCaseSensitive) : []),
    [findOpen, findSource, findQuery, findCaseSensitive, lastGeneratedMessageId]
  );
  // A new search starts at the newest match, the one nearest the reader.
  const findKey = `${findCaseSensitive}:${findQuery}`;
  const findCurrent = Math.max(0, findPosition.key === findKey
    ? Math.min(findPosition.index, findMatches.length - 1)
    : findMatches.length - 1);
  const findTarget = findMatches[findCurrent];

  useEffect(() => {
    if (!isChatVisible) return undefined;
    const onKey = event => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey || event.key.toLowerCase() !== 'f') return;
      if (event.target?.closest?.('[role="dialog"], [role="menu"]')) return;
      event.preventDefault();
      setFindOpen(true);
      setFindFocusSignal(value => value + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isChatVisible]);

  const closeFind = () => {
    setFindOpen(false);
    findScrolledRef.current = '';
    messageContainerRef.current?.parentElement?.querySelector('.ws-composer textarea')?.focus();
  };

  const stepFind = direction => {
    if (!findMatches.length) return;
    findScrolledRef.current = '';
    setFindPosition({ key: findKey, index: (findCurrent + direction + findMatches.length) % findMatches.length });
  };

  useEffect(() => {
    const highlights = typeof CSS !== 'undefined' ? CSS.highlights : null;
    const container = messageContentRef.current;
    if (!highlights || !container) return undefined;
    if (!findOpen || !findQuery || !isChatVisible) {
      highlights.delete('chat-find');
      highlights.delete('chat-find-current');
      return undefined;
    }
    const all = [];
    let current = null;
    container.querySelectorAll('[data-chat-message-id]').forEach(row => {
      const id = row.dataset.chatMessageId;
      if (id === lastGeneratedMessageId) return;
      const ranges = [...row.querySelectorAll('.markdown-content')].flatMap(element => rangesIn(element, findQuery, findCaseSensitive));
      all.push(...ranges);
      if (findTarget?.messageId === id) current = ranges[findTarget.occurrence] || null;
    });
    highlights.set('chat-find', new Highlight(...all));
    if (current) highlights.set('chat-find-current', new Highlight(current));
    else highlights.delete('chat-find-current');

    const key = findTarget ? `${findTarget.messageId}:${findTarget.occurrence}` : '';
    if (!findTarget || findScrolledRef.current === key) return undefined;
    const row = [...container.querySelectorAll('[data-chat-message-id]')].find(element => element.dataset.chatMessageId === findTarget.messageId);
    if (!row) {
      if (findLoading || findScrolledRef.current === `loading:${key}`) return undefined;
      findScrolledRef.current = `loading:${key}`;
      isFollowingLatestRef.current = false;
      setIsFollowingLatest(false);
      setFindLoading(true);
      loadOlderUntilRef.current(findTarget.messageId).finally(() => setFindLoading(false));
      return undefined;
    }
    findScrolledRef.current = key;
    isFollowingLatestRef.current = false;
    setIsFollowingLatest(false);
    container.querySelectorAll('[data-find-current]').forEach(element => element.removeAttribute('data-find-current'));
    row.setAttribute('data-find-current', '');
    // Rows that skipped rendering only take their real height once shown, so centre twice.
    const centre = () => {
      const scroller = messageContainerRef.current;
      const rect = (current || row).getBoundingClientRect();
      const box = scroller.getBoundingClientRect();
      scroller.scrollTop += (rect.top + rect.bottom) / 2 - (box.top + box.height / 2);
    };
    centre();
    const frame = requestAnimationFrame(() => requestAnimationFrame(centre));
    return () => cancelAnimationFrame(frame);
  }, [findOpen, findQuery, findCaseSensitive, findTarget, activeMessages, isChatVisible, lastGeneratedMessageId, findLoading]);

  useEffect(() => () => {
    CSS.highlights?.delete('chat-find');
    CSS.highlights?.delete('chat-find-current');
  }, []);

  if (!activeChat) return null;

  const handleSend = (inputValue) => {
    const finalTargetId = getGenerationTargetId();
    const submission = prepareGenerationSubmission({
      inputValue,
      pendingFiles,
      targetId: finalTargetId
    });
    if (!submission) return false;

    followLatestResponse();
    handleSendMessage(submission.content, submission.targetId, submission.attachedFiles);
    setPendingFiles([]);
    return true;
  };

  const handleExecuteSummarization = async ({ messageIds, excludedMessageIds, customTitle }) => {
    if (messageIds.length === 0 && excludedMessageIds.length === 0) {
      showToast("Pick at least one message to archive or drop.", 'info');
      return;
    }

    setIsVectorizing(true);
    setSummarizeProgress(null);
    try {
      let activeProfileId = '';
      try {
        const parsed = safeParseJson(activeChat.activeProfiles);
        if (parsed.length > 0) activeProfileId = parsed[0];
      } catch (err) { }

      const result = await electronAPI.executeSummarization({
        chatId: activeChat.id,
        thread,
        messageIds,
        excludedMessageIds,
        customTitle,
        profileId: activeProfileId
      });

      if (result && result.success) {
        // History is stored; recap and tags finish in the background.
        await refreshChats(activeChat.id);
        setHistoryRevision(rev => rev + 1);
        dismissedAutoSummarizeChatsRef.current.delete(autoSummarizeKey);
        setSummarizeModalOpen(false);
        if (result.blockId) finalizeSummaryBlock(activeChat.id, result.blockId);
      } else {
        showToast(result?.message || "Failed to execute summarization.", 'error');
      }
    } catch (err) {
      console.error("Execute summarization error:", err);
      showToast("An error occurred during summarization.", 'error');
    } finally {
      setIsVectorizing(false);
      setSummarizeProgress(null);
    }
  };

  // Not awaited: nothing here can lose data. Also retries failed or interrupted summaries.
  const finalizeSummaryBlock = async (chatId, blockId) => {
    if (!electronAPI?.finalizeSummaryBlock) return;
    setFinishingBlockId(blockId);
    try {
      const result = await electronAPI.finalizeSummaryBlock(chatId, blockId);
      await refreshChats(chatId);
      // Recap and tags fail independently; Context & Memory shows what is missing, so point there once.
      if (result?.taggingStatus === 'failed' || result?.recapStatus === 'failed') {
        const missing = result.taggingStatus === 'failed' && result.recapStatus === 'failed'
          ? 'its recap and entity tags'
          : result.recapStatus === 'failed' ? 'its recap' : 'its entity tags';
        showToast(`History archived. Kallamo could not finish ${missing}: open Context & Memory to run it again.`, 'error');
      }
    } catch (err) {
      console.error("Finalize summary error:", err);
      showToast("The archive was saved, but its recap and tags could not be finished.", 'error');
    } finally {
      setFinishingBlockId(null);
      setSummarizeProgress(null);
    }
  };

  // Moving a Roleplay panel block is a drag too; only files are this view's to take.
  const isLayoutDrag = e => Array.from(e.dataTransfer?.types || []).includes(BLOCK_DRAG_TYPE);
  const handleDragEnter = (e) => {
    if (isLayoutDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const types = e.dataTransfer.types;
    const hasFiles = types && (types.includes('Files') || Array.from(types).includes('Files'));
    if (hasFiles) {
      dragCounter.current++;
      if (e.dataTransfer.items && e.dataTransfer.items.length > 0) {
        setIsDragging(true);
      }
    }
  };

  const handleDragOver = (e) => {
    if (isLayoutDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const types = e.dataTransfer.types;
    const hasFiles = types && (types.includes('Files') || Array.from(types).includes('Files'));
    if (!hasFiles) {
      e.dataTransfer.dropEffect = 'none';
    } else {
      e.dataTransfer.dropEffect = 'copy';
    }
  };

  const handleDragLeave = (e) => {
    if (isLayoutDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    const types = e.dataTransfer.types;
    const hasFiles = types && (types.includes('Files') || Array.from(types).includes('Files'));
    if (hasFiles) {
      dragCounter.current--;
      if (dragCounter.current === 0) {
        setIsDragging(false);
      }
    }
  };

  const handleDrop = (e) => {
    if (isLayoutDrag(e)) return;
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    dragCounter.current = 0;

    const types = e.dataTransfer.types;
    const hasFiles = types && (types.includes('Files') || Array.from(types).includes('Files'));

    if (hasFiles && e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      const files = Array.from(e.dataTransfer.files);
      const updated = [...pendingFiles];
      files.forEach(f => {
        if (!updated.some(existing => existing.name === f.name)) {
          updated.push({
            name: f.name,
            path: f.path || '',
            size: f.size
          });
        }
      });
      setPendingFiles(updated);
    }
  };

  const handleFileAttachment = (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    const updated = [...pendingFiles];
    files.forEach(f => {
      if (!updated.some(existing => existing.name === f.name)) {
        updated.push({
          name: f.name,
          path: f.path || '',
          size: f.size
        });
      }
    });
    setPendingFiles(updated);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removePendingFile = (name) => {
    setPendingFiles(prev => prev.filter(f => f.name !== name));
  };

  const handleRevertChat = async (messageId) => {
    try {
      await electronAPI.revertChatToMessage(activeChat.id, messageId);
      await refreshChats(activeChat.id);
    } catch (e) {
      console.error("Failed to revert chat:", e);
    }
  };

  const handleContainerClick = (e) => {
    const btn = e.target.closest('.btn-copy-code');
    if (btn) {
      const codeId = btn.getAttribute('data-code-id');
      const codeElement = document.getElementById(codeId);
      if (codeElement) {
        copyText(codeElement.innerText).then(() => {
          const textSpan = btn.querySelector('.copy-text');
          const oldText = textSpan.innerText;
          textSpan.innerText = 'Copied!';
          btn.classList.add('text-green-400');
          setTimeout(() => {
            textSpan.innerText = oldText;
            btn.classList.remove('text-green-400');
          }, 2000);
        });
      }
    }
  };

  // Only the chat's veil is configurable; Memory keeps a fixed one so its glass reads the same everywhere.
  const backdropStyle = {
    backgroundColor: 'var(--theme-surface-canvas)',
    opacity: (activeSubView === 'memory' ? 75 : (activeChat.backdropOpacity ?? 75)) / 100
  };

  const bgStyle = hasBg ? {
    backgroundImage: `url("app-file:///${effectiveBackground.replace(/\\/g, '/')}")`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat'
  } : {};

  const ctxThreshold = threadState.archiveThreshold || 60000;

  const generatingColor = writingProfiles.find(profile => profile.name === generationProgress?.profileName)?.color;
  // The player's name for "You as …": the frame after each message records who was played,
  // and the latest frame stands in for a message that has no reply yet.
  const latestPlayerName = (() => {
    for (let index = activeMessages.length - 1; index >= 0; index -= 1) {
      const frame = roleplayFrames[activeMessages[index].id] || heldRoleplayFrames[activeMessages[index].id];
      if (frame?.end?.playerName) return frame.end.playerName;
    }
    return null;
  })();
  const playerNameAt = index => {
    if (!isCurrentRoleplayMode || thread !== 'roleplay') return undefined;
    const next = activeMessages[index + 1];
    const frame = next && next.role !== 'user' ? (roleplayFrames[next.id] || heldRoleplayFrames[next.id]) : null;
    return frame?.start?.playerName || roleplayPlayerName || latestPlayerName || undefined;
  };

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={`ws-page flex w-full h-full relative overflow-hidden bg-surface-canvas ${hasBg ? 'has-backdrop' : ''}`}
    >
      {hasBg && <div style={bgStyle} className="absolute inset-0 z-0" />}
      {hasBg && <div style={backdropStyle} className="absolute inset-0 z-0" />}
      {roleplayMode && <StoryIntro workspaceId={activeChat.id} visible={isRoleplayVisible} onActiveChange={setStoryIntroActive} />}

      <div className="flex-1 flex flex-col h-full relative z-10 overflow-hidden">
        {isDragging && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-shade/70 border-2 border-dashed border-accent/40 m-4 rounded-xl pointer-events-none animate-in fade-in duration-200">
            <div className="flex flex-col items-center space-y-4">
              <Paperclip className="w-12 h-12 text-accent animate-bounce" />
              <span className="text-sm font-bold text-text-primary tracking-wide">Drop files here to attach to chat</span>
            </div>
          </div>
        )}

        {/* The header band runs up under the window bar, so no raw background shows above it. */}
        <div className={`ws-head flex items-center justify-between h-24 pt-10 border-b border-gray-800/80 px-6 shrink-0 bg-surface-canvas/80 z-10 relative ${(settings?.interface?.blur ?? true) ? 'backdrop-blur-md' : ''}`}>
          <div className="flex items-center space-x-3 min-w-0 mr-4 flex-1">
            <button
              onClick={() => setCurrentView('dashboard')}
              className="p-1.5 text-gray-400 hover:text-text-primary hover:bg-tint/10 rounded-md transition-colors mr-2 cursor-pointer shrink-0"
            >
              <ArrowLeft className="w-4.5 h-4.5" />
            </button>
            <WorkspaceTitle title={activeChat.title} />
          </div>

          <nav aria-label="Workspace areas" data-tour="workspace-tabs" className="ws-well flex min-w-0 items-center gap-0.5 rounded-lg border border-border-subtle bg-surface-input/80 p-1 select-none z-10">
            {[
              ['chat', 'Chat', WorkspaceGlyph],
              ...(isCurrentRoleplayMode ? [['roleplay', 'Roleplay', Drama]] : []),
              ['writing', 'Writing', WritingGlyph],
              ['worldbuild', 'Worldbuild', WorldbuildGlyph],
              ['memory', 'Memory', MemoryGlyph],
              ['files', 'Files', Folder],
            ].map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                data-tour={id === 'roleplay' ? 'workspace-roleplay-tab' : undefined}
                onClick={() => setActiveSubView(id)}
                onMouseEnter={() => workspaceTabViews[id]?.preload()}
                aria-current={activeSubView === id ? 'page' : undefined}
                className={`group inline-flex h-8 shrink-0 items-center overflow-hidden rounded-md text-xs font-semibold transition-[max-width,padding,background-color,color,box-shadow] duration-300 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${activeSubView === id
                  ? 'max-w-36 bg-accent px-3 text-on-accent shadow-sm'
                  : 'max-w-8 px-2 text-text-muted hover:max-w-36 hover:bg-tint/5 hover:px-3 hover:text-text-primary'
                  }`}
              >
                <Icon className="h-4 w-4 shrink-0" />
                <span className={`whitespace-nowrap transition-[max-width,margin,opacity] duration-300 ease-out ${activeSubView === id
                  ? 'ml-1.5 max-w-24 opacity-100'
                  : 'ml-0 max-w-0 opacity-0 group-hover:ml-1.5 group-hover:max-w-24 group-hover:opacity-100'
                  }`}>{label}</span>
              </button>
            ))}
          </nav>

          <div className="flex-1 flex justify-end items-center gap-1 ml-4">
            <button
              onClick={() => setActiveSubView('configuration')}
              onMouseEnter={() => workspaceTabViews.configuration.preload()}
              className={`inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${activeSubView === 'configuration'
                ? 'text-accent bg-accent/10'
                : 'text-text-muted hover:text-text-primary hover:bg-tint/5'
                }`}
            >
              <SlidersHorizontal className="h-4 w-4" />
              <span>Configuration</span>
            </button>
          </div>
        </div>

        {/* The chat stays mounted and laid out under another tab, so returning to it needs no
            layout of the whole thread. The other tabs mount on demand over it. */}
        <div className="relative flex min-h-0 flex-1 flex-col">
        <div inert={!isChatVisible || undefined} className={`flex flex-1 min-h-0 flex-col relative overflow-hidden ${isChatVisible ? '' : 'chat-parked'}`}>
          <div
            ref={messageContainerRef}
            onClick={handleContainerClick}
            onScroll={updateFollowingLatest}
            className={`chat-thread flex-1 overflow-y-auto px-6 pt-6 pb-40 custom-scrollbar ${presentationReady ? '' : 'invisible'}`}
          >
            <div ref={messageContentRef} className="mx-auto w-full max-w-[55rem] space-y-7">
              {hasOlderMessages && (
                <div className="flex flex-wrap items-center justify-center gap-2">
                  <button
                    type="button"
                    onClick={handleLoadOlderMessages}
                    disabled={isLoadingOlderMessages}
                    className="h-8 rounded-control border border-border-default bg-surface-panel/80 px-3 text-xs font-semibold text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-wait disabled:opacity-60"
                  >
                    {isLoadingOlderMessages ? 'Loading history…' : 'Show 50 earlier messages'}
                  </button>
                  <button
                    type="button"
                    onClick={handleJumpToStart}
                    disabled={isLoadingOlderMessages}
                    className="h-8 rounded-control border border-border-default bg-surface-panel/80 px-3 text-xs font-semibold text-text-secondary transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 disabled:cursor-wait disabled:opacity-60"
                  >
                    Go to start
                  </button>
                </div>
              )}
              {thread === 'chat' && isCurrentRoleplayMode && !activeMessages.length && !isGenerating && (
                <div className="flex min-h-[40vh] flex-col items-center justify-center px-6 text-center select-none">
                  {/* The same backing as the message hints keeps it legible over a background. */}
                  <div className="chat-hint flex flex-col items-center gap-2.5 rounded-card px-5 py-4">
                    <span className="flex h-11 w-11 items-center justify-center rounded-control bg-tint/5"><WorkspaceGlyph aria-hidden="true" className="h-5 w-5 text-text-muted" /></span>
                    <span className="text-[0.9375rem] font-semibold text-text-primary">Talk with the AI outside the story</span>
                    <span className="max-w-sm text-sm leading-relaxed text-text-secondary">Plan a scene, check the world or ask for a recap. Nothing said here enters the Roleplay.</span>
                  </div>
                </div>
              )}
              {thread === 'chat' && !isCurrentRoleplayMode && activeChat.roleplayMessageCount > 0 && (
                <p className="chat-hint mx-auto flex w-fit max-w-full items-center gap-2 rounded-lg px-3 py-1.5 text-sm text-text-secondary select-none">
                  <Drama aria-hidden="true" className="h-4 w-4 shrink-0 text-text-muted" />
                  {ROLEPLAY_KEPT_LINE(activeChat.roleplayMessageCount)}
                </p>
              )}
              {activeMessages.map((msg, index) => moveSelection ? (
                <div key={msg.id} className="flex items-start gap-3.5">
                  <span className="mt-1.5 shrink-0">
                    <Checkbox size="sm" checked={moveSelection.has(msg.id)} onChange={() => toggleMoveSelection(msg.id)} ariaLabel="Select message" />
                  </span>
                  <div className={`min-w-0 flex-1 rounded-surface transition-shadow ${moveSelection.has(msg.id) ? 'ring-2 ring-accent/45' : ''}`}>
                    <ChatMessageItem
                      message={msg}
                      isEditing={false}
                      isLastUser={false}
                      isLastAi={false}
                      isTyping={false}
                      frame={msg.role === 'user' ? undefined : (roleplayFrames[msg.id] || heldRoleplayFrames[msg.id])}
                      playerName={msg.role === 'user' ? playerNameAt(index) : undefined}
                      view={messageView}
                      actions={messageActions}
                    />
                  </div>
                </div>
              ) : (
                <ChatMessageItem
                  key={msg.id}
                  deferRender={index < activeMessages.length - ALWAYS_RENDERED_ROWS}
                  message={msg}
                  isEditing={editingMessageId === msg.id}
                  isLastUser={msg.id === lastUserMessageId}
                  isLastAi={msg.id === lastAiMessage?.id}
                  isTyping={msg.id === lastGeneratedMessageId}
                  frame={msg.role === 'user' ? undefined : (roleplayFrames[msg.id] || heldRoleplayFrames[msg.id])}
                  playerName={msg.role === 'user' ? playerNameAt(index) : undefined}
                  view={messageView}
                  actions={messageActions}
                />
              ))}

              {isGenerating && generationProgress && (generationProgress.thread || thread) === thread && (
                <GenerationBubble
                  progress={generationProgress}
                  color={generatingColor}
                  style={messageView.aiBubbleStyle}
                  sizeClass={messageView.sizeClass}
                  onTextChange={pinToLatestIfFollowing}
                />
              )}
            </div>
          </div>

          {findOpen && (
            <div className="pointer-events-none absolute left-0 right-2 top-3 z-30 px-6">
              <div className="mx-auto flex w-full max-w-[55rem] justify-end">
                <div className="pointer-events-auto max-w-full">
                  <ChatFind
                    query={findQuery}
                    onQueryChange={setFindQuery}
                    caseSensitive={findCaseSensitive}
                    onCaseSensitiveChange={setFindCaseSensitive}
                    current={findCurrent}
                    total={findMatches.length}
                    busy={findLoading}
                    onStep={stepFind}
                    onClose={closeFind}
                    focusSignal={findFocusSignal}
                  />
                </div>
              </div>
            </div>
          )}

          {hasCompletedResponseBelow && !isFollowingLatest && (
            <button
              type="button"
              onClick={scrollToLatest}
              className="absolute right-6 bottom-36 z-20 inline-flex h-9 items-center gap-2 rounded-full border border-accent/40 bg-surface-panel px-3.5 text-xs font-semibold text-accent shadow-overlay transition-colors hover:bg-accent hover:text-on-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <ArrowDown aria-hidden="true" className="h-3.5 w-3.5" />
              New reply below
            </button>
          )}

          {/* The veil lets the thread fade under the composer without hiding the background. */}
          {/* Both overlays stop short of the scrollbar column, so the thumb stays visible and draggable to the end. */}
          <div aria-hidden="true" className={`pointer-events-none absolute left-0 right-2 bottom-0 h-32 bg-gradient-to-b from-transparent ${hasBg ? 'to-surface-canvas/80' : 'to-[var(--theme-surface-canvas-deep)]'} to-70%`} />

          <div className="absolute left-0 right-2 bottom-0 z-20 px-6 pb-5">
            <div className="mx-auto w-full max-w-[55rem]">
              {pendingFiles.length > 0 && (
                <div className="flex w-full flex-wrap gap-3 px-1 pb-3 select-none animate-in fade-in slide-in-from-bottom-2 duration-200">
                  {pendingFiles.map(file => {
                    const fileUrl = file.path ? `app-file:///${encodeURI(file.path.replace(/\\/g, '/'))}` : '';
                    const hasThumbnail = isImage(file.name) || isVideo(file.name);
                    return (
                      <div key={file.name} className="relative flex items-center gap-2.5 rounded-xl border border-border-subtle bg-surface-panel/95 p-2 pr-4 text-xs text-text-secondary shadow-panel">
                        {isImage(file.name) && <img src={fileUrl} alt="" className="h-10 w-10 shrink-0 rounded-lg border border-border-subtle object-cover" />}
                        {isVideo(file.name) && <video src={fileUrl} className="h-10 w-10 shrink-0 rounded-lg border border-border-subtle object-cover" muted />}
                        {!hasThumbnail && (
                          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-surface-input text-text-subtle">
                            <Paperclip aria-hidden="true" className="h-4 w-4" />
                          </div>
                        )}
                        <div className="flex min-w-0 max-w-[8rem] flex-col">
                          <span className="truncate font-semibold text-text-primary" title={file.name}>{file.name}</span>
                          <span className="font-mono text-text-subtle">{(file.size / 1024).toFixed(0)} KB</span>
                        </div>
                        <button
                          type="button"
                          aria-label={`Remove ${file.name}`}
                          onClick={() => removePendingFile(file.name)}
                          className="absolute -right-1.5 -top-1.5 rounded-full bg-danger-solid p-0.5 text-on-danger shadow-md transition-colors hover:bg-danger-solid-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 cursor-pointer"
                        >
                          <X aria-hidden="true" className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}

              {moveSelection && (
                <div className="mx-auto flex w-fit max-w-full flex-wrap items-center justify-center gap-3 rounded-card border border-border-default bg-surface-panel/95 py-2 pl-4 pr-2 shadow-overlay backdrop-blur-md animate-in slide-in-from-bottom duration-200">
                  <span className="text-sm font-semibold tabular-nums text-text-primary">{moveSelection.size} selected</span>
                  <span className="h-4 w-px bg-border-default" aria-hidden="true" />
                  <button type="button" onClick={selectEverythingAfter} className="rounded px-1 text-sm text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">Everything after</button>
                  <button type="button" onClick={() => setMoveSelection(new Set())} className="rounded px-1 text-sm text-text-secondary hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">Clear</button>
                  <Button variant="ghost" size="sm" onClick={() => setMoveSelection(null)}>Cancel</Button>
                  <Button size="sm" icon={moveTo === 'roleplay' ? Drama : WorkspaceGlyph} disabled={!moveSelection.size} onClick={() => openMovePlan(activeMessages.filter(message => moveSelection.has(message.id)).map(message => message.id))}>
                    Move to {moveTo === 'roleplay' ? 'Roleplay' : 'Chat'}
                  </Button>
                </div>
              )}
              {/* Sits over the composer, where the person is when the move lands, in either conversation. */}
              {movedNotice && !moveSelection && (
                <div role="status" className="mb-3 overflow-hidden rounded-card bg-surface-panel/95 shadow-overlay backdrop-blur-md animate-rise-in">
                  <div className="flex items-center gap-3 rounded-card border border-status-info/30 bg-status-info/[0.08] py-3 pl-4 pr-3">
                    <Drama aria-hidden="true" className="h-4 w-4 shrink-0 text-status-info" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-semibold text-text-primary">{movedNotice.count} {movedNotice.count === 1 ? 'message' : 'messages'} moved to the Roleplay</span>
                      <span className="mt-0.5 block text-xs leading-relaxed text-text-muted">They are story now, but sheets and Narrative State don't know them yet. Update entities can read them and suggest changes.</span>
                    </span>
                    <button
                      type="button"
                      onClick={runUpdateEntities}
                      className="inline-flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-control border border-status-info/45 bg-status-info/15 px-2.5 text-xs font-semibold text-text-primary transition-colors hover:bg-status-info/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                    >
                      <RefreshCw aria-hidden="true" className="h-3.5 w-3.5 text-status-info" />
                      Update entities
                    </button>
                    <IconButton icon={X} label="Dismiss" size="sm" onClick={() => setMovedNotice(null)} />
                  </div>
                </div>
              )}
              <div className={`ws-composer glass-panel glass-dense rounded-[1.125rem] border border-border-default py-2.5 pl-4 pr-2.5 shadow-overlay transition-colors focus-within:border-accent/50 ${moveSelection ? 'hidden' : ''}`}>
                <input
                  type="file"
                  multiple
                  ref={fileInputRef}
                  onChange={handleFileAttachment}
                  className="hidden"
                />
                <ChatInput
                  key={activeChat.id}
                  canSend={canSend}
                  hasTargets={displayProfiles.length > 0 || displayWorkflows.length > 0}
                  isGenerating={isGenerating}
                  onCancel={handleCancelGeneration}
                  onSend={handleSend}
                  pendingFileCount={pendingFiles.length}
                  placeholder={activeMessages.length > 0 ? 'Write a message…' : 'Write a message or drop files here…'}
                  workspaceId={activeChat.id}
                  leading={(
                    <>
                      <IconButton icon={Paperclip} label="Attach files" size="sm" onClick={() => fileInputRef.current?.click()} />
                      {thread === 'chat' && isCurrentRoleplayMode && (
                        <RoleplayHistoryChip
                          enabled={activeChat.chatReadsRoleplay !== 0}
                          share={activeChat.chatRoleplayShare || 30}
                          onToggle={checked => handleSaveChat({ ...activeChat, chatReadsRoleplay: checked ? 1 : 0 })}
                          onOpenSettings={() => {
                            setActiveSubView('configuration');
                            openConfigurationSection('context');
                          }}
                        />
                      )}
                      {activeChat.showContextBar === 1 && <ContextMeter tokens={ctxTokens} threshold={ctxThreshold} />}
                    </>
                  )}
                  trailing={(
                    <ReplyTargetPicker
                      profiles={displayProfiles}
                      workflows={displayWorkflows}
                      selectedId={selectedTarget?.id}
                      onSelect={id => {
                        setSelectedTargetId(id);
                        chosenTargetsRef.current.set(autoSummarizeKey, id);
                        electronAPI.setChatLastTarget(activeChat.id, id, thread);
                      }}
                      onManage={() => setActiveSubView('configuration')}
                    />
                  )}
                />
              </div>
            </div>
          </div>
        </div>

        {!isChatVisible && (
          <div className="absolute inset-0 z-10 flex flex-col">
          <Suspense fallback={<div className="flex-1" />}>
            {activeSubView === 'memory' ? (
              <ChatMemoryView
                chat={activeChat}
                electronAPI={electronAPI}
                backgroundImage={hasBg ? effectiveBackground : null}
                hasBackdrop={hasBg}
              />
            ) : activeSubView === 'writing' ? (
              <WritingDeskView
                chat={activeChat}
                electronAPI={electronAPI}
                onOpenEntity={openEntityInWorldbuild}
              />
            ) : activeSubView === 'worldbuild' ? (
              <WorldbuildView
                chat={activeChat}
                electronAPI={electronAPI}
                focusEntityId={worldbuildFocusId}
                onFocusHandled={() => setWorldbuildFocusId(null)}
                focusSurface={worldbuildSurface}
                onSurfaceHandled={() => setWorldbuildSurface(null)}
              />
            ) : activeSubView === 'configuration' ? (
              <ConfigurationView
                onTriggerSummarize={target => {
                  // Summarizing from Configuration archives the conversation chosen there.
                  const next = target === 'roleplay' ? 'roleplay' : 'chat';
                  if (next !== thread) selectThread(next);
                  dismissedAutoSummarizeChatsRef.current.delete(`${activeChat.id}:${next}`);
                  setSummarizeModalOpen(true);
                }}
              />
            ) : (
              <ChatFilesView
                chat={activeChat}
                messages={activeMessages}
                onSaveChat={handleSaveChat}
                onReinject={handleReinjectFile}
                onPreviewFile={setPreviewFile}
                electronAPI={electronAPI}
              />
            )}
          </Suspense>
          </div>
        )}
        </div>

      </div>

      {isCurrentRoleplayMode && (
        <div className={isRoleplayVisible ? 'contents' : 'hidden'}>
          <RoleplayQuickPanel
            key={activeChat.id}
            workspaceId={activeChat.id}
            api={electronAPI}
            showToast={showToast}
            initialCollapsed={roleplayPanelCollapsed}
            visible={isRoleplayVisible}
            narrativeStateProcessing={backgroundNarrativeIds.has(activeChat.id) || (isGenerating && generationProgress?.chatId === activeChat.id && generationProgress?.phase === 'narrative-state')}
            onBackgroundChange={handleRoleplayBackgroundChange}
            onCollapsedChange={handleRoleplayPanelCollapsedChange}
            onPlayerChange={setRoleplayPlayerName}
            onNamesChange={setEntityNames}
            onOpenConfiguration={openRoleplayConfiguration}
          />
        </div>
      )}

      {/* Floating Error modal for failed message edit */}
      {editError && (
        <div className="absolute bottom-28 right-6 w-80 bg-surface-danger border border-status-danger/30 rounded-xl p-4 shadow-[0_0_20px_color-mix(in_srgb,var(--theme-shade)_60%,transparent)] z-50 animate-in fade-in slide-in-from-bottom-5 duration-300 flex flex-col space-y-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center space-x-2 text-status-danger">
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="text-sm font-semibold">Request failed</span>
            </div>
            <button
              onClick={() => setEditError(null)}
              className="text-gray-500 hover:text-text-primary transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <p className="text-xs text-gray-300 leading-relaxed">
            The generation for your edited message failed: {editError.errorMessage}
          </p>

          <div className="flex items-center justify-end space-x-2 pt-1 select-none">
            <button
              onClick={() => setEditError(null)}
              className="px-2.5 py-1 text-[0.625rem] font-bold uppercase text-gray-400 hover:text-text-primary cursor-pointer transition-colors"
            >
              Dismiss
            </button>
            <button
              onClick={async () => {
                const { msgId, editedText } = editError;
                const targetId = getGenerationTargetId();
                if (!targetId) return;
                setEditError(null);
                await handleEditUserMessage(msgId, editedText, targetId);
              }}
              className="px-3 py-1 bg-danger-solid hover:bg-danger-solid-hover text-on-danger rounded text-[0.625rem] font-bold uppercase hover:scale-[1.02] active:scale-95 transition-[background-color,transform] cursor-pointer"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      <SummarizeModal
        isOpen={summarizeModalOpen}
        onClose={() => {
          dismissedAutoSummarizeChatsRef.current.add(autoSummarizeKey);
          setSummarizeModalOpen(false);
        }}
        chatId={activeChat.id}
        thread={thread}
        workspaceName={thread === 'roleplay' ? `${activeChat.title} · Roleplay` : activeChat.title}
        electronAPI={electronAPI}
        nextSummaryNumber={nextSummaryNumber}
        onConfirm={handleExecuteSummarization}
        isVectorizing={isVectorizing}
        progress={summarizeProgress}
      />

      {movePlan && (
        <ThreadMoveDialog chatId={activeChat.id} plan={movePlan} busy={moveBusy} onConfirm={confirmMove} onClose={() => setMovePlan(null)} />
      )}

      <FilePreviewModal
        file={previewFile}
        onClose={() => setPreviewFile(null)}
      />

      {confirmDeleteData && (() => {
        const isDeleteMsg = confirmDeleteData.type === 'delete_msg';
        const msgId = confirmDeleteData.messageId;
        const msgObj = activeMessages.find(m => m.id === msgId);

        let hasAttachments = false;
        if (isDeleteMsg && msgObj && msgObj.attachedFiles) {
          try {
            const files = typeof msgObj.attachedFiles === 'string'
              ? JSON.parse(msgObj.attachedFiles)
              : msgObj.attachedFiles;
            hasAttachments = Array.isArray(files) && files.length > 0;
          } catch (e) {}
        }

        const close = () => setConfirmDeleteData(null);
        const confirm = async () => {
          close();
          if (isDeleteMsg) {
            await electronAPI.deleteMessage(msgId, deleteAttachedFiles);
            await refreshChats(activeChat.id);
          } else {
            await handleRevertChat(msgId);
          }
        };
        return (
          <ConfirmDialog
            tone="danger"
            icon={isDeleteMsg ? Trash2 : History}
            title={isDeleteMsg ? 'Delete message' : 'Revert chat to this message'}
            message={(
              <div className="space-y-3">
                <p>{isDeleteMsg
                  ? 'This message is removed for good. This cannot be undone.'
                  : 'Every message after this one is deleted for good. This cannot be undone.'}</p>
                {isDeleteMsg && hasAttachments && (
                  <div className="rounded-card border border-border-subtle bg-surface-input/60 px-3 py-2.5 text-text-secondary">
                    <Checkbox
                      size="sm"
                      checked={deleteAttachedFiles}
                      onChange={setDeleteAttachedFiles}
                      label="Also delete attached files from memory"
                    />
                  </div>
                )}
              </div>
            )}
            actions={[
              { label: 'Cancel', variant: 'ghost', onClick: close },
              { label: isDeleteMsg ? 'Delete' : 'Revert', variant: 'danger', onClick: confirm, autoFocus: true }
            ]}
            onClose={close}
          />
        );
      })()}

    </div>
  );
}
