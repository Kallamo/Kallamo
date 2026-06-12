import React, { useState, useEffect } from 'react';
import { Search, Folder, Pin, Trash2, Eye, Paperclip, FileText, Image as ImageIcon, Video, Music, Code } from 'lucide-react';

export default function ChatFilesView({
  chat,
  messages = [],
  onSaveChat,
  onReinject,
  onPreviewFile,
  electronAPI
}) {
  const [files, setFiles] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('all'); // 'all' | 'images' | 'videos' | 'documents' | 'code'
  const [loading, setLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState(null); // file object for delete confirmation

  // Parse knowledge files from chat
  const kbFiles = chat?.knowledgeFiles
    ? (typeof chat.knowledgeFiles === 'string' ? JSON.parse(chat.knowledgeFiles) : chat.knowledgeFiles)
    : [];

  useEffect(() => {
    loadFiles();
  }, [chat?.id, messages]);

  const loadFiles = async () => {
    if (!chat?.id) return;
    setLoading(true);
    try {
      // 1. Load user files from disk folder
      let diskFiles = [];
      if (electronAPI.getChatFiles) {
        diskFiles = await electronAPI.getChatFiles(chat.id);
      }

      // 2. Extract AI generated images from messages
      const images = [];
      const imgRegex = /!\[([^\]]*)\]\(([^)]+)\)/g;
      messages.forEach((msg, mIdx) => {
        if (msg.role === 'model' || msg.role === 'ai') {
          let match;
          while ((match = imgRegex.exec(msg.content)) !== null) {
            const imgUrl = match[2];
            // Only add if not already in list and it looks like a local or generated path
            if (!images.some(img => img.url === imgUrl)) {
              // Convert app-file:// or relative path to a structured file object
              const filename = imgUrl.split('/').pop().split('\\').pop() || 'AI_Generated.png';
              images.push({
                name: filename,
                size: 0, // Generated images don't have size info easily
                path: imgUrl.startsWith('app-file://') ? imgUrl.replace('app-file:///', '') : imgUrl,
                isAiGenerated: true,
                url: imgUrl
              });
            }
          }
        }
      });

      // Combine both lists
      const combined = [...diskFiles, ...images];

      // Deduplicate by file path/name
      const uniqueFiles = [];
      const seen = new Set();
      combined.forEach(f => {
        const key = f.path || f.name;
        if (!seen.has(key)) {
          seen.add(key);
          uniqueFiles.push(f);
        }
      });

      setFiles(uniqueFiles);
    } catch (e) {
      console.error("Error loading chat workspace files:", e);
    } finally {
      setLoading(false);
    }
  };

  const getFileExtension = (filename) => {
    return (filename || '').split('.').pop().toLowerCase();
  };

  const getFileType = (filename) => {
    const ext = getFileExtension(filename);
    if (['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'].includes(ext)) return 'image';
    if (['mp4', 'webm', 'ogg'].includes(ext)) return 'video';
    if (['mp3', 'wav'].includes(ext)) return 'audio';
    if (['pdf', 'docx', 'txt', 'md', 'epub'].includes(ext)) return 'document';
    if (['js', 'jsx', 'ts', 'tsx', 'html', 'css', 'json', 'py', 'rs', 'go', 'sh', 'bat', 'yml', 'yaml', 'sql', 'xml'].includes(ext)) return 'code';
    return 'other';
  };

  const handlePinToggle = async (file) => {
    try {
      const updatedKbFiles = [...kbFiles];
      const index = updatedKbFiles.findIndex(f => f.name.toLowerCase() === file.name.toLowerCase());

      if (index >= 0) {
        // Toggle strategy: if constant/full_context -> change to rag_search, else change to full_context
        const currentStrategy = updatedKbFiles[index].strategy;
        const isCurrentConstant = !currentStrategy || currentStrategy === 'full_context' || currentStrategy === 'constant';
        const newStrategy = isCurrentConstant ? 'rag_search' : 'full_context';
        updatedKbFiles[index].strategy = newStrategy;
      } else {
        // Not in knowledge files yet: upload it and register as constant
        const savedFile = await electronAPI.uploadChatKbFile(chat.id, {
          name: file.name,
          path: file.path || '',
          size: file.size || 0
        });

        if (savedFile) {
          updatedKbFiles.push({
            name: savedFile.name,
            originalPath: savedFile.originalPath,
            internalPath: savedFile.internalPath,
            size: savedFile.size,
            strategy: 'full_context',
            profiles: []
          });
        }
      }

      await onSaveChat({
        ...chat,
        knowledgeFiles: JSON.stringify(updatedKbFiles)
      });
    } catch (err) {
      console.error("Error toggling pin status for file:", err);
    }
  };

  const handleDeleteFile = async () => {
    if (!deleteTarget) return;
    try {
      if (electronAPI.deleteChatKbFile) {
        await electronAPI.deleteChatKbFile(chat.id, deleteTarget.name);
      }

      // Update local settings if it was inside knowledgeFiles
      const updatedKbFiles = kbFiles.filter(f => f.name.toLowerCase() !== deleteTarget.name.toLowerCase());
      await onSaveChat({
        ...chat,
        knowledgeFiles: JSON.stringify(updatedKbFiles)
      });

      setDeleteTarget(null);
      loadFiles();
    } catch (e) {
      console.error("Error deleting file:", e);
      alert("Failed to delete file.");
    }
  };

  // Filtered files calculation
  const filteredFiles = files.filter(f => {
    // 1. Search Query
    const query = searchQuery.toLowerCase();
    const nameMatch = f.name.toLowerCase().includes(query);
    if (!nameMatch) return false;

    // 2. Tab Category Filter
    if (activeFilter === 'all') return true;
    const type = getFileType(f.name);
    if (activeFilter === 'images' && type === 'image') return true;
    if (activeFilter === 'videos' && type === 'video') return true;
    if (activeFilter === 'documents' && type === 'document') return true;
    if (activeFilter === 'code' && type === 'code') return true;
    return false;
  });

  const isFilePinned = (fileName) => {
    const kbRecord = kbFiles.find(f => f.name.toLowerCase() === fileName.toLowerCase());
    return !!(kbRecord && (!kbRecord.strategy || kbRecord.strategy === 'full_context' || kbRecord.strategy === 'constant'));
  };

  const sortedFiles = [...filteredFiles].sort((a, b) => {
    const aPinned = isFilePinned(a.name);
    const bPinned = isFilePinned(b.name);
    if (aPinned && !bPinned) return -1;
    if (!aPinned && bPinned) return 1;
    return a.name.localeCompare(b.name);
  });

  console.log("[ChatFilesView] sortedFiles:", sortedFiles.map(f => `${f.name} (pinned: ${isFilePinned(f.name)})`));

  const getFileIcon = (filename) => {
    const type = getFileType(filename);
    switch (type) {
      case 'image': return <ImageIcon className="w-5 h-5 text-emerald-400" />;
      case 'video': return <Video className="w-5 h-5 text-[#3b82f6]" />;
      case 'audio': return <Music className="w-5 h-5 text-rose-400" />;
      case 'code': return <Code className="w-5 h-5 text-accent" />;
      default: return <FileText className="w-5 h-5 text-gray-400" />;
    }
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-[#000508]/40 overflow-hidden relative">

      {/* Top Filter and Search Bar */}
      <div className="shrink-0 p-5 border-b border-gray-800/80 bg-[#011419]/35 flex flex-col md:flex-row md:items-center justify-between gap-4">

        {/* Category Pills */}
        <div className="flex flex-wrap gap-1.5 select-none">
          {['all', 'images', 'videos', 'documents', 'code'].map(category => (
            <button
              key={category}
              onClick={() => setActiveFilter(category)}
              className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg border transition-all cursor-pointer ${activeFilter === category
                ? 'bg-accent/20 border-accent/40 text-accent shadow-md shadow-accent/5'
                : 'bg-transparent border-gray-800 text-gray-400 hover:text-white hover:border-gray-700'
                }`}
            >
              {category}
            </button>
          ))}
        </div>

        {/* Search Input */}
        <div className="relative w-full md:w-64">
          <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 text-gray-500 w-3.5 h-3.5" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search workspace files..."
            className="w-full bg-[#011419] border border-gray-800/80 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-accent transition-colors"
          />
        </div>

      </div>

      {/* Grid Container */}
      <div className="flex-1 overflow-y-auto p-6 custom-scrollbar select-none">

        {loading ? (
          <div className="flex flex-col items-center justify-center h-64 space-y-3">
            <svg className="animate-spin h-6 w-6 text-accent" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            <span className="text-[10px] text-gray-500 uppercase tracking-widest font-bold">Scanning files...</span>
          </div>
        ) : filteredFiles.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center">
            <Folder className="w-12 h-12 text-gray-800 mb-3" />
            <p className="text-xs text-gray-500 font-medium">No files found matching the filter.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
            {sortedFiles.map((file, idx) => {
              const fileType = getFileType(file.name);
              const fileUrl = file.path ? `app-file:///${encodeURI(file.path.replace(/\\/g, '/'))}` : '';

              const kbRecord = kbFiles.find(f => f.name.toLowerCase() === file.name.toLowerCase());
              const isPinned = kbRecord && (!kbRecord.strategy || kbRecord.strategy === 'full_context' || kbRecord.strategy === 'constant');

              return (
                <div
                  key={file.path || file.name}
                  className="group relative bg-[#0a161d]/45 border border-gray-800/80 rounded-xl overflow-hidden shadow-md hover:border-accent/30 transition-all flex flex-col aspect-[4/5] justify-between cursor-pointer"
                  onClick={() => onPreviewFile(file)}
                >
                  {/* Thumbnail / Icon Area */}
                  <div className="flex-1 flex items-center justify-center bg-[#000508]/20 relative overflow-hidden">
                    {fileType === 'image' && fileUrl ? (
                      <img
                        src={fileUrl}
                        alt={file.name}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                      />
                    ) : fileType === 'video' && fileUrl ? (
                      <video
                        src={fileUrl}
                        className="w-full h-full object-cover"
                        muted
                        preload="metadata"
                      />
                    ) : (
                      <div className="p-4 rounded-full bg-[#011419]/50 border border-gray-800/40">
                        {getFileIcon(file.name)}
                      </div>
                    )}

                    {/* Overlay badge (Pinned / AI Generated) */}
                    <div className="absolute top-2 left-2 flex flex-col space-y-1 z-10">
                      {isPinned && (
                        <span className="bg-[#FBCB2D]/15 border border-[#FBCB2D]/30 text-[#FBCB2D] text-[7px] font-bold px-1.5 py-0.5 rounded tracking-wider uppercase font-sans">
                          Pinned
                        </span>
                      )}
                      {file.isAiGenerated && (
                        <span className="bg-cyan-500/10 border border-cyan-500/25 text-cyan-400 text-[7px] font-bold px-1.5 py-0.5 rounded tracking-wider uppercase font-sans">
                          AI Generated
                        </span>
                      )}
                    </div>

                    {/* Hover actions panel */}
                    <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center space-x-2.5 z-10">
                      {/* Reinject button */}
                      {!file.isAiGenerated && (
                        <button
                          onClick={(e) => { e.stopPropagation(); onReinject(file); }}
                          title="Attach to current draft message"
                          className="p-2 bg-[#1a2d32] hover:bg-[#FBCB2D] text-[#FBCB2D] hover:text-[#011419] rounded-lg transition-colors border border-[#FBCB2D]/20"
                        >
                          <Paperclip className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {/* Pin toggle button */}
                      {!file.isAiGenerated && (
                        <button
                          onClick={(e) => { e.stopPropagation(); handlePinToggle(file); }}
                          title={isPinned ? "Unpin file" : "Pin file to context"}
                          className={`p-2 rounded-lg transition-colors border ${isPinned
                            ? 'bg-[#FBCB2D] text-[#011419] border-[#FBCB2D]'
                            : 'bg-[#1a2d32] hover:bg-[#FBCB2D]/20 text-gray-400 hover:text-white border-[#FBCB2D]/20'
                            }`}
                        >
                          <Pin className="w-3.5 h-3.5" />
                        </button>
                      )}

                      {/* Delete button */}
                      {!file.isAiGenerated && (
                        <button
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget(file); }}
                          title="Delete file permanently"
                          className="p-2 bg-red-950/40 hover:bg-red-600 text-red-400 hover:text-white border border-red-950 rounded-lg transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Metadata Footer bar */}
                  <div className="p-3 bg-[#011419]/70 border-t border-gray-800/80 shrink-0">
                    <p className="text-[10px] text-gray-200 font-bold truncate tracking-wide" title={file.name}>
                      {file.name}
                    </p>
                    <div className="flex items-center justify-between text-[8px] text-gray-500 font-medium uppercase font-mono mt-0.5">
                      <span>.{getFileExtension(file.name)}</span>
                      {file.size > 0 && <span>{Math.round(file.size / 1024)} KB</span>}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Elegant Glassmorphism Delete Confirmation Dialog */}
      {deleteTarget && (
        <div className="absolute inset-0 bg-black/75 backdrop-blur-sm z-50 flex items-center justify-center animate-in fade-in duration-200">
          <div className="bg-[#051116] border border-red-900/30 rounded-2xl p-6 max-w-sm w-full mx-4 shadow-2xl animate-in zoom-in-95 duration-200">
            <h4 className="text-xs font-bold text-white uppercase tracking-wider">Delete File</h4>
            <p className="text-[11px] text-gray-400 mt-2 leading-relaxed">
              Are you sure you want to delete <strong className="text-gray-200">{deleteTarget.name}</strong>?
              This will remove the file permanently from the disk and clear any associated RAG vector memory chunks.
            </p>
            <div className="flex justify-end space-x-3 mt-5">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-3.5 py-1.5 text-[10px] uppercase font-bold text-gray-400 hover:text-white transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleDeleteFile}
                className="px-4 py-1.5 bg-red-600 hover:bg-red-500 text-white text-[10px] uppercase font-bold rounded-lg transition-colors shadow-lg shadow-red-950/20 cursor-pointer"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
