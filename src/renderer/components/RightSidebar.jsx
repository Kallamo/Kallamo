import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { Settings, Folder, Shield, Cpu, Sliders, ChevronDown, Archive, Trash2, ShieldAlert, Sparkles, Plus, HelpCircle, X, Edit, Image as ImageIcon, Check, AlertTriangle } from 'lucide-react';
import ProfileModal from './modals/ProfileModal';
import WorkflowModal from './modals/WorkflowModal';

const safeParseJson = (str, fallback = []) => {
  if (!str) return fallback;
  if (typeof str !== 'string') return str;
  try {
    const parsed = JSON.parse(str);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (e) {
    console.error("safeParseJson error:", e);
    return fallback;
  }
};

export default function RightSidebar({ isOpen, onClose, onTriggerSummarize }) {
  const { 
    activeChat, 
    handleSaveChat, 
    writingProfiles, 
    workflows, 
    activeMessages,
    electronAPI,
    refreshChats,
    showToast
  } = useApp();

  const [accordionOpen, setAccordionOpen] = useState(() => {
    try {
      const saved = localStorage.getItem('kallamo-sidebar-accordion-open');
      if (saved) {
        return JSON.parse(saved);
      }
    } catch (e) {}
    return {
      memory: true,
      appearance: true,
      profiles: true,
      workflows: true
    };
  });

  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showWorkflowModal, setShowWorkflowModal] = useState(false);

  const [searchProfiles, setSearchProfiles] = useState('');
  const [searchWorkflows, setSearchWorkflows] = useState('');

  const [editingBlockId, setEditingBlockId] = useState(null);
  const [editingBlockTitle, setEditingBlockTitle] = useState('');

  const [maxContext, setMaxContext] = useState(128000);
  const [wdContextWindow, setWdContextWindow] = useState(8192);
  const [archiveThreshold, setArchiveThreshold] = useState(60000);
  const [autoSummarize, setAutoSummarize] = useState(false);
  const [memoryBlocks, setMemoryBlocks] = useState([]);



  const bgInputRef = useRef(null);

  // Sync inputs with activeChat
  useEffect(() => {
    if (activeChat) {
      setMaxContext(activeChat.maxContext ?? 128000);
      setWdContextWindow(activeChat.wdContextWindow ?? 8192);
      setArchiveThreshold(activeChat.archiveThreshold ?? 60000);
      setAutoSummarize(activeChat.autoSummarize === 1);
      setMemoryBlocks(activeChat.memoryBlocks ? (typeof activeChat.memoryBlocks === 'string' ? JSON.parse(activeChat.memoryBlocks) : activeChat.memoryBlocks) : []);
    }
  }, [activeChat]);

  if (!isOpen || !activeChat) return null;

  const toggleAccordion = (sec) => {
    setAccordionOpen(prev => {
      const updated = { ...prev, [sec]: !prev[sec] };
      localStorage.setItem('kallamo-sidebar-accordion-open', JSON.stringify(updated));
      return updated;
    });
  };

  const handleUpdateNumberField = async (field, value) => {
    const updated = { ...activeChat, [field]: Number(value) };
    await handleSaveChat(updated);
  };

  const handleToggleAutoSummarize = async (checked) => {
    setAutoSummarize(checked);
    const updated = { ...activeChat, autoSummarize: checked ? 1 : 0 };
    await handleSaveChat(updated);
  };

  const handleAppearanceChange = async (field, value) => {
    const updated = { 
      ...activeChat, 
      [field]: value,
      updatedAt: Date.now()
    };
    await handleSaveChat(updated);
  };

  const handleBgImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const destBgPath = await electronAPI.uploadChatBgImage(activeChat.id, file.path || '', file.name);
      await handleAppearanceChange('backgroundImage', destBgPath);
    } catch (err) {
      console.error("Error uploading sidebar cover image:", err);
    }
  };

  const handleRemoveBgImage = async () => {
    await handleAppearanceChange('backgroundImage', '');
  };

  // Summarize Now action
  const handleSummarizeNow = () => {
    if (!activeChat) return;
    const startIndex = activeChat.summarizedIndex || 0;
    const activeMsgs = activeMessages.slice(startIndex);
    if (activeMsgs.length === 0) {
      showToast("All messages are already archived!", 'info');
      return;
    }
    if (onTriggerSummarize) {
      onTriggerSummarize();
    }
  };

  // Toggle active profiles/workflows in chat
  const activeProfilesList = safeParseJson(activeChat.activeProfiles);
  const activeWorkflowsList = safeParseJson(activeChat.activeWorkflows);

  const toggleProfile = async (profileId) => {
    let updatedList;
    if (activeProfilesList.includes(profileId)) {
      updatedList = activeProfilesList.filter(id => id !== profileId);
    } else {
      updatedList = [...activeProfilesList, profileId];
    }
    const updated = { ...activeChat, activeProfiles: JSON.stringify(updatedList) };
    await handleSaveChat(updated);
  };

  const toggleWorkflow = async (workflowId) => {
    let updatedList;
    if (activeWorkflowsList.includes(workflowId)) {
      updatedList = activeWorkflowsList.filter(id => id !== workflowId);
    } else {
      updatedList = [...activeWorkflowsList, workflowId];
    }
    const updated = { ...activeChat, activeWorkflows: JSON.stringify(updatedList) };
    await handleSaveChat(updated);
  };

  const deleteMemoryBlock = async (blockId) => {
    try {
      const targetBlock = memoryBlocks.find(b => b.id === blockId);
      if (targetBlock && electronAPI.deleteChatKbBlock) {
        await electronAPI.deleteChatKbBlock(activeChat.id, {
          id: targetBlock.id,
          type: targetBlock.type,
          source: targetBlock.title,
          text: targetBlock.summary
        });
      }
      if (refreshChats) {
        await refreshChats(activeChat.id);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const renameMemoryBlock = async (blockId, newTitle) => {
    if (!newTitle.trim()) return;
    try {
      const targetBlock = memoryBlocks.find(b => b.id === blockId);
      if (targetBlock) {
        const updatedBlocks = memoryBlocks.map(b => b.id === blockId ? { ...b, title: newTitle.trim() } : b);
        const updated = { ...activeChat, memoryBlocks: JSON.stringify(updatedBlocks) };
        await handleSaveChat(updated);

        if (electronAPI.saveChatKbBlock) {
          await electronAPI.saveChatKbBlock(activeChat.id, {
            id: targetBlock.id,
            type: targetBlock.type === 'snippet' ? 'manual' : targetBlock.type,
            source: newTitle.trim(),
            text: targetBlock.summary || targetBlock.text || '',
            profiles: targetBlock.profiles || []
          });
        }
        if (refreshChats) {
          await refreshChats(activeChat.id);
        }
      }
      setEditingBlockId(null);
    } catch (e) {
      console.error(e);
    }
  };



  // Filter profiles & workflows
  const filteredProfiles = writingProfiles.filter(p => 
    p.name.toLowerCase().includes(searchProfiles.toLowerCase())
  );
  const filteredWorkflows = workflows.filter(wf => 
    wf.name.toLowerCase().includes(searchWorkflows.toLowerCase())
  );

  // Compute active tokens estimate
  let tokensUsed = 0;
  const estimateTokens = (str) => Math.ceil((str || '').length / 4);
  const startIndex = activeChat.summarizedIndex || 0;
  const activeMsgs = activeMessages.slice(startIndex);
  activeMsgs.forEach(m => { tokensUsed += estimateTokens(m.content); });
  const percentage = Math.min((tokensUsed / archiveThreshold) * 100, 100);

  const bgImage = activeChat.backgroundImage || '';
  const backdropOpacity = activeChat.backdropOpacity ?? 75;
  const userBubbleOpacity = activeChat.userBubbleOpacity ?? 100;
  const aiBubbleOpacity = activeChat.aiBubbleOpacity ?? 0;

  // --- CONTENT RENDERERS ---

  const renderChatMemoryContent = () => (
    <div className="mt-3 space-y-3 animate-in fade-in duration-200">
      <div>
        <div className="flex items-center space-x-1.5 mb-1">
          <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Max API Payload (Tokens)</label>
          <HelpCircle className="w-3.5 h-3.5 text-gray-500 cursor-help shrink-0" data-tooltip="The absolute maximum number of tokens sent to the API. If the context (Lore + Chat + Current Message) exceeds this, older chat messages are silently truncated to prevent API rejection." />
        </div>
        <input
          type="number"
          value={maxContext}
          onChange={(e) => setMaxContext(e.target.value)}
          onBlur={() => handleUpdateNumberField('maxContext', maxContext)}
          onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
          className="w-full bg-[#011419] border border-gray-800 text-gray-200 text-sm rounded px-3 py-1.5 focus:outline-none focus:border-accent"
        />
      </div>

      <div>
        <div className="flex items-center space-x-1.5 mb-1">
          <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Writing Desk Context Window</label>
          <HelpCircle className="w-3.5 h-3.5 text-gray-500 cursor-help shrink-0" data-tooltip="Token budget the Writing Desk uses to decide whole-chapter vs window+RAG when you invoke the AI on a selection. Err low; default 8192." />
        </div>
        <input
          type="number"
          min="1024"
          step="1024"
          value={wdContextWindow}
          onChange={(e) => setWdContextWindow(e.target.value)}
          onBlur={() => handleUpdateNumberField('wdContextWindow', wdContextWindow)}
          onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
          className="w-full bg-[#011419] border border-gray-800 text-gray-200 text-sm rounded px-3 py-1.5 focus:outline-none focus:border-accent"
        />
      </div>

      <div>
        <div className="flex justify-between items-center mb-1">
          <div className="flex items-center space-x-1.5">
            <label className="block text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Archive Threshold</label>
            <HelpCircle className="w-3.5 h-3.5 text-gray-500 cursor-help shrink-0" data-tooltip="The visual limit for active chat memory. Reaching this prompts you to summarize and move older messages to the Vector DB, keeping the active context clean." />
          </div>
          <span className="text-[9px] text-gray-500 font-mono">~{tokensUsed} / {archiveThreshold}</span>
        </div>
        
        <div className="w-full h-1.5 bg-gray-800 rounded-full mb-2 overflow-hidden shadow-inner">
          <div 
            style={{ width: `${percentage}%` }}
            className={`h-full transition-all duration-500 ease-out ${
              percentage >= 95 ? 'bg-red-500' : percentage >= 75 ? 'bg-orange-500' : 'bg-accent'
            }`}
          />
        </div>
        
        <input 
          type="number" 
          value={archiveThreshold}
          onChange={(e) => setArchiveThreshold(e.target.value)}
          onBlur={() => handleUpdateNumberField('archiveThreshold', archiveThreshold)}
          onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
          className="w-full bg-[#011419] border border-gray-800 text-gray-200 text-sm rounded px-3 py-1.5 focus:outline-none focus:border-accent"
        />
      </div>

      <div className="h-px bg-gray-800/80 w-full my-2"></div>

      <div className="flex items-center justify-between">
        <span className="text-xs text-gray-300">Auto-Summarize</span>
        <label className="relative inline-flex items-center cursor-pointer">
          <input 
            type="checkbox" 
            checked={autoSummarize}
            onChange={(e) => handleToggleAutoSummarize(e.target.checked)}
            className="sr-only peer" 
          />
          <div className="w-7 h-4 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-300 after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-accent"></div>
        </label>
      </div>

      <button 
        onClick={handleSummarizeNow}
        className="w-full bg-[#1a2d32] hover:bg-[#243b52] text-accent border border-accent/30 py-1.5 rounded text-xs font-semibold transition-colors cursor-pointer"
      >
        Summarize Now
      </button>

      {memoryBlocks.filter(b => b.type !== 'manual').length > 0 && (
        <div className="space-y-2 max-h-40 overflow-y-auto custom-scrollbar mt-2 pt-2 border-t border-gray-800/80">
          <span className="block text-[9px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">Summarization Blocks</span>
          {memoryBlocks.filter(b => b.type !== 'manual').map(block => (
            <div 
              key={block.id} 
              className="bg-[#011419] border border-gray-800/80 rounded p-2 relative group"
            >
              {editingBlockId === block.id ? (
                <div className="flex items-center space-x-1.5 mt-0.5 mb-1.5">
                  <input 
                    type="text"
                    value={editingBlockTitle}
                    onChange={(e) => setEditingBlockTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') renameMemoryBlock(block.id, editingBlockTitle);
                      else if (e.key === 'Escape') setEditingBlockId(null);
                    }}
                    onBlur={() => renameMemoryBlock(block.id, editingBlockTitle)}
                    className="bg-[#051116] border border-gray-800 text-[10px] text-accent font-bold uppercase rounded px-1.5 py-0.5 w-full focus:outline-none focus:border-accent"
                    autoFocus
                  />
                </div>
              ) : (
                <div className="flex items-center justify-between pr-6 mb-1">
                  <div 
                    onClick={() => {
                      setEditingBlockId(block.id);
                      setEditingBlockTitle(block.title);
                    }}
                    className="group/title text-[10px] font-bold text-accent uppercase truncate cursor-pointer hover:underline flex items-center space-x-1"
                    title="Click to rename"
                  >
                    <span className="truncate">{block.title}</span>
                    <Edit className="w-2.5 h-2.5 text-gray-500 opacity-0 group-hover/title:opacity-100 transition-opacity" />
                  </div>
                </div>
              )}
              <p className="caption line-clamp-2">{block.summary}</p>
              <button 
                onClick={() => deleteMemoryBlock(block.id)}
                className="absolute top-1 right-1 p-1 text-gray-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer" 
                title="Delete Memory"
              >
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );

  const renderAppearanceContent = () => (
    <div className="mt-3 space-y-3.5 animate-in fade-in duration-200">
      <div className="flex flex-col space-y-2">
        <span className="text-[9px] text-gray-400 uppercase font-semibold">Background Image</span>
        
        <div 
          onClick={() => bgInputRef.current?.click()}
          style={bgImage ? { backgroundImage: `url("app-file:///${bgImage.replace(/\\/g, '/')}")` } : {}}
          className="w-full h-24 rounded-lg bg-transparent border-2 border-dashed border-gray-800 hover:border-accent flex flex-col items-center justify-center cursor-pointer transition-colors bg-cover bg-center bg-no-repeat relative group overflow-hidden"
        >
          {!bgImage ? (
            <div className="flex flex-col items-center justify-center transition-all duration-200">
              <ImageIcon className="text-gray-600 group-hover:text-accent transition-colors w-5 h-5 mb-1" />
              <span className="text-[9px] text-gray-500 uppercase tracking-widest font-semibold opacity-0 group-hover:opacity-100 transition-opacity font-sans">Upload Image</span>
            </div>
          ) : (
            <button 
              onClick={(e) => { e.stopPropagation(); handleRemoveBgImage(); }}
              className="absolute inset-0 w-full h-full bg-black/75 text-white text-[9px] font-bold tracking-widest opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer font-sans"
            >
              REMOVE IMAGE
            </button>
          )}
        </div>
        <input 
          type="file" 
          ref={bgInputRef}
          accept="image/*" 
          onChange={handleBgImageUpload}
          className="hidden" 
        />
      </div>

      <div className="space-y-2.5 pt-1">
        <div>
          <div className="flex justify-between text-[9px] text-gray-400 font-semibold mb-1">
            <span>Backdrop Opacity</span>
            <span className="font-mono">{backdropOpacity}%</span>
          </div>
          <input 
            type="range" 
            min="0" 
            max="100" 
            value={backdropOpacity}
            onChange={(e) => handleAppearanceChange('backdropOpacity', parseInt(e.target.value))}
            className="w-full accent-accent cursor-pointer" 
          />
        </div>
        
        <div>
          <div className="flex justify-between text-[9px] text-gray-400 font-semibold mb-1">
            <span>User Chat Bubble Opacity</span>
            <span className="font-mono">{userBubbleOpacity}%</span>
          </div>
          <input 
            type="range" 
            min="0" 
            max="100" 
            value={userBubbleOpacity}
            onChange={(e) => handleAppearanceChange('userBubbleOpacity', parseInt(e.target.value))}
            className="w-full accent-accent cursor-pointer" 
          />
        </div>

        <div>
          <div className="flex justify-between text-[9px] text-gray-400 font-semibold mb-1">
            <span>AI Message Box Opacity</span>
            <span className="font-mono">{aiBubbleOpacity}%</span>
          </div>
          <input 
            type="range" 
            min="0" 
            max="100" 
            value={aiBubbleOpacity}
            onChange={(e) => handleAppearanceChange('aiBubbleOpacity', parseInt(e.target.value))}
            className="w-full accent-accent cursor-pointer" 
          />
        </div>
      </div>
    </div>
  );

  const renderProfilesContent = () => (
    <div className="mt-3 space-y-2 animate-in fade-in duration-200">
      <input 
        type="text"
        value={searchProfiles}
        onChange={(e) => setSearchProfiles(e.target.value)}
        placeholder="Filter profiles..."
        className="w-full bg-[#011419] border border-gray-800 text-gray-300 text-[10px] rounded px-2.5 py-1 focus:outline-none focus:border-accent mb-2"
      />
      
      {filteredProfiles.length === 0 ? (
        <span className="caption italic block">No profiles found</span>
      ) : (
        filteredProfiles.map(p => {
          const isActive = activeProfilesList.includes(p.id);
          // Incomplete profiles (no connection / model / credentials) can't be
          // activated — the checkbox is replaced by a warning badge that points the
          // user to Settings. This is the most critical onboarding moment.
          if (p.needsSetup) {
            return (
              <div
                key={p.id}
                className="relative flex items-center justify-between p-2 rounded bg-[#011419] border border-gray-800 hover:z-20"
              >
                <div className="flex items-center space-x-2 overflow-hidden mr-2">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0 opacity-40" style={{ backgroundColor: p.color }} />
                  <span className="text-xs text-gray-500 truncate">{p.name}</span>
                </div>
                <div className="relative group/warning flex items-center shrink-0">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500 cursor-help" />
                  <div className="absolute top-full right-0 mt-2.5 w-56 p-3 text-[10px] leading-relaxed text-amber-200 bg-[#1a0f02] border border-amber-900/50 rounded-lg shadow-xl invisible opacity-0 pointer-events-none group-hover/warning:visible group-hover/warning:opacity-100 transition-all duration-200 z-50 select-none font-semibold text-center">
                    To activate: create an API profile in Settings, then link it to this profile in the Library.
                  </div>
                </div>
              </div>
            );
          }
          return (
            <label
              key={p.id}
              className="flex items-center justify-between p-2 rounded bg-[#011419] border border-gray-800 hover:border-gray-700 cursor-pointer"
            >
              <div className="flex items-center space-x-2 overflow-hidden mr-2">
                <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                <span className="text-xs text-gray-200 truncate">{p.name}</span>
              </div>
              <div className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95 shrink-0 ${
                isActive ? 'bg-accent border-accent text-[#011419] shadow-[0_0_8px_rgba(221,186,110,0.4)]' : 'border-gray-700 bg-[#011419]/90 hover:border-accent/50'
              }`}>
                {isActive && <Check className="w-2.5 h-2.5 text-[#011419] stroke-[3.5]" />}
              </div>
              <input
                type="checkbox"
                checked={isActive}
                onChange={() => toggleProfile(p.id)}
                className="hidden"
              />
            </label>
          );
        })
      )}
    </div>
  );

  const renderWorkflowsContent = () => (
    <div className="mt-3 space-y-2 animate-in fade-in duration-200">
      <input 
        type="text"
        value={searchWorkflows}
        onChange={(e) => setSearchWorkflows(e.target.value)}
        placeholder="Filter workflows..."
        className="w-full bg-[#011419] border border-gray-800 text-gray-300 text-[10px] rounded px-2.5 py-1 focus:outline-none focus:border-accent mb-2"
      />

      {filteredWorkflows.length === 0 ? (
        <span className="caption italic block">No workflows found</span>
      ) : (
        filteredWorkflows.map(wf => {
          const isActive = activeWorkflowsList.includes(wf.id);
          return (
            <label 
              key={wf.id}
              className="flex items-center justify-between p-2 rounded bg-[#011419] border border-gray-800 hover:border-gray-700 cursor-pointer"
            >
              <span className="text-xs text-gray-200 truncate mr-2">{wf.name}</span>
              <div className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95 shrink-0 ${
                isActive ? 'bg-accent border-accent text-[#011419] shadow-[0_0_8px_rgba(221,186,110,0.4)]' : 'border-gray-700 bg-[#011419]/90 hover:border-accent/50'
              }`}>
                {isActive && <Check className="w-2.5 h-2.5 text-[#011419] stroke-[3.5]" />}
              </div>
              <input 
                type="checkbox" 
                checked={isActive}
                onChange={() => toggleWorkflow(wf.id)}
                className="hidden" 
              />
            </label>
          );
        })
      )}
    </div>
  );

  return (
    <aside className="w-72 bg-[#040d12] border-l border-gray-800/40 flex flex-col h-full shrink-0 relative z-20">
      
      {/* Sidebar Header */}
      <div className="flex items-center justify-between border-b border-gray-800/50 px-4 py-3 shrink-0 bg-[#011419]/30">
        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest font-sans">Chat Settings</span>
      </div>

      <div className="flex flex-col h-full overflow-y-auto custom-scrollbar pb-10 space-y-3 p-3">
        {['memory', 'appearance', 'profiles', 'workflows'].map((sectionId) => {
          const isCollapsed = !accordionOpen[sectionId];
          
          let title = '';
          let headerAction = null;
          let content = null;
          
          if (sectionId === 'memory') {
            title = 'Chat Memory';
            content = renderChatMemoryContent();
          } else if (sectionId === 'appearance') {
            title = 'Appearance Styling';
            content = renderAppearanceContent();
          } else if (sectionId === 'profiles') {
            title = 'Active Profiles';
            headerAction = (
              <button 
                onClick={(e) => { e.stopPropagation(); setShowProfileModal(true); }}
                className="text-[9px] font-bold text-accent hover:underline uppercase flex items-center space-x-0.5 cursor-pointer bg-[#011419]/40 px-1.5 py-0.5 rounded border border-gray-800/60"
              >
                <Plus className="w-2.5 h-2.5" />
                <span>new</span>
              </button>
            );
            content = renderProfilesContent();
          } else if (sectionId === 'workflows') {
            title = 'Active Workflows';
            headerAction = (
              <button 
                onClick={(e) => { e.stopPropagation(); setShowWorkflowModal(true); }}
                className="text-[9px] font-bold text-accent hover:underline uppercase flex items-center space-x-0.5 cursor-pointer bg-[#011419]/40 px-1.5 py-0.5 rounded border border-gray-800/60"
              >
                <Plus className="w-2.5 h-2.5" />
                <span>new</span>
              </button>
            );
            content = renderWorkflowsContent();
          }
          
          return (
            <div
              key={sectionId}
              className="bg-[#0a161d] border border-gray-800/80 rounded-lg p-3 relative group/sec transition-all duration-200 hover:border-gray-800"
            >
              {/* Header Container */}
              <div className="flex items-center justify-between w-full select-none">
                <div className="flex items-center space-x-1.5 min-w-0 flex-1">
                  {/* Title Toggle Button */}
                  <button 
                    onClick={() => toggleAccordion(sectionId)}
                    className="flex items-center space-x-1.5 cursor-pointer text-left focus:outline-none min-w-0 flex-1"
                  >
                    <span className="text-[11px] font-bold text-gray-400 uppercase tracking-wider truncate">{title}</span>
                    <ChevronDown className={`w-3.5 h-3.5 text-gray-500 transform transition-transform duration-200 shrink-0 ${!isCollapsed ? '' : '-rotate-90'}`} />
                  </button>
                </div>
                
                {/* Right Side Header Action */}
                {headerAction && <div className="shrink-0 ml-2">{headerAction}</div>}
              </div>
              
              {/* Collapsible Content */}
              {!isCollapsed && content}
            </div>
          );
        })}
      </div>

      {/* Creation modals rendered overlaying the sidebar */}
      {showProfileModal && (
        <ProfileModal 
          onClose={() => setShowProfileModal(false)}
          onSave={async (newProfile) => {
            const updatedList = [...activeProfilesList, newProfile.id];
            const updated = { ...activeChat, activeProfiles: JSON.stringify(updatedList) };
            await handleSaveChat(updated);
          }}
        />
      )}

      {showWorkflowModal && (
        <WorkflowModal 
          onClose={() => setShowWorkflowModal(false)}
          onSave={async (newWorkflow) => {
            const updatedList = [...activeWorkflowsList, newWorkflow.id];
            const updated = { ...activeChat, activeWorkflows: JSON.stringify(updatedList) };
            await handleSaveChat(updated);
          }}
        />
      )}

    </aside>
  );
}
