import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useApp } from '../context/AppContext';
import WritingEditor, { DEFAULT_WRITING_DESK } from './WritingEditor';
import ExportBookModal from './ExportBookModal';
import { importedContentToJson } from './writingExtensions';
import ConfirmDialog from './ui/ConfirmDialog';
import Button from './ui/Button';
import IconButton from './ui/IconButton';
import Tooltip from './ui/Tooltip';
import { Menu, MenuItem, MenuLabel, MenuSeparator } from './ui/Menu';
import WritingDirectivesPanel from './WritingDirectivesPanel';
import WritingNotesPanel from './WritingNotesPanel';
import WritingAnalysesPanel from './WritingAnalysesPanel';
import InWorldTextDialog from '../features/worldbuild/InWorldTextDialog';
import { useFirstVisitTour, useTour } from '../features/onboarding/GuidedTour';
import { showsTourExample, tourStage } from '../features/onboarding/tours';
import WritingTourExample from '../features/onboarding/WritingTourExample';
import ExampleChip from '../features/onboarding/ExampleChip';
import LIGHTHOUSE from '../../shared/lighthouse-sample.json';
import {
  Folder, FolderOpen, FolderPlus, Plus, ChevronDown, ChevronLeft, FileText, Trash2, FolderInput,
  PenLine, Download, FileInput, MoreHorizontal, ScrollText, Lightbulb
} from 'lucide-react';
import { AiGlyph, AiNoteGlyph, IndexingGlyph, SuggestionPendingGlyph, WritingGlyph } from './ui/glyphs';

