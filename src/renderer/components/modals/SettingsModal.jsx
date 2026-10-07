import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { X, Plus, Eye, EyeOff, Layers, HardDrive, Trash2, FolderOpen, RefreshCw, Cpu, Database, Palette, AlertTriangle, Sparkles, FileSearch, Plug, Zap, Activity, ArrowLeft, Search, Server, MoreHorizontal, Copy, Pencil, Info, GitPullRequest, Drama, Tags, Route, Archive, Languages, CircleOff } from 'lucide-react';
import Logo, { Logotype, ReedPen } from '../../logo';
import Toggle from '../ui/Toggle';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import SelectMenu from '../ui/SelectMenu';
import SegmentedControl from '../ui/SegmentedControl';
import { GithubIcon, DiscordIcon, RedditIcon } from '../ui/BrandIcons';
import NumberInput from '../ui/NumberInput';
import ConfirmDialog from '../ui/ConfirmDialog';
import { Menu, MenuItem, MenuSeparator } from '../ui/Menu';
import { SettingsHeader, SettingsGroup, SettingsRow, SettingsRadio, IconTile, RunsOnBar, fieldClass } from '../../features/settings/SettingsUi';
import AppearancePreview, { OptionTile } from '../../features/settings/AppearancePreview';
import { AI_ENGINE_ROLE_DEFINITIONS, SYSTEM_AI_LANGUAGES } from '../../../shared/contracts/ai-engine-roles';
import retrievalSettingsContract from '../../../shared/retrieval-settings.json';

const RETRIEVAL_SETTING_DEFINITIONS = retrievalSettingsContract.definitions;
const rangeProps = ({ min, max, step }) => ({ min, max, step });

// Old callers ask for the four tabs this page had; each now maps to one of its pages.
function startingPage(tab, section) {
  if (tab === 'engine') return section === 'embedding' ? 'embeddings' : 'roles';
  return { api: 'connections', interface: 'appearance', advanced: 'generation', about: 'about' }[tab] || tab || 'connections';
}

