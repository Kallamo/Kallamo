import React, { useState, useRef, useEffect } from 'react';
import { Database, Plus, Trash2, Search, Check, ChevronDown, FileText, Info, X as XIcon, Download, Upload, MapPin, CircleHelp, FileSearch, NotebookPen, Orbit, Pin, Tag, UserRound, UsersRound, Loader2, Pencil, History, ListChecks, RefreshCw, Sparkles } from 'lucide-react';
import { DragonIcon, MoneybagIcon, PennantIcon, StopwatchIcon } from './ui/glyphs';

// Entity type -> icon, mirroring the Worldbuild view so a candidate reads the same here.
const ENTITY_TYPE_ICON = {
  Characters: UserRound, Locations: MapPin, Items: MoneybagIcon, Races: UsersRound,
  Factions: PennantIcon, Creatures: DragonIcon, Events: StopwatchIcon, System: Orbit,
};
const entityTypeIcon = (t) => ENTITY_TYPE_ICON[t] || CircleHelp;
import { useApp } from '../context/AppContext';
import ImportProgressModal from './modals/ImportProgressModal';
import { parseMarkdown } from '../utils/markdown';
import ConfirmDialog from './ui/ConfirmDialog';
import TextInput from './ui/TextInput';
import Textarea from './ui/Textarea';
import Checkbox from './ui/Checkbox';
import Toggle from './ui/Toggle';
import RenameFilesModal from './ui/RenameFilesModal';
import Popover from './ui/Popover';
import CoachMark from './ui/CoachMark';
import Button from './ui/Button';
import Modal from './ui/Modal';
import IconButton from './ui/IconButton';
import ItemTile from './ui/ItemTile';
import StatusDot from './ui/StatusDot';
import TagChip from './ui/TagChip';
import CollapsibleSection from './ui/CollapsibleSection';
import ProfileScopeButton from './ui/ProfileScopeButton';
import SelectionBar from './ui/SelectionBar';
import { Menu, MenuItem, MenuNote, MenuSeparator } from './ui/Menu';
import { formatTokens } from './ui/TokenBadge';
import MemoryRow from '../features/memory-view/MemoryRow';
import SummaryLogModal from '../features/memory-view/SummaryLogModal';