export default function WritingDeskView({ chat, electronAPI, onOpenEntity }) {
  const { settings, showToast } = useApp();
  const workspaceId = chat.id;
  const toolbarMode = settings?.interface?.writingToolbar === 'bubble' ? 'bubble' : 'fixed';
  const smartTypography = settings?.interface?.smartTypography ?? true;
  const { tour, startTour } = useTour();
  useFirstVisitTour('writing', 'writingTourSeen');
  // While the tour runs, its example chapter takes the editor's place; the workspace's own
  // chapters stay in the list but none of them opens.
  const tourExample = showsTourExample(tourStage(tour, 'writing'));

  const [tree, setTree] = useState({ folders: [], documents: [] });
  const [expanded, setExpanded] = useState({});
  const [selectedDocId, setSelectedDocId] = useState(null);
  const navigationStateRef = useRef({ expanded: {}, selectedDocId: null });
  const [currentDoc, setCurrentDoc] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [inWorldTarget, setInWorldTarget] = useState(null);
  const [exportFolderTarget, setExportFolderTarget] = useState(null);
  const [rowMenu, setRowMenu] = useState(null); // { item, view: 'actions' | 'move' }
  const rowMenuAnchorRef = useRef(null);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const moreMenuRef = useRef(null);
  const [dragItem, setDragItem] = useState(null);
  const [dropInfo, setDropInfo] = useState(null); // { id, zone: 'before'|'after'|'inside' }
  const sidebarKey = `wd-sidebar-collapsed-${workspaceId}`;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem(sidebarKey) === '1');
  const rightPanelKey = `wd-rightpanel-${workspaceId}`;
  const [rightPanel, setRightPanel] = useState(() => localStorage.getItem(rightPanelKey) || ''); // '' | 'directives' | 'notes' | 'analyses'
  const editorJumpRef = useRef(null); // set by the editor; lets the Notes panel scroll to a passage
  const [notesRefresh, setNotesRefresh] = useState(0);
  const [justAddedNoteId, setJustAddedNoteId] = useState(null); // note to auto-expand once
  const [analysesRefresh, setAnalysesRefresh] = useState(0);
  const [justAddedAnalysisId, setJustAddedAnalysisId] = useState(null);
  const [analysesCount, setAnalysesCount] = useState(0);
  // Chapters whose memory update is running, kept here so it survives switching chapters.
  const [indexing, setIndexing] = useState({}); // { [docId]: { done, total } }
  // Chapters with an analysis the writer has not opened yet.
  const unreadKey = `wd-unread-analyses-${workspaceId}`;
  const [unreadAnalyses, setUnreadAnalyses] = useState(() => {
    try { return new Set(JSON.parse(localStorage.getItem(unreadKey) || '[]')); } catch { return new Set(); }
  });
  const [openNotes, setOpenNotes] = useState(0);
  const [directivesOn, setDirectivesOn] = useState(0);
  const [directivesRefresh, setDirectivesRefresh] = useState(0);

  const getWritingDeskState = useCallback(async () => {
    if (electronAPI.getWritingDeskState) {
      try {
        const result = await electronAPI.getWritingDeskState(workspaceId);
        if (result?.success) return result;
      } catch {
        // The generic state IPC stays available while the main process reloads.
      }
    }

    const result = await electronAPI.getWorkspaceUiState?.(workspaceId, 'writing-desk');
    return { ...result, state: result?.value };
  }, [electronAPI, workspaceId]);

  const saveWritingDeskState = useCallback(async (nextExpanded, nextSelectedDocId) => {
    const state = {
      expandedFolderIds: Object.keys(nextExpanded).filter(id => nextExpanded[id]),
      lastDocumentId: nextSelectedDocId,
    };

    if (electronAPI.setWritingDeskState) {
      try {
        const result = await electronAPI.setWritingDeskState(workspaceId, state);
        if (result?.success) return result;
      } catch {
        // The generic state IPC stays available while the main process reloads.
      }
    }

    return electronAPI.setWorkspaceUiState?.(workspaceId, 'writing-desk', state);
  }, [electronAPI, workspaceId]);

  const updateNavigationState = useCallback((nextExpanded, nextSelectedDocId, persist = true) => {
    navigationStateRef.current = { expanded: nextExpanded, selectedDocId: nextSelectedDocId };
    setExpanded(nextExpanded);
    setSelectedDocId(nextSelectedDocId);
    if (persist) saveWritingDeskState(nextExpanded, nextSelectedDocId);
  }, [saveWritingDeskState]);

  const toggleFolder = useCallback((folderId) => {
    const { expanded: currentExpanded, selectedDocId: currentSelectedDocId } = navigationStateRef.current;
    updateNavigationState({ ...currentExpanded, [folderId]: !currentExpanded[folderId] }, currentSelectedDocId);
  }, [updateNavigationState]);

  const selectDocument = useCallback((documentId) => {
    updateNavigationState(navigationStateRef.current.expanded, documentId);
  }, [updateNavigationState]);

  const togglePanel = (name) => {
    setJustAddedNoteId(null); // a manual open shows every note minimized
    setJustAddedAnalysisId(null);
    setRightPanel(prev => {
      const next = prev === name ? '' : name;
      localStorage.setItem(rightPanelKey, next);
      return next;
    });
  };

  useEffect(() => {
    setSidebarCollapsed(localStorage.getItem(sidebarKey) === '1');
  }, [sidebarKey]);

  useEffect(() => {
    setRightPanel(localStorage.getItem(rightPanelKey) || '');
  }, [rightPanelKey]);

  const toggleSidebar = () => {
    setSidebarCollapsed(prev => {
      const next = !prev;
      localStorage.setItem(sidebarKey, next ? '1' : '0');
      return next;
    });
  };

  const loadTree = useCallback(async () => {
    const data = await electronAPI.getWritingTree(workspaceId);
    setTree(data || { folders: [], documents: [] });
    return data;
  }, [electronAPI, workspaceId]);

  useEffect(() => { loadTree(); }, [loadTree]);

  // Another view (an item's pages) can ask for a chapter; its folder and every parent open with it.
  useEffect(() => {
    const open = async event => {
      const { workspaceId: target, documentId, folderId } = event.detail || {};
      if (target !== workspaceId || !documentId) return;
      const data = await loadTree();
      const parentOf = new Map((data?.folders || []).map(folder => [folder.id, folder.parentId || null]));
      const nextExpanded = { ...navigationStateRef.current.expanded };
      for (let id = folderId; id && !nextExpanded[id]; id = parentOf.get(id)) nextExpanded[id] = true;
      updateNavigationState(nextExpanded, documentId);
    };
    window.addEventListener('writing-desk-open-document', open);
    return () => window.removeEventListener('writing-desk-open-document', open);
  }, [workspaceId, updateNavigationState, loadTree]);

  // An item sheet can mark or create pages; the tree shows them with their own icon.
  useEffect(() => electronAPI.onInWorldTextsChanged?.(payload => {
    if (payload?.workspaceId === workspaceId) loadTree();
  }), [electronAPI, workspaceId, loadTree]);

  useEffect(() => {
    let active = true;
    updateNavigationState({}, null, false);

    getWritingDeskState().then(result => {
      if (!active || !result?.success) return;

      const state = result.state || {};
      updateNavigationState(
        Object.fromEntries((state.expandedFolderIds || []).map(id => [id, true])),
        state.lastDocumentId || null,
        false
      );
    });

    return () => { active = false; };
  }, [getWritingDeskState, updateNavigationState]);

  useEffect(() => {
    if (!selectedDocId) { setCurrentDoc(null); return; }
    let active = true;
    electronAPI.getDocument(selectedDocId).then(d => { if (active) setCurrentDoc(d); });
    return () => { active = false; };
  }, [selectedDocId, electronAPI]);

  // The header buttons carry counts, so they are read here rather than inside the panels.
  useEffect(() => {
    if (!currentDoc?.id) { setOpenNotes(0); return; }
    let active = true;
    electronAPI.getDocumentNotes(currentDoc.id).then(res => {
      if (active) setOpenNotes((res?.notes || []).filter(n => n.status !== 'resolved').length);
    });
    return () => { active = false; };
  }, [electronAPI, currentDoc?.id, notesRefresh]);

  useEffect(() => {
    if (!currentDoc?.id) { setAnalysesCount(0); return; }
    let active = true;
    electronAPI.getDocumentAnalyses?.(currentDoc.id).then(res => {
      if (active) setAnalysesCount((res?.analyses || []).length);
    });
    return () => { active = false; };
  }, [electronAPI, currentDoc?.id, analysesRefresh]);

  useEffect(() => {
    let active = true;
    electronAPI.getDirectives(workspaceId).then(res => {
      if (active) setDirectivesOn((res?.directives || []).filter(d => d.enabled !== 0).length);
    });
    return () => { active = false; };
  }, [electronAPI, workspaceId, directivesRefresh]);

  const updateUnread = useCallback((update) => {
    setUnreadAnalyses(prev => {
      const next = update(new Set(prev));
      try { localStorage.setItem(unreadKey, JSON.stringify([...next])); } catch { /* storage unavailable */ }
      return next;
    });
  }, [unreadKey]);

  // Opening a chapter's Analyses counts as reading them.
  useEffect(() => {
    if (rightPanel === 'analyses' && selectedDocId && unreadAnalyses.has(selectedDocId)) {
      updateUnread(set => { set.delete(selectedDocId); return set; });
    }
  }, [rightPanel, selectedDocId, unreadAnalyses, updateUnread]);

  useEffect(() => {
    if (!electronAPI.onVectorizeDocumentProgress) return undefined;
    return electronAPI.onVectorizeDocumentProgress((d) => {
      setIndexing(prev => (prev[d.documentId] ? { ...prev, [d.documentId]: { done: d.done, total: d.total } } : prev));
    });
  }, [electronAPI]);

  const handleIndexing = useCallback((docId, on) => {
    setIndexing(prev => {
      const next = { ...prev };
      if (on) next[docId] = next[docId] || {};
      else delete next[docId];
      return next;
    });
  }, []);

  // Invocation state lives above the editor, which remounts per chapter, so it survives a switch.
  const [inFlight, setInFlight] = useState({});       // { [docId]: { profileId } } while running
  const [pendingIds, setPendingIds] = useState(new Set()); // docs with a ready suggestion
  const [currentPending, setCurrentPending] = useState(null); // full suggestion for open doc

  // Which chapters hold an unresolved suggestion (drives the sidebar "ready" mark).
  useEffect(() => {
    let active = true;
    electronAPI.getPendingSuggestionIds?.(workspaceId).then(res => {
      if (active && res) setPendingIds(new Set(res.ids || []));
    });
    return () => { active = false; };
  }, [electronAPI, workspaceId]);

  useEffect(() => {
    if (!selectedDocId) { setCurrentPending(null); return; }
    let active = true;
    electronAPI.getPendingSuggestion?.(selectedDocId).then(res => {
      if (active) setCurrentPending(res && res.suggestion ? res.suggestion : null);
    });
    return () => { active = false; };
  }, [selectedDocId, electronAPI]);

  // Single subscription to invocation completion (survives chapter switches).
  useEffect(() => {
    if (!electronAPI.onWdInvocationComplete) return;
    const off = electronAPI.onWdInvocationComplete((data) => {
      if (data.workspaceId && data.workspaceId !== workspaceId) return;
      setInFlight(prev => { const n = { ...prev }; delete n[data.documentId]; return n; });
      if (data.error) { showToast?.(`AI invocation failed: ${data.error}`, 'error'); return; }
      electronAPI.getPendingSuggestion(data.documentId).then(async (res) => {
        const sug = res && res.suggestion ? res.suggestion : null;
        // Analysis results are readings, not diffs: they join the chapter's Analyze history
        // and open beside the text, never over it.
        if (sug && sug.channel === 'analysis') {
          const created = await electronAPI.createDocumentAnalysis({
            documentId: sug.documentId,
            workspaceId,
            body: sug.proposedText || '',
            excerpt: sug.originalText || null,
            profileId: sug.profileId || null,
            instruction: sug.intermediatePrompt || null,
            status: sug.status,
            debug: sug.debug || null,
          });
          await electronAPI.resolvePendingSuggestion(sug.id);
          setPendingIds(prev => { const n = new Set(prev); n.delete(data.documentId); return n; });
          if (data.documentId !== selectedDocId) {
            updateUnread(set => set.add(data.documentId));
          } else {
            setCurrentPending(null);
            setJustAddedAnalysisId(created?.id || null);
            setAnalysesRefresh(x => x + 1);
            setRightPanel('analyses');
            localStorage.setItem(rightPanelKey, 'analyses');
          }
          return;
        }
        setPendingIds(prev => new Set(prev).add(data.documentId));
        if (data.documentId === selectedDocId) setCurrentPending(sug);
      });
    });
    return off;
  }, [electronAPI, workspaceId, selectedDocId, showToast, rightPanelKey, updateUnread]);

  const handleDispatch = (docId, profileId) => setInFlight(prev => ({ ...prev, [docId]: { profileId } }));
  const handleResolved = (docId) => {
    setInFlight(prev => { const n = { ...prev }; delete n[docId]; return n; });
    setPendingIds(prev => { const n = new Set(prev); n.delete(docId); return n; });
    if (docId === selectedDocId) setCurrentPending(null);
  };

  const newDocument = async (folderId = null) => {
    const doc = await electronAPI.createDocument(workspaceId, folderId, 'Untitled', null, DEFAULT_WRITING_DESK);
    if (folderId && !navigationStateRef.current.expanded[folderId]) {
      updateNavigationState({ ...navigationStateRef.current.expanded, [folderId]: true }, navigationStateRef.current.selectedDocId);
    }
    await loadTree();
    selectDocument(doc.id);
  };

  const newFolder = async (parentId = null) => {
    await electronAPI.createFolder(workspaceId, 'New folder', parentId);
    await loadTree();
  };

  const importDocument = async () => {
    const res = await electronAPI.importDocument();
    if (res?.canceled) return;
    if (res?.error) { showToast(`Import failed: ${res.error}`, 'error'); return; }
    let content;
    try {
      content = JSON.stringify(importedContentToJson(res));
    } catch (e) {
      showToast(`Import failed: ${e.message}`, 'error');
      return;
    }
    const doc = await electronAPI.createDocument(workspaceId, null, res.baseName || 'Imported', content, DEFAULT_WRITING_DESK);
    await loadTree();
    if (doc?.id) selectDocument(doc.id);
  };

  const commitRename = async (item) => {
    const name = editValue.trim();
    setEditingId(null);
    if (!name) return;
    if (item.type === 'folder') await electronAPI.renameFolder(item.id, name);
    else {
      await electronAPI.renameDocument(item.id, name);
      if (currentDoc?.id === item.id) setCurrentDoc({ ...currentDoc, title: name });
    }
    await loadTree();
  };

  const doDelete = async (item) => {
    setDeleteTarget(null);
    const result = item.type === 'folder'
      ? await electronAPI.deleteFolder(item.id)
      : await electronAPI.deleteDocument(item.id);
    if (!result?.success) showToast(`Could not delete ${item.type === 'folder' ? 'the folder' : 'the chapter'}: ${result?.error || 'unknown error'}`, 'error');
    // A deleted folder can take the open chapter with it.
    else if (selectedDocId && !(await electronAPI.getDocument(selectedDocId))) { selectDocument(null); setCurrentDoc(null); }
    await loadTree();
  };

  const doMove = async (item, folderId) => {
    setRowMenu(null);
    if (item.type === 'folder') {
      if (folderId === item.id) return;
      await electronAPI.moveFolder(item.id, folderId);
    } else {
      await electronAPI.moveDocument(item.id, folderId);
    }
    await loadTree();
  };

  const onDocPatch = async (patch) => {
    if (!currentDoc) return;
    setCurrentDoc({ ...currentDoc, ...patch });
    await electronAPI.saveDocumentPage(currentDoc.id, patch);
  };

  const childFolders = (parentId) => tree.folders.filter(f => (f.parentId || null) === parentId);
  const childDocs = (folderId) => tree.documents.filter(d => (d.folderId || null) === folderId);

  // Chapters anywhere under a folder, so a folder of folders still shows its size.
  const chapterCounts = useMemo(() => {
    const counts = {};
    const countOf = (folderId) => {
      if (counts[folderId] != null) return counts[folderId];
      const own = tree.documents.filter(d => d.folderId === folderId).length;
      counts[folderId] = own + tree.folders.filter(f => f.parentId === folderId).reduce((sum, f) => sum + countOf(f.id), 0);
      return counts[folderId];
    };
    tree.folders.forEach(f => countOf(f.id));
    return counts;
  }, [tree]);

  const siblings = (type, parentId) => (type === 'folder' ? childFolders(parentId) : childDocs(parentId));

  // Is `candidateId` inside the subtree rooted at `rootId`? Blocks dropping a folder into itself/a descendant.
  const isWithinSubtree = (candidateId, rootId) => {
    let cur = candidateId ? tree.folders.find(f => f.id === candidateId) : null;
    while (cur) {
      if (cur.id === rootId) return true;
      cur = cur.parentId ? tree.folders.find(f => f.id === cur.parentId) : null;
    }
    return false;
  };

  const dropZone = (e, el, isFolder) => {
    const rect = el.getBoundingClientRect();
    const y = e.clientY - rect.top;
    if (isFolder) {
      if (y < rect.height * 0.3) return 'before';
      if (y > rect.height * 0.7) return 'after';
      return 'inside';
    }
    return y < rect.height * 0.5 ? 'before' : 'after';
  };

  const onRowDragOver = (e, target) => {
    if (!dragItem || dragItem.id === target.id) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
    setDropInfo({ id: target.id, zone: dropZone(e, e.currentTarget, target.type === 'folder') });
  };

  const commitOrder = async (item, newParent, insertIndex) => {
    if (item.type === 'folder' && (newParent === item.id || isWithinSubtree(newParent, item.id))) return;
    const group = siblings(item.type, newParent).filter(s => s.id !== item.id);
    const idx = insertIndex == null ? group.length : insertIndex;
    const ordered = [...group.slice(0, idx), { id: item.id }, ...group.slice(idx)];
    const updates = ordered.map((s, i) => ({ id: s.id, type: item.type, parentId: newParent, position: i }));
    await electronAPI.reorderWritingItems(updates);
    await loadTree();
  };

  const onRowDrop = (e, target) => {
    if (!dragItem || dragItem.id === target.id) return;
    e.preventDefault();
    e.stopPropagation();
    const item = dragItem;
    const zone = dropZone(e, e.currentTarget, target.type === 'folder');
    setDragItem(null);
    setDropInfo(null);
    if (target.type === 'folder' && zone === 'inside') {
      commitOrder(item, target.id, null); // append inside the folder
      return;
    }
    const newParent = target.type === 'folder' ? (target.parentId || null) : (target.folderId || null);
    if (target.type === item.type) {
      const group = siblings(item.type, newParent).filter(s => s.id !== item.id);
      const tIdx = group.findIndex(s => s.id === target.id);
      commitOrder(item, newParent, zone === 'before' ? tIdx : tIdx + 1);
    } else {
      commitOrder(item, newParent, null); // different type: append at that level
    }
  };

  // Stops here so the workspace's file-drop handler above never overrides the move with 'none'.
  const allowRootDrop = (e) => {
    if (!dragItem) return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = 'move';
  };

  const onRootDrop = (e) => {
    if (!dragItem) return;
    e.preventDefault();
    e.stopPropagation();
    const item = dragItem;
    setDragItem(null);
    setDropInfo(null);
    commitOrder(item, null, null);
  };

  const dropLine = (item, zone) => (dropInfo && dropInfo.id === item.id && dropInfo.zone === zone
    ? <span aria-hidden="true" className={`pointer-events-none absolute left-2 right-2 h-0.5 rounded bg-accent ${zone === 'before' ? '-top-px' : '-bottom-px'}`} />
    : null);
  const dropInside = (item) => dropInfo && dropInfo.id === item.id && dropInfo.zone === 'inside';

  const openRowMenu = (event, item) => {
    event.stopPropagation();
    rowMenuAnchorRef.current = event.currentTarget;
    setRowMenu(current => (current?.item.id === item.id ? null : { item, view: 'actions' }));
  };

  const startRename = (item) => {
    setEditingId(item.id);
    setEditValue(item.type === 'folder' ? item.name : item.title);
  };

  const renderEditable = (item) => (
    <label className="min-w-0 flex-1">
      <span className="sr-only">{item.type === 'folder' ? 'Folder name' : 'Chapter name'}</span>
      <input
        autoFocus
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onFocus={(e) => e.target.select()}
        onBlur={() => commitRename(item)}
        onKeyDown={(e) => { if (e.key === 'Enter') commitRename(item); if (e.key === 'Escape') setEditingId(null); }}
        className="h-7 w-full rounded-md border border-accent/60 bg-surface-input px-2 text-sm text-text-primary focus:outline-none"
      />
    </label>
  );

  // Row actions take no room until the row is hovered or focused, so names keep their width.
  const rowActionClass = (item) => `h-6 w-6 shrink-0 items-center justify-center rounded-md text-text-muted transition-colors hover:bg-tint/10 hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${rowMenu?.item.id === item.id ? 'inline-flex bg-tint/10 text-text-primary' : 'hidden group-hover:inline-flex group-focus-within:inline-flex'}`;

  const dragProps = (item) => ({
    draggable: editingId !== item.id,
    onDragStart: (e) => {
      e.stopPropagation();
      // Chromium only delivers a drop when the drag carries data and a matching effect.
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', item.id);
      setDragItem(item.type === 'folder' ? { id: item.id, type: 'folder', parentId: item.parentId || null } : { id: item.id, type: 'document', folderId: item.folderId || null });
    },
    onDragOver: (e) => onRowDragOver(e, item),
    onDrop: (e) => onRowDrop(e, item),
    onDragEnd: () => { setDragItem(null); setDropInfo(null); },
  });

  const renderFolder = (folder) => {
    const item = { ...folder, type: 'folder' };
    const isOpen = !!expanded[folder.id];
    const FolderIcon = isOpen ? FolderOpen : Folder;
    return (
      <div key={folder.id}>
        <div
          {...dragProps(item)}
          role="button"
          tabIndex={0}
          aria-expanded={isOpen}
          onClick={() => editingId !== folder.id && toggleFolder(folder.id)}
          onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); toggleFolder(folder.id); } }}
          className={`group relative flex min-h-[1.875rem] cursor-pointer items-center gap-2 rounded-md py-0.5 pl-2 pr-8 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 ${dropInside(item) ? 'bg-accent/10 ring-1 ring-inset ring-accent/60' : 'hover:bg-tint/5'} ${dragItem?.id === folder.id ? 'opacity-40' : ''}`}
        >
          {dropLine(item, 'before')}
          {dropLine(item, 'after')}
          <FolderIcon className="h-4 w-4 shrink-0 text-text-subtle" aria-hidden="true" />
          {editingId === folder.id ? renderEditable(item) : (
            <>
              <span className="min-w-0 flex-1 truncate text-text-secondary group-hover:text-text-primary">{folder.name}</span>
              <span className={`shrink-0 text-xs tabular-nums text-text-disabled group-hover:hidden group-focus-within:hidden ${rowMenu?.item.id === folder.id ? 'hidden' : ''}`}>{chapterCounts[folder.id] || 0}</span>
              <Tooltip content={`New chapter in ${folder.name}`}>
                <button type="button" aria-label={`New chapter in ${folder.name}`} onClick={(e) => { e.stopPropagation(); newDocument(folder.id); }} className={rowActionClass({ id: `new-${folder.id}` })}>
                  <Plus className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </Tooltip>
              <button type="button" aria-label={`${folder.name} actions`} aria-haspopup="menu" aria-expanded={rowMenu?.item.id === folder.id} onClick={(e) => openRowMenu(e, item)} className={rowActionClass(item)}>
                <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </>
          )}
          <ChevronDown aria-hidden="true" className={`absolute right-2 h-3.5 w-3.5 text-text-subtle transition-transform ${isOpen ? '' : '-rotate-90'}`} />
        </div>
        {isOpen && (
          <div className="ml-[0.9375rem] flex flex-col gap-px border-l border-border-subtle pl-1.5">
            {childFolders(folder.id).map(renderFolder)}
            {childDocs(folder.id).map(renderDoc)}
            {!childFolders(folder.id).length && !childDocs(folder.id).length && (
              <p className="px-2 py-1 text-xs text-text-subtle">Empty folder</p>
            )}
          </div>
        )}
      </div>
    );
  };

  const renderDoc = (doc) => {
    const item = { ...doc, type: 'document' };
    const active = !tourExample && selectedDocId === doc.id;
    return (
      <div
        key={doc.id}
        {...dragProps(item)}
        role="button"
        tabIndex={0}
        aria-current={active ? 'page' : undefined}
        onClick={() => editingId !== doc.id && selectDocument(doc.id)}
        onKeyDown={(e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); selectDocument(doc.id); } }}
        className={`group relative flex min-h-[1.875rem] cursor-pointer items-center gap-2 rounded-md py-0.5 pl-2 pr-1 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 ${active ? 'bg-accent/[0.13] text-text-primary shadow-[inset_3px_0_0_var(--app-accent)]' : 'text-text-secondary hover:bg-tint/5 hover:text-text-primary'} ${dragItem?.id === doc.id ? 'opacity-40' : ''}`}
      >
        {dropLine(item, 'before')}
        {dropLine(item, 'after')}
        {doc.inWorld
          ? <Tooltip content="In-world text: the AI reads it only through its item"><span className="inline-flex shrink-0"><ScrollText className={`h-4 w-4 ${active ? 'text-accent' : 'text-entity-item'}`} aria-label="In-world text" /></span></Tooltip>
          : <FileText className={`h-4 w-4 shrink-0 ${active ? 'text-accent' : 'text-text-subtle'}`} aria-hidden="true" />}
        {editingId === doc.id ? renderEditable(item) : (
          <>
            <span className={`min-w-0 flex-1 truncate ${active ? 'font-semibold' : ''}`}>{doc.title || 'Untitled'}</span>
            {indexing[doc.id] && (
              <Tooltip content={indexing[doc.id].total ? `Updating the AI's memory, ${indexing[doc.id].done} of ${indexing[doc.id].total}` : "Updating the AI's memory"}>
                <span className="inline-flex shrink-0 text-status-info"><IndexingGlyph animated className="h-4 w-4" /></span>
              </Tooltip>
            )}
            {inFlight[doc.id] && (
              <Tooltip content="The AI is working on this chapter">
                <span className="inline-flex shrink-0 text-accent"><AiGlyph animated className="h-4 w-4" /></span>
              </Tooltip>
            )}
            {!inFlight[doc.id] && pendingIds.has(doc.id) && (
              <Tooltip content="An AI suggestion is waiting for your review">
                <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-status-success"><SuggestionPendingGlyph className="h-4 w-4" />Review</span>
              </Tooltip>
            )}
            {!inFlight[doc.id] && !pendingIds.has(doc.id) && unreadAnalyses.has(doc.id) && (
              <Tooltip content="A new analysis is waiting in Analyses">
                <span className="inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-status-success"><AiNoteGlyph className="h-4 w-4" />Read</span>
              </Tooltip>
            )}
            <button type="button" aria-label={`${doc.title || 'Untitled'} actions`} aria-haspopup="menu" aria-expanded={rowMenu?.item.id === doc.id} onClick={(e) => openRowMenu(e, item)} className={rowActionClass(item)}>
              <MoreHorizontal className="h-3.5 w-3.5" aria-hidden="true" />
            </button>
          </>
        )}
      </div>
    );
  };

  const menuItem = rowMenu?.item;
  const moveTargets = menuItem
    ? tree.folders.filter(f => f.id !== menuItem.id && !(menuItem.type === 'folder' && isWithinSubtree(f.id, menuItem.id)))
    : [];
  const currentParent = menuItem ? (menuItem.type === 'folder' ? menuItem.parentId || null : menuItem.folderId || null) : null;
  const currentFolder = currentDoc?.folderId ? tree.folders.find(f => f.id === currentDoc.folderId) : null;
  const showSidebar = !sidebarCollapsed || !currentDoc || tourExample;
  const isEmpty = tree.folders.length === 0 && tree.documents.length === 0;

  return (
    <div className="relative flex flex-1 overflow-hidden select-none">
      {showSidebar && (
        <aside aria-label="Chapters" data-tour="wd-chapters" className="glass-rail flex w-[21rem] shrink-0 flex-col border-r border-border-subtle">
          <div className="flex h-[3.25rem] shrink-0 items-center gap-1 pl-4 pr-3">
            <h2 className="text-[0.9375rem] font-bold text-text-primary">Chapters</h2>
            <span className="text-xs tabular-nums text-text-subtle">{tree.documents.length}</span>
            <span className="flex-1" />
            <Button size="sm" icon={Plus} className="whitespace-nowrap !px-2.5" onClick={() => newDocument(null)}>New chapter</Button>
            <IconButton icon={FolderPlus} label="New folder" size="sm" tooltipSide="bottom" onClick={() => newFolder(null)} />
            <IconButton ref={moreMenuRef} icon={MoreHorizontal} label="More chapter actions" size="sm" tooltipSide="bottom" aria-haspopup="menu" aria-expanded={showMoreMenu} onClick={() => setShowMoreMenu(v => !v)} />
            <Menu anchorRef={moreMenuRef} open={showMoreMenu} onClose={() => setShowMoreMenu(false)} label="Chapter actions" className="w-64">
              <MenuItem icon={FileInput} label="Import" description="Bring in a .docx or .pdf as a new chapter." onSelect={() => { setShowMoreMenu(false); importDocument(); }} />
              <MenuSeparator />
              <MenuItem icon={Lightbulb} label="Take the tour" description="A one-minute look around the Writing Desk." onSelect={() => { setShowMoreMenu(false); startTour('writing'); }} />
            </Menu>
          </div>
          <div
            className="custom-scrollbar flex flex-1 flex-col overflow-y-auto px-2 pb-2"
            onDragOver={allowRootDrop}
            onDrop={onRootDrop}
          >
            <div className="flex flex-col gap-px">
              {tourExample && (
                <div aria-current="page" className="relative flex min-h-[1.875rem] items-center gap-2 rounded-md bg-accent/[0.13] py-0.5 pl-2 pr-1 text-sm text-text-primary shadow-[inset_3px_0_0_var(--app-accent)]">
                  <FileText className="h-4 w-4 shrink-0 text-accent" aria-hidden="true" />
                  <span className="min-w-0 flex-1 truncate font-semibold">{LIGHTHOUSE.chapter.title}</span>
                  <ExampleChip />
                </div>
              )}
              {childFolders(null).map(renderFolder)}
              {childDocs(null).map(renderDoc)}
            </div>
            {isEmpty && !tourExample && (
              <p className="px-2 py-4 text-sm leading-relaxed text-text-subtle">No chapters yet. Start one above, or import a .docx or .pdf.</p>
            )}
            {/* Fills remaining space so there's always a drop target to send items back to the top level. */}
            <div
              className="min-h-10 flex-1"
              onDragOver={(e) => { allowRootDrop(e); if (dragItem && dropInfo?.id !== '__root__') setDropInfo({ id: '__root__', zone: 'inside' }); }}
              onDrop={onRootDrop}
            >
              {/* Always in the layout, so starting a drag never shifts the list under the pointer. */}
              <div aria-hidden={!dragItem} className={`pointer-events-none mx-0.5 mt-2 flex h-9 items-center justify-center rounded-md border border-dashed text-xs transition-colors ${!dragItem ? 'invisible' : dropInfo?.id === '__root__' ? 'border-accent/70 bg-accent/10 text-accent' : 'border-border-default text-text-subtle'}`}>
                Move to top level
              </div>
            </div>
          </div>
        </aside>
      )}

      {tourExample ? (
        <WritingTourExample stage={tourStage(tour, 'writing')} toolbarMode={toolbarMode} />
      ) : currentDoc ? (
        <div className="flex flex-1 flex-col overflow-hidden">
          <WritingEditor
            key={currentDoc.id}
            doc={currentDoc}
            inWorld={!!tree.documents.find(d => d.id === currentDoc.id)?.inWorld}
            onInWorld={() => setInWorldTarget(currentDoc)}
            folderName={currentFolder?.name || null}
            electronAPI={electronAPI}
            workspaceId={workspaceId}
            inFlight={!!inFlight[currentDoc.id]}
            inFlightProfileId={inFlight[currentDoc.id]?.profileId || null}
            pending={currentPending && currentPending.documentId === currentDoc.id ? currentPending : null}
            onDispatch={handleDispatch}
            onResolved={handleResolved}
            toolbarMode={toolbarMode}
            smartTypography={smartTypography}
            onDocPatch={onDocPatch}
            jumpRef={editorJumpRef}
            onOpenEntity={onOpenEntity}
            chaptersHidden={sidebarCollapsed}
            onToggleChapters={toggleSidebar}
            rightPanel={rightPanel}
            onTogglePanel={togglePanel}
            notesCount={openNotes}
            directivesCount={directivesOn}
            analysesCount={analysesCount}
            indexingElsewhere={!!indexing[currentDoc.id]}
            indexingProgress={indexing[currentDoc.id]?.total ? indexing[currentDoc.id] : null}
            onIndexingChange={handleIndexing}
            onRename={(title) => {
              setCurrentDoc({ ...currentDoc, title });
              electronAPI.renameDocument(currentDoc.id, title).then(loadTree);
            }}
          />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-6">
          <section aria-label="No chapter open" className="glass-panel flex w-full max-w-md flex-col items-center gap-3 rounded-surface border border-border-subtle px-8 py-8 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-card bg-tint/[0.06] text-text-primary"><WritingGlyph className="h-6 w-6" /></span>
            <h2 className="mt-1 text-lg font-bold text-text-primary">{isEmpty ? 'Start your first chapter' : 'Pick a chapter, or start one'}</h2>
            <p className="mb-2 text-sm leading-relaxed text-text-muted">
              {isEmpty ? 'Write here from scratch, or bring in a manuscript you already have.' : 'Chapters live in the list on the left. You can also bring in a manuscript you already have.'}
            </p>
            <div className="flex flex-wrap justify-center gap-2">
              <Button icon={Plus} onClick={() => newDocument(null)}>New chapter</Button>
              <Button variant="ghost" icon={FileInput} onClick={importDocument}>Import .docx or .pdf</Button>
            </div>
          </section>
        </div>
      )}

      {rightPanel === 'directives' && !tourExample && (
        <WritingDirectivesPanel
          workspaceId={workspaceId}
          workspaceTitle={chat.title}
          electronAPI={electronAPI}
          onChange={() => setDirectivesRefresh(x => x + 1)}
          onClose={() => togglePanel('directives')}
        />
      )}
      {rightPanel === 'notes' && currentDoc && !tourExample && (
        <WritingNotesPanel
          documentId={currentDoc.id}
          documentTitle={currentDoc.title}
          workspaceId={workspaceId}
          electronAPI={electronAPI}
          refreshKey={notesRefresh}
          expandId={justAddedNoteId}
          onChange={() => setNotesRefresh(x => x + 1)}
          onJump={(excerpt) => editorJumpRef.current?.(excerpt)}
          onClose={() => togglePanel('notes')}
        />
      )}

      {rightPanel === 'analyses' && currentDoc && !tourExample && (
        <WritingAnalysesPanel
          documentId={currentDoc.id}
          documentTitle={currentDoc.title}
          workspaceId={workspaceId}
          electronAPI={electronAPI}
          refreshKey={analysesRefresh}
          expandId={justAddedAnalysisId}
          onJump={(excerpt) => editorJumpRef.current?.(excerpt)}
          onChange={() => setAnalysesRefresh(x => x + 1)}
          onNotesChange={() => setNotesRefresh(x => x + 1)}
          onClose={() => togglePanel('analyses')}
        />
      )}

      <Menu anchorRef={rowMenuAnchorRef} open={!!rowMenu} onClose={() => setRowMenu(null)} label={menuItem ? `${menuItem.name || menuItem.title} actions` : 'Actions'} className="w-60">
        {close => menuItem && (rowMenu.view === 'move' ? (
          <>
            <MenuItem icon={ChevronLeft} label="Back" onSelect={() => setRowMenu({ ...rowMenu, view: 'actions' })} />
            <MenuSeparator />
            <MenuLabel>Move to</MenuLabel>
            <div className="custom-scrollbar max-h-72 overflow-y-auto">
              <MenuItem label="Top level" checked={currentParent === null} onSelect={() => { close(); doMove(menuItem, null); }} />
              {moveTargets.map(f => (
                <MenuItem key={f.id} label={f.name} checked={currentParent === f.id} onSelect={() => { close(); doMove(menuItem, f.id); }} />
              ))}
            </div>
          </>
        ) : (
          <>
            <MenuItem icon={PenLine} label="Rename" onSelect={() => { close(); startRename(menuItem); }} />
            <MenuItem icon={FolderInput} label="Move to" onSelect={() => setRowMenu({ ...rowMenu, view: 'move' })} />
            {menuItem.type === 'document' && (
              <MenuItem icon={ScrollText} label="In-world text" description={menuItem.inWorld ? 'Written inside the story' : 'A journal, letter or notice in the story'}
                onSelect={() => { close(); setInWorldTarget(menuItem); }} />
            )}
            {menuItem.type === 'folder' && (
              <MenuItem
                icon={Download}
                label="Export folder"
                description={childDocs(menuItem.id).length ? null : 'No chapters directly inside'}
                disabled={!childDocs(menuItem.id).length}
                onSelect={() => { close(); setExportFolderTarget(menuItem); }}
              />
            )}
            <MenuSeparator />
            <MenuItem icon={Trash2} label={menuItem.type === 'folder' ? 'Delete folder' : 'Delete chapter'} danger onSelect={() => { close(); setDeleteTarget(menuItem); }} />
          </>
        ))}
      </Menu>

      {deleteTarget && (
        <ConfirmDialog
          tone="danger"
          title={deleteTarget.type === 'folder' ? 'Delete folder' : 'Delete chapter'}
          message={deleteTarget.type === 'folder'
            ? <>The folder <strong className="text-text-primary">“{deleteTarget.name}”</strong> and every chapter inside it will be permanently deleted. This cannot be undone.</>
            : <>The chapter <strong className="text-text-primary">“{deleteTarget.title}”</strong> will be permanently deleted. This cannot be undone.</>}
          actions={[
            { label: 'Cancel', variant: 'ghost', onClick: () => setDeleteTarget(null) },
            { label: 'Delete', variant: 'danger', autoFocus: true, onClick: () => doDelete(deleteTarget) },
          ]}
          onClose={() => setDeleteTarget(null)}
        />
      )}

      {inWorldTarget && (
        <InWorldTextDialog
          workspaceId={workspaceId}
          document={inWorldTarget}
          electronAPI={electronAPI}
          showToast={showToast}
          onChanged={loadTree}
          onClose={() => setInWorldTarget(null)}
        />
      )}

      {exportFolderTarget && (
        <ExportBookModal
          folderTitle={exportFolderTarget.name}
          documents={childDocs(exportFolderTarget.id)}
          electronAPI={electronAPI}
          onClose={() => setExportFolderTarget(null)}
        />
      )}
    </div>
  );
}
