import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { X, Image as ImageIcon, Search, Brain, Check, AlertTriangle } from 'lucide-react';

export default function ChatModal({ chat, onClose }) {
  const { 
    handleCreateChat, 
    handleSaveChat, 
    writingProfiles, 
    workflows, 
    electronAPI, 
    settings 
  } = useApp();
  
  const isEditing = !!chat;
  
  // Keep a single unique ID for the chat being configured
  const [chatId] = useState(() => chat?.id || 'chat_' + Math.random().toString(36).substr(2, 9));
  
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [bgImage, setBgImage] = useState('');
  
  // Custom Opacity sliders (defaults are fetched from chat or preset)
  const [backdropOpacity, setBackdropOpacity] = useState(75);
  const [userBubbleOpacity, setUserBubbleOpacity] = useState(100);
  const [aiBubbleOpacity, setAiBubbleOpacity] = useState(0);

  const [activeProfiles, setActiveProfiles] = useState([]);
  const [activeWorkflows, setActiveWorkflows] = useState([]);

  const [searchProfiles, setSearchProfiles] = useState('');
  const [searchWorkflows, setSearchWorkflows] = useState('');

  // Preserved so editing an older workspace doesn't wipe legacy knowledge files.
  const [knowledgeFiles, setKnowledgeFiles] = useState([]);

  const bgInputRef = useRef(null);

  // Load chat details if editing
  useEffect(() => {
    if (chat) {
      setTitle(chat.title || '');
      setDescription(chat.description || '');
      setBgImage(chat.backgroundImage || '');
      setBackdropOpacity(chat.backdropOpacity ?? 75);
      setUserBubbleOpacity(chat.userBubbleOpacity ?? 100);
      setAiBubbleOpacity(chat.aiBubbleOpacity ?? 0);
      
      let loadedProfiles = [];
      try {
        loadedProfiles = chat.activeProfiles 
          ? (typeof chat.activeProfiles === 'string' ? JSON.parse(chat.activeProfiles) : chat.activeProfiles) 
          : [];
        if (!Array.isArray(loadedProfiles)) loadedProfiles = [];
      } catch (err) {
        console.error("Error parsing chat.activeProfiles:", err);
      }

      let loadedWorkflows = [];
      try {
        loadedWorkflows = chat.activeWorkflows 
          ? (typeof chat.activeWorkflows === 'string' ? JSON.parse(chat.activeWorkflows) : chat.activeWorkflows) 
          : [];
        if (!Array.isArray(loadedWorkflows)) loadedWorkflows = [];
      } catch (err) {
        console.error("Error parsing chat.activeWorkflows:", err);
      }

      let loadedKbFiles = [];
      try {
        loadedKbFiles = chat.knowledgeFiles 
          ? (typeof chat.knowledgeFiles === 'string' ? JSON.parse(chat.knowledgeFiles) : chat.knowledgeFiles) 
          : [];
        if (!Array.isArray(loadedKbFiles)) loadedKbFiles = [];
      } catch (err) {
        console.error("Error parsing chat.knowledgeFiles:", err);
      }
        
      setActiveProfiles(loadedProfiles);
      setActiveWorkflows(loadedWorkflows);
      setKnowledgeFiles(loadedKbFiles);
    }
  }, [chat]);

  const handleBgImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    try {
      const destBgPath = await electronAPI.uploadChatBgImage(chatId, file.path || '', file.name);
      setBgImage(destBgPath);
    } catch (err) {
      console.error("Error uploading cover image:", err);
    }
  };

  const handleRemoveBgImage = () => {
    setBgImage('');
  };

  const handleToggleProfile = (profileId) => {
    setActiveProfiles(prev => 
      prev.includes(profileId) ? prev.filter(id => id !== profileId) : [...prev, profileId]
    );
  };

  const handleToggleWorkflow = (workflowId) => {
    setActiveWorkflows(prev => 
      prev.includes(workflowId) ? prev.filter(id => id !== workflowId) : [...prev, workflowId]
    );
  };

  const handleSave = async () => {
    if (!title.trim()) return;

    const chatData = {
      id: chatId,
      title: title.trim(),
      description: description.trim(),
      updatedAt: Date.now(),
      isPinned: chat?.isPinned ?? 0,
      maxContext: chat?.maxContext ?? 128000,
      archiveThreshold: chat?.archiveThreshold ?? 60000,
      summarizedIndex: chat?.summarizedIndex ?? 0,
      activeProfiles: JSON.stringify(activeProfiles),
      activeWorkflows: JSON.stringify(activeWorkflows),
      backgroundImage: bgImage,
      backdropOpacity: Number(backdropOpacity),
      userBubbleOpacity: Number(userBubbleOpacity),
      aiBubbleOpacity: Number(aiBubbleOpacity),
      showContextBar: chat?.showContextBar ?? 0,
      memoryBlocks: JSON.stringify(chat?.memoryBlocks || []),
      knowledgeFiles: JSON.stringify(knowledgeFiles)
    };

    if (isEditing) {
      await handleSaveChat(chatData);
    } else {
      await handleCreateChat(chatData);
    }
    onClose();
  };

  // Filtering profiles & workflows
  const filteredProfiles = writingProfiles.filter(p => 
    p.name.toLowerCase().includes(searchProfiles.toLowerCase())
  );
  
  const filteredWorkflows = workflows.filter(w => 
    w.name.toLowerCase().includes(searchWorkflows.toLowerCase())
  );

  const isBlurEnabled = settings?.interface?.blur ?? true;

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center titlebar-nodrag select-none p-4 ${isBlurEnabled ? 'bg-black/60 backdrop-blur-sm' : 'bg-[#011419]'}`}>
      <div className="bg-[#051116] border border-gray-800 rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto p-6 custom-scrollbar flex flex-col space-y-5 animate-in fade-in zoom-in-95 duration-200 shadow-2xl">
        
        {/* Header */}
        <div className="flex justify-between items-start">
          <div>
            <h2 className="text-xl font-bold text-white tracking-wide font-sans">Workspace Settings</h2>
            <p className="text-xs text-gray-400 mt-1 font-sans">Configure your workspace environment and the profiles it starts with.</p>
          </div>
          <button 
            onClick={onClose}
            className="text-gray-500 hover:text-red-500 hover:bg-white/5 p-1 rounded-md transition-colors cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
        
        <div className="space-y-5 flex-1">
          {/* Cover Image & Basic Settings Column */}
          <div className="grid grid-cols-3 gap-5">
            <div className="col-span-1 flex flex-col">
              <label className="block text-xs font-bold text-gray-200 mb-1.5 font-sans">Cover Image</label>
              
              <div 
                onClick={() => bgInputRef.current?.click()}
                style={bgImage ? { backgroundImage: `url("app-file:///${bgImage.replace(/\\/g, '/')}")` } : {}}
                className="w-full flex-1 min-h-[110px] rounded-lg bg-transparent border-2 border-dashed border-gray-800 hover:border-accent flex flex-col items-center justify-center cursor-pointer transition-colors bg-cover bg-center bg-no-repeat relative group overflow-hidden"
              >
                {!bgImage ? (
                  <div className="flex flex-col items-center justify-center transition-all duration-200">
                    <ImageIcon className="text-gray-600 group-hover:text-accent transition-colors w-6 h-6 mb-1" />
                    <span className="text-[10px] text-gray-500 uppercase tracking-widest font-semibold opacity-0 group-hover:opacity-100 transition-opacity font-sans">Upload Image</span>
                  </div>
                ) : (
                  <button 
                    onClick={(e) => { e.stopPropagation(); handleRemoveBgImage(); }}
                    className="absolute inset-0 w-full h-full bg-black/75 text-white text-[10px] font-bold tracking-widest opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer font-sans"
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

            <div className="col-span-2 flex flex-col space-y-4">
              <div>
                <label className="block text-xs font-bold text-gray-200 mb-1.5 font-sans">Workspace Name</label>
                <input 
                  type="text" 
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className={`w-full bg-[#011419] border text-white text-sm rounded-md px-3 py-2 focus:outline-none focus:border-accent transition-colors font-sans ${!title.trim() && isEditing ? 'border-red-500/50' : 'border-gray-800'}`}
                  placeholder="e.g., Novel Project, Code Sandbox..."
                />
              </div>
              <div className="flex-1 flex flex-col">
                <label className="block text-xs font-bold text-gray-200 mb-1.5 font-sans">Description (Optional)</label>
                <textarea 
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full flex-1 bg-[#011419] border border-gray-800 text-white text-sm rounded-md px-3 py-2 focus:outline-none focus:border-accent resize-none min-h-[70px] font-sans" 
                  placeholder="Brief summary of this workspace..."
                />
              </div>
            </div>
          </div>

          {/* Pre-activate Lists Columns */}
          <div className="grid grid-cols-2 gap-4 pt-2">
            <div className="flex flex-col h-56">
              <label className="block text-xs font-bold text-gray-200 mb-1.5 font-sans">Pre-activate Profiles</label>
              <div className="bg-[#011419] border border-gray-800 rounded-lg flex flex-col flex-1 overflow-hidden">
                <div className="p-2 border-b border-gray-800/80">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 text-gray-500 w-3 h-3" />
                    <input 
                      type="text" 
                      value={searchProfiles}
                      onChange={(e) => setSearchProfiles(e.target.value)}
                      placeholder="Search profiles..." 
                      className="w-full bg-[#051116] border border-gray-800/50 text-gray-300 text-[11px] rounded pl-7 pr-2 py-1.5 focus:outline-none focus:border-accent transition-colors font-sans"
                    />
                  </div>
                </div>
                
                <div className="flex-1 overflow-y-auto custom-scrollbar p-1.5 space-y-1">
                  {filteredProfiles.length === 0 ? (
                    <span className="caption italic block p-1">No profiles found</span>
                  ) : (
                    filteredProfiles.map(p => {
                      const isSelected = activeProfiles.includes(p.id);
                      // Incomplete profiles can't be pre-activated — show a warning
                      // badge in place of the checkbox.
                      if (p.needsSetup) {
                        return (
                          <div
                            key={p.id}
                            className="relative flex items-center space-x-2.5 p-1.5 rounded hover:z-20"
                          >
                            <div className="relative group/warning flex items-center shrink-0">
                              <AlertTriangle className="w-3.5 h-3.5 text-amber-500 cursor-help" />
                              <div className="absolute top-full left-0 mt-2.5 w-56 p-3 text-[10px] leading-relaxed text-amber-200 bg-[#1a0f02] border border-amber-900/50 rounded-lg shadow-xl invisible opacity-0 pointer-events-none group-hover/warning:visible group-hover/warning:opacity-100 transition-all duration-200 z-50 select-none font-semibold text-center">
                                To activate: create an API profile in Settings, then link it to this profile in the Library.
                              </div>
                            </div>
                            <span className="w-2 h-2 rounded-full shrink-0 opacity-40" style={{ backgroundColor: p.color }} />
                            <span className="text-xs text-gray-500 truncate font-sans">{p.name}</span>
                          </div>
                        );
                      }
                      return (
                        <label
                          key={p.id}
                          className="flex items-center space-x-2.5 p-1.5 hover:bg-[#0a161d] rounded cursor-pointer transition-colors"
                        >
                          <div className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95 shrink-0 ${
                            isSelected ? 'bg-accent border-accent text-[#011419] shadow-[0_0_8px_rgba(221,186,110,0.4)]' : 'border-gray-700 bg-[#011419]/90 hover:border-accent/50'
                          }`}>
                            {isSelected && <Check className="w-2.5 h-2.5 text-[#011419] stroke-[3.5]" />}
                          </div>
                          <input
                            type="checkbox"
                            checked={isSelected}
                            onChange={() => handleToggleProfile(p.id)}
                            className="hidden"
                          />
                          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                          <span className="text-xs text-gray-300 truncate font-sans">{p.name}</span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
            
            <div className="flex flex-col h-56">
              <label className="block text-xs font-bold text-gray-200 mb-1.5 font-sans">Pre-activate Workflows</label>
              <div className="bg-[#011419] border border-gray-800 rounded-lg flex flex-col flex-1 overflow-hidden">
                <div className="p-2 border-b border-gray-800/80">
                  <div className="relative">
                    <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 text-gray-500 w-3 h-3" />
                    <input 
                      type="text" 
                      value={searchWorkflows}
                      onChange={(e) => setSearchWorkflows(e.target.value)}
                      placeholder="Search workflows..." 
                      className="w-full bg-[#051116] border border-gray-800/50 text-gray-300 text-[11px] rounded pl-7 pr-2 py-1.5 focus:outline-none focus:border-accent transition-colors font-sans"
                    />
                  </div>
                </div>
                
                <div className="flex-1 overflow-y-auto custom-scrollbar p-1.5 space-y-1">
                  {filteredWorkflows.length === 0 ? (
                    <span className="caption italic block p-1">No workflows found</span>
                  ) : (
                    filteredWorkflows.map(w => {
                      const isSelected = activeWorkflows.includes(w.id);
                      return (
                        <label 
                          key={w.id} 
                          className="flex items-center space-x-2.5 p-1.5 hover:bg-[#0a161d] rounded cursor-pointer transition-colors"
                        >
                          <div className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95 shrink-0 ${
                            isSelected ? 'bg-accent border-accent text-[#011419] shadow-[0_0_8px_rgba(221,186,110,0.4)]' : 'border-gray-700 bg-[#011419]/90 hover:border-accent/50'
                          }`}>
                            {isSelected && <Check className="w-2.5 h-2.5 text-[#011419] stroke-[3.5]" />}
                          </div>
                          <input 
                            type="checkbox" 
                            checked={isSelected} 
                            onChange={() => handleToggleWorkflow(w.id)}
                            className="hidden"
                          />
                          <span className="text-xs text-gray-300 truncate font-sans">{w.name}</span>
                        </label>
                      );
                    })
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Memory pointer */}
          <div className="flex items-center space-x-2.5 bg-[#011419] border border-gray-800/80 rounded-lg px-3.5 py-3">
            <Brain className="w-4 h-4 text-accent shrink-0" />
            <p className="caption">
              Want the AI to know facts, documents or lore? Add them anytime from the <span className="text-accent font-semibold">Memory</span> tab inside the workspace.
            </p>
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end space-x-3 pt-2 shrink-0 border-t border-gray-800/60">
          <button 
            type="button" 
            onClick={onClose} 
            className="px-4 py-2 text-xs font-semibold text-gray-400 hover:text-white transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button 
            type="button" 
            onClick={handleSave}
            disabled={!title.trim()}
            className="px-4 py-2 text-xs bg-accent text-[#011419] font-bold rounded-md hover:brightness-110 disabled:opacity-50 transition-colors shadow-sm min-w-24 flex items-center justify-center cursor-pointer font-sans"
          >
            {isEditing ? 'Save Changes' : 'Create Workspace'}
          </button>
        </div>
      </div>
    </div>
  );
}
