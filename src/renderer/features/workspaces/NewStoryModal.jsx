import React, { useEffect, useState } from 'react';
import { ArrowRight, BookOpen, Check, Clock, Globe, MapPin, MessageSquare, RotateCcw, Route, Users } from 'lucide-react';
import { useApp } from '../../context/AppContext';
import Modal from '../../components/ui/Modal';
import Button from '../../components/ui/Button';
import TextInput from '../../components/ui/TextInput';
import { ToneTile } from '../../components/modals/ModalParts';
import { leadImage, plural } from './workspaceFormat';

const COMES_ALONG = ['Worldbuild and its rules', 'Memories and documents', 'Profiles and settings', 'Everything you edited'];
const STARTS_FRESH = ['The chat', 'What the story changed', 'Time, scene and place', 'Who you play'];

const STEPS = {
  world: 'Preparing the world…',
  import: 'Copying the Worldbuild…',
  writing: 'Copying documents and memories…',
  done: 'Opening the new story…',
};

const GUIDED_POINTS = [
  { icon: Globe, title: 'The world as it began', text: 'Every person, secret and rumour back in its place. Nothing your last story changed comes along.' },
  { icon: Route, title: 'The introduction again', text: 'What the Narrative State does and the world, ready to skip if you already know them.' },
  { icon: Users, title: 'Someone else to play', text: 'Pick one of the cast, or make your own character, and begin with their opening.' },
];