export default function SettingsModal({ onClose, initialTab, initialSection }) {
  const {
    settings,
    handleSaveSettings,
    apiProfiles,
    writingProfiles,
    handleSaveApiProfile,
    handleDeleteApiProfile,
    electronAPI,
    showToast,
    updateStatus,
    updateVersion,
    updateOutdatedUrl,
    engineStatus,
    downloadEngine,
    deleteEngine,
    openWhatsNew
  } = useApp();

  const [activeTab, setActiveTab] = useState(() => startingPage(initialTab, initialSection));
  const [searchQuery, setSearchQuery] = useState('');
  const [connectionToDelete, setConnectionToDelete] = useState(null);
  const [focusModelInput, setFocusModelInput] = useState(false);

  useEffect(() => {
    const sectionIds = { 'system-ai': 'system-ai-config', tagger: 'ai-engine-roles-config' };
    const targetId = sectionIds[initialSection];
    if (targetId && activeTab === 'roles') {
      const timer = setTimeout(() => {
        const el = document.getElementById(targetId);
        if (el) {
          el.scrollIntoView({ behavior: 'smooth', block: 'start' });
        }
      }, 150);
      return () => clearTimeout(timer);
    }
  }, [initialSection, activeTab]);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      // Menus, pickers and dialogs close themselves first; that Escape is not for the page.
      const layered = '[role="menu"], [role="listbox"], [aria-modal="true"]';
      if (event.target?.closest?.(layered) || document.querySelector(layered)) return;
      onClose?.();
    };
    // Capture runs before the layers' own listeners, while they are still on screen.
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  const platformKey = `${engineStatus.platform || ''}-${engineStatus.arch || ''}`;
  const isPlatformUnsupported = engineStatus.platform && !['win32-x64', 'win32-arm64', 'darwin-arm64', 'linux-x64', 'linux-arm64'].includes(platformKey);

  const [showAddApiForm, setShowAddApiForm] = useState(false);
  const [editingApiId, setEditingApiId] = useState(null);
  const [apiName, setApiName] = useState('');
  const [apiProvider, setApiProvider] = useState('OpenRouter');
  const [showBaseUrl, setShowBaseUrl] = useState(false);
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);

  const [gcpProjectId, setGcpProjectId] = useState('');
  const [gcpRegion, setGcpRegion] = useState('us-central1');
  const [gcpServiceAccount, setGcpServiceAccount] = useState('');

  const [awsAccessKeyId, setAwsAccessKeyId] = useState('');
  const [awsSecretAccessKey, setAwsSecretAccessKey] = useState('');
  const [awsRegion, setAwsRegion] = useState('us-east-1');


  const [modelsList, setModelsList] = useState([]);
  const [newModelName, setNewModelName] = useState('');

  const [accentColor, setAccentColor] = useState(settings.interface.accentColor || '#FBCB2D');
  const [fontFamily, setFontFamily] = useState(settings.interface.fontFamily || 'sans');
  const [fontSize, setFontSize] = useState(settings.interface.fontSize || 'medium');
  const [layoutMode, setLayoutMode] = useState(settings.interface.layout || 'bubbles');
  const [codeTheme, setCodeTheme] = useState(settings.interface.codeTheme || 'github-dark');
  const [lineNumbers, setLineNumbers] = useState(settings.interface.lineNumbers || false);
  const [blurEnabled, setBlurEnabled] = useState(settings.interface.blur ?? true);
  const [writingToolbar, setWritingToolbar] = useState(settings.interface.writingToolbar || 'fixed');
  const [smartTypography, setSmartTypography] = useState(settings.interface.smartTypography ?? true);

  const [chunkSize, setChunkSize] = useState(settings.advanced.chunkSize || 500);
  const initialRetrievalSettings = settings.advanced;
  const [similarity, setSimilarity] = useState(initialRetrievalSettings.retrievalStrictness);
  const [profileKnowledgeTopK, setProfileKnowledgeTopK] = useState(initialRetrievalSettings.profileKnowledgeTopK);
  const [workspaceDocumentsTopK, setWorkspaceDocumentsTopK] = useState(initialRetrievalSettings.workspaceDocumentsTopK);
  const [longTermMemoryTopK, setLongTermMemoryTopK] = useState(initialRetrievalSettings.longTermMemoryTopK);
  const [worldbuildEntityLimit, setWorldbuildEntityLimit] = useState(initialRetrievalSettings.worldbuildEntityLimit);
  const [worldbuildBreadth, setWorldbuildBreadth] = useState(initialRetrievalSettings.worldbuildBreadth);
  const [executionDevice, setExecutionDevice] = useState(settings.advanced.executionDevice || 'cpu');
  const [ragDebug, setRagDebug] = useState(settings.advanced.ragDebug || false);
  const [agenticDebug, setAgenticDebug] = useState(settings.advanced.agenticDebug || false);
  const [tokenDebug, setTokenDebug] = useState(settings.advanced.tokenDebug || false);
  const [narrativeStateDebug, setNarrativeStateDebug] = useState(settings.advanced.narrativeStateDebug || false);
  const [embeddingEngine, setEmbeddingEngine] = useState(settings.advanced.embeddingEngine || 'local');
  const [embeddingApiProfileId, setEmbeddingApiProfileId] = useState(settings.advanced.embeddingApiProfileId || '');
  const [embeddingModelName, setEmbeddingModelName] = useState(settings.advanced.embeddingModelName || '');
  const [systemApiProfileId, setSystemApiProfileId] = useState(settings.advanced.systemApiProfileId || '');
  const [systemModelName, setSystemModelName] = useState(settings.advanced.systemModelName || '');
  const [systemOutputLanguage, setSystemOutputLanguage] = useState(settings.advanced.systemOutputLanguage || 'English');
  const [taggerMode, setTaggerMode] = useState(settings.advanced.taggerMode || 'inherit-system');
  const [taggerApiProfileId, setTaggerApiProfileId] = useState(settings.advanced.taggerApiProfileId || '');
  const [taggerModelName, setTaggerModelName] = useState(settings.advanced.taggerModelName || '');
  const [summarizerMode, setSummarizerMode] = useState(settings.advanced.summarizerMode || 'inherit-system');
  const [summarizerApiProfileId, setSummarizerApiProfileId] = useState(settings.advanced.summarizerApiProfileId || '');
  const [summarizerModelName, setSummarizerModelName] = useState(settings.advanced.summarizerModelName || '');
  const [narrativeStateMode, setNarrativeStateMode] = useState(settings.advanced.narrativeStateMode || 'inherit-system');
  const [narrativeStateApiProfileId, setNarrativeStateApiProfileId] = useState(settings.advanced.narrativeStateApiProfileId || '');
  const [narrativeStateModelName, setNarrativeStateModelName] = useState(settings.advanced.narrativeStateModelName || '');
  const [retrievalPlannerMode, setRetrievalPlannerMode] = useState(settings.advanced.retrievalPlannerMode || 'profile');
  const [retrievalPlannerApiProfileId, setRetrievalPlannerApiProfileId] = useState(settings.advanced.retrievalPlannerApiProfileId || '');
  const [retrievalPlannerModelName, setRetrievalPlannerModelName] = useState(settings.advanced.retrievalPlannerModelName || '');
  const [agenticGate, setAgenticGate] = useState(settings.advanced.agenticGate || 'auto');
  const [agenticToolProtocol, setAgenticToolProtocol] = useState(settings.advanced.agenticToolProtocol || 'auto');
  const [allowAiEntityCreation, setAllowAiEntityCreation] = useState(settings.advanced.allowAiEntityCreation || false);
  const [archiveSummarization, setArchiveSummarization] = useState(settings.advanced.archiveSummarization !== false);
  const [streamingEnabled, setStreamingEnabled] = useState(settings.advanced.streaming !== false);
  const [promptCache, setPromptCache] = useState(settings.advanced.promptCache !== false);
  const [promptCacheContextPlacement, setPromptCacheContextPlacement] = useState(settings.advanced.promptCacheContextPlacement === 'turn' ? 'turn' : 'system');

  // Models pre-defined on the selected System AI connection (drives the Model dropdown).
  const systemProfileModels = (() => {
    const p = apiProfiles.find(ap => ap.id === systemApiProfileId);
    if (!p) return [];
    try { return typeof p.models === 'string' ? JSON.parse(p.models) : (p.models || []); } catch (e) { return []; }
  })();
  const systemAiReady = Boolean(systemApiProfileId && systemModelName && systemProfileModels.includes(systemModelName));
  const systemAiRequirement = !systemApiProfileId
    ? 'Select an API Connection, then select a model.'
    : !systemModelName
      ? 'Select a model for this API Connection.'
      : !systemProfileModels.includes(systemModelName)
        ? 'The selected model is no longer available. Choose another model.'
        : '';

  const [confirmAction, setConfirmAction] = useState(null); // null | 'purge' | 'clearCache' | 'wipe'
  const [backupStatus, setBackupStatus] = useState(null); // null | { success: boolean, path?: string, error?: string }
  const [utilityStatus, setUtilityStatus] = useState(null); // null | { title: string, message: string }
  const [restoring, setRestoring] = useState(false);
  const [appVersion, setAppVersion] = useState('1.0.0');
  const [migrationBackups, setMigrationBackups] = useState([]);

  useEffect(() => {
    if (electronAPI?.getAppVersion) {
      electronAPI.getAppVersion().then(setAppVersion).catch(console.error);
    }
  }, [electronAPI]);

  useEffect(() => {
    if (activeTab !== 'data' || !electronAPI?.listMigrationBackups) return;
    let cancelled = false;
    electronAPI.listMigrationBackups()
      .then(backups => { if (!cancelled) setMigrationBackups(backups || []); })
      .catch(console.error);
    return () => { cancelled = true; };
  }, [activeTab, electronAPI]);

  const colors = ['#FBCB2D', '#ff5f56', '#3b82f6', '#10b981', '#9c27b0'];

  // Keep ref of settings to prevent stale closures in debounce timeout
  const settingsRef = useRef({
    accentColor, fontFamily, fontSize, layout: layoutMode, codeTheme, lineNumbers, blur: blurEnabled, writingToolbar, smartTypography, streaming: streamingEnabled,
    chunkSize, similarity, profileKnowledgeTopK, workspaceDocumentsTopK, longTermMemoryTopK, worldbuildEntityLimit, worldbuildBreadth, executionDevice, ragDebug, agenticDebug, tokenDebug, narrativeStateDebug,
    embeddingEngine, embeddingApiProfileId, embeddingModelName, systemApiProfileId, systemModelName, systemOutputLanguage,
    taggerMode, taggerApiProfileId, taggerModelName, summarizerMode, summarizerApiProfileId, summarizerModelName,
    narrativeStateMode, narrativeStateApiProfileId, narrativeStateModelName,
    retrievalPlannerMode, retrievalPlannerApiProfileId, retrievalPlannerModelName, agenticGate, agenticToolProtocol, allowAiEntityCreation, archiveSummarization,
    promptCache, promptCacheContextPlacement
  });

  useEffect(() => {
    settingsRef.current = {
      accentColor, fontFamily, fontSize, layout: layoutMode, codeTheme, lineNumbers, blur: blurEnabled, writingToolbar, smartTypography, streaming: streamingEnabled,
      chunkSize, similarity, profileKnowledgeTopK, workspaceDocumentsTopK, longTermMemoryTopK, worldbuildEntityLimit, worldbuildBreadth, executionDevice, ragDebug, agenticDebug, tokenDebug, narrativeStateDebug,
      embeddingEngine, embeddingApiProfileId, embeddingModelName, systemApiProfileId, systemModelName, systemOutputLanguage,
      taggerMode, taggerApiProfileId, taggerModelName, summarizerMode, summarizerApiProfileId, summarizerModelName,
      narrativeStateMode, narrativeStateApiProfileId, narrativeStateModelName,
      retrievalPlannerMode, retrievalPlannerApiProfileId, retrievalPlannerModelName, agenticGate, agenticToolProtocol, allowAiEntityCreation, archiveSummarization,
      promptCache, promptCacheContextPlacement
    };
  }, [accentColor, fontFamily, fontSize, layoutMode, codeTheme, lineNumbers, blurEnabled, writingToolbar, smartTypography, streamingEnabled, chunkSize, similarity, profileKnowledgeTopK, workspaceDocumentsTopK, longTermMemoryTopK, worldbuildEntityLimit, worldbuildBreadth, executionDevice, ragDebug, agenticDebug, tokenDebug, narrativeStateDebug, embeddingEngine, embeddingApiProfileId, embeddingModelName, systemApiProfileId, systemModelName, systemOutputLanguage, taggerMode, taggerApiProfileId, taggerModelName, summarizerMode, summarizerApiProfileId, summarizerModelName, narrativeStateMode, narrativeStateApiProfileId, narrativeStateModelName, retrievalPlannerMode, retrievalPlannerApiProfileId, retrievalPlannerModelName, agenticGate, agenticToolProtocol, allowAiEntityCreation, archiveSummarization, promptCache, promptCacheContextPlacement]);

  // Handle immediate save for selects and color choices
  const updateSetting = async (category, key, value) => {
    if (category === 'interface') {
      if (key === 'accentColor') setAccentColor(value);
      if (key === 'fontFamily') setFontFamily(value);
      if (key === 'fontSize') setFontSize(value);
      if (key === 'layout') setLayoutMode(value);
      if (key === 'codeTheme') setCodeTheme(value);
      if (key === 'lineNumbers') setLineNumbers(value);
      if (key === 'blur') setBlurEnabled(value);
      if (key === 'writingToolbar') setWritingToolbar(value);
      if (key === 'smartTypography') setSmartTypography(value);
    } else if (category === 'advanced') {
      if (key === 'executionDevice') setExecutionDevice(value);
      if (key === 'ragDebug') setRagDebug(value);
      if (key === 'agenticDebug') setAgenticDebug(value);
      if (key === 'tokenDebug') setTokenDebug(value);
      if (key === 'narrativeStateDebug') setNarrativeStateDebug(value);
      if (key === 'streaming') setStreamingEnabled(value);
      if (key === 'promptCache') setPromptCache(value);
      if (key === 'promptCacheContextPlacement') setPromptCacheContextPlacement(value);
      if (key === 'allowAiEntityCreation') setAllowAiEntityCreation(value);
      if (key === 'archiveSummarization') setArchiveSummarization(value);
      if (key === 'embeddingEngine') setEmbeddingEngine(value);
      if (key === 'embeddingApiProfileId') setEmbeddingApiProfileId(value);
      if (key === 'systemApiProfileId') { setSystemApiProfileId(value); setSystemModelName(''); }
      if (key === 'systemModelName') setSystemModelName(value);
      if (key === 'systemOutputLanguage') setSystemOutputLanguage(value);
      if (key === 'taggerMode') setTaggerMode(value);
      if (key === 'taggerApiProfileId') { setTaggerApiProfileId(value); setTaggerModelName(''); }
      if (key === 'taggerModelName') setTaggerModelName(value);
      if (key === 'summarizerMode') setSummarizerMode(value);
      if (key === 'summarizerApiProfileId') { setSummarizerApiProfileId(value); setSummarizerModelName(''); }
      if (key === 'summarizerModelName') setSummarizerModelName(value);
      if (key === 'narrativeStateMode') setNarrativeStateMode(value);
      if (key === 'narrativeStateApiProfileId') { setNarrativeStateApiProfileId(value); setNarrativeStateModelName(''); }
      if (key === 'narrativeStateModelName') setNarrativeStateModelName(value);
      if (key === 'retrievalPlannerMode') setRetrievalPlannerMode(value);
      if (key === 'retrievalPlannerApiProfileId') { setRetrievalPlannerApiProfileId(value); setRetrievalPlannerModelName(''); }
      if (key === 'retrievalPlannerModelName') setRetrievalPlannerModelName(value);
      if (key === 'agenticGate') setAgenticGate(value);
      if (key === 'agenticToolProtocol') setAgenticToolProtocol(value);
    }

    const current = settingsRef.current;
    const newSettings = {
      interface: {
        ...settings.interface,
        accentColor: key === 'accentColor' ? value : current.accentColor,
        fontFamily: key === 'fontFamily' ? value : current.fontFamily,
        fontSize: key === 'fontSize' ? value : current.fontSize,
        layout: key === 'layout' ? value : current.layout,
        codeTheme: key === 'codeTheme' ? value : current.codeTheme,
        lineNumbers: key === 'lineNumbers' ? value : current.lineNumbers,
        blur: key === 'blur' ? value : current.blur,
        writingToolbar: key === 'writingToolbar' ? value : current.writingToolbar,
        smartTypography: key === 'smartTypography' ? value : current.smartTypography
      },
      advanced: {
        ...settings.advanced,
        chunkSize: Number(current.chunkSize),
        similarity: Number(current.similarity),
        profileKnowledgeTopK: Number(current.profileKnowledgeTopK),
        workspaceDocumentsTopK: Number(current.workspaceDocumentsTopK),
        longTermMemoryTopK: Number(current.longTermMemoryTopK),
        worldbuildEntityLimit: Number(current.worldbuildEntityLimit),
        worldbuildBreadth: current.worldbuildBreadth,
        retrievalStrictness: Number(current.similarity),
        executionDevice: key === 'executionDevice' ? value : current.executionDevice,
        ragDebug: key === 'ragDebug' ? value : current.ragDebug,
        agenticDebug: key === 'agenticDebug' ? value : current.agenticDebug,
        tokenDebug: key === 'tokenDebug' ? value : current.tokenDebug,
        narrativeStateDebug: key === 'narrativeStateDebug' ? value : current.narrativeStateDebug,
        streaming: key === 'streaming' ? value : current.streaming,
        promptCache: key === 'promptCache' ? value : current.promptCache,
        promptCacheContextPlacement: key === 'promptCacheContextPlacement' ? value : current.promptCacheContextPlacement,
        allowAiEntityCreation: key === 'allowAiEntityCreation' ? value : current.allowAiEntityCreation,
        archiveSummarization: key === 'archiveSummarization' ? value : current.archiveSummarization,
        embeddingEngine: key === 'embeddingEngine' ? value : current.embeddingEngine,
        embeddingApiProfileId: key === 'embeddingApiProfileId' ? value : current.embeddingApiProfileId,
        embeddingModelName: current.embeddingModelName,
        systemApiProfileId: key === 'systemApiProfileId' ? value : current.systemApiProfileId,
        systemModelName: key === 'systemModelName' ? value : (key === 'systemApiProfileId' ? '' : current.systemModelName),
        systemOutputLanguage: key === 'systemOutputLanguage' ? value : current.systemOutputLanguage,
        taggerMode: key === 'taggerMode' ? value : current.taggerMode,
        taggerApiProfileId: key === 'taggerApiProfileId' ? value : current.taggerApiProfileId,
        taggerModelName: key === 'taggerModelName' ? value : (key === 'taggerApiProfileId' ? '' : current.taggerModelName),
        summarizerMode: key === 'summarizerMode' ? value : current.summarizerMode,
        summarizerApiProfileId: key === 'summarizerApiProfileId' ? value : current.summarizerApiProfileId,
        summarizerModelName: key === 'summarizerModelName' ? value : (key === 'summarizerApiProfileId' ? '' : current.summarizerModelName),
        narrativeStateMode: key === 'narrativeStateMode' ? value : current.narrativeStateMode,
        narrativeStateApiProfileId: key === 'narrativeStateApiProfileId' ? value : current.narrativeStateApiProfileId,
        narrativeStateModelName: key === 'narrativeStateModelName' ? value : (key === 'narrativeStateApiProfileId' ? '' : current.narrativeStateModelName),
        retrievalPlannerMode: key === 'retrievalPlannerMode' ? value : current.retrievalPlannerMode,
        retrievalPlannerApiProfileId: key === 'retrievalPlannerApiProfileId' ? value : current.retrievalPlannerApiProfileId,
        retrievalPlannerModelName: key === 'retrievalPlannerModelName' ? value : (key === 'retrievalPlannerApiProfileId' ? '' : current.retrievalPlannerModelName),
        agenticGate: key === 'agenticGate' ? value : current.agenticGate,
        agenticToolProtocol: key === 'agenticToolProtocol' ? value : current.agenticToolProtocol
      }
    };

    await handleSaveSettings(newSettings);
  };

  // Debounced saver for ranges/sliders
  const saveTimeoutRef = useRef(null);

  const updateSettingWithDebounce = (key, value) => {
    // Visual state moves at once so the slider stays smooth; the database write waits.
    if (key === 'chunkSize') setChunkSize(value);
    if (key === 'similarity') setSimilarity(value);
    if (key === 'profileKnowledgeTopK') setProfileKnowledgeTopK(value);
    if (key === 'workspaceDocumentsTopK') setWorkspaceDocumentsTopK(value);
    if (key === 'longTermMemoryTopK') setLongTermMemoryTopK(value);
    if (key === 'worldbuildEntityLimit') setWorldbuildEntityLimit(value);
    if (key === 'worldbuildBreadth') setWorldbuildBreadth(value);
    if (key === 'embeddingModelName') setEmbeddingModelName(value);
    if (key === 'systemModelName') setSystemModelName(value);

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      const current = settingsRef.current;
      const newSettings = {
        interface: {
          ...settings.interface,
          accentColor: current.accentColor,
          fontFamily: current.fontFamily,
          fontSize: current.fontSize,
          layout: current.layout,
          codeTheme: current.codeTheme,
          lineNumbers: current.lineNumbers,
          blur: current.blur,
          writingToolbar: current.writingToolbar,
          smartTypography: current.smartTypography
        },
        advanced: {
          ...settings.advanced,
          chunkSize: key === 'chunkSize' ? Number(value) : Number(current.chunkSize),
          similarity: key === 'similarity' ? Number(value) : Number(current.similarity),
          retrievalStrictness: key === 'similarity' ? Number(value) : Number(current.similarity),
          profileKnowledgeTopK: key === 'profileKnowledgeTopK' ? Number(value) : Number(current.profileKnowledgeTopK),
          workspaceDocumentsTopK: key === 'workspaceDocumentsTopK' ? Number(value) : Number(current.workspaceDocumentsTopK),
          longTermMemoryTopK: key === 'longTermMemoryTopK' ? Number(value) : Number(current.longTermMemoryTopK),
          worldbuildEntityLimit: key === 'worldbuildEntityLimit' ? Number(value) : Number(current.worldbuildEntityLimit),
          worldbuildBreadth: key === 'worldbuildBreadth' ? value : current.worldbuildBreadth,
          executionDevice: current.executionDevice,
          ragDebug: current.ragDebug,
          agenticDebug: current.agenticDebug,
          tokenDebug: current.tokenDebug,
          narrativeStateDebug: current.narrativeStateDebug,
          promptCache: current.promptCache,
          promptCacheContextPlacement: current.promptCacheContextPlacement,
          allowAiEntityCreation: current.allowAiEntityCreation,
          archiveSummarization: current.archiveSummarization,
          embeddingEngine: current.embeddingEngine,
          embeddingApiProfileId: current.embeddingApiProfileId,
          embeddingModelName: key === 'embeddingModelName' ? value : current.embeddingModelName,
          systemApiProfileId: current.systemApiProfileId,
          systemModelName: key === 'systemModelName' ? value : current.systemModelName,
          systemOutputLanguage: current.systemOutputLanguage,
          taggerMode: current.taggerMode,
          taggerApiProfileId: current.taggerApiProfileId,
          taggerModelName: current.taggerModelName,
          summarizerMode: current.summarizerMode,
          summarizerApiProfileId: current.summarizerApiProfileId,
          summarizerModelName: current.summarizerModelName,
          narrativeStateMode: current.narrativeStateMode,
          narrativeStateApiProfileId: current.narrativeStateApiProfileId,
          narrativeStateModelName: current.narrativeStateModelName,
          retrievalPlannerMode: current.retrievalPlannerMode,
          retrievalPlannerApiProfileId: current.retrievalPlannerApiProfileId,
          retrievalPlannerModelName: current.retrievalPlannerModelName,
          agenticGate: current.agenticGate,
          agenticToolProtocol: current.agenticToolProtocol
        }
      };
      await handleSaveSettings(newSettings);
    }, 300);
  };

  const openNewApiForm = () => {
    setEditingApiId(null);
    setApiName('');
    setApiProvider('OpenRouter');
    setApiBaseUrl('');
    setShowBaseUrl(false);
    setApiKey('');
    setGcpProjectId('');
    setGcpRegion('us-central1');
    setGcpServiceAccount('');
    setAwsAccessKeyId('');
    setAwsSecretAccessKey('');
    setAwsRegion('us-east-1');
    setModelsList([]);
    setNewModelName('');
    setFocusModelInput(false);
    setShowAddApiForm(true);
  };

  const openEditApiForm = (apiProf) => {
    setEditingApiId(apiProf.id);
    setApiName(apiProf.name);
    setApiProvider(apiProf.provider);
    setApiBaseUrl(apiProf.baseUrl || '');
    setShowBaseUrl(apiProf.provider === 'Local' || !!apiProf.baseUrl);
    setApiKey(apiProf.apiKey || '');

    let cfg = {};
    if (apiProf.customConfig) {
      try {
        cfg = typeof apiProf.customConfig === 'string' ? JSON.parse(apiProf.customConfig) : apiProf.customConfig;
      } catch (e) {
        console.error("Failed to parse customConfig in openEditApiForm:", e);
      }
    }
    setGcpProjectId(cfg.gcpProjectId || '');
    setGcpRegion(cfg.gcpRegion || 'us-central1');
    setGcpServiceAccount(cfg.gcpServiceAccount || '');
    setAwsAccessKeyId(cfg.awsAccessKeyId || '');
    setAwsSecretAccessKey(cfg.awsSecretAccessKey || '');
    setAwsRegion(cfg.awsRegion || 'us-east-1');

    setModelsList(apiProf.models ? (typeof apiProf.models === 'string' ? JSON.parse(apiProf.models) : apiProf.models) : []);
    setNewModelName('');
    setFocusModelInput(false);
    setShowAddApiForm(true);
  };

  const handleAddModel = () => {
    if (!newModelName.trim()) return;
    if (modelsList.includes(newModelName.trim())) return;
    setModelsList(prev => [...prev, newModelName.trim()]);
    setNewModelName('');
  };

  const removeModel = (modelName) => {
    setModelsList(prev => prev.filter(m => m !== modelName));
  };

  const handleSaveApi = async () => {
    if (!apiName.trim()) return;

    const normalizedBaseUrl = apiBaseUrl.trim();
    if (apiProvider === 'Local' && !normalizedBaseUrl) {
      showToast('Local API connections require a Base URL.', 'error');
      return;
    }
    if (normalizedBaseUrl) {
      try {
        const parsedUrl = new URL(normalizedBaseUrl);
        if (!['http:', 'https:'].includes(parsedUrl.protocol)) throw new Error();
      } catch {
        showToast('Base URL must be a valid HTTP or HTTPS URL.', 'error');
        return;
      }
    }

    const targetId = editingApiId || 'api_' + Math.random().toString(36).substr(2, 9);
    const customConfigObj = {
      gcpProjectId: gcpProjectId.trim(),
      gcpRegion: gcpRegion.trim(),
      gcpServiceAccount: gcpServiceAccount.trim(),
      awsAccessKeyId: awsAccessKeyId.trim(),
      awsSecretAccessKey: awsSecretAccessKey.trim(),
      awsRegion: awsRegion.trim()
    };

    const apiObject = {
      id: targetId,
      name: apiName.trim(),
      provider: apiProvider,
      baseUrl: normalizedBaseUrl,
      apiKey: apiKey.trim(),
      customConfig: JSON.stringify(customConfigObj),
      models: JSON.stringify(modelsList),
      // The request limit lives in each workspace; a connection no longer carries one of its own.
      contextWindow: null
    };

    await handleSaveApiProfile(apiObject);
    setShowAddApiForm(false);
    setEditingApiId(null);
  };

  // Data helpers
  const handleOpenWorkspace = () => {
    if (electronAPI.openWorkspaceFolder) electronAPI.openWorkspaceFolder();
  };

  const handleOpenMigrationBackups = () => {
    if (electronAPI.openMigrationBackupsFolder) electronAPI.openMigrationBackupsFolder();
  };

  const describeMigrationBackup = (backup) => {
    const date = new Date(backup.createdAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
    const from = backup.fromVersion === 'unknown' ? 'an earlier version' : backup.fromVersion;
    const size = `${(backup.bytes / (1024 * 1024)).toFixed(1)} MB`;
    return { date, versions: `${from} to ${backup.toVersion}`, size };
  };

  const handleBackup = async () => {
    if (electronAPI.backupWorkspace) {
      try {
        const result = await electronAPI.backupWorkspace();
        if (result && result.success) {
          setBackupStatus({ success: true, path: result.filePath });
        } else if (result && result.cancelled) {
          // cancelled by user selection
        } else {
          setBackupStatus({ success: false, error: 'Database export failed' });
        }
      } catch (err) {
        setBackupStatus({ success: false, error: err.message || 'Backup error occurred' });
      }
    }
  };

  const handleRestore = async () => {
    if (electronAPI.restoreWorkspace) {
      try {
        setRestoring(true);
        const result = await electronAPI.restoreWorkspace();
        if (result && result.success) {
          // Keep restoring state true as the app will relaunch in 1 second.
        } else {
          setRestoring(false);
          if (result && result.error) {
            setUtilityStatus({
              title: 'Restore Failed',
              message: result.error
            });
          }
        }
      } catch (err) {
        setRestoring(false);
        setUtilityStatus({
          title: 'Restore Failed',
          message: err.message || 'An error occurred during workspace restore.'
        });
      }
    }
  };

  const handlePurgeVectors = async () => {
    setConfirmAction(null);
    if (electronAPI.purgeVectors) {
      try {
        const res = await electronAPI.purgeVectors();
        if (res && res.success) {
          setUtilityStatus({
            title: 'Purge Complete',
            message: 'All cached vector database indexes have been purged successfully.'
          });
        }
      } catch (e) {
        setUtilityStatus({
          title: 'Purge Failed',
          message: e.message || 'An error occurred while purging indexes.'
        });
      }
    }
  };

  const handleClearCache = async () => {
    setConfirmAction(null);
    if (electronAPI.clearModelCache) {
      try {
        const res = await electronAPI.clearModelCache();
        if (res && res.success) {
          setUtilityStatus({
            title: 'Cache Cleared',
            message: 'Xenova HuggingFace embedding cache folder deleted successfully.'
          });
        }
      } catch (e) {
        setUtilityStatus({
          title: 'Clear Cache Failed',
          message: e.message || 'An error occurred while clearing cache.'
        });
      }
    }
  };

  const parseModels = (profile) => {
    if (!profile?.models) return [];
    try { return typeof profile.models === 'string' ? JSON.parse(profile.models) : profile.models; } catch { return []; }
  };
  const modelsOfConnection = (id) => parseModels(apiProfiles.find(ap => ap.id === id));
  const connectionOptions = apiProfiles.map(ap => ({ value: ap.id, label: ap.name }));
  const modelOptions = (id, emptyLabel) => [{ value: '', label: id ? emptyLabel : 'Pick a connection first' }, ...modelsOfConnection(id).map(m => ({ value: m, label: m }))];

  const roleStates = {
    narrativeState: { mode: narrativeStateMode, apiProfileId: narrativeStateApiProfileId, modelName: narrativeStateModelName },
    tagger: { mode: taggerMode, apiProfileId: taggerApiProfileId, modelName: taggerModelName },
    retrievalPlanner: { mode: retrievalPlannerMode, apiProfileId: retrievalPlannerApiProfileId, modelName: retrievalPlannerModelName },
    summarizer: { mode: summarizerMode, apiProfileId: summarizerApiProfileId, modelName: summarizerModelName },
  };
  const roleReady = (state) => state.mode === 'disabled' || state.mode === 'off' || state.mode === 'profile'
    || (state.mode === 'inherit-system' ? systemAiReady : Boolean(state.apiProfileId && state.modelName && modelsOfConnection(state.apiProfileId).includes(state.modelName)));
  const rolesNeedSetup = !systemAiReady || AI_ENGINE_ROLE_DEFINITIONS.some(definition => !roleReady(roleStates[definition.id]));

  const connectionUsers = (id) => {
    const profiles = writingProfiles.filter(profile => profile.apiProfileId === id);
    const engine = [];
    if (systemApiProfileId === id) engine.push('System AI');
    AI_ENGINE_ROLE_DEFINITIONS.forEach(definition => {
      const state = roleStates[definition.id];
      if (state.mode === 'dedicated' && state.apiProfileId === id) engine.push(definition.title);
    });
    if (embeddingEngine === 'external' && embeddingApiProfileId === id) engine.push('Embeddings');
    return { profiles, engine };
  };

  const duplicateConnection = async (ap) => {
    await handleSaveApiProfile({ ...ap, id: 'api_' + Math.random().toString(36).substr(2, 9), name: `${ap.name} copy` });
  };

  const goTo = (tab) => {
    setActiveTab(tab);
    setShowAddApiForm(false);
    setSearchQuery('');
  };

  const query = searchQuery.trim().toLowerCase();
  const searchResults = query
    ? SEARCH_INDEX.filter(entry => `${entry.label} ${entry.keywords || ''}`.toLowerCase().includes(query)).slice(0, 12)
    : [];

  const totalModels = apiProfiles.reduce((sum, ap) => sum + parseModels(ap).length, 0);
  const provider = PROVIDERS.find(p => p.value === apiProvider) || PROVIDERS[0];
  const canSaveApi = apiName.trim() && modelsList.length > 0;

  const strictnessPct = Math.round(similarity * 100);
  const strictnessLabel = strictnessPct === 0 ? 'Everything is retrieved, no filtering'
    : strictnessPct < 30 ? 'Very broad, may include loosely related material'
      : strictnessPct < 45 ? 'Balanced, good for wide questions'
        : strictnessPct < 65 ? 'Moderate, a solid general setting'
          : strictnessPct < 85 ? 'Focused, good for specific lookups'
            : strictnessPct < 100 ? 'Strict, only strong matches get through' : 'Exact, only the closest matches';

  // ------------------------------------------------------------------ pages

  const connectionsPage = () => (
    <>
      <SettingsHeader
        title="Connections"
        description="Where requests go. Your AI profiles and Kallamo’s own roles pick their models from these."
        actions={<Button icon={Plus} onClick={openNewApiForm}>Add connection</Button>}
      />
      {apiProfiles.length === 0 ? (
        <SettingsGroup title="Your connections">
          <div className="px-[1.125rem] py-6">
            <p className="text-sm font-semibold text-text-primary">No connections yet</p>
            <p className="mt-1 max-w-lg text-[0.8125rem] leading-relaxed text-text-muted">Add one to give your AI profiles a model to reply with. It can be a cloud provider with an API key, or a model running on this computer.</p>
          </div>
        </SettingsGroup>
      ) : (
        <SettingsGroup title="Your connections" aside={`${apiProfiles.length} connection${apiProfiles.length === 1 ? '' : 's'} · ${totalModels} model${totalModels === 1 ? '' : 's'}`}>
          {apiProfiles.map(ap => (
            <ConnectionRow
              key={ap.id}
              connection={ap}
              models={parseModels(ap)}
              users={connectionUsers(ap.id)}
              onEdit={() => openEditApiForm(ap)}
              onDuplicate={() => duplicateConnection(ap)}
              onAddModel={() => { openEditApiForm(ap); setFocusModelInput(true); }}
              onDelete={() => setConnectionToDelete(ap)}
            />
          ))}
        </SettingsGroup>
      )}
      <SettingsGroup title="Adding a local server?">
        <div className="flex items-start gap-3 px-[1.125rem] py-3.5">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-text-subtle" aria-hidden="true" />
          <p className="text-[0.8125rem] leading-relaxed text-text-muted">
            Choose <b className="font-semibold text-text-secondary">Local or compatible</b> with a base URL ending in <code className="font-mono text-text-secondary">/v1</code>, like <code className="font-mono text-text-secondary">http://127.0.0.1:1234/v1</code> for LM Studio. Then list the models the server has loaded.
          </p>
        </div>
      </SettingsGroup>
    </>
  );

  const connectionEditor = () => (
    <>
      <SettingsHeader
        back={{ label: 'Connections', onClick: () => setShowAddApiForm(false) }}
        title={editingApiId ? apiName || 'Connection' : 'New connection'}
        description={editingApiId ? `${provider.label} · used by ${describeUsers(connectionUsers(editingApiId)) || 'nothing yet'}` : 'Choose where the models run, then list the ones you want to use.'}
        actions={(
          <>
            <Button variant="subtle" onClick={() => setShowAddApiForm(false)}>Cancel</Button>
            <Button onClick={handleSaveApi} disabled={!canSaveApi}>{editingApiId ? 'Save connection' : 'Create connection'}</Button>
          </>
        )}
      />

      <SettingsGroup title="Provider">
        <div role="radiogroup" aria-label="Provider" className="grid grid-cols-2 gap-2 p-3.5 lg:grid-cols-4">
          {PROVIDERS.map(p => {
            const selected = p.value === apiProvider;
            return (
              <button
                key={p.value}
                type="button"
                role="radio"
                aria-checked={selected}
                onClick={() => { setApiProvider(p.value); if (p.value === 'Local') setShowBaseUrl(true); }}
                className={`flex min-w-0 items-center gap-2.5 rounded-[0.625rem] border px-3 py-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${selected ? 'border-accent/55 bg-accent/[0.05]' : 'border-tint/[0.08] hover:border-tint/[0.16]'}`}
              >
                <ProviderMark provider={p.value} size="sm" />
                <span className="min-w-0">
                  <span className={`block truncate text-[0.8125rem] font-semibold ${selected ? 'text-text-primary' : 'text-text-secondary'}`}>{p.label}</span>
                  <span className="caption block truncate">{p.sub}</span>
                </span>
              </button>
            );
          })}
        </div>
      </SettingsGroup>

      <SettingsGroup title="Details">
        <SettingsRow label="Name" description="How it appears in profiles and roles.">
          <input value={apiName} onChange={e => setApiName(e.target.value)} placeholder={provider.namePlaceholder} className={`${fieldClass} w-80`} />
        </SettingsRow>
        {apiProvider === 'Vertex AI' ? (
          <>
            <SettingsRow label="Project ID" description="From your Google Cloud console.">
              <input value={gcpProjectId} onChange={e => setGcpProjectId(e.target.value)} placeholder="my-writing-project" className={`${fieldClass} w-80`} />
            </SettingsRow>
            <SettingsRow label="Region" description="Where the Vertex endpoint runs.">
              <input value={gcpRegion} onChange={e => setGcpRegion(e.target.value)} placeholder="us-central1" className={`${fieldClass} w-80`} />
            </SettingsRow>
            <SettingsRow label="Service account key" description="Paste the whole JSON file you downloaded." align="start">
              <textarea value={gcpServiceAccount} onChange={e => setGcpServiceAccount(e.target.value)} placeholder={'{"type": "service_account", ...}'} rows={4} className={`${fieldClass} w-80 resize-none py-2 font-mono text-xs custom-scrollbar`} />
            </SettingsRow>
          </>
        ) : apiProvider === 'AWS Bedrock' ? (
          <>
            <SettingsRow label="Access key ID" description="From your AWS IAM credentials.">
              <input value={awsAccessKeyId} onChange={e => setAwsAccessKeyId(e.target.value)} placeholder="AKIA…" className={`${fieldClass} w-80 font-mono`} />
            </SettingsRow>
            <SettingsRow label="Secret access key">
              <SecretInput value={awsSecretAccessKey} onChange={setAwsSecretAccessKey} placeholder="The secret that goes with the key ID" shown={showApiKey} onToggle={() => setShowApiKey(!showApiKey)} />
            </SettingsRow>
            <SettingsRow label="Region" description="Where your Bedrock models are enabled.">
              <input value={awsRegion} onChange={e => setAwsRegion(e.target.value)} placeholder="us-east-1" className={`${fieldClass} w-80`} />
            </SettingsRow>
          </>
        ) : (
          <>
            <SettingsRow
              label="Base URL"
              description={apiProvider === 'Local'
                ? 'Required. Ends in /v1, or a full chat or embeddings endpoint.'
                : ['OpenAI', 'OpenRouter'].includes(apiProvider)
                  ? 'Optional. Only for a proxy or a compatible service. Ends in /v1.'
                  : 'Optional. The provider’s complete endpoint, used exactly as entered.'}
            >
              <input value={apiBaseUrl} onChange={e => setApiBaseUrl(e.target.value)} placeholder={provider.urlPlaceholder} className={`${fieldClass} w-80 font-mono text-[0.8125rem]`} />
            </SettingsRow>
            <SettingsRow label="API key" description={apiProvider === 'Local' ? 'Optional. Most local servers do not need one.' : 'Stored on this computer only.'}>
              <SecretInput value={apiKey} onChange={setApiKey} placeholder={provider.keyPlaceholder} shown={showApiKey} onToggle={() => setShowApiKey(!showApiKey)} />
            </SettingsRow>
          </>
        )}
      </SettingsGroup>

      <SettingsGroup title="Models" aside="Profiles and roles choose from these">
        <form
          className="flex gap-2.5 px-[1.125rem] py-3"
          onSubmit={e => { e.preventDefault(); handleAddModel(); }}
        >
          <input
            value={newModelName}
            onChange={e => setNewModelName(e.target.value)}
            autoFocus={focusModelInput}
            placeholder={`Type a model ID, like ${provider.modelPlaceholder}`}
            className={`${fieldClass} flex-1 font-mono text-[0.8125rem]`}
          />
          <Button type="submit" variant="ghost" size="sm" icon={Plus} disabled={!newModelName.trim()}>Add</Button>
        </form>
        {modelsList.length === 0 ? (
          <p className="border-t border-tint/[0.055] px-[1.125rem] py-3 text-[0.8125rem] text-text-muted">No models yet. Add at least one.</p>
        ) : modelsList.map(m => (
          <div key={m} className="flex items-center gap-3 border-t border-tint/[0.055] px-[1.125rem] py-2.5">
            <span className="min-w-0 flex-1 truncate font-mono text-[0.8125rem] text-text-secondary">{m}</span>
            <IconButton icon={X} label={`Remove ${m}`} size="sm" tone="danger" onClick={() => removeModel(m)} />
          </div>
        ))}
      </SettingsGroup>

    </>
  );

  const modelBar = (owner, apiProfileId, modelName, onConnection, onModel) => (
    <>
      <SelectMenu unboxed="strong" ariaLabel={`${owner} connection`} className="w-48 shrink-0 [&_button]:text-[0.8125rem]" value={apiProfileId} onChange={onConnection} options={[{ value: '', label: 'Choose a connection' }, ...connectionOptions]} />
      <span className="my-2 w-px self-stretch bg-tint/[0.08]" aria-hidden="true" />
      <SelectMenu unboxed="strong" ariaLabel={`${owner} model`} className="min-w-0 flex-1 font-mono [&_button]:text-[0.8125rem]" value={modelName} onChange={onModel} options={modelOptions(apiProfileId, 'Choose a model')} />
    </>
  );

  const roleStatus = (definition, state) => {
    if (state.mode === 'inherit-system') {
      return (
        <span className="flex min-w-0 items-center gap-2 px-3.5 text-[0.8125rem] text-text-muted">
          <Cpu className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span className="whitespace-nowrap">Same as System AI</span>
          {systemModelName && <span className="truncate font-mono text-xs text-text-subtle">{systemModelName}</span>}
        </span>
      );
    }
    const text = state.mode === 'profile' ? 'Uses the model of the profile that replies.' : ROLE_OFF_COPY[definition.id] || definition.modes.find(mode => mode.value === state.mode)?.description;
    return (
      <span className="flex min-w-0 items-center gap-2 px-3.5 text-[0.8125rem] text-text-subtle">
        {state.mode !== 'profile' && <CircleOff className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
        <span className="truncate">{text}</span>
      </span>
    );
  };

  const rolesPage = () => (
    <>
      <SettingsHeader title="AI roles" description="Kallamo’s helpers that work behind the scenes. Your AI profiles still write every reply." />
      <SettingsGroup title="Default model" id="system-ai-config">
        <div className="flex gap-4 px-5 py-[1.125rem]">
          <IconTile icon={Cpu} color="var(--app-accent)" />
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline gap-2.5">
              <span className="text-[0.9375rem] font-bold text-text-primary">System AI</span>
              <span className="text-xs font-semibold text-accent">Default</span>
            </div>
            <p className="mt-1 text-[0.8125rem] leading-relaxed text-text-muted">Every role set to System AI uses this model.</p>
            <div className="mt-3.5 flex min-h-[2.875rem] items-center overflow-hidden rounded-xl border border-tint/[0.08] bg-surface-inset">
              {modelBar('System AI', systemApiProfileId, systemModelName, value => updateSetting('advanced', 'systemApiProfileId', value), value => updateSetting('advanced', 'systemModelName', value))}
            </div>
            {!systemAiReady && (
              <p className="mt-2.5 flex items-center gap-2 text-[0.8125rem] text-status-warning">
                <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{systemAiRequirement} Roles set to System AI wait for it.
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-4 border-t border-tint/[0.055] px-5 py-4">
          <IconTile icon={Languages} color="var(--theme-mode-always)" />
          <div className="min-w-0 flex-1">
            <div className="text-[0.9375rem] font-bold text-text-primary">Language for AI notes</div>
            <p className="mt-0.5 text-[0.8125rem] leading-relaxed text-text-muted">Summaries, analysis and research are written in it. It does not change how your profiles reply, and names and quotes are never translated.</p>
          </div>
          <SelectMenu ariaLabel="Language for AI notes" className="w-52 shrink-0" value={systemOutputLanguage} onChange={value => updateSetting('advanced', 'systemOutputLanguage', value)} options={SYSTEM_AI_LANGUAGES.map(l => ({ value: l.value, label: l.label }))} />
        </div>
      </SettingsGroup>

      <section id="ai-engine-roles-config" className="scroll-mt-6">
        <div className="mb-2.5 mt-7 flex items-baseline justify-between gap-4">
          <h2 className="text-[0.8125rem] font-semibold text-text-secondary">Roles</h2>
          <span className="caption text-right">Each one can share System AI, run its own model, or be off</span>
        </div>
        <div className="flex flex-col gap-3">
          {AI_ENGINE_ROLE_DEFINITIONS.map(definition => {
            const state = roleStates[definition.id];
            const off = state.mode === 'disabled' || state.mode === 'off';
            const ready = roleReady(state);
            const look = ROLE_LOOK[definition.id];
            const update = key => value => updateSetting('advanced', `${definition.id}${key}`, value);
            return (
              <div key={definition.id} className="overflow-hidden rounded-xl border border-tint/[0.08] surface-card">
                <div className="flex gap-4 px-5 py-[1.125rem]">
                  <IconTile icon={look.icon} color={look.color} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline gap-2.5">
                      <span className="text-[0.9375rem] font-bold text-text-primary">{definition.title}</span>
                      <span className="text-xs font-semibold" style={{ color: look.color }}>{look.where}</span>
                    </div>
                    <p className="mt-1 max-w-[35rem] text-[0.8125rem] leading-relaxed text-text-muted">{ROLE_COPY[definition.id]}</p>
                    <div className="mt-3.5">
                      <RunsOnBar
                        mode={(
                          <SegmentedControl
                            bare
                            label={`${definition.title}, how it runs`}
                            value={state.mode}
                            onChange={update('Mode')}
                            options={definition.modes.map(mode => ({ value: mode.value, label: MODE_LABELS[mode.value] || mode.label, tooltip: mode.description }))}
                          />
                        )}
                      >
                        {state.mode === 'dedicated'
                          ? <div className="flex min-w-0 flex-1 items-center self-stretch bg-tint/[0.035]">{modelBar(definition.title, state.apiProfileId, state.modelName, update('ApiProfileId'), update('ModelName'))}</div>
                          : roleStatus(definition, state)}
                      </RunsOnBar>
                    </div>
                    {!ready && (
                      <p className="mt-2.5 flex items-center gap-2 text-[0.8125rem] text-status-warning">
                        <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                        {state.mode === 'inherit-system' ? 'Waiting for System AI above.' : 'Choose a connection and a model for this role.'}
                      </p>
                    )}
                  </div>
                </div>
                {definition.id === 'tagger' && (
                  <RoleOptions disabled={off}>
                    <SettingsRow label="Propose unknown entities" description="Suggests new Worldbuild entries for names it cannot match. You review them first.">
                      <Toggle checked={allowAiEntityCreation} disabled={off} ariaLabel="Propose unknown entities" onChange={value => updateSetting('advanced', 'allowAiEntityCreation', value)} />
                    </SettingsRow>
                  </RoleOptions>
                )}
                {definition.id === 'retrievalPlanner' && (
                  <RoleOptions disabled={off}>
                    <SettingsRow label="Plan every message" description="Off: short follow-ups with no name or question skip planning and use a plain search.">
                      <Toggle checked={agenticGate === 'always'} disabled={off} ariaLabel="Plan every message" onChange={checked => updateSetting('advanced', 'agenticGate', checked ? 'always' : 'auto')} />
                    </SettingsRow>
                    <SettingsRow label="Native tool calling" description="Uses the provider’s own tools when it can, the text protocol when it cannot.">
                      <Toggle checked={agenticToolProtocol !== 'text'} disabled={off} ariaLabel="Native tool calling" onChange={checked => updateSetting('advanced', 'agenticToolProtocol', checked ? 'auto' : 'text')} />
                    </SettingsRow>
                  </RoleOptions>
                )}
                {definition.id === 'summarizer' && (
                  <RoleOptions disabled={off}>
                    <SettingsRow label="Archive summaries" description="A title and a short summary for each archived conversation.">
                      <Toggle checked={archiveSummarization} disabled={off} ariaLabel="Archive summaries" onChange={value => updateSetting('advanced', 'archiveSummarization', value)} />
                    </SettingsRow>
                  </RoleOptions>
                )}
              </div>
            );
          })}
        </div>
      </section>
    </>
  );

  const generationPage = () => (
    <>
      <SettingsHeader title="Generation" description="How requests are sent and how replies arrive." />
      <SettingsGroup title="Replies">
        <SettingsRow label="Stream replies" description="Show the reply as it is written. Also avoids timeouts on slow local models. Providers without streaming fall back on their own.">
          <Toggle checked={streamingEnabled} ariaLabel="Stream replies" onChange={value => updateSetting('advanced', 'streaming', value)} />
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup title="Prompt cache" aside="Cached input is billed at a fraction of the price">
        <SettingsRow label="Use the prompt cache" description="Send the unchanging part of every request first, so the provider can reuse it. Off sends requests exactly as older versions did.">
          <Toggle checked={promptCache} ariaLabel="Use the prompt cache" onChange={value => updateSetting('advanced', 'promptCache', value)} />
        </SettingsRow>
        {promptCache && (
          <div className="mx-[1.125rem] mb-3.5 border-l-2 border-tint/[0.08] pl-4">
            <p className="caption mb-0.5">Where retrieved context, the clock and attachments go</p>
            <SettingsRadio checked={promptCacheContextPlacement === 'system'} onSelect={() => updateSetting('advanced', 'promptCacheContextPlacement', 'system')} label="In the system prompt" description="Where it has always been." />
            <SettingsRadio checked={promptCacheContextPlacement === 'turn'} onSelect={() => updateSetting('advanced', 'promptCacheContextPlacement', 'turn')} label="Next to your message" description="The history gets cached too, a bigger saving on long chats. The model reads context in a new place, so compare on one workspace first." />
          </div>
        )}
      </SettingsGroup>
    </>
  );

  const retrievalCounts = [
    ['profileKnowledgeTopK', 'Profile knowledge', 'passages', profileKnowledgeTopK],
    ['workspaceDocumentsTopK', 'Workspace files', 'passages', workspaceDocumentsTopK],
    ['longTermMemoryTopK', 'Long-term memory', 'passages', longTermMemoryTopK],
    ['worldbuildEntityLimit', 'Worldbuild', 'entities', worldbuildEntityLimit],
  ];

  const retrievalPage = () => (
    <>
      <SettingsHeader title="Retrieval" description="How much Kallamo looks up for each reply, and how close a match must be." />
      <SettingsGroup title="Each search brings at least" aside="More, up to 20, when the request has room" id="retrieval-config">
        <div className="grid grid-cols-2 lg:grid-cols-4">
          {retrievalCounts.map(([key, label, unit, value], index) => (
            <div key={key} className={`px-[1.125rem] py-4 ${index ? 'lg:border-l lg:border-tint/[0.055]' : ''}`}>
              <div className="text-[0.8125rem] font-semibold text-text-primary">{label}</div>
              <div className="mt-3 flex items-center gap-2">
                <NumberInput
                  value={Number(value)}
                  onChange={next => updateSettingWithDebounce(key, next)}
                  {...rangeProps(RETRIEVAL_SETTING_DEFINITIONS[key])}
                  aria-label={label}
                  className={`${fieldClass} w-16 text-center tabular-nums`}
                />
                <span className="caption">{unit}</span>
              </div>
            </div>
          ))}
        </div>
        {Number(worldbuildEntityLimit) > 30 && (
          <p className="flex items-center gap-2 border-t border-tint/[0.055] px-[1.125rem] py-2.5 text-[0.8125rem] text-status-warning">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />More than 30 Worldbuild entities can slow retrieval and crowd the context in connected worlds.
          </p>
        )}
      </SettingsGroup>
      <SettingsGroup title="Matching">
        <div className="px-[1.125rem] py-4">
          <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
            <span className="text-sm font-semibold text-text-primary">Strictness</span>
            <span className="text-sm font-bold tabular-nums text-text-primary">{strictnessPct}%</span>
            <span className="text-[0.8125rem] text-text-muted">{strictnessLabel}</span>
            <span className="caption ml-auto">Names, IDs and linked facts always get through</span>
          </div>
          <input type="range" min="0" max="1" step="0.05" value={similarity} aria-label="Strictness" onChange={e => updateSettingWithDebounce('similarity', parseFloat(e.target.value))} className="mt-3 w-full cursor-pointer accent-accent" />
          <div className="mt-1 flex justify-between text-xs text-text-subtle">
            {['Broad', 'Balanced', 'Moderate', 'Focused', 'Strict'].map(band => <span key={band}>{band}</span>)}
          </div>
        </div>
        <SettingsRow label="Worldbuild breadth" description={BREADTH_COPY[worldbuildBreadth] || BREADTH_COPY.balanced}>
          <SegmentedControl label="Worldbuild breadth" value={worldbuildBreadth} onChange={value => updateSettingWithDebounce('worldbuildBreadth', value)} options={[{ value: 'focused', label: 'Focused' }, { value: 'balanced', label: 'Balanced' }, { value: 'broad', label: 'Broad' }]} />
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup title="Files">
        <SettingsRow label="Passage length" description="Characters in each searchable piece of an imported file.">
          <NumberInput value={Number(chunkSize)} onChange={next => updateSettingWithDebounce('chunkSize', next)} min={200} max={1000} step={50} aria-label="Passage length" className={`${fieldClass} w-20 text-center tabular-nums`} />
          <span className="caption">characters</span>
        </SettingsRow>
      </SettingsGroup>
    </>
  );

  const chooseLocalEngine = async () => {
    if (isPlatformUnsupported) return;
    updateSetting('advanced', 'embeddingEngine', 'local');
    if (!engineStatus.installed) await downloadEngine();
  };

  const embeddingsPage = () => (
    <>
      <SettingsHeader title="Embeddings" description="The model that turns your files and chats into something Kallamo can search by meaning." />
      <SettingsGroup title="Where it runs" id="embedding-config">
        <div className="px-[1.125rem] py-2">
          <SettingsRadio
            checked={embeddingEngine === 'local'}
            disabled={isPlatformUnsupported}
            onSelect={chooseLocalEngine}
            label="On this computer"
            description={isPlatformUnsupported ? 'Not available on Intel Macs. Use a connection instead.' : <>Private and offline, with <span className="font-mono text-xs">multilingual-e5-small</span>.</>}
          >
            {!isPlatformUnsupported && (
              <span className="mt-2.5 flex items-center gap-2.5 text-[0.8125rem] text-text-secondary">
                <span className={`h-2 w-2 rounded-full ${engineStatus.installed ? 'bg-emerald-400' : 'bg-tint/30'}`} aria-hidden="true" />
                {engineStatus.installed ? `Installed · ${engineStatus.platform}-${engineStatus.arch}` : 'Not installed yet. It downloads when first needed.'}
                {engineStatus.installed
                  ? <button type="button" onClick={e => { e.preventDefault(); setConfirmAction('deleteEngine'); }} className="font-semibold text-text-muted hover:text-status-danger">Remove</button>
                  : <button type="button" onClick={e => { e.preventDefault(); downloadEngine(); }} className="font-semibold text-accent hover:brightness-110">Download</button>}
              </span>
            )}
          </SettingsRadio>
        </div>
        <div className="border-t border-tint/[0.055] px-[1.125rem] py-2">
          <SettingsRadio
            checked={embeddingEngine === 'external'}
            onSelect={() => updateSetting('advanced', 'embeddingEngine', 'external')}
            label="Through a connection"
            description={<>A provider’s embedding model, such as <span className="font-mono text-xs">text-embedding-3-small</span> from OpenAI or <span className="font-mono text-xs">text-embedding-004</span> from Google.</>}
          />
          {embeddingEngine === 'external' && (
            <div className="mb-2 ml-7 mt-1 flex flex-wrap gap-2.5">
              <SelectMenu ariaLabel="Embedding connection" className="w-56" value={embeddingApiProfileId} onChange={value => updateSetting('advanced', 'embeddingApiProfileId', value)} options={[{ value: '', label: 'Choose a connection' }, ...connectionOptions]} />
              <input value={embeddingModelName} onChange={e => updateSettingWithDebounce('embeddingModelName', e.target.value)} placeholder="text-embedding-3-small" aria-label="Embedding model" className={`${fieldClass} w-64 font-mono text-[0.8125rem]`} />
            </div>
          )}
        </div>
      </SettingsGroup>
      <SettingsGroup title="On this computer" id="embedding-runtime-config">
        <SettingsRow label="Runs on" description="Native is the stable choice. WebAssembly is the fallback.">
          <SegmentedControl label="Runs on" value={executionDevice} onChange={value => updateSetting('advanced', 'executionDevice', value)} options={[{ value: 'cpu', label: 'Native CPU' }, { value: 'wasm', label: 'WebAssembly' }]} />
        </SettingsRow>
        <SettingsRow label="Downloaded model files" description="Cleared files download again the next time something is indexed.">
          <Button variant="ghost" size="sm" icon={RefreshCw} onClick={() => setConfirmAction('clearCache')}>Clear cache</Button>
        </SettingsRow>
      </SettingsGroup>
    </>
  );

  const previewFont = fontFamily === 'serif' ? 'font-serif' : fontFamily === 'monospace' ? 'font-mono' : 'font-sans';

  const appearancePage = () => (
    <>
      <SettingsHeader title="Appearance" description="How Kallamo looks. Changes apply right away." />
      <div className="grid gap-7 xl:grid-cols-[minmax(0,1fr)_21rem]">
        <div className="min-w-0">
          <SettingsGroup title="Look">
            <SettingsRow label="Accent" description="Active items, the main action and the light at the top of each page.">
              <div className="flex gap-2.5">
                {colors.map(c => (
                  <button
                    key={c}
                    type="button"
                    aria-label={`Accent ${c}`}
                    aria-pressed={accentColor === c}
                    onClick={() => updateSetting('interface', 'accentColor', c)}
                    style={{ backgroundColor: c, boxShadow: accentColor === c ? '0 0 0 2px var(--theme-surface-raised), 0 0 0 4px var(--theme-text-primary)' : 'inset 0 0 0 1px color-mix(in srgb, var(--theme-tint) 12%, transparent)' }}
                    className="h-5 w-5 rounded-full transition-transform hover:scale-110 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                  />
                ))}
              </div>
            </SettingsRow>
            <SettingsRow label="Font">
              <SegmentedControl label="Font" value={fontFamily} onChange={value => updateSetting('interface', 'fontFamily', value)} options={[{ value: 'sans', label: 'Inter' }, { value: 'serif', label: 'Merriweather' }, { value: 'monospace', label: 'JetBrains Mono' }]} />
            </SettingsRow>
            <SettingsRow label="Text size">
              <SegmentedControl label="Text size" value={fontSize} onChange={value => updateSetting('interface', 'fontSize', value)} options={[{ value: 'small', label: 'Small' }, { value: 'medium', label: 'Medium' }, { value: 'large', label: 'Large' }]} />
            </SettingsRow>
            <SettingsRow label="Background blur" description="Turn off on slower computers.">
              <Toggle checked={blurEnabled} ariaLabel="Background blur" onChange={value => updateSetting('interface', 'blur', value)} />
            </SettingsRow>
          </SettingsGroup>
          <SettingsGroup title="Chat">
            <SettingsRow label="Layout" description="Speech bubbles, or one continuous page.">
              <div role="radiogroup" aria-label="Chat layout" className="flex gap-2.5">
                <OptionTile kind="bubbles" label="Bubbles" selected={layoutMode === 'bubbles'} onSelect={() => updateSetting('interface', 'layout', 'bubbles')} />
                <OptionTile kind="document" label="Document" selected={layoutMode === 'document'} onSelect={() => updateSetting('interface', 'layout', 'document')} />
              </div>
            </SettingsRow>
            <SettingsRow label="Code theme">
              <SelectMenu ariaLabel="Code theme" className="w-44" value={codeTheme} onChange={value => updateSetting('interface', 'codeTheme', value)} options={[{ value: 'github-dark', label: 'GitHub Dark' }, { value: 'atom-one-dark', label: 'Atom One Dark' }, { value: 'tokyo-night-dark', label: 'Tokyo Night Dark' }]} />
            </SettingsRow>
            <SettingsRow label="Line numbers in code">
              <Toggle checked={lineNumbers} ariaLabel="Line numbers in code" onChange={value => updateSetting('interface', 'lineNumbers', value)} />
            </SettingsRow>
          </SettingsGroup>
          <SettingsGroup title="Writing Desk">
            <SettingsRow label="Formatting toolbar" description="Fixed at the top, or over the selection.">
              <div role="radiogroup" aria-label="Formatting toolbar" className="flex gap-2.5">
                <OptionTile kind="fixed" label="Fixed" selected={writingToolbar === 'fixed'} onSelect={() => updateSetting('interface', 'writingToolbar', 'fixed')} />
                <OptionTile kind="bubble" label="Bubble" selected={writingToolbar === 'bubble'} onSelect={() => updateSetting('interface', 'writingToolbar', 'bubble')} />
              </div>
            </SettingsRow>
            <SettingsRow label="Smart typography" description="Curly quotes, dashes and ellipses as you type, in documents only.">
              <Toggle checked={smartTypography} ariaLabel="Smart typography" onChange={value => updateSetting('interface', 'smartTypography', value)} />
            </SettingsRow>
          </SettingsGroup>
        </div>
        <div className="min-w-0">
          <div className="sticky top-0">
            <h2 className="mb-2.5 mt-7 text-[0.8125rem] font-semibold text-text-secondary">Preview</h2>
            <AppearancePreview layout={layoutMode} fontClass={previewFont} blur={blurEnabled} codeTheme={codeTheme} lineNumbers={lineNumbers} />
          </div>
        </div>
      </div>
    </>
  );

  const dataPage = () => (
    <>
      <SettingsHeader title="Data and backups" description="Everything lives on this computer. Keep a copy somewhere else." />
      <SettingsGroup title="Backups">
        <SettingsRow label="Back up" description="Workspaces, settings and downloaded models, in one file.">
          <Button variant="ghost" size="sm" icon={Database} onClick={handleBackup}>Create backup…</Button>
        </SettingsRow>
        <SettingsRow label="Restore" description="Replaces everything with a backup. Kallamo restarts when it finishes.">
          <Button variant="ghost" size="sm" icon={RefreshCw} onClick={handleRestore}>Restore from file…</Button>
        </SettingsRow>
      </SettingsGroup>
      <SettingsGroup title="Safety copies" aside="Saved before an update changes your data">
        {migrationBackups.length === 0 ? (
          <p className="px-[1.125rem] py-3.5 text-[0.8125rem] text-text-muted">No copies yet. One is saved the first time an update changes your data.</p>
        ) : migrationBackups.map(backup => {
          const { date, versions, size } = describeMigrationBackup(backup);
          return (
            <div key={backup.file} className="flex items-center gap-4 border-t border-tint/[0.055] px-[1.125rem] py-2.5 text-[0.8125rem] first:border-t-0">
              <span className="w-44 shrink-0 tabular-nums text-text-secondary">{date}</span>
              <span className="min-w-0 flex-1 truncate text-text-muted">{versions}</span>
              <span className="shrink-0 tabular-nums text-text-muted">{size}</span>
            </div>
          );
        })}
        <div className="flex items-center gap-4 border-t border-tint/[0.055] px-[1.125rem] py-3">
          <span className="flex-1 text-[0.8125rem] text-text-muted">Restore one with Restore from file.</span>
          <Button variant="ghost" size="sm" icon={FolderOpen} onClick={handleOpenMigrationBackups}>Show folder</Button>
        </div>
      </SettingsGroup>
      <SettingsGroup title="Storage">
        <SettingsRow label="Data folder" description="Databases, documents and images.">
          <Button variant="ghost" size="sm" icon={FolderOpen} onClick={handleOpenWorkspace}>Open folder</Button>
        </SettingsRow>
        <SettingsRow label={<span className="text-status-danger">Search indexes</span>} description="Deleting them means every file must be indexed again before search works.">
          <Button variant="ghost" size="sm" icon={Trash2} className="!text-status-danger hover:!bg-status-danger/10" onClick={() => setConfirmAction('purge')}>Delete indexes…</Button>
        </SettingsRow>
      </SettingsGroup>
    </>
  );

  const diagnosticsPage = () => (
    <>
      <SettingsHeader title="Diagnostics" description="Extra detail under each reply, for checking what the AI received and what it cost." />
      <SettingsGroup title="Under each reply">
        <SettingsRow label="Retrieval and context" description="What was found, what made it in, perspective scopes, and the exact context sent.">
          <Toggle checked={ragDebug} ariaLabel="Retrieval and context" onChange={value => updateSetting('advanced', 'ragDebug', value)} />
        </SettingsRow>
        <SettingsRow label="Agentic retrieval trace" description="Searches, results, stop reason and cost. Never the model’s private reasoning.">
          <Toggle checked={agenticDebug} ariaLabel="Agentic retrieval trace" onChange={value => updateSetting('advanced', 'agenticDebug', value)} />
        </SettingsRow>
        <SettingsRow label="Narrative State" description="Triage, deep analysis, proposals, retries and timing for roleplay turns.">
          <Toggle checked={narrativeStateDebug} ariaLabel="Narrative State" onChange={value => updateSetting('advanced', 'narrativeStateDebug', value)} />
        </SettingsRow>
        <SettingsRow label="Token usage" description="Estimated tokens for the reply, retrieval and Narrative State, each counted once.">
          <Toggle checked={tokenDebug} ariaLabel="Token usage" onChange={value => updateSetting('advanced', 'tokenDebug', value)} />
        </SettingsRow>
      </SettingsGroup>
    </>
  );

  const updateLine = updateStatus === 'downloaded'
    ? { text: `Version ${updateVersion} is ready. Restart Kallamo to install it.`, action: <Button size="sm" onClick={() => electronAPI.installUpdate()}>Restart and install</Button> }
    : updateStatus === 'available'
      ? { text: `Downloading version ${updateVersion}. It installs the next time you restart.` }
      : updateStatus === 'outdated'
        ? { text: `Version ${updateVersion} is available. This system can’t update on its own.`, action: updateOutdatedUrl && <a href={updateOutdatedUrl} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-8 items-center rounded-control bg-accent/90 px-3 text-xs font-semibold text-on-accent hover:bg-accent">Download {updateVersion}</a> }
        : { text: 'Updates download in the background and install when you restart.', action: <span className="inline-flex items-center gap-2 text-[0.8125rem] text-text-secondary"><span className="h-2 w-2 rounded-full bg-status-success shadow-[0_0_0_3px] shadow-status-success/15" aria-hidden="true" />Up to date</span> };

  const aboutPage = () => (
    <>
      <section className="overflow-hidden rounded-[1.25rem] border border-tint/[0.08] bg-[radial-gradient(34rem_18rem_at_14%_50%,var(--theme-glow-cool),transparent_70%),radial-gradient(30rem_16rem_at_100%_0%,color-mix(in_srgb,var(--app-accent)_9%,transparent),transparent_70%),linear-gradient(180deg,var(--theme-surface-raised),var(--theme-surface-raised-low))] shadow-[inset_0_1px_0_var(--theme-highlight),0_1.125rem_2.5rem_-1.5rem_color-mix(in_srgb,var(--theme-shade)_70%,transparent)]">
        <div className="flex items-center gap-7 px-8 pb-6 pt-7">
          <Logo size={76} className="shrink-0 drop-shadow-[0_0.625rem_1.5rem_color-mix(in_srgb,var(--theme-shade)_45%,transparent)]" />
          <div className="min-w-0 flex-1">
            <div className="flex items-start justify-between gap-4">
              <div className="flex items-end gap-3">
                <Logotype height={60} className="text-text-primary" />
                <span className="mb-2 text-[0.8125rem] font-semibold tabular-nums text-text-muted">{appVersion}</span>
              </div>
              <div className="flex shrink-0 gap-2.5 pt-2">
                <a href="https://github.com/Kallamo/Kallamo" target="_blank" rel="noopener noreferrer" className={`${linkButtonClass} gap-2`}><GithubIcon className="h-3.5 w-3.5" />Repository</a>
                <button type="button" onClick={openWhatsNew} className="inline-flex min-h-8 items-center gap-2 rounded-control border border-accent/45 bg-accent/[0.13] px-3 text-xs font-semibold text-accent transition-colors hover:bg-accent/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                  <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />What’s new
                </button>
              </div>
            </div>
            <p className="mt-2.5 text-[0.9375rem] text-text-secondary">A local-first studio for writing and living worlds.</p>
          </div>
        </div>
        <div className="flex items-center gap-4 border-t border-tint/[0.06] bg-surface-inset/35 px-8 py-3.5">
          <span className="caption flex-1">{updateLine.text}</span>
          {updateLine.action}
        </div>
      </section>
      <SettingsGroup title="Made by">
        <div className="flex items-center gap-4 px-5 py-[1.125rem]">
          <div className="min-w-0 flex-1">
            <div className="text-[0.9375rem] font-semibold text-text-primary">Jonathan Ferreira da Conceição</div>
            <div className="mt-2 flex flex-wrap gap-x-[1.125rem] gap-y-1.5 text-[0.8125rem] text-text-secondary">
              <span className="inline-flex items-center gap-1.5"><GithubIcon className="h-3.5 w-3.5 text-text-muted" /><span className="sr-only">GitHub </span>Jonathanfcon</span>
              <span className="inline-flex items-center gap-1.5"><DiscordIcon className="h-3.5 w-3.5 text-text-muted" /><span className="sr-only">Discord </span>_JustAnotherJohn</span>
              <span className="inline-flex items-center gap-1.5"><RedditIcon className="h-3.5 w-3.5 text-text-muted" /><span className="sr-only">Reddit </span>_JustAnotherJohn</span>
            </div>
          </div>
          <a href="https://github.com/Jonathanfcon" target="_blank" rel="noopener noreferrer" className={`${linkButtonClass} gap-2`}><GithubIcon className="h-3.5 w-3.5" />GitHub profile</a>
        </div>
      </SettingsGroup>
      <SettingsGroup title="Contributors">
        <div className="flex flex-col gap-4 px-5 py-[1.125rem]">
          <p className="text-[0.8125rem] leading-relaxed text-text-muted">Kallamo is open source under <span className="font-semibold text-text-primary">AGPL-3.0</span>. Pull requests, bug reports and ideas are welcome on GitHub.</p>
          <div className="flex items-center gap-4 rounded-xl border border-dashed border-tint/[0.12] bg-surface-inset/60 px-[1.125rem] py-4">
            <span className="flex shrink-0 pl-2" aria-hidden="true">
              {[0, 1, 2, 3].map(slot => <span key={slot} className="-ml-2 h-[2.125rem] w-[2.125rem] rounded-full border-[1.5px] border-dashed border-tint/15 bg-surface-raised-low" />)}
            </span>
            <span className="flex-1 text-[0.8125rem] text-text-muted">This space is reserved for future contributors.</span>
            <a href="https://github.com/Kallamo/Kallamo" target="_blank" rel="noopener noreferrer" className={`${linkButtonClass} gap-2`}><GitPullRequest className="h-3.5 w-3.5" aria-hidden="true" />Contribute</a>
          </div>
        </div>
      </SettingsGroup>
    </>
  );

  const pages = {
    connections: showAddApiForm ? connectionEditor : connectionsPage,
    roles: rolesPage,
    generation: generationPage,
    retrieval: retrievalPage,
    embeddings: embeddingsPage,
    appearance: appearancePage,
    data: dataPage,
    diagnostics: diagnosticsPage,
    about: aboutPage,
  };
  const renderPage = pages[activeTab] || connectionsPage;
  const deleteUsers = connectionToDelete ? connectionUsers(connectionToDelete.id) : null;

  return (
    <div role="dialog" aria-label="Settings" className="fixed inset-0 z-40 flex surface-page titlebar-nodrag select-none animate-in fade-in duration-150">
      <aside className="flex w-[15.25rem] shrink-0 flex-col border-r border-tint/[0.05] surface-rail px-3.5 pb-4 pt-16">
        <button type="button" onClick={onClose} className="inline-flex items-center gap-1.5 self-start rounded-md px-2.5 text-[0.8125rem] font-semibold text-text-muted transition-colors hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />Back
        </button>
        <h1 className="mx-2.5 mb-4 mt-3 text-xl font-extrabold tracking-[-0.015em] text-text-primary">Settings</h1>
        <div className="relative mx-0.5">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-subtle" aria-hidden="true" />
          <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search settings" aria-label="Search settings" className="h-8 w-full rounded-control border border-border-default bg-surface-input pl-9 pr-3 text-[0.8125rem] text-text-secondary placeholder:text-text-subtle focus:border-accent focus:outline-none" />
        </div>
        <nav aria-label="Settings pages" className="mt-1 flex min-h-0 flex-1 flex-col overflow-y-auto custom-scrollbar">
          {query ? (
            searchResults.length === 0 ? (
              <p className="caption mx-2.5 mt-4">Nothing matches “{searchQuery.trim()}”.</p>
            ) : (
              <div className="mt-3 flex flex-col gap-0.5">
                {searchResults.map(entry => (
                  <button key={`${entry.page}-${entry.label}`} type="button" onClick={() => goTo(entry.page)} className="flex flex-col items-start rounded-lg px-2.5 py-1.5 text-left hover:bg-tint/[0.05] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                    <span className="text-[0.8125rem] font-semibold text-text-secondary">{entry.label}</span>
                    <span className="caption">{NAV_LABELS[entry.page]}</span>
                  </button>
                ))}
              </div>
            )
          ) : (
            NAV_GROUPS.map(group => (
              <div key={group.label}>
                <div className="mx-2.5 mb-1.5 mt-5 text-[0.6875rem] font-bold uppercase tracking-[0.1em] text-text-subtle">{group.label}</div>
                {group.items.map(item => {
                  const active = item.id === activeTab;
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-current={active ? 'page' : undefined}
                      onClick={() => goTo(item.id)}
                      className={`flex h-[2.125rem] w-full items-center gap-2.5 rounded-lg px-2.5 text-[0.8125rem] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${active ? 'bg-accent/[0.13] font-semibold text-text-primary shadow-[inset_3px_0_0_var(--app-accent)]' : 'text-text-muted hover:bg-tint/[0.035] hover:text-text-secondary'}`}
                    >
                      <Icon className={`h-4 w-4 shrink-0 ${active ? 'text-accent' : 'text-text-subtle'}`} aria-hidden="true" />
                      <span className="flex-1 truncate text-left">{item.label}</span>
                      {item.id === 'connections' && apiProfiles.length > 0 && <span className="text-xs tabular-nums text-text-subtle">{apiProfiles.length}</span>}
                      {item.id === 'roles' && rolesNeedSetup && <AlertTriangle className="h-3.5 w-3.5 shrink-0 text-status-warning" aria-label="Needs setup" />}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </nav>
        <div className="mt-3 flex flex-col gap-0.5">
          <button type="button" onClick={openWhatsNew} className="flex h-8 items-center gap-2.5 rounded-lg px-2.5 text-[0.8125rem] text-text-muted hover:bg-tint/[0.035] hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
            <Sparkles className="h-4 w-4 text-text-subtle" aria-hidden="true" />What’s new
          </button>
          <button
            type="button"
            onClick={() => goTo('about')}
            className={`flex h-[2.125rem] items-center gap-2.5 rounded-lg px-2.5 text-[0.8125rem] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${activeTab === 'about' ? 'bg-accent/[0.13] font-semibold text-text-primary shadow-[inset_3px_0_0_var(--app-accent)]' : 'text-text-muted hover:bg-tint/[0.035] hover:text-text-secondary'}`}
          >
            <Logo size={16} className="shrink-0" />About Kallamo
          </button>
        </div>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto custom-scrollbar [mask-image:linear-gradient(to_bottom,transparent_0,transparent_2.25rem,black_4.25rem)]">
        <div className={`mx-auto w-full px-8 pb-16 pt-[4.5rem] ${activeTab === 'appearance' ? 'max-w-[72rem]' : 'max-w-[52rem]'}`}>
          {renderPage()}
        </div>
      </div>

      {connectionToDelete && (
        <ConfirmDialog
          title={`Delete ${connectionToDelete.name}?`}
          message={deleteUsers.profiles.length || deleteUsers.engine.length
            ? `${describeUsers(deleteUsers)} will stop replying until ${deleteUsers.profiles.length + deleteUsers.engine.length === 1 ? 'it gets' : 'they get'} another connection.`
            : 'Nothing uses it right now.'}
          actions={[
            { label: 'Cancel', variant: 'ghost', onClick: () => setConnectionToDelete(null) },
            { label: 'Delete connection', variant: 'danger', autoFocus: true, onClick: async () => { const id = connectionToDelete.id; setConnectionToDelete(null); await handleDeleteApiProfile(id); } },
          ]}
          onClose={() => setConnectionToDelete(null)}
        />
      )}

      {confirmAction && (
        <ConfirmDialog
          title={confirmAction === 'purge' ? 'Delete search indexes?' : confirmAction === 'clearCache' ? 'Clear downloaded model files?' : 'Remove the local engine?'}
          message={confirmAction === 'purge'
            ? 'Every file in your knowledge bases will need indexing again before search works.'
            : confirmAction === 'clearCache'
              ? 'The embedding model downloads again the next time something is indexed.'
              : 'Its files are deleted from this computer. You can download it again any time.'}
          actions={[
            { label: 'Cancel', variant: 'ghost', onClick: () => setConfirmAction(null) },
            {
              label: confirmAction === 'purge' ? 'Delete indexes' : confirmAction === 'clearCache' ? 'Clear files' : 'Remove engine',
              variant: 'danger',
              autoFocus: true,
              onClick: async () => {
                const action = confirmAction;
                if (action === 'purge') await handlePurgeVectors();
                else if (action === 'clearCache') await handleClearCache();
                else if (action === 'deleteEngine') {
                  setConfirmAction(null);
                  await deleteEngine();
                  if (embeddingEngine === 'local') updateSetting('advanced', 'embeddingEngine', 'external');
                }
              },
            },
          ]}
          onClose={() => setConfirmAction(null)}
        />
      )}

      {backupStatus && (
        <ConfirmDialog
          tone={backupStatus.success ? 'info' : 'warning'}
          title={backupStatus.success ? 'Backup saved' : 'Backup failed'}
          message={backupStatus.success ? `Saved to:\n${backupStatus.path}` : backupStatus.error}
          actions={[{ label: 'OK', variant: 'primary', autoFocus: true, onClick: () => setBackupStatus(null) }]}
          onClose={() => setBackupStatus(null)}
        />
      )}

      {utilityStatus && (
        <ConfirmDialog
          tone="info"
          title={utilityStatus.title}
          message={utilityStatus.message}
          actions={[{ label: 'OK', variant: 'primary', autoFocus: true, onClick: () => setUtilityStatus(null) }]}
          onClose={() => setUtilityStatus(null)}
        />
      )}

      {restoring && (
        <div className="fixed inset-0 z-[70] flex flex-col items-center justify-center bg-shade/90 p-4">
          <div className="flex flex-col items-center gap-4 text-center">
            <div className="h-12 w-12 animate-spin rounded-full border-4 border-accent/20 border-t-accent" />
            <h3 className="text-lg font-bold text-text-primary">Restoring your data</h3>
            <p className="caption max-w-xs">Replacing the database with the backup. Kallamo restarts in a moment.</p>
          </div>
        </div>
      )}
    </div>
  );
}

const linkButtonClass = 'inline-flex min-h-8 items-center rounded-control border border-border-default bg-surface-panel/70 px-3 text-xs font-semibold text-text-secondary transition-colors hover:bg-surface-hover hover:text-text-primary';

const NAV_GROUPS = [
  { label: 'AI', items: [{ id: 'connections', label: 'Connections', icon: Plug }, { id: 'roles', label: 'AI roles', icon: Cpu }, { id: 'generation', label: 'Generation', icon: Zap }] },
  { label: 'Memory', items: [{ id: 'retrieval', label: 'Retrieval', icon: FileSearch }, { id: 'embeddings', label: 'Embeddings', icon: Layers }] },
  { label: 'App', items: [{ id: 'appearance', label: 'Appearance', icon: Palette }, { id: 'data', label: 'Data and backups', icon: HardDrive }, { id: 'diagnostics', label: 'Diagnostics', icon: Activity }] },
];
const NAV_LABELS = Object.fromEntries([...NAV_GROUPS.flatMap(g => g.items.map(i => [i.id, i.label])), ['about', 'About Kallamo']]);

// What the settings search can find, beyond page names.
const SEARCH_INDEX = [
  { page: 'connections', label: 'Connections', keywords: 'api key provider endpoint openrouter anthropic openai google gemini vertex bedrock aws local lm studio ollama nanogpt base url' },
  { page: 'connections', label: 'Add connection', keywords: 'new api provider model' },
  { page: 'roles', label: 'System AI', keywords: 'default model internal engine' },
  { page: 'roles', label: 'Language for AI notes', keywords: 'internal output language summaries analysis translate' },
  { page: 'roles', label: 'Narrative State', keywords: 'roleplay state campaign scenes relationships' },
  { page: 'roles', label: 'Tagger', keywords: 'tags entities world index propose unknown' },
  { page: 'roles', label: 'Retrieval planner', keywords: 'agentic planning search tools plan every message native tool calling' },
  { page: 'roles', label: 'Summarizer', keywords: 'archive summaries titles' },
  { page: 'generation', label: 'Stream replies', keywords: 'streaming timeout token by token' },
  { page: 'generation', label: 'Prompt cache', keywords: 'cost price cached context position system prompt turn' },
  { page: 'retrieval', label: 'Profile knowledge', keywords: 'top-k passages knowledge base' },
  { page: 'retrieval', label: 'Workspace files', keywords: 'top-k documents passages' },
  { page: 'retrieval', label: 'Long-term memory', keywords: 'top-k archived conversations memory' },
  { page: 'retrieval', label: 'Worldbuild entities', keywords: 'entity limit dossiers' },
  { page: 'retrieval', label: 'Strictness', keywords: 'similarity threshold relevance' },
  { page: 'retrieval', label: 'Worldbuild breadth', keywords: 'relationships hops focused balanced broad' },
  { page: 'retrieval', label: 'Passage length', keywords: 'chunk size characters' },
  { page: 'embeddings', label: 'Embedding engine', keywords: 'local external vector multilingual e5 download remove' },
  { page: 'embeddings', label: 'Runs on', keywords: 'execution device cpu webassembly wasm' },
  { page: 'embeddings', label: 'Clear cache', keywords: 'downloaded model files' },
  { page: 'appearance', label: 'Accent', keywords: 'color colour theme' },
  { page: 'appearance', label: 'Font', keywords: 'typography inter merriweather jetbrains mono' },
  { page: 'appearance', label: 'Text size', keywords: 'scale small medium large' },
  { page: 'appearance', label: 'Background blur', keywords: 'glass performance' },
  { page: 'appearance', label: 'Chat layout', keywords: 'bubbles document' },
  { page: 'appearance', label: 'Code theme', keywords: 'syntax highlight line numbers' },
  { page: 'appearance', label: 'Formatting toolbar', keywords: 'writing desk fixed bubble' },
  { page: 'appearance', label: 'Smart typography', keywords: 'quotes dashes ellipsis' },
  { page: 'data', label: 'Back up', keywords: 'backup export' },
  { page: 'data', label: 'Restore', keywords: 'import backup' },
  { page: 'data', label: 'Safety copies', keywords: 'update migration backups' },
  { page: 'data', label: 'Data folder', keywords: 'workspace folder open' },
  { page: 'data', label: 'Search indexes', keywords: 'purge vector delete' },
  { page: 'diagnostics', label: 'Diagnostics', keywords: 'debug retrieval context agentic trace narrative state token usage' },
  { page: 'about', label: 'Updates', keywords: 'version about license' },
];

// Example values written for each provider, so every empty field shows what belongs in it.
const PROVIDERS = [
  { value: 'OpenRouter', label: 'OpenRouter', sub: 'Many models, one key', mark: 'OR', namePlaceholder: 'OpenRouter', keyPlaceholder: 'sk-or-v1-…', urlPlaceholder: 'https://openrouter.ai/api/v1', modelPlaceholder: 'anthropic/claude-sonnet-4.5' },
  { value: 'Anthropic', label: 'Anthropic', sub: 'Claude', mark: 'A', namePlaceholder: 'Anthropic', keyPlaceholder: 'sk-ant-…', urlPlaceholder: 'https://api.anthropic.com/v1/messages', modelPlaceholder: 'claude-sonnet-4-5' },
  { value: 'OpenAI', label: 'OpenAI', sub: 'GPT', mark: 'AI', namePlaceholder: 'OpenAI', keyPlaceholder: 'sk-…', urlPlaceholder: 'https://api.openai.com/v1', modelPlaceholder: 'gpt-5' },
  { value: 'Google AI', label: 'Google AI', sub: 'Gemini', mark: 'G', namePlaceholder: 'Google', keyPlaceholder: 'AIza…', urlPlaceholder: 'Leave empty for Google’s own endpoint', modelPlaceholder: 'gemini-2.5-flash' },
  { value: 'Vertex AI', label: 'Vertex AI', sub: 'Google Cloud project', mark: 'V', namePlaceholder: 'Vertex', keyPlaceholder: '', urlPlaceholder: '', modelPlaceholder: 'gemini-2.5-pro' },
  { value: 'AWS Bedrock', label: 'AWS Bedrock', sub: 'Your AWS account', mark: 'AWS', namePlaceholder: 'Bedrock', keyPlaceholder: '', urlPlaceholder: '', modelPlaceholder: 'anthropic.claude-sonnet-4-5-20250929-v1:0' },
  { value: 'Local', label: 'Local or compatible', sub: 'LM Studio, Ollama', mark: null, namePlaceholder: 'LM Studio', keyPlaceholder: 'Not needed for most local servers', urlPlaceholder: 'http://127.0.0.1:1234/v1', modelPlaceholder: 'qwen3-30b-a3b' },
];

const MODE_LABELS = { 'inherit-system': 'System AI', dedicated: 'Own model', disabled: 'Off', profile: 'Profile', off: 'Hybrid RAG' };

const ROLE_COPY = {
  narrativeState: 'Keeps the roleplay straight: scenes, what each character knows, and their relationships. It never writes the story.',
  tagger: 'Marks which Worldbuild entities each passage mentions. It never decides what is canon.',
  retrievalPlanner: 'Chooses what to look up before a profile replies, and stops when it has enough.',
  summarizer: 'Titles and summarizes archived conversations. The original messages stay searchable.',
};

const ROLE_LOOK = {
  narrativeState: { icon: Drama, color: 'var(--theme-roleplay)', where: 'Roleplay' },
  tagger: { icon: Tags, color: 'var(--theme-entity-location)', where: 'Worldbuild' },
  retrievalPlanner: { icon: Route, color: 'var(--theme-mode-searchable)', where: 'Every reply' },
  summarizer: { icon: Archive, color: 'var(--theme-mode-history)', where: 'Memory' },
};

const ROLE_OFF_COPY = {
  narrativeState: 'Not running. Roleplay state stays as it is.',
  tagger: 'Not running. New passages are not tagged.',
  summarizer: 'Not running. Archived conversations get no summary.',
};

// Options that belong to one role, lined up under its text.
function RoleOptions({ disabled, children }) {
  return <div className={`ml-[4.75rem] mr-5 border-t border-tint/[0.06] pb-1 [&>*]:px-0 ${disabled ? 'opacity-50' : ''}`}>{children}</div>;
}

const BREADTH_COPY = {
  focused: 'Focused uses the entities that match, without following relationships.',
  balanced: 'Balanced follows one step of relationships around each match.',
  broad: 'Broad follows up to two steps, for wide world questions.',
};

function describeUsers({ profiles, engine }) {
  const names = profiles.map(profile => profile.name);
  if (engine.length) names.push(engine.length > 2 ? `${engine[0]} and ${engine.length - 1} roles` : engine.join(' and '));
  if (names.length <= 2) return names.join(' and ');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function ProviderMark({ provider, size = 'md' }) {
  const meta = PROVIDERS.find(p => p.value === provider);
  const mark = meta ? meta.mark : provider?.slice(0, 2);
  const box = size === 'sm' ? 'h-[1.875rem] w-[1.875rem] rounded-lg' : 'h-[2.375rem] w-[2.375rem] rounded-[0.625rem]';
  return (
    <span aria-hidden="true" className={`inline-flex shrink-0 items-center justify-center border border-tint/10 bg-tint/[0.035] font-extrabold tracking-[-0.02em] text-text-secondary ${box} ${mark && mark.length > 2 ? 'text-[0.6875rem]' : 'text-[0.8125rem]'}`}>
      {mark || <Server className="h-4 w-4" />}
    </span>
  );
}

function SecretInput({ value, onChange, placeholder, shown, onToggle }) {
  return (
    <div className="relative w-80">
      <input type={shown ? 'text' : 'password'} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={`${fieldClass} w-full pr-10 font-mono text-[0.8125rem]`} />
      <button type="button" onClick={onToggle} aria-label={shown ? 'Hide' : 'Show'} className="absolute right-2.5 top-1/2 -translate-y-1/2 text-text-subtle hover:text-text-primary">
        {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
      </button>
    </div>
  );
}

function ConnectionRow({ connection, models, users, onEdit, onDuplicate, onAddModel, onDelete }) {
  const moreRef = useRef(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const usedBy = describeUsers(users);
  return (
    <div className="flex items-start gap-4 border-t border-tint/[0.055] px-[1.125rem] py-4 first:border-t-0">
      <ProviderMark provider={connection.provider} />
      <div className="min-w-0 flex-1">
        <div className="flex min-w-0 items-baseline gap-2.5">
          <span className="truncate text-[0.9375rem] font-semibold text-text-primary">{connection.name}</span>
          <span className="caption shrink-0 truncate">{connection.provider}{connection.baseUrl ? <> · <span className="font-mono">{connection.baseUrl.replace(/^https?:\/\//, '')}</span></> : null}</span>
        </div>
        <div className="mt-2 flex min-w-0 items-center gap-1.5">
          {models.length === 0 ? (
            <span className="text-[0.8125rem] text-status-warning">No models yet</span>
          ) : (
            <>
              <span className="max-w-[16rem] truncate rounded-md bg-tint/[0.05] px-2 py-0.5 font-mono text-[0.6875rem] text-text-secondary">{models[0]}</span>
              {models.length > 1 && <span className="caption">+{models.length - 1}</span>}
            </>
          )}
        </div>
      </div>
      <div className="w-60 min-w-0 pt-0.5">
        <div className="caption mb-1">Used by</div>
        {usedBy ? (
          <div className="flex min-w-0 items-center gap-1.5 text-[0.8125rem] text-text-secondary">
            {users.profiles.slice(0, 3).map(profile => <ReedPen key={profile.id} size={15} color={profile.color || '#FBCB2D'} className="shrink-0" />)}
            <span className="truncate">{usedBy}</span>
          </div>
        ) : <span className="text-[0.8125rem] text-text-subtle">Nothing yet</span>}
      </div>
      <div className="flex shrink-0 items-center gap-1 pt-0.5">
        <Button variant="subtle" size="sm" onClick={onEdit}>Edit</Button>
        <span ref={moreRef}><IconButton icon={MoreHorizontal} label="More" size="sm" onClick={() => setMenuOpen(open => !open)} /></span>
        <Menu anchorRef={moreRef} open={menuOpen} onClose={() => setMenuOpen(false)} label={`${connection.name} actions`} className="w-52">
          <MenuItem icon={Pencil} label="Edit" onSelect={() => { setMenuOpen(false); onEdit(); }} />
          <MenuItem icon={Copy} label="Duplicate" onSelect={() => { setMenuOpen(false); onDuplicate(); }} />
          <MenuItem icon={Plus} label="Add a model" onSelect={() => { setMenuOpen(false); onAddModel(); }} />
          <MenuSeparator />
          <MenuItem icon={Trash2} label="Delete…" danger onSelect={() => { setMenuOpen(false); onDelete(); }} />
        </Menu>
      </div>
    </div>
  );
}
