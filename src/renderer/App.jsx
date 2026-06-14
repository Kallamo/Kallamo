import React, { useState, useEffect } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import TitleBar from './components/TitleBar';
import DashboardView from './components/DashboardView';
import LibraryView from './components/LibraryView';
import ChatWorkspaceView from './components/ChatWorkspaceView';
import SettingsModal from './components/modals/SettingsModal';
import WorkflowErrorModal from './components/modals/WorkflowErrorModal';
import ProfileErrorModal from './components/modals/ProfileErrorModal';
import ContextOverflowModal from './components/modals/ContextOverflowModal';
import { X, CheckCircle, AlertCircle, Info } from 'lucide-react';

// Self-hosted highlight.js themes (bundled by Vite, served from the app origin instead of a CDN)
import atomOneDarkThemeUrl from 'highlight.js/styles/atom-one-dark.css?url';
import githubDarkThemeUrl from 'highlight.js/styles/github-dark.css?url';
import tokyoNightDarkThemeUrl from 'highlight.js/styles/tokyo-night-dark.css?url';

const HLJS_THEME_URLS = {
  'atom-one-dark': atomOneDarkThemeUrl,
  'github-dark': githubDarkThemeUrl,
  'tokyo-night-dark': tokyoNightDarkThemeUrl,
};

