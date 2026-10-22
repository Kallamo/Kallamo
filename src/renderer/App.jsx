import React, { Suspense, useState, useEffect } from 'react';
import { AppProvider, useApp, useEngineDownloadProgress, useReindexingProgress, useToast } from './context/AppContext';
import TitleBar from './components/TitleBar';
import DashboardView from './components/DashboardView';
import {
  ChatWorkspaceView,
  ContextOverflowModal,
  LibraryView,
  ProfileErrorModal,
  SettingsModal,
  WhatsNewModal,
  WorkflowErrorModal,
  idlePreloadOrder
} from './views';
import { preloadWhenIdle } from './utils/lazyWithPreload';
import { PerfProfiler } from './utils/perf';
import { X, AlertCircle, Info, CircleCheck } from 'lucide-react';

// Self-hosted highlight.js themes (bundled by Vite, served from the app origin instead of a CDN)
import atomOneDarkThemeUrl from 'highlight.js/styles/atom-one-dark.css?url';
import githubDarkThemeUrl from 'highlight.js/styles/github-dark.css?url';
import tokyoNightDarkThemeUrl from 'highlight.js/styles/tokyo-night-dark.css?url';

const HLJS_THEME_URLS = {
  'atom-one-dark': atomOneDarkThemeUrl,
  'github-dark': githubDarkThemeUrl,
  'tokyo-night-dark': tokyoNightDarkThemeUrl,
};

const Spinner = ({ className }) => (
  <svg className={`animate-spin text-accent ${className}`} xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
  </svg>
);

