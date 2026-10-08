import React, { useEffect, useMemo, useState } from 'react';
import { Search, Plus, LibraryBig, MessageSquare } from 'lucide-react';
import { ToneTile } from './modals/ModalParts';
import { useApp } from '../context/AppContext';
import ChatModal from './modals/ChatModal';
import DeleteModal from './modals/DeleteModal';
import SegmentedControl from './ui/SegmentedControl';
import EmptyState from './ui/EmptyState';
import ContinueHero from '../features/workspaces/ContinueHero';
import WorkspaceCard, { NewWorkspaceTile } from '../features/workspaces/WorkspaceCard';
import SetupStrip from '../features/workspaces/SetupStrip';
import EmptyWorkspaces, { EmptyBackdrop } from '../features/workspaces/EmptyWorkspaces';
import DiscordButton from '../features/workspaces/DiscordButton';
import { leadImage } from '../features/workspaces/workspaceFormat';

const SORTS = [
  { value: 'recent', label: 'Recent' },
  { value: 'name', label: 'Name' },
];

export default function DashboardView() {
  const {
    chats,
    setChats,
    writingProfiles,
    apiProfiles,
    handleSelectChat,
    handleDeleteChat,
    handleSaveChat,
    setCurrentView,
    setActiveWorkspaceView,
    openSettings,
    electronAPI,
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [sort, setSort] = useState('recent');
  const [chatModal, setChatModal] = useState(null); // { chat } while the create/edit dialog is open
  const [chatToDelete, setChatToDelete] = useState(null);

  // Counts and the latest reply change while you work inside a workspace; refresh on return.
  useEffect(() => {
    let cancelled = false;
    electronAPI.getChats?.().then(fresh => { if (!cancelled && Array.isArray(fresh)) setChats(fresh); });
    return () => { cancelled = true; };
  }, []);

  const profilesById = useMemo(() => new Map(writingProfiles.map(profile => [profile.id, profile])), [writingProfiles]);
  const profilesOf = chat => (chat.activeProfiles || []).map(id => profilesById.get(id)).filter(Boolean);

  const recent = useMemo(() => [...chats].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)), [chats]);
  const hero = recent[0] || null;
  const query = searchQuery.trim().toLowerCase();
  const listed = useMemo(() => {
    const filtered = chats.filter(chat => (chat.title || '').toLowerCase().includes(query));
    return filtered.sort((a, b) => {
      if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
      return sort === 'name'
        ? (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' })
        : (b.updatedAt || 0) - (a.updatedAt || 0);
    });
  }, [chats, query, sort]);

  const noProfileReady = writingProfiles.length === 0 || writingProfiles.every(profile => profile.needsSetup);
  const isEmpty = chats.length === 0;
  const ambient = !isEmpty && hero ? leadImage(hero)?.src : null;

  const openWorkspace = (chat, view = 'chat') => {
    setActiveWorkspaceView(view);
    handleSelectChat(chat.id);
  };
  const togglePin = chat => handleSaveChat({ ...chat, isPinned: chat.isPinned ? 0 : 1 });
  const openCreate = () => setChatModal({ chat: null });
  const confirmDelete = async () => {
    if (!chatToDelete) return;
    await handleDeleteChat(chatToDelete.id);
    setChatToDelete(null);
  };

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden surface-page select-none">
      {isEmpty ? <EmptyBackdrop /> : ambient && (
        <>
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[40rem] overflow-hidden">
            <img src={ambient} alt="" className="absolute -left-16 -top-16 h-[44rem] w-[calc(100%+8rem)] max-w-none object-cover opacity-50 blur-[56px] saturate-[1.25]" />
          </div>
          <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 top-0 h-[40rem] bg-[linear-gradient(to_bottom,color-mix(in_srgb,var(--theme-surface-canvas)_35%,transparent)_0%,color-mix(in_srgb,var(--theme-surface-canvas)_75%,transparent)_55%,var(--theme-surface-canvas)_100%)]" />
        </>
      )}

      <div className="relative z-10 flex-1 overflow-y-auto custom-scrollbar [mask-image:linear-gradient(to_bottom,transparent_0,transparent_2.25rem,black_4.25rem)]">
        <div className={`mx-auto flex w-full max-w-[75rem] flex-col gap-[1.375rem] px-8 pb-20 pt-[4.25rem] ${isEmpty ? 'min-h-full' : ''}`}>
          <header className="flex flex-wrap items-center gap-3">
            <h1 className="flex-1 text-[1.875rem] font-extrabold tracking-[-0.02em] text-text-primary">Workspaces</h1>
            {!isEmpty && (
              <div className="relative w-64">
                <Search className="pointer-events-none absolute left-3 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 text-text-subtle" aria-hidden="true" />
                <input
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search workspaces"
                  aria-label="Search workspaces"
                  className="h-[2.375rem] w-full rounded-[0.625rem] border border-border-default bg-surface-inset/55 pl-9 pr-3 text-sm text-text-secondary backdrop-blur-xl placeholder:text-text-subtle focus:border-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/30"
                />
              </div>
            )}
            <GlassButton icon={LibraryBig} onClick={() => setCurrentView('library')}>Library</GlassButton>
            {!isEmpty && <GlassButton icon={Plus} onClick={openCreate} primary>New workspace</GlassButton>}
          </header>

          {isEmpty ? (
            <EmptyWorkspaces onCreate={openCreate} needsModel={noProfileReady} onOpenSettings={() => openSettings('api')} />
          ) : (
            <>
              {!query && hero && <ContinueHero chat={hero} onOpen={openWorkspace} />}
              {!query && noProfileReady && (
                <SetupStrip
                  hasApiProfile={apiProfiles.length > 0}
                  onOpenSettings={() => openSettings('api')}
                  onOpenLibrary={() => setCurrentView('library')}
                  workspaceLabel={hero?.title}
                />
              )}

              <div className="mt-2.5 flex items-center gap-3">
                <h2 className="text-base font-bold text-text-primary">{query ? 'Results' : 'All workspaces'}</h2>
                <span className="caption tabular-nums">{listed.length}</span>
                <span className="flex-1" />
                <SegmentedControl label="Sort workspaces" value={sort} onChange={setSort} options={SORTS} />
              </div>

              {listed.length === 0 ? (
                <EmptyState title="No matching workspaces" subtitle="Try a different title or clear the search." />
              ) : (
                <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                  {listed.map(chat => (
                    <WorkspaceCard
                      key={chat.id}
                      chat={chat}
                      profiles={profilesOf(chat)}
                      onOpen={openWorkspace}
                      onTogglePin={togglePin}
                      onEdit={target => setChatModal({ chat: target })}
                      onDelete={setChatToDelete}
                    />
                  ))}
                  {!query && <NewWorkspaceTile onClick={openCreate} />}
                </div>
              )}
            </>
          )}
        </div>
      </div>

      <DiscordButton />

      {chatModal && <ChatModal chat={chatModal.chat} onClose={() => setChatModal(null)} />}
      {chatToDelete && (
        <DeleteModal
          title="Delete this workspace?"
          message="Its chat, Worldbuild, Writing Desk, memory and files go with it. This cannot be undone."
          confirmText="Delete workspace"
          subject={{
            leading: <ToneTile icon={MessageSquare} color="var(--app-accent)" size="sm" />,
            name: chatToDelete.title,
            detail: [chatToDelete.messageCount ? `${chatToDelete.messageCount} ${chatToDelete.messageCount === 1 ? 'message' : 'messages'}` : 'No messages yet',
              chatToDelete.entityCount ? `${chatToDelete.entityCount} ${chatToDelete.entityCount === 1 ? 'entity' : 'entities'}` : null,
              chatToDelete.documentCount ? `${chatToDelete.documentCount} ${chatToDelete.documentCount === 1 ? 'document' : 'documents'}` : null].filter(Boolean).join(' · ')
          }}
          onConfirm={confirmDelete}
          onClose={() => setChatToDelete(null)}
        />
      )}
    </div>
  );
}

function GlassButton({ icon: Icon, children, onClick, primary = false }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex h-9 items-center gap-2 rounded-[0.625rem] px-3.5 text-sm font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${primary
        ? 'bg-accent/90 text-on-accent shadow-[0_0.375rem_1.125rem_-0.5rem] shadow-accent/50 hover:bg-accent'
        : 'border border-border-default bg-surface-inset/45 text-text-primary backdrop-blur-xl hover:bg-surface-hover'}`}
    >
      <Icon className="h-4 w-4" aria-hidden="true" />
      {children}
    </button>
  );
}
