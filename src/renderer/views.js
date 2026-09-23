import { lazyWithPreload } from './utils/lazyWithPreload';

// Views and modals outside the first screen load on demand; App fetches them on idle
// in this order, so the workspace is usually ready before it is opened.
export const ChatWorkspaceView = lazyWithPreload(() => import('./components/ChatWorkspaceView'));
export const LibraryView = lazyWithPreload(() => import('./components/LibraryView'));

export const WorldbuildView = lazyWithPreload(() => import('./components/WorldbuildView'));
export const ChatMemoryView = lazyWithPreload(() => import('./components/ChatMemoryView'));
export const WritingDeskView = lazyWithPreload(() => import('./components/WritingDeskView'));
export const ConfigurationView = lazyWithPreload(() => import('./components/ConfigurationView'));
export const ChatFilesView = lazyWithPreload(() => import('./components/ChatFilesView'));

export const SettingsModal = lazyWithPreload(() => import('./components/modals/SettingsModal'));
export const WhatsNewModal = lazyWithPreload(() => import('./components/modals/WhatsNewModal'));
export const WorkflowErrorModal = lazyWithPreload(() => import('./components/modals/WorkflowErrorModal'));
export const ProfileErrorModal = lazyWithPreload(() => import('./components/modals/ProfileErrorModal'));
export const ContextOverflowModal = lazyWithPreload(() => import('./components/modals/ContextOverflowModal'));

export const idlePreloadOrder = [
  ChatWorkspaceView,
  LibraryView,
  WorldbuildView,
  ChatMemoryView,
  ConfigurationView,
  ChatFilesView,
  WritingDeskView,
  SettingsModal,
  WorkflowErrorModal,
  ProfileErrorModal,
  ContextOverflowModal,
  WhatsNewModal
];

// Tab id -> view, so a hover on a workspace tab can fetch its chunk before the click.
export const workspaceTabViews = {
  writing: WritingDeskView,
  worldbuild: WorldbuildView,
  memory: ChatMemoryView,
  files: ChatFilesView,
  configuration: ConfigurationView
};
