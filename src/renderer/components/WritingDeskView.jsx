import React, { useState, useEffect, useCallback } from 'react';
import { useApp } from '../context/AppContext';
import WritingEditor, { SheetControls, DEFAULT_WRITING_DESK } from './WritingEditor';
import {
  Folder, FolderPlus, FilePlus, Upload, ChevronRight, ChevronDown,
  FileText, Trash2, Check, X, FolderInput, PenLine, Settings2,
  PanelLeftClose, PanelLeftOpen
} from 'lucide-react';

export default function WritingDeskView({ chat, electronAPI }) {
  const { settings, showToast } = useApp();
  const workspaceId = chat.id;
  const toolbarMode = settings?.interface?.writingToolbar === 'bubble' ? 'bubble' : 'fixed';

  const [tree, setTree] = useState({ folders: [], documents: [] });
  const [expanded, setExpanded] = useState({});
  const [selectedDocId, setSelectedDocId] = useState(null);
  const [currentDoc, setCurrentDoc] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editValue, setEditValue] = useState('');
  const [confirmDeleteId, setConfirmDeleteId] = useState(null);
  const [moveMenuId, setMoveMenuId] = useState(null);
  const [wdConfig, setWdConfig] = useState(DEFAULT_WRITING_DESK);
  const [showWsSettings, setShowWsSettings] = useState(false);
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

  // Per-workspace Writing Desk defaults (new chapters inherit these).
  useEffect(() => {
    let active = true;
    electronAPI.getWritingDeskConfig(workspaceId).then(cfg => {
      if (active) setWdConfig({ ...DEFAULT_WRITING_DESK, ...(cfg || {}) });
    });
    return () => { active = false; };
  }, [electronAPI, workspaceId]);

  const onWsConfigChange = async (patch) => {
    const next = { ...wdConfig, ...patch };
    setWdConfig(next);
    await electronAPI.saveWritingDeskConfig(workspaceId, next);
  };

  useEffect(() => {
    if (!selectedDocId) { setCurrentDoc(null); return; }
    let active = true;
    electronAPI.getDocument(selectedDocId).then(d => { if (active) setCurrentDoc(d); });
    return () => { active = false; };
  }, [selectedDocId, electronAPI]);

  const newDocument = async (folderId = null) => {
    const doc = await electronAPI.createDocument(workspaceId, folderId, 'Untitled', null, wdConfig);
    await loadTree();
    setSelectedDocId(doc.id);
  };

  const newFolder = async (parentId = null) => {
    await electronAPI.createFolder(workspaceId, 'New folder', parentId);
    await loadTree();
  };

  const importDocument = async () => {
    const res = await electronAPI.importDocument(workspaceId, null, wdConfig);
    if (res?.canceled) return;
    if (res?.error) { showToast(`Import failed: ${res.error}`, 'error'); return; }
    await loadTree();
    if (res?.document) setSelectedDocId(res.document.id);
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
    setConfirmDeleteId(null);
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

  const onSheetChange = async (patch) => {
    if (!currentDoc) return;
    setCurrentDoc({ ...currentDoc, ...patch });
    await electronAPI.saveDocumentPage(currentDoc.id, patch);
  };

  const childFolders = (parentId) => tree.folders.filter(f => (f.parentId || null) === parentId);
  const childDocs = (folderId) => tree.documents.filter(d => (d.folderId || null) === folderId);

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
      {confirmDeleteId === item.id ? (
        <>
          <button title="Confirm delete" onClick={(e) => { e.stopPropagation(); doDelete(item); }} className="p-1 text-red-400 hover:text-red-300"><Check className="w-3.5 h-3.5" /></button>
          <button title="Cancel" onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(null); }} className="p-1 text-gray-500 hover:text-white"><X className="w-3.5 h-3.5" /></button>
        </>
      ) : (
        <button title="Delete" onClick={(e) => { e.stopPropagation(); setConfirmDeleteId(item.id); }} className="p-1 text-gray-500 hover:text-red-400"><Trash2 className="w-3.5 h-3.5" /></button>
      )}
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
          className="group relative flex items-center gap-1 px-2 py-1 rounded-md hover:bg-white/5 cursor-pointer text-xs text-gray-300"
          style={{ paddingLeft: `${8 + depth * 12}px` }}
          onClick={() => setExpanded(e => ({ ...e, [folder.id]: !e[folder.id] }))}
        >
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
      className={`group relative flex items-center gap-1 px-2 py-1 rounded-md cursor-pointer text-xs ${selectedDocId === doc.id ? 'bg-accent/15 text-accent' : 'text-gray-300 hover:bg-white/5'}`}
      style={{ paddingLeft: `${8 + depth * 12 + 16}px` }}
      onClick={() => setSelectedDocId(doc.id)}
    >
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
          <button title="Workspace page defaults" onClick={() => setShowWsSettings(s => !s)} className={`p-1.5 rounded-md ${showWsSettings ? 'text-accent bg-white/5' : 'text-gray-400 hover:text-white hover:bg-white/5'}`}><Settings2 className="w-4 h-4" /></button>
          <button title="Hide chapters" onClick={toggleSidebar} className="p-1.5 text-gray-400 hover:text-white hover:bg-white/5 rounded-md"><PanelLeftClose className="w-4 h-4" /></button>
        </div>
        <div className="flex-1 overflow-y-auto custom-scrollbar py-1">
          {childFolders(null).map(f => renderFolder(f, 0))}
          {childDocs(null).map(d => renderDoc(d, 0))}
          {tree.folders.length === 0 && tree.documents.length === 0 && (
            <p className="text-xs text-gray-600 px-3 py-4 leading-relaxed">No chapters yet. Create one with the + above, or import a .docx/.pdf.</p>
          )}
        </div>
      </div>
      )}

      {/* Editor */}
      {currentDoc ? (
        <div className="flex-1 flex flex-col overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-800/80 bg-[#011419]/35 shrink-0">
            <input
              value={currentDoc.title}
              onChange={(e) => setCurrentDoc({ ...currentDoc, title: e.target.value })}
              onBlur={() => electronAPI.renameDocument(currentDoc.id, currentDoc.title).then(loadTree)}
              className="bg-transparent text-white font-semibold text-sm focus:outline-none w-full"
            />
          </div>
          <WritingEditor
            key={currentDoc.id}
            doc={currentDoc}
            electronAPI={electronAPI}
            toolbarMode={toolbarMode}
            onSheetChange={onSheetChange}
          />
        </div>
      ) : (
        <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
          Select or create a chapter to start writing.
        </div>
      )}

      {/* Per-workspace page defaults: applied to every NEW chapter in this workspace. */}
      {showWsSettings && (
        <>
          <div className="absolute inset-0 z-20" onClick={() => setShowWsSettings(false)} />
          <div className="absolute top-2 left-[15.5rem] z-30 w-[620px] max-w-[calc(100%-16rem)] bg-[#0a161d] border border-gray-800 rounded-xl shadow-2xl">
            <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800/80">
              <span className="text-xs font-bold uppercase tracking-wider text-gray-400">Workspace Page Defaults</span>
              <button onClick={() => setShowWsSettings(false)} className="p-1 text-gray-500 hover:text-white"><X className="w-4 h-4" /></button>
            </div>
            <p className="px-4 pt-2.5 text-[11px] text-gray-500 leading-relaxed">New chapters in this workspace inherit these settings. Existing chapters keep their own page settings.</p>
            <SheetControls doc={wdConfig} onSheetChange={onWsConfigChange} />
          </div>
        </>
      )}
    </div>
  );
}
