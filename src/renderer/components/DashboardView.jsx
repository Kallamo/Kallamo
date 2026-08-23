import React, { useState, useRef } from 'react';
import { useApp } from '../context/AppContext';
import { Search, Library, Plus, MoreVertical, Pin, Trash2, Edit3, MessageSquare } from 'lucide-react';
import ChatModal from './modals/ChatModal';
import DeleteModal from './modals/DeleteModal';
import Popover from './ui/Popover';
import Button from './ui/Button';
import EmptyState from './ui/EmptyState';
import TextInput from './ui/TextInput';

export default function DashboardView() {
  const { 
    chats, 
    handleSelectChat, 
    handleDeleteChat, 
    handleSaveChat, 
    setCurrentView,
    electronAPI,
    showToast
  } = useApp();

  const [searchQuery, setSearchQuery] = useState('');
  const [activeDropdownId, setActiveDropdownId] = useState(null);
  const [showChatModal, setShowChatModal] = useState(false);
  const [chatToEdit, setChatToEdit] = useState(null);
  const [showDeleteModal, setShowDeleteModal] = useState(false);
  const [chatToDelete, setChatToDelete] = useState(null);
  
  const dropdownRef = useRef(null);

  const filteredChats = chats.filter(c => 
    (c.title || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Sort pinned first, then updatedAt descending
  const sortedChats = [...filteredChats].sort((a, b) => {
    if (a.isPinned && !b.isPinned) return -1;
    if (!a.isPinned && b.isPinned) return 1;
    return b.updatedAt - a.updatedAt;
  });

  const togglePin = async (e, chat) => {
    e.stopPropagation();
    setActiveDropdownId(null);
    const updated = { ...chat, isPinned: chat.isPinned ? 0 : 1 };
    await handleSaveChat(updated);
  };

  const openEditModal = (e, chat) => {
    e.stopPropagation();
    setActiveDropdownId(null);
    setChatToEdit(chat);
    setShowChatModal(true);
  };

  const triggerDelete = (e, chat) => {
    e.stopPropagation();
    setActiveDropdownId(null);
    setChatToDelete(chat);
    setShowDeleteModal(true);
  };

  const confirmDelete = async () => {
    if (chatToDelete) {
      await handleDeleteChat(chatToDelete.id);
      setShowDeleteModal(false);
      setChatToDelete(null);
    }
  };


  return (
    <div className="flex flex-col w-full h-full px-8 pb-8 pt-6 relative overflow-hidden bg-[#011419] select-none">
      
      {/* Header Area */}
      <div className="flex items-center justify-between mb-8 w-full max-w-7xl mx-auto shrink-0 mt-4">
        <h1 className="text-3xl font-bold text-white tracking-wide">Workspaces</h1>
        
        <div className="flex items-center space-x-4">
          {/* Search bar */}
          <div className="w-64">
            <TextInput
              icon={Search}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search workspaces…"
              aria-label="Search workspaces"
            />
          </div>

          {/* Library Link */}
          <Button variant="ghost" icon={Library} onClick={() => setCurrentView('library')}>Library</Button>

          {/* New Chat Button */}
          <Button
            icon={Plus}
            onClick={() => {
              setChatToEdit(null);
              setShowChatModal(true);
            }}
          >
            New Workspace
          </Button>
        </div>
      </div>

      {/* Grid Area */}
      <div className="w-full max-w-7xl mx-auto flex-1 overflow-y-auto custom-scrollbar pr-2 grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6 content-start pb-8">
        {sortedChats.length === 0 ? (
          <EmptyState
            className="col-span-full mt-6"
            icon={MessageSquare}
            title={searchQuery ? 'No matching workspaces' : 'Create your first workspace'}
            subtitle={searchQuery ? 'Try a different title or clear the search.' : 'Keep a story, its Worldbuild, memory, files, and writing tools together.'}
            action={!searchQuery ? <Button icon={Plus} onClick={() => { setChatToEdit(null); setShowChatModal(true); }}>New Workspace</Button> : null}
          />
        ) : (
          sortedChats.map(chat => {
            // Background image resolution
            const hasBg = chat.backgroundImage && chat.backgroundImage.trim() !== '';

            const messagesCount = chat.messageCount || 0;

            return (
              <div
                key={chat.id}
                onClick={() => handleSelectChat(chat.id)}
                className="group relative rounded-xl border border-gray-800/80 hover:border-accent/50 cursor-pointer transition-all duration-300 shadow-lg hover:-translate-y-1 h-40 flex flex-col justify-end p-5 bg-[#0a161d]"
              >
                {/* Custom blur/overlay background image container */}
                {hasBg && (
                  <div className="absolute inset-0 rounded-xl overflow-hidden pointer-events-none z-0">
                    <div 
                      className="absolute inset-0 bg-cover bg-center transition-transform duration-500 group-hover:scale-105"
                      style={{ backgroundImage: `url("app-file:///${chat.backgroundImage.replace(/\\/g, '/')}")` }}
                    />
                    <div className="absolute inset-0 bg-[#0a161d]/85 backdrop-blur-[2px] transition-colors group-hover:bg-[#0a161d]/75" />
                  </div>
                )}
                {/* Pin Icon indicator */}
                {chat.isPinned === 1 && (
                  <Pin className="absolute top-4 left-4 text-accent w-4 h-4 fill-accent z-10" />
                )}

                {/* Card options area */}
                <div className="absolute top-4 right-4 flex items-center space-x-1.5 z-30" onClick={(e) => e.stopPropagation()}>

                  <div ref={activeDropdownId === chat.id ? dropdownRef : null} className="relative">
                    <button 
                      onClick={(e) => {
                        e.stopPropagation();
                        setActiveDropdownId(activeDropdownId === chat.id ? null : chat.id);
                      }}
                      className="hover-reveal text-gray-400 hover:text-white transition-opacity p-1.5 rounded-md hover:bg-black/50 backdrop-blur-sm shadow-sm cursor-pointer" 
                      title="Options"
                    >
                      <MoreVertical className="w-4 h-4" />
                    </button>

                    <Popover anchorRef={dropdownRef} open={activeDropdownId === chat.id} onClose={() => setActiveDropdownId(null)} matchAnchorWidth={false} align="right" maxHeight={180} scroll={false} className="w-36 overflow-hidden rounded-md py-1">
                        <button 
                          onClick={(e) => togglePin(e, chat)}
                          className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-[#1a2d32] hover:text-white transition-colors flex items-center space-x-2 cursor-pointer font-medium"
                        >
                          <Pin className="w-3 h-3" />
                          <span>{chat.isPinned ? 'Unpin' : 'Pin'}</span>
                        </button>
                        <button 
                          onClick={(e) => openEditModal(e, chat)}
                          className="w-full text-left px-3 py-2 text-xs text-gray-300 hover:bg-[#1a2d32] hover:text-white transition-colors flex items-center space-x-2 cursor-pointer font-medium"
                        >
                          <Edit3 className="w-3 h-3" />
                          <span>Edit</span>
                        </button>
                        <div className="h-px bg-gray-800 w-full my-1"></div>
                        <button 
                          onClick={(e) => triggerDelete(e, chat)}
                          className="w-full text-left px-3 py-2 text-xs text-red-400 hover:bg-red-500/10 hover:text-red-300 transition-colors flex items-center space-x-2 cursor-pointer font-medium"
                        >
                          <Trash2 className="w-3 h-3" />
                          <span>Delete</span>
                        </button>
                    </Popover>
                  </div>
                </div>

                {/* Card Title & message count */}
                <div className="relative z-10 w-full pr-4 select-none pointer-events-none">
                  <h3 className="text-white font-bold text-lg truncate drop-shadow-md">{chat.title}</h3>
                  <p className="text-xs text-accent mt-1.5 drop-shadow-md font-semibold">{messagesCount} messages</p>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Workspace Creator/Editor Modal */}
      {showChatModal && (
        <ChatModal 
          chat={chatToEdit} 
          onClose={() => {
            setShowChatModal(false);
            setChatToEdit(null);
          }} 
        />
      )}

      {/* Workspace Delete Modal */}
      {showDeleteModal && (
        <DeleteModal 
          title="Delete Workspace"
          message={`Are you sure you want to permanently delete "${chatToDelete?.title}"?`}
          onConfirm={confirmDelete}
          onClose={() => {
            setShowDeleteModal(false);
            setChatToDelete(null);
          }}
        />
      )}

      {/* Discord Floating Button */}
      <a
        href="https://discord.com/invite/CE4C9JRS9H"
        target="_blank"
        rel="noopener noreferrer"
        className="absolute bottom-6 right-6 z-30 flex items-center space-x-2.5 px-4.5 py-3 bg-[#0a161d] hover:bg-[#5865F2] border border-gray-800 hover:border-transparent rounded-full text-gray-400 hover:text-white font-bold transition-all duration-300 ease-in-out shadow-lg hover:shadow-[0_0_15px_rgba(88,101,242,0.5)] active:scale-95 text-xs cursor-pointer font-sans select-none"
      >
        <svg viewBox="0 0 127.14 96.36" fill="currentColor" className="w-4.5 h-4.5">
          <path d="M107.7,8.07A105.15,105.15,0,0,0,77.26,0a77.19,77.19,0,0,0-3.3,6.83A96.67,96.67,0,0,0,53.22,6.83,77.19,77.19,0,0,0,49.88,0,105.15,105.15,0,0,0,19.44,8.07C3.66,31.58-1.86,54.65,1,77.53A105.73,105.73,0,0,0,32,96.36a77.7,77.7,0,0,0,6.63-10.85,68.43,68.43,0,0,1-10.5-5A52.57,52.57,0,0,0,31,77.53,74.37,74.37,0,0,0,96.19,77.53a52.57,52.57,0,0,0,2.83,3a68.43,68.43,0,0,1-10.5,5,77.7,77.7,0,0,0,6.63,10.85,105.73,105.73,0,0,0,31-18.83C129.87,50.84,123.3,28,107.7,8.07ZM42.45,65.69C36.18,65.69,31,60,31,53S36.18,40.36,42.45,40.36,53.83,46,53.83,53,48.72,65.69,42.45,65.69Zm42.24,0C78.41,65.69,73.24,60,73.24,53S78.41,40.36,84.69,40.36,96.07,46,96.07,53,91,65.69,84.69,65.69Z"/>
        </svg>
        <span className="leading-none">Join our Discord Community!</span>
      </a>

    </div>
  );
}
