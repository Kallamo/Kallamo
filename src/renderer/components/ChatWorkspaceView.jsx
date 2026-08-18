import { useCallback, useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { ArrowDown, ArrowLeft, Sliders, Paperclip, Cpu, Workflow, X, MoreVertical, Copy, Edit, RotateCw, Play, ChevronDown, Plus, ChevronLeft, ChevronRight, Brain, Folder, MessageSquare, Trash2, RotateCcw, PenTool, Globe, AlertTriangle, CalendarDays, Clock3, MapPin } from 'lucide-react';
import ConfigurationView from './ConfigurationView';
import SummarizeModal from './modals/SummarizeModal';
import ChatFilesView from './ChatFilesView';
import ChatMemoryView from './ChatMemoryView';
import WritingDeskView from './WritingDeskView';
import WorldbuildView from './WorldbuildView';
import FilePreviewModal from './modals/FilePreviewModal';
import DeleteModal from './modals/DeleteModal';
import Popover from './ui/Popover';
import ChatInput from '../features/chat/components/ChatInput';
import MessageMarkdown from '../features/chat/components/MessageMarkdown';
import TypingText from '../features/chat/components/TypingText';
import { parseMessageContent } from '../features/chat/message-content';
import RoleplayQuickPanel from '../features/roleplay/RoleplayQuickPanel';
import { resolveActiveGenerationTarget } from '../features/chat/generation-target';

const roleplayPresentationCache = new Map();
const roleplayBackgroundCache = new Map();

const safeParseJson = (str, fallback = []) => {
  if (!str) return fallback;
  if (typeof str !== 'string') return str;
  try {
    const parsed = JSON.parse(str);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (e) {
    console.error("safeParseJson error in ChatWorkspaceView:", e);
    return fallback;
  }
};

const safeParseDebugNotice = (notice) => {
  if (!notice) return null;
  try {
    return JSON.parse(notice);
  } catch (e) {
    return { legacyText: notice };
  }
};

const diagnosticText = value => {
  if (!value) return '';
  return typeof value === 'string' ? value : JSON.stringify(value, null, 2);
};

const formatFrameDate = point => {
  if (!point?.position) return '';
  const { position, display } = point;
  return `${position.day} ${display?.monthName || `Month ${position.month}`} ${position.year}${display?.eraShortName ? ` ${display.eraShortName}` : ''}`;
};

const formatFrameTime = point => point?.position
  ? `${String(point.position.hour ?? 0).padStart(2, '0')}:${String(point.position.minute ?? 0).padStart(2, '0')}`
  : '';

const formatFrameWeekday = point => point?.display?.weekdayName || '';

const sameFrameDate = (left, right) => left?.position && right?.position
  && left.position.eraId === right.position.eraId
  && left.position.year === right.position.year
  && left.position.month === right.position.month
  && left.position.day === right.position.day;

const shouldShowTimeTransition = frame => {
  if (!frame?.advance) return false;
  const duration = frame.advance.duration || {};
  return !sameFrameDate(frame.start, frame.end)
    || Number(duration.years) > 0
    || Number(duration.months) > 0
    || Number(duration.days) > 0
    || Number(duration.hours) > 0
    || Number(duration.minutes) >= 30;
};

function RoleplayMessageFrame({ frame }) {
  if (!frame?.end) return null;
  const locationChanged = frame.start?.locationId !== frame.end?.locationId
    || frame.start?.locationName !== frame.end?.locationName;
  const timeChanged = shouldShowTimeTransition(frame);
  return (
    <div className="mb-3 grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-center gap-5 border-b border-white/[0.07] pb-3 text-gray-500 select-none">
      <span className="flex min-w-0 items-center gap-2 text-xs">
        <MapPin className="h-3.5 w-3.5 shrink-0 text-emerald-300/80" />
        <span className="min-w-0 truncate font-medium text-gray-400">
          {locationChanged
            ? <><span>{frame.start?.locationName || 'Unknown location'}</span><span className="px-1.5 text-gray-700">→</span><span className="text-gray-300">{frame.end.locationName || 'Unknown location'}</span></>
            : <span>{frame.end.locationName || 'No current location'}</span>}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-4 text-right">
        <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-400">
          <CalendarDays className="h-3.5 w-3.5 text-sky-300/80" />
          {sameFrameDate(frame.start, frame.end) ? formatFrameDate(frame.end) : `${formatFrameDate(frame.start)} → ${formatFrameDate(frame.end)}`}
        </span>
        <span className="inline-flex items-center gap-1.5 font-mono text-[0.6875rem] text-gray-500">
          <Clock3 className="h-3.5 w-3.5 text-amber-300/80" />
          {timeChanged ? <>{formatFrameTime(frame.start)}<span className="px-1 text-gray-700">→</span>{formatFrameTime(frame.end)}</> : formatFrameTime(frame.end)}
          {formatFrameWeekday(frame.end) && <span className="font-sans text-gray-500">· {formatFrameWeekday(frame.end)}</span>}
        </span>
      </span>
    </div>
  );
}

function MessageDiagnostics({
  messageId,
  settings,
  debug,
  activeKey,
  onToggle,
  onCopyAgentic,
  onCopyRetrieval,
  onCopyNarrative,
  copiedAgentic,
  copiedRetrieval,
  copiedNarrative
}) {
  const diagnostics = [
    settings.advanced.agenticDebug && (debug?.agentic || debug?.agenticRagResponse) && {
      key: 'agentic',
      label: 'Agentic Retrieval Trace',
      title: 'Copy the sanitized Agentic retrieval trace',
      content: formatAgenticTrace(debug),
      copied: copiedAgentic,
      copyLabel: 'Copy Trace',
      onCopy: onCopyAgentic
    },
    settings.advanced.ragDebug && (debug?.retrieval || debug?.standardRagContextGathered) && {
      key: 'retrieval',
      label: 'Retrieval & Context',
      title: 'Copy retrieval decisions and final narrative context',
      content: formatRetrievalDiagnostics(debug),
      copied: copiedRetrieval,
      copyLabel: 'Copy Report',
      onCopy: onCopyRetrieval
    },
    settings.advanced.narrativeStateDebug && debug?.narrativeState && {
      key: 'narrative',
      label: `Narrative State · ${debug.narrativeState.status}`,
      title: 'Copy Narrative State diagnostics',
      content: diagnosticText(debug.narrativeState),
      copied: copiedNarrative,
      copyLabel: 'Copy Report',
      onCopy: onCopyNarrative
    }
  ].filter(Boolean);
  if (!diagnostics.length) return null;
  const active = diagnostics.find(item => item.key === activeKey);
  return (
    <div className="mb-2 ml-1 max-w-full select-none">
      <div className="flex max-w-full flex-nowrap items-center gap-1.5 overflow-x-auto pb-0.5 custom-scrollbar">
        {diagnostics.map(item => (
          <span key={item.key} className={`inline-flex shrink-0 items-center rounded-md border text-[0.625rem] font-semibold uppercase tracking-[0.08em] transition-colors ${activeKey === item.key ? 'border-accent/25 bg-accent/[0.07] text-accent' : 'border-white/[0.07] bg-black/20 text-gray-500 hover:border-white/15 hover:text-gray-300'}`}>
            <button type="button" aria-expanded={activeKey === item.key} onClick={() => onToggle(item.key)} className="inline-flex items-center gap-1 px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
              <span>{item.label}</span>
              <ChevronDown className={`h-2.5 w-2.5 transition-transform ${activeKey === item.key ? 'rotate-180' : ''}`} />
            </button>
            {activeKey === item.key && (
              <button type="button" onClick={() => item.onCopy(messageId, debug)} className="inline-flex items-center gap-1 border-l border-white/10 px-2 py-1 text-gray-400 hover:text-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40" title={item.title}>
                <Copy className="h-2.5 w-2.5" />
                <span>{item.copied ? 'Copied!' : item.copyLabel}</span>
              </button>
            )}
          </span>
        ))}
      </div>
      {active && (
        <div className="mt-1 max-h-96 max-w-2xl overflow-y-auto rounded-lg border border-gray-800 bg-[#051116] p-3 font-mono text-xs text-gray-400 shadow-md custom-scrollbar animate-in fade-in duration-200">
          <div className="whitespace-pre-wrap">{active.content}</div>
        </div>
      )}
    </div>
  );
}

const formatSelectionFunnel = selection => {
  if (!selection) return 'No selection funnel recorded.';
  const counts = value => Object.entries(value || {})
    .map(([key, count]) => `${key}: ${count}`)
    .join(', ') || 'none';
  return [
    `Intent: ${selection.intent || 'general'}`,
    ...(selection.evidence ? [
      `Evidence: ${selection.evidence.status || 'inconclusive'} (${selection.evidence.reason || 'unspecified'})`,
      ...(selection.evidence.source ? [`Latest source: ${selection.evidence.source}`] : [])
    ] : []),
    `Discovered: ${selection.discovered || 0} (${counts(selection.discoveredByKind)})`,
    `Selected: ${selection.selected || 0} (${counts(selection.selectedByKind)})`,
    `Excluded: ${selection.excluded || 0} (${counts(selection.excludedByReason)})`,
    '',
    'SELECTED SOURCES',
    ...(selection.selectedSources?.length
      ? selection.selectedSources.map(item => `- ${item.source || 'Unknown'} [${item.kind}]`)
      : ['- None']),
    '',
    'EXCLUDED SOURCES',
    ...(selection.excludedSources?.length
      ? selection.excludedSources.map(item => `- ${item.source || 'Unknown'} [${item.kind}]: ${item.reason}`)
      : ['- None'])
  ].join('\n');
};

const formatPlannerDecisions = bundle => {
  if (!bundle?.scopes?.length) return 'No perspective bundle.';
  const composition = bundle.composition;
  const summary = composition ? [
    `Rendered roleplay context: ${composition.renderedTokens || 0}/${bundle.tokenBudget || 0} tokens`,
    `Unique records: ${composition.uniqueRecords || 0}`,
    `Shared records: ${composition.sharedRecords || 0}`,
    `Scope memberships: ${composition.scopeMemberships || 0}`,
    `Duplicate renderings avoided: ${composition.avoidedDuplicateRenderings || 0}`,
    `Content tokens avoided: ${composition.avoidedContentTokens || 0}`,
    ''
  ] : [];
  const scopeLabels = new Map(bundle.scopes.map(scope => [scope.id, scope.label || scope.id]));
  const memberships = new Map();
  bundle.scopes.forEach(scope => {
    (scope.itemIds || []).forEach(candidateId => {
      const scopeIds = memberships.get(candidateId) || new Set();
      scopeIds.add(scope.id);
      memberships.set(candidateId, scopeIds);
    });
  });
  const scopeSummary = bundle.scopes.map(scope =>
    `${scope.label || scope.id}: ${scope.itemIds?.length || 0} authorized records (${scope.usedTokens || 0} tokens before sharing)`);
  const shared = [...memberships.entries()]
    .filter(([, scopeIds]) => scopeIds.size > 1)
    .map(([candidateId, scopeIds]) =>
      `- ${candidateId}: ${[...scopeIds].map(scopeId => scopeLabels.get(scopeId) || scopeId).join(', ')}`);
  const exclusive = bundle.scopes.flatMap(scope => {
    const records = (scope.itemIds || []).filter(candidateId => memberships.get(candidateId)?.size === 1);
    return records.length
      ? [`${scope.label || scope.id}`, ...records.map(candidateId => `- ${candidateId}`)]
      : [];
  });
  const excludedByDecision = new Map();
  (bundle.excluded || []).forEach(decision => {
    const key = JSON.stringify([decision.candidateId, decision.outcome, decision.reason]);
    const grouped = excludedByDecision.get(key) || { decision, scopeIds: new Set() };
    grouped.scopeIds.add(decision.scopeId);
    excludedByDecision.set(key, grouped);
  });
  const excluded = [...excludedByDecision.values()].map(({ decision, scopeIds }) => {
    const scopes = [...scopeIds].map(scopeId => scopeLabels.get(scopeId) || scopeId).join(', ');
    return `- ${decision.candidateId}: ${decision.outcome} (${decision.reason}) [${scopes}]`;
  });
  return [
    ...summary,
    ...scopeSummary,
    ...(shared.length ? ['', 'SHARED RECORDS', ...shared] : []),
    ...(exclusive.length ? ['', 'SCOPE-ONLY RECORDS', ...exclusive] : []),
    ...(excluded.length ? ['', 'EXCLUDED', ...excluded] : [])
  ].join('\n');
};

const formatAgenticTrace = diagnostic => {
  if (!diagnostic?.agentic) {
    return `### Agentic RAG Response\n${diagnostic?.agenticRagResponse || ''}\n\n### Context Gathered\n${diagnostic?.agenticRagContextGathered || ''}`;
  }
  return [
    `Stop reason: ${diagnostic.agentic.stopReason || 'unknown'}`,
    `Degraded: ${diagnostic.agentic.degraded ? 'yes' : 'no'}`,
    '',
    'TOOL TRACE',
    diagnosticText(diagnostic.agentic.turns),
    '',
    'FINISH',
    diagnostic.agentic.finish || '',
    '',
    'FINAL CONTEXT',
    diagnostic.agentic.contextText || ''
  ].join('\n');
};

const formatRetrievalDiagnostics = diagnostic => {
  const retrieval = diagnostic?.retrieval;
  if (!retrieval) return diagnostic?.standardRagContextGathered || '';
  return [
    `Mode: ${retrieval.mode || 'standard'}`,
    `Generation policy: ${diagnostic?.generation?.policyId || 'none'}`,
    `Generation target: ${diagnostic?.generation?.profileName || 'Unknown AI Profile'}`,
    '',
    'SELECTION FUNNEL',
    formatSelectionFunnel(retrieval.selection),
    '',
    'PLANNER DECISIONS',
    formatPlannerDecisions(retrieval.bundle),
    '',
    'EXACT FINAL NARRATIVE CONTEXT',
    retrieval.finalContextText || 'No additional narrative context was sent.'
  ].join('\n');
};

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
    streamingContent,
    streamingReasoning,
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

  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [roleplayMode, setRoleplayMode] = useState(false);
  const [roleplayPanelCollapsed, setRoleplayPanelCollapsed] = useState(false);
  const [roleplayWorkspaceId, setRoleplayWorkspaceId] = useState(null);
  const [roleplayBackground, setRoleplayBackground] = useState(() => roleplayBackgroundCache.get(activeChat?.id) || null);
  const roleplayBackgroundRequestRef = useRef(0);
  const [roleplayFrames, setRoleplayFrames] = useState({});
  const [roleplayFrameRevision, setRoleplayFrameRevision] = useState(0);
  const [selectedTargetId, setSelectedTargetId] = useState(''); // Selected profile or workflow ID

  useEffect(() => {
    let active = true;
    const workspaceId = activeChat.id;
    roleplayBackgroundRequestRef.current += 1;
    const cachedPresentation = roleplayPresentationCache.get(workspaceId);
    setRoleplayBackground(roleplayBackgroundCache.get(workspaceId) || null);
    if (cachedPresentation) {
      setRoleplayMode(cachedPresentation.mode);
      setRoleplayPanelCollapsed(cachedPresentation.collapsed);
      setRoleplayWorkspaceId(workspaceId);
    } else {
      setRoleplayWorkspaceId(null);
      Promise.all([
        electronAPI.getWorkspaceExperienceMode?.(workspaceId),
        electronAPI.getWorkspaceUiState?.(workspaceId, 'roleplay-quick-panel')
      ]).then(([modeResult, uiState]) => {
        if (!active) return;
        const presentation = {
          mode: modeResult?.mode === 'roleplay',
          collapsed: typeof uiState?.value?.collapsed === 'boolean' ? uiState.value.collapsed : false
        };
        roleplayPresentationCache.set(workspaceId, presentation);
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
      roleplayPresentationCache.set(workspaceId, {
        mode,
        collapsed: roleplayPresentationCache.get(workspaceId)?.collapsed ?? false
      });
      setRoleplayMode(mode);
      setRoleplayWorkspaceId(workspaceId);
    };
    window.addEventListener('roleplay-mode-change', updateMode);
    return () => { active = false; window.removeEventListener('roleplay-mode-change', updateMode); };
  }, [activeChat.id, electronAPI]);

  const handleRoleplayBackgroundChange = useCallback(background => {
    if (background) roleplayBackgroundCache.set(activeChat.id, background);
    else roleplayBackgroundCache.delete(activeChat.id);
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

  const roleplayFrameRequestRef = useRef({ workspaceId: null, revision: -1, requestedIds: new Set() });

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

  const [expandedThinking, setExpandedThinking] = useState({});
  const [expandedDiagnostic, setExpandedDiagnostic] = useState({});
  const [expandedTokenUsage, setExpandedTokenUsage] = useState({});

  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editingMessageText, setEditingMessageText] = useState('');

  const [copiedId, setCopiedId] = useState(null);
  const [copiedRagId, setCopiedRagId] = useState(null);
  const [copiedStandardRagId, setCopiedStandardRagId] = useState(null);
  const [copiedNarrativeStateId, setCopiedNarrativeStateId] = useState(null);

  const [openMenuId, setOpenMenuId] = useState(null);
  const messageMenuAnchorRef = useRef(null);

  const [confirmDeleteData, setConfirmDeleteData] = useState(null);
  const [deleteAttachedFiles, setDeleteAttachedFiles] = useState(true);

  const [pendingFiles, setPendingFiles] = useState([]);

  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  const [summarizeModalOpen, setSummarizeModalOpen] = useState(false);
  const [isVectorizing, setIsVectorizing] = useState(false);
  const [archiveMessages, setArchiveMessages] = useState([]);
  const dismissedAutoSummarizeChatsRef = useRef(new Set());

  const activeSubView = activeWorkspaceView;
  const setActiveSubView = setActiveWorkspaceView;
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

  const messagesEndRef = useRef(null);
  const messageContainerRef = useRef(null);
  const previousScrollHeightRef = useRef(0);
  const preserveScrollPositionRef = useRef(false);
  const skipAutoScrollRef = useRef(false);
  const isFollowingLatestRef = useRef(true);
  const wasGeneratingRef = useRef(false);
  const layoutAnchorRef = useRef(null);
  const autoScrollFrameRef = useRef(null);
  const dropdownRef = useRef(null);
  const fileInputRef = useRef(null);
  const [isFollowingLatest, setIsFollowingLatest] = useState(true);
  const [hasCompletedResponseBelow, setHasCompletedResponseBelow] = useState(false);

  useLayoutEffect(() => {
    if (activeSubView !== 'chat' || !messageContainerRef.current) return;
    isFollowingLatestRef.current = true;
    setIsFollowingLatest(true);
    setHasCompletedResponseBelow(false);
    messageContainerRef.current.scrollTop = messageContainerRef.current.scrollHeight;
  }, [activeSubView]);

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

  // Helper filters for message actions
  const userMessages = activeMessages.filter(m => m.role === 'user');
  const lastUserMsg = userMessages[userMessages.length - 1];

  const aiMessages = activeMessages.filter(m => m.role === 'ai');
  const lastAiMsg = aiMessages[aiMessages.length - 1];

  const isLastUserMsg = (id) => lastUserMsg && lastUserMsg.id === id;
  const isLastAiMsg = (id) => lastAiMsg && lastAiMsg.id === id;

  // Electron-first copy: navigator.clipboard.writeText is permission/focus-gated in
  // Electron and throws on programmatic copies (the RAG debug copy hit this). The
  // main-process clipboard is ungated; DOM execCommand is the last-resort fallback.
  const copyText = async (text) => {
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
  };

  const handleCopy = (id, text) => {
    copyText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCopyRagContext = (id, debugObj) => {
    copyText(formatAgenticTrace(debugObj));
    setCopiedRagId(id);
    setTimeout(() => setCopiedRagId(null), 2000);
  };

  const handleCopyStandardRag = (id, debugObj) => {
    copyText(formatRetrievalDiagnostics(debugObj));
    setCopiedStandardRagId(id);
    setTimeout(() => setCopiedStandardRagId(null), 2000);
  };

  const isImage = (name) => /\.(png|jpe?g|gif|webp)$/i.test(name);
  const isVideo = (name) => /\.(mp4|webm|ogg)$/i.test(name);

  // Keep the reading position stable when older messages are prepended.
  useEffect(() => {
    if (preserveScrollPositionRef.current && messageContainerRef.current) {
      const container = messageContainerRef.current;
      container.scrollTop += container.scrollHeight - previousScrollHeightRef.current;
      preserveScrollPositionRef.current = false;
      return;
    }
    if (skipAutoScrollRef.current) {
      skipAutoScrollRef.current = false;
      return;
    }
    if (!isFollowingLatestRef.current) return;
    if (autoScrollFrameRef.current) cancelAnimationFrame(autoScrollFrameRef.current);
    autoScrollFrameRef.current = requestAnimationFrame(() => {
      autoScrollFrameRef.current = null;
      const container = messageContainerRef.current;
      if (container) container.scrollTop = container.scrollHeight;
    });
    return () => {
      if (autoScrollFrameRef.current) cancelAnimationFrame(autoScrollFrameRef.current);
      autoScrollFrameRef.current = null;
    };
  }, [activeMessages, isGenerating, streamingContent, streamingReasoning]);

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
    if (!container) return;

    const nextIsFollowingLatest = container.scrollHeight - container.scrollTop - container.clientHeight <= 96;
    if (nextIsFollowingLatest === isFollowingLatestRef.current) return;

    isFollowingLatestRef.current = nextIsFollowingLatest;
    setIsFollowingLatest(nextIsFollowingLatest);
    if (nextIsFollowingLatest) setHasCompletedResponseBelow(false);
  };

  const handleCopyNarrativeState = (id, debugObj) => {
    copyText(diagnosticText(debugObj.narrativeState));
    setCopiedNarrativeStateId(id);
    setTimeout(() => setCopiedNarrativeStateId(null), 2000);
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
    roleplayPresentationCache.set(activeChat.id, { mode: roleplayMode, collapsed: nextCollapsed });
    setRoleplayPanelCollapsed(nextCollapsed);
  }, [activeChat.id, roleplayMode]);

  const openRoleplayConfiguration = useCallback(() => {
    setActiveSubView('configuration');
  }, [setActiveSubView]);

  const handleSendWithLatestFollow = (...args) => {
    isFollowingLatestRef.current = true;
    setIsFollowingLatest(true);
    setHasCompletedResponseBelow(false);
    return handleSend(...args);
  };

  const handleLoadOlderMessages = async () => {
    if (messageContainerRef.current) {
      previousScrollHeightRef.current = messageContainerRef.current.scrollHeight;
      preserveScrollPositionRef.current = true;
    }
    await loadOlderChatMessages();
  };

  const handleJumpToStart = async () => {
    skipAutoScrollRef.current = true;
    isFollowingLatestRef.current = false;
    setIsFollowingLatest(false);
    await jumpToChatStart();
    requestAnimationFrame(() => messageContainerRef.current?.scrollTo({ top: 0, behavior: 'smooth' }));
  };

  // The chat viewport is paginated for rendering only. Memory calculations and
  // archiving must always use the complete persisted history.
  useEffect(() => {
    let cancelled = false;

    if (!activeChat?.id) {
      setArchiveMessages([]);
      return undefined;
    }

    const loadArchiveMessages = async () => {
      const messages = await electronAPI.getChatMessages(activeChat.id);
      if (!cancelled) setArchiveMessages(messages);
    };

    loadArchiveMessages();
    return () => {
      cancelled = true;
    };
  }, [activeChat?.id, activeMessages, electronAPI]);

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
      const startIndex = activeChat.summarizedIndex || 0;
      const activeMsgs = archiveMessages.slice(startIndex);

      let tokensUsed = 0;
      const estimateTokens = (str) => Math.ceil((str || '').length / 4);
      activeMsgs.forEach(m => { tokensUsed += estimateTokens(m.content); });

      // Trigger when active tokens exceed the threshold and there are enough messages to archive
      if (tokensUsed >= archiveThreshold && activeMsgs.length > 2) {
        setSummarizeModalOpen(true);
      }
    }
  }, [archiveMessages, activeChat, summarizeModalOpen]);

  const handleExecuteSummarization = async ({ selectedMessages, newSummarizedIndex, customTitle }) => {
    if (selectedMessages.length === 0) {
      showToast("Please select at least one message to archive.", 'info');
      return;
    }

    setIsVectorizing(true);
    try {
      let activeProfileId = '';
      try {
        const parsed = safeParseJson(activeChat.activeProfiles);
        if (parsed.length > 0) activeProfileId = parsed[0];
      } catch (err) { }

      const result = await electronAPI.executeSummarization({
        chatId: activeChat.id,
        selectedMessages,
        newSummarizedIndex,
        customTitle,
        profileId: activeProfileId
      });

      if (result && result.success) {
        // Backend already saved to DB – just refresh the frontend state
        // to pick up the complete memoryBlocks (with messages and type).
        await refreshChats(activeChat.id);
        dismissedAutoSummarizeChatsRef.current.delete(activeChat.id);
        setSummarizeModalOpen(false);
      } else {
        showToast(result?.message || "Failed to execute summarization.", 'error');
      }
    } catch (err) {
      console.error("Execute summarization error:", err);
      showToast("An error occurred during summarization.", 'error');
    } finally {
      setIsVectorizing(false);
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

  // Set default profile when activeChat loads, ensuring the target exists in current profiles/workflows
  useEffect(() => {
    if (activeChat) {
      const activeProfs = safeParseJson(activeChat.activeProfiles).filter(id => id && id !== 'undefined');
      const activeWfs = safeParseJson(activeChat.activeWorkflows).filter(id => id && id !== 'undefined');

      const validActiveProf = activeProfs.find(id => writingProfiles.some(p => p.id === id));
      const validActiveWf = activeWfs.find(id => workflows.some(w => w.id === id));

      if (validActiveProf) {
        setSelectedTargetId(validActiveProf);
      } else if (validActiveWf) {
        setSelectedTargetId(validActiveWf);
      } else {
        setSelectedTargetId('');
      }
    }
  }, [activeChat, writingProfiles, workflows]);

  if (!activeChat) return null;

  // Filter dropdown choices based on chat settings
  const activeProfilesList = safeParseJson(activeChat.activeProfiles);
  const activeWorkflowsList = safeParseJson(activeChat.activeWorkflows);

  const allowedProfiles = writingProfiles.filter(p => activeProfilesList.includes(p.id));
  const allowedWorkflows = workflows.filter(wf => activeWorkflowsList.includes(wf.id));

  // Only show the active ones. No fallback to all if active settings are empty.
  const displayProfiles = allowedProfiles;
  const displayWorkflows = allowedWorkflows;

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

  const handleSend = (inputValue) => {
    const text = inputValue.trim();
    if (!text && pendingFiles.length === 0) return false;

    const attachedNames = pendingFiles.map(f => f.name);
    let finalContent = text;
    if (!text && attachedNames.length > 0) {
      finalContent = `Attached files: ${attachedNames.join(', ')}`;
    }

    const finalTargetId = getGenerationTargetId();
    if (!finalTargetId) return false;

    handleSendMessage(finalContent, finalTargetId, pendingFiles);
    setPendingFiles([]);
    return true;
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
    if (!e.target.closest('.three-dots-button')) {
      setOpenMenuId(null);
    }
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

  // Custom visual background image resolution
  const isCurrentRoleplayMode = roleplayWorkspaceId === activeChat.id && roleplayMode;
  const effectiveBackground = isCurrentRoleplayMode && activeSubView === 'chat' && roleplayBackground?.imagePath
    ? roleplayBackground.imagePath
    : activeChat.backgroundImage;
  const hasBg = effectiveBackground && effectiveBackground.trim() !== '';

  const backdropStyle = {
    backgroundColor: '#011419',
    opacity: (activeChat.backdropOpacity ?? 75) / 100
  };

  const bgStyle = hasBg ? {
    backgroundImage: `url("app-file:///${effectiveBackground.replace(/\\/g, '/')}")`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat'
  } : {};

  const isDocumentMode = settings?.interface?.layout === 'document';

  // Active context usage bar (optional, shown at the top of the chat)
  const ctxThreshold = activeChat.archiveThreshold || 60000;
  const ctxStartIndex = activeChat.summarizedIndex || 0;
  let ctxTokens = 0;
  archiveMessages.slice(ctxStartIndex).forEach(m => { ctxTokens += Math.ceil((m.content || '').length / 4); });
  const ctxPercentage = Math.min((ctxTokens / ctxThreshold) * 100, 100);

  const generatingBubbleStyle = isDocumentMode ? {
    backgroundColor: `rgba(10, 22, 29, ${(activeChat.aiBubbleOpacity ?? 0) / 100})`,
    border: '1px solid rgba(251, 203, 45, 0.15)',
    padding: '1.25rem',
    borderRadius: '0.75rem',
    boxShadow: '0 0 15px rgba(251, 203, 45, 0.03)'
  } : {
    backgroundColor: `rgba(10, 22, 29, ${(activeChat.aiBubbleOpacity ?? 0) / 100})`,
    border: '1px solid rgba(251, 203, 45, 0.15)',
    backdropFilter: 'blur(12px)',
    WebkitBackdropFilter: 'blur(12px)',
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
          <div className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-black/60 backdrop-blur-md border-2 border-dashed border-accent/40 m-4 rounded-xl pointer-events-none animate-in fade-in duration-200">
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
              ['chat', 'Workspace', MessageSquare],
              ['writing', 'Writing', PenTool],
              ['worldbuild', 'Worldbuild', Globe],
              ['memory', 'Memory', Brain],
              ['files', 'Files', Folder],
            ].map(([id, label, Icon]) => (
              <button
                key={id}
                type="button"
                onClick={() => setActiveSubView(id)}
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

          <div className="flex-1 flex justify-end ml-4">
            <button
              onClick={() => setActiveSubView('configuration')}
              className={`inline-flex min-h-8 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${activeSubView === 'configuration'
                ? 'text-accent bg-accent/10'
                : 'text-text-muted hover:text-text-primary hover:bg-white/5'
                }`}
            >
              <Sliders className="h-4 w-4" />
              <span>Configuration</span>
            </button>
          </div>
        </div>

        {/* Active context usage bar under the header (chat only, when enabled) */}
        {activeSubView === 'chat' && activeChat.showContextBar === 1 && (
          <div className="h-1 w-full bg-gray-800/50 shrink-0 relative z-10" title={`Active context: ~${ctxTokens} / ${ctxThreshold} tokens`}>
            <div
              style={{ width: `${ctxPercentage}%` }}
              className={`h-full transition-all duration-500 ease-out ${ctxPercentage >= 95 ? 'bg-red-500' : ctxPercentage >= 75 ? 'bg-orange-500' : 'bg-accent'}`}
            />
          </div>
        )}

        {activeSubView === 'chat' ? (
          <>
            {/* Message Container Thread */}
            <div
              ref={messageContainerRef}
              onClick={handleContainerClick}
              onScroll={updateFollowingLatest}
              className={`flex-1 overflow-y-auto pt-6 pb-28 px-12 md:px-24 custom-scrollbar space-y-6 ${isCurrentRoleplayMode && !roleplayPanelCollapsed ? 'xl:px-20 2xl:px-28' : isCurrentRoleplayMode ? 'xl:px-40 2xl:px-72' : 'xl:px-48'}`}
            >
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
              {activeMessages.map((msg, index) => {
                const isUser = msg.role === 'user';
                const sizeClass = settings?.interface?.fontSize === 'small'
                  ? 'text-xs'
                  : settings?.interface?.fontSize === 'large'
                    ? 'text-base'
                    : 'text-sm';
                const isDocumentMode = settings?.interface?.layout === 'document';

                // Safely parse msg.attachedFiles
                const filesArray = Array.isArray(msg.attachedFiles)
                  ? msg.attachedFiles
                  : (typeof msg.attachedFiles === 'string'
                    ? safeParseJson(msg.attachedFiles)
                    : []);

                const isAutoGenerated = filesArray.length > 0 && (() => {
                  const attachedNames = filesArray.map(f => f.name);
                  const expected = `Attached files: ${attachedNames.join(', ')}`;
                  return msg.content === expected;
                })();

                // Layout classes for bubble opacity settings
                const userBubbleStyle = isDocumentMode ? {
                  backgroundColor: `rgba(26, 45, 50, ${(activeChat.userBubbleOpacity ?? 100) / 100})`,
                  border: '1px solid rgba(221, 186, 110, 0.15)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)',
                  padding: '1.25rem',
                  borderRadius: '0.75rem'
                } : {
                  backgroundColor: `rgba(26, 45, 50, ${(activeChat.userBubbleOpacity ?? 100) / 100})`,
                  border: '1px solid rgba(221, 186, 110, 0.15)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)'
                };

                const aiBubbleStyle = isDocumentMode ? {
                  backgroundColor: `rgba(10, 22, 29, ${(activeChat.aiBubbleOpacity ?? 0) / 100})`,
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                  padding: '1.25rem',
                  borderRadius: '0.75rem'
                } : {
                  backgroundColor: `rgba(10, 22, 29, ${(activeChat.aiBubbleOpacity ?? 0) / 100})`,
                  border: '1px solid rgba(255, 255, 255, 0.05)',
                  backdropFilter: 'blur(12px)',
                  WebkitBackdropFilter: 'blur(12px)'
                };

                return (
                  <div
                    key={msg.id}
                    data-chat-message-id={msg.id}
                    className={`flex flex-col ${isUser && !isDocumentMode ? 'items-end' : 'items-start'} w-full`}
                  >
                    <div className={`flex w-full ${isUser && !isDocumentMode ? 'justify-end' : 'justify-start'}`}>
                      {isUser ? (
                        <div className={`flex flex-col ${isUser && !isDocumentMode ? 'items-end' : 'items-start'} ${isDocumentMode || editingMessageId === msg.id ? 'w-full' : 'max-w-[80%]'}`}>

                          {/* Attached files preview above the user bubble box */}
                          {filesArray && filesArray.length > 0 && (
                            <div className={`flex flex-wrap gap-2 mb-2 select-none ${isDocumentMode ? 'justify-start w-full' : 'justify-end w-full'}`}>
                              {filesArray.map(file => {
                                const fileUrl = file.path ? `app-file:///${encodeURI(file.path.replace(/\\/g, '/'))}` : '';
                                const hasThumbnail = isImage(file.name) || isVideo(file.name);
                                return (
                                  <div
                                    key={file.name}
                                    className="flex items-center space-x-2 bg-[#1a2d32]/45 backdrop-blur-sm border border-gray-800/80 rounded-xl p-1.5 text-[0.625rem] text-gray-300 shadow-md"
                                  >
                                    {isImage(file.name) && (
                                      <img
                                        src={fileUrl}
                                        alt="preview"
                                        className="w-8 h-8 object-cover rounded-lg border border-gray-700/50 shrink-0"
                                      />
                                    )}
                                    {isVideo(file.name) && (
                                      <video
                                        src={fileUrl}
                                        className="w-8 h-8 object-cover rounded-lg border border-gray-700/50 shrink-0"
                                        muted
                                      />
                                    )}
                                    {!hasThumbnail && (
                                      <div className="w-8 h-8 bg-[#051116] border border-gray-800 rounded-lg flex items-center justify-center text-gray-500 shrink-0">
                                        <Paperclip className="w-3.5 h-3.5" />
                                      </div>
                                    )}
                                    <div className="flex flex-col min-w-0 max-w-[80px]">
                                      <span className="truncate text-[0.5625rem] font-bold text-gray-100" title={file.name}>{file.name}</span>
                                      <span className="text-[0.4375rem] text-gray-500 font-mono mt-0.5">{(file.size / 1024).toFixed(0)} KB</span>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}

                          {/* User Message Bubble */}
                          {!isAutoGenerated && (
                            <div
                              style={userBubbleStyle}
                              className={`rounded-2xl border text-gray-200 shadow-sm relative group max-w-full ${sizeClass} ${editingMessageId === msg.id ? 'w-full' : ''} ${isDocumentMode ? 'p-5 w-full text-left' : 'p-3 text-right'
                                }`}
                            >
                              {editingMessageId === msg.id ? (
                                <div className="flex flex-col gap-3 text-left w-full">
                                  <textarea
                                    value={editingMessageText}
                                    onChange={(e) => setEditingMessageText(e.target.value)}
                                    autoFocus
                                    className={`bg-[#051116] border border-gray-700/70 rounded-xl px-3.5 py-3 ${sizeClass} leading-relaxed text-white placeholder-gray-600 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40 w-full min-h-[7rem] resize-none shadow-inner`}
                                  />
                                  <div className="flex justify-end items-center gap-2 select-none">
                                    <button
                                      onClick={() => setEditingMessageId(null)}
                                      className="px-3 py-1.5 text-[0.625rem] font-bold uppercase tracking-wider text-gray-400 hover:text-white transition-colors"
                                    >
                                      Cancel
                                    </button>
                                    {editingMessageText !== (isAutoGenerated ? '' : msg.content) && (
                                      <button
                                        onClick={async () => {
                                          const targetId = getGenerationTargetId();
                                          if (!targetId) return;
                                          setEditingMessageId(null);
                                          setEditError(null);
                                          await handleEditUserMessage(msg.id, editingMessageText, targetId);
                                        }}
                                        className="px-4 py-1.5 text-[0.625rem] font-bold uppercase tracking-wider bg-accent text-[#011419] rounded-lg shadow-sm hover:brightness-110 transition-all active:scale-95"
                                      >
                                        Save & Regenerate
                                      </button>
                                    )}
                                  </div>
                                </div>
                              ) : (
                                <MessageMarkdown content={msg.content} className="select-text text-left markdown-content leading-relaxed" />
                              )}
                            </div>
                          )}

                          {/* User Actions (Copy, Edit, 3-dots) */}
                          {editingMessageId !== msg.id && (
                            <div className="flex items-center space-x-2 px-2 py-1 backdrop-blur-[2px] rounded-lg text-[0.5625rem] font-bold uppercase tracking-wider select-none shrink-0 group">
                              <button
                                onClick={() => {
                                  copyText(msg.content);
                                  setCopiedId(msg.id);
                                  setTimeout(() => setCopiedId(null), 2000);
                                }}
                                className="flex items-center space-x-1 text-gray-300 hover:text-accent transition-colors cursor-pointer"
                              >
                                <Copy className="w-3 h-3 transition-colors" />
                                <span>{copiedId === msg.id ? 'Copied' : 'Copy'}</span>
                              </button>
                              {isLastUserMsg(msg.id) && (
                                <>
                                  <span className="text-gray-600">|</span>
                                  <button
                                    onClick={() => {
                                      setEditingMessageId(msg.id);
                                      setEditingMessageText(isAutoGenerated ? '' : msg.content);
                                    }}
                                    className="flex items-center space-x-1 text-gray-300 hover:text-accent transition-colors cursor-pointer"
                                  >
                                    <Edit className="w-3 h-3 transition-colors" />
                                    <span>Edit</span>
                                  </button>
                                </>
                              )}
                              <span className="text-gray-600">|</span>
                              <div className="relative">
                                <button
                                  ref={openMenuId === msg.id ? messageMenuAnchorRef : null}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenMenuId(openMenuId === msg.id ? null : msg.id);
                                  }}
                                  className="flex items-center text-gray-300 hover:text-accent transition-colors cursor-pointer three-dots-button"
                                >
                                  <MoreVertical className="w-3 h-3 transition-colors" />
                                </button>
                                <Popover anchorRef={messageMenuAnchorRef} open={openMenuId === msg.id} onClose={() => setOpenMenuId(null)} matchAnchorWidth={false} align="right" maxHeight={160} scroll={false} className="w-44 py-1 text-left text-[0.625rem] font-bold uppercase tracking-wider">
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setOpenMenuId(null);
                                        setConfirmDeleteData({ type: 'delete_msg', messageId: msg.id });
                                      }}
                                      className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-white/5 hover:text-red-400 transition-colors flex items-center space-x-1.5 cursor-pointer"
                                    >
                                      <Trash2 className="w-3.5 h-3.5 text-inherit" />
                                      <span>Delete Message</span>
                                    </button>
                                    <button
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setOpenMenuId(null);
                                        setConfirmDeleteData({ type: 'revert_chat', messageId: msg.id });
                                      }}
                                      className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-white/5 hover:text-accent transition-colors flex items-center space-x-1.5 cursor-pointer"
                                    >
                                      <RotateCcw className="w-3.5 h-3.5 text-inherit" />
                                      <span>Revert Chat Here</span>
                                    </button>
                                </Popover>
                              </div>
                            </div>
                          )}

                        </div>
                      ) : (
                        (() => {
                          const { thinking, response } = parseMessageContent(msg.content);
                          const debugObj = safeParseDebugNotice(msg.debugNotice);

                          return (
                            <div className={`flex flex-col items-start ${isDocumentMode || editingMessageId === msg.id ? 'w-full' : 'max-w-[80%]'}`}>

                              {settings.advanced.tokenDebug && (debugObj?.usage || debugObj?.tokens) && (() => {
                                const usage = debugObj.usage;
                                const legacy = debugObj.tokens;
                                const legacyUsage = legacy || {};
                                const input = usage
                                  ? usage.total.input
                                  : (legacyUsage.totalInput || 0) + (legacyUsage.agenticInput || 0);
                                const output = usage
                                  ? usage.total.output
                                  : (legacyUsage.output || 0) + (legacyUsage.agenticOutput || 0);
                                const total = usage ? usage.total.total : input + output;
                                const isExpanded = Boolean(expandedTokenUsage[msg.id]);
                                return (
                                  <div className="mb-1.5 ml-1 max-w-full font-mono text-[0.625rem] text-gray-400">
                                    <button
                                      type="button"
                                      aria-expanded={isExpanded}
                                      onClick={() => setExpandedTokenUsage(previous => ({
                                        ...previous,
                                        [msg.id]: !previous[msg.id]
                                      }))}
                                      className="inline-flex max-w-full items-center gap-2.5 rounded-md border border-white/[0.07] bg-black/25 px-2 py-0.5 text-left tracking-[0.06em] hover:border-white/15"
                                    >
                                      <span className="uppercase text-gray-600">Tokens · {usage?.accuracy || 'legacy estimate'}</span>
                                      <span><span className="text-gray-600">In</span> <strong className="font-semibold text-accent/90">{input.toLocaleString()}</strong></span>
                                      <span><span className="text-gray-600">Out</span> <strong className="font-semibold text-accent/90">{output.toLocaleString()}</strong></span>
                                      <span><span className="text-gray-600">Total</span> {total.toLocaleString()}</span>
                                      <ChevronDown className={`h-2.5 w-2.5 shrink-0 text-gray-600 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                                    </button>
                                    {isExpanded && (
                                      <div className="mt-1 grid w-fit max-w-full grid-cols-[auto_auto_auto] gap-x-4 gap-y-1 rounded-lg border border-gray-800 bg-[#051116] px-3 py-2 text-[0.625rem] text-gray-400">
                                        <span className="font-bold text-gray-300">Lifecycle</span>
                                        <span className="font-bold text-gray-300">Input</span>
                                        <span className="font-bold text-gray-300">Output</span>
                                        <span>Main generation</span>
                                        <span>{(usage?.main.input ?? legacyUsage.totalInput ?? 0).toLocaleString()}</span>
                                        <span>{(usage?.main.output ?? legacyUsage.output ?? 0).toLocaleString()}</span>
                                        {(usage?.agentic.total ?? ((legacyUsage.agenticInput || 0) + (legacyUsage.agenticOutput || 0))) > 0 && (
                                          <>
                                            <span>Agentic retrieval</span>
                                            <span>{(usage?.agentic.input ?? legacyUsage.agenticInput ?? 0).toLocaleString()}</span>
                                            <span>{(usage?.agentic.output ?? legacyUsage.agenticOutput ?? 0).toLocaleString()}</span>
                                          </>
                                        )}
                                        {usage?.narrativeState.total > 0 && (
                                          <>
                                            <span>Narrative State</span>
                                            <span>{usage.narrativeState.input.toLocaleString()}</span>
                                            <span>{usage.narrativeState.output.toLocaleString()}</span>
                                          </>
                                        )}
                                        <span className="col-span-3 mt-1 border-t border-gray-800 pt-1 text-gray-500">
                                          Main input: System {(usage?.main.systemInstructions ?? 0).toLocaleString()} · Context {(usage?.main.narrativeContext ?? legacyUsage.knowledgeBase ?? 0).toLocaleString()} · History {(usage?.main.chatHistory ?? legacyUsage.chatHistory ?? 0).toLocaleString()} · Message {(usage?.main.userInput ?? 0).toLocaleString()}
                                        </span>
                                      </div>
                                    )}
                                  </div>
                                );
                              })()}

                              <MessageDiagnostics
                                messageId={msg.id}
                                settings={settings}
                                debug={debugObj}
                                activeKey={expandedDiagnostic[msg.id]}
                                onToggle={key => setExpandedDiagnostic(previous => ({
                                  ...previous,
                                  [msg.id]: previous[msg.id] === key ? null : key
                                }))}
                                onCopyAgentic={handleCopyRagContext}
                                onCopyRetrieval={handleCopyStandardRag}
                                onCopyNarrative={handleCopyNarrativeState}
                                copiedAgentic={copiedRagId === msg.id}
                                copiedRetrieval={copiedStandardRagId === msg.id}
                                copiedNarrative={copiedNarrativeStateId === msg.id}
                              />

                              {/* Legacy RAG Context Warning Header */}
                              {settings.advanced.ragDebug && (debugObj?.legacyText || debugObj?.workflowStatus) && (
                                <div className="text-[0.5625rem] text-gray-500 font-mono mb-1 ml-1.5 select-none uppercase tracking-wider">
                                  ℹ️ {debugObj.legacyText || debugObj.workflowStatus}
                                </div>
                              )}

                              {/* AI Bubble */}
                              <div
                                style={aiBubbleStyle}
                                className={`rounded-2xl border text-gray-200 shadow-sm relative overflow-hidden group max-w-full ${sizeClass} ${editingMessageId === msg.id ? 'w-full' : ''} ${isDocumentMode ? 'p-5 w-full text-left' : 'p-3'
                                  }`}
                              >
                                {editingMessageId === msg.id ? (
                                  <div className="flex flex-col gap-3 text-left w-full">
                                    <textarea
                                      value={editingMessageText}
                                      onChange={(e) => setEditingMessageText(e.target.value)}
                                      autoFocus
                                      className={`bg-[#051116] border border-gray-700/70 rounded-xl px-3.5 py-3 ${sizeClass} leading-relaxed text-white placeholder-gray-600 focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/40 w-full min-h-[10rem] resize-none shadow-inner`}
                                    />
                                    <div className="flex justify-end items-center gap-2 select-none">
                                      <button
                                        onClick={() => setEditingMessageId(null)}
                                        className="px-3 py-1.5 text-[0.625rem] font-bold uppercase tracking-wider text-gray-400 hover:text-white transition-colors"
                                      >
                                        Cancel
                                      </button>
                                      <button
                                        onClick={async () => {
                                          setEditingMessageId(null);
                                          const updatedMsg = { ...msg, content: editingMessageText };
                                          await electronAPI.saveMessage(updatedMsg);
                                          setActiveMessages(prev => prev.map(m => m.id === msg.id ? updatedMsg : m));
                                        }}
                                        className="px-4 py-1.5 text-[0.625rem] font-bold uppercase tracking-wider bg-accent text-[#011419] rounded-lg shadow-sm hover:brightness-110 transition-all active:scale-95"
                                      >
                                        Save
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    <RoleplayMessageFrame frame={roleplayFrames[msg.id]} />

                                    {msg.alternatives && (() => {
                                      const alts = typeof msg.alternatives === 'string' ? JSON.parse(msg.alternatives) : msg.alternatives;
                                      if (alts.length > 1) {
                                        const currentIdx = msg.alternativeIndex || 0;
                                        return (
                                          <div className="mb-2 ml-auto flex w-fit items-center space-x-1.5 rounded border border-gray-800 bg-[#011419]/70 px-1.5 py-0.5 text-[0.5rem] font-bold text-gray-400 select-none">
                                            <button
                                              disabled={currentIdx === 0}
                                              onClick={() => handleSwitchAIAlternative(msg.id, currentIdx - 1)}
                                              className="hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                                            >
                                              <ChevronLeft className="w-2.5 h-2.5" />
                                            </button>
                                            <span className="font-mono text-[0.5rem]">{currentIdx + 1}/{alts.length}</span>
                                            <button
                                              disabled={currentIdx === alts.length - 1}
                                              onClick={() => handleSwitchAIAlternative(msg.id, currentIdx + 1)}
                                              className="hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                                            >
                                              <ChevronRight className="w-2.5 h-2.5" />
                                            </button>
                                          </div>
                                        );
                                      }
                                      return null;
                                    })()}

                                    {/* AI Thinking Collapsible Block */}
                                    {thinking && (
                                      <div className="mb-2.5 select-none border-b border-gray-800/40 pb-2">
                                        <button
                                          onClick={() => setExpandedThinking(prev => ({ ...prev, [msg.id]: !prev[msg.id] }))}
                                          className="flex items-center space-x-1.5 text-gray-500 hover:text-accent transition-colors text-[0.625rem] font-bold uppercase tracking-wider cursor-pointer"
                                        >
                                          <Brain className="w-3.5 h-3.5" />
                                          <span>{expandedThinking[msg.id] ? 'Hide Thoughts' : 'Thinking'}</span>
                                        </button>
                                        {expandedThinking[msg.id] && (
                                          <div className="mt-2 p-3 bg-white/5 border border-white/5 rounded-xl text-xs font-mono text-gray-400 italic whitespace-pre-wrap animate-in fade-in duration-200">
                                            {thinking}
                                          </div>
                                        )}
                                      </div>
                                    )}

                                    {/* AI Response with streaming typing effect */}
                                    {msg.id === lastGeneratedMessageId ? (
                                      <TypingText
                                        text={response}
                                        onComplete={() => setLastGeneratedMessageId(null)}
                                        onClick={() => setLastGeneratedMessageId(null)}
                                      />
                                    ) : (
                                      <MessageMarkdown content={response} className="leading-relaxed select-text markdown-content" />
                                    )}
                                  </>
                                )}
                              </div>

                              {/* AI Actions (Copy, Edit, Regenerate, 3-dots) */}
                              {editingMessageId !== msg.id && (
                                <div className="flex items-center space-x-2 px-2 py-1 backdrop-blur-[2px] rounded-lg text-[0.5625rem] font-bold uppercase tracking-wider select-none shrink-0 group">
                                  <button
                                    onClick={() => {
                                      copyText(response);
                                      setCopiedId(msg.id);
                                      setTimeout(() => setCopiedId(null), 2000);
                                    }}
                                    className="flex items-center space-x-1 text-gray-300 hover:text-accent transition-colors cursor-pointer"
                                  >
                                    <Copy className="w-3 h-3 transition-colors" />
                                    <span>{copiedId === msg.id ? 'Copied' : 'Copy'}</span>
                                  </button>
                                  <span className="text-gray-600">|</span>
                                  <button
                                    onClick={() => {
                                      setEditingMessageId(msg.id);
                                      setEditingMessageText(msg.content);
                                    }}
                                    className="flex items-center space-x-1 text-gray-300 hover:text-accent transition-colors cursor-pointer"
                                  >
                                    <Edit className="w-3 h-3 transition-colors" />
                                    <span>Edit</span>
                                  </button>
                                  {isLastAiMsg(msg.id) && (
                                    <>
                                      <span className="text-gray-600">|</span>
                                      <button
                                        onClick={() => {
                                          const targetId = getGenerationTargetId();
                                          if (targetId) handleRegenerateMessage(msg.id, targetId);
                                        }}
                                        className="flex items-center space-x-1 text-gray-300 hover:text-accent transition-colors cursor-pointer"
                                      >
                                        <RotateCw className="w-3 h-3 transition-colors" />
                                        <span>Regenerate</span>
                                      </button>
                                    </>
                                  )}
                                  <span className="text-gray-600">|</span>
                                  <div className="relative">
                                    <button
                                      ref={openMenuId === msg.id ? messageMenuAnchorRef : null}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setOpenMenuId(openMenuId === msg.id ? null : msg.id);
                                      }}
                                      className="flex items-center text-gray-300 hover:text-accent transition-colors cursor-pointer three-dots-button"
                                    >
                                      <MoreVertical className="w-3 h-3 transition-colors" />
                                    </button>
                                    <Popover anchorRef={messageMenuAnchorRef} open={openMenuId === msg.id} onClose={() => setOpenMenuId(null)} matchAnchorWidth={false} align="right" maxHeight={160} scroll={false} className="w-44 py-1 text-left text-[0.625rem] font-bold uppercase tracking-wider">
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setOpenMenuId(null);
                                            setConfirmDeleteData({ type: 'delete_msg', messageId: msg.id });
                                          }}
                                          className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-white/5 hover:text-red-400 transition-colors flex items-center space-x-1.5 cursor-pointer"
                                        >
                                          <Trash2 className="w-3.5 h-3.5 text-inherit" />
                                          <span>Delete Message</span>
                                        </button>
                                        <button
                                          onClick={(e) => {
                                            e.stopPropagation();
                                            setOpenMenuId(null);
                                            setConfirmDeleteData({ type: 'revert_chat', messageId: msg.id });
                                          }}
                                          className="w-full text-left px-3 py-1.5 text-gray-300 hover:bg-white/5 hover:text-accent transition-colors flex items-center space-x-1.5 cursor-pointer"
                                        >
                                          <RotateCcw className="w-3.5 h-3.5 text-inherit" />
                                          <span>Revert Chat Here</span>
                                        </button>
                                    </Popover>
                                  </div>
                                </div>
                              )}

                            </div>
                          );
                        })()
                      )}
                    </div>
                  </div>
                );
              })}

              {/* Workflow runner progress banner */}
              {isGenerating && generationProgress && (
                <div
                  style={generatingBubbleStyle}
                  className="flex flex-col w-full items-start rounded-2xl p-4 relative overflow-hidden select-none animate-in fade-in slide-in-from-bottom-2 duration-300"
                >
                  <div className="flex flex-col space-y-1.5 w-full pl-4">
                    {/* Left accent color bar with custom glow and curved caps */}
                    <div
                      className="absolute top-0 left-0 bottom-0 w-1 bg-accent rounded-r-md animate-pulse shadow-[0_0_8px_#FBCB2D]"
                    />

                    {/* Top Right Floating Brain Icon for high-end feel */}
                    <div className="absolute top-4 right-4 text-accent/20">
                      <Brain className="w-5 h-5 animate-pulse" />
                    </div>

                    {/* Header info */}
                    <div className="flex items-center justify-between shrink-0">
                      <div className="flex items-center space-x-2">
                        <span className="text-[0.625rem] font-extrabold uppercase tracking-widest text-[#ddba6e] drop-shadow">
                          [{generationProgress.step || 1}/{generationProgress.totalSteps || 1}] {generationProgress.profileName || 'Thinking'}
                        </span>
                      </div>
                    </div>

                    {(streamingContent || streamingReasoning) ? (
                      <div className="flex flex-col space-y-2 pt-1 w-full">
                        {streamingReasoning && (
                          <div className="text-xs italic text-gray-500 whitespace-pre-wrap border-l border-accent/20 pl-2.5 max-h-48 overflow-y-auto custom-scrollbar">
                            {streamingReasoning}
                          </div>
                        )}
                        {streamingContent && (
                          <div className="relative">
                            <div className="whitespace-pre-wrap leading-relaxed">{streamingContent}</div>
                            <span className="inline-block w-1.5 h-4 -mb-0.5 bg-accent/70 animate-pulse rounded-sm" />
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="flex items-center space-x-2.5 pt-0.5">
                        <RotateCw className="w-3.5 h-3.5 animate-spin text-accent shrink-0" />
                        <span className="text-xs font-semibold text-accent animate-pulse tracking-wide">
                          {generationProgress.status || 'Thinking...'}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {hasCompletedResponseBelow && !isFollowingLatest && (
              <button
                type="button"
                onClick={scrollToLatest}
                className="absolute right-6 bottom-28 z-20 flex items-center gap-2 rounded-full border border-accent/35 bg-[#0a161d]/95 px-3 py-2 text-[0.625rem] font-bold uppercase tracking-wider text-accent shadow-lg shadow-black/30 backdrop-blur-md transition-colors hover:bg-accent hover:text-[#011419]"
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
                        className="flex items-center space-x-2.5 bg-[#0a161d]/90 backdrop-blur-md border border-gray-800/80 rounded-xl p-2 text-xs text-gray-300 relative group pr-4 shadow-lg"
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
                          className="absolute -top-1.5 -right-1.5 bg-red-500 hover:bg-red-600 text-white rounded-full p-0.5 shadow-md shadow-black/40 hover:scale-105 transition-all cursor-pointer shrink-0"
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
                      <Cpu className="w-3.5 h-3.5" />
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
                    onSend={handleSendWithLatestFollow}
                    pendingFileCount={pendingFiles.length}
                    placeholder={activeMessages.length > 0 ? "Write a message..." : "Write a message or drag and drop files..."}
                    workspaceId={activeChat.id}
                  />

                </div>

              </div>
            </div>
          </>
        ) : activeSubView === 'memory' ? (
          <ChatMemoryView
            chat={activeChat}
            onSaveChat={handleSaveChat}
            electronAPI={electronAPI}
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

      </div>

      {isCurrentRoleplayMode && activeSubView === 'chat' && (
        <RoleplayQuickPanel
          key={activeChat.id}
          workspaceId={activeChat.id}
          api={electronAPI}
          showToast={showToast}
          initialCollapsed={roleplayPanelCollapsed}
          narrativeStateProcessing={isGenerating && generationProgress?.chatId === activeChat.id && generationProgress?.phase === 'narrative-state'}
          onBackgroundChange={handleRoleplayBackgroundChange}
          onCollapsedChange={handleRoleplayPanelCollapsedChange}
          onOpenConfiguration={openRoleplayConfiguration}
        />
      )}

      {/* Floating Error modal for failed message edit */}
      {editError && (
        <div className="absolute bottom-28 right-6 w-80 bg-[#1a0a0d] border border-red-950/60 rounded-xl p-4 shadow-[0_0_20px_rgba(0,0,0,0.6)] z-50 animate-in fade-in slide-in-from-bottom-5 duration-300 flex flex-col space-y-3">
          <div className="flex items-start justify-between">
            <div className="flex items-center space-x-2 text-red-400">
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
              className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-[0.625rem] font-bold uppercase hover:scale-[1.02] active:scale-95 transition-all cursor-pointer"
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
        messages={archiveMessages}
        currentSummarizedIndex={activeChat.summarizedIndex || 0}
        memoryBlocksCount={activeChat.memoryBlocks ? (typeof activeChat.memoryBlocks === 'string' ? JSON.parse(activeChat.memoryBlocks) : activeChat.memoryBlocks).length : 0}
        onConfirm={handleExecuteSummarization}
        isVectorizing={isVectorizing}
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
