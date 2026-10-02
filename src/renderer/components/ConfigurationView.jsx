import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Drama, Palette } from 'lucide-react';
import { useApp } from '../context/AppContext';
import { MemoryGlyph, WritingGlyph, AiGlyph } from './ui/glyphs';
import RoleplayModeSection from './RoleplayModeSection';
import ProfilesWorkflowsSection from '../features/configuration/ProfilesWorkflowsSection';
import ContextMemorySection from '../features/configuration/ContextMemorySection';
import WritingDeskSection from '../features/configuration/WritingDeskSection';
import AppearanceSection from '../features/configuration/AppearanceSection';

const SECTIONS = [
  { id: 'agents', label: 'Profiles & Workflows', icon: AiGlyph },
  { id: 'context', label: 'Context & memory', icon: MemoryGlyph },
  { id: 'writing', label: 'Writing Desk', icon: WritingGlyph },
  {
    id: 'roleplay',
    label: 'Roleplay',
    icon: Drama,
    children: [
      { id: 'roleplay-scene', label: 'Scene' },
      { id: 'narrative-state', label: 'Narrative State', pill: true }
    ]
  },
  { id: 'appearance', label: 'Appearance', icon: Palette }
];

export default function ConfigurationView({ onTriggerSummarize }) {
  const { activeChat, handleSaveChat, writingProfiles, workflows, activeMessages, electronAPI, refreshChats, showToast } = useApp();
  const [activeSection, setActiveSection] = useState('agents');
  const [roleplayStatus, setRoleplayStatus] = useState({ enabled: false, pendingCount: 0 });
  const scrollRef = useRef(null);
  const sectionRefs = useRef({});

  // Sub-sections exist only while Roleplay is on; the spy order follows the page.
  const order = useMemo(() => SECTIONS.flatMap(section => [
    section.id,
    ...(section.children && roleplayStatus.enabled ? section.children.map(child => child.id) : [])
  ]), [roleplayStatus.enabled]);

  const registerSection = useCallback(id => element => { sectionRefs.current[id] = element; }, []);
  // Scrolls only this pane: scrollIntoView would also move the app frame around it.
  const scrollToSection = useCallback(id => {
    const root = scrollRef.current;
    const element = sectionRefs.current[id];
    setActiveSection(id);
    if (!root || !element) return;
    const top = element.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop - 24;
    root.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
  }, []);

  // The bottom of the scroll activates the last section, so a short one still lights up.
  const handleScroll = () => {
    const root = scrollRef.current;
    if (!root) return;
    if (root.scrollTop + root.clientHeight >= root.scrollHeight - 4) {
      setActiveSection(order[order.length - 1]);
      return;
    }
    const line = root.getBoundingClientRect().top + root.clientHeight * 0.28;
    let current = order[0];
    for (const id of order) {
      const element = sectionRefs.current[id];
      if (element && element.getBoundingClientRect().top <= line) current = id;
    }
    setActiveSection(current);
  };

  useEffect(() => {
    const openSection = event => {
      const sectionId = event.detail?.sectionId;
      if (!sectionId) return;
      requestAnimationFrame(() => requestAnimationFrame(() => scrollToSection(sectionId)));
    };
    window.addEventListener('configuration-open-section', openSection);
    return () => window.removeEventListener('configuration-open-section', openSection);
  }, [scrollToSection]);

  if (!activeChat) return null;

  const shared = { activeChat, handleSaveChat, electronAPI, refreshChats, showToast };

  return (
    <div className="flex h-full w-full overflow-hidden bg-surface-canvas">
      <nav aria-label="Configuration sections" className="flex w-62 shrink-0 select-none flex-col gap-0.5 border-r border-border-subtle bg-surface-sidebar/70 px-3 py-5">
        <span className="px-2.5 pb-3 text-[0.9375rem] font-bold text-text-primary">Configuration</span>
        {SECTIONS.map(section => {
          const Icon = section.icon;
          const showChildren = section.children && roleplayStatus.enabled;
          return (
            <div key={section.id}>
              <NavButton active={activeSection === section.id} onClick={() => scrollToSection(section.id)}>
                <Icon aria-hidden="true" className="h-4 w-4 shrink-0" />
                <span className="truncate">{section.label}</span>
              </NavButton>
              {showChildren && (
                <div className="ml-[1.1875rem] flex flex-col gap-px border-l border-border-subtle pl-2">
                  {section.children.map(child => (
                    <NavButton key={child.id} child active={activeSection === child.id} onClick={() => scrollToSection(child.id)}>
                      <span className="min-w-0 flex-1 truncate">{child.label}</span>
                      {child.pill && roleplayStatus.pendingCount > 0 && (
                        <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-status-warning/14 px-1.5 text-xs font-semibold tabular-nums text-status-warning">{roleplayStatus.pendingCount}</span>
                      )}
                    </NavButton>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </nav>

      <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto custom-scrollbar">
        <div className="mx-auto flex max-w-[55rem] flex-col gap-5 px-6 pb-10 pt-8 lg:px-12">
          <header className="pb-1">
            <h1 className="text-[1.625rem] font-bold tracking-tight text-text-primary">{activeChat.title}</h1>
            <p className="mt-1 text-[0.8125rem] text-text-muted">Workspace settings. They apply to this workspace only.</p>
          </header>

          <ProfilesWorkflowsSection sectionRef={registerSection('agents')} activeChat={activeChat} writingProfiles={writingProfiles} workflows={workflows} handleSaveChat={handleSaveChat} />
          <ContextMemorySection sectionRef={registerSection('context')} {...shared} activeMessages={activeMessages} onTriggerSummarize={onTriggerSummarize} />
          <WritingDeskSection sectionRef={registerSection('writing')} activeChat={activeChat} handleSaveChat={handleSaveChat} />
          <RoleplayModeSection
            workspaceId={activeChat.id}
            api={electronAPI}
            showToast={showToast}
            registerSection={registerSection}
            onStatusChange={setRoleplayStatus}
            onScrollTo={scrollToSection}
          />
          <AppearanceSection sectionRef={registerSection('appearance')} {...shared} />
        </div>
      </div>
    </div>
  );
}

function NavButton({ active, child = false, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'true' : undefined}
      className={`flex w-full items-center gap-2.5 rounded-control px-2.5 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${child ? 'h-7.5 text-[0.8125rem]' : 'h-8.5 text-[0.8125rem]'} ${active ? 'bg-accent/13 font-semibold text-accent' : 'font-medium text-text-muted hover:bg-surface-hover/60 hover:text-text-primary'}`}
    >
      {children}
    </button>
  );
}
