import React, { useState, useEffect, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { HelpCircle, Trash2, Plus, Edit, Image as ImageIcon, Check, AlertTriangle, Cpu, Workflow, Brain, PenTool, Palette, Send, Drama } from 'lucide-react';
import ProfileModal from './modals/ProfileModal';
import WorkflowModal from './modals/WorkflowModal';
import RoleplayModeSection from './RoleplayModeSection';
import payloadBudgetContract from '../../shared/payload-budget.json';

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
  { id: 'roleplay', label: 'Roleplay Mode', icon: Drama },
  { id: 'appearance', label: 'Appearance', icon: Palette },
];

/* Declared at module scope: defining these inside the view remounted every
   section header and its subtree on each render. */
function SectionHead({ icon: Icon, title, desc, action }) {
  return (
    <div className="mb-5 flex items-start justify-between gap-4">
      <div className="flex min-w-0 items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-control border border-accent/20 bg-accent/10">
          <Icon aria-hidden="true" className="h-4.5 w-4.5 text-accent" />
        </div>
        <div className="min-w-0">
          <h3 className="text-sm font-bold uppercase tracking-[0.09em] text-text-primary">{title}</h3>
          {desc && <p className="caption mt-0.5">{desc}</p>}
        </div>
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}

function NewButton({ onClick, label = 'New' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-8 cursor-pointer items-center gap-1 rounded-control border border-accent/20 bg-surface-canvas px-2.5 py-1.5 text-xs font-semibold uppercase text-accent transition-colors duration-200 ease-standard hover:bg-accent/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <Plus aria-hidden="true" className="h-2.5 w-2.5" />
      <span>{label}</span>
    </button>
  );
}

/* Switch track. The previous version cleared the focus outline without giving
   anything back, leaving keyboard users with no indicator. */
const SWITCH_TRACK = "relative h-4 w-7 rounded-full bg-surface-hover transition-colors duration-200 ease-standard peer peer-checked:bg-accent peer-focus-visible:ring-2 peer-focus-visible:ring-accent/50 peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-surface-canvas after:absolute after:top-[0.125rem] after:left-[0.125rem] after:h-3 after:w-3 after:rounded-full after:border after:border-border-strong after:bg-text-secondary after:transition-transform after:content-[''] peer-checked:after:translate-x-full peer-checked:after:border-on-accent motion-reduce:after:transition-none";

/* The checkbox itself is sr-only rather than display:none, so these stay
   keyboard reachable; the label paints the focus ring. */
function ToggleBox({ active }) {
  return (
    <div className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-sm border transition-[background-color,border-color,transform] duration-200 ease-standard hover:scale-105 active:scale-95 motion-reduce:transform-none ${active ? 'border-accent bg-accent text-on-accent' : 'border-border-default bg-surface-canvas/90 hover:border-accent/50'}`}>
      {active && <Check aria-hidden="true" className="h-2.5 w-2.5 stroke-[3.5] text-on-accent" />}
    </div>
  );
}

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

  useEffect(() => {
    const openSection = event => {
      const sectionId = event.detail?.sectionId;
      if (!SECTIONS.some(section => section.id === sectionId)) return;
      setActiveSection(sectionId);
      requestAnimationFrame(() => sectionRefs.current[sectionId]?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
    };
    window.addEventListener('configuration-open-section', openSection);
    return () => window.removeEventListener('configuration-open-section', openSection);
  }, []);

  if (!activeChat) return null;

  const scrollToSection = (id) => {
    sectionRefs.current[id]?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // Number fields keep numeric state; empty input falls back to 0 on save.
  const handleUpdateNumberField = async (field, value) => {
    const num = value === '' ? 0 : Number(value);
    const normalized = field === 'maxContext'
      ? Math.min(
        payloadBudgetContract.maximumMaxPayloadTokens,
        Math.max(
          payloadBudgetContract.minimumMaxPayloadTokens,
          Number.isFinite(num) ? Math.floor(num) : payloadBudgetContract.defaultMaxPayloadTokens
        )
      )
      : (Number.isNaN(num) ? 0 : num);
    if (field === 'maxContext') setMaxContext(normalized);
    const updated = { ...activeChat, [field]: normalized };
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

  const inputClass = "field-input px-3 py-2.5 text-sm";
  const fieldLabel = "eyebrow block";

  const registerSection = (id) => (el) => { sectionRefs.current[id] = el; };

  return (
    <div className="flex w-full h-full bg-surface-canvas overflow-hidden">
      {/* Scroll-spy navigation column */}
      <nav className="w-56 shrink-0 border-r border-border-subtle py-8 px-4 bg-surface-sidebar/50 flex flex-col select-none">
        <span className="block text-xs font-semibold text-text-subtle uppercase tracking-widest px-3 mb-4">Configuration</span>
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
                  : 'border-transparent text-text-muted hover:text-text-primary hover:bg-surface-hover/60'
                  }`}
              >
                <Icon className={`w-4 h-4 shrink-0 ${isActive ? 'text-accent' : 'text-text-subtle'}`} />
                <span>{sec.label}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-auto pt-6 pb-20 px-3">
          <div className="rounded-control border border-border-subtle bg-surface-canvas/60 p-3">
            <p className="caption">
              Everything here affects only the workspace <span className="text-accent/80 font-semibold">{activeChat.title}</span>.
            </p>
          </div>
        </div>
      </nav>

      {/* Single scrolling content pane */}
      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="mx-auto max-w-4xl space-y-5 px-6 py-7">

          {/* Page header */}
          <header className="pb-1">
            <span className="text-[0.625rem] font-bold text-accent/70 uppercase tracking-[0.2em]">Workspace Configuration</span>
            <h1 className="text-2xl font-bold text-text-primary mt-1.5 tracking-tight">{activeChat.title}</h1>
            <div className="mt-4 h-px bg-gradient-to-r from-accent/40 via-border-default to-transparent" />
          </header>

          {/* Profiles & Workflows */}
          <section ref={registerSection('agents')} data-section="agents" className="scroll-mt-6">
            <div className="rounded-surface border border-border-subtle bg-surface-panel/50 p-5 sm:p-6">
              <SectionHead
                icon={Cpu}
                title="Profiles & Workflows"
                desc="Toggle which AI Profiles and Workflows this workspace can run."
              />
              <div className="grid grid-cols-2 gap-6">
                {/* Profiles column */}
                <div>
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="eyebrow flex items-center gap-1.5 text-text-secondary">
                      <span>Profiles</span>
                      <span className="text-accent/70 font-mono">{activeProfilesCount}</span>
                    </span>
                    <NewButton onClick={() => setShowProfileModal(true)} />
                  </div>
                  <input
                    type="text"
                    value={searchProfiles}
                    onChange={(e) => setSearchProfiles(e.target.value)}
                    placeholder="Filter profiles..."
                    className="field-input mb-2.5 px-3 py-1.5 text-xs"
                  />
                  <div className="space-y-2 max-h-[21rem] overflow-y-auto custom-scrollbar pr-1">
                    {filteredProfiles.length === 0 ? (
                      <span className="caption italic block">No profiles found</span>
                    ) : (
                      filteredProfiles.map(p => {
                        const isActive = activeProfilesList.includes(p.id);
                        if (p.needsSetup) {
                          return (
                            <div key={p.id} className="relative flex items-center justify-between p-2.5 rounded-control bg-surface-canvas border border-border-subtle">
                              <div className="flex items-center space-x-2 overflow-hidden mr-2">
                                <span className="w-2.5 h-2.5 rounded-full shrink-0 opacity-40" style={{ backgroundColor: p.color }} />
                                <span className="text-xs text-text-subtle truncate">{p.name}</span>
                              </div>
                              <div className="flex shrink-0 items-center">
                                <AlertTriangle className="w-3.5 h-3.5 text-status-warning cursor-help" data-tooltip="To activate: create an API profile in Settings, then link it to this profile in the Library." />
                              </div>
                            </div>
                          );
                        }
                        return (
                          <label key={p.id} className="flex items-center justify-between p-2.5 rounded-control bg-surface-canvas border border-border-subtle hover:border-border-default cursor-pointer transition-colors duration-200 ease-standard has-[:focus-visible]:border-accent/50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/40">
                            <div className="flex items-center space-x-2 overflow-hidden mr-2">
                              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
                              <span className="text-xs text-text-secondary truncate">{p.name}</span>
                            </div>
                            <ToggleBox active={isActive} />
                            <input type="checkbox" checked={isActive} onChange={() => toggleProfile(p.id)} className="sr-only" />
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>

                {/* Workflows column */}
                <div>
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="eyebrow flex items-center gap-1.5 text-text-secondary">
                      <span>Workflows</span>
                      <span className="text-accent/70 font-mono">{activeWorkflowsCount}</span>
                    </span>
                    <NewButton onClick={() => setShowWorkflowModal(true)} />
                  </div>
                  <input
                    type="text"
                    value={searchWorkflows}
                    onChange={(e) => setSearchWorkflows(e.target.value)}
                    placeholder="Filter workflows..."
                    className="field-input mb-2.5 px-3 py-1.5 text-xs"
                  />
                  <div className="space-y-2 max-h-[21rem] overflow-y-auto custom-scrollbar pr-1">
                    {filteredWorkflows.length === 0 ? (
                      <div className="flex flex-col items-center justify-center py-6 px-3 border border-dashed border-border-subtle rounded-control text-center">
                        <Workflow className="w-5 h-5 text-text-disabled mb-2" />
                        <span className="caption italic">No workflows yet</span>
                      </div>
                    ) : (
                      filteredWorkflows.map(wf => {
                        const isActive = activeWorkflowsList.includes(wf.id);
                        return (
                          <label key={wf.id} className="flex items-center justify-between p-2.5 rounded-control bg-surface-canvas border border-border-subtle hover:border-border-default cursor-pointer transition-colors duration-200 ease-standard has-[:focus-visible]:border-accent/50 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-accent/40">
                            <span className="text-xs text-text-secondary truncate mr-2">{wf.name}</span>
                            <ToggleBox active={isActive} />
                            <input type="checkbox" checked={isActive} onChange={() => toggleWorkflow(wf.id)} className="sr-only" />
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
            <div className="rounded-surface border border-border-subtle bg-surface-panel/50 p-5 sm:p-6">
              <SectionHead
                icon={Brain}
                title="Context & Memory"
                desc="How much history the model sees, and when older messages get archived."
              />
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <div className="flex items-center space-x-1.5 mb-1.5">
                    <label className={fieldLabel}>Max API Payload (Tokens)</label>
                    <HelpCircle className="w-3.5 h-3.5 text-text-subtle cursor-help shrink-0" data-tooltip="The workspace safety limit for estimated input plus the response reserved by the active AI Profile. Older chat history is removed first. If fixed context still cannot fit, Kallamo stops before contacting the API." />
                  </div>
                  <input
                    type="number"
                    min={payloadBudgetContract.minimumMaxPayloadTokens}
                    max={payloadBudgetContract.maximumMaxPayloadTokens}
                    step="1024"
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
                    <HelpCircle className="w-3.5 h-3.5 text-text-subtle cursor-help shrink-0" data-tooltip="The visual limit for active chat memory. Reaching this prompts you to summarize and move older messages to the Vector DB, keeping the active context clean." />
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
              <div className="bg-surface-canvas border border-border-subtle rounded-control px-3.5 py-3 mb-3">
                <div className="flex items-center justify-between gap-3 mb-2">
                  <span className={fieldLabel}>Active Context Usage</span>
                  <div className="flex items-center gap-2 text-[0.625rem] text-text-subtle font-mono whitespace-nowrap">
                    <span>{activeMessageCount} {activeMessageCount === 1 ? 'message' : 'messages'}</span>
                    <span className="text-text-disabled">•</span>
                    <span>~{tokensUsed} / {archiveThreshold} tokens</span>
                  </div>
                </div>
                <div className="w-full h-2.5 bg-surface-hover/70 rounded-full overflow-hidden shadow-inner">
                  <div
                    style={{ width: `${percentage}%` }}
                    className={`h-full transition-all duration-500 ease-out ${percentage >= 95 ? 'bg-status-danger' : percentage >= 75 ? 'bg-status-warning' : 'bg-accent'}`}
                  />
                </div>
                <div className="flex items-center justify-between mt-3 pt-3 border-t border-border-subtle">
                  <div className="pr-4">
                    <span className="text-xs text-text-secondary font-semibold">Show this bar at the top of the chat</span>
                    <p className="caption mt-0.5">Adds a thin usage bar under the chat header so you can watch the context fill as you write.</p>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer shrink-0">
                    <input
                      type="checkbox"
                      checked={showContextBar}
                      onChange={(e) => handleToggleContextBar(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className={SWITCH_TRACK} />
                  </label>
                </div>
              </div>

              <div className="flex items-center justify-between bg-surface-canvas border border-border-subtle rounded-control px-3.5 py-2.5 mb-3">
                <div className="pr-4">
                  <span className="text-xs text-text-secondary font-semibold">Auto-Summarize</span>
                  <p className="caption mt-0.5">Archive older messages automatically when the threshold is hit.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={autoSummarize}
                    onChange={(e) => handleToggleAutoSummarize(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className={SWITCH_TRACK} />
                </label>
              </div>

              <button
                onClick={handleSummarizeNow}
                className="w-full bg-surface-hover hover:bg-status-info/25 text-accent border border-accent/30 py-2.5 rounded-control text-xs font-semibold transition-colors cursor-pointer"
              >
                Summarize Now
              </button>

              {memoryBlocks.filter(b => b.type !== 'manual').length > 0 && (
                <div className="space-y-2 mt-4 pt-4 border-t border-border-subtle">
                  <span className="block text-[0.5625rem] font-bold text-text-subtle uppercase tracking-wider mb-1.5">Summarization Blocks</span>
                  <div className="grid grid-cols-2 gap-2">
                    {memoryBlocks.filter(b => b.type !== 'manual').map(block => (
                      <div key={block.id} className="bg-surface-canvas border border-border-subtle rounded-control p-3 relative group">
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
                              className="bg-surface-editor border border-border-subtle text-[0.625rem] text-accent font-bold uppercase rounded px-1.5 py-0.5 w-full focus:outline-none focus:border-accent"
                              autoFocus
                            />
                          </div>
                        ) : (
                          <div className="flex items-center justify-between pr-6 mb-1">
                            <button
                              type="button"
                              onClick={() => { setEditingBlockId(block.id); setEditingBlockTitle(block.title); }}
                              className="group/title flex min-w-0 items-center gap-1 truncate rounded text-[0.625rem] font-bold uppercase text-accent transition-colors hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                              aria-label={`Rename ${block.title}`}
                              title="Click to rename"
                            >
                              <span className="truncate">{block.title}</span>
                              <Edit aria-hidden="true" className="h-2.5 w-2.5 shrink-0 text-text-subtle opacity-0 transition-opacity group-hover/title:opacity-100 group-focus-visible/title:opacity-100" />
                            </button>
                          </div>
                        )}
                        <p className="caption line-clamp-2">{block.summary}</p>
                        <button
                          type="button"
                          onClick={() => deleteMemoryBlock(block.id)}
                          className="hover-reveal absolute right-2 top-2 cursor-pointer rounded p-1 text-text-disabled transition-colors hover:text-status-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-status-danger/40"
                          aria-label={`Delete ${block.title}`}
                          title="Delete Memory"
                        >
                          <Trash2 aria-hidden="true" className="h-3 w-3" />
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
            <div className="rounded-surface border border-border-subtle bg-surface-panel/50 p-5 sm:p-6">
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

              <div className="flex items-center justify-between bg-surface-canvas border border-border-subtle rounded-control px-3.5 py-2.5 mt-4">
                <div className="pr-4">
                  <span className="text-xs text-text-secondary font-semibold">Include chat history</span>
                  <p className="caption mt-0.5">Lets Writing Desk edits see this workspace's conversation for extra context. Turn it off if that chat is bleeding its tone or language into your prose and pulling the AI away from your directives.</p>
                </div>
                <label className="relative inline-flex items-center cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={wdUseChatHistory}
                    onChange={(e) => handleToggleWdChatHistory(e.target.checked)}
                    className="sr-only peer"
                  />
                  <div className={SWITCH_TRACK} />
                </label>
              </div>
            </div>
          </section>

          <section ref={registerSection('roleplay')} data-section="roleplay" className="scroll-mt-6">
            <RoleplayModeSection
              workspaceId={activeChat.id}
              api={electronAPI}
              showToast={showToast}
              inputClass={inputClass}
              fieldLabel={fieldLabel}
              SectionHead={SectionHead}
            />
          </section>

          {/* Appearance */}
          <section ref={registerSection('appearance')} data-section="appearance" className="scroll-mt-6 pb-4">
            <div className="rounded-surface border border-border-subtle bg-surface-panel/50 p-5 sm:p-6">
              <SectionHead
                icon={Palette}
                title="Appearance"
                desc="Background art and bubble transparency for this workspace's chat."
              />
              <div className="grid grid-cols-2 gap-6">
                {/* Controls */}
                <div className="flex flex-col space-y-4">
                  <div className="flex flex-col space-y-2">
                    <span className="text-[0.5625rem] text-text-muted uppercase font-semibold">Background Image</span>
                    <div
                      onClick={() => bgInputRef.current?.click()}
                      style={bgImage ? { backgroundImage: `url("app-file:///${bgImage.replace(/\\/g, '/')}")` } : {}}
                      className="w-full h-24 rounded-card bg-transparent border-2 border-dashed border-border-default hover:border-accent flex flex-col items-center justify-center cursor-pointer transition-colors bg-cover bg-center bg-no-repeat relative group overflow-hidden"
                    >
                      {!bgImage ? (
                        <div className="flex flex-col items-center justify-center transition-all duration-200">
                          <ImageIcon className="text-text-disabled group-hover:text-accent transition-colors w-6 h-6 mb-1" />
                          <span className="text-[0.5625rem] text-text-subtle uppercase tracking-widest font-semibold hover-reveal font-sans">Upload Image</span>
                        </div>
                      ) : (
                        <button
                          onClick={(e) => { e.stopPropagation(); handleRemoveBgImage(); }}
                          className="absolute inset-0 w-full h-full bg-surface-overlay text-text-primary text-[0.5625rem] font-bold tracking-widest hover-reveal flex items-center justify-center cursor-pointer font-sans"
                        >
                          REMOVE IMAGE
                        </button>
                      )}
                    </div>
                    <input type="file" ref={bgInputRef} accept="image/*" onChange={handleBgImageUpload} className="hidden" />
                  </div>

                  <div>
                    <div className="flex justify-between text-[0.5625rem] text-text-muted font-semibold mb-1">
                      <span>Backdrop Opacity</span>
                      <span className="font-mono text-accent/80">{backdropOpacity}%</span>
                    </div>
                    <input type="range" min="0" max="100" value={backdropOpacity} onChange={(e) => handleAppearanceChange('backdropOpacity', parseInt(e.target.value))} className="w-full accent-accent cursor-pointer" />
                  </div>
                  <div>
                    <div className="flex justify-between text-[0.5625rem] text-text-muted font-semibold mb-1">
                      <span>User Chat Bubble Opacity</span>
                      <span className="font-mono text-accent/80">{userBubbleOpacity}%</span>
                    </div>
                    <input type="range" min="0" max="100" value={userBubbleOpacity} onChange={(e) => handleAppearanceChange('userBubbleOpacity', parseInt(e.target.value))} className="w-full accent-accent cursor-pointer" />
                  </div>
                  <div>
                    <div className="flex justify-between text-[0.5625rem] text-text-muted font-semibold mb-1">
                      <span>AI Message Box Opacity</span>
                      <span className="font-mono text-accent/80">{aiBubbleOpacity}%</span>
                    </div>
                    <input type="range" min="0" max="100" value={aiBubbleOpacity} onChange={(e) => handleAppearanceChange('aiBubbleOpacity', parseInt(e.target.value))} className="w-full accent-accent cursor-pointer" />
                  </div>
                </div>

                {/* Live preview, mirrors the real chat styling for this workspace */}
                <div className="flex flex-col">
                  <span className="text-[0.5625rem] text-text-muted uppercase font-semibold mb-2 flex items-center space-x-1.5">
                    <span>Live Preview</span>
                    <span className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
                  </span>
                  <div
                    className="flex-1 rounded-card border border-border-subtle overflow-hidden relative bg-cover bg-center min-h-[15rem]"
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
                            className="max-w-[75%] rounded-surface border px-3 py-2 text-[0.6875rem] leading-snug text-text-secondary backdrop-blur-md"
                            style={{ backgroundColor: `rgba(26, 45, 50, ${userBubbleOpacity / 100})`, borderColor: 'rgba(221, 186, 110, 0.15)' }}
                          >
                            How does the northern keep look at dawn?
                          </div>
                        </div>
                        {/* AI message */}
                        <div className="flex justify-start">
                          <div
                            className="max-w-[85%] rounded-surface border px-3 py-2 text-[0.6875rem] leading-snug text-text-secondary backdrop-blur-md"
                            style={{ backgroundColor: `rgba(10, 22, 29, ${aiBubbleOpacity / 100})`, borderColor: 'rgba(255, 255, 255, 0.05)' }}
                          >
                            Mist clings to the ramparts as first light spills over the valley, gilding the old stone gold.
                          </div>
                        </div>
                      </div>

                      {/* Chat bar */}
                      <div className="shrink-0 mt-2.5 bg-surface-editor/90 border border-border-subtle rounded-card flex items-center px-2 py-1.5">
                        <span className="flex-1 text-[0.625rem] text-text-disabled px-1.5 select-none">Write a message...</span>
                        <div className="w-6 h-6 rounded-full bg-accent flex items-center justify-center shrink-0">
                          <Send className="w-3 h-3 text-on-accent" />
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
