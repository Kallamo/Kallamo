import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { X, Image as ImageIcon, Search, HelpCircle, UploadCloud, FileText, Check } from 'lucide-react';

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

  const [ingestionStrategy, setIngestionStrategy] = useState('full_context'); // 'full_context' | 'rag_search'

  const [activeProfiles, setActiveProfiles] = useState([]);
  const [activeWorkflows, setActiveWorkflows] = useState([]);
  
  const [searchProfiles, setSearchProfiles] = useState('');
  const [searchWorkflows, setSearchWorkflows] = useState('');
  
  const [knowledgeFiles, setKnowledgeFiles] = useState([]);
  
  const [isDragging, setIsDragging] = useState(false);
  
  const fileInputRef = useRef(null);
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

  const handleFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    if (files.length === 0) return;

    const updatedFiles = [...knowledgeFiles];
    for (const f of files) {
      if (updatedFiles.some(existing => existing.name === f.name)) continue;

      try {
        const savedFile = await electronAPI.uploadChatKbFile(chatId, {
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
        console.error("Error uploading chat kb file:", err);
      }
    }
    setKnowledgeFiles(updatedFiles);
  };

  // Handle drag/drop events
  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    if (files.length === 0) return;

    const updatedFiles = [...knowledgeFiles];
    for (const f of files) {
      if (updatedFiles.some(existing => existing.name === f.name)) continue;

      try {
        const savedFile = await electronAPI.uploadChatKbFile(chatId, {
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
        console.error("Error uploading dropped chat kb file:", err);
      }
    }
    setKnowledgeFiles(updatedFiles);
  };

  const removeFile = async (fileName) => {
    try {
      await electronAPI.deleteChatKbFile(chatId, fileName);
      setKnowledgeFiles(prev => prev.filter(f => f.name !== fileName));
    } catch (e) {
      console.error("Error deleting chat kb file:", e);
    }
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
            <p className="text-xs text-gray-400 mt-1 font-sans">Configure your workspace environment, initial profiles, and global knowledge base.</p>
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
                    <span className="text-[10px] text-gray-600 italic block p-1 font-sans">No profiles found</span>
                  ) : (
                    filteredProfiles.map(p => {
                      const isSelected = activeProfiles.includes(p.id);
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
                    <span className="text-[10px] text-gray-600 italic block p-1 font-sans">No workflows found</span>
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

          {/* RAG Knowledge Base Dropzone */}
          <div>
            <div className="flex items-center space-x-1.5 mb-1.5 mt-2">
              <label className="block text-xs font-bold text-gray-200 font-sans">Global Chat Knowledge Base (Shared RAG)</label>
              <HelpCircle 
                data-tooltip="Documents added here act as the global memory for this workspace. All AI profiles will automatically pull relevant context from these files when answering questions." 
                className="w-3.5 h-3.5 text-gray-500 cursor-help hover:text-accent transition-colors"
              />
            </div>

            {/* Strategy Radio Options */}
            <div className="bg-[#051116] border border-gray-800/80 rounded-lg p-3 mb-3 flex gap-4">
              <label className="flex-1 flex items-start space-x-3 cursor-pointer group">
                <input 
                  type="radio" 
                  name="ingestionStrategy" 
                  value="full_context" 
                  checked={ingestionStrategy === 'full_context'}
                  onChange={() => setIngestionStrategy('full_context')}
                  className="mt-1 accent-accent cursor-pointer" 
                />
                <div>
                  <span className="text-xs font-bold text-gray-200 group-hover:text-accent transition-colors font-sans">Constant Memory</span>
                  <p className="text-[9px] text-gray-500 mt-0.5 leading-tight font-sans">Inject full file directly into every prompt (Always loaded).</p>
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
                  className="mt-1 accent-accent cursor-pointer" 
                />
                <div>
                  <span className="text-xs font-bold text-gray-200 group-hover:text-accent transition-colors font-sans">Searchable (RAG)</span>
                  <p className="text-[9px] text-gray-500 mt-0.5 leading-tight font-sans">Chunk the document and load relevant snippets dynamically using vector search.</p>
                </div>
              </label>
            </div>
            
            <div 
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              onClick={() => fileInputRef.current?.click()}
              className="border-2 border-dashed border-gray-800 hover:border-accent bg-[#011419]/50 rounded-xl p-4 text-center cursor-pointer transition-colors group"
            >
              <UploadCloud className="mx-auto mb-1 text-gray-600 group-hover:text-accent transition-colors w-6 h-6" />
              <p className="text-[11px] text-gray-400 font-medium font-sans">Drag and drop document files here, or <span className="text-accent font-sans">browse files</span></p>
              <input 
                type="file" 
                ref={fileInputRef}
                multiple 
                accept=".pdf,.docx,.txt,.md" 
                onChange={handleFileUpload}
                className="hidden" 
              />
            </div>

            {/* List of uploaded RAG files */}
            <div className="flex flex-wrap gap-2 mt-2">
              {knowledgeFiles.map((file, idx) => {
                const isConstant = !file.strategy || file.strategy === 'constant' || file.strategy === 'full_context';
                return (
                  <div 
                    key={idx} 
                    className="flex items-center space-x-1.5 bg-[#0a161d] border border-gray-800 text-gray-300 text-[10px] font-medium px-2.5 py-1.5 rounded-md shadow-sm"
                  >
                    <FileText className="w-3.5 h-3.5 text-accent" />
                    <span className="truncate max-w-[150px] font-sans" title={file.name}>{file.name}</span>
                    <span className={`text-[8px] font-bold px-1.5 py-0.5 rounded border uppercase tracking-wider font-sans ${
                      isConstant 
                        ? 'bg-accent/25 text-accent border-accent/40' 
                        : 'bg-[#3b82f6]/20 text-[#3b82f6] border-[#3b82f6]/30'
                    }`}>
                      {isConstant ? 'Constant' : 'RAG'}
                    </span>
                    <span className="text-[8px] text-gray-500 font-mono">({Math.round(file.size / 1024)} KB)</span>
                    <button 
                      type="button" 
                      onClick={() => removeFile(file.name)} 
                      className="text-gray-500 hover:text-red-500 transition-colors p-0.5 rounded cursor-pointer"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </div>
                );
              })}
            </div>
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