export default function ChatMemoryView({
  chat,
  onSaveChat,
  electronAPI,
  backgroundImage = null,
  hasBackdrop = false
}) {
  const { writingProfiles, settings, refreshChats, showToast, uiFlags, dismissHint, openSettings } = useApp();
  const worldIndexRef = useRef(null);
  const [activeFilter, setActiveFilter] = useState('all'); // 'all' | 'always' | 'searchable' | 'history'
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
  const [worldIndexStatuses, setWorldIndexStatuses] = useState({});
  const [tagSelection, setTagSelection] = useState(null);
  const [tagSelectionBlocks, setTagSelectionBlocks] = useState([]);
  const [tagSelectionIds, setTagSelectionIds] = useState([]);
  const [tagSelectionLoading, setTagSelectionLoading] = useState(false);
  const [tagSelectionSearch, setTagSelectionSearch] = useState('');
  const [indexMenu, setIndexMenu] = useState(null); // which tier's variant menu is open
  const [memoryTags, setMemoryTags] = useState({}); // { [chunkId]: ["Canonical Name", ...] }
  const customIdxRef = useRef(null);
  const archiveIdxRef = useRef(null);
  const searchableIdxRef = useRef(null);
  const indexTiers = [
    { key: 'custom', label: 'Custom memory', ref: customIdxRef },
    { key: 'archive', label: 'Chat archive', ref: archiveIdxRef },
    { key: 'searchable', label: 'Searchable files', ref: searchableIdxRef },
  ];

  const loadMemoryTags = async () => {
    if (!chat?.id || typeof electronAPI?.getChatMemoryTags !== 'function') return;
    try {
      const res = await electronAPI.getChatMemoryTags(chat.id);
      if (res?.success) setMemoryTags(res.tags || {});
    } catch (e) { /* markers stay empty on failure */ }
  };

  // full=false tags only untagged chunks; full=true drops the tier's tags and re-tags.
  const handleIndexMemories = async (tier, full) => {
    if (typeof electronAPI?.startWorldIndexTagging !== 'function') {
      showToast('Tagging unavailable. Fully restart the app (close and reopen Electron).', 'error');
      return;
    }
    setIndexMenu(null);
    try {
      const res = await electronAPI.startWorldIndexTagging(chat.id, { tier, full });
      if (!res?.success) {
        if (res?.status) setWorldIndexStatuses(prev => ({ ...prev, [tier]: res.status }));
        return;
      }
      if (res.started) showToast(`${full ? 'Re-tagging' : 'Tagging'} started. You can leave this screen and return to its live progress.`, 'success');
      if (res.status) setWorldIndexStatuses(prev => ({ ...prev, [tier]: res.status }));
    } catch (e) {
      showToast(`Tagging failed to start: ${e.message}`, 'error');
    }
  };

  const [editorError, setEditorError] = useState('');

  const [editorKeywords, setEditorKeywords] = useState([]);
  // Entity (blue) tags on the block being edited: [{ entity, name, type }]. The
  // "original" snapshot lets save send only the delta (added/removed) it must apply.
  const [editorEntityTags, setEditorEntityTags] = useState([]);
  const [editorEntityTagsOriginal, setEditorEntityTagsOriginal] = useState([]);
  // Live entity matches for what's being typed, shown inside the same suggestion
  // window as the keyword suggestions: [{ id, canonicalName, type, matchedAlias }].
  const [entityCandidates, setEntityCandidates] = useState([]);
  const [tagInput, setTagInput] = useState('');
  const [tagSuggestionsOpen, setTagSuggestionsOpen] = useState(false);
  const tagAnchorRef = useRef(null);
  const addDropdownAnchorRef = useRef(null);
  const [editorStrategy, setEditorStrategy] = useState('rag_search');
  const [editorProfiles, setEditorProfiles] = useState([]);
  const [simOpen, setSimOpen] = useState(true);
  const [viewingFileBlock, setViewingFileBlock] = useState(null);
  const [viewingTextBlock, setViewingTextBlock] = useState(null);

  // Per-chunk tags in the file chunk viewer: { [chunkId]: { keywords, entities } }.
  const [fileChunkTags, setFileChunkTags] = useState({});
  // Which chunk's add-tag input is open, plus its typing state (only one at a time).
  const [activeTagChunk, setActiveTagChunk] = useState(null);
  const [chunkTagInput, setChunkTagInput] = useState('');
  const [chunkEntityCandidates, setChunkEntityCandidates] = useState([]);
  const chunkTagAnchorRef = useRef(null);
  const [fileTagSummary, setFileTagSummary] = useState({ chunks: 0, tags: [] });
  const [bulkTagInput, setBulkTagInput] = useState('');
  const [bulkEntityCandidates, setBulkEntityCandidates] = useState([]);
  const [bulkTagBusy, setBulkTagBusy] = useState(false);
  const bulkTagAnchorRef = useRef(null);

  const loadFileChunkTags = async () => {
    if (!chat?.id || typeof electronAPI?.getChatKbTags !== 'function') return;
    try {
      const res = await electronAPI.getChatKbTags(chat.id);
      if (res?.success) setFileChunkTags(res.tags || {});
    } catch (e) { /* tags stay empty on failure */ }
  };

  const loadFileTagSummary = async (source = viewingFileBlock?.source) => {
    if (!chat?.id || !source || typeof electronAPI?.getSearchableFileTagSummary !== 'function') return;
    const res = await electronAPI.getSearchableFileTagSummary(chat.id, source);
    if (res?.success) setFileTagSummary({ chunks: res.chunks || 0, tags: res.tags || [] });
  };

  const refreshBulkEntityCandidates = async (text) => {
    const query = String(text || '').trim();
    if (query.length < 2 || typeof electronAPI?.findEntityCandidates !== 'function') {
      setBulkEntityCandidates([]);
      return;
    }
    try {
      const workspaceId = chat?.id;
      const res = await electronAPI.findEntityCandidates(workspaceId, query);
      setBulkEntityCandidates(res?.success ? (res.candidates || []) : []);
    } catch (e) { setBulkEntityCandidates([]); }
  };

  const applyFileTag = async (action, kind, value, label) => {
    if (!viewingFileBlock || !value || bulkTagBusy) return;
    const run = async () => {
      setBulkTagBusy(true);
      try {
        const res = await electronAPI.applySearchableFileTag(chat.id, viewingFileBlock.source, action, kind, value);
        if (!res?.success) throw new Error(res?.error || 'Unknown error');
        showToast(`${action === 'add' ? 'Applied' : 'Removed'} ${label} across ${fileTagSummary.chunks} chunk(s).`, 'success');
        setBulkTagInput('');
        setBulkEntityCandidates([]);
        await Promise.all([loadFileChunkTags(), loadFileTagSummary()]);
      } catch (e) {
        showToast(`Failed to update tags: ${e.message}`, 'error');
      } finally { setBulkTagBusy(false); }
    };
    if (action === 'remove') {
      setConfirmDialog({
        message: `Remove ${label} from every chunk in this searchable file? This also suppresses automatic entity tags so they do not return on a future World Index re-tag.`,
        confirmLabel: 'Remove from all',
        onConfirm: run,
      });
    } else await run();
  };

  // `only` preselects one item (from its row menu) instead of everything still untagged.
  const openTagSelection = async (tier, only = null) => {
    if (typeof electronAPI?.getWorldIndexTaggableChunks !== 'function') return;
    setTagSelection(tier);
    setTagSelectionBlocks([]);
    setTagSelectionIds([]);
    setTagSelectionSearch('');
    setTagSelectionLoading(true);
    try {
      const res = await electronAPI.getWorldIndexTaggableChunks(chat.id, tier);
      if (!res?.success) throw new Error(res?.error || 'Unknown error');
      const chunks = res.chunks || [];
      const blocks = tier === 'searchable'
        ? Object.values(chunks.reduce((groups, chunk) => {
          const key = chunk.source || 'Untitled Searchable File';
          const group = groups[key] || { id: key, title: key, excerpt: chunk.text, chunkIds: [], complete: true };
          group.chunkIds.push(chunk.id);
          group.complete = group.complete && chunk.worldIndexStatus === 'completed';
          groups[key] = group;
          return groups;
        }, {}))
        : chunks.map(chunk => ({ id: chunk.id, title: chunk.source || 'Custom Memory', excerpt: chunk.text, chunkIds: [chunk.id], complete: chunk.worldIndexStatus === 'completed' }));
      setTagSelectionBlocks(blocks);
      setTagSelectionIds(only
        ? blocks.filter(block => block.id === only.id || block.title === only.title).map(block => block.id)
        : blocks.filter(block => !block.complete).map(block => block.id));
    } catch (e) {
      showToast(`Failed to load chunks: ${e.message}`, 'error');
      setTagSelection(null);
    } finally { setTagSelectionLoading(false); }
  };

  const startSelectedTagging = async () => {
    if (!tagSelection || !tagSelectionIds.length) return;
    const chunkIds = tagSelectionBlocks.filter(block => tagSelectionIds.includes(block.id)).flatMap(block => block.chunkIds);
    try {
      const res = await electronAPI.startWorldIndexTagging(chat.id, { tier: tagSelection, full: true, chunkIds });
      if (!res?.success) {
        if (res?.status) setWorldIndexStatuses(prev => ({ ...prev, [tagSelection]: res.status }));
        return;
      }
      if (res.status) setWorldIndexStatuses(prev => ({ ...prev, [tagSelection]: res.status }));
      setTagSelection(null);
      showToast(`Tagging ${tagSelectionIds.length} selected block(s).`, 'success');
    } catch (e) {
      showToast(`Tagging failed to start: ${e.message}`, 'error');
    }
  };

  // Persist a chunk's full tag state, then refresh from source of truth.
  const persistChunkTags = async (chunkId, next) => {
    setFileChunkTags(prev => ({ ...prev, [chunkId]: next }));
    try {
      await electronAPI.setChunkTags(chunkId, next.keywords, next.entities.map(e => e.entity));
    } catch (e) {
      console.error('Failed to save chunk tags:', e);
      showToast('Failed to save tags.', 'error');
      loadFileChunkTags();
    }
  };

  const chunkTagsOf = (chunkOrId) => {
    const chunk = typeof chunkOrId === 'object' ? chunkOrId : null;
    const chunkId = chunk?.id || chunkOrId;
    return fileChunkTags[chunkId] || chunk?.tags || { keywords: [], entities: [] };
  };

  const addChunkKeyword = (chunkId, text) => {
    const raw = String(text || '').trim().toLowerCase();
    if (!raw) return;
    const kw = raw.startsWith('#') ? raw : `#${raw}`;
    const cur = chunkTagsOf(chunkId);
    if (cur.keywords.includes(kw)) return;
    persistChunkTags(chunkId, { ...cur, keywords: [...cur.keywords, kw] });
    setChunkTagInput('');
    setChunkEntityCandidates([]);
  };

  const addChunkEntity = (chunkId, candidate) => {
    const cur = chunkTagsOf(chunkId);
    if (cur.entities.some(e => e.entity === candidate.id)) return;
    persistChunkTags(chunkId, { ...cur, entities: [...cur.entities, { value: candidate.canonicalName, entity: candidate.id }] });
    setChunkTagInput('');
    setChunkEntityCandidates([]);
  };

  const removeChunkKeyword = (chunkId, kw) => {
    const cur = chunkTagsOf(chunkId);
    persistChunkTags(chunkId, { ...cur, keywords: cur.keywords.filter(k => k !== kw) });
  };

  const removeChunkEntity = (chunkId, entityId) => {
    const cur = chunkTagsOf(chunkId);
    persistChunkTags(chunkId, { ...cur, entities: cur.entities.filter(e => e.entity !== entityId) });
  };

  const refreshChunkEntityCandidates = async (text) => {
    const q = String(text || '').trim();
    if (q.length < 2 || typeof electronAPI?.findEntityCandidates !== 'function') { setChunkEntityCandidates([]); return; }
    try {
      const res = await electronAPI.findEntityCandidates(chat?.id || null, q);
      setChunkEntityCandidates(res?.success ? (res.candidates || []) : []);
    } catch (e) { setChunkEntityCandidates([]); }
  };

  // Add the typed text as a plain keyword (yellow). User territory only.
  const addKeywordTag = (text) => {
    const rawTag = String(text || '').trim().toLowerCase();
    if (!rawTag) return;
    const normalizedTag = rawTag.startsWith('#') ? rawTag : `#${rawTag}`;
    setEditorKeywords(prev => prev.includes(normalizedTag) ? prev : [...prev, normalizedTag]);
    setTagInput('');
    setEntityCandidates([]);
    setTagSuggestionsOpen(false);
  };

  // Link an entity as a blue tag (dedup by entity id), picked from the suggestion list.
  const addEntityTag = (candidate) => {
    setEditorEntityTags(prev => prev.some(t => t.entity === candidate.id)
      ? prev
      : [...prev, { entity: candidate.id, name: candidate.canonicalName, type: candidate.type }]);
    setTagInput('');
    setEntityCandidates([]);
    setTagSuggestionsOpen(false);
  };

  // Enter / the + button commits the typed text as a keyword. Entities are added by
  // clicking their row in the suggestion window (we never link one on our own).
  const handleAddTag = () => {
    if (!tagInput.trim()) return;
    addKeywordTag(tagInput.trim());
  };

  // As the user types, ask the registry for matching entities to surface in the list.
  const refreshEntityCandidates = async (text) => {
    const q = String(text || '').trim();
    if (q.length < 2 || typeof electronAPI?.findEntityCandidates !== 'function') {
      setEntityCandidates([]);
      return;
    }
    try {
      const res = await electronAPI.findEntityCandidates(chat?.id || null, q);
      setEntityCandidates(res?.success ? (res.candidates || []) : []);
    } catch (e) { setEntityCandidates([]); }
  };

  const [blocks, setBlocks] = useState([]);
  const [loading, setLoading] = useState(true);

  const [selectedBlockIds, setSelectedBlockIds] = useState([]);
  const [isBulkDeleteConfirmOpen, setIsBulkDeleteConfirmOpen] = useState(false);

  const [isProcessing, setIsProcessing] = useState(false);
  const [progressMsg, setProgressMsg] = useState('');
  const [progressDetail, setProgressDetail] = useState(null); // { fileName, current, total }

  const [simQuery, setSimQuery] = useState('');
  const [simResults, setSimResults] = useState(null);
  const [simLoading, setSimLoading] = useState(false);

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
          strategy: b.strategy || b.rawItem.strategy || 'rag_search',
          enabled: b.enabled !== false
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
    loadMemoryTags();
    if (!chat?.id || !electronAPI?.getWorldIndexStatus) return;
    Promise.all(indexTiers.map(async ({ key }) => {
      const res = await electronAPI.getWorldIndexStatus(chat.id, key);
      // Failure counts are session feedback. Once the user leaves this workspace,
      // show the pending chunks normally rather than reviving an old provider message.
      return [key, res?.status ? { ...res.status, failed: 0 } : null];
    })).then(entries => setWorldIndexStatuses(Object.fromEntries(entries.filter(([, status]) => status))));
  }, [chat?.id]);

  useEffect(() => {
    if (!chat?.id || !electronAPI?.onWorldIndexTaggingProgress) return;
    return electronAPI.onWorldIndexTaggingProgress((data) => {
      if (data.chatId !== chat.id || !data.status) return;
      setWorldIndexStatuses(prev => ({ ...prev, [data.tier]: data.status }));
      if (!data.status.active && data.status.latest?.status !== 'running') {
        loadMemoryTags();
        loadFileChunkTags();
      }
    });
  }, [chat?.id, electronAPI]);

  useEffect(() => {
    setSelectedBlockIds([]);
  }, [activeFilter]);

  useEffect(() => {
    if (viewingFileBlock) {
      loadFileChunkTags();
      loadFileTagSummary(viewingFileBlock.source);
    }
    setActiveTagChunk(null);
    setChunkTagInput('');
    setChunkEntityCandidates([]);
    setBulkTagInput('');
    setBulkEntityCandidates([]);
  }, [viewingFileBlock?.source]);

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

  // The chat row stores both registries as JSON text, so every read has to accept a string
  // as readily as an already-parsed value.
  const kbFiles = chat?.knowledgeFiles
    ? (typeof chat.knowledgeFiles === 'string' ? JSON.parse(chat.knowledgeFiles) : chat.knowledgeFiles)
    : [];

  const memoryBlocks = chat?.memoryBlocks
    ? (typeof chat.memoryBlocks === 'string' ? JSON.parse(chat.memoryBlocks) : chat.memoryBlocks)
    : [];

  // History summaries are the memory blocks nobody wrote by hand.
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
        enabled: chunks.every(c => c.enabled !== false),
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

  // Weighed by stored history (counted in the main process), not recap length.
  const summarySignature = summaryBlocks.map(b => b.id).join('|');
  useEffect(() => {
    if (summaryBlocks.length === 0 || !electronAPI?.getArchiveTokenTotals || !chat?.id) {
      setSummaryTokens({});
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const result = await electronAPI.getArchiveTokenTotals(chat.id);
        if (cancelled || !result?.success) return;
        const map = {};
        Object.entries(result.totals || {}).forEach(([blockId, entry]) => {
          map[blockId] = entry.tokens || 0;
        });
        setSummaryTokens(map);
      } catch (e) { /* leave counts at 0 on failure */ }
    })();
    return () => { cancelled = true; };
  }, [summarySignature, chat?.id]);

  // Notes arrive as 'snippet' blocks, so their mode comes from the strategy they were saved with.
  const blockMode = (b) => {
    if (b.type === 'summarized') return 'history';
    if (b.type === 'constant') return 'always';
    if (b.type === 'snippet' && (b.strategy === 'constant' || b.rawItem?.strategy === 'constant')) return 'always';
    return 'searchable';
  };

  // Always-on context is what every prompt carries; switched-off items cost nothing.
  const tokenTotals = React.useMemo(() => {
    const totals = { always: 0, searchable: 0, history: 0 };
    combinedBlocks.forEach(b => {
      if (b.enabled === false) return;
      totals[blockMode(b)] += b.tokenCount || 0;
    });
    return totals;
  }, [combinedBlocks]);

  const searchMatches = combinedBlocks.filter(b => {
    const query = searchQuery.toLowerCase();
    const titleMatch = (b.title || b.source || '').toLowerCase().includes(query);
    const summaryMatch = (b.summary || b.text || '').toLowerCase().includes(query);
    const chunksMatch = b.type === 'rag_file' && b.chunks.some(c => c.text.toLowerCase().includes(query));
    return titleMatch || summaryMatch || chunksMatch;
  });
  const filteredBlocks = searchMatches.filter(b => activeFilter === 'all' || blockMode(b) === activeFilter);
  const modeCounts = combinedBlocks.reduce((counts, b) => ({ ...counts, [blockMode(b)]: counts[blockMode(b)] + 1 }), { always: 0, searchable: 0, history: 0 });

  const activeProfileIds = chat?.activeProfiles
    ? (typeof chat.activeProfiles === 'string' ? JSON.parse(chat.activeProfiles) : chat.activeProfiles)
    : [];
  const chatProfiles = writingProfiles.filter(p => activeProfileIds.includes(p.id));

  // Collapsed sections are remembered per chat, next to the rest of its layout state.
  const [collapsedSections, setCollapsedSections] = useState({});
  useEffect(() => {
    setCollapsedSections({});
    if (!chat?.id || !electronAPI?.getWorkspaceUiState) return;
    let active = true;
    electronAPI.getWorkspaceUiState(chat.id, 'memory-sections')
      .then(state => { if (active && state?.value?.collapsed) setCollapsedSections(state.value.collapsed); })
      .catch(() => {});
    return () => { active = false; };
  }, [chat?.id]);
  const toggleSection = (mode, open) => {
    const next = { ...collapsedSections, [mode]: !open };
    setCollapsedSections(next);
    electronAPI?.setWorkspaceUiState?.(chat.id, 'memory-sections', { collapsed: next });
  };

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
        const targetBlock = blocks.find(b => b.id === block.id);
        if (targetBlock) {
          const newList = targetBlock.profiles.includes(profileId) ? targetBlock.profiles.filter(id => id !== profileId) : [...targetBlock.profiles, profileId];
          const result = await electronAPI.setChatKbBlockProfiles(chat.id, targetBlock.id, newList);
          if (!result?.success) throw new Error(result?.error || 'Unable to update memory scope.');
          setBlocks(prev => prev.map(item => item.id === targetBlock.id ? { ...item, profiles: newList } : item));
        }
        await refreshChats(chat.id);
      }
    } catch (err) {
      console.error("Error setting profile scoping:", err);
      showToast('Failed to update memory scope.', 'error');
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
      setSelectedBlockIds(prev => prev.filter(id => id !== deleteTarget.id));
      setDeleteTarget(null);
      // Deleting a summary hands its messages back to the live context, so the
      // chat record has to be re-read for the token bar to tell the truth.
      await refreshChats(chat.id);
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

  // Enable/disable a memory unit. OFF = ignored by injection/retrieval and dropped
  // from the token counter. Non-destructive, the content stays put.
  const handleToggleEnabled = async (block, nextEnabled) => {
    setBlocks(prev => prev.map(b => {
      if (block.type === 'rag_file') {
        return b.type === 'rag' && b.source === block.source ? { ...b, enabled: nextEnabled } : b;
      }
      return b.id === block.id ? { ...b, enabled: nextEnabled } : b;
    }));
    try {
      await electronAPI.toggleChatKbBlockEnabled(chat.id, block, nextEnabled);
    } catch (e) {
      console.error("Failed to toggle chat memory block:", e);
      showToast("Failed to update memory switch.", "error");
      loadBlocks();
    }
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

      // The file lives in three places: on disk with its chunks, in the chat row's JSON
      // registry, and in the current selection. Missing one leaves the UI offering a ghost.
      await electronAPI.deleteChatKbFile(chat.id, fileName);

      const updatedKbFiles = kbFiles.filter(f => f.name.toLowerCase() !== fileName.toLowerCase());
      await onSaveChat({
        ...chat,
        knowledgeFiles: JSON.stringify(updatedKbFiles)
      });

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
      await refreshChats(chat.id);
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
    const origIds = new Set(editorEntityTagsOriginal.map(t => t.entity));
    const curIds = new Set(editorEntityTags.map(t => t.entity));
    const entityTagsAdded = [...curIds].filter(id => !origIds.has(id));
    const entityTagsRemoved = [...origIds].filter(id => !curIds.has(id));
    try {
      if (editingBlock) {
        // --- EDITING EXISTING BLOCK ---
        await electronAPI.saveChatKbBlock(chat.id, {
          id: editingBlock.id,
          type: editingBlock.type === 'snippet' ? 'manual' : editingBlock.type,
          source: editorTitle.trim() || editingBlock.source,
          text: editorText.trim(),
          profiles: editorProfiles,
          keywords: editorKeywords,
          entityTagsAdded,
          entityTagsRemoved,
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
                strategy: editorStrategy,
                manuallyEdited: c.type === 'rag' || editingBlock.type === 'rag' ? true : c.manuallyEdited
              } : c)
            };
          });
        }
      } else {
        // --- ADDING NEW CUSTOM SNIPPET ---
        const title = editorTitle.trim() || 'Untitled note';
        const text = editorText.trim();
        const snippetId = `manual_${Date.now()}`;

        await electronAPI.saveChatKbBlock(chat.id, {
          id: snippetId,
          type: 'manual',
          source: title,
          text: text,
          profiles: editorProfiles,
          keywords: editorKeywords,
          entityTagsAdded,
          entityTagsRemoved,
          strategy: editorStrategy
        });
      }
      setEditorOpen(false);
      setEditingBlock(null);
      // Refresh the chat prop so its memoryBlocks stays in sync with the DB.
      // Otherwise a later rename/scope edit could write back a stale copy.
      await refreshChats(chat.id);
      loadBlocks();
      loadMemoryTags();
    } catch (err) {
      console.error("Error saving block editor:", err);
      setEditorError("Error saving block: " + (err.message || err));
    } finally {
      setSavingSnippet(false);
    }
  };

  const openSnippetEditor = (block) => {
    setEditingBlock(block);
    setEditorTitle(block.title);
    setEditorText(block.summary);
    setEditorKeywords(block.keywords || []);
    const entityTags = (memoryTags[block.id] || [])
      .filter(tag => tag.entity)
      .map(tag => ({ entity: tag.entity, name: tag.value }));
    setEditorEntityTags(entityTags);
    setEditorEntityTagsOriginal(entityTags);
    setEntityCandidates([]);
    setEditorStrategy(block.strategy || 'rag_search');
    setEditorProfiles(block.profiles || []);
    setTagInput('');
    setEditorError('');
    setEditorOpen(true);
  };

  const openMemoryBlock = (block) => {
    if (block.type === 'rag_file') setViewingFileBlock(block);
    else if (block.type === 'summarized') setSelectedSummaryBlock(block);
    else if (block.type === 'snippet') openSnippetEditor(block);
    else setViewingTextBlock(block);
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

  // A note changes mode by saving it again with the other strategy; the main process re-indexes it.
  const handleMoveSnippet = async (block, strategy) => {
    try {
      await electronAPI.saveChatKbBlock(chat.id, {
        id: block.id,
        type: 'manual',
        source: block.title,
        text: block.summary,
        profiles: block.profiles || [],
        keywords: block.keywords || [],
        entityTagsAdded: [],
        entityTagsRemoved: [],
        strategy
      });
      await refreshChats(chat.id);
      loadBlocks();
      showToast(`Moved to ${strategy === 'constant' ? 'Always on' : 'Searchable'}.`, 'success');
    } catch (err) {
      console.error('Error moving memory note:', err);
      showToast('Failed to move the note.', 'error');
    }
  };

  const fileKind = (name = '') => (name.split('.').pop() || '').toUpperCase();
  const chunkCount = (n) => `${n} chunk${n === 1 ? '' : 's'}`;
  const blockKindLabel = (block) => {
    if (block.type === 'snippet') return 'Custom note';
    if (block.type === 'summarized') return 'Summary';
    return fileKind(block.source) ? `${fileKind(block.source)} file` : 'File';
  };

  const MODES = {
    always: { title: 'Always on', description: 'Sent with every prompt', icon: Pin, toneClass: 'text-mode-always', dot: 'bg-mode-always' },
    searchable: { title: 'Searchable', description: 'Retrieved when relevant', icon: Search, toneClass: 'text-mode-searchable', dot: 'bg-mode-searchable' },
    history: { title: 'History', description: 'Earlier conversation, archived and searchable', icon: History, toneClass: 'text-mode-history', dot: 'bg-mode-history' },
  };
  const firstLine = (text) => String(text || '').replace(/[#*_>`]/g, '').replace(/\s+/g, ' ').trim().slice(0, 180);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  const sectionTotal = (mode) => mode === 'always'
    ? <>{formatTokens(tokenTotals.always)} tok <span className="text-text-subtle">of {formatTokens(chat?.maxContext || 128000)}</span></>
    : `${formatTokens(tokenTotals[mode])} tok`;

  const rowTags = (block) => {
    const keywords = (block.keywords || []).map(label => ({ label, variant: 'keyword' }));
    const entities = (block.type === 'snippet' ? memoryTags[block.id] || [] : [])
      .map(tag => ({ label: tag.value, variant: tag.entity ? 'entity' : 'keyword' }));
    return [...entities, ...keywords];
  };

  const requestDeleteFile = (block) => {
    const chunks = block.type === 'rag_file' ? block.chunks.length : 0;
    setConfirmDialog({
      title: 'Delete file?',
      message: chunks
        ? `"${block.source}" and its ${plural(chunks, 'searchable chunk', 'searchable chunks')} will be removed. This cannot be undone.`
        : `"${block.source}" will be removed from this chat's memory. This cannot be undone.`,
      confirmLabel: 'Delete file',
      onConfirm: () => handleDeleteEntireFile(block.source),
    });
  };

  const renderRow = (block) => {
    const mode = blockMode(block);
    if (block.type === 'summarized') {
      return (
        <MemoryRow
          key={block.id}
          icon={History}
          tone="history"
          title={block.title}
          meta="Summary"
          preview={firstLine(block.summary)}
          tokens={formatTokens(block.tokenCount || 0)}
          onOpen={() => openMemoryBlock(block)}
        />
      );
    }
    const isNote = block.type === 'snippet';
    const isSearchFile = block.type === 'rag_file';
    const target = mode === 'always' ? 'searchable' : 'always';
    const menuItems = [
      isNote
        ? { icon: Pencil, label: 'Edit note', onSelect: () => openSnippetEditor(block) }
        : isSearchFile
          ? { icon: ListChecks, label: 'View chunks', onSelect: () => setViewingFileBlock(block) }
          : { icon: FileText, label: 'View content', onSelect: () => setViewingTextBlock(block) },
      {
        icon: target === 'always' ? Pin : Search,
        iconClassName: MODES[target].toneClass,
        label: `Move to ${MODES[target].title}`,
        description: target === 'always' ? `Adds ${formatTokens(block.tokenCount || 0)} tok to every prompt` : undefined,
        onSelect: () => (isNote ? handleMoveSnippet(block, target === 'always' ? 'constant' : 'rag_search') : handleToggleIngestion(block)),
      },
      // World Index only reads indexed chunks, so always-on items have nothing to tag.
      ...(mode === 'searchable'
        ? [{ icon: Tag, label: 'Tag with World Index', onSelect: () => openTagSelection(isNote ? 'custom' : 'searchable', { id: isNote ? block.id : block.source, title: block.title }) }]
        : []),
      'separator',
      { icon: Trash2, label: isNote ? 'Delete note' : 'Delete file', danger: true, onSelect: () => (isNote ? setDeleteTarget(block) : requestDeleteFile(block)) },
    ];
    return (
      <MemoryRow
        key={block.id}
        icon={isNote ? Pencil : FileText}
        tone={mode}
        title={block.title}
        meta={isNote ? 'Custom note' : isSearchFile ? `${fileKind(block.source) || 'File'} · ${chunkCount(block.chunks.length)}` : blockKindLabel(block)}
        preview={isNote ? firstLine(block.summary) : null}
        tokens={formatTokens(block.tokenCount || 0)}
        tags={rowTags(block)}
        enabled={block.enabled !== false}
        onOpen={() => openMemoryBlock(block)}
        onToggleEnabled={(next) => handleToggleEnabled(block, next)}
        selectable
        selected={selectedBlockIds.includes(block.id)}
        selectionActive={selectedBlockIds.length > 0}
        onToggleSelect={() => handleToggleSelectBlock(block.id)}
        profiles={chatProfiles}
        profileIds={block.profiles || []}
        onToggleProfile={(profileId) => handleToggleProfileScope(block, profileId)}
        menuItems={menuItems}
      />
    );
  };

  const tierState = (status) => {
    if (status?.active) return { tone: 'running', text: `Tagging ${status.active.processed || 0}/${status.active.total || 0}`, className: 'text-text-secondary' };
    if (status?.failed) return { tone: 'error', text: `${status.failed} need${status.failed === 1 ? 's' : ''} another try`, className: 'text-status-danger' };
    if (status?.pending) return { tone: 'pending', text: `${status.pending} to tag`, className: 'text-text-secondary' };
    if (status?.total) return { tone: 'ok', text: 'Up to date', className: 'text-text-subtle' };
    return { tone: 'idle', text: 'Nothing to tag', className: 'text-text-subtle' };
  };

  const openChunkEditor = (chunk) => {
    setEditingBlock(chunk);
    setEditorTitle(chunk.source);
    setEditorText(chunk.text);
    setEditorKeywords(chunk.keywords || []);
    setEditorEntityTags([]);
    setEditorEntityTagsOriginal([]);
    setEntityCandidates([]);
    setEditorStrategy(chunk.strategy || 'rag_search');
    setEditorProfiles(chunk.profiles || []);
    setTagInput('');
    setEditorError('');
    setEditorOpen(true);
  };

  const requestDeleteChunk = (chunk, index) => {
    const onlyChunk = viewingFileBlock?.chunks.length === 1;
    setConfirmDialog({
      title: `Delete chunk ${index + 1}?`,
      message: onlyChunk
        ? `It is the only chunk in "${viewingFileBlock.source}", so the whole file is removed with it. This cannot be undone.`
        : `It is removed from "${viewingFileBlock?.source}". The other chunks stay.`,
      confirmLabel: onlyChunk ? 'Delete file' : 'Delete chunk',
      onConfirm: async () => {
        if (onlyChunk) {
          await handleDeleteEntireFile(viewingFileBlock.source);
          setViewingFileBlock(null);
          return;
        }
        try {
          await electronAPI.deleteChatKbBlock(chat.id, {
            id: chunk.id,
            type: chunk.type === 'snippet' ? 'manual' : chunk.type,
            source: chunk.source,
            text: chunk.text
          });
          await loadBlocks();
        } catch (err) {
          console.error("Error deleting chunk:", err);
          showToast("Failed to delete chunk.", "error");
        }
      }
    });
  };

  const sectionLabel = 'text-[0.6875rem] font-semibold uppercase tracking-[0.08em] text-text-subtle';
  const visibleModes = ['always', 'searchable', 'history'].filter(mode => activeFilter === 'all' || activeFilter === mode);
  const noteEditor = !editingBlock || editingBlock.type === 'snippet';
  const viewingFile = viewingFileBlock ? (groupedBlocks.find(b => b.type === 'rag_file' && b.source === viewingFileBlock.source) || viewingFileBlock) : null;
  const simProfile = writingProfiles.find(p => p.id === simProfileId);
  const simHasResults = simResults && (simResults.kbResults.length > 0 || simResults.memoryResults.length > 0 || (simResults.profileResults || []).length > 0);
  const tagSelectionNoun = tagSelection === 'custom' ? ['note', 'notes'] : ['file', 'files'];
  const selectedTagChunks = tagSelectionBlocks.filter(block => tagSelectionIds.includes(block.id)).reduce((sum, block) => sum + block.chunkIds.length, 0);

  const resultCard = (res, i, tone, Icon) => (
    <div key={`${tone}_${i}`} className="flex flex-col gap-2 rounded-card border border-border-subtle glass-panel p-3">
      <div className="flex items-center gap-2">
        <Icon className={`h-3.5 w-3.5 shrink-0 ${MODES[tone]?.toneClass || 'text-text-muted'}`} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-xs font-semibold text-text-primary">{res.source}</span>
        <span className="h-1 w-10 shrink-0 overflow-hidden rounded-full bg-surface-hover" aria-hidden="true">
          <span className={`block h-full ${MODES[tone]?.dot || 'bg-text-muted'}`} style={{ width: `${Math.max(0, Math.min(1, res.score)) * 100}%` }} />
        </span>
        <span className="shrink-0 font-mono text-[0.6875rem] text-text-muted">{res.score.toFixed(2)}</span>
      </div>
      <p className="line-clamp-3 text-xs leading-relaxed text-text-secondary">{res.text}</p>
    </div>
  );

  return (
    <div className={`flex-1 flex flex-col md:flex-row h-full overflow-hidden select-none ${hasBackdrop ? 'has-backdrop' : ''}`}>

      {/* Main Memory List Pane */}
      <div className="relative flex-1 flex flex-col h-full min-w-0 overflow-hidden">
        <div className="shrink-0 flex flex-col gap-5 px-6 pt-6">
          <div className="flex min-w-0 flex-wrap items-end justify-between gap-x-6 gap-y-3">
            <div className="min-w-[16rem] flex-1">
              <h2 className="text-xl font-semibold tracking-tight text-text-primary">Memory &amp; Knowledge</h2>
              <p className="mt-1 max-w-2xl text-sm text-text-muted">What the AI always carries, what it looks up when relevant, and what it remembers from earlier.</p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <TextInput
                icon={Search}
                value={searchQuery}
                onChange={(event) => setSearchQuery(event.target.value)}
                placeholder="Search memory"
                aria-label="Search memory"
                containerClassName="w-60"
              />
              <Button variant="ghost" icon={Download} onClick={handleExportChatKb} title="Export this chat's memory as a KB package">Export</Button>
              <div ref={addDropdownAnchorRef}>
                <Button icon={Plus} onClick={() => setAddDropdownOpen(!addDropdownOpen)} aria-expanded={addDropdownOpen} aria-haspopup="menu">
                  Add <ChevronDown className={`h-3.5 w-3.5 transition-transform ${addDropdownOpen ? 'rotate-180' : ''}`} />
                </Button>
              </div>
              <Menu anchorRef={addDropdownAnchorRef} open={addDropdownOpen} onClose={() => setAddDropdownOpen(false)} label="Add memory" className="w-80">
                <MenuItem
                  icon={NotebookPen}
                  label="Write a note"
                  description="Custom memory. You choose always on or searchable."
                  onSelect={() => {
                    setAddDropdownOpen(false);
                    setEditingBlock(null);
                    setEditorTitle('');
                    setEditorText('');
                    setEditorKeywords([]);
                    setEditorEntityTags([]);
                    setEditorEntityTagsOriginal([]);
                    setEntityCandidates([]);
                    setEditorProfiles([]);
                    setEditorStrategy('rag_search');
                    setTagInput('');
                    setEditorError('');
                    setEditorOpen(true);
                  }}
                />
                <MenuItem
                  icon={FileSearch}
                  iconClassName="text-mode-searchable"
                  label="Upload searchable file"
                  description="Retrieved when relevant. PDF, DOCX, TXT or MD."
                  onSelect={() => { setAddDropdownOpen(false); setUploadStrategy('rag_search'); fileInputRef.current?.click(); }}
                />
                <MenuItem
                  icon={Pin}
                  iconClassName="text-mode-always"
                  label="Upload always-on file"
                  description="Sent with every prompt. Counts against context."
                  onSelect={() => { setAddDropdownOpen(false); setUploadStrategy('full_context'); fileInputRef.current?.click(); }}
                />
                <MenuSeparator />
                <MenuItem
                  icon={Upload}
                  label="Import KB package"
                  description="Notes and files from an Export."
                  onSelect={() => { setAddDropdownOpen(false); handleImportChatKb(); }}
                />
              </Menu>
            </div>
          </div>

          <div role="tablist" aria-label="Memory mode" className="flex items-center gap-0.5 border-b border-border-subtle pb-2.5">
            {[
              ['all', 'All', null, combinedBlocks.length],
              ['always', MODES.always.title, MODES.always.dot, modeCounts.always],
              ['searchable', MODES.searchable.title, MODES.searchable.dot, modeCounts.searchable],
              ['history', MODES.history.title, MODES.history.dot, modeCounts.history],
            ].map(([value, label, dot, count]) => {
              const selected = activeFilter === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="tab"
                  aria-selected={selected}
                  onClick={() => setActiveFilter(value)}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-sm font-medium transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                    selected ? 'bg-surface-hover text-text-primary' : 'text-text-muted hover:bg-tint/[0.03] hover:text-text-primary'
                  }`}
                >
                  {dot && <span className={`h-[0.4375rem] w-[0.4375rem] rounded-full ${dot}`} aria-hidden="true" />}
                  {label}
                  <span className="text-xs text-text-subtle tabular-nums">{count}</span>
                </button>
              );
            })}
          </div>

          <input type="file" ref={fileInputRef} multiple accept=".pdf,.docx,.txt,.md" onChange={handleDirectFileUpload} className="hidden" />

          {(isProcessing || progressMsg) && (
            <div className="flex flex-col gap-2 rounded-card border border-border-subtle glass-panel px-3.5 py-2.5">
              <div className="flex items-center gap-2 text-sm text-text-secondary">
                {isProcessing && <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-accent" aria-hidden="true" />}
                <span className="min-w-0 flex-1 truncate">{progressMsg || 'Working…'}</span>
                {progressDetail && <span className="shrink-0 text-xs text-text-muted tabular-nums">{progressDetail.current} / {progressDetail.total} chunks</span>}
              </div>
              {progressDetail && (
                <div className="h-1 overflow-hidden rounded-full bg-surface-hover">
                  <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${Math.round((progressDetail.current / Math.max(1, progressDetail.total)) * 100)}%` }} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Memory sections */}
        <div className="flex-1 overflow-y-auto custom-scrollbar px-6 pb-24 pt-4">
          {loading ? (
            <div className="overflow-hidden rounded-card border border-border-subtle glass-panel" aria-label="Loading memory">
              {[70, 55, 62].map(width => (
                <div key={width} className="flex items-center gap-3 border-t border-border-subtle px-4 py-3 first:border-t-0">
                  <span className="h-8 w-8 rounded-lg bg-surface-hover animate-pulse" />
                  <span className="flex flex-1 flex-col gap-2">
                    <span className="h-2.5 rounded bg-surface-hover animate-pulse" style={{ width: `${width}%` }} />
                    <span className="h-2 rounded bg-surface-hover/60 animate-pulse" style={{ width: `${width - 25}%` }} />
                  </span>
                </div>
              ))}
            </div>
          ) : combinedBlocks.length === 0 ? (
            <div className="flex flex-col items-center gap-2.5 rounded-card border border-border-subtle glass-panel px-6 py-10 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-control bg-tint/5"><Database className="h-5 w-5 text-text-muted" /></span>
              <span className="text-[0.9375rem] font-semibold text-text-primary">No memory yet</span>
              <span className="max-w-xs text-sm leading-relaxed text-text-muted">Write a note or upload a file. Summaries appear here as the chat grows.</span>
              <Button icon={Plus} onClick={() => setAddDropdownOpen(true)} className="mt-1">Add</Button>
            </div>
          ) : filteredBlocks.length === 0 && searchQuery ? (
            <div className="rounded-card border border-border-subtle glass-panel px-4 py-3.5 text-sm text-text-muted">
              No memory matches "<span className="text-text-primary">{searchQuery}</span>".{' '}
              <button type="button" onClick={() => setSearchQuery('')} className="font-semibold text-text-secondary hover:text-text-primary cursor-pointer">Clear search</button>
            </div>
          ) : (
            <div className="flex flex-col gap-3.5">
              {visibleModes.map(mode => {
                const items = filteredBlocks.filter(block => blockMode(block) === mode);
                if (searchQuery && items.length === 0) return null;
                const open = Boolean(searchQuery) || !collapsedSections[mode];
                return (
                  <CollapsibleSection
                    key={mode}
                    icon={MODES[mode].icon}
                    title={MODES[mode].title}
                    description={MODES[mode].description}
                    toneClass={MODES[mode].toneClass}
                    total={sectionTotal(mode)}
                    count={mode === 'history' ? plural(modeCounts.history, 'summary', 'summaries') : plural(modeCounts[mode], 'item', 'items')}
                    open={open}
                    onToggle={(next) => toggleSection(mode, next)}
                  >
                    {items.length > 0
                      ? items.map(renderRow)
                      : <p className="border-t border-border-subtle px-4 py-3 text-sm text-text-subtle">{mode === 'history' ? 'Nothing archived yet.' : 'Nothing here yet.'}</p>}
                  </CollapsibleSection>
                );
              })}
            </div>
          )}
        </div>

        <SelectionBar
          count={selectedBlockIds.length}
          onSelectAll={handleSelectAll}
          onClear={handleClearSelection}
          onDelete={() => setIsBulkDeleteConfirmOpen(true)}
        />
      </div>

      {/* Side panel */}
      <aside className="glass-rail w-full md:w-80 shrink-0 border-l border-border-subtle flex flex-col gap-8 overflow-y-auto custom-scrollbar px-6 py-7">
        <section className="flex flex-col gap-2.5">
          <span ref={worldIndexRef} className={`self-start ${sectionLabel}`}>World index</span>
          <CoachMark
            anchorRef={worldIndexRef}
            open={!uiFlags.memoryWorldIndexSeen}
            onDismiss={() => dismissHint('memoryWorldIndexSeen')}
            title="Tag your memories"
            align="left"
          >
            Index a tier to attach dynamic tags (characters, factions, items) to its chunks, so the AI recalls them by name during a chat.
          </CoachMark>
          <p className="text-sm leading-relaxed text-text-muted">Tags memories by character, faction and item so the AI can recall them by name.</p>
          <div className="mt-1 flex flex-col border-b border-border-subtle">
            {indexTiers.map(t => {
              const status = worldIndexStatuses[t.key];
              const state = tierState(status);
              const canChoose = t.key === 'custom' || t.key === 'searchable';
              return (
                <div key={t.key} ref={t.ref}>
                  <button
                    type="button"
                    onClick={() => setIndexMenu(indexMenu === t.key ? null : t.key)}
                    disabled={Boolean(status?.active)}
                    aria-haspopup="menu"
                    aria-expanded={indexMenu === t.key}
                    title="World Index reads chunks that are already searchable and adds retrieval tags. It does not vectorize or change the text."
                    className={`-mx-2 flex w-[calc(100%+1rem)] items-center gap-2.5 rounded-lg border-t border-border-subtle px-2 py-2.5 text-left text-sm text-text-primary transition-colors cursor-pointer hover:bg-surface-hover/60 disabled:cursor-default disabled:hover:bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${indexMenu === t.key ? 'bg-surface-hover' : ''}`}
                  >
                    <StatusDot tone={state.tone} />
                    <span className="flex-1 truncate">{t.label}</span>
                    <span className={`shrink-0 text-xs ${state.className}`}>{state.text}</span>
                    <ChevronDown className={`h-3.5 w-3.5 shrink-0 text-text-subtle transition-transform ${indexMenu === t.key ? 'rotate-180' : ''}`} aria-hidden="true" />
                  </button>
                  <Menu anchorRef={t.ref} open={indexMenu === t.key} onClose={() => setIndexMenu(null)} label={`${t.label} tagging`} align="right" className="w-72">
                    <MenuItem
                      icon={Tag}
                      label={status?.pending ? `Tag new chunks · ${status.pending}` : 'Tag new chunks'}
                      description="Only chunks the index hasn't read yet."
                      onSelect={() => handleIndexMemories(t.key, false)}
                    />
                    <MenuItem
                      icon={RefreshCw}
                      label="Re-tag all chunks"
                      description="Rebuilds automatic tags. Manual tags and suppressions stay."
                      onSelect={() => handleIndexMemories(t.key, true)}
                    />
                    {canChoose && (
                      <MenuItem
                        icon={ListChecks}
                        label={t.key === 'custom' ? 'Choose notes to tag…' : 'Choose files to tag…'}
                        description={`Every chunk inside each chosen ${t.key === 'custom' ? 'note' : 'file'} is tagged.`}
                        onSelect={() => { setIndexMenu(null); openTagSelection(t.key); }}
                      />
                    )}
                    <MenuSeparator />
                    <MenuNote>Tagging reads text that is already searchable. It never changes or re-vectorizes it.</MenuNote>
                  </Menu>
                </div>
              );
            })}
          </div>
        </section>

        <section className="flex flex-col gap-3">
          <button
            type="button"
            onClick={() => setSimOpen(open => !open)}
            aria-expanded={simOpen}
            className="flex items-center justify-between rounded cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <span className={sectionLabel}>Retrieval test</span>
            <ChevronDown className={`h-4 w-4 text-text-subtle transition-transform ${simOpen ? '' : '-rotate-90'}`} aria-hidden="true" />
          </button>
          {simOpen && (
            <>
              <p className="text-sm leading-relaxed text-text-muted">See which memories a prompt would pull in.</p>
              <label className="flex flex-col gap-1.5 text-xs font-medium text-text-muted">
                Profile
                <select
                  value={simProfileId}
                  onChange={(e) => setSimProfileId(e.target.value)}
                  className="field-input h-9 px-3 text-sm cursor-pointer"
                >
                  <option value="">No profile (standard retrieval)</option>
                  {chatProfiles.map(p => (
                    <option key={p.id} value={p.id}>{p.name}{p.isAgentic === 1 ? ' · Agentic' : ''}</option>
                  ))}
                </select>
              </label>
              {simProfile?.isAgentic === 1 && (
                <p className="flex gap-1.5 text-xs leading-snug text-text-muted">
                  <Sparkles className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  This profile rewrites the prompt before searching. It costs a few tokens.
                </p>
              )}
              <label className="flex flex-col gap-1.5 text-xs font-medium text-text-muted">
                Prompt
                <textarea
                  value={simQuery}
                  onChange={(e) => setSimQuery(e.target.value)}
                  placeholder="Who is the innkeeper?"
                  className="field-input h-20 resize-none px-3 py-2.5 text-sm select-text"
                />
              </label>
              <Button variant="ghost" fullWidth loading={simLoading} disabled={!simQuery.trim()} onClick={handleTestSearch}>Run test</Button>

              {simResults && !simHasResults && (
                <div className="flex flex-col gap-1 rounded-card border border-dashed border-border-default px-3.5 py-3">
                  <span className="text-sm font-semibold text-text-primary">Nothing found</span>
                  <span className="text-xs leading-relaxed text-text-muted">No memory scored above the threshold for this prompt. Try the names or places you expect it to find.</span>
                </div>
              )}
              {simHasResults && (
                <div className="flex flex-col gap-2.5 select-text">
                  {simResults.isAgenticApplied && (
                    <div className="flex flex-col gap-0.5 rounded-control border border-border-subtle bg-tint/[0.03] px-3 py-2.5">
                      <span className="text-xs text-text-subtle">Searched as</span>
                      <span className="text-sm text-text-primary">"{simResults.searchQuery}"</span>
                    </div>
                  )}
                  <span className="mt-1 text-xs font-semibold text-text-secondary">This chat · {simResults.kbResults.length + simResults.memoryResults.length}</span>
                  {simResults.kbResults.length + simResults.memoryResults.length === 0
                    ? <p className="text-xs text-text-subtle">No matching notes or files.</p>
                    : [
                      ...simResults.kbResults.map((res, i) => resultCard(res, i, 'searchable', FileText)),
                      ...simResults.memoryResults.map((res, i) => resultCard(res, i, 'history', History)),
                    ]}
                  {simProfileId && (
                    <>
                      <span className="mt-1 text-xs font-semibold text-text-secondary">{simProfile?.name || 'Profile'} memory · {(simResults.profileResults || []).length}</span>
                      {(simResults.profileResults || []).length === 0
                        ? <p className="text-xs text-text-subtle">Nothing above the threshold.</p>
                        : simResults.profileResults.map((res, i) => resultCard(res, i, 'profile', UserRound))}
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      </aside>

      {/* Note and chunk editor */}
      {editorOpen && (
        <Modal onClose={() => !savingSnippet && setEditorOpen(false)} size="wide" showClose={false} closeOnOverlay={false} className="h-[85vh] max-h-[44rem] !bg-surface-panel">
          <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle py-4 pl-6 pr-4">
            <ItemTile icon={noteEditor ? Pencil : FileText} tone={noteEditor ? (editorStrategy === 'constant' ? 'always' : 'searchable') : 'searchable'} size="lg" />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-base font-semibold text-text-primary">{noteEditor ? (editingBlock ? 'Edit note' : 'New note') : 'Edit chunk'}</h2>
              <p className="truncate text-xs text-text-muted">
                {noteEditor
                  ? `Custom memory · ${editorStrategy === 'constant' ? 'Always on' : 'Searchable'}${editingBlock?.tokenCount ? ` · ${formatTokens(editingBlock.tokenCount)} tok` : ''}`
                  : editingBlock?.source}
              </p>
            </div>
            <IconButton icon={XIcon} label="Close editor" size="sm" onClick={() => setEditorOpen(false)} disabled={savingSnippet} />
          </div>

          <div className="flex min-h-0 flex-1 overflow-hidden">
            <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto custom-scrollbar p-6">
              {noteEditor ? (
                <TextInput
                  label="Title"
                  value={editorTitle}
                  onChange={(e) => setEditorTitle(e.target.value)}
                  placeholder="e.g. Character sheet"
                  disabled={savingSnippet}
                />
              ) : (
                <div className="flex items-start gap-2 rounded-control border border-border-subtle bg-tint/[0.03] px-3 py-2.5">
                  <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-text-subtle" aria-hidden="true" />
                  <span className="text-xs leading-relaxed text-text-muted">This chunk comes from a file, so its title and mode follow the file. Your edit is marked as manual and survives re-indexing.</span>
                </div>
              )}
              <Textarea
                label="Content"
                value={editorText}
                onChange={(e) => setEditorText(e.target.value)}
                placeholder="Anything the AI should know: a character sheet, rules, a timeline…"
                disabled={savingSnippet}
                monospace={noteEditor}
                containerClassName="min-h-0 flex-1"
                className="h-full min-h-40 select-text"
                hint={`${editorText.length.toLocaleString()} characters`}
              />
              {!noteEditor && (
                <p className="text-xs text-text-subtle">Tags for this chunk are managed on its card in the file view.</p>
              )}
            </div>

            {noteEditor && (
              <div className="flex w-80 shrink-0 flex-col gap-6 overflow-y-auto custom-scrollbar border-l border-border-subtle bg-surface-panel-muted p-5">
                <div role="radiogroup" aria-label="Mode" className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-text-secondary">Mode</span>
                  {[['constant', 'always'], ['rag_search', 'searchable']].map(([strategy, mode]) => {
                    const selected = editorStrategy === strategy;
                    const ModeIcon = MODES[mode].icon;
                    return (
                      <button
                        key={strategy}
                        type="button"
                        role="radio"
                        aria-checked={selected}
                        onClick={() => setEditorStrategy(strategy)}
                        className={`flex w-full items-start gap-2.5 rounded-control border px-3 py-2.5 text-left transition-colors cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                          selected
                            ? mode === 'always' ? 'border-mode-always bg-mode-always/10' : 'border-mode-searchable bg-mode-searchable/10'
                            : 'border-border-default hover:bg-surface-hover/60'
                        }`}
                      >
                        <ModeIcon className={`mt-0.5 h-4 w-4 shrink-0 ${selected ? MODES[mode].toneClass : 'text-text-subtle'}`} aria-hidden="true" />
                        <span>
                          <span className="block text-sm font-semibold text-text-primary">{MODES[mode].title}</span>
                          <span className="text-xs text-text-muted">{MODES[mode].description}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>

                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-text-secondary">Available to</span>
                  <ProfileScopeButton
                    profiles={chatProfiles}
                    selectedIds={editorProfiles}
                    onToggle={(profileId) => setEditorProfiles(prev => prev.includes(profileId) ? prev.filter(id => id !== profileId) : [...prev, profileId])}
                    fullWidth
                  />
                </div>

                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-text-secondary">Tags</span>
                  <div ref={tagAnchorRef} className="field-input flex min-h-10 flex-wrap items-center gap-1.5 px-2 py-1.5">
                    {editorEntityTags.map((t, idx) => (
                      <TagChip
                        key={`ent_${t.entity}`}
                        label={t.name}
                        variant="entity"
                        icon={t.type ? entityTypeIcon(t.type) : Tag}
                        onRemove={() => setEditorEntityTags(prev => prev.filter((_, i) => i !== idx))}
                        disabled={savingSnippet}
                      />
                    ))}
                    {editorKeywords.map((tag, idx) => (
                      <TagChip
                        key={`kw_${tag}`}
                        label={tag}
                        onRemove={() => setEditorKeywords(prev => prev.filter((_, i) => i !== idx))}
                        disabled={savingSnippet}
                      />
                    ))}
                    <input
                      type="text"
                      value={tagInput}
                      onChange={(e) => {
                        const v = e.target.value;
                        setTagInput(v);
                        setTagSuggestionsOpen(true);
                        refreshEntityCandidates(v);
                      }}
                      onFocus={() => setTagSuggestionsOpen(true)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleAddTag();
                        }
                      }}
                      placeholder="Add a tag…"
                      aria-label="Add a tag"
                      disabled={savingSnippet}
                      className="min-w-[6rem] flex-1 bg-transparent px-1 py-0.5 text-sm text-text-primary placeholder:text-text-subtle focus:outline-none"
                    />
                  </div>
                  <span className="text-xs text-text-subtle">Pick a world entity, or type a keyword and press Enter.</span>
                  {(() => {
                    const allTags = Array.from(new Set(
                      combinedBlocks.filter(b => b.type === 'snippet').flatMap(b => b.keywords || [])
                    )).filter(t => t && !editorKeywords.includes(t));
                    const filteredSuggestions = allTags.filter(t => t.toLowerCase().includes(tagInput.toLowerCase()));
                    const entityMatches = entityCandidates.filter(c => !editorEntityTags.some(t => t.entity === c.id));
                    const hasContent = entityMatches.length > 0 || filteredSuggestions.length > 0;
                    return (
                      <Popover anchorRef={tagAnchorRef} open={tagSuggestionsOpen && hasContent} onClose={() => setTagSuggestionsOpen(false)} maxHeight={240}>
                        {entityMatches.length > 0 && <div className="px-3 pb-1 pt-1.5 text-xs font-semibold text-text-subtle">World entities</div>}
                        {entityMatches.map((c) => {
                          const Icon = entityTypeIcon(c.type);
                          return (
                            <button
                              key={c.id}
                              type="button"
                              onClick={() => addEntityTag(c)}
                              className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm text-text-primary hover:bg-surface-hover cursor-pointer"
                            >
                              <Icon className="h-3.5 w-3.5 shrink-0 text-status-info" />
                              <span className="truncate">{c.canonicalName}</span>
                              {c.matchedAlias && <span className="truncate text-xs text-text-subtle">alias: {c.matchedAlias}</span>}
                              <span className="ml-auto shrink-0 text-xs text-text-subtle">{c.type}</span>
                            </button>
                          );
                        })}
                        {entityMatches.length > 0 && filteredSuggestions.length > 0 && <div className="mx-1 my-1 h-px bg-border-subtle" />}
                        {filteredSuggestions.map((tag) => (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => addKeywordTag(tag)}
                            className="w-full rounded-lg px-3 py-1.5 text-left text-sm text-text-secondary hover:bg-surface-hover hover:text-text-primary cursor-pointer"
                          >
                            {tag}
                          </button>
                        ))}
                      </Popover>
                    );
                  })()}
                </div>

                <div className="flex flex-col gap-2">
                  <span className="text-sm font-medium text-text-secondary">Found by World Index</span>
                  {editingBlock && (memoryTags[editingBlock.id] || []).length > 0 ? (
                    <div className="flex flex-wrap gap-1.5">
                      {memoryTags[editingBlock.id].map((t, i) => <TagChip key={i} label={t.value} variant={t.entity ? 'entity' : 'keyword'} />)}
                    </div>
                  ) : (
                    <span className="text-xs leading-relaxed text-text-subtle">Nothing yet. Tag custom memory from the World Index panel.</span>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2 border-t border-border-subtle py-3.5 pl-6 pr-4">
            {editingBlock && (
              <Button
                variant="subtle"
                icon={Trash2}
                className="!text-status-danger hover:!bg-status-danger/10"
                disabled={savingSnippet}
                onClick={() => {
                  const target = editingBlock;
                  setEditorOpen(false);
                  if (noteEditor) setDeleteTarget(target);
                  else {
                    const index = viewingFileBlock?.chunks.findIndex(c => c.id === target.id) ?? 0;
                    requestDeleteChunk(target, Math.max(0, index));
                  }
                }}
              >
                {noteEditor ? 'Delete note' : 'Delete chunk'}
              </Button>
            )}
            <span className="flex-1" />
            {editorError && <span className="mr-2 text-xs font-semibold text-status-danger">{editorError}</span>}
            <Button variant="ghost" disabled={savingSnippet} onClick={() => setEditorOpen(false)}>Cancel</Button>
            <Button loading={savingSnippet} onClick={handleSaveSnippet}>Save</Button>
          </div>
        </Modal>
      )}

      {/* Note delete confirmation */}
      {deleteTarget && (
        <ConfirmDialog
          tone="danger"
          title={deleteTarget.type === 'snippet' ? 'Delete note?' : deleteTarget.type === 'summarized' ? 'Delete summary?' : 'Delete block?'}
          message={deleteTarget.type === 'rag' || deleteTarget.type === 'constant'
            ? `"${deleteTarget.title}" belongs to the file "${deleteTarget.source}". Delete only this block, or the whole file and all its chunks.`
            : `"${deleteTarget.title}" and its search data will be removed. This cannot be undone.`}
          actions={deleteTarget.type === 'rag' || deleteTarget.type === 'constant'
            ? [
              { label: 'Cancel', variant: 'ghost', onClick: () => setDeleteTarget(null) },
              { label: 'Delete whole file', variant: 'ghost', onClick: () => handleDeleteEntireFile(deleteTarget.source) },
              { label: 'Delete only this block', variant: 'danger', autoFocus: true, onClick: handleDeleteTarget },
            ]
            : [
              { label: 'Cancel', variant: 'ghost', onClick: () => setDeleteTarget(null) },
              { label: deleteTarget.type === 'snippet' ? 'Delete note' : 'Delete', variant: 'danger', autoFocus: true, onClick: handleDeleteTarget },
            ]}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {isBulkDeleteConfirmOpen && (() => {
        const names = combinedBlocks.filter(b => selectedBlockIds.includes(b.id)).map(b => b.title);
        const shown = names.slice(0, 3).map(name => `"${name}"`).join(', ');
        return (
          <ConfirmDialog
            tone="danger"
            title={`Delete ${plural(names.length, 'item', 'items')}?`}
            message={`${shown}${names.length > 3 ? ` and ${names.length - 3} more` : ''}, with all their chunks. This cannot be undone.`}
            actions={[
              { label: 'Cancel', variant: 'ghost', onClick: () => setIsBulkDeleteConfirmOpen(false) },
              { label: `Delete ${plural(names.length, 'item', 'items')}`, variant: 'danger', autoFocus: true, onClick: handleBulkDelete },
            ]}
            onClose={() => setIsBulkDeleteConfirmOpen(false)}
          />
        );
      })()}

      {selectedSummaryBlock && (
        <SummaryLogModal
          block={selectedSummaryBlock}
          chatId={chat?.id}
          electronAPI={electronAPI}
          backgroundImage={backgroundImage}
          onClose={() => setSelectedSummaryBlock(null)}
        />
      )}

      {viewingTextBlock && (
        <Modal onClose={() => setViewingTextBlock(null)} size="wide" showClose={false} className="max-h-[80vh] !bg-surface-panel">
          <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle py-4 pl-6 pr-4">
            <ItemTile icon={FileText} tone={blockMode(viewingTextBlock)} size="lg" />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-base font-semibold text-text-primary">{viewingTextBlock.title}</h2>
              <p className="text-xs text-text-muted">{blockKindLabel(viewingTextBlock)} · {MODES[blockMode(viewingTextBlock)].title}</p>
            </div>
            <IconButton icon={XIcon} label="Close" size="sm" onClick={() => setViewingTextBlock(null)} />
          </div>
          <div className="overflow-y-auto custom-scrollbar p-6">
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-text-secondary select-text">{viewingTextBlock.summary}</p>
          </div>
        </Modal>
      )}

      {/* File chunks */}
      {viewingFile && (
        <Modal onClose={() => setViewingFileBlock(null)} size="wide" showClose={false} className="h-[85vh] !bg-surface-panel">
          <div className="flex shrink-0 items-center gap-3 border-b border-border-subtle py-4 pl-6 pr-4">
            <ItemTile icon={FileText} tone="searchable" size="lg" />
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-base font-semibold text-text-primary" title={viewingFile.source}>{viewingFile.source}</h2>
              <p className="text-xs text-text-muted">Searchable · {chunkCount(viewingFile.chunks.length)} · {formatTokens(viewingFile.tokenCount || 0)} tok</p>
            </div>
            <ProfileScopeButton profiles={chatProfiles} selectedIds={viewingFile.profiles || []} onToggle={(profileId) => handleToggleProfileScope(viewingFile, profileId)} />
            <IconButton icon={XIcon} label="Close file" size="sm" onClick={() => setViewingFileBlock(null)} />
          </div>

          <div className="flex shrink-0 flex-col gap-2.5 border-b border-border-subtle bg-surface-panel-muted px-6 py-4">
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-text-secondary">Tags on this file</span>
              <span className="text-xs text-text-subtle">Applies to every chunk at once.</span>
              <span data-tooltip="Removing an automatic entity tag creates a persistent suppression, so World Index will not add it back during a future re-tag." className="inline-flex text-text-subtle hover:text-text-primary cursor-help">
                <Info className="h-3.5 w-3.5" />
              </span>
            </div>
            <div className="flex max-h-20 flex-wrap gap-1.5 overflow-y-auto custom-scrollbar pr-1">
              {fileTagSummary.tags.length === 0
                ? <span className="text-sm text-text-subtle">No tags in this file yet.</span>
                : fileTagSummary.tags.map((tag) => (
                  <TagChip
                    key={`${tag.tag}_${tag.entity || 'keyword'}_${tag.manual}`}
                    label={tag.value || tag.tag}
                    variant={tag.entity ? 'entity' : 'keyword'}
                    count={`${tag.count}/${fileTagSummary.chunks}`}
                    disabled={bulkTagBusy}
                    removeLabel={`Remove ${tag.value || tag.tag} from this file`}
                    onRemove={() => applyFileTag('remove', tag.entity ? 'entity' : 'keyword', tag.entity || tag.tag, tag.value || tag.tag)}
                  />
                ))}
            </div>
            <div className="relative flex items-center gap-2" ref={bulkTagAnchorRef}>
              <input
                value={bulkTagInput}
                name="fast-tag"
                autoComplete="off"
                aria-label="Tag to add to every chunk"
                onChange={(e) => { setBulkTagInput(e.target.value); refreshBulkEntityCandidates(e.target.value); }}
                onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyFileTag('add', 'keyword', bulkTagInput, `#${bulkTagInput.replace(/^#/, '')}`); } }}
                placeholder="Add a keyword to every chunk, or pick an entity…"
                className="field-input h-9 flex-1 px-3 text-sm"
              />
              <Button variant="ghost" size="sm" disabled={!bulkTagInput.trim() || bulkTagBusy} onClick={() => applyFileTag('add', 'keyword', bulkTagInput, `#${bulkTagInput.replace(/^#/, '')}`)}>Add to all</Button>
              <Popover anchorRef={bulkTagAnchorRef} open={bulkEntityCandidates.length > 0} onClose={() => setBulkEntityCandidates([])} maxHeight={160}>
                <div className="px-3 pb-1 pt-2 text-xs font-semibold text-text-subtle">World entities</div>
                {bulkEntityCandidates.map((entity) => (
                  <button key={entity.id} type="button" onMouseDown={(e) => { e.preventDefault(); applyFileTag('add', 'entity', entity.id, entity.canonicalName); }} className="w-full rounded-lg px-3 py-2 text-left text-sm text-text-primary hover:bg-surface-hover cursor-pointer">
                    Add {entity.canonicalName} to every chunk
                  </button>
                ))}
              </Popover>
            </div>
          </div>

          <div className="flex flex-1 flex-col gap-3 overflow-y-auto custom-scrollbar px-6 py-5">
            {viewingFile.chunks.map((chunk, idx) => {
              const cTags = chunkTagsOf(chunk);
              const isTagInputActive = activeTagChunk === chunk.id;
              return (
                <div key={chunk.id} className="group/chunk flex flex-col gap-2.5 rounded-card border border-border-subtle bg-surface-panel-muted px-4 py-3.5 hover:border-border-default">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold text-text-primary">Chunk {idx + 1}</span>
                    <span className="text-xs text-text-subtle tabular-nums">{chunk.text.length.toLocaleString()} chars</span>
                    {chunk.manuallyEdited && (
                      <span className="inline-flex h-5 items-center gap-1 rounded-full border border-status-warning/30 bg-status-warning/10 px-2 text-[0.6875rem] font-semibold text-status-warning" title="Manually edited. Survives Knowledge Base re-indexing.">
                        <Pencil className="h-3 w-3" aria-hidden="true" />Edited · kept on re-index
                      </span>
                    )}
                    <span className="flex-1" />
                    <span className="hover-reveal flex gap-0.5 group-hover/chunk:opacity-100">
                      <IconButton icon={Pencil} label="Edit chunk" size="sm" onClick={() => openChunkEditor(chunk)} />
                      <IconButton icon={Trash2} label="Delete chunk" tone="danger" size="sm" onClick={() => requestDeleteChunk(chunk, idx)} />
                    </span>
                  </div>
                  <p className="max-h-44 overflow-y-auto custom-scrollbar whitespace-pre-wrap text-sm leading-relaxed text-text-primary select-text">{chunk.text}</p>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {cTags.entities.map((t) => (
                      <TagChip key={`e_${t.entity}`} label={t.value} variant="entity" size="sm" onRemove={() => removeChunkEntity(chunk.id, t.entity)} />
                    ))}
                    {cTags.keywords.map((kw) => (
                      <TagChip key={`k_${kw}`} label={kw} size="sm" onRemove={() => removeChunkKeyword(chunk.id, kw)} />
                    ))}
                    {isTagInputActive ? (
                      <div className="relative" ref={chunkTagAnchorRef}>
                        <input
                          autoFocus
                          type="text"
                          value={chunkTagInput}
                          onChange={(e) => { setChunkTagInput(e.target.value); refreshChunkEntityCandidates(e.target.value); }}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') { e.preventDefault(); addChunkKeyword(chunk.id, chunkTagInput); }
                            if (e.key === 'Escape') { setActiveTagChunk(null); setChunkTagInput(''); setChunkEntityCandidates([]); }
                          }}
                          onBlur={() => setTimeout(() => { setActiveTagChunk(null); setChunkTagInput(''); setChunkEntityCandidates([]); }, 150)}
                          placeholder="Type a tag, pick an entity…"
                          className="field-input h-6 w-52 px-2 text-xs"
                        />
                        {(() => {
                          const entityMatches = chunkEntityCandidates.filter(c => !cTags.entities.some(t => t.entity === c.id));
                          return (
                            <Popover anchorRef={chunkTagAnchorRef} open={entityMatches.length > 0} onClose={() => setChunkEntityCandidates([])} maxHeight={200}>
                              <div className="px-3 pb-1 pt-1.5 text-xs font-semibold text-text-subtle">World entities</div>
                              {entityMatches.map((c) => {
                                const Icon = entityTypeIcon(c.type);
                                return (
                                  <button key={c.id} type="button" onMouseDown={(e) => { e.preventDefault(); addChunkEntity(chunk.id, c); }}
                                    className="flex w-full items-center gap-2 rounded-lg px-3 py-1.5 text-left text-sm text-text-primary hover:bg-surface-hover cursor-pointer">
                                    <Icon className="h-3.5 w-3.5 shrink-0 text-status-info" />
                                    <span className="truncate">{c.canonicalName}</span>
                                    {c.matchedAlias && <span className="truncate text-xs text-text-subtle">alias: {c.matchedAlias}</span>}
                                    <span className="ml-auto shrink-0 text-xs text-text-subtle">{c.type}</span>
                                  </button>
                                );
                              })}
                            </Popover>
                          );
                        })()}
                      </div>
                    ) : (
                      <button
                        type="button"
                        onClick={() => { setActiveTagChunk(chunk.id); setChunkTagInput(''); setChunkEntityCandidates([]); }}
                        className="inline-flex h-5 items-center gap-1 rounded-md border border-dashed border-border-strong px-2 text-[0.6875rem] text-text-muted hover:border-accent/50 hover:text-text-primary cursor-pointer"
                      >
                        <Plus className="h-3 w-3" />Tag
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </Modal>
      )}

      {/* Choose what World Index tags */}
      {tagSelection && (
        <Modal onClose={() => !tagSelectionLoading && setTagSelection(null)} size="xl" showClose={false} className="max-h-[82vh] !bg-surface-panel">
          <div className="flex shrink-0 items-start gap-3 border-b border-border-subtle py-4 pl-6 pr-4">
            <ItemTile icon={Tag} size="lg" />
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-text-primary">{tagSelection === 'custom' ? 'Tag notes' : 'Tag searchable files'}</h2>
              <p className="mt-0.5 text-xs leading-relaxed text-text-muted">World Index tags every chunk inside the {tagSelectionNoun[1]} you pick. The text is not changed or re-vectorized.</p>
            </div>
            <IconButton icon={XIcon} label="Close" size="sm" onClick={() => setTagSelection(null)} />
          </div>
          <div className="flex shrink-0 items-center gap-2 border-b border-border-subtle px-6 py-3">
            <TextInput
              icon={Search}
              value={tagSelectionSearch}
              name="block-filter"
              autoComplete="off"
              aria-label={`Filter ${tagSelectionNoun[1]}`}
              onChange={(event) => setTagSelectionSearch(event.target.value)}
              placeholder={`Filter ${tagSelectionNoun[1]}`}
              containerClassName="flex-1"
            />
            <Button variant="ghost" size="sm" onClick={() => setTagSelectionIds(tagSelectionBlocks.map(block => block.id))}>Select all</Button>
            <Button variant="ghost" size="sm" onClick={() => setTagSelectionIds([])}>Clear</Button>
          </div>
          <div className="flex-1 overflow-y-auto overscroll-contain custom-scrollbar space-y-2 px-6 py-4">
            {tagSelectionLoading ? <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin text-accent" /></div> : tagSelectionBlocks.filter(block => `${block.title} ${block.excerpt}`.toLowerCase().includes(tagSelectionSearch.toLowerCase())).map((block) => {
              const selected = tagSelectionIds.includes(block.id);
              return (
                <button
                  key={block.id}
                  type="button"
                  role="checkbox"
                  aria-checked={selected}
                  onClick={() => setTagSelectionIds(current => selected ? current.filter(id => id !== block.id) : [...current, block.id])}
                  className={`flex w-full gap-3 rounded-card border p-3 text-left transition-colors cursor-pointer [content-visibility:auto] [contain-intrinsic-size:auto_5rem] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${selected ? 'border-accent/45 bg-accent/5' : 'border-border-subtle bg-surface-panel-muted hover:border-border-default'}`}
                >
                  <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${selected ? 'border-accent bg-accent text-on-accent' : 'border-border-strong'}`}>{selected && <Check className="h-3 w-3 stroke-[3]" />}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                      <span className="text-sm font-semibold text-text-primary">{block.title}</span>
                      <span className={`inline-flex items-center gap-1.5 text-xs ${block.complete ? 'text-text-muted' : 'text-status-warning'}`}>
                        <StatusDot tone={block.complete ? 'ok' : 'pending'} />{block.complete ? 'Already tagged' : 'Needs tagging'}
                      </span>
                      {tagSelection === 'searchable' && <span className="text-xs text-text-subtle">· {chunkCount(block.chunkIds.length)}</span>}
                    </span>
                    <span className="mt-1 block line-clamp-2 text-xs leading-relaxed text-text-muted">{block.excerpt}</span>
                  </span>
                </button>
              );
            })}
            {!tagSelectionLoading && tagSelectionBlocks.length > 0 && tagSelectionBlocks.filter(block => `${block.title} ${block.excerpt}`.toLowerCase().includes(tagSelectionSearch.toLowerCase())).length === 0 && <p className="py-8 text-center text-sm text-text-subtle">Nothing matches this filter.</p>}
          </div>
          <div className="flex shrink-0 items-center justify-between gap-4 border-t border-border-subtle py-3.5 pl-6 pr-4">
            <span className="text-sm text-text-muted tabular-nums">
              {plural(tagSelectionIds.length, tagSelectionNoun[0], tagSelectionNoun[1])}{tagSelection === 'searchable' && tagSelectionIds.length > 0 ? ` · ${chunkCount(selectedTagChunks)}` : ''} selected
            </span>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={() => setTagSelection(null)}>Cancel</Button>
              <Button disabled={!tagSelectionIds.length || tagSelectionLoading} onClick={startSelectedTagging}>
                {tagSelectionIds.length ? `Tag ${plural(tagSelectionIds.length, tagSelectionNoun[0], tagSelectionNoun[1])}` : 'Tag'}
              </Button>
            </div>
          </div>
        </Modal>
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
          title={confirmDialog.title || 'Confirm'}
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
