import React, { createContext, useContext, useState, useEffect, useRef } from 'react';

const AppContext = createContext();

const STREAM_DISPLAY_INTERVAL_MS = 32;
const STREAM_DISPLAY_CHARACTERS_PER_TICK = 16;

export const useApp = () => useContext(AppContext);

// Helper for safe electronAPI calls
const api = window.electronAPI || {
  minimize: () => { }, maximize: () => { }, close: () => { },
  getApiProfiles: async () => [], saveApiProfile: async () => { }, deleteApiProfile: async () => { },
  getWritingProfiles: async () => [], saveWritingProfile: async () => { }, deleteWritingProfile: async () => { },
  getChats: async () => [], saveChat: async () => { }, deleteChat: async () => { }, getChatMessages: async () => [], saveMessage: async () => { }, deleteMessage: async () => { }, revertChatToMessage: async () => ({ success: true }), triggerManualSummarize: async () => { },
  getWorkflows: async () => [], saveWorkflow: async () => { }, deleteWorkflow: async () => { },
  getVariables: async () => [], saveVariable: async () => { }, deleteVariable: async () => { },
  getSettings: async () => ({
    interface: { fontFamily: 'sans', fontSize: 'medium', layout: 'bubbles', blur: true, accentColor: '#FBCB2D', codeTheme: 'github-dark', lineNumbers: false },
    advanced: { chunkSize: 500, similarity: 0.3, topKKB: 5, topKMemory: 5, executionDevice: 'cpu', ragDebug: false, agenticDebug: false, tokenDebug: false, embeddingEngine: 'local', embeddingApiProfileId: '', embeddingModelName: '' }
  }),
  saveSettings: async () => { },
  getUiFlags: async () => ({}),
  setUiFlag: async () => { },
  getWhatsNewState: async () => ({ show: false }),
  markWhatsNewSeen: async () => { },
  sendMessage: async () => { },
  cancelGeneration: () => { },
  onWorkflowProgress: () => () => { },
  onWorkflowError: () => () => { },
  onWorkflowContextOverflow: () => () => { },
  respondToError: () => { },
  respondToOverflow: () => { },
  installUpdate: () => { },
  onUpdateAvailable: () => () => { },
  onUpdateDownloaded: () => () => { },
  onReindexProgress: () => () => { },
  onUpdateOutdated: () => () => { }
};