function MainLayout() {
  const {
    currentView,
    showOverflowModal,
    showErrorModal,
    errorData,
    settings,
    electronAPI,
    writingProfiles,
    chats,
    toast,
    showToast
  } = useApp();
  const [showSettingsModal, setShowSettingsModal] = useState(false);
  const [activeTasks, setActiveTasks] = useState({});

  useEffect(() => {
    if (!electronAPI?.onVectorizationProgress) return;

    const unsubscribe = electronAPI.onVectorizationProgress((data) => {
      const { type, id, status, fileName, current, total, error } = data;

      let name = "Workspace/Profile";
      if (type === 'profile') {
        name = writingProfiles.find(p => p.id === id)?.name || "AI Profile";
      } else if (type === 'chat') {
        name = chats.find(c => c.id === id)?.title || "Chat Workspace";
      }

      setActiveTasks(prev => {
        const key = `${type}_${id}`;

        if (status === 'completed') {
          const task = {
            ...prev[key],
            name,
            status: 'completed',
            message: 'Vectorization completed!'
          };

          setTimeout(() => {
            setActiveTasks(latest => {
              const copy = { ...latest };
              delete copy[key];
              return copy;
            });
          }, 4000);

          return { ...prev, [key]: task };
        } else if (status === 'error') {
          return {
            ...prev,
            [key]: {
              name,
              status: 'error',
              message: `Error: ${error || 'Unknown error'}`
            }
          };
        } else {
          return {
            ...prev,
            [key]: {
              name,
              status: 'indexing',
              fileName,
              current,
              total,
              message: `Indexing: ${fileName || 'file'} (${current}/${total} chunks)`
            }
          };
        }
      });
    });

    return unsubscribe;
  }, [electronAPI, writingProfiles, chats]);

  // Sync Highlight.js code highlighting theme dynamically
  useEffect(() => {
    if (settings?.interface?.codeTheme) {
      const themeLink = document.getElementById('hljs-theme');
      if (themeLink) {
        themeLink.href = HLJS_THEME_URLS[settings.interface.codeTheme] || HLJS_THEME_URLS['atom-one-dark'];
      }
    }
  }, [settings?.interface?.codeTheme]);

  // Apply global scaling via root font-size (REM)
  useEffect(() => {
    const root = document.documentElement;
    if (settings?.interface?.fontSize === 'small') {
      root.style.fontSize = '16px';
    } else if (settings?.interface?.fontSize === 'large') {
      root.style.fontSize = '20px';
    } else {
      root.style.fontSize = '18px';
    }
  }, [settings?.interface?.fontSize]);

  // Global Tooltip Engine
  useEffect(() => {
    const globalTooltip = document.createElement('div');
    globalTooltip.className = 'fixed hidden bg-[#051116] border border-gray-800 text-gray-300 text-[10px] leading-relaxed rounded-md p-2.5 shadow-xl z-[9999] max-w-[220px] pointer-events-none transition-opacity duration-200 opacity-0';
    document.body.appendChild(globalTooltip);

    const handleMouseOver = (e) => {
      const target = e.target.closest('[data-tooltip]');
      if (!target) return;

      globalTooltip.textContent = target.getAttribute('data-tooltip');
      globalTooltip.classList.remove('hidden');

      // Force browser reflow to get correct layout dimensions immediately
      const tooltipHeight = globalTooltip.offsetHeight;
      const tooltipWidth = globalTooltip.offsetWidth;

      const rect = target.getBoundingClientRect();

      let top = rect.top - tooltipHeight - 8;
      let left = rect.left + (rect.width / 2) - (tooltipWidth / 2);

      if (top < 10) top = rect.bottom + 8;
      if (left < 10) left = 10;
      if (left + tooltipWidth > window.innerWidth - 10) left = window.innerWidth - tooltipWidth - 10;

      globalTooltip.style.top = `${top}px`;
      globalTooltip.style.left = `${left}px`;

      requestAnimationFrame(() => globalTooltip.classList.remove('opacity-0'));
    };

    const handleMouseOut = (e) => {
      const target = e.target.closest('[data-tooltip]');
      if (!target) return;

      globalTooltip.classList.add('opacity-0');
      setTimeout(() => {
        if (globalTooltip.classList.contains('opacity-0')) {
          globalTooltip.classList.add('hidden');
        }
      }, 200);
    };

    document.addEventListener('mouseover', handleMouseOver);
    document.addEventListener('mouseout', handleMouseOut);

    return () => {
      document.removeEventListener('mouseover', handleMouseOver);
      document.removeEventListener('mouseout', handleMouseOut);
      if (document.body.contains(globalTooltip)) {
        document.body.removeChild(globalTooltip);
      }
    };
  }, []);

  const fontClass = settings?.interface?.fontFamily === 'serif'
    ? 'font-serif'
    : settings?.interface?.fontFamily === 'monospace'
      ? 'font-mono'
      : 'font-sans';

  return (
    <div className={`flex-1 relative flex flex-col pt-10 overflow-hidden bg-[#011419] w-full h-full select-none ${fontClass}`}>
      <TitleBar />

      <main className="flex-1 relative flex flex-col overflow-hidden w-full h-full z-10">
        {currentView === 'dashboard' && <DashboardView />}
        {currentView === 'library' && <LibraryView />}
        {currentView === 'chat' && <ChatWorkspaceView />}
      </main>

      {/* Floating Settings Button - Globally available at bottom left */}
      <button
        onClick={() => setShowSettingsModal(true)}
        className="absolute bottom-6 left-6 p-3 bg-[#0a161d] hover:bg-[#1a2d32] border border-gray-800 rounded-full text-gray-400 hover:text-white transition-all shadow-lg group titlebar-nodrag z-30 cursor-pointer"
        title="Settings"
      >
        <svg
          className="group-hover:rotate-90 transition-transform duration-500"
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="3"></circle>
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path>
        </svg>
      </button>

      {/* Floating Background RAG Indexing Visualizer */}
      {Object.keys(activeTasks).length > 0 && (
        <div className="absolute bottom-6 right-6 z-50 flex flex-col space-y-2 pointer-events-none">
          {Object.entries(activeTasks).map(([key, task]) => (
            <div
              key={key}
              className="w-72 bg-[#051116] border border-gray-800 rounded-lg p-3 shadow-2xl flex flex-col space-y-2 relative pointer-events-auto animate-in slide-in-from-bottom duration-300"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center space-x-2">
                  {task.status === 'indexing' && (
                    <div className="relative">
                      <svg className="animate-spin text-accent w-4 h-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                    </div>
                  )}
                  {task.status === 'completed' && <span className="w-2.5 h-2.5 rounded-full bg-green-500" />}
                  {task.status === 'error' && <span className="w-2.5 h-2.5 rounded-full bg-red-500" />}

                  <span className="text-[10px] font-bold text-white uppercase tracking-wider truncate max-w-[180px]">
                    {task.name}
                  </span>
                </div>

                <button
                  onClick={() => {
                    setActiveTasks(prev => {
                      const copy = { ...prev };
                      delete copy[key];
                      return copy;
                    });
                  }}
                  className="text-gray-500 hover:text-white p-0.5 rounded transition-colors cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              <div className="text-[10px] text-gray-400 font-medium break-all">
                {task.message}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Global Toast Notification */}
      {toast && toast.show && (
        <div className={`fixed top-16 right-6 z-[9999] flex items-center space-x-3 bg-[#0a161d]/90 backdrop-blur-md border border-gray-800 rounded-xl px-4 py-3.5 shadow-2xl animate-in slide-in-from-top-4 duration-300 max-w-sm`}>
          <div className="shrink-0">
            {toast.type === 'success' && <CheckCircle className="w-5.5 h-5.5 text-emerald-400" />}
            {toast.type === 'error' && <AlertCircle className="w-5.5 h-5.5 text-red-400" />}
            {toast.type === 'info' && <Info className="w-5.5 h-5.5 text-accent" />}
          </div>
          <div className="flex-1 text-xs font-semibold text-gray-200 leading-relaxed pr-2">
            {toast.message}
          </div>
          <button 
            onClick={() => showToast(toast.message, toast.type, 0)}
            className="text-gray-500 hover:text-white transition-colors cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* Global Modals */}
      {showSettingsModal && (
        <SettingsModal onClose={() => setShowSettingsModal(false)} />
      )}
      {showErrorModal && (
        errorData?.isWorkflow ? <WorkflowErrorModal /> : <ProfileErrorModal />
      )}
      {showOverflowModal && (
        <ContextOverflowModal />
      )}
    </div>
  );
}

export default function App() {
  return (
    <AppProvider>
      <MainLayout />
    </AppProvider>
  );
}
