import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import WritingEditor, { DEFAULT_WRITING_DESK } from './WritingEditor';
import { importedContentToJson } from './writingExtensions';
import ConfirmDialog from './ui/ConfirmDialog';
import {
  Folder, FolderPlus, FilePlus, Upload, ChevronRight, ChevronDown,
  FileText, Trash2, FolderInput, PenLine,
  PanelLeftClose, PanelLeftOpen
} from 'lucide-react';

export default function WritingDeskView({ chat, electronAPI }) {
  const { settings, showToast } = useApp();
  const workspaceId = chat.id;
  const toolbarMode = settings?.interface?.writingToolbar === 'bubble' ? 'bubble' : 'fixed';
  const smartTypography = settings?.interface?.smartTypography ?? true;

  const [tree, setTree] = useState({ folders: [], documents: [] });
  const [expanded, setExpanded] = useState({});
  const [selectedDocId, setSelectedDocId] = useState(null);
  const [currentDoc, setCurrentDoc] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [moveMenuId, setMoveMenuId] = useState(null);
  const [dragItem, setDragItem] = useState(null);
  const [dropInfo, setDropInfo] = useState(null); // { id, zone: 'before'|'after'|'inside' }
  const sidebarKey = `wd-sidebar-collapsed-${workspaceId}`;
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem(sidebarKey) === '1');

  useEffect(() => {
    setSidebarCollapsed(localStorage.getItem(sidebarKey) === '1');
  }, [sidebarKey]);

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
  }, [electronAPI, workspaceId]);

  useEffect(() => { loadTree(); }, [loadTree]);

  useEffect(() => {
    if (!selectedDocId) { setCurrentDoc(null); return; }
    let active = true;
    electronAPI.getDocument(selectedDocId).then(d => { if (active) setCurrentDoc(d); });
    return () => { active = false; };
  }, [selectedDocId, electronAPI]);

  const newDocument = async (folderId = null) => {
    const doc = await electronAPI.createDocument(workspaceId, folderId, 'Untitled', null, DEFAULT_WRITING_DESK);
    await loadTree();
    setSelectedDocId(doc.id);
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
    if (doc?.id) setSelectedDocId(doc.id);
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
    if (item.type === 'folder') await electronAPI.deleteFolder(item.id);
    else {
      await electronAPI.deleteDocument(item.id);
      if (selectedDocId === item.id) { setSelectedDocId(null); setCurrentDoc(null); }
    }
    await loadTree();
  };

  const doMove = async (item, folderId) => {
    setMoveMenuId(null);
    if (item.type === 'folder') {
      if (folderId === item.id) return;
      await electronAPI.moveFolder(item.id, folderId);
    } else {
      await electronAPI.moveDocument(item.id, folderId);
    }
    await loadTree();
  };

  // Persist any per-document setting (page geometry, paper color, word goal).
  const onDocPatch = async (patch) => {
    if (!currentDoc) return;
    setCurrentDoc({ ...currentDoc, ...patch });
    await electronAPI.saveDocumentPage(currentDoc.id, patch);
  };

  const childFolders = (parentId) => tree.folders.filter(f => (f.parentId || null) === parentId);
  const childDocs = (folderId) => tree.documents.filter(d => (d.folderId || null) === folderId);

  // --- Drag & drop: reorder within a sibling group and move between folders ---
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

  // Reassign positions for `item`'s type group under `newParent`, with `item` inserted at `insertIndex`.
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

  const onRootDrop = (e) => {
    if (!dragItem) return;
    e.preventDefault();
    const item = dragItem;
    setDragItem(null);
    setDropInfo(null);
    commitOrder(item, null, null);
  };

  const dropLine = (item, zone) => (dropInfo && dropInfo.id === item.id && dropInfo.zone === zone
    ? <span className={`absolute left-2 right-2 h-0.5 bg-accent rounded ${zone === 'before' ? 'top-0' : 'bottom-0'}`} />
    : null);
  const dropInsideRing = (item) => (dropInfo && dropInfo.id === item.id && dropInfo.zone === 'inside' ? 'ring-1 ring-accent bg-accent/10' : '');

  const renderEditable = (item) => (
    <input
      autoFocus
      value={editValue}
      onChange={(e) => setEditValue(e.target.value)}
      onBlur={() => commitRename(item)}
      onKeyDown={(e) => { if (e.key === 'Enter') commitRename(item); if (e.key === 'Escape') setEditingId(null); }}
      className="bg-[#000d11] text-white text-xs rounded px-1 py-0.5 border border-accent/60 focus:outline-none w-full"
    />
  );

  const ItemActions = ({ item }) => (
    <span className="ml-auto items-center gap-0.5 hidden group-hover:flex shrink-0">
      <button title="Rename" onClick={(e) => { e.stopPropagation(); setEditingId(item.id); setEditValue(item.name || item.title); }} className="p-1 text-gray-500 hover:text-white"><PenLine className="w-3.5 h-3.5" /></button>
      <button title="Move to" onClick={(e) => { e.stopPropagation(); setMoveMenuId(moveMenuId === item.id ? null : item.id); }} className="p-1 text-gray-500 hover:text-white"><FolderInput className="w-3.5 h-3.5" /></button>
      <button title="Delete" onClick={(e) => { e.stopPropagation(); setDeleteTarget(item); }} className="p-1 text-gray-500 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
    </span>
  );

  const MoveMenu = ({ item }) => (
    <div className="absolute right-2 z-20 mt-1 w-44 bg-[#0a161d] border border-gray-800 rounded-lg shadow-xl py-1 text-xs">
      <div className="px-2 py-1 text-gray-500">Move to…</div>
      <button onClick={() => doMove(item, null)} className="w-full text-left px-2 py-1 text-gray-300 hover:bg-white/5">Root</button>
      {tree.folders.filter(f => f.id !== item.id).map(f => (
        <button key={f.id} onClick={() => doMove(item, f.id)} className="w-full text-left px-2 py-1 text-gray-300 hover:bg-white/5 truncate">{f.name}</button>
      ))}
    </div>
  );

  const renderFolder = (folder, depth) => {
    const isOpen = expanded[folder.id];
    return (
      <div key={folder.id}>
        <div
          draggable={editingId !== folder.id}
          onDragStart={(e) => { e.stopPropagation(); setDragItem({ id: folder.id, type: 'folder', parentId: folder.parentId || null }); }}
          onDragOver={(e) => onRowDragOver(e, { ...folder, type: 'folder' })}
          onDrop={(e) => onRowDrop(e, { ...folder, type: 'folder' })}
          onDragEnd={() => { setDragItem(null); setDropInfo(null); }}
          className={`group relative flex items-center gap-1 px-2 py-1 rounded-md hover:bg-white/5 cursor-pointer text-xs text-gray-300 ${dropInsideRing(folder)}`}
          style={{ paddingLeft: `${8 + depth * 12}px` }}
          onClick={() => setExpanded(e => ({ ...e, [folder.id]: !e[folder.id] }))}
        >
          {dropLine(folder, 'before')}
          {dropLine(folder, 'after')}
          {isOpen ? <ChevronDown className="w-3.5 h-3.5 shrink-0" /> : <ChevronRight className="w-3.5 h-3.5 shrink-0" />}
          <Folder className="w-3.5 h-3.5 shrink-0 text-gray-500" />
          {editingId === folder.id ? renderEditable({ ...folder, type: 'folder' }) : <span className="truncate">{folder.name}</span>}
          <ItemActions item={{ ...folder, type: 'folder' }} />
          {moveMenuId === folder.id && <MoveMenu item={{ ...folder, type: 'folder' }} />}
        </div>
        {isOpen && (
          <div>
            {childFolders(folder.id).map(f => renderFolder(f, depth + 1))}
            {childDocs(folder.id).map(d => renderDoc(d, depth + 1))}
            <button onClick={() => newDocument(folder.id)} className="flex items-center gap-1 text-[11px] text-gray-600 hover:text-gray-300 px-2 py-0.5" style={{ paddingLeft: `${8 + (depth + 1) * 12}px` }}>
              <FilePlus className="w-3 h-3" /> chapter
            </button>
          </div>
        )}
      </div>
    );
  };

  const renderDoc = (doc, depth) => (
    <div
      key={doc.id}
      draggable={editingId !== doc.id}
      onDragStart={(e) => { e.stopPropagation(); setDragItem({ id: doc.id, type: 'document', folderId: doc.folderId || null }); }}
      onDragOver={(e) => onRowDragOver(e, { ...doc, type: 'document' })}
      onDrop={(e) => onRowDrop(e, { ...doc, type: 'document' })}
      onDragEnd={() => { setDragItem(null); setDropInfo(null); }}
      className={`group relative flex items-center gap-1 px-2 py-1 rounded-md cursor-pointer text-xs ${selectedDocId === doc.id ? 'bg-accent/15 text-accent' : 'text-gray-300 hover:bg-white/5'}`}
      style={{ paddingLeft: `${8 + depth * 12 + 16}px` }}
      onClick={() => setSelectedDocId(doc.id)}
    >
      {dropLine(doc, 'before')}
      {dropLine(doc, 'after')}
      <FileText className="w-3.5 h-3.5 shrink-0" />
      {editingId === doc.id ? renderEditable({ ...doc, type: 'document' }) : <span className="truncate">{doc.title}</span>}
      <ItemActions item={{ ...doc, type: 'document', name: doc.title }} />
      {moveMenuId === doc.id && <MoveMenu item={{ ...doc, type: 'document' }} />}
    </div>
  );

  return (
    <div className="flex-1 flex overflow-hidden bg-[#000508]/40 select-none relative">
      {/* Collapsed: thin rail with a reopen handle + quick new-chapter */}
      {sidebarCollapsed && (
        <div className="w-10 shrink-0 border-r border-gray-800/40 flex flex-col items-center py-3 gap-1 bg-[#011419]/25">
          <button title="Show chapters" onClick={toggleSidebar} className="p-1.5 text-gray-400 hover:text-white hover:bg-white/5 rounded-md"><PanelLeftOpen className="w-4 h-4" /></button>
          <button title="New chapter" onClick={() => newDocument(null)} className="p-1.5 text-gray-400 hover:text-white hover:bg-white/5 rounded-md"><FilePlus className="w-4 h-4" /></button>
        </div>
      )}

      {/* Chapter tree */}
      {!sidebarCollapsed && (
      <div className="w-60 shrink-0 border-r border-gray-800/40 flex flex-col bg-[#011419]/25">
        <div className="flex items-center gap-1 px-3 py-3 border-b border-gray-800/80 bg-[#011419]/35">
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-500 mr-auto">Chapters</span>
          <button title="New chapter" onClick={() => newDocument(null)} className="p-1.5 text-gray-400 hover:text-white hover:bg-white/5 rounded-md"><FilePlus className="w-4 h-4" /></button>
          <button title="New folder" onClick={() => newFolder(null)} className="p-1.5 text-gray-400 hover:text-white hover:bg-white/5 rounded-md"><FolderPlus className="w-4 h-4" /></button>
          <button title="Import .docx/.pdf" onClick={importDocument} className="p-1.5 text-gray-400 hover:text-white hover:bg-white/5 rounded-md"><Upload className="w-4 h-4" /></button>
          <button title="Hide chapters" onClick={toggleSidebar} className="p-1.5 text-gray-400 hover:text-white hover:bg-white/5 rounded-md"><PanelLeftClose className="w-4 h-4" /></button>
        </div>
        <div
          className="flex-1 overflow-y-auto custom-scrollbar py-1 flex flex-col"
          onDragOver={(e) => { if (dragItem) e.preventDefault(); }}
          onDrop={onRootDrop}
        >
          {childFolders(null).map(f => renderFolder(f, 0))}
          {childDocs(null).map(d => renderDoc(d, 0))}
          {tree.folders.length === 0 && tree.documents.length === 0 && (
            <p className="text-xs text-gray-600 px-3 py-4 leading-relaxed">No chapters yet. Create one with the + above, or import a .docx/.pdf.</p>
          )}
          {/* Fills remaining space so there's always a drop target to send items back to the root. */}
          <div
            className="flex-1 min-h-[32px]"
            onDragOver={(e) => { if (dragItem) { e.preventDefault(); setDropInfo({ id: '__root__', zone: 'inside' }); } }}
            onDrop={onRootDrop}
          >
            {dragItem && dropInfo?.id === '__root__' && (
              <div className="mx-2 mt-1 border border-dashed border-accent/60 rounded-md py-1.5 text-center text-[10px] text-accent/80">Move to root</div>
            )}
          </div>
        </div>
      </div>
      )}

      {/* Editor */}
      {currentDoc ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          <WritingEditor
            key={currentDoc.id}
            doc={currentDoc}
            electronAPI={electronAPI}
            toolbarMode={toolbarMode}
            smartTypography={smartTypography}
            onDocPatch={onDocPatch}
            onRename={(title) => {
              setCurrentDoc({ ...currentDoc, title });
              electronAPI.renameDocument(currentDoc.id, title).then(loadTree);
            }}
          />
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
          Select or create a chapter to start writing.
        </div>
      )}

      {deleteTarget && (
        <ConfirmDialog
          tone="danger"
          title={deleteTarget.type === 'folder' ? 'Delete folder' : 'Delete chapter'}
          message={deleteTarget.type === 'folder'
            ? <>The folder <strong className="text-gray-200">“{deleteTarget.name}”</strong> and every chapter inside it will be permanently deleted. This cannot be undone.</>
            : <>The chapter <strong className="text-gray-200">“{deleteTarget.title}”</strong> will be permanently deleted. This cannot be undone.</>}
          actions={[
            { label: 'Cancel', variant: 'ghost', onClick: () => setDeleteTarget(null) },
            { label: 'Delete', variant: 'danger', autoFocus: true, onClick: () => doDelete(deleteTarget) },
          ]}
          onClose={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
