import React, { useRef, useState } from 'react';
import { Check, Drama, Image as ImageIcon, Plus, RotateCcw, SlidersHorizontal } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import { newWorkspaceId, workspaceRecord } from '../../components/modals/ChatModal';
import exampleCover from '../../../assets/onboarding-bg.svg';
import ContourCover from './ContourCover';
import { coverUrl } from './workspaceFormat';

// Only reached after every workspace was deleted: first launch always opens the sample story.
// So it starts the next story right here, and offers the sample back.
export default function EmptyWorkspaces({ onMoreOptions }) {
  const { writingProfiles, setWritingProfiles, setChats, handleCreateChat, showToast, electronAPI } = useApp();
  const ready = writingProfiles.filter(profile => !profile.needsSetup);

  const [chatId] = useState(newWorkspaceId);
  const [title, setTitle] = useState('');
  const [backgroundImage, setBackgroundImage] = useState('');
  const [activeProfiles, setActiveProfiles] = useState(() => ready.map(profile => profile.id));
  const [creating, setCreating] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const coverInputRef = useRef(null);

  const cover = coverUrl(backgroundImage);
  const previewTitle = title.trim() || 'Untitled workspace';
  const toggle = id => setActiveProfiles(current => (current.includes(id) ? current.filter(item => item !== id) : [...current, id]));

  const pickCover = async event => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      setBackgroundImage(await electronAPI.uploadChatBgImage(chatId, file.path || '', file.name));
    } catch (error) {
      console.error('Error uploading cover image:', error);
    } finally {
      event.target.value = '';
    }
  };

  const create = async event => {
    event.preventDefault();
    if (!title.trim() || creating) return;
    setCreating(true);
    try {
      await handleCreateChat(workspaceRecord(null, { id: chatId, title, activeProfiles, backgroundImage }));
    } finally {
      setCreating(false);
    }
  };

  const restore = async (which = 'lighthouse') => {
    setRestoring(which);
    try {
      const result = which === 'evenwell' ? await electronAPI.restoreEvenwellWorkspace() : await electronAPI.restoreExampleWorkspace();
      if (!result?.success) throw new Error(result?.error || 'The sample story could not be restored.');
      setChats(await electronAPI.getChats());
      setWritingProfiles(await electronAPI.getWritingProfiles());
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setRestoring(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_23.75rem]">
      <form onSubmit={create} aria-labelledby="start-story" className="flex flex-col gap-6 rounded-[1.25rem] border border-border-subtle surface-card p-7">
        <h2 id="start-story" className="text-2xl font-extrabold leading-tight tracking-[-0.02em] text-text-primary">Start a new story</h2>
        <div className="flex flex-col gap-6 md:flex-row">
          <div className="relative h-[9.75rem] w-full shrink-0 overflow-hidden rounded-[0.875rem] border border-border-default md:w-[13.75rem]">
            {cover ? <img src={cover} alt="" className="absolute inset-0 h-full w-full object-cover" /> : <ContourCover title={previewTitle} />}
            <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-scrim/95 from-[10%] to-transparent to-[70%]" />
            <button
              type="button"
              onClick={() => coverInputRef.current?.click()}
              className="absolute right-2.5 top-2.5 inline-flex h-[1.875rem] items-center gap-1.5 rounded-lg border border-tint/10 bg-scrim/60 px-2.5 text-xs font-semibold text-text-primary backdrop-blur-md transition-colors hover:bg-scrim/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
              {cover ? 'Change' : 'Cover'}
            </button>
            <span className="absolute inset-x-3.5 bottom-3 truncate text-[0.9375rem] font-bold text-text-primary">{previewTitle}</span>
            <input type="file" ref={coverInputRef} accept="image/*" onChange={pickCover} className="hidden" />
          </div>

          <div className="flex min-w-0 flex-1 flex-col gap-[1.125rem]">
            <label className="flex flex-col gap-[0.4375rem]">
              <span className="text-[0.8125rem] font-medium text-text-secondary">Name</span>
              <input
                value={title}
                onChange={event => setTitle(event.target.value)}
                placeholder="e.g. Novel project, Campaign, Sandbox"
                autoFocus
                className="h-10 rounded-[0.625rem] border border-border-default bg-surface-input px-3 text-sm text-text-primary placeholder:text-text-subtle focus:border-accent/70 focus:outline-none focus-visible:ring-[3px] focus-visible:ring-accent/15"
              />
            </label>
            <fieldset className="flex flex-col gap-[0.4375rem]">
              <legend className="mb-[0.4375rem] text-[0.8125rem] font-medium text-text-secondary">Writes with you</legend>
              {ready.length ? (
                <div className="flex flex-wrap gap-2">
                  {ready.map(profile => {
                    const on = activeProfiles.includes(profile.id);
                    return (
                      <label
                        key={profile.id}
                        className={`inline-flex h-[2.375rem] cursor-pointer items-center gap-2.5 whitespace-nowrap rounded-[0.625rem] border pl-[0.6875rem] pr-3.5 text-[0.8125rem] font-medium text-text-primary transition-colors focus-within:ring-2 focus-within:ring-accent/40 ${on ? 'border-accent/45 bg-accent/[0.07]' : 'border-border-default bg-tint/[0.02] hover:bg-tint/[0.05]'}`}
                      >
                        <input type="checkbox" checked={on} onChange={() => toggle(profile.id)} className="sr-only" />
                        <span aria-hidden="true" className={`inline-flex h-4 w-4 items-center justify-center rounded-[0.3125rem] border-[1.5px] ${on ? 'border-accent bg-accent text-on-accent' : 'border-tint/25'}`}>
                          {on && <Check className="h-[0.6875rem] w-[0.6875rem]" strokeWidth={3} />}
                        </span>
                        <span aria-hidden="true" className="h-2 w-2 shrink-0 rounded-full" style={{ background: profile.color }} />
                        {profile.name}
                      </label>
                    );
                  })}
                </div>
              ) : (
                <span className="caption">No profile can reply yet. Link one to a model in the Library first.</span>
              )}
            </fieldset>
          </div>
        </div>
        <div className="flex items-center gap-2.5 border-t border-border-subtle pt-5">
          <button
            type="button"
            onClick={() => onMoreOptions({ id: chatId, title, backgroundImage, activeProfiles })}
            className="inline-flex h-9 items-center gap-2 rounded-[0.625rem] px-3.5 text-sm font-semibold text-text-secondary transition-colors hover:bg-tint/[0.05] hover:text-text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
            More options
          </button>
          <span className="flex-1" />
          <button
            type="submit"
            disabled={!title.trim() || creating}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-accent px-5 text-sm font-semibold text-on-accent shadow-sm transition-[filter,transform,opacity] hover:brightness-110 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:brightness-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <Plus className="h-4 w-4" aria-hidden="true" />
            Create workspace
          </button>
        </div>
      </form>

      <section aria-labelledby="sample-story" className="relative min-h-[25rem] overflow-hidden rounded-[1.25rem] border border-border-subtle">
        <img src={exampleCover} alt="" className="absolute inset-0 h-full w-full object-cover object-[center_30%]" />
        <span aria-hidden="true" className="absolute inset-0 bg-gradient-to-t from-scrim/97 from-30% via-scrim/60 via-[62%] to-scrim/5" />
        <div className="absolute inset-x-7 bottom-7 flex flex-col gap-2.5">
          <span className="text-xs font-semibold text-text-secondary">The sample story</span>
          <h2 id="sample-story" className="text-2xl font-extrabold leading-tight tracking-[-0.02em] text-text-primary">The Lighthouse</h2>
          <p className="text-sm leading-relaxed text-text-muted">
            Mara inherits the lighthouse where her grandfather vanished. A first chapter, a chat with Brainstorming and a small world, ready to try things on.
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => restore('lighthouse')}
              disabled={Boolean(restoring)}
              className="inline-flex h-11 items-center gap-2 rounded-xl border border-border-default bg-tint/[0.04] px-5 text-sm font-semibold text-text-primary transition-colors hover:bg-surface-hover disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              {restoring === 'lighthouse' ? 'Restoring…' : 'Restore The Lighthouse'}
            </button>
            <button
              type="button"
              onClick={() => restore('evenwell')}
              disabled={Boolean(restoring)}
              className="inline-flex h-11 items-center gap-2 rounded-xl px-4 text-sm font-semibold text-text-secondary transition-colors hover:bg-tint/[0.05] hover:text-text-primary disabled:cursor-wait disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
            >
              <Drama className="h-4 w-4" aria-hidden="true" />
              {restoring === 'evenwell' ? 'Restoring…' : 'Restore Evenwell'}
            </button>
          </div>
        </div>
      </section>
    </div>
  );
}
