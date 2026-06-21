import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../../context/AppContext';
import { X, Search, Database, UploadCloud, FileText, Trash2, Edit3, Save, Cpu, Plus, Loader, Info, Check, HelpCircle, Download } from 'lucide-react';
import { parseMarkdown, escapeHTML } from '../../utils/markdown';
import ImportProgressModal from './ImportProgressModal';
import ConfirmDialog from '../ui/ConfirmDialog';
import TextInput from '../ui/TextInput';
import Textarea from '../ui/Textarea';
import Badge from '../ui/Badge';
import TokenBadge from '../ui/TokenBadge';
import EmptyState from '../ui/EmptyState';
import Checkbox from '../ui/Checkbox';
import RenameFilesModal from '../ui/RenameFilesModal';

export default function KbManagerModal({ profile, onClose }) {
  const { electronAPI, settings, handleSaveProfile, variables, showToast, openSettings } = useApp();
  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [activeFilter, setActiveFilter] = useState('all'); // 'all', 'manual', 'constant', 'rag', 'agentic-rag'
  const [confirmDialog, setConfirmDialog] = useState(null); // { message, onConfirm }
  const [vectorizeError, setVectorizeError] = useState(null);
  const [pendingUpload, setPendingUpload] = useState(null);
  const [uploadingAction, setUploadingAction] = useState(null);
  const [renamePrompt, setRenamePrompt] = useState(null); // { fresh, conflicts, type }

  const openSettingsToEmbedding = () => openSettings('advanced', 'embedding');

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
  const [editorStrategy, setEditorStrategy] = useState('rag_search');
  const [viewingFileBlock, setViewingFileBlock] = useState(null);
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
  const agenticTextareaRef = useRef(null);

  const [isAgentic, setIsAgentic] = useState(profile?.isAgentic === 1 || profile?.isAgentic === true);
  const [agenticPrompt, setAgenticPrompt] = useState(profile?.agenticPrompt || '');
  const [agenticPromptMode, setAgenticPromptMode] = useState('editor'); // 'editor' | 'preview'
  const [savingAgenticSettings, setSavingAgenticSettings] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [isAddMenuOpen, setIsAddMenuOpen] = useState(false);
  const [exportingKb, setExportingKb] = useState(false);
  const [importingKb, setImportingKb] = useState(false);
  const [kbProgress, setKbProgress] = useState(0);
  const [kbProgressStatus, setKbProgressStatus] = useState('');
  const [kbOpType, setKbOpType] = useState(null); // 'export' | 'import' | null

  const [acState, setAcState] = useState({
    isOpen: false,
    search: '',
    triggerIndex: -1,
    activeField: null // 'agentic'
  });
  const [acIndex, setAcIndex] = useState(0);

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
            : `Could not vectorize "${targetName}". This is usually caused by the embedding provider, the network, or the file itself — not Kallamo.\n\nDetails: ${err?.message || 'Unknown error'}`
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
            }
          }

          // Save blocks back to disk
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

  // --- Autocomplete & Preview Logic for Agentic RAG system prompt ---
  const handleTextareaChange = (e, field) => {
    const val = e.target.value;
    setAgenticPrompt(val);

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
    if (!variable || !agenticTextareaRef.current) return;

    const cursor = agenticTextareaRef.current.selectionStart;
    const beforeText = agenticPrompt.substring(0, acState.triggerIndex);
    const afterText = agenticPrompt.substring(cursor);

    const insertedText = `{{${variable.key}}}`;
    const newValue = beforeText + insertedText + afterText;

    setAgenticPrompt(newValue);
    closeAc();

    setTimeout(() => {
      if (agenticTextareaRef.current) {
        agenticTextareaRef.current.focus();
        const newCursorPos = beforeText.length + insertedText.length;
        agenticTextareaRef.current.setSelectionRange(newCursorPos, newCursorPos);
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
      const found = (variables || []).find(v => v.key === key);
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

  const filteredVariables = (variables || []).filter(v =>
    v.key.toLowerCase().includes(acState.search.toLowerCase())
  );

  const handleSaveAgenticSettings = async () => {
    if (!profile) return;
    setSavingAgenticSettings(true);
    setSaveSuccess(false);

    const updatedProfile = {
      ...profile,
      isAgentic: isAgentic ? 1 : 0,
      agenticPrompt: agenticPrompt.trim()
    };

    try {
      await handleSaveProfile(updatedProfile);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (err) {
      console.error("Error saving Agentic RAG settings:", err);
      showToast("Failed to save Agentic RAG settings.", "error");
    } finally {
      setSavingAgenticSettings(false);
    }
  };

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


  const getBadgeLabel = (block) => {
    if (block.type === 'constant') return 'CONSTANT';
    if (block.type === 'manual') {
      return block.strategy === 'constant' ? 'CUSTOM (CONSTANT)' : 'CUSTOM (SEARCHABLE)';
    }
    if (block.type === 'rag_file') return 'SEARCHABLE FILE';
    return 'SEARCHABLE';
  };

  return (
    <div className={`fixed inset-0 z-50 flex items-center justify-center titlebar-nodrag select-none p-8 ${isBlurEnabled ? 'bg-black/60 backdrop-blur-sm' : 'bg-[#011419]'}`}>
      <div className="w-full max-w-6xl h-full max-h-[750px] bg-[#000D11] rounded-xl shadow-2xl border border-gray-800/60 flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">

        {/* Header */}
        <div className="shrink-0 flex justify-between items-center h-16 w-full px-6 bg-[#011419] border-b border-gray-800/50">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-accent/10 rounded-lg text-accent">
              <Database className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h2 className="text-base font-bold text-white tracking-wide">Knowledge Base Manager</h2>
                <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-gray-800 text-gray-400 uppercase tracking-wider">{profile?.name}</span>
              </div>
              <p className="caption mt-0.5">Edit, delete or inject manual memories into the Vector Database.</p>
            </div>
          </div>

          <div className="flex items-center space-x-3">
            {/* Action buttons */}
            {activeFilter !== 'agentic-rag' && (
              <div className="relative">
                <button
                  onClick={() => setIsAddMenuOpen(!isAddMenuOpen)}
                  disabled={isProcessing}
                  className="flex items-center space-x-1.5 px-3.5 py-1.5 bg-accent hover:brightness-110 text-[#011419] rounded font-bold text-[11px] transition-all cursor-pointer disabled:opacity-50 disabled:pointer-events-none"
                >
                  <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
                  <span>Add</span>
                </button>
                
                {isAddMenuOpen && (
                  <>
                    <div className="fixed inset-0 z-30" onClick={() => setIsAddMenuOpen(false)} />
                    <div className="absolute right-0 mt-2 w-48 bg-[#0a161d] border border-gray-800 rounded-xl shadow-2xl p-1.5 z-40 animate-in slide-in-from-top-2 duration-150 flex flex-col space-y-0.5">
                      <button
                        onClick={() => {
                          setIsAddMenuOpen(false);
                          openEditor(null);
                        }}
                        className="w-full flex items-center space-x-2.5 text-left px-3 py-2 rounded-lg text-xs font-semibold text-gray-300 hover:text-white hover:bg-white/5 cursor-pointer transition-colors"
                      >
                        <Edit3 className="w-3.5 h-3.5 text-accent" />
                        <span>Add Custom Memory</span>
                      </button>
                      <button
                        onClick={() => {
                          setIsAddMenuOpen(false);
                          constantInputRef.current?.click();
                        }}
                        className="w-full flex items-center space-x-2.5 text-left px-3 py-2 rounded-lg text-xs font-semibold text-gray-300 hover:text-white hover:bg-white/5 cursor-pointer transition-colors"
                      >
                        <FileText className="w-3.5 h-3.5 text-amber-500" />
                        <span>Add Constant File</span>
                      </button>
                      <button
                        onClick={() => {
                          setIsAddMenuOpen(false);
                          searchableInputRef.current?.click();
                        }}
                        className="w-full flex items-center space-x-2.5 text-left px-3 py-2 rounded-lg text-xs font-semibold text-gray-300 hover:text-white hover:bg-white/5 cursor-pointer transition-colors"
                      >
                        <Database className="w-3.5 h-3.5 text-blue-400" />
                        <span>Add Searchable File</span>
                      </button>
                      <div className="h-px bg-gray-800/60 my-1" />
                      <button
                        onClick={() => {
                          setIsAddMenuOpen(false);
                          handleImportKb();
                        }}
                        className="w-full flex items-center space-x-2.5 text-left px-3 py-2 rounded-lg text-xs font-semibold text-gray-300 hover:text-white hover:bg-white/5 cursor-pointer transition-colors"
                      >
                        <UploadCloud className="w-3.5 h-3.5 text-emerald-400" />
                        <span>Import Knowledge Base</span>
                      </button>
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Hidden inputs */}
            <input
              type="file"
              ref={searchableInputRef}
              onChange={handleAddSearchableFile}
              accept=".txt,.pdf,.md,.docx"
              multiple
              className="hidden"
            />
            <input
              type="file"
              ref={constantInputRef}
              onChange={handleAddConstantFile}
              accept=".txt,.pdf,.md,.docx"
              multiple
              className="hidden"
            />

            {activeFilter !== 'agentic-rag' && <div className="w-px h-6 bg-gray-800/80 mx-1"></div>}

            <button
              onClick={onClose}
              className="text-gray-400 hover:text-red-500 transition-colors cursor-pointer p-1 rounded-md hover:bg-white/5"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Ingest Progress bar */}
        {isProcessing && (
          <div className="shrink-0 bg-[#051116] border-b border-gray-800/50 px-6 py-2 flex items-center justify-between text-xs animate-in slide-in-from-top duration-200">
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

        {/* Body Container */}
        <div className="flex-1 flex overflow-hidden min-h-0 relative">

          {/* Left Sidebar Filter */}
          <div className="w-56 shrink-0 bg-[#011419] border-r border-gray-800/60 p-4 flex flex-col space-y-6">
            <div>
              <span className="block text-[9px] font-bold text-gray-500 uppercase tracking-widest mb-3 px-2">Filter By Source</span>
              <nav className="flex flex-col space-y-1">
                {[
                  { id: 'all', label: 'All Memories' },
                  { id: 'manual', label: 'Custom Memory' },
                  { id: 'constant', label: 'Constant Files' },
                  { id: 'rag', label: 'Searchable Chunks' }
                ].map(item => (
                  <button
                    key={item.id}
                    onClick={() => setActiveFilter(item.id)}
                    className={`w-full text-left px-3 py-2 text-xs font-semibold rounded-md transition-all cursor-pointer ${activeFilter === item.id
                      ? 'bg-[#1a2d32] text-white shadow-sm border-l-2 border-accent'
                      : 'text-gray-400 hover:text-gray-200 hover:bg-[#071318]'
                      }`}
                  >
                    {item.label}
                  </button>
                ))}
              </nav>
            </div>

            <div className="mt-auto flex flex-col space-y-3">
              <button
                type="button"
                onClick={() => setActiveFilter('agentic-rag')}
                className={`w-full text-left px-3 py-2.5 text-xs font-semibold rounded-md transition-all cursor-pointer flex items-center space-x-2 border ${activeFilter === 'agentic-rag'
                  ? 'bg-accent text-[#011419] border-accent font-extrabold shadow-md'
                  : 'bg-[#051116] text-gray-400 border-gray-800/60 hover:text-white hover:border-gray-700'
                  }`}
              >
                <Cpu className="w-3.5 h-3.5" />
                <span>Agentic RAG Settings</span>
              </button>

              <button
                type="button"
                onClick={handleExportKb}
                disabled={exportingKb || isProcessing}
                className="w-full text-left px-3 py-2.5 text-xs font-semibold rounded-md transition-all cursor-pointer flex items-center space-x-2 border bg-[#051116] text-gray-400 border-gray-800/60 hover:text-white hover:border-gray-700 disabled:opacity-50 font-bold"
              >
                <Download className="w-3.5 h-3.5 text-accent" />
                <span>Export Knowledge Base</span>
              </button>

              <div className="bg-[#051116] border border-gray-800/60 rounded-lg p-3">
              <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider block mb-1">Knowledge Stats</span>
              <div className="text-xs text-gray-300 font-mono space-y-1">
                <div className="flex justify-between">
                  <span>Total Blocks:</span>
                  <span className="text-white font-bold">{blocks.length}</span>
                </div>
                <div className="flex justify-between text-[10px] text-gray-400">
                  <span>Searchable:</span>
                  <span>{blocks.filter(b => b.type !== 'constant').length}</span>
                </div>
                <div className="flex justify-between text-[10px] text-gray-400">
                  <span>Constant:</span>
                  <span>{blocks.filter(b => b.type === 'constant').length}</span>
                </div>
              </div>
            </div>
          </div>
          </div>

          {/* Right Main Grid */}
          <div className="flex-1 flex flex-col p-6 overflow-hidden min-h-0 bg-[#00080B]">
            {activeFilter === 'agentic-rag' ? (
              <div className="flex-1 flex flex-col h-full overflow-hidden animate-in fade-in duration-200">
                <div className="flex justify-between items-center mb-6 shrink-0 border-b border-gray-800 pb-3">
                  <div>
                    <h3 className="text-base font-bold text-white tracking-wide">Smart Search Agent (Agentic RAG)</h3>
                    <p className="caption mt-1">Configure autonomous context retrieval rules for this AI profile.</p>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 min-h-0 pb-6 space-y-6">
                  {/* Enabling Card */}
                  <div className="bg-[#0a161d] border border-gray-800/80 rounded-xl p-5">
                    <div className="flex items-start justify-between">
                      <div className="pr-4 flex-1">
                        <div className="flex items-center space-x-1.5 mb-1.5">
                          <span className="text-sm font-bold text-gray-200">Enable Agentic RAG Search</span>
                        </div>
                        <p className="caption max-w-xl">
                          When active, the AI will evaluate the conversation context first and create dynamic search queries targeting the vector store instead of doing simple matches, leading to significantly better retrieval relevance.
                        </p>
                      </div>
                      <label className="relative inline-flex items-center cursor-pointer shrink-0 mt-1">
                        <input
                          type="checkbox"
                          checked={isAgentic}
                          onChange={(e) => {
                            setIsAgentic(e.target.checked);
                          }}
                          className="sr-only peer"
                        />
                        <div className="w-9 h-5 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-300 after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-accent"></div>
                      </label>
                    </div>
                  </div>

                  {/* System Prompt block */}
                  {isAgentic && (
                    <div className="bg-[#0a161d] border border-gray-800/80 rounded-xl p-5 flex flex-col min-h-[360px] relative">
                      <div className="flex justify-between items-center mb-4 shrink-0 pb-1.5 border-b border-gray-800/60">
                        <label className="block text-xs font-bold text-accent uppercase tracking-wider">Agentic System Prompt</label>
                        
                        {/* Editor / Preview Toggles */}
                        <div className="flex bg-[#011419] p-0.5 rounded border border-gray-800 text-[10px] font-bold uppercase tracking-wider select-none shrink-0 z-10 space-x-0.5">
                          <button
                            type="button"
                            onClick={() => setAgenticPromptMode('editor')}
                            className={`px-3 py-1 rounded cursor-pointer transition-colors ${agenticPromptMode === 'editor' ? 'bg-[#1a2d32] text-white' : 'text-gray-500 hover:text-gray-300'
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
                            className={`px-3 py-1 rounded cursor-pointer transition-colors ${agenticPromptMode === 'preview' ? 'bg-[#1a2d32] text-white' : 'text-gray-500 hover:text-gray-300'
                              }`}
                          >
                            Preview
                          </button>
                        </div>
                      </div>

                      {agenticPromptMode === 'editor' ? (
                        <div className="flex-1 relative flex flex-col min-h-[200px]">
                          <textarea
                            ref={agenticTextareaRef}
                            value={agenticPrompt}
                            onChange={(e) => handleTextareaChange(e, 'agentic')}
                            onKeyDown={(e) => handleTextareaKeyDown(e, 'agentic')}
                            className="flex-1 w-full bg-[#011419] border border-gray-800 text-gray-200 text-sm rounded-md p-4 focus:outline-none focus:border-accent resize-none font-mono custom-scrollbar leading-relaxed"
                            placeholder='e.g., You are a search query optimizer. Extract the specific names, proper nouns, and primary search keywords from the user prompt. Always keep specific names and proper nouns intact. Output ONLY the optimized query terms without quotes, introduction, or explanation.'
                          />

                          {/* Autocomplete Dropdown */}
                          {acState.isOpen && acState.activeField === 'agentic' && renderAutocompleteDropdown()}
                        </div>
                      ) : (
                        <div
                          className="flex-1 w-full min-h-[200px] bg-[#011419] border border-gray-800 text-gray-200 text-sm rounded-md p-4 overflow-y-auto custom-scrollbar select-text leading-relaxed markdown-body"
                          dangerouslySetInnerHTML={{ __html: renderPromptPreview(agenticPrompt) }}
                        />
                      )}
                    </div>
                  )}

                  {/* Non-agentic placeholder */}
                  {!isAgentic && (
                    <div className="border border-dashed border-gray-800 rounded-xl p-10 flex flex-col items-center justify-center text-gray-600 opacity-60">
                      <Info className="w-8 h-8 mb-3" />
                      <span className="text-xs text-center max-w-md leading-relaxed">
                        When disabled, context injection will use a standard similarity search matching the user's raw message text directly against the vector database. Enable Agentic RAG above to customize query generation.
                      </span>
                    </div>
                  )}

                  {/* Save button card */}
                  <div className="flex items-center justify-between bg-[#0a161d] border border-gray-800/80 rounded-xl p-4 shrink-0">
                    <div className="flex items-center space-x-2">
                      {saveSuccess && (
                        <span className="text-xs text-green-400 font-bold uppercase tracking-wider animate-pulse flex items-center space-x-1">
                          <Check className="w-3.5 h-3.5 stroke-[3]" />
                          <span>Settings Saved successfully!</span>
                        </span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={handleSaveAgenticSettings}
                      disabled={savingAgenticSettings}
                      className="px-5 py-2 bg-accent text-[#011419] font-bold text-xs uppercase tracking-wider rounded transition-all hover:brightness-110 shadow-md flex items-center space-x-2 cursor-pointer disabled:opacity-50"
                    >
                      {savingAgenticSettings ? (
                        <>
                          <Loader className="w-3.5 h-3.5 animate-spin" />
                          <span>Saving...</span>
                        </>
                      ) : (
                        <>
                          <Save className="w-3.5 h-3.5" />
                          <span>Save Agentic RAG Settings</span>
                        </>
                      )}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
                {/* Search inputs */}
                <div className="shrink-0 flex items-center justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400 font-bold font-sans">
                      STORED KNOWLEDGE BLOCKS ({filteredBlocks.length})
                    </span>
                    <span className="flex flex-col gap-1 text-[10px] text-gray-500">
                      <span className="flex items-center gap-1.5" title="Always-on context is injected into every prompt.">
                        <span className="uppercase tracking-wider w-16">Always-on</span>
                        <TokenBadge tokens={tokenTotals.alwaysOn} />
                      </span>
                      <span className="flex items-center gap-1.5" title="Searchable knowledge is retrieved on demand, not injected into every prompt.">
                        <span className="uppercase tracking-wider w-16">Searchable</span>
                        <TokenBadge tokens={tokenTotals.searchable} />
                      </span>
                    </span>
                  </div>
                  <TextInput
                    placeholder="Search in content..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    icon={Search}
                    containerClassName="w-64"
                  />
                </div>

                {/* List of cards */}
                <div className="flex-1 overflow-y-auto custom-scrollbar pr-1 min-h-0">
                  {loading ? (
                    <div className="w-full h-full flex flex-col items-center justify-center text-gray-500 py-20">
                      <Loader className="w-8 h-8 animate-spin text-accent mb-2" />
                      <span className="text-xs">Loading Knowledge Base chunks...</span>
                    </div>
                  ) : filteredBlocks.length === 0 ? (
                    <EmptyState
                      icon={Database}
                      title="No knowledge blocks found"
                      subtitle="Upload document files or add manual snippets to populate the brain."
                    />
                  ) : (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pb-4">
                      {filteredBlocks.map((block) => (
                        <div
                          key={block.id}
                          onClick={() => {
                            if (block.type === 'rag_file') {
                              setViewingFileBlock(block);
                            }
                          }}
                          className={`bg-[#0a161d] border rounded-lg p-4 flex flex-col hover:shadow-lg transition-all group h-[180px] overflow-hidden ${
                            block.type === 'rag_file' ? 'cursor-pointer hover:border-blue-500/50' : ''
                          } ${selectedBlockIds.includes(block.id)
                            ? 'border-accent/40 bg-accent/5'
                            : 'border-gray-800/80 hover:border-gray-700'
                            }`}
                        >
                          {/* Card Header */}
                          <div className="flex justify-between items-start mb-2 shrink-0">
                            <div className="flex items-center space-x-2.5 overflow-hidden pr-2 flex-1">
                              {/* Selection Checkbox */}
                              {block.type !== 'rag_file' ? (
                                <div className="shrink-0 select-none" onClick={(e) => e.stopPropagation()}>
                                  <Checkbox
                                    checked={selectedBlockIds.includes(block.id)}
                                    onChange={() => handleToggleSelectBlock(block.id)}
                                    size="sm"
                                  />
                                </div>
                              ) : (
                                <div className="shrink-0 text-blue-400">
                                  <FileText className="w-4 h-4" />
                                </div>
                              )}
                              <Badge
                                tone={
                                  block.type === 'constant'
                                    ? 'amber'
                                    : block.type === 'manual'
                                    ? (block.strategy === 'constant' ? 'amber' : 'emerald')
                                    : block.type === 'rag_file'
                                    ? 'blue'
                                    : 'gray'
                                }
                                className="shrink-0"
                              >
                                {getBadgeLabel(block)}
                              </Badge>
                              <span className="text-[11px] text-gray-400 font-semibold truncate" title={block.source}>
                                {block.source}
                              </span>
                              <TokenBadge tokens={tokenOf(block)} className="shrink-0" />
                            </div>
                            <div className="flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" onClick={(e) => e.stopPropagation()}>
                              {block.type !== 'rag_file' && (
                                <button
                                  onClick={() => openEditor(block)}
                                  className="p-1 text-gray-500 hover:text-white hover:bg-white/5 rounded transition-colors cursor-pointer"
                                  title="Edit Block"
                                >
                                  <Edit3 className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <button
                                onClick={() => {
                                  if (block.type === 'rag_file') {
                                    setConfirmDialog({
                                      message: `Delete the Searchable File "${block.source}"? This erases all of its indexed chunks. To remove a single chunk instead, open the file block and delete the chunk from inside it.`,
                                      confirmLabel: "Delete Searchable File",
                                      onConfirm: () => handleDeleteEntireFile(block.source)
                                    });
                                  } else {
                                    handleDeleteBlock(block);
                                  }
                                }}
                                className="p-1 text-gray-500 hover:text-red-500 hover:bg-red-500/10 rounded transition-colors cursor-pointer"
                                title={block.type === 'rag_file' ? "Delete Searchable File" : "Delete Block"}
                              >
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </div>

                          {/* Card Content */}
                          <p className="text-[11px] text-gray-300 leading-relaxed font-mono mt-1 overflow-y-auto custom-scrollbar flex-1 whitespace-pre-wrap break-words select-text pr-1">
                            {block.text}
                          </p>

                          {/* Display tag chips */}
                          {block.keywords && block.keywords.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-2.5 select-none shrink-0">
                              {block.keywords.map((tag, tagIdx) => (
                                <Badge
                                  key={tagIdx}
                                  tone="accent"
                                >
                                  {tag}
                                </Badge>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>

          {/* Slide-out File Chunks Viewer Panel / Drawer overlay */}
          {viewingFileBlock && (
            <div className="absolute inset-y-0 right-0 w-[500px] bg-[#011419] border-l border-gray-800 shadow-2xl flex flex-col p-6 z-40 animate-in slide-in-from-right duration-200">
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
                  <X className="w-4 h-4" />
                </button>
              </div>

              {/* Chunks List */}
              <div className="flex-1 overflow-y-auto custom-scrollbar space-y-4 pr-1">
                {viewingFileBlock.chunks.map((chunk, idx) => (
                  <div key={chunk.id} className="bg-[#00080B] border border-gray-800/80 rounded-lg p-3 flex flex-col relative group/chunk">
                    <div className="flex justify-between items-center mb-2">
                      <span className="text-[9px] font-mono text-gray-500">
                        Chunk #{idx + 1} (~{(chunk.tokenCount || tokenMap[chunk.id] || 0).toLocaleString()} tokens)
                      </span>
                      <div className="flex space-x-1 opacity-0 group-hover/chunk:opacity-100 transition-opacity">
                        <button
                          onClick={() => {
                            openEditor(chunk);
                          }}
                          className="p-1 text-gray-500 hover:text-white hover:bg-white/5 rounded cursor-pointer"
                          title="Edit Chunk"
                        >
                          <Edit3 className="w-3 h-3" />
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
                                  const remainingBlocks = blocks.filter(b => b.id !== chunk.id);
                                  setBlocks(remainingBlocks);
                                  try {
                                    await electronAPI.saveProfileKbBlocks(profile.id, remainingBlocks);
                                    setViewingFileBlock(curr => ({
                                      ...curr,
                                      chunks: curr.chunks.filter(c => c.id !== chunk.id)
                                    }));
                                  } catch (err) {
                                    console.error("Error deleting chunk:", err);
                                    showToast("Failed to delete chunk.", "error");
                                    loadBlocks();
                                  }
                                }
                              }
                            });
                          }}
                          className="p-1 text-gray-500 hover:text-red-500 hover:bg-red-500/10 rounded cursor-pointer"
                          title="Delete Chunk"
                        >
                          <Trash2 className="w-3 h-3" />
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

          {/* Slide-out Editor Panel / Drawer overlay */}
          {editorOpen && (
            <div className="absolute inset-y-0 right-0 w-[420px] bg-[#011419] border-l border-gray-800 shadow-2xl flex flex-col p-6 z-40 animate-in slide-in-from-right duration-200">
              <div className="flex justify-between items-center mb-4 shrink-0 pb-2 border-b border-gray-800">
                <h3 className="text-xs font-bold text-accent uppercase tracking-widest">
                  {editingBlock ? 'Edit Memory Block' : 'Add Custom Memory'}
                </h3>
                <button
                  onClick={() => setEditorOpen(false)}
                  className="text-gray-400 hover:text-red-500 transition-colors cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 flex flex-col space-y-4 min-h-0">
                <TextInput
                  label="Title / Source"
                  value={editorTitle}
                  onChange={(e) => setEditorTitle(e.target.value)}
                  readOnly={editingBlock && editingBlock.type !== 'manual'}
                  placeholder="e.g. Lore Bible Rule #1"
                />
                {editingBlock && editingBlock.type !== 'manual' && (
                  <span className="caption mt-1 flex items-center space-x-1">
                    <Info className="w-3 h-3 text-gray-500" />
                    <span>Original file sources are read-only.</span>
                  </span>
                )}

                {(!editingBlock || editingBlock.type === 'manual') && (
                  <div>
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1.5">Storage Strategy</label>
                    <div className="flex space-x-2">
                      <button
                        type="button"
                        onClick={() => setEditorStrategy('rag_search')}
                        className={`flex-1 py-1.5 rounded-lg border text-xs font-bold transition-all flex flex-col items-center justify-center space-y-0.5 cursor-pointer ${
                          editorStrategy === 'rag_search'
                            ? 'bg-[#3b82f6]/20 border-[#3b82f6] text-[#3b82f6] shadow-[0_0_12px_rgba(59,130,246,0.2)]'
                            : 'bg-[#00080B] border-gray-850 text-gray-500 hover:text-gray-300 hover:border-gray-700'
                        }`}
                      >
                        <span>Searchable (RAG)</span>
                        <span className="text-[8px] font-normal opacity-70">Indexed for vector searches</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setEditorStrategy('constant')}
                        className={`flex-1 py-1.5 rounded-lg border text-xs font-bold transition-all flex flex-col items-center justify-center space-y-0.5 cursor-pointer ${
                          editorStrategy === 'constant'
                            ? 'bg-[#FBCB2D]/20 border-[#FBCB2D] text-[#FBCB2D] shadow-[0_0_12px_rgba(251,203,45,0.2)]'
                            : 'bg-[#00080B] border-gray-850 text-gray-500 hover:text-gray-300 hover:border-gray-700'
                        }`}
                      >
                        <span>Constant (Injected)</span>
                        <span className="text-[8px] font-normal opacity-70">Always in AI prompt context</span>
                      </button>
                    </div>
                  </div>
                )}

                <Textarea
                  ref={editorTextareaRef}
                  label="Memory Text Content"
                  value={editorText}
                  onChange={(e) => setEditorText(e.target.value)}
                  placeholder="Type raw knowledge data here..."
                  monospace
                  className="flex-1 min-h-[150px]"
                />

                {(!editingBlock || editingBlock.type === 'manual') && (
                  <div className="flex flex-col space-y-1.5 shrink-0">
                    <label className="block text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">Tags (Categorization)</label>

                    {/* Current Tags Chips */}
                    {editorKeywords.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 mb-1 p-2 bg-[#00080B] border border-gray-800/80 rounded-md">
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
                              <X className="w-3 h-3" />
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
                          disabled={savingEditor}
                        />

                        {/* Suggestions Dropdown */}
                        {tagSuggestionsOpen && (
                          (() => {
                            const allTags = Array.from(new Set(
                              blocks.filter(b => b.type === 'manual').flatMap(b => b.keywords || b.rawItem?.keywords || [])
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
                        disabled={savingEditor || !tagInput.trim()}
                        className="px-3.5 py-2 bg-accent hover:brightness-110 disabled:opacity-40 text-[#011419] text-xs font-bold rounded-md transition-all cursor-pointer flex items-center justify-center"
                      >
                        <Plus className="w-4 h-4 stroke-[2.5]" />
                      </button>
                    </div>
                  </div>
                )}

                {editorError && (
                  <p className="text-[10px] text-red-400 font-semibold px-1">{editorError}</p>
                )}
              </div>

              <div className="shrink-0 flex justify-end space-x-2.5 pt-4 border-t border-gray-800 mt-4">
                <button
                  onClick={() => setEditorOpen(false)}
                  className="px-3.5 py-1.5 text-xs text-gray-400 hover:text-white transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSaveEditor}
                  disabled={savingEditor}
                  className="flex items-center space-x-1.5 px-4 py-1.5 bg-accent text-[#011419] rounded font-bold text-xs hover:brightness-110 transition-colors shadow cursor-pointer disabled:opacity-50"
                >
                  {savingEditor ? (
                    <>
                      <Loader className="w-3.5 h-3.5 animate-spin" />
                      <span>Processing...</span>
                    </>
                  ) : (
                    <>
                      <Save className="w-3.5 h-3.5" />
                      <span>Save Memory</span>
                    </>
                  )}
                </button>
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
                className="text-[10px] font-bold text-gray-400 hover:text-white uppercase tracking-wider cursor-pointer font-sans"
              >
                Select All
              </button>
              <button
                onClick={handleClearSelection}
                className="text-[10px] font-bold text-gray-400 hover:text-white uppercase tracking-wider cursor-pointer font-sans"
              >
                Clear
              </button>
              <button
                onClick={() => setIsBulkDeleteConfirmOpen(true)}
                className="px-3 py-1.5 bg-red-650 hover:bg-red-650/80 text-white text-[10px] font-bold uppercase tracking-wider rounded-lg transition-colors cursor-pointer flex items-center space-x-1.5 shadow-md shadow-red-950/20"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
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
