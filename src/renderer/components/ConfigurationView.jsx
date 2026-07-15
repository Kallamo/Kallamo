import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { HelpCircle, Trash2, Plus, Edit, Image as ImageIcon, Check, AlertTriangle, Cpu, Workflow, Brain, PenTool, Palette, Send } from 'lucide-react';
import ProfileModal from './modals/ProfileModal';
import WorkflowModal from './modals/WorkflowModal';

const safeParseJson = (str, fallback = []) => {
  if (!str) return fallback;
  if (typeof str !== 'string') return str;
  try {
    const parsed = JSON.parse(str);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch (e) {
    console.error("safeParseJson error:", e);
    return fallback;
  }
};

const SECTIONS = [
  { id: 'agents', label: 'Profiles & Workflows', icon: Cpu },
  { id: 'context', label: 'Context & Memory', icon: Brain },
  { id: 'writing', label: 'Writing Desk', icon: PenTool },
  { id: 'appearance', label: 'Appearance', icon: Palette },
];

export default function ConfigurationView({ onTriggerSummarize }) {
  const {
    activeChat,
    handleSaveChat,
    writingProfiles,
    workflows,
    activeMessages,
    electronAPI,
    refreshChats,
    showToast
  } = useApp();

  const [showProfileModal, setShowProfileModal] = useState(false);
  const [showWorkflowModal, setShowWorkflowModal] = useState(false);

  const [searchProfiles, setSearchProfiles] = useState('');
  const [searchWorkflows, setSearchWorkflows] = useState('');

  const [editingBlockId, setEditingBlockId] = useState(null);
  const [editingBlockTitle, setEditingBlockTitle] = useState('');

  const [maxContext, setMaxContext] = useState(128000);
  const [wdContextWindow, setWdContextWindow] = useState(8192);
  const [wdUseChatHistory, setWdUseChatHistory] = useState(true);
  const [archiveThreshold, setArchiveThreshold] = useState(60000);
  const [autoSummarize, setAutoSummarize] = useState(false);
  const [showContextBar, setShowContextBar] = useState(false);
  const [memoryBlocks, setMemoryBlocks] = useState([]);
  const [archiveMessages, setArchiveMessages] = useState([]);

  const [activeSection, setActiveSection] = useState('agents');

  const bgInputRef = useRef(null);
  const scrollRef = useRef(null);
  const sectionRefs = useRef({});

  useEffect(() => {
    if (activeChat) {
      setMaxContext(activeChat.maxContext ?? 128000);
      setWdContextWindow(activeChat.wdContextWindow ?? 8192);
      setWdUseChatHistory(activeChat.wdUseChatHistory !== 0);
      setArchiveThreshold(activeChat.archiveThreshold ?? 60000);
      setAutoSummarize(activeChat.autoSummarize === 1);
      setShowContextBar(activeChat.showContextBar === 1);
      setMemoryBlocks(activeChat.memoryBlocks ? (typeof activeChat.memoryBlocks === 'string' ? JSON.parse(activeChat.memoryBlocks) : activeChat.memoryBlocks) : []);
    }
  }, [activeChat]);

  useEffect(() => {
    let cancelled = false;

    if (!activeChat?.id) {
      setArchiveMessages([]);
      return undefined;
    }

    const loadArchiveMessages = async () => {
      const messages = await electronAPI.getChatMessages(activeChat.id);
      if (!cancelled) setArchiveMessages(messages);
    };

    loadArchiveMessages();
    return () => {
      cancelled = true;
    };
  }, [activeChat?.id, activeMessages, electronAPI]);

  // Scroll-spy: pick the section whose top has crossed a line near the top of the
  // viewport. Bottom-of-scroll always activates the last section, so short trailing
  // sections (Appearance) still light up when the user reaches the end.
  const handleScroll = () => {
    const root = scrollRef.current;
    if (!root) return;
    const { scrollTop, scrollHeight, clientHeight } = root;
    if (scrollTop + clientHeight >= scrollHeight - 4) {
      setActiveSection(SECTIONS[SECTIONS.length - 1].id);
      return;
    }
    const rootRect = root.getBoundingClientRect();
    const line = rootRect.top + rootRect.height * 0.28;
    let current = SECTIONS[0].id;
    for (const sec of SECTIONS) {
      const el = sectionRefs.current[sec.id];
      if (el && el.getBoundingClientRect().top <= line) current = sec.id;
    }
    setActiveSection(current);
  };

  if (!activeChat) return null;

  const scrollToSection = (id) => {
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Number fields keep numeric state; empty input falls back to 0 on save.
  const handleUpdateNumberField = async (field, value) => {
    const num = value === '' ? 0 : Number(value);
    const updated = { ...activeChat, [field]: Number.isNaN(num) ? 0 : num };
    await handleSaveChat(updated);
  };

  const handleToggleAutoSummarize = async (checked) => {
    setAutoSummarize(checked);
    const updated = { ...activeChat, autoSummarize: checked ? 1 : 0 };
    await handleSaveChat(updated);
  };

  const handleToggleContextBar = async (checked) => {
    setShowContextBar(checked);
    const updated = { ...activeChat, showContextBar: checked ? 1 : 0 };
    await handleSaveChat(updated);
  };

  const handleToggleWdChatHistory = async (checked) => {
    setWdUseChatHistory(checked);
    const updated = { ...activeChat, wdUseChatHistory: checked ? 1 : 0 };
    await handleSaveChat(updated);
  };

  const handleAppearanceChange = async (field, value) => {
    const updated = { ...activeChat, [field]: value, updatedAt: Date.now() };
    await handleSaveChat(updated);
  };

  const handleBgImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const destBgPath = await electronAPI.uploadChatBgImage(activeChat.id, file.path || '', file.name);
      await handleAppearanceChange('backgroundImage', destBgPath);
    } catch (err) {
      console.error("Error uploading cover image:", err);
    }
  };

  const handleRemoveBgImage = async () => {
    await handleAppearanceChange('backgroundImage', '');
  };

  const handleSummarizeNow = () => {
    if (!activeChat) return;
    const startIndex = activeChat.summarizedIndex || 0;
    const activeMsgs = activeMessages.slice(startIndex);
    if (activeMsgs.length === 0) {
      showToast("All messages are already archived!", 'info');
      return;
    }
    if (onTriggerSummarize) onTriggerSummarize();
  };

  const activeProfilesList = safeParseJson(activeChat.activeProfiles);
  const activeWorkflowsList = safeParseJson(activeChat.activeWorkflows);

  const toggleProfile = async (profileId) => {
    const updatedList = activeProfilesList.includes(profileId)
      ? activeProfilesList.filter(id => id !== profileId)
      : [...activeProfilesList, profileId];
    const updated = { ...activeChat, activeProfiles: JSON.stringify(updatedList) };
    await handleSaveChat(updated);
  };

  const toggleWorkflow = async (workflowId) => {
    const updatedList = activeWorkflowsList.includes(workflowId)
      ? activeWorkflowsList.filter(id => id !== workflowId)
      : [...activeWorkflowsList, workflowId];
    const updated = { ...activeChat, activeWorkflows: JSON.stringify(updatedList) };
    await handleSaveChat(updated);
  };

  const deleteMemoryBlock = async (blockId) => {
    try {
      const targetBlock = memoryBlocks.find(b => b.id === blockId);
      if (targetBlock && electronAPI.deleteChatKbBlock) {
        await electronAPI.deleteChatKbBlock(activeChat.id, {
          id: targetBlock.id,
          type: targetBlock.type,
          source: targetBlock.title,
          text: targetBlock.summary
        });
      }
      if (refreshChats) await refreshChats(activeChat.id);
    } catch (e) {
      console.error(e);
    }
  };

  const renameMemoryBlock = async (blockId, newTitle) => {
    if (!newTitle.trim()) return;
    try {
      const targetBlock = memoryBlocks.find(b => b.id === blockId);
      if (targetBlock) {
        const updatedBlocks = memoryBlocks.map(b => b.id === blockId ? { ...b, title: newTitle.trim() } : b);
        const updated = { ...activeChat, memoryBlocks: JSON.stringify(updatedBlocks) };
        await handleSaveChat(updated);

        if (electronAPI.saveChatKbBlock) {
          await electronAPI.saveChatKbBlock(activeChat.id, {
            id: targetBlock.id,
            type: targetBlock.type === 'snippet' ? 'manual' : targetBlock.type,
            source: newTitle.trim(),
            text: targetBlock.summary || targetBlock.text || '',
            profiles: targetBlock.profiles || []
          });
        }
        if (refreshChats) await refreshChats(activeChat.id);
      }
      setEditingBlockId(null);
    } catch (e) {
      console.error(e);
    }
  };

  const filteredProfiles = writingProfiles.filter(p =>
    p.name.toLowerCase().includes(searchProfiles.toLowerCase())
  );
  const filteredWorkflows = workflows.filter(wf =>
    wf.name.toLowerCase().includes(searchWorkflows.toLowerCase())
  );

  let tokensUsed = 0;
  const estimateTokens = (str) => Math.ceil((str || '').length / 4);
  const startIndex = activeChat.summarizedIndex || 0;
  const activeMsgs = archiveMessages.slice(startIndex);
  activeMsgs.forEach(m => { tokensUsed += estimateTokens(m.content); });
  const activeMessageCount = activeMsgs.length;
  const percentage = Math.min((tokensUsed / archiveThreshold) * 100, 100);

  const bgImage = activeChat.backgroundImage || '';
  const backdropOpacity = activeChat.backdropOpacity ?? 75;
  const userBubbleOpacity = activeChat.userBubbleOpacity ?? 100;
  const aiBubbleOpacity = activeChat.aiBubbleOpacity ?? 0;

  const activeProfilesCount = writingProfiles.filter(p => activeProfilesList.includes(p.id)).length;
  const activeWorkflowsCount = workflows.filter(w => activeWorkflowsList.includes(w.id)).length;

  const inputClass = "w-full bg-[#011419] border border-gray-800 text-gray-200 text-sm rounded-lg px-3 py-2.5 focus:outline-none focus:border-accent transition-colors";
  const fieldLabel = "block text-[10px] font-semibold text-gray-400 uppercase tracking-wider";

  const registerSection = (id) => (el) => { sectionRefs.current[id] = el; };

  const SectionHead = ({ icon: Icon, title, desc, action }) => (
    <div className="flex items-start justify-between mb-5">
      <div className="flex items-start space-x-3">
        <div className="w-9 h-9 rounded-lg bg-accent/10 border border-accent/20 flex items-center justify-center shrink-0">
          <Icon className="w-4.5 h-4.5 text-accent" />
        </div>
        <div>
          <h3 className="text-sm font-bold text-white uppercase tracking-wider">{title}</h3>
          {desc && <p className="caption mt-0.5">{desc}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );

  const newButton = (onClick) => (
    <button
      onClick={onClick}
      className="text-[9px] font-bold text-accent hover:bg-accent/10 uppercase flex items-center space-x-1 cursor-pointer bg-[#011419] px-2.5 py-1.5 rounded-lg border border-accent/20 transition-colors"
    >
      <Plus className="w-2.5 h-2.5" />
      <span>New</span>
    </button>
  );

  return (
    <div className="flex w-full h-full bg-[#011419] overflow-hidden">
      {/* Scroll-spy navigation column */}
      <nav className="w-56 shrink-0 border-r border-gray-800/50 py-8 px-4 bg-[#040d12]/50 flex flex-col select-none">
        <span className="block text-[10px] font-bold text-gray-500 uppercase tracking-widest px-3 mb-4">Configuration</span>
        <div className="space-y-0.5">
          {SECTIONS.map(sec => {
            const isActive = activeSection === sec.id;
            const Icon = sec.icon;
            return (
              <button
                key={sec.id}
                onClick={() => scrollToSection(sec.id)}
                className={`w-full text-left flex items-center space-x-2.5 pl-3 pr-2 py-2.5 rounded-md text-xs font-semibold transition-colors cursor-pointer border-l-2 ${isActive
                  ? 'border-accent text-accent bg-accent/5'
                  : 'border-transparent text-gray-400 hover:text-white hover:bg-white/5'
                  }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-accent' : 'text-gray-500'}`} />
                <span>{sec.label}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-auto pt-6 pb-20 px-3">
          <div className="rounded-lg border border-gray-800/60 bg-[#011419]/60 p-3">
            <p className="caption">
              Everything here affects only the workspace <span className="text-accent/80 font-semibold">{activeChat.title}</span>.
            </p>
          </div>
        </div>
      </nav>

      {/* Single scrolling content pane */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="max-w-3xl mx-auto px-10 py-9 space-y-6">

          {/* Page header */}
          <header className="pb-1">
            <span className="text-[10px] font-bold text-accent/70 uppercase tracking-[0.2em]">Workspace Configuration</span>
            <h1 className="text-2xl font-bold text-white mt-1.5 tracking-tight">{activeChat.title}</h1>
            <div className="mt-4 h-px bg-gradient-to-r from-accent/40 via-gray-800/60 to-transparent" />
          </header>

          {/* Profiles & Workflows */}
          <section ref={registerSection('agents')} data-section="agents" className="scroll-mt-6">
            <div className="bg-[#0a161d]/50 border border-gray-800/60 rounded-2xl p-6">
              <SectionHead
                icon={Cpu}
                title="Profiles & Workflows"
                desc="Toggle which AI Profiles and Workflows this workspace can run."
              />
              <div className="grid grid-cols-2 gap-6">
                {/* Profiles column */}
                <div>
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="text-[10px] font-bold text-gray-300 uppercase tracking-wider flex items-center space-x-1.5">
                      <span>Profiles</span>
                      <span className="text-accent/70 font-mono">{activeProfilesCount}</span>
                    </span>
                    {newButton(() => setShowProfileModal(true))}
                  </div>
                  <input
                    type="text"
                    value={searchProfiles}
                    onChange={(e) => setSearchProfiles(e.target.value)}
                    placeholder="Filter profiles..."
                    className="w-full bg-[#011419] border border-gray-800 text-gray-300 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-accent mb-2.5"
                  />
                  <div className="space-y-2 max-h-[21rem] overflow-y-auto custom-scrollbar pr-1">
                    {filteredProfiles.length === 0 ? (
                      <span className="caption italic block">No profiles found</span>
                    ) : (
                      filteredProfiles.map(p => {
                        const isActive = activeProfilesList.includes(p.id);
                        if (p.needsSetup) {
                          return (
                            <div key={p.id} className="relative flex items-center justify-between p-2.5 rounded-lg bg-[#011419] border border-gray-800">
                              <div className="flex items-center space-x-2 overflow-hidden mr-2">
                                <span className="w-2.5 h-2.5 rounded-full shrink-0 opacity-40" style={{ backgroundColor: p.color }} />
                                <span className="text-xs text-gray-500 truncate">{p.name}</span>
                              </div>
                              <div className="relative group/warning flex items-center shrink-0">
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-500 cursor-help" />
                                <div className="absolute top-full right-0 mt-2.5 w-56 p-3 text-[10px] leading-relaxed text-amber-200 bg-[#1a0f02] border border-amber-900/50 rounded-lg shadow-xl invisible opacity-0 pointer-events-none group-hover/warning:visible group-hover/warning:opacity-100 transition-all duration-200 z-50 select-none font-semibold text-center">
                                  To activate: create an API profile in Settings, then link it to this profile in the Library.
                                </div>
                              </div>
                            </div>
                          );
                        }
                        return (
                          <label key={p.id} className="flex items-center justify-between p-2.5 rounded-lg bg-[#011419] border border-gray-800 hover:border-gray-700 cursor-pointer transition-colors">
                            <div className="flex items-center space-x-2 overflow-hidden mr-2">
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                              <span className="text-xs text-gray-200 truncate">{p.name}</span>
                            </div>
                            <div className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95 shrink-0 ${isActive ? 'bg-accent border-accent text-[#011419] shadow-[0_0_8px_rgba(221,186,110,0.4)]' : 'border-gray-700 bg-[#011419]/90 hover:border-accent/50'}`}>
                              {isActive && <Check className="w-2.5 h-2.5 text-[#011419] stroke-[3.5]" />}
                            </div>
                            <input type="checkbox" checked={isActive} onChange={() => toggleProfile(p.id)} className="hidden" />
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Workflows column */}
                <div>
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="text-[10px] font-bold text-gray-300 uppercase tracking-wider flex items-center space-x-1.5">
                      <span>Workflows</span>
                      <span className="text-accent/70 font-mono">{activeWorkflowsCount}</span>
                    </span>
                    {newButton(() => setShowWorkflowModal(true))}
                  </div>
                  <input
                    type="text"
                    value={searchWorkflows}
                    onChange={(e) => setSearchWorkflows(e.target.value)}
                    placeholder="Filter workflows..."
                    className="w-full bg-[#011419] border border-gray-800 text-gray-300 text-xs rounded-lg px-3 py-1.5 focus:outline-none focus:border-accent mb-2.5"
                  />
                  <div className="space-y-2 max-h-[21rem] overflow-y-auto custom-scrollbar pr-1">
                    {filteredWorkflows.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-6 px-3 border border-dashed border-gray-800/70 rounded-lg text-center">
                        <Workflow className="w-5 h-5 text-gray-700 mb-2" />
                        <span className="caption italic">No workflows yet</span>
                      </div>
                    ) : (
                      filteredWorkflows.map(wf => {
                        const isActive = activeWorkflowsList.includes(wf.id);
                        return (
                          <label key={wf.id} className="flex items-center justify-between p-2.5 rounded-lg bg-[#011419] border border-gray-800 hover:border-gray-700 cursor-pointer transition-colors">
                            <span className="text-xs text-gray-200 truncate mr-2">{wf.name}</span>
                            <div className={`w-3.5 h-3.5 rounded-sm border flex items-center justify-center transition-all duration-200 hover:scale-105 active:scale-95 shrink-0 ${isActive ? 'bg-accent border-accent text-[#011419] shadow-[0_0_8px_rgba(221,186,110,0.4)]' : 'border-gray-700 bg-[#011419]/90 hover:border-accent/50'}`}>
                              {isActive && <Check className="w-2.5 h-2.5 text-[#011419] stroke-[3.5]" />}
                            </div>
                            <input type="checkbox" checked={isActive} onChange={() => toggleWorkflow(wf.id)} className="hidden" />
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              </div>
            </div>
          </section>

          {/* Context & Memory */}
          <section ref={registerSection('context')} data-section="context" className="scroll-mt-6">
            <div className="bg-[#0a161d]/50 border border-gray-800/60 rounded-2xl p-6">
              <SectionHead
                icon={Brain}
                title="Context & Memory"
                desc="How much history the model sees, and when older messages get archived."
              />
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <div className="flex items-center space-x-1.5 mb-1.5">
                    <label className={fieldLabel}>Max API Payload (Tokens)</label>
                    <HelpCircle className="w-3.5 h-3.5 text-gray-500 cursor-help shrink-0" data-tooltip="The absolute maximum number of tokens sent to the API. If the context (Lore + Chat + Current Message) exceeds this, older chat messages are silently truncated to prevent API rejection." />
                  </div>
                  <input
                    type="number"
                    value={maxContext}
                    onChange={(e) => setMaxContext(e.target.value)}
                    onBlur={() => handleUpdateNumberField('maxContext', maxContext)}
                    onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
                    className={inputClass}
                  />
                </div>
                <div>
                  <div className="flex items-center space-x-1.5 mb-1.5">
                    <label className={fieldLabel}>Archive Threshold</label>
                    <HelpCircle className="w-3.5 h-3.5 text-gray-500 cursor-help shrink-0" data-tooltip="The visual limit for active chat memory. Reaching this prompts you to summarize and move older messages to the Vector DB, keeping the active context clean." />
                  </div>
                  <input
                    type="number"
                    value={archiveThreshold}
                    onChange={(e) => setArchiveThreshold(e.target.value)}
                    onBlur={() => handleUpdateNumberField('archiveThreshold', archiveThreshold)}
                    onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
                    className={inputClass}
                  />
                </div>
              </div>

              {/* Full-width active context usage bar */}
              <div className="bg-[#011419] border border-gray-800 rounded-lg px-3.5 py-3 mb-3">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <span className={fieldLabel}>Active Context Usage</span>
                  <div className="flex items-center gap-2 text-[10px] text-gray-500 font-mono whitespace-nowrap">
                    <span>{activeMessageCount} {activeMessageCount === 1 ? 'message' : 'messages'}</span>
                    <span className="text-gray-700">•</span>
                    <span>~{tokensUsed} / {archiveThreshold} tokens</span>
                  </div>
                </div>
                <div className="w-full h-2.5 bg-gray-800 rounded-full overflow-hidden shadow-inner">
                  <div
                    style={{ width: `${percentage}%` }}
                    className={`h-full transition-all duration-500 ease-out ${percentage >= 95 ? 'bg-red-500' : percentage >= 75 ? 'bg-orange-500' : 'bg-accent'}`}
                  />
                </div>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-800/70">
                  <div className="pr-4">
                    <span className="text-xs text-gray-200 font-semibold">Show this bar at the top of the chat</span>
                    <p className="caption mt-0.5">Adds a thin usage bar under the chat header so you can watch the context fill as you write.</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={showContextBar}
                      onChange={(e) => handleToggleContextBar(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-7 h-4 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-300 after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-accent"></div>
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-between bg-[#011419] border border-gray-800 rounded-lg px-3.5 py-2.5 mb-3">
                <div className="pr-4">
                  <span className="text-xs text-gray-200 font-semibold">Auto-Summarize</span>
                  <p className="caption mt-0.5">Archive older messages automatically when the threshold is hit.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={autoSummarize}
                    onChange={(e) => handleToggleAutoSummarize(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-7 h-4 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-300 after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-accent"></div>
                </label>
              </div>

              <button
                onClick={handleSummarizeNow}
                className="w-full bg-[#1a2d32] hover:bg-[#243b52] text-accent border border-accent/30 py-2.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer"
              >
                Summarize Now
              </button>

              {memoryBlocks.filter(b => b.type !== 'manual').length > 0 && (
                <div className="space-y-2 mt-4 pt-4 border-t border-gray-800/80">
                  <span className="block text-[9px] font-bold text-gray-500 uppercase tracking-wider mb-1.5">Summarization Blocks</span>
                  <div className="grid grid-cols-2 gap-2">
                    {memoryBlocks.filter(b => b.type !== 'manual').map(block => (
                      <div key={block.id} className="bg-[#011419] border border-gray-800/80 rounded-lg p-3 relative group">
                        {editingBlockId === block.id ? (
                          <div className="flex items-center space-x-1.5 mt-0.5 mb-1.5">
                            <input
                              type="text"
                              value={editingBlockTitle}
                              onChange={(e) => setEditingBlockTitle(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') renameMemoryBlock(block.id, editingBlockTitle);
                                else if (e.key === 'Escape') setEditingBlockId(null);
                              }}
                              onBlur={() => renameMemoryBlock(block.id, editingBlockTitle)}
                              className="bg-[#051116] border border-gray-800 text-[10px] text-accent font-bold uppercase rounded px-1.5 py-0.5 w-full focus:outline-none focus:border-accent"
                              autoFocus
                            />
                          </div>
                        ) : (
                          <div className="flex items-center justify-between pr-6 mb-1">
                            <div
                              onClick={() => { setEditingBlockId(block.id); setEditingBlockTitle(block.title); }}
                              className="group/title text-[10px] font-bold text-accent uppercase truncate cursor-pointer hover:underline flex items-center space-x-1"
                              title="Click to rename"
                            >
                              <span className="truncate">{block.title}</span>
                              <Edit className="w-2.5 h-2.5 text-gray-500 opacity-0 group-hover/title:opacity-100 transition-opacity" />
                            </div>
                          </div>
                        )}
                        <p className="caption line-clamp-2">{block.summary}</p>
                        <button
                          onClick={() => deleteMemoryBlock(block.id)}
                          className="absolute top-2 right-2 p-1 text-gray-600 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                          title="Delete Memory"
                        >
                          <Trash2 className="w-3 h-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </section>

          {/* Writing Desk */}
          <section ref={registerSection('writing')} data-section="writing" className="scroll-mt-6">
            <div className="bg-[#0a161d]/50 border border-gray-800/60 rounded-2xl p-6">
              <SectionHead
                icon={PenTool}
                title="Writing Desk"
                desc="How much of your chapter the AI reads when you ask it to help with a highlighted passage."
              />
              <div className="grid grid-cols-1 md:grid-cols-2 gap-x-8 gap-y-2 items-start">
                <div>
                  <label className={`${fieldLabel} mb-1.5`}>Reading Size (Max Tokens)</label>
                  <input
                    type="number"
                    min="1024"
                    step="1024"
                    value={wdContextWindow}
                    onChange={(e) => setWdContextWindow(e.target.value)}
                    onBlur={() => handleUpdateNumberField('wdContextWindow', wdContextWindow)}
                    onKeyDown={(e) => e.key === 'Enter' && e.target.blur()}
                    className={inputClass}
                  />
                </div>
                <p className="caption">
                  Sets how much text the AI takes in at once. When a chapter fits within this limit, the AI reads it in full; when it's larger, the AI concentrates on the passage around your selection along with relevant notes, keeping responses fast and focused. Lower it if you want tighter, more predictable context.
                </p>
              </div>

              <div className="flex items-center justify-between bg-[#011419] border border-gray-800 rounded-lg px-3.5 py-2.5 mt-4">
                <div className="pr-4">
                  <span className="text-xs text-gray-200 font-semibold">Include chat history</span>
                  <p className="caption mt-0.5">Lets Writing Desk edits see this workspace's conversation for extra context. Turn it off if that chat is bleeding its tone or language into your prose and pulling the AI away from your directives.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={wdUseChatHistory}
                    onChange={(e) => handleToggleWdChatHistory(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className="w-7 h-4 bg-gray-700 peer-focus:outline-none rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-300 after:border-gray-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-accent"></div>
                </label>
              </div>
            </div>
          </section>

          {/* Appearance */}
          <section ref={registerSection('appearance')} data-section="appearance" className="scroll-mt-6 pb-4">
            <div className="bg-[#0a161d]/50 border border-gray-800/60 rounded-2xl p-6">
              <SectionHead
                icon={Palette}
                title="Appearance"
                desc="Background art and bubble transparency for this workspace's chat."
              />
              <div className="grid grid-cols-2 gap-6">
                {/* Controls */}
                <div className="flex flex-col space-y-4">
                  <div className="flex flex-col space-y-2">
                    <span className="text-[9px] text-gray-400 uppercase font-semibold">Background Image</span>
                    <div
                      onClick={() => bgInputRef.current?.click()}
                      style={bgImage ? { backgroundImage: `url("app-file:///${bgImage.replace(/\\/g, '/')}")` } : {}}
                      className="w-full h-24 rounded-xl bg-transparent border-2 border-dashed border-gray-800 hover:border-accent flex flex-col items-center justify-center cursor-pointer transition-colors bg-cover bg-center bg-no-repeat relative group overflow-hidden"
                    >
                      {!bgImage ? (
                        <div className="flex flex-col items-center justify-center transition-all duration-200">
                          <ImageIcon className="text-gray-600 group-hover:text-accent transition-colors w-6 h-6 mb-1" />
                          <span className="text-[9px] text-gray-500 uppercase tracking-widest font-semibold opacity-0 group-hover:opacity-100 transition-opacity font-sans">Upload Image</span>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRemoveBgImage(); }}
                          className="absolute inset-0 w-full h-full bg-black/75 text-white text-[9px] font-bold tracking-widest opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center cursor-pointer font-sans"
                        >
                          REMOVE IMAGE
                        </button>
                      )}
                    </div>
                    <input type="file" ref={bgInputRef} accept="image/*" onChange={handleBgImageUpload} className="hidden" />
                  </div>

                  <div>
                    <div className="flex justify-between text-[9px] text-gray-400 font-semibold mb-1">
                      <span>Backdrop Opacity</span>
                      <span className="font-mono text-accent/80">{backdropOpacity}%</span>
                    </div>
                    <input type="range" min="0" max="100" value={backdropOpacity} onChange={(e) => handleAppearanceChange('backdropOpacity', parseInt(e.target.value))} className="w-full accent-accent cursor-pointer" />
                  </div>
                  <div>
                    <div className="flex justify-between text-[9px] text-gray-400 font-semibold mb-1">
                      <span>User Chat Bubble Opacity</span>
                      <span className="font-mono text-accent/80">{userBubbleOpacity}%</span>
                    </div>
                    <input type="range" min="0" max="100" value={userBubbleOpacity} onChange={(e) => handleAppearanceChange('userBubbleOpacity', parseInt(e.target.value))} className="w-full accent-accent cursor-pointer" />
                  </div>
                  <div>
                    <div className="flex justify-between text-[9px] text-gray-400 font-semibold mb-1">
                      <span>AI Message Box Opacity</span>
                      <span className="font-mono text-accent/80">{aiBubbleOpacity}%</span>
                    </div>
                    <input type="range" min="0" max="100" value={aiBubbleOpacity} onChange={(e) => handleAppearanceChange('aiBubbleOpacity', parseInt(e.target.value))} className="w-full accent-accent cursor-pointer" />
                  </div>
                </div>

                {/* Live preview, mirrors the real chat styling for this workspace */}
                <div className="flex flex-col">
                  <span className="text-[9px] text-gray-400 uppercase font-semibold mb-2 flex items-center space-x-1.5">
                    <span>Live Preview</span>
                    <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                  </span>
                  <div
                    className="flex-1 rounded-xl border border-gray-800 overflow-hidden relative bg-cover bg-center min-h-[15rem]"
                    style={bgImage ? { backgroundImage: `url("app-file:///${bgImage.replace(/\\/g, '/')}")` } : { backgroundColor: '#011419' }}
                  >
                    {/* Backdrop overlay */}
                    <div className="absolute inset-0" style={{ backgroundColor: '#011419', opacity: backdropOpacity / 100 }} />

                    {/* Mini chat */}
                    <div className="relative z-10 flex flex-col h-full p-3">
                      <div className="flex-1 flex flex-col justify-center space-y-2.5 overflow-hidden">
                        {/* User message */}
                        <div className="flex justify-end">
                          <div
                            className="max-w-[75%] rounded-2xl border px-3 py-2 text-[11px] leading-snug text-gray-200 backdrop-blur-md"
                            style={{ backgroundColor: `rgba(26, 45, 50, ${userBubbleOpacity / 100})`, borderColor: 'rgba(221, 186, 110, 0.15)' }}
                          >
                            How does the northern keep look at dawn?
                          </div>
                        </div>
                        {/* AI message */}
                        <div className="flex justify-start">
                          <div
                            className="max-w-[85%] rounded-2xl border px-3 py-2 text-[11px] leading-snug text-gray-200 backdrop-blur-md"
                            style={{ backgroundColor: `rgba(10, 22, 29, ${aiBubbleOpacity / 100})`, borderColor: 'rgba(255, 255, 255, 0.05)' }}
                          >
                            Mist clings to the ramparts as first light spills over the valley, gilding the old stone gold.
                          </div>
                        </div>
                      </div>

                      {/* Chat bar */}
                      <div className="shrink-0 mt-2.5 bg-[#051116]/90 border border-gray-800/80 rounded-xl flex items-center px-2 py-1.5">
                        <span className="flex-1 text-[10px] text-gray-600 px-1.5 select-none">Write a message...</span>
                        <div className="w-6 h-6 rounded-full bg-accent flex items-center justify-center shrink-0">
                          <Send className="w-3 h-3 text-[#011419]" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </section>

        </div>
      </div>

      {showProfileModal && (
        <ProfileModal
          onClose={() => setShowProfileModal(false)}
          onSave={async (newProfile) => {
            const updatedList = [...activeProfilesList, newProfile.id];
            const updated = { ...activeChat, activeProfiles: JSON.stringify(updatedList) };
            await handleSaveChat(updated);
          }}
        />
      )}

      {showWorkflowModal && (
        <WorkflowModal
          onClose={() => setShowWorkflowModal(false)}
          onSave={async (newWorkflow) => {
            const updatedList = [...activeWorkflowsList, newWorkflow.id];
            const updated = { ...activeChat, activeWorkflows: JSON.stringify(updatedList) };
            await handleSaveChat(updated);
          }}
        />
      )}
    </div>
  );
}
