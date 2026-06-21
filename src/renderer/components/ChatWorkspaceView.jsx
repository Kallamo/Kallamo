import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { ArrowLeft, Sliders, Paperclip, Send, Cpu, Workflow, X, MoreVertical, Copy, Edit, RotateCw, Play, Square, ChevronDown, Plus, ChevronLeft, ChevronRight, Brain, Folder, MessageSquare, Trash2, RotateCcw } from 'lucide-react';
import RightSidebar from './RightSidebar';
import SummarizeModal from './modals/SummarizeModal';
import ChatFilesView from './ChatFilesView';
import ChatMemoryView from './ChatMemoryView';
import FilePreviewModal from './modals/FilePreviewModal';
import DeleteModal from './modals/DeleteModal';
import { parseMarkdown } from '../utils/markdown';

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

const parseMessageContent = (content) => {
  if (!content) return { thinking: '', response: '' };

  // Match both <thinking>...</thinking> and <think>...</think> (case-insensitive)
  const thinkingRegex = /<think(?:ing)?>([\s\S]*?)<\/think(?:ing)?>/i;
  const match = thinkingRegex.exec(content);

  if (match) {
    const thinking = match[1].trim();
    const response = content.replace(thinkingRegex, '').trim();
    return { thinking, response };
  }

  // Handle partial/unclosed <thinking> or <think> streams
  const partialMatch = content.match(/<think(?:ing)?>/i);
  if (partialMatch) {
    const parts = content.split(partialMatch[0]);
    const before = parts[0].trim();
    const thinking = (parts[1] || '').trim();
    return { thinking, response: before };
  }

  return { thinking: '', response: content };
};

const TypingText = ({ text, onComplete, onClick }) => {
  const [displayedText, setDisplayedText] = useState('');

  useEffect(() => {
    if (!text) {
      setDisplayedText('');
      if (onComplete) onComplete();
      return;
    }

    const words = text.split(/(\s+)/);
    const totalWords = words.length;

    const maxDurationMs = 500;
    const tickMs = 16;
    const totalTicks = maxDurationMs / tickMs;
    const wordsPerTick = Math.max(1, Math.ceil(totalWords / totalTicks));

    let currentIdx = 0;
    setDisplayedText('');

    const interval = setInterval(() => {
      if (currentIdx < totalWords) {
        const nextIdx = Math.min(totalWords, currentIdx + wordsPerTick);
        const chunk = words.slice(0, nextIdx).join('');
        setDisplayedText(chunk);
        currentIdx = nextIdx;
      } else {
        clearInterval(interval);
        if (onComplete) onComplete();
      }
    }, tickMs);

    return () => clearInterval(interval);
  }, [text]);

  return (
    <div onClick={onClick} className="cursor-pointer select-text" title="Click to skip typing effect">
      <div
        className="leading-relaxed markdown-content"
        dangerouslySetInnerHTML={{ __html: parseMarkdown(displayedText) }}
      />
    </div>
  );
};