function EngineDownloadStatus() {
  const { setEngineDownloadProgress, cancelEngineDownload } = useApp();
  const engineDownloadProgress = useEngineDownloadProgress();
  if (!engineDownloadProgress) return null;

  if (engineDownloadProgress.isBackground) {
    return (
      <div className="fixed bottom-6 right-6 z-50 w-76 bg-surface-editor border border-gray-800 rounded-xl p-4 shadow-2xl flex flex-col space-y-3 animate-in slide-in-from-bottom duration-300">
        <div className="flex items-center space-x-2.5">
          <div className="relative">
            <Spinner className="w-4 h-4" />
          </div>
          <span className="text-[0.6875rem] font-bold text-text-primary uppercase tracking-wider">
            {engineDownloadProgress.status === 'downloading' && 'Downloading Local AI Engine...'}
            {engineDownloadProgress.status === 'verifying' && 'Verifying Integrity...'}
            {engineDownloadProgress.status === 'extracting' && 'Setting up AI files...'}
            {engineDownloadProgress.status === 'completed' && 'Setup complete!'}
          </span>
        </div>
        {engineDownloadProgress.status === 'downloading' && (
          <div className="w-full">
            <div className="w-full bg-surface-panel rounded-full h-1.5 overflow-hidden">
              <div
                className="bg-accent h-full rounded-full transition-[width] duration-300"
                style={{ width: `${engineDownloadProgress.percent || 0}%` }}
              />
            </div>
            <div className="flex justify-between items-center mt-1.5">
              <span className="caption font-medium">
                {engineDownloadProgress.percent || 0}% completed
              </span>
              <button
                onClick={() => cancelEngineDownload()}
                className="text-[0.625rem] text-gray-400 hover:text-text-primary transition-colors cursor-pointer underline"
              >
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="absolute inset-0 z-[9999] flex items-center justify-center bg-surface-canvas/95 backdrop-blur-sm">
      <div className="flex flex-col items-center space-y-6 max-w-md text-center px-8 animate-in fade-in zoom-in-95 duration-300">
        <div className="relative">
          {engineDownloadProgress.status === 'error' ? (
            <AlertCircle className="w-12 h-12 text-status-danger" />
          ) : engineDownloadProgress.status === 'completed' ? (
            <CircleCheck className="w-12 h-12 text-emerald-400" />
          ) : (
            <Spinner className="w-12 h-12" />
          )}
        </div>

        <h2 className="text-xl font-bold text-text-primary capitalize">
          {engineDownloadProgress.status === 'downloading' && 'Downloading Local AI Engine'}
          {engineDownloadProgress.status === 'verifying' && 'Verifying Integrity Check'}
          {engineDownloadProgress.status === 'extracting' && 'Extracting Local AI Files'}
          {engineDownloadProgress.status === 'completed' && 'Installation Successful'}
          {engineDownloadProgress.status === 'error' && 'Installation Error'}
        </h2>

        <p className="text-sm text-gray-400 leading-relaxed">
          {engineDownloadProgress.status === 'downloading' && 'This needs a one-time download of the native runtime (~25 MB). Please do not close the application.'}
          {engineDownloadProgress.status === 'verifying' && 'Validating SHA-256 package checksum.'}
          {engineDownloadProgress.status === 'extracting' && 'Decompressing binary modules into the application workspace. This may take up to a minute.'}
          {engineDownloadProgress.status === 'completed' && 'Engine successfully set up! Directing to dashboard...'}
          {engineDownloadProgress.status === 'error' && `Error during setup: ${engineDownloadProgress.error}`}
        </p>

        {engineDownloadProgress.status === 'downloading' && (
          <div className="w-full bg-surface-panel rounded-full h-2 overflow-hidden">
            <div
              className="bg-accent h-full rounded-full transition-[width] duration-300"
              style={{ width: `${engineDownloadProgress.percent || 0}%` }}
            />
          </div>
        )}

        {engineDownloadProgress.status === 'downloading' && (
          <p className="caption font-medium">
            {engineDownloadProgress.percent || 0}% completed
            {engineDownloadProgress.loaded && engineDownloadProgress.total && (
              ` (${(engineDownloadProgress.loaded / (1024 * 1024)).toFixed(1)} / ${(engineDownloadProgress.total / (1024 * 1024)).toFixed(1)} MB)`
            )}
          </p>
        )}

        {engineDownloadProgress.status === 'downloading' && (
          <button
            onClick={() => cancelEngineDownload()}
            className="mt-2 px-5 py-2 bg-transparent hover:bg-gray-800/50 text-gray-400 hover:text-text-primary rounded-lg text-xs font-semibold transition-colors cursor-pointer border border-gray-700/50"
          >
            Cancel Download
          </button>
        )}

        {engineDownloadProgress.status === 'error' && (
          <button
            onClick={() => setEngineDownloadProgress(null)}
            className="mt-4 px-5 py-2 bg-danger-solid hover:bg-danger-solid-hover text-on-danger rounded-lg text-xs font-semibold transition-colors cursor-pointer"
          >
            Close
          </button>
        )}
      </div>
    </div>
  );
}

function ReindexOverlay() {
  const reindexingProgress = useReindexingProgress();
  if (!reindexingProgress || (reindexingProgress.status !== 'started' && reindexingProgress.status !== 'running')) return null;
  return (
    <div className="absolute inset-0 z-[9999] flex items-center justify-center bg-surface-canvas/95 backdrop-blur-sm">
      <div className="flex flex-col items-center space-y-6 max-w-md text-center px-8">
        <div className="relative">
          <Spinner className="w-12 h-12" />
        </div>
        <h2 className="text-xl font-bold text-text-primary">Upgrading Knowledge Base</h2>
        <p className="text-sm text-gray-400 leading-relaxed">
          Kallamo is upgrading your local AI to a new multilingual model.
          This only happens once and may take a few minutes depending on your data.
        </p>
        <div className="w-full bg-surface-panel rounded-full h-2 overflow-hidden">
          <div
            className="bg-accent h-full rounded-full transition-[width] duration-500"
            style={{ width: reindexingProgress.total ? `${Math.round((reindexingProgress.current / reindexingProgress.total) * 100)}%` : '30%' }}
          />
        </div>
        <p className="caption font-medium">{reindexingProgress.message || 'Processing...'}</p>
      </div>
    </div>
  );
}

// Indexing reports every chunk; this state stays here so a progress event re-renders the
// task cards only, not the view underneath.
function VectorizationTasks() {
  const { electronAPI, writingProfiles, chats } = useApp();
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

  if (Object.keys(activeTasks).length === 0) return null;

  return (
    <div className="absolute bottom-6 right-6 z-50 flex flex-col space-y-2 pointer-events-none">
      {Object.entries(activeTasks).map(([key, task]) => (
        <div
          key={key}
          className="w-72 bg-surface-editor border border-gray-800 rounded-lg p-3 shadow-2xl flex flex-col space-y-2 relative pointer-events-auto animate-in slide-in-from-bottom duration-300"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              {task.status === 'indexing' && (
                <div className="relative">
                  <Spinner className="w-4 h-4" />
                </div>
              )}
              {task.status === 'completed' && <span className="w-2.5 h-2.5 rounded-full bg-green-500" />}
              {task.status === 'error' && <span className="w-2.5 h-2.5 rounded-full bg-status-danger" />}

              <span className="text-[0.625rem] font-bold text-text-primary uppercase tracking-wider truncate max-w-[180px]">
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
              className="text-gray-500 hover:text-text-primary p-0.5 rounded transition-colors cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="caption font-medium break-all">
            {task.message}
          </div>
        </div>
      ))}
    </div>
  );
}

function ToastNotification() {
  const { showToast } = useApp();
  const toast = useToast();
  if (!toast || !toast.show) return null;
  return (
    <div className="fixed bottom-6 right-6 z-[9999] flex items-start space-x-3 bg-surface-panel/95 border border-gray-800 rounded-xl px-4 py-3.5 shadow-2xl animate-in slide-in-from-bottom-4 duration-300 max-w-md">
      <div className="shrink-0 mt-0.5">
        {toast.type === 'success' && <CircleCheck className="w-5.5 h-5.5 text-emerald-400" />}
        {toast.type === 'error' && <AlertCircle className="w-5.5 h-5.5 text-status-danger" />}
        {toast.type === 'info' && <Info className="w-5.5 h-5.5 text-accent" />}
      </div>
      <div className="flex-1 pr-2 min-w-0">
        <div className="text-xs font-semibold text-gray-200 leading-relaxed break-words whitespace-pre-wrap max-h-[50vh] overflow-y-auto custom-scrollbar">
          {toast.message}
        </div>
        {toast.action && (
          <button
            onClick={() => {
              toast.action.onClick();
              showToast(toast.message, toast.type, 0);
            }}
            className="mt-2 text-xs font-bold text-accent hover:text-text-primary transition-colors cursor-pointer"
          >
            {toast.action.label}
          </button>
        )}
      </div>
      <button
        onClick={() => showToast(toast.message, toast.type, 0)}
        className="text-gray-500 hover:text-text-primary transition-colors cursor-pointer shrink-0 self-start"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

function MainLayout() {
  const {
    currentView,
    dataReady,
    showOverflowModal,
    showErrorModal,
    errorData,
    settings,
    activeChatId,
    settingsRequest,
    clearSettingsRequest,
    whatsNewOpen,
    whatsNewType,
    whatsNewVersion,
    closeWhatsNew
  } = useApp();
  const [showSettingsModal, setShowSettingsModal] = useState(false);

  useEffect(() => {
    preloadWhenIdle(idlePreloadOrder);
  }, []);

  useEffect(() => {
    if (settings?.interface?.codeTheme) {
      const themeLink = document.getElementById('hljs-theme');
      if (themeLink) {
        themeLink.href = HLJS_THEME_URLS[settings.interface.codeTheme] || HLJS_THEME_URLS['atom-one-dark'];
      }
    }
  }, [settings?.interface?.codeTheme]);

  // The blur setting promises lighter rendering when off, so it applies to every element.
  useEffect(() => {
    document.documentElement.dataset.blur = (settings?.interface?.blur ?? true) ? 'on' : 'off';
  }, [settings?.interface?.blur]);

  // Scale typography without scaling every rem-based width, gap and control.
  // This keeps the app composition stable across the interface size setting.
  useEffect(() => {
    const root = document.documentElement;
    root.style.fontSize = '100%';
    const scale = settings?.interface?.fontSize === 'large'
      ? 1.25
      : settings?.interface?.fontSize === 'small' ? 1 : 1.125;
    root.style.setProperty('--interface-font-scale', String(scale));
  }, [settings?.interface?.fontSize]);

  useEffect(() => {
    const globalTooltip = document.createElement('div');
    globalTooltip.className = 'fixed hidden max-w-[16rem] rounded-card border border-border-default bg-surface-panel-muted px-3 py-2 text-xs leading-snug text-text-secondary shadow-overlay z-[100000] pointer-events-none transition-opacity duration-150 opacity-0';
    document.body.appendChild(globalTooltip);

    const handleMouseOver = (e) => {
      const target = e.target.closest('[data-tooltip]');
      if (!target) return;

      globalTooltip.textContent = target.getAttribute('data-tooltip');
      globalTooltip.classList.remove('hidden');

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

    // A clicked trigger often unmounts (e.g. a pencil that swaps to edit mode), so its
    // mouseout never fires and the tooltip would linger. Force-hide on any pointer down.
    const handleMouseDown = () => {
      globalTooltip.classList.add('opacity-0');
      globalTooltip.classList.add('hidden');
    };

    document.addEventListener('mouseover', handleMouseOver);
    document.addEventListener('mouseout', handleMouseOut);
    document.addEventListener('mousedown', handleMouseDown);

    return () => {
      document.removeEventListener('mouseover', handleMouseOver);
      document.removeEventListener('mouseout', handleMouseOut);
      document.removeEventListener('mousedown', handleMouseDown);
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
    <div className={`flex-1 relative flex flex-col pt-10 overflow-hidden bg-surface-canvas w-full h-full select-none ${fontClass}`}>
      <TitleBar onOpenSettings={() => setShowSettingsModal(true)} onPreloadSettings={() => SettingsModal.preload()} />

      {/* Local AI Engine download: full-screen overlay, or a discreet card when it runs in the background */}
      <EngineDownloadStatus />

      <ReindexOverlay />

      {/* Every screen runs under the transparent title bar and keeps its own content below it. */}
      <main className="flex-1 relative flex flex-col overflow-hidden w-full h-full z-10 -mt-10">
        <Suspense fallback={null}>
          {dataReady && currentView === 'dashboard' && <DashboardView />}
          {currentView === 'library' && <LibraryView />}
          {currentView === 'chat' && (
            <PerfProfiler id="workspace">
              <ChatWorkspaceView key={activeChatId} />
            </PerfProfiler>
          )}
        </Suspense>
      </main>


      <VectorizationTasks />

      <ToastNotification />

      <Suspense fallback={null}>
        {(showSettingsModal || settingsRequest) && (
          <SettingsModal
            initialTab={settingsRequest?.tab}
            initialSection={settingsRequest?.section}
            onClose={() => {
              setShowSettingsModal(false);
              clearSettingsRequest();
            }}
          />
        )}
        {showErrorModal && (
          errorData?.isWorkflow ? <WorkflowErrorModal /> : <ProfileErrorModal />
        )}
        {showOverflowModal && (
          <ContextOverflowModal />
        )}
        {whatsNewOpen && (
          <WhatsNewModal type={whatsNewType} version={whatsNewVersion} onClose={closeWhatsNew} />
        )}
      </Suspense>
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
