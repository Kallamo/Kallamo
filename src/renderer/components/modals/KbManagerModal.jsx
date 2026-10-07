import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { X, Search, Database, FileText, Trash2, Save, Plus, Download, FileSearch, Loader2, Pencil, Upload } from 'lucide-react';
import ImportProgressModal from './ImportProgressModal';
import ConfirmDialog from '../ui/ConfirmDialog';
import TextInput from '../ui/TextInput';
import Textarea from '../ui/Textarea';
import EmptyState from '../ui/EmptyState';
import Checkbox from '../ui/Checkbox';
import Toggle from '../ui/Toggle';
import RenameFilesModal from '../ui/RenameFilesModal';
import Popover from '../ui/Popover';
import Button from '../ui/Button';
import IconButton from '../ui/IconButton';
import { Menu, MenuItem, MenuSeparator } from '../ui/Menu';
import { ProfileAvatar } from './ProfileModal';

export default function KbManagerModal({ profile, onClose, onOpenSmartSearch }) {
  const { electronAPI, settings, showToast, openSettings } = useApp();
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('all'); // 'all', 'manual', 'constant', 'rag'
  const [confirmDialog, setConfirmDialog] = useState(null); // { message, onConfirm }
  const [vectorizeError, setVectorizeError] = useState(null);
  const [pendingUpload, setPendingUpload] = useState(null);
  const [uploadingAction, setUploadingAction] = useState(null);
  const [renamePrompt, setRenamePrompt] = useState(null); // { fresh, conflicts, type }

  const openSettingsToEmbedding = () => openSettings('engine', 'embedding');

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

  const [isProcessing, setIsProcessing] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [progressDetail, setProgressDetail] = useState(null); // { fileName, current, total }

  const [editorOpen, setEditorOpen] = useState(false);
  const [editingBlock, setEditingBlock] = useState(null); // null means adding new manual snippet
  const [editorTitle, setEditorTitle] = useState('');
  const [editorText, setEditorText] = useState('');
  const [editorError, setEditorError] = useState('');
  const [savingEditor, setSavingEditor] = useState(false);

  const [editorKeywords, setEditorKeywords] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [tagSuggestionsOpen, setTagSuggestionsOpen] = useState(false);
  const editorTagAnchorRef = useRef(null);
  const [editorStrategy, setEditorStrategy] = useState('rag_search');
  const [viewingFileBlock, setViewingFileBlock] = useState(null);
  const [expandedBlockId, setExpandedBlockId] = useState(null);
  const [tokenMap, setTokenMap] = useState({}); // blockId -> count, fallback for blocks lacking a stored tokenCount

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

  const [selectedBlockIds, setSelectedBlockIds] = useState([]);
  const [isBulkDeleteConfirmOpen, setIsBulkDeleteConfirmOpen] = useState(false);

  const [deleteTargetBlock, setDeleteTargetBlock] = useState(null);

  const searchableInputRef = useRef(null);
  const constantInputRef = useRef(null);
  const editorTextareaRef = useRef(null);
  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const addMenuAnchorRef = useRef(null);
  const [exportingKb, setExportingKb] = useState(false);
  const [importingKb, setImportingKb] = useState(false);
  const [kbProgress, setKbProgress] = useState(0);
  const [kbProgressStatus, setKbProgressStatus] = useState('');
  const [kbOpType, setKbOpType] = useState(null); // 'export' | 'import' | null

  const handleExportKb = async () => {
    if (!profile) return;
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
      const result = await electronAPI.exportKnowledgeBase(profile.id, profile.name);
      if (result && result.success) {
        await new Promise(resolve => setTimeout(resolve, 600));
        showToast("Knowledge Base exported successfully!", "success");
      }
    } catch (e) {
      console.error("Failed to export Knowledge Base:", e);
      showToast("Failed to export Knowledge Base.", "error");
    } finally {
      if (unsub) unsub();
      setKbOpType(null);
    }
  };

  const handleImportKb = async () => {
    if (!profile) return;
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
      const result = await electronAPI.importKnowledgeBase(profile.id);
      if (result && result.success) {
        await new Promise(resolve => setTimeout(resolve, 600));
        showToast("Knowledge Base imported successfully!", "success");
        loadBlocks();
      }
    } catch (e) {
      console.error("Failed to import Knowledge Base:", e);
      showToast("Failed to import Knowledge Base.", "error");
    } finally {
      if (unsub) unsub();
      setKbOpType(null);
    }
  };

  const loadBlocks = async () => {
    if (!profile?.id) return;
    try {
      setLoading(true);
      const data = await electronAPI.getProfileKbBlocks(profile.id);
      const mappedData = data.map(b => ({
        ...b,
        keywords: b.rawItem?.keywords || b.keywords || [],
        strategy: b.strategy || b.rawItem?.strategy || 'rag_search'
      }));
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
      console.error("Error loading profile KB blocks:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    setSelectedBlockIds([]);
    loadBlocks();
  }, [profile?.id]);

  useEffect(() => {
    setSelectedBlockIds([]);
  }, [activeFilter]);

  // Listen to IPC vectorization progress
  useEffect(() => {
    if (!electronAPI?.onVectorizationProgress || !profile?.id) return;

    const unsub = electronAPI.onVectorizationProgress((data) => {
      if (data.type === 'profile' && data.id === profile.id) {
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
  }, [profile?.id, electronAPI]);

  // --- Upload batch function ---
  const uploadFileBatch = async (files, renameMapping = {}, deleteBeforeUpload = false, type = 'searchable') => {
    setIsProcessing(true);
    let processed = 0;
    let addedCount = 0;

    for (const file of files) {
      processed++;
      const targetName = renameMapping[file.name] || file.name;
      setProgressMsg(`Reading ${targetName} (${processed}/${files.length})...`);

      if (deleteBeforeUpload) {
        try {
          await electronAPI.deleteKbFile(profile.id, file.name);
          setBlocks(prev => prev.filter(b => b.source !== file.name));
          setSelectedBlockIds(prev => prev.filter(id => {
            const block = blocks.find(b => b.id === id);
            return !block || block.source !== file.name;
          }));
        } catch (err) {
          console.error(`Failed to delete existing file ${file.name} for replacement:`, err);
        }
      }

      try {
        if (type === 'searchable') {
          const result = await electronAPI.addProfileSearchableFile(profile.id, {
            name: targetName,
            path: file.path || '',
            size: file.size
          });
          if (result && result.blocks) {
            setBlocks(prev => [...prev, ...result.blocks]);
            addedCount++;
          }
        } else {
          const newBlock = await electronAPI.addProfileConstantFile(profile.id, {
            name: targetName,
            path: file.path || '',
            size: file.size
          });
          if (newBlock) {
            setBlocks(prev => [...prev, newBlock]);
            addedCount++;
          }
        }
      } catch (err) {
        console.error(`Failed to add file ${file.name}:`, err);
        const isConfig = typeof err?.message === 'string' && err.message.includes('EMBEDDING_CONFIG_MISSING');
        setVectorizeError({
          kind: isConfig ? 'config' : 'generic',
          message: isConfig
            ? "Vectorization needs an embedding engine. You selected an external API but it isn't configured yet."
            : `Could not vectorize "${targetName}". This is usually caused by the embedding provider, the network, or the file itself, not Kallamo.\n\nDetails: ${err?.message || 'Unknown error'}`
        });
        break; // stop processing the rest of the batch on a hard failure
      }
    }

    setIsProcessing(false);
    setProgressMsg('');
    await loadBlocks(); // refresh fully

    if (addedCount > 0) {
      showToast(`Added ${addedCount} file(s)`, 'success');
    }
  };

  const handleResolveConflicts = async (action) => {
    if (!pendingUpload) return;
    setUploadingAction(action);

    const { fresh, conflicts, type } = pendingUpload;
    const renameMapping = {};
    let deleteBeforeUpload = false;
    let filesToUpload = [...fresh];

    if (action === 'rename') {
      // Hand off to the manual rename modal instead of auto-renaming.
      setUploadingAction(null);
      setPendingUpload(null);
      setRenamePrompt({ fresh, conflicts, type });
      return;
    } else if (action === 'replace') {
      deleteBeforeUpload = true;
      filesToUpload = [...fresh, ...conflicts];
    } else {
      // action === 'skip'
      const skippedCount = conflicts.length;
      if (skippedCount > 0) {
        showToast(`Skipped ${skippedCount} file(s) that already exist`, 'info');
      }
    }

    try {
      if (filesToUpload.length > 0) {
        await uploadFileBatch(filesToUpload, renameMapping, deleteBeforeUpload, type);
      }
    } finally {
      setUploadingAction(null);
      setPendingUpload(null);
    }
  };

  const handleConfirmRename = async (renameMapping) => {
    if (!renamePrompt) return;
    const { fresh, conflicts, type } = renamePrompt;
    setUploadingAction('rename');
    try {
      await uploadFileBatch([...fresh, ...conflicts], renameMapping, false, type);
    } finally {
      setUploadingAction(null);
      setRenamePrompt(null);
    }
  };

  // --- Add Searchable File(s) (RAG) ---
  const handleAddSearchableFile = async (e) => {
    const files = Array.from(e.target.files);
    e.target.value = '';
    if (files.length === 0) return;

    const fresh = [];
    const conflicts = [];
    for (const file of files) {
      const exists = blocks.some(b => b.source.toLowerCase() === file.name.toLowerCase());
      if (exists) {
        conflicts.push(file);
      } else {
        fresh.push(file);
      }
    }

    if (conflicts.length > 0) {
      setPendingUpload({ fresh, conflicts, type: 'searchable' });
    } else {
      await uploadFileBatch(fresh, {}, false, 'searchable');
    }
  };

  // --- Add Constant File(s) ---
  const handleAddConstantFile = async (e) => {
    const files = Array.from(e.target.files);
    e.target.value = '';
    if (files.length === 0) return;

    const fresh = [];
    const conflicts = [];
    for (const file of files) {
      const exists = blocks.some(b => b.source.toLowerCase() === file.name.toLowerCase());
      if (exists) {
        conflicts.push(file);
      } else {
        fresh.push(file);
      }
    }

    if (conflicts.length > 0) {
      setPendingUpload({ fresh, conflicts, type: 'constant' });
    } else {
      await uploadFileBatch(fresh, {}, false, 'constant');
    }
  };

  // --- Delete Chunk/Block ---
  const handleDeleteBlock = (block) => {
    setDeleteTargetBlock(block);
  };

  const confirmDeleteBlock = async () => {
    if (!deleteTargetBlock) return;
    const id = deleteTargetBlock.id;
    setDeleteTargetBlock(null);

    const updatedBlocks = blocks.filter(b => b.id !== id);
    setBlocks(updatedBlocks);
    setSelectedBlockIds(prev => prev.filter(selectedId => selectedId !== id));

    try {
      await electronAPI.saveProfileKbBlocks(profile.id, updatedBlocks);
    } catch (err) {
      console.error("Error deleting block:", err);
      showToast("Failed to delete block. Reloading list.", "error");
      loadBlocks();
    }
  };

  const handleToggleSelectBlock = (blockId) => {
    setSelectedBlockIds(prev =>
      prev.includes(blockId) ? prev.filter(id => id !== blockId) : [...prev, blockId]
    );
  };

  // Enable/disable a memory unit. OFF = ignored by injection/retrieval and dropped
  // from the token counter. Non-destructive, the content stays put.
  const handleToggleEnabled = async (block, nextEnabled) => {
    // Optimistic local update on the ungrouped per-chunk blocks state
    setBlocks(prev => prev.map(b => {
      if (block.type === 'rag_file') {
        return b.type === 'rag' && b.source === block.source ? { ...b, enabled: nextEnabled } : b;
      }
      return b.id === block.id ? { ...b, enabled: nextEnabled } : b;
    }));
    try {
      await electronAPI.toggleKbBlockEnabled(profile.id, block, nextEnabled);
    } catch (e) {
      console.error("Failed to toggle memory block:", e);
      showToast("Failed to update memory switch.", "error");
      loadBlocks();
    }
  };

  const handleSelectAll = () => {
    const selectable = filteredBlocks.map(b => b.id);
    setSelectedBlockIds(selectable);
  };

  const handleClearSelection = () => {
    setSelectedBlockIds([]);
  };

  const handleDeleteEntireFile = async (fileName) => {
    try {
      setIsProcessing(true);
      setProgressMsg(`Deleting file and chunks: ${fileName}...`);

      await electronAPI.deleteKbFile(profile.id, fileName);

      const deletedBlockIds = blocks.filter(b => b.source === fileName).map(b => b.id);
      setSelectedBlockIds(prev => prev.filter(id => !deletedBlockIds.includes(id)));

      setDeleteTargetBlock(null);
      await loadBlocks();
    } catch (err) {
      console.error("Error deleting entire file:", err);
      showToast(`Failed to delete file "${fileName}".`, "error");
    } finally {
      setIsProcessing(false);
      setProgressMsg("");
    }
  };

  const handleBulkDelete = async () => {
    try {
      setIsProcessing(true);
      setProgressMsg("Deleting selected blocks...");

      const remainingBlocks = blocks.filter(b => !selectedBlockIds.includes(b.id));
      await electronAPI.saveProfileKbBlocks(profile.id, remainingBlocks);

      setSelectedBlockIds([]);
      setIsBulkDeleteConfirmOpen(false);
      loadBlocks();
    } catch (err) {
      console.error("Error in bulk delete:", err);
      showToast("Failed to delete selected blocks.", "error");
      loadBlocks();
    } finally {
      setIsProcessing(false);
      setProgressMsg("");
    }
  };

  // --- Open Editor ---
  const openEditor = (block = null) => {
    setEditingBlock(block);
    setEditorError('');
    if (block) {
      setEditorTitle(block.source);
      setEditorText(block.text);
      setEditorKeywords(block.rawItem?.keywords || block.keywords || []);
      setEditorStrategy(block.strategy || block.rawItem?.strategy || 'rag_search');
      setTagInput('');
    } else {
      setEditorTitle('');
      setEditorText('');
      setEditorKeywords([]);
      setEditorStrategy('rag_search');
      setTagInput('');
    }
    setEditorOpen(true);
    setTimeout(() => editorTextareaRef.current?.focus(), 100);
  };

  // --- Save Custom Snippet / Edited Chunk ---
  const handleSaveEditor = async () => {
    if (!editorText.trim()) {
      setEditorError('Content cannot be empty');
      return;
    }

    setSavingEditor(true);
    setEditorError('');

    try {
      if (editingBlock) {
        // --- EDITING EXISTING BLOCK ---
        const item = blocks.find(b => b.id === editingBlock.id);
        if (item) {
          if (item.type === 'manual') {
            item.source = editorTitle.trim() || 'Custom Memory';
            item.strategy = editorStrategy;
            if (!item.rawItem) item.rawItem = {};
            item.rawItem.source = item.source;
            item.rawItem.strategy = editorStrategy;
          }
          item.text = editorText.trim();
          item.keywords = editorKeywords;

          if (item.type === 'constant') {
            item.rawItem.content = item.text;
          } else if (item.type === 'manual' && editorStrategy === 'constant') {
            item.rawItem.content = item.text;
            item.rawItem.name = item.source;
            item.rawItem.keywords = item.keywords;
          } else {
            // Re-vectorize RAG / Manual chunk text with tags
            const vectorData = await electronAPI.vectorizeKbChunk(item.text, item.source, editorKeywords);
            if (vectorData) {
              item.rawItem = vectorData;
              item.rawItem.id = item.id;
              item.rawItem.strategy = editorStrategy;
              item.rawItem.manuallyEdited = true;
            }
            // Mark file-derived chunks so a re-index won't discard the edit
            item.manuallyEdited = true;
          }

          await electronAPI.saveProfileKbBlocks(profile.id, blocks);
          setBlocks([...blocks]);
          if (viewingFileBlock) {
            setViewingFileBlock(curr => {
              if (!curr) return null;
              return {
                ...curr,
                chunks: curr.chunks.map(c => c.id === editingBlock.id ? { ...item } : c)
              };
            });
          }
        }
      } else {
        // --- ADDING NEW CUSTOM SNIPPET ---
        const title = editorTitle.trim() || 'Custom Memory';
        const text = editorText.trim();
        const newId = `manual_${Date.now()}`;

        if (editorStrategy === 'constant') {
          const newBlock = {
            id: newId,
            type: 'manual',
            strategy: 'constant',
            source: title,
            text: text,
            keywords: editorKeywords,
            rawItem: {
              id: newId,
              type: 'manual',
              name: title,
              content: text,
              strategy: 'constant',
              keywords: editorKeywords
            }
          };
          const updatedBlocks = [newBlock, ...blocks];
          await electronAPI.saveProfileKbBlocks(profile.id, updatedBlocks);
          setBlocks(updatedBlocks);
        } else {
          // Vectorize snippet text with tags
          const vectorData = await electronAPI.vectorizeKbChunk(text, title, editorKeywords);
          if (vectorData) {
            vectorData.id = newId;
            vectorData.strategy = 'rag_search';
            const newBlock = {
              id: newId,
              type: 'manual',
              strategy: 'rag_search',
              source: title,
              text: text,
              keywords: editorKeywords,
              rawItem: vectorData
            };
            const updatedBlocks = [newBlock, ...blocks];
            await electronAPI.saveProfileKbBlocks(profile.id, updatedBlocks);
            setBlocks(updatedBlocks);
          }
        }
      }
      setEditorOpen(false);
    } catch (err) {
      console.error("Error saving block editor:", err);
      setEditorError(err.message || 'An error occurred while vectorizing.');
    } finally {
      setSavingEditor(false);
    }
  };

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
        source: source,
        text: `Contains ${chunks.length} searchable chunk(s). Click to view and manage chunks.`,
        keywords: Array.from(new Set(chunks.flatMap(c => c.keywords || []))),
        tokenCount: chunks.reduce((sum, c) => sum + (c.tokenCount || 0), 0),
        enabled: chunks.every(c => c.enabled !== false),
        chunks: chunks
      });
    });

    return list;
  }, [blocks]);

  // Resolve a block's token count, falling back to the IPC-computed map for blocks
  // (e.g. freshly-created custom snippets) that don't yet carry a stored count.
  const tokenOf = (b) => b.tokenCount || tokenMap[b.id] || 0;

  // Count any block missing a stored tokenCount accurately in the main process
  useEffect(() => {
    const missing = blocks.filter(b => !b.tokenCount && (b.text || '').length > 0 && tokenMap[b.id] == null);
    if (missing.length === 0 || !electronAPI?.countTokens) return;
    let cancelled = false;
    (async () => {
      try {
        const counts = await electronAPI.countTokens(missing.map(b => b.text || ''));
        if (cancelled) return;
        setTokenMap(prev => {
          const next = { ...prev };
          missing.forEach((b, i) => { next[b.id] = counts[i] || 0; });
          return next;
        });
      } catch (e) { /* leave at 0 on failure */ }
    })();
    return () => { cancelled = true; };
  }, [blocks, tokenMap]);

  // Token budgeting: separate always-on (constant) context from searchable knowledge
  const tokenTotals = React.useMemo(() => {
    let alwaysOn = 0;
    let searchable = 0;
    groupedBlocks.forEach(b => {
      if (b.enabled === false) return;
      const t = b.tokenCount || tokenMap[b.id] || 0;
      const isAlwaysOn = b.type === 'constant'
        || (b.type === 'manual' && (b.strategy === 'constant' || b.rawItem?.strategy === 'constant'));
      if (isAlwaysOn) alwaysOn += t; else searchable += t;
    });
    return { alwaysOn, searchable };
  }, [groupedBlocks, tokenMap]);

  let filteredBlocks = groupedBlocks.filter(b => {
    const query = searchQuery.toLowerCase();
    if (b.type === 'rag_file') {
      return b.source.toLowerCase().includes(query) || b.chunks.some(c => c.text.toLowerCase().includes(query));
    }
    return b.text.toLowerCase().includes(query) || b.source.toLowerCase().includes(query);
  });

  if (activeFilter !== 'all') {
    if (activeFilter === 'rag') {
      filteredBlocks = filteredBlocks.filter(b => b.type === 'rag_file');
    } else {
      filteredBlocks = filteredBlocks.filter(b => b.type === activeFilter);
    }
  }

  const isBlurEnabled = settings?.interface?.blur ?? true;


  const isAlwaysOn = (b) => b.type === 'constant'
    || (b.type === 'manual' && (b.strategy === 'constant' || b.rawItem?.strategy === 'constant'));
  const kindOf = (b) => {
    if (b.type === 'rag_file') return { label: 'Searchable file', Icon: FileSearch };
    if (b.type === 'constant') return { label: 'Always-on file', Icon: FileText };
    return { label: 'Custom memory', Icon: Pencil };
  };
  const counts = {
    all: groupedBlocks.length,
    manual: groupedBlocks.filter(b => b.type === 'manual').length,
    constant: groupedBlocks.filter(b => b.type === 'constant').length,
    rag: groupedBlocks.filter(b => b.type === 'rag_file').length,
  };
  const FILTERS = [
    { id: 'all', label: 'All' },
    { id: 'manual', label: 'Custom memory' },
    { id: 'constant', label: 'Always-on files' },
    { id: 'rag', label: 'Searchable files' },
  ];
  const ADD_OPTIONS = [
    { id: 'memory', Icon: Pencil, title: 'Custom memory', text: 'Write a fact or rule by hand. Tags decide when it comes up.', mode: 'var(--theme-mode-always)', onClick: () => openEditor(null) },
    { id: 'constant', Icon: FileText, title: 'Always-on file', text: 'Sent with every reply. Best for short, essential canon.', mode: 'var(--theme-mode-always)', onClick: () => constantInputRef.current?.click() },
    { id: 'searchable', Icon: FileSearch, title: 'Searchable file', text: 'Split into chunks; only the relevant parts are sent.', mode: 'var(--theme-mode-searchable)', onClick: () => searchableInputRef.current?.click() },
  ];
  const profileColor = profile?.color || '#FBCB2D';

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center titlebar-nodrag select-none p-8 ${isBlurEnabled ? 'bg-surface-overlay backdrop-blur-sm' : 'bg-surface-canvas'}`}>
      <div role="dialog" aria-modal="true" aria-label="Knowledge base" className="w-full max-w-6xl h-full max-h-[50rem] bg-surface-canvas rounded-[1.25rem] shadow-2xl border border-border-default flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">

        <header
          className="shrink-0 flex items-center gap-3.5 border-b border-border-subtle py-4 pl-6 pr-5"
          style={{ background: `linear-gradient(90deg, color-mix(in srgb, ${profileColor} 9%, transparent), transparent 50%)` }}
        >
          <ProfileAvatar color={profileColor} size={40} />
          <div className="min-w-0 flex-1">
            <h2 className="text-lg font-bold text-text-primary">Knowledge base</h2>
            <p className="caption truncate text-[0.8125rem]">{profile?.name} · goes with this profile into every workspace that uses it</p>
          </div>
          <div ref={addMenuAnchorRef}>
            <Button variant="ghost" size="sm" icon={Plus} disabled={isProcessing} onClick={() => setIsAddMenuOpen(open => !open)} aria-haspopup="menu" aria-expanded={isAddMenuOpen}>
              Add
            </Button>
          </div>
          <Menu anchorRef={addMenuAnchorRef} open={isAddMenuOpen} onClose={() => setIsAddMenuOpen(false)} label="Add to knowledge base" className="w-60">
            {ADD_OPTIONS.map(option => (
              <MenuItem key={option.id} icon={option.Icon} label={option.title} onSelect={() => { setIsAddMenuOpen(false); option.onClick(); }} />
            ))}
            <MenuSeparator />
            <MenuItem icon={Upload} label="Import knowledge base" onSelect={() => { setIsAddMenuOpen(false); handleImportKb(); }} />
          </Menu>
          <input type="file" ref={searchableInputRef} onChange={handleAddSearchableFile} accept=".txt,.pdf,.md,.docx" multiple className="hidden" />
          <input type="file" ref={constantInputRef} onChange={handleAddConstantFile} accept=".txt,.pdf,.md,.docx" multiple className="hidden" />
          <IconButton icon={X} label="Close knowledge base" onClick={onClose} />
        </header>

        {isProcessing && (
          <div className="shrink-0 flex items-center justify-between gap-4 border-b border-border-subtle bg-surface-editor px-6 py-2 text-xs animate-in slide-in-from-top duration-200">
            <div className="flex items-center gap-2.5 font-medium text-text-secondary">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              <span>{progressMsg}</span>
            </div>
            {progressDetail && (
              <div className="flex w-72 shrink-0 items-center gap-3">
                <span className="caption shrink-0 tabular-nums">{progressDetail.current} / {progressDetail.total} chunks</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-tint/10">
                  <div className="h-full rounded-full bg-accent transition-all duration-300" style={{ width: `${Math.round((progressDetail.current / progressDetail.total) * 100)}%` }} />
                </div>
              </div>
            )}
          </div>
        )}

        <div className="flex-1 flex overflow-hidden min-h-0 relative">

          <nav aria-label="Filter knowledge" className="flex w-60 shrink-0 flex-col gap-0.5 border-r border-border-subtle px-3 py-4">
            {FILTERS.map(item => {
              const active = activeFilter === item.id;
              return (
                <button
                  key={item.id}
                  type="button"
                  aria-current={active ? 'true' : undefined}
                  onClick={() => setActiveFilter(item.id)}
                  className={`flex h-9 w-full items-center rounded-[0.5625rem] px-3 text-left text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${active ? 'bg-tint/[0.07] font-semibold text-text-primary' : 'font-medium text-text-muted hover:bg-tint/[0.04] hover:text-text-secondary'}`}
                >
                  <span className="flex-1">{item.label}</span>
                  <span className="caption tabular-nums">{counts[item.id]}</span>
                </button>
              );
            })}
            <span className="flex-1" />
            <div className="mb-2.5 flex flex-col gap-2.5 rounded-xl border border-border-subtle bg-tint/[0.025] p-3">
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--theme-mode-always)]" />
                <span className="caption flex-1">Sent every reply</span>
                <span className="text-xs tabular-nums text-text-secondary">{tokenTotals.alwaysOn.toLocaleString()} tokens</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 shrink-0 rounded-full bg-[var(--theme-mode-searchable)]" />
                <span className="caption flex-1">Searchable</span>
                <span className="text-xs tabular-nums text-text-secondary">{tokenTotals.searchable.toLocaleString()} tokens</span>
              </div>
              <span className="caption">Switched-off items count for nothing.</span>
            </div>
            {onOpenSmartSearch && (
              <button type="button" onClick={onOpenSmartSearch} className="flex h-9 items-center gap-2.5 rounded-[0.5625rem] px-3 text-left text-sm text-text-muted transition-colors hover:bg-tint/[0.04] hover:text-text-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                <Search className="h-4 w-4" aria-hidden="true" />
                Smart search settings
              </button>
            )}
            <button type="button" onClick={handleExportKb} disabled={exportingKb || isProcessing} className="flex h-9 items-center gap-2.5 rounded-[0.5625rem] px-3 text-left text-sm text-text-muted transition-colors hover:bg-tint/[0.04] hover:text-text-secondary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
              <Download className="h-4 w-4" aria-hidden="true" />
              Export
            </button>
          </nav>

          <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-4 px-6 py-5">
            <div className="flex shrink-0 items-center gap-3">
              <h3 className="flex-1 text-[0.9375rem] font-bold text-text-primary">
                {FILTERS.find(item => item.id === activeFilter)?.label} <span className="caption tabular-nums">{filteredBlocks.length}</span>
              </h3>
              <TextInput placeholder="Search in content" aria-label="Search in content" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} icon={Search} containerClassName="w-64" />
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar pr-1">
              {loading ? (
                <div className="flex h-full flex-col items-center justify-center py-20 text-text-subtle">
                  <Loader2 className="mb-2 h-7 w-7 animate-spin" aria-hidden="true" />
                  <span className="text-xs">Loading the knowledge base…</span>
                </div>
              ) : groupedBlocks.length === 0 ? (
                <div className="flex min-h-full flex-col items-center justify-center gap-6 rounded-2xl border-[1.5px] border-dashed border-border-default p-8 text-center">
                  <div>
                    <span className="block text-[1.0625rem] font-bold text-text-primary">Nothing here yet</span>
                    <span className="caption text-[0.8125rem]">What this profile should always know, wherever it's used. For a single story, use that workspace's Memory tab.</span>
                  </div>
                  <div className="grid w-full max-w-3xl grid-cols-1 gap-3.5 text-left md:grid-cols-3">
                    {ADD_OPTIONS.map(option => (
                      <button
                        key={option.id}
                        type="button"
                        onClick={option.onClick}
                        className="flex flex-col items-start gap-2.5 rounded-[0.875rem] border border-border-subtle bg-tint/[0.025] p-4.5 text-left transition-colors hover:border-border-strong hover:bg-tint/[0.04] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                      >
                        <span className="inline-flex h-9 w-9 items-center justify-center rounded-[0.6875rem]" style={{ color: option.mode, background: `color-mix(in srgb, ${option.mode} 14%, transparent)` }}>
                          <option.Icon className="h-[1.125rem] w-[1.125rem]" aria-hidden="true" />
                        </span>
                        <span className="text-sm font-semibold text-text-primary">{option.title}</span>
                        <span className="caption">{option.text}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : filteredBlocks.length === 0 ? (
                <EmptyState icon={Database} title="Nothing matches" subtitle="Try another search or filter." />
              ) : (
                <div className="overflow-hidden rounded-2xl border border-border-subtle bg-tint/[0.015]">
                  <div className="flex items-center gap-3.5 px-4 py-2.5">
                    <span className="w-4" />
                    <span className="caption flex-1 pl-[2.875rem]">Item</span>
                    <span className="caption w-28">How it's used</span>
                    <span className="w-16" />
                    <span className="caption w-9">On</span>
                  </div>
                  {filteredBlocks.map((block) => {
                    const always = isAlwaysOn(block);
                    const mode = always ? 'var(--theme-mode-always)' : 'var(--theme-mode-searchable)';
                    const kind = kindOf(block);
                    const selectable = block.type !== 'rag_file';
                    const selected = selectedBlockIds.includes(block.id);
                    const open = expandedBlockId === block.id;
                    const meta = [kind.label];
                    if (block.type === 'rag_file') meta.push(`${block.chunks.length} chunk${block.chunks.length === 1 ? '' : 's'}`);
                    meta.push(`${tokenOf(block).toLocaleString()} tokens`);
                    const isFile = block.type !== 'manual';
                    return (
                      <div key={block.id} className={`group border-t border-tint/[0.06] ${open || selected ? 'bg-tint/[0.03]' : 'hover:bg-tint/[0.02]'}`}>
                        <div className="flex items-center gap-3.5 px-4 py-3">
                          <span className="flex w-4 justify-center">
                            {selectable && (
                              <span className={`transition-opacity ${selected || selectedBlockIds.length ? 'opacity-100' : 'opacity-0 group-hover:opacity-100 focus-within:opacity-100'}`}>
                                <Checkbox checked={selected} onChange={() => handleToggleSelectBlock(block.id)} size="sm" ariaLabel={`Select ${block.source}`} />
                              </span>
                            )}
                          </span>
                          <button
                            type="button"
                            onClick={() => (block.type === 'rag_file' ? setViewingFileBlock(block) : setExpandedBlockId(open ? null : block.id))}
                            className={`flex min-w-0 flex-1 items-center gap-3.5 text-left focus-visible:outline-none ${block.enabled === false ? 'opacity-55' : ''}`}
                          >
                            <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.625rem]" style={{ color: mode, background: `color-mix(in srgb, ${mode} 14%, transparent)` }}>
                              <kind.Icon className="h-4 w-4" aria-hidden="true" />
                            </span>
                            <span className="flex min-w-0 flex-1 flex-col gap-1">
                              <span className="flex min-w-0 flex-wrap items-center gap-2">
                                <span className={`truncate text-sm font-semibold text-text-primary ${isFile ? 'font-mono text-[0.8125rem]' : ''}`}>{block.source}</span>
                                {(block.keywords || []).slice(0, 4).map(tag => (
                                  <span key={tag} className="inline-flex h-[1.375rem] items-center rounded-full border border-border-default bg-tint/[0.03] px-2 text-xs font-medium text-text-secondary">{tag.replace(/^#/, '')}</span>
                                ))}
                              </span>
                              <span className="caption tabular-nums">{meta.join(' · ')}</span>
                            </span>
                            <span className="inline-flex w-28 shrink-0 items-center gap-1.5 text-xs font-semibold" style={{ color: mode }}>
                              <span className="h-2 w-2 rounded-full" style={{ background: mode }} />
                              {always ? 'Always sent' : 'Searched'}
                            </span>
                          </button>
                          <span className="flex w-16 justify-end gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
                            {block.type !== 'rag_file' && <IconButton icon={Pencil} label={`Edit ${block.source}`} size="sm" onClick={() => openEditor(block)} />}
                            <IconButton
                              icon={Trash2}
                              label={block.type === 'rag_file' ? `Delete ${block.source}` : `Delete ${block.source}`}
                              tone="danger"
                              size="sm"
                              onClick={() => {
                                if (block.type === 'rag_file') {
                                  setConfirmDialog({
                                    message: `Delete the searchable file "${block.source}"? This erases all of its indexed chunks. To remove a single chunk, open the file and delete it there.`,
                                    confirmLabel: 'Delete file',
                                    onConfirm: () => handleDeleteEntireFile(block.source),
                                  });
                                } else {
                                  handleDeleteBlock(block);
                                }
                              }}
                            />
                          </span>
                          <span className="flex w-9 justify-start">
                            <Toggle checked={block.enabled !== false} onChange={(next) => handleToggleEnabled(block, next)} ariaLabel={`Use ${block.source}`} />
                          </span>
                        </div>
                        {open && (
                          <div className="flex flex-col gap-3 pb-4 pl-[4.875rem] pr-4">
                            <p className="max-h-60 overflow-y-auto whitespace-pre-wrap break-words rounded-xl border border-border-subtle bg-surface-input px-4 py-3.5 text-[0.8125rem] leading-relaxed text-text-secondary custom-scrollbar select-text">
                              {block.text}
                            </p>
                            <div className="flex items-center gap-2">
                              <span className="caption flex-1">{always ? 'Sent with every reply while it is on.' : 'Comes up when the turn is about it, or mentions one of its tags.'}</span>
                              <Button variant="ghost" size="sm" icon={Pencil} onClick={() => openEditor(block)}>Edit</Button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* A searchable file opens over the list with its chunks. */}
          {viewingFileBlock && (
            <div className="absolute left-1/2 top-1/2 z-40 flex max-h-[calc(100%-3rem)] w-[35rem] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-border-default bg-surface-panel p-5 shadow-[0_0_0_100vmax_color-mix(in_srgb,var(--theme-shade)_55%,transparent)] animate-in zoom-in-95 fade-in duration-200">
              <div className="mb-4 flex shrink-0 items-center gap-3 border-b border-border-subtle pb-3">
                <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-[0.625rem] text-[var(--theme-mode-searchable)]" style={{ background: 'color-mix(in srgb, var(--theme-mode-searchable) 14%, transparent)' }}>
                  <FileSearch className="h-4 w-4" aria-hidden="true" />
                </span>
                <div className="min-w-0 flex-1">
                  <h3 className="text-sm font-bold text-text-primary">Searchable file</h3>
                  <span className="block truncate font-mono text-xs text-text-subtle">{viewingFileBlock.source} · {viewingFileBlock.chunks.length} chunks</span>
                </div>
                <IconButton icon={X} label="Close file" size="sm" onClick={() => setViewingFileBlock(null)} />
              </div>

              <div className="flex-1 space-y-3 overflow-y-auto pr-1 custom-scrollbar">
                {viewingFileBlock.chunks.map((chunk, idx) => (
                  <div key={chunk.id} className="group/chunk relative flex flex-col rounded-xl border border-border-subtle bg-surface-input p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="caption flex items-center gap-1.5 tabular-nums">
                        Chunk {idx + 1} · {(chunk.tokenCount || tokenMap[chunk.id] || 0).toLocaleString()} tokens
                        {chunk.manuallyEdited && (
                          <span data-tooltip="Edited by hand. Survives re-indexing." className="inline-flex h-5 items-center rounded-full border border-border-default px-2 text-xs font-medium text-text-secondary">Edited</span>
                        )}
                      </span>
                      <div className="flex gap-0.5 opacity-0 transition-opacity group-hover/chunk:opacity-100 focus-within:opacity-100">
                        <IconButton icon={Pencil} label="Edit chunk" size="sm" onClick={() => openEditor(chunk)} />
                        <IconButton
                          icon={Trash2}
                          label="Delete chunk"
                          tone="danger"
                          size="sm"
                          onClick={() => {
                            setConfirmDialog({
                              message: 'Delete this chunk? The rest of the file stays.',
                              onConfirm: async () => {
                                if (viewingFileBlock.chunks.length === 1) {
                                  await handleDeleteEntireFile(viewingFileBlock.source);
                                  setViewingFileBlock(null);
                                } else {
                                  const remainingBlocks = blocks.filter(b => b.id !== chunk.id);
                                  setBlocks(remainingBlocks);
                                  try {
                                    await electronAPI.saveProfileKbBlocks(profile.id, remainingBlocks);
                                    setViewingFileBlock(curr => ({ ...curr, chunks: curr.chunks.filter(c => c.id !== chunk.id) }));
                                  } catch (err) {
                                    console.error('Error deleting chunk:', err);
                                    showToast('Failed to delete chunk.', 'error');
                                    loadBlocks();
                                  }
                                }
                              },
                            });
                          }}
                        />
                      </div>
                    </div>
                    <p className="max-h-[9.5rem] overflow-y-auto whitespace-pre-wrap text-[0.8125rem] leading-relaxed text-text-secondary custom-scrollbar select-text">{chunk.text}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Writing or editing one memory, over the list. */}
          {editorOpen && (
            <div className="absolute left-1/2 top-1/2 z-40 flex max-h-[calc(100%-3rem)] w-[30rem] -translate-x-1/2 -translate-y-1/2 flex-col rounded-2xl border border-border-default bg-surface-panel p-5 shadow-[0_0_0_100vmax_color-mix(in_srgb,var(--theme-shade)_55%,transparent)] animate-in zoom-in-95 fade-in duration-200">
              <div className="mb-4 flex shrink-0 items-center justify-between border-b border-border-subtle pb-3">
                <h3 className="text-sm font-bold text-text-primary">{editingBlock ? 'Edit memory' : 'New custom memory'}</h3>
                <IconButton icon={X} label="Close editor" size="sm" onClick={() => setEditorOpen(false)} />
              </div>

              <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto custom-scrollbar">
                <TextInput
                  label="Title"
                  value={editorTitle}
                  onChange={(e) => setEditorTitle(e.target.value)}
                  readOnly={editingBlock && editingBlock.type !== 'manual'}
                  placeholder="e.g. Dice and checks"
                  hint={editingBlock && editingBlock.type !== 'manual' ? 'A file keeps its own name.' : null}
                />

                {(!editingBlock || editingBlock.type === 'manual') && (
                  <div>
                    <span className="mb-1.5 block text-sm font-medium text-text-secondary">How it's used</span>
                    <div className="grid grid-cols-2 gap-2">
                      {[
                        { id: 'rag_search', label: 'Searched', text: 'Sent only when the turn is about it', mode: 'var(--theme-mode-searchable)' },
                        { id: 'constant', label: 'Always sent', text: 'Part of every reply', mode: 'var(--theme-mode-always)' },
                      ].map(option => {
                        const active = editorStrategy === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            aria-pressed={active}
                            onClick={() => setEditorStrategy(option.id)}
                            className={`flex flex-col items-start gap-0.5 rounded-[0.625rem] border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${active ? '' : 'border-border-default hover:border-border-strong'}`}
                            style={active ? { borderColor: option.mode, background: `color-mix(in srgb, ${option.mode} 10%, transparent)` } : undefined}
                          >
                            <span className="flex items-center gap-1.5 text-sm font-semibold" style={{ color: active ? option.mode : undefined }}>
                              <span className="h-2 w-2 rounded-full" style={{ background: option.mode }} />
                              {option.label}
                            </span>
                            <span className="caption">{option.text}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                <Textarea
                  ref={editorTextareaRef}
                  label="Text"
                  value={editorText}
                  onChange={(e) => setEditorText(e.target.value)}
                  placeholder="What the AI should know"
                  className="min-h-[9.5rem] flex-1"
                />

                {(!editingBlock || editingBlock.type === 'manual') && (
                  <div className="flex shrink-0 flex-col gap-2">
                    <span className="block text-sm font-medium text-text-secondary">Tags <span className="caption">(it comes up when the turn mentions one)</span></span>
                    {editorKeywords.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {editorKeywords.map((tag, idx) => (
                          <span key={idx} className="inline-flex h-6 items-center gap-1 rounded-full border border-border-default bg-tint/[0.04] pl-2.5 pr-1 text-xs font-medium text-text-secondary">
                            {tag.replace(/^#/, '')}
                            <button
                              type="button"
                              aria-label={`Remove tag ${tag}`}
                              onClick={() => setEditorKeywords(prev => prev.filter((_, i) => i !== idx))}
                              className="inline-flex h-4 w-4 items-center justify-center rounded-full text-text-subtle hover:text-text-primary"
                            >
                              <X className="h-3 w-3" aria-hidden="true" />
                            </button>
                          </span>
                        ))}
                      </div>
                    )}
                    <div className="flex gap-2">
                      <div className="relative flex-1" ref={editorTagAnchorRef}>
                        <TextInput
                          type="text"
                          value={tagInput}
                          onChange={(e) => { setTagInput(e.target.value); setTagSuggestionsOpen(true); }}
                          onFocus={() => setTagSuggestionsOpen(true)}
                          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddTag(); } }}
                          placeholder="Add a tag"
                          aria-label="Add a tag"
                          disabled={savingEditor}
                        />
                        {(() => {
                          const allTags = Array.from(new Set(
                            blocks.filter(b => b.type === 'manual').flatMap(b => b.keywords || b.rawItem?.keywords || [])
                          )).filter(t => t && !editorKeywords.includes(t));
                          const suggestions = allTags.filter(t => t.toLowerCase().includes(tagInput.toLowerCase()));
                          return (
                            <Popover anchorRef={editorTagAnchorRef} open={tagSuggestionsOpen && suggestions.length > 0} onClose={() => setTagSuggestionsOpen(false)} maxHeight={160}>
                              {suggestions.map((tag) => (
                                <button
                                  key={tag}
                                  type="button"
                                  onClick={() => { setEditorKeywords(prev => [...prev, tag]); setTagInput(''); setTagSuggestionsOpen(false); }}
                                  className="w-full rounded-lg px-3 py-1.5 text-left text-xs font-medium text-text-secondary transition-colors hover:bg-tint/5 hover:text-text-primary"
                                >
                                  {tag.replace(/^#/, '')}
                                </button>
                              ))}
                            </Popover>
                          );
                        })()}
                      </div>
                      <Button variant="ghost" icon={Plus} onClick={handleAddTag} disabled={savingEditor || !tagInput.trim()} aria-label="Add tag" />
                    </div>
                  </div>
                )}

                {editorError && <p className="text-xs font-semibold text-status-danger">{editorError}</p>}
              </div>

              <div className="mt-4 flex shrink-0 justify-end gap-2.5 border-t border-border-subtle pt-4">
                <Button variant="subtle" onClick={() => setEditorOpen(false)}>Cancel</Button>
                <Button icon={Save} loading={savingEditor} onClick={handleSaveEditor}>{savingEditor ? 'Saving…' : 'Save memory'}</Button>
              </div>
            </div>
          )}

          {selectedBlockIds.length > 0 && (
            <div className="absolute bottom-6 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-2xl border border-border-default bg-surface-panel/95 py-2 pl-4 pr-2 shadow-2xl backdrop-blur-md animate-in slide-in-from-bottom-4 duration-200">
              <span className="text-sm font-semibold tabular-nums text-text-primary">{selectedBlockIds.length} selected</span>
              <span className="h-4 w-px bg-border-default" />
              <Button variant="subtle" size="sm" onClick={handleSelectAll}>Select all</Button>
              <Button variant="subtle" size="sm" onClick={handleClearSelection}>Clear</Button>
              <Button variant="danger" size="sm" icon={Trash2} onClick={() => setIsBulkDeleteConfirmOpen(true)}>Delete</Button>
            </div>
          )}

          {/* Delete Confirmation Overlay Modal */}
          {deleteTargetBlock && (
            <ConfirmDialog
              tone="danger"
              title="Confirm Deletion"
              message={
                deleteTargetBlock.type === 'constant'
                  ? `You are about to delete ${deleteTargetBlock.source}. This permanently removes the constant file from the AI context.`
                  : `You are about to delete ${deleteTargetBlock.source}. This action is permanent and will clear the text block and its associated search vectors.`
              }
              actions={[
                {
                  label: 'Cancel',
                  variant: 'ghost',
                  onClick: () => setDeleteTargetBlock(null),
                },
                {
                  label: deleteTargetBlock.type === 'constant' ? 'Delete File' : 'Confirm Delete',
                  variant: 'danger',
                  onClick: confirmDeleteBlock,
                },
              ]}
              onClose={() => setDeleteTargetBlock(null)}
            />
          )}

          {/* Bulk Delete Confirmation Modal */}
          {isBulkDeleteConfirmOpen && (
            <ConfirmDialog
              tone="danger"
              title="Confirm Bulk Deletion"
              message={`Are you sure you want to delete ${selectedBlockIds.length} selected memory blocks? This action is permanent and cannot be undone.`}
              actions={[
                {
                  label: 'Cancel',
                  variant: 'ghost',
                  onClick: () => setIsBulkDeleteConfirmOpen(false),
                },
                {
                  label: 'Delete All',
                  variant: 'danger',
                  onClick: handleBulkDelete,
                },
              ]}
              onClose={() => setIsBulkDeleteConfirmOpen(false)}
            />
          )}

        </div>

      </div>

      {kbOpType && (
        <ImportProgressModal
          progress={kbProgress}
          statusText={kbProgressStatus}
          title={kbOpType === 'export' ? "Exporting Knowledge Base" : "Importing Knowledge Base"}
        />
      )}

      {confirmDialog && (
        <ConfirmDialog
          tone="danger"
          title="Confirm Deletion"
          message={confirmDialog.message}
          actions={[
            {
              label: 'Cancel',
              variant: 'ghost',
              onClick: () => setConfirmDialog(null),
            },
            {
              label: confirmDialog.confirmLabel || 'Delete',
              variant: 'danger',
              onClick: async () => {
                const fn = confirmDialog.onConfirm;
                setConfirmDialog(null);
                if (fn) await fn();
              },
            },
          ]}
          onClose={() => setConfirmDialog(null)}
        />
      )}

      {vectorizeError && (
        <ConfirmDialog
          tone="warning"
          title={vectorizeError.kind === 'config' ? 'Embedding Not Configured' : 'Vectorization Failed'}
          message={vectorizeError.message}
          actions={
            vectorizeError.kind === 'config'
              ? [
                {
                  label: 'Cancel',
                  variant: 'ghost',
                  onClick: () => setVectorizeError(null),
                },
                {
                  label: 'Open Embedding Settings',
                  variant: 'primary',
                  onClick: () => {
                    setVectorizeError(null);
                    onClose();
                    openSettingsToEmbedding();
                  },
                },
              ]
              : [
                {
                  label: 'Close',
                  variant: 'ghost',
                  onClick: () => setVectorizeError(null),
                },
              ]
          }
          onClose={() => setVectorizeError(null)}
        />
      )}

      {pendingUpload && (
        <ConfirmDialog
          tone="warning"
          title="Duplicate File Detected"
          message={`The following file(s) already exist in your Knowledge Base:\n\n${pendingUpload.conflicts.map(f => `• ${f.name}`).join('\n')}\n\nChoose how you want to resolve these conflicts. Cancel will skip duplicate files.`}
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
          existingNames={blocks.map(b => b.source)}
          loading={uploadingAction === 'rename'}
          onCancel={() => setRenamePrompt(null)}
          onConfirm={handleConfirmRename}
        />
      )}

    </div>
  );
}
