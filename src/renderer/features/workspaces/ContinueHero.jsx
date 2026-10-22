import React, { useState } from 'react';
import { ArrowRight, BookOpen, Clock, MapPin, MessageSquare, Users } from 'lucide-react';
import { WorldbuildGlyph, WritingGlyph } from '../../components/ui/glyphs';
import ContourCover from './ContourCover';
import RoleplayChip from './RoleplayChip';
import { displayDescription, isExampleWorkspace, leadImage, plural, timeAgo } from './workspaceFormat';

// The most recent workspace as a full-width banner: its cover, its latest reply, and a way straight back in.
export default function ContinueHero({ chat, onOpen, onBegin }) {
  // A picture that fails to load steps down: the scene's place, then the cover, then none.
  const [failed, setFailed] = useState(0);
  const sceneImage = chat.experienceMode === 'roleplay' && Boolean(chat.roleplayScene?.background?.path);
  const image = failed >= 2 ? null : leadImage(chat, { skipScene: failed >= 1 });
  const stepDown = () => setFailed(level => (level === 0 && !sceneImage ? 2 : level + 1));
  const roleplay = chat.experienceMode === 'roleplay';
  const scene = roleplay ? chat.roleplayScene : null;
  const example = isExampleWorkspace(chat);
  const description = displayDescription(chat);
  const reply = chat.lastReply;
  // An example story nobody has played yet starts from the beginning, which may need a model first.
  const unstarted = example && roleplay && !chat.messageCount;
  const stats = [
    [MessageSquare, plural(chat.messageCount || 0, 'message')],
    [Users, `${chat.entityCount || 0} ${chat.entityCount === 1 ? 'entity' : 'entities'}`],
    [BookOpen, plural(chat.documentCount || 0, 'document')],
  ];

  return (
    <section className="relative h-[30rem] shrink-0 overflow-hidden">
      {image ? (
        <img key={image.src} src={image.src} alt="" onError={stepDown} className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition: image.position }} />
      ) : (
        <ContourCover title={chat.title} />
      )}
      <div aria-hidden="true" className="absolute inset-0 bg-[linear-gradient(90deg,color-mix(in_srgb,var(--theme-scrim)_94%,transparent)_0%,color-mix(in_srgb,var(--theme-scrim)_80%,transparent)_34%,color-mix(in_srgb,var(--theme-scrim)_30%,transparent)_66%,color-mix(in_srgb,var(--theme-scrim)_8%,transparent)_100%)]" />
      <div aria-hidden="true" className="absolute inset-x-0 top-0 h-[8.75rem] bg-gradient-to-b from-scrim/70 to-transparent" />
      {/* The banner has no edge of its own: it fades into the page below. */}
      <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-[11.25rem] bg-gradient-to-b from-transparent to-surface-canvas" />

      <div className="relative mx-auto flex h-full w-full max-w-[75rem] flex-col gap-4 px-8 pb-10 pt-24">
        <div className="flex items-center gap-2.5">
          <span className="text-xs font-semibold text-text-secondary">{example ? 'Start here' : `Last opened ${timeAgo(chat.updatedAt).toLowerCase()}`}</span>
          {example && <HeroChip>Example</HeroChip>}
          {roleplay && <RoleplayChip />}
        </div>
        <h2 className="min-w-0 truncate pb-1 text-[3.5rem] font-extrabold leading-[1.05] tracking-[-0.03em] text-text-primary">{chat.title}</h2>
        {scene && (scene.locationName || scene.time) && (
          <div className="flex flex-wrap items-center gap-2">
            {scene.locationName && (
              <ScenePill>
                <MapPin className="h-[0.9375rem] w-[0.9375rem] shrink-0 text-entity-location" aria-hidden="true" />
                <span className="max-w-[16rem] truncate">{scene.locationName}</span>
              </ScenePill>
            )}
            {scene.time && (
              <ScenePill>
                <Clock className="h-[0.9375rem] w-[0.9375rem] shrink-0 text-text-secondary" aria-hidden="true" />
                {scene.time}
                {scene.date && <span className="font-medium text-text-muted">· {scene.date}</span>}
              </ScenePill>
            )}
          </div>
        )}
        {description && <p className="line-clamp-2 max-w-[36rem] text-sm leading-relaxed text-text-secondary">{description}</p>}
        {reply?.excerpt && (
          <div className="flex max-w-[36rem] flex-col gap-1.5">
            <span className="inline-flex items-center gap-2 text-xs font-semibold text-text-secondary">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: reply.aiColor || 'var(--theme-text-muted)' }} />
              {reply.aiName || 'AI'}
            </span>
            <p className="line-clamp-2 text-sm leading-relaxed text-text-muted">{reply.excerpt}</p>
          </div>
        )}
        <span className="flex-1" />
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={() => (unstarted && onBegin ? onBegin(chat) : onOpen(chat, 'chat'))}
            className="inline-flex h-11 items-center gap-2 rounded-xl bg-accent px-5 text-sm font-semibold text-on-accent shadow-sm transition-[filter,transform] hover:brightness-110 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            {unstarted ? 'Begin' : 'Continue'}
            <ArrowRight className="h-4 w-4" aria-hidden="true" />
          </button>
          <HeroButton icon={WorldbuildGlyph} onClick={() => onOpen(chat, 'worldbuild')}>Worldbuild</HeroButton>
          <HeroButton icon={WritingGlyph} onClick={() => onOpen(chat, 'writing')}>Writing Desk</HeroButton>
          <div className="ml-4 flex gap-4 text-xs text-text-secondary">
            {stats.map(([Icon, label]) => (
              <span key={label} className="inline-flex items-center gap-1.5 tabular-nums">
                <Icon className="h-3.5 w-3.5 text-text-subtle" aria-hidden="true" />
                {label}
              </span>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function ScenePill({ children }) {
  return <span className="inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-[0.625rem] border border-tint/[0.14] bg-scrim/55 px-3 text-[0.8125rem] font-semibold text-text-primary backdrop-blur-md">{children}</span>;
}

function HeroChip({ children }) {
  return <span className="inline-flex h-6 items-center rounded-full border border-tint/10 bg-surface-canvas/45 px-2.5 text-xs font-medium text-text-secondary backdrop-blur-md">{children}</span>;
}

function HeroButton({ icon: Icon, children, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-11 items-center gap-2 rounded-xl border border-tint/10 bg-tint/[0.06] px-4 text-sm font-semibold text-text-primary backdrop-blur-md transition-colors hover:bg-tint/[0.1] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
    >
      <Icon size={17} aria-hidden="true" />
      {children}
    </button>
  );
}
