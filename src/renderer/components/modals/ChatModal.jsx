import React, { useState, useEffect, useRef } from 'react';
import { Database, Image as ImageIcon, Search, Workflow as WorkflowIcon } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import Modal from '../ui/Modal';
import Button from '../ui/Button';
import TextInput from '../ui/TextInput';
import Textarea from '../ui/Textarea';
import Checkbox from '../ui/Checkbox';
import ProfileModal from './ProfileModal';
import ContourCover from '../../features/workspaces/ContourCover';
import { coverUrl, plural, timeAgo } from '../../features/workspaces/workspaceFormat';

const parseList = (value) => {
  try {
    const list = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
};

const stepsOf = (workflow) => parseList(workflow.steps);

export const newWorkspaceId = () => 'chat_' + Math.random().toString(36).substr(2, 9);

// The stored row for a workspace; an edit keeps everything the form does not show.
export function workspaceRecord(chat, { id, title, description = '', activeProfiles = [], activeWorkflows = [], backgroundImage = '', backdropOpacity = 75, userBubbleOpacity = 100, aiBubbleOpacity = 0, knowledgeFiles = [] }) {
  return {
    id,
    title: title.trim(),
    description: description.trim(),
    updatedAt: Date.now(),
    isPinned: chat?.isPinned ?? 0,
    maxContext: Number(chat?.maxContext) > 0 ? chat.maxContext : 128000,
    archiveThreshold: chat?.archiveThreshold ?? 60000,
    summarizedIndex: chat?.summarizedIndex ?? 0,
    activeProfiles: JSON.stringify(activeProfiles),
    activeWorkflows: JSON.stringify(activeWorkflows),
    backgroundImage,
    backdropOpacity: Number(backdropOpacity),
    userBubbleOpacity: Number(userBubbleOpacity),
    aiBubbleOpacity: Number(aiBubbleOpacity),
    showContextBar: chat?.showContextBar ?? 0,
    memoryBlocks: JSON.stringify(chat?.memoryBlocks || []),
    knowledgeFiles: JSON.stringify(knowledgeFiles),
  };
}

// `draft` carries what was already filled in elsewhere (the empty home's quick form).
export default function ChatModal({ chat, draft, onClose }) {
  const { handleCreateChat, handleSaveChat, writingProfiles, workflows, electronAPI } = useApp();
  const isEditing = !!chat;

  const [chatId] = useState(() => chat?.id || draft?.id || newWorkspaceId());
  const [title, setTitle] = useState(draft?.title || '');
  const [description, setDescription] = useState('');
  const [bgImage, setBgImage] = useState(draft?.backgroundImage || '');
  const [backdropOpacity, setBackdropOpacity] = useState(75);
  const [userBubbleOpacity, setUserBubbleOpacity] = useState(100);
  const [aiBubbleOpacity, setAiBubbleOpacity] = useState(0);
  const [activeProfiles, setActiveProfiles] = useState(draft?.activeProfiles || []);
  const [activeWorkflows, setActiveWorkflows] = useState([]);
  const [searchProfiles, setSearchProfiles] = useState('');
  // Preserved so editing an older workspace doesn't wipe legacy knowledge files.
  const [knowledgeFiles, setKnowledgeFiles] = useState([]);
  const [profileToSetUp, setProfileToSetUp] = useState(null);
  const bgInputRef = useRef(null);

  useEffect(() => {
    if (!chat) return;
    setTitle(chat.title || '');
    setDescription(chat.description || '');
    setBgImage(chat.backgroundImage || '');
    setBackdropOpacity(chat.backdropOpacity ?? 75);
    setUserBubbleOpacity(chat.userBubbleOpacity ?? 100);
    setAiBubbleOpacity(chat.aiBubbleOpacity ?? 0);
    setActiveProfiles(parseList(chat.activeProfiles));
    setActiveWorkflows(parseList(chat.activeWorkflows));
    setKnowledgeFiles(parseList(chat.knowledgeFiles));
  }, [chat]);

  const handleBgImageUpload = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const destBgPath = await electronAPI.uploadChatBgImage(chatId, file.path || '', file.name);
      setBgImage(destBgPath);
    } catch (err) {
      console.error('Error uploading cover image:', err);
    } finally {
      e.target.value = '';
    }
  };

  const toggle = (setter) => (id) => setter(prev => (prev.includes(id) ? prev.filter(item => item !== id) : [...prev, id]));
  const handleToggleProfile = toggle(setActiveProfiles);
  const handleToggleWorkflow = toggle(setActiveWorkflows);

  const handleSave = async () => {
    if (!title.trim()) return;
    const chatData = workspaceRecord(chat, {
      id: chatId, title, description, activeProfiles, activeWorkflows, backgroundImage: bgImage,
      backdropOpacity, userBubbleOpacity, aiBubbleOpacity, knowledgeFiles,
    });
    if (isEditing) await handleSaveChat(chatData);
    else await handleCreateChat(chatData);
    onClose();
  };

  const filteredProfiles = writingProfiles.filter(p => p.name.toLowerCase().includes(searchProfiles.toLowerCase()));
  const profileName = id => writingProfiles.find(p => p.id === id)?.name || 'Unknown profile';
  const cover = coverUrl(bgImage);
  const previewTitle = title.trim() || 'Untitled workspace';
  const previewMeta = isEditing
    ? `${chat.messageCount ? plural(chat.messageCount, 'message') : 'No messages yet'} · ${timeAgo(chat.updatedAt)}`
    : 'No messages yet · Just now';

  return (
    <>
      <Modal
        onClose={onClose}
        size="wide"
        title={isEditing ? 'Workspace settings' : 'New workspace'}
        subtitle="A story with its own chat, world, memory and writing."
        className="max-h-[calc(100vh-2rem)]"
      >
        <div className="flex-1 overflow-y-auto custom-scrollbar px-7 py-6 flex flex-col gap-6">
          <div className="flex flex-col gap-6 md:flex-row">
            <div className="flex w-full flex-col gap-2.5 md:w-[18.75rem] md:shrink-0">
              <div className="relative h-[12.25rem] overflow-hidden rounded-2xl border border-border-default">
                {cover ? <img src={cover} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <ContourCover title={previewTitle} />}
                <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-scrim/95 from-[10%] to-transparent to-[70%]" />
                <span className="absolute inset-x-4 bottom-3.5">
                  <span className="block truncate text-[1.0625rem] font-bold text-text-primary">{previewTitle}</span>
                  <span className="block text-xs font-semibold text-accent">{previewMeta}</span>
                </span>
              </div>
              <div className="flex gap-2">
                <Button variant="ghost" size="sm" icon={ImageIcon} fullWidth onClick={() => bgInputRef.current?.click()}>
                  {cover ? 'Change cover' : 'Add cover image'}
                </Button>
                {cover && <Button variant="subtle" size="sm" onClick={() => setBgImage('')}>Remove</Button>}
              </div>
              <span className="caption">Without an image the card gets a map drawn from its name. The image also sits behind the chat.</span>
              <input type="file" ref={bgInputRef} accept="image/*" onChange={handleBgImageUpload} className="hidden" />
            </div>

            <div className="flex flex-1 flex-col gap-4">
              <TextInput
                label="Name"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Novel project, Campaign, Sandbox"
                error={isEditing && !title.trim() ? 'A workspace needs a name.' : null}
                autoFocus={!isEditing}
              />
              <Textarea
                label="Description (optional)"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What this story is about, for you. The AI doesn't read it."
                className="min-h-[5.75rem]"
              />
            </div>
          </div>

          <section className="flex flex-col gap-2.5">
            <div className="flex flex-wrap items-baseline gap-2.5">
              <h3 className="text-sm font-bold text-text-primary">Starts with</h3>
              <span className="caption">Profiles and workflows switched on when it opens. You can change them later in Configuration.</span>
            </div>
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="overflow-hidden rounded-[0.875rem] border border-border-subtle bg-tint/[0.02]">
                <div className="flex items-center gap-2 px-3 py-2.5">
                  <span className="flex-1 text-xs font-semibold text-text-primary">
                    AI profiles <span className="caption tabular-nums">{activeProfiles.length} on</span>
                  </span>
                  <div className="relative w-40">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3 w-3 -translate-y-1/2 text-text-subtle" aria-hidden="true" />
                    <input
                      value={searchProfiles}
                      onChange={(e) => setSearchProfiles(e.target.value)}
                      placeholder="Search"
                      aria-label="Search profiles"
                      className="h-[1.875rem] w-full rounded-lg border border-border-default bg-surface-input pl-7 pr-2 text-xs text-text-secondary placeholder:text-text-subtle focus:border-accent focus:outline-none"
                    />
                  </div>
                </div>
                <div className="max-h-64 overflow-y-auto overflow-x-hidden custom-scrollbar">
                  {filteredProfiles.length === 0 ? (
                    <p className="caption border-t border-border-subtle px-3 py-3">No profiles found.</p>
                  ) : filteredProfiles.map(p => (
                    p.needsSetup ? (
                      <div key={p.id} className="flex items-center gap-2.5 border-t border-tint/5 px-3 py-2">
                        <Checkbox size="sm" checked={false} disabled ariaLabel={`${p.name} can't be switched on yet`} />
                        <span className="h-2 w-2 shrink-0 rounded-full opacity-50" style={{ backgroundColor: p.color }} />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-text-subtle">{p.name}</span>
                          <span className="block text-xs text-status-warning">No model linked</span>
                        </span>
                        <button type="button" onClick={() => setProfileToSetUp(p)} className="rounded-lg px-2.5 py-1.5 text-xs font-semibold text-status-setup transition-colors hover:bg-tint/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40">
                          Set up
                        </button>
                      </div>
                    ) : (
                      <div key={p.id} className="border-t border-tint/5 px-3 py-2 transition-colors hover:bg-tint/[0.03]">
                        <Checkbox
                          size="sm"
                          checked={activeProfiles.includes(p.id)}
                          onChange={() => handleToggleProfile(p.id)}
                          label={(
                            <span className="flex min-w-0 items-center gap-2.5">
                              <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: p.color }} />
                              <span className="min-w-0">
                                <span className="block truncate text-text-primary">{p.name}</span>
                                {p.model && <span className="block truncate font-mono text-xs text-text-subtle">{p.model}</span>}
                              </span>
                            </span>
                          )}
                        />
                      </div>
                    )
                  ))}
                </div>
              </div>

              <div className="self-start overflow-hidden rounded-[0.875rem] border border-border-subtle bg-tint/[0.02]">
                <div className="px-3 py-2.5 text-xs font-semibold text-text-primary">
                  Workflows <span className="caption tabular-nums">{activeWorkflows.length} on</span>
                </div>
                <div className="max-h-64 overflow-y-auto overflow-x-hidden custom-scrollbar">
                  {workflows.length === 0 ? (
                    <p className="caption border-t border-border-subtle px-3 py-3">No workflows yet. Build one in the Library.</p>
                  ) : workflows.map(w => (
                    <div key={w.id} className="border-t border-tint/5 px-3 py-2 transition-colors hover:bg-tint/[0.03]">
                      <Checkbox
                        size="sm"
                        checked={activeWorkflows.includes(w.id)}
                        onChange={() => handleToggleWorkflow(w.id)}
                        label={(
                          <span className="flex min-w-0 items-center gap-2.5">
                            <WorkflowIcon className="h-3.5 w-3.5 shrink-0 text-text-muted" aria-hidden="true" />
                            <span className="min-w-0">
                              <span className="block truncate text-text-primary">{w.name}</span>
                              <span className="block truncate text-xs text-text-subtle">{stepsOf(w).map(step => profileName(step.profileId)).join(', then ') || 'No steps'}</span>
                            </span>
                          </span>
                        )}
                      />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </section>
        </div>

        <footer className="flex shrink-0 items-center gap-2.5 border-t border-border-subtle bg-tint/[0.015] px-7 py-4">
          <Database className="h-4 w-4 shrink-0 text-text-subtle" aria-hidden="true" />
          <span className="caption flex-1">Facts, files and lore go in the Memory tab once the workspace is open.</span>
          <Button variant="subtle" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={!title.trim()}>{isEditing ? 'Save changes' : 'Create workspace'}</Button>
        </footer>
      </Modal>

      {profileToSetUp && <ProfileModal profile={profileToSetUp} onClose={() => setProfileToSetUp(null)} />}
    </>
  );
}
