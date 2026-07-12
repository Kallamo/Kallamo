import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useChatSession } from '../features/chat/useChatSession';

const AppContext = createContext();
const EMPTY_MESSAGE_PAGE = { messages: [], hasMore: false, oldestCursor: null };

export const useApp = () => useContext(AppContext);

// Helper for safe electronAPI calls
const api = window.electronAPI || {
  minimize: () => { }, maximize: () => { }, close: () => { },
  getApiProfiles: async () => [], saveApiProfile: async () => { }, deleteApiProfile: async () => { },
  getWritingProfiles: async () => [], saveWritingProfile: async () => { }, deleteWritingProfile: async () => { },
  getChats: async () => [], saveChat: async () => { }, deleteChat: async () => { }, getChatMessages: async () => [], getChatMessagePage: async () => EMPTY_MESSAGE_PAGE, saveMessage: async () => { }, deleteMessage: async () => { }, revertChatToMessage: async () => ({ success: true }), triggerManualSummarize: async () => { },
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
  const [whatsNewType, setWhatsNewType] = useState('global');
  const [whatsNewVersion, setWhatsNewVersion] = useState(null);

  const [showOverflowModal, setShowOverflowModal] = useState(false);
  const [overflowData, setOverflowData] = useState(null);
  const [showErrorModal, setShowErrorModal] = useState(false);
  const [errorData, setErrorData] = useState(null);
  const chatSession = useChatSession({ api, setChats, setCurrentView });
  const {
    activeChatId,
    setIsGenerating,
    setGenerationProgress,
    enqueueStreamDisplay,
    clearStreamDisplay
  } = chatSession;

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
      if (whatsNew?.show) {
        setWhatsNewType(whatsNew.type);
        setWhatsNewVersion(whatsNew.version);
        setWhatsNewOpen(true);
      }

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

  const openWhatsNew = () => {
    setWhatsNewType('global');
    setWhatsNewOpen(true);
  };

  const closeWhatsNew = () => {
    setWhatsNewOpen(false);
    api.markWhatsNewSeen(whatsNewType);
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
      whatsNewOpen, whatsNewType, whatsNewVersion, openWhatsNew, closeWhatsNew,
      activeChatId, activeChat,
      ...chatSession,
      handleSaveProfile, handleDeleteProfile,
      handleSaveWorkflow, handleDeleteWorkflow,
      handleSaveApiProfile, handleDeleteApiProfile,
      variables, setVariables,
      handleSaveVariable, handleDeleteVariable,
      showOverflowModal, setShowOverflowModal, overflowData, handleRespondToOverflow,
      showErrorModal, setShowErrorModal, errorData, handleRespondToError,
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
