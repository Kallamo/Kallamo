import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { X, ArrowLeft, ArrowRight, HelpCircle, Database, Cpu, UploadCloud, FileText, RefreshCw, Trash2, ToggleLeft, ToggleRight, Info, AlertTriangle } from 'lucide-react';
import { parseMarkdown, escapeHTML } from '../../utils/markdown';

export default function ProfileModal({ profile, initialStep = 1, onClose, onSave }) {
  const {
    apiProfiles,
    handleSaveProfile,
    electronAPI,
    settings,
    variables
  } = useApp();

  const isEditing = !!profile;
  const [step, setStep] = useState(initialStep);

  // Generate a stable profile ID immediately so KB files go to the correct folder
  const [profileId] = useState(() => profile?.id || 'profile_' + Math.random().toString(36).substr(2, 9));

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#FBCB2D');
  const [apiProfileId, setApiProfileId] = useState('');
  const [model, setModel] = useState('');
  const [temperature, setTemperature] = useState(0.7);
  const [maxTokens, setMaxTokens] = useState(2048);
  const [manualMode, setManualMode] = useState(false);
  const [manualJson, setManualJson] = useState('');
  const [systemPrompt, setSystemPrompt] = useState('');

  const [ingestionStrategy, setIngestionStrategy] = useState('full_context');
  const [knowledgeFiles, setKnowledgeFiles] = useState([]);
  const [isAgentic, setIsAgentic] = useState(false);
  const [agenticPrompt, setAgenticPrompt] = useState('');

  const [isProcessingKb, setIsProcessingKb] = useState(false);
  const [kbProgress, setKbProgress] = useState('');
  const [kbProgressDetail, setKbProgressDetail] = useState(null); // { fileName, current, total }

  const [isDragging, setIsDragging] = useState(false);

  const [fileToDelete, setFileToDelete] = useState(null);

  const [systemPromptMode, setSystemPromptMode] = useState('editor');
  const [agenticPromptMode, setAgenticPromptMode] = useState('editor');

  const [acState, setAcState] = useState({
    isOpen: false,
    search: '',
    triggerIndex: -1,
    activeField: null // 'system' | 'agentic'
  });
  const [acIndex, setAcIndex] = useState(0);

  const fileInputRef = useRef(null);
  const systemTextareaRef = useRef(null);
  const agenticTextareaRef = useRef(null);

  const colors = ['#FBCB2D', '#ff5f56', '#3b82f6', '#10b981', '#9c27b0', '#ec4899', '#6366f1', '#14b8a6', '#f97316', '#4b5563'];

  // Load profile data on edit
  useEffect(() => {
    if (profile) {
      setName(profile.name || '');
      setDescription(profile.description || '');
      setColor(profile.color || '#FBCB2D');
      setApiProfileId(profile.apiProfileId || '');
      setModel(profile.model || '');
      setTemperature(profile.temperature ?? 0.7);
      setMaxTokens(profile.maxTokens ?? 2048);
      setManualMode(profile.manualMode === true || profile.manualMode === 1);
      setManualJson(profile.manualJson || '');
      setSystemPrompt(profile.systemPrompt || '');
      setKnowledgeFiles(
        profile.knowledgeFiles
          ? (typeof profile.knowledgeFiles === 'string' ? JSON.parse(profile.knowledgeFiles) : profile.knowledgeFiles)
          : []
      );
      setIsAgentic(profile.isAgentic === true || profile.isAgentic === 1);
      setAgenticPrompt(profile.agenticPrompt || '');
    }
  }, [profile]);

  useEffect(() => {
    if (isEditing) {
      setStep(1);
    }
  }, [isEditing]);

  // Listen for vectorization progress events
  useEffect(() => {
    if (!electronAPI?.onVectorizationProgress) return;

    const unsub = electronAPI.onVectorizationProgress((data) => {
      if (data.type === 'profile' && data.id === profileId) {
        if (data.status === 'indexing') {
          setIsProcessingKb(true);
          setKbProgress(`Indexing: ${data.fileName}`);
          setKbProgressDetail({
            fileName: data.fileName,
            current: data.current || 0,
            total: data.total || 100
          });
        } else if (data.status === 'completed') {
          setIsProcessingKb(false);
          setKbProgress('Vectorization completed!');
          setKbProgressDetail(null);
          setTimeout(() => setKbProgress(''), 3000);
        } else if (data.status === 'error') {
          setIsProcessingKb(false);
          setKbProgress(`Error indexing ${data.fileName}: ${data.error}`);
          setKbProgressDetail(null);
          setTimeout(() => setKbProgress(''), 5000);
        }
      }
    });

    return () => unsub();
  }, [profileId, electronAPI]);

  // Set default model when API connection changes
  const selectedApi = apiProfiles.find(ap => ap.id === apiProfileId);
  const availableModels = selectedApi ? (typeof selectedApi.models === 'string' ? JSON.parse(selectedApi.models) : selectedApi.models) : [];

  // --- File Upload Handler ---
  const handleFileUpload = async (fileList) => {
    const files = Array.from(fileList);
    if (files.length === 0) return;

    if (knowledgeFiles.length + files.length > 10) {
      setKbProgress('⚠ Maximum of 10 files allowed.');
      setTimeout(() => setKbProgress(''), 3000);
      return;
    }

    const updatedFiles = [...knowledgeFiles];
    for (const f of files) {
      if (updatedFiles.some(existing => existing.name === f.name)) {
        setKbProgress(`⚠ "${f.name}" already exists.`);
        setTimeout(() => setKbProgress(''), 2000);
        continue;
      }

      try {
        setKbProgress(`Uploading ${f.name}...`);
        setIsProcessingKb(true);

        const savedFile = await electronAPI.uploadKbFile(profileId, {
          name: f.name,
          path: f.path || '',
          size: f.size
        });

        if (savedFile) {
          updatedFiles.push({
            name: savedFile.name,
            originalPath: savedFile.originalPath,
            internalPath: savedFile.internalPath,
            size: savedFile.size,
            strategy: ingestionStrategy
          });
        }
      } catch (err) {
        console.error("Error uploading file:", err);
        setKbProgress(`Error: ${err.message}`);
      } finally {
        setIsProcessingKb(false);
        setKbProgress('');
      }
    }
    setKnowledgeFiles(updatedFiles);
  };

  const handleInputFileChange = (e) => {
    handleFileUpload(e.target.files);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // --- Drag and Drop ---
  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
    handleFileUpload(e.dataTransfer.files);
  };

  // --- File Management ---
  const removeFile = async (fileName) => {
    try {
      await electronAPI.deleteKbFile(profileId, fileName);
      setKnowledgeFiles(prev => prev.filter(f => f.name !== fileName));
      setFileToDelete(null);
    } catch (e) {
      console.error("Error deleting file:", e);
    }
  };

  const toggleFileStrategy = (fileName) => {
    setKnowledgeFiles(prev => prev.map(f => {
      if (f.name === fileName) {
        return {
          ...f,
          strategy: f.strategy === 'rag_search' ? 'full_context' : 'rag_search'
        };
      }
      return f;
    }));
  };

  // --- Autocomplete & Preview Logic ---
  const handleTextareaChange = (e, field) => {
    const val = e.target.value;
    const setPrompt = field === 'system' ? setSystemPrompt : setAgenticPrompt;
    setPrompt(val);

    const cursor = e.target.selectionStart;
    const textBeforeCursor = val.substring(0, cursor);

    const openBracesIndex = textBeforeCursor.lastIndexOf('{{');
    const closeBracesIndex = textBeforeCursor.lastIndexOf('}}');

    if (openBracesIndex !== -1 && openBracesIndex > closeBracesIndex) {
      const searchStr = textBeforeCursor.substring(openBracesIndex + 2);
      if (!/\s/.test(searchStr)) {
        setAcState({
          isOpen: true,
          search: searchStr,
          triggerIndex: openBracesIndex,
          activeField: field
        });
        setAcIndex(0);
        return;
      }
    }

    closeAc();
  };

  const closeAc = () => {
    setAcState({ isOpen: false, search: '', triggerIndex: -1, activeField: null });
    setAcIndex(0);
  };

  const insertVariable = (variable) => {
    if (!variable) return;
    const ref = acState.activeField === 'system' ? systemTextareaRef : agenticTextareaRef;
    const value = acState.activeField === 'system' ? systemPrompt : agenticPrompt;
    const setValue = acState.activeField === 'system' ? setSystemPrompt : setAgenticPrompt;

    if (!ref.current) return;

    const cursor = ref.current.selectionStart;
    const beforeText = value.substring(0, acState.triggerIndex);
    const afterText = value.substring(cursor);

    const insertedText = `{{${variable.key}}}`;
    const newValue = beforeText + insertedText + afterText;

    setValue(newValue);
    closeAc();

    setTimeout(() => {
      if (ref.current) {
        ref.current.focus();
        const newCursorPos = beforeText.length + insertedText.length;
        ref.current.setSelectionRange(newCursorPos, newCursorPos);
      }
    }, 50);
  };

  const handleTextareaKeyDown = (e, field) => {
    if (!acState.isOpen) return;

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAcIndex(prev => (prev + 1) % filteredVariables.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setAcIndex(prev => (prev - 1 + filteredVariables.length) % filteredVariables.length);
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      e.preventDefault();
      insertVariable(filteredVariables[acIndex]);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      closeAc();
    }
  };

  const renderPromptPreview = (promptText) => {
    if (!promptText) return '<p class="text-gray-500 italic text-xs">No prompt content defined.</p>';

    let html = parseMarkdown(promptText);

    const varRegex = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
    html = html.replace(varRegex, (match, key) => {
      const found = variables.find(v => v.key === key);
      if (found) {
        return `
          <div class="my-3 border border-gray-800 rounded-lg overflow-hidden bg-[#030d11] select-text">
            <div class="px-3 py-1.5 bg-[#0a161d] border-b border-gray-800 text-[10px] font-mono font-bold text-accent select-none">
              &lt;${key}&gt;
            </div>
            <div class="p-3 text-xs font-mono text-gray-300 whitespace-pre-wrap leading-relaxed">${escapeHTML(found.value)}</div>
            <div class="px-3 py-1 bg-[#0a161d]/50 border-t border-gray-800/40 text-[9px] font-mono text-gray-500 select-none">
              &lt;${key}/&gt;
            </div>
          </div>
        `;
      } else {
        return `<span class="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-red-500/10 text-red-400 border border-red-500/30 select-none">⚠️ {{${key} (not found)}}</span>`;
      }
    });

    return html;
  };

  const filteredVariables = variables.filter(v =>
    v.key.toLowerCase().includes(acState.search.toLowerCase())
  );

  const renderAutocompleteDropdown = () => {
    if (filteredVariables.length === 0) return null;

    return (
      <div className="absolute left-4 right-4 bottom-4 z-40 bg-[#071419] border border-gray-800 rounded-lg shadow-2xl p-2 flex flex-col space-y-1 select-none animate-in slide-in-from-bottom-2 duration-150 max-h-[140px] overflow-y-auto custom-scrollbar">
        <div className="text-[9px] text-gray-500 px-2 pb-1 border-b border-gray-800/60 font-semibold tracking-wider uppercase flex justify-between select-none">
          <span>Variables matching: "${acState.search}"</span>
          <span>⇅ Navigate · ↵ Select</span>
        </div>
        {filteredVariables.map((v, idx) => (
          <button
            key={v.id}
            type="button"
            onClick={() => insertVariable(v)}
            className={`w-full flex items-center justify-between text-left px-2 py-1.5 rounded transition-colors text-xs font-semibold cursor-pointer ${idx === acIndex
              ? 'bg-accent text-[#011419]'
              : 'text-gray-300 hover:bg-white/5'
              }`}
          >
            <div className="flex items-center space-x-2 truncate">
              <span className="font-mono font-bold">&#123;&#123;{v.key}&#125;&#125;</span>
              <span className={`text-[10px] truncate ${idx === acIndex ? 'text-[#011419]/70' : 'text-gray-500'}`}>{v.name}</span>
            </div>
            <span className={`text-[9px] font-mono truncate ml-4 ${idx === acIndex ? 'text-[#011419]/60' : 'text-gray-500'}`}>{v.description || 'No description'}</span>
          </button>
        ))}
      </div>
    );
  };

  // --- Save Profile ---
  const handleSave = async () => {
    if (!name.trim()) return;

    const updatedProfile = {
      id: profileId,
      name: name.trim(),
      description: description.trim(),
      color,
      apiProfileId,
      model,
      temperature: Number(temperature),
      maxTokens: Number(maxTokens),
      systemPrompt: systemPrompt.trim(),
      knowledgeFiles: JSON.stringify(knowledgeFiles),
      manualMode: manualMode ? 1 : 0,
      manualJson: manualJson.trim(),
      isAgentic: isAgentic ? 1 : 0,
      agenticPrompt: agenticPrompt.trim(),
      syncToCloud: profile?.syncToCloud ?? 0
    };

    try {
      await handleSaveProfile(updatedProfile);

      if (onSave) onSave(updatedProfile);
      onClose();
    } catch (e) {
      console.error("Error saving profile:", e);
    }
  };

  // --- KB Stats ---
  const constantFiles = knowledgeFiles.filter(f => !f.strategy || f.strategy === 'full_context');
  const ragFiles = knowledgeFiles.filter(f => f.strategy === 'rag_search');
  const totalSize = knowledgeFiles.reduce((sum, f) => sum + (f.size || 0), 0);

  // File type icon helper
  const getFileIcon = (fileName) => {
    const ext = fileName.split('.').pop().toLowerCase();
    const colors = {
      pdf: 'text-red-400',
      docx: 'text-blue-400',
      doc: 'text-blue-400',
      txt: 'text-gray-400',
      md: 'text-green-400',
    };
    return colors[ext] || 'text-gray-400';
  };

  const isBlurEnabled = settings?.interface?.blur ?? true;

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center titlebar-nodrag select-none p-8 ${isBlurEnabled ? 'bg-black/60 backdrop-blur-sm' : 'bg-[#011419]'}`}>
      <div className="w-full max-w-6xl h-full max-h-[750px] bg-[#000D11] rounded-xl shadow-2xl border border-gray-800/60 flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">

        {/* Header */}
        <div className="shrink-0 flex justify-between items-center h-14 w-full px-6 bg-[#011419] border-b border-gray-800/50">
          <div className="flex items-center space-x-4">
            <h2 className="text-lg font-bold text-white tracking-wide">
              {isEditing ? 'Edit AI Profile' : 'Create AI Profile'}
            </h2>
            {/* Step indicator */}
            {!isEditing && (
              <div className="flex items-center space-x-2">
                <div className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-colors ${step === 1 ? 'bg-accent/20 text-accent' : 'bg-gray-800/50 text-gray-500'
                  }`}>
                  <Cpu className="w-3 h-3" />
                  <span>Identity</span>
                </div>
                <span className="text-gray-600 text-xs">→</span>
                <div className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider transition-colors ${step === 2 ? 'bg-accent/20 text-accent' : 'bg-gray-800/50 text-gray-500'
                  }`}>
                  <Database className="w-3 h-3" />
                  <span>Knowledge Base</span>
                </div>
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-red-500 transition-colors cursor-pointer p-1 rounded-md hover:bg-white/5"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Modal Wizard Body */}
        <div className="flex-1 overflow-y-auto p-6 relative custom-scrollbar">

          {/* STEP 1: IDENTITY & PARAMETERS */}
          {step === 1 && (
            <div className="grid grid-cols-12 gap-8 h-full">

              {/* Left Column (Inputs) */}
              <div className="col-span-5 space-y-6 flex flex-col">
                {/* Identity */}
                <div>
                  <h3 className="text-sm font-bold text-accent uppercase tracking-wider mb-3 border-b border-gray-800 pb-1">
                    Identity
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-bold text-gray-400 mb-1">Profile Name</label>
                      <input
                        type="text"
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        placeholder="Enter profile name..."
                        className="w-full bg-[#011419] border border-gray-800 text-gray-200 text-sm rounded-md px-3 py-2 focus:outline-none focus:border-accent"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-400 mb-1">Description</label>
                      <textarea
                        value={description}
                        onChange={(e) => setDescription(e.target.value)}
                        placeholder="Enter description..."
                        rows={3}
                        className="w-full bg-[#011419] border border-gray-800 text-gray-200 text-sm rounded-md px-3 py-2 focus:outline-none focus:border-accent resize-y min-h-[72px] custom-scrollbar"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-400 mb-1">Theme Color</label>
                      <div className="flex space-x-2.5 flex-wrap gap-y-2">
                        {colors.map(c => (
                          <button
                            key={c}
                            onClick={() => setColor(c)}
                            style={{ backgroundColor: c }}
                            className={`w-6 h-6 rounded-full border-2 focus:outline-none cursor-pointer transition-all ${color === c ? 'border-white scale-110 shadow-md' : 'border-transparent hover:border-white/50'
                              }`}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Engine Connection */}
                <div>
                  <h3 className="text-sm font-bold text-accent uppercase tracking-wider mb-3 border-b border-gray-800 pb-1">
                    Engine Connection
                  </h3>
                  <div className="space-y-3">
                    <div>
                      <label className="block text-xs font-bold text-gray-400 mb-1">Linked API Profile</label>
                      <select
                        value={apiProfileId}
                        onChange={(e) => {
                          setApiProfileId(e.target.value);
                          setModel('');
                        }}
                        className="w-full bg-[#011419] border border-gray-800 text-gray-200 text-sm rounded-md px-3 py-2 focus:outline-none focus:border-accent appearance-none cursor-pointer"
                      >
                        <option value="">None / Not linked</option>
                        {apiProfiles.map(ap => (
                          <option key={ap.id} value={ap.id}>{ap.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs font-bold text-gray-400 mb-1">AI Model</label>
                      <select
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        disabled={!apiProfileId}
                        className="w-full bg-[#011419] border border-gray-800 text-gray-200 text-sm rounded-md px-3 py-2 focus:outline-none focus:border-accent appearance-none cursor-pointer disabled:opacity-50"
                      >
                        <option value="" disabled={!!apiProfileId}>None / Not linked</option>
                        {availableModels.map(m => (
                          <option key={m} value={m}>{m}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>


                {/* Parameters */}
                <div>
                  <div className="flex items-center justify-between mb-2">
                    <label className="block text-xs font-bold text-gray-300 uppercase tracking-wider">
                      Generation Parameters
                    </label>
                    <div className="flex items-center space-x-2">
                      <span className="text-[10px] text-gray-500 font-bold uppercase">Manual JSON Mode</span>
                      <label className="relative inline-flex items-center cursor-pointer">
                        <input
                          type="checkbox"
                          checked={manualMode}
                          onChange={(e) => setManualMode(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-7 h-4 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-300 after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-accent"></div>
                      </label>
                    </div>
                  </div>

                  {!manualMode ? (
                    <div className="flex space-x-4 mb-4">
                      <div className="flex-1 bg-[#051116] p-3 rounded border border-gray-800/80">
                        <div className="flex justify-between text-xs text-gray-400 mb-1">
                          <span>Temperature</span>
                          <span className="font-mono text-accent">{temperature}</span>
                        </div>
                        <input
                          type="range"
                          min="0"
                          max="2"
                          step="0.1"
                          value={temperature}
                          onChange={(e) => setTemperature(parseFloat(e.target.value))}
                          className="w-full accent-accent cursor-pointer"
                        />
                      </div>
                      <div className="flex-1 bg-[#051116] p-3 rounded border border-gray-800/80">
                        <div className="flex justify-between text-xs text-gray-400 mb-1">
                          <span>Max Tokens</span>
                          <span className="font-mono text-accent">{maxTokens}</span>
                        </div>
                        <input
                          type="range"
                          min="256"
                          max="8192"
                          step="256"
                          value={maxTokens}
                          onChange={(e) => setMaxTokens(parseInt(e.target.value))}
                          className="w-full accent-accent cursor-pointer"
                        />
                      </div>
                    </div>
                  ) : (
                    <div className="mb-4">
                      <p className="text-[10px] text-gray-500 mb-2">Inject raw JSON properties into the API payload.</p>
                      <textarea
                        value={manualJson}
                        onChange={(e) => setManualJson(e.target.value)}
                        rows="4"
                        className="w-full bg-[#011419] border border-gray-800 text-accent text-xs font-mono rounded px-3 py-2 focus:outline-none focus:border-accent custom-scrollbar resize-y"
                        placeholder={`{\n  "presence_penalty": 0.5,\n  "top_p": 0.9\n}`}
                      />
                    </div>
                  )}
                </div>

              </div>

              {/* Right Column (System Prompt) */}
              <div className="col-span-7 flex flex-col h-full relative">
                <div className="flex justify-between items-center mb-3 border-b border-gray-800 pb-1.5">
                  <h3 className="text-sm font-bold text-accent uppercase tracking-wider">Behavior & Rules</h3>

                  {/* Editor / Preview Toggles */}
                  <div className="flex bg-[#0a161d] p-0.5 rounded border border-gray-800 text-[10px] font-bold uppercase tracking-wider select-none shrink-0 z-10 space-x-0.5">
                    <button
                      type="button"
                      onClick={() => setSystemPromptMode('editor')}
                      className={`px-3 py-1 rounded cursor-pointer transition-colors ${systemPromptMode === 'editor' ? 'bg-[#1a2d32] text-white' : 'text-gray-500 hover:text-gray-300'
                        }`}
                    >
                      Editor
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setSystemPromptMode('preview');
                        closeAc();
                      }}
                      className={`px-3 py-1 rounded cursor-pointer transition-colors ${systemPromptMode === 'preview' ? 'bg-[#1a2d32] text-white' : 'text-gray-500 hover:text-gray-300'
                        }`}
                    >
                      Preview
                    </button>
                  </div>
                </div>

                {systemPromptMode === 'editor' ? (
                  <div className="flex-1 relative flex flex-col min-h-0">
                    <textarea
                      ref={systemTextareaRef}
                      value={systemPrompt}
                      onChange={(e) => handleTextareaChange(e, 'system')}
                      onKeyDown={(e) => handleTextareaKeyDown(e, 'system')}
                      className="flex-1 w-full bg-[#011419] border border-gray-800 text-gray-200 text-sm rounded-md p-4 focus:outline-none focus:border-accent resize-none font-mono custom-scrollbar"
                      placeholder="Define behavior rules, tone of voice, formatting instructions, and goals for this agent profile..."
                    />

                    {/* Autocomplete Dropdown */}
                    {acState.isOpen && acState.activeField === 'system' && renderAutocompleteDropdown()}
                  </div>
                ) : (
                  <div
                    className="flex-1 w-full bg-[#011419] border border-gray-800 text-gray-200 text-sm rounded-md p-4 overflow-y-auto custom-scrollbar select-text leading-relaxed markdown-body"
                    dangerouslySetInnerHTML={{ __html: renderPromptPreview(systemPrompt) }}
                  />
                )}
              </div>

            </div>
          )}

          {/* STEP 2: KNOWLEDGE BASE MANAGER */}
          {step === 2 && (
            <div className="grid grid-cols-12 gap-8 h-full">

              {/* Left Column: Files Upload & Management */}
              <div className="col-span-7 flex flex-col h-full border-r border-gray-800/60 pr-8">
                <div className="flex justify-between items-end mb-4 border-b border-gray-800 pb-2">
                  <h3 className="text-sm font-bold text-accent uppercase tracking-wider">Knowledge Base Manager</h3>
                  <span className="text-[10px] text-gray-500 font-mono">{knowledgeFiles.length} / 10 FILES</span>
                </div>

                {/* Default Strategy Radio Options */}
                <div className="bg-[#051116] border border-gray-800/80 rounded-lg p-4 mb-4 flex gap-4">
                  <label className="flex-1 flex items-start space-x-3 cursor-pointer group">
                    <input
                      type="radio"
                      name="ingestionStrategy"
                      value="full_context"
                      checked={ingestionStrategy === 'full_context'}
                      onChange={() => setIngestionStrategy('full_context')}
                      className="mt-1 accent-accent"
                    />
                    <div>
                      <span className="text-sm font-bold text-gray-200 group-hover:text-accent transition-colors">Constant Memory</span>
                      <p className="text-[10px] text-gray-500 mt-0.5 leading-tight">Full file injected into every API call. Best for small reference docs.</p>
                    </div>
                  </label>
                  <div className="w-px bg-gray-800/80"></div>
                  <label className="flex-1 flex items-start space-x-3 cursor-pointer group">
                    <input
                      type="radio"
                      name="ingestionStrategy"
                      value="rag_search"
                      checked={ingestionStrategy === 'rag_search'}
                      onChange={() => setIngestionStrategy('rag_search')}
                      className="mt-1 accent-accent"
                    />
                    <div>
                      <span className="text-sm font-bold text-gray-200 group-hover:text-accent transition-colors">Searchable (RAG)</span>
                      <p className="text-[10px] text-gray-500 mt-0.5 leading-tight">Chunked and vectorized. Relevant snippets retrieved via semantic search.</p>
                    </div>
                  </label>
                </div>

                {/* Upload Dropzone Area */}
                <div
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  onClick={() => fileInputRef.current?.click()}
                  className={`w-full border-2 border-dashed rounded-xl p-6 flex flex-col items-center justify-center transition-all cursor-pointer group shrink-0 ${isDragging
                    ? 'border-accent bg-accent/5 scale-[1.01]'
                    : 'border-gray-800 hover:border-accent bg-[#011419]'
                    }`}
                >
                  <input
                    type="file"
                    multiple
                    accept=".txt,.pdf,.md,.docx"
                    ref={fileInputRef}
                    onChange={handleInputFileChange}
                    className="hidden"
                  />
                  <UploadCloud className={`w-8 h-8 mb-2 transition-colors ${isDragging ? 'text-accent' : 'text-gray-500 group-hover:text-accent'}`} />
                  <p className="text-xs text-gray-400 text-center">
                    <span className="font-bold text-gray-200">Click to upload</span> or drag files here
                  </p>
                  <span className="text-[10px] text-gray-600 mt-1">Supports TXT, PDF, MD, DOCX · Max 10 files</span>
                </div>

                {/* Notice about custom memory blocks */}
                <div className="mt-3 bg-[#051116] border border-gray-800/80 rounded-lg p-3 flex items-start space-x-2.5 bg-accent/5">
                  <Info className="w-4 h-4 text-accent shrink-0 mt-0.5" />
                  <div className="text-[10.5px] text-gray-400 leading-normal">
                    <span className="font-bold text-gray-200 text-accent">Note:</span> You can add manual, custom memory snippets to this profile's knowledge base at any time after creation by using the <span className="text-accent font-semibold">Knowledge Base Manager</span>.
                  </div>
                </div>

                {/* Live Vectorization Progress Bar */}
                {isProcessingKb && kbProgressDetail && (
                  <div className="mt-3 bg-[#051116] border border-gray-800/80 rounded-lg p-3 animate-in fade-in duration-200">
                    <div className="flex items-center justify-between text-xs mb-2">
                      <span className="text-accent font-semibold truncate mr-2">{kbProgress}</span>
                      <span className="text-gray-500 font-mono shrink-0">
                        {kbProgressDetail.current}/{kbProgressDetail.total} chunks
                      </span>
                    </div>
                    <div className="w-full h-1.5 bg-gray-800 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-accent transition-all duration-300 ease-out rounded-full"
                        style={{ width: `${Math.round((kbProgressDetail.current / kbProgressDetail.total) * 100)}%` }}
                      />
                    </div>
                  </div>
                )}

                {/* Non-progress status messages */}
                {kbProgress && !kbProgressDetail && (
                  <div className={`mt-3 text-xs font-semibold flex items-center space-x-2 px-1 ${kbProgress.startsWith('⚠') || kbProgress.startsWith('Error')
                    ? 'text-orange-400'
                    : kbProgress.includes('completed')
                      ? 'text-green-400'
                      : 'text-accent animate-pulse'
                    }`}>
                    <span className="w-2 h-2 rounded-full bg-current shrink-0" />
                    <span>{kbProgress}</span>
                  </div>
                )}

                {/* Files List with per-file management */}
                <div className="mt-4 flex flex-col gap-2 overflow-y-auto flex-1 custom-scrollbar pr-1">
                  {knowledgeFiles.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-10 text-gray-600">
                      <Database className="w-8 h-8 opacity-30 mb-2" />
                      <span className="text-xs">No files in Knowledge Base</span>
                      <span className="text-[10px] text-gray-700 mt-1">Upload documents to give this profile contextual memory</span>
                    </div>
                  ) : (
                    knowledgeFiles.map((file, index) => {
                      const isConstant = !file.strategy || file.strategy === 'full_context';
                      const isDeleting = fileToDelete === file.name;

                      return (
                        <div
                          key={index}
                          className={`flex items-center justify-between p-3 rounded-lg group transition-all ${isDeleting
                            ? 'bg-red-500/10 border border-red-500/30'
                            : 'bg-[#051116] border border-gray-800 hover:border-gray-700'
                            }`}
                        >
                          <div className="flex items-center space-x-3 overflow-hidden flex-1 mr-2">
                            <FileText className={`w-4 h-4 shrink-0 ${getFileIcon(file.name)}`} />
                            <div className="flex flex-col overflow-hidden min-w-0">
                              <span className="text-xs text-gray-200 truncate font-medium" title={file.name}>{file.name}</span>
                              <span className="text-[9px] text-gray-600 font-mono">{Math.round((file.size || 0) / 1024)} KB</span>
                            </div>
                          </div>

                          <div className="flex items-center space-x-2 shrink-0">
                            {/* Strategy toggle badge */}
                            <button
                              onClick={() => toggleFileStrategy(file.name)}
                              title={`Click to switch to ${isConstant ? 'RAG Search' : 'Constant Memory'}`}
                              className={`text-[9px] font-bold px-2 py-1 rounded border uppercase tracking-wider cursor-pointer transition-all hover:scale-105 ${isConstant
                                ? 'bg-accent/20 text-accent border-accent/40 hover:bg-accent/30'
                                : 'bg-[#3b82f6]/15 text-[#3b82f6] border-[#3b82f6]/30 hover:bg-[#3b82f6]/25'
                                }`}
                            >
                              {isConstant ? 'Constant' : 'RAG'}
                            </button>

                            {/* Delete with confirmation */}
                            {isDeleting ? (
                              <div className="flex items-center space-x-1 animate-in fade-in duration-150">
                                <button
                                  onClick={() => removeFile(file.name)}
                                  className="text-[9px] font-bold text-red-400 hover:text-red-300 bg-red-500/15 px-2 py-1 rounded border border-red-500/30 cursor-pointer"
                                >
                                  Confirm
                                </button>
                                <button
                                  onClick={() => setFileToDelete(null)}
                                  className="text-[9px] font-bold text-gray-400 hover:text-white px-2 py-1 cursor-pointer"
                                >
                                  Cancel
                                </button>
                              </div>
                            ) : (
                              <button
                                onClick={() => setFileToDelete(file.name)}
                                className="text-gray-600 hover:text-red-500 transition-colors cursor-pointer opacity-0 group-hover:opacity-100 p-1"
                                title="Remove file"
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              </div>

              {/* Right Column: Agentic RAG & KB Stats */}
              <div className="col-span-5 flex flex-col h-full space-y-5">

                {/* KB Stats Overview */}
                <div>
                  <div className="flex justify-between items-end mb-3 border-b border-gray-800 pb-2">
                    <h3 className="text-sm font-bold text-accent uppercase tracking-wider">KB Overview</h3>
                  </div>

                  <div className="grid grid-cols-3 gap-3 mb-1">
                    <div className="bg-[#051116] border border-gray-800/80 rounded-lg p-3 text-center">
                      <span className="block text-xl font-bold text-white">{knowledgeFiles.length}</span>
                      <span className="text-[9px] text-gray-500 uppercase tracking-wider font-bold">Files</span>
                    </div>
                    <div className="bg-[#051116] border border-gray-800/80 rounded-lg p-3 text-center">
                      <span className="block text-xl font-bold text-accent">{constantFiles.length}</span>
                      <span className="text-[9px] text-gray-500 uppercase tracking-wider font-bold">Constant</span>
                    </div>
                    <div className="bg-[#051116] border border-gray-800/80 rounded-lg p-3 text-center">
                      <span className="block text-xl font-bold text-[#3b82f6]">{ragFiles.length}</span>
                      <span className="text-[9px] text-gray-500 uppercase tracking-wider font-bold">RAG</span>
                    </div>
                  </div>

                  <div className="text-[10px] text-gray-500 text-right font-mono px-1">
                    Total size: {totalSize < 1024 * 1024
                      ? `${Math.round(totalSize / 1024)} KB`
                      : `${(totalSize / (1024 * 1024)).toFixed(1)} MB`
                    }
                  </div>
                </div>

                {/* Agentic RAG Section */}
                <div className="flex-1 flex flex-col">
                  <div className="flex justify-between items-end mb-3 border-b border-gray-800 pb-2">
                    <h3 className="text-sm font-bold text-accent uppercase tracking-wider">Smart Search Agent</h3>
                  </div>

                  <div className="bg-[#051116] border border-gray-800/80 rounded-lg p-5 flex flex-col flex-1">
                    <div className="flex items-start justify-between mb-4">
                      <div>
                        <div className="flex items-center space-x-1.5 mb-1">
                          <span className="text-sm font-bold text-gray-200">Enable Agentic RAG</span>
                        </div>
                        <p className="text-[10px] text-gray-500 leading-tight">Runs a two-pass query generation loop to fetch accurate vector memories.</p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
                        <input
                          type="checkbox"
                          checked={isAgentic}
                          onChange={(e) => setIsAgentic(e.target.checked)}
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-300 after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-accent"></div>
                      </label>
                    </div>

                    {isAgentic && (
                      <div className="flex-col flex flex-1 animate-in fade-in duration-200 min-h-0 relative">
                        <div className="flex justify-between items-center mb-2">
                          <label className="block text-xs font-bold text-accent">Agentic System Prompt</label>

                          {/* Editor / Preview Toggles */}
                          <div className="flex bg-[#0a161d] p-0.5 rounded border border-gray-800 text-[9px] font-bold uppercase tracking-wider select-none shrink-0 z-10 space-x-0.5">
                            <button
                              type="button"
                              onClick={() => setAgenticPromptMode('editor')}
                              className={`px-2 py-0.5 rounded cursor-pointer transition-colors ${agenticPromptMode === 'editor' ? 'bg-[#1a2d32] text-white' : 'text-gray-500 hover:text-gray-300'
                                }`}
                            >
                              Editor
                            </button>
                            <button
                              type="button"
                              onClick={() => {
                                setAgenticPromptMode('preview');
                                closeAc();
                              }}
                              className={`px-2 py-0.5 rounded cursor-pointer transition-colors ${agenticPromptMode === 'preview' ? 'bg-[#1a2d32] text-white' : 'text-gray-500 hover:text-gray-300'
                                }`}
                            >
                              Preview
                            </button>
                          </div>
                        </div>

                        {agenticPromptMode === 'editor' ? (
                          <div className="flex-1 relative flex flex-col min-h-0">
                            <textarea
                              ref={agenticTextareaRef}
                              value={agenticPrompt}
                              onChange={(e) => handleTextareaChange(e, 'agentic')}
                              onKeyDown={(e) => handleTextareaKeyDown(e, 'agentic')}
                              className="flex-1 w-full bg-[#011419] border border-gray-800 text-gray-200 text-sm rounded-md p-3 focus:outline-none focus:border-accent resize-none font-mono custom-scrollbar"
                              placeholder='e.g., You are a search query optimizer. Extract the specific names, proper nouns, and primary search keywords from the user prompt. Always keep specific names and proper nouns intact. Output ONLY the optimized query terms without quotes, introduction, or explanation.'
                            />

                            {/* Autocomplete Dropdown */}
                            {acState.isOpen && acState.activeField === 'agentic' && renderAutocompleteDropdown()}
                          </div>
                        ) : (
                          <div
                            className="flex-1 w-full bg-[#011419] border border-gray-800 text-gray-200 text-sm rounded-md p-3 overflow-y-auto custom-scrollbar select-text leading-relaxed markdown-body"
                            dangerouslySetInnerHTML={{ __html: renderPromptPreview(agenticPrompt) }}
                          />
                        )}
                      </div>
                    )}

                    {!isAgentic && (
                      <div className="flex-1 flex flex-col items-center justify-center text-gray-600 opacity-50">
                        <Info className="w-6 h-6 mb-2" />
                        <span className="text-[10px] text-center leading-tight">
                          When enabled, the AI will autonomously search your Knowledge Base before generating responses.
                        </span>
                      </div>
                    )}
                  </div>
                </div>

              </div>

            </div>
          )}

        </div>

        {/* Footer Actions */}
        <div className="shrink-0 flex justify-between items-center h-16 px-6 bg-[#011419] border-t border-gray-800/50">
          <div className="flex items-center space-x-2">
            <button
              onClick={onClose}
              className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white transition-colors cursor-pointer"
            >
              Cancel
            </button>
            {step === 2 && (
              <button
                onClick={() => setStep(1)}
                className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white transition-colors flex items-center space-x-2 cursor-pointer"
              >
                <ArrowLeft className="w-4 h-4" />
                <span>Back</span>
              </button>
            )}
          </div>

          <div>
            {isEditing ? (
              <button
                onClick={handleSave}
                disabled={!name.trim()}
                className="px-5 py-2 text-sm font-medium bg-accent hover:brightness-110 text-[#011419] rounded transition-colors shadow-md font-bold cursor-pointer disabled:opacity-50"
              >
                Save Profile
              </button>
            ) : step === 1 ? (
              <button
                onClick={() => setStep(2)}
                disabled={!name.trim()}
                className="px-5 py-2 text-sm font-medium bg-gray-800 hover:bg-gray-700 text-white rounded transition-colors shadow-md flex items-center space-x-2 cursor-pointer disabled:opacity-50"
              >
                <span>Next: Knowledge Base</span>
                <ArrowRight className="w-4 h-4" />
              </button>
            ) : (
              <button
                onClick={handleSave}
                disabled={isProcessingKb}
                className="px-5 py-2 text-sm font-medium bg-accent hover:brightness-110 text-[#011419] rounded transition-colors shadow-md font-bold cursor-pointer disabled:opacity-50"
              >
                {isProcessingKb ? 'Processing...' : 'Save Profile'}
              </button>
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
