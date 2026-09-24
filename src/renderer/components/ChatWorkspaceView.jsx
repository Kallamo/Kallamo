import { Suspense, useCallback, useState, useEffect, useLayoutEffect, useMemo, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { ArrowDown, ArrowLeft, Paperclip, Workflow, X, ChevronDown, Plus, Folder, AlertTriangle, SlidersHorizontal } from 'lucide-react';
import { WorkspaceGlyph, WritingGlyph, WorldbuildGlyph, MemoryGlyph, AiGlyph } from './ui/glyphs';
import SummarizeModal from './modals/SummarizeModal';
import { selectActiveMessages, selectArchivableMessages } from '../features/chat/archive-coverage';
import FilePreviewModal from './modals/FilePreviewModal';
import DeleteModal from './modals/DeleteModal';
import Popover from './ui/Popover';
import ChatInput from '../features/chat/components/ChatInput';
import ChatMessageItem, { isImage, isVideo } from '../features/chat/components/ChatMessageItem';
import GenerationBubble from '../features/chat/components/GenerationBubble';
import RoleplayQuickPanel from '../features/roleplay/RoleplayQuickPanel';
import { prepareGenerationSubmission, resolveActiveGenerationTarget } from '../features/chat/generation-target';
import { holdDeferredFrames, safeParseDebugNotice, safeParseJson } from '../features/chat/diagnostic-format';
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

// Within this distance of the end the reader counts as following the conversation.
const FOLLOW_LATEST_THRESHOLD_PX = 96;
// The newest rows always render in full: the view opens on them, so their real heights
// must be known when the scroll position is set. Older rows may skip offscreen rendering.
const ALWAYS_RENDERED_ROWS = 10;

const bubbleAlpha = opacity => opacity / 100;

export default function ChatWorkspaceView() {
  const {
    activeChat,
    activeMessages,
    hasOlderMessages,
    isLoadingOlderMessages,
    loadOlderChatMessages,
    jumpToChatStart,
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
    showToast
  } = useApp();

  const workspaceId = activeChat?.id;
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  // Seeded from the preload done while opening, so the first paint has the final layout.
  const [initialPresentation] = useState(() => getCachedPresentation(workspaceId));
  const [roleplayMode, setRoleplayMode] = useState(() => initialPresentation?.mode ?? false);
  const [roleplayPanelCollapsed, setRoleplayPanelCollapsed] = useState(() => initialPresentation?.collapsed ?? false);
  const [roleplayWorkspaceId, setRoleplayWorkspaceId] = useState(() => (initialPresentation ? workspaceId : null));
  const [roleplayBackground, setRoleplayBackground] = useState(() => getCachedBackground(workspaceId) || null);
  const roleplayBackgroundRequestRef = useRef(0);
  const [initialFrames] = useState(() => getPreloadedFrames(workspaceId));
  const [roleplayFrames, setRoleplayFrames] = useState(() => initialFrames?.frames || {});
  const [roleplayFrameRevision, setRoleplayFrameRevision] = useState(0);
  const [selectedTargetId, setSelectedTargetId] = useState(''); // Selected profile or workflow ID

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

  const roleplayFrameRequestRef = useRef(null);
  if (!roleplayFrameRequestRef.current) {
    roleplayFrameRequestRef.current = initialFrames
      ? { workspaceId, revision: 0, requestedIds: new Set(initialFrames.originIds) }
      : { workspaceId: null, revision: -1, requestedIds: new Set() };
  }

  useEffect(() => {
    const requestState = roleplayFrameRequestRef.current;
    if (requestState.workspaceId !== activeChat.id || requestState.revision !== roleplayFrameRevision) {
      requestState.workspaceId = activeChat.id;
      requestState.revision = roleplayFrameRevision;
      requestState.requestedIds = new Set();
      setRoleplayFrames({});
    }
    const originIds = activeMessages.filter(message => message.role !== 'user').map(message => message.id);
    if (!originIds.length || !electronAPI.getRoleplayMessageFrames) {
      setRoleplayFrames({});
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
      setRoleplayFrames(previous => ({
        ...previous,
        ...Object.fromEntries((result.frames || []).map(frame => [frame.originId, frame]))
      }));
    }).catch(() => {
      const currentRequest = roleplayFrameRequestRef.current;
      if (currentRequest.workspaceId === requestWorkspaceId && currentRequest.revision === requestRevision) {
        missingOriginIds.forEach(originId => currentRequest.requestedIds.delete(originId));
      }
    });
  }, [activeChat.id, activeMessages, electronAPI, roleplayFrameRevision]);

  const heldRoleplayFrames = useMemo(
    () => holdDeferredFrames(activeMessages, roleplayFrames),
    [activeMessages, roleplayFrames]
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
    activeMessages,
    revision: historyRevision,
    memoryBlocks: activeChat?.memoryBlocks
  });

  const activeSubView = activeWorkspaceView;
  const setActiveSubView = useCallback(view => {
    perfStart('tab-switch');
    setActiveWorkspaceView(view);
  }, [setActiveWorkspaceView]);
  const isChatVisible = activeSubView === 'chat';
  const [worldbuildFocusId, setWorldbuildFocusId] = useState(null); // entity to focus when opening Worldbuild from the text

  const openEntityInWorldbuild = (entityId) => {
    setWorldbuildFocusId(entityId || null);
    setActiveSubView('worldbuild');
  };
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
  const dropdownRef = useRef(null);
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

  // Keep the reading position stable when older messages are prepended.
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

  // Auto-summarize trigger listener from backend
  useEffect(() => {
    if (!electronAPI.onTriggerAutoSummarize) return;
    const unsubscribe = electronAPI.onTriggerAutoSummarize(({ chatId }) => {
      if (activeChat && activeChat.id === chatId && !dismissedAutoSummarizeChatsRef.current.has(chatId)) {
        setSummarizeModalOpen(true);
      }
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [activeChat, electronAPI]);

  // Token threshold auto-trigger monitor (runs on frontend when token usage is exceeded)
  useEffect(() => {
    if (
      activeChat
      && activeChat.autoSummarize === 1
      && archiveMessages.length > 0
      && !summarizeModalOpen
      && !dismissedAutoSummarizeChatsRef.current.has(activeChat.id)
    ) {
      const archiveThreshold = activeChat.archiveThreshold || 60000;
      const activeMsgs = selectActiveMessages(archiveMessages, activeChat.memoryBlocks);

      let tokensUsed = 0;
      const estimateTokens = (str) => Math.ceil((str || '').length / 4);
      activeMsgs.forEach(m => { tokensUsed += estimateTokens(m.content); });

      // Only nag when the window would actually have something to offer.
      const archivable = selectArchivableMessages(archiveMessages, activeChat.memoryBlocks);
      if (tokensUsed >= archiveThreshold && archivable.length > 0) {
        setSummarizeModalOpen(true);
      }
    }
  }, [archiveMessages, activeChat, summarizeModalOpen]);

  // Archiving reports which stage it is in, so a long run can say so instead of
  // looking frozen.
  useEffect(() => {
    if (!electronAPI?.onSummarizationProgress) return;
    return electronAPI.onSummarizationProgress((payload) => {
      if (!payload || payload.chatId !== activeChat?.id) return;
      setSummarizeProgress(payload);
    });
  }, [activeChat?.id]);

  // Restore the last target used, else the first active profile.
  useEffect(() => {
    if (activeChat) {
      const activeProfs = safeParseJson(activeChat.activeProfiles).filter(id => id && id !== 'undefined');
      const activeWfs = safeParseJson(activeChat.activeWorkflows).filter(id => id && id !== 'undefined');

      const validActiveProf = activeProfs.find(id => writingProfiles.some(p => p.id === id));
      const validActiveWf = activeWfs.find(id => workflows.some(w => w.id === id));

      const lastTargetId = activeChat.lastTargetId;
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
  }, [activeChat, writingProfiles, workflows]);

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
    requestRevert: messageId => setConfirmDeleteData({ type: 'revert_chat', messageId })
  }), [copyText, saveUserEdit, saveAiEdit, regenerate, switchAlternative, toggleExcluded, finishTyping]);

  // Custom visual background image resolution
  const isCurrentRoleplayMode = roleplayWorkspaceId === workspaceId && roleplayMode;
  const effectiveBackground = isCurrentRoleplayMode && isChatVisible && roleplayBackground?.imagePath
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
      ? { backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' }
      : {});
    const userAlpha = bubbleAlpha(userBubbleOpacity);
    const aiAlpha = bubbleAlpha(aiBubbleOpacity);
    return {
      sizeClass: fontSize === 'small' ? 'text-xs' : fontSize === 'large' ? 'text-base' : 'text-sm',
      isDocumentMode,
      softBlur,
      userBubbleStyle: {
        backgroundColor: `rgba(26, 45, 50, ${userAlpha})`,
        border: '1px solid rgba(221, 186, 110, 0.15)',
        ...blurStyle(userAlpha),
        ...(isDocumentMode ? { padding: '1.25rem', borderRadius: '0.75rem' } : {})
      },
      aiBubbleStyle: {
        backgroundColor: `rgba(10, 22, 29, ${aiAlpha})`,
        border: '1px solid rgba(255, 255, 255, 0.05)',
        ...(isDocumentMode ? { padding: '1.25rem', borderRadius: '0.75rem' } : blurStyle(aiAlpha))
      },
      flags: {
        tokenDebug: Boolean(advanced.tokenDebug),
        ragDebug: Boolean(advanced.ragDebug),
        agenticDebug: Boolean(advanced.agenticDebug),
        narrativeStateDebug: Boolean(advanced.narrativeStateDebug)
      }
    };
  }, [fontSize, isDocumentMode, softBlur, userBubbleOpacity, aiBubbleOpacity, advanced.tokenDebug, advanced.ragDebug, advanced.agenticDebug, advanced.narrativeStateDebug]);

  const lastUserMessageId = useMemo(() => activeMessages.findLast(m => m.role === 'user')?.id, [activeMessages]);
  const lastAiMessage = useMemo(() => activeMessages.findLast(m => m.role === 'ai'), [activeMessages]);

  // Active context usage bar (optional, shown at the top of the chat)
  const ctxTokens = useMemo(() => {
    let tokens = 0;
    selectActiveMessages(archiveMessages, activeChat?.memoryBlocks)
      .forEach(m => { tokens += Math.ceil((m.content || '').length / 4); });
    return tokens;
  }, [archiveMessages, activeChat?.memoryBlocks]);

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
        messageIds,
        excludedMessageIds,
        customTitle,
        profileId: activeProfileId
      });

      if (result && result.success) {
        // History is stored; recap and tags finish in the background.
        await refreshChats(activeChat.id);
        setHistoryRevision(rev => rev + 1);
        dismissedAutoSummarizeChatsRef.current.delete(activeChat.id);
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

  const handleDragEnter = (e) => {
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

  const ctxThreshold = activeChat.archiveThreshold || 60000;
  const ctxPercentage = Math.min((ctxTokens / ctxThreshold) * 100, 100);
  // Unarchived messages past the budget are lost from context, so the header says so.
  // The last reply's count is authoritative; the estimate is only a fallback.
  const lastContext = lastAiMessage ? safeParseDebugNotice(lastAiMessage.debugNotice)?.context : null;
  const ctxHistoryCut = lastContext ? Number(lastContext.historyDropped) || 0 : 0;
  const lastArchiveAt = safeParseJson(activeChat.memoryBlocks, [])
    .filter(block => block && block.type === 'summarized')
    .reduce((latest, block) => Math.max(latest, Number(String(block.id || '').match(/^block_(\d+)/)?.[1]) || 0), 0);
  const ctxPayloadLimit = activeChat.maxContext || 128000;
  const ctxOverPayload = lastContext
    ? ctxHistoryCut > 0 && !(lastArchiveAt > (lastAiMessage?.createdAt || 0))
    : ctxTokens > ctxPayloadLimit;

  const generatingBubbleStyle = isDocumentMode ? {
    backgroundColor: `rgba(10, 22, 29, ${bubbleAlpha(aiBubbleOpacity)})`,
    border: '1px solid rgba(251, 203, 45, 0.15)',
    padding: '1.25rem',
    borderRadius: '0.75rem',
    boxShadow: '0 0 15px rgba(251, 203, 45, 0.03)'
  } : {
    backgroundColor: `rgba(10, 22, 29, ${bubbleAlpha(aiBubbleOpacity)})`,
    border: '1px solid rgba(251, 203, 45, 0.15)',
    ...(softBlur && aiBubbleOpacity < 100 ? { backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)' } : {}),
    boxShadow: '0 0 15px rgba(251, 203, 45, 0.03)'
  };

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className="flex w-full h-full relative overflow-hidden bg-[#011419]"
    >
      {/* Visual Background Layers */}
      {hasBg && <div style={bgStyle} className="absolute inset-0 z-0" />}
      <div style={backdropStyle} className="absolute inset-0 z-0" />

      {/* Chat Space Column */}
      <div className="flex-1 flex flex-col h-full relative z-10 overflow-hidden">
        {/* Drag and drop overlay */}
        {isDragging && (
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/70 border-2 border-dashed border-accent/40 m-4 rounded-xl pointer-events-none animate-in fade-in duration-200">
            <div className="flex flex-col items-center space-y-4">
              <Paperclip className="w-12 h-12 text-accent animate-bounce" />
              <span className="text-sm font-bold text-white tracking-wide">Drop files here to attach to chat</span>
            </div>
          </div>
        )}

        {/* Workspace Chat Header */}
        <div className={`flex items-center justify-between h-14 border-b border-gray-800/80 px-6 shrink-0 bg-[#011419]/80 z-10 relative ${(settings?.interface?.blur ?? true) ? 'backdrop-blur-md' : ''}`}>
          <div className="flex items-center space-x-3 min-w-0 mr-4 flex-1">
            <button
              onClick={() => setCurrentView('dashboard')}
              className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-md transition-colors mr-2 cursor-pointer shrink-0"
            >
              <ArrowLeft className="w-4.5 h-4.5" />
            </button>
            <h2 className="text-white font-semibold text-sm truncate">
              {activeChat.title}
            </h2>
          </div>

          <nav aria-label="Workspace areas" className="flex min-w-0 items-center gap-0.5 rounded-lg border border-border-subtle bg-surface-input/80 p-1 select-none z-10">
            {[
              ['chat', 'Workspace', WorkspaceGlyph],
              ['writing', 'Writing', WritingGlyph],
              ['worldbuild', 'Worldbuild', WorldbuildGlyph],
              ['memory', 'Memory', MemoryGlyph],
              ['files', 'Files', Folder],
            ].map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveSubView(id)}
                onMouseEnter={() => workspaceTabViews[id]?.preload()}
                aria-current={activeSubView === id ? 'page' : undefined}
                className={`group inline-flex h-8 shrink-0 items-center overflow-hidden rounded-md text-xs font-semibold transition-[max-width,padding,background-color,color,box-shadow] duration-300 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${activeSubView === id
                  ? 'max-w-36 bg-accent px-3 text-on-accent shadow-sm'
                  : 'max-w-8 px-2 text-text-muted hover:max-w-36 hover:bg-white/5 hover:px-3 hover:text-text-primary'
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
            {/* Past the payload budget the oldest live messages stop being sent at all.
                It stays a marker rather than a banner: the state persists for as long as
                the history overflows, and a permanent band would only be noise. */}
            {isChatVisible && ctxOverPayload && (
              <button
                onClick={() => setSummarizeModalOpen(true)}
                data-tooltip={ctxHistoryCut > 0
                  ? `${ctxHistoryCut} older ${ctxHistoryCut === 1 ? 'message was' : 'messages were'} left out of the last reply to fit the payload budget. Archive them to keep them searchable.`
                  : 'Active history exceeds the payload budget. The oldest messages are being cut. Archive them.'}
                aria-label="Active history exceeds the payload budget"
                className="p-1.5 rounded-md text-status-danger hover:bg-status-danger/15 transition-colors cursor-pointer shrink-0"
              >
                <AlertTriangle className="w-4 h-4" />
              </button>
            )}
            <button
              onClick={() => setActiveSubView('configuration')}
              onMouseEnter={() => workspaceTabViews.configuration.preload()}
              className={`inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${activeSubView === 'configuration'
                ? 'text-accent bg-accent/10'
                : 'text-text-muted hover:text-text-primary hover:bg-white/5'
                }`}
            >
              <SlidersHorizontal className="h-4 w-4" />
              <span>Configuration</span>
            </button>
          </div>
        </div>

        {/* Active context usage bar under the header (chat only, when enabled) */}
        {isChatVisible && activeChat.showContextBar === 1 && (
          <div className="h-1 w-full bg-gray-800/50 shrink-0 relative z-10" title={`Active context: ~${ctxTokens} / ${ctxThreshold} tokens`}>
            <div
              style={{ width: `${ctxPercentage}%` }}
              className={`h-full transition-[width,background-color] duration-500 ease-out ${ctxPercentage >= 95 ? 'bg-status-danger' : ctxPercentage >= 75 ? 'bg-orange-500' : 'bg-accent'}`}
            />
          </div>
        )}

        {/* The chat stays mounted while another tab is open, so returning is instant and
            keeps the reading position. The other tabs mount on demand. */}
        <div className={`flex-1 min-h-0 flex-col relative overflow-hidden ${isChatVisible ? 'flex' : 'hidden'}`}>
          {/* Message Container Thread */}
          <div
            ref={messageContainerRef}
            onClick={handleContainerClick}
            onScroll={updateFollowingLatest}
            className={`chat-thread flex-1 overflow-y-auto pt-6 pb-28 px-12 md:px-24 custom-scrollbar ${presentationReady ? '' : 'invisible'} ${isCurrentRoleplayMode && !roleplayPanelCollapsed ? 'xl:px-20 2xl:px-28' : isCurrentRoleplayMode ? 'xl:px-40 2xl:px-72' : 'xl:px-48'}`}
          >
            <div ref={messageContentRef} className="space-y-6">
              <div className="flex flex-wrap items-center justify-center gap-2">
                {hasOlderMessages && (
                  <button
                    type="button"
                    aria-label="Attach files"
                    onClick={handleLoadOlderMessages}
                    disabled={isLoadingOlderMessages}
                    className="rounded-lg border border-gray-700 bg-[#0a161d] px-3 py-1.5 text-[0.625rem] font-bold uppercase tracking-wider text-gray-300 transition-colors hover:border-accent/50 hover:text-accent disabled:cursor-wait disabled:opacity-60"
                  >
                    {isLoadingOlderMessages ? 'Loading history...' : 'Show 50 previous messages'}
                  </button>
                )}
                {hasOlderMessages && (
                  <button
                    type="button"
                    onClick={handleJumpToStart}
                    disabled={isLoadingOlderMessages}
                    className="rounded-lg border border-gray-700 bg-[#0a161d] px-3 py-1.5 text-[0.625rem] font-bold uppercase tracking-wider text-gray-300 transition-colors hover:border-accent/50 hover:text-accent disabled:cursor-wait disabled:opacity-60"
                  >
                    Go to start
                  </button>
                )}
              </div>
              {activeMessages.map((msg, index) => (
                <ChatMessageItem
                  key={msg.id}
                  deferRender={index < activeMessages.length - ALWAYS_RENDERED_ROWS}
                  message={msg}
                  isEditing={editingMessageId === msg.id}
                  isLastUser={msg.id === lastUserMessageId}
                  isLastAi={msg.id === lastAiMessage?.id}
                  isTyping={msg.id === lastGeneratedMessageId}
                  frame={msg.role === 'user' ? undefined : (roleplayFrames[msg.id] || heldRoleplayFrames[msg.id])}
                  view={messageView}
                  actions={messageActions}
                />
              ))}

              {/* Workflow runner progress banner */}
              {isGenerating && generationProgress && (
                <GenerationBubble progress={generationProgress} style={generatingBubbleStyle} onTextChange={pinToLatestIfFollowing} />
              )}
            </div>
          </div>

          {hasCompletedResponseBelow && !isFollowingLatest && (
            <button
              type="button"
              onClick={scrollToLatest}
              className="absolute right-6 bottom-28 z-20 flex items-center gap-2 rounded-full border border-accent/35 bg-[#0a161d]/95 px-3 py-2 text-[0.625rem] font-bold uppercase tracking-wider text-accent shadow-lg shadow-black/30 transition-colors hover:bg-accent hover:text-[#011419]"
            >
              <ArrowDown className="w-3.5 h-3.5" />
              <span>New response below</span>
            </button>
          )}

          {/* Digitization Chat Input Area */}
          <div className="shrink-0 p-6 pt-0 w-full max-w-4xl mx-auto absolute bottom-0 inset-x-0 bg-gradient-to-t from-[#011419] via-[#011419] to-transparent pb-6 pt-4">

            {/* Pending Attachments list (Rendered static preview above the chat bar) */}
            {pendingFiles.length > 0 && (
              <div className="w-full flex flex-wrap gap-3 px-3 pb-3 select-none animate-in fade-in slide-in-from-bottom-2 duration-200">
                {pendingFiles.map(file => {
                  const fileUrl = file.path ? `app-file:///${encodeURI(file.path.replace(/\\/g, '/'))}` : '';
                  const hasThumbnail = isImage(file.name) || isVideo(file.name);

                  return (
                    <div
                      key={file.name}
                      className="flex items-center space-x-2.5 bg-[#0a161d]/95 border border-gray-800/80 rounded-xl p-2 text-xs text-gray-300 relative group pr-4 shadow-lg"
                    >
                      {isImage(file.name) && (
                        <img src={fileUrl} alt="preview" className="w-10 h-10 object-cover rounded-lg border border-gray-700/50 shrink-0" />
                      )}
                      {isVideo(file.name) && (
                        <video src={fileUrl} className="w-10 h-10 object-cover rounded-lg border border-gray-700/50 shrink-0" muted />
                      )}
                      {!hasThumbnail && (
                        <div className="w-10 h-10 bg-[#051116] border border-gray-800 rounded-lg flex items-center justify-center text-gray-500 shrink-0">
                          <Paperclip className="w-4 h-4" />
                        </div>
                      )}
                      <div className="flex flex-col min-w-0 max-w-[120px]">
                        <span className="truncate text-[0.625rem] font-bold text-gray-100" title={file.name}>{file.name}</span>
                        <span className="text-[0.5rem] text-gray-500 font-mono mt-0.5">{(file.size / 1024).toFixed(0)} KB</span>
                      </div>
                      {/* Floating delete button on hover or always */}
                      <button
                        onClick={() => removePendingFile(file.name)}
                        className="absolute -top-1.5 -right-1.5 bg-danger-solid hover:bg-danger-solid-hover text-white rounded-full p-0.5 shadow-md shadow-black/40 hover:scale-105 transition-[background-color,transform] cursor-pointer shrink-0"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  );
                })}
              </div>
            )}

            <div className="bg-[#051116] border border-gray-800/80 rounded-2xl flex flex-col px-2 py-2 shadow-lg shadow-black/20 focus-within:border-accent/50 transition-colors relative z-20">

              <div className="flex items-center w-full">
                {/* File attachment upload trigger */}
                <input
                  type="file"
                  multiple
                  ref={fileInputRef}
                  onChange={handleFileAttachment}
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="order-1 p-2 rounded-full hover:bg-white/5 text-gray-500 hover:text-white transition-colors cursor-pointer"
                  title="Attach Files"
                >
                  <Paperclip className="w-4 h-4" />
                </button>

                {/* Ingestion Profile Choices Dropdown */}
                <div className="relative order-3 mr-2" ref={dropdownRef}>
                  <button
                    type="button"
                    onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
                    className="px-2.5 py-1.5 rounded-lg border border-gray-800 bg-[#011419] text-gray-400 hover:text-white text-[0.625rem] font-bold uppercase tracking-wider flex items-center space-x-1.5 cursor-pointer transition-colors"
                  >
                    <AiGlyph className="w-3.5 h-3.5" />
                    <span className="truncate max-w-[80px]">
                      {selectedTarget ? selectedTarget.name : 'Select a Profile'}
                    </span>
                    <ChevronDown className="w-3 h-3 text-gray-500" />
                  </button>

                  <Popover anchorRef={dropdownRef} open={profileDropdownOpen} onClose={() => setProfileDropdownOpen(false)} matchAnchorWidth={false} align="right" scroll={false} className="w-64 !p-2.5 font-sans">
                      <span className="block text-[0.5rem] font-bold text-gray-500 uppercase tracking-widest px-2 pb-1.5 select-none">AI Profile / Workflow</span>

                      <div className="max-h-60 overflow-y-auto custom-scrollbar space-y-2.5">
                        {/* Writing Profiles */}
                        <div>
                          <span className="block text-[0.4375rem] font-extrabold text-[#FBCB2D]/55 uppercase tracking-widest px-2 py-0.5 select-none">Profiles</span>
                          {displayProfiles.length > 0 ? (
                            <div className="space-y-1">
                              {displayProfiles.map(p => (
                                <button
                                  key={p.id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedTargetId(p.id);
                                    electronAPI.setChatLastTarget(activeChat.id, p.id);
                                    setProfileDropdownOpen(false);
                                  }}
                                  className={`w-full flex items-center space-x-2.5 px-2 py-1.5 rounded-md text-left text-xs transition-colors cursor-pointer ${selectedTargetId === p.id
                                    ? 'bg-accent/10 text-accent font-bold border border-accent/20'
                                    : 'text-gray-300 hover:bg-white/5 border border-transparent'
                                    }`}
                                >
                                  <span className={`w-2 h-2 rounded-full shrink-0 ${p.needsSetup ? 'opacity-40' : ''}`} style={{ backgroundColor: p.color }} />
                                  <span className={`flex-1 min-w-0 truncate font-sans ${p.needsSetup && selectedTargetId !== p.id ? 'text-gray-500' : ''}`}>{p.name}</span>
                                  {p.needsSetup && (
                                    <AlertTriangle className="w-3.5 h-3.5 text-amber-500 shrink-0 cursor-help" data-tooltip="To activate: create an API profile in Settings, then link it to this profile in the Library." />
                                  )}
                                </button>
                              ))}
                            </div>
                          ) : (
                            <div className="flex flex-col items-center py-2 px-2 border border-dashed border-gray-800/60 rounded-lg bg-black/10 select-none">
                              <span className="caption italic">No AI Profiles Active</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setProfileDropdownOpen(false);
                                  setActiveSubView('configuration');
                                }}
                                className="mt-1 flex items-center space-x-1 text-[0.5625rem] font-bold text-accent hover:underline uppercase cursor-pointer"
                              >
                                <Plus className="w-2.5 h-2.5" />
                                <span>Active Profile</span>
                              </button>
                            </div>
                          )}
                        </div>

                        {/* Divider */}
                        <div className="h-px bg-gray-800/80 my-1 shrink-0" />

                        {/* Workflows */}
                        <div>
                          <span className="block text-[0.4375rem] font-extrabold text-[#FBCB2D]/55 uppercase tracking-widest px-2 py-0.5 select-none">Workflows</span>
                          {displayWorkflows.length > 0 ? (
                            <div className="space-y-1">
                              {displayWorkflows.map(w => (
                                <button
                                  key={w.id}
                                  type="button"
                                  onClick={() => {
                                    setSelectedTargetId(w.id);
                                    electronAPI.setChatLastTarget(activeChat.id, w.id);
                                    setProfileDropdownOpen(false);
                                  }}
                                  className={`w-full flex items-center space-x-2 px-2 py-1.5 rounded-md text-left text-xs transition-colors cursor-pointer ${selectedTargetId === w.id
                                    ? 'bg-accent/10 text-accent font-bold border border-accent/20'
                                    : 'text-gray-300 hover:bg-white/5 border border-transparent'
                                    }`}
                                >
                                  <Workflow className="w-3.5 h-3.5 text-accent shrink-0" />
                                  <span className="truncate font-sans">{w.name}</span>
                                </button>
                              ))}
                            </div>
                          ) : (
                            <div className="flex flex-col items-center py-2 px-2 border border-dashed border-gray-800/60 rounded-lg bg-black/10 select-none">
                              <span className="caption italic">No Workflows Active</span>
                              <button
                                type="button"
                                onClick={() => {
                                  setProfileDropdownOpen(false);
                                  setActiveSubView('configuration');
                                }}
                                className="mt-1 flex items-center space-x-1 text-[0.5625rem] font-bold text-accent hover:underline uppercase cursor-pointer"
                              >
                                <Plus className="w-2.5 h-2.5" />
                                <span>Active Workflow</span>
                              </button>
                            </div>
                          )}
                        </div>
                      </div>
                  </Popover>
                </div>

                <ChatInput
                  key={activeChat.id}
                  canSend={canSend}
                  hasTargets={displayProfiles.length > 0 || displayWorkflows.length > 0}
                  isGenerating={isGenerating}
                  onCancel={handleCancelGeneration}
                  onSend={handleSend}
                  pendingFileCount={pendingFiles.length}
                  placeholder={activeMessages.length > 0 ? "Write a message..." : "Write a message or drag and drop files..."}
                  workspaceId={activeChat.id}
                />

              </div>

            </div>
          </div>
        </div>

        {!isChatVisible && (
          <Suspense fallback={<div className="flex-1" />}>
            {activeSubView === 'memory' ? (
              <ChatMemoryView
                chat={activeChat}
                onSaveChat={handleSaveChat}
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
              />
            ) : activeSubView === 'configuration' ? (
              <ConfigurationView
                onTriggerSummarize={() => {
                  dismissedAutoSummarizeChatsRef.current.delete(activeChat.id);
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
        )}

      </div>

      {isCurrentRoleplayMode && (
        <div className={isChatVisible ? 'contents' : 'hidden'}>
          <RoleplayQuickPanel
            key={activeChat.id}
            workspaceId={activeChat.id}
            api={electronAPI}
            showToast={showToast}
            initialCollapsed={roleplayPanelCollapsed}
            visible={isChatVisible}
            narrativeStateProcessing={isGenerating && generationProgress?.chatId === activeChat.id && generationProgress?.phase === 'narrative-state'}
            onBackgroundChange={handleRoleplayBackgroundChange}
            onCollapsedChange={handleRoleplayPanelCollapsedChange}
            onOpenConfiguration={openRoleplayConfiguration}
          />
        </div>
      )}

      {/* Floating Error modal for failed message edit */}
      {editError && (
        <div className="absolute bottom-28 right-6 w-80 bg-[#1a0a0d] border border-status-danger/30 rounded-xl p-4 shadow-[0_0_20px_rgba(0,0,0,0.6)] z-50 animate-in fade-in slide-in-from-bottom-5 duration-300 flex flex-col space-y-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center space-x-2 text-status-danger">
              <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              </svg>
              <span className="text-xs font-bold uppercase tracking-wider">Request Failed</span>
            </div>
            <button
              onClick={() => setEditError(null)}
              className="text-gray-500 hover:text-white transition-colors cursor-pointer"
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
              className="px-2.5 py-1 text-[0.625rem] font-bold uppercase text-gray-400 hover:text-white cursor-pointer transition-colors"
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
              className="px-3 py-1 bg-danger-solid hover:bg-danger-solid-hover text-white rounded text-[0.625rem] font-bold uppercase hover:scale-[1.02] active:scale-95 transition-[background-color,transform] cursor-pointer"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      <SummarizeModal
        isOpen={summarizeModalOpen}
        onClose={() => {
          dismissedAutoSummarizeChatsRef.current.add(activeChat.id);
          setSummarizeModalOpen(false);
        }}
        chatId={activeChat.id}
        electronAPI={electronAPI}
        nextSummaryNumber={nextSummaryNumber}
        onConfirm={handleExecuteSummarization}
        isVectorizing={isVectorizing}
        progress={summarizeProgress}
      />

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

        return (
          <DeleteModal
            title={isDeleteMsg ? "Delete Message" : "Revert Chat to Message"}
            message={isDeleteMsg
              ? "Are you sure you want to delete this message? This action is permanent and cannot be undone."
              : "Are you sure you want to revert the chat to this message? All subsequent messages will be permanently deleted."
            }
            confirmText={isDeleteMsg ? "Delete" : "Revert"}
            showCheckbox={isDeleteMsg && hasAttachments}
            checkboxLabel="Delete Attached Files from Memory"
            checkboxValue={deleteAttachedFiles}
            onCheckboxChange={setDeleteAttachedFiles}
            onConfirm={async (shouldDeleteFiles) => {
              setConfirmDeleteData(null);
              if (isDeleteMsg) {
                await electronAPI.deleteMessage(msgId, shouldDeleteFiles);
                await refreshChats(activeChat.id);
              } else {
                await handleRevertChat(msgId);
              }
            }}
            onClose={() => setConfirmDeleteData(null)}
          />
        );
      })()}

    </div>
  );
}