export const AppProvider = ({ children }) => {
  // --- STATE INITIALIZATION ---
  const [currentView, setCurrentView] = useState('dashboard'); // 'dashboard', 'library', 'chat'
  const [chats, setChats] = useState([]);
  const [writingProfiles, setWritingProfiles] = useState([]);
  const [workflows, setWorkflows] = useState([]);
  const [apiProfiles, setApiProfiles] = useState([]);
  const [variables, setVariables] = useState([]);
  const [settings, setSettings] = useState({
    interface: { fontFamily: 'sans', fontSize: 'medium', layout: 'bubbles', blur: true, accentColor: '#FBCB2D', codeTheme: 'github-dark', lineNumbers: false },
    advanced: { chunkSize: 500, similarity: 0.3, topKKB: 5, topKMemory: 5, executionDevice: 'cpu', ragDebug: false, agenticDebug: false, tokenDebug: false, embeddingEngine: 'local', embeddingApiProfileId: '', embeddingModelName: '' }
  });

  // One-time UI hints (coach-marks). Keyed booleans persisted in the settings
  // table; once true, the matching hint never shows again.
  const [uiFlags, setUiFlags] = useState({});

  // What's New modal: opens once per version bump (driven by the main process),
  // and can be reopened any time from Settings → About.
  const [whatsNewOpen, setWhatsNewOpen] = useState(false);

  const [activeChatId, setActiveChatId] = useState(null);
  const [activeMessages, setActiveMessages] = useState([]);
  const [generationProgress, setGenerationProgress] = useState(null); // { step, totalSteps, profileName, status }
  const [isGenerating, setIsGenerating] = useState(false);
  const [showOverflowModal, setShowOverflowModal] = useState(false);
  const [overflowData, setOverflowData] = useState(null);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [errorData, setErrorData] = useState(null);
  const [editError, setEditError] = useState(null);
  const [lastGeneratedMessageId, setLastGeneratedMessageId] = useState(null);

  // Live-streaming buffer for the response currently being generated. Cleared
  // when generation ends (the saved message takes over). Only one runs at a time.
  const [streamingContent, setStreamingContent] = useState('');
  const [streamingReasoning, setStreamingReasoning] = useState('');
  const streamContentQueueRef = useRef('');
  const streamReasoningQueueRef = useRef('');
  const streamDisplayTimerRef = useRef(null);

  const flushStreamDisplay = () => {
    const contentDelta = streamContentQueueRef.current.slice(0, STREAM_DISPLAY_CHARACTERS_PER_TICK);
    const reasoningDelta = streamReasoningQueueRef.current.slice(0, STREAM_DISPLAY_CHARACTERS_PER_TICK);

    streamContentQueueRef.current = streamContentQueueRef.current.slice(contentDelta.length);
    streamReasoningQueueRef.current = streamReasoningQueueRef.current.slice(reasoningDelta.length);

    if (contentDelta) setStreamingContent(previous => previous + contentDelta);
    if (reasoningDelta) setStreamingReasoning(previous => previous + reasoningDelta);

    if (streamContentQueueRef.current || streamReasoningQueueRef.current) {
      streamDisplayTimerRef.current = setTimeout(flushStreamDisplay, STREAM_DISPLAY_INTERVAL_MS);
    } else {
      streamDisplayTimerRef.current = null;
    }
  };

  const enqueueStreamDisplay = ({ contentDelta, reasoningDelta }) => {
    if (contentDelta) streamContentQueueRef.current += contentDelta;
    if (reasoningDelta) streamReasoningQueueRef.current += reasoningDelta;
    if (!streamDisplayTimerRef.current) flushStreamDisplay();
  };

  const clearStreamDisplay = () => {
    streamContentQueueRef.current = '';
    streamReasoningQueueRef.current = '';
    if (streamDisplayTimerRef.current) clearTimeout(streamDisplayTimerRef.current);
    streamDisplayTimerRef.current = null;
    setStreamingContent('');
    setStreamingReasoning('');
  };

  // --- AUTO-UPDATER STATE ---
  const [updateStatus, setUpdateStatus] = useState('idle'); // 'idle' | 'available' | 'downloaded'
  const [updateVersion, setUpdateVersion] = useState('');

  // --- RAG RE-INDEX STATE ---
  const [reindexingProgress, setReindexingProgress] = useState(null); // { status, message, ... }

  // --- PLATFORM UPDATE OUTDATED STATE ---
  const [updateOutdatedUrl, setUpdateOutdatedUrl] = useState('');

  // --- LOCAL ENGINE DOWNLOADER STATE ---
  const [engineStatus, setEngineStatus] = useState({ installed: false, platform: '', arch: '' });
  const [engineDownloadProgress, setEngineDownloadProgress] = useState(null); // { status: 'idle'|'downloading'|'verifying'|'extracting'|'completed'|'error', loaded, total, percent, error }

  // --- TOAST NOTIFICATIONS ---
  const [toast, setToast] = useState(null); // { message, type: 'success' | 'error' | 'info', show: boolean, action?: { label, onClick } }
  const toastTimeoutRef = useRef(null);

  const showToast = (message, type = 'info', duration = null, action = null) => {
    // Errors linger much longer by default so they can actually be read.
    const ms = duration != null ? duration : (type === 'error' ? 14000 : 4000);
    if (toastTimeoutRef.current) {
      clearTimeout(toastTimeoutRef.current);
    }
    setToast({ message, type, show: true, action });
    toastTimeoutRef.current = setTimeout(() => {
      setToast(prev => prev ? { ...prev, show: false } : null);
    }, ms);
  };

  useEffect(() => {
    return () => {
      if (toastTimeoutRef.current) {
        clearTimeout(toastTimeoutRef.current);
      }
    };
  }, []);

  // --- INITIALIZATION ---
  const loadInitialData = async () => {
    try {
      const fetchedSettings = await api.getSettings();
      if (fetchedSettings) {
        setSettings(fetchedSettings);
        if (fetchedSettings.interface && fetchedSettings.interface.accentColor) {
          document.documentElement.style.setProperty('--app-accent', fetchedSettings.interface.accentColor);
        }
      }

      const fetchedChats = await api.getChats();
      setChats(fetchedChats);

      const fetchedProfiles = await api.getWritingProfiles();
      setWritingProfiles(fetchedProfiles);

      const fetchedWorkflows = await api.getWorkflows();
      setWorkflows(fetchedWorkflows);

      const fetchedApis = await api.getApiProfiles();
      setApiProfiles(fetchedApis);

      const fetchedVariables = await api.getVariables();
      setVariables(fetchedVariables || []);

      const fetchedFlags = await api.getUiFlags();
      setUiFlags(fetchedFlags || {});

      const whatsNew = await api.getWhatsNewState();
      if (whatsNew?.show) setWhatsNewOpen(true);

      await refreshEngineStatus();
    } catch (error) {
      console.error("Error loading initial data:", error);
    }
  };

  useEffect(() => {
    loadInitialData();
  }, []);

  // --- REALTIME ELECTRON EVENTS ---
  useEffect(() => {
    const unsubProgress = api.onWorkflowProgress((progress) => {
      setGenerationProgress(progress);
    });

    const unsubStreamToken = api.onStreamToken ? api.onStreamToken(enqueueStreamDisplay) : () => { };

    const unsubError = api.onWorkflowError((err) => {
      setErrorData(err);
      setShowErrorModal(true);
      setIsGenerating(false);
    });

    const unsubOverflow = (data) => {
      setOverflowData(data);
      setShowOverflowModal(true);
    };
    const unsubOverflowEvent = api.onWorkflowContextOverflow(unsubOverflow);

    const unsubUpdateAvailable = api.onUpdateAvailable ? api.onUpdateAvailable((version) => {
      setUpdateStatus('available');
      setUpdateVersion(version);
      showToast(`Downloading update v${version}...`, 'info');
    }) : () => { };

    const unsubUpdateDownloaded = api.onUpdateDownloaded ? api.onUpdateDownloaded((version) => {
      setUpdateStatus('downloaded');
      setUpdateVersion(version);
      showToast(`Update v${version} has been downloaded and is ready to install!`, 'success', 8000);
    }) : () => { };

    const unsubReindexProgress = api.onReindexProgress ? api.onReindexProgress((data) => {
      if (data.status === 'idle') {
        // Engine not installed, inform without blocking the UI
        showToast(data.message || 'Download the Local AI Engine to enable local indexing.', 'info', 8000);
        setReindexingProgress(null);
        return;
      }
      setReindexingProgress(data);
      if (data.status === 'completed') {
        showToast(data.message || 'Knowledge Base upgrade complete!', 'success', 6000);
        setTimeout(() => setReindexingProgress(null), 3000);
      } else if (data.status === 'error') {
        showToast(data.message || 'Re-indexing failed.', 'error', 8000);
        setTimeout(() => setReindexingProgress(null), 5000);
      }
    }) : () => { };

    const unsubUpdateOutdated = api.onUpdateOutdated ? api.onUpdateOutdated((data) => {
      setUpdateStatus('outdated');
      setUpdateVersion(data.version);
      setUpdateOutdatedUrl(data.url);
    }) : () => { };

    const unsubDownloadEngineProgress = api.onDownloadEngineProgress ? api.onDownloadEngineProgress((data) => {
      setEngineDownloadProgress(data);
      if (data.status === 'completed') {
        showToast("Local AI Engine installed successfully!", "success");
        setTimeout(() => setEngineDownloadProgress(null), 3000);
      } else if (data.status === 'error') {
        if (data.isBackground) {
          showToast(
            "Local AI Engine couldn't be downloaded automatically. Open Settings to check and install it manually.",
            "error",
            12000,
            { label: "Open Settings", onClick: () => openSettings('engine', 'embedding') }
          );
        } else {
          showToast(`Engine installation failed: ${data.error}`, "error");
        }
        setTimeout(() => setEngineDownloadProgress(null), 5000);
      }
    }) : () => { };

    const unsubSettingsChanged = api.onSettingsChanged ? api.onSettingsChanged(() => {
      console.log('Settings changed in database, reloading...');
      loadInitialData();
    }) : () => { };

    const unsubTaggingFailed = api.onWorldIndexTaggingFailed ? api.onWorldIndexTaggingFailed((data) => {
      const reason = (data?.error || 'the System AI did not respond').replace(/\.+$/, '');
      showToast(
        `Entity tagging failed: ${reason}. Indexing saved your text but skipped tags.`,
        'error',
        10000,
        { label: "Open Settings", onClick: () => openSettings('engine', 'system-ai') }
      );
    }) : () => { };

    return () => {
      unsubProgress();
      unsubStreamToken();
      unsubError();
      unsubOverflowEvent();
      unsubUpdateAvailable();
      unsubUpdateDownloaded();
      unsubReindexProgress();
      unsubUpdateOutdated();
      unsubDownloadEngineProgress();
      unsubSettingsChanged();
      unsubTaggingFailed();
      clearStreamDisplay();
    };
  }, []);

  // Drop the live buffer once generation ends; the saved message replaces it.
  useEffect(() => {
    if (!isGenerating) {
      clearStreamDisplay();
    }
  }, [isGenerating]);

  // --- OPERATIONS & ACTIONS ---
  const refreshEngineStatus = async () => {
    if (api.getEngineStatus) {
      try {
        const status = await api.getEngineStatus();
        setEngineStatus(status);
      } catch (err) {
        console.error("Failed to get engine status:", err);
      }
    }
  };

  const downloadEngine = async () => {
    if (!api.downloadEngine) return;
    setEngineDownloadProgress({ status: 'downloading', loaded: 0, total: 100, percent: 0 });
    try {
      await api.downloadEngine();
      await refreshEngineStatus();
    } catch (err) {
      console.error("Failed to download engine:", err);
      // Don't show error state for user-initiated cancellation (handled by cancel handler's progress event)
      if (err.message && !err.message.includes('cancelled')) {
        setEngineDownloadProgress({ status: 'error', error: err.message || 'Download failed' });
      }
    }
  };

  const cancelEngineDownload = async () => {
    if (api.cancelEngineDownload) {
      try {
        await api.cancelEngineDownload();
      } catch (err) {
        console.error("Failed to cancel engine download:", err);
      }
    }
    setEngineDownloadProgress(null);
  };

  const deleteEngine = async () => {
    if (!api.deleteEngine) return;
    try {
      await api.deleteEngine();
      await refreshEngineStatus();
      showToast("Local AI Engine uninstalled successfully.", "success");
    } catch (err) {
      console.error("Failed to delete engine:", err);
      showToast("Failed to delete Local AI Engine.", "error");
    }
  };

  const updateAccentColor = (color) => {
    document.documentElement.style.setProperty('--app-accent', color);
  };

  const handleSaveSettings = async (newSettings) => {
    await api.saveSettings(newSettings);
    setSettings(newSettings);
    if (newSettings.interface && newSettings.interface.accentColor) {
      updateAccentColor(newSettings.interface.accentColor);
    }
  };

  const handleSelectChat = async (chatId) => {
    setActiveChatId(chatId);
    const msgs = await api.getChatMessages(chatId);
    setActiveMessages(msgs);
    setCurrentView('chat');
  };

  const handleCreateChat = async (newChat) => {
    await api.saveChat(newChat);
    const updatedChats = await api.getChats();
    setChats(updatedChats);
    await handleSelectChat(newChat.id);
  };

  const handleDeleteChat = async (id) => {
    await api.deleteChat(id);
    const updatedChats = await api.getChats();
    setChats(updatedChats);
    if (activeChatId === id) {
      setActiveChatId(null);
      setActiveMessages([]);
      setCurrentView('dashboard');
    }
  };

  const handleSaveChat = async (chat) => {
    await api.saveChat(chat);
    const updatedChats = await api.getChats();
    setChats(updatedChats);
    if (activeChatId === chat.id) {
      const msgs = await api.getChatMessages(chat.id);
      setActiveMessages(msgs);
    }
  };

  // Reload chats state from the database without saving anything.
  // Use this after a backend function has already persisted changes directly.
  const refreshChats = async (chatId) => {
    const updatedChats = await api.getChats();
    setChats(updatedChats);
    const targetId = chatId || activeChatId;
    if (targetId) {
      const msgs = await api.getChatMessages(targetId);
      setActiveMessages(msgs);
    }
  };

  const handleSaveProfile = async (profile) => {
    await api.saveWritingProfile(profile);
    const updated = await api.getWritingProfiles();
    setWritingProfiles(updated);
  };

  const handleDeleteProfile = async (id) => {
    await api.deleteWritingProfile(id);
    const updated = await api.getWritingProfiles();
    setWritingProfiles(updated);
  };

  const handleSaveWorkflow = async (workflow) => {
    await api.saveWorkflow(workflow);
    const updated = await api.getWorkflows();
    setWorkflows(updated);
  };

  const handleDeleteWorkflow = async (id) => {
    await api.deleteWorkflow(id);
    const updated = await api.getWorkflows();
    setWorkflows(updated);
  };

  const handleSaveVariable = async (variable) => {
    await api.saveVariable(variable);
    const updated = await api.getVariables();
    setVariables(updated || []);
  };

  const handleDeleteVariable = async (id) => {
    await api.deleteVariable(id);
    const updated = await api.getVariables();
    setVariables(updated || []);
  };

  const handleSaveApiProfile = async (profile) => {
    await api.saveApiProfile(profile);
    const updated = await api.getApiProfiles();
    setApiProfiles(updated);
  };

  const handleDeleteApiProfile = async (id) => {
    await api.deleteApiProfile(id);
    const updated = await api.getApiProfiles();
    setApiProfiles(updated);
  };

  const handleSendMessage = async (content, selectedProfileOrWorkflowId, attachedFiles = []) => {
    if (!activeChatId || (!content.trim() && attachedFiles.length === 0)) return;

    const userMsgId = 'msg_' + Math.random().toString(36).substr(2, 9);
    const userMsg = {
      id: userMsgId,
      chatId: activeChatId,
      role: 'user',
      content,
      aiName: '',
      aiColor: '',
      debugNotice: '',
      attachedFiles: attachedFiles,
      createdAt: Date.now()
    };

    await api.saveMessage(userMsg);
    setActiveMessages(prev => [...prev, userMsg]);

    setIsGenerating(true);
    setGenerationProgress({ step: 1, totalSteps: 1, profileName: 'System', status: 'Thinking...' });

    try {
      const response = await api.sendMessage({
        chatId: activeChatId,
        messageContent: content,
        targetId: selectedProfileOrWorkflowId,
        attachedFiles
      });

      if (response && response.success) {
        const msgs = await api.getChatMessages(activeChatId);
        setActiveMessages(msgs);
        if (response.aiMsgId && !response.streamed) {
          setLastGeneratedMessageId(response.aiMsgId);
        }

        const updatedChats = await api.getChats();
        setChats(updatedChats);
      }
    } catch (e) {
      console.error("SendMessage error:", e);
    } finally {
      setIsGenerating(false);
      setGenerationProgress(null);
    }
  };

  const handleRegenerateMessage = async (msgId, selectedProfileOrWorkflowId) => {
    if (!activeChatId) return;

    const userMsgs = activeMessages.filter(m => m.role === 'user');
    if (userMsgs.length === 0) return;
    const lastUserMsg = userMsgs[userMsgs.length - 1];

    // Preserve the last AI message as an alternative instead of permanently deleting it
    const lastMsg = activeMessages.find(m => m.id === msgId) || activeMessages[activeMessages.length - 1];
    let oldAiMsgData = null;
    let updatedMsgs = [...activeMessages];
    if (lastMsg && lastMsg.role === 'ai') {
      oldAiMsgData = {
        content: lastMsg.content,
        aiName: lastMsg.aiName,
        aiColor: lastMsg.aiColor,
        createdAt: lastMsg.createdAt,
        alternatives: lastMsg.alternatives
      };
      await api.deleteMessage(lastMsg.id);
      updatedMsgs = updatedMsgs.filter(m => m.id !== lastMsg.id);
      setActiveMessages(updatedMsgs);
    }

    setIsGenerating(true);
    setGenerationProgress({ step: 1, totalSteps: 1, profileName: 'System', status: 'Thinking...' });

    try {
      const response = await api.sendMessage({
        chatId: activeChatId,
        messageContent: lastUserMsg.content,
        targetId: selectedProfileOrWorkflowId
      });

      if (response && response.success) {
        let msgs = await api.getChatMessages(activeChatId);

        // Merge old AI response as alternative in the new AI response
        if (oldAiMsgData && msgs.length > 0) {
          const newAiMsg = msgs[msgs.length - 1];
          if (newAiMsg && newAiMsg.role === 'ai') {
            const list = [];
            if (oldAiMsgData.alternatives) {
              try {
                const parsed = typeof oldAiMsgData.alternatives === 'string'
                  ? JSON.parse(oldAiMsgData.alternatives)
                  : oldAiMsgData.alternatives;
                if (parsed && parsed.list) {
                  list.push(...parsed.list);
                }
              } catch (e) {
                console.error("Failed to parse old AI alternatives list", e);
              }
            } else {
              list.push({
                content: oldAiMsgData.content,
                aiName: oldAiMsgData.aiName,
                aiColor: oldAiMsgData.aiColor,
                createdAt: oldAiMsgData.createdAt
              });
            }
            list.push({
              content: newAiMsg.content,
              aiName: newAiMsg.aiName,
              aiColor: newAiMsg.aiColor,
              createdAt: newAiMsg.createdAt
            });

            newAiMsg.alternatives = JSON.stringify({
              activeIndex: list.length - 1,
              list: list
            });
            await api.saveMessage(newAiMsg);

            msgs = await api.getChatMessages(activeChatId);
          }
        }

        setActiveMessages(msgs);
        if (response.aiMsgId && !response.streamed) {
          setLastGeneratedMessageId(response.aiMsgId);
        }

        const updatedChats = await api.getChats();
        setChats(updatedChats);
      }
    } catch (e) {
      console.error("RegenerateMessage error:", e);
    } finally {
      setIsGenerating(false);
      setGenerationProgress(null);
    }
  };

  const handleEditUserMessage = async (msgId, newText, selectedProfileOrWorkflowId) => {
    if (!activeChatId) return;

    // 1. Find subsequent AI message if any to preserve it
    const userMsgIndex = activeMessages.findIndex(m => m.id === msgId);
    let oldAiMsgData = null;
    if (userMsgIndex !== -1 && userMsgIndex < activeMessages.length - 1) {
      const nextMsg = activeMessages[userMsgIndex + 1];
      if (nextMsg && nextMsg.role === 'ai') {
        oldAiMsgData = {
          content: nextMsg.content,
          aiName: nextMsg.aiName,
          aiColor: nextMsg.aiColor,
          createdAt: nextMsg.createdAt,
          alternatives: nextMsg.alternatives
        };
      }
    }

    const currentMsg = activeMessages.find(m => m.id === msgId);
    const attachedFiles = currentMsg && currentMsg.attachedFiles
      ? (typeof currentMsg.attachedFiles === 'string' ? JSON.parse(currentMsg.attachedFiles) : currentMsg.attachedFiles)
      : [];

    // 2. Update user message in local state (temporary visual representation)
    const updatedMessages = activeMessages.map(m => {
      if (m.id === msgId) {
        return { ...m, content: newText };
      }
      return m;
    });

    let msgsToKeep = updatedMessages.slice(0, userMsgIndex + 1);
    setActiveMessages(msgsToKeep);

    setIsGenerating(true);
    setGenerationProgress({ step: 1, totalSteps: 1, profileName: 'System', status: 'Thinking...' });

    try {
      const response = await api.sendMessage({
        chatId: activeChatId,
        messageContent: newText,
        targetId: selectedProfileOrWorkflowId,
        attachedFiles
      });

      if (response && response.success) {
        const targetMsg = updatedMessages.find(m => m.id === msgId);
        if (targetMsg) {
          await api.saveMessage(targetMsg);
        }

        const subsequentMsgs = activeMessages.slice(userMsgIndex + 1);
        for (const subMsg of subsequentMsgs) {
          await api.deleteMessage(subMsg.id);
        }

        let msgs = await api.getChatMessages(activeChatId);

        // Merge old AI response as alternative in the new AI response
        if (oldAiMsgData && msgs.length > 0) {
          const newAiMsg = msgs[msgs.length - 1];
          if (newAiMsg && newAiMsg.role === 'ai') {
            const list = [];
            if (oldAiMsgData.alternatives) {
              try {
                const parsed = typeof oldAiMsgData.alternatives === 'string'
                  ? JSON.parse(oldAiMsgData.alternatives)
                  : oldAiMsgData.alternatives;
                if (parsed && parsed.list) {
                  list.push(...parsed.list);
                }
              } catch (e) {
                console.error("Failed to parse old AI alternatives list", e);
              }
            } else {
              list.push({
                content: oldAiMsgData.content,
                aiName: oldAiMsgData.aiName,
                aiColor: oldAiMsgData.aiColor,
                createdAt: oldAiMsgData.createdAt
              });
            }
            list.push({
              content: newAiMsg.content,
              aiName: newAiMsg.aiName,
              aiColor: newAiMsg.aiColor,
              createdAt: newAiMsg.createdAt
            });

            newAiMsg.alternatives = JSON.stringify({
              activeIndex: list.length - 1,
              list: list
            });
            await api.saveMessage(newAiMsg);

            msgs = await api.getChatMessages(activeChatId);
          }
        }

        setActiveMessages(msgs);

        const updatedChats = await api.getChats();
        setChats(updatedChats);
      } else {
        throw new Error("Generation was not successful.");
      }
    } catch (e) {
      console.error("EditUserMessage generation error:", e);
      // Restore previous user message content in local state, keep original AI message
      setActiveMessages(activeMessages);
      setEditError({
        chatId: activeChatId,
        editedText: newText,
        msgId,
        targetId: selectedProfileOrWorkflowId,
        errorMessage: e.message || "Request failed"
      });
    } finally {
      setIsGenerating(false);
      setGenerationProgress(null);
    }
  };

  const handleSwitchAIAlternative = async (messageId, targetIndex) => {
    const msg = activeMessages.find(m => m.id === messageId);
    if (!msg) return;

    try {
      const parsed = typeof msg.alternatives === 'string' ? JSON.parse(msg.alternatives) : msg.alternatives;
      if (!parsed || !parsed.list || targetIndex < 0 || targetIndex >= parsed.list.length) return;

      parsed.activeIndex = targetIndex;
      const selected = parsed.list[targetIndex];

      const updatedMsg = {
        ...msg,
        content: selected.content,
        aiName: selected.aiName,
        aiColor: selected.aiColor,
        createdAt: selected.createdAt,
        alternatives: JSON.stringify(parsed)
      };

      await api.saveMessage(updatedMsg);
      setActiveMessages(prev => prev.map(m => m.id === messageId ? updatedMsg : m));
    } catch (e) {
      console.error("Error switching alternative response:", e);
    }
  };

  const handleCancelGeneration = () => {
    api.cancelGeneration();
    setIsGenerating(false);
    setGenerationProgress(null);
  };

  const handleRespondToError = (decision) => {
    api.respondToError(decision);
    setShowErrorModal(false);
    setErrorData(null);
    if (decision === 'interrupt') {
      setIsGenerating(false);
      setGenerationProgress(null);
    } else {
      setIsGenerating(true);
    }
  };

  const handleRespondToOverflow = (decision, editedText) => {
    api.respondToOverflow(decision, editedText);
    setShowOverflowModal(false);
    setOverflowData(null);
  };

  const [settingsRequest, setSettingsRequest] = useState(null);
  const openSettings = (tab = 'api', section = null) => setSettingsRequest({ tab, section });
  const clearSettingsRequest = () => setSettingsRequest(null);

  // Record a one-time hint as seen: flip it locally (so it disappears at once)
  // and persist so it never returns. Fire-and-forget on the write.
  const dismissHint = (key) => {
    setUiFlags(prev => (prev[key] ? prev : { ...prev, [key]: true }));
    api.setUiFlag(key);
  };

  // Open on demand (from Settings). Reopening does not need to persist anything.
  const openWhatsNew = () => setWhatsNewOpen(true);
  // Closing always records the current version as seen, so the auto-open won't
  // fire again until the next update, whether it opened automatically or by hand.
  const closeWhatsNew = () => {
    setWhatsNewOpen(false);
    api.markWhatsNewSeen();
  };

  const activeChat = chats.find(c => c.id === activeChatId);

  return (
    <AppContext.Provider value={{
      currentView, setCurrentView,
      settingsRequest, openSettings, clearSettingsRequest,
      chats, setChats,
      writingProfiles, setWritingProfiles,
      workflows, setWorkflows,
      apiProfiles, setApiProfiles,
      settings, setSettings, handleSaveSettings,
      uiFlags, dismissHint,
      whatsNewOpen, openWhatsNew, closeWhatsNew,
      activeChatId, activeChat,
      activeMessages, setActiveMessages, handleSelectChat,
      handleCreateChat, handleDeleteChat, handleSaveChat, refreshChats,
      handleSaveProfile, handleDeleteProfile,
      handleSaveWorkflow, handleDeleteWorkflow,
      handleSaveApiProfile, handleDeleteApiProfile,
      variables, setVariables,
      handleSaveVariable, handleDeleteVariable,
      handleSendMessage, handleRegenerateMessage, handleEditUserMessage, handleSwitchAIAlternative, isGenerating, generationProgress, streamingContent, streamingReasoning, handleCancelGeneration,
      showOverflowModal, setShowOverflowModal, overflowData, handleRespondToOverflow,
      showErrorModal, setShowErrorModal, errorData, handleRespondToError,
      editError, setEditError,
      lastGeneratedMessageId, setLastGeneratedMessageId,
      toast, showToast,
      updateStatus, updateVersion, updateOutdatedUrl,
      reindexingProgress,
      engineStatus, setEngineStatus, engineDownloadProgress, setEngineDownloadProgress, refreshEngineStatus, downloadEngine, cancelEngineDownload, deleteEngine,
      electronAPI: api
    }}>
      {children}
    </AppContext.Provider>
  );
};
