import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { X, Plus, Key, Link2, Eye, EyeOff, Monitor, Settings, Layout, Layers, HardDrive, Trash2, FolderOpen, RefreshCw, Cpu, Database, Palette, Type } from 'lucide-react';
import Logo, { Logotype } from '../../logo';

export default function SettingsModal({ onClose }) {
  const {
    settings,
    handleSaveSettings,
    apiProfiles,
    handleSaveApiProfile,
    handleDeleteApiProfile,
    electronAPI,
    showToast,
    updateStatus,
    updateVersion
  } = useApp();

  const [activeTab, setActiveTab] = useState('api'); // 'api' | 'interface' | 'advanced'

  // API Tab State
  const [showAddApiForm, setShowAddApiForm] = useState(false);
  const [editingApiId, setEditingApiId] = useState(null);
  const [apiName, setApiName] = useState('');
  const [apiProvider, setApiProvider] = useState('OpenRouter');
  const [showBaseUrl, setShowBaseUrl] = useState(false);
  const [apiBaseUrl, setApiBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);

  // Vertex AI specific states
  const [gcpProjectId, setGcpProjectId] = useState('');
  const [gcpRegion, setGcpRegion] = useState('us-central1');
  const [gcpServiceAccount, setGcpServiceAccount] = useState('');

  // AWS Bedrock specific states
  const [awsAccessKeyId, setAwsAccessKeyId] = useState('');
  const [awsSecretAccessKey, setAwsSecretAccessKey] = useState('');
  const [awsRegion, setAwsRegion] = useState('us-east-1');


  // Models in the active API form
  const [modelsList, setModelsList] = useState([]);
  const [newModelName, setNewModelName] = useState('');
  const [showAddModelField, setShowAddModelField] = useState(false);

  // Settings states mapped from context
  const [accentColor, setAccentColor] = useState(settings.interface.accentColor || '#FBCB2D');
  const [fontFamily, setFontFamily] = useState(settings.interface.fontFamily || 'sans');
  const [fontSize, setFontSize] = useState(settings.interface.fontSize || 'medium');
  const [layoutMode, setLayoutMode] = useState(settings.interface.layout || 'bubbles');
  const [codeTheme, setCodeTheme] = useState(settings.interface.codeTheme || 'github-dark');
  const [lineNumbers, setLineNumbers] = useState(settings.interface.lineNumbers || false);
  const [blurEnabled, setBlurEnabled] = useState(settings.interface.blur ?? true);

  // Advanced Tab State
  const [chunkSize, setChunkSize] = useState(settings.advanced.chunkSize || 500);
  const [similarity, setSimilarity] = useState(settings.advanced.similarity || 0.3);
  const [topKKB, setTopKKB] = useState(settings.advanced.topKKB || 5);
  const [topKMemory, setTopKMemory] = useState(settings.advanced.topKMemory || 5);
  const [executionDevice, setExecutionDevice] = useState(settings.advanced.executionDevice || 'cpu');
  const [ragDebug, setRagDebug] = useState(settings.advanced.ragDebug || false);
  const [agenticDebug, setAgenticDebug] = useState(settings.advanced.agenticDebug || false);
  const [tokenDebug, setTokenDebug] = useState(settings.advanced.tokenDebug || false);
  const [embeddingEngine, setEmbeddingEngine] = useState(settings.advanced.embeddingEngine || 'local');
  const [embeddingApiProfileId, setEmbeddingApiProfileId] = useState(settings.advanced.embeddingApiProfileId || '');
  const [embeddingModelName, setEmbeddingModelName] = useState(settings.advanced.embeddingModelName || '');

  // Custom Confirmation / Alert States
  const [confirmAction, setConfirmAction] = useState(null); // null | 'purge' | 'clearCache' | 'wipe'
  const [backupStatus, setBackupStatus] = useState(null); // null | { success: boolean, path?: string, error?: string }
  const [utilityStatus, setUtilityStatus] = useState(null); // null | { title: string, message: string }
  const [appVersion, setAppVersion] = useState('1.0.0');

  useEffect(() => {
    if (electronAPI?.getAppVersion) {
      electronAPI.getAppVersion().then(setAppVersion).catch(console.error);
    }
  }, [electronAPI]);

  // Colors list
  const colors = ['#FBCB2D', '#ff5f56', '#3b82f6', '#10b981', '#9c27b0'];

  // Keep ref of settings to prevent stale closures in debounce timeout
  const settingsRef = useRef({
    accentColor, fontFamily, fontSize, layout: layoutMode, codeTheme, lineNumbers, blur: blurEnabled,
    chunkSize, similarity, topKKB, topKMemory, executionDevice, ragDebug, agenticDebug, tokenDebug,
    embeddingEngine, embeddingApiProfileId, embeddingModelName
  });

  useEffect(() => {
    settingsRef.current = {
      accentColor, fontFamily, fontSize, layout: layoutMode, codeTheme, lineNumbers, blur: blurEnabled,
      chunkSize, similarity, topKKB, topKMemory, executionDevice, ragDebug, agenticDebug, tokenDebug,
      embeddingEngine, embeddingApiProfileId, embeddingModelName
    };
  }, [accentColor, fontFamily, fontSize, layoutMode, codeTheme, lineNumbers, blurEnabled, chunkSize, similarity, topKKB, topKMemory, executionDevice, ragDebug, agenticDebug, tokenDebug, embeddingEngine, embeddingApiProfileId, embeddingModelName]);

  // Handle immediate save for selects and color choices
  const updateSetting = async (category, key, value) => {
    // Update local React state instantly
    if (category === 'interface') {
      if (key === 'accentColor') setAccentColor(value);
      if (key === 'fontFamily') setFontFamily(value);
      if (key === 'fontSize') setFontSize(value);
      if (key === 'layout') setLayoutMode(value);
      if (key === 'codeTheme') setCodeTheme(value);
      if (key === 'lineNumbers') setLineNumbers(value);
      if (key === 'blur') setBlurEnabled(value);
    } else if (category === 'advanced') {
      if (key === 'executionDevice') setExecutionDevice(value);
      if (key === 'ragDebug') setRagDebug(value);
      if (key === 'agenticDebug') setAgenticDebug(value);
      if (key === 'tokenDebug') setTokenDebug(value);
      if (key === 'embeddingEngine') setEmbeddingEngine(value);
      if (key === 'embeddingApiProfileId') setEmbeddingApiProfileId(value);
    }

    const current = settingsRef.current;
    const newSettings = {
      interface: {
        accentColor: key === 'accentColor' ? value : current.accentColor,
        fontFamily: key === 'fontFamily' ? value : current.fontFamily,
        fontSize: key === 'fontSize' ? value : current.fontSize,
        layout: key === 'layout' ? value : current.layout,
        codeTheme: key === 'codeTheme' ? value : current.codeTheme,
        lineNumbers: key === 'lineNumbers' ? value : current.lineNumbers,
        blur: key === 'blur' ? value : current.blur
      },
      advanced: {
        chunkSize: Number(current.chunkSize),
        similarity: Number(current.similarity),
        topKKB: Number(current.topKKB),
        topKMemory: Number(current.topKMemory),
        executionDevice: key === 'executionDevice' ? value : current.executionDevice,
        ragDebug: key === 'ragDebug' ? value : current.ragDebug,
        agenticDebug: key === 'agenticDebug' ? value : current.agenticDebug,
        tokenDebug: key === 'tokenDebug' ? value : current.tokenDebug,
        embeddingEngine: key === 'embeddingEngine' ? value : current.embeddingEngine,
        embeddingApiProfileId: key === 'embeddingApiProfileId' ? value : current.embeddingApiProfileId,
        embeddingModelName: current.embeddingModelName
      }
    };

    await handleSaveSettings(newSettings);
  };

  // Debounced saver for ranges/sliders
  const saveTimeoutRef = useRef(null);

  const updateSettingWithDebounce = (key, value) => {
    // 1. Update visual state immediately for smooth rendering
    if (key === 'chunkSize') setChunkSize(value);
    if (key === 'similarity') setSimilarity(value);
    if (key === 'topKKB') setTopKKB(value);
    if (key === 'topKMemory') setTopKMemory(value);
    if (key === 'embeddingModelName') setEmbeddingModelName(value);

    // 2. Debounce database save
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current);
    }

    saveTimeoutRef.current = setTimeout(async () => {
      const current = settingsRef.current;
      const newSettings = {
        interface: {
          accentColor: current.accentColor,
          fontFamily: current.fontFamily,
          fontSize: current.fontSize,
          layout: current.layout,
          codeTheme: current.codeTheme,
          lineNumbers: current.lineNumbers,
          blur: current.blur
        },
        advanced: {
          chunkSize: key === 'chunkSize' ? Number(value) : Number(current.chunkSize),
          similarity: key === 'similarity' ? Number(value) : Number(current.similarity),
          topKKB: key === 'topKKB' ? Number(value) : Number(current.topKKB),
          topKMemory: key === 'topKMemory' ? Number(value) : Number(current.topKMemory),
          executionDevice: current.executionDevice,
          ragDebug: current.ragDebug,
          embeddingEngine: current.embeddingEngine,
          embeddingApiProfileId: current.embeddingApiProfileId,
          embeddingModelName: key === 'embeddingModelName' ? value : current.embeddingModelName
        }
      };
      await handleSaveSettings(newSettings);
    }, 300);
  };

  // Handle saving API Connections
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
    setShowAddModelField(false);
    setShowAddApiForm(true);
  };

  const openEditApiForm = (apiProf) => {
    setEditingApiId(apiProf.id);
    setApiName(apiProf.name);
    setApiProvider(apiProf.provider);
    setApiBaseUrl(apiProf.baseUrl || '');
    setShowBaseUrl(!!apiProf.baseUrl);
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
    setShowAddModelField(false);
    setShowAddApiForm(true);
  };

  const handleAddModel = () => {
    if (!newModelName.trim()) return;
    if (modelsList.includes(newModelName.trim())) return;
    setModelsList(prev => [...prev, newModelName.trim()]);
    setNewModelName('');
    setShowAddModelField(false);
  };

  const removeModel = (modelName) => {
    setModelsList(prev => prev.filter(m => m !== modelName));
  };

  const handleSaveApi = async () => {
    if (!apiName.trim()) return;

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
      baseUrl: apiBaseUrl.trim(),
      apiKey: apiKey.trim(),
      customConfig: JSON.stringify(customConfigObj),
      models: JSON.stringify(modelsList)
    };

    await handleSaveApiProfile(apiObject);
    setShowAddApiForm(false);
    setEditingApiId(null);
  };

  // Data helpers
  const handleOpenWorkspace = () => {
    if (electronAPI.openWorkspaceFolder) electronAPI.openWorkspaceFolder();
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

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center titlebar-nodrag select-none p-8 ${(settings?.interface?.blur ?? true) ? 'bg-black/60 backdrop-blur-sm' : 'bg-[#011419]'}`}>
      <div className="w-full max-w-4xl h-full max-h-[600px] bg-[#000D11] rounded-xl shadow-2xl border border-gray-800/60 flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">

        {/* TitleBar Header */}
        <div className="shrink-0 flex justify-between items-center h-14 w-full px-6 bg-[#011419] border-b border-gray-800/50">
          <h2 className="text-lg font-bold text-white tracking-wide">Settings</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-red-500 transition-colors cursor-pointer p-1 rounded-md hover:bg-white/5"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sidebar + Tab Content Container */}
        <div className="flex flex-1 overflow-hidden">

          {/* Settings Sidebar Tabs */}
          <div className="w-56 bg-[#011419] border-r border-gray-800/50 p-4 flex flex-col gap-2 shrink-0">
            <button
              onClick={() => { setActiveTab('api'); setShowAddApiForm(false); }}
              className={`text-left px-4 py-2.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${activeTab === 'api' ? 'bg-[#1a2d32] text-white' : 'text-gray-400 hover:bg-[#1a2d32]/50 hover:text-gray-200'
                }`}
            >
              API Connections
            </button>
            <button
              onClick={() => { setActiveTab('interface'); setShowAddApiForm(false); }}
              className={`text-left px-4 py-2.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${activeTab === 'interface' ? 'bg-[#1a2d32] text-white' : 'text-gray-400 hover:bg-[#1a2d32]/50 hover:text-gray-200'
                }`}
            >
              Interface
            </button>
            <button
              onClick={() => { setActiveTab('advanced'); setShowAddApiForm(false); }}
              className={`text-left px-4 py-2.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${activeTab === 'advanced' ? 'bg-[#1a2d32] text-white' : 'text-gray-400 hover:bg-[#1a2d32]/50 hover:text-gray-200'
                }`}
            >
              Advanced
            </button>
            <div className="flex-1" />
            <button
              onClick={() => { setActiveTab('about'); setShowAddApiForm(false); }}
              className={`text-left px-4 py-2.5 rounded-md text-sm font-medium transition-colors cursor-pointer ${activeTab === 'about' ? 'bg-[#1a2d32] text-white' : 'text-gray-400 hover:bg-[#1a2d32]/50 hover:text-gray-200'
                }`}
            >
              About Kallamo
            </button>

          </div>

          {/* Active Tab View Panel */}
          <div className="flex-1 p-8 overflow-y-auto bg-[#000D11] custom-scrollbar flex flex-col">

            {/* =========================================== */}
            {/* 1. API TAB */}
            {/* =========================================== */}
            {activeTab === 'api' && (
              <div className="h-full flex flex-col">

                {/* List View of API Connections */}
                {!showAddApiForm ? (
                  <div className="flex flex-col h-full">
                    <div className="shrink-0 flex justify-between items-center mb-6 border-b border-gray-800 pb-3">
                      <h3 className="text-xl font-bold text-white flex items-center space-x-2">
                        <Link2 className="w-5 h-5 text-accent" />
                        <span>API Connections</span>
                      </h3>
                      <button
                        onClick={openNewApiForm}
                        className="flex items-center space-x-1 bg-[#1a2d32] hover:bg-[#233a41] text-white text-xs font-semibold py-1.5 px-3 rounded transition-colors border border-gray-700/50 cursor-pointer"
                      >
                        <Plus className="w-4 h-4" />
                        <span>Add Connection</span>
                      </button>
                    </div>

                    <div className="flex-1 overflow-y-auto space-y-3 pr-2 custom-scrollbar">
                      {apiProfiles.length === 0 ? (
                        <p className="text-sm text-gray-500 italic mt-4">No API profiles configured yet. Click "Add Connection" to create one.</p>
                      ) : (
                        apiProfiles.map(ap => {
                          const mList = ap.models ? (typeof ap.models === 'string' ? JSON.parse(ap.models) : ap.models) : [];
                          return (
                            <div
                              key={ap.id}
                              className="flex items-center justify-between p-4 bg-[#0a161d] border border-gray-800/80 rounded-lg group"
                            >
                              <div className="flex flex-col space-y-1 overflow-hidden">
                                <span className="text-sm font-bold text-white truncate">{ap.name}</span>
                                <span className="text-xs text-gray-400">{ap.provider} — {mList.length} models</span>
                              </div>
                              <div className="flex space-x-2 shrink-0">
                                <button
                                  onClick={() => openEditApiForm(ap)}
                                  className="text-xs text-gray-300 hover:text-white px-2.5 py-1.5 bg-[#111f2e] border border-gray-800 rounded-md transition-colors cursor-pointer"
                                >
                                  Configure
                                </button>
                                <button
                                  onClick={() => handleDeleteApiProfile(ap.id)}
                                  className="text-xs text-red-400 hover:text-red-300 p-1.5 hover:bg-red-500/10 rounded-md transition-colors cursor-pointer"
                                >
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </div>
                          );
                        })
                      )}
                    </div>
                  </div>
                ) : (
                  /* Form View for Adding / Editing API Connection */
                  <div className="flex-1 flex flex-col justify-between h-full">
                    <div className="space-y-4">
                      <h4 className="text-sm font-bold text-accent uppercase tracking-wider mb-2 border-b border-gray-800 pb-1">
                        {editingApiId ? 'Edit Connection' : 'New API Connection'}
                      </h4>
                      <div>
                        <label className="block text-xs font-bold text-gray-400 mb-1">Connection Name</label>
                        <p className="text-[10px] text-gray-500 mb-1.5">A friendly identifier to reference this client configuration (e.g., Anthropic Prod, Ollama Local).</p>
                        <input
                          type="text"
                          value={apiName}
                          onChange={(e) => setApiName(e.target.value)}
                          placeholder="e.g., Anthropic Client, OpenRouter Core"
                          className="w-full bg-[#011419] border border-gray-800 text-gray-200 text-sm rounded-md px-3 py-2 focus:outline-none focus:border-accent"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold text-gray-400 mb-1">Provider</label>
                        <p className="text-[10px] text-gray-500 mb-1.5">The cloud gateway or local interface hosting the target models.</p>
                        <select
                          value={apiProvider}
                          onChange={(e) => setApiProvider(e.target.value)}
                          className="w-full bg-[#011419] border border-gray-800 text-gray-200 text-sm rounded-md px-3 py-2 focus:outline-none focus:border-accent cursor-pointer"
                        >
                          <option value="OpenRouter">OpenRouter</option>
                          <option value="Anthropic">Anthropic</option>
                          <option value="Google AI">Google AI</option>
                          <option value="OpenAI">OpenAI</option>
                          <option value="Local">Local (LM Studio / Ollama)</option>
                          <option value="Vertex AI">Google Cloud Vertex AI</option>
                          <option value="AWS Bedrock">AWS Bedrock</option>
                        </select>
                      </div>

                      {apiProvider === 'Vertex AI' ? (
                        <>
                          <div>
                            <label className="block text-xs font-bold text-gray-400 mb-1">GCP Project ID</label>
                            <p className="text-[10px] text-gray-500 mb-1.5">The unique project identifier assigned within your Google Cloud console.</p>
                            <input
                              type="text"
                              value={gcpProjectId}
                              onChange={(e) => setGcpProjectId(e.target.value)}
                              placeholder="Enter Google Cloud Project ID..."
                              className="w-full bg-[#011419] border border-gray-800 text-gray-200 text-sm rounded-md px-3 py-2 focus:outline-none focus:border-accent"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-gray-400 mb-1">GCP Region</label>
                            <p className="text-[10px] text-gray-500 mb-1.5">The regional zone where Vertex endpoint resources are physically hosted.</p>
                            <input
                              type="text"
                              value={gcpRegion}
                              onChange={(e) => setGcpRegion(e.target.value)}
                              placeholder="e.g. us-central1"
                              className="w-full bg-[#011419] border border-gray-800 text-gray-200 text-sm rounded-md px-3 py-2 focus:outline-none focus:border-accent"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-gray-400 mb-1">Service Account JSON Key</label>
                            <p className="text-[10px] text-gray-500 mb-1.5">Paste the complete text content of the downloaded service account private key JSON file.</p>
                            <textarea
                              value={gcpServiceAccount}
                              onChange={(e) => setGcpServiceAccount(e.target.value)}
                              placeholder='{"type": "service_account", ...}'
                              rows={5}
                              className="w-full bg-[#011419] border border-gray-800 text-gray-200 text-sm rounded-md px-3 py-2 focus:outline-none focus:border-accent font-mono text-xs custom-scrollbar resize-none"
                            />
                          </div>
                        </>
                      ) : apiProvider === 'AWS Bedrock' ? (
                        <>
                          <div>
                            <label className="block text-xs font-bold text-gray-400 mb-1">AWS Access Key ID</label>
                            <p className="text-[10px] text-gray-500 mb-1.5">The access key credential used to verify user signature headers for Bedrock calls.</p>
                            <input
                              type="text"
                              value={awsAccessKeyId}
                              onChange={(e) => setAwsAccessKeyId(e.target.value)}
                              placeholder="Enter AWS Access Key ID..."
                              className="w-full bg-[#011419] border border-gray-800 text-gray-200 text-sm rounded-md px-3 py-2 focus:outline-none focus:border-accent"
                            />
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-gray-400 mb-1">AWS Secret Access Key</label>
                            <p className="text-[10px] text-gray-500 mb-1.5">The secret cryptographic access key associated with your IAM credentials.</p>
                            <div className="relative flex items-center">
                              <input
                                type={showApiKey ? 'text' : 'password'}
                                value={awsSecretAccessKey}
                                onChange={(e) => setAwsSecretAccessKey(e.target.value)}
                                placeholder="Enter AWS Secret Access Key..."
                                className="w-full bg-[#011419] border border-gray-800 text-gray-200 text-sm rounded-md pl-3 pr-10 py-2 focus:outline-none focus:border-accent"
                              />
                              <button
                                type="button"
                                onClick={() => setShowApiKey(!showApiKey)}
                                className="absolute right-3 text-gray-500 hover:text-white cursor-pointer"
                              >
                                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </button>
                            </div>
                          </div>
                          <div>
                            <label className="block text-xs font-bold text-gray-400 mb-1">AWS Region</label>
                            <p className="text-[10px] text-gray-500 mb-1.5">The global AWS datacenter region hosting your Bedrock instances.</p>
                            <input
                              type="text"
                              value={awsRegion}
                              onChange={(e) => setAwsRegion(e.target.value)}
                              placeholder="e.g. us-east-1"
                              className="w-full bg-[#011419] border border-gray-800 text-gray-200 text-sm rounded-md px-3 py-2 focus:outline-none focus:border-accent"
                            />
                          </div>
                        </>
                      ) : (
                        <>
                          {/* Custom Base URL Toggle */}
                          <div>
                            <button
                              onClick={() => setShowBaseUrl(!showBaseUrl)}
                              className="flex items-center text-xs text-gray-400 mb-1.5 space-x-1 cursor-pointer hover:text-gray-300"
                            >
                              <Link2 className="w-3.5 h-3.5 text-accent" />
                              <span>Custom Base URL (optional)</span>
                            </button>
                            {showBaseUrl && (
                              <>
                                <p className="text-[10px] text-gray-500 mb-1.5">An alternative base URL route to query local servers or private API reverse proxies.</p>
                                <input
                                  type="text"
                                  value={apiBaseUrl}
                                  onChange={(e) => setApiBaseUrl(e.target.value)}
                                  placeholder="e.g. http://localhost:11434/v1"
                                  className="w-full bg-[#011419] border border-gray-800 text-gray-200 text-sm rounded-md px-3 py-2 focus:outline-none focus:border-accent animate-in slide-in-from-top duration-200"
                                />
                              </>
                            )}
                          </div>

                          {/* API Key */}
                          <div>
                            <label className="block text-xs font-bold text-gray-400 mb-1">API Key / Secret</label>
                            <p className="text-[10px] text-gray-500 mb-1.5">The primary verification token or key secret to sign client request calls.</p>
                            <div className="relative flex items-center">
                              <input
                                type={showApiKey ? 'text' : 'password'}
                                value={apiKey}
                                onChange={(e) => setApiKey(e.target.value)}
                                placeholder="Enter credentials..."
                                className="w-full bg-[#011419] border border-gray-800 text-gray-200 text-sm rounded-md pl-3 pr-10 py-2 focus:outline-none focus:border-accent"
                              />
                              <button
                                type="button"
                                onClick={() => setShowApiKey(!showApiKey)}
                                className="absolute right-3 text-gray-500 hover:text-white cursor-pointer"
                              >
                                {showApiKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                              </button>
                            </div>
                          </div>
                        </>
                      )}

                      {/* Models List Management */}
                      <div className="mt-6 border-t border-gray-800/80 pt-4">
                        <div className="flex items-center justify-between mb-3">
                          <span className="text-xs font-bold text-gray-300 uppercase tracking-wide">Supported Models</span>
                          <button
                            type="button"
                            onClick={() => setShowAddModelField(true)}
                            className="bg-transparent border border-gray-700 hover:bg-gray-800 text-white text-[10px] uppercase font-bold px-2 py-1 rounded transition-colors cursor-pointer"
                          >
                            + Add Model
                          </button>
                        </div>

                        {showAddModelField && (
                          <div className="flex items-center space-x-2 mb-3 bg-[#0a161d] p-2 rounded-lg border border-gray-800">
                            <input
                              type="text"
                              value={newModelName}
                              onChange={(e) => setNewModelName(e.target.value)}
                              placeholder="e.g. claude-3-5-sonnet-20241022"
                              className="flex-1 bg-[#011419] border border-gray-800 text-gray-200 text-xs rounded-md px-2 py-1 focus:outline-none focus:border-accent"
                            />
                            <button
                              type="button"
                              onClick={() => { setNewModelName(''); setShowAddModelField(false); }}
                              className="bg-transparent hover:bg-gray-800 text-gray-400 px-2.5 py-1 rounded text-xs cursor-pointer border border-gray-800"
                            >
                              Cancel
                            </button>
                            <button
                              type="button"
                              onClick={handleAddModel}
                              className="bg-accent hover:brightness-110 text-[#011419] px-3 py-1 rounded text-xs font-bold cursor-pointer"
                            >
                              Add
                            </button>
                          </div>
                        )}

                        <div className="flex flex-wrap gap-1.5 min-h-[36px]">
                          {modelsList.length === 0 ? (
                            <span className="text-[10px] text-gray-500 italic">No models registered. Select "+ Add Model" to support AI execution.</span>
                          ) : (
                            modelsList.map(m => (
                              <span
                                key={m}
                                className="flex items-center space-x-1.5 bg-[#1a2d3d] border border-gray-700/50 text-gray-300 text-[10px] font-semibold px-2 py-0.5 rounded-full select-none"
                              >
                                <span>{m}</span>
                                <X
                                  className="w-3 h-3 text-gray-500 hover:text-red-400 cursor-pointer"
                                  onClick={() => removeModel(m)}
                                />
                              </span>
                            ))
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="mt-8 flex justify-end space-x-3 border-t border-gray-800 pt-4 shrink-0">
                      <button
                        onClick={() => setShowAddApiForm(false)}
                        className="px-4 py-2 text-xs font-semibold text-gray-400 hover:text-white transition-colors cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveApi}
                        disabled={!apiName.trim() || modelsList.length === 0}
                        className="px-4 py-2 text-xs font-bold bg-accent hover:brightness-110 text-[#011419] rounded transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {editingApiId ? 'Save Connection' : 'Create Connection'}
                      </button>
                    </div>
                  </div>
                )}

              </div>
            )}

            {/* =========================================== */}
            {/* 2. INTERFACE TAB */}
            {/* =========================================== */}
            {activeTab === 'interface' && (
              <div className="space-y-6">
                <div className="shrink-0 mb-4 border-b border-gray-800 pb-3">
                  <h3 className="text-xl font-bold text-white flex items-center space-x-2">
                    <Layout className="w-5 h-5 text-accent" />
                    <span>Interface settings</span>
                  </h3>
                  <p className="text-xs text-gray-400 mt-1">Customize the visual layout, typography, and default behavior.</p>
                </div>

                <div className="space-y-6">
                  {/* SECTION 1: VISUAL THEME & FX */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-accent uppercase tracking-widest flex items-center space-x-1.5 select-none">
                      <Palette className="w-3.5 h-3.5" />
                      <span>Visual Theme & Effects</span>
                    </h4>
                    <div className="bg-[#051116] rounded-xl border border-gray-800/80 divide-y divide-gray-800/80 overflow-hidden">
                      {/* Theme Accent Color */}
                      <div className="p-4 flex items-center justify-between">
                        <div>
                          <span className="block text-sm text-gray-200 font-bold">Accent Color</span>
                          <span className="text-xs text-gray-500">Pick the application gold or color accents for system highlights.</span>
                        </div>
                        <div className="flex space-x-2">
                          {colors.map(c => (
                            <button
                              key={c}
                              onClick={() => updateSetting('interface', 'accentColor', c)}
                              style={{ backgroundColor: c }}
                              className={`w-6 h-6 rounded-full transition-all hover:scale-110 cursor-pointer ${accentColor === c ? 'ring-2 ring-white ring-offset-2 ring-offset-[#051116] scale-110' : 'ring-2 ring-transparent'
                                }`}
                            />
                          ))}
                        </div>
                      </div>

                      {/* Backdrop blur toggling */}
                      <div className="p-4 flex items-center justify-between">
                        <div>
                          <span className="block text-sm text-gray-200 font-bold">Enable Backdrop Blurs</span>
                          <span className="text-xs text-gray-500">Apply glassmorphism blur effects to background elements (disabling improves performance on older hardware).</span>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer">
                          <input
                            type="checkbox"
                            checked={blurEnabled}
                            onChange={(e) => updateSetting('interface', 'blur', e.target.checked)}
                            className="sr-only peer"
                          />
                          <div className="w-7 h-4 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-300 after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-accent"></div>
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* SECTION 2: TYPOGRAPHY & SIZING */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-accent uppercase tracking-widest flex items-center space-x-1.5 select-none">
                      <Type className="w-3.5 h-3.5" />
                      <span>Typography & Font Sizing</span>
                    </h4>
                    <div className="bg-[#051116] rounded-xl border border-gray-800/80 divide-y divide-gray-800/80 overflow-hidden">
                      {/* Typography Font family */}
                      <div className="p-4 flex items-center justify-between">
                        <div>
                          <span className="block text-sm text-gray-200 font-bold">Font Family</span>
                          <span className="text-xs text-gray-500">Select the global typography family for active workspace views.</span>
                        </div>
                        <select
                          value={fontFamily}
                          onChange={(e) => updateSetting('interface', 'fontFamily', e.target.value)}
                          className="bg-[#011419] border border-gray-700 text-gray-200 text-xs rounded-md px-3 py-1.5 focus:outline-none focus:border-accent cursor-pointer"
                        >
                          <option value="sans">Inter (Modern & Clean)</option>
                          <option value="serif">Merriweather (Classic Book)</option>
                          <option value="monospace">JetBrains Mono (Tech & Minimalist)</option>
                        </select>
                      </div>

                      {/* Font scale */}
                      <div className="p-4 flex items-center justify-between">
                        <div>
                          <span className="block text-sm text-gray-200 font-bold">Global Scale</span>
                          <span className="text-xs text-gray-500">Adjust the relative text size inside active workspace views.</span>
                        </div>
                        <div className="flex bg-[#011419] border border-gray-700 rounded-lg p-1 space-x-1">
                          {['small', 'medium', 'large'].map(sz => (
                            <button
                              key={sz}
                              onClick={() => updateSetting('interface', 'fontSize', sz)}
                              className={`px-3 py-1 rounded-md text-xs font-semibold cursor-pointer transition-all ${fontSize === sz
                                ? 'bg-[#1a2d32] text-white border border-accent/30 font-bold shadow'
                                : 'text-gray-500 hover:text-white'
                                }`}
                            >
                              {sz.charAt(0).toUpperCase() + sz.slice(1)}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* SECTION 3: CHAT LAYOUT & CODE RENDERING */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-accent uppercase tracking-widest flex items-center space-x-1.5 select-none">
                      <Layout className="w-3.5 h-3.5" />
                      <span>Chat Layout & Code Rendering</span>
                    </h4>
                    <div className="bg-[#051116] p-5 rounded-xl border border-gray-800/80 space-y-5">
                      {/* Layout Mode selection */}
                      <div className="flex flex-col space-y-2.5">
                        <span className="text-sm font-bold text-gray-200">Chat Layout Mode</span>
                        <p className="text-xs text-gray-500">Switch between standard speech bubbles or a clean, distraction-free document layout.</p>
                        <div className="grid grid-cols-2 gap-4">
                          <button
                            onClick={() => updateSetting('interface', 'layout', 'bubbles')}
                            className={`rounded-xl p-5 flex flex-col items-center gap-4 transition-all shadow-md cursor-pointer border-2 ${layoutMode === 'bubbles'
                              ? 'border-accent bg-[#1a2d32] opacity-100'
                              : 'border-gray-800 bg-[#0a161d] opacity-65 hover:opacity-100'
                              }`}
                          >
                            <div className="w-full space-y-2.5">
                              <div className="w-3/4 h-3 bg-gray-600 rounded-full ml-auto"></div>
                              <div className="w-3/4 h-3 bg-accent rounded-full"></div>
                            </div>
                            <span className="text-xs font-bold text-white">Standard (Bubbles)</span>
                          </button>

                          <button
                            onClick={() => updateSetting('interface', 'layout', 'document')}
                            className={`rounded-xl p-5 flex flex-col items-center gap-4 transition-all shadow-md cursor-pointer border-2 ${layoutMode === 'document'
                              ? 'border-accent bg-[#1a2d32] opacity-100'
                              : 'border-gray-800 bg-[#0a161d] opacity-65 hover:opacity-100'
                              }`}
                          >
                            <div className="w-full space-y-2">
                              <div className="w-full h-2 bg-gray-600 rounded-full"></div>
                              <div className="w-full h-2 bg-accent rounded-full mt-2"></div>
                            </div>
                            <span className="text-xs font-bold text-white">Document (Seamless)</span>
                          </button>
                        </div>
                      </div>

                      <div className="h-px bg-gray-800/50 w-full"></div>

                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Markdown Syntax highlight theme */}
                        <div className="flex flex-col space-y-1.5">
                          <span className="block text-sm text-gray-200 font-bold">Code Syntax Theme</span>
                          <span className="text-xs text-gray-500">Choose the color scheme for code blocks inside chat messages.</span>
                          <select
                            value={codeTheme}
                            onChange={(e) => updateSetting('interface', 'codeTheme', e.target.value)}
                            className="bg-[#011419] border border-gray-700 text-gray-200 text-xs rounded-md px-3 py-1.5 focus:outline-none focus:border-accent cursor-pointer mt-1"
                          >
                            <option value="github-dark">GitHub Dark</option>
                            <option value="atom-one-dark">Atom One Dark</option>
                            <option value="tokyo-night-dark">Tokyo Night Dark</option>
                          </select>
                        </div>

                        {/* Markdown line numbers */}
                        <div className="flex flex-col space-y-1.5 justify-between">
                          <div>
                            <span className="block text-sm text-gray-200 font-bold">Show Line Numbers</span>
                            <span className="text-xs text-gray-500">Render index numbers on the left margin of code blocks.</span>
                          </div>
                          <div className="pt-2">
                            <label className="relative inline-flex items-center cursor-pointer">
                              <input
                                type="checkbox"
                                checked={lineNumbers}
                                onChange={(e) => updateSetting('interface', 'lineNumbers', e.target.checked)}
                                className="sr-only peer"
                              />
                              <div className="w-7 h-4 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-300 after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-accent"></div>
                            </label>
                          </div>
                        </div>
                      </div>

                    </div>
                  </div>
                </div>

              </div>
            )}

            {activeTab === 'advanced' && (
              <div className="space-y-6">
                <div className="shrink-0 mb-4 border-b border-gray-800 pb-3">
                  <h3 className="text-xl font-bold text-white flex items-center space-x-2">
                    <Monitor className="w-5 h-5 text-accent" />
                    <span>Advanced Options</span>
                  </h3>
                  <p className="text-xs text-gray-400 mt-1">Configure advanced settings for the local search engine, data management, and diagnostics.</p>
                </div>

                <div className="space-y-6">
                  {/* SECTION 1: CHUNKS & RAG */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-accent uppercase tracking-widest flex items-center space-x-1.5 select-none">
                      <Database className="w-3.5 h-3.5" />
                      <span>RAG & Chunking Config</span>
                    </h4>
                    <div className="bg-[#051116] p-5 rounded-xl border border-gray-800/80 space-y-5">
                      {/* Chunk Size */}
                      <div>
                        <div className="flex justify-between mb-1">
                          <span className="text-sm text-gray-200 font-bold">Chunk Size (Characters)</span>
                          <span className="text-xs text-accent font-mono font-bold">{chunkSize}</span>
                        </div>
                        <p className="text-[10px] text-gray-500 mb-2">The character length limit used to slice imported knowledge documents into distinct vector blocks.</p>
                        <input
                          type="range"
                          min="200"
                          max="1000"
                          step="50"
                          value={chunkSize}
                          onChange={(e) => updateSettingWithDebounce('chunkSize', e.target.value)}
                          className="w-full accent-accent cursor-pointer"
                        />
                      </div>

                      <div className="h-px bg-gray-800/50 w-full"></div>

                      {/* Similarity */}
                      <div>
                        <div className="flex justify-between mb-1">
                          <span className="text-sm text-gray-200 font-bold">Similarity Threshold</span>
                          <span className="text-xs text-accent font-mono font-bold">{similarity}</span>
                        </div>
                        <p className="text-[10px] text-gray-500 mb-2">The minimum similarity score required to retrieve a knowledge chunk (0.1 includes everything, 0.9 includes only exact matches).</p>
                        <input
                          type="range"
                          min="0.1"
                          max="0.9"
                          step="0.05"
                          value={similarity}
                          onChange={(e) => updateSettingWithDebounce('similarity', parseFloat(e.target.value))}
                          className="w-full accent-accent cursor-pointer"
                        />
                      </div>

                      <div className="h-px bg-gray-800/50 w-full"></div>

                      {/* Top K KB */}
                      <div>
                        <div className="flex justify-between mb-1">
                          <span className="text-sm text-gray-200 font-bold">Knowledge Base Top-K</span>
                          <span className="text-xs text-accent font-mono font-bold">{topKKB}</span>
                        </div>
                        <p className="text-[10px] text-gray-500 mb-2">The maximum number of matching text blocks fetched from the profile's knowledge base to feed the AI prompt.</p>
                        <input
                          type="range"
                          min="1"
                          max="50"
                          step="1"
                          value={topKKB}
                          onChange={(e) => updateSettingWithDebounce('topKKB', e.target.value)}
                          className="w-full accent-accent cursor-pointer"
                        />
                      </div>

                      <div className="h-px bg-gray-800/50 w-full"></div>

                      {/* Top K Memory */}
                      <div>
                        <div className="flex justify-between mb-1">
                          <span className="text-sm text-gray-200 font-bold">Chat Memory Top-K</span>
                          <span className="text-xs text-accent font-mono font-bold">{topKMemory}</span>
                        </div>
                        <p className="text-[10px] text-gray-500 mb-2">The maximum number of semantic memory snippets recalled from past archived conversations per message.</p>
                        <input
                          type="range"
                          min="1"
                          max="50"
                          step="1"
                          value={topKMemory}
                          onChange={(e) => updateSettingWithDebounce('topKMemory', e.target.value)}
                          className="w-full accent-accent cursor-pointer"
                        />
                      </div>

                      <div className="h-px bg-gray-800/50 w-full"></div>

                      {/* Embedding Engine Config */}
                      <div>
                        <span className="block text-sm text-gray-200 font-bold mb-1">Vector Embedding Engine</span>
                        <p className="text-[10px] text-gray-500 mb-3">
                          Generate vector embeddings locally on your hardware or offload calculations to an external API provider.
                        </p>
                        <div className="flex flex-col sm:flex-row sm:space-x-6 space-y-2 sm:space-y-0">
                          <label className="flex items-center space-x-2 text-xs text-gray-300 cursor-pointer">
                            <input
                              type="radio"
                              name="embeddingEngine"
                              value="local"
                              checked={embeddingEngine === 'local'}
                              onChange={() => updateSetting('advanced', 'embeddingEngine', 'local')}
                              className="accent-accent"
                            />
                            <span>Local Engine (Offline & Private MiniLM-L6)</span>
                          </label>
                          <label className="flex items-center space-x-2 text-xs text-gray-300 cursor-pointer">
                            <input
                              type="radio"
                              name="embeddingEngine"
                              value="external"
                              checked={embeddingEngine === 'external'}
                              onChange={() => updateSetting('advanced', 'embeddingEngine', 'external')}
                              className="accent-accent"
                            />
                            <span>External API (Requires configured connection below)</span>
                          </label>
                        </div>
                      </div>

                      {embeddingEngine === 'external' && (
                        <div className="space-y-4 border-t border-gray-800/50 pt-4 animate-in fade-in duration-200">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                              <label className="block text-xs font-bold text-gray-400 mb-1">API Connection</label>
                              <p className="text-[10px] text-gray-500 mb-1.5">Select the API connection profile to use for remote vector calculations.</p>
                              <select
                                value={embeddingApiProfileId}
                                onChange={(e) => updateSetting('advanced', 'embeddingApiProfileId', e.target.value)}
                                className="w-full bg-[#011419] border border-gray-700 text-gray-200 text-xs rounded-md px-3 py-2 focus:outline-none focus:border-accent cursor-pointer"
                              >
                                <option value="">Select connection...</option>
                                {apiProfiles.map(apiProf => (
                                  <option key={apiProf.id} value={apiProf.id}>{apiProf.name} ({apiProf.provider})</option>
                                ))}
                              </select>
                            </div>

                            <div>
                              <label className="block text-xs font-bold text-gray-400 mb-1">Embedding Model Name</label>
                              <p className="text-[10px] text-gray-500 mb-1.5">Specify the exact model name from your provider to generate embedding vectors.</p>
                              <input
                                type="text"
                                value={embeddingModelName}
                                onChange={(e) => updateSettingWithDebounce('embeddingModelName', e.target.value)}
                                placeholder="e.g. text-embedding-3-small"
                                className="w-full bg-[#011419] border border-gray-700 text-gray-200 text-xs rounded-md px-3 py-2 focus:outline-none focus:border-accent"
                              />
                              <p className="text-[9px] text-gray-500 mt-1">
                                OpenAI: <code>text-embedding-3-small</code> | Google: <code>text-embedding-004</code>.
                              </p>
                            </div>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* SECTION 2: HARDWARE & CACHE */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-accent uppercase tracking-widest flex items-center space-x-1.5 select-none">
                      <Cpu className="w-3.5 h-3.5" />
                      <span>Hardware & Model Cache</span>
                    </h4>
                    <div className="bg-[#051116] rounded-xl border border-gray-800/80 divide-y divide-gray-800/80 overflow-hidden">
                      <div className="p-4 flex items-center justify-between">
                        <div className="pr-4">
                          <span className="block text-sm text-gray-200 font-bold mb-1">Embedding Execution Device</span>
                          <span className="text-xs text-gray-500">Configure whether the local embedding model runs inside a WebAssembly container or directly on your CPU.</span>
                        </div>
                        <select
                          value={executionDevice}
                          onChange={(e) => updateSetting('advanced', 'executionDevice', e.target.value)}
                          className="bg-[#011419] border border-gray-700 text-gray-200 text-xs rounded-md px-3 py-1.5 focus:outline-none focus:border-accent cursor-pointer shrink-0 w-48"
                        >
                          <option value="cpu">CPU (Native - Stable)</option>
                          <option value="wasm">CPU (WebAssembly)</option>
                        </select>
                      </div>

                      <div className="p-4 flex items-center justify-between">
                        <div>
                          <span className="block text-sm text-gray-200 font-bold">Clear Local Embeddings Cache</span>
                          <span className="text-xs text-gray-500">Delete downloaded model cache files from disk (will force a fresh download upon next RAG indexing task).</span>
                        </div>
                        <button
                          onClick={() => setConfirmAction('clearCache')}
                          className="px-3 py-1.5 bg-[#1a2d32] hover:bg-[#243b52] text-white text-xs font-semibold rounded-lg transition-colors border border-gray-700/50 flex items-center space-x-1.5 cursor-pointer shrink-0 ml-4"
                        >
                          <RefreshCw className="w-3.5 h-3.5" />
                          <span>Clear Cache</span>
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* SECTION 3: DIAGNOSTICS & DEBUGGING */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-accent uppercase tracking-widest flex items-center space-x-1.5 select-none">
                      <Monitor className="w-3.5 h-3.5" />
                      <span>Diagnostics & Logging</span>
                    </h4>
                    <div className="bg-[#051116] rounded-xl border border-gray-800/80 divide-y divide-gray-800/80 overflow-hidden">
                      {/* Live RAG Debug logs toggle */}
                      <div className="p-4 flex items-center justify-between">
                        <div className="pr-4">
                          <span className="block text-sm text-gray-200 font-bold">Enable RAG Context Warnings</span>
                          <span className="text-xs text-gray-500">Show floating banners inside active chat messages detailing search performance and context information.</span>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer shrink-0">
                          <input
                            type="checkbox"
                            checked={ragDebug}
                            onChange={(e) => updateSetting('advanced', 'ragDebug', e.target.checked)}
                            className="sr-only peer"
                          />
                          <div className="w-7 h-4 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-300 after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-accent"></div>
                        </label>
                      </div>

                      {/* Agentic RAG Debug toggle */}
                      <div className="p-4 flex items-center justify-between">
                        <div className="pr-4">
                          <span className="block text-sm text-gray-200 font-bold">Show Agentic RAG Responses</span>
                          <span className="text-xs text-gray-500">Enable secondary diagnostic drop-downs mapping intermediate reasoning thoughts from RAG agents.</span>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer shrink-0">
                          <input
                            type="checkbox"
                            checked={agenticDebug}
                            onChange={(e) => updateSetting('advanced', 'agenticDebug', e.target.checked)}
                            className="sr-only peer"
                          />
                          <div className="w-7 h-4 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-300 after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-accent"></div>
                        </label>
                      </div>

                      {/* Token Usage Debug toggle */}
                      <div className="p-4 flex items-center justify-between">
                        <div className="pr-4">
                          <span className="block text-sm text-gray-200 font-bold">Show Token Usage Breakdown</span>
                          <span className="text-xs text-gray-500">Render quantitative token counters in AI message headers outlining context ingestion weights.</span>
                        </div>
                        <label className="relative inline-flex items-center cursor-pointer shrink-0">
                          <input
                            type="checkbox"
                            checked={tokenDebug}
                            onChange={(e) => updateSetting('advanced', 'tokenDebug', e.target.checked)}
                            className="sr-only peer"
                          />
                          <div className="w-7 h-4 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-300 after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-accent"></div>
                        </label>
                      </div>
                    </div>
                  </div>

                  {/* SECTION 4: STORAGE & BACKUPS */}
                  <div className="space-y-3">
                    <h4 className="text-xs font-bold text-accent uppercase tracking-widest flex items-center space-x-1.5 select-none">
                      <Layers className="w-3.5 h-3.5" />
                      <span>Data Storage & Backups</span>
                    </h4>
                    <div className="bg-[#051116] rounded-xl border border-gray-800/80 divide-y divide-gray-800/80 overflow-hidden">
                      <div className="p-4 flex items-center justify-between">
                        <div className="pr-4">
                          <span className="block text-sm text-gray-200 font-bold">Workspace Folder</span>
                          <span className="text-xs text-gray-500">Open the underlying directory where local documents, memory files, and configurations are stored.</span>
                        </div>
                        <button
                          onClick={handleOpenWorkspace}
                          className="px-3 py-1.5 bg-[#1a2d32] hover:bg-[#243b52] text-white text-xs font-semibold rounded-lg transition-colors border border-gray-700/50 flex items-center space-x-1.5 cursor-pointer shrink-0 ml-4"
                        >
                          <FolderOpen className="w-3.5 h-3.5" />
                          <span>Open Folder</span>
                        </button>
                      </div>

                      <div className="p-4 flex items-center justify-between">
                        <div className="pr-4">
                          <span className="block text-sm text-gray-200 font-bold">Export / Backup Data</span>
                          <span className="text-xs text-gray-500">Compress local databases, workspace settings, and cached models into a safe backup file.</span>
                        </div>
                        <button
                          onClick={handleBackup}
                          className="px-3 py-1.5 bg-[#1a2d32] hover:bg-[#243b52] text-white text-xs font-semibold rounded-lg transition-colors border border-gray-700/50 flex items-center space-x-1.5 cursor-pointer shrink-0 ml-4"
                        >
                          <Database className="w-3.5 h-3.5" />
                          <span>Backup App</span>
                        </button>
                      </div>

                      <div className="p-4 flex items-center justify-between">
                        <div className="pr-4">
                          <span className="block text-sm text-red-400 font-bold">Purge Vector DB Cache</span>
                          <span className="text-xs text-gray-500">Delete all compiled vector indices. Cached knowledge files will require rebuilding to support search features.</span>
                        </div>
                        <button
                          onClick={() => setConfirmAction('purge')}
                          className="px-3 py-1.5 bg-red-600/10 hover:bg-red-600/20 text-red-400 text-xs font-semibold rounded-lg transition-colors border border-red-600/30 flex items-center space-x-1.5 cursor-pointer shrink-0 ml-4"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Purge Indexes</span>
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* =========================================== */}
            {/* 4. ABOUT TAB */}
            {/* =========================================== */}
            {activeTab === 'about' && (
              <div className="space-y-6">
                {/* Brand Header */}
                <div className="shrink-0 mb-4 border-b border-gray-800 pb-4 flex items-center space-x-5">
                  <div className="bg-[#051116] border border-gray-800 p-4 rounded-xl shadow-inner select-none pointer-events-none">
                    <Logo size={72} />
                  </div>
                  <div className="flex flex-col justify-center">
                    <div className="flex items-baseline space-x-3">
                      <Logotype height={44} className="text-white font-bold select-none pointer-events-none" cutColor="#000D11" />
                      <span className="text-[10px] bg-accent/10 border border-accent/25 text-accent px-2 py-0.5 rounded-full font-bold uppercase tracking-wider select-none pointer-events-none">v{appVersion}</span>
                    </div>
                    <p className="text-xs text-gray-500 mt-1 font-medium select-none pointer-events-none">Local-first, highly secure AI orchestration client.</p>
                  </div>
                </div>

                <div className="space-y-4">
                  {/* Auto-update Section */}
                  <div className="bg-[#051116] border border-gray-800/80 rounded-xl p-5 shadow-lg flex items-center justify-between">
                    <div className="space-y-1 pr-4">
                      <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest block mb-1 select-none pointer-events-none">Auto-Update</span>
                      {updateStatus === 'downloaded' ? (
                        <>
                          <h4 className="text-sm font-bold text-emerald-400 leading-tight">Update v{updateVersion} is ready to install!</h4>
                          <p className="text-xs text-gray-400">The new version has been downloaded. Click install to restart and apply.</p>
                        </>
                      ) : updateStatus === 'available' ? (
                        <>
                          <h4 className="text-sm font-bold text-accent leading-tight">Downloading update v{updateVersion}...</h4>
                          <p className="text-xs text-gray-400">Downloading files in the background.</p>
                        </>
                      ) : (
                        <>
                          <h4 className="text-sm font-bold text-gray-200 leading-tight">Kallamo is up to date</h4>
                          <p className="text-xs text-gray-400">You are running the latest version of the application.</p>
                        </>
                      )}
                    </div>
                    {updateStatus === 'downloaded' && (
                      <button
                        onClick={() => electronAPI.installUpdate()}
                        className="shrink-0 text-xs font-bold text-[#011419] bg-emerald-400 hover:bg-emerald-300 px-4 py-2 rounded-lg transition-all active:scale-95 cursor-pointer flex items-center space-x-1.5"
                      >
                        <span>Restart & Install</span>
                      </button>
                    )}
                  </div>

                  {/* Creator Section */}
                  <div className="bg-[#051116] border border-gray-800/80 rounded-xl p-5 shadow-lg flex items-center justify-between">
                    <div className="space-y-1.5 pr-4">
                      <span className="text-[10px] text-accent font-bold uppercase tracking-widest block mb-1 select-none pointer-events-none">Creator</span>
                      <h4 className="text-base font-bold text-white leading-tight">Jonathan Ferreira da Conceição</h4>
                      
                      <div className="flex flex-wrap gap-2 mt-2">
                        {/* GitHub tag */}
                        <div className="flex items-center space-x-1.5 bg-[#101c24]/85 border border-gray-800 text-gray-300 text-[10px] font-semibold px-2 py-0.5 rounded-full select-none">
                          <svg viewBox="0 0 24 24" className="w-3 h-3 text-gray-400" fill="currentColor">
                            <path d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.07 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0012 2z" />
                          </svg>
                          <span>Jonathanfcon</span>
                        </div>

                        {/* Reddit & Discord tag */}
                        <div className="flex items-center space-x-1.5 bg-[#101c24]/85 border border-gray-800 text-gray-300 text-[10px] font-semibold px-2 py-0.5 rounded-full select-none">
                          <div className="flex space-x-1.5 items-center mr-0.5">
                            {/* Discord icon */}
                            <svg viewBox="0 0 127.14 96.36" className="w-3 h-3 text-gray-400" fill="currentColor">
                              <path d="M107.7,8.07A105.15,105.15,0,0,0,77.26,0a77.19,77.19,0,0,0-3.3,6.83A96.67,96.67,0,0,0,53.22,6.83,77.19,77.19,0,0,0,49.88,0,105.15,105.15,0,0,0,19.44,8.07C3.66,31.58-1.86,54.65,1,77.53A105.73,105.73,0,0,0,32,96.36a77.7,77.7,0,0,0,6.63-10.85,68.43,68.43,0,0,1-10.5-5c.9-.65,1.76-1.34,2.58-2.06a75.14,75.14,0,0,0,72.63,0c.82.72,1.68,1.4,2.58,2.06a68.43,68.43,0,0,1-10.5,5,77.7,77.7,0,0,0,6.63,10.85,105.73,105.73,0,0,0,31-18.83C129.87,49.86,123.75,26.9,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53S36.18,40.36,42.45,40.36,53.83,46,53.83,53,48.72,65.69,42.45,65.69ZM84.69,65.69C78.41,65.69,73.24,60,73.24,53S78.41,40.36,84.69,40.36,96.07,46,96.07,53,91,65.69,84.69,65.69Z"/>
                            </svg>
                            {/* Reddit icon */}
                            <svg viewBox="0 0 24 24" className="w-3 h-3 text-gray-400" fill="currentColor">
                              <path d="M24 11.5c0-1.65-1.35-3-3-3-.96 0-1.86.48-2.42 1.24-1.64-1-3.85-1.68-6.23-1.78l1.3-4.1 4.25.9c.02.99.84 1.79 1.85 1.79 1.02 0 1.85-.83 1.85-1.85s-.83-1.85-1.85-1.85c-.75 0-1.4.45-1.69 1.1l-4.71-1c-.26-.06-.52.1-.6.36l-1.63 5.12C8.25 7.15 6.04 7.82 4.4 8.84 3.84 8.08 2.94 7.6 2 7.6c-1.65 0-3 1.35-3 3 0 1.13.63 2.11 1.56 2.62-.06.39-.1.79-.1 1.2 0 4.14 4.8 7.5 10.75 7.5s10.75-3.36 10.75-7.5c0-.4-.04-.8-.1-1.2.93-.5 1.56-1.48 1.56-2.62zm-18 2c0-1.1.9-2 2-2s2 .9 2 2-.9 2-2 2-2-.9-2-2zm10.95 4c-1.01 1.01-2.92 1.1-3.45 1.1-.53 0-2.44-.09-3.45-1.1-.3-.3-.3-.78 0-1.08.3-.3.78-.3 1.08 0 .68.68 1.98.75 2.37.75.39 0 1.69-.07 2.37-.75.3-.3.78-.3 1.08 0 .3.3.3.78 0 1.08zm-.45-2c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z" />
                            </svg>
                          </div>
                          <span>_JustAnotherJohn</span>
                        </div>
                      </div>
                    </div>
                    <a
                      href="https://github.com/Jonathanfcon"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="shrink-0 text-xs font-bold text-accent hover:text-[#011419] bg-accent/5 hover:bg-accent border border-accent/20 hover:border-transparent px-4 py-2 rounded-lg transition-all active:scale-95 cursor-pointer flex items-center space-x-1.5"
                    >
                      <span>GitHub Profile</span>
                    </a>
                  </div>

                  {/* Contributors & Open Source Community */}
                  <div className="bg-[#051116] border border-gray-800/80 rounded-xl p-5 shadow-lg space-y-4">
                    <div className="space-y-1">
                      <span className="text-[10px] text-gray-500 font-bold uppercase tracking-widest block mb-1 select-none pointer-events-none">Contributors</span>
                      <h4 className="text-sm font-bold text-gray-200">Future Contributors & Community</h4>
                      <p className="text-xs text-gray-400 leading-relaxed">Kallamo is built under the open-source <strong className="font-bold text-gray-300">AGPL-3.0 License</strong> and welcomes contributions. Join the development, submit pull requests, or file bug reports on our GitHub organization!</p>
                    </div>

                    <div className="flex flex-wrap gap-2.5 pt-3.5 border-t border-gray-800/60">
                      <a
                        href="https://github.com/Kallamo/Kallamo"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs font-bold text-gray-300 hover:text-white bg-[#0a161d] hover:bg-[#1a2d32] border border-gray-800 rounded-lg px-4.5 py-2.5 transition-all active:scale-95 cursor-pointer flex items-center space-x-2"
                      >
                        <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
                          <path fillRule="evenodd" clipRule="evenodd" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.87 8.17 6.84 9.5.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34-.46-1.16-1.11-1.47-1.11-1.47-.9-.62.07-.6.07-.6 1 .07 1.53 1.03 1.53 1.03.9 1.52 2.34 1.07 2.91.83.09-.65.35-1.09.63-1.34-2.22-.25-4.55-1.11-4.55-4.92 0-1.11.38-2 1.03-2.71-.1-.25-.45-1.29.1-2.64 0 0 .84-.27 2.75 1.02.79-.22 1.65-.33 2.5-.33.85 0 1.71.11 2.5.33 1.91-1.29 2.75-1.02 2.75-1.02.55 1.35.2 2.39.1 2.64.65.71 1.03 1.6 1.03 2.71 0 3.82-2.34 4.66-4.57 4.91.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0012 2z" />
                        </svg>
                        <span>GitHub Repository</span>
                      </a>
                    </div>
                  </div>
                </div>

              </div>
            )}



          </div>

        </div>

      </div>

      {/* CUSTOM CONFIRMATION OVERLAYS */}
      {confirmAction && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 select-none p-4 animate-in fade-in duration-150">
          <div className="w-[400px] bg-[#011419] border border-gray-800 rounded-xl shadow-2xl p-6 flex flex-col space-y-4 animate-in zoom-in-95 duration-200">
            <h3 className="text-base font-bold text-white uppercase tracking-wider">
              {confirmAction === 'purge' ? 'Purge Vector DB Cache' : 'Clear Embeddings Cache'}
            </h3>
            <p className="text-xs text-gray-300 leading-relaxed">
              {confirmAction === 'purge'
                ? 'Are you sure you want to purge all cached vector databases? This will require re-uploading Knowledge Base files to re-index them.'
                : 'Are you sure you want to clear HuggingFace download cache? This forces model downloads on next index.'}
            </p>
            <div className="flex justify-end space-x-3 pt-2">
              <button
                onClick={() => setConfirmAction(null)}
                className="px-4 py-2 text-xs font-semibold text-gray-400 hover:text-white transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={async () => {
                  const action = confirmAction;
                  if (action === 'purge') {
                    await handlePurgeVectors();
                  } else if (action === 'clearCache') {
                    await handleClearCache();
                  }
                }}
                className="px-4 py-2 text-xs font-bold bg-red-600 hover:bg-red-700 text-white rounded transition-colors cursor-pointer"
              >
                Confirm
              </button>
            </div>
          </div>
        </div>
      )}

      {/* BACKUP EXPORT STATUS MODAL */}
      {backupStatus && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 select-none p-4 animate-in fade-in duration-150">
          <div className="w-[400px] bg-[#011419] border border-gray-800 rounded-xl shadow-2xl p-6 flex flex-col space-y-4 animate-in zoom-in-95 duration-200">
            <h3 className="text-base font-bold text-white uppercase tracking-wider">
              {backupStatus.success ? 'Backup Exported' : 'Backup Failed'}
            </h3>
            <p className="text-xs text-gray-300 leading-relaxed whitespace-pre-wrap">
              {backupStatus.success
                ? `Your database backup was successfully exported to:\n\n${backupStatus.path}`
                : `Failed to export workspace backup:\n\n${backupStatus.error}`}
            </p>
            <div className="flex justify-end pt-2">
              <button
                onClick={() => setBackupStatus(null)}
                className="px-4 py-2 text-xs font-bold bg-accent hover:brightness-110 text-[#011419] rounded transition-colors cursor-pointer"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

      {/* GENERAL UTILITY STATUS MODAL */}
      {utilityStatus && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/85 select-none p-4 animate-in fade-in duration-150">
          <div className="w-[400px] bg-[#011419] border border-gray-800 rounded-xl shadow-2xl p-6 flex flex-col space-y-4 animate-in zoom-in-95 duration-200">
            <h3 className="text-base font-bold text-white uppercase tracking-wider text-accent">
              {utilityStatus.title}
            </h3>
            <p className="text-xs text-gray-300 leading-relaxed">
              {utilityStatus.message}
            </p>
            <div className="flex justify-end pt-2">
              <button
                onClick={() => setUtilityStatus(null)}
                className="px-4 py-2 text-xs font-bold bg-accent hover:brightness-110 text-[#011419] rounded transition-colors cursor-pointer"
              >
                OK
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