export default function ChatWorkspaceView() {
  const {
    activeChat,
    activeMessages,
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
    settings,
    electronAPI,
    editError,
    setEditError,
    handleSaveChat,
    refreshChats,
    lastGeneratedMessageId,
    setLastGeneratedMessageId,
    setActiveMessages
  } = useApp();

  const [inputValue, setInputValue] = useState('');
  const [isHoveringSend, setIsHoveringSend] = useState(false);
  const [profileDropdownOpen, setProfileDropdownOpen] = useState(false);
  const [selectedTargetId, setSelectedTargetId] = useState(''); // Selected profile or workflow ID
  const [rightSidebarOpen, setRightSidebarOpen] = useState(false);

  const [expandedUserMessages, setExpandedUserMessages] = useState({});
  const [expandedThinking, setExpandedThinking] = useState({});
  const [expandedAgenticRag, setExpandedAgenticRag] = useState({});
  const [expandedStandardRag, setExpandedStandardRag] = useState({});

  const [editingMessageId, setEditingMessageId] = useState(null);
  const [editingMessageText, setEditingMessageText] = useState('');

  const [copiedId, setCopiedId] = useState(null);
  const [copiedRagId, setCopiedRagId] = useState(null);
  const [copiedStandardRagId, setCopiedStandardRagId] = useState(null);

  const [openMenuId, setOpenMenuId] = useState(null);

  const [confirmDeleteData, setConfirmDeleteData] = useState(null);
  const [deleteAttachedFiles, setDeleteAttachedFiles] = useState(true);

  const [pendingFiles, setPendingFiles] = useState([]);

  const [isDragging, setIsDragging] = useState(false);
  const dragCounter = useRef(0);

  const [summarizeModalOpen, setSummarizeModalOpen] = useState(false);
  const [isVectorizing, setIsVectorizing] = useState(false);

  const [activeSubView, setActiveSubView] = useState('chat'); // 'chat' | 'memory' | 'files'
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
  const dropdownRef = useRef(null);
  const fileInputRef = useRef(null);
  const inputRef = useRef(null);

  // Helper filters for message actions
  const userMessages = activeMessages.filter(m => m.role === 'user');
  const lastUserMsg = userMessages[userMessages.length - 1];

  const aiMessages = activeMessages.filter(m => m.role === 'ai');
  const lastAiMsg = aiMessages[aiMessages.length - 1];

  const isLastUserMsg = (id) => lastUserMsg && lastUserMsg.id === id;
  const isLastAiMsg = (id) => lastAiMsg && lastAiMsg.id === id;

  const needsExpansion = (text) => {
    if (!text) return false;
    return text.split('\n').length > 3 || text.length > 220;
  };

  const handleCopy = (id, text) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleCopyRagContext = (id, debugObj) => {
    const textToCopy = `### Agentic RAG Response\n${debugObj.agenticRagResponse || ''}\n\n### Context Gathered\n${debugObj.agenticRagContextGathered || ''}`;
    navigator.clipboard.writeText(textToCopy);
    setCopiedRagId(id);
    setTimeout(() => setCopiedRagId(null), 2000);
  };

  const handleCopyStandardRag = (id, debugObj) => {
    navigator.clipboard.writeText(debugObj.standardRagContextGathered || '');
    setCopiedStandardRagId(id);
    setTimeout(() => setCopiedStandardRagId(null), 2000);
  };

  const isImage = (name) => /\.(png|jpe?g|gif|webp)$/i.test(name);
  const isVideo = (name) => /\.(mp4|webm|ogg)$/i.test(name);

  // Auto-grow input text area up to 5 lines
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = 'auto';
      const maxLinesHeight = 5 * 20 + 8; // ~108px
      const scrollHeight = inputRef.current.scrollHeight;
      inputRef.current.style.height = `${Math.min(scrollHeight, maxLinesHeight)}px`;
    }
  }, [inputValue]);

  // Auto-scroll to bottom of messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [activeMessages, generationProgress, isGenerating]);

  // Click outside to close custom selector dropdown
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setProfileDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

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
      if (activeChat && activeChat.id === chatId) {
        setSummarizeModalOpen(true);
      }
    });
    return () => {
      if (unsubscribe) unsubscribe();
    };
  }, [activeChat, electronAPI]);

  // Token threshold auto-trigger monitor (runs on frontend when token usage is exceeded)
  useEffect(() => {
    if (activeChat && activeChat.autoSummarize === 1 && activeMessages.length > 0 && !summarizeModalOpen) {
      const archiveThreshold = activeChat.archiveThreshold || 60000;
      const startIndex = activeChat.summarizedIndex || 0;
      const activeMsgs = activeMessages.slice(startIndex);

      let tokensUsed = 0;
      const estimateTokens = (str) => Math.ceil((str || '').length / 4);
      activeMsgs.forEach(m => { tokensUsed += estimateTokens(m.content); });

      // If active tokens exceed threshold, and we have enough messages to archive (at least 2)
      if (tokensUsed >= archiveThreshold && activeMsgs.length > 2) {
        setSummarizeModalOpen(true);
      }
    }
  }, [activeMessages, activeChat, summarizeModalOpen]);

  const handleExecuteSummarization = async ({ selectedMessages, newSummarizedIndex, customTitle }) => {
    if (selectedMessages.length === 0) {
      alert("Please select at least one message to archive.");
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
        setSummarizeModalOpen(false);
      } else {
        alert(result?.message || "Failed to execute summarization.");
      }
    } catch (err) {
      console.error("Execute summarization error:", err);
      alert("An error occurred during summarization.");
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

  const handleSend = () => {
    const text = inputValue.trim();
    if (!text && pendingFiles.length === 0) return;

    // Attachments names array
    const attachedNames = pendingFiles.map(f => f.name);
    let finalContent = text;
    if (!text && attachedNames.length > 0) {
      finalContent = `Attached files: ${attachedNames.join(', ')}`;
    }

    // Fallback to a valid target ID if the current selection is invalid
    let finalTargetId = selectedTargetId;
    const targetExists = (writingProfiles.some(p => p.id === finalTargetId) && activeProfilesList.includes(finalTargetId)) ||
                         (workflows.some(w => w.id === finalTargetId) && activeWorkflowsList.includes(finalTargetId));
    if (!finalTargetId || !targetExists) {
      const allowedProfilesList = writingProfiles.filter(p => activeProfilesList.includes(p.id));
      const allowedWorkflowsList = workflows.filter(wf => activeWorkflowsList.includes(wf.id));
      if (allowedProfilesList.length > 0) {
        finalTargetId = allowedProfilesList[0].id;
      } else if (allowedWorkflowsList.length > 0) {
        finalTargetId = allowedWorkflowsList[0].id;
      } else {
        // No active targets! Prevent sending.
        return;
      }
    }

    handleSendMessage(finalContent, finalTargetId, pendingFiles);
    setInputValue('');
    setPendingFiles([]);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
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
      const msgs = await electronAPI.getChatMessages(activeChat.id);
      setActiveMessages(msgs);
      refreshChats();
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
        navigator.clipboard.writeText(codeElement.innerText).then(() => {
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
  const hasBg = activeChat.backgroundImage && activeChat.backgroundImage.trim() !== '';

  const backdropStyle = {
    backgroundColor: '#011419',
    opacity: (activeChat.backdropOpacity ?? 75) / 100
  };

  const bgStyle = hasBg ? {
    backgroundImage: `url("app-file:///${activeChat.backgroundImage.replace(/\\/g, '/')}")`,
    backgroundSize: 'cover',
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat'
  } : {};

  const isDocumentMode = settings?.interface?.layout === 'document';

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
      {hasBg && <div style={bgStyle} className="absolute inset-0 z-0 transition-all duration-300" />}
      <div style={backdropStyle} className="absolute inset-0 z-0 transition-all duration-300" />

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
          <div className="flex items-center space-x-3 min-w-0 mr-4">
            <button
              onClick={() => setCurrentView('dashboard')}
              className="p-1.5 text-gray-400 hover:text-white hover:bg-white/10 rounded-md transition-colors mr-2 cursor-pointer shrink-0"
            >
              <ArrowLeft className="w-4.5 h-4.5" />
            </button>
            <h2 className="text-white font-semibold text-sm truncate max-w-[120px] sm:max-w-sm">
              {activeChat.title}
            </h2>

          </div>

          {/* Segmented workspace navigation sub-view switcher tabs */}
          <div className="flex bg-[#000d11]/80 p-0.5 rounded-lg border border-gray-800/60 select-none shrink-0 z-10 space-x-0.5">
            {/* Workspace Tab */}
            <button
              onClick={() => setActiveSubView('chat')}
              className={`group flex items-center h-8 rounded-md transition-all duration-300 ease-out cursor-pointer overflow-hidden ${activeSubView === 'chat'
                ? 'bg-accent text-[#011419] font-extrabold shadow-sm max-w-[130px] px-3'
                : 'text-gray-400 hover:text-white hover:bg-white/5 max-w-[32px] px-1.5 hover:max-w-[130px] hover:px-3'
                }`}
            >
              <MessageSquare className="w-4.5 h-4.5 shrink-0" />
              <span className={`text-[10px] font-bold uppercase tracking-wider transition-all duration-300 ml-0 opacity-0 group-hover:opacity-100 ${activeSubView === 'chat' ? 'opacity-100 ml-1.5 max-w-[80px]' : 'max-w-0 group-hover:ml-1.5 group-hover:max-w-[80px]'
                } overflow-hidden whitespace-nowrap`}>
                Workspace
              </span>
            </button>

            {/* Memory Tab */}
            <button
              onClick={() => setActiveSubView('memory')}
              className={`group flex items-center h-8 rounded-md transition-all duration-300 ease-out cursor-pointer overflow-hidden ${activeSubView === 'memory'
                ? 'bg-accent text-[#011419] font-extrabold shadow-sm max-w-[130px] px-3'
                : 'text-gray-400 hover:text-white hover:bg-white/5 max-w-[32px] px-1.5 hover:max-w-[130px] hover:px-3'
                }`}
            >
              <Brain className="w-4.5 h-4.5 shrink-0" />
              <span className={`text-[10px] font-bold uppercase tracking-wider transition-all duration-300 ml-0 opacity-0 group-hover:opacity-100 ${activeSubView === 'memory' ? 'opacity-100 ml-1.5 max-w-[80px]' : 'max-w-0 group-hover:ml-1.5 group-hover:max-w-[80px]'
                } overflow-hidden whitespace-nowrap`}>
                Memory
              </span>
            </button>

            {/* Files Tab */}
            <button
              onClick={() => setActiveSubView('files')}
              className={`group flex items-center h-8 rounded-md transition-all duration-300 ease-out cursor-pointer overflow-hidden ${activeSubView === 'files'
                ? 'bg-accent text-[#011419] font-extrabold shadow-sm max-w-[130px] px-3'
                : 'text-gray-400 hover:text-white hover:bg-white/5 max-w-[32px] px-1.5 hover:max-w-[130px] hover:px-3'
                }`}
            >
              <Folder className="w-4.5 h-4.5 shrink-0" />
              <span className={`text-[10px] font-bold uppercase tracking-wider transition-all duration-300 ml-0 opacity-0 group-hover:opacity-100 ${activeSubView === 'files' ? 'opacity-100 ml-1.5 max-w-[80px]' : 'max-w-0 group-hover:ml-1.5 group-hover:max-w-[80px]'
                } overflow-hidden whitespace-nowrap`}>
                Files
              </span>
            </button>
          </div>

          <button
            onClick={() => setRightSidebarOpen(!rightSidebarOpen)}
            className={`p-1.5 rounded-md transition-colors cursor-pointer shrink-0 ml-4 ${rightSidebarOpen
              ? 'text-accent bg-white/5'
              : 'text-gray-500 hover:text-white hover:bg-white/5'
              }`}
            title="Chat Settings"
          >
            <Sliders className="w-4.5 h-4.5" />
          </button>
        </div>

        {activeSubView === 'chat' ? (
          <>
            {/* Message Container Thread */}
            <div
              onClick={handleContainerClick}
              className="flex-1 overflow-y-auto pt-6 pb-28 px-12 md:px-24 xl:px-48 custom-scrollbar space-y-6"
            >
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
                    className={`flex flex-col ${isUser && !isDocumentMode ? 'items-end' : 'items-start'} w-full`}
                  >
                    <div className={`flex w-full ${isUser && !isDocumentMode ? 'justify-end' : 'justify-start'}`}>
                      {isUser ? (
                        <div className={`flex flex-col ${isUser && !isDocumentMode ? 'items-end' : 'items-start'} ${isDocumentMode ? 'w-full' : 'max-w-[80%]'}`}>

                          {/* Attached files preview above the user bubble box */}
                          {filesArray && filesArray.length > 0 && (
                            <div className={`flex flex-wrap gap-2 mb-2 select-none ${isDocumentMode ? 'justify-start w-full' : 'justify-end w-full'}`}>
                              {filesArray.map(file => {
                                const fileUrl = file.path ? `app-file:///${encodeURI(file.path.replace(/\\/g, '/'))}` : '';
                                const hasThumbnail = isImage(file.name) || isVideo(file.name);
                                return (
                                  <div
                                    key={file.name}
                                    className="flex items-center space-x-2 bg-[#1a2d32]/45 backdrop-blur-sm border border-gray-800/80 rounded-xl p-1.5 text-[10px] text-gray-300 shadow-md"
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
                                      <span className="truncate text-[9px] font-bold text-gray-100" title={file.name}>{file.name}</span>
                                      <span className="text-[7px] text-gray-500 font-mono mt-0.5">{(file.size / 1024).toFixed(0)} KB</span>
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
                              className={`rounded-2xl border text-gray-200 shadow-sm relative group max-w-full ${sizeClass} ${isDocumentMode ? 'p-5 w-full text-left' : 'p-3 text-right'
                                }`}
                            >
                              {editingMessageId === msg.id ? (
                                <div className="flex flex-col space-y-2 text-left">
                                  <textarea
                                    value={editingMessageText}
                                    onChange={(e) => setEditingMessageText(e.target.value)}
                                    className="bg-[#051116] border border-gray-800 rounded px-2 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-accent w-full min-h-[50px] resize-none"
                                  />
                                  <div className="flex justify-end space-x-2 select-none">
                                    <button
                                      onClick={() => setEditingMessageId(null)}
                                      className="px-2 py-1 text-[9px] font-bold uppercase text-gray-400 hover:text-white transition-colors"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      onClick={async () => {
                                        setEditingMessageId(null);
                                        setEditError(null);
                                        await handleEditUserMessage(msg.id, editingMessageText, selectedTargetId);
                                      }}
                                      className="px-2.5 py-1 text-[9px] font-bold uppercase bg-accent text-[#011419] rounded transition-transform active:scale-95"
                                    >
                                      Save & Regenerate
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div>
                                  <div
                                    className={`select-text text-left markdown-content leading-relaxed ${!expandedUserMessages[msg.id] && msg.content.split('\n').length > 3 ? 'line-clamp-3' : ''
                                      }`}
                                    dangerouslySetInnerHTML={{ __html: parseMarkdown(msg.content) }}
                                  />
                                  {msg.content.split('\n').length > 3 && (
                                    <button
                                      onClick={() => setExpandedUserMessages(prev => ({ ...prev, [msg.id]: !prev[msg.id] }))}
                                      className="text-[10px] font-semibold text-accent hover:underline mt-2 block cursor-pointer select-none text-left"
                                    >
                                      {expandedUserMessages[msg.id] ? 'Show Less' : 'Show More'}
                                    </button>
                                  )}
                                </div>
                              )}
                            </div>
                          )}

                          {/* User Actions (Copy, Edit, 3-dots) */}
                          {editingMessageId !== msg.id && (
                            <div className="flex items-center space-x-2 px-2 py-1 backdrop-blur-[2px] rounded-lg text-[9px] font-bold uppercase tracking-wider select-none shrink-0 group">
                              <button
                                onClick={() => {
                                  navigator.clipboard.writeText(msg.content);
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
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    setOpenMenuId(openMenuId === msg.id ? null : msg.id);
                                  }}
                                  className="flex items-center text-gray-300 hover:text-accent transition-colors cursor-pointer three-dots-button"
                                >
                                  <MoreVertical className="w-3 h-3 transition-colors" />
                                </button>
                                {openMenuId === msg.id && (
                                  <div className="absolute bottom-full right-0 mb-1 w-44 bg-[#0a161d] border border-gray-800 rounded-lg shadow-xl py-1 z-20 text-[10px] uppercase font-bold tracking-wider text-left">
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
                                  </div>
                                )}
                              </div>
                            </div>
                          )}

                        </div>
                      ) : (
                        (() => {
                          const { thinking, response } = parseMessageContent(msg.content);
                          const debugObj = safeParseDebugNotice(msg.debugNotice);

                          return (
                            <div className={`flex flex-col items-start ${isDocumentMode ? 'w-full' : 'max-w-[80%]'}`}>

                              {/* Token Usage Debug Header */}
                              {settings.advanced.tokenDebug && debugObj?.tokens && (
                                <div className="inline-flex items-center flex-wrap gap-x-1.5 gap-y-0.5 text-[9px] text-gray-300 font-mono select-none mb-2 ml-1 uppercase tracking-wide bg-[#011419] backdrop-blur-[2px] rounded-lg border border-[#011419]/20 px-2.5 py-1 max-w-full">
                                  <span>⚡ Tokens:</span>
                                  <span className="font-bold text-accent">Input: {debugObj.tokens.totalInput + (debugObj.tokens.agenticInput || 0)}</span>
                                  <span className="text-gray-500">(</span>
                                  <span>Knowledge Base: {debugObj.tokens.knowledgeBase ?? ((debugObj.tokens.profileKb || 0) + (debugObj.tokens.chatKb || 0))}</span>
                                  <span className="text-gray-500">|</span>
                                  <span>Chat History: {debugObj.tokens.chatHistory}</span>
                                  {debugObj.tokens.agenticInput > 0 && (
                                    <>
                                      <span className="text-gray-500">|</span>
                                      <span>Agentic RAG: {debugObj.tokens.agenticInput}</span>
                                    </>
                                  )}
                                  <span className="text-gray-500">)</span>
                                  <span className="text-gray-500">|</span>
                                  <span className="font-bold text-accent">Output: {debugObj.tokens.output + (debugObj.tokens.agenticOutput || 0)}</span>
                                </div>
                              )}

                              {/* Agentic RAG Debug Header */}
                              {settings.advanced.agenticDebug && debugObj?.agenticRagResponse && (
                                <div className="mb-1 ml-1.5 select-none">
                                  <div className="flex items-center space-x-2">
                                    <button
                                      onClick={() => setExpandedAgenticRag(prev => ({ ...prev, [msg.id]: !prev[msg.id] }))}
                                      className="flex items-center space-x-1 text-[9px] text-gray-500 hover:text-accent font-bold uppercase tracking-wider cursor-pointer"
                                    >
                                      <span>🔍 Agentic RAG Context</span>
                                      <ChevronDown className={`w-2.5 h-2.5 transition-transform ${expandedAgenticRag[msg.id] ? 'rotate-180' : ''}`} />
                                    </button>
                                    <span className="text-gray-800">|</span>
                                    <button
                                      onClick={() => handleCopyRagContext(msg.id, debugObj)}
                                      className="flex items-center space-x-1 text-[9px] text-gray-500 hover:text-accent font-bold uppercase tracking-wider cursor-pointer"
                                      title="Copy full RAG context to clipboard"
                                    >
                                      <Copy className="w-2.5 h-2.5 animate-pulse-slow" />
                                      <span>{copiedRagId === msg.id ? 'Copied!' : 'Copy Context'}</span>
                                    </button>
                                  </div>
                                  {expandedAgenticRag[msg.id] && (
                                    <div className="mt-1 p-3 bg-[#051116] border border-gray-800 rounded-lg text-[10px] font-mono text-gray-400 max-w-xl max-h-72 overflow-y-auto custom-scrollbar shadow-md animate-in fade-in duration-200 space-y-3">
                                      <div>
                                        <div className="text-accent font-bold uppercase tracking-wider text-[8px] mb-1">Agentic RAG Response</div>
                                        <div className="pl-2 border-l border-accent/20 text-gray-300 whitespace-pre-wrap">{debugObj.agenticRagResponse}</div>
                                      </div>
                                      {debugObj.agenticRagContextGathered && (
                                        <div>
                                          <div className="text-gray-500 font-bold uppercase tracking-wider text-[8px] mb-1">Context Gathered</div>
                                          <div className="pl-2 border-l border-gray-800 text-gray-500 whitespace-pre-wrap max-h-48 overflow-y-auto custom-scrollbar">{debugObj.agenticRagContextGathered}</div>
                                        </div>
                                      )}
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* RAG Retrieval Debug Panel (retrieved chunks + scores) */}
                              {settings.advanced.ragDebug && debugObj?.standardRagContextGathered && (
                                <div className="mb-1 ml-1.5 select-none">
                                  <div className="flex items-center space-x-2">
                                    <button
                                      onClick={() => setExpandedStandardRag(prev => ({ ...prev, [msg.id]: !prev[msg.id] }))}
                                      className="flex items-center space-x-1 text-[9px] text-gray-500 hover:text-accent font-bold uppercase tracking-wider cursor-pointer"
                                    >
                                      <span>🔬 Retrieved Chunks (RAG)</span>
                                      <ChevronDown className={`w-2.5 h-2.5 transition-transform ${expandedStandardRag[msg.id] ? 'rotate-180' : ''}`} />
                                    </button>
                                    <span className="text-gray-800">|</span>
                                    <button
                                      onClick={() => handleCopyStandardRag(msg.id, debugObj)}
                                      className="flex items-center space-x-1 text-[9px] text-gray-500 hover:text-accent font-bold uppercase tracking-wider cursor-pointer"
                                      title="Copy retrieved chunks to clipboard"
                                    >
                                      <Copy className="w-2.5 h-2.5 animate-pulse-slow" />
                                      <span>{copiedStandardRagId === msg.id ? 'Copied!' : 'Copy Chunks'}</span>
                                    </button>
                                  </div>
                                  {expandedStandardRag[msg.id] && (
                                    <div className="mt-1 p-3 bg-[#051116] border border-gray-800 rounded-lg text-[10px] font-mono text-gray-400 max-w-xl max-h-72 overflow-y-auto custom-scrollbar shadow-md animate-in fade-in duration-200">
                                      <div className="text-gray-500 whitespace-pre-wrap">{debugObj.standardRagContextGathered}</div>
                                    </div>
                                  )}
                                </div>
                              )}

                              {/* Legacy RAG Context Warning Header */}
                              {settings.advanced.ragDebug && (debugObj?.legacyText || debugObj?.workflowStatus) && (
                                <div className="text-[9px] text-gray-500 font-mono mb-1 ml-1.5 select-none uppercase tracking-wider">
                                  ℹ️ {debugObj.legacyText || debugObj.workflowStatus}
                                </div>
                              )}

                              {/* AI Bubble */}
                              <div
                                style={aiBubbleStyle}
                                className={`rounded-2xl border text-gray-200 shadow-sm relative overflow-hidden group max-w-full ${sizeClass} ${isDocumentMode ? 'p-5 w-full text-left' : 'p-3'
                                  }`}
                              >
                                {editingMessageId === msg.id ? (
                                  <div className="flex flex-col space-y-2 text-left">
                                    <textarea
                                      value={editingMessageText}
                                      onChange={(e) => setEditingMessageText(e.target.value)}
                                      className="bg-[#051116] border border-gray-800 rounded px-2 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-accent w-full min-h-[100px] resize-none font-mono"
                                    />
                                    <div className="flex justify-end space-x-2 select-none">
                                      <button
                                        onClick={() => setEditingMessageId(null)}
                                        className="px-2 py-1 text-[9px] font-bold uppercase text-gray-400 hover:text-white transition-colors"
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
                                        className="px-2.5 py-1 text-[9px] font-bold uppercase bg-accent text-[#011419] rounded transition-transform active:scale-95"
                                      >
                                        Save
                                      </button>
                                    </div>
                                  </div>
                                ) : (
                                  <>
                                    {/* Custom Alternatives switcher at top right of bubble */}
                                    {msg.alternatives && (() => {
                                      const alts = typeof msg.alternatives === 'string' ? JSON.parse(msg.alternatives) : msg.alternatives;
                                      if (alts.length > 1) {
                                        const currentIdx = msg.alternativeIndex || 0;
                                        return (
                                          <div className="absolute top-2 right-2 flex items-center space-x-1.5 bg-[#011419]/70 border border-gray-800 rounded px-1.5 py-0.5 text-[8px] font-bold text-gray-400 select-none z-10">
                                            <button
                                              disabled={currentIdx === 0}
                                              onClick={() => handleSwitchAIAlternative(msg.id, currentIdx - 1)}
                                              className="hover:text-white disabled:opacity-30 disabled:pointer-events-none transition-colors cursor-pointer"
                                            >
                                              <ChevronLeft className="w-2.5 h-2.5" />
                                            </button>
                                            <span className="font-mono text-[8px]">{currentIdx + 1}/{alts.length}</span>
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
                                          className="flex items-center space-x-1.5 text-gray-500 hover:text-accent transition-colors text-[10px] font-bold uppercase tracking-wider cursor-pointer"
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
                                      <div
                                        className="leading-relaxed select-text markdown-content"
                                        dangerouslySetInnerHTML={{ __html: parseMarkdown(response) }}
                                      />
                                    )}
                                  </>
                                )}
                              </div>

                              {/* AI Actions (Copy, Edit, Regenerate, 3-dots) */}
                              {editingMessageId !== msg.id && (
                                <div className="flex items-center space-x-2 px-2 py-1 backdrop-blur-[2px] rounded-lg text-[9px] font-bold uppercase tracking-wider select-none shrink-0 group">
                                  <button
                                    onClick={() => {
                                      navigator.clipboard.writeText(response);
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
                                        onClick={() => handleRegenerateMessage(msg.id, selectedTargetId)}
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
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        setOpenMenuId(openMenuId === msg.id ? null : msg.id);
                                      }}
                                      className="flex items-center text-gray-300 hover:text-accent transition-colors cursor-pointer three-dots-button"
                                    >
                                      <MoreVertical className="w-3 h-3 transition-colors" />
                                    </button>
                                    {openMenuId === msg.id && (
                                      <div className="absolute bottom-full right-0 mb-1 w-44 bg-[#0a161d] border border-gray-800 rounded-lg shadow-xl py-1 z-20 text-[10px] uppercase font-bold tracking-wider text-left">
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
                                      </div>
                                    )}
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
                        <span className="text-[10px] font-extrabold uppercase tracking-widest text-[#ddba6e] drop-shadow">
                          [{generationProgress.step || 1}/{generationProgress.totalSteps || 1}] {generationProgress.profileName || 'Thinking'}
                        </span>
                      </div>
                    </div>

                    {/* Progress message status */}
                    <div className="flex items-center space-x-2.5 pt-0.5">
                      <RotateCw className="w-3.5 h-3.5 animate-spin text-accent shrink-0" />
                      <span className="text-xs font-semibold text-accent animate-pulse tracking-wide">
                        {generationProgress.status || 'Thinking...'}
                      </span>
                    </div>
                  </div>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

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
                          <span className="truncate text-[10px] font-bold text-gray-100" title={file.name}>{file.name}</span>
                          <span className="text-[8px] text-gray-500 font-mono mt-0.5">{(file.size / 1024).toFixed(0)} KB</span>
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

                <div className="flex items-end w-full">
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
                    className="p-2 mb-0.5 rounded-full hover:bg-white/5 text-gray-500 hover:text-white transition-colors cursor-pointer"
                    title="Attach Files"
                  >
                    <Paperclip className="w-4 h-4" />
                  </button>

                  {/* Chat Input Text Area */}
                  <textarea
                    ref={inputRef}
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    rows={1}
                    placeholder={activeMessages && activeMessages.length > 0 ? "Write a message..." : "Write a message or drag and drop files..."}
                    style={{
                      maxHeight: '120px',
                      overflowY: 'auto'
                    }}
                    className="flex-1 bg-transparent border-0 text-white text-xs px-3 py-2.5 focus:outline-none resize-none font-sans custom-scrollbar leading-relaxed"
                  />

                  {/* Ingestion Profile Choices Dropdown */}
                  <div className="relative mb-0.5 mr-2" ref={dropdownRef}>
                    <button
                      type="button"
                      onClick={() => setProfileDropdownOpen(!profileDropdownOpen)}
                      className="px-2.5 py-1.5 rounded-lg border border-gray-800 bg-[#011419] text-gray-400 hover:text-white text-[10px] font-bold uppercase tracking-wider flex items-center space-x-1.5 cursor-pointer transition-colors"
                    >
                      <Cpu className="w-3.5 h-3.5" />
                      <span className="truncate max-w-[80px]">
                        {selectedTarget ? selectedTarget.name : 'Select a Profile'}
                      </span>
                      <ChevronDown className="w-3 h-3 text-gray-500" />
                    </button>

                    {profileDropdownOpen && (
                      <div className="absolute right-0 bottom-full mb-2 w-64 bg-[#0a161d] border border-gray-800 rounded-xl shadow-2xl p-2.5 z-30 animate-in fade-in duration-200 font-sans">
                        <span className="block text-[8px] font-bold text-gray-500 uppercase tracking-widest px-2 pb-1.5 select-none">AI Profile / Workflow</span>

                        <div className="max-h-60 overflow-y-auto custom-scrollbar space-y-2.5">
                          {/* Writing Profiles */}
                          <div>
                            <span className="block text-[7px] font-extrabold text-[#FBCB2D]/55 uppercase tracking-widest px-2 py-0.5 select-none">Profiles</span>
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
                                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                                    <span className="truncate font-sans">{p.name}</span>
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
                                    setRightSidebarOpen(true);
                                  }}
                                  className="mt-1 flex items-center space-x-1 text-[9px] font-bold text-accent hover:underline uppercase cursor-pointer"
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
                            <span className="block text-[7px] font-extrabold text-[#FBCB2D]/55 uppercase tracking-widest px-2 py-0.5 select-none">Workflows</span>
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
                                    setRightSidebarOpen(true);
                                  }}
                                  className="mt-1 flex items-center space-x-1 text-[9px] font-bold text-accent hover:underline uppercase cursor-pointer"
                                >
                                  <Plus className="w-2.5 h-2.5" />
                                  <span>Active Workflow</span>
                                </button>
                              </div>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Execution submit button */}
                  <button
                    type="button"
                    onClick={isGenerating ? handleCancelGeneration : handleSend}
                    disabled={(!isGenerating && !inputValue.trim() && pendingFiles.length === 0) || (displayProfiles.length === 0 && displayWorkflows.length === 0)}
                    onMouseEnter={() => setIsHoveringSend(true)}
                    onMouseLeave={() => setIsHoveringSend(false)}
                    className={`shrink-0 w-9 h-9 mb-0.5 rounded-full flex items-center justify-center shadow-md transition-all active:scale-95 cursor-pointer border ${isGenerating
                      ? isHoveringSend
                        ? 'bg-red-600 hover:bg-red-500 border-red-500/20 text-white hover:brightness-110'
                        : 'bg-accent/20 border-accent/40 text-accent cursor-wait'
                      : 'bg-accent border-accent text-[#011419] hover:brightness-110 disabled:opacity-50 disabled:pointer-events-none'
                      }`}
                  >
                    {isGenerating ? (
                      isHoveringSend ? (
                        <Square className="w-4 h-4 fill-current text-white" />
                      ) : (
                        <RotateCw className="w-4 h-4 animate-spin text-accent" />
                      )
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </button>
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
              className="px-2.5 py-1 text-[10px] font-bold uppercase text-gray-400 hover:text-white cursor-pointer transition-colors"
            >
              Dismiss
            </button>
            <button
              onClick={async () => {
                const { msgId, editedText, targetId } = editError;
                setEditError(null);
                await handleEditUserMessage(msgId, editedText, targetId);
              }}
              className="px-3 py-1 bg-red-600 hover:bg-red-500 text-white rounded text-[10px] font-bold uppercase hover:scale-[1.02] active:scale-95 transition-all cursor-pointer"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Right Drawer Config sidebar panel */}
      <RightSidebar
        isOpen={rightSidebarOpen}
        onClose={() => setRightSidebarOpen(false)}
        onTriggerSummarize={() => setSummarizeModalOpen(true)}
      />

      <SummarizeModal
        isOpen={summarizeModalOpen}
        onClose={() => setSummarizeModalOpen(false)}
        messages={activeMessages}
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
                setActiveMessages(prev => prev.filter(m => m.id !== msgId));
                refreshChats();
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