// Starts a new workspace from this one's world. A guided story starts again from its first page.
export default function NewStoryModal({ chat, onClose, onStarted }) {
  const { electronAPI, showToast } = useApp();
  const [preview, setPreview] = useState(null);
  const [world, setWorld] = useState(null);
  const [title, setTitle] = useState('');
  const [starting, setStarting] = useState(false);
  const [step, setStep] = useState(null);

  useEffect(() => electronAPI.onNewStoryProgress?.(data => {
    if (data?.workspaceId === chat.id) setStep(data.step);
  }), [chat.id, electronAPI]);

  useEffect(() => {
    let active = true;
    electronAPI.previewNewStory(chat.id).then(result => {
      if (!active) return;
      if (!result?.success) { showToast(result?.error || 'This workspace cannot start a new story.', 'error'); onClose(); return; }
      setPreview(result);
      setTitle(result.title);
      if (result.guided) electronAPI.getOnboardingStory?.(chat.id).then(story => { if (active && story?.success) setWorld(story.story?.world || null); });
    });
    return () => { active = false; };
  }, [chat.id, electronAPI]);

  const start = async () => {
    if (starting) return;
    setStarting(true);
    try {
      const result = await electronAPI.startNewStory(chat.id, preview.guided ? null : title.trim());
      if (!result?.success) throw new Error(result?.error || 'The new story could not be started.');
      await onStarted(result.id);
    } catch (error) {
      showToast(error.message, 'error');
      setStarting(false);
      setStep(null);
    }
  };

  // While the copy runs, closing is off: the dialog is the only sign that work is going on.
  const close = () => { if (!starting) onClose(); };

  if (!preview) return null;

  const footer = (label, icon, trailing) => (
    <div className="flex items-center justify-end gap-2 border-t border-border-subtle px-5 py-3.5">
      {starting && <span role="status" className="mr-auto truncate text-xs text-text-muted">{STEPS[step] || STEPS.world}</span>}
      <Button variant="subtle" onClick={close} disabled={starting}>Cancel</Button>
      <Button icon={icon} loading={starting} onClick={start} disabled={!preview.guided && !title.trim()}>
        {label}{trailing}
      </Button>
    </div>
  );

  if (preview.guided) {
    const image = leadImage(chat, { skipScene: true });
    return (
      <Modal size="xl" onClose={close} closeOnOverlay={!starting} closeOnEsc={!starting} showClose={!starting}>
        <div className="relative h-[7.5rem] overflow-hidden">
          {image && <img src={image.src} alt="" className="absolute inset-0 h-full w-full object-cover" style={{ objectPosition: image.position }} />}
          <div aria-hidden="true" className="absolute inset-0 bg-gradient-to-r from-scrim/85 via-scrim/45 to-scrim/10" />
          <div aria-hidden="true" className="absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-surface-canvas" />
          {world && (
            <div className="absolute bottom-3.5 left-8 flex flex-wrap gap-2">
              <Pill><MapPin className="h-[0.9375rem] w-[0.9375rem] text-entity-location" aria-hidden="true" />{world.place}</Pill>
              <Pill><Clock className="h-[0.9375rem] w-[0.9375rem] text-text-secondary" aria-hidden="true" />{world.time}<span className="font-medium text-text-muted">· {world.date}</span></Pill>
            </div>
          )}
        </div>
        <div className="flex flex-col gap-3.5 px-8 pb-6 pt-2">
          <div className="flex flex-col gap-0.5">
            <span className="text-xs font-semibold text-text-muted">New story in this world</span>
            <h2 className="text-xl font-extrabold tracking-[-0.015em] text-text-primary">Start {chat.title} again</h2>
          </div>
          <p className="text-sm leading-relaxed text-text-secondary">
            A fresh copy of the world, as it was on your first visit. Your current story stays as it is, with everything that happened in it.
          </p>
          <ul className="flex flex-col gap-2.5">
            {GUIDED_POINTS.map(({ icon: Icon, title: pointTitle, text }) => (
              <li key={pointTitle} className="flex items-start gap-3 rounded-card border border-tint/[0.09] bg-tint/[0.03] px-4 py-3.5">
                <Icon className="mt-px h-[1.125rem] w-[1.125rem] shrink-0 text-accent" aria-hidden="true" />
                <div className="flex flex-col gap-0.5">
                  <span className="text-sm font-semibold text-text-primary">{pointTitle}</span>
                  <span className="text-xs leading-relaxed text-text-muted">{text}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>
        {footer('Begin again', null, <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />)}
      </Modal>
    );
  }

  const detail = [
    chat.messageCount ? plural(chat.messageCount, 'message') : 'No messages yet',
    chat.entityCount ? `${chat.entityCount} ${chat.entityCount === 1 ? 'entity' : 'entities'}` : null,
    chat.documentCount ? plural(chat.documentCount, 'document') : null,
  ].filter(Boolean).join(' · ');

  return (
    <Modal size="md" onClose={close} closeOnOverlay={!starting} closeOnEsc={!starting} showClose={!starting}>
      <div className="flex gap-4 px-5 pt-5">
        <ToneTile icon={BookOpen} color="var(--app-accent)" />
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-text-primary">New story in this world</h2>
          <p className="mt-1 text-sm leading-relaxed text-text-muted">Opens a new workspace with the same world. This story stays as it is.</p>
        </div>
      </div>
      <div className="space-y-3.5 px-5 pb-5 pt-4">
        <div className="flex items-center gap-3 rounded-control border px-3.5 py-3" style={{ background: 'var(--theme-surface-well)', borderColor: 'var(--theme-border-well)' }}>
          <ToneTile icon={MessageSquare} color="var(--app-accent)" size="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold text-text-primary">{chat.title}</p>
            <p className="truncate text-xs text-text-subtle">{detail}</p>
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          <StoryList label="Comes along" items={COMES_ALONG} icon={Check} iconClassName="text-status-success" />
          <StoryList label="Starts fresh" items={STARTS_FRESH} icon={RotateCcw} iconClassName="text-accent" />
        </div>
        <TextInput label="Name" value={title} onChange={event => setTitle(event.target.value)} maxLength={120} />
      </div>
      {footer('Start new story', BookOpen)}
    </Modal>
  );
}

function StoryList({ label, items, icon: Icon, iconClassName }) {
  return (
    <div className="flex flex-col gap-2 rounded-card border border-tint/[0.09] bg-tint/[0.03] px-3.5 py-3">
      <span className="text-xs font-semibold text-text-muted">{label}</span>
      <ul className="flex flex-col gap-2">
        {items.map(item => (
          <li key={item} className="flex gap-2 text-[0.8125rem] leading-snug text-text-secondary">
            <Icon className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${iconClassName}`} strokeWidth={2.5} aria-hidden="true" />
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}

function Pill({ children }) {
  return <span className="inline-flex h-8 items-center gap-2 whitespace-nowrap rounded-[0.625rem] border border-tint/[0.14] bg-scrim/55 px-3 text-[0.8125rem] font-semibold text-text-primary backdrop-blur-md">{children}</span>;
}
