import React, { useState, useRef, useEffect } from 'react';
import { Database, Plus, Trash2, Edit, Search, HelpCircle, Check, ChevronDown, Sparkles, FileText, Info, X as XIcon, Brain, Loader, Download, Upload } from 'lucide-react';
import { useApp } from '../context/AppContext';
import ImportProgressModal from './modals/ImportProgressModal';
import ConfirmDialog from './ui/ConfirmDialog';
import TextInput from './ui/TextInput';
import Textarea from './ui/Textarea';
import Badge from './ui/Badge';
import TokenBadge from './ui/TokenBadge';
import EmptyState from './ui/EmptyState';
import Checkbox from './ui/Checkbox';
import RenameFilesModal from './ui/RenameFilesModal';

export default function ChatMemoryView({
  chat,
  onSaveChat,
  electronAPI
}) {
  const { writingProfiles, settings, refreshChats, showToast } = useApp();
  const [activeFilter, setActiveFilter] = useState('all'); // 'all' | 'constants' | 'rag' | 'snippets' | 'summarized'
  const [searchQuery, setSearchQuery] = useState('');
  const [summaryTokens, setSummaryTokens] = useState({}); // { [blockId]: approxTokenCount } for history-summary blocks
  const [confirmDialog, setConfirmDialog] = useState(null); // { message, onConfirm }
  const [pendingUpload, setPendingUpload] = useState(null); // { fresh, conflicts, type }
  const [uploadingAction, setUploadingAction] = useState(null); // 'skip' | 'rename' | 'replace' | null
  const [renamePrompt, setRenamePrompt] = useState(null); // { fresh, conflicts, type }

  const getUniqueName = (originalName, existingSources, extraNames = new Set()) => {
    const lastDot = originalName.lastIndexOf('.');
    let base = originalName;
    let ext = '';
    if (lastDot !== -1) {
      base = originalName.substring(0, lastDot);
      ext = originalName.substring(lastDot);
    }
    const existingSet = new Set(existingSources.map(s => s.toLowerCase()));
    let newName = originalName;
    let counter = 2;
    while (existingSet.has(newName.toLowerCase()) || extraNames.has(newName.toLowerCase())) {
      newName = `${base} (${counter})${ext}`;
      counter++;
    }
    return newName;
  };

  const [kbProgress, setKbProgress] = useState(0);
  const [kbProgressStatus, setKbProgressStatus] = useState('');
  const [kbOpType, setKbOpType] = useState(null); // 'export' | 'import' | null

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingBlock, setEditingBlock] = useState(null); // null means adding a new snippet
  const [editorTitle, setEditorTitle] = useState('');
  const [editorText, setEditorText] = useState('');
  const [savingSnippet, setSavingSnippet] = useState(false);
  const [editorError, setEditorError] = useState('');

  const [editorKeywords, setEditorKeywords] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [tagSuggestionsOpen, setTagSuggestionsOpen] = useState(false);
  const [editorStrategy, setEditorStrategy] = useState('rag_search');
  const [viewingFileBlock, setViewingFileBlock] = useState(null);

  const handleAddTag = () => {
    if (!tagInput.trim()) return;
    const rawTag = tagInput.trim().toLowerCase();
    const normalizedTag = rawTag.startsWith('#') ? rawTag : `#${rawTag}`;
    if (!editorKeywords.includes(normalizedTag)) {
      setEditorKeywords(prev => [...prev, normalizedTag]);
    }
    setTagInput('');
    setTagSuggestionsOpen(false);
  };

  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);

  const [selectedBlockIds, setSelectedBlockIds] = useState([]);
  const [isBulkDeleteConfirmOpen, setIsBulkDeleteConfirmOpen] = useState(false);

  const [isProcessing, setIsProcessing] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [progressDetail, setProgressDetail] = useState(null); // { fileName, current, total }

  const [activeScopingBlockId, setActiveScopingBlockId] = useState(null);

  const [simQuery, setSimQuery] = useState('');
  const [simResults, setSimResults] = useState(null);
  const [simLoading, setSimLoading] = useState(false);

  const [renamingId, setRenamingId] = useState(null);
  const [renameTitle, setRenameTitle] = useState('');

  const [deleteTarget, setDeleteTarget] = useState(null); // normalized block object

  const fileInputRef = useRef(null);
  const [uploadStrategy, setUploadStrategy] = useState('full_context');
  const [addDropdownOpen, setAddDropdownOpen] = useState(false);

  const [selectedSummaryBlock, setSelectedSummaryBlock] = useState(null);

  const [simProfileId, setSimProfileId] = useState('');

  const loadBlocks = async () => {
    if (!chat?.id) return;
    try {
      setLoading(true);
      const data = await electronAPI.getChatKbBlocks(chat.id);
      const currentKbFiles = chat?.knowledgeFiles
        ? (typeof chat.knowledgeFiles === 'string' ? JSON.parse(chat.knowledgeFiles) : chat.knowledgeFiles)
        : [];

      // Map 'manual' block type from backend to 'snippet' for frontend consistency
      const mappedData = data.map(b => {
        let blockProfiles = [];
        if (b.type === 'constant' || b.type === 'rag') {
          const parentFile = currentKbFiles.find(f => f.name === b.source);
          if (parentFile) {
            blockProfiles = parentFile.profiles || [];
          }
        } else {
          blockProfiles = b.rawItem.profiles || b.profiles || [];
        }
        return {
          ...b,
          type: b.type === 'manual' ? 'snippet' : b.type,
          dbType: b.type === 'constant' || b.type === 'rag' ? 'kb_block' : 'snippet',
          title: b.source,
          summary: b.text,
          profiles: blockProfiles,
          keywords: b.rawItem.keywords || b.keywords || [],
          strategy: b.strategy || b.rawItem.strategy || 'rag_search'
        };
      });
      setBlocks(mappedData);
      setViewingFileBlock(current => {
        if (!current) return null;
        const updatedChunks = mappedData.filter(b => b.type === 'rag' && b.source === current.source);
        if (updatedChunks.length > 0) {
          return { ...current, chunks: updatedChunks };
        }
        return null;
      });
    } catch (e) {
      console.error("Error loading chat KB blocks:", e);
    } finally {
      setLoading(false);
    }
  };

  const handleExportChatKb = async () => {
    if (!chat) return;
    setKbProgress(0);
    setKbProgressStatus('Initializing export...');
    setKbOpType('export');

    let unsub = null;
    if (electronAPI?.onExportProgress) {
      unsub = electronAPI.onExportProgress((data) => {
        setKbProgress(data.progress);
        setKbProgressStatus(data.status);
      });
    }

    try {
      const result = await electronAPI.exportChatKnowledgeBase(chat.id, chat.title || 'Workspace Memory');
      if (result && result.success) {
        await new Promise(resolve => setTimeout(resolve, 600));
      }
    } catch (e) {
      console.error("Failed to export Workspace Knowledge Base:", e);
      showToast("Failed to export Workspace Knowledge Base.", "error");
    } finally {
      if (unsub) unsub();
      setKbOpType(null);
    }
  };

  const handleImportChatKb = async () => {
    if (!chat) return;
    setKbProgress(0);
    setKbProgressStatus('Initializing import...');
    setKbOpType('import');

    let unsub = null;
    if (electronAPI?.onImportProgress) {
      unsub = electronAPI.onImportProgress((data) => {
        setKbProgress(data.progress);
        setKbProgressStatus(data.status);
      });
    }

    try {
      const result = await electronAPI.importChatKnowledgeBase(chat.id);
      if (result && result.success) {
        await new Promise(resolve => setTimeout(resolve, 600));
        await refreshChats(chat.id);
        loadBlocks();
      }
    } catch (e) {
      console.error("Failed to import Workspace Knowledge Base:", e);
      showToast("Failed to import Workspace Knowledge Base.", "error");
    } finally {
      if (unsub) unsub();
      setKbOpType(null);
    }
  };

  useEffect(() => {
    setSelectedBlockIds([]);
    loadBlocks();
  }, [chat?.id]);

  useEffect(() => {
    setSelectedBlockIds([]);
  }, [activeFilter]);

  // Listen to IPC vectorization progress
  useEffect(() => {
    if (!electronAPI?.onVectorizationProgress || !chat?.id) return;

    const unsub = electronAPI.onVectorizationProgress((data) => {
      if (data.type === 'chat' && data.id === chat.id) {
        if (data.status === 'indexing') {
          setIsProcessing(true);
          setProgressMsg(`Indexing: ${data.fileName}`);
          setProgressDetail({
            fileName: data.fileName,
            current: data.current || 0,
            total: data.total || 100
          });
        } else if (data.status === 'completed') {
          setIsProcessing(false);
          setProgressMsg('Vectorization completed!');
          setProgressDetail(null);
          loadBlocks();
          setTimeout(() => setProgressMsg(''), 3000);
        } else if (data.status === 'error') {
          setIsProcessing(false);
          setProgressMsg(`Error indexing ${data.fileName}: ${data.error}`);
          setProgressDetail(null);
          setTimeout(() => setProgressMsg(''), 5000);
        }
      }
    });

    return () => unsub();
  }, [chat?.id, electronAPI]);

  // Parse KB Files registry from chat record
  const kbFiles = chat?.knowledgeFiles
    ? (typeof chat.knowledgeFiles === 'string' ? JSON.parse(chat.knowledgeFiles) : chat.knowledgeFiles)
    : [];

  // Parse Memory Blocks registry from chat record
  const memoryBlocks = chat?.memoryBlocks
    ? (typeof chat.memoryBlocks === 'string' ? JSON.parse(chat.memoryBlocks) : chat.memoryBlocks)
    : [];

  // Parse summary blocks (History Summaries) from database record
  const summaryBlocks = memoryBlocks.filter(b => b.type !== 'manual').map(b => ({
    id: b.id,
    dbType: 'snippet',
    type: 'summarized',
    title: b.title,
    summary: b.summary,
    profiles: b.profiles || [],
    tokenCount: summaryTokens[b.id] || 0,
    raw: b
  }));

  // Group searchable chunks by their parent file name
  const groupedBlocks = React.useMemo(() => {
    const list = [];
    const ragGroups = {};

    blocks.forEach(b => {
      if (b.type === 'rag') {
        if (!ragGroups[b.source]) {
          ragGroups[b.source] = [];
        }
        ragGroups[b.source].push(b);
      } else {
        list.push(b);
      }
    });

    Object.entries(ragGroups).forEach(([source, chunks]) => {
      list.push({
        id: `file_${source}`,
        type: 'rag_file',
        dbType: 'kb_block',
        source: source,
        title: source,
        summary: `Contains ${chunks.length} searchable chunk(s). Click to view and manage chunks.`,
        keywords: Array.from(new Set(chunks.flatMap(c => c.keywords || []))),
        profiles: Array.from(new Set(chunks.flatMap(c => c.profiles || []))),
        tokenCount: chunks.reduce((sum, c) => sum + (c.tokenCount || 0), 0),
        chunks: chunks
      });
    });

    return list;
  }, [blocks]);

  // Combine into a single normalized blocks list
  const combinedBlocks = React.useMemo(() => {
    return [
      ...groupedBlocks,
      ...summaryBlocks
    ];
  }, [groupedBlocks, summaryBlocks]);

  // History-summary blocks live in chat.memoryBlocks (not knowledge_chunks), so count
  // their tokens accurately in the main process rather than guessing in the renderer.
  const summarySignature = summaryBlocks.map(b => `${b.id}:${(b.summary || '').length}`).join('|');
  useEffect(() => {
    const items = summaryBlocks.map(b => ({ id: b.id, text: b.summary || '' }));
    if (items.length === 0 || !electronAPI?.countTokens) {
      setSummaryTokens({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const counts = await electronAPI.countTokens(items.map(i => i.text));
        if (cancelled) return;
        const map = {};
        items.forEach((it, idx) => { map[it.id] = counts[idx] || 0; });
        setSummaryTokens(map);
      } catch (e) { /* leave counts at 0 on failure */ }
    })();
    return () => { cancelled = true; };
  }, [summarySignature]);

  // Token budgeting: always-on (constant) context is the part injected into every prompt
  const tokenTotals = React.useMemo(() => {
    let alwaysOn = 0;
    let searchable = 0;
    combinedBlocks.forEach(b => {
      const t = b.tokenCount || 0;
      const isAlwaysOn = b.type === 'constant'
        || (b.type === 'manual' && (b.strategy === 'constant' || b.rawItem?.strategy === 'constant'));
      if (isAlwaysOn) alwaysOn += t; else searchable += t;
    });
    return { alwaysOn, searchable };
  }, [combinedBlocks]);

  // Filter combined blocks list
  const filteredBlocks = combinedBlocks.filter(b => {
    // 1. Search Query filter
    const query = searchQuery.toLowerCase();
    const titleMatch = (b.title || b.source || '').toLowerCase().includes(query);
    const summaryMatch = (b.summary || b.text || '').toLowerCase().includes(query);
    const chunksMatch = b.type === 'rag_file' && b.chunks.some(c => c.text.toLowerCase().includes(query));
    if (!titleMatch && !summaryMatch && !chunksMatch) return false;

    // 2. Category tab filter
    if (activeFilter === 'all') return true;
    if (activeFilter === 'constants' && b.type === 'constant') return true;
    if (activeFilter === 'rag' && b.type === 'rag_file') return true;
    if (activeFilter === 'snippets' && b.type === 'snippet') return true;
    if (activeFilter === 'summarized' && b.type === 'summarized') return true;
    return false;
  });

  // Toggle profile scoping for a block
  const handleToggleProfileScope = async (block, profileId) => {
    try {
      if (block.type === 'rag' || block.type === 'constant' || block.type === 'rag_file') {
        const updatedKbFiles = kbFiles.map(f => {
          if (f.name === block.source) {
            const list = f.profiles || [];
            const newList = list.includes(profileId) ? list.filter(id => id !== profileId) : [...list, profileId];
            return { ...f, profiles: newList };
          }
          return f;
        });
        await onSaveChat({ ...chat, knowledgeFiles: JSON.stringify(updatedKbFiles) });

        // Update local block state so it reflects immediately
        setBlocks(prev => prev.map(b =>
          b.source === block.source
            ? { ...b, profiles: b.profiles.includes(profileId) ? b.profiles.filter(id => id !== profileId) : [...b.profiles, profileId] }
            : b
        ));
      } else if (block.type === 'snippet') {
        const updatedBlocks = memoryBlocks.map(b => {
          if (b.id === block.id) {
            const list = b.profiles || [];
            const newList = list.includes(profileId) ? list.filter(id => id !== profileId) : [...list, profileId];
            return { ...b, profiles: newList };
          }
          return b;
        });
        await onSaveChat({ ...chat, memoryBlocks: JSON.stringify(updatedBlocks) });

        // Update profiles in vector_db.json
        const targetBlock = blocks.find(b => b.id === block.id);
        if (targetBlock) {
          const newList = targetBlock.profiles.includes(profileId) ? targetBlock.profiles.filter(id => id !== profileId) : [...targetBlock.profiles, profileId];
          await electronAPI.saveChatKbBlock(chat.id, {
            id: targetBlock.id,
            type: 'manual',
            source: targetBlock.source,
            text: targetBlock.text,
            profiles: newList
          });
        }
        loadBlocks();
      }
    } catch (err) {
      console.error("Error setting profile scoping:", err);
    }
  };

  // Toggle ingestion strategy (Constant vs RAG) for files
  const handleToggleIngestion = async (block) => {
    if (block.type !== 'rag' && block.type !== 'constant' && block.type !== 'rag_file') return;
    try {
      const updatedKbFiles = kbFiles.map(f => {
        if (f.name === block.source) {
          const current = f.strategy;
          const isCurrentConstant = !current || current === 'full_context' || current === 'constant';
          const target = isCurrentConstant ? 'rag_search' : 'full_context';
          return { ...f, strategy: target };
        }
        return f;
      });
      await onSaveChat({ ...chat, knowledgeFiles: JSON.stringify(updatedKbFiles) });
      // Short delay to let background indexing trigger, then load blocks
      setTimeout(() => loadBlocks(), 500);
    } catch (err) {
      console.error("Error toggling ingestion strategy:", err);
    }
  };

  const uploadFileBatch = async (files, renameMapping = {}, deleteBeforeUpload = false) => {
    setIsProcessing(true);
    let processed = 0;
    const updatedKbFiles = [...kbFiles];

    for (const file of files) {
      processed++;
      const targetName = renameMapping[file.name] || file.name;
      setProgressMsg(`Reading ${targetName} (${processed}/${files.length})...`);

      if (deleteBeforeUpload) {
        try {
          await electronAPI.deleteChatKbFile(chat.id, file.name);
          setBlocks(prev => prev.filter(b => b.source !== file.name));
          setSelectedBlockIds(prev => prev.filter(id => {
            const block = blocks.find(b => b.id === id);
            return !block || block.source !== file.name;
          }));
          const existingIdx = updatedKbFiles.findIndex(existing => existing.name.toLowerCase() === file.name.toLowerCase());
          if (existingIdx !== -1) {
            updatedKbFiles.splice(existingIdx, 1);
          }
        } catch (err) {
          console.error(`Failed to delete existing file ${file.name} for replacement:`, err);
        }
      }

      try {
        if (electronAPI.uploadChatKbFile) {
          const savedFile = await electronAPI.uploadChatKbFile(chat.id, {
            name: targetName,
            path: file.path || '',
            size: file.size
          });

          if (savedFile) {
            updatedKbFiles.push({
              name: savedFile.name,
              originalPath: savedFile.originalPath,
              internalPath: savedFile.internalPath,
              size: savedFile.size,
              strategy: uploadStrategy,
              profiles: []
            });
          }
        }
      } catch (err) {
        console.error(`Failed to upload file ${file.name}:`, err);
        break; // stop processing the rest of the batch on failure
      }
    }

    await onSaveChat({
      ...chat,
      knowledgeFiles: JSON.stringify(updatedKbFiles)
    });

    setIsProcessing(false);
    setProgressMsg('');
    setTimeout(() => loadBlocks(), 500); // refresh list
  };

  const handleResolveConflicts = async (action) => {
    if (!pendingUpload) return;
    setUploadingAction(action);

    const { fresh, conflicts } = pendingUpload;
    const renameMapping = {};
    let deleteBeforeUpload = false;
    let filesToUpload = [...fresh];

    if (action === 'rename') {
      // Hand off to the manual rename modal instead of auto-renaming.
      setUploadingAction(null);
      setPendingUpload(null);
      setRenamePrompt({ fresh, conflicts, type: pendingUpload.type });
      return;
    } else if (action === 'replace') {
      deleteBeforeUpload = true;
      filesToUpload = [...fresh, ...conflicts];
    } else {
      // action === 'skip'
      // no-op, just upload fresh ones
    }

    try {
      if (filesToUpload.length > 0) {
        await uploadFileBatch(filesToUpload, renameMapping, deleteBeforeUpload);
      }
    } finally {
      setUploadingAction(null);
      setPendingUpload(null);
    }
  };

  const handleConfirmRename = async (renameMapping) => {
    if (!renamePrompt) return;
    const { fresh, conflicts } = renamePrompt;
    setUploadingAction('rename');
    try {
      await uploadFileBatch([...fresh, ...conflicts], renameMapping, false);
    } finally {
      setUploadingAction(null);
      setRenamePrompt(null);
    }
  };

  const handleDirectFileUpload = async (e) => {
    const files = Array.from(e.target.files);
    e.target.value = '';
    if (files.length === 0) return;

    const fresh = [];
    const conflicts = [];
    for (const file of files) {
      const exists = kbFiles.some(existing => existing.name.toLowerCase() === file.name.toLowerCase());
      if (exists) {
        conflicts.push(file);
      } else {
        fresh.push(file);
      }
    }

    if (conflicts.length > 0) {
      setPendingUpload({ fresh, conflicts });
    } else {
      await uploadFileBatch(fresh, {}, false);
    }
  };

  const handleDeleteTarget = async () => {
    if (!deleteTarget) return;
    try {
      const mappedBlock = {
        id: deleteTarget.id,
        type: deleteTarget.type === 'snippet' ? 'manual' : deleteTarget.type,
        source: deleteTarget.source,
        text: deleteTarget.text
      };

      await electronAPI.deleteChatKbBlock(chat.id, mappedBlock);
      // Remove deleted item from selected list if present
      setSelectedBlockIds(prev => prev.filter(id => id !== deleteTarget.id));
      setDeleteTarget(null);
      loadBlocks();
    } catch (err) {
      console.error("Error deleting memory block:", err);
      showToast("Failed to delete memory block.", "error");
    }
  };

  const handleToggleSelectBlock = (blockId) => {
    setSelectedBlockIds(prev =>
      prev.includes(blockId) ? prev.filter(id => id !== blockId) : [...prev, blockId]
    );
  };

  const handleSelectAll = () => {
    const selectable = filteredBlocks
      .filter(b => b.type !== 'summarized')
      .map(b => b.id);
    setSelectedBlockIds(selectable);
  };

  const handleClearSelection = () => {
    setSelectedBlockIds([]);
  };

  const handleDeleteEntireFile = async (fileName) => {
    try {
      setIsProcessing(true);
      setProgressMsg(`Deleting file and chunks: ${fileName}...`);

      // 1. Delete physical file & DB chunks
      await electronAPI.deleteChatKbFile(chat.id, fileName);

      // 2. Remove from JSON metadata registry
      const updatedKbFiles = kbFiles.filter(f => f.name.toLowerCase() !== fileName.toLowerCase());
      await onSaveChat({
        ...chat,
        knowledgeFiles: JSON.stringify(updatedKbFiles)
      });

      // 3. Clean selections of deleted file chunks
      const deletedBlockIds = combinedBlocks.filter(b => b.source === fileName).map(b => b.id);
      setSelectedBlockIds(prev => prev.filter(id => !deletedBlockIds.includes(id)));

      setDeleteTarget(null);
      loadBlocks();
    } catch (err) {
      console.error("Error deleting entire file:", err);
      showToast("Failed to delete file.", "error");
    } finally {
      setIsProcessing(false);
      setProgressMsg("");
    }
  };

  const handleBulkDelete = async () => {
    try {
      setIsProcessing(true);
      setProgressMsg("Deleting selected blocks...");

      const blocksToDelete = combinedBlocks.filter(b => selectedBlockIds.includes(b.id));
      const deletedFileNames = [];

      for (const block of blocksToDelete) {
        if (block.type === 'rag_file') {
          // Files use the dedicated path that removes the physical file + all its chunks,
          // not the single-block delete (which can't resolve a synthetic file_ id).
          await electronAPI.deleteChatKbFile(chat.id, block.source);
          deletedFileNames.push(block.source);
        } else {
          const mappedBlock = {
            id: block.id,
            type: block.type === 'snippet' ? 'manual' : block.type,
            source: block.title,
            text: block.summary
          };
          await electronAPI.deleteChatKbBlock(chat.id, mappedBlock);
        }
      }

      // Drop any deleted files from the JSON metadata registry in one pass
      if (deletedFileNames.length > 0) {
        const lowered = deletedFileNames.map(n => n.toLowerCase());
        const updatedKbFiles = kbFiles.filter(f => !lowered.includes(f.name.toLowerCase()));
        await onSaveChat({
          ...chat,
          knowledgeFiles: JSON.stringify(updatedKbFiles)
        });
      }

      setSelectedBlockIds([]);
      setIsBulkDeleteConfirmOpen(false);
      loadBlocks();
    } catch (err) {
      console.error("Error doing bulk delete:", err);
      showToast("Failed to delete some blocks.", "error");
    } finally {
      setIsProcessing(false);
      setProgressMsg("");
    }
  };

  const handleSaveSnippet = async () => {
    if (!editorText.trim()) {
      setEditorError("Content cannot be empty");
      return;
    }

    setSavingSnippet(true);
    setEditorError('');
    try {
      if (editingBlock) {
        // --- EDITING EXISTING BLOCK ---
        await electronAPI.saveChatKbBlock(chat.id, {
          id: editingBlock.id,
          type: editingBlock.type === 'snippet' ? 'manual' : editingBlock.type,
          source: editorTitle.trim() || editingBlock.source,
          text: editorText.trim(),
          profiles: editingBlock.profiles || [],
          keywords: editorKeywords,
          strategy: editorStrategy
        });
        if (viewingFileBlock) {
          setViewingFileBlock(curr => {
            if (!curr) return null;
            return {
              ...curr,
              chunks: curr.chunks.map(c => c.id === editingBlock.id ? {
                ...c,
                text: editorText.trim(),
                keywords: editorKeywords,
                summary: editorText.trim(),
                strategy: editorStrategy
              } : c)
            };
          });
        }
      } else {
        // --- ADDING NEW CUSTOM SNIPPET ---
        const title = editorTitle.trim() || 'Custom Memory';
        const text = editorText.trim();
        const snippetId = `manual_${Date.now()}`;

        await electronAPI.saveChatKbBlock(chat.id, {
          id: snippetId,
          type: 'manual',
          source: title,
          text: text,
          profiles: [],
          keywords: editorKeywords,
          strategy: editorStrategy
        });
      }
      setEditorOpen(false);
      setEditingBlock(null);
      loadBlocks();
    } catch (err) {
      console.error("Error saving block editor:", err);
      setEditorError("Error saving block: " + (err.message || err));
    } finally {
      setSavingSnippet(false);
    }
  };

  const executeRename = async (block) => {
    if (!renameTitle.trim()) return;
    try {
      if (block.type === 'snippet') {
        const updatedBlocks = memoryBlocks.map(b => {
          if (b.id === block.id) {
            return { ...b, title: renameTitle.trim() };
          }
          return b;
        });
        await onSaveChat({ ...chat, memoryBlocks: JSON.stringify(updatedBlocks) });

        const targetBlock = blocks.find(b => b.id === block.id);
        if (targetBlock) {
          await electronAPI.saveChatKbBlock(chat.id, {
            id: targetBlock.id,
            type: 'manual',
            source: renameTitle.trim(),
            text: targetBlock.text,
            profiles: targetBlock.profiles
          });
        }
        loadBlocks();
      }
      setRenamingId(null);
    } catch (e) {
      console.error(e);
    }
  };

  const handleTestSearch = async () => {
    if (!simQuery.trim()) return;
    setSimLoading(true);
    try {
      if (electronAPI.testChatRagSearch) {
        const results = await electronAPI.testChatRagSearch(chat.id, simQuery.trim(), simProfileId);
        setSimResults(results);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setSimLoading(false);
    }
  };

  const getBadgeStyle = (block) => {
    if (block.type === 'constant') {
      return 'bg-[#FBCB2D]/15 border-[#FBCB2D]/30 text-[#FBCB2D]';
    }
    if (block.type === 'rag_file') {
      return 'bg-[#3b82f6]/10 border-[#3b82f6]/25 text-[#3b82f6]';
    }
    if (block.type === 'snippet') {
      return block.strategy === 'constant'
        ? 'bg-[#FBCB2D]/15 border-[#FBCB2D]/30 text-[#FBCB2D]'
        : 'bg-emerald-500/10 border-emerald-500/25 text-emerald-400';
    }
    return 'bg-cyan-500/10 border-cyan-500/25 text-cyan-400';
  };

  const getBadgeLabel = (block) => {
    if (block.type === 'constant') return 'Constant File';
    if (block.type === 'rag_file') return 'Searchable File';
    if (block.type === 'snippet') {
      return block.strategy === 'constant' ? 'Custom (Constant)' : 'Custom (Searchable)';
    }
    return 'History Summary';
  };

  return (
    <div className="flex-1 flex flex-col md:flex-row h-full overflow-hidden bg-[#000508]/40 select-none">

      {/* Main Memory List Pane */}
      <div className="flex-1 flex flex-col h-full overflow-hidden border-r border-gray-800/40">

        {/* Controls bar */}
        <div className="shrink-0 p-5 border-b border-gray-800/80 bg-[#011419]/35 flex flex-col md:flex-row md:items-center justify-between gap-4">
          {/* Tabs Filter */}
          <div className="flex flex-wrap gap-1.5">
            {['all', 'constants', 'rag', 'snippets', 'summarized'].map(category => (
              <button
                key={category}
                onClick={() => setActiveFilter(category)}
                className={`px-3 py-1.5 text-[10px] font-bold uppercase tracking-wider rounded-lg border transition-all cursor-pointer ${activeFilter === category
                  ? 'bg-accent/20 border-accent/40 text-accent shadow-md shadow-accent/5'
                  : 'bg-transparent border-gray-800 text-gray-400 hover:text-white hover:border-gray-700'
                  }`}
              >
                {category === 'summarized' ? 'History' : category === 'snippets' ? 'Custom Memory' : category}
              </button>
            ))}
          </div>

          {/* Context budget for this chat */}
          <div className="flex flex-col gap-1 text-[10px] text-gray-500">
            <span className="flex items-center gap-1.5" title="Always-on context is injected into every prompt. Amber/red means it is approaching or exceeding this chat's context window.">
              <span className="uppercase tracking-wider w-16">Always-on</span>
              <TokenBadge tokens={tokenTotals.alwaysOn} max={chat?.maxContext || 128000} />
            </span>
            <span className="flex items-center gap-1.5" title="Searchable knowledge is retrieved on demand, not injected into every prompt.">
              <span className="uppercase tracking-wider w-16">Searchable</span>
              <TokenBadge tokens={tokenTotals.searchable} />
            </span>
          </div>

          {/* Search & Unified +Add Dropdown */}
          <div className="flex items-center space-x-3">
            <div className="relative w-full md:w-56">
              <Search className="absolute left-2.5 top-1/2 transform -translate-y-1/2 text-gray-500 w-3.5 h-3.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search memories..."
                className="w-full bg-[#011419] border border-gray-800/80 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-accent transition-colors"
              />
            </div>

            {/* Export KB Button */}
            <button
              onClick={handleExportChatKb}
              className="px-3.5 py-1.5 bg-[#0a161d] hover:bg-[#1a2d32] border border-gray-800 text-gray-300 hover:text-white text-[10px] font-bold uppercase tracking-wider rounded-lg transition-all cursor-pointer flex items-center space-x-1.5"
              title="Export Workspace Knowledge Base"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export KB</span>
            </button>

            {/* Unified +Add Dropdown */}
            <div className="relative">
              <button
                onClick={() => setAddDropdownOpen(!addDropdownOpen)}
                className="px-3.5 py-1.5 bg-accent hover:brightness-110 active:scale-98 text-[#011419] text-[10px] font-bold uppercase tracking-wider rounded-lg shadow-md transition-all cursor-pointer flex items-center space-x-1.5"
              >
                <Plus className="w-3.5 h-3.5 stroke-[2.5]" />
                <span>Add</span>
                <ChevronDown className={`w-3 h-3 transition-transform ${addDropdownOpen ? 'rotate-180' : ''}`} />
              </button>

              {addDropdownOpen && (
                <>
                  <div className="fixed inset-0 z-30" onClick={() => setAddDropdownOpen(false)} />
                  <div className="absolute right-0 mt-1.5 w-48 bg-[#0a161d] border border-gray-800 rounded-xl shadow-xl p-2 z-40 animate-in fade-in duration-200">
                    <button
                      onClick={() => {
                        setAddDropdownOpen(false);
                        setEditingBlock(null);
                        setEditorTitle('');
                        setEditorText('');
                        setEditorKeywords([]);
                        setTagInput('');
                        setEditorError('');
                        setEditorOpen(true);
                      }}
                      className="w-full text-left px-3 py-2 text-[10px] uppercase font-bold text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors flex items-center space-x-2"
                    >
                      <Plus className="w-3.5 h-3.5 text-accent" />
                      <span>Custom Memory</span>
                    </button>
                    <button
                      onClick={() => {
                        setAddDropdownOpen(false);
                        setUploadStrategy('rag_search');
                        fileInputRef.current?.click();
                      }}
                      className="w-full text-left px-3 py-2 text-[10px] uppercase font-bold text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors flex items-center space-x-2"
                    >
                      <Search className="w-3.5 h-3.5 text-accent" />
                      <span>Searchable (RAG)</span>
                    </button>
                    <button
                      onClick={() => {
                        setAddDropdownOpen(false);
                        setUploadStrategy('full_context');
                        fileInputRef.current?.click();
                      }}
                      className="w-full text-left px-3 py-2 text-[10px] uppercase font-bold text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors flex items-center space-x-2"
                    >
                      <FileText className="w-3.5 h-3.5 text-accent" />
                      <span>Constant Memory</span>
                    </button>
                    <div className="my-1 border-t border-gray-800/80" />
                    <button
                      onClick={() => {
                        setAddDropdownOpen(false);
                        handleImportChatKb();
                      }}
                      className="w-full text-left px-3 py-2 text-[10px] uppercase font-bold text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors flex items-center space-x-2"
                    >
                      <Upload className="w-3.5 h-3.5 text-accent" />
                      <span>Import KB Package</span>
                    </button>
                  </div>
                </>
              )}
            </div>

            <input
              type="file"
              ref={fileInputRef}
              multiple
              accept=".pdf,.docx,.txt,.md"
              onChange={handleDirectFileUpload}
              className="hidden"
            />
          </div>
        </div>

        {/* Ingest Progress bar */}
        {isProcessing && (
          <div className="shrink-0 bg-[#051116] border-b border-gray-800/50 px-6 py-2 flex items-center justify-between text-xs animate-in slide-in-from-top duration-200 select-none">
            <div className="flex items-center space-x-2.5 text-accent font-medium">
              <Loader className="w-3.5 h-3.5 animate-spin" />
              <span className="animate-pulse">{progressMsg}</span>
            </div>
            {progressDetail && (
              <div className="flex items-center space-x-3 w-72 shrink-0">
                <span className="text-gray-500 font-mono text-[10px] shrink-0">
                  {progressDetail.current} / {progressDetail.total} chunks
                </span>
                <div className="flex-1 h-1.5 bg-gray-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-accent transition-all duration-300 rounded-full"
                    style={{ width: `${Math.round((progressDetail.current / progressDetail.total) * 100)}%` }}
                  />
                </div>
              </div>
            )}
          </div>
        )}

        {/* Memory Blocks Feed */}
        <div className="flex-1 overflow-y-auto p-6 space-y-3 custom-scrollbar">
          {loading ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <div className="animate-spin h-6 w-6 border-2 border-accent border-t-transparent rounded-full mb-2" />
              <p className="caption font-medium">Loading memory blocks...</p>
            </div>
          ) : filteredBlocks.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-center">
              <Database className="w-12 h-12 text-gray-800 mb-3" />
              <p className="caption font-medium">No memory blocks found matching your query.</p>
            </div>
          ) : (
            filteredBlocks.map((block) => {
              const isRenameActive = renamingId === block.id;

              return (
                <div
                  key={block.id}
                  onClick={() => {
                    if (block.type === 'rag_file') {
                      setViewingFileBlock(block);
                    } else if (block.type === 'summarized') {
                      setSelectedSummaryBlock(block);
                    }
                  }}
                  className={`group relative bg-[#0a161d]/45 border rounded-xl p-4 transition-all flex items-start space-x-3.5 ${
                    block.type === 'rag_file' ? 'cursor-pointer hover:border-blue-500/50' : ''
                  } ${selectedBlockIds.includes(block.id) ? 'border-accent/40 bg-accent/5' : 'border-gray-800/80 hover:border-gray-800'
                    }`}
                >
                  {/* Selection Checkbox */}
                  {block.type !== 'summarized' && (
                    <div className="pt-1.5 shrink-0 select-none" onClick={(e) => e.stopPropagation()}>
                      <div
                        onClick={() => handleToggleSelectBlock(block.id)}
                        className={`w-4 h-4 rounded-sm border flex items-center justify-center cursor-pointer transition-all duration-200 hover:scale-105 active:scale-95 ${selectedBlockIds.includes(block.id)
                          ? 'bg-accent border-accent text-[#011419] shadow-[0_0_8px_rgba(221,186,110,0.4)]'
                          : 'border-gray-800 bg-[#011419]/90 hover:border-accent/50'
                          }`}
                      >
                        {selectedBlockIds.includes(block.id) && <Check className="w-3 h-3 stroke-[3.5]" />}
                      </div>
                    </div>
                  )}

                  {block.type === 'rag_file' && (
                    <div className="pt-1.5 shrink-0 text-blue-400">
                      <FileText className="w-4 h-4" />
                    </div>
                  )}

                  <div className="flex-1 flex flex-col justify-between min-w-0">
                    <div className="flex items-start justify-between pr-32">

                      <div className="flex-1 min-w-0 mr-4">
                        {/* Badge and Title */}
                        <div className="flex items-center space-x-2 mb-2 select-none">
                          <span className={`text-[7px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded border ${getBadgeStyle(block)}`}>
                            {getBadgeLabel(block)}
                          </span>

                          <TokenBadge tokens={block.tokenCount || 0} className="shrink-0" />

                          {isRenameActive ? (
                            <input
                              type="text"
                              value={renameTitle}
                              onChange={(e) => setRenameTitle(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') executeRename(block);
                                else if (e.key === 'Escape') setRenamingId(null);
                              }}
                              onBlur={() => executeRename(block)}
                              autoFocus
                              className="bg-[#011419] border border-gray-800 text-[11px] font-bold text-accent rounded px-2.5 py-0.5 focus:outline-none focus:border-accent"
                            />
                          ) : (
                            <div className="flex items-center space-x-1.5 min-w-0">
                              <h4
                                onClick={() => {
                                  if (block.type === 'snippet') {
                                    setRenamingId(block.id);
                                    setRenameTitle(block.title);
                                  } else if (block.type === 'summarized') {
                                    setSelectedSummaryBlock(block);
                                  }
                                }}
                                className={`text-xs font-bold text-white uppercase tracking-wide truncate cursor-pointer hover:underline ${block.type === 'summarized' ? 'text-accent' : ''
                                  }`}
                                title={block.type === 'snippet' ? "Click to rename title" : "Click to view archived messages"}
                              >
                                {block.title}
                              </h4>
                              {block.type === 'summarized' && (
                                <span
                                  className="text-[8px] text-gray-500 font-sans italic cursor-pointer shrink-0 hover:text-accent transition-colors"
                                  onClick={() => setSelectedSummaryBlock(block)}
                                >
                                  (Click to inspect messages)
                                </span>
                              )}
                            </div>
                          )}
                        </div>

                        {/* Body snippet text */}
                        <p className="text-xs text-gray-400 leading-relaxed font-sans line-clamp-3 select-text whitespace-pre-wrap">
                          {block.summary}
                        </p>

                        {/* Display tag chips */}
                        {block.keywords && block.keywords.length > 0 && (
                          <div className="flex flex-wrap gap-1.5 mt-2.5 mb-0.5 select-none">
                            {block.keywords.map((tag, tagIdx) => (
                              <span
                                key={tagIdx}
                                className="px-1.5 py-0.5 bg-accent/10 border border-accent/20 text-accent text-[9px] font-bold uppercase tracking-wider rounded"
                              >
                                {tag}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Actions overlay panel right side */}
                  <div className="absolute top-4 right-4 flex items-center space-x-2 select-none" onClick={(e) => e.stopPropagation()}>

                    {/* Ingestion Strategy Switch (Files only) */}
                    {(block.type === 'rag' || block.type === 'constant' || block.type === 'rag_file') && (
                      <button
                        onClick={() => handleToggleIngestion(block)}
                        title={`Strategy: ${block.type === 'constant' ? 'Constant (always loaded)' : 'RAG (semantic search)'}`}
                        className={`text-[9px] font-bold tracking-wider px-2 py-1 border rounded-lg transition-colors cursor-pointer ${block.type === 'constant'
                          ? 'bg-[#FBCB2D]/20 text-[#FBCB2D] border-[#FBCB2D]/40 hover:bg-[#FBCB2D]/30'
                          : 'bg-[#3b82f6]/10 text-[#3b82f6] border-[#3b82f6]/30 hover:bg-[#3b82f6]/20'
                          }`}
                      >
                        {block.type === 'constant' ? 'CONSTANT' : 'RAG SEARCH'}
                      </button>
                    )}

                    {/* Writing Profiles Scoping dropdown */}
                    {block.type !== 'summarized' && (
                      <div className="relative">
                        <button
                          onClick={() => setActiveScopingBlockId(activeScopingBlockId === block.id ? null : block.id)}
                          className={`flex items-center space-x-1 px-2.5 py-1 border rounded-lg text-[9px] font-bold uppercase transition-colors cursor-pointer ${block.profiles.length > 0
                            ? 'bg-teal-500/10 border-teal-500/35 text-teal-400 hover:bg-teal-500/25'
                            : 'bg-transparent border-gray-800 text-gray-400 hover:text-white hover:border-gray-700'
                            }`}
                          title="Restrict to specific Writing Profiles"
                        >
                          <span>Scope: {block.profiles.length > 0 ? `${block.profiles.length} Profiles` : 'All Profiles'}</span>
                          <ChevronDown className="w-3 h-3 text-gray-500" />
                        </button>

                        {activeScopingBlockId === block.id && (
                          <>
                            <div className="fixed inset-0 z-30" onClick={() => setActiveScopingBlockId(null)} />
                            <div className="absolute right-0 mt-1.5 w-48 bg-[#0a161d] border border-gray-800 rounded-xl shadow-xl p-2 z-40 animate-in fade-in duration-200">
                              <span className="block text-[8px] font-bold text-gray-500 uppercase tracking-widest px-2 py-1">Scope Settings</span>

                              <div className="max-h-40 overflow-y-auto custom-scrollbar space-y-0.5 mt-1 select-none">
                                {(() => {
                                  const activeProfilesList = chat?.activeProfiles
                                    ? (typeof chat.activeProfiles === 'string' ? JSON.parse(chat.activeProfiles) : chat.activeProfiles)
                                    : [];
                                  const displayProfiles = writingProfiles.filter(p => activeProfilesList.includes(p.id));

                                  if (displayProfiles.length === 0) {
                                    return (
                                      <div className="p-2 caption text-center italic">
                                        No active AI Profiles in this chat workspace.
                                      </div>
                                    );
                                  }

                                  return displayProfiles.map(p => {
                                    const isSelected = block.profiles.includes(p.id);
                                    return (
                                      <label
                                        key={p.id}
                                        className="flex items-center justify-between p-1.5 hover:bg-white/5 rounded cursor-pointer transition-colors"
                                      >
                                        <div className="flex items-center space-x-2 min-w-0 mr-2">
                                          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                                          <span className="text-[10px] text-gray-300 truncate font-sans">{p.name}</span>
                                        </div>
                                        <div className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95 ${isSelected ? 'bg-accent border-accent text-[#011419] shadow-[0_0_8px_rgba(221,186,110,0.4)]' : 'border-gray-700 bg-[#011419]/90 hover:border-accent/50'
                                          }`}>
                                          {isSelected && <Check className="w-2.5 h-2.5 text-[#011419] stroke-[3.5]" />}
                                        </div>
                                        <input
                                          type="checkbox"
                                          checked={isSelected}
                                          onChange={() => handleToggleProfileScope(block, p.id)}
                                          className="hidden"
                                        />
                                      </label>
                                    );
                                  });
                                })()}
                              </div>

                              <div className="h-px bg-gray-800/80 my-1.5" />
                              <span className="text-[8px] text-gray-500 italic px-2 block leading-snug">
                                If no profiles are selected, this block is shared globally.
                              </span>
                            </div>
                          </>
                        )}
                      </div>
                    )}

                    {/* Edit block */}
                    {block.type === 'snippet' && (
                      <button
                        onClick={() => {
                          setEditingBlock(block);
                          setEditorTitle(block.title);
                          setEditorText(block.summary);
                          setEditorKeywords(block.keywords || []);
                          setEditorStrategy(block.strategy || 'rag_search');
                          setTagInput('');
                          setEditorError('');
                          setEditorOpen(true);
                        }}
                        title="Edit memory block text content"
                        className="p-1.5 hover:bg-white/5 text-gray-500 hover:text-white rounded-lg transition-colors cursor-pointer border border-transparent hover:border-gray-800"
                      >
                        <Edit className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {/* Delete block */}
                    {block.type !== 'summarized' && (
                      <button
                        onClick={() => {
                          if (block.type === 'rag_file') {
                            setConfirmDialog({
                              message: `Are you sure you want to delete the entire file "${block.source}" and all its searchable chunks?`,
                              onConfirm: () => handleDeleteEntireFile(block.source)
                            });
                          } else {
                            setDeleteTarget(block);
                          }
                        }}
                        title={block.type === 'rag_file' ? "Delete entire file" : "Delete memory block"}
                        className="p-1.5 hover:bg-red-950/20 text-gray-500 hover:text-red-400 rounded-lg transition-colors cursor-pointer border border-transparent hover:border-red-950"
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

      {/* Right-Side Query Simulator Dashboard */}
      <div className="w-full md:w-80 p-5 bg-[#011419]/25 flex flex-col h-full overflow-y-auto custom-scrollbar select-none">
        <div className="flex items-center space-x-1.5 mb-2.5">
          <Sparkles className="w-4 h-4 text-accent animate-pulse" />
          <span className="text-[10px] font-bold text-gray-400 uppercase tracking-widest font-sans">RAG Query Simulator</span>
        </div>

        <div className="bg-[#051116]/80 border border-gray-800 rounded-xl p-3.5 flex flex-col space-y-3 shrink-0">
          <p className="caption">
            Test how the AI retrieves memories. Type a phrase or prompt below to run a local vector similarity match.
          </p>

          <div className="flex flex-col space-y-2.5">
            {/* AI Profile Selector */}
            <div className="flex flex-col space-y-1">
              <div className="flex items-center justify-between">
                <label className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">AI Profile Scoping</label>
                <span title="Profiles with Agentic RAG active will first refine your query using LLM before searching. This incurs a small token cost.">
                  <HelpCircle className="w-3 h-3 text-gray-500 hover:text-accent cursor-help" />
                </span>
              </div>
              <select
                value={simProfileId}
                onChange={(e) => setSimProfileId(e.target.value)}
                className="w-full bg-[#011419] border border-gray-800 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-accent font-sans"
              >
                <option value="">No Profile (Standard RAG)</option>
                {(() => {
                  const activeProfilesList = chat?.activeProfiles
                    ? (typeof chat.activeProfiles === 'string' ? JSON.parse(chat.activeProfiles) : chat.activeProfiles)
                    : [];
                  const displayProfiles = writingProfiles.filter(p => activeProfilesList.includes(p.id));
                  return displayProfiles.map(p => (
                    <option key={p.id} value={p.id}>
                      {p.name} {p.isAgentic === 1 ? '⚡ (Agentic)' : ''}
                    </option>
                  ));
                })()}
              </select>
            </div>

            {/* Agentic RAG Active Alert */}
            {simProfileId && writingProfiles.find(p => p.id === simProfileId)?.isAgentic === 1 && (
              <div className="bg-[#FBCB2D]/10 border border-[#FBCB2D]/30 rounded-lg p-2 flex items-center space-x-2 text-[9px] text-[#FBCB2D] font-medium select-none">
                <Sparkles className="w-3.5 h-3.5 shrink-0 text-accent" />
                <span>Agentic RAG active. LLM refinement query will consume a few tokens.</span>
              </div>
            )}

            <textarea
              value={simQuery}
              onChange={(e) => setSimQuery(e.target.value)}
              placeholder="e.g. Who is character X?..."
              className="w-full bg-[#011419] border border-gray-800 rounded-lg px-2.5 py-1.5 text-xs text-white placeholder-gray-600 focus:outline-none focus:border-accent resize-none h-16 font-sans"
            />
            <button
              onClick={handleTestSearch}
              disabled={simLoading || !simQuery.trim()}
              className="w-full py-1.5 bg-accent hover:brightness-110 disabled:opacity-40 text-[#011419] text-[9px] font-bold uppercase tracking-widest rounded-lg transition-all cursor-pointer flex items-center justify-center space-x-2"
            >
              {simLoading ? (
                <>
                  <svg className="animate-spin h-3.5 w-3.5 text-[#011419]" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                  </svg>
                  <span>Searching...</span>
                </>
              ) : (
                <span>Test RAG Search</span>
              )}
            </button>
          </div>
        </div>

        {/* Query Results Display */}
        <div className="flex-1 mt-4 flex flex-col min-h-[200px]">
          {!simResults ? (
            <div className="flex-1 border border-dashed border-gray-800/40 rounded-xl flex items-center justify-center text-center p-4 select-none">
              <span className="caption italic">No query simulated yet</span>
            </div>
          ) : (simResults.kbResults.length === 0 && simResults.memoryResults.length === 0 && (!simResults.profileResults || simResults.profileResults.length === 0)) ? (
            <div className="flex-1 border border-dashed border-red-900/10 rounded-xl bg-red-950/5 flex items-center justify-center text-center p-4 select-none">
              <span className="text-[10px] text-red-400 italic font-sans">No matches found above threshold</span>
            </div>
          ) : (
            <div className="space-y-4 max-h-[50vh] overflow-y-auto custom-scrollbar select-text animate-in fade-in duration-200">
              {/* Refined Query banner if agentic applied */}
              {simResults.isAgenticApplied && (
                <div className="p-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg select-none">
                  <span className="block text-[8px] font-bold text-emerald-400 uppercase tracking-widest">Refined Query (Agentic RAG)</span>
                  <p className="text-[10px] text-gray-200 mt-0.5 italic">"{simResults.searchQuery}"</p>
                </div>
              )}

              {/* Chat Memories & Files Section */}
              <div className="space-y-2">
                <span className="block text-[8px] font-bold text-gray-500 uppercase tracking-widest px-1">Chat Memories & Files</span>
                {(simResults.kbResults.length === 0 && simResults.memoryResults.length === 0) ? (
                  <p className="caption italic px-1">No matching chat files or snippets found.</p>
                ) : (
                  <div className="space-y-2">
                    {simResults.kbResults.map((res, i) => (
                      <div key={`kb_${i}`} className="p-3 bg-[#0a161d]/20 border border-gray-800/60 rounded-xl flex flex-col space-y-1">
                        <div className="flex items-center justify-between text-[8px] font-bold">
                          <span className="text-accent truncate max-w-[120px] font-sans">FILE: {res.source}</span>
                          <span className="font-mono text-gray-400">Score: {res.score.toFixed(3)}</span>
                        </div>
                        <p className="text-[10px] text-gray-300 leading-normal font-sans line-clamp-4">
                          {res.text}
                        </p>
                      </div>
                    ))}

                    {simResults.memoryResults.map((res, i) => (
                      <div key={`mem_${i}`} className="p-3 bg-[#0a161d]/20 border border-gray-800/60 rounded-xl flex flex-col space-y-1">
                        <div className="flex items-center justify-between text-[8px] font-bold">
                          <span className="text-cyan-400 truncate max-w-[120px] font-sans">MEM: {res.source}</span>
                          <span className="font-mono text-gray-400">Score: {res.score.toFixed(3)}</span>
                        </div>
                        <p className="text-[10px] text-gray-300 leading-normal font-sans line-clamp-4">
                          {res.text}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* AI Profile Memories Section */}
              {simProfileId && (
                <div className="space-y-2 pt-2 border-t border-gray-800/40">
                  <span className="block text-[8px] font-bold text-gray-500 uppercase tracking-widest px-1">
                    AI Profile Memories ({writingProfiles.find(p => p.id === simProfileId)?.name})
                  </span>
                  {!simResults.profileResults || simResults.profileResults.length === 0 ? (
                    <p className="caption italic px-1">No matching profile memories found.</p>
                  ) : (
                    <div className="space-y-2">
                      {simResults.profileResults.map((res, i) => (
                        <div key={`prof_${i}`} className="p-3 bg-[#0a161d]/20 border border-[#3b82f6]/20 rounded-xl flex flex-col space-y-1 animate-in slide-in-from-bottom-2 duration-200">
                          <div className="flex items-center justify-between text-[8px] font-bold">
                            <span className="text-blue-400 truncate max-w-[120px] font-sans">PROFILE: {res.source}</span>
                            <span className="font-mono text-gray-400">Score: {res.score.toFixed(3)}</span>
                          </div>
                          <p className="text-[10px] text-gray-300 leading-normal font-sans line-clamp-4">
                            {res.text}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Manual Snippet editor drawer overlay */}
      {editorOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-[#051116] border border-gray-800 rounded-2xl w-full max-w-lg shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="p-4 border-b border-gray-800 bg-[#011419]/50 flex items-center justify-between">
              <div className="flex items-center space-x-1.5">
                <Plus className="w-4 h-4 text-accent" />
                <span className="text-xs font-bold text-white uppercase tracking-wider">
                  {editingBlock
                    ? (editingBlock.type === 'snippet' ? "Edit Custom Memory" : "Edit Memory Block")
                    : "Create Custom Memory"}
                </span>
              </div>
              <button
                onClick={() => setEditorOpen(false)}
                className="p-1 text-gray-500 hover:text-white rounded transition-colors cursor-pointer"
              >
                <XIcon className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-5 flex flex-col space-y-4">
              <TextInput
                label="Title / Source"
                value={editorTitle}
                onChange={(e) => setEditorTitle(e.target.value)}
                placeholder="e.g. Character's Backstory..."
                disabled={savingSnippet || (editingBlock && editingBlock.type !== 'snippet')}
              />
              {editingBlock && editingBlock.type !== 'snippet' && (
                <span className="caption mt-1 flex items-center space-x-1">
                  <Info className="w-3.5 h-3.5 text-gray-500" />
                  <span>Original file sources are read-only.</span>
                </span>
              )}

              <Textarea
                label="Memory Content"
                value={editorText}
                onChange={(e) => setEditorText(e.target.value)}
                placeholder="Enter custom context for the AI here..."
                disabled={savingSnippet}
                monospace
                className="h-40"
              />

              {(!editingBlock || editingBlock.type === 'snippet') && (
                <div className="flex flex-col space-y-1.5">
                  <label className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Storage Strategy</label>
                  <div className="flex space-x-2">
                    <button
                      type="button"
                      onClick={() => setEditorStrategy('rag_search')}
                      className={`flex-1 py-1.5 rounded-lg border text-[10px] font-bold uppercase transition-all flex flex-col items-center justify-center space-y-0.5 cursor-pointer ${
                        editorStrategy === 'rag_search'
                          ? 'bg-[#3b82f6]/20 border-[#3b82f6] text-[#3b82f6] shadow-[0_0_12px_rgba(59,130,246,0.2)]'
                          : 'bg-[#011419] border-gray-800 text-gray-500 hover:text-gray-300 hover:border-gray-700'
                      }`}
                    >
                      <span>Searchable (RAG)</span>
                      <span className="text-[8px] font-normal opacity-70 lowercase">Indexed for vector searches</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditorStrategy('constant')}
                      className={`flex-1 py-1.5 rounded-lg border text-[10px] font-bold uppercase transition-all flex flex-col items-center justify-center space-y-0.5 cursor-pointer ${
                        editorStrategy === 'constant'
                          ? 'bg-[#FBCB2D]/20 border-[#FBCB2D] text-[#FBCB2D] shadow-[0_0_12px_rgba(251,203,45,0.2)]'
                          : 'bg-[#011419] border-gray-800 text-gray-500 hover:text-gray-300 hover:border-gray-700'
                      }`}
                    >
                      <span>Constant (Injected)</span>
                      <span className="text-[8px] font-normal opacity-70 lowercase">Always in AI prompt context</span>
                    </button>
                  </div>
                </div>
              )}

              {(!editingBlock || editingBlock.type === 'snippet') && (
                <div className="flex flex-col space-y-1.5">
                  <label className="text-[9px] font-bold text-gray-400 uppercase tracking-widest">Tags (Categorization)</label>

                  {/* Current Tags Chips */}
                  {editorKeywords.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 mb-1 p-2 bg-[#011419] border border-gray-800/80 rounded-xl">
                      {editorKeywords.map((tag, idx) => (
                        <Badge
                          key={idx}
                          tone="accent"
                          className="flex items-center space-x-1.5"
                        >
                          <span>{tag}</span>
                          <button
                            type="button"
                            onClick={() => setEditorKeywords(prev => prev.filter((_, i) => i !== idx))}
                            className="text-accent hover:text-white transition-colors cursor-pointer"
                          >
                            <XIcon className="w-3 h-3" />
                          </button>
                        </Badge>
                      ))}
                    </div>
                  )}

                  {/* Add Tag Row */}
                  <div className="flex space-x-2">
                    <div className="relative flex-1">
                      <TextInput
                        type="text"
                        value={tagInput}
                        onChange={(e) => {
                          setTagInput(e.target.value);
                          setTagSuggestionsOpen(true);
                        }}
                        onFocus={() => setTagSuggestionsOpen(true)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            handleAddTag();
                          }
                        }}
                        placeholder="Type a tag..."
                        disabled={savingSnippet}
                      />

                      {/* Suggestions Dropdown */}
                      {tagSuggestionsOpen && (
                        (() => {
                          const allTags = Array.from(new Set(
                            combinedBlocks.filter(b => b.type === 'snippet').flatMap(b => b.keywords || [])
                          )).filter(t => t && !editorKeywords.includes(t));

                          const filteredSuggestions = allTags.filter(t =>
                            t.toLowerCase().includes(tagInput.toLowerCase())
                          );

                          if (filteredSuggestions.length === 0) return null;

                          return (
                            <>
                              <div className="fixed inset-0 z-10" onClick={() => setTagSuggestionsOpen(false)} />
                              <div className="absolute left-0 right-0 mt-1.5 bg-[#0a161d] border border-gray-800 rounded-xl shadow-xl max-h-32 overflow-y-auto custom-scrollbar p-1 z-20 animate-in fade-in duration-150">
                                {filteredSuggestions.map((tag) => (
                                  <button
                                    key={tag}
                                    type="button"
                                    onClick={() => {
                                      setEditorKeywords(prev => [...prev, tag]);
                                      setTagInput('');
                                      setTagSuggestionsOpen(false);
                                    }}
                                    className="w-full text-left px-3 py-1.5 text-[10px] uppercase font-bold text-gray-300 hover:text-white hover:bg-white/5 rounded-lg transition-colors"
                                  >
                                    {tag}
                                  </button>
                                ))}
                              </div>
                            </>
                          );
                        })()
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={handleAddTag}
                      disabled={savingSnippet || !tagInput.trim()}
                      className="px-3.5 py-2 bg-accent hover:brightness-110 disabled:opacity-40 text-[#011419] text-xs font-bold rounded-xl transition-all cursor-pointer flex items-center justify-center"
                    >
                      <Plus className="w-4 h-4 stroke-[2.5]" />
                    </button>
                  </div>
                </div>
              )}

              {editorError && <p className="text-[10px] text-red-400 font-semibold">{editorError}</p>}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-gray-800 flex items-center justify-end space-x-3 bg-[#011419]/30">
              <button
                disabled={savingSnippet}
                onClick={() => setEditorOpen(false)}
                className="px-4 py-2 text-[10px] uppercase font-bold text-gray-400 hover:text-white transition-colors cursor-pointer disabled:opacity-30"
              >
                Cancel
              </button>
              <button
                disabled={savingSnippet}
                onClick={handleSaveSnippet}
                className="px-5 py-2 bg-accent text-[#011419] text-[10px] font-bold uppercase tracking-widest rounded-lg shadow-lg shadow-accent/5 hover:brightness-110 active:scale-98 transition-all cursor-pointer flex items-center space-x-2"
              >
                {savingSnippet ? (
                  <>
                    <svg className="animate-spin h-3.5 w-3.5 text-[#011419]" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                    <span>Saving...</span>
                  </>
                ) : (
                  <span>Save Memory</span>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Overlay Modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-[#051116] border border-gray-805 rounded-2xl p-6 max-w-sm w-full shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col space-y-4">
            <div className="flex items-center space-x-3 text-red-500">
              <div className="p-2 bg-red-500/10 rounded-lg">
                <Trash2 className="w-5 h-5" />
              </div>
              <h4 className="text-xs font-bold text-white uppercase tracking-wider">Confirm Deletion</h4>
            </div>

            <p className="caption">
              You are about to delete <strong className="text-gray-200">{deleteTarget.title}</strong>.
              {deleteTarget.type === 'rag' || deleteTarget.type === 'constant' ? (
                <span>
                  This block belongs to file <strong className="text-white">{deleteTarget.source}</strong>.
                  You can delete only this specific chunk, or remove the entire file and all its indexed chunks.
                </span>
              ) : (
                <span>This action is permanent and will clear the text block and its associated RAG search vectors.</span>
              )}
            </p>

            <div className="flex flex-col space-y-2 mt-4 select-none">
              {(deleteTarget.type === 'rag' || deleteTarget.type === 'constant') && (
                <button
                  onClick={() => handleDeleteEntireFile(deleteTarget.source)}
                  className="w-full py-2 bg-red-950/45 hover:bg-red-900 border border-red-900/40 hover:border-red-900/80 text-red-200 text-[10px] uppercase font-bold rounded-lg transition-colors cursor-pointer"
                >
                  Delete Entire File ({deleteTarget.source})
                </button>
              )}
              <button
                onClick={handleDeleteTarget}
                className="w-full py-2 bg-red-650 hover:bg-red-600 text-white text-[10px] uppercase font-bold rounded-lg transition-colors cursor-pointer"
              >
                {deleteTarget.type === 'rag' || deleteTarget.type === 'constant' ? 'Delete Only This Block' : 'Confirm Delete'}
              </button>
              <button
                onClick={() => setDeleteTarget(null)}
                className="w-full py-2 bg-[#0a161d] hover:bg-[#1a2d32] border border-gray-800 text-gray-400 hover:text-white text-[10px] uppercase font-bold rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bulk Delete Confirmation Modal */}
      {isBulkDeleteConfirmOpen && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-[#051116] border border-gray-805 rounded-2xl p-6 max-w-sm w-full shadow-2xl animate-in zoom-in-95 duration-200 flex flex-col space-y-4">
            <div className="flex items-center space-x-3 text-red-500">
              <div className="p-2 bg-red-500/10 rounded-lg">
                <Trash2 className="w-5 h-5" />
              </div>
              <h4 className="text-xs font-bold text-white uppercase tracking-wider">Confirm Bulk Deletion</h4>
            </div>

            <p className="caption">
              Are you sure you want to delete <strong className="text-white">{selectedBlockIds.length}</strong> selected memory blocks?
              This action is permanent and cannot be undone.
            </p>

            <div className="flex justify-end space-x-3 mt-4 select-none">
              <button
                onClick={() => setIsBulkDeleteConfirmOpen(false)}
                className="px-4 py-2 bg-[#0a161d] hover:bg-[#1a2d32] border border-gray-800 text-gray-400 hover:text-white text-[10px] uppercase font-bold rounded-lg transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                onClick={handleBulkDelete}
                className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white text-[10px] uppercase font-bold rounded-lg transition-colors cursor-pointer shadow-lg shadow-red-950/20"
              >
                Delete All
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Archived History Messages Log Viewer Modal */}
      {selectedSummaryBlock && (
        <div className="fixed inset-0 z-50 bg-black/75 backdrop-blur-sm flex items-center justify-center p-4 animate-in fade-in duration-200">
          <div className="bg-[#051116] border border-gray-800 rounded-2xl w-full max-w-2xl h-[75vh] shadow-2xl overflow-hidden flex flex-col animate-in zoom-in-95 duration-200">
            {/* Header */}
            <div className="p-4 border-b border-gray-800 bg-[#011419]/50 flex items-center justify-between">
              <div className="flex items-center space-x-2">
                <Brain className="w-4 h-4 text-accent animate-pulse" />
                <span className="text-xs font-bold text-white uppercase tracking-wider">
                  Archived Messages Log: {selectedSummaryBlock.title}
                </span>
              </div>
              <button
                onClick={() => setSelectedSummaryBlock(null)}
                className="p-1 text-gray-500 hover:text-white rounded transition-colors cursor-pointer"
              >
                <XIcon className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar bg-[#000508]/40">
              <div className="p-3 bg-[#0a161d]/45 border border-gray-800/80 rounded-xl mb-4">
                <span className="block text-[8px] font-bold text-gray-500 uppercase tracking-widest mb-1">Block Summary</span>
                <p className="text-xs text-gray-300 font-sans leading-relaxed select-text">
                  {selectedSummaryBlock.summary}
                </p>
              </div>

              <span className="block text-[8px] font-bold text-gray-500 uppercase tracking-widest px-1">Saved Conversation History</span>

              {(!selectedSummaryBlock.raw?.messages || selectedSummaryBlock.raw.messages.length === 0) ? (
                <div className="flex flex-col items-center justify-center py-12 text-gray-500 text-xs font-sans select-none space-y-2">
                  <Info className="w-5 h-5 text-gray-600" />
                  <p className="italic">No detailed message transcript available for this block.</p>
                  <p className="caption text-center max-w-sm">
                    This memory was archived before the transcript-saving feature was active.
                    The AI-generated summary above and the vectorized search data are still fully functional.
                  </p>
                </div>
              ) : (
                <div className="space-y-4 select-text">
                  {selectedSummaryBlock.raw.messages.map((msg, mIdx) => {
                    const isUser = msg.role === 'user';
                    return (
                      <div
                        key={msg.id || mIdx}
                        className={`flex flex-col space-y-1 p-3.5 rounded-xl border ${isUser
                          ? 'bg-[#0a161d]/30 border-gray-800/50 align-self-end ml-12'
                          : 'bg-[#011419]/35 border-accent/10 mr-12'
                          }`}
                      >
                        <div className="flex items-center justify-between text-[8px] font-bold uppercase tracking-wider select-none">
                          <span className={isUser ? 'text-gray-400' : 'text-accent'}>
                            {isUser ? 'User' : (msg.aiName || 'AI Assistant')}
                          </span>
                          {msg.createdAt && (
                            <span className="text-gray-600 font-mono">
                              {new Date(msg.createdAt).toLocaleString()}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-200 font-sans leading-relaxed whitespace-pre-wrap">
                          {msg.content}
                        </p>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="p-4 border-t border-gray-800 flex items-center justify-end bg-[#011419]/30">
              <button
                onClick={() => setSelectedSummaryBlock(null)}
                className="px-5 py-2 bg-accent text-[#011419] text-[10px] font-bold uppercase tracking-widest rounded-lg shadow-lg hover:brightness-110 active:scale-98 transition-all cursor-pointer"
              >
                Close Logs
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Floating Selection Action Bar */}
      {selectedBlockIds.length > 0 && (
        <div className="absolute bottom-6 left-1/2 transform -translate-x-1/2 px-5 py-3 bg-[#051116]/90 border border-accent/25 backdrop-blur-md rounded-2xl shadow-2xl flex items-center space-x-4 z-30 animate-in slide-in-from-bottom duration-300 select-none">
          <span className="text-[10px] font-bold text-gray-300 uppercase tracking-wider">
            {selectedBlockIds.length} Selected
          </span>
          <div className="h-4 w-px bg-gray-800" />
          <button
            onClick={handleSelectAll}
            className="text-[10px] font-bold text-gray-400 hover:text-white uppercase tracking-wider cursor-pointer"
          >
            Select All
          </button>
          <button
            onClick={handleClearSelection}
            className="text-[10px] font-bold text-gray-400 hover:text-white uppercase tracking-wider cursor-pointer"
          >
            Clear
          </button>
          <button
            onClick={() => setIsBulkDeleteConfirmOpen(true)}
            className="px-3 py-1.5 bg-red-650 hover:bg-red-500 text-white text-[10px] font-bold uppercase tracking-wider rounded-lg transition-colors cursor-pointer flex items-center space-x-1.5 shadow-md shadow-red-950/20"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span>Delete</span>
          </button>
        </div>
      )}

      {/* Slide-out File Chunks Viewer Panel / Drawer overlay */}
      {viewingFileBlock && (
        <div className="fixed inset-y-0 right-0 w-[500px] bg-[#011419] border-l border-gray-800 shadow-2xl flex flex-col p-6 z-40 animate-in slide-in-from-right duration-200">
          <div className="flex justify-between items-center mb-4 shrink-0 pb-2 border-b border-gray-800">
            <div>
              <h3 className="text-xs font-bold text-accent uppercase tracking-widest flex items-center space-x-1.5">
                <FileText className="w-4 h-4 text-blue-400" />
                <span>File Chunks Viewer</span>
              </h3>
              <span className="text-[10px] font-mono text-gray-500 truncate block mt-0.5 max-w-[380px]" title={viewingFileBlock.source}>
                {viewingFileBlock.source}
              </span>
            </div>
            <button
              onClick={() => setViewingFileBlock(null)}
              className="text-gray-400 hover:text-red-500 transition-colors cursor-pointer"
            >
              <XIcon className="w-4 h-4" />
            </button>
          </div>

          {/* Chunks List */}
          <div className="flex-1 overflow-y-auto custom-scrollbar space-y-4 pr-1">
            {viewingFileBlock.chunks.map((chunk, idx) => (
              <div key={chunk.id} className="bg-[#00080B] border border-gray-800/80 rounded-lg p-3 flex flex-col relative group/chunk">
                <div className="flex justify-between items-center mb-2">
                  <span className="text-[9px] font-mono text-gray-500">
                    Chunk #{idx + 1} ({chunk.text.length} chars)
                  </span>
                  <div className="flex space-x-1 opacity-0 group-hover/chunk:opacity-100 transition-opacity">
                    <button
                      onClick={() => {
                        setEditingBlock(chunk);
                        setEditorTitle(chunk.source);
                        setEditorText(chunk.text);
                        setEditorKeywords(chunk.keywords || []);
                        setEditorStrategy(chunk.strategy || 'rag_search');
                        setTagInput('');
                        setEditorError('');
                        setEditorOpen(true);
                      }}
                      className="p-1 text-gray-500 hover:text-white hover:bg-white/5 rounded cursor-pointer"
                      title="Edit Chunk"
                    >
                      <Edit className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => {
                        setConfirmDialog({
                          message: "Are you sure you want to delete this specific chunk?",
                          onConfirm: async () => {
                            if (viewingFileBlock.chunks.length === 1) {
                              await handleDeleteEntireFile(viewingFileBlock.source);
                              setViewingFileBlock(null);
                            } else {
                              try {
                                const mappedBlock = {
                                  id: chunk.id,
                                  type: chunk.type === 'snippet' ? 'manual' : chunk.type,
                                  source: chunk.source,
                                  text: chunk.text
                                };
                                await electronAPI.deleteChatKbBlock(chat.id, mappedBlock);
                                await loadBlocks();
                              } catch (err) {
                                console.error("Error deleting chunk:", err);
                                showToast("Failed to delete chunk.", "error");
                              }
                            }
                          }
                        });
                      }}
                      className="p-1 text-gray-500 hover:text-red-500 hover:bg-red-500/10 rounded cursor-pointer"
                      title="Delete Chunk"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
                <p className="text-[10.5px] text-gray-300 font-mono whitespace-pre-wrap leading-relaxed max-h-[150px] overflow-y-auto custom-scrollbar select-text bg-[#011419]/30 p-2 rounded border border-gray-900/60">
                  {chunk.text}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {kbOpType && (
        <ImportProgressModal
          progress={kbProgress}
          statusText={kbProgressStatus}
          title={kbOpType === 'export' ? "Exporting Workspace KB" : "Importing Workspace KB"}
        />
      )}

      {confirmDialog && (
        <ConfirmDialog
          tone="danger"
          message={confirmDialog.message}
          actions={[
            {
              label: 'Cancel',
              variant: 'ghost',
              onClick: () => setConfirmDialog(null)
            },
            {
              label: confirmDialog.confirmLabel || 'Delete',
              variant: 'danger',
              autoFocus: true,
              onClick: async () => {
                const fn = confirmDialog.onConfirm;
                setConfirmDialog(null);
                if (fn) await fn();
              }
            }
          ]}
          onClose={() => setConfirmDialog(null)}
        />
      )}

      {pendingUpload && (
        <ConfirmDialog
          tone="warning"
          title="Duplicate File Detected"
          message={`The following file(s) already exist in this workspace memory:\n\n${pendingUpload.conflicts.map(f => `• ${f.name}`).join('\n')}\n\nChoose how you want to resolve these conflicts. Cancel will skip duplicate files.`}
          actions={[
            {
              label: 'Cancel',
              variant: 'ghost',
              loading: uploadingAction === 'skip',
              onClick: () => handleResolveConflicts('skip'),
            },
            {
              label: 'Rename',
              variant: 'primary',
              loading: uploadingAction === 'rename',
              onClick: () => handleResolveConflicts('rename'),
            },
            {
              label: 'Replace',
              variant: 'danger',
              loading: uploadingAction === 'replace',
              onClick: () => handleResolveConflicts('replace'),
            },
          ]}
          onClose={() => handleResolveConflicts('skip')}
        />
      )}

      {renamePrompt && (
        <RenameFilesModal
          files={renamePrompt.conflicts}
          existingNames={kbFiles.map(f => f.name)}
          loading={uploadingAction === 'rename'}
          onCancel={() => setRenamePrompt(null)}
          onConfirm={handleConfirmRename}
        />
      )}

    </div>
  );
}
