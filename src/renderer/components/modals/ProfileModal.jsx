import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { X, Cpu, Palette, SlidersHorizontal, Wand2 } from 'lucide-react';
import { parseMarkdown, escapeHTML } from '../../utils/markdown';

export default function ProfileModal({ profile, onClose, onSave }) {
  const {
    apiProfiles,
    handleSaveProfile,
    settings,
    variables
  } = useApp();

  const isEditing = !!profile;

  // Stable id for new profiles so the KB Manager (opened later) targets the right folder.
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
  const [systemPromptMode, setSystemPromptMode] = useState('editor');

  const [acState, setAcState] = useState({ isOpen: false, search: '', triggerIndex: -1 });
  const [acIndex, setAcIndex] = useState(0);

  const systemTextareaRef = useRef(null);

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
    }
  }, [profile]);

  // Set default model when API connection changes
  const selectedApi = apiProfiles.find(ap => ap.id === apiProfileId);
  const availableModels = selectedApi ? (typeof selectedApi.models === 'string' ? JSON.parse(selectedApi.models) : selectedApi.models) : [];

  // --- Variable autocomplete & preview (System Prompt) ---
  const closeAc = () => {
    setAcState({ isOpen: false, search: '', triggerIndex: -1 });
    setAcIndex(0);
  };

  const handleTextareaChange = (e) => {
    const val = e.target.value;
    setSystemPrompt(val);

    const cursor = e.target.selectionStart;
    const textBeforeCursor = val.substring(0, cursor);
    const openBracesIndex = textBeforeCursor.lastIndexOf('{{');
    const closeBracesIndex = textBeforeCursor.lastIndexOf('}}');

    if (openBracesIndex !== -1 && openBracesIndex > closeBracesIndex) {
      const searchStr = textBeforeCursor.substring(openBracesIndex + 2);
      if (!/\s/.test(searchStr)) {
        setAcState({ isOpen: true, search: searchStr, triggerIndex: openBracesIndex });
        setAcIndex(0);
        return;
      }
    }
    closeAc();
  };

  const insertVariable = (variable) => {
    if (!variable || !systemTextareaRef.current) return;

    const cursor = systemTextareaRef.current.selectionStart;
    const beforeText = systemPrompt.substring(0, acState.triggerIndex);
    const afterText = systemPrompt.substring(cursor);
    const insertedText = `{{${variable.key}}}`;
    const newValue = beforeText + insertedText + afterText;

    setSystemPrompt(newValue);
    closeAc();

    setTimeout(() => {
      if (systemTextareaRef.current) {
        systemTextareaRef.current.focus();
        const pos = beforeText.length + insertedText.length;
        systemTextareaRef.current.setSelectionRange(pos, pos);
      }
    }, 50);
  };

  const filteredVariables = variables.filter(v =>
    v.key.toLowerCase().includes(acState.search.toLowerCase())
  );

  const handleTextareaKeyDown = (e) => {
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

  const renderAutocompleteDropdown = () => {
    if (filteredVariables.length === 0) return null;

    return (
      <div className="absolute left-4 right-4 bottom-4 z-40 bg-[#071419] border border-gray-800 rounded-lg shadow-2xl p-2 flex flex-col space-y-1 select-none animate-in slide-in-from-bottom-2 duration-150 max-h-[140px] overflow-y-auto custom-scrollbar">
        <div className="text-[9px] text-gray-500 px-2 pb-1 border-b border-gray-800/60 font-semibold tracking-wider uppercase flex justify-between select-none">
          <span>Variables matching: "{acState.search}"</span>
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
  // Knowledge Base (files + agentic RAG) lives in the KB Manager now, so we never
  // author it here; on edit we carry the profile's existing KB through untouched.
  const handleSave = async () => {
    if (!name.trim()) return;

    const preservedKb = profile?.knowledgeFiles
      ? (typeof profile.knowledgeFiles === 'string' ? profile.knowledgeFiles : JSON.stringify(profile.knowledgeFiles))
      : JSON.stringify([]);

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
      knowledgeFiles: preservedKb,
      manualMode: manualMode ? 1 : 0,
      manualJson: manualJson.trim(),
      isAgentic: profile?.isAgentic ? 1 : 0,
      agenticPrompt: profile?.agenticPrompt || '',
      agenticMaxTurns: Number.isInteger(profile?.agenticMaxTurns)
        ? Math.min(5, Math.max(1, profile.agenticMaxTurns))
        : 3,
      syncToCloud: profile?.syncToCloud ?? 0
    };

    try {
      await handleSaveProfile(updatedProfile);
      if (onSave) onSave(updatedProfile, { isNew: !isEditing });
      onClose();
    } catch (e) {
      console.error("Error saving profile:", e);
    }
  };

  const isBlurEnabled = settings?.interface?.blur ?? true;

  // Shared visual language, aligned with the Configuration view:
  // breathing cards + accent-medallion section heads instead of underlined titles.
  const cardCls = "bg-[#0a161d]/50 border border-gray-800/60 rounded-2xl p-5";
  const labelCls = "block text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5";
  const fieldCls = "w-full bg-[#011419] border border-gray-800 text-gray-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-accent transition-colors";
  const Head = ({ icon: Icon, title, right }) => (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2.5">
        <span className="w-8 h-8 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
          <Icon className="w-4 h-4 text-accent" />
        </span>
        <h3 className="text-xs font-bold text-white uppercase tracking-wider">{title}</h3>
      </div>
      {right}
    </div>
  );

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center titlebar-nodrag select-none p-8 ${isBlurEnabled ? 'bg-black/60 backdrop-blur-sm' : 'bg-[#011419]'}`}>
      <div className="w-full max-w-6xl h-full max-h-[880px] bg-[#000D11] rounded-xl shadow-2xl border border-gray-800/60 flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">

        {/* Header */}
        <div className="shrink-0 flex justify-between items-center h-14 w-full px-6 bg-[#011419] border-b border-gray-800/50">
          <h2 className="text-lg font-bold text-white tracking-wide">
            {isEditing ? 'Edit AI Profile' : 'Create AI Profile'}
          </h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-red-500 transition-colors cursor-pointer p-1 rounded-md hover:bg-white/5"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6 relative custom-scrollbar">
          <div className="grid grid-cols-12 gap-6 h-full">

            {/* Left Column (Inputs) */}
            <div className="col-span-5 space-y-4 flex flex-col">
              {/* Identity */}
              <div className={cardCls}>
                <Head icon={Palette} title="Identity" />
                <div className="space-y-3.5">
                  <div>
                    <label className={labelCls}>Profile Name</label>
                    <input
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="Enter profile name..."
                      className={fieldCls}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Description</label>
                    <textarea
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Enter description..."
                      rows={2}
                      className={`${fieldCls} resize-y min-h-[64px] custom-scrollbar`}
                    />
                  </div>
                  <div>
                    <label className={labelCls}>Theme Color</label>
                    <div className="flex flex-wrap gap-2.5">
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

              {/* Engine Connection + Generation — one card: the model and how it generates
                  belong together. Params sit as a lighter sub-section, not a second medallion. */}
              <div className={`${cardCls} flex-1 flex flex-col`}>
                <Head icon={Cpu} title="Engine Connection" />
                <div className="space-y-3.5">
                  <div>
                    <label className={labelCls}>Linked API Profile</label>
                    <select
                      value={apiProfileId}
                      onChange={(e) => {
                        setApiProfileId(e.target.value);
                        setModel('');
                      }}
                      className={`${fieldCls} appearance-none cursor-pointer`}
                    >
                      <option value="">None / Not linked</option>
                      {apiProfiles.map(ap => (
                        <option key={ap.id} value={ap.id}>{ap.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className={labelCls}>AI Model</label>
                    <select
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                      disabled={!apiProfileId}
                      className={`${fieldCls} appearance-none cursor-pointer disabled:opacity-50`}
                    >
                      <option value="" disabled={!!apiProfileId}>None / Not linked</option>
                      {availableModels.map(m => (
                        <option key={m} value={m}>{m}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="mt-auto pt-4 border-t border-gray-800/60">
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider flex items-center gap-1.5">
                      <SlidersHorizontal className="w-3 h-3 text-gray-500" /> Generation
                    </span>
                    <div className="flex items-center space-x-2">
                      <span className="text-[9px] text-gray-500 font-bold uppercase tracking-wider">Manual JSON</span>
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
                    <div className="flex gap-3">
                      <div className="flex-1 bg-[#011419] p-3 rounded-lg border border-gray-800/80">
                        <div className="flex justify-between text-[11px] text-gray-400 mb-1.5">
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
                      <div className="flex-1 bg-[#011419] p-3 rounded-lg border border-gray-800/80">
                        <div className="flex justify-between text-[11px] text-gray-400 mb-1.5">
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
                    <div>
                      <p className="caption mb-2">Inject raw JSON properties into the API payload.</p>
                      <textarea
                        value={manualJson}
                        onChange={(e) => setManualJson(e.target.value)}
                        rows="4"
                        className="w-full bg-[#011419] border border-gray-800 text-accent text-xs font-mono rounded-lg px-3 py-2 focus:outline-none focus:border-accent custom-scrollbar resize-y"
                        placeholder={`{\n  "presence_penalty": 0.5,\n  "top_p": 0.9\n}`}
                      />
                    </div>
                  )}
                </div>
              </div>

            </div>

            {/* Right Column (System Prompt) */}
            <div className="col-span-7 flex flex-col h-full">
              <div className={`${cardCls} flex flex-col h-full min-h-0`}>
                <Head icon={Wand2} title="Behavior & Rules" right={
                  <div className="flex bg-[#011419] p-0.5 rounded-lg border border-gray-800 text-[10px] font-bold uppercase tracking-wider select-none shrink-0 z-10 space-x-0.5">
                    <button
                      type="button"
                      onClick={() => setSystemPromptMode('editor')}
                      className={`px-3 py-1 rounded-md cursor-pointer transition-colors ${systemPromptMode === 'editor' ? 'bg-[#1a2d32] text-white' : 'text-gray-500 hover:text-gray-300'
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
                      className={`px-3 py-1 rounded-md cursor-pointer transition-colors ${systemPromptMode === 'preview' ? 'bg-[#1a2d32] text-white' : 'text-gray-500 hover:text-gray-300'
                        }`}
                    >
                      Preview
                    </button>
                  </div>
                } />

                {systemPromptMode === 'editor' ? (
                  <div className="flex-1 relative flex flex-col min-h-0">
                    <textarea
                      ref={systemTextareaRef}
                      value={systemPrompt}
                      onChange={handleTextareaChange}
                      onKeyDown={handleTextareaKeyDown}
                      className="flex-1 w-full bg-[#011419] border border-gray-800 text-gray-200 text-sm rounded-lg p-4 focus:outline-none focus:border-accent resize-none font-mono custom-scrollbar"
                      placeholder="Define behavior rules, tone of voice, formatting instructions, and goals for this agent profile..."
                    />
                    {acState.isOpen && renderAutocompleteDropdown()}
                  </div>
                ) : (
                  <div
                    className="flex-1 w-full bg-[#011419] border border-gray-800 text-gray-200 text-sm rounded-lg p-4 overflow-y-auto custom-scrollbar select-text leading-relaxed markdown-body"
                    dangerouslySetInnerHTML={{ __html: renderPromptPreview(systemPrompt) }}
                  />
                )}
              </div>
            </div>

          </div>
        </div>

        {/* Footer Actions */}
        <div className="shrink-0 flex justify-between items-center h-16 px-6 bg-[#011419] border-t border-gray-800/50">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-400 hover:text-white transition-colors cursor-pointer"
          >
            Cancel
          </button>

          <button
            onClick={handleSave}
            disabled={!name.trim()}
            className="px-5 py-2 text-sm font-medium bg-accent hover:brightness-110 text-[#011419] rounded transition-colors shadow-md font-bold cursor-pointer disabled:opacity-50"
          >
            Save Profile
          </button>
        </div>

      </div>
    </div>
  );
}
